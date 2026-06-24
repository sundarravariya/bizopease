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

// Stable, immutable value — hoisted so it is never re-allocated per render and
// never triggers consumer re-renders (the lock is a no-op passthrough).
const APP_LOCK_VALUE: AppLockCtx = {
  isLocked: false,
  unlock: () => {},
  resetPin: () => {},
};

const AppLockContext = createContext<AppLockCtx>(APP_LOCK_VALUE);

export function AppLockProvider({ children }: { children: React.ReactNode }) {
  return (
    <AppLockContext.Provider value={APP_LOCK_VALUE}>
      {children}
    </AppLockContext.Provider>
  );
}

export function useAppLock() {
  return useContext(AppLockContext);
}
