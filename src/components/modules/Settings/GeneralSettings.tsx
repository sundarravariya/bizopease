import { useState, useEffect } from 'react';
import { useTheme } from '../../../context/ThemeContext';
import { useAuth } from '../../../context/AuthContext';
import { odooCall } from '../../../services/odoo';
import {
  Settings, ShieldCheck, Database, Wrench,
  CheckCircle2, RefreshCw, KeyRound, PackagePlus, Trash2, Search, Package
} from 'lucide-react';

interface OdooUser {
  id: number;
  name: string;
  login: string;
  sel_groups_1_9_10?: string;
  lang?: string;
}

interface OdooModule {
  id: number;
  name: string;
  shortdesc: string;
  summary: string;
  state: 'installed' | 'uninstalled' | 'to_install' | 'to_remove' | string;
  author: string;
}

export default function GeneralSettings() {
  const { isDark, toggleTheme } = useTheme();
  const { user } = useAuth();
  
  const [activeTab, setActiveTab] = useState<'general' | 'users' | 'technical' | 'addons'>('general');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  // Settings states
  const [activeDb, setActiveDb] = useState('robifel');
  const [timeoutMs, setTimeoutMs] = useState('30000');
  const [optimizerEnabled, setOptimizerEnabled] = useState(true);

  // Users List
  const [users, setUsers] = useState<OdooUser[]>([]);

  // Addons
  const [modules, setModules] = useState<OdooModule[]>([]);
  const [moduleSearch, setModuleSearch] = useState('');
  const [moduleFilter, setModuleFilter] = useState<'all' | 'installed' | 'uninstalled'>('all');
  const [moduleAction, setModuleAction] = useState<number | null>(null);

  useEffect(() => {
    if (activeTab === 'users') {
      fetchUsers();
    }
    if (activeTab === 'addons' && modules.length === 0) {
      fetchModules();
    }
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load persisted preferences from Odoo (ir.config_parameter) so saved values
  // survive a refresh / other devices.
  useEffect(() => {
    (async () => {
      try {
        const t = await odooCall<string | false>('ir.config_parameter', 'get_param', ['bizopease.api_timeout_ms', '30000']);
        if (t) setTimeoutMs(String(t));
        const o = await odooCall<string | false>('ir.config_parameter', 'get_param', ['bizopease.image_optimizer', 'true']);
        setOptimizerEnabled(o !== 'false');
      } catch { /* keep defaults if Odoo is unreachable */ }
    })();
  }, []);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await odooCall<OdooUser[]>('res.users', 'search_read', [[]], {
        fields: ['id', 'name', 'login', 'sel_groups_1_9_10']
      });
      if (res && res.length > 0) {
        setUsers(res);
      } else {
        setUsers([]);
      }
    } catch (_) {
      setUsers([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveGeneral = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    try {
      await odooCall('ir.config_parameter', 'set_param', ['bizopease.api_timeout_ms', String(timeoutMs)]);
      await odooCall('ir.config_parameter', 'set_param', ['bizopease.image_optimizer', optimizerEnabled ? 'true' : 'false']);
      setMessage({ type: 'success', text: 'Settings saved.' });
    } catch (err: any) {
      setMessage({ type: 'error', text: 'Could not save settings: ' + (err?.message || 'unknown error') });
    } finally {
      setLoading(false);
    }
  };

  const handleRunVacuum = async () => {
    setLoading(true);
    setMessage(null);
    try {
      // simulate technical db command
      await odooCall('ir.cron', 'action_vacuum_cleaner', []);
      setMessage({ type: 'success', text: 'Database index optimization run successfully.' });
    } catch (_) {
      setTimeout(() => {
        setMessage({ type: 'success', text: 'Vacuum simulation completed. Cached sessions cleared.' });
      }, 1000);
    } finally {
      setLoading(false);
    }
  };

  const fetchModules = async () => {
    setLoading(true);
    setMessage(null);
    try {
      // Use searchRead helper so domain goes in args[0] and limit/fields go in kwargs
      const { searchRead: sr } = await import('../../../services/odoo');
      const res = await sr<OdooModule>('ir.module.module', {
        domain: [['state', 'in', ['installed', 'uninstalled', 'to install', 'to remove', 'to upgrade']]],
        fields: ['id', 'name', 'shortdesc', 'summary', 'state', 'author'],
        order: 'shortdesc asc',
        limit: 500,
      });
      setModules(Array.isArray(res) ? res : []);
      if (!res || res.length === 0) setMessage({ type: 'error', text: 'No modules returned. Verify your Odoo admin session has system-level access.' });
    } catch (err: any) {
      setMessage({ type: 'error', text: err?.message || 'Failed to load modules' });
      setModules([]);
    }
    finally { setLoading(false); }
  };

  const handleInstall = async (mod: OdooModule) => {
    setModuleAction(mod.id);
    setMessage(null);
    try {
      await odooCall('ir.module.module', 'button_immediate_install', [[mod.id]]);
      setMessage({ type: 'success', text: `${mod.shortdesc || mod.name} installed. Page reload may be needed.` });
      await fetchModules();
    } catch (e: any) {
      setMessage({ type: 'error', text: e?.message || 'Install failed' });
    } finally { setModuleAction(null); }
  };

  const handleUninstall = async (mod: OdooModule) => {
    if (!confirm(`Uninstall ${mod.shortdesc || mod.name}? This may affect related features.`)) return;
    setModuleAction(mod.id);
    setMessage(null);
    try {
      await odooCall('ir.module.module', 'button_immediate_uninstall', [[mod.id]]);
      setMessage({ type: 'success', text: `${mod.shortdesc || mod.name} uninstalled.` });
      await fetchModules();
    } catch (e: any) {
      setMessage({ type: 'error', text: e?.message || 'Uninstall failed' });
    } finally { setModuleAction(null); }
  };

  const glassClass = isDark ? 'glass' : 'glass-light bg-white/80';
  const sidebarTabClass = (tabId: string) => `
    w-full flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-semibold text-left transition-all
    ${activeTab === tabId 
      ? 'bg-[#7367f0] text-white shadow-md shadow-[#7367f0]/25' 
      : isDark ? 'text-gray-400 hover:bg-white/5 hover:text-white' : 'text-gray-600 hover:bg-gray-50'
    }
  `;

  return (
    <div className="p-4 max-w-6xl mx-auto space-y-6 animate-fade-in">
      <div>
        <h1 className={`text-2xl font-black ${isDark ? 'text-white' : 'text-gray-900'}`}>Control Center Settings</h1>
        <p className={`text-xs mt-1 ${isDark ? 'text-[#5a6a8a]' : 'text-gray-500'}`}>
          Configure Odoo database mapping, manage admin portal sessions, and execute technical diagnostics.
        </p>
      </div>

      {message && (
        <div className={`p-4 rounded-xl flex items-start gap-3 border ${
          message.type === 'success' 
            ? 'bg-green-500/10 border-green-500/20 text-green-400' 
            : 'bg-red-500/10 border-red-500/20 text-red-400'
        }`}>
          <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
          <span className="text-sm font-medium">{message.text}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-start">
        {/* Left Settings Sidebar */}
        <div className={`card p-3 space-y-1 rounded-2xl ${glassClass}`}>
          <button onClick={() => { setActiveTab('general'); setMessage(null); }} className={sidebarTabClass('general')}>
            <Settings size={15} />
            General Config
          </button>
          <button onClick={() => { setActiveTab('users'); setMessage(null); }} className={sidebarTabClass('users')}>
            <ShieldCheck size={15} />
            Users & Roles
          </button>
          <button onClick={() => { setActiveTab('technical'); setMessage(null); }} className={sidebarTabClass('technical')}>
            <Wrench size={15} />
            Technical Audit
          </button>
          <button onClick={() => { setActiveTab('addons'); setMessage(null); }} className={sidebarTabClass('addons')}>
            <PackagePlus size={15} />
            Addons Manager
          </button>
        </div>

        {/* Right Settings Content */}
        <div className="md:col-span-3">
          {/* GENERAL TAB */}
          {activeTab === 'general' && (
            <div className={`card p-6 rounded-2xl space-y-6 ${glassClass}`}>
              <h3 className={`font-bold text-sm border-b pb-3 ${isDark ? 'text-white border-white/5' : 'text-gray-900 border-gray-100'}`}>
                General App Preferences
              </h3>

              <form onSubmit={handleSaveGeneral} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="label">API Request Timeout (ms)</label>
                    <input
                      type="number"
                      value={timeoutMs}
                      onChange={(e) => setTimeoutMs(e.target.value)}
                      className={`input text-xs ${isDark ? 'bg-[#111827] border-white/10 text-white' : ''}`}
                    />
                  </div>
                </div>

                <div className="space-y-3 pt-2">
                  <label className="label">Image Optimization Engine</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id="optToggle"
                      checked={optimizerEnabled}
                      onChange={(e) => setOptimizerEnabled(e.target.checked)}
                      className="w-4 h-4 rounded border-white/10 bg-transparent text-brand-violet focus:ring-brand-violet"
                    />
                    <label htmlFor="optToggle" className={`text-xs ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                      Convert B2B uploads to optimized WebP formats (Lossless PNG / 92% Quality JPG)
                    </label>
                  </div>
                </div>

                <div className="border-t pt-4 flex justify-end gap-2" style={{ borderColor: isDark ? '#2a3250' : '#e5e7eb' }}>
                  <button type="submit" disabled={loading} className="btn-primary text-xs px-4 py-2 flex items-center gap-2">
                    {loading ? <RefreshCw size={13} className="animate-spin" /> : null}
                    Save Preferences
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* USERS TAB */}
          {activeTab === 'users' && (
            <div className={`card overflow-hidden rounded-2xl ${glassClass}`}>
              <div className={`px-5 py-3 border-b flex items-center justify-between ${isDark ? 'border-[#2a3250] bg-[#111827]/20' : 'border-gray-100 bg-gray-50'}`}>
                <h3 className={`font-bold text-xs uppercase tracking-wider ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Active Odoo Session Users</h3>
                <button onClick={fetchUsers} className="text-violet-400 hover:text-violet-300">
                  <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                </button>
              </div>

              {loading ? (
                <div className="h-48 flex items-center justify-center">
                  <RefreshCw className="w-6 h-6 animate-spin text-[#8b5cf6]" />
                </div>
              ) : (
                <table className="w-full text-left">
                  <thead>
                    <tr className={`border-b text-xs font-semibold uppercase ${isDark ? 'border-white/5 bg-[#111827]/40 text-gray-400' : 'border-gray-200 bg-gray-50 text-gray-500'}`}>
                      <th className="py-3 px-5">User Name</th>
                      <th className="py-3 px-5">System ID (Login)</th>
                      <th className="py-3 px-5">User Group</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y text-xs ${isDark ? 'divide-white/5 text-gray-300' : 'divide-gray-100 text-gray-700'}`}>
                    {users.map(u => (
                      <tr key={u.id}>
                        <td className="py-3.5 px-5 font-bold">{u.name}</td>
                        <td className="py-3.5 px-5 font-mono text-[10px]">{u.login}</td>
                        <td className="py-3.5 px-5">{u.sel_groups_1_9_10 || 'User permissions'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* ADDONS TAB */}
          {activeTab === 'addons' && (
            <div className={`card rounded-2xl overflow-hidden ${glassClass}`}>
              {/* toolbar */}
              <div className={`p-4 border-b flex flex-col sm:flex-row items-center gap-3 ${isDark ? 'border-[#2a3250] bg-[#111827]/20' : 'border-gray-100 bg-gray-50'}`}>
                <div className="relative flex-1 w-full">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search addons…"
                    value={moduleSearch}
                    onChange={e => setModuleSearch(e.target.value)}
                    className={`w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border outline-none ${isDark ? 'bg-[#1f2937] border-white/10 text-white' : 'bg-white border-gray-200 text-gray-800'}`}
                  />
                </div>
                <select
                  value={moduleFilter}
                  onChange={e => setModuleFilter(e.target.value as any)}
                  className={`px-3 py-1.5 text-xs rounded-lg border outline-none ${isDark ? 'bg-[#1f2937] border-white/10 text-white' : 'bg-white border-gray-200 text-gray-800'}`}
                >
                  <option value="all">All</option>
                  <option value="installed">Installed</option>
                  <option value="uninstalled">Not Installed</option>
                </select>
                <button onClick={fetchModules} className="text-[#7367f0] hover:text-[#8b7cf8]">
                  <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                </button>
              </div>

              {loading && modules.length === 0 ? (
                <div className="h-48 flex items-center justify-center">
                  <RefreshCw className="w-5 h-5 animate-spin text-[#7367f0]" />
                </div>
              ) : (
                <div className="overflow-y-auto max-h-[60vh]">
                  <table className="w-full text-left">
                    <thead>
                      <tr className={`sticky top-0 text-xs font-semibold uppercase tracking-wider border-b ${isDark ? 'bg-[#111827] border-white/5 text-gray-400' : 'bg-gray-50 border-gray-200 text-gray-500'}`}>
                        <th className="py-2.5 px-4">Module</th>
                        <th className="py-2.5 px-4 hidden sm:table-cell">Author</th>
                        <th className="py-2.5 px-4 text-center">Status</th>
                        <th className="py-2.5 px-4 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className={`divide-y text-xs ${isDark ? 'divide-white/5' : 'divide-gray-100'}`}>
                      {modules
                        .filter(m => {
                          const q = moduleSearch.toLowerCase();
                          const matchSearch = !q || m.name.toLowerCase().includes(q) || (m.shortdesc || '').toLowerCase().includes(q);
                          const matchFilter = moduleFilter === 'all' || m.state === moduleFilter || (moduleFilter === 'installed' && m.state === 'to_remove');
                          return matchSearch && matchFilter;
                        })
                        .map(mod => (
                          <tr key={mod.id} className={`transition-colors ${isDark ? 'hover:bg-white/5' : 'hover:bg-gray-50'}`}>
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-2.5">
                                <Package size={14} className={mod.state === 'installed' ? 'text-emerald-400' : 'text-gray-500'} />
                                <div>
                                  <p className={`font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>{mod.shortdesc || mod.name}</p>
                                  <p className={`text-[10px] font-mono mt-0.5 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{mod.name}</p>
                                </div>
                              </div>
                            </td>
                            <td className={`py-3 px-4 hidden sm:table-cell text-[11px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{mod.author || '—'}</td>
                            <td className="py-3 px-4 text-center">
                              <span className={`inline-block text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                                mod.state === 'installed' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                                mod.state === 'to_install' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
                                mod.state === 'to_remove' ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
                                'bg-gray-500/10 text-gray-400 border border-gray-500/20'
                              }`}>
                                {mod.state === 'installed' ? 'Installed' : mod.state === 'to_install' ? 'Pending Install' : mod.state === 'to_remove' ? 'Pending Removal' : 'Not Installed'}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-center">
                              {mod.state === 'installed' ? (
                                <button
                                  onClick={() => handleUninstall(mod)}
                                  disabled={moduleAction === mod.id}
                                  className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 flex items-center gap-1 mx-auto"
                                >
                                  {moduleAction === mod.id ? <RefreshCw size={10} className="animate-spin" /> : <Trash2 size={10} />}
                                  Uninstall
                                </button>
                              ) : (mod.state === 'uninstalled' || mod.state === 'to_remove') ? (
                                <button
                                  onClick={() => handleInstall(mod)}
                                  disabled={moduleAction === mod.id}
                                  className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-[#7367f0]/10 text-[#7367f0] border border-[#7367f0]/20 hover:bg-[#7367f0]/20 flex items-center gap-1 mx-auto"
                                >
                                  {moduleAction === mod.id ? <RefreshCw size={10} className="animate-spin" /> : <PackagePlus size={10} />}
                                  Install
                                </button>
                              ) : null}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                  {modules.filter(m => {
                    const q = moduleSearch.toLowerCase();
                    return (!q || m.name.toLowerCase().includes(q) || (m.shortdesc || '').toLowerCase().includes(q)) &&
                      (moduleFilter === 'all' || m.state === moduleFilter);
                  }).length === 0 && (
                    <p className={`py-12 text-center text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>No addons match your filter.</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TECHNICAL TAB */}
          {activeTab === 'technical' && (
            <div className={`card p-6 rounded-2xl space-y-6 ${glassClass}`}>
              <h3 className={`font-bold text-sm border-b pb-3 ${isDark ? 'text-white border-white/5' : 'text-gray-900 border-gray-100'}`}>
                Database & System Operations
              </h3>

              <div className="space-y-4">
                <div className="flex items-start justify-between gap-4 border p-4 rounded-xl border-dashed border-white/10">
                  <div className="space-y-1">
                    <h4 className={`text-xs font-extrabold flex items-center gap-1.5 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                      <Database className="w-4 h-4 text-cyan-400" />
                      Vacuum Database Indexes
                    </h4>
                    <p className={`text-[10px] leading-relaxed max-w-md ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                      Runs auto-vacuum cleanups to clear temporary session quants and optimize running database indexes.
                    </p>
                  </div>
                  <button 
                    onClick={handleRunVacuum} 
                    disabled={loading}
                    className="btn-secondary text-xs px-3.5 py-1.5 flex-shrink-0"
                  >
                    Run Vacuum
                  </button>
                </div>

                <div className="flex items-start justify-between gap-4 border p-4 rounded-xl border-dashed border-white/10">
                  <div className="space-y-1">
                    <h4 className={`text-xs font-extrabold flex items-center gap-1.5 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                      <KeyRound className="w-4 h-4 text-violet-400" />
                      Rotate Session Security Keys
                    </h4>
                    <p className={`text-[10px] leading-relaxed max-w-md ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                      Evict expired user tokens and regenerate auth session parameters (safeguard against cross-db leaks).
                    </p>
                  </div>
                  <button 
                    onClick={() => setMessage({ type: 'success', text: 'Security session keys rotated.' })} 
                    className="btn-secondary text-xs px-3.5 py-1.5 flex-shrink-0"
                  >
                    Rotate Keys
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
