import { useState } from 'react';
import { useTheme } from '../../../context/ThemeContext';
import { useAuth } from '../../../context/AuthContext';
import { useOdooModel } from '../../../hooks/useOdooModel';
import { searchRead, createRecord, writeRecord, odooCall } from '../../../services/odoo';
import BulkDeleteBar from '../../ui/BulkDeleteBar';
import { fuzzyScore } from '../../../utils/fuzzySearch';
import {
  Plus, RefreshCw, Search, Package, AlertTriangle, CheckCircle2,
  TrendingDown, Eye, Edit2, X, Save, Trash2,
} from 'lucide-react';

interface ProductTemplate {
  id: number;
  name: string;
  default_code: string;
  categ_id: [number, string] | false;
  list_price: number;
  standard_price: number;
  qty_available: number;
  virtual_available: number;
  type: string;
  is_storable: boolean;
  barcode: string | false;
  sale_ok: boolean;
  purchase_ok: boolean;
  active: boolean;
  description: string;
  description_sale: string;
}

interface Category { id: number; name: string; }
interface Tax { id: number; name: string; }
interface PublicCateg { id: number; name: string; }
interface BarcodeLine { id?: number; name: string; }
interface QtyPrice { id?: number; qty_from: number; qty_to: number; price: number; }

interface ProductForm {
  name: string;
  default_code: string;
  barcode: string;
  categ_id: number | '';
  list_price: number;
  standard_price: number;
  type: string;
  is_storable: boolean;
  invoice_policy: string;
  sale_ok: boolean;
  purchase_ok: boolean;
  l10n_in_hsn_code: string;
  taxes_id: number[];
  supplier_taxes_id: number[];
  description: string;
  description_sale: string;
  is_published: boolean;
  public_categ_ids: number[];
  barcodes: BarcodeLine[];
  qty_prices: QtyPrice[];
}

const BLANK_FORM: ProductForm = {
  name: '', default_code: '', barcode: '', categ_id: '', list_price: 0, standard_price: 0,
  type: 'consu', is_storable: true, invoice_policy: 'order', sale_ok: true, purchase_ok: true,
  l10n_in_hsn_code: '', taxes_id: [], supplier_taxes_id: [], description: '', description_sale: '',
  is_published: false, public_categ_ids: [], barcodes: [], qty_prices: [],
};

function StockBadge({ qty }: { qty: number }) {
  if (qty === 0) return <span className="badge badge-red">Out of Stock</span>;
  if (qty < 10) return <span className="badge badge-gold">Low Stock</span>;
  return <span className="badge badge-green">In Stock</span>;
}

// Odoo 18: product 'type' is consu / service / combo. "Goods" = consu (storable via is_storable).
const PRODUCT_TYPES = [
  { value: 'consu', label: 'Goods' },
  { value: 'service', label: 'Service' },
  { value: 'combo', label: 'Combo' },
];

const INVOICE_POLICIES = [
  { value: 'order', label: 'Ordered quantities' },
  { value: 'delivery', label: 'Delivered quantities' },
];

type TabKey = 'general' | 'barcodes' | 'ecommerce' | 'qtyprices';

