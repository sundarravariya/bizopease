import React, { useState, useEffect } from 'react';
import { useTheme } from '../../../context/ThemeContext';
import { searchRead, createRecord, writeRecord } from '../../../services/odoo';
import {
  Plus, RefreshCw, Search, Eye, X, Check,
  RotateCcw, BookOpen, AlertCircle, FileText
} from 'lucide-react';

interface JournalLine {
  id: number;
  account_code: string;
  account_name: string;
  debit: number;
  credit: number;
  partner: string;
}

interface JournalEntry {
  id: number;
  name: string;
  date: string;
  journal: string;
  reference: string;
  lines: JournalLine[];
  total_debit: number;
  total_credit: number;
  state: 'draft' | 'posted';
  balanced: boolean;
}

const ACCOUNTS: { code: string; name: string }[] = [
  { code: '1001', name: 'Cash' },
  { code: '1100', name: 'Bank - HDFC' },
  { code: '1200', name: 'Accounts Receivable' },
  { code: '1500', name: 'Inventory' },
  { code: '1800', name: 'Prepaid Expenses' },
  { code: '2100', name: 'Accounts Payable' },
  { code: '2200', name: 'Accrued Liabilities' },
  { code: '2500', name: 'Short-term Loans' },
  { code: '3000', name: 'Equity Capital' },
  { code: '3500', name: 'Retained Earnings' },
  { code: '4000', name: 'Sales Revenue' },
  { code: '4100', name: 'Other Income' },
  { code: '5000', name: 'Cost of Goods Sold' },
  { code: '6001', name: 'Salaries & Wages' },
  { code: '6100', name: 'Rent Expense' },
  { code: '6200', name: 'Utilities Expense' },
  { code: '6500', name: 'Depreciation' },
  { code: '6700', name: 'Freight & Logistics' },
];

const JOURNALS = ['BNK', 'MISC', 'BOSM', 'CUST'];

