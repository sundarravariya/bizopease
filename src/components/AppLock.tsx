import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { App as CapApp } from '@capacitor/app';
import { NativeBiometric } from 'capacitor-native-biometric';

// ─── Types ────────────────────────────────────────────────────────────────────
type LockState = 'checking' | 'setup' | 'locked' | 'unlocked';

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

// ─── SHA-256 hash helper ──────────────────────────────────────────────────────
async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── PIN PAD ──────────────────────────────────────────────────────────────────
function PinDots({ value, max }: { value: string; max: number }) {
  return (
    <div className="flex gap-4 justify-center my-6">
      {Array.from({ length: max }).map((_, i) => (
        <div
          key={i}
          className={`w-4 h-4 rounded-full border-2 transition-all duration-200 ${
            i < value.length
              ? 'bg-[#7367f0] border-[#7367f0] scale-110'
              : 'bg-transparent border-[#4a5280]'
          }`}
        />
      ))}
    </div>
  );
}

function PinPad({ onDigit, onDelete }: { onDigit: (d: string) => void; onDelete: () => void }) {
  const keys = ['1','2','3','4','5','6','7','8','9','','0','del'];
  return (
    <div className="grid grid-cols-3 gap-3 w-full max-w-xs mx-auto">
      {keys.map((k, i) => {
        if (!k) return <div key={i} />;
        const isDel = k === 'del';
        return (
          <button
            key={k}
            onClick={() => isDel ? onDelete() : onDigit(k)}
            className={`h-16 rounded-2xl text-xl font-bold transition-all duration-150 active:scale-95
              ${isDel
                ? 'bg-[#2a3250] text-[#ef4444] text-base'
                : 'bg-[#1e2440] text-white hover:bg-[#2a3250] border border-[#2a3250]'
              }`}
          >
            {isDel ? '←' : k}
          </button>
        );
      })}
    </div>
  );
}

