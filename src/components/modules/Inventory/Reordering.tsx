import React, { useState, useEffect } from 'react';
import { useTheme } from '../../../context/ThemeContext';
import { searchRead, createRecord, writeRecord, odooCall } from '../../../services/odoo';
import {
  Plus, RefreshCw, Search, X, Play, ShoppingCart,
  AlertTriangle, Activity, CheckCircle, Settings, Trash2
} from 'lucide-react';

interface ReorderRule {
  id: number;
  product_id: [number, string] | false;
  warehouse_id: [number, string] | false;
  location_id: [number, string] | false;
  product_min_qty: number;
  product_max_qty: number;
  qty_on_hand: number;
  qty_to_order: number;
}

interface Product { id: number; name: string; default_code: string; }
interface Warehouse { id: number; name: string; lot_stock_id: [number, string] | false; }

function urgencyOf(r: ReorderRule): 'critical' | 'moderate' | 'ok' {
  if (r.qty_on_hand < r.product_min_qty) return 'critical';
  if (r.qty_on_hand < r.product_min_qty * 1.3) return 'moderate';
  return 'ok';
}

const URGENCY_BADGE: Record<string, string> = { critical: 'badge-red', moderate: 'badge-gold', ok: 'badge-green' };
const URGENCY_LABEL: Record<string, string> = { critical: 'Critical', moderate: 'Moderate', ok: 'OK' };

