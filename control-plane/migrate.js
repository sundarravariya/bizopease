// Migrate master.db schema and seed the robifel workspace
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, 'master.db'));

db.serialize(() => {
  // Add missing columns (ALTER TABLE adds one at a time in SQLite)
  const migrations = [
    "ALTER TABLE workspaces ADD COLUMN provision_status TEXT NOT NULL DEFAULT 'ready'",
    "ALTER TABLE workspaces ADD COLUMN provision_error TEXT DEFAULT ''",
    "ALTER TABLE workspaces ADD COLUMN nginx_configured INTEGER DEFAULT 0",
    "ALTER TABLE workspaces ADD COLUMN updated_at TEXT DEFAULT CURRENT_TIMESTAMP"
  ];

  migrations.forEach(sql => {
    db.run(sql, err => {
      if (err && !err.message.includes('duplicate column')) {
        console.warn('Migration note:', err.message);
      }
    });
  });

  // Drop old columns that are no longer needed (SQLite doesn't support DROP COLUMN in older versions)
  // Instead just leave admin_password - it's harmless

  // Create new tables
  db.run(`CREATE TABLE IF NOT EXISTS audit_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    action     TEXT NOT NULL,
    tenant_id  TEXT,
    details    TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_log(tenant_id)`);

  // Seed robifel workspace (existing production tenant)
  const expiry = new Date();
  expiry.setFullYear(expiry.getFullYear() + 10);

  db.run(
    `INSERT OR REPLACE INTO workspaces
      (tenant_id, workspace_name, odoo_db_name, admin_email, plan_type,
       subscription_status, subscription_expires_at, provision_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ['robifel', 'Robifel', 'robifel', 'robifel.com@gmail.com',
     'pro', 'active', expiry.toISOString(), 'ready'],
    function(err) {
      if (err) console.error('Seed error:', err.message);
      else console.log('Robifel workspace seeded OK');
    }
  );

  // Check final state
  db.all('SELECT tenant_id, workspace_name, odoo_db_name, admin_email, subscription_status FROM workspaces', [], (err, rows) => {
    if (err) { console.error(err); return; }
    console.log('\nRegistered workspaces:');
    rows.forEach(r => console.log(' -', r.tenant_id, '|', r.workspace_name, '|', r.odoo_db_name, '|', r.admin_email, '|', r.subscription_status));
    db.close(() => process.exit(0));
  });
});
