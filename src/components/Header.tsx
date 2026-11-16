import React from 'react';
import {
  Network,
  Activity,
  Server,
  CreditCard,
  AlertTriangle,
  Smartphone,
  Code2,
  Play,
  RotateCw,
  Radio,
  PlusCircle,
  Megaphone,
  Shield,
  ShieldCheck,
  ShieldAlert,
  Users,
  Layers,
  Settings,
  Menu,
  X,
  LogOut,
  User,
  Gauge,
  Wallet,
  MapPin,
  Package,
} from 'lucide-react';
import { useISP } from '../context/ISPContext';
import { SystemRole, UserAccount } from '../types/auth';
import { Invoice } from '../types/isp';
import { GlobalSearchBar } from './GlobalSearchBar';
import { PWAInstallPrompt } from './PWAInstallPrompt';
import { ThemeToggle } from './ThemeToggle';
import { getStoredUser } from '../lib/auth';

export type ActiveTab =
  | 'noc'
  | 'capacity'
  | 'operations'
  | 'mikrotik'
  | 'olt'
  | 'fiber_gis'
  | 'billing'
  | 'profit_expenses'
  | 'inventory'
  | 'complaints'
  | 'mobile'
  | 'users'
  | 'permissions'
  | 'architecture'
  | 'settings'
  | 'logs'
  | 'agent_portal'
  | 'client_portal';

