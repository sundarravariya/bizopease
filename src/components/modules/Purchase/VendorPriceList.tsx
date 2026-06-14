import React, { useState, useEffect, useRef } from 'react';
import { searchRead, createRecord, writeRecord, odooCall } from '../../../services/odoo';
import { useTheme } from '../../../context/ThemeContext';
import {
  Plus, RefreshCw, Search, Tag, Users, Package,
  CheckCircle2, X, Save, Edit2, Trash2, AlertCircle,
} from 'lucide-react';

// ------------------------------------------------------------------ types ---

interface SupplierInfo {
  id: number;
  partner_id: [number, string] | false;
  product_id: [number, string] | false;
  product_tmpl_id: [number, string] | false;
  product_name: string | false;
  product_code: string | false;
  min_qty: number;
  price: number;
  currency_id: [number, string] | false;
  delay: number;
  exchange_rate_used: number;
  price_inr: number;
}

interface Partner { id: number; name: string; }
interface ProductResult {
  id: number;
  name: string;
  default_code: string | false;
  product_tmpl_id: [number, string] | false;
}

// ---------------------------------------------------------------- constants --

const SI_FIELDS: string[] = [
  'id',
  'partner_id',
  'product_id',
  'product_tmpl_id',
  'product_name',
  'product_code',
  'min_qty',
  'price',
  'currency_id',
  'delay',
  'exchange_rate_used',
  'price_inr',
];

// --------------------------------------------------------------------- util --

