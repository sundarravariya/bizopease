import { useState, useEffect, useRef } from 'react';
import { searchRead, createRecord, writeRecord, odooCall, listInternalUsers } from '../../../services/odoo';
import { useTheme } from '../../../context/ThemeContext';
import { configureQzSecurity } from '../../../utils/qzSign';
import {
  RefreshCw, Plus, Truck, Package, Eye, X,
  CheckCircle2, AlertCircle, Clock, ChevronRight, Upload,
  PackageSearch, Barcode, Printer, Download, Box, Trash2, ExternalLink
} from 'lucide-react';

interface Consignment {
  id: number;
  name: string;
  account: 'robifel' | 'roxxcart';
  warehouse_id: [number, string] | false;
  pickup_date: string;
  state: 'draft' | 'rtd' | 'picked_up' | 'inwarded' | 'rejected';
  line_ids: number[];
  box_ids: number[];
}

interface ConsignmentLine {
  id: number;
  fsn: string;
  sku_id: string;
  product_name: string;
  quantity_sent: number;
  quantity_received: number;
  qty_remaining: number;
  cost_price: number;
  inwarded_to_store: string | false;
  qc_passed: string | false;
  qc_in_progress: string | false;
  qc_fail: string | false;
}

interface BoxRecord {
  id: number;
  name: string;
  length: number;
  breadth: number;
  height: number;
  weight: number;
  line_ids: number[];
}

interface BoxLine {
  id: number;
  sku_id: string;
  fsn: string;
  quantity: number;
  consignment_line_id: [number, string] | false;
}

interface Warehouse {
  id: number;
  name: string;
}

interface BoxEditorRow {
  lineId: number;
  checked: boolean;
  qty: number;
  qtyRemaining: number;
  sku_id: string;
  fsn: string;
  product_name: string;
}

const STATE_LABELS: Record<string, { label: string; cls: string; icon: any }> = {
  draft:     { label: 'Created',    cls: 'badge-gray',   icon: Clock },
  rtd:       { label: 'RTD',        cls: 'badge-violet', icon: Package },
  picked_up: { label: 'Picked Up',  cls: 'badge-amber',  icon: Truck },
  inwarded:  { label: 'Inwarded',   cls: 'badge-green',  icon: CheckCircle2 },
  rejected:  { label: 'Rejected',   cls: 'badge-red',    icon: AlertCircle },
};

const TABS = ['all', 'draft', 'rtd', 'picked_up', 'inwarded', 'rejected'] as const;

