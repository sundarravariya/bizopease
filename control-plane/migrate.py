import sqlite3, datetime

db = sqlite3.connect('/var/www/bizopease-saas/master.db')
c = db.cursor()

# Add missing columns (ignore if already exist)
for col_sql in [
    "ALTER TABLE workspaces ADD COLUMN provision_status TEXT NOT NULL DEFAULT 'ready'",
    "ALTER TABLE workspaces ADD COLUMN provision_error TEXT DEFAULT ''",
    "ALTER TABLE workspaces ADD COLUMN nginx_configured INTEGER DEFAULT 0",
    "ALTER TABLE workspaces ADD COLUMN updated_at TEXT DEFAULT CURRENT_TIMESTAMP",
]:
    try:
        c.execute(col_sql)
        print('OK:', col_sql[:60])
    except Exception as e:
        print('Skip:', str(e)[:60])

# Create audit_log if missing
c.execute('''CREATE TABLE IF NOT EXISTS audit_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    action     TEXT NOT NULL,
    tenant_id  TEXT,
    details    TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
)''')

# Seed robifel workspace
expiry = (datetime.datetime.now() + datetime.timedelta(days=3650)).isoformat()
c.execute('''INSERT OR REPLACE INTO workspaces
  (tenant_id, workspace_name, odoo_db_name, admin_email, admin_password,
   plan_type, subscription_status, subscription_expires_at, provision_status)
VALUES (?,?,?,?,?,?,?,?,?)''',
  ('robifel', 'Robifel', 'robifel', 'robifel.com@gmail.com',
   'managed_by_odoo', 'pro', 'active', expiry, 'ready'))

db.commit()

# Verify
rows = c.execute('SELECT tenant_id, workspace_name, odoo_db_name, admin_email, subscription_status FROM workspaces').fetchall()
print('\nRegistered workspaces:')
for r in rows:
    print(' -', ' | '.join(str(x) for x in r))

db.close()
print('\nMigration complete.')
