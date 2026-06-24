import React, { useState, useEffect } from 'react';
import { useTheme } from '../../../context/ThemeContext';
import { useAuth } from '../../../context/AuthContext';
import { searchRead, createRecord, odooCall } from '../../../services/odoo';
import BulkDeleteBar from '../../ui/BulkDeleteBar';
import {
  Plus, RefreshCw, Search, Eye, CheckCircle, X, ArrowRight,
  Truck, PackageCheck, PackageOpen, ArrowLeftRight, Package, Ban, Trash2
} from 'lucide-react';

interface Transfer {
  id: number;
  name: string;
  origin: string | false;
  location_id: [number, string] | false;
  location_dest_id: [number, string] | false;
  picking_type_code: 'incoming' | 'outgoing' | 'internal';
  scheduled_date: string;
  state: 'draft' | 'waiting' | 'confirmed' | 'assigned' | 'done' | 'cancel';
}

interface MoveLine {
  id: number;
  product_id: [number, string] | false;
  product_uom_qty: number;
  quantity: number;
  state: string;
}

interface PickingType { id: number; name: string; code: string; default_location_src_id: [number, string] | false; default_location_dest_id: [number, string] | false; }
interface Location { id: number; complete_name: string; }
interface Product { id: number; name: string; uom_id: [number, string] | false; default_code: string; }
interface FormLine { product_id: number | ''; product_name: string; uom_id: number | ''; qty: number; }

const STATE_STYLE: Record<string, { label: string; badge: string }> = {
  draft: { label: 'Draft', badge: 'badge-gray' },
  waiting: { label: 'Waiting', badge: 'badge-gold' },
  confirmed: { label: 'Confirmed', badge: 'badge-blue' },
  assigned: { label: 'Ready', badge: 'badge-violet' },
  done: { label: 'Done', badge: 'badge-green' },
  cancel: { label: 'Cancelled', badge: 'badge-red' },
};

