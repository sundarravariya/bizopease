import { useState, useEffect, useCallback } from 'react';
import {
  LayoutDashboard, Building2, Database, ScrollText, Settings as SettingsIcon,
  ShieldCheck, LogOut, RefreshCw, Plus, X, Check, AlertCircle, Trash2, Download,
  Play, Power, TrendingUp, IndianRupee, Clock, CheckCircle2, Activity,
  Server, HardDrive, Cpu, KeyRound, Mail, Zap, Search, AlertTriangle, History,
  ArrowUpRight, Wifi,
} from 'lucide-react';
import { sa, getToken } from './api';

type Tab = 'overview' | 'workspaces' | 'backups' | 'audit' | 'settings';

const rs = (n: number) => '₹' + (n || 0).toLocaleString('en-IN');
const fmtDate = (s?: string) => s ? new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
const fmtDateTime = (s?: string) => s ? new Date(s).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-';
const fmtSize = (b: number) => b > 1073741824 ? (b / 1073741824).toFixed(2) + ' GB' : b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : (b / 1024).toFixed(0) + ' KB';
const fmtUptime = (sec: number) => {
  if (!sec) return '-';
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
};

const card = 'bg-[#0f1525] border border-[#1e2740] rounded-2xl';

export default function SuperAdminDashboard({ onLogout }: { onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>('overview');
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);
  const notify = (ok: boolean, msg: string) => { setToast({ ok, msg }); setTimeout(() => setToast(null), 4000); };

  const NAV: { id: Tab; label: string; icon: any }[] = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'workspaces', label: 'Workspaces', icon: Building2 },
    { id: 'backups', label: 'Backups', icon: Database },
    { id: 'audit', label: 'Audit Log', icon: History },
    { id: 'settings', label: 'Settings', icon: SettingsIcon },
  ];

  return (
    <div className="min-h-screen flex text-white" style={{ background: '#070b15' }}>
      {toast && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-[60] px-4 py-2.5 rounded-xl text-sm font-semibold shadow-2xl flex items-center gap-2 ${toast.ok ? 'bg-emerald-500' : 'bg-rose-500'}`}>
          {toast.ok ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />} {toast.msg}
        </div>
      )}

      {/* Sidebar */}
      <aside className="w-60 flex-shrink-0 border-r border-[#161d33] flex flex-col p-3 bg-[#0a0e1c]">
        <div className="flex items-center gap-2.5 px-2 py-3 mb-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#7367f0] to-[#3d5af1] flex items-center justify-center shadow-lg shadow-[#7367f0]/30">
            <ShieldCheck size={18} className="text-white" />
          </div>
          <div>
            <p className="font-black text-sm leading-none">Control Plane</p>
            <p className="text-[10px] text-[#7367f0] font-bold uppercase tracking-[0.15em] mt-1">BizOpease</p>
          </div>
        </div>
        <nav className="space-y-1 flex-1">
          {NAV.map(n => (
            <button key={n.id} onClick={() => setTab(n.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${tab === n.id ? 'bg-gradient-to-r from-[#7367f0]/20 to-transparent text-[#a79ff7] border border-[#7367f0]/30' : 'text-[#7d8cae] hover:bg-white/5 border border-transparent'}`}>
              <n.icon size={17} /> {n.label}
            </button>
          ))}
        </nav>
        <button onClick={onLogout} className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-rose-400 hover:bg-rose-500/10">
          <LogOut size={17} /> Sign Out
        </button>
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-y-auto p-6 max-w-[1280px]">
        {tab === 'overview' && <Overview go={setTab} />}
        {tab === 'workspaces' && <Workspaces notify={notify} />}
        {tab === 'backups' && <Backups notify={notify} />}
        {tab === 'audit' && <AuditLog />}
        {tab === 'settings' && <SettingsTab notify={notify} />}
      </main>
    </div>
  );
}

// ── Shared pieces ─────────────────────────────────────────────────────────────
function Loader() {
  return <div className="py-16 flex justify-center"><RefreshCw size={22} className="animate-spin text-[#7367f0]" /></div>;
}

function PageHead({ title, sub, children }: { title: string; sub?: string; children?: any }) {
  return (
    <div className="flex items-end justify-between mb-5 flex-wrap gap-3">
      <div>
        <h1 className="text-2xl font-black tracking-tight">{title}</h1>
        {sub && <p className="text-sm text-[#6a7a9a] mt-0.5">{sub}</p>}
      </div>
      <div className="flex gap-2">{children}</div>
    </div>
  );
}

function StatusPill({ ok, warn, label, value }: { ok?: boolean; warn?: boolean; label: string; value: string }) {
  const tone = warn ? 'text-amber-400 bg-amber-500/10 border-amber-500/25'
    : ok ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25'
    : 'text-rose-400 bg-rose-500/10 border-rose-500/25';
  return (
    <div className={`flex items-center justify-between px-3 py-2.5 rounded-xl border ${tone}`}>
      <span className="text-[11px] uppercase tracking-wider opacity-80 font-bold">{label}</span>
      <span className="text-sm font-black">{value}</span>
    </div>
  );
}

