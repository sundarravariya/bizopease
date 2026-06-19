import { useState, useEffect, useRef } from 'react';
import { queenCall } from '../../../services/queen';
import { useTheme } from '../../../context/ThemeContext';
import { useAuth } from '../../../context/AuthContext';
import {
  FileText, CheckCircle2, AlertCircle, RefreshCw,
  DollarSign, Truck, ShieldCheck, X, PlusCircle,
  Search, UserCheck, ReceiptText, Trash2, RotateCcw, Ban, Square, CheckSquare
} from 'lucide-react';

interface B2BOrder {
  id: number;
  name: string;
  partner_id: [number, string] | false;
  date_order: string;
  amount_total: number;
  state: 'draft' | 'sent' | 'sale' | 'done' | 'cancel';
  b2b_is_fully_priced: boolean;
  b2b_pricing_accepted: boolean;
  b2b_pricing_accepted_date: string | false;
  invoice_status: string;
  tag_ids: number[];
}

interface OrderLine {
  id: number;
  product_name: string;
  quantity: number;
  price_unit: number;
  price_subtotal: number;
  b2b_product_cost: number;
}

interface Partner { id: number; name: string; }
interface Product { id: number; name: string; list_price: number; default_code: string; }

export default function B2BOrders() {
  const { user } = useAuth();
  const { isDark } = useTheme();
  if (!user?.is_admin) return <div className="flex items-center justify-center h-64 text-[#8897b5]">Access restricted to administrators.</div>;

  const [orders, setOrders] = useState<B2BOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<B2BOrder | null>(null);
  const [orderLines, setOrderLines] = useState<OrderLine[]>([]);
  const [priceInputs, setPriceInputs] = useState<Record<number, string>>({});
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState('all');

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // Create modal
  const [createModal, setCreateModal] = useState(false);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [partnerSearch, setPartnerSearch] = useState('');
  const [showPartnerDrop, setShowPartnerDrop] = useState(false);
  const [prodSearch, setProdSearch] = useState('');
  const [showProdDrop, setShowProdDrop] = useState(false);
  const partnerRef = useRef<HTMLDivElement>(null);
  const prodRef = useRef<HTMLDivElement>(null);

  const [form, setForm] = useState({
    partner_id: '' as number | '',
    partner_name: '',
    product_id: '' as number | '',
    product_name: '',
    quantity: 1,
    price_unit: 0,
    note: '',
  });

  const showMsg = (ok: boolean, msg: string) => {
    setMessage({ type: ok ? 'success' : 'error', text: msg });
    setTimeout(() => setMessage(null), 6000);
  };

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const res = await queenCall<B2BOrder[]>('sale.order', 'search_read', [
        [['tag_ids.name', 'in', ['B2B Request']]]
      ], {
        fields: [
          'id', 'name', 'partner_id', 'date_order', 'amount_total',
          'state', 'b2b_is_fully_priced', 'b2b_pricing_accepted',
          'b2b_pricing_accepted_date', 'invoice_status', 'tag_ids'
        ],
        order: 'date_order desc, id desc',
        limit: 0,
      });
      if (Array.isArray(res)) setOrders(res);
    } catch (err: any) {
      showMsg(false, err?.message || 'Failed to load orders');
    } finally {
      setLoading(false);
    }
  };

  const fetchPartners = async () => {
    try {
      const res = await queenCall<Partner[]>('res.partner', 'search_read', [
        [['b2b_approved', '=', true], ['is_company', '=', true]]
      ], { fields: ['id', 'name'], limit: 0, order: 'name asc' });
      if (Array.isArray(res)) setPartners(res);
    } catch (_) {}
  };

  const fetchProducts = async () => {
    try {
      const res = await queenCall<Product[]>('product.template', 'search_read', [
        [['sale_ok', '=', true]]
      ], { fields: ['id', 'name', 'list_price', 'default_code'], limit: 0, order: 'name asc' });
      if (Array.isArray(res)) setProducts(res);
    } catch (_) {}
  };

  useEffect(() => { fetchOrders(); }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (partnerRef.current && !partnerRef.current.contains(e.target as Node)) setShowPartnerDrop(false);
      if (prodRef.current && !prodRef.current.contains(e.target as Node)) setShowProdDrop(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleOpenDetails = async (order: B2BOrder) => {
    setSelectedOrder(order);
    setLoading(true);
    try {
      const res = await queenCall<any[]>('sale.order.line', 'search_read', [
        [['order_id', '=', order.id]]
      ], {
        fields: ['id', 'product_id', 'product_uom_qty', 'price_unit', 'price_subtotal', 'b2b_product_cost'],
        limit: 0,
      });
      if (Array.isArray(res)) {
        const lines: OrderLine[] = res.map(r => ({
          id: r.id,
          product_name: Array.isArray(r.product_id) ? r.product_id[1] : String(r.product_id || ''),
          quantity: r.product_uom_qty,
          price_unit: r.price_unit,
          price_subtotal: r.price_subtotal,
          b2b_product_cost: r.b2b_product_cost || 0,
        }));
        setOrderLines(lines);
        const init: Record<number, string> = {};
        lines.forEach(l => { init[l.id] = l.price_unit > 0 ? String(l.price_unit) : ''; });
        setPriceInputs(init);
      }
    } catch (err: any) {
      showMsg(false, err?.message || 'Failed to load order lines');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdatePrices = async () => {
    if (!selectedOrder) return;
    setLoading(true);
    try {
      for (const lineId of Object.keys(priceInputs)) {
        const price = parseFloat(priceInputs[Number(lineId)] || '0');
        if (price > 0) {
          await queenCall('sale.order.line', 'write', [[Number(lineId)], { price_unit: price }]);
        }
      }
      showMsg(true, 'Pricing updated on ' + selectedOrder.name);
      await fetchOrders();
      setSelectedOrder(null);
    } catch (err: any) {
      showMsg(false, err?.message || 'Failed to update prices');
    } finally {
      setLoading(false);
    }
  };

  const handleAcceptPricing = async (id: number) => {
    setLoading(true);
    try {
      await queenCall('sale.order', 'action_b2b_accept_pricing', [[id]]);
      showMsg(true, 'Pricing accepted.');
      await fetchOrders();
    } catch (err: any) {
      showMsg(false, err?.message || 'Action failed');
    } finally {
      setLoading(false);
    }
  };

  const handleAdminConfirm = async (id: number) => {
    setLoading(true);
    try {
      await queenCall('sale.order', 'action_b2b_admin_confirm', [[id]]);
      showMsg(true, 'Order confirmed.');
      await fetchOrders();
    } catch (err: any) {
      showMsg(false, err?.message || 'Confirm failed');
    } finally {
      setLoading(false);
    }
  };

  const handle1ClickInvoiceDelivery = async (id: number) => {
    setLoading(true);
    try {
      await queenCall('sale.order', 'action_b2b_1click_invoice_delivery', [[id]]);
      showMsg(true, '1-Click: delivery validated and invoice posted.');
      await fetchOrders();
    } catch (err: any) {
      showMsg(false, err?.message || '1-Click action failed');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateQuotation = async (id: number) => {
    setLoading(true);
    try {
      await queenCall('sale.order', 'action_b2b_create_customer_quotation', [[id]]);
      showMsg(true, 'Customer quotation created from request.');
      await fetchOrders();
    } catch (err: any) {
      showMsg(false, err?.message || 'Create quotation failed');
    } finally {
      setLoading(false);
    }
  };

  const handleBulkCancel = async () => {
    if (!selectedIds.size) return;
    if (!confirm(`Cancel ${selectedIds.size} selected order(s)?`)) return;
    setLoading(true);
    try {
      await queenCall('sale.order', 'action_cancel', [[...selectedIds]]);
      showMsg(true, `${selectedIds.size} order(s) cancelled.`);
      setSelectedIds(new Set());
      await fetchOrders();
    } catch (err: any) { showMsg(false, err?.message || 'Bulk cancel failed'); }
    finally { setLoading(false); }
  };

  const handleBulkDraft = async () => {
    if (!selectedIds.size) return;
    if (!confirm(`Reset ${selectedIds.size} order(s) to draft?`)) return;
    setLoading(true);
    try {
      await queenCall('sale.order', 'action_draft', [[...selectedIds]]);
      showMsg(true, `${selectedIds.size} order(s) reset to draft.`);
      setSelectedIds(new Set());
      await fetchOrders();
    } catch (err: any) { showMsg(false, err?.message || 'Bulk reset failed'); }
    finally { setLoading(false); }
  };

  const handleBulkDelete = async () => {
    if (!selectedIds.size) return;
    const draftIds = filteredOrders.filter(o => selectedIds.has(o.id) && o.state === 'draft').map(o => o.id);
    if (!draftIds.length) { showMsg(false, 'Only draft orders can be deleted.'); return; }
    if (!confirm(`Permanently delete ${draftIds.length} draft order(s)? This cannot be undone.`)) return;
    setLoading(true);
    try {
      await queenCall('sale.order', 'unlink', [draftIds]);
      showMsg(true, `${draftIds.length} draft order(s) deleted.`);
      setSelectedIds(new Set());
      await fetchOrders();
    } catch (err: any) { showMsg(false, err?.message || 'Bulk delete failed'); }
    finally { setLoading(false); }
  };

  const handleOpenCreate = async () => {
    setCreateModal(true);
    if (partners.length === 0) fetchPartners();
    if (products.length === 0) fetchProducts();
  };

  const handleCreateOrderRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.partner_id || !form.product_id) return;
    setLoading(true);
    try {
      const requestTag = await queenCall<any[]>('crm.tag', 'search_read', [
        [['name', '=', 'B2B Request']]
      ], { fields: ['id'], limit: 1 });
      let tagId: number | null = null;
      if (Array.isArray(requestTag) && requestTag.length > 0) {
        tagId = requestTag[0].id;
      } else {
        const created = await queenCall<number>('crm.tag', 'create', [{ name: 'B2B Request' }]);
        tagId = created as number;
      }

      // Find a product.product for the order line
      const variants = await queenCall<any[]>('product.product', 'search_read', [
        [['product_tmpl_id', '=', form.product_id]]
      ], { fields: ['id'], limit: 1 });
      const variantId = Array.isArray(variants) && variants.length > 0 ? variants[0].id : null;
      if (!variantId) throw new Error('Product variant not found');

      const orderId = await queenCall<number>('sale.order', 'create', [{
        partner_id: form.partner_id,
        note: form.note || '',
        tag_ids: tagId ? [[4, tagId]] : [],
        order_line: [[0, 0, {
          product_id: variantId,
          product_uom_qty: form.quantity,
          price_unit: form.price_unit,
        }]],
      }]);
      showMsg(true, 'Order request created (ID ' + orderId + ')');
      setCreateModal(false);
      setForm({ partner_id: '', partner_name: '', product_id: '', product_name: '', quantity: 1, price_unit: 0, note: '' });
      setPartnerSearch('');
      setProdSearch('');
      await fetchOrders();
    } catch (err: any) {
      showMsg(false, err?.message || 'Create failed');
    } finally {
      setLoading(false);
    }
  };

  const glassClass = isDark ? 'glass' : 'glass-light bg-white/80';
  const stateColor: Record<string, string> = {
    draft: 'bg-gray-500/15 text-gray-400 border border-gray-500/20',
    sent: 'bg-violet-500/15 text-violet-400 border border-violet-500/20',
    sale: 'bg-blue-500/15 text-blue-400 border border-blue-500/20',
    done: 'bg-green-500/15 text-green-400 border border-green-500/20',
    cancel: 'bg-red-500/15 text-red-400 border border-red-500/20',
  };
  const stateLabel: Record<string, string> = {
    draft: 'Request', sent: 'Sent', sale: 'Confirmed', done: 'Done', cancel: 'Cancelled',
  };
  const invoiceLabel: Record<string, string> = {
    nothing: '--', no: 'Nothing', to_invoice: 'To Invoice', invoiced: 'Invoiced',
  };

  const filteredOrders = orders.filter(o => {
    const partnerName = Array.isArray(o.partner_id) ? o.partner_id[1] : '';
    const matchSearch = !search ||
      o.name.toLowerCase().includes(search.toLowerCase()) ||
      partnerName.toLowerCase().includes(search.toLowerCase());
    const matchState = stateFilter === 'all' || o.state === stateFilter;
    return matchSearch && matchState;
  });

  const filteredPartners = partners.filter(p =>
    p.name.toLowerCase().includes(partnerSearch.toLowerCase())
  ).slice(0, 12);

  const filteredProducts = products.filter(p =>
    p.name.toLowerCase().includes(prodSearch.toLowerCase()) ||
    (p.default_code || '').toLowerCase().includes(prodSearch.toLowerCase())
  ).slice(0, 12);

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className={`text-2xl font-black ${isDark ? 'text-white' : 'text-gray-900'}`}>B2B Wholesale Order Requests</h1>
          <p className={`text-xs mt-1 ${isDark ? 'text-[#5a6a8a]' : 'text-gray-500'}`}>
            Manage bulk orders, audit pricing queues, and execute 1-click invoice and dispatch cycles.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleOpenCreate} className="btn-primary text-xs px-3.5 py-1.5 flex items-center gap-1">
            <PlusCircle size={13} /> Create Request
          </button>
          <button onClick={fetchOrders} className="btn-secondary text-xs px-3.5 py-1.5 flex items-center gap-1">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Sync
          </button>
        </div>
      </div>

      {/* Toast */}
      {message && (
        <div className={`p-4 rounded-xl flex items-start gap-3 border ${
          message.type === 'success'
            ? 'bg-green-500/10 border-green-500/20 text-green-400'
            : 'bg-red-500/10 border-red-500/20 text-red-400'
        }`}>
          {message.type === 'success' ? <CheckCircle2 className="w-5 h-5 flex-shrink-0" /> : <AlertCircle className="w-5 h-5 flex-shrink-0" />}
          <span className="text-sm font-medium">{message.text}</span>
        </div>
      )}

      {/* Filter Bar */}
      <div className={`card p-3 rounded-2xl flex flex-col sm:flex-row items-center gap-3 ${glassClass}`}>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            type="text"
            placeholder="Search order or partner..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className={`w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border outline-none ${
              isDark ? 'bg-[#1f2937] border-white/10 text-white' : 'bg-gray-50 border-gray-200 text-gray-800'
            }`}
          />
        </div>
        <select
          value={stateFilter}
          onChange={e => setStateFilter(e.target.value)}
          className={`px-3 py-1.5 text-xs rounded-lg border outline-none ${
            isDark ? 'bg-[#1f2937] border-white/10 text-white' : 'bg-gray-50 border-gray-200 text-gray-800'
          }`}
        >
          <option value="all">All States</option>
          <option value="draft">Request (Draft)</option>
          <option value="sent">Sent (Quotation)</option>
          <option value="sale">Confirmed</option>
          <option value="done">Done</option>
          <option value="cancel">Cancelled</option>
        </select>
        <span className={`sm:ml-auto text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          {filteredOrders.length} record{filteredOrders.length !== 1 ? 's' : ''}
        </span>
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
          <button onClick={handleBulkDelete} className="px-3 py-1.5 bg-red-600/10 text-red-500 border border-red-600/20 text-xs font-bold rounded-lg hover:bg-red-600/20 transition-all flex items-center gap-1">
            <Trash2 size={11} /> Delete Drafts
          </button>
          <button onClick={() => setSelectedIds(new Set())} className="ml-1 p-1.5 text-gray-500 hover:text-white transition-colors">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Orders Table */}
      <div className={`card overflow-x-auto rounded-2xl ${glassClass}`}>
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className={`border-b text-xs font-semibold uppercase tracking-wider ${isDark ? 'border-white/5 bg-[#111827]/40 text-gray-400' : 'border-gray-200 bg-gray-50 text-gray-500'}`}>
              <th className="py-4 pl-5 pr-2 w-8">
                <button onClick={() => {
                  if (selectedIds.size === filteredOrders.length && filteredOrders.length > 0) {
                    setSelectedIds(new Set());
                  } else {
                    setSelectedIds(new Set(filteredOrders.map(o => o.id)));
                  }
                }} className="text-gray-400 hover:text-violet-400 transition-colors">
                  {selectedIds.size === filteredOrders.length && filteredOrders.length > 0
                    ? <CheckSquare size={14} className="text-violet-400" />
                    : <Square size={14} />}
                </button>
              </th>
              <th className="py-4 px-5">Order</th>
              <th className="py-4 px-5">Partner</th>
              <th className="py-4 px-5">Date</th>
              <th className="py-4 px-5 text-right">Total (Rs.)</th>
              <th className="py-4 px-5 text-center">Pricing</th>
              <th className="py-4 px-5 text-center">State</th>
              <th className="py-4 px-5 text-center">Invoice</th>
              <th className="py-4 px-5 text-center">Actions</th>
            </tr>
          </thead>
          <tbody className={`divide-y text-sm ${isDark ? 'divide-white/5' : 'divide-gray-100'}`}>
            {loading && filteredOrders.length === 0 ? (
              <tr><td colSpan={9} className="py-12 text-center">
                <RefreshCw className="w-5 h-5 animate-spin mx-auto text-violet-400" />
              </td></tr>
            ) : filteredOrders.length === 0 ? (
              <tr><td colSpan={9} className={`py-12 text-center text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                No B2B order requests found.
              </td></tr>
            ) : filteredOrders.map(order => {
              const partnerName = Array.isArray(order.partner_id) ? order.partner_id[1] : '--';
              const isSelected = selectedIds.has(order.id);
              return (
                <tr key={order.id} className={`transition-colors ${isSelected ? (isDark ? 'bg-violet-500/5' : 'bg-violet-50') : isDark ? 'hover:bg-white/5' : 'hover:bg-gray-50'}`}>
                  <td className="py-3.5 pl-5 pr-2">
                    <button onClick={() => {
                      const next = new Set(selectedIds);
                      if (isSelected) next.delete(order.id); else next.add(order.id);
                      setSelectedIds(next);
                    }} className="text-gray-500 hover:text-violet-400 transition-colors">
                      {isSelected ? <CheckSquare size={14} className="text-violet-400" /> : <Square size={14} />}
                    </button>
                  </td>
                  <td className={`py-3.5 px-5 font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>{order.name}</td>
                  <td className={`py-3.5 px-5 font-semibold ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>{partnerName}</td>
                  <td className={`py-3.5 px-5 text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{order.date_order?.split(' ')[0] || '--'}</td>
                  <td className={`py-3.5 px-5 text-right font-bold ${isDark ? 'text-white' : 'text-gray-800'}`}>
                    Rs. {order.amount_total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="py-3.5 px-5 text-center">
                    <span className={`inline-block text-[9px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full ${
                      order.b2b_pricing_accepted
                        ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                        : order.b2b_is_fully_priced
                        ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                        : 'bg-red-500/10 text-red-400 border border-red-500/20 animate-pulse'
                    }`}>
                      {order.b2b_pricing_accepted ? 'Accepted' : order.b2b_is_fully_priced ? 'Priced' : 'Req Pricing'}
                    </span>
                  </td>
                  <td className="py-3.5 px-5 text-center">
                    <span className={`inline-block text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${stateColor[order.state] || stateColor.draft}`}>
                      {stateLabel[order.state] || order.state}
                    </span>
                  </td>
                  <td className={`py-3.5 px-5 text-center text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    {invoiceLabel[order.invoice_status] || order.invoice_status || '--'}
                  </td>
                  <td className="py-3.5 px-5 text-center">
                    <div className="flex gap-1.5 justify-center flex-wrap">
                      {/* Pricing audit */}
                      <button
                        onClick={() => handleOpenDetails(order)}
                        title="Audit / Set Prices"
                        className="px-2 py-1 bg-[#8b5cf6]/10 text-[#8b5cf6] border border-[#8b5cf6]/20 text-xs font-bold rounded-lg hover:bg-[#8b5cf6]/20 transition-all flex items-center gap-1"
                      >
                        <DollarSign size={11} /> Pricing
                      </button>

                      {/* Accept Pricing (draft/sent) */}
                      {(order.state === 'draft' || order.state === 'sent') && !order.b2b_pricing_accepted && (
                        <button
                          onClick={() => handleAcceptPricing(order.id)}
                          title="Mark Pricing Accepted"
                          className="px-2 py-1 bg-amber-500/10 text-amber-400 border border-amber-500/20 text-xs font-bold rounded-lg hover:bg-amber-500/20 transition-all flex items-center gap-1"
                        >
                          <UserCheck size={11} /> Accept
                        </button>
                      )}

                      {/* Admin Confirm (draft/sent) */}
                      {(order.state === 'draft' || order.state === 'sent') && (
                        <button
                          onClick={() => handleAdminConfirm(order.id)}
                          title="Confirm B2B Order"
                          className="px-2 py-1 bg-blue-500/10 text-blue-400 border border-blue-500/20 text-xs font-bold rounded-lg hover:bg-blue-500/20 transition-all flex items-center gap-1"
                        >
                          <ShieldCheck size={11} /> Confirm
                        </button>
                      )}

                      {/* Create Customer Quotation (draft/sent) */}
                      {(order.state === 'draft' || order.state === 'sent') && (
                        <button
                          onClick={() => handleCreateQuotation(order.id)}
                          title="Create Customer Quotation"
                          className="px-2 py-1 bg-sky-500/10 text-sky-400 border border-sky-500/20 text-xs font-bold rounded-lg hover:bg-sky-500/20 transition-all flex items-center gap-1"
                        >
                          <ReceiptText size={11} /> Quotation
                        </button>
                      )}

                      {/* 1-Click Invoice + Delivery (sale, priced) */}
                      {order.b2b_is_fully_priced && order.state === 'sale' && (
                        <button
                          onClick={() => handle1ClickInvoiceDelivery(order.id)}
                          title="1-Click Invoice and Delivery"
                          className="px-2 py-1 bg-green-500/10 text-green-400 border border-green-500/20 text-xs font-bold rounded-lg hover:bg-green-500/20 transition-all flex items-center gap-1"
                        >
                          <Truck size={11} /> 1-Click
                        </button>
                      )}

                      {/* Cancel (draft/sent/sale → cancel) */}
                      {(order.state === 'draft' || order.state === 'sent' || order.state === 'sale') && (
                        <button
                          onClick={async () => {
                            if (!confirm('Cancel this order?')) return;
                            setLoading(true);
                            try { await queenCall('sale.order', 'action_cancel', [[order.id]]); showMsg(true, 'Order cancelled.'); await fetchOrders(); }
                            catch (e: any) { showMsg(false, e?.message || 'Cancel failed'); }
                            finally { setLoading(false); }
                          }}
                          title="Cancel Order"
                          className="px-2 py-1 bg-red-500/10 text-red-400 border border-red-500/20 text-xs font-bold rounded-lg hover:bg-red-500/20 transition-all flex items-center gap-1"
                        >
                          <Ban size={11} /> Cancel
                        </button>
                      )}

                      {/* Reset to Draft (cancel → draft) */}
                      {order.state === 'cancel' && (
                        <button
                          onClick={async () => {
                            setLoading(true);
                            try { await queenCall('sale.order', 'action_draft', [[order.id]]); showMsg(true, 'Reset to draft.'); await fetchOrders(); }
                            catch (e: any) { showMsg(false, e?.message || 'Reset failed'); }
                            finally { setLoading(false); }
                          }}
                          title="Reset to Draft"
                          className="px-2 py-1 bg-amber-500/10 text-amber-400 border border-amber-500/20 text-xs font-bold rounded-lg hover:bg-amber-500/20 transition-all flex items-center gap-1"
                        >
                          <RotateCcw size={11} /> Draft
                        </button>
                      )}

                      {/* Delete (draft only) */}
                      {order.state === 'draft' && (
                        <button
                          onClick={async () => {
                            if (!confirm('Permanently delete this draft order?')) return;
                            setLoading(true);
                            try { await queenCall('sale.order', 'unlink', [[order.id]]); showMsg(true, 'Draft order deleted.'); await fetchOrders(); }
                            catch (e: any) { showMsg(false, e?.message || 'Delete failed'); }
                            finally { setLoading(false); }
                          }}
                          title="Delete Draft"
                          className="px-2 py-1 bg-red-600/10 text-red-500 border border-red-600/20 text-xs font-bold rounded-lg hover:bg-red-600/20 transition-all flex items-center gap-1"
                        >
                          <Trash2 size={11} /> Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pricing Modal */}
      {selectedOrder && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
          onClick={() => setSelectedOrder(null)}
        >
          <div
            className={`w-full max-w-2xl rounded-3xl border shadow-2xl overflow-hidden flex flex-col max-h-[90vh] ${isDark ? 'bg-[#161b2e] border-[#2a3250]' : 'bg-white border-gray-200'}`}
            onClick={e => e.stopPropagation()}
          >
            <div className={`p-5 border-b flex items-center justify-between ${isDark ? 'border-[#2a3250]' : 'border-gray-100'}`}>
              <div>
                <h3 className={`font-black text-base ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  Audit Pricing: {selectedOrder.name}
                </h3>
                <p className={`text-xs mt-0.5 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                  {Array.isArray(selectedOrder.partner_id) ? selectedOrder.partner_id[1] : '--'}
                </p>
              </div>
              <button
                onClick={() => setSelectedOrder(null)}
                className={`p-1.5 rounded-xl ${isDark ? 'hover:bg-white/5 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4">
              <div className={`p-4 rounded-xl border flex items-start gap-2 bg-amber-500/5 ${isDark ? 'border-amber-500/10' : 'border-amber-500/20'}`}>
                <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                <span className={`text-xs leading-relaxed ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                  Items priced at Rs. 1.00 or less are unpriced request items. Enter valid wholesale prices below.
                </span>
              </div>

              <div className={`border rounded-xl overflow-hidden ${isDark ? 'border-white/5' : 'border-gray-100'}`}>
                <table className="w-full text-left">
                  <thead>
                    <tr className={`text-xs font-semibold uppercase ${isDark ? 'bg-[#111827]/30 text-gray-400 border-b border-white/5' : 'bg-gray-50 text-gray-500 border-b border-gray-100'}`}>
                      <th className="py-2.5 px-4">Product</th>
                      <th className="py-2.5 px-4 text-center">Qty</th>
                      <th className="py-2.5 px-4 text-right">Cost (Rs.)</th>
                      <th className="py-2.5 px-4">Sale Price (Rs.)</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y text-xs ${isDark ? 'divide-white/5 text-gray-300' : 'divide-gray-100 text-gray-700'}`}>
                    {orderLines.map(line => (
                      <tr key={line.id}>
                        <td className="py-3 px-4 font-bold">{line.product_name}</td>
                        <td className="py-3 px-4 text-center font-bold">{line.quantity}</td>
                        <td className={`py-3 px-4 text-right ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                          {line.b2b_product_cost > 0 ? line.b2b_product_cost.toFixed(2) : '--'}
                        </td>
                        <td className="py-3 px-4">
                          <input
                            type="number"
                            value={priceInputs[line.id] || ''}
                            onChange={e => setPriceInputs({ ...priceInputs, [line.id]: e.target.value })}
                            className={`w-28 px-3 py-1.5 text-xs rounded-lg border outline-none ${
                              isDark ? 'bg-[#111827] border-white/10 text-white' : 'bg-gray-50 border-gray-200 text-gray-900'
                            }`}
                            placeholder="Set price..."
                            step="0.01"
                            min="0"
                          />
                        </td>
                      </tr>
                    ))}
                    {orderLines.length === 0 && (
                      <tr><td colSpan={4} className="py-8 text-center text-xs text-gray-500">No lines found.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className={`p-4 border-t flex justify-end gap-2 ${isDark ? 'border-[#2a3250] bg-black/20' : 'border-gray-100 bg-gray-50'}`}>
              <button
                type="button"
                onClick={() => setSelectedOrder(null)}
                className="btn-secondary text-xs px-4 py-2"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleUpdatePrices}
                disabled={loading}
                className="btn-primary text-xs px-4 py-2 flex items-center gap-1"
              >
                <ShieldCheck size={13} /> Save Prices
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Request Modal */}
      {createModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
          onClick={() => setCreateModal(false)}
        >
          <div
            className={`w-full max-w-md rounded-2xl border shadow-2xl overflow-hidden ${isDark ? 'bg-[#1e2440] border-[#2a3250]' : 'bg-white border-gray-200'}`}
            onClick={e => e.stopPropagation()}
          >
            <div className={`flex items-center justify-between px-5 py-4 border-b ${isDark ? 'border-[#2a3250]' : 'border-gray-100'}`}>
              <h3 className={`font-bold text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>Create B2B Order Request</h3>
              <button onClick={() => setCreateModal(false)} className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-white/5 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}>
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleCreateOrderRequest} className="p-5 space-y-4">
              {/* Partner */}
              <div ref={partnerRef} className="relative">
                <label className="label text-[#5a6a8a]">B2B Partner (Approved)</label>
                <input
                  type="text"
                  value={partnerSearch || form.partner_name}
                  onChange={e => { setPartnerSearch(e.target.value); setShowPartnerDrop(true); setForm(f => ({ ...f, partner_id: '', partner_name: '' })); }}
                  onFocus={() => setShowPartnerDrop(true)}
                  placeholder="Search partner..."
                  required={!form.partner_id}
                  className={`input ${isDark ? 'bg-[#12172a] border-[#2a3250] text-white' : ''}`}
                />
                {showPartnerDrop && filteredPartners.length > 0 && (
                  <div className={`absolute z-10 w-full mt-1 rounded-xl border shadow-lg max-h-40 overflow-y-auto ${isDark ? 'bg-[#1e2440] border-[#2a3250]' : 'bg-white border-gray-200'}`}>
                    {filteredPartners.map(p => (
                      <div
                        key={p.id}
                        className={`px-3 py-2 text-xs cursor-pointer ${isDark ? 'hover:bg-white/5 text-gray-300' : 'hover:bg-gray-50 text-gray-700'}`}
                        onClick={() => { setForm(f => ({ ...f, partner_id: p.id, partner_name: p.name })); setPartnerSearch(p.name); setShowPartnerDrop(false); }}
                      >
                        {p.name}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Product */}
              <div ref={prodRef} className="relative">
                <label className="label text-[#5a6a8a]">Product</label>
                <input
                  type="text"
                  value={prodSearch || form.product_name}
                  onChange={e => { setProdSearch(e.target.value); setShowProdDrop(true); setForm(f => ({ ...f, product_id: '', product_name: '' })); }}
                  onFocus={() => setShowProdDrop(true)}
                  placeholder="Search product..."
                  required={!form.product_id}
                  className={`input ${isDark ? 'bg-[#12172a] border-[#2a3250] text-white' : ''}`}
                />
                {showProdDrop && filteredProducts.length > 0 && (
                  <div className={`absolute z-10 w-full mt-1 rounded-xl border shadow-lg max-h-40 overflow-y-auto ${isDark ? 'bg-[#1e2440] border-[#2a3250]' : 'bg-white border-gray-200'}`}>
                    {filteredProducts.map(p => (
                      <div
                        key={p.id}
                        className={`px-3 py-2 text-xs cursor-pointer ${isDark ? 'hover:bg-white/5 text-gray-300' : 'hover:bg-gray-50 text-gray-700'}`}
                        onClick={() => { setForm(f => ({ ...f, product_id: p.id, product_name: p.name, price_unit: p.list_price || 0 })); setProdSearch(p.name); setShowProdDrop(false); }}
                      >
                        <span className="font-semibold">{p.name}</span>
                        {p.default_code && <span className="ml-2 text-gray-500">[{p.default_code}]</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label text-[#5a6a8a]">Quantity</label>
                  <input
                    type="number" min="1" value={form.quantity}
                    onChange={e => setForm(f => ({ ...f, quantity: Number(e.target.value) }))}
                    className={`input ${isDark ? 'bg-[#12172a] border-[#2a3250] text-white' : ''}`}
                  />
                </div>
                <div>
                  <label className="label text-[#5a6a8a]">Wholesale Price (Rs.)</label>
                  <input
                    type="number" min="0" step="0.01" value={form.price_unit}
                    onChange={e => setForm(f => ({ ...f, price_unit: Number(e.target.value) }))}
                    placeholder="0.00 = Req Pricing"
                    className={`input ${isDark ? 'bg-[#12172a] border-[#2a3250] text-white' : ''}`}
                  />
                </div>
              </div>

              <div>
                <label className="label text-[#5a6a8a]">Note (optional)</label>
                <textarea
                  value={form.note}
                  onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                  rows={2}
                  placeholder="Any special requirements..."
                  className={`input resize-none ${isDark ? 'bg-[#12172a] border-[#2a3250] text-white' : ''}`}
                />
              </div>

              <p className="text-[10px] text-amber-400 font-semibold italic">
                Leave price as 0.00 to enter the order into the pricing review queue.
              </p>

              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setCreateModal(false)} className="btn-secondary flex-1 justify-center text-xs py-2.5">Cancel</button>
                <button type="submit" disabled={loading || !form.partner_id || !form.product_id} className="btn-primary flex-1 justify-center text-xs py-2.5 flex items-center gap-1">
                  <PlusCircle size={13} /> Submit Request
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
