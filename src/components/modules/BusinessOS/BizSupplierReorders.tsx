import { useState, useEffect } from 'react';
import { searchRead, odooCall, createRecord } from '../../../services/odoo';
import { useTheme } from '../../../context/ThemeContext';
import { AlertCircle, RefreshCw, ShoppingCart, CheckCircle2, Filter } from 'lucide-react';

// Native (non-Flipkart) Supplier Reorder — reads biz.supplier.reorder, sourced
// from native sale.order velocity + purchase.order pipeline. No FBF dimension.

interface ReorderItem {
  id: number;
  sku: string;
  product_id: [number, string] | false;
  physical_stock: number;
  incoming_qty: number;
  next_po_arrival_date: string | false;
  pipeline_lowest_days: number;
  total_available: number;
  daily_avg_sales: number;
  lead_time_days: number;
  days_in_hand: number;
  stockout_date: string | false;
  order_now_qty: number;
  next_order_date: string | false;
  next_order_qty: number;
  reorder_trigger_date: string | false;
  reorder_qty: number;
  action_required: boolean;
  urgency: 'critical' | 'moderate' | 'healthy';
  selected?: boolean;
}

const FIELDS: string[] = [
  'id', 'sku', 'product_id', 'physical_stock', 'incoming_qty',
  'next_po_arrival_date', 'pipeline_lowest_days', 'total_available', 'daily_avg_sales',
  'lead_time_days', 'days_in_hand', 'stockout_date', 'order_now_qty',
  'next_order_date', 'next_order_qty', 'reorder_trigger_date', 'reorder_qty',
  'action_required', 'urgency',
];

