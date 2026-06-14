import React, { useState, useEffect, useRef, useDeferredValue } from 'react';
import { useTheme } from '../../../context/ThemeContext';
import { useAuth } from '../../../context/AuthContext';
import { searchRead, createRecord, writeRecord, odooCall } from '../../../services/odoo';
import { loadGstRates, computeTotals, lineUntaxed, taxCommand, type GstRate } from '../../../services/gst';
import BulkDeleteBar from '../../ui/BulkDeleteBar';
import { fuzzyOdooDomain, sortByFuzzy } from '../../../utils/fuzzySearch';
import { downloadOdooReport, REPORTS } from '../../../utils/odooReports';
import {
  RefreshCw, Search, Eye, X, Plus, Edit2, FileDown,
  ShoppingBag, CheckCircle, Clock, TrendingUp, Trash2
} from 'lucide-react';

interface SalesOrder {
  id: number;
  name: string;
  partner_id: [number, string] | false;
  date_order: string;
  amount_total: number;
  state: string;
  delivery_status: string;
  warehouse_id: [number, string] | false;
  note: string;
}

interface OrderLine {
  product_id: number | '';
  product_tmpl_id: number | '';
  product_name: string;
  product_uom_qty: number;
  price_unit: number;
  discount: number;     // percent
  hsn: string;          // product.template.l10n_in_hsn_code
  hsn_orig: string;     // to detect change
  gst_rate: number;     // 0 = no tax
}

const EMPTY_LINE: OrderLine = {
  product_id: '', product_tmpl_id: '', product_name: '',
  product_uom_qty: 1, price_unit: 0, discount: 0, hsn: '', hsn_orig: '', gst_rate: 0,
};

interface Partner { id: number; name: string; }
interface Product { id: number; name: string; list_price: number; default_code: string; product_tmpl_id: [number, string] | false; }
interface Warehouse { id: number; name: string; }
interface Pricelist { id: number; name: string; }
interface PaymentTerm { id: number; name: string; }

const STATE_BADGE: Record<string, string> = {
  draft: 'badge-gray', sent: 'badge-blue', sale: 'badge-green', done: 'badge-violet', cancel: 'badge-red',
};
const STATE_LABEL: Record<string, string> = {
  draft: 'Quotation', sent: 'Sent', sale: 'Confirmed', done: 'Locked', cancel: 'Cancelled',
};

