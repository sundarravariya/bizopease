import React, { useState, useEffect } from 'react';
import { useTheme } from '../../../context/ThemeContext';
import { searchRead, createRecord, writeRecord, listInternalUsers } from '../../../services/odoo';
import {
  Plus, RefreshCw, Search, Eye, Edit2, Trash2, UserPlus,
  LayoutGrid, List, X, Mail, Phone,
  Users, DollarSign, Target, TrendingUp,
} from 'lucide-react';

interface Lead {
  id: number;
  name: string;
  contact_name: string;
  email: string;
  phone: string;
  company: string;
  source: string;
  expected_revenue: number;
  probability: number;
  stage: 'new' | 'qualified' | 'proposition' | 'won' | 'lost';
  deadline: string;
  assigned_to: string;
  tags: string[];
}

const STAGE_MAP: Record<string, { label: string; badge: string }> = {
  new: { label: 'New', badge: 'badge-blue' },
  qualified: { label: 'Qualified', badge: 'badge-violet' },
  proposition: { label: 'Proposition', badge: 'badge-gold' },
  won: { label: 'Won', badge: 'badge-green' },
  lost: { label: 'Lost', badge: 'badge-red' },
};

const SOURCES = ['Website', 'WhatsApp', 'Trade Show', 'Referral', 'Cold Call', 'Email'];
const STAGES = ['new', 'qualified', 'proposition', 'won', 'lost'] as const;

function scoreColor(prob: number) {
  if (prob < 30) return 'bg-red-500';
  if (prob < 70) return 'bg-amber-500';
  return 'bg-green-500';
}

function probBarGradient(prob: number) {
  if (prob < 30) return 'from-red-500 to-red-400';
  if (prob < 70) return 'from-amber-500 to-amber-400';
  return 'from-green-500 to-green-400';
}

const blankForm = {
  contact_name: '', name: '', company: '', email: '', phone: '',
  source: '', expected_revenue: 0, stage: 'new' as Lead['stage'],
  deadline: '', assigned_to: '', probability: 50,
};

