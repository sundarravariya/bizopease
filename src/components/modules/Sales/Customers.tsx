import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../../../context/ThemeContext';
import { useAuth } from '../../../context/AuthContext';
import { searchRead, createRecord, writeRecord } from '../../../services/odoo';
import BulkDeleteBar from '../../ui/BulkDeleteBar';
import {
  Plus, RefreshCw, Search, X, Mail, Phone, MapPin,
  Users, DollarSign, AlertCircle, FileText, ChevronRight,
  ShieldCheck, Clock, Image as ImageIcon,
} from 'lucide-react';

type PriceMode = 'show' | 'hide';

interface Customer {
  id: number;
  name: string;
  email: string;
  phone: string;
  city: string;
  state_province: string;
  total_receivable: number;
  total_payable: number;
  credit_limit: number;
  active: boolean;
  orders_count: number;
  // B2B (b2b_os res.partner extension)
  b2b_approved: boolean;
  b2b_pending: boolean;
  b2b_business_name: string;
  b2b_discount: number;
  b2b_price_mode: PriceMode;
  b2b_has_photo: boolean;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map(w => w[0])
    .join('')
    .toUpperCase();
}

const AVATAR_COLORS = [
  'from-violet-500 to-purple-600',
  'from-blue-500 to-cyan-600',
  'from-green-500 to-emerald-600',
  'from-amber-500 to-orange-600',
  'from-pink-500 to-rose-600',
  'from-indigo-500 to-blue-600',
  'from-teal-500 to-green-600',
  'from-red-500 to-pink-600',
];

const CITIES = ['All Cities', 'Mumbai', 'Delhi', 'Ahmedabad', 'Surat', 'Chennai', 'Noida', 'Jaipur'];

