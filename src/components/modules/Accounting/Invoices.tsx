import React, { useState, useEffect } from 'react';
import { useTheme } from '../../../context/ThemeContext';
import { useAuth } from '../../../context/AuthContext';
import { searchRead, createRecord, odooCall } from '../../../services/odoo';
import BulkDeleteBar from '../../ui/BulkDeleteBar';
import { downloadOdooReport, REPORTS } from '../../../utils/odooReports';
import {
  Plus, RefreshCw, Search, Eye, CheckCircle2, Clock,
  AlertCircle, X, FileText, FileDown, DollarSign, TrendingUp, Send, Trash2, RotateCcw
} from 'lucide-react';

interface Invoice {
  id: number;
  name: string;
  partner_id: [number, string] | false;
  invoice_date: string;
  invoice_date_due: string;
  amount_total: number;
  amount_residual: number;
  payment_state: string;
  state: string;
  journal_id: [number, string] | false;
  narration: string;
}

interface InvLine {
  product_id: number | '';
  product_name: string;
  quantity: number;
  price_unit: number;
  name: string;
  tax_ids: number[];
}

interface Partner { id: number; name: string; }
interface Journal { id: number; name: string; }
interface Product { id: number; name: string; list_price: number; }
interface PaymentTerm { id: number; name: string; }
interface Tax { id: number; name: string; }

const PAY_CFG: Record<string, { label: string; badge: string }> = {
  paid: { label: 'Paid', badge: 'badge-green' },
  partial: { label: 'Partial', badge: 'badge-blue' },
  not_paid: { label: 'Unpaid', badge: 'badge-gray' },
  overdue: { label: 'Overdue', badge: 'badge-red' },
  in_payment: { label: 'In Payment', badge: 'badge-violet' },
};