export default function BizSupplierReorders() {
  const { isDark } = useTheme();
  const [items, setItems] = useState<ReorderItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [warehouses, setWarehouses] = useState<{ id: number; name: string }[]>([]);
  const [selectedWhId, setSelectedWhId] = useState<number | ''>('');
  const [actionRequiredOnly, setActionRequiredOnly] = useState(false);
  const [urgencyFilter, setUrgencyFilter] = useState<'all' | 'critical' | 'moderate' | 'healthy'>('all');

  useEffect(() => { fetchWarehouses(); fetchRecommendations(); }, []);

  const fetchWarehouses = async () => {
    try {
      const res = await searchRead<{ id: number; name: string }>('stock.warehouse', {
        fields: ['id', 'name'], domain: [], limit: 0,
      });
      setWarehouses(res || []);
      if (res?.length) setSelectedWhId(res[0].id);
    } catch (e: any) { console.error(e); }
  };

  const fetchRecommendations = async () => {
    setLoading(true);
    try {
      const res = await searchRead<ReorderItem>('biz.supplier.reorder', {
        fields: FIELDS,
        domain: [],
        limit: 0,
        order: 'urgency asc, order_now_qty desc',
      });
      setItems((res || []).map(item => ({ ...item, selected: false })));
    } catch (e: any) {
      setMessage({ type: 'error', text: 'Failed to fetch supplier pipeline: ' + e.message });
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    if (!selectedWhId) return;
    setGenerating(true);
    setMessage(null);
    try {
      const wizardId = await createRecord('biz.supplier.reorder.generate', { warehouse_id: selectedWhId });
      await odooCall('biz.supplier.reorder.generate', 'action_generate', [[wizardId]], {});
      setMessage({ type: 'success', text: 'Supplier reorder pipeline recalculated.' });
      fetchRecommendations();
    } catch (e: any) {
      setMessage({ type: 'error', text: 'Recalculation failed: ' + e.message });
    } finally {
      setGenerating(false);
    }
  };

  const handleCreateDraftPO = async () => {
    const selectedItems = items.filter(i => i.selected);
    if (!selectedItems.length) return;
    setLoading(true);
    setMessage(null);
    try {
      const productIds = selectedItems
        .filter(i => Array.isArray(i.product_id))
        .map(i => (i.product_id as [number, string])[0]);

      if (!productIds.length) {
        setMessage({ type: 'error', text: 'Selected items have no linked products.' });
        return;
      }

      const supplierInfo = await searchRead<{ product_id: [number, string]; partner_id: [number, string]; price: number }>(
        'product.supplierinfo', {
          fields: ['product_id', 'partner_id', 'price'],
          domain: [['product_id', 'in', productIds]],
          limit: 0,
          order: 'sequence asc',
        }
      );
      const vendorByProduct: Record<number, { vendorId: number; price: number }> = {};
      for (const s of (supplierInfo || [])) {
        const pid = Array.isArray(s.product_id) ? s.product_id[0] : 0;
        if (pid && !vendorByProduct[pid]) {
          vendorByProduct[pid] = { vendorId: (s.partner_id as [number, string])[0], price: s.price || 0 };
        }
      }

      const byVendor: Record<number, typeof selectedItems> = {};
      for (const item of selectedItems) {
        const pid = Array.isArray(item.product_id) ? (item.product_id as [number, string])[0] : 0;
        const vendor = vendorByProduct[pid];
        if (!vendor) continue;
        if (!byVendor[vendor.vendorId]) byVendor[vendor.vendorId] = [];
        byVendor[vendor.vendorId].push(item);
      }

      if (!Object.keys(byVendor).length) {
        setMessage({ type: 'error', text: 'No vendor found for selected products.' });
        return;
      }

      const poNames: string[] = [];
      for (const [vidStr, lines] of Object.entries(byVendor)) {
        const vid = Number(vidStr);
        const poId = await createRecord('purchase.order', {
          partner_id: vid,
          origin: 'Supplier Reorder Pipeline -- Portal',
          order_line: lines.map(item => {
            const pid = Array.isArray(item.product_id) ? (item.product_id as [number, string])[0] : 0;
            return [0, 0, {
              product_id: pid,
              product_qty: item.order_now_qty,
              price_unit: vendorByProduct[pid]?.price || 0,
              date_planned: new Date().toISOString(),
            }];
          }),
        });
        const [rec] = await searchRead<{ name: string }>('purchase.order', { domain: [['id', '=', poId]], fields: ['name'], limit: 1 });
        poNames.push(rec?.name || `PO-${poId}`);
      }
      setMessage({ type: 'success', text: `Draft PO(s) created: ${poNames.join(', ')}` });
      fetchRecommendations();
    } catch (e: any) {
      setMessage({ type: 'error', text: 'PO drafting failed: ' + e.message });
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = (id: number) => setItems(p => p.map(i => i.id === id ? { ...i, selected: !i.selected } : i));
  const handleSelectAll = (val: boolean) => setItems(p => p.map(i => ({ ...i, selected: val && i.order_now_qty > 0 })));

  const filtered = items
    .filter(i => !actionRequiredOnly || i.action_required)
    .filter(i => urgencyFilter === 'all' || i.urgency === urgencyFilter);

  const selectedCount = items.filter(i => i.selected).length;
  const criticalCount = items.filter(i => i.urgency === 'critical').length;
  const actionCount = items.filter(i => i.action_required).length;

  const pt = isDark ? 'text-white' : 'text-gray-900';
  const st = isDark ? 'text-[#5a6a8a]' : 'text-gray-500';
  const card = `card border rounded-2xl ${isDark ? 'bg-[#161b2e] border-[#2a3250]' : 'bg-white border-gray-200'}`;
  const th = `text-xs font-semibold uppercase tracking-wider border-b py-3 px-4 ${isDark ? 'bg-[#111827]/60 text-[#5a6a8a] border-[#2a3250]' : 'bg-gray-50 text-gray-500 border-gray-200'}`;

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className={`text-2xl font-black ${pt}`}>Supplier Pipeline Planner</h1>
          <p className={`text-xs mt-1 ${st}`}>Cash-efficient purchasing recommendations to maintain 30-day stock cover.</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={selectedWhId}
            onChange={(e) => setSelectedWhId(Number(e.target.value))}
            className={`px-3 py-1.5 text-xs font-semibold rounded-xl border focus:outline-none focus:border-brand-violet ${
              isDark ? 'bg-[#1f2937]/90 border-white/10 text-white' : 'bg-gray-50 border-gray-200 text-gray-800'
            }`}
          >
            {warehouses.map(wh => (<option key={wh.id} value={wh.id}>{wh.name}</option>))}
          </select>
          <button onClick={fetchRecommendations} disabled={loading} className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Sync
          </button>
          <button onClick={handleGenerate} disabled={generating || !selectedWhId} className="btn-primary text-xs px-3.5 py-1.5 flex items-center gap-1.5">
            <RefreshCw size={13} className={generating ? 'animate-spin' : ''} /> Recalculate
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className={`${card} p-4`}>
          <p className="text-2xl font-black text-red-400">{criticalCount}</p>
          <p className={`text-[10px] uppercase tracking-wider font-semibold mt-1 ${st}`}>Critical</p>
        </div>
        <div className={`${card} p-4`}>
          <p className="text-2xl font-black text-amber-400">{actionCount}</p>
          <p className={`text-[10px] uppercase tracking-wider font-semibold mt-1 ${st}`}>Action Required</p>
        </div>
        <div className={`${card} p-4`}>
          <p className="text-2xl font-black text-[#7367f0]">{items.length}</p>
          <p className={`text-[10px] uppercase tracking-wider font-semibold mt-1 ${st}`}>Total SKUs</p>
        </div>
      </div>

      {/* Message */}
      {message && (
        <div className={`p-3 rounded-xl flex items-start gap-3 border text-sm font-medium ${message.type === 'success' ? 'bg-green-500/10 border-green-500/20 text-green-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>
          {message.type === 'success' ? <CheckCircle2 size={16} className="shrink-0 mt-0.5" /> : <AlertCircle size={16} className="shrink-0 mt-0.5" />}
          {message.text}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <Filter size={13} className={st} />
        {(['all', 'critical', 'moderate', 'healthy'] as const).map(f => (
          <button key={f} onClick={() => setUrgencyFilter(f)}
            className={`text-xs px-3 py-1 rounded-lg font-semibold capitalize transition-all border ${urgencyFilter === f ? 'bg-[#7367f0] text-white border-[#7367f0]' : isDark ? 'border-[#2a3250] text-[#5a6a8a] hover:text-white' : 'border-gray-200 text-gray-500 hover:text-gray-900'}`}>
            {f}
          </button>
        ))}
        <button onClick={() => setActionRequiredOnly(v => !v)}
          className={`text-xs px-3 py-1 rounded-lg font-semibold transition-all border ${actionRequiredOnly ? 'bg-amber-500/20 text-amber-400 border-amber-500/30' : isDark ? 'border-[#2a3250] text-[#5a6a8a] hover:text-white' : 'border-gray-200 text-gray-500 hover:text-gray-900'}`}>
          Action Required Only
        </button>
      </div>

      {/* Bulk action */}
      {selectedCount > 0 && (
        <div className={`flex items-center justify-between p-4 rounded-xl border ${isDark ? 'bg-[#7367f0]/10 border-[#7367f0]/30' : 'bg-violet-50 border-violet-200'}`}>
          <span className="text-xs text-[#7367f0] font-semibold">{selectedCount} items selected</span>
          <button onClick={handleCreateDraftPO} disabled={loading} className="flex items-center gap-2 btn-primary text-xs px-4 py-2">
            <ShoppingCart size={14} /> Generate Draft Purchase Order
          </button>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-24">
          <RefreshCw size={32} className="animate-spin text-[#7367f0]" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <AlertCircle size={40} className="text-[#2a3250]" />
          <p className={`text-sm ${st}`}>No records. Click Recalculate to generate pipeline.</p>
        </div>
      ) : (
        <div className={`${card} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th className={`${th} w-10`}>
                    <input type="checkbox"
                      checked={filtered.length > 0 && filtered.filter(i => i.order_now_qty > 0).every(i => i.selected)}
                      onChange={e => handleSelectAll(e.target.checked)} className="rounded" />
                  </th>
                  <th className={th}>Product / SKU</th>
                  <th className={`${th} text-right`}>Main Stock</th>
                  <th className={`${th} text-right`}>Incoming</th>
                  <th className={`${th} text-right`}>Daily Sales</th>
                  <th className={`${th} text-right`}>Days in Hand</th>
                  <th className={`${th} text-right`}>Pipeline Low</th>
                  <th className={`${th} text-right`}>Order Now</th>
                  <th className={`${th} text-right`}>Next Order Qty</th>
                  <th className={`${th} text-right`}>Reorder Qty</th>
                  <th className={`${th} text-right`}>Reorder By</th>
                  <th className={`${th} text-right`}>Next Order Date</th>
                  <th className={`${th} text-center`}>Status</th>
                </tr>
              </thead>
              <tbody className={`divide-y text-sm ${isDark ? 'divide-[#2a3250]' : 'divide-gray-100'}`}>
                {filtered.map(item => (
                  <tr key={item.id} className={`transition-colors ${isDark ? 'hover:bg-white/[0.03]' : 'hover:bg-gray-50'} ${item.selected ? 'bg-[#7367f0]/5' : ''}`}>
                    <td className="py-3 px-4">
                      {item.order_now_qty > 0 && (
                        <input type="checkbox" checked={!!item.selected} onChange={() => handleToggle(item.id)} className="rounded" />
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <div className={`font-semibold ${pt}`}>
                        {Array.isArray(item.product_id) ? item.product_id[1] : (item.sku || '--')}
                      </div>
                      {item.sku && <div className={`text-[10px] mt-0.5 ${st}`}>{item.sku}</div>}
                      {item.action_required && (
                        <span className="text-[9px] bg-amber-500/15 text-amber-400 border border-amber-500/25 px-1.5 py-0.5 rounded font-bold mt-1 inline-block">ACTION</span>
                      )}
                    </td>
                    <td className={`py-3 px-4 text-right font-medium ${pt}`}>{item.physical_stock}</td>
                    <td className={`py-3 px-4 text-right ${st}`}>
                      {item.incoming_qty || 0}
                      {item.next_po_arrival_date && <div className={`text-[10px] ${st}`}>ETA: {item.next_po_arrival_date}</div>}
                    </td>
                    <td className={`py-3 px-4 text-right ${st}`}>{(Number(item.daily_avg_sales) || 0).toFixed(1)}</td>
                    <td className={`py-3 px-4 text-right ${st}`}>
                      {item.days_in_hand}d
                      {item.stockout_date && <div className={`text-[10px] ${st}`}>SO: {item.stockout_date}</div>}
                    </td>
                    <td className={`py-3 px-4 text-right ${
                      item.pipeline_lowest_days < 0
                        ? 'text-red-400 font-semibold'
                        : item.pipeline_lowest_days < item.lead_time_days
                        ? 'text-amber-400 font-semibold'
                        : st
                    }`}>
                      {Number(item.pipeline_lowest_days) === 999 ? '--' : `${Number(item.pipeline_lowest_days).toFixed(1)}d`}
                    </td>
                    <td className="py-3 px-4 text-right font-extrabold text-[#7367f0]">
                      {item.order_now_qty > 0 ? item.order_now_qty : <span className="text-xs text-green-400 font-medium">0</span>}
                    </td>
                    <td className={`py-3 px-4 text-right ${st}`}>{item.next_order_qty || '--'}</td>
                    <td className={`py-3 px-4 text-right ${st}`}>{item.reorder_qty || '--'}</td>
                    <td className={`py-3 px-4 text-right text-xs ${st}`}>{item.reorder_trigger_date || '--'}</td>
                    <td className={`py-3 px-4 text-right text-xs ${st}`}>{item.next_order_date || '--'}</td>
                    <td className="py-3 px-4 text-center">
                      <span className={`inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                        item.urgency === 'critical' ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
                        item.urgency === 'moderate' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                        'bg-green-500/10 text-green-400 border border-green-500/20'
                      }`}>{item.urgency}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
