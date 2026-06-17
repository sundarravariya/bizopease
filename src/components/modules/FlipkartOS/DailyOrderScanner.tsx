import { useState, useEffect, useRef } from 'react';
import { searchRead, odooCall, createRecord } from '../../../services/odoo';
import { useTheme } from '../../../context/ThemeContext';
import BulkDeleteBar from '../../ui/BulkDeleteBar';
import {
  RefreshCw, Upload, CheckCircle2, AlertCircle,
  ShoppingCart, Search, X,
} from 'lucide-react';

interface Account {
  id: number;
  name: string;
}

interface DailyOrder {
  id: number;
  order_date: string;
  shipment_id: string;
  order_id: string;
  fsn: string;
  sku: string;
  product_id: [number, string] | false;
  quantity: number;
  state: 'draft' | 'processed' | 'cancelled';
  picking_id: [number, string] | false;
  account_id: [number, string] | false;
  selected: boolean;
}

type TabKey = 'draft' | 'processed' | 'cancelled';

function mapOrder(r: any): DailyOrder {
  return {
    id: r.id,
    order_date: r.order_date || '',
    shipment_id: r.shipment_id || '',
    order_id: r.order_id || '',
    fsn: r.fsn || '',
    sku: r.sku || '',
    product_id: r.product_id,
    quantity: r.quantity ?? 0,
    state: r.state ?? 'draft',
    picking_id: r.picking_id,
    account_id: r.account_id,
    selected: false,
  };
}

