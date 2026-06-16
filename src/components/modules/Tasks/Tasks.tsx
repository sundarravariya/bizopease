import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTheme } from '../../../context/ThemeContext';
import { useAuth } from '../../../context/AuthContext';
import { searchRead, createRecord, unlinkRecord, odooCall, readGroup, listInternalUsers } from '../../../services/odoo';
import BulkDeleteBar from '../../ui/BulkDeleteBar';
import {
  CheckCircle2, Circle, Plus, X, RefreshCw, Trophy, Flame, Target,
  Trash2, Clock, Play, ListChecks, Medal, ChevronDown, AlertCircle, CalendarDays,
  AlertTriangle, BarChart3, Users, ChevronLeft, ChevronRight,
} from 'lucide-react';

// ───────────────────────────────────────────────────────────────────────────
interface Task {
  id: number;
  name: string;
  description: string;
  assignee_id: [number, string] | false;
  assigned_by_id: [number, string] | false;
  category: string;
  priority: string;
  state: 'todo' | 'in_progress' | 'done';
  task_date: string;
  deadline: string | false;
  done_date: string | false;
  points: number;
}
interface UserRef { id: number; name: string; }
interface LeaderRow { uid: number; name: string; done: number; points: number; pending: number; }
interface BehindRow { uid: number; name: string; count: number; }

const CATEGORIES = [
  { key: 'consignment', label: 'Consignment', cls: 'bg-violet-500/15 text-violet-400' },
  { key: 'inventory', label: 'Inventory', cls: 'bg-blue-500/15 text-blue-400' },
  { key: 'sales', label: 'Sales', cls: 'bg-emerald-500/15 text-emerald-400' },
  { key: 'purchase', label: 'Purchase', cls: 'bg-amber-500/15 text-amber-400' },
  { key: 'ledger', label: 'Ledger', cls: 'bg-cyan-500/15 text-cyan-400' },
  { key: 'packing', label: 'Packing', cls: 'bg-orange-500/15 text-orange-400' },
  { key: 'general', label: 'General', cls: 'bg-gray-500/15 text-gray-400' },
];
const catMeta = (k: string) => CATEGORIES.find(c => c.key === k) || CATEGORIES[5];

const PRIORITIES = [
  { key: '0', label: 'Low', bar: 'bg-gray-400', dot: 'text-gray-400' },
  { key: '1', label: 'Normal', bar: 'bg-blue-400', dot: 'text-blue-400' },
  { key: '2', label: 'High', bar: 'bg-amber-400', dot: 'text-amber-400' },
  { key: '3', label: 'Urgent', bar: 'bg-rose-500', dot: 'text-rose-500' },
];
const prioMeta = (k: string) => PRIORITIES.find(p => p.key === k) || PRIORITIES[1];

const COLUMNS: { key: Task['state']; label: string; icon: any; tint: string }[] = [
  { key: 'todo', label: 'To Do', icon: Circle, tint: 'text-gray-400' },
  { key: 'in_progress', label: 'In Progress', icon: Play, tint: 'text-amber-400' },
  { key: 'done', label: 'Done', icon: CheckCircle2, tint: 'text-emerald-400' },
];

const AVATAR_GRADIENTS = ['from-violet-500 to-indigo-600', 'from-blue-500 to-cyan-600', 'from-emerald-500 to-teal-600', 'from-amber-500 to-orange-600', 'from-rose-500 to-pink-600', 'from-fuchsia-500 to-violet-600'];
const initials = (s: string) => (s || '?').split(' ').slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
const today = () => new Date().toISOString().slice(0, 10);
const daysOverdue = (dateStr: string) => Math.max(0, Math.floor((new Date(today()).getTime() - new Date(dateStr).getTime()) / 86400000));

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtMonth = (ym: string) => { const [y, m] = ym.split('-'); return `${MONTH_NAMES[Number(m) - 1]} ${y}`; };
const prevMonth = (ym: string) => { const d = new Date(ym + '-01'); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); };
const nextMonth = (ym: string) => { const d = new Date(ym + '-01'); d.setMonth(d.getMonth() + 1); return d.toISOString().slice(0, 7); };
const isCurrentMonth = (ym: string) => ym === today().slice(0, 7);

const TASK_FIELDS = ['id', 'name', 'description', 'assignee_id', 'assigned_by_id', 'category', 'priority', 'state', 'task_date', 'deadline', 'done_date', 'points'];

type ViewType = 'tasks' | 'leaderboard' | 'monthly';

