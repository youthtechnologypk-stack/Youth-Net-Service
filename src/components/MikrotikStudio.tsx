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
  Calendar,
  Clock,
  Hourglass,
} from 'lucide-react';
import { useISP } from '../context/ISPContext';
import { useCurrency } from '../context/CurrencyContext';
import { CustomerStatus, InternetPackage, MikrotikRouter, MikrotikPppProfile, MikrotikPppSecret } from '../types/isp';
import { AddMikrotikDeviceModal } from './AddMikrotikDeviceModal';
import { AddBandwidthProfileModal } from './AddBandwidthProfileModal';
import { AddUserModal } from './AddUserModal';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';
import { RouterFleet } from './RouterFleet';
import { ActiveSessionsTable } from './ActiveSessionsTable';
import { SubscriberProfileDrawer } from './SubscriberProfileDrawer';
import { RouterInterfacesTable } from './RouterInterfacesTable';
import {
  parseMikrotikComment,
  calculateExpirationMetrics,
} from '../services/mikrotikSubscriberSync';

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
    provisionedSecrets,
    bandwidthProfiles,
    routerError,
    isSslOrCorsBlocked,
    directCertUrl,
    routerProxyMode,
    setRouterProxyMode,
    isSyncingRouter,
    syncSelectedRouterNow,
    kickSession,
    toggleCustomerStatus,
    deleteMikrotikRouter,
    deletePppoeUser,
    deletePackage,
    refreshRouterHealth,
    renewSubscriberPackage,
    updatePackagePrice,
    profilePriceMap,
  } = useISP();
  const { formatCurrency, currencySymbol } = useCurrency();

  const [activeSubTab, setActiveSubTab] = useState<'sessions' | 'interfaces' | 'secrets' | 'profiles' | 'routers'>('sessions');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSubscriberUsername, setSelectedSubscriberUsername] = useState<string | null>(null);
  const [isKicking, setIsKicking] = useState<string | null>(null);
  const [isRenewing, setIsRenewing] = useState<string | null>(null);
  const [testingRouterId, setTestingRouterId] = useState<string | null>(null);
  const [isAddDeviceModalOpen, setIsAddDeviceModalOpen] = useState(false);
  const [isAddUserModalOpen, setIsAddUserModalOpen] = useState(false);
  const [isAddProfileModalOpen, setIsAddProfileModalOpen] = useState(false);
  const [selectedProfileToEdit, setSelectedProfileToEdit] = useState<InternetPackage | null>(null);
  const [copiedProfileId, setCopiedProfileId] = useState<string | null>(null);

  // Profile Price Quick Edit State
  const [priceEditTarget, setPriceEditTarget] = useState<{ profileName: string; currentPrice: number } | null>(null);
  const [newPriceValue, setNewPriceValue] = useState<number>(2500);

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

  // Listen for programmatic router auth errors to display custom toast instead of native browser popup
  useEffect(() => {
    const handleAuthError = (e: any) => {
      const msg = e.detail?.message || 'Action failed: Router authentication error. Please verify credentials.';
      setSyncToast({
        type: 'error',
        message: msg,
      });
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('mikrotik_auth_error', handleAuthError);
      return () => window.removeEventListener('mikrotik_auth_error', handleAuthError);
    }
  }, []);

  const currentRouter = routers.find((r) => r.id === selectedRouterId) || routers[0];

  const hasLiveSecrets = Boolean(provisionedSecrets && provisionedSecrets.length > 0);
  const displaySecretsCount = hasLiveSecrets ? provisionedSecrets.length : customers.length;

  const hasLiveProfiles = Boolean(bandwidthProfiles && bandwidthProfiles.length > 0);
  const displayProfilesCount = hasLiveProfiles ? bandwidthProfiles.length : packages.length;

  const filteredSecrets = (hasLiveSecrets ? provisionedSecrets : []).filter((s) => {
    const q = searchQuery.toLowerCase();
    return (
      (s.name && s.name.toLowerCase().includes(q)) ||
      (s.profile && s.profile.toLowerCase().includes(q)) ||
      (s['remote-address'] && s['remote-address'].toLowerCase().includes(q)) ||
      (s.service && s.service.toLowerCase().includes(q)) ||
      (s.comment && s.comment.toLowerCase().includes(q))
    );
  });

  const filteredDynamicProfiles = (hasLiveProfiles ? bandwidthProfiles : []).filter((p) => {
    const q = searchQuery.toLowerCase();
    return (
      (p.name && p.name.toLowerCase().includes(q)) ||
      (p['rate-limit'] && p['rate-limit'].toLowerCase().includes(q)) ||
      (p['remote-address'] && p['remote-address'].toLowerCase().includes(q)) ||
      (p['local-address'] && p['local-address'].toLowerCase().includes(q))
    );
  });

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
    try {
      const res = await kickSession(sessionId);
      if (res && (res as any).success === false) {
        setSyncToast({
          type: 'error',
          message: (res as any).message || 'Action failed: Router authentication error. Please verify credentials.',
        });
      } else {
        setSyncToast({
          type: 'success',
          message: `User ${username} kicked successfully`,
        });
      }
    } catch (err: any) {
      setSyncToast({
        type: 'error',
        message: err?.message || 'Failed to kick session',
      });
    } finally {
      setIsKicking(null);
    }
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
                  Model: <strong className="text-slate-200">{currentRouter.model}</strong> &bull; IP: <code className="text-cyan-400">{currentRouter.ip || currentRouter.ipAddress}:{currentRouter.port || (currentRouter.useSsl ? 443 : 80)}</code> (RouterOS v7 HTTPS REST API)
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
                      {r.name} ({r.ip || r.ipAddress}:{r.port || (r.useSsl ? 443 : 80)}) [{r.status.toUpperCase()}]
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

          {/* Live Sync Failure / SSL Certificate / Proxy Error Banner */}
          {routerError && (
            <div className="mt-4 p-4 bg-rose-950/40 border border-rose-700/80 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-rose-200 animate-fade-in shadow-lg">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="font-bold text-rose-300 text-sm">RouterOS REST API Connection Error</h4>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-rose-900/60 text-rose-200 font-mono font-bold uppercase border border-rose-700/60">
                      Disconnected
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-rose-200 leading-relaxed font-semibold">
                    {routerError}
                  </p>
                  <p className="mt-1.5 text-rose-300 text-xs flex flex-wrap items-center gap-1.5">
                    <span>Browser blocked self-signed SSL.</span>
                    <a
                      href={directCertUrl || `https://${currentRouter.ip || currentRouter.ipAddress || '202.142.186.150'}:${currentRouter.port || 443}/rest/system/resource`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-cyan-300 underline font-bold hover:text-cyan-200 inline-flex items-center gap-1 bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-800"
                    >
                      [Click here to authorize certificate in new tab]
                      <ExternalLink className="w-3 h-3" />
                    </a>
                    <span>, then click Retry Sync.</span>
                  </p>
                  <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-300">
                    <span className="text-slate-400">Current Gateway Mode:</span>
                    <span className="font-mono font-bold text-cyan-300">
                      {routerProxyMode === 'proxy' ? 'Netlify Managed Proxy Mode (/api/mikrotik)' : 'Direct IP Mode'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setRouterProxyMode(routerProxyMode === 'proxy' ? 'direct' : 'proxy')}
                      className="text-[10px] text-cyan-400 underline hover:text-cyan-300 ml-1 cursor-pointer font-semibold"
                    >
                      Switch to {routerProxyMode === 'proxy' ? 'Direct IP Mode' : 'Netlify Managed Proxy Mode'}
                    </button>
                  </div>
                </div>
              </div>
              <button
                onClick={handleTriggerSync}
                disabled={isSyncingRouter}
                className="px-3.5 py-2 bg-rose-900/80 hover:bg-rose-800 text-white border border-rose-600 rounded-lg font-mono text-xs shrink-0 cursor-pointer disabled:opacity-50 transition flex items-center gap-1.5 shadow-md"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncingRouter ? 'animate-spin' : ''}`} />
                <span>{isSyncingRouter ? 'Connecting...' : 'Retry Sync'}</span>
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
            Provisioned Secrets ({displaySecretsCount})
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
            Bandwidth Profiles ({displayProfilesCount})
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
                  <th className="py-3 px-4">Username &amp; Account</th>
                  <th className="py-3 px-4">Bandwidth Profile</th>
                  <th className="py-3 px-4">Assigned Remote IP</th>
                  <th className="py-3 px-4">Service</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Created / Expiry</th>
                  <th className="py-3 px-4 text-right">RouterOS State Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-300">
                {hasLiveSecrets
                  ? filteredSecrets.map((secret) => {
                      const username = secret.name;
                      const isOnline = activeSessions.some(
                        (s) => s.username?.toLowerCase() === username?.toLowerCase()
                      );
                      const liveSession = activeSessions.find(
                        (s) => s.username?.toLowerCase() === username?.toLowerCase()
                      );
                      const linkedCust = customers.find(
                        (c) => c.pppoeUsername?.toLowerCase() === username?.toLowerCase()
                      );
                      const parsed = parseMikrotikComment(secret.comment, username);
                      const createdDate = parsed.createdDate || linkedCust?.createdDate || '2026-10-30';
                      const expiryDate = parsed.expiryDate || linkedCust?.expiryDate || '2026-11-29';
                      const metrics = calculateExpirationMetrics(expiryDate);
                      const validity = parsed.validityDays || linkedCust?.validityDays || 30;
                      const pctRemaining = Math.max(0, Math.min(100, Math.round((metrics.daysRemaining / validity) * 100)));
                      const isExpired = metrics.isExpired || linkedCust?.status === 'walled_garden' || secret.profile?.toLowerCase().includes('expired');
                      const isDisabled = secret.disabled === true || secret.disabled === 'true' || linkedCust?.status === 'disabled';
                      const remoteIp = secret['remote-address'] || liveSession?.address || linkedCust?.assignedIp || 'Dynamic';
                      const service = secret.service || 'pppoe';

                      return (
                        <tr
                          key={secret['.id'] || username}
                          onClick={() => setSelectedSubscriberUsername(username)}
                          className="hover:bg-slate-800/70 transition cursor-pointer group"
                          title="Click to open Subscriber 360° Profile"
                        >
                          <td className="py-3 px-4">
                            <div className="font-bold text-slate-100 group-hover:text-cyan-300 transition flex items-center gap-1.5">
                              <span className="text-cyan-300 font-mono font-bold">{username}</span>
                              <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 text-cyan-400 transition" />
                            </div>
                            <div className="text-[11px] text-slate-400">
                              {linkedCust?.name ? `${linkedCust.name} (${linkedCust.accountNumber})` : parsed.phone || 'RouterOS Secret'}
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <span className="px-2 py-0.5 rounded bg-slate-800 text-cyan-300 border border-slate-700 font-mono">
                              {secret.profile || 'default'}
                            </span>
                          </td>
                          <td className="py-3 px-4 font-mono text-emerald-400">
                            {remoteIp}
                          </td>
                          <td className="py-3 px-4">
                            <span className="px-2 py-0.5 rounded bg-slate-950 text-slate-300 border border-slate-800 uppercase text-[10px] font-mono">
                              {service}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            {isOnline ? (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold font-mono inline-flex items-center gap-1.5 bg-emerald-950 text-emerald-300 border border-emerald-800 shadow-sm">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                ONLINE
                              </span>
                            ) : isDisabled ? (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold font-mono inline-flex items-center gap-1.5 bg-rose-950 text-rose-300 border border-rose-800">
                                DISABLED
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold font-mono inline-flex items-center gap-1.5 bg-slate-800 text-slate-400 border border-slate-700">
                                OFFLINE
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 font-sans whitespace-nowrap">
                            <div className="space-y-1">
                              <div className="flex items-center gap-1.5">
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono inline-flex items-center gap-1 border ${
                                    isExpired
                                      ? 'bg-rose-950 text-rose-300 border-rose-800 animate-pulse font-bold'
                                      : metrics.daysRemaining <= 5
                                      ? 'bg-amber-950 text-amber-300 border border-amber-800'
                                      : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                                  }`}
                                >
                                  <Clock className="w-2.5 h-2.5" />
                                  <span>{isExpired ? 'EXPIRED / RESTRICTED' : metrics.remainingText}</span>
                                </span>
                                <span className="text-[10px] text-slate-400 font-mono">
                                  {expiryDate}
                                </span>
                              </div>
                              {!isExpired && (
                                <div className="w-20 bg-slate-800 h-1 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full transition-all duration-500 ${
                                      metrics.daysRemaining <= 5 ? 'bg-amber-400' : 'bg-emerald-400'
                                    }`}
                                    style={{ width: `${pctRemaining}%` }}
                                  />
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-right font-sans" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-1.5 flex-wrap">
                              <button
                                onClick={async () => {
                                  setIsRenewing(username);
                                  try {
                                    const res = await renewSubscriberPackage(username, 30);
                                    setSyncToast({ type: 'success', message: res.message });
                                  } catch (err: any) {
                                    setSyncToast({ type: 'error', message: err.message || 'Renewal failed' });
                                  } finally {
                                    setIsRenewing(null);
                                  }
                                }}
                                disabled={isRenewing === username}
                                className="bg-cyan-950/90 hover:bg-cyan-900 border border-cyan-700 text-cyan-300 px-2 py-1 rounded text-[11px] transition flex items-center gap-1 cursor-pointer font-bold shadow-sm disabled:opacity-50"
                                title="Extend package validity by +30 Days"
                              >
                                <RefreshCw className={`w-3 h-3 text-cyan-400 ${isRenewing === username ? 'animate-spin' : ''}`} />
                                <span>+ Renew</span>
                              </button>

                              <button
                                onClick={() => setSelectedSubscriberUsername(username)}
                                className="bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 px-2 py-1 rounded text-[11px] transition cursor-pointer"
                              >
                                360° View
                              </button>

                              {linkedCust && (
                                <button
                                  onClick={() =>
                                    toggleCustomerStatus(
                                      linkedCust.id,
                                      linkedCust.status === 'disabled' ? 'active' : 'disabled'
                                    )
                                  }
                                  className={`px-2 py-1 rounded text-[11px] transition border cursor-pointer ${
                                    linkedCust.status === 'disabled'
                                      ? 'bg-slate-800 border-slate-700 text-slate-300'
                                      : 'bg-rose-950/60 border-rose-800 text-rose-300'
                                  }`}
                                >
                                  {linkedCust.status === 'disabled' ? 'Enable' : 'Disable'}
                                </button>
                              )}

                              <button
                                onClick={() => {
                                  setUserToDelete({ username, name: linkedCust?.name || username });
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
                      );
                    })
                  : filteredCustomers.map((cust) => {
                      const username = cust.pppoeUsername;
                      const isOnline = activeSessions.some(
                        (s) => s.username?.toLowerCase() === username?.toLowerCase()
                      );
                      const parsed = parseMikrotikComment(cust.comment, username);
                      const createdDate = cust.createdDate || parsed.createdDate || cust.installationDate || '2026-10-30';
                      const expiryDate = cust.expiryDate || parsed.expiryDate || '2026-11-29';
                      const metrics = calculateExpirationMetrics(expiryDate);
                      const validity = cust.validityDays || parsed.validityDays || 30;
                      const pctRemaining = Math.max(0, Math.min(100, Math.round((metrics.daysRemaining / validity) * 100)));
                      const isExpired = metrics.isExpired || cust.status === 'walled_garden' || cust.status === 'expired';

                      return (
                        <tr
                          key={cust.id}
                          onClick={() => setSelectedSubscriberUsername(username)}
                          className="hover:bg-slate-800/70 transition cursor-pointer group"
                          title="Click to open Subscriber 360° Profile"
                        >
                          <td className="py-3 px-4">
                            <div className="font-bold text-slate-100 group-hover:text-cyan-300 transition flex items-center gap-1.5">
                              <span className="text-cyan-300 font-mono font-bold">{username}</span>
                              <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 text-cyan-400 transition" />
                            </div>
                            <div className="text-[11px] text-slate-400">{cust.name} ({cust.accountNumber})</div>
                          </td>
                          <td className="py-3 px-4">
                            <span className="px-2 py-0.5 rounded bg-slate-800 text-cyan-300 border border-slate-700 font-mono">
                              {packages.find((p) => p.id === cust.packageId)?.mikrotikProfile || 'default'}
                            </span>
                          </td>
                          <td className="py-3 px-4 font-mono text-emerald-400">
                            {cust.assignedIp || 'Dynamic'}
                          </td>
                          <td className="py-3 px-4">
                            <span className="px-2 py-0.5 rounded bg-slate-950 text-slate-300 border border-slate-800 uppercase text-[10px] font-mono">
                              PPPOE
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            {isOnline ? (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold font-mono inline-flex items-center gap-1.5 bg-emerald-950 text-emerald-300 border border-emerald-800 shadow-sm">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                ONLINE
                              </span>
                            ) : cust.status === 'disabled' ? (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold font-mono inline-flex items-center gap-1.5 bg-rose-950 text-rose-300 border border-rose-800">
                                DISABLED
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold font-mono inline-flex items-center gap-1.5 bg-slate-800 text-slate-400 border border-slate-700">
                                OFFLINE
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 font-sans whitespace-nowrap">
                            <div className="space-y-1">
                              <div className="flex items-center gap-1.5">
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono inline-flex items-center gap-1 border ${
                                    isExpired
                                      ? 'bg-rose-950 text-rose-300 border-rose-800 animate-pulse font-bold'
                                      : metrics.daysRemaining <= 5
                                      ? 'bg-amber-950 text-amber-300 border border-amber-800'
                                      : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                                  }`}
                                >
                                  <Clock className="w-2.5 h-2.5" />
                                  <span>{isExpired ? 'EXPIRED / RESTRICTED' : metrics.remainingText}</span>
                                </span>
                                <span className="text-[10px] text-slate-400 font-mono">
                                  {expiryDate}
                                </span>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-right font-sans" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-1.5 flex-wrap">
                              <button
                                onClick={async () => {
                                  setIsRenewing(username);
                                  try {
                                    const res = await renewSubscriberPackage(username, 30);
                                    setSyncToast({ type: 'success', message: res.message });
                                  } catch (err: any) {
                                    setSyncToast({ type: 'error', message: err.message || 'Renewal failed' });
                                  } finally {
                                    setIsRenewing(null);
                                  }
                                }}
                                disabled={isRenewing === username}
                                className="bg-cyan-950/90 hover:bg-cyan-900 border border-cyan-700 text-cyan-300 px-2 py-1 rounded text-[11px] transition flex items-center gap-1 cursor-pointer font-bold shadow-sm disabled:opacity-50"
                              >
                                <RefreshCw className={`w-3 h-3 text-cyan-400 ${isRenewing === username ? 'animate-spin' : ''}`} />
                                <span>+ Renew</span>
                              </button>

                              <button
                                onClick={() => setSelectedSubscriberUsername(username)}
                                className="bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 px-2 py-1 rounded text-[11px] transition"
                              >
                                360° View
                              </button>

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
                      );
                    })}
                {(hasLiveSecrets ? filteredSecrets.length === 0 : filteredCustomers.length === 0) && (
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
                  <span>Carrier Bandwidth Profiles (/ppp/profile)</span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 font-mono">
                    {displayProfilesCount} Profiles Live
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 font-mono">
                    RouterOS v7 Synced
                  </span>
                </h3>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Upload/download rate limits, burst parameters, and pool definitions fetched directly from MikroTik <code className="text-cyan-400 font-mono">/ppp/profile</code>.
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

          {/* RouterOS /ppp/profile Active Table */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h4 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                  RouterOS /ppp/profile Active Table
                </h4>
                <p className="text-[11px] text-slate-400">
                  Live bandwidth profiles provisioned directly on MikroTik BNG
                </p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-slate-950 text-slate-400 uppercase tracking-wider text-[11px] border-b border-slate-800">
                  <tr>
                    <th className="py-3 px-4">Profile Name</th>
                    <th className="py-3 px-4">Rate Limit / RX-TX</th>
                    <th className="py-3 px-4">Commercial Rate</th>
                    <th className="py-3 px-4">Local Address</th>
                    <th className="py-3 px-4">Remote Address / Pool</th>
                    <th className="py-3 px-4">Only-One</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 text-slate-300">
                  {(hasLiveProfiles
                    ? filteredDynamicProfiles
                    : packages.map((pkg) => ({
                        '.id': pkg.id,
                        name: pkg.mikrotikProfile,
                        'rate-limit': `${pkg.uploadSpeedMbps}M/${pkg.downloadSpeedMbps}M`,
                        'local-address': pkg.localAddress || '192.168.8.1',
                        'remote-address': pkg.remoteAddressPool || 'pppoe-pool-default',
                        'only-one': 'yes',
                      }))
                  ).map((prof) => {
                    const rateLimit = prof['rate-limit'] || 'Unlimited';
                    const localAddr = prof['local-address'] || '-';
                    const remoteAddr = prof['remote-address'] || '-';
                    const onlyOne = prof['only-one'] ? String(prof['only-one']) : 'default';
                    const isDefault = prof.name === 'default' || prof.name === 'default-encryption';
                    const currentProfPrice = profilePriceMap[prof.name] || 2500;

                    return (
                      <tr key={prof['.id'] || prof.name} className="hover:bg-slate-800/60 transition">
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-cyan-300">{prof.name}</span>
                            {isDefault && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 font-mono">
                                DEFAULT
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4 font-mono font-bold text-emerald-300">
                          {rateLimit}
                        </td>
                        <td className="py-3 px-4 font-mono font-bold text-amber-300">
                          {formatCurrency(currentProfPrice)}
                          <span className="text-[10px] text-slate-500 font-normal">/mo</span>
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-300">
                          {localAddr}
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-300">
                          {remoteAddr}
                        </td>
                        <td className="py-3 px-4 font-mono">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] border ${
                              onlyOne === 'yes' || onlyOne === 'true'
                                ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                                : 'bg-slate-800 text-slate-400 border-slate-700'
                            }`}
                          >
                            {onlyOne}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right font-sans">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => {
                                setPriceEditTarget({ profileName: prof.name, currentPrice: currentProfPrice });
                                setNewPriceValue(currentProfPrice);
                              }}
                              className="px-2 py-1 rounded text-[11px] transition bg-cyan-950/80 hover:bg-cyan-900 text-cyan-300 border border-cyan-800 flex items-center gap-1 cursor-pointer"
                              title="Edit Profile Commercial Rate"
                            >
                              <Edit2 className="w-3 h-3 text-cyan-400" />
                              <span>Edit Rate</span>
                            </button>
                            <button
                              onClick={() => {
                                const cli = `/ppp profile print where name="${prof.name}"`;
                                navigator.clipboard.writeText(cli);
                                setSyncToast({
                                  type: 'success',
                                  message: `Copied RouterOS CLI query for profile ${prof.name}`,
                                });
                              }}
                              className="px-2 py-1 rounded text-[11px] transition bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 flex items-center gap-1 cursor-pointer"
                              title="Copy CLI query"
                            >
                              <Copy className="w-3 h-3 text-cyan-400" />
                              <span>CLI</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {(hasLiveProfiles ? filteredDynamicProfiles.length === 0 : packages.length === 0) && (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-400 font-sans">
                        No bandwidth profiles found matching your search.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Commercial Tariffs & Subscription Packages Section Header */}
          <div className="pt-2">
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider font-mono mb-2">
              Commercial Subscription Tariffs &amp; Packages
            </h4>
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
                          const cur = profilePriceMap[pkg.mikrotikProfile] || pkg.priceMonthly;
                          setPriceEditTarget({ profileName: pkg.mikrotikProfile, currentPrice: cur });
                          setNewPriceValue(cur);
                        }}
                        className="px-2.5 py-1 rounded-lg bg-amber-950/70 hover:bg-amber-900/90 text-amber-300 border border-amber-800 text-[11px] font-bold transition flex items-center gap-1 cursor-pointer"
                        title="Edit Commercial Monthly Price"
                      >
                        <Edit2 className="w-3 h-3 text-amber-400" />
                        <span>Edit Rate</span>
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

      {/* Quick Edit Profile Rate Modal */}
      {priceEditTarget && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-sm w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-white">Edit Bandwidth Profile Price</h3>
                <p className="text-xs text-cyan-400 font-mono mt-0.5">{priceEditTarget.profileName}</p>
              </div>
              <button
                onClick={() => setPriceEditTarget(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-slate-400 text-xs mb-1">Monthly Rate / Price (PKR)</label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-slate-500 font-mono text-xs">Rs.</span>
                  <input
                    type="number"
                    min="100"
                    step="50"
                    value={newPriceValue}
                    onChange={(e) => setNewPriceValue(Number(e.target.value) || 0)}
                    className="w-full bg-slate-950 border border-slate-700 text-amber-300 font-mono font-bold pl-10 pr-3 py-2 rounded-lg text-sm focus:outline-none focus:border-cyan-500"
                  />
                </div>
                <p className="text-[10px] text-slate-500 mt-1">
                  New invoices and auto-provisioning for this profile will bill at {formatCurrency(newPriceValue)}/month.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setPriceEditTarget(null)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  updatePackagePrice(priceEditTarget.profileName, newPriceValue);
                  setSyncToast({
                    type: 'success',
                    message: `Profile "${priceEditTarget.profileName}" updated to ${formatCurrency(newPriceValue)}/month.`,
                  });
                  setPriceEditTarget(null);
                }}
                className="px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-slate-950 text-xs font-bold transition cursor-pointer shadow-md shadow-cyan-950/40"
              >
                Save Price
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Subscriber 360° Detail Drawer / Modal */}
      <SubscriberProfileDrawer
        isOpen={Boolean(selectedSubscriberUsername)}
        username={selectedSubscriberUsername}
        onClose={() => setSelectedSubscriberUsername(null)}
      />
    </div>
  );
};
