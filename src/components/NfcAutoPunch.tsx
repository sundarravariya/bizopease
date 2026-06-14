import { useEffect, useState, useRef } from 'react';
import { CheckCircle2, AlertCircle, Nfc } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { odooCall } from '../services/odoo';
import { onTagScanned, consumeLaunchTag, getPosition } from '../services/native';

interface Flash { ok: boolean; title: string; sub: string; }

/**
 * Global handler for NFC tags that launch/wake the app (manifest tag dispatch).
 * - Admin device: a tapped tag is treated as an employee badge -> mark that
 *   employee in/out (kiosk-from-anywhere).
 * - Employee device: a tapped workplace tag -> self check-in/out.
 * Shows a fullscreen "✓ Attendance marked" flash, then auto-dismisses.
 */
export default function NfcAutoPunch() {
  const { user } = useAuth();
  const [flash, setFlash] = useState<Flash | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    if (!user) return;
    let unsub: () => void = () => {};
    let alive = true;

    const handle = async (uid: string) => {
      if (!uid || busy.current) return;
      busy.current = true;
      try {
        const pos = await getPosition();
        if (user.is_admin) {
          const res = await odooCall<any>('robifel.attendance.day', 'punch_by_badge', [uid, 'auto', pos?.lat || 0, pos?.lng || 0], {});
          if (res?.ok) setFlash({ ok: true, title: 'Attendance Marked', sub: res.employee_name });
          else setFlash({ ok: false, title: 'Not Recorded', sub: res?.error || 'Unknown badge' });
        } else {
          const valid = await odooCall<boolean>('robifel.hr.settings', 'is_valid_tag', [uid], {});
          if (!valid) { setFlash({ ok: false, title: 'Wrong Tag', sub: 'Not the workplace tag' }); return; }
          await odooCall('robifel.attendance.day', 'punch', [false, 'auto', pos?.lat || 0, pos?.lng || 0, false], {});
          setFlash({ ok: true, title: 'Attendance Marked', sub: 'Have a great day!' });
          setTimeout(() => { if (alive) window.location.reload(); }, 2200);  // let the gate refresh
        }
      } catch (e: any) {
        setFlash({ ok: false, title: 'Failed', sub: e?.message || 'Try again' });
      } finally {
        setTimeout(() => { if (alive) setFlash(null); busy.current = false; }, 2600);
      }
    };

    // Cold launch (tag opened the app) + live taps while running.
    consumeLaunchTag().then(uid => { if (uid) handle(uid); });
    onTagScanned(handle).then(fn => { unsub = fn; });

    return () => { alive = false; unsub(); };
  }, [user?.uid, user?.is_admin]);

  if (!flash) return null;
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-6" style={{ background: 'rgba(15,20,34,0.92)', backdropFilter: 'blur(6px)' }}>
      <div className="text-center animate-fade-in">
        <div className={`w-28 h-28 mx-auto rounded-full flex items-center justify-center mb-5 ${flash.ok ? 'bg-emerald-500/20' : 'bg-rose-500/20'}`}>
          {flash.ok ? <CheckCircle2 size={64} className="text-emerald-400" /> : <AlertCircle size={64} className="text-rose-400" />}
        </div>
        <p className="text-white text-2xl font-black">{flash.title}</p>
        <p className="text-[#8897b5] text-base mt-1 flex items-center justify-center gap-1.5"><Nfc size={15} /> {flash.sub}</p>
      </div>
    </div>
  );
}
