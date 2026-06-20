const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const { masterDb, getSetting, saveSetting } = require('./database');
const { provisionTenant } = require('./provisioner');

const app = express();
app.use(cors({ origin: ['https://bizopease.robifel.in', 'https://dashboard.robifel.in'], credentials: true }));
app.set('trust proxy', 1);

// Webhook route needs raw body for signature verification
app.post('/api/subscription/webhook', express.raw({ type: '*/*' }), handleWebhook);

app.use(express.json());

const PORT = process.env.PORT || 5000;

// ─── RUNTIME CONFIG (reloaded on settings save) ──────────────────────────────
let JWT_SECRET = process.env.JWT_SECRET || 'bizopease_jwt_secret_key_change_me';
let SA_USERNAME = 'bizopeaseadmin';
let SA_PASSWORD = 'BizOpeaseAdminPass123!';
let PLAN_PRICE_STARTER = 1000;
let PLAN_PRICE_PRO = 2500;
let RAZORPAY_KEY_ID = '';
let RAZORPAY_KEY_SECRET = '';
let RAZORPAY_PLAN_ID_STARTER = '';
let RAZORPAY_PLAN_ID_PRO = '';
let RAZORPAY_WEBHOOK_SECRET = '';
let ODOO_URL = 'http://127.0.0.1:8069';
let ODOO_MASTER_PASSWORD = '';
let ADMIN_OTP_ENABLED = false;
let SMTP_HOST = '';
let SMTP_PORT = 587;
let SMTP_USER = '';
let SMTP_PASS = '';
let SMTP_FROM = '';
let QUEEN_ADMIN_LOGIN = 'admin';
let QUEEN_ADMIN_PASSWORD = '';
let QUEEN_URL = 'http://localhost:8070';
let QUEEN_DB = '';

function loadSettings(cb) {
  masterDb.all("SELECT key, value FROM system_settings", [], (err, rows) => {
    if (!err && rows) {
      rows.forEach(r => {
        if (r.key === 'JWT_SECRET' && r.value) JWT_SECRET = r.value;
        if (r.key === 'SUPERADMIN_USERNAME' && r.value) SA_USERNAME = r.value;
        if (r.key === 'SUPERADMIN_PASSWORD' && r.value) SA_PASSWORD = r.value;
        if (r.key === 'PLAN_PRICE_STARTER' && r.value) PLAN_PRICE_STARTER = parseFloat(r.value) || 1000;
        if (r.key === 'PLAN_PRICE_PRO' && r.value) PLAN_PRICE_PRO = parseFloat(r.value) || 2500;
        if (r.key === 'RAZORPAY_KEY_ID' && r.value) RAZORPAY_KEY_ID = r.value;
        if (r.key === 'RAZORPAY_KEY_SECRET' && r.value) RAZORPAY_KEY_SECRET = r.value;
        if (r.key === 'RAZORPAY_PLAN_ID_STARTER' && r.value) RAZORPAY_PLAN_ID_STARTER = r.value;
        if (r.key === 'RAZORPAY_PLAN_ID_PRO' && r.value) RAZORPAY_PLAN_ID_PRO = r.value;
        if (r.key === 'RAZORPAY_WEBHOOK_SECRET' && r.value) RAZORPAY_WEBHOOK_SECRET = r.value;
        if (r.key === 'ODOO_URL' && r.value) ODOO_URL = r.value;
        if (r.key === 'ODOO_MASTER_PASSWORD' && r.value) ODOO_MASTER_PASSWORD = r.value;
        if (r.key === 'ADMIN_OTP_ENABLED') ADMIN_OTP_ENABLED = r.value === 'true';
        if (r.key === 'SMTP_HOST' && r.value) SMTP_HOST = r.value;
        if (r.key === 'SMTP_PORT' && r.value) SMTP_PORT = parseInt(r.value) || 587;
        if (r.key === 'SMTP_USER' && r.value) SMTP_USER = r.value;
        if (r.key === 'SMTP_PASS' && r.value) SMTP_PASS = r.value;
        if (r.key === 'SMTP_FROM' && r.value) SMTP_FROM = r.value;
        if (r.key === 'QUEEN_ADMIN_LOGIN' && r.value) QUEEN_ADMIN_LOGIN = r.value;
        if (r.key === 'QUEEN_ADMIN_PASSWORD' && r.value) QUEEN_ADMIN_PASSWORD = r.value;
        if (r.key === 'QUEEN_URL' && r.value) QUEEN_URL = r.value;
        if (r.key === 'QUEEN_DB' && r.value) QUEEN_DB = r.value;
      });
    }
    if (cb) cb();
  });
}

// ─── RATE LIMITER (simple in-memory) ─────────────────────────────────────────
const loginAttempts = new Map();
function loginLimiter(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const maxAttempts = 10;
  const entry = loginAttempts.get(ip) || { count: 0, resetAt: now + windowMs };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + windowMs; }
  entry.count++;
  loginAttempts.set(ip, entry);
  if (entry.count > maxAttempts) return res.status(429).json({ error: 'Too many login attempts. Try again in 15 minutes.' });
  next();
}

// ─── AUTH MIDDLEWARE ──────────────────────────────────────────────────────────
function requireSuperAdmin(req, res, next) {
  const token = (req.headers['authorization'] || '').split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access token required' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });
    req.admin = decoded;
    next();
  } catch {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
}

// Gate for the Queenfinger (B2B) RPC proxy. Only a caller who authenticated
// against the queenfinger Odoo database (and thus holds a 'queen' JWT bound to
// that db) may reach queenfinger data. This enforces DB-level separation:
// robifel users (role 'tenant', db robifel) and anonymous callers are rejected,
// so there is no cross-database data leak through the shared admin proxy.
function requireQueenAuth(req, res, next) {
  // Header for JSON/fetch callers; query param for raw browser asset GETs
  // (<img>/<a> can't set an Authorization header).
  const token = (req.headers['authorization'] || '').split(' ')[1] || req.query.token;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'queen' || decoded.db !== QUEEN_DB) {
      return res.status(403).json({ error: 'Not authorized for this database' });
    }
    req.queenUser = decoded;
    next();
  } catch {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
}

// ─── STATIC FILES ─────────────────────────────────────────────────────────────
// SECURITY: do NOT serve __dirname statically -- it would expose master.db, server.js
// and all secrets over HTTP. The HTML panels are served explicitly by the routes
// near the bottom (login.html, superadmin.html, index.html).

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function tailFile(filePath, numLines) {
  try {
    if (!fs.existsSync(filePath)) return '';
    const stat = fs.statSync(filePath);
    const bufferSize = Math.min(stat.size, 65536);
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(bufferSize);
    fs.readSync(fd, buffer, 0, bufferSize, stat.size - bufferSize);
    fs.closeSync(fd);
    const lines = buffer.toString('utf-8').split('\n');
    return lines.slice(Math.max(0, lines.length - numLines)).join('\n');
  } catch (e) {
    return 'Error reading log: ' + e.message;
  }
}

