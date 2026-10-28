import React, { useState, useEffect } from 'react';
import {
  Server,
  Radio,
  Zap,
  Power,
  ShieldAlert,
  Search,
  Plus,
  RefreshCw,
  Cpu,
  Layers,
  CheckCircle,
  CheckCircle2,
  XCircle,
  X,
  ExternalLink,
  Sliders,
  Filter,
  Trash2,
  Activity,
  Globe,
  Edit2,
  Copy,
  Check,
  Terminal,
  ArrowDown,
  ArrowUp,
  Star,
  AlertTriangle,
} from 'lucide-react';
import { useISP } from '../context/ISPContext';
import { useCurrency } from '../context/CurrencyContext';
import { CustomerStatus, InternetPackage, MikrotikRouter } from '../types/isp';
import { AddMikrotikDeviceModal } from './AddMikrotikDeviceModal';
import { AddBandwidthProfileModal } from './AddBandwidthProfileModal';
import { AddUserModal } from './AddUserModal';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';
import { RouterFleet } from './RouterFleet';
import { ActiveSessionsTable } from './ActiveSessionsTable';
import { SubscriberProfileDrawer } from './SubscriberProfileDrawer';
import { RouterInterfacesTable } from './RouterInterfacesTable';

interface MikrotikStudioProps {
  onOpenProvisionModal: () => void;
  onOpenAddRouterModal?: () => void;
}

