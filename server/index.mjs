import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';

import { SignJWT, jwtVerify } from 'jose';
import mysql from 'mysql2/promise';
import { v4 as uuidv4 } from 'uuid';

function loadDotEnvIfPresent(filePath) {
  try {
    if (!fs.existsSync(filePath)) return;
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx < 0) continue;
      const key = trimmed.slice(0, idx).trim();
      if (!key) continue;
      if (Object.prototype.hasOwnProperty.call(process.env, key)) continue;
      let value = trimmed.slice(idx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
        (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch {}
}

const envRoot = process.cwd();
loadDotEnvIfPresent(path.join(envRoot, '.env.local'));
loadDotEnvIfPresent(path.join(envRoot, '.env'));

const PORT = Number(process.env.PORT || 32123);
const DB_HOST = process.env.DB_HOST || '127.0.0.1';
const DB_PORT = Number(process.env.DB_PORT || 3306);
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const DB_NAME = process.env.DB_NAME || 'from_zero_start';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret-change-me';
const ACCESS_TOKEN_TTL_SEC = Number(process.env.ACCESS_TOKEN_TTL_SEC || 60 * 60);
const REFRESH_TOKEN_TTL_SEC = Number(process.env.REFRESH_TOKEN_TTL_SEC || 7 * 24 * 60 * 60);
const COOKIE_SECURE = String(process.env.COOKIE_SECURE || '').toLowerCase() === 'true';
const TRIPARTITE_BASE_URL = process.env.TRIPARTITE_BASE_URL || 'http://tr.yeyeku.com/gs_tripartite_web/openapi/service';
const TRIPARTITE_CLIENT_ID = process.env.TRIPARTITE_CLIENT_ID || '100134';
const TRIPARTITE_SIGN_TYPE = process.env.TRIPARTITE_SIGN_TYPE || 'RSA2';
const TRIPARTITE_RSA_PRIVATE_KEY = process.env.TRIPARTITE_RSA_PRIVATE_KEY || '';
const TRIPARTITE_RSA_PRIVATE_KEY_FILE = process.env.TRIPARTITE_RSA_PRIVATE_KEY_FILE || '';
const TRIPARTITE_PLATFORM_PUBLIC_KEY = process.env.TRIPARTITE_PLATFORM_PUBLIC_KEY || '';
const TRIPARTITE_PLATFORM_PUBLIC_KEY_FILE = process.env.TRIPARTITE_PLATFORM_PUBLIC_KEY_FILE || '';
const ACCESS_COOKIE_NAME = 'ax_access';
const REFRESH_COOKIE_NAME = 'ax_refresh';
const DEVICE_COOKIE_NAME = 'ax_device';
const ADMIN_ACCESS_COOKIE_NAME = 'ax_admin_access';
const ADMIN_REFRESH_COOKIE_NAME = 'ax_admin_refresh';
const ADMIN_DEVICE_COOKIE_NAME = 'ax_admin_device';

function readSecretFromEnvOrFile(directValue, filePath) {
  if (typeof directValue === 'string' && directValue.trim()) return directValue.trim();
  if (typeof filePath !== 'string' || !filePath.trim()) return '';
  try {
    return fs.readFileSync(filePath.trim(), 'utf8').trim();
  } catch {
    return '';
  }
}

const TRIPARTITE_RSA_PRIVATE_KEY_RAW = readSecretFromEnvOrFile(TRIPARTITE_RSA_PRIVATE_KEY, TRIPARTITE_RSA_PRIVATE_KEY_FILE);
const TRIPARTITE_PLATFORM_PUBLIC_KEY_RAW = readSecretFromEnvOrFile(TRIPARTITE_PLATFORM_PUBLIC_KEY, TRIPARTITE_PLATFORM_PUBLIC_KEY_FILE);

function normalizePkcs8PrivateKey(privateKey) {
  if (typeof privateKey !== 'string') return null;
  const trimmed = privateKey.trim();
  if (!trimmed) return null;

  if (/BEGIN (RSA )?PRIVATE KEY/.test(trimmed)) {
    return crypto.createPrivateKey({ key: trimmed });
  }

  const base64 = trimmed.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/=]+$/.test(base64)) return null;
  try {
    return crypto.createPrivateKey({ key: Buffer.from(base64, 'base64'), format: 'der', type: 'pkcs8' });
  } catch {
    const wrapped = `-----BEGIN PRIVATE KEY-----\n${base64.match(/.{1,64}/g)?.join('\n') || base64}\n-----END PRIVATE KEY-----`;
    return crypto.createPrivateKey({ key: wrapped });
  }
}

function buildSortedQueryString(params) {
  const keys = Object.keys(params).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return keys.map((k) => `${k}=${String(params[k])}`).join('&');
}

function rsaSha256SignBase64(payload, privateKeyObject) {
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(payload, 'utf8');
  signer.end();
  return signer.sign(privateKeyObject).toString('base64');
}

function isSafeServicePath(value) {
  if (typeof value !== 'string') return false;
  const normalized = value.trim();
  if (!normalized) return false;
  if (normalized.startsWith('http://') || normalized.startsWith('https://')) return false;
  if (normalized.startsWith('/')) return false;
  if (normalized.includes('..')) return false;
  return /^[A-Za-z0-9/_-]+$/.test(normalized);
}

