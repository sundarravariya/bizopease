/**
 * BizOpease — Odoo Tenant Provisioner (Path-Based Routing)
 * ==========================================================
 * Tenant access URL: https://bizopease.robifel.in/{slug}
 * (NO subdomains — one domain, paths per tenant)
 *
 * Steps:
 *  1. Create Odoo DB via /web/database/create JSON-RPC
 *  2. Poll until DB is ready (up to 3 minutes)
 *  3. Authenticate → get session cookie
 *  4. Set company name + INR currency
 *  5. Install custom addons (b2b_os, flipkart_os, robifel_hr)
 *
 * NO Nginx blocks needed per tenant — all routing is path-based
 * in the React SPA which reads the URL path to pick the Odoo DB.
 */

const { getSetting } = require('./database');
const { execSync, exec } = require('child_process');
const util = require('util');
const fs = require('fs');
const execAsync = util.promisify(exec);

// Odoo CLI provisioning. The HTTP database manager is disabled (list_db=False),
// so new tenant DBs are created with the Odoo CLI instead — which bypasses the
// manager entirely and never weakens that security setting.
const ODOO_BIN = '/usr/bin/odoo';
const ODOO_CONF = '/etc/odoo/odoo.conf';
const VALID_DB = /^[A-Za-z0-9_]+$/;

async function odooCli(dbName, extraArgs, timeoutMs = 300000) {
  if (!VALID_DB.test(dbName)) throw new Error(`Unsafe DB name: ${dbName}`);
  const cmd = `sudo -u odoo ${ODOO_BIN} -c ${ODOO_CONF} -d ${dbName} ` +
    `${extraArgs} --stop-after-init --no-http --max-cron-threads=0 2>&1`;
  const { stdout } = await execAsync(cmd, { timeout: timeoutMs, maxBuffer: 1024 * 1024 * 32 });
  return stdout || '';
}

// ─── HTTP HELPER ──────────────────────────────────────────────────────────────

// The DB this provisioning run targets. Set once per provisionTenant() so every
// authenticated call carries X-Forwarded-Host=<db>.local — required because
// Odoo's dbfilter=^%d$ logs out a session whose DB doesn't match the request host.
let _provHost = '';

async function odooPost(odooUrl, endpoint, payload, cookie = '') {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers['Cookie'] = cookie;
  if (_provHost) { headers['X-Forwarded-Host'] = _provHost; headers['X-Forwarded-Proto'] = 'https'; }

  const res = await fetch(odooUrl + endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); }
  catch { return { ok: false, status: res.status, data: { error: text }, cookie: '' }; }

  return { ok: res.ok, status: res.status, data, cookie: res.headers.get('set-cookie') || '' };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── STEP 1: CREATE DATABASE ──────────────────────────────────────────────────

function dbExistsSync(dbName) {
  try {
    const out = execSync(
      `sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${dbName}'"`,
      { timeout: 8000 }
    ).toString().trim();
    return out === '1';
  } catch { return false; }
}

async function createOdooDb(dbName) {
  if (dbExistsSync(dbName)) {
    console.warn(`[Provisioner] DB "${dbName}" already exists — skipping base init.`);
    return;
  }
  console.log(`[Provisioner] Creating + initialising Odoo DB "${dbName}" (base) ...`);
  // Creates the Postgres DB and installs `base` with no demo data.
  await odooCli(dbName, '-i base --without-demo=all', 300000);
  if (!dbExistsSync(dbName)) throw new Error(`DB "${dbName}" was not created by Odoo CLI`);
  console.log(`[Provisioner] ✓ DB "${dbName}" created.`);
}

