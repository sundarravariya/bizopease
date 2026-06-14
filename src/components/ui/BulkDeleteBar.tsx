import { useState } from 'react';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { unlinkRecord } from '../../services/odoo';
import { Trash2, X, AlertTriangle, RefreshCw, CheckCircle2 } from 'lucide-react';

interface Props {
  model: string;                 // Odoo model, e.g. 'product.template'
  ids: number[];                 // selected record ids
  label?: string;                // human label, e.g. 'product'
  onClear: () => void;           // clear the selection
  onDeleted: () => void;         // refresh the list after a successful delete
}

// Admin-only floating bulk-delete bar with its own toast. Renders nothing for
// non-admins or when no rows are selected, so any list screen can drop it in.
export default function BulkDeleteBar({ model, ids, label = 'record', onClear, onDeleted }: Props) {
  const { isDark } = useTheme();
  const { user } = useAuth();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);

  if (!user?.is_admin || ids.length === 0) {
    return toast ? <Toast toast={toast} /> : null;
  }

  const noun = `${label}${ids.length > 1 ? 's' : ''}`;

  const flash = (ok: boolean, msg: string) => { setToast({ ok, msg }); setTimeout(() => setToast(null), 4000); };

  const doDelete = async () => {
    setBusy(true);
    try {
      const n = ids.length;
      await unlinkRecord(model, ids);
      setConfirm(false);
      onClear();
      onDeleted();
      flash(true, `Deleted ${n} ${label}${n > 1 ? 's' : ''}.`);
    } catch (e: any) {
      flash(false, e?.message || 'Delete failed — a record may be referenced elsewhere.');
    } finally {
      setBusy(false);
    }
  };

  const panel = isDark ? 'bg-[#161b2e] border-[#2a3250]' : 'bg-white border-gray-200';
  const txt = isDark ? 'text-white' : 'text-gray-900';
  const sub = isDark ? 'text-[#5a6a8a]' : 'text-gray-400';

  return (
    <>
      {toast && <Toast toast={toast} />}
      {/* Floating action bar */}
      <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-3 py-2 rounded-2xl border shadow-2xl ${panel}`}>
        <span className={`text-xs font-bold px-2 ${txt}`}>{ids.length} selected</span>
        <button onClick={onClear} className={`text-xs font-semibold px-2.5 py-1.5 rounded-xl ${isDark ? 'hover:bg-white/5' : 'hover:bg-gray-100'} ${sub}`}>Clear</button>
        <button onClick={() => setConfirm(true)} className="text-xs font-bold px-3 py-1.5 rounded-xl bg-rose-500 text-white hover:bg-rose-600 flex items-center gap-1.5">
          <Trash2 size={13} /> Delete
        </button>
      </div>

      {/* Confirm modal */}
      {confirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => !busy && setConfirm(false)}>
          <div className={`w-full max-w-sm rounded-2xl border shadow-2xl ${panel}`} onClick={e => e.stopPropagation()}>
            <div className="p-5 text-center">
              <div className="w-12 h-12 rounded-2xl bg-rose-500/15 flex items-center justify-center mx-auto mb-3">
                <AlertTriangle size={22} className="text-rose-500" />
              </div>
              <h3 className={`font-black text-base ${txt}`}>Delete {ids.length} {noun}?</h3>
              <p className={`text-xs mt-1.5 ${sub}`}>This permanently removes the selected {noun} from Odoo. This cannot be undone.</p>
            </div>
            <div className={`flex gap-2 p-4 border-t ${isDark ? 'border-[#2a3250]' : 'border-gray-100'}`}>
              <button onClick={() => setConfirm(false)} disabled={busy} className="btn-secondary flex-1 justify-center text-xs py-2.5">
                <X size={14} /> Cancel
              </button>
              <button onClick={doDelete} disabled={busy} className="flex-1 justify-center text-xs py-2.5 rounded-xl bg-rose-500 text-white font-bold hover:bg-rose-600 flex items-center gap-1.5 disabled:opacity-50">
                {busy ? <RefreshCw size={14} className="animate-spin" /> : <Trash2 size={14} />} Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Toast({ toast }: { toast: { ok: boolean; msg: string } }) {
  return (
    <div className={`fixed top-5 left-1/2 -translate-x-1/2 z-[70] px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-2 text-sm font-medium ${toast.ok ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white'}`}>
      {toast.ok ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />} {toast.msg}
    </div>
  );
}
