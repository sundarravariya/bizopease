import React, { useState, useEffect } from 'react';
import { useTheme } from '../../../context/ThemeContext';
import { useAuth } from '../../../context/AuthContext';
import { searchRead, createRecord, odooCall } from '../../../services/odoo';
import BulkDeleteBar from '../../ui/BulkDeleteBar';
import {
  Plus, RefreshCw, Search, Eye, DollarSign, X,
  AlertTriangle, CheckCircle, Clock, FileText, Send, Trash2
} from 'lucide-react';

interface Bill {
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
  ref: string;
  narration: string;
}

interface BillLine {
  product_id: number | '';
  product_name: string;
  quantity: number;
  price_unit: number;
  name: string;
}

interface Partner { id: number; name: string; }
interface Journal { id: number; name: string; }
interface Product { id: number; name: string; standard_price: number; }

const PAY_STATE_BADGE: Record<string, string> = {
  not_paid: 'badge-red', partial: 'badge-gold', in_payment: 'badge-blue', paid: 'badge-green',
};
const PAY_STATE_LABEL: Record<string, string> = {
  not_paid: 'Unpaid', partial: 'Partial', in_payment: 'In Payment', paid: 'Paid',
};

export default function Bills() {
  const { isDark } = useTheme();
  const { user } = useAuth();
  const isAdmin = !!user?.is_admin;
  const [selIds, setSelIds] = useState<Set<number>>(new Set());
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [payFilter, setPayFilter] = useState('all');
  const [detailBill, setDetailBill] = useState<Bill | null>(null);
  const [payBill, setPayBill] = useState<Bill | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);

  // Refs
  const [partners, setPartners] = useState<Partner[]>([]);
  const [journals, setJournals] = useState<Journal[]>([]);
  const [payJournals, setPayJournals] = useState<Journal[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [partnerSearch, setPartnerSearch] = useState('');
  const [showPartDrop, setShowPartDrop] = useState(false);
  const [activeProdLine, setActiveProdLine] = useState<number | null>(null);
  const [prodSearch, setProdSearch] = useState('');

  // Create form
  const [form, setForm] = useState({
    partner_id: '' as number | '',
    partner_name: '',
    journal_id: '' as number | '',
    invoice_date: new Date().toISOString().slice(0, 10),
    invoice_date_due: '',
    ref: '',
    narration: '',
  });
  const [lines, setLines] = useState<BillLine[]>([{ product_id: '', product_name: '', quantity: 1, price_unit: 0, name: '' }]);

  // Pay form
  const [payForm, setPayForm] = useState({ amount: '', payment_date: new Date().toISOString().slice(0, 10), journal_id: '' as number | '' });

  const showMsg = (ok: boolean, msg: string) => { setToast({ ok, msg }); setTimeout(() => setToast(null), 5000); };
  const today = new Date().toISOString().split('T')[0];

  const syncData = async () => {
    setLoading(true);
    try {
      const r = await searchRead<Bill>('account.move', {
        domain: [['move_type', '=', 'in_invoice']],
        fields: ['id', 'name', 'partner_id', 'invoice_date', 'invoice_date_due', 'amount_total', 'amount_residual', 'payment_state', 'state', 'journal_id', 'ref', 'narration'],
        limit: 0, order: 'id desc',
      });
      setBills(Array.isArray(r) ? r : []);
    } catch (e: any) { showMsg(false, 'Sync failed: ' + e.message); }
    finally { setLoading(false); }
  };

  const loadRefs = async () => {
    const [ps, js, pjs] = await Promise.allSettled([
      searchRead<Partner>('res.partner', { fields: ['id', 'name'], domain: [['active', '=', true], ['supplier_rank', '>', 0]], limit: 0 }),
      searchRead<Journal>('account.journal', { fields: ['id', 'name'], domain: [['type', '=', 'purchase']], limit: 20 }),
      searchRead<Journal>('account.journal', { fields: ['id', 'name'], domain: [['type', 'in', ['bank', 'cash']]], limit: 20 }),
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
  };

  const searchProducts = async (q: string) => {
    if (!q || q.length < 2) { setProducts([]); return; }
    const r = await searchRead<Product>('product.product', {
      fields: ['id', 'name', 'standard_price'],
      domain: [['purchase_ok', '=', true], '|', ['name', 'ilike', q], ['default_code', 'ilike', q]],
      limit: 15,
    });
    setProducts(r || []);
  };

  useEffect(() => { syncData(); loadRefs(); }, []);

  const isOverdue = (b: Bill) => !!b.invoice_date_due && b.invoice_date_due < today && b.payment_state !== 'paid' && b.state === 'posted';

  const handleCreate = async () => {
    if (!form.partner_id || !form.journal_id) { showMsg(false, 'Vendor and journal are required.'); return; }
    const validLines = lines.filter(l => l.quantity > 0 && l.price_unit > 0);
    if (!validLines.length) { showMsg(false, 'Add at least one line item.'); return; }
    setSubmitting(true);
    try {
      const invLines = validLines.map(l => [0, 0, {
        ...(l.product_id ? { product_id: l.product_id } : {}),
        name: l.name || l.product_name || 'Purchase',
        quantity: l.quantity,
        price_unit: l.price_unit,
      }]);

      const vals: Record<string, any> = {
        move_type: 'in_invoice',
        partner_id: form.partner_id,
        journal_id: form.journal_id,
        invoice_date: form.invoice_date,
        ref: form.ref,
        narration: form.narration,
        invoice_line_ids: invLines,
      };
      if (form.invoice_date_due) vals.invoice_date_due = form.invoice_date_due;

      const id = await createRecord('account.move', vals);
      await odooCall('account.move', 'action_post', [[id]], {});
      showMsg(true, 'Bill created and posted.');
      setShowCreate(false);
      resetForm();
      syncData();
    } catch (e: any) { showMsg(false, 'Create failed: ' + e.message); }
    finally { setSubmitting(false); }
  };

  const handleRegisterPayment = async () => {
    if (!payBill || !payForm.journal_id) return;
    setSubmitting(true);
    try {
      const moveLine = await searchRead<any>('account.move.line', {
        domain: [['move_id', '=', payBill.id], ['account_type', 'in', ['liability_payable']]],
        fields: ['id'], limit: 1,
      });
      if (!moveLine?.length) throw new Error('No payable line found.');
      const wizardId = await createRecord('account.payment.register', {
        line_ids: [[6, 0, [moveLine[0].id]]],
        amount: parseFloat(payForm.amount) || payBill.amount_residual,
        payment_date: payForm.payment_date,
        journal_id: payForm.journal_id,
      });
      await odooCall('account.payment.register', 'action_create_payments', [[wizardId]], {});
      showMsg(true, 'Payment registered successfully.');
      setPayBill(null);
      syncData();
    } catch (e: any) { showMsg(false, 'Payment failed: ' + e.message); }
    finally { setSubmitting(false); }
  };

  const resetForm = () => {
    setForm({ partner_id: '', partner_name: '', journal_id: journals[0]?.id || '', invoice_date: today, invoice_date_due: '', ref: '', narration: '' });
    setLines([{ product_id: '', product_name: '', quantity: 1, price_unit: 0, name: '' }]);
    setPartnerSearch(''); setProducts([]);
  };

  const updateLine = (idx: number, key: keyof BillLine, val: any) => setLines(p => p.map((l, i) => i === idx ? { ...l, [key]: val } : l));
  const lineTotal = lines.reduce((s, l) => s + l.quantity * l.price_unit, 0);

  const filtered = bills.filter(b => {
    const matchSearch = !search || b.name?.toLowerCase().includes(search.toLowerCase()) || (Array.isArray(b.partner_id) && b.partner_id[1].toLowerCase().includes(search.toLowerCase()));
    return matchSearch && (payFilter === 'all' || b.payment_state === payFilter);
  });

  const totalPayable = bills.filter(b => b.payment_state !== 'paid').reduce((s, b) => s + b.amount_residual, 0);
  const overdueCount = bills.filter(isOverdue).length;

  const st = isDark ? 'text-[#5a6a8a]' : 'text-gray-500';
  const pt = isDark ? 'text-white' : 'text-gray-900';
  const inp = `input text-xs py-2 ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`;
  const modalBg = `w-full rounded-2xl shadow-2xl border ${isDark ? 'bg-[#161b2e] border-[#2a3250]' : 'bg-white border-gray-200'}`;
  const mh = `flex items-center justify-between p-5 border-b ${isDark ? 'border-[#2a3250]' : 'border-gray-200'}`;
  const mf = `flex justify-end gap-3 p-5 border-t ${isDark ? 'border-[#2a3250]' : 'border-gray-200'}`;
  const filteredPartners = partners.filter(p => !partnerSearch || p.name.toLowerCase().includes(partnerSearch.toLowerCase())).slice(0, 10);

  return (
    <div className="space-y-5 animate-fade-in">
      {toast && (
        <div className={`fixed top-5 right-5 z-50 px-4 py-3 rounded-xl shadow-xl text-sm font-medium flex items-center gap-2
          ${toast.ok ? 'bg-green-500/15 border border-green-500/30 text-green-400' : 'bg-red-500/15 border border-red-500/30 text-red-400'}`}>
          {toast.ok ? <CheckCircle size={14} /> : <X size={14} />} {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className={`text-xl font-black ${pt}`}>Vendor Bills</h1>
          <p className={`text-xs mt-0.5 ${st}`}>Accounts payable -- track vendor invoices and payments</p>
        </div>
        <div className="flex gap-2">
          <button onClick={syncData} disabled={loading} className="btn-secondary text-xs px-3 py-2">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Sync
          </button>
          <button onClick={() => { resetForm(); setShowCreate(true); }} className="btn-primary text-xs px-3 py-2">
            <Plus size={13} /> Add Bill
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Bills', value: bills.length.toString(), icon: FileText, color: 'text-[#7367f0]', bg: 'bg-[#7367f0]/10' },
          { label: 'Total Payable', value: `Rs.${(totalPayable / 100000).toFixed(1)}L`, icon: DollarSign, color: 'text-amber-400', bg: 'bg-amber-500/10' },
          { label: 'Overdue', value: overdueCount.toString(), icon: AlertTriangle, color: 'text-red-400', bg: 'bg-red-500/10' },
          { label: 'Paid', value: bills.filter(b => b.payment_state === 'paid').length.toString(), icon: CheckCircle, color: 'text-green-400', bg: 'bg-green-500/10' },
        ].map(s => (
          <div key={s.label} className="card p-4 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl ${s.bg} flex items-center justify-center`}><s.icon size={18} className={s.color} /></div>
            <div>
              <p className={`text-xl font-black ${pt}`}>{s.value}</p>
              <p className={`text-[10px] font-medium ${st}`}>{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {overdueCount > 0 && (
        <div className={`flex items-center gap-3 p-4 rounded-xl border ${isDark ? 'bg-amber-500/10 border-amber-500/30' : 'bg-amber-50 border-amber-200'}`}>
          <AlertTriangle size={16} className="text-amber-400 shrink-0" />
          <p className={`text-xs font-semibold ${isDark ? 'text-amber-300' : 'text-amber-700'}`}>
            {overdueCount} bill{overdueCount > 1 ? 's are' : ' is'} past due and unpaid.
          </p>
        </div>
      )}

      {/* Filters */}
      <div className="card p-3 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={14} className={`absolute left-3 top-1/2 -translate-y-1/2 ${st}`} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search bill# or vendor..."
            className={`input pl-9 text-xs py-2 ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`} />
        </div>
        <select value={payFilter} onChange={e => setPayFilter(e.target.value)} className={inp}>
          <option value="all">All Status</option>
          <option value="not_paid">Unpaid</option>
          <option value="partial">Partial</option>
          <option value="in_payment">In Payment</option>
          <option value="paid">Paid</option>
        </select>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-40 gap-3">
            <RefreshCw size={18} className="animate-spin text-[#7367f0]" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table w-full">
              <thead>
                <tr>
                  {isAdmin && <th className="w-8"><input type="checkbox" className="rounded" checked={bills.length > 0 && bills.every(b => selIds.has(b.id))} onChange={e => setSelIds(e.target.checked ? new Set(bills.map(b => b.id)) : new Set())} /></th>}
                  <th>Bill #</th><th>Vendor</th><th>Bill Date</th><th>Due Date</th>
                  <th className="text-right">Total</th><th className="text-right">Outstanding</th>
                  <th className="text-center">Status</th><th className="text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(b => {
                  const overdue = isOverdue(b);
                  return (
                    <tr key={b.id} className={`${overdue ? isDark ? 'bg-red-500/5' : 'bg-red-50/40' : ''} ${selIds.has(b.id) ? isDark ? 'bg-[#7367f0]/5' : 'bg-violet-50' : ''}`}>
                      {isAdmin && <td><input type="checkbox" className="rounded" checked={selIds.has(b.id)} onChange={() => setSelIds(prev => { const n = new Set(prev); n.has(b.id) ? n.delete(b.id) : n.add(b.id); return n; })} /></td>}
                      <td className="font-mono text-xs font-semibold text-[#7367f0]">{b.name}</td>
                      <td className={`font-medium text-xs ${pt}`}>{Array.isArray(b.partner_id) ? b.partner_id[1] : '--'}</td>
                      <td className={`text-xs ${st}`}>{b.invoice_date || '--'}</td>
                      <td className={`text-xs font-semibold ${overdue ? 'text-red-400' : st}`}>
                        {b.invoice_date_due || '--'}{overdue && <span className="ml-1 text-[9px] text-red-400">OVERDUE</span>}
                      </td>
                      <td className={`text-right text-xs font-semibold ${pt}`}>Rs.{b.amount_total.toLocaleString('en-IN')}</td>
                      <td className={`text-right text-xs font-bold ${b.amount_residual > 0 ? overdue ? 'text-red-400' : 'text-amber-400' : 'text-green-400'}`}>
                        {b.amount_residual > 0 ? `Rs.${b.amount_residual.toLocaleString('en-IN')}` : '-- Cleared'}
                      </td>
                      <td className="text-center">
                        <span className={`badge ${PAY_STATE_BADGE[b.payment_state] || 'badge-gray'}`}>{PAY_STATE_LABEL[b.payment_state] || b.payment_state}</span>
                      </td>
                      <td className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => setDetailBill(b)} className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-white/5 text-[#5a6a8a] hover:text-white' : 'hover:bg-gray-100 text-gray-400'}`} title="View"><Eye size={13} /></button>
                          {b.payment_state !== 'paid' && b.state === 'posted' && (
                            <button onClick={() => { setPayBill(b); setPayForm(f => ({ ...f, amount: b.amount_residual.toString() })); }}
                              className="p-1.5 rounded-lg text-green-400 hover:bg-green-500/10" title="Register Payment"><DollarSign size={13} /></button>
                          )}
                          {b.state === 'draft' && (
                            <button onClick={async () => { try { await odooCall('account.move', 'action_post', [[b.id]], {}); syncData(); showMsg(true, 'Bill posted.'); } catch (e: any) { showMsg(false, e.message); } }}
                              className="p-1.5 rounded-lg text-blue-400 hover:bg-blue-500/10" title="Post Bill"><Send size={13} /></button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={isAdmin ? 9 : 8} className="text-center py-10">
                    <FileText size={32} className={`mx-auto mb-2 ${isDark ? 'text-[#2a3250]' : 'text-gray-200'}`} />
                    <p className={`text-xs ${st}`}>No bills found</p>
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <BulkDeleteBar model="account.move" label="bill" ids={Array.from(selIds)}
        onClear={() => setSelIds(new Set())} onDeleted={() => { setSelIds(new Set()); syncData(); }} />

      {/* Detail Modal */}
      {detailBill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className={`${modalBg} max-w-xl`}>
            <div className={mh}>
              <div>
                <h2 className={`text-base font-black ${pt}`}>{detailBill.name}</h2>
                <p className={`text-xs mt-0.5 ${st}`}>{Array.isArray(detailBill.partner_id) ? detailBill.partner_id[1] : '--'}</p>
              </div>
              <button onClick={() => setDetailBill(null)} className={`p-2 rounded-lg ${isDark ? 'hover:bg-white/5 text-[#5a6a8a]' : 'hover:bg-gray-100 text-gray-400'}`}><X size={16} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
                {[
                  { label: 'Bill Date', value: detailBill.invoice_date || '--' },
                  { label: 'Due Date', value: detailBill.invoice_date_due || '--' },
                  { label: 'Journal', value: Array.isArray(detailBill.journal_id) ? detailBill.journal_id[1] : '--' },
                  { label: 'Total', value: `Rs.${detailBill.amount_total.toLocaleString('en-IN')}` },
                  { label: 'Outstanding', value: `Rs.${detailBill.amount_residual.toLocaleString('en-IN')}` },
                  { label: 'Reference', value: detailBill.ref || '--' },
                ].map(f => (
                  <div key={f.label}>
                    <p className={`text-[10px] font-semibold uppercase tracking-wider mb-0.5 ${st}`}>{f.label}</p>
                    <p className={`font-semibold ${pt}`}>{f.value}</p>
                  </div>
                ))}
              </div>
              {detailBill.narration && <p className={`text-xs ${st}`}>{detailBill.narration}</p>}
            </div>
            <div className={mf}>
              <button onClick={() => setDetailBill(null)} className="btn-secondary text-xs px-4 py-2">Close</button>
              {detailBill.payment_state !== 'paid' && detailBill.state === 'posted' && (
                <button onClick={() => { setPayBill(detailBill); setPayForm(f => ({ ...f, amount: detailBill.amount_residual.toString() })); setDetailBill(null); }}
                  className="btn-primary text-xs px-4 py-2">
                  <DollarSign size={13} /> Register Payment
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Register Payment Modal */}
      {payBill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className={`${modalBg} max-w-md`}>
            <div className={mh}>
              <div>
                <h2 className={`text-base font-black ${pt}`}>Register Payment</h2>
                <p className={`text-xs mt-0.5 ${st}`}>{payBill.name} -- {Array.isArray(payBill.partner_id) ? payBill.partner_id[1] : '--'}</p>
              </div>
              <button onClick={() => setPayBill(null)} className={`p-2 rounded-lg ${isDark ? 'hover:bg-white/5 text-[#5a6a8a]' : 'hover:bg-gray-100 text-gray-400'}`}><X size={16} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className={`p-3 rounded-xl ${isDark ? 'bg-[#1e2440]' : 'bg-gray-50'}`}>
                <p className={`text-xs ${st}`}>Outstanding</p>
                <p className="text-lg font-black text-amber-400">Rs.{payBill.amount_residual.toLocaleString('en-IN')}</p>
              </div>
              <div>
                <label className="label mb-1 block">Payment Amount (Rs.) *</label>
                <input type="number" step="0.01" min="0.01" value={payForm.amount} onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))} className={`${inp} w-full`} />
              </div>
              <div>
                <label className="label mb-1 block">Payment Date *</label>
                <input type="date" value={payForm.payment_date} onChange={e => setPayForm(f => ({ ...f, payment_date: e.target.value }))} className={`${inp} w-full`} />
              </div>
              <div>
                <label className="label mb-1 block">Payment Journal *</label>
                <select value={payForm.journal_id} onChange={e => setPayForm(f => ({ ...f, journal_id: Number(e.target.value) }))} className={`${inp} w-full`}>
                  {payJournals.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
                </select>
              </div>
            </div>
            <div className={mf}>
              <button onClick={() => setPayBill(null)} className="btn-secondary text-xs px-4 py-2">Cancel</button>
              <button onClick={handleRegisterPayment} disabled={submitting || !payForm.amount} className="btn-primary text-xs px-4 py-2">
                {submitting ? <RefreshCw size={13} className="animate-spin" /> : <DollarSign size={13} />}
                Confirm Payment
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Bill Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className={`${modalBg} max-w-2xl w-full max-h-[90vh] overflow-y-auto`}>
            <div className={`${mh} sticky top-0 z-10 ${isDark ? 'bg-[#161b2e]' : 'bg-white'}`}>
              <h2 className={`text-base font-black ${pt}`}>Add Vendor Bill</h2>
              <button onClick={() => setShowCreate(false)} className={`p-2 rounded-lg ${isDark ? 'hover:bg-white/5 text-[#5a6a8a]' : 'hover:bg-gray-100 text-gray-400'}`}><X size={16} /></button>
            </div>
            <div className="p-5 space-y-4">
              {/* Vendor */}
              <div className="relative">
                <label className={`text-[10px] font-semibold block mb-1 ${st}`}>Vendor *</label>
                <input value={partnerSearch} onChange={e => { setPartnerSearch(e.target.value); setShowPartDrop(true); setForm(f => ({ ...f, partner_id: '', partner_name: '' })); }}
                  onFocus={() => setShowPartDrop(true)} placeholder="Search vendor..." className={`${inp} w-full`} />
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
                  <label className={`text-[10px] font-semibold block mb-1 ${st}`}>Purchase Journal *</label>
                  <select value={form.journal_id} onChange={e => setForm(f => ({ ...f, journal_id: Number(e.target.value) }))} className={`${inp} w-full`}>
                    {journals.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className={`text-[10px] font-semibold block mb-1 ${st}`}>Bill Date</label>
                  <input type="date" value={form.invoice_date} onChange={e => setForm(f => ({ ...f, invoice_date: e.target.value }))} className={`${inp} w-full`} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={`text-[10px] font-semibold block mb-1 ${st}`}>Due Date</label>
                  <input type="date" value={form.invoice_date_due} onChange={e => setForm(f => ({ ...f, invoice_date_due: e.target.value }))} className={`${inp} w-full`} />
                </div>
                <div>
                  <label className={`text-[10px] font-semibold block mb-1 ${st}`}>Vendor Reference</label>
                  <input value={form.ref} onChange={e => setForm(f => ({ ...f, ref: e.target.value }))} placeholder="e.g. INV-2026-004" className={`${inp} w-full`} />
                </div>
              </div>

              {/* Bill Lines */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className={`text-[10px] font-semibold ${st}`}>Bill Lines *</label>
                  <button type="button" onClick={() => setLines(p => [...p, { product_id: '', product_name: '', quantity: 1, price_unit: 0, name: '' }])}
                    className="text-xs text-[#7367f0] font-semibold flex items-center gap-1 hover:underline"><Plus size={11} /> Add Line</button>
                </div>
                <div className={`rounded-xl border overflow-x-auto ${isDark ? 'border-[#2a3250]' : 'border-gray-200'}`}>
                  <table className="w-full min-w-[560px]">
                    <thead>
                      <tr className={`text-xs font-bold uppercase tracking-wider ${isDark ? 'bg-[#1e2440] text-[#5a6a8a]' : 'bg-gray-50 text-gray-500'}`}>
                        <th className="px-3 py-3 text-left">Product / Description</th>
                        <th className="px-3 py-3 text-right w-24">Qty</th>
                        <th className="px-3 py-3 text-right w-32">Unit Price</th>
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
                                className={`input text-sm py-3 w-full ${isDark ? 'bg-[#12172a] border-[#2a3250] text-white' : ''}`} />
                              {activeProdLine === idx && products.length > 0 && !line.product_id && (
                                <div className={`absolute z-30 w-full rounded-xl border shadow-xl mt-1 max-h-44 overflow-y-auto ${isDark ? 'bg-[#1e2440] border-[#2a3250]' : 'bg-white border-gray-200'}`}>
                                  {products.map(p => (
                                    <button key={p.id} type="button" className={`w-full text-left px-3 py-2 text-sm hover:bg-[#7367f0]/10 ${isDark ? 'text-white' : 'text-gray-800'}`}
                                      onClick={() => { updateLine(idx, 'product_id', p.id); updateLine(idx, 'product_name', p.name); updateLine(idx, 'price_unit', p.standard_price); updateLine(idx, 'name', p.name); setActiveProdLine(null); setProducts([]); }}>
                                      {p.name}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                            {!line.product_id && (
                              <input value={line.name} onChange={e => updateLine(idx, 'name', e.target.value)} placeholder="Description"
                                className={`input text-sm py-2 mt-1 w-full ${isDark ? 'bg-[#12172a] border-[#2a3250] text-white' : ''}`} />
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <input type="number" min="1" value={line.quantity} onChange={e => updateLine(idx, 'quantity', Number(e.target.value))}
                              className={`input text-sm py-3 text-right w-full ${isDark ? 'bg-[#12172a] border-[#2a3250] text-white' : ''}`} />
                          </td>
                          <td className="px-3 py-2">
                            <input type="number" min="0" step="0.01" value={line.price_unit} onChange={e => updateLine(idx, 'price_unit', Number(e.target.value))}
                              className={`input text-sm py-3 text-right w-full ${isDark ? 'bg-[#12172a] border-[#2a3250] text-white' : ''}`} />
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
                        <td colSpan={3} className={`px-3 py-3 text-sm font-bold text-right ${st}`}>Total:</td>
                        <td className="px-3 py-3 text-right text-base font-black text-[#7367f0]">Rs.{lineTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              <div>
                <label className={`text-[10px] font-semibold block mb-1 ${st}`}>Notes</label>
                <textarea value={form.narration} onChange={e => setForm(f => ({ ...f, narration: e.target.value }))} rows={2}
                  className={`input text-xs py-2 w-full resize-none ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`} />
              </div>
            </div>
            <div className={mf}>
              <button onClick={() => setShowCreate(false)} className="btn-secondary text-xs px-4 py-2">Cancel</button>
              <button onClick={handleCreate} disabled={submitting || !form.partner_id} className="btn-primary text-xs px-4 py-2">
                {submitting ? <RefreshCw size={13} className="animate-spin" /> : <Plus size={13} />}
                {submitting ? 'Creating...' : 'Create & Post Bill'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

