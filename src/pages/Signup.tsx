import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { BRAND } from '../config/brand';
import {
  Zap, Sun, Moon, Building2, Mail, Lock, Eye, EyeOff, User,
  AlertCircle, CheckCircle, RefreshCw, ArrowLeft, ArrowRight, Loader2,
} from 'lucide-react';

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 32);

type Avail = 'idle' | 'checking' | 'ok' | 'taken' | 'short';

declare global { interface Window { Razorpay?: any } }

function loadRazorpay(): Promise<boolean> {
  return new Promise(resolve => {
    if (window.Razorpay) return resolve(true);
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

export default function Signup() {
  const { isDark: dark, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [plan, setPlan] = useState<'starter' | 'pro'>('starter');

  const [avail, setAvail] = useState<Avail>('idle');
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<'form' | 'provisioning' | 'done'>('form');
  const [error, setError] = useState<string | null>(null);
  const debounce = useRef<any>(null);

  const slug = slugify(name);

  // Live availability check (debounced).
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (!slug) { setAvail('idle'); return; }
    if (slug.length < 3) { setAvail('short'); return; }
    setAvail('checking');
    debounce.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/signup/check-availability?slug=${encodeURIComponent(slug)}`);
        const d = await r.json();
        setAvail(d.available ? 'ok' : 'taken');
      } catch { setAvail('idle'); }
    }, 450);
    return () => debounce.current && clearTimeout(debounce.current);
  }, [slug]);

  const canSubmit = name.trim() && email.trim() && password.length >= 6 && avail === 'ok' && !busy;

  const finalize = async (extra: Record<string, any> = {}) => {
    setPhase('provisioning');
    const r = await fetch('/api/signup/finalize', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, workspaceName: name.trim(), email: email.trim(), password, plan, ...extra }),
    });
    const d = await r.json();
    if (!r.ok || !d.success) throw new Error(d.error || 'Could not create workspace');
    setPhase('done');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true); setError(null);
    try {
      const pr = await fetch('/api/signup/pre-register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, workspaceName: name.trim(), email: email.trim(), password, plan }),
      });
      const pd = await pr.json();
      if (!pr.ok) throw new Error(pd.error || 'Sign-up failed');

      if (!pd.razorpayEnabled) {
        // Trial mode -- provision directly.
        await finalize();
      } else {
        const ok = await loadRazorpay();
        if (!ok) throw new Error('Could not load the payment gateway. Try again.');
        await new Promise<void>((resolve, reject) => {
          const rzp = new window.Razorpay({
            key: pd.keyId,
            subscription_id: pd.subscriptionId,
            name: BRAND,
            description: `${plan === 'pro' ? 'Pro' : 'Starter'} plan`,
            prefill: { email: email.trim() },
            theme: { color: '#7367f0' },
            handler: async (resp: any) => {
              try {
                await finalize({
                  razorpay_payment_id: resp.razorpay_payment_id,
                  razorpay_subscription_id: resp.razorpay_subscription_id,
                  razorpay_signature: resp.razorpay_signature,
                });
                resolve();
              } catch (err) { reject(err); }
            },
            modal: { ondismiss: () => reject(new Error('Payment cancelled')) },
          });
          rzp.open();
        });
      }
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
      setPhase('form');
    } finally { setBusy(false); }
  };

  const inputCls = `input pl-10 ${dark ? 'bg-[#1e2440] border-[#2a3250] text-white focus:border-[#7367f0]' : 'border-gray-200 focus:border-[#7367f0]'}`;
  const labelCls = `label ${dark ? 'text-[#4a5580]' : 'text-gray-500'}`;

  // ---- Provisioning screen ----
  if (phase === 'provisioning') {
    return (
      <Shell dark={dark}>
        <div className="text-center">
          <Loader2 size={44} className="mx-auto text-[#7367f0] animate-spin" />
          <h2 className={`text-xl font-black mt-5 ${dark ? 'text-white' : 'text-gray-900'}`}>Creating your workspace</h2>
          <p className={`text-sm mt-2 ${dark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>
            Setting up your private database and installing modules. This can take up to a minute -- please keep this tab open.
          </p>
        </div>
      </Shell>
    );
  }

  // ---- Success screen ----
  if (phase === 'done') {
    return (
      <Shell dark={dark}>
        <div className="text-center">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-emerald-500/15 flex items-center justify-center mb-4">
            <CheckCircle size={34} className="text-emerald-500" />
          </div>
          <h2 className={`text-2xl font-black ${dark ? 'text-white' : 'text-gray-900'}`}>Workspace ready!</h2>
          <p className={`text-sm mt-2 ${dark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>
            <b>{name.trim()}</b> is set up. Sign in with <b>{email.trim()}</b> to get started.
          </p>
          <button onClick={() => navigate('/login')}
            className="btn-primary w-full justify-center py-3 text-sm font-bold mt-6"
            style={{ background: 'linear-gradient(135deg, #7367f0, #3d5af1)' }}>
            Go to Sign In <ArrowRight size={16} />
          </button>
        </div>
      </Shell>
    );
  }

  // ---- Signup form ----
  return (
    <div className={`min-h-screen flex ${dark ? 'bg-[#0f1422]' : 'bg-[#f8f9fc]'}`}>
      {/* Left brand panel */}
      <div className="hidden lg:flex flex-col justify-center flex-1 p-12 text-white relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #7367f0 0%, #4f46e5 55%, #3d5af1 100%)' }}>
        <div className="absolute -right-16 -top-20 w-80 h-80 rounded-full bg-white/10" />
        <div className="relative max-w-md mx-auto text-center">
          <div className="w-16 h-16 rounded-2xl bg-white/15 flex items-center justify-center mx-auto mb-6">
            <Zap size={36} className="text-white" />
          </div>
          <h1 className="text-4xl font-black mb-4 leading-tight">Start your<br/>{BRAND} workspace</h1>
          <p className="text-white/70 text-lg max-w-sm mx-auto leading-relaxed">
            Your own private Odoo 18 business suite -- inventory, accounting, HR, settlements and more, ready in a minute.
          </p>
        </div>
      </div>

      {/* Right form */}
      <div className={`flex-1 lg:max-w-[480px] flex flex-col items-center justify-center p-8 relative ${dark ? 'bg-[#0f1422]' : 'bg-white'}`}>
        <button onClick={toggleTheme}
          className={`absolute top-6 right-6 p-2.5 rounded-xl border transition-all ${dark ? 'border-[#2a3250] text-amber-400 hover:bg-[#1e2440]' : 'border-gray-200 text-violet-600 hover:bg-gray-50'}`}>
          {dark ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        <div className="w-full max-w-sm">
          <Link to="/login" className={`flex items-center gap-1.5 text-xs font-semibold mb-6 transition-colors ${dark ? 'text-[#5a6a8a] hover:text-[#7367f0]' : 'text-gray-400 hover:text-violet-600'}`}>
            <ArrowLeft size={14} /> Back to sign in
          </Link>

          <h2 className={`text-2xl font-black mb-1 ${dark ? 'text-white' : 'text-gray-900'}`}>Create your workspace</h2>
          <p className={`text-sm mb-7 ${dark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>Set up a new business account in minutes.</p>

          {error && (
            <div className="mb-5 p-3.5 rounded-xl bg-red-500/10 border border-red-500/25 flex items-start gap-2.5">
              <AlertCircle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-400">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className={labelCls}>Business Name</label>
              <div className="relative">
                <Building2 size={16} className={`absolute left-3.5 top-1/2 -translate-y-1/2 ${dark ? 'text-[#4a5580]' : 'text-gray-400'}`} />
                <input value={name} onChange={e => setName(e.target.value)} placeholder="Acme Traders" required autoFocus className={inputCls} />
              </div>
              {slug && (
                <div className="mt-1.5 flex items-center gap-1.5 text-[11px]">
                  <span className={dark ? 'text-[#5a6a8a]' : 'text-gray-400'}>Workspace:</span>
                  <span className="font-mono font-semibold text-[#7367f0]">{slug || '...'}</span>
                  {avail === 'checking' && <RefreshCw size={11} className="animate-spin text-[#5a6a8a]" />}
                  {avail === 'ok' && <span className="text-emerald-500 flex items-center gap-0.5"><CheckCircle size={11} /> available</span>}
                  {avail === 'taken' && <span className="text-red-400 flex items-center gap-0.5"><AlertCircle size={11} /> taken</span>}
                  {avail === 'short' && <span className="text-amber-500">min 3 chars</span>}
                </div>
              )}
            </div>

            <div>
              <label className={labelCls}>Your Email</label>
              <div className="relative">
                <Mail size={16} className={`absolute left-3.5 top-1/2 -translate-y-1/2 ${dark ? 'text-[#4a5580]' : 'text-gray-400'}`} />
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" required autoComplete="email" className={inputCls} />
              </div>
            </div>

            <div>
              <label className={labelCls}>Password</label>
              <div className="relative">
                <Lock size={16} className={`absolute left-3.5 top-1/2 -translate-y-1/2 ${dark ? 'text-[#4a5580]' : 'text-gray-400'}`} />
                <input type={showPass ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="At least 6 characters" required minLength={6} autoComplete="new-password" className={`${inputCls} pr-10`} />
                <button type="button" onClick={() => setShowPass(p => !p)}
                  className={`absolute right-3.5 top-1/2 -translate-y-1/2 ${dark ? 'text-[#4a5580] hover:text-gray-300' : 'text-gray-400 hover:text-gray-600'}`}>
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <div>
              <label className={labelCls}>Plan</label>
              <div className="grid grid-cols-2 gap-3">
                {([['starter', 'Starter', 'For small teams'], ['pro', 'Pro', 'Growing businesses']] as const).map(([val, title, desc]) => (
                  <button key={val} type="button" onClick={() => setPlan(val)}
                    className={`text-left px-3 py-2.5 rounded-xl border transition-all ${plan === val ? 'border-[#7367f0] bg-[#7367f0]/10' : dark ? 'border-[#2a3250]' : 'border-gray-200'}`}>
                    <p className={`text-sm font-bold ${plan === val ? 'text-[#7367f0]' : dark ? 'text-white' : 'text-gray-900'}`}>{title}</p>
                    <p className={`text-[11px] ${dark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>{desc}</p>
                  </button>
                ))}
              </div>
            </div>

            <button type="submit" disabled={!canSubmit}
              className="btn-primary w-full justify-center py-3 text-sm font-bold mt-2 disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #7367f0, #3d5af1)' }}>
              {busy ? <RefreshCw size={16} className="animate-spin" /> : <User size={16} />}
              {busy ? 'Setting up...' : 'Create Workspace'}
            </button>
          </form>

          <p className={`text-center text-xs mt-6 ${dark ? 'text-[#3a4a6a]' : 'text-gray-400'}`}>
            Already have a workspace? <Link to="/login" className="text-[#7367f0] font-semibold">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

function Shell({ dark, children }: { dark: boolean; children: React.ReactNode }) {
  return (
    <div className={`min-h-screen flex items-center justify-center p-6 ${dark ? 'bg-[#0f1422]' : 'bg-[#f8f9fc]'}`}>
      <div className={`w-full max-w-sm rounded-3xl p-8 border ${dark ? 'bg-[#161b2e] border-[#2a3250]' : 'bg-white border-gray-200 shadow-xl'}`}>
        {children}
      </div>
    </div>
  );
}
