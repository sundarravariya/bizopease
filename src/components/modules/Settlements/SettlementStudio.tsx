import { useState, useEffect, useCallback, useDeferredValue } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { searchRead, createRecord, odooCall } from '../../../services/odoo';
import { useTheme } from '../../../context/ThemeContext';
import {
  Search, Plus, X, RefreshCw, ChevronRight, Download, ArrowUpRight, ArrowDownLeft,
  Wallet, Building2, UserCheck, Truck, CheckCircle2, AlertCircle, ArrowLeft, Calendar, Receipt,
} from 'lucide-react';

// ───────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────
type PartyType = 'vendor' | 'associate' | 'agent';

interface Party {
  id: number;
  name: string;
  sub: string;       // phone / contact / deduction info
  balance: number;   // > 0 outstanding (to settle), < 0 advance/credit
}

interface LedgerItem {
  id: number;
  date: string;
  title: string;
  subtitle: string;
  // a transaction can have multiple money facets; we render the "primary" amount
  amount: number;
  direction: 'in' | 'out' | 'neutral';
  status?: string;
  // vendor-only extra facets
  detail?: { label: string; value: number; tone: string }[];
}

interface Ref { id: number; name: string; }

// ───────────────────────────────────────────────────────────────────────────
// Config
// ───────────────────────────────────────────────────────────────────────────
const TABS: { key: PartyType; label: string; icon: any; model: string }[] = [
  { key: 'vendor', label: 'Vendors', icon: Building2, model: 'flipkart.bill.payment.vendor' },
  { key: 'associate', label: 'Associates', icon: UserCheck, model: 'flipkart.money.associate' },
  { key: 'agent', label: 'Agents', icon: Truck, model: 'flipkart.carrying.agent' },
];

const TXN_STATE: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Pending Cash', cls: 'bg-amber-500/15 text-amber-500 border border-amber-500/25' },
  partial: { label: 'Partially Received', cls: 'bg-orange-500/15 text-orange-500 border border-orange-500/25' },
  received: { label: 'Cash Received', cls: 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/25' },
  agent_paid: { label: 'Agent Paid', cls: 'bg-blue-500/15 text-blue-500 border border-blue-500/25' },
};

const AVATAR_GRADIENTS = [
  'from-violet-500 to-indigo-600', 'from-blue-500 to-cyan-600', 'from-emerald-500 to-teal-600',
  'from-amber-500 to-orange-600', 'from-rose-500 to-pink-600', 'from-fuchsia-500 to-violet-600',
];

