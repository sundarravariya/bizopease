import { useState, useEffect } from 'react';
import { odooCall } from '../../../services/odoo';
import { useTheme } from '../../../context/ThemeContext';
import { AlertCircle, RefreshCw, CheckCircle2, TrendingDown } from 'lucide-react';

// Native (non-Flipkart) Dead Stock — reads biz.dead.stock, sourced from
// native sale.order sales over the last 30 days. No FBF dimension.

interface DeadStockItem {
  id: number;
  product_id: [number, string] | false;
  sku: string;
  main_stock: number;
  total_stock: number;
  stock_value: number;
  sales_30d: number;
  sell_through_rate: number;
  state: 'dead' | 'potential' | 'healthy';
}

type StateFilter = 'all' | 'dead' | 'potential' | 'healthy';

export default function BizDeadStock() {
  const { isDark } = useTheme();
  const [items, setItems] = useState<DeadStockItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [warehouses, setWarehouses] = useState<{ id: number, name: string }[]>([]);
  const [selectedWhId, setSelectedWhId] = useState<number | ''>('');
  const [stateFilter, setStateFilter] = useState<StateFilter>('dead');
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetchWarehouses();
  }, []);

  useEffect(() => {
    if (selectedWhId) {
      fetchAnalysis();
    } else {
      setItems([]);
    }
  }, [selectedWhId]);

  const fetchWarehouses = async () => {
    try {
      const res = await odooCall<{ id: number, name: string }[]>('stock.warehouse', 'search_read', [[]], { fields: ['id', 'name'] });
      setWarehouses(res || []);
      if (res && res.length > 0) {
        setSelectedWhId(res[0].id);
      }
    } catch (e: any) {
      console.error(e);
    }
  };

  const fetchAnalysis = async () => {
    setLoading(true);
    try {
      const res = await odooCall<DeadStockItem[]>('biz.dead.stock', 'search_read', [[]], {
        fields: ['id', 'product_id', 'sku', 'main_stock', 'total_stock', 'stock_value', 'sales_30d', 'sell_through_rate', 'state'],
        limit: 0,
      });
      setItems(res || []);
    } catch (e: any) {
      setMessage({ type: 'error', text: 'Failed to fetch dead stock analysis: ' + e.message });
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    if (!selectedWhId) return;
    setGenerating(true);
    setMessage(null);
    try {
      const wizardId = await odooCall<number>('biz.dead.stock.generate', 'create', [{ warehouse_id: selectedWhId }]);
      await odooCall('biz.dead.stock.generate', 'action_generate', [[wizardId]]);
      setMessage({ type: 'success', text: 'Dead stock analysis compiled successfully.' });
      fetchAnalysis();
    } catch (e: any) {
      setMessage({ type: 'error', text: 'Recalculation failed: ' + e.message });
    } finally {
      setGenerating(false);
    }
  };

  const filtered = items.filter((item) => {
    const matchState = stateFilter === 'all' || item.state === stateFilter;
    const q = search.trim().toLowerCase();
    if (!q) return matchState;
    const productName = Array.isArray(item.product_id) ? item.product_id[1].toLowerCase() : '';
    const sku = (item.sku || '').toLowerCase();
    return matchState && (productName.includes(q) || sku.includes(q));
  });

  const totalValue = items.reduce((sum, item) => sum + item.stock_value, 0);
  const deadCount = items.filter(i => i.state === 'dead').length;
  const potentialCount = items.filter(i => i.state === 'potential').length;

  const glassClass = isDark ? 'glass' : 'glass-light bg-white/80';

  const stateFilterBtns: { key: StateFilter; label: string; activeClass: string }[] = [
    { key: 'all', label: 'All', activeClass: 'bg-[#8b5cf6]/20 text-[#a78bfa] border-[#8b5cf6]/30' },
    { key: 'dead', label: 'Dead Stock', activeClass: 'bg-red-500/15 text-red-400 border-red-500/25' },
    { key: 'potential', label: 'Potential Dead', activeClass: 'bg-amber-500/15 text-amber-400 border-amber-500/25' },
    { key: 'healthy', label: 'Healthy', activeClass: 'bg-green-500/15 text-green-400 border-green-500/25' },
  ];

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-6 animate-fade-in">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className={`text-2xl font-black ${isDark ? 'text-white' : 'text-gray-900'}`}>Dead Stock Analysis</h1>
          <p className={`text-xs mt-1 ${isDark ? 'text-[#5a6a8a]' : 'text-gray-500'}`}>
            Stagnant cash in warehouse inventory with less than 25% sell-through over 30 days.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={selectedWhId}
            onChange={(e) => setSelectedWhId(Number(e.target.value))}
            className={`px-3 py-1.5 text-xs font-semibold rounded-xl border focus:outline-none focus:border-brand-violet ${
              isDark ? 'bg-[#1f2937]/90 border-white/10 text-white' : 'bg-gray-50 border-gray-200 text-gray-800'
            }`}
          >
            {warehouses.map(wh => (
              <option key={wh.id} value={wh.id}>{wh.name}</option>
            ))}
          </select>

          <button
            onClick={handleGenerate}
            disabled={generating || loading}
            className="btn-secondary text-xs px-3.5 py-1.5"
          >
            <RefreshCw className={`w-4 h-4 ${generating ? 'animate-spin' : ''}`} />
            Run Analysis
          </button>
        </div>
      </div>

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

      {/* Financial stats summary */}
      {!loading && items.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className={`card p-5 space-y-1 ${glassClass}`}>
            <span className={`text-[10px] uppercase tracking-wider font-semibold ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Tied Up Capital</span>
            <p className={`text-2xl font-black ${isDark ? 'text-white' : 'text-gray-900'}`}>Rs. {totalValue.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          </div>
          <div className={`card p-5 space-y-1 ${glassClass}`}>
            <span className="text-[10px] uppercase tracking-wider text-red-400 font-semibold">Dead Stock Items</span>
            <p className="text-2xl font-black text-red-400">{deadCount} lines</p>
            <span className={`text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Sell-through &lt; 10%</span>
          </div>
          <div className={`card p-5 space-y-1 ${glassClass}`}>
            <span className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold">Potential Dead</span>
            <p className="text-2xl font-black text-amber-400">{potentialCount} lines</p>
            <span className={`text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Sell-through &lt; 25%</span>
          </div>
        </div>
      )}

      {/* Search + State Filter bar */}
      {!loading && items.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
          <input
            type="text"
            placeholder="Search product or SKU..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`px-3 py-1.5 text-xs rounded-xl border focus:outline-none focus:border-brand-violet w-full sm:w-56 ${
              isDark ? 'bg-[#1f2937]/90 border-white/10 text-white placeholder-gray-600' : 'bg-gray-50 border-gray-200 text-gray-800'
            }`}
          />
          <div className="flex gap-1.5 flex-wrap">
            {stateFilterBtns.map(({ key, label, activeClass }) => (
              <button
                key={key}
                onClick={() => setStateFilter(key)}
                className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border transition-colors ${
                  stateFilter === key
                    ? activeClass
                    : isDark
                      ? 'border-white/10 text-gray-500 hover:text-gray-300'
                      : 'border-gray-200 text-gray-400 hover:text-gray-600'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="h-64 flex items-center justify-center">
          <RefreshCw className="w-8 h-8 animate-spin text-[#8b5cf6]" />
        </div>
      ) : items.length === 0 ? (
        <div className={`card p-12 text-center rounded-2xl flex flex-col items-center gap-3 ${glassClass}`}>
          <CheckCircle2 className="w-12 h-12 text-green-400 animate-pulse" />
          <p className={isDark ? 'text-gray-400' : 'text-gray-500'}>Inventory health looks great! No dead stock records registered.</p>
        </div>
      ) : (
        <>
          {/* Mobile Grid list */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 lg:hidden">
            {filtered.map((item) => (
              <div key={item.id} className={`card p-4 rounded-2xl space-y-3 ${glassClass}`}>
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0">
                    <h3 className={`font-bold truncate ${isDark ? 'text-white' : 'text-gray-800'}`}>
                      {Array.isArray(item.product_id) ? item.product_id[1] : item.sku}
                    </h3>
                    {item.sku && <p className={`text-[10px] font-mono ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>{item.sku}</p>}
                  </div>
                  <span className={`flex-shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                    item.state === 'dead' ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                  }`}>
                    {item.state === 'dead' ? 'Dead Stock' : 'Potential'}
                  </span>
                </div>

                <div className={`grid grid-cols-2 gap-2 text-center border-t border-b py-3 my-3 ${isDark ? 'border-white/5' : 'border-gray-100'}`}>
                  <div>
                    <span className={`text-[9px] uppercase tracking-wider ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Main Stock</span>
                    <p className={`font-bold text-sm mt-0.5 ${isDark ? 'text-white' : 'text-gray-800'}`}>{item.main_stock}</p>
                  </div>
                  <div>
                    <span className={`text-[9px] uppercase tracking-wider ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Sales 30D</span>
                    <p className={`font-bold text-sm mt-0.5 ${isDark ? 'text-white' : 'text-gray-800'}`}>{item.sales_30d}</p>
                  </div>
                </div>

                <div className="flex justify-between items-center text-xs">
                  <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>Value</span>
                  <span className="font-bold text-amber-400 text-sm">Rs. {item.stock_value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                </div>

                <div className="flex justify-between items-center text-xs">
                  <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>Sell-Through Rate</span>
                  <span className={`font-extrabold flex items-center gap-1 text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>
                    <TrendingDown className="w-3.5 h-3.5 text-red-400" />
                    {(Number(item.sell_through_rate) || 0).toFixed(1)} %
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop Table view */}
          <div className={`hidden lg:block card rounded-2xl overflow-hidden ${glassClass}`}>
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className={`border-b text-xs font-semibold uppercase tracking-wider ${isDark ? 'border-white/5 bg-[#111827]/40 text-gray-400' : 'border-gray-200 bg-gray-50 text-gray-500'}`}>
                  <th className="py-4 px-6">Product / SKU</th>
                  <th className="py-4 px-6 text-right">Main Stock</th>
                  <th className="py-4 px-6 text-right">Total Stock</th>
                  <th className="py-4 px-6 text-right">Sales (Last 30D)</th>
                  <th className="py-4 px-6 text-right">Sell-Through %</th>
                  <th className="py-4 px-6 text-right">Amount</th>
                  <th className="py-4 px-6 text-center">Status</th>
                </tr>
              </thead>
              <tbody className={`divide-y text-sm ${isDark ? 'divide-white/5' : 'divide-gray-100'}`}>
                {filtered.map((item) => (
                  <tr key={item.id} className={`transition-colors ${isDark ? 'hover:bg-white/5' : 'hover:bg-gray-50'}`}>
                    <td className={`py-4 px-6 font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                      <div>{Array.isArray(item.product_id) ? item.product_id[1] : item.sku}</div>
                      {item.sku && <div className={`text-[10px] font-mono ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>{item.sku}</div>}
                    </td>
                    <td className={`py-4 px-6 text-right font-medium ${isDark ? 'text-white' : 'text-gray-800'}`}>{item.main_stock}</td>
                    <td className={`py-4 px-6 text-right font-semibold ${isDark ? 'text-white' : 'text-gray-800'}`}>{item.total_stock}</td>
                    <td className={`py-4 px-6 text-right ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>{item.sales_30d}</td>
                    <td className="py-4 px-6 text-right font-extrabold text-red-400">
                      {(Number(item.sell_through_rate) || 0).toFixed(1)} %
                    </td>
                    <td className="py-4 px-6 text-right text-amber-500 font-bold">
                      Rs. {item.stock_value.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-4 px-6 text-center">
                      <span className={`inline-block text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full ${
                        item.state === 'dead'
                          ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                          : item.state === 'potential'
                            ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                            : 'bg-green-500/10 text-green-400 border border-green-500/20'
                      }`}>
                        {item.state === 'dead' ? 'Dead Stock' : item.state === 'potential' ? 'Potential Dead' : 'Healthy'}
                      </span>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className={`py-10 text-center text-sm ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                      No records match the current filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
