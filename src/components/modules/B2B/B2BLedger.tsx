import { useState, useEffect } from 'react';
import { odooCall } from '../../../services/odoo';
import { useTheme } from '../../../context/ThemeContext';
import { 
  RefreshCw, Calendar, ArrowRightLeft, 
  CheckCircle2, X, PlusCircle, AlertCircle 
} from 'lucide-react';

interface LedgerLine {
  id: number;
  date: string;
  name: string; // e.g. "Invoice INV/2026/0012" or "Payment reference"
  ref: string;
  debit: number;
  credit: number;
  balance: number; // per-line net (debit - credit); running total computed client-side
}

type EntryType = 'debit' | 'credit' | 'setoff';

export default function B2BLedger() {
  const { isDark } = useTheme();
  const [ledger, setLedger] = useState<LedgerLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [partners, setPartners] = useState<{ id: number, name: string }[]>([]);
  const [selectedPartnerId, setSelectedPartnerId] = useState<number | ''>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  
  // Manual Entry / Setoff Wizard State
  const [setoffOpen, setSetoffOpen] = useState(false);
  const [setoffAmount, setSetoffAmount] = useState('');
  const [setoffNote, setSetoffNote] = useState('');
  const [entryType, setEntryType] = useState<EntryType>('setoff');
  const [wizardLoading, setWizardLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  useEffect(() => {
    fetchPartners();
  }, []);

  useEffect(() => {
    if (selectedPartnerId) {
      fetchLedger();
    } else {
      setLedger([]);
    }
  }, [selectedPartnerId, dateFrom, dateTo]);

  const fetchPartners = async () => {
    try {
      const res = await odooCall<{ id: number, name: string }[]>('res.partner', 'search_read', [
        [['is_company', '=', true]]
      ], { fields: ['id', 'name'], limit: 0, order: 'name asc' });
      if (Array.isArray(res)) {
        setPartners(res);
        if (res.length > 0) setSelectedPartnerId(res[0].id);
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err?.message || 'Failed to load partners' });
    }
  };

  const fetchLedger = async () => {
    if (!selectedPartnerId) return;
    setLoading(true);
    try {
      const domain: any[] = [['partner_id', '=', selectedPartnerId]];
      if (dateFrom) domain.push(['date', '>=', dateFrom]);
      if (dateTo) domain.push(['date', '<=', dateTo]);
      const res = await odooCall<LedgerLine[]>('b2b.ledger', 'search_read', [domain], {
        fields: ['id', 'date', 'name', 'ref', 'debit', 'credit', 'balance'],
        order: 'date asc, id asc',
        limit: 0,
      });
      setLedger(Array.isArray(res) ? res : []);
    } catch (err: any) {
      setMessage({ type: 'error', text: err?.message || 'Failed to load ledger' });
      setLedger([]);
    } finally {
      setLoading(false);
    }
  };

  const handlePostSetoff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPartnerId || !setoffAmount) return;

    setWizardLoading(true);
    setMessage(null);
    try {
      const wizardId = await odooCall<number>('b2b.manual.entry.wizard', 'create', [{
        partner_id: selectedPartnerId,
        amount: parseFloat(setoffAmount),
        entry_type: entryType,
        payment_details: setoffNote || 'Contra AR/AP Adjustment',
      }], {});
      await odooCall('b2b.manual.entry.wizard', 'action_post_entry', [[wizardId]], {});
      setMessage({ type: 'success', text: 'Ledger entry posted. Journal entry created.' });
      fetchLedger();
      setSetoffOpen(false);
      setSetoffAmount('');
      setSetoffNote('');
    } catch (err: any) {
      setMessage({ type: 'error', text: err?.message || 'Entry posting failed' });
    } finally {
      setWizardLoading(false);
    }
  };

  // Server `balance` column is per-line (debit - credit); accumulate in date order
  // to produce the Tally-style running balance shown to the user.
  let _run = 0;
  const ledgerRows = ledger.map((line) => {
    _run += (line.debit || 0) - (line.credit || 0);
    return { ...line, running: _run };
  });
  const currentBalance = _run;
  const glassClass = isDark ? 'glass' : 'glass-light bg-white/80';

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className={`text-2xl font-black ${isDark ? 'text-white' : 'text-gray-900'}`}>B2B Running Ledger Account</h1>
          <p className={`text-xs mt-1 ${isDark ? 'text-[#5a6a8a]' : 'text-gray-500'}`}>
            Audit running statements, opening balance values, and process credit offset contra adjustments.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <select 
            value={selectedPartnerId} 
            onChange={(e) => setSelectedPartnerId(Number(e.target.value))}
            className={`px-3 py-1.5 text-xs font-semibold rounded-xl border focus:outline-none focus:border-brand-violet ${
              isDark ? 'bg-[#1f2937]/90 border-white/10 text-white' : 'bg-gray-50 border-gray-200 text-gray-800'
            }`}
          >
            {partners.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>

          <button
            onClick={() => setSetoffOpen(true)}
            className="btn-primary text-xs px-3.5 py-1.5 flex items-center gap-1.5"
          >
            <ArrowRightLeft size={13} />
            New Ledger Entry
          </button>
        </div>
      </div>

      {message && (
        <div className={`p-4 rounded-xl flex items-start gap-3 border ${
          message.type === 'success' 
            ? 'bg-green-500/10 border-green-500/20 text-green-400' 
            : 'bg-red-500/10 border-red-500/20 text-red-400'
        }`}>
          {message.type === 'success' ? <CheckCircle2 className="w-5 h-5 flex-shrink-0" /> : <AlertCircle className="w-5 h-5 flex-shrink-0" />}
          <span className="text-sm font-medium">{message.text}</span>
        </div>
      )}

      {/* Date Filter Bar */}
      <div className={`card p-4 rounded-2xl flex flex-col sm:flex-row items-center gap-4 ${glassClass}`}>
        <div className="flex items-center gap-2 text-xs font-semibold">
          <Calendar className="w-4 h-4 text-violet-400" />
          <span>Statement Duration:</span>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <input 
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className={`px-3 py-1.5 rounded-lg border text-xs outline-none ${
              isDark ? 'bg-[#1f2937] border-white/10 text-white' : 'bg-gray-50 border-gray-200 text-gray-800'
            }`}
          />
          <span className="text-xs">to</span>
          <input 
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className={`px-3 py-1.5 rounded-lg border text-xs outline-none ${
              isDark ? 'bg-[#1f2937] border-white/10 text-white' : 'bg-gray-50 border-gray-200 text-gray-800'
            }`}
          />
        </div>

        <div className="sm:ml-auto flex items-center gap-4">
          <div className="text-right">
            <span className={`text-[10px] uppercase font-bold tracking-wider ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Cumulative Balance</span>
            <p className={`text-base font-black ${isDark ? 'text-white' : 'text-gray-900'}`}>₹ {currentBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
          </div>
        </div>
      </div>

      {/* Ledger statement list */}
      <div className={`card overflow-hidden rounded-2xl ${glassClass}`}>
        {loading ? (
          <div className="h-48 flex items-center justify-center">
            <RefreshCw className="w-6 h-6 animate-spin text-[#8b5cf6]" />
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className={`border-b text-xs font-semibold uppercase tracking-wider ${isDark ? 'border-white/5 bg-[#111827]/40 text-gray-400' : 'border-gray-200 bg-gray-50 text-gray-500'}`}>
                <th className="py-4 px-6">Posting Date</th>
                <th className="py-4 px-6">Transaction Label</th>
                <th className="py-4 px-6 text-right">Debit (Dr)</th>
                <th className="py-4 px-6 text-right">Credit (Cr)</th>
                <th className="py-4 px-6 text-right">Balance</th>
              </tr>
            </thead>
            <tbody className={`divide-y text-sm ${isDark ? 'divide-white/5' : 'divide-gray-100'}`}>
              {ledgerRows.map((line) => (
                <tr
                  key={line.id}
                  className={`transition-colors ${isDark ? 'hover:bg-white/5' : 'hover:bg-gray-50'}`}
                >
                  <td className="py-3.5 px-6 font-mono text-xs">{line.date}</td>
                  <td className="py-3.5 px-6 font-bold">
                    {line.name || line.ref || '--'}
                    {line.ref && line.name && line.ref !== line.name && (
                      <span className={`block text-[10px] font-normal ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{line.ref}</span>
                    )}
                  </td>
                  <td className="py-3.5 px-6 text-right text-red-400 font-bold">
                    {line.debit > 0 ? `₹ ${line.debit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '-'}
                  </td>
                  <td className="py-3.5 px-6 text-right text-green-400 font-bold">
                    {line.credit > 0 ? `₹ ${line.credit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '-'}
                  </td>
                  <td className={`py-3.5 px-6 text-right font-bold ${line.running < 0 ? 'text-red-400' : isDark ? 'text-white' : 'text-gray-900'}`}>
                    ₹ {line.running.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}
              {!loading && ledgerRows.length === 0 && (
                <tr>
                  <td colSpan={5} className={`py-10 text-center text-sm ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                    No ledger entries for this partner in the selected range.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Contra Setoff Wizard Dialog */}
      {setoffOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in" onClick={() => setSetoffOpen(false)}>
          <div 
            className={`w-full max-w-md rounded-3xl border shadow-2xl overflow-hidden ${isDark ? 'bg-[#1e2440] border-[#2a3250]' : 'bg-white border-gray-200'}`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className={`p-4 border-b flex items-center justify-between ${isDark ? 'border-[#2a3250]' : 'border-gray-100'}`}>
              <div>
                <h3 className={`font-black text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>Manual Ledger Entry</h3>
                <p className={`text-[10px] ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>Post a credit/debit payment or offset AR/AP balances.</p>
              </div>
              <button onClick={() => setSetoffOpen(false)} className={`p-1.5 rounded-xl ${isDark ? 'hover:bg-white/5 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}>
                <X size={16} />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handlePostSetoff} className="p-5 space-y-4">
              <div>
                <label className="label text-[#5a6a8a]">Entry Type</label>
                <select
                  value={entryType}
                  onChange={(e) => setEntryType(e.target.value as EntryType)}
                  className={`input ${isDark ? 'bg-[#12172a] border-[#2a3250] text-white focus:border-violet-500' : ''}`}
                >
                  <option value="setoff">Internal Set-Off / Contra (Reconcile Bills &amp; Invoices)</option>
                  <option value="credit">Credit (They paid you / you owe them)</option>
                  <option value="debit">Debit (You paid them / they owe you)</option>
                </select>
              </div>
              <div>
                <label className="label text-[#5a6a8a]">Amount (₹)</label>
                <div className="relative">
                  <span className={`absolute left-3 top-1/2 -translate-y-1/2 font-bold text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>₹</span>
                  <input
                    type="number"
                    value={setoffAmount}
                    onChange={(e) => setSetoffAmount(e.target.value)}
                    placeholder="0.00"
                    required
                    min="0.01"
                    step="0.01"
                    className={`input pl-7 ${isDark ? 'bg-[#12172a] border-[#2a3250] text-white focus:border-violet-500' : ''}`}
                  />
                </div>
              </div>

              <div>
                <label className="label text-[#5a6a8a]">Reference / Note</label>
                <textarea
                  value={setoffNote}
                  onChange={(e) => setSetoffNote(e.target.value)}
                  rows={3}
                  placeholder="Reason for AR/AP contra setoff adjustments..."
                  className={`input resize-none ${isDark ? 'bg-[#12172a] border-[#2a3250] text-white focus:border-violet-500' : ''}`}
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setSetoffOpen(false)} className="btn-secondary flex-1 justify-center text-xs py-2.5">Cancel</button>
                <button type="submit" disabled={wizardLoading || !setoffAmount} className="btn-primary flex-1 justify-center text-xs py-2.5">
                  {wizardLoading ? <RefreshCw size={13} className="animate-spin" /> : 'Post Entry'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}


