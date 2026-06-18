import { useState, useEffect, useRef } from 'react';
import { searchRead, odooCall } from '../../../services/odoo';
import { useTheme } from '../../../context/ThemeContext';
import { scanBarcode, isNative } from '../../../services/native';
import BulkDeleteBar from '../../ui/BulkDeleteBar';
import {
  RefreshCw, Scan, CheckCircle2, AlertCircle,
  Upload, RotateCcw, PackageSearch, X, Search, ScanLine, Package, Ban, Camera,
} from 'lucide-react';

interface ScanMatch {
  id: number;
  return_id: string;
  tracking_id: string;
  fsn: string;
  sku: string;
  product_id: [number, string] | false;
  quantity: number;
  return_reason: string;
}

interface ReturnRecord {
  id: number;
  return_id: string;
  tracking_id: string;
  fsn: string;
  sku: string;
  product_id: [number, string] | false;
  quantity: number;
  state: 'draft' | 'scanned' | 'processed' | 'rejected' | 'cancelled';
  return_requested_date: string;
  return_type: string;
  return_reason: string;
  account_id: [number, string] | false;
  selected: boolean;
}

interface WizComponent {
  product_id: number;
  name: string;
  default_code: string;
  qty: number;
  selected: boolean;
}

interface Account { id: number; name: string; }

const STATE_META: Record<string, { label: string; cls: string }> = {
  draft:     { label: 'Pending',   cls: 'badge-gray' },
  scanned:   { label: 'Scanned',   cls: 'badge-violet' },
  processed: { label: 'Inwarded',  cls: 'badge-green' },
  rejected:  { label: 'Rejected',  cls: 'badge-red' },
  cancelled: { label: 'Cancelled', cls: 'badge-amber' },
};

const TABS = ['all', 'draft', 'scanned', 'processed', 'rejected', 'cancelled'] as const;

