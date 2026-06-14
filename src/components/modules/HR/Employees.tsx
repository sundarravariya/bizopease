import React, { useState, useEffect } from 'react';
import { useTheme } from '../../../context/ThemeContext';
import { searchRead, createRecord, writeRecord } from '../../../services/odoo';
import {
  Plus, RefreshCw, Search, Eye, List, LayoutGrid,
  Mail, Phone, X, Users, UserCheck, CalendarOff, Building2,
  UserPlus, Copy, Check, KeyRound, ShieldCheck,
} from 'lucide-react';

function generatePassword(len = 12): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
  return Array.from(crypto.getRandomValues(new Uint8Array(len)))
    .map(b => chars[b % chars.length]).join('');
}

interface Employee {
  id: number;
  name: string;
  employee_number: string;
  job_title: string;
  department: string;
  email: string;
  phone: string;
  date_joined: string;
  manager: string;
  leave_balance: number;
  state: 'active' | 'on_leave' | 'suspended';
}

const DEPARTMENTS = ['IT & Administration', 'Logistics & Warehouse', 'Finance & Accounts', 'B2B Wholesale Sales', 'Operations'];

const DEPT_GRADIENTS: Record<string, string> = {
  'IT & Administration': 'from-violet-500 to-indigo-600',
  'Logistics & Warehouse': 'from-amber-500 to-orange-600',
  'Finance & Accounts': 'from-green-500 to-emerald-600',
  'B2B Wholesale Sales': 'from-blue-500 to-cyan-600',
  'Operations': 'from-rose-500 to-pink-600',
};

const STATE_CONFIG: Record<string, { label: string; dot: string; badge: string }> = {
  active: { label: 'Active', dot: 'bg-green-400', badge: 'badge-green' },
  on_leave: { label: 'On Leave', dot: 'bg-amber-400', badge: 'badge-gold' },
  suspended: { label: 'Suspended', dot: 'bg-red-400', badge: 'badge-red' },
};

const blankForm = {
  name: '', job_title: '', department: '', email: '', phone: '',
  date_joined: '', manager: '', leave_balance: 0, state: 'active' as Employee['state'],
};

function getInitials(name: string) {
  return name.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();
}