function generateOdooSlug(name) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
}

// ─── RAZORPAY HELPERS ─────────────────────────────────────────────────────────
async function razorpayRequest(endpoint, method, body) {
  const authHeader = 'Basic ' + Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64');
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', 'Authorization': authHeader }
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`https://api.razorpay.com/v1${endpoint}`, opts);
  return r;
}

// ─── WEBHOOK ──────────────────────────────────────────────────────────────────
function handleWebhook(req, res) {
  const signature = req.headers['x-razorpay-signature'];
  const rawBody = req.body.toString();

  // SECURITY: signature is MANDATORY -- never process an unverified webhook.
  if (!RAZORPAY_WEBHOOK_SECRET) {
    console.error('[Webhook] RAZORPAY_WEBHOOK_SECRET not configured -- rejecting');
    return res.status(503).json({ error: 'Webhook processing not configured' });
  }
  if (!signature) return res.status(400).json({ error: 'Missing signature' });
  {
    const expected = crypto.createHmac('sha256', RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest('hex');
    const a = Buffer.from(expected), b = Buffer.from(signature);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(400).json({ error: 'Signature mismatch' });
    }
  }

  let payload;
  try { payload = JSON.parse(rawBody); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }

  const event = payload.event;
  console.log(`[Webhook] Event: ${event}`);

  if (event === 'subscription.charged') {
    const sub = payload.payload.subscription.entity;
    const payment = payload.payload.payment.entity;
    const tenantId = (sub.notes && (sub.notes.workspace || sub.notes.tenant_id)) || '';
    const nextExpiry = new Date(sub.current_end * 1000);

    if (tenantId) {
      masterDb.run(
        "UPDATE workspaces SET subscription_status='active', subscription_expires_at=?, razorpay_subscription_id=?, last_payment_id=? WHERE tenant_id=?",
        [nextExpiry.toISOString(), sub.id, payment.id, tenantId],
        err => { if (err) console.error('[Webhook] DB update failed:', err); }
      );
    }
  }

  if (event === 'subscription.halted' || event === 'subscription.cancelled') {
    const sub = payload.payload.subscription.entity;
    const tenantId = (sub.notes && (sub.notes.workspace || sub.notes.tenant_id)) || '';
    if (tenantId) {
      masterDb.run("UPDATE workspaces SET subscription_status='unpaid' WHERE tenant_id=?", [tenantId]);
    }
  }

  res.json({ status: 'ok' });
}

// ════════════════════════════════════════════════════════════════════════
// PUBLIC ROUTES: SIGNUP FLOW
// ════════════════════════════════════════════════════════════════════════

app.get('/api/signup/check-availability', (req, res) => {
  const slug = generateOdooSlug((req.query.slug || '').toString());
  if (!slug || slug.length < 3) return res.json({ available: false, reason: 'Minimum 3 characters' });
  masterDb.get("SELECT tenant_id FROM workspaces WHERE tenant_id=?", [slug], (err, row) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    res.json({ available: !row, reason: row ? 'Already taken' : null });
  });
});

app.post('/api/signup/pre-register', loginLimiter, async (req, res) => {
  const { slug, workspaceName, email, password, plan } = req.body;
  const cleanSlug = generateOdooSlug(slug || '');
  if (!cleanSlug || !workspaceName || !email || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const selectedPlanId = plan === 'pro' ? RAZORPAY_PLAN_ID_PRO : RAZORPAY_PLAN_ID_STARTER;

  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET || !selectedPlanId) {
    return res.json({ razorpayEnabled: false, slug: cleanSlug, plan: plan || 'starter',
      message: 'Payment gateway not configured — signing up in trial mode.' });
  }

  try {
    const r = await razorpayRequest('/subscriptions', 'POST', {
      plan_id: selectedPlanId,
      total_count: 120,
      quantity: 1,
      customer_notify: 1,
      notes: { workspace: cleanSlug, tenant_id: cleanSlug }
    });
    const data = await r.json();
    if (!r.ok) return res.status(500).json({ error: data.error?.description || 'Razorpay error' });
    res.json({ razorpayEnabled: true, keyId: RAZORPAY_KEY_ID, subscriptionId: data.id,
      amount: plan === 'pro' ? PLAN_PRICE_PRO * 100 : PLAN_PRICE_STARTER * 100, slug: cleanSlug, plan });
  } catch (e) {
    res.status(500).json({ error: 'Payment gateway unreachable' });
  }
});