export default function ReturnsManagement() {
  const { isDark } = useTheme();
  const fileRef = useRef<HTMLInputElement>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [uploadAccountId, setUploadAccountId] = useState<number | ''>('');
  const [filterAccountId, setFilterAccountId] = useState<number | ''>('');
  const [items, setItems] = useState<ReturnRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [tab, setTab] = useState<typeof TABS[number]>('all');
  const [search, setSearch] = useState('');
  const [scanInput, setScanInput] = useState('');
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);

  // Scan wizard (mirrors flipkart.return.scan.wizard: identify -> confirm/reject -> next)
  const [wizOpen, setWizOpen] = useState(false);
  const [wizTracking, setWizTracking] = useState('');
  const [wizMatch, setWizMatch] = useState<ScanMatch | null | undefined>(undefined); // undefined=idle, null=not found
  const [wizComponents, setWizComponents] = useState<WizComponent[]>([]); // exploded leaves w/ checkboxes
  const [wizBusy, setWizBusy] = useState(false);
  const [wizStats, setWizStats] = useState({ inwarded: 0, rejected: 0 });
  const wizInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    sync();
    searchRead<Account>('flipkart.account', { fields: ['id', 'name'], limit: 50 })
      .then(r => { if (Array.isArray(r) && r.length) { setAccounts(r); setUploadAccountId(r[0].id); } })
      .catch(() => {});
  }, []);

  const showMsg = (ok: boolean, msg: string) => {
    setToast({ ok, msg });
    setTimeout(() => setToast(null), 4000);
  };

  const sync = async () => {
    setLoading(true);
    try {
      const r = await searchRead<any>('flipkart.return.management', {
        fields: ['id', 'return_id', 'tracking_id', 'fsn', 'sku', 'product_id', 'quantity',
                 'state', 'return_requested_date', 'return_type', 'return_reason', 'account_id'],
        limit: 0,
        order: 'id desc',
      });
      if (Array.isArray(r)) {
        setItems(r.map(x => ({ ...x, selected: false })));
      }
    } catch (e: any) {
      showMsg(false, e?.message || 'Failed to load returns');
    } finally {
      setLoading(false);
    }
  };

  const doAction = async (method: string, ids: number[], successMsg: string) => {
    try {
      await odooCall('flipkart.return.management', method, [ids], {});
      showMsg(true, successMsg);
      await sync();
    } catch (e: any) {
      showMsg(false, e?.message || 'Action failed');
    }
  };

  const handleScan = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = scanInput.trim();
    if (!val) return;
    const found = items.find(r => r.tracking_id === val || r.return_id === val);
    if (!found) {
      showMsg(false, `No return found with tracking/return ID: ${val}`);
      return;
    }
    if (found.state === 'processed') {
      showMsg(false, 'This return has already been inwarded.');
      return;
    }
    await doAction('action_confirm_inward', [found.id], `Return ${found.return_id} inwarded successfully`);
    setScanInput('');
  };

  // ── Scan wizard ─────────────────────────────────────────────────────────────
  const openWizard = () => {
    setWizOpen(true); setWizTracking(''); setWizMatch(undefined); setWizComponents([]); setWizStats({ inwarded: 0, rejected: 0 });
    setTimeout(() => wizInputRef.current?.focus(), 80);
  };

  const resetScan = () => {
    setWizTracking(''); setWizMatch(undefined); setWizComponents([]);
    setTimeout(() => wizInputRef.current?.focus(), 50);
  };

  const wizIdentify = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const tid = wizTracking.trim();
    if (!tid) return;
    setWizBusy(true); setWizMatch(undefined); setWizComponents([]);
    try {
      const [rec] = await searchRead<ScanMatch>('flipkart.return.management', {
        domain: [['tracking_id', '=', tid], ['state', '=', 'draft']],
        fields: ['id', 'return_id', 'tracking_id', 'fsn', 'sku', 'product_id', 'quantity', 'return_reason'],
        limit: 1,
      });
      setWizMatch(rec || null);
      if (rec) {
        // Explode kit/BOM (incl. nested) into leaf components, all checked by default.
        try {
          const comps = await odooCall<WizComponent[]>('flipkart.return.management', 'get_inward_components', [[rec.id]], {});
          setWizComponents(Array.isArray(comps) ? comps.map(c => ({ ...c, selected: true })) : []);
        } catch { setWizComponents([]); }
      }
    } catch (err: any) { showMsg(false, err?.message || 'Lookup failed'); setWizMatch(null); }
    finally { setWizBusy(false); }
  };

  const toggleComponent = (pid: number) =>
    setWizComponents(prev => prev.map(c => c.product_id === pid ? { ...c, selected: !c.selected } : c));

  // Multi-component kit → partial inward of the checked leaves. Otherwise full inward.
  const isKit = wizComponents.length > 1;
  const selectedComponents = wizComponents.filter(c => c.selected);

  const wizConfirm = async () => {
    if (!wizMatch) return;
    if (isKit && selectedComponents.length === 0) { showMsg(false, 'Select at least one component to inward.'); return; }
    setWizBusy(true);
    try {
      await odooCall('flipkart.return.management', 'action_inward_components',
        [[wizMatch.id], selectedComponents.map(c => ({ product_id: c.product_id, qty: c.qty }))], {});
      setWizStats(s => ({ ...s, inwarded: s.inwarded + 1 }));
      resetScan();
      sync();
    } catch (err: any) { showMsg(false, err?.message || 'Inward failed'); }
    finally { setWizBusy(false); }
  };

  const wizReject = async () => {
    if (!wizMatch) return;
    setWizBusy(true);
    try {
      await odooCall('flipkart.return.management', 'action_reject', [[wizMatch.id]], {});
      setWizStats(s => ({ ...s, rejected: s.rejected + 1 }));
      resetScan();
      sync();
    } catch (err: any) { showMsg(false, err?.message || 'Action failed'); }
    finally { setWizBusy(false); }
  };

  const handleUpload = async (file: File) => {
    if (!uploadAccountId) { showMsg(false, 'Select an account before uploading.'); return; }
    setUploading(true);
    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const base64 = (e.target?.result as string)?.split(',')[1] || '';
        const wizardId = await odooCall<number>('flipkart.return.upload', 'create', [{
          file: base64,
          file_name: file.name,
          account_id: uploadAccountId,
        }], {});
        await odooCall('flipkart.return.upload', 'action_import', [[wizardId]], {});
        showMsg(true, `Imported ${file.name} successfully`);
        await sync();
        setUploading(false);
      };
      reader.readAsDataURL(file);
    } catch (e: any) {
      showMsg(false, e?.message || 'Upload failed');
      setUploading(false);
    }
  };

  const toggleSelect = (id: number) =>
    setItems(prev => prev.map(r => r.id === id ? { ...r, selected: !r.selected } : r));

  const toggleAll = () => {
    const vis = filtered;
    const allSel = vis.every(r => r.selected);
    const visIds = new Set(vis.map(r => r.id));
    setItems(prev => prev.map(r => visIds.has(r.id) ? { ...r, selected: !allSel } : r));
  };

  const selectedIds = items.filter(r => r.selected).map(r => r.id);

  const filtered = items.filter(r => {
    const matchTab = tab === 'all' || r.state === tab;
    const q = search.toLowerCase();
    const matchSearch = !search ||
      r.return_id?.toLowerCase().includes(q) ||
      r.tracking_id?.toLowerCase().includes(q) ||
      r.fsn?.toLowerCase().includes(q) ||
      r.sku?.toLowerCase().includes(q);
    const matchAccount = !filterAccountId ||
      (Array.isArray(r.account_id) && r.account_id[0] === filterAccountId);
    return matchTab && matchSearch && matchAccount;
  });

  const tabCounts = TABS.reduce((acc, t) => {
    acc[t] = t === 'all' ? items.length : items.filter(r => r.state === t).length;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-5 right-5 z-50 px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 text-sm font-medium animate-fade-in
          ${toast.ok ? 'bg-green-500/15 border border-green-500/30 text-green-400' : 'bg-red-500/15 border border-red-500/30 text-red-400'}`}>
          {toast.ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />} {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className={`text-xl font-black ${isDark ? 'text-white' : 'text-gray-900'}`}>Returns Management</h1>
          <p className={`text-xs mt-0.5 ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>
            {items.length} total -- {items.filter(r => r.state === 'draft').length} pending -- {items.filter(r => r.state === 'processed').length} inwarded
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={openWizard} className="btn-primary text-xs px-3 py-2">
            <ScanLine size={13} /> Scan Wizard
          </button>
          <button onClick={sync} disabled={loading} className="btn-secondary text-xs px-3 py-2">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Sync
          </button>
          {accounts.length > 0 && (
            <select value={uploadAccountId} onChange={e => setUploadAccountId(Number(e.target.value))}
              className={`input text-xs py-1.5 px-2 ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`}>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
          <button onClick={() => fileRef.current?.click()} disabled={uploading || !uploadAccountId} className="btn-secondary text-xs px-3 py-2">
            <Upload size={13} className={uploading ? 'animate-spin' : ''} /> Upload CSV
          </button>
          <input ref={fileRef} type="file" accept=".csv" className="hidden"
            onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0])} />
          {selectedIds.length > 0 && (
            <>
              <button onClick={() => doAction('action_confirm_inward', selectedIds, `${selectedIds.length} returns inwarded`)}
                className="btn-primary text-xs px-3 py-2">
                <CheckCircle2 size={13} /> Inward ({selectedIds.length})
              </button>
              <button onClick={() => doAction('action_reject', selectedIds, `${selectedIds.length} returns rejected`)}
                className="btn-secondary text-xs px-3 py-2 text-red-400 border-red-400/30">
                <X size={13} /> Reject
              </button>
            </>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {(['draft', 'scanned', 'processed', 'rejected', 'cancelled'] as const).map(s => (
          <button key={s} onClick={() => setTab(s)}
            className={`card p-3 text-left transition-all ${tab === s ? 'ring-2 ring-[#7367f0]' : ''}`}>
            <p className={`text-lg font-black ${isDark ? 'text-white' : 'text-gray-900'}`}>{tabCounts[s] || 0}</p>
            <span className={`badge text-[10px] mt-1 ${STATE_META[s].cls}`}>{STATE_META[s].label}</span>
          </button>
        ))}
      </div>

      {/* Scan Bar */}
      <div className={`card p-4 flex gap-3 items-center`}>
        <Scan size={18} className="text-[#7367f0] flex-shrink-0" />
        <form onSubmit={handleScan} className="flex gap-2 flex-1">
          <input value={scanInput} onChange={e => setScanInput(e.target.value)}
            placeholder="Scan or type Tracking ID / Return ID to inward..."
            className={`input flex-1 text-xs py-2 ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`} />
          {isNative() && (
            <button type="button" onClick={async () => {
              try { const v = await scanBarcode(); setScanInput(v); }
              catch (e: any) { showMsg(false, e?.message || 'Scan cancelled'); }
            }} className="btn-secondary text-xs px-3 py-2">
              <Camera size={14} />
            </button>
          )}
          <button type="submit" disabled={!scanInput} className="btn-primary text-xs px-4 py-2">Inward</button>
        </form>
      </div>

      {/* Tabs + Search + Account filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className={`flex gap-1 border-b flex-1 ${isDark ? 'border-[#2a3250]' : 'border-gray-200'}`}>
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-2 text-xs font-semibold capitalize border-b-2 transition-all ${tab === t
                ? 'border-[#7367f0] text-[#7367f0]'
                : `border-transparent ${isDark ? 'text-[#6a7a9a] hover:text-white' : 'text-gray-500 hover:text-gray-900'}`}`}>
              {t === 'all' ? 'All' : STATE_META[t]?.label} {tabCounts[t] > 0 ? `(${tabCounts[t]})` : ''}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          {accounts.length > 0 && (
            <select value={filterAccountId} onChange={e => setFilterAccountId(e.target.value ? Number(e.target.value) : '')}
              className={`input text-xs py-1.5 px-2 ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`}>
              <option value="">All Accounts</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
          <div className="relative">
            <Search size={13} className={`absolute left-3 top-1/2 -translate-y-1/2 ${isDark ? 'text-[#4a5580]' : 'text-gray-400'}`} />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search FSN / SKU / ID..."
              className={`input pl-9 text-xs py-2 w-56 ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`} />
          </div>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="card h-48 flex items-center justify-center gap-3">
          <RefreshCw size={18} className="animate-spin text-[#7367f0]" />
          <span className={`text-sm ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>Loading returns...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-20 gap-3">
          <PackageSearch size={40} className="text-[#2a3250]" />
          <p className={`text-sm ${isDark ? 'text-[#5a6a8a]' : 'text-gray-500'}`}>No returns found. Click Sync or upload a CSV.</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="data-table w-full">
              <thead>
                <tr>
                  <th className="w-10">
                    <input type="checkbox" onChange={toggleAll}
                      checked={filtered.length > 0 && filtered.every(r => r.selected)}
                      className="rounded border-[#2a3250]" />
                  </th>
                  <th>Return ID</th>
                  <th>Tracking ID</th>
                  <th>FSN</th>
                  <th>SKU</th>
                  <th>Product</th>
                  <th className="text-center">Qty</th>
                  <th>Date Requested</th>
                  <th>Type</th>
                  <th className="text-center">State</th>
                  <th className="text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.id} className={r.selected ? (isDark ? 'bg-[#7367f0]/5' : 'bg-violet-50') : ''}>
                    <td>
                      <input type="checkbox" checked={r.selected} onChange={() => toggleSelect(r.id)}
                        className="rounded border-[#2a3250]" />
                    </td>
                    <td className="font-semibold text-[#7367f0] font-mono text-xs">{r.return_id || '--'}</td>
                    <td className={`font-mono text-xs ${isDark ? 'text-[#8897b5]' : 'text-gray-600'}`}>{r.tracking_id || '--'}</td>
                    <td className={`font-mono text-xs ${isDark ? 'text-[#7367f0]' : 'text-violet-600'}`}>{r.fsn || '--'}</td>
                    <td className={`text-xs ${isDark ? 'text-[#8897b5]' : 'text-gray-600'}`}>{r.sku || '--'}</td>
                    <td className={`text-xs max-w-[150px] truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>
                      {Array.isArray(r.product_id) ? r.product_id[1] : '--'}
                    </td>
                    <td className={`text-center font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>{r.quantity}</td>
                    <td className={`text-xs ${isDark ? 'text-[#8897b5]' : 'text-gray-500'}`}>{r.return_requested_date || '--'}</td>
                    <td className={`text-xs ${isDark ? 'text-[#8897b5]' : 'text-gray-500'}`}>{r.return_type || '--'}</td>
                    <td className="text-center">
                      <span className={`badge ${STATE_META[r.state]?.cls || 'badge-gray'}`}>
                        {STATE_META[r.state]?.label || r.state}
                      </span>
                    </td>
                    <td className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        {(r.state === 'draft' || r.state === 'scanned') && (
                          <button onClick={() => doAction('action_confirm_inward', [r.id], 'Return inwarded')}
                            className="btn-primary text-[10px] px-2 py-1">Inward</button>
                        )}
                        {r.state !== 'processed' && r.state !== 'rejected' && r.state !== 'cancelled' && (
                          <button onClick={() => doAction('action_reject', [r.id], 'Return rejected')}
                            className="btn-secondary text-[10px] px-2 py-1 text-red-400 border-red-400/30">Reject</button>
                        )}
                        {r.state === 'processed' && (
                          <button onClick={() => doAction('action_reverse', [r.id], 'Reversal created')}
                            className="btn-secondary text-[10px] px-2 py-1">
                            <RotateCcw size={10} /> Reverse
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Admin bulk delete */}
      <BulkDeleteBar model="flipkart.return.management" label="return" ids={selectedIds}
        onClear={() => setItems(prev => prev.map(r => ({ ...r, selected: false })))}
        onDeleted={() => sync()} />

      {/* ── Scan Wizard ─────────────────────────────────────────────── */}
      {wizOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center bg-black/60 backdrop-blur-sm" onClick={() => setWizOpen(false)}>
          <div className={`w-full sm:max-w-md max-h-[92vh] flex flex-col rounded-t-3xl sm:rounded-3xl shadow-2xl animate-slide-up ${isDark ? 'bg-[#161b2e]' : 'bg-white'}`} onClick={e => e.stopPropagation()}>
            <div className="pt-2.5 flex justify-center sm:hidden"><div className="w-10 h-1 rounded-full bg-gray-400/40" /></div>
            <div className={`px-5 py-4 flex items-center justify-between border-b ${isDark ? 'border-[#2a3250]' : 'border-gray-100'}`}>
              <div className="flex items-center gap-2">
                <ScanLine size={18} className="text-[#7367f0]" />
                <div>
                  <h2 className={`font-black text-base ${isDark ? 'text-white' : 'text-gray-900'}`}>Scan Returns</h2>
                  <p className={`text-[11px] ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>Scan tracking ID, verify the item, then inward or reject.</p>
                </div>
              </div>
              <button onClick={() => setWizOpen(false)} className={`p-1.5 rounded-xl ${isDark ? 'hover:bg-white/5 text-[#5a6a8a]' : 'hover:bg-gray-100 text-gray-400'}`}><X size={18} /></button>
            </div>

            {/* session stats */}
            <div className="px-5 pt-3 flex gap-2">
              <div className={`flex-1 rounded-xl px-3 py-2 ${isDark ? 'bg-[#12172a]' : 'bg-gray-50'}`}>
                <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-500">Inwarded</p>
                <p className={`text-lg font-black ${isDark ? 'text-white' : 'text-gray-900'}`}>{wizStats.inwarded}</p>
              </div>
              <div className={`flex-1 rounded-xl px-3 py-2 ${isDark ? 'bg-[#12172a]' : 'bg-gray-50'}`}>
                <p className="text-[10px] font-bold uppercase tracking-wider text-rose-500">Rejected</p>
                <p className={`text-lg font-black ${isDark ? 'text-white' : 'text-gray-900'}`}>{wizStats.rejected}</p>
              </div>
            </div>

            <div className="px-5 py-4 space-y-3 overflow-y-auto">
              {/* scan input */}
              <form onSubmit={wizIdentify} className="flex gap-2">
                <div className={`flex items-center gap-2 flex-1 px-3 py-2.5 rounded-2xl border ${isDark ? 'bg-[#12172a] border-[#2a3250]' : 'bg-gray-50 border-gray-200'}`}>
                  <Scan size={16} className="text-[#7367f0]" />
                  <input ref={wizInputRef} value={wizTracking} onChange={e => setWizTracking(e.target.value)} autoFocus
                    placeholder="Scan / type Tracking ID..." className={`bg-transparent outline-none text-sm flex-1 ${isDark ? 'text-white' : 'text-gray-900'}`} />
                </div>
                {isNative() && (
                  <button type="button" onClick={async () => {
                    try {
                      const v = await scanBarcode();
                      setWizTracking(v);
                      // auto-identify after scan
                      setWizBusy(true); setWizMatch(undefined); setWizComponents([]);
                      try {
                        const [rec] = await searchRead<ScanMatch>('flipkart.return.management', {
                          domain: [['tracking_id', '=', v.trim()], ['state', '=', 'draft']],
                          fields: ['id', 'return_id', 'tracking_id', 'fsn', 'sku', 'product_id', 'quantity', 'return_reason'],
                          limit: 1,
                        });
                        setWizMatch(rec || null);
                        if (rec) {
                          try {
                            const comps = await odooCall<WizComponent[]>('flipkart.return.management', 'get_inward_components', [[rec.id]], {});
                            setWizComponents(Array.isArray(comps) ? comps.map(c => ({ ...c, selected: true })) : []);
                          } catch { setWizComponents([]); }
                        }
                      } catch (err: any) { showMsg(false, err?.message || 'Lookup failed'); setWizMatch(null); }
                      finally { setWizBusy(false); }
                    } catch (e: any) { showMsg(false, e?.message || 'Scan cancelled'); }
                  }} className="btn-secondary text-xs px-3 py-2.5">
                    <Camera size={16} />
                  </button>
                )}
                <button type="submit" disabled={wizBusy || !wizTracking.trim()} className="btn-secondary text-xs px-4 py-2">
                  {wizBusy && wizMatch === undefined ? <RefreshCw size={14} className="animate-spin" /> : 'Find'}
                </button>
              </form>

              {/* identification result */}
              {wizMatch === null && (
                <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 flex items-center gap-2 text-rose-400 text-sm font-medium">
                  <Ban size={16} /> No pending return found for "{wizTracking.trim()}".
                </div>
              )}
              {wizMatch && (
                <div className={`rounded-2xl border p-4 ${isDark ? 'border-[#2a3250] bg-[#12172a]' : 'border-gray-200 bg-gray-50'}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-9 h-9 rounded-xl bg-[#7367f0]/15 flex items-center justify-center"><Package size={18} className="text-[#7367f0]" /></span>
                    <div className="min-w-0">
                      <p className={`font-bold text-sm truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>{Array.isArray(wizMatch.product_id) ? wizMatch.product_id[1] : 'Not identified'}</p>
                      <p className={`text-[11px] font-mono ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>FSN {wizMatch.fsn} • Qty {wizMatch.quantity}</p>
                    </div>
                  </div>
                  <div className={`grid grid-cols-2 gap-2 text-[11px] ${isDark ? 'text-[#8897b5]' : 'text-gray-600'}`}>
                    <div><span className={isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}>Return ID:</span> <span className="font-mono">{wizMatch.return_id}</span></div>
                    <div><span className={isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}>SKU:</span> {wizMatch.sku || '--'}</div>
                    {wizMatch.return_reason && <div className="col-span-2"><span className={isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}>Reason:</span> {wizMatch.return_reason}</div>}
                  </div>

                  {/* Kit components — tick the ones to inward (partial inward) */}
                  {isKit && (
                    <div className={`mt-3 rounded-xl border ${isDark ? 'border-[#2a3250]' : 'border-gray-200'}`}>
                      <div className={`px-3 py-2 flex items-center justify-between border-b ${isDark ? 'border-[#2a3250]' : 'border-gray-100'}`}>
                        <span className={`text-[11px] font-bold uppercase tracking-wider ${isDark ? 'text-[#8897b5]' : 'text-gray-500'}`}>
                          Kit Components ({selectedComponents.length}/{wizComponents.length})
                        </span>
                        <button type="button"
                          onClick={() => { const all = wizComponents.every(c => c.selected); setWizComponents(prev => prev.map(c => ({ ...c, selected: !all }))); }}
                          className="text-[11px] font-semibold text-[#7367f0]">
                          {wizComponents.every(c => c.selected) ? 'Clear all' : 'Select all'}
                        </button>
                      </div>
                      <div className="max-h-44 overflow-y-auto divide-y divide-[#2a3250]/40">
                        {wizComponents.map(c => (
                          <label key={c.product_id}
                            className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer ${c.selected ? '' : 'opacity-50'} ${isDark ? 'hover:bg-white/5' : 'hover:bg-gray-50'}`}>
                            <input type="checkbox" checked={c.selected} onChange={() => toggleComponent(c.product_id)}
                              className="rounded border-[#2a3250] accent-[#7367f0]" />
                            <span className={`flex-1 text-xs truncate ${isDark ? 'text-white' : 'text-gray-900'}`} title={c.name}>
                              {c.default_code ? <span className="font-mono text-[#7367f0]">[{c.default_code}] </span> : null}{c.name}
                            </span>
                            <span className={`text-[11px] font-semibold ${isDark ? 'text-[#8897b5]' : 'text-gray-500'}`}>×{c.qty}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex gap-2 mt-3">
                    <button onClick={wizConfirm} disabled={wizBusy || (isKit && selectedComponents.length === 0)} className="flex-1 py-2.5 rounded-xl text-white font-bold text-sm flex items-center justify-center gap-1.5 disabled:opacity-50" style={{ background: 'linear-gradient(135deg, #10b981, #059669)' }}>
                      {wizBusy ? <RefreshCw size={14} className="animate-spin" /> : <CheckCircle2 size={15} />} {isKit ? `Inward ${selectedComponents.length} item${selectedComponents.length === 1 ? '' : 's'}` : 'Confirm Inward'}
                    </button>
                    <button onClick={wizReject} disabled={wizBusy} className="flex-1 py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5 border border-rose-500/40 text-rose-400 disabled:opacity-50">
                      <Ban size={15} /> Reject
                    </button>
                  </div>
                </div>
              )}
              {wizMatch === undefined && !wizBusy && (
                <p className={`text-center text-xs py-4 ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>Scan a tracking ID to identify the return.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

