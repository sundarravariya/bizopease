// BizOpease — Per-tenant Odoo database resolver
// ================================================
// URL routing: bizopease.robifel.in/{workspace}
// DB name:     ws_{workspace}
//
// On every app load, we:
//  1. Read the workspace slug from the URL path
//  2. Validate the control-plane JWT from localStorage
//  3. Confirm the JWT workspace matches the URL workspace
//  4. Inject __ODOO_DB__ and Odoo session_id for the API client
//
// If unauthenticated → redirect to /login

declare global {
  interface Window {
    __ODOO_DB__?: string
    __ODOO_SESSION_ID__?: string
    __WORKSPACE__?: string
  }
}

// Reserved paths that are NOT workspace slugs
const RESERVED_PATHS = new Set([
  'login', 'api', 'superadmin', 'download', 'signup',
  'assets', 'static', 'favicon.ico', ''
])

/** Parse the workspace slug from the current URL path */
export function getWorkspaceSlug(): string | null {
  if (typeof window === 'undefined') return null
  const parts = window.location.pathname.split('/').filter(Boolean)
  if (parts.length === 0) return null
  const slug = parts[0].toLowerCase()
  return RESERVED_PATHS.has(slug) ? null : slug
}

/** Get Odoo database name from the current URL path */
export function getOdooDb(): string {
  // Priority 1: already injected at runtime (by auth init)
  if (typeof window !== 'undefined' && window.__ODOO_DB__) {
    return window.__ODOO_DB__
  }

  // Priority 2: build-time env var (single-tenant deployment)
  const envDb = import.meta.env.VITE_ODOO_DB as string | undefined
  if (envDb) return envDb

  // Priority 3: path-based — bizopease.robifel.in/{workspace}
  const slug = getWorkspaceSlug()
  if (slug) return `ws_${slug}`

  // Fallback: original robifel DB
  return 'robifel'
}

/** Stored auth object from localStorage */
interface BizOpeaseAuth {
  token: string
  workspace: string
  workspaceName: string
  odooDb: string
  email: string
  odooSessionId?: string
}

export function getStoredAuth(): BizOpeaseAuth | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem('bizopease_auth')
    if (!raw) return null
    return JSON.parse(raw) as BizOpeaseAuth
  } catch {
    return null
  }
}

export function clearAuth(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('bizopease_auth')
  }
}

/**
 * Initialize tenant auth on app load.
 * Called once from main.tsx before rendering.
 *
 * - Reads workspace slug from URL path
 * - Validates JWT from localStorage
 * - Confirms JWT workspace matches URL workspace
 * - Injects window.__ODOO_DB__ and window.__ODOO_SESSION_ID__
 * - Redirects to /login if unauthenticated
 *
 * Returns true if auth is valid, false if redirecting.
 */
export async function initTenantAuth(): Promise<boolean> {
  if (typeof window === 'undefined') return true

  const slug = getWorkspaceSlug()

  // Not a workspace path — let the app handle it (landing, login, etc.)
  if (!slug) return true

  const auth = getStoredAuth()

  // No auth stored → redirect to login
  if (!auth || !auth.token) {
    console.warn('[Auth] No token found, redirecting to /login')
    window.location.href = '/login'
    return false
  }

  // JWT workspace must match the URL path slug
  if (auth.workspace !== slug) {
    console.warn(`[Auth] Token workspace "${auth.workspace}" does not match URL slug "${slug}"`)
    clearAuth()
    window.location.href = '/login'
    return false
  }

  // Check JWT expiry client-side (quick check before server validation)
  try {
    const payload = JSON.parse(atob(auth.token.split('.')[1]))
    if (payload.exp * 1000 < Date.now()) {
      console.warn('[Auth] Token expired')
      clearAuth()
      window.location.href = '/login'
      return false
    }
  } catch {
    clearAuth()
    window.location.href = '/login'
    return false
  }

  // Validate with control-plane server
  try {
    const r = await fetch('/api/auth/validate', {
      headers: { Authorization: 'Bearer ' + auth.token }
    })
    if (!r.ok) {
      const err = await r.json().catch(() => ({}))
      console.warn('[Auth] Server validation failed:', err.error)
      clearAuth()
      window.location.href = '/login'
      return false
    }
    const data = await r.json()

    // Inject into window globals for use by API client
    window.__ODOO_DB__ = data.odooDb || auth.odooDb
    window.__WORKSPACE__ = data.workspace
    if (auth.odooSessionId) {
      window.__ODOO_SESSION_ID__ = auth.odooSessionId
    }

    return true
  } catch (e) {
    // Network error: allow offline access using cached auth
    console.warn('[Auth] Could not validate token (offline?). Using cached auth.')
    window.__ODOO_DB__ = auth.odooDb
    window.__WORKSPACE__ = auth.workspace
    if (auth.odooSessionId) window.__ODOO_SESSION_ID__ = auth.odooSessionId
    return true
  }
}
