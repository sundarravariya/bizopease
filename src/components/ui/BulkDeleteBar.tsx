import { useState } from 'react';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { unlinkRecord, callMethod } from '../../services/odoo';
import { Trash2, X, AlertTriangle, RefreshCw, CheckCircle2, Ban, RotateCcw } from 'lucide-react';

// Per-model Odoo method names for cancel / reset-to-draft
const MODEL_METHODS: Record<string, { cancel: string; draft: string }> = {
  'account.move':   { cancel: 'button_cancel',  draft: 'button_draft' },
  'purchase.order': { cancel: 'button_cancel',  draft: 'button_draft' },
  'sale.order':     { cancel: 'action_cancel',  draft: 'action_draft' },
};

interface Props {
  model: string;
  ids: number[];
  label?: string;
  onClear: () => void;
  onDeleted: () => void;
}

type Action = 'cancel' | 'draft' | 'delete';

export default function BulkDeleteBar({ model, ids, label = 'record', onClear, onDeleted }: Props) {
  const { isDark } = useTheme();
  const { user } = useAuth();
  const [confirm, setConfirm] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);

  if (!user?.is_admin || ids.length === 0) {
    return toast ? <Toast toast={toast} /> : null;
  }

  const methods = MODEL_METHODS[model];
  const noun = `${label}${ids.length > 1 ? 's' : ''}`;

  const flash = (ok: boolean, msg: string) => {
    setToast({ ok, msg });
    setTimeout(() => setToast(null), 4000);
  };

  const run = async (action: Action) => {
    setBusy(true);
    try {
      const n = ids.length;
      if (action === 'delete') {
        await unlinkRecord(model, ids);
        flash(true, `Deleted ${n} ${noun}.`);
      } else if (action === 'cancel' && methods) {
        await callMethod(model, methods.cancel, [ids]);
        flash(true, `Cancelled ${n} ${noun}.`);
      } else if (action === 'draft' && methods) {
        await callMethod(model, methods.draft, [ids]);
        flash(true, `Reset ${n} ${noun} to draft.`);
      }
      setConfirm(null);
      onClear();
      onDeleted();
    } catch (e: any) {
      flash(false, e?.message || `${action} failed — record may be in a state that prevents it.`);
    } finally {
      setBusy(false);
    }
  };

  const panel = isDark ? 'bg-[#161b2e] border-[#2a3250]' : 'bg-white border-gray-200';
  const txt = isDark ? 'text-white' : 'text-gray-900';
  const sub = isDark ? 'text-[#5a6a8a]' : 'text-gray-400';

  const CONFIRM_CFG = {
    cancel: {
      icon: <Ban size={22} className="text-amber-500" />,
      bg: 'bg-amber-500/15',
      title: `Cancel ${ids.length} ${noun}?`,
      desc: `This will cancel the selected ${noun} in Odoo. You can reset them to draft afterwards.`,
      btn: 'bg-amber-500 hover:bg-amber-600',
      label: 'Cancel Records',
      busyIcon: <Ban size={14} />,
    },
    draft: {
      icon: <RotateCcw size={22} className="text-blue-400" />,
      bg: 'bg-blue-500/15',
      title: `Reset ${ids.length} ${noun} to Draft?`,
      desc: `This will reopen the selected ${noun} as drafts so they can be edited.`,
      btn: 'bg-blue-500 hover:bg-blue-600',
      label: 'Reset to Draft',
      busyIcon: <RotateCcw size={14} />,
    },
    delete: {
      icon: <AlertTriangle size={22} className="text-rose-500" />,
      bg: 'bg-rose-500/15',
      title: `Delete ${ids.length} ${noun}?`,
      desc: `This permanently removes the selected ${noun} from Odoo. This cannot be undone.`,
      btn: 'bg-rose-500 hover:bg-rose-600',
      label: 'Delete',
      busyIcon: <Trash2 size={14} />,
    },
  };

  const cfg = confirm ? CONFIRM_CFG[confirm] : null;

  return (
    <>
      {toast && <Toast toast={toast} />}

      {/* Floating action bar — mobile-first layout */}
      <div className={`fixed bottom-4 sm:bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-2 rounded-2xl border shadow-2xl ${panel} max-w-[calc(100vw-2rem)]`}>
        <span className={`text-xs font-bold px-1.5 sm:px-2 whitespace-nowrap ${txt}`}>{ids.length} selected</span>
        <button onClick={onClear} className={`text-xs font-semibold px-2 py-1.5 rounded-xl ${isDark ? 'hover:bg-white/5' : 'hover:bg-gray-100'} ${sub}`}>
          <X size={13} />
        </button>
        {methods && (
          <>
            <button
              onClick={() => setConfirm('draft')}
              className="text-xs font-bold px-2.5 py-1.5 rounded-xl bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 flex items-center gap-1"
            >
              <RotateCcw size={12} />
              <span className="hidden sm:inline">Draft</span>
            </button>
            <button
              onClick={() => setConfirm('cancel')}
              className="text-xs font-bold px-2.5 py-1.5 rounded-xl bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 flex items-center gap-1"
            >
              <Ban size={12} />
              <span className="hidden sm:inline">Cancel</span>
            </button>
          </>
        )}
        <button
          onClick={() => setConfirm('delete')}
          className="text-xs font-bold px-2.5 py-1.5 rounded-xl bg-rose-500 text-white hover:bg-rose-600 flex items-center gap-1"
        >
          <Trash2 size={12} />
          <span className="hidden sm:inline">Delete</span>
        </button>
      </div>

      {/* Confirm modal */}
      {confirm && cfg && (
        <div
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => !busy && setConfirm(null)}
        >
          <div
            className={`w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl border shadow-2xl ${panel}`}
            onClick={e => e.stopPropagation()}
          >
            <div className="p-5 text-center">
              <div className={`w-12 h-12 rounded-2xl ${cfg.bg} flex items-center justify-center mx-auto mb-3`}>
                {cfg.icon}
              </div>
              <h3 className={`font-black text-base ${txt}`}>{cfg.title}</h3>
              <p className={`text-xs mt-1.5 ${sub}`}>{cfg.desc}</p>
            </div>
            <div className={`flex gap-2 p-4 border-t ${isDark ? 'border-[#2a3250]' : 'border-gray-100'}`}>
              <button
                onClick={() => setConfirm(null)}
                disabled={busy}
                className="btn-secondary flex-1 justify-center text-xs py-2.5"
              >
                <X size={14} /> Back
              </button>
              <button
                onClick={() => run(confirm)}
                disabled={busy}
                className={`flex-1 justify-center text-xs py-2.5 rounded-xl text-white font-bold flex items-center gap-1.5 disabled:opacity-50 ${cfg.btn}`}
              >
                {busy ? <RefreshCw size={14} className="animate-spin" /> : cfg.busyIcon}
                {cfg.label}
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
    <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-[70] px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-2 text-sm font-medium max-w-[calc(100vw-2rem)] text-center ${toast.ok ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white'}`}>
      {toast.ok ? <CheckCircle2 size={16} className="shrink-0" /> : <AlertTriangle size={16} className="shrink-0" />}
      {toast.msg}
    </div>
  );
}
