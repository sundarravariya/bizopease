import { useState, useEffect } from 'react';
import { odooCall } from '../../../services/odoo';
import { useTheme } from '../../../context/ThemeContext';
import { useAuth } from '../../../context/AuthContext';
import { RefreshCw, Search, ChevronRight, AlertCircle, CheckCircle2 } from 'lucide-react';

interface LedgerSummary {
  id: number;
  partner_id: [number, string] | false;
  debit: number;
  credit: number;
  balance: number;
}

interface Props {
  onDrillDown: (partnerId: number, partnerName: string) => void;
}

export default function B2BLedgerSummary({ onDrillDown }: Props) {
  const { user } = useAuth();
  const { isDark } = useTheme();
  if (!user?.is_admin) return <div className="flex items-center justify-center h-64 text-[#8897b5]">Access restricted to administrators.</div>;

  const [rows, setRows] = useState<LedgerSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchSummary = async () => {
    setLoading(true);
    try {
      const res = await odooCall<LedgerSummary[]>('b2b.ledger.summary', 'search_read', [[]], {
        fields: ['id', 'partner_id', 'debit', 'credit', 'balance'],
        order: 'partner_id asc',
        limit: 0,
      });
      setRows(Array.isArray(res) ? res : []);
    } catch (err: any) {
      setMessage({ type: 'error', text: err?.message || 'Failed to load ledger summary' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchSummary(); }, []);

  const filtered = rows.filter(r => {
    if (!search) return true;
    const name = Array.isArray(r.partner_id) ? r.partner_id[1] : '';
    return name.toLowerCase().includes(search.toLowerCase());
  });

  const totalDebit = filtered.reduce((s, r) => s + r.debit, 0);
  const totalCredit = filtered.reduce((s, r) => s + r.credit, 0);
  const totalBalance = filtered.reduce((s, r) => s + r.balance, 0);

  const glassClass = isDark ? 'glass' : 'glass-light bg-white/80';
  const fmt = (n: number) => `₹ ${Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

  return (
    <div className="space-y-6">
      {message && (
        <div className={`p-4 rounded-xl flex items-start gap-3 border ${message.type === 'success' ? 'bg-green-500/10 border-green-500/20 text-green-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>
          {message.type === 'success' ? <CheckCircle2 size={18} className="flex-shrink-0" /> : <AlertCircle size={18} className="flex-shrink-0" />}
          <span className="text-sm">{message.text}</span>
        </div>
      )}

      {/* Totals */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total Debit', value: totalDebit, color: 'text-red-400' },
          { label: 'Total Credit', value: totalCredit, color: 'text-green-400' },
          { label: 'Net Balance', value: totalBalance, color: totalBalance < 0 ? 'text-red-400' : 'text-white' },
        ].map(k => (
          <div key={k.label} className={`card p-4 rounded-2xl ${glassClass}`}>
            <p className={`text-xs font-semibold uppercase tracking-wider ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>{k.label}</p>
            <p className={`text-lg font-black mt-1 ${k.color}`}>{fmt(k.value)}</p>
          </div>
        ))}
      </div>

      <div className={`card p-3 rounded-2xl flex items-center gap-3 ${glassClass}`}>
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search partner..."
            className={`pl-8 pr-3 py-1.5 text-xs rounded-lg border outline-none w-52 ${isDark ? 'bg-[#1f2937] border-white/10 text-white' : 'bg-gray-50 border-gray-200 text-gray-800'}`} />
        </div>
        <button onClick={fetchSummary} className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
        <span className={`ml-auto text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{filtered.length} partners</span>
      </div>

      <div className={`card overflow-x-auto rounded-2xl ${glassClass}`}>
        {loading ? (
          <div className="h-48 flex items-center justify-center"><RefreshCw size={20} className="animate-spin text-violet-400" /></div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className={`border-b text-xs font-semibold uppercase tracking-wider ${isDark ? 'border-white/5 bg-[#111827]/40 text-gray-400' : 'border-gray-200 bg-gray-50 text-gray-500'}`}>
                <th className="py-3.5 px-5">Partner</th>
                <th className="py-3.5 px-5 text-right">Total Debit (Dr)</th>
                <th className="py-3.5 px-5 text-right">Total Credit (Cr)</th>
                <th className="py-3.5 px-5 text-right">Net Balance</th>
                <th className="py-3.5 px-5 text-center">Ledger</th>
              </tr>
            </thead>
            <tbody className={`divide-y text-sm ${isDark ? 'divide-white/5' : 'divide-gray-100'}`}>
              {filtered.length === 0 ? (
                <tr><td colSpan={5} className={`py-12 text-center text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>No ledger activity found.</td></tr>
              ) : filtered.map(r => {
                const name = Array.isArray(r.partner_id) ? r.partner_id[1] : '—';
                return (
                  <tr key={r.id} className={`transition-colors ${isDark ? 'hover:bg-white/5' : 'hover:bg-gray-50'}`}>
                    <td className={`py-3.5 px-5 font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>{name}</td>
                    <td className="py-3.5 px-5 text-right text-red-400 font-bold">{fmt(r.debit)}</td>
                    <td className="py-3.5 px-5 text-right text-green-400 font-bold">{fmt(r.credit)}</td>
                    <td className={`py-3.5 px-5 text-right font-black ${r.balance < 0 ? 'text-red-400' : r.balance > 0 ? (isDark ? 'text-white' : 'text-gray-900') : 'text-gray-400'}`}>
                      {r.balance < 0 ? `(${fmt(r.balance)})` : fmt(r.balance)}
                    </td>
                    <td className="py-3.5 px-5 text-center">
                      <button
                        onClick={() => Array.isArray(r.partner_id) && onDrillDown(r.partner_id[0], r.partner_id[1])}
                        className="px-2.5 py-1 bg-violet-500/10 text-violet-400 border border-violet-500/20 text-xs font-bold rounded-lg hover:bg-violet-500/20 transition-all flex items-center gap-1 mx-auto"
                      >
                        <ChevronRight size={11} /> View
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {filtered.length > 0 && (
              <tfoot>
                <tr className={`border-t font-black text-sm ${isDark ? 'border-white/10 text-white' : 'border-gray-200 text-gray-800'}`}>
                  <td className="py-3 px-5">Total</td>
                  <td className="py-3 px-5 text-right text-red-400">{fmt(totalDebit)}</td>
                  <td className="py-3 px-5 text-right text-green-400">{fmt(totalCredit)}</td>
                  <td className={`py-3 px-5 text-right ${totalBalance < 0 ? 'text-red-400' : isDark ? 'text-white' : 'text-gray-900'}`}>
                    {totalBalance < 0 ? `(${fmt(totalBalance)})` : fmt(totalBalance)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </div>
    </div>
  );
}