app.post('/api/signup/finalize', async (req, res) => {
  const { slug, workspaceName, email, password, plan,
    razorpay_payment_id, razorpay_subscription_id, razorpay_signature } = req.body;
  const cleanSlug = generateOdooSlug(slug || '');

  // Input validation.
  if (!cleanSlug || !workspaceName || !email || !password) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // SECURITY: if Razorpay is configured, a verified payment is MANDATORY --
  // otherwise an attacker could omit the subscription id to get a free workspace.
  if (RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET) {
    if (!razorpay_subscription_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(402).json({ error: 'Payment required' });
    }
    const expected = crypto.createHmac('sha256', RAZORPAY_KEY_SECRET)
      .update(`${razorpay_payment_id}|${razorpay_subscription_id}`).digest('hex');
    if (expected !== razorpay_signature) return res.status(400).json({ error: 'Payment signature invalid' });
  }

  try {
    const dbName = await provisionTenant(cleanSlug, workspaceName, email, password);
    const expiry = new Date(); expiry.setDate(expiry.getDate() + 30);
    masterDb.run(
      `INSERT OR REPLACE INTO workspaces
        (tenant_id, workspace_name, subscription_status, subscription_expires_at, plan_type,
         razorpay_subscription_id, last_payment_id, odoo_db_name, admin_email)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [cleanSlug, workspaceName.trim(), 'active', expiry.toISOString(),
       plan || 'starter', razorpay_subscription_id || 'trial', razorpay_payment_id || '',
       dbName, email],
      err => {
        if (err) return res.status(500).json({ error: 'Provisioned but registry failed: ' + err.message });
        res.json({ success: true, dbName, message: 'Workspace created successfully!' });
      }
    );
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════════════
// TENANT AUTH ROUTES  (used by login.html and React SPA)
// ════════════════════════════════════════════════════════════════════════

/**
 * POST /api/auth/find-workspace
 * Step 1 of login: given an email, find which workspace (Odoo DB) it belongs to.
 * Does NOT require a password — just finds the mapping.
 */
app.post('/api/auth/find-workspace', loginLimiter, (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'Email is required' });

  // Look up by admin_email in workspaces registry
  masterDb.get(
    'SELECT tenant_id, workspace_name, odoo_db_name, subscription_status, is_queen_tenant FROM workspaces WHERE LOWER(admin_email) = ?',
    [email],
    (err, ws) => {
      if (err) return res.status(500).json({ error: 'Registry lookup failed' });
      const reply = (w) => res.json({
        tenantId: w.tenant_id,
        workspaceName: w.workspace_name,
        odooDb: w.odoo_db_name || ('ws_' + w.tenant_id),
        status: w.subscription_status,
        otpEnabled: ADMIN_OTP_ENABLED,
        isQueenTenant: w.is_queen_tenant === 1,
      });
      if (ws) return reply(ws);

      // Not a workspace owner — fall back to the employee/user map.
      masterDb.get(
        `SELECT w.tenant_id, w.workspace_name, w.odoo_db_name, w.subscription_status, w.is_queen_tenant
           FROM workspace_users u JOIN workspaces w ON w.tenant_id = u.tenant_id
          WHERE u.email = ? LIMIT 1`,
        [email],
        (e2, ws2) => {
          if (e2) return res.status(500).json({ error: 'Registry lookup failed' });
          if (!ws2) return res.status(404).json({ error: 'No workspace found for this email address. Contact your administrator.' });
          reply(ws2);
        }
      );
    }
  );
});

/**
 * POST /api/queen/authenticate
 * Authenticates a user directly against the Queenfinger Odoo instance (port 8070).
 * Used for queen-tenant workspaces — these users have no port-8069 Odoo account.
 */
app.post('/api/queen/authenticate', loginLimiter, async (req, res) => {
  const { login, password } = req.body || {};
  if (!login || !password) return res.status(400).json({ error: 'login and password required' });
  if (!QUEEN_DB) return res.status(503).json({ error: 'B2B database not configured. Set QUEEN_DB in settings.' });
  const queenBase = QUEEN_URL || 'http://localhost:8070';
  try {
    const r = await fetch(`${queenBase}/web/session/authenticate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Odoo dbfilter=^%d$ : first label of X-Forwarded-Host must equal the db
        'X-Forwarded-Host': `${QUEEN_DB}.local`,
        'X-Forwarded-Proto': 'https',
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'call',
        params: { db: QUEEN_DB, login, password } }),
    });
    const j = await r.json();
    if (!j.result?.uid) return res.status(401).json({ error: 'Invalid credentials' });
    const result = j.result;
    // Issue a 'queen' JWT bound to the queenfinger db. The portal sends this as a
    // Bearer token on /api/queen/rpc; requireQueenAuth verifies it, so only users
    // who proved queenfinger credentials can reach queenfinger data.
    const token = jwt.sign(
      { role: 'queen', db: QUEEN_DB, uid: result.uid, email: login },
      JWT_SECRET, { expiresIn: '7d' }
    );
    res.json({
      token,
      uid: result.uid,
      name: result.name || login,
      username: result.username || login,
      company_id: Array.isArray(result.company_id) ? result.company_id : [1, ''],
      company_name: Array.isArray(result.company_id) ? result.company_id[1] : '',
      is_admin: !!(result.is_system || result.is_admin),
      db: QUEEN_DB,
    });
  } catch (e) {
    res.status(500).json({ error: 'B2B database unreachable' });
  }
});

/**
 * POST /api/workspace/register-users
 * The portal (logged in as a workspace admin) pushes its Odoo res.users logins
 * here so non-owner employees can resolve their workspace at login. Authorized
 * by the caller's same-origin Odoo session cookie — we ask Odoo who they are and
 * trust ONLY the DB that session is bound to (clients can't spoof another DB).
 * Body: { emails: string[] }
 */
app.post('/api/workspace/register-users', async (req, res) => {
  let emails = (req.body && req.body.emails) || [];
  if (typeof (req.body || {}).email === 'string') emails = [req.body.email];
  if (!Array.isArray(emails)) return res.status(400).json({ error: 'emails[] required' });
  const clean = [...new Set(emails.map(e => String(e || '').trim().toLowerCase()).filter(e => e.includes('@')))];
  if (!clean.length) return res.json({ registered: 0 });

  // Verify the caller via their Odoo session cookie.
  const cookie = req.headers['cookie'] || '';
  const m = /(?:^|;\s*)session_id=([^;]+)/.exec(cookie);
  if (!m) return res.status(401).json({ error: 'Not authenticated' });
  let sessDb = null, sessUid = null, sessUsername = null;
  try {
    const r = await fetch((ODOO_URL || 'http://127.0.0.1:8069') + '/web/session/get_session_info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': 'session_id=' + m[1] },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'call', id: 1, params: {} })
    });
    const data = await r.json();
    sessUid = data?.result?.uid || null;
    sessDb = data?.result?.db || null;
    sessUsername = (data?.result?.username || data?.result?.login || '').toLowerCase().trim() || null;
  } catch (e) {
    return res.status(503).json({ error: 'Could not verify session with Odoo' });
  }
  if (!sessUid || !sessDb) return res.status(401).json({ error: 'Session invalid' });

  function doRegister(ws) {
    // Also stamp odoo_db_name on the workspace if it was blank so future
    // lookups by DB name work (happens once for workspaces provisioned manually).
    if (!ws.odoo_db_name) {
      masterDb.run('UPDATE workspaces SET odoo_db_name = ? WHERE tenant_id = ?', [sessDb, ws.tenant_id]);
      ws.odoo_db_name = sessDb;
    }
    const stmt = masterDb.prepare('INSERT OR IGNORE INTO workspace_users (email, tenant_id, odoo_db_name) VALUES (?, ?, ?)');
    clean.forEach(e => stmt.run(e, ws.tenant_id, ws.odoo_db_name));
    stmt.finalize(e2 => {
      if (e2) return res.status(500).json({ error: 'Registry write failed' });
      res.json({ registered: clean.length });
    });
  }

  // Resolve the workspace from the session's DB (not from the client).
  // Primary: exact odoo_db_name match.
  // Fallback: admin_email matches the session login (covers workspaces where
  //           odoo_db_name was not set during manual provisioning).
  masterDb.get('SELECT tenant_id, odoo_db_name FROM workspaces WHERE odoo_db_name = ?', [sessDb], (err, ws) => {
    if (err) return res.status(500).json({ error: 'Registry error' });
    if (ws) return doRegister(ws);
    if (!sessUsername) return res.status(404).json({ error: 'No workspace for this database' });
    masterDb.get('SELECT tenant_id, odoo_db_name FROM workspaces WHERE LOWER(admin_email) = ?', [sessUsername], (e2, ws2) => {
      if (e2) return res.status(500).json({ error: 'Registry error' });
      if (!ws2) return res.status(404).json({ error: 'No workspace for this database' });
      doRegister(ws2);
    });
  });
});

