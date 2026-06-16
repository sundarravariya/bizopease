import { useState, useEffect, useMemo } from 'react';
import { searchRead, odooCall, createRecord } from '../../../services/odoo';
import { useTheme } from '../../../context/ThemeContext';
import {
  RefreshCw, Send, AlertCircle, CheckCircle2,
  Zap, Package, ChevronDown, ChevronUp, Warehouse,
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

type UrgencyFilter = 'all' | 'critical' | 'moderate' | 'healthy';

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
  const [urgencyFilter, setUrgencyFilter] = useState<UrgencyFilter>('all');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const cardBg = isDark ? 'bg-[#161b2e] border-[#2a3250]' : 'bg-white border-gray-200';
  const tableHead = isDark ? 'bg-[#111827]/60 text-[#5a6a8a] border-[#2a3250]' : 'bg-gray-50 text-gray-500 border-gray-200';
  const tableDivide = isDark ? 'divide-[#2a3250]' : 'divide-gray-100';
  const rowHover = isDark ? 'hover:bg-white/[0.03]' : 'hover:bg-gray-50';
  const textMain = isDark ? 'text-white' : 'text-gray-900';
  const textMuted = isDark ? 'text-[#5a6a8a]' : 'text-gray-500';

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
      return Array.isArray(r) ? r.map(mapItem) : [];
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

  // On mount: load accounts, sync existing recs, auto-generate if empty.
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const accs = await searchRead<Account>('flipkart.account', { fields: ['id', 'name'], limit: 0 });
        if (Array.isArray(accs)) setAccounts(accs);
        const existing = await syncData();
        if (existing && existing.length === 0 && accs && accs.length > 0) {
          // Auto-generate if no recs exist yet.
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

  // Unique warehouses and accounts from loaded items for filter dropdowns.
  const allWarehouses = useMemo(() => [...new Set(items.map(i => i.warehouse_name))].sort(), [items]);

  const filtered = useMemo(() => items.filter(i => {
    if (accountFilter !== 'all' && (!Array.isArray(i.account_id) || i.account_id[0] !== accountFilter)) return false;
    if (warehouseFilter !== 'all' && i.warehouse_name !== warehouseFilter) return false;
    if (urgencyFilter !== 'all' && i.urgency !== urgencyFilter) return false;
    return true;
  }), [items, accountFilter, warehouseFilter, urgencyFilter]);

  // Group filtered items by warehouse, sorted by most critical first.
  const grouped = useMemo(() => {
    const map = new Map<string, ReplenishmentItem[]>();
    for (const item of filtered) {
      const wh = item.warehouse_name;
      if (!map.has(wh)) map.set(wh, []);
      map.get(wh)!.push(item);
    }
    // Sort warehouses by most critical items first.
    return [...map.entries()].sort(([, a], [, b]) => {
      const minA = Math.min(...a.map(i => urgencyOrder[i.urgency]));
      const minB = Math.min(...b.map(i => urgencyOrder[i.urgency]));
      return minA - minB;
    });
  }, [filtered]);

  const totalCritical = items.filter(i => i.urgency === 'critical').length;
  const totalModerate = items.filter(i => i.urgency === 'moderate').length;
  const totalUnits = items.reduce((s, i) => s + i.qty_to_send, 0);

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
      <div className={`card border rounded-2xl p-3 ${cardBg} flex flex-wrap gap-3 items-center`}>
        {/* Account filter */}
        <div className='flex items-center gap-2'>
          <span className={`text-[11px] font-semibold uppercase tracking-wider ${textMuted}`}>Account</span>
          <div className='flex gap-1'>
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

        <div className={`w-px h-5 ${isDark ? 'bg-[#2a3250]' : 'bg-gray-200'}`} />

        {/* Warehouse filter */}
        <div className='flex items-center gap-2'>
          <span className={`text-[11px] font-semibold uppercase tracking-wider ${textMuted}`}>Warehouse</span>
          <select value={warehouseFilter} onChange={e => setWarehouseFilter(e.target.value)}
            className={`text-xs px-2 py-1.5 rounded-lg border outline-none font-medium ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : 'bg-white border-gray-200 text-gray-700'}`}>
            <option value='all'>All Warehouses</option>
            {allWarehouses.map(wh => <option key={wh} value={wh}>{wh}</option>)}
          </select>
        </div>

        <div className={`w-px h-5 ${isDark ? 'bg-[#2a3250]' : 'bg-gray-200'}`} />

        {/* Urgency filter */}
        <div className='flex items-center gap-2'>
          <span className={`text-[11px] font-semibold uppercase tracking-wider ${textMuted}`}>Urgency</span>
          <div className='flex gap-1'>
            {(['all', 'critical', 'moderate', 'healthy'] as UrgencyFilter[]).map(f => (
              <button key={f} onClick={() => setUrgencyFilter(f)}
                className={`text-xs px-3 py-1 rounded-lg font-semibold capitalize border transition-all ${
                  urgencyFilter === f ? 'bg-[#7367f0] text-white border-[#7367f0]' : isDark ? 'border-[#2a3250] text-[#5a6a8a]' : 'border-gray-200 text-gray-500'
                }`}>
                {f}
              </button>
            ))}
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

        return (
          <div key={wh} className={`card border rounded-2xl overflow-hidden ${cardBg}`}>
            {/* Warehouse header */}
            <div
              className={`flex items-center gap-3 px-4 py-3 cursor-pointer select-none ${isDark ? 'bg-[#111827]/40 border-b border-[#2a3250]' : 'bg-gray-50 border-b border-gray-100'}`}
              onClick={() => toggleCollapse(wh)}
            >
              <Warehouse size={16} className='text-[#7367f0] flex-shrink-0' />
              <span className={`font-bold text-sm flex-1 ${textMain}`}>{wh}</span>

              {/* Per-warehouse mini stats */}
              <div className='flex items-center gap-3 text-[11px] font-semibold'>
                {whCritical > 0 && <span className='text-red-400'>{whCritical} critical</span>}
                {whModerate > 0 && <span className='text-amber-400'>{whModerate} moderate</span>}
                <span className={textMuted}>{whItems.length} SKUs</span>
                <span className='text-[#7367f0]'>{whUnits.toLocaleString('en-IN')} units</span>
              </div>

              {/* Consignment button for this warehouse */}
              {selectedInWh.length > 0 && (
                <button
                  onClick={e => { e.stopPropagation(); handleCreateConsignment(whItems); }}
                  disabled={consigning}
                  className='btn-primary text-[11px] px-3 py-1.5 flex items-center gap-1.5 ml-2'
                >
                  <Send size={11} /> Consign ({selectedInWh.length})
                </button>
              )}

              {isCollapsed ? <ChevronDown size={15} className={textMuted} /> : <ChevronUp size={15} className={textMuted} />}
            </div>

            {/* Table */}
            {!isCollapsed && (
              <div className='overflow-x-auto'>
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
            )}
          </div>
        );
      })}
    </div>
  );
}
