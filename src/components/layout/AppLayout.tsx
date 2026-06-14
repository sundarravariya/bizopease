import React, { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Menu } from 'lucide-react';
import Sidebar from './Sidebar';
import Header from './Header';
import WorkHoursGate from '../WorkHoursGate';
import { useTheme } from '../../context/ThemeContext';

// Routes that render as full-screen phone-style apps (no desktop top bar / outer padding)
const BARE_ROUTES = ['/settlements/studio', '/settlements/expenses', '/tasks'];

export default function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { isDark } = useTheme();
  const { pathname } = useLocation();
  // Routes are workspace-prefixed (/:workspace/settlements/studio), so match by suffix.
  const bare = BARE_ROUTES.some(r => pathname.endsWith(r) || pathname.includes(r + '/'));

  return (
    <WorkHoursGate>
    <div className={`flex h-screen overflow-hidden ${isDark ? 'bg-[#0f1422]' : 'bg-[#f8f9fc]'}`}>
      {/* Sidebar */}
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {!bare && <Header onMenuToggle={() => setSidebarOpen(p => !p)} />}

        {/* Page content area */}
        <main className="flex-1 overflow-y-auto relative">
          {/* Bare pages drop the header, so on mobile (sidebar isn't static < lg)
              we still need a way to open the menu drawer. */}
          {bare && !sidebarOpen && (
            <button
              onClick={() => setSidebarOpen(true)}
              aria-label="Open menu"
              className={`lg:hidden fixed top-3 left-3 z-[60] p-2 rounded-xl backdrop-blur-md transition-colors ${isDark ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-black/20 text-white hover:bg-black/30'}`}
            >
              <Menu size={20} />
            </button>
          )}
          <div className={bare ? 'pt-14 lg:pt-0' : 'p-4 md:p-6 max-w-[1600px] mx-auto'}>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
    </WorkHoursGate>
  );
}
