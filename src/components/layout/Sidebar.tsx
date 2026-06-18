import React, { useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { searchRead } from '../../services/odoo';
import { BRAND, companyName, brandInitial } from '../../config/brand';

// Which Odoo module each menu id needs. Items not listed always show.
const MODULE_BY_ID: Record<string, string> = {
  'money-manager': 'flipkart_os', 'tasks': 'flipkart_os', 'consignments': 'flipkart_os',
  'scanner': 'flipkart_os', 'returns': 'flipkart_os', 'create-entry': 'flipkart_os',
  'flipkart-os': 'flipkart_os', 'settlements': 'flipkart_os',
  'sales': 'sale_management', 'purchase': 'purchase', 'inventory': 'stock',
  'accounting': 'account', 'crm': 'crm', 'hr': 'hr', 'b2b': 'b2b_os',
  'attendance': 'robifel_hr', 'salary': 'robifel_hr', 'live-map': 'robifel_hr',
  'kiosk': 'robifel_hr', 'hr-settings': 'robifel_hr',
};
import {
  LayoutDashboard, ShoppingCart, Package, Warehouse,
  DollarSign, Users, Settings, ChevronDown, ChevronRight,
  Zap, BarChart2, TrendingUp, TrendingDown, AlertTriangle, Truck,
  FileText, UserCheck, Brain, Globe, PieChart,
  RefreshCcw, ScanLine, PackageSearch, CreditCard,
  Building2, Receipt, ClipboardList, Contact2,
  CalendarDays, Briefcase, GitPullRequest, Layers,
  BookOpen, Wrench, ShieldCheck, Bell, X,
  Upload, Settings2, Activity, PlusCircle, ListChecks, Trophy, Package
} from 'lucide-react';

interface NavItem {
  id: string;
  label: string;
  icon?: React.ElementType;
  path?: string;
  badge?: string | number;
  badgeColor?: string;
  children?: NavItem[];
  dividerBefore?: boolean;
  groupLabel?: string;
  /** Odoo module(s) that must be installed for this item to appear. Omit = always show. */
  module?: string | string[];
}

const NAV_ITEMS: NavItem[] = [
  // ─── MAIN — daily drivers ───────────────────
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    path: '/dashboard',
    groupLabel: 'MAIN',
  },
  {
    id: 'money-manager',
    label: 'Money Manager',
    icon: CreditCard,
    path: '/settlements/studio',
  },
  {
    id: 'tasks',
    label: 'Tasks',
    icon: ListChecks,
    path: '/tasks',
    badge: 'New',
    badgeColor: 'violet',
  },
  {
    id: 'consignments',
    label: 'Consignments',
    icon: PackageSearch,
    path: '/flipkart/consignments',
  },
  {
    id: 'scanner',
    label: 'Daily Orders',
    icon: ScanLine,
    path: '/flipkart/scanner',
  },
  {
    id: 'returns',
    label: 'Returns',
    icon: RefreshCcw,
    path: '/flipkart/returns',
  },
  // ─── OPERATIONS — Flipkart Business OS ───────
  {
    id: 'create-entry',
    label: 'Create Entry',
    icon: PlusCircle,
    path: '/flipkart/create-entry',
    groupLabel: 'OPERATIONS',
    badge: 'QUICK',
    badgeColor: 'violet',
  },
  {
    id: 'flipkart-os',
    label: 'Business OS',
    icon: Zap,
    badge: 'NEW',
    badgeColor: 'violet',
    children: [
      { id: 'fbf-stock', label: 'FBF Live Stock', icon: Activity, path: '/flipkart/fbf-stock' },
      { id: 'fbf', label: 'FBF Replenishment', icon: TrendingUp, path: '/flipkart/fbf' },
      { id: 'deadstock', label: 'Dead Stock', icon: AlertTriangle, path: '/flipkart/deadstock' },
      { id: 'supplier-reorder', label: 'Supplier Reorders', icon: RefreshCcw, path: '/flipkart/supplier' },
      { id: 'sales-dash', label: 'Sales Dashboard', icon: BarChart2, path: '/flipkart/sales-dashboard' },
      { id: 'sales-reports', label: 'Sales Reports', icon: TrendingDown, path: '/flipkart/sales-reports' },
      { id: 'valuation', label: 'Stock Valuation', icon: DollarSign, path: '/flipkart/valuation' },
      { id: 'listings', label: 'Listings Master', icon: Layers, path: '/flipkart/listings' },
      { id: 'ledger', label: 'Unified Ledger', icon: BookOpen, path: '/flipkart/ledger' },
      { id: 'upload', label: 'Upload Center', icon: Upload, path: '/flipkart/upload' },
      { id: 'quick-sale', label: 'Quick Sale Order', icon: ShoppingCart, path: '/flipkart/quick-sale' },
      { id: 'fk-setup', label: 'Setup & Master Data', icon: Settings2, path: '/flipkart/setup' },
    ],
  },
  // ─── MODULES — standard Odoo back-office ─────
  {
    id: 'sales',
    label: 'Sales',
    icon: ShoppingCart,
    groupLabel: 'MODULES',
    children: [
      { id: 'sales-orders', label: 'Sales Orders', icon: ClipboardList, path: '/sales/orders' },
      { id: 'quotations', label: 'Quotations', icon: FileText, path: '/sales/quotations' },
      { id: 'customers', label: 'Customers', icon: Contact2, path: '/sales/customers' },
    ],
  },
  {
    id: 'purchase',
    label: 'Purchase',
    icon: Package,
    children: [
      { id: 'po', label: 'Purchase Orders', icon: ClipboardList, path: '/purchase/orders' },
      { id: 'rfq', label: 'Requests for Quote', icon: FileText, path: '/purchase/rfq' },
      { id: 'vendors', label: 'Vendors', icon: Building2, path: '/purchase/vendors' },
      { id: 'price-list', label: 'Vendor Price List', icon: DollarSign, path: '/purchase/price-list' },
    ],
  },
  {
    id: 'inventory',
    label: 'Inventory',
    icon: Warehouse,
    children: [
      { id: 'products', label: 'Products', icon: PackageSearch, path: '/inventory/products' },
      { id: 'transfers', label: 'Transfers', icon: RefreshCcw, path: '/inventory/transfers' },
      { id: 'stock', label: 'Stock Report', icon: BarChart2, path: '/inventory/stock' },
      { id: 'reordering', label: 'Reordering Rules', icon: TrendingUp, path: '/inventory/reordering' },
    ],
  },
  {
    id: 'accounting',
    label: 'Accounting',
    icon: DollarSign,
    children: [
      { id: 'invoices', label: 'Customer Invoices', icon: Receipt, path: '/accounting/invoices' },
      { id: 'bills', label: 'Vendor Bills', icon: CreditCard, path: '/accounting/bills' },
      { id: 'journal', label: 'Journal Entries', icon: BookOpen, path: '/accounting/journal' },
      { id: 'reports', label: 'Financial Reports', icon: PieChart, path: '/accounting/reports' },
    ],
  },
  {
    id: 'crm',
    label: 'CRM',
    icon: GitPullRequest,
    children: [
      { id: 'pipeline', label: 'Pipeline', icon: Layers, path: '/crm/pipeline' },
      { id: 'leads', label: 'Leads', icon: Users, path: '/crm/leads' },
    ],
  },
  {
    id: 'hr',
    label: 'Human Resources',
    icon: Briefcase,
    children: [
      { id: 'employees', label: 'Employees', icon: UserCheck, path: '/hr/employees' },
      { id: 'attendance', label: 'Attendance', icon: CalendarDays, path: '/hr/attendance' },
      { id: 'salary', label: 'Salary', icon: DollarSign, path: '/hr/salary' },
      { id: 'live-map', label: 'Live Location', icon: Globe, path: '/hr/live-map' },
      { id: 'kiosk', label: 'Attendance Kiosk', icon: ScanLine, path: '/hr/kiosk' },
      { id: 'leaves', label: 'Time Off', icon: CalendarDays, path: '/hr/leaves' },
      { id: 'hr-settings', label: 'HR Settings', icon: Settings, path: '/hr/settings' },
    ],
  },
  // ─── PARTNERS & FINANCE ─────────────────────
  {
    id: 'b2b',
    label: 'B2B Portal',
    icon: Globe,
    groupLabel: 'PARTNERS & FINANCE',
    children: [
      { id: 'b2b-orders',    label: 'B2B Orders',       icon: ClipboardList, path: '/b2b/orders' },
      { id: 'b2b-customers', label: 'Customers',         icon: Users,         path: '/b2b/customers' },
      { id: 'b2b-invoices',  label: 'Invoices',          icon: Receipt,       path: '/b2b/invoices' },
      { id: 'b2b-stock',     label: 'Stock Availability',icon: Package,       path: '/b2b/stock' },
      { id: 'b2b-ledger',    label: 'Partner Ledger',    icon: BookOpen,      path: '/b2b/ledger' },
    ],
  },
  {
    id: 'settlements',
    label: 'Settlements',
    icon: CreditCard,
    children: [
      { id: 'settle-ledger',   label: 'Ledger',   icon: BookOpen, path: '/settlements/vendors' },
      { id: 'settle-expenses', label: 'Expenses', icon: Receipt,  path: '/settlements/expenses' },
    ],
  },
  // ─── ADMINISTRATION ─────────────────────────
  {
    id: 'ai',
    label: 'AI Assistant',
    icon: Brain,
    path: '/ai',
    groupLabel: 'ADMINISTRATION',
    badge: 'BETA',
    badgeColor: 'cyan',
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: Settings,
    children: [
      { id: 'general', label: 'General', icon: Wrench, path: '/settings/general' },
      { id: 'users', label: 'Users & Permissions', icon: ShieldCheck, path: '/settings/users' },
      { id: 'technical', label: 'Technical', icon: Settings, path: '/settings/technical' },
    ],
  },
];

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