export const MikrotikStudio: React.FC<MikrotikStudioProps> = ({
  onOpenProvisionModal,
  onOpenAddRouterModal,
}) => {
  const {
    routers,
    selectedRouterId,
    setSelectedRouterId,
    activeSessions,
    routerInterfaces,
    customers,
    packages,
    routerError,
    isSyncingRouter,
    syncSelectedRouterNow,
    kickSession,
    toggleCustomerStatus,
    deleteMikrotikRouter,
    deletePppoeUser,
    deletePackage,
    refreshRouterHealth,
  } = useISP();
  const { formatCurrency, currencySymbol } = useCurrency();

  const [activeSubTab, setActiveSubTab] = useState<'sessions' | 'interfaces' | 'secrets' | 'profiles' | 'routers'>('sessions');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSubscriberUsername, setSelectedSubscriberUsername] = useState<string | null>(null);
  const [isKicking, setIsKicking] = useState<string | null>(null);
  const [testingRouterId, setTestingRouterId] = useState<string | null>(null);
  const [isAddDeviceModalOpen, setIsAddDeviceModalOpen] = useState(false);
  const [isAddUserModalOpen, setIsAddUserModalOpen] = useState(false);
  const [isAddProfileModalOpen, setIsAddProfileModalOpen] = useState(false);
  const [selectedProfileToEdit, setSelectedProfileToEdit] = useState<InternetPackage | null>(null);
  const [copiedProfileId, setCopiedProfileId] = useState<string | null>(null);

  // User Deletion state
  const [userToDelete, setUserToDelete] = useState<{ username: string; name: string } | null>(null);
  const [isDeleteUserDialogOpen, setIsDeleteUserDialogOpen] = useState(false);
  const [isDeletingUser, setIsDeletingUser] = useState(false);

  // Router Deletion state
  const [routerToDelete, setRouterToDelete] = useState<MikrotikRouter | null>(null);
  const [isDeleteRouterDialogOpen, setIsDeleteRouterDialogOpen] = useState(false);
  const [isDeletingRouter, setIsDeletingRouter] = useState(false);

  // Sync Toast Feedback State
  const [syncToast, setSyncToast] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Sync Trigger with Toast Feedback
  const handleTriggerSync = async () => {
    setSyncToast(null);
    try {
      const res = await syncSelectedRouterNow();
      if (res && res.success) {
        setSyncToast({
          type: 'success',
          message: `Synchronized ${res.activeCount} active sessions, ${res.secretsCount} secrets successfully`,
        });
      } else {
        const errMsg = res?.message || res?.error || 'Could not connect to router IP on port 8728';
        setSyncToast({
          type: 'error',
          message: errMsg,
        });
      }
    } catch (err: any) {
      setSyncToast({
        type: 'error',
        message: err?.message || 'Could not connect to router IP on port 8728',
      });
    }
  };

  useEffect(() => {
    if (!syncToast) return;
    const timer = setTimeout(() => setSyncToast(null), 4500);
    return () => clearTimeout(timer);
  }, [syncToast]);

  const currentRouter = routers.find((r) => r.id === selectedRouterId) || routers[0];

  const filteredSessions = activeSessions.filter(
    (s) =>
      s.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.address.includes(searchQuery) ||
      s.callerId.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredCustomers = customers.filter(
    (c) =>
      c.pppoeUsername.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.assignedIp.includes(searchQuery)
  );

  const filteredPackages = packages.filter(
    (p) =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.mikrotikProfile.toLowerCase().includes(searchQuery.toLowerCase()) ||
      `${p.downloadSpeedMbps}`.includes(searchQuery) ||
      `${p.uploadSpeedMbps}`.includes(searchQuery)
  );

  const handleKick = async (sessionId: string, username: string) => {
    setIsKicking(sessionId);
    await kickSession(sessionId);
    setTimeout(() => setIsKicking(null), 800);
  };

  const handleCopyProfileCli = (pkg: InternetPackage) => {
    const rateLimit = `${pkg.uploadSpeedMbps}M/${pkg.downloadSpeedMbps}M`;
    const burst = pkg.burstDownloadMbps
      ? ` ${pkg.burstUploadMbps || 20}M/${pkg.burstDownloadMbps}M ${pkg.burstThresholdMbps || 25}M/${pkg.burstThresholdMbps || 25}M ${pkg.burstTimeSeconds || 16}/${pkg.burstTimeSeconds || 16}`
      : '';
    const cli = `/ppp profile add name="${pkg.mikrotikProfile}" local-address=${pkg.localAddress || '192.168.8.1'} remote-address=${pkg.remoteAddressPool || 'pppoe-pool-default'} rate-limit="${rateLimit}${burst}" dns-server=${(pkg.dnsServers || '8.8.8.8,1.1.1.1').replace(/\s+/g, '')} queue-type-upload=${pkg.queueType || 'default-small'} queue-type-download=${pkg.queueType || 'default-small'} comment="Youth Net - ${pkg.name} (${currencySymbol}${pkg.priceMonthly}/mo)"`;

    navigator.clipboard.writeText(cli);
    setCopiedProfileId(pkg.id);
    setTimeout(() => setCopiedProfileId(null), 2000);
  };

  const handleDeleteProfile = async (pkg: InternetPackage) => {
    const assignedCount = customers.filter((c) => c.packageId === pkg.id).length;
    if (assignedCount > 0) {
      alert(`Cannot delete profile "${pkg.name}": ${assignedCount} active customer(s) are currently provisioned on this bandwidth profile. Please reassign them in PPPoE Secrets before deleting.`);
      return;
    }
    if (confirm(`Are you sure you want to delete bandwidth profile "${pkg.name}" (${pkg.mikrotikProfile})? This will unregister it from the MikroTik BNG profile catalog.`)) {
      const res = await deletePackage(pkg.id);
      if (!res.success && res.message) {
        alert(res.message);
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Router Hardware Telemetry Banner OR Empty State */}
      {!currentRouter || routers.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-10 text-center space-y-4 shadow-xl">
          <div className="w-16 h-16 bg-slate-800/80 rounded-2xl flex items-center justify-center mx-auto border border-slate-700 text-slate-400">
            <Server className="w-8 h-8 text-cyan-400/70" />
          </div>
          <div className="space-y-1.5 max-w-md mx-auto">
            <h4 className="text-base font-bold text-white">No MikroTik Routers Connected</h4>
            <p className="text-xs text-slate-400 leading-relaxed">
              No MikroTik Routers Connected. Click "+ Add Router" to register a BNG/BRAS device.
            </p>
          </div>
          <button
            onClick={() => setIsAddDeviceModalOpen(true)}
            className="inline-flex items-center gap-2 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs px-5 py-2.5 rounded-xl transition shadow-lg shadow-cyan-950/40 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>+ Add Router</span>
          </button>
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
          <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className={`p-3 rounded-lg border ${
                currentRouter.status === 'online'
                  ? 'bg-emerald-950 border-emerald-700/50 text-emerald-400'
                  : currentRouter.status === 'hybrid_online' || currentRouter.mode === 'hybrid'
                  ? 'bg-cyan-950 border-cyan-700/50 text-cyan-400'
                  : 'bg-rose-950 border-rose-700/50 text-rose-400'
              }`}>
                <Server className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-white">{currentRouter.name}</h2>
                  <span className={`text-xs px-2.5 py-1 rounded-full font-mono font-medium flex items-center gap-1.5 shadow-sm ${
                    currentRouter.status === 'online'
                      ? 'bg-emerald-950/90 text-emerald-300 border border-emerald-500/30'
                      : 'bg-rose-950/90 text-rose-300 border border-rose-500/30'
                  }`}>
                    <span className={`w-2 h-2 rounded-full ${currentRouter.status === 'online' ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
                    {currentRouter.status === 'online' ? 'RouterOS v7 REST Live' : 'Router Unreachable'}
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                    {currentRouter.version}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Model: <strong className="text-slate-200">{currentRouter.model}</strong> &bull; IP: <code className="text-cyan-400">{currentRouter.ip || currentRouter.ipAddress}:{currentRouter.port || currentRouter.apiPort || 8729}</code> (RouterOS v7 HTTPS REST API)
                </p>
              </div>
            </div>

            {/* Router Selection Dropdown & Add Router */}
            <div className="flex items-center flex-wrap gap-2.5">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Target Router:</span>
                <select
                  value={selectedRouterId}
                  onChange={(e) => setSelectedRouterId(e.target.value)}
                  className="bg-slate-950 border border-slate-700 text-slate-200 text-xs px-3 py-2 rounded-lg focus:outline-none focus:border-cyan-500 font-mono"
                >
                  {routers.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({r.ip || r.ipAddress}:{r.port || r.apiPort || 8729}) [{r.status.toUpperCase()}]
                    </option>
                  ))}
                </select>
              </div>

              <button
                onClick={handleTriggerSync}
                disabled={isSyncingRouter}
                className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs px-3 py-2 rounded-lg transition shadow-sm cursor-pointer disabled:opacity-50"
                title="Sync live router metrics (/rest/system/resource, /rest/ppp/active, /rest/interface)"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${isSyncingRouter ? 'animate-spin' : ''}`} />
                <span>{isSyncingRouter ? 'Syncing with Router...' : 'Sync Now'}</span>
              </button>

              <button
                onClick={() => setIsAddDeviceModalOpen(true)}
                className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-400 border border-slate-700 font-bold text-xs px-3 py-2 rounded-lg transition shadow-sm cursor-pointer"
                title="Add New MikroTik Router"
              >
                <Plus className="w-3.5 h-3.5 text-cyan-400" />
                <span>+ Add Router</span>
              </button>

              <button
                onClick={() => setIsAddUserModalOpen(true)}
                className="flex items-center gap-1.5 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs px-3.5 py-2 rounded-lg transition cursor-pointer shadow-sm shadow-cyan-950/40"
              >
                <Plus className="w-4 h-4" />
                <span>+ Add PPPoE User</span>
              </button>
            </div>
          </div>

          {/* Live Sync Failure Error Banner */}
          {routerError && (
            <div className="mt-4 p-4 bg-rose-950/40 border border-rose-700/80 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-rose-200 animate-fade-in shadow-lg">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-bold text-rose-300 text-sm">RouterOS REST API Connection Error</h4>
                  <p className="mt-1 font-mono text-rose-200 leading-relaxed font-semibold">
                    {routerError}
                  </p>
                  <p className="mt-1.5 text-rose-400 text-[11px]">
                    💡 <strong>REST API Diagnostic:</strong> Direct HTTPS request to <code className="font-mono text-white bg-rose-900/50 px-1 py-0.5 rounded">https://{currentRouter.ip || currentRouter.ipAddress}:{currentRouter.port || currentRouter.apiPort || 8729}/rest/</code> failed. Verify <code className="font-mono text-white bg-rose-900/50 px-1 py-0.5 rounded">/ip service enable www-ssl</code> is enabled, public IP reachability, SSL certificate validity, and browser CORS permissions.
                  </p>
                </div>
              </div>
              <button
                onClick={handleTriggerSync}
                disabled={isSyncingRouter}
                className="px-3 py-1.5 bg-rose-900/60 hover:bg-rose-800 text-white border border-rose-600 rounded-lg font-mono text-[11px] shrink-0 cursor-pointer disabled:opacity-50 transition flex items-center gap-1.5 shadow-sm"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncingRouter ? 'animate-spin' : ''}`} />
                <span>{isSyncingRouter ? 'Syncing with Router...' : 'Retry Sync'}</span>
              </button>
            </div>
          )}

          {/* Hardware Resource Indicators */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-5 pt-4 border-t border-slate-800 text-xs font-mono">
            <div className="bg-slate-950/60 p-2.5 rounded border border-slate-800/80">
              <span className="text-slate-400">Live WAN (RX / TX)</span>
              <div className="text-sm font-bold mt-0.5 flex items-center gap-1.5 font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-emerald-400">{currentRouter.currentWanRxMbps ?? 0}M</span>
                <span className="text-slate-600">/</span>
                <span className="text-cyan-400">{currentRouter.currentWanTxMbps ?? 0}M</span>
              </div>
            </div>

            <div className="bg-slate-950/60 p-2.5 rounded border border-slate-800/80">
              <span className="text-slate-400">CPU Usage</span>
              <div className="text-cyan-300 font-bold text-sm mt-0.5 flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                {currentRouter.status === 'online' || currentRouter.status === 'hybrid_online' || currentRouter.mode === 'hybrid'
                  ? `${currentRouter.cpuLoad ?? 0}%`
                  : '0% (Offline)'}
              </div>
            </div>

            <div className="bg-slate-950/60 p-2.5 rounded border border-slate-800/80">
              <span className="text-slate-400">Uptime</span>
              <div className="text-slate-200 font-bold text-sm mt-0.5">
                {currentRouter.status === 'online' || currentRouter.status === 'hybrid_online' || currentRouter.mode === 'hybrid'
                  ? (currentRouter.uptime || 'Offline')
                  : 'Offline'}
              </div>
            </div>

            <div className="bg-slate-950/60 p-2.5 rounded border border-slate-800/80">
              <span className="text-slate-400">Active PPPoE</span>
              <div className={`${currentRouter.status === 'online' || currentRouter.status === 'hybrid_online' || currentRouter.mode === 'hybrid' ? 'text-emerald-400' : 'text-slate-500'} font-bold text-sm mt-0.5`}>
                {currentRouter.status === 'online' || currentRouter.status === 'hybrid_online' || currentRouter.mode === 'hybrid'
                  ? `${activeSessions.length} Online`
                  : '0 (Offline)'}
              </div>
            </div>

            <div className="bg-slate-950/60 p-2.5 rounded border border-slate-800/80">
              <span className="text-slate-400">Walled Garden</span>
              <div className="text-amber-400 font-bold text-sm mt-0.5 truncate">
                {currentRouter.walledGardenPool || '172.16.102.0/24'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sub-Navigation & Search Filter Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-900/90 border border-slate-800 p-2 rounded-lg">
        <div className="flex space-x-1 w-full sm:w-auto">
          <button
            onClick={() => setActiveSubTab('sessions')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition flex items-center gap-1.5 ${
              activeSubTab === 'sessions'
                ? 'bg-slate-800 text-cyan-400 border border-cyan-600/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            Active Sessions ({activeSessions.length})
          </button>

          <button
            onClick={() => setActiveSubTab('interfaces')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition flex items-center gap-1.5 ${
              activeSubTab === 'interfaces'
                ? 'bg-slate-800 text-cyan-400 border border-cyan-600/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            Interfaces ({routerInterfaces.length})
          </button>

          <button
            onClick={() => setActiveSubTab('secrets')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition flex items-center gap-1.5 ${
              activeSubTab === 'secrets'
                ? 'bg-slate-800 text-cyan-400 border border-cyan-600/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            Provisioned Secrets ({customers.length})
          </button>

          <button
            onClick={() => setActiveSubTab('profiles')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition flex items-center gap-1.5 ${
              activeSubTab === 'profiles'
                ? 'bg-slate-800 text-cyan-400 border border-cyan-600/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            Bandwidth Profiles ({packages.length})
          </button>

          <button
            onClick={() => setActiveSubTab('routers')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition flex items-center gap-1.5 ${
              activeSubTab === 'routers'
                ? 'bg-slate-800 text-cyan-400 border border-cyan-600/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Server className="w-3.5 h-3.5" />
            Router Fleet ({routers.length})
          </button>
        </div>

        {/* Search Input */}
        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-500" />
          <input
            type="text"
            placeholder="Search username, IP, MAC..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 text-slate-200 text-xs pl-8 pr-3 py-1.5 rounded-md focus:outline-none focus:border-cyan-500 font-mono"
          />
        </div>
      </div>

      {/* SUB-TAB 1: Active Sessions (/ppp/active) */}
      {activeSubTab === 'sessions' && (
        <ActiveSessionsTable
          sessions={activeSessions}
          packages={packages}
          isRouterOnline={currentRouter?.status === 'online'}
          routerIp={currentRouter?.ipAddress || ''}
          onSelectSession={(session) => setSelectedSubscriberUsername(session.username)}
          onKickSession={handleKick}
          onDeleteSecret={async (username) => {
            await deletePppoeUser(username, currentRouter?.id);
          }}
          isKickingId={isKicking}
        />
      )}

      {/* SUB-TAB: Hardware Port & Interface Status (/interface) */}
      {activeSubTab === 'interfaces' && (
        <RouterInterfacesTable
          interfaces={routerInterfaces}
          routerName={currentRouter?.name || 'No Router'}
          routerIp={currentRouter?.ipAddress || ''}
          onRefresh={handleTriggerSync}
        />
      )}

      {/* SUB-TAB 2: Provisioned Secrets (/ppp/secret) */}
      {activeSubTab === 'secrets' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
          <div className="p-4 border-b border-slate-800 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-white">
                Subscriber PPPoE Database (/ppp/secret)
              </h3>
              <p className="text-xs text-slate-400">
                Manage credentials, speed profiles, and trigger automated Walled-Garden isolation.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsAddUserModalOpen(true)}
                className="bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs px-3 py-1.5 rounded-lg transition flex items-center gap-1 shadow-sm cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>+ Add PPPoE User</span>
              </button>
              <button
                onClick={onOpenProvisionModal}
                className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold text-xs px-3 py-1.5 rounded-lg transition cursor-pointer"
              >
                Provision Wizard
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-slate-950 text-slate-400 uppercase tracking-wider text-[11px] border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4">Account & Subscriber</th>
                  <th className="py-3 px-4">PPPoE Username</th>
                  <th className="py-3 px-4">Area Name</th>
                  <th className="py-3 px-4">Static IP</th>
                  <th className="py-3 px-4">State</th>
                  <th className="py-3 px-4">Due Balance</th>
                  <th className="py-3 px-4 text-right">RouterOS State Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-300">
                {filteredCustomers.map((cust) => (
                  <tr
                    key={cust.id}
                    onClick={() => setSelectedSubscriberUsername(cust.pppoeUsername)}
                    className="hover:bg-slate-800/70 transition cursor-pointer group"
                    title="Click to open Subscriber 360° Profile"
                  >
                    <td className="py-3 px-4">
                      <div className="font-bold text-slate-100 group-hover:text-cyan-300 transition flex items-center gap-1.5">
                        <span>{cust.name}</span>
                        <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 text-cyan-400 transition" />
                      </div>
                      <div className="text-[11px] text-slate-400">{cust.accountNumber}</div>
                    </td>
                    <td className="py-3 px-4 text-cyan-300 font-bold">{cust.pppoeUsername}</td>
                    <td className="py-3 px-4 text-slate-400">{cust.areaNode}</td>
                    <td className="py-3 px-4 text-slate-300">{cust.assignedIp}</td>
                    <td className="py-3 px-4 font-sans">
                      <span
                        className={`px-2 py-0.5 rounded text-[11px] font-medium capitalize ${
                          cust.status === 'active'
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                            : cust.status === 'walled_garden'
                            ? 'bg-amber-950 text-amber-300 border border-amber-800'
                            : 'bg-rose-950 text-rose-300 border border-rose-800'
                        }`}
                      >
                        {cust.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-bold text-slate-200">
                      {formatCurrency(cust.balanceDue)}
                    </td>
                    <td className="py-3 px-4 text-right font-sans" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => setSelectedSubscriberUsername(cust.pppoeUsername)}
                          className="bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 px-2 py-1 rounded text-[11px] transition"
                        >
                          360° View
                        </button>

                        {cust.status !== 'walled_garden' ? (
                          <button
                            onClick={() => toggleCustomerStatus(cust.id, 'walled_garden')}
                            className="bg-amber-950/80 hover:bg-amber-900 border border-amber-800 text-amber-300 px-2 py-1 rounded text-[11px] transition"
                            title="Redirect to Walled Garden captive portal"
                          >
                            Isolate to Walled Garden
                          </button>
                        ) : (
                          <button
                            onClick={() => toggleCustomerStatus(cust.id, 'active')}
                            className="bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-800 text-emerald-300 px-2 py-1 rounded text-[11px] transition"
                            title="Restore high-speed service"
                          >
                            Restore Active
                          </button>
                        )}

                        <button
                          onClick={() =>
                            toggleCustomerStatus(
                              cust.id,
                              cust.status === 'disabled' ? 'active' : 'disabled'
                            )
                          }
                          className={`px-2 py-1 rounded text-[11px] transition border ${
                            cust.status === 'disabled'
                              ? 'bg-slate-800 border-slate-700 text-slate-300'
                              : 'bg-rose-950/60 border-rose-800 text-rose-300'
                          }`}
                        >
                          {cust.status === 'disabled' ? 'Enable' : 'Disable'}
                        </button>

                        <button
                          onClick={() => {
                            setUserToDelete({ username: cust.pppoeUsername, name: cust.name });
                            setIsDeleteUserDialogOpen(true);
                          }}
                          className="px-2 py-1 rounded text-[11px] transition bg-rose-950/80 hover:bg-rose-900 border border-rose-800 text-rose-300 flex items-center gap-1 cursor-pointer"
                          title="Delete Secret on MikroTik & Terminate Session"
                        >
                          <Trash2 className="w-3 h-3 text-rose-400" />
                          <span>Delete</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredCustomers.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-400 font-sans">
                      <div className="space-y-1">
                        <p className="text-slate-300 font-medium">No provisioned PPPoE secrets found on this router.</p>
                        <p className="text-xs text-slate-500">RouterOS /ppp/secret returned 0 subscriber credentials.</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUB-TAB 3: Bandwidth Profiles (/ppp/profile & /queue/simple) */}
      {activeSubTab === 'profiles' && (
        <div className="space-y-4">
          {/* Profiles Header & Action Bar */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-slate-900 border border-slate-800 p-4 rounded-xl shadow-lg">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <span>Carrier Bandwidth Profiles</span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 font-mono">
                    {packages.length} Profiles Live
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 font-mono">
                    RouterOS v7 Synced
                  </span>
                </h3>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Define upload/download rate limits, burst parameters, and monthly tariffs pushed directly to MikroTik <code className="text-cyan-400 font-mono">/ppp/profile</code> and <code className="text-cyan-400 font-mono">/queue/simple</code>.
              </p>
            </div>

            <button
              onClick={() => {
                setSelectedProfileToEdit(null);
                setIsAddProfileModalOpen(true);
              }}
              className="bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs px-4 py-2 rounded-lg transition flex items-center gap-1.5 shadow-lg shadow-cyan-950/40 shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>+ Add Bandwidth Profile</span>
            </button>
          </div>

          {/* Profiles Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredPackages.map((pkg) => {
              const assignedCusts = customers.filter((c) => c.packageId === pkg.id);
              const isCopied = copiedProfileId === pkg.id;

              return (
                <div
                  key={pkg.id}
                  className="bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl p-5 space-y-4 shadow-lg transition flex flex-col justify-between"
                >
                  <div className="space-y-3">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <h4 className="text-base font-bold text-white">{pkg.name}</h4>
                          {pkg.isPopular && (
                            <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-950 text-amber-300 border border-amber-800 font-mono font-bold flex items-center gap-0.5">
                              <Star className="w-2.5 h-2.5 fill-amber-400 text-amber-400" />
                              POPULAR
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-cyan-400 font-mono block">
                          Profile: {pkg.mikrotikProfile}
                        </span>
                      </div>

                      <div className="text-right shrink-0">
                        <div className="text-lg font-bold text-emerald-400 font-mono">
                          {formatCurrency(pkg.priceMonthly)}
                        </div>
                        <span className="text-[10px] text-slate-500">/ month</span>
                      </div>
                    </div>

                    {/* Speed Highlights */}
                    <div className="grid grid-cols-2 gap-2 font-mono">
                      <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800/80">
                        <span className="text-[10px] text-slate-500 flex items-center gap-1">
                          <ArrowDown className="w-3 h-3 text-emerald-400" />
                          <span>Download Speed</span>
                        </span>
                        <span className="text-sm font-bold text-emerald-300 block mt-0.5">
                          {pkg.downloadSpeedMbps} Mbps
                        </span>
                      </div>

                      <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800/80">
                        <span className="text-[10px] text-slate-500 flex items-center gap-1">
                          <ArrowUp className="w-3 h-3 text-cyan-400" />
                          <span>Upload Speed</span>
                        </span>
                        <span className="text-sm font-bold text-cyan-300 block mt-0.5">
                          {pkg.uploadSpeedMbps} Mbps
                        </span>
                      </div>
                    </div>

                    {/* Technical BNG Specs */}
                    <div className="bg-slate-950 p-3 rounded-lg border border-slate-800/80 space-y-1.5 font-mono text-xs">
                      <div className="flex justify-between items-center">
                        <span className="text-slate-400">RouterOS Rate-Limit:</span>
                        <span className="text-white font-bold bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                          {pkg.uploadSpeedMbps}M/{pkg.downloadSpeedMbps}M
                        </span>
                      </div>

                      <div className="flex justify-between items-center">
                        <span className="text-slate-400">Data Allocation:</span>
                        <span className="text-slate-300">
                          {pkg.dataLimitGb ? `${pkg.dataLimitGb} GB` : 'Uncapped / Unlimited'}
                        </span>
                      </div>

                      <div className="flex justify-between items-center">
                        <span className="text-slate-400">Local Gateway IP:</span>
                        <span className="text-slate-300">{pkg.localAddress || '192.168.8.1'}</span>
                      </div>

                      <div className="flex justify-between items-center">
                        <span className="text-slate-400">Remote Pool:</span>
                        <span className="text-slate-300">{pkg.remoteAddressPool || 'pppoe-pool-default'}</span>
                      </div>

                      {pkg.burstDownloadMbps && (
                        <div className="flex justify-between items-center pt-1 border-t border-slate-800/60 text-[11px] text-amber-300">
                          <span>Burst Speed:</span>
                          <span>{pkg.burstUploadMbps || 20}M/{pkg.burstDownloadMbps}M ({pkg.burstTimeSeconds || 16}s)</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Card Footer: Subscribers & Actions */}
                  <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between gap-2 font-mono">
                    <span className="text-xs text-slate-400">
                      Subscribers: <strong className="text-slate-200">{assignedCusts.length} users</strong>
                    </span>

                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => handleCopyProfileCli(pkg)}
                        className="p-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 text-slate-300 hover:text-cyan-400 border border-slate-800 transition cursor-pointer"
                        title="Copy MikroTik RouterOS v7 CLI Syntax"
                      >
                        {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Terminal className="w-3.5 h-3.5" />}
                      </button>

                      <button
                        onClick={() => {
                          setSelectedProfileToEdit(pkg);
                          setIsAddProfileModalOpen(true);
                        }}
                        className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 text-[11px] font-bold transition flex items-center gap-1 cursor-pointer"
                        title="Edit Bandwidth Profile"
                      >
                        <Edit2 className="w-3 h-3" />
                        <span>Edit</span>
                      </button>

                      <button
                        onClick={() => handleDeleteProfile(pkg)}
                        className="p-1.5 rounded-lg bg-slate-950 hover:bg-rose-950 text-slate-400 hover:text-rose-400 border border-slate-800 transition cursor-pointer"
                        title="Delete Profile"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* SUB-TAB 4: Router Fleet & Hardware Management */}
      {activeSubTab === 'routers' && (
        <RouterFleet onOpenAddDeviceModal={() => setIsAddDeviceModalOpen(true)} />
      )}

      {/* Add PPPoE User Modal */}
      <AddUserModal
        isOpen={isAddUserModalOpen}
        onClose={() => setIsAddUserModalOpen(false)}
      />

      {/* Delete User Confirmation Dialog */}
      <DeleteConfirmDialog
        isOpen={isDeleteUserDialogOpen}
        onClose={() => {
          setIsDeleteUserDialogOpen(false);
          setUserToDelete(null);
        }}
        onConfirm={async () => {
          if (!userToDelete) return;
          setIsDeletingUser(true);
          try {
            await deletePppoeUser(userToDelete.username);
          } finally {
            setIsDeletingUser(false);
            setIsDeleteUserDialogOpen(false);
            setUserToDelete(null);
          }
        }}
        title="Delete PPPoE Subscriber"
        itemName={userToDelete ? userToDelete.username : ''}
        itemType="user"
        description={
          userToDelete
            ? `Are you sure you want to delete PPPoE subscriber "${userToDelete.name}" (@${userToDelete.username})? This terminates their active session on MikroTik and soft-deletes the record in PostgreSQL.`
            : undefined
        }
        confirmText="Delete Secret & Kill Session"
        isLoading={isDeletingUser}
      />

      {/* Delete Router Confirmation Dialog */}
      <DeleteConfirmDialog
        isOpen={isDeleteRouterDialogOpen}
        onClose={() => {
          setIsDeleteRouterDialogOpen(false);
          setRouterToDelete(null);
        }}
        onConfirm={async () => {
          if (!routerToDelete) return;
          setIsDeletingRouter(true);
          try {
            await deleteMikrotikRouter(routerToDelete.id);
          } finally {
            setIsDeletingRouter(false);
            setIsDeleteRouterDialogOpen(false);
            setRouterToDelete(null);
          }
        }}
        title="Delete MikroTik BNG Router"
        itemName={routerToDelete ? routerToDelete.name : ''}
        itemType="router"
        description={
          routerToDelete
            ? `Are you sure you want to remove router "${routerToDelete.name}" (${routerToDelete.ipAddress}:${routerToDelete.apiPort})? This deletes its credentials from PostgreSQL and terminates background polling.`
            : undefined
        }
        confirmText="Remove Router Configuration"
        isLoading={isDeletingRouter}
      />

      {/* Add MikroTik Device Modal */}
      <AddMikrotikDeviceModal
        isOpen={isAddDeviceModalOpen}
        onClose={() => setIsAddDeviceModalOpen(false)}
      />

      {/* Add / Edit Bandwidth Profile Modal */}
      <AddBandwidthProfileModal
        isOpen={isAddProfileModalOpen}
        onClose={() => {
          setIsAddProfileModalOpen(false);
          setSelectedProfileToEdit(null);
        }}
        profileToEdit={selectedProfileToEdit}
      />

      {/* Subscriber 360° Detail Drawer / Modal */}
      <SubscriberProfileDrawer
        isOpen={Boolean(selectedSubscriberUsername)}
        username={selectedSubscriberUsername}
        onClose={() => setSelectedSubscriberUsername(null)}
      />
    </div>
  );
};
