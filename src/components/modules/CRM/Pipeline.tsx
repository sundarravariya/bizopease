import React, { useState, useEffect } from 'react';
import { useTheme } from '../../../context/ThemeContext';
import { searchRead, createRecord, writeRecord } from '../../../services/odoo';
import {
  Plus, RefreshCw, Edit2, X, Trophy,
  DollarSign, TrendingUp, BarChart2, CheckCircle2,
  Calendar, ChevronDown,
} from 'lucide-react';

interface Opportunity {
  id: number;
  name: string;
  partner: string;
  expected_revenue: number;
  probability: number;
  stage: 'new' | 'qualified' | 'proposition' | 'price_quote' | 'won' | 'lost';
  assigned_to: string;
  deadline: string;
  activities: string[];
}

const STAGE_COLS: { key: Opportunity['stage']; label: string; color: string; glow: string }[] = [
  { key: 'new', label: 'New', color: 'text-blue-400', glow: '' },
  { key: 'qualified', label: 'Qualified', color: 'text-violet-400', glow: '' },
  { key: 'proposition', label: 'Proposition', color: 'text-amber-400', glow: '' },
  { key: 'price_quote', label: 'Price Quote', color: 'text-cyan-400', glow: '' },
  { key: 'won', label: 'Won', color: 'text-green-400', glow: 'shadow-green-500/20' },
];

const ALL_STAGES = ['new', 'qualified', 'proposition', 'price_quote', 'won', 'lost'] as const;

const blankForm: Omit<Opportunity, 'id' | 'activities'> = {
  name: '', partner: '', expected_revenue: 0, probability: 50,
  stage: 'new', assigned_to: '', deadline: '',
};

