import { useState, useEffect } from 'react';
import { queenCall } from '../../../services/queen';
import { useTheme } from '../../../context/ThemeContext';
import { useAuth } from '../../../context/AuthContext';
import { RefreshCw, CheckCircle2, AlertCircle, Search, ReceiptText, Square, CheckSquare, Ban, RotateCcw, X } from 'lucide-react';

interface B2BInvoice {
  id: number;
  name: string;
  partner_id: [number, string] | false;
  invoice_date: string | false;
  invoice_date_due: string | false;
  amount_total: number;
  amount_residual: number;
  state: 'draft' | 'posted' | 'cancel';
  payment_state: string;
  move_type: string;
}

export default function B2BInvoices() {
  const { user } = useAuth();
  const { isDark } = useTheme();
  if (!user?.is_admin) return <div className="flex items-center justify-center h-64 text-[#8897b5]">Access restricted to administrators.</div>;

  const [invoices, setInvoices] = useState<B2BInvoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState('all');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const showMsg = (ok: boolean, msg: string) => {
    setMessage({ type: ok ? 'success' : 'error', text: msg });
    setTimeout(() => setMessage(null), 4000);
  };

  const fetchInvoices = async () => {
    setLoading(true);
    try {
      const res = await queenCall<B2BInvoice[]>('account.move', 'search_read', [
        [['move_type', 'in', ['out_invoice', 'out_refund']], ['partner_id.customer_rank', '>', 0]]
      ], {
        fields: ['id', 'name', 'partner_id', 'invoice_date', 'invoice_date_due',
                 'amount_total', 'amount_residual', 'state', 'payment_state', 'move_type'],
        order: 'invoice_date desc, id desc',
        limit: 200,
      });
      setInvoices(Array.isArray(res) ? res : []);
    } catch (err: any) {
      showMsg(false, err?.message || 'Failed to load invoices');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchInvoices(); }, []);

  const handleBulkCancel = async () => {
    if (!selectedIds.size) return;
    if (!confirm(`Cancel ${selectedIds.size} selected invoice(s)?`)) return;
    setLoading(true);
    try {
      await queenCall('account.move', 'button_cancel', [[...selectedIds]]);
      showMsg(true, `${selectedIds.size} invoice(s) cancelled.`);
      setSelectedIds(new Set());
      await fetchInvoices();
    } catch (err: any) { showMsg(false, err?.message || 'Bulk cancel failed'); }
    finally { setLoading(false); }
  };

  const handleBulkDraft = async () => {
    if (!selectedIds.size) return;
    if (!confirm(`Reset ${selectedIds.size} invoice(s) to draft?`)) return;
    setLoading(true);
    try {
      await queenCall('account.move', 'button_draft', [[...selectedIds]]);
      showMsg(true, `${selectedIds.size} invoice(s) reset to draft.`);
      setSelectedIds(new Set());
      await fetchInvoices();
    } catch (err: any) { showMsg(false, err?.message || 'Bulk reset failed'); }
    finally { setLoading(false); }
  };

  const payColor: Record<string, string> = {
    not_paid: 'bg-red-500/10 text-red-400 border-red-500/20',
    partial: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    in_payment: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    paid: 'bg-green-500/10 text-green-400 border-green-500/20',
    reversed: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
  };

  const stateColor: Record<string, string> = {
    draft: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
    posted: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
    cancel: 'bg-red-500/10 text-red-400 border-red-500/20',
  };

  const filtered = invoices.filter(inv => {
    const q = search.toLowerCase();
    const partner = Array.isArray(inv.partner_id) ? inv.partner_id[1] : '';
    const matchSearch = !q || inv.name.toLowerCase().includes(q) || partner.toLowerCase().includes(q);
    const matchState = stateFilter === 'all' || inv.state === stateFilter ||
      (stateFilter === 'unpaid' && inv.payment_state === 'not_paid' && inv.state === 'posted') ||
      (stateFilter === 'refund' && inv.move_type === 'out_refund');
    return matchSearch && matchState;
  });

  const totalOutstanding = filtered
    .filter(i => i.state === 'posted' && i.payment_state !== 'paid')
    .reduce((s, i) => s + (i.amount_residual || 0), 0);

  const glassClass = isDark ? 'glass' : 'glass-light bg-white/80';

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className={`text-2xl font-black ${isDark ? 'text-white' : 'text-gray-900'}`}>B2B Invoices</h1>
          <p className={`text-xs mt-1 ${isDark ? 'text-[#5a6a8a]' : 'text-gray-500'}`}>Customer invoices and credit notes from B2B orders.</p>
        </div>
        <button onClick={fetchInvoices} className="btn-secondary text-xs px-3.5 py-1.5 flex items-center gap-1">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {message && (
        <div className={`p-4 rounded-xl flex items-start gap-3 border ${message.type === 'success' ? 'bg-green-500/10 border-green-500/20 text-green-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>
          {message.type === 'success' ? <CheckCircle2 size={18} className="flex-shrink-0" /> : <AlertCircle size={18} className="flex-shrink-0" />}
          <span className="text-sm">{message.text}</span>
        </div>
      )}

      {/* Summary KPI */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total Invoices', value: invoices.filter(i => i.move_type === 'out_invoice').length, color: 'text-violet-400' },
          { label: 'Credit Notes', value: invoices.filter(i => i.move_type === 'out_refund').length, color: 'text-amber-400' },
          { label: 'Paid', value: invoices.filter(i => i.payment_state === 'paid').length, color: 'text-green-400' },
          { label: 'Outstanding (₹)', value: `₹ ${totalOutstanding.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`, color: 'text-red-400' },
        ].map(k => (
          <div key={k.label} className={`card p-4 rounded-2xl ${glassClass}`}>
            <p className={`text-xs font-semibold uppercase tracking-wider ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>{k.label}</p>
            <p className={`text-xl font-black mt-1 ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>

      <div className={`card p-3 rounded-2xl flex flex-col sm:flex-row items-center gap-3 ${glassClass}`}>
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search invoice or partner..."
            className={`pl-8 pr-3 py-1.5 text-xs rounded-lg border outline-none w-56 ${isDark ? 'bg-[#1f2937] border-white/10 text-white' : 'bg-gray-50 border-gray-200 text-gray-800'}`} />
        </div>
        <select value={stateFilter} onChange={e => setStateFilter(e.target.value)}
          className={`px-3 py-1.5 text-xs rounded-lg border outline-none ${isDark ? 'bg-[#1f2937] border-white/10 text-white' : 'bg-gray-50 border-gray-200 text-gray-800'}`}>
          <option value="all">All</option>
          <option value="posted">Posted</option>
          <option value="draft">Draft</option>
          <option value="unpaid">Unpaid</option>
          <option value="refund">Credit Notes</option>
          <option value="cancel">Cancelled</option>
        </select>
        <span className={`sm:ml-auto text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{filtered.length} records</span>
      </div>

      {/* Bulk Action Bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-4 py-3 rounded-2xl shadow-2xl border border-[#7367f0]/30 bg-[#161b2e]/95 backdrop-blur-sm animate-fade-in">
          <span className="text-xs font-bold text-violet-400 mr-1">{selectedIds.size} selected</span>
          <button onClick={handleBulkCancel} className="px-3 py-1.5 bg-red-500/10 text-red-400 border border-red-500/20 text-xs font-bold rounded-lg hover:bg-red-500/20 transition-all flex items-center gap-1">
            <Ban size={11} /> Cancel
          </button>
          <button onClick={handleBulkDraft} className="px-3 py-1.5 bg-amber-500/10 text-amber-400 border border-amber-500/20 text-xs font-bold rounded-lg hover:bg-amber-500/20 transition-all flex items-center gap-1">
            <RotateCcw size={11} /> Reset to Draft
          </button>
          <button onClick={() => setSelectedIds(new Set())} className="ml-1 p-1.5 text-gray-500 hover:text-white transition-colors">
            <X size={14} />
          </button>
        </div>
      )}

      <div className={`card overflow-x-auto rounded-2xl ${glassClass}`}>
        {loading ? (
          <div className="h-48 flex items-center justify-center"><RefreshCw size={20} className="animate-spin text-violet-400" /></div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className={`border-b text-xs font-semibold uppercase tracking-wider ${isDark ? 'border-white/5 bg-[#111827]/40 text-gray-400' : 'border-gray-200 bg-gray-50 text-gray-500'}`}>
                <th className="py-3.5 pl-5 pr-2 w-8">
                  <button onClick={() => {
                    if (selectedIds.size === filtered.length && filtered.length > 0) {
                      setSelectedIds(new Set());
                    } else {
                      setSelectedIds(new Set(filtered.map(i => i.id)));
                    }
                  }} className="text-gray-400 hover:text-violet-400 transition-colors">
                    {selectedIds.size === filtered.length && filtered.length > 0
                      ? <CheckSquare size={14} className="text-violet-400" />
                      : <Square size={14} />}
                  </button>
                </th>
                <th className="py-3.5 px-5">Invoice</th>
                <th className="py-3.5 px-5">Partner</th>
                <th className="py-3.5 px-5">Date</th>
                <th className="py-3.5 px-5">Due Date</th>
                <th className="py-3.5 px-5 text-right">Total (₹)</th>
                <th className="py-3.5 px-5 text-right">Outstanding (₹)</th>
                <th className="py-3.5 px-5 text-center">Status</th>
                <th className="py-3.5 px-5 text-center">Payment</th>
                <th className="py-3.5 px-5 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className={`divide-y text-sm ${isDark ? 'divide-white/5' : 'divide-gray-100'}`}>
              {filtered.length === 0 ? (
                <tr><td colSpan={10} className={`py-12 text-center text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>No invoices found.</td></tr>
              ) : filtered.map(inv => {
                const partner = Array.isArray(inv.partner_id) ? inv.partner_id[1] : '—';
                const isRefund = inv.move_type === 'out_refund';
                const isSelected = selectedIds.has(inv.id);
                return (
                  <tr key={inv.id} className={`transition-colors ${isSelected ? (isDark ? 'bg-violet-500/5' : 'bg-violet-50') : isDark ? 'hover:bg-white/5' : 'hover:bg-gray-50'}`}>
                    <td className="py-3.5 pl-5 pr-2">
                      <button onClick={() => {
                        const next = new Set(selectedIds);
                        if (isSelected) next.delete(inv.id); else next.add(inv.id);
                        setSelectedIds(next);
                      }} className="text-gray-500 hover:text-violet-400 transition-colors">
                        {isSelected ? <CheckSquare size={14} className="text-violet-400" /> : <Square size={14} />}
                      </button>
                    </td>
                    <td className="py-3.5 px-5">
                      <div className="flex items-center gap-2">
                        <ReceiptText size={13} className={isRefund ? 'text-amber-400' : 'text-violet-400'} />
                        <span className={`font-bold text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>{inv.name}</span>
                        {isRefund && <span className="text-[9px] font-bold uppercase bg-amber-500/15 text-amber-400 px-1.5 py-0.5 rounded-full border border-amber-500/20">Refund</span>}
                      </div>
                    </td>
                    <td className={`py-3.5 px-5 font-semibold text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>{partner}</td>
                    <td className={`py-3.5 px-5 text-xs font-mono ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{String(inv.invoice_date || '—')}</td>
                    <td className={`py-3.5 px-5 text-xs font-mono ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{String(inv.invoice_date_due || '—')}</td>
                    <td className={`py-3.5 px-5 text-right font-bold ${isDark ? 'text-white' : 'text-gray-800'}`}>
                      ₹ {inv.amount_total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className={`py-3.5 px-5 text-right font-bold ${inv.amount_residual > 0 ? 'text-red-400' : isDark ? 'text-gray-500' : 'text-gray-300'}`}>
                      {inv.amount_residual > 0 ? `₹ ${inv.amount_residual.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—'}
                    </td>
                    <td className="py-3.5 px-5 text-center">
                      <span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full border ${stateColor[inv.state] || stateColor.draft}`}>
                        {inv.state}
                      </span>
                    </td>
                    <td className="py-3.5 px-5 text-center">
                      <span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full border ${payColor[inv.payment_state] || payColor.not_paid}`}>
                        {(inv.payment_state || '').replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="py-3.5 px-5 text-center">
                      <div className="flex gap-1.5 justify-center">
                        {inv.state === 'posted' && (
                          <button
                            onClick={async () => {
                              if (!confirm('Cancel this invoice?')) return;
                              setLoading(true);
                              try { await queenCall('account.move', 'button_cancel', [[inv.id]]); showMsg(true, 'Invoice cancelled.'); await fetchInvoices(); }
                              catch (e: any) { showMsg(false, e?.message || 'Cancel failed'); }
                              finally { setLoading(false); }
                            }}
                            className="px-2 py-1 bg-red-500/10 text-red-400 border border-red-500/20 text-xs font-bold rounded-lg hover:bg-red-500/20 transition-all flex items-center gap-1"
                          >
                            <Ban size={11} /> Cancel
                          </button>
                        )}
                        {inv.state === 'cancel' && (
                          <button
                            onClick={async () => {
                              setLoading(true);
                              try { await queenCall('account.move', 'button_draft', [[inv.id]]); showMsg(true, 'Reset to draft.'); await fetchInvoices(); }
                              catch (e: any) { showMsg(false, e?.message || 'Reset failed'); }
                              finally { setLoading(false); }
                            }}
                            className="px-2 py-1 bg-amber-500/10 text-amber-400 border border-amber-500/20 text-xs font-bold rounded-lg hover:bg-amber-500/20 transition-all flex items-center gap-1"
                          >
                            <RotateCcw size={11} /> Draft
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
