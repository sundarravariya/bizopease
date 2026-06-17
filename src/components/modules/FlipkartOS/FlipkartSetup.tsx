import { useState, useEffect } from 'react';
import { searchRead, createRecord, odooCall } from '../../../services/odoo';
import { useTheme } from '../../../context/ThemeContext';
import {
  Plus, RefreshCw, CheckCircle2, AlertCircle, Trash2,
  Warehouse, Zap, X, Settings, BookOpen, Hash, Search,
  Save, Pencil
} from 'lucide-react';

type SetupTab = 'settings' | 'listings' | 'fsns' | 'accounts' | 'warehouses';

interface Account { id: number; name: string; is_active: boolean; }
interface WhConfig {
  id: number; name: string; account_id: [number, string] | false;
  flipkart_warehouse_code: string; transit_days: number; is_active: boolean;
}
interface OdooWarehouse { id: number; name: string; }

interface Listing {
  id: number; name: string; fsn: string; sku: string;
  category: string; mrp: number; selling_price: number;
}

interface FsnBarcode {
  id: number; name: string; product_id: [number, string] | false;
}

type SettingField = {
  key: string; label: string; type: 'number' | 'text' | 'bool' | 'password'; group: string;
};

const SETTING_FIELDS: SettingField[] = [
  { key: 'flipkart_stock_deduction_enabled',       label: 'Stock Deduction Enabled',          type: 'bool',   group: 'General' },
  { key: 'flipkart_returns_stock_move_enabled',    label: 'Returns Stock Move Enabled',       type: 'bool',   group: 'General' },
  { key: 'flipkart_consignment_stock_move_enabled',label: 'Consignment Stock Move Enabled',   type: 'bool',   group: 'General' },
  { key: 'flipkart_dead_stock_sales_days',         label: 'Dead Stock - Sales Days',          type: 'number', group: 'Inventory' },
  { key: 'flipkart_fbf_target_cover_days',         label: 'FBF Target Cover Days',            type: 'number', group: 'FBF' },
  { key: 'flipkart_fbf_critical_days',             label: 'FBF Critical Threshold (days)',    type: 'number', group: 'FBF' },
  { key: 'flipkart_fbf_moderate_days',             label: 'FBF Moderate Threshold (days)',    type: 'number', group: 'FBF' },
  { key: 'flipkart_supplier_sales_days',           label: 'Supplier - Sales History Days',    type: 'number', group: 'Supplier' },
  { key: 'flipkart_supplier_lead_time_days',       label: 'Supplier - Lead Time Days',        type: 'number', group: 'Supplier' },
  { key: 'flipkart_supplier_target_cover_days',    label: 'Supplier - Target Cover Days',     type: 'number', group: 'Supplier' },
  { key: 'flipkart_supplier_order_cycle_days',     label: 'Supplier - Order Cycle Days',      type: 'number', group: 'Supplier' },
  { key: 'flipkart_ai_enabled',                   label: 'AI Assistant Enabled',             type: 'bool',   group: 'AI' },
  { key: 'flipkart_ai_provider_name',             label: 'AI Provider Name',                 type: 'text',   group: 'AI' },
  { key: 'flipkart_ai_api_url',                   label: 'AI API URL',                       type: 'text',   group: 'AI' },
  { key: 'flipkart_ai_model',                     label: 'AI Model',                         type: 'text',   group: 'AI' },
  { key: 'flipkart_ai_api_key',                   label: 'AI API Key',                       type: 'password', group: 'AI' },
  { key: 'flipkart_ai_api_format',                label: 'AI API Format',                    type: 'text',   group: 'AI' },
  { key: 'flipkart_ai_timeout',                   label: 'AI Timeout (seconds)',             type: 'number', group: 'AI' },
  { key: 'flipkart_ai_temperature',               label: 'AI Temperature',                   type: 'number', group: 'AI' },
];