export default function Journal() {
  const { isDark } = useTheme();
  const [entries, setEntries] = useState<JournalEntry[]>(() => {
    const c = localStorage.getItem('portal_journal_entries');
    return c ? JSON.parse(c) : [];
  });
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState('all');
  const [journalFilter, setJournalFilter] = useState('all');
  const [detailEntry, setDetailEntry] = useState<JournalEntry | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  // New entry form
  const [newDate, setNewDate] = useState(new Date().toISOString().split('T')[0]);
  const [newJournal, setNewJournal] = useState('MISC');
  const [newRef, setNewRef] = useState('');
  const [newLines, setNewLines] = useState<JournalLine[]>([
    { id: 1, account_code: '1200', account_name: 'Accounts Receivable', debit: 0, credit: 0, partner: '' },
    { id: 2, account_code: '4000', account_name: 'Sales Revenue', debit: 0, credit: 0, partner: '' },
  ]);

  const syncData = async () => {
    setLoading(true);
    try {
      const r = await searchRead<any>('account.move', {
        domain: [['move_type', '=', 'entry']],
        fields: ['id', 'name', 'date', 'journal_id', 'ref', 'amount_total', 'state'],
        limit: 0,
        order: 'id desc',
      });
      if (Array.isArray(r)) {
        const mapped: JournalEntry[] = r.map((m: any) => ({
          id: m.id,
          name: m.name,
          date: m.date || '',
          journal: m.journal_id?.[1] || '',
          reference: m.ref || '',
          lines: [],
          total_debit: m.amount_total || 0,
          total_credit: m.amount_total || 0,
          state: m.state === 'posted' ? 'posted' : 'draft',
          balanced: true,
        }));
        setEntries(mapped);
        localStorage.setItem('portal_journal_entries', JSON.stringify(mapped));
      }
    } catch {
      console.warn('Odoo offline');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { syncData(); }, []);
  useEffect(() => {
    localStorage.setItem('portal_journal_entries', JSON.stringify(entries));
  }, [entries]);

  const handlePost = async (id: number) => {
    setEntries(prev => prev.map(e => e.id === id ? { ...e, state: 'posted' as const } : e));
    setDetailEntry(prev => prev?.id === id ? { ...prev, state: 'posted' as const } : prev);
    try {
      await writeRecord('account.move', [id], { state: 'posted' });
    } catch {
      console.warn('Odoo offline');
    }
  };

  const handleReset = async (id: number) => {
    setEntries(prev => prev.map(e => e.id === id ? { ...e, state: 'draft' as const } : e));
    setDetailEntry(prev => prev?.id === id ? { ...prev, state: 'draft' as const } : prev);
    try {
      await writeRecord('account.move', [id], { state: 'draft' });
    } catch {
      console.warn('Odoo offline');
    }
  };

  const newLinesDebit = newLines.reduce((s, l) => s + l.debit, 0);
  const newLinesCredit = newLines.reduce((s, l) => s + l.credit, 0);
  const newBalanced = Math.abs(newLinesDebit - newLinesCredit) < 0.01 && newLinesDebit > 0;

  const addLine = () => {
    setNewLines(prev => [...prev, { id: Date.now(), account_code: '1001', account_name: 'Cash', debit: 0, credit: 0, partner: '' }]);
  };

  const removeLine = (id: number) => {
    setNewLines(prev => prev.filter(l => l.id !== id));
  };

  const updateLine = (id: number, field: keyof JournalLine, value: string | number) => {
    setNewLines(prev => prev.map(l => {
      if (l.id !== id) return l;
      if (field === 'account_code') {
        const acc = ACCOUNTS.find(a => a.code === value);
        return { ...l, account_code: value as string, account_name: acc?.name || l.account_name };
      }
      return { ...l, [field]: value };
    }));
  };

  const handleCreateEntry = async () => {
    if (!newBalanced) return;
    const entry: JournalEntry = {
      id: Date.now(),
      name: `${newJournal}/2025/06/${String(entries.length + 50).padStart(4, '0')}`,
      date: newDate,
      journal: newJournal,
      reference: newRef,
      lines: newLines,
      total_debit: newLinesDebit,
      total_credit: newLinesCredit,
      state: 'draft',
      balanced: true,
    };
    try {
      await createRecord('account.move', { move_type: 'entry', ref: newRef, date: newDate });
    } catch {
      console.warn('Odoo offline');
    }
    setEntries(prev => [entry, ...prev]);
    setShowCreate(false);
    setNewRef('');
    setNewLines([
      { id: Date.now() + 1, account_code: '1200', account_name: 'Accounts Receivable', debit: 0, credit: 0, partner: '' },
      { id: Date.now() + 2, account_code: '4000', account_name: 'Sales Revenue', debit: 0, credit: 0, partner: '' },
    ]);
  };

  const filtered = entries.filter(e => {
    const matchSearch = !search ||
      e.name.toLowerCase().includes(search.toLowerCase()) ||
      e.reference.toLowerCase().includes(search.toLowerCase()) ||
      e.journal.toLowerCase().includes(search.toLowerCase());
    const matchState = stateFilter === 'all' || e.state === stateFilter;
    const matchJournal = journalFilter === 'all' || e.journal === journalFilter;
    return matchSearch && matchState && matchJournal;
  });

  const postedCount = entries.filter(e => e.state === 'posted').length;
  const draftCount = entries.filter(e => e.state === 'draft').length;
  const totalMovements = entries.reduce((s, e) => s + e.total_debit, 0);

  const ic = `input text-xs py-2 ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`;
  const modalBg = `w-full rounded-2xl shadow-2xl border ${isDark ? 'bg-[#161b2e] border-[#2a3250]' : 'bg-white border-gray-200'}`;
  const mh = `flex items-center justify-between p-5 border-b ${isDark ? 'border-[#2a3250]' : 'border-gray-200'}`;
  const mf = `flex justify-end gap-3 p-5 border-t ${isDark ? 'border-[#2a3250]' : 'border-gray-200'}`;
  const lineInputCls = `input text-xs py-1 ${isDark ? 'bg-[#1a2035] border-[#2a3250] text-white' : ''}`;

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className={`text-xl font-black ${isDark ? 'text-white' : 'text-gray-900'}`}>Journal Entries</h1>
          <p className={`text-xs mt-0.5 ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>
            Double-entry accounting ledger — post, inspect and audit journal movements
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={syncData} disabled={loading} className="btn-secondary text-xs px-3 py-2">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Sync
          </button>
          <button onClick={() => setShowCreate(true)} className="btn-primary text-xs px-3 py-2">
            <Plus size={13} /> New Entry
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { label: 'Posted Entries', value: postedCount.toString(), icon: BookOpen, color: 'text-green-400', bg: 'bg-green-500/10' },
          { label: 'Draft Entries', value: draftCount.toString(), icon: FileText, color: 'text-amber-400', bg: 'bg-amber-500/10' },
          { label: 'Total Movements', value: `₹${(totalMovements / 100000).toFixed(1)}L`, icon: RefreshCw, color: 'text-[#7367f0]', bg: 'bg-[#7367f0]/10' },
        ].map(s => (
          <div key={s.label} className="card p-4 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl ${s.bg} flex items-center justify-center`}>
              <s.icon size={18} className={s.color} />
            </div>
            <div>
              <p className={`text-xl font-black ${isDark ? 'text-white' : 'text-gray-900'}`}>{s.value}</p>
              <p className={`text-[10px] font-medium ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="card p-3 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={14} className={`absolute left-3 top-1/2 -translate-y-1/2 ${isDark ? 'text-[#4a5580]' : 'text-gray-400'}`} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search entry#, journal, reference..."
            className={`input pl-9 text-xs py-2 ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`}
          />
        </div>
        <select value={stateFilter} onChange={e => setStateFilter(e.target.value)} className={ic}>
          <option value="all">All States</option>
          <option value="draft">Draft</option>
          <option value="posted">Posted</option>
        </select>
        <select value={journalFilter} onChange={e => setJournalFilter(e.target.value)} className={ic}>
          <option value="all">All Journals</option>
          {JOURNALS.map(j => <option key={j} value={j}>{j}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-40 gap-3">
            <RefreshCw size={18} className="animate-spin text-[#7367f0]" />
            <span className={`text-sm ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>Loading journal entries...</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table w-full">
              <thead>
                <tr>
                  <th>Entry #</th>
                  <th>Date</th>
                  <th>Journal</th>
                  <th>Reference</th>
                  <th className="text-right">Total Debit</th>
                  <th className="text-right">Total Credit</th>
                  <th className="text-center">State</th>
                  <th className="text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(e => {
                  const unbalanced = Math.abs(e.total_debit - e.total_credit) > 0.01;
                  return (
                    <tr key={e.id} className={unbalanced ? isDark ? 'bg-red-500/5' : 'bg-red-50/40' : ''}>
                      <td className="font-mono text-xs font-semibold text-[#7367f0]">
                        <div className="flex items-center gap-1">
                          {unbalanced && <AlertCircle size={11} className="text-red-400" />}
                          {e.name}
                        </div>
                      </td>
                      <td className={`text-xs ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>
                        {e.date ? new Date(e.date).toLocaleDateString('en-IN') : '—'}
                      </td>
                      <td>
                        <span className={`inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          e.journal === 'BNK' ? 'bg-blue-500/10 text-blue-400' :
                          e.journal === 'BOSM' ? 'bg-violet-500/10 text-violet-400' :
                          'bg-gray-500/10 text-gray-400'
                        }`}>{e.journal}</span>
                      </td>
                      <td className={`text-xs max-w-[200px] truncate ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>
                        {e.reference || '—'}
                      </td>
                      <td className={`text-right text-xs font-semibold ${unbalanced ? 'text-red-400' : isDark ? 'text-white' : 'text-gray-900'}`}>
                        ₹{e.total_debit.toLocaleString('en-IN')}
                      </td>
                      <td className={`text-right text-xs font-semibold ${unbalanced ? 'text-red-400' : isDark ? 'text-white' : 'text-gray-900'}`}>
                        ₹{e.total_credit.toLocaleString('en-IN')}
                      </td>
                      <td className="text-center">
                        <span className={`badge ${e.state === 'posted' ? 'badge-green' : 'badge-gray'}`}>
                          {e.state === 'posted' ? 'Posted' : 'Draft'}
                        </span>
                      </td>
                      <td className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => setDetailEntry(e)}
                            className={`p-1.5 rounded-lg transition-colors ${isDark ? 'hover:bg-white/5 text-[#5a6a8a] hover:text-white' : 'hover:bg-gray-100 text-gray-400 hover:text-gray-700'}`}
                            title="View"
                          >
                            <Eye size={13} />
                          </button>
                          {e.state === 'draft' && (
                            <button
                              onClick={() => handlePost(e.id)}
                              className="p-1.5 rounded-lg transition-colors text-green-400 hover:bg-green-500/10"
                              title="Post Entry"
                            >
                              <Check size={13} />
                            </button>
                          )}
                          {e.state === 'posted' && (
                            <button
                              onClick={() => handleReset(e.id)}
                              className="p-1.5 rounded-lg transition-colors text-amber-400 hover:bg-amber-500/10"
                              title="Reset to Draft"
                            >
                              <RotateCcw size={13} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-center py-10">
                      <BookOpen size={32} className={`mx-auto mb-2 ${isDark ? 'text-[#2a3250]' : 'text-gray-200'}`} />
                      <p className={`text-xs ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>No journal entries found</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {detailEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className={`${modalBg} max-w-2xl max-h-[90vh] overflow-y-auto`}>
            <div className={mh}>
              <div>
                <h2 className={`text-base font-black ${isDark ? 'text-white' : 'text-gray-900'}`}>{detailEntry.name}</h2>
                <p className={`text-xs mt-0.5 ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>
                  {detailEntry.journal} · {detailEntry.date ? new Date(detailEntry.date).toLocaleDateString('en-IN') : '—'}
                  {detailEntry.reference && ` · ${detailEntry.reference}`}
                </p>
              </div>
              <button onClick={() => setDetailEntry(null)} className={`p-2 rounded-lg ${isDark ? 'hover:bg-white/5 text-[#5a6a8a]' : 'hover:bg-gray-100 text-gray-400'}`}>
                <X size={16} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className={`rounded-xl border overflow-hidden ${isDark ? 'border-[#2a3250]' : 'border-gray-200'}`}>
                <div className="overflow-y-auto max-h-64">
                  <table className="data-table w-full">
                    <thead>
                      <tr>
                        <th>Account</th>
                        <th className="text-right">Debit (Dr)</th>
                        <th className="text-right">Credit (Cr)</th>
                        <th>Partner</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailEntry.lines.map(line => (
                        <tr key={line.id}>
                          <td className={`text-xs ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                            <span className={`font-mono mr-1.5 ${isDark ? 'text-[#7367f0]' : 'text-violet-600'}`}>{line.account_code}</span>
                            {line.account_name}
                          </td>
                          <td className={`text-right text-xs font-semibold ${line.debit > 0 ? 'text-red-400' : isDark ? 'text-[#4a5580]' : 'text-gray-300'}`}>
                            {line.debit > 0 ? `₹${line.debit.toLocaleString('en-IN')}` : '—'}
                          </td>
                          <td className={`text-right text-xs font-semibold ${line.credit > 0 ? 'text-green-400' : isDark ? 'text-[#4a5580]' : 'text-gray-300'}`}>
                            {line.credit > 0 ? `₹${line.credit.toLocaleString('en-IN')}` : '—'}
                          </td>
                          <td className={`text-xs ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>{line.partner || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className={isDark ? 'bg-[#1e2440]' : 'bg-gray-50'}>
                        <td className={`text-xs font-bold uppercase ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>Totals</td>
                        <td className="text-right text-xs font-black text-red-400">₹{detailEntry.total_debit.toLocaleString('en-IN')}</td>
                        <td className="text-right text-xs font-black text-green-400">₹{detailEntry.total_credit.toLocaleString('en-IN')}</td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
              <div className={`flex items-center gap-2 p-3 rounded-xl ${detailEntry.balanced ? isDark ? 'bg-green-500/10' : 'bg-green-50' : isDark ? 'bg-red-500/10' : 'bg-red-50'}`}>
                {detailEntry.balanced
                  ? <Check size={14} className="text-green-400" />
                  : <AlertCircle size={14} className="text-red-400" />}
                <p className={`text-xs font-semibold ${detailEntry.balanced ? 'text-green-400' : 'text-red-400'}`}>
                  {detailEntry.balanced ? 'Entry is balanced (Dr = Cr)' : 'Warning: Entry is NOT balanced'}
                </p>
              </div>
            </div>
            <div className={mf}>
              <button onClick={() => setDetailEntry(null)} className="btn-secondary text-xs px-4 py-2">Close</button>
              {detailEntry.state === 'draft' && (
                <button onClick={() => { handlePost(detailEntry.id); setDetailEntry(null); }} className="btn-primary text-xs px-4 py-2">
                  <Check size={13} /> Post Entry
                </button>
              )}
              {detailEntry.state === 'posted' && (
                <button onClick={() => { handleReset(detailEntry.id); }} className="btn-secondary text-xs px-4 py-2 text-amber-400 border-amber-400/30">
                  <RotateCcw size={13} /> Reset to Draft
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create Entry Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className={`${modalBg} max-w-2xl max-h-[90vh] overflow-y-auto`}>
            <div className={mh}>
              <h2 className={`text-base font-black ${isDark ? 'text-white' : 'text-gray-900'}`}>New Journal Entry</h2>
              <button onClick={() => setShowCreate(false)} className={`p-2 rounded-lg ${isDark ? 'hover:bg-white/5 text-[#5a6a8a]' : 'hover:bg-gray-100 text-gray-400'}`}>
                <X size={16} />
              </button>
            </div>
            <div className="p-5 space-y-4 overflow-y-auto max-h-[70vh]">
              {/* Header fields */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="label mb-1 block">Date</label>
                  <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} className={`${ic} w-full`} />
                </div>
                <div>
                  <label className="label mb-1 block">Journal</label>
                  <select value={newJournal} onChange={e => setNewJournal(e.target.value)} className={`${ic} w-full`}>
                    {JOURNALS.map(j => <option key={j} value={j}>{j}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label mb-1 block">Reference</label>
                  <input value={newRef} onChange={e => setNewRef(e.target.value)} placeholder="e.g. Invoice #12" className={`${ic} w-full`} />
                </div>
              </div>

              {/* Lines */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className={`text-[10px] font-semibold uppercase tracking-wider ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>Journal Lines</p>
                  <button onClick={addLine} className="btn-secondary text-[10px] px-2 py-1">
                    <Plus size={10} /> Add Line
                  </button>
                </div>
                <div className={`rounded-xl border overflow-hidden ${isDark ? 'border-[#2a3250]' : 'border-gray-200'}`}>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className={`${isDark ? 'bg-[#1e2440] text-[#5a6a8a]' : 'bg-gray-50 text-gray-500'} text-[10px] uppercase font-semibold`}>
                        <th className="px-3 py-2 text-left">Account</th>
                        <th className="px-3 py-2 text-left">Partner</th>
                        <th className="px-3 py-2 text-right">Debit</th>
                        <th className="px-3 py-2 text-right">Credit</th>
                        <th className="px-2 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {newLines.map(line => (
                        <tr key={line.id} className={`border-t ${isDark ? 'border-[#2a3250]' : 'border-gray-100'}`}>
                          <td className="px-3 py-2">
                            <select
                              value={line.account_code}
                              onChange={e => updateLine(line.id, 'account_code', e.target.value)}
                              className={`${lineInputCls} w-full`}
                            >
                              {ACCOUNTS.map(a => (
                                <option key={a.code} value={a.code}>{a.code} — {a.name}</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <input
                              value={line.partner}
                              onChange={e => updateLine(line.id, 'partner', e.target.value)}
                              placeholder="Partner"
                              className={`${lineInputCls} w-full`}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number" min={0}
                              value={line.debit || ''}
                              onChange={e => updateLine(line.id, 'debit', Number(e.target.value))}
                              placeholder="0"
                              className={`${lineInputCls} w-24 text-right`}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number" min={0}
                              value={line.credit || ''}
                              onChange={e => updateLine(line.id, 'credit', Number(e.target.value))}
                              placeholder="0"
                              className={`${lineInputCls} w-24 text-right`}
                            />
                          </td>
                          <td className="px-2 py-2">
                            <button onClick={() => removeLine(line.id)} className="text-red-400 hover:bg-red-500/10 p-1 rounded-lg">
                              <X size={12} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Running balance */}
              <div className={`flex items-center justify-between p-3 rounded-xl border ${newBalanced ? isDark ? 'border-green-500/30 bg-green-500/10' : 'border-green-200 bg-green-50' : isDark ? 'border-red-500/30 bg-red-500/10' : 'border-red-200 bg-red-50'}`}>
                <div className="flex items-center gap-2">
                  {newBalanced
                    ? <Check size={14} className="text-green-400" />
                    : <AlertCircle size={14} className="text-red-400" />}
                  <span className={`text-xs font-semibold ${newBalanced ? 'text-green-400' : 'text-red-400'}`}>
                    {newBalanced ? 'Entry balanced' : 'Unbalanced — cannot post'}
                  </span>
                </div>
                <div className="flex gap-4 text-xs">
                  <span className={isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}>
                    Dr: <span className="font-bold text-red-400">₹{newLinesDebit.toLocaleString('en-IN')}</span>
                  </span>
                  <span className={isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}>
                    Cr: <span className="font-bold text-green-400">₹{newLinesCredit.toLocaleString('en-IN')}</span>
                  </span>
                </div>
              </div>
            </div>
            <div className={mf}>
              <button onClick={() => setShowCreate(false)} className="btn-secondary text-xs px-4 py-2">Cancel</button>
              <button onClick={handleCreateEntry} disabled={!newBalanced} className="btn-primary text-xs px-4 py-2 disabled:opacity-40 disabled:cursor-not-allowed">
                <Plus size={13} /> Create Entry
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}



