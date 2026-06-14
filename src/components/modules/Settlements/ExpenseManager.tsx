import { useState, useEffect, useCallback } from 'react';
import { searchRead, createRecord, unlinkRecord } from '../../../services/odoo';
import { useTheme } from '../../../context/ThemeContext';
import { useAuth } from '../../../context/AuthContext';
import {
  Plus, RefreshCw, X, Download, TrendingDown,
  CheckCircle2, AlertCircle, ChevronRight, ChevronDown,
  BarChart2, List, Users, Wallet, Trash2, Settings, UserPlus,
} from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';

// ─────────────────────────────────────────────────────────────────────────────
interface Expense {
  id: number;
  date: string;
  amount: number;
  category: string;
  description: string;
  paid_by_id: [number, string] | false;
  owner_id:   [number, string] | false;
  employee_id:[number, string] | false;
  note: string | false;
}
interface Ref { id: number; name: string; }

const CATS = [
  { key: 'salary',      label: 'Salary',          color: '#7367f0' },
  { key: 'rent',        label: 'Rent',             color: '#f59e0b' },
  { key: 'food',        label: 'Food',             color: '#10b981' },
  { key: 'travel',      label: 'Travel',           color: '#3b82f6' },
  { key: 'electricity', label: 'Electricity',      color: '#f97316' },
  { key: 'development', label: 'Development',      color: '#8b5cf6' },
  { key: 'withdrawal',  label: 'Withdrawal',       color: '#ef4444' },
  { key: 'other',       label: 'Other',            color: '#6b7280' },
];
const catMeta = (k: string) => CATS.find(c => c.key === k) ?? CATS[CATS.length - 1];

const DATE_PRESETS = [
  { key: 'today',  label: 'Today'  },
  { key: 'week',   label: 'Week'   },
  { key: 'month',  label: 'Month'  },
  { key: 'year',   label: 'Year'   },
  { key: 'all',    label: 'All'    },
  { key: 'custom', label: 'Custom' },
];

function getDateRange(preset: string): [string, string] | null {
  const now = new Date();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  if (preset === 'today') { const s = fmt(now); return [s, s]; }
  if (preset === 'week')  { const day = now.getDay(); const mon = new Date(now); mon.setDate(now.getDate() - ((day + 6) % 7)); return [fmt(mon), fmt(now)]; }
  if (preset === 'month') { return [fmt(new Date(now.getFullYear(), now.getMonth(), 1)), fmt(now)]; }
  if (preset === 'year')  { return [fmt(new Date(now.getFullYear(), 0, 1)), fmt(now)]; }
  return null;
}