/**
 * POST /api/auth/login
 * Step 2 of login: verify password against Odoo, issue control-plane JWT.
 * Body: { email, password, tenantId }
 */
app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const { email, password, tenantId } = req.body;
  if (!email || !password || !tenantId) {
    return res.status(400).json({ error: 'Email, password, and tenantId are required' });
  }

  const emailNorm = email.toLowerCase().trim();

  // Try workspace owner first, then fall back to employee registry.
  // This prevents tenantId spoofing while still allowing employee logins.
  async function attemptOdooLogin(ws) {
    // Check subscription is active
    if (ws.subscription_status !== 'active') {
      return res.status(403).json({
        error: 'Workspace subscription is ' + ws.subscription_status + '. Please contact support.',
        status: ws.subscription_status
      });
    }
    if (ws.subscription_expires_at && new Date(ws.subscription_expires_at) < new Date()) {
      return res.status(403).json({
        error: 'Workspace subscription has expired. Please renew.',
        status: 'expired'
      });
    }

    const odooDb = ws.odoo_db_name || ('ws_' + ws.tenant_id);
    const odooUrl = ODOO_URL || 'http://127.0.0.1:8069';
    try {
      const odooRes = await fetch(odooUrl + '/web/session/authenticate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', method: 'call', id: 1,
          params: { db: odooDb, login: email, password }
        })
      });
      const odooData = await odooRes.json();
      const uid = odooData?.result?.uid;
      const odooSessionId = odooData?.result?.session_id || '';
      if (!uid) return res.status(401).json({ error: 'Incorrect password. Please try again.' });

      const token = jwt.sign(
        { role: 'tenant', email: emailNorm, workspace: ws.tenant_id, odooDb, odooUid: uid },
        JWT_SECRET, { expiresIn: '7d' }
      );
      console.log(`[Auth] Login: ${email} → workspace ${ws.tenant_id} (DB: ${odooDb}) UID: ${uid}`);
      res.json({ token, workspace: ws.tenant_id, workspaceName: ws.workspace_name, odooDb, odooSessionId, email: emailNorm });
    } catch (fetchErr) {
      console.error('[Auth] Odoo authenticate failed:', fetchErr.message);
      res.status(503).json({ error: 'Could not reach Odoo server. Please try again.' });
    }
  }

  // 1. Check if the email is the workspace owner.
  masterDb.get(
    'SELECT tenant_id, workspace_name, odoo_db_name, subscription_status, subscription_expires_at FROM workspaces WHERE tenant_id = ? AND LOWER(admin_email) = ?',
    [tenantId, emailNorm],
    (err, ws) => {
      if (err) return res.status(500).json({ error: 'Registry error' });
      if (ws) return attemptOdooLogin(ws);

      // 2. Not the owner — check if this is a registered employee for this workspace.
      masterDb.get(
        `SELECT w.tenant_id, w.workspace_name, w.odoo_db_name, w.subscription_status, w.subscription_expires_at
           FROM workspaces w JOIN workspace_users u ON u.tenant_id = w.tenant_id
          WHERE w.tenant_id = ? AND u.email = ?`,
        [tenantId, emailNorm],
        (e2, ws2) => {
          if (e2) return res.status(500).json({ error: 'Registry error' });
          if (!ws2) return res.status(401).json({ error: 'Invalid credentials' });
          attemptOdooLogin(ws2);
        }
      );
    }
  );
});

/**
 * GET /api/auth/validate
 * Called by React SPA on load to verify the stored JWT is still valid.
 * Returns workspace info if valid, 401 if not.
 */
app.get('/api/auth/validate', (req, res) => {
  const token = (req.headers['authorization'] || '').split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'tenant') return res.status(403).json({ error: 'Invalid token role' });

    // Verify workspace is still active
    masterDb.get(
      'SELECT workspace_name, subscription_status, subscription_expires_at, odoo_db_name FROM workspaces WHERE tenant_id = ?',
      [decoded.workspace],
      (err, ws) => {
        if (err || !ws) return res.status(401).json({ error: 'Workspace not found' });

        const isExpired = ws.subscription_expires_at && new Date(ws.subscription_expires_at) < new Date();
        if (ws.subscription_status !== 'active' || isExpired) {
          return res.status(403).json({
            error: 'Subscription ' + (isExpired ? 'expired' : ws.subscription_status),
            status: ws.subscription_status
          });
        }

        res.json({
          valid: true,
          workspace: decoded.workspace,
          workspaceName: ws.workspace_name,
          odooDb: ws.odoo_db_name || decoded.odooDb,
          email: decoded.email
        });
      }
    );
  } catch {
    res.status(401).json({ error: 'Token invalid or expired. Please log in again.' });
  }
});

/**
 * POST /api/auth/logout
 * Client-side logout — just returns success (client clears localStorage).
 */
