import { useState, useEffect, useMemo } from 'react';
import { searchRead, odooCall, createRecord } from '../../../services/odoo';
import { useTheme } from '../../../context/ThemeContext';
import {
  RefreshCw, Send, AlertCircle, CheckCircle2,
  Zap, Package, ChevronDown, ChevronUp, Warehouse, Download,
} from 'lucide-react';

interface Account { id: number; name: string; }

interface ReplenishmentItem {
  id: number;
  product_id: [number, string] | false;
  sku: string;
  fsn: string;
  warehouse_name: string;
  account_id: [number, string] | false;
  fbf_stock: number;
  sales_7d: number;
  sales_14d: number;
  in_transit: number;
  daily_sales: number;
  qty_to_send: number;
  days_cover_after: number;
  urgency: 'critical' | 'moderate' | 'healthy';
  selected: boolean;
}

interface ListingData {
  fsn: string;
  sku: string;
  listing_id: string;
  selling_price: number;
  bank_settlement: number;
}

function mapItem(r: any): ReplenishmentItem {
  return {
    id: r.id, product_id: r.product_id, sku: r.sku || '', fsn: r.fsn || '',
    warehouse_name: r.warehouse_name || 'Unknown', account_id: r.account_id,
    fbf_stock: r.fbf_stock ?? 0, sales_7d: r.sales_7d ?? 0, sales_14d: r.sales_14d ?? 0,
    in_transit: r.in_transit ?? 0, daily_sales: r.daily_sales ?? 0,
    qty_to_send: r.qty_to_send ?? 0, days_cover_after: r.days_cover_after ?? 0,
    urgency: r.urgency ?? 'healthy', selected: false,
  };
}

const urgencyOrder: Record<string, number> = { critical: 0, moderate: 1, healthy: 2 };