// ─── PIN SETUP SCREEN ─────────────────────────────────────────────────────────
function PinSetup({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<'enter' | 'confirm'>('enter');
  const [pin, setPin] = useState('');
  const [firstPin, setFirstPin] = useState('');
  const [error, setError] = useState('');
  const PIN_LEN = 4;

  const addDigit = (d: string) => {
    if (pin.length >= PIN_LEN) return;
    const next = pin + d;
    setPin(next);
    setError('');
    if (next.length === PIN_LEN) {
      setTimeout(() => handleComplete(next), 150);
    }
  };

  const handleComplete = async (val: string) => {
    if (step === 'enter') {
      setFirstPin(val);
      setPin('');
      setStep('confirm');
    } else {
      if (val !== firstPin) {
        setError('PINs do not match. Try again.');
        setPin('');
        setStep('enter');
        setFirstPin('');
        return;
      }
      const hash = await sha256(val);
      await Preferences.set({ key: 'applock_pin_hash', value: hash });
      await Preferences.set({ key: 'applock_enabled', value: 'true' });
      onDone();
    }
  };

  return (
    <div className="flex flex-col items-center w-full max-w-sm mx-auto">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#7367f0] to-[#3d5af1] flex items-center justify-center mb-6 shadow-lg shadow-[#7367f0]/30">
        <span className="text-white font-black text-2xl">R</span>
      </div>
      <h1 className="text-2xl font-black text-white mb-1">Set App PIN</h1>
      <p className="text-[#8892b0] text-sm text-center mb-2">
        {step === 'enter' ? 'Choose a 4-digit PIN to lock the app' : 'Confirm your PIN'}
      </p>
      {error && <p className="text-[#ef4444] text-sm font-medium mb-2">{error}</p>}
      <PinDots value={pin} max={PIN_LEN} />
      <PinPad onDigit={addDigit} onDelete={() => setPin(p => p.slice(0, -1))} />
    </div>
  );
}

// ─── PIN UNLOCK SCREEN ────────────────────────────────────────────────────────
function PinUnlock({ onUnlocked, onReset }: { onUnlocked: () => void; onReset: () => void }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const PIN_LEN = 4;
  const MAX_ATTEMPTS = 5;

  useEffect(() => {
    checkBiometric();
    if (Capacitor.isNativePlatform()) {
      tryBiometric();
    }
  }, []);

  const checkBiometric = async () => {
    try {
      const res = await NativeBiometric.isAvailable();
      setBiometricAvailable(res.isAvailable);
    } catch {
      setBiometricAvailable(false);
    }
  };

  const tryBiometric = async () => {
    try {
      const res = await NativeBiometric.isAvailable();
      if (!res.isAvailable) return;
      await NativeBiometric.verifyIdentity({
        reason: 'Unlock Robifel Admin',
        title: 'Robifel Admin',
        subtitle: 'Biometric Authentication',
        description: 'Use your fingerprint or face to unlock',
        negativeButtonText: 'Use PIN',
        maxAttempts: 3,
      });
      onUnlocked();
    } catch {
      // biometric failed or cancelled - stay on PIN screen
    }
  };

  const addDigit = (d: string) => {
    if (pin.length >= PIN_LEN) return;
    const next = pin + d;
    setPin(next);
    setError('');
    if (next.length === PIN_LEN) {
      setTimeout(() => verify(next), 150);
    }
  };

  const verify = async (val: string) => {
    const hash = await sha256(val);
    const stored = await Preferences.get({ key: 'applock_pin_hash' });
    if (hash === stored.value) {
      setAttempts(0);
      onUnlocked();
    } else {
      const newAttempts = attempts + 1;
      setAttempts(newAttempts);
      if (newAttempts >= MAX_ATTEMPTS) {
        setError(`Too many attempts. Reset PIN by logging in again.`);
      } else {
        setError(`Incorrect PIN. ${MAX_ATTEMPTS - newAttempts} attempt${MAX_ATTEMPTS - newAttempts === 1 ? '' : 's'} remaining.`);
      }
      setPin('');
    }
  };

  return (
    <div className="flex flex-col items-center w-full max-w-sm mx-auto">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#7367f0] to-[#3d5af1] flex items-center justify-center mb-6 shadow-lg shadow-[#7367f0]/30">
        <span className="text-white font-black text-2xl">R</span>
      </div>
      <h1 className="text-2xl font-black text-white mb-1">Robifel Admin</h1>
      <p className="text-[#8892b0] text-sm text-center mb-2">Enter your PIN to continue</p>
      {error && <p className="text-[#ef4444] text-sm font-medium text-center mb-2 px-4">{error}</p>}
      <PinDots value={pin} max={PIN_LEN} />
      <PinPad onDigit={addDigit} onDelete={() => setPin(p => p.slice(0, -1))} />
      {biometricAvailable && (
        <button
          onClick={tryBiometric}
          className="mt-6 flex items-center gap-2 text-[#7367f0] font-semibold text-sm hover:text-[#9d95f5] transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7.864 4.243A7.5 7.5 0 0119.5 10.5c0 2.92-.556 5.709-1.568 8.268M5.742 6.364A7.465 7.465 0 004.5 10.5a7.464 7.464 0 01-1.15 3.993m1.989 3.559A11.209 11.209 0 008.25 10.5a3.75 3.75 0 117.5 0c0 .527-.021 1.049-.064 1.565M12 10.5a14.94 14.94 0 01-3.6 9.75m6.633-4.596a18.666 18.666 0 01-2.485 5.33" />
          </svg>
          Use Biometrics
        </button>
      )}
      {attempts >= MAX_ATTEMPTS && (
        <button
          onClick={onReset}
          className="mt-4 text-[#8892b0] underline text-xs hover:text-white transition-colors"
        >
          Reset PIN (requires re-login)
        </button>
      )}
    </div>
  );
}

// ─── App Lock Provider ────────────────────────────────────────────────────────
export function AppLockProvider({ children }: { children: React.ReactNode }) {
  const [lockState, setLockState] = useState<LockState>('checking');
  const backgroundTimestamp = useRef<number | null>(null);
  const LOCK_AFTER_BG_MS = 30_000; // re-lock after 30s in background

  // Only active in native Capacitor (not browser)
  const isNative = Capacitor.isNativePlatform();

  useEffect(() => {
    if (!isNative) {
      setLockState('unlocked');
      return;
    }
    initLock();
  }, [isNative]);

  const initLock = async () => {
    const enabled = await Preferences.get({ key: 'applock_enabled' });
    if (enabled.value === 'true') {
      setLockState('locked');
    } else {
      setLockState('setup');
    }
  };

  // Listen for app going to background / foreground
  useEffect(() => {
    if (!isNative) return;
    const sub = CapApp.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) {
        backgroundTimestamp.current = Date.now();
      } else {
        if (backgroundTimestamp.current !== null) {
          const elapsed = Date.now() - backgroundTimestamp.current;
          if (elapsed >= LOCK_AFTER_BG_MS && lockState === 'unlocked') {
            setLockState('locked');
          }
          backgroundTimestamp.current = null;
        }
      }
    });
    return () => { sub.then(h => h.remove()); };
  }, [isNative, lockState]);

  const unlock = useCallback(() => setLockState('unlocked'), []);

  const resetPin = useCallback(async () => {
    await Preferences.remove({ key: 'applock_pin_hash' });
    await Preferences.remove({ key: 'applock_enabled' });
    setLockState('setup');
  }, []);

  const ctx: AppLockCtx = {
    isLocked: lockState === 'locked' || lockState === 'setup',
    unlock,
    resetPin,
  };

  return (
    <AppLockContext.Provider value={ctx}>
      {children}
      {isNative && (lockState === 'setup' || lockState === 'locked') && (
        <div
          className="fixed inset-0 z-[9999] flex flex-col items-center justify-center px-6"
          style={{ background: '#0f1422' }}
        >
          <div className="w-full max-w-sm">
            {lockState === 'setup' && (
              <PinSetup onDone={unlock} />
            )}
            {lockState === 'locked' && (
              <PinUnlock
                onUnlocked={unlock}
                onReset={resetPin}
              />
            )}
          </div>
          <p className="absolute bottom-8 text-[#3a4060] text-xs">Robifel Admin v2.0</p>
        </div>
      )}
    </AppLockContext.Provider>
  );
}

export function useAppLock() {
  return useContext(AppLockContext);
}
