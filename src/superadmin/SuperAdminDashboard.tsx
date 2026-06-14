import { useState, useEffect, useCallback } from 'react';
import {
  LayoutDashboard, Building2, Database, ScrollText, Settings as SettingsIcon,
  ShieldCheck, LogOut, RefreshCw, Plus, X, Check, AlertCircle, Trash2, Download,
  Play, Power, Users, TrendingUp, IndianRupee, Clock, CheckCircle2,
} from 'lucide-react';
import { sa, backupDownloadUrl } from './api';

type Tab = 'overview' | 'workspaces' | 'backups' | 'logs' | 'settings';

const rs = (n: number) => 'Rs.' + (n || 0).toLocaleString('en-IN');
const fmtDate = (s?: string) => s ? new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
const fmtSize = (b: number) => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : (b / 1024).toFixed(0) + ' KB';

const card = 'bg-[#12182b] border border-[#222c45] rounded-2xl';

export default function SuperAdminDashboard({ onLogout }: { onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>('overview');
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);
  const notify = (ok: boolean, msg: string) => { setToast({ ok, msg }); setTimeout(() => setToast(null), 3500); };

  const NAV: { id: Tab; label: string; icon: any }[] = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'workspaces', label: 'Workspaces', icon: Building2 },
    { id: 'backups', label: 'Backups', icon: Database },
    { id: 'logs', label: 'Logs', icon: ScrollText },
    { id: 'settings', label: 'Settings', icon: SettingsIcon },
  ];

  return (
    <div className="min-h-screen flex text-white" style={{ background: '#0b0f1c' }}>
      {toast && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl text-sm font-medium shadow-xl flex items-center gap-2 ${toast.ok ? 'bg-emerald-500' : 'bg-red-500'}`}>
          {toast.ok ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />} {toast.msg}
        </div>
      )}

      {/* Sidebar */}
      <aside className="w-60 flex-shrink-0 border-r border-[#1b2336] flex flex-col p-3">
        <div className="flex items-center gap-2.5 px-2 py-3 mb-2">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#7367f0] to-[#3d5af1] flex items-center justify-center">
            <ShieldCheck size={18} className="text-white" />
          </div>
          <div>
            <p className="font-black text-sm leading-none">Superadmin</p>
            <p className="text-[10px] text-[#7367f0] font-semibold uppercase tracking-wider mt-0.5">BizOpease</p>
          </div>
        </div>
        <nav className="space-y-1 flex-1">
          {NAV.map(n => (
            <button key={n.id} onClick={() => setTab(n.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${tab === n.id ? 'bg-[#7367f0]/15 text-[#9d95f5]' : 'text-[#8897b5] hover:bg-white/5'}`}>
              <n.icon size={17} /> {n.label}
            </button>
          ))}
        </nav>
        <button onClick={onLogout} className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-red-400 hover:bg-red-500/10">
          <LogOut size={17} /> Sign Out
        </button>
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-y-auto p-6 max-w-[1200px]">
        {tab === 'overview' && <Overview />}
        {tab === 'workspaces' && <Workspaces notify={notify} />}
        {tab === 'backups' && <Backups notify={notify} />}
        {tab === 'logs' && <Logs />}
        {tab === 'settings' && <SettingsTab notify={notify} />}
      </main>
    </div>
  );
}

// ── Overview ────────────────────────────────────────────────────────────────
function Overview() {
  const [s, setS] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { sa.stats().then(setS).catch(() => {}).finally(() => setLoading(false)); }, []);
  if (loading) return <Loader />;
  if (!s) return <p className="text-[#6a7a9a]">Could not load stats.</p>;

  const cards = [
    { label: 'Total Workspaces', value: s.totalWorkspaces, icon: Building2, color: 'text-[#7367f0]' },
    { label: 'Active', value: s.active, icon: CheckCircle2, color: 'text-emerald-400' },
    { label: 'Expired', value: s.expired, icon: Clock, color: 'text-amber-400' },
    { label: 'Unpaid', value: s.unpaid, icon: AlertCircle, color: 'text-red-400' },
    { label: 'MRR', value: rs(s.mrr), icon: IndianRupee, color: 'text-emerald-400' },
    { label: 'Potential MRR', value: rs(s.potentialMrr), icon: TrendingUp, color: 'text-[#7367f0]' },
    { label: 'Expiring (7d)', value: s.expiringSoon, icon: Clock, color: 'text-amber-400' },
    { label: 'Starter / Pro', value: `${s.activeStarter} / ${s.activePro}`, icon: Users, color: 'text-blue-400' },
  ];
  return (
    <>
      <h1 className="text-xl font-black mb-5">Overview</h1>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {cards.map(c => (
          <div key={c.label} className={`${card} p-4`}>
            <c.icon size={18} className={c.color} />
            <p className="text-2xl font-black mt-2">{c.value}</p>
            <p className="text-xs text-[#6a7a9a] mt-0.5">{c.label}</p>
          </div>
        ))}
      </div>
    </>
  );
}

