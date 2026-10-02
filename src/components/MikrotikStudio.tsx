import React, { useState } from 'react';
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
  XCircle,
  ExternalLink,
  Sliders,
  Filter,
  Trash2,
  Activity,
  Globe,
} from 'lucide-react';
import { useISP } from '../context/ISPContext';
import { CustomerStatus } from '../types/isp';
import { AddMikrotikDeviceModal } from './AddMikrotikDeviceModal';

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
    customers,
    packages,
    kickSession,
    toggleCustomerStatus,
    deleteMikrotikRouter,
  } = useISP();

  const [activeSubTab, setActiveSubTab] = useState<'sessions' | 'secrets' | 'profiles' | 'routers'>('sessions');
  const [searchQuery, setSearchQuery] = useState('');
  const [isKicking, setIsKicking] = useState<string | null>(null);
  const [isAddDeviceModalOpen, setIsAddDeviceModalOpen] = useState(false);

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

  const handleKick = async (sessionId: string, username: string) => {
    setIsKicking(sessionId);
    await kickSession(sessionId);
    setTimeout(() => setIsKicking(null), 800);
  };

  return (
    <div className="space-y-6">
      {/* Top Router Hardware Telemetry Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-cyan-950 border border-cyan-700/50 rounded-lg text-cyan-400">
              <Server className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-white">{currentRouter.name}</h2>
                <span className="text-xs px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 font-mono">
                  {currentRouter.status.toUpperCase()}
                </span>
                <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                  {currentRouter.version}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Model: <strong className="text-slate-200">{currentRouter.model}</strong> &bull; IP: <code className="text-cyan-400">{currentRouter.ipAddress}:{currentRouter.apiPort}</code> (REST + TLS)
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
                    {r.name} ({r.ipAddress})
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={() => setIsAddDeviceModalOpen(true)}
              className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-400 border border-slate-700 font-bold text-xs px-3 py-2 rounded-lg transition shadow-sm cursor-pointer"
              title="Add New MikroTik Router"
            >
              <Plus className="w-3.5 h-3.5 text-cyan-400" />
              <span>+ Add Router</span>
            </button>

            <button
              onClick={onOpenProvisionModal}
              className="flex items-center gap-1.5 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-semibold text-xs px-3.5 py-2 rounded-lg transition"
            >
              <Plus className="w-4 h-4" />
              <span>+ Provision PPPoE Secret</span>
            </button>
          </div>
        </div>

        {/* Hardware Resource Indicators */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-5 pt-4 border-t border-slate-800 text-xs font-mono">
          <div className="bg-slate-950/60 p-2.5 rounded border border-slate-800/80">
            <span className="text-slate-400">CPU Usage</span>
            <div className="text-cyan-300 font-bold text-sm mt-0.5 flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-cyan-400" />
              {currentRouter.cpuLoad}%
            </div>
          </div>

          <div className="bg-slate-950/60 p-2.5 rounded border border-slate-800/80">
            <span className="text-slate-400">Uptime</span>
            <div className="text-slate-200 font-bold text-sm mt-0.5">
              {currentRouter.uptime}
            </div>
          </div>

          <div className="bg-slate-950/60 p-2.5 rounded border border-slate-800/80">
            <span className="text-slate-400">Active PPPoE Sessions</span>
            <div className="text-emerald-400 font-bold text-sm mt-0.5">
              {activeSessions.length} Online
            </div>
          </div>

          <div className="bg-slate-950/60 p-2.5 rounded border border-slate-800/80">
            <span className="text-slate-400">Walled Garden Pool</span>
            <div className="text-amber-400 font-bold text-sm mt-0.5">
              {currentRouter.walledGardenPool}
            </div>
          </div>
        </div>
      </div>

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
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
          <div className="p-4 border-b border-slate-800 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-white">
                Live Active PPPoE Sessions (/ppp/active)
              </h3>
              <p className="text-xs text-slate-400">
                Real-time connection telemetry. Terminating a session triggers RouterOS <code className="text-cyan-400">/ppp/active/remove</code>.
              </p>
            </div>
            <span className="text-xs font-mono text-emerald-400 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Live Streaming (2.5s poll)
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-slate-950 text-slate-400 uppercase tracking-wider text-[11px] border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4">PPPoE User</th>
                  <th className="py-3 px-4">Caller ID (MAC)</th>
                  <th className="py-3 px-4">Assigned IP</th>
                  <th className="py-3 px-4">Profile</th>
                  <th className="py-3 px-4">Uptime</th>
                  <th className="py-3 px-4">Live Rate (RX / TX)</th>
                  <th className="py-3 px-4 text-right">RouterOS Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-300">
                {filteredSessions.map((session) => (
                  <tr key={session.id} className="hover:bg-slate-800/50 transition">
                    <td className="py-3 px-4">
                      <div className="font-bold text-slate-100">{session.username}</div>
                      <div className="text-[11px] text-slate-400 font-sans">{session.customerName}</div>
                    </td>
                    <td className="py-3 px-4 text-slate-400">{session.callerId}</td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-0.5 rounded text-[11px] ${
                        session.address.startsWith('172.16.100')
                          ? 'bg-amber-950 text-amber-300 border border-amber-800'
                          : 'bg-slate-800 text-cyan-300'
                      }`}>
                        {session.address}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-300">{session.profileName}</td>
                    <td className="py-3 px-4 text-slate-400">{session.uptime}</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <span className="text-emerald-400 font-semibold">{session.rxRateMbps}M</span>
                        <span className="text-slate-600">/</span>
                        <span className="text-cyan-400">{session.txRateMbps}M</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => handleKick(session.id, session.username)}
                        disabled={isKicking === session.id}
                        className="bg-rose-950/80 hover:bg-rose-900 border border-rose-800/80 text-rose-300 hover:text-white px-2.5 py-1 rounded text-[11px] font-sans font-medium transition disabled:opacity-50"
                        title="Force disconnect / kick session"
                      >
                        {isKicking === session.id ? 'Kicking...' : 'Force Kick'}
                      </button>
                    </td>
                  </tr>
                ))}
                {filteredSessions.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-500 font-sans">
                      No active sessions found matching criteria.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
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
            <button
              onClick={onOpenProvisionModal}
              className="bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-semibold text-xs px-3 py-1.5 rounded transition"
            >
              + New PPPoE Secret
            </button>
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
                  <tr key={cust.id} className="hover:bg-slate-800/50 transition">
                    <td className="py-3 px-4">
                      <div className="font-bold text-slate-100">{cust.name}</div>
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
                      ${cust.balanceDue.toFixed(2)}
                    </td>
                    <td className="py-3 px-4 text-right font-sans">
                      <div className="flex items-center justify-end gap-1.5">
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
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUB-TAB 3: Bandwidth Profiles (/ppp/profile & /queue/simple) */}
      {activeSubTab === 'profiles' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {packages.map((pkg) => (
            <div
              key={pkg.id}
              className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4 hover:border-slate-700 transition"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="text-base font-bold text-white">{pkg.name}</h4>
                  <span className="text-xs text-cyan-400 font-mono">
                    Profile: {pkg.mikrotikProfile}
                  </span>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-emerald-400 font-mono">
                    ${pkg.priceMonthly.toFixed(2)}
                  </div>
                  <span className="text-[10px] text-slate-500">/ month</span>
                </div>
              </div>

              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800/80 space-y-2 font-mono text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-400">Download Limit:</span>
                  <span className="text-emerald-400 font-semibold">{pkg.downloadSpeedMbps} Mbps</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Upload Limit:</span>
                  <span className="text-cyan-400 font-semibold">{pkg.uploadSpeedMbps} Mbps</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">RouterOS Rate-Limit:</span>
                  <span className="text-slate-300">
                    {pkg.uploadSpeedMbps}M/{pkg.downloadSpeedMbps}M
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Data Allocation:</span>
                  <span className="text-slate-300">
                    {pkg.dataLimitGb ? `${pkg.dataLimitGb} GB` : 'Uncapped / Unlimited'}
                  </span>
                </div>
              </div>

              <div className="text-xs text-slate-400 flex items-center justify-between pt-1">
                <span>Subscribers on profile:</span>
                <span className="text-slate-200 font-mono font-bold">
                  {customers.filter((c) => c.packageId === pkg.id).length} users
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* SUB-TAB 4: Router Fleet & Hardware Management */}
      {activeSubTab === 'routers' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-slate-900 border border-slate-800 p-4 rounded-xl">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span>MikroTik Hardware Fleet Inventory</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 font-mono">
                  {routers.length} Devices Online
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                Manage carrier-grade MikroTik BNG/BRAS routers, RouterOS v7 REST API credentials, and live telemetry links.
              </p>
            </div>
            <button
              onClick={() => setIsAddDeviceModalOpen(true)}
              className="bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs px-4 py-2 rounded-lg transition flex items-center gap-1.5 shadow-lg shadow-cyan-950/40 shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>+ Add MikroTik Device</span>
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {routers.map((router) => {
              const isSelected = router.id === selectedRouterId;
              const routerSessionsCount = activeSessions.filter((s) => s.routerId === router.id).length;
              const routerCustomersCount = customers.filter((c) => c.routerId === router.id).length;

              return (
                <div
                  key={router.id}
                  className={`bg-slate-900 border rounded-xl p-5 space-y-4 shadow-lg transition flex flex-col justify-between ${
                    isSelected
                      ? 'border-cyan-500/80 ring-1 ring-cyan-500/30 shadow-cyan-950/20'
                      : 'border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="space-y-3">
                    {/* Device Header */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className={`p-2.5 rounded-xl border ${
                          isSelected
                            ? 'bg-cyan-950/80 border-cyan-500 text-cyan-300'
                            : 'bg-slate-950 border-slate-800 text-slate-400'
                        }`}>
                          <Server className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="font-bold text-white text-sm font-mono">{router.name}</h4>
                            {isSelected && (
                              <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-700/60 font-bold font-mono">
                                ACTIVE BNG
                              </span>
                            )}
                          </div>
                          <span className="text-xs text-slate-400 block">{router.location}</span>
                        </div>
                      </div>

                      <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 uppercase font-mono shrink-0">
                        {router.status}
                      </span>
                    </div>

                    {/* Network & REST API Specs */}
                    <div className="bg-slate-950 p-3 rounded-lg border border-slate-800/80 space-y-1.5 font-mono text-xs">
                      <div className="flex justify-between items-center">
                        <span className="text-slate-400">Model:</span>
                        <span className="text-slate-200 font-semibold">{router.model}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-slate-400">Management IP:</span>
                        <span className="text-cyan-300 font-bold">
                          {router.ipAddress}:{router.apiPort} {router.useSsl ? '(TLS)' : ''}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-slate-400">Firmware:</span>
                        <span className="text-indigo-300">{router.version}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-slate-400">Uplink WAN:</span>
                        <span className="text-slate-300">{router.wanInterface}</span>
                      </div>
                    </div>

                    {/* Hardware Telemetry Grid */}
                    <div className="grid grid-cols-3 gap-2 text-xs font-mono text-center">
                      <div className="bg-slate-950/70 p-2 rounded border border-slate-800">
                        <span className="text-slate-400 text-[10px] block">CPU Load</span>
                        <span className="text-cyan-300 font-bold">{router.cpuLoad}%</span>
                      </div>
                      <div className="bg-slate-950/70 p-2 rounded border border-slate-800">
                        <span className="text-slate-400 text-[10px] block">Memory</span>
                        <span className="text-slate-200 font-bold">
                          {router.memoryUsageMb} MB
                        </span>
                      </div>
                      <div className="bg-slate-950/70 p-2 rounded border border-slate-800">
                        <span className="text-slate-400 text-[10px] block">WAN Bandwidth</span>
                        <span className="text-emerald-400 font-bold">
                          {(router.currentWanRxMbps / 1000).toFixed(2)}G
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 px-1 pt-1">
                      <span>Assigned PPPoE Clients:</span>
                      <span className="text-cyan-400 font-bold">
                        {routerSessionsCount} active / {routerCustomersCount} secrets
                      </span>
                    </div>
                  </div>

                  {/* Router Actions */}
                  <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-800/80">
                    {isSelected ? (
                      <span className="text-xs text-emerald-400 font-medium flex items-center gap-1 font-mono">
                        <CheckCircle className="w-3.5 h-3.5" />
                        <span>Currently Polling Live</span>
                      </span>
                    ) : (
                      <button
                        onClick={() => setSelectedRouterId(router.id)}
                        className="px-3.5 py-1.5 rounded-lg bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 font-bold text-xs transition border border-cyan-500/40"
                      >
                        Set as Active BNG Router
                      </button>
                    )}

                    {routers.length > 1 && (
                      <button
                        onClick={() => {
                          if (confirm(`Remove router "${router.name}" from ISP controller?`)) {
                            deleteMikrotikRouter(router.id);
                          }
                        }}
                        className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 border border-transparent hover:border-rose-900 rounded-lg transition"
                        title="Remove Router"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Add MikroTik Device Modal */}
      <AddMikrotikDeviceModal
        isOpen={isAddDeviceModalOpen}
        onClose={() => setIsAddDeviceModalOpen(false)}
      />
    </div>
  );
};
