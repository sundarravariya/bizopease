import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { searchRead, searchCount, readGroup, getSum } from '../../services/odoo';
import {
  TrendingUp, ShoppingCart, Package,
  IndianRupee, Users, RefreshCw, ArrowUpRight,
  Clock, CheckCircle2, AlertCircle, Activity,
  Zap, CreditCard, FileText, BarChart2
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts';

const fmt = (raw: unknown) => {
  const n = Number(raw) || 0;
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(1)}Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`;
  if (n >= 1e3) return `₹${(n / 1e3).toFixed(1)}K`;
  return `₹${n.toFixed(0)}`;
};

interface KpiProps {
  title: string;
  value: string;
  sub: string;
  icon: React.ElementType;
  gradient: string;
  isDark: boolean;
}

function KpiCard({ title, value, sub, icon: Icon, gradient, isDark }: KpiProps) {
  return (
    <div className="card p-5 flex items-start justify-between hover:shadow-xl transition-all duration-300">
      <div>
        <p className={`text-xs font-semibold uppercase tracking-wider ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>{title}</p>
        <p className={`text-2xl font-black mt-1.5 ${isDark ? 'text-white' : 'text-gray-900'}`}>{value}</p>
        <p className={`text-xs mt-0.5 ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>{sub}</p>
      </div>
      <div className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${gradient}`}>
        <Icon size={20} className="text-white" />
      </div>
    </div>
  );
}

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const PIE_COLORS = ['#7367f0','#3d5af1','#06b6d4','#10b981','#f59e0b'];

const STATE_MAP: Record<string, { label: string; cls: string }> = {
  draft:      { label: 'Draft',     cls: 'badge-gray' },
  sent:       { label: 'Sent',      cls: 'badge-violet' },
  sale:       { label: 'Confirmed', cls: 'badge-green' },
  done:       { label: 'Done',      cls: 'badge-green' },
  cancel:     { label: 'Cancelled', cls: 'badge-red' },
};

