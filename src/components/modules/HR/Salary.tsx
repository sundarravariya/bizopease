import { useState, useEffect, useMemo, useCallback } from 'react';
import { searchRead, createRecord, writeRecord, odooCall, readRecord, listStaffEmployees } from '../../../services/odoo';
import { useTheme } from '../../../context/ThemeContext';
import {
  RefreshCw, ChevronLeft, ChevronRight, Wallet, IndianRupee,
  CheckCircle2, AlertCircle, Calculator, BadgeCheck, Settings2,
} from 'lucide-react';

interface Employee { id: number; name: string; job_title?: string | false; }
interface Cfg { id: number; employee_id: [number, string]; monthly_wage: number; per_day_basis: string; weekly_off: string; ot_hourly_rate: number; }
interface Period {
  id: number; monthly_wage: number; per_day_rate: number; days_in_month: number;
  present_days: number; half_days: number; paid_leave_days: number; week_off_days: number;
  holiday_days: number; absent_days: number; forfeited_offs: number; payable_days: number;
  ot_hours: number; ot_amount: number; advance_deduction: number; fine_deduction: number;
  bonus_addition: number; gross_pay: number; net_pay: number; state: string; paid_on?: string | false;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');
const inr = (n: number) => '₹' + (n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const PERIOD_FIELDS = ['id', 'monthly_wage', 'per_day_rate', 'days_in_month', 'present_days', 'half_days', 'paid_leave_days', 'week_off_days', 'holiday_days', 'absent_days', 'forfeited_offs', 'payable_days', 'ot_hours', 'ot_amount', 'advance_deduction', 'fine_deduction', 'bonus_addition', 'gross_pay', 'net_pay', 'state', 'paid_on'];

export default function Salary() {
  const { isDark } = useTheme();
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [configs, setConfigs] = useState<Cfg[]>([]);
  const [selEmp, setSelEmp] = useState<number | null>(null);
  const [period, setPeriod] = useState<Period | null>(null);
  const [loading, setLoading] = useState(true);
  const [calc, setCalc] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);
  const [cfgEdit, setCfgEdit] = useState(false);
  const [wage, setWage] = useState('');

  const txt = isDark ? 'text-white' : 'text-gray-900';
  const sub = isDark ? 'text-[#5a6a8a]' : 'text-gray-400';
  const card = isDark ? 'bg-[#161b2e] border-[#2a3250]' : 'bg-white border-gray-200';
  const inp = `text-sm rounded-lg px-2.5 py-1.5 outline-none ${isDark ? 'bg-[#1e2440] text-white border border-[#2a3250]' : 'bg-gray-50 text-gray-900 border border-gray-200'}`;

  const showToast = (ok: boolean, msg: string) => { setToast({ ok, msg }); setTimeout(() => setToast(null), 2500); };
  const periodStart = useMemo(() => `${month.getFullYear()}-${pad(month.getMonth() + 1)}-01`, [month]);
  const cfgOf = (empId: number) => configs.find(c => c.employee_id?.[0] === empId);

  const loadBase = useCallback(async () => {
    setLoading(true);
    try {
      const [emps, cfgs] = await Promise.all([
        listStaffEmployees<Employee>(['id', 'name', 'job_title']),
        searchRead<Cfg>('robifel.salary.config', { fields: ['id', 'employee_id', 'monthly_wage', 'per_day_basis', 'weekly_off', 'ot_hourly_rate'], limit: 0 }),
      ]);
      setEmployees(emps || []); setConfigs(cfgs || []);
      if (!selEmp && emps?.length) setSelEmp(emps[0].id);
    } catch (e: any) { showToast(false, e.message || 'Load failed'); }
    finally { setLoading(false); }
  }, []); // eslint-disable-line

  useEffect(() => { loadBase(); }, [loadBase]);

  // Compute (or fetch) the salary period for the selected employee + month.
  const computeSalary = useCallback(async () => {
    if (!selEmp) return;
    setCalc(true); setPeriod(null);
    try {
      const pid: number = await odooCall('robifel.salary.period', 'get_or_create_period', [selEmp, periodStart], {});
      const recs = await readRecord<Period>('robifel.salary.period', [pid], PERIOD_FIELDS);
      setPeriod(recs?.[0] || null);
    } catch (e: any) { showToast(false, e.message || 'Calc failed'); }
    finally { setCalc(false); }
  }, [selEmp, periodStart]);

  useEffect(() => { if (selEmp) computeSalary(); }, [selEmp, periodStart]); // eslint-disable-line

  const saveAdjust = async (field: 'advance_deduction' | 'fine_deduction' | 'bonus_addition', value: number) => {
    if (!period) return;
    try {
      await writeRecord('robifel.salary.period', [period.id], { [field]: value });
      await odooCall('robifel.salary.period', 'compute_salary', [[period.id]], {});
      const recs = await readRecord<Period>('robifel.salary.period', [period.id], PERIOD_FIELDS);
      setPeriod(recs?.[0] || null);
    } catch (e: any) { showToast(false, e.message || 'Save failed'); }
  };

  const markPaid = async () => {
    if (!period) return;
    try { await odooCall('robifel.salary.period', 'action_mark_paid', [[period.id]], {}); showToast(true, 'Marked paid'); computeSalary(); }
    catch (e: any) { showToast(false, e.message || 'Failed'); }
  };

  const saveConfig = async () => {
    if (!selEmp) return;
    const monthly_wage = Number(wage) || 0;
    try {
      const existing = cfgOf(selEmp);
      if (existing) await writeRecord('robifel.salary.config', [existing.id], { monthly_wage });
      else await createRecord('robifel.salary.config', { employee_id: selEmp, monthly_wage, per_day_basis: '30', weekly_off: '6' });
      showToast(true, 'Wage saved'); setCfgEdit(false);
      await loadBase(); computeSalary();
    } catch (e: any) { showToast(false, e.message || 'Save failed'); }
  };

  const selEmpObj = employees.find(e => e.id === selEmp);
  const cfg = selEmp ? cfgOf(selEmp) : undefined;

  return (
    <div className="max-w-3xl mx-auto pb-24 animate-fade-in">
      {toast && (
        <div className={`fixed top-5 left-1/2 -translate-x-1/2 z-[60] px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-2 text-sm font-medium ${toast.ok ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white'}`}>
          {toast.ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />} {toast.msg}
        </div>
      )}

      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className={`text-xl font-black ${txt}`}>Salary</h1>
          <p className={`text-xs mt-0.5 ${sub}`}>Monthly payroll · ÷30 basis · weekly-off sandwich rule</p>
        </div>
        <button onClick={() => { loadBase(); computeSalary(); }} className="btn-secondary text-xs px-3 py-2 flex items-center gap-1.5">
          <RefreshCw size={13} className={loading || calc ? 'animate-spin' : ''} /> Sync
        </button>
      </div>

      {/* Month nav */}
      <div className={`card border ${card} p-3 mb-4 flex items-center gap-2`}>
        <button onClick={() => setMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1))} className="p-1.5 rounded-lg hover:bg-white/5"><ChevronLeft size={16} className={sub} /></button>
        <span className={`text-sm font-bold ${txt} min-w-[110px] text-center`}>{MONTHS[month.getMonth()]} {month.getFullYear()}</span>
        <button onClick={() => setMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1))} className="p-1.5 rounded-lg hover:bg-white/5"><ChevronRight size={16} className={sub} /></button>
      </div>

      {/* Employee selector */}
      <div className="flex gap-2 overflow-x-auto pb-1 mb-4">
        {employees.map(emp => (
          <button key={emp.id} onClick={() => setSelEmp(emp.id)}
            className={`px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${selEmp === emp.id ? 'bg-[#7367f0] text-white' : isDark ? 'bg-[#161b2e] text-[#8897b5] border border-[#2a3250]' : 'bg-white text-gray-500 border border-gray-200'}`}>
            {emp.name}
          </button>
        ))}
      </div>

      {selEmpObj && (
        <>
          {/* Wage config */}
          <div className={`card border ${card} p-3 mb-4 flex items-center gap-3`}>
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#7367f0] to-[#3d5af1] flex items-center justify-center text-white text-sm font-bold">{selEmpObj.name?.[0]?.toUpperCase()}</div>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-bold truncate ${txt}`}>{selEmpObj.name}</p>
              <p className={`text-[11px] ${sub}`}>Monthly wage: <span className="font-semibold">{cfg ? inr(cfg.monthly_wage) : 'not set'}</span> · ÷30</p>
            </div>
            {cfgEdit ? (
              <div className="flex items-center gap-1.5">
                <input autoFocus type="number" value={wage} onChange={e => setWage(e.target.value)} placeholder="Monthly ₹" className={`${inp} w-28`} />
                <button onClick={saveConfig} className="btn-primary text-xs px-3 py-1.5">Save</button>
              </div>
            ) : (
              <button onClick={() => { setWage(String(cfg?.monthly_wage || '')); setCfgEdit(true); }} className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1"><Settings2 size={12} /> Wage</button>
            )}
          </div>

          {/* Salary breakdown */}
          {calc ? (
            <div className="py-16 flex justify-center"><RefreshCw size={22} className="animate-spin text-[#7367f0]" /></div>
          ) : period ? (
            <div className={`card border ${card} overflow-hidden`}>
              {/* Net hero */}
              <div className="p-4 text-white" style={{ background: 'linear-gradient(135deg, #7367f0 0%, #4f46e5 55%, #3d5af1 100%)' }}>
                <div className="flex items-center justify-between">
                  <span className="text-white/80 text-xs font-semibold flex items-center gap-1.5"><Wallet size={14} /> Net Payable</span>
                  {period.state === 'paid'
                    ? <span className="text-[11px] font-bold bg-emerald-500/90 px-2 py-0.5 rounded-full flex items-center gap-1"><BadgeCheck size={12} /> Paid</span>
                    : <span className="text-[11px] font-bold bg-white/20 px-2 py-0.5 rounded-full">Draft</span>}
                </div>
                <p className="text-3xl font-black mt-1">{inr(period.net_pay)}</p>
                <p className="text-white/70 text-[11px] mt-1">{period.payable_days} payable days × {inr(period.per_day_rate)}/day</p>
              </div>

              {/* Day tallies */}
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-px bg-gray-200/10 text-center">
                {[['Present', period.present_days], ['Half', period.half_days], ['Leave', period.paid_leave_days], ['Wk Off', period.week_off_days], ['Holiday', period.holiday_days], ['Absent', period.absent_days]].map(([l, v]) => (
                  <div key={l as string} className={`py-2.5 ${isDark ? 'bg-[#161b2e]' : 'bg-white'}`}>
                    <p className={`text-base font-black ${txt}`}>{v as number}</p>
                    <p className={`text-[9px] font-semibold uppercase ${sub}`}>{l as string}</p>
                  </div>
                ))}
              </div>

              {/* Breakdown rows */}
              <div className="p-4 space-y-2.5">
                {period.forfeited_offs > 0 && (
                  <div className="flex items-center gap-2 text-[11px] text-amber-500 bg-amber-500/10 rounded-lg px-2.5 py-1.5">
                    <AlertCircle size={13} /> Sandwich rule: {period.forfeited_offs} weekly-off day(s) forfeited (absence next to weekly-off).
                  </div>
                )}
                <Row label="Gross pay" value={inr(period.gross_pay)} txt={txt} sub={sub} />
                {period.ot_amount > 0 && <Row label={`Overtime (${period.ot_hours}h)`} value={'+ ' + inr(period.ot_amount)} txt={txt} sub={sub} green />}

                <AdjustRow label="Bonus" sign="+" value={period.bonus_addition} inp={inp} onSave={v => saveAdjust('bonus_addition', v)} sub={sub} txt={txt} />
                <AdjustRow label="Advance / Loan" sign="−" value={period.advance_deduction} inp={inp} onSave={v => saveAdjust('advance_deduction', v)} sub={sub} txt={txt} />
                <AdjustRow label="Fine" sign="−" value={period.fine_deduction} inp={inp} onSave={v => saveAdjust('fine_deduction', v)} sub={sub} txt={txt} />

                <div className={`flex items-center justify-between pt-2.5 border-t ${isDark ? 'border-[#2a3250]' : 'border-gray-100'}`}>
                  <span className={`text-sm font-black ${txt}`}>Net Payable</span>
                  <span className="text-lg font-black text-[#7367f0]">{inr(period.net_pay)}</span>
                </div>

                {period.state !== 'paid' && (
                  <button onClick={markPaid} className="btn-primary w-full justify-center py-2.5 mt-1 flex items-center gap-2"><IndianRupee size={15} /> Mark as Paid</button>
                )}
                {period.state === 'paid' && period.paid_on && (
                  <p className={`text-center text-[11px] ${sub}`}>Paid on {period.paid_on}</p>
                )}
              </div>
            </div>
          ) : (
            <div className={`card border ${card} p-8 text-center`}>
              <Calculator size={28} className={`mx-auto mb-2 ${sub}`} />
              <p className={`text-sm ${sub}`}>Select an employee to compute salary.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Row({ label, value, txt, sub, green }: { label: string; value: string; txt: string; sub: string; green?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={`text-sm ${sub}`}>{label}</span>
      <span className={`text-sm font-semibold ${green ? 'text-emerald-500' : txt}`}>{value}</span>
    </div>
  );
}

function AdjustRow({ label, sign, value, inp, onSave, sub, txt }: { label: string; sign: string; value: number; inp: string; onSave: (v: number) => void; sub: string; txt: string }) {
  const [v, setV] = useState(String(value || ''));
  useEffect(() => { setV(String(value || '')); }, [value]);
  return (
    <div className="flex items-center justify-between gap-2">
      <span className={`text-sm ${sub}`}>{sign} {label}</span>
      <input type="number" value={v} onChange={e => setV(e.target.value)} onBlur={() => onSave(Number(v) || 0)}
        placeholder="0" className={`${inp} w-28 text-right`} />
    </div>
  );
}