// Set the admin login + password and company name/currency via `odoo shell`.
async function setupAdminAndCompany(dbName, adminEmail, adminPassword, companyName) {
  console.log(`[Provisioner] Configuring admin user + company for "${dbName}" ...`);
  const py = [
    `admin = env.ref('base.user_admin')`,
    `admin.write({'login': ${JSON.stringify(adminEmail)}, 'password': ${JSON.stringify(adminPassword)}})`,
    `co = env['res.company'].browse(1)`,
    `co.write({'name': ${JSON.stringify(companyName)}})`,
    `inr = env['res.currency'].search([('name','=','INR')], limit=1)`,
    `inr and co.write({'currency_id': inr.id})`,
    `env.cr.commit()`,
    `print('SETUP_OK')`,
    ``,
  ].join('\n');
  const tmp = `/tmp/prov_setup_${dbName}.py`;
  fs.writeFileSync(tmp, py, { mode: 0o644 });
  try {
    const { stdout } = await execAsync(
      `cat ${tmp} | sudo -u odoo ${ODOO_BIN} shell -c ${ODOO_CONF} -d ${dbName} --no-http --max-cron-threads=0 2>&1`,
      { timeout: 120000, maxBuffer: 1024 * 1024 * 16 }
    );
    if (!/SETUP_OK/.test(stdout)) throw new Error(`admin/company setup did not confirm: ${stdout.slice(-300)}`);
    console.log(`[Provisioner] ✓ Admin + company configured.`);
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

// ─── STEP 2: WAIT FOR DB READY ────────────────────────────────────────────────

async function waitForDb(odooUrl, dbName, email, password, maxMs = 180000) {
  console.log(`[Provisioner] Waiting for DB "${dbName}" to accept logins...`);
  const deadline = Date.now() + maxMs;

  while (Date.now() < deadline) {
    try {
      const r = await odooPost(odooUrl, '/web/session/authenticate', {
        jsonrpc: '2.0', method: 'call', id: 1,
        params: { db: dbName, login: email, password }
      });

      if (r.ok && r.data.result?.uid) {
        console.log(`[Provisioner] ✓ DB ready. Session UID: ${r.data.result.uid}`);
        return r.cookie;
      }
    } catch (e) {
      // Keep polling
    }
    await sleep(5000);
  }

  throw new Error(`Timeout: DB "${dbName}" did not become ready within ${maxMs / 1000}s`);
}

// ─── STEP 3: JSON-RPC CALL ────────────────────────────────────────────────────

async function callKw(odooUrl, cookie, model, method, args, kwargs = {}) {
  const r = await odooPost(odooUrl, '/web/dataset/call_kw', {
    jsonrpc: '2.0', method: 'call', id: 1,
    params: { model, method, args, kwargs, context: { lang: 'en_US' } }
  }, cookie);

  if (r.data?.error) {
    throw new Error(`${model}.${method} failed: ${r.data.error?.data?.message || r.data.error?.message || 'Unknown error'}`);
  }
  return r.data?.result;
}

// ─── STEP 4: COMPANY NAME + CURRENCY ─────────────────────────────────────────

async function setupCompany(odooUrl, cookie, companyName) {
  console.log(`[Provisioner] Setting company name → "${companyName}" (INR currency)...`);
  try {
    // Find INR currency ID
    const currencies = await callKw(odooUrl, cookie, 'res.currency', 'search_read',
      [[['name', '=', 'INR']]], { fields: ['id', 'name'], limit: 1 });
    const currencyId = currencies?.[0]?.id || false;

    const vals = { name: companyName.trim() };
    if (currencyId) vals.currency_id = currencyId;

    await callKw(odooUrl, cookie, 'res.company', 'write', [[1], vals]);
    console.log(`[Provisioner] ✓ Company configured.`);
  } catch (err) {
    console.warn(`[Provisioner] Company setup non-fatal error: ${err.message}`);
  }
}

// ─── STEP 5: INSTALL CUSTOM ADDONS (CLI) ─────────────────────────────────────

async function installAddons(dbName, addons = ['b2b_os', 'flipkart_os', 'robifel_hr']) {
  console.log(`[Provisioner] Installing addons via CLI: ${addons.join(', ')} ...`);
  try {
    await odooCli(dbName, `-i ${addons.join(',')} --without-demo=all`, 420000);
    console.log('[Provisioner] ✓ Addons installed.');
  } catch (err) {
    // Non-fatal: the workspace is still usable with base + whatever installed.
    console.error(`[Provisioner] Addon install error (non-fatal): ${err.message.slice(0, 300)}`);
  }
}

// ─── MAIN EXPORT ─────────────────────────────────────────────────────────────

/**
 * Provision a new BizOpease tenant.
 * Tenant accesses portal at: https://bizopease.robifel.in/{slug}
 * Odoo database name: ws_{slug}
 *
 * @returns {string} The Odoo database name created (e.g. "ws_acme")
 */
async function provisionTenant(slug, companyName, email, password) {
  const cleanSlug = slug.toLowerCase().replace(/[^a-z0-9]/g, '');
  const dbName = `ws_${cleanSlug}`;
  const portalUrl = `https://bizopease.robifel.in/${cleanSlug}`;

  const odooUrl = (await getSetting('ODOO_URL')) || 'http://127.0.0.1:8069';
  // DB creation uses the Odoo CLI (not the HTTP db-manager), so no master
  // password is required — the control-plane runs the CLI as the odoo user.

  console.log(`\n[Provisioner] ${'═'.repeat(55)}`);
  console.log(`[Provisioner] Tenant:   ${cleanSlug}`);
  console.log(`[Provisioner] Odoo DB:  ${dbName}`);
  console.log(`[Provisioner] Company:  ${companyName}`);
  console.log(`[Provisioner] Admin:    ${email}`);
  console.log(`[Provisioner] Portal:   ${portalUrl}`);
  console.log(`[Provisioner] ${'═'.repeat(55)}\n`);

  // HTTP verification at the end must resolve to this DB under dbfilter=^%d$.
  _provHost = `${dbName}.local`;

  // 1. Create + initialise the database (base, no demo) via the Odoo CLI.
  await createOdooDb(dbName);

  // 2. Set the admin login/password + company name/currency.
  await setupAdminAndCompany(dbName, email, password, companyName);

  // 3. Install the custom addons (non-fatal if one fails).
  await installAddons(dbName);

  // 4. Verify the tenant can authenticate over HTTP (proves routing + creds).
  await waitForDb(odooUrl, dbName, email, password, 60000);

  console.log(`\n[Provisioner] ✅ "${cleanSlug}" ready!`);
  console.log(`[Provisioner]    BizOpease Portal: ${portalUrl}`);
  console.log(`[Provisioner]    Odoo DB: ${dbName}\n`);

  return dbName;
}

/** Check whether a tenant DB already exists in PostgreSQL */
async function dbExists(slug) {
  const dbName = `ws_${slug.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
  try {
    const out = execSync(
      `sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${dbName}'"`,
      { timeout: 5000 }
    ).toString().trim();
    return out === '1';
  } catch { return false; }
}

module.exports = { provisionTenant, dbExists };