// ═══════════════════════════════════════════════════════════════════════════
export default function Tasks() {
  const { isDark } = useTheme();
  const { user } = useAuth();
  const isManager = !!user?.is_admin;
  const uid = user?.uid || 0;

  const [selIds, setSelIds] = useState<Set<number>>(new Set());
  const [view, setView] = useState<ViewType>('tasks');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [overdueItems, setOverdueItems] = useState<Task[]>([]);
  const [users, setUsers] = useState<UserRef[]>([]);
  const [leaders, setLeaders] = useState<LeaderRow[]>([]);
  const [behind, setBehind] = useState<BehindRow[]>([]);
  const [monthlyLeaders, setMonthlyLeaders] = useState<LeaderRow[]>([]);
  const [monthFilter, setMonthFilter] = useState(() => today().slice(0, 7));
  const [loading, setLoading] = useState(false);
  const [empFilter, setEmpFilter] = useState<number | 'all'>('all');
  const [dateFilter, setDateFilter] = useState<'today' | 'all'>('today');
  const [busy, setBusy] = useState<number | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const showMsg = (ok: boolean, msg: string) => { setToast({ ok, msg }); setTimeout(() => setToast(null), 4000); };

  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const baseDomain: any[] = [];
      if (isManager && empFilter !== 'all') baseDomain.push(['assignee_id', '=', empFilter]);

      const todayDomain = [...baseDomain, ['task_date', '=', today()]];
      const currentDomain = dateFilter === 'today' ? todayDomain : baseDomain;

      const [rows, overdueRows] = await Promise.all([
        searchRead<Task>('robifel.task', { fields: TASK_FIELDS, domain: currentDomain, limit: 0, order: 'priority desc, sequence, id desc' }),
        dateFilter === 'today'
          ? searchRead<Task>('robifel.task', {
              fields: TASK_FIELDS,
              domain: [...baseDomain, ['task_date', '<', today()], ['state', '!=', 'done']],
              limit: 100, order: 'task_date asc, priority desc',
            })
          : Promise.resolve<Task[]>([]),
      ]);
      setTasks(Array.isArray(rows) ? rows : []);
      setOverdueItems(Array.isArray(overdueRows) ? overdueRows : []);
    } catch (e: any) { showMsg(false, e.message); }
    finally { setLoading(false); }
  }, [isManager, empFilter, dateFilter]);

  const loadLeaders = useCallback(async () => {
    try {
      const [doneRows, pendingRows] = await Promise.all([
        readGroup<any>('robifel.task', {
          domain: [['state', '=', 'done']],
          fields: ['points:sum', 'assignee_id'],
          groupby: ['assignee_id'],
        }),
        readGroup<any>('robifel.task', {
          domain: [['state', '!=', 'done'], ['task_date', '<=', today()]],
          fields: ['assignee_id'],
          groupby: ['assignee_id'],
        }),
      ]);

      const pendingMap = new Map<number, number>();
      (Array.isArray(pendingRows) ? pendingRows : [])
        .filter(r => Array.isArray(r.assignee_id))
        .forEach(r => pendingMap.set(r.assignee_id[0], r.__count || 0));

      setBehind(
        (Array.isArray(pendingRows) ? pendingRows : [])
          .filter(r => Array.isArray(r.assignee_id))
          .map(r => ({ uid: r.assignee_id[0], name: r.assignee_id[1], count: r.__count || 0 }))
          .sort((a, b) => b.count - a.count)
      );

      const board: LeaderRow[] = (Array.isArray(doneRows) ? doneRows : [])
        .filter(r => Array.isArray(r.assignee_id))
        .map(r => ({
          uid: r.assignee_id[0], name: r.assignee_id[1],
          done: r.__count || 0, points: r.points || 0,
          pending: pendingMap.get(r.assignee_id[0]) || 0,
        }))
        .sort((a, b) => b.points - a.points || b.done - a.done);
      setLeaders(board);
    } catch { setLeaders([]); setBehind([]); }
  }, []);

  const loadMonthlyLeaders = useCallback(async () => {
    const [year, month] = monthFilter.split('-').map(Number);
    const firstDay = `${monthFilter}-01`;
    const lastDay = new Date(year, month, 0).toISOString().slice(0, 10);
    try {
      const rows = await readGroup<any>('robifel.task', {
        domain: [['state', '=', 'done'], ['done_date', '>=', firstDay + ' 00:00:00'], ['done_date', '<=', lastDay + ' 23:59:59']],
        fields: ['points:sum', 'assignee_id'],
        groupby: ['assignee_id'],
      });
      const board: LeaderRow[] = (Array.isArray(rows) ? rows : [])
        .filter(r => Array.isArray(r.assignee_id))
        .map(r => ({ uid: r.assignee_id[0], name: r.assignee_id[1], done: r.__count || 0, points: r.points || 0, pending: 0 }))
        .sort((a, b) => b.points - a.points || b.done - a.done);
      setMonthlyLeaders(board);
    } catch { setMonthlyLeaders([]); }
  }, [monthFilter]);

  useEffect(() => { loadTasks(); }, [loadTasks]);
  useEffect(() => { if (view === 'leaderboard') loadLeaders(); }, [view, loadLeaders]);
  useEffect(() => { if (view === 'monthly') loadMonthlyLeaders(); }, [view, loadMonthlyLeaders]);
  useEffect(() => { if (isManager) listInternalUsers().then(setUsers); }, [isManager]);

  // ── task actions ────────────────────────────────────────────────────────────
  const setTaskState = async (t: Task, state: Task['state']) => {
    setBusy(t.id);
    try {
      const method = state === 'done' ? 'action_done' : state === 'in_progress' ? 'action_start' : 'action_reset';
      await odooCall('robifel.task', method, [[t.id]], {});
      await loadTasks();
      if (state === 'done') showMsg(true, `+${t.points} points • "${t.name}" done`);
    } catch (e: any) { showMsg(false, e.message); }
    finally { setBusy(null); }
  };

  const toggleDone = (t: Task) => setTaskState(t, t.state === 'done' ? 'todo' : 'done');

  const removeTask = async (t: Task) => {
    setBusy(t.id);
    try { await unlinkRecord('robifel.task', [t.id]); await loadTasks(); }
    catch (e: any) { showMsg(false, e.message); }
    finally { setBusy(null); }
  };

  // ── derived ─────────────────────────────────────────────────────────────────
  const myTasks = tasks.filter(t => Array.isArray(t.assignee_id) && t.assignee_id[0] === uid);
  const scopeTasks = isManager ? tasks : myTasks;
  const myOverdue = overdueItems.filter(t => Array.isArray(t.assignee_id) && t.assignee_id[0] === uid);
  const scopeOverdue = isManager ? overdueItems : myOverdue;
  const doneCount = scopeTasks.filter(t => t.state === 'done').length;
  const total = scopeTasks.length;
  const progress = total ? Math.round((doneCount / total) * 100) : 0;
  const myPoints = myTasks.filter(t => t.state === 'done').reduce((s, t) => s + (t.points || 0), 0);

  const allScopeIds = useMemo(() => [...scopeTasks, ...scopeOverdue].map(t => t.id), [scopeTasks, scopeOverdue]);
  const allSelected = allScopeIds.length > 0 && allScopeIds.every(id => selIds.has(id));
  const toggleSelectAll = () => {
    if (allSelected) setSelIds(new Set());
    else setSelIds(new Set(allScopeIds));
  };
  const toggleSelect = (id: number) => setSelIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const txt = isDark ? 'text-white' : 'text-gray-900';
  const sub = isDark ? 'text-[#5a6a8a]' : 'text-gray-400';
  const border = isDark ? 'border-[#2a3250]' : 'border-gray-200';
  const cardBg = isDark ? 'bg-[#161b2e]' : 'bg-white';

  const VIEWS: [ViewType, string, any][] = [
    ['tasks', isManager ? 'Board' : 'My Day', ListChecks],
    ['leaderboard', 'Leaders', Trophy],
    ['monthly', 'Monthly', BarChart3],
  ];

  return (
    <div className={`max-w-5xl mx-auto animate-fade-in ${selIds.size > 0 ? 'pb-36' : 'pb-24'}`}>
      {toast && (
        <div className={`fixed top-5 left-1/2 -translate-x-1/2 z-[60] px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-2 text-sm font-medium ${toast.ok ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white'}`}>
          {toast.ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />} {toast.msg}
        </div>
      )}

      {/* Hero */}
      <div className="px-3 pt-3">
        <div className="rounded-3xl p-5 text-white shadow-xl relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #7367f0 0%, #4f46e5 55%, #3d5af1 100%)' }}>
          <div className="absolute -right-8 -top-10 w-40 h-40 rounded-full bg-white/10" />
          <div className="relative">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 text-xs font-semibold flex items-center gap-1.5"><ListChecks size={14} /> {isManager ? 'Team Tasks' : 'My Tasks'}</p>
                <p className="text-2xl font-black mt-1">{isManager ? `${doneCount}/${total} done today` : `Hello, ${(user?.name || '').split(' ')[0]} 👋`}</p>
              </div>
              <button onClick={() => { loadTasks(); if (view === 'leaderboard') loadLeaders(); if (view === 'monthly') loadMonthlyLeaders(); }} className="p-2 rounded-xl bg-white/15 hover:bg-white/25"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
            </div>
            <div className="mt-4">
              <div className="flex justify-between text-[11px] font-semibold text-white/80 mb-1"><span>Today's Progress</span><span>{progress}%</span></div>
              <div className="h-2 rounded-full bg-white/20 overflow-hidden"><div className="h-full bg-white rounded-full transition-all" style={{ width: `${progress}%` }} /></div>
            </div>
            <div className="flex gap-3 mt-4">
              <Stat icon={<Target size={13} />} label="Open" value={scopeTasks.filter(t => t.state !== 'done').length} />
              <Stat icon={<AlertTriangle size={13} />} label="Overdue" value={scopeOverdue.length} />
              <Stat icon={<Flame size={13} />} label="My Points" value={myPoints} />
            </div>
          </div>
        </div>
      </div>

      {/* View switch */}
      <div className="px-3 mt-3">
        <div className={`flex p-1 rounded-2xl ${isDark ? 'bg-[#1e2440]' : 'bg-gray-100'}`}>
          {VIEWS.map(([k, label, Icon]) => (
            <button key={k} onClick={() => setView(k)} className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold transition-all ${view === k ? 'bg-[#7367f0] text-white shadow-md' : sub}`}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
      </div>

      {view === 'tasks' ? (
        <>
          {/* Filters + Select All */}
          <div className="px-3 mt-2 flex items-center gap-2 flex-wrap">
            {(['today', 'all'] as const).map(d => (
              <button key={d} onClick={() => setDateFilter(d)} className={`text-xs font-bold px-3 py-1.5 rounded-full border ${dateFilter === d ? 'bg-[#7367f0] text-white border-[#7367f0]' : `${border} ${sub}`}`}>
                {d === 'today' ? 'Today' : 'All'}
              </button>
            ))}
            {isManager && (
              <div className="relative">
                <select value={empFilter} onChange={e => setEmpFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                  className={`appearance-none text-xs font-bold pl-3 pr-7 py-1.5 rounded-full border ${border} ${cardBg} ${txt}`}>
                  <option value="all">All Members</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
                <ChevronDown size={13} className={`absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none ${sub}`} />
              </div>
            )}
            {allScopeIds.length > 0 && (
              <button onClick={toggleSelectAll}
                className={`ml-auto text-xs font-bold px-3 py-1.5 rounded-full border transition-colors ${allSelected ? 'bg-rose-500/15 text-rose-400 border-rose-500/30' : `${border} ${sub}`}`}>
                {allSelected ? 'Deselect All' : 'Select All'}
              </button>
            )}
          </div>

          {/* Board */}
          <div className="px-3 mt-2 space-y-4">
            {loading ? (
              <div className="py-16 flex justify-center"><RefreshCw size={22} className="animate-spin text-[#7367f0]" /></div>
            ) : (
              <>
                {/* Overdue / Carry-forward section */}
                {dateFilter === 'today' && scopeOverdue.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2 px-1">
                      <AlertTriangle size={15} className="text-rose-400" />
                      <span className={`text-xs font-black uppercase tracking-wider text-rose-400`}>Overdue / Carry-Forward</span>
                      <span className="text-[10px] font-bold px-1.5 rounded-full bg-rose-500/15 text-rose-400">{scopeOverdue.length}</span>
                    </div>
                    <div className="space-y-2.5">
                      {scopeOverdue.map(t => (
                        <TaskCard key={t.id} t={t} isDark={isDark} isManager={isManager} busy={busy === t.id}
                          selected={selIds.has(t.id)} onToggleSelect={() => toggleSelect(t.id)}
                          daysOverdue={daysOverdue(t.task_date)}
                          onToggle={() => toggleDone(t)} onStart={() => setTaskState(t, 'in_progress')} onDelete={() => removeTask(t)} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Regular columns */}
                {scopeTasks.length === 0 && scopeOverdue.length === 0 ? (
                  <div className={`py-16 text-center text-sm ${sub}`}>No tasks {dateFilter === 'today' ? 'for today' : 'yet'}. {isManager ? 'Tap + to assign one.' : 'Enjoy your day!'}</div>
                ) : COLUMNS.map(col => {
                  const colTasks = scopeTasks.filter(t => t.state === col.key);
                  if (colTasks.length === 0) return null;
                  return (
                    <div key={col.key}>
                      <div className="flex items-center gap-2 mb-2 px-1">
                        <col.icon size={15} className={col.tint} />
                        <span className={`text-xs font-black uppercase tracking-wider ${txt}`}>{col.label}</span>
                        <span className={`text-[10px] font-bold px-1.5 rounded-full ${isDark ? 'bg-[#2a3250] text-[#5a6a8a]' : 'bg-gray-100 text-gray-500'}`}>{colTasks.length}</span>
                      </div>
                      <div className="space-y-2.5">
                        {colTasks.map(t => (
                          <TaskCard key={t.id} t={t} isDark={isDark} isManager={isManager} busy={busy === t.id}
                            selected={selIds.has(t.id)} onToggleSelect={() => toggleSelect(t.id)}
                            onToggle={() => toggleDone(t)} onStart={() => setTaskState(t, 'in_progress')} onDelete={() => removeTask(t)} />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </>
      ) : view === 'leaderboard' ? (
        <Leaderboard leaders={leaders} behind={behind} isDark={isDark} meUid={uid} />
      ) : (
        <MonthlyReport leaders={monthlyLeaders} month={monthFilter} isDark={isDark} meUid={uid}
          onPrev={() => setMonthFilter(m => prevMonth(m))}
          onNext={() => setMonthFilter(m => nextMonth(m))} />
      )}

      <BulkDeleteBar model="robifel.task" label="task" ids={Array.from(selIds)}
        onClear={() => setSelIds(new Set())} onDeleted={() => { setSelIds(new Set()); loadTasks(); }} />

      <button onClick={() => setCreateOpen(true)} className="fixed bottom-6 right-6 z-40 h-13 px-5 py-3.5 rounded-2xl shadow-xl flex items-center gap-2 text-white font-bold text-sm" style={{ background: 'linear-gradient(135deg, #7367f0, #3d5af1)' }}>
        <Plus size={17} /> New Task
      </button>

      {createOpen && (
        <CreateTask isDark={isDark} isManager={isManager} users={users} meUid={uid}
          onClose={() => setCreateOpen(false)}
          onSaved={() => { setCreateOpen(false); loadTasks(); showMsg(true, 'Task created.'); }}
          onError={m => showMsg(false, m)} />
      )}
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="flex-1 rounded-2xl bg-white/15 backdrop-blur px-3 py-2">
      <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-white/75">{icon} {label}</div>
      <p className="text-lg font-black mt-0.5">{value}</p>
    </div>
  );
}

// ── Task card ────────────────────────────────────────────────────────────────
function TaskCard({ t, isDark, isManager, busy, selected, onToggleSelect, onToggle, onStart, onDelete, daysOverdue: overdueDays }: {
  t: Task; isDark: boolean; isManager: boolean; busy: boolean;
  selected?: boolean; onToggleSelect?: () => void;
  onToggle: () => void; onStart: () => void; onDelete: () => void;
  daysOverdue?: number;
}) {
  const txt = isDark ? 'text-white' : 'text-gray-900';
  const sub = isDark ? 'text-[#5a6a8a]' : 'text-gray-400';
  const cardBg = isDark ? 'bg-[#161b2e]' : 'bg-white';
  const border = isDark ? 'border-[#2a3250]' : 'border-gray-200';
  const cat = catMeta(t.category); const prio = prioMeta(t.priority);
  const done = t.state === 'done';
  const assignee = Array.isArray(t.assignee_id) ? t.assignee_id[1] : '';
  const isOverdue = typeof overdueDays === 'number' && overdueDays > 0;

  return (
    <div className={`relative flex gap-2.5 p-3 rounded-2xl border ${isOverdue ? 'border-rose-500/40' : border} ${cardBg} ${done ? 'opacity-70' : ''} overflow-hidden`}>
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${isOverdue ? 'bg-rose-500' : prio.bar}`} />
      <button onClick={onToggle} disabled={busy} className="flex-shrink-0 mt-0.5">
        {busy ? <RefreshCw size={20} className="animate-spin text-[#7367f0]" /> : done
          ? <CheckCircle2 size={22} className="text-emerald-500" />
          : <Circle size={22} className={isOverdue ? 'text-rose-400' : sub} />}
      </button>
      <div className="min-w-0 flex-1">
        <p className={`font-bold text-sm leading-snug ${done ? `line-through ${sub}` : txt}`}>{t.name}</p>
        {t.description && <p className={`text-xs mt-0.5 line-clamp-2 ${sub}`}>{t.description}</p>}
        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
          <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${cat.cls}`}>{cat.label}</span>
          {isOverdue ? (
            <span className="text-[10px] font-bold text-rose-400 flex items-center gap-0.5"><AlertTriangle size={10} /> {overdueDays}d overdue</span>
          ) : (
            <span className={`text-[10px] font-bold ${prio.dot}`}>{prio.label}</span>
          )}
          <span className={`text-[10px] font-semibold ${sub}`}>+{t.points} pts</span>
          {t.deadline && <span className={`text-[10px] flex items-center gap-0.5 ${sub}`}><Clock size={10} /> {String(t.deadline).slice(11, 16)}</span>}
          {isOverdue && <span className={`text-[10px] ${sub}`}>{t.task_date}</span>}
          {isManager && assignee && (
            <span className={`ml-auto flex items-center gap-1 text-[10px] font-semibold ${sub}`}>
              <span className="w-4 h-4 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 text-white text-[8px] font-black flex items-center justify-center">{initials(assignee)}</span>
              {assignee.split(' ')[0]}
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-1.5 flex-shrink-0">
        {onToggleSelect && (
          <input type="checkbox" className="rounded" checked={!!selected} onChange={onToggleSelect} title="Select" />
        )}
        {!done && t.state === 'todo' && <button onClick={onStart} title="Start" className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-white/5' : 'hover:bg-gray-100'} text-amber-400`}><Play size={13} /></button>}
        {isManager && <button onClick={onDelete} title="Delete" className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-white/5' : 'hover:bg-gray-100'} text-rose-400`}><Trash2 size={13} /></button>}
      </div>
    </div>
  );
}

