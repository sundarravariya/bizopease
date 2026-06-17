import React, { createContext, useContext } from 'react';

// ─── App Lock removed ───────────────────────────────────────────────────────────
// The PIN / biometric app-lock has been removed. This module is now a transparent
// passthrough so existing imports (AppLockProvider, useAppLock) keep working while
// the app is never gated. To re-introduce a lock, restore the PIN/biometric flow.

interface AppLockCtx {
  isLocked: boolean;
  unlock: () => void;
  resetPin: () => void;
}

const AppLockContext = createContext<AppLockCtx>({
  isLocked: false,
  unlock: () => {},
  resetPin: () => {},
});

export function AppLockProvider({ children }: { children: React.ReactNode }) {
  return (
    <AppLockContext.Provider value={{ isLocked: false, unlock: () => {}, resetPin: () => {} }}>
      {children}
    </AppLockContext.Provider>
  );
}

export function useAppLock() {
  return useContext(AppLockContext);
}