const inr = (n: number) =>
  `₹${Math.abs(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// Compact (no decimals) -- used in the small stat cards so they don't overflow.
const inr0 = (n: number) => `₹${Math.round(Math.abs(n || 0)).toLocaleString('en-IN')}`;
// Short Indian notation (K / L / Cr) -- for tight spots like the donut center.
const inrShort = (n: number) => {
  const a = Math.abs(n || 0);
  if (a >= 1e7) return `₹${(a / 1e7).toFixed(2).replace(/\.?0+$/, '')}Cr`;
  if (a >= 1e5) return `₹${(a / 1e5).toFixed(2).replace(/\.?0+$/, '')}L`;
  if (a >= 1e3) return `₹${(a / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  return `₹${Math.round(a)}`;
};

type MainTab = 'overview' | 'expenses' | 'withdrawals';

// ═════════════════════════════════════════════════════════════════════════════
export default function ExpenseManager() {
  const { isDark } = useTheme();
  const { user }   = useAuth();
  const isAdmin    = !!user?.is_admin;

  const [expenses,   setExpenses]   = useState<Expense[]>([]);
  const [associates, setAssociates] = useState<Ref[]>([]);
  const [owners,     setOwners]     = useState<Ref[]>([]);
  const [employees,  setEmployees]  = useState<Ref[]>([]);
  const [loading,    setLoading]    = useState(false);
  const [tab,        setTab]        = useState<MainTab>('overview');
  const [preset,     setPreset]     = useState('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo,   setCustomTo]   = useState('');
  const [addOpen,    setAddOpen]    = useState(false);
  const [ownersOpen, setOwnersOpen] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);

  const showMsg = (ok: boolean, msg: string) => {
    setToast({ ok, msg }); setTimeout(() => setToast(null), 4000);
  };

  const loadRefs = useCallback(async () => {
    const [as_, ow, em] = await Promise.allSettled([
      searchRead<Ref>('flipkart.money.associate', { fields: ['id', 'name'], limit: 0 }),
      searchRead<Ref>('flipkart.owner',           { fields: ['id', 'name'], limit: 0 }),
      searchRead<Ref>('hr.employee',              { fields: ['id', 'name'], domain: [['active', '=', true]], limit: 0 }),
    ]);
    if (as_.status === 'fulfilled' && Array.isArray(as_.value)) setAssociates(as_.value);
    if (ow.status  === 'fulfilled' && Array.isArray(ow.value))  setOwners(ow.value);
    if (em.status  === 'fulfilled' && Array.isArray(em.value))  setEmployees(em.value);
  }, []);

  const loadExpenses = useCallback(async () => {
    setLoading(true);
    try {
      const range = preset === 'custom'
        ? (customFrom && customTo ? [customFrom, customTo] as [string, string] : null)
        : getDateRange(preset);
      const domain: any[] = [];
      if (range) domain.push(['date', '>=', range[0]], ['date', '<=', range[1]]);
      const r = await searchRead<any>('flipkart.expense', {
        fields: ['id', 'date', 'amount', 'category', 'description', 'paid_by_id', 'owner_id', 'employee_id', 'note'],
        domain, order: 'date desc, id desc', limit: 0,
      });
      if (Array.isArray(r)) setExpenses(r.map(x => ({
        ...x,
        paid_by_id:  Array.isArray(x.paid_by_id)  ? x.paid_by_id  : false,
        owner_id:    Array.isArray(x.owner_id)     ? x.owner_id    : false,
        employee_id: Array.isArray(x.employee_id)  ? x.employee_id : false,
      })));
    } catch (e: any) { showMsg(false, e?.message || 'Load failed'); }
    finally { setLoading(false); }
  }, [preset, customFrom, customTo]);

  useEffect(() => { loadRefs(); }, [loadRefs]);
  useEffect(() => { loadExpenses(); }, [loadExpenses]);

  // ── derived ─────────────────────────────────────────────────────────────────
  const totalSpend      = expenses.reduce((s, e) => s + e.amount, 0);
  const totalWithdrawal = expenses.filter(e => e.category === 'withdrawal').reduce((s, e) => s + e.amount, 0);
  const pieData = CATS.map(c => ({
    name: c.label, value: expenses.filter(e => e.category === c.key).reduce((s, e) => s + e.amount, 0), color: c.color,
  })).filter(d => d.value > 0);
  const topCat = [...pieData].sort((a, b) => b.value - a.value)[0];

  const withdrawals = expenses.filter(e => e.category === 'withdrawal');
  const ownerMap = new Map<string, { name: string; total: number; entries: Expense[] }>();
  withdrawals.forEach(e => {
    const key  = e.owner_id ? String(e.owner_id[0]) : '__none__';
    const name = e.owner_id ? e.owner_id[1] : 'Unassigned';
    if (!ownerMap.has(key)) ownerMap.set(key, { name, total: 0, entries: [] });
    const g = ownerMap.get(key)!; g.total += e.amount; g.entries.push(e);
  });
  const ownerGroups = [...ownerMap.values()].sort((a, b) => b.total - a.total);

  // ── styles ──────────────────────────────────────────────────────────────────
  const card   = isDark ? 'bg-[#161b2e] border-[#2a3250]' : 'bg-white border-gray-200';
  const txt    = isDark ? 'text-white' : 'text-gray-900';
  const sub    = isDark ? 'text-[#5a6a8a]' : 'text-gray-400';
  const border = isDark ? 'border-[#2a3250]' : 'border-gray-200';
  const itemBg = isDark ? 'bg-[#12172a]' : 'bg-gray-50';

  const exportCsv = () => {
    const rows = [
      ['Date', 'Category', 'Description', 'Amount', 'Employee', 'Owner', 'Paid By'],
      ...expenses.map(e => [
        e.date, catMeta(e.category).label, e.description, e.amount,
        e.employee_id ? e.employee_id[1] : '',
        e.owner_id    ? e.owner_id[1]    : '',
        e.paid_by_id  ? e.paid_by_id[1]  : '',
      ]),
    ];
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a   = document.createElement('a'); a.href = url;
    a.download = `expenses-${preset}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  const deleteExpense = async (id: number) => {
    if (!window.confirm('Delete this expense?')) return;
    try {
      await unlinkRecord('flipkart.expense', [id]);
      setExpenses(prev => prev.filter(e => e.id !== id));
      showMsg(true, 'Deleted');
    } catch (e: any) { showMsg(false, e?.message || 'Delete failed'); }
  };

  return (
    <div className={`min-h-screen ${isDark ? 'bg-[#0f1422]' : 'bg-gray-50'} animate-fade-in`}>
      {toast && (
        <div className={`fixed top-5 left-1/2 -translate-x-1/2 z-[60] px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-2 text-sm font-medium
          ${toast.ok ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'}`}>
          {toast.ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />} {toast.msg}
        </div>
      )}

      <div className="max-w-2xl mx-auto px-3 pt-3 pb-32">
        {/* ── Header ────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-2 mb-3 pl-10 lg:pl-0">
          <div className="min-w-0">
            <h1 className={`text-xl font-black whitespace-nowrap ${txt}`}>Expense Manager</h1>
            <p className={`text-xs truncate ${sub}`}>Track & analyse business spending</p>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {isAdmin && (
              <button onClick={() => setOwnersOpen(true)}
                className={`p-2 rounded-xl border ${border} ${sub}`}
                title="Manage Owners" aria-label="Manage Owners">
                <Settings size={15} />
              </button>
            )}
            <button onClick={exportCsv}
              className={`p-2 rounded-xl border ${border} ${sub}`}
              title="Export CSV" aria-label="Export CSV">
              <Download size={15} />
            </button>
            <button onClick={loadExpenses} className={`p-2 rounded-xl border ${border} ${sub}`}
              title="Refresh" aria-label="Refresh">
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* ── Date filter ───────────────────────────────────────────── */}
        <div className={`flex p-1 rounded-2xl mb-2 ${isDark ? 'bg-[#1e2440]' : 'bg-gray-100'}`}>
          {DATE_PRESETS.map(p => (
            <button key={p.key} onClick={() => setPreset(p.key)}
              className={`flex-1 py-1.5 rounded-xl text-[10px] font-bold transition-all
                ${preset === p.key ? 'bg-[#7367f0] text-white shadow-md' : sub}`}>
              {p.label}
            </button>
          ))}
        </div>
        {preset === 'custom' && (
          <div className={`flex items-center gap-2 mb-3 p-2.5 rounded-2xl border ${border} ${isDark ? 'bg-[#1e2440]' : 'bg-gray-50'}`}>
            <div className="flex-1">
              <p className={`text-[10px] font-semibold mb-1 ${sub}`}>From</p>
              <input type="date" value={customFrom}
                onChange={e => setCustomFrom(e.target.value)}
                className={`input text-xs py-2 w-full ${isDark ? 'bg-[#12172a] border-[#2a3250] text-white' : ''}`} />
            </div>
            <div className={`text-xs font-bold mt-4 ${sub}`}>→</div>
            <div className="flex-1">
              <p className={`text-[10px] font-semibold mb-1 ${sub}`}>To</p>
              <input type="date" value={customTo}
                onChange={e => setCustomTo(e.target.value)}
                className={`input text-xs py-2 w-full ${isDark ? 'bg-[#12172a] border-[#2a3250] text-white' : ''}`} />
            </div>
            <button onClick={loadExpenses}
              className="mt-4 px-3 py-2 rounded-xl text-white text-xs font-bold"
              style={{ background: 'linear-gradient(135deg, #7367f0, #3d5af1)' }}>
              Go
            </button>
          </div>
        )}
        {preset !== 'custom' && <div className="mb-1" />}

        {/* ── Stats ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-2.5 mb-3">
          <div className={`rounded-2xl p-3 border ${card}`}>
            <div className={`flex items-center gap-1 text-[10px] font-semibold uppercase ${sub}`}><Wallet size={10} /> Total</div>
            <p className={`text-base font-black mt-1 truncate ${txt}`} title={inr(totalSpend)}>{inr0(totalSpend)}</p>
            <p className={`text-[10px] mt-0.5 ${sub}`}>{expenses.length} entries</p>
          </div>
          <div className={`rounded-2xl p-3 border ${card}`}>
            <div className={`flex items-center gap-1 text-[10px] font-semibold uppercase ${sub}`}><BarChart2 size={10} /> Top</div>
            <p className="text-sm font-black mt-1 truncate" style={{ color: topCat?.color ?? '#5a6a8a' }}>
              {topCat?.name ?? '—'}
            </p>
            <p className={`text-[10px] mt-0.5 truncate ${sub}`}>{topCat ? inr0(topCat.value) : '₹0'}</p>
          </div>
          <div className={`rounded-2xl p-3 border ${card}`}>
            <div className={`flex items-center gap-1 text-[10px] font-semibold uppercase ${sub}`}><TrendingDown size={10} /> Withdrawn</div>
            <p className="text-base font-black mt-1 truncate text-rose-500" title={inr(totalWithdrawal)}>{inr0(totalWithdrawal)}</p>
            <p className={`text-[10px] mt-0.5 ${sub}`}>{withdrawals.length} entries</p>
          </div>
        </div>

        {/* ── Tab bar ───────────────────────────────────────────────── */}
        <div className={`flex gap-1 p-1 rounded-2xl mb-3 ${isDark ? 'bg-[#1e2440]' : 'bg-gray-100'}`}>
          {([
            { key: 'overview',    label: 'Overview',    Icon: BarChart2 },
            { key: 'expenses',    label: 'Expenses',    Icon: List      },
            { key: 'withdrawals', label: 'Withdrawals', Icon: Users     },
          ] as { key: MainTab; label: string; Icon: any }[]).map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex-1 flex items-center justify-center gap-1 py-2 rounded-xl text-[11px] font-bold transition-all
                ${tab === t.key ? 'bg-[#7367f0] text-white shadow-md' : sub}`}>
              <t.Icon size={11} /><span className="truncate">{t.label}</span>
            </button>
          ))}
        </div>

        {/* ── Overview ──────────────────────────────────────────────── */}
        {tab === 'overview' && (
          <div className="space-y-3">
            {loading ? (
              <div className="py-16 flex justify-center"><RefreshCw size={22} className="animate-spin text-[#7367f0]" /></div>
            ) : pieData.length === 0 ? (
              <div className={`py-16 text-center text-sm ${sub}`}>No expenses this period. Tap + to add one.</div>
            ) : (
              <>
                <div className={`rounded-2xl p-4 border ${card}`}>
                  <p className={`text-xs font-bold uppercase tracking-wider mb-3 ${sub}`}>Spending by Category</p>
                  <div className="relative">
                    <ResponsiveContainer width="100%" height={230}>
                      <PieChart>
                        <Pie data={pieData} cx="50%" cy="50%" innerRadius={62} outerRadius={92}
                          dataKey="value" nameKey="name" paddingAngle={2}>
                          {pieData.map((entry, i) => <Cell key={i} fill={entry.color} stroke="transparent" />)}
                        </Pie>
                        <Tooltip formatter={(val: number) => [inr(val), '']}
                          contentStyle={{ background: isDark ? '#1e2440' : '#fff', border: '1px solid #2a3250', borderRadius: 12, fontSize: 12 }}
                          labelStyle={{ color: isDark ? '#fff' : '#111' }} />
                        <Legend iconType="circle" iconSize={8}
                          formatter={(v) => <span style={{ fontSize: 11, color: isDark ? '#8897b5' : '#6b7280' }}>{v}</span>} />
                      </PieChart>
                    </ResponsiveContainer>
                    {/* Center total -- overlaid on the donut hole */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none px-2" style={{ bottom: 34 }}>
                      <span className={`text-[10px] font-bold uppercase tracking-wider ${sub}`}>Total Spent</span>
                      <span className={`text-lg font-black leading-tight max-w-[110px] text-center truncate ${txt}`} title={inr(totalSpend)}>{inrShort(totalSpend)}</span>
                    </div>
                  </div>
                </div>
                <div className={`rounded-2xl border divide-y ${card} ${isDark ? 'divide-[#2a3250]' : 'divide-gray-100'}`}>
                  {[...pieData].sort((a, b) => b.value - a.value).map(c => {
                    const pct = totalSpend > 0 ? (c.value / totalSpend) * 100 : 0;
                    return (
                      <div key={c.name} className="px-4 py-3 flex items-center gap-3">
                        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: c.color }} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <span className={`text-sm font-semibold ${txt}`}>{c.name}</span>
                            <span className="text-sm font-black" style={{ color: c.color }}>{inr(c.value)}</span>
                          </div>
                          <div className={`h-1.5 rounded-full ${isDark ? 'bg-[#2a3250]' : 'bg-gray-100'}`}>
                            <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: c.color }} />
                          </div>
                        </div>
                        <span className={`text-[11px] font-bold w-10 text-right ${sub}`}>{pct.toFixed(1)}%</span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Expenses list ─────────────────────────────────────────── */}
        {tab === 'expenses' && (
          <div className="space-y-2">
            {loading ? (
              <div className="py-16 flex justify-center"><RefreshCw size={22} className="animate-spin text-[#7367f0]" /></div>
            ) : expenses.length === 0 ? (
              <div className={`py-16 text-center text-sm ${sub}`}>No expenses this period.</div>
            ) : expenses.map(e => {
              const meta = catMeta(e.category);
              return (
                <div key={e.id} className={`rounded-2xl p-3.5 border ${card} flex items-start gap-3`}>
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: meta.color + '22' }}>
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: meta.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className={`font-bold text-sm truncate ${txt}`}>{e.description}</p>
                        <p className={`text-xs mt-0.5 ${sub}`}>
                          {e.date} · {meta.label}
                          {e.employee_id && ` · ${e.employee_id[1]}`}
                          {e.owner_id    && ` · ${e.owner_id[1]}`}
                          {e.paid_by_id  && ` · paid by ${e.paid_by_id[1]}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <span className="font-black text-sm" style={{ color: meta.color }}>{inr(e.amount)}</span>
                        {isAdmin && (
                          <button onClick={() => deleteExpense(e.id)}
                            className="p-1 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors">
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Withdrawals ledger ────────────────────────────────────── */}
        {tab === 'withdrawals' && (
          <div className="space-y-2">
            {isAdmin && (
              <div className={`rounded-2xl p-3 border border-dashed ${border} flex items-center justify-between`}>
                <p className={`text-xs ${sub}`}>Grouped by owner. Add withdrawals via "+ Add Expense".</p>
                <button onClick={() => setOwnersOpen(true)}
                  className={`flex items-center gap-1 text-xs font-bold text-[#7367f0]`}>
                  <UserPlus size={12} /> Manage Owners
                </button>
              </div>
            )}
            {loading ? (
              <div className="py-16 flex justify-center"><RefreshCw size={22} className="animate-spin text-[#7367f0]" /></div>
            ) : ownerGroups.length === 0 ? (
              <div className={`py-16 text-center text-sm ${sub}`}>No withdrawals this period.</div>
            ) : ownerGroups.map(g => (
              <OwnerCard key={g.name} group={g} isDark={isDark} card={card} txt={txt}
                sub={sub} border={border} itemBg={itemBg} isAdmin={isAdmin} onDelete={deleteExpense} />
            ))}
          </div>
        )}
      </div>

      {/* ── FAB ──────────────────────────────────────────────────────── */}
      <div className="fixed bottom-5 right-4 z-40">
        <button onClick={() => setAddOpen(true)}
          className="h-12 px-5 rounded-2xl shadow-2xl flex items-center gap-2 text-white font-bold text-sm"
          style={{ background: 'linear-gradient(135deg, #7367f0, #3d5af1)' }}>
          <Plus size={16} /> Add Expense
        </button>
      </div>

      {addOpen && (
        <AddExpenseSheet isDark={isDark} associates={associates} owners={owners} employees={employees}
          onClose={() => setAddOpen(false)}
          onSaved={() => { setAddOpen(false); loadExpenses(); showMsg(true, 'Expense recorded.'); }}
          onError={m => showMsg(false, m)} />
      )}

      {ownersOpen && (
        <ManageOwnersSheet isDark={isDark} owners={owners}
          onClose={() => setOwnersOpen(false)}
          onChanged={() => { loadRefs(); showMsg(true, 'Owners updated.'); }} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Owner card (collapsible ledger per owner)
// ─────────────────────────────────────────────────────────────────────────────
function OwnerCard({ group, isDark, card, txt, sub, border, itemBg, isAdmin, onDelete }: {
  group: { name: string; total: number; entries: Expense[] };
  isDark: boolean; card: string; txt: string; sub: string; border: string; itemBg: string;
  isAdmin: boolean; onDelete: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`rounded-2xl border overflow-hidden ${card}`}>
      <button className="w-full flex items-center gap-3 p-4 text-left" onClick={() => setOpen(o => !o)}>
        <div className="w-10 h-10 rounded-xl bg-rose-500/15 flex items-center justify-center flex-shrink-0">
          <Users size={16} className="text-rose-500" />
        </div>
        <div className="flex-1 min-w-0">
          <p className={`font-bold text-sm ${txt}`}>{group.name}</p>
          <p className={`text-xs ${sub}`}>{group.entries.length} withdrawal{group.entries.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <p className="font-black text-sm text-rose-500">{inr(group.total)}</p>
          {open ? <ChevronDown size={15} className={sub} /> : <ChevronRight size={15} className={sub} />}
        </div>
      </button>
      {open && (
        <div className={`border-t ${border} divide-y ${isDark ? 'divide-[#2a3250]' : 'divide-gray-100'}`}>
          {group.entries.map(e => (
            <div key={e.id} className={`px-4 py-3 ${itemBg} flex items-center gap-3`}>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-semibold ${txt}`}>{e.description}</p>
                <p className={`text-xs ${sub}`}>{e.date}{e.paid_by_id ? ` · ${e.paid_by_id[1]}` : ''}</p>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <span className="font-black text-sm text-rose-500">{inr(e.amount)}</span>
                {isAdmin && (
                  <button onClick={() => onDelete(e.id)} className="p-1 rounded-lg text-red-400 hover:bg-red-500/10">
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Manage Owners sheet — add / delete owners from flipkart.owner
// ─────────────────────────────────────────────────────────────────────────────
function ManageOwnersSheet({ isDark, owners, onClose, onChanged }: {
  isDark: boolean; owners: Ref[];
  onClose: () => void; onChanged: () => void;
}) {
  const [list, setList]   = useState<Ref[]>(owners);
  const [name, setName]   = useState('');
  const [saving, setSaving] = useState(false);
  const border = isDark ? 'border-[#2a3250]' : 'border-gray-100';
  const txt    = isDark ? 'text-white' : 'text-gray-900';
  const sub    = isDark ? 'text-[#5a6a8a]' : 'text-gray-400';
  const field  = `input text-sm py-2.5 flex-1 ${isDark ? 'bg-[#12172a] border-[#2a3250] text-white' : ''}`;

  const addOwner = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const id = await createRecord('flipkart.owner', { name: name.trim() });
      const newOwner = { id: id as number, name: name.trim() };
      setList(prev => [...prev, newOwner]);
      setName('');
      onChanged();
    } catch { /* swallow */ } finally { setSaving(false); }
  };

  const removeOwner = async (id: number) => {
    if (!window.confirm('Remove this owner?')) return;
    try {
      await unlinkRecord('flipkart.owner', [id]);
      setList(prev => prev.filter(o => o.id !== id));
      onChanged();
    } catch { /* swallow */ }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center sm:justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className={`w-full sm:max-w-lg max-h-[85vh] flex flex-col rounded-t-3xl sm:rounded-3xl ${isDark ? 'bg-[#161b2e]' : 'bg-white'} shadow-2xl animate-slide-up`}
        onClick={e => e.stopPropagation()}>
        <div className="pt-2.5 flex justify-center sm:hidden"><div className="w-10 h-1 rounded-full bg-gray-400/40" /></div>
        <div className={`px-5 py-4 flex items-center justify-between border-b ${border}`}>
          <h2 className={`font-black text-base ${txt}`}>Manage Owners</h2>
          <button onClick={onClose} className={`p-1.5 rounded-xl ${isDark ? 'hover:bg-white/5 text-[#5a6a8a]' : 'hover:bg-gray-100 text-gray-400'}`}><X size={18} /></button>
        </div>
        <div className="overflow-y-auto px-5 py-4">
          {/* Add row */}
          <div className="flex gap-2 mb-4">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Owner / recipient name"
              onKeyDown={e => e.key === 'Enter' && addOwner()} className={field} />
            <button onClick={addOwner} disabled={saving || !name.trim()}
              className="px-4 py-2.5 rounded-xl text-white font-bold text-sm disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #7367f0, #3d5af1)' }}>
              {saving ? <RefreshCw size={14} className="animate-spin" /> : <Plus size={14} />}
            </button>
          </div>
          {/* List */}
          {list.length === 0 ? (
            <p className={`text-center text-sm py-8 ${sub}`}>No owners yet. Add one above.</p>
          ) : (
            <div className={`rounded-2xl border divide-y overflow-hidden ${isDark ? 'border-[#2a3250] divide-[#2a3250]' : 'border-gray-200 divide-gray-100'}`}>
              {list.map(o => (
                <div key={o.id} className={`flex items-center justify-between px-4 py-3 ${isDark ? 'bg-[#12172a]' : 'bg-gray-50'}`}>
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-xl bg-[#7367f0]/20 flex items-center justify-center">
                      <Users size={12} className="text-[#7367f0]" />
                    </div>
                    <span className={`text-sm font-semibold ${txt}`}>{o.name}</span>
                  </div>
                  <button onClick={() => removeOwner(o.id)} className="p-1.5 rounded-lg text-red-400 hover:bg-red-500/10">
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Add expense sheet
// ─────────────────────────────────────────────────────────────────────────────
function AddExpenseSheet({ isDark, associates, owners, employees, onClose, onSaved, onError }: {
  isDark: boolean;
  associates: Ref[]; owners: Ref[]; employees: Ref[];
  onClose: () => void; onSaved: () => void; onError: (m: string) => void;
}) {
  const [form, setForm]     = useState<Record<string, any>>({
    date: new Date().toISOString().slice(0, 10), category: 'other',
  });
  const [saving, setSaving] = useState(false);
  const setF  = (k: string, v: any) => setForm(p => ({ ...p, [k]: v }));
  const field = `input text-sm py-2.5 w-full ${isDark ? 'bg-[#12172a] border-[#2a3250] text-white' : ''}`;
  const lbl   = `text-[11px] font-semibold block mb-1 ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`;
  const border = isDark ? 'border-[#2a3250]' : 'border-gray-100';

  const submit = async () => {
    if (!form.amount || parseFloat(form.amount) <= 0) { onError('Enter a valid amount.'); return; }
    setSaving(true);
    try {
      const vals: Record<string, any> = {
        date: form.date, amount: parseFloat(form.amount),
        category: form.category, description: form.description?.trim() || false,
        note: form.note || false,
      };
      if (form.paid_by_id)  vals.paid_by_id  = Number(form.paid_by_id);
      if (form.category === 'withdrawal' && form.owner_id)    vals.owner_id    = Number(form.owner_id);
      if (form.category === 'salary'     && form.employee_id) vals.employee_id = Number(form.employee_id);
      await createRecord('flipkart.expense', vals);
      onSaved();
    } catch (e: any) { onError(e?.message || 'Create failed'); } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center sm:justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className={`w-full sm:max-w-lg max-h-[92vh] flex flex-col rounded-t-3xl sm:rounded-3xl ${isDark ? 'bg-[#161b2e]' : 'bg-white'} shadow-2xl animate-slide-up`}
        onClick={e => e.stopPropagation()}>
        <div className="pt-2.5 flex justify-center sm:hidden"><div className="w-10 h-1 rounded-full bg-gray-400/40" /></div>
        <div className={`px-5 py-4 flex items-center justify-between border-b ${border}`}>
          <h2 className={`font-black text-base ${isDark ? 'text-white' : 'text-gray-900'}`}>Add Expense</h2>
          <button onClick={onClose} className={`p-1.5 rounded-xl ${isDark ? 'hover:bg-white/5 text-[#5a6a8a]' : 'hover:bg-gray-100 text-gray-400'}`}><X size={18} /></button>
        </div>

        {/* Big editable amount at the top */}
        <div className={`px-5 pt-5 pb-4 border-b ${border}`}>
          <p className={`text-[11px] font-bold uppercase tracking-wider text-center ${isDark ? 'text-[#6a7a9a]' : 'text-gray-400'}`}>Amount Spent</p>
          <div className="flex items-center justify-center gap-1 mt-1">
            <span className={`text-3xl font-black ${isDark ? 'text-[#6a7a9a]' : 'text-gray-400'}`}>₹</span>
            <input
              inputMode="decimal" type="text" autoFocus placeholder="0"
              value={form.amount || ''}
              onChange={e => setF('amount', e.target.value.replace(/[^0-9.]/g, ''))}
              className={`text-5xl font-black bg-transparent outline-none text-center w-full max-w-[230px] ${isDark ? 'text-white placeholder-[#3a4566]' : 'text-gray-900 placeholder-gray-300'}`}
              style={{ caretColor: '#7367f0' }} />
          </div>
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-3">
          <div>
            <label className={lbl}>Date *</label>
            <input type="date" value={form.date || ''} onChange={e => setF('date', e.target.value)} className={field} />
          </div>

          {/* Category grid */}
          <div>
            <label className={lbl}>Category *</label>
            <div className="grid grid-cols-4 gap-1.5">
              {CATS.map(c => (
                <button key={c.key} type="button" onClick={() => setF('category', c.key)}
                  className={`py-2 px-1 rounded-xl border text-[10px] font-bold transition-all text-center leading-tight ${
                    form.category === c.key ? 'border-transparent text-white' : isDark ? 'border-[#2a3250] text-[#6a7a9a]' : 'border-gray-200 text-gray-500'
                  }`}
                  style={form.category === c.key ? { background: c.color } : {}}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className={lbl}>Description <span className="font-normal opacity-60">(optional)</span></label>
            <input value={form.description || ''} onChange={e => setF('description', e.target.value)}
              placeholder="e.g. Office rent, travel reimbursement…" className={field} />
          </div>

          {/* Salary → employee picker */}
          {form.category === 'salary' && (
            <div>
              <label className={lbl}>Employee</label>
              {employees.length === 0 ? (
                <p className={`text-xs ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'} mt-1`}>No employees found in Odoo HR.</p>
              ) : (
                <select value={form.employee_id || ''} onChange={e => setF('employee_id', e.target.value)} className={field}>
                  <option value="">Select employee</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              )}
            </div>
          )}

          {/* Withdrawal → owner picker */}
          {form.category === 'withdrawal' && (
            <div>
              <label className={lbl}>Owner / Recipient</label>
              {owners.length === 0 ? (
                <p className={`text-xs ${isDark ? 'text-amber-400' : 'text-amber-600'} mt-1`}>
                  No owners yet — tap "Owners" in the header to add one first.
                </p>
              ) : (
                <select value={form.owner_id || ''} onChange={e => setF('owner_id', e.target.value)} className={field}>
                  <option value="">Select owner</option>
                  {owners.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              )}
            </div>
          )}

          <div>
            <label className={lbl}>Paid By (Associate)</label>
            <select value={form.paid_by_id || ''} onChange={e => setF('paid_by_id', e.target.value)} className={field}>
              <option value="">Select associate</option>
              {associates.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>

          <div>
            <label className={lbl}>Note</label>
            <textarea rows={2} value={form.note || ''} onChange={e => setF('note', e.target.value)}
              placeholder="Optional additional details…" className={`${field} resize-none`} />
          </div>

          <button onClick={submit} disabled={saving || !form.amount}
            className="w-full py-3 rounded-2xl text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #7367f0, #3d5af1)' }}>
            {saving ? <RefreshCw size={16} className="animate-spin" /> : <Plus size={16} />} Save Expense
          </button>
        </div>
      </div>
    </div>
  );
}