interface HeaderProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  onOpenProvisionModal: () => void;
  onOpenOutageModal: () => void;
  onOpenTicketModal: () => void;
  onOpenAddRouterModal?: () => void;
  onOpenPaymentModal?: (invoice: Invoice) => void;
  onOpenReceiptModal?: (invoice: Invoice) => void;
  currentRole?: SystemRole;
  onSwitchRole?: (role: SystemRole) => void;
  currentUser?: UserAccount | null;
  onLogout?: () => void;
  isSidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  offlineModeStatus?: {
    isOfflineOrBlocked: boolean;
    isAutoSyncing: boolean;
    queuedCount: number;
    onRetrySync?: () => void;
  };
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  onOpenProvisionModal,
  onOpenOutageModal,
  onOpenTicketModal,
  onOpenAddRouterModal,
  onOpenPaymentModal,
  onOpenReceiptModal,
  currentRole,
  onSwitchRole,
  currentUser,
  onLogout,
  isSidebarOpen,
  onToggleSidebar,
  offlineModeStatus,
}) => {
  const {
    routers,
    selectedRouterId,
    setSelectedRouterId,
    runMonthlyBillingCron,
    runOverdueScanCron,
    isTrafficStreaming,
    setIsTrafficStreaming,
    lastCronMessage,
    activeSessions,
    complaints,
  } = useISP();

  const pendingSlaCount = complaints.filter(
    (c) => (c.priority === 'critical' || c.priority === 'high') && c.status !== 'resolved'
  ).length;

  const currentRouter = routers.find((r) => r.id === selectedRouterId) || routers[0];
  const activeUser = currentUser || getStoredUser();
  const effectiveRole = currentUser?.role || activeUser?.role || currentRole || 'ADMIN';
  const isClient =
    currentUser?.role === 'CLIENT' ||
    activeUser?.role === 'CLIENT' ||
    currentRole === 'CLIENT' ||
    effectiveRole === 'CLIENT';
  const isAgent =
    currentUser?.role === 'AGENT' ||
    activeUser?.role === 'AGENT' ||
    currentRole === 'AGENT' ||
    effectiveRole === 'AGENT';

  const getTabClassName = (tab: ActiveTab, themeColor: 'cyan' | 'indigo' = 'cyan') => {
    const isActive = activeTab === tab;
    if (isActive) {
      if (themeColor === 'indigo') {
        return 'bg-indigo-600 text-white border border-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300 dark:border-indigo-400/60 dark:shadow-[0_0_15px_rgba(99,102,241,0.18)] shadow-sm font-bold';
      }
      return 'bg-sky-600 text-white border border-sky-600 dark:bg-sky-500/20 dark:text-sky-300 dark:border-sky-400/60 dark:shadow-[0_0_15px_rgba(56,189,248,0.18)] shadow-sm font-bold';
    }
    return 'text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/70 border border-transparent';
  };

  // ==========================================================================
  // ISOLATED CLIENT PORTAL HEADER (Zero Internal Telemetry & No Admin Tools)
  // Only shows: Company Logo ("Youth Net"), Client Account Name badge, "Install App", and "Logout"
  // ==========================================================================
  if (isClient) {
    return (
      <header className="bg-white/95 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 sticky top-0 z-40 backdrop-blur-md shadow-sm dark:shadow-lg select-none transition-colors duration-200">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2.5 flex flex-wrap items-center justify-between gap-2.5 min-w-0">
          {/* Company Logo: Youth Net */}
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-gradient-to-tr from-cyan-600 to-emerald-600 text-white shadow-lg shadow-cyan-500/20 shrink-0">
              <Network className="w-4 h-4 sm:w-5 sm:h-5 animate-pulse" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-black tracking-wider text-sm sm:text-base leading-tight text-slate-900 dark:text-slate-100 uppercase">
                  Youth Net
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-50 dark:bg-cyan-950 text-cyan-700 dark:text-cyan-300 border border-cyan-200 dark:border-cyan-800 font-mono font-bold shrink-0">
                  Subscriber Portal
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-sans truncate">
                Self-Service Dashboard &amp; Billing Management
              </p>
            </div>
          </div>

          {/* Right Section: Theme Toggle, Client Account Name Badge, Logout */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 min-w-0">
            <ThemeToggle />

            <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-2.5 py-1.5 rounded-xl font-mono text-xs min-w-0 max-w-full">
              <User className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400 shrink-0" />
              <span className="text-slate-500 dark:text-slate-400 text-[10px] hidden sm:inline">Subscriber:</span>
              <span className="text-slate-900 dark:text-white font-bold font-sans truncate">
                {activeUser?.fullName || activeUser?.username || 'Client'}
              </span>
            </div>

            {onLogout && (
              <button
                type="button"
                onClick={onLogout}
                className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-900 hover:bg-rose-50 dark:hover:bg-rose-950/80 text-slate-700 dark:text-slate-300 hover:text-rose-600 dark:hover:text-rose-200 border border-slate-200 dark:border-slate-800 hover:border-rose-300 dark:hover:border-rose-800/80 px-2.5 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer shadow-sm shrink-0"
                title="Sign Out of Session"
              >
                <LogOut className="w-3.5 h-3.5 text-rose-500 dark:text-rose-400" />
                <span>Logout</span>
              </button>
            )}
          </div>
        </div>
      </header>
    );
  }

  // ==========================================================================
  // ISOLATED FIELD AGENT HEADER (Strict Mobile / Recovery Portal Header)
  // No router selector, no telemetry controls, no backend admin crons
  // ==========================================================================
  if (isAgent) {
    return (
      <header className="bg-white/95 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 sticky top-0 z-40 backdrop-blur-md shadow-sm dark:shadow-lg select-none transition-colors duration-200">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2.5 flex flex-wrap items-center justify-between gap-2.5 min-w-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-gradient-to-tr from-emerald-600 to-cyan-600 text-white shadow-lg shadow-emerald-500/20 shrink-0">
              <Network className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-black tracking-wider text-sm sm:text-base leading-tight text-slate-900 dark:text-slate-100 uppercase">
                  Youth Net
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 font-mono font-bold shrink-0">
                  Field Agent Portal
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-sans truncate">
                Cash Recovery, Invoice Collection &amp; Support Dispatch
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-3 min-w-0">
            {offlineModeStatus &&
              (offlineModeStatus.isAutoSyncing ? (
                <span
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-cyan-500/15 border border-cyan-500/50 text-cyan-700 dark:text-cyan-300 text-[11px] font-mono font-bold animate-pulse shrink-0"
                  role="status"
                  aria-live="polite"
                >
                  🔄 Auto-Syncing to DB...
                </span>
              ) : offlineModeStatus.isOfflineOrBlocked || offlineModeStatus.queuedCount > 0 ? (
                <button
                  type="button"
                  onClick={() => offlineModeStatus.onRetrySync?.()}
                  title="Tap to test internet connection and sync queued offline GPS & payment entries"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/50 text-amber-800 dark:text-amber-300 text-[11px] font-mono font-bold cursor-pointer transition shrink-0"
                  role="status"
                  aria-live="polite"
                >
                  📴 Offline Mode ({offlineModeStatus.queuedCount} items queued)
                </button>
              ) : null)}

            <PWAInstallPrompt role="AGENT" variant="button" />

            <ThemeToggle />

            <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-2.5 py-1.5 rounded-xl font-mono text-xs min-w-0 max-w-full">
              <User className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span className="text-slate-500 dark:text-slate-400 text-[10px] hidden sm:inline">Agent:</span>
              <span className="text-slate-900 dark:text-white font-bold font-sans truncate">
                {activeUser?.fullName || activeUser?.username || 'Field Agent'}
              </span>
            </div>

            {onLogout && (
              <button
                type="button"
                onClick={onLogout}
                className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-900 hover:bg-rose-50 dark:hover:bg-rose-950/80 text-slate-700 dark:text-slate-300 hover:text-rose-600 dark:hover:text-rose-200 border border-slate-200 dark:border-slate-800 hover:border-rose-300 dark:hover:border-rose-800/80 px-2.5 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer shadow-sm shrink-0"
                title="Sign Out of Session"
              >
                <LogOut className="w-3.5 h-3.5 text-rose-500 dark:text-rose-400" />
                <span>Logout</span>
              </button>
            )}
          </div>
        </div>
      </header>
    );
  }

  return (
    <header className="bg-white/95 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 sticky top-0 z-40 backdrop-blur-md shadow-sm dark:shadow-md transition-colors duration-200 max-w-full overflow-x-hidden">
      {/* Top Banner / Router Status */}
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 flex flex-wrap items-center justify-between gap-2 sm:gap-3 border-b border-slate-200/80 dark:border-slate-800/60 min-w-0">
        {/* Row 1 on Mobile: Menu + YOUTH NET Brand */}
        <div className="flex items-center gap-2 sm:gap-3 w-full md:w-auto min-w-0">
          {onToggleSidebar && (
            <button
              onClick={onToggleSidebar}
              className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl border text-xs font-mono font-bold transition shadow-sm cursor-pointer shrink-0 ${
                isSidebarOpen
                  ? 'bg-cyan-50 dark:bg-cyan-950 text-cyan-700 dark:text-cyan-300 border-cyan-300 dark:border-cyan-700 ring-1 ring-cyan-500/50'
                  : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-900 dark:hover:bg-slate-800 text-slate-700 hover:text-slate-900 dark:text-slate-200 dark:hover:text-white border-slate-200 dark:border-slate-700'
              }`}
              title={isSidebarOpen ? 'Close Menu (Esc)' : 'Open Navigation Menu'}
              aria-label="Toggle navigation menu"
              aria-expanded={isSidebarOpen}
            >
              {isSidebarOpen ? (
                <X className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
              ) : (
                <Menu className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
              )}
              <span className="font-bold">Menu</span>
            </button>
          )}

          <div className="flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-gradient-to-tr from-cyan-600 to-blue-600 text-white shadow-lg shadow-cyan-500/20 shrink-0">
            <Network className="w-4 h-4 sm:w-5 sm:h-5 animate-pulse" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
              <span className="font-black tracking-wider text-sm sm:text-base leading-tight text-slate-900 dark:text-slate-100 uppercase truncate">
                YOUTH NET <span className="text-cyan-600 dark:text-cyan-400 font-mono">SERVICE</span>
              </span>
              <span className="text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 rounded-full bg-cyan-50 dark:bg-cyan-950 text-cyan-700 dark:text-cyan-400 border border-cyan-200 dark:border-cyan-700/50 font-mono shrink-0 leading-tight">
                v7.16
              </span>
            </div>
            <p className="hidden sm:block text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 truncate leading-tight">
              Carrier-Grade ISP Operations &amp; MikroTik Automation
            </p>
          </div>
        </div>

        {/* Global Search Bar (Name, IP, Invoice # across app) */}
        <div className="order-last md:order-none w-full md:w-auto flex-1 max-w-lg mx-auto md:mx-4 min-w-0">
          <GlobalSearchBar
            onNavigateTab={setActiveTab}
            onOpenPaymentModal={onOpenPaymentModal}
            onOpenReceiptModal={onOpenReceiptModal}
            className="w-full"
          />
        </div>

        {/* Live Router Selector Row (Full-Width on <768px) + Telemetry & Wrapped Actions */}
        <div className="w-full md:w-auto flex flex-col md:flex-row md:items-center flex-wrap gap-2 sm:gap-3 text-xs font-mono min-w-0 max-w-full">
          {/* Dedicated Router Selector Row on Mobile */}
          <div className="w-full md:w-auto max-w-full flex items-center gap-2 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-2.5 py-1.5 rounded-lg min-w-0">
            <Server className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400 shrink-0" />
            <select
              value={selectedRouterId}
              onChange={(e) => setSelectedRouterId(e.target.value)}
              className="w-full md:w-auto min-w-0 flex-1 max-w-full truncate bg-transparent text-slate-800 dark:text-slate-200 text-xs focus:outline-none cursor-pointer"
            >
              {(!routers || routers.length === 0) ? (
                <option value="" disabled className="bg-white dark:bg-slate-900 text-slate-400">
                  No Routers Connected
                </option>
              ) : (
                routers.map((r) => (
                  <option key={r.id} value={r.id} className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100">
                    {r.name} ({r.ipAddress})
                  </option>
                ))
              )}
            </select>
            {currentRouter && (
              <span
                className={`inline-block w-2 h-2 rounded-full shrink-0 ${
                  currentRouter.status === 'online' ? 'bg-emerald-500 animate-ping' : 'bg-rose-500'
                }`}
                title={currentRouter.status === 'online' ? 'Router Online' : 'Router Offline'}
              />
            )}
            {onOpenAddRouterModal && (
              <button
                onClick={onOpenAddRouterModal}
                className="p-1 rounded bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-cyan-600 dark:text-cyan-400 hover:text-cyan-700 dark:hover:text-cyan-300 border border-slate-300 dark:border-slate-700 transition shrink-0"
                title="Add New MikroTik Router"
              >
                <PlusCircle className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {currentRouter ? (
            <>
              <span className={`hidden xl:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono shadow-sm ${
                currentRouter.status === 'online'
                  ? 'bg-emerald-50 dark:bg-emerald-950/90 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30'
                  : 'bg-rose-50 dark:bg-rose-950/90 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-500/30'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${currentRouter.status === 'online' ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
                {currentRouter.status === 'online' ? 'Router Online' : 'Router Offline'}
              </span>

              <div className="hidden lg:flex items-center gap-3 bg-slate-100 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 px-3 py-1.5 rounded-md text-slate-700 dark:text-slate-300">
                <span>
                  CPU: <strong className="text-cyan-600 dark:text-cyan-300">{currentRouter.cpuLoad ?? 0}%</strong>
                </span>
                <span className="text-slate-300 dark:text-slate-600">|</span>
                <span>
                  WAN: <strong className="text-emerald-600 dark:text-emerald-400">{(((currentRouter.currentWanRxMbps || 0)) / 1000).toFixed(2)} Gbps</strong>
                </span>
                <span className="text-slate-300 dark:text-slate-600">|</span>
                <span>
                  Sessions: <strong className="text-indigo-600 dark:text-indigo-300">{(activeSessions || []).length} active</strong>
                </span>
              </div>
            </>
          ) : (
            <span className="hidden xl:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono bg-slate-100 dark:bg-slate-900 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-800">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-slate-500" />
              No Routers Connected
            </span>
          )}

          {/* Wrapped Session, + Provision & Logout Actions Row (Fits cleanly inside 360px) */}
          <div className="w-full md:w-auto flex flex-wrap items-center gap-1.5 sm:gap-2 min-w-0 max-w-full">
            <ThemeToggle />

            <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-2 py-1.5 rounded-md shrink-0">
              <Shield className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400 shrink-0" />
              <span className="text-slate-500 dark:text-slate-400 text-[10px]">Session:</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-bold ${
                currentRole === 'ADMIN'
                  ? 'bg-rose-50 dark:bg-rose-950 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
                  : currentRole === 'MANAGER'
                  ? 'bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800'
                  : currentRole === 'AGENT'
                  ? 'bg-cyan-50 dark:bg-cyan-950 text-cyan-700 dark:text-cyan-300 border border-cyan-200 dark:border-cyan-800'
                  : 'bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
              }`}>
                {currentRole || 'ADMIN'}
              </span>
              {currentUser?.username && (
                <span className="text-[10px] text-slate-600 dark:text-slate-300 font-mono hidden sm:inline">
                  ({currentUser.username})
                </span>
              )}
            </div>

            {currentRole === 'ADMIN' && (
              <>
                <button
                  onClick={() => onOpenProvisionModal()}
                  className="flex items-center gap-1 bg-sky-600 hover:bg-sky-500 text-white font-bold px-2.5 py-1.5 rounded text-xs transition shadow-sm shrink-0 cursor-pointer"
                  title="Provision PPPoE Customer"
                >
                  <PlusCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>+ Provision</span>
                  <span className="hidden sm:inline">PPPoE</span>
                </button>

                <button
                  onClick={() => onOpenOutageModal()}
                  className="hidden sm:flex items-center gap-1.5 bg-rose-600/90 hover:bg-rose-500 text-white font-medium px-2.5 py-1.5 rounded text-xs transition shrink-0 cursor-pointer"
                  title="Broadcast Emergency Outage Alert"
                >
                  <Megaphone className="w-3.5 h-3.5" />
                  <span>Outage Broadcast</span>
                </button>
              </>
            )}

            {/* PWA Install Button (Admin only) */}
            {currentRole === 'ADMIN' && <PWAInstallPrompt role={currentRole} variant="button" />}

            {onLogout && (
              <button
                onClick={onLogout}
                className="flex items-center gap-1 bg-slate-100 hover:bg-rose-50 hover:text-rose-700 dark:bg-slate-800 dark:hover:bg-rose-900/60 dark:hover:text-rose-200 text-slate-700 dark:text-slate-300 font-medium px-2.5 py-1.5 rounded text-xs transition border border-slate-200 dark:border-slate-700 cursor-pointer shadow-sm shrink-0"
                title="Sign Out of Session"
              >
                <LogOut className="w-3.5 h-3.5 text-rose-500 dark:text-rose-400 shrink-0" />
                <span>Logout</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Navigation Tabs Filtered by Role */}
      <div className="max-w-7xl mx-auto px-0 sm:px-6 lg:px-8">
        <nav className="flex items-center overflow-x-auto gap-2 px-3 sm:px-0 py-2 snap-x snap-mandatory no-scrollbar">
          {/* ADMIN TABS */}
          {currentRole === 'ADMIN' && (
            <>
              <button
                onClick={() => setActiveTab('noc')}
                className={`shrink-0 whitespace-nowrap snap-start flex items-center gap-2 px-3 py-2 text-xs sm:text-sm font-medium rounded-xl transition cursor-pointer ${getTabClassName('noc')}`}
              >
                <Activity className="w-4 h-4 shrink-0" />
                <span>NOC Command Center</span>
              </button>

              <button
                onClick={() => setActiveTab('capacity')}
                className={`shrink-0 whitespace-nowrap snap-start flex items-center gap-2 px-3 py-2 text-xs sm:text-sm font-medium rounded-xl transition cursor-pointer ${getTabClassName('capacity')}`}
              >
                <Gauge className={`w-4 h-4 shrink-0 ${activeTab === 'capacity' ? 'text-white dark:text-sky-300' : 'text-cyan-600 dark:text-cyan-400'}`} />
                <span>Capacity &amp; Pools</span>
              </button>

              <button
                onClick={() => setActiveTab('operations')}
                className={`shrink-0 whitespace-nowrap snap-start flex items-center gap-2 px-3 py-2 text-xs sm:text-sm font-medium rounded-xl transition cursor-pointer ${getTabClassName('operations')}`}
              >
                <Network className="w-4 h-4 shrink-0" />
                <span>Operations &amp; Dispatch</span>
              </button>

              <button
                onClick={() => setActiveTab('mikrotik')}
                className={`shrink-0 whitespace-nowrap snap-start flex items-center gap-2 px-3 py-2 text-xs sm:text-sm font-medium rounded-xl transition cursor-pointer ${getTabClassName('mikrotik')}`}
              >
                <Radio className="w-4 h-4 shrink-0" />
                <span>MikroTik RouterOS v7</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-bold ${
                  activeTab === 'mikrotik'
                    ? 'bg-white/20 text-white dark:bg-sky-500/30 dark:text-sky-200'
                    : 'bg-cyan-100 dark:bg-cyan-900/60 text-cyan-800 dark:text-cyan-300'
                }`}>
                  Live
                </span>
              </button>

              <button
                onClick={() => setActiveTab('olt')}
                className={`shrink-0 whitespace-nowrap snap-start flex items-center gap-2 px-3 py-2 text-xs sm:text-sm font-medium rounded-xl transition cursor-pointer ${getTabClassName('olt')}`}
              >
                <Layers className={`w-4 h-4 shrink-0 ${activeTab === 'olt' ? 'text-white dark:text-sky-300' : 'text-cyan-600 dark:text-cyan-400'}`} />
                <span>VSOL OLT</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-bold ${
                  activeTab === 'olt'
                    ? 'bg-white/20 text-white dark:bg-emerald-500/30 dark:text-emerald-200'
                    : 'bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300'
                }`}>
                  GPON
                </span>
              </button>

              <button
                onClick={() => setActiveTab('fiber_gis')}
                className={`shrink-0 whitespace-nowrap snap-start flex items-center gap-2 px-3 py-2 text-xs sm:text-sm font-medium rounded-xl transition cursor-pointer ${getTabClassName('fiber_gis')}`}
              >
                <MapPin className={`w-4 h-4 shrink-0 ${activeTab === 'fiber_gis' ? 'text-white dark:text-sky-300' : 'text-sky-500 dark:text-sky-400'}`} />
                <span>Fiber GIS &amp; Map</span>
              </button>

              <button
                onClick={() => setActiveTab('billing')}
                className={`shrink-0 whitespace-nowrap snap-start flex items-center gap-2 px-3 py-2 text-xs sm:text-sm font-medium rounded-xl transition cursor-pointer ${getTabClassName('billing')}`}
              >
                <CreditCard className="w-4 h-4 shrink-0" />
                <span>Billing &amp; MRR</span>
              </button>

              <button
                onClick={() => setActiveTab('profit_expenses')}
                className={`shrink-0 whitespace-nowrap snap-start flex items-center gap-2 px-3 py-2 text-xs sm:text-sm font-medium rounded-xl transition cursor-pointer ${getTabClassName('profit_expenses')}`}
              >
                <Wallet className={`w-4 h-4 shrink-0 ${activeTab === 'profit_expenses' ? 'text-white dark:text-sky-300' : 'text-emerald-500 dark:text-emerald-400'}`} />
                <span>Profit &amp; Expenses</span>
              </button>

              <button
                onClick={() => setActiveTab('inventory')}
                className={`shrink-0 whitespace-nowrap snap-start flex items-center gap-2 px-3 py-2 text-xs sm:text-sm font-medium rounded-xl transition cursor-pointer ${getTabClassName('inventory')}`}
              >
                <Package className={`w-4 h-4 shrink-0 ${activeTab === 'inventory' ? 'text-white dark:text-sky-300' : 'text-amber-500 dark:text-amber-400'}`} />
                <span>Inventory &amp; Hardware</span>
              </button>

              <button
                onClick={() => setActiveTab('complaints')}
                className={`shrink-0 whitespace-nowrap snap-start flex items-center gap-2 px-3 py-2 text-xs sm:text-sm font-medium rounded-xl transition cursor-pointer ${getTabClassName('complaints')}`}
              >
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>Complaints &amp; SLA</span>
                {pendingSlaCount > 0 && (
                  <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-rose-100 dark:bg-rose-900/80 text-rose-800 dark:text-rose-300 border border-rose-300 dark:border-rose-700/50 font-mono font-bold">
                    {pendingSlaCount}
                  </span>
                )}
              </button>

              <button
                onClick={() => setActiveTab('users')}
                className={`shrink-0 whitespace-nowrap snap-start flex items-center gap-2 px-3 py-2 text-xs sm:text-sm font-medium rounded-xl transition cursor-pointer ${getTabClassName('users')}`}
              >
                <Shield className={`w-4 h-4 shrink-0 ${activeTab === 'users' ? 'text-white dark:text-sky-300' : 'text-cyan-600 dark:text-cyan-400'}`} />
                <span>User &amp; Access Management</span>
              </button>

              <button
                onClick={() => setActiveTab('permissions')}
                className={`shrink-0 whitespace-nowrap snap-start flex items-center gap-2 px-3 py-2 text-xs sm:text-sm font-medium rounded-xl transition cursor-pointer ${getTabClassName('permissions')}`}
              >
                <ShieldCheck className={`w-4 h-4 shrink-0 ${activeTab === 'permissions' ? 'text-white dark:text-sky-300' : 'text-emerald-600 dark:text-emerald-400'}`} />
                <span>Feature Matrix</span>
              </button>

              <button
                onClick={() => setActiveTab('logs')}
                className={`shrink-0 whitespace-nowrap snap-start flex items-center gap-2 px-3 py-2 text-xs sm:text-sm font-medium rounded-xl transition cursor-pointer ${getTabClassName('logs')}`}
              >
                <ShieldAlert className={`w-4 h-4 shrink-0 ${activeTab === 'logs' ? 'text-white dark:text-sky-300' : 'text-amber-600 dark:text-amber-400'}`} />
                <span>Activity Logs</span>
              </button>

              <button
                onClick={() => setActiveTab('mobile')}
                className={`shrink-0 whitespace-nowrap snap-start flex items-center gap-2 px-3 py-2 text-xs sm:text-sm font-medium rounded-xl transition cursor-pointer ${getTabClassName('mobile')}`}
              >
                <Smartphone className="w-4 h-4 shrink-0" />
                <span>Mobile Apps</span>
              </button>

              <button
                onClick={() => setActiveTab('architecture')}
                className={`shrink-0 whitespace-nowrap snap-start flex items-center gap-2 px-3 py-2 text-xs sm:text-sm font-medium rounded-xl transition cursor-pointer ${getTabClassName('architecture')}`}
              >
                <Code2 className="w-4 h-4 shrink-0" />
                <span>Architecture</span>
              </button>

              <button
                onClick={() => setActiveTab('settings')}
                className={`shrink-0 whitespace-nowrap snap-start flex items-center gap-2 px-3 py-2 text-xs sm:text-sm font-medium rounded-xl transition cursor-pointer ${getTabClassName('settings')}`}
              >
                <Settings className={`w-4 h-4 shrink-0 ${activeTab === 'settings' ? 'text-white dark:text-sky-300' : 'text-cyan-600 dark:text-cyan-400'}`} />
                <span>Settings</span>
              </button>
            </>
          )}

          {/* MANAGER TABS */}
          {currentRole === 'MANAGER' && (
            <>
              <button
                onClick={() => setActiveTab('operations')}
                className={`shrink-0 whitespace-nowrap snap-start flex items-center gap-2 px-3 py-2 text-xs sm:text-sm font-medium rounded-xl transition cursor-pointer ${getTabClassName('operations', 'indigo')}`}
              >
                <Activity className="w-4 h-4 shrink-0" />
                <span>Operations &amp; Dispatch</span>
              </button>

              <button
                onClick={() => setActiveTab('noc')}
                className={`shrink-0 whitespace-nowrap snap-start flex items-center gap-2 px-3 py-2 text-xs sm:text-sm font-medium rounded-xl transition cursor-pointer ${getTabClassName('noc', 'indigo')}`}
              >
                <Network className="w-4 h-4 shrink-0" />
                <span>NOC Overview</span>
              </button>

              <button
                onClick={() => setActiveTab('capacity')}
                className={`shrink-0 whitespace-nowrap snap-start flex items-center gap-2 px-3 py-2 text-xs sm:text-sm font-medium rounded-xl transition cursor-pointer ${getTabClassName('capacity', 'indigo')}`}
              >
                <Gauge className="w-4 h-4 shrink-0" />
                <span>Capacity &amp; Pools</span>
              </button>

              <button
                onClick={() => setActiveTab('complaints')}
                className={`shrink-0 whitespace-nowrap snap-start flex items-center gap-2 px-3 py-2 text-xs sm:text-sm font-medium rounded-xl transition cursor-pointer ${getTabClassName('complaints', 'indigo')}`}
              >
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>Complaints &amp; SLA</span>
                {pendingSlaCount > 0 && (
                  <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-rose-100 dark:bg-rose-900/80 text-rose-800 dark:text-rose-300 border border-rose-300 dark:border-rose-700/50 font-mono font-bold">
                    {pendingSlaCount}
                  </span>
                )}
              </button>

              <button
                onClick={() => setActiveTab('olt')}
                className={`shrink-0 whitespace-nowrap snap-start flex items-center gap-2 px-3 py-2 text-xs sm:text-sm font-medium rounded-xl transition cursor-pointer ${getTabClassName('olt', 'indigo')}`}
              >
                <Layers className={`w-4 h-4 shrink-0 ${activeTab === 'olt' ? 'text-white dark:text-indigo-300' : 'text-cyan-600 dark:text-cyan-400'}`} />
                <span>VSOL OLT</span>
              </button>

              <button
                onClick={() => setActiveTab('fiber_gis')}
                className={`shrink-0 whitespace-nowrap snap-start flex items-center gap-2 px-3 py-2 text-xs sm:text-sm font-medium rounded-xl transition cursor-pointer ${getTabClassName('fiber_gis', 'indigo')}`}
              >
                <MapPin className={`w-4 h-4 shrink-0 ${activeTab === 'fiber_gis' ? 'text-white dark:text-indigo-300' : 'text-sky-500 dark:text-sky-400'}`} />
                <span>Fiber GIS &amp; Map</span>
              </button>

              <button
                onClick={() => setActiveTab('billing')}
                className={`shrink-0 whitespace-nowrap snap-start flex items-center gap-2 px-3 py-2 text-xs sm:text-sm font-medium rounded-xl transition cursor-pointer ${getTabClassName('billing', 'indigo')}`}
              >
                <CreditCard className="w-4 h-4 shrink-0" />
                <span>Agent Cash &amp; Billing</span>
              </button>

              <button
                onClick={() => setActiveTab('profit_expenses')}
                className={`shrink-0 whitespace-nowrap snap-start flex items-center gap-2 px-3 py-2 text-xs sm:text-sm font-medium rounded-xl transition cursor-pointer ${getTabClassName('profit_expenses', 'indigo')}`}
              >
                <Wallet className={`w-4 h-4 shrink-0 ${activeTab === 'profit_expenses' ? 'text-white dark:text-indigo-300' : 'text-emerald-500 dark:text-emerald-400'}`} />
                <span>Profit &amp; Expenses</span>
              </button>

              <button
                onClick={() => setActiveTab('inventory')}
                className={`shrink-0 whitespace-nowrap snap-start flex items-center gap-2 px-3 py-2 text-xs sm:text-sm font-medium rounded-xl transition cursor-pointer ${getTabClassName('inventory', 'indigo')}`}
              >
                <Package className={`w-4 h-4 shrink-0 ${activeTab === 'inventory' ? 'text-white dark:text-indigo-300' : 'text-amber-500 dark:text-amber-400'}`} />
                <span>Inventory &amp; Hardware</span>
              </button>
            </>
          )}
        </nav>
      </div>

      {/* CRON Status Strip if triggered */}
      {lastCronMessage && (
        <div className="bg-sky-50 dark:bg-slate-900 border-t border-sky-200 dark:border-cyan-900/40 px-4 py-1 text-center text-xs text-sky-700 dark:text-cyan-300 flex items-center justify-center gap-2 animate-fade-in">
          <RotateCw className="w-3 h-3 text-sky-600 dark:text-cyan-400 animate-spin" />
          <span>{lastCronMessage}</span>
        </div>
      )}
    </header>
  );
};
