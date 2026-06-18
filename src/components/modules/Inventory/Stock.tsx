import React, { useState, useEffect } from 'react';
import { useTheme } from '../../../context/ThemeContext';
import { searchRead } from '../../../services/odoo';
import {
  RefreshCw, Search, Download, AlertTriangle, Package,
  DollarSign, TrendingDown, Plus, X
} from 'lucide-react';

interface StockItem {
  id: number;
  product: string;
  sku: string;
  location: string;
  quantity: number;
  reserved: number;
  available: number;
  unit_cost: number;
  total_value: number;
  last_updated: string;
}

const LOCATIONS_FILTER = ['All Locations', 'WH/Stock', 'WH/FBF-Delhi', 'WH/FBF-Mumbai', 'WH/FBF-Bangalore'];

export default function Stock() {
  const { isDark } = useTheme();
  const [items, setItems] = useState<StockItem[]>(() => {
    const c = localStorage.getItem('portal_inventory_stock');
    return c ? JSON.parse(c) : [];
  });
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [locationFilter, setLocationFilter] = useState('All Locations');
  const [showAdjust, setShowAdjust] = useState(false);
  const [adjProduct, setAdjProduct] = useState('');
  const [adjLocation, setAdjLocation] = useState('WH/Stock');
  const [adjQty, setAdjQty] = useState('');
  const [adjReason, setAdjReason] = useState('');

  const syncData = async () => {
    setLoading(true);
    try {
      const r = await searchRead<any>('stock.quant', {
        domain: [['location_id.usage', '=', 'internal']],
        fields: ['id', 'product_id', 'location_id', 'quantity', 'reserved_quantity', 'in_date'],
        limit: 0,
        order: 'id desc',
      });
      if (Array.isArray(r)) {
        const mapped: StockItem[] = r.map((q: any) => {
          const available = (q.quantity || 0) - (q.reserved_quantity || 0);
          const unit_cost = 0;
          return {
            id: q.id,
            product: q.product_id?.[1] || 'Unknown',
            sku: '',
            location: q.location_id?.[1] || '',
            quantity: q.quantity || 0,
            reserved: q.reserved_quantity || 0,
            available,
            unit_cost,
            total_value: available * unit_cost,
            last_updated: q.in_date ? q.in_date.split(' ')[0] : '',
          };
        });
        setItems(mapped);
        localStorage.setItem('portal_inventory_stock', JSON.stringify(mapped));
      }
    } catch {
      console.warn('Odoo offline');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { syncData(); }, []);
  useEffect(() => {
    localStorage.setItem('portal_inventory_stock', JSON.stringify(items));
  }, [items]);

  const filtered = items.filter(it => {
    const matchSearch = !search ||
      it.product.toLowerCase().includes(search.toLowerCase()) ||
      it.sku.toLowerCase().includes(search.toLowerCase()) ||
      it.location.toLowerCase().includes(search.toLowerCase());
    const matchLoc = locationFilter === 'All Locations' || it.location === locationFilter;
    return matchSearch && matchLoc;
  });

  const totalSkus = new Set(items.map(i => i.sku)).size;
  const totalValue = items.reduce((s, i) => s + i.total_value, 0);
  const lowStockCount = items.filter(i => i.available < 10).length;
  const criticalCount = items.filter(i => i.available < 5).length;

  const handleAdjust = () => {
    if (!adjProduct || !adjQty) return;
    const delta = Number(adjQty);
    setItems(prev => prev.map(it =>
      it.product === adjProduct && it.location === adjLocation
        ? {
            ...it,
            quantity: Math.max(0, it.quantity + delta),
            available: Math.max(0, it.available + delta),
            total_value: Math.max(0, it.available + delta) * it.unit_cost,
          }
        : it
    ));
    setShowAdjust(false);
    setAdjProduct('');
    setAdjQty('');
    setAdjReason('');
  };

  const exportCsv = () => {
    const header = 'Product,SKU,Location,On Hand,Reserved,Available,Unit Cost,Total Value,Last Updated\n';
    const rows = filtered.map(i =>
      `"${i.product}","${i.sku}","${i.location}",${i.quantity},${i.reserved},${i.available},${i.unit_cost},${i.total_value},"${i.last_updated}"`
    ).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'stock_report.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const availColor = (av: number) =>
    av < 5 ? 'text-red-400 font-bold' : av < 10 ? 'text-amber-400 font-semibold' : 'text-green-400';

  const ic = `input text-xs py-2 ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`;
  const modalBg = `w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl shadow-2xl border ${isDark ? 'bg-[#161b2e] border-[#2a3250]' : 'bg-white border-gray-200'}`;
  const modalHeader = `flex items-center justify-between p-5 border-b ${isDark ? 'border-[#2a3250]' : 'border-gray-200'}`;
  const modalFooter = `flex justify-end gap-3 p-5 border-t ${isDark ? 'border-[#2a3250]' : 'border-gray-200'}`;

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className={`text-xl font-black ${isDark ? 'text-white' : 'text-gray-900'}`}>Live Stock Positions</h1>
          <p className={`text-xs mt-0.5 ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>
            Real-time inventory quants across all warehouse locations
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportCsv} className="btn-secondary text-xs px-3 py-2">
            <Download size={13} /> Export CSV
          </button>
          <button onClick={syncData} disabled={loading} className="btn-secondary text-xs px-3 py-2">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Sync
          </button>
          <button onClick={() => setShowAdjust(true)} className="btn-primary text-xs px-3 py-2">
            <Plus size={13} /> Adjust Stock
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { label: 'Total SKUs', value: totalSkus.toString(), icon: Package, color: 'text-[#7367f0]', bg: 'bg-[#7367f0]/10' },
          { label: 'Total Stock Value', value: `₹${(totalValue / 100000).toFixed(1)}L`, icon: DollarSign, color: 'text-green-400', bg: 'bg-green-500/10' },
          { label: 'Low Stock Items', value: lowStockCount.toString(), icon: TrendingDown, color: 'text-amber-400', bg: 'bg-amber-500/10' },
        ].map(s => (
          <div key={s.label} className="card p-4 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl ${s.bg} flex items-center justify-center`}>
              <s.icon size={18} className={s.color} />
            </div>
            <div>
              <p className={`text-xl font-black ${isDark ? 'text-white' : 'text-gray-900'}`}>{s.value}</p>
              <p className={`text-[10px] font-medium ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Critical stock warning */}
      {criticalCount > 0 && (
        <div className={`flex items-center gap-3 p-4 rounded-xl border ${isDark ? 'bg-red-500/10 border-red-500/30' : 'bg-red-50 border-red-200'}`}>
          <AlertTriangle size={16} className="text-red-400 shrink-0" />
          <p className={`text-xs font-semibold ${isDark ? 'text-red-300' : 'text-red-700'}`}>
            {criticalCount} product{criticalCount > 1 ? 's' : ''} at critical stock level (available &lt; 5 units). Immediate reorder recommended.
          </p>
        </div>
      )}

      {/* Filters */}
      <div className="card p-3 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={14} className={`absolute left-3 top-1/2 -translate-y-1/2 ${isDark ? 'text-[#4a5580]' : 'text-gray-400'}`} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search product, SKU, location..."
            className={`input pl-9 text-xs py-2 ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`}
          />
        </div>
        <select value={locationFilter} onChange={e => setLocationFilter(e.target.value)} className={ic}>
          {LOCATIONS_FILTER.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-40 gap-3">
            <RefreshCw size={18} className="animate-spin text-[#7367f0]" />
            <span className={`text-sm ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>Loading stock data...</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table w-full">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>SKU</th>
                  <th>Location</th>
                  <th className="text-right">On Hand</th>
                  <th className="text-right">Reserved</th>
                  <th className="text-right">Available</th>
                  <th className="text-right">Unit Cost</th>
                  <th className="text-right">Total Value</th>
                  <th>Last Updated</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(it => (
                  <tr key={it.id} className={it.available < 5 ? isDark ? 'bg-red-500/5' : 'bg-red-50/50' : ''}>
                    <td className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                      <div className="flex items-center gap-1.5">
                        {it.available < 5 && <AlertTriangle size={11} className="text-red-400 shrink-0" />}
                        {it.product}
                      </div>
                    </td>
                    <td className={`font-mono text-xs ${isDark ? 'text-[#7367f0]' : 'text-violet-600'}`}>{it.sku || '—'}</td>
                    <td className={`text-xs ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>{it.location}</td>
                    <td className={`text-right text-xs ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>{it.quantity}</td>
                    <td className={`text-right text-xs ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>{it.reserved}</td>
                    <td className={`text-right text-xs font-bold ${availColor(it.available)}`}>{it.available}</td>
                    <td className={`text-right text-xs ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                      {it.unit_cost > 0 ? `₹${it.unit_cost.toLocaleString('en-IN')}` : '—'}
                    </td>
                    <td className={`text-right text-xs font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                      {it.total_value > 0 ? `₹${it.total_value.toLocaleString('en-IN')}` : '—'}
                    </td>
                    <td className={`text-xs ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>
                      {it.last_updated ? new Date(it.last_updated).toLocaleDateString('en-IN') : '—'}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={9} className="text-center py-10">
                      <Package size={32} className={`mx-auto mb-2 ${isDark ? 'text-[#2a3250]' : 'text-gray-200'}`} />
                      <p className={`text-xs ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>No stock records found</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Adjust Modal */}
      {showAdjust && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className={modalBg}>
            <div className={modalHeader}>
              <h2 className={`text-base font-black ${isDark ? 'text-white' : 'text-gray-900'}`}>Stock Adjustment</h2>
              <button onClick={() => setShowAdjust(false)} className={`p-2 rounded-lg ${isDark ? 'hover:bg-white/5 text-[#5a6a8a]' : 'hover:bg-gray-100 text-gray-400'}`}>
                <X size={16} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="label mb-1 block">Product</label>
                <select value={adjProduct} onChange={e => setAdjProduct(e.target.value)} className={`${ic} w-full`}>
                  <option value="">-- Select product --</option>
                  {[...new Set(items.map(i => i.product))].map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label mb-1 block">Location</label>
                <select value={adjLocation} onChange={e => setAdjLocation(e.target.value)} className={`${ic} w-full`}>
                  {LOCATIONS_FILTER.filter(l => l !== 'All Locations').map(l => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label mb-1 block">Adjustment Quantity (+/-)</label>
                <input
                  type="number"
                  value={adjQty}
                  onChange={e => setAdjQty(e.target.value)}
                  placeholder="e.g. +50 or -10"
                  className={`${ic} w-full`}
                />
                <p className={`text-[10px] mt-1 ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>
                  Use negative values to decrease stock
                </p>
              </div>
              <div>
                <label className="label mb-1 block">Reason</label>
                <input
                  value={adjReason}
                  onChange={e => setAdjReason(e.target.value)}
                  placeholder="e.g. Physical count correction"
                  className={`${ic} w-full`}
                />
              </div>
            </div>
            <div className={modalFooter}>
              <button onClick={() => setShowAdjust(false)} className="btn-secondary text-xs px-4 py-2">Cancel</button>
              <button onClick={handleAdjust} disabled={!adjProduct || !adjQty} className="btn-primary text-xs px-4 py-2">
                Apply Adjustment
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}



