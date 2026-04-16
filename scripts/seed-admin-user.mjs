import crypto from 'node:crypto';

import mysql from 'mysql2/promise';

function normalizePhone(phone) {
  if (typeof phone !== 'string') return '';
  let p = phone.trim();
  p = p.replace(/[\s-]/g, '');
  if (p.startsWith('+86')) p = p.slice(3);
  if (p.startsWith('86') && p.length > 11) p = p.slice(2);
  return p;
}

function validateChinaMainlandMobile(phone) {
  return /^1[3-9]\d{9}$/.test(phone);
}

function pbkdf2Hash(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 120_000, 32, 'sha256').toString('base64');
}

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const idx = arg.indexOf('=');
    if (idx < 0) {
      out[arg.slice(2)] = 'true';
      continue;
    }
    out[arg.slice(2, idx)] = arg.slice(idx + 1);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const phone = normalizePhone(args.phone || process.env.ADMIN_PHONE || '');
  const password = String(args.password || process.env.ADMIN_PASSWORD || '');
  const isSuperadmin = String(args.superadmin ?? process.env.ADMIN_SUPERADMIN ?? 'true').toLowerCase() !== 'false';

  if (!phone) {
    throw new Error('missing_phone: 请通过 --phone=158xxxxxxxx 或 ADMIN_PHONE 提供手机号');
  }
  if (!validateChinaMainlandMobile(phone)) {
    throw new Error('invalid_phone: 仅支持中国大陆 11 位手机号');
  }
  if (password.length < 6) {
    throw new Error('invalid_password: 密码至少 6 位');
  }

  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'from_zero_start',
    waitForConnections: true,
    connectionLimit: 2,
  });

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin_user (
        id VARCHAR(36) PRIMARY KEY,
        phone VARCHAR(20) NOT NULL UNIQUE,
        password_salt VARCHAR(64) NOT NULL,
        password_hash VARCHAR(128) NOT NULL,
        created_at VARCHAR(32) NOT NULL,
        last_login_at VARCHAR(32) NULL,
        is_superadmin TINYINT(1) NOT NULL DEFAULT 0
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    await pool.query('CREATE INDEX idx_admin_user_phone ON admin_user(phone);').catch(() => {});

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const salt = crypto.randomBytes(16).toString('base64');
    const hash = pbkdf2Hash(password, salt);

    await pool.query(
      'INSERT INTO admin_user (id, phone, password_salt, password_hash, created_at, last_login_at, is_superadmin) VALUES (?,?,?,?,?,?,?) AS new ON DUPLICATE KEY UPDATE password_salt=new.password_salt, password_hash=new.password_hash, is_superadmin=new.is_superadmin',
      [id, phone, salt, hash, createdAt, null, isSuperadmin ? 1 : 0],
    );

    const [rows] = await pool.query(
      'SELECT id, phone, created_at, last_login_at, is_superadmin FROM admin_user WHERE phone = ? LIMIT 1',
      [phone],
    );
    const admin = Array.isArray(rows) && rows.length ? rows[0] : null;
    process.stdout.write(`${JSON.stringify({ success: true, admin }, null, 2)}\n`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  process.stderr.write(`${e?.message || 'seed_admin_failed'}\n`);
  process.exit(1);
});

