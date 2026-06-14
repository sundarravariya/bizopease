import { useEffect, useState, useCallback, ReactNode } from 'react';
import { Clock, Lock, MapPin, RefreshCw, AlertCircle, LogOut, CalendarOff, CheckCircle2, Nfc } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { searchRead, odooCall } from '../services/odoo';
import { applyScreenSecurity, getPosition, captureSelfie, nfcStatus, scanNfc, isNative } from '../services/native';

interface Settings { work_start: string; work_end: string; enforce_work_hours: boolean; weekly_off: string; attendance_mode: string; nfc_tag_ids: string; today: string; }
interface DayRec {
  id: number; status: string; geo_lat_in: number; geo_lng_in: number;
  check_out?: string | false; geo_lat_out: number; geo_lng_out: number;
}

const toMin = (hhmm: string) => { const [h, m] = (hhmm || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const fmt = (hhmm: string) => { const [h, m] = (hhmm || '0:0').split(':').map(Number); const ap = h >= 12 ? 'PM' : 'AM'; return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ap}`; };
const pad = (n: number) => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
// JS getDay() (Sun=0..Sat=6) -> Python weekday (Mon=0..Sun=6).
const pyWeekday = () => (new Date().getDay() + 6) % 7;

const Shell = ({ children }: { children: ReactNode }) => (
  <div className="min-h-screen flex items-center justify-center p-6" style={{ background: '#0f1422' }}>
    <div className="max-w-sm w-full text-center rounded-3xl p-8 border border-[#2a3250] bg-[#161b2e]">{children}</div>
  </div>
);

/**
 * Employee access gate. Admins always pass. Employees get a full web/app lockout
 * unless ALL hold: not the weekly-off day, inside the work window, and checked in
 * (present, GPS) but not yet checked out. Check-in and check-out both capture GPS
 * + a selfie; once checked out, the app re-locks until the next day.
 */
export default function WorkHoursGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [empId, setEmpId] = useState<number | null>(null);
  const [day, setDay] = useState<DayRec | null>(null);
  const [ready, setReady] = useState(false);
  const [punching, setPunching] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmOut, setConfirmOut] = useState(false);
  const [nfcDevice, setNfcDevice] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [, force] = useState(0);

  const isAdmin = !!user?.is_admin;
  // NFC check-in is active only when the admin chose NFC AND the phone has NFC.
  const nfcActive = settings?.attendance_mode === 'nfc' && nfcDevice;

  const loadState = useCallback(async () => {
    if (isAdmin || !user?.uid) { setReady(true); return; }
    setLoadError(false);
    try {
      const [s, emps] = await Promise.all([
        odooCall<Settings>('robifel.hr.settings', 'get_settings', [], {}),
        searchRead<{ id: number }>('hr.employee', { fields: ['id'], domain: [['user_id', '=', user.uid]], limit: 1 }),
      ]);
      setSettings(s);
      const eid = emps?.[0]?.id ?? null;
      setEmpId(eid);
      if (eid) {
        // Use the server-authoritative date so a skewed device clock can't shift the day.
        const serverToday = s?.today || todayStr();
        const dd = await searchRead<DayRec>('robifel.attendance.day', {
          fields: ['id', 'status', 'geo_lat_in', 'geo_lng_in', 'check_out', 'geo_lat_out', 'geo_lng_out'],
          domain: [['employee_id', '=', eid], ['date', '=', serverToday]], limit: 1,
        });
        setDay(dd?.[0] || null);
      }
    } catch {
      // Fail CLOSED for employees: if we can't verify access, deny it (show retry).
      setLoadError(true);
      setSettings(null);
    } finally { setReady(true); }
  }, [isAdmin, user?.uid]);

  useEffect(() => { loadState(); }, [loadState]);
  useEffect(() => {
    if (isAdmin) return;
    const t = setInterval(() => force(x => x + 1), 60_000); // re-eval at boundaries
    return () => clearInterval(t);
  }, [isAdmin]);

  // Block screenshots/recording for employees, allow for admins.
  useEffect(() => { applyScreenSecurity(!isAdmin); }, [isAdmin]);

  // Detect NFC hardware once (for choosing NFC vs GPS fallback).
  useEffect(() => { if (!isAdmin) nfcStatus().then(s => setNfcDevice(s.available)); }, [isAdmin]);

  // Live-location ping while an employee uses the app (during work hours).
  useEffect(() => {
    if (isAdmin || !empId) return;
    let stopped = false;
    const inWindow = () => {
      if (!settings?.enforce_work_hours) return true;
      const s = toMin(settings.work_start), e = toMin(settings.work_end), c = nowMin();
      return s <= e ? (c >= s && c < e) : (c >= s || c < e);
    };
    const doPing = async () => {
      if (stopped || !inWindow()) return;
      const pos = await getPosition();
      if (pos && !stopped) {
        try { await odooCall('robifel.employee.location', 'ping', [empId, pos.lat, pos.lng, pos.accuracy || 0, 0, false], {}); } catch { /* ignore */ }
      }
    };
    doPing();
    const t = setInterval(doPing, 120_000);
    return () => { stopped = true; clearInterval(t); };
  }, [isAdmin, empId, settings?.work_start, settings?.work_end, settings?.enforce_work_hours]);

  const punch = async (kind: 'in' | 'out') => {
    if (!empId) return;
    setPunching(true); setErr(null);
    try {
      if (nfcActive) {
        // NFC mode: tap the registered workplace tag. GPS still logged for the map.
        let uid: string;
        try { uid = await scanNfc(); }
        catch (e: any) { setErr(e?.message || 'NFC scan cancelled. Tap the workplace tag.'); return; }
        const valid = await odooCall<boolean>('robifel.hr.settings', 'is_valid_tag', [uid], {});
        if (!valid) { setErr('That tag is not the registered workplace tag.'); return; }
        const pos = await getPosition();
        await odooCall('robifel.attendance.day', 'punch', [empId, kind, pos?.lat || 0, pos?.lng || 0, false], {});
      } else {
        // GPS + selfie mode.
        const pos = await getPosition();
        if (!pos) { setErr(`Location is required to check ${kind === 'in' ? 'in' : 'out'}. Enable GPS and retry.`); return; }
        const selfie = await captureSelfie();
        // On the employee app a selfie is mandatory; on web (admin testing) it's skipped.
        if (isNative() && !selfie) { setErr('A selfie is required. Allow camera access and try again.'); return; }
        await odooCall('robifel.attendance.day', 'punch', [empId, kind, pos.lat, pos.lng, selfie], {});
      }
      setConfirmOut(false);
      await loadState();
    } catch (e: any) {
      setErr(e?.message || 'Something went wrong. Try again.');
    } finally { setPunching(false); }
  };

  // Admins and any non-employee user pass straight through.
  if (isAdmin) return <>{children}</>;
  if (!ready) return <Shell><RefreshCw size={26} className="mx-auto animate-spin text-[#7367f0]" /></Shell>;

  // Fail CLOSED: if access couldn't be verified, deny + offer retry (don't grant the app).
  if (loadError) {
    return (
      <Shell>
        <div className="w-16 h-16 mx-auto rounded-2xl bg-rose-500/15 flex items-center justify-center mb-4"><AlertCircle size={28} className="text-rose-400" /></div>
        <h2 className="text-white font-black text-lg">Couldn't Verify Access</h2>
        <p className="text-[#8897b5] text-sm mt-2">We couldn't confirm your attendance status. Check your connection and retry.</p>
        <button onClick={() => loadState()} className="mt-5 w-full py-3 rounded-xl bg-[#7367f0] hover:bg-[#5e54d4] text-white font-bold flex items-center justify-center gap-2"><RefreshCw size={16} /> Retry</button>
      </Shell>
    );
  }
  // Settings loaded but this user has no employee record -> not a tracked employee, allow.
  if (!empId || !settings) return <>{children}</>;

  // 1) Weekly-off lockout.
  if (settings.weekly_off && pyWeekday() === Number(settings.weekly_off)) {
    return (
      <Shell>
        <div className="w-16 h-16 mx-auto rounded-2xl bg-[#7367f0]/15 flex items-center justify-center mb-4"><CalendarOff size={28} className="text-[#7367f0]" /></div>
        <h2 className="text-white font-black text-lg">Weekly Off</h2>
        <p className="text-[#8897b5] text-sm mt-2">Today is your weekly off. The app is locked — enjoy your day!</p>
      </Shell>
    );
  }

  // 2) Work-hours lockout.
  if (settings.enforce_work_hours) {
    const start = toMin(settings.work_start), end = toMin(settings.work_end), cur = nowMin();
    const within = start <= end ? (cur >= start && cur < end) : (cur >= start || cur < end);
    if (!within) {
      return (
        <Shell>
          <div className="w-16 h-16 mx-auto rounded-2xl bg-[#7367f0]/15 flex items-center justify-center mb-4"><Lock size={28} className="text-[#7367f0]" /></div>
          <h2 className="text-white font-black text-lg">Outside Work Hours</h2>
          <p className="text-[#8897b5] text-sm mt-2">Your account is active only between</p>
          <div className="flex items-center justify-center gap-2 mt-3 text-white font-bold"><Clock size={16} className="text-[#7367f0]" />{fmt(settings.work_start)} — {fmt(settings.work_end)}</div>
          <p className="text-[#5a6a8a] text-xs mt-4">Please come back during work hours.</p>
        </Shell>
      );
    }
  }

  // 3) Already checked out today -> locked until tomorrow.
  if (day?.check_out) {
    return (
      <Shell>
        <div className="w-16 h-16 mx-auto rounded-2xl bg-emerald-500/15 flex items-center justify-center mb-4"><CheckCircle2 size={28} className="text-emerald-400" /></div>
        <h2 className="text-white font-black text-lg">Checked Out</h2>
        <p className="text-[#8897b5] text-sm mt-2">You've checked out for today. The app is locked until your next shift. See you tomorrow!</p>
      </Shell>
    );
  }

  // 4) Must be checked in (present, with GPS).
  const checkedIn = !!day && day.status === 'present' && (Math.abs(day.geo_lat_in) > 0 || Math.abs(day.geo_lng_in) > 0);
  if (!checkedIn) {
    return (
      <Shell>
        <div className="w-16 h-16 mx-auto rounded-2xl bg-emerald-500/15 flex items-center justify-center mb-4">{nfcActive ? <Nfc size={28} className="text-emerald-400" /> : <MapPin size={28} className="text-emerald-400" />}</div>
        <h2 className="text-white font-black text-lg">Mark Your Attendance</h2>
        <p className="text-[#8897b5] text-sm mt-2">{nfcActive ? 'Tap your phone to the workplace NFC tag to check in.' : 'Check in with your location and a selfie to start your day.'} You'll get access once you're marked present.</p>
        {err && <div className="mt-3 text-[12px] text-rose-400 bg-rose-500/10 rounded-lg px-3 py-2 flex items-center gap-1.5"><AlertCircle size={13} /> {err}</div>}
        <button onClick={() => punch('in')} disabled={punching}
          className="mt-5 w-full py-3 rounded-xl bg-[#7367f0] hover:bg-[#5e54d4] text-white font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-60">
          {punching ? <RefreshCw size={16} className="animate-spin" /> : (nfcActive ? <Nfc size={16} /> : <MapPin size={16} />)}
          {punching ? (nfcActive ? 'Hold tag to phone…' : 'Capturing…') : (nfcActive ? 'Scan Tag to Check In' : 'Check In Now')}
        </button>
        <p className="text-[#5a6a8a] text-[11px] mt-3">{nfcActive ? 'Your workplace tag and location are recorded.' : 'Your location & selfie are recorded for attendance.'}</p>
      </Shell>
    );
  }

  // 5) Access granted — render app with a persistent Check Out control.
  return (
    <>
      {children}
      <button onClick={() => setConfirmOut(true)}
        className="fixed bottom-4 right-4 z-[55] px-4 py-2.5 rounded-full bg-rose-500 hover:bg-rose-600 text-white text-xs font-bold shadow-lg flex items-center gap-1.5 transition-colors">
        <LogOut size={14} /> Check Out
      </button>
      {confirmOut && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm" onClick={() => !punching && setConfirmOut(false)}>
          <div className="max-w-sm w-full rounded-3xl p-7 border border-[#2a3250] bg-[#161b2e] text-center" onClick={e => e.stopPropagation()}>
            <div className="w-14 h-14 mx-auto rounded-2xl bg-rose-500/15 flex items-center justify-center mb-3"><LogOut size={24} className="text-rose-400" /></div>
            <h3 className="text-white font-black text-base">Check out for today?</h3>
            <p className="text-[#8897b5] text-sm mt-1.5">{nfcActive ? 'Tap the workplace tag to record your check-out.' : 'This records your check-out location & selfie.'} The app then locks until tomorrow.</p>
            {err && <div className="mt-3 text-[12px] text-rose-400 bg-rose-500/10 rounded-lg px-3 py-2 flex items-center gap-1.5"><AlertCircle size={13} /> {err}</div>}
            <div className="flex gap-2 mt-5">
              <button onClick={() => setConfirmOut(false)} disabled={punching} className="flex-1 py-2.5 rounded-xl bg-[#1e2440] text-[#8897b5] font-bold text-sm">Cancel</button>
              <button onClick={() => punch('out')} disabled={punching} className="flex-1 py-2.5 rounded-xl bg-rose-500 hover:bg-rose-600 text-white font-bold text-sm flex items-center justify-center gap-1.5">
                {punching ? <RefreshCw size={15} className="animate-spin" /> : (nfcActive ? <Nfc size={15} /> : <LogOut size={15} />)} {punching ? (nfcActive ? 'Tap tag…' : 'Saving…') : 'Check Out'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