// ── Workspaces ──────────────────────────────────────────────────────────────
function Workspaces({ notify }: { notify: (ok: boolean, m: string) => void }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    sa.workspaces().then(setRows).catch(e => notify(false, e.message)).finally(() => setLoading(false));
  }, []); // eslint-disable-line
  useEffect(() => { load(); }, [load]);

  const act = async (fn: Promise<any>, msg: string) => {
    try { await fn; notify(true, msg); load(); } catch (e: any) { notify(false, e.message); }
  };

  const statusBadge = (w: any) => {
    const expired = w.subscription_expires_at && new Date(w.subscription_expires_at) < new Date();
    const st = w.subscription_status === 'active' && !expired ? 'active' : (expired ? 'expired' : w.subscription_status);
    const cls = st === 'active' ? 'bg-emerald-500/15 text-emerald-400' : st === 'expired' ? 'bg-amber-500/15 text-amber-400' : 'bg-red-500/15 text-red-400';
    return <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${cls}`}>{st}</span>;
  };

  return (
    <>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-black">Workspaces <span className="text-[#6a7a9a] text-sm font-medium">({rows.length})</span></h1>
        <div className="flex gap-2">
          <button onClick={load} className="px-3 py-2 rounded-xl bg-[#1e2440] text-sm flex items-center gap-1.5"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh</button>
          <button onClick={() => setShowCreate(true)} className="px-3 py-2 rounded-xl bg-[#7367f0] text-sm font-bold flex items-center gap-1.5"><Plus size={15} /> New Workspace</button>
        </div>
      </div>

      {loading ? <Loader /> : (
        <div className={`${card} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-[#5a6a8a] border-b border-[#222c45]">
                  <th className="text-left px-4 py-3">Workspace</th>
                  <th className="text-left px-4 py-3">Admin</th>
                  <th className="text-left px-4 py-3">Plan</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3">Expires</th>
                  <th className="text-right px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1b2336]">
                {rows.map(w => (
                  <tr key={w.tenant_id} className="hover:bg-white/[0.02]">
                    <td className="px-4 py-3">
                      <p className="font-semibold">{w.workspace_name}</p>
                      <p className="text-[11px] font-mono text-[#5a6a8a]">{w.odoo_db_name || w.tenant_id}</p>
                    </td>
                    <td className="px-4 py-3 text-[#8897b5] text-xs">{w.admin_email}</td>
                    <td className="px-4 py-3">
                      <select defaultValue={w.plan_type || 'starter'} onChange={e => act(sa.setPlan(w.tenant_id, e.target.value), 'Plan updated')}
                        className="bg-[#1e2440] border border-[#2a3250] rounded-lg px-2 py-1 text-xs">
                        <option value="starter">Starter</option><option value="pro">Pro</option>
                      </select>
                    </td>
                    <td className="px-4 py-3">{statusBadge(w)}</td>
                    <td className="px-4 py-3 text-xs text-[#8897b5]">{fmtDate(w.subscription_expires_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button title="Extend 30 days" onClick={() => act(sa.extend(w.tenant_id, 30), 'Extended 30 days')} className="p-1.5 rounded-lg hover:bg-white/5 text-emerald-400"><Clock size={14} /></button>
                        <button title="Activate 30 days" onClick={() => act(sa.activate(w.tenant_id, 30), 'Activated')} className="p-1.5 rounded-lg hover:bg-white/5 text-blue-400"><Play size={14} /></button>
                        <button title="Deactivate" onClick={() => act(sa.deactivate(w.tenant_id), 'Deactivated')} className="p-1.5 rounded-lg hover:bg-white/5 text-amber-400"><Power size={14} /></button>
                        <button title="Delete from registry" onClick={() => { if (confirm(`Remove ${w.workspace_name} from the registry? (Odoo DB is NOT dropped)`)) act(sa.deleteWorkspace(w.tenant_id), 'Removed'); }} className="p-1.5 rounded-lg hover:bg-red-500/10 text-red-400"><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={6} className="text-center py-10 text-[#6a7a9a]">No workspaces yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showCreate && <CreateWorkspace onClose={() => setShowCreate(false)} onDone={() => { setShowCreate(false); load(); }} notify={notify} />}
    </>
  );
}

function CreateWorkspace({ onClose, onDone, notify }: { onClose: () => void; onDone: () => void; notify: (ok: boolean, m: string) => void }) {
  const [f, setF] = useState({ workspaceName: '', adminEmail: '', adminPassword: '', days: 30, planType: 'starter' });
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    try { await sa.createWorkspace(f); notify(true, 'Workspace provisioned'); onDone(); }
    catch (err: any) { notify(false, err.message); setBusy(false); }
  };
  const inp = 'w-full rounded-xl px-3 py-2.5 text-sm bg-[#1e2440] border border-[#2a3250] text-white outline-none focus:border-[#7367f0]';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => !busy && onClose()}>
      <div className="w-full max-w-md rounded-3xl p-6 bg-[#12182b] border border-[#2a3250]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-black text-base">New Workspace</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5 text-[#6a7a9a]"><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <input className={inp} placeholder="Business name" value={f.workspaceName} onChange={e => setF({ ...f, workspaceName: e.target.value })} required autoFocus />
          <input className={inp} type="email" placeholder="Admin email" value={f.adminEmail} onChange={e => setF({ ...f, adminEmail: e.target.value })} required />
          <input className={inp} type="text" placeholder="Admin password" value={f.adminPassword} onChange={e => setF({ ...f, adminPassword: e.target.value })} required />
          <div className="grid grid-cols-2 gap-3">
            <input className={inp} type="number" placeholder="Trial days" value={f.days} onChange={e => setF({ ...f, days: Number(e.target.value) })} />
            <select className={inp} value={f.planType} onChange={e => setF({ ...f, planType: e.target.value })}>
              <option value="starter">Starter</option><option value="pro">Pro</option>
            </select>
          </div>
          <p className="text-[11px] text-[#6a7a9a]">Provisioning creates a private Odoo database and installs modules -- this can take up to a minute.</p>
          <button type="submit" disabled={busy} className="w-full py-2.5 rounded-xl bg-[#7367f0] hover:bg-[#5e54d4] font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60">
            {busy ? <><RefreshCw size={15} className="animate-spin" /> Provisioning...</> : <><Plus size={15} /> Create Workspace</>}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Backups ─────────────────────────────────────────────────────────────────
function Backups({ notify }: { notify: (ok: boolean, m: string) => void }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const load = () => { setLoading(true); sa.backups().then(setRows).catch(e => notify(false, e.message)).finally(() => setLoading(false)); };
  useEffect(() => { load(); }, []); // eslint-disable-line
  const run = async () => { setRunning(true); try { await sa.runBackup(); notify(true, 'Backup triggered -- refresh in ~30s'); } catch (e: any) { notify(false, e.message); } finally { setRunning(false); } };

  return (
    <>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-black">Backups</h1>
        <div className="flex gap-2">
          <button onClick={load} className="px-3 py-2 rounded-xl bg-[#1e2440] text-sm flex items-center gap-1.5"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh</button>
          <button onClick={run} disabled={running} className="px-3 py-2 rounded-xl bg-[#7367f0] text-sm font-bold flex items-center gap-1.5 disabled:opacity-60"><Play size={14} /> Run Backup Now</button>
        </div>
      </div>
      {loading ? <Loader /> : rows.length === 0 ? <p className="text-[#6a7a9a]">No backups yet. Run one or wait for the daily 2 AM job.</p> : (
        <div className="space-y-3">
          {rows.map(b => (
            <div key={b.date} className={`${card} p-4`}>
              <p className="font-bold text-sm mb-2">{b.date}</p>
              <div className="flex flex-wrap gap-2">
                {b.files.map((f: any) => (
                  <a key={f.name} href={backupDownloadUrl(b.date, f.name)} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#1e2440] text-xs hover:bg-[#252b4a]">
                    <Download size={12} className="text-[#7367f0]" /> {f.name} <span className="text-[#5a6a8a]">{fmtSize(f.size)}</span>
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ── Logs ────────────────────────────────────────────────────────────────────
function Logs() {
  const [data, setData] = useState<{ stdout: string; stderr: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const load = () => { setLoading(true); sa.logs().then(setData).catch(() => {}).finally(() => setLoading(false)); };
  useEffect(() => { load(); }, []);
  return (
    <>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-black">Server Logs</h1>
        <button onClick={load} className="px-3 py-2 rounded-xl bg-[#1e2440] text-sm flex items-center gap-1.5"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh</button>
      </div>
      {loading ? <Loader /> : (
        <>
          <p className="text-xs text-[#6a7a9a] mb-1.5">stdout</p>
          <pre className={`${card} p-4 text-[11px] leading-relaxed text-[#9fb0d0] overflow-x-auto whitespace-pre-wrap max-h-[45vh] overflow-y-auto`}>{data?.stdout || '(empty)'}</pre>
          {data?.stderr && <><p className="text-xs text-red-400/80 mb-1.5 mt-4">stderr</p>
            <pre className={`${card} p-4 text-[11px] text-red-300/80 overflow-x-auto whitespace-pre-wrap max-h-[30vh] overflow-y-auto`}>{data.stderr}</pre></>}
        </>
      )}
    </>
  );
}

// ── Settings ────────────────────────────────────────────────────────────────
const CONFIG_GROUPS: { title: string; keys: string[] }[] = [
  { title: 'Odoo', keys: ['ODOO_URL', 'ODOO_MASTER_PASSWORD'] },
  { title: 'Razorpay (payments)', keys: ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_PLAN_ID_STARTER', 'RAZORPAY_PLAN_ID_PRO', 'RAZORPAY_WEBHOOK_SECRET', 'PLAN_PRICE_STARTER', 'PLAN_PRICE_PRO'] },
  { title: 'Backups (Cloudflare R2)', keys: ['R2_ACCOUNT_ID', 'R2_BUCKET_NAME', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_ENDPOINT'] },
  { title: 'Email (SMTP)', keys: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'] },
  { title: 'Superadmin & Security', keys: ['SUPERADMIN_USERNAME', 'SUPERADMIN_PASSWORD', 'JWT_SECRET'] },
];
const isSensitive = (k: string) => k.includes('SECRET') || k.includes('PASS') || k.includes('KEY') || k === 'JWT_SECRET';

function SettingsTab({ notify }: { notify: (ok: boolean, m: string) => void }) {
  const [cfg, setCfg] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  useEffect(() => { sa.getConfig().then(setCfg).catch(() => {}).finally(() => setLoading(false)); }, []);

  const save = async () => {
    setSaving(true);
    // Skip masked sensitive values that were not changed.
    const payload: Record<string, string> = {};
    Object.entries(cfg).forEach(([k, v]) => { if (v && v !== '••••••••') payload[k] = v; });
    try { await sa.saveConfig(payload); notify(true, 'Settings saved & reloaded'); } catch (e: any) { notify(false, e.message); } finally { setSaving(false); }
  };

  const inp = 'w-full rounded-lg px-3 py-2 text-sm bg-[#1e2440] border border-[#2a3250] text-white outline-none focus:border-[#7367f0]';
  if (loading) return <Loader />;
  return (
    <>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-black">Settings</h1>
        <button onClick={save} disabled={saving} className="px-4 py-2 rounded-xl bg-[#7367f0] text-sm font-bold flex items-center gap-1.5 disabled:opacity-60">
          {saving ? <RefreshCw size={14} className="animate-spin" /> : <Check size={15} />} Save Settings
        </button>
      </div>

      <div className="space-y-5">
        {CONFIG_GROUPS.map(g => (
          <div key={g.title} className={`${card} p-5`}>
            <h3 className="font-bold text-sm mb-3 text-[#9d95f5]">{g.title}</h3>
            <div className="grid md:grid-cols-2 gap-3">
              {g.keys.map(k => (
                <div key={k}>
                  <label className="text-[11px] text-[#6a7a9a] font-semibold">{k}</label>
                  <input className={inp} type={isSensitive(k) ? 'password' : 'text'}
                    value={cfg[k] || ''} placeholder={isSensitive(k) ? '(set -- leave blank to keep)' : ''}
                    onChange={e => setCfg({ ...cfg, [k]: e.target.value })} />
                </div>
              ))}
            </div>
          </div>
        ))}

        <TwoFactor notify={notify} />
        <DangerZone notify={notify} />
      </div>
    </>
  );
}

function TwoFactor({ notify }: { notify: (ok: boolean, m: string) => void }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [setup, setSetup] = useState<{ secret: string; qrUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const refresh = () => sa.twoFaStatus().then(r => setEnabled(r.enabled)).catch(() => {});
  useEffect(() => { refresh(); }, []);

  const begin = async () => { try { setSetup(await sa.twoFaSetup()); } catch (e: any) { notify(false, e.message); } };
  const verify = async () => { try { await sa.twoFaVerify(code, setup!.secret); notify(true, '2FA enabled'); setSetup(null); setCode(''); refresh(); } catch (e: any) { notify(false, e.message); } };
  const disable = async () => { const c = prompt('Enter current 2FA code to disable'); if (!c) return; try { await sa.twoFaDisable(c); notify(true, '2FA disabled'); refresh(); } catch (e: any) { notify(false, e.message); } };

  return (
    <div className={`${card} p-5`}>
      <h3 className="font-bold text-sm mb-1 text-[#9d95f5]">Two-Factor Authentication</h3>
      <p className="text-xs text-[#6a7a9a] mb-3">Status: {enabled === null ? '...' : enabled ? <span className="text-emerald-400 font-bold">Enabled</span> : <span className="text-amber-400 font-bold">Disabled</span>}</p>
      {enabled ? (
        <button onClick={disable} className="px-3 py-2 rounded-xl bg-red-500/15 text-red-400 text-sm font-bold">Disable 2FA</button>
      ) : setup ? (
        <div className="flex flex-col sm:flex-row gap-4 items-start">
          <img src={setup.qrUrl} alt="2FA QR" className="w-40 h-40 rounded-xl bg-white p-2" />
          <div className="flex-1">
            <p className="text-xs text-[#8897b5] mb-1">Scan with an authenticator app, or enter the secret:</p>
            <p className="font-mono text-xs bg-[#1e2440] rounded-lg px-2 py-1 inline-block mb-3">{setup.secret}</p>
            <div className="flex gap-2">
              <input value={code} onChange={e => setCode(e.target.value)} placeholder="6-digit code" maxLength={6}
                className="rounded-lg px-3 py-2 text-sm bg-[#1e2440] border border-[#2a3250] text-white outline-none tracking-widest w-32" />
              <button onClick={verify} className="px-3 py-2 rounded-xl bg-[#7367f0] text-sm font-bold">Verify & Enable</button>
            </div>
          </div>
        </div>
      ) : (
        <button onClick={begin} className="px-3 py-2 rounded-xl bg-[#7367f0]/15 text-[#9d95f5] text-sm font-bold">Set up 2FA</button>
      )}
    </div>
  );
}

function DangerZone({ notify }: { notify: (ok: boolean, m: string) => void }) {
  const restart = async () => { if (!confirm('Restart the control-plane server now?')) return; try { await sa.restart(); notify(true, 'Restart triggered -- reconnect shortly'); } catch (e: any) { notify(false, e.message); } };
  return (
    <div className="rounded-2xl p-5 border border-red-500/25 bg-red-500/5">
      <h3 className="font-bold text-sm mb-1 text-red-400">Danger Zone</h3>
      <p className="text-xs text-[#8897b5] mb-3">Restart the Node control-plane process (brief downtime).</p>
      <button onClick={restart} className="px-3 py-2 rounded-xl bg-red-500/15 text-red-400 text-sm font-bold flex items-center gap-1.5"><Power size={14} /> Restart Server</button>
    </div>
  );
}

function Loader() {
  return <div className="py-16 flex justify-center"><RefreshCw size={22} className="animate-spin text-[#7367f0]" /></div>;
}
