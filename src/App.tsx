import React, { Suspense, lazy, Component, ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import AppLayout from './components/layout/AppLayout';
import Login from './pages/Login';
import { AppLockProvider } from './components/AppLock';
import NfcAutoPunch from './components/NfcAutoPunch';

// ─── Error Boundary — prevents blank screen on render errors ─────────────────
interface EBState { hasError: boolean; error: Error | null; }
class ErrorBoundary extends Component<{ children: ReactNode }, EBState> {
  state: EBState = { hasError: false, error: null };
  static getDerivedStateFromError(error: Error): EBState {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] Render error:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: '100vh', background: '#0f1422', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
          <div style={{ background: '#161b2e', border: '1px solid #ef4444', borderRadius: '1rem', padding: '2rem', maxWidth: '600px', width: '100%' }}>
            <h2 style={{ color: '#ef4444', fontWeight: 900, fontSize: '1.1rem', marginBottom: '0.5rem' }}>App crashed — render error</h2>
            <pre style={{ color: '#f87171', fontSize: '0.75rem', whiteSpace: 'pre-wrap', wordBreak: 'break-all', marginBottom: '1rem' }}>
              {this.state.error?.message}
              {'\n'}
              {this.state.error?.stack?.slice(0, 800)}
            </pre>
            <button onClick={() => { this.setState({ hasError: false, error: null }); window.location.href = '/'; }}
              style={{ background: '#7367f0', color: '#fff', border: 'none', borderRadius: '0.5rem', padding: '0.5rem 1.5rem', cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem' }}>
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Lazy load modules for code splitting ──────────────────────────────────
const Dashboard         = lazy(() => import('./components/modules/Dashboard'));
const SalesOrders       = lazy(() => import('./components/modules/Sales/SalesOrders'));
const Quotations        = lazy(() => import('./components/modules/Sales/Quotations'));
const Customers         = lazy(() => import('./components/modules/Sales/Customers'));
const Products          = lazy(() => import('./components/modules/Inventory/Products'));
const Transfers         = lazy(() => import('./components/modules/Inventory/Transfers'));
const Stock             = lazy(() => import('./components/modules/Inventory/Stock'));
const Reordering        = lazy(() => import('./components/modules/Inventory/Reordering'));
const Invoices          = lazy(() => import('./components/modules/Accounting/Invoices'));
const Bills             = lazy(() => import('./components/modules/Accounting/Bills'));
const Journal           = lazy(() => import('./components/modules/Accounting/Journal'));
const Reports           = lazy(() => import('./components/modules/Accounting/Reports'));
const FbfReplenishment  = lazy(() => import('./components/modules/FlipkartOS/FbfReplenishment'));
const FbfStock          = lazy(() => import('./components/modules/FlipkartOS/FbfStock'));
const DailyOrderScanner = lazy(() => import('./components/modules/FlipkartOS/DailyOrderScanner'));
const SupplierReorders  = lazy(() => import('./components/modules/FlipkartOS/SupplierReorders'));
const DeadStock         = lazy(() => import('./components/modules/FlipkartOS/DeadStockView'));
const ConsignmentManager = lazy(() => import('./components/modules/FlipkartOS/ConsignmentManager'));
const ReturnsManagement = lazy(() => import('./components/modules/FlipkartOS/ReturnsManagement'));
const SalesDashboard    = lazy(() => import('./components/modules/FlipkartOS/SalesDashboard'));
const StockValuation    = lazy(() => import('./components/modules/FlipkartOS/StockValuation'));
const Listings          = lazy(() => import('./components/modules/FlipkartOS/Listings'));
const UploadCenter      = lazy(() => import('./components/modules/FlipkartOS/UploadCenter'));
const FlipkartSetup     = lazy(() => import('./components/modules/FlipkartOS/FlipkartSetup'));
const UnifiedLedger     = lazy(() => import('./components/modules/FlipkartOS/UnifiedLedger'));
const QuickSaleOrder    = lazy(() => import('./components/modules/FlipkartOS/QuickSaleOrder'));
const CreateEntry       = lazy(() => import('./components/modules/FlipkartOS/CreateEntry'));
const B2BOrders         = lazy(() => import('./components/modules/B2B/B2BOrders'));
const B2BLedger         = lazy(() => import('./components/modules/B2B/B2BLedger'));
const SettlementsConsole = lazy(() => import('./components/modules/Settlements/SettlementsConsole'));
const SettlementStudio  = lazy(() => import('./components/modules/Settlements/SettlementStudio'));
const ExpenseManager    = lazy(() => import('./components/modules/Settlements/ExpenseManager'));
const Tasks             = lazy(() => import('./components/modules/Tasks/Tasks'));
const PurchaseOrders    = lazy(() => import('./components/modules/Purchase/PurchaseOrders'));
const Rfq               = lazy(() => import('./components/modules/Purchase/Rfq'));
const Vendors           = lazy(() => import('./components/modules/Purchase/Vendors'));
const VendorPriceList   = lazy(() => import('./components/modules/Purchase/VendorPriceList'));
const Pipeline          = lazy(() => import('./components/modules/CRM/Pipeline'));
const Leads             = lazy(() => import('./components/modules/CRM/Leads'));
const Employees         = lazy(() => import('./components/modules/HR/Employees'));
const Leaves            = lazy(() => import('./components/modules/HR/Leaves'));
const Attendance        = lazy(() => import('./components/modules/HR/Attendance'));
const Salary            = lazy(() => import('./components/modules/HR/Salary'));
const LiveMap           = lazy(() => import('./components/modules/HR/LiveMap'));
const HrSettings        = lazy(() => import('./components/modules/HR/HrSettings'));
const Kiosk             = lazy(() => import('./components/modules/HR/Kiosk'));
const GeneralSettings   = lazy(() => import('./components/modules/Settings/GeneralSettings'));
const Profile           = lazy(() => import('./components/modules/Settings/Profile'));
const ComingSoon        = lazy(() => import('./components/ui/ComingSoon'));

// ─── Loading fallback ───────────────────────────────────────────────────────
function PageLoader() {
  return (
    <div className="flex items-center justify-center h-full min-h-[50vh]">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#7367f0] to-[#3d5af1] flex items-center justify-center animate-pulse">
          <span className="text-white font-black text-base">B</span>
        </div>
        <p className="text-sm text-[#7367f0] font-medium animate-pulse">Loading...</p>
      </div>
    </div>
  );
}

// ─── Guard: redirect to login if not authenticated ──────────────────────────
function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user } = useAuth();
  const { workspace } = useParams<{ workspace: string }>();

  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace />;
  }

  // Authorization: check if workspace slug matches user's database name
  if (workspace && workspace.toLowerCase() !== user.db.toLowerCase()) {
    console.warn(`[Auth] Workspace mismatch: requested "${workspace}", user has "${user.db}"`);
    return <Navigate to={`/${user.db}/dashboard`} replace />;
  }

  return <>{children}</>;
}

// ─── Role-based landing: managers → dashboard, employees → their tasks ───────
function RoleLanding() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  const workspaceSlug = user.db || 'robifel';
  return <Navigate to={`/${workspaceSlug}/${user.is_admin ? 'dashboard' : 'tasks'}`} replace />;
}