export default function Leads() {
  const { isDark } = useTheme();
  const [leads, setLeads] = useState<Lead[]>(() => {
    try { return JSON.parse(localStorage.getItem('portal_crm_leads') || 'null') || []; } catch { return []; }
  });
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'table' | 'card'>('table');
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [drawerLead, setDrawerLead] = useState<Lead | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editLead, setEditLead] = useState<Lead | null>(null);
  const [form, setForm] = useState({ ...blankForm });
  const [crmUsers, setCrmUsers] = useState<{ id: number; name: string }[]>([]);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3200);
  };

  const syncData = async () => {
    setLoading(true);
    try {
      const r = await searchRead<any>('crm.lead', {
        domain: [['type', '=', 'lead']],
        fields: ['id', 'name', 'contact_name', 'email_from', 'phone', 'expected_revenue', 'stage_id', 'probability', 'user_id', 'date_deadline', 'tag_ids'],
        limit: 0,
        order: 'id desc',
      });
      if (Array.isArray(r)) {
        const mapped: Lead[] = r.map((item: any) => ({
          id: item.id,
          name: item.name || '',
          contact_name: item.contact_name || '',
          email: item.email_from || '',
          phone: item.phone || '',
          company: '',
          source: '',
          expected_revenue: item.expected_revenue || 0,
          probability: item.probability || 0,
          stage: 'new' as const,
          deadline: item.date_deadline || '',
          assigned_to: item.user_id?.[1] || 'Unassigned',
          tags: [],
        }));
        setLeads(mapped);
        localStorage.setItem('portal_crm_leads', JSON.stringify(mapped));
      }
    } catch {
      console.warn('Odoo offline, using cache');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    syncData();
    listInternalUsers().then(u => setCrmUsers(u)).catch(() => {});
  }, []);
  useEffect(() => { localStorage.setItem('portal_crm_leads', JSON.stringify(leads)); }, [leads]);

  const filtered = leads.filter(l => {
    const q = search.toLowerCase();
    const matchSearch = !search || l.name.toLowerCase().includes(q) || l.contact_name.toLowerCase().includes(q) || l.company.toLowerCase().includes(q);
    const matchStage = stageFilter === 'all' || l.stage === stageFilter;
    const matchSource = sourceFilter === 'all' || l.source === sourceFilter;
    return matchSearch && matchStage && matchSource;
  });

  const totalRevenue = filtered.reduce((s, l) => s + l.expected_revenue, 0);
  const qualifiedCount = filtered.filter(l => l.stage === 'qualified').length;
  const avgProb = filtered.length ? Math.round(filtered.reduce((s, l) => s + l.probability, 0) / filtered.length) : 0;

  const handleDelete = (id: number) => {
    setLeads(prev => prev.filter(l => l.id !== id));
    showToast('Lead removed.');
  };

  const handleConvert = async (lead: Lead) => {
    try {
      await writeRecord('crm.lead', [lead.id], { type: 'opportunity' });
    } catch { /* offline */ }
    const opps = (() => { try { return JSON.parse(localStorage.getItem('portal_crm_leads_opps') || '[]'); } catch { return []; } })();
    const newOpp = { id: lead.id, name: lead.name, partner: lead.company || lead.contact_name, expected_revenue: lead.expected_revenue, probability: lead.probability, stage: 'new', assigned_to: lead.assigned_to, deadline: lead.deadline, activities: [] };
    localStorage.setItem('portal_crm_leads_opps', JSON.stringify([newOpp, ...opps]));
    setLeads(prev => prev.filter(l => l.id !== lead.id));
    setDrawerLead(null);
    showToast('Lead converted to opportunity!');
  };

  const handleSaveEdit = async () => {
    if (!editLead) return;
    try { await writeRecord('crm.lead', [editLead.id], { probability: editLead.probability }); } catch { /* offline */ }
    setLeads(prev => prev.map(l => l.id === editLead.id ? editLead : l));
    setEditLead(null);
    showToast('Lead updated.');
  };

  const handleCreate = async () => {
    const newId = Date.now();
    const newLead: Lead = { id: newId, ...form, tags: [] };
    try {
      const id = await createRecord('crm.lead', { name: form.name, contact_name: form.contact_name, email_from: form.email, phone: form.phone, expected_revenue: form.expected_revenue, type: 'lead' });
      newLead.id = id;
    } catch { /* offline */ }
    setLeads(prev => [newLead, ...prev]);
    setShowCreate(false);
    setForm({ ...blankForm });
    showToast('Lead created successfully!');
  };

  const gc = isDark ? 'glass' : 'glass-light bg-white/80';
  const inp = `input text-xs ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`;
  const th = isDark ? 'text-white' : 'text-gray-900';
  const ts = isDark ? 'text-[#5a6a8a]' : 'text-gray-500';
  const bd = isDark ? '#2a3250' : '#e5e7eb';

  return (
    <div className='space-y-5 animate-fade-in'>

      {toast && (
        <div className={`fixed top-5 right-5 z-[999] px-5 py-3 rounded-xl shadow-2xl text-sm font-semibold transition-all ${toast.type === 'success' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'}`}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className='flex flex-col sm:flex-row sm:items-center justify-between gap-3'>
        <div>
          <h1 className={`text-xl font-black ${th}`}>Inbound CRM Leads</h1>
          <p className={`text-xs mt-0.5 ${ts}`}>{filtered.length} leads tracked · Manage, qualify and convert prospects</p>
        </div>
        <div className='flex gap-2 flex-wrap'>
          <button onClick={syncData} disabled={loading} className='btn-secondary text-xs px-3 py-2 flex items-center gap-1.5'>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Sync
          </button>
          <button onClick={() => setShowCreate(true)} className='btn-primary text-xs px-3 py-2 flex items-center gap-1.5'>
            <Plus size={13} /> Add Lead
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className='grid grid-cols-2 md:grid-cols-4 gap-3'>
        {[
          { label: 'Total Leads', value: String(leads.length), icon: <Users size={16} />, color: 'text-blue-400' },
          { label: 'Qualified', value: String(qualifiedCount), icon: <Target size={16} />, color: 'text-violet-400' },
          { label: 'Expected Revenue', value: `₹${(totalRevenue / 100000).toFixed(1)}L`, icon: <DollarSign size={16} />, color: 'text-green-400' },
          { label: 'Avg Probability', value: `${avgProb}%`, icon: <TrendingUp size={16} />, color: 'text-amber-400' },
        ].map(stat => (
          <div key={stat.label} className={`card p-4 ${gc}`}>
            <div className={`flex items-center gap-2 mb-1 ${stat.color}`}>{stat.icon}<span className={`text-xs ${ts}`}>{stat.label}</span></div>
            <div className={`text-xl font-black ${th}`}>{stat.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className='card p-3 flex flex-col sm:flex-row gap-3'>
        <div className='relative flex-1'>
          <Search size={14} className={`absolute left-3 top-1/2 -translate-y-1/2 ${ts}`} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder='Search leads, contacts, companies...' className={`${inp} pl-9 py-2 w-full`} />
        </div>
        <select value={stageFilter} onChange={e => setStageFilter(e.target.value)} className={`${inp} py-2 w-auto`}>
          <option value='all'>All Stages</option>
          {STAGES.map(s => <option key={s} value={s}>{STAGE_MAP[s].label}</option>)}
        </select>
        <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)} className={`${inp} py-2 w-auto`}>
          <option value='all'>All Sources</option>
          {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <div className='flex gap-1 items-center'>
          <button onClick={() => setViewMode('table')} title='Table view' className={`p-2 rounded-lg transition-colors ${viewMode === 'table' ? 'bg-[#7367f0] text-white' : isDark ? 'text-[#5a6a8a] hover:text-white hover:bg-white/5' : 'text-gray-400 hover:bg-gray-100'}`}><List size={14} /></button>
          <button onClick={() => setViewMode('card')} title='Card view' className={`p-2 rounded-lg transition-colors ${viewMode === 'card' ? 'bg-[#7367f0] text-white' : isDark ? 'text-[#5a6a8a] hover:text-white hover:bg-white/5' : 'text-gray-400 hover:bg-gray-100'}`}><LayoutGrid size={14} /></button>
        </div>
      </div>

      {/* Table View */}
      {viewMode === 'table' && (
        <div className='card overflow-hidden'>
          {loading ? (
            <div className='h-40 flex items-center justify-center gap-3'>
              <RefreshCw size={18} className='animate-spin text-[#7367f0]' />
              <span className={`text-sm ${ts}`}>Syncing leads...</span>
            </div>
          ) : (
            <div className='overflow-x-auto'>
              <table className='data-table w-full'>
                <thead>
                  <tr>
                    <th>Contact</th>
                    <th>Company</th>
                    <th>Source</th>
                    <th className='text-right'>Revenue</th>
                    <th>Probability</th>
                    <th>Stage</th>
                    <th>Deadline</th>
                    <th className='text-center'>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(lead => (
                    <tr key={lead.id}>
                      <td>
                        <div className='flex items-center gap-2'>
                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${scoreColor(lead.probability)}`} title={`${lead.probability}% probability`} />
                          <div>
                            <div className={`font-semibold text-xs ${th}`}>{lead.contact_name}</div>
                            <div className={`text-[10px] ${ts} max-w-[160px] truncate`}>{lead.name}</div>
                          </div>
                        </div>
                      </td>
                      <td className={`text-xs ${th}`}>{lead.company}</td>
                      <td><span className='badge badge-blue text-[10px]'>{lead.source}</span></td>
                      <td className={`text-right font-semibold text-xs ${th}`}>{'₹'}{lead.expected_revenue.toLocaleString('en-IN')}</td>
                      <td>
                        <div className='flex items-center gap-2 min-w-[100px]'>
                          <div className={`flex-1 h-1.5 rounded-full ${isDark ? 'bg-[#2a3250]' : 'bg-gray-200'}`}>
                            <div className={`h-1.5 rounded-full bg-gradient-to-r ${probBarGradient(lead.probability)}`} style={{ width: `${lead.probability}%` }} />
                          </div>
                          <span className={`text-[10px] font-semibold w-8 text-right ${ts}`}>{lead.probability}%</span>
                        </div>
                      </td>
                      <td><span className={`${STAGE_MAP[lead.stage]?.badge || 'badge-gray'} text-[10px]`}>{STAGE_MAP[lead.stage]?.label}</span></td>
                      <td className={`text-xs ${ts}`}>{lead.deadline ? new Date(lead.deadline).toLocaleDateString('en-IN') : '—'}</td>
                      <td>
                        <div className='flex items-center justify-center gap-1'>
                          <button onClick={() => setDrawerLead(lead)} className={`p-1.5 rounded-lg transition-colors ${isDark ? 'hover:bg-white/5 text-[#5a6a8a] hover:text-white' : 'hover:bg-gray-100 text-gray-400 hover:text-gray-700'}`} title='View'><Eye size={13} /></button>
                          <button onClick={() => handleConvert(lead)} className={`p-1.5 rounded-lg transition-colors ${isDark ? 'hover:bg-white/5 text-[#5a6a8a] hover:text-violet-400' : 'hover:bg-gray-100 text-gray-400 hover:text-violet-600'}`} title='Convert to Opportunity'><UserPlus size={13} /></button>
                          <button onClick={() => setEditLead({ ...lead })} className={`p-1.5 rounded-lg transition-colors ${isDark ? 'hover:bg-white/5 text-[#5a6a8a] hover:text-amber-400' : 'hover:bg-gray-100 text-gray-400 hover:text-amber-500'}`} title='Edit'><Edit2 size={13} /></button>
                          <button onClick={() => handleDelete(lead.id)} className={`p-1.5 rounded-lg transition-colors ${isDark ? 'hover:bg-white/5 text-[#5a6a8a] hover:text-red-400' : 'hover:bg-gray-100 text-gray-400 hover:text-red-500'}`} title='Delete'><Trash2 size={13} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length === 0 && (
                <div className={`text-center py-12 text-sm ${ts}`}>No leads match your filters.</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Card View */}
      {viewMode === 'card' && (
        <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4'>
          {filtered.map(lead => (
            <div key={lead.id} className={`card p-4 space-y-3 ${gc} hover:border-[#7367f0]/40 transition-colors`}>
              <div className='flex items-start justify-between gap-2'>
                <div className='flex items-center gap-2'>
                  <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${scoreColor(lead.probability)}`} />
                  <div>
                    <div className={`text-xs font-bold ${th}`}>{lead.contact_name}</div>
                    <div className={`text-[10px] ${ts}`}>{lead.company}</div>
                  </div>
                </div>
                <span className={`${STAGE_MAP[lead.stage]?.badge || 'badge-gray'} text-[10px]`}>{STAGE_MAP[lead.stage]?.label}</span>
              </div>
              <div className={`text-xs font-semibold ${th} line-clamp-2`}>{lead.name}</div>
              <div className='space-y-1'>
                <div className='flex items-center gap-1.5'><Mail size={10} className={ts} /><span className={`text-[10px] ${ts}`}>{lead.email}</span></div>
                <div className='flex items-center gap-1.5'><Phone size={10} className={ts} /><span className={`text-[10px] ${ts}`}>{lead.phone}</span></div>
              </div>
              <div>
                <div className='flex justify-between text-[10px] mb-1'>
                  <span className={ts}>Probability</span>
                  <span className={`font-semibold ${th}`}>{lead.probability}%</span>
                </div>
                <div className={`h-1.5 rounded-full ${isDark ? 'bg-[#2a3250]' : 'bg-gray-200'}`}>
                  <div className={`h-1.5 rounded-full bg-gradient-to-r ${probBarGradient(lead.probability)}`} style={{ width: `${lead.probability}%` }} />
                </div>
              </div>
              <div className='flex items-center justify-between'>
                <span className='text-xs font-bold text-green-400'>{'₹'}{lead.expected_revenue.toLocaleString('en-IN')}</span>
                <span className='badge badge-blue text-[10px]'>{lead.source}</span>
              </div>
              <div className='flex gap-1 pt-1 border-t' style={{ borderColor: bd }}>
                <button onClick={() => setDrawerLead(lead)} className='btn-secondary text-[10px] px-2 py-1 flex items-center gap-1 flex-1 justify-center'><Eye size={10} /> View</button>
                <button onClick={() => handleConvert(lead)} className='btn-primary text-[10px] px-2 py-1 flex items-center gap-1 flex-1 justify-center'><UserPlus size={10} /> Convert</button>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className={`col-span-full text-center py-12 text-sm ${ts}`}>No leads match your filters.</div>
          )}
        </div>
      )}

      {/* Detail Drawer */}
      {drawerLead && (
        <div className='fixed inset-0 z-50 flex justify-end'>
          <div className='absolute inset-0 bg-black/50 backdrop-blur-sm' onClick={() => setDrawerLead(null)} />
          <div className={`relative w-full max-w-md h-full overflow-y-auto p-6 space-y-5 shadow-2xl ${isDark ? 'bg-[#161b2e] border-l border-[#2a3250]' : 'bg-white border-l border-gray-200'}`}>
            <div className='flex items-center justify-between'>
              <h2 className={`font-black text-sm ${th}`}>Lead Details</h2>
              <button onClick={() => setDrawerLead(null)} className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-white/5 text-[#5a6a8a] hover:text-white' : 'hover:bg-gray-100 text-gray-400'}`}><X size={16} /></button>
            </div>
            <div className='flex items-center gap-3'>
              <div className='w-12 h-12 rounded-xl flex items-center justify-center text-white font-black text-lg bg-gradient-to-br from-[#7367f0] to-[#3b82f6]'>
                {drawerLead.contact_name.charAt(0)}
              </div>
              <div>
                <div className={`font-bold ${th}`}>{drawerLead.contact_name}</div>
                <div className={`text-xs ${ts}`}>{drawerLead.company}</div>
              </div>
            </div>
            <div className={`rounded-xl p-4 space-y-2.5 ${isDark ? 'bg-[#1e2440]' : 'bg-gray-50'}`}>
              {[
                ['Lead Title', drawerLead.name],
                ['Email', drawerLead.email],
                ['Phone', drawerLead.phone],
                ['Source', drawerLead.source],
                ['Expected Revenue', `₹${drawerLead.expected_revenue.toLocaleString('en-IN')}`],
                ['Probability', `${drawerLead.probability}%`],
                ['Deadline', drawerLead.deadline || '—'],
                ['Assigned To', drawerLead.assigned_to],
              ].map(([label, val]) => (
                <div key={label} className='flex justify-between text-xs'>
                  <span className={ts}>{label}</span>
                  <span className={`font-semibold ${th} max-w-[55%] text-right`}>{val}</span>
                </div>
              ))}
            </div>
            <div>
              <span className={`${STAGE_MAP[drawerLead.stage]?.badge || 'badge-gray'}`}>{STAGE_MAP[drawerLead.stage]?.label}</span>
            </div>
            <div className='space-y-2'>
              <p className={`text-xs font-bold ${th}`}>Activity Log</p>
              {[`Lead created from ${drawerLead.source}`, 'Initial contact attempted via email', 'Follow-up scheduled for next week'].map((act, i) => (
                <div key={i} className={`text-xs ${ts} flex gap-2`}>
                  <span className='text-[#7367f0]'>-</span>{act}
                </div>
              ))}
            </div>
            <div className='flex gap-2 pt-2 border-t' style={{ borderColor: bd }}>
              <button onClick={() => handleConvert(drawerLead)} className='btn-primary text-xs px-4 py-2 flex items-center gap-1.5 flex-1 justify-center'>
                <UserPlus size={13} /> Convert to Opportunity
              </button>
              <button onClick={() => { setEditLead({ ...drawerLead }); setDrawerLead(null); }} className='btn-secondary text-xs px-4 py-2 flex items-center gap-1.5'>
                <Edit2 size={13} /> Edit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editLead && (
        <div className='fixed inset-0 z-50 flex items-center justify-center p-4'>
          <div className='absolute inset-0 bg-black/60 backdrop-blur-sm' onClick={() => setEditLead(null)} />
          <div className={`relative w-full max-w-md rounded-2xl p-6 space-y-4 shadow-2xl ${isDark ? 'bg-[#161b2e] border border-[#2a3250]' : 'bg-white border border-gray-200'}`}>
            <div className='flex items-center justify-between'>
              <h3 className={`font-black text-sm ${th}`}>Edit Lead</h3>
              <button onClick={() => setEditLead(null)} className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-white/5 text-[#5a6a8a]' : 'hover:bg-gray-100 text-gray-400'}`}><X size={16} /></button>
            </div>
            <div className='space-y-3'>
              <div>
                <label className='label'>Stage</label>
                <select value={editLead.stage} onChange={e => setEditLead({ ...editLead, stage: e.target.value as Lead['stage'] })} className={`${inp} w-full`}>
                  {STAGES.map(s => <option key={s} value={s}>{STAGE_MAP[s].label}</option>)}
                </select>
              </div>
              <div>
                <label className='label'>Probability (%)</label>
                <input type='number' min={0} max={100} value={editLead.probability} onChange={e => setEditLead({ ...editLead, probability: Number(e.target.value) })} className={`${inp} w-full`} />
              </div>
              <div>
                <label className='label'>Expected Revenue ({'₹'})</label>
                <input type='number' value={editLead.expected_revenue} onChange={e => setEditLead({ ...editLead, expected_revenue: Number(e.target.value) })} className={`${inp} w-full`} />
              </div>
            </div>
            <div className='flex gap-2 pt-2'>
              <button onClick={handleSaveEdit} className='btn-primary text-xs px-4 py-2 flex-1'>Save Changes</button>
              <button onClick={() => setEditLead(null)} className='btn-secondary text-xs px-4 py-2'>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <div className='fixed inset-0 z-50 flex items-center justify-center p-4'>
          <div className='absolute inset-0 bg-black/60 backdrop-blur-sm' onClick={() => setShowCreate(false)} />
          <div className={`relative w-full max-w-lg rounded-2xl p-6 space-y-4 shadow-2xl overflow-y-auto max-h-[90vh] ${isDark ? 'bg-[#161b2e] border border-[#2a3250]' : 'bg-white border border-gray-200'}`}>
            <div className='flex items-center justify-between'>
              <h3 className={`font-black text-sm ${th}`}>Create New Lead</h3>
              <button onClick={() => setShowCreate(false)} className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-white/5 text-[#5a6a8a]' : 'hover:bg-gray-100 text-gray-400'}`}><X size={16} /></button>
            </div>
            <div className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
              <div>
                <label className='label'>Lead Title</label>
                <input placeholder='e.g. Bulk Saree Order' value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className={`${inp} w-full`} />
              </div>
              <div>
                <label className='label'>Contact Name</label>
                <input placeholder='Full name' value={form.contact_name} onChange={e => setForm({ ...form, contact_name: e.target.value })} className={`${inp} w-full`} />
              </div>
              <div>
                <label className='label'>Company</label>
                <input placeholder='Company name' value={form.company} onChange={e => setForm({ ...form, company: e.target.value })} className={`${inp} w-full`} />
              </div>
              <div>
                <label className='label'>Email</label>
                <input type='email' placeholder='email@company.com' value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className={`${inp} w-full`} />
              </div>
              <div>
                <label className='label'>Phone</label>
                <input type='tel' placeholder='+91 98765 43210' value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className={`${inp} w-full`} />
              </div>
              <div>
                <label className='label'>Expected Revenue ({'₹'})</label>
                <input type='number' placeholder='100000' value={form.expected_revenue || ''} onChange={e => setForm({ ...form, expected_revenue: Number(e.target.value) })} className={`${inp} w-full`} />
              </div>
              <div>
                <label className='label'>Probability (%)</label>
                <input type='number' min={0} max={100} placeholder='50' value={form.probability || ''} onChange={e => setForm({ ...form, probability: Number(e.target.value) })} className={`${inp} w-full`} />
              </div>
              <div>
                <label className='label'>Deadline</label>
                <input type='date' value={form.deadline} onChange={e => setForm({ ...form, deadline: e.target.value })} className={`${inp} w-full`} />
              </div>
              <div>
                <label className='label'>Source</label>
                <select value={form.source} onChange={e => setForm({ ...form, source: e.target.value })} className={`${inp} w-full`}>
                  {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className='label'>Stage</label>
                <select value={form.stage} onChange={e => setForm({ ...form, stage: e.target.value as Lead['stage'] })} className={`${inp} w-full`}>
                  {STAGES.map(s => <option key={s} value={s}>{STAGE_MAP[s].label}</option>)}
                </select>
              </div>
              <div className='sm:col-span-2'>
                <label className='label'>Assigned To</label>
                <select value={form.assigned_to} onChange={e => setForm({ ...form, assigned_to: e.target.value })} className={`${inp} w-full`}>
                  <option value=''>-- Select User --</option>
                  {crmUsers.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
                </select>
              </div>
            </div>
            <div className='flex gap-2 pt-2'>
              <button onClick={handleCreate} className='btn-primary text-xs px-4 py-2 flex-1'>Create Lead</button>
              <button onClick={() => setShowCreate(false)} className='btn-secondary text-xs px-4 py-2'>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