app.post('/api/auth/logout', (req, res) => {
  res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════════════
// SUPERADMIN: AUTH + 2FA
// ════════════════════════════════════════════════════════════════════════

app.post('/api/superadmin/login', loginLimiter, (req, res) => {
  const { username, password, twoFactorCode } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Credentials required' });
  if (username !== SA_USERNAME || password !== SA_PASSWORD) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Check if 2FA is enabled
  masterDb.all("SELECT key, value FROM system_settings WHERE key IN ('SUPERADMIN_2FA_ENABLED','SUPERADMIN_2FA_SECRET')",
    [], (err, rows) => {
      const map = {};
      (rows || []).forEach(r => { map[r.key] = r.value; });
      const twoFaEnabled = map['SUPERADMIN_2FA_ENABLED'] === 'true';
      const twoFaSecret = map['SUPERADMIN_2FA_SECRET'] || '';

      if (twoFaEnabled && twoFaSecret) {
        if (!twoFactorCode) return res.json({ twoFactorRequired: true });
        // Simple TOTP verification (time window ±1)
        const valid = verifyTOTP(twoFactorCode, twoFaSecret);
        if (!valid) return res.status(400).json({ error: 'Invalid 2FA code' });
      }

      const token = jwt.sign({ role: 'superadmin', username: SA_USERNAME }, JWT_SECRET, { expiresIn: '365d' });
      res.json({ token });
    });
});

// RFC 4648 base32 (Node Buffer has NO 'base32' encoding -- must implement it).
const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i]; bits += 8;
    while (bits >= 5) { out += B32_ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0, value = 0; const out = [];
  for (const c of clean) {
    const idx = B32_ALPHABET.indexOf(c);
    if (idx === -1) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

function verifyTOTP(code, secret) {
  // RFC 6238 TOTP -- 30s window, +/-1 step tolerance.
  try {
    const key = base32Decode(secret);
    const time = Math.floor(Date.now() / 30000);
    for (let i = -1; i <= 1; i++) {
      const t = time + i;
      const buf = Buffer.alloc(8);
      buf.writeBigUInt64BE(BigInt(t));
      const hmac = crypto.createHmac('sha1', key).update(buf).digest();
      const offset = hmac[hmac.length - 1] & 0xf;
      const otp = ((hmac.readUInt32BE(offset) & 0x7fffffff) % 1000000).toString().padStart(6, '0');
      if (otp === String(code).trim()) return true;
    }
    return false;
  } catch { return false; }
}

app.get('/api/superadmin/2fa/status', requireSuperAdmin, (req, res) => {
  masterDb.get("SELECT value FROM system_settings WHERE key='SUPERADMIN_2FA_ENABLED'", [], (err, row) => {
    res.json({ enabled: !err && row && row.value === 'true' });
  });
});

app.get('/api/superadmin/2fa/setup', requireSuperAdmin, (req, res) => {
  const secret = base32Encode(crypto.randomBytes(20));
  const otpauth = `otpauth://totp/BizOpease%20Admin?secret=${secret}&issuer=BizOpease`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(otpauth)}`;
  res.json({ secret, qrUrl });
});

app.post('/api/superadmin/2fa/verify', requireSuperAdmin, (req, res) => {
  const { code, secret } = req.body;
  if (!verifyTOTP(code, secret)) return res.status(400).json({ error: 'Invalid code — check your authenticator app' });
  masterDb.serialize(() => {
    const stmt = masterDb.prepare("INSERT OR REPLACE INTO system_settings (key, value) VALUES (?,?)");
    stmt.run('SUPERADMIN_2FA_ENABLED', 'true');
    stmt.run('SUPERADMIN_2FA_SECRET', secret);
    stmt.finalize(err => {
      if (err) return res.status(500).json({ error: 'Failed to save 2FA config' });
      res.json({ success: true });
    });
  });
});

app.post('/api/superadmin/2fa/disable', requireSuperAdmin, (req, res) => {
  const { code } = req.body;
  masterDb.get("SELECT value FROM system_settings WHERE key='SUPERADMIN_2FA_SECRET'", [], (err, row) => {
    if (!err && row && row.value && !verifyTOTP(code, row.value)) {
      return res.status(400).json({ error: 'Invalid 2FA code' });
    }
    masterDb.serialize(() => {
      const stmt = masterDb.prepare("INSERT OR REPLACE INTO system_settings (key, value) VALUES (?,?)");
      stmt.run('SUPERADMIN_2FA_ENABLED', 'false');
      stmt.run('SUPERADMIN_2FA_SECRET', '');
      stmt.finalize(err2 => {
        if (err2) return res.status(500).json({ error: 'Failed to disable 2FA' });
        res.json({ success: true });
      });
    });
  });
});

// ════════════════════════════════════════════════════════════════════════
// SUPERADMIN: STATS
// ════════════════════════════════════════════════════════════════════════

app.get('/api/superadmin/stats', requireSuperAdmin, (req, res) => {
  masterDb.all("SELECT * FROM workspaces", [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    const now = new Date();
    const in7Days = new Date(now.getTime() + 7 * 86400000);
    let active = 0, expired = 0, unpaid = 0, mrr = 0, potentialMrr = 0;
    let expiringSoon = 0, activeStarter = 0, activePro = 0;

    rows.forEach(w => {
      const price = w.plan_type === 'pro' ? PLAN_PRICE_PRO : PLAN_PRICE_STARTER;
      potentialMrr += price;
      const isActive = w.subscription_status === 'active' &&
        (!w.subscription_expires_at || new Date(w.subscription_expires_at) > now);
      if (isActive) {
        active++; mrr += price;
        if (w.plan_type === 'pro') activePro++; else activeStarter++;
        if (w.subscription_expires_at && new Date(w.subscription_expires_at) <= in7Days) expiringSoon++;
      } else if (w.subscription_status === 'expired' ||
        (w.subscription_status === 'active' && w.subscription_expires_at && new Date(w.subscription_expires_at) <= now)) {
        expired++;
      } else { unpaid++; }
    });

    res.json({ totalWorkspaces: rows.length, active, expired, unpaid, mrr, potentialMrr,
      expiringSoon, activeStarter, activePro });
  });
});

// ════════════════════════════════════════════════════════════════════════
// SUPERADMIN: WORKSPACES CRUD
// ════════════════════════════════════════════════════════════════════════

app.get('/api/superadmin/workspaces', requireSuperAdmin, (req, res) => {
  masterDb.all("SELECT * FROM workspaces ORDER BY created_at DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    res.json(rows);
  });
});

app.post('/api/superadmin/workspaces', requireSuperAdmin, async (req, res) => {
  const { workspaceName, adminEmail, adminPassword, days, planType } = req.body;
  if (!workspaceName || !adminEmail || !adminPassword) {
    return res.status(400).json({ error: 'Workspace name, admin email, and password are required' });
  }
  const cleanSlug = generateOdooSlug(workspaceName);
  if (cleanSlug.length < 3) return res.status(400).json({ error: 'Name must be at least 3 alphanumeric chars' });

  masterDb.get("SELECT tenant_id FROM workspaces WHERE tenant_id=?", [cleanSlug], async (err, existing) => {
    if (existing) return res.status(400).json({ error: 'Workspace name already taken' });
    try {
      const dbName = await provisionTenant(cleanSlug, workspaceName.trim(), adminEmail, adminPassword);
      const expiry = new Date();
      expiry.setDate(expiry.getDate() + (parseInt(days) || 30));
      masterDb.run(
        `INSERT OR REPLACE INTO workspaces (tenant_id, workspace_name, subscription_status, subscription_expires_at, plan_type, odoo_db_name, admin_email)
         VALUES (?,?,?,?,?,?,?)`,
        [cleanSlug, workspaceName.trim(), 'active', expiry.toISOString(), planType || 'starter', dbName, adminEmail],
        err2 => {
          if (err2) return res.status(500).json({ error: 'Provisioned but registry failed' });
          res.json({ success: true, tenantId: cleanSlug, dbName });
        }
      );
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
});

app.post('/api/superadmin/workspaces/:id/activate', requireSuperAdmin, (req, res) => {
  const days = parseInt(req.body.days) || 30;
  const expiry = new Date(); expiry.setDate(expiry.getDate() + days);
  masterDb.run("UPDATE workspaces SET subscription_status='active', subscription_expires_at=? WHERE tenant_id=?",
    [expiry.toISOString(), req.params.id], err => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    });
});

app.post('/api/superadmin/workspaces/:id/deactivate', requireSuperAdmin, (req, res) => {
  masterDb.run("UPDATE workspaces SET subscription_status='unpaid' WHERE tenant_id=?",
    [req.params.id], err => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    });
});

app.post('/api/superadmin/workspaces/:id/extend', requireSuperAdmin, (req, res) => {
  const days = parseInt(req.body.days) || 30;
  masterDb.get("SELECT subscription_expires_at FROM workspaces WHERE tenant_id=?", [req.params.id], (err, row) => {
    if (err || !row) return res.status(404).json({ error: 'Workspace not found' });
    const base = row.subscription_expires_at ? new Date(row.subscription_expires_at) : new Date();
    if (base < new Date()) base.setTime(new Date().getTime());
    base.setDate(base.getDate() + days);
    masterDb.run("UPDATE workspaces SET subscription_status='active', subscription_expires_at=? WHERE tenant_id=?",
      [base.toISOString(), req.params.id], err2 => {
        if (err2) return res.status(500).json({ error: err2.message });
        res.json({ success: true, newExpiry: base.toISOString() });
      });
  });
});

app.post('/api/superadmin/workspaces/:id/set-plan', requireSuperAdmin, (req, res) => {
  const { planType } = req.body;
  if (!['starter', 'pro'].includes(planType)) return res.status(400).json({ error: 'Invalid plan' });
  masterDb.run("UPDATE workspaces SET plan_type=? WHERE tenant_id=?", [planType, req.params.id], err => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

app.delete('/api/superadmin/workspaces/:id', requireSuperAdmin, (req, res) => {
  const tenantId = req.params.id;
  // Look up the tenant's Odoo DB first so we can drop it along with the registry row.
  masterDb.get("SELECT odoo_db_name FROM workspaces WHERE tenant_id=?", [tenantId], (e0, row) => {
    if (e0) return res.status(500).json({ error: e0.message });
    if (!row) return res.status(404).json({ error: 'Workspace not found' });
    const db = row.odoo_db_name || '';

    masterDb.run("DELETE FROM workspaces WHERE tenant_id=?", [tenantId], function (err) {
      if (err) return res.status(500).json({ error: err.message });

      // Drop the Odoo DB + filestore — but ONLY provisioned tenant DBs (ws_*).
      // Core databases are never droppable through this endpoint.
      const PROTECTED = new Set(['robifel', 'queenfinger', 'deliveasy']);
      if (db && /^ws_[A-Za-z0-9_]+$/.test(db) && !PROTECTED.has(db)) {
        const cmd =
          `sudo -u postgres dropdb --force --if-exists ${db}; ` +
          `rm -rf /var/lib/odoo/.local/share/Odoo/filestore/${db}`;
        exec(cmd, (e2) => {
          if (e2) console.error(`[Workspace] DB drop for ${db} failed: ${e2.message}`);
          else console.log(`[Workspace] Dropped DB + filestore for ${db}`);
        });
        return res.json({ success: true, droppedDb: db });
      }
      // No tenant DB to drop (or a protected name) — registry row removed only.
      res.json({ success: true, droppedDb: null });
    });
  });
});

// ════════════════════════════════════════════════════════════════════════
// SUPERADMIN: ODOO WORKSPACE USERS (via XML-RPC passthrough)
// ════════════════════════════════════════════════════════════════════════

app.get('/api/superadmin/workspaces/:id/users', requireSuperAdmin, (req, res) => {
  masterDb.get("SELECT odoo_db_name, admin_email FROM workspaces WHERE tenant_id=?", [req.params.id], (err, ws) => {
    if (err || !ws) return res.status(404).json({ error: 'Workspace not found' });
    // Return info from registry — full Odoo user list requires Odoo master password call
    res.json({ odooDb: ws.odoo_db_name, adminEmail: ws.admin_email,
      note: 'Full user list available in Odoo backend: ' + (ODOO_URL || 'http://127.0.0.1:8069') });
  });
});

// ════════════════════════════════════════════════════════════════════════
// SUPERADMIN: BACKUPS
// ════════════════════════════════════════════════════════════════════════

const BACKUP_DIR = '/var/backups/odoo';

app.get('/api/superadmin/backups', requireSuperAdmin, (req, res) => {
  try {
    if (!fs.existsSync(BACKUP_DIR)) return res.json([]);
    const dates = fs.readdirSync(BACKUP_DIR)
      .filter(d => /^\d{8}-\d{4}$/.test(d) || /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort().reverse();
    const result = dates.map(date => {
      const dirPath = path.join(BACKUP_DIR, date);
      let files = [];
      try {
        files = fs.readdirSync(dirPath)
          .filter(f => !f.startsWith('deliveasy'))
          .map(f => {
          const stat = fs.statSync(path.join(dirPath, f));
          return { name: f, size: stat.size };
        });
      } catch {}
      return { date, files };
    });
    res.json(result);
  } catch (e) { res.status(500).json({ error: 'Failed to list backups: ' + e.message }); }
});

app.get('/api/superadmin/backups/download', requireSuperAdmin, (req, res) => {
  const { date, file } = req.query;
  if (!date || !file || !/^[\w-]+$/.test(String(date)) || !/^[\w.-]+$/.test(String(file))) {
    return res.status(400).json({ error: 'Invalid parameters' });
  }
  const filePath = path.join(BACKUP_DIR, String(date), String(file));
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Backup file not found' });
  res.setHeader('Content-Disposition', `attachment; filename="${date}_${file}"`);
  res.setHeader('Content-Type', 'application/octet-stream');
  fs.createReadStream(filePath).pipe(res);
});

app.post('/api/superadmin/backups/restore', requireSuperAdmin, (req, res) => {
  const { date, db } = req.body || {};
  if (!date || !db || !/^[\w-]+$/.test(String(date)) || !/^[\w]+$/.test(String(db))) {
    return res.status(400).json({ error: 'Invalid parameters' });
  }
  const dumpPath = path.join(BACKUP_DIR, String(date), `${db}.dump`);
  const filestorePath = path.join(BACKUP_DIR, String(date), 'filestore.tar.gz');
  if (!fs.existsSync(dumpPath)) return res.status(404).json({ error: `Dump not found: ${dumpPath}` });
  res.json({ success: true, message: `Restore of ${db} from ${date} started. Odoo restarts in ~60 seconds.` });

  // Step 1: restore the database (the script stops Odoo, drops+recreates, pg_restore, starts Odoo).
  const cmd = `/usr/local/bin/odoo-restore.sh ${dumpPath} ${db} >> /var/log/odoo-backup.log 2>&1`;
  exec(cmd, (err) => {
    if (err) { console.error('[Restore] DB restore failed:', err.message); return; }
    console.log(`[Restore] DB restore of ${db} complete`);

    // Step 2: restore ONLY this DB's filestore subtree (never touch other DBs'
    // attachments), then hand ownership back to the odoo user so Odoo can read it.
    if (fs.existsSync(filestorePath)) {
      const fsDir = '/var/lib/odoo/.local/share/Odoo';
      const restoreFs =
        `rm -rf ${fsDir}/filestore/${db} && ` +
        `tar -xzf ${filestorePath} -C ${fsDir} filestore/${db} && ` +
        `chown -R odoo:odoo ${fsDir}/filestore/${db}`;
      exec(`${restoreFs} >> /var/log/odoo-backup.log 2>&1`, (e2) => {
        if (e2) console.error('[Restore] Filestore restore failed:', e2.message);
        else console.log(`[Restore] Filestore for ${db} restored`);
      });
    }
  });
});

app.post('/api/superadmin/backups/run', requireSuperAdmin, (req, res) => {
  res.json({ success: true, message: 'Backup triggered. Check /api/superadmin/logs in ~30 seconds.' });
  exec('/usr/local/bin/odoo-backup.sh >> /var/log/odoo-backup.log 2>&1', err => {
    if (err) console.error('[Backup] Manual trigger failed:', err.message);
    else console.log('[Backup] Manual backup completed successfully');
  });
});

// ════════════════════════════════════════════════════════════════════════
// SUPERADMIN: REAL-TIME LOGS
// ════════════════════════════════════════════════════════════════════════

app.get('/api/superadmin/logs', requireSuperAdmin, (req, res) => {
  const pm2OutPaths = [
    '/root/.pm2/logs/bizopease-saas-out.log',
    '/root/.pm2/logs/bizopease-saas-0-out.log',
    process.env.HOME + '/.pm2/logs/bizopease-saas-out.log'
  ];
  const pm2ErrPaths = [
    '/root/.pm2/logs/bizopease-saas-error.log',
    '/root/.pm2/logs/bizopease-saas-0-error.log',
    process.env.HOME + '/.pm2/logs/bizopease-saas-error.log'
  ];

  let stdout = '';
  let stderr = '';

  pm2OutPaths.forEach(p => { if (!stdout && fs.existsSync(p)) stdout = tailFile(p, 150); });
  pm2ErrPaths.forEach(p => { if (!stderr && fs.existsSync(p)) stderr = tailFile(p, 50); });

  if (!stdout) stdout = 'No PM2 output log found. Make sure PM2 is saving logs (pm2 install pm2-logrotate).';
  res.json({ stdout, stderr });
});

// ════════════════════════════════════════════════════════════════════════
// SUPERADMIN: CONFIG SETTINGS
// ════════════════════════════════════════════════════════════════════════

const CONFIG_KEYS = [
  'ODOO_URL', 'ODOO_MASTER_PASSWORD',
  'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET',
  'RAZORPAY_PLAN_ID_STARTER', 'RAZORPAY_PLAN_ID_PRO', 'RAZORPAY_WEBHOOK_SECRET',
  'PLAN_PRICE_STARTER', 'PLAN_PRICE_PRO',
  'SUPERADMIN_USERNAME', 'SUPERADMIN_PASSWORD',
  'JWT_SECRET',
  'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM',
  'ADMIN_OTP_ENABLED',
  'QUEEN_ADMIN_LOGIN', 'QUEEN_ADMIN_PASSWORD', 'QUEEN_URL', 'QUEEN_DB',
  'R2_ACCOUNT_ID', 'R2_BUCKET_NAME', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_ENDPOINT'
];

app.get('/api/superadmin/config', requireSuperAdmin, (req, res) => {
  masterDb.all("SELECT key, value FROM system_settings WHERE key IN (" +
    CONFIG_KEYS.map(() => '?').join(',') + ")", CONFIG_KEYS, (err, rows) => {
    const cfg = {};
    CONFIG_KEYS.forEach(k => { cfg[k] = ''; });
    (rows || []).forEach(r => {
      const isSensitive = r.key.includes('SECRET') || r.key.includes('PASS') ||
        r.key.includes('KEY') || r.key === 'JWT_SECRET';
      cfg[r.key] = (isSensitive && r.value) ? '••••••••' : (r.value || '');
    });
    res.json(cfg);
  });
});

app.post('/api/superadmin/config', requireSuperAdmin, (req, res) => {
  const updates = req.body;
  if (!updates || typeof updates !== 'object') return res.status(400).json({ error: 'Invalid payload' });
  masterDb.serialize(() => {
    const stmt = masterDb.prepare("INSERT OR REPLACE INTO system_settings (key, value) VALUES (?,?)");
    Object.entries(updates).forEach(([k, val]) => {
      if (CONFIG_KEYS.includes(k) && val !== '••••••••') {
        stmt.run(k, String(val).trim());
      }
    });
    stmt.finalize(err => {
      if (err) return res.status(500).json({ error: 'Failed to save settings' });
      loadSettings(() => res.json({ success: true, message: 'Settings saved and reloaded.' }));
    });
  });
});

// ════════════════════════════════════════════════════════════════════════
// SUPERADMIN: PM2 PROCESS RESTART
// ════════════════════════════════════════════════════════════════════════

app.post('/api/superadmin/restart', requireSuperAdmin, (req, res) => {
  res.json({ success: true, message: 'Server restart triggered in 2 seconds. Reconnect shortly.' });
  setTimeout(() => {
    exec('pm2 reload bizopease-saas', (err, stdout) => {
      console.log('[Admin] PM2 reload:', stdout, err?.message);
    });
  }, 2000);
});

// ════════════════════════════════════════════════════════════════════════
// ADMIN EMAIL OTP  (only active when ADMIN_OTP_ENABLED = true)
// ════════════════════════════════════════════════════════════════════════

const otpStore = new Map(); // email.toLowerCase() → { code, expires }

function getMailer() {
  const nodemailer = require('nodemailer');
  return nodemailer.createTransport({
    host: SMTP_HOST || 'smtp.gmail.com',
    port: SMTP_PORT || 587,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

app.post('/api/auth/send-otp', async (req, res) => {
  if (!ADMIN_OTP_ENABLED) return res.status(403).json({ error: 'OTP is not enabled.' });
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email required' });
  if (!SMTP_USER || !SMTP_PASS) return res.status(503).json({ error: 'SMTP not configured. Contact the system administrator.' });

  const code = String(Math.floor(100000 + Math.random() * 900000));
  otpStore.set(email.toLowerCase(), { code, expires: Date.now() + 10 * 60 * 1000 });

  try {
    await getMailer().sendMail({
      from: SMTP_FROM || SMTP_USER,
      to: email,
      subject: 'BizOpease Admin Verification Code',
      text: `Your BizOpease admin verification code is: ${code}\n\nValid for 10 minutes. Do not share this code.`,
      html: `<div style="font-family:sans-serif;max-width:400px;margin:0 auto;padding:24px">
        <h2 style="color:#7367f0">BizOpease Admin Login</h2>
        <p>Your verification code:</p>
        <h1 style="letter-spacing:0.3em;color:#1a1a2e;background:#f4f4ff;padding:16px 24px;border-radius:8px;text-align:center">${code}</h1>
        <p style="color:#888;font-size:13px">Valid for 10 minutes. Do not share this code.</p>
      </div>`,
    });
    res.json({ ok: true });
  } catch (e) {
    otpStore.delete(email.toLowerCase());
    res.status(500).json({ error: 'Failed to send email: ' + e.message });
  }
});

app.post('/api/auth/verify-otp', (req, res) => {
  const { email, code } = req.body || {};
  const rec = otpStore.get((email || '').toLowerCase());
  if (!rec || Date.now() > rec.expires) {
    return res.status(401).json({ error: 'OTP expired or not found. Request a new code.' });
  }
  if (String(rec.code) !== String(code).trim()) {
    return res.status(401).json({ error: 'Invalid code. Try again.' });
  }
  otpStore.delete((email || '').toLowerCase());
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════════════════
// QUEENFINGER PROXY  (/api/queen/rpc → localhost:8070)
// ════════════════════════════════════════════════════════════════════════

let _queenSession = null;

async function getQueenSession() {
  if (_queenSession) return _queenSession;
  if (!QUEEN_ADMIN_PASSWORD) throw new Error('QUEEN_ADMIN_PASSWORD not configured in system settings.');
  if (!QUEEN_DB) throw new Error('QUEEN_DB not configured in system settings.');
  const queenBase = QUEEN_URL || 'http://localhost:8070';
  const r = await fetch(`${queenBase}/web/session/authenticate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-Host': `${QUEEN_DB}.local`,
      'X-Forwarded-Proto': 'https',
    },
    body: JSON.stringify({
      jsonrpc: '2.0', method: 'call',
      params: { db: QUEEN_DB, login: QUEEN_ADMIN_LOGIN || 'admin', password: QUEEN_ADMIN_PASSWORD },
    }),
  });
  const j = await r.json();
  const sid = (r.headers.get('set-cookie') || '').match(/session_id=([^;]+)/)?.[1];
  if (j.result?.uid && sid) { _queenSession = sid; return sid; }
  throw new Error('B2B database auth failed — check QUEEN_ADMIN_PASSWORD and QUEEN_DB in settings.');
}

