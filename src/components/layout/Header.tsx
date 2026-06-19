import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import {
  Menu, Sun, Moon, Bell, Search, ChevronDown,
  User, Settings, LogOut, HelpCircle, X, Maximize2,
  RefreshCw, Database
} from 'lucide-react';

interface HeaderProps {
  onMenuToggle: () => void;
}


export default function Header({ onMenuToggle }: HeaderProps) {
  const { isDark, toggleTheme } = useTheme();
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const prefixPath = (path: string) => {
    if (path === '#') return '#';
    const db = user?.db || 'robifel';
    return `/${db}${path}`;
  };

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [notifOpen, setNotifOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [notifications, setNotifications] = useState<{ id: number; type: string; message: string; time: string; read: boolean; color: string }[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);

  const unreadCount = notifications.filter(n => !n.read).length;

  // Ctrl+K to open search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(true);
        setTimeout(() => searchRef.current?.focus(), 100);
      }
      if (e.key === 'Escape') {
        setSearchOpen(false);
        setNotifOpen(false);
        setUserOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const markAllRead = () => setNotifications(prev => prev.map(n => ({ ...n, read: true })));

  const colorMap: Record<string, string> = {
    violet: 'bg-violet-500/20 text-violet-400',
    amber: 'bg-amber-500/20 text-amber-400',
    red: 'bg-red-500/20 text-red-400',
    green: 'bg-green-500/20 text-green-400',
    blue: 'bg-blue-500/20 text-blue-400',
  };

  const headerBg = isDark
    ? 'bg-[#0f1422]/95 border-[#2a3250]'
    : 'bg-white/95 border-gray-200';

  const dropdownBg = isDark
    ? 'bg-[#1e2440] border-[#2a3250]'
    : 'bg-white border-gray-200 shadow-lg';

  return (
    <>
      {/* Search Modal */}
      {searchOpen && (
        <div className="fixed inset-0 z-[999] flex items-start justify-center pt-[15vh] px-4"
          style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}
          onClick={() => setSearchOpen(false)}
        >
          <div
            className={`w-full max-w-2xl rounded-2xl border shadow-2xl overflow-hidden ${isDark ? 'bg-[#1e2440] border-[#2a3250]' : 'bg-white border-gray-200'}`}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 p-4 border-b" style={{ borderColor: isDark ? '#2a3250' : '#e5e7eb' }}>
              <Search size={18} className="text-[#7367f0]" />
              <input
                ref={searchRef}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search modules, records, actions..."
                className={`flex-1 bg-transparent outline-none text-sm font-medium ${isDark ? 'text-white placeholder:text-[#4a5580]' : 'text-gray-900 placeholder:text-gray-400'}`}
                autoFocus
              />
              <button onClick={() => setSearchOpen(false)}
                className={`p-1 rounded-lg ${isDark ? 'hover:bg-white/10 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}>
                <X size={16} />
              </button>
            </div>
            <div className="p-3 space-y-1">
              {[
                { label: 'Dashboard', path: '/dashboard', icon: '📊' },
                { label: 'Sales Orders', path: '/sales/orders', icon: '🛒' },
                { label: 'Inventory Products', path: '/inventory/products', icon: '📦' },
                { label: 'Customer Invoices', path: '/accounting/invoices', icon: '🧾' },
                { label: 'FBF Replenishment', path: '/flipkart/fbf', icon: '⚡' },
                { label: 'Settlements Console', path: '/settlements/vendors', icon: '💰' },
              ].filter(i => !searchQuery || i.label.toLowerCase().includes(searchQuery.toLowerCase()))
                .map(item => (
                  <button key={item.path}
                    onClick={() => { navigate(prefixPath(item.path)); setSearchOpen(false); }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all ${isDark ? 'hover:bg-white/5 text-gray-300' : 'hover:bg-gray-50 text-gray-700'}`}
                  >
                    <span>{item.icon}</span>
                    <span>{item.label}</span>
                  </button>
                ))}
            </div>
            <div className={`px-4 py-2 border-t text-[10px] flex gap-4 ${isDark ? 'border-[#2a3250] text-[#4a5580]' : 'border-gray-100 text-gray-400'}`}>
              <span>↵ to navigate</span><span>ESC to close</span><span>Ctrl+K to search</span>
            </div>
          </div>
        </div>
      )}

      <header className={`h-[64px] flex items-center justify-between px-4 md:px-6 border-b backdrop-blur-md sticky top-0 z-30 ${headerBg}`}>
        {/* Left: Menu + breadcrumb */}
        <div className="flex items-center gap-3">
          <button
            onClick={onMenuToggle}
            className={`p-2 rounded-xl transition-colors lg:hidden ${isDark ? 'hover:bg-white/5 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}
          >
            <Menu size={20} />
          </button>

          {/* Search trigger */}
          <button
            onClick={() => setSearchOpen(true)}
            className={`hidden md:flex items-center gap-2 px-3 py-2 rounded-xl border text-sm transition-all ${isDark ? 'border-[#2a3250] text-[#6a7a9a] bg-[#1e2440]/50 hover:border-[#7367f0]/50' : 'border-gray-200 text-gray-400 bg-gray-50 hover:border-violet-300'}`}
          >
            <Search size={15} />
            <span className="text-xs">Quick search...</span>
            <kbd className={`ml-6 text-[10px] px-1.5 py-0.5 rounded border font-mono ${isDark ? 'border-[#3a4a6a] bg-[#12172a] text-[#5a6a8a]' : 'border-gray-200 bg-white text-gray-400'}`}>
              Ctrl+K
            </kbd>
          </button>
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-1 md:gap-2">
          {/* DB indicator */}
          <div className={`hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ${isDark ? 'bg-[#1e2440] text-[#7367f0] border border-[#2a3250]' : 'bg-violet-50 text-violet-600 border border-violet-100'}`}>
            <Database size={12} />
            <span>{user?.db || 'robifel'}</span>
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          </div>

          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className={`p-2 rounded-xl transition-all ${isDark ? 'hover:bg-white/5 text-amber-400' : 'hover:bg-gray-100 text-violet-600'}`}
            title="Toggle theme"
          >
            {isDark ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          {/* Notifications */}
          <div className="relative">
            <button
              onClick={() => { setNotifOpen(p => !p); setUserOpen(false); }}
              className={`relative p-2 rounded-xl transition-all ${isDark ? 'hover:bg-white/5 text-gray-400 hover:text-white' : 'hover:bg-gray-100 text-gray-500'}`}
            >
              <Bell size={18} />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 w-4 h-4 bg-[#7367f0] rounded-full text-[9px] font-bold text-white flex items-center justify-center">
                  {unreadCount}
                </span>
              )}
            </button>

            {notifOpen && (
              <div className={`absolute right-0 top-full mt-2 w-72 sm:w-80 max-w-[calc(100vw-1rem)] rounded-2xl border shadow-2xl overflow-hidden z-50 ${dropdownBg}`}>
                <div className={`px-4 py-3 border-b flex items-center justify-between ${isDark ? 'border-[#2a3250]' : 'border-gray-100'}`}>
                  <p className={`font-bold text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>Notifications</p>
                  {notifications.some(n => !n.read) && (
                    <button onClick={markAllRead} className="text-[11px] text-[#7367f0] font-semibold hover:underline">
                      Mark all read
                    </button>
                  )}
                </div>
                <div className="divide-y max-h-80 overflow-y-auto" style={{ borderColor: isDark ? '#2a3250' : '#f3f4f6' }}>
                  {notifications.length === 0 ? (
                    <div className={`flex flex-col items-center justify-center py-10 gap-2 ${isDark ? 'text-[#4a5580]' : 'text-gray-400'}`}>
                      <Bell size={28} className="opacity-30" />
                      <p className="text-xs font-medium">No notifications</p>
                    </div>
                  ) : notifications.map(n => (
                    <div key={n.id} className={`px-4 py-3 flex gap-3 transition-colors cursor-pointer ${n.read ? '' : isDark ? 'bg-[#7367f0]/5' : 'bg-violet-50/50'} ${isDark ? 'hover:bg-white/5' : 'hover:bg-gray-50'}`}>
                      <div className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs ${colorMap[n.color]}`}>
                        <Bell size={14} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs leading-snug ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>{n.message}</p>
                        <p className={`text-[10px] mt-1 ${isDark ? 'text-[#4a5580]' : 'text-gray-400'}`}>{n.time}</p>
                      </div>
                      {!n.read && <span className="w-2 h-2 rounded-full bg-[#7367f0] flex-shrink-0 mt-1" />}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* User menu */}
          <div className="relative">
            <button
              onClick={() => { setUserOpen(p => !p); setNotifOpen(false); }}
              className={`flex items-center gap-2 px-2 py-1.5 rounded-xl transition-all ${isDark ? 'hover:bg-white/5' : 'hover:bg-gray-100'}`}
            >
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#7367f0] to-[#3d5af1] flex items-center justify-center text-white text-sm font-bold">
                {user?.name?.[0]?.toUpperCase() || 'A'}
              </div>
              <div className="hidden md:block text-left">
                <p className={`text-xs font-semibold leading-none ${isDark ? 'text-white' : 'text-gray-900'}`}>{user?.name || 'Admin'}</p>
                <p className={`text-[10px] mt-0.5 ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>{user?.email || 'admin@robifel.in'}</p>
              </div>
              <ChevronDown size={14} className={isDark ? 'text-[#5a6a8a]' : 'text-gray-400'} />
            </button>

            {userOpen && (
              <div className={`absolute right-0 top-full mt-2 w-56 rounded-2xl border shadow-2xl overflow-hidden z-50 ${dropdownBg}`}>
                <div className={`px-4 py-3 border-b ${isDark ? 'border-[#2a3250]' : 'border-gray-100'}`}>
                  <p className={`font-semibold text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>{user?.name}</p>
                  <p className={`text-xs mt-0.5 ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>{user?.email}</p>
                </div>
                <div className="py-1">
                  {[
                    { icon: User, label: 'My Profile', path: '/settings/profile' },
                    ...(user?.is_admin ? [{ icon: Settings, label: 'Settings', path: '/settings/general' }] : []),
                    { icon: HelpCircle, label: 'Help & Docs', path: '#' },
                  ].map(item => (
                    <button
                      key={item.label}
                      onClick={() => { navigate(prefixPath(item.path)); setUserOpen(false); }}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${isDark ? 'text-gray-300 hover:bg-white/5' : 'text-gray-600 hover:bg-gray-50'}`}
                    >
                      <item.icon size={15} className={isDark ? 'text-[#5a6a8a]' : 'text-gray-400'} />
                      {item.label}
                    </button>
                  ))}
                  <div className={`border-t my-1 ${isDark ? 'border-[#2a3250]' : 'border-gray-100'}`} />
                  <button
                    onClick={() => { logout(); setUserOpen(false); }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    <LogOut size={15} />
                    Sign Out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>
    </>
  );
}