const inr = (n: number) => `₹${Math.abs(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const initials = (s: string) => s.split(' ').slice(0, 2).map(w => w[0] || '').join('').toUpperCase();

const ENTRY_TYPES = [
  { key: 'bank_transfer', label: 'Bank Transfer' },
  { key: 'receive_payment', label: 'Receive Cash' },
  { key: 'agent_payment', label: 'Agent Payment' },
  { key: 'expense', label: 'Expense' },
  { key: 'associate_transfer', label: 'Assoc. Transfer' },
  { key: 'manual_partner', label: 'Manual Partner' },
];

// ───────────────────────────────────────────────────────────────────────────
export default function SettlementStudio() {
  const { isDark } = useTheme();

  const [tab, setTab] = useState<PartyType>('vendor');
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);

  const [parties, setParties] = useState<Record<PartyType, Party[]>>({ vendor: [], associate: [], agent: [] });

  // reference lists for the create-entry sheet
  const [vendorsRef, setVendorsRef] = useState<Ref[]>([]);
  const [associatesRef, setAssociatesRef] = useState<Ref[]>([]);
  const [agentsRef, setAgentsRef] = useState<Ref[]>([]);
  const [partnersRef, setPartnersRef] = useState<Ref[]>([]);

  // ledger sheet
  const [activeParty, setActiveParty] = useState<{ type: PartyType; party: Party } | null>(null);
  const [ledger, setLedger] = useState<LedgerItem[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);

  // sheets
  const [addOpen, setAddOpen] = useState(false);
  const [entryOpen, setEntryOpen] = useState(false);

  const navigate = useNavigate();
  const { workspace } = useParams<{ workspace: string }>();
  const goExpenses = () => navigate(workspace ? `/${workspace}/settlements/expenses` : '../expenses', workspace ? undefined : { relative: 'path' } as any);
  const showMsg = (ok: boolean, msg: string) => { setToast({ ok, msg }); setTimeout(() => setToast(null), 4500); };

  // ── data loading ──────────────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [vs, as_, ags] = await Promise.allSettled([
        searchRead<any>('flipkart.bill.payment.vendor', { fields: ['id', 'name', 'phone', 'deduction_percent', 'balance'], limit: 0 }),
        searchRead<any>('flipkart.money.associate', { fields: ['id', 'name', 'phone', 'balance'], limit: 0 }),
        searchRead<any>('flipkart.carrying.agent', { fields: ['id', 'name', 'contact_details', 'outstanding_balance'], limit: 0 }),
      ]);
      const v: Party[] = vs.status === 'fulfilled' && Array.isArray(vs.value)
        ? vs.value.map(r => ({ id: r.id, name: r.name, sub: r.phone || `${r.deduction_percent || 0}% deduction`, balance: r.balance || 0 })) : [];
      const a: Party[] = as_.status === 'fulfilled' && Array.isArray(as_.value)
        ? as_.value.map(r => ({ id: r.id, name: r.name, sub: r.phone || 'Money associate', balance: r.balance || 0 })) : [];
      const g: Party[] = ags.status === 'fulfilled' && Array.isArray(ags.value)
        ? ags.value.map(r => ({ id: r.id, name: r.name, sub: (r.contact_details || 'Carrying agent').split('\n')[0], balance: r.outstanding_balance || 0 })) : [];
      setParties({ vendor: v, associate: a, agent: g });
      setVendorsRef(v.map(x => ({ id: x.id, name: x.name })));
      setAssociatesRef(a.map(x => ({ id: x.id, name: x.name })));
      setAgentsRef(g.map(x => ({ id: x.id, name: x.name })));
    } catch (e: any) { showMsg(false, e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchAll();
    searchRead<Ref>('res.partner', { fields: ['id', 'name'], domain: [['active', '=', true]], limit: 0 })
      .then(r => Array.isArray(r) && setPartnersRef(r)).catch(() => {});
  }, [fetchAll]);

  // ── ledger loading per party ────────────────────────────────────────────────
  const openLedger = async (type: PartyType, party: Party) => {
    setActiveParty({ type, party });
    setLedgerLoading(true);
    setLedger([]);
    try {
      let items: LedgerItem[] = [];
      if (type === 'vendor') {
        const rows = await searchRead<any>('flipkart.bill.payment.transaction', {
          domain: [['vendor_id', '=', party.id]],
          fields: ['id', 'date', 'name', 'transfer_amount', 'deduction_amount', 'expected_cash_amount', 'actual_cash_received', 'received_by_id', 'state'],
          order: 'date desc, id desc', limit: 0,
        });
        items = (rows || []).map(r => {
          const received = r.actual_cash_received || 0;
          const expected = r.expected_cash_amount || 0;
          const remaining = Math.max(expected - received, 0);
          // Derive a "partial" status when some -- but not all -- of the expected cash is in.
          let status = r.state;
          if (r.state !== 'received' && r.state !== 'agent_paid' && received > 0 && remaining > 0.01) status = 'partial';
          const base = Array.isArray(r.received_by_id) ? `Received by ${r.received_by_id[1]}` : 'Bank transfer';
          return {
            id: r.id, date: r.date, title: r.name || 'Transaction',
            subtitle: status === 'partial' ? `${base} - ${inr(remaining)} left to collect` : base,
            amount: r.transfer_amount || 0, direction: 'out' as const, status,
            detail: [
              { label: 'Transfer', value: r.transfer_amount || 0, tone: 'text-blue-400' },
              { label: 'Deducted', value: r.deduction_amount || 0, tone: 'text-amber-500' },
              { label: 'Expected', value: expected, tone: 'text-violet-400' },
              { label: 'Received', value: received, tone: 'text-emerald-500' },
            ],
          };
        });
      } else if (type === 'associate') {
        const rows = await searchRead<any>('flipkart.associate.ledger', {
          domain: [['associate_id', '=', party.id]],
          fields: ['id', 'date', 'entry_type', 'amount', 'reference', 'note'],
          order: 'date desc, id desc', limit: 0,
        });
        items = (rows || []).map(r => ({
          id: r.id, date: r.date, title: prettyType(r.entry_type),
          subtitle: r.reference || r.note || '--', amount: r.amount || 0,
          direction: /receive|transfer_in|credit/i.test(r.entry_type) ? 'in' : 'out',
        }));
      } else {
        const rows = await searchRead<any>('flipkart.agent.ledger', {
          domain: [['agent_id', '=', party.id]],
          fields: ['id', 'date', 'entry_type', 'amount_inr', 'reference', 'notes'],
          order: 'date desc, id desc', limit: 0,
        });
        items = (rows || []).map(r => ({
          id: r.id, date: r.date, title: prettyType(r.entry_type),
          subtitle: r.reference || r.notes || '--', amount: r.amount_inr || 0,
          direction: /payment|paid/i.test(r.entry_type) ? 'out' : 'in',
        }));
      }
      setLedger(items);
    } catch (e: any) { showMsg(false, e.message); }
    finally { setLedgerLoading(false); }
  };

  // ── derived ─────────────────────────────────────────────────────────────────
  const list = parties[tab];
  const q = deferredSearch.trim().toLowerCase();
  const filtered = list.filter(p => !q || p.name.toLowerCase().includes(q) || p.sub.toLowerCase().includes(q));
  // Agents: positive outstanding_balance = we owe them (TO PAY), negative = they owe us (TO COLLECT)
  // Vendors/Associates: positive balance = they owe us (TO COLLECT), negative = we owe them (TO PAY)
  const toCollect = list.filter(p => tab === 'agent' ? p.balance < 0 : p.balance > 0).reduce((s, p) => s + Math.abs(p.balance), 0);
  const toPay = list.filter(p => tab === 'agent' ? p.balance > 0 : p.balance < 0).reduce((s, p) => s + Math.abs(p.balance), 0);
  const net = toCollect - toPay;

  // ── styles ──────────────────────────────────────────────────────────────────
  const bgSoft = isDark ? 'bg-[#161b2e]' : 'bg-white';
  const txt = isDark ? 'text-white' : 'text-gray-900';
  const sub = isDark ? 'text-[#5a6a8a]' : 'text-gray-400';
  const border = isDark ? 'border-[#2a3250]' : 'border-gray-200';

  return (
    <div className="max-w-5xl mx-auto pb-28 animate-fade-in">
      {toast && (
        <div className={`fixed top-5 left-1/2 -translate-x-1/2 z-[60] px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-2 text-sm font-medium
          ${toast.ok ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'}`}>
          {toast.ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />} {toast.msg}
        </div>
      )}

      {/* ── Hero net balance ───────────────────────────────────────── */}
      <div className="px-3 pt-3">
        <div className="rounded-3xl p-4 text-white shadow-xl relative overflow-hidden"
          style={{ background: 'linear-gradient(135deg, #7367f0 0%, #4f46e5 55%, #3d5af1 100%)' }}>
          <div className="absolute -right-8 -top-10 w-40 h-40 rounded-full bg-white/10" />
          <div className="absolute -right-2 top-16 w-24 h-24 rounded-full bg-white/10" />
          <div className="relative">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-white/80 text-xs font-semibold">
                <Wallet size={14} /> Net {TABS.find(t => t.key === tab)?.label} Balance
              </div>
              <button onClick={fetchAll} className="p-1.5 rounded-lg bg-white/15 hover:bg-white/25 transition-colors">
                <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              </button>
            </div>
            <p className="text-3xl font-black mt-2 tracking-tight">{inr(net)}</p>
            <div className="flex gap-3 mt-4">
              <div className="flex-1 rounded-2xl bg-emerald-500 px-3 py-2.5">
                <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-white/80">
                  <ArrowDownLeft size={11} /> To Collect
                </div>
                <p className="text-base font-black mt-0.5 text-white">{inr(toCollect)}</p>
              </div>
              <div className="flex-1 rounded-2xl bg-rose-500 px-3 py-2.5">
                <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-white/80">
                  <ArrowUpRight size={11} /> To Pay
                </div>
                <p className="text-base font-black mt-0.5 text-white">{inr(toPay)}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Segmented tabs ─────────────────────────────────────────── */}
      <div className="px-3 mt-3">
        <div className={`flex p-1 rounded-2xl ${isDark ? 'bg-[#1e2440]' : 'bg-gray-100'}`}>
          {TABS.map(t => {
            const active = tab === t.key;
            return (
              <button key={t.key} onClick={() => { setTab(t.key); setSearch(''); }}
                className={`flex-1 flex items-center justify-center gap-1 py-2 rounded-xl text-[11px] font-bold transition-all
                  ${active ? 'bg-[#7367f0] text-white shadow-md' : sub}`}>
                <t.icon size={12} />
                <span className="truncate">{t.label}</span>
                <span className={`text-[9px] px-1 rounded-full flex-shrink-0 ${active ? 'bg-white/25' : isDark ? 'bg-[#2a3250]' : 'bg-gray-200'}`}>{parties[t.key].length}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Search ─────────────────────────────────────────────────── */}
      <div className="px-3 mt-2.5">
        <div className={`flex items-center gap-2 px-3 py-2 rounded-2xl border ${border} ${bgSoft}`}>
          <Search size={15} className={sub} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={`Search ${TABS.find(t => t.key === tab)?.label.toLowerCase()}...`}
            autoComplete="off" autoCorrect="off" spellCheck="false"
            className={`bg-transparent outline-none text-sm flex-1 ${txt}`} />
        </div>
      </div>

      {/* ── Party list ─────────────────────────────────────────────── */}
      <div className="px-3 mt-2.5 space-y-2">
        {loading ? (
          <div className="py-16 flex justify-center"><RefreshCw size={22} className="animate-spin text-[#7367f0]" /></div>
        ) : filtered.length === 0 ? (
          <div className={`py-16 text-center text-sm ${sub}`}>No {TABS.find(t => t.key === tab)?.label.toLowerCase()} yet. Tap + to add one.</div>
        ) : filtered.map((p, i) => (
          <button key={p.id} onClick={() => openLedger(tab, p)}
            className={`w-full flex items-center gap-3 p-3.5 rounded-2xl border ${border} ${bgSoft} hover:border-[#7367f0]/50 transition-all text-left active:scale-[0.99]`}>
            <div className={`w-11 h-11 rounded-2xl bg-gradient-to-br ${AVATAR_GRADIENTS[i % AVATAR_GRADIENTS.length]} flex items-center justify-center flex-shrink-0`}>
              <span className="text-white font-black text-sm">{initials(p.name)}</span>
            </div>
            <div className="min-w-0 flex-1">
              <p className={`font-bold text-sm truncate ${txt}`}>{p.name}</p>
              <p className={`text-xs truncate ${sub}`}>{p.sub}</p>
            </div>
            <div className="text-right flex-shrink-0">
              <p className={`font-black text-sm ${p.balance > 0 ? (tab === 'agent' ? 'text-rose-500' : 'text-emerald-500') : p.balance < 0 ? 'text-amber-400' : sub}`}>{inr(p.balance)}</p>
              <p className={`text-[10px] font-semibold uppercase tracking-wider ${sub}`}>{p.balance > 0 ? (tab === 'agent' ? 'To Pay' : 'To Collect') : p.balance < 0 ? 'Advance' : 'Settled'}</p>
            </div>
            <ChevronRight size={16} className={sub} />
          </button>
        ))}
      </div>

      {/* ── Action buttons ─────────────────────────────────────────── */}
      {/*
        Mobile:  fixed, full-width, px-3 inset — matches card's px-3 wrapper
        Desktop: fixed, starts at left-72 (sidebar 288px), then replicates AppLayout's
                 p-6 + SettlementStudio's max-w-2xl mx-auto + px-3 so buttons sit
                 exactly under the hero card at any viewport width
      */}
      <div className="fixed bottom-5 left-0 right-0 z-40 px-3 lg:bottom-6 lg:left-72 lg:right-0 lg:px-6">
        <div className="lg:max-w-2xl lg:mx-auto lg:px-3">
          <div className="flex items-stretch gap-2 lg:gap-3">
            <button onClick={() => setAddOpen(true)}
              className={`flex-1 min-w-0 h-12 lg:h-14 rounded-2xl shadow-xl flex items-center justify-center gap-2 font-bold text-[11px] lg:text-sm border ${border} ${bgSoft} ${txt}`}>
              <Plus size={15} className="flex-shrink-0" />
              <span className="truncate">Add {TABS.find(t => t.key === tab)?.label.replace(/s$/, '')}</span>
            </button>
            <button onClick={goExpenses}
              className={`flex-1 min-w-0 h-12 lg:h-14 rounded-2xl shadow-xl flex items-center justify-center gap-2 font-bold text-[11px] lg:text-sm border border-amber-500/30 ${bgSoft} text-amber-400`}>
              <Receipt size={15} className="flex-shrink-0" />
              <span className="truncate">Expenses</span>
            </button>
            <button onClick={() => setEntryOpen(true)}
              className="flex-1 min-w-0 h-12 lg:h-14 rounded-2xl shadow-xl flex items-center justify-center gap-2 text-white font-bold text-[11px] lg:text-sm"
              style={{ background: 'linear-gradient(135deg, #7367f0, #3d5af1)' }}>
              <Plus size={15} className="flex-shrink-0" />
              <span className="truncate">New Entry</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── Ledger sheet ───────────────────────────────────────────── */}
      {activeParty && (
        <LedgerSheet
          isDark={isDark} party={activeParty.party} type={activeParty.type}
          ledger={ledger} loading={ledgerLoading}
          onClose={() => setActiveParty(null)}
          onNewEntry={() => setEntryOpen(true)}
        />
      )}

      {/* ── Add party sheet ────────────────────────────────────────── */}
      {addOpen && (
        <AddPartySheet isDark={isDark} type={tab} onClose={() => setAddOpen(false)}
          onSaved={() => { setAddOpen(false); fetchAll(); showMsg(true, 'Added successfully.'); }}
          onError={(m) => showMsg(false, m)} />
      )}

      {/* ── Create entry sheet ─────────────────────────────────────── */}
      {entryOpen && (
        <CreateEntrySheet isDark={isDark} activeTab={tab}
          vendors={vendorsRef} associates={associatesRef} agents={agentsRef} partners={partnersRef}
          onClose={() => setEntryOpen(false)}
          onSaved={() => { setEntryOpen(false); fetchAll(); if (activeParty) openLedger(activeParty.type, activeParty.party); showMsg(true, 'Entry applied successfully.'); }}
          onError={(m) => showMsg(false, m)} />
      )}
    </div>
  );
}

