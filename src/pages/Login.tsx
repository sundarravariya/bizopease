import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import type { User } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { odooLogin, userIsManager } from '../services/odoo';
import { setQueenToken } from '../services/queen';
import { Lock, Mail, Eye, EyeOff, Zap, Sun, Moon, AlertCircle, RefreshCw, ArrowLeft, CheckCircle, Building2, ShieldCheck } from 'lucide-react';
import { BRAND } from '../config/brand';

type Step = 'email' | 'password' | 'otp';

interface FoundWorkspace {
  tenantId: string;
  workspaceName: string;
  odooDb: string;
  otpEnabled: boolean;
  isQueenTenant?: boolean;
}

export default function Login() {
  const { login, isLoading, error, clearError, setAuthUser } = useAuth();
  const { isDark, toggleTheme } = useTheme();

  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [workspace, setWorkspace] = useState<FoundWorkspace | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  // OTP state
  const [otpCode, setOtpCode] = useState('');
  const [otpError, setOtpError] = useState('');
  const [otpSending, setOtpSending] = useState(false);
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [pendingUser, setPendingUser] = useState<User | null>(null);
  const [pendingEmail, setPendingEmail] = useState('');

  // ── STEP 1: Find workspace by email ────────────────────────────────────────
  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLookupLoading(true);
    setLookupError(null);

    try {
      const r = await fetch('/api/auth/find-workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const data = await r.json();

      if (!r.ok || data.error) {
        setLookupError(data.error || 'No workspace found for this email.');
        return;
      }

      setWorkspace(data as FoundWorkspace);
      setStep('password');
      setTimeout(() => document.getElementById('biz-password-input')?.focus(), 80);
    } catch {
      setLookupError('Network error. Please try again.');
    } finally {
      setLookupLoading(false);
    }
  };

  // ── STEP 2: Authenticate ───────────────────────────────────────────────────
  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspace) return;
    clearError();
    setLookupError(null);

    // Queen tenant: authenticate against port-8070 Queenfinger Odoo
    if (workspace.isQueenTenant) {
      setLookupLoading(true);
      try {
        const r = await fetch('/api/queen/authenticate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ login: email.trim().toLowerCase(), password }),
        });
        const result = await r.json();
        if (!r.ok || result.error) throw new Error(result.error || 'Invalid credentials');

        // Store the queen JWT so queenCall() can authorize against /api/queen/rpc.
        if (result.token) setQueenToken(result.token);

        const userData: User = {
          uid: result.uid,
          name: result.name || email,
          username: result.username || email,
          email: result.username || email,
          db: result.db || workspace.odooDb,
          company_id: Array.isArray(result.company_id) ? result.company_id : [1, ''],
          company_name: result.company_name || workspace.workspaceName,
          is_admin: true, // queen users bypass the WorkHoursGate
          session_id: `queen-${result.uid}-${Date.now()}`,
          is_queen_tenant: true,
        };
        setAuthUser(userData);
      } catch (err: any) {
        setLookupError(err.message || 'Authentication failed');
      } finally {
        setLookupLoading(false);
      }
      return;
    }

    // If OTP is enabled: verify credentials first without committing to auth context
    if (workspace.otpEnabled) {
      setLookupLoading(true);
      try {
        const result = await odooLogin(email.trim().toLowerCase(), password, workspace.odooDb);
        if (!result?.uid) throw new Error('Incorrect password. Please try again.');

        let isAdmin = result.is_system || result.is_admin || false;
        try { isAdmin = await userIsManager(); } catch { /* keep Odoo value */ }

        const userData: User = {
          uid: result.uid,
          name: result.name || email,
          username: result.username || email,
          email: result.username || email,
          db: result.db || workspace.odooDb,
          company_id: Array.isArray(result.company_id) ? result.company_id : [1],
          company_name: result.company_name || workspace.workspaceName,
          is_admin: isAdmin,
          session_id: `odoo-${result.uid}-${Date.now()}`,
          is_queen_tenant: workspace.isQueenTenant ?? false,
        };

        if (isAdmin) {
          // Admin + OTP enabled → send code, hold user pending OTP
          setPendingUser(userData);
          setPendingEmail(userData.email || email);
          setOtpCode('');
          setOtpError('');
          setOtpSending(true);
          const sr = await fetch('/api/auth/send-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: userData.email || email }),
          });
          const sd = await sr.json();
          if (!sr.ok) throw new Error(sd.error || 'Failed to send verification email.');
          setStep('otp');
        } else {
          // Non-admin: OTP not required, complete login immediately
          setAuthUser(userData);
        }
      } catch (err: any) {
        setLookupError(err.message || 'Authentication failed');
      } finally {
        setLookupLoading(false);
        setOtpSending(false);
      }
      return;
    }

    // OTP disabled: regular login flow (use setAuthUser to include is_queen_tenant)
    setLookupLoading(true);
    try {
      const result = await odooLogin(email.trim().toLowerCase(), password, workspace.odooDb);
      if (!result?.uid) throw new Error('Invalid credentials — please try again.');
      let isAdmin = result.is_system || result.is_admin || false;
      try { isAdmin = await userIsManager(); } catch { /* keep Odoo value */ }
      const userData: User = {
        uid: result.uid,
        name: result.name || email,
        username: result.username || email,
        email: result.username || email,
        db: result.db || workspace.odooDb,
        company_id: Array.isArray(result.company_id) ? result.company_id : [1],
        company_name: result.company_name || workspace.workspaceName,
        is_admin: isAdmin,
        session_id: `odoo-${result.uid}-${Date.now()}`,
        is_queen_tenant: workspace.isQueenTenant ?? false,
      };
      setAuthUser(userData);
    } catch (err: any) {
      setLookupError(err.message || 'Authentication failed');
    } finally {
      setLookupLoading(false);
    }
  };

  // ── STEP 3: OTP verify ─────────────────────────────────────────────────────
  const handleOtpVerify = async () => {
    if (!pendingUser || otpCode.length < 6) return;
    setOtpVerifying(true);
    setOtpError('');
    try {
      const r = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: pendingEmail, code: otpCode }),
      });
      const d = await r.json();
      if (!r.ok) { setOtpError(d.error || 'Verification failed.'); return; }
      setAuthUser(pendingUser);
    } catch {
      setOtpError('Network error. Try again.');
    } finally {
      setOtpVerifying(false);
    }
  };

  const handleResendOtp = async () => {
    if (!pendingEmail || otpSending) return;
    setOtpSending(true);
    setOtpError('');
    setOtpCode('');
    try {
      await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: pendingEmail }),
      });
    } finally {
      setOtpSending(false);
    }
  };

  const goBack = () => {
    setStep('email');
    setLookupError(null);
    clearError();
    setPassword('');
    setWorkspace(null);
    setPendingUser(null);
    setOtpCode('');
    setOtpError('');
  };

  const dark = isDark;

  return (
    <div className={`min-h-screen flex ${dark ? 'bg-[#0f1422]' : 'bg-gradient-to-br from-[#f0f4ff] via-[#faf5ff] to-[#f0f4ff]'}`}>

      {/* ── Left panel — decorative ────────────────────────────────────────── */}
      <div className="hidden lg:flex flex-1 relative overflow-hidden bg-gradient-to-br from-[#7367f0] via-[#5a52e0] to-[#3d5af1] items-center justify-center">
        <div className="absolute top-[-10%] left-[-10%] w-96 h-96 rounded-full opacity-20"
          style={{ background: 'radial-gradient(circle, #fff 0%, transparent 70%)' }} />
        <div className="absolute bottom-[-5%] right-[-5%] w-80 h-80 rounded-full opacity-15"
          style={{ background: 'radial-gradient(circle, #3d5af1 0%, transparent 70%)' }} />

        <div className="relative z-10 text-white text-center px-12">
          <div className="w-20 h-20 rounded-3xl bg-white/20 backdrop-blur-md border border-white/30 flex items-center justify-center mx-auto mb-6 shadow-2xl">
            <Zap size={36} className="text-white" />
          </div>
          <h1 className="text-4xl font-black mb-4 leading-tight">BizOpease<br/>Business Portal</h1>
          <p className="text-white/70 text-lg max-w-sm mx-auto leading-relaxed">
            Complete Odoo 18 management — Flipkart OS, Settlements, B2B, Accounting and more.
          </p>
          <div className="mt-10 grid grid-cols-3 gap-4 max-w-sm mx-auto">
            {[{ label: 'Modules', value: '12+' }, { label: 'Custom Addons', value: '5' }, { label: 'Real-time', value: 'Yes' }].map(s => (
              <div key={s.label} className="bg-white/10 backdrop-blur-sm rounded-2xl p-3 border border-white/20">
                <p className="text-2xl font-black">{s.value}</p>
                <p className="text-white/60 text-xs mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Right panel — form ─────────────────────────────────────────────── */}
      <div className={`flex-1 lg:max-w-[480px] flex flex-col items-center justify-center p-8 relative ${dark ? 'bg-[#0f1422]' : 'bg-white'}`}>

        <button onClick={toggleTheme}
          className={`absolute top-6 right-6 p-2.5 rounded-xl border transition-all ${dark ? 'border-[#2a3250] text-amber-400 hover:bg-[#1e2440]' : 'border-gray-200 text-violet-600 hover:bg-gray-50'}`}>
          {dark ? <Moon size={18} /> : <Moon size={18} />}
        </button>

        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#7367f0] to-[#3d5af1] flex items-center justify-center">
              <Zap size={20} className="text-white" />
            </div>
            <div>
              <p className={`font-black text-lg ${dark ? 'text-white' : 'text-gray-900'}`}>{BRAND}</p>
              <p className="text-[11px] text-[#7367f0] font-semibold">Business Portal</p>
            </div>
          </div>

          {/* ── STEP 1: Email ── */}
          {step === 'email' && (
            <>
              <h2 className={`text-2xl font-black mb-1 ${dark ? 'text-white' : 'text-gray-900'}`}>Welcome back 👋</h2>
              <p className={`text-sm mb-8 ${dark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>Enter your business email to find your workspace</p>

              {lookupError && (
                <div className="mb-5 p-3.5 rounded-xl bg-red-500/10 border border-red-500/25 flex items-start gap-2.5">
                  <AlertCircle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-red-400">Workspace not found</p>
                    <p className="text-xs text-red-400/80 mt-0.5">{lookupError}</p>
                  </div>
                </div>
              )}

              <form onSubmit={handleEmailSubmit} className="space-y-4">
                <div>
                  <label className={`label ${dark ? 'text-[#4a5580]' : 'text-gray-500'}`}>Business Email</label>
                  <div className="relative">
                    <Mail size={16} className={`absolute left-3.5 top-1/2 -translate-y-1/2 ${dark ? 'text-[#4a5580]' : 'text-gray-400'}`} />
                    <input type="email" value={email} onChange={e => { setEmail(e.target.value); setLookupError(null); }}
                      placeholder="you@company.com" required autoFocus autoComplete="email"
                      className={`input pl-10 ${dark ? 'bg-[#1e2440] border-[#2a3250] text-white focus:border-[#7367f0]' : 'border-gray-200 focus:border-[#7367f0]'}`} />
                  </div>
                </div>
                <button type="submit" disabled={lookupLoading}
                  className="btn-primary w-full justify-center py-3 text-sm font-bold mt-2"
                  style={{ background: 'linear-gradient(135deg, #7367f0, #3d5af1)' }}>
                  {lookupLoading ? <RefreshCw size={16} className="animate-spin" /> : <Mail size={16} />}
                  {lookupLoading ? 'Finding workspace...' : 'Continue →'}
                </button>
              </form>

              <p className={`text-center text-sm mt-6 ${dark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>
                New to {BRAND}? <Link to="/signup" className="text-[#7367f0] font-bold">Create a workspace</Link>
              </p>
            </>
          )}

          {/* ── STEP 2: Password ── */}
          {step === 'password' && workspace && (
            <>
              <button onClick={goBack}
                className={`flex items-center gap-1.5 text-xs font-semibold mb-6 transition-colors ${dark ? 'text-[#5a6a8a] hover:text-[#7367f0]' : 'text-gray-400 hover:text-violet-600'}`}>
                <ArrowLeft size={14} /> Back
              </button>

              <h2 className={`text-2xl font-black mb-1 ${dark ? 'text-white' : 'text-gray-900'}`}>Enter your password</h2>
              <p className={`text-sm mb-5 ${dark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>Signing in to your workspace</p>

              <div className={`flex items-center gap-3 rounded-xl p-3.5 mb-6 border ${dark ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-emerald-50 border-emerald-200'}`}>
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${dark ? 'bg-emerald-500/20' : 'bg-emerald-100'}`}>
                  <Building2 size={18} className="text-emerald-500" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-emerald-500 leading-tight">{workspace.workspaceName}</p>
                  <p className={`text-xs font-mono truncate mt-0.5 ${dark ? 'text-[#4a7a6a]' : 'text-emerald-600/70'}`}>db: {workspace.odooDb}</p>
                </div>
                <CheckCircle size={16} className="text-emerald-500 flex-shrink-0 ml-auto" />
              </div>

              {(error || lookupError) && (
                <div className="mb-5 p-3.5 rounded-xl bg-red-500/10 border border-red-500/25 flex items-start gap-2.5">
                  <AlertCircle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-red-400">Authentication failed</p>
                    <p className="text-xs text-red-400/80 mt-0.5">{error || lookupError}</p>
                  </div>
                </div>
              )}

              <form onSubmit={handlePasswordSubmit} className="space-y-4">
                <div>
                  <label className={`label ${dark ? 'text-[#4a5580]' : 'text-gray-500'}`}>Email</label>
                  <div className="relative">
                    <Mail size={16} className={`absolute left-3.5 top-1/2 -translate-y-1/2 ${dark ? 'text-[#4a5580]' : 'text-gray-400'}`} />
                    <input type="email" value={email} readOnly
                      className={`input pl-10 opacity-60 cursor-default select-none ${dark ? 'bg-[#1a1e30] border-[#2a3250] text-white' : 'border-gray-200 bg-gray-50'}`} />
                  </div>
                </div>
                <div>
                  <label className={`label ${dark ? 'text-[#4a5580]' : 'text-gray-500'}`}>Password</label>
                  <div className="relative">
                    <Lock size={16} className={`absolute left-3.5 top-1/2 -translate-y-1/2 ${dark ? 'text-[#4a5580]' : 'text-gray-400'}`} />
                    <input id="biz-password-input" type={showPass ? 'text' : 'password'} value={password}
                      onChange={e => { if (password !== e.target.value) { clearError(); setLookupError(null); } setPassword(e.target.value); }}
                      placeholder="••••••••" required autoComplete="current-password"
                      className={`input pl-10 pr-10 ${dark ? 'bg-[#1e2440] border-[#2a3250] text-white focus:border-[#7367f0]' : 'border-gray-200 focus:border-[#7367f0]'}`} />
                    <button type="button" onClick={() => setShowPass(p => !p)}
                      className={`absolute right-3.5 top-1/2 -translate-y-1/2 ${dark ? 'text-[#4a5580] hover:text-gray-300' : 'text-gray-400 hover:text-gray-600'}`}>
                      {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                <button type="submit" disabled={isLoading || lookupLoading}
                  className="btn-primary w-full justify-center py-3 text-sm font-bold mt-2"
                  style={{ background: 'linear-gradient(135deg, #7367f0, #3d5af1)' }}>
                  {(isLoading || lookupLoading) ? <RefreshCw size={16} className="animate-spin" /> : <Lock size={16} />}
                  {(isLoading || lookupLoading) ? 'Signing in...' : 'Sign in to Workspace'}
                </button>
              </form>
            </>
          )}

          {/* ── STEP 3: OTP ── */}
          {step === 'otp' && (
            <>
              <button onClick={() => { setStep('password'); setOtpCode(''); setOtpError(''); }}
                className={`flex items-center gap-1.5 text-xs font-semibold mb-6 transition-colors ${dark ? 'text-[#5a6a8a] hover:text-[#7367f0]' : 'text-gray-400 hover:text-violet-600'}`}>
                <ArrowLeft size={14} /> Back
              </button>

              <div className="w-14 h-14 rounded-2xl bg-[#7367f0]/15 flex items-center justify-center mx-auto mb-4">
                <ShieldCheck size={28} className="text-[#7367f0]" />
              </div>
              <h2 className={`text-2xl font-black mb-1 text-center ${dark ? 'text-white' : 'text-gray-900'}`}>Admin Verification</h2>
              <p className={`text-sm mb-6 text-center ${dark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>
                A 6-digit code was sent to <strong className={dark ? 'text-white' : 'text-gray-800'}>{pendingEmail}</strong>
              </p>

              {otpError && (
                <div className="mb-4 p-3.5 rounded-xl bg-red-500/10 border border-red-500/25 flex items-start gap-2.5">
                  <AlertCircle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-red-400">{otpError}</p>
                </div>
              )}

              <div className="space-y-4">
                <input type="text" inputMode="numeric" maxLength={6} value={otpCode}
                  onChange={e => { setOtpCode(e.target.value.replace(/\D/g, '')); setOtpError(''); }}
                  placeholder="000000" autoFocus
                  className={`w-full text-center text-3xl font-black tracking-[0.4em] py-4 rounded-2xl border outline-none transition-all ${dark ? 'bg-[#1e2440] border-[#2a3250] text-white focus:border-[#7367f0]' : 'bg-gray-50 border-gray-200 text-gray-900 focus:border-[#7367f0]'}`} />

                <button onClick={handleOtpVerify} disabled={otpCode.length < 6 || otpVerifying}
                  className="btn-primary w-full justify-center py-3 text-sm font-bold"
                  style={{ background: 'linear-gradient(135deg, #7367f0, #3d5af1)' }}>
                  {otpVerifying ? <RefreshCw size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
                  {otpVerifying ? 'Verifying…' : 'Verify & Sign In'}
                </button>

                <button onClick={handleResendOtp} disabled={otpSending}
                  className={`w-full text-center text-sm py-1 transition-colors ${dark ? 'text-[#7367f0] hover:text-[#9d95f5]' : 'text-violet-600 hover:text-violet-800'}`}>
                  {otpSending ? 'Sending…' : 'Resend code'}
                </button>
              </div>
            </>
          )}

          <p className={`text-center text-xs mt-8 ${dark ? 'text-[#3a4a6a]' : 'text-gray-400'}`}>
            {BRAND} · Powered by Odoo 18
          </p>
        </div>
      </div>
    </div>
  );
}
