import React, { useState, useEffect } from 'react';
import { useTheme } from '../../../context/ThemeContext';
import { searchRead, createRecord, writeRecord } from '../../../services/odoo';
import {
  Plus, RefreshCw, Search, Eye, Check, Send, X,
  FileText, TrendingUp,
} from 'lucide-react';

interface QuotationLine {
  id: number;
  product: string;
  qty: number;
  price: number;
  tax_pct: number;
}

interface Quotation {
  id: number;
  name: string;
  customer: string;
  date: string;
  amount_untaxed: number;
  amount_tax: number;
  amount_total: number;
  state: 'draft' | 'sent' | 'sale' | 'cancel';
  lines: QuotationLine[];
}

const STATE_BADGE: Record<string, string> = {
  draft: 'badge-gray',
  sent: 'badge-blue',
  sale: 'badge-green',
  cancel: 'badge-red',
};

const STATE_LABEL: Record<string, string> = {
  draft: 'Draft',
  sent: 'Sent',
  sale: 'Confirmed',
  cancel: 'Cancelled',
};

const TAX_OPTIONS = [0, 5, 12, 18, 28];

export default function Quotations() {
  const { isDark } = useTheme();

  const [items, setItems] = useState<Quotation[]>(() => {
    const cached = localStorage.getItem('portal_quotations');
    return cached ? JSON.parse(cached) : [];
  });
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState('all');
  const [detailItem, setDetailItem] = useState<Quotation | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  // Create form state
  const [newCustomer, setNewCustomer] = useState('');
  const [newProduct, setNewProduct] = useState('');
  const [newQty, setNewQty] = useState(1);
  const [newPrice, setNewPrice] = useState(0);
  const [newTax, setNewTax] = useState(18);
  const [gstBill, setGstBill] = useState(false);
  const [newDiscount, setNewDiscount] = useState(0);
  const [newHsn, setNewHsn] = useState('');

  const syncData = async () => {
    setLoading(true);
    try {
      const result = await searchRead<any>('sale.order', {
        domain: [['state', 'in', ['draft', 'sent']]],
        fields: ['id', 'name', 'partner_id', 'date_order', 'amount_total', 'state', 'amount_tax'],
        limit: 0,
        order: 'id desc',
      });
      if (Array.isArray(result)) {
        const mapped: Quotation[] = result.map((r: any) => ({
          id: r.id,
          name: r.name,
          customer: Array.isArray(r.partner_id) ? r.partner_id[1] : 'Unknown',
          date: r.date_order ? String(r.date_order).split(' ')[0] : '',
          amount_untaxed: (r.amount_total || 0) - (r.amount_tax || 0),
          amount_tax: r.amount_tax || 0,
          amount_total: r.amount_total || 0,
          state: r.state,
          lines: [],
        }));
        setItems(mapped);
        localStorage.setItem('portal_quotations', JSON.stringify(mapped));
      }
    } catch {
      console.warn('Odoo offline, using localStorage cache');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { syncData(); }, []);
  useEffect(() => {
    localStorage.setItem('portal_quotations', JSON.stringify(items));
  }, [items]);

  // Push confirmed quotation into portal_sales_orders shared key
  const pushToSalesOrders = (confirmed: Quotation) => {
    try {
      const raw = localStorage.getItem('portal_sales_orders');
      const existing: any[] = raw ? JSON.parse(raw) : [];
      const soEntry = {
        id: confirmed.id,
        name: confirmed.name.replace('QT/', 'SO/'),
        customer: confirmed.customer,
        date: confirmed.date,
        amount_total: confirmed.amount_total,
        state: 'sale',
        delivery_status: 'pending',
      };
      const filtered = existing.filter((o: any) => o.id !== confirmed.id);
      localStorage.setItem('portal_sales_orders', JSON.stringify([soEntry, ...filtered]));
    } catch {}
  };

  const confirmQuotation = (id: number) => {
    setItems(prev => {
      const updated = prev.map(q => q.id === id ? { ...q, state: 'sale' as const } : q);
      const confirmed = updated.find(q => q.id === id);
      if (confirmed) pushToSalesOrders(confirmed);
      return updated;
    });
    setDetailItem(prev => prev?.id === id ? { ...prev, state: 'sale' } : prev);
    try { writeRecord('sale.order', [id], { state: 'sale' }); } catch {}
  };

  const markSent = (id: number) => {
    setItems(prev => prev.map(q => q.id === id ? { ...q, state: 'sent' as const } : q));
    try { writeRecord('sale.order', [id], { state: 'sent' }); } catch {}
  };

  const calcLine = () => {
    const disc = Math.min(Math.max(newDiscount || 0, 0), 100);
    const untaxed = newPrice * newQty * (1 - disc / 100);
    const taxAmt = gstBill ? untaxed * (newTax / 100) : 0;
    return { untaxed, taxAmt, total: untaxed + taxAmt };
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustomer || !newProduct || newPrice <= 0) return;
    const { untaxed, taxAmt, total } = calcLine();
    const newQ: Quotation = {
      id: Date.now(),
      name: `QT/2026/${String(items.length + 1).padStart(4, '0')}`,
      customer: newCustomer,
      date: new Date().toISOString().split('T')[0],
      amount_untaxed: untaxed,
      amount_tax: taxAmt,
      amount_total: total,
      state: 'draft',
      lines: [{ id: Date.now() + 1, product: newProduct, qty: newQty, price: newPrice, tax_pct: newTax }],
    };
    setItems(prev => [newQ, ...prev]);
    try {
      createRecord('sale.order', {
        partner_id: 1,
        state: 'draft',
        order_line: [[0, 0, { name: newProduct, product_uom_qty: newQty, price_unit: newPrice, discount: newDiscount || 0 }]],
      });
    } catch {}
    setCreateOpen(false);
    setNewCustomer(''); setNewProduct(''); setNewQty(1); setNewPrice(0); setNewTax(18);
    setGstBill(false); setNewDiscount(0); setNewHsn('');
  };

  const filtered = items.filter(q => {
    const ms = !search || q.name.toLowerCase().includes(search.toLowerCase()) || q.customer.toLowerCase().includes(search.toLowerCase());
    const mf = stateFilter === 'all' || q.state === stateFilter;
    return ms && mf;
  });

  const totalDrafts = items.filter(q => q.state === 'draft').length;
  const totalSent = items.filter(q => q.state === 'sent').length;
  const totalRevenue = items.reduce((s, q) => s + q.amount_total, 0);

  const fmt = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2 });
  const secText = isDark ? 'text-[#5a6a8a]' : 'text-gray-500';
  const primaryText = isDark ? 'text-white' : 'text-gray-900';
  const inputCls = `input ${isDark ? 'bg-[#12172a] border-[#2a3250] text-white' : ''}`;
  const modalBg = isDark ? 'bg-[#1e2440] border-[#2a3250]' : 'bg-white border-gray-200';
  const innerBg = isDark ? 'bg-[#12172a]' : 'bg-gray-50';
  const divider = isDark ? 'border-[#2a3250]' : 'border-gray-100';

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className={`text-xl font-black ${primaryText}`}>Quotations</h1>
          <p className={`text-xs mt-0.5 ${secText}`}>Draft and sent quotations awaiting confirmation</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={syncData} disabled={loading} className="btn-secondary text-xs px-3 py-2">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Sync
          </button>
          <button onClick={() => setCreateOpen(true)} className="btn-primary text-xs px-3 py-2">
            <Plus size={13} /> Create Quotation
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-gray-500/15 flex items-center justify-center flex-shrink-0">
            <FileText size={18} className="text-gray-400" />
          </div>
          <div>
            <p className={`text-xs ${secText}`}>Total Drafts</p>
            <p className={`text-2xl font-black ${primaryText}`}>{totalDrafts}</p>
          </div>
        </div>
        <div className="card p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-blue-500/15 flex items-center justify-center flex-shrink-0">
            <Send size={18} className="text-blue-400" />
          </div>
          <div>
            <p className={`text-xs ${secText}`}>Total Sent</p>
            <p className={`text-2xl font-black ${primaryText}`}>{totalSent}</p>
          </div>
        </div>
        <div className="card p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-violet-500/15 flex items-center justify-center flex-shrink-0">
            <TrendingUp size={18} className="text-violet-400" />
          </div>
          <div>
            <p className={`text-xs ${secText}`}>Total Revenue</p>
            <p className={`text-2xl font-black ${primaryText}`}>
              ₹{(totalRevenue / 100000).toFixed(2)}L
            </p>
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="card p-3 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={14} className={`absolute left-3 top-1/2 -translate-y-1/2 ${secText}`} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by quotation # or customer..."
            className={`input pl-9 text-xs py-2 ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`}
          />
        </div>
        <select
          value={stateFilter}
          onChange={e => setStateFilter(e.target.value)}
          className={`input text-xs py-2 w-auto ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`}
        >
          <option value="all">All States</option>
          <option value="draft">Draft</option>
          <option value="sent">Sent</option>
          <option value="sale">Confirmed</option>
          <option value="cancel">Cancelled</option>
        </select>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-40 gap-3">
            <RefreshCw size={18} className="animate-spin text-[#7367f0]" />
            <span className={`text-sm ${secText}`}>Syncing from Odoo...</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table w-full">
              <thead>
                <tr>
                  <th>Quotation #</th>
                  <th>Customer</th>
                  <th>Date</th>
                  <th className="text-right">Untaxed</th>
                  <th className="text-right">Tax</th>
                  <th className="text-right">Total</th>
                  <th className="text-center">Status</th>
                  <th className="text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className={`text-center py-10 text-xs ${secText}`}>
                      No quotations match the current filters.
                    </td>
                  </tr>
                ) : (
                  filtered.map(q => (
                    <tr key={q.id}>
                      <td>
                        <span className="font-mono text-xs font-semibold text-[#7367f0]">{q.name}</span>
                      </td>
                      <td className={`font-medium ${primaryText}`}>{q.customer}</td>
                      <td className={`text-xs ${secText}`}>
                        {new Date(q.date).toLocaleDateString('en-IN')}
                      </td>
                      <td className={`text-right text-xs ${secText}`}>₹{fmt(q.amount_untaxed)}</td>
                      <td className={`text-right text-xs ${secText}`}>₹{fmt(q.amount_tax)}</td>
                      <td className={`text-right font-semibold ${primaryText}`}>₹{fmt(q.amount_total)}</td>
                      <td className="text-center">
                        <span className={STATE_BADGE[q.state] || 'badge-gray'}>
                          {STATE_LABEL[q.state] || q.state}
                        </span>
                      </td>
                      <td className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => setDetailItem(q)}
                            title="View Details"
                            className={`p-1.5 rounded-lg transition-colors ${isDark ? 'hover:bg-white/5 text-[#5a6a8a] hover:text-white' : 'hover:bg-gray-100 text-gray-400 hover:text-gray-700'}`}
                          >
                            <Eye size={13} />
                          </button>
                          {q.state !== 'sale' && q.state !== 'cancel' && (
                            <button
                              onClick={() => confirmQuotation(q.id)}
                              title="Confirm Order"
                              className={`p-1.5 rounded-lg transition-colors ${isDark ? 'hover:bg-green-500/10 text-[#5a6a8a] hover:text-green-400' : 'hover:bg-green-50 text-gray-400 hover:text-green-600'}`}
                            >
                              <Check size={13} />
                            </button>
                          )}
                          {q.state === 'draft' && (
                            <button
                              onClick={() => markSent(q.id)}
                              title="Mark as Sent"
                              className={`p-1.5 rounded-lg transition-colors ${isDark ? 'hover:bg-blue-500/10 text-[#5a6a8a] hover:text-blue-400' : 'hover:bg-blue-50 text-gray-400 hover:text-blue-600'}`}
                            >
                              <Send size={13} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {detailItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => setDetailItem(null)}
        >
          <div
            className={`w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border shadow-2xl ${modalBg}`}
            onClick={e => e.stopPropagation()}
          >
            <div className={`flex justify-between items-center px-5 py-4 border-b ${divider}`}>
              <div>
                <h3 className={`font-bold ${primaryText}`}>{detailItem.name}</h3>
                <p className={`text-xs ${secText}`}>{detailItem.customer}</p>
              </div>
              <button
                onClick={() => setDetailItem(null)}
                className={`p-1.5 rounded-lg ${isDark ? 'text-[#5a6a8a] hover:bg-white/5' : 'text-gray-400 hover:bg-gray-100'}`}
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex gap-3">
                <div className={`flex-1 rounded-xl p-3 ${innerBg}`}>
                  <p className={`text-xs ${secText}`}>Date</p>
                  <p className={`text-sm font-semibold ${primaryText}`}>
                    {new Date(detailItem.date).toLocaleDateString('en-IN')}
                  </p>
                </div>
                <div className={`flex-1 rounded-xl p-3 ${innerBg}`}>
                  <p className={`text-xs ${secText}`}>Status</p>
                  <span className={`${STATE_BADGE[detailItem.state] || 'badge-gray'} mt-1 inline-flex`}>
                    {STATE_LABEL[detailItem.state]}
                  </span>
                </div>
              </div>

              {detailItem.lines.length > 0 && (
                <div>
                  <p className={`text-xs font-semibold uppercase tracking-wider mb-2 ${secText}`}>Order Lines</p>
                  <div className={`rounded-xl overflow-x-auto border ${divider}`}>
                    <table className="data-table w-full text-sm min-w-[460px]">
                      <thead>
                        <tr>
                          <th>Product</th>
                          <th className="text-right">Qty</th>
                          <th className="text-right">Unit Price</th>
                          <th className="text-right">Tax %</th>
                          <th className="text-right">Subtotal</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailItem.lines.map(l => (
                          <tr key={l.id}>
                            <td>{l.product}</td>
                            <td className="text-right">{l.qty}</td>
                            <td className="text-right">₹{fmt(l.price)}</td>
                            <td className="text-right">{l.tax_pct}%</td>
                            <td className={`text-right font-semibold ${primaryText}`}>
                              ₹{fmt(l.qty * l.price)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className={`rounded-xl p-4 space-y-2 ${innerBg}`}>
                <div className="flex justify-between text-xs">
                  <span className={secText}>Subtotal (Untaxed)</span>
                  <span className={primaryText}>₹{fmt(detailItem.amount_untaxed)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className={secText}>GST / Tax</span>
                  <span className={primaryText}>₹{fmt(detailItem.amount_tax)}</span>
                </div>
                <div className={`flex justify-between font-bold pt-2 border-t ${divider}`}>
                  <span className={primaryText}>Grand Total</span>
                  <span className="text-[#7367f0] text-base">₹{fmt(detailItem.amount_total)}</span>
                </div>
              </div>

              {detailItem.state !== 'sale' && detailItem.state !== 'cancel' && (
                <button
                  onClick={() => confirmQuotation(detailItem.id)}
                  className="btn-primary w-full justify-center py-2.5"
                >
                  <Check size={14} /> Confirm Order
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create Modal */}
      {createOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => setCreateOpen(false)}
        >
          <div
            className={`w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border shadow-2xl ${modalBg}`}
            onClick={e => e.stopPropagation()}
          >
            <div className={`flex justify-between items-center px-5 py-4 border-b ${divider}`}>
              <h3 className={`font-bold ${primaryText}`}>Create Quotation</h3>
              <button
                onClick={() => setCreateOpen(false)}
                className={`p-1.5 rounded-lg ${isDark ? 'text-[#5a6a8a] hover:bg-white/5' : 'text-gray-400 hover:bg-gray-100'}`}
              >
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleCreate} className="p-5 space-y-4">
              <div>
                <label className="label">Customer Name</label>
                <input
                  type="text"
                  value={newCustomer}
                  onChange={e => setNewCustomer(e.target.value)}
                  required
                  placeholder="e.g. Shree Traders & Co."
                  className={inputCls}
                />
              </div>
              <div>
                <label className="label">Product</label>
                <input
                  type="text"
                  value={newProduct}
                  onChange={e => setNewProduct(e.target.value)}
                  required
                  placeholder='e.g. Smart TV 43"'
                  className={inputCls}
                />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="label">Quantity</label>
                  <input
                    type="number"
                    value={newQty}
                    onChange={e => setNewQty(Number(e.target.value))}
                    min={1}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="label">Unit Price (Rs.)</label>
                  <input
                    type="number"
                    value={newPrice}
                    onChange={e => setNewPrice(Number(e.target.value))}
                    min={0}
                    placeholder="0.00"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="label">Discount %</label>
                  <input
                    type="number"
                    value={newDiscount}
                    onChange={e => setNewDiscount(Number(e.target.value))}
                    min={0}
                    max={100}
                    placeholder="0"
                    className={inputCls}
                  />
                </div>
              </div>

              {/* GST Bill toggle */}
              <div className={`flex items-center justify-between p-3 rounded-xl ${innerBg}`}>
                <div>
                  <p className={`text-xs font-bold ${primaryText}`}>GST Bill</p>
                  <p className={`text-[10px] ${secText}`}>Apply GST with HSN code and tax rate.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setGstBill(v => !v)}
                  className={`relative w-11 h-6 rounded-full transition-colors ${gstBill ? 'bg-[#7367f0]' : isDark ? 'bg-[#2a3250]' : 'bg-gray-300'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${gstBill ? 'translate-x-5' : ''}`} />
                </button>
              </div>

              {gstBill && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">HSN Code</label>
                    <input
                      type="text"
                      value={newHsn}
                      onChange={e => setNewHsn(e.target.value)}
                      placeholder="e.g. 8528"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="label">GST Tax %</label>
                    <select
                      value={newTax}
                      onChange={e => setNewTax(Number(e.target.value))}
                      className={inputCls}
                    >
                      {TAX_OPTIONS.map(t => (
                        <option key={t} value={t}>{t}% GST</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {newPrice > 0 && (
                <div className={`rounded-xl p-3 space-y-1 text-xs ${innerBg}`}>
                  <div className="flex justify-between">
                    <span className={secText}>Untaxed Amount{newDiscount > 0 ? ` (after ${newDiscount}% disc.)` : ''}</span>
                    <span className={primaryText}>₹{fmt(calcLine().untaxed)}</span>
                  </div>
                  {gstBill && (
                    <div className="flex justify-between">
                      <span className={secText}>GST ({newTax}%)</span>
                      <span className={primaryText}>₹{fmt(calcLine().taxAmt)}</span>
                    </div>
                  )}
                  <div className={`flex justify-between font-bold pt-1 border-t ${divider}`}>
                    <span className={primaryText}>Total</span>
                    <span className="text-[#7367f0]">₹{fmt(calcLine().total)}</span>
                  </div>
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="btn-secondary flex-1 justify-center py-2.5"
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary flex-1 justify-center py-2.5">
                  <Plus size={14} /> Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}


