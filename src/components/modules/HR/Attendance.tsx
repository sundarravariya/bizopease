import { useState, useEffect, useMemo, useCallback } from 'react';
import { searchRead, createRecord, writeRecord, odooCall, listStaffEmployees } from '../../../services/odoo';
import { useTheme } from '../../../context/ThemeContext';
import {
  RefreshCw, ChevronLeft, ChevronRight, CalendarDays, Clock,
  CheckCircle2, AlertCircle, MapPin, Camera, Users,
} from 'lucide-react';

interface Employee { id: number; name: string; job_title?: string | false; user_id?: [number, string] | false; }
interface DayRec {
  id: number; employee_id: [number, string]; date: string; status: string;
  ot_hours: number; check_in?: string | false; check_out?: string | false;
}

const STATUSES: { key: string; label: string; short: string; cls: string }[] = [
  { key: 'present', label: 'Present', short: 'P', cls: 'bg-emerald-500 text-white' },
  { key: 'half', label: 'Half Day', short: 'HD', cls: 'bg-amber-500 text-white' },
  { key: 'absent', label: 'Absent', short: 'A', cls: 'bg-rose-500 text-white' },
  { key: 'paid_leave', label: 'Paid Leave', short: 'PL', cls: 'bg-blue-500 text-white' },
  { key: 'week_off', label: 'Weekly Off', short: 'WO', cls: 'bg-gray-400 text-white' },
  { key: 'holiday', label: 'Holiday', short: 'H', cls: 'bg-violet-500 text-white' },
];
const statusMeta = (k: string) => STATUSES.find(s => s.key === k);

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function Attendance() {
  const { isDark } = useTheme();
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [tab, setTab] = useState<'today' | 'register'>('today');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [weeklyOff, setWeeklyOff] = useState(6);   // 0=Mon … 6=Sun (global)
  const [days, setDays] = useState<DayRec[]>([]);
  const [selEmp, setSelEmp] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);

  const txt = isDark ? 'text-white' : 'text-gray-900';
  const sub = isDark ? 'text-[#5a6a8a]' : 'text-gray-400';
  const card = isDark ? 'bg-[#161b2e] border-[#2a3250]' : 'bg-white border-gray-200';

  const showToast = (ok: boolean, msg: string) => { setToast({ ok, msg }); setTimeout(() => setToast(null), 2500); };

  const monthStart = useMemo(() => ymd(month), [month]);
  const monthEnd = useMemo(() => { const d = new Date(month.getFullYear(), month.getMonth() + 1, 0); return ymd(d); }, [month]);
  const today = ymd(new Date());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [emps, settings, dd] = await Promise.all([
        listStaffEmployees<Employee>(['id', 'name', 'job_title']),
        odooCall<{ weekly_off: string }>('robifel.hr.settings', 'get_settings', [], {}),
        searchRead<DayRec>('robifel.attendance.day', { fields: ['id', 'employee_id', 'date', 'status', 'ot_hours', 'check_in', 'check_out'], domain: [['date', '>=', monthStart], ['date', '<=', monthEnd]], limit: 0 }),
      ]);
      setEmployees(emps || []);
      setWeeklyOff(Number(settings?.weekly_off ?? '6'));
      setDays(dd || []);
      if (!selEmp && emps?.length) setSelEmp(emps[0].id);
    } catch (e: any) { showToast(false, e.message || 'Load failed'); }
    finally { setLoading(false); }
  }, [monthStart, monthEnd]); // eslint-disable-line

  useEffect(() => { load(); }, [load]);

  // weeklyOff is Python weekday (Mon=0..Sun=6); convert a JS Date for comparison.
  const isWeeklyOff = (d: Date) => ((d.getDay() + 6) % 7) === weeklyOff;
  const recOf = (empId: number, date: string) => days.find(d => d.employee_id?.[0] === empId && d.date === date);

  // Mark / change a day's status (create or update).
  const mark = async (empId: number, date: string, status: string) => {
    const key = `${empId}-${date}`;
    setBusy(key);
    try {
      const existing = recOf(empId, date);
      if (existing) {
        await writeRecord('robifel.attendance.day', [existing.id], { status, is_manual: true });
        setDays(ds => ds.map(d => d.id === existing.id ? { ...d, status } : d));
      } else {
        const id = await createRecord('robifel.attendance.day', { employee_id: empId, date, status, method: 'admin', is_manual: true });
        setDays(ds => [...ds, { id, employee_id: [empId, ''], date, status, ot_hours: 0 }]);
      }
    } catch (e: any) { showToast(false, e.message || 'Mark failed'); }
    finally { setBusy(null); }
  };

  const setOt = async (rec: DayRec, hours: number) => {
    try { await writeRecord('robifel.attendance.day', [rec.id], { ot_hours: hours }); setDays(ds => ds.map(d => d.id === rec.id ? { ...d, ot_hours: hours } : d)); }
    catch (e: any) { showToast(false, e.message || 'OT failed'); }
  };

  // ── Self punch (employee app): GPS + optional selfie ──────────────────
  const selfPunch = async (kind: 'in' | 'out') => {
    if (!selEmp) return;
    setBusy(`punch-${kind}`);
    try {
      let lat = 0, lng = 0;
      try {
        const pos: GeolocationPosition = await new Promise((res, rej) =>
          navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 8000 }));
        lat = pos.coords.latitude; lng = pos.coords.longitude;
      } catch { /* location optional */ }
      await odooCall('robifel.attendance.day', 'punch', [selEmp, kind, lat, lng, false], {});
      showToast(true, `Checked ${kind === 'in' ? 'in' : 'out'}${lat ? ' with location' : ''}`);
      load();
    } catch (e: any) { showToast(false, e.message || 'Punch failed'); }
    finally { setBusy(null); }
  };

  const monthDays = useMemo(() => {
    const n = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    return Array.from({ length: n }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1));
  }, [month]);

  const selEmpObj = employees.find(e => e.id === selEmp);

  // Per-employee month summary
  const summaryFor = (empId: number) => {
    let present = 0, half = 0, absent = 0, leave = 0;
    for (const d of monthDays) {
      const r = recOf(empId, ymd(d));
      const st = r?.status ?? (isWeeklyOff(d) ? 'week_off' : (ymd(d) <= today ? 'absent' : ''));
      if (st === 'present') present++; else if (st === 'half') half += 1; else if (st === 'absent') absent++; else if (st === 'paid_leave') leave++;
    }
    return { present, half, absent, leave };
  };

  return (
    <div className="max-w-5xl mx-auto pb-24 animate-fade-in">
      {toast && (
        <div className={`fixed top-5 left-1/2 -translate-x-1/2 z-[60] px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-2 text-sm font-medium ${toast.ok ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white'}`}>
          {toast.ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />} {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className={`text-xl font-black ${txt}`}>Attendance</h1>
          <p className={`text-xs mt-0.5 ${sub}`}>Digital muster — mark, edit and review</p>
        </div>
        <button onClick={load} className="btn-secondary text-xs px-3 py-2 flex items-center gap-1.5">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Sync
        </button>
      </div>

      {/* Month nav + tabs */}
      <div className={`card border ${card} p-3 mb-4 flex flex-col sm:flex-row sm:items-center gap-3`}>
        <div className="flex items-center gap-2">
          <button onClick={() => setMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1))} className="p-1.5 rounded-lg hover:bg-white/5"><ChevronLeft size={16} className={sub} /></button>
          <div className="flex items-center gap-1.5 min-w-[120px] justify-center">
            <CalendarDays size={15} className="text-[#7367f0]" />
            <span className={`text-sm font-bold ${txt}`}>{MONTHS[month.getMonth()]} {month.getFullYear()}</span>
          </div>
          <button onClick={() => setMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1))} className="p-1.5 rounded-lg hover:bg-white/5"><ChevronRight size={16} className={sub} /></button>
        </div>
        <div className={`flex p-1 rounded-xl sm:ml-auto ${isDark ? 'bg-[#1e2440]' : 'bg-gray-100'}`}>
          {([['today', 'Mark Today'], ['register', 'Register']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${tab === k ? 'bg-[#7367f0] text-white shadow' : sub}`}>{l}</button>
          ))}
        </div>
      </div>

      {/* ── MARK TODAY: all employees, quick chips ── */}
      {tab === 'today' && (
        <div className="space-y-2.5">
          <p className={`text-xs font-semibold ${sub} px-1`}>{WD[new Date().getDay()]}, {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · tap a status</p>
          {employees.map(emp => {
            const r = recOf(emp.id, today);
            const st = r?.status ?? '';
            return (
              <div key={emp.id} className={`card border ${card} p-3`}>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#7367f0] to-[#3d5af1] flex items-center justify-center text-white text-sm font-bold flex-shrink-0">{emp.name?.[0]?.toUpperCase()}</div>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-semibold truncate ${txt}`}>{emp.name}</p>
                    <p className={`text-[11px] ${sub} truncate`}>{emp.job_title || '—'}</p>
                  </div>
                  <div className="flex flex-wrap gap-1 justify-end">
                    {STATUSES.map(s => (
                      <button key={s.key} disabled={busy === `${emp.id}-${today}`}
                        onClick={() => mark(emp.id, today, s.key)}
                        className={`w-9 h-8 rounded-lg text-[11px] font-black transition-all ${st === s.key ? s.cls : isDark ? 'bg-[#1e2440] text-[#5a6a8a] hover:bg-[#252b4a]' : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}`}>
                        {s.short}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
          {!loading && employees.length === 0 && <p className={`text-center text-sm py-10 ${sub}`}>No employees yet. Create accounts in HR → Employees.</p>}
        </div>
      )}

      {/* ── REGISTER: per-employee month grid ── */}
      {tab === 'register' && (
        <div className="space-y-4">
          {/* Employee selector */}
          <div className="flex gap-2 overflow-x-auto pb-1">
            {employees.map(emp => (
              <button key={emp.id} onClick={() => setSelEmp(emp.id)}
                className={`px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${selEmp === emp.id ? 'bg-[#7367f0] text-white' : isDark ? 'bg-[#161b2e] text-[#8897b5] border border-[#2a3250]' : 'bg-white text-gray-500 border border-gray-200'}`}>
                {emp.name}
              </button>
            ))}
          </div>

          {selEmpObj && (() => {
            const s = summaryFor(selEmpObj.id);
            return (
              <>
                {/* Self-punch (works for the logged-in employee or admin demo) */}
                <div className={`card border ${card} p-3 flex items-center gap-2`}>
                  <Clock size={15} className="text-[#7367f0]" />
                  <span className={`text-xs font-semibold ${txt} flex-1`}>Self check-in/out (captures GPS)</span>
                  <button onClick={() => selfPunch('in')} disabled={busy === 'punch-in'} className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1 text-emerald-500"><MapPin size={12} /> Check In</button>
                  <button onClick={() => selfPunch('out')} disabled={busy === 'punch-out'} className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1 text-rose-500"><MapPin size={12} /> Check Out</button>
                </div>

                {/* Summary chips */}
                <div className="grid grid-cols-4 gap-2">
                  {[['Present', s.present, 'text-emerald-500'], ['Half', s.half, 'text-amber-500'], ['Leave', s.leave, 'text-blue-500'], ['Absent', s.absent, 'text-rose-500']].map(([l, v, c]) => (
                    <div key={l as string} className={`card border ${card} p-2.5 text-center`}>
                      <p className={`text-lg font-black ${c}`}>{v as number}</p>
                      <p className={`text-[10px] font-semibold ${sub}`}>{l as string}</p>
                    </div>
                  ))}
                </div>

                {/* Day rows */}
                <div className={`card border ${card} overflow-hidden`}>
                  <div className={`grid grid-cols-[auto_1fr_auto] gap-2 px-3 py-2 text-[10px] font-bold uppercase tracking-wider ${sub} border-b ${isDark ? 'border-[#2a3250]' : 'border-gray-100'}`}>
                    <span className="w-16">Date</span><span>Status</span><span>OT</span>
                  </div>
                  <div className="divide-y" style={{ borderColor: isDark ? '#2a3250' : '#f3f4f6' }}>
                    {monthDays.map(d => {
                      const ds = ymd(d);
                      const r = recOf(selEmpObj.id, ds);
                      const defStatus = isWeeklyOff(d) ? 'week_off' : (ds <= today ? 'absent' : '');
                      const st = r?.status ?? defStatus;
                      const meta = statusMeta(st);
                      const isToday = ds === today;
                      return (
                        <div key={ds} className={`grid grid-cols-[auto_1fr_auto] gap-2 px-3 py-2 items-center ${isToday ? (isDark ? 'bg-[#7367f0]/10' : 'bg-violet-50') : ''}`}>
                          <div className="w-16">
                            <p className={`text-xs font-bold ${txt}`}>{WD[d.getDay()]} {pad(d.getDate())}</p>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {STATUSES.map(sx => (
                              <button key={sx.key} disabled={busy === `${selEmpObj.id}-${ds}`}
                                onClick={() => mark(selEmpObj.id, ds, sx.key)}
                                className={`px-2 h-7 rounded-md text-[10px] font-black transition-all ${st === sx.key ? sx.cls : isDark ? 'bg-[#1e2440] text-[#5a6a8a]' : 'bg-gray-100 text-gray-400'}`}>
                                {sx.short}
                              </button>
                            ))}
                          </div>
                          <div className="w-14">
                            {r && (
                              <input type="number" min={0} step={0.5} value={r.ot_hours || ''} placeholder="0"
                                onChange={e => setOt(r, Number(e.target.value))}
                                className={`w-full text-xs text-center rounded-md px-1 py-1 outline-none ${isDark ? 'bg-[#1e2440] text-white border border-[#2a3250]' : 'bg-gray-50 text-gray-900 border border-gray-200'}`} />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <p className={`text-[11px] ${sub} px-1`}>Weekly off auto-applies on {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][weeklyOff]}. Unmarked past days count as Absent in salary.</p>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}
