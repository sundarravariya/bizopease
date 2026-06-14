import React, { useState, useEffect, useCallback, useDeferredValue } from 'react';
import { useTheme } from '../../../context/ThemeContext';
import { searchRead, createRecord, writeRecord, odooCall } from '../../../services/odoo';
import {
  RefreshCw, Plus, Users, DollarSign, Truck, X,
  ClipboardList, Search, ChevronRight, Inbox, CheckCircle2
} from 'lucide-react';

// ---- Interfaces ----------------------------------------------------------------------------------------------------------------------------

interface BillVendor {
  id: number;
  name: string;
  phone: string;
  deduction_percent: number;
  balance: number;
  notes: string;
}

interface BillTransaction {
  id: number;
  name: string;
  date: string;
  transfer_amount: number;
  deduction_amount: number;
  payment_received: boolean;
  actual_cash_received: number;
  expected_cash_amount: number;
  agent_payment_source: string;
  agent_payment_amount: number;
  note: string;
}

interface MoneyAssociate {
  id: number;
  name: string;
  phone: string;
  balance: number;
  notes: string;
}

interface AssociateLedger {
  id: number;
  date: string;
  entry_type: string;
  amount: number;
  reference: string;
  note: string;
}

interface CarryingAgent {
  id: number;
  name: string;
  contact_details: string;
  outstanding_balance: number;
}

interface AgentLedger {
  id: number;
  date: string;
  entry_type: string;
  amount_inr: number;
  reference: string;
  notes: string;
}

interface UnifiedSummary {
  id: number;
  party_type: string;
  party_name: string;
  debit: number;
  credit: number;
  balance: number;
}

interface UnifiedLine {
  id: number;
  date: string;
  party_name: string;
  entry_type: string;
  reference: string;
  details: string;
  debit: number;
  credit: number;
  balance: number;
}

// ---- Helpers ------------------------------------------------------------------------------------------------------------------------------------

const fmt = (n: number) => `Rs.${Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

function BalanceCell({ value }: { value: number }) {
  const cls = value > 0 ? 'text-green-400' : value < 0 ? 'text-red-400' : 'text-gray-400';
  return <span className={`font-bold ${cls}`}>{fmt(value)}</span>;
}

function EmptyState({ message = 'No records found' }: { message?: string }) {
  const { isDark } = useTheme();
  return (
    <div className='flex flex-col items-center justify-center py-16 gap-3'>
      <Inbox size={40} className={isDark ? 'text-[#2a3250]' : 'text-gray-300'} />
      <p className={`text-sm ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>{message}</p>
    </div>
  );
}

// ---- Add Transaction Modal (Vendors) ------------------------------------------------------------------------------------

interface AddTxnModalProps {
  vendor: BillVendor;
  onClose: () => void;
  onSaved: () => void;
}

