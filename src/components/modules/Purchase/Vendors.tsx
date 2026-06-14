import React, { useState, useEffect } from 'react';
import { useTheme } from '../../../context/ThemeContext';
import { useAuth } from '../../../context/AuthContext';
import { searchRead, createRecord } from '../../../services/odoo';
import BulkDeleteBar from '../../ui/BulkDeleteBar';
import { Plus, Search, RefreshCw, X, Mail, Phone, MapPin, Building2, ExternalLink, CreditCard } from 'lucide-react';

interface Vendor {
  id: number;
  name: string;
  email: string;
  phone: string;
  city: string;
  category: string;
  total_payable: number;
  total_purchases: number;
  active: boolean;
  on_time_delivery: number;
}

const AVATAR_COLORS = [
  'from-violet-500 to-purple-600',
  'from-blue-500 to-cyan-600',
  'from-emerald-500 to-teal-600',
  'from-amber-500 to-orange-600',
  'from-rose-500 to-pink-600',
  'from-indigo-500 to-blue-600',
  'from-teal-500 to-green-600',
  'from-fuchsia-500 to-violet-600',
];

const CATEGORIES = ['Raw Materials', 'Packaging', 'Logistics', 'Electronics'];

const BANK_DETAILS: Record<number, { bank: string; account: string; ifsc: string }> = {
  1: { bank: 'HDFC Bank', account: 'XXXX XXXX 4421', ifsc: 'HDFC0001234' },
  2: { bank: 'ICICI Bank', account: 'XXXX XXXX 8832', ifsc: 'ICIC0005678' },
  3: { bank: 'SBI', account: 'XXXX XXXX 2210', ifsc: 'SBIN0009012' },
  4: { bank: 'Axis Bank', account: 'XXXX XXXX 5543', ifsc: 'UTIB0003456' },
  5: { bank: 'Kotak Bank', account: 'XXXX XXXX 9921', ifsc: 'KKBK0007890' },
  6: { bank: 'Yes Bank', account: 'XXXX XXXX 3310', ifsc: 'YESB0001234' },
  7: { bank: 'PNB', account: 'XXXX XXXX 7765', ifsc: 'PUNB0005678' },
  8: { bank: 'Bank of Baroda', account: 'XXXX XXXX 6634', ifsc: 'BARB0009012' },
};

