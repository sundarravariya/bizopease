import React, { useState, useEffect, useMemo } from 'react';
import { useTheme } from '../../../context/ThemeContext';
import { searchRead, createRecord, writeRecord } from '../../../services/odoo';
import {
  Plus, RefreshCw, Search, Eye, X,
  CheckCircle2, XCircle, Clock, CalendarDays,
  ChevronLeft, ChevronRight,
} from 'lucide-react';

interface LeaveRequest {
  id: number;
  employee_id: number;
  employee_name: string;
  leave_type: string;
  date_from: string;
  date_to: string;
  days: number;
  reason: string;
  state: 'draft' | 'confirm' | 'validate1' | 'validate' | 'refuse';
}

const LEAVE_TYPES = ['Annual Leave', 'Sick Leave', 'Casual Leave', 'Maternity Leave', 'Unpaid Leave'];

const STATE_CONFIG: Record<string, { label: string; badge: string; color: string }> = {
  draft: { label: 'Draft', badge: 'badge-gray', color: 'text-gray-400' },
  confirm: { label: 'Pending', badge: 'badge-gold', color: 'text-amber-400' },
  validate1: { label: 'Manager OK', badge: 'badge-blue', color: 'text-blue-400' },
  validate: { label: 'Approved', badge: 'badge-green', color: 'text-green-400' },
  refuse: { label: 'Refused', badge: 'badge-red', color: 'text-red-400' },
};

const blankForm = {
  employee_id: 0,
  employee_name: '',
  leave_type: 'Annual Leave',
  date_from: '',
  date_to: '',
  days: 0,
  reason: '',
  state: 'draft' as const,
};

function calcDays(from: string, to: string) {
  if (!from || !to) return 0;
  const d1 = new Date(from);
  const d2 = new Date(to);
  return Math.max(1, Math.round((d2.getTime() - d1.getTime()) / 86400000) + 1);
}

// Generate 2-week rolling calendar dates from today
function getTwoWeekDates() {
  const dates: Date[] = [];
  const today = new Date();
  today.setDate(today.getDate() - 3);
  for (let i = 0; i < 14; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    dates.push(d);
  }
  return dates;
}

function dateInRange(d: Date, from: string, to: string) {
  if (!from || !to) return false;
  const df = new Date(from);
  const dt = new Date(to);
  return d >= df && d <= dt;
}

