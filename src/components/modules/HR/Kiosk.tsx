import { useState, useRef, useEffect, useCallback } from 'react';
import { useTheme } from '../../../context/ThemeContext';
import { odooCall } from '../../../services/odoo';
import { scanNfc, nfcStatus, getPosition, cancelNfc, isNative } from '../../../services/native';
import { QRCodeSVG } from 'qrcode.react';
import {
  Nfc, LogIn, LogOut, CheckCircle2, AlertCircle, Play, Square,
  RefreshCw, Smartphone, QrCode, MapPin,
} from 'lucide-react';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

interface KioskProps { onAdminExit?: () => void; }

export default function Kiosk({ onAdminExit }: KioskProps = {}) {
  const { isDark } = useTheme();

  // attendance mode loaded from settings
  const [attendanceMode, setAttendanceMode] = useState<'gps_selfie' | 'nfc' | 'qr' | null>(null);
  const [modeLoading, setModeLoading] = useState(true);

  // NFC kiosk state
  const [kind, setKind] = useState<'in' | 'out'>('in');
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'waiting' | 'ok' | 'err'>('idle');
  const [msg, setMsg] = useState('');
  const [last, setLast] = useState<{ name: string; kind: 'in' | 'out' } | null>(null);
  const [nfc, setNfc] = useState<{ available: boolean; enabled: boolean }>({ available: true, enabled: true });

  // QR state
  const [qrData, setQrData] = useState<{ url: string; date: string } | null>(null);
  const [qrLoading, setQrLoading] = useState(false);

  const runRef = useRef(false);
  const kindRef = useRef<'in' | 'out'>('in');
  useEffect(() => { kindRef.current = kind; }, [kind]);

  const txt = isDark ? 'text-white' : 'text-gray-900';
  const sub = isDark ? 'text-[#5a6a8a]' : 'text-gray-500';

  useEffect(() => {
    nfcStatus().then(setNfc);
    // Load current attendance mode from settings
    odooCall<any>('robifel.hr.settings', 'get_settings', [], {})
      .then(s => { if (s?.attendance_mode) setAttendanceMode(s.attendance_mode); })
      .catch(() => {})
      .finally(() => setModeLoading(false));
  }, []);

  // When mode becomes 'qr', auto-load and auto-refresh every 2 minutes
  useEffect(() => {
    if (attendanceMode !== 'qr') return;
    loadQr();
    const timer = setInterval(loadQr, 120_000);
    return () => clearInterval(timer);
  }, [attendanceMode]);

  const loadQr = async () => {
    setQrLoading(true);
    try {
      const data = await odooCall('robifel.hr.settings', 'get_daily_qr', [], {});
      setQrData(data);
      // Update home-screen widget if running in the Kiosk APK
      if (data?.url) {
        try {
          const { registerPlugin } = await import('@capacitor/core');
          const QrWidget = registerPlugin<{ saveQrUrl: (o: { url: string }) => Promise<void> }>('QrWidget');
          await QrWidget.saveQrUrl({ url: data.url });
        } catch { /* plugin not available in portal build */ }
      }
    }
    catch { /* not available */ }
    finally { setQrLoading(false); }
  };

  const loop = useCallback(async () => {
    runRef.current = true; setRunning(true);
    while (runRef.current) {
      setPhase('waiting'); setMsg(''); setLast(null);
      let uid: string;
      try {
        uid = await scanNfc();
      } catch (e: any) {
        if (!runRef.current) break;
        setPhase('err'); setMsg(e?.message || 'Scan failed — retrying'); await sleep(1300); continue;
      }
      if (!runRef.current) break;
      const k = kindRef.current;
      const pos = await getPosition();
      try {
        const res = await odooCall<any>('robifel.attendance.day', 'punch_by_badge', [uid, k, pos?.lat || 0, pos?.lng || 0], {});
        if (res?.ok) { setPhase('ok'); setLast({ name: res.employee_name, kind: k }); }
        else { setPhase('err'); setMsg(res?.error || 'Unknown badge'); }
      } catch (e: any) { setPhase('err'); setMsg(e?.message || 'Could not record'); }
      await sleep(2600);
    }
    setRunning(false); setPhase('idle');
  }, []);

  const stop = () => { runRef.current = false; cancelNfc(); setRunning(false); setPhase('idle'); setMsg(''); };
  useEffect(() => () => { runRef.current = false; cancelNfc(); }, []);

  if (modeLoading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <RefreshCw size={20} className="animate-spin text-[#7367f0]" />
      </div>
    );
  }

  // ── QR Attendance mode ───────────────────────────────────────────────────
  if (attendanceMode === 'qr') {
    return (
      <div className="max-w-md mx-auto pb-24 animate-fade-in">
        <div className="mb-4 text-center">
          <h1 className={`text-xl font-black ${txt}`} onDoubleClick={onAdminExit}>QR Attendance</h1>
        </div>

        <div className={`rounded-3xl border p-8 flex flex-col items-center gap-5 ${isDark ? 'bg-[#161b2e] border-[#2a3250]' : 'bg-white border-gray-200'}`}>
          <div className={`p-2.5 rounded-2xl ${isDark ? 'bg-white/10' : 'bg-gray-100'}`}>
            <QrCode size={28} className="text-[#7367f0]" />
          </div>
          {qrLoading ? (
            <div className="py-8"><RefreshCw size={20} className="animate-spin text-[#7367f0]" /></div>
          ) : qrData ? (
            <>
              <div className="rounded-2xl bg-white p-4 shadow">
                <QRCodeSVG value={qrData.url} size={220} />
              </div>
              <p className={`text-xs text-center ${sub}`}>Valid: <span className="font-bold">{qrData.date}</span></p>
              <button onClick={loadQr} disabled={qrLoading}
                className="text-xs text-[#7367f0] flex items-center gap-1.5 hover:underline">
                <RefreshCw size={12} className={qrLoading ? 'animate-spin' : ''} /> Refresh QR
              </button>
            </>
          ) : (
            <div className="text-center py-6">
              <AlertCircle size={28} className="mx-auto text-amber-500 mb-2" />
              <p className={`text-sm font-semibold ${txt}`}>QR code unavailable</p>
              <p className={`text-xs mt-1 ${sub}`}>Save QR mode in HR Settings first, then refresh.</p>
              <button onClick={loadQr} className="mt-3 btn-secondary text-xs px-4 py-2 flex items-center gap-1.5 mx-auto">
                <RefreshCw size={12} /> Retry
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── NFC Kiosk mode ───────────────────────────────────────────────────────
  if (attendanceMode === 'nfc') {
    if (!isNative()) {
      return (
        <div className="max-w-md mx-auto pt-16 text-center">
          <Smartphone size={40} className={`mx-auto mb-3 ${sub}`} />
          <h1 className={`text-lg font-black ${txt}`}>Kiosk runs in the app</h1>
          <p className={`text-sm mt-2 ${sub}`}>Open this screen in the BizOpease admin app on an NFC-capable phone to scan employee badges.</p>
        </div>
      );
    }

    return (
      <div className="max-w-xl mx-auto pb-24 animate-fade-in">
        <div className="mb-4 text-center">
          <h1 className={`text-xl font-black ${txt}`} onDoubleClick={onAdminExit}>Attendance Kiosk</h1>
          <p className={`text-xs mt-0.5 ${sub}`}>Tap each employee's NFC badge to mark them {kind === 'in' ? 'in' : 'out'}</p>
        </div>

        <div className={`flex p-1 rounded-2xl mb-5 ${isDark ? 'bg-[#1e2440]' : 'bg-gray-100'}`}>
          {([['in', 'Check In', LogIn], ['out', 'Check Out', LogOut]] as const).map(([k, l, Icon]) => (
            <button key={k} onClick={() => setKind(k)}
              className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-all ${kind === k ? (k === 'in' ? 'bg-emerald-500 text-white shadow' : 'bg-rose-500 text-white shadow') : sub}`}>
              <Icon size={16} /> {l}
            </button>
          ))}
        </div>

        <div className={`rounded-3xl border p-8 text-center min-h-[320px] flex flex-col items-center justify-center ${isDark ? 'bg-[#161b2e] border-[#2a3250]' : 'bg-white border-gray-200'}`}>
          {phase === 'ok' && last ? (
            <>
              <div className="w-20 h-20 rounded-full bg-emerald-500/15 flex items-center justify-center mb-4"><CheckCircle2 size={44} className="text-emerald-500" /></div>
              <p className={`text-2xl font-black ${txt}`}>{last.name}</p>
              <p className={`text-sm font-bold mt-1 ${last.kind === 'in' ? 'text-emerald-500' : 'text-rose-500'}`}>Checked {last.kind === 'in' ? 'In' : 'Out'} · {new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</p>
              <p className={`text-xs mt-3 ${sub}`}>Ready for next badge…</p>
            </>
          ) : phase === 'err' ? (
            <>
              <div className="w-20 h-20 rounded-full bg-rose-500/15 flex items-center justify-center mb-4"><AlertCircle size={44} className="text-rose-500" /></div>
              <p className={`text-base font-bold ${txt}`}>{msg}</p>
              <p className={`text-xs mt-3 ${sub}`}>{running ? 'Ready for next badge…' : 'Kiosk stopped'}</p>
            </>
          ) : running ? (
            <>
              <div className="w-24 h-24 rounded-full bg-[#7367f0]/15 flex items-center justify-center mb-4 animate-pulse"><Nfc size={48} className="text-[#7367f0]" /></div>
              <p className={`text-lg font-black ${txt}`}>Tap badge to phone</p>
              <p className={`text-xs mt-2 ${sub}`}>Hold the employee's NFC card to the back of the phone</p>
            </>
          ) : (
            <>
              <div className="w-24 h-24 rounded-full bg-[#7367f0]/10 flex items-center justify-center mb-4"><Nfc size={48} className="text-[#7367f0]" /></div>
              <p className={`text-base font-bold ${txt}`}>Kiosk is idle</p>
              <p className={`text-xs mt-2 ${sub}`}>Press Start, then tap each employee badge</p>
            </>
          )}
        </div>

        {!nfc.available && <p className="text-center text-xs text-amber-500 mt-3 flex items-center justify-center gap-1.5"><AlertCircle size={13} /> This phone has no NFC.</p>}
        {nfc.available && !nfc.enabled && <p className="text-center text-xs text-amber-500 mt-3 flex items-center justify-center gap-1.5"><AlertCircle size={13} /> NFC is off — turn it on in phone settings.</p>}

        <div className="mt-5">
          {running ? (
            <button onClick={stop} className="w-full py-3.5 rounded-2xl bg-rose-500 hover:bg-rose-600 text-white font-bold flex items-center justify-center gap-2"><Square size={16} /> Stop Kiosk</button>
          ) : (
            <button onClick={loop} disabled={!nfc.available || !nfc.enabled} className="w-full py-3.5 rounded-2xl bg-[#7367f0] hover:bg-[#5e54d4] text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50"><Play size={16} /> Start Kiosk</button>
          )}
        </div>
      </div>
    );
  }

  // ── GPS + Selfie mode (or unknown) — kiosk not applicable ─────────────────
  return (
    <div className="max-w-md mx-auto pt-16 text-center pb-24">
      <MapPin size={40} className={`mx-auto mb-3 ${sub}`} />
      <h1 className={`text-lg font-black ${txt}`}>Attendance Kiosk</h1>
      <p className={`text-sm mt-2 ${sub}`}>
        Kiosk is only available when attendance mode is set to <strong>NFC</strong> or <strong>QR Code</strong>.
      </p>
      <p className={`text-xs mt-2 ${sub}`}>
        Current mode: <strong>{attendanceMode === 'gps_selfie' ? 'GPS + Selfie' : attendanceMode || 'Unknown'}</strong>.
        Change it in HR Settings to enable the kiosk.
      </p>
    </div>
  );
}
