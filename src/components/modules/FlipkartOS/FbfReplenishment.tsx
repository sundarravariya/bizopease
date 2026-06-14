import { useState, useEffect } from 'react';
import { searchRead, odooCall, createRecord } from '../../../services/odoo';
import { useTheme } from '../../../context/ThemeContext';
import {
  RefreshCw, Send, AlertCircle, CheckCircle2,
  Zap, Package, Filter,
} from 'lucide-react';

interface Account {
  id: number;
  name: string;
}

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
    id: r.id,
    product_id: r.product_id,
    sku: r.sku || '',
    fsn: r.fsn || '',
    warehouse_name: r.warehouse_name || '',
    account_id: r.account_id,
    fbf_stock: r.fbf_stock ?? 0,
    sales_7d: r.sales_7d ?? 0,
    sales_14d: r.sales_14d ?? 0,
    in_transit: r.in_transit ?? 0,
    daily_sales: r.daily_sales ?? 0,
    qty_to_send: r.qty_to_send ?? 0,
    days_cover_after: r.days_cover_after ?? 0,
    urgency: r.urgency ?? 'healthy',
    selected: false,
  };
}

export default function FbfReplenishment() {
  const { isDark } = useTheme();
  const [items, setItems] = useState<ReplenishmentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [consigning, setConsigning] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [urgencyFilter, setUrgencyFilter] = useState<UrgencyFilter>('all');

  useEffect(() => {
    loadAccounts();
  }, []);

  const loadAccounts = async () => {
    try {
      const r = await searchRead<Account>('flipkart.account', {
        fields: ['id', 'name'],
        limit: 0,
      });
      if (Array.isArray(r)) {
        setAccounts(r);
        syncData();
      }
    } catch (e) {
      console.error('Failed to load accounts', e);
    }
  };

  const syncData = async () => {
    setLoading(true);
    try {
      const r = await searchRead<any>('flipkart.fbf.replenishment', {
        fields: [
          'id', 'product_id', 'sku', 'fsn', 'warehouse_name', 'account_id',
          'fbf_stock', 'sales_7d', 'sales_14d', 'in_transit', 'daily_sales',
          'qty_to_send', 'days_cover_after', 'urgency',
        ],
        domain: [],
        limit: 0,
        order: 'urgency asc, qty_to_send desc',
      });
      if (Array.isArray(r)) setItems(r.map(mapItem));
    } catch (e) {
      console.error('Odoo sync failed', e);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    if (accounts.length === 0) return;
    setGenerating(true);
    setMessage(null);
    try {
      for (const acc of accounts) {
        const wizardId = await createRecord('flipkart.fbf.replenishment.generate', { account_id: acc.id });
        await odooCall('flipkart.fbf.replenishment.generate', 'action_generate', [[wizardId]], {});
      }
      setMessage({ type: 'success', text: 'Replenishment recommendations generated for all accounts.' });
      await syncData();
    } catch (e: any) {
      setMessage({ type: 'error', text: 'Generation failed: ' + (e.message ?? 'Unknown error') });
    } finally {
      setGenerating(false);
    }
  };

  const handleCreateConsignment = async () => {
    const selected = items.filter(i => i.selected);
    if (selected.length === 0) return;
    setConsigning(true);
    setMessage(null);
    try {
      const accountName = Array.isArray(selected[0].account_id) ? selected[0].account_id[1] : '';
      const accountSel = accountName.toLowerCase().includes('roxxcart') ? 'roxxcart' : 'robifel';
      const today = new Date().toISOString().split('T')[0];
      const consignmentId = await createRecord('flipkart.consignment', {
        account: accountSel,
        pickup_date: today,
      });
      for (const item of selected) {
        await createRecord('flipkart.consignment.line', {
          consignment_id: consignmentId,
          product_name: Array.isArray(item.product_id) ? item.product_id[1] : item.sku,
          fsn: item.fsn,
          quantity_sent: item.qty_to_send,
        });
      }
      setMessage({ type: 'success', text: `Consignment created with ${selected.length} line(s). Open Consignment Manager to add boxes and mark RTD.` });
      setItems(prev => prev.map(i => ({ ...i, selected: false })));
    } catch (e: any) {
      setMessage({ type: 'error', text: 'Consignment creation failed: ' + (e.message ?? 'Unknown error') });
    } finally {
      setConsigning(false);
    }
  };

  const handleSelectAll = (checked: boolean) => {
    setItems(prev => prev.map(i => ({ ...i, selected: checked })));
  };

  const handleToggle = (id: number) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, selected: !i.selected } : i));
  };

  const filtered = urgencyFilter === 'all' ? items : items.filter(i => i.urgency === urgencyFilter);
  const selectedIds = items.filter(i => i.selected).map(i => i.id);
  const criticalCount = items.filter(i => i.urgency === 'critical').length;
  const moderateCount = items.filter(i => i.urgency === 'moderate').length;
  const totalToSend = items.reduce((s, i) => s + i.qty_to_send, 0);

  const cardBg = isDark ? 'bg-[#161b2e] border-[#2a3250]' : 'bg-white border-gray-200';
  const tableHead = isDark ? 'bg-[#111827]/60 text-[#5a6a8a] border-[#2a3250]' : 'bg-gray-50 text-gray-500 border-gray-200';
  const tableDivide = isDark ? 'divide-[#2a3250]' : 'divide-gray-100';
  const rowHover = isDark ? 'hover:bg-white/[0.03]' : 'hover:bg-gray-50';
  const textMain = isDark ? 'text-white' : 'text-gray-900';
  const textMuted = isDark ? 'text-[#5a6a8a]' : 'text-gray-500';

  return (
    <div className='p-4 max-w-7xl mx-auto space-y-6 animate-fade-in'>
      {/* Header */}
      <div className='flex flex-col md:flex-row md:items-center justify-between gap-4'>
        <div>
          <h1 className={`text-2xl font-black ${textMain}`}>FBF Replenishment Planner</h1>
          <p className={`text-xs mt-1 ${textMuted}`}>
            Velocity-based restocking recommendations for Fulfilled-by-Flipkart warehouses.
          </p>
        </div>
        <div className='flex items-center gap-3 flex-wrap'>
          <button
            onClick={syncData}
            disabled={loading}
            className='btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5'
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Sync
          </button>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className='btn-primary text-xs px-3.5 py-1.5 flex items-center gap-1.5'
          >
            <Zap size={13} className={generating ? 'animate-pulse' : ''} />
            Generate
          </button>
        </div>
      </div>

      {/* Message */}
      {message && (
        <div className={`p-3 rounded-xl flex items-start gap-3 border text-sm font-medium ${
          message.type === 'success'
            ? 'bg-green-500/10 border-green-500/20 text-green-400'
            : 'bg-red-500/10 border-red-500/20 text-red-400'
        }`}>
          {message.type === 'success'
            ? <CheckCircle2 size={16} className='flex-shrink-0 mt-0.5' />
            : <AlertCircle size={16} className='flex-shrink-0 mt-0.5' />}
          {message.text}
        </div>
      )}

      {/* Stats */}
      <div className='grid grid-cols-3 gap-4'>
        <div className={`card p-4 border rounded-2xl ${cardBg}`}>
          <p className='text-2xl font-black text-red-400'>{criticalCount}</p>
          <p className={`text-[10px] uppercase tracking-wider font-semibold mt-1 ${textMuted}`}>Critical</p>
        </div>
        <div className={`card p-4 border rounded-2xl ${cardBg}`}>
          <p className='text-2xl font-black text-amber-400'>{moderateCount}</p>
          <p className={`text-[10px] uppercase tracking-wider font-semibold mt-1 ${textMuted}`}>Moderate</p>
        </div>
        <div className={`card p-4 border rounded-2xl ${cardBg}`}>
          <p className='text-2xl font-black text-[#7367f0]'>{totalToSend.toLocaleString('en-IN')}</p>
          <p className={`text-[10px] uppercase tracking-wider font-semibold mt-1 ${textMuted}`}>Total Units to Send</p>
        </div>
      </div>

      {/* Filters + Bulk action */}
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div className='flex items-center gap-2'>
          <Filter size={13} className={textMuted} />
          {(['all', 'critical', 'moderate', 'healthy'] as UrgencyFilter[]).map(f => (
            <button
              key={f}
              onClick={() => setUrgencyFilter(f)}
              className={`text-xs px-3 py-1 rounded-lg font-semibold capitalize transition-all border ${
                urgencyFilter === f
                  ? 'bg-[#7367f0] text-white border-[#7367f0]'
                  : isDark ? 'border-[#2a3250] text-[#5a6a8a] hover:text-white' : 'border-gray-200 text-gray-500 hover:text-gray-900'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        {selectedIds.length > 0 && (
          <button
            onClick={handleCreateConsignment}
            disabled={consigning}
            className='btn-primary text-xs px-4 py-2 flex items-center gap-2'
          >
            <Send size={13} />
            Create Consignment ({selectedIds.length})
          </button>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div className='flex items-center justify-center py-24'>
          <RefreshCw size={32} className='animate-spin text-[#7367f0]' />
        </div>
      ) : filtered.length === 0 && !loading ? (
        <div className='flex flex-col items-center justify-center py-20 gap-3'>
          <Package size={40} className='text-[#2a3250]' />
          <p className={`text-sm ${textMuted}`}>No records found. Click Sync or Generate to load data.</p>
        </div>
      ) : (
        <div className={`card border rounded-2xl overflow-hidden ${cardBg}`}>
          <div className='overflow-x-auto'>
            <table className='w-full text-left border-collapse text-sm'>
              <thead>
                <tr className={`border-b text-xs font-semibold uppercase tracking-wider ${tableHead}`}>
                  <th className='py-3 px-4 w-10'>
                    <input
                      type='checkbox'
                      className='rounded'
                      checked={filtered.length > 0 && filtered.every(i => i.selected)}
                      onChange={e => handleSelectAll(e.target.checked)}
                    />
                  </th>
                  <th className='py-3 px-4'>Product / SKU</th>
                  <th className='py-3 px-4'>FSN</th>
                  <th className='py-3 px-4'>Warehouse</th>
                  <th className='py-3 px-4 text-right'>FBF Stock</th>
                  <th className='py-3 px-4 text-right'>Sales 7D</th>
                  <th className='py-3 px-4 text-right'>Sales 14D</th>
                  <th className='py-3 px-4 text-right'>Daily Vel.</th>
                  <th className='py-3 px-4 text-right'>Qty to Send</th>
                  <th className='py-3 px-4 text-right'>Days Cover</th>
                  <th className='py-3 px-4 text-center'>Urgency</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${tableDivide}`}>
                {filtered.map(item => (
                  <tr
                    key={item.id}
                    className={`transition-colors ${rowHover} ${item.selected ? 'bg-[#7367f0]/5' : ''}`}
                  >
                    <td className='py-3 px-4'>
                      <input
                        type='checkbox'
                        className='rounded'
                        checked={item.selected}
                        onChange={() => handleToggle(item.id)}
                      />
                    </td>
                    <td className='py-3 px-4'>
                      <div className={`font-semibold ${textMain}`}>
                        {Array.isArray(item.product_id) ? item.product_id[1] : '--'}
                      </div>
                      <div className={`text-[10px] mt-0.5 ${textMuted}`}>{item.sku}</div>
                    </td>
                    <td className={`py-3 px-4 font-mono text-xs ${textMuted}`}>{item.fsn || '--'}</td>
                    <td className={`py-3 px-4 text-xs ${textMuted}`}>{item.warehouse_name || '--'}</td>
                    <td className={`py-3 px-4 text-right font-medium ${textMain}`}>{item.fbf_stock}</td>
                    <td className={`py-3 px-4 text-right ${textMuted}`}>{item.sales_7d}</td>
                    <td className={`py-3 px-4 text-right ${textMuted}`}>{item.sales_14d}</td>
                    <td className={`py-3 px-4 text-right ${textMuted}`}>{(Number(item.daily_sales) || 0).toFixed(1)}</td>
                    <td className='py-3 px-4 text-right font-bold text-[#7367f0]'>{item.qty_to_send}</td>
                    <td className={`py-3 px-4 text-right ${textMuted}`}>{item.days_cover_after}d</td>
                    <td className='py-3 px-4 text-center'>
                      {item.urgency === 'critical' && <span className='badge badge-red'>Critical</span>}
                      {item.urgency === 'moderate' && <span className='badge badge-amber'>Moderate</span>}
                      {item.urgency === 'healthy' && <span className='badge badge-green'>Healthy</span>}
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

