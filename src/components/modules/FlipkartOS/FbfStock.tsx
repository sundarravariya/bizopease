import { useState, useEffect } from 'react';
import { searchRead, searchCount } from '../../../services/odoo';
import { useTheme } from '../../../context/ThemeContext';
import { RefreshCw, Upload, Search, Package, AlertTriangle, TrendingUp, Zap } from 'lucide-react';

interface Account { id: number; name: string; }
interface WarehouseConfig { id: number; name: string; }

interface FbfStockItem {
  id: number;
  account_id: [number, string] | false;
  warehouse_name: string;
  warehouse_config_id: [number, string] | false;
  fsn: string;
  sku: string;
  title: string;
  brand: string;
  fulfilment_type: string;
  f_assured: string;
  qty_live: number;
  sales_7d: number;
  sales_14d: number;
  sales_30d: number;
  sales_60d: number;
  sales_90d: number;
  daily_velocity: number;
  days_remaining: number;
  status: 'critical' | 'moderate' | 'healthy';
  selling_price: number;
  b2b_scheduled: number;
  transfers_scheduled: number;
  b2b_shipped: number;
  transfers_shipped: number;
  b2b_receiving: number;
  transfers_receiving: number;
  reserved_orders: number;
  reserved_internal: number;
  returns_processing: number;
  orders_to_dispatch: number;
  recalls_to_dispatch: number;
  damaged: number;
  qc_reject: number;
  catalog_reject: number;
  returns_reject: number;
  seller_return_reject: number;
  miscellaneous: number;
  last_upload_date: string;
}

const STATUS_META = {
  critical: { label: 'Critical', cls: 'badge-red' },
  moderate: { label: 'Moderate', cls: 'badge-amber' },
  healthy:  { label: 'Healthy',  cls: 'badge-green' },
};

const TABS = ['all', 'critical', 'moderate', 'healthy'] as const;

const FIELDS = [
  'id', 'account_id', 'warehouse_name', 'warehouse_config_id',
  'fsn', 'sku', 'title', 'brand', 'fulfilment_type', 'f_assured',
  'qty_live', 'sales_7d', 'sales_14d', 'sales_30d', 'sales_60d', 'sales_90d',
  'daily_velocity', 'days_remaining', 'status',
  'selling_price', 'b2b_scheduled', 'transfers_scheduled', 'b2b_shipped', 'transfers_shipped',
  'b2b_receiving', 'transfers_receiving',
  'reserved_orders', 'reserved_internal', 'returns_processing',
  'orders_to_dispatch', 'recalls_to_dispatch',
  'damaged', 'qc_reject', 'catalog_reject', 'returns_reject', 'seller_return_reject', 'miscellaneous',
  'last_upload_date',
];