app.post('/api/queen/rpc', requireQueenAuth, async (req, res) => {
  try {
    const sid = await getQueenSession();
    const { model, method, args = [], kwargs = {} } = req.body || {};
    if (!model || !method) return res.status(400).json({ error: 'model and method required' });

    const callQueen = async (sessionId) => {
      const r = await fetch(`${QUEEN_URL || 'http://localhost:8070'}/web/dataset/call_kw`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': `session_id=${sessionId}`,
          'X-Forwarded-Host': `${QUEEN_DB}.local`,
          'X-Forwarded-Proto': 'https',
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { model, method, args, kwargs } }),
      });
      return r.json();
    };

    let resp = await callQueen(sid);
    // Session expired → clear and retry once
    if (resp.error?.data?.name?.includes('SessionExpiredException') ||
        resp.error?.data?.name?.includes('SessionExpired')) {
      _queenSession = null;
      const sid2 = await getQueenSession();
      resp = await callQueen(sid2);
    }
    res.json(resp);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Stream a binary GET (PDF report / attachment) from the queenfinger Odoo using
// the server-side queen admin session. Keeps binary asset traffic on the
// queenfinger DB so queen tenants never pull robifel reports/images.
async function streamQueen(res, relPath, onError) {
  const fetchOnce = async (sid) => fetch(`${QUEEN_URL || 'http://localhost:8070'}${relPath}`, {
    headers: {
      'Cookie': `session_id=${sid}`,
      'X-Forwarded-Host': `${QUEEN_DB}.local`,
      'X-Forwarded-Proto': 'https',
    },
  });
  try {
    let sid = await getQueenSession();
    let r = await fetchOnce(sid);
    // A stale shared session redirects to /web/login (HTML). Refresh once.
    const ct0 = r.headers.get('content-type') || '';
    if (r.status === 303 || r.status === 302 || ct0.includes('text/html')) {
      _queenSession = null;
      sid = await getQueenSession();
      r = await fetchOnce(sid);
    }
    if (!r.ok) return onError(r.status, `Upstream returned ${r.status}`);
    res.status(200);
    res.setHeader('Content-Type', r.headers.get('content-type') || 'application/octet-stream');
    const cd = r.headers.get('content-disposition');
    if (cd) res.setHeader('Content-Disposition', cd);
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    onError(500, e.message);
  }
}

