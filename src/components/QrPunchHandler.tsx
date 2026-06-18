import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';
import { odooCall } from '../services/odoo';
import { getPosition } from '../services/native';
import { useAuth } from '../context/AuthContext';

export default function QrPunchHandler() {
  const [params] = useSearchParams();
  const { workspace } = useParams<{ workspace?: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Processing QR…');

  useEffect(() => {
    const token = params.get('t');
    const date = params.get('d');
    if (!token || !date) {
      setStatus('error');
      setMessage('Invalid QR code — missing token or date.');
      return;
    }
    if (!user) {
      setStatus('error');
      setMessage('Please log in first, then scan the QR again.');
      return;
    }

    let cancelled = false;
    getPosition()
      .then(pos =>
        odooCall('robifel.hr.settings', 'punch_by_qr',
          [token, date, pos?.lat ?? 0, pos?.lng ?? 0, false], {})
      )
      .then(() => {
        if (cancelled) return;
        setStatus('success');
        setMessage('Attendance marked! Redirecting…');
        setTimeout(() => navigate(`/${workspace || user.db}`), 2000);
      })
      .catch((e: any) => {
        if (cancelled) return;
        setStatus('error');
        setMessage(e?.message || 'QR punch failed.');
      });

    return () => { cancelled = true; };
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  const colorClass =
    status === 'success' ? 'text-emerald-400' :
    status === 'error' ? 'text-rose-400' :
    'text-[#7367f0]';

  const Icon = status === 'loading' ? RefreshCw : status === 'success' ? CheckCircle2 : AlertCircle;

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: '#0f1422' }}>
      <div className="max-w-sm w-full text-center rounded-3xl p-8 border border-[#2a3250] bg-[#161b2e]">
        <Icon
          size={48}
          className={`mx-auto mb-4 ${colorClass} ${status === 'loading' ? 'animate-spin' : ''}`}
        />
        <p className="text-white font-bold text-base">{message}</p>
        {status === 'error' && (
          <button
            onClick={() => window.history.back()}
            className="mt-4 text-sm text-[#7367f0]"
          >
            Go back
          </button>
        )}
      </div>
    </div>
  );
}
