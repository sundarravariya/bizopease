import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTheme } from '../../../context/ThemeContext';
import { searchRead, createRecord, odooCall } from '../../../services/odoo';
import {
  Plus, Search, RefreshCw, X, CheckCircle, Trash2, Zap, ShoppingCart, Clock, TrendingUp
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface QuickLine {
  product_id: number | '';
  product_name: string;
  qty: number;
  price: number;
}

interface Partner { id: number; name: string; }
interface Product { id: number; name: string; list_price: number; default_code: string; }

interface RecentOrder {
  id: number;
  name: string;
  partner_id: [number, string] | false;
  amount_total: number;
  date_order: string;
  delivery_status: string;
  state: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fmt = (n: number) =>
  n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const todayStr = () => new Date().toISOString().slice(0, 10);

const DELIVERY_BADGE: Record<string, string> = {
  full: 'badge-green',
  partial: 'badge-gold',
  pending: 'badge-gray',
};
const DELIVERY_LABEL: Record<string, string> = {
  full: 'Delivered',
  partial: 'Partial',
  pending: 'Pending',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function QuickSaleOrder() {
  const { isDark } = useTheme();

  // -- theme helpers --
  const pt = isDark ? 'text-white' : 'text-gray-900';
  const st = isDark ? 'text-[#5a6a8a]' : 'text-gray-500';
  const inp = `input text-xs py-2 ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`;
  const cardCls = `card rounded-2xl border ${isDark ? 'bg-[#161b2e] border-[#2a3250]' : 'bg-white border-gray-200'}`;
  const divider = isDark ? 'divide-[#2a3250]' : 'divide-gray-100';

  // -- toast --
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);
  const showMsg = (ok: boolean, msg: string) => {
    setToast({ ok, msg });
    setTimeout(() => setToast(null), 6000);
  };

  // -- reference data --
  const [partners, setPartners] = useState<Partner[]>([]);
  const [refsLoaded, setRefsLoaded] = useState(false);

  // -- form: customer --
  const [partnerSearch, setPartnerSearch] = useState('');
  const [partnerId, setPartnerId] = useState<number | ''>('');
  const [partnerName, setPartnerName] = useState('');
  const [showPartnerDrop, setShowPartnerDrop] = useState(false);
  const partnerRef = useRef<HTMLDivElement>(null);

  // -- form: date + lines --
  const [orderDate, setOrderDate] = useState(todayStr());
  const [lines, setLines] = useState<QuickLine[]>([]);
  const [lineSearch, setLineSearch] = useState<string[]>([]);

  // -- per-line product dropdown --
  const [activeLine, setActiveLine] = useState<number | null>(null);
  const [lineProdResults, setLineProdResults] = useState<Product[]>([]);

  // -- add-product box --
  const [addSearch, setAddSearch] = useState('');
  const [addResults, setAddResults] = useState<Product[]>([]);
  const addRef = useRef<HTMLDivElement>(null);
  const addInputRef = useRef<HTMLInputElement>(null);

  // -- submission --
  const [submitting, setSubmitting] = useState(false);
  const [lastOrderName, setLastOrderName] = useState<string | null>(null);

  // -- recent sales --
  const [recent, setRecent] = useState<RecentOrder[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  const loadRefs = async () => {
    try {
      const ps = await searchRead<Partner>('res.partner', {
        fields: ['id', 'name'],
        domain: [['active', '=', true], ['customer_rank', '>', 0]],
        limit: 0,
      });
      setPartners(ps || []);
    } catch (e: any) {
      showMsg(false, 'Failed to load customers: ' + e.message);
    } finally {
      setRefsLoaded(true);
    }
  };

  const loadRecent = async () => {
    setRecentLoading(true);
    try {
      const res = await searchRead<RecentOrder>('sale.order', {
        domain: [['state', 'in', ['sale', 'done']]],
        fields: ['id', 'name', 'partner_id', 'amount_total', 'date_order', 'delivery_status', 'state'],
        limit: 0,
        order: 'id desc',
      });
      setRecent((res || []).slice(0, 15));
    } catch (e: any) {
      showMsg(false, 'Failed to load recent sales: ' + e.message);
    } finally {
      setRecentLoading(false);
    }
  };

  useEffect(() => { loadRefs(); loadRecent(); }, []);

  // ---------------------------------------------------------------------------
  // Close dropdowns on outside click
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (partnerRef.current && !partnerRef.current.contains(e.target as Node)) {
        setShowPartnerDrop(false);
      }
      if (addRef.current && !addRef.current.contains(e.target as Node)) {
        setAddResults([]);
        setAddSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ---------------------------------------------------------------------------
  // Product search
  // ---------------------------------------------------------------------------

  const searchProds = useCallback(async (q: string): Promise<Product[]> => {
    if (!q || q.length < 2) return [];
    try {
      const res = await searchRead<Product>('product.product', {
        fields: ['id', 'name', 'list_price', 'default_code'],
        domain: [
          ['sale_ok', '=', true],
          ['active', '=', true],
          '|', ['name', 'ilike', q], ['default_code', 'ilike', q],
        ],
        limit: 20,
      });
      return res || [];
    } catch { return []; }
  }, []);

  const handleAddSearch = async (val: string) => {
    setAddSearch(val);
    if (val.length < 2) { setAddResults([]); return; }
    const res = await searchProds(val);
    setAddResults(res.slice(0, 10));
  };

  const handleLineSearch = async (idx: number, val: string) => {
    setLineSearch(prev => prev.map((s, i) => i === idx ? val : s));
    setActiveLine(idx);
    if (val.length < 2) { setLineProdResults([]); return; }
    const res = await searchProds(val);
    setLineProdResults(res.slice(0, 10));
  };

  // ---------------------------------------------------------------------------
  // Append a new line from a product
  // ---------------------------------------------------------------------------

  const appendLine = (prod: Product) => {
    setLines(prev => [...prev, { product_id: prod.id, product_name: prod.name, qty: 1, price: prod.list_price }]);
    setLineSearch(prev => [...prev, prod.name]);
    setAddSearch('');
    setAddResults([]);
    setTimeout(() => addInputRef.current?.focus(), 50);
  };

  // ---------------------------------------------------------------------------
  // Line mutations
  // ---------------------------------------------------------------------------

  const updateLine = (idx: number, key: keyof QuickLine, val: any) =>
    setLines(prev => prev.map((l, i) => i === idx ? { ...l, [key]: val } : l));

  const selectLineProduct = (idx: number, prod: Product) => {
    updateLine(idx, 'product_id', prod.id);
    updateLine(idx, 'product_name', prod.name);
    updateLine(idx, 'price', prod.list_price);
    setLineSearch(prev => prev.map((s, i) => i === idx ? prod.name : s));
    setLineProdResults([]);
    setActiveLine(null);
  };

  const removeLine = (idx: number) => {
    setLines(prev => prev.filter((_, i) => i !== idx));
    setLineSearch(prev => prev.filter((_, i) => i !== idx));
  };

  const grandTotal = lines.reduce((s, l) => s + l.qty * l.price, 0);

  // ---------------------------------------------------------------------------
  // Reset
  // ---------------------------------------------------------------------------

  const resetForm = () => {
    setPartnerId('');
    setPartnerName('');
    setPartnerSearch('');
    setOrderDate(todayStr());
    setLines([]);
    setLineSearch([]);
    setAddSearch('');
    setAddResults([]);
    setLastOrderName(null);
  };

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!partnerId) { showMsg(false, 'Please select a customer.'); return; }
    const valid = lines.filter(l => l.product_id);
    if (!valid.length) { showMsg(false, 'Add at least one product line.'); return; }

    setSubmitting(true);
    try {
      const orderLineVals = valid.map(l => [0, 0, {
        product_id: l.product_id,
        product_uom_qty: l.qty,
        price_unit: l.price,
      }]);

      const id = await createRecord('sale.order', {
        partner_id: partnerId,
        date_order: orderDate + ' 00:00:00',
        order_line: orderLineVals,
      });

      await odooCall('sale.order', 'action_confirm', [[id]], {});

      const [rec] = await searchRead<{ id: number; name: string }>('sale.order', {
        domain: [['id', '=', id]], fields: ['id', 'name'], limit: 1,
      });
      const soName = rec?.name || ('SO-' + id);
      setLastOrderName(soName);
      showMsg(
        true,
        soName + ' confirmed -- delivery auto-validated from MAIN warehouse + invoice auto-posted.'
      );
      setPartnerId('');
      setPartnerName('');
      setPartnerSearch('');
      setOrderDate(todayStr());
      setLines([]);
      setLineSearch([]);
      setAddSearch('');
      setAddResults([]);
      loadRecent();
    } catch (e: any) {
      showMsg(false, 'Failed: ' + e.message);
    } finally {
      setSubmitting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Filtered partners
  // ---------------------------------------------------------------------------

  const filteredPartners = partners
    .filter(p => !partnerSearch || p.name.toLowerCase().includes(partnerSearch.toLowerCase()))
    .slice(0, 10);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6 animate-fade-in">

      {/* Toast */}
      {toast && (
        <div className={`fixed top-5 right-5 z-50 px-4 py-3 rounded-xl shadow-xl text-sm font-medium flex items-center gap-2 max-w-sm
          ${toast.ok
            ? 'bg-green-500/15 border border-green-500/30 text-green-400'
            : 'bg-red-500/15 border border-red-500/30 text-red-400'}`}>
          {toast.ok ? <CheckCircle size={14} /> : <X size={14} />}
          {toast.msg}
        </div>
      )}

      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className={`text-xl font-black ${pt}`}>Quick Sale</h1>
          <p className={`text-xs mt-0.5 ${st}`}>
            Create and confirm a sale in one shot -- delivery auto-validates, invoice auto-posts.
          </p>
        </div>
        <button
          type="button"
          onClick={loadRecent}
          disabled={recentLoading}
          className="btn-secondary text-xs px-3 py-2 self-start sm:self-auto"
        >
          <RefreshCw size={13} className={recentLoading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Last order banner */}
      {lastOrderName && (
        <div className={`flex items-center gap-3 p-4 rounded-xl border ${isDark ? 'bg-green-500/10 border-green-500/25' : 'bg-green-50 border-green-200'}`}>
          <CheckCircle size={16} className="text-green-400 flex-shrink-0" />
          <div>
            <p className={`text-xs font-bold ${isDark ? 'text-green-300' : 'text-green-700'}`}>
              Last confirmed: {lastOrderName}
            </p>
            <p className={`text-[10px] ${isDark ? 'text-green-400/70' : 'text-green-600'}`}>
              Delivery validated + invoice posted in Odoo.
            </p>
          </div>
          <button type="button" onClick={() => setLastOrderName(null)} className={`ml-auto p-1 rounded ${st}`}>
            <X size={12} />
          </button>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* FORM CARD                                                            */}
      {/* ------------------------------------------------------------------ */}
      <form onSubmit={handleSubmit} className={`${cardCls} overflow-visible`}>

        {/* Card header */}
        <div className={`flex items-center gap-3 px-6 py-4 border-b ${isDark ? 'border-[#2a3250]' : 'border-gray-100'}`}>
          <div className="w-8 h-8 rounded-xl bg-[#7367f0]/15 flex items-center justify-center flex-shrink-0">
            <Zap size={15} className="text-[#7367f0]" />
          </div>
          <div>
            <p className={`text-sm font-bold ${pt}`}>New Quick Sale Order</p>
            <p className={`text-[11px] ${st}`}>
              Confirming fires auto-delivery from MAIN warehouse + auto-posts customer invoice + syncs Flipkart dashboard.
            </p>
          </div>
        </div>

        <div className="p-6 space-y-5">

          {/* Row: Customer + Date */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

            {/* Customer */}
            <div ref={partnerRef} className="relative">
              <label className={`text-[10px] font-semibold block mb-1 uppercase tracking-wider ${st}`}>
                Customer *
              </label>
              <div className="relative">
                <Search size={13} className={`absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none ${st}`} />
                <input
                  value={partnerSearch}
                  onChange={e => {
                    setPartnerSearch(e.target.value);
                    setShowPartnerDrop(true);
                    setPartnerId('');
                    setPartnerName('');
                  }}
                  onFocus={() => setShowPartnerDrop(true)}
                  placeholder={refsLoaded ? 'Search customer...' : 'Loading...'}
                  disabled={!refsLoaded}
                  className={`${inp} pl-9 w-full`}
                  autoComplete="off"
                />
              </div>
              {partnerId && (
                <p className="mt-1 text-xs font-semibold text-[#7367f0] flex items-center gap-1">
                  <CheckCircle size={11} /> {partnerName}
                </p>
              )}
              {showPartnerDrop && filteredPartners.length > 0 && !partnerId && (
                <div className={`absolute z-20 w-full rounded-xl border shadow-2xl mt-1 max-h-44 overflow-y-auto ${isDark ? 'bg-[#1e2440] border-[#2a3250]' : 'bg-white border-gray-200'}`}>
                  {filteredPartners.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      className={`w-full text-left px-3 py-2.5 text-xs hover:bg-[#7367f0]/10 ${isDark ? 'text-white' : 'text-gray-800'}`}
                      onClick={() => {
                        setPartnerId(p.id);
                        setPartnerName(p.name);
                        setPartnerSearch(p.name);
                        setShowPartnerDrop(false);
                      }}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Order Date */}
            <div>
              <label className={`text-[10px] font-semibold block mb-1 uppercase tracking-wider ${st}`}>
                Order Date *
              </label>
              <input
                type="date"
                value={orderDate}
                onChange={e => setOrderDate(e.target.value)}
                className={`${inp} w-full`}
                required
              />
            </div>
          </div>

          {/* ---- Product Lines ---- */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className={`text-[10px] font-semibold uppercase tracking-wider ${st}`}>
                Order Lines {lines.length > 0 && `(${lines.length})`}
              </label>
              {lines.length > 0 && (
                <span className="text-[10px] font-semibold text-[#7367f0]">
                  Total: Rs.{fmt(grandTotal)}
                </span>
              )}
            </div>

            {/* Existing lines table */}
            {lines.length > 0 && (
              <div className={`rounded-xl border overflow-x-auto mb-3 ${isDark ? 'border-[#2a3250]' : 'border-gray-200'}`}>
                <table className="w-full min-w-[560px]">
                  <thead>
                    <tr className={`text-xs font-bold uppercase tracking-wider ${isDark ? 'bg-[#1e2440] text-[#5a6a8a]' : 'bg-gray-50 text-gray-500'}`}>
                      <th className="px-3 py-3 text-left">Product</th>
                      <th className="px-3 py-3 text-right w-24">Qty</th>
                      <th className="px-3 py-3 text-right w-32">Unit Price</th>
                      <th className="px-3 py-3 text-right w-32">Subtotal</th>
                      <th className="px-3 py-3 w-10"></th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${divider}`}>
                    {lines.map((line, idx) => (
                      <tr key={idx} className={`${isDark ? 'hover:bg-white/[0.02]' : 'hover:bg-gray-50'} transition-colors`}>

                        {/* Product */}
                        <td className="px-3 py-2 min-w-[220px]">
                          <div className="relative">
                            <input
                              value={lineSearch[idx] || ''}
                              onChange={e => handleLineSearch(idx, e.target.value)}
                              placeholder="Search product..."
                              className={`input text-sm py-3 w-full ${isDark ? 'bg-[#12172a] border-[#2a3250] text-white' : ''}`}
                            />
                            {activeLine === idx && lineProdResults.length > 0 && !line.product_id && (
                              <div className={`absolute z-30 w-full rounded-xl border shadow-xl mt-1 max-h-44 overflow-y-auto ${isDark ? 'bg-[#1e2440] border-[#2a3250]' : 'bg-white border-gray-200'}`}>
                                {lineProdResults.map(p => (
                                  <button
                                    key={p.id}
                                    type="button"
                                    className={`w-full text-left px-3 py-2 text-sm hover:bg-[#7367f0]/10 ${isDark ? 'text-white' : 'text-gray-800'}`}
                                    onClick={() => selectLineProduct(idx, p)}
                                  >
                                    <span className="font-semibold">{p.name}</span>
                                    {p.default_code && (
                                      <span className={`ml-1 text-xs ${st}`}>[{p.default_code}]</span>
                                    )}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>

                        {/* Qty */}
                        <td className="px-3 py-2">
                          <input
                            type="number" min="1" step="1"
                            value={line.qty}
                            onChange={e => updateLine(idx, 'qty', Math.max(1, Number(e.target.value)))}
                            className={`input text-sm py-3 text-right w-full ${isDark ? 'bg-[#12172a] border-[#2a3250] text-white' : ''}`}
                          />
                        </td>

                        {/* Unit Price */}
                        <td className="px-3 py-2">
                          <input
                            type="number" min="0" step="0.01"
                            value={line.price}
                            onChange={e => updateLine(idx, 'price', Number(e.target.value))}
                            className={`input text-sm py-3 text-right w-full ${isDark ? 'bg-[#12172a] border-[#2a3250] text-white' : ''}`}
                          />
                        </td>

                        {/* Subtotal */}
                        <td className={`px-3 py-2 text-right text-sm font-semibold ${pt}`}>
                          Rs.{fmt(line.qty * line.price)}
                        </td>

                        {/* Remove */}
                        <td className="px-3 py-2 text-center">
                          <button
                            type="button"
                            onClick={() => removeLine(idx)}
                            className="text-red-400 hover:text-red-300 transition-colors"
                            title="Remove line"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className={`border-t ${isDark ? 'border-[#2a3250]' : 'border-gray-200'}`}>
                      <td colSpan={3} className={`px-3 py-3 text-sm font-bold text-right ${st}`}>Grand Total:</td>
                      <td className="px-3 py-3 text-right text-base font-black text-[#7367f0]">
                        Rs.{fmt(grandTotal)}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            {/* Add-product search box */}
            <div ref={addRef} className="relative">
              <div className="relative">
                <Plus size={13} className={`absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none ${st}`} />
                <input
                  ref={addInputRef}
                  value={addSearch}
                  onChange={e => handleAddSearch(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (addResults.length > 0) appendLine(addResults[0]);
                    }
                  }}
                  placeholder="Type product name or SKU to add a line... (Enter to add first result)"
                  className={`${inp} pl-9 w-full border-dashed`}
                  autoComplete="off"
                />
              </div>
              {addResults.length > 0 && (
                <div className={`absolute z-20 w-full rounded-xl border shadow-2xl mt-1 max-h-48 overflow-y-auto ${isDark ? 'bg-[#1e2440] border-[#2a3250]' : 'bg-white border-gray-200'}`}>
                  {addResults.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      className={`w-full text-left px-3 py-2 text-xs hover:bg-[#7367f0]/10 flex items-center justify-between ${isDark ? 'text-white' : 'text-gray-800'}`}
                      onClick={() => appendLine(p)}
                    >
                      <span>
                        <span className="font-semibold">{p.name}</span>
                        {p.default_code && (
                          <span className={`ml-2 text-[10px] ${st}`}>[{p.default_code}]</span>
                        )}
                      </span>
                      <span className="font-semibold text-[#7367f0] ml-4 flex-shrink-0">
                        Rs.{fmt(p.list_price)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Info banner */}
          <div className={`p-3 rounded-xl text-xs border ${isDark ? 'bg-amber-500/5 border-amber-500/20 text-amber-300' : 'bg-amber-50 border-amber-200 text-amber-700'}`}>
            <strong>On confirm:</strong> Odoo forces MAIN warehouse on all moves, auto-validates the delivery picking, and auto-creates + posts the customer invoice. Flipkart sales dashboard syncs automatically.
          </div>

          {/* Submit */}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={resetForm}
              className="btn-secondary py-3 px-5 text-sm justify-center"
            >
              <X size={14} /> Clear
            </button>
            <button
              type="submit"
              disabled={submitting || !partnerId || lines.filter(l => l.product_id).length === 0}
              className="btn-primary flex-1 py-3 text-sm font-bold justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting
                ? <><RefreshCw size={15} className="animate-spin" /> Processing...</>
                : <><ShoppingCart size={15} /> Create &amp; Confirm Sale -- Rs.{fmt(grandTotal)}</>
              }
            </button>
          </div>
        </div>
      </form>

      {/* ------------------------------------------------------------------ */}
      {/* RECENT SALES                                                         */}
      {/* ------------------------------------------------------------------ */}
      <div className={`${cardCls} overflow-hidden`}>

        {/* Section header */}
        <div className={`flex items-center justify-between px-6 py-4 border-b ${isDark ? 'border-[#2a3250]' : 'border-gray-100'}`}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-green-500/15 flex items-center justify-center flex-shrink-0">
              <TrendingUp size={14} className="text-green-400" />
            </div>
            <div>
              <p className={`text-sm font-bold ${pt}`}>Recent Sales</p>
              <p className={`text-[11px] ${st}`}>Last 15 confirmed / done orders</p>
            </div>
          </div>
          {recentLoading && <RefreshCw size={14} className="animate-spin text-[#7367f0]" />}
        </div>

        {recentLoading && recent.length === 0 ? (
          <div className={`flex items-center justify-center h-24 gap-2 text-xs ${st}`}>
            <RefreshCw size={14} className="animate-spin" /> Loading recent orders...
          </div>
        ) : recent.length === 0 ? (
          <div className={`flex items-center justify-center h-24 gap-2 text-xs ${st}`}>
            <Clock size={14} /> No confirmed orders yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table w-full">
              <thead>
                <tr>
                  <th>SO #</th>
                  <th>Customer</th>
                  <th>Date</th>
                  <th className="text-right">Amount</th>
                  <th className="text-center">Delivery</th>
                </tr>
              </thead>
              <tbody>
                {recent.map(o => (
                  <tr key={o.id}>
                    <td>
                      <span className="font-mono text-xs font-semibold text-[#7367f0]">{o.name}</span>
                    </td>
                    <td className={`font-medium ${pt}`}>
                      {Array.isArray(o.partner_id) ? o.partner_id[1] : '--'}
                    </td>
                    <td className={`text-xs ${st}`}>
                      {o.date_order ? String(o.date_order).split(' ')[0] : '--'}
                    </td>
                    <td className={`text-right font-semibold ${pt}`}>
                      Rs.{fmt(o.amount_total)}
                    </td>
                    <td className="text-center">
                      <span className={`badge ${DELIVERY_BADGE[o.delivery_status] || 'badge-gray'}`}>
                        {DELIVERY_LABEL[o.delivery_status] || o.delivery_status || '--'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}