export default function Leaves() {
  const { isDark } = useTheme();
  const [leaves, setLeaves] = useState<LeaveRequest[]>(() => {
    try { return JSON.parse(localStorage.getItem('portal_leaves') || 'null') || []; } catch { return []; }
  });
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [stateFilter, setStateFilter] = useState('all');
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [drawerLeave, setDrawerLeave] = useState<LeaveRequest | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ ...blankForm });

  // Load employees list for selector
  const employees = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('portal_employees') || '[]') as { id: number; name: string }[]; } catch { return []; }
  }, []);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3200);
  };

  const syncData = async () => {
    setLoading(true);
    try {
      const r = await searchRead<any>('hr.leave', {
        fields: ['id', 'employee_id', 'holiday_status_id', 'date_from', 'date_to', 'number_of_days', 'state', 'description'],
        limit: 0,
        order: 'id desc',
      });
      if (Array.isArray(r)) {
        const mapped: LeaveRequest[] = r.map((item: any) => ({
          id: item.id,
          employee_id: item.employee_id?.[0] || 0,
          employee_name: item.employee_id?.[1] || '',
          leave_type: item.holiday_status_id?.[1] || 'Annual Leave',
          date_from: (item.date_from || '').split(' ')[0],
          date_to: (item.date_to || '').split(' ')[0],
          days: Math.abs(item.number_of_days || 0),
          reason: item.description || '',
          state: item.state || 'draft',
        }));
        setLeaves(mapped);
        localStorage.setItem('portal_leaves', JSON.stringify(mapped));
      }
    } catch {
      console.warn('Odoo offline, using cache');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { syncData(); }, []);
  useEffect(() => { localStorage.setItem('portal_leaves', JSON.stringify(leaves)); }, [leaves]);

  const handleApprove = async (leave: LeaveRequest) => {
    const nextState = leave.state === 'confirm' ? 'validate1' : 'validate';
    try { await writeRecord('hr.leave', [leave.id], { state: nextState }); } catch { /* offline */ }
    const updated = { ...leave, state: nextState as LeaveRequest['state'] };
    setLeaves(prev => prev.map(l => l.id === leave.id ? updated : l));
    // If approved (validate) and days > 3, update employee state to on_leave
    if (nextState === 'validate' && leave.days > 3) {
      try {
        const empList = JSON.parse(localStorage.getItem('portal_employees') || '[]');
        const updatedEmps = empList.map((e: any) => e.id === leave.employee_id ? { ...e, state: 'on_leave' } : e);
        localStorage.setItem('portal_employees', JSON.stringify(updatedEmps));
      } catch { /* skip */ }
    }
    setDrawerLeave(null);
    showToast(nextState === 'validate1' ? 'Manager approval recorded.' : 'Leave fully approved!');
  };

  const handleRefuse = async (leave: LeaveRequest) => {
    try { await writeRecord('hr.leave', [leave.id], { state: 'refuse' }); } catch { /* offline */ }
    setLeaves(prev => prev.map(l => l.id === leave.id ? { ...l, state: 'refuse' } : l));
    setDrawerLeave(null);
    showToast('Leave request refused.', 'error');
  };

  const handleCreate = async () => {
    const newId = Date.now();
    const newLeave: LeaveRequest = { id: newId, ...form };
    try {
      const id = await createRecord('hr.leave', {
        employee_id: form.employee_id,
        holiday_status_id: 1,
        date_from: form.date_from,
        date_to: form.date_to,
        number_of_days: form.days,
        description: form.reason,
      });
      newLeave.id = id;
    } catch { /* offline */ }
    setLeaves(prev => [newLeave, ...prev]);
    setShowCreate(false);
    setForm({ ...blankForm });
    showToast('Leave application submitted!');
  };

  const filtered = leaves.filter(l => {
    const q = search.toLowerCase();
    const matchSearch = !search || l.employee_name.toLowerCase().includes(q);
    const matchType = typeFilter === 'all' || l.leave_type === typeFilter;
    const matchState = stateFilter === 'all' || l.state === stateFilter;
    return matchSearch && matchType && matchState;
  });

  const pendingCount = leaves.filter(l => l.state === 'confirm').length;
  const approvedToday = leaves.filter(l => l.state === 'validate').length;
  const daysThisMonth = leaves.filter(l => l.state === 'validate').reduce((s, l) => s + l.days, 0);
  const refusedCount = leaves.filter(l => l.state === 'refuse').length;

  const calDates = getTwoWeekDates();
  const approvedLeaves = leaves.filter(l => l.state === 'validate');

  const gc = isDark ? 'glass' : 'glass-light bg-white/80';
  const inp = `input text-xs ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`;
  const th = isDark ? 'text-white' : 'text-gray-900';
  const ts = isDark ? 'text-[#5a6a8a]' : 'text-gray-500';
  const bd = isDark ? '#2a3250' : '#e5e7eb';

  const DAYS_OF_WEEK = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

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
          <h1 className={`text-xl font-black ${th}`}>Time Off & Leave Management</h1>
          <p className={`text-xs mt-0.5 ${ts}`}>Review, approve and manage employee leave requests</p>
        </div>
        <div className='flex gap-2 flex-wrap'>
          <button onClick={syncData} disabled={loading} className='btn-secondary text-xs px-3 py-2 flex items-center gap-1.5'>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Sync
          </button>
          <button onClick={() => setShowCreate(true)} className='btn-primary text-xs px-3 py-2 flex items-center gap-1.5'>
            <Plus size={13} /> Apply for Leave
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className='grid grid-cols-2 md:grid-cols-4 gap-3'>
        {[
          { label: 'Pending Approval', value: String(pendingCount), icon: <Clock size={16} />, color: 'text-amber-400' },
          { label: 'Approved', value: String(approvedToday), icon: <CheckCircle2 size={16} />, color: 'text-green-400' },
          { label: 'Days This Month', value: String(daysThisMonth), icon: <CalendarDays size={16} />, color: 'text-blue-400' },
          { label: 'Refused', value: String(refusedCount), icon: <XCircle size={16} />, color: 'text-red-400' },
        ].map(stat => (
          <div key={stat.label} className={`card p-4 ${gc}`}>
            <div className={`flex items-center gap-2 mb-1 ${stat.color}`}>{stat.icon}<span className={`text-xs ${ts}`}>{stat.label}</span></div>
            <div className={`text-xl font-black ${th}`}>{stat.value}</div>
          </div>
        ))}
      </div>

      {/* 2-Week Rolling Calendar */}
      <div className={`card p-4 ${gc}`}>
        <p className={`text-xs font-bold mb-3 ${th}`}>2-Week Leave Calendar</p>
        <div className='overflow-x-auto'>
          <div className='flex gap-1.5 min-w-max'>
            {calDates.map((d, i) => {
              const active = approvedLeaves.filter(l => dateInRange(d, l.date_from, l.date_to));
              const isToday = d.toDateString() === new Date().toDateString();
              return (
                <div key={i} className={`flex flex-col items-center w-12 rounded-xl p-2 ${isToday ? 'bg-[#7367f0]/20 border border-[#7367f0]/40' : isDark ? 'bg-[#1e2440]' : 'bg-gray-50'}`}>
                  <span className={`text-[9px] font-semibold ${ts}`}>{DAYS_OF_WEEK[d.getDay()]}</span>
                  <span className={`text-xs font-bold mt-0.5 ${isToday ? 'text-[#7367f0]' : th}`}>{d.getDate()}</span>
                  <div className='flex flex-wrap gap-0.5 mt-1 justify-center'>
                    {active.slice(0, 3).map((l, j) => (
                      <span key={j} className={`w-1.5 h-1.5 rounded-full ${l.leave_type === 'Sick Leave' ? 'bg-red-400' : l.leave_type === 'Annual Leave' ? 'bg-green-400' : 'bg-amber-400'}`} title={`${l.employee_name}: ${l.leave_type}`} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className='flex gap-3 mt-3'>
          {[['Annual Leave', 'bg-green-400'], ['Sick Leave', 'bg-red-400'], ['Other', 'bg-amber-400']].map(([label, cls]) => (
            <div key={label} className='flex items-center gap-1.5'>
              <span className={`w-2 h-2 rounded-full ${cls}`} />
              <span className={`text-[10px] ${ts}`}>{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className='card p-3 flex flex-col sm:flex-row gap-3'>
        <div className='relative flex-1'>
          <Search size={14} className={`absolute left-3 top-1/2 -translate-y-1/2 ${ts}`} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder='Search by employee name...' className={`${inp} pl-9 py-2 w-full`} />
        </div>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className={`${inp} py-2 w-auto`}>
          <option value='all'>All Types</option>
          {LEAVE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={stateFilter} onChange={e => setStateFilter(e.target.value)} className={`${inp} py-2 w-auto`}>
          <option value='all'>All Status</option>
          <option value='draft'>Draft</option>
          <option value='confirm'>Pending</option>
          <option value='validate1'>Manager OK</option>
          <option value='validate'>Approved</option>
          <option value='refuse'>Refused</option>
        </select>
      </div>

      {/* Table */}
      <div className='card overflow-hidden'>
        {loading ? (
          <div className='h-40 flex items-center justify-center gap-3'>
            <RefreshCw size={18} className='animate-spin text-[#7367f0]' />
            <span className={`text-sm ${ts}`}>Loading leave requests...</span>
          </div>
        ) : (
          <div className='overflow-x-auto'>
            <table className='data-table w-full'>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Leave Type</th>
                  <th>From</th>
                  <th>To</th>
                  <th className='text-center'>Days</th>
                  <th>Reason</th>
                  <th className='text-center'>State</th>
                  <th className='text-center'>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(leave => (
                  <tr key={leave.id}>
                    <td>
                      <div className='flex items-center gap-2'>
                        <div className='w-6 h-6 rounded-full bg-gradient-to-br from-[#7367f0] to-[#3b82f6] flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0'>
                          {leave.employee_name.charAt(0)}
                        </div>
                        <span className={`text-xs font-semibold ${th}`}>{leave.employee_name}</span>
                      </div>
                    </td>
                    <td><span className='badge badge-violet text-[10px]'>{leave.leave_type}</span></td>
                    <td className={`text-xs ${ts}`}>{leave.date_from ? new Date(leave.date_from).toLocaleDateString('en-IN') : '—'}</td>
                    <td className={`text-xs ${ts}`}>{leave.date_to ? new Date(leave.date_to).toLocaleDateString('en-IN') : '—'}</td>
                    <td className={`text-center text-xs font-bold ${th}`}>{leave.days}</td>
                    <td className={`text-xs ${ts} max-w-[160px] truncate`}>{leave.reason || '—'}</td>
                    <td className='text-center'>
                      <span className={`${STATE_CONFIG[leave.state]?.badge || 'badge-gray'} text-[10px]`}>{STATE_CONFIG[leave.state]?.label}</span>
                    </td>
                    <td>
                      <div className='flex items-center justify-center gap-1'>
                        {(leave.state === 'confirm' || leave.state === 'validate1') && (
                          <button onClick={() => handleApprove(leave)} className={`p-1.5 rounded-lg transition-colors ${isDark ? 'hover:bg-green-500/10 text-[#5a6a8a] hover:text-green-400' : 'hover:bg-green-50 text-gray-400 hover:text-green-600'}`} title='Approve'><CheckCircle2 size={13} /></button>
                        )}
                        {(leave.state === 'confirm' || leave.state === 'validate1') && (
                          <button onClick={() => handleRefuse(leave)} className={`p-1.5 rounded-lg transition-colors ${isDark ? 'hover:bg-red-500/10 text-[#5a6a8a] hover:text-red-400' : 'hover:bg-red-50 text-gray-400 hover:text-red-500'}`} title='Refuse'><XCircle size={13} /></button>
                        )}
                        <button onClick={() => setDrawerLeave(leave)} className={`p-1.5 rounded-lg transition-colors ${isDark ? 'hover:bg-white/5 text-[#5a6a8a] hover:text-white' : 'hover:bg-gray-100 text-gray-400 hover:text-gray-700'}`} title='View'><Eye size={13} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <div className={`text-center py-12 text-sm ${ts}`}>No leave requests match your filters.</div>
            )}
          </div>
        )}
      </div>

      {/* Detail Drawer */}
      {drawerLeave && (
        <div className='fixed inset-0 z-50 flex justify-end'>
          <div className='absolute inset-0 bg-black/50 backdrop-blur-sm' onClick={() => setDrawerLeave(null)} />
          <div className={`relative w-full max-w-md h-full overflow-y-auto p-6 space-y-5 shadow-2xl ${isDark ? 'bg-[#161b2e] border-l border-[#2a3250]' : 'bg-white border-l border-gray-200'}`}>
            <div className='flex items-center justify-between'>
              <h2 className={`font-black text-sm ${th}`}>Leave Details</h2>
              <button onClick={() => setDrawerLeave(null)} className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-white/5 text-[#5a6a8a] hover:text-white' : 'hover:bg-gray-100 text-gray-400'}`}><X size={16} /></button>
            </div>
            <div className='flex items-center gap-3'>
              <div className='w-12 h-12 rounded-xl bg-gradient-to-br from-[#7367f0] to-[#3b82f6] flex items-center justify-center text-white font-black text-lg'>
                {drawerLeave.employee_name.charAt(0)}
              </div>
              <div>
                <div className={`font-bold ${th}`}>{drawerLeave.employee_name}</div>
                <span className={`${STATE_CONFIG[drawerLeave.state]?.badge || 'badge-gray'} text-[10px]`}>{STATE_CONFIG[drawerLeave.state]?.label}</span>
              </div>
            </div>
            <div className={`rounded-xl p-4 space-y-2.5 ${isDark ? 'bg-[#1e2440]' : 'bg-gray-50'}`}>
              {[
                ['Leave Type', drawerLeave.leave_type],
                ['From', drawerLeave.date_from],
                ['To', drawerLeave.date_to],
                ['Total Days', String(drawerLeave.days)],
                ['Reason', drawerLeave.reason || '—'],
              ].map(([label, val]) => (
                <div key={label} className='flex justify-between text-xs'>
                  <span className={ts}>{label}</span>
                  <span className={`font-semibold ${th} max-w-[55%] text-right`}>{val}</span>
                </div>
              ))}
            </div>
            {(drawerLeave.state === 'confirm' || drawerLeave.state === 'validate1') && (
              <div className='flex gap-2'>
                <button onClick={() => handleApprove(drawerLeave)} className='btn-primary text-xs px-4 py-2 flex-1 flex items-center justify-center gap-1.5'>
                  <CheckCircle2 size={13} />
                  {drawerLeave.state === 'confirm' ? 'Manager Approve' : 'HR Final Approve'}
                </button>
                <button onClick={() => handleRefuse(drawerLeave)} className='btn-secondary text-xs px-4 py-2 flex items-center gap-1.5 text-red-400 border-red-500/20'>
                  <XCircle size={13} /> Refuse
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <div className='fixed inset-0 z-50 flex items-center justify-center p-4'>
          <div className='absolute inset-0 bg-black/60 backdrop-blur-sm' onClick={() => setShowCreate(false)} />
          <div className={`relative w-full max-w-lg rounded-2xl p-6 space-y-4 shadow-2xl overflow-y-auto max-h-[90vh] ${isDark ? 'bg-[#161b2e] border border-[#2a3250]' : 'bg-white border border-gray-200'}`}>
            <div className='flex items-center justify-between'>
              <h3 className={`font-black text-sm ${th}`}>Apply for Leave</h3>
              <button onClick={() => setShowCreate(false)} className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-white/5 text-[#5a6a8a]' : 'hover:bg-gray-100 text-gray-400'}`}><X size={16} /></button>
            </div>
            <div className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
              <div className='sm:col-span-2'>
                <label className='label'>Employee</label>
                <select
                  value={form.employee_id}
                  onChange={e => {
                    const id = Number(e.target.value);
                    const emp = employees.find(emp => emp.id === id);
                    setForm({ ...form, employee_id: id, employee_name: emp?.name || '' });
                  }}
                  className={`${inp} w-full`}
                >
                  <option value={0}>Select employee</option>
                  {employees.length > 0
                    ? employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)
                    : leaves.map(l => l.employee_name).filter((v, i, a) => a.indexOf(v) === i).map(n => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                </select>
              </div>
              <div className='sm:col-span-2'>
                <label className='label'>Leave Type</label>
                <select value={form.leave_type} onChange={e => setForm({ ...form, leave_type: e.target.value })} className={`${inp} w-full`}>
                  {LEAVE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className='label'>From Date</label>
                <input
                  type='date'
                  value={form.date_from}
                  onChange={e => {
                    const nf = e.target.value;
                    setForm({ ...form, date_from: nf, days: calcDays(nf, form.date_to) });
                  }}
                  className={`${inp} w-full`}
                />
              </div>
              <div>
                <label className='label'>To Date</label>
                <input
                  type='date'
                  value={form.date_to}
                  onChange={e => {
                    const nt = e.target.value;
                    setForm({ ...form, date_to: nt, days: calcDays(form.date_from, nt) });
                  }}
                  className={`${inp} w-full`}
                />
              </div>
              <div>
                <label className='label'>Days (auto-calculated)</label>
                <input type='number' readOnly value={form.days} className={`${inp} w-full opacity-60`} />
              </div>
              <div className='sm:col-span-2'>
                <label className='label'>Reason</label>
                <textarea
                  rows={3}
                  placeholder='Brief reason for leave request...'
                  value={form.reason}
                  onChange={e => setForm({ ...form, reason: e.target.value })}
                  className={`${inp} w-full resize-none`}
                />
              </div>
            </div>
            <div className='flex gap-2 pt-2'>
              <button onClick={handleCreate} className='btn-primary text-xs px-4 py-2 flex-1'>Submit Application</button>
              <button onClick={() => setShowCreate(false)} className='btn-secondary text-xs px-4 py-2'>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


