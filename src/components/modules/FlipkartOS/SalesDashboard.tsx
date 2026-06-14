import { useState, useEffect } from 'react';
import { searchRead, readGroup, getSum, searchCount } from '../../../services/odoo';
import { useTheme } from '../../../context/ThemeContext';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import {
  ShoppingBag, TrendingUp, TrendingDown, RefreshCw,
  RotateCcw, Package, IndianRupee
} from 'lucide-react';

interface Account { id: number; name: string; }

const COLORS = ['#7367f0', '#3d5af1', '#06b6d4', '#10b981', '#f59e0b', '#ef4444'];

function fmt(raw: unknown) {
  const n = Number(raw) || 0;
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(1)}Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`;
  if (n >= 1e3) return `₹${(n / 1e3).toFixed(1)}K`;
  return `₹${n.toFixed(0)}`;
}

export default function SalesDashboard() {
  const { isDark } = useTheme();
  const [loading, setLoading] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState<number | ''>('');

  // Date range — default last 30 days
  const today = new Date().toISOString().split('T')[0];
  const d30ago = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  const [dateFrom, setDateFrom] = useState(d30ago);
  const [dateTo, setDateTo] = useState(today);

  const [kpis, setKpis] = useState({
    grossUnits: 0,
    gmv: 0,
    finalSalesAmt: 0,
    returnUnits: 0,
    cancelUnits: 0,
  });
  const [weeklyChart, setWeeklyChart] = useState<{ name: string; units: number; revenue: number }[]>([]);
  const [categoryChart, setCategoryChart] = useState<{ name: string; value: number }[]>([]);
  const [topProducts, setTopProducts] = useState<{ id: number; sku: string; units: number; amount: number }[]>([]);

  useEffect(() => {
    loadAccounts();
  }, []);

  useEffect(() => {
    load();
  }, [accountId, dateFrom, dateTo]);

  const loadAccounts = async () => {
    try {
      const r = await searchRead<Account>('flipkart.account', { fields: ['id', 'name'], limit: 50 });
      if (Array.isArray(r)) setAccounts(r);
    } catch {}
  };

  const buildDomain = () => {
    const d: any[] = [];
    if (accountId !== '') d.push(['account_id', '=', accountId]);
    if (dateFrom) d.push(['order_date', '>=', dateFrom]);
    if (dateTo) d.push(['order_date', '<=', dateTo]);
    return d;
  };

  const load = async () => {
    setLoading(true);
    try {
      const domain = buildDomain();

      const [weekly, cats, prods, gross, gmv, finalAmt, retU, cancelU] = await Promise.allSettled([
        readGroup<any>('flipkart.sales.dashboard', {
          domain,
          fields: ['final_sale_units:sum', 'final_sale_amount:sum'],
          groupby: ['order_date:week'],
          orderby: 'order_date asc',
          limit: 12,
        }),
        readGroup<any>('flipkart.sales.dashboard', {
          domain,
          fields: ['final_sale_amount:sum'],
          groupby: ['category'],
          orderby: 'final_sale_amount desc',
          limit: 6,
        }),
        readGroup<any>('flipkart.sales.dashboard', {
          domain,
          fields: ['final_sale_units:sum', 'final_sale_amount:sum'],
          groupby: ['sku_id'],
          orderby: 'final_sale_units desc',
          limit: 8,
        }),
        getSum('flipkart.sales.dashboard', domain, 'gross_units'),
        getSum('flipkart.sales.dashboard', domain, 'gmv'),
        getSum('flipkart.sales.dashboard', domain, 'final_sale_amount'),
        getSum('flipkart.sales.dashboard', domain, 'return_units'),
        getSum('flipkart.sales.dashboard', domain, 'cancellation_units'),
      ]);

      if (weekly.status === 'fulfilled' && Array.isArray(weekly.value)) {
        setWeeklyChart(weekly.value.map((r: any) => ({
          name: typeof r.order_date === 'string' ? r.order_date.slice(0, 10) : String(r.order_date ?? '').slice(0, 10),
          units: r.final_sale_units ?? 0,
          revenue: r.final_sale_amount ?? 0,
        })));
      } else setWeeklyChart([]);

      if (cats.status === 'fulfilled' && Array.isArray(cats.value)) {
        setCategoryChart(cats.value
          .filter((r: any) => r.category)
          .map((r: any) => ({ name: r.category, value: r.final_sale_amount ?? 0 })));
      } else setCategoryChart([]);

      if (prods.status === 'fulfilled' && Array.isArray(prods.value)) {
        setTopProducts(prods.value
          .filter((r: any) => r.sku_id)
          .map((r: any, i: number) => ({
            id: i,
            sku: r.sku_id,
            units: r.final_sale_units ?? 0,
            amount: r.final_sale_amount ?? 0,
          })));
      } else setTopProducts([]);

      setKpis({
        grossUnits: gross.status === 'fulfilled' ? gross.value : 0,
        gmv: gmv.status === 'fulfilled' ? gmv.value : 0,
        finalSalesAmt: finalAmt.status === 'fulfilled' ? finalAmt.value : 0,
        returnUnits: retU.status === 'fulfilled' ? retU.value : 0,
        cancelUnits: cancelU.status === 'fulfilled' ? cancelU.value : 0,
      });
    } finally {
      setLoading(false);
    }
  };

  const returnRate = kpis.grossUnits > 0 ? ((kpis.returnUnits / kpis.grossUnits) * 100).toFixed(1) : '0.0';
  const cancelRate = kpis.grossUnits > 0 ? ((kpis.cancelUnits / kpis.grossUnits) * 100).toFixed(1) : '0.0';

  const gridColor = isDark ? '#2a3250' : '#e5e7eb';
  const tickColor = isDark ? '#5a6a8a' : '#9ca3af';

  const KPI = ({ label, value, sub, icon: Icon, color }: any) => (
    <div className="card p-4 flex items-start justify-between">
      <div className="space-y-1">
        <p className={`text-[10px] font-bold uppercase tracking-wider ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>{label}</p>
        <p className={`text-2xl font-black ${isDark ? 'text-white' : 'text-gray-900'}`}>{value}</p>
        {sub && <p className={`text-[10px] ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>{sub}</p>}
      </div>
      <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${color}20` }}>
        <Icon size={18} style={{ color }} />
      </div>
    </div>
  );

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className={`text-xl font-black ${isDark ? 'text-white' : 'text-gray-900'}`}>Flipkart Sales Dashboard</h1>
          <p className={`text-xs mt-0.5 ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>
            Real data from uploaded Flipkart sales reports
          </p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <select value={accountId} onChange={e => setAccountId(e.target.value ? Number(e.target.value) : '')}
            className={`input text-xs py-1.5 px-3 ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`}>
            <option value="">All Accounts</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className={`input text-xs py-1.5 ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`} />
          <span className={`text-xs ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>to</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className={`input text-xs py-1.5 ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`} />
          <button onClick={load} disabled={loading} className="btn-secondary text-xs px-3 py-1.5">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <KPI label="Gross Units" value={kpis.grossUnits.toLocaleString('en-IN')} icon={Package} color="#7367f0" />
        <KPI label="GMV" value={fmt(kpis.gmv)} sub="Gross Merchandise Value" icon={IndianRupee} color="#10b981" />
        <KPI label="Final Sales" value={fmt(kpis.finalSalesAmt)} sub="After returns/cancels" icon={ShoppingBag} color="#3d5af1" />
        <KPI label="Return Rate" value={`${returnRate}%`} sub={`${kpis.returnUnits.toLocaleString()} units returned`} icon={RotateCcw} color="#ef4444" />
        <KPI label="Cancel Rate" value={`${cancelRate}%`} sub={`${kpis.cancelUnits.toLocaleString()} cancelled`} icon={TrendingDown} color="#f59e0b" />
      </div>

      {loading ? (
        <div className="card h-48 flex items-center justify-center gap-3">
          <RefreshCw size={18} className="animate-spin text-[#7367f0]" />
          <span className={`text-sm ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>Loading sales data...</span>
        </div>
      ) : weeklyChart.length === 0 && categoryChart.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-20 gap-3">
          <ShoppingBag size={40} className="text-[#2a3250]" />
          <p className={`text-sm ${isDark ? 'text-[#5a6a8a]' : 'text-gray-500'}`}>
            No sales data found for this period. Upload a Flipkart Sales CSV to see charts.
          </p>
        </div>
      ) : (
        <>
          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Weekly Trend */}
            {weeklyChart.length > 0 && (
              <div className="card p-5 lg:col-span-2">
                <h3 className={`font-bold text-sm mb-4 ${isDark ? 'text-white' : 'text-gray-800'}`}>Weekly Sales Units</h3>
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={weeklyChart}>
                      <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                      <XAxis dataKey="name" tick={{ fontSize: 9, fill: tickColor }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 9, fill: tickColor }} axisLine={false} tickLine={false} />
                      <Tooltip
                        formatter={(val: number, name: string) => [
                          name === 'revenue' ? fmt(val) : val.toLocaleString('en-IN'),
                          name === 'revenue' ? 'Revenue' : 'Units',
                        ]}
                        contentStyle={{ background: isDark ? '#1e2440' : '#fff', border: `1px solid ${gridColor}`, borderRadius: 8, fontSize: 11 }}
                      />
                      <Bar dataKey="units" fill="#7367f0" radius={[4, 4, 0, 0]} name="units" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Category Pie */}
            {categoryChart.length > 0 && (
              <div className="card p-5">
                <h3 className={`font-bold text-sm mb-4 ${isDark ? 'text-white' : 'text-gray-800'}`}>Revenue by Category</h3>
                <div className="h-40 flex justify-center">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={categoryChart} cx="50%" cy="50%" innerRadius={40} outerRadius={60} paddingAngle={4} dataKey="value">
                        {categoryChart.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Tooltip formatter={(val: number) => fmt(val)}
                        contentStyle={{ background: isDark ? '#1e2440' : '#fff', border: `1px solid ${gridColor}`, borderRadius: 8, fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-3 space-y-1">
                  {categoryChart.slice(0, 4).map((c, i) => (
                    <div key={c.name} className="flex items-center gap-2 text-xs">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                      <span className={`truncate flex-1 ${isDark ? 'text-[#8897b5]' : 'text-gray-600'}`}>{c.name || 'Uncategorised'}</span>
                      <span className={`font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>{fmt(c.value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Top Products Table */}
          {topProducts.length > 0 && (
            <div className="card overflow-hidden">
              <div className={`px-4 py-3 border-b ${isDark ? 'border-[#2a3250]' : 'border-gray-100'}`}>
                <h3 className={`text-xs font-semibold uppercase tracking-wider ${isDark ? 'text-[#5a6a8a]' : 'text-gray-500'}`}>Top SKUs by Units Sold</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="data-table w-full">
                  <thead>
                    <tr>
                      <th>SKU / Product ID</th>
                      <th className="text-right">Final Sale Units</th>
                      <th className="text-right">Final Sale Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topProducts.map(p => (
                      <tr key={p.id}>
                        <td className={`font-mono text-xs font-medium ${isDark ? 'text-[#7367f0]' : 'text-violet-600'}`}>{p.sku}</td>
                        <td className={`text-right font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>{p.units.toLocaleString('en-IN')}</td>
                        <td className={`text-right font-bold text-[#7367f0]`}>{fmt(p.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