export default function Customers() {
  const { isDark } = useTheme();
  const { user } = useAuth();
  const isAdmin = !!user?.is_admin;
  const [selIds, setSelIds] = useState<Set<number>>(new Set());
  const navigate = useNavigate();

  const [items, setItems] = useState<Customer[]>(() => {
    const cached = localStorage.getItem('portal_customers');
    return cached ? JSON.parse(cached) : [];
  });
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [cityFilter, setCityFilter] = useState('All Cities');
  const [pendingOnly, setPendingOnly] = useState(false);
  const [drawerCustomer, setDrawerCustomer] = useState<Customer | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [savingB2b, setSavingB2b] = useState(false);

  // Create form state
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newCity, setNewCity] = useState('');
  const [newCreditLimit, setNewCreditLimit] = useState(100000);

  const syncData = async () => {
    setLoading(true);
    try {
      const result = await searchRead<any>('res.partner', {
        domain: [['customer_rank', '>', 0], ['is_company', 'in', [true, false]]],
        fields: ['id', 'name', 'email', 'phone', 'street', 'city', 'customer_rank', 'debit', 'credit', 'commercial_partner_id',
          'b2b_approved', 'b2b_pending', 'b2b_business_name', 'b2b_website_discount_percent', 'b2b_website_price_mode', 'b2b_business_photo'],
        limit: 0,
        order: 'id desc',
      });
      if (Array.isArray(result)) {
        const mapped: Customer[] = result.map((r: any) => ({
          id: r.id,
          name: r.name || 'Unknown',
          email: r.email || '',
          phone: r.phone || '',
          city: r.city || 'India',
          state_province: '',
          total_receivable: r.debit || 0,
          total_payable: r.credit || 0,
          credit_limit: 200000,
          active: true,
          orders_count: r.customer_rank || 0,
          b2b_approved: !!r.b2b_approved,
          b2b_pending: !!r.b2b_pending,
          b2b_business_name: r.b2b_business_name || '',
          b2b_discount: r.b2b_website_discount_percent || 0,
          b2b_price_mode: (r.b2b_website_price_mode as PriceMode) || 'hide',
          b2b_has_photo: !!r.b2b_business_photo,
        }));
        setItems(mapped);
        localStorage.setItem('portal_customers', JSON.stringify(mapped));
      }
    } catch {
      console.warn('Odoo offline, using localStorage cache');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { syncData(); }, []);
  useEffect(() => {
    localStorage.setItem('portal_customers', JSON.stringify(items));
  }, [items]);

  // Patch a customer in both the grid and the open drawer after a write.
  const patchCustomer = (id: number, changes: Partial<Customer>) => {
    setItems(prev => prev.map(c => c.id === id ? { ...c, ...changes } : c));
    setDrawerCustomer(prev => prev && prev.id === id ? { ...prev, ...changes } : prev);
  };

  const handleApproveB2b = async (c: Customer) => {
    setSavingB2b(true);
    try {
      await writeRecord('res.partner', [c.id], { b2b_approved: true, b2b_pending: false });
      patchCustomer(c.id, { b2b_approved: true, b2b_pending: false });
    } catch (e) {
      console.error('B2B approval failed', e);
    } finally {
      setSavingB2b(false);
    }
  };

  const handleRevokeB2b = async (c: Customer) => {
    setSavingB2b(true);
    try {
      await writeRecord('res.partner', [c.id], { b2b_approved: false });
      patchCustomer(c.id, { b2b_approved: false });
    } catch (e) {
      console.error('B2B revoke failed', e);
    } finally {
      setSavingB2b(false);
    }
  };

  const handleSaveB2bPricing = async (c: Customer, discount: number, mode: PriceMode) => {
    setSavingB2b(true);
    try {
      await writeRecord('res.partner', [c.id], {
        b2b_website_discount_percent: discount,
        b2b_website_price_mode: mode,
      });
      patchCustomer(c.id, { b2b_discount: discount, b2b_price_mode: mode });
    } catch (e) {
      console.error('B2B pricing update failed', e);
    } finally {
      setSavingB2b(false);
    }
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName) return;
    const newC: Customer = {
      id: Date.now(),
      name: newName,
      email: newEmail || `${newName.toLowerCase().replace(/\s+/g, '')}@customer.in`,
      phone: newPhone || '+91 99999 00000',
      city: newCity || 'India',
      state_province: '',
      total_receivable: 0,
      total_payable: 0,
      credit_limit: newCreditLimit,
      active: true,
      orders_count: 0,
      b2b_approved: false,
      b2b_pending: false,
      b2b_business_name: '',
      b2b_discount: 0,
      b2b_price_mode: 'hide',
      b2b_has_photo: false,
    };
    setItems(prev => [newC, ...prev]);
    try {
      createRecord('res.partner', {
        name: newName,
        email: newEmail,
        phone: newPhone,
        city: newCity,
        customer_rank: 1,
      });
    } catch {}
    setCreateOpen(false);
    setNewName(''); setNewEmail(''); setNewPhone(''); setNewCity(''); setNewCreditLimit(100000);
  };

  const filtered = items.filter(c => {
    const ms = !search ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.email.toLowerCase().includes(search.toLowerCase()) ||
      c.city.toLowerCase().includes(search.toLowerCase());
    const mc = cityFilter === 'All Cities' || c.city === cityFilter;
    const mp = !pendingOnly || c.b2b_pending;
    return ms && mc && mp;
  });

  const totalCustomers = items.length;
  const totalReceivables = items.reduce((s, c) => s + c.total_receivable, 0);
  const pendingB2bCount = items.filter(c => c.b2b_pending).length;

  const fmt = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2 });
  const secText = isDark ? 'text-[#5a6a8a]' : 'text-gray-500';
  const primaryText = isDark ? 'text-white' : 'text-gray-900';
  const cardBg = isDark ? 'bg-[#161b2e] border-[#2a3250]' : 'bg-white border-gray-200';
  const modalBg = isDark ? 'bg-[#1e2440] border-[#2a3250]' : 'bg-white border-gray-200';
  const innerBg = isDark ? 'bg-[#12172a]' : 'bg-gray-50';
  const divider = isDark ? 'border-[#2a3250]' : 'border-gray-100';
  const inputCls = `input ${isDark ? 'bg-[#12172a] border-[#2a3250] text-white' : ''}`;

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className={`text-xl font-black ${primaryText}`}>Customers</h1>
          <p className={`text-xs mt-0.5 ${secText}`}>B2B customer accounts, receivables, and account profiles</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={syncData} disabled={loading} className="btn-secondary text-xs px-3 py-2">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Sync
          </button>
          <button onClick={() => setCreateOpen(true)} className="btn-primary text-xs px-3 py-2">
            <Plus size={13} /> Add Customer
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-violet-500/15 flex items-center justify-center flex-shrink-0">
            <Users size={18} className="text-violet-400" />
          </div>
          <div>
            <p className={`text-xs ${secText}`}>Total Customers</p>
            <p className={`text-2xl font-black ${primaryText}`}>{totalCustomers}</p>
          </div>
        </div>
        <div className="card p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-green-500/15 flex items-center justify-center flex-shrink-0">
            <DollarSign size={18} className="text-green-400" />
          </div>
          <div>
            <p className={`text-xs ${secText}`}>Total Receivables</p>
            <p className={`text-2xl font-black ${primaryText}`}>₹{(totalReceivables / 100000).toFixed(1)}L</p>
          </div>
        </div>
        <button
          onClick={() => setPendingOnly(v => !v)}
          className={`card p-5 flex items-center gap-4 text-left transition-all ${pendingOnly ? 'ring-2 ring-amber-400/60' : ''}`}
        >
          <div className="w-10 h-10 rounded-xl bg-amber-500/15 flex items-center justify-center flex-shrink-0">
            <Clock size={18} className="text-amber-400" />
          </div>
          <div>
            <p className={`text-xs ${secText}`}>Pending B2B Approval{pendingOnly ? ' (filtered)' : ''}</p>
            <p className={`text-2xl font-black ${pendingB2bCount > 0 ? 'text-amber-400' : primaryText}`}>{pendingB2bCount}</p>
          </div>
        </button>
      </div>

      {/* Filters */}
      <div className="card p-3 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={14} className={`absolute left-3 top-1/2 -translate-y-1/2 ${secText}`} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, email or city..."
            className={`input pl-9 text-xs py-2 ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`}
          />
        </div>
        <select
          value={cityFilter}
          onChange={e => setCityFilter(e.target.value)}
          className={`input text-xs py-2 w-auto ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`}
        >
          {CITIES.map(c => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      {/* Card Grid */}
      {loading ? (
        <div className="flex items-center justify-center h-40 gap-3">
          <RefreshCw size={18} className="animate-spin text-[#7367f0]" />
          <span className={`text-sm ${secText}`}>Syncing customers...</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.length === 0 ? (
            <div className={`col-span-full text-center py-12 text-xs ${secText}`}>
              No customers found matching your criteria.
            </div>
          ) : (
            filtered.map((c, idx) => (
              <div
                key={c.id}
                className={`card border p-5 flex flex-col gap-4 hover:scale-[1.02] transition-all duration-200 cursor-pointer ${cardBg} ${selIds.has(c.id) ? 'ring-2 ring-rose-500/40' : ''}`}
                onClick={() => setDrawerCustomer(c)}
              >
                {/* Avatar + name */}
                <div className="flex items-center gap-3">
                  {isAdmin && (
                    <input type="checkbox" className="rounded flex-shrink-0" checked={selIds.has(c.id)}
                      onClick={e => e.stopPropagation()}
                      onChange={() => setSelIds(prev => { const n = new Set(prev); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; })} />
                  )}
                  <div className={`w-11 h-11 rounded-2xl bg-gradient-to-br ${AVATAR_COLORS[idx % AVATAR_COLORS.length]} flex items-center justify-center flex-shrink-0`}>
                    <span className="text-white font-black text-sm">{getInitials(c.name)}</span>
                  </div>
                  <div className="min-w-0">
                    <p className={`font-bold text-sm leading-tight truncate ${primaryText}`}>{c.name}</p>
                    <div className="flex items-center gap-1 mt-0.5">
                      <MapPin size={10} className={secText} />
                      <p className={`text-xs truncate ${secText}`}>{c.city}{c.state_province ? `, ${c.state_province}` : ''}</p>
                    </div>
                  </div>
                </div>

                {/* Contact info */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Mail size={12} className="text-violet-400 flex-shrink-0" />
                    <span className={`text-xs truncate ${secText}`}>{c.email || 'No email'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Phone size={12} className="text-violet-400 flex-shrink-0" />
                    <span className={`text-xs ${secText}`}>{c.phone || 'No phone'}</span>
                  </div>
                </div>

                {/* B2B status */}
                {(c.b2b_approved || c.b2b_pending) && (
                  <div>
                    {c.b2b_pending ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                        <Clock size={10} /> B2B Pending
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/20">
                        <ShieldCheck size={10} /> B2B Approved{c.b2b_discount ? ` -${c.b2b_discount}%` : ''}
                      </span>
                    )}
                  </div>
                )}

                {/* Receivable badge + orders */}
                <div className="flex items-center justify-between">
                  {c.total_receivable > 0 ? (
                    <span className="badge-gold text-xs">
                      Recv: ₹{(c.total_receivable / 1000).toFixed(0)}K
                    </span>
                  ) : (
                    <span className="badge-green text-xs">Clear Balance</span>
                  )}
                  <span className={`text-xs ${secText}`}>{c.orders_count} orders</span>
                </div>

                {/* View button */}
                <button
                  onClick={e => { e.stopPropagation(); setDrawerCustomer(c); }}
                  className="btn-secondary text-xs py-2 w-full justify-center"
                >
                  View Account <ChevronRight size={12} />
                </button>
              </div>
            ))
          )}
        </div>
      )}

      <BulkDeleteBar model="res.partner" label="customer" ids={Array.from(selIds)}
        onClear={() => setSelIds(new Set())} onDeleted={() => { setSelIds(new Set()); syncData(); }} />

      {/* Right-side Drawer */}
      {drawerCustomer && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
            onClick={() => setDrawerCustomer(null)}
          />
          <div
            className={`fixed right-0 top-0 h-full w-full max-w-sm z-50 shadow-2xl flex flex-col border-l transition-transform duration-300 ${isDark ? 'bg-[#161b2e] border-[#2a3250]' : 'bg-white border-gray-200'}`}
          >
            {/* Drawer header */}
            <div className={`flex items-center justify-between px-5 py-4 border-b ${divider}`}>
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${AVATAR_COLORS[items.indexOf(drawerCustomer) % AVATAR_COLORS.length]} flex items-center justify-center flex-shrink-0`}>
                  <span className="text-white font-black text-sm">{getInitials(drawerCustomer.name)}</span>
                </div>
                <div>
                  <p className={`font-bold text-sm ${primaryText}`}>{drawerCustomer.name}</p>
                  <p className={`text-xs ${secText}`}>{drawerCustomer.city}</p>
                </div>
              </div>
              <button
                onClick={() => setDrawerCustomer(null)}
                className={`p-1.5 rounded-lg ${isDark ? 'text-[#5a6a8a] hover:bg-white/5' : 'text-gray-400 hover:bg-gray-100'}`}
              >
                <X size={16} />
              </button>
            </div>

            {/* Drawer body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* Contact section */}
              <div>
                <p className={`text-xs font-semibold uppercase tracking-wider mb-3 ${secText}`}>Contact Info</p>
                <div className="space-y-2">
                  <div className={`flex items-center gap-3 p-3 rounded-xl ${innerBg}`}>
                    <Mail size={14} className="text-violet-400 flex-shrink-0" />
                    <span className={`text-xs ${primaryText}`}>{drawerCustomer.email || 'No email'}</span>
                  </div>
                  <div className={`flex items-center gap-3 p-3 rounded-xl ${innerBg}`}>
                    <Phone size={14} className="text-violet-400 flex-shrink-0" />
                    <span className={`text-xs ${primaryText}`}>{drawerCustomer.phone || 'No phone'}</span>
                  </div>
                  <div className={`flex items-center gap-3 p-3 rounded-xl ${innerBg}`}>
                    <MapPin size={14} className="text-violet-400 flex-shrink-0" />
                    <span className={`text-xs ${primaryText}`}>
                      {drawerCustomer.city}{drawerCustomer.state_province ? `, ${drawerCustomer.state_province}` : ''}
                    </span>
                  </div>
                </div>
              </div>

              {/* Balance info */}
              <div>
                <p className={`text-xs font-semibold uppercase tracking-wider mb-3 ${secText}`}>Balance Info</p>
                <div className="space-y-2">
                  <div className={`flex justify-between items-center p-3 rounded-xl ${innerBg}`}>
                    <span className={`text-xs ${secText}`}>Total Receivable</span>
                    <span className={`text-xs font-bold ${drawerCustomer.total_receivable > 0 ? 'text-amber-400' : 'text-green-400'}`}>
                      ₹{fmt(drawerCustomer.total_receivable)}
                    </span>
                  </div>
                  <div className={`flex justify-between items-center p-3 rounded-xl ${innerBg}`}>
                    <span className={`text-xs ${secText}`}>Total Payable</span>
                    <span className={`text-xs font-bold ${drawerCustomer.total_payable > 0 ? 'text-red-400' : 'text-green-400'}`}>
                      ₹{fmt(drawerCustomer.total_payable)}
                    </span>
                  </div>
                  <div className={`flex justify-between items-center p-3 rounded-xl ${innerBg}`}>
                    <span className={`text-xs ${secText}`}>Credit Limit</span>
                    <span className={`text-xs font-bold ${primaryText}`}>
                      ₹{fmt(drawerCustomer.credit_limit)}
                    </span>
                  </div>
                </div>
              </div>

              {/* B2B management */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className={`text-xs font-semibold uppercase tracking-wider ${secText}`}>B2B Wholesale Access</p>
                  {drawerCustomer.b2b_pending ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20"><Clock size={10} /> Pending</span>
                  ) : drawerCustomer.b2b_approved ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/20"><ShieldCheck size={10} /> Approved</span>
                  ) : (
                    <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${innerBg} ${secText}`}>Not a B2B customer</span>
                  )}
                </div>

                {drawerCustomer.b2b_business_name && (
                  <div className={`flex items-center gap-3 p-3 rounded-xl mb-2 ${innerBg}`}>
                    <Users size={14} className="text-violet-400 flex-shrink-0" />
                    <span className={`text-xs ${primaryText}`}>{drawerCustomer.b2b_business_name}</span>
                  </div>
                )}

                {drawerCustomer.b2b_has_photo && (
                  <a
                    href={`/web/content?model=res.partner&id=${drawerCustomer.id}&field=b2b_business_photo`}
                    target="_blank"
                    rel="noreferrer"
                    className={`flex items-center gap-3 p-3 rounded-xl mb-2 ${innerBg} hover:opacity-80`}
                  >
                    <ImageIcon size={14} className="text-violet-400 flex-shrink-0" />
                    <span className="text-xs text-violet-400 font-medium">View business / shop photo</span>
                  </a>
                )}

                {(drawerCustomer.b2b_approved || drawerCustomer.b2b_pending) && (
                  <div className={`p-3 rounded-xl space-y-3 ${innerBg}`}>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={`text-[10px] uppercase tracking-wider ${secText}`}>Website Discount %</label>
                        <input
                          type="number" min={0} max={100} step="0.5"
                          defaultValue={drawerCustomer.b2b_discount}
                          onBlur={e => {
                            const v = Math.min(Math.max(parseFloat(e.target.value) || 0, 0), 100);
                            if (v !== drawerCustomer.b2b_discount) handleSaveB2bPricing(drawerCustomer, v, drawerCustomer.b2b_price_mode);
                          }}
                          className={`input mt-1 text-xs py-1.5 ${isDark ? 'bg-[#0f1420] border-[#2a3250] text-white' : ''}`}
                        />
                      </div>
                      <div>
                        <label className={`text-[10px] uppercase tracking-wider ${secText}`}>Website Pricing</label>
                        <select
                          value={drawerCustomer.b2b_price_mode}
                          onChange={e => handleSaveB2bPricing(drawerCustomer, drawerCustomer.b2b_discount, e.target.value as PriceMode)}
                          className={`input mt-1 text-xs py-1.5 ${isDark ? 'bg-[#0f1420] border-[#2a3250] text-white' : ''}`}
                        >
                          <option value="hide">Hide Sale Price</option>
                          <option value="show">Show Sale Price</option>
                        </select>
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex gap-2 mt-3">
                  {!drawerCustomer.b2b_approved ? (
                    <button
                      onClick={() => handleApproveB2b(drawerCustomer)}
                      disabled={savingB2b}
                      className="btn-primary flex-1 justify-center py-2 text-xs"
                    >
                      {savingB2b ? <RefreshCw size={13} className="animate-spin" /> : <ShieldCheck size={13} />} Approve for B2B
                    </button>
                  ) : (
                    <button
                      onClick={() => handleRevokeB2b(drawerCustomer)}
                      disabled={savingB2b}
                      className="btn-secondary flex-1 justify-center py-2 text-xs text-red-400"
                    >
                      {savingB2b ? <RefreshCw size={13} className="animate-spin" /> : <X size={13} />} Revoke B2B Access
                    </button>
                  )}
                </div>
              </div>

              {/* Orders summary */}
              <div>
                <p className={`text-xs font-semibold uppercase tracking-wider mb-3 ${secText}`}>Orders History</p>
                <div className={`flex items-center gap-3 p-4 rounded-xl ${innerBg}`}>
                  <FileText size={20} className="text-violet-400 flex-shrink-0" />
                  <div>
                    <p className={`text-lg font-black ${primaryText}`}>{drawerCustomer.orders_count}</p>
                    <p className={`text-xs ${secText}`}>Total orders placed</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Drawer footer */}
            <div className={`p-5 border-t ${divider}`}>
              <button
                onClick={() => {
                  setDrawerCustomer(null);
                  navigate('../quotations');
                }}
                className="btn-primary w-full justify-center py-2.5"
              >
                <Plus size={14} /> Create Quotation
              </button>
            </div>
          </div>
        </>
      )}

      {/* Create Modal */}
      {createOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => setCreateOpen(false)}
        >
          <div
            className={`w-full max-w-md rounded-2xl border shadow-2xl overflow-hidden ${modalBg}`}
            onClick={e => e.stopPropagation()}
          >
            <div className={`flex justify-between items-center px-5 py-4 border-b ${divider}`}>
              <h3 className={`font-bold ${primaryText}`}>Add Customer</h3>
              <button
                onClick={() => setCreateOpen(false)}
                className={`p-1.5 rounded-lg ${isDark ? 'text-[#5a6a8a] hover:bg-white/5' : 'text-gray-400 hover:bg-gray-100'}`}
              >
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleCreate} className="p-5 space-y-4">
              <div>
                <label className="label">Business Name</label>
                <input
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  required
                  placeholder="e.g. Shree Traders & Co."
                  className={inputCls}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Email</label>
                  <input
                    type="email"
                    value={newEmail}
                    onChange={e => setNewEmail(e.target.value)}
                    placeholder="contact@domain.in"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="label">Phone</label>
                  <input
                    type="text"
                    value={newPhone}
                    onChange={e => setNewPhone(e.target.value)}
                    placeholder="+91 XXXXX XXXXX"
                    className={inputCls}
                  />
                </div>
              </div>
              <div>
                <label className="label">City</label>
                <input
                  type="text"
                  value={newCity}
                  onChange={e => setNewCity(e.target.value)}
                  placeholder="e.g. Mumbai"
                  className={inputCls}
                />
              </div>
              <div>
                <label className="label">Credit Limit (Rs.)</label>
                <input
                  type="number"
                  value={newCreditLimit}
                  onChange={e => setNewCreditLimit(Number(e.target.value))}
                  min={0}
                  className={inputCls}
                />
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="btn-secondary flex-1 justify-center py-2.5"
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary flex-1 justify-center py-2.5">
                  <Plus size={14} /> Add Customer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}


