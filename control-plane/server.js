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
    'SELECT tenant_id, workspace_name, odoo_db_name, subscription_status FROM workspaces WHERE LOWER(admin_email) = ?',
    [email],
    (err, ws) => {
      if (err) return res.status(500).json({ error: 'Registry lookup failed' });
      if (!ws) return res.status(404).json({ error: 'No workspace found for this email address. Contact your administrator.' });

      // Return workspace info (no sensitive data)
      res.json({
        tenantId: ws.tenant_id,
        workspaceName: ws.workspace_name,
        odooDb: ws.odoo_db_name || ('ws_' + ws.tenant_id),
        status: ws.subscription_status
      });
    }
  );
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

  // Re-verify workspace ownership (prevent tenantId spoofing)
  masterDb.get(
    'SELECT tenant_id, workspace_name, odoo_db_name, subscription_status, subscription_expires_at FROM workspaces WHERE tenant_id = ? AND LOWER(admin_email) = ?',
    [tenantId, email.toLowerCase().trim()],
    async (err, ws) => {
      if (err) return res.status(500).json({ error: 'Registry error' });
      if (!ws) return res.status(401).json({ error: 'Invalid credentials' });

      // Check subscription is active
      if (ws.subscription_status !== 'active') {
        return res.status(403).json({
          error: 'Workspace subscription is ' + ws.subscription_status + '. Please contact support.',
          status: ws.subscription_status
        });
      }

      // Check expiry
      if (ws.subscription_expires_at && new Date(ws.subscription_expires_at) < new Date()) {
        return res.status(403).json({
          error: 'Workspace subscription has expired. Please renew.',
          status: 'expired'
        });
      }

      const odooDb = ws.odoo_db_name || ('ws_' + ws.tenant_id);
      const odooUrl = ODOO_URL || 'http://127.0.0.1:8069';

      // Authenticate against Odoo to verify credentials
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

        if (!uid) {
          return res.status(401).json({ error: 'Incorrect password. Please try again.' });
        }

        // Credentials verified — issue control-plane JWT
        const token = jwt.sign(
          {
            role: 'tenant',
            email: email.toLowerCase().trim(),
            workspace: ws.tenant_id,
            odooDb,
            odooUid: uid
          },
          JWT_SECRET,
          { expiresIn: '7d' }
        );

        console.log(`[Auth] Login: ${email} → workspace ${ws.tenant_id} (DB: ${odooDb}) UID: ${uid}`);

        res.json({
          token,
          workspace: ws.tenant_id,
          workspaceName: ws.workspace_name,
          odooDb,
          odooSessionId,
          email: email.toLowerCase().trim()
        });

      } catch (fetchErr) {
        console.error('[Auth] Odoo authenticate failed:', fetchErr.message);
        res.status(503).json({ error: 'Could not reach Odoo server. Please try again.' });
      }
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
  masterDb.run("DELETE FROM workspaces WHERE tenant_id=?", [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: 'Workspace not found' });
    res.json({ success: true });
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
        files = fs.readdirSync(dirPath).map(f => {
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