export default function Invoices() {
  const { isDark } = useTheme();
  const { user } = useAuth();
  const isAdmin = !!user?.is_admin;
  const [selIds, setSelIds] = useState<Set<number>>(new Set());
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedInv, setSelectedInv] = useState<Invoice | null>(null);
  const [createModal, setCreateModal] = useState(false);
  const [payModal, setPayModal] = useState<Invoice | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);

  // Ref data
  const [partners, setPartners] = useState<Partner[]>([]);
  const [journals, setJournals] = useState<Journal[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [paymentTerms, setPaymentTerms] = useState<PaymentTerm[]>([]);
  const [saleTaxes, setSaleTaxes] = useState<Tax[]>([]);
  const [partnerSearch, setPartnerSearch] = useState('');
  const [showPartDrop, setShowPartDrop] = useState(false);

  // Create form
  const [form, setForm] = useState({
    partner_id: '' as number | '',
    partner_name: '',
    journal_id: '' as number | '',
    invoice_date: new Date().toISOString().slice(0, 10),
    invoice_date_due: '',
    payment_term_id: '' as number | '',
    narration: '',
    ref: '',
  });
  const [lines, setLines] = useState<InvLine[]>([{ product_id: '', product_name: '', quantity: 1, price_unit: 0, name: '', tax_ids: [] }]);
  const [prodSearch, setProdSearch] = useState('');
  const [activeProdLine, setActiveProdLine] = useState<number | null>(null);

  // Detail modal lines
  const [detailLines, setDetailLines] = useState<{ product_id: [number, string] | false; name: string; quantity: number; price_unit: number; price_subtotal: number }[]>([]);
  const [loadingLines, setLoadingLines] = useState(false);

  // Payment form
  const [payForm, setPayForm] = useState({ amount: '', payment_date: new Date().toISOString().slice(0, 10), journal_id: '' as number | '' });
  const [payJournals, setPayJournals] = useState<Journal[]>([]);

  const showMsg = (ok: boolean, msg: string) => { setToast({ ok, msg }); setTimeout(() => setToast(null), 5000); };

  useEffect(() => {
    if (!selectedInv) { setDetailLines([]); return; }
    setLoadingLines(true);
    searchRead<any>('account.move.line', {
      domain: [['move_id', '=', selectedInv.id], ['display_type', '=', 'product']],
      fields: ['product_id', 'name', 'quantity', 'price_unit', 'price_subtotal'],
      limit: 0,
    }).then(r => setDetailLines(Array.isArray(r) ? r : [])).catch(() => {}).finally(() => setLoadingLines(false));
  }, [selectedInv]);

  const syncData = async () => {
    setLoading(true);
    try {
      const r = await searchRead<Invoice>('account.move', {
        domain: [['move_type', '=', 'out_invoice']],
        fields: ['id', 'name', 'partner_id', 'invoice_date', 'invoice_date_due', 'amount_total', 'amount_residual', 'state', 'payment_state', 'journal_id', 'narration'],
        limit: 0, order: 'invoice_date desc',
      });
      setInvoices(Array.isArray(r) ? r : []);
    } catch (e: any) { showMsg(false, 'Sync failed: ' + e.message); }
    finally { setLoading(false); }
  };

  const loadRefs = async () => {
    const [ps, js, pjs, pts, txs] = await Promise.allSettled([
      searchRead<Partner>('res.partner', { fields: ['id', 'name'], domain: [['active', '=', true], ['customer_rank', '>', 0]], limit: 0 }),
      searchRead<Journal>('account.journal', { fields: ['id', 'name'], domain: [['type', '=', 'sale']], limit: 50 }),
      searchRead<Journal>('account.journal', { fields: ['id', 'name'], domain: [['type', 'in', ['bank', 'cash']]], limit: 20 }),
      searchRead<PaymentTerm>('account.payment.term', { fields: ['id', 'name'], domain: [], limit: 0 }),
      searchRead<Tax>('account.tax', { fields: ['id', 'name'], domain: [['type_tax_use', '=', 'sale'], ['active', '=', true]], limit: 0 }),
    ]);
    if (ps.status === 'fulfilled') setPartners(ps.value || []);
    if (js.status === 'fulfilled') {
      setJournals(js.value || []);
      if (js.value?.length > 0) setForm(f => ({ ...f, journal_id: js.value[0].id }));
    }
    if (pjs.status === 'fulfilled') {
      setPayJournals(pjs.value || []);
      if (pjs.value?.length > 0) setPayForm(f => ({ ...f, journal_id: pjs.value[0].id }));
    }
    if (pts.status === 'fulfilled') setPaymentTerms(pts.value || []);
    if (txs.status === 'fulfilled') setSaleTaxes(txs.value || []);
  };

  const searchProducts = async (q: string) => {
    if (!q || q.length < 2) { setProducts([]); return; }
    const r = await searchRead<Product>('product.product', {
      fields: ['id', 'name', 'list_price'],
      domain: [['sale_ok', '=', true], '|', ['name', 'ilike', q], ['default_code', 'ilike', q]],
      limit: 15,
    });
    setProducts(r || []);
  };

  useEffect(() => { syncData(); loadRefs(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.partner_id || !form.journal_id) return;
    setSubmitting(true);
    try {
      const invLines = lines.filter(l => l.quantity > 0 && l.price_unit > 0).map(l => [0, 0, {
        ...(l.product_id ? { product_id: l.product_id } : {}),
        name: l.name || l.product_name || 'Service',
        quantity: l.quantity,
        price_unit: l.price_unit,
        ...(l.tax_ids.length > 0 ? { tax_ids: [[6, 0, l.tax_ids]] } : {}),
      }]);
      if (invLines.length === 0) { showMsg(false, 'Add at least one line item.'); return; }

      const vals: Record<string, any> = {
        move_type: 'out_invoice',
        partner_id: form.partner_id,
        journal_id: form.journal_id,
        invoice_date: form.invoice_date,
        narration: form.narration,
        ref: form.ref,
        invoice_line_ids: invLines,
      };
      if (form.payment_term_id) vals.invoice_payment_term_id = form.payment_term_id;
      if (!form.payment_term_id && form.invoice_date_due) vals.invoice_date_due = form.invoice_date_due;

      const id = await createRecord('account.move', vals);
      await odooCall('account.move', 'action_post', [[id]], {});
      showMsg(true, 'Invoice created and posted successfully.');
      setCreateModal(false);
      resetForm();
      syncData();
    } catch (e: any) { showMsg(false, 'Create failed: ' + e.message); }
    finally { setSubmitting(false); }
  };

  const handleRegisterPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payModal || !payForm.journal_id) return;
    setSubmitting(true);
    try {
      // Get receivable line ID
      const moveLine = await searchRead<any>('account.move.line', {
        domain: [['move_id', '=', payModal.id], ['account_type', 'in', ['asset_receivable']]],
        fields: ['id'], limit: 1,
      });
      if (!moveLine?.length) throw new Error('No receivable line found on this invoice.');

      const wizardId = await createRecord('account.payment.register', {
        line_ids: [[6, 0, [moveLine[0].id]]],
        amount: parseFloat(payForm.amount) || payModal.amount_residual,
        payment_date: payForm.payment_date,
        journal_id: payForm.journal_id,
      });
      await odooCall('account.payment.register', 'action_create_payments', [[wizardId]], {});
      showMsg(true, 'Payment registered successfully.');
      setPayModal(null);
      syncData();
    } catch (e: any) { showMsg(false, 'Payment failed: ' + e.message); }
    finally { setSubmitting(false); }
  };

  const resetForm = () => {
    setForm({ partner_id: '', partner_name: '', journal_id: journals[0]?.id || '', invoice_date: new Date().toISOString().slice(0, 10), invoice_date_due: '', payment_term_id: '', narration: '', ref: '' });
    setLines([{ product_id: '', product_name: '', quantity: 1, price_unit: 0, name: '', tax_ids: [] }]);
    setPartnerSearch(''); setProducts([]);
  };

  const updateLine = (idx: number, key: keyof InvLine, val: any) => setLines(prev => prev.map((l, i) => i === idx ? { ...l, [key]: val } : l));

  const toggleLineTax = (idx: number, taxId: number) => {
    setLines(prev => prev.map((l, i) => {
      if (i !== idx) return l;
      const already = l.tax_ids.includes(taxId);
      return { ...l, tax_ids: already ? l.tax_ids.filter(t => t !== taxId) : [...l.tax_ids, taxId] };
    }));
  };

  const lineTotal = lines.reduce((s, l) => s + l.quantity * l.price_unit, 0);

  const filtered = invoices.filter(inv => {
    const ms = !search || inv.name?.toLowerCase().includes(search.toLowerCase()) || (Array.isArray(inv.partner_id) && inv.partner_id[1].toLowerCase().includes(search.toLowerCase()));
    const mf = statusFilter === 'all' || inv.payment_state === statusFilter;
    return ms && mf;
  });

  const totalRevenue = filtered.reduce((s, i) => s + i.amount_total, 0);
  const totalOutstanding = filtered.reduce((s, i) => s + i.amount_residual, 0);
  const overdueCount = filtered.filter(i => i.payment_state === 'overdue').length;
  const paidCount = filtered.filter(i => i.payment_state === 'paid').length;

  const st = isDark ? 'text-[#5a6a8a]' : 'text-gray-500';
  const pt = isDark ? 'text-white' : 'text-gray-900';
  const inp = `input text-xs py-2 ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`;
  const modalBg = `w-full rounded-2xl shadow-2xl border ${isDark ? 'bg-[#161b2e] border-[#2a3250]' : 'bg-white border-gray-200'}`;
  const filteredPartners = partners.filter(p => !partnerSearch || p.name.toLowerCase().includes(partnerSearch.toLowerCase())).slice(0, 10);

  return (
    <div className="space-y-5 animate-fade-in">
      {toast && (
        <div className={`fixed top-5 right-5 z-50 px-4 py-3 rounded-xl shadow-xl text-sm font-medium flex items-center gap-2
          ${toast.ok ? 'bg-green-500/15 border border-green-500/30 text-green-400' : 'bg-red-500/15 border border-red-500/30 text-red-400'}`}>
          {toast.ok ? <CheckCircle2 size={14} /> : <X size={14} />} {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className={`text-xl font-black ${pt}`}>Customer Invoices</h1>
          <p className={`text-xs mt-0.5 ${st}`}>Manage outbound invoices, track payments and receivables.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={syncData} disabled={loading} className="btn-secondary text-xs px-3 py-2">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Sync
          </button>
          <button onClick={() => { resetForm(); setCreateModal(true); }} className="btn-primary text-xs px-3 py-2">
            <Plus size={13} /> New Invoice
          </button>
        </div>
      </div>

      {overdueCount > 0 && (
        <div className="flex items-center gap-3 p-4 rounded-2xl border border-red-500/20 bg-red-500/5">
          <AlertCircle size={18} className="text-red-400 flex-shrink-0" />
          <p className="text-sm font-semibold text-red-400">{overdueCount} invoice{overdueCount > 1 ? 's are' : ' is'} overdue</p>
        </div>
      )}

      {/* KPI */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total Invoiced', value: `Rs.${(totalRevenue / 100000).toFixed(1)}L`, icon: TrendingUp, color: 'text-violet-400', bg: 'bg-violet-500/10' },
          { label: 'Outstanding', value: `Rs.${(totalOutstanding / 100000).toFixed(1)}L`, icon: Clock, color: 'text-amber-400', bg: 'bg-amber-500/10' },
          { label: 'Overdue', value: overdueCount.toString(), icon: AlertCircle, color: 'text-red-400', bg: 'bg-red-500/10' },
          { label: 'Paid', value: paidCount.toString(), icon: CheckCircle2, color: 'text-green-400', bg: 'bg-green-500/10' },
        ].map(s => (
          <div key={s.label} className={`rounded-2xl border p-4 flex items-center gap-3 ${isDark ? 'bg-[#161b2e] border-[#2a3250]' : 'bg-white border-gray-200'}`}>
            <div className={`w-11 h-11 rounded-xl ${s.bg} flex items-center justify-center`}><s.icon size={20} className={s.color} /></div>
            <div>
              <p className={`text-lg font-black ${pt}`}>{s.value}</p>
              <p className={`text-[10px] font-semibold uppercase tracking-wider ${st}`}>{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className={`rounded-2xl border p-3 flex flex-col sm:flex-row gap-3 ${isDark ? 'bg-[#161b2e] border-[#2a3250]' : 'bg-white border-gray-200'}`}>
        <div className="relative flex-1">
          <Search size={14} className={`absolute left-3 top-1/2 -translate-y-1/2 ${st}`} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search invoice # or customer..."
            className={`input pl-9 text-xs py-2.5 ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`} />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={`${inp} min-w-[140px]`}>
          <option value="all">All Status</option>
          <option value="paid">Paid</option>
          <option value="partial">Partial</option>
          <option value="not_paid">Unpaid</option>
          <option value="overdue">Overdue</option>
          <option value="in_payment">In Payment</option>
        </select>
      </div>

      {/* Table */}
      <div className={`rounded-2xl border overflow-hidden ${isDark ? 'bg-[#161b2e] border-[#2a3250]' : 'bg-white border-gray-200'}`}>
        {loading ? (
          <div className="flex items-center justify-center h-40 gap-3">
            <RefreshCw size={20} className="animate-spin text-violet-400" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table w-full">
              <thead>
                <tr>
                  {isAdmin && <th className="w-8"><input type="checkbox" className="rounded" checked={invoices.length > 0 && invoices.every(i => selIds.has(i.id))} onChange={e => setSelIds(e.target.checked ? new Set(invoices.map(i => i.id)) : new Set())} /></th>}
                  <th>Invoice #</th><th>Customer</th><th>Date</th><th>Due</th>
                  <th className="text-right">Total</th><th className="text-right">Outstanding</th>
                  <th className="text-center">Status</th><th className="text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(inv => (
                  <tr key={inv.id} className={`cursor-pointer ${selIds.has(inv.id) ? isDark ? 'bg-[#7367f0]/5' : 'bg-violet-50' : ''}`} onClick={() => setSelectedInv(inv)}>
                    {isAdmin && <td onClick={e => e.stopPropagation()}><input type="checkbox" className="rounded" checked={selIds.has(inv.id)} onChange={() => setSelIds(prev => { const n = new Set(prev); n.has(inv.id) ? n.delete(inv.id) : n.add(inv.id); return n; })} /></td>}
                    <td className="font-mono text-xs font-semibold text-violet-400">{inv.name}</td>
                    <td className={`font-medium ${pt}`}>{Array.isArray(inv.partner_id) ? inv.partner_id[1] : '--'}</td>
                    <td className={`text-xs ${st}`}>{inv.invoice_date}</td>
                    <td className={`text-xs font-semibold ${inv.payment_state === 'overdue' ? 'text-red-400' : st}`}>{inv.invoice_date_due}</td>
                    <td className={`text-right font-semibold ${pt}`}>Rs.{inv.amount_total.toLocaleString('en-IN')}</td>
                    <td className={`text-right font-bold ${inv.amount_residual > 0 ? 'text-amber-400' : 'text-green-400'}`}>
                      {inv.amount_residual > 0 ? `Rs.${inv.amount_residual.toLocaleString('en-IN')}` : '-- Cleared'}
                    </td>
                    <td className="text-center" onClick={e => e.stopPropagation()}>
                      <span className={PAY_CFG[inv.payment_state]?.badge || 'badge-gray'}>
                        {PAY_CFG[inv.payment_state]?.label || inv.payment_state}
                      </span>
                    </td>
                    <td className="text-center" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => setSelectedInv(inv)} className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-white/5 text-violet-400' : 'hover:bg-gray-100 text-violet-600'}`}><Eye size={13} /></button>
                        <button onClick={() => downloadOdooReport(REPORTS.invoice, inv.id, (inv.name || 'invoice').replace(/[\\/]/g, '-')).catch(e => alert(e.message))} title="Download PDF" className="p-1.5 rounded-lg text-[#7367f0] hover:bg-[#7367f0]/10"><FileDown size={13} /></button>
                        {inv.payment_state !== 'paid' && inv.state === 'posted' && (
                          <button onClick={() => { setPayModal(inv); setPayForm(f => ({ ...f, amount: inv.amount_residual.toString() })); }}
                            className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-green-500/10 text-green-400' : 'hover:bg-green-50 text-green-600'}`} title="Register Payment">
                            <DollarSign size={13} />
                          </button>
                        )}
                        {inv.state === 'draft' && (
                          <button onClick={async () => { try { await odooCall('account.move', 'action_post', [[inv.id]], {}); syncData(); showMsg(true, 'Invoice posted.'); } catch (e: any) { showMsg(false, e.message); } }}
                            className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-blue-500/10 text-blue-400' : 'hover:bg-blue-50 text-blue-600'}`} title="Post Invoice">
                            <Send size={13} />
                          </button>
                        )}
                        {inv.state === 'posted' && (
                          <button onClick={async () => { try { await odooCall('account.move', 'button_draft', [[inv.id]], {}); syncData(); showMsg(true, 'Reset to draft.'); } catch (e: any) { showMsg(false, e.message); } }}
                            className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-amber-500/10 text-amber-400' : 'hover:bg-amber-50 text-amber-600'}`} title="Reset to Draft">
                            <RotateCcw size={13} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={isAdmin ? 9 : 8} className="text-center py-12">
                    <FileText size={32} className={`mx-auto mb-2 opacity-30 ${st}`} />
                    <p className={`text-sm ${st}`}>No invoices found.</p>
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selIds.size > 0 && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-5 py-3 rounded-2xl shadow-2xl border bg-amber-500/10 border-amber-500/20 backdrop-blur-sm">
          <RotateCcw size={14} className="text-amber-400" />
          <span className="text-sm font-semibold text-amber-400">{selIds.size} selected</span>
          <button
            className="btn-primary text-xs px-3 py-1.5 bg-amber-500 hover:bg-amber-400 border-0"
            onClick={async () => {
              try {
                await odooCall('account.move', 'button_draft', [Array.from(selIds)], {});
                setSelIds(new Set()); syncData(); showMsg(true, 'Reset to draft.');
              } catch (e: any) { showMsg(false, e.message); }
            }}
          >Reset to Draft</button>
        </div>
      )}

      <BulkDeleteBar model="account.move" label="invoice" ids={Array.from(selIds)}
        onClear={() => setSelIds(new Set())} onDeleted={() => { setSelIds(new Set()); syncData(); }} />

      {/* Detail Modal */}
      {selectedInv && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in" onClick={() => setSelectedInv(null)}>
          <div className={`${modalBg} max-w-lg max-h-[90vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
            <div className={`flex justify-between items-center px-5 py-4 border-b ${isDark ? 'border-[#2a3250]' : 'border-gray-100'}`}>
              <div>
                <p className="font-black text-violet-400 font-mono">{selectedInv.name}</p>
                <p className={`text-xs ${st}`}>{Array.isArray(selectedInv.partner_id) ? selectedInv.partner_id[1] : '--'}</p>
              </div>
              <button onClick={() => setSelectedInv(null)} className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-white/5 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}><X size={16} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3 text-xs">
                {[
                  { label: 'Invoice Date', value: selectedInv.invoice_date },
                  { label: 'Due Date', value: selectedInv.invoice_date_due },
                  { label: 'Journal', value: Array.isArray(selectedInv.journal_id) ? selectedInv.journal_id[1] : '--' },
                  { label: 'Total Amount', value: `Rs.${selectedInv.amount_total.toLocaleString('en-IN')}` },
                  { label: 'Outstanding', value: `Rs.${selectedInv.amount_residual.toLocaleString('en-IN')}` },
                  { label: 'State', value: selectedInv.state },
                ].map(f => (
                  <div key={f.label} className={`p-3 rounded-xl border ${isDark ? 'bg-[#12172a] border-[#2a3250]' : 'bg-gray-50 border-gray-100'}`}>
                    <p className={`${st} font-semibold uppercase tracking-wider text-[10px]`}>{f.label}</p>
                    <p className={`font-bold mt-1 ${pt}`}>{f.value}</p>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <span className={PAY_CFG[selectedInv.payment_state]?.badge || 'badge-gray'}>{PAY_CFG[selectedInv.payment_state]?.label}</span>
              </div>

              {/* Invoice Lines */}
              <div>
                <p className={`text-[10px] font-semibold uppercase tracking-wider mb-2 ${st}`}>Products</p>
                {loadingLines ? (
                  <div className="flex items-center gap-2 py-3"><RefreshCw size={14} className="animate-spin text-violet-400" /><span className={`text-xs ${st}`}>Loading...</span></div>
                ) : detailLines.length === 0 ? (
                  <p className={`text-xs ${st}`}>No line items.</p>
                ) : (
                  <div className={`rounded-xl border overflow-hidden ${isDark ? 'border-[#2a3250]' : 'border-gray-100'}`}>
                    <table className="w-full text-xs">
                      <thead className={`${isDark ? 'bg-[#1e2440] text-[#5a6a8a]' : 'bg-gray-50 text-gray-500'}`}>
                        <tr>
                          <th className="text-left px-3 py-2">Product</th>
                          <th className="text-right px-3 py-2">Qty</th>
                          <th className="text-right px-3 py-2">Unit Price</th>
                          <th className="text-right px-3 py-2">Subtotal</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailLines.map((ln, i) => (
                          <tr key={i} className={`border-t ${isDark ? 'border-[#2a3250]' : 'border-gray-100'}`}>
                            <td className={`px-3 py-2 ${pt}`}>{Array.isArray(ln.product_id) ? ln.product_id[1] : ln.name}</td>
                            <td className={`px-3 py-2 text-right ${st}`}>{ln.quantity}</td>
                            <td className={`px-3 py-2 text-right ${st}`}>Rs.{ln.price_unit.toLocaleString('en-IN')}</td>
                            <td className={`px-3 py-2 text-right font-semibold ${pt}`}>Rs.{ln.price_subtotal.toLocaleString('en-IN')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {selectedInv.narration && <p className={`text-xs ${st}`}>{selectedInv.narration}</p>}
              {selectedInv.payment_state !== 'paid' && selectedInv.state === 'posted' && (
                <button onClick={() => { setPayModal(selectedInv); setPayForm(f => ({ ...f, amount: selectedInv.amount_residual.toString() })); setSelectedInv(null); }} className="w-full btn-primary justify-center py-2.5">
                  <DollarSign size={14} /> Register Payment
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Register Payment Modal */}
      {payModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in" onClick={() => setPayModal(null)}>
          <div className={`${modalBg} max-w-sm max-h-[90vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
            <div className={`flex justify-between items-center px-5 py-4 border-b ${isDark ? 'border-[#2a3250]' : 'border-gray-100'}`}>
              <div>
                <p className="font-bold text-sm">Register Payment</p>
                <p className={`text-xs ${st}`}>{payModal.name}</p>
              </div>
              <button onClick={() => setPayModal(null)} className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-white/5 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}><X size={16} /></button>
            </div>
            <form onSubmit={handleRegisterPayment} className="p-5 space-y-4">
              <div className={`p-3 rounded-xl ${isDark ? 'bg-[#1e2440]' : 'bg-gray-50'}`}>
                <p className={`text-xs ${st}`}>Outstanding</p>
                <p className="text-lg font-black text-amber-400">Rs.{payModal.amount_residual.toLocaleString('en-IN')}</p>
              </div>
              <div>
                <label className={`text-[10px] font-semibold block mb-1 ${st}`}>Payment Amount (Rs.) *</label>
                <input type="number" step="0.01" value={payForm.amount} onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))} required
                  className={`${inp} w-full`} />
              </div>
              <div>
                <label className={`text-[10px] font-semibold block mb-1 ${st}`}>Payment Date *</label>
                <input type="date" value={payForm.payment_date} onChange={e => setPayForm(f => ({ ...f, payment_date: e.target.value }))} required
                  className={`${inp} w-full`} />
              </div>
              <div>
                <label className={`text-[10px] font-semibold block mb-1 ${st}`}>Payment Journal *</label>
                <select value={payForm.journal_id} onChange={e => setPayForm(f => ({ ...f, journal_id: Number(e.target.value) }))} required className={`${inp} w-full`}>
                  {payJournals.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
                </select>
              </div>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setPayModal(null)} className="btn-secondary flex-1 justify-center py-2.5">Cancel</button>
                <button type="submit" disabled={submitting} className="btn-primary flex-1 justify-center py-2.5">
                  {submitting ? <RefreshCw size={14} className="animate-spin" /> : <DollarSign size={14} />}
                  Confirm
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Invoice Modal */}
      {createModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in" onClick={() => setCreateModal(false)}>
          <div className={`${modalBg} max-w-2xl w-full max-h-[90vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
            <div className={`flex justify-between items-center px-5 py-4 border-b sticky top-0 z-10 ${isDark ? 'bg-[#161b2e] border-[#2a3250]' : 'bg-white border-gray-100'}`}>
              <h3 className={`font-bold ${pt}`}>Create Customer Invoice</h3>
              <button onClick={() => setCreateModal(false)} className={`p-1.5 rounded-lg ${isDark ? 'text-[#5a6a8a] hover:bg-white/5' : 'text-gray-400 hover:bg-gray-100'}`}><X size={16} /></button>
            </div>
            <form onSubmit={handleCreate} className="p-5 space-y-4">
              {/* Customer */}
              <div className="relative">
                <label className={`text-[10px] font-semibold block mb-1 ${st}`}>Customer *</label>
                <input value={partnerSearch} onChange={e => { setPartnerSearch(e.target.value); setShowPartDrop(true); setForm(f => ({ ...f, partner_id: '', partner_name: '' })); }}
                  onFocus={() => setShowPartDrop(true)} placeholder="Search customer..." className={`${inp} w-full`} />
                {form.partner_id && <div className="mt-1 text-xs font-semibold text-[#7367f0]">-- {form.partner_name}</div>}
                {showPartDrop && filteredPartners.length > 0 && !form.partner_id && (
                  <div className={`absolute z-20 w-full rounded-xl border shadow-xl mt-1 max-h-40 overflow-y-auto ${isDark ? 'bg-[#1e2440] border-[#2a3250]' : 'bg-white border-gray-200'}`}>
                    {filteredPartners.map(p => (
                      <button key={p.id} type="button" className={`w-full text-left px-3 py-2 text-xs hover:bg-[#7367f0]/10 ${isDark ? 'text-white' : 'text-gray-800'}`}
                        onClick={() => { setForm(f => ({ ...f, partner_id: p.id, partner_name: p.name })); setPartnerSearch(p.name); setShowPartDrop(false); }}>
                        {p.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={`text-[10px] font-semibold block mb-1 ${st}`}>Sales Journal *</label>
                  <select value={form.journal_id} onChange={e => setForm(f => ({ ...f, journal_id: Number(e.target.value) }))} className={`${inp} w-full`} required>
                    {journals.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className={`text-[10px] font-semibold block mb-1 ${st}`}>Invoice Date</label>
                  <input type="date" value={form.invoice_date} onChange={e => setForm(f => ({ ...f, invoice_date: e.target.value }))} className={`${inp} w-full`} />
                </div>
              </div>

              {/* Payment Terms + Due Date */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={`text-[10px] font-semibold block mb-1 ${st}`}>Payment Terms</label>
                  <select value={form.payment_term_id} onChange={e => setForm(f => ({ ...f, payment_term_id: e.target.value ? Number(e.target.value) : '' }))} className={`${inp} w-full`}>
                    <option value="">-- None (use due date) --</option>
                    {paymentTerms.map(pt2 => <option key={pt2.id} value={pt2.id}>{pt2.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className={`text-[10px] font-semibold block mb-1 ${st}`}>Due Date{form.payment_term_id ? ' (overridden by terms)' : ''}</label>
                  <input type="date" value={form.invoice_date_due} onChange={e => setForm(f => ({ ...f, invoice_date_due: e.target.value }))}
                    disabled={!!form.payment_term_id} className={`${inp} w-full ${form.payment_term_id ? 'opacity-40 cursor-not-allowed' : ''}`} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={`text-[10px] font-semibold block mb-1 ${st}`}>Reference / PO No.</label>
                  <input value={form.ref} onChange={e => setForm(f => ({ ...f, ref: e.target.value }))} placeholder="e.g. PO-2026-001" className={`${inp} w-full`} />
                </div>
              </div>

              {/* Invoice Lines */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className={`text-[10px] font-semibold ${st}`}>Invoice Lines *</label>
                  <button type="button" onClick={() => setLines(p => [...p, { product_id: '', product_name: '', quantity: 1, price_unit: 0, name: '', tax_ids: [] }])}
                    className="text-xs text-[#7367f0] font-semibold flex items-center gap-1 hover:underline"><Plus size={11} /> Add Line</button>
                </div>
                <div className={`rounded-xl border overflow-x-auto ${isDark ? 'border-[#2a3250]' : 'border-gray-200'}`}>
                  <table className="w-full min-w-[640px]">
                    <thead>
                      <tr className={`text-xs font-bold uppercase tracking-wider ${isDark ? 'bg-[#1e2440] text-[#5a6a8a]' : 'bg-gray-50 text-gray-500'}`}>
                        <th className="px-3 py-3 text-left">Product / Description</th>
                        <th className="px-3 py-3 text-right w-24">Qty</th>
                        <th className="px-3 py-3 text-right w-32">Price</th>
                        <th className="px-3 py-3 text-left w-36">Taxes</th>
                        <th className="px-3 py-3 text-right w-32">Subtotal</th>
                        <th className="px-3 py-3 w-10"></th>
                      </tr>
                    </thead>
                    <tbody className={`divide-y ${isDark ? 'divide-[#2a3250]' : 'divide-gray-100'}`}>
                      {lines.map((line, idx) => (
                        <tr key={idx}>
                          <td className="px-3 py-2 min-w-[200px]">
                            <div className="relative">
                              <input value={activeProdLine === idx ? prodSearch : (line.product_name || line.name)}
                                onChange={e => { setProdSearch(e.target.value); setActiveProdLine(idx); updateLine(idx, 'product_id', ''); updateLine(idx, 'product_name', ''); searchProducts(e.target.value); }}
                                onFocus={() => setActiveProdLine(idx)}
                                placeholder="Product or description..."
                                className={`input text-sm py-3 w-full ${isDark ? 'bg-[#12172a] border-[#2a3250] text-white' : ''}`}
                              />
                              {activeProdLine === idx && products.length > 0 && !line.product_id && (
                                <div className={`absolute z-30 w-full rounded-xl border shadow-xl mt-1 max-h-44 overflow-y-auto ${isDark ? 'bg-[#1e2440] border-[#2a3250]' : 'bg-white border-gray-200'}`}>
                                  {products.map(p => (
                                    <button key={p.id} type="button" className={`w-full text-left px-3 py-2 text-sm hover:bg-[#7367f0]/10 ${isDark ? 'text-white' : 'text-gray-800'}`}
                                      onClick={() => { updateLine(idx, 'product_id', p.id); updateLine(idx, 'product_name', p.name); updateLine(idx, 'price_unit', p.list_price); updateLine(idx, 'name', p.name); setActiveProdLine(null); setProducts([]); }}>
                                      {p.name}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                            {!line.product_id && (
                              <input value={line.name} onChange={e => updateLine(idx, 'name', e.target.value)} placeholder="Description (if no product)"
                                className={`input text-sm py-2 mt-1 w-full ${isDark ? 'bg-[#12172a] border-[#2a3250] text-white' : ''}`} />
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <input type="number" min="1" step="1" value={line.quantity} onChange={e => updateLine(idx, 'quantity', Number(e.target.value))}
                              className={`input text-sm py-3 text-right w-full ${isDark ? 'bg-[#12172a] border-[#2a3250] text-white' : ''}`} />
                          </td>
                          <td className="px-3 py-2">
                            <input type="number" min="0" step="0.01" value={line.price_unit} onChange={e => updateLine(idx, 'price_unit', Number(e.target.value))}
                              className={`input text-sm py-3 text-right w-full ${isDark ? 'bg-[#12172a] border-[#2a3250] text-white' : ''}`} />
                          </td>
                          <td className="px-3 py-2">
                            {saleTaxes.length > 0 ? (
                              <div className={`rounded-lg border text-sm max-h-24 overflow-y-auto ${isDark ? 'bg-[#12172a] border-[#2a3250]' : 'bg-white border-gray-200'}`}>
                                {saleTaxes.map(tx => (
                                  <label key={tx.id} className={`flex items-center gap-1.5 px-2 py-1 cursor-pointer hover:bg-[#7367f0]/10 ${isDark ? 'text-white' : 'text-gray-800'}`}>
                                    <input type="checkbox" checked={line.tax_ids.includes(tx.id)} onChange={() => toggleLineTax(idx, tx.id)} className="accent-[#7367f0]" />
                                    <span className="truncate text-xs">{tx.name}</span>
                                  </label>
                                ))}
                              </div>
                            ) : (
                              <span className={`text-xs ${st}`}>--</span>
                            )}
                          </td>
                          <td className={`px-3 py-2 text-right text-sm font-semibold ${pt}`}>Rs.{(line.quantity * line.price_unit).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                          <td className="px-3 py-2 text-center">
                            {lines.length > 1 && <button type="button" onClick={() => setLines(p => p.filter((_, i) => i !== idx))} className="text-red-400 hover:text-red-300"><Trash2 size={14} /></button>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className={`${isDark ? 'border-t border-[#2a3250]' : 'border-t border-gray-200'}`}>
                        <td colSpan={4} className={`px-3 py-3 text-sm font-bold text-right ${st}`}>Total (excl. tax):</td>
                        <td className="px-3 py-3 text-right text-base font-black text-[#7367f0]">Rs.{lineTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              <div>
                <label className={`text-[10px] font-semibold block mb-1 ${st}`}>Notes / Narration</label>
                <textarea value={form.narration} onChange={e => setForm(f => ({ ...f, narration: e.target.value }))} rows={2}
                  className={`input text-xs py-2 w-full resize-none ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`} />
              </div>

              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setCreateModal(false)} className="btn-secondary flex-1 justify-center py-2.5">Cancel</button>
                <button type="submit" disabled={submitting || !form.partner_id} className="btn-primary flex-1 justify-center py-2.5">
                  {submitting ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
                  {submitting ? 'Posting...' : 'Create & Post'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

