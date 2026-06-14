import { useState, useRef, useEffect } from 'react';
import { searchRead, odooCall, createRecord } from '../../../services/odoo';
import { useTheme } from '../../../context/ThemeContext';
import {
  Upload, CheckCircle2, AlertCircle, FileText, BarChart2,
  RefreshCw, ShoppingCart, RotateCcw, BookOpen, ScanLine, X
} from 'lucide-react';

interface Account { id: number; name: string; }

type Tab = 'fbf' | 'sales' | 'orders' | 'returns_csv' | 'scan_returns' | 'listings';

interface LogEntry { ok: boolean; msg: string; ts: string; }

const TABS: { key: Tab; label: string; icon: any; color: string }[] = [
  { key: 'fbf',         label: 'FBF Inventory',   icon: BarChart2,    color: '#7367f0' },
  { key: 'sales',       label: 'Sales Data',       icon: FileText,     color: '#10b981' },
  { key: 'orders',      label: 'Daily Orders',     icon: ShoppingCart, color: '#3d5af1' },
  { key: 'returns_csv', label: 'Returns CSV',      icon: RotateCcw,    color: '#f59e0b' },
  { key: 'scan_returns',label: 'Scan Returns',     icon: ScanLine,     color: '#06b6d4' },
  { key: 'listings',    label: 'Master Listings',  icon: BookOpen,     color: '#ef4444' },
];

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function UploadCenter() {
  const { isDark } = useTheme();
  const [activeTab, setActiveTab] = useState<Tab>('fbf');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState<number | ''>('');
  const [log, setLog] = useState<LogEntry[]>([]);

  // FBF
  const fbfRef = useRef<HTMLInputElement>(null);
  const [uploadingFbf, setUploadingFbf] = useState(false);

  // Sales
  const salesRef = useRef<HTMLInputElement>(null);
  const [salesStart, setSalesStart] = useState('');
  const [salesEnd, setSalesEnd] = useState('');
  const [uploadingSales, setUploadingSales] = useState(false);

  // Daily Orders
  const ordersRef = useRef<HTMLInputElement>(null);
  const [uploadingOrders, setUploadingOrders] = useState(false);

  // Returns CSV
  const returnsRef = useRef<HTMLInputElement>(null);
  const [uploadingReturns, setUploadingReturns] = useState(false);

  // Scan Returns
  const [scanTrackingId, setScanTrackingId] = useState('');
  const [scanResult, setScanResult] = useState<any>(null);
  const [scanning, setScanning] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Listings
  const listingsRef = useRef<HTMLInputElement>(null);
  const [uploadingListings, setUploadingListings] = useState(false);

  useEffect(() => {
    searchRead<Account>('flipkart.account', { fields: ['id', 'name'], limit: 50 })
      .then(r => {
        if (Array.isArray(r) && r.length > 0) { setAccounts(r); setAccountId(r[0].id); }
      }).catch(() => {});
  }, []);

  const addLog = (ok: boolean, msg: string) =>
    setLog(prev => [{ ok, msg, ts: new Date().toLocaleTimeString() }, ...prev.slice(0, 49)]);

  // ─── FBF Inventory upload ────────────────────────────────────────────
  const handleFbfUpload = async (file: File) => {
    if (!accountId) { addLog(false, 'Select an account first.'); return; }
    setUploadingFbf(true);
    try {
      const b64 = await fileToBase64(file);
      const wId = await odooCall<number>('flipkart.upload.wizard', 'create', [{
        upload_type: 'fbf_inventory', account_id: accountId, file_data: b64, file_name: file.name,
      }], {});
      await odooCall('flipkart.upload.wizard', 'action_upload', [[wId]], {});
      addLog(true, `FBF Inventory: "${file.name}" uploaded successfully.`);
    } catch (e: any) { addLog(false, 'FBF upload failed: ' + e.message); }
    finally { setUploadingFbf(false); }
  };

  // ─── Sales Data upload ───────────────────────────────────────────────
  const handleSalesUpload = async (file: File) => {
    if (!accountId) { addLog(false, 'Select an account first.'); return; }
    if (!salesStart || !salesEnd) { addLog(false, 'Set start and end dates first.'); return; }
    setUploadingSales(true);
    try {
      const b64 = await fileToBase64(file);
      const wId = await odooCall<number>('flipkart.upload.wizard', 'create', [{
        upload_type: 'sales_data', account_id: accountId, file_data: b64, file_name: file.name,
        sales_start_date: salesStart, sales_end_date: salesEnd,
      }], {});
      await odooCall('flipkart.upload.wizard', 'action_upload', [[wId]], {});
      addLog(true, `Sales Data: "${file.name}" uploaded for ${salesStart} → ${salesEnd}.`);
    } catch (e: any) { addLog(false, 'Sales upload failed: ' + e.message); }
    finally { setUploadingSales(false); }
  };

  // ─── Daily Orders upload ─────────────────────────────────────────────
  const handleOrdersUpload = async (file: File) => {
    if (!accountId) { addLog(false, 'Select an account first.'); return; }
    setUploadingOrders(true);
    try {
      const b64 = await fileToBase64(file);
      const wId = await createRecord('flipkart.daily.order.upload', { account_id: accountId, file: b64, file_name: file.name });
      await odooCall('flipkart.daily.order.upload', 'action_import', [[wId]], {});
      addLog(true, `Daily Orders: "${file.name}" imported successfully.`);
    } catch (e: any) { addLog(false, 'Orders upload failed: ' + e.message); }
    finally { setUploadingOrders(false); }
  };

  // ─── Returns CSV upload ─────────────────────────────────────────────
  const handleReturnsUpload = async (file: File) => {
    if (!accountId) { addLog(false, 'Select an account first.'); return; }
    setUploadingReturns(true);
    try {
      const b64 = await fileToBase64(file);
      const wId = await createRecord('flipkart.return.upload', { file: b64, file_name: file.name, account_id: accountId });
      await odooCall('flipkart.return.upload', 'action_import', [[wId]], {});
      addLog(true, `Returns CSV: "${file.name}" imported successfully.`);
    } catch (e: any) { addLog(false, 'Returns CSV upload failed: ' + e.message); }
    finally { setUploadingReturns(false); }
  };

  // ─── Scan Returns (wizard-based) ─────────────────────────────────────
  const handleScan = async () => {
    if (!scanTrackingId.trim()) return;
    setScanning(true);
    setScanResult(null);
    try {
      const wId = await createRecord('flipkart.return.scan.wizard', { tracking_id: scanTrackingId.trim() });
      const [rec] = await searchRead<any>('flipkart.return.scan.wizard', {
        domain: [['id', '=', wId]],
        fields: ['id', 'tracking_id', 'product_name', 'return_record_id'],
        limit: 1,
      });
      if (rec && rec.return_record_id) {
        setScanResult({ ...rec, wizardId: wId });
      } else {
        setScanResult({ notFound: true });
      }
    } catch (e: any) { addLog(false, 'Scan failed: ' + e.message); }
    finally { setScanning(false); }
  };

  const handleConfirmInward = async () => {
    if (!scanResult?.wizardId) return;
    setConfirming(true);
    try {
      await odooCall('flipkart.return.scan.wizard', 'action_confirm_and_next', [[scanResult.wizardId]], {});
      addLog(true, `Return ${scanResult.tracking_id} — confirmed inward.`);
      setScanResult(null);
      setScanTrackingId('');
    } catch (e: any) { addLog(false, 'Confirm failed: ' + e.message); }
    finally { setConfirming(false); }
  };

  const handleRejectReturn = async () => {
    if (!scanResult?.wizardId) return;
    setConfirming(true);
    try {
      await odooCall('flipkart.return.scan.wizard', 'action_reject_and_next', [[scanResult.wizardId]], {});
      addLog(true, `Return ${scanResult.tracking_id} — rejected.`);
      setScanResult(null);
      setScanTrackingId('');
    } catch (e: any) { addLog(false, 'Reject failed: ' + e.message); }
    finally { setConfirming(false); }
  };

  // ─── Master Listings upload ──────────────────────────────────────────
  const handleListingsUpload = async (file: File) => {
    setUploadingListings(true);
    try {
      const b64 = await fileToBase64(file);
      const wId = await odooCall<number>('flipkart.listing.upload', 'create', [{
        xls_file: b64, xls_file_name: file.name,
      }], {});
      await odooCall('flipkart.listing.upload', 'action_upload', [[wId]], {});
      addLog(true, `Master Listings: "${file.name}" uploaded successfully.`);
    } catch (e: any) { addLog(false, 'Listings upload failed: ' + e.message); }
    finally { setUploadingListings(false); }
  };

  const cardBg = isDark ? 'bg-[#161b2e] border border-[#2a3250]' : 'bg-white border border-gray-200';
  const inp = `input text-sm py-2 ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`;

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className={`text-xl font-black ${isDark ? 'text-white' : 'text-gray-900'}`}>Data Upload Center</h1>
        <p className={`text-xs mt-0.5 ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>
          Upload Flipkart data files and sync them with Odoo.
        </p>
      </div>

      {/* Global account selector */}
      <div className={`rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center gap-3 ${cardBg}`}>
        <label className={`text-xs font-semibold flex-shrink-0 ${isDark ? 'text-[#8897b5]' : 'text-gray-600'}`}>Flipkart Account:</label>
        <select value={accountId} onChange={e => setAccountId(Number(e.target.value))} className={`${inp} flex-1`}>
          <option value="">— Select Account —</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>

      {/* Tab Bar */}
      <div className={`flex overflow-x-auto gap-1 border-b ${isDark ? 'border-[#2a3250]' : 'border-gray-200'}`}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={`flex-shrink-0 flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-all whitespace-nowrap ${
              activeTab === t.key ? 'border-[#7367f0] text-[#7367f0]'
              : `border-transparent ${isDark ? 'text-[#6a7a9a] hover:text-white' : 'text-gray-500 hover:text-gray-900'}`
            }`}>
            <t.icon size={14} />
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className={`rounded-2xl p-5 space-y-4 ${cardBg}`}>

        {/* ── FBF Inventory ── */}
        {activeTab === 'fbf' && (
          <>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#7367f0]/10 flex items-center justify-center"><BarChart2 size={18} className="text-[#7367f0]" /></div>
              <div>
                <h3 className={`font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>FBF Current Inventory</h3>
                <p className={`text-xs ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>Live stock per FSN per warehouse · Maps to <code className="text-[#7367f0]">flipkart.fbf.stock</code></p>
              </div>
            </div>
            <p className={`text-xs ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>
              Upload the "Current Inventory" CSV/Excel from Flipkart Seller Hub. Required columns: Warehouse Id, FSN, SKU, Title, Live on Website, Sales 7D…
            </p>
            <button onClick={() => fbfRef.current?.click()} disabled={uploadingFbf || !accountId}
              className="btn-primary w-full justify-center py-3">
              {uploadingFbf ? <><RefreshCw size={14} className="animate-spin" /> Uploading…</> : <><Upload size={14} /> Upload FBF Inventory CSV / Excel</>}
            </button>
            <input ref={fbfRef} type="file" accept=".csv,.xlsx,.xls" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) { handleFbfUpload(f); e.target.value = ''; }}} />
          </>
        )}

        {/* ── Sales Data ── */}
        {activeTab === 'sales' && (
          <>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center"><FileText size={18} className="text-green-400" /></div>
              <div>
                <h3 className={`font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>Overall Sales Data</h3>
                <p className={`text-xs ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>Flipkart sales report by SKU/date · Maps to <code className="text-[#7367f0]">flipkart.sales.dashboard</code></p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={`text-[10px] font-semibold block mb-1 ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>Start Date</label>
                <input type="date" value={salesStart} onChange={e => setSalesStart(e.target.value)} className={inp} />
              </div>
              <div>
                <label className={`text-[10px] font-semibold block mb-1 ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>End Date</label>
                <input type="date" value={salesEnd} onChange={e => setSalesEnd(e.target.value)} className={inp} />
              </div>
            </div>
            <button onClick={() => salesRef.current?.click()} disabled={uploadingSales || !accountId || !salesStart || !salesEnd}
              className="btn-primary w-full justify-center py-3 bg-green-600 hover:bg-green-700 border-green-600">
              {uploadingSales ? <><RefreshCw size={14} className="animate-spin" /> Uploading…</> : <><Upload size={14} /> Upload Sales Data CSV</>}
            </button>
            <input ref={salesRef} type="file" accept=".csv,.xlsx,.xls" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) { handleSalesUpload(f); e.target.value = ''; }}} />
          </>
        )}

        {/* ── Daily Orders ── */}
        {activeTab === 'orders' && (
          <>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center"><ShoppingCart size={18} className="text-blue-400" /></div>
              <div>
                <h3 className={`font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>Upload Daily Orders</h3>
                <p className={`text-xs ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>Flipkart daily order CSV · Maps to <code className="text-[#7367f0]">flipkart.daily.order</code></p>
              </div>
            </div>
            <p className={`text-xs ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>
              Required columns: FSN, Shipment ID, Order Id, SKU, Ordered On, Quantity. Orders are imported as Draft — go to Daily Orders screen to process them.
            </p>
            <button onClick={() => ordersRef.current?.click()} disabled={uploadingOrders || !accountId}
              className="btn-primary w-full justify-center py-3">
              {uploadingOrders ? <><RefreshCw size={14} className="animate-spin" /> Importing…</> : <><Upload size={14} /> Upload Daily Orders CSV</>}
            </button>
            <input ref={ordersRef} type="file" accept=".csv" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) { handleOrdersUpload(f); e.target.value = ''; }}} />
          </>
        )}

        {/* ── Returns CSV ── */}
        {activeTab === 'returns_csv' && (
          <>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center"><RotateCcw size={18} className="text-amber-400" /></div>
              <div>
                <h3 className={`font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>Upload Returns CSV</h3>
                <p className={`text-xs ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>Batch import return records · Maps to <code className="text-[#7367f0]">flipkart.return.management</code></p>
              </div>
            </div>
            <p className={`text-xs ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>
              Required columns: <span className="font-medium">Return ID, Tracking ID, FSN, SKU, Quantity</span>. Optional: Return Type, Return Reason, Requested Date. Records are created as Draft (Pending Scan).
            </p>
            <button onClick={() => returnsRef.current?.click()} disabled={uploadingReturns || !accountId}
              className="btn-primary w-full justify-center py-3 bg-amber-500 hover:bg-amber-600 border-amber-500">
              {uploadingReturns ? <><RefreshCw size={14} className="animate-spin" /> Importing…</> : <><Upload size={14} /> Upload Returns CSV</>}
            </button>
            <input ref={returnsRef} type="file" accept=".csv" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) { handleReturnsUpload(f); e.target.value = ''; }}} />
          </>
        )}

        {/* ── Scan Returns ── */}
        {activeTab === 'scan_returns' && (
          <>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-cyan-500/10 flex items-center justify-center"><ScanLine size={18} className="text-cyan-400" /></div>
              <div>
                <h3 className={`font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>Scan Returns by Tracking ID</h3>
                <p className={`text-xs ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>Scan each return package and confirm inward one at a time.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <input
                value={scanTrackingId}
                onChange={e => { setScanTrackingId(e.target.value); setScanResult(null); }}
                onKeyDown={e => e.key === 'Enter' && handleScan()}
                placeholder="Enter or scan Tracking ID…"
                className={`${inp} flex-1`}
                autoFocus
              />
              <button onClick={handleScan} disabled={scanning || !scanTrackingId.trim()} className="btn-primary px-4 py-2">
                {scanning ? <RefreshCw size={14} className="animate-spin" /> : 'Scan'}
              </button>
            </div>
            {scanResult && !scanResult.notFound && (
              <div className={`p-4 rounded-xl border space-y-3 ${isDark ? 'border-green-500/30 bg-green-500/5' : 'border-green-200 bg-green-50'}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={16} className="text-green-400" />
                    <span className={`font-semibold text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>Return Found</span>
                  </div>
                  <button onClick={() => { setScanResult(null); setScanTrackingId(''); }}><X size={14} className={isDark ? 'text-gray-400' : 'text-gray-500'} /></button>
                </div>
                <div className="text-xs space-y-1">
                  <div><span className={`${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>Tracking ID: </span><span className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>{scanResult.tracking_id}</span></div>
                  <div><span className={`${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>Product: </span><span className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>{scanResult.product_name || '—'}</span></div>
                </div>
                <div className="flex gap-2">
                  <button onClick={handleConfirmInward} disabled={confirming} className="btn-primary flex-1 justify-center py-2.5">
                    {confirming ? <RefreshCw size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                    Confirm Inward
                  </button>
                  <button onClick={handleRejectReturn} disabled={confirming}
                    className={`flex-1 py-2.5 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 ${isDark ? 'border-red-500/30 text-red-400 hover:bg-red-500/10' : 'border-red-300 text-red-600 hover:bg-red-50'}`}>
                    <X size={14} /> Reject
                  </button>
                </div>
              </div>
            )}
            {scanResult?.notFound && (
              <div className={`p-4 rounded-xl border flex items-center gap-3 ${isDark ? 'border-red-500/30 bg-red-500/5 text-red-400' : 'border-red-200 bg-red-50 text-red-600'}`}>
                <AlertCircle size={16} />
                <span className="text-sm font-medium">No matching return found for tracking ID: <strong>{scanTrackingId}</strong></span>
              </div>
            )}
          </>
        )}

        {/* ── Master Listings ── */}
        {activeTab === 'listings' && (
          <>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center"><BookOpen size={18} className="text-red-400" /></div>
              <div>
                <h3 className={`font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>Upload Master Listings</h3>
                <p className={`text-xs ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>Flipkart Master Listings XLS · Maps to <code className="text-[#7367f0]">flipkart.listing</code></p>
              </div>
            </div>
            <p className={`text-xs ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>
              Upload the "Master Listings" XLS/XLSX from Flipkart Seller Hub. Updates FSN → product title, category, MRP, selling price, and dimensions.
            </p>
            <button onClick={() => listingsRef.current?.click()} disabled={uploadingListings}
              className="btn-primary w-full justify-center py-3 bg-red-500 hover:bg-red-600 border-red-500">
              {uploadingListings ? <><RefreshCw size={14} className="animate-spin" /> Uploading…</> : <><Upload size={14} /> Upload Master Listings XLS</>}
            </button>
            <input ref={listingsRef} type="file" accept=".xls,.xlsx" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) { handleListingsUpload(f); e.target.value = ''; }}} />
          </>
        )}
      </div>

      {/* Upload Log */}
      {log.length > 0 && (
        <div className={`rounded-2xl overflow-hidden ${cardBg}`}>
          <div className={`px-4 py-3 border-b flex items-center justify-between ${isDark ? 'border-[#2a3250]' : 'border-gray-100'}`}>
            <h3 className={`text-xs font-semibold uppercase tracking-wider ${isDark ? 'text-[#5a6a8a]' : 'text-gray-500'}`}>Upload Log</h3>
            <button onClick={() => setLog([])} className={`text-xs ${isDark ? 'text-[#5a6a8a] hover:text-white' : 'text-gray-400 hover:text-gray-700'}`}>Clear</button>
          </div>
          <div className={`divide-y ${isDark ? 'divide-[#2a3250]' : 'divide-gray-100'}`}>
            {log.map((r, i) => (
              <div key={i} className="px-4 py-3 flex items-start gap-3">
                {r.ok ? <CheckCircle2 size={15} className="text-green-400 flex-shrink-0 mt-0.5" /> : <AlertCircle size={15} className="text-red-400 flex-shrink-0 mt-0.5" />}
                <p className={`text-xs flex-1 ${r.ok ? (isDark ? 'text-green-300' : 'text-green-700') : (isDark ? 'text-red-300' : 'text-red-700')}`}>{r.msg}</p>
                <span className={`text-[10px] flex-shrink-0 ${isDark ? 'text-[#4a5580]' : 'text-gray-400'}`}>{r.ts}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