export default function Employees() {
  const { isDark } = useTheme();
  const [employees, setEmployees] = useState<Employee[]>(() => {
    try { return JSON.parse(localStorage.getItem('portal_employees') || 'null') || []; } catch { return []; }
  });
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'card' | 'table'>('card');
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('all');
  const [stateFilter, setStateFilter] = useState('all');
  const [toast, setToast] = useState<string | null>(null);
  const [drawerEmp, setDrawerEmp] = useState<Employee | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ ...blankForm });

  // Portal account creation
  const blankAcct = { name: '', login: '', password: generatePassword(), jobTitle: '', department: DEPARTMENTS[0], role: 'employee' as 'employee' | 'admin' };
  const [showCreateAccount, setShowCreateAccount] = useState(false);
  const [acctForm, setAcctForm] = useState({ ...blankAcct });
  const [acctCreating, setAcctCreating] = useState(false);
  const [acctResult, setAcctResult] = useState<{ userId: number; login: string; password: string; name: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  const handleCreateAccount = async () => {
    if (!acctForm.name.trim() || !acctForm.login.trim() || !acctForm.password.trim()) return;
    setAcctCreating(true);
    try {
      const login = acctForm.login.trim().toLowerCase();
      const userId: number = await createRecord('res.users', {
        name: acctForm.name.trim(),
        login,
        password: acctForm.password,
        email: login,
      });

      if (acctForm.role === 'admin') {
        // Resolve base.group_system ID from ir.model.data then grant it
        const gd = await searchRead<{ res_id: number }>('ir.model.data', {
          domain: [['module', '=', 'base'], ['name', '=', 'group_system']],
          fields: ['res_id'], limit: 1,
        });
        if (gd[0]?.res_id) {
          await writeRecord('res.groups', [gd[0].res_id], { users: [[4, userId]] });
        }
      }

      await createRecord('hr.employee', {
        name: acctForm.name.trim(),
        work_email: login,
        job_title: acctForm.jobTitle.trim(),
        user_id: userId,
      });

      setAcctResult({ userId, login, password: acctForm.password, name: acctForm.name.trim() });
      await syncData();
    } catch (e: any) {
      showToast('Error: ' + (e.message || 'Could not create account'));
    } finally {
      setAcctCreating(false);
    }
  };

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  const syncData = async () => {
    setLoading(true);
    try {
      const r = await searchRead<any>('hr.employee', {
        fields: ['id', 'name', 'job_title', 'department_id', 'work_email', 'work_phone', 'active', 'remaining_leaves', 'coach_id'],
        limit: 0,
        order: 'id asc',
      });
      if (Array.isArray(r)) {
        const mapped: Employee[] = r.map((item: any, i: number) => ({
          id: item.id,
          name: item.name || '',
          employee_number: `RBF-${String(i + 1).padStart(3, '0')}`,
          job_title: item.job_title || '',
          department: item.department_id?.[1] || '',
          email: item.work_email || '',
          phone: item.work_phone || '',
          date_joined: '',
          manager: Array.isArray(item.coach_id) ? item.coach_id[1] : '',
          leave_balance: item.remaining_leaves || 0,
          state: item.active ? 'active' : 'suspended' as const,
        }));
        setEmployees(mapped);
        localStorage.setItem('portal_employees', JSON.stringify(mapped));
      }
    } catch {
      console.warn('Odoo offline, using cache');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { syncData(); }, []);
  useEffect(() => { localStorage.setItem('portal_employees', JSON.stringify(employees)); }, [employees]);

  const filtered = employees.filter(e => {
    const q = search.toLowerCase();
    const matchSearch = !search || e.name.toLowerCase().includes(q) || e.job_title.toLowerCase().includes(q) || e.email.toLowerCase().includes(q);
    const matchDept = deptFilter === 'all' || e.department === deptFilter;
    const matchState = stateFilter === 'all' || e.state === stateFilter;
    return matchSearch && matchDept && matchState;
  });

  const handleCreate = async () => {
    const newId = Date.now();
    const empNum = `RBF-${String(employees.length + 1).padStart(3, '0')}`;
    const newEmp: Employee = { id: newId, employee_number: empNum, ...form };
    try {
      const id = await createRecord('hr.employee', { name: form.name, job_title: form.job_title, work_email: form.email, work_phone: form.phone });
      newEmp.id = id;
    } catch { /* offline */ }
    setEmployees(prev => [...prev, newEmp]);
    setShowCreate(false);
    setForm({ ...blankForm });
    showToast('Employee added successfully!');
  };

  // Get leave history for drawer
  const getLeaveHistory = (empId: number) => {
    try {
      const leaves = JSON.parse(localStorage.getItem('portal_leaves') || '[]');
      return leaves.filter((l: any) => l.employee_id === empId).slice(0, 5);
    } catch { return []; }
  };

  const gc = isDark ? 'glass' : 'glass-light bg-white/80';
  const inp = `input text-xs ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`;
  const th = isDark ? 'text-white' : 'text-gray-900';
  const ts = isDark ? 'text-[#5a6a8a]' : 'text-gray-500';
  const bd = isDark ? '#2a3250' : '#e5e7eb';

  const totalActive = employees.filter(e => e.state === 'active').length;
  const onLeave = employees.filter(e => e.state === 'on_leave').length;
  const deptCount = new Set(employees.map(e => e.department)).size;

  return (
    <div className='space-y-5 animate-fade-in'>

      {toast && (
        <div className='fixed top-5 right-5 z-[999] px-5 py-3 rounded-xl shadow-2xl text-sm font-semibold bg-green-500 text-white'>
          {toast}
        </div>
      )}

      {/* Header */}
      <div className='flex flex-col sm:flex-row sm:items-center justify-between gap-3'>
        <div>
          <h1 className={`text-xl font-black ${th}`}>Employee Directory</h1>
          <p className={`text-xs mt-0.5 ${ts}`}>{employees.length} employees across {deptCount} departments</p>
        </div>
        <div className='flex gap-2 flex-wrap'>
          <button onClick={syncData} disabled={loading} className='btn-secondary text-xs px-3 py-2 flex items-center gap-1.5'>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Sync
          </button>
          <button onClick={() => { setAcctForm({ ...blankAcct, password: generatePassword() }); setAcctResult(null); setShowCreateAccount(true); }}
            className='btn-secondary text-xs px-3 py-2 flex items-center gap-1.5 border-[#7367f0]/40 text-[#7367f0]'>
            <UserPlus size={13} /> Create Account
          </button>
          <button onClick={() => setShowCreate(true)} className='btn-primary text-xs px-3 py-2 flex items-center gap-1.5'>
            <Plus size={13} /> Add Employee
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className='grid grid-cols-2 md:grid-cols-4 gap-3'>
        {[
          { label: 'Total Employees', value: String(employees.length), icon: <Users size={16} />, color: 'text-violet-400' },
          { label: 'Active', value: String(totalActive), icon: <UserCheck size={16} />, color: 'text-green-400' },
          { label: 'On Leave Today', value: String(onLeave), icon: <CalendarOff size={16} />, color: 'text-amber-400' },
          { label: 'Departments', value: String(deptCount), icon: <Building2 size={16} />, color: 'text-blue-400' },
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
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder='Search employees, roles, emails...' className={`${inp} pl-9 py-2 w-full`} />
        </div>
        <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)} className={`${inp} py-2 w-auto`}>
          <option value='all'>All Departments</option>
          {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select value={stateFilter} onChange={e => setStateFilter(e.target.value)} className={`${inp} py-2 w-auto`}>
          <option value='all'>All Status</option>
          <option value='active'>Active</option>
          <option value='on_leave'>On Leave</option>
          <option value='suspended'>Suspended</option>
        </select>
        <div className='flex gap-1 items-center'>
          <button onClick={() => setViewMode('card')} title='Card view' className={`p-2 rounded-lg transition-colors ${viewMode === 'card' ? 'bg-[#7367f0] text-white' : isDark ? 'text-[#5a6a8a] hover:text-white hover:bg-white/5' : 'text-gray-400 hover:bg-gray-100'}`}><LayoutGrid size={14} /></button>
          <button onClick={() => setViewMode('table')} title='Table view' className={`p-2 rounded-lg transition-colors ${viewMode === 'table' ? 'bg-[#7367f0] text-white' : isDark ? 'text-[#5a6a8a] hover:text-white hover:bg-white/5' : 'text-gray-400 hover:bg-gray-100'}`}><List size={14} /></button>
        </div>
      </div>

      {/* Card View */}
      {viewMode === 'card' && (
        <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4'>
          {filtered.map(emp => (
            <div key={emp.id} className={`card p-5 space-y-4 ${gc} hover:border-[#7367f0]/40 transition-colors`}>
              <div className='flex items-start justify-between'>
                <div className='flex items-center gap-3'>
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-white font-black text-sm bg-gradient-to-br ${DEPT_GRADIENTS[emp.department] || 'from-violet-500 to-indigo-600'}`}>
                    {getInitials(emp.name)}
                  </div>
                  <div>
                    <div className={`font-bold text-sm ${th}`}>{emp.name}</div>
                    <div className={`text-[10px] ${ts}`}>{emp.job_title}</div>
                  </div>
                </div>
                <div className='flex items-center gap-1.5'>
                  <span className={`w-2 h-2 rounded-full ${STATE_CONFIG[emp.state].dot}`} title={STATE_CONFIG[emp.state].label} />
                </div>
              </div>
              <div>
                <span className={`${STATE_CONFIG[emp.state].badge} text-[10px]`}>{emp.department}</span>
              </div>
              <div className='space-y-1.5'>
                <div className='flex items-center gap-2'>
                  <Mail size={11} className={ts} />
                  <span className={`text-[10px] ${ts} truncate`}>{emp.email}</span>
                </div>
                <div className='flex items-center gap-2'>
                  <Phone size={11} className={ts} />
                  <span className={`text-[10px] ${ts}`}>{emp.phone}</span>
                </div>
              </div>
              <div className='flex items-center justify-between pt-2 border-t' style={{ borderColor: bd }}>
                <div className={`text-[10px] ${ts}`}>
                  Leave Balance: <span className={`font-bold ${emp.leave_balance <= 5 ? 'text-red-400' : 'text-green-400'}`}>{emp.leave_balance} days</span>
                </div>
              </div>
              <div className='flex gap-2'>
                <button onClick={() => setDrawerEmp(emp)} className='btn-secondary text-[10px] px-3 py-1.5 flex items-center gap-1 flex-1 justify-center'>
                  <Eye size={10} /> View Profile
                </button>
                <button className='btn-primary text-[10px] px-3 py-1.5 flex items-center gap-1 flex-1 justify-center'>
                  <CalendarOff size={10} /> Request Leave
                </button>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className={`col-span-full text-center py-12 text-sm ${ts}`}>No employees match your filters.</div>
          )}
        </div>
      )}

      {/* Table View */}
      {viewMode === 'table' && (
        <div className='card overflow-hidden'>
          {loading ? (
            <div className='h-40 flex items-center justify-center gap-3'>
              <RefreshCw size={18} className='animate-spin text-[#7367f0]' />
              <span className={`text-sm ${ts}`}>Loading employees...</span>
            </div>
          ) : (
            <div className='overflow-x-auto'>
              <table className='data-table w-full'>
                <thead>
                  <tr>
                    <th>Emp #</th>
                    <th>Name</th>
                    <th>Department</th>
                    <th>Job Title</th>
                    <th>Email</th>
                    <th>Phone</th>
                    <th className='text-center'>Leave Bal</th>
                    <th className='text-center'>Status</th>
                    <th className='text-center'>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(emp => (
                    <tr key={emp.id}>
                      <td><span className='font-mono text-xs font-semibold text-[#7367f0]'>{emp.employee_number}</span></td>
                      <td>
                        <div className='flex items-center gap-2'>
                          <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-white text-[10px] font-bold bg-gradient-to-br ${DEPT_GRADIENTS[emp.department] || 'from-violet-500 to-indigo-600'}`}>
                            {getInitials(emp.name)}
                          </div>
                          <span className={`text-xs font-semibold ${th}`}>{emp.name}</span>
                        </div>
                      </td>
                      <td className={`text-xs ${ts}`}>{emp.department}</td>
                      <td className={`text-xs ${th}`}>{emp.job_title}</td>
                      <td className={`text-xs ${ts}`}>{emp.email}</td>
                      <td className={`text-xs ${ts}`}>{emp.phone}</td>
                      <td className='text-center'>
                        <span className={`text-xs font-bold ${emp.leave_balance <= 5 ? 'text-red-400' : 'text-green-400'}`}>{emp.leave_balance}d</span>
                      </td>
                      <td className='text-center'>
                        <span className={`${STATE_CONFIG[emp.state].badge} text-[10px]`}>{STATE_CONFIG[emp.state].label}</span>
                      </td>
                      <td>
                        <div className='flex items-center justify-center'>
                          <button onClick={() => setDrawerEmp(emp)} className={`p-1.5 rounded-lg transition-colors ${isDark ? 'hover:bg-white/5 text-[#5a6a8a] hover:text-white' : 'hover:bg-gray-100 text-gray-400 hover:text-gray-700'}`}><Eye size={13} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length === 0 && (
                <div className={`text-center py-12 text-sm ${ts}`}>No employees match your filters.</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Employee Drawer */}
      {drawerEmp && (
        <div className='fixed inset-0 z-50 flex justify-end'>
          <div className='absolute inset-0 bg-black/50 backdrop-blur-sm' onClick={() => setDrawerEmp(null)} />
          <div className={`relative w-full max-w-md h-full overflow-y-auto p-6 space-y-5 shadow-2xl ${isDark ? 'bg-[#161b2e] border-l border-[#2a3250]' : 'bg-white border-l border-gray-200'}`}>
            <div className='flex items-center justify-between'>
              <h2 className={`font-black text-sm ${th}`}>Employee Profile</h2>
              <button onClick={() => setDrawerEmp(null)} className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-white/5 text-[#5a6a8a] hover:text-white' : 'hover:bg-gray-100 text-gray-400'}`}><X size={16} /></button>
            </div>
            <div className='flex items-center gap-4'>
              <div className={`w-16 h-16 rounded-2xl flex items-center justify-center text-white font-black text-xl bg-gradient-to-br ${DEPT_GRADIENTS[drawerEmp.department] || 'from-violet-500 to-indigo-600'}`}>
                {getInitials(drawerEmp.name)}
              </div>
              <div>
                <div className={`font-black text-base ${th}`}>{drawerEmp.name}</div>
                <div className={`text-xs ${ts}`}>{drawerEmp.job_title}</div>
                <span className={`${STATE_CONFIG[drawerEmp.state].badge} text-[10px] mt-1 inline-block`}>{drawerEmp.department}</span>
              </div>
            </div>
            <div className={`rounded-xl p-4 space-y-2.5 ${isDark ? 'bg-[#1e2440]' : 'bg-gray-50'}`}>
              {[
                ['Emp Number', drawerEmp.employee_number],
                ['Email', drawerEmp.email],
                ['Phone', drawerEmp.phone],
                ['Date Joined', drawerEmp.date_joined || '—'],
                ['Manager', drawerEmp.manager || '—'],
                ['Leave Balance', `${drawerEmp.leave_balance} days`],
                ['Status', STATE_CONFIG[drawerEmp.state].label],
              ].map(([label, val]) => (
                <div key={label} className='flex justify-between text-xs'>
                  <span className={ts}>{label}</span>
                  <span className={`font-semibold ${th}`}>{val}</span>
                </div>
              ))}
            </div>
            <div>
              <p className={`text-xs font-bold mb-3 ${th}`}>Recent Leave History</p>
              {getLeaveHistory(drawerEmp.id).length > 0 ? getLeaveHistory(drawerEmp.id).map((l: any, i: number) => (
                <div key={i} className={`text-xs ${ts} flex justify-between py-1.5 border-b`} style={{ borderColor: bd }}>
                  <span>{l.leave_type}</span>
                  <span>{l.date_from} – {l.date_to}</span>
                </div>
              )) : (
                <div className={`text-xs ${ts} text-center py-4`}>No leave records found.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create Portal Account Modal */}
      {showCreateAccount && (
        <div className='fixed inset-0 z-50 flex items-center justify-center p-4'>
          <div className='absolute inset-0 bg-black/60 backdrop-blur-sm' onClick={() => { setShowCreateAccount(false); setAcctResult(null); }} />
          <div className={`relative w-full max-w-md rounded-2xl shadow-2xl overflow-hidden ${isDark ? 'bg-[#161b2e] border border-[#2a3250]' : 'bg-white border border-gray-200'}`}>

            {/* Header */}
            <div className={`flex items-center justify-between px-5 py-4 border-b ${isDark ? 'border-[#2a3250]' : 'border-gray-100'}`}>
              <div className='flex items-center gap-2'>
                <div className='w-7 h-7 rounded-lg bg-[#7367f0]/15 flex items-center justify-center'>
                  <ShieldCheck size={14} className='text-[#7367f0]' />
                </div>
                <h3 className={`font-black text-sm ${th}`}>Create Employee Portal Account</h3>
              </div>
              <button onClick={() => { setShowCreateAccount(false); setAcctResult(null); }} className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-white/5 text-[#5a6a8a]' : 'hover:bg-gray-100 text-gray-400'}`}><X size={15} /></button>
            </div>

            {!acctResult ? (
              <div className='p-5 space-y-4'>
                <p className={`text-xs ${ts}`}>Creates an Odoo internal user. They log in to the portal URL with the credentials below. They get <strong>employee-level access only</strong> (no admin powers).</p>

                <div className='space-y-3'>
                  <div>
                    <label className='label'>Full Name <span className='text-red-400'>*</span></label>
                    <input value={acctForm.name} onChange={e => setAcctForm(f => ({ ...f, name: e.target.value }))}
                      placeholder='e.g. Rahul Sharma' className={`${inp} w-full`} />
                  </div>
                  <div>
                    <label className='label'>Login Email <span className='text-red-400'>*</span></label>
                    <input type='email' value={acctForm.login} onChange={e => setAcctForm(f => ({ ...f, login: e.target.value }))}
                      placeholder='rahul@robifel.in' className={`${inp} w-full`} />
                  </div>
                  <div>
                    <label className='label'>Initial Password <span className='text-red-400'>*</span></label>
                    <div className='flex gap-2'>
                      <input value={acctForm.password} onChange={e => setAcctForm(f => ({ ...f, password: e.target.value }))}
                        className={`${inp} w-full font-mono text-xs`} />
                      <button type='button' onClick={() => setAcctForm(f => ({ ...f, password: generatePassword() }))}
                        title='Regenerate' className={`p-2 rounded-lg border text-xs flex-shrink-0 ${isDark ? 'border-[#2a3250] hover:bg-white/5 text-[#5a6a8a]' : 'border-gray-200 hover:bg-gray-50 text-gray-400'}`}>
                        <KeyRound size={13} />
                      </button>
                    </div>
                    <p className={`text-[10px] mt-1 ${ts}`}>Share this with the employee and ask them to change it on first login.</p>
                  </div>

                  {/* Role */}
                  <div>
                    <label className='label'>Portal Role</label>
                    <div className='grid grid-cols-2 gap-2'>
                      {(['employee', 'admin'] as const).map(r => (
                        <button key={r} type='button' onClick={() => setAcctForm(f => ({ ...f, role: r }))}
                          className={`py-2.5 px-3 rounded-xl border text-xs font-semibold transition-all text-left ${acctForm.role === r
                            ? r === 'admin' ? 'border-rose-500/50 bg-rose-500/10 text-rose-400' : 'border-[#7367f0]/50 bg-[#7367f0]/10 text-[#7367f0]'
                            : isDark ? 'border-[#2a3250] text-[#5a6a8a] hover:border-[#3a4260]' : 'border-gray-200 text-gray-400 hover:border-gray-300'}`}>
                          <div className='font-bold capitalize'>{r === 'employee' ? 'Employee' : 'Admin'}</div>
                          <div className={`text-[10px] mt-0.5 font-normal ${acctForm.role === r ? '' : ts}`}>
                            {r === 'employee' ? 'Tasks, returns, orders only' : 'Full admin access to portal'}
                          </div>
                        </button>
                      ))}
                    </div>
                    {acctForm.role === 'admin' && (
                      <p className='text-[10px] text-rose-400 mt-1.5 font-medium'>Admin accounts have full Odoo system access. Use with caution.</p>
                    )}
                  </div>

                  <div className='grid grid-cols-2 gap-3'>
                    <div>
                      <label className='label'>Job Title</label>
                      <input value={acctForm.jobTitle} onChange={e => setAcctForm(f => ({ ...f, jobTitle: e.target.value }))}
                        placeholder='e.g. Warehouse Staff' className={`${inp} w-full`} />
                    </div>
                    <div>
                      <label className='label'>Department</label>
                      <select value={acctForm.department} onChange={e => setAcctForm(f => ({ ...f, department: e.target.value }))} className={`${inp} w-full`}>
                        {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                    </div>
                  </div>
                </div>

                <div className='flex gap-2 pt-1'>
                  <button onClick={handleCreateAccount} disabled={acctCreating || !acctForm.name.trim() || !acctForm.login.trim() || !acctForm.password.trim()}
                    className='btn-primary text-xs px-4 py-2 flex-1 flex items-center justify-center gap-1.5 disabled:opacity-50'>
                    {acctCreating ? <><RefreshCw size={12} className='animate-spin' /> Creating…</> : <><UserPlus size={12} /> Create Account</>}
                  </button>
                  <button onClick={() => { setShowCreateAccount(false); setAcctResult(null); }} className='btn-secondary text-xs px-4 py-2'>Cancel</button>
                </div>
              </div>
            ) : (
              <div className='p-5 space-y-4'>
                <div className='flex items-center gap-2 text-green-400'>
                  <Check size={18} />
                  <span className='font-bold text-sm'>Account created successfully!</span>
                </div>
                <p className={`text-xs ${ts}`}>Share these credentials with <strong className={th}>{acctResult.name}</strong>. They can log in at the portal URL immediately with <strong>{acctForm.role}</strong>-level access.</p>

                <div className={`rounded-xl p-4 space-y-3 ${isDark ? 'bg-[#0f1420] border border-[#2a3250]' : 'bg-gray-50 border border-gray-200'}`}>
                  {[
                    { label: 'Portal URL', value: 'https://dashboard.robifel.in', key: 'url' },
                    { label: 'Login Email', value: acctResult.login, key: 'login' },
                    { label: 'Password', value: acctResult.password, key: 'pw' },
                  ].map(row => (
                    <div key={row.key} className='flex items-center justify-between gap-3'>
                      <div className='min-w-0'>
                        <p className={`text-[10px] font-semibold uppercase tracking-wider mb-0.5 ${ts}`}>{row.label}</p>
                        <p className={`text-xs font-mono font-bold truncate ${th}`}>{row.value}</p>
                      </div>
                      <button onClick={() => copyToClipboard(row.value, row.key)}
                        className={`p-1.5 rounded-lg flex-shrink-0 transition-colors ${copied === row.key ? 'bg-green-500/15 text-green-400' : isDark ? 'hover:bg-white/5 text-[#5a6a8a]' : 'hover:bg-gray-200 text-gray-400'}`}>
                        {copied === row.key ? <Check size={13} /> : <Copy size={13} />}
                      </button>
                    </div>
                  ))}
                  <button onClick={() => copyToClipboard(`Portal URL: https://dashboard.robifel.in\nEmail: ${acctResult.login}\nPassword: ${acctResult.password}`, 'all')}
                    className={`w-full mt-1 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${copied === 'all' ? 'bg-green-500/15 text-green-400' : isDark ? 'bg-white/5 hover:bg-white/10 text-[#7367f0]' : 'bg-gray-100 hover:bg-gray-200 text-[#7367f0]'}`}>
                    {copied === 'all' ? <><Check size={12} /> Copied!</> : <><Copy size={12} /> Copy All Credentials</>}
                  </button>
                </div>

                <div className={`rounded-xl p-3 ${isDark ? 'bg-amber-500/10 border border-amber-500/20' : 'bg-amber-50 border border-amber-200'}`}>
                  <p className='text-xs text-amber-500 font-medium'>Ask the employee to change their password after first login via Settings → Profile.</p>
                </div>

                <button onClick={() => { setShowCreateAccount(false); setAcctResult(null); }} className='btn-primary text-xs px-4 py-2 w-full'>Done</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create Employee Modal */}
      {showCreate && (
        <div className='fixed inset-0 z-50 flex items-center justify-center p-4'>
          <div className='absolute inset-0 bg-black/60 backdrop-blur-sm' onClick={() => setShowCreate(false)} />
          <div className={`relative w-full max-w-lg rounded-2xl p-6 space-y-4 shadow-2xl overflow-y-auto max-h-[90vh] ${isDark ? 'bg-[#161b2e] border border-[#2a3250]' : 'bg-white border border-gray-200'}`}>
            <div className='flex items-center justify-between'>
              <h3 className={`font-black text-sm ${th}`}>Add New Employee</h3>
              <button onClick={() => setShowCreate(false)} className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-white/5 text-[#5a6a8a]' : 'hover:bg-gray-100 text-gray-400'}`}><X size={16} /></button>
            </div>
            <div className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
              <div className='sm:col-span-2'>
                <label className='label'>Full Name</label>
                <input placeholder='Full name' value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className={`${inp} w-full`} />
              </div>
              <div>
                <label className='label'>Job Title</label>
                <input placeholder='e.g. Sales Executive' value={form.job_title} onChange={e => setForm({ ...form, job_title: e.target.value })} className={`${inp} w-full`} />
              </div>
              <div>
                <label className='label'>Department</label>
                <select value={form.department} onChange={e => setForm({ ...form, department: e.target.value })} className={`${inp} w-full`}>
                  {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className='label'>Email</label>
                <input type='email' placeholder='name@robifel.in' value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className={`${inp} w-full`} />
              </div>
              <div>
                <label className='label'>Phone</label>
                <input type='tel' placeholder='+91 98765 43210' value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className={`${inp} w-full`} />
              </div>
              <div>
                <label className='label'>Date Joined</label>
                <input type='date' value={form.date_joined} onChange={e => setForm({ ...form, date_joined: e.target.value })} className={`${inp} w-full`} />
              </div>
              <div>
                <label className='label'>Manager</label>
                <input placeholder='Manager name' value={form.manager} onChange={e => setForm({ ...form, manager: e.target.value })} className={`${inp} w-full`} />
              </div>
              <div>
                <label className='label'>Leave Balance (days)</label>
                <input type='number' min={0} placeholder='20' value={form.leave_balance || ''} onChange={e => setForm({ ...form, leave_balance: Number(e.target.value) })} className={`${inp} w-full`} />
              </div>
              <div>
                <label className='label'>Status</label>
                <select value={form.state} onChange={e => setForm({ ...form, state: e.target.value as Employee['state'] })} className={`${inp} w-full`}>
                  <option value='active'>Active</option>
                  <option value='on_leave'>On Leave</option>
                  <option value='suspended'>Suspended</option>
                </select>
              </div>
            </div>
            <div className='flex gap-2 pt-2'>
              <button onClick={handleCreate} className='btn-primary text-xs px-4 py-2 flex-1'>Add Employee</button>
              <button onClick={() => setShowCreate(false)} className='btn-secondary text-xs px-4 py-2'>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


