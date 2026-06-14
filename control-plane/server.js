const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const path = require('path');
const { masterDb, getSetting, saveSetting } = require('./database');
const { provisionTenant } = require('./provisioner');

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// Load port from env, default to 5000 (DelivEasy is 8080)
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'bizopease_jwt_secret_key';

// ─── HELPER: SUPERADMIN REQUIRE AUTH MIDDLEWARE ──────────────────────────────
function requireSuperAdmin(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access token required' });

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err || decoded.role !== 'superadmin') {
      return res.status(403).json({ error: 'Invalid or expired credentials' });
    }
    req.adminUser = decoded;
    next();
  });
}

// Serve landing / superadmin static resources
app.use(express.static(path.join(__dirname)));

// ─── PUBLIC ROUTES: LANDING / SIGNUP / WEBHOOK ──────────────────────────────

// Check tenant subdomain slug availability
app.get('/api/signup/check-availability', (req, res) => {
  const slug = req.query.slug.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
  if (!slug) return res.json({ available: false, reason: 'Invalid subdomain name' });

  masterDb.get("SELECT tenant_id FROM workspaces WHERE tenant_id = ?", [slug], (err, row) => {
    if (err) return res.status(500).json({ error: 'Database query failure' });
    if (row) return res.json({ available: false, reason: 'This subdomain is already taken' });
    res.json({ available: true });
  });
});

// Pre-register: create subscription on Razorpay
app.post('/api/signup/pre-register', async (req, res) => {
  const { slug, workspaceName, email, password, plan } = req.body;
  const cleanSlug = slug.toLowerCase().trim().replace(/[^a-z0-9]/g, '');

  if (!cleanSlug || !workspaceName || !email || !password) {
    return res.status(400).json({ error: 'Missing mandatory onboarding fields.' });
  }

  const razorpayKeyId = await getSetting('RAZORPAY_KEY_ID');
  const razorpaySecret = await getSetting('RAZORPAY_KEY_SECRET');
  const starterPlanId = await getSetting('RAZORPAY_PLAN_ID_STARTER');
  const proPlanId = await getSetting('RAZORPAY_PLAN_ID_PRO');

  const selectedPlanId = plan === 'pro' ? proPlanId : starterPlanId;

  // Mock checkout if Razorpay is not configured
  if (!razorpayKeyId || !razorpaySecret || !selectedPlanId) {
    console.log('[Signup] Razorpay keys not configured. Responding with Mock Checkout mode.');
    return res.json({
      razorpayEnabled: false,
      message: 'Payment credentials missing. Subscribing in Mock Test Onboarding mode.',
      slug: cleanSlug,
      plan
    });
  }

  // Real Razorpay Subscription checkout generation
  try {
    const authHeader = 'Basic ' + Buffer.from(`${razorpayKeyId}:${razorpaySecret}`).toString('base64');
    const response = await fetch('https://api.razorpay.com/v1/subscriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
      body: JSON.stringify({
        plan_id: selectedPlanId,
        total_count: 120, // 10 years of months
        quantity: 1,
        customer_notify: 1
      })
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('[Razorpay] Subscription API error:', data);
      return res.status(500).json({ error: data.error.description || 'Razorpay creation failure' });
    }

    res.json({
      razorpayEnabled: true,
      keyId: razorpayKeyId,
      subscriptionId: data.id,
      amount: plan === 'pro' ? 250000 : 100000, // Rs 2500 or Rs 1000 in paise
      slug: cleanSlug,
      plan
    });
  } catch (err) {
    console.error('[Razorpay] Subscription network error:', err);
    res.status(500).json({ error: 'Failed to connect to payment gateways.' });
  }
});

// Finalize Signup: verified checkout triggers provisioning
app.post('/api/signup/finalize', async (req, res) => {
  const { slug, workspaceName, email, password, plan, razorpay_payment_id, razorpay_subscription_id, razorpay_signature } = req.body;
  const cleanSlug = slug.toLowerCase().trim().replace(/[^a-z0-9]/g, '');

  const razorpayKeyId = await getSetting('RAZORPAY_KEY_ID');
  const razorpaySecret = await getSetting('RAZORPAY_KEY_SECRET');

  // Verify payment signatures if real keys exist
  if (razorpayKeyId && razorpaySecret && razorpay_subscription_id) {
    if (!razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: 'Signature parameters missing.' });
    }
    const text = `${razorpay_payment_id}|${razorpay_subscription_id}`;
    const expectedSig = crypto.createHmac('sha256', razorpaySecret).update(text).digest('hex');
    if (expectedSig !== razorpay_signature) {
      return res.status(400).json({ error: 'Payment signature mismatch.' });
    }
  }

  // Provisioning Odoo Database
  const dbName = `ws_${cleanSlug}`;
  try {
    await provisionTenant(cleanSlug, workspaceName, email, password);
    
    // Register workspace in SQLite masterDb
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + 30); // 30 days active limit

    masterDb.run(
      `INSERT OR REPLACE INTO workspaces (tenant_id, workspace_name, subscription_status, subscription_expires_at, plan_type, razorpay_subscription_id, last_payment_id, odoo_db_name, admin_email, admin_password) 
       VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)`,
      [cleanSlug, workspaceName.trim(), expiry.toISOString(), plan || 'starter', razorpay_subscription_id || 'sub_mock', razorpay_payment_id || 'pay_mock', dbName, email, password],
      (err) => {
        if (err) {
          console.error('[Signup] SQLite registry fail:', err);
          return res.status(500).json({ error: 'Provisioned, but failed to save in master registry.' });
        }
        res.json({ success: true, dbName, message: 'Workspace created successfully!' });
      }
    );
  } catch (err) {
    console.error('[Signup] Provisioner failure:', err);
    res.status(500).json({ error: err.message });
  }
});

