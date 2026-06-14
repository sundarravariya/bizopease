// Per-tenant database resolution. Each BizOpease workspace has its OWN Odoo
// database, so every query the app makes is scoped to that tenant's DB —
// Odoo enforces complete isolation at the database level (no shared rows, no
// cross-tenant leakage).
//
// Resolution order (one build serves every tenant):
//   1. window.__ODOO_DB__  — injected per-workspace at runtime (config.js / nginx)
//   2. VITE_ODOO_DB        — build-time env for single-tenant deployments
//   3. hostname mapping    — <db>.bizopease.com / bizopease.com/<db>
//   4. fallback 'robifel'  — the current single tenant

declare global {
  interface Window { __ODOO_DB__?: string }
}

export function getOdooDb(): string {
  if (typeof window !== 'undefined' && window.__ODOO_DB__) return window.__ODOO_DB__;
  const envDb = import.meta.env.VITE_ODOO_DB as string | undefined;
  if (envDb) return envDb;

  // Resolve dynamically from the hostname subdomain
  if (typeof window !== 'undefined' && window.location) {
    const hostname = window.location.hostname; // e.g. "acme.bizopease.robifel.in" or "acme.bizopease.com"
    const parts = hostname.split('.');
    if (parts.length >= 3) {
      const sub = parts[0].toLowerCase();
      // Ignore common infrastructure subdomains
      if (sub !== 'www' && sub !== 'dashboard' && sub !== 'bizopease' && sub !== 'odoo' && sub !== 'superadmin') {
        return `ws_${sub}`;
      }
    }
  }

  return 'robifel';
}