export default function FlipkartSetup() {
  const { isDark } = useTheme();
  const [tab, setTab] = useState<SetupTab>('settings');
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);

  // ------ Shared ------------------------------------------------------------------------------------------
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [whConfigs, setWhConfigs] = useState<WhConfig[]>([]);
  const [odooWarehouses, setOdooWarehouses] = useState<OdooWarehouse[]>([]);
  const [loading, setLoading] = useState(false);

  // ------ Settings --------------------------------------------------------------------------------------
  const [params, setParams] = useState<Record<string, string>>({});
  const [savingParams, setSavingParams] = useState(false);

  // ------ Master Listings ------------------------------------------------------------------------
  const [listings, setListings] = useState<Listing[]>([]);
  const [listingSearch, setListingSearch] = useState('');
  const [listingForm, setListingForm] = useState({ name: '', fsn: '', sku: '', category: '', mrp: '', selling_price: '' });
  const [savingListing, setSavingListing] = useState(false);
  const [showListingForm, setShowListingForm] = useState(false);

  // ------ FSNs ------------------------------------------------------------------------------------------------
  const [fsns, setFsns] = useState<FsnBarcode[]>([]);
  const [fsnSearch, setFsnSearch] = useState('');
  const [showFsnForm, setShowFsnForm] = useState(false);
  const [fsnForm, setFsnForm] = useState({ barcode: '', product_id: '' as number | '', product_name: '' });
  const [fsnProducts, setFsnProducts] = useState<{ id: number; name: string }[]>([]);
  const [showFsnProdDrop, setShowFsnProdDrop] = useState(false);
  const [savingFsn, setSavingFsn] = useState(false);

  // ------ Accounts form ------------------------------------------------------------------------------
  const [newAccName, setNewAccName] = useState('');
  const [savingAcc, setSavingAcc] = useState(false);

  // ------ WH Config form --------------------------------------------------------------------------
  const [whForm, setWhForm] = useState({ name: '', account_id: '', flipkart_warehouse_code: '', transit_days: '3', backend_warehouse_id: '' });
  const [savingWh, setSavingWh] = useState(false);
  const [showWhForm, setShowWhForm] = useState(false);

  useEffect(() => { loadBase(); }, []);
  useEffect(() => {
    if (tab === 'settings') loadSettings();
    else if (tab === 'listings') loadListings();
    else if (tab === 'fsns') loadFsns();
  }, [tab]);

  const showMsg = (ok: boolean, msg: string) => {
    setToast({ ok, msg });
    setTimeout(() => setToast(null), 4000);
  };

  const loadBase = async () => {
    setLoading(true);
    try {
      const [accs, whs, odooWh] = await Promise.all([
        searchRead<Account>('flipkart.account', { fields: ['id', 'name', 'is_active'], limit: 0 }),
        searchRead<WhConfig>('flipkart.warehouse.config', {
          fields: ['id', 'name', 'account_id', 'flipkart_warehouse_code', 'transit_days', 'is_active'], limit: 0,
        }),
        searchRead<OdooWarehouse>('stock.warehouse', { fields: ['id', 'name'], limit: 50 }),
      ]);
      setAccounts(Array.isArray(accs) ? accs : []);
      setWhConfigs(Array.isArray(whs) ? whs : []);
      setOdooWarehouses(Array.isArray(odooWh) ? odooWh : []);
    } catch (e: any) { showMsg(false, e?.message || 'Failed to load'); }
    finally { setLoading(false); }
  };

  const loadSettings = async () => {
    try {
      const vals = await odooCall<Record<string, any>>('res.config.settings', 'get_values', [], {});
      const obj: Record<string, string> = {};
      SETTING_FIELDS.forEach(f => {
        const v = vals?.[f.key];
        obj[f.key] = v === undefined ? '' : String(v);
      });
      setParams(obj);
    } catch (e: any) { showMsg(false, 'Failed to load settings: ' + e.message); }
  };

  const saveSettings = async () => {
    setSavingParams(true);
    try {
      const vals: Record<string, any> = {};
      SETTING_FIELDS.forEach(f => {
        const raw = params[f.key];
        if (raw === '' || raw === undefined) return;
        if (f.type === 'number') vals[f.key] = parseFloat(raw) || 0;
        else if (f.type === 'bool') vals[f.key] = raw === 'true' || raw === '1';
        else vals[f.key] = raw;
      });
      const settingsId = await createRecord('res.config.settings', vals);
      await odooCall('res.config.settings', 'execute', [[settingsId]], {});
      showMsg(true, 'Settings saved successfully.');
    } catch (e: any) { showMsg(false, 'Save failed: ' + e.message); }
    finally { setSavingParams(false); }
  };

  const loadListings = async () => {
    setLoading(true);
    try {
      const rows = await searchRead<Listing>('flipkart.listing', {
        fields: ['id', 'name', 'fsn', 'sku', 'category', 'mrp', 'selling_price'],
        limit: 0,
      });
      setListings(Array.isArray(rows) ? rows : []);
    } catch (e: any) { showMsg(false, e.message); }
    finally { setLoading(false); }
  };

  const saveListing = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!listingForm.name || !listingForm.fsn) return;
    setSavingListing(true);
    try {
      await createRecord('flipkart.listing', {
        name: listingForm.name,
        fsn: listingForm.fsn,
        sku: listingForm.sku,
        category: listingForm.category,
        mrp: parseFloat(listingForm.mrp) || 0,
        selling_price: parseFloat(listingForm.selling_price) || 0,
      });
      showMsg(true, `Listing "${listingForm.name}" created.`);
      setListingForm({ name: '', fsn: '', sku: '', category: '', mrp: '', selling_price: '' });
      setShowListingForm(false);
      await loadListings();
    } catch (e: any) { showMsg(false, e.message); }
    finally { setSavingListing(false); }
  };

  const deleteListing = async (id: number, name: string) => {
    if (!confirm(`Delete listing "${name}"?`)) return;
    try {
      await odooCall('flipkart.listing', 'unlink', [[id]], {});
      showMsg(true, 'Listing deleted.');
      await loadListings();
    } catch (e: any) { showMsg(false, e.message); }
  };

  const loadFsns = async () => {
    setLoading(true);
    try {
      const rows = await searchRead<FsnBarcode>('sr.multi.barcode', {
        fields: ['id', 'name', 'product_id'],
        limit: 0,
        order: 'name asc',
      });
      setFsns(Array.isArray(rows) ? rows : []);
    } catch (e: any) {
      // model may not exist on some installs -- silently show empty
      setFsns([]);
    }
    finally { setLoading(false); }
  };

  const searchFsnProducts = async (q: string) => {
    if (!q || q.length < 2) { setFsnProducts([]); return; }
    const r = await searchRead<{ id: number; name: string }>('product.product', {
      fields: ['id', 'name'],
      domain: [['active', '=', true], '|', ['name', 'ilike', q], ['default_code', 'ilike', q]],
      limit: 15,
    });
    setFsnProducts(r || []);
  };

  const saveFsn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fsnForm.barcode.trim() || !fsnForm.product_id) return;
    setSavingFsn(true);
    try {
      await createRecord('sr.multi.barcode', { name: fsnForm.barcode.trim(), product_id: fsnForm.product_id });
      showMsg(true, `FSN "${fsnForm.barcode}" mapped to ${fsnForm.product_name}.`);
      setFsnForm({ barcode: '', product_id: '', product_name: '' });
      setFsnProducts([]);
      setShowFsnForm(false);
      await loadFsns();
    } catch (e: any) { showMsg(false, e.message); }
    finally { setSavingFsn(false); }
  };

  const createAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAccName.trim()) return;
    setSavingAcc(true);
    try {
      await createRecord('flipkart.account', { name: newAccName.trim(), is_active: true });
      showMsg(true, `Account "${newAccName}" created`);
      setNewAccName('');
      await loadBase();
    } catch (err: any) { showMsg(false, err?.message || 'Create failed'); }
    finally { setSavingAcc(false); }
  };

  const deleteAccount = async (id: number, name: string) => {
    if (!confirm(`Delete account "${name}"? This may affect linked data.`)) return;
    try {
      await odooCall('flipkart.account', 'unlink', [[id]], {});
      showMsg(true, `Account "${name}" deleted`);
      await loadBase();
    } catch (err: any) { showMsg(false, err?.message || 'Delete failed'); }
  };

  const createWhConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!whForm.name || !whForm.account_id || !whForm.flipkart_warehouse_code) return;
    setSavingWh(true);
    try {
      await createRecord('flipkart.warehouse.config', {
        name: whForm.name,
        account_id: Number(whForm.account_id),
        flipkart_warehouse_code: whForm.flipkart_warehouse_code,
        transit_days: parseInt(whForm.transit_days) || 3,
        backend_warehouse_id: whForm.backend_warehouse_id ? Number(whForm.backend_warehouse_id) : false,
        is_active: true,
      });
      showMsg(true, `Warehouse "${whForm.name}" configured`);
      setWhForm({ name: '', account_id: '', flipkart_warehouse_code: '', transit_days: '3', backend_warehouse_id: '' });
      setShowWhForm(false);
      await loadBase();
    } catch (err: any) { showMsg(false, err?.message || 'Create failed'); }
    finally { setSavingWh(false); }
  };

  const deleteWhConfig = async (id: number, name: string) => {
    if (!confirm(`Remove warehouse config "${name}"?`)) return;
    try {
      await odooCall('flipkart.warehouse.config', 'unlink', [[id]], {});
      showMsg(true, 'Warehouse config removed');
      await loadBase();
    } catch (err: any) { showMsg(false, err?.message || 'Delete failed'); }
  };

  const inp = `input text-sm py-2 ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`;
  const cardBg = isDark ? 'bg-[#161b2e] border border-[#2a3250]' : 'bg-white border border-gray-200';
  const thCls = `text-left py-3 px-4 text-[10px] font-bold uppercase tracking-wider ${isDark ? 'text-[#5a6a8a]' : 'text-gray-500'}`;
  const tdCls = `py-3 px-4 text-xs ${isDark ? 'text-[#ccd6f6]' : 'text-gray-700'}`;

  const TABS = [
    { key: 'settings' as SetupTab, label: 'Settings', icon: Settings },
    { key: 'listings' as SetupTab, label: 'Master Listings', icon: BookOpen },
    { key: 'fsns' as SetupTab, label: 'Flipkart FSNs', icon: Hash },
    { key: 'accounts' as SetupTab, label: 'FK Accounts', icon: Zap },
    { key: 'warehouses' as SetupTab, label: 'Warehouse Mapping', icon: Warehouse },
  ];

  const filteredListings = listings.filter(l =>
    !listingSearch || l.name?.toLowerCase().includes(listingSearch.toLowerCase()) ||
    l.fsn?.toLowerCase().includes(listingSearch.toLowerCase()) ||
    l.sku?.toLowerCase().includes(listingSearch.toLowerCase())
  );

  const filteredFsns = fsns.filter(f =>
    !fsnSearch || f.name?.toLowerCase().includes(fsnSearch.toLowerCase()) ||
    (Array.isArray(f.product_id) ? f.product_id[1] : '').toLowerCase().includes(fsnSearch.toLowerCase())
  );

  return (
    <div className="space-y-5 animate-fade-in">
      {toast && (
        <div className={`fixed top-5 right-5 z-50 px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 text-sm font-medium animate-fade-in
          ${toast.ok ? 'bg-green-500/15 border border-green-500/30 text-green-400' : 'bg-red-500/15 border border-red-500/30 text-red-400'}`}>
          {toast.ok ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />} {toast.msg}
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className={`text-xl font-black ${isDark ? 'text-white' : 'text-gray-900'}`}>Business OS Setup</h1>
          <p className={`text-xs mt-0.5 ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>Manage settings, listings, FSNs, accounts and FBF warehouse mappings</p>
        </div>
        <button onClick={loadBase} disabled={loading} className="btn-secondary text-xs px-3 py-2">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Tab bar */}
      <div className={`flex overflow-x-auto gap-1 border-b ${isDark ? 'border-[#2a3250]' : 'border-gray-200'}`}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-shrink-0 flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-all whitespace-nowrap ${
              tab === t.key ? 'border-[#7367f0] text-[#7367f0]'
              : `border-transparent ${isDark ? 'text-[#6a7a9a] hover:text-white' : 'text-gray-500 hover:text-gray-900'}`
            }`}>
            <t.icon size={14} />
            {t.label}
          </button>
        ))}
      </div>

      {/* ---- Settings ---- */}
      {tab === 'settings' && (
        <div className="space-y-4 max-w-2xl">
          {(['General', 'Inventory', 'FBF', 'Supplier', 'AI'] as const).map(group => {
            const fields = SETTING_FIELDS.filter(f => f.group === group);
            return (
              <div key={group} className={`${cardBg} rounded-2xl p-5 space-y-3`}>
                <h3 className={`font-bold text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>{group} Settings</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {fields.map(f => (
                    <div key={f.key}>
                      <label className={`text-[10px] font-semibold block mb-1 ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>{f.label}</label>
                      {f.type === 'bool' ? (
                        <select value={params[f.key] ?? ''} onChange={e => setParams(p => ({ ...p, [f.key]: e.target.value }))} className={inp}>
                          <option value="">? Default ?</option>
                          <option value="true">Enabled</option>
                          <option value="false">Disabled</option>
                        </select>
                      ) : (
                        <input type={f.type === 'number' ? 'number' : f.type === 'password' ? 'password' : 'text'}
                          value={params[f.key] ?? ''}
                          onChange={e => setParams(p => ({ ...p, [f.key]: e.target.value }))}
                          placeholder={`e.g. ${f.type === 'number' ? '30' : f.type === 'password' ? '••••••••' : 'value'}`}
                          autoComplete="new-password"
                          className={inp} />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          <button onClick={saveSettings} disabled={savingParams} className="btn-primary px-6 py-2.5 flex items-center gap-2">
            {savingParams ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
            Save All Settings
          </button>
        </div>
      )}

      {/* ---- Master Listings ---- */}
      {tab === 'listings' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-xs">
              <Search size={13} className={`absolute left-3 top-1/2 -translate-y-1/2 ${isDark ? 'text-[#4a5580]' : 'text-gray-400'}`} />
              <input value={listingSearch} onChange={e => setListingSearch(e.target.value)} placeholder="Search FSN, SKU, name--" className={`${inp} pl-8`} />
            </div>
            <button onClick={loadListings} disabled={loading} className="btn-secondary text-xs px-3 py-2">
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            </button>
            <button onClick={() => setShowListingForm(p => !p)} className="btn-primary text-xs px-3 py-2">
              <Plus size={13} /> Add Listing
            </button>
          </div>

          {showListingForm && (
            <form onSubmit={saveListing} className={`${cardBg} rounded-2xl p-4 space-y-3`}>
              <h4 className={`font-bold text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>New Listing</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  { f: 'name', label: 'Product Name *', type: 'text' },
                  { f: 'fsn', label: 'FSN *', type: 'text' },
                  { f: 'sku', label: 'SKU', type: 'text' },
                  { f: 'category', label: 'Category', type: 'text' },
                  { f: 'mrp', label: 'MRP (--)', type: 'number' },
                  { f: 'selling_price', label: 'Selling Price (--)', type: 'number' },
                ].map(({ f, label, type }) => (
                  <div key={f}>
                    <label className={`text-[10px] font-semibold block mb-1 ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>{label}</label>
                    <input type={type} value={(listingForm as any)[f]} onChange={e => setListingForm(p => ({ ...p, [f]: e.target.value }))}
                      className={inp} required={label.endsWith('*')} />
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setShowListingForm(false)} className="btn-secondary text-xs px-4 py-2"><X size={13} /> Cancel</button>
                <button type="submit" disabled={savingListing} className="btn-primary text-xs px-4 py-2">
                  {savingListing ? <RefreshCw size={13} className="animate-spin" /> : <Plus size={13} />} Create
                </button>
              </div>
            </form>
          )}

          <div className={`${cardBg} rounded-2xl overflow-hidden`}>
            {loading ? (
              <div className="h-32 flex items-center justify-center"><RefreshCw size={18} className="animate-spin text-[#7367f0]" /></div>
            ) : filteredListings.length === 0 ? (
              <div className={`py-12 text-center text-sm ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>No listings found.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead><tr className={isDark ? 'bg-[#1e2440]/60' : 'bg-gray-50'}>
                    {['Product Name', 'FSN', 'SKU', 'Category', 'MRP', 'Price', ''].map(h => <th key={h} className={thCls}>{h}</th>)}
                  </tr></thead>
                  <tbody className={`divide-y ${isDark ? 'divide-[#2a3250]' : 'divide-gray-100'}`}>
                    {filteredListings.map(l => (
                      <tr key={l.id} className={isDark ? 'hover:bg-white/3' : 'hover:bg-gray-50'}>
                        <td className={`${tdCls} font-semibold max-w-[180px] truncate`}>{l.name}</td>
                        <td className={`${tdCls} font-mono text-[#7367f0]`}>{l.fsn || '--'}</td>
                        <td className={`${tdCls} font-mono text-xs`}>{l.sku || '--'}</td>
                        <td className={tdCls}>{l.category || '--'}</td>
                        <td className={tdCls}>--{(l.mrp || 0).toLocaleString('en-IN')}</td>
                        <td className={tdCls}>--{(l.selling_price || 0).toLocaleString('en-IN')}</td>
                        <td className={tdCls}>
                          <button onClick={() => deleteListing(l.id, l.name)}
                            className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-red-500/10 text-[#5a6a8a] hover:text-red-400' : 'text-gray-400 hover:text-red-500'}`}>
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className={`px-4 py-2 text-xs border-t ${isDark ? 'border-[#2a3250] text-[#4a5580]' : 'border-gray-100 text-gray-400'}`}>
              {filteredListings.length} listing{filteredListings.length !== 1 ? 's' : ''}
            </div>
          </div>
        </div>
      )}

      {/* ---- Flipkart FSNs ---- */}
      {tab === 'fsns' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 min-w-[200px] max-w-xs">
              <Search size={13} className={`absolute left-3 top-1/2 -translate-y-1/2 ${isDark ? 'text-[#4a5580]' : 'text-gray-400'}`} />
              <input value={fsnSearch} onChange={e => setFsnSearch(e.target.value)} placeholder="Filter by FSN or product..." className={`${inp} pl-8`} />
            </div>
            <button onClick={loadFsns} disabled={loading} className="btn-secondary text-xs px-3 py-2">
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
            <button onClick={() => setShowFsnForm(v => !v)} className="btn-primary text-xs px-3 py-2">
              <Plus size={13} /> Add FSN
            </button>
          </div>

          {showFsnForm && (
            <form onSubmit={saveFsn} className={`card p-4 rounded-2xl border space-y-3 ${isDark ? 'bg-[#1a2035] border-[#2a3250]' : 'bg-gray-50 border-gray-200'}`}>
              <p className={`text-xs font-bold uppercase tracking-wider ${isDark ? 'text-white' : 'text-gray-700'}`}>New FSN Mapping</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={`text-[10px] font-semibold block mb-1 ${isDark ? 'text-[#5a6a8a]' : 'text-gray-500'}`}>FSN / Barcode *</label>
                  <input value={fsnForm.barcode} onChange={e => setFsnForm(f => ({ ...f, barcode: e.target.value }))} required
                    placeholder="e.g. ACCZD7G6JMHHNNNN" className={`${inp} w-full font-mono`} />
                </div>
                <div className="relative">
                  <label className={`text-[10px] font-semibold block mb-1 ${isDark ? 'text-[#5a6a8a]' : 'text-gray-500'}`}>Linked Product *</label>
                  <input value={fsnForm.product_name}
                    onChange={e => { setFsnForm(f => ({ ...f, product_name: e.target.value, product_id: '' })); searchFsnProducts(e.target.value); setShowFsnProdDrop(true); }}
                    placeholder="Search product name..." className={`${inp} w-full`} />
                  {showFsnProdDrop && fsnProducts.length > 0 && (
                    <div className={`absolute z-30 top-full mt-1 w-full rounded-xl border shadow-xl max-h-44 overflow-y-auto ${isDark ? 'bg-[#1e2440] border-[#2a3250]' : 'bg-white border-gray-200'}`}>
                      {fsnProducts.map(p => (
                        <div key={p.id} onClick={() => { setFsnForm(f => ({ ...f, product_id: p.id, product_name: p.name })); setShowFsnProdDrop(false); setFsnProducts([]); }}
                          className={`px-3 py-2 text-xs cursor-pointer ${isDark ? 'hover:bg-white/5 text-white' : 'hover:bg-gray-50 text-gray-800'}`}>
                          {p.name}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <button type="submit" disabled={savingFsn || !fsnForm.barcode || !fsnForm.product_id} className="btn-primary text-xs px-4 py-2">
                  {savingFsn ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />} Save
                </button>
                <button type="button" onClick={() => { setShowFsnForm(false); setFsnForm({ barcode: '', product_id: '', product_name: '' }); }} className="btn-secondary text-xs px-4 py-2">Cancel</button>
              </div>
            </form>
          )}

          <div className={`${cardBg} rounded-2xl overflow-hidden`}>
            {loading ? (
              <div className="h-32 flex items-center justify-center"><RefreshCw size={18} className="animate-spin text-[#7367f0]" /></div>
            ) : filteredFsns.length === 0 ? (
              <div className={`py-12 text-center text-sm ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>
                No FSN mappings found. Use "+ Add FSN" to create one, or upload a Master Listings XLS from the Upload Center.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead><tr className={isDark ? 'bg-[#1e2440]/60' : 'bg-gray-50'}>
                    {['FSN (Barcode)', 'Linked Product'].map(h => <th key={h} className={thCls}>{h}</th>)}
                  </tr></thead>
                  <tbody className={`divide-y ${isDark ? 'divide-[#2a3250]' : 'divide-gray-100'}`}>
                    {filteredFsns.map(f => (
                      <tr key={f.id} className={isDark ? 'hover:bg-white/3' : 'hover:bg-gray-50'}>
                        <td className={`${tdCls} font-mono text-[#7367f0] font-bold`}>{f.name}</td>
                        <td className={tdCls}>{Array.isArray(f.product_id) ? f.product_id[1] : '--'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className={`px-4 py-2 text-xs border-t ${isDark ? 'border-[#2a3250] text-[#4a5580]' : 'border-gray-100 text-gray-400'}`}>
              {filteredFsns.length} FSN mapping{filteredFsns.length !== 1 ? 's' : ''}
            </div>
          </div>
        </div>
      )}

      {/* ---- Flipkart Accounts ---- */}
      {tab === 'accounts' && (
        <div className={`${cardBg} rounded-2xl overflow-hidden`}>
          <div className={`px-5 py-4 border-b flex items-center justify-between ${isDark ? 'border-[#2a3250]' : 'border-gray-100'}`}>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-[#7367f0]/15 flex items-center justify-center"><Zap size={16} className="text-[#7367f0]" /></div>
              <h2 className={`font-bold text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>Flipkart Seller Accounts</h2>
            </div>
            <span className={`text-xs ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>{accounts.length} accounts</span>
          </div>
          <form onSubmit={createAccount} className={`px-5 py-3 border-b flex gap-3 ${isDark ? 'border-[#2a3250] bg-[#1e2440]/30' : 'border-gray-100 bg-gray-50'}`}>
            <input value={newAccName} onChange={e => setNewAccName(e.target.value)}
              placeholder="New account name (e.g. Robifel, Roxxcart)"
              className={`input flex-1 text-xs py-2 ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`} />
            <button type="submit" disabled={savingAcc || !newAccName.trim()} className="btn-primary text-xs px-4 py-2">
              {savingAcc ? <RefreshCw size={13} className="animate-spin" /> : <Plus size={13} />} Add
            </button>
          </form>
          {accounts.length === 0 && !loading ? (
            <div className={`py-12 text-center text-sm ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>No accounts configured yet.</div>
          ) : (
            <div className={`divide-y ${isDark ? 'divide-[#2a3250]' : 'divide-gray-100'}`}>
              {accounts.map(a => (
                <div key={a.id} className={`px-5 py-3 flex items-center justify-between ${isDark ? 'hover:bg-white/5' : 'hover:bg-gray-50'}`}>
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-lg bg-[#7367f0]/10 flex items-center justify-center text-[10px] font-black text-[#7367f0]">
                      {a.name.charAt(0).toUpperCase()}
                    </div>
                    <span className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>{a.name}</span>
                    {!a.is_active && <span className="badge badge-gray text-[9px]">Inactive</span>}
                  </div>
                  <button onClick={() => deleteAccount(a.id, a.name)}
                    className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-red-500/10 text-[#5a6a8a] hover:text-red-400' : 'hover:bg-red-50 text-gray-400 hover:text-red-500'}`}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ---- Warehouse Mapping ---- */}
      {tab === 'warehouses' && (
        <div className={`${cardBg} rounded-2xl overflow-hidden`}>
          <div className={`px-5 py-4 border-b flex items-center justify-between ${isDark ? 'border-[#2a3250]' : 'border-gray-100'}`}>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-cyan-500/15 flex items-center justify-center"><Warehouse size={16} className="text-cyan-400" /></div>
              <h2 className={`font-bold text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>FBF Warehouse Configurations</h2>
            </div>
            <button onClick={() => setShowWhForm(p => !p)} className="btn-primary text-xs px-3 py-1.5">
              <Plus size={13} /> Add Warehouse
            </button>
          </div>

          {showWhForm && (
            <form onSubmit={createWhConfig} className={`px-5 py-4 border-b space-y-3 ${isDark ? 'border-[#2a3250] bg-[#1e2440]/30' : 'border-gray-100 bg-gray-50'}`}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  { f: 'name', label: 'Warehouse Name', placeholder: 'e.g. Delhi FBF' },
                  { f: 'flipkart_warehouse_code', label: 'Flipkart Warehouse Code', placeholder: "From FBF CSV 'Warehouse Id'" },
                ].map(({ f, label, placeholder }) => (
                  <div key={f}>
                    <label className={`text-[10px] font-semibold block mb-1 ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>{label}</label>
                    <input value={(whForm as any)[f]} onChange={e => setWhForm(p => ({ ...p, [f]: e.target.value }))}
                      placeholder={placeholder} required className={inp} />
                  </div>
                ))}
                <div>
                  <label className={`text-[10px] font-semibold block mb-1 ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>Seller Account</label>
                  <select value={whForm.account_id} onChange={e => setWhForm(p => ({ ...p, account_id: e.target.value }))} required className={inp}>
                    <option value="">-- Select Account --</option>
                    {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className={`text-[10px] font-semibold block mb-1 ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>Odoo Warehouse (backend link)</label>
                  <select value={whForm.backend_warehouse_id} onChange={e => setWhForm(p => ({ ...p, backend_warehouse_id: e.target.value }))} className={inp}>
                    <option value="">-- None --</option>
                    {odooWarehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className={`text-[10px] font-semibold block mb-1 ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>Transit Days from Main WH</label>
                  <input type="number" min="1" value={whForm.transit_days} onChange={e => setWhForm(p => ({ ...p, transit_days: e.target.value }))} className={inp} />
                </div>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setShowWhForm(false)} className="btn-secondary text-xs px-4 py-2"><X size={13} /> Cancel</button>
                <button type="submit" disabled={savingWh} className="btn-primary text-xs px-4 py-2">
                  {savingWh ? <RefreshCw size={13} className="animate-spin" /> : <Plus size={13} />} Save Configuration
                </button>
              </div>
            </form>
          )}

          {whConfigs.length === 0 && !loading ? (
            <div className={`py-12 text-center text-sm ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>
              No FBF warehouses configured. Add one to enable FBF stock uploads.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr className={isDark ? 'bg-[#1e2440]/60' : 'bg-gray-50'}>
                  {['Warehouse Name', 'Account', 'Flipkart WH Code', 'Transit Days', 'Status', ''].map(h => <th key={h} className={thCls}>{h}</th>)}
                </tr></thead>
                <tbody className={`divide-y ${isDark ? 'divide-[#2a3250]' : 'divide-gray-100'}`}>
                  {whConfigs.map(w => (
                    <tr key={w.id} className={isDark ? 'hover:bg-white/3' : 'hover:bg-gray-50'}>
                      <td className={`${tdCls} font-semibold`}>{w.name}</td>
                      <td className={tdCls}>{Array.isArray(w.account_id) ? w.account_id[1] : '--'}</td>
                      <td className={`${tdCls} font-mono text-[#7367f0]`}>{w.flipkart_warehouse_code}</td>
                      <td className={tdCls}>{w.transit_days}d</td>
                      <td className={tdCls}>
                        <span className={`badge ${w.is_active ? 'badge-green' : 'badge-gray'}`}>{w.is_active ? 'Active' : 'Inactive'}</span>
                      </td>
                      <td className={tdCls}>
                        <button onClick={() => deleteWhConfig(w.id, w.name)}
                          className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-red-500/10 text-[#5a6a8a] hover:text-red-400' : 'text-gray-400 hover:text-red-500'}`}>
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

