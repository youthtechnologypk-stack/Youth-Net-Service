import React from 'react';
import {
  Menu,
  X,
  Server,
  Radio,
  PlusCircle,
  AlertTriangle,
  Megaphone,
  Shield,
  Layers,
  RotateCw,
  Search,
} from 'lucide-react';
import { ActiveTab } from './Header';
import { SystemRole } from '../types/auth';
import { useISP } from '../context/ISPContext';
import { Invoice } from '../types/isp';
import { GlobalSearchBar } from './GlobalSearchBar';

export interface NavbarProps {
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
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
}

export const Navbar: React.FC<NavbarProps> = ({
  isSidebarOpen,
  onToggleSidebar,
  activeTab,
  setActiveTab,
  onOpenProvisionModal,
  onOpenOutageModal,
  onOpenTicketModal,
  onOpenAddRouterModal,
  onOpenPaymentModal,
  onOpenReceiptModal,
  currentRole = 'ADMIN',
  onSwitchRole,
}) => {
  const {
    routers,
    selectedRouterId,
    setSelectedRouterId,
    olts,
    selectedOltId,
    setSelectedOltId,
    lastCronMessage,
  } = useISP();

  const currentRouter = routers.find((r) => r.id === selectedRouterId) || routers[0];
  const currentOlt = olts.find((o) => o.id === selectedOltId) || olts[0];

  return (
    <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-30 shadow-md select-none">
      {/* Top Navbar Row */}
      <div className="px-4 py-3 flex items-center justify-between gap-3">
        {/* Left Section: Menu Toggle Button & Brand / Breadcrumb */}
        <div className="flex items-center gap-3">
          {/* Menu Toggle Button (Hamburger / Close) */}
          <button
            onClick={onToggleSidebar}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-mono font-bold transition shadow-sm cursor-pointer ${
              isSidebarOpen
                ? 'bg-cyan-950 text-cyan-300 border-cyan-700 ring-1 ring-cyan-500/50'
                : 'bg-slate-950 hover:bg-slate-800 text-slate-200 hover:text-white border-slate-700'
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
            <span className="font-bold tracking-wide">Menu</span>
          </button>

          {/* Active Section Breadcrumb */}
          <div className="hidden sm:flex items-center gap-2 pl-2 border-l border-slate-800">
            <span className="text-[10px] uppercase font-mono tracking-wider text-slate-500">NOC Area:</span>
            <span className="text-xs font-bold text-cyan-300 font-mono capitalize">
              {activeTab === 'noc'
                ? 'Fleet Overview'
                : activeTab === 'mikrotik'
                ? 'MikroTik RouterOS v7'
                : activeTab === 'olt'
                ? 'VSOL OLT Optics'
                : activeTab === 'billing'
                ? 'Billing & Agent Recovery'
                : activeTab === 'complaints'
                ? 'Field SLA Ticketing'
                : activeTab === 'mobile'
                ? 'Mobile Apps'
                : activeTab === 'users'
                ? 'Users & RBAC'
                : activeTab === 'architecture'
                ? 'Architecture & SQL'
                : 'System Settings'}
            </span>
          </div>
        </div>

        {/* Global Search Bar (Name, IP, Invoice # across app) */}
        <div className="order-last sm:order-none w-full sm:w-auto flex-1 max-w-lg mx-auto sm:mx-4">
          <GlobalSearchBar
            onNavigateTab={setActiveTab}
            onOpenPaymentModal={onOpenPaymentModal}
            onOpenReceiptModal={onOpenReceiptModal}
            className="w-full"
          />
        </div>

        {/* Center/Right Section: Hardware Nodes Quick Pickers & Actions */}
        <div className="flex items-center gap-2 font-mono">
          {/* MikroTik Router Selector */}
          <div className="hidden md:flex items-center gap-1.5 bg-slate-950 border border-slate-800 px-2.5 py-1 rounded-lg text-xs">
            <Radio className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <select
              value={selectedRouterId}
              onChange={(e) => setSelectedRouterId(e.target.value)}
              className="bg-transparent text-slate-200 text-xs focus:outline-none cursor-pointer max-w-[140px] truncate"
              title="Active MikroTik Gateway"
            >
              {routers.map((r) => (
                <option key={r.id} value={r.id} className="bg-slate-900 text-white">
                  {r.name}
                </option>
              ))}
            </select>
          </div>

          {/* VSOL OLT Selector */}
          {olts && olts.length > 0 && (
            <div className="hidden lg:flex items-center gap-1.5 bg-slate-950 border border-slate-800 px-2.5 py-1 rounded-lg text-xs">
              <Layers className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <select
                value={selectedOltId}
                onChange={(e) => setSelectedOltId(e.target.value)}
                className="bg-transparent text-slate-200 text-xs focus:outline-none cursor-pointer max-w-[130px] truncate"
                title="Active VSOL OLT Chassis"
              >
                {olts.map((olt) => (
                  <option key={olt.id} value={olt.id} className="bg-slate-900 text-white">
                    {olt.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Quick Action Buttons */}
          <button
            onClick={onOpenProvisionModal}
            className="hidden sm:flex items-center gap-1.5 bg-cyan-600 hover:bg-cyan-500 text-slate-950 px-2.5 py-1.5 rounded-lg text-xs font-bold transition shadow-sm cursor-pointer"
            title="Fast PPPoE Provisioning"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>Provision</span>
          </button>

          <button
            onClick={onOpenOutageModal}
            className="flex items-center gap-1.5 bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-800 px-2.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer"
            title="Broadcast Outage Notice"
          >
            <Megaphone className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Broadcast</span>
          </button>

          {/* Role Switcher */}
          {onSwitchRole && (
            <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 px-2 py-1 rounded-lg text-[11px]">
              <Shield className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
              <select
                value={currentRole}
                onChange={(e) => onSwitchRole(e.target.value as SystemRole)}
                className="bg-transparent text-slate-300 text-[11px] focus:outline-none cursor-pointer"
                title="Switch Testing Role"
              >
                <option value="ADMIN" className="bg-slate-900 text-white">ADMIN</option>
                <option value="AGENT" className="bg-slate-900 text-white">AGENT</option>
                <option value="CLIENT" className="bg-slate-900 text-white">CLIENT</option>
              </select>
            </div>
          )}
        </div>
      </div>

      {/* CRON Status Strip if triggered */}
      {lastCronMessage && (
        <div className="bg-slate-950 border-t border-cyan-900/40 px-4 py-1 text-center text-xs text-cyan-300 flex items-center justify-center gap-2 animate-fade-in font-mono">
          <RotateCw className="w-3 h-3 text-cyan-400 animate-spin" />
          <span>{lastCronMessage}</span>
        </div>
      )}
    </header>
  );
};
