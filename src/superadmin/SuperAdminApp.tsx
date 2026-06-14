import { useState } from 'react';
import { ShieldCheck, Lock, User, KeyRound, AlertCircle, RefreshCw } from 'lucide-react';
import { sa, getToken, setToken, clearToken } from './api';
import SuperAdminDashboard from './SuperAdminDashboard';

export default function SuperAdminApp() {
  const [authed, setAuthed] = useState(!!getToken());

  if (authed) {
    return <SuperAdminDashboard onLogout={() => { clearToken(); setAuthed(false); }} />;
  }
  return <SaLogin onAuthed={() => setAuthed(true)} />;
}

function SaLogin({ onAuthed }: { onAuthed: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needs2fa, setNeeds2fa] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await sa.login(username.trim(), password, needs2fa ? code.trim() : undefined);
      if (r.twoFactorRequired) { setNeeds2fa(true); setBusy(false); return; }
      if (r.token) { setToken(r.token); onAuthed(); return; }
      setError('Unexpected response');
    } catch (err: any) { setError(err.message || 'Login failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: '#0b0f1c' }}>
      <div className="w-full max-w-sm rounded-3xl p-8 border border-[#2a3250] bg-[#12182b]">
        <div className="flex flex-col items-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#7367f0] to-[#3d5af1] flex items-center justify-center mb-3">
            <ShieldCheck size={28} className="text-white" />
          </div>
          <h1 className="text-white font-black text-lg">BizOpease Superadmin</h1>
          <p className="text-[#6a7a9a] text-xs mt-1">Platform control panel</p>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/25 flex items-start gap-2">
            <AlertCircle size={15} className="text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-red-400">{error}</p>
          </div>
        )}

        <form onSubmit={submit} className="space-y-3">
          <div className="relative">
            <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4a5580]" />
            <input value={username} onChange={e => setUsername(e.target.value)} placeholder="Username" required autoFocus
              className="w-full rounded-xl pl-9 pr-3 py-2.5 text-sm bg-[#1e2440] border border-[#2a3250] text-white outline-none focus:border-[#7367f0]" />
          </div>
          <div className="relative">
            <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4a5580]" />
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" required
              className="w-full rounded-xl pl-9 pr-3 py-2.5 text-sm bg-[#1e2440] border border-[#2a3250] text-white outline-none focus:border-[#7367f0]" />
          </div>
          {needs2fa && (
            <div className="relative">
              <KeyRound size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4a5580]" />
              <input value={code} onChange={e => setCode(e.target.value)} placeholder="6-digit 2FA code" inputMode="numeric" maxLength={6} required autoFocus
                className="w-full rounded-xl pl-9 pr-3 py-2.5 text-sm bg-[#1e2440] border border-[#2a3250] text-white outline-none focus:border-[#7367f0] tracking-widest" />
            </div>
          )}
          <button type="submit" disabled={busy}
            className="w-full py-2.5 rounded-xl bg-[#7367f0] hover:bg-[#5e54d4] text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60">
            {busy ? <RefreshCw size={15} className="animate-spin" /> : <ShieldCheck size={15} />}
            {busy ? 'Signing in...' : needs2fa ? 'Verify & Sign In' : 'Sign In'}
          </button>
        </form>
        <a href="/login" className="block text-center text-xs text-[#5a6a8a] hover:text-[#7367f0] mt-5">Back to workspace login</a>
      </div>
    </div>
  );
}
