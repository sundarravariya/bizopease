import { useState, useEffect, useMemo } from 'react';
import { odooCall } from '../../../services/odoo';
import { useTheme } from '../../../context/ThemeContext';
import { RefreshCw, AlertTriangle, Search } from 'lucide-react';

interface UnmappedFsn {
  id: number;
  fsn: string;
  sku: string;
  product_name: string;
  category: string;
  mrp: number;
  selling_price: number;
  bank_settlement: number;
  listing_id: string;
}

export default function UnmappedFsns() {
  const { isDark } = useTheme();
  const [rows, setRows] = useState<UnmappedFsn[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  const cardBg = isDark ? 'bg-[#161b2e] border-[#2a3250]' : 'bg-white border-gray-200';
  const tableHead = isDark ? 'bg-[#111827]/60 text-[#5a6a8a] border-[#2a3250]' : 'bg-gray-50 text-gray-500 border-gray-200';
  const tableDivide = isDark ? 'divide-[#2a3250]' : 'divide-gray-100';
  const rowHover = isDark ? 'hover:bg-white/[0.03]' : 'hover:bg-gray-50';
  const textMain = isDark ? 'text-white' : 'text-gray-900';
  const textMuted = isDark ? 'text-[#5a6a8a]' : 'text-gray-500';

  const load = async () => {
    setLoading(true);
    try {
      const data = await odooCall<UnmappedFsn[]>('flipkart.listing', 'get_unmapped_fsns', [], {});
      setRows(Array.isArray(data) ? data : []);
    } catch (e: any) {
      console.error('Failed to load unmapped FSNs:', e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter(r =>
      r.fsn?.toLowerCase().includes(q) ||
      r.sku?.toLowerCase().includes(q) ||
      r.product_name?.toLowerCase().includes(q) ||
      r.listing_id?.toLowerCase().includes(q)
    );
  }, [rows, search]);

  const fmt = (n: number) => n ? `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';

  return (
    <div className='p-4 max-w-7xl mx-auto space-y-5 animate-fade-in'>
      <div className='flex flex-col md:flex-row md:items-center justify-between gap-4'>
        <div>
          <h1 className={`text-2xl font-black ${textMain}`}>Unmapped FSNs</h1>
          <p className={`text-xs mt-1 ${textMuted}`}>
            FSNs in master listing with no matching product in <code className='text-[#7367f0]'>sr.multi.barcode</code>
          </p>
        </div>
        <button onClick={load} disabled={loading}
          className='btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5'>
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Summary */}
      <div className={`border rounded-2xl p-4 flex items-center gap-4 ${cardBg}`}>
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${isDark ? 'bg-amber-500/10' : 'bg-amber-50'}`}>
          <AlertTriangle size={18} className='text-amber-400' />
        </div>
        <div>
          <p className={`text-2xl font-black text-amber-400`}>{rows.length}</p>
          <p className={`text-xs font-semibold ${textMuted}`}>FSNs without Odoo product mapping</p>
        </div>
        <p className={`text-xs ml-auto max-w-xs text-right hidden md:block ${textMuted}`}>
          To fix: add a record to <strong>sr.multi.barcode</strong> with FSN as barcode and link it to the correct Odoo product.
        </p>
      </div>

      {/* Search */}
      <div className={`border rounded-2xl p-3 flex items-center gap-2 ${cardBg}`}>
        <Search size={14} className={textMuted} />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder='Search FSN, SKU, product title, listing ID…'
          className={`flex-1 text-sm bg-transparent outline-none ${textMain} placeholder:${textMuted}`}
        />
        {search && (
          <button onClick={() => setSearch('')} className={`text-xs ${textMuted} hover:text-white`}>Clear</button>
        )}
      </div>

      {loading && (
        <div className='flex flex-col items-center justify-center py-20 gap-3'>
          <RefreshCw size={32} className='animate-spin text-[#7367f0]' />
          <p className={`text-sm ${textMuted}`}>Loading unmapped FSNs…</p>
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className='flex flex-col items-center justify-center py-20 gap-3'>
          <AlertTriangle size={40} className='text-[#2a3250]' />
          <p className={`text-sm ${textMuted}`}>
            {rows.length === 0 ? 'All FSNs are mapped to Odoo products.' : 'No results for your search.'}
          </p>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className={`border rounded-2xl overflow-hidden ${cardBg}`}>
          <div className={`px-4 py-2.5 border-b ${isDark ? 'border-[#2a3250]' : 'border-gray-100'}`}>
            <span className={`text-xs font-semibold ${textMuted}`}>
              {filtered.length} of {rows.length} FSNs
            </span>
          </div>
          <div className='overflow-x-auto'>
            <table className='w-full text-left border-collapse text-sm'>
              <thead>
                <tr className={`border-b text-xs font-semibold uppercase tracking-wider ${tableHead}`}>
                  <th className='py-2.5 px-4'>FSN</th>
                  <th className='py-2.5 px-4'>SKU</th>
                  <th className='py-2.5 px-4'>Listing ID</th>
                  <th className='py-2.5 px-4'>Product Title</th>
                  <th className='py-2.5 px-4'>Category</th>
                  <th className='py-2.5 px-4 text-right'>MRP</th>
                  <th className='py-2.5 px-4 text-right'>Selling Price</th>
                  <th className='py-2.5 px-4 text-right'>Bank Settlement</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${tableDivide}`}>
                {filtered.map((r, idx) => (
                  <tr key={r.fsn || idx} className={`transition-colors ${rowHover}`}>
                    <td className={`py-2.5 px-4 font-mono text-xs font-medium text-amber-400`}>{r.fsn}</td>
                    <td className={`py-2.5 px-4 text-xs font-mono ${textMuted}`}>{r.sku || '—'}</td>
                    <td className={`py-2.5 px-4 text-xs ${textMuted}`}>{r.listing_id || '—'}</td>
                    <td className={`py-2.5 px-4 text-xs ${textMain} max-w-[200px] truncate`} title={r.product_name}>{r.product_name || '—'}</td>
                    <td className={`py-2.5 px-4 text-xs ${textMuted}`}>{r.category || '—'}</td>
                    <td className={`py-2.5 px-4 text-right text-xs ${textMuted}`}>{fmt(r.mrp)}</td>
                    <td className={`py-2.5 px-4 text-right text-xs ${textMain} font-medium`}>{fmt(r.selling_price)}</td>
                    <td className={`py-2.5 px-4 text-right text-xs ${textMuted}`}>{fmt(r.bank_settlement)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
