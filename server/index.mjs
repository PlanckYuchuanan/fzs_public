import crypto from 'node:crypto';
import http from 'node:http';

import { SignJWT, jwtVerify } from 'jose';
import mysql from 'mysql2/promise';
import { v4 as uuidv4 } from 'uuid';

const PORT = Number(process.env.PORT || 32123);
const DB_HOST = process.env.DB_HOST || '127.0.0.1';
const DB_PORT = Number(process.env.DB_PORT || 3306);
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const DB_NAME = process.env.DB_NAME || 'from_zero_start';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret-change-me';
const ACCESS_TOKEN_TTL_SEC = Number(process.env.ACCESS_TOKEN_TTL_SEC || 15 * 60);
const REFRESH_TOKEN_TTL_SEC = Number(process.env.REFRESH_TOKEN_TTL_SEC || 7 * 24 * 60 * 60);
const COOKIE_SECURE = String(process.env.COOKIE_SECURE || '').toLowerCase() === 'true';
const ACCESS_COOKIE_NAME = 'ax_access';
const REFRESH_COOKIE_NAME = 'ax_refresh';
const DEVICE_COOKIE_NAME = 'ax_device';
const ADMIN_ACCESS_COOKIE_NAME = 'ax_admin_access';
const ADMIN_REFRESH_COOKIE_NAME = 'ax_admin_refresh';
const ADMIN_DEVICE_COOKIE_NAME = 'ax_admin_device';

function getCorsHeaders(req) {
  const origin = typeof req?.headers?.origin === 'string' ? req.headers.origin : '';
  return {
    'Access-Control-Allow-Origin': origin || 'http://localhost:51720',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'content-type,authorization',
    'Access-Control-Allow-Credentials': 'true',
    Vary: 'Origin',
    'Access-Control-Max-Age': '86400',
  };
}

function parseCookies(req) {
  const header = req?.headers?.cookie;
  if (!header || typeof header !== 'string') return {};
  const out = {};
  const parts = header.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(val);
    } catch {
      out[key] = val;
    }
  }
  return out;
}

function appendSetCookie(res, value) {
  const prev = res.getHeader('Set-Cookie');
  if (!prev) {
    res.setHeader('Set-Cookie', [value]);
    return;
  }
  if (Array.isArray(prev)) {
    res.setHeader('Set-Cookie', [...prev, value]);
    return;
  }
  res.setHeader('Set-Cookie', [String(prev), value]);
}

