# BizOpease — SaaS Build Plan

BizOpease turns the existing Odoo + portal app into a multi-tenant SaaS where any
business owner can sign up, pay, and get an isolated workspace (their own Odoo
database) with the admin portal, mobile app, and an optional online store.

Product name: **BizOpease**. Test domain: `*.robifel.in` (until `bizopease.com`
is purchased and pointed).

---

## 1. High-level architecture

```
                          ┌─────────────────────────────┐
   bizopease.com  ───────▶│  Control Plane (Next.js)     │
   (landing + signup)     │  - marketing / landing       │
                          │  - signup + Razorpay paywall │
                          │  - superadmin dashboard      │
                          │  - workspaces registry (PG)  │
                          │  - provisioner (creates DBs) │
                          └──────────────┬──────────────┘
                                         │ provisions
                                         ▼
   <ws>.bizopease.com ───▶  Tenant App (this React portal, white-labeled)
   (or custom domain)        served per workspace, base "/"
                                         │ JSON-RPC (/web, /report)
                                         ▼
                          ┌─────────────────────────────┐
                          │  Odoo 18 CE (one instance)   │
                          │  db-filter routes host->DB   │
                          │  DB per tenant:  ws_<name>   │  ← complete isolation
                          │  custom addons installed     │
                          └──────────────┬──────────────┘
                                         ▼
                          PostgreSQL cluster  (all tenant DBs)
                                         │ WAL stream + base backups
                                         ▼
                          Cloudflare R2  (WAL-G, point-in-time recovery)
```

**Isolation guarantee:** each tenant = its own Odoo **database**. A session is
authenticated against one DB; every query runs inside it. Odoo enforces this at
the DB boundary, so there is no shared table and **no cross-tenant leakage**.

---

## 2. Components

### 2.1 Control plane (new — Next.js, mirrors deliveasy-v2)
- **Landing/marketing** at `bizopease.com`.
- **Signup**: business name, owner email, password, plan → Razorpay checkout.
- **Workspaces registry** (its own small Postgres DB or a control schema):
  `workspaces(id, slug, company_name, owner_email, odoo_db, plan, status, trial_ends, current_period_end, custom_domain)`.
- **Superadmin** (`/superadmin`, env-gated creds): list/suspend/extend workspaces, see revenue.
- **Provisioner**: on paid signup → create the Odoo DB, install addons, create the admin user, write the workspaces row, wire routing.
- **Razorpay**: subscriptions (Starter / Pro), webhook updates `status`/`current_period_end`.

### 2.2 Tenant app (this repo — already mostly ready)
- React portal, base `/`, brand = BizOpease, sidebar shows `company_name`.
- `getOdooDb()` already resolves the per-workspace DB (no hardcoded value).
- Served per workspace; same build for all tenants (DB injected at runtime via
  `window.__ODOO_DB__` from a per-workspace `config.js`, or via Odoo db-filter on host).
- Capacitor APK points at the workspace host.

### 2.3 Odoo backend (existing)
- One Odoo 18 CE instance, **multiple databases** (Odoo native multi-db).
- `db-filter = ^%d$` (or host-based) so `ws_acme.bizopease.com` → DB `ws_acme`.
- Custom addons (`robifel_hr`, `flipkart_os`, …) installed into each new DB.

---

## 3. Domains & routing

| Stage | URL pattern | Routing |
|---|---|---|
| Test now | `bizopease.robifel.in` (control), `bizopease.robifel.in/<ws>` (tenant) | nginx path → workspace config |
| Prod | `bizopease.com` (control), `<ws>.bizopease.com` (tenant), or customer's own domain | wildcard DNS + wildcard SSL |

- Wildcard cert: `*.bizopease.com` via certbot DNS-01 (Cloudflare plugin).
- Custom domains: customer CNAMEs to us → we issue a cert + add an nginx vhost.

---

