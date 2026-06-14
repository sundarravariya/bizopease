import { useState, useEffect } from 'react';
import { useTheme } from '../../../context/ThemeContext';
import { useAuth } from '../../../context/AuthContext';
import { searchRead, createRecord, writeRecord, odooCall } from '../../../services/odoo';
import BulkDeleteBar from '../../ui/BulkDeleteBar';
import { fuzzyOdooDomain, sortByFuzzy } from '../../../utils/fuzzySearch';
import { downloadOdooReport, REPORTS } from '../../../utils/odooReports';
import {
  Plus, Search, RefreshCw, X, Eye, Send, ShoppingCart, FileText, FileDown,
  CheckCircle, AlertTriangle, Trash2, BarChart2, Edit2
} from 'lucide-react';

interface PurchaseLine {
  product_id: number | '';
  product_name: string;
  quantity: number;
  price_unit: number;
  name: string;
}

interface RfqRecord {
  id: number;
  name: string;
  partner_id: [number, string] | false;
  date_order: string;
  date_planned: string;
  amount_total: number;
  amount_untaxed: number;
  state: string;
  currency_id: [number, string] | false;
  carrying_agent_id: [number, string] | false;
  exchange_rate: number;
  deposit_paid: number;
  shipping_cost: number;
  total_inr: number;
  deposit_inr: number;
  net_agent_liability_inr: number;
  notes: string;
  partner_ref: string;
  l10n_in_gst_treatment: string | false;
  picking_type_id: [number, string] | false;
}

interface Partner { id: number; name: string; }
interface Product { id: number; name: string; standard_price: number; default_code?: string; }
interface Agent { id: number; name: string; }
interface PickingType { id: number; name: string; warehouse_name: string; }
interface Currency { id: number; name: string; }
interface CompareLine {
  id: number;
  product_id: [number, string] | false;
  partner_id: [number, string] | false;
  price_unit: number;
  product_qty: number;
  date_order: string;
}

// Standard Odoo l10n_in GST treatment options.
const GST_TREATMENTS: { value: string; label: string }[] = [
  { value: 'regular', label: 'Registered Business - Regular' },
  { value: 'composition', label: 'Registered Business - Composition' },
  { value: 'unregistered', label: 'Unregistered Business' },
  { value: 'consumer', label: 'Consumer' },
  { value: 'overseas', label: 'Overseas' },
  { value: 'special_economic_zone', label: 'Special Economic Zone' },
  { value: 'deemed_export', label: 'Deemed Export' },
  { value: 'uin_holders', label: 'UIN Holders' },
];

const STATE_BADGE: Record<string, string> = {
  draft: 'badge-gray', sent: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
  purchase: 'badge-green', done: 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20',
  cancel: 'bg-red-500/10 text-red-400 border border-red-500/20',
};
const STATE_LABEL: Record<string, string> = {
  draft: 'Draft', sent: 'Sent', purchase: 'Purchase Order', done: 'Done', cancel: 'Cancelled',
};