function downloadCsv(wh: string, whItems: ReplenishmentItem[], listingMap: Record<string, ListingData>) {
  const csvItems = whItems.filter(i =>
    (i.urgency === 'critical' || i.urgency === 'moderate') && i.qty_to_send >= 5
  );
  if (!csvItems.length) {
    alert('No critical or moderate items with qty to send in this warehouse.');
    return;
  }
  const header = 'PRODUCT ID,SKU,LISTING ID,SELLING PRICE,QUANTITY,COST PRICE';
  const q = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = csvItems.map(item => {
    const l = listingMap[item.fsn];
    const costPrice = l?.bank_settlement ? Math.round(l.bank_settlement / 1.18) : '';
    return [
      item.fsn,
      l?.sku || item.sku,
      l?.listing_id ?? '',
      l?.selling_price ?? '',
      item.qty_to_send,
      costPrice,
    ].map(q).join(',');
  });
  const csv = [header, ...rows].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `FBF_${wh.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function FbfReplenishment() {
  const { isDark } = useTheme();
  const [items, setItems] = useState<ReplenishmentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [consigning, setConsigning] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountFilter, setAccountFilter] = useState<number | 'all'>('all');
  const [warehouseFilter, setWarehouseFilter] = useState<string>('all');
  // Multi-select urgency: empty set = "all"
  const [urgencyFilters, setUrgencyFilters] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [listingMap, setListingMap] = useState<Record<string, ListingData>>({});

  const cardBg = isDark ? 'bg-[#161b2e] border-[#2a3250]' : 'bg-white border-gray-200';
  const tableHead = isDark ? 'bg-[#111827]/60 text-[#5a6a8a] border-[#2a3250]' : 'bg-gray-50 text-gray-500 border-gray-200';
  const tableDivide = isDark ? 'divide-[#2a3250]' : 'divide-gray-100';
  const rowHover = isDark ? 'hover:bg-white/[0.03]' : 'hover:bg-gray-50';
  const textMain = isDark ? 'text-white' : 'text-gray-900';
  const textMuted = isDark ? 'text-[#5a6a8a]' : 'text-gray-500';

  const toggleUrgency = (f: string) => {
    setUrgencyFilters(prev => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f); else next.add(f);
      return next;
    });
  };

  const loadListingData = async (fsns: string[]) => {
    const unique = [...new Set(fsns.filter(Boolean))];
    if (!unique.length) return;
    try {
      const data = await searchRead<any>('flipkart.listing', {
        domain: [['fsn', 'in', unique]],
        fields: ['fsn', 'sku', 'listing_id', 'selling_price', 'bank_settlement'],
        limit: 0,
      });
      const map: Record<string, ListingData> = {};
      for (const d of (Array.isArray(data) ? data : [])) map[d.fsn] = d;
      setListingMap(map);
    } catch { /* non-fatal */ }
  };

  const syncData = async () => {
    setLoading(true);
    try {
      const r = await searchRead<any>('flipkart.fbf.replenishment', {
        fields: ['id', 'product_id', 'sku', 'fsn', 'warehouse_name', 'account_id',
          'fbf_stock', 'sales_7d', 'sales_14d', 'in_transit', 'daily_sales',
          'qty_to_send', 'days_cover_after', 'urgency'],
        domain: [], limit: 0,
        order: 'urgency asc, qty_to_send desc',
      });
      const mapped = Array.isArray(r) ? r.map(mapItem) : [];
      await loadListingData(mapped.map(i => i.fsn));
      return mapped;
    } catch (e) {
      console.error('Sync failed', e);
      return null;
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async (accs: Account[]) => {
    if (!accs.length) return;
    setGenerating(true);
    setMessage(null);
    try {
      for (const acc of accs) {
        const wizardId = await createRecord('flipkart.fbf.replenishment.generate', { account_id: acc.id });
        await odooCall('flipkart.fbf.replenishment.generate', 'action_generate', [[wizardId]], {});
      }
      const fresh = await syncData();
      if (fresh) setItems(fresh);
      setMessage({ type: 'success', text: `Recommendations generated for ${accs.length} account(s).` });
    } catch (e: any) {
      setMessage({ type: 'error', text: 'Generation failed: ' + (e.message ?? 'Unknown error') });
    } finally {
      setGenerating(false);
    }
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const accs = await searchRead<Account>('flipkart.account', { fields: ['id', 'name'], limit: 0 });
        if (Array.isArray(accs)) setAccounts(accs);
        const existing = await syncData();
        if (existing && existing.length === 0 && accs && accs.length > 0) {
          await handleGenerate(accs);
        } else if (existing) {
          setItems(existing);
        }
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    })();
  }, []); // eslint-disable-line

  const handleRefreshGenerate = () => handleGenerate(accounts);

  const handleCreateConsignment = async (warehouseItems: ReplenishmentItem[]) => {
    const selected = warehouseItems.filter(i => i.selected);
    if (!selected.length) return;
    setConsigning(true);
    setMessage(null);
    try {
      const accountName = Array.isArray(selected[0].account_id) ? selected[0].account_id[1] : '';
      const accountSel = accountName.toLowerCase().includes('roxxcart') ? 'roxxcart' : 'robifel';
      const today = new Date().toISOString().split('T')[0];
      const consignmentId = await createRecord('flipkart.consignment', { account: accountSel, pickup_date: today });
      for (const item of selected) {
        await createRecord('flipkart.consignment.line', {
          consignment_id: consignmentId,
          product_name: Array.isArray(item.product_id) ? item.product_id[1] : item.sku,
          fsn: item.fsn,
          quantity_sent: item.qty_to_send,
        });
      }
      setMessage({ type: 'success', text: `Consignment created with ${selected.length} line(s). Open Consignment Manager to finalise.` });
      setItems(prev => prev.map(i => ({ ...i, selected: false })));
    } catch (e: any) {
      setMessage({ type: 'error', text: 'Consignment creation failed: ' + (e.message ?? 'Unknown error') });
    } finally {
      setConsigning(false);
    }
  };

  const toggleItem = (id: number) => setItems(prev => prev.map(i => i.id === id ? { ...i, selected: !i.selected } : i));
  const toggleWarehouseAll = (wh: string, checked: boolean) =>
    setItems(prev => prev.map(i => i.warehouse_name === wh ? { ...i, selected: checked } : i));
  const toggleCollapse = (wh: string) =>
    setCollapsed(prev => { const s = new Set(prev); s.has(wh) ? s.delete(wh) : s.add(wh); return s; });

  const allWarehouses = useMemo(() => [...new Set(items.map(i => i.warehouse_name))].sort(), [items]);

  const filtered = useMemo(() => items.filter(i => {
    if (i.qty_to_send < 5) return false;
    if (accountFilter !== 'all' && (!Array.isArray(i.account_id) || i.account_id[0] !== accountFilter)) return false;
    if (warehouseFilter !== 'all' && i.warehouse_name !== warehouseFilter) return false;
    if (urgencyFilters.size > 0 && !urgencyFilters.has(i.urgency)) return false;
    return true;
  }), [items, accountFilter, warehouseFilter, urgencyFilters]);

  const grouped = useMemo(() => {
    const map = new Map<string, ReplenishmentItem[]>();
    for (const item of filtered) {
      const wh = item.warehouse_name;
      if (!map.has(wh)) map.set(wh, []);
      map.get(wh)!.push(item);
    }
    return [...map.entries()].sort(([, a], [, b]) => {
      const minA = Math.min(...a.map(i => urgencyOrder[i.urgency]));
      const minB = Math.min(...b.map(i => urgencyOrder[i.urgency]));
      return minA - minB;
    });
  }, [filtered]);

  const totalCritical = items.filter(i => i.urgency === 'critical').length;
  const totalModerate = items.filter(i => i.urgency === 'moderate').length;
  const totalUnits = items.reduce((s, i) => s + i.qty_to_send, 0);

  const urgencyBtnClass = (f: string) => {
    const active = urgencyFilters.has(f);
    const colorMap: Record<string, string> = {
      critical: 'bg-red-500 text-white border-red-500',
      moderate: 'bg-amber-500 text-white border-amber-500',
      healthy: 'bg-emerald-500 text-white border-emerald-500',
    };
    return active
      ? colorMap[f] || 'bg-[#7367f0] text-white border-[#7367f0]'
      : isDark ? 'border-[#2a3250] text-[#5a6a8a]' : 'border-gray-200 text-gray-500';
  };

  return (
    <div className='p-4 max-w-7xl mx-auto space-y-5 animate-fade-in'>

      {/* Header */}
      <div className='flex flex-col md:flex-row md:items-center justify-between gap-4'>
        <div>
          <h1 className={`text-2xl font-black ${textMain}`}>FBF Replenishment Planner</h1>
          <p className={`text-xs mt-1 ${textMuted}`}>Velocity-based restocking · auto-partitioned by warehouse</p>
        </div>
        <div className='flex items-center gap-2'>
          <button onClick={() => syncData().then(r => r && setItems(r))} disabled={loading}
            className='btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5'>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Sync
          </button>
          <button onClick={handleRefreshGenerate} disabled={generating || !accounts.length}
            className='btn-primary text-xs px-3.5 py-1.5 flex items-center gap-1.5'>
            <Zap size={13} className={generating ? 'animate-pulse' : ''} />
            {generating ? 'Generating…' : 'Re-Generate'}
          </button>
        </div>
      </div>

      {message && (
        <div className={`p-3 rounded-xl flex items-start gap-3 border text-sm font-medium ${
          message.type === 'success' ? 'bg-green-500/10 border-green-500/20 text-green-400' : 'bg-red-500/10 border-red-500/20 text-red-400'
        }`}>
          {message.type === 'success' ? <CheckCircle2 size={16} className='flex-shrink-0 mt-0.5' /> : <AlertCircle size={16} className='flex-shrink-0 mt-0.5' />}
          {message.text}
        </div>
      )}

      {/* Global stats */}
      <div className='grid grid-cols-3 gap-3'>
        {[
          { label: 'Critical', value: totalCritical, color: 'text-red-400' },
          { label: 'Moderate', value: totalModerate, color: 'text-amber-400' },
          { label: 'Units to Send', value: totalUnits.toLocaleString('en-IN'), color: 'text-[#7367f0]' },
        ].map(s => (
          <div key={s.label} className={`card p-4 border rounded-2xl ${cardBg}`}>
            <p className={`text-2xl font-black ${s.color}`}>{s.value}</p>
            <p className={`text-[10px] uppercase tracking-wider font-semibold mt-1 ${textMuted}`}>{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className={`card border rounded-2xl p-3 space-y-2.5 ${cardBg}`}>
        {/* Account */}
        <div className='flex items-start gap-2'>
          <span className={`text-[11px] font-semibold uppercase tracking-wider shrink-0 w-20 pt-1 ${textMuted}`}>Account</span>
          <div className='flex gap-1 flex-wrap'>
            <button onClick={() => setAccountFilter('all')}
              className={`text-xs px-3 py-1 rounded-lg font-semibold border transition-all ${accountFilter === 'all' ? 'bg-[#7367f0] text-white border-[#7367f0]' : isDark ? 'border-[#2a3250] text-[#5a6a8a]' : 'border-gray-200 text-gray-500'}`}>
              All
            </button>
            {accounts.map(acc => (
              <button key={acc.id} onClick={() => setAccountFilter(acc.id)}
                className={`text-xs px-3 py-1 rounded-lg font-semibold border transition-all ${accountFilter === acc.id ? 'bg-[#7367f0] text-white border-[#7367f0]' : isDark ? 'border-[#2a3250] text-[#5a6a8a]' : 'border-gray-200 text-gray-500'}`}>
                {acc.name}
              </button>
            ))}
          </div>
        </div>
        {/* Warehouse */}
        <div className='flex items-center gap-2'>
          <span className={`text-[11px] font-semibold uppercase tracking-wider shrink-0 w-20 ${textMuted}`}>Warehouse</span>
          <select value={warehouseFilter} onChange={e => setWarehouseFilter(e.target.value)}
            className={`text-xs px-2 py-1.5 rounded-lg border outline-none font-medium flex-1 min-w-0 ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : 'bg-white border-gray-200 text-gray-700'}`}>
            <option value='all'>All Warehouses</option>
            {allWarehouses.map(wh => <option key={wh} value={wh}>{wh}</option>)}
          </select>
        </div>
        {/* Urgency — multi-select */}
        <div className='flex items-start gap-2'>
          <span className={`text-[11px] font-semibold uppercase tracking-wider shrink-0 w-20 pt-1 ${textMuted}`}>Urgency</span>
          <div className='flex gap-1 flex-wrap items-center'>
            {(['critical', 'moderate', 'healthy'] as const).map(f => (
              <button key={f} onClick={() => toggleUrgency(f)}
                className={`text-xs px-3 py-1 rounded-lg font-semibold capitalize border transition-all ${urgencyBtnClass(f)}`}>
                {urgencyFilters.has(f) ? '✓ ' : ''}{f}
              </button>
            ))}
            {urgencyFilters.size > 0 && (
              <button onClick={() => setUrgencyFilters(new Set())}
                className={`text-xs px-2 py-1 rounded-lg border transition-all ${isDark ? 'border-[#2a3250] text-[#5a6a8a] hover:text-white' : 'border-gray-200 text-gray-400 hover:text-gray-700'}`}>
                Clear
              </button>
            )}
            <span className={`text-[10px] ml-1 ${textMuted}`}>
              {urgencyFilters.size === 0 ? 'Showing all' : `Showing: ${[...urgencyFilters].join(', ')}`}
            </span>
          </div>
        </div>
      </div>

      {/* Loading / empty */}
      {(loading || generating) && (
        <div className='flex flex-col items-center justify-center py-20 gap-3'>
          <RefreshCw size={32} className='animate-spin text-[#7367f0]' />
          <p className={`text-sm ${textMuted}`}>{generating ? 'Generating recommendations…' : 'Loading…'}</p>
        </div>
      )}

      {!loading && !generating && filtered.length === 0 && (
        <div className='flex flex-col items-center justify-center py-20 gap-3'>
          <Package size={40} className='text-[#2a3250]' />
          <p className={`text-sm ${textMuted}`}>No records found. Adjust filters or click Re-Generate.</p>
        </div>
      )}

      {/* Warehouse partitions */}
      {!loading && !generating && grouped.map(([wh, whItems]) => {
        const isCollapsed = collapsed.has(wh);
        const whCritical = whItems.filter(i => i.urgency === 'critical').length;
        const whModerate = whItems.filter(i => i.urgency === 'moderate').length;
        const whUnits = whItems.reduce((s, i) => s + i.qty_to_send, 0);
        const selectedInWh = whItems.filter(i => i.selected);
        const allWhSelected = whItems.length > 0 && whItems.every(i => i.selected);
        const csvCount = whItems.filter(i => (i.urgency === 'critical' || i.urgency === 'moderate') && i.qty_to_send >= 5).length;

        return (
          <div key={wh} className={`card border rounded-2xl overflow-hidden ${cardBg}`}>
            {/* Warehouse header */}
            <div
              className={`px-4 py-3 cursor-pointer select-none ${isDark ? 'bg-[#111827]/40 border-b border-[#2a3250]' : 'bg-gray-50 border-b border-gray-100'}`}
              onClick={() => toggleCollapse(wh)}
            >
              {/* Row 1: name + collapse */}
              <div className='flex items-center gap-2'>
                <Warehouse size={15} className='text-[#7367f0] flex-shrink-0' />
                <span className={`font-bold text-sm flex-1 ${textMain}`}>{wh}</span>
                {isCollapsed ? <ChevronDown size={15} className={textMuted} /> : <ChevronUp size={15} className={textMuted} />}
              </div>
              {/* Row 2: stats + buttons */}
              <div className='flex items-center gap-2 mt-1.5 flex-wrap' onClick={e => e.stopPropagation()}>
                <div className='flex gap-2 text-[11px] font-semibold flex-wrap flex-1'>
                  {whCritical > 0 && <span className='text-red-400'>{whCritical} critical</span>}
                  {whModerate > 0 && <span className='text-amber-400'>{whModerate} moderate</span>}
                  <span className={textMuted}>{whItems.length} SKUs</span>
                  <span className='text-[#7367f0]'>{whUnits.toLocaleString('en-IN')} units</span>
                </div>
                <div className='flex items-center gap-2 shrink-0'>
                  {csvCount > 0 && (
                    <button
                      onClick={e => { e.stopPropagation(); downloadCsv(wh, whItems, listingMap); }}
                      className={`text-[11px] px-3 py-1.5 flex items-center gap-1.5 rounded-lg border font-semibold transition-all ${isDark ? 'border-[#2a3250] text-[#8897b5] hover:border-emerald-500/50 hover:text-emerald-400' : 'border-gray-200 text-gray-500 hover:border-emerald-400 hover:text-emerald-600'}`}
                    >
                      <Download size={11} /> Download CSV ({csvCount})
                    </button>
                  )}
                  {selectedInWh.length > 0 && (
                    <button
                      onClick={e => { e.stopPropagation(); handleCreateConsignment(whItems); }}
                      disabled={consigning}
                      className='btn-primary text-[11px] px-3 py-1.5 flex items-center gap-1.5'
                    >
                      <Send size={11} /> Consign ({selectedInWh.length})
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Content */}
            {!isCollapsed && (
              <>
                {/* Mobile cards */}
                <div className={`md:hidden divide-y ${tableDivide}`}>
                  <div className={`flex items-center gap-2 px-4 py-2 ${isDark ? 'bg-[#111827]/20' : 'bg-gray-50/50'}`}>
                    <input type='checkbox' className='rounded' checked={allWhSelected}
                      onChange={e => toggleWarehouseAll(wh, e.target.checked)} />
                    <span className={`text-[11px] font-semibold ${textMuted}`}>Select all ({whItems.length})</span>
                  </div>
                  {whItems.map(item => (
                    <div key={item.id} className={`flex gap-3 px-4 py-3 ${item.selected ? 'bg-[#7367f0]/5' : ''}`}>
                      <input type='checkbox' className='rounded mt-1 shrink-0' checked={item.selected} onChange={() => toggleItem(item.id)} />
                      <div className='flex-1 min-w-0'>
                        <div className='flex items-start justify-between gap-2'>
                          <div className='min-w-0'>
                            <p className={`font-semibold text-xs leading-snug ${textMain}`}>{Array.isArray(item.product_id) ? item.product_id[1] : '--'}</p>
                            <p className={`text-[10px] font-mono mt-0.5 ${textMuted}`}>{item.sku}</p>
                          </div>
                          <div className='shrink-0'>
                            {item.urgency === 'critical' && <span className='badge badge-red'>Critical</span>}
                            {item.urgency === 'moderate' && <span className='badge badge-amber'>Moderate</span>}
                            {item.urgency === 'healthy' && <span className='badge badge-green'>Healthy</span>}
                          </div>
                        </div>
                        <div className='flex items-center gap-3 mt-2 flex-wrap text-[11px]'>
                          <span className={textMuted}>{Array.isArray(item.account_id) ? item.account_id[1] : '--'}</span>
                          <span className={textMuted}>Stock: <span className={`font-semibold ${textMain}`}>{item.fbf_stock}</span></span>
                          <span className={textMuted}>7D: {item.sales_7d}</span>
                          <span className={textMuted}>14D: {item.sales_14d}</span>
                          <span className={textMuted}>Vel: {(Number(item.daily_sales) || 0).toFixed(1)}</span>
                          <span className={textMuted}>Cover: {item.days_cover_after}d</span>
                        </div>
                        <div className='mt-1.5'>
                          <span className='text-sm font-black text-[#7367f0]'>{item.qty_to_send} to send</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Desktop table */}
                <div className='hidden md:block overflow-x-auto'>
                  <table className='w-full text-left border-collapse text-sm'>
                    <thead>
                      <tr className={`border-b text-xs font-semibold uppercase tracking-wider ${tableHead}`}>
                        <th className='py-2.5 px-4 w-10'>
                          <input type='checkbox' className='rounded' checked={allWhSelected}
                            onChange={e => toggleWarehouseAll(wh, e.target.checked)} />
                        </th>
                        <th className='py-2.5 px-4'>Product / SKU</th>
                        <th className='py-2.5 px-4'>Account</th>
                        <th className='py-2.5 px-4 text-right'>FBF Stock</th>
                        <th className='py-2.5 px-4 text-right'>7D</th>
                        <th className='py-2.5 px-4 text-right'>14D</th>
                        <th className='py-2.5 px-4 text-right'>Vel.</th>
                        <th className='py-2.5 px-4 text-right'>Qty to Send</th>
                        <th className='py-2.5 px-4 text-right'>Cover</th>
                        <th className='py-2.5 px-4 text-center'>Urgency</th>
                      </tr>
                    </thead>
                    <tbody className={`divide-y ${tableDivide}`}>
                      {whItems.map(item => (
                        <tr key={item.id} className={`transition-colors ${rowHover} ${item.selected ? 'bg-[#7367f0]/5' : ''}`}>
                          <td className='py-2.5 px-4'>
                            <input type='checkbox' className='rounded' checked={item.selected} onChange={() => toggleItem(item.id)} />
                          </td>
                          <td className='py-2.5 px-4'>
                            <div className={`font-semibold text-xs ${textMain}`}>{Array.isArray(item.product_id) ? item.product_id[1] : '--'}</div>
                            <div className={`text-[10px] mt-0.5 font-mono ${textMuted}`}>{item.sku}{item.fsn ? ` · ${item.fsn}` : ''}</div>
                          </td>
                          <td className={`py-2.5 px-4 text-xs ${textMuted}`}>{Array.isArray(item.account_id) ? item.account_id[1] : '--'}</td>
                          <td className={`py-2.5 px-4 text-right font-medium text-xs ${textMain}`}>{item.fbf_stock}</td>
                          <td className={`py-2.5 px-4 text-right text-xs ${textMuted}`}>{item.sales_7d}</td>
                          <td className={`py-2.5 px-4 text-right text-xs ${textMuted}`}>{item.sales_14d}</td>
                          <td className={`py-2.5 px-4 text-right text-xs ${textMuted}`}>{(Number(item.daily_sales) || 0).toFixed(1)}</td>
                          <td className='py-2.5 px-4 text-right font-black text-[#7367f0] text-xs'>{item.qty_to_send}</td>
                          <td className={`py-2.5 px-4 text-right text-xs ${textMuted}`}>{item.days_cover_after}d</td>
                          <td className='py-2.5 px-4 text-center'>
                            {item.urgency === 'critical' && <span className='badge badge-red'>Critical</span>}
                            {item.urgency === 'moderate' && <span className='badge badge-amber'>Moderate</span>}
                            {item.urgency === 'healthy' && <span className='badge badge-green'>Healthy</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
