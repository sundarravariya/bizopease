import { useState, useEffect } from 'react';
import { odooCall } from '../../../services/odoo';
import { useTheme } from '../../../context/ThemeContext';
import { RefreshCw, AlertCircle, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

// Native (non-Flipkart) Stock Valuation — reads biz.stock.valuation,
// BOM-exploded over the main warehouse only (no FBF dimension).

interface ValuationItem {
  id: number;
  product_id: [number, string] | false;
  category_id: [number, string] | false;
  cost_price: number;
  main_qty: number;
  main_valuation: number;
  total_qty: number;
  total_valuation: number;
  last_updated: string | false;
}

export default function BizStockValuation() {
  const { isDark } = useTheme();
  const [valuations, setValuations] = useState<ValuationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [inStockOnly, setInStockOnly] = useState(true);

  useEffect(() => {
    fetchValuations();
  }, []);

  const fetchValuations = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await odooCall<ValuationItem[]>('biz.stock.valuation', 'search_read', [[]], {
        fields: [
          'id', 'product_id', 'category_id', 'cost_price',
          'main_qty', 'main_valuation',
          'total_qty', 'total_valuation',
          'last_updated',
        ],
        limit: 0,
      });
      setValuations(res || []);
    } catch (e: any) {
      setMessage({ type: 'error', text: 'Failed to load valuations: ' + e.message });
      setValuations([]);
    } finally {
      setLoading(false);
    }
  };

  const handleRecalculate = async () => {
    setRecalculating(true);
    setMessage(null);
    try {
      await odooCall('biz.stock.valuation', 'action_recalculate', [[]], {});
      await fetchValuations();
      setMessage({ type: 'success', text: 'Valuation recalculated successfully.' });
    } catch (err: any) {
      setMessage({ type: 'error', text: 'Recalculate failed: ' + (err?.message || 'Unknown error') });
    } finally {
      setRecalculating(false);
    }
  };

  // Unique categories for filter dropdown
  const categories = Array.from(
    new Map(
      valuations
        .filter((v) => Array.isArray(v.category_id))
        .map((v) => [(v.category_id as [number, string])[0], (v.category_id as [number, string])[1]])
    ).entries()
  ).sort((a, b) => a[1].localeCompare(b[1]));

  const filtered = valuations.filter((item) => {
    if (inStockOnly && (item.total_qty || 0) <= 0) return false;
    if (categoryFilter) {
      if (!Array.isArray(item.category_id)) return false;
      if (String(item.category_id[0]) !== categoryFilter) return false;
    }
    const q = search.trim().toLowerCase();
    if (!q) return true;
    const productName = Array.isArray(item.product_id) ? item.product_id[1].toLowerCase() : '';
    const catName = Array.isArray(item.category_id) ? item.category_id[1].toLowerCase() : '';
    return productName.includes(q) || catName.includes(q);
  });

  const totalCapitalAtRisk = filtered.reduce((sum, item) => sum + (item.total_valuation || 0), 0);
  const totalUnits = filtered.reduce((sum, item) => sum + (item.total_qty || 0), 0);

  // Capital by category (top 6) for the distribution chart.
  const byCategory = new Map<string, number>();
  for (const item of filtered) {
    const cat = Array.isArray(item.category_id) ? item.category_id[1] : 'Uncategorized';
    byCategory.set(cat, (byCategory.get(cat) || 0) + (item.total_valuation || 0));
  }
  const chartData = Array.from(byCategory.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  const glassClass = isDark ? 'glass' : 'glass-light bg-white/80';
  const gridColor = isDark ? '#2a3250' : '#e5e7eb';
  const tickColor = isDark ? '#5a6a8a' : '#9ca3af';

  const formatRs = (val: number) =>
    'Rs. ' + (Number(val) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });

  const formatQty = (val: number) =>
    (Number(val) || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });

  const formatDate = (val: string | false) => {
    if (!val) return '--';
    try {
      return new Date(val).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
    } catch {
      return '--';
    }
  };

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className={`text-2xl font-black ${isDark ? 'text-white' : 'text-gray-900'}`}>Stock Valuation</h1>
          <p className={`text-xs mt-1 ${isDark ? 'text-[#5a6a8a]' : 'text-gray-500'}`}>
            BOM-exploded inventory valuation showing total capital-at-risk in the main warehouse.
          </p>
        </div>

        <button
          onClick={handleRecalculate}
          disabled={recalculating || loading}
          className="btn-secondary text-xs px-3.5 py-1.5"
        >
          <RefreshCw className={`w-4 h-4 ${recalculating ? 'animate-spin' : ''}`} />
          Recalculate Valuation
        </button>
      </div>

      {message && (
        <div className={`p-4 rounded-xl flex items-start gap-3 border ${
          message.type === 'success'
            ? 'bg-green-500/10 border-green-500/20 text-green-400'
            : 'bg-red-500/10 border-red-500/20 text-red-400'
        }`}>
          {message.type === 'success'
            ? <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
            : <AlertCircle className="w-5 h-5 flex-shrink-0" />}
          <span className="text-sm font-medium">{message.text}</span>
        </div>
      )}

      {/* Stats summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className={`card p-5 space-y-1 ${glassClass}`}>
          <span className={`text-[10px] uppercase tracking-wider font-semibold ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Total Capital At Risk</span>
          <p className={`text-2xl font-black text-brand-gold`}>Rs. {totalCapitalAtRisk.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
        </div>
        <div className={`card p-5 space-y-1 ${glassClass}`}>
          <span className={`text-[10px] uppercase tracking-wider font-semibold ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Total Units</span>
          <p className={`text-2xl font-black ${isDark ? 'text-white' : 'text-gray-900'}`}>{formatQty(totalUnits)}</p>
        </div>
        <div className={`card p-5 space-y-1 ${glassClass}`}>
          <span className={`text-[10px] uppercase tracking-wider font-semibold ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Component Lines</span>
          <p className={`text-2xl font-black ${isDark ? 'text-white' : 'text-gray-900'}`}>{filtered.length}</p>
        </div>
      </div>

      {/* Search + Filter bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center flex-wrap">
        <input
          type="text"
          placeholder="Search product or category..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={`px-3 py-1.5 text-xs rounded-xl border focus:outline-none focus:border-brand-violet w-full sm:w-56 ${
            isDark ? 'bg-[#1f2937]/90 border-white/10 text-white placeholder-gray-600' : 'bg-gray-50 border-gray-200 text-gray-800'
          }`}
        />
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className={`px-3 py-1.5 text-xs font-semibold rounded-xl border focus:outline-none focus:border-brand-violet ${
            isDark ? 'bg-[#1f2937]/90 border-white/10 text-white' : 'bg-gray-50 border-gray-200 text-gray-800'
          }`}
        >
          <option value="">All Categories</option>
          {categories.map(([id, name]) => (
            <option key={id} value={String(id)}>{name}</option>
          ))}
        </select>
        <button
          onClick={() => setInStockOnly((v) => !v)}
          className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border transition-colors ${
            inStockOnly
              ? 'bg-[#8b5cf6]/20 text-[#a78bfa] border-[#8b5cf6]/30'
              : isDark
                ? 'border-white/10 text-gray-500 hover:text-gray-300'
                : 'border-gray-200 text-gray-400 hover:text-gray-600'
          }`}
        >
          In Stock Only
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Component breakdown table */}
        <div className={`card lg:col-span-2 overflow-hidden ${glassClass}`}>
          <div className={`px-5 py-3 border-b ${isDark ? 'border-white/5 bg-[#111827]/20' : 'border-gray-100 bg-gray-50'}`}>
            <h3 className={`font-bold text-xs uppercase tracking-wider ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>BOM-Exploded Leaf Components</h3>
          </div>
          {loading ? (
            <div className="h-48 flex items-center justify-center">
              <RefreshCw className="w-6 h-6 animate-spin text-[#8b5cf6]" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[720px]">
                <thead>
                  <tr className={`border-b text-xs font-semibold uppercase tracking-wider ${isDark ? 'border-white/5 bg-[#111827]/40 text-gray-400' : 'border-gray-200 bg-gray-50 text-gray-500'}`}>
                    <th className="py-4 px-4">Product</th>
                    <th className="py-4 px-4">Category</th>
                    <th className="py-4 px-4 text-right">Main Qty</th>
                    <th className="py-4 px-4 text-right">Total Qty</th>
                    <th className="py-4 px-4 text-right">Unit Cost</th>
                    <th className="py-4 px-4 text-right">Total Value</th>
                    <th className="py-4 px-4 text-right">Last Updated</th>
                  </tr>
                </thead>
                <tbody className={`divide-y text-sm ${isDark ? 'divide-white/5' : 'divide-gray-100'}`}>
                  {filtered.map((item) => (
                    <tr key={item.id} className={`transition-colors ${isDark ? 'hover:bg-white/5' : 'hover:bg-gray-50'}`}>
                      <td className={`py-3 px-4 font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                        {Array.isArray(item.product_id) ? item.product_id[1] : '--'}
                      </td>
                      <td className={`py-3 px-4 text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                        {Array.isArray(item.category_id) ? item.category_id[1] : '--'}
                      </td>
                      <td className={`py-3 px-4 text-right ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>{formatQty(item.main_qty)}</td>
                      <td className={`py-3 px-4 text-right font-semibold ${isDark ? 'text-white' : 'text-gray-800'}`}>{formatQty(item.total_qty)}</td>
                      <td className={`py-3 px-4 text-right ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{formatRs(item.cost_price)}</td>
                      <td className="py-3 px-4 text-right font-bold text-amber-500">{formatRs(item.total_valuation)}</td>
                      <td className={`py-3 px-4 text-right text-[11px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{formatDate(item.last_updated)}</td>
                    </tr>
                  ))}
                  {filtered.length === 0 && !loading && (
                    <tr>
                      <td colSpan={7} className={`py-10 text-center text-sm ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                        No records match the current filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Capital by category chart */}
        <div className={`card p-5 flex flex-col justify-between ${glassClass}`}>
          <div className="space-y-1 mb-4">
            <h3 className={`font-bold text-sm ${isDark ? 'text-white' : 'text-gray-800'}`}>Capital by Category</h3>
            <p className={`text-[11px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Top categories by tied-up capital in the main warehouse.</p>
          </div>

          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                <XAxis dataKey="name" tick={{ fontSize: 9, fill: tickColor }} axisLine={false} tickLine={false} interval={0} angle={-20} textAnchor="end" height={50} />
                <YAxis tick={{ fontSize: 9, fill: tickColor }} axisLine={false} tickLine={false} />
                <Tooltip
                  formatter={(val: number) => formatRs(val)}
                  contentStyle={{ background: isDark ? '#1e2440' : '#fff', border: isDark ? '1px solid #2a3250' : '1px solid #e5e7eb', borderRadius: 8, fontSize: 11 }}
                />
                <Bar dataKey="value" name="Capital Value" fill="#8b5cf6" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className={`mt-4 p-3 rounded-xl border flex items-start gap-2.5 bg-amber-500/5 ${isDark ? 'border-amber-500/10' : 'border-amber-500/20'}`}>
            <ShieldAlert className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <span className={`text-[10px] leading-relaxed ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
              <strong>Note:</strong> Total capital represents Standard Cost price across leaf component quants, excluding parent assembly margin values.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
