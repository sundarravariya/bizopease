import { useState, useEffect } from 'react';
import { searchRead, readGroup, getSum } from '../../../services/odoo';
import { useTheme } from '../../../context/ThemeContext';
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import {
  ShoppingBag, TrendingDown, RefreshCw,
  RotateCcw, Package, IndianRupee, Calculator
} from 'lucide-react';

const COLORS = ['#7367f0', '#3d5af1', '#06b6d4', '#10b981', '#f59e0b', '#ef4444'];

function fmt(raw: unknown) {
  const n = Number(raw) || 0;
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(1)}Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`;
  if (n >= 1e3) return `₹${(n / 1e3).toFixed(1)}K`;
  return `₹${n.toFixed(0)}`;
}

// Native (non-Flipkart) Sales Dashboard — same UI as the Flipkart Sales
// Dashboard, but every figure is computed LIVE from native Odoo data
// (sale.report for units/revenue/category, account.move for returns,
// product.product + mrp.bom for the COGS roll-up). No Flipkart models.
export default function BizSalesDashboard() {
  const { isDark } = useTheme();
  const [loading, setLoading] = useState(false);

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
    returnAmt: 0,
    cogs: 0,
  });
  const [cogsLoading, setCogsLoading] = useState(false);
  const [weeklyChart, setWeeklyChart] = useState<{ name: string; units: number; revenue: number }[]>([]);
  const [categoryChart, setCategoryChart] = useState<{ name: string; value: number }[]>([]);
  const [topProducts, setTopProducts] = useState<{ id: number; sku: string; units: number; amount: number }[]>([]);

  // SKU-level sales records (one row per product, aggregated over the range)
  const [rows, setRows] = useState<any[]>([]);
  const [rowOffset, setRowOffset] = useState(0);
  const [rowTotal, setRowTotal] = useState(0);
  const ROW_LIMIT = 50;

  useEffect(() => {
    load();
  }, [dateFrom, dateTo]);

  // Confirmed-sales domain over Odoo's native Sales Analysis view (sale.report).
  const buildDomain = () => {
    const d: any[] = [['state', 'in', ['sale', 'done']]];
    if (dateFrom) d.push(['date', '>=', `${dateFrom} 00:00:00`]);
    if (dateTo) d.push(['date', '<=', `${dateTo} 23:59:59`]);
    return d;
  };

  /**
   * Recursively expand phantom BOMs for a set of product IDs.
   * Returns a map: { kitProductId → { leafProductId → totalQtyPerKitUnit } }.
   * Handles NESTED phantom BOMs and template-level BOMs (product_id NULL).
   */
  const expandPhantomBoms = async (
    productIds: number[],
  ): Promise<Record<number, Record<number, number>>> => {
    const kitLeafQtys: Record<number, Record<number, number>> = {};
    const pidToTmpl: Record<number, number> = {};

    const ensureTmpls = async (pids: number[]) => {
      const missing = pids.filter(p => !(p in pidToTmpl));
      if (!missing.length) return;
      const prods = await searchRead<{ id: number; product_tmpl_id: [number, string] | number }>(
        'product.product',
        { domain: [['id', 'in', missing]], fields: ['id', 'product_tmpl_id'], limit: 0 },
      );
      for (const p of prods) {
        const t = p.product_tmpl_id;
        pidToTmpl[p.id] = Array.isArray(t) ? t[0] : (t as number);
      }
    };

    let queue: { kitPid: number; pid: number; mult: number }[] =
      productIds.map(id => ({ kitPid: id, pid: id, mult: 1 }));
    const maxDepth = 12; // guard against circular BOMs

    for (let depth = 0; depth < maxDepth && queue.length > 0; depth++) {
      const pids = [...new Set(queue.map(q => q.pid))];
      await ensureTmpls(pids);
      const tmplIds = [...new Set(pids.map(p => pidToTmpl[p]).filter(Boolean))];

      const boms = await searchRead<{ id: number; product_id: [number, string] | false; product_tmpl_id: [number, string]; bom_line_ids: number[] }>(
        'mrp.bom',
        {
          domain: [['type', '=', 'phantom'],
            '|', ['product_id', 'in', pids],
            '&', ['product_id', '=', false], ['product_tmpl_id', 'in', tmplIds]],
          fields: ['id', 'product_id', 'product_tmpl_id', 'bom_line_ids'],
          limit: 0,
        },
      );

      const allLineIds = boms.flatMap(b => b.bom_line_ids || []);
      const lines = allLineIds.length
        ? await searchRead<{ id: number; bom_id: [number, string]; product_id: [number, string] | false; product_qty: number }>(
            'mrp.bom.line',
            { domain: [['id', 'in', allLineIds]], fields: ['id', 'bom_id', 'product_id', 'product_qty'], limit: 0 },
          )
        : [];

      const bomLines: Record<number, { compId: number; qty: number }[]> = {};
      for (const l of lines) {
        if (!Array.isArray(l.product_id)) continue;
        const bomId = Array.isArray(l.bom_id) ? l.bom_id[0] : (l.bom_id as unknown as number);
        (bomLines[bomId] = bomLines[bomId] || []).push({ compId: l.product_id[0], qty: l.product_qty || 1 });
      }

      const variantToBom: Record<number, number> = {};
      const tmplToBom: Record<number, number> = {};
      for (const b of boms) {
        if (Array.isArray(b.product_id) && b.product_id[0]) {
          if (!(b.product_id[0] in variantToBom)) variantToBom[b.product_id[0]] = b.id;
        } else {
          const tmplId = Array.isArray(b.product_tmpl_id) ? b.product_tmpl_id[0] : (b.product_tmpl_id as unknown as number);
          if (!(tmplId in tmplToBom)) tmplToBom[tmplId] = b.id;
        }
      }
      const bomForPid = (pid: number): number | undefined =>
        variantToBom[pid] ?? tmplToBom[pidToTmpl[pid]];

      const nextQueue: { kitPid: number; pid: number; mult: number }[] = [];
      for (const item of queue) {
        const bomId = bomForPid(item.pid);
        if (bomId !== undefined && bomLines[bomId]) {
          for (const comp of bomLines[bomId]) {
            if (comp.compId === item.pid) continue; // skip self-reference loop
            nextQueue.push({ kitPid: item.kitPid, pid: comp.compId, mult: item.mult * comp.qty });
          }
        } else {
          (kitLeafQtys[item.kitPid] = kitLeafQtys[item.kitPid] || {});
          kitLeafQtys[item.kitPid][item.pid] = (kitLeafQtys[item.kitPid][item.pid] || 0) + item.mult;
        }
      }
      queue = nextQueue;
    }

    for (const item of queue) {
      (kitLeafQtys[item.kitPid] = kitLeafQtys[item.kitPid] || {});
      kitLeafQtys[item.kitPid][item.pid] = (kitLeafQtys[item.kitPid][item.pid] || 0) + item.mult;
    }

    return kitLeafQtys;
  };

  /**
   * COGS = Σ (units_sold × unit_cost). unit_cost is derived by recursively
   * expanding phantom BOMs (handles nesting) and summing leaf component
   * standard_prices × their quantities; falls back to the product's own
   * standard_price for simple (non-BOM) products. Units are the native
   * delivered/ordered qty per product over the range (sale.report).
   */
  const computeCogs = async (productUnits: Record<number, number>): Promise<number> => {
    const kitIds = Object.keys(productUnits).map(Number);
    if (!kitIds.length) return 0;

    const prods = await searchRead<{ id: number; standard_price: number }>(
      'product.product',
      { domain: [['id', 'in', kitIds]], fields: ['id', 'standard_price'], limit: 0 },
    );
    const pidToCost: Record<number, number> = {};
    for (const p of prods) pidToCost[p.id] = p.standard_price || 0;

    const kitLeafQtys = await expandPhantomBoms(kitIds);

    const allLeafIds = [...new Set(Object.values(kitLeafQtys).flatMap(m => Object.keys(m).map(Number)))];
    if (allLeafIds.length > 0) {
      const leafProds = await searchRead<{ id: number; standard_price: number }>(
        'product.product',
        { domain: [['id', 'in', allLeafIds]], fields: ['id', 'standard_price'], limit: 0 },
      );
      for (const lp of leafProds) pidToCost[lp.id] = lp.standard_price || 0;
    }

    let total = 0;
    for (const [kitIdStr, units] of Object.entries(productUnits)) {
      const kitId = Number(kitIdStr);
      const leafMap = kitLeafQtys[kitId];
      if (leafMap && Object.keys(leafMap).length > 0) {
        let kitCost = 0;
        for (const [leafIdStr, leafQty] of Object.entries(leafMap)) {
          kitCost += (pidToCost[Number(leafIdStr)] || 0) * leafQty;
        }
        total += units * kitCost;
      } else {
        total += units * (pidToCost[kitId] || 0);
      }
    }
    return total;
  };

  const load = async () => {
    setLoading(true);
    setRowOffset(0);
    try {
      const domain = buildDomain();
      const cancelDomain: any[] = [['state', '=', 'cancel']];
      if (dateFrom) cancelDomain.push(['date', '>=', `${dateFrom} 00:00:00`]);
      if (dateTo) cancelDomain.push(['date', '<=', `${dateTo} 23:59:59`]);

      const [weekly, cats, prods, gross, gmv, finalAmt, cancelU, retAmt, retUnits, perProduct] =
        await Promise.allSettled([
          // Weekly units + revenue (Sales Analysis grouped by ISO week)
          readGroup<any>('sale.report', {
            domain,
            fields: ['product_uom_qty:sum', 'price_subtotal:sum'],
            groupby: ['date:week'],
            orderby: 'date asc',
            limit: 12,
          }),
          // Revenue by product category
          readGroup<any>('sale.report', {
            domain,
            fields: ['price_subtotal:sum'],
            groupby: ['categ_id'],
            orderby: 'price_subtotal desc',
            limit: 6,
          }),
          // Top products by units
          readGroup<any>('sale.report', {
            domain,
            fields: ['product_uom_qty:sum', 'price_subtotal:sum'],
            groupby: ['product_id'],
            orderby: 'product_uom_qty desc',
            limit: 8,
          }),
          getSum('sale.report', domain, 'product_uom_qty'),
          getSum('sale.report', domain, 'price_total'),
          getSum('sale.report', domain, 'price_subtotal'),
          getSum('sale.report', cancelDomain, 'product_uom_qty'),
          // Returns = posted customer credit notes in range
          getSum('account.move', [
            ['move_type', '=', 'out_refund'], ['state', '=', 'posted'],
            ['invoice_date', '>=', dateFrom], ['invoice_date', '<=', dateTo],
          ], 'amount_total'),
          getSum('account.move.line', [
            ['parent_state', '=', 'posted'], ['move_id.move_type', '=', 'out_refund'],
            ['product_id', '!=', false], ['display_type', '=', false],
            ['date', '>=', dateFrom], ['date', '<=', dateTo],
          ], 'quantity'),
          // Per-product units (for COGS + SKU records table)
          readGroup<any>('sale.report', {
            domain,
            fields: ['product_uom_qty:sum', 'qty_delivered:sum', 'price_subtotal:sum'],
            groupby: ['product_id'],
            orderby: 'product_uom_qty desc',
            limit: 0,
          }),
        ]);

      if (weekly.status === 'fulfilled' && Array.isArray(weekly.value)) {
        setWeeklyChart(weekly.value.map((r: any) => {
          const raw = r['date:week'] ?? r.date ?? '';
          const label = Array.isArray(raw) ? raw[1] : String(raw);
          return { name: label, units: r.product_uom_qty ?? 0, revenue: r.price_subtotal ?? 0 };
        }));
      } else setWeeklyChart([]);

      if (cats.status === 'fulfilled' && Array.isArray(cats.value)) {
        setCategoryChart(cats.value
          .filter((r: any) => Array.isArray(r.categ_id))
          .map((r: any) => ({ name: r.categ_id[1], value: r.price_subtotal ?? 0 })));
      } else setCategoryChart([]);

      if (prods.status === 'fulfilled' && Array.isArray(prods.value)) {
        setTopProducts(prods.value
          .filter((r: any) => Array.isArray(r.product_id))
          .map((r: any, i: number) => ({
            id: i,
            sku: r.product_id[1],
            units: r.product_uom_qty ?? 0,
            amount: r.price_subtotal ?? 0,
          })));
      } else setTopProducts([]);

      const grossUnits = gross.status === 'fulfilled' ? gross.value : 0;
      const retAmtV = retAmt.status === 'fulfilled' ? retAmt.value : 0;
      const gmvV = gmv.status === 'fulfilled' ? gmv.value : 0;
      setKpis({
        grossUnits,
        gmv: gmvV,
        finalSalesAmt: Math.max(0, gmvV - retAmtV),
        returnUnits: retUnits.status === 'fulfilled' ? retUnits.value : 0,
        cancelUnits: cancelU.status === 'fulfilled' ? cancelU.value : 0,
        returnAmt: retAmtV,
        cogs: 0,
      });

      // Build SKU-level records + COGS source from per-product rollup.
      const perProd = (perProduct.status === 'fulfilled' && Array.isArray(perProduct.value)) ? perProduct.value : [];
      const productUnits: Record<number, number> = {};
      const recordRows = perProd
        .filter((r: any) => Array.isArray(r.product_id))
        .map((r: any) => {
          const pid = r.product_id[0];
          const units = Number(r.qty_delivered || r.product_uom_qty || 0);
          productUnits[pid] = (productUnits[pid] || 0) + units;
          return {
            product_id: r.product_id as [number, string],
            sku: '',
            gross_units: Number(r.product_uom_qty || 0),
            final_units: units,
            amount: Number(r.price_subtotal || 0),
          };
        });

      // Resolve default_code (SKU ID) for the records table.
      const pids = recordRows.map(r => r.product_id[0]);
      if (pids.length) {
        try {
          const codes = await searchRead<{ id: number; default_code: string | false }>('product.product', {
            domain: [['id', 'in', pids]], fields: ['id', 'default_code'], limit: 0,
          });
          const codeById = new Map<number, string>();
          for (const c of codes) codeById.set(c.id, c.default_code || '');
          for (const r of recordRows) r.sku = codeById.get(r.product_id[0]) || '';
        } catch { /* leave SKU blank */ }
      }
      setRows(recordRows);
      setRowTotal(recordRows.length);
      setRowOffset(0);

      // COGS requires the extra BOM chain — run after main KPIs are shown.
      setCogsLoading(true);
      computeCogs(productUnits)
        .then(cogs => setKpis(prev => ({ ...prev, cogs })))
        .catch(() => {})
        .finally(() => setCogsLoading(false));

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
          <h1 className={`text-xl font-black ${isDark ? 'text-white' : 'text-gray-900'}`}>Sales Dashboard</h1>
          <p className={`text-xs mt-0.5 ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>
            Live performance across all native sales orders
          </p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
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
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        <KPI label="Gross Units" value={kpis.grossUnits.toLocaleString('en-IN')} icon={Package} color="#7367f0" />
        <KPI label="GMV" value={fmt(kpis.gmv)} sub="Gross Merchandise Value" icon={IndianRupee} color="#10b981" />
        <KPI label="Final Sales" value={fmt(kpis.finalSalesAmt)} sub="After returns/cancels" icon={ShoppingBag} color="#3d5af1" />
        <div className="card p-4 flex items-start justify-between">
          <div className="space-y-1">
            <p className={`text-[10px] font-bold uppercase tracking-wider ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>Cost of Goods Sold</p>
            <p className={`text-2xl font-black ${isDark ? 'text-white' : 'text-gray-900'}`}>
              {cogsLoading ? <span className="text-sm text-violet-400 animate-pulse">Computing…</span> : fmt(kpis.cogs)}
            </p>
            <p className={`text-[10px] ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>Units × product/BOM cost</p>
          </div>
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#f59e0b20' }}>
            <Calculator size={18} style={{ color: '#f59e0b' }} />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <KPI label="Return Amount" value={fmt(kpis.returnAmt)} sub={`${kpis.returnUnits.toLocaleString()} units returned`} icon={RotateCcw} color="#ef4444" />
        <KPI label="Return Rate" value={`${returnRate}%`} sub="% of gross units" icon={RotateCcw} color="#f97316" />
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
            No sales data found for this period. Confirm some sales orders to see charts.
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

          {/* Sales Records Table — one row per SKU/product over the range */}
          <div className="card overflow-hidden">
            <div className={`px-4 py-3 border-b flex items-center justify-between flex-wrap gap-2 ${isDark ? 'border-[#2a3250]' : 'border-gray-100'}`}>
              <div className="flex items-center gap-1">
                <h3 className={`text-xs font-semibold uppercase tracking-wider ${isDark ? 'text-[#5a6a8a]' : 'text-gray-500'}`}>Sales Records</h3>
                <span className={`ml-2 text-xs ${isDark ? 'text-[#3d4f7c]' : 'text-gray-400'}`}>
                  {rowTotal.toLocaleString('en-IN')} products
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button disabled={rowOffset === 0} onClick={() => setRowOffset(Math.max(0, rowOffset - ROW_LIMIT))}
                  className={`text-xs px-2.5 py-1 rounded-lg font-semibold disabled:opacity-30 ${isDark ? 'bg-[#1e2440] text-[#8897b5] hover:bg-[#2a3250]' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                  ← Prev
                </button>
                <span className={`text-xs ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>
                  {rowTotal > 0 ? `${rowOffset + 1}–${Math.min(rowOffset + ROW_LIMIT, rowTotal)}` : '0'}
                </span>
                <button disabled={rowOffset + ROW_LIMIT >= rowTotal} onClick={() => setRowOffset(rowOffset + ROW_LIMIT)}
                  className={`text-xs px-2.5 py-1 rounded-lg font-semibold disabled:opacity-30 ${isDark ? 'bg-[#1e2440] text-[#8897b5] hover:bg-[#2a3250]' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                  Next →
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="data-table w-full text-xs">
                <thead>
                  <tr>
                    <th>SKU ID</th>
                    <th>Product</th>
                    <th className="text-right">Gross Units</th>
                    <th className="text-right">Final Units</th>
                    <th className="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(rowOffset, rowOffset + ROW_LIMIT).map((r: any, i: number) => (
                    <tr key={`${r.product_id[0]}-${i}`}>
                      <td className={`font-mono text-[11px] font-medium max-w-[180px] truncate ${isDark ? 'text-[#7367f0]' : 'text-violet-600'}`} title={r.sku || ''}>{r.sku || '—'}</td>
                      <td className={`font-semibold max-w-[260px] truncate ${isDark ? 'text-white' : 'text-gray-900'}`} title={r.product_id[1]}>{r.product_id[1]}</td>
                      <td className={`text-right ${isDark ? 'text-[#8897b5]' : 'text-gray-500'}`}>{(r.gross_units || 0).toLocaleString('en-IN')}</td>
                      <td className={`text-right font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>{(r.final_units || 0).toLocaleString('en-IN')}</td>
                      <td className="text-right font-bold text-[#7367f0]">{fmt(r.amount)}</td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr><td colSpan={5} className={`text-center py-8 text-xs ${isDark ? 'text-[#3d4f7c]' : 'text-gray-400'}`}>No records found.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
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
                      <th>SKU / Product</th>
                      <th className="text-right">Units Sold</th>
                      <th className="text-right">Revenue</th>
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