// Razorpay Webhook updates
app.post('/api/subscription/webhook', async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const webhookSecret = await getSetting('RAZORPAY_WEBHOOK_SECRET');

  if (signature && webhookSecret) {
    const shasum = crypto.createHmac('sha256', webhookSecret);
    shasum.update(JSON.stringify(req.body));
    const digest = shasum.digest('hex');
    if (digest !== signature) {
      return res.status(400).json({ error: 'Invalid webhook signature' });
    }
  }

  const event = req.body.event;
  const payload = req.body.payload;

  console.log(`[Webhook] Event received: ${event}`);

  if (event === 'subscription.charged') {
    const sub = payload.subscription.entity;
    const payment = payload.payment.entity;
    
    const expiry = new Date(sub.current_end * 1000);

    masterDb.run(
      "UPDATE workspaces SET subscription_status = 'active', subscription_expires_at = ?, last_payment_id = ? WHERE razorpay_subscription_id = ?",
      [expiry.toISOString(), payment.id, sub.id],
      (err) => {
        if (err) console.error('[Webhook] Failed to update expiration:', err);
        else console.log(`[Webhook] Workspace with sub ${sub.id} extended to ${expiry.toISOString()}`);
      }
    );
  }

  res.json({ status: 'ok' });
});

// ─── SUPERADMIN PATHS (requireSuperAdmin) ──────────────────────────────────

// Admin Authentication Login
app.post('/api/superadmin/login', async (req, res) => {
  const { username, password } = req.body;
  
  const superuser = await getSetting('SUPERADMIN_USERNAME', 'bizopeaseadmin');
  const superpass = await getSetting('SUPERADMIN_PASSWORD', 'BizOpeaseAdminPass123!');

  if (username === superuser && password === superpass) {
    const token = jwt.sign({ role: 'superadmin', username }, JWT_SECRET, { expiresIn: '30d' });
    return res.json({ token });
  }
  res.status(401).json({ error: 'Incorrect username or password' });
});

// Analytics Stats Overview
app.get('/api/superadmin/stats', requireSuperAdmin, (req, res) => {
  masterDb.all("SELECT subscription_status, plan_type FROM workspaces", [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database lookup failed' });
    const stats = { total: 0, active: 0, unpaid: 0, expired: 0, starter: 0, pro: 0 };
    rows.forEach(r => {
      stats.total++;
      if (stats[r.subscription_status] !== undefined) stats[r.subscription_status]++;
      if (stats[r.plan_type] !== undefined) stats[r.plan_type]++;
    });
    res.json(stats);
  });
});

// Workspaces dashboard logs list
app.get('/api/superadmin/workspaces', requireSuperAdmin, (req, res) => {
  masterDb.all("SELECT * FROM workspaces ORDER BY created_at DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database registry fetch failed' });
    res.json(rows);
  });
});

// Manage Workspaces
app.post('/api/superadmin/workspaces/:id/activate', requireSuperAdmin, (req, res) => {
  const expiry = new Date();
  expiry.setMonth(expiry.getMonth() + 1);
  masterDb.run("UPDATE workspaces SET subscription_status = 'active', subscription_expires_at = ? WHERE tenant_id = ?", [expiry.toISOString(), req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

app.post('/api/superadmin/workspaces/:id/deactivate', requireSuperAdmin, (req, res) => {
  masterDb.run("UPDATE workspaces SET subscription_status = 'unpaid' WHERE tenant_id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

app.post('/api/superadmin/workspaces/:id/extend', requireSuperAdmin, (req, res) => {
  const days = req.body.days || 30;
  masterDb.get("SELECT subscription_expires_at FROM workspaces WHERE tenant_id = ?", [req.params.id], (err, row) => {
    if (err || !row) return res.status(500).json({ error: 'Lookup fail' });
    const current = row.subscription_expires_at ? new Date(row.subscription_expires_at) : new Date();
    current.setDate(current.getDate() + days);
    masterDb.run("UPDATE workspaces SET subscription_status = 'active', subscription_expires_at = ? WHERE tenant_id = ?", [current.toISOString(), req.params.id], (err2) => {
      if (err2) return res.status(500).json({ error: err2.message });
      res.json({ success: true });
    });
  });
});

app.delete('/api/superadmin/workspaces/:id', requireSuperAdmin, (req, res) => {
  // Delete database record
  masterDb.run("DELETE FROM workspaces WHERE tenant_id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// Configure Settings API
app.get('/api/superadmin/config', requireSuperAdmin, async (req, res) => {
  const keys = ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_PLAN_ID_STARTER', 'RAZORPAY_PLAN_ID_PRO', 'RAZORPAY_WEBHOOK_SECRET', 'ODOO_URL', 'ODOO_MASTER_PASSWORD', 'SUPERADMIN_USERNAME', 'SUPERADMIN_PASSWORD'];
  const config = {};
  for (const k of keys) {
    const val = await getSetting(k);
    config[k] = val ? (k.includes('SECRET') || k.includes('PASSWORD') ? '********' : val) : '';
  }
  res.json(config);
});

app.post('/api/superadmin/config', requireSuperAdmin, async (req, res) => {
  const updates = req.body;
  try {
    for (const [k, val] of Object.entries(updates)) {
      if (val !== '********') {
        await saveSetting(k, val);
      }
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fallback serve login
app.get('/superadmin', (req, res) => {
  res.sendFile(path.join(__dirname, 'superadmin.html'));
});

// Bare root landing redirect
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'landing.html'));
});

app.listen(PORT, () => {
  console.log(`[BizOpease SaaS Control-Plane] Running on port ${PORT}...`);
});
