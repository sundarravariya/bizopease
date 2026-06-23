import React, { useState, useEffect, useRef } from 'react';
import { useTheme } from '../../../context/ThemeContext';
import { useAuth } from '../../../context/AuthContext';
import { searchRead, createRecord, writeRecord, odooCall } from '../../../services/odoo';
import BulkDeleteBar from '../../ui/BulkDeleteBar';
import { fuzzyOdooDomain, sortByFuzzy } from '../../../utils/fuzzySearch';
import { downloadOdooReport, REPORTS } from '../../../utils/odooReports';
import {
  RefreshCw, Search, Eye, X, Plus, Trash2, Edit2, FileDown,
  Package, CheckCircle, Clock, IndianRupee, Truck, FileText, Ban, RotateCcw
} from 'lucide-react';

interface PurchaseOrder {
  id: number;
  name: string;
  partner_id: [number, string] | false;
  date_order: string;
  amount_total: number;
  state: string;
  receipt_status: string | false;
  invoice_status: string;
  carrying_agent_id: [number, string] | false;
  total_inr: number;
  net_agent_liability_inr: number;
  currency_id: [number, string] | false;
}

interface OrderLine {
  product_id: number | '';
  product_name: string;
  product_qty: number;
  price_unit: number;
}

interface Vendor { id: number; name: string; }
interface Product { id: number; name: string; standard_price: number; default_code: string; }
interface Agent { id: number; name: string; }
interface Currency { id: number; name: string; }

const STATE_BADGE: Record<string, string> = {
  draft: 'badge-gray', sent: 'badge-blue', purchase: 'badge-violet', done: 'badge-green', cancel: 'badge-red',
};
const STATE_LABEL: Record<string, string> = {
  draft: 'RFQ', sent: 'RFQ Sent', purchase: 'Confirmed', done: 'Locked', cancel: 'Cancelled',
};