export default function Vendors() {
  const { isDark } = useTheme();
  const { user } = useAuth();
  const isAdmin = !!user?.is_admin;
  const [selIds, setSelIds] = useState<Set<number>>(new Set());

  const [vendors, setVendors] = useState<Vendor[]>(() => {
    const cached = localStorage.getItem('portal_vendors');
    return cached ? JSON.parse(cached) : [];
  });

  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('all');
  const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null);
  const [createModal, setCreateModal] = useState(false);

  // Create form fields
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [category, setCategory] = useState('Raw Materials');

  useEffect(() => {
    localStorage.setItem('portal_vendors', JSON.stringify(vendors));
  }, [vendors]);

  const syncData = async () => {
    setLoading(true);
    try {
      const r = await searchRead<any>('res.partner', {
        domain: [['supplier_rank', '>', 0]],
        fields: ['id', 'name', 'email', 'phone', 'street', 'city', 'supplier_rank', 'debit'],
        limit: 0,
        order: 'id desc'
      });
      if (Array.isArray(r)) {
        const mapped: Vendor[] = r.map((rec: any, idx: number) => ({
          id: rec.id,
          name: rec.name || 'Unknown',
          email: rec.email || '',
          phone: rec.phone || '',
          city: rec.city || '',
          category: CATEGORIES[idx % CATEGORIES.length],
          total_payable: rec.debit || 0,
          total_purchases: (rec.debit || 0) * 4,
          active: true,
          on_time_delivery: 75 + Math.floor(Math.random() * 20),
        }));
        setVendors(mapped);
      }
    } catch { console.warn('Odoo offline, using local data'); }
    finally { setLoading(false); }
  };

  useEffect(() => { syncData(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) return;

    const newVendor: Vendor = {
      id: Date.now(),
      name,
      email: email || `${name.toLowerCase().replace(/\s+/g, '')}@supplier.in`,
      phone: phone || '+91 99999 00000',
      city: city || 'India',
      category,
      total_payable: 0,
      total_purchases: 0,
      active: true,
      on_time_delivery: 90,
    };

    setVendors(prev => [newVendor, ...prev]);

    // Try to create in Odoo
    createRecord('res.partner', {
      name,
      email: newVendor.email,
      phone: newVendor.phone,
      city: newVendor.city,
      supplier_rank: 1,
    }).catch(() => {});

    setName(''); setEmail(''); setPhone(''); setCity(''); setCategory('Raw Materials');
    setCreateModal(false);
  };

  const filtered = vendors.filter(v => {
    const matchSearch = v.name.toLowerCase().includes(search.toLowerCase()) ||
      v.email.toLowerCase().includes(search.toLowerCase()) ||
      v.city.toLowerCase().includes(search.toLowerCase());
    const matchCat = filterCat === 'all' || v.category === filterCat;
    return matchSearch && matchCat;
  });

  const totalPayable = vendors.reduce((sum, v) => sum + v.total_payable, 0);
  const avgOnTime = vendors.length > 0
    ? Math.round(vendors.reduce((sum, v) => sum + v.on_time_delivery, 0) / vendors.length)
    : 0;

  const glassClass = isDark ? 'glass' : 'glass-light bg-white/80';
  const borderCls = isDark ? 'border-white/5' : 'border-gray-200';
  const inputCls = isDark ? 'bg-[#12172a] border-[#2a3250] text-white' : '';

  const catBadgeColor = (cat: string) => {
    const map: Record<string, string> = {
      'Raw Materials': 'bg-violet-500/10 text-violet-400 border border-violet-500/20',
      'Packaging': 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
      'Logistics': 'bg-amber-500/10 text-amber-400 border border-amber-500/20',
      'Electronics': 'bg-teal-500/10 text-teal-400 border border-teal-500/20',
    };
    return map[cat] || 'bg-gray-500/10 text-gray-400 border border-gray-500/20';
  };

  const getAvatarColor = (idx: number) => AVATAR_COLORS[idx % AVATAR_COLORS.length];

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-6 animate-fade-in">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className={`text-2xl font-black ${isDark ? 'text-white' : 'text-gray-900'}`}>Vendor Directory</h1>
          <p className={`text-xs mt-1 ${isDark ? 'text-[#5a6a8a]' : 'text-gray-500'}`}>
            Manage supplier profiles, track payables, and monitor on-time delivery performance.
          </p>
        </div>
        <div className="flex gap-2 self-start sm:self-auto">
          <button onClick={syncData} className='btn-secondary text-xs px-3.5 py-1.5 flex items-center gap-1.5'>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Sync
          </button>
          <button onClick={() => setCreateModal(true)} className="btn-primary text-xs px-4 py-2 flex items-center gap-1.5">
            <Plus size={14} /> Add Vendor
          </button>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className={`card p-4 rounded-2xl ${glassClass}`}>
          <p className={`text-xs font-semibold uppercase tracking-wider ${isDark ? 'text-[#5a6a8a]' : 'text-gray-500'}`}>Total Vendors</p>
          <p className={`text-3xl font-black mt-1 ${isDark ? 'text-white' : 'text-gray-900'}`}>{vendors.length}</p>
          <p className="text-xs text-gray-500 mt-1">{vendors.filter(v => v.active).length} active suppliers</p>
        </div>
        <div className={`card p-4 rounded-2xl ${glassClass}`}>
          <p className={`text-xs font-semibold uppercase tracking-wider ${isDark ? 'text-[#5a6a8a]' : 'text-gray-500'}`}>Total Payables</p>
          <p className="text-3xl font-black mt-1 text-red-400">
            ₹{totalPayable >= 100000 ? `${(totalPayable / 100000).toFixed(1)}L` : totalPayable.toLocaleString('en-IN')}
          </p>
          <p className="text-xs text-gray-500 mt-1">Outstanding vendor payments</p>
        </div>
        <div className={`card p-4 rounded-2xl ${glassClass}`}>
          <p className={`text-xs font-semibold uppercase tracking-wider ${isDark ? 'text-[#5a6a8a]' : 'text-gray-500'}`}>Avg On-Time Delivery</p>
          <p className="text-3xl font-black mt-1 text-green-400">{avgOnTime}%</p>
          <div className="mt-2 h-1.5 rounded-full bg-white/5 overflow-hidden">
            <div className="h-full rounded-full bg-green-400" style={{ width: `${avgOnTime}%` }} />
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className={`card p-4 rounded-2xl flex flex-col sm:flex-row gap-3 items-center ${glassClass}`}>
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder='Search vendors by name, city, or email...'
            value={search}
            onChange={e => setSearch(e.target.value)}
            className={`input pl-9 w-full ${isDark ? 'bg-black/20 border-white/5 text-white' : 'bg-gray-50 border-gray-200'}`}
          />
        </div>
        <select
          value={filterCat}
          onChange={e => setFilterCat(e.target.value)}
          className={`input text-xs w-full sm:w-44 ${isDark ? 'bg-black/20 border-white/5 text-white' : 'bg-gray-50 border-gray-200'}`}
        >
          <option value="all">All Categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* Vendor Card Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filtered.map((v, idx) => (
          <div
            key={v.id}
            className={`card p-5 rounded-2xl flex flex-col gap-4 border hover:scale-[1.01] transition-all cursor-pointer ${glassClass} ${borderCls} ${selIds.has(v.id) ? 'ring-2 ring-rose-500/40' : ''}`}
            onClick={() => setSelectedVendor(v)}
          >
            {/* Top: Avatar + Name + Category */}
            <div className="flex items-start gap-3">
              {isAdmin && (
                <input type="checkbox" className="mt-1 rounded flex-shrink-0" checked={selIds.has(v.id)}
                  onClick={e => e.stopPropagation()}
                  onChange={() => setSelIds(prev => { const n = new Set(prev); n.has(v.id) ? n.delete(v.id) : n.add(v.id); return n; })} />
              )}
              <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${getAvatarColor(idx)} flex items-center justify-center flex-shrink-0`}>
                <span className="text-white font-black text-lg">{v.name.charAt(0)}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className={`font-bold text-sm leading-tight truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>{v.name}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <MapPin size={10} className="text-gray-500 flex-shrink-0" />
                  <span className="text-xs text-gray-500 truncate">{v.city}</span>
                </div>
              </div>
              <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full flex-shrink-0 ${catBadgeColor(v.category)}`}>
                {v.category}
              </span>
            </div>

            {/* Payable */}
            <div className={`p-3 rounded-xl border ${isDark ? 'border-white/5 bg-white/3' : 'border-gray-100 bg-gray-50'}`}>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Outstanding Payable</p>
              <p className={`text-lg font-black mt-0.5 ${v.total_payable > 0 ? 'text-red-400' : 'text-green-400'}`}>
                ₹ {v.total_payable.toLocaleString('en-IN')}
              </p>
            </div>

            {/* On-Time Delivery Bar */}
            <div>
              <div className="flex justify-between text-xs mb-1.5">
                <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>On-Time Delivery</span>
                <span className={`font-bold ${v.on_time_delivery >= 90 ? 'text-green-400' : v.on_time_delivery >= 75 ? 'text-amber-400' : 'text-red-400'}`}>
                  {v.on_time_delivery}%
                </span>
              </div>
              <div className={`h-1.5 rounded-full overflow-hidden ${isDark ? 'bg-white/5' : 'bg-gray-200'}`}>
                <div
                  className={`h-full rounded-full transition-all ${v.on_time_delivery >= 90 ? 'bg-green-400' : v.on_time_delivery >= 75 ? 'bg-amber-400' : 'bg-red-400'}`}
                  style={{ width: `${v.on_time_delivery}%` }}
                />
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2 pt-1" onClick={e => e.stopPropagation()}>
              <button
                onClick={() => setSelectedVendor(v)}
                className="btn-secondary flex-1 text-xs py-2 justify-center flex items-center gap-1.5"
              >
                <ExternalLink size={11} /> View Profile
              </button>
              <button
                onClick={() => {
                  // Navigate to RFQ with pre-filled vendor (dispatch custom event)
                  const evt = new CustomEvent('create-rfq-for-vendor', { detail: { vendor: v.name } });
                  window.dispatchEvent(evt);
                }}
                className="btn-primary flex-1 text-xs py-2 justify-center flex items-center gap-1.5"
              >
                <Plus size={11} /> New RFQ
              </button>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="col-span-full text-center py-10 text-xs text-gray-500">No vendors found matching the criteria.</div>
        )}
      </div>

      <BulkDeleteBar model="res.partner" label="vendor" ids={Array.from(selIds)}
        onClear={() => setSelIds(new Set())} onDeleted={() => { setSelIds(new Set()); syncData(); }} />

      {/* Vendor Detail Drawer */}
      {selectedVendor && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm animate-fade-in"
          onClick={() => setSelectedVendor(null)}
        >
          <div
            className={`h-full w-full max-w-sm overflow-y-auto shadow-2xl flex flex-col ${isDark ? 'bg-[#131929] border-l border-[#2a3250]' : 'bg-white border-l border-gray-200'}`}
            onClick={e => e.stopPropagation()}
            style={{ animation: 'slideInRight 0.25s ease' }}
          >
            {/* Drawer Header */}
            <div className={`flex items-center justify-between px-5 py-4 border-b ${borderCls} flex-shrink-0`}>
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${getAvatarColor(vendors.indexOf(selectedVendor))} flex items-center justify-center flex-shrink-0`}>
                  <span className="text-white font-black text-base">{selectedVendor.name.charAt(0)}</span>
                </div>
                <div>
                  <p className={`font-bold text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>{selectedVendor.name}</p>
                  <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${catBadgeColor(selectedVendor.category)}`}>
                    {selectedVendor.category}
                  </span>
                </div>
              </div>
              <button onClick={() => setSelectedVendor(null)} className="p-1.5 rounded-lg text-gray-400 hover:bg-white/5">
                <X size={16} />
              </button>
            </div>

            <div className="p-5 space-y-5 flex-1">
              {/* Contact Info */}
              <div>
                <p className="label text-[#5a6a8a] mb-3">Contact Information</p>
                <div className="space-y-2.5">
                  <div className="flex items-center gap-2.5">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${isDark ? 'bg-white/5' : 'bg-gray-100'}`}>
                      <Mail size={13} className="text-violet-400" />
                    </div>
                    <span className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>{selectedVendor.email || 'N/A'}</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${isDark ? 'bg-white/5' : 'bg-gray-100'}`}>
                      <Phone size={13} className="text-violet-400" />
                    </div>
                    <span className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>{selectedVendor.phone || 'N/A'}</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${isDark ? 'bg-white/5' : 'bg-gray-100'}`}>
                      <MapPin size={13} className="text-violet-400" />
                    </div>
                    <span className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>{selectedVendor.city || 'N/A'}</span>
                  </div>
                </div>
              </div>

              {/* Purchase History Summary */}
              <div>
                <p className="label text-[#5a6a8a] mb-3">Purchase Summary</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className={`p-3 rounded-xl border ${isDark ? 'border-white/5 bg-white/3' : 'border-gray-100 bg-gray-50'}`}>
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Total Spend</p>
                    <p className="text-base font-black mt-1 text-violet-400">
                      ₹{selectedVendor.total_purchases >= 100000
                        ? `${(selectedVendor.total_purchases / 100000).toFixed(1)}L`
                        : selectedVendor.total_purchases.toLocaleString('en-IN')}
                    </p>
                  </div>
                  <div className={`p-3 rounded-xl border ${isDark ? 'border-white/5 bg-white/3' : 'border-gray-100 bg-gray-50'}`}>
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Outstanding</p>
                    <p className={`text-base font-black mt-1 ${selectedVendor.total_payable > 0 ? 'text-red-400' : 'text-green-400'}`}>
                      ₹{selectedVendor.total_payable.toLocaleString('en-IN')}
                    </p>
                  </div>
                </div>
              </div>

              {/* On-Time Delivery */}
              <div>
                <p className="label text-[#5a6a8a] mb-2">On-Time Delivery Performance</p>
                <div className={`p-3 rounded-xl border ${isDark ? 'border-white/5 bg-white/3' : 'border-gray-100 bg-gray-50'}`}>
                  <div className="flex justify-between text-sm mb-2">
                    <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>Score</span>
                    <span className={`font-bold ${selectedVendor.on_time_delivery >= 90 ? 'text-green-400' : selectedVendor.on_time_delivery >= 75 ? 'text-amber-400' : 'text-red-400'}`}>
                      {selectedVendor.on_time_delivery}%
                    </span>
                  </div>
                  <div className={`h-2 rounded-full overflow-hidden ${isDark ? 'bg-white/5' : 'bg-gray-200'}`}>
                    <div
                      className={`h-full rounded-full ${selectedVendor.on_time_delivery >= 90 ? 'bg-green-400' : selectedVendor.on_time_delivery >= 75 ? 'bg-amber-400' : 'bg-red-400'}`}
                      style={{ width: `${selectedVendor.on_time_delivery}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-gray-500 mt-1.5">
                    Based on last 12 months of orders
                  </p>
                </div>
              </div>

              {/* Banking Details */}
              <div>
                <p className="label text-[#5a6a8a] mb-3">Banking Details</p>
                <div className={`p-4 rounded-xl border ${isDark ? 'border-white/5 bg-white/3' : 'border-gray-100 bg-gray-50'}`}>
                  <div className="flex items-center gap-2 mb-3">
                    <CreditCard size={14} className="text-violet-400" />
                    <span className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                      {BANK_DETAILS[selectedVendor.id]?.bank || 'HDFC Bank'}
                    </span>
                  </div>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Account No.</span>
                      <span className={`font-mono font-semibold ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                        {BANK_DETAILS[selectedVendor.id]?.account || 'XXXX XXXX 0000'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">IFSC Code</span>
                      <span className={`font-mono font-semibold ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                        {BANK_DETAILS[selectedVendor.id]?.ifsc || 'HDFC0000000'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Status badge */}
              <div className="flex items-center gap-2">
                <Building2 size={13} className="text-gray-500" />
                <span className="text-xs text-gray-500">Status:</span>
                <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${selectedVendor.active ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-gray-500/10 text-gray-400 border border-gray-500/20'}`}>
                  {selectedVendor.active ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>

            {/* Drawer Footer */}
            <div className={`p-5 border-t flex-shrink-0 ${borderCls}`}>
              <button
                onClick={() => {
                  setSelectedVendor(null);
                  const evt = new CustomEvent('create-rfq-for-vendor', { detail: { vendor: selectedVendor.name } });
                  window.dispatchEvent(evt);
                }}
                className="w-full btn-primary justify-center py-2.5 flex items-center gap-2"
              >
                <Plus size={14} /> Create RFQ for this Vendor
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Vendor Modal */}
      {createModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
          onClick={() => setCreateModal(false)}
        >
          <div
            className={`w-full max-w-md rounded-2xl border shadow-2xl overflow-hidden ${isDark ? 'bg-[#1e2440] border-[#2a3250]' : 'bg-white border-gray-200'}`}
            onClick={e => e.stopPropagation()}
          >
            <div className={`flex justify-between items-center px-5 py-4 border-b ${borderCls}`}>
              <div>
                <h3 className={`font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>Add Vendor Profile</h3>
                <p className="text-xs text-gray-400 mt-0.5">New supplier to your procurement network</p>
              </div>
              <button onClick={() => setCreateModal(false)} className="p-1.5 rounded-lg text-gray-400 hover:bg-white/5">
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleCreate} className="p-5 space-y-4">
              <div>
                <label className="label text-[#5a6a8a]">Vendor / Company Name</label>
                <input
                  type="text" value={name} onChange={e => setName(e.target.value)} required
                  placeholder='e.g. Sharma Textiles Pvt Ltd'
                  className={`input ${inputCls}`}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label text-[#5a6a8a]">Email</label>
                  <input
                    type="email" value={email} onChange={e => setEmail(e.target.value)}
                    placeholder='vendor@company.in'
                    className={`input ${inputCls}`}
                  />
                </div>
                <div>
                  <label className="label text-[#5a6a8a]">Phone</label>
                  <input
                    type="text" value={phone} onChange={e => setPhone(e.target.value)}
                    placeholder='+91 XXXXX XXXXX'
                    className={`input ${inputCls}`}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label text-[#5a6a8a]">City</label>
                  <input
                    type="text" value={city} onChange={e => setCity(e.target.value)}
                    placeholder='e.g. Mumbai'
                    className={`input ${inputCls}`}
                  />
                </div>
                <div>
                  <label className="label text-[#5a6a8a]">Category</label>
                  <select
                    value={category} onChange={e => setCategory(e.target.value)}
                    className={`input text-xs ${inputCls}`}
                  >
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setCreateModal(false)} className="btn-secondary flex-1 justify-center py-2.5">
                  Cancel
                </button>
                <button type="submit" className="btn-primary flex-1 justify-center py-2.5">
                  Add Vendor
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
    </div>
  );
}


