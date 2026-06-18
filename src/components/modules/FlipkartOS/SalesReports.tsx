import { useState, useEffect } from 'react';
import { searchRead, readGroup } from '../../../services/odoo';
import { useTheme } from '../../../context/ThemeContext';
import { RefreshCw, TrendingDown, TrendingUp, Ban, Sparkles, ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

interface Account { id: number; name: string; }

type Status = 'down' | 'stopped' | 'up' | 'new' | 'flat';

interface Row {
  fsn: string;        // Flipkart Product Id
  sku: string;        // seller-defined SKU
  cur: number;
  prev: number;
  delta: number;
  curAmt: number;
  prevAmt: number;
  deltaAmt: number;
  pct: number;        // % change; +100 for new, -100 for stopped
  impact: number;     // 0-100 composite of revenue + unit swing
  status: Status;
}

type SortKey = 'impact' | 'fsn' | 'sku' | 'prev' | 'cur' | 'delta' | 'deltaAmt' | 'pct';

// Compact signed ₹
const money = (n: number) => {
  const a = Math.abs(n);
  const s = a >= 1e7 ? `${(a / 1e7).toFixed(1)}Cr`
    : a >= 1e5 ? `${(a / 1e5).toFixed(1)}L`
    : a >= 1e3 ? `${(a / 1e3).toFixed(1)}K` : a.toFixed(0);
  return `${n < 0 ? '-' : ''}₹${s}`;
};

// Local YYYY-MM-DD (avoid UTC shift from toISOString)
const ymd = (d: Date) => {
  const t = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return t.toISOString().split('T')[0];
};

/**
 * Returns [curFrom, curTo, prevFrom, prevTo] for the period type, anchored on
 * `anchor` — the latest date with actual sales data — NOT calendar today. This
 * avoids a fake dip from Flipkart's ~2-day upload lag (recent days have no data).
 */
function periods(period: 'week' | 'month', anchor: Date): [string, string, string, string] {
  if (period === 'week') {
    const curFrom = new Date(anchor); curFrom.setDate(anchor.getDate() - 6);
    const prevTo = new Date(curFrom); prevTo.setDate(curFrom.getDate() - 1);
    const prevFrom = new Date(prevTo); prevFrom.setDate(prevTo.getDate() - 6);
    return [ymd(curFrom), ymd(anchor), ymd(prevFrom), ymd(prevTo)];
  }
  const curFrom = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const prevTo = new Date(curFrom); prevTo.setDate(0);                    // last day prev month
  const prevFrom = new Date(prevTo.getFullYear(), prevTo.getMonth(), 1);
  return [ymd(curFrom), ymd(anchor), ymd(prevFrom), ymd(prevTo)];
}

export default function SalesReports() {
  const { isDark } = useTheme();
  const [period, setPeriod] = useState<'week' | 'month'>('week');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState<number | ''>('');
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>('impact');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [anchorStr, setAnchorStr] = useState('');   // latest data date used as window anchor

  useEffect(() => {
    searchRead<Account>('flipkart.account', { fields: ['id', 'name'], limit: 50 })
      .then(r => { if (Array.isArray(r)) setAccounts(r); }).catch(() => {});
  }, []);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [period, accountId]);

  const aggregate = async (from: string, to: string): Promise<Record<string, { sku: string; units: number; amount: number }>> => {
    const domain: any[] = [
      ['is_fsn_row', '=', true], ['sku_id', '!=', false],
      ['order_date', '>=', from], ['order_date', '<=', to],
    ];
    if (accountId !== '') domain.push(['account_id', '=', Number(accountId)]);
    const grp = await readGroup<any>('flipkart.sales.dashboard', {
      domain, fields: ['final_sale_units:sum', 'final_sale_amount:sum'], groupby: ['sku_id', 'seller_sku'],
    });
    const out: Record<string, { sku: string; units: number; amount: number }> = {};
    for (const g of grp) {
      const fsn = g.sku_id;
      if (!fsn) continue;
      const e = out[fsn] || (out[fsn] = { sku: '', units: 0, amount: 0 });
      e.units += Math.round(g.final_sale_units || 0);
      e.amount += g.final_sale_amount || 0;
      if (!e.sku && g.seller_sku) e.sku = g.seller_sku;
    }
    return out;
  };

  // Latest order_date present in the data (respecting the account filter).
  const getAnchor = async (): Promise<Date> => {
    const domain: any[] = [['is_fsn_row', '=', true], ['order_date', '!=', false]];
    if (accountId !== '') domain.push(['account_id', '=', Number(accountId)]);
    const recs = await searchRead<{ order_date: string }>('flipkart.sales.dashboard', {
      domain, fields: ['order_date'], limit: 1, order: 'order_date desc',
    });
    const d = recs[0]?.order_date;
    return d ? new Date(d + 'T00:00:00') : new Date();
  };

  const load = async () => {
    setLoading(true);
    try {
      const anchor = await getAnchor();
      setAnchorStr(ymd(anchor));
      const [cf, ct, pf, pt] = periods(period, anchor);
      const [cur, prev] = await Promise.all([aggregate(cf, ct), aggregate(pf, pt)]);
      const fsns = new Set<string>([...Object.keys(cur), ...Object.keys(prev)]);
      const raw: Row[] = [];
      let maxDa = 0, maxDu = 0;
      for (const fsn of fsns) {
        const c = cur[fsn]?.units || 0;
        const p = prev[fsn]?.units || 0;
        if (c === 0 && p === 0) continue;
        const ca = cur[fsn]?.amount || 0;
        const pa = prev[fsn]?.amount || 0;
        const sku = cur[fsn]?.sku || prev[fsn]?.sku || '';
        const delta = c - p;
        const deltaAmt = ca - pa;
        let pct: number, status: Status;
        if (p === 0) { pct = 100; status = 'new'; }
        else if (c === 0) { pct = -100; status = 'stopped'; }
        else { pct = (delta / p) * 100; status = delta < 0 ? 'down' : delta > 0 ? 'up' : 'flat'; }
        raw.push({ fsn, sku, cur: c, prev: p, delta, curAmt: ca, prevAmt: pa, deltaAmt, pct, impact: 0, status });
        maxDa = Math.max(maxDa, Math.abs(deltaAmt));
        maxDu = Math.max(maxDu, Math.abs(delta));
      }
      // Impact = 60% revenue swing + 40% unit swing, normalised 0-100
      maxDa = maxDa || 1; maxDu = maxDu || 1;
      for (const r of raw) {
        r.impact = 100 * (0.6 * Math.abs(r.deltaAmt) / maxDa + 0.4 * Math.abs(r.delta) / maxDu);
      }
      setRows(raw);
    } finally { setLoading(false); }
  };

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir(k === 'fsn' || k === 'sku' ? 'asc' : 'desc'); }
  };

  const sortVal = (r: Row, k: SortKey): number | string =>
    k === 'fsn' ? r.fsn : k === 'sku' ? r.sku : k === 'prev' ? r.prev
      : k === 'cur' ? r.cur : k === 'delta' ? r.delta : k === 'deltaAmt' ? r.deltaAmt
      : k === 'pct' ? r.pct : r.impact;

  const sortRows = (arr: Row[]) => [...arr].sort((a, b) => {
    const va = sortVal(a, sortKey), vb = sortVal(b, sortKey);
    const cmp = typeof va === 'string'
      ? String(va).localeCompare(String(vb))
      : (va as number) - (vb as number);
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const needsAttention = sortRows(rows.filter(r => r.status === 'down' || r.status === 'stopped'));
  const performing = sortRows(rows.filter(r => r.status === 'up' || r.status === 'new'));
  const stoppedCount = rows.filter(r => r.status === 'stopped').length;
  const newCount = rows.filter(r => r.status === 'new').length;

  const periodLabel = period === 'week' ? 'this week vs last week' : 'this month vs last month';

  const Stat = ({ label, value, color, icon: Icon }: any) => (
    <div className="card p-4 flex items-center justify-between">
      <div>
        <p className={`text-[10px] font-bold uppercase tracking-wider ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>{label}</p>
        <p className={`text-2xl font-black ${isDark ? 'text-white' : 'text-gray-900'}`}>{value}</p>
      </div>
      <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${color}20` }}>
        <Icon size={18} style={{ color }} />
      </div>
    </div>
  );

  // Sortable header cell — click to sort by this column, arrow shows direction.
  const Th = ({ k, label, align = 'left' }: { k: SortKey; label: string; align?: 'left' | 'right' }) => (
    <th className={align === 'right' ? 'text-right' : ''}>
      <button onClick={() => toggleSort(k)}
        className={`inline-flex items-center gap-0.5 select-none hover:text-[#7367f0] ${align === 'right' ? 'flex-row-reverse' : ''} ${sortKey === k ? 'text-[#7367f0]' : ''}`}>
        {label}
        {sortKey === k
          ? (sortDir === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />)
          : <ArrowUpDown size={10} className="opacity-30" />}
      </button>
    </th>
  );

  const Table = ({ title, data, tone }: { title: string; data: Row[]; tone: 'red' | 'green' }) => (
    <div className="card overflow-hidden">
      <div className={`px-4 py-3 border-b flex items-center gap-2 ${isDark ? 'border-[#2a3250]' : 'border-gray-100'}`}>
        {tone === 'red' ? <TrendingDown size={15} className="text-rose-400" /> : <TrendingUp size={15} className="text-emerald-400" />}
        <h3 className={`text-xs font-bold uppercase tracking-wider ${tone === 'red' ? 'text-rose-400' : 'text-emerald-400'}`}>{title}</h3>
        <span className={`text-xs ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>({data.length})</span>
      </div>
      <div className="overflow-x-auto max-h-[28rem] overflow-y-auto">
        <table className="data-table w-full text-xs">
          <thead>
            <tr>
              <Th k="impact" label="Impact" align="right" />
              <Th k="fsn" label="FSN" />
              <Th k="sku" label="SKU ID" />
              <Th k="prev" label="Last" align="right" />
              <Th k="cur" label="Now" align="right" />
              <Th k="delta" label="Δ" align="right" />
              <Th k="deltaAmt" label="Δ ₹" align="right" />
              <Th k="pct" label="% Change" align="right" />
            </tr>
          </thead>
          <tbody>
            {data.map(r => (
              <tr key={r.fsn}>
                <td className="text-right font-bold text-[#7367f0]">{r.impact.toFixed(0)}</td>
                <td className={`font-mono text-[11px] font-medium max-w-[150px] truncate ${isDark ? 'text-[#7367f0]' : 'text-violet-600'}`} title={r.fsn}>{r.fsn}</td>
                <td className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`} title={r.sku}>{r.sku || <span className={isDark ? 'text-[#3d4f7c]' : 'text-gray-300'}>—</span>}</td>
                <td className={`text-right ${isDark ? 'text-[#8897b5]' : 'text-gray-500'}`}>{r.prev.toLocaleString('en-IN')}</td>
                <td className={`text-right font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>{r.cur.toLocaleString('en-IN')}</td>
                <td className={`text-right font-semibold ${r.delta < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                  {r.delta > 0 ? '+' : ''}{r.delta.toLocaleString('en-IN')}
                </td>
                <td className={`text-right font-semibold ${r.deltaAmt < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                  {r.deltaAmt > 0 ? '+' : ''}{money(r.deltaAmt)}
                </td>
                <td className="text-right">
                  {r.status === 'stopped' ? (
                    <span className="inline-flex items-center gap-1 text-rose-400 font-bold"><Ban size={11} /> Stopped</span>
                  ) : r.status === 'new' ? (
                    <span className="inline-flex items-center gap-1 text-emerald-400 font-bold"><Sparkles size={11} /> New</span>
                  ) : (
                    <span className={`inline-flex items-center gap-0.5 font-bold ${r.pct < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                      {r.pct < 0 ? <ArrowDown size={11} /> : <ArrowUp size={11} />}{Math.abs(r.pct).toFixed(0)}%
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {data.length === 0 && (
              <tr><td colSpan={8} className={`text-center py-8 ${isDark ? 'text-[#3d4f7c]' : 'text-gray-400'}`}>Nothing here for this period.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className={`text-xl font-black ${isDark ? 'text-white' : 'text-gray-900'}`}>Sales Performance Report</h1>
          <p className={`text-xs mt-0.5 ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>
            Which products need attention — {periodLabel} (combined Flipkart + Odoo sales)
            {anchorStr && <span className="ml-1">· up to last sales date <b>{anchorStr}</b></span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <div className={`flex rounded-xl p-0.5 ${isDark ? 'bg-[#1e2440]' : 'bg-gray-100'}`}>
            {(['week', 'month'] as const).map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-colors ${period === p ? 'bg-[#7367f0] text-white' : isDark ? 'text-[#8897b5]' : 'text-gray-500'}`}>
                {p === 'week' ? 'Weekly' : 'Monthly'}
              </button>
            ))}
          </div>
          <select value={accountId} onChange={e => setAccountId(e.target.value ? Number(e.target.value) : '')}
            className={`input text-xs py-1.5 px-3 ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`}>
            <option value="">All Accounts</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <button onClick={load} disabled={loading} className="btn-secondary text-xs px-3 py-1.5">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Needs Attention" value={needsAttention.length} color="#ef4444" icon={TrendingDown} />
        <Stat label="Stopped Selling" value={stoppedCount} color="#f97316" icon={Ban} />
        <Stat label="Performing Well" value={performing.length} color="#10b981" icon={TrendingUp} />
        <Stat label="New Sellers" value={newCount} color="#7367f0" icon={Sparkles} />
      </div>

      {loading ? (
        <div className="card h-48 flex items-center justify-center gap-3">
          <RefreshCw size={18} className="animate-spin text-[#7367f0]" />
          <span className={`text-sm ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>Comparing periods…</span>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <Table title="Needs Attention" data={needsAttention} tone="red" />
          <Table title="Performing Well" data={performing} tone="green" />
        </div>
      )}
    </div>
  );
}