export default function ConsignmentManager() {
  const { isDark } = useTheme();
  const [items, setItems] = useState<Consignment[]>([]);
  const [lines, setLines] = useState<ConsignmentLine[]>([]);
  const [boxes, setBoxes] = useState<BoxRecord[]>([]);
  const [boxLines, setBoxLines] = useState<Record<number, BoxLine[]>>({});
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [selected, setSelected] = useState<Consignment | null>(null);
  const [loading, setLoading] = useState(false);
  const [linesLoading, setLinesLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<typeof TABS[number]>('draft');
  const [searchQuery, setSearchQuery] = useState('');
  const [detailTab, setDetailTab] = useState<'lines' | 'boxes'>('lines');
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ account: 'robifel', warehouse_id: 0, pickup_date: new Date().toISOString().slice(0, 10), name: '' });
  // New inline box editor state
  const [showBoxEditor, setShowBoxEditor] = useState(false);
  const [boxEditorForm, setBoxEditorForm] = useState({ name: 'Box 1', length: '', breadth: '', height: '', weight: '' });
  const [boxEditorRows, setBoxEditorRows] = useState<BoxEditorRow[]>([]);
  const [savingBox, setSavingBox] = useState(false);
  const csvRef = useRef<HTMLInputElement>(null);
  // Add-items modal per box
  const [addItemsBoxId, setAddItemsBoxId] = useState<number | null>(null);
  const [pendingLines, setPendingLines] = useState<(ConsignmentLine & { qty_remaining: number })[]>([]);
  const [addLineForm, setAddLineForm] = useState<{ lineId: number | ''; qty: number }>({ lineId: '', qty: 1 });
  const [savingBoxLine, setSavingBoxLine] = useState(false);
  // Direct QZ barcode-label print (mirrors flipkart.qz.print.wizard)
  const [qzOpen, setQzOpen] = useState(false);
  const [qzRows, setQzRows] = useState<{ lineId: number; sku_id: string; fsn: string; selected: boolean; qty: number }[]>([]);
  const [qzPrinting, setQzPrinting] = useState(false);
  // QZ Tray printer selection
  const [qzPrinter, setQzPrinter] = useState(() => localStorage.getItem('qz_printer_name') || '');
  const [showPrinterPicker, setShowPrinterPicker] = useState(false);
  const [availablePrinters, setAvailablePrinters] = useState<string[]>([]);
  const [loadingPrinters, setLoadingPrinters] = useState(false);

  useEffect(() => { sync(); loadWarehouses(); }, []);

  const showMsg = (ok: boolean, msg: string) => {
    setToast({ ok, msg });
    setTimeout(() => setToast(null), 3500);
  };

  const sync = async () => {
    setLoading(true);
    try {
      const r = await searchRead<Consignment>('flipkart.consignment', {
        fields: ['id', 'name', 'account', 'warehouse_id', 'pickup_date', 'state', 'line_ids', 'box_ids'],
        limit: 0,
        order: 'id desc',
      });
      if (Array.isArray(r)) setItems(r);
    } catch (e: any) {
      showMsg(false, e?.message || 'Failed to load consignments');
    } finally {
      setLoading(false);
    }
  };

  const loadWarehouses = async () => {
    try {
      const r = await searchRead<Warehouse>('stock.warehouse', { fields: ['id', 'name'], limit: 20 });
      if (Array.isArray(r)) setWarehouses(r);
    } catch { /* silent */ }
  };

  const openDetail = async (c: Consignment) => {
    setSelected(c);
    setDetailTab('lines');
    setLinesLoading(true);
    setLines([]);
    setBoxes([]);
    setBoxLines({});
    try {
      const [linesRes, boxesRes] = await Promise.all([
        searchRead<ConsignmentLine>('flipkart.consignment.line', {
          domain: [['consignment_id', '=', c.id]],
          fields: ['id', 'fsn', 'sku_id', 'product_name', 'quantity_sent', 'quantity_received', 'qty_remaining', 'cost_price', 'inwarded_to_store', 'qc_passed', 'qc_in_progress', 'qc_fail'],
          limit: 0,
        }),
        searchRead<BoxRecord>('flipkart.box', {
          domain: [['consignment_id', '=', c.id]],
          fields: ['id', 'name', 'length', 'breadth', 'height', 'weight', 'line_ids'],
          limit: 0,
        }),
      ]);
      if (Array.isArray(linesRes)) setLines(linesRes);
      if (Array.isArray(boxesRes)) {
        setBoxes(boxesRes);
        // Load lines for each box
        const allBoxIds = boxesRes.map(b => b.id);
        if (allBoxIds.length > 0) {
          const bl = await searchRead<BoxLine>('flipkart.box.line', {
            domain: [['box_id', 'in', allBoxIds]],
            fields: ['id', 'box_id', 'sku_id', 'fsn', 'quantity', 'consignment_line_id'],
            limit: 0,
          });
          const grouped: Record<number, BoxLine[]> = {};
          for (const line of (bl || [])) {
            const bid = (line as any).box_id?.[0] ?? (line as any).box_id;
            if (!grouped[bid]) grouped[bid] = [];
            grouped[bid].push(line);
          }
          setBoxLines(grouped);
        }
      }
    } catch { setLines([]); } finally { setLinesLoading(false); }
  };

  const doStateAction = async (id: number, method: string) => {
    try {
      await odooCall('flipkart.consignment', method, [[id]], {});
      showMsg(true, 'State updated successfully');
      await sync();
      // Re-fetch current consignment data
      const updated = await searchRead<Consignment>('flipkart.consignment', {
        domain: [['id', '=', id]],
        fields: ['id', 'name', 'account', 'warehouse_id', 'pickup_date', 'state', 'line_ids', 'box_ids'],
        limit: 1,
      });
      if (Array.isArray(updated) && updated.length > 0) setSelected(updated[0]);
    } catch (e: any) {
      showMsg(false, e?.message || 'Action failed');
    }
  };

  const handleActionUrl = (result: any) => {
    if (!result) return;
    if (result.type === 'ir.actions.act_url' && result.url) {
      window.open(result.url, '_blank');
    } else if (result.type === 'ir.actions.client' && result.params?.attachment_id) {
      window.open('/web/content/' + result.params.attachment_id + '?download=true', '_blank');
    }
  };

  const getQz = () => (window as any).qz;

  const connectQz = async () => {
    const qz = getQz();
    if (!qz) throw new Error('QZ Tray not detected. Please install and start QZ Tray on this computer.');
    // Signed requests via our self-signed cert (see utils/qzSign) so QZ Tray can
    // permanently "Remember" the site / run silently once the cert is trusted.
    configureQzSecurity(qz);
    if (!qz.websocket.isActive()) {
      await qz.websocket.connect();
    }
  };

  const loadPrinters = async () => {
    setLoadingPrinters(true);
    try {
      await connectQz();
      const list = await getQz().printers.find();
      setAvailablePrinters(Array.isArray(list) ? list : [list]);
      setShowPrinterPicker(true);
    } catch (e: any) {
      showMsg(false, e?.message || 'Cannot connect to QZ Tray');
    } finally {
      setLoadingPrinters(false);
    }
  };

  const getAttachmentIdFromResult = (result: any): number | null => {
    if (result?.type === 'ir.actions.client' && result?.params?.attachment_id)
      return result.params.attachment_id;
    if (result?.type === 'ir.actions.act_url' && result?.url) {
      const m = result.url.match(/\/web\/content\/(\d+)/);
      if (m) return parseInt(m[1]);
    }
    return null;
  };

  const printTsplViaQz = async (result: any) => {
    const attachmentId = getAttachmentIdFromResult(result);
    if (!attachmentId) throw new Error('No print data attachment in server response');
    if (!qzPrinter) throw new Error('No printer selected. Click "Set Printer" first.');
    const records = await searchRead<{ datas: string }>('ir.attachment', {
      domain: [['id', '=', attachmentId]],
      fields: ['datas'],
      limit: 1,
    });
    if (!records.length || !records[0].datas) throw new Error('Print data not found on server');
    const tsplContent = atob(records[0].datas);
    await connectQz();
    const qz = getQz();
    const config = qz.configs.create(qzPrinter);
    await qz.print(config, [{ type: 'raw', format: 'plain', data: tsplContent }]);
  };

  const handleGenerateBarcodes = async (id: number) => {
    try {
      const result = await odooCall<any>('flipkart.consignment', 'action_generate_barcodes', [[id]], {});
      handleActionUrl(result);
      showMsg(true, 'Barcode PDF generated — downloading…');
    } catch (e: any) { showMsg(false, e?.message || 'Failed'); }
  };

  const handlePrintAllBoxSlips = async (id: number) => {
    try {
      const result = await odooCall<any>('flipkart.consignment', 'action_print_all_box_packing_slips_qz', [[id]], {});
      await printTsplViaQz(result);
      showMsg(true, `All box packing slips sent to ${qzPrinter}`);
    } catch (e: any) { showMsg(false, e?.message || 'Failed'); }
  };

  const openQzPrint = () => {
    setQzRows(lines.map(l => ({
      lineId: l.id,
      sku_id: l.sku_id || '',
      fsn: l.fsn || '',
      selected: true,
      qty: l.quantity_sent ?? 0,
    })));
    setQzOpen(true);
  };

  const handlePrintDirectQz = async () => {
    if (!selected) return;
    const chosen = qzRows.filter(r => r.selected && r.qty > 0);
    if (chosen.length === 0) { showMsg(false, 'Select at least one product with quantity greater than zero'); return; }
    setQzPrinting(true);
    try {
      const wizardId = await createRecord('flipkart.qz.print.wizard', {
        consignment_id: selected.id,
        select_all: false,
        line_ids: chosen.map(r => [0, 0, {
          consignment_line_id: r.lineId,
          selected: true,
          quantity: r.qty,
        }]),
      });
      const result = await odooCall<any>('flipkart.qz.print.wizard', 'action_print_qz', [[wizardId]], {});
      await printTsplViaQz(result);
      showMsg(true, `Barcode labels sent to ${qzPrinter}`);
      setQzOpen(false);
    } catch (e: any) {
      showMsg(false, e?.message || 'QZ print failed');
    } finally {
      setQzPrinting(false);
    }
  };

  const handlePrintBoxSlip = async (boxId: number) => {
    try {
      const result = await odooCall<any>('flipkart.box', 'action_print_packing_slip', [[boxId]], {});
      handleActionUrl(result);
      showMsg(true, 'Packing slip PDF downloading…');
    } catch (e: any) { showMsg(false, e?.message || 'Failed'); }
  };

  const openBoxEditor = () => {
    // Build rows from lines already in state, filtered to qty_remaining > 0
    const pending = lines.filter(l => (l.qty_remaining ?? 0) > 0);
    setBoxEditorRows(pending.map(l => ({
      lineId: l.id,
      checked: true,
      qty: l.qty_remaining,
      qtyRemaining: l.qty_remaining,
      sku_id: l.sku_id || '',
      fsn: l.fsn || '',
      product_name: l.product_name || '',
    })));
    const nextName = `Box ${boxes.length + 1}`;
    setBoxEditorForm({ name: nextName, length: '', breadth: '', height: '', weight: '' });
    setShowBoxEditor(true);
  };

  const handleCreateBoxWithLines = async () => {
    if (!selected || !boxEditorForm.name.trim()) return;
    setSavingBox(true);
    let boxId: number | null = null;
    try {
      boxId = await createRecord('flipkart.box', {
        name: boxEditorForm.name.trim(),
        consignment_id: selected.id,
        length: parseFloat(boxEditorForm.length) || 0,
        breadth: parseFloat(boxEditorForm.breadth) || 0,
        height: parseFloat(boxEditorForm.height) || 0,
        weight: parseFloat(boxEditorForm.weight) || 0,
      });
    } catch (e: any) {
      showMsg(false, e?.message || 'Create box failed');
      setSavingBox(false);
      return;
    }
    // Create box lines for each checked row with qty > 0
    let lineErrors = 0;
    const checkedRows = boxEditorRows.filter(r => r.checked && r.qty > 0);
    for (const row of checkedRows) {
      try {
        await createRecord('flipkart.box.line', {
          box_id: boxId,
          consignment_line_id: row.lineId,
          quantity: row.qty,
        });
      } catch (e: any) {
        lineErrors++;
        showMsg(false, `${row.sku_id || 'Line'}: ${e?.message || 'Add line failed'}`);
      }
    }
    if (lineErrors === 0) {
      showMsg(true, `Box "${boxEditorForm.name.trim()}" created with ${checkedRows.length} line(s)`);
    } else {
      showMsg(false, `Box created but ${lineErrors} line(s) failed -- check constraints`);
    }
    setShowBoxEditor(false);
    setSavingBox(false);
    await openDetail(selected);
  };

  const handlePrintBoxSlipQz = async (boxId: number) => {
    try {
      const result = await odooCall<any>('flipkart.box', 'action_print_packing_slip_qz', [[boxId]], {});
      await printTsplViaQz(result);
      showMsg(true, `Packing slip sent to ${qzPrinter}`);
    } catch (e: any) { showMsg(false, e?.message || 'Failed'); }
  };

  const handleAddAllPending = async (boxId: number) => {
    try {
      await odooCall('flipkart.box', 'action_add_all_pending', [[boxId]], {});
      showMsg(true, 'All pending items added to box.');
      if (selected) await openDetail(selected);
    } catch (e: any) { showMsg(false, e?.message || 'Add pending failed'); }
  };

  const openAddItems = async (boxId: number) => {
    if (!selected) return;
    setAddItemsBoxId(boxId);
    setAddLineForm({ lineId: '', qty: 1 });
    try {
      const r = await searchRead<ConsignmentLine & { qty_remaining: number }>('flipkart.consignment.line', {
        domain: [['consignment_id', '=', selected.id], ['qty_remaining', '>', 0]],
        fields: ['id', 'product_name', 'fsn', 'sku_id', 'qty_remaining'],
        limit: 0,
      });
      setPendingLines(Array.isArray(r) ? r : []);
    } catch { setPendingLines([]); }
  };

  const handleAddBoxLine = async () => {
    if (!addItemsBoxId || !addLineForm.lineId) return;
    setSavingBoxLine(true);
    try {
      await createRecord('flipkart.box.line', {
        box_id: addItemsBoxId,
        consignment_line_id: addLineForm.lineId,
        quantity: addLineForm.qty,
      });
      showMsg(true, 'Item added to box.');
      setAddLineForm({ lineId: '', qty: 1 });
      if (selected) await openDetail(selected);
    } catch (e: any) { showMsg(false, e?.message || 'Add item failed'); }
    finally { setSavingBoxLine(false); }
  };

  const handleDeleteBox = async (boxId: number) => {
    if (!confirm('Delete this box?')) return;
    try {
      await odooCall('flipkart.box', 'unlink', [[boxId]], {});
      showMsg(true, 'Box deleted');
      if (selected) await openDetail(selected);
    } catch (e: any) { showMsg(false, e?.message || 'Delete failed'); }
  };

  const handleUploadCSV = async (e: React.ChangeEvent<HTMLInputElement>, cId: number) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const b64 = (reader.result as string).split(',')[1];
      try {
        await writeRecord('flipkart.consignment', [cId], { csv_file: b64, csv_file_name: file.name });
        await odooCall('flipkart.consignment', 'action_parse_csv', [[cId]], {});
        showMsg(true, 'CSV parsed and lines loaded');
        if (selected?.id === cId) await openDetail(selected!);
        await sync();
      } catch (err: any) { showMsg(false, err?.message || 'CSV parse failed'); }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const packDeadline = (pickupDate: string): string => {
    const d = new Date(pickupDate);
    d.setDate(d.getDate() - 2);
    if (d.getDay() === 0) d.setDate(d.getDate() - 1); // skip Sunday
    return d.toISOString().slice(0, 10);
  };

  const autoCreatePackingTasks = async (consName: string, account: string, pickupDate: string) => {
    if (!pickupDate || !consName) return;
    try {
      const employees = await listInternalUsers();
      if (!employees.length) return;
      const deadline = packDeadline(pickupDate);
      const accountLabel = account === 'robifel' ? 'Robifel' : 'Roxxcart';
      const taskName = `Pack consignment ${accountLabel} - ${consName}`;
      await Promise.all(
        employees.map(emp =>
          createRecord('robifel.task', {
            name: taskName,
            category: 'packing',
            priority: '2',
            task_date: deadline,
            deadline: deadline + ' 17:00:00',
            assignee_id: emp.id,
            points: 20,
          }).catch(() => {})
        )
      );
    } catch { /* non-fatal */ }
  };

  const doCreate = async () => {
    if (!form.name || !form.warehouse_id || !form.account) {
      showMsg(false, 'Please fill all required fields');
      return;
    }
    setCreating(true);
    try {
      await createRecord('flipkart.consignment', {
        name: form.name,
        account: form.account,
        warehouse_id: form.warehouse_id,
        pickup_date: form.pickup_date,
      });
      showMsg(true, 'Consignment created — packing tasks assigned');
      setShowCreate(false);
      autoCreatePackingTasks(form.name, form.account, form.pickup_date);
      await sync();
    } catch (e: any) {
      showMsg(false, e?.message || 'Create failed');
    } finally {
      setCreating(false);
    }
  };

  const searchLower = searchQuery.trim().toLowerCase();
  const filtered = items
    .filter(c => {
      const matchTab = activeTab === 'all' || c.state === activeTab;
      if (!matchTab) return false;
      if (!searchLower) return true;
      const warehouseName = Array.isArray(c.warehouse_id) ? c.warehouse_id[1].toLowerCase() : '';
      return (
        c.name.toLowerCase().includes(searchLower) ||
        c.account.toLowerCase().includes(searchLower) ||
        warehouseName.includes(searchLower)
      );
    })
    .sort((a, b) => {
      // Primary: account alphabetically (robifel before roxxcart)
      if (a.account < b.account) return -1;
      if (a.account > b.account) return 1;
      // Secondary: pickup_date ascending
      return (a.pickup_date || '').localeCompare(b.pickup_date || '');
    });

  // Group sorted filtered list by account
  const groupedFiltered = filtered.reduce<{ account: string; items: Consignment[] }[]>((groups, c) => {
    const last = groups[groups.length - 1];
    if (last && last.account === c.account) {
      last.items.push(c);
    } else {
      groups.push({ account: c.account, items: [c] });
    }
    return groups;
  }, []);

  const tabCounts = TABS.reduce((acc, t) => {
    acc[t] = t === 'all' ? items.length : items.filter(c => c.state === t).length;
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
          <h1 className={`text-xl font-black ${isDark ? 'text-white' : 'text-gray-900'}`}>Consignment Manager</h1>
          <p className={`text-xs mt-0.5 ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>
            {items.length} total · {items.filter(c => c.state === 'draft').length} created · {items.filter(c => c.state === 'picked_up').length} in transit
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={sync} disabled={loading} className="btn-secondary text-xs px-3 py-2">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Sync
          </button>
          <button onClick={() => setShowCreate(true)} className="btn-primary text-xs px-3 py-2">
            <Plus size={13} /> New Consignment
          </button>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {(['draft','rtd','picked_up','inwarded','rejected'] as const).map(s => {
          const cnt = items.filter(c => c.state === s).length;
          const meta = STATE_LABELS[s];
          return (
            <button key={s} onClick={() => setActiveTab(s)}
              className={`card p-3 text-left transition-all ${activeTab === s ? 'ring-2 ring-[#7367f0]' : ''}`}>
              <p className={`text-lg font-black ${isDark ? 'text-white' : 'text-gray-900'}`}>{cnt}</p>
              <span className={`badge text-[10px] mt-1 ${meta.cls}`}>{meta.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tabs */}
      <div className={`flex gap-1 border-b ${isDark ? 'border-[#2a3250]' : 'border-gray-200'}`}>
        {TABS.map(t => (
          <button key={t} onClick={() => setActiveTab(t)}
            className={`px-3 py-2 text-xs font-semibold capitalize border-b-2 transition-all ${activeTab === t
              ? 'border-[#7367f0] text-[#7367f0]'
              : `border-transparent ${isDark ? 'text-[#6a7a9a] hover:text-white' : 'text-gray-500 hover:text-gray-900'}`}`}>
            {t === 'all' ? 'All' : STATE_LABELS[t].label} {tabCounts[t] > 0 ? `(${tabCounts[t]})` : ''}
          </button>
        ))}
      </div>

      {/* Search bar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <PackageSearch size={14} className={`absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`} />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search by name, account, warehouse..."
            className={`input pl-8 pr-8 text-xs py-2 w-full ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white placeholder-[#5a6a8a]' : 'placeholder-gray-400'}`}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className={`absolute right-2.5 top-1/2 -translate-y-1/2 ${isDark ? 'text-[#5a6a8a] hover:text-white' : 'text-gray-400 hover:text-gray-700'}`}
            >
              <X size={13} />
            </button>
          )}
        </div>
        {searchQuery && (
          <span className={`text-xs ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>
            {filtered.length} result{filtered.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* List */}
      {loading ? (
        <div className="card h-48 flex items-center justify-center gap-3">
          <RefreshCw size={18} className="animate-spin text-[#7367f0]" />
          <span className={`text-sm ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>Loading...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-20 gap-3">
          <PackageSearch size={40} className="text-[#2a3250]" />
          <p className={`text-sm ${isDark ? 'text-[#5a6a8a]' : 'text-gray-500'}`}>No consignments found. Click New Consignment to create one.</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="data-table w-full">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Account</th>
                  <th>Warehouse</th>
                  <th>Pickup Date</th>
                  <th className="text-center">Lines</th>
                  <th className="text-center">State</th>
                  <th className="text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {groupedFiltered.map(group => (
                  <>
                    <tr key={`grp-${group.account}`}>
                      <td colSpan={7} className={`px-4 py-2 text-[10px] font-bold uppercase tracking-widest ${isDark ? 'bg-[#1e2440] text-[#7367f0]' : 'bg-gray-50 text-indigo-600'}`}>
                        {group.account === 'robifel' ? 'Robifel' : 'Roxxcart'} ({group.items.length})
                      </td>
                    </tr>
                    {group.items.map(c => {
                      const meta = STATE_LABELS[c.state] || STATE_LABELS.draft;
                      return (
                        <tr key={c.id} className="cursor-pointer hover:bg-[#7367f0]/5" onClick={() => openDetail(c)}>
                          <td className="font-semibold text-[#7367f0] font-mono text-xs">{c.name}</td>
                          <td>
                            <span className={`badge ${c.account === 'robifel' ? 'badge-violet' : 'badge-amber'}`}>
                              {c.account === 'robifel' ? 'Robifel' : 'Roxxcart'}
                            </span>
                          </td>
                          <td className={`text-xs ${isDark ? 'text-[#8897b5]' : 'text-gray-600'}`}>
                            {Array.isArray(c.warehouse_id) ? c.warehouse_id[1] : '—'}
                          </td>
                          <td className={`text-xs ${isDark ? 'text-[#8897b5]' : 'text-gray-600'}`}>
                            {c.pickup_date || '—'}
                          </td>
                          <td className="text-center">
                            <span className={`text-xs font-semibold ${isDark ? 'text-[#8897b5]' : 'text-gray-600'}`}>
                              {c.line_ids?.length || 0}
                            </span>
                          </td>
                          <td className="text-center" onClick={e => e.stopPropagation()}>
                            <span className={`badge ${meta.cls}`}>{meta.label}</span>
                          </td>
                          <td className="text-center" onClick={e => e.stopPropagation()}>
                            <div className="flex items-center justify-center gap-1">
                              {c.state === 'draft' && (
                                <button onClick={() => doStateAction(c.id, 'action_mark_rtd')}
                                  className="btn-primary text-[10px] px-2 py-1">Mark RTD</button>
                              )}
                              {c.state === 'rtd' && (
                                <button onClick={() => doStateAction(c.id, 'action_mark_picked_up')}
                                  className="btn-primary text-[10px] px-2 py-1">Picked Up</button>
                              )}
                              {c.state === 'picked_up' && (
                                <button onClick={() => doStateAction(c.id, 'action_mark_inwarded')}
                                  className="btn-primary text-[10px] px-2 py-1">Inward</button>
                              )}
                              {c.state !== 'inwarded' && c.state !== 'rejected' && (
                                <button onClick={() => doStateAction(c.id, 'action_mark_rejected')}
                                  className="btn-secondary text-[10px] px-2 py-1 text-red-400 border-red-400/30">Reject</button>
                              )}
                              <button onClick={() => openDetail(c)}
                                className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-white/5 text-[#5a6a8a]' : 'hover:bg-gray-100 text-gray-400'}`}>
                                <Eye size={13} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Detail Drawer */}
      {selected && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/50 backdrop-blur-sm" onClick={() => setSelected(null)} />
          <div className={`w-full max-w-3xl h-full overflow-y-auto shadow-2xl flex flex-col ${isDark ? 'bg-[#12172a] border-l border-[#2a3250]' : 'bg-white border-l border-gray-200'}`}>
            {/* Header */}
            <div className={`px-5 py-4 border-b ${isDark ? 'border-[#2a3250]' : 'border-gray-100'}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className={`font-bold text-lg ${isDark ? 'text-white' : 'text-gray-900'}`}>{selected.name}</p>
                  <p className={`text-xs mt-0.5 ${isDark ? 'text-[#5a6a8a]' : 'text-gray-500'}`}>
                    {selected.account === 'robifel' ? 'Robifel' : 'Roxxcart'} · {STATE_LABELS[selected.state]?.label}
                  </p>
                </div>
                <button onClick={() => setSelected(null)} className={`p-2 rounded-xl ${isDark ? 'hover:bg-white/5' : 'hover:bg-gray-100'}`}>
                  <X size={18} className={isDark ? 'text-gray-400' : 'text-gray-500'} />
                </button>
              </div>
              {/* Action buttons */}
              <div className="flex flex-wrap gap-2 mt-3">
                {selected.state === 'draft' && (
                  <>
                    <button onClick={() => doStateAction(selected.id, 'action_mark_rtd')} className="btn-primary text-xs px-3 py-1.5">Mark RTD</button>
                    <button onClick={() => csvRef.current?.click()} className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5">
                      <Upload size={12} /> Upload CSV
                    </button>
                    <input ref={csvRef} type="file" accept=".csv" className="hidden" onChange={e => handleUploadCSV(e, selected.id)} />
                  </>
                )}
                {selected.state === 'rtd' && (
                  <button onClick={() => doStateAction(selected.id, 'action_mark_picked_up')} className="btn-primary text-xs px-3 py-1.5">Mark Picked Up</button>
                )}
                {selected.state === 'picked_up' && (
                  <button onClick={() => doStateAction(selected.id, 'action_mark_inwarded')} className="btn-primary text-xs px-3 py-1.5">Mark Inwarded</button>
                )}
                {selected.state !== 'inwarded' && selected.state !== 'rejected' && (
                  <button onClick={() => doStateAction(selected.id, 'action_mark_rejected')} className="btn-secondary text-xs px-3 py-1.5 text-red-400">Reject</button>
                )}
                <button onClick={() => handleGenerateBarcodes(selected.id)} className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5 text-violet-400">
                  <Download size={12} /> Barcode Labels
                </button>
                <button onClick={loadPrinters} disabled={loadingPrinters} title={qzPrinter ? `Printer: ${qzPrinter}` : 'No printer set — click to select'}
                  className={`btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5 ${qzPrinter ? 'text-amber-400' : 'text-red-400'}`}>
                  {loadingPrinters ? <RefreshCw size={12} className="animate-spin" /> : <Printer size={12} />}
                  {qzPrinter ? qzPrinter.slice(0, 16) : 'Set Printer'}
                </button>
                {lines.length > 0 && (
                  <button onClick={openQzPrint} className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5 text-emerald-400">
                    <Printer size={12} /> Print Direct (QZ)
                  </button>
                )}
                {boxes.length > 0 && (
                  <button onClick={() => handlePrintAllBoxSlips(selected.id)} className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5 text-cyan-400">
                    <Printer size={12} /> All Box Slips
                  </button>
                )}
              </div>
            </div>

            {/* Info grid */}
            <div className="p-5">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                {[
                  ['Account', selected.account === 'robifel' ? 'Robifel' : 'Roxxcart'],
                  ['Warehouse', Array.isArray(selected.warehouse_id) ? selected.warehouse_id[1] : '—'],
                  ['Pickup Date', selected.pickup_date || '—'],
                  ['State', STATE_LABELS[selected.state]?.label || selected.state],
                ].map(([k, v]) => (
                  <div key={k} className={`p-3 rounded-xl ${isDark ? 'bg-[#1e2440]' : 'bg-gray-50'}`}>
                    <p className={`text-[10px] font-semibold uppercase tracking-wider ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>{k}</p>
                    <p className={`text-sm font-semibold mt-0.5 ${isDark ? 'text-white' : 'text-gray-900'}`}>{v}</p>
                  </div>
                ))}
              </div>

              {/* Tabs: Lines / Boxes */}
              <div className={`flex gap-1 border-b mb-4 ${isDark ? 'border-[#2a3250]' : 'border-gray-200'}`}>
                {(['lines', 'boxes'] as const).map(t => (
                  <button key={t} onClick={() => setDetailTab(t)}
                    className={`px-4 py-2 text-xs font-semibold capitalize border-b-2 transition-all ${detailTab === t ? 'border-[#7367f0] text-[#7367f0]' : `border-transparent ${isDark ? 'text-[#6a7a9a] hover:text-white' : 'text-gray-500'}`}`}>
                    {t === 'lines' ? `Lines (${lines.length})` : `Boxes (${boxes.length})`}
                  </button>
                ))}
              </div>

              {linesLoading ? (
                <div className="flex items-center gap-2 py-8 justify-center">
                  <RefreshCw size={16} className="animate-spin text-[#7367f0]" />
                  <span className={`text-sm ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>Loading...</span>
                </div>
              ) : detailTab === 'lines' ? (
                lines.length === 0 ? (
                  <div className="flex flex-col items-center py-10 gap-2">
                    <Package size={32} className="text-[#2a3250]" />
                    <p className={`text-sm ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>No lines — upload a CSV first.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="data-table w-full min-w-[900px]">
                      <thead><tr>
                        <th>FSN</th><th>SKU</th><th>Product</th>
                        <th className="text-right">Sent</th><th className="text-right">Rcvd</th>
                        <th className="text-center">Inwarded</th>
                        <th className="text-center">QC Pass</th>
                        <th className="text-center">QC In Prog</th>
                        <th className="text-center">QC Fail</th>
                        <th className="text-right">Cost</th>
                      </tr></thead>
                      <tbody>
                        {lines.map(l => (
                          <tr key={l.id}>
                            <td className="font-mono text-xs text-[#7367f0]">
                              {l.fsn ? (
                                <a href={`https://www.flipkart.com/product/p/itme?pid=${l.fsn}`} target="_blank" rel="noopener noreferrer"
                                  className="hover:underline" title="Open on Flipkart">{l.fsn}</a>
                              ) : '—'}
                            </td>
                            <td className={`text-xs ${isDark ? 'text-[#8897b5]' : 'text-gray-600'}`}>
                              {l.fsn && l.sku_id ? (
                                <a href={`https://www.flipkart.com/product/p/itme?pid=${l.fsn}`} target="_blank" rel="noopener noreferrer"
                                  className="text-[#7367f0] hover:underline" title="Open on Flipkart">{l.sku_id}</a>
                              ) : (l.sku_id || '—')}
                            </td>
                            <td className={`text-xs ${isDark ? 'text-white' : 'text-gray-900'}`}>
                              {l.fsn && l.product_name ? (
                                <a href={`https://www.flipkart.com/product/p/itme?pid=${l.fsn}`} target="_blank" rel="noopener noreferrer"
                                  className="inline-flex items-start gap-1 hover:underline hover:text-[#7367f0]" title="Open on Flipkart">
                                  <span>{l.product_name}</span>
                                  <ExternalLink size={10} className="opacity-50 mt-0.5 flex-shrink-0" />
                                </a>
                              ) : (l.product_name || '—')}
                            </td>
                            <td className={`text-right font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>{l.quantity_sent}</td>
                            <td className={`text-right ${isDark ? 'text-[#8897b5]' : 'text-gray-600'}`}>{l.quantity_received || 0}</td>
                            <td className="text-center">
                              {l.inwarded_to_store && l.inwarded_to_store !== '0' && l.inwarded_to_store !== 'false'
                                ? <span className="badge badge-green text-[10px]">{l.inwarded_to_store}</span>
                                : <span className={`text-xs ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>--</span>}
                            </td>
                            <td className="text-center">
                              {l.qc_passed && l.qc_passed !== '0' && l.qc_passed !== 'false'
                                ? <span className="badge badge-green text-[10px]">{l.qc_passed}</span>
                                : <span className={`text-xs ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>--</span>}
                            </td>
                            <td className="text-center">
                              {l.qc_in_progress && l.qc_in_progress !== '0' && l.qc_in_progress !== 'false'
                                ? <span className="badge badge-amber text-[10px]">{l.qc_in_progress}</span>
                                : <span className={`text-xs ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>--</span>}
                            </td>
                            <td className="text-center">
                              {l.qc_fail && l.qc_fail !== '0' && l.qc_fail !== 'false'
                                ? <span className="badge badge-red text-[10px]">{l.qc_fail}</span>
                                : <span className={`text-xs ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>--</span>}
                            </td>
                            <td className={`text-right text-xs ${isDark ? 'text-[#8897b5]' : 'text-gray-600'}`}>
                              {l.cost_price ? `Rs.${l.cost_price.toLocaleString('en-IN')}` : '--'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              ) : (
                /* Boxes tab */
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>{boxes.length} box(es)</span>
                    {!showBoxEditor && (
                      <button onClick={openBoxEditor} className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5">
                        <Plus size={12} /> New Box
                      </button>
                    )}
                  </div>

                  {/* Inline New Box Editor */}
                  {showBoxEditor && (() => {
                    const allChecked = boxEditorRows.length > 0 && boxEditorRows.every(r => r.checked);
                    const anyChecked = boxEditorRows.some(r => r.checked);
                    const totalUnits = boxEditorRows.filter(r => r.checked).reduce((s, r) => s + r.qty, 0);
                    return (
                      <div className={`rounded-xl border space-y-4 p-4 ${isDark ? 'border-[#7367f0]/40 bg-[#1e2440]/60' : 'border-violet-200 bg-violet-50/40'}`}>
                        <p className={`text-xs font-bold uppercase tracking-wider ${isDark ? 'text-[#7367f0]' : 'text-violet-700'}`}>New Box</p>

                        {/* Box header fields */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          <div className="col-span-2 sm:col-span-1">
                            <label className={`text-[10px] font-semibold block mb-1 ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>Box Name *</label>
                            <input
                              value={boxEditorForm.name}
                              onChange={e => setBoxEditorForm(f => ({ ...f, name: e.target.value }))}
                              className={`input text-xs py-1.5 w-full ${isDark ? 'bg-[#161b2e] border-[#2a3250] text-white' : ''}`}
                            />
                          </div>
                          <div>
                            <label className={`text-[10px] font-semibold block mb-1 ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>Length (cm)</label>
                            <input type="number" step="0.1" placeholder="0"
                              value={boxEditorForm.length}
                              onChange={e => setBoxEditorForm(f => ({ ...f, length: e.target.value }))}
                              className={`input text-xs py-1.5 w-full ${isDark ? 'bg-[#161b2e] border-[#2a3250] text-white' : ''}`}
                            />
                          </div>
                          <div>
                            <label className={`text-[10px] font-semibold block mb-1 ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>Breadth (cm)</label>
                            <input type="number" step="0.1" placeholder="0"
                              value={boxEditorForm.breadth}
                              onChange={e => setBoxEditorForm(f => ({ ...f, breadth: e.target.value }))}
                              className={`input text-xs py-1.5 w-full ${isDark ? 'bg-[#161b2e] border-[#2a3250] text-white' : ''}`}
                            />
                          </div>
                          <div>
                            <label className={`text-[10px] font-semibold block mb-1 ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>Height (cm)</label>
                            <input type="number" step="0.1" placeholder="0"
                              value={boxEditorForm.height}
                              onChange={e => setBoxEditorForm(f => ({ ...f, height: e.target.value }))}
                              className={`input text-xs py-1.5 w-full ${isDark ? 'bg-[#161b2e] border-[#2a3250] text-white' : ''}`}
                            />
                          </div>
                          <div>
                            <label className={`text-[10px] font-semibold block mb-1 ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>Weight (kg)</label>
                            <input type="number" step="0.1" placeholder="0"
                              value={boxEditorForm.weight}
                              onChange={e => setBoxEditorForm(f => ({ ...f, weight: e.target.value }))}
                              className={`input text-xs py-1.5 w-full ${isDark ? 'bg-[#161b2e] border-[#2a3250] text-white' : ''}`}
                            />
                          </div>
                        </div>

                        {/* Products table */}
                        {boxEditorRows.length === 0 ? (
                          <p className={`text-xs text-center py-3 ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>
                            No pending items -- all SKUs are fully allocated.
                          </p>
                        ) : (
                          <div className={`rounded-lg border overflow-x-auto ${isDark ? 'border-[#2a3250]' : 'border-gray-200'}`}>
                            <table className="data-table w-full text-xs">
                              <thead>
                                <tr>
                                  <th className="w-8 text-center">
                                    {/* Select all / none toggle */}
                                    <input
                                      type="checkbox"
                                      checked={allChecked}
                                      onChange={e => {
                                        const val = e.target.checked;
                                        setBoxEditorRows(rows => rows.map(r => ({ ...r, checked: val })));
                                      }}
                                      className="accent-[#7367f0] cursor-pointer"
                                      title={allChecked ? 'Deselect all' : 'Select all'}
                                    />
                                  </th>
                                  <th>Product / SKU</th>
                                  <th>FSN</th>
                                  <th className="text-right">Rem.</th>
                                  <th className="text-right w-24">Qty in Box</th>
                                </tr>
                              </thead>
                              <tbody>
                                {boxEditorRows.map((row, idx) => (
                                  <tr key={row.lineId} className={!row.checked ? 'opacity-40' : ''}>
                                    <td className="text-center">
                                      <input
                                        type="checkbox"
                                        checked={row.checked}
                                        onChange={e => {
                                          const val = e.target.checked;
                                          setBoxEditorRows(rows => rows.map((r, i) => i === idx ? { ...r, checked: val } : r));
                                        }}
                                        className="accent-[#7367f0] cursor-pointer"
                                      />
                                    </td>
                                    <td>
                                      <p className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>{row.product_name || row.sku_id || '—'}</p>
                                      {row.sku_id && row.product_name && (
                                        <p className={`text-[10px] ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>{row.sku_id}</p>
                                      )}
                                    </td>
                                    <td className={`font-mono text-[#7367f0]`}>{row.fsn || '—'}</td>
                                    <td className={`text-right ${isDark ? 'text-[#8897b5]' : 'text-gray-500'}`}>{row.qtyRemaining}</td>
                                    <td className="text-right">
                                      <input
                                        type="number"
                                        min={1}
                                        max={row.qtyRemaining}
                                        value={row.qty}
                                        disabled={!row.checked}
                                        onChange={e => {
                                          let v = parseInt(e.target.value, 10);
                                          if (isNaN(v) || v < 1) v = 1;
                                          if (v > row.qtyRemaining) v = row.qtyRemaining;
                                          setBoxEditorRows(rows => rows.map((r, i) => i === idx ? { ...r, qty: v } : r));
                                        }}
                                        className={`input text-xs py-1 text-right w-20 ${isDark ? 'bg-[#161b2e] border-[#2a3250] text-white' : ''} disabled:opacity-40`}
                                      />
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}

                        {/* Footer: total + actions */}
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <p className={`text-xs ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>
                            {boxEditorRows.filter(r => r.checked).length} SKU(s) selected -- {totalUnits} unit(s) total
                          </p>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => setShowBoxEditor(false)}
                              className="btn-secondary text-xs px-3 py-1.5"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              disabled={savingBox || !boxEditorForm.name.trim() || (!anyChecked && boxEditorRows.length > 0)}
                              onClick={handleCreateBoxWithLines}
                              className="btn-primary text-xs px-4 py-1.5 flex items-center gap-1.5"
                            >
                              {savingBox ? <RefreshCw size={12} className="animate-spin" /> : <Box size={12} />}
                              Create Box
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                  {boxes.length === 0 ? (
                    <div className="flex flex-col items-center py-10 gap-2">
                      <Box size={32} className="text-[#2a3250]" />
                      <p className={`text-sm ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>No boxes yet. Create boxes to generate packing slips.</p>
                    </div>
                  ) : (
                    boxes.map(box => (
                      <div key={box.id} className={`rounded-xl border ${isDark ? 'border-[#2a3250] bg-[#161b2e]' : 'border-gray-200'}`}>
                        <div className="flex items-center justify-between px-4 py-2.5">
                          <div>
                            <span className={`font-semibold text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>{box.name}</span>
                            {(box.length || box.weight) ? (
                              <span className={`text-xs ml-2 ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>
                                {box.length}×{box.breadth}×{box.height}cm · {box.weight}kg
                              </span>
                            ) : null}
                            <span className={`text-xs ml-2 ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>
                              ({(boxLines[box.id] || []).length} SKUs)
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <button onClick={() => openAddItems(box.id)} className="btn-secondary text-[10px] px-2 py-1 flex items-center gap-1 text-violet-400">
                              <Plus size={11} /> Add Items
                            </button>
                            <button onClick={() => handleAddAllPending(box.id)} className="btn-secondary text-[10px] px-2 py-1 flex items-center gap-1 text-[#7367f0]">
                              <Package size={11} /> Add All Pending
                            </button>
                            <button onClick={() => handlePrintBoxSlip(box.id)} className="btn-secondary text-[10px] px-2 py-1 flex items-center gap-1 text-cyan-400">
                              <Printer size={11} /> PDF Slip
                            </button>
                            <button onClick={() => handlePrintBoxSlipQz(box.id)} className="btn-secondary text-[10px] px-2 py-1 flex items-center gap-1 text-green-400">
                              <Printer size={11} /> QZ/TSC
                            </button>
                            <button onClick={() => handleDeleteBox(box.id)} className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-red-500/10 text-[#5a6a8a] hover:text-red-400' : 'text-gray-400 hover:text-red-500'}`}>
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                        {(boxLines[box.id] || []).length > 0 && (
                          <div className={`border-t overflow-x-auto ${isDark ? 'border-[#2a3250]' : 'border-gray-200'}`}>
                            <table className="data-table w-full text-xs">
                              <thead><tr><th>SKU</th><th>FSN</th><th className="text-right">Qty</th></tr></thead>
                              <tbody>
                                {(boxLines[box.id] || []).map(bl => (
                                  <tr key={bl.id}>
                                    <td className={isDark ? 'text-[#8897b5]' : 'text-gray-600'}>
                                      {bl.fsn ? (
                                        <a href={`https://www.flipkart.com/product/p/itme?pid=${bl.fsn}`} target="_blank" rel="noopener noreferrer"
                                          className="inline-flex items-center gap-1 text-[#7367f0] hover:underline" title="Open on Flipkart">
                                          {bl.sku_id || bl.fsn} <ExternalLink size={10} className="opacity-60" />
                                        </a>
                                      ) : (bl.sku_id || '—')}
                                    </td>
                                    <td className="font-mono text-[#7367f0]">
                                      {bl.fsn ? (
                                        <a href={`https://www.flipkart.com/product/p/itme?pid=${bl.fsn}`} target="_blank" rel="noopener noreferrer"
                                          className="hover:underline" title="Open on Flipkart">{bl.fsn}</a>
                                      ) : '—'}
                                    </td>
                                    <td className={`text-right font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>{bl.quantity}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add Items to Box Modal */}
      {addItemsBoxId !== null && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className={`w-full max-w-sm rounded-2xl shadow-2xl ${isDark ? 'bg-[#12172a] border border-[#2a3250]' : 'bg-white'}`}>
            <div className={`flex items-center justify-between px-5 py-4 border-b ${isDark ? 'border-[#2a3250]' : 'border-gray-100'}`}>
              <h3 className={`font-bold text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>Add Item to Box</h3>
              <button onClick={() => setAddItemsBoxId(null)} className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-white/5' : 'hover:bg-gray-100'}`}>
                <X size={16} className={isDark ? 'text-gray-400' : 'text-gray-500'} />
              </button>
            </div>
            <div className="p-5 space-y-3">
              {pendingLines.length === 0 ? (
                <p className={`text-sm text-center py-4 ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>No pending lines with remaining quantity.</p>
              ) : (<>
                <div>
                  <label className={`text-[10px] font-semibold block mb-1 ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>Consignment Line</label>
                  <select value={addLineForm.lineId} onChange={e => setAddLineForm(f => ({ ...f, lineId: Number(e.target.value) }))}
                    className={`input text-xs py-2 w-full ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`}>
                    <option value="">— Select Line —</option>
                    {pendingLines.map(l => (
                      <option key={l.id} value={l.id}>{l.product_name || l.fsn || l.sku_id} (rem: {l.qty_remaining})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={`text-[10px] font-semibold block mb-1 ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>Quantity</label>
                  <input type="number" min="1"
                    value={addLineForm.qty} onChange={e => setAddLineForm(f => ({ ...f, qty: Number(e.target.value) }))}
                    className={`input text-xs py-2 w-full ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`} />
                </div>
                <button onClick={handleAddBoxLine} disabled={savingBoxLine || !addLineForm.lineId}
                  className="btn-primary w-full text-xs py-2.5 flex items-center justify-center gap-2">
                  {savingBoxLine ? <RefreshCw size={13} className="animate-spin" /> : <Plus size={13} />} Add to Box
                </button>
              </>)}
            </div>
          </div>
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className={`w-full max-w-md rounded-2xl shadow-2xl ${isDark ? 'bg-[#12172a] border border-[#2a3250]' : 'bg-white'}`}>
            <div className={`flex items-center justify-between px-5 py-4 border-b ${isDark ? 'border-[#2a3250]' : 'border-gray-100'}`}>
              <h3 className={`font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>New Consignment</h3>
              <button onClick={() => setShowCreate(false)} className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-white/5 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}>
                <X size={16} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="label">Consignment Name / Number *</label>
                <input className={`input ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`}
                  value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. CSG/2025/0001" />
              </div>
              <div>
                <label className="label">Account *</label>
                <select className={`input ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`}
                  value={form.account} onChange={e => setForm(f => ({ ...f, account: e.target.value }))}>
                  <option value="robifel">Robifel</option>
                  <option value="roxxcart">Roxxcart</option>
                </select>
              </div>
              <div>
                <label className="label">Warehouse *</label>
                <select className={`input ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`}
                  value={form.warehouse_id} onChange={e => setForm(f => ({ ...f, warehouse_id: Number(e.target.value) }))}>
                  <option value={0}>Select warehouse...</option>
                  {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Pickup Date *</label>
                <input type="date" className={`input ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`}
                  value={form.pickup_date} onChange={e => setForm(f => ({ ...f, pickup_date: e.target.value }))} />
              </div>
            </div>
            <div className={`flex justify-end gap-2 px-5 pb-5`}>
              <button onClick={() => setShowCreate(false)} className="btn-secondary text-xs px-4 py-2">Cancel</button>
              <button onClick={doCreate} disabled={creating} className="btn-primary text-xs px-4 py-2">
                {creating ? <RefreshCw size={13} className="animate-spin" /> : <Plus size={13} />}
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Print Direct (QZ) -- barcode label selection */}
      {qzOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in" onClick={() => !qzPrinting && setQzOpen(false)}>
          <div
            className={`w-full max-w-2xl rounded-2xl border shadow-2xl overflow-hidden flex flex-col max-h-[90vh] ${isDark ? 'bg-[#1e2440] border-[#2a3250]' : 'bg-white border-gray-200'}`}
            onClick={e => e.stopPropagation()}
          >
            <div className={`flex items-center justify-between px-5 py-4 border-b ${isDark ? 'border-[#2a3250]' : 'border-gray-100'}`}>
              <div className="flex items-center gap-2">
                <Printer size={16} className="text-emerald-400" />
                <div>
                  <h3 className={`font-black text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>Print Direct (QZ)</h3>
                  <p className={`text-[10px] ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>Select products and quantities for direct barcode-label printing.</p>
                </div>
              </div>
              <button onClick={() => !qzPrinting && setQzOpen(false)} className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-white/5 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}>
                <X size={16} />
              </button>
            </div>

            <div className="px-5 py-3 flex items-center gap-2 border-b border-dashed border-[#2a3250]/50">
              <button
                onClick={() => {
                  const allOn = qzRows.every(r => r.selected);
                  setQzRows(rows => rows.map(r => ({ ...r, selected: !allOn })));
                }}
                className="btn-secondary text-[11px] px-2.5 py-1"
              >
                {qzRows.every(r => r.selected) ? 'Deselect All' : 'Select All'}
              </button>
              <span className={`text-[11px] ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>
                {qzRows.filter(r => r.selected && r.qty > 0).length} of {qzRows.length} selected
              </span>
            </div>

            <div className="overflow-y-auto flex-1">
              <table className="w-full text-left">
                <thead className="sticky top-0">
                  <tr className={`text-[10px] font-semibold uppercase tracking-wider ${isDark ? 'bg-[#161b2e] text-[#5a6a8a]' : 'bg-gray-50 text-gray-500'}`}>
                    <th className="py-2.5 px-5 w-10">Print</th>
                    <th className="py-2.5 px-3">SKU</th>
                    <th className="py-2.5 px-3">FSN</th>
                    <th className="py-2.5 px-5 text-right w-24">Qty</th>
                  </tr>
                </thead>
                <tbody className={`divide-y text-xs ${isDark ? 'divide-[#2a3250] text-gray-300' : 'divide-gray-100 text-gray-700'}`}>
                  {qzRows.map((r, idx) => (
                    <tr key={r.lineId} className={r.selected ? '' : 'opacity-50'}>
                      <td className="py-2.5 px-5">
                        <input
                          type="checkbox"
                          className="rounded"
                          checked={r.selected}
                          onChange={() => setQzRows(rows => rows.map((x, i) => i === idx ? { ...x, selected: !x.selected } : x))}
                        />
                      </td>
                      <td className="py-2.5 px-3 font-medium">{r.sku_id || '--'}</td>
                      <td className="py-2.5 px-3 font-mono text-[#7367f0]">{r.fsn || '--'}</td>
                      <td className="py-2.5 px-5 text-right">
                        <input
                          type="number"
                          min={0}
                          value={r.qty}
                          onChange={e => {
                            const v = parseInt(e.target.value) || 0;
                            setQzRows(rows => rows.map((x, i) => i === idx ? { ...x, qty: v } : x));
                          }}
                          className={`w-20 px-2 py-1 text-xs text-right rounded-lg border outline-none ${isDark ? 'bg-[#12172a] border-[#2a3250] text-white' : 'bg-gray-50 border-gray-200 text-gray-900'}`}
                        />
                      </td>
                    </tr>
                  ))}
                  {qzRows.length === 0 && (
                    <tr><td colSpan={4} className="py-8 text-center text-xs text-gray-500">No consignment lines to print.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className={`p-4 border-t flex justify-end gap-2 ${isDark ? 'border-[#2a3250] bg-black/20' : 'border-gray-100 bg-gray-50'}`}>
              <button onClick={() => setQzOpen(false)} disabled={qzPrinting} className="btn-secondary text-xs px-4 py-2">Cancel</button>
              <button onClick={handlePrintDirectQz} disabled={qzPrinting} className="btn-primary text-xs px-4 py-2 flex items-center gap-1.5">
                {qzPrinting ? <RefreshCw size={13} className="animate-spin" /> : <Printer size={13} />} Print Direct (QZ)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* QZ Printer Picker */}
      {showPrinterPicker && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className={`w-full max-w-sm rounded-2xl border shadow-2xl ${isDark ? 'bg-[#161b2e] border-[#2a3250]' : 'bg-white border-gray-200'}`}>
            <div className={`flex items-center justify-between px-4 py-3 border-b ${isDark ? 'border-[#2a3250]' : 'border-gray-100'}`}>
              <div>
                <h3 className={`font-bold text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>Select QZ Printer</h3>
                <p className={`text-xs mt-0.5 ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>Choose the label/thermal printer to print to</p>
              </div>
              <button onClick={() => setShowPrinterPicker(false)} className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-white/5 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}>
                <X size={16} />
              </button>
            </div>
            <div className="p-3 space-y-1.5 max-h-64 overflow-y-auto">
              {availablePrinters.length === 0 ? (
                <p className={`text-sm text-center py-6 ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>No printers found.</p>
              ) : availablePrinters.map(p => (
                <button key={p}
                  onClick={() => { setQzPrinter(p); localStorage.setItem('qz_printer_name', p); setShowPrinterPicker(false); showMsg(true, `Printer set to: ${p}`); }}
                  className={`w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${p === qzPrinter ? 'bg-[#7367f0] text-white' : isDark ? 'hover:bg-white/5 text-white' : 'hover:bg-gray-50 text-gray-800'}`}>
                  <Printer size={13} className="inline mr-2 opacity-60" />{p}
                </button>
              ))}
            </div>
            <div className={`px-4 py-3 border-t ${isDark ? 'border-[#2a3250]' : 'border-gray-100'}`}>
              <p className={`text-[11px] ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>
                {qzPrinter ? `Current: ${qzPrinter}` : 'No printer selected yet — pick one above'}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
