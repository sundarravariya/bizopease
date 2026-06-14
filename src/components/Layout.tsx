import React, { useState } from 'react';
import { 
  BarChart2, 
  ScanLine, 
  TrendingUp, 
  AlertTriangle, 
  DollarSign, 
  MessageSquare, 
  Menu, 
  X,
  LogOut
} from 'lucide-react';

interface LayoutProps {
  children: React.ReactNode;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  user: any;
  onLogout: () => void;
  onOpenAi: () => void;
}

export default function Layout({ children, activeTab, setActiveTab, user, onLogout, onOpenAi }: LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const menuItems = [
    { id: 'fbf', label: 'FBF Replenishment', icon: TrendingUp },
    { id: 'scanner', label: 'BOM Scanner Console', icon: ScanLine },
    { id: 'supplier', label: 'Supplier Pipeline', icon: BarChart2 },
    { id: 'deadstock', label: 'Dead Stock Analysis', icon: AlertTriangle },
    { id: 'settlements', label: 'Settlements & Ledgers', icon: DollarSign },
  ];

  return (
    <div className="min-h-screen bg-[#0b0c10] flex text-gray-200">
      {/* Mobile sidebar overlay backdrop */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden transition-opacity duration-300"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar Navigation */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-72 bg-[#1f2937]/90 backdrop-blur-md border-r border-white/5 
        flex flex-col transform transition-transform duration-300 ease-in-out lg:translate-x-0 lg:static lg:h-screen
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        {/* Header logo / title */}
        <div className="h-20 border-b border-white/5 flex items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-brand-violet to-brand-blue flex items-center justify-center font-bold text-lg text-white shadow-lg">
              R
            </div>
            <div>
              <span className="font-bold text-white tracking-wide block">Robifel</span>
              <span className="text-xs text-brand-blue font-semibold tracking-wider uppercase">Flipkart OS</span>
            </div>
          </div>
          <button 
            className="lg:hidden p-1.5 rounded-lg hover:bg-white/5 text-gray-400 hover:text-white"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation links */}
        <nav className="flex-1 px-4 py-6 space-y-1.5 overflow-y-auto">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setActiveTab(item.id);
                  setSidebarOpen(false);
                }}
                className={`
                  w-full flex items-center gap-3.5 px-4 py-3.5 rounded-xl text-sm font-medium tracking-wide transition-all duration-200
                  ${active 
                    ? 'bg-gradient-to-r from-brand-violet/20 to-brand-blue/10 border border-brand-violet/35 text-white shadow-inner shadow-brand-violet/5' 
                    : 'text-gray-400 hover:bg-white/5 hover:text-white border border-transparent'}
                `}
              >
                <Icon className={`w-5 h-5 ${active ? 'text-brand-blue' : 'text-gray-400'}`} />
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* User profile / bottom actions */}
        <div className="p-4 border-t border-white/5 bg-[#111827]/40 flex flex-col gap-3">
          <div className="flex items-center gap-3 px-2">
            <div className="w-9 h-9 rounded-full bg-brand-violet/20 border border-brand-violet/40 flex items-center justify-center font-bold text-brand-blue text-sm">
              {user?.name?.[0]?.toUpperCase() || 'U'}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-white truncate">{user?.name || 'Authorized User'}</p>
              <p className="text-xs text-gray-500 truncate">{user?.username || 'admin@robifel.in'}</p>
            </div>
          </div>
          
          <div className="flex gap-2">
            <button 
              onClick={onOpenAi}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-semibold bg-gradient-to-r from-brand-violet to-brand-blue text-white shadow-lg shadow-brand-violet/15 hover:brightness-110 transition-all"
            >
              <MessageSquare className="w-4 h-4" />
              AI Chat
            </button>
            <button 
              onClick={onLogout}
              className="px-3 py-2.5 rounded-xl border border-white/10 hover:bg-white/5 text-gray-400 hover:text-red-400 hover:border-red-400/20 transition-all"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Pane */}
      <div className="flex-1 flex flex-col lg:h-screen lg:overflow-hidden">
        {/* Header for mobile view menu trigger */}
        <header className="h-16 border-b border-white/5 px-6 flex items-center justify-between lg:hidden bg-[#1f2937]/50 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <button 
              className="p-2 -ml-2 rounded-lg hover:bg-white/5 text-gray-400 hover:text-white"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="w-6 h-6" />
            </button>
            <span className="font-bold text-white tracking-wide">Robifel Flipkart OS</span>
          </div>
          <button 
            onClick={onOpenAi}
            className="p-2 rounded-lg bg-brand-violet/20 text-brand-blue border border-brand-violet/40"
          >
            <MessageSquare className="w-5 h-5" />
          </button>
        </header>

        {/* Content Area */}
        <main className="flex-1 overflow-y-auto lg:h-[calc(100vh-4rem)]">
          {children}
        </main>
      </div>
    </div>
  );
}