// ── Leaderboard ──────────────────────────────────────────────────────────────
function Leaderboard({ leaders, behind, isDark, meUid }: { leaders: LeaderRow[]; behind: BehindRow[]; isDark: boolean; meUid: number }) {
  const txt = isDark ? 'text-white' : 'text-gray-900';
  const sub = isDark ? 'text-[#5a6a8a]' : 'text-gray-400';
  const cardBg = isDark ? 'bg-[#161b2e]' : 'bg-white';
  const border = isDark ? 'border-[#2a3250]' : 'border-gray-200';
  const medals = ['text-amber-400', 'text-gray-300', 'text-orange-400'];

  return (
    <div className="px-3 mt-3 space-y-4">
      {/* All-time podium */}
      {leaders.length === 0 ? (
        <div className={`py-8 text-center text-sm ${sub}`}>No completed tasks yet — be the first on the board!</div>
      ) : (
        <>
          <p className={`text-[10px] font-black uppercase tracking-wider ${sub} px-1`}>All-Time Leaderboard</p>
          <div className="grid grid-cols-3 gap-2 items-end">
            {[1, 0, 2].map(rank => {
              const l = leaders[rank]; if (!l) return <div key={rank} />;
              const h = rank === 0 ? 'h-28' : rank === 1 ? 'h-24' : 'h-20';
              return (
                <div key={l.uid} className={`rounded-2xl border ${border} ${cardBg} p-3 flex flex-col items-center justify-end ${h}`}>
                  <Medal size={20} className={medals[rank]} />
                  <div className={`w-9 h-9 rounded-full bg-gradient-to-br ${AVATAR_GRADIENTS[l.uid % AVATAR_GRADIENTS.length]} flex items-center justify-center my-1`}><span className="text-white text-[11px] font-black">{initials(l.name)}</span></div>
                  <p className={`text-[11px] font-bold truncate w-full text-center ${txt}`}>{l.name.split(' ')[0]}</p>
                  <p className="text-[11px] font-black text-[#7367f0]">{l.points} pts</p>
                </div>
              );
            })}
          </div>
          {leaders.slice(3).map((l, i) => (
            <div key={l.uid} className={`flex items-center gap-3 p-3 rounded-2xl border ${border} ${cardBg} ${l.uid === meUid ? 'ring-2 ring-[#7367f0]/50' : ''}`}>
              <span className={`w-6 text-center font-black text-sm ${sub}`}>{i + 4}</span>
              <div className={`w-9 h-9 rounded-full bg-gradient-to-br ${AVATAR_GRADIENTS[l.uid % AVATAR_GRADIENTS.length]} flex items-center justify-center`}><span className="text-white text-[11px] font-black">{initials(l.name)}</span></div>
              <div className="flex-1 min-w-0"><p className={`font-bold text-sm truncate ${txt}`}>{l.name}</p><p className={`text-[11px] ${sub}`}>{l.done} tasks completed</p></div>
              <span className="font-black text-sm text-[#7367f0]">{l.points} pts</span>
            </div>
          ))}
        </>
      )}

      {/* Who's Behind */}
      {behind.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2 px-1">
            <Users size={14} className="text-rose-400" />
            <p className="text-[10px] font-black uppercase tracking-wider text-rose-400">Who's Behind</p>
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-rose-500/15 text-rose-400">{behind.length} members</span>
          </div>
          <div className="space-y-2">
            {behind.map(b => (
              <div key={b.uid} className={`flex items-center gap-3 p-3 rounded-2xl border ${border} ${cardBg} ${b.uid === meUid ? 'ring-2 ring-rose-500/30' : ''}`}>
                <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${AVATAR_GRADIENTS[b.uid % AVATAR_GRADIENTS.length]} flex items-center justify-center`}><span className="text-white text-[10px] font-black">{initials(b.name)}</span></div>
                <div className="flex-1 min-w-0"><p className={`font-bold text-sm truncate ${txt}`}>{b.name}</p></div>
                <span className="flex items-center gap-1 text-xs font-black text-rose-400"><AlertTriangle size={12} /> {b.count} pending</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Monthly Report ──────────────────────────────────────────────────────────
function MonthlyReport({ leaders, month, isDark, meUid, onPrev, onNext }: {
  leaders: LeaderRow[]; month: string; isDark: boolean; meUid: number;
  onPrev: () => void; onNext: () => void;
}) {
  const txt = isDark ? 'text-white' : 'text-gray-900';
  const sub = isDark ? 'text-[#5a6a8a]' : 'text-gray-400';
  const cardBg = isDark ? 'bg-[#161b2e]' : 'bg-white';
  const border = isDark ? 'border-[#2a3250]' : 'border-gray-200';
  const maxPts = leaders[0]?.points || 1;

  return (
    <div className="px-3 mt-3 space-y-3">
      {/* Month navigator */}
      <div className={`flex items-center justify-between p-3 rounded-2xl border ${border} ${cardBg}`}>
        <button onClick={onPrev} className={`p-2 rounded-xl ${isDark ? 'hover:bg-white/5' : 'hover:bg-gray-100'} ${sub}`}><ChevronLeft size={18} /></button>
        <div className="text-center">
          <p className={`font-black text-base ${txt}`}>{fmtMonth(month)}</p>
          {isCurrentMonth(month) && <p className="text-[10px] text-[#7367f0] font-bold">Current Month</p>}
        </div>
        <button onClick={onNext} disabled={isCurrentMonth(month)} className={`p-2 rounded-xl ${isDark ? 'hover:bg-white/5' : 'hover:bg-gray-100'} ${sub} disabled:opacity-30`}><ChevronRight size={18} /></button>
      </div>

      {/* Summary pill */}
      {leaders.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          <div className={`rounded-2xl p-3 text-center border ${border} ${cardBg}`}>
            <p className={`text-[10px] font-bold ${sub}`}>Top Scorer</p>
            <p className={`text-sm font-black mt-0.5 ${txt} truncate`}>{leaders[0].name.split(' ')[0]}</p>
          </div>
          <div className={`rounded-2xl p-3 text-center border ${border} ${cardBg}`}>
            <p className={`text-[10px] font-bold ${sub}`}>Total Points</p>
            <p className={`text-sm font-black mt-0.5 text-[#7367f0]`}>{leaders.reduce((s, l) => s + l.points, 0)}</p>
          </div>
          <div className={`rounded-2xl p-3 text-center border ${border} ${cardBg}`}>
            <p className={`text-[10px] font-bold ${sub}`}>Tasks Done</p>
            <p className={`text-sm font-black mt-0.5 text-emerald-400`}>{leaders.reduce((s, l) => s + l.done, 0)}</p>
          </div>
        </div>
      )}

      {/* Employee performance bars */}
      {leaders.length === 0 ? (
        <div className={`py-12 text-center text-sm ${sub}`}>No completed tasks in {fmtMonth(month)}.</div>
      ) : (
        <div className={`rounded-2xl border ${border} ${cardBg} overflow-hidden`}>
          <div className={`px-4 py-3 border-b ${border}`}>
            <p className={`text-xs font-black uppercase tracking-wider ${sub}`}>Performance Breakdown</p>
          </div>
          <div className="divide-y divide-[#2a3250]/50">
            {leaders.map((l, i) => (
              <div key={l.uid} className={`px-4 py-3 ${l.uid === meUid ? 'bg-[#7367f0]/5' : ''}`}>
                <div className="flex items-center gap-3 mb-2">
                  <span className={`text-xs font-black w-5 text-center ${i === 0 ? 'text-amber-400' : sub}`}>{i + 1}</span>
                  <div className={`w-7 h-7 rounded-full bg-gradient-to-br ${AVATAR_GRADIENTS[l.uid % AVATAR_GRADIENTS.length]} flex items-center justify-center`}><span className="text-white text-[9px] font-black">{initials(l.name)}</span></div>
                  <div className="flex-1 min-w-0"><p className={`text-sm font-bold truncate ${txt}`}>{l.name}</p></div>
                  <div className="text-right">
                    <p className="text-sm font-black text-[#7367f0]">{l.points} pts</p>
                    <p className={`text-[10px] ${sub}`}>{l.done} tasks</p>
                  </div>
                </div>
                <div className="ml-8">
                  <div className={`h-1.5 rounded-full ${isDark ? 'bg-[#2a3250]' : 'bg-gray-100'} overflow-hidden`}>
                    <div className="h-full rounded-full bg-gradient-to-r from-[#7367f0] to-[#3d5af1] transition-all" style={{ width: `${(l.points / maxPts) * 100}%` }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Create task sheet ────────────────────────────────────────────────────────
function CreateTask({ isDark, isManager, users, meUid, onClose, onSaved, onError }: {
  isDark: boolean; isManager: boolean; users: UserRef[]; meUid: number;
  onClose: () => void; onSaved: () => void; onError: (m: string) => void;
}) {
  const [f, setF] = useState<Record<string, any>>({ category: 'general', priority: '1', points: 10, task_date: today(), assignee_id: meUid });
  const [saving, setSaving] = useState(false);
  const field = `input text-sm py-2.5 w-full ${isDark ? 'bg-[#12172a] border-[#2a3250] text-white' : ''}`;
  const lbl = `text-[11px] font-semibold block mb-1 ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`;
  const border = isDark ? 'border-[#2a3250]' : 'border-gray-100';

  const save = async () => {
    if (!f.name?.trim()) { onError('Task name is required.'); return; }
    setSaving(true);
    try {
      await createRecord('robifel.task', {
        name: f.name.trim(),
        description: f.description || false,
        assignee_id: isManager ? (f.assignee_id || meUid) : meUid,
        category: f.category,
        priority: f.priority,
        points: parseInt(f.points) || 10,
        task_date: f.task_date,
        deadline: f.deadline ? `${f.task_date} ${f.deadline}:00` : false,
      });
      onSaved();
    } catch (e: any) { onError(e?.message || 'Create failed'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-[55] flex items-end sm:items-center sm:justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className={`w-full sm:max-w-lg max-h-[92vh] flex flex-col rounded-t-3xl sm:rounded-3xl ${isDark ? 'bg-[#161b2e]' : 'bg-white'} shadow-2xl animate-slide-up`} onClick={e => e.stopPropagation()}>
        <div className="pt-2.5 flex justify-center sm:hidden"><div className="w-10 h-1 rounded-full bg-gray-400/40" /></div>
        <div className={`px-5 py-4 flex items-center justify-between border-b ${border}`}>
          <h2 className={`font-black text-base ${isDark ? 'text-white' : 'text-gray-900'}`}>New Task</h2>
          <button onClick={onClose} className={`p-1.5 rounded-xl ${isDark ? 'hover:bg-white/5 text-[#5a6a8a]' : 'hover:bg-gray-100 text-gray-400'}`}><X size={18} /></button>
        </div>
        <div className="overflow-y-auto px-5 py-4 space-y-3">
          <div><label className={lbl}>Task *</label><input value={f.name || ''} onChange={e => setF(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Pack consignment 204528558" className={field} autoFocus /></div>
          <div><label className={lbl}>Details</label><textarea rows={2} value={f.description || ''} onChange={e => setF(p => ({ ...p, description: e.target.value }))} className={`${field} resize-none`} /></div>
          {isManager && (
            <div><label className={lbl}>Assign To</label>
              <select value={f.assignee_id} onChange={e => setF(p => ({ ...p, assignee_id: Number(e.target.value) }))} className={field}>
                {users.map(u => <option key={u.id} value={u.id}>{u.name}{u.id === meUid ? ' (me)' : ''}</option>)}
              </select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lbl}>Category</label>
              <select value={f.category} onChange={e => setF(p => ({ ...p, category: e.target.value }))} className={field}>
                {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </div>
            <div><label className={lbl}>Priority</label>
              <select value={f.priority} onChange={e => setF(p => ({ ...p, priority: e.target.value }))} className={field}>
                {PRIORITIES.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className={lbl}><CalendarDays size={11} className="inline mr-0.5" /> Date</label><input type="date" value={f.task_date} onChange={e => setF(p => ({ ...p, task_date: e.target.value }))} className={field} /></div>
            <div><label className={lbl}>Time</label><input type="time" value={f.deadline || ''} onChange={e => setF(p => ({ ...p, deadline: e.target.value }))} className={field} /></div>
            <div><label className={lbl}>Points</label><input type="number" min="0" value={f.points} onChange={e => setF(p => ({ ...p, points: e.target.value }))} className={field} /></div>
          </div>
        </div>
        <div className={`p-4 border-t ${border}`}>
          <button onClick={save} disabled={saving || !f.name?.trim()} className="w-full py-3 rounded-2xl text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50" style={{ background: 'linear-gradient(135deg, #7367f0, #3d5af1)' }}>
            {saving ? <RefreshCw size={16} className="animate-spin" /> : <Plus size={16} />} Create Task
          </button>
        </div>
      </div>
    </div>
  );
}
