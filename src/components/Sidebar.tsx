import React from 'react';
import {
  Activity,
  CreditCard,
  Radio,
  Layers,
  AlertTriangle,
  Users,
  Settings,
  Smartphone,
  Database,
  PlusCircle,
  Megaphone,
  Shield,
  CheckCircle2,
  HardDrive,
  Wifi,
  X,
} from 'lucide-react';
import { ActiveTab } from './Header';
import { SystemRole } from '../types/auth';
import { useISP } from '../context/ISPContext';

export interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  onOpenProvisionModal: () => void;
  onOpenOutageModal: () => void;
  onOpenTicketModal: () => void;
  currentRole: SystemRole;
  onSwitchRole?: (role: SystemRole) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  onClose,
  activeTab,
  setActiveTab,
  onOpenProvisionModal,
  onOpenOutageModal,
  onOpenTicketModal,
  currentRole,
  onSwitchRole,
}) => {
  const { complaints, customers, onus, activeSessions, outages } = useISP();

  const activeOutages = outages.filter((o) => o.status === 'investigating' || o.status === 'active');
  const criticalTickets = complaints.filter(
    (c) => (c.priority === 'critical' || c.priority === 'high') && c.status !== 'resolved'
  );

  const menuItems = [
    {
      id: 'noc' as ActiveTab,
      label: 'Dashboard / Overview',
      subtitle: 'Core NOC Fleet Metrics',
      icon: Activity,
      badge: `${activeSessions.length} Online`,
      badgeColor: 'bg-emerald-950 text-emerald-300 border-emerald-800',
    },
    {
      id: 'billing' as ActiveTab,
      label: 'Billing & Invoices',
      subtitle: 'MRR Recovery & Agent Cash',
      icon: CreditCard,
      badge: '$ Recv',
      badgeColor: 'bg-indigo-950 text-indigo-300 border-indigo-800',
    },
    {
      id: 'mikrotik' as ActiveTab,
      label: 'MikroTik Management',
      subtitle: 'PPPoE, Bandwidth & Queues',
      icon: Radio,
      badge: 'v7 Live',
      badgeColor: 'bg-cyan-950 text-cyan-300 border-cyan-800',
    },
    {
      id: 'olt' as ActiveTab,
      label: 'VSOL OLT Monitoring',
      subtitle: 'Optical Rx/Tx dBm & ONUs',
      icon: Layers,
      badge: `${onus.length} ONUs`,
      badgeColor: 'bg-emerald-950 text-emerald-300 border-emerald-800',
    },
    {
      id: 'complaints' as ActiveTab,
      label: 'Complaints & Ticketing',
      subtitle: 'Field SLA Dispatch & Cut',
      icon: AlertTriangle,
      badge: criticalTickets.length > 0 ? `${criticalTickets.length} SLA` : `${complaints.length}`,
      badgeColor:
        criticalTickets.length > 0
          ? 'bg-rose-950 text-rose-300 border-rose-800 animate-pulse'
          : 'bg-slate-800 text-slate-300 border-slate-700',
    },
    {
      id: 'users' as ActiveTab,
      label: 'User & Agent Hub',
      subtitle: 'RBAC, Passwords & Staff',
      icon: Users,
      badge: 'Security',
      badgeColor: 'bg-slate-800 text-slate-300 border-slate-700',
    },
    {
      id: 'mobile' as ActiveTab,
      label: 'Mobile App Simulator',
      subtitle: 'Field Agent & Client Portal',
      icon: Smartphone,
      badge: 'PWA',
      badgeColor: 'bg-cyan-950 text-cyan-300 border-cyan-800',
    },
    {
      id: 'architecture' as ActiveTab,
      label: 'Database & Architecture',
      subtitle: 'PostgreSQL Schema & Audit',
      icon: Database,
      badge: 'SQL',
      badgeColor: 'bg-slate-800 text-slate-400 border-slate-700',
    },
    {
      id: 'settings' as ActiveTab,
      label: 'Settings',
      subtitle: 'Carrier & SNMP Preferences',
      icon: Settings,
      badge: null,
      badgeColor: '',
    },
  ];

  const handleSelectTab = (tab: ActiveTab) => {
    setActiveTab(tab);
    onClose();
  };

  return (
    <>
      {/* 1. Backdrop Overlay (Visible when open) */}
      <div
        onClick={onClose}
        className={`fixed inset-0 bg-slate-950/75 backdrop-blur-sm z-40 transition-opacity duration-300 ${
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        aria-hidden={!isOpen}
      />

      {/* 2. Off-Canvas Collapsible Drawer Sidebar (Hidden by default, slides in from left) */}
      <aside
        className={`fixed top-0 bottom-0 left-0 w-72 max-w-[85vw] bg-slate-900 border-r border-slate-800 text-white z-50 flex flex-col h-full shadow-2xl transition-transform duration-300 ease-in-out select-none ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-label="Main Navigation Drawer"
      >
        {/* Top Header with Carrier Branding & Close Button */}
        <div className="p-4 border-b border-slate-800 bg-slate-950 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-cyan-600 via-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-cyan-500/25">
              <Wifi className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h1 className="font-black text-sm text-white tracking-tight">YOUTH NET</h1>
                <span className="text-[9px] px-1.5 py-0.2 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 font-mono font-bold">
                  FIBER
                </span>
              </div>
              <p className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">
                Carrier NOC v4.2
              </p>
            </div>
          </div>

          {/* Close Button */}
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition cursor-pointer"
            title="Close Menu (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Live Network Health Status Strip */}
        <div className="px-4 py-2 bg-slate-950/60 border-b border-slate-800/80">
          <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-[10px] font-mono">
            <span className="flex items-center gap-1.5 text-emerald-400">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="font-bold">SYSTEM ONLINE</span>
            </span>
            <span className="text-slate-400">{customers.length} Subscribers</span>
          </div>

          {activeOutages.length > 0 && (
            <div
              onClick={() => {
                onOpenOutageModal();
                onClose();
              }}
              className="mt-2 p-2 rounded-lg bg-rose-950/80 border border-rose-800 text-rose-300 text-[10px] font-mono flex items-center justify-between cursor-pointer hover:bg-rose-900 transition animate-pulse"
            >
              <span className="flex items-center gap-1.5 font-bold">
                <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                <span>{activeOutages.length} Outage Active</span>
              </span>
              <span>View &rarr;</span>
            </div>
          )}
        </div>

        {/* Quick Actions Strip */}
        <div className="px-3 pt-3 pb-2 border-b border-slate-800/80 grid grid-cols-2 gap-1.5 text-[11px] font-mono">
          <button
            onClick={() => {
              onOpenProvisionModal();
              onClose();
            }}
            className="px-2 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold rounded-lg transition flex items-center justify-center gap-1 shadow-sm cursor-pointer"
            title="Fast Provision PPPoE Secret & Customer"
          >
            <PlusCircle className="w-3 h-3" />
            <span>+ PPPoE</span>
          </button>

          <button
            onClick={() => {
              onOpenTicketModal();
              onClose();
            }}
            className="px-2 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold rounded-lg border border-slate-700 transition flex items-center justify-center gap-1 cursor-pointer"
            title="Open New SLA Ticket"
          >
            <AlertTriangle className="w-3 h-3 text-amber-400" />
            <span>+ Ticket</span>
          </button>
        </div>

        {/* Main Navigation Menu List */}
        <nav className="flex-1 overflow-y-auto p-3 space-y-1 scrollbar-thin scrollbar-thumb-slate-800">
          <div className="text-[10px] text-slate-500 font-mono font-bold uppercase tracking-wider px-2 py-1">
            Carrier Modules
          </div>

          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;

            return (
              <button
                key={item.id}
                onClick={() => handleSelectTab(item.id)}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left transition cursor-pointer group ${
                  isActive
                    ? 'bg-gradient-to-r from-cyan-600/20 to-blue-600/10 text-cyan-300 border border-cyan-500/40 shadow-sm'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 border border-transparent'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`p-1.5 rounded-lg transition ${
                      isActive
                        ? 'bg-cyan-600 text-slate-950 font-bold shadow-md shadow-cyan-600/30'
                        : 'bg-slate-800/80 text-slate-400 group-hover:text-cyan-400 group-hover:bg-slate-800'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                  </div>
                  <div className="truncate">
                    <span
                      className={`block text-xs font-bold truncate ${
                        isActive ? 'text-white' : 'text-slate-300'
                      }`}
                    >
                      {item.label}
                    </span>
                    <span className="block text-[10px] text-slate-500 font-mono truncate">
                      {item.subtitle}
                    </span>
                  </div>
                </div>

                {item.badge && (
                  <span
                    className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-bold border shrink-0 ml-1.5 ${item.badgeColor}`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Bottom User / Role Card */}
        <div className="p-3 border-t border-slate-800 bg-slate-950/80 text-xs font-mono space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center text-indigo-300 font-bold text-xs">
                <Shield className="w-3.5 h-3.5 text-indigo-400" />
              </div>
              <div>
                <span className="text-[11px] font-bold text-slate-200 block leading-tight">
                  {currentRole === 'ADMIN'
                    ? 'NOC Administrator'
                    : currentRole === 'AGENT'
                    ? 'Field Recovery Agent'
                    : 'Subscriber Portal'}
                </span>
                <span className="text-[9px] text-emerald-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  <span>Full Access</span>
                </span>
              </div>
            </div>

            {onSwitchRole && (
              <select
                value={currentRole}
                onChange={(e) => onSwitchRole(e.target.value as SystemRole)}
                className="bg-slate-900 border border-slate-700 text-slate-300 text-[10px] rounded px-1.5 py-1 focus:outline-none cursor-pointer"
                title="Switch RBAC Test Role"
              >
                <option value="ADMIN">ADMIN</option>
                <option value="AGENT">AGENT</option>
                <option value="CLIENT">CLIENT</option>
              </select>
            )}
          </div>
        </div>
      </aside>
    </>
  );
};
