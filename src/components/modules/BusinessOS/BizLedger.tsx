import { useState, useEffect, useCallback } from 'react';
import { searchRead, createRecord, odooCall } from '../../../services/odoo';
import { useTheme } from '../../../context/ThemeContext';
import {
  BookOpen, RefreshCw, PlusCircle,
  Users, Truck, Building2, UserCheck, Filter,
  CheckCircle2, AlertCircle,
} from 'lucide-react';

type MainTab = 'summary' | 'create' | 'partner' | 'agent' | 'vendor' | 'associate';

interface SummaryRow {
  id: number; party_type: string; party_name: string;
  party_id: number | false; debit: number; credit: number; balance: number;
}
interface LedgerLine {
  id: number; date: string; partner_id?: [number, string] | false;
  name?: string; ref?: string; debit: number; credit: number; balance: number;
}
interface AgentLine {
  id: number; date: string; agent_id: [number, string] | false;
  entry_type: string; amount_inr: number; reference: string; notes: string;
}
interface VendorLine {
  id: number; date: string; vendor_id: [number, string] | false;
  name: string; transfer_amount: number; deduction_amount: number;
  expected_cash_amount: number; actual_cash_received: number;
  received_by_id: [number, string] | false; payment_received: boolean; state: string;
}
interface AssociateLine {
  id: number; date: string; associate_id: [number, string] | false;
  entry_type: string; amount: number; note: string; reference: string;
}
interface Party { id: number; name: string; }

const TABS: { key: MainTab; label: string; icon: any }[] = [
  { key: 'summary',   label: 'Unified Summary',   icon: BookOpen   },
  { key: 'create',    label: 'Create Entry',       icon: PlusCircle },
  { key: 'partner',   label: 'Partner Ledger',     icon: Users      },
  { key: 'agent',     label: 'Agent Ledger',       icon: Truck      },
  { key: 'vendor',    label: 'Vendor Ledger',      icon: Building2  },
  { key: 'associate', label: 'Associate Ledger',   icon: UserCheck  },
];