function prettyType(s: string) { return (s || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }

// ═══════════════════════════════════════════════════════════════════════════
// Ledger / account-statement sheet
// ═══════════════════════════════════════════════════════════════════════════
function LedgerSheet({ isDark, party, type, ledger, loading, onClose, onNewEntry }: {
  isDark: boolean; party: Party; type: PartyType; ledger: LedgerItem[]; loading: boolean;
  onClose: () => void; onNewEntry: () => void;
}) {
  const txt = isDark ? 'text-white' : 'text-gray-900';
  const sub = isDark ? 'text-[#5a6a8a]' : 'text-gray-400';
  const border = isDark ? 'border-[#2a3250]' : 'border-gray-100';
  const itemBg = isDark ? 'bg-[#12172a]' : 'bg-gray-50';

  const inflow = ledger.filter(l => l.direction === 'in').reduce((s, l) => s + l.amount, 0);
  const outflow = ledger.filter(l => l.direction === 'out').reduce((s, l) => s + l.amount, 0);

  const exportCsv = () => {
    const rows = [['Date', 'Reference', 'Detail', 'Amount', 'Direction', 'Status'],
      ...ledger.map(l => [l.date, l.title, l.subtitle, l.amount, l.direction, l.status || ''])];
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = `${party.name}-statement.csv`; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className={`w-full sm:max-w-lg max-h-[92vh] flex flex-col rounded-t-3xl sm:rounded-3xl ${isDark ? 'bg-[#161b2e]' : 'bg-white'} shadow-2xl animate-slide-up`} onClick={e => e.stopPropagation()}>
        {/* drag handle */}
        <div className="pt-2.5 flex justify-center sm:hidden"><div className="w-10 h-1 rounded-full bg-gray-400/40" /></div>

        {/* header */}
        <div className={`px-5 py-4 flex items-center gap-3 border-b ${border}`}>
          <button onClick={onClose} className={`p-1.5 rounded-xl ${isDark ? 'hover:bg-white/5' : 'hover:bg-gray-100'} ${sub}`}><ArrowLeft size={18} /></button>
          <div className="flex-1 min-w-0">
            <p className={`font-black text-base truncate ${txt}`}>{party.name}</p>
            <p className={`text-xs ${sub}`}>Account Statement</p>
          </div>
          <button onClick={exportCsv} className={`flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-xl border ${border} ${sub}`}>
            <Download size={13} /> CSV
          </button>
        </div>

        {/* summary */}
        <div className="px-5 py-4">
          <div className={`rounded-2xl p-4 ${itemBg}`}>
            <div className="flex items-center justify-between">
              <span className={`text-xs font-semibold ${sub}`}>Current Balance</span>
              <span className={`flex items-center gap-1 text-[11px] ${sub}`}><Calendar size={11} /> All time</span>
            </div>
            <p className={`text-2xl font-black mt-1 ${
              party.balance > 0
                ? (type === 'agent' ? 'text-rose-500' : 'text-emerald-500')
                : party.balance < 0 ? 'text-amber-400' : txt
            }`}>{inr(party.balance)}</p>
            <p className={`text-[10px] font-bold uppercase tracking-wider mt-0.5 ${sub}`}>
              {party.balance > 0 ? (type === 'agent' ? 'To Pay' : 'To Collect') : party.balance < 0 ? 'Advance Paid' : 'Settled'}
            </p>
            <div className={`flex gap-3 mt-3 pt-3 border-t ${border}`}>
              <div className="flex-1">
                <div className={`flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider ${sub}`}><ArrowDownLeft size={11} className="text-emerald-500" /> Inflow</div>
                <p className="text-sm font-black text-emerald-500 mt-0.5">{inr(inflow)}</p>
              </div>
              <div className="flex-1">
                <div className={`flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider ${sub}`}><ArrowUpRight size={11} className="text-rose-500" /> Outflow</div>
                <p className="text-sm font-black text-rose-500 mt-0.5">{inr(outflow)}</p>
              </div>
            </div>
          </div>
        </div>

        {/* statement list */}
        <div className="flex-1 overflow-y-auto px-5 pb-2 space-y-2.5">
          {loading ? (
            <div className="py-12 flex justify-center"><RefreshCw size={20} className="animate-spin text-[#7367f0]" /></div>
          ) : ledger.length === 0 ? (
            <div className={`py-12 text-center text-sm ${sub}`}>No transactions yet for this {type}.</div>
          ) : ledger.map(l => (
            <div key={l.id} className={`rounded-2xl p-3.5 ${itemBg}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className={`font-bold text-sm ${txt}`}>{l.title}</p>
                    {l.status && TXN_STATE[l.status] && (
                      <span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full ${TXN_STATE[l.status].cls}`}>{TXN_STATE[l.status].label}</span>
                    )}
                  </div>
                  <p className={`text-xs mt-0.5 truncate ${sub}`}>{l.subtitle}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className={`font-black text-sm ${l.direction === 'in' ? 'text-emerald-500' : l.direction === 'out' ? 'text-rose-500' : txt}`}>
                    {l.direction === 'in' ? '+' : l.direction === 'out' ? '-' : ''}{inr(l.amount)}
                  </p>
                  <p className={`text-[10px] ${sub}`}>{l.date}</p>
                </div>
              </div>
              {l.detail && (
                <div className={`grid grid-cols-4 gap-1 mt-3 pt-3 border-t ${border}`}>
                  {l.detail.map(d => (
                    <div key={d.label} className="text-center">
                      <p className={`text-[9px] font-semibold uppercase tracking-wider ${sub}`}>{d.label}</p>
                      <p className={`text-[11px] font-bold mt-0.5 ${d.tone}`}>{inr(d.value)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* footer */}
        <div className={`p-4 border-t ${border}`}>
          <button onClick={onNewEntry} className="w-full py-3 rounded-2xl text-white font-bold text-sm flex items-center justify-center gap-2"
            style={{ background: 'linear-gradient(135deg, #7367f0, #3d5af1)' }}>
            <Plus size={16} /> Record New Entry
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Add party sheet
// ═══════════════════════════════════════════════════════════════════════════
function AddPartySheet({ isDark, type, onClose, onSaved, onError }: {
  isDark: boolean; type: PartyType; onClose: () => void; onSaved: () => void; onError: (m: string) => void;
}) {
  const [f, setF] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const label = type === 'vendor' ? 'Bill Vendor' : type === 'associate' ? 'Money Associate' : 'Carrying Agent';
  const field = `input text-sm py-2.5 w-full ${isDark ? 'bg-[#12172a] border-[#2a3250] text-white' : ''}`;
  const lbl = `text-[11px] font-semibold block mb-1 ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`;

  const save = async () => {
    if (!f.name?.trim()) { onError('Name is required.'); return; }
    setSaving(true);
    try {
      if (type === 'vendor') await createRecord('flipkart.bill.payment.vendor', { name: f.name.trim(), phone: f.phone || false, deduction_percent: parseFloat(f.deduction_percent || 0) || 0, notes: f.notes || false });
      else if (type === 'associate') await createRecord('flipkart.money.associate', { name: f.name.trim(), phone: f.phone || false, notes: f.notes || false });
      else await createRecord('flipkart.carrying.agent', { name: f.name.trim(), contact_details: f.contact_details || false });
      onSaved();
    } catch (e: any) { onError(e?.message || 'Create failed'); }
    finally { setSaving(false); }
  };

  return (
    <Sheet isDark={isDark} title={`Add ${label}`} onClose={onClose}>
      <div className="space-y-3">
        <div><label className={lbl}>Name *</label><input value={f.name || ''} onChange={e => setF(p => ({ ...p, name: e.target.value }))} placeholder={`${label} name`} className={field} /></div>
        {type !== 'agent' && (
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lbl}>Phone</label><input value={f.phone || ''} onChange={e => setF(p => ({ ...p, phone: e.target.value }))} className={field} /></div>
            {type === 'vendor' && <div><label className={lbl}>Deduction %</label><input type="number" step="0.01" value={f.deduction_percent || ''} onChange={e => setF(p => ({ ...p, deduction_percent: e.target.value }))} placeholder="0.00" className={field} /></div>}
          </div>
        )}
        {type === 'agent'
          ? <div><label className={lbl}>Contact / Location</label><textarea rows={3} value={f.contact_details || ''} onChange={e => setF(p => ({ ...p, contact_details: e.target.value }))} className={`${field} resize-none`} /></div>
          : <div><label className={lbl}>Notes</label><textarea rows={2} value={f.notes || ''} onChange={e => setF(p => ({ ...p, notes: e.target.value }))} className={`${field} resize-none`} /></div>}
      </div>
      <button onClick={save} disabled={saving || !f.name?.trim()} className="w-full mt-4 py-3 rounded-2xl text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
        style={{ background: 'linear-gradient(135deg, #7367f0, #3d5af1)' }}>
        {saving ? <RefreshCw size={16} className="animate-spin" /> : <Plus size={16} />} Save {label}
      </button>
    </Sheet>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Create entry sheet — tab-aware (vendor→bank+cash, assoc→transfer, agent→payment)
// ═══════════════════════════════════════════════════════════════════════════
const TAB_ENTRY_MAP: Record<PartyType, { key: string; label: string }[]> = {
  vendor:    [{ key: 'bank_transfer', label: 'Bank Transfer' }, { key: 'receive_payment', label: 'Receive Cash' }],
  associate: [{ key: 'associate_transfer', label: 'Assoc. Transfer' }],
  agent:     [{ key: 'agent_payment', label: 'Agent Payment' }],
};
const EXPENSE_ENTRY = { key: 'expense', label: 'Add Expense' };

// The primary money field for each entry type -- rendered as the big editable
// number at the top of the sheet.
const AMOUNT_FIELD: Record<string, { field: string; label: string }> = {
  bank_transfer: { field: 'transfer_amount', label: 'Transfer Amount' },
  receive_payment: { field: 'payment_received', label: 'Cash Received' },
  agent_payment: { field: 'agent_payment_amount', label: 'Agent Payment' },
  expense: { field: 'expense_amount', label: 'Expense Amount' },
  associate_transfer: { field: 'transfer_amount', label: 'Transfer Amount' },
};

function CreateEntrySheet({ isDark, activeTab, vendors, associates, agents, partners, onClose, onSaved, onError }: {
  isDark: boolean; activeTab: PartyType; vendors: Ref[]; associates: Ref[]; agents: Ref[]; partners: Ref[];
  onClose: () => void; onSaved: () => void; onError: (m: string) => void;
}) {
  const tabTypes = TAB_ENTRY_MAP[activeTab] || TAB_ENTRY_MAP.vendor;
  const [entryType, setEntryType] = useState(tabTypes[0].key);
  const amt = AMOUNT_FIELD[entryType] || AMOUNT_FIELD.bank_transfer;
  const [form, setForm] = useState<Record<string, any>>({ date: new Date().toISOString().slice(0, 10) });
  const [vendorTxns, setVendorTxns] = useState<Array<{ id: number; name: string; expectedCash: number; received: number; remaining: number }>>([]);
  const [saving, setSaving] = useState(false);
  const setF = (k: string, v: any) => setForm(p => ({ ...p, [k]: v }));

  const field = `input text-sm py-2.5 w-full ${isDark ? 'bg-[#12172a] border-[#2a3250] text-white' : ''}`;
  const lbl = `text-[11px] font-semibold block mb-1 ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`;
  const itemBg = isDark ? 'bg-[#12172a]' : 'bg-gray-50';

  const loadTxns = async (vendorId: number) => {
    try {
      // Fetch ALL of the vendor's transactions and keep any that aren't fully
      // settled (expected > received) -- this includes both pending and PARTIAL.
      const r = await searchRead<any>('flipkart.bill.payment.transaction', {
        fields: ['id', 'name', 'expected_cash_amount', 'actual_cash_received', 'state'],
        domain: [['vendor_id', '=', vendorId]],
        order: 'date desc, id desc', limit: 0,
      });
      const open = (r || [])
        .map((row: any) => {
          const expectedCash = row.expected_cash_amount || 0;
          const received = row.actual_cash_received || 0;
          return { id: row.id, name: row.name, expectedCash, received, remaining: Math.max(expectedCash - received, 0) };
        })
        .filter(t => t.remaining > 0.01);
      setVendorTxns(open);
    } catch { setVendorTxns([]); }
  };

  const expectedCash = form.transfer_amount && form.deduction_percent
    ? (parseFloat(form.transfer_amount) * (1 - parseFloat(form.deduction_percent) / 100)).toFixed(2) : null;

  const switchType = (key: string) => { setEntryType(key); setForm({ date: new Date().toISOString().slice(0, 10) }); setVendorTxns([]); };

  const submit = async () => {
    setSaving(true);
    try {
      const vals: Record<string, any> = { entry_type: entryType, date: form.date, note: form.note || '' };
      if (entryType === 'bank_transfer') { vals.vendor_id = form.vendor_id; vals.transfer_amount = parseFloat(form.transfer_amount || 0); vals.deduction_percent = parseFloat(form.deduction_percent || 0); }
      else if (entryType === 'receive_payment') { vals.vendor_id = form.vendor_id; if (form.transaction_id) vals.transaction_id = form.transaction_id; vals.received_by_id = form.received_by_id; vals.actual_cash_received = parseFloat(form.payment_received || 0); }
      else if (entryType === 'agent_payment') { vals.vendor_id = form.vendor_id; if (form.transaction_id) vals.transaction_id = form.transaction_id; vals.agent_payment_source = form.agent_payment_source || 'vendor'; vals.carrying_agent_id = form.carrying_agent_id; vals.agent_payment_amount = parseFloat(form.agent_payment_amount || 0); if ((form.agent_payment_source || 'vendor') === 'associate') vals.received_by_id = form.received_by_id; }
      else if (entryType === 'expense') { vals.received_by_id = form.received_by_id; vals.actual_cash_received = parseFloat(form.expense_amount || 0); }
      else if (entryType === 'associate_transfer') { vals.received_by_id = form.from_associate_id; vals.to_associate_id = form.to_associate_id; vals.actual_cash_received = parseFloat(form.transfer_amount || 0); }
      const wid = await createRecord('flipkart.bill.payment.entry.wizard', vals);
      await odooCall('flipkart.bill.payment.entry.wizard', 'action_apply', [[wid]], {});
      onSaved();
    } catch (e: any) { onError('Failed: ' + (e?.message || 'error')); }
    finally { setSaving(false); }
  };

  const Sel = ({ label, value, onChange, options, placeholder }: { label: string; value: any; onChange: (v: any) => void; options: Ref[]; placeholder: string }) => (
    <div><label className={lbl}>{label}</label>
      <select value={value || ''} onChange={e => onChange(Number(e.target.value) || '')} className={field}>
        <option value="">{placeholder}</option>
        {options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </div>
  );

  const tabBtnCls = (key: string) =>
    `flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${entryType === key ? 'border-[#7367f0] bg-[#7367f0]/10 text-[#7367f0]' : isDark ? 'border-[#2a3250] text-[#6a7a9a]' : 'border-gray-200 text-gray-500'}`;

  return (
    <Sheet isDark={isDark} title={`New Entry — ${TABS.find(t => t.key === activeTab)?.label}`} onClose={onClose}>
      {/* Tab-aware entry type selector */}
      <div className="flex gap-2 mb-1">
        {tabTypes.map(t => (
          <button key={t.key} onClick={() => switchType(t.key)} className={tabBtnCls(t.key)}>{t.label}</button>
        ))}
      </div>

      {/* Big editable amount -- uses the device numeric keyboard (inputMode) */}
      <div className="text-center pt-5 pb-4">
        <p className={`text-[11px] font-bold uppercase tracking-wider ${isDark ? 'text-[#6a7a9a]' : 'text-gray-400'}`}>{amt.label}</p>
        <div className="flex items-center justify-center gap-1 mt-1">
          <span className={`text-3xl font-black ${isDark ? 'text-[#4a5580]' : 'text-gray-300'}`}>Rs.</span>
          <input
            inputMode="decimal" type="text" autoFocus
            value={form[amt.field] || ''}
            onChange={e => setF(amt.field, e.target.value.replace(/[^0-9.]/g, ''))}
            placeholder="0"
            className={`text-5xl font-black bg-transparent outline-none text-center w-[58%] max-w-[260px] ${isDark ? 'text-white placeholder:text-[#2a3250]' : 'text-gray-900 placeholder:text-gray-200'}`}
          />
        </div>
        {entryType === 'bank_transfer' && expectedCash && (
          <p className={`text-xs mt-1 ${isDark ? 'text-[#6a7a9a]' : 'text-gray-400'}`}>Expected cash: <span className="font-black text-[#7367f0]">{inr(parseFloat(expectedCash))}</span></p>
        )}
      </div>

      <div className="space-y-3">
        <div><label className={lbl}>Date *</label><input type="date" value={form.date || ''} onChange={e => setF('date', e.target.value)} className={field} /></div>

        {entryType === 'bank_transfer' && <>
          <Sel label="Vendor *" value={form.vendor_id} onChange={v => setF('vendor_id', v)} options={vendors} placeholder="Select vendor" />
          <div><label className={lbl}>Deduction %</label><input type="number" step="0.01" inputMode="decimal" value={form.deduction_percent || ''} onChange={e => setF('deduction_percent', e.target.value)} placeholder="0.00" className={field} /></div>
          <div><label className={lbl}>Note</label><input value={form.note || ''} onChange={e => setF('note', e.target.value)} className={field} /></div>
        </>}

        {entryType === 'receive_payment' && <>
          <Sel label="Vendor *" value={form.vendor_id} onChange={v => { setF('vendor_id', v); if (v) loadTxns(v); }} options={vendors} placeholder="Select vendor" />
          {vendorTxns.length > 0 && (
            <div>
              <label className={lbl}>Pending Transaction</label>
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {vendorTxns.map(txn => (
                  <button key={txn.id} onClick={() => { setF('transaction_id', txn.id); if (!form.payment_received) setF('payment_received', String(txn.remaining)); }}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl border text-left text-xs transition-all ${form.transaction_id === txn.id ? 'border-[#7367f0] bg-[#7367f0]/10' : isDark ? 'border-[#2a3250] bg-[#12172a]' : 'border-gray-200 bg-gray-50'}`}>
                    <span className={isDark ? 'text-white' : 'text-gray-900'}>{txn.name}</span>
                    <span className="flex flex-col items-end ml-2 flex-shrink-0 text-right">
                      <span className="font-black text-emerald-500">{inr(txn.remaining)} left</span>
                      {txn.received > 0 && <span className="text-[10px] text-orange-500">partial - {inr(txn.received)} of {inr(txn.expectedCash)}</span>}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <Sel label="Received By *" value={form.received_by_id} onChange={v => setF('received_by_id', v)} options={associates} placeholder="Select associate" />
          <div><label className={lbl}>Note</label><input value={form.note || ''} onChange={e => setF('note', e.target.value)} className={field} /></div>
        </>}

        {entryType === 'agent_payment' && <>
          <Sel label={form.agent_payment_source === 'associate' ? 'Vendor (optional)' : 'Vendor *'} value={form.vendor_id} onChange={v => { setF('vendor_id', v); if (v) loadTxns(v); }} options={vendors} placeholder="Select vendor" />
          {vendorTxns.length > 0 && (
            <div>
              <label className={lbl}>Transaction (optional)</label>
              <div className="space-y-1.5 max-h-36 overflow-y-auto">
                {vendorTxns.map(txn => (
                  <button key={txn.id} onClick={() => setF('transaction_id', txn.id)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl border text-left text-xs transition-all ${form.transaction_id === txn.id ? 'border-[#7367f0] bg-[#7367f0]/10' : isDark ? 'border-[#2a3250] bg-[#12172a]' : 'border-gray-200 bg-gray-50'}`}>
                    <span className={isDark ? 'text-white' : 'text-gray-900'}>{txn.name}</span>
                    <span className="flex flex-col items-end ml-2 flex-shrink-0 text-right">
                      <span className="font-black text-emerald-500">{inr(txn.remaining)} left</span>
                      {txn.received > 0 && <span className="text-[10px] text-orange-500">partial - {inr(txn.received)} of {inr(txn.expectedCash)}</span>}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div><label className={lbl}>Paid By</label>
            <select value={form.agent_payment_source || 'vendor'} onChange={e => setF('agent_payment_source', e.target.value)} className={field}>
              <option value="vendor">Vendor Paid Agent</option>
              <option value="associate">Associate Paid Agent</option>
            </select>
          </div>
          {form.agent_payment_source === 'associate' && <Sel label="Associate Who Paid *" value={form.received_by_id} onChange={v => setF('received_by_id', v)} options={associates} placeholder="Select associate" />}
          <Sel label="Carrying Agent *" value={form.carrying_agent_id} onChange={v => setF('carrying_agent_id', v)} options={agents} placeholder="Select agent" />
          <div><label className={lbl}>Note</label><input value={form.note || ''} onChange={e => setF('note', e.target.value)} className={field} /></div>
        </>}

        {entryType === 'expense' && <>
          <Sel label="Paid By (Associate) *" value={form.received_by_id} onChange={v => setF('received_by_id', v)} options={associates} placeholder="Select associate" />
          <div><label className={lbl}>Expense Description *</label><input value={form.note || ''} onChange={e => setF('note', e.target.value)} placeholder="e.g. Delivery charges, packing material" className={field} /></div>
        </>}

        {entryType === 'associate_transfer' && <>
          <Sel label="From Associate *" value={form.from_associate_id} onChange={v => setF('from_associate_id', v)} options={associates} placeholder="Select associate" />
          <Sel label="To Associate *" value={form.to_associate_id} onChange={v => setF('to_associate_id', v)} options={associates} placeholder="Select associate" />
        </>}
      </div>

      <button onClick={submit} disabled={saving} className="w-full mt-4 py-3 rounded-2xl text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
        style={{ background: 'linear-gradient(135deg, #7367f0, #3d5af1)' }}>
        {saving ? <RefreshCw size={16} className="animate-spin" /> : <Plus size={16} />} Apply Entry
      </button>
    </Sheet>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Reusable bottom sheet shell
// ═══════════════════════════════════════════════════════════════════════════
function Sheet({ isDark, title, onClose, children }: { isDark: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  const border = isDark ? 'border-[#2a3250]' : 'border-gray-100';
  return (
    <div className="fixed inset-0 z-[55] flex items-end sm:items-center sm:justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className={`w-full sm:max-w-lg max-h-[92vh] flex flex-col rounded-t-3xl sm:rounded-3xl ${isDark ? 'bg-[#161b2e]' : 'bg-white'} shadow-2xl animate-slide-up`} onClick={e => e.stopPropagation()}>
        <div className="pt-2.5 flex justify-center sm:hidden"><div className="w-10 h-1 rounded-full bg-gray-400/40" /></div>
        <div className={`px-5 py-4 flex items-center justify-between border-b ${border}`}>
          <h2 className={`font-black text-base ${isDark ? 'text-white' : 'text-gray-900'}`}>{title}</h2>
          <button onClick={onClose} className={`p-1.5 rounded-xl ${isDark ? 'hover:bg-white/5 text-[#5a6a8a]' : 'hover:bg-gray-100 text-gray-400'}`}><X size={18} /></button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
