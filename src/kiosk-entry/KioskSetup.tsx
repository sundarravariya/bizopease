import { useState } from 'react';
import { Preferences } from '@capacitor/preferences';
import { odooLogin } from '../services/odoo';
import { setKioskBaseUrl } from './kioskOdooConfig';

interface Props {
  onDone: () => void;
}

export default function KioskSetup({ onDone }: Props) {
  const [url, setUrl] = useState('https://bizopease.robifel.in');
  const [db, setDb] = useState('robifel');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url || !db || !login || !password) {
      setError('All fields are required.'); return;
    }
    setLoading(true); setError('');
    try {
      setKioskBaseUrl(url.trimEnd('/'));
      const res = await odooLogin(login, password, db);
      if (!res?.uid) throw new Error('Authentication failed. Check credentials.');
      await Preferences.set({ key: 'kiosk_url', value: url.trimEnd('/') });
      await Preferences.set({ key: 'kiosk_db', value: db });
      await Preferences.set({ key: 'kiosk_login', value: login });
      await Preferences.set({ key: 'kiosk_password', value: password });
      onDone();
    } catch (e: any) {
      setError(e?.message || 'Connection failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: '#0f1422' }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center text-2xl font-black text-white"
               style={{ background: 'linear-gradient(135deg,#7367f0,#3d5af1)', boxShadow: '0 0 32px rgba(115,103,240,.4)' }}>
            B
          </div>
          <h1 className="text-white text-2xl font-black">Attendance Kiosk</h1>
          <p className="text-[#8897b5] text-sm mt-1">Configure once — stays connected</p>
        </div>

        <form onSubmit={handleConnect} className="space-y-3">
          {[
            { label: 'Server URL', value: url, set: setUrl, type: 'url', placeholder: 'https://bizopease.robifel.in' },
            { label: 'Database', value: db, set: setDb, type: 'text', placeholder: 'robifel' },
            { label: 'Admin Username', value: login, set: setLogin, type: 'email', placeholder: 'admin@example.com' },
            { label: 'Password', value: password, set: setPassword, type: 'password', placeholder: '••••••••' },
          ].map(f => (
            <div key={f.label}>
              <label className="block text-xs font-semibold text-[#8897b5] mb-1">{f.label}</label>
              <input
                type={f.type as any}
                value={f.value}
                onChange={e => f.set(e.target.value)}
                placeholder={f.placeholder}
                className="w-full px-4 py-3 rounded-xl text-sm text-white outline-none"
                style={{ background: '#161b2e', border: '1px solid #2a3250' }}
              />
            </div>
          ))}

          {error && (
            <p className="text-red-400 text-xs text-center pt-1">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl text-white font-bold text-sm mt-2"
            style={{ background: 'linear-gradient(135deg,#7367f0,#3d5af1)', opacity: loading ? 0.7 : 1 }}>
            {loading ? 'Connecting…' : 'Connect & Open Kiosk'}
          </button>
        </form>
      </div>
    </div>
  );
}
