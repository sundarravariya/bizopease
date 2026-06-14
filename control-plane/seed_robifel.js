const { masterDb } = require('./database');
const expiry = new Date();
expiry.setFullYear(expiry.getFullYear() + 10);

masterDb.run(
  'INSERT OR REPLACE INTO workspaces (tenant_id, workspace_name, odoo_db_name, admin_email, plan_type, subscription_status, subscription_expires_at, provision_status) VALUES (?,?,?,?,?,?,?,?)',
  ['robifel', 'Robifel', 'robifel', 'robifel.com@gmail.com', 'pro', 'active', expiry.toISOString(), 'ready'],
  function(err) {
    if (err) { console.error('Error:', err.message); process.exit(1); }
    console.log('Robifel workspace seeded successfully');
    process.exit(0);
  }
);