const TXN_STATE: Record<string, { label: string; cls: string }> = {
  pending:  { label: 'Pending Cash',  cls: 'bg-red-500/15 text-red-400 border border-red-500/25' },
  received: { label: 'Cash Received', cls: 'bg-green-500/15 text-green-400 border border-green-500/25' },
  partial:  { label: 'Partial',       cls: 'bg-amber-500/15 text-amber-400 border border-amber-500/25' },
};
function StatusBadge({ state }: { state: string }) {
  const s = TXN_STATE[state] || { label: state || '--', cls: 'bg-gray-500/15 text-gray-400 border border-gray-500/25' };
  return <span className={`inline-block text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${s.cls}`}>{s.label}</span>;
}
function fmt(n: number) { return `Rs.${(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`; }
function fmtBalance(n: number, isDark: boolean) {
  const cls = n >= 0 ? 'text-green-400' : 'text-red-400';
  return <span className={cls}>{fmt(Math.abs(n))} {n >= 0 ? 'Dr' : 'Cr'}</span>;
}
function exportCsv(filename: string, headers: string[], data: (string | number)[][]) {
  const csv = [headers, ...data].map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function BizLedger() {
  const { isDark } = useTheme();
  const [tab, setTab] = useState<MainTab>('summary');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);

  // Reference lists
  const [partners, setPartners]     = useState<Party[]>([]);
  const [agents, setAgents]         = useState<Party[]>([]);
  const [vendors, setVendors]       = useState<Party[]>([]);
  const [associates, setAssociates] = useState<Party[]>([]);

  // Summary
  const [summary, setSummary]             = useState<SummaryRow[]>([]);
  const [summaryFilter, setSummaryFilter] = useState('');

  // Partner ledger
  const [partnerFilter, setPartnerFilter] = useState<number | ''>('');
  const [partnerLines, setPartnerLines]   = useState<LedgerLine[]>([]);
  const [partnerFrom, setPartnerFrom]     = useState('');
  const [partnerTo, setPartnerTo]         = useState('');

  // Agent ledger
  const [agentFilter, setAgentFilter] = useState<number | ''>('');
  const [agentLines, setAgentLines]   = useState<AgentLine[]>([]);
  const [agentFrom, setAgentFrom]     = useState('');
  const [agentTo, setAgentTo]         = useState('');

  // Vendor ledger
  const [vendorFilter, setVendorFilter] = useState<number | ''>('');
  const [vendorLines, setVendorLines]   = useState<VendorLine[]>([]);
  const [vendorFrom, setVendorFrom]     = useState('');
  const [vendorTo, setVendorTo]         = useState('');
  const [vendorTxns, setVendorTxns]     = useState<{ id: number; name: string }[]>([]);

  // Associate ledger
  const [associateFilter, setAssociateFilter] = useState<number | ''>('');
  const [associateLines, setAssociateLines]   = useState<AssociateLine[]>([]);
  const [assocFrom, setAssocFrom] = useState('');
  const [assocTo, setAssocTo]     = useState('');

  // Create entry form
  const [entryType, setEntryType] = useState('bank_transfer');
  const [entryForm, setEntryForm] = useState<Record<string, any>>({ date: new Date().toISOString().slice(0, 10) });
  const [submitting, setSubmitting] = useState(false);

  const showMsg = (ok: boolean, msg: string) => { setToast({ ok, msg }); setTimeout(() => setToast(null), 4000); };

  // Styles
  const cardBg = isDark ? 'bg-[#161b2e] border border-[#2a3250]' : 'bg-white border border-gray-200';
  const inp    = `input text-sm py-2 ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`;
  const thCls  = `text-left py-3 px-4 text-[10px] font-bold uppercase tracking-wider ${isDark ? 'text-[#5a6a8a]' : 'text-gray-500'}`;
  const tdCls  = `py-3 px-4 text-xs ${isDark ? 'text-[#ccd6f6]' : 'text-gray-700'}`;

  // Load reference lists on mount
  useEffect(() => {
    Promise.allSettled([
      searchRead<Party>('res.partner',              { fields: ['id', 'name'], domain: [['active', '=', true]], limit: 0 }),
      searchRead<Party>('biz.carrying.agent',       { fields: ['id', 'name'], limit: 0 }),
      searchRead<Party>('biz.bill.payment.vendor',  { fields: ['id', 'name'], limit: 0 }),
      searchRead<Party>('biz.money.associate',      { fields: ['id', 'name'], limit: 0 }),
    ]).then(([ps, as_, vs, acs]) => {
      if (ps.status  === 'fulfilled' && Array.isArray(ps.value))  setPartners(ps.value);
      if (as_.status === 'fulfilled' && Array.isArray(as_.value)) setAgents(as_.value);
      if (vs.status  === 'fulfilled' && Array.isArray(vs.value))  setVendors(vs.value);
      if (acs.status === 'fulfilled' && Array.isArray(acs.value)) setAssociates(acs.value);
    });
  }, []);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await searchRead<SummaryRow>('biz.unified.ledger.summary', {
        fields: ['id', 'party_type', 'party_name', 'party_id', 'debit', 'credit', 'balance'],
        limit: 0,
      });
      setSummary(Array.isArray(rows) ? rows : []);
    } catch (e: any) { showMsg(false, e.message); }
    finally { setLoading(false); }
  }, []);

  const loadPartnerLines = useCallback(async () => {
    setLoading(true);
    const domain: any[] = [];
    if (partnerFilter) domain.push(['partner_id', '=', partnerFilter]);
    if (partnerFrom)   domain.push(['date', '>=', partnerFrom]);
    if (partnerTo)     domain.push(['date', '<=', partnerTo]);
    try {
      const rows = await searchRead<LedgerLine>('biz.ledger', {
        fields: ['id', 'date', 'partner_id', 'name', 'ref', 'debit', 'credit', 'balance'],
        domain, limit: 0, order: 'date asc',
      });
      setPartnerLines(Array.isArray(rows) ? rows : []);
    } catch (e: any) { showMsg(false, e.message); }
    finally { setLoading(false); }
  }, [partnerFilter, partnerFrom, partnerTo]);

  const loadAgentLines = useCallback(async () => {
    setLoading(true);
    const domain: any[] = [];
    if (agentFilter) domain.push(['agent_id', '=', agentFilter]);
    if (agentFrom)   domain.push(['date', '>=', agentFrom]);
    if (agentTo)     domain.push(['date', '<=', agentTo]);
    try {
      const rows = await searchRead<AgentLine>('biz.agent.ledger', {
        fields: ['id', 'date', 'agent_id', 'entry_type', 'amount_inr', 'reference', 'notes'],
        domain, limit: 0, order: 'date asc',
      });
      setAgentLines(Array.isArray(rows) ? rows : []);
    } catch (e: any) { showMsg(false, e.message); }
    finally { setLoading(false); }
  }, [agentFilter, agentFrom, agentTo]);

  const loadVendorLines = useCallback(async () => {
    setLoading(true);
    const domain: any[] = [];
    if (vendorFilter) domain.push(['vendor_id', '=', vendorFilter]);
    if (vendorFrom)   domain.push(['date', '>=', vendorFrom]);
    if (vendorTo)     domain.push(['date', '<=', vendorTo]);
    try {
      const rows = await searchRead<VendorLine>('biz.bill.payment.transaction', {
        fields: ['id', 'date', 'vendor_id', 'name', 'transfer_amount', 'deduction_amount',
                 'expected_cash_amount', 'actual_cash_received', 'received_by_id', 'payment_received', 'state'],
        domain, limit: 0, order: 'date asc',
      });
      setVendorLines(Array.isArray(rows) ? rows : []);
    } catch (e: any) { showMsg(false, e.message); }
    finally { setLoading(false); }
  }, [vendorFilter, vendorFrom, vendorTo]);

  const loadAssociateLines = useCallback(async () => {
    setLoading(true);
    const domain: any[] = [];
    if (associateFilter) domain.push(['associate_id', '=', associateFilter]);
    if (assocFrom)       domain.push(['date', '>=', assocFrom]);
    if (assocTo)         domain.push(['date', '<=', assocTo]);
    try {
      const rows = await searchRead<AssociateLine>('biz.associate.ledger', {
        fields: ['id', 'date', 'associate_id', 'entry_type', 'amount', 'note', 'reference'],
        domain, limit: 0, order: 'date asc',
      });
      setAssociateLines(Array.isArray(rows) ? rows : []);
    } catch (e: any) { showMsg(false, e.message); }
    finally { setLoading(false); }
  }, [associateFilter, assocFrom, assocTo]);

  useEffect(() => {
    if (tab === 'summary')   loadSummary();
    if (tab === 'partner')   loadPartnerLines();
    if (tab === 'agent')     loadAgentLines();
    if (tab === 'vendor')    loadVendorLines();
    if (tab === 'associate') loadAssociateLines();
  }, [tab]);

  const loadVendorTxns = async (vendorId: number) => {
    try {
      const r = await searchRead<{ id: number; name: string }>('biz.bill.payment.transaction', {
        fields: ['id', 'name'],
        domain: [['vendor_id', '=', vendorId], ['payment_received', '=', false]],
        limit: 50,
      });
      setVendorTxns(r || []);
    } catch { setVendorTxns([]); }
  };

  // Drill-down from summary row
  const viewLedger = (r: SummaryRow) => {
    const pid = typeof r.party_id === 'number' ? r.party_id : '';
    if (r.party_type === 'vendor')    { setVendorFilter(pid);    setTab('vendor');    }
    else if (r.party_type === 'associate') { setAssociateFilter(pid); setTab('associate'); }
    else if (r.party_type === 'agent')     { setAgentFilter(pid);     setTab('agent');     }
    else                               { setPartnerFilter(pid);   setTab('partner');   }
  };

  const handleCreateEntry = async () => {
    setSubmitting(true);
    try {
      if (entryType === 'manual_partner') {
        if (!entryForm.partner_id || !entryForm.amount) throw new Error('Partner and amount required.');
        const wizardId = await createRecord('biz.manual.entry.wizard', {
          partner_id: entryForm.partner_id,
          date: entryForm.date,
          narration: entryForm.narration || '',
          amount: parseFloat(entryForm.amount),
          entry_type: entryForm.manual_type || 'debit',
        });
        await odooCall('biz.manual.entry.wizard', 'action_post_entry', [[wizardId]], {});
        showMsg(true, 'Partner journal entry posted.');
      } else {
        const vals: Record<string, any> = { entry_type: entryType, date: entryForm.date, note: entryForm.note || '' };
        if (entryType === 'bank_transfer') {
          vals.vendor_id = entryForm.vendor_id;
          vals.transfer_amount = parseFloat(entryForm.transfer_amount || 0);
          vals.deduction_percent = parseFloat(entryForm.deduction_percent || 0);
        } else if (entryType === 'receive_payment') {
          vals.vendor_id = entryForm.vendor_id;
          if (entryForm.transaction_id) vals.transaction_id = entryForm.transaction_id;
          vals.received_by_id = entryForm.received_by_id;
          vals.actual_cash_received = parseFloat(entryForm.payment_received || 0);
        } else if (entryType === 'agent_payment') {
          vals.vendor_id = entryForm.vendor_id;
          if (entryForm.transaction_id) vals.transaction_id = entryForm.transaction_id;
          vals.agent_payment_source = entryForm.agent_payment_source || 'vendor';
          vals.carrying_agent_id = entryForm.carrying_agent_id;
          vals.agent_payment_amount = parseFloat(entryForm.agent_payment_amount || 0);
          if ((entryForm.agent_payment_source || 'vendor') === 'associate') vals.received_by_id = entryForm.received_by_id;
        } else if (entryType === 'expense') {
          vals.received_by_id = entryForm.received_by_id;
          vals.actual_cash_received = parseFloat(entryForm.expense_amount || 0);
        } else if (entryType === 'associate_transfer') {
          vals.received_by_id = entryForm.from_associate_id;
          vals.to_associate_id = entryForm.to_associate_id;
          vals.actual_cash_received = parseFloat(entryForm.transfer_amount || 0);
        }
        const wizardId = await createRecord('biz.bill.payment.entry.wizard', vals);
        await odooCall('biz.bill.payment.entry.wizard', 'action_apply', [[wizardId]], {});
        showMsg(true, 'Entry applied successfully.');
      }
      setEntryForm({ date: new Date().toISOString().slice(0, 10) });
      setVendorTxns([]);
    } catch (e: any) { showMsg(false, 'Failed: ' + e.message); }
    finally { setSubmitting(false); }
  };

  // Summary — grouped by party_type
  const PARTY_LABELS: Record<string, string> = {
    partner: 'Partners', vendor: 'Vendors', associate: 'Money Associates', agent: 'Carrying Agents',
  };
  const filteredSummary = summary.filter(r =>
    !summaryFilter || r.party_name?.toLowerCase().includes(summaryFilter.toLowerCase())
  );
  const grouped = Object.entries(
    filteredSummary.reduce((acc, r) => {
      const k = r.party_type || 'other';
      if (!acc[k]) acc[k] = [];
      acc[k].push(r);
      return acc;
    }, {} as Record<string, SummaryRow[]>)
  );

  return (
    <div className="space-y-5 animate-fade-in">
      {toast && (
        <div className={`fixed top-5 right-5 z-50 px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 text-sm font-medium animate-fade-in
          ${toast.ok ? 'bg-green-500/15 border border-green-500/30 text-green-400' : 'bg-red-500/15 border border-red-500/30 text-red-400'}`}>
          {toast.ok ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />} {toast.msg}
        </div>
      )}

      <div>
        <h1 className={`text-xl font-black ${isDark ? 'text-white' : 'text-gray-900'}`}>Unified Ledger</h1>
        <p className={`text-xs mt-0.5 ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>
          Full ledger view: partners, agents, vendors &amp; associates
        </p>
      </div>

      {/* Tab bar */}
      <div className={`flex overflow-x-auto gap-1 border-b ${isDark ? 'border-[#2a3250]' : 'border-gray-200'}`}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-shrink-0 flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-all whitespace-nowrap ${
              tab === t.key
                ? 'border-[#7367f0] text-[#7367f0]'
                : `border-transparent ${isDark ? 'text-[#6a7a9a] hover:text-white' : 'text-gray-500 hover:text-gray-900'}`
            }`}>
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      {/* ── Summary ── */}
      {tab === 'summary' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <input value={summaryFilter} onChange={e => setSummaryFilter(e.target.value)}
              placeholder="Filter by party name..." className={`${inp} flex-1 max-w-xs`} />
            <button onClick={loadSummary} disabled={loading} className="btn-secondary text-xs px-3 py-2 flex items-center gap-1.5">
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
          {loading ? (
            <div className={`${cardBg} rounded-2xl h-32 flex items-center justify-center`}>
              <RefreshCw size={18} className="animate-spin text-[#7367f0]" />
            </div>
          ) : grouped.length === 0 ? (
            <div className={`${cardBg} rounded-2xl py-12 text-center text-sm ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>
              No ledger data found.
            </div>
          ) : (
            grouped.map(([ptype, rows]) => (
              <div key={ptype} className={`${cardBg} rounded-2xl overflow-hidden`}>
                <div className={`px-5 py-3 border-b ${isDark ? 'border-[#2a3250]' : 'border-gray-100'} flex items-center justify-between`}>
                  <h3 className={`font-bold text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>{PARTY_LABELS[ptype] || ptype}</h3>
                  <span className={`text-xs ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>{rows.length} entries</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead><tr className={isDark ? 'bg-[#1e2440]/60' : 'bg-gray-50'}>
                      <th className={thCls}>Party</th>
                      <th className={`${thCls} text-right`}>Debit</th>
                      <th className={`${thCls} text-right`}>Credit</th>
                      <th className={`${thCls} text-right`}>Balance</th>
                      <th className={`${thCls} text-center`}>Ledger</th>
                    </tr></thead>
                    <tbody className={`divide-y ${isDark ? 'divide-[#2a3250]' : 'divide-gray-100'}`}>
                      {rows.map(r => (
                        <tr key={r.id} className={isDark ? 'hover:bg-white/3' : 'hover:bg-gray-50'}>
                          <td className={`${tdCls} font-semibold`}>{r.party_name || '--'}</td>
                          <td className={`${tdCls} text-right text-red-400`}>{fmt(r.debit)}</td>
                          <td className={`${tdCls} text-right text-green-400`}>{fmt(r.credit)}</td>
                          <td className={`${tdCls} text-right font-bold`}>{fmtBalance(r.balance, isDark)}</td>
                          <td className={`${tdCls} text-center`}>
                            <button onClick={() => viewLedger(r)} className="text-[11px] font-semibold text-[#7367f0] hover:underline inline-flex items-center gap-1">
                              <BookOpen size={11} /> View Ledger
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Create Entry ── */}
      {tab === 'create' && (
        <div className="max-w-lg space-y-4">
          <div className={`${cardBg} rounded-2xl p-4`}>
            <p className={`text-[10px] font-bold uppercase tracking-wider mb-3 ${isDark ? 'text-[#5a6a8a]' : 'text-gray-500'}`}>Entry Type</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { key: 'bank_transfer',      label: 'Bank Transfer',       desc: 'New vendor payment order' },
                { key: 'receive_payment',    label: 'Receive Cash',        desc: 'Mark cash received for order' },
                { key: 'agent_payment',      label: 'Agent Payment',       desc: 'Carrying agent payment' },
                { key: 'expense',            label: 'Expense',             desc: 'Record associate expense' },
                { key: 'associate_transfer', label: 'Associate Transfer',  desc: 'Transfer between associates' },
                { key: 'manual_partner',     label: 'Manual Partner',      desc: 'Partner debit / credit / setoff' },
              ].map(t => (
                <button key={t.key} type="button"
                  onClick={() => { setEntryType(t.key); setEntryForm({ date: new Date().toISOString().slice(0, 10) }); setVendorTxns([]); }}
                  className={`p-3 rounded-xl border text-left transition-all ${entryType === t.key
                    ? 'border-[#7367f0] bg-[#7367f0]/10'
                    : isDark ? 'border-[#2a3250] hover:border-[#7367f0]/50' : 'border-gray-200 hover:border-violet-300'}`}>
                  <p className={`text-xs font-bold ${entryType === t.key ? 'text-[#7367f0]' : isDark ? 'text-white' : 'text-gray-800'}`}>{t.label}</p>
                  <p className={`text-[10px] mt-0.5 ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>{t.desc}</p>
                </button>
              ))}
            </div>
          </div>

          <div className={`${cardBg} rounded-2xl p-5 space-y-4`}>
            {/* Date */}
            <div>
              <label className={`text-[10px] font-semibold block mb-1 ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>Date *</label>
              <input type="date" value={entryForm.date || ''} onChange={e => setEntryForm(p => ({ ...p, date: e.target.value }))} className={`${inp} w-full`} />
            </div>

            {/* bank_transfer */}
            {entryType === 'bank_transfer' && (<>
              <div>
                <label className={`text-[10px] font-semibold block mb-1 ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>Vendor *</label>
                <select value={entryForm.vendor_id || ''} onChange={e => setEntryForm(p => ({ ...p, vendor_id: Number(e.target.value) || '' }))} className={`${inp} w-full`}>
                  <option value="">-- Select Vendor --</option>
                  {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={`text-[10px] font-semibold block mb-1 ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>Transfer Amount (Rs.) *</label>
                  <input type="number" min="0.01" step="0.01" value={entryForm.transfer_amount || ''} onChange={e => setEntryForm(p => ({ ...p, transfer_amount: e.target.value }))} placeholder="0.00" className={`${inp} w-full`} />
                </div>
                <div>
                  <label className={`text-[10px] font-semibold block mb-1 ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>Deduction % (agent fee)</label>
                  <input type="number" min="0" max="100" step="0.01" value={entryForm.deduction_percent || ''} onChange={e => setEntryForm(p => ({ ...p, deduction_percent: e.target.value }))} placeholder="0.00" className={`${inp} w-full`} />
                </div>
              </div>
              {entryForm.transfer_amount && entryForm.deduction_percent && (
                <div className={`p-3 rounded-xl text-xs ${isDark ? 'bg-[#1e2440]' : 'bg-gray-50'}`}>
                  <span className={isDark ? 'text-[#5a6a8a]' : 'text-gray-500'}>Expected Cash: </span>
                  <span className="font-bold text-[#7367f0]">
                    Rs.{(parseFloat(entryForm.transfer_amount) * (1 - parseFloat(entryForm.deduction_percent) / 100)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </span>
                </div>
              )}
              <div>
                <label className={`text-[10px] font-semibold block mb-1 ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>Note</label>
                <textarea rows={2} value={entryForm.note || ''} onChange={e => setEntryForm(p => ({ ...p, note: e.target.value }))} className={`${inp} resize-none w-full`} />
              </div>
            </>)}

            {/* receive_payment */}
            {entryType === 'receive_payment' && (<>
              <div>
                <label className={`text-[10px] font-semibold block mb-1 ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>Vendor *</label>
                <select value={entryForm.vendor_id || ''} onChange={e => { const v = Number(e.target.value); setEntryForm(p => ({ ...p, vendor_id: v || '', transaction_id: '' })); if (v) loadVendorTxns(v); }} className={`${inp} w-full`}>
                  <option value="">-- Select Vendor --</option>
                  {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </div>
              {entryForm.vendor_id && (
                <div>
                  <label className={`text-[10px] font-semibold block mb-1 ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>Pending Transaction *</label>
                  <select value={entryForm.transaction_id || ''} onChange={e => setEntryForm(p => ({ ...p, transaction_id: Number(e.target.value) || '' }))} className={`${inp} w-full`}>
                    <option value="">-- Select Transaction --</option>
                    {vendorTxns.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className={`text-[10px] font-semibold block mb-1 ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>Received By (Associate) *</label>
                <select value={entryForm.received_by_id || ''} onChange={e => setEntryForm(p => ({ ...p, received_by_id: Number(e.target.value) || '' }))} className={`${inp} w-full`}>
                  <option value="">-- Select Associate --</option>
                  {associates.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div>
                <label className={`text-[10px] font-semibold block mb-1 ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>Actual Cash Received (Rs.) *</label>
                <input type="number" min="0.01" step="0.01" value={entryForm.payment_received || ''} onChange={e => setEntryForm(p => ({ ...p, payment_received: e.target.value }))} placeholder="0.00" className={`${inp} w-full`} />
              </div>
              <div>
                <label className={`text-[10px] font-semibold block mb-1 ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>Note</label>
                <textarea rows={2} value={entryForm.note || ''} onChange={e => setEntryForm(p => ({ ...p, note: e.target.value }))} className={`${inp} resize-none w-full`} />
              </div>
            </>)}

            {/* agent_payment */}
            {entryType === 'agent_payment' && (<>
              <div>
                <label className={`text-[10px] font-semibold block mb-1 ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>Vendor *</label>
                <select value={entryForm.vendor_id || ''} onChange={e => { const v = Number(e.target.value); setEntryForm(p => ({ ...p, vendor_id: v || '', transaction_id: '' })); if (v) loadVendorTxns(v); }} className={`${inp} w-full`}>
                  <option value="">-- Select Vendor --</option>
                  {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </div>
              {entryForm.vendor_id && (
                <div>
                  <label className={`text-[10px] font-semibold block mb-1 ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>Transaction</label>
                  <select value={entryForm.transaction_id || ''} onChange={e => setEntryForm(p => ({ ...p, transaction_id: Number(e.target.value) || '' }))} className={`${inp} w-full`}>
                    <option value="">-- Select Transaction --</option>
                    {vendorTxns.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className={`text-[10px] font-semibold block mb-1 ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>Paid By</label>
                <select value={entryForm.agent_payment_source || 'vendor'} onChange={e => setEntryForm(p => ({ ...p, agent_payment_source: e.target.value }))} className={`${inp} w-full`}>
                  <option value="vendor">Business funds paid agent</option>
                  <option value="associate">Associate paid agent</option>
                </select>
              </div>
              {(entryForm.agent_payment_source || 'vendor') === 'associate' && (
                <div>
                  <label className={`text-[10px] font-semibold block mb-1 ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>Associate Who Paid *</label>
                  <select value={entryForm.received_by_id || ''} onChange={e => setEntryForm(p => ({ ...p, received_by_id: Number(e.target.value) || '' }))} className={`${inp} w-full`}>
                    <option value="">-- Select Associate --</option>
                    {associates.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className={`text-[10px] font-semibold block mb-1 ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>Carrying Agent *</label>
                <select value={entryForm.carrying_agent_id || ''} onChange={e => setEntryForm(p => ({ ...p, carrying_agent_id: Number(e.target.value) || '' }))} className={`${inp} w-full`}>
                  <option value="">-- Select Agent --</option>
                  {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div>
                <label className={`text-[10px] font-semibold block mb-1 ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>Agent Payment Amount (Rs.) *</label>
                <input type="number" min="0.01" step="0.01" value={entryForm.agent_payment_amount || ''} onChange={e => setEntryForm(p => ({ ...p, agent_payment_amount: e.target.value }))} placeholder="0.00" className={`${inp} w-full`} />
              </div>
              <div>
                <label className={`text-[10px] font-semibold block mb-1 ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>Note</label>
                <textarea rows={2} value={entryForm.note || ''} onChange={e => setEntryForm(p => ({ ...p, note: e.target.value }))} className={`${inp} resize-none w-full`} />
              </div>
            </>)}

            {/* expense */}
            {entryType === 'expense' && (<>
              <div>
                <label className={`text-[10px] font-semibold block mb-1 ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>Paid By (Associate) *</label>
                <select value={entryForm.received_by_id || ''} onChange={e => setEntryForm(p => ({ ...p, received_by_id: Number(e.target.value) || '' }))} className={`${inp} w-full`}>
                  <option value="">-- Select Associate --</option>
                  {associates.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div>
                <label className={`text-[10px] font-semibold block mb-1 ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>Expense Amount (Rs.) *</label>
                <input type="number" min="0.01" step="0.01" value={entryForm.expense_amount || ''} onChange={e => setEntryForm(p => ({ ...p, expense_amount: e.target.value }))} placeholder="0.00" className={`${inp} w-full`} />
              </div>
              <div>
                <label className={`text-[10px] font-semibold block mb-1 ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>Note / Description *</label>
                <textarea rows={3} value={entryForm.note || ''} onChange={e => setEntryForm(p => ({ ...p, note: e.target.value }))} placeholder="What was this expense for?" className={`${inp} resize-none w-full`} />
              </div>
            </>)}

            {/* associate_transfer */}
            {entryType === 'associate_transfer' && (<>
              <div>
                <label className={`text-[10px] font-semibold block mb-1 ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>From Associate *</label>
                <select value={entryForm.from_associate_id || ''} onChange={e => setEntryForm(p => ({ ...p, from_associate_id: Number(e.target.value) || '' }))} className={`${inp} w-full`}>
                  <option value="">-- Select Associate --</option>
                  {associates.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div>
                <label className={`text-[10px] font-semibold block mb-1 ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>To Associate *</label>
                <select value={entryForm.to_associate_id || ''} onChange={e => setEntryForm(p => ({ ...p, to_associate_id: Number(e.target.value) || '' }))} className={`${inp} w-full`}>
                  <option value="">-- Select Associate --</option>
                  {associates.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div>
                <label className={`text-[10px] font-semibold block mb-1 ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>Transfer Amount (Rs.) *</label>
                <input type="number" min="0.01" step="0.01" value={entryForm.transfer_amount || ''} onChange={e => setEntryForm(p => ({ ...p, transfer_amount: e.target.value }))} placeholder="0.00" className={`${inp} w-full`} />
              </div>
              <div>
                <label className={`text-[10px] font-semibold block mb-1 ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>Note</label>
                <textarea rows={2} value={entryForm.note || ''} onChange={e => setEntryForm(p => ({ ...p, note: e.target.value }))} className={`${inp} resize-none w-full`} />
              </div>
            </>)}

            {/* manual_partner */}
            {entryType === 'manual_partner' && (<>
              <div>
                <label className={`text-[10px] font-semibold block mb-1 ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>Partner *</label>
                <select value={entryForm.partner_id || ''} onChange={e => setEntryForm(p => ({ ...p, partner_id: Number(e.target.value) || '' }))} className={`${inp} w-full`}>
                  <option value="">-- Select Partner --</option>
                  {partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={`text-[10px] font-semibold block mb-1 ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>Amount (Rs.) *</label>
                  <input type="number" min="0.01" step="0.01" value={entryForm.amount || ''} onChange={e => setEntryForm(p => ({ ...p, amount: e.target.value }))} placeholder="0.00" className={`${inp} w-full`} />
                </div>
                <div>
                  <label className={`text-[10px] font-semibold block mb-1 ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>Entry Type *</label>
                  <select value={entryForm.manual_type || 'debit'} onChange={e => setEntryForm(p => ({ ...p, manual_type: e.target.value }))} className={`${inp} w-full`}>
                    <option value="debit">Debit (Partner owes us)</option>
                    <option value="credit">Credit (We owe partner)</option>
                    <option value="setoff">Set-off</option>
                  </select>
                </div>
              </div>
              <div>
                <label className={`text-[10px] font-semibold block mb-1 ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>Narration</label>
                <textarea rows={3} value={entryForm.narration || ''} onChange={e => setEntryForm(p => ({ ...p, narration: e.target.value }))} placeholder="Description--" className={`${inp} resize-none w-full`} />
              </div>
            </>)}

            <button type="button" onClick={handleCreateEntry} disabled={submitting} className="btn-primary w-full justify-center py-3 text-sm flex items-center gap-2">
              {submitting ? <RefreshCw size={14} className="animate-spin" /> : <PlusCircle size={14} />}
              {submitting ? 'Processing...' : 'Apply Entry'}
            </button>
          </div>
        </div>
      )}

      {/* ── Partner Ledger ── */}
      {tab === 'partner' && (
        <div className="space-y-4">
          <LedgerFilters isDark={isDark} inp={inp}
            selectLabel="Partner" selectValue={partnerFilter} selectOptions={partners}
            onSelectChange={v => setPartnerFilter(v)} dateFrom={partnerFrom} dateTo={partnerTo}
            onDateFrom={setPartnerFrom} onDateTo={setPartnerTo}
            onApply={loadPartnerLines} loading={loading}
            onExport={() => exportCsv('partner-ledger',
              ['Date', 'Description', 'Ref', 'Debit', 'Credit', 'Balance'],
              partnerLines.map(r => [r.date, r.name || '', r.ref || '', r.debit || 0, r.credit || 0, r.balance || 0]))}
          />
          <LedgerTable loading={loading} isDark={isDark} cardBg={cardBg} thCls={thCls} tdCls={tdCls}
            columns={['Date', 'Description', 'Ref', 'Debit', 'Credit', 'Running Balance']}
            rows={(() => {
              let running = 0;
              return partnerLines.map(r => {
                running += (r.debit || 0) - (r.credit || 0);
                return [
                  r.date,
                  r.name || '--',
                  r.ref || '--',
                  <span className="text-red-400">{r.debit > 0 ? fmt(r.debit) : '--'}</span>,
                  <span className="text-green-400">{r.credit > 0 ? fmt(r.credit) : '--'}</span>,
                  fmtBalance(running, isDark),
                ];
              });
            })()}
            totals={['Totals', '', '',
              <span className="text-red-400 font-bold">{fmt(partnerLines.reduce((s, r) => s + (r.debit || 0), 0))}</span>,
              <span className="text-green-400 font-bold">{fmt(partnerLines.reduce((s, r) => s + (r.credit || 0), 0))}</span>,
              fmtBalance(partnerLines.reduce((s, r) => s + (r.debit || 0) - (r.credit || 0), 0), isDark),
            ]}
          />
        </div>
      )}

      {/* ── Agent Ledger ── */}
      {tab === 'agent' && (
        <div className="space-y-4">
          <LedgerFilters isDark={isDark} inp={inp}
            selectLabel="Agent" selectValue={agentFilter} selectOptions={agents}
            onSelectChange={v => setAgentFilter(v)} dateFrom={agentFrom} dateTo={agentTo}
            onDateFrom={setAgentFrom} onDateTo={setAgentTo}
            onApply={loadAgentLines} loading={loading}
            onExport={() => exportCsv('agent-ledger',
              ['Date', 'Agent', 'Type', 'Reference', 'Amount (Rs.)', 'Notes'],
              agentLines.map(r => [r.date, Array.isArray(r.agent_id) ? r.agent_id[1] : '', r.entry_type || '', r.reference || '', r.amount_inr || 0, r.notes || '']))}
          />
          <LedgerTable loading={loading} isDark={isDark} cardBg={cardBg} thCls={thCls} tdCls={tdCls}
            columns={['Date', 'Agent', 'Type', 'Reference', 'Amount', 'Notes']}
            rows={agentLines.map(r => [
              r.date,
              Array.isArray(r.agent_id) ? r.agent_id[1] : '--',
              <span className="capitalize">{r.entry_type?.replace(/_/g, ' ') || '--'}</span>,
              r.reference || '--',
              <span className="font-semibold">{fmt(r.amount_inr)}</span>,
              r.notes || '--',
            ])}
            totals={['Totals', '', '', '',
              <span className="font-bold text-[#7367f0]">{fmt(agentLines.reduce((s, r) => s + (r.amount_inr || 0), 0))}</span>,
              '',
            ]}
          />
        </div>
      )}

      {/* ── Vendor Ledger ── */}
      {tab === 'vendor' && (
        <div className="space-y-4">
          <LedgerFilters isDark={isDark} inp={inp}
            selectLabel="Vendor" selectValue={vendorFilter} selectOptions={vendors}
            onSelectChange={v => setVendorFilter(v)} dateFrom={vendorFrom} dateTo={vendorTo}
            onDateFrom={setVendorFrom} onDateTo={setVendorTo}
            onApply={loadVendorLines} loading={loading}
            onExport={() => exportCsv('vendor-ledger',
              ['Date', 'Reference', 'Vendor', 'Bank Transfer', 'Deducted', 'Expected Cash', 'Actual Cash', 'Received By', 'Status'],
              vendorLines.map(r => [r.date, r.name || '', Array.isArray(r.vendor_id) ? r.vendor_id[1] : '', r.transfer_amount || 0, r.deduction_amount || 0, r.expected_cash_amount || 0, r.actual_cash_received || 0, Array.isArray(r.received_by_id) ? r.received_by_id[1] : '', TXN_STATE[r.state]?.label || r.state || '']))}
          />
          <LedgerTable loading={loading} isDark={isDark} cardBg={cardBg} thCls={thCls} tdCls={tdCls}
            columns={['Date', 'Reference', 'Vendor', 'Bank Transfer', 'Deducted', 'Expected Cash', 'Actual Cash', 'Received By', 'Status']}
            rows={vendorLines.map(r => [
              r.date,
              <span className="font-mono text-[#7367f0]">{r.name || '--'}</span>,
              Array.isArray(r.vendor_id) ? r.vendor_id[1] : '--',
              <span className="text-blue-400">{fmt(r.transfer_amount)}</span>,
              <span className="text-red-400">{fmt(r.deduction_amount)}</span>,
              <span className="text-amber-400">{fmt(r.expected_cash_amount)}</span>,
              <span className="text-green-400">{fmt(r.actual_cash_received)}</span>,
              Array.isArray(r.received_by_id) ? r.received_by_id[1] : '--',
              <StatusBadge state={r.state} />,
            ])}
            totals={['Totals', '', '',
              <span className="text-blue-400 font-bold">{fmt(vendorLines.reduce((s, r) => s + (r.transfer_amount || 0), 0))}</span>,
              <span className="text-red-400 font-bold">{fmt(vendorLines.reduce((s, r) => s + (r.deduction_amount || 0), 0))}</span>,
              <span className="text-amber-400 font-bold">{fmt(vendorLines.reduce((s, r) => s + (r.expected_cash_amount || 0), 0))}</span>,
              <span className="text-green-400 font-bold">{fmt(vendorLines.reduce((s, r) => s + (r.actual_cash_received || 0), 0))}</span>,
              '', '',
            ]}
          />
        </div>
      )}

      {/* ── Associate Ledger ── */}
      {tab === 'associate' && (
        <div className="space-y-4">
          <LedgerFilters isDark={isDark} inp={inp}
            selectLabel="Associate" selectValue={associateFilter} selectOptions={associates}
            onSelectChange={v => setAssociateFilter(v)} dateFrom={assocFrom} dateTo={assocTo}
            onDateFrom={setAssocFrom} onDateTo={setAssocTo}
            onApply={loadAssociateLines} loading={loading}
            onExport={() => exportCsv('associate-ledger',
              ['Date', 'Associate', 'Type', 'Amount', 'Reference', 'Note'],
              associateLines.map(r => [r.date, Array.isArray(r.associate_id) ? r.associate_id[1] : '', r.entry_type || '', r.amount || 0, r.reference || '', r.note || '']))}
          />
          <LedgerTable loading={loading} isDark={isDark} cardBg={cardBg} thCls={thCls} tdCls={tdCls}
            columns={['Date', 'Associate', 'Type', 'Amount', 'Reference', 'Note']}
            rows={associateLines.map(r => [
              r.date,
              Array.isArray(r.associate_id) ? r.associate_id[1] : '--',
              <span className="capitalize">{r.entry_type?.replace(/_/g, ' ') || '--'}</span>,
              <span className="font-semibold">{fmt(r.amount)}</span>,
              r.reference || '--',
              r.note || '--',
            ])}
            totals={['Totals', '', '',
              <span className="font-bold text-[#7367f0]">{fmt(associateLines.reduce((s, r) => s + (r.amount || 0), 0))}</span>,
              '', '',
            ]}
          />
        </div>
      )}
    </div>
  );
}

function LedgerFilters({ isDark, inp, selectLabel, selectValue, selectOptions, onSelectChange, dateFrom, dateTo, onDateFrom, onDateTo, onApply, loading, onExport }: {
  isDark: boolean; inp: string; selectLabel: string;
  selectValue: number | ''; selectOptions: { id: number; name: string }[];
  onSelectChange: (v: number | '') => void;
  dateFrom: string; dateTo: string;
  onDateFrom: (s: string) => void; onDateTo: (s: string) => void;
  onApply: () => void; loading: boolean; onExport: () => void;
}) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <select value={selectValue} onChange={e => onSelectChange(Number(e.target.value) || '')} className={`${inp} w-52`}>
        <option value="">All {selectLabel}s</option>
        {selectOptions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <input type="date" value={dateFrom} onChange={e => onDateFrom(e.target.value)} className={`${inp} w-36`} title="From" />
      <span className={isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}>to</span>
      <input type="date" value={dateTo} onChange={e => onDateTo(e.target.value)} className={`${inp} w-36`} title="To" />
      <button onClick={onApply} disabled={loading} className="btn-secondary text-xs px-3 py-2 flex items-center gap-1.5">
        <Filter size={13} className={loading ? 'animate-spin' : ''} /> Apply
      </button>
      <button onClick={onExport} className={`text-xs px-3 py-2 rounded-xl border font-semibold flex items-center gap-1.5 ${isDark ? 'border-[#2a3250] text-[#5a6a8a] hover:text-white hover:border-[#7367f0]' : 'border-gray-200 text-gray-500 hover:text-gray-900'}`}>
        Export CSV
      </button>
    </div>
  );
}

function LedgerTable({ loading, isDark, cardBg, thCls, tdCls, columns, rows, totals }: {
  loading: boolean; isDark: boolean; cardBg: string; thCls: string; tdCls: string;
  columns: string[]; rows: (string | JSX.Element)[][];
  totals?: (string | JSX.Element)[];
}) {
  if (loading) {
    return (
      <div className={`${cardBg} rounded-2xl h-32 flex items-center justify-center`}>
        <RefreshCw size={18} className="animate-spin text-[#7367f0]" />
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className={`${cardBg} rounded-2xl py-12 text-center text-sm ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>
        No records found. Apply a filter and click Apply.
      </div>
    );
  }
  return (
    <div className={`${cardBg} rounded-2xl overflow-hidden`}>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead><tr className={isDark ? 'bg-[#1e2440]/60' : 'bg-gray-50'}>
            {columns.map(c => <th key={c} className={thCls}>{c}</th>)}
          </tr></thead>
          <tbody className={`divide-y ${isDark ? 'divide-[#2a3250]' : 'divide-gray-100'}`}>
            {rows.map((row, i) => (
              <tr key={i} className={isDark ? 'hover:bg-white/3' : 'hover:bg-gray-50'}>
                {row.map((cell, j) => <td key={j} className={tdCls}>{cell}</td>)}
              </tr>
            ))}
          </tbody>
          {totals && (
            <tfoot>
              <tr className={`border-t-2 ${isDark ? 'border-[#2a3250] bg-[#1e2440]/80' : 'border-gray-300 bg-gray-100'}`}>
                {totals.map((cell, j) => (
                  <td key={j} className={`py-3 px-4 text-xs font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>{cell}</td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <div className={`px-4 py-2 text-xs ${isDark ? 'text-[#4a5580] border-t border-[#2a3250]' : 'text-gray-400 border-t border-gray-100'}`}>
        {rows.length} record{rows.length !== 1 ? 's' : ''}
      </div>
    </div>
  );
}