export default function Rfq() {
  const { isDark } = useTheme();
  const { user } = useAuth();
  const isAdmin = !!user?.is_admin;
  const [selIds, setSelIds] = useState<Set<number>>(new Set());
  const [rfqs, setRfqs] = useState<RfqRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState('rfq');
  const [detail, setDetail] = useState<RfqRecord | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editMode, setEditMode] = useState<{ id: number; name: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);

  // Compare Prices wizard
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareName, setCompareName] = useState('');
  const [compareLines, setCompareLines] = useState<CompareLine[]>([]);

  const [partners, setPartners] = useState<Partner[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [pickingTypes, setPickingTypes] = useState<PickingType[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [partnerSearch, setPartnerSearch] = useState('');
  const [showPartDrop, setShowPartDrop] = useState(false);
  const [activeProdLine, setActiveProdLine] = useState<number | null>(null);
  const [prodSearch, setProdSearch] = useState('');
  const [dropPos, setDropPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const [kitTmplIds, setKitTmplIds] = useState<number[]>([]);

  const today = new Date().toISOString().split('T')[0];

  const [form, setForm] = useState({
    partner_id: '' as number | '',
    partner_name: '',
    partner_ref: '',
    gst_treatment: '',
    currency_id: '' as number | '',
    picking_type_id: '' as number | '',
    date_order: today,
    date_planned: '',
    notes: '',
    exchange_rate: 15,
    deposit_paid: 0,
    shipping_cost: 0,
    carrying_agent_id: '' as number | '',
  });
  const [lines, setLines] = useState<PurchaseLine[]>([{ product_id: '', product_name: '', quantity: 1, price_unit: 0, name: '' }]);

  const showMsg = (ok: boolean, msg: string) => { setToast({ ok, msg }); setTimeout(() => setToast(null), 5000); };

  const syncData = async () => {
    setLoading(true);
    try {
      const domain = stateFilter === 'rfq' ? [['state', 'in', ['draft', 'sent']]] : [['state', 'in', ['purchase', 'done']]];
      const r = await searchRead<RfqRecord>('purchase.order', {
        domain,
        fields: ['id', 'name', 'partner_id', 'date_order', 'date_planned', 'amount_total', 'amount_untaxed',
          'state', 'currency_id', 'carrying_agent_id', 'exchange_rate', 'deposit_paid',
          'shipping_cost', 'total_inr', 'deposit_inr', 'net_agent_liability_inr', 'notes',
          'partner_ref', 'l10n_in_gst_treatment', 'picking_type_id'],
        limit: 0, order: 'id desc',
      });
      setRfqs(Array.isArray(r) ? r : []);
    } catch (e: any) { showMsg(false, 'Sync failed: ' + e.message); }
    finally { setLoading(false); }
  };

  const loadRefs = async () => {
    const [ps, as_, pts, curs] = await Promise.allSettled([
      searchRead<Partner>('res.partner', { fields: ['id', 'name'], domain: [['active', '=', true], ['supplier_rank', '>', 0]], limit: 0 }),
      searchRead<Agent>('flipkart.carrying.agent', { fields: ['id', 'name'], domain: [], limit: 0 }),
      searchRead<any>('stock.picking.type', { fields: ['id', 'name', 'warehouse_id'], domain: [['code', '=', 'incoming']], limit: 0 }),
      searchRead<Currency>('res.currency', { fields: ['id', 'name'], domain: [['active', '=', true]], limit: 0 }),
    ]);
    if (ps.status === 'fulfilled') setPartners(ps.value || []);
    if (as_.status === 'fulfilled') setAgents(as_.value || []);
    if (pts.status === 'fulfilled' && Array.isArray(pts.value)) {
      setPickingTypes(pts.value.map((p: any) => ({
        id: p.id, name: p.name,
        warehouse_name: Array.isArray(p.warehouse_id) ? p.warehouse_id[1] : '',
      })));
    }
    if (curs.status === 'fulfilled' && Array.isArray(curs.value)) {
      setCurrencies(curs.value);
      const cny = curs.value.find((c: Currency) => c.name === 'CNY') || curs.value.find((c: Currency) => c.name === 'INR');
      if (cny) setForm(f => ({ ...f, currency_id: f.currency_id || cny.id }));
    }
    // Load kit BOM template IDs to exclude from product search
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
    const prodDomain: any[] = [['purchase_ok', '=', true], '|', ...nameDomain, ['default_code', 'ilike', q]];
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

  const openEdit = async (r: RfqRecord) => {
    setSubmitting(true);
    try {
      const [full, poLines] = await Promise.all([
        searchRead<any>('purchase.order', {
          domain: [['id', '=', r.id]],
          fields: ['partner_id', 'date_order', 'date_planned', 'currency_id', 'picking_type_id',
            'carrying_agent_id', 'exchange_rate', 'deposit_paid', 'shipping_cost',
            'partner_ref', 'l10n_in_gst_treatment', 'notes'],
          limit: 1,
        }),
        searchRead<any>('purchase.order.line', {
          domain: [['order_id', '=', r.id]],
          fields: ['product_id', 'product_qty', 'price_unit', 'name'],
          limit: 0,
        }),
      ]);
      const o = full[0];
      const pId = Array.isArray(o.partner_id) ? o.partner_id[0] : o.partner_id;
      const pName = Array.isArray(o.partner_id) ? o.partner_id[1] : '';
      setForm({
        partner_id: pId, partner_name: pName,
        partner_ref: o.partner_ref || '',
        gst_treatment: o.l10n_in_gst_treatment || '',
        currency_id: Array.isArray(o.currency_id) ? o.currency_id[0] : '',
        picking_type_id: Array.isArray(o.picking_type_id) ? o.picking_type_id[0] : '',
        date_order: String(o.date_order || '').split(' ')[0] || new Date().toISOString().slice(0, 10),
        date_planned: String(o.date_planned || '').split(' ')[0] || '',
        notes: o.notes || '',
        exchange_rate: o.exchange_rate || 15,
        deposit_paid: o.deposit_paid || 0,
        shipping_cost: o.shipping_cost || 0,
        carrying_agent_id: Array.isArray(o.carrying_agent_id) ? o.carrying_agent_id[0] : '',
      });
      setPartnerSearch(pName);
      const el = (poLines || []).map((l: any) => ({
        product_id: Array.isArray(l.product_id) ? l.product_id[0] : l.product_id,
        product_name: Array.isArray(l.product_id) ? l.product_id[1] : '',
        quantity: l.product_qty || 1,
        price_unit: l.price_unit || 0,
        name: l.name || '',
      }));
      setLines(el.length > 0 ? el : [{ product_id: '', product_name: '', quantity: 1, price_unit: 0, name: '' }]);
      setEditMode({ id: r.id, name: r.name });
      setDetail(null);
      setShowCreate(true);
    } catch (e: any) { showMsg(false, 'Could not load RFQ: ' + e.message); }
    finally { setSubmitting(false); }
  };

  useEffect(() => { syncData(); loadRefs(); }, [stateFilter]);

  const handleCreate = async () => {
    if (!form.partner_id) { showMsg(false, 'Vendor is required.'); return; }
    const validLines = lines.filter(l => l.quantity > 0 && l.price_unit > 0);
    if (!validLines.length) { showMsg(false, 'Add at least one order line.'); return; }
    setSubmitting(true);

    const buildVals = (lineCmd: any[]): Record<string, any> => {
      const vals: Record<string, any> = {
        partner_id: form.partner_id, date_order: form.date_order, notes: form.notes,
        exchange_rate: form.exchange_rate, deposit_paid: form.deposit_paid,
        shipping_cost: form.shipping_cost, order_line: lineCmd,
      };
      if (form.carrying_agent_id) vals.carrying_agent_id = form.carrying_agent_id;
      if (form.partner_ref.trim()) vals.partner_ref = form.partner_ref.trim();
      if (form.gst_treatment) vals.l10n_in_gst_treatment = form.gst_treatment;
      if (form.currency_id) vals.currency_id = form.currency_id;
      if (form.picking_type_id) vals.picking_type_id = form.picking_type_id;
      return vals;
    };

    if (editMode) {
      try {
        const lineCmd: any[] = [[5, 0, 0], ...validLines.map(l => [0, 0, {
          ...(l.product_id ? { product_id: l.product_id } : {}),
          name: l.name || l.product_name || 'Purchase Item',
          product_qty: l.quantity, price_unit: l.price_unit,
          ...(form.date_planned ? { date_planned: form.date_planned } : {}),
        }])];
        await writeRecord('purchase.order', [editMode.id], buildVals(lineCmd));
        showMsg(true, `${editMode.name} updated.`);
        setShowCreate(false); setEditMode(null); resetForm(); syncData();
      } catch (e: any) { showMsg(false, 'Update failed: ' + e.message); }
      finally { setSubmitting(false); }
      return;
    }

    try {
      const orderLines = validLines.map(l => [0, 0, {
        ...(l.product_id ? { product_id: l.product_id } : {}),
        name: l.name || l.product_name || 'Purchase Item',
        product_qty: l.quantity,
        price_unit: l.price_unit,
        ...(form.date_planned ? { date_planned: form.date_planned } : {}),
      }]);
      await createRecord('purchase.order', buildVals(orderLines));
      showMsg(true, 'RFQ created successfully.');
      setShowCreate(false); resetForm(); syncData();
    } catch (e: any) { showMsg(false, 'Create failed: ' + e.message); }
    finally { setSubmitting(false); }
  };

  const handleConfirm = async (id: number) => {
    try {
      await odooCall('purchase.order', 'button_confirm', [[id]], {});
      showMsg(true, 'Order confirmed.');
      syncData();
    } catch (e: any) { showMsg(false, 'Confirm failed: ' + e.message); }
  };

  const handleSend = async (id: number) => {
    try {
      await odooCall('purchase.order', 'action_rfq_send', [[id]], {});
      showMsg(true, 'RFQ sent to vendor.');
      syncData();
    } catch (e: any) { showMsg(false, 'Send failed: ' + e.message); }
  };

  // Replicates flipkart_os action_compare_prices: historical purchase prices
  // for the same products across confirmed/done POs, so the buyer can compare
  // vendors before deciding.
  const handleComparePrices = async (rfq: RfqRecord) => {
    setCompareName(rfq.name);
    setCompareOpen(true);
    setCompareLoading(true);
    setCompareLines([]);
    try {
      const ownLines = await searchRead<any>('purchase.order.line', {
        domain: [['order_id', '=', rfq.id]], fields: ['product_id'], limit: 0,
      });
      const productIds = Array.from(new Set(
        (Array.isArray(ownLines) ? ownLines : [])
          .map(l => Array.isArray(l.product_id) ? l.product_id[0] : null)
          .filter((x): x is number => !!x)
      ));
      if (productIds.length === 0) {
        showMsg(false, 'Please add products to the order first.');
        setCompareOpen(false);
        return;
      }
      const res = await searchRead<CompareLine>('purchase.order.line', {
        domain: [['product_id', 'in', productIds], ['state', 'in', ['purchase', 'done']]],
        fields: ['id', 'product_id', 'partner_id', 'price_unit', 'product_qty', 'date_order'],
        order: 'price_unit asc',
        limit: 0,
      });
      setCompareLines(Array.isArray(res) ? res : []);
    } catch (e: any) {
      showMsg(false, 'Compare failed: ' + e.message);
    } finally {
      setCompareLoading(false);
    }
  };

  const resetForm = () => {
    const cny = currencies.find(c => c.name === 'CNY') || currencies.find(c => c.name === 'INR');
    setForm({ partner_id: '', partner_name: '', partner_ref: '', gst_treatment: '', currency_id: cny?.id || '', picking_type_id: '', date_order: today, date_planned: '', notes: '', exchange_rate: 15, deposit_paid: 0, shipping_cost: 0, carrying_agent_id: '' });
    setLines([{ product_id: '', product_name: '', quantity: 1, price_unit: 0, name: '' }]);
    setPartnerSearch(''); setProducts([]);
  };

  const updateLine = (idx: number, key: keyof PurchaseLine, val: any) => setLines(p => p.map((l, i) => i === idx ? { ...l, [key]: val } : l));
  const lineTotal = lines.reduce((s, l) => s + l.quantity * l.price_unit, 0);

  const getCurrSymbol = (name: string) => {
    if (name === 'CNY' || name === 'RMB') return '¥';
    if (name === 'INR') return '₹';
    if (name === 'USD') return '$';
    if (name === 'EUR') return '€';
    return name || '¥';
  };

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

  const selectProductInLine = async (idx: number, p: Product) => {
    updateLine(idx, 'product_id', p.id);
    updateLine(idx, 'product_name', p.name);
    updateLine(idx, 'name', p.name);
    setActiveProdLine(null); setDropPos(null); setProducts([]);
    const lastPrice = await lookupLastPurchasePrice(p.id, form.partner_id);
    const currName = currencies.find(c => c.id === form.currency_id)?.name || 'CNY';
    if (lastPrice !== null) {
      updateLine(idx, 'price_unit', lastPrice);
    } else if (currName === 'CNY' || currName === 'RMB') {
      const er = form.exchange_rate || 15;
      updateLine(idx, 'price_unit', p.standard_price > 0 ? parseFloat((p.standard_price / er).toFixed(2)) : 0);
    } else {
      updateLine(idx, 'price_unit', p.standard_price || 0);
    }
  };
  const filteredPartners = partners.filter(p => !partnerSearch || p.name.toLowerCase().includes(partnerSearch.toLowerCase())).slice(0, 10);
  const filtered = rfqs.filter(r => {
    const name = typeof r.partner_id === 'object' && r.partner_id ? r.partner_id[1] : '';
    return !search || r.name.toLowerCase().includes(search.toLowerCase()) || name.toLowerCase().includes(search.toLowerCase());
  });

  const st = isDark ? 'text-[#5a6a8a]' : 'text-gray-500';
  const pt = isDark ? 'text-white' : 'text-gray-900';
  const inp = `input text-xs py-2 ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`;
  const modalBg = `w-full rounded-2xl shadow-2xl border ${isDark ? 'bg-[#161b2e] border-[#2a3250]' : 'bg-white border-gray-200'}`;
  const mh = `flex items-center justify-between p-5 border-b ${isDark ? 'border-[#2a3250]' : 'border-gray-200'}`;
  const mf = `flex justify-end gap-3 p-5 border-t ${isDark ? 'border-[#2a3250]' : 'border-gray-200'}`;

  const selectedCurrName = currencies.find(c => c.id === form.currency_id)?.name || 'CNY';
  const currSymbol = getCurrSymbol(selectedCurrName);
  const inrTotal = (lineTotal + (form.shipping_cost || 0)) * (form.exchange_rate || 15);
  const depositInr = (form.deposit_paid || 0) * (form.exchange_rate || 15);
  const netDueInr = inrTotal - depositInr;
  const fmtInr = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtCurr = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const draftCount = rfqs.filter(r => r.state === 'draft').length;
  const sentCount = rfqs.filter(r => r.state === 'sent').length;
  const totalVal = rfqs.reduce((s, r) => s + r.amount_total, 0);

  return (
    <div className="space-y-5 animate-fade-in">
      {toast && (
        <div className={`fixed top-5 right-5 z-50 px-4 py-3 rounded-xl shadow-xl text-sm font-medium flex items-center gap-2
          ${toast.ok ? 'bg-green-500/15 border border-green-500/30 text-green-400' : 'bg-red-500/15 border border-red-500/30 text-red-400'}`}>
          {toast.ok ? <CheckCircle size={14} /> : <X size={14} />} {toast.msg}
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className={`text-xl font-black ${pt}`}>Requests for Quotation</h1>
          <p className={`text-xs mt-0.5 ${st}`}>Send price requests to suppliers and confirm purchase orders</p>
        </div>
        <div className="flex gap-2">
          <button onClick={syncData} disabled={loading} className="btn-secondary text-xs px-3 py-2">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Sync
          </button>
          <button onClick={() => { resetForm(); setShowCreate(true); }} className="btn-primary text-xs px-3 py-2">
            <Plus size={13} /> Create RFQ
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total RFQs', value: rfqs.length.toString(), icon: FileText, color: 'text-[#7367f0]', bg: 'bg-[#7367f0]/10' },
          { label: 'Draft', value: draftCount.toString(), icon: AlertTriangle, color: 'text-amber-400', bg: 'bg-amber-500/10' },
          { label: 'Sent', value: sentCount.toString(), icon: Send, color: 'text-blue-400', bg: 'bg-blue-500/10' },
          { label: 'Total Value', value: `Rs.${(totalVal / 100000).toFixed(1)}L`, icon: BarChart2, color: 'text-green-400', bg: 'bg-green-500/10' },
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

      <div className="card p-3 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={14} className={`absolute left-3 top-1/2 -translate-y-1/2 ${st}`} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search RFQ# or vendor..."
            className={`input pl-9 text-xs py-2 w-full ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`} />
        </div>
        <select value={stateFilter} onChange={e => setStateFilter(e.target.value)} className={`${inp} w-full sm:w-40`}>
          <option value="rfq">RFQs (Draft/Sent)</option>
          <option value="po">Purchase Orders</option>
        </select>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-40"><RefreshCw size={18} className="animate-spin text-[#7367f0]" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table w-full">
              <thead>
                <tr>
                  {isAdmin && <th className="w-8"><input type="checkbox" className="rounded" checked={filtered.length > 0 && filtered.every(r => selIds.has(r.id))} onChange={e => setSelIds(e.target.checked ? new Set(filtered.map(r => r.id)) : new Set())} /></th>}
                  <th>RFQ / PO #</th><th>Vendor</th><th>Date</th>
                  {stateFilter === 'po' && <th>Agent</th>}
                  <th className="text-right">Total</th>
                  {stateFilter === 'po' && <th className="text-right">Total INR</th>}
                  <th className="text-center">Status</th>
                  <th className="text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.id} className={selIds.has(r.id) ? (isDark ? 'bg-[#7367f0]/5' : 'bg-violet-50') : ''}>
                    {isAdmin && <td><input type="checkbox" className="rounded" checked={selIds.has(r.id)} onChange={() => setSelIds(prev => { const n = new Set(prev); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n; })} /></td>}
                    <td className="font-mono text-xs font-semibold text-[#7367f0]">{r.name}</td>
                    <td className={`font-medium text-xs ${pt}`}>{Array.isArray(r.partner_id) ? r.partner_id[1] : '--'}</td>
                    <td className={`text-xs ${st}`}>{r.date_order?.split(' ')[0] || '--'}</td>
                    {stateFilter === 'po' && <td className={`text-xs ${st}`}>{Array.isArray(r.carrying_agent_id) ? r.carrying_agent_id[1] : '--'}</td>}
                    <td className={`text-right text-xs font-semibold ${pt}`}>{getCurrSymbol(Array.isArray(r.currency_id) ? r.currency_id[1] : 'CNY')}{r.amount_total.toLocaleString('en-IN')}</td>
                    {stateFilter === 'po' && <td className={`text-right text-xs font-semibold text-amber-400`}>₹{(r.total_inr || 0).toLocaleString('en-IN')}</td>}
                    <td className="text-center">
                      <span className={`badge ${STATE_BADGE[r.state] || 'badge-gray'}`}>{STATE_LABEL[r.state] || r.state}</span>
                    </td>
                    <td className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => setDetail(r)} className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-white/5 text-[#5a6a8a]' : 'hover:bg-gray-100 text-gray-400'}`} title="View"><Eye size={13} /></button>
                        <button onClick={() => downloadOdooReport(REPORTS.rfq, r.id, (r.name || 'rfq').replace(/[\\/]/g, '-')).catch(e => alert(e.message))} className="p-1.5 rounded-lg text-[#7367f0] hover:bg-[#7367f0]/10" title="Download PDF"><FileDown size={13} /></button>
                        {(r.state === 'draft' || r.state === 'sent') && (
                          <button onClick={() => openEdit(r)} className="p-1.5 rounded-lg text-amber-400 hover:bg-amber-500/10" title="Edit"><Edit2 size={13} /></button>
                        )}
                        {r.state === 'draft' && (
                          <button onClick={() => handleSend(r.id)} className="p-1.5 rounded-lg text-blue-400 hover:bg-blue-500/10" title="Send to Vendor"><Send size={13} /></button>
                        )}
                        {(r.state === 'draft' || r.state === 'sent') && (
                          <button onClick={() => handleConfirm(r.id)} className="px-2 py-1 rounded-lg text-xs font-bold text-[#7367f0] bg-[#7367f0]/10 hover:bg-[#7367f0]/20 flex items-center gap-1" title="Confirm Order">
                            <ShoppingCart size={11} /> Confirm
                          </button>
                        )}
                        <button onClick={() => handleComparePrices(r)} className="p-1.5 rounded-lg text-green-400 hover:bg-green-500/10" title="Compare Prices"><BarChart2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={(stateFilter === 'po' ? 8 : 6) + (isAdmin ? 1 : 0)} className="text-center py-10">
                    <FileText size={32} className={`mx-auto mb-2 ${isDark ? 'text-[#2a3250]' : 'text-gray-200'}`} />
                    <p className={`text-xs ${st}`}>No records found</p>
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className={`${modalBg} max-w-xl`}>
            <div className={mh}>
              <div>
                <h2 className={`text-base font-black ${pt}`}>{detail.name}</h2>
                <p className={`text-xs mt-0.5 ${st}`}>{Array.isArray(detail.partner_id) ? detail.partner_id[1] : '--'}</p>
              </div>
              <div className="flex items-center gap-2">
                {(detail.state === 'draft' || detail.state === 'sent') && (
                  <button onClick={() => openEdit(detail)} disabled={submitting}
                    className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1">
                    <Edit2 size={12} /> Edit
                  </button>
                )}
                <button onClick={() => setDetail(null)} className={`p-2 rounded-lg ${isDark ? 'hover:bg-white/5 text-[#5a6a8a]' : 'hover:bg-gray-100 text-gray-400'}`}><X size={16} /></button>
              </div>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
                {[
                  { label: 'Order Date', value: detail.date_order?.split(' ')[0] || '--' },
                  { label: 'Status', value: STATE_LABEL[detail.state] || detail.state },
                  { label: 'Total', value: `${getCurrSymbol(Array.isArray(detail.currency_id) ? detail.currency_id[1] : 'CNY')}${detail.amount_total.toLocaleString('en-IN')}` },
                  { label: 'Exchange Rate', value: detail.exchange_rate ? `${detail.exchange_rate} ₹/¥` : '--' },
                  { label: 'Deposit Paid', value: detail.deposit_paid ? `${getCurrSymbol(Array.isArray(detail.currency_id) ? detail.currency_id[1] : 'CNY')}${detail.deposit_paid.toLocaleString('en-IN')}` : '--' },
                  { label: 'Shipping Cost', value: detail.shipping_cost ? `${getCurrSymbol(Array.isArray(detail.currency_id) ? detail.currency_id[1] : 'CNY')}${detail.shipping_cost.toLocaleString('en-IN')}` : '--' },
                  { label: 'Carrying Agent', value: Array.isArray(detail.carrying_agent_id) ? detail.carrying_agent_id[1] : '--' },
                  { label: 'Vendor Reference', value: detail.partner_ref || '--' },
                  { label: 'GST Treatment', value: (GST_TREATMENTS.find(g => g.value === detail.l10n_in_gst_treatment)?.label) || '--' },
                  { label: 'Deliver To', value: Array.isArray(detail.picking_type_id) ? detail.picking_type_id[1] : '--' },
                  { label: 'Total INR', value: detail.total_inr ? `₹${detail.total_inr.toLocaleString('en-IN')}` : '--' },
                  { label: 'Net Liability INR', value: detail.net_agent_liability_inr ? `₹${detail.net_agent_liability_inr.toLocaleString('en-IN')}` : '--' },
                ].map(f => (
                  <div key={f.label}>
                    <p className={`text-[10px] font-semibold uppercase tracking-wider mb-0.5 ${st}`}>{f.label}</p>
                    <p className={`font-semibold ${pt}`}>{f.value}</p>
                  </div>
                ))}
              </div>
              {detail.notes && <p className={`text-xs ${st}`}>{detail.notes}</p>}
            </div>
            <div className={mf}>
              <button onClick={() => setDetail(null)} className="btn-secondary text-xs px-4 py-2">Close</button>
              {(detail.state === 'draft' || detail.state === 'sent') && (
                <button onClick={() => { handleConfirm(detail.id); setDetail(null); }} className="btn-primary text-xs px-4 py-2">
                  <ShoppingCart size={13} /> Confirm Order
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className={`${modalBg} max-w-4xl w-full max-h-[90vh] overflow-y-auto`}>
            <div className={`${mh} sticky top-0 z-10 ${isDark ? 'bg-[#161b2e]' : 'bg-white'}`}>
              <h2 className={`text-base font-black ${pt}`}>{editMode ? `Edit ${editMode.name}` : 'Create Request for Quotation'}</h2>
              <button onClick={() => { setShowCreate(false); setEditMode(null); resetForm(); }} className={`p-2 rounded-lg ${isDark ? 'hover:bg-white/5 text-[#5a6a8a]' : 'hover:bg-gray-100 text-gray-400'}`}><X size={16} /></button>
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

              {/* Vendor Reference + GST Treatment */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={`text-[10px] font-semibold block mb-1 ${st}`}>Vendor Reference</label>
                  <input type="text" value={form.partner_ref} onChange={e => setForm(f => ({ ...f, partner_ref: e.target.value }))}
                    placeholder="Vendor's order/invoice ref" className={`${inp} w-full`} />
                </div>
                <div>
                  <label className={`text-[10px] font-semibold block mb-1 ${st}`}>GST Treatment</label>
                  <select value={form.gst_treatment} onChange={e => setForm(f => ({ ...f, gst_treatment: e.target.value }))} className={`${inp} w-full`}>
                    <option value="">-- Default --</option>
                    {GST_TREATMENTS.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
                  </select>
                </div>
              </div>

              {/* Currency + Deliver To */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={`text-[10px] font-semibold block mb-1 ${st}`}>Currency</label>
                  <select value={form.currency_id} onChange={e => setForm(f => ({ ...f, currency_id: e.target.value ? Number(e.target.value) : '' }))} className={`${inp} w-full`}>
                    {currencies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className={`text-[10px] font-semibold block mb-1 ${st}`}>Deliver To</label>
                  <select value={form.picking_type_id} onChange={e => setForm(f => ({ ...f, picking_type_id: e.target.value ? Number(e.target.value) : '' }))} className={`${inp} w-full`}>
                    <option value="">-- Default Receipts --</option>
                    {pickingTypes.map(p => <option key={p.id} value={p.id}>{p.warehouse_name ? `${p.warehouse_name}: ${p.name}` : p.name}</option>)}
                  </select>
                </div>
              </div>

              {/* Order Deadline + Expected Arrival */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={`text-[10px] font-semibold block mb-1 ${st}`}>Order Deadline</label>
                  <input type="date" value={form.date_order} onChange={e => setForm(f => ({ ...f, date_order: e.target.value }))} className={`${inp} w-full`} />
                </div>
                <div>
                  <label className={`text-[10px] font-semibold block mb-1 ${st}`}>Expected Arrival</label>
                  <input type="date" value={form.date_planned} onChange={e => setForm(f => ({ ...f, date_planned: e.target.value }))} className={`${inp} w-full`} />
                </div>
              </div>

              {/* Flipkart OS Fields */}
              <div className={`p-3 rounded-xl border space-y-3 ${isDark ? 'border-[#7367f0]/30 bg-[#7367f0]/5' : 'border-violet-200 bg-violet-50'}`}>
                <p className="text-xs font-bold text-[#7367f0]">Flipkart OS -- Purchase Details</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={`text-[10px] font-semibold block mb-1 ${st}`}>Carrying Agent</label>
                    <select value={form.carrying_agent_id} onChange={e => setForm(f => ({ ...f, carrying_agent_id: e.target.value ? Number(e.target.value) : '' }))} className={`${inp} w-full`}>
                      <option value="">-- None --</option>
                      {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={`text-[10px] font-semibold block mb-1 ${st}`}>Exchange Rate</label>
                    <input type="number" min="1" step="0.01" value={form.exchange_rate} onChange={e => setForm(f => ({ ...f, exchange_rate: Number(e.target.value) }))} className={`${inp} w-full`} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={`text-[10px] font-semibold block mb-1 ${st}`}>Deposit Paid (RMB)</label>
                    <input type="number" min="0" step="0.01" value={form.deposit_paid} onChange={e => setForm(f => ({ ...f, deposit_paid: Number(e.target.value) }))} className={`${inp} w-full`} />
                  </div>
                  <div>
                    <label className={`text-[10px] font-semibold block mb-1 ${st}`}>Shipping Cost (RMB)</label>
                    <input type="number" min="0" step="0.01" value={form.shipping_cost} onChange={e => setForm(f => ({ ...f, shipping_cost: Number(e.target.value) }))} className={`${inp} w-full`} />
                  </div>
                </div>
              </div>

              {/* Order Lines */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className={`text-[10px] font-semibold ${st}`}>Order Lines *</label>
                  <button type="button" onClick={() => setLines(p => [...p, { product_id: '', product_name: '', quantity: 1, price_unit: 0, name: '' }])}
                    className="text-xs text-[#7367f0] font-semibold flex items-center gap-1 hover:underline"><Plus size={11} /> Add Line</button>
                </div>
                <div className={`rounded-xl border overflow-x-auto ${isDark ? 'border-[#2a3250]' : 'border-gray-200'}`}>
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
                    <tbody className={`divide-y ${isDark ? 'divide-[#2a3250]' : 'divide-gray-100'}`}>
                      {lines.map((line, idx) => (
                        <tr key={idx}>
                          <td className="px-3 py-2 min-w-[200px]">
                            <input value={activeProdLine === idx ? prodSearch : (line.product_name || line.name)}
                              onChange={e => {
                                const r = e.target.getBoundingClientRect();
                                setDropPos({ top: r.bottom + 4, left: r.left, width: r.width });
                                setProdSearch(e.target.value); setActiveProdLine(idx);
                                updateLine(idx, 'product_id', ''); updateLine(idx, 'product_name', '');
                                searchProducts(e.target.value);
                              }}
                              onFocus={e => { const r = e.target.getBoundingClientRect(); setDropPos({ top: r.bottom + 4, left: r.left, width: r.width }); setActiveProdLine(idx); }}
                              onBlur={() => setTimeout(() => { setActiveProdLine(null); setDropPos(null); setProducts([]); }, 150)}
                              placeholder="Search product..."
                              className={`input text-sm py-3 w-full ${isDark ? 'bg-[#12172a] border-[#2a3250] text-white' : ''}`} />
                          </td>
                          <td className="px-3 py-2">
                            <input type="number" min="1" value={line.quantity} onChange={e => updateLine(idx, 'quantity', Number(e.target.value))}
                              className={`input text-sm py-3 text-right w-full ${isDark ? 'bg-[#12172a] border-[#2a3250] text-white' : ''}`} />
                          </td>
                          <td className="px-3 py-2">
                            <input type="number" min="0" step="0.01" value={line.price_unit} onChange={e => updateLine(idx, 'price_unit', Number(e.target.value))}
                              className={`input text-sm py-3 text-right w-full ${isDark ? 'bg-[#12172a] border-[#2a3250] text-white' : ''}`} />
                          </td>
                          <td className={`px-3 py-2 text-right text-sm font-semibold ${pt}`}>{currSymbol}{(line.quantity * line.price_unit).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                          <td className="px-3 py-2 text-center">
                            {lines.length > 1 && <button type="button" onClick={() => setLines(p => p.filter((_, i) => i !== idx))} className="text-red-400 hover:text-red-300"><Trash2 size={14} /></button>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className={`${isDark ? 'border-t border-[#2a3250]' : 'border-t border-gray-200'}`}>
                        <td colSpan={3} className={`px-3 py-3 text-sm font-bold text-right ${st}`}>Total ({selectedCurrName}):</td>
                        <td className="px-3 py-3 text-right text-base font-black text-[#7367f0]">{currSymbol}{fmtCurr(lineTotal)}</td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* Agent Financials (INR) — mirrors Odoo calculation */}
                <div className={`mt-3 p-4 rounded-xl border ${isDark ? 'bg-[#12172a] border-[#2a3250]' : 'bg-gray-50 border-gray-200'}`}>
                  <p className={`text-[10px] font-bold uppercase tracking-wider mb-3 ${isDark ? 'text-[#7367f0]' : 'text-violet-600'}`}>Agent Financials (INR)</p>
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <span className={st}>Total {selectedCurrName}: {currSymbol}{fmtCurr(lineTotal)} + Shipping {currSymbol}{fmtCurr(form.shipping_cost || 0)} × {form.exchange_rate || 15}</span>
                      <span className={`font-semibold ${pt}`}>₹{fmtInr(inrTotal)}</span>
                    </div>
                    {(form.deposit_paid || 0) > 0 && (
                      <div className="flex justify-between text-xs">
                        <span className={st}>Less Deposit ({currSymbol}{fmtCurr(form.deposit_paid || 0)} × {form.exchange_rate || 15})</span>
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

              <div>
                <label className={`text-[10px] font-semibold block mb-1 ${st}`}>Notes</label>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2}
                  className={`input text-xs py-2 w-full resize-none ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`} />
              </div>
            </div>
            <div className={mf}>
              <button onClick={() => { setShowCreate(false); setEditMode(null); resetForm(); }} className="btn-secondary text-xs px-4 py-2">Cancel</button>
              <button onClick={handleCreate} disabled={submitting || !form.partner_id} className="btn-primary text-xs px-4 py-2">
                {submitting ? <RefreshCw size={13} className="animate-spin" /> : editMode ? <Edit2 size={13} /> : <Plus size={13} />}
                {submitting ? (editMode ? 'Saving...' : 'Creating...') : editMode ? 'Save Changes' : 'Create RFQ'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Compare Prices Wizard */}
      {compareOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setCompareOpen(false)}>
          <div className={`${modalBg} max-w-5xl w-full max-h-[90vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
            <div className={`${mh} sticky top-0 z-10 ${isDark ? 'bg-[#161b2e]' : 'bg-white'}`}>
              <div>
                <h2 className={`text-base font-black flex items-center gap-2 ${pt}`}><BarChart2 size={16} className="text-green-400" /> Compare Prices</h2>
                <p className={`text-xs mt-0.5 ${st}`}>Historical vendor prices for products in {compareName}</p>
              </div>
              <button onClick={() => setCompareOpen(false)} className={`p-2 rounded-lg ${isDark ? 'hover:bg-white/5 text-[#5a6a8a]' : 'hover:bg-gray-100 text-gray-400'}`}><X size={16} /></button>
            </div>
            <div className="p-5 space-y-5">
              {compareLoading ? (
                <div className="flex items-center justify-center h-32"><RefreshCw size={18} className="animate-spin text-[#7367f0]" /></div>
              ) : compareLines.length === 0 ? (
                <div className="text-center py-10">
                  <BarChart2 size={32} className={`mx-auto mb-2 ${isDark ? 'text-[#2a3250]' : 'text-gray-200'}`} />
                  <p className={`text-xs ${st}`}>No historical purchase prices found for these products yet.</p>
                </div>
              ) : (
                Object.entries(
                  compareLines.reduce((acc: Record<string, CompareLine[]>, l) => {
                    const key = Array.isArray(l.product_id) ? `${l.product_id[0]}|${l.product_id[1]}` : '0|Unknown';
                    (acc[key] = acc[key] || []).push(l);
                    return acc;
                  }, {})
                ).map(([key, group]) => {
                  const prodName = key.split('|')[1];
                  const sorted = [...group].sort((a, b) => a.price_unit - b.price_unit);
                  const best = sorted[0]?.price_unit;
                  return (
                    <div key={key} className={`rounded-xl border overflow-hidden ${isDark ? 'border-[#2a3250]' : 'border-gray-200'}`}>
                      <div className={`px-4 py-2 text-xs font-bold ${isDark ? 'bg-[#1e2440] text-white' : 'bg-gray-50 text-gray-900'}`}>{prodName}</div>
                      <table className="w-full">
                        <thead>
                          <tr className={`text-[10px] font-bold uppercase tracking-wider ${isDark ? 'bg-[#12172a] text-[#5a6a8a]' : 'bg-gray-50 text-gray-500'}`}>
                            <th className="px-3 py-2 text-left">Vendor</th>
                            <th className="px-3 py-2 text-left">Confirmation Date</th>
                            <th className="px-3 py-2 text-right">Qty Ordered</th>
                            <th className="px-3 py-2 text-right">Unit Price</th>
                          </tr>
                        </thead>
                        <tbody className={`divide-y ${isDark ? 'divide-[#2a3250]' : 'divide-gray-100'}`}>
                          {sorted.map(l => (
                            <tr key={l.id} className={l.price_unit === best ? (isDark ? 'bg-green-500/10' : 'bg-green-50') : ''}>
                              <td className={`px-3 py-2 text-xs font-medium ${pt}`}>{Array.isArray(l.partner_id) ? l.partner_id[1] : '--'}</td>
                              <td className={`px-3 py-2 text-xs ${st}`}>{l.date_order ? String(l.date_order).split(' ')[0] : '--'}</td>
                              <td className={`px-3 py-2 text-xs text-right ${st}`}>{l.product_qty}</td>
                              <td className={`px-3 py-2 text-xs text-right font-semibold ${l.price_unit === best ? 'text-green-400' : pt}`}>
                                Rs.{l.price_unit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                {l.price_unit === best && <span className="ml-1 text-[9px] font-bold uppercase">best</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })
              )}
            </div>
            <div className={mf}>
              <button onClick={() => setCompareOpen(false)} className="btn-secondary text-xs px-4 py-2">Close</button>
            </div>
          </div>
        </div>
      )}

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
              onClick={() => selectProductInLine(activeProdLine!, p)}>
              <span className="font-semibold">{p.name}</span>
              {p.default_code && <span className={`ml-1 text-xs ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>[{p.default_code}]</span>}
            </button>
          ))}
        </div>
      )}

      <BulkDeleteBar model="purchase.order" label="order" ids={Array.from(selIds)}
        onClear={() => setSelIds(new Set())} onDeleted={() => syncData()} />
    </div>
  );
}

