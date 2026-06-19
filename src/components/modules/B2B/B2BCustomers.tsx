import { useState, useEffect } from 'react';
import { queenCall } from '../../../services/queen';
import { useTheme } from '../../../context/ThemeContext';
import { useAuth } from '../../../context/AuthContext';
import {
  RefreshCw, CheckCircle2, AlertCircle, UserCheck, UserX,
  Search, Building2, Mail, Phone, Image, ChevronRight, X, Square, CheckSquare, Trash2
} from 'lucide-react';

interface B2BPartner {
  id: number;
  name: string;
  email: string | false;
  phone: string | false;
  b2b_business_name: string | false;
  b2b_business_photo: string | false;
  b2b_approved: boolean;
  b2b_pending: boolean;
  b2b_website_price_mode: 'show' | 'hide';
  b2b_website_discount_percent: number;
  create_date: string;
}

type ActiveTab = 'pending' | 'approved';

export default function B2BCustomers() {
  const { user } = useAuth();
  const { isDark } = useTheme();
  if (!user?.is_admin) return <div className="flex items-center justify-center h-64 text-[#8897b5]">Access restricted to administrators.</div>;

  const [tab, setTab] = useState<ActiveTab>('pending');
  const [partners, setPartners] = useState<B2BPartner[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [editPartner, setEditPartner] = useState<B2BPartner | null>(null);
  const [editMode, setEditMode] = useState<'show' | 'hide'>('hide');
  const [editDiscount, setEditDiscount] = useState('0');
  const [saving, setSaving] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const showMsg = (ok: boolean, msg: string) => {
    setMessage({ type: ok ? 'success' : 'error', text: msg });
    setTimeout(() => setMessage(null), 5000);
  };

  const fetchPartners = async () => {
    setLoading(true);
    try {
      const domain = tab === 'pending'
        ? [['b2b_pending', '=', true], ['b2b_approved', '=', false]]
        : [['b2b_approved', '=', true]];
      const res = await queenCall<B2BPartner[]>('res.partner', 'search_read', [domain], {
        fields: ['id', 'name', 'email', 'phone', 'b2b_business_name', 'b2b_business_photo',
                 'b2b_approved', 'b2b_pending', 'b2b_website_price_mode',
                 'b2b_website_discount_percent', 'create_date'],
        order: 'create_date desc',
        limit: 0,
      });
      setPartners(Array.isArray(res) ? res : []);
    } catch (err: any) {
      showMsg(false, err?.message || 'Failed to load customers');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchPartners(); setSelectedIds(new Set()); }, [tab]);

  const handleBulkApprove = async () => {
    if (!selectedIds.size) return;
    if (!confirm(`Approve ${selectedIds.size} selected customer(s)?`)) return;
    setLoading(true);
    try {
      await queenCall('res.partner', 'write', [[...selectedIds], { b2b_approved: true, b2b_pending: false }]);
      showMsg(true, `${selectedIds.size} customer(s) approved.`);
      setSelectedIds(new Set());
      fetchPartners();
    } catch (err: any) { showMsg(false, err?.message || 'Bulk approve failed'); }
    finally { setLoading(false); }
  };

  const handleBulkReject = async () => {
    if (!selectedIds.size) return;
    if (!confirm(`Reject ${selectedIds.size} selected application(s)?`)) return;
    setLoading(true);
    try {
      await queenCall('res.partner', 'write', [[...selectedIds], { b2b_approved: false, b2b_pending: false }]);
      showMsg(true, `${selectedIds.size} application(s) rejected.`);
      setSelectedIds(new Set());
      fetchPartners();
    } catch (err: any) { showMsg(false, err?.message || 'Bulk reject failed'); }
    finally { setLoading(false); }
  };

  const handleBulkDelete = async () => {
    if (!selectedIds.size) return;
    if (!confirm(`Permanently delete ${selectedIds.size} partner record(s)? This cannot be undone.`)) return;
    setLoading(true);
    try {
      await queenCall('res.partner', 'unlink', [[...selectedIds]]);
      showMsg(true, `${selectedIds.size} partner(s) deleted.`);
      setSelectedIds(new Set());
      fetchPartners();
    } catch (err: any) { showMsg(false, err?.message || 'Bulk delete failed'); }
    finally { setLoading(false); }
  };

  const handleApprove = async (id: number) => {
    try {
      await queenCall('res.partner', 'write', [[id], { b2b_approved: true, b2b_pending: false }]);
      showMsg(true, 'Customer approved for B2B ordering.');
      fetchPartners();
    } catch (err: any) { showMsg(false, err?.message || 'Approve failed'); }
  };

  const handleReject = async (id: number) => {
    if (!confirm('Reject this B2B application?')) return;
    try {
      await queenCall('res.partner', 'write', [[id], { b2b_approved: false, b2b_pending: false }]);
      showMsg(true, 'Application rejected.');
      fetchPartners();
    } catch (err: any) { showMsg(false, err?.message || 'Reject failed'); }
  };

  const openEdit = (p: B2BPartner) => {
    setEditPartner(p);
    setEditMode(p.b2b_website_price_mode || 'hide');
    setEditDiscount(String(p.b2b_website_discount_percent || 0));
  };

  const handleSaveEdit = async () => {
    if (!editPartner) return;
    setSaving(true);
    try {
      await queenCall('res.partner', 'write', [[editPartner.id], {
        b2b_website_price_mode: editMode,
        b2b_website_discount_percent: parseFloat(editDiscount) || 0,
      }]);
      showMsg(true, 'Pricing policy saved.');
      setEditPartner(null);
      fetchPartners();
    } catch (err: any) { showMsg(false, err?.message || 'Save failed'); }
    finally { setSaving(false); }
  };

  const filtered = partners.filter(p => {
    const q = search.toLowerCase();
    return !q || p.name.toLowerCase().includes(q) ||
      (p.email && String(p.email).toLowerCase().includes(q)) ||
      (p.b2b_business_name && String(p.b2b_business_name).toLowerCase().includes(q));
  });

  const glassClass = isDark ? 'glass' : 'glass-light bg-white/80';
  const tabBtn = (t: ActiveTab, label: string, count?: number) => (
    <button
      onClick={() => setTab(t)}
      className={`px-4 py-2 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 ${
        tab === t
          ? 'bg-[#7367f0] text-white shadow-lg'
          : isDark ? 'text-gray-400 hover:text-white hover:bg-white/5' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
      }`}
    >
      {label}
      {count !== undefined && (
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-black ${
          tab === t ? 'bg-white/20' : 'bg-gray-500/20'
        }`}>{count}</span>
      )}
    </button>
  );

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className={`text-2xl font-black ${isDark ? 'text-white' : 'text-gray-900'}`}>B2B Customers</h1>
          <p className={`text-xs mt-1 ${isDark ? 'text-[#5a6a8a]' : 'text-gray-500'}`}>
            Approve registrations and manage customer pricing policies.
          </p>
        </div>
        <button onClick={fetchPartners} className="btn-secondary text-xs px-3.5 py-1.5 flex items-center gap-1">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {message && (
        <div className={`p-4 rounded-xl flex items-start gap-3 border ${
          message.type === 'success' ? 'bg-green-500/10 border-green-500/20 text-green-400' : 'bg-red-500/10 border-red-500/20 text-red-400'
        }`}>
          {message.type === 'success' ? <CheckCircle2 size={18} className="flex-shrink-0" /> : <AlertCircle size={18} className="flex-shrink-0" />}
          <span className="text-sm font-medium">{message.text}</span>
        </div>
      )}

      <div className={`card p-3 rounded-2xl flex flex-col sm:flex-row items-center gap-3 ${glassClass}`}>
        <div className="flex gap-1">{tabBtn('pending', 'Pending Approvals')}{tabBtn('approved', 'Approved Customers')}</div>
        <div className="relative sm:ml-4">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search name, email, business..."
            className={`pl-8 pr-3 py-1.5 text-xs rounded-lg border outline-none w-56 ${isDark ? 'bg-[#1f2937] border-white/10 text-white' : 'bg-gray-50 border-gray-200 text-gray-800'}`}
          />
        </div>
        <span className={`sm:ml-auto text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{filtered.length} record{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Bulk Action Bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-4 py-3 rounded-2xl shadow-2xl border border-[#7367f0]/30 bg-[#161b2e]/95 backdrop-blur-sm animate-fade-in">
          <span className="text-xs font-bold text-violet-400 mr-1">{selectedIds.size} selected</span>
          {tab === 'pending' && (
            <>
              <button onClick={handleBulkApprove} className="px-3 py-1.5 bg-green-500/10 text-green-400 border border-green-500/20 text-xs font-bold rounded-lg hover:bg-green-500/20 transition-all flex items-center gap-1">
                <UserCheck size={11} /> Approve All
              </button>
              <button onClick={handleBulkReject} className="px-3 py-1.5 bg-red-500/10 text-red-400 border border-red-500/20 text-xs font-bold rounded-lg hover:bg-red-500/20 transition-all flex items-center gap-1">
                <UserX size={11} /> Reject All
              </button>
            </>
          )}
          <button onClick={handleBulkDelete} className="px-3 py-1.5 bg-red-600/10 text-red-500 border border-red-600/20 text-xs font-bold rounded-lg hover:bg-red-600/20 transition-all flex items-center gap-1">
            <Trash2 size={11} /> Delete
          </button>
          <button onClick={() => setSelectedIds(new Set())} className="ml-1 p-1.5 text-gray-500 hover:text-white transition-colors">
            <X size={14} />
          </button>
        </div>
      )}

      <div className={`card overflow-x-auto rounded-2xl ${glassClass}`}>
        {loading ? (
          <div className="h-48 flex items-center justify-center"><RefreshCw size={20} className="animate-spin text-violet-400" /></div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className={`border-b text-xs font-semibold uppercase tracking-wider ${isDark ? 'border-white/5 bg-[#111827]/40 text-gray-400' : 'border-gray-200 bg-gray-50 text-gray-500'}`}>
                <th className="py-3.5 pl-5 pr-2 w-8">
                  <button onClick={() => {
                    if (selectedIds.size === filtered.length && filtered.length > 0) {
                      setSelectedIds(new Set());
                    } else {
                      setSelectedIds(new Set(filtered.map(p => p.id)));
                    }
                  }} className="text-gray-400 hover:text-violet-400 transition-colors">
                    {selectedIds.size === filtered.length && filtered.length > 0
                      ? <CheckSquare size={14} className="text-violet-400" />
                      : <Square size={14} />}
                  </button>
                </th>
                <th className="py-3.5 px-5">Partner</th>
                <th className="py-3.5 px-5">Business Name</th>
                <th className="py-3.5 px-5">Contact</th>
                <th className="py-3.5 px-5">Registered</th>
                {tab === 'approved' && <th className="py-3.5 px-5 text-center">Pricing Policy</th>}
                {tab === 'approved' && <th className="py-3.5 px-5 text-center">Discount %</th>}
                <th className="py-3.5 px-5 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className={`divide-y text-sm ${isDark ? 'divide-white/5' : 'divide-gray-100'}`}>
              {filtered.length === 0 ? (
                <tr><td colSpan={tab === 'approved' ? 8 : 6} className={`py-12 text-center text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                  {tab === 'pending' ? 'No pending approval requests.' : 'No approved B2B customers.'}
                </td></tr>
              ) : filtered.map(p => {
                const isSelected = selectedIds.has(p.id);
                return (
                <tr key={p.id} className={`transition-colors ${isSelected ? (isDark ? 'bg-violet-500/5' : 'bg-violet-50') : isDark ? 'hover:bg-white/5' : 'hover:bg-gray-50'}`}>
                  <td className="py-3.5 pl-5 pr-2">
                    <button onClick={() => {
                      const next = new Set(selectedIds);
                      if (isSelected) next.delete(p.id); else next.add(p.id);
                      setSelectedIds(next);
                    }} className="text-gray-500 hover:text-violet-400 transition-colors">
                      {isSelected ? <CheckSquare size={14} className="text-violet-400" /> : <Square size={14} />}
                    </button>
                  </td>
                  <td className="py-3.5 px-5">
                    <div className="flex items-center gap-2">
                      {p.b2b_business_photo ? (
                        <img
                          src={`data:image/jpeg;base64,${p.b2b_business_photo}`}
                          alt={p.b2b_business_name || p.name}
                          className="w-8 h-8 rounded-full object-cover flex-shrink-0 border border-white/10"
                        />
                      ) : (
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0 ${isDark ? 'bg-[#7367f0]/20 text-[#7367f0]' : 'bg-violet-100 text-violet-600'}`}>
                          {p.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <span className={`font-bold text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>{p.name}</span>
                    </div>
                  </td>
                  <td className={`py-3.5 px-5 text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    {p.b2b_business_name || <span className="italic opacity-50">—</span>}
                  </td>
                  <td className="py-3.5 px-5">
                    <div className={`text-xs space-y-0.5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                      {p.email && <div className="flex items-center gap-1"><Mail size={10} />{String(p.email)}</div>}
                      {p.phone && <div className="flex items-center gap-1"><Phone size={10} />{String(p.phone)}</div>}
                    </div>
                  </td>
                  <td className={`py-3.5 px-5 text-xs font-mono ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                    {p.create_date?.split(' ')[0] || '—'}
                  </td>
                  {tab === 'approved' && (
                    <td className="py-3.5 px-5 text-center">
                      <span className={`text-[10px] font-bold uppercase px-2.5 py-0.5 rounded-full border ${
                        p.b2b_website_price_mode === 'show'
                          ? 'bg-green-500/10 text-green-400 border-green-500/20'
                          : 'bg-gray-500/10 text-gray-400 border-gray-500/20'
                      }`}>{p.b2b_website_price_mode === 'show' ? 'Show Price' : 'Hide Price'}</span>
                    </td>
                  )}
                  {tab === 'approved' && (
                    <td className={`py-3.5 px-5 text-center font-bold text-sm ${isDark ? 'text-white' : 'text-gray-800'}`}>
                      {p.b2b_website_discount_percent > 0 ? `${p.b2b_website_discount_percent}%` : '—'}
                    </td>
                  )}
                  <td className="py-3.5 px-5 text-center">
                    <div className="flex gap-1.5 justify-center flex-wrap">
                      {tab === 'pending' && (
                        <>
                          <button onClick={() => handleApprove(p.id)}
                            className="px-2.5 py-1 bg-green-500/10 text-green-400 border border-green-500/20 text-xs font-bold rounded-lg hover:bg-green-500/20 transition-all flex items-center gap-1">
                            <UserCheck size={11} /> Approve
                          </button>
                          <button onClick={() => handleReject(p.id)}
                            className="px-2.5 py-1 bg-red-500/10 text-red-400 border border-red-500/20 text-xs font-bold rounded-lg hover:bg-red-500/20 transition-all flex items-center gap-1">
                            <UserX size={11} /> Reject
                          </button>
                        </>
                      )}
                      {tab === 'approved' && (
                        <button onClick={() => openEdit(p)}
                          className="px-2.5 py-1 bg-violet-500/10 text-violet-400 border border-violet-500/20 text-xs font-bold rounded-lg hover:bg-violet-500/20 transition-all flex items-center gap-1">
                          <ChevronRight size={11} /> Pricing
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pricing Edit Modal */}
      {editPartner && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setEditPartner(null)}>
          <div className={`w-full max-w-sm rounded-3xl border shadow-2xl overflow-hidden ${isDark ? 'bg-[#161b2e] border-[#2a3250]' : 'bg-white border-gray-200'}`}
            onClick={e => e.stopPropagation()}>
            <div className={`p-5 border-b flex items-center justify-between ${isDark ? 'border-[#2a3250]' : 'border-gray-100'}`}>
              <div>
                <h3 className={`font-black text-base ${isDark ? 'text-white' : 'text-gray-900'}`}>Website Pricing</h3>
                <p className={`text-xs mt-0.5 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{editPartner.name}</p>
              </div>
              <button onClick={() => setEditPartner(null)} className={`p-1.5 rounded-xl ${isDark ? 'hover:bg-white/5 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}><X size={16} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="label text-[#5a6a8a]">Price Visibility on Website</label>
                <select value={editMode} onChange={e => setEditMode(e.target.value as 'show' | 'hide')}
                  className={`input ${isDark ? 'bg-[#12172a] border-[#2a3250] text-white' : ''}`}>
                  <option value="hide">Hide Sale Price (Browse Only)</option>
                  <option value="show">Show Sale Price</option>
                </select>
              </div>
              {editMode === 'show' && (
                <div>
                  <label className="label text-[#5a6a8a]">Discount % (applied on list price)</label>
                  <input type="number" min="0" max="100" step="0.5" value={editDiscount}
                    onChange={e => setEditDiscount(e.target.value)}
                    className={`input ${isDark ? 'bg-[#12172a] border-[#2a3250] text-white' : ''}`} />
                </div>
              )}
              <div className="flex gap-2 pt-2">
                <button onClick={() => setEditPartner(null)} className="btn-secondary flex-1 justify-center text-xs py-2.5">Cancel</button>
                <button onClick={handleSaveEdit} disabled={saving} className="btn-primary flex-1 justify-center text-xs py-2.5 flex items-center gap-1">
                  {saving ? <RefreshCw size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
