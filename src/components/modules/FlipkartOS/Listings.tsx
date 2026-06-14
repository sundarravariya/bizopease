import { useState, useEffect } from 'react';
import { searchRead, searchCount } from '../../../services/odoo';
import { useTheme } from '../../../context/ThemeContext';
import { useAuth } from '../../../context/AuthContext';
import BulkDeleteBar from '../../ui/BulkDeleteBar';
import { RefreshCw, Search, Package, Tag, IndianRupee, Layers } from 'lucide-react';

interface Listing {
  id: number;
  fsn: string;
  sku: string;
  name: string;
  category: string;
  mrp: number;
  selling_price: number;
  length_cm: number;
  breadth_cm: number;
  height_cm: number;
  weight_kg: number;
  manufacturer: string;
  packer: string;
}

export default function Listings() {
  const { isDark } = useTheme();
  const { user } = useAuth();
  const isAdmin = !!user?.is_admin;
  const [selIds, setSelIds] = useState<Set<number>>(new Set());
  const [items, setItems] = useState<Listing[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 100;

  useEffect(() => { sync(0); }, []);

  const sync = async (offset = 0) => {
    setLoading(true);
    try {
      const domain: any[] = search
        ? [['|'], ['fsn', 'ilike', search], ['|'], ['sku', 'ilike', search], ['name', 'ilike', search]]
        : [];
      const [r, cnt] = await Promise.all([
        searchRead<Listing>('flipkart.listing', {
          domain,
          fields: ['id', 'fsn', 'sku', 'name', 'category', 'mrp', 'selling_price', 'length_cm', 'breadth_cm', 'height_cm', 'weight_kg', 'manufacturer', 'packer'],
          limit: PAGE_SIZE,
          offset,
          order: 'id desc',
        }),
        searchCount('flipkart.listing', domain),
      ]);
      if (Array.isArray(r)) setItems(r);
      setTotal(cnt || 0);
      setPage(offset / PAGE_SIZE);
    } catch (e: any) {
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => sync(0);

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className={`text-xl font-black ${isDark ? 'text-white' : 'text-gray-900'}`}>Listings Master</h1>
          <p className={`text-xs mt-0.5 ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>
            {total.toLocaleString('en-IN')} total FSN listings · Flipkart catalog
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => sync(0)} disabled={loading} className="btn-secondary text-xs px-3 py-2">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Sync
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total FSNs', value: total, icon: Layers, color: 'text-[#7367f0]', bg: 'bg-[#7367f0]/10' },
          { label: 'Loaded', value: items.length, icon: Package, color: 'text-green-400', bg: 'bg-green-500/10' },
          { label: 'With Price', value: items.filter(i => i.selling_price > 0).length, icon: IndianRupee, color: 'text-amber-400', bg: 'bg-amber-500/10' },
          { label: 'With Category', value: items.filter(i => i.category).length, icon: Tag, color: 'text-blue-400', bg: 'bg-blue-500/10' },
        ].map(s => (
          <div key={s.label} className="card p-4 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl ${s.bg} flex items-center justify-center`}>
              <s.icon size={18} className={s.color} />
            </div>
            <div>
              <p className={`text-xl font-black ${isDark ? 'text-white' : 'text-gray-900'}`}>{s.value}</p>
              <p className={`text-[10px] ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="card p-3 flex gap-3">
        <div className="relative flex-1">
          <Search size={14} className={`absolute left-3 top-1/2 -translate-y-1/2 ${isDark ? 'text-[#4a5580]' : 'text-gray-400'}`} />
          <input value={search} onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            placeholder="Search by FSN, SKU, or product name..."
            className={`input pl-9 text-xs py-2 ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`} />
        </div>
        <button onClick={handleSearch} className="btn-primary text-xs px-4 py-2">Search</button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="card h-48 flex items-center justify-center gap-3">
          <RefreshCw size={18} className="animate-spin text-[#7367f0]" />
          <span className={`text-sm ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>Loading listings...</span>
        </div>
      ) : items.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-20 gap-3">
          <Layers size={40} className="text-[#2a3250]" />
          <p className={`text-sm ${isDark ? 'text-[#5a6a8a]' : 'text-gray-500'}`}>No listings found. Click Sync to load from Odoo.</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="data-table w-full">
              <thead>
                <tr>
                  {isAdmin && <th className="w-8"><input type="checkbox" className="rounded" checked={items.length > 0 && items.every(l => selIds.has(l.id))} onChange={e => setSelIds(e.target.checked ? new Set(items.map(l => l.id)) : new Set())} /></th>}
                  <th>FSN</th>
                  <th>SKU</th>
                  <th>Product Title</th>
                  <th>Category</th>
                  <th className="text-right">MRP</th>
                  <th className="text-right">Selling Price</th>
                  <th className="text-right">Dimensions (L×B×H cm)</th>
                  <th className="text-right">Weight (kg)</th>
                  <th>Manufacturer</th>
                  <th>Packer</th>
                </tr>
              </thead>
              <tbody>
                {items.map(l => (
                  <tr key={l.id} className={selIds.has(l.id) ? (isDark ? 'bg-[#7367f0]/5' : 'bg-violet-50') : ''}>
                    {isAdmin && <td><input type="checkbox" className="rounded" checked={selIds.has(l.id)} onChange={() => setSelIds(prev => { const n = new Set(prev); n.has(l.id) ? n.delete(l.id) : n.add(l.id); return n; })} /></td>}
                    <td className="font-mono text-xs text-[#7367f0]">{l.fsn || '—'}</td>
                    <td className={`text-xs font-medium ${isDark ? 'text-[#8897b5]' : 'text-gray-600'}`}>{l.sku || '—'}</td>
                    <td className={`font-medium max-w-[200px] truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>{l.name || '—'}</td>
                    <td className={`text-xs ${isDark ? 'text-[#8897b5]' : 'text-gray-500'}`}>{l.category || '—'}</td>
                    <td className={`text-right text-xs ${isDark ? 'text-[#8897b5]' : 'text-gray-600'}`}>
                      {l.mrp ? `₹${l.mrp.toLocaleString('en-IN')}` : '—'}
                    </td>
                    <td className={`text-right font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                      {l.selling_price ? `₹${l.selling_price.toLocaleString('en-IN')}` : '—'}
                    </td>
                    <td className={`text-right text-xs ${isDark ? 'text-[#8897b5]' : 'text-gray-600'}`}>
                      {[l.length_cm, l.breadth_cm, l.height_cm].every(v => v > 0)
                        ? `${l.length_cm}×${l.breadth_cm}×${l.height_cm}` : '—'}
                    </td>
                    <td className={`text-right text-xs ${isDark ? 'text-[#8897b5]' : 'text-gray-600'}`}>
                      {l.weight_kg > 0 ? l.weight_kg.toFixed(3) : '—'}
                    </td>
                    <td className={`text-xs max-w-[180px] truncate ${isDark ? 'text-[#8897b5]' : 'text-gray-600'}`} title={l.manufacturer || ''}>
                      {l.manufacturer || '—'}
                    </td>
                    <td className={`text-xs max-w-[180px] truncate ${isDark ? 'text-[#8897b5]' : 'text-gray-600'}`} title={l.packer || ''}>
                      {l.packer || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {total > PAGE_SIZE && (
            <div className={`flex items-center justify-between px-4 py-3 border-t text-xs ${isDark ? 'border-[#2a3250] text-[#5a6a8a]' : 'border-gray-100 text-gray-400'}`}>
              <span>Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total.toLocaleString('en-IN')}</span>
              <div className="flex gap-2">
                <button onClick={() => sync((page - 1) * PAGE_SIZE)} disabled={page === 0}
                  className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-40">Prev</button>
                <button onClick={() => sync((page + 1) * PAGE_SIZE)} disabled={(page + 1) * PAGE_SIZE >= total}
                  className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-40">Next</button>
              </div>
            </div>
          )}
        </div>
      )}

      <BulkDeleteBar model="flipkart.listing" label="listing" ids={Array.from(selIds)}
        onClear={() => setSelIds(new Set())} onDeleted={() => sync(page * PAGE_SIZE)} />
    </div>
  );
}
