import { useState, useEffect } from 'react';
import { searchRead, createRecord, odooCall } from '../../../services/odoo';
import { useTheme } from '../../../context/ThemeContext';
import { PlusCircle, CheckCircle2, AlertCircle, X } from 'lucide-react';

interface Partner { id: number; name: string; }

const ENTRY_TYPES = [
  { key: 'bank_transfer',     label: 'Bank Transfer',      desc: 'New vendor payment order' },
  { key: 'receive_payment',   label: 'Receive Cash',       desc: 'Mark cash received for order' },
  { key: 'agent_payment',     label: 'Agent Payment',      desc: 'Carrying agent payment' },
  { key: 'expense',           label: 'Expense',            desc: 'Record associate expense' },
  { key: 'associate_transfer',label: 'Associate Transfer', desc: 'Transfer between associates' },
  { key: 'manual_partner',    label: 'Manual Partner',     desc: 'Partner debit / credit / setoff' },
];

export default function CreateEntry() {
  const { isDark } = useTheme();
  const [entryType, setEntryType] = useState('bank_transfer');
  const [form, setForm] = useState<Record<string, any>>({ date: new Date().toISOString().slice(0, 10) });
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);

  const [vendors, setVendors]       = useState<Partner[]>([]);
  const [agents, setAgents]         = useState<Partner[]>([]);
  const [associates, setAssociates] = useState<Partner[]>([]);
  const [allPartners, setAllPartners] = useState<Partner[]>([]);
  const [vendorTxns, setVendorTxns] = useState<{ id: number; name: string; state: string; expected_cash_amount: number; actual_cash_received: number }[]>([]);

  const showMsg = (ok: boolean, msg: string) => {
    setToast({ ok, msg });
    setTimeout(() => setToast(null), 5000);
  };

  useEffect(() => {
    const loadRefs = async () => {
      const [ps, as_, vs, acs] = await Promise.allSettled([
        searchRead<Partner>('res.partner', { fields: ['id', 'name'], domain: [['active', '=', true]], limit: 0 }),
        searchRead<Partner>('flipkart.carrying.agent', { fields: ['id', 'name'], limit: 0 }),
        searchRead<Partner>('flipkart.bill.payment.vendor', { fields: ['id', 'name'], limit: 0 }),
        searchRead<Partner>('flipkart.money.associate', { fields: ['id', 'name'], limit: 0 }),
      ]);
      if (ps.status === 'fulfilled') setAllPartners(ps.value || []);
      if (as_.status === 'fulfilled') setAgents(as_.value || []);
      if (vs.status === 'fulfilled') setVendors(vs.value || []);
      if (acs.status === 'fulfilled') setAssociates(acs.value || []);
    };
    loadRefs();
  }, []);

  const loadVendorTxns = async (vendorId: number) => {
    try {
      const r = await searchRead<{ id: number; name: string; state: string; expected_cash_amount: number; actual_cash_received: number }>(
        'flipkart.bill.payment.transaction', {
          fields: ['id', 'name', 'state', 'expected_cash_amount', 'actual_cash_received'],
          domain: [['vendor_id', '=', vendorId], ['state', 'in', ['pending', 'partial']]],
          limit: 0,
          order: 'date asc, id asc',
        });
      setVendorTxns(r || []);
    } catch { setVendorTxns([]); }
  };

  const setF = (key: string, val: any) => setForm(p => ({ ...p, [key]: val }));

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      if (entryType === 'manual_partner') {
        if (!form.partner_id || !form.amount) throw new Error('Partner and amount are required.');
        const wizardId = await createRecord('business.manual.entry.wizard', {
          partner_id: form.partner_id,
          date: form.date,
          narration: form.narration || '',
          amount: parseFloat(form.amount),
          entry_type: form.manual_type || 'debit',
        });
        await odooCall('business.manual.entry.wizard', 'action_post_entry', [[wizardId]], {});
        showMsg(true, 'Partner journal entry posted successfully.');
      } else {
        // Map UI fields to the REAL flipkart.bill.payment.entry.wizard fields.
        const vals: Record<string, any> = { entry_type: entryType, date: form.date, note: form.note || '' };
        if (entryType === 'bank_transfer') {
          vals.vendor_id = form.vendor_id;
          vals.transfer_amount = parseFloat(form.transfer_amount || 0);
          vals.deduction_percent = parseFloat(form.deduction_percent || 0);
        } else if (entryType === 'receive_payment') {
          vals.vendor_id = form.vendor_id;
          if (form.transaction_id) vals.transaction_id = form.transaction_id;
          vals.received_by_id = form.received_by_id;
          vals.actual_cash_received = parseFloat(form.payment_received || 0);
        } else if (entryType === 'agent_payment') {
          vals.vendor_id = form.vendor_id;
          if (form.transaction_id) vals.transaction_id = form.transaction_id;
          vals.agent_payment_source = form.agent_payment_source || 'vendor';
          vals.carrying_agent_id = form.carrying_agent_id;
          vals.agent_payment_amount = parseFloat(form.agent_payment_amount || 0);
          if ((form.agent_payment_source || 'vendor') === 'associate') vals.received_by_id = form.received_by_id;
        } else if (entryType === 'expense') {
          vals.received_by_id = form.received_by_id;
          vals.actual_cash_received = parseFloat(form.expense_amount || 0);
        } else if (entryType === 'associate_transfer') {
          vals.received_by_id = form.from_associate_id;
          vals.to_associate_id = form.to_associate_id;
          vals.actual_cash_received = parseFloat(form.transfer_amount || 0);
        }
        const wizardId = await createRecord('flipkart.bill.payment.entry.wizard', vals);
        await odooCall('flipkart.bill.payment.entry.wizard', 'action_apply', [[wizardId]], {});
        showMsg(true, 'Entry applied successfully.');
      }
      setForm({ date: new Date().toISOString().slice(0, 10) });
      setVendorTxns([]);
    } catch (e: any) {
      showMsg(false, 'Failed: ' + e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const pt = isDark ? 'text-white' : 'text-gray-900';
  const st = isDark ? 'text-[#5a6a8a]' : 'text-gray-500';
  const inp = `input text-sm py-2 w-full ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`;
  const card = `rounded-2xl border ${isDark ? 'bg-[#161b2e] border-[#2a3250]' : 'bg-white border-gray-200'}`;
  const lbl = `text-[10px] font-semibold block mb-1 ${st}`;

  const expectedCash = form.transfer_amount && form.deduction_percent
    ? (parseFloat(form.transfer_amount) * (1 - parseFloat(form.deduction_percent) / 100)).toFixed(2)
    : null;

  return (
    <div className="max-w-2xl mx-auto space-y-5 animate-fade-in">
      {toast && (
        <div className={`fixed top-5 right-5 z-50 px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 text-sm font-medium max-w-sm
          ${toast.ok ? 'bg-green-500/15 border border-green-500/30 text-green-400' : 'bg-red-500/15 border border-red-500/30 text-red-400'}`}>
          {toast.ok ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
          <span className="flex-1">{toast.msg}</span>
          <button onClick={() => setToast(null)}><X size={13} /></button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[#7367f0]/15 flex items-center justify-center">
          <PlusCircle size={18} className="text-[#7367f0]" />
        </div>
        <div>
          <h1 className={`text-xl font-black ${pt}`}>Create Ledger Entry</h1>
          <p className={`text-xs ${st}`}>Post entries to the Business OS unified ledger</p>
        </div>
      </div>

      {/* Entry type selector */}
      <div className={`${card} p-4`}>
        <p className={`text-[10px] font-bold uppercase tracking-wider mb-3 ${st}`}>Entry Type</p>
        <div className="grid grid-cols-2 gap-2">
          {ENTRY_TYPES.map(t => (
            <button key={t.key} type="button"
              onClick={() => { setEntryType(t.key); setForm({ date: new Date().toISOString().slice(0, 10) }); setVendorTxns([]); }}
              className={`p-3 rounded-xl border text-left transition-all ${entryType === t.key
                ? 'border-[#7367f0] bg-[#7367f0]/10'
                : isDark ? 'border-[#2a3250] hover:border-[#7367f0]/50' : 'border-gray-200 hover:border-violet-300'}`}>
              <p className={`text-xs font-bold ${entryType === t.key ? 'text-[#7367f0]' : pt}`}>{t.label}</p>
              <p className={`text-[10px] mt-0.5 ${st}`}>{t.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Form */}
      <div className={`${card} p-5 space-y-4`}>
        {/* Date — common */}
        <div>
          <label className={lbl}>Date *</label>
          <input type="date" value={form.date || ''} onChange={e => setF('date', e.target.value)} className={inp} />
        </div>

        {/* bank_transfer */}
        {entryType === 'bank_transfer' && (<>
          <div>
            <label className={lbl}>Vendor *</label>
            <select value={form.vendor_id || ''} onChange={e => setF('vendor_id', Number(e.target.value))} className={inp}>
              <option value="">— Select Vendor —</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl}>Transfer Amount (Rs.) *</label>
            <input type="number" placeholder="0.00" value={form.transfer_amount || ''} onChange={e => setF('transfer_amount', e.target.value)} className={inp} />
          </div>
          <div>
            <label className={lbl}>Deduction % (commission)</label>
            <input type="number" step="0.01" placeholder="0.00" value={form.deduction_percent || ''} onChange={e => setF('deduction_percent', e.target.value)} className={inp} />
          </div>
          {expectedCash && (
            <div className={`p-3 rounded-xl border ${isDark ? 'bg-[#7367f0]/8 border-[#7367f0]/25' : 'bg-violet-50 border-violet-200'}`}>
              <p className={`text-xs ${st}`}>Expected Cash Received:</p>
              <p className="text-lg font-bold text-[#7367f0]">Rs.{expectedCash}</p>
            </div>
          )}
          <div>
            <label className={lbl}>Note</label>
            <input type="text" placeholder="Optional note" value={form.note || ''} onChange={e => setF('note', e.target.value)} className={inp} />
          </div>
        </>)}

        {/* receive_payment */}
        {entryType === 'receive_payment' && (<>
          <div>
            <label className={lbl}>Vendor *</label>
            <select value={form.vendor_id || ''} onChange={e => { const v = Number(e.target.value); setF('vendor_id', v); if (v) loadVendorTxns(v); }} className={inp}>
              <option value="">— Select Vendor —</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
          {vendorTxns.length > 0 && (
            <div>
              <label className={lbl}>Pending / Partial Transaction *</label>
              <select value={form.transaction_id || ''} onChange={e => {
                const id = Number(e.target.value);
                const txn = vendorTxns.find(t => t.id === id);
                setF('transaction_id', id);
                if (txn) {
                  const remaining = txn.expected_cash_amount - (txn.actual_cash_received || 0);
                  setF('payment_received', remaining > 0 ? remaining.toFixed(2) : '');
                }
              }} className={inp}>
                <option value="">— Select Transaction —</option>
                {vendorTxns.map(t => {
                  const remaining = t.expected_cash_amount - (t.actual_cash_received || 0);
                  const tag = t.state === 'partial' ? ` [PARTIAL — Rs.${remaining.toLocaleString('en-IN', { maximumFractionDigits: 2 })} remaining]` : ` [Rs.${t.expected_cash_amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })} pending]`;
                  return <option key={t.id} value={t.id}>{t.name}{tag}</option>;
                })}
              </select>
            </div>
          )}
          {form.transaction_id && (() => {
            const txn = vendorTxns.find(t => t.id === form.transaction_id);
            if (!txn || txn.state !== 'partial') return null;
            const remaining = txn.expected_cash_amount - (txn.actual_cash_received || 0);
            return (
              <div className={`p-3 rounded-xl border ${isDark ? 'bg-amber-500/8 border-amber-500/25' : 'bg-amber-50 border-amber-200'}`}>
                <p className="text-xs text-amber-500 font-semibold">Partial Payment</p>
                <p className={`text-[11px] mt-0.5 ${isDark ? 'text-amber-400/70' : 'text-amber-600'}`}>
                  Expected: Rs.{txn.expected_cash_amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })} &nbsp;|&nbsp;
                  Already received: Rs.{(txn.actual_cash_received || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })} &nbsp;|&nbsp;
                  <strong>Remaining: Rs.{remaining.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</strong>
                </p>
              </div>
            );
          })()}
          <div>
            <label className={lbl}>Received By (Associate) *</label>
            <select value={form.received_by_id || ''} onChange={e => setF('received_by_id', Number(e.target.value))} className={inp}>
              <option value="">— Select Associate —</option>
              {associates.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl}>Cash Received Now (Rs.) *</label>
            <input type="number" placeholder="0.00" value={form.payment_received || ''} onChange={e => setF('payment_received', e.target.value)} className={inp} />
          </div>
          <div>
            <label className={lbl}>Note</label>
            <input type="text" placeholder="Optional note" value={form.note || ''} onChange={e => setF('note', e.target.value)} className={inp} />
          </div>
        </>)}

        {/* agent_payment */}
        {entryType === 'agent_payment' && (<>
          <div>
            <label className={lbl}>Vendor {form.agent_payment_source === 'associate' ? '(optional — leave empty for a direct associate payment)' : '*'}</label>
            <select value={form.vendor_id || ''} onChange={e => { const v = Number(e.target.value); setF('vendor_id', v); if (v) loadVendorTxns(v); }} className={inp}>
              <option value="">— Select Vendor —</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
          {vendorTxns.length > 0 && (
            <div>
              <label className={lbl}>Transaction *</label>
              <select value={form.transaction_id || ''} onChange={e => setF('transaction_id', Number(e.target.value))} className={inp}>
                <option value="">— Select Transaction —</option>
                {vendorTxns.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className={lbl}>Paid By *</label>
            <select value={form.agent_payment_source || 'vendor'} onChange={e => setF('agent_payment_source', e.target.value)} className={inp}>
              <option value="vendor">Bill/Payment Vendor Paid Agent</option>
              <option value="associate">Associate Paid Agent</option>
            </select>
          </div>
          {form.agent_payment_source === 'associate' && (
            <div>
              <label className={lbl}>Associate Who Paid *</label>
              <select value={form.received_by_id || ''} onChange={e => setF('received_by_id', Number(e.target.value))} className={inp}>
                <option value="">— Select Associate —</option>
                {associates.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className={lbl}>Carrying Agent *</label>
            <select value={form.carrying_agent_id || ''} onChange={e => setF('carrying_agent_id', Number(e.target.value))} className={inp}>
              <option value="">— Select Agent —</option>
              {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl}>Agent Payment Amount (Rs.) *</label>
            <input type="number" placeholder="0.00" value={form.agent_payment_amount || ''} onChange={e => setF('agent_payment_amount', e.target.value)} className={inp} />
          </div>
          <div>
            <label className={lbl}>Note</label>
            <input type="text" placeholder="Optional note" value={form.note || ''} onChange={e => setF('note', e.target.value)} className={inp} />
          </div>
        </>)}

        {/* expense */}
        {entryType === 'expense' && (<>
          <div>
            <label className={lbl}>Paid By (Associate) *</label>
            <select value={form.received_by_id || ''} onChange={e => setF('received_by_id', Number(e.target.value))} className={inp}>
              <option value="">— Select Associate —</option>
              {associates.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl}>Expense Amount (Rs.) *</label>
            <input type="number" placeholder="0.00" value={form.expense_amount || ''} onChange={e => setF('expense_amount', e.target.value)} className={inp} />
          </div>
          <div>
            <label className={lbl}>Note</label>
            <input type="text" placeholder="e.g. Office supplies, travel…" value={form.note || ''} onChange={e => setF('note', e.target.value)} className={inp} />
          </div>
        </>)}

        {/* associate_transfer */}
        {entryType === 'associate_transfer' && (<>
          <div>
            <label className={lbl}>From Associate *</label>
            <select value={form.from_associate_id || ''} onChange={e => setF('from_associate_id', Number(e.target.value))} className={inp}>
              <option value="">— Select —</option>
              {associates.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl}>To Associate *</label>
            <select value={form.to_associate_id || ''} onChange={e => setF('to_associate_id', Number(e.target.value))} className={inp}>
              <option value="">— Select —</option>
              {associates.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl}>Transfer Amount (Rs.) *</label>
            <input type="number" placeholder="0.00" value={form.transfer_amount || ''} onChange={e => setF('transfer_amount', e.target.value)} className={inp} />
          </div>
        </>)}

        {/* manual_partner */}
        {entryType === 'manual_partner' && (<>
          <div>
            <label className={lbl}>Partner *</label>
            <select value={form.partner_id || ''} onChange={e => setF('partner_id', Number(e.target.value))} className={inp}>
              <option value="">— Select Partner —</option>
              {allPartners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl}>Entry Type *</label>
            <select value={form.manual_type || 'debit'} onChange={e => setF('manual_type', e.target.value)} className={inp}>
              <option value="debit">Debit</option>
              <option value="credit">Credit</option>
              <option value="setoff">Set Off</option>
            </select>
          </div>
          <div>
            <label className={lbl}>Amount (Rs.) *</label>
            <input type="number" placeholder="0.00" value={form.amount || ''} onChange={e => setF('amount', e.target.value)} className={inp} />
          </div>
          <div>
            <label className={lbl}>Narration</label>
            <input type="text" placeholder="Reason / reference…" value={form.narration || ''} onChange={e => setF('narration', e.target.value)} className={inp} />
          </div>
        </>)}

        <button onClick={handleSubmit} disabled={submitting}
          className="btn-primary w-full py-2.5 font-bold text-sm flex items-center justify-center gap-2 mt-2">
          {submitting ? (
            <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
          ) : <PlusCircle size={16} />}
          {submitting ? 'Posting…' : 'Post Entry'}
        </button>
      </div>
    </div>
  );
}