// ── Overview ────────────────────────────────────────────────────────────────
function Overview({ go }: { go: (t: Tab) => void }) {
  const [s, setS] = useState<any>(null);
  const [health, setHealth] = useState<any>(null);
  const [ws, setWs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      sa.stats().catch(() => null),
      sa.health().catch(() => null),
      sa.workspaces().catch(() => []),
    ]).then(([st, h, w]) => { setS(st); setHealth(h); setWs(w || []); })
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <Loader />;

  const now = new Date();
  const in7 = new Date(now.getTime() + 7 * 86400000);
  const expiring = ws.filter(w => w.subscription_status === 'active' && w.subscription_expires_at &&
    new Date(w.subscription_expires_at) > now && new Date(w.subscription_expires_at) <= in7)
    .sort((a, b) => +new Date(a.subscription_expires_at) - +new Date(b.subscription_expires_at));
  const recent = [...ws].sort((a, b) => +new Date(b.created_at || 0) - +new Date(a.created_at || 0)).slice(0, 5);
  const activeRate = s && s.totalWorkspaces ? Math.round((s.active / s.totalWorkspaces) * 100) : 0;

  const stat = [
    { label: 'Workspaces', value: s?.totalWorkspaces ?? '-', icon: Building2, color: 'text-[#9d95f5]' },
    { label: 'Active', value: s?.active ?? '-', icon: CheckCircle2, color: 'text-emerald-400' },
    { label: 'Expired', value: s?.expired ?? '-', icon: Clock, color: 'text-amber-400' },
    { label: 'Unpaid', value: s?.unpaid ?? '-', icon: AlertCircle, color: 'text-rose-400' },
  ];

  return (
    <>
      <PageHead title="Overview" sub="System health, subscriptions & revenue at a glance">
        <button onClick={load} className="px-3 py-2 rounded-xl bg-[#161d33] text-sm flex items-center gap-1.5 hover:bg-[#1d2540]"><RefreshCw size={14} /> Refresh</button>
      </PageHead>

      {/* System health */}
      <div className={`${card} p-5 mb-5`}>
        <div className="flex items-center gap-2 mb-4">
          <Activity size={16} className="text-[#7367f0]" />
          <h3 className="font-bold text-sm">System Health</h3>
          <span className="text-[11px] text-[#5a6a8a] ml-auto">Control-plane up {fmtUptime(health?.controlPlaneUptimeSec || 0)}</span>
        </div>
        {!health ? <p className="text-sm text-rose-400">Health probe unavailable.</p> : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
              <StatusPill ok={health.postgres?.up} label="Postgres" value={health.postgres?.up ? 'Online' : 'Down'} />
              <StatusPill ok={health.odoo?.state === 'active'} label="Odoo" value={health.odoo?.state || 'unknown'} />
              <StatusPill ok={health.pm2?.online} label="PM2" value={health.pm2?.online ? 'Online' : 'Down'} />
              <StatusPill ok={(health.disk?.usePct ?? 100) < 85} warn={(health.disk?.usePct ?? 0) >= 85 && (health.disk?.usePct ?? 0) < 92}
                label="Disk" value={health.disk ? `${health.disk.usePct}% used` : '-'} />
              <StatusPill ok={(health.lastBackup?.ageHours ?? 999) < 48} warn={(health.lastBackup?.ageHours ?? 0) >= 48 && (health.lastBackup?.ageHours ?? 0) < 96}
                label="Last Backup" value={health.lastBackup ? `${health.lastBackup.ageHours}h ago` : 'none'} />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 text-xs">
              <Mini icon={HardDrive} label="Disk free" value={health.disk ? fmtSize(health.disk.free) : '-'} />
              <Mini icon={Cpu} label="CP memory" value={health.pm2?.memory ? fmtSize(health.pm2.memory) : '-'} />
              <Mini icon={Server} label="PM2 restarts" value={String(health.pm2?.restarts ?? '-')} />
              <Mini icon={Database} label="Backup sets" value={String(health.lastBackup?.count ?? 0)} />
            </div>
            {/* DB sizes */}
            {health.databases?.length > 0 && (
              <div className="rounded-xl bg-[#0a0e1c] border border-[#1a2238] p-3">
                <p className="text-[11px] uppercase tracking-wider text-[#5a6a8a] font-bold mb-2">Database sizes</p>
                <div className="space-y-1.5">
                  {health.databases.slice(0, 8).map((d: any) => {
                    const max = health.databases[0].size || 1;
                    return (
                      <div key={d.name} className="flex items-center gap-3">
                        <span className="font-mono text-xs w-36 truncate text-[#9fb0d0]">{d.name}</span>
                        <div className="flex-1 h-1.5 rounded-full bg-[#1a2238] overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-[#7367f0] to-[#3d5af1]" style={{ width: `${Math.max(3, (d.size / max) * 100)}%` }} />
                        </div>
                        <span className="text-xs text-[#8897b5] w-20 text-right">{fmtSize(d.size)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* KPI + revenue */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        {stat.map(c => (
          <div key={c.label} className={`${card} p-4`}>
            <c.icon size={18} className={c.color} />
            <p className="text-3xl font-black mt-2">{c.value}</p>
            <p className="text-xs text-[#6a7a9a] mt-0.5">{c.label}</p>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-4 mb-5">
        {/* Revenue */}
        <div className={`${card} p-5`}>
          <div className="flex items-center gap-2 mb-3"><IndianRupee size={15} className="text-emerald-400" /><h3 className="font-bold text-sm">Revenue</h3></div>
          <p className="text-3xl font-black text-emerald-400">{rs(s?.mrr || 0)}</p>
          <p className="text-xs text-[#6a7a9a] mb-3">Monthly recurring revenue</p>
          <Row k="Potential MRR" v={rs(s?.potentialMrr || 0)} />
          <Row k="Annual run rate" v={rs((s?.mrr || 0) * 12)} />
          <Row k="Per active workspace" v={rs(s?.active ? Math.round((s.mrr || 0) / s.active) : 0)} />
          <Row k="Starter / Pro" v={`${s?.activeStarter ?? 0} / ${s?.activePro ?? 0}`} last />
        </div>

        {/* Subscription health */}
        <div className={`${card} p-5`}>
          <div className="flex items-center gap-2 mb-3"><TrendingUp size={15} className="text-[#9d95f5]" /><h3 className="font-bold text-sm">Subscription Health</h3></div>
          <div className="flex items-end gap-2 mb-1"><p className="text-3xl font-black">{activeRate}%</p><p className="text-xs text-[#6a7a9a] mb-1.5">active rate</p></div>
          <div className="h-2.5 rounded-full bg-[#1a2238] overflow-hidden mb-4 flex">
            <div className="h-full bg-emerald-500" style={{ width: `${activeRate}%` }} />
            <div className="h-full bg-amber-500" style={{ width: `${s?.totalWorkspaces ? (s.expired / s.totalWorkspaces) * 100 : 0}%` }} />
          </div>
          <Row k="Expiring in 7 days" v={String(s?.expiringSoon ?? 0)} />
          <Row k="Expired" v={String(s?.expired ?? 0)} />
          <Row k="Unpaid / never active" v={String(s?.unpaid ?? 0)} last />
        </div>

        {/* Expiring soon */}
        <div className={`${card} p-5`}>
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={15} className="text-amber-400" /><h3 className="font-bold text-sm">Expiring Soon</h3>
            <button onClick={() => go('workspaces')} className="ml-auto text-[11px] text-[#7367f0] flex items-center gap-0.5">View <ArrowUpRight size={11} /></button>
          </div>
          {expiring.length === 0 ? <p className="text-xs text-[#6a7a9a] py-6 text-center">No workspaces expiring this week.</p> : (
            <div className="space-y-2">
              {expiring.slice(0, 5).map(w => (
                <div key={w.tenant_id} className="flex items-center justify-between text-sm">
                  <span className="truncate font-medium">{w.workspace_name}</span>
                  <span className="text-amber-400 text-xs font-bold whitespace-nowrap ml-2">{fmtDate(w.subscription_expires_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recently registered */}
      <div className={`${card} p-5`}>
        <div className="flex items-center gap-2 mb-3"><Clock size={15} className="text-[#7367f0]" /><h3 className="font-bold text-sm">Recently Registered</h3></div>
        {recent.length === 0 ? <p className="text-xs text-[#6a7a9a] py-4">No workspaces yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-[#161d33]">
                {recent.map(w => (
                  <tr key={w.tenant_id}>
                    <td className="py-2.5 font-medium">{w.workspace_name}</td>
                    <td className="py-2.5 text-[#8897b5] text-xs">{w.admin_email}</td>
                    <td className="py-2.5 text-xs"><span className="font-mono text-[#5a6a8a]">{w.odoo_db_name}</span></td>
                    <td className="py-2.5 text-right text-xs text-[#8897b5]">{fmtDate(w.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function Mini({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[#0a0e1c] border border-[#1a2238] p-3">
      <Icon size={14} className="text-[#6a7a9a] mb-1.5" />
      <p className="text-sm font-black">{value}</p>
      <p className="text-[10px] text-[#5a6a8a] uppercase tracking-wider">{label}</p>
    </div>
  );
}

function Row({ k, v, last }: { k: string; v: any; last?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 py-2 text-sm ${last ? '' : 'border-b border-[#161d33]'}`}>
      <span className="text-[#6a7a9a]">{k}</span><span className="text-right font-semibold break-all">{v ?? '-'}</span>
    </div>
  );
}

// ── Workspaces ──────────────────────────────────────────────────────────────
function Workspaces({ notify }: { notify: (ok: boolean, m: string) => void }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'active' | 'expired' | 'unpaid'>('all');
  const [detail, setDetail] = useState<any | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    sa.workspaces().then(setRows).catch(e => notify(false, e.message)).finally(() => setLoading(false));
  }, []); // eslint-disable-line
  useEffect(() => { load(); }, [load]);

  const effStatus = (w: any) => {
    const expired = w.subscription_expires_at && new Date(w.subscription_expires_at) < new Date();
    return w.subscription_status === 'active' && !expired ? 'active' : (expired ? 'expired' : 'unpaid');
  };
  const filtered = rows.filter(w => {
    if (filter !== 'all' && effStatus(w) !== filter) return false;
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    return (w.workspace_name || '').toLowerCase().includes(s) ||
      (w.admin_email || '').toLowerCase().includes(s) ||
      (w.tenant_id || '').toLowerCase().includes(s);
  });

  const act = async (fn: Promise<any>, msg: string) => {
    try { await fn; notify(true, msg); load(); } catch (e: any) { notify(false, e.message); }
  };

  const statusBadge = (w: any) => {
    const expired = w.subscription_expires_at && new Date(w.subscription_expires_at) < new Date();
    const st = w.subscription_status === 'active' && !expired ? 'active' : (expired ? 'expired' : w.subscription_status);
    const cls = st === 'active' ? 'bg-emerald-500/15 text-emerald-400' : st === 'expired' ? 'bg-amber-500/15 text-amber-400' : 'bg-rose-500/15 text-rose-400';
    return <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${cls}`}>{st}</span>;
  };

  return (
    <>
      <PageHead title="Workspaces" sub={`${filtered.length} of ${rows.length} tenants`}>
        <button onClick={load} className="px-3 py-2 rounded-xl bg-[#161d33] text-sm flex items-center gap-1.5 hover:bg-[#1d2540]"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh</button>
        <button onClick={() => setShowCreate(true)} className="px-3 py-2 rounded-xl bg-[#7367f0] hover:bg-[#5e54d4] text-sm font-bold flex items-center gap-1.5"><Plus size={15} /> New Workspace</button>
      </PageHead>

      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <div className="flex-1 relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#5a6a8a]" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, email or slug..."
            className="w-full rounded-xl pl-9 pr-3 py-2 text-sm bg-[#0f1525] border border-[#1e2740] text-white outline-none focus:border-[#7367f0]" />
        </div>
        <div className="flex p-1 rounded-xl bg-[#0f1525] border border-[#1e2740]">
          {(['all', 'active', 'expired', 'unpaid'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold capitalize ${filter === f ? 'bg-[#7367f0] text-white' : 'text-[#8897b5]'}`}>{f}</button>
          ))}
        </div>
      </div>

      {loading ? <Loader /> : (
        <div className={`${card} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-[#5a6a8a] border-b border-[#1e2740]">
                  <th className="text-left px-4 py-3">Workspace</th>
                  <th className="text-left px-4 py-3">Admin</th>
                  <th className="text-left px-4 py-3">Plan</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3">Expires</th>
                  <th className="text-right px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#161d33]">
                {filtered.map(w => (
                  <tr key={w.tenant_id} className="hover:bg-white/[0.02]">
                    <td className="px-4 py-3">
                      <button onClick={() => setDetail(w)} className="text-left group">
                        <p className="font-semibold group-hover:text-[#9d95f5]">{w.workspace_name}</p>
                        <p className="text-[11px] font-mono text-[#5a6a8a]">{w.odoo_db_name || w.tenant_id}</p>
                      </button>
                    </td>
                    <td className="px-4 py-3 text-[#8897b5] text-xs">{w.admin_email}</td>
                    <td className="px-4 py-3">
                      <select defaultValue={w.plan_type || 'starter'} onChange={e => act(sa.setPlan(w.tenant_id, e.target.value), 'Plan updated')}
                        className="bg-[#161d33] border border-[#2a3250] rounded-lg px-2 py-1 text-xs">
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
                        <button title="Manage" onClick={() => setDetail(w)} className="p-1.5 rounded-lg hover:bg-white/5 text-[#9d95f5]"><SettingsIcon size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && <tr><td colSpan={6} className="text-center py-10 text-[#6a7a9a]">No workspaces match.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showCreate && <CreateWorkspace onClose={() => setShowCreate(false)} onDone={() => { setShowCreate(false); load(); }} notify={notify} />}
      {detail && <TenantDetail w={detail} onClose={() => setDetail(null)} onChanged={load} notify={notify} />}
    </>
  );
}

// ── Tenant detail drawer ──────────────────────────────────────────────────────
function TenantDetail({ w, onClose, onChanged, notify }: { w: any; onClose: () => void; onChanged: () => void; notify: (ok: boolean, m: string) => void }) {
  const [users, setUsers] = useState<{ odooDb: string; adminEmail: string; note: string } | null>(null);
  const [extDays, setExtDays] = useState(30);
  const [newPw, setNewPw] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { sa.workspaceUsers(w.tenant_id).then(setUsers).catch(() => {}); }, [w.tenant_id]);

  const act = async (fn: Promise<any>, msg: string, close = false) => {
    try { await fn; notify(true, msg); onChanged(); if (close) onClose(); } catch (e: any) { notify(false, e.message); }
  };
  const isProvisioned = /^ws_/.test(w.odoo_db_name || '');

  const resetPw = async () => {
    if (newPw.length < 6) return notify(false, 'Password must be at least 6 characters');
    setBusy('pw');
    try { await sa.resetPassword(w.tenant_id, newPw); notify(true, 'Admin password reset'); setNewPw(''); }
    catch (e: any) { notify(false, e.message); } finally { setBusy(null); }
  };
  const backup = async () => {
    setBusy('backup');
    try { await sa.backupWorkspace(w.tenant_id); notify(true, 'On-demand backup started'); }
    catch (e: any) { notify(false, e.message); } finally { setBusy(null); }
  };

  const odooUrl = `https://odoo.robifel.in/web?db=${encodeURIComponent(w.odoo_db_name || '')}`;
  const wsUrl = `https://bizopease.robifel.in/${w.tenant_id}`;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md h-full bg-[#0a0e1c] border-l border-[#1e2740] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-black text-lg">{w.workspace_name}</h3>
            <p className="text-xs font-mono text-[#5a6a8a]">{w.odoo_db_name || w.tenant_id}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5 text-[#6a7a9a]"><X size={18} /></button>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-5">
          <a href={wsUrl} target="_blank" rel="noreferrer" className="px-3 py-2 rounded-xl bg-[#7367f0]/15 text-[#9d95f5] text-xs font-bold text-center">Open Workspace</a>
          <a href={odooUrl} target="_blank" rel="noreferrer" className="px-3 py-2 rounded-xl bg-[#161d33] text-xs font-bold text-center">Odoo Backend</a>
        </div>

        <div className={`${card} p-4 mb-4`}>
          <Row k="Admin email" v={w.admin_email} />
          <Row k="Plan" v={w.plan_type || 'starter'} />
          <Row k="Status" v={w.subscription_status} />
          <Row k="Expires" v={fmtDate(w.subscription_expires_at)} />
          <Row k="Created" v={fmtDate(w.created_at)} />
          <Row k="Razorpay sub" v={w.razorpay_subscription_id} />
          <Row k="Odoo DB" v={users?.odooDb || w.odoo_db_name} last />
        </div>

        <div className={`${card} p-4 space-y-3 mb-4`}>
          <p className="text-xs font-bold text-[#9d95f5]">Subscription</p>
          <div className="flex gap-2">
            <input type="number" value={extDays} onChange={e => setExtDays(Number(e.target.value))}
              className="w-20 rounded-lg px-2 py-2 text-sm bg-[#161d33] border border-[#2a3250] text-white outline-none" />
            <button onClick={() => act(sa.extend(w.tenant_id, extDays), `Extended ${extDays} days`)} className="flex-1 px-3 py-2 rounded-xl bg-emerald-500/15 text-emerald-400 text-sm font-bold">Extend</button>
            <button onClick={() => act(sa.activate(w.tenant_id, extDays), 'Activated')} className="flex-1 px-3 py-2 rounded-xl bg-blue-500/15 text-blue-400 text-sm font-bold">Activate</button>
          </div>
          <button onClick={() => act(sa.deactivate(w.tenant_id), 'Deactivated')} className="w-full px-3 py-2 rounded-xl bg-amber-500/15 text-amber-400 text-sm font-bold">Deactivate</button>
        </div>

        {/* Maintenance: password reset + on-demand backup */}
        <div className={`${card} p-4 space-y-3 mb-4`}>
          <p className="text-xs font-bold text-[#9d95f5] flex items-center gap-1.5"><KeyRound size={13} /> Maintenance</p>
          {isProvisioned ? (
            <div className="flex gap-2">
              <input type="text" value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="New admin password"
                className="flex-1 rounded-lg px-2 py-2 text-sm bg-[#161d33] border border-[#2a3250] text-white outline-none" />
              <button onClick={resetPw} disabled={busy === 'pw'} className="px-3 py-2 rounded-xl bg-[#7367f0]/15 text-[#9d95f5] text-sm font-bold disabled:opacity-60">
                {busy === 'pw' ? <RefreshCw size={14} className="animate-spin" /> : 'Reset'}
              </button>
            </div>
          ) : <p className="text-[11px] text-[#6a7a9a]">Password reset is available for provisioned (ws_*) workspaces only.</p>}
          <button onClick={backup} disabled={busy === 'backup'} className="w-full px-3 py-2 rounded-xl bg-[#161d33] hover:bg-[#1d2540] text-sm font-bold flex items-center justify-center gap-1.5 disabled:opacity-60">
            {busy === 'backup' ? <RefreshCw size={14} className="animate-spin" /> : <Database size={14} className="text-[#7367f0]" />} Backup this DB now
          </button>
        </div>

        <div className="rounded-2xl p-4 border border-rose-500/25 bg-rose-500/5">
          <p className="text-xs font-bold text-rose-400 mb-2">Danger Zone</p>
          <button onClick={() => { if (confirm(`Remove ${w.workspace_name} from the registry and DROP its Odoo database + filestore? This cannot be undone.`)) act(sa.deleteWorkspace(w.tenant_id), 'Workspace removed', true); }}
            className="w-full px-3 py-2 rounded-xl bg-rose-500/15 text-rose-400 text-sm font-bold flex items-center justify-center gap-1.5"><Trash2 size={14} /> Delete Workspace</button>
        </div>
      </div>
    </div>
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
  const inp = 'w-full rounded-xl px-3 py-2.5 text-sm bg-[#161d33] border border-[#2a3250] text-white outline-none focus:border-[#7367f0]';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => !busy && onClose()}>
      <div className="w-full max-w-md rounded-3xl p-6 bg-[#0f1525] border border-[#2a3250]" onClick={e => e.stopPropagation()}>
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
  const [restoring, setRestoring] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = () => { setLoading(true); sa.backups().then(setRows).catch(e => notify(false, e.message)).finally(() => setLoading(false)); };
  useEffect(() => { load(); }, []); // eslint-disable-line

  const run = async () => { setRunning(true); try { await sa.runBackup(); notify(true, 'Backup triggered — refresh in ~30s'); } catch (e: any) { notify(false, e.message); } finally { setRunning(false); } };

  const download = async (date: string, file: string) => {
    const key = `${date}/${file}`;
    setDownloading(key);
    try {
      const res = await fetch(`/api/superadmin/backups/download?date=${encodeURIComponent(date)}&file=${encodeURIComponent(file)}`, {
        headers: { Authorization: 'Bearer ' + getToken() },
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'Download failed'); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `${date}_${file}`; a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) { notify(false, e.message); }
    finally { setDownloading(null); }
  };

  const restore = async (date: string, db: string) => {
    if (!confirm(`Restore "${db}" database from backup ${date}?\n\nThis will OVERWRITE the current database and filestore. Odoo will restart. This cannot be undone.`)) return;
    const key = `${date}/${db}`;
    setRestoring(key);
    try { await sa.restoreBackup(date, db); notify(true, `Restore of ${db} started — Odoo will restart in ~60 seconds.`); }
    catch (e: any) { notify(false, e.message); }
    finally { setRestoring(null); }
  };

  const del = async (date: string) => {
    if (!confirm(`Permanently delete the entire backup set for ${date}? This cannot be undone.`)) return;
    setDeleting(date);
    try { await sa.deleteBackup(date); notify(true, `Backup ${date} deleted`); setRows(r => r.filter(b => b.date !== date)); }
    catch (e: any) { notify(false, e.message); }
    finally { setDeleting(null); }
  };

  return (
    <>
      <PageHead title="Backups" sub="Daily 2 AM job + on-demand. Restore overwrites the live DB.">
        <button onClick={load} className="px-3 py-2 rounded-xl bg-[#161d33] text-sm flex items-center gap-1.5 hover:bg-[#1d2540]"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh</button>
        <button onClick={run} disabled={running} className="px-3 py-2 rounded-xl bg-[#7367f0] hover:bg-[#5e54d4] text-sm font-bold flex items-center gap-1.5 disabled:opacity-60"><Play size={14} /> Run Backup Now</button>
      </PageHead>
      {loading ? <Loader /> : rows.length === 0 ? <p className="text-[#6a7a9a]">No backups yet. Run one or wait for the daily 2 AM job.</p> : (
        <div className="space-y-3">
          {rows.map(b => {
            const dumps = b.files.filter((f: any) => f.name.endsWith('.dump'));
            const others = b.files.filter((f: any) => !f.name.endsWith('.dump'));
            const total = b.files.reduce((a: number, f: any) => a + (f.size || 0), 0);
            return (
              <div key={b.date} className={`${card} p-4`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <p className="font-bold text-sm">{b.date}</p>
                    <span className="text-[11px] text-[#5a6a8a]">{fmtSize(total)} · {b.files.length} files</span>
                  </div>
                  <button onClick={() => del(b.date)} disabled={deleting === b.date}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/25 text-rose-400 text-xs hover:bg-rose-500/20 disabled:opacity-60">
                    {deleting === b.date ? <RefreshCw size={12} className="animate-spin" /> : <Trash2 size={12} />} Delete set
                  </button>
                </div>
                <div className="space-y-2 mb-3">
                  {dumps.map((f: any) => {
                    const db = f.name.replace('.dump', '');
                    const dlKey = `${b.date}/${f.name}`;
                    const restKey = `${b.date}/${db}`;
                    return (
                      <div key={f.name} className="flex items-center gap-2 flex-wrap">
                        <button onClick={() => download(b.date, f.name)} disabled={downloading === dlKey}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#161d33] text-xs hover:bg-[#1d2540] disabled:opacity-60">
                          {downloading === dlKey ? <RefreshCw size={12} className="animate-spin" /> : <Download size={12} className="text-[#7367f0]" />}
                          {f.name} <span className="text-[#5a6a8a]">{fmtSize(f.size)}</span>
                        </button>
                        <button onClick={() => restore(b.date, db)} disabled={restoring === restKey}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-400 text-xs hover:bg-rose-500/25 disabled:opacity-60">
                          {restoring === restKey ? <RefreshCw size={12} className="animate-spin" /> : <Play size={12} />} Restore {db}
                        </button>
                      </div>
                    );
                  })}
                </div>
                {others.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {others.map((f: any) => (
                      <button key={f.name} onClick={() => download(b.date, f.name)} disabled={downloading === `${b.date}/${f.name}`}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#161d33] text-xs hover:bg-[#1d2540] disabled:opacity-60">
                        {downloading === `${b.date}/${f.name}` ? <RefreshCw size={12} className="animate-spin" /> : <Download size={12} className="text-[#7367f0]" />}
                        {f.name} <span className="text-[#5a6a8a]">{fmtSize(f.size)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// ── Audit Log ─────────────────────────────────────────────────────────────────
const ACTION_TONE: Record<string, string> = {
  create: 'text-emerald-400', activate: 'text-blue-400', extend: 'text-emerald-400',
  deactivate: 'text-amber-400', delete: 'text-rose-400', restore: 'text-rose-400',
  backup: 'text-[#9d95f5]', 'reset-password': 'text-amber-400', restart: 'text-rose-400',
};
function actionTone(a: string) {
  const key = (a.split('.')[1] || a);
  return ACTION_TONE[key] || 'text-[#9fb0d0]';
}

function AuditLog() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const load = () => { setLoading(true); sa.audit(300).then(setRows).catch(() => {}).finally(() => setLoading(false)); };
  useEffect(() => { load(); }, []);
  const filtered = rows.filter(r => !q.trim() ||
    `${r.action} ${r.tenant_id || ''} ${r.details || ''}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <PageHead title="Audit Log" sub="Every superadmin mutation, newest first">
        <button onClick={load} className="px-3 py-2 rounded-xl bg-[#161d33] text-sm flex items-center gap-1.5 hover:bg-[#1d2540]"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh</button>
      </PageHead>
      <div className="relative mb-4">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#5a6a8a]" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter by action, tenant or detail..."
          className="w-full rounded-xl pl-9 pr-3 py-2 text-sm bg-[#0f1525] border border-[#1e2740] text-white outline-none focus:border-[#7367f0]" />
      </div>
      {loading ? <Loader /> : filtered.length === 0 ? <p className="text-[#6a7a9a]">No audit entries{q ? ' match' : ' yet'}.</p> : (
        <div className={`${card} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-[#5a6a8a] border-b border-[#1e2740]">
                  <th className="text-left px-4 py-3">When</th>
                  <th className="text-left px-4 py-3">Action</th>
                  <th className="text-left px-4 py-3">Tenant</th>
                  <th className="text-left px-4 py-3">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#161d33]">
                {filtered.map(r => (
                  <tr key={r.id} className="hover:bg-white/[0.02]">
                    <td className="px-4 py-2.5 text-xs text-[#8897b5] whitespace-nowrap">{fmtDateTime(r.created_at)}</td>
                    <td className={`px-4 py-2.5 text-xs font-bold ${actionTone(r.action)}`}>{r.action}</td>
                    <td className="px-4 py-2.5 text-xs font-mono text-[#9fb0d0]">{r.tenant_id || '-'}</td>
                    <td className="px-4 py-2.5 text-xs text-[#6a7a9a] break-all">{r.details || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

// ── Settings ────────────────────────────────────────────────────────────────
const CONFIG_GROUPS: { title: string; keys: string[]; hint?: string }[] = [
  { title: 'Odoo', keys: ['ODOO_URL', 'ODOO_MASTER_PASSWORD'],
    hint: 'ODOO_MASTER_PASSWORD must equal admin_passwd in /etc/odoo/odoo.conf. New workspace databases are provisioned via the Odoo CLI.' },
  { title: 'Queenfinger (B2B database)', keys: ['QUEEN_URL', 'QUEEN_DB', 'QUEEN_ADMIN_LOGIN', 'QUEEN_ADMIN_PASSWORD'],
    hint: 'Server-side admin session for the queenfinger B2B database. Use "Test connection" after saving.' },
  { title: 'Razorpay (payments)', keys: ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_PLAN_ID_STARTER', 'RAZORPAY_PLAN_ID_PRO', 'RAZORPAY_WEBHOOK_SECRET', 'PLAN_PRICE_STARTER', 'PLAN_PRICE_PRO'] },
  { title: 'Backups (Cloudflare R2)', keys: ['R2_ACCOUNT_ID', 'R2_BUCKET_NAME', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_ENDPOINT'] },
  { title: 'Email (SMTP)', keys: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'] },
  { title: 'Superadmin & Security', keys: ['SUPERADMIN_USERNAME', 'SUPERADMIN_PASSWORD', 'JWT_SECRET', 'ADMIN_OTP_ENABLED'],
    hint: 'ADMIN_OTP_ENABLED = true requires admins to enter an emailed code at login (needs the SMTP group configured).' },
];
const isSensitive = (k: string) => k.includes('SECRET') || k.includes('PASS') || (k.includes('KEY') && k !== 'RAZORPAY_KEY_ID') || k === 'JWT_SECRET';

function SettingsTab({ notify }: { notify: (ok: boolean, m: string) => void }) {
  const [cfg, setCfg] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  useEffect(() => { sa.getConfig().then(setCfg).catch(() => {}).finally(() => setLoading(false)); }, []);

  const save = async () => {
    setSaving(true);
    const payload: Record<string, string> = {};
    Object.entries(cfg).forEach(([k, v]) => { if (v && v !== '••••••••') payload[k] = v; });
    try { await sa.saveConfig(payload); notify(true, 'Settings saved & reloaded'); } catch (e: any) { notify(false, e.message); } finally { setSaving(false); }
  };

  const testSmtp = async () => {
    setTesting('smtp');
    try { const r = await sa.testSmtp(); notify(true, r.message || 'Test email sent'); } catch (e: any) { notify(false, e.message); } finally { setTesting(null); }
  };
  const testQueen = async () => {
    setTesting('queen');
    try { const r = await sa.testQueen(); notify(true, `Queenfinger OK — ${r.partnerCount} partners in ${r.db}`); } catch (e: any) { notify(false, e.message); } finally { setTesting(null); }
  };

  const inp = 'w-full rounded-lg px-3 py-2 text-sm bg-[#161d33] border border-[#2a3250] text-white outline-none focus:border-[#7367f0]';
  if (loading) return <Loader />;
  return (
    <>
      <PageHead title="Settings" sub="API keys, credentials & integrations">
        <button onClick={save} disabled={saving} className="px-4 py-2 rounded-xl bg-[#7367f0] hover:bg-[#5e54d4] text-sm font-bold flex items-center gap-1.5 disabled:opacity-60">
          {saving ? <RefreshCw size={14} className="animate-spin" /> : <Check size={15} />} Save Settings
        </button>
      </PageHead>

      <div className="space-y-5">
        {CONFIG_GROUPS.map(g => (
          <div key={g.title} className={`${card} p-5`}>
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-bold text-sm text-[#9d95f5]">{g.title}</h3>
              {g.title.startsWith('Email') && (
                <button onClick={testSmtp} disabled={testing === 'smtp'} className="text-xs px-2.5 py-1 rounded-lg bg-[#161d33] hover:bg-[#1d2540] flex items-center gap-1.5 disabled:opacity-60">
                  {testing === 'smtp' ? <RefreshCw size={12} className="animate-spin" /> : <Mail size={12} className="text-[#7367f0]" />} Test SMTP
                </button>
              )}
              {g.title.startsWith('Queenfinger') && (
                <button onClick={testQueen} disabled={testing === 'queen'} className="text-xs px-2.5 py-1 rounded-lg bg-[#161d33] hover:bg-[#1d2540] flex items-center gap-1.5 disabled:opacity-60">
                  {testing === 'queen' ? <RefreshCw size={12} className="animate-spin" /> : <Wifi size={12} className="text-[#7367f0]" />} Test connection
                </button>
              )}
            </div>
            {g.hint && <p className="text-[11px] text-[#6a7a9a] mb-3 leading-relaxed">{g.hint}</p>}
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
      <h3 className="font-bold text-sm mb-1 text-[#9d95f5] flex items-center gap-1.5"><ShieldCheck size={14} /> Two-Factor Authentication</h3>
      <p className="text-xs text-[#6a7a9a] mb-3">Status: {enabled === null ? '...' : enabled ? <span className="text-emerald-400 font-bold">Enabled</span> : <span className="text-amber-400 font-bold">Disabled</span>}</p>
      {enabled ? (
        <button onClick={disable} className="px-3 py-2 rounded-xl bg-rose-500/15 text-rose-400 text-sm font-bold">Disable 2FA</button>
      ) : setup ? (
        <div className="flex flex-col sm:flex-row gap-4 items-start">
          <img src={setup.qrUrl} alt="2FA QR" className="w-40 h-40 rounded-xl bg-white p-2" />
          <div className="flex-1">
            <p className="text-xs text-[#8897b5] mb-1">Scan with an authenticator app, or enter the secret:</p>
            <p className="font-mono text-xs bg-[#161d33] rounded-lg px-2 py-1 inline-block mb-3">{setup.secret}</p>
            <div className="flex gap-2">
              <input value={code} onChange={e => setCode(e.target.value)} placeholder="6-digit code" maxLength={6}
                className="rounded-lg px-3 py-2 text-sm bg-[#161d33] border border-[#2a3250] text-white outline-none tracking-widest w-32" />
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
    <div className="rounded-2xl p-5 border border-rose-500/25 bg-rose-500/5">
      <h3 className="font-bold text-sm mb-1 text-rose-400 flex items-center gap-1.5"><Zap size={14} /> Danger Zone</h3>
      <p className="text-xs text-[#8897b5] mb-3">Restart the Node control-plane process (brief downtime).</p>
      <button onClick={restart} className="px-3 py-2 rounded-xl bg-rose-500/15 text-rose-400 text-sm font-bold flex items-center gap-1.5"><Power size={14} /> Restart Server</button>
    </div>
  );
}
