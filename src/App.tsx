import React, { useState, useEffect } from 'react';
import { ThemeProvider } from './context/ThemeContext';
import { CurrencyProvider } from './context/CurrencyContext';
import { AuthProvider } from './context/AuthContext';
import { ISPProvider, useISP } from './context/ISPContext';
import { PermissionProvider } from './context/PermissionContext';
import { Sidebar } from './components/Sidebar';
import { Header, ActiveTab } from './components/Header';
import { NocCommandCenter } from './components/NocCommandCenter';
import { CapacityPlannerView } from './components/CapacityPlannerView';
import { MikrotikStudio } from './components/MikrotikStudio';
import { VsolOltStudio } from './components/VsolOltStudio';
import { FiberGisMapView } from './components/FiberGisMapView';
import { BillingStudio } from './components/BillingStudio';
import { ProfitLossLedgerView } from './components/ProfitLossLedgerView';
import { ComplaintsStudio } from './components/ComplaintsStudio';
import { MobileAppSimulator } from './components/MobileAppSimulator';
import { UserManagementStudio } from './components/UserManagementStudio';
import { PermissionMatrixStudio } from './components/PermissionMatrixStudio';
import { ArchitectureStudio } from './components/ArchitectureStudio';
import { SettingsStudio } from './components/SettingsStudio';
import { ManagerOperationsDashboard } from './components/ManagerOperationsDashboard';
import { FieldAgentPortal } from './components/FieldAgentPortal';
import { ClientSubscriberPortal } from './components/ClientSubscriberPortal';
import { AccessDeniedView } from './components/AccessDeniedView';
import { LoginPage } from './components/LoginPage';
import { ActivityLogsStudio } from './components/ActivityLogsStudio';
import { ProvisionSecretModal } from './components/ProvisionSecretModal';
import { OutageBroadcasterModal } from './components/OutageBroadcasterModal';
import { NewTicketModal } from './components/NewTicketModal';
import { ReceiptModal } from './components/ReceiptModal';
import { CashPaymentModal } from './components/CashPaymentModal';
import { AddMikrotikDeviceModal } from './components/AddMikrotikDeviceModal';
import { PWAInstallPrompt } from './components/PWAInstallPrompt';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Invoice } from './types/isp';
import { SystemRole, UserAccount } from './types/auth';
import {
  getStoredUser,
  apiLogout,
  isRouteAllowedForRole,
  saveAuthSession,
  getStoredToken,
  isOriginalAdminSession,
  getTabFromPath,
  getPathFromTab,
  getLandingRouteForRole,
} from './lib/auth';
import { Radio, ShieldCheck, Database, ShieldAlert, ArrowLeft } from 'lucide-react';

function getLandingTabForRole(role: SystemRole): ActiveTab {
  switch (role) {
    case 'ADMIN':
      return 'noc';
    case 'MANAGER':
      return 'operations';
    case 'AGENT':
      return 'agent_portal';
    case 'CLIENT':
      return 'client_portal';
    default:
      return 'noc';
  }
}

