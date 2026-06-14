const xmlrpc = require('xmlrpc');
const axios = require('axios');
const { getSetting } = require('./database');

/**
 * Creates and provisions a new Odoo database for a tenant.
 * 
 * @param {string} slug - The tenant's subdomain slug (e.g. 'acme')
 * @param {string} companyName - The user's store/company name
 * @param {string} email - The workspace admin's email
 * @param {string} password - The workspace admin's password
 */
async function provisionTenant(slug, companyName, email, password) {
  const dbName = `ws_${slug.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
  
  // Retrieve credentials from database
  const odooUrl = await getSetting('ODOO_URL', 'http://127.0.0.1:8069');
  const masterPassword = await getSetting('ODOO_MASTER_PASSWORD');

  if (!masterPassword) {
    throw new Error('ODOO_MASTER_PASSWORD is not configured in superadmin settings.');
  }

  console.log(`[Provisioner] Creating Odoo database "${dbName}"...`);

  // 1. Create Odoo Database via XML-RPC
  // Odoo exposes database operations on /xmlrpc/2/db
  const dbClient = xmlrpc.createSecureClient({
    url: `${odooUrl}/xmlrpc/2/db`,
    headers: { 'User-Agent': 'BizOpease Provisioner' }
  });

  // Method signature: create_db(master_password, db_name, demo, lang, admin_password, admin_login, admin_phone, admin_country)
  const createDbPromise = () => new Promise((resolve, reject) => {
    dbClient.methodCall('create_db', [
      masterPassword,
      dbName,
      false, // demo
      'en_US', // lang
      password, // admin_password
      email, // admin_login
      '', // admin_phone
      'IN' // admin_country_code
    ], (err, value) => {
      if (err) reject(err);
      else resolve(value);
    });
  });

  try {
    await createDbPromise();
    console.log(`[Provisioner] Database "${dbName}" created successfully.`);
  } catch (err) {
    console.error('[Provisioner] Failed to create database:', err);
    throw new Error(`Odoo database creation failed: ${err.message}`);
  }

  // 2. Authenticate as Admin user on the new DB to get Session ID / User ID
  console.log(`[Provisioner] Authenticating on new DB "${dbName}"...`);
  const commonClient = xmlrpc.createSecureClient({
    url: `${odooUrl}/xmlrpc/2/common`
  });

  const loginPromise = () => new Promise((resolve, reject) => {
    commonClient.methodCall('authenticate', [
      dbName,
      email,
      password,
      {}
    ], (err, uid) => {
      if (err) reject(err);
      else if (!uid) reject(new Error('Authentication failed (uid was false)'));
      else resolve(uid);
    });
  });

  let uid;
  try {
    uid = await loginPromise();
    console.log(`[Provisioner] Authenticated successfully, UID: ${uid}`);
  } catch (err) {
    throw new Error(`Login failed on new DB: ${err.message}`);
  }

  // 3. Connect to Object Client to install modules & configure company name
  const objectClient = xmlrpc.createSecureClient({
    url: `${odooUrl}/xmlrpc/2/object`
  });

  const executeKw = (model, method, args, kwargs = {}) => new Promise((resolve, reject) => {
    objectClient.methodCall('execute_kw', [
      dbName,
      uid,
      password,
      model,
      method,
      args,
      kwargs
    ], (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });

  // Configure Company Name
  try {
    console.log(`[Provisioner] Setting company name to "${companyName}"...`);
    const companies = await executeKw('res.company', 'search', [[['id', '=', 1]]]);
    if (companies && companies.length > 0) {
      await executeKw('res.company', 'write', [[1], { name: companyName.trim() }]);
    }
  } catch (err) {
    console.warn('[Provisioner] Failed to set company name (non-fatal):', err.message);
  }

  // Install custom modules (flipkart_os, b2b_os, robifel_hr)
  try {
    console.log('[Provisioner] Installing custom addons (flipkart_os, b2b_os, robifel_hr)...');
    // Search for the modules first
    const moduleNames = ['flipkart_os', 'b2b_os', 'robifel_hr'];
    const modules = await executeKw('ir.module.module', 'search_read', [
      [['name', 'in', moduleNames]],
      ['id', 'name', 'state']
    ]);

    if (modules && modules.length > 0) {
      const ids = modules.map(m => m.id);
      // Mark for installation
      await executeKw('ir.module.module', 'button_immediate_install', [ids]);
      console.log('[Provisioner] Installation command triggered successfully.');
    } else {
      console.warn('[Provisioner] Modules not found in ir.module.module search! Please make sure addons path is configured.');
    }
  } catch (err) {
    console.error('[Provisioner] Failed to install custom addons:', err);
    throw new Error(`Addons installation failed: ${err.message}`);
  }

  return dbName;
}

module.exports = {
  provisionTenant
};