export default function FbfStock() {
  const { isDark } = useTheme();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState<number | ''>('');
  const [warehouses, setWarehouses] = useState<WarehouseConfig[]>([]);
  const [warehouseId, setWarehouseId] = useState<number | ''>('');
  const [items, setItems] = useState<FbfStockItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<typeof TABS[number]>('all');
  const [search, setSearch] = useState('');
  const [brandSearch, setBrandSearch] = useState('');
  const [page, setPage] = useState(0);
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);
  const PAGE = 150;

  useEffect(() => { loadAccounts(); }, []);

  useEffect(() => {
    if (accountId !== '') {
      setWarehouseId('');
      loadWarehouses(accountId as number);
      load(0);
    } else {
      setItems([]);
      setWarehouses([]);
    }
  }, [accountId]);

  useEffect(() => {
    if (accountId !== '') load(0);
    else setItems([]);
  }, [tab]);

  const showMsg = (ok: boolean, msg: string) => {
    setToast({ ok, msg });
    setTimeout(() => setToast(null), 4000);
  };

  const loadAccounts = async () => {
    try {
      const r = await searchRead<Account>('flipkart.account', { fields: ['id', 'name'], limit: 50 });
      if (Array.isArray(r) && r.length > 0) {
        setAccounts(r);
        setAccountId(r[0].id);
      }
    } catch (e: any) {
      showMsg(false, e?.message || 'Failed to load accounts');
    }
  };

  const loadWarehouses = async (accId: number) => {
    try {
      const r = await searchRead<WarehouseConfig>('flipkart.warehouse.config', {
        fields: ['id', 'name'], domain: [['account_id', '=', accId]], limit: 0,
      });
      if (Array.isArray(r)) setWarehouses(r);
    } catch {
      // non-fatal -- warehouse filter simply stays empty
    }
  };

  const buildDomain = () => {
    const d: any[] = accountId !== '' ? [['account_id', '=', accountId]] : [];
    if (tab !== 'all') d.push(['status', '=', tab]);
    if (warehouseId !== '') d.push(['warehouse_config_id', '=', warehouseId]);
    if (brandSearch.trim()) d.push(['brand', 'ilike', brandSearch.trim()]);
    if (search) d.push('|', ['fsn', 'ilike', search], '|', ['sku', 'ilike', search], ['title', 'ilike', search]);
    return d;
  };

  const load = async (offset = 0) => {
    setLoading(true);
    try {
      const domain = buildDomain();
      const [r, cnt] = await Promise.all([
        searchRead<FbfStockItem>('flipkart.fbf.stock', {
          domain, fields: FIELDS, limit: PAGE, offset, order: 'days_remaining asc',
        }),
        searchCount('flipkart.fbf.stock', domain),
      ]);
      if (Array.isArray(r)) setItems(r);
      setTotal(cnt || 0);
      setPage(offset / PAGE);
    } catch (e: any) {
      showMsg(false, e?.message || 'Failed to load FBF stock');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => load(0);

  const criticalCount = items.filter(i => i.status === 'critical').length;
  const moderateCount = items.filter(i => i.status === 'moderate').length;
  const totalLive = items.reduce((s, i) => s + i.qty_live, 0);

  return (
    <div className="space-y-5 animate-fade-in">
      {toast && (
        <div className={`fixed top-5 right-5 z-50 px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 text-sm font-medium animate-fade-in
          ${toast.ok ? 'bg-green-500/15 border border-green-500/30 text-green-400' : 'bg-red-500/15 border border-red-500/30 text-red-400'}`}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className={`text-xl font-black ${isDark ? 'text-white' : 'text-gray-900'}`}>FBF Live Stock</h1>
          <p className={`text-xs mt-0.5 ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>
            Live inventory per FSN per warehouse -- {total.toLocaleString('en-IN')} records
          </p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <select value={accountId} onChange={e => setAccountId(Number(e.target.value))}
            className={`input text-xs py-1.5 px-3 ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`}>
            <option value="">-- Account --</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <button onClick={() => load(0)} disabled={loading || accountId === ''} className="btn-secondary text-xs px-3 py-1.5">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Sync
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Records', value: total, icon: Package, color: 'text-[#7367f0]', bg: 'bg-[#7367f0]/10' },
          { label: 'Critical (<10d)', value: criticalCount, icon: AlertTriangle, color: 'text-red-400', bg: 'bg-red-500/10' },
          { label: 'Moderate (<30d)', value: moderateCount, icon: TrendingUp, color: 'text-amber-400', bg: 'bg-amber-500/10' },
          { label: 'Live Units', value: totalLive.toLocaleString('en-IN'), icon: Zap, color: 'text-green-400', bg: 'bg-green-500/10' },
        ].map(s => (
          <div key={s.label} className="card p-4 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl ${s.bg} flex items-center justify-center flex-shrink-0`}>
              <s.icon size={18} className={s.color} />
            </div>
            <div className="min-w-0">
              <p className={`text-lg font-black ${isDark ? 'text-white' : 'text-gray-900'}`}>{s.value}</p>
              <p className={`text-[10px] leading-tight ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs + Search + Filters */}
      <div className="flex flex-col gap-3">
        {/* Status tabs */}
        <div className={`flex gap-1 border-b overflow-x-auto ${isDark ? 'border-[#2a3250]' : 'border-gray-200'}`}>
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-2 text-xs font-semibold capitalize whitespace-nowrap border-b-2 transition-all ${tab === t
                ? 'border-[#7367f0] text-[#7367f0]'
                : `border-transparent ${isDark ? 'text-[#6a7a9a] hover:text-white' : 'text-gray-500 hover:text-gray-900'}`}`}>
              {t === 'all' ? 'All' : STATUS_META[t].label}
            </button>
          ))}
        </div>

        {/* Filter row */}
        <div className="flex gap-2 flex-wrap items-center">
          {/* FSN / SKU / title search */}
          <div className="relative">
            <Search size={13} className={`absolute left-3 top-1/2 -translate-y-1/2 ${isDark ? 'text-[#4a5580]' : 'text-gray-400'}`} />
            <input value={search} onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="FSN / SKU / title..."
              className={`input pl-9 text-xs py-2 w-48 ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`} />
          </div>

          {/* Brand text search */}
          <div className="relative">
            <Search size={13} className={`absolute left-3 top-1/2 -translate-y-1/2 ${isDark ? 'text-[#4a5580]' : 'text-gray-400'}`} />
            <input value={brandSearch} onChange={e => setBrandSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="Brand..."
              className={`input pl-9 text-xs py-2 w-36 ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`} />
          </div>

          {/* Warehouse dropdown */}
          {warehouses.length > 0 && (
            <select value={warehouseId} onChange={e => setWarehouseId(e.target.value === '' ? '' : Number(e.target.value))}
              className={`input text-xs py-2 px-3 ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`}>
              <option value="">-- Warehouse --</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          )}

          <button onClick={handleSearch} className="btn-primary text-xs px-3 py-2">Search</button>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="card h-48 flex items-center justify-center gap-3">
          <RefreshCw size={18} className="animate-spin text-[#7367f0]" />
          <span className={`text-sm ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>Loading FBF stock...</span>
        </div>
      ) : items.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-20 gap-3">
          <Package size={40} className="text-[#2a3250]" />
          <p className={`text-sm ${isDark ? 'text-[#5a6a8a]' : 'text-gray-500'}`}>
            {accountId === '' ? 'Select an account to view FBF stock.' : 'No records found. Upload an FBF Inventory CSV to populate.'}
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="data-table w-full min-w-[1100px]">
              <thead>
                <tr>
                  <th>FSN</th>
                  <th>SKU</th>
                  <th>Title</th>
                  <th>Brand</th>
                  <th>Warehouse</th>
                  <th>Fulfilment</th>
                  <th className="text-center">F-Assured</th>
                  <th className="text-right">Live</th>
                  <th className="text-right">Days Left</th>
                  <th className="text-right">Vel/Day</th>
                  <th className="text-right">Sales 7D</th>
                  <th className="text-right">Sales 14D</th>
                  <th className="text-right">Sales 30D</th>
                  <th className="text-right">Sales 60D</th>
                  <th className="text-right">Sales 90D</th>
                  <th className="text-right">Inbound</th>
                  <th className="text-right">Reserved</th>
                  <th className="text-right">Unsellable</th>
                  <th className="text-right">Damaged</th>
                  <th className="text-right">QC Rej</th>
                  <th className="text-right">Cat Rej</th>
                  <th className="text-right">Ret Rej</th>
                  <th className="text-right">Misc</th>
                  <th className="text-right">Selling</th>
                  <th className="text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map(r => (
                  <tr key={r.id}>
                    <td className="font-mono text-xs text-[#7367f0]">{r.fsn || '--'}</td>
                    <td className={`text-xs font-medium ${isDark ? 'text-[#8897b5]' : 'text-gray-600'}`}>{r.sku || '--'}</td>
                    <td className={`text-xs max-w-[150px] truncate ${isDark ? 'text-white' : 'text-gray-900'}`} title={r.title}>{r.title || '--'}</td>
                    <td className={`text-xs ${isDark ? 'text-[#8897b5]' : 'text-gray-500'}`}>{r.brand || '--'}</td>
                    <td className={`text-xs ${isDark ? 'text-[#8897b5]' : 'text-gray-500'}`}>
                      {Array.isArray(r.warehouse_config_id) ? r.warehouse_config_id[1] : (r.warehouse_name || '--')}
                    </td>
                    <td className={`text-xs ${isDark ? 'text-[#8897b5]' : 'text-gray-500'}`}>{r.fulfilment_type || '--'}</td>
                    <td className="text-center">
                      {r.f_assured && r.f_assured.toLowerCase() !== 'no' && r.f_assured !== 'false' && r.f_assured !== '' ? (
                        <span className="badge badge-green">Yes</span>
                      ) : (
                        <span className={`text-xs ${isDark ? 'text-[#4a5580]' : 'text-gray-300'}`}>--</span>
                      )}
                    </td>
                    <td className={`text-right font-bold ${r.qty_live < 5 ? 'text-red-400' : isDark ? 'text-white' : 'text-gray-900'}`}>{r.qty_live}</td>
                    <td className={`text-right font-bold ${r.days_remaining < 10 ? 'text-red-400' : r.days_remaining < 30 ? 'text-amber-400' : 'text-green-400'}`}>
                      {r.days_remaining === 999 ? '--' : `${r.days_remaining}d`}
                    </td>
                    <td className={`text-right text-xs ${isDark ? 'text-[#8897b5]' : 'text-gray-600'}`}>{r.daily_velocity?.toFixed(1) || '--'}</td>
                    <td className={`text-right text-xs ${isDark ? 'text-[#8897b5]' : 'text-gray-600'}`}>{r.sales_7d || 0}</td>
                    <td className={`text-right text-xs ${isDark ? 'text-[#8897b5]' : 'text-gray-600'}`}>{r.sales_14d || 0}</td>
                    <td className={`text-right text-xs ${isDark ? 'text-[#8897b5]' : 'text-gray-600'}`}>{r.sales_30d || 0}</td>
                    <td className={`text-right text-xs ${isDark ? 'text-[#8897b5]' : 'text-gray-600'}`}>{r.sales_60d || 0}</td>
                    <td className={`text-right text-xs ${isDark ? 'text-[#8897b5]' : 'text-gray-600'}`}>{r.sales_90d || 0}</td>
                    <td className={`text-right text-xs ${isDark ? 'text-[#8897b5]' : 'text-gray-600'}`}>
                      {(r.b2b_scheduled || 0) + (r.transfers_scheduled || 0) + (r.b2b_shipped || 0) + (r.transfers_shipped || 0) + (r.b2b_receiving || 0) + (r.transfers_receiving || 0) || '--'}
                    </td>
                    <td className={`text-right text-xs ${(r.reserved_orders || 0) + (r.reserved_internal || 0) + (r.returns_processing || 0) > 0 ? 'text-amber-400' : isDark ? 'text-[#8897b5]' : 'text-gray-500'}`}>
                      {(r.reserved_orders || 0) + (r.reserved_internal || 0) + (r.returns_processing || 0) || '--'}
                    </td>
                    <td className={`text-right text-xs ${(r.damaged || 0) + (r.qc_reject || 0) + (r.catalog_reject || 0) + (r.returns_reject || 0) + (r.seller_return_reject || 0) + (r.miscellaneous || 0) > 0 ? 'text-red-400 font-semibold' : isDark ? 'text-[#8897b5]' : 'text-gray-500'}`}>
                      {(r.damaged || 0) + (r.qc_reject || 0) + (r.catalog_reject || 0) + (r.returns_reject || 0) + (r.seller_return_reject || 0) + (r.miscellaneous || 0) || '--'}
                    </td>
                    <td className={`text-right text-xs ${(r.damaged || 0) > 0 ? 'text-red-400' : isDark ? 'text-[#8897b5]' : 'text-gray-500'}`}>{r.damaged || '--'}</td>
                    <td className={`text-right text-xs ${isDark ? 'text-[#8897b5]' : 'text-gray-500'}`}>{r.qc_reject || '--'}</td>
                    <td className={`text-right text-xs ${isDark ? 'text-[#8897b5]' : 'text-gray-500'}`}>{r.catalog_reject || '--'}</td>
                    <td className={`text-right text-xs ${isDark ? 'text-[#8897b5]' : 'text-gray-500'}`}>{r.returns_reject || '--'}</td>
                    <td className={`text-right text-xs ${isDark ? 'text-[#8897b5]' : 'text-gray-500'}`}>{r.miscellaneous || '--'}</td>
                    <td className={`text-right text-xs ${isDark ? 'text-[#8897b5]' : 'text-gray-600'}`}>
                      {r.selling_price > 0 ? `₹${r.selling_price.toLocaleString('en-IN')}` : '--'}
                    </td>
                    <td className="text-center">
                      <span className={`badge ${STATUS_META[r.status]?.cls || 'badge-gray'}`}>
                        {STATUS_META[r.status]?.label || r.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {total > PAGE && (
            <div className={`flex items-center justify-between px-4 py-3 border-t text-xs ${isDark ? 'border-[#2a3250] text-[#5a6a8a]' : 'border-gray-100 text-gray-400'}`}>
              <span>Showing {page * PAGE + 1}--{Math.min((page + 1) * PAGE, total)} of {total.toLocaleString('en-IN')}</span>
              <div className="flex gap-2">
                <button onClick={() => load((page - 1) * PAGE)} disabled={page === 0}
                  className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-40">Prev</button>
                <button onClick={() => load((page + 1) * PAGE)} disabled={(page + 1) * PAGE >= total}
                  className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-40">Next</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