export default function PurchaseOrders() {
  const { isDark } = useTheme();
  const { user } = useAuth();
  const isAdmin = !!user?.is_admin;
  const [selIds, setSelIds] = useState<Set<number>>(new Set());
  const [items, setItems] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState('all');
  const [receiptFilter, setReceiptFilter] = useState('all');
  const [detailItem, setDetailItem] = useState<PurchaseOrder | null>(null);
  const [detailLines, setDetailLines] = useState<any[]>([]);
  const [createModal, setCreateModal] = useState(false);
  const [editMode, setEditMode] = useState<{ id: number; name: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);

  // Ref lists
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [vendorSearch, setVendorSearch] = useState('');
  const [prodSearches, setProdSearches] = useState<string[]>(['']);
  const [activeProdLine, setActiveProdLine] = useState<number | null>(null);
  const [dropPos, setDropPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const [kitTmplIds, setKitTmplIds] = useState<number[]>([]);
  const [showVendorDrop, setShowVendorDrop] = useState(false);
  const vendorRef = useRef<HTMLDivElement>(null);

  const [form, setForm] = useState({
    partner_id: '' as number | '',
    partner_name: '',
    date_order: new Date().toISOString().slice(0, 10),
    carrying_agent_id: '' as number | '',
    currency_id: '' as number | '',
    exchange_rate: 15,
    deposit_paid: 0,
    shipping_cost: 0,
  });
  const [lines, setLines] = useState<OrderLine[]>([
    { product_id: '', product_name: '', product_qty: 1, price_unit: 0 },
  ]);

  const showMsg = (ok: boolean, msg: string) => {
    setToast({ ok, msg });
    setTimeout(() => setToast(null), 6000);
  };

  const syncData = async () => {
    setLoading(true);
    try {
      let result: PurchaseOrder[] | null = null;
      try {
        result = await searchRead<PurchaseOrder>('purchase.order', {
          domain: [['state', 'in', ['draft', 'sent', 'purchase', 'done', 'cancel']]],
          fields: ['id', 'name', 'partner_id', 'date_order', 'amount_total', 'state', 'receipt_status',
            'invoice_status', 'carrying_agent_id', 'total_inr', 'net_agent_liability_inr', 'currency_id'],
          limit: 0,
          order: 'id desc',
        });
      } catch (fieldErr: any) {
        if (String(fieldErr?.message).includes('Invalid field')) {
          result = await searchRead<PurchaseOrder>('purchase.order', {
            domain: [['state', 'in', ['draft', 'sent', 'purchase', 'done', 'cancel']]],
            fields: ['id', 'name', 'partner_id', 'date_order', 'amount_total', 'state', 'receipt_status',
              'invoice_status', 'currency_id'],
            limit: 0,
            order: 'id desc',
          });
        } else throw fieldErr;
      }
      if (Array.isArray(result)) setItems(result);
    } catch (e: any) { showMsg(false, 'Sync failed: ' + e.message); }
    finally { setLoading(false); }
  };

  const loadRefs = async () => {
    const [vs, ag, curs] = await Promise.allSettled([
      searchRead<Vendor>('res.partner', { fields: ['id', 'name'], domain: [['active', '=', true], ['supplier_rank', '>', 0]], limit: 0 }),
      searchRead<Agent>('flipkart.carrying.agent', { fields: ['id', 'name'], limit: 0 }),
      searchRead<Currency>('res.currency', { fields: ['id', 'name'], domain: [['active', '=', true]], limit: 0 }),
    ]);
    if (vs.status === 'fulfilled') setVendors(vs.value || []);
    if (ag.status === 'fulfilled') setAgents(ag.value || []);
    if (curs.status === 'fulfilled' && Array.isArray(curs.value)) {
      setCurrencies(curs.value);
      const cny = curs.value.find(c => c.name === 'CNY') || curs.value[0];
      if (cny) setForm(f => ({ ...f, currency_id: f.currency_id || cny.id }));
    }
    searchRead<{ product_tmpl_id: [number, string] | false }>('mrp.bom', {
      domain: [['type', '=', 'phantom']], fields: ['product_tmpl_id'], limit: 0,
    }).then(boms => {
      const ids = (boms || []).filter(b => b.product_tmpl_id).map(b => (b.product_tmpl_id as [number, string])[0]);
      setKitTmplIds(ids);
    }).catch(() => {});
  };

  const searchProducts = async (q: string) => {
    if (!q || q.length < 2) { setProducts([]); return; }
    const nameDomain = fuzzyOdooDomain('name', q);
    const prodDomain: any[] = [['purchase_ok', '=', true], ['active', '=', true], '|', ...nameDomain, ['default_code', 'ilike', q]];
    if (kitTmplIds.length) prodDomain.unshift(['product_tmpl_id', 'not in', kitTmplIds]);
    const [prods, barcodes] = await Promise.allSettled([
      searchRead<Product>('product.product', {
        fields: ['id', 'name', 'standard_price', 'default_code'],
        domain: prodDomain,
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
          standard_price: 0,
          default_code: b.name,
        }))
      : [];
    const seen = new Set<number>();
    setProducts([...direct, ...fromBarcode].filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; }));
  };

  const getCurrSymbol = () => '¥'; // legacy — form uses currSymbol below

  const lookupLastPurchasePrice = async (productId: number, vendorId: number | ''): Promise<number | null> => {
    try {
      if (vendorId) {
        const vendorLines = await searchRead<{ price_unit: number }>('purchase.order.line', {
          domain: [['product_id', '=', productId], ['order_id.partner_id', '=', vendorId], ['state', 'in', ['purchase', 'done']]],
          fields: ['price_unit'], order: 'date_order desc, id desc', limit: 1,
        });
        if (vendorLines?.length) return vendorLines[0].price_unit;
      }
      const anyLines = await searchRead<{ price_unit: number }>('purchase.order.line', {
        domain: [['product_id', '=', productId], ['state', 'in', ['purchase', 'done']]],
        fields: ['price_unit'], order: 'date_order desc, id desc', limit: 1,
      });
      if (anyLines?.length) return anyLines[0].price_unit;
    } catch {}
    return null;
  };

  const openEdit = async (po: PurchaseOrder) => {
    setSubmitting(true);
    try {
      const [full, poLines] = await Promise.all([
        (async () => {
          try {
            return await searchRead<any>('purchase.order', {
              domain: [['id', '=', po.id]],
              fields: ['partner_id', 'date_order', 'carrying_agent_id', 'currency_id', 'exchange_rate', 'deposit_paid', 'shipping_cost'],
              limit: 1,
            });
          } catch (e: any) {
            if (String(e?.message).includes('Invalid field')) {
              return await searchRead<any>('purchase.order', {
                domain: [['id', '=', po.id]],
                fields: ['partner_id', 'date_order', 'currency_id'],
                limit: 1,
              });
            }
            throw e;
          }
        })(),
        searchRead<any>('purchase.order.line', {
          domain: [['order_id', '=', po.id]],
          fields: ['product_id', 'product_qty', 'price_unit'],
          limit: 0,
        }),
      ]);
      const o = full[0];
      const pId = Array.isArray(o.partner_id) ? o.partner_id[0] : o.partner_id;
      const pName = Array.isArray(o.partner_id) ? o.partner_id[1] : '';
      setForm({
        partner_id: pId, partner_name: pName,
        date_order: String(o.date_order || '').split(' ')[0] || new Date().toISOString().slice(0, 10),
        carrying_agent_id: Array.isArray(o.carrying_agent_id) ? o.carrying_agent_id[0] : '',
        currency_id: Array.isArray(o.currency_id) ? o.currency_id[0] : '',
        exchange_rate: o.exchange_rate || 15,
        deposit_paid: o.deposit_paid || 0,
        shipping_cost: o.shipping_cost || 0,
      });
      setVendorSearch(pName);
      const el = (poLines || []).map((l: any) => ({
        product_id: Array.isArray(l.product_id) ? l.product_id[0] : l.product_id,
        product_name: Array.isArray(l.product_id) ? l.product_id[1] : '',
        product_qty: l.product_qty || 1,
        price_unit: l.price_unit || 0,
      }));
      setLines(el.length > 0 ? el : [{ product_id: '', product_name: '', product_qty: 1, price_unit: 0 }]);
      setProdSearches(el.map((l: any) => l.product_name));
      setEditMode({ id: po.id, name: po.name });
      closeDetail();
      setCreateModal(true);
    } catch (e: any) { showMsg(false, 'Could not load order: ' + e.message); }
    finally { setSubmitting(false); }
  };

  useEffect(() => { syncData(); loadRefs(); }, []);

  // ---- Workflow handlers ----

  const handleConfirm = async (po: PurchaseOrder) => {
    setBusyId(po.id);
    try {
      await odooCall('purchase.order', 'button_confirm', [[po.id]], {});
      showMsg(true, po.name + ' confirmed -- now a Purchase Order.');
      await syncData();
      if (detailItem?.id === po.id) closeDetail();
    } catch (e: any) { showMsg(false, 'Confirm failed: ' + e.message); }
    finally { setBusyId(null); }
  };

  const handleReceive = async (po: PurchaseOrder) => {
    setBusyId(po.id);
    try {
      const poRec = await searchRead<any>('purchase.order', {
        domain: [['id', '=', po.id]], fields: ['picking_ids'], limit: 0,
      });
      const pickingIds: number[] = poRec[0]?.picking_ids || [];
      if (pickingIds.length === 0) { showMsg(false, 'No receipt found for this PO.'); return; }

      const pickings = await searchRead<any>('stock.picking', {
        domain: [['id', 'in', pickingIds]],
        fields: ['id', 'name', 'state', 'picking_type_code'], limit: 0,
      });
      const toReceive = pickings.filter((p: any) =>
        p.picking_type_code === 'incoming' && ['assigned', 'confirmed', 'draft', 'waiting'].includes(p.state));

      if (toReceive.length === 0) { showMsg(false, 'Nothing left to receive.'); await syncData(); return; }

      for (const pick of toReceive) {
        try { await odooCall('stock.picking', 'action_assign', [[pick.id]], {}); } catch { /* ignore */ }
        const moves = await searchRead<any>('stock.move', {
          domain: [['picking_id', '=', pick.id]], fields: ['id', 'product_uom_qty'], limit: 0,
        });
        for (const mv of moves) {
          await odooCall('stock.move', 'write', [[mv.id], { quantity: mv.product_uom_qty, picked: true }], {});
        }
        const res: any = await odooCall('stock.picking', 'button_validate', [[pick.id]], {});
        if (res && typeof res === 'object' && res.res_model === 'stock.backorder.confirmation') {
          const wid = await createRecord('stock.backorder.confirmation', { pick_ids: [[6, 0, [pick.id]]] });
          await odooCall('stock.backorder.confirmation', 'process', [[wid]], {});
        }
      }
      showMsg(true, 'Products received -- stock updated and agent ledger entry created.');
      await syncData();
      if (detailItem?.id === po.id) closeDetail();
    } catch (e: any) { showMsg(false, 'Receive failed: ' + e.message); }
    finally { setBusyId(null); }
  };

  const handleCreateBill = async (po: PurchaseOrder) => {
    setBusyId(po.id);
    try {
      await odooCall('purchase.order', 'action_create_invoice', [[po.id]], {});
      showMsg(true, 'Vendor bill created -- see Accounting > Bills to post it.');
      await syncData();
    } catch (e: any) { showMsg(false, 'Create bill failed: ' + e.message); }
    finally { setBusyId(null); }
  };

  const handleCancel = async (po: PurchaseOrder) => {
    setBusyId(po.id);
    try {
      await odooCall('purchase.order', 'button_cancel', [[po.id]], {});
      showMsg(true, po.name + ' cancelled.');
      await syncData();
      if (detailItem?.id === po.id) closeDetail();
    } catch (e: any) { showMsg(false, 'Cancel failed: ' + e.message); }
    finally { setBusyId(null); }
  };

  const handleResetDraft = async (po: PurchaseOrder) => {
    setBusyId(po.id);
    try {
      await odooCall('purchase.order', 'button_draft', [[po.id]], {});
      showMsg(true, po.name + ' reset to RFQ.');
      await syncData();
    } catch (e: any) { showMsg(false, 'Reset failed: ' + e.message); }
    finally { setBusyId(null); }
  };

  // ---- Create ----

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.partner_id || lines.every(l => !l.product_id)) {
      showMsg(false, 'Vendor and at least one product are required.');
      return;
    }
    setSubmitting(true);

    if (editMode) {
      try {
        const usedLines = lines.filter(l => l.product_id);
        const orderLines: any[] = [[5, 0, 0], ...usedLines.map(l => [0, 0, { product_id: l.product_id, product_qty: l.product_qty, price_unit: l.price_unit }])];
        const vals: Record<string, any> = {
          partner_id: form.partner_id, date_order: form.date_order + ' 00:00:00',
          exchange_rate: form.exchange_rate, deposit_paid: form.deposit_paid,
          shipping_cost: form.shipping_cost, order_line: orderLines,
        };
        if (form.carrying_agent_id) vals.carrying_agent_id = form.carrying_agent_id;
        if (form.currency_id) vals.currency_id = form.currency_id;
        await writeRecord('purchase.order', [editMode.id], vals);
        showMsg(true, `${editMode.name} updated.`);
        setCreateModal(false); setEditMode(null); resetForm(); syncData();
      } catch (e: any) { showMsg(false, 'Update failed: ' + e.message); }
      finally { setSubmitting(false); }
      return;
    }

    try {
      const orderLines = lines
        .filter(l => l.product_id)
        .map(l => [0, 0, {
          product_id: l.product_id,
          product_qty: l.product_qty,
          price_unit: l.price_unit,
        }]);

      const vals: Record<string, any> = {
        partner_id: form.partner_id,
        date_order: form.date_order + ' 00:00:00',
        exchange_rate: form.exchange_rate,
        deposit_paid: form.deposit_paid,
        shipping_cost: form.shipping_cost,
        order_line: orderLines,
      };
      if (form.carrying_agent_id) vals.carrying_agent_id = form.carrying_agent_id;
      if (form.currency_id) vals.currency_id = form.currency_id;

      await createRecord('purchase.order', vals);
      showMsg(true, 'RFQ created as draft -- confirm it from the list to turn it into a PO.');
      setCreateModal(false);
      resetForm();
      syncData();
    } catch (e: any) { showMsg(false, 'Create failed: ' + e.message); }
    finally { setSubmitting(false); }
  };

  const resetForm = () => {
    const cny = currencies.find(c => c.name === 'CNY') || currencies[0];
    setForm({
      partner_id: '', partner_name: '', date_order: new Date().toISOString().slice(0, 10),
      carrying_agent_id: '', currency_id: cny?.id || '', exchange_rate: 15, deposit_paid: 0, shipping_cost: 0,
    });
    setLines([{ product_id: '', product_name: '', product_qty: 1, price_unit: 0 }]);
    setVendorSearch('');
    setProdSearches(['']);
    setProducts([]);
  };

  const updateLine = (idx: number, key: keyof OrderLine, val: any) => {
    setLines(prev => prev.map((l, i) => i === idx ? { ...l, [key]: val } : l));
  };

  const selectProduct = async (idx: number, prod: Product) => {
    updateLine(idx, 'product_id', prod.id);
    updateLine(idx, 'product_name', prod.name);
    setProdSearches(prev => prev.map((s, i) => i === idx ? prod.name : s));
    setProducts([]);
    setActiveProdLine(null);
    setDropPos(null);
    const lastPrice = await lookupLastPurchasePrice(prod.id, form.partner_id);
    if (lastPrice !== null) {
      updateLine(idx, 'price_unit', lastPrice);
    } else {
      const er = form.exchange_rate || 15;
      updateLine(idx, 'price_unit', prod.standard_price > 0 ? parseFloat((prod.standard_price / er).toFixed(2)) : 0);
    }
  };

  const addLine = () => {
    setLines(prev => [...prev, { product_id: '', product_name: '', product_qty: 1, price_unit: 0 }]);
    setProdSearches(prev => [...prev, '']);
  };

  const removeLine = (idx: number) => {
    setLines(prev => prev.filter((_, i) => i !== idx));
    setProdSearches(prev => prev.filter((_, i) => i !== idx));
  };

  const lineTotal = lines.reduce((s, l) => s + l.product_qty * l.price_unit, 0);
  const orderTotal = lineTotal; // alias kept for submit logic
  const er = form.exchange_rate || 15;
  const inrTotal = (lineTotal + (form.shipping_cost || 0)) * er;
  const depositInr = (form.deposit_paid || 0) * er;
  const netDueInr = inrTotal - depositInr;
  const fmtInr = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2 });
  const fmtCurr = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2 });

  // ---- Detail ----

  const openDetail = async (po: PurchaseOrder) => {
    setDetailItem(po);
    setDetailLines([]);
    try {
      const ls = await searchRead<any>('purchase.order.line', {
        domain: [['order_id', '=', po.id]],
        fields: ['product_id', 'name', 'product_qty', 'price_unit', 'price_subtotal'], limit: 0,
      });
      setDetailLines(ls || []);
    } catch { /* ignore */ }
  };
  const closeDetail = () => { setDetailItem(null); setDetailLines([]); };

  // ---- Derived ----

  const filtered = items.filter(o => {
    const name = o.name || '';
    const vendor = Array.isArray(o.partner_id) ? o.partner_id[1] : '';
    const ms = !search || name.toLowerCase().includes(search.toLowerCase()) || vendor.toLowerCase().includes(search.toLowerCase());
    const mf = stateFilter === 'all' || o.state === stateFilter;
    const rs = o.receipt_status || 'pending';
    const md = receiptFilter === 'all' || rs === receiptFilter;
    return ms && mf && md;
  });

  const activeCount = items.filter(o => o.state === 'purchase').length;
  const receivedCount = items.filter(o => o.receipt_status === 'full').length;
  const pendingCount = items.filter(o => o.state === 'purchase' && o.receipt_status !== 'full').length;
  const totalLiability = items.reduce((s, o) => s + (o.net_agent_liability_inr || 0), 0);

  const fmt = (n: number) => (n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });
  const fmtL = (n: number) => n >= 100000 ? `${(n / 100000).toFixed(1)}L` : (n || 0).toLocaleString('en-IN');
  const m2o = (x: any) => Array.isArray(x) ? x[1] : '--';
  const currSymForCode = (x: any) => {
    const code = Array.isArray(x) ? x[1] : (typeof x === 'string' ? x : '');
    if (code === 'CNY' || code === 'RMB') return '¥';
    if (code === 'INR') return '₹';
    if (code === 'USD') return '$';
    if (code === 'EUR') return '€';
    return code || '¥';
  };
  const selectedCurrName = currencies.find(c => c.id === form.currency_id)?.name || 'CNY';
  const currSymbol = currSymForCode(selectedCurrName);

  const st = isDark ? 'text-[#5a6a8a]' : 'text-gray-500';
  const pt = isDark ? 'text-white' : 'text-gray-900';
  const inp = `input text-xs py-2 ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`;
  const modalBg = `w-full rounded-2xl shadow-2xl border ${isDark ? 'bg-[#161b2e] border-[#2a3250]' : 'bg-white border-gray-200'}`;
  const filteredVendors = vendors.filter(p => !vendorSearch || p.name.toLowerCase().includes(vendorSearch.toLowerCase())).slice(0, 10);
  // products used directly in fixed dropdown

  const receiptBadge = (rs: string | false) => {
    if (rs === 'full') return 'badge-green';
    if (rs === 'partial') return 'badge-gold';
    return 'badge-gray';
  };
  const receiptLabel = (rs: string | false) => {
    if (rs === 'full') return 'Received';
    if (rs === 'partial') return 'Partial';
    return 'Pending';
  };

  const ActionButtons = ({ po, inModal }: { po: PurchaseOrder; inModal?: boolean }) => {
    const busy = busyId === po.id;
    const cls = inModal ? 'btn-secondary text-xs px-3 py-2' : `p-1.5 rounded-lg ${isDark ? 'hover:bg-white/10' : 'hover:bg-gray-100'}`;
    return (
      <>
        {['draft', 'sent'].includes(po.state) && (
          <button disabled={busy} onClick={() => handleConfirm(po)} title="Confirm RFQ"
            className={inModal ? 'btn-primary text-xs px-3 py-2' : `${cls} text-violet-400`}>
            {busy ? <RefreshCw size={14} className="animate-spin" /> : <CheckCircle size={14} />}{inModal && ' Confirm'}
          </button>
        )}
        {po.state === 'purchase' && po.receipt_status !== 'full' && (
          <button disabled={busy} onClick={() => handleReceive(po)} title="Receive Products"
            className={inModal ? 'btn-primary text-xs px-3 py-2' : `${cls} text-green-400`}>
            {busy ? <RefreshCw size={14} className="animate-spin" /> : <Truck size={14} />}{inModal && ' Receive'}
          </button>
        )}
        {['purchase', 'done'].includes(po.state) && po.invoice_status === 'to invoice' && (
          <button disabled={busy} onClick={() => handleCreateBill(po)} title="Create Vendor Bill"
            className={inModal ? 'btn-secondary text-xs px-3 py-2' : `${cls} text-blue-400`}>
            {busy ? <RefreshCw size={14} className="animate-spin" /> : <FileText size={14} />}{inModal && ' Create Bill'}
          </button>
        )}
        {['draft', 'sent', 'purchase'].includes(po.state) && (
          <button disabled={busy} onClick={() => handleCancel(po)} title="Cancel"
            className={inModal ? 'btn-secondary text-xs px-3 py-2' : `${cls} text-red-400`}>
            {busy ? <RefreshCw size={14} className="animate-spin" /> : <Ban size={14} />}{inModal && ' Cancel'}
          </button>
        )}
        {po.state === 'cancel' && (
          <button disabled={busy} onClick={() => handleResetDraft(po)} title="Reset to RFQ"
            className={inModal ? 'btn-secondary text-xs px-3 py-2' : `${cls} text-amber-400`}>
            {busy ? <RefreshCw size={14} className="animate-spin" /> : <RotateCcw size={14} />}{inModal && ' Reset to RFQ'}
          </button>
        )}
      </>
    );
  };

  return (
    <div className="space-y-5 animate-fade-in">
      {toast && (
        <div className={`fixed top-5 right-5 z-50 px-4 py-3 rounded-xl shadow-xl text-sm font-medium flex items-center gap-2 max-w-md
          ${toast.ok ? 'bg-green-500/15 border border-green-500/30 text-green-400' : 'bg-red-500/15 border border-red-500/30 text-red-400'}`}>
          {toast.ok ? <CheckCircle size={14} /> : <X size={14} />} {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className={`text-xl font-black ${pt}`}>Purchase Orders</h1>
          <p className={`text-xs mt-0.5 ${st}`}>RFQs and POs -- confirm, receive stock, create vendor bills</p>
        </div>
        <div className="flex gap-2 self-start sm:self-auto">
          <button onClick={syncData} disabled={loading} className="btn-secondary text-xs px-3 py-2">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Sync
          </button>
          <button onClick={() => { resetForm(); setCreateModal(true); }} className="btn-primary text-xs px-3 py-2">
            <Plus size={13} /> New RFQ
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Active POs', val: activeCount, icon: Package, color: 'text-violet-400', bg: 'bg-violet-500/15' },
          { label: 'Received', val: receivedCount, icon: CheckCircle, color: 'text-green-400', bg: 'bg-green-500/15' },
          { label: 'Pending Receipt', val: pendingCount, icon: Clock, color: 'text-amber-400', bg: 'bg-amber-500/15' },
          { label: 'Agent Liability', val: `Rs.${fmtL(totalLiability)}`, icon: IndianRupee, color: 'text-blue-400', bg: 'bg-blue-500/15' },
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
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by PO # or vendor..."
            autoComplete="off" autoCorrect="off" spellCheck="false"
            className={`input w-full pl-9 text-xs py-2 ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`} />
        </div>
        <select value={stateFilter} onChange={e => setStateFilter(e.target.value)} className={`${inp} w-auto`}>
          <option value="all">All Status</option>
          <option value="draft">RFQ</option>
          <option value="sent">RFQ Sent</option>
          <option value="purchase">Confirmed</option>
          <option value="done">Locked</option>
          <option value="cancel">Cancelled</option>
        </select>
        <select value={receiptFilter} onChange={e => setReceiptFilter(e.target.value)} className={`${inp} w-auto`}>
          <option value="all">All Receipts</option>
          <option value="pending">Pending</option>
          <option value="partial">Partial</option>
          <option value="full">Received</option>
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
                  <th>PO #</th><th>Vendor</th><th>Agent</th><th>Date</th><th className="text-right">Amount</th>
                  <th className="text-center">Status</th><th className="text-center">Receipt</th><th className="text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={isAdmin ? 9 : 8} className={`text-center py-10 text-xs ${st}`}>No purchase orders match filters.</td></tr>
                ) : filtered.map(o => (
                  <tr key={o.id} className={selIds.has(o.id) ? (isDark ? 'bg-[#7367f0]/5' : 'bg-violet-50') : ''}>
                    {isAdmin && <td><input type="checkbox" className="rounded" checked={selIds.has(o.id)} onChange={() => setSelIds(prev => { const n = new Set(prev); n.has(o.id) ? n.delete(o.id) : n.add(o.id); return n; })} /></td>}
                    <td><span className="font-mono text-xs font-semibold text-[#7367f0]">{o.name}</span></td>
                    <td className={`font-medium ${pt}`}>{m2o(o.partner_id)}</td>
                    <td className={`text-xs ${st}`}>{m2o(o.carrying_agent_id)}</td>
                    <td className={`text-xs ${st}`}>{o.date_order ? String(o.date_order).split(' ')[0] : '--'}</td>
                    <td className={`text-right font-semibold ${pt}`}>{currSymForCode(o.currency_id)}{fmt(o.amount_total)}</td>
                    <td className="text-center">
                      <span className={STATE_BADGE[o.state] || 'badge-gray'}>{STATE_LABEL[o.state] || o.state}</span>
                    </td>
                    <td className="text-center">
                      <span className={receiptBadge(o.receipt_status)}>{receiptLabel(o.receipt_status)}</span>
                    </td>
                    <td className="text-center">
                      <div className="flex gap-1 justify-center items-center">
                        <button onClick={() => openDetail(o)} title="View Details"
                          className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-white/5 text-[#5a6a8a] hover:text-white' : 'hover:bg-gray-100 text-gray-400 hover:text-gray-700'}`}>
                          <Eye size={13} />
                        </button>
                        <button onClick={() => downloadOdooReport(['draft', 'sent'].includes(o.state) ? REPORTS.rfq : REPORTS.purchaseOrder, o.id, (o.name || 'purchase-order').replace(/[\\/]/g, '-')).catch(e => alert(e.message))} title="Download PDF" className="p-1.5 rounded-lg text-[#7367f0] hover:bg-[#7367f0]/10">
                          <FileDown size={13} />
                        </button>
                        {['draft', 'sent'].includes(o.state) && (
                          <button onClick={() => openEdit(o)} title="Edit" className="p-1.5 rounded-lg text-amber-400 hover:bg-amber-500/10">
                            <Edit2 size={13} />
                          </button>
                        )}
                        <ActionButtons po={o} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Fixed product search dropdown */}
      {activeProdLine !== null && dropPos && products.length > 0 && !lines[activeProdLine]?.product_id && (
        <div
          className={`fixed z-[9999] rounded-xl border shadow-2xl overflow-y-auto ${isDark ? 'bg-[#1e2440] border-[#2a3250]' : 'bg-white border-gray-200'}`}
          style={{ top: dropPos.top, left: dropPos.left, width: dropPos.width, maxHeight: 240 }}
          onMouseDown={e => e.preventDefault()}
        >
          {products.map(p => (
            <button key={p.id} type="button"
              className={`w-full text-left px-3 py-2 text-sm hover:bg-[#7367f0]/10 ${isDark ? 'text-white' : 'text-gray-800'}`}
              onClick={() => selectProduct(activeProdLine!, p)}>
              <span className="font-semibold">{p.name}</span>
              {p.default_code && <span className={`ml-1 text-xs ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>[{p.default_code}]</span>}
            </button>
          ))}
        </div>
      )}

      <BulkDeleteBar model="purchase.order" label="order" ids={Array.from(selIds)}
        onClear={() => setSelIds(new Set())} onDeleted={() => { setSelIds(new Set()); syncData(); }} />

      {/* Detail Modal */}
      {detailItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={closeDetail}>
          <div className={`${modalBg} max-w-2xl max-h-[90vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
            <div className={`flex justify-between items-center px-5 py-4 border-b sticky top-0 z-10 ${isDark ? 'bg-[#161b2e] border-[#2a3250]' : 'bg-white border-gray-100'}`}>
              <div>
                <h3 className={`font-bold ${pt}`}>{detailItem.name}</h3>
                <p className={`text-xs ${st}`}>{m2o(detailItem.partner_id)}</p>
              </div>
              <div className="flex items-center gap-2">
                {['draft', 'sent'].includes(detailItem.state) && (
                  <button onClick={() => openEdit(detailItem)} disabled={submitting}
                    className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1">
                    <Edit2 size={12} /> Edit
                  </button>
                )}
                <button onClick={closeDetail} className={`p-1.5 rounded-lg ${isDark ? 'text-[#5a6a8a] hover:bg-white/5' : 'text-gray-400 hover:bg-gray-100'}`}><X size={16} /></button>
              </div>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                {[
                  { label: 'Date', val: String(detailItem.date_order).split(' ')[0] },
                  { label: 'Agent', val: m2o(detailItem.carrying_agent_id) },
                  { label: 'Status', val: STATE_LABEL[detailItem.state] || detailItem.state },
                  { label: 'Receipt', val: receiptLabel(detailItem.receipt_status) },
                  { label: 'Invoicing', val: detailItem.invoice_status },
                  { label: 'Amount', val: `${currSymForCode(detailItem.currency_id)}${fmt(detailItem.amount_total)}` },
                  { label: 'Total INR', val: `₹${fmt(detailItem.total_inr)}` },
                  { label: 'Net Agent Liability', val: `₹${fmt(detailItem.net_agent_liability_inr)}` },
                ].map(f => (
                  <div key={f.label} className={`p-3 rounded-xl border ${isDark ? 'bg-[#12172a] border-[#2a3250]' : 'bg-gray-50 border-gray-100'}`}>
                    <p className={`${st} font-semibold uppercase tracking-wider text-[10px]`}>{f.label}</p>
                    <p className={`font-bold mt-0.5 ${pt}`}>{f.val}</p>
                  </div>
                ))}
              </div>

              {/* Lines */}
              <div className={`rounded-xl border overflow-x-auto ${isDark ? 'border-[#2a3250]' : 'border-gray-200'}`}>
                <table className="w-full min-w-[480px]">
                  <thead>
                    <tr className={`text-xs font-bold uppercase tracking-wider ${isDark ? 'bg-[#1e2440] text-[#5a6a8a]' : 'bg-gray-50 text-gray-500'}`}>
                      <th className="px-3 py-3 text-left">Product</th>
                      <th className="px-3 py-3 text-right w-20">Qty</th>
                      <th className="px-3 py-3 text-right w-28">Unit Price</th>
                      <th className="px-3 py-3 text-right w-28">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${isDark ? 'divide-[#2a3250]' : 'divide-gray-100'}`}>
                    {detailLines.length === 0 ? (
                      <tr><td colSpan={4} className={`text-center py-4 text-sm ${st}`}>No lines.</td></tr>
                    ) : detailLines.map((l, i) => (
                      <tr key={i}>
                        <td className={`px-3 py-2.5 text-sm ${pt}`}>{m2o(l.product_id)}</td>
                        <td className={`px-3 py-2.5 text-right text-sm ${st}`}>{l.product_qty}</td>
                        <td className={`px-3 py-2.5 text-right text-sm ${st}`}>{fmt(l.price_unit)}</td>
                        <td className={`px-3 py-2.5 text-right text-sm font-semibold ${pt}`}>{fmt(l.price_subtotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap gap-2">
                <ActionButtons po={detailItem} inModal />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create RFQ Modal */}
      {createModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in" onClick={() => setCreateModal(false)}>
          <div className={`${modalBg} max-w-4xl w-full max-h-[90vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
            <div className={`flex justify-between items-center px-5 py-4 border-b sticky top-0 z-10 ${isDark ? 'bg-[#161b2e] border-[#2a3250]' : 'bg-white border-gray-100'}`}>
              <div>
                <h3 className={`font-bold ${pt}`}>{editMode ? `Edit ${editMode.name}` : 'New RFQ'}</h3>
                <p className={`text-xs ${st}`}>{editMode ? 'Update order header and lines' : 'Creates a draft request for quotation'}</p>
              </div>
              <button onClick={() => { setCreateModal(false); setEditMode(null); resetForm(); }} className={`p-1.5 rounded-lg ${isDark ? 'text-[#5a6a8a] hover:bg-white/5' : 'text-gray-400 hover:bg-gray-100'}`}><X size={16} /></button>
            </div>
            <form onSubmit={handleCreate} className="p-5 space-y-4">
              {/* Vendor */}
              <div ref={vendorRef} className="relative">
                <label className={`text-[10px] font-semibold block mb-1 ${st}`}>Vendor *</label>
                <input
                  value={vendorSearch}
                  onChange={e => { setVendorSearch(e.target.value); setShowVendorDrop(true); setForm(f => ({ ...f, partner_id: '', partner_name: '' })); }}
                  onFocus={() => setShowVendorDrop(true)}
                  placeholder="Search vendor..."
                  className={`${inp} w-full`}
                  required={!form.partner_id}
                />
                {form.partner_id && (
                  <div className="mt-1 text-xs font-semibold text-[#7367f0]">-- {form.partner_name}</div>
                )}
                {showVendorDrop && filteredVendors.length > 0 && !form.partner_id && (
                  <div className={`absolute z-20 w-full rounded-xl border shadow-xl mt-1 max-h-40 overflow-y-auto ${isDark ? 'bg-[#1e2440] border-[#2a3250]' : 'bg-white border-gray-200'}`}>
                    {filteredVendors.map(p => (
                      <button key={p.id} type="button"
                        className={`w-full text-left px-3 py-2 text-xs hover:bg-[#7367f0]/10 ${isDark ? 'text-white' : 'text-gray-800'}`}
                        onClick={() => { setForm(f => ({ ...f, partner_id: p.id, partner_name: p.name })); setVendorSearch(p.name); setShowVendorDrop(false); }}>
                        {p.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Date, Currency & Agent */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={`text-[10px] font-semibold block mb-1 ${st}`}>Order Date *</label>
                  <input type="date" value={form.date_order} onChange={e => setForm(f => ({ ...f, date_order: e.target.value }))} className={`${inp} w-full`} required />
                </div>
                <div>
                  <label className={`text-[10px] font-semibold block mb-1 ${st}`}>Currency</label>
                  <select value={form.currency_id} onChange={e => setForm(f => ({ ...f, currency_id: e.target.value ? Number(e.target.value) : '' }))} className={`${inp} w-full`}>
                    <option value="">-- Select --</option>
                    {currencies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className={`text-[10px] font-semibold block mb-1 ${st}`}>Carrying Agent</label>
                  <select value={form.carrying_agent_id} onChange={e => setForm(f => ({ ...f, carrying_agent_id: e.target.value ? Number(e.target.value) : '' }))} className={`${inp} w-full`}>
                    <option value="">-- None --</option>
                    {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
              </div>

              {/* Exchange / Deposit / Shipping */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={`text-[10px] font-semibold block mb-1 ${st}`}>Exchange Rate (INR)</label>
                  <input type="number" min="0" step="0.01" value={form.exchange_rate}
                    onChange={e => setForm(f => ({ ...f, exchange_rate: Number(e.target.value) }))} className={`${inp} w-full`} />
                </div>
                <div>
                  <label className={`text-[10px] font-semibold block mb-1 ${st}`}>Deposit Paid</label>
                  <input type="number" min="0" step="0.01" value={form.deposit_paid}
                    onChange={e => setForm(f => ({ ...f, deposit_paid: Number(e.target.value) }))} className={`${inp} w-full`} />
                </div>
                <div>
                  <label className={`text-[10px] font-semibold block mb-1 ${st}`}>Shipping Cost</label>
                  <input type="number" min="0" step="0.01" value={form.shipping_cost}
                    onChange={e => setForm(f => ({ ...f, shipping_cost: Number(e.target.value) }))} className={`${inp} w-full`} />
                </div>
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
                  <table className="w-full min-w-[560px]">
                    <thead>
                      <tr className={`text-xs font-bold uppercase tracking-wider ${isDark ? 'bg-[#1e2440] text-[#5a6a8a]' : 'bg-gray-50 text-gray-500'}`}>
                        <th className="px-3 py-3 text-left">Product</th>
                        <th className="px-3 py-3 text-right w-24">Qty</th>
                        <th className="px-3 py-3 text-right w-32">Unit Price ({currSymbol})</th>
                        <th className="px-3 py-3 text-right w-32">Subtotal ({currSymbol})</th>
                        <th className="px-3 py-3 w-10"></th>
                      </tr>
                    </thead>
                    <tbody className={`divide-y ${isDark ? 'divide-[#2a3250]' : 'divide-gray-100'}`}>
                      {lines.map((line, idx) => (
                        <tr key={idx}>
                          <td className="px-3 py-2 min-w-[200px]">
                            <input
                              value={prodSearches[idx] || ''}
                              onChange={e => {
                                const v = e.target.value;
                                const r = e.target.getBoundingClientRect();
                                setDropPos({ top: r.bottom + 4, left: r.left, width: r.width });
                                setActiveProdLine(idx);
                                setProdSearches(prev => prev.map((s, i) => i === idx ? v : s));
                                updateLine(idx, 'product_id', '');
                                updateLine(idx, 'product_name', '');
                                searchProducts(v);
                              }}
                              onFocus={e => { const r = e.target.getBoundingClientRect(); setDropPos({ top: r.bottom + 4, left: r.left, width: r.width }); setActiveProdLine(idx); }}
                              onBlur={() => setTimeout(() => { setActiveProdLine(null); setDropPos(null); setProducts([]); }, 150)}
                              placeholder="Search product..."
                              className={`input text-sm py-3 w-full ${isDark ? 'bg-[#12172a] border-[#2a3250] text-white' : ''}`}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input type="number" min="1" step="1" value={line.product_qty}
                              onChange={e => updateLine(idx, 'product_qty', Number(e.target.value))}
                              className={`input text-sm py-3 text-right w-full ${isDark ? 'bg-[#12172a] border-[#2a3250] text-white' : ''}`} />
                          </td>
                          <td className="px-3 py-2">
                            <input type="number" min="0" step="0.01" value={line.price_unit}
                              onChange={e => updateLine(idx, 'price_unit', Number(e.target.value))}
                              className={`input text-sm py-3 text-right w-full ${isDark ? 'bg-[#12172a] border-[#2a3250] text-white' : ''}`} />
                          </td>
                          <td className={`px-3 py-2 text-right text-sm font-semibold ${pt}`}>
                            {currSymbol}{(line.product_qty * line.price_unit).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                          </td>
                          <td className="px-3 py-2 text-center">
                            {lines.length > 1 && (
                              <button type="button" onClick={() => removeLine(idx)} className="text-red-400 hover:text-red-300">
                                <Trash2 size={14} />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className={`${isDark ? 'border-t border-[#2a3250]' : 'border-t border-gray-200'}`}>
                        <td colSpan={3} className={`px-3 py-3 text-sm font-bold text-right ${st}`}>Total ({currSymbol}):</td>
                        <td className="px-3 py-3 text-right text-base font-black text-[#7367f0]">
                          {currSymbol}{fmtCurr(lineTotal)}
                        </td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* Agent Financials (INR) */}
                <div className={`mt-3 p-4 rounded-xl border ${isDark ? 'bg-[#12172a] border-[#2a3250]' : 'bg-gray-50 border-gray-200'}`}>
                  <p className={`text-[10px] font-bold uppercase tracking-wider mb-3 ${isDark ? 'text-[#7367f0]' : 'text-violet-600'}`}>Agent Financials (INR)</p>
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <span className={st}>Total {currSymbol}{fmtCurr(lineTotal)} + Shipping {currSymbol}{fmtCurr(form.shipping_cost || 0)} × {er}</span>
                      <span className={`font-semibold ${pt}`}>₹{fmtInr(inrTotal)}</span>
                    </div>
                    {(form.deposit_paid || 0) > 0 && (
                      <div className="flex justify-between text-xs">
                        <span className={st}>Less Deposit ({currSymbol}{fmtCurr(form.deposit_paid || 0)} × {er})</span>
                        <span className="font-semibold text-red-400">- ₹{fmtInr(depositInr)}</span>
                      </div>
                    )}
                    <div className={`flex justify-between text-sm font-black pt-2 border-t ${isDark ? 'border-[#2a3250]' : 'border-gray-200'}`}>
                      <span className={pt}>Net Due to Agent (INR)</span>
                      <span className="text-[#7367f0]">₹{fmtInr(netDueInr)}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className={`p-3 rounded-xl text-xs border ${isDark ? 'bg-amber-500/5 border-amber-500/20 text-amber-300' : 'bg-amber-50 border-amber-200 text-amber-700'}`}>
                <strong>Note:</strong> This creates a draft RFQ. Confirm it from the list to turn it into a Purchase Order, then receive products to update stock and the carrying-agent ledger.
              </div>

              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => { setCreateModal(false); setEditMode(null); resetForm(); }} className="btn-secondary flex-1 justify-center py-2.5">Cancel</button>
                <button type="submit" disabled={submitting || !form.partner_id} className="btn-primary flex-1 justify-center py-2.5">
                  {submitting ? <RefreshCw size={14} className="animate-spin" /> : editMode ? <Edit2 size={14} /> : <Plus size={14} />}
                  {submitting ? (editMode ? 'Saving...' : 'Creating...') : editMode ? 'Save Changes' : 'Create RFQ'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