function fmtNum(n: number, digits = 2): string {
  return n.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function fmtL(n: number): string {
  if (n >= 100000) return (n / 100000).toFixed(1) + 'L';
  return fmtNum(n, 0);
}

// ================================================================= component ==

export default function VendorPriceList() {
  const { isDark } = useTheme();

  // list data
  const [items, setItems] = useState<SupplierInfo[]>([]);
  const [loading, setLoading] = useState(false);

  // filter state
  const [search, setSearch] = useState('');
  const [vendorFilter, setVendorFilter] = useState<number | ''>('');

  // reference data
  const [vendors, setVendors] = useState<Partner[]>([]);

  // toast
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);

  // modals
  const [showCreate, setShowCreate] = useState(false);
  const [editItem, setEditItem] = useState<SupplierInfo | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // create form
  const blankCreate = {
    vendorId: '' as number | '',
    vendorSearch: '',
    showVendorDrop: false,
    productId: '' as number | '',
    productTmplId: '' as number | '',
    productSearch: '',
    showProductDrop: false,
    productResults: [] as ProductResult[],
    price: '',
    min_qty: '1',
    delay: '7',
    price_inr: '',
    exchange_rate_used: '',
  };
  const [cf, setCf] = useState(blankCreate);

  // edit form mirrors editItem fields we allow changing
  const [ef, setEf] = useState({
    price: 0,
    min_qty: 0,
    delay: 0,
    price_inr: 0,
    exchange_rate_used: 0,
  });

  // dropdown close refs
  const vendorDropRef = useRef<HTMLDivElement>(null);
  const prodDropRef = useRef<HTMLDivElement>(null);

  // ----------------------------------------------------------- side effects --

  useEffect(() => {
    loadVendors();
    sync();
  }, []);

  useEffect(() => {
    sync();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorFilter]);

  // close dropdowns on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (vendorDropRef.current && !vendorDropRef.current.contains(e.target as Node)) {
        setCf(p => ({ ...p, showVendorDrop: false }));
      }
      if (prodDropRef.current && !prodDropRef.current.contains(e.target as Node)) {
        setCf(p => ({ ...p, showProductDrop: false }));
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ---------------------------------------------------------------- helpers --

  const showMsg = (ok: boolean, msg: string) => {
    setToast({ ok, msg });
    setTimeout(() => setToast(null), 5000);
  };

  // ------------------------------------------------------------------ fetch --

  const loadVendors = async () => {
    try {
      const r = await searchRead<Partner>('res.partner', {
        fields: ['id', 'name'],
        domain: [['active', '=', true], ['supplier_rank', '>', 0]],
        limit: 0,
        order: 'name asc',
      });
      setVendors(Array.isArray(r) ? r : []);
    } catch (e: any) { showMsg(false, 'Could not load vendors: ' + e.message); }
  };

  const sync = async () => {
    setLoading(true);
    try {
      const domain: any[] = vendorFilter ? [['partner_id', '=', vendorFilter]] : [];
      const r = await searchRead<SupplierInfo>('product.supplierinfo', {
        fields: SI_FIELDS,
        domain,
        limit: 0,
        order: 'partner_id asc, id asc',
      });
      setItems(Array.isArray(r) ? r : []);
    } catch (e: any) { showMsg(false, 'Sync failed: ' + e.message); }
    finally { setLoading(false); }
  };

  const searchProducts = async (q: string) => {
    if (!q || q.length < 2) { setCf(p => ({ ...p, productResults: [] })); return; }
    try {
      const r = await searchRead<ProductResult>('product.product', {
        fields: ['id', 'name', 'default_code', 'product_tmpl_id'],
        domain: [
          ['purchase_ok', '=', true],
          ['active', '=', true],
          '|', ['name', 'ilike', q], ['default_code', 'ilike', q],
        ],
        limit: 20,
      });
      setCf(p => ({ ...p, productResults: Array.isArray(r) ? r : [] }));
    } catch { /* silent */ }
  };

  // --------------------------------------------------------------- mutations --

  const handleCreate = async () => {
    if (!cf.vendorId || !cf.productTmplId || !cf.price) {
      showMsg(false, 'Vendor, product and price are required.');
      return;
    }
    setSubmitting(true);
    try {
      const vals: Record<string, any> = {
        partner_id: cf.vendorId,
        product_tmpl_id: cf.productTmplId,
        price: parseFloat(cf.price) || 0,
        min_qty: parseFloat(cf.min_qty) || 1,
        delay: parseInt(cf.delay) || 7,
      };
      if (cf.price_inr) vals.price_inr = parseFloat(cf.price_inr);
      if (cf.exchange_rate_used) vals.exchange_rate_used = parseFloat(cf.exchange_rate_used);
      await createRecord('product.supplierinfo', vals);
      showMsg(true, 'Vendor price entry added.');
      setShowCreate(false);
      setCf(blankCreate);
      sync();
    } catch (e: any) { showMsg(false, 'Create failed: ' + e.message); }
    finally { setSubmitting(false); }
  };

  const openEdit = (item: SupplierInfo) => {
    setEditItem(item);
    setEf({
      price: item.price || 0,
      min_qty: item.min_qty || 1,
      delay: item.delay || 0,
      price_inr: item.price_inr || 0,
      exchange_rate_used: item.exchange_rate_used || 1,
    });
  };

  const handleUpdate = async () => {
    if (!editItem) return;
    setSubmitting(true);
    try {
      await writeRecord('product.supplierinfo', [editItem.id], {
        price: ef.price,
        min_qty: ef.min_qty,
        delay: ef.delay,
        exchange_rate_used: ef.exchange_rate_used,
      });
      showMsg(true, 'Price entry updated.');
      setEditItem(null);
      sync();
    } catch (e: any) { showMsg(false, 'Update failed: ' + e.message); }
    finally { setSubmitting(false); }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Remove this vendor price entry? This cannot be undone.')) return;
    try {
      await odooCall('product.supplierinfo', 'unlink', [[id]], {});
      showMsg(true, 'Entry removed.');
      sync();
    } catch (e: any) { showMsg(false, 'Delete failed: ' + e.message); }
  };

  // ---------------------------------------------------------------- filters --

  const filtered = items.filter(item => {
    if (!search) return true;
    const q = search.toLowerCase();
    const prod = Array.isArray(item.product_id) ? item.product_id[1] : (Array.isArray(item.product_tmpl_id) ? item.product_tmpl_id[1] : (item.product_name || ''));
    const vendor = Array.isArray(item.partner_id) ? item.partner_id[1] : '';
    const code = item.product_code || '';
    return (
      String(prod).toLowerCase().includes(q) ||
      vendor.toLowerCase().includes(q) ||
      String(code).toLowerCase().includes(q)
    );
  });

  // ------------------------------------------------------------------ stats --

  const distinctVendors = new Set(items.map(i => Array.isArray(i.partner_id) ? i.partner_id[0] : null).filter(Boolean)).size;
  const distinctProducts = new Set(items.map(i => {
    if (Array.isArray(i.product_tmpl_id)) return 'tmpl-' + i.product_tmpl_id[0];
    if (Array.isArray(i.product_id)) return 'prod-' + i.product_id[0];
    return null;
  }).filter(Boolean)).size;
  const withPriceInr = items.filter(i => (i.price_inr || 0) > 0).length;

  // ------------------------------------------------------------- style tokens -

  const pt = isDark ? 'text-white' : 'text-gray-900';
  const st = isDark ? 'text-[#5a6a8a]' : 'text-gray-500';
  const inp = `input text-xs py-2 ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`;
  const modalBg = `w-full rounded-2xl shadow-2xl border ${isDark ? 'bg-[#161b2e] border-[#2a3250]' : 'bg-white border-gray-200'}`;
  const mh = `flex items-center justify-between p-5 border-b ${isDark ? 'border-[#2a3250]' : 'border-gray-200'}`;
  const mf = `flex justify-end gap-3 p-5 border-t ${isDark ? 'border-[#2a3250]' : 'border-gray-200'}`;
  const dropBg = `absolute z-30 w-full rounded-xl border shadow-xl mt-1 max-h-48 overflow-y-auto ${isDark ? 'bg-[#1e2440] border-[#2a3250]' : 'bg-white border-gray-200'}`;
  const dropItem = `w-full text-left px-3 py-2 text-xs hover:bg-[#7367f0]/10 ${isDark ? 'text-white' : 'text-gray-800'}`;

  // filtered vendor list for create dropdown
  const filteredVendors = vendors.filter(v =>
    !cf.vendorSearch || v.name.toLowerCase().includes(cf.vendorSearch.toLowerCase())
  ).slice(0, 12);

  // ================================================================== render ==
  return (
    <div className="space-y-5 animate-fade-in">

      {/* ---- Toast ---- */}
      {toast && (
        <div className={`fixed top-5 right-5 z-50 px-4 py-3 rounded-xl shadow-xl text-sm font-medium flex items-center gap-2
          ${toast.ok
            ? 'bg-green-500/15 border border-green-500/30 text-green-400'
            : 'bg-red-500/15 border border-red-500/30 text-red-400'}`}>
          {toast.ok ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />} {toast.msg}
        </div>
      )}

      {/* ---- Header ---- */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className={`text-xl font-black ${pt}`}>Vendor Price List</h1>
          <p className={`text-xs mt-0.5 ${st}`}>
            {filtered.length} price entries -- supplier pricebook (product.supplierinfo)
          </p>
        </div>
        <div className="flex gap-2 self-start sm:self-auto">
          <button onClick={sync} disabled={loading} className="btn-secondary text-xs px-3 py-2">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Sync
          </button>
          <button onClick={() => { setCf(blankCreate); setShowCreate(true); }} className="btn-primary text-xs px-3 py-2">
            <Plus size={13} /> New Price
          </button>
        </div>
      </div>

      {/* ---- Stats ---- */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Price Entries', val: String(items.length), icon: Tag, color: 'text-[#7367f0]', bg: 'bg-[#7367f0]/10' },
          { label: 'Distinct Vendors', val: String(distinctVendors), icon: Users, color: 'text-blue-400', bg: 'bg-blue-500/10' },
          { label: 'Distinct Products', val: String(distinctProducts), icon: Package, color: 'text-green-400', bg: 'bg-green-500/10' },
          { label: 'With INR Price', val: String(withPriceInr), icon: CheckCircle2, color: 'text-amber-400', bg: 'bg-amber-500/10' },
        ].map(s => (
          <div key={s.label} className="card p-4 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl ${s.bg} flex items-center justify-center flex-shrink-0`}>
              <s.icon size={18} className={s.color} />
            </div>
            <div>
              <p className={`text-xl font-black ${pt}`}>{s.val}</p>
              <p className={`text-[10px] font-medium ${st}`}>{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ---- Filter bar ---- */}
      <div className="card p-3 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={14} className={`absolute left-3 top-1/2 -translate-y-1/2 ${st}`} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by product name, code or vendor..."
            className={`input pl-9 text-xs py-2 w-full ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`}
          />
        </div>
        <select
          value={vendorFilter}
          onChange={e => setVendorFilter(e.target.value ? Number(e.target.value) : '')}
          className={`${inp} min-w-[180px]`}
        >
          <option value="">All Vendors</option>
          {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </div>

      {/* ---- Table ---- */}
      {loading ? (
        <div className="card h-48 flex items-center justify-center gap-3">
          <RefreshCw size={18} className="animate-spin text-[#7367f0]" />
          <span className={`text-sm ${st}`}>Syncing from Odoo...</span>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="data-table w-full">
              <thead>
                <tr>
                  <th>Vendor</th>
                  <th>Product</th>
                  <th>Vendor Product Code</th>
                  <th className="text-right">Min Qty</th>
                  <th className="text-right">Price</th>
                  <th className="text-right">Price INR</th>
                  <th className="text-right">Exchange Rate</th>
                  <th className="text-right">Lead Time (d)</th>
                  <th className="text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center py-10">
                      <Tag size={32} className={`mx-auto mb-2 ${isDark ? 'text-[#2a3250]' : 'text-gray-200'}`} />
                      <p className={`text-xs ${st}`}>No price entries found.</p>
                    </td>
                  </tr>
                ) : filtered.map(item => {
                  const vendorName = Array.isArray(item.partner_id) ? item.partner_id[1] : '--';
                  const prodName = Array.isArray(item.product_id)
                    ? item.product_id[1]
                    : (Array.isArray(item.product_tmpl_id) ? item.product_tmpl_id[1] : (item.product_name || '--'));
                  const currCode = Array.isArray(item.currency_id) ? item.currency_id[1] : '';
                  const code = item.product_code || '--';
                  return (
                    <tr key={item.id}>
                      <td className={`font-semibold text-xs ${pt}`}>{vendorName}</td>
                      <td className={`text-xs ${st} max-w-[200px] truncate`}>{prodName}</td>
                      <td className="font-mono text-xs text-[#7367f0]">{code}</td>
                      <td className={`text-right text-xs ${st}`}>{fmtNum(item.min_qty || 1, 0)}</td>
                      <td className={`text-right font-semibold text-xs ${pt}`}>
                        {currCode ? currCode + ' ' : ''}{fmtNum(item.price || 0)}
                      </td>
                      <td className={`text-right font-semibold text-xs ${(item.price_inr || 0) > 0 ? 'text-amber-400' : st}`}>
                        {(item.price_inr || 0) > 0 ? 'Rs.' + fmtL(item.price_inr) : '--'}
                      </td>
                      <td className={`text-right text-xs ${st}`}>
                        {(item.exchange_rate_used || 0) > 0 ? fmtNum(item.exchange_rate_used, 4) : '--'}
                      </td>
                      <td className={`text-right text-xs ${st}`}>{item.delay || 0}</td>
                      <td className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => openEdit(item)}
                            className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-white/5 text-[#5a6a8a] hover:text-[#7367f0]' : 'hover:bg-gray-100 text-gray-400 hover:text-violet-600'}`}
                            title="Edit"
                          >
                            <Edit2 size={13} />
                          </button>
                          <button
                            onClick={() => handleDelete(item.id)}
                            className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-red-500/10 text-[#5a6a8a] hover:text-red-400' : 'hover:bg-red-50 text-gray-400 hover:text-red-500'}`}
                            title="Delete"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className={`px-4 py-2 text-xs border-t ${isDark ? 'border-[#2a3250] text-[#4a5580]' : 'border-gray-100 text-gray-400'}`}>
            {filtered.length} of {items.length} entries shown
          </div>
        </div>
      )}

      {/* ================================================================ New Price Modal */}
      {showCreate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
          onClick={() => setShowCreate(false)}
        >
          <div
            className={`${modalBg} max-w-lg w-full max-h-[90vh] overflow-y-auto`}
            onClick={e => e.stopPropagation()}
          >
            <div className={`${mh} sticky top-0 z-10 ${isDark ? 'bg-[#161b2e]' : 'bg-white'}`}>
              <h2 className={`text-base font-black ${pt}`}>New Vendor Price Entry</h2>
              <button
                onClick={() => setShowCreate(false)}
                className={`p-2 rounded-lg ${isDark ? 'hover:bg-white/5 text-[#5a6a8a]' : 'hover:bg-gray-100 text-gray-400'}`}
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-5 space-y-4">

              {/* Vendor searchable dropdown */}
              <div ref={vendorDropRef} className="relative">
                <label className={`text-[10px] font-semibold block mb-1 ${st}`}>Vendor *</label>
                <input
                  value={cf.vendorSearch}
                  onChange={e => {
                    setCf(p => ({ ...p, vendorSearch: e.target.value, vendorId: '', showVendorDrop: true }));
                  }}
                  onFocus={() => setCf(p => ({ ...p, showVendorDrop: true }))}
                  placeholder="Search vendor (supplier_rank > 0)..."
                  className={`${inp} w-full`}
                />
                {Number(cf.vendorId) > 0 && (
                  <p className="mt-1 text-xs font-semibold text-[#7367f0]">-- {cf.vendorSearch}</p>
                )}
                {cf.showVendorDrop && !cf.vendorId && filteredVendors.length > 0 && (
                  <div className={dropBg}>
                    {filteredVendors.map(v => (
                      <button
                        key={v.id}
                        type="button"
                        className={dropItem}
                        onClick={() => setCf(p => ({ ...p, vendorId: v.id, vendorSearch: v.name, showVendorDrop: false }))}
                      >
                        {v.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Product searchable dropdown */}
              <div ref={prodDropRef} className="relative">
                <label className={`text-[10px] font-semibold block mb-1 ${st}`}>Product *</label>
                <input
                  value={cf.productSearch}
                  onChange={e => {
                    const v = e.target.value;
                    setCf(p => ({ ...p, productSearch: v, productId: '', productTmplId: '', showProductDrop: true }));
                    searchProducts(v);
                  }}
                  onFocus={() => setCf(p => ({ ...p, showProductDrop: true }))}
                  placeholder="Search product by name or SKU..."
                  className={`${inp} w-full`}
                />
                {cf.productTmplId !== '' && (
                  <p className="mt-1 text-xs font-semibold text-[#7367f0]">-- {cf.productSearch}</p>
                )}
                {cf.showProductDrop && !cf.productTmplId && cf.productResults.length > 0 && (
                  <div className={dropBg}>
                    {cf.productResults.map(p => (
                      <button
                        key={p.id}
                        type="button"
                        className={dropItem}
                        onClick={() => {
                          const tmplId = Array.isArray(p.product_tmpl_id) ? p.product_tmpl_id[0] : ('' as number | '');
                          setCf(prev => ({
                            ...prev,
                            productId: p.id,
                            productTmplId: tmplId,
                            productSearch: p.name + (p.default_code ? ' [' + p.default_code + ']' : ''),
                            showProductDrop: false,
                            productResults: [],
                          }));
                        }}
                      >
                        <span className="font-semibold">{p.name}</span>
                        {p.default_code && (
                          <span className={`ml-1 text-[10px] ${st}`}>[{p.default_code}]</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={`text-[10px] font-semibold block mb-1 ${st}`}>Price *</label>
                  <input
                    type="number" min="0" step="0.0001"
                    value={cf.price}
                    onChange={e => setCf(p => ({ ...p, price: e.target.value }))}
                    placeholder="e.g. 12.50"
                    className={`${inp} w-full`}
                  />
                </div>
                <div>
                  <label className={`text-[10px] font-semibold block mb-1 ${st}`}>Min Qty</label>
                  <input
                    type="number" min="0" step="0.01"
                    value={cf.min_qty}
                    onChange={e => setCf(p => ({ ...p, min_qty: e.target.value }))}
                    className={`${inp} w-full`}
                  />
                </div>
                <div>
                  <label className={`text-[10px] font-semibold block mb-1 ${st}`}>Lead Time (days)</label>
                  <input
                    type="number" min="0" step="1"
                    value={cf.delay}
                    onChange={e => setCf(p => ({ ...p, delay: e.target.value }))}
                    className={`${inp} w-full`}
                  />
                </div>
                <div>
                  <label className={`text-[10px] font-semibold block mb-1 ${st}`}>Exchange Rate (PO)</label>
                  <input
                    type="number" min="0" step="0.0001"
                    value={cf.exchange_rate_used}
                    onChange={e => setCf(p => ({ ...p, exchange_rate_used: e.target.value }))}
                    placeholder="e.g. 11.80 (optional)"
                    className={`${inp} w-full`}
                  />
                </div>
              </div>

              <div className={`text-xs px-3 py-2 rounded-xl border ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-[#5a6a8a]' : 'bg-gray-50 border-gray-200 text-gray-500'}`}>
                Price (INR) is auto-computed by Odoo as price x exchange_rate_used (stored field). You do not need to enter it manually.
              </div>
            </div>

            <div className={mf}>
              <button onClick={() => setShowCreate(false)} className="btn-secondary text-xs px-4 py-2">Cancel</button>
              <button
                onClick={handleCreate}
                disabled={submitting || !cf.vendorId || !cf.productTmplId || !cf.price}
                className="btn-primary text-xs px-4 py-2"
              >
                {submitting ? <RefreshCw size={13} className="animate-spin" /> : <Plus size={13} />}
                {submitting ? 'Saving...' : 'Add Price Entry'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================ Edit Modal */}
      {editItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
          onClick={() => setEditItem(null)}
        >
          <div
            className={`${modalBg} max-w-md w-full`}
            onClick={e => e.stopPropagation()}
          >
            <div className={mh}>
              <div>
                <h2 className={`text-base font-black ${pt}`}>Edit Price Entry</h2>
                <p className={`text-xs mt-0.5 ${st}`}>
                  {Array.isArray(editItem.partner_id) ? editItem.partner_id[1] : '--'}
                  {' -- '}
                  {Array.isArray(editItem.product_id)
                    ? editItem.product_id[1]
                    : (Array.isArray(editItem.product_tmpl_id) ? editItem.product_tmpl_id[1] : (editItem.product_name || '--'))}
                </p>
              </div>
              <button
                onClick={() => setEditItem(null)}
                className={`p-2 rounded-lg ${isDark ? 'hover:bg-white/5 text-[#5a6a8a]' : 'hover:bg-gray-100 text-gray-400'}`}
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={`text-[10px] font-semibold block mb-1 ${st}`}>Price</label>
                  <input
                    type="number" min="0" step="0.0001"
                    value={ef.price}
                    onChange={e => setEf(p => ({ ...p, price: parseFloat(e.target.value) || 0 }))}
                    className={`${inp} w-full`}
                  />
                </div>
                <div>
                  <label className={`text-[10px] font-semibold block mb-1 ${st}`}>Min Qty</label>
                  <input
                    type="number" min="0" step="0.01"
                    value={ef.min_qty}
                    onChange={e => setEf(p => ({ ...p, min_qty: parseFloat(e.target.value) || 0 }))}
                    className={`${inp} w-full`}
                  />
                </div>
                <div>
                  <label className={`text-[10px] font-semibold block mb-1 ${st}`}>Lead Time (days)</label>
                  <input
                    type="number" min="0" step="1"
                    value={ef.delay}
                    onChange={e => setEf(p => ({ ...p, delay: parseInt(e.target.value) || 0 }))}
                    className={`${inp} w-full`}
                  />
                </div>
                <div>
                  <label className={`text-[10px] font-semibold block mb-1 ${st}`}>Exchange Rate (PO)</label>
                  <input
                    type="number" min="0" step="0.0001"
                    value={ef.exchange_rate_used}
                    onChange={e => setEf(p => ({ ...p, exchange_rate_used: parseFloat(e.target.value) || 0 }))}
                    className={`${inp} w-full`}
                  />
                </div>
              </div>

              <div className={`p-3 rounded-xl border ${isDark ? 'bg-[#12172a] border-[#2a3250]' : 'bg-gray-50 border-gray-100'}`}>
                <p className={`text-[10px] font-semibold uppercase tracking-wider mb-1 ${st}`}>Computed Price (INR)</p>
                <p className={`text-sm font-black text-amber-400`}>
                  Rs.{fmtNum(ef.price * (ef.exchange_rate_used || 1))}
                </p>
                <p className={`text-[10px] mt-0.5 ${st}`}>
                  = price x exchange rate (Odoo recomputes on save)
                </p>
              </div>
            </div>

            <div className={mf}>
              <button onClick={() => setEditItem(null)} className="btn-secondary text-xs px-4 py-2">Cancel</button>
              <button onClick={handleUpdate} disabled={submitting} className="btn-primary text-xs px-4 py-2">
                {submitting ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />}
                {submitting ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
