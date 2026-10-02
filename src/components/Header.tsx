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
  Users,
  Layers,
  Settings,
  Menu,
  X,
} from 'lucide-react';
import { useISP } from '../context/ISPContext';
import { SystemRole } from '../types/auth';
import { Invoice } from '../types/isp';
import { GlobalSearchBar } from './GlobalSearchBar';

export type ActiveTab = 'noc' | 'mikrotik' | 'olt' | 'billing' | 'complaints' | 'mobile' | 'users' | 'architecture' | 'settings';

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

  const currentRouter = routers.find((r) => r.id === selectedRouterId) || routers[0];
  const pendingSlaCount = complaints.filter((c) => c.status !== 'resolved' && c.status !== 'closed').length;

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
              {routers.map((r) => (
                <option key={r.id} value={r.id} className="bg-slate-900 text-slate-100">
                  {r.name} ({r.ipAddress})
                </option>
              ))}
            </select>
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
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

          <div className="hidden lg:flex items-center gap-3 bg-slate-900/80 border border-slate-800 px-3 py-1.5 rounded-md text-slate-300">
            <span>
              CPU: <strong className="text-cyan-300">{currentRouter.cpuLoad}%</strong>
            </span>
            <span className="text-slate-600">|</span>
            <span>
              WAN: <strong className="text-emerald-400">{(currentRouter.currentWanRxMbps / 1000).toFixed(2)} Gbps</strong>
            </span>
            <span className="text-slate-600">|</span>
            <span>
              Sessions: <strong className="text-indigo-300">{activeSessions.length} active</strong>
            </span>
          </div>

          {/* Quick Action Buttons & Role Badge */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 px-2.5 py-1.5 rounded-md">
              <Shield className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-slate-400 text-[10px]">Session:</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-bold ${
                currentRole === 'ADMIN'
                  ? 'bg-rose-950 text-rose-300 border border-rose-800'
                  : currentRole === 'AGENT'
                  ? 'bg-cyan-950 text-cyan-300 border border-cyan-800'
                  : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
              }`}>
                {currentRole || 'ADMIN'}
              </span>
            </div>

            <button
              onClick={() => onOpenProvisionModal()}
              className="flex items-center gap-1.5 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-semibold px-2.5 py-1.5 rounded text-xs transition shadow-sm"
              title="Provision PPPoE Customer"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span>+ Provision PPPoE</span>
            </button>

            <button
              onClick={() => onOpenOutageModal()}
              className="flex items-center gap-1.5 bg-rose-600/90 hover:bg-rose-500 text-white font-medium px-2.5 py-1.5 rounded text-xs transition"
              title="Broadcast Emergency Outage Alert"
            >
              <Megaphone className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Outage Broadcast</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Navigation Tabs */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <nav className="flex space-x-1 sm:space-x-2 overflow-x-auto py-2 scrollbar-none">
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
              GPON/EPON
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
            Billing & Agent Cash
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
            Complaints & SLA
            {pendingSlaCount > 0 && (
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-rose-900/80 text-rose-300 border border-rose-700/50 font-mono">
                {pendingSlaCount}
              </span>
            )}
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
            Field & Client Mobile Apps
            <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-900/50 text-amber-300 font-mono">
              Dual
            </span>
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
            Users &amp; RBAC
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
            Architecture & SQL DDL
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
