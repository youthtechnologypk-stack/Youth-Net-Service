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
  Users,
  Layers,
  Settings,
  Menu,
  X,
  LogOut,
  User,
} from 'lucide-react';
import { useISP } from '../context/ISPContext';
import { SystemRole, UserAccount } from '../types/auth';
import { Invoice } from '../types/isp';
import { GlobalSearchBar } from './GlobalSearchBar';
import { PWAInstallPrompt } from './PWAInstallPrompt';
import { getStoredUser } from '../lib/auth';

export type ActiveTab =
  | 'noc'
  | 'operations'
  | 'mikrotik'
  | 'olt'
  | 'billing'
  | 'complaints'
  | 'mobile'
  | 'users'
  | 'permissions'
  | 'architecture'
  | 'settings'
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

  // ==========================================================================
  // ISOLATED CLIENT PORTAL HEADER (Zero Internal Telemetry & No Admin Tools)
  // Only shows: Company Logo ("Youth Net"), Client Account Name badge, "Install App", and "Logout"
  // ==========================================================================
  if (isClient) {
    return (
      <header className="bg-slate-950 border-b border-slate-800 text-slate-100 sticky top-0 z-40 backdrop-blur-md bg-opacity-95 shadow-lg select-none">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between gap-4">
          {/* Company Logo: Youth Net */}
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-tr from-cyan-600 to-emerald-600 text-white shadow-lg shadow-cyan-500/20">
              <Network className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-black tracking-wider text-base text-slate-100 uppercase">
                  Youth Net
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-800 font-mono font-bold">
                  Subscriber Portal
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-sans">
                Self-Service Dashboard &amp; Billing Management
              </p>
            </div>
          </div>

          {/* Right Section: Client Account Name Badge, Install App Button, Logout */}
          <div className="flex items-center gap-2.5 sm:gap-3">
            {/* Client Account Name Badge */}
            <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-xl font-mono text-xs">
              <User className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              <span className="text-slate-400 text-[10px] hidden sm:inline">Subscriber:</span>
              <span className="text-white font-bold font-sans">
                {activeUser?.fullName || activeUser?.username || 'Client'}
              </span>
            </div>

            {/* Install App Button */}
            <PWAInstallPrompt role="CLIENT" variant="button" />

            {/* Logout Button */}
            {onLogout && (
              <button
                type="button"
                onClick={onLogout}
                className="flex items-center gap-1.5 bg-slate-900 hover:bg-rose-950/80 text-slate-300 hover:text-rose-200 border border-slate-800 hover:border-rose-800/80 px-3 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer shadow-sm"
                title="Sign Out of Session"
              >
                <LogOut className="w-3.5 h-3.5 text-rose-400" />
                <span>Logout</span>
              </button>
            )}
          </div>
        </div>
      </header>
    );
  }

  return (
    <header className="bg-slate-950 border-b border-slate-800 text-slate-100 sticky top-0 z-40 backdrop-blur-md bg-opacity-95">
      {/* Top Banner / Router Status */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/60">
        <div className="flex items-center gap-3">
          {onToggleSidebar && (
            <button
              onClick={onToggleSidebar}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-mono font-bold transition shadow-sm cursor-pointer ${
                isSidebarOpen
                  ? 'bg-cyan-950 text-cyan-300 border-cyan-700 ring-1 ring-cyan-500/50'
                  : 'bg-slate-900 hover:bg-slate-800 text-slate-200 hover:text-white border-slate-700'
              }`}
              title={isSidebarOpen ? 'Close Menu (Esc)' : 'Open Navigation Menu'}
              aria-label="Toggle navigation menu"
              aria-expanded={isSidebarOpen}
            >
              {isSidebarOpen ? (
                <X className="w-4 h-4 text-cyan-400" />
              ) : (
                <Menu className="w-4 h-4 text-cyan-400" />
              )}
              <span className="font-bold">Menu</span>
            </button>
          )}

          <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-gradient-to-tr from-cyan-600 to-blue-600 text-white shadow-lg shadow-cyan-500/20">
            <Network className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-black tracking-wider text-base text-slate-100 uppercase">
                Youth Net <span className="text-cyan-400 font-mono">Service</span>
              </span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-400 border border-cyan-700/50 font-mono">
                RouterOS v7.16
              </span>
            </div>
            <p className="text-xs text-slate-400">Carrier-Grade ISP Operations & MikroTik Automation</p>
          </div>
        </div>

        {/* Global Search Bar (Name, IP, Invoice # across app) */}
        <div className="order-last md:order-none w-full md:w-auto flex-1 max-w-lg mx-auto md:mx-4">
          <GlobalSearchBar
            onNavigateTab={setActiveTab}
            onOpenPaymentModal={onOpenPaymentModal}
            onOpenReceiptModal={onOpenReceiptModal}
            className="w-full"
          />
        </div>

        {/* Live Router Telemetry Indicator & Actions */}
        <div className="flex items-center flex-wrap gap-2.5 sm:gap-4 text-xs font-mono">
          <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-md">
            <Server className="w-3.5 h-3.5 text-cyan-400" />
            <select
              value={selectedRouterId}
              onChange={(e) => setSelectedRouterId(e.target.value)}
              className="bg-transparent text-slate-200 text-xs focus:outline-none cursor-pointer"
            >
              {(!routers || routers.length === 0) ? (
                <option value="" disabled className="bg-slate-900 text-slate-400">
                  No Routers Connected
                </option>
              ) : (
                routers.map((r) => (
                  <option key={r.id} value={r.id} className="bg-slate-900 text-slate-100">
                    {r.name} ({r.ipAddress})
                  </option>
                ))
              )}
            </select>
            {currentRouter && (
              <span className={`inline-block w-2 h-2 rounded-full ${currentRouter.status === 'online' ? 'bg-emerald-400 animate-ping' : 'bg-rose-400'}`} />
            )}
            {onOpenAddRouterModal && (
              <button
                onClick={onOpenAddRouterModal}
                className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-cyan-400 hover:text-cyan-300 border border-slate-700 transition"
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
                  ? 'bg-emerald-950/90 text-emerald-300 border border-emerald-500/30'
                  : 'bg-rose-950/90 text-rose-300 border border-rose-500/30'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${currentRouter.status === 'online' ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
                {currentRouter.status === 'online' ? 'RouterOS v7 REST Live' : 'Router Offline'}
              </span>

              <div className="hidden lg:flex items-center gap-3 bg-slate-900/80 border border-slate-800 px-3 py-1.5 rounded-md text-slate-300">
                <span>
                  CPU: <strong className="text-cyan-300">{currentRouter.cpuLoad ?? 0}%</strong>
                </span>
                <span className="text-slate-600">|</span>
                <span>
                  WAN: <strong className="text-emerald-400">{(((currentRouter.currentWanRxMbps || 0)) / 1000).toFixed(2)} Gbps</strong>
                </span>
                <span className="text-slate-600">|</span>
                <span>
                  Sessions: <strong className="text-indigo-300">{activeSessions.length} active</strong>
                </span>
              </div>
            </>
          ) : (
            <span className="hidden xl:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono bg-slate-900 text-slate-400 border border-slate-800">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
              No Routers Connected
            </span>
          )}

          {/* Quick Action Buttons, User Session & Logout */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 px-2.5 py-1.5 rounded-md">
              <Shield className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-slate-400 text-[10px]">Session:</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-bold ${
                currentRole === 'ADMIN'
                  ? 'bg-rose-950 text-rose-300 border border-rose-800'
                  : currentRole === 'MANAGER'
                  ? 'bg-indigo-950 text-indigo-300 border border-indigo-800'
                  : currentRole === 'AGENT'
                  ? 'bg-cyan-950 text-cyan-300 border border-cyan-800'
                  : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
              }`}>
                {currentRole || 'ADMIN'}
              </span>
              {currentUser?.username && (
                <span className="text-[10px] text-slate-300 font-mono hidden sm:inline">
                  ({currentUser.username})
                </span>
              )}
            </div>

            {currentRole === 'ADMIN' && (
              <>
                <button
                  onClick={() => onOpenProvisionModal()}
                  className="hidden sm:flex items-center gap-1.5 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-semibold px-2.5 py-1.5 rounded text-xs transition shadow-sm"
                  title="Provision PPPoE Customer"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  <span>+ Provision PPPoE</span>
                </button>

                <button
                  onClick={() => onOpenOutageModal()}
                  className="hidden sm:flex items-center gap-1.5 bg-rose-600/90 hover:bg-rose-500 text-white font-medium px-2.5 py-1.5 rounded text-xs transition"
                  title="Broadcast Emergency Outage Alert"
                >
                  <Megaphone className="w-3.5 h-3.5" />
                  <span>Outage Broadcast</span>
                </button>
              </>
            )}

            {/* PWA Install Button */}
            <PWAInstallPrompt role={currentRole} variant="button" />

            {onLogout && (
              <button
                onClick={onLogout}
                className="flex items-center gap-1.5 bg-slate-800 hover:bg-rose-900/60 hover:text-rose-200 text-slate-300 font-medium px-2.5 py-1.5 rounded text-xs transition border border-slate-700 cursor-pointer shadow-sm"
                title="Sign Out of Session"
              >
                <LogOut className="w-3.5 h-3.5 text-rose-400" />
                <span>Logout</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Navigation Tabs Filtered by Role */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <nav className="flex space-x-1 sm:space-x-2 overflow-x-auto py-2 scrollbar-none">
          {/* ADMIN TABS */}
          {currentRole === 'ADMIN' && (
            <>
              <button
                onClick={() => setActiveTab('noc')}
                className={`flex items-center gap-2 px-3 py-2 text-xs sm:text-sm font-medium rounded-lg transition whitespace-nowrap ${
                  activeTab === 'noc'
                    ? 'bg-slate-800 text-cyan-400 border border-cyan-500/30 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                <Activity className="w-4 h-4" />
                NOC Command Center
              </button>

              <button
                onClick={() => setActiveTab('operations')}
                className={`flex items-center gap-2 px-3 py-2 text-xs sm:text-sm font-medium rounded-lg transition whitespace-nowrap ${
                  activeTab === 'operations'
                    ? 'bg-slate-800 text-cyan-400 border border-cyan-500/30 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                <Network className="w-4 h-4" />
                Operations &amp; Dispatch
              </button>

              <button
                onClick={() => setActiveTab('mikrotik')}
                className={`flex items-center gap-2 px-3 py-2 text-xs sm:text-sm font-medium rounded-lg transition whitespace-nowrap ${
                  activeTab === 'mikrotik'
                    ? 'bg-slate-800 text-cyan-400 border border-cyan-500/30 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                <Radio className="w-4 h-4" />
                MikroTik RouterOS v7
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-900/60 text-cyan-300 font-mono">
                  Live
                </span>
              </button>

              <button
                onClick={() => setActiveTab('olt')}
                className={`flex items-center gap-2 px-3 py-2 text-xs sm:text-sm font-medium rounded-lg transition whitespace-nowrap ${
                  activeTab === 'olt'
                    ? 'bg-slate-800 text-cyan-400 border border-cyan-500/30 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                <Layers className="w-4 h-4 text-cyan-400" />
                VSOL OLT
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/60 text-emerald-300 font-mono">
                  GPON
                </span>
              </button>

              <button
                onClick={() => setActiveTab('billing')}
                className={`flex items-center gap-2 px-3 py-2 text-xs sm:text-sm font-medium rounded-lg transition whitespace-nowrap ${
                  activeTab === 'billing'
                    ? 'bg-slate-800 text-cyan-400 border border-cyan-500/30 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                <CreditCard className="w-4 h-4" />
                Billing &amp; MRR
              </button>

              <button
                onClick={() => setActiveTab('complaints')}
                className={`flex items-center gap-2 px-3 py-2 text-xs sm:text-sm font-medium rounded-lg transition whitespace-nowrap ${
                  activeTab === 'complaints'
                    ? 'bg-slate-800 text-cyan-400 border border-cyan-500/30 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                <AlertTriangle className="w-4 h-4" />
                Complaints &amp; SLA
                {pendingSlaCount > 0 && (
                  <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-rose-900/80 text-rose-300 border border-rose-700/50 font-mono">
                    {pendingSlaCount}
                  </span>
                )}
              </button>

              <button
                onClick={() => setActiveTab('users')}
                className={`flex items-center gap-2 px-3 py-2 text-xs sm:text-sm font-medium rounded-lg transition whitespace-nowrap ${
                  activeTab === 'users'
                    ? 'bg-slate-800 text-cyan-400 border border-cyan-500/30 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                <Shield className="w-4 h-4 text-cyan-400" />
                User &amp; Access Management
              </button>

              <button
                onClick={() => setActiveTab('permissions')}
                className={`flex items-center gap-2 px-3 py-2 text-xs sm:text-sm font-medium rounded-lg transition whitespace-nowrap ${
                  activeTab === 'permissions'
                    ? 'bg-slate-800 text-cyan-400 border border-cyan-500/30 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                Feature Matrix
              </button>

              <button
                onClick={() => setActiveTab('mobile')}
                className={`flex items-center gap-2 px-3 py-2 text-xs sm:text-sm font-medium rounded-lg transition whitespace-nowrap ${
                  activeTab === 'mobile'
                    ? 'bg-slate-800 text-cyan-400 border border-cyan-500/30 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                <Smartphone className="w-4 h-4" />
                Mobile Apps
              </button>

              <button
                onClick={() => setActiveTab('architecture')}
                className={`flex items-center gap-2 px-3 py-2 text-xs sm:text-sm font-medium rounded-lg transition whitespace-nowrap ${
                  activeTab === 'architecture'
                    ? 'bg-slate-800 text-cyan-400 border border-cyan-500/30 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                <Code2 className="w-4 h-4" />
                Architecture
              </button>

              <button
                onClick={() => setActiveTab('settings')}
                className={`flex items-center gap-2 px-3 py-2 text-xs sm:text-sm font-medium rounded-lg transition whitespace-nowrap ${
                  activeTab === 'settings'
                    ? 'bg-slate-800 text-cyan-400 border border-cyan-500/30 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                <Settings className="w-4 h-4 text-cyan-400" />
                Settings
              </button>
            </>
          )}

          {/* MANAGER TABS */}
          {currentRole === 'MANAGER' && (
            <>
              <button
                onClick={() => setActiveTab('operations')}
                className={`flex items-center gap-2 px-3 py-2 text-xs sm:text-sm font-medium rounded-lg transition whitespace-nowrap ${
                  activeTab === 'operations'
                    ? 'bg-slate-800 text-indigo-400 border border-indigo-500/30 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                <Activity className="w-4 h-4" />
                Operations &amp; Dispatch
              </button>

              <button
                onClick={() => setActiveTab('noc')}
                className={`flex items-center gap-2 px-3 py-2 text-xs sm:text-sm font-medium rounded-lg transition whitespace-nowrap ${
                  activeTab === 'noc'
                    ? 'bg-slate-800 text-indigo-400 border border-indigo-500/30 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                <Network className="w-4 h-4" />
                NOC Overview
              </button>

              <button
                onClick={() => setActiveTab('complaints')}
                className={`flex items-center gap-2 px-3 py-2 text-xs sm:text-sm font-medium rounded-lg transition whitespace-nowrap ${
                  activeTab === 'complaints'
                    ? 'bg-slate-800 text-indigo-400 border border-indigo-500/30 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                <AlertTriangle className="w-4 h-4" />
                Complaints &amp; SLA
                {pendingSlaCount > 0 && (
                  <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-rose-900/80 text-rose-300 border border-rose-700/50 font-mono">
                    {pendingSlaCount}
                  </span>
                )}
              </button>

              <button
                onClick={() => setActiveTab('olt')}
                className={`flex items-center gap-2 px-3 py-2 text-xs sm:text-sm font-medium rounded-lg transition whitespace-nowrap ${
                  activeTab === 'olt'
                    ? 'bg-slate-800 text-indigo-400 border border-indigo-500/30 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                <Layers className="w-4 h-4 text-cyan-400" />
                VSOL OLT
              </button>

              <button
                onClick={() => setActiveTab('billing')}
                className={`flex items-center gap-2 px-3 py-2 text-xs sm:text-sm font-medium rounded-lg transition whitespace-nowrap ${
                  activeTab === 'billing'
                    ? 'bg-slate-800 text-indigo-400 border border-indigo-500/30 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                <CreditCard className="w-4 h-4" />
                Agent Cash &amp; Billing
              </button>
            </>
          )}

          {/* FIELD AGENT TABS */}
          {currentRole === 'AGENT' && (
            <>
              <button
                onClick={() => setActiveTab('agent_portal')}
                className={`flex items-center gap-2 px-3 py-2 text-xs sm:text-sm font-medium rounded-lg transition whitespace-nowrap ${
                  activeTab === 'agent_portal'
                    ? 'bg-slate-800 text-cyan-400 border border-cyan-500/30 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                <Smartphone className="w-4 h-4" />
                My Field Portal (Tickets &amp; Cash)
              </button>

              <button
                onClick={() => setActiveTab('mobile')}
                className={`flex items-center gap-2 px-3 py-2 text-xs sm:text-sm font-medium rounded-lg transition whitespace-nowrap ${
                  activeTab === 'mobile'
                    ? 'bg-slate-800 text-cyan-400 border border-cyan-500/30 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                <Activity className="w-4 h-4" />
                Mobile Device Simulator
              </button>
            </>
          )}
        </nav>
      </div>

      {/* CRON Status Strip if triggered */}
      {lastCronMessage && (
        <div className="bg-slate-900 border-t border-cyan-900/40 px-4 py-1 text-center text-xs text-cyan-300 flex items-center justify-center gap-2 animate-fade-in">
          <RotateCw className="w-3 h-3 text-cyan-400 animate-spin" />
          <span>{lastCronMessage}</span>
        </div>
      )}
    </header>
  );
};