// Employees see a focused workspace: their tasks, consignment operations, leaderboard.
const EMPLOYEE_NAV: NavItem[] = [
  { id: 'tasks', label: 'My Tasks', icon: ListChecks, path: '/tasks', groupLabel: 'WORKSPACE' },
  { id: 'consignments', label: 'Consignments', icon: PackageSearch, path: '/flipkart/consignments' },
  { id: 'daily-orders', label: 'Daily Orders', icon: ScanLine, path: '/flipkart/scanner' },
  { id: 'returns', label: 'Returns', icon: RefreshCcw, path: '/flipkart/returns' },
];

export default function Sidebar({ isOpen, onClose }: SidebarProps) {
  const { isDark } = useTheme();
  const { user } = useAuth();
  const location = useLocation();

  // Tenant module-awareness: hide menus whose Odoo module isn't installed in
  // this workspace's DB. null = not yet loaded -> show everything (no flicker).
  const [installed, setInstalled] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (!user?.is_admin) return;
    searchRead<{ name: string }>('ir.module.module', {
      domain: [['state', '=', 'installed']], fields: ['name'], limit: 0,
    }).then(mods => setInstalled(new Set((mods || []).map(m => m.name)))).catch(() => setInstalled(null));
  }, [user?.is_admin]);

  const hasModule = (id: string) => {
    const mod = MODULE_BY_ID[id];
    if (!mod || !installed) return true;            // unknown / not loaded -> show
    return installed.has(mod);
  };

  const prefixPath = (path?: string) => {
    if (!path) return undefined;
    const db = user?.db || 'robifel';
    return `/${db}${path}`;
  };

  const baseItems = user?.is_admin ? NAV_ITEMS : EMPLOYEE_NAV;
  const items = baseItems
    .filter(it => hasModule(it.id))
    .map(it => {
      const path = prefixPath(it.path);
      const children = it.children
        ? it.children.filter(c => hasModule(c.id)).map(c => ({ ...c, path: prefixPath(c.path) }))
        : undefined;
      return { ...it, path, children };
    })
    .filter(it => !it.children || it.children.length > 0 || !!it.path);
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    // Auto-open the group containing the active path
    const active = new Set<string>();
    items.forEach(item => {
      if (item.children?.some(c => location.pathname.startsWith(c.path || ''))) {
        active.add(item.id);
      }
    });
    return active;
  });

  const toggleGroup = (id: string) => {
    setOpenGroups(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const isChildActive = (item: NavItem) =>
    item.children?.some(c => location.pathname.startsWith(c.path || '')) ?? false;

  const badgeClass: Record<string, string> = {
    violet: 'bg-violet-500/20 text-violet-400 border border-violet-500/30',
    cyan: 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30',
    green: 'bg-green-500/20 text-green-400 border border-green-500/30',
    red: 'bg-red-500/20 text-red-400 border border-red-500/30',
  };

  let lastGroupLabel = '';

  return (
    <>
      {/* Backdrop for mobile */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar panel */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-50 w-72 flex flex-col
          transition-transform duration-300 ease-in-out
          lg:static lg:translate-x-0 lg:z-auto
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}
          ${isDark
            ? 'bg-[#12172a] border-r border-[#2a3250]'
            : 'bg-white border-r border-gray-200 shadow-sidebar'
          }
        `}
      >
        {/* Logo */}
        <div className={`h-[64px] flex items-center justify-between px-5 border-b ${isDark ? 'border-[#2a3250]' : 'border-gray-100'}`}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#7367f0] to-[#3d5af1] flex items-center justify-center shadow-glow-violet">
              <span className="text-white font-black text-base">{brandInitial(user?.company_name)}</span>
            </div>
            <div className="min-w-0">
              <p className={`font-bold text-sm leading-none truncate max-w-[140px] ${isDark ? 'text-white' : 'text-gray-900'}`}>{companyName(user?.company_name)}</p>
              <p className="text-[10px] font-semibold text-[#7367f0] uppercase tracking-wider mt-0.5">{BRAND}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className={`lg:hidden p-1.5 rounded-lg transition-colors ${isDark ? 'hover:bg-white/5 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}
          >
            <X size={18} />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-0.5">
          {items.map(item => {
            const showGroupLabel = item.groupLabel && item.groupLabel !== lastGroupLabel;
            if (showGroupLabel) lastGroupLabel = item.groupLabel!;

            return (
              <React.Fragment key={item.id}>
                {showGroupLabel && (
                  <p className={`px-3 pt-5 pb-1.5 text-[10px] font-bold uppercase tracking-widest ${isDark ? 'text-[#4a5580]' : 'text-gray-400'}`}>
                    {item.groupLabel}
                  </p>
                )}

                {item.path && !item.children ? (
                  // Leaf item
                  <NavLink
                    to={item.path}
                    onClick={onClose}
                    className={({ isActive }) => `
                      flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group
                      ${isActive
                        ? isDark
                          ? 'bg-[#7367f0]/15 text-[#9d95f5] font-semibold'
                          : 'bg-[#7367f0]/10 text-[#7367f0] font-semibold'
                        : isDark
                          ? 'text-[#8897b5] hover:bg-white/5 hover:text-white'
                          : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
                      }
                    `}
                  >
                    {({ isActive }) => (
                      <>
                        {item.icon && (
                          <item.icon
                            size={18}
                            className={`flex-shrink-0 ${isActive ? 'text-[#7367f0]' : isDark ? 'text-[#5a6a8a]' : 'text-gray-400'} group-hover:text-[#7367f0] transition-colors`}
                          />
                        )}
                        <span className="flex-1 truncate">{item.label}</span>
                        {item.badge && (
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase ${badgeClass[item.badgeColor || 'violet']}`}>
                            {item.badge}
                          </span>
                        )}
                      </>
                    )}
                  </NavLink>
                ) : (
                  // Group item with children
                  <div>
                    <button
                      onClick={() => toggleGroup(item.id)}
                      className={`
                        w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group
                        ${isChildActive(item)
                          ? isDark ? 'text-white bg-white/5' : 'text-gray-900 bg-gray-50'
                          : isDark ? 'text-[#8897b5] hover:bg-white/5 hover:text-white' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
                        }
                      `}
                    >
                      {item.icon && (
                        <item.icon
                          size={18}
                          className={`flex-shrink-0 transition-colors ${isChildActive(item) ? 'text-[#7367f0]' : isDark ? 'text-[#5a6a8a]' : 'text-gray-400'} group-hover:text-[#7367f0]`}
                        />
                      )}
                      <span className="flex-1 text-left truncate">{item.label}</span>
                      {item.badge && (
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase ${badgeClass[item.badgeColor || 'violet']}`}>
                          {item.badge}
                        </span>
                      )}
                      {openGroups.has(item.id)
                        ? <ChevronDown size={14} className={isDark ? 'text-[#5a6a8a]' : 'text-gray-400'} />
                        : <ChevronRight size={14} className={isDark ? 'text-[#5a6a8a]' : 'text-gray-400'} />
                      }
                    </button>

                    {/* Children */}
                    {openGroups.has(item.id) && (
                      <div className="ml-4 mt-0.5 space-y-0.5 border-l-2 border-dashed pl-3 mb-1"
                        style={{ borderColor: isDark ? '#2a3250' : '#e5e7eb' }}
                      >
                        {item.children?.map(child => (
                          <NavLink
                            key={child.id}
                            to={child.path || '#'}
                            onClick={onClose}
                            className={({ isActive }) => `
                              flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all duration-150
                              ${isActive
                                ? isDark
                                  ? 'bg-[#7367f0]/15 text-[#9d95f5] font-semibold'
                                  : 'bg-[#7367f0]/10 text-[#7367f0] font-semibold'
                                : isDark
                                  ? 'text-[#6a7a9a] hover:text-white hover:bg-white/5'
                                  : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
                              }
                            `}
                          >
                            {({ isActive }) => (
                              <>
                                {child.icon && (
                                  <child.icon
                                    size={15}
                                    className={isActive ? 'text-[#7367f0]' : isDark ? 'text-[#4a5a7a]' : 'text-gray-400'}
                                  />
                                )}
                                <span className="truncate">{child.label}</span>
                              </>
                            )}
                          </NavLink>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </nav>

        {/* Bottom: version */}
        <div className={`px-5 py-3 border-t text-[10px] ${isDark ? 'border-[#2a3250] text-[#3a4a6a]' : 'border-gray-100 text-gray-400'}`}>
          {BRAND} {/* v */}· Odoo 18 CE
        </div>
      </aside>
    </>
  );
}