// Queenfinger PDF reports: /api/queen/report/pdf/<reportName>/<id>
app.get('/api/queen/report/*', requireQueenAuth, (req, res) => {
  const reportPath = req.params[0]; // e.g. pdf/account.report_invoice_with_payments/123
  if (!/^[\w./-]+$/.test(reportPath)) return res.status(400).send('Invalid report path');
  streamQueen(res, `/report/${reportPath}`, (code, msg) => res.status(code).send(msg));
});

// Queenfinger attachments/images: /api/queen/content?model=&id=&field=
app.get('/api/queen/content', requireQueenAuth, (req, res) => {
  const qs = new URLSearchParams(req.query);
  qs.delete('token');
  streamQueen(res, `/web/content?${qs.toString()}`, (code, msg) => res.status(code).send(msg));
});

// ════════════════════════════════════════════════════════════════════════
// FALLBACK ROUTES
// ════════════════════════════════════════════════════════════════════════

app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/superadmin', (req, res) => res.sendFile(path.join(__dirname, 'superadmin.html')));
app.get('/superadmin.html', (req, res) => res.sendFile(path.join(__dirname, 'superadmin.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ════════════════════════════════════════════════════════════════════════
// STARTUP
// ════════════════════════════════════════════════════════════════════════

loadSettings(() => {
  app.listen(PORT, () => {
    console.log(`[BizOpease Control Plane] Running on port ${PORT}`);
    console.log(`  Landing:    https://bizopease.robifel.in/`);
    console.log(`  SuperAdmin: https://bizopease.robifel.in/superadmin.html`);
  });
});