export default function DailyOrderScanner() {
  const { isDark } = useTheme();
  const fileRef = useRef<HTMLInputElement>(null);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<number | ''>('');
  const [items, setItems] = useState<DailyOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [tab, setTab] = useState<TabKey>('draft');
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    loadAccounts();
  }, []);

  useEffect(() => {
    if (selectedAccountId !== '') syncData();
    else setItems([]);
  }, [selectedAccountId]);

  const loadAccounts = async () => {
    try {
      const r = await searchRead<Account>('flipkart.account', { fields: ['id', 'name'], limit: 0 });
      if (Array.isArray(r)) {
        setAccounts(r);
        if (r.length > 0) setSelectedAccountId(r[0].id);
      }
    } catch (e) {
      console.error('Failed to load accounts', e);
    }
  };

  const syncData = async () => {
    if (selectedAccountId === '') return;
    setLoading(true);
    try {
      const r = await searchRead<any>('flipkart.daily.order', {
        fields: [
          'id', 'order_date', 'shipment_id', 'order_id', 'fsn', 'sku',
          'product_id', 'quantity', 'state', 'picking_id', 'account_id',
        ],
        domain: [['account_id', '=', selectedAccountId]],
        limit: 0,
        order: 'order_date desc',
      });
      if (Array.isArray(r)) setItems(r.map(mapOrder));
    } catch (e) {
      console.error('Odoo sync failed', e);
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || selectedAccountId === '') return;
    setUploading(true);
    setMessage(null);
    try {
      const base64 = await fileToBase64(file);
      const wizardId = await createRecord('flipkart.daily.order.upload', {
        account_id: selectedAccountId,
        file: base64,
        file_name: file.name,
      });
      await odooCall('flipkart.daily.order.upload', 'action_import', [[wizardId]], {});
      setMessage({ type: 'success', text: `File "${file.name}" imported successfully.` });
      await syncData();
    } catch (err: any) {
      setMessage({ type: 'error', text: 'Import failed: ' + (err.message ?? 'Unknown error') });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleProcessSelected = async () => {
    const ids = selected();
    if (ids.length === 0) return;
    setLoading(true);
    setMessage(null);
    try {
      await odooCall('flipkart.daily.order', 'action_process', [ids], {});
      setMessage({ type: 'success', text: `${ids.length} order(s) processed.` });
      await syncData();
    } catch (e: any) {
      setMessage({ type: 'error', text: 'Process failed: ' + (e.message ?? '') });
    } finally {
      setLoading(false);
    }
  };

  const handleReverseSelected = async () => {
    const ids = selected();
    if (ids.length === 0) return;
    setLoading(true);
    setMessage(null);
    try {
      await odooCall('flipkart.daily.order', 'action_reverse', [ids], {});
      setMessage({ type: 'success', text: `${ids.length} order(s) reversed.` });
      await syncData();
    } catch (e: any) {
      setMessage({ type: 'error', text: 'Reverse failed: ' + (e.message ?? '') });
    } finally {
      setLoading(false);
    }
  };

  const selected = () => items.filter(i => i.selected).map(i => i.id);
  const handleSelectAll = (checked: boolean) => setItems(prev => prev.map(i => i.state === tab ? { ...i, selected: checked } : i));
  const handleToggle = (id: number) => setItems(prev => prev.map(i => i.id === id ? { ...i, selected: !i.selected } : i));

  const pendingCount = items.filter(i => i.state === 'draft').length;
  const processedCount = items.filter(i => i.state === 'processed').length;
  const cancelledCount = items.filter(i => i.state === 'cancelled').length;

  const filtered = items
    .filter(i => i.state === tab)
    .filter(i => {
      if (!search) return true;
      const q = search.toLowerCase();
      return i.fsn.toLowerCase().includes(q) || i.order_id.toLowerCase().includes(q) || i.shipment_id.toLowerCase().includes(q);
    });

  const cardBg = isDark ? 'bg-[#161b2e] border-[#2a3250]' : 'bg-white border-gray-200';
  const tableHead = isDark ? 'bg-[#111827]/60 text-[#5a6a8a] border-[#2a3250]' : 'bg-gray-50 text-gray-500 border-gray-200';
  const tableDivide = isDark ? 'divide-[#2a3250]' : 'divide-gray-100';
  const rowHover = isDark ? 'hover:bg-white/[0.03]' : 'hover:bg-gray-50';
  const textMain = isDark ? 'text-white' : 'text-gray-900';
  const textMuted = isDark ? 'text-[#5a6a8a]' : 'text-gray-500';

  return (
    <div className='p-4 max-w-7xl mx-auto space-y-6 animate-fade-in'>
      {/* Header */}
      <div className='flex flex-col md:flex-row md:items-center justify-between gap-4'>
        <div>
          <h1 className={`text-2xl font-black ${textMain}`}>Daily Order Scanner</h1>
          <p className={`text-xs mt-1 ${textMuted}`}>
            Import, track, and process Flipkart daily orders by account.
          </p>
        </div>
        <div className='flex items-center gap-3 flex-wrap'>
          <select
            value={selectedAccountId}
            onChange={e => setSelectedAccountId(Number(e.target.value))}
            className={`input text-xs py-1.5 px-3 ${isDark ? 'bg-[#0f1420] border-[#2a3250] text-white' : ''}`}
          >
            <option value=''>-- Select Account --</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <button
            onClick={syncData}
            disabled={loading || selectedAccountId === ''}
            className='btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5'
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Sync
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading || selectedAccountId === ''}
            className='btn-primary text-xs px-3.5 py-1.5 flex items-center gap-1.5'
          >
            <Upload size={13} className={uploading ? 'animate-bounce' : ''} />
            Upload CSV
          </button>
          <input ref={fileRef} type='file' accept='.csv' className='hidden' onChange={handleUpload} />
        </div>
      </div>

      {/* Message */}
      {message && (
        <div className={`p-3 rounded-xl flex items-start gap-3 border text-sm font-medium ${
          message.type === 'success'
            ? 'bg-green-500/10 border-green-500/20 text-green-400'
            : 'bg-red-500/10 border-red-500/20 text-red-400'
        }`}>
          {message.type === 'success'
            ? <CheckCircle2 size={16} className='flex-shrink-0 mt-0.5' />
            : <AlertCircle size={16} className='flex-shrink-0 mt-0.5' />}
          <span className='flex-1'>{message.text}</span>
          <button onClick={() => setMessage(null)}><X size={14} /></button>
        </div>
      )}

      {/* Stats */}
      <div className='grid grid-cols-3 gap-4'>
        <div className={`card p-4 border rounded-2xl ${cardBg}`}>
          <p className='text-2xl font-black text-amber-400'>{pendingCount}</p>
          <p className={`text-[10px] uppercase tracking-wider font-semibold mt-1 ${textMuted}`}>Pending</p>
        </div>
        <div className={`card p-4 border rounded-2xl ${cardBg}`}>
          <p className='text-2xl font-black text-green-400'>{processedCount}</p>
          <p className={`text-[10px] uppercase tracking-wider font-semibold mt-1 ${textMuted}`}>Processed</p>
        </div>
        <div className={`card p-4 border rounded-2xl ${cardBg}`}>
          <p className='text-2xl font-black text-red-400'>{cancelledCount}</p>
          <p className={`text-[10px] uppercase tracking-wider font-semibold mt-1 ${textMuted}`}>Cancelled</p>
        </div>
      </div>

      {/* Tabs + Search + Bulk actions */}
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div className='flex gap-1'>
          {([
            { key: 'draft', label: 'Pending', count: pendingCount },
            { key: 'processed', label: 'Processed', count: processedCount },
            { key: 'cancelled', label: 'Cancelled', count: cancelledCount },
          ] as { key: TabKey; label: string; count: number }[]).map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`text-xs px-3.5 py-1.5 rounded-lg font-semibold transition-all flex items-center gap-1.5 border ${
                tab === t.key
                  ? 'bg-[#7367f0] text-white border-[#7367f0]'
                  : isDark ? 'border-[#2a3250] text-[#5a6a8a] hover:text-white' : 'border-gray-200 text-gray-500 hover:text-gray-900'
              }`}
            >
              {t.label}
              <span className={`text-[10px] rounded-full px-1.5 py-0.5 font-bold ${tab === t.key ? 'bg-white/20' : isDark ? 'bg-[#2a3250]' : 'bg-gray-100'}`}>
                {t.count}
              </span>
            </button>
          ))}
        </div>
        <div className='flex items-center gap-2'>
          <div className='relative'>
            <Search size={13} className={`absolute left-2.5 top-1/2 -translate-y-1/2 ${textMuted}`} />
            <input
              type='text'
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder='Search FSN / Order ID--'
              className={`input text-xs pl-8 py-1.5 w-52 ${isDark ? 'bg-[#0f1420] border-[#2a3250] text-white' : ''}`}
            />
          </div>
          {selected().length > 0 && tab === 'draft' && (
            <>
              <button onClick={handleProcessSelected} className='btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5'>
                <CheckCircle2 size={12} />
                Process ({selected().length})
              </button>
              <button onClick={handleReverseSelected} className='btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5'>
                <RefreshCw size={12} />
                Reverse
              </button>
            </>
          )}
          {selected().length > 0 && tab === 'processed' && (
            <button onClick={handleReverseSelected} className='btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5'>
              <RefreshCw size={12} />
              Reverse ({selected().length})
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className='flex items-center justify-center py-24'>
          <RefreshCw size={32} className='animate-spin text-[#7367f0]' />
        </div>
      ) : filtered.length === 0 ? (
        <div className='flex flex-col items-center justify-center py-20 gap-3'>
          <ShoppingCart size={40} className='text-[#2a3250]' />
          <p className={`text-sm ${textMuted}`}>No records found. Click Sync or upload data.</p>
        </div>
      ) : (
        <div className={`card border rounded-2xl overflow-hidden ${cardBg}`}>
          <div className='overflow-x-auto'>
            <table className='w-full text-left border-collapse text-sm'>
              <thead>
                <tr className={`border-b text-xs font-semibold uppercase tracking-wider ${tableHead}`}>
                  <th className='py-3 px-4 w-10'>
                    <input
                      type='checkbox'
                      className='rounded'
                      checked={filtered.length > 0 && filtered.every(i => i.selected)}
                      onChange={e => handleSelectAll(e.target.checked)}
                    />
                  </th>
                  <th className='py-3 px-4'>Date</th>
                  <th className='py-3 px-4'>Order ID</th>
                  <th className='py-3 px-4'>Shipment ID</th>
                  <th className='py-3 px-4'>FSN</th>
                  <th className='py-3 px-4'>SKU</th>
                  <th className='py-3 px-4'>Product</th>
                  <th className='py-3 px-4 text-right'>Qty</th>
                  <th className='py-3 px-4 text-center'>State</th>
                  <th className='py-3 px-4'>Picking</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${tableDivide}`}>
                {filtered.map(order => (
                  <tr
                    key={order.id}
                    className={`transition-colors ${rowHover} ${order.selected ? 'bg-[#7367f0]/5' : ''}`}
                  >
                    <td className='py-3 px-4'>
                      <input
                        type='checkbox'
                        className='rounded'
                        checked={order.selected}
                        onChange={() => handleToggle(order.id)}
                      />
                    </td>
                    <td className={`py-3 px-4 text-xs ${textMuted}`}>{order.order_date || '--'}</td>
                    <td className={`py-3 px-4 font-mono text-xs ${textMain}`}>{order.order_id || '--'}</td>
                    <td className={`py-3 px-4 font-mono text-xs ${textMuted}`}>{order.shipment_id || '--'}</td>
                    <td className={`py-3 px-4 text-xs ${textMuted}`}>{order.fsn || '--'}</td>
                    <td className={`py-3 px-4 text-xs ${textMuted}`}>{order.sku || '--'}</td>
                    <td className={`py-3 px-4 text-xs ${textMain}`}>
                      {Array.isArray(order.product_id) ? order.product_id[1] : '--'}
                    </td>
                    <td className={`py-3 px-4 text-right font-medium ${textMain}`}>{order.quantity}</td>
                    <td className='py-3 px-4 text-center'>
                      {order.state === 'draft' && <span className='badge badge-amber'>Pending</span>}
                      {order.state === 'processed' && <span className='badge badge-green'>Processed</span>}
                      {order.state === 'cancelled' && <span className='badge badge-red'>Cancelled</span>}
                    </td>
                    <td className={`py-3 px-4 font-mono text-xs ${textMuted}`}>
                      {Array.isArray(order.picking_id) ? order.picking_id[1] : '--'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Admin bulk delete */}
      <BulkDeleteBar model="flipkart.daily.order" label="order" ids={selected()}
        onClear={() => handleSelectAll(false)}
        onDeleted={() => syncData()} />
    </div>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