export default function Transfers() {
  const { isDark } = useTheme();
  const { user } = useAuth();
  const isAdmin = !!user?.is_admin;
  const [selIds, setSelIds] = useState<Set<number>>(new Set());
  const [items, setItems] = useState<Transfer[]>(() => {
    try { const c = localStorage.getItem('portal_inventory_transfers'); return c ? JSON.parse(c) : []; } catch { return []; }
  });
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [detailItem, setDetailItem] = useState<Transfer | null>(null);
  const [detailLines, setDetailLines] = useState<MoveLine[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);

  // Ref data
  const [pickingTypes, setPickingTypes] = useState<PickingType[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [activeProdLine, setActiveProdLine] = useState<number | null>(null);
  const [prodSearch, setProdSearch] = useState('');

  const [form, setForm] = useState({
    picking_type_id: '' as number | '',
    location_id: '' as number | '',
    location_dest_id: '' as number | '',
    origin: '',
    scheduled_date: new Date().toISOString().slice(0, 10),
  });
  const [lines, setLines] = useState<FormLine[]>([{ product_id: '', product_name: '', uom_id: '', qty: 1 }]);

  const showMsg = (ok: boolean, msg: string) => { setToast({ ok, msg }); setTimeout(() => setToast(null), 6000); };

  const syncData = async () => {
    setLoading(true);
    try {
      const r = await searchRead<Transfer>('stock.picking', {
        domain: [],
        fields: ['id', 'name', 'origin', 'location_id', 'location_dest_id', 'scheduled_date', 'state', 'picking_type_code'],
        limit: 0, order: 'id desc',
      });
      if (Array.isArray(r)) {
        setItems(r);
        try { localStorage.setItem('portal_inventory_transfers', JSON.stringify(r)); } catch { /* quota */ }
      }
    } catch (e: any) { showMsg(false, 'Sync failed: ' + e.message); }
    finally { setLoading(false); }
  };

  const loadRefs = async () => {
    const [pt, loc] = await Promise.allSettled([
      searchRead<PickingType>('stock.picking.type', { fields: ['id', 'name', 'code', 'default_location_src_id', 'default_location_dest_id'], limit: 0 }),
      searchRead<Location>('stock.location', { fields: ['id', 'complete_name'], domain: [['usage', 'in', ['internal', 'supplier', 'customer', 'transit']]], limit: 0 }),
    ]);
    if (pt.status === 'fulfilled') {
      setPickingTypes(pt.value || []);
      if (pt.value?.length) applyPickingType(pt.value[0]);
    }
    if (loc.status === 'fulfilled') setLocations(loc.value || []);
  };

  const applyPickingType = (t: PickingType) => {
    setForm(f => ({
      ...f,
      picking_type_id: t.id,
      location_id: Array.isArray(t.default_location_src_id) ? t.default_location_src_id[0] : '',
      location_dest_id: Array.isArray(t.default_location_dest_id) ? t.default_location_dest_id[0] : '',
    }));
  };

  const searchProducts = async (q: string) => {
    if (!q || q.length < 2) { setProducts([]); return; }
    const r = await searchRead<Product>('product.product', {
      fields: ['id', 'name', 'uom_id', 'default_code'],
      domain: [['active', '=', true], '|', ['name', 'ilike', q], ['default_code', 'ilike', q]],
      limit: 15,
    });
    setProducts(r || []);
  };

  useEffect(() => { syncData(); loadRefs(); }, []);

  // ---- Workflow ----

  const validatePicking = async (pickId: number) => {
    try { await odooCall('stock.picking', 'action_assign', [[pickId]], {}); } catch { /* ignore */ }
    const moves = await searchRead<any>('stock.move', {
      domain: [['picking_id', '=', pickId]], fields: ['id', 'product_uom_qty'], limit: 0,
    });
    for (const mv of moves) {
      await odooCall('stock.move', 'write', [[mv.id], { quantity: mv.product_uom_qty, picked: true }], {});
    }
    const res: any = await odooCall('stock.picking', 'button_validate', [[pickId]], {});
    if (res && typeof res === 'object' && res.res_model === 'stock.backorder.confirmation') {
      const wid = await createRecord('stock.backorder.confirmation', { pick_ids: [[6, 0, [pickId]]] });
      await odooCall('stock.backorder.confirmation', 'process', [[wid]], {});
    }
  };

  const handleValidate = async (t: Transfer) => {
    setBusyId(t.id);
    try {
      await validatePicking(t.id);
      showMsg(true, t.name + ' validated -- stock moved.');
      await syncData();
      if (detailItem?.id === t.id) closeDetail();
    } catch (e: any) { showMsg(false, 'Validate failed: ' + e.message); }
    finally { setBusyId(null); }
  };

  const handleAssign = async (t: Transfer) => {
    setBusyId(t.id);
    try {
      await odooCall('stock.picking', 'action_assign', [[t.id]], {});
      showMsg(true, t.name + ' -- stock reserved.');
      await syncData();
    } catch (e: any) { showMsg(false, 'Reserve failed: ' + e.message); }
    finally { setBusyId(null); }
  };

  const handleCancel = async (t: Transfer) => {
    setBusyId(t.id);
    try {
      await odooCall('stock.picking', 'action_cancel', [[t.id]], {});
      showMsg(true, t.name + ' cancelled.');
      await syncData();
      if (detailItem?.id === t.id) closeDetail();
    } catch (e: any) { showMsg(false, 'Cancel failed: ' + e.message); }
    finally { setBusyId(null); }
  };

  // ---- Create ----

  const handleCreate = async () => {
    if (!form.picking_type_id || !form.location_id || !form.location_dest_id) {
      showMsg(false, 'Operation type and locations are required.'); return;
    }
    const valid = lines.filter(l => l.product_id && l.qty > 0);
    if (!valid.length) { showMsg(false, 'Add at least one product line.'); return; }
    setSubmitting(true);
    try {
      const moves = valid.map(l => [0, 0, {
        name: l.product_name,
        product_id: l.product_id,
        product_uom_qty: l.qty,
        product_uom: l.uom_id || undefined,
        location_id: form.location_id,
        location_dest_id: form.location_dest_id,
      }]);
      const id = await createRecord('stock.picking', {
        picking_type_id: form.picking_type_id,
        location_id: form.location_id,
        location_dest_id: form.location_dest_id,
        origin: form.origin || false,
        scheduled_date: form.scheduled_date + ' 00:00:00',
        move_ids_without_package: moves,
      });
      // Confirm so it reserves and becomes actionable
      try { await odooCall('stock.picking', 'action_confirm', [[id]], {}); } catch { /* ignore */ }
      showMsg(true, 'Transfer created and confirmed.');
      setShowCreate(false);
      resetForm();
      syncData();
    } catch (e: any) { showMsg(false, 'Create failed: ' + e.message); }
    finally { setSubmitting(false); }
  };

  const resetForm = () => {
    if (pickingTypes.length) applyPickingType(pickingTypes[0]);
    setForm(f => ({ ...f, origin: '', scheduled_date: new Date().toISOString().slice(0, 10) }));
    setLines([{ product_id: '', product_name: '', uom_id: '', qty: 1 }]);
    setProducts([]); setActiveProdLine(null);
  };

  const updateLine = (idx: number, patch: Partial<FormLine>) => setLines(p => p.map((l, i) => i === idx ? { ...l, ...patch } : l));

  // ---- Detail ----

  const openDetail = async (t: Transfer) => {
    setDetailItem(t);
    setDetailLines([]);
    try {
      const ls = await searchRead<MoveLine>('stock.move', {
        domain: [['picking_id', '=', t.id]], fields: ['id', 'product_id', 'product_uom_qty', 'quantity', 'state'], limit: 0,
      });
      setDetailLines(ls || []);
    } catch { /* ignore */ }
  };
  const closeDetail = () => { setDetailItem(null); setDetailLines([]); };

  // ---- Derived ----

  const filtered = items.filter(t => {
    const name = t.name || '';
    const origin = (t.origin || '') as string;
    const lf = Array.isArray(t.location_id) ? t.location_id[1] : '';
    const lt = Array.isArray(t.location_dest_id) ? t.location_dest_id[1] : '';
    const ms = !search || [name, origin, lf, lt].some(v => v.toLowerCase().includes(search.toLowerCase()));
    const matchState = stateFilter === 'all' || t.state === stateFilter;
    const matchType = typeFilter === 'all' || t.picking_type_code === typeFilter;
    return ms && matchState && matchType;
  });

  const today = new Date().toISOString().split('T')[0];
  const readyCount = items.filter(t => t.state === 'assigned').length;
  const inTransitCount = items.filter(t => t.state === 'confirmed').length;
  const doneToday = items.filter(t => t.state === 'done' && String(t.scheduled_date || '').startsWith(today)).length;

  const m2o = (x: any) => Array.isArray(x) ? x[1] : '--';
  const ic = `input text-xs py-2 ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`;
  const modalBg = `w-full rounded-2xl shadow-2xl border ${isDark ? 'bg-[#161b2e] border-[#2a3250]' : 'bg-white border-gray-200'}`;
  const modalHeader = `flex items-center justify-between p-5 border-b ${isDark ? 'border-[#2a3250]' : 'border-gray-200'}`;
  const modalFooter = `flex justify-end gap-3 p-5 border-t ${isDark ? 'border-[#2a3250]' : 'border-gray-200'}`;
  const st = isDark ? 'text-[#5a6a8a]' : 'text-gray-400';
  const pt = isDark ? 'text-white' : 'text-gray-900';

  const typeColors: Record<string, string> = {
    incoming: 'text-green-400 bg-green-500/10',
    outgoing: 'text-blue-400 bg-blue-500/10',
    internal: 'text-violet-400 bg-violet-500/10',
  };
  const typeLabels: Record<string, string> = { incoming: 'Incoming', outgoing: 'Outgoing', internal: 'Internal' };
  const TypeIconMap: Record<string, React.ReactNode> = {
    incoming: <PackageOpen size={10} />, outgoing: <Truck size={10} />, internal: <ArrowLeftRight size={10} />,
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
          <h1 className={`text-xl font-black ${pt}`}>Stock Transfers & Pickings</h1>
          <p className={`text-xs mt-0.5 ${st}`}>Manage incoming, outgoing and internal stock movements</p>
        </div>
        <div className="flex gap-2">
          <button onClick={syncData} disabled={loading} className="btn-secondary text-xs px-3 py-2">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Sync
          </button>
          <button onClick={() => { resetForm(); setShowCreate(true); }} className="btn-primary text-xs px-3 py-2">
            <Plus size={13} /> Create Transfer
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Transfers', value: items.length, icon: Package, color: 'text-[#7367f0]', bg: 'bg-[#7367f0]/10' },
          { label: 'Ready', value: readyCount, icon: CheckCircle, color: 'text-violet-400', bg: 'bg-violet-500/10' },
          { label: 'In Transit', value: inTransitCount, icon: Truck, color: 'text-blue-400', bg: 'bg-blue-500/10' },
          { label: 'Done Today', value: doneToday, icon: PackageCheck, color: 'text-green-400', bg: 'bg-green-500/10' },
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
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search transfer ref, source doc, location..."
            className={`input pl-9 text-xs py-2 ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`} />
        </div>
        <select value={stateFilter} onChange={e => setStateFilter(e.target.value)} className={ic}>
          <option value="all">All States</option>
          <option value="draft">Draft</option>
          <option value="waiting">Waiting</option>
          <option value="confirmed">Confirmed</option>
          <option value="assigned">Ready</option>
          <option value="done">Done</option>
          <option value="cancel">Cancelled</option>
        </select>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className={ic}>
          <option value="all">All Types</option>
          <option value="incoming">Incoming</option>
          <option value="outgoing">Outgoing</option>
          <option value="internal">Internal</option>
        </select>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-40 gap-3">
            <RefreshCw size={18} className="animate-spin text-[#7367f0]" />
            <span className={`text-sm ${st}`}>Loading transfers...</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table w-full">
              <thead>
                <tr>
                  {isAdmin && <th className="w-8"><input type="checkbox" className="rounded" checked={items.length > 0 && items.every(i => selIds.has(i.id))} onChange={e => setSelIds(e.target.checked ? new Set(items.map(i => i.id)) : new Set())} /></th>}
                  <th>Transfer Ref</th><th>Source Doc</th><th>From / To</th><th>Type</th>
                  <th>Date</th><th className="text-center">State</th><th className="text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(t => {
                  const busy = busyId === t.id;
                  return (
                    <tr key={t.id} className={selIds.has(t.id) ? isDark ? 'bg-[#7367f0]/5' : 'bg-violet-50' : ''}>
                      {isAdmin && <td><input type="checkbox" className="rounded" checked={selIds.has(t.id)} onChange={() => setSelIds(prev => { const n = new Set(prev); n.has(t.id) ? n.delete(t.id) : n.add(t.id); return n; })} /></td>}
                      <td className="font-mono text-xs font-semibold text-[#7367f0]">{t.name}</td>
                      <td className={`text-xs ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>{t.origin || '--'}</td>
                      <td>
                        <div className="flex items-center gap-1.5 text-xs flex-wrap">
                          <span className={isDark ? 'text-gray-300' : 'text-gray-700'}>{m2o(t.location_id)}</span>
                          <ArrowRight size={11} className="text-[#7367f0] shrink-0" />
                          <span className={isDark ? 'text-gray-300' : 'text-gray-700'}>{m2o(t.location_dest_id)}</span>
                        </div>
                      </td>
                      <td>
                        <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${typeColors[t.picking_type_code] || 'text-gray-400 bg-gray-500/10'}`}>
                          {TypeIconMap[t.picking_type_code]}
                          {typeLabels[t.picking_type_code] || t.picking_type_code}
                        </span>
                      </td>
                      <td className={`text-xs ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>
                        {t.scheduled_date ? String(t.scheduled_date).split(' ')[0] : '--'}
                      </td>
                      <td className="text-center">
                        <span className={`badge ${STATE_STYLE[t.state]?.badge || 'badge-gray'}`}>
                          {STATE_STYLE[t.state]?.label || t.state}
                        </span>
                      </td>
                      <td className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => openDetail(t)}
                            className={`p-1.5 rounded-lg transition-colors ${isDark ? 'hover:bg-white/5 text-[#5a6a8a] hover:text-white' : 'hover:bg-gray-100 text-gray-400 hover:text-gray-700'}`}
                            title="View Detail"><Eye size={13} /></button>
                          {['confirmed', 'assigned'].includes(t.state) && (
                            <button disabled={busy} onClick={() => handleValidate(t)}
                              className="p-1.5 rounded-lg transition-colors text-green-400 hover:bg-green-500/10" title="Validate Transfer">
                              {busy ? <RefreshCw size={13} className="animate-spin" /> : <CheckCircle size={13} />}
                            </button>
                          )}
                          {['draft', 'waiting', 'confirmed', 'assigned'].includes(t.state) && (
                            <button disabled={busy} onClick={() => handleCancel(t)}
                              className="p-1.5 rounded-lg transition-colors text-red-400 hover:bg-red-500/10" title="Cancel Transfer">
                              {busy ? <RefreshCw size={13} className="animate-spin" /> : <Ban size={13} />}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={isAdmin ? 8 : 7} className="text-center py-10">
                    <Package size={32} className={`mx-auto mb-2 ${isDark ? 'text-[#2a3250]' : 'text-gray-200'}`} />
                    <p className={`text-xs ${st}`}>No transfers found</p>
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <BulkDeleteBar model="stock.picking" label="transfer" ids={Array.from(selIds)}
        onClear={() => setSelIds(new Set())} onDeleted={() => { setSelIds(new Set()); syncData(); }} />

      {/* Detail Modal */}
      {detailItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={closeDetail}>
          <div className={`${modalBg} max-w-2xl max-h-[90vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
            <div className={modalHeader}>
              <div>
                <h2 className={`text-base font-black ${pt}`}>{detailItem.name}</h2>
                <p className={`text-xs mt-0.5 ${st}`}>{detailItem.origin ? `Source: ${detailItem.origin}` : 'No source document'}</p>
              </div>
              <button onClick={closeDetail} className={`p-2 rounded-lg ${isDark ? 'hover:bg-white/5 text-[#5a6a8a]' : 'hover:bg-gray-100 text-gray-400'}`}><X size={16} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {[
                  { label: 'From Location', value: m2o(detailItem.location_id) },
                  { label: 'To Location', value: m2o(detailItem.location_dest_id) },
                  { label: 'Type', value: typeLabels[detailItem.picking_type_code] || detailItem.picking_type_code },
                  { label: 'State', value: STATE_STYLE[detailItem.state]?.label || detailItem.state },
                  { label: 'Date', value: detailItem.scheduled_date ? String(detailItem.scheduled_date).split(' ')[0] : '--' },
                ].map(f => (
                  <div key={f.label}>
                    <p className={`text-[10px] font-semibold uppercase tracking-wider mb-0.5 ${st}`}>{f.label}</p>
                    <p className={`text-xs font-semibold ${pt}`}>{f.value}</p>
                  </div>
                ))}
              </div>
              <div>
                <p className={`text-[10px] font-semibold uppercase tracking-wider mb-2 ${st}`}>Move Lines</p>
                <div className={`rounded-xl border overflow-hidden ${isDark ? 'border-[#2a3250]' : 'border-gray-200'}`}>
                  <table className="data-table w-full">
                    <thead>
                      <tr><th>Product</th><th className="text-right">Demand</th><th className="text-right">Done</th><th className="text-center">Status</th></tr>
                    </thead>
                    <tbody>
                      {detailLines.map(line => (
                        <tr key={line.id}>
                          <td className={`text-xs font-medium ${pt}`}>{m2o(line.product_id)}</td>
                          <td className="text-right text-xs">{line.product_uom_qty}</td>
                          <td className={`text-right text-xs font-semibold ${line.quantity >= line.product_uom_qty ? 'text-green-400' : 'text-amber-400'}`}>{line.quantity}</td>
                          <td className="text-center">
                            {line.state === 'done'
                              ? <span className="badge badge-green">Complete</span>
                              : <span className="badge badge-gray">{line.state}</span>}
                          </td>
                        </tr>
                      ))}
                      {detailLines.length === 0 && (
                        <tr><td colSpan={4} className={`text-center text-xs py-4 ${st}`}>No move lines.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            <div className={modalFooter}>
              <button onClick={closeDetail} className="btn-secondary text-xs px-4 py-2">Close</button>
              {detailItem.state === 'draft' && (
                <button disabled={busyId === detailItem.id} onClick={() => handleAssign(detailItem)} className="btn-secondary text-xs px-4 py-2">
                  <PackageCheck size={13} /> Reserve
                </button>
              )}
              {['confirmed', 'assigned'].includes(detailItem.state) && (
                <button disabled={busyId === detailItem.id} onClick={() => handleValidate(detailItem)} className="btn-primary text-xs px-4 py-2">
                  {busyId === detailItem.id ? <RefreshCw size={13} className="animate-spin" /> : <CheckCircle size={13} />} Validate Transfer
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setShowCreate(false)}>
          <div className={`${modalBg} max-w-2xl max-h-[90vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
            <div className={`${modalHeader} sticky top-0 z-10 ${isDark ? 'bg-[#161b2e]' : 'bg-white'}`}>
              <h2 className={`text-base font-black ${pt}`}>Create Transfer</h2>
              <button onClick={() => setShowCreate(false)} className={`p-2 rounded-lg ${isDark ? 'hover:bg-white/5 text-[#5a6a8a]' : 'hover:bg-gray-100 text-gray-400'}`}><X size={16} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="label mb-1 block">Operation Type *</label>
                <select value={form.picking_type_id}
                  onChange={e => { const t = pickingTypes.find(p => p.id === Number(e.target.value)); if (t) applyPickingType(t); }}
                  className={`${ic} w-full`}>
                  {pickingTypes.map(t => <option key={t.id} value={t.id}>{t.name} ({t.code})</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label mb-1 block">From Location *</label>
                  <select value={form.location_id} onChange={e => setForm(f => ({ ...f, location_id: Number(e.target.value) }))} className={`${ic} w-full`}>
                    <option value="">-- Select --</option>
                    {locations.map(l => <option key={l.id} value={l.id}>{l.complete_name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label mb-1 block">To Location *</label>
                  <select value={form.location_dest_id} onChange={e => setForm(f => ({ ...f, location_dest_id: Number(e.target.value) }))} className={`${ic} w-full`}>
                    <option value="">-- Select --</option>
                    {locations.map(l => <option key={l.id} value={l.id}>{l.complete_name}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label mb-1 block">Source Document</label>
                  <input value={form.origin} onChange={e => setForm(f => ({ ...f, origin: e.target.value }))} placeholder="e.g. PO/2026/0099" className={`${ic} w-full`} />
                </div>
                <div>
                  <label className="label mb-1 block">Scheduled Date</label>
                  <input type="date" value={form.scheduled_date} onChange={e => setForm(f => ({ ...f, scheduled_date: e.target.value }))} className={`${ic} w-full`} />
                </div>
              </div>

              {/* Product Lines */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="label">Products *</label>
                  <button type="button" onClick={() => setLines(p => [...p, { product_id: '', product_name: '', uom_id: '', qty: 1 }])}
                    className="text-xs text-[#7367f0] font-semibold flex items-center gap-1 hover:underline"><Plus size={11} /> Add Line</button>
                </div>
                <div className={`rounded-xl border overflow-hidden ${isDark ? 'border-[#2a3250]' : 'border-gray-200'}`}>
                  <table className="w-full">
                    <thead>
                      <tr className={`text-[10px] font-bold uppercase tracking-wider ${isDark ? 'bg-[#1e2440] text-[#5a6a8a]' : 'bg-gray-50 text-gray-500'}`}>
                        <th className="px-3 py-2 text-left">Product</th>
                        <th className="px-3 py-2 text-right w-24">Quantity</th>
                        <th className="px-3 py-2 w-8"></th>
                      </tr>
                    </thead>
                    <tbody className={`divide-y ${isDark ? 'divide-[#2a3250]' : 'divide-gray-100'}`}>
                      {lines.map((line, idx) => (
                        <tr key={idx}>
                          <td className="px-3 py-2">
                            <div className="relative">
                              <input value={activeProdLine === idx ? prodSearch : line.product_name}
                                onChange={e => { setProdSearch(e.target.value); setActiveProdLine(idx); updateLine(idx, { product_id: '', product_name: '' }); searchProducts(e.target.value); }}
                                onFocus={() => setActiveProdLine(idx)}
                                placeholder="Search product..."
                                className={`input text-xs py-1.5 w-full ${isDark ? 'bg-[#12172a] border-[#2a3250] text-white' : ''}`} />
                              {activeProdLine === idx && products.length > 0 && !line.product_id && (
                                <div className={`absolute z-30 w-full rounded-xl border shadow-xl mt-1 max-h-36 overflow-y-auto ${isDark ? 'bg-[#1e2440] border-[#2a3250]' : 'bg-white border-gray-200'}`}>
                                  {products.map(p => (
                                    <button key={p.id} type="button" className={`w-full text-left px-3 py-1.5 text-xs hover:bg-[#7367f0]/10 ${isDark ? 'text-white' : 'text-gray-800'}`}
                                      onClick={() => { updateLine(idx, { product_id: p.id, product_name: p.name, uom_id: Array.isArray(p.uom_id) ? p.uom_id[0] : '' }); setActiveProdLine(null); setProducts([]); }}>
                                      <span className="font-semibold">{p.name}</span>
                                      {p.default_code && <span className={`ml-1 text-[10px] ${st}`}>[{p.default_code}]</span>}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <input type="number" min="1" step="1" value={line.qty} onChange={e => updateLine(idx, { qty: Number(e.target.value) })}
                              className={`input text-xs py-1.5 text-right w-full ${isDark ? 'bg-[#12172a] border-[#2a3250] text-white' : ''}`} />
                          </td>
                          <td className="px-3 py-2 text-center">
                            {lines.length > 1 && <button type="button" onClick={() => setLines(p => p.filter((_, i) => i !== idx))} className="text-red-400 hover:text-red-300"><Trash2 size={12} /></button>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            <div className={modalFooter}>
              <button onClick={() => setShowCreate(false)} className="btn-secondary text-xs px-4 py-2">Cancel</button>
              <button onClick={handleCreate} disabled={submitting} className="btn-primary text-xs px-4 py-2">
                {submitting ? <RefreshCw size={13} className="animate-spin" /> : <Plus size={13} />}
                {submitting ? 'Creating...' : 'Create & Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