function httpRequestJson(urlString, body, timeoutMs = 12_000) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const rawBody = JSON.stringify(body);

    const req = (url.protocol === 'https:' ? https : http).request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        method: 'POST',
        path: `${url.pathname}${url.search}`,
        headers: {
          'Content-Type': 'application/json;charset=utf-8',
          'Content-Length': Buffer.byteLength(rawBody),
        },
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          const statusCode = res.statusCode || 0;
          const contentType = String(res.headers['content-type'] || '').toLowerCase();
          if (contentType.includes('application/json')) {
            try {
              resolve({ statusCode, data: data ? JSON.parse(data) : {} });
              return;
            } catch {
              resolve({ statusCode, data: { raw: data } });
              return;
            }
          }
          try {
            resolve({ statusCode, data: data ? JSON.parse(data) : {} });
          } catch {
            resolve({ statusCode, data: { raw: data } });
          }
        });
      },
    );

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('upstream_timeout')));
    req.write(rawBody);
    req.end();
  });
}

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

    await state.pool.query(`
      CREATE TABLE IF NOT EXISTS product_service_types (
        id VARCHAR(36) PRIMARY KEY,
        name VARCHAR(64) NOT NULL,
        wbs_code VARCHAR(64) NULL,
        created_at VARCHAR(32) NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    await ensureColumn('product_service_types', 'wbs_code', 'ALTER TABLE product_service_types ADD COLUMN wbs_code VARCHAR(64) NULL').catch(() => {});
    await state.pool.query('CREATE UNIQUE INDEX idx_product_service_types_name ON product_service_types(name);').catch(() => {});

    await state.pool.query(`
      CREATE TABLE IF NOT EXISTS product_services (
        id VARCHAR(36) PRIMARY KEY,
        type_id VARCHAR(36) NULL,
        name VARCHAR(128) NOT NULL,
        wbs_code VARCHAR(64) NOT NULL,
        description TEXT NULL,
        reference_weeks INT NOT NULL DEFAULT 0,
        owner_text VARCHAR(128) NULL,
        is_enabled TINYINT(1) NOT NULL DEFAULT 1,
        sort_order INT NOT NULL DEFAULT 0,
        created_at VARCHAR(32) NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    await ensureColumn('product_services', 'wbs_code', 'ALTER TABLE product_services ADD COLUMN wbs_code VARCHAR(64) NULL').catch(() => {});
    await ensureColumn('product_services', 'description', 'ALTER TABLE product_services ADD COLUMN description TEXT NULL').catch(() => {});
    await ensureColumn('product_services', 'reference_weeks', 'ALTER TABLE product_services ADD COLUMN reference_weeks INT NOT NULL DEFAULT 0').catch(() => {});
    await ensureColumn('product_services', 'owner_text', 'ALTER TABLE product_services ADD COLUMN owner_text VARCHAR(128) NULL').catch(() => {});
    await ensureColumn('product_services', 'is_enabled', 'ALTER TABLE product_services ADD COLUMN is_enabled TINYINT(1) NOT NULL DEFAULT 1').catch(() => {});
    await ensureColumn('product_services', 'sort_order', 'ALTER TABLE product_services ADD COLUMN sort_order INT NOT NULL DEFAULT 0').catch(() => {});
    await state.pool.query('CREATE INDEX idx_product_services_type ON product_services(type_id);').catch(() => {});
    await state.pool.query('CREATE INDEX idx_product_services_sort_order ON product_services(sort_order);').catch(() => {});
    await state.pool.query('CREATE UNIQUE INDEX idx_product_services_name ON product_services(name);').catch(() => {});
    await state.pool.query('CREATE UNIQUE INDEX idx_product_services_wbs_code ON product_services(wbs_code);').catch(() => {});

    await state.pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        company_key_no VARCHAR(64) NOT NULL,
        company_name VARCHAR(256) NOT NULL,
        company_status VARCHAR(32) NULL,
        credit_code VARCHAR(64) NULL,
        reg_no VARCHAR(64) NULL,
        oper_name VARCHAR(128) NULL,
        address VARCHAR(512) NULL,
        start_date VARCHAR(32) NULL,
        source VARCHAR(64) NOT NULL DEFAULT 'tripartite_company_search',
        source_order_number VARCHAR(64) NULL,
        created_at VARCHAR(32) NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    await state.pool.query('CREATE INDEX idx_orders_user ON orders(user_id);').catch(() => {});
    await state.pool.query('CREATE INDEX idx_orders_company_key_no ON orders(company_key_no);').catch(() => {});

    await state.pool.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        company_key_no VARCHAR(64) NOT NULL,
        company_name VARCHAR(256) NOT NULL,
        company_status VARCHAR(32) NULL,
        credit_code VARCHAR(64) NULL,
        reg_no VARCHAR(64) NULL,
        oper_name VARCHAR(128) NULL,
        address VARCHAR(512) NULL,
        start_date VARCHAR(32) NULL,
        active_followup_count INT NOT NULL DEFAULT 0,
        active_project_count INT NOT NULL DEFAULT 0,
        signing_project_count INT NOT NULL DEFAULT 0,
        source VARCHAR(64) NOT NULL DEFAULT 'tripartite_company_search',
        source_order_number VARCHAR(64) NULL,
        created_at VARCHAR(32) NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    await ensureColumn('customers', 'active_followup_count', 'ALTER TABLE customers ADD COLUMN active_followup_count INT NOT NULL DEFAULT 0').catch(() => {});
    await ensureColumn('customers', 'active_project_count', 'ALTER TABLE customers ADD COLUMN active_project_count INT NOT NULL DEFAULT 0').catch(() => {});
    await ensureColumn('customers', 'signing_project_count', 'ALTER TABLE customers ADD COLUMN signing_project_count INT NOT NULL DEFAULT 0').catch(() => {});
    await state.pool.query('CREATE INDEX idx_customers_user ON customers(user_id);').catch(() => {});
    await state.pool.query('CREATE INDEX idx_customers_company_key_no ON customers(company_key_no);').catch(() => {});
    await state.pool.query('ALTER TABLE customers DROP INDEX idx_customers_user_company;').catch(() => {});
    await state.pool.query('CREATE UNIQUE INDEX idx_customers_user_name ON customers(user_id, company_name);').catch(() => {});
    await ensureColumn('customers', 'is_deleted', 'ALTER TABLE customers ADD COLUMN is_deleted TINYINT(1) NOT NULL DEFAULT 0').catch(() => {});

    await state.pool.query(`
      INSERT IGNORE INTO customers (
        id, user_id, company_key_no, company_name, company_status, credit_code, reg_no, oper_name, address, start_date, source, source_order_number, created_at,
        active_followup_count, active_project_count, signing_project_count
      )
      SELECT
        id, user_id, company_key_no, company_name, company_status, credit_code, reg_no, oper_name, address, start_date, source, source_order_number, created_at,
        0, 0, 0
      FROM orders
      ORDER BY created_at DESC
    `).catch(() => {});

    await state.pool.query(`
      CREATE TABLE IF NOT EXISTS platform_settings (
        setting_key VARCHAR(64) PRIMARY KEY,
        setting_value TEXT NOT NULL,
        updated_at VARCHAR(32) NOT NULL,
        updated_by_admin_id VARCHAR(36) NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    await state.pool.query(
      'INSERT IGNORE INTO platform_settings (setting_key, setting_value, updated_at, updated_by_admin_id) VALUES (?,?,?,?)',
      ['user_registration_enabled', 'true', new Date().toISOString(), null],
    ).catch(() => {});

    state.dbReady = true;
    state.dbReadyMessage = '';
    return true;
  } catch (e) {
    state.dbReady = false;
    state.dbReadyMessage = e?.message || 'db_init_failed';
    return false;
  }
}

async function getPlatformSettingString(settingKey) {
  const ok = await ensureDbReady();
  if (!ok) return '';
  const [rows] = await state.pool.query('SELECT setting_value FROM platform_settings WHERE setting_key = ? LIMIT 1', [settingKey]);
  const row = Array.isArray(rows) && rows.length ? rows[0] : null;
  return typeof row?.setting_value === 'string' ? row.setting_value : '';
}

async function getPlatformSettingBool(settingKey, fallback) {
  try {
    const raw = await getPlatformSettingString(settingKey);
    if (!raw) return fallback;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return fallback;
  } catch {
    return fallback;
  }
}

async function setPlatformSettingBool(settingKey, value, updatedByAdminId) {
  const ok = await ensureDbReady();
  if (!ok) return false;
  const nowIso = new Date().toISOString();
  await state.pool.query(
    'INSERT INTO platform_settings (setting_key, setting_value, updated_at, updated_by_admin_id) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = VALUES(updated_at), updated_by_admin_id = VALUES(updated_by_admin_id)',
    [settingKey, value ? 'true' : 'false', nowIso, updatedByAdminId || null],
  );
  return true;
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

async function resolveUserFromRequest(req) {
  const cookies = parseCookies(req);
  const token = typeof cookies[ACCESS_COOKIE_NAME] === 'string' ? cookies[ACCESS_COOKIE_NAME] : '';
  if (!token) return { ok: false, statusCode: 401, code: 'UNAUTHORIZED', message: '未登录' };

  try {
    const payload = await verifyAccessToken(token);
    const scope = typeof payload.scope === 'string' ? payload.scope : '';
    if (scope !== 'user') return { ok: false, statusCode: 401, code: 'UNAUTHORIZED', message: '未登录' };
    const userId = typeof payload.user_id === 'string' ? payload.user_id : '';
    if (!userId) return { ok: false, statusCode: 401, code: 'UNAUTHORIZED', message: '未登录' };

    const ok = await ensureDbReady();
    if (!ok) return { ok: false, statusCode: 503, code: 'DB_UNAVAILABLE', message: '数据库不可用' };

    const [rows] = await state.pool.query('SELECT id, phone, created_at, is_enabled FROM users WHERE id = ? LIMIT 1', [userId]);
    const user = Array.isArray(rows) && rows.length ? rows[0] : null;
    if (!user) return { ok: false, statusCode: 401, code: 'UNAUTHORIZED', message: '未登录' };
    if (user.is_enabled === 0) return { ok: false, statusCode: 403, code: 'ACCOUNT_DISABLED', message: '账号已停用' };

    return { ok: true, user };
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

      if (req.method === 'GET' && pathname === '/api/public/settings') {
        const enabled = await getPlatformSettingBool('user_registration_enabled', true);
        return writeJson(req, res, 200, { success: true, userRegistrationEnabled: enabled });
      }

      if (req.method === 'POST' && pathname === '/api/auth/register') {
        const ok = await ensureDbReady();
        if (!ok) return writeJson(req, res, 503, { success: false, code: 'DB_UNAVAILABLE', message: '数据库不可用' });

        const registrationEnabled = await getPlatformSettingBool('user_registration_enabled', true);
        if (!registrationEnabled) {
          return writeJson(req, res, 403, {
            success: false,
            code: 'REGISTRATION_DISABLED',
            message: '系统暂未开放注册，请联系管理员获取自己的账号',
          });
        }

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

      if (req.method === 'GET' && pathname === '/api/admin/customers') {
        const auth = await resolveAdminFromRequest(req);
        if (!auth.ok) return writeJson(req, res, auth.statusCode, { success: false, code: auth.code, message: auth.message });

        const pageRaw = url.searchParams.get('page') || '1';
        const pageSizeRaw = url.searchParams.get('pageSize') || '20';
        const page = Math.max(1, Number.parseInt(pageRaw, 10) || 1);
        const pageSize = Math.min(100, Math.max(1, Number.parseInt(pageSizeRaw, 10) || 20));
        const offset = (page - 1) * pageSize;

        const [totalRows] = await state.pool.query('SELECT COUNT(*) AS total FROM customers WHERE is_deleted = 0');
        const total = Array.isArray(totalRows) && totalRows.length ? Number(totalRows[0]?.total || 0) : 0;

        const [rows] = await state.pool.query(
          `SELECT id, user_id, company_key_no, company_name, company_status, credit_code, reg_no, oper_name, address, start_date,
                  active_followup_count, active_project_count, signing_project_count, is_deleted, created_at
           FROM customers ORDER BY created_at DESC LIMIT ? OFFSET ?`,
          [pageSize, offset],
        );
        const customers = Array.isArray(rows)
          ? rows.map((r) => ({
              customerId: r.id,
              userId: r.user_id,
              createdAt: r.created_at,
              company: {
                keyNo: r.company_key_no,
                name: r.company_name,
                status: r.company_status || '',
                creditCode: r.credit_code || '',
                regNo: r.reg_no || '',
                operName: r.oper_name || '',
                address: r.address || '',
                startDate: r.start_date || '',
              },
              activeFollowupCount: Number(r.active_followup_count) || 0,
              activeProjectCount: Number(r.active_project_count) || 0,
              signingProjectCount: Number(r.signing_project_count) || 0,
              isDeleted: r.is_deleted !== 0,
            }))
          : [];
        return writeJson(req, res, 200, { success: true, customers, page, pageSize, total });
      }

      if (req.method === 'POST' && pathname === '/api/admin/customers/soft-delete') {
        const auth = await resolveAdminFromRequest(req);
        if (!auth.ok) return writeJson(req, res, auth.statusCode, { success: false, code: auth.code, message: auth.message });

        const body = await readJson(req);
        const customerId = typeof body?.customerId === 'string' ? body.customerId : '';
        if (!customerId) return writeJson(req, res, 400, { success: false, code: 'CUSTOMER_ID_REQUIRED', message: '缺少客户ID' });

        await state.pool.query('UPDATE customers SET is_deleted = 1 WHERE id = ?', [customerId]);
        return writeJson(req, res, 200, { success: true });
      }

      if (req.method === 'GET' && pathname === '/api/admin/product-service-types') {
        const auth = await resolveAdminFromRequest(req);
        if (!auth.ok) return writeJson(req, res, auth.statusCode, { success: false, code: auth.code, message: auth.message });

        const [rows] = await state.pool.query('SELECT id, name, wbs_code, created_at FROM product_service_types ORDER BY created_at DESC');
        const types = Array.isArray(rows) ? rows.map((r) => ({ typeId: r.id, name: r.name, wbsCode: r.wbs_code || '', createdAt: r.created_at })) : [];
        return writeJson(req, res, 200, { success: true, types });
      }

      if (req.method === 'POST' && pathname === '/api/admin/product-service-types/create') {
        const auth = await resolveAdminFromRequest(req);
        if (!auth.ok) return writeJson(req, res, auth.statusCode, { success: false, code: auth.code, message: auth.message });

        const body = await readJson(req);
        const name = typeof body?.name === 'string' ? body.name.trim() : '';
        const wbsCode = typeof body?.wbsCode === 'string' ? body.wbsCode.trim() : '';
        if (!name) return writeJson(req, res, 400, { success: false, code: 'NAME_REQUIRED', message: '名称不能为空' });
        if (name.length > 64) return writeJson(req, res, 400, { success: false, code: 'NAME_TOO_LONG', message: '名称过长' });
        if (wbsCode.length > 64) return writeJson(req, res, 400, { success: false, code: 'WBS_CODE_TOO_LONG', message: 'WBS代码过长' });

        const [rows] = await state.pool.query('SELECT id FROM product_service_types WHERE name = ? LIMIT 1', [name]);
        const existed = Array.isArray(rows) && rows.length ? rows[0] : null;
        if (existed?.id) return writeJson(req, res, 409, { success: false, code: 'NAME_EXISTS', message: '该类型名称已存在' });

        const id = uuidv4();
        const createdAt = new Date().toISOString();
        await state.pool.query('INSERT INTO product_service_types (id, name, wbs_code, created_at) VALUES (?,?,?,?)', [id, name, wbsCode || null, createdAt]);
        return writeJson(req, res, 200, { success: true, type: { typeId: id, name, wbsCode, createdAt } });
      }

      if (req.method === 'POST' && pathname === '/api/admin/product-service-types/update') {
        const auth = await resolveAdminFromRequest(req);
        if (!auth.ok) return writeJson(req, res, auth.statusCode, { success: false, code: auth.code, message: auth.message });

        const body = await readJson(req);
        const typeId = typeof body?.typeId === 'string' ? body.typeId : '';
        const name = typeof body?.name === 'string' ? body.name.trim() : '';
        const wbsCode = typeof body?.wbsCode === 'string' ? body.wbsCode.trim() : '';
        if (!typeId) return writeJson(req, res, 400, { success: false, code: 'TYPE_ID_REQUIRED', message: '缺少类型ID' });
        if (!name) return writeJson(req, res, 400, { success: false, code: 'NAME_REQUIRED', message: '名称不能为空' });
        if (name.length > 64) return writeJson(req, res, 400, { success: false, code: 'NAME_TOO_LONG', message: '名称过长' });
        if (wbsCode.length > 64) return writeJson(req, res, 400, { success: false, code: 'WBS_CODE_TOO_LONG', message: 'WBS代码过长' });

        const [found] = await state.pool.query('SELECT id FROM product_service_types WHERE id = ? LIMIT 1', [typeId]);
        const existed = Array.isArray(found) && found.length ? found[0] : null;
        if (!existed?.id) return writeJson(req, res, 404, { success: false, code: 'NOT_FOUND', message: '类型不存在' });

        const [sameName] = await state.pool.query('SELECT id FROM product_service_types WHERE name = ? AND id <> ? LIMIT 1', [name, typeId]);
        const conflict = Array.isArray(sameName) && sameName.length ? sameName[0] : null;
        if (conflict?.id) return writeJson(req, res, 409, { success: false, code: 'NAME_EXISTS', message: '该类型名称已存在' });

        await state.pool.query('UPDATE product_service_types SET name = ?, wbs_code = ? WHERE id = ?', [name, wbsCode || null, typeId]);
        return writeJson(req, res, 200, { success: true });
      }

      if (req.method === 'POST' && pathname === '/api/admin/product-service-types/delete') {
        const auth = await resolveAdminFromRequest(req);
        if (!auth.ok) return writeJson(req, res, auth.statusCode, { success: false, code: auth.code, message: auth.message });

        const body = await readJson(req);
        const typeId = typeof body?.typeId === 'string' ? body.typeId : '';
        if (!typeId) return writeJson(req, res, 400, { success: false, code: 'TYPE_ID_REQUIRED', message: '缺少类型ID' });

        const usedRows = await state.pool.query('SELECT COUNT(*) AS total FROM product_services WHERE type_id = ?', [typeId]);
        const usedTotal = Array.isArray(usedRows?.[0]) && usedRows[0].length ? Number(usedRows[0][0]?.total || 0) : 0;
        if (usedTotal > 0) {
          return writeJson(req, res, 400, { success: false, code: 'TYPE_IN_USE', message: '该产品服务类型下存在关联的产品服务，无法删除' });
        }

        await state.pool.query('DELETE FROM product_service_types WHERE id = ?', [typeId]);
        return writeJson(req, res, 200, { success: true });
      }

      if (req.method === 'GET' && pathname === '/api/admin/product-services') {
        const auth = await resolveAdminFromRequest(req);
        if (!auth.ok) return writeJson(req, res, auth.statusCode, { success: false, code: auth.code, message: auth.message });

        const [rows] = await state.pool.query(
          'SELECT id, type_id, name, wbs_code, description, reference_weeks, owner_text, is_enabled, sort_order, created_at FROM product_services ORDER BY sort_order ASC, created_at DESC',
        );
        const services = Array.isArray(rows)
          ? rows.map((r) => ({
            serviceId: r.id,
            typeId: r.type_id || '',
            name: r.name,
            wbsCode: r.wbs_code,
            description: r.description || '',
            referenceWeeks: typeof r.reference_weeks === 'number' ? r.reference_weeks : Number(r.reference_weeks || 0),
            ownerText: r.owner_text || '',
            isEnabled: r.is_enabled !== 0,
            sortOrder: typeof r.sort_order === 'number' ? r.sort_order : Number(r.sort_order || 0),
            createdAt: r.created_at,
          }))
          : [];
        return writeJson(req, res, 200, { success: true, services });
      }

      if (req.method === 'POST' && pathname === '/api/admin/product-services/create') {
        const auth = await resolveAdminFromRequest(req);
        if (!auth.ok) return writeJson(req, res, auth.statusCode, { success: false, code: auth.code, message: auth.message });

        const body = await readJson(req);
        const name = typeof body?.name === 'string' ? body.name.trim() : '';
        const wbsCode = typeof body?.wbsCode === 'string' ? body.wbsCode.trim() : '';
        const description = typeof body?.description === 'string' ? body.description.trim() : '';
        const ownerText = typeof body?.ownerText === 'string' ? body.ownerText.trim() : '';
        const typeId = typeof body?.typeId === 'string' ? body.typeId : '';
        const referenceWeeksRaw = body?.referenceWeeks;
        const referenceWeeks = Number.isFinite(referenceWeeksRaw)
          ? Number(referenceWeeksRaw)
          : (typeof referenceWeeksRaw === 'string' ? Number.parseInt(referenceWeeksRaw, 10) : 0);
        const isEnabled = body?.isEnabled === undefined ? true : Boolean(body?.isEnabled);

        if (!name) return writeJson(req, res, 400, { success: false, code: 'NAME_REQUIRED', message: '产品服务名称不能为空' });
        if (name.length > 128) return writeJson(req, res, 400, { success: false, code: 'NAME_TOO_LONG', message: '产品服务名称过长' });
        if (!wbsCode) return writeJson(req, res, 400, { success: false, code: 'WBS_REQUIRED', message: 'WBS编码不能为空' });
        if (wbsCode.length > 64) return writeJson(req, res, 400, { success: false, code: 'WBS_TOO_LONG', message: 'WBS编码过长' });
        if (!Number.isFinite(referenceWeeks) || referenceWeeks < 0) return writeJson(req, res, 400, { success: false, code: 'REFERENCE_WEEKS_INVALID', message: '参考时间（周）不合法' });
        if (ownerText.length > 128) return writeJson(req, res, 400, { success: false, code: 'OWNER_TOO_LONG', message: '责任方过长' });

        const [sameNameRows] = await state.pool.query('SELECT id FROM product_services WHERE name = ? LIMIT 1', [name]);
        const sameName = Array.isArray(sameNameRows) && sameNameRows.length ? sameNameRows[0] : null;
        if (sameName?.id) return writeJson(req, res, 409, { success: false, code: 'NAME_EXISTS', message: '产品服务名称已存在' });

        const [sameWbsRows] = await state.pool.query('SELECT id FROM product_services WHERE wbs_code = ? LIMIT 1', [wbsCode]);
        const sameWbs = Array.isArray(sameWbsRows) && sameWbsRows.length ? sameWbsRows[0] : null;
        if (sameWbs?.id) return writeJson(req, res, 409, { success: false, code: 'WBS_EXISTS', message: 'WBS编码已存在' });

        const sortRows = await state.pool.query('SELECT COALESCE(MAX(sort_order), 0) AS max_order FROM product_services');
        const sortOrder = Array.isArray(sortRows?.[0]) && sortRows[0].length ? Number(sortRows[0][0]?.max_order || 0) + 1 : 1;

        const id = uuidv4();
        const createdAt = new Date().toISOString();
        await state.pool.query(
          'INSERT INTO product_services (id, type_id, name, wbs_code, description, reference_weeks, owner_text, is_enabled, sort_order, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
          [id, typeId || null, name, wbsCode, description || null, referenceWeeks || 0, ownerText || null, isEnabled ? 1 : 0, sortOrder, createdAt],
        );

        return writeJson(req, res, 200, {
          success: true,
          service: { serviceId: id, typeId, name, wbsCode, description, referenceWeeks: referenceWeeks || 0, ownerText, isEnabled, sortOrder, createdAt },
        });
      }

      if (req.method === 'POST' && pathname === '/api/admin/product-services/update') {
        const auth = await resolveAdminFromRequest(req);
        if (!auth.ok) return writeJson(req, res, auth.statusCode, { success: false, code: auth.code, message: auth.message });

        const body = await readJson(req);
        const serviceId = typeof body?.serviceId === 'string' ? body.serviceId : '';
        const name = typeof body?.name === 'string' ? body.name.trim() : '';
        const wbsCode = typeof body?.wbsCode === 'string' ? body.wbsCode.trim() : '';
        const description = typeof body?.description === 'string' ? body.description.trim() : '';
        const ownerText = typeof body?.ownerText === 'string' ? body.ownerText.trim() : '';
        const typeId = typeof body?.typeId === 'string' ? body.typeId : '';
        const referenceWeeksRaw = body?.referenceWeeks;
        const referenceWeeks = Number.isFinite(referenceWeeksRaw)
          ? Number(referenceWeeksRaw)
          : (typeof referenceWeeksRaw === 'string' ? Number.parseInt(referenceWeeksRaw, 10) : 0);
        const isEnabled = body?.isEnabled === undefined ? true : Boolean(body?.isEnabled);

        if (!serviceId) return writeJson(req, res, 400, { success: false, code: 'SERVICE_ID_REQUIRED', message: '缺少产品服务ID' });
        if (!name) return writeJson(req, res, 400, { success: false, code: 'NAME_REQUIRED', message: '产品服务名称不能为空' });
        if (name.length > 128) return writeJson(req, res, 400, { success: false, code: 'NAME_TOO_LONG', message: '产品服务名称过长' });
        if (!wbsCode) return writeJson(req, res, 400, { success: false, code: 'WBS_REQUIRED', message: 'WBS编码不能为空' });
        if (wbsCode.length > 64) return writeJson(req, res, 400, { success: false, code: 'WBS_TOO_LONG', message: 'WBS编码过长' });
        if (!Number.isFinite(referenceWeeks) || referenceWeeks < 0) return writeJson(req, res, 400, { success: false, code: 'REFERENCE_WEEKS_INVALID', message: '参考时间（周）不合法' });
        if (ownerText.length > 128) return writeJson(req, res, 400, { success: false, code: 'OWNER_TOO_LONG', message: '责任方过长' });

        const [foundRows] = await state.pool.query('SELECT id FROM product_services WHERE id = ? LIMIT 1', [serviceId]);
        const found = Array.isArray(foundRows) && foundRows.length ? foundRows[0] : null;
        if (!found?.id) return writeJson(req, res, 404, { success: false, code: 'NOT_FOUND', message: '产品服务不存在' });

        const [sameNameRows] = await state.pool.query('SELECT id FROM product_services WHERE name = ? AND id <> ? LIMIT 1', [name, serviceId]);
        const sameName = Array.isArray(sameNameRows) && sameNameRows.length ? sameNameRows[0] : null;
        if (sameName?.id) return writeJson(req, res, 409, { success: false, code: 'NAME_EXISTS', message: '产品服务名称已存在' });

        const [sameWbsRows] = await state.pool.query('SELECT id FROM product_services WHERE wbs_code = ? AND id <> ? LIMIT 1', [wbsCode, serviceId]);
        const sameWbs = Array.isArray(sameWbsRows) && sameWbsRows.length ? sameWbsRows[0] : null;
        if (sameWbs?.id) return writeJson(req, res, 409, { success: false, code: 'WBS_EXISTS', message: 'WBS编码已存在' });

        await state.pool.query(
          'UPDATE product_services SET type_id = ?, name = ?, wbs_code = ?, description = ?, reference_weeks = ?, owner_text = ?, is_enabled = ? WHERE id = ?',
          [typeId || null, name, wbsCode, description || null, referenceWeeks || 0, ownerText || null, isEnabled ? 1 : 0, serviceId],
        );
        return writeJson(req, res, 200, { success: true });
      }

      if (req.method === 'POST' && pathname === '/api/admin/product-services/delete') {
        const auth = await resolveAdminFromRequest(req);
        if (!auth.ok) return writeJson(req, res, auth.statusCode, { success: false, code: auth.code, message: auth.message });

        const body = await readJson(req);
        const serviceId = typeof body?.serviceId === 'string' ? body.serviceId : '';
        if (!serviceId) return writeJson(req, res, 400, { success: false, code: 'SERVICE_ID_REQUIRED', message: '缺少产品服务ID' });

        await state.pool.query('DELETE FROM product_services WHERE id = ?', [serviceId]);
        return writeJson(req, res, 200, { success: true });
      }

      if (req.method === 'POST' && pathname === '/api/admin/product-services/reorder') {
        const auth = await resolveAdminFromRequest(req);
        if (!auth.ok) return writeJson(req, res, auth.statusCode, { success: false, code: auth.code, message: auth.message });

        const body = await readJson(req);
        const serviceId = typeof body?.serviceId === 'string' ? body.serviceId : '';
        const direction = typeof body?.direction === 'string' ? body.direction : '';
        if (!serviceId) return writeJson(req, res, 400, { success: false, code: 'SERVICE_ID_REQUIRED', message: '缺少产品服务ID' });
        if (direction !== 'up' && direction !== 'down') {
          return writeJson(req, res, 400, { success: false, code: 'DIRECTION_INVALID', message: 'direction 仅支持 up/down' });
        }

        const distinctRows = await state.pool.query('SELECT COUNT(DISTINCT sort_order) AS c FROM product_services');
        const distinctCount = Array.isArray(distinctRows?.[0]) && distinctRows[0].length ? Number(distinctRows[0][0]?.c || 0) : 0;
        if (distinctCount <= 1) {
          const [initRows] = await state.pool.query('SELECT id FROM product_services ORDER BY created_at DESC');
          if (Array.isArray(initRows)) {
            for (let i = 0; i < initRows.length; i += 1) {
              const row = initRows[i];
              const nextOrder = (i + 1) * 10;
              await state.pool.query('UPDATE product_services SET sort_order = ? WHERE id = ?', [nextOrder, row.id]);
            }
          }
        }

        const [rows] = await state.pool.query('SELECT id, sort_order FROM product_services ORDER BY sort_order ASC, created_at DESC');
        if (!Array.isArray(rows)) return writeJson(req, res, 200, { success: true });
        const idx = rows.findIndex((r) => r.id === serviceId);
        if (idx < 0) return writeJson(req, res, 404, { success: false, code: 'NOT_FOUND', message: '产品服务不存在' });

        const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
        if (targetIdx < 0 || targetIdx >= rows.length) return writeJson(req, res, 200, { success: true });

        const a = rows[idx];
        const b = rows[targetIdx];
        const aOrder = typeof a.sort_order === 'number' ? a.sort_order : Number(a.sort_order || 0);
        const bOrder = typeof b.sort_order === 'number' ? b.sort_order : Number(b.sort_order || 0);

        if (aOrder === bOrder) {
          const [initRows] = await state.pool.query('SELECT id FROM product_services ORDER BY sort_order ASC, created_at DESC');
          if (Array.isArray(initRows)) {
            for (let i = 0; i < initRows.length; i += 1) {
              const row = initRows[i];
              const nextOrder = (i + 1) * 10;
              await state.pool.query('UPDATE product_services SET sort_order = ? WHERE id = ?', [nextOrder, row.id]);
            }
          }
          const [rows2] = await state.pool.query('SELECT id, sort_order FROM product_services ORDER BY sort_order ASC, created_at DESC');
          if (!Array.isArray(rows2)) return writeJson(req, res, 200, { success: true });
          const idx2 = rows2.findIndex((r) => r.id === serviceId);
          if (idx2 < 0) return writeJson(req, res, 404, { success: false, code: 'NOT_FOUND', message: '产品服务不存在' });
          const targetIdx2 = direction === 'up' ? idx2 - 1 : idx2 + 1;
          if (targetIdx2 < 0 || targetIdx2 >= rows2.length) return writeJson(req, res, 200, { success: true });
          const a2 = rows2[idx2];
          const b2 = rows2[targetIdx2];
          const aOrder2 = typeof a2.sort_order === 'number' ? a2.sort_order : Number(a2.sort_order || 0);
          const bOrder2 = typeof b2.sort_order === 'number' ? b2.sort_order : Number(b2.sort_order || 0);
          await state.pool.query('UPDATE product_services SET sort_order = ? WHERE id = ?', [bOrder2, a2.id]);
          await state.pool.query('UPDATE product_services SET sort_order = ? WHERE id = ?', [aOrder2, b2.id]);
          return writeJson(req, res, 200, { success: true });
        }

        await state.pool.query('UPDATE product_services SET sort_order = ? WHERE id = ?', [bOrder, a.id]);
        await state.pool.query('UPDATE product_services SET sort_order = ? WHERE id = ?', [aOrder, b.id]);

        return writeJson(req, res, 200, { success: true });
      }

      if (req.method === 'GET' && pathname === '/api/product-services') {
        const cookies = parseCookies(req);
        const token = typeof cookies[ACCESS_COOKIE_NAME] === 'string' ? cookies[ACCESS_COOKIE_NAME] : '';
        if (!token) return writeJson(req, res, 401, { success: false, code: 'UNAUTHORIZED', message: '未登录' });

        try {
          const payload = await verifyAccessToken(token);
          const scope = typeof payload.scope === 'string' ? payload.scope : '';
          if (scope !== 'user') return writeJson(req, res, 401, { success: false, code: 'UNAUTHORIZED', message: '未登录' });
        } catch {
          return writeJson(req, res, 401, { success: false, code: 'UNAUTHORIZED', message: '未登录' });
        }

        const ok = await ensureDbReady();
        if (!ok) return writeJson(req, res, 503, { success: false, code: 'DB_UNAVAILABLE', message: '数据库不可用' });

        const [rows] = await state.pool.query(`
          SELECT ps.name, ps.wbs_code, ps.description, ps.reference_weeks, ps.owner_text, ps.type_id, pst.name AS type_name
          FROM product_services ps
          LEFT JOIN product_service_types pst ON pst.id = ps.type_id
          WHERE ps.is_enabled = 1
          ORDER BY ps.sort_order ASC, ps.created_at DESC
        `);
        const services = Array.isArray(rows)
          ? rows.map((r) => ({
            name: r.name,
            wbsCode: r.wbs_code,
            description: r.description || '',
            referenceWeeks: typeof r.reference_weeks === 'number' ? r.reference_weeks : Number(r.reference_weeks || 0),
            ownerText: r.owner_text || '',
            typeId: r.type_id || '',
            typeName: r.type_name || '',
          }))
          : [];

        const [typeRows] = await state.pool.query(`
          SELECT DISTINCT ps.type_id, pst.name AS name
          FROM product_services ps
          INNER JOIN product_service_types pst ON pst.id = ps.type_id
          WHERE ps.is_enabled = 1 AND ps.type_id IS NOT NULL
          ORDER BY pst.name ASC
        `);
        const types = Array.isArray(typeRows)
          ? typeRows.map((r) => ({ typeId: r.type_id, name: r.name }))
          : [];

        return writeJson(req, res, 200, { success: true, services, types });
      }

      if (req.method === 'POST' && pathname === '/api/company-search') {
        const auth = await resolveUserFromRequest(req);
        if (!auth.ok) return writeJson(req, res, auth.statusCode, { success: false, code: auth.code, message: auth.message });

        const body = await readJson(req);
        const companyName = typeof body?.companyName === 'string' ? body.companyName.trim() : '';
        const pageSizeRaw = body?.pageSize;
        const pageIndexRaw = body?.pageIndex;
        const pageSize = Math.min(50, Math.max(1, Number.isFinite(pageSizeRaw) ? Number(pageSizeRaw) : Number.parseInt(String(pageSizeRaw || 10), 10) || 10));
        const pageIndex = Math.max(1, Number.isFinite(pageIndexRaw) ? Number(pageIndexRaw) : Number.parseInt(String(pageIndexRaw || 1), 10) || 1);
        const scene = typeof body?.scene === 'string' && body.scene.trim() ? body.scene.trim() : 'companySearch';

        if (!companyName) return writeJson(req, res, 400, { success: false, code: 'COMPANY_NAME_REQUIRED', message: '缺少 companyName' });

        const privateKeyObject = normalizePkcs8PrivateKey(TRIPARTITE_RSA_PRIVATE_KEY_RAW);
        if (!privateKeyObject) {
          return writeJson(req, res, 500, { success: false, code: 'CONFIG_MISSING', message: '缺少 TRIPARTITE_RSA_PRIVATE_KEY（或 TRIPARTITE_RSA_PRIVATE_KEY_FILE）' });
        }

        const dataValue = JSON.stringify({ companyName, pageSize, pageIndex });
        const requestId = uuidv4();
        const timestamp = Date.now();
        const clientId = TRIPARTITE_CLIENT_ID;
        const signType = TRIPARTITE_SIGN_TYPE || 'RSA2';

        if (!clientId) return writeJson(req, res, 500, { success: false, code: 'CONFIG_MISSING', message: '缺少 TRIPARTITE_CLIENT_ID' });
        if (!TRIPARTITE_BASE_URL) return writeJson(req, res, 500, { success: false, code: 'CONFIG_MISSING', message: '缺少 TRIPARTITE_BASE_URL' });

        const paramsForSign = { clientId, data: dataValue, requestId, scene, signType, timestamp };
        const sortStr = buildSortedQueryString(paramsForSign);
        const sign = rsaSha256SignBase64(sortStr, privateKeyObject);

        const requestBody = { ...paramsForSign, sign };
        const upstreamUrl = `${TRIPARTITE_BASE_URL.replace(/\/+$/, '')}/companySearch`;

        try {
          const upstream = await httpRequestJson(upstreamUrl, requestBody, 12_000);
          const statusCode = upstream.statusCode || 0;
          if (statusCode < 200 || statusCode >= 300) {
            return writeJson(req, res, 502, { success: false, code: 'UPSTREAM_ERROR', message: '第三方接口调用失败', upstream: { statusCode, data: upstream.data } });
          }

          const upstreamData = upstream.data || {};
          const code = Number(upstreamData?.code ?? -1);
          const message = typeof upstreamData?.message === 'string' ? upstreamData.message : '';
          const data = upstreamData?.data || {};
          const paging = data?.Paging || {};
          const orderNumber = typeof data?.OrderNumber === 'string' ? data.OrderNumber : '';
          const results = Array.isArray(data?.Result)
            ? data.Result.map((r) => ({
              keyNo: r?.KeyNo || '',
              startDate: r?.StartDate || '',
              status: r?.Status || '',
              creditCode: r?.CreditCode || '',
              regNo: r?.No || '',
              operName: r?.OperName || '',
              address: r?.Address || '',
              name: r?.Name || '',
            }))
            : [];

          return writeJson(req, res, 200, {
            success: code === 0,
            code,
            message: message || (code === 0 ? 'ok' : 'upstream_error'),
            orderNumber,
            paging: {
              pageSize: Number(paging?.PageSize || pageSize),
              pageIndex: Number(paging?.PageIndex || pageIndex),
              totalRecords: Number(paging?.TotalRecords || 0),
            },
            results,
            upstream: { statusCode, data: upstreamData },
          });
        } catch (e) {
          return writeJson(req, res, 502, { success: false, code: 'UPSTREAM_UNAVAILABLE', message: e?.message || 'upstream_unavailable' });
        }
      }

      if (req.method === 'GET' && pathname === '/api/customers') {
        const auth = await resolveUserFromRequest(req);
        if (!auth.ok) return writeJson(req, res, auth.statusCode, { success: false, code: auth.code, message: auth.message });

        const pageRaw = url.searchParams.get('page') || '1';
        const pageSizeRaw = url.searchParams.get('pageSize') || '20';
        const page = Math.max(1, Number.parseInt(pageRaw, 10) || 1);
        const pageSize = Math.min(50, Math.max(1, Number.parseInt(pageSizeRaw, 10) || 20));
        const offset = (page - 1) * pageSize;

        const [countRows] = await state.pool.query('SELECT COUNT(*) AS total FROM customers WHERE user_id = ?', [auth.user.id]);
        const total = Number(Array.isArray(countRows) && countRows.length ? countRows[0]?.total : 0) || 0;

        const [rows] = await state.pool.query(
          `SELECT id, user_id, company_key_no, company_name, company_status, credit_code, reg_no, oper_name, address, start_date,
           active_followup_count, active_project_count, signing_project_count,
           source, source_order_number, created_at
           FROM customers
           WHERE user_id = ?
           ORDER BY created_at DESC
           LIMIT ? OFFSET ?`,
          [auth.user.id, pageSize, offset],
        );
        const customers = Array.isArray(rows)
          ? rows.map((r) => ({
            customerId: r.id,
            createdAt: r.created_at,
            company: {
              keyNo: r.company_key_no,
              name: r.company_name,
              status: r.company_status || '',
              creditCode: r.credit_code || '',
              regNo: r.reg_no || '',
              operName: r.oper_name || '',
              address: r.address || '',
              startDate: r.start_date || '',
            },
            activeFollowupCount: Number(r.active_followup_count || 0),
            activeProjectCount: Number(r.active_project_count || 0),
            signingProjectCount: Number(r.signing_project_count || 0),
            source: r.source,
            sourceOrderNumber: r.source_order_number || '',
          }))
          : [];
        return writeJson(req, res, 200, {
          success: true,
          customers,
          paging: {
            page,
            pageSize,
            total,
            totalPages: Math.max(1, Math.ceil(total / Math.max(1, pageSize))),
          },
        });
      }

      if (req.method === 'POST' && pathname === '/api/customers/create') {
        const auth = await resolveUserFromRequest(req);
        if (!auth.ok) return writeJson(req, res, auth.statusCode, { success: false, code: auth.code, message: auth.message });

        const body = await readJson(req);
        const company = body?.company || {};
        const keyNo = typeof company?.keyNo === 'string' ? company.keyNo : (typeof company?.KeyNo === 'string' ? company.KeyNo : '');
        const name = typeof company?.name === 'string' ? company.name : (typeof company?.Name === 'string' ? company.Name : '');
        const status = typeof company?.status === 'string' ? company.status : (typeof company?.Status === 'string' ? company.Status : '');
        const creditCode = typeof company?.creditCode === 'string' ? company.creditCode : (typeof company?.CreditCode === 'string' ? company.CreditCode : '');
        const regNo = typeof company?.regNo === 'string' ? company.regNo : (typeof company?.No === 'string' ? company.No : '');
        const operName = typeof company?.operName === 'string' ? company.operName : (typeof company?.OperName === 'string' ? company.OperName : '');
        const address = typeof company?.address === 'string' ? company.address : (typeof company?.Address === 'string' ? company.Address : '');
        const startDate = typeof company?.startDate === 'string' ? company.startDate : (typeof company?.StartDate === 'string' ? company.StartDate : '');
        const sourceOrderNumber = typeof body?.orderNumber === 'string' ? body.orderNumber : '';

        if (!keyNo) return writeJson(req, res, 400, { success: false, code: 'KEY_NO_REQUIRED', message: '缺少 KeyNo' });
        if (!name) return writeJson(req, res, 400, { success: false, code: 'COMPANY_NAME_REQUIRED', message: '缺少 Name' });

        const [existRows] = await state.pool.query('SELECT id FROM customers WHERE user_id = ? AND company_name = ? LIMIT 1', [
          auth.user.id,
          name,
        ]);
        const existed = Array.isArray(existRows) && existRows.length ? existRows[0] : null;
        if (existed?.id) return writeJson(req, res, 409, { success: false, code: 'CUSTOMER_EXISTS', message: '客户已存在' });

        const customerId = uuidv4();
        const createdAt = new Date().toISOString();
        await state.pool.query(
          'INSERT INTO customers (id, user_id, company_key_no, company_name, company_status, credit_code, reg_no, oper_name, address, start_date, active_followup_count, active_project_count, signing_project_count, source, source_order_number, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          [
            customerId,
            auth.user.id,
            keyNo,
            name,
            status || null,
            creditCode || null,
            regNo || null,
            operName || null,
            address || null,
            startDate || null,
            0,
            0,
            0,
            'tripartite_company_search',
            sourceOrderNumber || null,
            createdAt,
          ],
        );

        return writeJson(req, res, 200, {
          success: true,
          customer: {
            customerId,
            createdAt,
            company: { keyNo, name, status, creditCode, regNo, operName, address, startDate },
            source: 'tripartite_company_search',
            sourceOrderNumber,
          },
        });
      }

      if (req.method === 'GET' && pathname === '/api/admin/admin-users') {
        const auth = await resolveAdminFromRequest(req);
        if (!auth.ok) return writeJson(req, res, auth.statusCode, { success: false, code: auth.code, message: auth.message });

        const [rows] = await state.pool.query('SELECT id, phone, created_at, last_login_at, is_superadmin, is_enabled, permission_scope FROM admin_user ORDER BY created_at DESC');
        const admins = Array.isArray(rows) ? rows.map((r) => getAdminPublic(r)) : [];
        return writeJson(req, res, 200, { success: true, admins });
      }

      if (req.method === 'GET' && pathname === '/api/admin/platform-settings') {
        const auth = await resolveAdminFromRequest(req);
        if (!auth.ok) return writeJson(req, res, auth.statusCode, { success: false, code: auth.code, message: auth.message });

        const enabled = await getPlatformSettingBool('user_registration_enabled', true);
        return writeJson(req, res, 200, { success: true, settings: { userRegistrationEnabled: enabled } });
      }

      if (req.method === 'POST' && pathname === '/api/admin/platform-settings') {
        const auth = await resolveAdminFromRequest(req);
        if (!auth.ok) return writeJson(req, res, auth.statusCode, { success: false, code: auth.code, message: auth.message });
        if (!auth.admin?.is_superadmin) return writeJson(req, res, 403, { success: false, code: 'FORBIDDEN', message: '仅超管可修改系统设置' });

        const body = await readJson(req);
        const nextEnabled = !!body?.userRegistrationEnabled;
        await setPlatformSettingBool('user_registration_enabled', nextEnabled, auth.admin.adminId);
        return writeJson(req, res, 200, { success: true, settings: { userRegistrationEnabled: nextEnabled } });
      }

      if (req.method === 'POST' && pathname === '/api/admin/tripartite/call') {
        const auth = await resolveAdminFromRequest(req);
        if (!auth.ok) return writeJson(req, res, auth.statusCode, { success: false, code: auth.code, message: auth.message });

        const body = await readJson(req);
        const servicePath = typeof body?.servicePath === 'string' ? body.servicePath.trim() : '';
        const scene = typeof body?.scene === 'string' ? body.scene.trim() : '';
        const requestId = typeof body?.requestId === 'string' && body.requestId.trim() ? body.requestId.trim() : uuidv4();
        const timestamp = typeof body?.timestamp === 'number' && Number.isFinite(body.timestamp) ? Math.floor(body.timestamp) : Date.now();
        const clientId = typeof body?.clientId === 'string' && body.clientId.trim() ? body.clientId.trim() : TRIPARTITE_CLIENT_ID;
        const signType = typeof body?.signType === 'string' && body.signType.trim() ? body.signType.trim() : TRIPARTITE_SIGN_TYPE;

        if (!TRIPARTITE_BASE_URL) return writeJson(req, res, 500, { success: false, code: 'CONFIG_MISSING', message: '缺少 TRIPARTITE_BASE_URL' });
        if (!clientId) return writeJson(req, res, 400, { success: false, code: 'CLIENT_ID_REQUIRED', message: '缺少 clientId' });
        if (!scene) return writeJson(req, res, 400, { success: false, code: 'SCENE_REQUIRED', message: '缺少 scene' });
        if (!servicePath) return writeJson(req, res, 400, { success: false, code: 'SERVICE_PATH_REQUIRED', message: '缺少 servicePath' });
        if (!isSafeServicePath(servicePath)) {
          return writeJson(req, res, 400, { success: false, code: 'SERVICE_PATH_INVALID', message: 'servicePath 不合法' });
        }

        const dataValue = typeof body?.data === 'string' ? body.data : JSON.stringify(body?.data ?? {});

        const privateKeyObject = normalizePkcs8PrivateKey(TRIPARTITE_RSA_PRIVATE_KEY_RAW);
        if (!privateKeyObject) {
          return writeJson(req, res, 500, { success: false, code: 'CONFIG_MISSING', message: '缺少 TRIPARTITE_RSA_PRIVATE_KEY（或 TRIPARTITE_RSA_PRIVATE_KEY_FILE）' });
        }

        const paramsForSign = {
          clientId,
          data: dataValue,
          requestId,
          scene,
          signType,
          timestamp,
        };

        const sortStr = buildSortedQueryString(paramsForSign);
        const sign = rsaSha256SignBase64(sortStr, privateKeyObject);

        const requestBody = { ...paramsForSign, sign };
        const base = TRIPARTITE_BASE_URL.replace(/\/+$/, '');
        const upstreamUrl = `${base}/${servicePath}`;

        try {
          const upstream = await httpRequestJson(upstreamUrl, requestBody, 12_000);
          const statusCode = upstream.statusCode || 0;
          if (statusCode >= 200 && statusCode < 300) {
            return writeJson(req, res, 200, { success: true, upstream: { statusCode, data: upstream.data } });
          }
          return writeJson(req, res, 502, {
            success: false,
            code: 'UPSTREAM_ERROR',
            message: '第三方接口调用失败',
            upstream: { statusCode, data: upstream.data },
          });
        } catch (e) {
          return writeJson(req, res, 502, { success: false, code: 'UPSTREAM_UNAVAILABLE', message: e?.message || 'upstream_unavailable' });
        }
      }

      if (req.method === 'POST' && pathname === '/api/admin/admin-users/create') {
        const auth = await resolveAdminFromRequest(req);
        if (!auth.ok) return writeJson(req, res, auth.statusCode, { success: false, code: auth.code, message: auth.message });
        if (!auth.admin?.is_superadmin) return writeJson(req, res, 403, { success: false, code: 'FORBIDDEN', message: '仅超管可添加管理员' });

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

        const [rows] = await state.pool.query('SELECT id FROM admin_user WHERE phone = ? LIMIT 1', [phone]);
        const existed = Array.isArray(rows) && rows.length ? rows[0] : null;
        if (existed?.id) return writeJson(req, res, 409, { success: false, code: 'PHONE_EXISTS', message: '管理员手机号已存在' });

        const id = uuidv4();
        const createdAt = new Date().toISOString();
        const salt = crypto.randomBytes(16).toString('base64');
        const hash = pbkdf2Hash(password, salt);

        await state.pool.query(
          'INSERT INTO admin_user (id, phone, password_salt, password_hash, created_at, last_login_at, is_superadmin, is_enabled, permission_scope) VALUES (?,?,?,?,?,?,?,?,?)',
          [id, phone, salt, hash, createdAt, null, 0, 1, 'basic'],
        );

        const [createdRows] = await state.pool.query(
          'SELECT id, phone, created_at, last_login_at, is_superadmin, is_enabled, permission_scope FROM admin_user WHERE id = ? LIMIT 1',
          [id],
        );
        const created = Array.isArray(createdRows) && createdRows.length ? createdRows[0] : null;
        return writeJson(req, res, 200, { success: true, admin: created ? getAdminPublic(created) : null });
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

      if (req.method === 'POST' && pathname === '/api/wx/auth/login') {
        const ok = await ensureDbReady();
        if (!ok) return writeJson(req, res, 503, { success: false, code: 'DB_UNAVAILABLE', message: '数据库不可用' });

        const body = await readJson(req);
        const phone = normalizePhone(body.phone);
        const password = body.password;

        if (!phone) return writeJson(req, res, 400, { success: false, code: 'PHONE_REQUIRED', message: '手机号不能为空' });
        if (!validateChinaMainlandMobile(phone)) {
          return writeJson(req, res, 400, { success: false, code: 'PHONE_INVALID', message: '手机号格式不正确（中国大陆 11 位）' });
        }
        if (!password) {
          return writeJson(req, res, 400, { success: false, code: 'PASSWORD_REQUIRED', message: '密码不能为空' });
        }

        const [rows] = await state.pool.query('SELECT id, phone, password_salt, password_hash, created_at FROM users WHERE phone = ? LIMIT 1', [phone]);
        const user = Array.isArray(rows) && rows.length ? rows[0] : null;
        if (!user) {
          return writeJson(req, res, 401, { success: false, code: 'INVALID_CREDENTIALS', message: '手机号或密码错误' });
        }

        const hash = pbkdf2Hash(password, user.password_salt);
        if (hash !== user.password_hash) {
          return writeJson(req, res, 401, { success: false, code: 'INVALID_CREDENTIALS', message: '手机号或密码错误' });
        }

        const accessToken = await signAccessToken({ user_id: user.id, username: user.phone, scope: 'wxapp' });
        const refreshToken = crypto.randomBytes(32).toString('base64url');
        const refreshTokenHash = sha256Hex(refreshToken);
        const nowIso = new Date().toISOString();
        const expiresIso = new Date(Date.now() + REFRESH_TOKEN_TTL_SEC * 1000).toISOString();
        const refreshId = uuidv4();
        const ip = typeof req?.socket?.remoteAddress === 'string' ? req?.socket?.remoteAddress : null;
        const userAgent = typeof req?.headers?.['user-agent'] === 'string' ? req.headers['user-agent'].slice(0, 255) : null;

        await state.pool.query(
          'INSERT INTO refresh_tokens (id, user_id, token_hash, device_id, created_at, expires_at, revoked_at, replaced_by, ip, user_agent) VALUES (?,?,?,?,?,?,?,?,?,?)',
          [refreshId, user.id, refreshTokenHash, 'wxapp', nowIso, expiresIso, null, null, ip, userAgent],
        );

        return writeJson(req, res, 200, { success: true, accessToken, refreshToken, user: { userId: user.id, phone: user.phone } });
      }

      if (req.method === 'POST' && pathname === '/api/wx/auth/refresh') {
        const cookies = parseCookies(req);
        const rawRefresh = typeof cookies[REFRESH_COOKIE_NAME] === 'string' ? cookies[REFRESH_COOKIE_NAME] : '';
        if (!rawRefresh) return writeJson(req, res, 401, { success: false, code: 'REFRESH_TOKEN_MISSING', message: '请先登录' });

        const tokenHash = sha256Hex(rawRefresh);
        const [rows] = await state.pool.query(
          'SELECT rt.id, rt.user_id, rt.expires_at, rt.revoked_at, u.phone, u.created_at FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id WHERE rt.token_hash = ? LIMIT 1',
          [tokenHash],
        );
        const record = Array.isArray(rows) && rows.length ? rows[0] : null;
        if (!record) return writeJson(req, res, 401, { success: false, code: 'REFRESH_TOKEN_INVALID', message: '登录已过期，请重新登录' });
        if (record.revoked_at) return writeJson(req, res, 401, { success: false, code: 'REFRESH_TOKEN_REVOKED', message: '登录已过期，请重新登录' });
        if (new Date(record.expires_at) < new Date()) return writeJson(req, res, 401, { success: false, code: 'REFRESH_TOKEN_EXPIRED', message: '登录已过期，请重新登录' });

        const newAccessToken = await signAccessToken({ user_id: record.user_id, username: record.phone, scope: 'wxapp' });
        return writeJson(req, res, 200, { success: true, accessToken: newAccessToken });
      }

      if (req.method === 'GET' && pathname.startsWith('/api/wx/')) {
        const auth = await resolveUserFromRequest(req);
        if (!auth.ok) return writeJson(req, res, auth.statusCode, { success: false, code: auth.code, message: auth.message });
      }

      if (req.method === 'GET' && pathname === '/api/wx/customers') {
        const auth = await resolveUserFromRequest(req);
        if (!auth.ok) return writeJson(req, res, auth.statusCode, { success: false, code: auth.code, message: auth.message });

        const [rows] = await state.pool.query(
          `SELECT id, company_key_no, company_name, company_status, credit_code, reg_no, oper_name, address, start_date,
                  active_followup_count, active_project_count, signing_project_count, source, source_order_number, created_at
           FROM customers WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`,
          [auth.user.id],
        );
        const customers = (rows || []).map((r) => ({
          customerId: r.id,
          company: {
            keyNo: r.company_key_no,
            name: r.company_name,
            status: r.company_status,
            creditCode: r.credit_code,
            regNo: r.reg_no,
            operName: r.oper_name,
            address: r.address,
            startDate: r.start_date,
          },
          activeFollowupCount: r.active_followup_count,
          activeProjectCount: r.active_project_count,
          signingProjectCount: r.signing_project_count,
          source: r.source,
          sourceOrderNumber: r.source_order_number,
          createdAt: r.created_at,
        }));
        return writeJson(req, res, 200, { success: true, customers });
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