function AddVendorTxnModal({ vendor, onClose, onSaved }: AddTxnModalProps) {
  const { isDark } = useTheme();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    date: new Date().toISOString().split('T')[0],
    name: '',
    transfer_amount: '',
    payment_received: false,
    actual_cash_received: '',
    note: '',
  });

  const transferAmt = parseFloat(form.transfer_amount) || 0;
  const deductionAmt = +(transferAmt * (vendor.deduction_percent / 100)).toFixed(2);

  const inp = (field: string, value: string | boolean) => setForm(f => ({ ...f, [field]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await createRecord('flipkart.bill.payment.transaction', {
        vendor_id: vendor.id,
        date: form.date,
        name: form.name,
        transfer_amount: transferAmt,
        deduction_amount: deductionAmt,
        payment_received: form.payment_received,
        actual_cash_received: parseFloat(form.actual_cash_received) || 0,
        note: form.note,
      });
      onSaved();
      onClose();
    } catch {
      // error silently -- let parent handle refresh
    } finally {
      setSaving(false);
    }
  };

  const base = isDark ? 'bg-[#12172a] border-[#2a3250] text-white' : '';

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in' onClick={onClose}>
      <div className={`w-full max-w-md rounded-2xl border shadow-2xl overflow-hidden ${isDark ? 'bg-[#1e2440] border-[#2a3250]' : 'bg-white border-gray-200'}`} onClick={e => e.stopPropagation()}>
        <div className={`flex items-center justify-between px-5 py-4 border-b ${isDark ? 'border-[#2a3250]' : 'border-gray-100'}`}>
          <div>
            <h3 className={`font-bold text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>Add Transaction</h3>
            <p className={`text-xs mt-0.5 ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>{vendor.name}</p>
          </div>
          <button onClick={onClose} className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-white/5 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className='p-5 space-y-4'>
          <div className='grid grid-cols-2 gap-3'>
            <div>
              <label className='label text-[#5a6a8a]'>Date</label>
              <input type='date' required value={form.date} onChange={e => inp('date', e.target.value)} className={`input ${base}`} />
            </div>
            <div>
              <label className='label text-[#5a6a8a]'>Reference</label>
              <input type='text' required value={form.name} onChange={e => inp('name', e.target.value)} placeholder='REF-001' className={`input ${base}`} />
            </div>
          </div>
          <div>
            <label className='label text-[#5a6a8a]'>Transfer Amount (--)</label>
            <input type='number' required min='0.01' step='0.01' value={form.transfer_amount} onChange={e => inp('transfer_amount', e.target.value)} className={`input ${base}`} />
          </div>
          <div className={`p-3 rounded-xl border text-xs flex justify-between ${isDark ? 'bg-[#12172a] border-[#2a3250]' : 'bg-gray-50 border-gray-200'}`}>
            <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>Auto-deduction ({vendor.deduction_percent}%)</span>
            <span className='font-bold text-amber-400'>{fmt(deductionAmt)}</span>
          </div>
          <div>
            <label className='label text-[#5a6a8a]'>Actual Cash Received (--)</label>
            <input type='number' min='0' step='0.01' value={form.actual_cash_received} onChange={e => inp('actual_cash_received', e.target.value)} className={`input ${base}`} />
          </div>
          <label className='flex items-center gap-2 cursor-pointer'>
            <input type='checkbox' checked={form.payment_received} onChange={e => inp('payment_received', e.target.checked)} className='w-4 h-4 rounded accent-[#7367f0]' />
            <span className={`text-xs font-semibold ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>Payment Received</span>
          </label>
          <div>
            <label className='label text-[#5a6a8a]'>Note</label>
            <textarea rows={2} value={form.note} onChange={e => inp('note', e.target.value)} className={`input resize-none ${base}`} />
          </div>
          <div className='flex gap-2 pt-1'>
            <button type='button' onClick={onClose} className='btn-secondary flex-1 justify-center text-xs py-2.5'>Cancel</button>
            <button type='submit' disabled={saving} className='btn-primary flex-1 justify-center text-xs py-2.5'>
              {saving ? <RefreshCw size={13} className='animate-spin' /> : <Plus size={13} />} Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---- Add Ledger Entry Modal (Associates) ----------------------------------------------------------------------------

interface AddAssocEntryProps {
  associate: MoneyAssociate;
  onClose: () => void;
  onSaved: () => void;
}

function AddAssocEntryModal({ associate, onClose, onSaved }: AddAssocEntryProps) {
  const { isDark } = useTheme();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ date: new Date().toISOString().split('T')[0], entry_type: 'cash_received', amount: '', reference: '', note: '' });
  const inp = (f: string, v: string) => setForm(p => ({ ...p, [f]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await createRecord('flipkart.associate.ledger', {
        associate_id: associate.id,
        date: form.date,
        entry_type: form.entry_type,
        amount: parseFloat(form.amount),
        reference: form.reference,
        note: form.note,
      });
      onSaved(); onClose();
    } catch { } finally { setSaving(false); }
  };

  const base = isDark ? 'bg-[#12172a] border-[#2a3250] text-white' : '';
  const entryTypes = ['cash_received', 'transfer_in', 'agent_payment', 'expense', 'transfer_out'];

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in' onClick={onClose}>
      <div className={`w-full max-w-md rounded-2xl border shadow-2xl overflow-hidden ${isDark ? 'bg-[#1e2440] border-[#2a3250]' : 'bg-white border-gray-200'}`} onClick={e => e.stopPropagation()}>
        <div className={`flex items-center justify-between px-5 py-4 border-b ${isDark ? 'border-[#2a3250]' : 'border-gray-100'}`}>
          <div>
            <h3 className={`font-bold text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>Add Ledger Entry</h3>
            <p className={`text-xs mt-0.5 ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>{associate.name}</p>
          </div>
          <button onClick={onClose} className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-white/5 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className='p-5 space-y-4'>
          <div className='grid grid-cols-2 gap-3'>
            <div>
              <label className='label text-[#5a6a8a]'>Date</label>
              <input type='date' required value={form.date} onChange={e => inp('date', e.target.value)} className={`input ${base}`} />
            </div>
            <div>
              <label className='label text-[#5a6a8a]'>Entry Type</label>
              <select value={form.entry_type} onChange={e => inp('entry_type', e.target.value)} className={`input ${base}`}>
                {entryTypes.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className='label text-[#5a6a8a]'>Amount (--)</label>
            <input type='number' required min='0.01' step='0.01' value={form.amount} onChange={e => inp('amount', e.target.value)} className={`input ${base}`} />
          </div>
          <div>
            <label className='label text-[#5a6a8a]'>Reference</label>
            <input type='text' value={form.reference} onChange={e => inp('reference', e.target.value)} className={`input ${base}`} />
          </div>
          <div>
            <label className='label text-[#5a6a8a]'>Note</label>
            <textarea rows={2} value={form.note} onChange={e => inp('note', e.target.value)} className={`input resize-none ${base}`} />
          </div>
          <div className='flex gap-2 pt-1'>
            <button type='button' onClick={onClose} className='btn-secondary flex-1 justify-center text-xs py-2.5'>Cancel</button>
            <button type='submit' disabled={saving} className='btn-primary flex-1 justify-center text-xs py-2.5'>
              {saving ? <RefreshCw size={13} className='animate-spin' /> : <Plus size={13} />} Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---- Add Ledger Entry Modal (Agents) ------------------------------------------------------------------------------------

interface AddAgentEntryProps {
  agent: CarryingAgent;
  onClose: () => void;
  onSaved: () => void;
}

function AddAgentEntryModal({ agent, onClose, onSaved }: AddAgentEntryProps) {
  const { isDark } = useTheme();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ date: new Date().toISOString().split('T')[0], entry_type: 'bill', amount_inr: '', reference: '', notes: '' });
  const inp = (f: string, v: string) => setForm(p => ({ ...p, [f]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await createRecord('flipkart.agent.ledger', {
        agent_id: agent.id,
        date: form.date,
        entry_type: form.entry_type,
        amount_inr: parseFloat(form.amount_inr),
        reference: form.reference,
        notes: form.notes,
      });
      onSaved(); onClose();
    } catch { } finally { setSaving(false); }
  };

  const base = isDark ? 'bg-[#12172a] border-[#2a3250] text-white' : '';

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in' onClick={onClose}>
      <div className={`w-full max-w-md rounded-2xl border shadow-2xl overflow-hidden ${isDark ? 'bg-[#1e2440] border-[#2a3250]' : 'bg-white border-gray-200'}`} onClick={e => e.stopPropagation()}>
        <div className={`flex items-center justify-between px-5 py-4 border-b ${isDark ? 'border-[#2a3250]' : 'border-gray-100'}`}>
          <div>
            <h3 className={`font-bold text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>Add Agent Entry</h3>
            <p className={`text-xs mt-0.5 ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>{agent.name}</p>
          </div>
          <button onClick={onClose} className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-white/5 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className='p-5 space-y-4'>
          <div className='grid grid-cols-2 gap-3'>
            <div>
              <label className='label text-[#5a6a8a]'>Date</label>
              <input type='date' required value={form.date} onChange={e => inp('date', e.target.value)} className={`input ${base}`} />
            </div>
            <div>
              <label className='label text-[#5a6a8a]'>Entry Type</label>
              <select value={form.entry_type} onChange={e => inp('entry_type', e.target.value)} className={`input ${base}`}>
                <option value='bill'>Bill (+)</option>
                <option value='payment'>Payment (-)</option>
                <option value='adjustment'>Adjustment</option>
              </select>
            </div>
          </div>
          <div>
            <label className='label text-[#5a6a8a]'>Amount (--)</label>
            <input type='number' required min='0.01' step='0.01' value={form.amount_inr} onChange={e => inp('amount_inr', e.target.value)} className={`input ${base}`} />
          </div>
          <div>
            <label className='label text-[#5a6a8a]'>Reference</label>
            <input type='text' value={form.reference} onChange={e => inp('reference', e.target.value)} className={`input ${base}`} />
          </div>
          <div>
            <label className='label text-[#5a6a8a]'>Notes</label>
            <textarea rows={2} value={form.notes} onChange={e => inp('notes', e.target.value)} className={`input resize-none ${base}`} />
          </div>
          <div className='flex gap-2 pt-1'>
            <button type='button' onClick={onClose} className='btn-secondary flex-1 justify-center text-xs py-2.5'>Cancel</button>
            <button type='submit' disabled={saving} className='btn-primary flex-1 justify-center text-xs py-2.5'>
              {saving ? <RefreshCw size={13} className='animate-spin' /> : <Plus size={13} />} Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---- Unified Ledger Drill-Down Modal --------------------------------------------------------------------------------------

interface UnifiedDrillProps {
  row: UnifiedSummary;
  onClose: () => void;
}

function UnifiedDrillModal({ row, onClose }: UnifiedDrillProps) {
  const { isDark } = useTheme();
  const [lines, setLines] = useState<UnifiedLine[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await searchRead<UnifiedLine>('flipkart.unified.ledger.line', {
          domain: [['party_type', '=', row.party_type], ['party_name', '=', row.party_name]],
          fields: ['id', 'date', 'party_name', 'entry_type', 'reference', 'details', 'debit', 'credit', 'balance'],
          order: 'date desc',
          limit: 0,
        });
        setLines(res || []);
      } catch { setLines([]); } finally { setLoading(false); }
    })();
  }, [row]);

  const th = `py-3 px-4 text-xs font-semibold uppercase tracking-wider ${isDark ? 'text-gray-400' : 'text-gray-500'}`;

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in' onClick={onClose}>
      <div className={`w-full max-w-4xl rounded-2xl border shadow-2xl flex flex-col max-h-[85vh] overflow-hidden ${isDark ? 'bg-[#161b2e] border-[#2a3250]' : 'bg-white border-gray-200'}`} onClick={e => e.stopPropagation()}>
        <div className={`flex items-center justify-between px-5 py-4 border-b ${isDark ? 'border-[#2a3250]' : 'border-gray-100'}`}>
          <div>
            <h3 className={`font-bold text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>{row.party_name}</h3>
            <p className={`text-xs mt-0.5 capitalize ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>{row.party_type} -- Ledger Detail</p>
          </div>
          <button onClick={onClose} className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-white/5 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}><X size={16} /></button>
        </div>
        <div className='overflow-y-auto'>
          {loading ? (
            <div className='h-40 flex items-center justify-center'>
              <RefreshCw size={20} className='animate-spin text-[#7367f0]' />
            </div>
          ) : lines.length === 0 ? (
            <EmptyState />
          ) : (
            <table className='w-full text-left border-collapse'>
              <thead className={`border-b sticky top-0 ${isDark ? 'border-white/5 bg-[#161b2e]' : 'border-gray-100 bg-white'}`}>
                <tr>
                  <th className={th}>Date</th>
                  <th className={th}>Entry Type</th>
                  <th className={th}>Reference</th>
                  <th className={th}>Details</th>
                  <th className={`${th} text-right`}>Debit</th>
                  <th className={`${th} text-right`}>Credit</th>
                  <th className={`${th} text-right`}>Balance</th>
                </tr>
              </thead>
              <tbody className={`divide-y text-xs ${isDark ? 'divide-white/5' : 'divide-gray-100'}`}>
                {lines.map(l => (
                  <tr key={l.id} className={isDark ? 'hover:bg-white/5' : 'hover:bg-gray-50'}>
                    <td className='py-3 px-4 font-mono'>{l.date}</td>
                    <td className='py-3 px-4 capitalize'>{l.entry_type}</td>
                    <td className='py-3 px-4'>{l.reference || '--'}</td>
                    <td className='py-3 px-4'>{l.details || '--'}</td>
                    <td className='py-3 px-4 text-right text-red-400 font-bold'>{l.debit > 0 ? fmt(l.debit) : '--'}</td>
                    <td className='py-3 px-4 text-right text-green-400 font-bold'>{l.credit > 0 ? fmt(l.credit) : '--'}</td>
                    <td className='py-3 px-4 text-right'><BalanceCell value={l.balance} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Receive Payment Modal (vendor transaction) -----------------------------------------------------------------------

interface ReceivePaymentModalProps {
  txn: BillTransaction;
  onClose: () => void;
  onSaved: () => void;
}

function ReceivePaymentModal({ txn, onClose, onSaved }: ReceivePaymentModalProps) {
  const { isDark } = useTheme();
  const [amount, setAmount] = useState(String(txn.expected_cash_amount || txn.transfer_amount || ''));
  const [saving, setSaving] = useState(false);
  const base = isDark ? 'bg-[#12172a] border-[#2a3250] text-white' : '';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const wId = await createRecord('flipkart.bill.payment.entry.wizard', {
        entry_type: 'receive_payment',
        transaction_id: txn.id,
        cash_received: parseFloat(amount) || 0,
      });
      await odooCall('flipkart.bill.payment.entry.wizard', 'action_post', [[wId]], {});
      onSaved();
      onClose();
    } catch {
      await writeRecord('flipkart.bill.payment.transaction', [txn.id], {
        actual_cash_received: parseFloat(amount) || 0,
        payment_received: true,
      });
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className='fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in' onClick={onClose}>
      <div className={`w-full max-w-sm rounded-2xl border shadow-2xl ${isDark ? 'bg-[#1e2440] border-[#2a3250]' : 'bg-white border-gray-200'}`} onClick={e => e.stopPropagation()}>
        <div className={`flex items-center justify-between px-5 py-4 border-b ${isDark ? 'border-[#2a3250]' : 'border-gray-100'}`}>
          <div>
            <h3 className={`font-bold text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>Receive Payment</h3>
            <p className={`text-xs mt-0.5 ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>{txn.name}</p>
          </div>
          <button onClick={onClose} className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-white/5 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className='p-5 space-y-4'>
          <div>
            <label className='label text-[#5a6a8a]'>Cash Received (₹)</label>
            <input type='number' required min='0.01' step='0.01' value={amount}
              onChange={e => setAmount(e.target.value)} className={`input ${base}`} autoFocus />
          </div>
          <div className='flex gap-2 pt-1'>
            <button type='button' onClick={onClose} className='btn-secondary flex-1 justify-center text-xs py-2.5'>Cancel</button>
            <button type='submit' disabled={saving} className='btn-primary flex-1 justify-center text-xs py-2.5'>
              {saving ? <RefreshCw size={13} className='animate-spin' /> : <CheckCircle2 size={13} />} Mark Received
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---- Right-Side Drawer ------------------------------------------------------------------------------------------------------------------

interface DrawerProps {
  title: string;
  subtitle: string;
  onClose: () => void;
  onAddEntry: () => void;
  children: React.ReactNode;
  loading: boolean;
}

function Drawer({ title, subtitle, onClose, onAddEntry, children, loading }: DrawerProps) {
  const { isDark } = useTheme();
  return (
    <div className='fixed inset-0 z-40 flex justify-end' onClick={onClose}>
      <div className={`w-full max-w-xl h-full flex flex-col border-l shadow-2xl overflow-hidden ${isDark ? 'bg-[#161b2e] border-[#2a3250]' : 'bg-white border-gray-200'}`} onClick={e => e.stopPropagation()}>
        <div className={`flex items-center justify-between px-5 py-4 border-b ${isDark ? 'border-[#2a3250]' : 'border-gray-100'}`}>
          <div>
            <h3 className={`font-bold text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>{title}</h3>
            <p className={`text-xs mt-0.5 ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>{subtitle}</p>
          </div>
          <div className='flex gap-2'>
            <button onClick={onAddEntry} className='btn-primary text-xs px-3 py-1.5'><Plus size={12} /> Add Entry</button>
            <button onClick={onClose} className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-white/5 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}><X size={16} /></button>
          </div>
        </div>
        <div className='flex-1 overflow-y-auto'>
          {loading ? (
            <div className='h-40 flex items-center justify-center'>
              <RefreshCw size={18} className='animate-spin text-[#7367f0]' />
            </div>
          ) : children}
        </div>
      </div>
    </div>
  );
}

// ---- Main Component ------------------------------------------------------------------------------------------------------------------------

type ActiveTab = 'vendors' | 'associates' | 'agents' | 'unified';

export default function SettlementsConsole() {
  const { isDark } = useTheme();
  const [tab, setTab] = useState<ActiveTab>('vendors');
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [loading, setLoading] = useState(false);

  // Tab 1: Vendors
  const [vendors, setVendors] = useState<BillVendor[]>([]);
  const [selectedVendor, setSelectedVendor] = useState<BillVendor | null>(null);
  const [vendorTxns, setVendorTxns] = useState<BillTransaction[]>([]);
  const [txnsLoading, setTxnsLoading] = useState(false);
  const [addVendorTxn, setAddVendorTxn] = useState(false);
  const [receiveTxn, setReceiveTxn] = useState<BillTransaction | null>(null);

  // Tab 2: Associates
  const [associates, setAssociates] = useState<MoneyAssociate[]>([]);
  const [selectedAssoc, setSelectedAssoc] = useState<MoneyAssociate | null>(null);
  const [assocLedger, setAssocLedger] = useState<AssociateLedger[]>([]);
  const [assocLoading, setAssocLoading] = useState(false);
  const [addAssocEntry, setAddAssocEntry] = useState(false);

  // Tab 3: Agents
  const [agents, setAgents] = useState<CarryingAgent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<CarryingAgent | null>(null);
  const [agentLedger, setAgentLedger] = useState<AgentLedger[]>([]);
  const [agentLoading, setAgentLoading] = useState(false);
  const [addAgentEntry, setAddAgentEntry] = useState(false);

  // Tab 4: Unified
  const [unified, setUnified] = useState<UnifiedSummary[]>([]);
  const [partyTypeFilter, setPartyTypeFilter] = useState('');
  const [drillRow, setDrillRow] = useState<UnifiedSummary | null>(null);

  // Create new settlement entity (vendor / associate / agent)
  const [createOpen, setCreateOpen] = useState(false);
  const [cForm, setCForm] = useState<Record<string, any>>({});
  const [creating, setCreating] = useState(false);
  const [cError, setCError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [v, a, ag, u] = await Promise.all([
        searchRead<BillVendor>('flipkart.bill.payment.vendor', { fields: ['id', 'name', 'phone', 'deduction_percent', 'balance', 'notes'], limit: 0 }),
        searchRead<MoneyAssociate>('flipkart.money.associate', { fields: ['id', 'name', 'phone', 'balance', 'notes'], limit: 0 }),
        searchRead<CarryingAgent>('flipkart.carrying.agent', { fields: ['id', 'name', 'contact_details', 'outstanding_balance'], limit: 0 }),
        searchRead<UnifiedSummary>('flipkart.unified.ledger.summary', { fields: ['id', 'party_type', 'party_name', 'debit', 'credit', 'balance'], limit: 0 }),
      ]);
      setVendors(v || []);
      setAssociates(a || []);
      setAgents(ag || []);
      setUnified(u || []);
    } catch { } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const openVendorDrawer = async (vendor: BillVendor) => {
    setSelectedVendor(vendor);
    setTxnsLoading(true);
    try {
      const res = await searchRead<BillTransaction>('flipkart.bill.payment.transaction', {
        domain: [['vendor_id', '=', vendor.id]],
        fields: ['id', 'name', 'date', 'transfer_amount', 'deduction_amount', 'payment_received', 'actual_cash_received', 'expected_cash_amount', 'agent_payment_source', 'agent_payment_amount', 'note'],
        order: 'date desc',
      });
      setVendorTxns(res || []);
    } catch { setVendorTxns([]); } finally { setTxnsLoading(false); }
  };

  const openAssocDrawer = async (assoc: MoneyAssociate) => {
    setSelectedAssoc(assoc);
    setAssocLoading(true);
    try {
      const res = await searchRead<AssociateLedger>('flipkart.associate.ledger', {
        domain: [['associate_id', '=', assoc.id]],
        fields: ['id', 'date', 'entry_type', 'amount', 'reference', 'note'],
        order: 'date desc',
      });
      setAssocLedger(res || []);
    } catch { setAssocLedger([]); } finally { setAssocLoading(false); }
  };

  const openAgentDrawer = async (agent: CarryingAgent) => {
    setSelectedAgent(agent);
    setAgentLoading(true);
    try {
      const res = await searchRead<AgentLedger>('flipkart.agent.ledger', {
        domain: [['agent_id', '=', agent.id]],
        fields: ['id', 'date', 'entry_type', 'amount_inr', 'reference', 'notes'],
        order: 'date desc',
      });
      setAgentLedger(res || []);
    } catch { setAgentLedger([]); } finally { setAgentLoading(false); }
  };

  // Label for the contextual "New" button / create modal per active tab.
  const entityLabel = tab === 'vendors' ? 'Bill Vendor' : tab === 'associates' ? 'Money Associate' : 'Carrying Agent';

  const handleCreateEntity = async () => {
    setCError(null);
    if (!cForm.name?.trim()) { setCError('Name is required.'); return; }
    setCreating(true);
    try {
      if (tab === 'vendors') {
        await createRecord('flipkart.bill.payment.vendor', {
          name: cForm.name.trim(),
          phone: cForm.phone || false,
          deduction_percent: parseFloat(cForm.deduction_percent || 0) || 0,
          notes: cForm.notes || false,
        });
      } else if (tab === 'associates') {
        await createRecord('flipkart.money.associate', {
          name: cForm.name.trim(),
          phone: cForm.phone || false,
          notes: cForm.notes || false,
        });
      } else if (tab === 'agents') {
        await createRecord('flipkart.carrying.agent', {
          name: cForm.name.trim(),
          contact_details: cForm.contact_details || false,
        });
      }
      setCreateOpen(false);
      setCForm({});
      await fetchAll();
    } catch (e: any) {
      setCError(e?.message || 'Create failed');
    } finally {
      setCreating(false);
    }
  };

  const glassClass = isDark ? 'glass' : 'glass-light bg-white/80';
  const lblCls = `text-[10px] font-semibold block mb-1 ${isDark ? 'text-[#5a6a8a]' : 'text-gray-500'}`;
  const fieldCls = `input text-xs py-2 w-full ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`;
  const thCls = `py-3 px-4 text-xs font-semibold uppercase tracking-wider ${isDark ? 'border-white/5 bg-[#111827]/40 text-gray-400' : 'border-gray-200 bg-gray-50 text-gray-500'}`;
  const rowCls = `transition-colors cursor-pointer ${isDark ? 'hover:bg-white/5' : 'hover:bg-gray-50'}`;

  const TABS = [
    { id: 'vendors' as ActiveTab, label: 'Bill Vendors', icon: Users, count: vendors.length },
    { id: 'associates' as ActiveTab, label: 'Money Associates', icon: DollarSign, count: associates.length },
    { id: 'agents' as ActiveTab, label: 'Carrying Agents', icon: Truck, count: agents.length },
    { id: 'unified' as ActiveTab, label: 'Unified Ledger', icon: ClipboardList, count: unified.length },
  ];

  const q = deferredSearch.toLowerCase();

  const filteredVendors = vendors.filter(v => !q || v.name.toLowerCase().includes(q) || v.phone?.includes(q));
  const filteredAssociates = associates.filter(a => !q || a.name.toLowerCase().includes(q));
  const filteredAgents = agents.filter(a => !q || a.name.toLowerCase().includes(q));
  const filteredUnified = unified.filter(u => {
    const matchType = !partyTypeFilter || u.party_type === partyTypeFilter;
    const matchSearch = !q || u.party_name.toLowerCase().includes(q);
    return matchType && matchSearch;
  });

  const partyTypes = [...new Set(unified.map(u => u.party_type))];

  return (
    <div className='space-y-5 animate-fade-in p-4'>
      {/* Header */}
      <div className='flex flex-col sm:flex-row sm:items-center justify-between gap-3'>
        <div>
          <h1 className={`text-2xl font-black ${isDark ? 'text-white' : 'text-gray-900'}`}>Settlements Console</h1>
          <p className={`text-xs mt-0.5 ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>Vendor payments, money associates, carrying agents and unified ledgers.</p>
        </div>
        <button onClick={fetchAll} disabled={loading} className='btn-secondary text-xs px-3 py-2'>
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Sync
        </button>
      </div>

      {/* Info banner: complex entries should use Unified Ledger */}
      <div className={`px-4 py-3 rounded-xl border text-xs flex items-start gap-3 ${isDark ? 'bg-amber-500/5 border-amber-500/20 text-amber-300' : 'bg-amber-50 border-amber-200 text-amber-700'}`}>
        <span className="text-amber-400 flex-shrink-0 mt-0.5">ℹ</span>
        <span>For <strong>payment receipts</strong>, <strong>associate transfers</strong>, and <strong>partner ledger entries</strong>, use the <strong>Unified Ledger</strong> module — it routes entries through the correct wizard and keeps all ledgers in sync. This console handles simple adds only.</span>
      </div>

      {/* Tab bar */}
      <div className={`flex flex-wrap gap-1.5 p-1.5 rounded-xl border w-fit ${isDark ? 'border-[#2a3250] bg-[#1e2440]' : 'border-gray-200 bg-gray-50'}`}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => { setTab(t.id); setSearch(''); }} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${tab === t.id ? 'bg-[#7367f0] text-white shadow-md' : isDark ? 'text-[#6a7a9a] hover:text-white' : 'text-gray-500 hover:text-gray-900'}`}>
            <t.icon size={13} />
            {t.label}
            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${tab === t.id ? 'bg-white/20' : isDark ? 'bg-[#2a3250]' : 'bg-gray-200'}`}>{t.count}</span>
          </button>
        ))}
      </div>

      {/* Search bar + contextual create */}
      <div className='flex items-center gap-2 flex-wrap'>
        <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border w-full max-w-xs ${isDark ? 'bg-[#1e2440] border-[#2a3250]' : 'bg-gray-50 border-gray-200'}`}>
          <Search size={13} className={isDark ? 'text-[#5a6a8a]' : 'text-gray-400'} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder='Search...'
            autoComplete="off" autoCorrect="off" spellCheck="false"
            className='bg-transparent outline-none text-xs flex-1' />
        </div>
        {tab !== 'unified' && (
          <button onClick={() => { setCForm({}); setCError(null); setCreateOpen(true); }} className='btn-primary text-xs px-3 py-2'>
            <Plus size={13} /> New {entityLabel}
          </button>
        )}
      </div>

      {loading ? (
        <div className={`card h-48 flex items-center justify-center ${glassClass}`}>
          <RefreshCw size={20} className='animate-spin text-[#7367f0]' />
        </div>
      ) : (
        <>
          {/* TAB 1: VENDORS */}
          {tab === 'vendors' && (
            <div className={`card overflow-hidden ${glassClass}`}>
              {filteredVendors.length === 0 ? <EmptyState /> : (
                <div className='overflow-x-auto'>
                  <table className='w-full text-left border-collapse'>
                    <thead>
                      <tr className={`border-b ${isDark ? 'border-white/5' : 'border-gray-200'}`}>
                        <th className={thCls}>Vendor</th>
                        <th className={thCls}>Phone</th>
                        <th className={`${thCls} text-right`}>Deduction %</th>
                        <th className={`${thCls} text-right`}>Balance</th>
                        <th className={`${thCls} text-center`}>Ledger</th>
                      </tr>
                    </thead>
                    <tbody className={`divide-y text-sm ${isDark ? 'divide-white/5' : 'divide-gray-100'}`}>
                      {filteredVendors.map(v => (
                        <tr key={v.id} className={rowCls} onClick={() => openVendorDrawer(v)}>
                          <td className={`py-3 px-4 font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>{v.name}</td>
                          <td className={`py-3 px-4 text-xs ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>{v.phone}</td>
                          <td className='py-3 px-4 text-right text-xs'>{v.deduction_percent}%</td>
                          <td className='py-3 px-4 text-right'><BalanceCell value={v.balance} /></td>
                          <td className='py-3 px-4 text-center'>
                            <ChevronRight size={14} className={isDark ? 'text-[#5a6a8a] mx-auto' : 'text-gray-400 mx-auto'} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: ASSOCIATES */}
          {tab === 'associates' && (
            <div className={`card overflow-hidden ${glassClass}`}>
              {filteredAssociates.length === 0 ? <EmptyState /> : (
                <div className='overflow-x-auto'>
                  <table className='w-full text-left border-collapse'>
                    <thead>
                      <tr className={`border-b ${isDark ? 'border-white/5' : 'border-gray-200'}`}>
                        <th className={thCls}>Associate</th>
                        <th className={thCls}>Phone</th>
                        <th className={`${thCls} text-right`}>Balance</th>
                        <th className={`${thCls} text-center`}>Ledger</th>
                      </tr>
                    </thead>
                    <tbody className={`divide-y text-sm ${isDark ? 'divide-white/5' : 'divide-gray-100'}`}>
                      {filteredAssociates.map(a => (
                        <tr key={a.id} className={rowCls} onClick={() => openAssocDrawer(a)}>
                          <td className={`py-3 px-4 font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>{a.name}</td>
                          <td className={`py-3 px-4 text-xs ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>{a.phone}</td>
                          <td className='py-3 px-4 text-right'><BalanceCell value={a.balance} /></td>
                          <td className='py-3 px-4 text-center'>
                            <ChevronRight size={14} className={isDark ? 'text-[#5a6a8a] mx-auto' : 'text-gray-400 mx-auto'} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: AGENTS */}
          {tab === 'agents' && (
            <div className={`card overflow-hidden ${glassClass}`}>
              {filteredAgents.length === 0 ? <EmptyState /> : (
                <div className='overflow-x-auto'>
                  <table className='w-full text-left border-collapse'>
                    <thead>
                      <tr className={`border-b ${isDark ? 'border-white/5' : 'border-gray-200'}`}>
                        <th className={thCls}>Agent Name</th>
                        <th className={thCls}>Contact / Location</th>
                        <th className={`${thCls} text-right`}>Outstanding Balance</th>
                        <th className={`${thCls} text-center`}>Ledger</th>
                      </tr>
                    </thead>
                    <tbody className={`divide-y text-sm ${isDark ? 'divide-white/5' : 'divide-gray-100'}`}>
                      {filteredAgents.map(a => (
                        <tr key={a.id} className={rowCls} onClick={() => openAgentDrawer(a)}>
                          <td className={`py-3 px-4 font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>{a.name}</td>
                          <td className={`py-3 px-4 text-xs ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>{a.contact_details}</td>
                          <td className='py-3 px-4 text-right'>
                            <span className={`font-bold ${a.outstanding_balance > 0 ? 'text-red-400' : 'text-green-400'}`}>
                              {fmt(a.outstanding_balance)}
                            </span>
                          </td>
                          <td className='py-3 px-4 text-center'>
                            <ChevronRight size={14} className={isDark ? 'text-[#5a6a8a] mx-auto' : 'text-gray-400 mx-auto'} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: UNIFIED LEDGER */}
          {tab === 'unified' && (
            <div className='space-y-4'>
              <div className='flex flex-wrap gap-2'>
                <button onClick={() => setPartyTypeFilter('')} className={`text-xs px-3 py-1.5 rounded-lg font-semibold border transition-all ${!partyTypeFilter ? 'bg-[#7367f0] text-white border-[#7367f0]' : isDark ? 'border-[#2a3250] text-[#6a7a9a]' : 'border-gray-200 text-gray-500'}`}>All</button>
                {partyTypes.map(pt => (
                  <button key={pt} onClick={() => setPartyTypeFilter(pt)} className={`text-xs px-3 py-1.5 rounded-lg font-semibold border capitalize transition-all ${partyTypeFilter === pt ? 'bg-[#7367f0] text-white border-[#7367f0]' : isDark ? 'border-[#2a3250] text-[#6a7a9a]' : 'border-gray-200 text-gray-500'}`}>{pt}</button>
                ))}
              </div>
              <div className={`card overflow-hidden ${glassClass}`}>
                {filteredUnified.length === 0 ? <EmptyState /> : (
                  <div className='overflow-x-auto'>
                    <table className='w-full text-left border-collapse'>
                      <thead>
                        <tr className={`border-b ${isDark ? 'border-white/5' : 'border-gray-200'}`}>
                          <th className={thCls}>Party Type</th>
                          <th className={thCls}>Party Name</th>
                          <th className={`${thCls} text-right`}>Total Debit</th>
                          <th className={`${thCls} text-right`}>Total Credit</th>
                          <th className={`${thCls} text-right`}>Net Balance</th>
                          <th className={`${thCls} text-center`}>Detail</th>
                        </tr>
                      </thead>
                      <tbody className={`divide-y text-sm ${isDark ? 'divide-white/5' : 'divide-gray-100'}`}>
                        {filteredUnified.map(u => (
                          <tr key={u.id} className={rowCls} onClick={() => setDrillRow(u)}>
                            <td className='py-3 px-4'>
                              <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border capitalize ${isDark ? 'border-[#2a3250] text-[#8b9ccc] bg-[#2a3250]/50' : 'border-gray-200 text-gray-600 bg-gray-100'}`}>{u.party_type}</span>
                            </td>
                            <td className={`py-3 px-4 font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>{u.party_name}</td>
                            <td className='py-3 px-4 text-right text-red-400 font-bold'>{u.debit > 0 ? fmt(u.debit) : '--'}</td>
                            <td className='py-3 px-4 text-right text-green-400 font-bold'>{u.credit > 0 ? fmt(u.credit) : '--'}</td>
                            <td className='py-3 px-4 text-right'><BalanceCell value={u.balance} /></td>
                            <td className='py-3 px-4 text-center'>
                              <ChevronRight size={14} className={isDark ? 'text-[#5a6a8a] mx-auto' : 'text-gray-400 mx-auto'} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* ---- Vendor Drawer ---- */}
      {selectedVendor && (
        <Drawer
          title={selectedVendor.name}
          subtitle={`Deduction: ${selectedVendor.deduction_percent}% ?? Balance: ${fmt(selectedVendor.balance)}`}
          onClose={() => setSelectedVendor(null)}
          onAddEntry={() => setAddVendorTxn(true)}
          loading={txnsLoading}
        >
          {vendorTxns.length === 0 ? <EmptyState message='No transactions found' /> : (
            <div className='overflow-x-auto'>
              <table className='w-full text-left border-collapse'>
                <thead className={`border-b ${isDark ? 'border-white/5 bg-[#111827]/30' : 'border-gray-100 bg-gray-50'}`}>
                  <tr>
                    {['Date', 'Ref', 'Transfer', 'Deduction', 'Cash Rcvd', 'Agent Paid', 'Paid?', ''].map(h => (
                      <th key={h} className={`py-2.5 px-3 text-[10px] font-semibold uppercase tracking-wider ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className={`divide-y text-xs ${isDark ? 'divide-white/5' : 'divide-gray-100'}`}>
                  {vendorTxns.map(t => (
                    <tr key={t.id} className={isDark ? 'hover:bg-white/5' : 'hover:bg-gray-50'}>
                      <td className='py-2.5 px-3 font-mono'>{t.date}</td>
                      <td className={`py-2.5 px-3 font-semibold ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>{t.name}</td>
                      <td className='py-2.5 px-3 font-bold text-blue-400'>{fmt(t.transfer_amount)}</td>
                      <td className='py-2.5 px-3 text-amber-400'>{fmt(t.deduction_amount)}</td>
                      <td className='py-2.5 px-3 text-green-400'>{fmt(t.actual_cash_received)}</td>
                      <td className='py-2.5 px-3'>{t.agent_payment_amount > 0 ? fmt(t.agent_payment_amount) : '--'}</td>
                      <td className='py-2.5 px-3'>
                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full ${t.payment_received ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                          {t.payment_received ? 'Yes' : 'No'}
                        </span>
                      </td>
                      <td className='py-2.5 px-3'>
                        {!t.payment_received && (
                          <button onClick={e => { e.stopPropagation(); setReceiveTxn(t); }}
                            className='text-[10px] font-bold px-2 py-1 rounded-lg bg-green-500/10 text-green-400 border border-green-500/20 hover:bg-green-500/20 whitespace-nowrap'>
                            Receive
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Drawer>
      )}

      {/* ---- Associate Drawer ---- */}
      {selectedAssoc && (
        <Drawer
          title={selectedAssoc.name}
          subtitle={`Balance: ${fmt(selectedAssoc.balance)}`}
          onClose={() => setSelectedAssoc(null)}
          onAddEntry={() => setAddAssocEntry(true)}
          loading={assocLoading}
        >
          {assocLedger.length === 0 ? <EmptyState message='No ledger entries found' /> : (
            <div className='overflow-x-auto'>
              <table className='w-full text-left border-collapse'>
                <thead className={`border-b ${isDark ? 'border-white/5 bg-[#111827]/30' : 'border-gray-100 bg-gray-50'}`}>
                  <tr>
                    {['Date', 'Entry Type', 'Reference', 'Amount'].map(h => (
                      <th key={h} className={`py-2.5 px-3 text-[10px] font-semibold uppercase tracking-wider ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className={`divide-y text-xs ${isDark ? 'divide-white/5' : 'divide-gray-100'}`}>
                  {assocLedger.map(l => (
                    <tr key={l.id} className={isDark ? 'hover:bg-white/5' : 'hover:bg-gray-50'}>
                      <td className='py-2.5 px-3 font-mono'>{l.date}</td>
                      <td className={`py-2.5 px-3 capitalize ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>{l.entry_type.replace(/_/g, ' ')}</td>
                      <td className='py-2.5 px-3'>{l.reference || '--'}</td>
                      <td className='py-2.5 px-3 font-bold text-[#7367f0]'>{fmt(l.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Drawer>
      )}

      {/* ---- Agent Drawer ---- */}
      {selectedAgent && (
        <Drawer
          title={selectedAgent.name}
          subtitle={`Outstanding: ${fmt(selectedAgent.outstanding_balance)}`}
          onClose={() => setSelectedAgent(null)}
          onAddEntry={() => setAddAgentEntry(true)}
          loading={agentLoading}
        >
          {agentLedger.length === 0 ? <EmptyState message='No ledger entries found' /> : (
            <div className='overflow-x-auto'>
              <table className='w-full text-left border-collapse'>
                <thead className={`border-b ${isDark ? 'border-white/5 bg-[#111827]/30' : 'border-gray-100 bg-gray-50'}`}>
                  <tr>
                    {['Date', 'Type', 'Reference', 'Amount (--)'].map(h => (
                      <th key={h} className={`py-2.5 px-3 text-[10px] font-semibold uppercase tracking-wider ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className={`divide-y text-xs ${isDark ? 'divide-white/5' : 'divide-gray-100'}`}>
                  {agentLedger.map(l => (
                    <tr key={l.id} className={isDark ? 'hover:bg-white/5' : 'hover:bg-gray-50'}>
                      <td className='py-2.5 px-3 font-mono'>{l.date}</td>
                      <td className={`py-2.5 px-3 capitalize ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>{l.entry_type}</td>
                      <td className='py-2.5 px-3'>{l.reference || '--'}</td>
                      <td className={`py-2.5 px-3 font-bold ${l.entry_type === 'bill' ? 'text-red-400' : l.entry_type === 'payment' ? 'text-green-400' : 'text-amber-400'}`}>
                        {fmt(l.amount_inr)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Drawer>
      )}

      {/* ---- Modals ---- */}
      {addVendorTxn && selectedVendor && (
        <AddVendorTxnModal
          vendor={selectedVendor}
          onClose={() => setAddVendorTxn(false)}
          onSaved={() => { openVendorDrawer(selectedVendor); fetchAll(); }}
        />
      )}

      {addAssocEntry && selectedAssoc && (
        <AddAssocEntryModal
          associate={selectedAssoc}
          onClose={() => setAddAssocEntry(false)}
          onSaved={() => { openAssocDrawer(selectedAssoc); fetchAll(); }}
        />
      )}

      {addAgentEntry && selectedAgent && (
        <AddAgentEntryModal
          agent={selectedAgent}
          onClose={() => setAddAgentEntry(false)}
          onSaved={() => { openAgentDrawer(selectedAgent); fetchAll(); }}
        />
      )}

      {drillRow && (
        <UnifiedDrillModal row={drillRow} onClose={() => setDrillRow(null)} />
      )}

      {receiveTxn && selectedVendor && (
        <ReceivePaymentModal
          txn={receiveTxn}
          onClose={() => setReceiveTxn(null)}
          onSaved={() => { setReceiveTxn(null); openVendorDrawer(selectedVendor); fetchAll(); }}
        />
      )}

      {/* Create entity modal */}
      {createOpen && (
        <div className='fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm' onClick={() => !creating && setCreateOpen(false)}>
          <div className={`w-full max-w-md rounded-2xl shadow-2xl border ${isDark ? 'bg-[#161b2e] border-[#2a3250]' : 'bg-white border-gray-200'}`} onClick={e => e.stopPropagation()}>
            <div className={`flex items-center justify-between p-5 border-b ${isDark ? 'border-[#2a3250]' : 'border-gray-200'}`}>
              <h2 className={`text-base font-black ${isDark ? 'text-white' : 'text-gray-900'}`}>New {entityLabel}</h2>
              <button onClick={() => setCreateOpen(false)} className={`p-2 rounded-lg ${isDark ? 'hover:bg-white/5 text-[#5a6a8a]' : 'hover:bg-gray-100 text-gray-400'}`}><X size={16} /></button>
            </div>
            <div className='p-5 space-y-4'>
              {cError && (
                <div className='text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2'>{cError}</div>
              )}
              <div>
                <label className={lblCls}>Name *</label>
                <input value={cForm.name || ''} onChange={e => setCForm(p => ({ ...p, name: e.target.value }))} placeholder={`${entityLabel} name`} className={fieldCls} />
              </div>

              {tab === 'vendors' && (
                <>
                  <div className='grid grid-cols-2 gap-3'>
                    <div>
                      <label className={lblCls}>Phone</label>
                      <input value={cForm.phone || ''} onChange={e => setCForm(p => ({ ...p, phone: e.target.value }))} className={fieldCls} />
                    </div>
                    <div>
                      <label className={lblCls}>Deduction %</label>
                      <input type='number' step='0.01' min='0' value={cForm.deduction_percent || ''} onChange={e => setCForm(p => ({ ...p, deduction_percent: e.target.value }))} placeholder='0.00' className={fieldCls} />
                    </div>
                  </div>
                  <div>
                    <label className={lblCls}>Notes</label>
                    <textarea rows={2} value={cForm.notes || ''} onChange={e => setCForm(p => ({ ...p, notes: e.target.value }))} className={`${fieldCls} resize-none`} />
                  </div>
                </>
              )}

              {tab === 'associates' && (
                <>
                  <div>
                    <label className={lblCls}>Phone</label>
                    <input value={cForm.phone || ''} onChange={e => setCForm(p => ({ ...p, phone: e.target.value }))} className={fieldCls} />
                  </div>
                  <div>
                    <label className={lblCls}>Notes</label>
                    <textarea rows={2} value={cForm.notes || ''} onChange={e => setCForm(p => ({ ...p, notes: e.target.value }))} className={`${fieldCls} resize-none`} />
                  </div>
                </>
              )}

              {tab === 'agents' && (
                <div>
                  <label className={lblCls}>Contact / Location Details</label>
                  <textarea rows={3} value={cForm.contact_details || ''} onChange={e => setCForm(p => ({ ...p, contact_details: e.target.value }))} className={`${fieldCls} resize-none`} />
                </div>
              )}
            </div>
            <div className={`flex justify-end gap-3 p-5 border-t ${isDark ? 'border-[#2a3250]' : 'border-gray-200'}`}>
              <button onClick={() => setCreateOpen(false)} className='btn-secondary text-xs px-4 py-2'>Cancel</button>
              <button onClick={handleCreateEntity} disabled={creating || !cForm.name?.trim()} className='btn-primary text-xs px-4 py-2'>
                {creating ? <RefreshCw size={13} className='animate-spin' /> : <Plus size={13} />}
                {creating ? 'Creating...' : `Create ${entityLabel}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