function setCookie(res, name, value, options) {
  const parts = [];
  parts.push(`${name}=${encodeURIComponent(value)}`);
  if (options?.maxAgeSeconds !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`);
  if (options?.path) parts.push(`Path=${options.path}`);
  if (options?.httpOnly) parts.push('HttpOnly');
  if (options?.secure) parts.push('Secure');
  if (options?.sameSite) parts.push(`SameSite=${options.sameSite}`);
  appendSetCookie(res, parts.join('; '));
}

function clearCookie(res, name) {
  appendSetCookie(res, `${name}=; Max-Age=0; Path=/; SameSite=Lax`);
}

function writeJson(req, res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    ...getCorsHeaders(req),
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk.toString('utf8');
      if (raw.length > 1_000_000) {
        reject(new Error('body_too_large'));
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error('invalid_json'));
      }
    });
    req.on('error', (e) => reject(e));
  });
}

function pbkdf2Hash(password, salt) {
  const hash = crypto.pbkdf2Sync(password, salt, 120_000, 32, 'sha256');
  return hash.toString('base64');
}

function normalizePhone(phone) {
  if (typeof phone !== 'string') return '';
  let p = phone.trim();
  p = p.replace(/[\s-]/g, '');
  if (p.startsWith('+86')) p = p.slice(3);
  if (p.startsWith('86') && p.length > 11) p = p.slice(2);
  return p;
}

function validateChinaMainlandMobile(phone) {
  if (typeof phone !== 'string') return false;
  return /^1[3-9]\d{9}$/.test(phone);
}

function validatePassword(password) {
  if (typeof password !== 'string') return false;
  return password.length >= 6;
}

function getUserPublic(userRow) {
  return {
    userId: userRow.id,
    phone: userRow.phone,
    registeredAt: userRow.created_at,
    isEnabled: userRow.is_enabled !== 0,
  };
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function signAccessToken(payload) {
  const secret = new TextEncoder().encode(JWT_SECRET);
  const now = Math.floor(Date.now() / 1000);
  const exp = now + (Number.isFinite(ACCESS_TOKEN_TTL_SEC) ? ACCESS_TOKEN_TTL_SEC : 900);
  return await new SignJWT({ ...payload, exp })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(secret);
}

async function verifyAccessToken(token) {
  const secret = new TextEncoder().encode(JWT_SECRET);
  const result = await jwtVerify(token, secret, { algorithms: ['HS256'] });
  return result.payload;
}

function getCookieSecure(req) {
  if (COOKIE_SECURE) return true;
  const origin = typeof req?.headers?.origin === 'string' ? req.headers.origin : '';
  if (origin && /^https:/i.test(origin)) return true;
  const proto = typeof req?.headers?.['x-forwarded-proto'] === 'string' ? req.headers['x-forwarded-proto'] : '';
  return /^https$/i.test(proto);
}

function getOrCreateDeviceIdFor(req, res, cookieName) {
  const cookies = parseCookies(req);
  const existing = typeof cookies[cookieName] === 'string' ? cookies[cookieName] : '';
  if (existing) return existing;
  const next = uuidv4();
  setCookie(res, cookieName, next, { path: '/', httpOnly: false, secure: getCookieSecure(req), sameSite: 'Lax', maxAgeSeconds: REFRESH_TOKEN_TTL_SEC });
  return next;
}

async function issueTokensForUser(req, res, userRow) {
  const deviceId = getOrCreateDeviceIdFor(req, res, DEVICE_COOKIE_NAME);
  const scope = 'user';
  const accessToken = await signAccessToken({ user_id: userRow.id, username: userRow.phone, scope });

  const refreshToken = crypto.randomBytes(32).toString('base64url');
  const refreshTokenHash = sha256Hex(refreshToken);
  const nowIso = new Date().toISOString();
  const expiresIso = new Date(Date.now() + REFRESH_TOKEN_TTL_SEC * 1000).toISOString();
  const refreshId = uuidv4();
  const ip = typeof req?.socket?.remoteAddress === 'string' ? req.socket.remoteAddress : null;
  const userAgent = typeof req?.headers?.['user-agent'] === 'string' ? req.headers['user-agent'].slice(0, 255) : null;

  await state.pool.query(
    'INSERT INTO refresh_tokens (id, user_id, token_hash, device_id, created_at, expires_at, revoked_at, replaced_by, ip, user_agent) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [refreshId, userRow.id, refreshTokenHash, deviceId, nowIso, expiresIso, null, null, ip, userAgent],
  );

  const secure = getCookieSecure(req);
  setCookie(res, ACCESS_COOKIE_NAME, accessToken, { path: '/', httpOnly: true, secure, sameSite: 'Lax', maxAgeSeconds: ACCESS_TOKEN_TTL_SEC });
  setCookie(res, REFRESH_COOKIE_NAME, refreshToken, { path: '/', httpOnly: true, secure, sameSite: 'Lax', maxAgeSeconds: REFRESH_TOKEN_TTL_SEC });
}

function getAdminPublic(adminRow) {
  return {
    adminId: adminRow.id,
    phone: adminRow.phone,
    createdAt: adminRow.created_at,
    lastLoginAt: adminRow.last_login_at ?? null,
    isSuperadmin: Boolean(adminRow.is_superadmin),
    isEnabled: adminRow.is_enabled !== 0,
    permissionScope: typeof adminRow.permission_scope === 'string' && adminRow.permission_scope ? adminRow.permission_scope : 'basic',
  };
}

async function issueTokensForAdmin(req, res, adminRow) {
  const deviceId = getOrCreateDeviceIdFor(req, res, ADMIN_DEVICE_COOKIE_NAME);
  const scope = 'admin';
  const accessToken = await signAccessToken({ user_id: adminRow.id, username: adminRow.phone, scope });

  const refreshToken = crypto.randomBytes(32).toString('base64url');
  const refreshTokenHash = sha256Hex(refreshToken);
  const nowIso = new Date().toISOString();
  const expiresIso = new Date(Date.now() + REFRESH_TOKEN_TTL_SEC * 1000).toISOString();
  const refreshId = uuidv4();
  const ip = typeof req?.socket?.remoteAddress === 'string' ? req.socket.remoteAddress : null;
  const userAgent = typeof req?.headers?.['user-agent'] === 'string' ? req.headers['user-agent'].slice(0, 255) : null;

  await state.pool.query(
    'INSERT INTO admin_refresh_tokens (id, admin_id, token_hash, device_id, created_at, expires_at, revoked_at, replaced_by, ip, user_agent) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [refreshId, adminRow.id, refreshTokenHash, deviceId, nowIso, expiresIso, null, null, ip, userAgent],
  );

  const secure = getCookieSecure(req);
  setCookie(res, ADMIN_ACCESS_COOKIE_NAME, accessToken, { path: '/', httpOnly: true, secure, sameSite: 'Lax', maxAgeSeconds: ACCESS_TOKEN_TTL_SEC });
  setCookie(res, ADMIN_REFRESH_COOKIE_NAME, refreshToken, { path: '/', httpOnly: true, secure, sameSite: 'Lax', maxAgeSeconds: REFRESH_TOKEN_TTL_SEC });
}

const state = {
  pool: null,
  dbReady: false,
  dbReadyMessage: '',
};

async function ensureDbReady() {
  if (state.dbReady && state.pool) return true;
  if (!state.pool) {
    state.pool = mysql.createPool({
      host: DB_HOST,
      port: DB_PORT,
      user: DB_USER,
      password: DB_PASSWORD,
      database: DB_NAME,
      waitForConnections: true,
      connectionLimit: 10,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
    });
  }

  try {
    async function ensureColumn(tableName, columnName, alterSql) {
      const [rows] = await state.pool.query(
        'SELECT COUNT(*) AS c FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = ?',
        [DB_NAME, tableName, columnName],
      );
      const count = Array.isArray(rows) && rows.length ? Number(rows[0]?.c || 0) : 0;
      if (count > 0) return;
      await state.pool.query(alterSql);
    }

    await state.pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(36) PRIMARY KEY,
        phone VARCHAR(20) NOT NULL UNIQUE,
        password_salt VARCHAR(64) NOT NULL,
        password_hash VARCHAR(128) NOT NULL,
        created_at VARCHAR(32) NOT NULL,
        is_enabled TINYINT(1) NOT NULL DEFAULT 1
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    await ensureColumn('users', 'is_enabled', 'ALTER TABLE users ADD COLUMN is_enabled TINYINT(1) NOT NULL DEFAULT 1').catch(() => {});

    await state.pool.query('CREATE INDEX idx_users_phone ON users(phone);').catch(() => {});

    await state.pool.query(`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        token_hash CHAR(64) NOT NULL UNIQUE,
        device_id VARCHAR(64) NOT NULL,
        created_at VARCHAR(32) NOT NULL,
        expires_at VARCHAR(32) NOT NULL,
        revoked_at VARCHAR(32) NULL,
        replaced_by VARCHAR(36) NULL,
        ip VARCHAR(64) NULL,
        user_agent VARCHAR(255) NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    await state.pool.query('CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);').catch(() => {});
    await state.pool.query('CREATE INDEX idx_refresh_tokens_device ON refresh_tokens(device_id);').catch(() => {});

    await state.pool.query(`
      CREATE TABLE IF NOT EXISTS admin_user (
        id VARCHAR(36) PRIMARY KEY,
        phone VARCHAR(20) NOT NULL UNIQUE,
        password_salt VARCHAR(64) NOT NULL,
        password_hash VARCHAR(128) NOT NULL,
        created_at VARCHAR(32) NOT NULL,
        last_login_at VARCHAR(32) NULL,
        is_superadmin TINYINT(1) NOT NULL DEFAULT 0,
        is_enabled TINYINT(1) NOT NULL DEFAULT 1,
        permission_scope VARCHAR(64) NOT NULL DEFAULT 'basic'
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    await ensureColumn('admin_user', 'is_enabled', 'ALTER TABLE admin_user ADD COLUMN is_enabled TINYINT(1) NOT NULL DEFAULT 1').catch(() => {});
    await ensureColumn('admin_user', 'permission_scope', 'ALTER TABLE admin_user ADD COLUMN permission_scope VARCHAR(64) NOT NULL DEFAULT \'basic\'').catch(() => {});
    await state.pool.query('CREATE INDEX idx_admin_user_phone ON admin_user(phone);').catch(() => {});

    await state.pool.query(`
      CREATE TABLE IF NOT EXISTS admin_refresh_tokens (
        id VARCHAR(36) PRIMARY KEY,
        admin_id VARCHAR(36) NOT NULL,
        token_hash CHAR(64) NOT NULL UNIQUE,
        device_id VARCHAR(64) NOT NULL,
        created_at VARCHAR(32) NOT NULL,
        expires_at VARCHAR(32) NOT NULL,
        revoked_at VARCHAR(32) NULL,
        replaced_by VARCHAR(36) NULL,
        ip VARCHAR(64) NULL,
        user_agent VARCHAR(255) NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    await state.pool.query('CREATE INDEX idx_admin_refresh_tokens_admin ON admin_refresh_tokens(admin_id);').catch(() => {});
    await state.pool.query('CREATE INDEX idx_admin_refresh_tokens_device ON admin_refresh_tokens(device_id);').catch(() => {});

    state.dbReady = true;
    state.dbReadyMessage = '';
    return true;
  } catch (e) {
    state.dbReady = false;
    state.dbReadyMessage = e?.message || 'db_init_failed';
    return false;
  }
}

async function resolveAdminFromRequest(req) {
  const cookies = parseCookies(req);
  const token = typeof cookies[ADMIN_ACCESS_COOKIE_NAME] === 'string' ? cookies[ADMIN_ACCESS_COOKIE_NAME] : '';
  if (!token) return { ok: false, statusCode: 401, code: 'UNAUTHORIZED', message: '未登录' };

  try {
    const payload = await verifyAccessToken(token);
    const scope = typeof payload.scope === 'string' ? payload.scope : '';
    if (scope !== 'admin') return { ok: false, statusCode: 401, code: 'UNAUTHORIZED', message: '未登录' };
    const adminId = typeof payload.user_id === 'string' ? payload.user_id : '';
    if (!adminId) return { ok: false, statusCode: 401, code: 'UNAUTHORIZED', message: '未登录' };

    const ok = await ensureDbReady();
    if (!ok) return { ok: false, statusCode: 503, code: 'DB_UNAVAILABLE', message: '数据库不可用' };

    const [rows] = await state.pool.query(
      'SELECT id, phone, created_at, last_login_at, is_superadmin, is_enabled, permission_scope FROM admin_user WHERE id = ? LIMIT 1',
      [adminId],
    );
    const admin = Array.isArray(rows) && rows.length ? rows[0] : null;
    if (!admin) return { ok: false, statusCode: 401, code: 'UNAUTHORIZED', message: '未登录' };
    if (admin.is_enabled === 0) return { ok: false, statusCode: 403, code: 'ACCOUNT_DISABLED', message: '管理员账号已停用' };

    return { ok: true, admin };
  } catch {
    return { ok: false, statusCode: 401, code: 'UNAUTHORIZED', message: '未登录' };
  }
}

async function main() {
  await ensureDbReady();

  const server = http.createServer(async (req, res) => {
    try {
      if (!req.url) return writeJson(req, res, 404, { success: false, message: 'not_found' });

      if (req.method === 'OPTIONS') {
        res.writeHead(204, getCorsHeaders(req));
        return res.end();
      }

      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const pathname = url.pathname;

      if (req.method === 'GET' && pathname === '/health') {
        const ok = await ensureDbReady();
        return writeJson(req, res, 200, { ok: true, db: ok ? 'ok' : 'unavailable', dbMessage: ok ? '' : state.dbReadyMessage });
      }

      if (req.method === 'POST' && pathname === '/api/auth/register') {
        const ok = await ensureDbReady();
        if (!ok) return writeJson(req, res, 503, { success: false, code: 'DB_UNAVAILABLE', message: '数据库不可用' });

        const body = await readJson(req);
        const phone = normalizePhone(body.phone);
        const password = body.password;

        if (!phone) return writeJson(req, res, 400, { success: false, code: 'PHONE_REQUIRED', message: '手机号不能为空' });
        if (!validateChinaMainlandMobile(phone)) {
          return writeJson(req, res, 400, { success: false, code: 'PHONE_INVALID', message: '手机号格式不正确（中国大陆 11 位）' });
        }
        if (!validatePassword(password)) {
          return writeJson(req, res, 400, { success: false, code: 'PASSWORD_INVALID', message: '密码至少 6 位，任意字符均可' });
        }

        const [rows] = await state.pool.query('SELECT id, phone, created_at FROM users WHERE phone = ? LIMIT 1', [phone]);
        const existed = Array.isArray(rows) && rows.length ? rows[0] : null;
        if (existed && existed.id) {
          return writeJson(req, res, 409, { success: false, code: 'PHONE_EXISTS', message: '已注册' });
        }

        const id = uuidv4();
        const createdAt = new Date().toISOString();
        const salt = crypto.randomBytes(16).toString('base64');
        const hash = pbkdf2Hash(password, salt);

        await state.pool.query(
          'INSERT INTO users (id, phone, password_salt, password_hash, created_at) VALUES (?,?,?,?,?)',
          [id, phone, salt, hash, createdAt],
        );

        await issueTokensForUser(req, res, { id, phone, created_at: createdAt });
        return writeJson(req, res, 200, { success: true, user: { userId: id, phone, registeredAt: createdAt } });
      }

      if (req.method === 'POST' && pathname === '/api/auth/login') {
        const ok = await ensureDbReady();
        if (!ok) return writeJson(req, res, 503, { success: false, code: 'DB_UNAVAILABLE', message: '数据库不可用' });

        const body = await readJson(req);
        const phone = normalizePhone(body.phone);
        const password = body.password;

        if (!phone) return writeJson(req, res, 400, { success: false, code: 'PHONE_REQUIRED', message: '手机号不能为空' });
        if (!validateChinaMainlandMobile(phone)) {
          return writeJson(req, res, 400, { success: false, code: 'PHONE_INVALID', message: '手机号格式不正确（中国大陆 11 位）' });
        }
        if (typeof password !== 'string') return writeJson(req, res, 400, { success: false, code: 'PASSWORD_REQUIRED', message: '密码不能为空' });

        const [rows] = await state.pool.query(
          'SELECT id, phone, password_salt, password_hash, created_at, is_enabled FROM users WHERE phone = ? LIMIT 1',
          [phone],
        );
        const user = Array.isArray(rows) && rows.length ? rows[0] : null;
        if (!user) return writeJson(req, res, 401, { success: false, code: 'INVALID_CREDENTIALS', message: '手机号或密码错误' });
        if (user.is_enabled === 0) return writeJson(req, res, 403, { success: false, code: 'ACCOUNT_DISABLED', message: '账号已停用' });

        const computed = pbkdf2Hash(password, user.password_salt);
        if (computed !== user.password_hash) {
          return writeJson(req, res, 401, { success: false, code: 'INVALID_CREDENTIALS', message: '手机号或密码错误' });
        }

        await issueTokensForUser(req, res, user);
        return writeJson(req, res, 200, { success: true, user: getUserPublic(user) });
      }

      if (req.method === 'POST' && pathname === '/api/admin/auth/login') {
        const ok = await ensureDbReady();
        if (!ok) return writeJson(req, res, 503, { success: false, code: 'DB_UNAVAILABLE', message: '数据库不可用' });

        const body = await readJson(req);
        const phone = normalizePhone(body.phone);
        const password = body.password;

        if (!phone) return writeJson(req, res, 400, { success: false, code: 'PHONE_REQUIRED', message: '手机号不能为空' });
        if (!validateChinaMainlandMobile(phone)) {
          return writeJson(req, res, 400, { success: false, code: 'PHONE_INVALID', message: '手机号格式不正确（中国大陆 11 位）' });
        }
        if (typeof password !== 'string') return writeJson(req, res, 400, { success: false, code: 'PASSWORD_REQUIRED', message: '密码不能为空' });

        const [rows] = await state.pool.query(
          'SELECT id, phone, password_salt, password_hash, created_at, last_login_at, is_superadmin, is_enabled, permission_scope FROM admin_user WHERE phone = ? LIMIT 1',
          [phone],
        );
        const admin = Array.isArray(rows) && rows.length ? rows[0] : null;
        if (!admin) return writeJson(req, res, 401, { success: false, code: 'INVALID_CREDENTIALS', message: '手机号或密码错误' });
        if (admin.is_enabled === 0) return writeJson(req, res, 403, { success: false, code: 'ACCOUNT_DISABLED', message: '管理员账号已停用' });

        const computed = pbkdf2Hash(password, admin.password_salt);
        if (computed !== admin.password_hash) {
          return writeJson(req, res, 401, { success: false, code: 'INVALID_CREDENTIALS', message: '手机号或密码错误' });
        }

        const nowIso = new Date().toISOString();
        await state.pool.query('UPDATE admin_user SET last_login_at = ? WHERE id = ?', [nowIso, admin.id]);
        const mergedAdmin = { ...admin, last_login_at: nowIso };

        await issueTokensForAdmin(req, res, mergedAdmin);
        return writeJson(req, res, 200, { success: true, admin: getAdminPublic(mergedAdmin) });
      }

      if (req.method === 'POST' && pathname === '/api/auth/refresh') {
        const ok = await ensureDbReady();
        if (!ok) return writeJson(req, res, 503, { success: false, code: 'DB_UNAVAILABLE', message: '数据库不可用' });

        const cookies = parseCookies(req);
        const rawRefresh = typeof cookies[REFRESH_COOKIE_NAME] === 'string' ? cookies[REFRESH_COOKIE_NAME] : '';
        const deviceId = typeof cookies[DEVICE_COOKIE_NAME] === 'string' ? cookies[DEVICE_COOKIE_NAME] : '';
        if (!rawRefresh) return writeJson(req, res, 401, { success: false, code: 'REFRESH_REQUIRED', message: '未登录' });
        if (!deviceId) return writeJson(req, res, 401, { success: false, code: 'DEVICE_REQUIRED', message: '未登录' });

        const tokenHash = sha256Hex(rawRefresh);
        const [rows] = await state.pool.query(
          'SELECT id, user_id, device_id, expires_at, revoked_at FROM refresh_tokens WHERE token_hash = ? LIMIT 1',
          [tokenHash],
        );
        const rt = Array.isArray(rows) && rows.length ? rows[0] : null;
        if (!rt) return writeJson(req, res, 401, { success: false, code: 'REFRESH_INVALID', message: '未登录' });
        if (rt.device_id !== deviceId) return writeJson(req, res, 401, { success: false, code: 'REFRESH_INVALID', message: '未登录' });
        if (rt.revoked_at) return writeJson(req, res, 401, { success: false, code: 'REFRESH_REVOKED', message: '未登录' });
        if (typeof rt.expires_at === 'string' && Date.parse(rt.expires_at) <= Date.now()) {
          return writeJson(req, res, 401, { success: false, code: 'REFRESH_EXPIRED', message: '未登录' });
        }

        const [userRows] = await state.pool.query('SELECT id, phone, created_at, is_enabled FROM users WHERE id = ? LIMIT 1', [rt.user_id]);
        const user = Array.isArray(userRows) && userRows.length ? userRows[0] : null;
        if (!user) return writeJson(req, res, 401, { success: false, code: 'REFRESH_INVALID', message: '未登录' });
        if (user.is_enabled === 0) return writeJson(req, res, 403, { success: false, code: 'ACCOUNT_DISABLED', message: '账号已停用' });

        const nextRefresh = crypto.randomBytes(32).toString('base64url');
        const nextHash = sha256Hex(nextRefresh);
        const nowIso = new Date().toISOString();
        const expiresIso = new Date(Date.now() + REFRESH_TOKEN_TTL_SEC * 1000).toISOString();
        const nextId = uuidv4();
        const ip = typeof req?.socket?.remoteAddress === 'string' ? req.socket.remoteAddress : null;
        const userAgent = typeof req?.headers?.['user-agent'] === 'string' ? req.headers['user-agent'].slice(0, 255) : null;

        await state.pool.query(
          'UPDATE refresh_tokens SET revoked_at = ?, replaced_by = ? WHERE id = ? AND revoked_at IS NULL',
          [nowIso, nextId, rt.id],
        );
        await state.pool.query(
          'INSERT INTO refresh_tokens (id, user_id, token_hash, device_id, created_at, expires_at, revoked_at, replaced_by, ip, user_agent) VALUES (?,?,?,?,?,?,?,?,?,?)',
          [nextId, user.id, nextHash, deviceId, nowIso, expiresIso, null, null, ip, userAgent],
        );

        const accessToken = await signAccessToken({ user_id: user.id, username: user.phone, scope: 'user' });
        const secure = getCookieSecure(req);
        setCookie(res, ACCESS_COOKIE_NAME, accessToken, { path: '/', httpOnly: true, secure, sameSite: 'Lax', maxAgeSeconds: ACCESS_TOKEN_TTL_SEC });
        setCookie(res, REFRESH_COOKIE_NAME, nextRefresh, { path: '/', httpOnly: true, secure, sameSite: 'Lax', maxAgeSeconds: REFRESH_TOKEN_TTL_SEC });

        return writeJson(req, res, 200, { success: true });
      }

      if (req.method === 'POST' && pathname === '/api/admin/auth/refresh') {
        const ok = await ensureDbReady();
        if (!ok) return writeJson(req, res, 503, { success: false, code: 'DB_UNAVAILABLE', message: '数据库不可用' });

        const cookies = parseCookies(req);
        const rawRefresh = typeof cookies[ADMIN_REFRESH_COOKIE_NAME] === 'string' ? cookies[ADMIN_REFRESH_COOKIE_NAME] : '';
        const deviceId = typeof cookies[ADMIN_DEVICE_COOKIE_NAME] === 'string' ? cookies[ADMIN_DEVICE_COOKIE_NAME] : '';
        if (!rawRefresh) return writeJson(req, res, 401, { success: false, code: 'REFRESH_REQUIRED', message: '未登录' });
        if (!deviceId) return writeJson(req, res, 401, { success: false, code: 'DEVICE_REQUIRED', message: '未登录' });

        const tokenHash = sha256Hex(rawRefresh);
        const [rows] = await state.pool.query(
          'SELECT id, admin_id, device_id, expires_at, revoked_at FROM admin_refresh_tokens WHERE token_hash = ? LIMIT 1',
          [tokenHash],
        );
        const rt = Array.isArray(rows) && rows.length ? rows[0] : null;
        if (!rt) return writeJson(req, res, 401, { success: false, code: 'REFRESH_INVALID', message: '未登录' });
        if (rt.device_id !== deviceId) return writeJson(req, res, 401, { success: false, code: 'REFRESH_INVALID', message: '未登录' });
        if (rt.revoked_at) return writeJson(req, res, 401, { success: false, code: 'REFRESH_REVOKED', message: '未登录' });
        if (typeof rt.expires_at === 'string' && Date.parse(rt.expires_at) <= Date.now()) {
          return writeJson(req, res, 401, { success: false, code: 'REFRESH_EXPIRED', message: '未登录' });
        }

        const [adminRows] = await state.pool.query(
          'SELECT id, phone, created_at, last_login_at, is_superadmin, is_enabled, permission_scope FROM admin_user WHERE id = ? LIMIT 1',
          [rt.admin_id],
        );
        const admin = Array.isArray(adminRows) && adminRows.length ? adminRows[0] : null;
        if (!admin) return writeJson(req, res, 401, { success: false, code: 'REFRESH_INVALID', message: '未登录' });
        if (admin.is_enabled === 0) return writeJson(req, res, 403, { success: false, code: 'ACCOUNT_DISABLED', message: '管理员账号已停用' });

        const nextRefresh = crypto.randomBytes(32).toString('base64url');
        const nextHash = sha256Hex(nextRefresh);
        const nowIso = new Date().toISOString();
        const expiresIso = new Date(Date.now() + REFRESH_TOKEN_TTL_SEC * 1000).toISOString();
        const nextId = uuidv4();
        const ip = typeof req?.socket?.remoteAddress === 'string' ? req.socket.remoteAddress : null;
        const userAgent = typeof req?.headers?.['user-agent'] === 'string' ? req.headers['user-agent'].slice(0, 255) : null;

        await state.pool.query(
          'UPDATE admin_refresh_tokens SET revoked_at = ?, replaced_by = ? WHERE id = ? AND revoked_at IS NULL',
          [nowIso, nextId, rt.id],
        );
        await state.pool.query(
          'INSERT INTO admin_refresh_tokens (id, admin_id, token_hash, device_id, created_at, expires_at, revoked_at, replaced_by, ip, user_agent) VALUES (?,?,?,?,?,?,?,?,?,?)',
          [nextId, admin.id, nextHash, deviceId, nowIso, expiresIso, null, null, ip, userAgent],
        );

        const accessToken = await signAccessToken({ user_id: admin.id, username: admin.phone, scope: 'admin' });
        const secure = getCookieSecure(req);
        setCookie(res, ADMIN_ACCESS_COOKIE_NAME, accessToken, { path: '/', httpOnly: true, secure, sameSite: 'Lax', maxAgeSeconds: ACCESS_TOKEN_TTL_SEC });
        setCookie(res, ADMIN_REFRESH_COOKIE_NAME, nextRefresh, { path: '/', httpOnly: true, secure, sameSite: 'Lax', maxAgeSeconds: REFRESH_TOKEN_TTL_SEC });

        return writeJson(req, res, 200, { success: true });
      }

      if (req.method === 'POST' && pathname === '/api/auth/logout') {
        const ok = await ensureDbReady();
        if (!ok) return writeJson(req, res, 503, { success: false, code: 'DB_UNAVAILABLE', message: '数据库不可用' });

        const cookies = parseCookies(req);
        const rawRefresh = typeof cookies[REFRESH_COOKIE_NAME] === 'string' ? cookies[REFRESH_COOKIE_NAME] : '';
        if (rawRefresh) {
          const tokenHash = sha256Hex(rawRefresh);
          const nowIso = new Date().toISOString();
          await state.pool.query('UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL', [nowIso, tokenHash]);
        }

        clearCookie(res, ACCESS_COOKIE_NAME);
        clearCookie(res, REFRESH_COOKIE_NAME);
        return writeJson(req, res, 200, { success: true });
      }

      if (req.method === 'POST' && pathname === '/api/admin/auth/logout') {
        const ok = await ensureDbReady();
        if (!ok) return writeJson(req, res, 503, { success: false, code: 'DB_UNAVAILABLE', message: '数据库不可用' });

        const cookies = parseCookies(req);
        const rawRefresh = typeof cookies[ADMIN_REFRESH_COOKIE_NAME] === 'string' ? cookies[ADMIN_REFRESH_COOKIE_NAME] : '';
        if (rawRefresh) {
          const tokenHash = sha256Hex(rawRefresh);
          const nowIso = new Date().toISOString();
          await state.pool.query('UPDATE admin_refresh_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL', [nowIso, tokenHash]);
        }

        clearCookie(res, ADMIN_ACCESS_COOKIE_NAME);
        clearCookie(res, ADMIN_REFRESH_COOKIE_NAME);
        return writeJson(req, res, 200, { success: true });
      }

      if (req.method === 'GET' && pathname === '/api/auth/me') {
        const cookies = parseCookies(req);
        const token = typeof cookies[ACCESS_COOKIE_NAME] === 'string' ? cookies[ACCESS_COOKIE_NAME] : '';
        if (!token) return writeJson(req, res, 401, { success: false, code: 'UNAUTHORIZED', message: '未登录' });

        try {
          const payload = await verifyAccessToken(token);
          const userId = typeof payload.user_id === 'string' ? payload.user_id : '';
          if (!userId) return writeJson(req, res, 401, { success: false, code: 'UNAUTHORIZED', message: '未登录' });

          const ok = await ensureDbReady();
          if (!ok) return writeJson(req, res, 503, { success: false, code: 'DB_UNAVAILABLE', message: '数据库不可用' });

          const [rows] = await state.pool.query('SELECT id, phone, created_at, is_enabled FROM users WHERE id = ? LIMIT 1', [userId]);
          const user = Array.isArray(rows) && rows.length ? rows[0] : null;
          if (!user) return writeJson(req, res, 401, { success: false, code: 'UNAUTHORIZED', message: '未登录' });
          if (user.is_enabled === 0) return writeJson(req, res, 403, { success: false, code: 'ACCOUNT_DISABLED', message: '账号已停用' });

          return writeJson(req, res, 200, { success: true, user: getUserPublic(user) });
        } catch {
          return writeJson(req, res, 401, { success: false, code: 'UNAUTHORIZED', message: '未登录' });
        }
      }

      if (req.method === 'GET' && pathname === '/api/admin/auth/me') {
        const cookies = parseCookies(req);
        const token = typeof cookies[ADMIN_ACCESS_COOKIE_NAME] === 'string' ? cookies[ADMIN_ACCESS_COOKIE_NAME] : '';
        if (!token) return writeJson(req, res, 401, { success: false, code: 'UNAUTHORIZED', message: '未登录' });

        try {
          const payload = await verifyAccessToken(token);
          const scope = typeof payload.scope === 'string' ? payload.scope : '';
          if (scope !== 'admin') return writeJson(req, res, 401, { success: false, code: 'UNAUTHORIZED', message: '未登录' });
          const adminId = typeof payload.user_id === 'string' ? payload.user_id : '';
          if (!adminId) return writeJson(req, res, 401, { success: false, code: 'UNAUTHORIZED', message: '未登录' });

          const ok = await ensureDbReady();
          if (!ok) return writeJson(req, res, 503, { success: false, code: 'DB_UNAVAILABLE', message: '数据库不可用' });

          const [rows] = await state.pool.query(
            'SELECT id, phone, created_at, last_login_at, is_superadmin, is_enabled, permission_scope FROM admin_user WHERE id = ? LIMIT 1',
            [adminId],
          );
          const admin = Array.isArray(rows) && rows.length ? rows[0] : null;
          if (!admin) return writeJson(req, res, 401, { success: false, code: 'UNAUTHORIZED', message: '未登录' });
          if (admin.is_enabled === 0) return writeJson(req, res, 403, { success: false, code: 'ACCOUNT_DISABLED', message: '管理员账号已停用' });

          return writeJson(req, res, 200, { success: true, admin: getAdminPublic(admin) });
        } catch {
          return writeJson(req, res, 401, { success: false, code: 'UNAUTHORIZED', message: '未登录' });
        }
      }

      if (req.method === 'GET' && pathname === '/api/users') {
        const ok = await ensureDbReady();
        if (!ok) return writeJson(req, res, 503, { success: false, code: 'DB_UNAVAILABLE', message: '数据库不可用' });

        const [rows] = await state.pool.query('SELECT id, phone, created_at, is_enabled FROM users ORDER BY created_at DESC');
        const users = Array.isArray(rows)
          ? rows.map((r) => ({ userId: r.id, phone: r.phone, registeredAt: r.created_at, isEnabled: r.is_enabled !== 0 }))
          : [];
        return writeJson(req, res, 200, { success: true, users });
      }

      if (req.method === 'GET' && pathname === '/api/admin/users') {
        const auth = await resolveAdminFromRequest(req);
        if (!auth.ok) return writeJson(req, res, auth.statusCode, { success: false, code: auth.code, message: auth.message });

        const pageRaw = url.searchParams.get('page') || '1';
        const pageSizeRaw = url.searchParams.get('pageSize') || '20';
        const page = Math.max(1, Number.parseInt(pageRaw, 10) || 1);
        const pageSize = Math.min(100, Math.max(1, Number.parseInt(pageSizeRaw, 10) || 20));
        const offset = (page - 1) * pageSize;

        const totalRows = await state.pool.query('SELECT COUNT(*) AS total FROM users');
        const total = Array.isArray(totalRows?.[0]) && totalRows[0].length ? Number(totalRows[0][0]?.total || 0) : 0;

        const [rows] = await state.pool.query(
          'SELECT id, phone, created_at, is_enabled FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?',
          [pageSize, offset],
        );
        const users = Array.isArray(rows)
          ? rows.map((r) => ({ userId: r.id, phone: r.phone, registeredAt: r.created_at, isEnabled: r.is_enabled !== 0 }))
          : [];
        return writeJson(req, res, 200, { success: true, users, page, pageSize, total });
      }

      if (req.method === 'POST' && pathname === '/api/admin/users/status') {
        const auth = await resolveAdminFromRequest(req);
        if (!auth.ok) return writeJson(req, res, auth.statusCode, { success: false, code: auth.code, message: auth.message });

        const body = await readJson(req);
        const userId = typeof body?.userId === 'string' ? body.userId : '';
        const isEnabled = Boolean(body?.isEnabled);
        if (!userId) return writeJson(req, res, 400, { success: false, code: 'USER_ID_REQUIRED', message: '缺少用户ID' });

        await state.pool.query('UPDATE users SET is_enabled = ? WHERE id = ?', [isEnabled ? 1 : 0, userId]);
        return writeJson(req, res, 200, { success: true });
      }

      if (req.method === 'GET' && pathname === '/api/admin/admin-users') {
        const auth = await resolveAdminFromRequest(req);
        if (!auth.ok) return writeJson(req, res, auth.statusCode, { success: false, code: auth.code, message: auth.message });

        const [rows] = await state.pool.query('SELECT id, phone, created_at, last_login_at, is_superadmin, is_enabled, permission_scope FROM admin_user ORDER BY created_at DESC');
        const admins = Array.isArray(rows) ? rows.map((r) => getAdminPublic(r)) : [];
        return writeJson(req, res, 200, { success: true, admins });
      }

      if (req.method === 'POST' && pathname === '/api/admin/admin-users/status') {
        const auth = await resolveAdminFromRequest(req);
        if (!auth.ok) return writeJson(req, res, auth.statusCode, { success: false, code: auth.code, message: auth.message });
        if (!auth.admin?.is_superadmin) return writeJson(req, res, 403, { success: false, code: 'FORBIDDEN', message: '仅超管可操作管理员状态' });

        const body = await readJson(req);
        const adminId = typeof body?.adminId === 'string' ? body.adminId : '';
        const isEnabled = Boolean(body?.isEnabled);
        if (!adminId) return writeJson(req, res, 400, { success: false, code: 'ADMIN_ID_REQUIRED', message: '缺少管理员ID' });
        if (adminId === auth.admin.id && !isEnabled) return writeJson(req, res, 400, { success: false, code: 'SELF_DISABLE_FORBIDDEN', message: '不能停用自己' });

        await state.pool.query('UPDATE admin_user SET is_enabled = ? WHERE id = ?', [isEnabled ? 1 : 0, adminId]);
        return writeJson(req, res, 200, { success: true });
      }

      if (req.method === 'POST' && pathname === '/api/admin/admin-users/permission') {
        const auth = await resolveAdminFromRequest(req);
        if (!auth.ok) return writeJson(req, res, auth.statusCode, { success: false, code: auth.code, message: auth.message });
        if (!auth.admin?.is_superadmin) return writeJson(req, res, 403, { success: false, code: 'FORBIDDEN', message: '仅超管可设置管理员权限' });

        const body = await readJson(req);
        const adminId = typeof body?.adminId === 'string' ? body.adminId : '';
        const permissionScope = typeof body?.permissionScope === 'string' ? body.permissionScope.trim() : '';
        const isSuperadmin = typeof body?.isSuperadmin === 'boolean' ? body.isSuperadmin : undefined;
        if (!adminId) return writeJson(req, res, 400, { success: false, code: 'ADMIN_ID_REQUIRED', message: '缺少管理员ID' });
        if (!permissionScope) return writeJson(req, res, 400, { success: false, code: 'PERMISSION_SCOPE_REQUIRED', message: '缺少权限范围' });

        await state.pool.query(
          'UPDATE admin_user SET permission_scope = ?, is_superadmin = COALESCE(?, is_superadmin) WHERE id = ?',
          [permissionScope, typeof isSuperadmin === 'boolean' ? (isSuperadmin ? 1 : 0) : null, adminId],
        );
        return writeJson(req, res, 200, { success: true });
      }

      return writeJson(req, res, 404, { success: false, message: 'not_found' });
    } catch (e) {
      return writeJson(req, res, 500, { success: false, message: e?.message || 'server_error' });
    }
  });

  server.listen(PORT, () => {
    process.stdout.write(`API Server listening on http://localhost:${PORT}\n`);
  });

  function shutdown() {
    try {
      if (state.pool) state.pool.end();
    } catch { }
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  process.stderr.write(`${e?.message || 'boot_failed'}\n`);
  process.exit(1);
});
