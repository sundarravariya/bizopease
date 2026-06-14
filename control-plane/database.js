const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Helper to apply SQLite performance PRAGMAs
function applyPragmas(db) {
  db.serialize(() => {
    db.run("PRAGMA journal_mode = WAL;");
    db.run("PRAGMA synchronous = NORMAL;");
    db.run("PRAGMA temp_store = MEMORY;");
    db.run("PRAGMA cache_size = -2000;");
    db.run("PRAGMA busy_timeout = 5000;");
  });
}

const masterDbPath = path.join(__dirname, 'master.db');
const masterDb = new sqlite3.Database(masterDbPath);
applyPragmas(masterDb);

masterDb.serialize(() => {
  // Create workspaces table to manage subscriptions and provisioned databases
  masterDb.run(`CREATE TABLE IF NOT EXISTS workspaces (
    tenant_id TEXT PRIMARY KEY,
    workspace_name TEXT NOT NULL,
    subscription_status TEXT CHECK(subscription_status IN ('active', 'unpaid', 'expired')) NOT NULL DEFAULT 'unpaid',
    subscription_expires_at TEXT,
    plan_type TEXT NOT NULL DEFAULT 'starter',
    razorpay_subscription_id TEXT,
    last_payment_id TEXT,
    odoo_db_name TEXT NOT NULL,
    admin_email TEXT NOT NULL,
    admin_password TEXT NOT NULL,
    cancel_at_period_end INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  // Create system settings table for API keys and configurations
  masterDb.run(`CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`);
});

// Load configuration variables from settings database
function getSetting(key, defaultVal = '') {
  return new Promise((resolve) => {
    masterDb.get("SELECT value FROM system_settings WHERE key = ?", [key], (err, row) => {
      if (err || !row) resolve(defaultVal);
      else resolve(row.value);
    });
  });
}

// Save configuration variables
function saveSetting(key, val) {
  return new Promise((resolve, reject) => {
    masterDb.run("INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)", [key, val], (err) => {
      if (err) reject(err);
      else resolve(true);
    });
  });
}

module.exports = {
  masterDb,
  getSetting,
  saveSetting
};
