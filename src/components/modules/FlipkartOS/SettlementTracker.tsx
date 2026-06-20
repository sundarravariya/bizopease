import { useState, useEffect, useMemo } from 'react';
import { searchRead, odooCall } from '../../../services/odoo';
import { useTheme } from '../../../context/ThemeContext';
import {
  RefreshCw, TrendingDown, TrendingUp, Search, AlertCircle,
  ChevronLeft, ChevronRight, CheckCircle2, Trash2,
} from 'lucide-react';

const PAGE_SIZE = 50;

interface SettlementChange {
  id: number;
  fsn: string;
  sku: string;
  product_name: string;
  upload_date: string;
  old_settlement: number;
  new_settlement: number;
  change_pct: number;
  urgency: 'urgent' | 'not_urgent';
}

export default function SettlementTracker() {
  const { isDark } = useTheme();
  const [rows, setRows] = useState<SettlementChange[]>([]);
  const [loading, setLoading] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [search, setSearch] = useState('');
  const [urgencyFilter, setUrgencyFilter] = useState<'all' | 'urgent' | 'not_urgent'>('all');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const cardBg = isDark ? 'bg-[#161b2e] border-[#2a3250]' : 'bg-white border-gray-200';
  const tableHead = isDark ? 'bg-[#111827]/60 text-[#5a6a8a] border-[#2a3250]' : 'bg-gray-50 text-gray-500 border-gray-200';
  const tableDivide = isDark ? 'divide-[#2a3250]' : 'divide-gray-100';
  const rowHover = isDark ? 'hover:bg-white/[0.03]' : 'hover:bg-gray-50';
  const textMain = isDark ? 'text-white' : 'text-gray-900';
  const textMuted = isDark ? 'text-[#5a6a8a]' : 'text-gray-500';

  const load = async () => {
    setLoading(true);
    try {
      const data = await searchRead<SettlementChange>('flipkart.listing.settlement.history', {
        domain: [],
        fields: ['id', 'fsn', 'sku', 'product_name', 'upload_date', 'old_settlement', 'new_settlement', 'change_pct', 'urgency'],
        limit: 0,
        order: 'urgency asc, change_pct desc',
      });
      setRows(Array.isArray(data) ? data : []);
      setSelected(new Set());
      setPage(1);
    } catch (e: any) {
      console.error('Failed to load settlement history:', e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { setPage(1); }, [search, urgencyFilter]);

  const filtered = useMemo(() => {
    let result = rows;
    if (urgencyFilter !== 'all') result = result.filter(r => r.urgency === urgencyFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(r =>
        r.fsn?.toLowerCase().includes(q) ||
        r.sku?.toLowerCase().includes(q) ||
        r.product_name?.toLowerCase().includes(q)
      );
    }
    return result;
  }, [rows, urgencyFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // Select helpers
  const toggleRow = (id: number) =>
    setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  const pageIds = pageRows.map(r => r.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every(id => selected.has(id));
  const somePageSelected = pageIds.some(id => selected.has(id));

  const togglePage = (checked: boolean) =>
    setSelected(prev => {
      const s = new Set(prev);
      pageIds.forEach(id => checked ? s.add(id) : s.delete(id));
      return s;
    });

  const selectAll = () => setSelected(new Set(filtered.map(r => r.id)));
  const clearSelection = () => setSelected(new Set());

  // Accept & Set Baseline: delete selected history records
  const handleAcceptBaseline = async () => {
    if (!selected.size) return;
    setAccepting(true);
    try {
      const ids = [...selected];
      await odooCall('flipkart.listing.settlement.history', 'unlink', [ids], {});
      setRows(prev => prev.filter(r => !selected.has(r.id)));
      setSelected(new Set());
    } catch (e: any) {
      console.error('Accept baseline failed:', e.message);
    } finally {
      setAccepting(false);
    }
  };

  const urgentCount = rows.filter(r => r.urgency === 'urgent').length;
  const notUrgentCount = rows.filter(r => r.urgency === 'not_urgent').length;

  const fmt = (n: number) => `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtPct = (n: number) => `${Number(n).toFixed(2)}%`;

  const pageBtnClass = (active: boolean) =>
    `h-7 min-w-[28px] px-2 rounded-lg text-xs font-semibold border transition-all ${
      active
        ? 'bg-[#7367f0] text-white border-[#7367f0]'
        : isDark ? 'border-[#2a3250] text-[#5a6a8a] hover:text-white hover:border-[#7367f0]/50' : 'border-gray-200 text-gray-500 hover:border-violet-400 hover:text-violet-600'
    }`;

  const pageNums = useMemo(() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const pages: (number | '…')[] = [];
    if (safePage <= 4) {
      pages.push(1, 2, 3, 4, 5, '…', totalPages);
    } else if (safePage >= totalPages - 3) {
      pages.push(1, '…', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
    } else {
      pages.push(1, '…', safePage - 1, safePage, safePage + 1, '…', totalPages);
    }
    return pages;
  }, [safePage, totalPages]);

  return (
    <div className='p-4 max-w-7xl mx-auto space-y-5 animate-fade-in'>
      <div className='flex flex-col md:flex-row md:items-center justify-between gap-4'>
        <div>
          <h1 className={`text-2xl font-black ${textMain}`}>Settlement Change Tracker</h1>
          <p className={`text-xs mt-1 ${textMuted}`}>
            Tracks bank settlement changes detected on each master listing upload
          </p>
        </div>
        <button onClick={load} disabled={loading}
          className='btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5'>
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Summary cards */}
      <div className='grid grid-cols-2 md:grid-cols-3 gap-3'>
        <div className={`border rounded-2xl p-4 ${cardBg}`}>
          <p className='text-2xl font-black text-red-400'>{urgentCount}</p>
          <p className={`text-[10px] uppercase tracking-wider font-semibold mt-1 ${textMuted}`}>Urgent (≥1% change)</p>
        </div>
        <div className={`border rounded-2xl p-4 ${cardBg}`}>
          <p className={`text-2xl font-black ${textMain}`}>{notUrgentCount}</p>
          <p className={`text-[10px] uppercase tracking-wider font-semibold mt-1 ${textMuted}`}>Not Urgent (&lt;1%)</p>
        </div>
        <div className={`border rounded-2xl p-4 ${cardBg} hidden md:block`}>
          <p className={`text-2xl font-black text-[#7367f0]`}>{rows.length}</p>
          <p className={`text-[10px] uppercase tracking-wider font-semibold mt-1 ${textMuted}`}>Total Changes</p>
        </div>
      </div>

      {/* Filters */}
      <div className={`border rounded-2xl p-3 flex flex-col sm:flex-row items-start sm:items-center gap-3 ${cardBg}`}>
        <div className='flex gap-1'>
          {([['all', 'All'], ['urgent', 'Urgent'], ['not_urgent', 'Not Urgent']] as const).map(([val, label]) => (
            <button key={val} onClick={() => setUrgencyFilter(val)}
              className={`text-xs px-3 py-1 rounded-lg font-semibold border transition-all ${
                urgencyFilter === val
                  ? val === 'urgent' ? 'bg-red-500 text-white border-red-500'
                    : val === 'not_urgent' ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-[#7367f0] text-white border-[#7367f0]'
                  : isDark ? 'border-[#2a3250] text-[#5a6a8a]' : 'border-gray-200 text-gray-500'
              }`}>
              {label}
            </button>
          ))}
        </div>
        <div className={`flex items-center gap-2 flex-1 border rounded-lg px-2 py-1.5 ${isDark ? 'border-[#2a3250] bg-[#1e2440]' : 'border-gray-200 bg-gray-50'}`}>
          <Search size={13} className={textMuted} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder='Search FSN, SKU, product…'
            className={`flex-1 text-xs bg-transparent outline-none ${textMain}`}
          />
          {search && <button onClick={() => setSearch('')} className={`text-xs ${textMuted}`}>×</button>}
        </div>
      </div>

      {/* Bulk action bar — appears when anything is selected */}
      {selected.size > 0 && (
        <div className={`border rounded-2xl p-3 flex items-center gap-3 flex-wrap ${isDark ? 'bg-[#7367f0]/10 border-[#7367f0]/30' : 'bg-violet-50 border-violet-200'}`}>
          <CheckCircle2 size={15} className='text-[#7367f0] flex-shrink-0' />
          <span className={`text-xs font-semibold flex-1 ${isDark ? 'text-white' : 'text-gray-800'}`}>
            {selected.size} row{selected.size !== 1 ? 's' : ''} selected
          </span>
          <button onClick={selectAll} className={`text-xs font-semibold ${isDark ? 'text-[#7367f0] hover:text-violet-300' : 'text-violet-600 hover:text-violet-800'}`}>
            Select all {filtered.length}
          </button>
          <button onClick={clearSelection} className={`text-xs ${textMuted} hover:text-white`}>
            Clear
          </button>
          <button
            onClick={handleAcceptBaseline}
            disabled={accepting}
            className='btn-primary text-xs px-3.5 py-1.5 flex items-center gap-1.5'
          >
            {accepting
              ? <><RefreshCw size={12} className='animate-spin' /> Accepting…</>
              : <><Trash2 size={12} /> Accept & Set Baseline ({selected.size})</>
            }
          </button>
        </div>
      )}

      {loading && (
        <div className='flex flex-col items-center justify-center py-20 gap-3'>
          <RefreshCw size={32} className='animate-spin text-[#7367f0]' />
          <p className={`text-sm ${textMuted}`}>Loading settlement history…</p>
        </div>
      )}

      {!loading && rows.length === 0 && (
        <div className='flex flex-col items-center justify-center py-20 gap-3'>
          <AlertCircle size={40} className='text-[#2a3250]' />
          <p className={`text-sm ${textMuted}`}>No settlement changes recorded yet.</p>
          <p className={`text-xs ${textMuted}`}>Changes are captured automatically when you upload master listings.</p>
        </div>
      )}

      {!loading && filtered.length === 0 && rows.length > 0 && (
        <div className='flex flex-col items-center justify-center py-12 gap-3'>
          <p className={`text-sm ${textMuted}`}>No results match your filters.</p>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className={`border rounded-2xl overflow-hidden ${cardBg}`}>
          <div className={`px-4 py-2.5 border-b flex items-center justify-between ${isDark ? 'border-[#2a3250]' : 'border-gray-100'}`}>
            <span className={`text-xs font-semibold ${textMuted}`}>
              {filtered.length} change{filtered.length !== 1 ? 's' : ''} · sorted by urgency then change %
            </span>
            <span className={`text-xs ${textMuted}`}>
              Page {safePage} of {totalPages}
            </span>
          </div>

          <div className='overflow-x-auto'>
            <table className='w-full text-left border-collapse text-sm'>
              <thead>
                <tr className={`border-b text-xs font-semibold uppercase tracking-wider ${tableHead}`}>
                  <th className='py-2.5 px-4 w-10'>
                    <input
                      type='checkbox'
                      className='rounded'
                      checked={allPageSelected}
                      ref={el => { if (el) el.indeterminate = somePageSelected && !allPageSelected; }}
                      onChange={e => togglePage(e.target.checked)}
                    />
                  </th>
                  <th className='py-2.5 px-4'>Date</th>
                  <th className='py-2.5 px-4'>FSN</th>
                  <th className='py-2.5 px-4'>SKU</th>
                  <th className='py-2.5 px-4'>Product</th>
                  <th className='py-2.5 px-4 text-right'>Old Settlement</th>
                  <th className='py-2.5 px-4 text-right'>New Settlement</th>
                  <th className='py-2.5 px-4 text-right'>Change %</th>
                  <th className='py-2.5 px-4 text-center'>Urgency</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${tableDivide}`}>
                {pageRows.map(r => {
                  const isUp = r.new_settlement > r.old_settlement;
                  const isUrgent = r.urgency === 'urgent';
                  const isSelected = selected.has(r.id);
                  return (
                    <tr
                      key={r.id}
                      onClick={() => toggleRow(r.id)}
                      className={`transition-colors cursor-pointer ${rowHover} ${
                        isSelected
                          ? isDark ? 'bg-[#7367f0]/10' : 'bg-violet-50'
                          : isUrgent ? (isDark ? 'bg-red-500/[0.03]' : 'bg-red-50/50') : ''
                      }`}
                    >
                      <td className='py-2.5 px-4' onClick={e => e.stopPropagation()}>
                        <input
                          type='checkbox'
                          className='rounded'
                          checked={isSelected}
                          onChange={() => toggleRow(r.id)}
                        />
                      </td>
                      <td className={`py-2.5 px-4 text-xs ${textMuted} whitespace-nowrap`}>{r.upload_date}</td>
                      <td className='py-2.5 px-4 text-xs font-mono text-[#7367f0]'>{r.fsn}</td>
                      <td className={`py-2.5 px-4 text-xs font-mono ${textMuted}`}>{r.sku || '—'}</td>
                      <td className={`py-2.5 px-4 text-xs ${textMain} max-w-[180px] truncate`} title={r.product_name}>{r.product_name || '—'}</td>
                      <td className={`py-2.5 px-4 text-right text-xs ${textMuted}`}>{fmt(r.old_settlement)}</td>
                      <td className={`py-2.5 px-4 text-right text-xs font-semibold ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
                        {fmt(r.new_settlement)}
                      </td>
                      <td className='py-2.5 px-4 text-right'>
                        <span className={`text-xs font-bold flex items-center justify-end gap-1 ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
                          {isUp ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                          {fmtPct(r.change_pct)}
                        </span>
                      </td>
                      <td className='py-2.5 px-4 text-center'>
                        {isUrgent
                          ? <span className='badge badge-red'>Urgent</span>
                          : <span className='badge badge-green'>Not Urgent</span>
                        }
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination footer */}
          {totalPages > 1 && (
            <div className={`px-4 py-3 border-t flex items-center justify-between gap-3 ${isDark ? 'border-[#2a3250]' : 'border-gray-100'}`}>
              <span className={`text-xs ${textMuted}`}>
                Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length}
              </span>
              <div className='flex items-center gap-1'>
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={safePage === 1}
                  className={`${pageBtnClass(false)} disabled:opacity-30 disabled:cursor-not-allowed`}
                >
                  <ChevronLeft size={13} />
                </button>
                {pageNums.map((n, i) =>
                  n === '…'
                    ? <span key={`ellipsis-${i}`} className={`text-xs px-1 ${textMuted}`}>…</span>
                    : <button key={n} onClick={() => setPage(n as number)} className={pageBtnClass(safePage === n)}>{n}</button>
                )}
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={safePage === totalPages}
                  className={`${pageBtnClass(false)} disabled:opacity-30 disabled:cursor-not-allowed`}
                >
                  <ChevronRight size={13} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
