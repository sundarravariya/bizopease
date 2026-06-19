import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { odooLogin, odooLogout, odooGetSession, userIsManager } from '../services/odoo';
import { getOdooDb } from '../config/tenant';

interface User {
  uid: number;
  name: string;
  username: string;
  email: string;
  db: string;
  company_id: number[];
  company_name: string;
  is_admin: boolean;
  session_id: string;
  is_queen_tenant?: boolean;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  login: (username: string, password: string, db?: string) => Promise<void>;
  setAuthUser: (user: User) => void;
  logout: () => Promise<void>;
  clearError: () => void;
}

export type { User };

const PORTAL_CACHE_KEYS = [
  'portal_invoices', 'portal_bills', 'portal_journal_entries',
  'portal_sales_orders', 'portal_quotations', 'portal_customers',
  'portal_purchase_orders', 'portal_vendors',
  'portal_inventory_transfers', 'portal_inventory_stock', 'portal_reorder_rules',
  'portal_crm_leads', 'portal_crm_leads_opps', 'portal_crm_pipeline',
  'portal_employees', 'portal_leaves_list',
];

function flushCache() {
  PORTAL_CACHE_KEYS.forEach(k => localStorage.removeItem(k));
}

function loadStoredUser(): User | null {
  try {
    const raw = localStorage.getItem('robifel-user');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Reject old bypass/mock sessions — they have no real Odoo cookie
    if (!parsed?.uid || parsed?.session_id === 'mock' || !parsed?.session_id) {
      localStorage.removeItem('robifel-user');
      flushCache();
      return null;
    }
    return parsed as User;
  } catch {
    localStorage.removeItem('robifel-user');
    return null;
  }
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,
  login: async () => {},
  setAuthUser: () => {},
  logout: async () => {},
  clearError: () => {},
});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(loadStoredUser);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // On mount: verify stored session is still valid against Odoo
  useEffect(() => {
    if (!user) return;
    odooGetSession()
      .then(async session => {
        if (!session?.uid) {
          // Session expired on Odoo side — force re-login
          setUser(null);
          localStorage.removeItem('robifel-user');
          flushCache();
          return;
        }
        // Refresh manager role on the restored session.
        try {
          const mgr = await userIsManager();
          setUser(prev => {
            if (!prev || prev.is_admin === mgr) return prev;
            const updated = { ...prev, is_admin: mgr };
            localStorage.setItem('robifel-user', JSON.stringify(updated));
            return updated;
          });
        } catch { /* keep stored role */ }
      })
      .catch(() => {
        // Network error — keep session alive for offline use
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep-alive: ping Odoo every 4 minutes to prevent Redis session expiry
  useEffect(() => {
    if (!user) return;
    const interval = setInterval(() => {
      odooGetSession().catch(() => {/* ignore network errors */});
    }, 4 * 60 * 1000);
    return () => clearInterval(interval);
  }, [user]);

  const login = useCallback(async (username: string, password: string, db = getOdooDb()) => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await odooLogin(username, password, db);
      if (!result?.uid) throw new Error('Invalid credentials — Odoo did not return a user session');

      // Flush all cached/mock data so modules load fresh from Odoo
      flushCache();

      const userData: User = {
        uid: result.uid,
        name: result.name || username,
        username: result.username || username,
        email: result.username || username,
        db: result.db || db,
        company_id: Array.isArray(result.company_id) ? result.company_id : [1],
        company_name: result.company_name || (Array.isArray(result.company_id) ? result.company_id[1] : ''),
        is_admin: result.is_system || result.is_admin || false,
        session_id: `odoo-${result.uid}-${Date.now()}`,
      };
      setUser(userData);
      localStorage.setItem('robifel-user', JSON.stringify(userData));

      // Confirm manager role via group membership (authoritative).
      try {
        const mgr = await userIsManager();
        if (mgr !== userData.is_admin) {
          const updated = { ...userData, is_admin: mgr };
          setUser(updated);
          localStorage.setItem('robifel-user', JSON.stringify(updated));
        }
      } catch { /* keep is_system result */ }
    } catch (err: any) {
      const msg =
        err?.response?.data?.error?.data?.message ||
        err?.message ||
        'Authentication failed — check your username and password';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try { await odooLogout(); } catch (_) {}
    flushCache();
    setUser(null);
    localStorage.removeItem('robifel-user');
    localStorage.removeItem('bizopease_queen_token'); // drop queenfinger JWT
  }, []);

  const setAuthUser = useCallback((u: User) => {
    flushCache();
    setUser(u);
    localStorage.setItem('robifel-user', JSON.stringify(u));
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated: !!user,
      isLoading,
      error,
      login,
      setAuthUser,
      logout,
      clearError,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
