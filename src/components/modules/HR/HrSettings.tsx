import { useState, useEffect } from 'react';
import { useTheme } from '../../../context/ThemeContext';
import { odooCall, listStaffEmployees } from '../../../services/odoo';
import { scanNfc, nfcStatus, cancelNfc } from '../../../services/native';
import {
  Clock, CheckCircle2, RefreshCw, Nfc, MapPin, Trash2, AlertCircle, CalendarOff,
  CreditCard, Users, Check,
} from 'lucide-react';

interface Emp { id: number; name: string; robifel_nfc_badge?: string | false; }

const DAYS = [['0', 'Monday'], ['1', 'Tuesday'], ['2', 'Wednesday'], ['3', 'Thursday'], ['4', 'Friday'], ['5', 'Saturday'], ['6', 'Sunday']];

export default function HrSettings() {
  const { isDark } = useTheme();
  const [start, setStart] = useState('10:00');
  const [end, setEnd] = useState('19:00');
  const [enforce, setEnforce] = useState(true);
  const [weeklyOff, setWeeklyOff] = useState('6');
  const [mode, setMode] = useState<'gps_selfie' | 'nfc'>('gps_selfie');
  const [tags, setTags] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [nfcMsg, setNfcMsg] = useState<string | null>(null);
  const [kioskEnabled, setKioskEnabled] = useState(true);
  const [emps, setEmps] = useState<Emp[]>([]);
  const [badgeBusy, setBadgeBusy] = useState<number | null>(null);
  const [badgeMsg, setBadgeMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const txt = isDark ? 'text-white' : 'text-gray-900';
  const sub = isDark ? 'text-[#5a6a8a]' : 'text-gray-500';
  const card = isDark ? 'bg-[#161b2e] border-[#2a3250]' : 'bg-white border-gray-200';
  const inp = `input text-sm ${isDark ? 'bg-[#111827] border-white/10 text-white' : ''}`;
  const parseTags = (s: string) => (s || '').split(',').map(t => t.trim().toUpperCase()).filter(Boolean);

  const loadEmps = () => listStaffEmployees<Emp>(['id', 'name', 'robifel_nfc_badge']).then(setEmps).catch(() => {});

  useEffect(() => {
    odooCall<any>('robifel.hr.settings', 'get_settings', [], {})
      .then(s => { if (s) { setStart(s.work_start || '10:00'); setEnd(s.work_end || '19:00'); setEnforce(!!s.enforce_work_hours); setWeeklyOff(s.weekly_off || '6'); setMode(s.attendance_mode || 'gps_selfie'); setTags(parseTags(s.nfc_tag_ids)); setKioskEnabled(s.kiosk_enabled !== false); } })
      .catch(() => {})
      .finally(() => setLoading(false));
    loadEmps();
  }, []);

  const save = async () => {
    setSaving(true); setSaved(false);
    try {
      await odooCall('robifel.hr.settings', 'save_settings', [{ work_start: start, work_end: end, enforce_work_hours: enforce, weekly_off: weeklyOff, attendance_mode: mode, nfc_tag_ids: tags.join(','), kiosk_enabled: kioskEnabled }], {});
      setSaved(true); setTimeout(() => setSaved(false), 2500);
    } catch { /* ignore */ } finally { setSaving(false); }
  };

  const assignBadge = async (empId: number) => {
    setBadgeMsg(null);
    const st = await nfcStatus();
    if (!st.available) { setBadgeMsg('This device has no NFC. Assign badges from an NFC-capable phone.'); return; }
    if (!st.enabled) { setBadgeMsg('NFC is off. Turn it on and retry.'); return; }
    setBadgeBusy(empId);
    try {
      const uid = await scanNfc();
      const res = await odooCall<any>('hr.employee', 'register_badge', [empId, uid], {});
      if (res?.ok) { setBadgeMsg('Badge assigned ✓'); await loadEmps(); }
      else setBadgeMsg(res?.error || 'Could not assign.');
    } catch (e: any) { setBadgeMsg(e?.message || 'Scan cancelled.'); }
    finally { setBadgeBusy(null); }
  };

  const clearBadge = async (empId: number) => {
    setBadgeBusy(empId);
    try { await odooCall('hr.employee', 'clear_badge', [empId], {}); await loadEmps(); }
    catch { /* ignore */ } finally { setBadgeBusy(null); }
  };

  const registerTag = async () => {
    setNfcMsg(null);
    const st = await nfcStatus();
    if (!st.available) { setNfcMsg('This device has no NFC. Register the tag from an NFC-capable phone.'); return; }
    if (!st.enabled) { setNfcMsg('NFC is off. Turn on NFC in your phone settings and retry.'); return; }
    setScanning(true);
    try {
      const uid = await scanNfc();
      if (uid) {
        const res = await odooCall<any>('robifel.hr.settings', 'register_nfc_tag', [uid], {});
        setTags(parseTags(res?.nfc_tag_ids));
        setNfcMsg(`Tag ${uid} registered ✓`);
      }
    } catch (e: any) { setNfcMsg(e?.message || 'Scan failed or cancelled.'); }
    finally { setScanning(false); }
  };

  const removeTag = (uid: string) => setTags(ts => ts.filter(t => t !== uid));

  return (
    <div className="max-w-2xl mx-auto pb-24 animate-fade-in">
      <div className="mb-4">
        <h1 className={`text-xl font-black ${txt}`}>HR Settings</h1>
        <p className={`text-xs mt-0.5 ${sub}`}>Work hours, weekly off, and how employees mark attendance</p>
      </div>

      <div className={`card border ${card} p-5 rounded-2xl space-y-5`}>
        {loading ? (
          <div className="py-8 flex justify-center"><RefreshCw size={20} className="animate-spin text-[#7367f0]" /></div>
        ) : (
          <>
            {/* Work hours */}
            <div className="space-y-3">
              <h3 className={`font-bold text-sm flex items-center gap-2 ${txt}`}><Clock size={15} className="text-[#7367f0]" /> Work Hours</h3>
              <p className={`text-xs ${sub}`}>Employees can use the app only inside this window and after checking in. Admins are never restricted.</p>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="label">Work Start</label><input type="time" value={start} onChange={e => setStart(e.target.value)} className={inp} /></div>
                <div><label className="label">Work End</label><input type="time" value={end} onChange={e => setEnd(e.target.value)} className={inp} /></div>
              </div>
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={enforce} onChange={e => setEnforce(e.target.checked)} className="w-4 h-4 rounded text-brand-violet" />
                <span className={`text-xs ${sub}`}>Enforce work-hours lockout for employees</span>
              </label>
            </div>

            {/* Weekly off */}
            <div className={`border-t pt-4 space-y-2 ${isDark ? 'border-[#2a3250]' : 'border-gray-100'}`}>
              <h3 className={`font-bold text-sm flex items-center gap-2 ${txt}`}><CalendarOff size={15} className="text-[#7367f0]" /> Weekly Off</h3>
              <select value={weeklyOff} onChange={e => setWeeklyOff(e.target.value)} className={inp}>
                {DAYS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <p className={`text-[11px] ${sub}`}>Employees are locked out and salary treats this day as a paid weekly-off.</p>
            </div>

            {/* Attendance method */}
            <div className={`border-t pt-4 space-y-3 ${isDark ? 'border-[#2a3250]' : 'border-gray-100'}`}>
              <h3 className={`font-bold text-sm flex items-center gap-2 ${txt}`}><MapPin size={15} className="text-[#7367f0]" /> Attendance Method</h3>
              <div className="grid grid-cols-2 gap-3">
                {([['gps_selfie', 'GPS + Selfie', MapPin], ['nfc', 'NFC Tag Scan', Nfc]] as const).map(([val, lbl, Icon]) => (
                  <button key={val} type="button" onClick={() => setMode(val)}
                    className={`flex items-center gap-2 px-3 py-3 rounded-xl border text-xs font-bold transition-all ${mode === val ? 'border-[#7367f0] bg-[#7367f0]/10 text-[#7367f0]' : isDark ? 'border-white/10 text-gray-400' : 'border-gray-200 text-gray-500'}`}>
                    <Icon size={16} /> {lbl}
                  </button>
                ))}
              </div>

              {mode === 'nfc' && (
                <div className={`rounded-xl p-3 space-y-2.5 ${isDark ? 'bg-[#111827]' : 'bg-gray-50'}`}>
                  <p className={`text-[11px] ${sub}`}>Place an NFC tag at the workplace, then register it here once (scan from an NFC phone). Employees tap that tag to check in/out. Phones without NFC fall back to GPS + selfie.</p>
                  <button type="button" onClick={registerTag} disabled={scanning} className="btn-secondary text-xs px-3 py-2 flex items-center gap-2">
                    {scanning ? <RefreshCw size={13} className="animate-spin" /> : <Nfc size={14} />}
                    {scanning ? 'Hold tag to phone…' : 'Register Workplace Tag'}
                  </button>
                  {scanning && <button type="button" onClick={() => { cancelNfc(); setScanning(false); }} className="text-[11px] text-rose-400 ml-2">Cancel</button>}
                  {nfcMsg && <div className={`text-[11px] flex items-center gap-1.5 ${nfcMsg.includes('✓') ? 'text-emerald-500' : 'text-amber-500'}`}><AlertCircle size={12} /> {nfcMsg}</div>}
                  {tags.length > 0 ? (
                    <div className="space-y-1.5">
                      {tags.map(t => (
                        <div key={t} className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-mono ${isDark ? 'bg-[#1e2440] text-gray-200' : 'bg-white text-gray-700 border border-gray-200'}`}>
                          <span className="flex items-center gap-1.5"><Nfc size={12} className="text-[#7367f0]" /> {t}</span>
                          <button type="button" onClick={() => removeTag(t)} className="text-rose-400 hover:text-rose-500"><Trash2 size={13} /></button>
                        </div>
                      ))}
                    </div>
                  ) : <p className={`text-[11px] ${sub}`}>No tags registered yet.</p>}
                </div>
              )}
            </div>

            {/* Kiosk fallback + employee badges */}
            <div className={`border-t pt-4 space-y-3 ${isDark ? 'border-[#2a3250]' : 'border-gray-100'}`}>
              <h3 className={`font-bold text-sm flex items-center gap-2 ${txt}`}><CreditCard size={15} className="text-[#7367f0]" /> Kiosk &amp; Employee Badges</h3>
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={kioskEnabled} onChange={e => setKioskEnabled(e.target.checked)} className="w-4 h-4 rounded text-brand-violet" />
                <span className={`text-xs ${sub}`}>Enable Kiosk — an admin phone scans an employee's personal NFC badge to mark them (for staff whose own phone has no NFC).</span>
              </label>

              {kioskEnabled && (
                <div className={`rounded-xl p-3 space-y-2 ${isDark ? 'bg-[#111827]' : 'bg-gray-50'}`}>
                  <div className="flex items-center gap-2"><Users size={13} className={sub} /><span className={`text-[11px] font-semibold ${sub}`}>Assign a badge card to each employee</span></div>
                  {badgeMsg && <div className={`text-[11px] flex items-center gap-1.5 ${badgeMsg.includes('✓') ? 'text-emerald-500' : 'text-amber-500'}`}><AlertCircle size={12} /> {badgeMsg}</div>}
                  {emps.map(e => (
                    <div key={e.id} className={`flex items-center justify-between px-2.5 py-2 rounded-lg ${isDark ? 'bg-[#1e2440]' : 'bg-white border border-gray-200'}`}>
                      <div className="min-w-0">
                        <p className={`text-xs font-semibold truncate ${txt}`}>{e.name}</p>
                        {e.robifel_nfc_badge
                          ? <p className="text-[10px] font-mono text-emerald-500 flex items-center gap-1"><Check size={10} /> {e.robifel_nfc_badge}</p>
                          : <p className={`text-[10px] ${sub}`}>No badge</p>}
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <button type="button" onClick={() => assignBadge(e.id)} disabled={badgeBusy === e.id} className="btn-secondary text-[11px] px-2.5 py-1.5 flex items-center gap-1">
                          {badgeBusy === e.id ? <RefreshCw size={11} className="animate-spin" /> : <Nfc size={12} />} {e.robifel_nfc_badge ? 'Reassign' : 'Scan'}
                        </button>
                        {e.robifel_nfc_badge && <button type="button" onClick={() => clearBadge(e.id)} disabled={badgeBusy === e.id} className="text-rose-400 hover:text-rose-500"><Trash2 size={13} /></button>}
                      </div>
                    </div>
                  ))}
                  {emps.length === 0 && <p className={`text-[11px] ${sub}`}>No employees yet.</p>}
                </div>
              )}
            </div>

            <div className={`border-t pt-4 flex justify-end items-center gap-3 ${isDark ? 'border-[#2a3250]' : 'border-gray-100'}`}>
              {saved && <span className="text-xs text-emerald-500 flex items-center gap-1"><CheckCircle2 size={13} /> Saved</span>}
              <button onClick={save} disabled={saving} className="btn-primary text-sm px-5 py-2.5 flex items-center gap-2">
                {saving ? <RefreshCw size={14} className="animate-spin" /> : null} Save Settings
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