export default function Dashboard() {
  const { isDark } = useTheme();
  const { user } = useAuth();
  // App routes are nested under /:workspace — prefix quick-action links so they resolve.
  const { workspace } = useParams();
  const ws = workspace || user?.db || 'robifel';

  const [kpis, setKpis] = useState({ sales: 0, purchase: 0, invoices: 0, products: 0, revenue: 0, receivable: 0 });
  const [recentOrders, setRecentOrders] = useState<any[]>([]);
  const [monthlyData, setMonthlyData] = useState<{ month: string; revenue: number; orders: number }[]>([]);
  const [categoryData, setCategoryData] = useState<{ name: string; value: number; color: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<'week' | 'month' | 'year'>('month');

  const gridColor = isDark ? '#2a3250' : '#e5e7eb';
  const textColor = isDark ? '#5a6a8a' : '#9ca3af';

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);
    try {
      await Promise.all([loadKpis(), loadRecentOrders(), loadCharts()]);
    } finally {
      setLoading(false);
    }
  }

  async function loadKpis() {
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

    const [sales, purchase, invoices, products, revenue, receivable] = await Promise.allSettled([
      searchCount('sale.order', [['state', 'in', ['sale', 'done']]]),
      searchCount('purchase.order', [['state', 'in', ['purchase', 'done']]]),
      searchCount('account.move', [['move_type', '=', 'out_invoice'], ['state', '=', 'posted']]),
      searchCount('product.template', [['active', '=', true]]),
      getSum('sale.order', [['state', 'in', ['sale', 'done']], ['date_order', '>=', monthStart]], 'amount_total'),
      getSum('account.move', [['move_type', '=', 'out_invoice'], ['payment_state', 'not in', ['paid', 'in_payment']], ['state', '=', 'posted']], 'amount_residual'),
    ]);

    setKpis({
      sales:      sales.status === 'fulfilled' ? sales.value : 0,
      purchase:   purchase.status === 'fulfilled' ? purchase.value : 0,
      invoices:   invoices.status === 'fulfilled' ? invoices.value : 0,
      products:   products.status === 'fulfilled' ? products.value : 0,
      revenue:    revenue.status === 'fulfilled' ? revenue.value : 0,
      receivable: receivable.status === 'fulfilled' ? receivable.value : 0,
    });
  }

  async function loadRecentOrders() {
    try {
      const orders = await searchRead<any>('sale.order', {
        domain: [],
        fields: ['name', 'partner_id', 'amount_total', 'state', 'date_order'],
        limit: 8,
        order: 'date_order desc',
      });
      setRecentOrders(Array.isArray(orders) ? orders : []);
    } catch {
      setRecentOrders([]);
    }
  }

  async function loadCharts() {
    try {
      const now = new Date();
      const yearStart = `${now.getFullYear()}-01-01`;

      // Monthly revenue grouped by month
      const monthly = await readGroup<any>('sale.order', {
        domain: [['state', 'in', ['sale', 'done']], ['date_order', '>=', yearStart]],
        fields: ['amount_total:sum', 'date_order:count'],
        groupby: ['date_order:month'],
        orderby: 'date_order asc',
      });

      const chartData = (monthly || []).map((row: any) => {
        const label = row['date_order:month'] || '';
        const monthIdx = MONTH_LABELS.findIndex(m =>
          label.toLowerCase().includes(m.toLowerCase())
        );
        return {
          month: monthIdx >= 0 ? MONTH_LABELS[monthIdx] : label.slice(0, 3),
          revenue: Math.round(row.amount_total || 0),
          orders: row.date_order_count || 0,
        };
      });
      setMonthlyData(chartData);

      // Product categories
      const catGroup = await readGroup<any>('product.template', {
        domain: [['active', '=', true]],
        fields: ['categ_id'],
        groupby: ['categ_id'],
        limit: 5,
        orderby: 'categ_id_count desc',
      });
      const total = (catGroup || []).reduce((s: number, r: any) => s + (r.categ_id_count || 0), 0) || 1;
      setCategoryData(
        (catGroup || []).slice(0, 5).map((r: any, i: number) => ({
          name: Array.isArray(r.categ_id) ? r.categ_id[1] : (r.categ_id || 'Other'),
          value: Math.round(((r.categ_id_count || 0) / total) * 100),
          color: PIE_COLORS[i % PIE_COLORS.length],
        }))
      );
    } catch {
      setMonthlyData([]);
      setCategoryData([]);
    }
  }

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className={`rounded-xl border px-3 py-2.5 shadow-2xl text-xs ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : 'bg-white border-gray-200 text-gray-900'}`}>
        <p className="font-bold mb-1">{label}</p>
        {payload.map((p: any) => (
          <p key={p.name} style={{ color: p.color }}>
            {p.name}: {p.name === 'Revenue' ? fmt(p.value) : p.value}
          </p>
        ))}
      </div>
    );
  };

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className={`text-2xl font-black ${isDark ? 'text-white' : 'text-gray-900'}`}>
            {greeting}, {user?.name?.split(' ')[0] || 'Admin'} 👋
          </h1>
          <p className={`text-sm mt-1 ${isDark ? 'text-[#5a6a8a]' : 'text-gray-500'}`}>
            Here's what's happening with your Robifel business today
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className={`flex rounded-xl border p-1 ${isDark ? 'border-[#2a3250] bg-[#1e2440]' : 'border-gray-200 bg-gray-50'}`}>
            {(['week', 'month', 'year'] as const).map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all ${period === p ? 'bg-[#7367f0] text-white shadow-md' : isDark ? 'text-[#6a7a9a] hover:text-white' : 'text-gray-500 hover:text-gray-900'}`}>
                {p}
              </button>
            ))}
          </div>
          <button onClick={loadAll} disabled={loading}
            className="btn-secondary text-xs px-3 py-2">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard title="Revenue This Month" value={loading ? '...' : fmt(kpis.revenue)}
          sub="Confirmed sales" icon={IndianRupee}
          gradient="bg-gradient-to-br from-[#7367f0] to-[#5a52e0]" isDark={isDark} />
        <KpiCard title="Sales Orders" value={loading ? '...' : kpis.sales.toString()}
          sub="Confirmed & done" icon={ShoppingCart}
          gradient="bg-gradient-to-br from-[#3d5af1] to-[#06b6d4]" isDark={isDark} />
        <KpiCard title="Products" value={loading ? '...' : kpis.products.toString()}
          sub="Active in catalog" icon={Package}
          gradient="bg-gradient-to-br from-[#10b981] to-[#059669]" isDark={isDark} />
        <KpiCard title="Receivables" value={loading ? '...' : fmt(kpis.receivable)}
          sub="Outstanding invoices" icon={CreditCard}
          gradient="bg-gradient-to-br from-[#f59e0b] to-[#ef4444]" isDark={isDark} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Revenue Area Chart */}
        <div className="card p-5 xl:col-span-2">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className={`font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>Revenue Overview</h3>
              <p className={`text-xs mt-0.5 ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>Monthly sales revenue — current year</p>
            </div>
            <div className="flex gap-4 text-xs">
              <span className="flex items-center gap-1.5"><span className="w-3 h-1 rounded-full bg-[#7367f0]" /><span className={isDark ? 'text-[#6a7a9a]' : 'text-gray-400'}>Revenue</span></span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-1 rounded-full bg-[#06b6d4]" /><span className={isDark ? 'text-[#6a7a9a]' : 'text-gray-400'}>Orders</span></span>
            </div>
          </div>
          {monthlyData.length === 0 && !loading ? (
            <div className="h-[220px] flex flex-col items-center justify-center gap-2">
              <BarChart2 size={36} className="text-[#2a3250]" />
              <p className={`text-sm ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>No sales data yet for this year</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={monthlyData}>
                <defs>
                  <linearGradient id="colRev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#7367f0" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#7367f0" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colOrd" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: textColor }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: textColor }} axisLine={false} tickLine={false} tickFormatter={v => fmt(v)} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#7367f0" strokeWidth={2.5} fill="url(#colRev)" dot={false} />
                <Area type="monotone" dataKey="orders" name="Orders" stroke="#06b6d4" strokeWidth={2.5} fill="url(#colOrd)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Category Donut */}
        <div className="card p-5">
          <div className="mb-4">
            <h3 className={`font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>Products by Category</h3>
            <p className={`text-xs mt-0.5 ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>Top 5 categories</p>
          </div>
          {categoryData.length === 0 ? (
            <div className="h-[160px] flex items-center justify-center">
              <p className={`text-xs ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>No data</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie data={categoryData} cx="50%" cy="50%" innerRadius={45} outerRadius={70} dataKey="value" paddingAngle={3}>
                  {categoryData.map((_, i) => <Cell key={i} fill={categoryData[i].color} />)}
                </Pie>
                <Tooltip formatter={(v) => `${v}%`}
                  contentStyle={{ background: isDark ? '#1e2440' : '#fff', border: isDark ? '1px solid #2a3250' : '1px solid #e5e7eb', borderRadius: 12, fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
          <div className="space-y-2 mt-2">
            {categoryData.map(cat => (
              <div key={cat.name} className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: cat.color }} />
                  <span className={`truncate max-w-[130px] ${isDark ? 'text-[#8897b5]' : 'text-gray-600'}`}>{cat.name}</span>
                </span>
                <span className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>{cat.value}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Recent Orders */}
        <div className="card xl:col-span-2 overflow-hidden">
          <div className={`flex items-center justify-between px-5 py-4 border-b ${isDark ? 'border-[#2a3250]' : 'border-gray-100'}`}>
            <div>
              <h3 className={`font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>Recent Orders</h3>
              <p className={`text-xs mt-0.5 ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>Latest sales activity from Odoo</p>
            </div>
            <button onClick={loadRecentOrders} className="btn-secondary text-xs px-3 py-1.5">Refresh</button>
          </div>
          <div className="overflow-x-auto">
            {recentOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-2">
                <ShoppingCart size={32} className="text-[#2a3250]" />
                <p className={`text-sm ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>
                  {loading ? 'Loading orders...' : 'No orders found'}
                </p>
              </div>
            ) : (
              <table className="data-table w-full">
                <thead>
                  <tr>
                    <th>Order #</th>
                    <th>Customer</th>
                    <th className="text-right">Amount</th>
                    <th className="text-center">Status</th>
                    <th className="text-right">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {recentOrders.map(order => (
                    <tr key={order.id}>
                      <td className="font-semibold text-[#7367f0] font-mono text-xs">{order.name}</td>
                      <td className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                        {Array.isArray(order.partner_id) ? order.partner_id[1] : order.partner_id || '—'}
                      </td>
                      <td className={`text-right font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                        ₹{(order.amount_total || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                      </td>
                      <td className="text-center">
                        <span className={STATE_MAP[order.state]?.cls || 'badge-gray'}>
                          {STATE_MAP[order.state]?.label || order.state}
                        </span>
                      </td>
                      <td className={`text-right text-xs ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>
                        {order.date_order ? new Date(order.date_order).toLocaleDateString('en-IN') : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Quick stats + actions */}
        <div className="space-y-4">
          <div className="card p-4">
            <h3 className={`font-bold text-sm mb-3 ${isDark ? 'text-white' : 'text-gray-900'}`}>Quick Stats</h3>
            <div className="space-y-3">
              {[
                { label: 'Open Purchases', value: loading ? '...' : kpis.purchase.toString(), icon: Package, color: 'text-[#7367f0]' },
                { label: 'Posted Invoices', value: loading ? '...' : kpis.invoices.toString(), icon: FileText, color: 'text-green-400' },
                { label: 'Total Products', value: loading ? '...' : kpis.products.toString(), icon: Package, color: 'text-blue-400' },
              ].map(s => (
                <div key={s.label} className={`flex items-center justify-between py-2 border-b last:border-0 ${isDark ? 'border-[#2a3250]' : 'border-gray-100'}`}>
                  <div className="flex items-center gap-2">
                    <s.icon size={14} className={s.color} />
                    <span className={`text-xs ${isDark ? 'text-[#8897b5]' : 'text-gray-600'}`}>{s.label}</span>
                  </div>
                  <span className={`text-sm font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>{s.value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card p-4">
            <h3 className={`font-bold text-sm mb-3 ${isDark ? 'text-white' : 'text-gray-900'}`}>Quick Actions</h3>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'New Order', icon: ShoppingCart, color: '#7367f0', path: '/sales/orders' },
                { label: 'FBF Report', icon: Zap, color: '#06b6d4', path: '/flipkart/fbf' },
                { label: 'New Invoice', icon: FileText, color: '#f59e0b', path: '/accounting/invoices' },
                { label: 'Dead Stock', icon: TrendingUp, color: '#10b981', path: '/flipkart/deadstock' },
              ].map(a => (
                <Link key={a.label} to={`/${ws}${a.path}`}
                  className={`flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl border text-xs font-medium transition-all hover:scale-[1.02] ${isDark ? 'border-[#2a3250] hover:border-[#7367f0]/50 hover:bg-[#7367f0]/5 text-gray-300' : 'border-gray-200 hover:border-violet-300 hover:bg-violet-50 text-gray-600'}`}>
                  <a.icon size={18} style={{ color: a.color }} />
                  {a.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
