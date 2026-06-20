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
const { execSync } = require('child_process');

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

async function createOdooDb(odooUrl, masterPassword, dbName, adminEmail, adminPassword) {
  console.log(`[Provisioner] Creating Odoo DB "${dbName}" ...`);

  // /web/database/create is a type='http' endpoint: it takes FORM fields (not a
  // JSON-RPC body) and, on success, issues a 303 redirect to the new DB. It also
  // blocks while Odoo initialises base modules (can take ~30-60s).
  const form = new URLSearchParams({
    master_pwd: masterPassword,
    name: dbName,
    lang: 'en_US',
    password: adminPassword,
    login: adminEmail,
    country_code: 'IN',
    phone: '',
    demo: 'false',
  });

  let res;
  try {
    res = await fetch(odooUrl + '/web/database/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Forwarded-Host': `${dbName}.local`,
        'X-Forwarded-Proto': 'https',
      },
      body: form.toString(),
      redirect: 'manual',
    });
  } catch (e) {
    throw new Error(`DB create request failed: ${e.message}`);
  }

  // 3xx (manual redirect) = created successfully.
  if (res.status >= 300 && res.status < 400) {
    console.log(`[Provisioner] ✓ DB "${dbName}" created.`);
    return;
  }

  const text = await res.text().catch(() => '');
  if (/already exists|duplicate database/i.test(text)) {
    console.warn(`[Provisioner] DB "${dbName}" already exists — continuing with existing.`);
    return;
  }
  // type='http' renders an HTML error page (HTTP 200) on failure.
  const m = text.match(/<p[^>]*>\s*([^<]{5,250}?)\s*<\/p>/i);
  throw new Error(`Odoo DB create failed (HTTP ${res.status}): ${m ? m[1].trim() : text.slice(0, 200) || 'unknown'}`);
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

// ─── STEP 5: INSTALL CUSTOM ADDONS ───────────────────────────────────────────

async function installAddons(odooUrl, cookie) {
  const wanted = ['b2b_os', 'flipkart_os', 'robifel_hr'];
  console.log(`[Provisioner] Installing addons: ${wanted.join(', ')} ...`);

  try {
    const found = await callKw(odooUrl, cookie, 'ir.module.module', 'search_read',
      [[['name', 'in', wanted]]],
      { fields: ['id', 'name', 'state'], limit: 10 }
    );

    if (!found?.length) {
      console.warn('[Provisioner] ⚠ Custom addons not found in module list. Verify addons_path in odoo.conf.');
      return;
    }

    const toInstall = found.filter(m => m.state !== 'installed');
    if (!toInstall.length) {
      console.log('[Provisioner] ✓ All custom addons already installed.');
      return;
    }

    const ids = toInstall.map(m => m.id);
    console.log(`[Provisioner] Installing: ${toInstall.map(m => m.name).join(', ')} (IDs: ${ids})`);
    await callKw(odooUrl, cookie, 'ir.module.module', 'button_immediate_install', [ids]);
    console.log('[Provisioner] ✓ Addon installation triggered (runs in background on Odoo).');
  } catch (err) {
    console.error(`[Provisioner] Addon install error (non-fatal): ${err.message}`);
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
  const masterPassword = await getSetting('ODOO_MASTER_PASSWORD');

  if (!masterPassword) {
    throw new Error('ODOO_MASTER_PASSWORD not set. Configure it in SuperAdmin → Settings.');
  }

  console.log(`\n[Provisioner] ${'═'.repeat(55)}`);
  console.log(`[Provisioner] Tenant:   ${cleanSlug}`);
  console.log(`[Provisioner] Odoo DB:  ${dbName}`);
  console.log(`[Provisioner] Company:  ${companyName}`);
  console.log(`[Provisioner] Admin:    ${email}`);
  console.log(`[Provisioner] Portal:   ${portalUrl}`);
  console.log(`[Provisioner] ${'═'.repeat(55)}\n`);

  // All authenticated calls below must resolve to this DB under dbfilter=^%d$.
  _provHost = `${dbName}.local`;

  // 1. Create the PostgreSQL + Odoo database
  await createOdooDb(odooUrl, masterPassword, dbName, email, password);

  // 2. Wait for Odoo to initialise modules, get session cookie
  const cookie = await waitForDb(odooUrl, dbName, email, password);

  // 3. Set company name + INR currency
  await setupCompany(odooUrl, cookie, companyName);

  // 4. Install our custom addons
  await installAddons(odooUrl, cookie);

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