function ISPAppContent() {
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(() => getStoredUser());
  const [currentRole, setCurrentRole] = useState<SystemRole>(() => {
    const user = getStoredUser();
    return user?.role || 'ADMIN';
  });

  const [activeTab, setActiveTab] = useState<ActiveTab>(() => {
    const user = getStoredUser();
    if (!user) return 'noc';
    if (user.role === 'AGENT') return 'agent_portal';
    if (user.role === 'CLIENT') return 'client_portal';
    const pathTab = typeof window !== 'undefined' ? getTabFromPath(window.location.pathname) : null;
    if (pathTab && isRouteAllowedForRole(user.role, pathTab)) {
      return pathTab as ActiveTab;
    }
    return getLandingTabForRole(user.role);
  });

  const { setActiveViewTab } = useISP();
  useEffect(() => {
    setActiveViewTab?.(activeTab);
  }, [activeTab, setActiveViewTab]);

  // Synchronize browser address bar with RBAC path
  useEffect(() => {
    if (!currentUser) {
      if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
        window.history.replaceState(null, '', '/login');
      }
      return;
    }

    if (currentUser.role === 'AGENT' && activeTab !== 'agent_portal') {
      setActiveTab('agent_portal');
      return;
    }
    if (currentUser.role === 'CLIENT' && activeTab !== 'client_portal') {
      setActiveTab('client_portal');
      return;
    }

    const expectedPath = getPathFromTab(activeTab);
    if (typeof window !== 'undefined' && window.location.pathname !== expectedPath) {
      window.history.replaceState(null, '', expectedPath);
    }
  }, [currentUser, activeTab]);

  // Browser navigation popstate listener
  useEffect(() => {
    const handlePopState = () => {
      const user = getStoredUser();
      if (!user) {
        setCurrentUser(null);
        return;
      }
      const pathTab = getTabFromPath(window.location.pathname);
      if (user.role === 'AGENT') {
        setActiveTab('agent_portal');
      } else if (user.role === 'CLIENT') {
        setActiveTab('client_portal');
      } else if (pathTab && isRouteAllowedForRole(user.role, pathTab)) {
        setActiveTab(pathTab as ActiveTab);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Sidebar collapsible state (HIDDEN by default)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // Modals state
  const [isProvisionOpen, setIsProvisionOpen] = useState(false);
  const [isOutageOpen, setIsOutageOpen] = useState(false);
  const [isTicketOpen, setIsTicketOpen] = useState(false);
  const [isAddRouterOpen, setIsAddRouterOpen] = useState(false);
  const [selectedReceiptInvoice, setSelectedReceiptInvoice] = useState<Invoice | null>(null);
  const [selectedPaymentInvoice, setSelectedPaymentInvoice] = useState<Invoice | null>(null);

  // Close sidebar on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isSidebarOpen) {
        setIsSidebarOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSidebarOpen]);

  const [gmpQuotaExceeded, setGmpQuotaExceeded] = useState(false);
  useEffect(() => {
    const onQuotaExceeded = () => setGmpQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', onQuotaExceeded);
    return () => window.removeEventListener('gmp-quota-exceeded', onQuotaExceeded);
  }, []);

  // Handle Login success
  const handleLoginSuccess = (user: UserAccount) => {
    setCurrentUser(user);
    setCurrentRole(user.role);
    const landingTab = getLandingTabForRole(user.role);
    setActiveTab(landingTab);
    const landingPath = getLandingRouteForRole(user.role);
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', landingPath);
    }
  };

  // Handle Logout
  const handleLogout = async () => {
    try {
      await apiLogout();
    } catch {}
    try {
      sessionStorage.clear();
      localStorage.removeItem('netpulse_active_user');
      localStorage.removeItem('youthnet_active_session');
      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_user');
    } catch {}
    setCurrentUser(null);
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
  };

  // Handle Role Switching for Testing/Simulation (Guarded strictly to genuine ADMIN sessions)
  const handleSwitchRole = (newRole: SystemRole) => {
    const isOriginalAdmin = isOriginalAdminSession();
    // Production Role Guard: Client accounts must NEVER escalate privilege
    if (currentUser?.role === 'CLIENT' || !isOriginalAdmin) {
      console.warn('Security Alert: Unauthorized role escalation blocked for client session.');
      return;
    }
    setCurrentRole(newRole);
    if (currentUser) {
      const updatedUser: UserAccount = { ...currentUser, role: newRole };
      setCurrentUser(updatedUser);
      const token = getStoredToken() || `sim-token-${Date.now()}`;
      saveAuthSession(token, updatedUser, true);
    }
    setActiveTab(getLandingTabForRole(newRole));
  };

  // Guard Outage Broadcaster modal (Never accessible to Client)
  const handleOpenOutage = () => {
    if (currentRole === 'CLIENT' || currentUser?.role === 'CLIENT') {
      console.warn('Security Alert: Outage broadcasting is strictly prohibited for client accounts.');
      return;
    }
    setIsOutageOpen(true);
  };

  const handleOpenReceipt = (invoice: Invoice) => {
    setSelectedReceiptInvoice(invoice);
  };

  const handleOpenPayment = (invoice: Invoice) => {
    setSelectedPaymentInvoice(invoice);
  };

  const handlePaymentSuccess = (invoice: Invoice, receiptNum: string) => {
    setSelectedPaymentInvoice(null);
    setSelectedReceiptInvoice({ ...invoice, receiptNumber: receiptNum });
  };

  // If unauthenticated, display sleek Login Page
  if (!currentUser) {
    return <LoginPage onLoginSuccess={handleLoginSuccess} />;
  }

  // Route permission validation
  const isPermitted = isRouteAllowedForRole(currentRole, activeTab);
  const isClient = currentRole === 'CLIENT' || currentUser.role === 'CLIENT';
  const isAgent = currentRole === 'AGENT' || currentUser.role === 'AGENT';
  const isOriginalAdmin = isOriginalAdminSession();

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-50 text-slate-900 dark:bg-[#0B111E] dark:text-slate-100 font-sans selection:bg-cyan-500 selection:text-white transition-colors duration-200">
      {/* 1. Off-Canvas Collapsible Sidebar (Strictly hidden for Client subscribers and Field Agents) */}
      {!isClient && !isAgent && (
        <Sidebar
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
          activeTab={activeTab}
          setActiveTab={(tab) => {
            setActiveTab(tab);
            setIsSidebarOpen(false);
          }}
          onOpenProvisionModal={() => {
            setIsProvisionOpen(true);
            setIsSidebarOpen(false);
          }}
          onOpenOutageModal={() => {
            handleOpenOutage();
            setIsSidebarOpen(false);
          }}
          onOpenTicketModal={() => {
            setIsTicketOpen(true);
            setIsSidebarOpen(false);
          }}
          currentRole={currentRole}
          onSwitchRole={isOriginalAdmin ? handleSwitchRole : undefined}
          currentUser={currentUser}
          onLogout={handleLogout}
        />
      )}

      {/* 2. Main Flex Viewport (Navbar + Scrollable Body + Footer) */}
      <div className="flex-1 flex flex-col h-full overflow-hidden min-w-0">
        {/* Top Navbar / Header Bar with Menu Toggle Button */}
        <Header
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          isSidebarOpen={isSidebarOpen}
          onToggleSidebar={() => setIsSidebarOpen((prev) => !prev)}
          onOpenProvisionModal={() => setIsProvisionOpen(true)}
          onOpenOutageModal={handleOpenOutage}
          onOpenTicketModal={() => setIsTicketOpen(true)}
          onOpenAddRouterModal={() => setIsAddRouterOpen(true)}
          onOpenPaymentModal={handleOpenPayment}
          onOpenReceiptModal={handleOpenReceipt}
          currentRole={currentRole}
          onSwitchRole={isOriginalAdmin ? handleSwitchRole : undefined}
          currentUser={currentUser}
          onLogout={handleLogout}
        />

        {gmpQuotaExceeded && (
          <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm">
            <span>
              Google Maps Platform quota reached. If you are the app owner, visit{' '}
              <a
                href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
                target="_blank"
                rel="noopener noreferrer"
                className="underline font-semibold text-amber-950 hover:text-amber-800"
              >
                maps developer site
              </a>{' '}
              for instructions to update your account.
            </span>
          </div>
        )}

        {/* RBAC Role Indicator Banner (Strictly hidden for logged-in CLIENT, AGENT, and MANAGER) */}
        {currentRole !== 'ADMIN' && isOriginalAdmin && currentUser.role === 'ADMIN' && (
          <div className="bg-slate-900 border-b border-indigo-900/60 text-slate-300 text-xs px-4 py-2 font-mono flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-cyan-400 shrink-0" />
              <span>
                Active RBAC Profile: Logged in as <strong className="text-white">{currentUser.fullName || currentUser.username}</strong> (<span className="text-cyan-400 font-bold">{currentRole}</span>).
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleSwitchRole('ADMIN')}
                className="px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[11px] cursor-pointer transition"
                title="Return to Administrator Profile"
              >
                Switch to Admin
              </button>
            </div>
          </div>
        )}

        {/* Scrollable Main Content Body */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-50 dark:bg-[#0B111E] text-slate-900 dark:text-slate-100 transition-colors duration-200">
          <div className="max-w-7xl mx-auto space-y-6">
            {/* PWA Mobile Install Banner (Admin only) */}
            {currentRole === 'ADMIN' && (
              <PWAInstallPrompt role={currentRole} variant="banner" forceVisibleOnDesktop={false} />
            )}

            {/* Route Protection Guard: If current role lacks permission, show 403 Forbidden screen */}
            {!isPermitted ? (
              <AccessDeniedView
                currentRole={currentRole}
                attemptedResource={activeTab}
                onReturnToAllowed={() => setActiveTab(getLandingTabForRole(currentRole))}
              />
            ) : (
              <>
                {/* 1. Admin NOC Command Center */}
                {activeTab === 'noc' && (
                  <NocCommandCenter
                    onNavigateTab={(tab) => setActiveTab(tab)}
                    onOpenOutageModal={() => setIsOutageOpen(true)}
                    onOpenTicketModal={() => setIsTicketOpen(true)}
                    onOpenAddRouterModal={() => setIsAddRouterOpen(true)}
                  />
                )}

                {/* 1b. Bandwidth Pool, 1:6 Contention & Upstream Capacity Planner */}
                {activeTab === 'capacity' && <CapacityPlannerView />}

                {/* 2. Operations & Dispatch (Customized for Manager / Admin) */}
                {activeTab === 'operations' && (
                  <ManagerOperationsDashboard
                    currentUser={currentUser}
                    onOpenTicketModal={() => setIsTicketOpen(true)}
                    onOpenOutageModal={() => setIsOutageOpen(true)}
                  />
                )}

                {/* 3. Field Agent Dedicated Portal (Mobile Friendly) */}
                {activeTab === 'agent_portal' && (
                  <FieldAgentPortal
                    currentUser={currentUser}
                    onOpenReceiptModal={handleOpenReceipt}
                    onOpenPaymentModal={handleOpenPayment}
                  />
                )}

                {/* 4. Client / Subscriber Self-Service Portal */}
                {activeTab === 'client_portal' && (
                  <ClientSubscriberPortal
                    currentUser={currentUser}
                    onOpenReceiptModal={handleOpenReceipt}
                    onOpenPaymentModal={handleOpenPayment}
                  />
                )}

                {/* MikroTik Fleet Studio (Admin Only) */}
                {activeTab === 'mikrotik' && (
                  <MikrotikStudio
                    onOpenProvisionModal={() => setIsProvisionOpen(true)}
                    onOpenAddRouterModal={() => setIsAddRouterOpen(true)}
                  />
                )}

                {/* VSOL OLT Studio */}
                {activeTab === 'olt' && <VsolOltStudio />}

                {/* Full-Stack FTTH Fiber GIS, FOSC Joint Closure & Subscriber Map */}
                {activeTab === 'fiber_gis' && (
                  <FiberGisMapView currentUser={currentUser} />
                )}

                {/* Billing & Invoices */}
                {activeTab === 'billing' && (
                  <BillingStudio
                    onOpenReceiptModal={handleOpenReceipt}
                    onOpenPaymentModal={handleOpenPayment}
                  />
                )}

                {/* ISP Expense Tracker & Automated Net Profit Ledger */}
                {activeTab === 'profit_expenses' && <ProfitLossLedgerView />}

                {/* Complaints & SLA Ticketing */}
                {activeTab === 'complaints' && (
                  <ComplaintsStudio
                    onOpenTicketModal={() => setIsTicketOpen(true)}
                    onOpenOutageModal={() => setIsOutageOpen(true)}
                  />
                )}

                {/* Mobile Simulator */}
                {activeTab === 'mobile' && (
                  <MobileAppSimulator
                    onOpenReceiptModal={handleOpenReceipt}
                    onOpenPaymentModal={handleOpenPayment}
                  />
                )}

                {/* User & Agent Hub */}
                {activeTab === 'users' && (
                  <UserManagementStudio
                    currentSimulatedRole={currentRole}
                    onSwitchSimulatedRole={handleSwitchRole}
                  />
                )}

                {/* Granular Feature & Permission Management Matrix */}
                {activeTab === 'permissions' && (
                  <PermissionMatrixStudio
                    currentSimulatedRole={currentRole}
                    onSwitchSimulatedRole={handleSwitchRole}
                  />
                )}

                {/* Architecture & SQL */}
                {activeTab === 'architecture' && <ArchitectureStudio />}

                {/* Settings Studio */}
                {activeTab === 'settings' && <SettingsStudio />}

                {/* Activity & System Audit Logs */}
                {activeTab === 'logs' && <ActivityLogsStudio />}
              </>
            )}
          </div>
        </main>

        {/* Compact Footer Strip */}
        <footer className="border-t border-slate-200 dark:border-slate-800/80 bg-white/95 dark:bg-[#0B111E]/90 py-2.5 px-4 sm:px-6 text-[11px] text-slate-500 dark:text-slate-400 shrink-0 transition-colors duration-200">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 font-mono">
            {isClient ? (
              <>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-800 dark:text-slate-200">Youth Net</span>
                  <span>&bull; Subscriber Self-Care Portal</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                    <ShieldCheck className="w-3.5 h-3.5" /> 256-bit TLS Encrypted
                  </span>
                  <span>&bull;</span>
                  <span className="text-slate-500 dark:text-slate-400">24/7 Helpline: +92 51 111-968-846</span>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <Radio className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
                  <span className="text-slate-800 dark:text-slate-200 font-bold">Youth Net Carrier NOC v4.2</span>
                  <span>&bull; RBAC Tier [{currentRole}] Active</span>
                </div>

                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                    <ShieldCheck className="w-3 h-3" /> Secure Auth Active
                  </span>
                  <span>&bull;</span>
                  <span className="flex items-center gap-1 text-cyan-600 dark:text-cyan-400">
                    <Database className="w-3 h-3" /> PostgreSQL 16 `users` Table
                  </span>
                </div>
              </>
            )}
          </div>
        </footer>
      </div>

      {/* Global Modals (Guarded by strict RBAC) */}
      <ProvisionSecretModal
        isOpen={isProvisionOpen && currentRole === 'ADMIN'}
        onClose={() => setIsProvisionOpen(false)}
      />

      <OutageBroadcasterModal
        isOpen={isOutageOpen && (currentRole === 'ADMIN' || currentRole === 'MANAGER') && !isClient}
        onClose={() => setIsOutageOpen(false)}
      />

      <NewTicketModal
        isOpen={isTicketOpen}
        onClose={() => setIsTicketOpen(false)}
      />

      <ReceiptModal
        invoice={selectedReceiptInvoice}
        onClose={() => setSelectedReceiptInvoice(null)}
      />

      <CashPaymentModal
        invoice={selectedPaymentInvoice}
        onClose={() => setSelectedPaymentInvoice(null)}
        onPaymentSuccess={handlePaymentSuccess}
      />

      <AddMikrotikDeviceModal
        isOpen={isAddRouterOpen}
        onClose={() => setIsAddRouterOpen(false)}
      />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <CurrencyProvider>
          <AuthProvider>
            <ISPProvider>
              <PermissionProvider>
                <ISPAppContent />
              </PermissionProvider>
            </ISPProvider>
          </AuthProvider>
        </CurrencyProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