export default function SalesOrders() {
  const { isDark } = useTheme();
  const { user } = useAuth();
  const isAdmin = !!user?.is_admin;
  const [selIds, setSelIds] = useState<Set<number>>(new Set());
  const [items, setItems] = useState<SalesOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [stateFilter, setStateFilter] = useState('all');
  const [deliveryFilter, setDeliveryFilter] = useState('all');
  const [detailItem, setDetailItem] = useState<SalesOrder | null>(null);
  const [detailLines, setDetailLines] = useState<any[]>([]);
  const [createModal, setCreateModal] = useState(false);
  const [editMode, setEditMode] = useState<{ id: number; name: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);

  // Ref lists
  const [partners, setPartners] = useState<Partner[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [pricelists, setPricelists] = useState<Pricelist[]>([]);
  const [paymentTerms, setPaymentTerms] = useState<PaymentTerm[]>([]);
  const [partnerSearch, setPartnerSearch] = useState('');
  const [prodSearches, setProdSearches] = useState<string[]>(['']);
  const [showPartnerDrop, setShowPartnerDrop] = useState(false);
  const partnerRef = useRef<HTMLDivElement>(null);
  const [activeProdLine, setActiveProdLine] = useState<number | null>(null);
  const [dropPos, setDropPos] = useState<{ top: number; left: number; width: number } | null>(null);

  // Create form state
  const [form, setForm] = useState({
    partner_id: '' as number | '',
    partner_name: '',
    date_order: new Date().toISOString().slice(0, 10),
    warehouse_id: '' as number | '',
    pricelist_id: '' as number | '',
    payment_term_id: '' as number | '',
    client_order_ref: '',
    note: '',
    gst_bill: false,
  });
  const [lines, setLines] = useState<OrderLine[]>([{ ...EMPTY_LINE }]);
  const [gstRates, setGstRates] = useState<GstRate[]>([]);

  const showMsg = (ok: boolean, msg: string) => {
    setToast({ ok, msg });
    setTimeout(() => setToast(null), 5000);
  };

  const syncData = async () => {
    setLoading(true);
    try {
      const result = await searchRead<any>('sale.order', {
        domain: [['state', 'in', ['sale', 'done', 'draft', 'sent']]],
        fields: ['id', 'name', 'partner_id', 'date_order', 'amount_total', 'state', 'delivery_status', 'warehouse_id', 'note'],
        limit: 0,
        order: 'id desc',
      });
      if (Array.isArray(result)) setItems(result);
    } catch (e: any) { showMsg(false, 'Sync failed: ' + e.message); }
    finally { setLoading(false); }
  };

  const loadRefs = async () => {
    const [ps, whs, pls, pts] = await Promise.allSettled([
      searchRead<Partner>('res.partner', { fields: ['id', 'name'], domain: [['active', '=', true], ['customer_rank', '>', 0]], limit: 0 }),
      searchRead<Warehouse>('stock.warehouse', { fields: ['id', 'name'], limit: 0 }),
      searchRead<Pricelist>('product.pricelist', { fields: ['id', 'name'], domain: [['active', '=', true]], limit: 0 }),
      searchRead<PaymentTerm>('account.payment.term', { fields: ['id', 'name'], limit: 0 }),
    ]);
    if (ps.status === 'fulfilled') setPartners(Array.isArray(ps.value) ? ps.value : []);
    if (whs.status === 'fulfilled') {
      const whList = Array.isArray(whs.value) ? whs.value : [];
      setWarehouses(whList);
      if (whList.length > 0) setForm(f => ({ ...f, warehouse_id: whList[0].id }));
    }
    if (pls.status === 'fulfilled') setPricelists(Array.isArray(pls.value) ? pls.value : []);
    if (pts.status === 'fulfilled') setPaymentTerms(Array.isArray(pts.value) ? pts.value : []);
    setGstRates(await loadGstRates('sale'));
  };

  const searchProducts = async (q: string) => {
    if (!q || q.length < 2) { setProducts([]); return; }
    try {
      const nameDomain = fuzzyOdooDomain('name', q);
      const [prods, barcodes] = await Promise.allSettled([
        searchRead<Product>('product.product', {
          fields: ['id', 'name', 'list_price', 'default_code', 'product_tmpl_id'],
          domain: [['sale_ok', '=', true], ['active', '=', true], '|', ...nameDomain, ['default_code', 'ilike', q]],
          limit: 25,
        }),
        searchRead<{ id: number; name: string; product_id: [number, string] | false }>('sr.multi.barcode', {
          fields: ['id', 'name', 'product_id'],
          domain: [['name', 'ilike', q], ['product_id', '!=', false]],
          limit: 8,
        }),
      ]);
      const direct = prods.status === 'fulfilled' ? sortByFuzzy(prods.value || [], q) : [];
      const fromBarcode: Product[] = barcodes.status === 'fulfilled'
        ? (barcodes.value || []).filter(b => b.product_id).map(b => ({
            id: (b.product_id as [number, string])[0],
            name: (b.product_id as [number, string])[1],
            list_price: 0,
            default_code: b.name,
            product_tmpl_id: false as [number, string] | false,
          }))
        : [];
      const seen = new Set<number>();
      setProducts([...direct, ...fromBarcode].filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; }));
    } catch { setProducts([]); }
  };

  useEffect(() => { syncData(); loadRefs(); }, []);

  const openDetail = async (so: SalesOrder) => {
    setDetailItem(so);
    setDetailLines([]);
    try {
      const ls = await searchRead<any>('sale.order.line', {
        domain: [['order_id', '=', so.id]],
        fields: ['product_id', 'product_uom_qty', 'price_unit', 'discount', 'price_subtotal'],
        limit: 0,
      });
      setDetailLines(ls || []);
    } catch {}
  };

  const openEdit = async (so: SalesOrder) => {
    setSubmitting(true);
    try {
      const [full, soLines] = await Promise.all([
        searchRead<any>('sale.order', {
          domain: [['id', '=', so.id]],
          fields: ['partner_id', 'date_order', 'warehouse_id', 'pricelist_id', 'payment_term_id', 'client_order_ref', 'note'],
          limit: 1,
        }),
        searchRead<any>('sale.order.line', {
          domain: [['order_id', '=', so.id]],
          fields: ['product_id', 'product_tmpl_id', 'product_uom_qty', 'price_unit', 'discount', 'l10n_in_hsn_code'],
          limit: 0,
        }),
      ]);
      const o = full[0];
      const pId = Array.isArray(o.partner_id) ? o.partner_id[0] : o.partner_id;
      const pName = Array.isArray(o.partner_id) ? o.partner_id[1] : '';
      setForm({
        partner_id: pId, partner_name: pName,
        date_order: String(o.date_order || '').split(' ')[0] || new Date().toISOString().slice(0, 10),
        warehouse_id: Array.isArray(o.warehouse_id) ? o.warehouse_id[0] : (o.warehouse_id || ''),
        pricelist_id: Array.isArray(o.pricelist_id) ? o.pricelist_id[0] : '',
        payment_term_id: Array.isArray(o.payment_term_id) ? o.payment_term_id[0] : '',
        client_order_ref: o.client_order_ref || '',
        note: o.note || '',
        gst_bill: false,
      });
      setPartnerSearch(pName);
      const el = (soLines || []).map((l: any) => ({
        product_id: Array.isArray(l.product_id) ? l.product_id[0] : l.product_id,
        product_tmpl_id: Array.isArray(l.product_tmpl_id) ? l.product_tmpl_id[0] : '',
        product_name: Array.isArray(l.product_id) ? l.product_id[1] : '',
        product_uom_qty: l.product_uom_qty || 1,
        price_unit: l.price_unit || 0,
        discount: l.discount || 0,
        hsn: l.l10n_in_hsn_code || '',
        hsn_orig: l.l10n_in_hsn_code || '',
        gst_rate: 0,
      }));
      setLines(el.length > 0 ? el : [{ ...EMPTY_LINE }]);
      setProdSearches(el.map((l: any) => l.product_name));
      setEditMode({ id: so.id, name: so.name });
      setDetailItem(null);
      setCreateModal(true);
    } catch (e: any) { showMsg(false, 'Could not load order: ' + e.message); }
    finally { setSubmitting(false); }
  };

  // Default GST rate to apply when GST billing is on and a line has none yet.
  const defaultGstRate = () => (gstRates.find(r => r.rate === 18)?.rate ?? gstRates[gstRates.length - 1]?.rate ?? 0);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.partner_id || lines.every(l => !l.product_id)) {
      showMsg(false, 'Customer and at least one product are required.');
      return;
    }
    setSubmitting(true);

    if (editMode) {
      try {
        const usedLines = lines.filter(l => l.product_id);
        const orderLines: any[] = [[5, 0, 0], ...usedLines.map(l => {
          const taxId = gstRates.find(r => r.rate === l.gst_rate)?.taxId ?? null;
          return [0, 0, { product_id: l.product_id, product_uom_qty: l.product_uom_qty, price_unit: l.price_unit, discount: l.discount || 0, tax_id: taxCommand(form.gst_bill, taxId) }];
        })];
        const vals: Record<string, any> = {
          partner_id: form.partner_id, date_order: form.date_order + ' 00:00:00',
          note: form.note, order_line: orderLines,
        };
        if (form.warehouse_id) vals.warehouse_id = form.warehouse_id;
        if (form.client_order_ref.trim()) vals.client_order_ref = form.client_order_ref.trim();
        await writeRecord('sale.order', [editMode.id], vals);
        showMsg(true, `${editMode.name} updated.`);
        setCreateModal(false); setEditMode(null); resetForm(); syncData();
      } catch (e: any) { showMsg(false, 'Update failed: ' + e.message); }
      finally { setSubmitting(false); }
      return;
    }

    try {
      const usedLines = lines.filter(l => l.product_id);

      // Persist any edited HSN codes back onto the product templates so the
      // confirmed order / invoice prints the correct HSN.
      if (form.gst_bill) {
        for (const l of usedLines) {
          if (l.product_tmpl_id && l.hsn.trim() && l.hsn.trim() !== l.hsn_orig.trim()) {
            try { await writeRecord('product.template', [Number(l.product_tmpl_id)], { l10n_in_hsn_code: l.hsn.trim() }); } catch { /* non-fatal */ }
          }
        }
      }

      const orderLines = usedLines.map(l => {
        const taxId = gstRates.find(r => r.rate === l.gst_rate)?.taxId ?? null;
        return [0, 0, {
          product_id: l.product_id,
          product_uom_qty: l.product_uom_qty,
          price_unit: l.price_unit,
          discount: l.discount || 0,
          tax_id: taxCommand(form.gst_bill, taxId),
        }];
      });

      const vals: Record<string, any> = {
        partner_id: form.partner_id,
        date_order: form.date_order + ' 00:00:00',
        note: form.note,
        order_line: orderLines,
      };
      if (form.warehouse_id) vals.warehouse_id = form.warehouse_id;
      if (form.pricelist_id) vals.pricelist_id = form.pricelist_id;
      if (form.payment_term_id) vals.payment_term_id = form.payment_term_id;
      if (form.client_order_ref.trim()) vals.client_order_ref = form.client_order_ref.trim();

      const id = await createRecord('sale.order', vals);
      await odooCall('sale.order', 'action_confirm', [[id]], {});

      showMsg(true, 'Sale Order created & confirmed -- delivery auto-validated, invoice auto-created.');
      setCreateModal(false);
      resetForm();
      syncData();
    } catch (e: any) { showMsg(false, 'Create failed: ' + e.message); }
    finally { setSubmitting(false); }
  };

  const resetForm = () => {
    setForm({
      partner_id: '', partner_name: '',
      date_order: new Date().toISOString().slice(0, 10),
      warehouse_id: warehouses[0]?.id || '',
      pricelist_id: '',
      payment_term_id: '',
      client_order_ref: '',
      note: '',
      gst_bill: false,
    });
    setLines([{ ...EMPTY_LINE }]);
    setPartnerSearch('');
    setProdSearches(['']);
    setProducts([]);
  };

  const updateLine = (idx: number, changes: Partial<OrderLine>) => {
    setLines(prev => prev.map((l, i) => i === idx ? { ...l, ...changes } : l));
  };

  const selectProduct = async (idx: number, prod: Product) => {
    const tmplId = Array.isArray(prod.product_tmpl_id) ? prod.product_tmpl_id[0] : '';
    updateLine(idx, {
      product_id: prod.id,
      product_tmpl_id: tmplId,
      product_name: prod.name,
      price_unit: prod.list_price,
      gst_rate: form.gst_bill ? defaultGstRate() : 0,
    });
    setProdSearches(prev => prev.map((s, i) => i === idx ? prod.name : s));
    setProducts([]);
    // Pull the existing HSN code from the product template.
    if (tmplId) {
      try {
        const [tmpl] = await searchRead<any>('product.template', {
          domain: [['id', '=', tmplId]], fields: ['id', 'l10n_in_hsn_code'], limit: 1,
        });
        const hsn = tmpl?.l10n_in_hsn_code || '';
        updateLine(idx, { hsn, hsn_orig: hsn });
      } catch { /* ignore */ }
    }
  };

  const addLine = () => {
    setLines(prev => [...prev, { ...EMPTY_LINE, gst_rate: form.gst_bill ? defaultGstRate() : 0 }]);
    setProdSearches(prev => [...prev, '']);
  };

  const removeLine = (idx: number) => {
    setLines(prev => prev.filter((_, i) => i !== idx));
    setProdSearches(prev => prev.filter((_, i) => i !== idx));
  };

  // Toggle GST billing: seed/clear the per-line rate so the preview reflects it.
  const toggleGstBill = (on: boolean) => {
    setForm(f => ({ ...f, gst_bill: on }));
    setLines(prev => prev.map(l => ({ ...l, gst_rate: on ? (l.gst_rate || defaultGstRate()) : 0 })));
  };

  const totals = computeTotals(
    lines.map(l => ({ qty: l.product_uom_qty, price: l.price_unit, discount: l.discount, gstRate: l.gst_rate })),
    form.gst_bill,
  );

  const filtered = items.filter(o => {
    const name = o.name || '';
    const customer = Array.isArray(o.partner_id) ? o.partner_id[1] : '';
    const ms = !deferredSearch || name.toLowerCase().includes(deferredSearch.toLowerCase()) || customer.toLowerCase().includes(deferredSearch.toLowerCase());
    const mf = stateFilter === 'all' || o.state === stateFilter;
    const md = deliveryFilter === 'all' || o.delivery_status === deliveryFilter;
    return ms && mf && md;
  });

  const totalRevenue = items.reduce((s, o) => s + o.amount_total, 0);
  const totalDelivered = items.filter(o => o.delivery_status === 'full').length;
  const totalPending = items.filter(o => o.delivery_status === 'pending').length;

  const fmt = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2 });
  const st = isDark ? 'text-[#5a6a8a]' : 'text-gray-500';
  const pt = isDark ? 'text-white' : 'text-gray-900';
  const inp = `input text-xs py-2 ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`;
  const modalBg = `w-full rounded-2xl shadow-2xl border ${isDark ? 'bg-[#161b2e] border-[#2a3250]' : 'bg-white border-gray-200'}`;
  const filteredPartners = partners.filter(p => !partnerSearch || p.name.toLowerCase().includes(partnerSearch.toLowerCase())).slice(0, 10);
  // products state is used directly in the fixed dropdown

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
          <h1 className={`text-xl font-black ${pt}`}>Sales Orders</h1>
          <p className={`text-xs mt-0.5 ${st}`}>All orders -- confirmed, done, and drafts</p>
        </div>
        <div className="flex gap-2 self-start sm:self-auto">
          <button onClick={syncData} disabled={loading} className="btn-secondary text-xs px-3 py-2">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Sync
          </button>
          <button onClick={() => { resetForm(); setCreateModal(true); }} className="btn-primary text-xs px-3 py-2">
            <Plus size={13} /> New Sale
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Orders', val: items.length, icon: ShoppingBag, color: 'text-violet-400', bg: 'bg-violet-500/15' },
          { label: 'Delivered', val: totalDelivered, icon: CheckCircle, color: 'text-green-400', bg: 'bg-green-500/15' },
          { label: 'Pending', val: totalPending, icon: Clock, color: 'text-amber-400', bg: 'bg-amber-500/15' },
          { label: 'Revenue', val: `Rs.${(totalRevenue / 100000).toFixed(1)}L`, icon: TrendingUp, color: 'text-blue-400', bg: 'bg-blue-500/15' },
        ].map(s => (
          <div key={s.label} className="card p-5 flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl ${s.bg} flex items-center justify-center flex-shrink-0`}>
              <s.icon size={16} className={s.color} />
            </div>
            <div>
              <p className={`text-xs ${st}`}>{s.label}</p>
              <p className={`text-xl font-black ${pt}`}>{s.val}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="card p-3 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-[3] min-w-0">
          <Search size={14} className={`absolute left-3 top-1/2 -translate-y-1/2 ${st}`} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by order # or customer..."
            autoComplete="off" autoCorrect="off" spellCheck="false"
            className={`input w-full pl-9 text-xs py-2 ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`} />
        </div>
        <select value={stateFilter} onChange={e => setStateFilter(e.target.value)} className={`${inp} w-auto`}>
          <option value="all">All Status</option>
          <option value="draft">Quotation</option>
          <option value="sent">Sent</option>
          <option value="sale">Confirmed</option>
          <option value="done">Locked</option>
          <option value="cancel">Cancelled</option>
        </select>
        <select value={deliveryFilter} onChange={e => setDeliveryFilter(e.target.value)} className={`${inp} w-auto`}>
          <option value="all">All Delivery</option>
          <option value="pending">Pending</option>
          <option value="partial">Partial</option>
          <option value="full">Delivered</option>
        </select>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-40 gap-3">
            <RefreshCw size={18} className="animate-spin text-[#7367f0]" />
            <span className={`text-sm ${st}`}>Syncing from Odoo...</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table w-full">
              <thead>
                <tr>
                  {isAdmin && <th className="w-8"><input type="checkbox" className="rounded" checked={filtered.length > 0 && filtered.every(o => selIds.has(o.id))} onChange={e => setSelIds(e.target.checked ? new Set(filtered.map(o => o.id)) : new Set())} /></th>}
                  <th>SO #</th><th>Customer</th><th>Date</th><th className="text-right">Amount</th>
                  <th className="text-center">Status</th><th className="text-center">Delivery</th><th className="text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={isAdmin ? 8 : 7} className={`text-center py-10 text-xs ${st}`}>No orders match filters.</td></tr>
                ) : filtered.map(o => (
                  <tr key={o.id} className={selIds.has(o.id) ? (isDark ? 'bg-[#7367f0]/5' : 'bg-violet-50') : ''}>
                    {isAdmin && <td><input type="checkbox" className="rounded" checked={selIds.has(o.id)} onChange={() => setSelIds(prev => { const n = new Set(prev); n.has(o.id) ? n.delete(o.id) : n.add(o.id); return n; })} /></td>}
                    <td><span className="font-mono text-xs font-semibold text-[#7367f0]">{o.name}</span></td>
                    <td className={`font-medium ${pt}`}>{Array.isArray(o.partner_id) ? o.partner_id[1] : '--'}</td>
                    <td className={`text-xs ${st}`}>{o.date_order ? String(o.date_order).split(' ')[0] : '--'}</td>
                    <td className={`text-right font-semibold ${pt}`}>Rs.{fmt(o.amount_total)}</td>
                    <td className="text-center">
                      <span className={STATE_BADGE[o.state] || 'badge-gray'}>{STATE_LABEL[o.state] || o.state}</span>
                    </td>
                    <td className="text-center">
                      <span className={`badge ${
                        o.delivery_status === 'full' ? 'badge-green' :
                        o.delivery_status === 'partial' ? 'badge-gold' : 'badge-gray'
                      }`}>
                        {o.delivery_status === 'full' ? 'Delivered' : o.delivery_status === 'partial' ? 'Partial' : 'Pending'}
                      </span>
                    </td>
                    <td className="text-center">
                      <div className="flex gap-1 justify-center items-center">
                        <button onClick={() => openDetail(o)} title="View" className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-white/5 text-[#5a6a8a] hover:text-white' : 'hover:bg-gray-100 text-gray-400 hover:text-gray-700'}`}>
                          <Eye size={13} />
                        </button>
                        <button onClick={() => downloadOdooReport(REPORTS.saleOrder, o.id, (o.name || 'sale-order').replace(/[\\/]/g, '-')).catch(e => alert(e.message))} title="Download PDF" className="p-1.5 rounded-lg text-[#7367f0] hover:bg-[#7367f0]/10">
                          <FileDown size={13} />
                        </button>
                        {o.state === 'draft' && (
                          <button onClick={() => openEdit(o)} title="Edit" className={`p-1.5 rounded-lg text-amber-400 hover:bg-amber-500/10`}>
                            <Edit2 size={13} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {detailItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setDetailItem(null)}>
          <div className={`${modalBg} max-w-3xl w-full max-h-[90vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
            <div className={`flex justify-between items-center px-5 py-4 border-b sticky top-0 z-10 ${isDark ? 'bg-[#161b2e] border-[#2a3250]' : 'bg-white border-gray-100'}`}>
              <div>
                <h3 className={`font-bold ${pt}`}>{detailItem.name}</h3>
                <p className={`text-xs ${st}`}>{Array.isArray(detailItem.partner_id) ? detailItem.partner_id[1] : '--'}</p>
              </div>
              <div className="flex items-center gap-2">
                {detailItem.state === 'draft' && (
                  <button onClick={() => openEdit(detailItem)} disabled={submitting}
                    className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1">
                    <Edit2 size={12} /> Edit
                  </button>
                )}
                <button onClick={() => setDetailItem(null)} className={`p-1.5 rounded-lg ${isDark ? 'text-[#5a6a8a] hover:bg-white/5' : 'text-gray-400 hover:bg-gray-100'}`}><X size={16} /></button>
              </div>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                {[
                  { label: 'Date', val: String(detailItem.date_order).split(' ')[0] },
                  { label: 'Warehouse', val: Array.isArray(detailItem.warehouse_id) ? detailItem.warehouse_id[1] : '--' },
                  { label: 'Amount', val: `₹${fmt(detailItem.amount_total)}` },
                  { label: 'Status', val: STATE_LABEL[detailItem.state] || detailItem.state },
                ].map(f => (
                  <div key={f.label} className={`p-3 rounded-xl border ${isDark ? 'bg-[#12172a] border-[#2a3250]' : 'bg-gray-50 border-gray-100'}`}>
                    <p className={`${st} font-semibold uppercase tracking-wider text-[10px]`}>{f.label}</p>
                    <p className={`font-bold mt-0.5 ${pt}`}>{f.val}</p>
                  </div>
                ))}
              </div>
              {detailItem.note && <p className={`text-xs ${st}`}><span className="font-semibold">Note: </span>{detailItem.note}</p>}
              {/* Order Lines */}
              <div className={`rounded-xl border overflow-x-auto ${isDark ? 'border-[#2a3250]' : 'border-gray-200'}`}>
                <table className="w-full min-w-[460px]">
                  <thead>
                    <tr className={`text-xs font-bold uppercase tracking-wider ${isDark ? 'bg-[#1e2440] text-[#5a6a8a]' : 'bg-gray-50 text-gray-500'}`}>
                      <th className="px-3 py-3 text-left">Product</th>
                      <th className="px-3 py-3 text-right w-20">Qty</th>
                      <th className="px-3 py-3 text-right w-28">Unit Price</th>
                      <th className="px-3 py-3 text-right w-16">Disc%</th>
                      <th className="px-3 py-3 text-right w-28">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${isDark ? 'divide-[#2a3250]' : 'divide-gray-100'}`}>
                    {detailLines.length === 0 ? (
                      <tr><td colSpan={5} className={`text-center py-4 text-xs ${st}`}>Loading lines...</td></tr>
                    ) : detailLines.map((l, i) => (
                      <tr key={i}>
                        <td className={`px-3 py-2.5 text-sm ${pt}`}>{Array.isArray(l.product_id) ? l.product_id[1] : '--'}</td>
                        <td className={`px-3 py-2.5 text-right text-sm ${st}`}>{l.product_uom_qty}</td>
                        <td className={`px-3 py-2.5 text-right text-sm ${st}`}>₹{fmt(l.price_unit)}</td>
                        <td className={`px-3 py-2.5 text-right text-sm ${st}`}>{l.discount || 0}%</td>
                        <td className={`px-3 py-2.5 text-right text-sm font-semibold ${pt}`}>₹{fmt(l.price_subtotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className={`border-t ${isDark ? 'border-[#2a3250]' : 'border-gray-200'}`}>
                      <td colSpan={4} className={`px-3 py-3 text-sm font-bold text-right ${st}`}>Total:</td>
                      <td className="px-3 py-3 text-right text-base font-black text-[#7367f0]">₹{fmt(detailItem.amount_total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Sale Order Modal */}
      {createModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in" onClick={() => setCreateModal(false)}>
          <div className={`${modalBg} max-w-4xl w-full max-h-[90vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
            <div className={`flex justify-between items-center px-5 py-4 border-b sticky top-0 z-10 ${isDark ? 'bg-[#161b2e] border-[#2a3250]' : 'bg-white border-gray-100'}`}>
              <div>
                <h3 className={`font-bold ${pt}`}>{editMode ? `Edit ${editMode.name}` : 'New Sale Order'}</h3>
                <p className={`text-xs ${st}`}>{editMode ? 'Update order header and lines' : 'Creates, confirms, auto-validates delivery & auto-invoices'}</p>
              </div>
              <button onClick={() => setCreateModal(false)} className={`p-1.5 rounded-lg ${isDark ? 'text-[#5a6a8a] hover:bg-white/5' : 'text-gray-400 hover:bg-gray-100'}`}><X size={16} /></button>
            </div>
            <form onSubmit={handleCreate} className="p-5 space-y-4">
              {/* Customer */}
              <div ref={partnerRef} className="relative">
                <label className={`text-[10px] font-semibold block mb-1 ${st}`}>Customer *</label>
                <input
                  value={partnerSearch}
                  onChange={e => { setPartnerSearch(e.target.value); setShowPartnerDrop(true); setForm(f => ({ ...f, partner_id: '', partner_name: '' })); }}
                  onFocus={() => setShowPartnerDrop(true)}
                  placeholder="Search customer..."
                  className={`${inp} w-full`}
                  required={!form.partner_id}
                />
                {form.partner_id && (
                  <div className="mt-1 text-xs font-semibold text-[#7367f0]">
                    -- {form.partner_name}
                  </div>
                )}
                {showPartnerDrop && filteredPartners.length > 0 && !form.partner_id && (
                  <div className={`absolute z-20 w-full rounded-xl border shadow-xl mt-1 max-h-40 overflow-y-auto ${isDark ? 'bg-[#1e2440] border-[#2a3250]' : 'bg-white border-gray-200'}`}>
                    {filteredPartners.map(p => (
                      <button key={p.id} type="button"
                        className={`w-full text-left px-3 py-2 text-xs hover:bg-[#7367f0]/10 ${isDark ? 'text-white' : 'text-gray-800'}`}
                        onClick={() => { setForm(f => ({ ...f, partner_id: p.id, partner_name: p.name })); setPartnerSearch(p.name); setShowPartnerDrop(false); }}>
                        {p.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Customer Reference */}
              <div>
                <label className={`text-[10px] font-semibold block mb-1 ${st}`}>Customer Reference / PO No.</label>
                <input
                  type="text"
                  value={form.client_order_ref}
                  onChange={e => setForm(f => ({ ...f, client_order_ref: e.target.value }))}
                  placeholder="e.g. PO-2026-001"
                  className={`${inp} w-full`}
                />
              </div>

              {/* Date & Warehouse */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={`text-[10px] font-semibold block mb-1 ${st}`}>Order Date *</label>
                  <input type="date" value={form.date_order} onChange={e => setForm(f => ({ ...f, date_order: e.target.value }))} className={`${inp} w-full`} required />
                </div>
                <div>
                  <label className={`text-[10px] font-semibold block mb-1 ${st}`}>Warehouse</label>
                  <select value={form.warehouse_id} onChange={e => setForm(f => ({ ...f, warehouse_id: Number(e.target.value) }))} className={`${inp} w-full`}>
                    {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </div>
              </div>

              {/* Pricelist & Payment Terms */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={`text-[10px] font-semibold block mb-1 ${st}`}>Pricelist</label>
                  <select
                    value={form.pricelist_id}
                    onChange={e => setForm(f => ({ ...f, pricelist_id: e.target.value ? Number(e.target.value) : '' }))}
                    className={`${inp} w-full`}
                  >
                    <option value="">-- Default --</option>
                    {pricelists.map(pl => <option key={pl.id} value={pl.id}>{pl.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className={`text-[10px] font-semibold block mb-1 ${st}`}>Payment Terms</label>
                  <select
                    value={form.payment_term_id}
                    onChange={e => setForm(f => ({ ...f, payment_term_id: e.target.value ? Number(e.target.value) : '' }))}
                    className={`${inp} w-full`}
                  >
                    <option value="">-- Default --</option>
                    {paymentTerms.map(pt2 => <option key={pt2.id} value={pt2.id}>{pt2.name}</option>)}
                  </select>
                </div>
              </div>

              {/* GST billing toggle */}
              <div className={`flex items-center justify-between p-3 rounded-xl border ${isDark ? 'bg-[#12172a] border-[#2a3250]' : 'bg-gray-50 border-gray-200'}`}>
                <div>
                  <p className={`text-xs font-bold ${pt}`}>GST Bill</p>
                  <p className={`text-[10px] ${st}`}>Apply GST with HSN code and tax rate per line.</p>
                </div>
                <button
                  type="button"
                  onClick={() => toggleGstBill(!form.gst_bill)}
                  className={`relative w-11 h-6 rounded-full transition-colors ${form.gst_bill ? 'bg-[#7367f0]' : isDark ? 'bg-[#2a3250]' : 'bg-gray-300'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${form.gst_bill ? 'translate-x-5' : ''}`} />
                </button>
              </div>

              {/* Order Lines */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className={`text-[10px] font-semibold ${st}`}>Order Lines *</label>
                  <button type="button" onClick={addLine} className="text-xs text-[#7367f0] font-semibold flex items-center gap-1 hover:underline">
                    <Plus size={11} /> Add Line
                  </button>
                </div>
                <div className={`rounded-xl border overflow-x-auto ${isDark ? 'border-[#2a3250]' : 'border-gray-200'}`}>
                  <table className="w-full min-w-[820px]">
                    <thead>
                      <tr className={`text-xs font-bold uppercase tracking-wider ${isDark ? 'bg-[#1e2440] text-[#5a6a8a]' : 'bg-gray-50 text-gray-500'}`}>
                        <th className="px-3 py-3 text-left">Product</th>
                        {form.gst_bill && <th className="px-2 py-3 text-left w-28">HSN</th>}
                        <th className="px-2 py-3 text-right w-20">Qty</th>
                        <th className="px-2 py-3 text-right w-28">Unit Price</th>
                        <th className="px-2 py-3 text-right w-20">Disc %</th>
                        {form.gst_bill && <th className="px-2 py-3 text-right w-24">GST</th>}
                        <th className="px-3 py-3 text-right w-32">Subtotal</th>
                        <th className="px-2 py-3 w-10"></th>
                      </tr>
                    </thead>
                    <tbody className={`divide-y ${isDark ? 'divide-[#2a3250]' : 'divide-gray-100'}`}>
                      {lines.map((line, idx) => (
                        <tr key={idx}>
                          <td className="px-3 py-2">
                            <input
                              value={prodSearches[idx] || ''}
                              onChange={e => {
                                const v = e.target.value;
                                const r = e.target.getBoundingClientRect();
                                setDropPos({ top: r.bottom + 4, left: r.left, width: r.width });
                                setActiveProdLine(idx);
                                setProdSearches(prev => prev.map((s, i) => i === idx ? v : s));
                                updateLine(idx, { product_id: '', product_name: '', product_tmpl_id: '', hsn: '', hsn_orig: '' });
                                searchProducts(v);
                              }}
                              onFocus={e => { const r = e.target.getBoundingClientRect(); setDropPos({ top: r.bottom + 4, left: r.left, width: r.width }); setActiveProdLine(idx); }}
                              onBlur={() => setTimeout(() => { setActiveProdLine(null); setDropPos(null); setProducts([]); }, 150)}
                              placeholder="Search product..."
                              className={`input text-sm py-3 w-full min-w-[200px] ${isDark ? 'bg-[#12172a] border-[#2a3250] text-white' : ''}`}
                            />
                          </td>
                          {form.gst_bill && (
                            <td className="px-2 py-2">
                              <input value={line.hsn} onChange={e => updateLine(idx, { hsn: e.target.value })}
                                placeholder="HSN" className={`input text-sm py-3 w-full ${isDark ? 'bg-[#12172a] border-[#2a3250] text-white' : ''}`} />
                            </td>
                          )}
                          <td className="px-2 py-2">
                            <input type="number" min="1" step="1" value={line.product_uom_qty}
                              onChange={e => updateLine(idx, { product_uom_qty: Number(e.target.value) })}
                              className={`input text-sm py-3 text-right w-full ${isDark ? 'bg-[#12172a] border-[#2a3250] text-white' : ''}`} />
                          </td>
                          <td className="px-2 py-2">
                            <input type="number" min="0" step="0.01" value={line.price_unit}
                              onChange={e => updateLine(idx, { price_unit: Number(e.target.value) })}
                              className={`input text-sm py-3 text-right w-full ${isDark ? 'bg-[#12172a] border-[#2a3250] text-white' : ''}`} />
                          </td>
                          <td className="px-2 py-2">
                            <input type="number" min="0" max="100" step="0.01" value={line.discount}
                              onChange={e => updateLine(idx, { discount: Number(e.target.value) })}
                              className={`input text-sm py-3 text-right w-full ${isDark ? 'bg-[#12172a] border-[#2a3250] text-white' : ''}`} />
                          </td>
                          {form.gst_bill && (
                            <td className="px-2 py-2">
                              <select value={line.gst_rate} onChange={e => updateLine(idx, { gst_rate: Number(e.target.value) })}
                                className={`input text-sm py-3 w-full ${isDark ? 'bg-[#12172a] border-[#2a3250] text-white' : ''}`}>
                                <option value={0}>0%</option>
                                {gstRates.map(r => <option key={r.taxId} value={r.rate}>{r.rate}%</option>)}
                              </select>
                            </td>
                          )}
                          <td className={`px-3 py-2 text-right text-sm font-semibold ${pt}`}>
                            Rs.{lineUntaxed({ qty: line.product_uom_qty, price: line.price_unit, discount: line.discount, gstRate: line.gst_rate }).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                          </td>
                          <td className="px-2 py-2 text-center">
                            {lines.length > 1 && (
                              <button type="button" onClick={() => removeLine(idx)} className="text-red-400 hover:text-red-300">
                                <Trash2 size={14} />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {/* Totals */}
                <div className="mt-3 flex justify-end">
                  <div className={`w-full sm:w-64 rounded-xl border p-3 space-y-1.5 ${isDark ? 'bg-[#12172a] border-[#2a3250]' : 'bg-gray-50 border-gray-200'}`}>
                    <div className="flex justify-between text-xs">
                      <span className={st}>Untaxed Amount</span>
                      <span className={`font-semibold ${pt}`}>Rs.{totals.untaxed.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                    </div>
                    {form.gst_bill && (
                      <div className="flex justify-between text-xs">
                        <span className={st}>GST</span>
                        <span className={`font-semibold ${pt}`}>Rs.{totals.tax.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                      </div>
                    )}
                    <div className={`flex justify-between text-sm font-black pt-1.5 border-t ${isDark ? 'border-[#2a3250]' : 'border-gray-200'}`}>
                      <span className={pt}>Total</span>
                      <span className="text-[#7367f0]">Rs.{totals.total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Note */}
              <div>
                <label className={`text-[10px] font-semibold block mb-1 ${st}`}>Notes / Terms</label>
                <textarea value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} rows={2}
                  className={`input text-xs py-2 w-full resize-none ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`}
                  placeholder="Internal notes or delivery instructions..." />
              </div>

              <div className={`p-3 rounded-xl text-xs border ${isDark ? 'bg-amber-500/5 border-amber-500/20 text-amber-300' : 'bg-amber-50 border-amber-200 text-amber-700'}`}>
                <strong>Note:</strong> Confirming this sale order will auto-validate delivery from MAIN warehouse and auto-create a posted invoice.
              </div>

              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => { setCreateModal(false); setEditMode(null); resetForm(); }} className="btn-secondary flex-1 justify-center py-2.5">Cancel</button>
                <button type="submit" disabled={submitting || !form.partner_id} className="btn-primary flex-1 justify-center py-2.5">
                  {submitting ? <RefreshCw size={14} className="animate-spin" /> : editMode ? <Edit2 size={14} /> : <Plus size={14} />}
                  {submitting ? (editMode ? 'Saving...' : 'Creating...') : editMode ? 'Save Changes' : 'Create & Confirm'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Fixed product search dropdown — escapes modal overflow clipping */}
      {activeProdLine !== null && dropPos && products.length > 0 && !lines[activeProdLine]?.product_id && (
        <div
          className={`fixed z-[9999] rounded-xl border shadow-2xl overflow-y-auto ${isDark ? 'bg-[#1e2440] border-[#2a3250]' : 'bg-white border-gray-200'}`}
          style={{ top: dropPos.top, left: dropPos.left, width: dropPos.width, maxHeight: 240 }}
          onMouseDown={e => e.preventDefault()}
        >
          {products.map(p => (
            <button key={p.id} type="button"
              className={`w-full text-left px-3 py-2 text-sm hover:bg-[#7367f0]/10 ${isDark ? 'text-white' : 'text-gray-800'}`}
              onClick={() => { selectProduct(activeProdLine!, p); setActiveProdLine(null); setDropPos(null); }}>
              <span className="font-semibold">{p.name}</span>
              {p.default_code && <span className={`ml-1 text-xs ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>[{p.default_code}]</span>}
            </button>
          ))}
        </div>
      )}

      <BulkDeleteBar model="sale.order" label="order" ids={Array.from(selIds)}
        onClear={() => setSelIds(new Set())} onDeleted={() => syncData()} />
    </div>
  );
}