export default function Pipeline() {
  const { isDark } = useTheme();
  const [opps, setOpps] = useState<Opportunity[]>(() => {
    try { return JSON.parse(localStorage.getItem('portal_crm_leads_opps') || 'null') || []; } catch { return []; }
  });
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [wonBanner, setWonBanner] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editOpp, setEditOpp] = useState<Opportunity | null>(null);
  const [stagePicker, setStagePicker] = useState<number | null>(null);
  const [form, setForm] = useState({ ...blankForm });

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3200);
  };

  const syncData = async () => {
    setLoading(true);
    try {
      const r = await searchRead<any>('crm.lead', {
        domain: [['type', '=', 'opportunity']],
        fields: ['id', 'name', 'partner_id', 'expected_revenue', 'stage_id', 'probability', 'user_id', 'date_deadline'],
        limit: 0,
        order: 'id desc',
      });
      if (Array.isArray(r)) {
        const mapped: Opportunity[] = r.map((item: any) => ({
          id: item.id,
          name: item.name || '',
          partner: item.partner_id?.[1] || '',
          expected_revenue: item.expected_revenue || 0,
          probability: item.probability || 0,
          stage: 'new' as const,
          assigned_to: item.user_id?.[1] || 'Unassigned',
          deadline: item.date_deadline || '',
          activities: [],
        }));
        setOpps(mapped);
        localStorage.setItem('portal_crm_leads_opps', JSON.stringify(mapped));
      }
    } catch {
      console.warn('Odoo offline, using cache');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { syncData(); }, []);
  useEffect(() => { localStorage.setItem('portal_crm_leads_opps', JSON.stringify(opps)); }, [opps]);

  const handleMoveStage = async (opp: Opportunity, newStage: Opportunity['stage']) => {
    setStagePicker(null);
    try { await writeRecord('crm.lead', [opp.id], { stage_id: newStage }); } catch { /* offline */ }
    const updated = { ...opp, stage: newStage };
    setOpps(prev => prev.map(o => o.id === opp.id ? updated : o));
    if (newStage === 'won') {
      setWonBanner(true);
      setTimeout(() => setWonBanner(false), 3500);
    }
    showToast(`Moved to ${newStage === 'price_quote' ? 'Price Quote' : newStage.charAt(0).toUpperCase() + newStage.slice(1)}`);
  };

  const handleMarkWon = async (opp: Opportunity) => {
    await handleMoveStage(opp, 'won');
  };

  const handleMarkLost = async (opp: Opportunity) => {
    await handleMoveStage(opp, 'lost');
  };

  const handleCreate = async () => {
    const newId = Date.now();
    const newOpp: Opportunity = { id: newId, ...form, activities: [] };
    try {
      const id = await createRecord('crm.lead', { name: form.name, expected_revenue: form.expected_revenue, probability: form.probability, type: 'opportunity' });
      newOpp.id = id;
    } catch { /* offline */ }
    setOpps(prev => [newOpp, ...prev]);
    setShowCreate(false);
    setForm({ ...blankForm });
    showToast('Opportunity added to pipeline!');
  };

  const handleSaveEdit = async () => {
    if (!editOpp) return;
    try { await writeRecord('crm.lead', [editOpp.id], { probability: editOpp.probability, expected_revenue: editOpp.expected_revenue }); } catch { /* offline */ }
    setOpps(prev => prev.map(o => o.id === editOpp.id ? editOpp : o));
    setEditOpp(null);
    showToast('Opportunity updated.');
  };

  const totalPipeline = opps.filter(o => o.stage !== 'lost').reduce((s, o) => s + o.expected_revenue, 0);
  const wonThisMonth = opps.filter(o => o.stage === 'won').reduce((s, o) => s + o.expected_revenue, 0);
  const inProgress = opps.filter(o => !['won', 'lost'].includes(o.stage)).length;
  const winRate = opps.length ? Math.round((opps.filter(o => o.stage === 'won').length / opps.length) * 100) : 0;

  const gc = isDark ? 'glass' : 'glass-light bg-white/80';
  const inp = `input text-xs ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`;
  const th = isDark ? 'text-white' : 'text-gray-900';
  const ts = isDark ? 'text-[#5a6a8a]' : 'text-gray-500';
  const bd = isDark ? '#2a3250' : '#e5e7eb';
  const colBg = isDark ? 'bg-[#111827]/60' : 'bg-gray-50';
  const colBorder = isDark ? 'border-[#2a3250]' : 'border-gray-200';

  return (
    <div className='space-y-5 animate-fade-in'>

      {/* Won Banner */}
      {wonBanner && (
        <div className='fixed top-0 left-0 right-0 z-[1000] flex items-center justify-center py-4 pointer-events-none'>
          <div className='bg-green-500 text-white px-8 py-3 rounded-2xl shadow-2xl shadow-green-500/40 text-base font-black flex items-center gap-3 animate-bounce'>
            <Trophy size={20} />
            Deal Won! Congratulations!
            <Trophy size={20} />
          </div>
        </div>
      )}

      {toast && (
        <div className={`fixed top-5 right-5 z-[999] px-5 py-3 rounded-xl shadow-2xl text-sm font-semibold transition-all ${toast.type === 'success' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'}`}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className='flex flex-col sm:flex-row sm:items-center justify-between gap-3'>
        <div>
          <h1 className={`text-xl font-black ${th}`}>CRM Pipeline</h1>
          <p className={`text-xs mt-0.5 ${ts}`}>Kanban deal board · Track opportunities through to closure</p>
        </div>
        <div className='flex gap-2 flex-wrap'>
          <button onClick={syncData} disabled={loading} className='btn-secondary text-xs px-3 py-2 flex items-center gap-1.5'>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Sync
          </button>
          <button onClick={() => setShowCreate(true)} className='btn-primary text-xs px-3 py-2 flex items-center gap-1.5'>
            <Plus size={13} /> Add Opportunity
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className='grid grid-cols-2 md:grid-cols-4 gap-3'>
        {[
          { label: 'Pipeline Value', value: `₹${(totalPipeline / 100000).toFixed(1)}L`, icon: <DollarSign size={16} />, color: 'text-violet-400' },
          { label: 'Won This Month', value: `₹${(wonThisMonth / 100000).toFixed(1)}L`, icon: <Trophy size={16} />, color: 'text-green-400' },
          { label: 'In Progress', value: String(inProgress), icon: <BarChart2 size={16} />, color: 'text-blue-400' },
          { label: 'Win Rate', value: `${winRate}%`, icon: <TrendingUp size={16} />, color: 'text-amber-400' },
        ].map(stat => (
          <div key={stat.label} className={`card p-4 ${gc}`}>
            <div className={`flex items-center gap-2 mb-1 ${stat.color}`}>{stat.icon}<span className={`text-xs ${ts}`}>{stat.label}</span></div>
            <div className={`text-xl font-black ${th}`}>{stat.value}</div>
          </div>
        ))}
      </div>

      {/* Kanban Board */}
      <div className='overflow-x-auto pb-4'>
        <div className='flex gap-4 min-w-max'>
          {STAGE_COLS.map(col => {
            const colOpps = opps.filter(o => o.stage === col.key);
            const colTotal = colOpps.reduce((s, o) => s + o.expected_revenue, 0);
            const isWon = col.key === 'won';
            return (
              <div key={col.key} className={`w-72 flex-shrink-0 rounded-2xl border ${colBorder} ${colBg} flex flex-col`}>
                {/* Column Header */}
                <div className={`px-4 py-3 border-b ${colBorder} flex items-center justify-between`}>
                  <div className='flex items-center gap-2'>
                    <span className={`w-2 h-2 rounded-full ${isWon ? 'bg-green-400' : 'bg-[#7367f0]'}`} />
                    <span className={`text-xs font-bold ${col.color}`}>{col.label}</span>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${isDark ? 'bg-white/10 text-gray-400' : 'bg-gray-200 text-gray-600'}`}>{colOpps.length}</span>
                  </div>
                  <span className={`text-[10px] font-semibold ${ts}`}>{'₹'}{(colTotal / 100000).toFixed(1)}L</span>
                </div>

                {/* Cards */}
                <div className='p-3 space-y-3 flex-1 min-h-[200px]'>
                  {colOpps.map(opp => (
                    <div
                      key={opp.id}
                      className={`rounded-xl p-3 space-y-2.5 border transition-all ${
                        isWon
                          ? `border-green-500/40 ${isDark ? 'bg-green-500/10' : 'bg-green-50'} shadow-md shadow-green-500/10`
                          : `${isDark ? 'bg-[#161b2e] border-[#2a3250] hover:border-[#7367f0]/40' : 'bg-white border-gray-200 hover:border-violet-300'}`
                      }`}
                    >
                      <div className='flex items-start justify-between gap-1'>
                        <div className={`text-xs font-bold leading-tight ${th} flex-1`}>{opp.name}</div>
                        {isWon && <span className='badge badge-green text-[9px] flex-shrink-0'>Won</span>}
                      </div>
                      <div className={`text-[10px] ${ts}`}>{opp.partner}</div>
                      <div className='flex items-center justify-between'>
                        <span className='badge badge-violet text-[10px]'>{'₹'}{opp.expected_revenue.toLocaleString('en-IN')}</span>
                        <div className='flex items-center gap-1'>
                          <Calendar size={9} className={ts} />
                          <span className={`text-[9px] ${ts}`}>{opp.deadline ? new Date(opp.deadline).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—'}</span>
                        </div>
                      </div>

                      {/* Probability bar */}
                      <div>
                        <div className={`h-1 rounded-full ${isDark ? 'bg-[#2a3250]' : 'bg-gray-200'}`}>
                          <div
                            className={`h-1 rounded-full ${opp.probability >= 70 ? 'bg-green-400' : opp.probability >= 40 ? 'bg-amber-400' : 'bg-red-400'}`}
                            style={{ width: `${opp.probability}%` }}
                          />
                        </div>
                        <div className={`text-[9px] ${ts} mt-0.5`}>{opp.probability}% probability</div>
                      </div>

                      {/* Avatar row */}
                      <div className='flex items-center gap-1.5'>
                        <div className='w-5 h-5 rounded-full bg-gradient-to-br from-[#7367f0] to-[#3b82f6] flex items-center justify-center text-white text-[8px] font-bold'>
                          {opp.assigned_to.charAt(0)}
                        </div>
                        <span className={`text-[9px] ${ts}`}>{opp.assigned_to}</span>
                      </div>

                      {/* Actions */}
                      {col.key !== 'won' && (
                        <div className='flex gap-1 pt-1 border-t' style={{ borderColor: bd }}>
                          <div className='relative flex-1'>
                            <button
                              onClick={() => setStagePicker(stagePicker === opp.id ? null : opp.id)}
                              className='btn-secondary text-[9px] px-2 py-1 flex items-center gap-1 w-full justify-center'
                            >
                              Move Stage <ChevronDown size={9} />
                            </button>
                            {stagePicker === opp.id && (
                              <div className={`absolute bottom-full left-0 mb-1 w-40 rounded-xl shadow-2xl border z-20 overflow-hidden ${isDark ? 'bg-[#1e2440] border-[#2a3250]' : 'bg-white border-gray-200'}`}>
                                {ALL_STAGES.filter(s => s !== opp.stage && s !== 'lost').map(s => (
                                  <button
                                    key={s}
                                    onClick={() => handleMoveStage(opp, s)}
                                    className={`w-full text-left px-3 py-2 text-[10px] font-semibold transition-colors ${isDark ? 'hover:bg-white/5 text-gray-300' : 'hover:bg-gray-50 text-gray-700'}`}
                                  >
                                    {s === 'price_quote' ? 'Price Quote' : s.charAt(0).toUpperCase() + s.slice(1)}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                          <button onClick={() => handleMarkWon(opp)} title='Mark Won' className={`p-1.5 rounded-lg transition-colors ${isDark ? 'hover:bg-green-500/10 text-[#5a6a8a] hover:text-green-400' : 'hover:bg-green-50 text-gray-400 hover:text-green-600'}`}><CheckCircle2 size={11} /></button>
                          <button onClick={() => handleMarkLost(opp)} title='Mark Lost' className={`p-1.5 rounded-lg transition-colors ${isDark ? 'hover:bg-red-500/10 text-[#5a6a8a] hover:text-red-400' : 'hover:bg-red-50 text-gray-400 hover:text-red-600'}`}><X size={11} /></button>
                          <button onClick={() => setEditOpp({ ...opp })} title='Edit' className={`p-1.5 rounded-lg transition-colors ${isDark ? 'hover:bg-white/5 text-[#5a6a8a] hover:text-amber-400' : 'hover:bg-gray-100 text-gray-400 hover:text-amber-500'}`}><Edit2 size={11} /></button>
                        </div>
                      )}
                    </div>
                  ))}
                  {colOpps.length === 0 && (
                    <div className={`text-center py-8 text-[10px] ${ts} border-2 border-dashed rounded-xl ${isDark ? 'border-[#2a3250]' : 'border-gray-200'}`}>
                      No deals here
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Edit Modal */}
      {editOpp && (
        <div className='fixed inset-0 z-50 flex items-center justify-center p-4'>
          <div className='absolute inset-0 bg-black/60 backdrop-blur-sm' onClick={() => setEditOpp(null)} />
          <div className={`relative w-full max-w-md rounded-2xl p-6 space-y-4 shadow-2xl ${isDark ? 'bg-[#161b2e] border border-[#2a3250]' : 'bg-white border border-gray-200'}`}>
            <div className='flex items-center justify-between'>
              <h3 className={`font-black text-sm ${th}`}>Edit Opportunity</h3>
              <button onClick={() => setEditOpp(null)} className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-white/5 text-[#5a6a8a]' : 'hover:bg-gray-100 text-gray-400'}`}><X size={16} /></button>
            </div>
            <div className='space-y-3'>
              <div>
                <label className='label'>Stage</label>
                <select value={editOpp.stage} onChange={e => setEditOpp({ ...editOpp, stage: e.target.value as Opportunity['stage'] })} className={`${inp} w-full`}>
                  {ALL_STAGES.map(s => <option key={s} value={s}>{s === 'price_quote' ? 'Price Quote' : s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                </select>
              </div>
              <div>
                <label className='label'>Probability (%)</label>
                <input type='number' min={0} max={100} value={editOpp.probability} onChange={e => setEditOpp({ ...editOpp, probability: Number(e.target.value) })} className={`${inp} w-full`} />
              </div>
              <div>
                <label className='label'>Expected Revenue ({'₹'})</label>
                <input type='number' value={editOpp.expected_revenue} onChange={e => setEditOpp({ ...editOpp, expected_revenue: Number(e.target.value) })} className={`${inp} w-full`} />
              </div>
            </div>
            <div className='flex gap-2 pt-2'>
              <button onClick={handleSaveEdit} className='btn-primary text-xs px-4 py-2 flex-1'>Save Changes</button>
              <button onClick={() => setEditOpp(null)} className='btn-secondary text-xs px-4 py-2'>Cancel</button>
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
              <h3 className={`font-black text-sm ${th}`}>Add Opportunity</h3>
              <button onClick={() => setShowCreate(false)} className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-white/5 text-[#5a6a8a]' : 'hover:bg-gray-100 text-gray-400'}`}><X size={16} /></button>
            </div>
            <div className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
              <div className='sm:col-span-2'>
                <label className='label'>Deal Name</label>
                <input placeholder='e.g. Bulk Fabric Supply Q3' value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className={`${inp} w-full`} />
              </div>
              <div className='sm:col-span-2'>
                <label className='label'>Partner / Company</label>
                <input placeholder='Partner name' value={form.partner} onChange={e => setForm({ ...form, partner: e.target.value })} className={`${inp} w-full`} />
              </div>
              <div>
                <label className='label'>Revenue ({'₹'})</label>
                <input type='number' placeholder='500000' value={form.expected_revenue || ''} onChange={e => setForm({ ...form, expected_revenue: Number(e.target.value) })} className={`${inp} w-full`} />
              </div>
              <div>
                <label className='label'>Probability (%)</label>
                <input type='number' min={0} max={100} placeholder='50' value={form.probability || ''} onChange={e => setForm({ ...form, probability: Number(e.target.value) })} className={`${inp} w-full`} />
              </div>
              <div>
                <label className='label'>Stage</label>
                <select value={form.stage} onChange={e => setForm({ ...form, stage: e.target.value as Opportunity['stage'] })} className={`${inp} w-full`}>
                  {ALL_STAGES.map(s => <option key={s} value={s}>{s === 'price_quote' ? 'Price Quote' : s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                </select>
              </div>
              <div>
                <label className='label'>Deadline</label>
                <input type='date' value={form.deadline} onChange={e => setForm({ ...form, deadline: e.target.value })} className={`${inp} w-full`} />
              </div>
            </div>
            <div className='flex gap-2 pt-2'>
              <button onClick={handleCreate} className='btn-primary text-xs px-4 py-2 flex-1'>Add to Pipeline</button>
              <button onClick={() => setShowCreate(false)} className='btn-secondary text-xs px-4 py-2'>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