## 4. Auth & authorization
- Tenant users authenticate against **their** Odoo DB (`/web/session/authenticate`).
- Control-plane auth separate (owner accounts, superadmin) — Better Auth or JWT.
- Subscription gating: tenant app checks workspace `status` (active/trial/suspended)
  from the control plane before allowing access; suspended → paywall screen.

---

## 5. Paywall (Razorpay)
- Plans created in Razorpay dashboard (e.g. Starter ₹X/mo, Pro ₹Y/mo) → plan ids in `.env`.
- Signup → Razorpay Subscription checkout → webhook (`subscription.charged`,
  `subscription.halted`) updates the workspace row.
- Trial: N-day trial on signup; `trial_ends` gates access; reminders before expiry.

---

## 6. Provisioning flow (the heart of the SaaS)
1. Owner signs up + pays → control plane gets webhook `active`.
2. Provisioner:
   a. Generate `odoo_db = ws_<slug>`.
   b. Create DB via Odoo (`/web/database/create` with master password, or `odoo -d ... -i base`).
   c. Install custom addons (`-i robifel_hr,flipkart_os,...` or via XML-RPC `button_immediate_install`).
   d. Create the workspace admin user with the owner's email/password.
   e. Set `res.company.name = company_name`.
   f. Insert workspaces row (`odoo_db`, `slug`, `plan`, `status=active`).
   g. Routing: add subdomain/path → DB mapping (db-filter handles host; path needs config.js).
3. Email the owner their workspace URL + login.
- De-provision/suspend: set `status=suspended`; optionally `pg_dump` then drop DB after grace period.

---

## 7. Backups & disaster recovery
- **WAL-G → Cloudflare R2**: `archive_mode=on`, `archive_command='wal-g wal-push %p'`,
  nightly `wal-g backup-push`. Covers **all** tenant DBs (one cluster). PITR to any second.
- **Per-DB pg_dump**: nightly `pg_dump <db>` to R2 for granular single-tenant restore.
- **Restore drills**: documented `wal-g backup-fetch` + `pg_restore` runbook.
- Control-plane DB included in the same backup scope.

---

## 8. Ecommerce store editor (Shopify-like)
Two options:
- **A. Odoo Website/eCommerce** (`website_sale`) per tenant — fastest, native, themable.
  Limited "Shopify-feel" but real catalog/cart/checkout out of the box.
- **B. Custom store builder** (React) reading products from the tenant's Odoo DB,
  with a drag/drop section editor + hosted storefront. Much more work; true Shopify-like.
- **Recommendation:** start with **A** (enable `website_sale`, expose a simple theme/editor
  in the portal), evaluate **B** later if differentiation is needed.

---

## 9. Zoho Books integration
- OAuth2 connect per tenant (store refresh token in their Odoo DB / control plane).
- Two-way sync: contacts, items, invoices, purchase orders, payments.
- Built as an Odoo addon (`bizopease_zoho`) with scheduled sync + manual "Sync now".

---

## 10. Phased roadmap
1. **Foundation (DONE):** dashboard.robifel.in + SSL, BizOpease brand, per-tenant `getOdooDb()`, git.
2. **Backups:** WAL-G→R2 + pg_dump scripts (needs R2 creds).
3. **Control plane MVP:** Next.js landing + signup + workspaces table + superadmin.
4. **Provisioning:** create-DB + install-addons + admin-user, manual trigger first.
5. **Paywall:** Razorpay subscriptions + webhook + gating (needs Razorpay keys).
6. **Routing:** db-filter + wildcard SSL; `bizopease.robifel.in/<ws>` test routing.
7. **White-label polish:** dynamic module-sidebar, appId/appName, download page.
8. **Zoho sync** addon.
9. **Store editor** (option A).
10. **Go live:** buy `bizopease.com`, point DNS, migrate.

---

## 11. Credentials needed from owner
- `GITHUB_TOKEN` (push) — in `.env`.
- Cloudflare **R2** account id + bucket + access key/secret — backups.
- **Razorpay** key id/secret + plan ids + webhook secret — paywall.
- Odoo **master password** — provisioning (create/drop DBs).
- (Later) domain registrar access for `bizopease.com`.
