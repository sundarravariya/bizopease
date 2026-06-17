import { useState, useEffect } from 'react';
import { searchRead, readGroup, getSum } from '../../../services/odoo';
import { useTheme } from '../../../context/ThemeContext';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import {
  ShoppingBag, TrendingDown, RefreshCw,
  RotateCcw, Package, IndianRupee, Calculator
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
    returnAmt: 0,
    cogs: 0,
  });
  const [cogsLoading, setCogsLoading] = useState(false);
  const [weeklyChart, setWeeklyChart] = useState<{ name: string; units: number; revenue: number }[]>([]);
  const [categoryChart, setCategoryChart] = useState<{ name: string; value: number }[]>([]);
  const [topProducts, setTopProducts] = useState<{ id: number; sku: string; units: number; amount: number }[]>([]);

  // 'fsn' tab = kit-level FSN rows; 'product' tab = BOM-exploded component rows
  const [recordTab, setRecordTab] = useState<'fsn' | 'product'>('fsn');

  // Both tabs hold aggregated rows (readGroup / client-side rollup) — shapes differ per tab
  const [rows, setRows] = useState<any[]>([]);
  const [rowOffset, setRowOffset] = useState(0);
  const [rowTotal, setRowTotal] = useState(0);
  const ROW_LIMIT = 50;

  useEffect(() => {
    loadAccounts();
  }, []);

  useEffect(() => {
    load();
  }, [accountId, dateFrom, dateTo]);

  useEffect(() => {
    setRows([]);
    setRowOffset(0);
    loadRows(0, recordTab).catch(() => {});
  }, [recordTab]);

  const loadAccounts = async () => {
    try {
      const r = await searchRead<Account>('flipkart.account', { fields: ['id', 'name'], limit: 50 });
      if (Array.isArray(r)) setAccounts(r);
    } catch {}
  };

  const buildDomain = () => {
    const d: any[] = [];
    if (accountId !== '') d.push(['account_id', '=', Number(accountId)]);
    if (dateFrom) d.push(['order_date', '>=', dateFrom]);
    if (dateTo) d.push(['order_date', '<=', dateTo]);
    return d;
  };

  /**
   * Recursively expand phantom BOMs for a set of product IDs.
   * Returns a map: { kitProductId → { leafProductId → totalQtyPerKitUnit } }
   *
   * Handles NESTED phantom BOMs (a BOM whose component is itself a kit, e.g.
   * "2 Polygel" → "TS TSFC" → Poly Nail Tips + TS Spatula + …). At every level
   * it resolves the component products' templates via ensureTmpls() so that
   * template-level phantom BOMs (all 356 BOMs here are template-level with
   * product_id NULL) are found for intermediate kits too — not just the top
   * level. Each leaf product is accumulated once per kit (summed), so a leaf
   * reached through multiple paths produces a single entry (no double entry).
   */
  const expandPhantomBoms = async (
    productIds: number[],
  ): Promise<Record<number, Record<number, number>>> => {
    const kitLeafQtys: Record<number, Record<number, number>> = {};
    const pidToTmpl: Record<number, number> = {};

    // Lazily resolve product_tmpl_id for any product ids not yet seen.
    // CRITICAL for nested levels: without this, intermediate kits can't be
    // matched to their template-level BOM and get mis-treated as leaves.
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

      // Resolve a product → its phantom BOM (variant match first, else template)
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
          // This pid is a (possibly intermediate) kit — expand its components
          for (const comp of bomLines[bomId]) {
            if (comp.compId === item.pid) continue; // skip self-reference loop
            nextQueue.push({ kitPid: item.kitPid, pid: comp.compId, mult: item.mult * comp.qty });
          }
        } else {
          // Leaf product — accumulate qty under its root kit (single entry)
          (kitLeafQtys[item.kitPid] = kitLeafQtys[item.kitPid] || {});
          kitLeafQtys[item.kitPid][item.pid] = (kitLeafQtys[item.kitPid][item.pid] || 0) + item.mult;
        }
      }
      queue = nextQueue;
    }

    // Anything still queued at maxDepth → treat as leaves so quantities aren't lost.
    for (const item of queue) {
      (kitLeafQtys[item.kitPid] = kitLeafQtys[item.kitPid] || {});
      kitLeafQtys[item.kitPid][item.pid] = (kitLeafQtys[item.kitPid][item.pid] || 0) + item.mult;
    }

    return kitLeafQtys;
  };

  /**
   * COGS = Σ (kit_units × kit_cost) where kit_cost is derived by recursively
   * expanding all phantom BOMs (handles nested BOMs) and summing leaf component
   * standard_prices × their quantities.
   * Falls back to product standard_price for simple (non-BOM) products.
   * Uses FSN rows only (is_fsn_row=True) for original kit quantities.
   */
  const computeCogs = async (domain: any[]): Promise<number> => {
    const fsnDomain = [...domain, ['is_fsn_row', '=', true]];

    // 1. Aggregate final_sale_units per product_id from FSN header rows
    const fsnRows = await searchRead<{ product_id: [number, string] | false; final_sale_units: number }>(
      'flipkart.sales.dashboard',
      { domain: fsnDomain, fields: ['product_id', 'final_sale_units'], limit: 0 },
    );
    const productUnits: Record<number, number> = {};
    for (const r of fsnRows) {
      if (!Array.isArray(r.product_id)) continue;
      const pid = r.product_id[0];
      productUnits[pid] = (productUnits[pid] || 0) + (r.final_sale_units || 0);
    }
    const kitIds = Object.keys(productUnits).map(Number);
    if (!kitIds.length) return 0;

    // 2. Get standard_price for each kit product (used when it has no BOM)
    const prods = await searchRead<{ id: number; standard_price: number }>(
      'product.product',
      { domain: [['id', 'in', kitIds]], fields: ['id', 'standard_price'], limit: 0 },
    );
    const pidToCost: Record<number, number> = {};
    for (const p of prods) pidToCost[p.id] = p.standard_price || 0;

    // 3. Recursively expand phantom BOMs for all kit products (handles nesting)
    const kitLeafQtys = await expandPhantomBoms(kitIds);

    // 4. Fetch standard_price for all leaf products encountered
    const allLeafIds = [...new Set(Object.values(kitLeafQtys).flatMap(m => Object.keys(m).map(Number)))];
    if (allLeafIds.length > 0) {
      const leafProds = await searchRead<{ id: number; standard_price: number }>(
        'product.product',
        { domain: [['id', 'in', allLeafIds]], fields: ['id', 'standard_price'], limit: 0 },
      );
      for (const lp of leafProds) pidToCost[lp.id] = lp.standard_price || 0;
    }

    // 5. COGS = Σ kit_units × (Σ leaf_qty × leaf_cost)
    let total = 0;
    for (const [kitIdStr, units] of Object.entries(productUnits)) {
      const kitId = Number(kitIdStr);
      const leafMap = kitLeafQtys[kitId];
      if (leafMap && Object.keys(leafMap).length > 0) {
        // Has phantom BOM (possibly nested) — sum leaf costs
        let kitCost = 0;
        for (const [leafIdStr, leafQty] of Object.entries(leafMap)) {
          kitCost += (pidToCost[Number(leafIdStr)] || 0) * leafQty;
        }
        total += units * kitCost;
      } else {
        // No phantom BOM — use product's own standard_price
        total += units * (pidToCost[kitId] || 0);
      }
    }
    return total;
  };

  const loadRows = async (offset = 0, tab = recordTab) => {
    const base = buildDomain();
    if (tab === 'fsn') {
      // FSN tab: aggregate by sku_id + seller_sku — no date rows, combined qty
      const fsnDomain = [...base, ['is_fsn_row', '=', true]];
      const data = await readGroup<any>('flipkart.sales.dashboard', {
        domain: fsnDomain,
        fields: ['gross_units:sum', 'final_sale_units:sum', 'final_sale_amount:sum'],
        groupby: ['sku_id', 'seller_sku'],
        orderby: 'final_sale_units desc',
      });
      setRows(data);
      setRowTotal(data.length);
      setRowOffset(0);
    } else {
      // Product tab: combined units per Odoo product across the date range.
      // Every kit FSN row is exploded (incl. NESTED BOMs) to leaf components;
      // normal products map to themselves. One row per product (no double
      // entry), so a leaf reached via several kits/paths is summed into one.
      const fsnDomain = [...base, ['is_fsn_row', '=', true]];
      const fsnRows = await searchRead<{ product_id: [number, string] | false; gross_units: number; final_sale_units: number }>(
        'flipkart.sales.dashboard',
        { domain: fsnDomain, fields: ['product_id', 'gross_units', 'final_sale_units'], limit: 0 },
      );
      // Aggregate kit-level units per product first
      const kitGross: Record<number, number> = {};
      const kitFinal: Record<number, number> = {};
      for (const r of fsnRows) {
        if (!Array.isArray(r.product_id)) continue;
        const pid = r.product_id[0];
        kitGross[pid] = (kitGross[pid] || 0) + (r.gross_units || 0);
        kitFinal[pid] = (kitFinal[pid] || 0) + (r.final_sale_units || 0);
      }
      const kitIds = Object.keys(kitGross).map(Number);

      // Explode kits → leaves (handles nested BOMs); normals have no leaf map
      const kitLeafQtys = kitIds.length ? await expandPhantomBoms(kitIds) : {};

      // Distribute kit units down to leaf/normal products
      const prodGross: Record<number, number> = {};
      const prodFinal: Record<number, number> = {};
      for (const kitId of kitIds) {
        const leafMap = kitLeafQtys[kitId];
        if (leafMap && Object.keys(leafMap).length > 0) {
          for (const [leafStr, qty] of Object.entries(leafMap)) {
            const leaf = Number(leafStr);
            prodGross[leaf] = (prodGross[leaf] || 0) + (kitGross[kitId] || 0) * qty;
            prodFinal[leaf] = (prodFinal[leaf] || 0) + (kitFinal[kitId] || 0) * qty;
          }
        } else {
          prodGross[kitId] = (prodGross[kitId] || 0) + (kitGross[kitId] || 0);
          prodFinal[kitId] = (prodFinal[kitId] || 0) + (kitFinal[kitId] || 0);
        }
      }

      // Resolve product names
      const productIds = Object.keys(prodGross).map(Number);
      const names: Record<number, string> = {};
      if (productIds.length) {
        const prods = await searchRead<{ id: number; display_name: string; default_code: string | false }>(
          'product.product',
          { domain: [['id', 'in', productIds]], fields: ['id', 'display_name', 'default_code'], limit: 0 },
        );
        for (const p of prods) names[p.id] = p.default_code ? `[${p.default_code}] ${p.display_name}` : p.display_name;
      }

      const data = productIds
        .map(pid => ({
          product_id: [pid, names[pid] || `#${pid}`] as [number, string],
          gross_units: Math.round(prodGross[pid] || 0),
          final_sale_units: Math.round(prodFinal[pid] || 0),
        }))
        .sort((a, b) => b.final_sale_units - a.final_sale_units);

      setRows(data);
      setRowTotal(data.length);
      setRowOffset(0);
    }
  };

  const load = async () => {
    setLoading(true);
    setRowOffset(0);
    try {
      const rawDomain = buildDomain();
      // All KPIs and charts use FSN-level rows only (is_fsn_row=True).
      // With old (pre-re-upload) data every row is is_fsn_row=True so the
      // filter is a no-op; with new data it prevents component rows from
      // inflating gross-unit / GMV counts.
      const domain = [...rawDomain, ['is_fsn_row', '=', true]];

      const [weekly, cats, prods, gross, gmv, finalAmt, retU, cancelU, retAmt] = await Promise.allSettled([
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
        getSum('flipkart.sales.dashboard', domain, 'return_amount'),
      ]);

      if (weekly.status === 'fulfilled' && Array.isArray(weekly.value)) {
        setWeeklyChart(weekly.value.map((r: any) => {
          const raw = r.order_date ?? '';
          const label = Array.isArray(raw) ? raw[1] : (typeof raw === 'string' ? raw.slice(0, 10) : String(raw).slice(0, 10));
          return { name: label, units: r.final_sale_units ?? 0, revenue: r.final_sale_amount ?? 0 };
        }));
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

      setKpis(prev => ({
        ...prev,
        grossUnits: gross.status === 'fulfilled' ? gross.value : 0,
        gmv: gmv.status === 'fulfilled' ? gmv.value : 0,
        finalSalesAmt: finalAmt.status === 'fulfilled' ? finalAmt.value : 0,
        returnUnits: retU.status === 'fulfilled' ? retU.value : 0,
        cancelUnits: cancelU.status === 'fulfilled' ? cancelU.value : 0,
        returnAmt: retAmt.status === 'fulfilled' ? retAmt.value : 0,
        cogs: 0,
      }));

      // Load sales record rows (non-blocking, uses its own domain per tab)
      loadRows(0, recordTab).catch(() => {});

      // COGS requires extra chain of calls — run after main KPIs are shown
      setCogsLoading(true);
      computeCogs(domain)
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
            <p className={`text-[10px] ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>FSN → product → BOM cost</p>
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

          {/* Sales Records Table — FSN view or BOM-exploded Product view */}
          <div className="card overflow-hidden">
            {/* Tab header */}
            <div className={`px-4 py-3 border-b flex items-center justify-between flex-wrap gap-2 ${isDark ? 'border-[#2a3250]' : 'border-gray-100'}`}>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setRecordTab('fsn')}
                  className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-colors ${recordTab === 'fsn' ? 'bg-[#7367f0] text-white' : isDark ? 'bg-[#1e2440] text-[#8897b5] hover:bg-[#2a3250]' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                >
                  By FSN
                </button>
                <button
                  onClick={() => setRecordTab('product')}
                  className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-colors ${recordTab === 'product' ? 'bg-[#7367f0] text-white' : isDark ? 'bg-[#1e2440] text-[#8897b5] hover:bg-[#2a3250]' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                >
                  By Product (BOM)
                </button>
                <span className={`ml-2 text-xs ${isDark ? 'text-[#3d4f7c]' : 'text-gray-400'}`}>
                  {rowTotal.toLocaleString('en-IN')} {recordTab === 'fsn' ? 'FSNs' : 'products'}
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
              {recordTab === 'fsn' ? (
                <table className="data-table w-full text-xs">
                  <thead>
                    <tr>
                      <th>FSN</th>
                      <th>SKU ID</th>
                      <th className="text-right">Gross Units</th>
                      <th className="text-right">Final Units</th>
                      <th className="text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(rowOffset, rowOffset + ROW_LIMIT).map((r: any, i: number) => (
                      <tr key={`${r.sku_id}-${i}`}>
                        <td className={`font-mono text-[11px] font-medium max-w-[180px] truncate ${isDark ? 'text-[#7367f0]' : 'text-violet-600'}`} title={r.sku_id || ''}>{r.sku_id || '—'}</td>
                        <td className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>{r.seller_sku || <span className={isDark ? 'text-[#3d4f7c]' : 'text-gray-300'}>—</span>}</td>
                        <td className={`text-right ${isDark ? 'text-[#8897b5]' : 'text-gray-500'}`}>{(r.gross_units || 0).toLocaleString('en-IN')}</td>
                        <td className={`text-right font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>{(r.final_sale_units || 0).toLocaleString('en-IN')}</td>
                        <td className="text-right font-bold text-[#7367f0]">{fmt(r.final_sale_amount)}</td>
                      </tr>
                    ))}
                    {rows.length === 0 && (
                      <tr><td colSpan={5} className={`text-center py-8 text-xs ${isDark ? 'text-[#3d4f7c]' : 'text-gray-400'}`}>No records found.</td></tr>
                    )}
                  </tbody>
                </table>
              ) : (
                <table className="data-table w-full text-xs">
                  <thead>
                    <tr>
                      <th>Odoo Product</th>
                      <th className="text-right">Gross Units</th>
                      <th className="text-right">Final Units</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(rowOffset, rowOffset + ROW_LIMIT).map((r: any, i: number) => (
                      <tr key={`${Array.isArray(r.product_id) ? r.product_id[0] : i}`}>
                        <td className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                          {Array.isArray(r.product_id) ? r.product_id[1] : '—'}
                        </td>
                        <td className={`text-right ${isDark ? 'text-[#8897b5]' : 'text-gray-500'}`}>{(r.gross_units || 0).toLocaleString('en-IN')}</td>
                        <td className={`text-right font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>{(r.final_sale_units || 0).toLocaleString('en-IN')}</td>
                      </tr>
                    ))}
                    {rows.length === 0 && (
                      <tr><td colSpan={3} className={`text-center py-8 text-xs ${isDark ? 'text-[#3d4f7c]' : 'text-gray-400'}`}>No records found.</td></tr>
                    )}
                  </tbody>
                </table>
              )}
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