export default function Products() {
  const { isDark } = useTheme();
  const { user } = useAuth();
  const isAdmin = !!user?.is_admin;
  const [selIds, setSelIds] = useState<Set<number>>(new Set());
  const { data: products, loading, refetch } = useOdooModel<ProductTemplate>('product.template', {
    fields: ['id', 'name', 'default_code', 'barcode', 'categ_id', 'list_price', 'standard_price', 'qty_available', 'virtual_available', 'type', 'is_storable', 'sale_ok', 'purchase_ok', 'active', 'description', 'description_sale'],
    domain: [['active', '=', true]],
    limit: 0,
    cacheKey: 'portal_products_v1',
  });

  const [search, setSearch] = useState('');
  const [view, setView] = useState<'table' | 'grid'>('table');
  const [typeFilter, setTypeFilter] = useState('all');
  const [viewProduct, setViewProduct] = useState<ProductTemplate | null>(null);
  const [editProduct, setEditProduct] = useState<ProductTemplate | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);
  const [stockModal, setStockModal] = useState<{ productId: number; variantId: number; name: string; currentQty: number; quantId: number | null } | null>(null);
  const [newStockQty, setNewStockQty] = useState('');
  const [tab, setTab] = useState<TabKey>('general');

  // Reference data
  const [categories, setCategories] = useState<Category[]>([]);
  const [saleTaxes, setSaleTaxes] = useState<Tax[]>([]);
  const [purchaseTaxes, setPurchaseTaxes] = useState<Tax[]>([]);
  const [publicCategs, setPublicCategs] = useState<PublicCateg[]>([]);
  const [refsLoaded, setRefsLoaded] = useState(false);

  const [form, setForm] = useState<ProductForm>({ ...BLANK_FORM });
  const [editForm, setEditForm] = useState<ProductForm>({ ...BLANK_FORM });

  const showMsg = (ok: boolean, msg: string) => { setToast({ ok, msg }); setTimeout(() => setToast(null), 5000); };

  const openStockEdit = async (product: ProductTemplate) => {
    try {
      const variants = await searchRead<{ id: number }>('product.product', {
        domain: [['product_tmpl_id', '=', product.id], ['active', '=', true]],
        fields: ['id'], limit: 1,
      });
      if (!variants.length) { showMsg(false, 'No active product variant found.'); return; }
      const variantId = variants[0].id;
      const quants = await searchRead<{ id: number; quantity: number }>('stock.quant', {
        domain: [['product_id', '=', variantId], ['location_id.usage', '=', 'internal']],
        fields: ['id', 'quantity'], limit: 1,
      });
      setStockModal({ productId: product.id, variantId, name: product.name, currentQty: quants[0]?.quantity ?? 0, quantId: quants[0]?.id ?? null });
      setNewStockQty(String(quants[0]?.quantity ?? 0));
    } catch (e: any) { showMsg(false, 'Failed to load stock: ' + e.message); }
  };

  const saveStock = async () => {
    if (!stockModal) return;
    const qty = parseFloat(newStockQty);
    if (isNaN(qty) || qty < 0) { showMsg(false, 'Invalid quantity.'); return; }
    setSubmitting(true);
    try {
      let quantId = stockModal.quantId;
      if (quantId) {
        await writeRecord('stock.quant', quantId, { inventory_quantity: qty });
      } else {
        // Prefer the MAIN warehouse stock location; fall back to any internal location
        const mainWh = await searchRead<{ lot_stock_id: [number, string] | false }>('stock.warehouse', {
          domain: [['code', '=', 'MAIN']], fields: ['lot_stock_id'], limit: 1,
        });
        const mainLocId = mainWh?.[0]?.lot_stock_id ? (mainWh[0].lot_stock_id as [number, string])[0] : null;
        const locs = mainLocId ? [{ id: mainLocId }] : await searchRead<{ id: number }>('stock.location', {
          domain: [['usage', '=', 'internal'], ['active', '=', true], ['complete_name', 'ilike', 'MAIN']], fields: ['id'], limit: 1,
        });
        if (!locs.length) throw new Error('No internal location found.');
        quantId = await createRecord('stock.quant', { product_id: stockModal.variantId, location_id: locs[0].id, inventory_quantity: qty });
      }
      await odooCall('stock.quant', 'action_apply_inventory', [[quantId]], {});
      showMsg(true, `Stock updated to ${qty} units for ${stockModal.name}`);
      setStockModal(null);
      refetch();
    } catch (e: any) { showMsg(false, 'Stock update failed: ' + e.message); }
    finally { setSubmitting(false); }
  };

  const loadRefs = async () => {
    if (refsLoaded) return;
    try {
      const [cats, stax, ptax, pcat] = await Promise.allSettled([
        searchRead<Category>('product.category', { fields: ['id', 'name'], domain: [], limit: 0 }),
        searchRead<Tax>('account.tax', { fields: ['id', 'name'], domain: [['type_tax_use', '=', 'sale'], ['active', '=', true]], limit: 0 }),
        searchRead<Tax>('account.tax', { fields: ['id', 'name'], domain: [['type_tax_use', '=', 'purchase'], ['active', '=', true]], limit: 0 }),
        searchRead<PublicCateg>('product.public.category', { fields: ['id', 'name'], domain: [], limit: 0 }),
      ]);
      if (cats.status === 'fulfilled') setCategories(cats.value || []);
      if (stax.status === 'fulfilled') setSaleTaxes(stax.value || []);
      if (ptax.status === 'fulfilled') setPurchaseTaxes(ptax.value || []);
      if (pcat.status === 'fulfilled') setPublicCategs(pcat.value || []);
      setRefsLoaded(true);
    } catch { /* ignore */ }
  };

  const openCreate = async () => {
    await loadRefs();
    setForm({ ...BLANK_FORM });
    setTab('general');
    setShowCreate(true);
  };

  const openEdit = async (p: ProductTemplate) => {
    await loadRefs();
    setEditProduct(p);
    setTab('general');
    // Seed from the row, then enrich with fields not in the list query + child lines.
    setEditForm({
      ...BLANK_FORM,
      name: p.name,
      default_code: p.default_code || '',
      barcode: typeof p.barcode === 'string' ? p.barcode : '',
      categ_id: Array.isArray(p.categ_id) ? p.categ_id[0] : '',
      list_price: p.list_price || 0,
      standard_price: p.standard_price || 0,
      type: p.type || 'consu',
      is_storable: p.is_storable ?? false,
      sale_ok: p.sale_ok,
      purchase_ok: p.purchase_ok,
      description: p.description || '',
      description_sale: p.description_sale || '',
    });
    try {
      const [full] = await searchRead<any>('product.template', {
        domain: [['id', '=', p.id]],
        fields: ['invoice_policy', 'taxes_id', 'supplier_taxes_id', 'l10n_in_hsn_code', 'is_published', 'public_categ_ids'],
        limit: 1,
      });
      const [barcodes, qtyPrices] = await Promise.all([
        searchRead<any>('sr.multi.barcode', { domain: [['product_tmpl_id', '=', p.id]], fields: ['id', 'name'], limit: 0 }),
        searchRead<any>('product.quantity.price', { domain: [['product_tmpl_id', '=', p.id]], fields: ['id', 'qty_from', 'qty_to', 'price'], limit: 0 }),
      ]);
      setEditForm(prev => ({
        ...prev,
        invoice_policy: full?.invoice_policy || 'order',
        taxes_id: Array.isArray(full?.taxes_id) ? full.taxes_id : [],
        supplier_taxes_id: Array.isArray(full?.supplier_taxes_id) ? full.supplier_taxes_id : [],
        l10n_in_hsn_code: full?.l10n_in_hsn_code || '',
        is_published: !!full?.is_published,
        public_categ_ids: Array.isArray(full?.public_categ_ids) ? full.public_categ_ids : [],
        barcodes: Array.isArray(barcodes) ? barcodes.map(b => ({ id: b.id, name: b.name })) : [],
        qty_prices: Array.isArray(qtyPrices) ? qtyPrices.map(q => ({ id: q.id, qty_from: q.qty_from, qty_to: q.qty_to, price: q.price })) : [],
      }));
    } catch { /* keep seed */ }
  };

  // Translate the form into Odoo write/create values.
  const buildVals = (f: ProductForm, isCreate: boolean): Record<string, any> => {
    const vals: Record<string, any> = {
      name: f.name,
      type: f.type,
      invoice_policy: f.invoice_policy,
      list_price: f.list_price,
      standard_price: f.standard_price,
      sale_ok: f.sale_ok,
      purchase_ok: f.purchase_ok,
      is_published: f.is_published,
      default_code: f.default_code || false,
      barcode: f.barcode || false,
      l10n_in_hsn_code: f.l10n_in_hsn_code || false,
      description: f.description || false,
      description_sale: f.description_sale || false,
      taxes_id: [[6, 0, f.taxes_id]],
      supplier_taxes_id: [[6, 0, f.supplier_taxes_id]],
      public_categ_ids: [[6, 0, f.public_categ_ids]],
    };
    // is_storable only meaningful for goods.
    vals.is_storable = f.type === 'consu' ? f.is_storable : false;
    if (f.categ_id) vals.categ_id = f.categ_id;

    // One2many lines: on edit, clear then re-add (simple full-replace editor).
    const barcodeCmds: any[] = isCreate ? [] : [[5, 0, 0]];
    f.barcodes.filter(b => b.name.trim()).forEach(b => barcodeCmds.push([0, 0, { name: b.name.trim() }]));
    vals.product_barcode_ids = barcodeCmds;

    const qtyCmds: any[] = isCreate ? [] : [[5, 0, 0]];
    f.qty_prices.filter(q => q.price > 0).forEach(q => qtyCmds.push([0, 0, { qty_from: q.qty_from || 0, qty_to: q.qty_to || 0, price: q.price }]));
    vals.quantity_price_ids = qtyCmds;

    return vals;
  };

  const handleCreate = async () => {
    if (!form.name.trim()) { showMsg(false, 'Product name is required.'); return; }
    setSubmitting(true);
    try {
      await createRecord('product.template', buildVals(form, true));
      showMsg(true, 'Product created.');
      setShowCreate(false);
      refetch();
    } catch (e: any) { showMsg(false, 'Create failed: ' + e.message); }
    finally { setSubmitting(false); }
  };

  const handleEdit = async () => {
    if (!editProduct) return;
    if (!editForm.name.trim()) { showMsg(false, 'Product name is required.'); return; }
    setSubmitting(true);
    try {
      await writeRecord('product.template', [editProduct.id], buildVals(editForm, false));
      showMsg(true, 'Product updated.');
      setEditProduct(null);
      refetch();
    } catch (e: any) { showMsg(false, 'Update failed: ' + e.message); }
    finally { setSubmitting(false); }
  };

  const filtered = (() => {
    const q = search.trim();
    if (!q) return products.filter(p => typeFilter === 'all' || p.type === typeFilter);
    const scored = products
      .filter(p => typeFilter === 'all' || p.type === typeFilter)
      .map(p => {
        const nameScore = fuzzyScore(p.name || '', q);
        const codeScore = typeof p.default_code === 'string' ? fuzzyScore(p.default_code, q) : 0;
        // Name matches rank 1000+ above code-only matches so they always appear first
        const score = nameScore > 0 ? nameScore + 1000 : codeScore;
        return { p, score };
      })
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score);
    return scored.map(x => x.p);
  })();

  const outOfStock = filtered.filter(p => (p.qty_available || 0) === 0).length;
  const lowStock = filtered.filter(p => (p.qty_available || 0) > 0 && (p.qty_available || 0) < 10).length;

  const st = isDark ? 'text-[#5a6a8a]' : 'text-gray-500';
  const pt = isDark ? 'text-white' : 'text-gray-900';
  const inp = `input text-xs py-2 ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`;
  const fieldInp = `input text-xs py-2 w-full ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`;
  const modalBg = `w-full rounded-2xl shadow-2xl border ${isDark ? 'bg-[#161b2e] border-[#2a3250]' : 'bg-white border-gray-200'}`;
  const mh = `flex items-center justify-between p-5 border-b ${isDark ? 'border-[#2a3250]' : 'border-gray-200'}`;
  const mf = `flex justify-end gap-3 p-5 border-t ${isDark ? 'border-[#2a3250]' : 'border-gray-200'}`;
  const lbl = `text-[10px] font-semibold block mb-1 ${st}`;

  // Multi-select chip control (taxes / public categories).
  const MultiSelect = (opts: Tax[], selected: number[], onChange: (ids: number[]) => void, placeholder: string) => (
    <div>
      <div className="flex flex-wrap gap-1 mb-1">
        {selected.map(id => {
          const o = opts.find(x => x.id === id);
          if (!o) return null;
          return (
            <span key={id} className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#7367f0]/15 text-[#7367f0] border border-[#7367f0]/30">
              {o.name}
              <button type="button" onClick={() => onChange(selected.filter(s => s !== id))}><X size={9} /></button>
            </span>
          );
        })}
      </div>
      <select value="" onChange={e => { const v = Number(e.target.value); if (v && !selected.includes(v)) onChange([...selected, v]); }} className={fieldInp}>
        <option value="">{placeholder}</option>
        {opts.filter(o => !selected.includes(o.id)).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </div>
  );

  // The tabbed product form (plain render function, NOT a nested component, to keep input focus).
  const renderForm = (f: ProductForm, setF: (fn: (prev: ProductForm) => ProductForm) => void) => {
    const tabs: { key: TabKey; label: string }[] = [
      { key: 'general', label: 'General' },
      { key: 'barcodes', label: 'Multiple Barcode' },
      { key: 'ecommerce', label: 'eCommerce' },
      { key: 'qtyprices', label: 'Quantity Prices' },
    ];
    return (
      <div>
        {/* Tab bar */}
        <div className={`flex gap-1 px-5 pt-3 border-b overflow-x-auto ${isDark ? 'border-[#2a3250]' : 'border-gray-200'}`}>
          {tabs.map(t => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)}
              className={`px-3 py-2 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors ${tab === t.key ? 'border-[#7367f0] text-[#7367f0]' : `border-transparent ${st}`}`}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="p-5 space-y-4">
          {tab === 'general' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className={lbl}>Product Name *</label>
                  <input value={f.name} onChange={e => setF(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Cheese Burger" className={fieldInp} />
                </div>
                <div className={`col-span-2 flex flex-wrap gap-6 p-3 rounded-xl ${isDark ? 'bg-[#1e2440]' : 'bg-gray-50'}`}>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={f.sale_ok} onChange={e => setF(p => ({ ...p, sale_ok: e.target.checked }))} className="accent-[#7367f0]" />
                    <span className={`text-xs font-semibold ${pt}`}>Sales</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={f.purchase_ok} onChange={e => setF(p => ({ ...p, purchase_ok: e.target.checked }))} className="accent-[#7367f0]" />
                    <span className={`text-xs font-semibold ${pt}`}>Purchase</span>
                  </label>
                </div>
                <div>
                  <label className={lbl}>Product Type</label>
                  <select value={f.type} onChange={e => setF(p => ({ ...p, type: e.target.value }))} className={fieldInp}>
                    {PRODUCT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className={lbl}>Invoicing Policy</label>
                  <select value={f.invoice_policy} onChange={e => setF(p => ({ ...p, invoice_policy: e.target.value }))} className={fieldInp}>
                    {INVOICE_POLICIES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                {f.type === 'consu' && (
                  <div className="col-span-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={f.is_storable} onChange={e => setF(p => ({ ...p, is_storable: e.target.checked }))} className="accent-[#7367f0]" />
                      <span className={`text-xs font-semibold ${pt}`}>Track Inventory (storable)</span>
                    </label>
                  </div>
                )}
                <div>
                  <label className={lbl}>Sales Price (Rs.)</label>
                  <input type="number" min="0" step="0.01" value={f.list_price} onChange={e => setF(p => ({ ...p, list_price: Number(e.target.value) }))} className={fieldInp} />
                </div>
                <div>
                  <label className={lbl}>Cost (Rs.)</label>
                  <input type="number" min="0" step="0.01" value={f.standard_price} onChange={e => setF(p => ({ ...p, standard_price: Number(e.target.value) }))} className={fieldInp} />
                </div>
              </div>

              <div>
                <label className={lbl}>Sales Taxes</label>
                {MultiSelect(saleTaxes, f.taxes_id, ids => setF(p => ({ ...p, taxes_id: ids })), '-- Add sales tax --')}
              </div>
              <div>
                <label className={lbl}>Purchase Taxes</label>
                {MultiSelect(purchaseTaxes, f.supplier_taxes_id, ids => setF(p => ({ ...p, supplier_taxes_id: ids })), '-- Add purchase tax --')}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className={lbl}>Category</label>
                  <select value={f.categ_id} onChange={e => setF(p => ({ ...p, categ_id: e.target.value ? Number(e.target.value) : '' }))} className={fieldInp}>
                    <option value="">-- None --</option>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className={lbl}>Reference (SKU)</label>
                  <input value={f.default_code} onChange={e => setF(p => ({ ...p, default_code: e.target.value }))} placeholder="e.g. YARN-40S" className={fieldInp} />
                </div>
                <div>
                  <label className={lbl}>Barcode</label>
                  <input value={f.barcode} onChange={e => setF(p => ({ ...p, barcode: e.target.value }))} placeholder="e.g. 8901234567890" className={fieldInp} />
                </div>
                <div>
                  <label className={lbl}>HSN/SAC Code</label>
                  <input value={f.l10n_in_hsn_code} onChange={e => setF(p => ({ ...p, l10n_in_hsn_code: e.target.value }))} placeholder="e.g. 8528" className={fieldInp} />
                </div>
              </div>

              <div>
                <label className={lbl}>Internal Notes</label>
                <textarea value={f.description} onChange={e => setF(p => ({ ...p, description: e.target.value }))} rows={2} className={`${fieldInp} resize-none`} />
              </div>
              <div>
                <label className={lbl}>Sales Description (added to orders/invoices)</label>
                <textarea value={f.description_sale} onChange={e => setF(p => ({ ...p, description_sale: e.target.value }))} rows={2} className={`${fieldInp} resize-none`} />
              </div>
            </>
          )}

          {tab === 'barcodes' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className={lbl}>Additional Barcodes (sr.multi.barcode)</label>
                <button type="button" onClick={() => setF(p => ({ ...p, barcodes: [...p.barcodes, { name: '' }] }))} className="text-xs text-[#7367f0] font-semibold flex items-center gap-1 hover:underline">
                  <Plus size={11} /> Add a line
                </button>
              </div>
              {f.barcodes.length === 0 && <p className={`text-xs ${st}`}>No additional barcodes. Click "Add a line".</p>}
              {f.barcodes.map((b, idx) => (
                <div key={idx} className="flex gap-2 items-center">
                  <input value={b.name} onChange={e => setF(p => ({ ...p, barcodes: p.barcodes.map((x, i) => i === idx ? { ...x, name: e.target.value } : x) }))}
                    placeholder="Barcode value" className={fieldInp} />
                  <button type="button" onClick={() => setF(p => ({ ...p, barcodes: p.barcodes.filter((_, i) => i !== idx) }))} className="text-red-400 hover:text-red-300 flex-shrink-0"><Trash2 size={13} /></button>
                </div>
              ))}
            </div>
          )}

          {tab === 'ecommerce' && (
            <div className="space-y-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={f.is_published} onChange={e => setF(p => ({ ...p, is_published: e.target.checked }))} className="accent-[#7367f0]" />
                <span className={`text-xs font-semibold ${pt}`}>Published on Website</span>
              </label>
              <div>
                <label className={lbl}>eCommerce Categories</label>
                {MultiSelect(publicCategs, f.public_categ_ids, ids => setF(p => ({ ...p, public_categ_ids: ids })), '-- Add category --')}
              </div>
              <div>
                <label className={lbl}>eCommerce Description</label>
                <textarea value={f.description_sale} onChange={e => setF(p => ({ ...p, description_sale: e.target.value }))} rows={3} className={`${fieldInp} resize-none`}
                  placeholder="Shown on the product page." />
              </div>
            </div>
          )}

          {tab === 'qtyprices' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className={lbl}>Quantity Price Brackets (product.quantity.price)</label>
                <button type="button" onClick={() => setF(p => ({ ...p, qty_prices: [...p.qty_prices, { qty_from: 0, qty_to: 0, price: 0 }] }))} className="text-xs text-[#7367f0] font-semibold flex items-center gap-1 hover:underline">
                  <Plus size={11} /> Add a line
                </button>
              </div>
              {f.qty_prices.length === 0 && <p className={`text-xs ${st}`}>No quantity-price brackets. Click "Add a line".</p>}
              {f.qty_prices.length > 0 && (
                <div className={`grid grid-cols-[1fr_1fr_1fr_auto] gap-2 text-[10px] font-bold uppercase tracking-wider ${st}`}>
                  <span>From Qty</span><span>To Qty</span><span>Sale Price</span><span></span>
                </div>
              )}
              {f.qty_prices.map((q, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center">
                  <input type="number" min="0" value={q.qty_from} onChange={e => setF(p => ({ ...p, qty_prices: p.qty_prices.map((x, i) => i === idx ? { ...x, qty_from: Number(e.target.value) } : x) }))} className={fieldInp} />
                  <input type="number" min="0" value={q.qty_to} onChange={e => setF(p => ({ ...p, qty_prices: p.qty_prices.map((x, i) => i === idx ? { ...x, qty_to: Number(e.target.value) } : x) }))} className={fieldInp} />
                  <input type="number" min="0" step="0.01" value={q.price} onChange={e => setF(p => ({ ...p, qty_prices: p.qty_prices.map((x, i) => i === idx ? { ...x, price: Number(e.target.value) } : x) }))} className={fieldInp} />
                  <button type="button" onClick={() => setF(p => ({ ...p, qty_prices: p.qty_prices.filter((_, i) => i !== idx) }))} className="text-red-400 hover:text-red-300"><Trash2 size={13} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5 animate-fade-in">
      {toast && (
        <div className={`fixed top-5 right-5 z-50 px-4 py-3 rounded-xl shadow-xl text-sm font-medium flex items-center gap-2
          ${toast.ok ? 'bg-green-500/15 border border-green-500/30 text-green-400' : 'bg-red-500/15 border border-red-500/30 text-red-400'}`}>
          {toast.ok ? <CheckCircle2 size={14} /> : <X size={14} />} {toast.msg}
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className={`text-xl font-black ${pt}`}>Products</h1>
          <p className={`text-xs mt-0.5 ${st}`}>
            {filtered.length} products -- {outOfStock} out of stock -- {lowStock} low stock
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={refetch} disabled={loading} className="btn-secondary text-xs px-3 py-2">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Sync
          </button>
          <button onClick={openCreate} className="btn-primary text-xs px-3 py-2">
            <Plus size={13} /> New Product
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total', value: filtered.length, icon: Package, color: 'text-[#7367f0]', bg: 'bg-[#7367f0]/10' },
          { label: 'In Stock', value: filtered.filter(p => p.qty_available > 0).length, icon: CheckCircle2, color: 'text-green-400', bg: 'bg-green-500/10' },
          { label: 'Low Stock', value: lowStock, icon: AlertTriangle, color: 'text-amber-400', bg: 'bg-amber-500/10' },
          { label: 'Out of Stock', value: outOfStock, icon: TrendingDown, color: 'text-red-400', bg: 'bg-red-500/10' },
        ].map(s => (
          <div key={s.label} className="card p-4 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl ${s.bg} flex items-center justify-center`}><s.icon size={18} className={s.color} /></div>
            <div>
              <p className={`text-xl font-black ${pt}`}>{s.value}</p>
              <p className={`text-[10px] font-medium ${st}`}>{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="card p-3 flex gap-3">
        <div className="relative flex-[3] min-w-0">
          <Search size={14} className={`absolute left-3 top-1/2 -translate-y-1/2 ${st}`} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or SKU..."
            autoComplete="off" autoCorrect="off" spellCheck="false"
            className={`input w-full pl-9 text-xs py-2 ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`} />
        </div>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className={`input w-auto text-xs py-2 ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`}>
          <option value="all">All Types</option>
          {PRODUCT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <div className={`flex rounded-xl border p-1 ${isDark ? 'border-[#2a3250]' : 'border-gray-200'}`}>
          {(['table', 'grid'] as const).map(v => (
            <button key={v} onClick={() => setView(v)} className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all capitalize ${view === v ? 'bg-[#7367f0] text-white' : st}`}>{v}</button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="card h-48 flex items-center justify-center gap-3">
          <RefreshCw size={18} className="animate-spin text-[#7367f0]" />
        </div>
      ) : view === 'table' ? (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="data-table w-full">
              <thead>
                <tr>
                  {isAdmin && <th className="w-8"><input type="checkbox" className="rounded" checked={filtered.length > 0 && filtered.every(p => selIds.has(p.id))} onChange={e => setSelIds(e.target.checked ? new Set(filtered.map(p => p.id)) : new Set())} /></th>}
                  <th>Product Name</th>
                  <th className="text-right">Cost</th>
                  <th className="text-right">On Hand</th><th className="text-right">Forecasted</th>
                  <th className="text-center">Status</th><th className="text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(product => (
                  <tr key={product.id} className={selIds.has(product.id) ? (isDark ? 'bg-[#7367f0]/5' : 'bg-violet-50') : ''}>
                    {isAdmin && <td><input type="checkbox" className="rounded" checked={selIds.has(product.id)} onChange={() => setSelIds(prev => { const n = new Set(prev); n.has(product.id) ? n.delete(product.id) : n.add(product.id); return n; })} /></td>}
                    <td className={`font-semibold text-xs max-w-[240px] ${pt}`}>
                      <div className="truncate">{product.name}</div>
                      {product.default_code && <div className="font-mono text-[10px] text-[#7367f0]">{product.default_code}</div>}
                    </td>
                    <td className={`text-right text-xs ${st}`}>₹{(product.standard_price || 0).toLocaleString('en-IN')}</td>
                    <td className={`text-right text-xs ${product.qty_available < 10 ? 'text-amber-400 font-bold' : isDark ? 'text-gray-300' : 'text-gray-700'}`}>{product.qty_available || 0}</td>
                    <td className={`text-right text-xs ${st}`}>{product.virtual_available || 0}</td>
                    <td className="text-center"><StockBadge qty={product.qty_available || 0} /></td>
                    <td className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => setViewProduct(product)} className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-white/5 text-[#5a6a8a]' : 'hover:bg-gray-100 text-gray-400'}`} title="View"><Eye size={13} /></button>
                        <button onClick={() => openEdit(product)} className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-white/5 text-[#5a6a8a]' : 'hover:bg-gray-100 text-gray-400'}`} title="Edit"><Edit2 size={13} /></button>
                        {product.is_storable && <button onClick={() => openStockEdit(product)} className={`p-1.5 rounded-lg text-amber-400 ${isDark ? 'hover:bg-amber-500/10' : 'hover:bg-amber-50'}`} title="Edit Stock"><Package size={13} /></button>}
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={isAdmin ? 7 : 6} className="text-center py-10">
                    <Package size={32} className={`mx-auto mb-2 ${isDark ? 'text-[#2a3250]' : 'text-gray-200'}`} />
                    <p className={`text-xs ${st}`}>No products found</p>
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {filtered.map(product => (
            <div key={product.id} className="card p-4 space-y-2.5 hover:shadow-lg transition-all cursor-pointer group" onClick={() => setViewProduct(product)}>
              <div className={`w-12 h-12 rounded-xl ${isDark ? 'bg-[#2a3250]' : 'bg-gray-100'} flex items-center justify-center group-hover:bg-[#7367f0]/10`}>
                <Package size={22} className={`${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'} group-hover:text-[#7367f0]`} />
              </div>
              <div>
                <p className={`text-xs font-semibold leading-snug ${pt}`}>{product.name?.length > 40 ? product.name.slice(0, 40) + '...' : product.name}</p>
                <p className={`text-[10px] mt-0.5 font-mono ${st}`}>{product.default_code || '--'}</p>
              </div>
              <div className="flex items-center justify-between">
                <p className={`text-sm font-black ${pt}`}>Rs.{(product.list_price || 0).toLocaleString('en-IN')}</p>
                <StockBadge qty={product.qty_available || 0} />
              </div>
              <p className={`text-[10px] ${st}`}>On Hand: {product.qty_available || 0} units</p>
              <button onClick={e => { e.stopPropagation(); openEdit(product); }} className={`w-full text-xs py-1 rounded-lg font-semibold ${isDark ? 'bg-[#2a3250] hover:bg-[#7367f0]/20 text-[#7367f0]' : 'bg-gray-100 hover:bg-violet-50 text-violet-600'}`}>
                <Edit2 size={11} className="inline mr-1" /> Edit
              </button>
            </div>
          ))}
        </div>
      )}

      {/* View Modal */}
      {viewProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className={`${modalBg} max-w-lg`}>
            <div className={mh}>
              <div>
                <h2 className={`text-base font-black ${pt}`}>{viewProduct.name}</h2>
                <p className={`text-xs mt-0.5 ${st}`}>{viewProduct.default_code || 'No SKU'}</p>
              </div>
              <button onClick={() => setViewProduct(null)} className={`p-2 rounded-lg ${isDark ? 'hover:bg-white/5 text-[#5a6a8a]' : 'hover:bg-gray-100 text-gray-400'}`}><X size={16} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
                {[
                  { label: 'Category', value: Array.isArray(viewProduct.categ_id) ? viewProduct.categ_id[1] : '--' },
                  { label: 'Type', value: PRODUCT_TYPES.find(t => t.value === viewProduct.type)?.label || viewProduct.type },
                  { label: 'Sales Price', value: `Rs.${(viewProduct.list_price || 0).toLocaleString('en-IN')}` },
                  { label: 'Cost', value: `Rs.${(viewProduct.standard_price || 0).toLocaleString('en-IN')}` },
                  { label: 'On Hand', value: `${viewProduct.qty_available || 0} units` },
                  { label: 'Forecasted', value: `${viewProduct.virtual_available || 0} units` },
                  { label: 'Can be Sold', value: viewProduct.sale_ok ? 'Yes' : 'No' },
                  { label: 'Can be Purchased', value: viewProduct.purchase_ok ? 'Yes' : 'No' },
                ].map(f => (
                  <div key={f.label}>
                    <p className={`text-[10px] font-semibold uppercase tracking-wider mb-0.5 ${st}`}>{f.label}</p>
                    <p className={`font-semibold ${pt}`}>{f.value}</p>
                  </div>
                ))}
              </div>
              {viewProduct.description && (
                <div>
                  <p className={`text-[10px] font-semibold uppercase tracking-wider mb-0.5 ${st}`}>Notes</p>
                  <p className={`text-xs ${pt}`}>{viewProduct.description}</p>
                </div>
              )}
            </div>
            <div className={mf}>
              <button onClick={() => setViewProduct(null)} className="btn-secondary text-xs px-4 py-2">Close</button>
              <button onClick={() => { openEdit(viewProduct); setViewProduct(null); }} className="btn-primary text-xs px-4 py-2">
                <Edit2 size={13} /> Edit Product
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className={`${modalBg} max-w-4xl w-full max-h-[92vh] overflow-y-auto`}>
            <div className={`${mh} sticky top-0 z-10 ${isDark ? 'bg-[#161b2e]' : 'bg-white'}`}>
              <h2 className={`text-base font-black ${pt}`}>New Product</h2>
              <button onClick={() => setShowCreate(false)} className={`p-2 rounded-lg ${isDark ? 'hover:bg-white/5 text-[#5a6a8a]' : 'hover:bg-gray-100 text-gray-400'}`}><X size={16} /></button>
            </div>
            {renderForm(form, setForm)}
            <div className={mf}>
              <button onClick={() => setShowCreate(false)} className="btn-secondary text-xs px-4 py-2">Cancel</button>
              <button onClick={handleCreate} disabled={submitting || !form.name.trim()} className="btn-primary text-xs px-4 py-2">
                {submitting ? <RefreshCw size={13} className="animate-spin" /> : <Plus size={13} />}
                {submitting ? 'Creating...' : 'Create Product'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className={`${modalBg} max-w-4xl w-full max-h-[92vh] overflow-y-auto`}>
            <div className={`${mh} sticky top-0 z-10 ${isDark ? 'bg-[#161b2e]' : 'bg-white'}`}>
              <h2 className={`text-base font-black ${pt}`}>Edit Product</h2>
              <button onClick={() => setEditProduct(null)} className={`p-2 rounded-lg ${isDark ? 'hover:bg-white/5 text-[#5a6a8a]' : 'hover:bg-gray-100 text-gray-400'}`}><X size={16} /></button>
            </div>
            {renderForm(editForm, setEditForm)}
            <div className={mf}>
              <button onClick={() => setEditProduct(null)} className="btn-secondary text-xs px-4 py-2">Cancel</button>
              <button onClick={handleEdit} disabled={submitting} className="btn-primary text-xs px-4 py-2">
                {submitting ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />}
                {submitting ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Admin bulk delete */}
      <BulkDeleteBar model="product.template" label="product" ids={Array.from(selIds)}
        onClear={() => setSelIds(new Set())}
        onDeleted={() => refetch()} />

      {/* Stock Edit Modal */}
      {stockModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className={`w-full max-w-sm rounded-2xl shadow-2xl border ${isDark ? 'bg-[#161b2e] border-[#2a3250]' : 'bg-white border-gray-200'}`}>
            <div className={`flex justify-between items-center px-5 py-4 border-b ${isDark ? 'border-[#2a3250]' : 'border-gray-100'}`}>
              <div>
                <h3 className={`font-bold text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>Edit Stock</h3>
                <p className={`text-xs mt-0.5 ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>{stockModal.name}</p>
              </div>
              <button onClick={() => setStockModal(null)} className={`p-1.5 rounded-lg ${isDark ? 'text-[#5a6a8a] hover:bg-white/5' : 'text-gray-400 hover:bg-gray-100'}`}><X size={16} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className={`p-3 rounded-xl border text-xs ${isDark ? 'bg-[#12172a] border-[#2a3250] text-[#5a6a8a]' : 'bg-gray-50 border-gray-200 text-gray-500'}`}>
                Current on-hand quantity: <span className={`font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>{stockModal.currentQty}</span> units
              </div>
              <div>
                <label className={`text-[10px] font-semibold block mb-1 ${isDark ? 'text-[#5a6a8a]' : 'text-gray-500'}`}>New Quantity (units) *</label>
                <input
                  type="number" min="0" step="0.01"
                  value={newStockQty}
                  onChange={e => setNewStockQty(e.target.value)}
                  className={`input text-sm py-2 w-full ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`}
                  autoFocus
                />
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={() => setStockModal(null)} className="btn-secondary flex-1 justify-center py-2">Cancel</button>
                <button onClick={saveStock} disabled={submitting} className="btn-primary flex-1 justify-center py-2">
                  {submitting ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />}
                  {submitting ? 'Saving...' : 'Apply'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