export default function Reordering() {
  const { isDark } = useTheme();
  const [rules, setRules] = useState<ReorderRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [schedulerRunning, setSchedulerRunning] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);
  const [search, setSearch] = useState('');
  const [urgencyFilter, setUrgencyFilter] = useState('all');
  const [warehouseFilter, setWarehouseFilter] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Refs
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [prodSearch, setProdSearch] = useState('');
  const [showProdDrop, setShowProdDrop] = useState(false);

  const [form, setForm] = useState({
    product_id: '' as number | '',
    product_name: '',
    warehouse_id: '' as number | '',
    product_min_qty: 50,
    product_max_qty: 300,
  });

  const showMsg = (ok: boolean, msg: string) => { setToast({ ok, msg }); setTimeout(() => setToast(null), 5000); };

  const syncData = async () => {
    setLoading(true);
    try {
      const r = await searchRead<ReorderRule>('stock.warehouse.orderpoint', {
        domain: [],
        fields: ['id', 'product_id', 'warehouse_id', 'location_id', 'product_min_qty', 'product_max_qty', 'qty_on_hand', 'qty_to_order'],
        limit: 0, order: 'id desc',
      });
      if (Array.isArray(r)) setRules(r);
    } catch (e: any) { showMsg(false, 'Sync failed: ' + e.message); }
    finally { setLoading(false); }
  };

  const loadRefs = async () => {
    const [whs] = await Promise.allSettled([
      searchRead<Warehouse>('stock.warehouse', { fields: ['id', 'name', 'lot_stock_id'], limit: 0 }),
    ]);
    if (whs.status === 'fulfilled') {
      setWarehouses(whs.value || []);
      if (whs.value?.length) setForm(f => ({ ...f, warehouse_id: whs.value[0].id }));
    }
  };

  const searchProducts = async (q: string) => {
    if (!q || q.length < 2) { setProducts([]); return; }
    const r = await searchRead<Product>('product.product', {
      fields: ['id', 'name', 'default_code'],
      domain: [['active', '=', true], ['type', '=', 'consu'], '|', ['name', 'ilike', q], ['default_code', 'ilike', q]],
      limit: 15,
    });
    setProducts(r || []);
  };

  useEffect(() => { syncData(); loadRefs(); }, []);

  // ---- Inline min/max edit ----
  const saveQty = async (rule: ReorderRule, field: 'product_min_qty' | 'product_max_qty', value: number) => {
    if (value === rule[field]) return;
    setRules(prev => prev.map(r => r.id === rule.id ? { ...r, [field]: value } : r));
    try {
      await writeRecord('stock.warehouse.orderpoint', [rule.id], { [field]: value });
    } catch (e: any) { showMsg(false, 'Update failed: ' + e.message); syncData(); }
  };

  // ---- Run scheduler / replenish ----
  const runScheduler = async () => {
    setSchedulerRunning(true);
    try {
      // Global procurement scheduler -- computes needs and generates draft POs / moves
      await odooCall('procurement.group', 'run_scheduler', [], {});
      showMsg(true, 'Scheduler run complete -- procurements generated for rules below minimum.');
      await syncData();
    } catch (e: any) { showMsg(false, 'Scheduler failed: ' + e.message); }
    finally { setSchedulerRunning(false); }
  };

  const replenishOne = async (rule: ReorderRule) => {
    setBusyId(rule.id);
    try {
      await odooCall('stock.warehouse.orderpoint', 'action_replenish', [[rule.id]], {});
      const name = Array.isArray(rule.product_id) ? rule.product_id[1] : 'product';
      showMsg(true, 'Replenishment ordered for ' + name + '.');
      await syncData();
    } catch (e: any) { showMsg(false, 'Order failed: ' + e.message); }
    finally { setBusyId(null); }
  };

  const handleDelete = async (rule: ReorderRule) => {
    if (!confirm('Delete this reordering rule?')) return;
    setBusyId(rule.id);
    try {
      await odooCall('stock.warehouse.orderpoint', 'unlink', [[rule.id]], {});
      showMsg(true, 'Rule deleted.');
      setRules(prev => prev.filter(r => r.id !== rule.id));
    } catch (e: any) { showMsg(false, 'Delete failed: ' + e.message); }
    finally { setBusyId(null); }
  };

  // ---- Create ----
  const handleCreate = async () => {
    if (!form.product_id || !form.warehouse_id) { showMsg(false, 'Product and warehouse are required.'); return; }
    setSubmitting(true);
    try {
      const wh = warehouses.find(w => w.id === form.warehouse_id);
      const vals: Record<string, any> = {
        product_id: form.product_id,
        warehouse_id: form.warehouse_id,
        product_min_qty: form.product_min_qty,
        product_max_qty: form.product_max_qty,
      };
      if (wh && Array.isArray(wh.lot_stock_id)) vals.location_id = wh.lot_stock_id[0];
      await createRecord('stock.warehouse.orderpoint', vals);
      showMsg(true, 'Reordering rule created.');
      setShowCreate(false);
      resetForm();
      syncData();
    } catch (e: any) { showMsg(false, 'Create failed: ' + e.message); }
    finally { setSubmitting(false); }
  };

  const resetForm = () => {
    setForm({ product_id: '', product_name: '', warehouse_id: warehouses[0]?.id || '', product_min_qty: 50, product_max_qty: 300 });
    setProdSearch(''); setProducts([]);
  };

  const m2o = (x: any) => Array.isArray(x) ? x[1] : '--';

  const filtered = rules.filter(r => {
    const product = m2o(r.product_id);
    const wh = m2o(r.warehouse_id);
    const ms = !search || product.toLowerCase().includes(search.toLowerCase()) || wh.toLowerCase().includes(search.toLowerCase());
    const u = urgencyOf(r);
    const mu = urgencyFilter === 'all' || u === urgencyFilter;
    const mw = warehouseFilter === 'all' || (Array.isArray(r.warehouse_id) && r.warehouse_id[0] === Number(warehouseFilter));
    return ms && mu && mw;
  });

  const criticalCount = rules.filter(r => urgencyOf(r) === 'critical').length;
  const toOrderCount = rules.filter(r => r.qty_to_order > 0).length;

  const ic = `input text-xs py-2 ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`;
  const qtyInp = `input text-xs py-1 text-right w-20 ${isDark ? 'bg-[#12172a] border-[#2a3250] text-white' : ''}`;
  const modalBg = `w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl shadow-2xl border ${isDark ? 'bg-[#161b2e] border-[#2a3250]' : 'bg-white border-gray-200'}`;
  const modalHeader = `flex items-center justify-between p-5 border-b ${isDark ? 'border-[#2a3250]' : 'border-gray-200'}`;
  const modalFooter = `flex justify-end gap-3 p-5 border-t ${isDark ? 'border-[#2a3250]' : 'border-gray-200'}`;
  const st = isDark ? 'text-[#5a6a8a]' : 'text-gray-400';
  const pt = isDark ? 'text-white' : 'text-gray-900';

  return (
    <div className="space-y-5 animate-fade-in">
      {toast && (
        <div className={`fixed top-5 right-5 z-[100] px-4 py-3 rounded-xl shadow-xl text-sm font-medium flex items-center gap-2 max-w-md
          ${toast.ok ? 'bg-green-500/15 border border-green-500/30 text-green-400' : 'bg-red-500/15 border border-red-500/30 text-red-400'}`}>
          {toast.ok ? <CheckCircle size={14} /> : <X size={14} />} {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className={`text-xl font-black ${pt}`}>Reordering Rules</h1>
          <p className={`text-xs mt-0.5 ${st}`}>Automated min/max replenishment linked to the Odoo scheduler</p>
        </div>
        <div className="flex gap-2">
          <button onClick={syncData} disabled={loading} className="btn-secondary text-xs px-3 py-2">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Sync
          </button>
          <button onClick={runScheduler} disabled={schedulerRunning} className="btn-secondary text-xs px-3 py-2">
            <Play size={13} className={schedulerRunning ? 'animate-pulse' : ''} /> Run Scheduler
          </button>
          <button onClick={() => { resetForm(); setShowCreate(true); }} className="btn-primary text-xs px-3 py-2">
            <Plus size={13} /> Add Rule
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { label: 'Total Rules', value: rules.length, icon: Settings, color: 'text-[#7367f0]', bg: 'bg-[#7367f0]/10' },
          { label: 'Critical (Below Min)', value: criticalCount, icon: AlertTriangle, color: 'text-red-400', bg: 'bg-red-500/10' },
          { label: 'To Order', value: toOrderCount, icon: Activity, color: 'text-green-400', bg: 'bg-green-500/10' },
        ].map(s => (
          <div key={s.label} className="card p-4 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl ${s.bg} flex items-center justify-center`}>
              <s.icon size={18} className={s.color} />
            </div>
            <div>
              <p className={`text-xl font-black ${pt}`}>{s.value}</p>
              <p className={`text-[10px] font-medium ${st}`}>{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="card p-3 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={14} className={`absolute left-3 top-1/2 -translate-y-1/2 ${isDark ? 'text-[#4a5580]' : 'text-gray-400'}`} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search product or warehouse..."
            className={`input pl-9 text-xs py-2 ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`} />
        </div>
        <select value={urgencyFilter} onChange={e => setUrgencyFilter(e.target.value)} className={ic}>
          <option value="all">All Urgency</option>
          <option value="critical">Critical</option>
          <option value="moderate">Moderate</option>
          <option value="ok">OK</option>
        </select>
        <select value={warehouseFilter} onChange={e => setWarehouseFilter(e.target.value)} className={ic}>
          <option value="all">All Warehouses</option>
          {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-40 gap-3">
            <RefreshCw size={18} className="animate-spin text-[#7367f0]" />
            <span className={`text-sm ${st}`}>Loading rules...</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table w-full">
              <thead>
                <tr>
                  <th>Product</th><th>Warehouse</th>
                  <th className="text-right">On Hand</th><th className="text-right">Min Qty</th><th className="text-right">Max Qty</th>
                  <th className="text-right">To Order</th>
                  <th className="text-center">Urgency</th><th className="text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => {
                  const urgency = urgencyOf(r);
                  const busy = busyId === r.id;
                  return (
                    <tr key={r.id}>
                      <td className={`font-semibold text-xs ${pt}`}>{m2o(r.product_id)}</td>
                      <td className={`text-xs ${st}`}>{m2o(r.warehouse_id)}</td>
                      <td className={`text-right text-xs font-semibold ${r.qty_on_hand < r.product_min_qty ? 'text-red-400' : isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                        {r.qty_on_hand}
                      </td>
                      <td className="text-right">
                        <input type="number" min={0} defaultValue={r.product_min_qty}
                          onBlur={e => saveQty(r, 'product_min_qty', Number(e.target.value))}
                          className={qtyInp} title="Editable -- saves on blur" />
                      </td>
                      <td className="text-right">
                        <input type="number" min={0} defaultValue={r.product_max_qty}
                          onBlur={e => saveQty(r, 'product_max_qty', Number(e.target.value))}
                          className={qtyInp} title="Editable -- saves on blur" />
                      </td>
                      <td className={`text-right text-xs font-bold ${r.qty_to_order > 0 ? 'text-red-400' : 'text-green-400'}`}>
                        {r.qty_to_order > 0 ? r.qty_to_order : '--'}
                      </td>
<td className="text-center">
                        <span className={`badge ${URGENCY_BADGE[urgency]}`}>{URGENCY_LABEL[urgency]}</span>
                      </td>
                      <td className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          {r.qty_to_order > 0 && (
                            <button disabled={busy} onClick={() => replenishOne(r)}
                              className="p-1.5 rounded-lg transition-colors text-violet-400 hover:bg-violet-500/10" title="Order Now (replenish)">
                              {busy ? <RefreshCw size={13} className="animate-spin" /> : <ShoppingCart size={13} />}
                            </button>
                          )}
                          <button disabled={busy} onClick={() => handleDelete(r)}
                            className="p-1.5 rounded-lg transition-colors text-red-400 hover:bg-red-500/10" title="Delete Rule">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={9} className="text-center py-10">
                    <CheckCircle size={32} className={`mx-auto mb-2 ${isDark ? 'text-[#2a3250]' : 'text-gray-200'}`} />
                    <p className={`text-xs ${st}`}>No reordering rules found</p>
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setShowCreate(false)}>
          <div className={modalBg} onClick={e => e.stopPropagation()}>
            <div className={modalHeader}>
              <h2 className={`text-base font-black ${pt}`}>Add Reordering Rule</h2>
              <button onClick={() => setShowCreate(false)} className={`p-2 rounded-lg ${isDark ? 'hover:bg-white/5 text-[#5a6a8a]' : 'hover:bg-gray-100 text-gray-400'}`}><X size={16} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="relative">
                <label className="label mb-1 block">Product *</label>
                <input value={form.product_id ? form.product_name : prodSearch}
                  onChange={e => { setProdSearch(e.target.value); setShowProdDrop(true); setForm(f => ({ ...f, product_id: '', product_name: '' })); searchProducts(e.target.value); }}
                  onFocus={() => setShowProdDrop(true)}
                  placeholder="Search storable product..." className={`${ic} w-full`} />
                {showProdDrop && products.length > 0 && !form.product_id && (
                  <div className={`absolute z-20 w-full rounded-xl border shadow-xl mt-1 max-h-40 overflow-y-auto ${isDark ? 'bg-[#1e2440] border-[#2a3250]' : 'bg-white border-gray-200'}`}>
                    {products.map(p => (
                      <button key={p.id} type="button" className={`w-full text-left px-3 py-2 text-xs hover:bg-[#7367f0]/10 ${isDark ? 'text-white' : 'text-gray-800'}`}
                        onClick={() => { setForm(f => ({ ...f, product_id: p.id, product_name: p.name })); setShowProdDrop(false); }}>
                        <span className="font-semibold">{p.name}</span>
                        {p.default_code && <span className={`ml-1 text-[10px] ${st}`}>[{p.default_code}]</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label className="label mb-1 block">Warehouse *</label>
                <select value={form.warehouse_id} onChange={e => setForm(f => ({ ...f, warehouse_id: Number(e.target.value) }))} className={`${ic} w-full`}>
                  {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label mb-1 block">Min Qty</label>
                  <input type="number" min={0} value={form.product_min_qty} onChange={e => setForm(f => ({ ...f, product_min_qty: Number(e.target.value) }))} className={`${ic} w-full`} />
                </div>
                <div>
                  <label className="label mb-1 block">Max Qty</label>
                  <input type="number" min={0} value={form.product_max_qty} onChange={e => setForm(f => ({ ...f, product_max_qty: Number(e.target.value) }))} className={`${ic} w-full`} />
                </div>
              </div>
            </div>
            <div className={modalFooter}>
              <button onClick={() => setShowCreate(false)} className="btn-secondary text-xs px-4 py-2">Cancel</button>
              <button onClick={handleCreate} disabled={submitting || !form.product_id} className="btn-primary text-xs px-4 py-2">
                {submitting ? <RefreshCw size={13} className="animate-spin" /> : <Plus size={13} />} Add Rule
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