// ─── Inner app (after auth context is available) ────────────────────────────
function InnerApp() {
  const { isAuthenticated } = useAuth();

  return (
    <>
      {isAuthenticated && <NfcAutoPunch />}
      <Routes>
        {/* Login */}
        <Route path="/login" element={isAuthenticated ? <RoleLanding /> : <Login />} />

        {/* Root — redirect to workspace dashboard or login */}
        <Route path="/" element={<RoleLanding />} />

        {/* Protected app shell nested under /:workspace */}
        <Route
          path="/:workspace"
          element={
            <PrivateRoute>
              <AppLayout />
            </PrivateRoute>
          }
        >
          <Route index element={<RoleLanding />} />

          {/* ─── Dashboard ─── */}
          <Route path="dashboard" element={<Suspense fallback={<PageLoader />}><Dashboard /></Suspense>} />

          {/* ─── Tasks ─── */}
          <Route path="tasks" element={<Suspense fallback={<PageLoader />}><Tasks /></Suspense>} />

          {/* ─── Sales ─── */}
          <Route path="sales/orders"    element={<Suspense fallback={<PageLoader />}><SalesOrders /></Suspense>} />
          <Route path="sales/quotations" element={<Suspense fallback={<PageLoader />}><Quotations /></Suspense>} />
          <Route path="sales/customers"  element={<Suspense fallback={<PageLoader />}><Customers /></Suspense>} />

          {/* ─── Purchase ─── */}
          <Route path="purchase/orders"  element={<Suspense fallback={<PageLoader />}><PurchaseOrders /></Suspense>} />
          <Route path="purchase/rfq"     element={<Suspense fallback={<PageLoader />}><Rfq /></Suspense>} />
          <Route path="purchase/vendors" element={<Suspense fallback={<PageLoader />}><Vendors /></Suspense>} />
          <Route path="purchase/price-list" element={<Suspense fallback={<PageLoader />}><VendorPriceList /></Suspense>} />

          {/* ─── Inventory ─── */}
          <Route path="inventory/products"   element={<Suspense fallback={<PageLoader />}><Products /></Suspense>} />
          <Route path="inventory/transfers"  element={<Suspense fallback={<PageLoader />}><Transfers /></Suspense>} />
          <Route path="inventory/stock"      element={<Suspense fallback={<PageLoader />}><Stock /></Suspense>} />
          <Route path="inventory/reordering" element={<Suspense fallback={<PageLoader />}><Reordering /></Suspense>} />

          {/* ─── Accounting ─── */}
          <Route path="accounting/invoices" element={<Suspense fallback={<PageLoader />}><Invoices /></Suspense>} />
          <Route path="accounting/bills"    element={<Suspense fallback={<PageLoader />}><Bills /></Suspense>} />
          <Route path="accounting/journal"  element={<Suspense fallback={<PageLoader />}><Journal /></Suspense>} />
          <Route path="accounting/reports"  element={<Suspense fallback={<PageLoader />}><Reports /></Suspense>} />

          {/* ─── CRM ─── */}
          <Route path="crm/pipeline" element={<Suspense fallback={<PageLoader />}><Pipeline /></Suspense>} />
          <Route path="crm/leads"    element={<Suspense fallback={<PageLoader />}><Leads /></Suspense>} />

          {/* ─── HR ─── */}
          <Route path="hr/employees"   element={<Suspense fallback={<PageLoader />}><Employees /></Suspense>} />
          <Route path="hr/leaves"      element={<Suspense fallback={<PageLoader />}><Leaves /></Suspense>} />
          <Route path="hr/attendance"  element={<Suspense fallback={<PageLoader />}><Attendance /></Suspense>} />
          <Route path="hr/salary"      element={<Suspense fallback={<PageLoader />}><Salary /></Suspense>} />
          <Route path="hr/live-map"    element={<Suspense fallback={<PageLoader />}><LiveMap /></Suspense>} />
          <Route path="hr/settings"    element={<Suspense fallback={<PageLoader />}><HrSettings /></Suspense>} />
          <Route path="hr/kiosk"       element={<Suspense fallback={<PageLoader />}><Kiosk /></Suspense>} />

          {/* ─── Flipkart OS ─── */}
          <Route path="flipkart/fbf"            element={<Suspense fallback={<PageLoader />}><FbfReplenishment /></Suspense>} />
          <Route path="flipkart/fbf-stock"      element={<Suspense fallback={<PageLoader />}><FbfStock /></Suspense>} />
          <Route path="flipkart/scanner"        element={<Suspense fallback={<PageLoader />}><DailyOrderScanner /></Suspense>} />
          <Route path="flipkart/supplier"       element={<Suspense fallback={<PageLoader />}><SupplierReorders /></Suspense>} />
          <Route path="flipkart/deadstock"      element={<Suspense fallback={<PageLoader />}><DeadStock /></Suspense>} />
          <Route path="flipkart/consignments"   element={<Suspense fallback={<PageLoader />}><ConsignmentManager /></Suspense>} />
          <Route path="flipkart/returns"        element={<Suspense fallback={<PageLoader />}><ReturnsManagement /></Suspense>} />
          <Route path="flipkart/sales-dashboard" element={<Suspense fallback={<PageLoader />}><SalesDashboard /></Suspense>} />
          <Route path="flipkart/valuation"      element={<Suspense fallback={<PageLoader />}><StockValuation /></Suspense>} />
          <Route path="flipkart/listings"       element={<Suspense fallback={<PageLoader />}><Listings /></Suspense>} />
          <Route path="flipkart/upload"         element={<Suspense fallback={<PageLoader />}><UploadCenter /></Suspense>} />
          <Route path="flipkart/setup"          element={<Suspense fallback={<PageLoader />}><FlipkartSetup /></Suspense>} />
          <Route path="flipkart/ledger"         element={<Suspense fallback={<PageLoader />}><UnifiedLedger /></Suspense>} />
          <Route path="flipkart/quick-sale"     element={<Suspense fallback={<PageLoader />}><QuickSaleOrder /></Suspense>} />
          <Route path="flipkart/create-entry"   element={<Suspense fallback={<PageLoader />}><CreateEntry /></Suspense>} />

          {/* ─── B2B ─── */}
          <Route path="b2b/orders" element={<Suspense fallback={<PageLoader />}><B2BOrders /></Suspense>} />
          <Route path="b2b/ledger" element={<Suspense fallback={<PageLoader />}><B2BLedger /></Suspense>} />

          {/* ─── Settlements ─── */}
          <Route path="settlements/studio"     element={<Suspense fallback={<PageLoader />}><SettlementStudio /></Suspense>} />
          <Route path="settlements/expenses"   element={<Suspense fallback={<PageLoader />}><ExpenseManager /></Suspense>} />
          <Route path="settlements/vendors"    element={<Suspense fallback={<PageLoader />}><SettlementsConsole /></Suspense>} />
          <Route path="settlements/associates" element={<Suspense fallback={<PageLoader />}><SettlementsConsole /></Suspense>} />
          <Route path="settlements/agents"     element={<Suspense fallback={<PageLoader />}><SettlementsConsole /></Suspense>} />

          {/* ─── AI ─── */}
          <Route path="ai" element={<Suspense fallback={<PageLoader />}><ComingSoon module="AI Assistant" description="Use the floating AI chat button at the bottom-right of your screen." /></Suspense>} />

          {/* ─── Settings ─── */}
          <Route path="settings/general"   element={<Suspense fallback={<PageLoader />}><GeneralSettings /></Suspense>} />
          <Route path="settings/users"     element={<Suspense fallback={<PageLoader />}><GeneralSettings /></Suspense>} />
          <Route path="settings/technical" element={<Suspense fallback={<PageLoader />}><GeneralSettings /></Suspense>} />
          <Route path="settings/profile"   element={<Suspense fallback={<PageLoader />}><Profile /></Suspense>} />

          {/* ─── 404 → dashboard ─── */}
          <Route path="*" element={<Navigate to="dashboard" replace />} />
        </Route>

        {/* Catch-all: redirect to role landing */}
        <Route path="*" element={<RoleLanding />} />
      </Routes>
    </>
  );
}

// ─── Root App ───────────────────────────────────────────────────────────────
export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <AppLockProvider>
            <BrowserRouter basename="/">
              <ErrorBoundary>
                <InnerApp />
              </ErrorBoundary>
            </BrowserRouter>
          </AppLockProvider>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
