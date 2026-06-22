// Shared ledger UI primitives — a faithful port of the Flipkart UnifiedLedger
// look & feel (icon tabs, grouped summary cards, filter bar, data table with
// totals footer, CSV export, status badge), reused by the native biz.* money
// screens so they match the Flipkart aesthetic exactly. No Flipkart coupling.
import { RefreshCw, Filter } from 'lucide-react';

export function fmt(n: number) {
  return `Rs.${(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

export function fmtBalance(n: number, _isDark: boolean) {
  const cls = n >= 0 ? 'text-green-400' : 'text-red-400';
  return <span className={cls}>{fmt(Math.abs(n))} {n >= 0 ? 'Dr' : 'Cr'}</span>;
}

export const TXN_STATE: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Pending Cash', cls: 'bg-red-500/15 text-red-400 border border-red-500/25' },
  partial: { label: 'Partial Payment', cls: 'bg-amber-500/15 text-amber-400 border border-amber-500/25' },
  received: { label: 'Cash Received', cls: 'bg-green-500/15 text-green-400 border border-green-500/25' },
};

export function StatusBadge({ state }: { state: string }) {
  const s = TXN_STATE[state] || { label: state || '--', cls: 'bg-gray-500/15 text-gray-400 border border-gray-500/25' };
  return <span className={`inline-block text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${s.cls}`}>{s.label}</span>;
}

export function exportCsv(filename: string, headers: string[], data: (string | number)[][]) {
  const csv = [headers, ...data].map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Tailwind tokens shared by the biz ledger screens (match UnifiedLedger).
export const ui = (isDark: boolean) => ({
  cardBg: isDark ? 'bg-[#161b2e] border border-[#2a3250]' : 'bg-white border border-gray-200',
  inp: `input text-sm py-2 ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`,
  thCls: `text-left py-3 px-4 text-[10px] font-bold uppercase tracking-wider ${isDark ? 'text-[#5a6a8a]' : 'text-gray-500'}`,
  tdCls: `py-3 px-4 text-xs ${isDark ? 'text-[#ccd6f6]' : 'text-gray-700'}`,
});

export function LedgerFilters({ isDark, inp, selectLabel, selectValue, selectOptions, onSelectChange, dateFrom, dateTo, onDateFrom, onDateTo, onApply, loading, onExport }: {
  isDark: boolean; inp: string; selectLabel: string;
  selectValue: number | ''; selectOptions: { id: number; name: string }[];
  onSelectChange: (v: number | '') => void;
  dateFrom: string; dateTo: string;
  onDateFrom: (s: string) => void; onDateTo: (s: string) => void;
  onApply: () => void; loading: boolean; onExport: () => void;
}) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <select value={selectValue} onChange={e => onSelectChange(Number(e.target.value) || '')} className={`${inp} w-52`}>
        <option value="">All {selectLabel}s</option>
        {selectOptions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <input type="date" value={dateFrom} onChange={e => onDateFrom(e.target.value)} className={`${inp} w-36`} title="From" />
      <span className={isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}>to</span>
      <input type="date" value={dateTo} onChange={e => onDateTo(e.target.value)} className={`${inp} w-36`} title="To" />
      <button onClick={onApply} disabled={loading} className="btn-secondary text-xs px-3 py-2 flex items-center gap-1.5">
        <Filter size={13} className={loading ? 'animate-spin' : ''} /> Apply
      </button>
      <button onClick={onExport} className={`text-xs px-3 py-2 rounded-xl border font-semibold flex items-center gap-1.5 ${isDark ? 'border-[#2a3250] text-[#5a6a8a] hover:text-white hover:border-[#7367f0]' : 'border-gray-200 text-gray-500 hover:text-gray-900'}`}>
        Export CSV
      </button>
    </div>
  );
}

export function LedgerTable({ loading, isDark, cardBg, thCls, tdCls, columns, rows, totals }: {
  loading: boolean; isDark: boolean; cardBg: string; thCls: string; tdCls: string;
  columns: string[]; rows: (string | JSX.Element)[][];
  totals?: (string | JSX.Element)[];
}) {
  if (loading) {
    return (
      <div className={`${cardBg} rounded-2xl h-32 flex items-center justify-center`}>
        <RefreshCw size={18} className="animate-spin text-[#7367f0]" />
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className={`${cardBg} rounded-2xl py-12 text-center text-sm ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>
        No records found. Apply a filter and click Apply.
      </div>
    );
  }
  return (
    <div className={`${cardBg} rounded-2xl overflow-hidden`}>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead><tr className={isDark ? 'bg-[#1e2440]/60' : 'bg-gray-50'}>
            {columns.map(c => <th key={c} className={thCls}>{c}</th>)}
          </tr></thead>
          <tbody className={`divide-y ${isDark ? 'divide-[#2a3250]' : 'divide-gray-100'}`}>
            {rows.map((row, i) => (
              <tr key={i} className={isDark ? 'hover:bg-white/3' : 'hover:bg-gray-50'}>
                {row.map((cell, j) => <td key={j} className={tdCls}>{cell}</td>)}
              </tr>
            ))}
          </tbody>
          {totals && (
            <tfoot>
              <tr className={`border-t-2 ${isDark ? 'border-[#2a3250] bg-[#1e2440]/80' : 'border-gray-300 bg-gray-100'}`}>
                {totals.map((cell, j) => (
                  <td key={j} className={`py-3 px-4 text-xs font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>{cell}</td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <div className={`px-4 py-2 text-xs ${isDark ? 'text-[#4a5580] border-t border-[#2a3250]' : 'text-gray-400 border-t border-gray-100'}`}>
        {rows.length} record{rows.length !== 1 ? 's' : ''}
      </div>
    </div>
  );
}

export function Toast({ toast }: { toast: { ok: boolean; msg: string } | null }) {
  if (!toast) return null;
  return (
    <div className={`fixed top-5 right-5 z-50 px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 text-sm font-medium animate-fade-in
      ${toast.ok ? 'bg-green-500/15 border border-green-500/30 text-green-400' : 'bg-red-500/15 border border-red-500/30 text-red-400'}`}>
      {toast.msg}
    </div>
  );
}
