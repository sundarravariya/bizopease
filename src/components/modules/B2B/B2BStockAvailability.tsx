import { useState, useEffect } from 'react';
import { queenCall } from '../../../services/queen';
import { useTheme } from '../../../context/ThemeContext';
import { useAuth } from '../../../context/AuthContext';
import { RefreshCw, CheckCircle2, AlertCircle, Search, Package, Square, CheckSquare, Eye, EyeOff, Tag, TagIcon, X } from 'lucide-react';

interface B2BProduct {
  id: number;
  name: string;
  default_code: string | false;
  list_price: number;
  b2b_stock_clearance: boolean;
  website_published: boolean;
}

export default function B2BStockAvailability() {
  const { user } = useAuth();
  const { isDark } = useTheme();
  if (!user?.is_admin) return <div className="flex items-center justify-center h-64 text-[#8897b5]">Access restricted to administrators.</div>;

  const [products, setProducts] = useState<B2BProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'published' | 'clearance'>('all');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState<Record<number, boolean>>({});
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const showMsg = (ok: boolean, msg: string) => {
    setMessage({ type: ok ? 'success' : 'error', text: msg });
    setTimeout(() => setMessage(null), 4000);
  };

  const fetchProducts = async () => {
    setLoading(true);
    try {
      const res = await queenCall<B2BProduct[]>('product.template', 'search_read', [
        [['sale_ok', '=', true]]
      ], {
        fields: ['id', 'name', 'default_code', 'list_price', 'b2b_stock_clearance', 'website_published'],
        order: 'name asc',
        limit: 0,
      });
      setProducts(Array.isArray(res) ? res : []);
    } catch (err: any) {
      showMsg(false, err?.message || 'Failed to load products');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchProducts(); }, []);

  const handleBulkWrite = async (field: 'website_published' | 'b2b_stock_clearance', value: boolean, label: string) => {
    if (!selectedIds.size) return;
    setLoading(true);
    try {
      await queenCall('product.template', 'write', [[...selectedIds], { [field]: value }]);
      setProducts(prev => prev.map(p => selectedIds.has(p.id) ? { ...p, [field]: value } : p));
      showMsg(true, `${selectedIds.size} product(s): ${label}.`);
      setSelectedIds(new Set());
    } catch (err: any) { showMsg(false, err?.message || 'Bulk update failed'); }
    finally { setLoading(false); }
  };

  const toggleField = async (id: number, field: 'b2b_stock_clearance' | 'website_published', current: boolean) => {
    setSaving(s => ({ ...s, [id]: true }));
    try {
      await queenCall('product.template', 'write', [[id], { [field]: !current }]);
      setProducts(prev => prev.map(p => p.id === id ? { ...p, [field]: !current } : p));
    } catch (err: any) {
      showMsg(false, err?.message || 'Update failed');
    } finally {
      setSaving(s => ({ ...s, [id]: false }));
    }
  };

  const filtered = products.filter(p => {
    const q = search.toLowerCase();
    const matchSearch = !q || p.name.toLowerCase().includes(q) ||
      (p.default_code && String(p.default_code).toLowerCase().includes(q));
    const matchFilter =
      filter === 'all' ? true :
      filter === 'published' ? p.website_published :
      p.b2b_stock_clearance;
    return matchSearch && matchFilter;
  });

  const glassClass = isDark ? 'glass' : 'glass-light bg-white/80';

  const Toggle = ({ on, onToggle, saving: isSaving }: { on: boolean; onToggle: () => void; saving: boolean }) => (
    <button
      onClick={onToggle}
      disabled={isSaving}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${on ? 'bg-[#7367f0]' : isDark ? 'bg-gray-700' : 'bg-gray-200'}`}
    >
      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  );

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className={`text-2xl font-black ${isDark ? 'text-white' : 'text-gray-900'}`}>B2B Stock Availability</h1>
          <p className={`text-xs mt-1 ${isDark ? 'text-[#5a6a8a]' : 'text-gray-500'}`}>
            Toggle website visibility and stock clearance status per product.
          </p>
        </div>
        <button onClick={fetchProducts} className="btn-secondary text-xs px-3.5 py-1.5 flex items-center gap-1">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {message && (
        <div className={`p-4 rounded-xl flex items-start gap-3 border ${message.type === 'success' ? 'bg-green-500/10 border-green-500/20 text-green-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>
          {message.type === 'success' ? <CheckCircle2 size={18} className="flex-shrink-0" /> : <AlertCircle size={18} className="flex-shrink-0" />}
          <span className="text-sm font-medium">{message.text}</span>
        </div>
      )}

      <div className={`card p-3 rounded-2xl flex flex-col sm:flex-row items-center gap-3 ${glassClass}`}>
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search product or SKU..."
            className={`pl-8 pr-3 py-1.5 text-xs rounded-lg border outline-none w-56 ${isDark ? 'bg-[#1f2937] border-white/10 text-white' : 'bg-gray-50 border-gray-200 text-gray-800'}`} />
        </div>
        <div className="flex gap-1">
          {(['all', 'published', 'clearance'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 text-xs font-bold rounded-xl transition-all capitalize ${filter === f ? 'bg-[#7367f0] text-white' : isDark ? 'text-gray-400 hover:text-white hover:bg-white/5' : 'text-gray-500 hover:bg-gray-100'}`}>
              {f}
            </button>
          ))}
        </div>
        <span className={`sm:ml-auto text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{filtered.length} products</span>
      </div>

      {/* Bulk Action Bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-4 py-3 rounded-2xl shadow-2xl border border-[#7367f0]/30 bg-[#161b2e]/95 backdrop-blur-sm animate-fade-in">
          <span className="text-xs font-bold text-violet-400 mr-1">{selectedIds.size} selected</span>
          <button onClick={() => handleBulkWrite('website_published', true, 'Published on website')} className="px-3 py-1.5 bg-green-500/10 text-green-400 border border-green-500/20 text-xs font-bold rounded-lg hover:bg-green-500/20 transition-all flex items-center gap-1">
            <Eye size={11} /> Publish
          </button>
          <button onClick={() => handleBulkWrite('website_published', false, 'Unpublished from website')} className="px-3 py-1.5 bg-gray-500/10 text-gray-400 border border-gray-500/20 text-xs font-bold rounded-lg hover:bg-gray-500/20 transition-all flex items-center gap-1">
            <EyeOff size={11} /> Unpublish
          </button>
          <button onClick={() => handleBulkWrite('b2b_stock_clearance', true, 'Clearance enabled')} className="px-3 py-1.5 bg-amber-500/10 text-amber-400 border border-amber-500/20 text-xs font-bold rounded-lg hover:bg-amber-500/20 transition-all flex items-center gap-1">
            <Tag size={11} /> Set Clearance
          </button>
          <button onClick={() => handleBulkWrite('b2b_stock_clearance', false, 'Clearance removed')} className="px-3 py-1.5 bg-violet-500/10 text-violet-400 border border-violet-500/20 text-xs font-bold rounded-lg hover:bg-violet-500/20 transition-all flex items-center gap-1">
            <TagIcon size={11} /> Remove Clearance
          </button>
          <button onClick={() => setSelectedIds(new Set())} className="ml-1 p-1.5 text-gray-500 hover:text-white transition-colors">
            <X size={14} />
          </button>
        </div>
      )}

      <div className={`card overflow-x-auto rounded-2xl ${glassClass}`}>
        {loading ? (
          <div className="h-48 flex items-center justify-center"><RefreshCw size={20} className="animate-spin text-violet-400" /></div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className={`border-b text-xs font-semibold uppercase tracking-wider ${isDark ? 'border-white/5 bg-[#111827]/40 text-gray-400' : 'border-gray-200 bg-gray-50 text-gray-500'}`}>
                <th className="py-3.5 pl-5 pr-2 w-8">
                  <button onClick={() => {
                    if (selectedIds.size === filtered.length && filtered.length > 0) {
                      setSelectedIds(new Set());
                    } else {
                      setSelectedIds(new Set(filtered.map(p => p.id)));
                    }
                  }} className="text-gray-400 hover:text-violet-400 transition-colors">
                    {selectedIds.size === filtered.length && filtered.length > 0
                      ? <CheckSquare size={14} className="text-violet-400" />
                      : <Square size={14} />}
                  </button>
                </th>
                <th className="py-3.5 px-5">Product</th>
                <th className="py-3.5 px-5">SKU</th>
                <th className="py-3.5 px-5 text-right">Price (₹)</th>
                <th className="py-3.5 px-5 text-center">Live on Website</th>
                <th className="py-3.5 px-5 text-center">Stock Clearance</th>
              </tr>
            </thead>
            <tbody className={`divide-y text-sm ${isDark ? 'divide-white/5' : 'divide-gray-100'}`}>
              {filtered.length === 0 ? (
                <tr><td colSpan={6} className={`py-12 text-center text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>No products found.</td></tr>
              ) : filtered.map(p => {
                const isSelected = selectedIds.has(p.id);
                return (
                <tr key={p.id} className={`transition-colors ${isSelected ? (isDark ? 'bg-violet-500/5' : 'bg-violet-50') : isDark ? 'hover:bg-white/5' : 'hover:bg-gray-50'}`}>
                  <td className="py-3.5 pl-5 pr-2">
                    <button onClick={() => {
                      const next = new Set(selectedIds);
                      if (isSelected) next.delete(p.id); else next.add(p.id);
                      setSelectedIds(next);
                    }} className="text-gray-500 hover:text-violet-400 transition-colors">
                      {isSelected ? <CheckSquare size={14} className="text-violet-400" /> : <Square size={14} />}
                    </button>
                  </td>
                  <td className="py-3.5 px-5">
                    <div className="flex items-center gap-2">
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${isDark ? 'bg-[#2a3250]' : 'bg-gray-100'}`}>
                        <Package size={13} className={isDark ? 'text-gray-400' : 'text-gray-500'} />
                      </div>
                      <span className={`font-semibold text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>{p.name}</span>
                    </div>
                  </td>
                  <td className={`py-3.5 px-5 text-xs font-mono ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    {p.default_code || '—'}
                  </td>
                  <td className={`py-3.5 px-5 text-right font-bold ${isDark ? 'text-white' : 'text-gray-800'}`}>
                    ₹ {p.list_price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="py-3.5 px-5 text-center">
                    <Toggle on={p.website_published} saving={!!saving[p.id]}
                      onToggle={() => toggleField(p.id, 'website_published', p.website_published)} />
                  </td>
                  <td className="py-3.5 px-5 text-center">
                    <Toggle on={p.b2b_stock_clearance} saving={!!saving[p.id]}
                      onToggle={() => toggleField(p.id, 'b2b_stock_clearance', p.b2b_stock_clearance)} />
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
