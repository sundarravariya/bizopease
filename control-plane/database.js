/**
 * BizOpease — Master SQLite Registry
 * =====================================
 * Tracks all tenant workspaces and system-level configuration.
 * The Odoo databases themselves are PostgreSQL — this SQLite DB
 * only holds the metadata registry.
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

function applyPragmas(db) {
  db.serialize(() => {
    db.run('PRAGMA journal_mode = WAL;');
    db.run('PRAGMA synchronous = NORMAL;');
    db.run('PRAGMA temp_store = MEMORY;');
    db.run('PRAGMA cache_size = -4000;');
    db.run('PRAGMA busy_timeout = 10000;');
  });
}

const masterDbPath = path.join(__dirname, 'master.db');
const masterDb = new sqlite3.Database(masterDbPath);
applyPragmas(masterDb);

masterDb.serialize(() => {
  // Main workspace/tenant registry
  masterDb.run(`CREATE TABLE IF NOT EXISTS workspaces (
    tenant_id                TEXT PRIMARY KEY,          -- subdomain slug, e.g. "acme"
    workspace_name           TEXT NOT NULL,              -- display name, e.g. "ACME Trading"
    odoo_db_name             TEXT NOT NULL DEFAULT '',   -- Odoo PG database, e.g. "ws_acme"
    admin_email              TEXT NOT NULL DEFAULT '',   -- Odoo admin login email
    plan_type                TEXT NOT NULL DEFAULT 'starter', -- 'starter' | 'pro'
    subscription_status      TEXT NOT NULL DEFAULT 'unpaid'
                             CHECK(subscription_status IN ('active','unpaid','expired')),
    subscription_expires_at  TEXT,                       -- ISO datetime or NULL (never expires)
    razorpay_subscription_id TEXT DEFAULT '',
    last_payment_id          TEXT DEFAULT '',
    cancel_at_period_end     INTEGER DEFAULT 0,
    provision_status         TEXT NOT NULL DEFAULT 'pending'
                             CHECK(provision_status IN ('pending','provisioning','ready','failed')),
    provision_error          TEXT DEFAULT '',            -- last error from provisioner
    nginx_configured         INTEGER DEFAULT 0,          -- 1 if Nginx block written
    is_queen_tenant          INTEGER DEFAULT 0,          -- 1 = auth against QUEEN_URL/QUEEN_DB
    created_at               TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at               TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  // Migration: add is_queen_tenant to existing databases that were created before this column
  masterDb.run(`ALTER TABLE workspaces ADD COLUMN is_queen_tenant INTEGER DEFAULT 0`, () => {});

  // Email -> workspace map for NON-owner logins (employees). The owner is found
  // via workspaces.admin_email; everyone else is registered here by the portal
  // (which lists Odoo res.users) so login can resolve their workspace/DB.
  // Each email belongs to EXACTLY ONE workspace (email is the primary key), so an
  // employee is linked to that database/workspace alone and can't be claimed by
  // another tenant. Registration uses INSERT OR IGNORE — the first link wins.
  masterDb.run(`CREATE TABLE IF NOT EXISTS workspace_users (
    email        TEXT PRIMARY KEY,          -- Odoo login, lower-cased (globally unique)
    tenant_id    TEXT NOT NULL,             -- workspaces.tenant_id
    odoo_db_name TEXT NOT NULL DEFAULT '',
    created_at   TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  // System-wide settings: API keys, credentials, config values
  masterDb.run(`CREATE TABLE IF NOT EXISTS system_settings (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL DEFAULT ''
  )`);

  // Audit log: every superadmin action
  masterDb.run(`CREATE TABLE IF NOT EXISTS audit_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    action     TEXT NOT NULL,
    tenant_id  TEXT,
    details    TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  // Indexes
  masterDb.run(`CREATE INDEX IF NOT EXISTS idx_ws_status ON workspaces(subscription_status)`);
  masterDb.run(`CREATE INDEX IF NOT EXISTS idx_ws_expires ON workspaces(subscription_expires_at)`);
  masterDb.run(`CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_log(tenant_id)`);

  // Seed default system settings if they don't exist yet
  const defaults = [
    ['ODOO_URL', 'http://127.0.0.1:8069'],
    ['ODOO_MASTER_PASSWORD', ''],
    ['PLAN_PRICE_STARTER', '1000'],
    ['PLAN_PRICE_PRO', '2500'],
    ['RAZORPAY_KEY_ID', ''],
    ['RAZORPAY_KEY_SECRET', ''],
    ['RAZORPAY_PLAN_ID_STARTER', ''],
    ['RAZORPAY_PLAN_ID_PRO', ''],
    ['RAZORPAY_WEBHOOK_SECRET', ''],
    ['SUPERADMIN_USERNAME', 'bizopeaseadmin'],
    ['SUPERADMIN_PASSWORD', 'BizOpeaseAdminPass123!'],
    ['JWT_SECRET', require('crypto').randomBytes(32).toString('hex')]
  ];

  defaults.forEach(([key, val]) => {
    masterDb.run(`INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)`, [key, val]);
  });
});

// ─── SYNCHRONOUS HELPER (for use inside sync callback chains) ─────────────────
function getSetting(key, defaultVal = '') {
  return new Promise((resolve) => {
    masterDb.get('SELECT value FROM system_settings WHERE key = ?', [key], (err, row) => {
      if (err || !row) resolve(defaultVal);
      else resolve(row.value || defaultVal);
    });
  });
}

function saveSetting(key, val) {
  return new Promise((resolve, reject) => {
    masterDb.run(
      'INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)',
      [key, String(val)],
      err => { if (err) reject(err); else resolve(true); }
    );
  });
}

function addAuditLog(action, tenantId = null, details = '') {
  masterDb.run(
    'INSERT INTO audit_log (action, tenant_id, details) VALUES (?, ?, ?)',
    [action, tenantId, details],
    err => { if (err) console.error('[AuditLog] Write failed:', err.message); }
  );
}

module.exports = { masterDb, getSetting, saveSetting, addAuditLog };
