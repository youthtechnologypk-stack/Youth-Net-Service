import React, { useState, useEffect } from 'react';
import {
  Activity,
  Users,
  CreditCard,
  AlertTriangle,
  Server,
  Zap,
  ArrowUpRight,
  ArrowDownLeft,
  ShieldAlert,
  Send,
  CheckCircle2,
  Clock,
  Radio,
  FileText,
  DollarSign,
  Layers,
} from 'lucide-react';
import { useISP } from '../context/ISPContext';
import { useCurrency } from '../context/CurrencyContext';
import { ActiveTab } from './Header';
import { UsageAnalytics } from './UsageAnalytics';
import { OutageBanner } from './OutageBanner';
import { fetchMikrotikPppSecrets } from '../services/mikrotikRestClient';

interface NocOverviewProps {
  onNavigateTab: (tab: ActiveTab) => void;
  onOpenOutageModal: () => void;
  onOpenTicketModal: () => void;
  onOpenAddRouterModal?: () => void;
}

export const NocOverview: React.FC<NocOverviewProps> = ({
  onNavigateTab,
  onOpenOutageModal,
  onOpenTicketModal,
  onOpenAddRouterModal,
}) => {
  const {
    routers,
    selectedRouterId,
    setSelectedRouterId,
    customers,
    activeSessions,
    invoices,
    complaints,
    outages,
    bandwidthHistory,
    routerError,
    runMonthlyBillingCron,
    runOverdueScanCron,
    isTrafficStreaming,
    setIsTrafficStreaming,
    whatsAppLogs,
    olts,
    onus,
  } = useISP();
  const { formatCurrency } = useCurrency();

  const currentRouter = routers.find((r) => r.id === selectedRouterId) || routers[0];

  const [provisionedSecretsCount, setProvisionedSecretsCount] = useState<number>(0);

  useEffect(() => {
    let isMounted = true;
    if (currentRouter && currentRouter.status === 'online') {
      fetchMikrotikPppSecrets(currentRouter)
        .then((res) => {
          if (isMounted && res.success && Array.isArray(res.secrets)) {
            setProvisionedSecretsCount(res.secrets.length);
          }
        })
        .catch(() => {});
    }
    return () => {
      isMounted = false;
    };
  }, [currentRouter]);

  const activeCount = activeSessions ? activeSessions.length : 0;
  const totalSecrets =
    provisionedSecretsCount > 0
      ? provisionedSecretsCount
      : customers && customers.length > 0
      ? customers.length
      : (currentRouter?.activePppoeCount || 0);
  const totalDueAmount = invoices
    .filter((i) => i.status !== 'paid')
    .reduce((sum, i) => sum + (Number(i.totalAmount) || 0), 0);

  const totalMonthlyBilled = invoices.reduce((sum, i) => sum + (Number(i.totalAmount) || 0), 0);

  const totalCollected = invoices
    .filter((i) => i.status === 'paid')
    .reduce((sum, i) => sum + (Number(i.totalAmount) || 0), 0);

  const urgentComplaints = complaints.filter(
    (c) => (c.priority === 'critical' || c.priority === 'high') && c.status !== 'resolved'
  );

  const currentWanRx = bandwidthHistory[bandwidthHistory.length - 1]?.rxMbps || 0;
  const currentWanTx = bandwidthHistory[bandwidthHistory.length - 1]?.txMbps || 0;

  return (
    <div className="space-y-6">
      {/* Real Router Connection Error Banner if router unreachable / CORS / SSL */}
      {routerError && (
        <div className="bg-rose-950/90 border border-rose-500/60 text-rose-200 px-4 py-3 rounded-xl flex items-center gap-3 text-xs sm:text-sm font-mono shadow-lg shadow-rose-950/50">
          <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
          <div className="flex-1">
            <span className="text-rose-100 font-bold block sm:inline">Connection Failed: </span>
            {routerError}
          </div>
        </div>
      )}

      {/* Router Status & Real Telemetry Status */}
      {currentRouter ? (
        <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/80 border border-slate-800/80 px-3.5 py-2.5 rounded-xl backdrop-blur-sm">
          <div className="flex items-center gap-2.5">
            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-medium border shadow-sm ${
              currentRouter.status === 'online'
                ? 'bg-emerald-950/90 text-emerald-300 border-emerald-500/30 shadow-emerald-950/40'
                : 'bg-rose-950/90 text-rose-300 border-rose-500/30 shadow-rose-950/40'
            }`}>
              <span className={`w-2 h-2 rounded-full ${currentRouter.status === 'online' ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
              {currentRouter.status === 'online' ? 'RouterOS v7 REST Live' : 'Router Unreachable'}
            </span>
            <span className="text-xs text-slate-400 font-mono hidden sm:inline">
              Active BNG: <span className="text-slate-200 font-bold">{currentRouter.name}</span> ({currentRouter.ip || currentRouter.ipAddress}:{currentRouter.port || currentRouter.apiPort || 8729})
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs font-mono text-slate-400">
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
              CPU: <span className="text-cyan-300 font-bold">{currentRouter.cpuLoad || 0}%</span>
            </span>
            <span className="text-slate-700">|</span>
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              Live WAN: <span className="text-emerald-400 font-bold">{currentWanRx}M</span> RX
            </span>
            <span className="text-slate-700">|</span>
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
              Sessions: <span className="text-indigo-300 font-bold">{activeSessions.filter(s => s.routerId === currentRouter.id).length || currentRouter.activePppoeCount || 0}</span>
            </span>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/80 border border-slate-800/80 px-3.5 py-2.5 rounded-xl backdrop-blur-sm text-xs">
          <div className="flex items-center gap-2.5 text-slate-400">
            <Server className="w-4 h-4 text-slate-500 shrink-0" />
            <span>No MikroTik Routers Connected. Click "+ Add Router" to register a BNG/BRAS device.</span>
          </div>
          <button
            onClick={() => onOpenAddRouterModal ? onOpenAddRouterModal() : onNavigateTab('mikrotik')}
            className="px-3 py-1 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold rounded-lg transition shrink-0 cursor-pointer"
          >
            + Add Router
          </button>
        </div>
      )}

      {/* Active Outage Warning Banner if any active (with minimize and full update modal) */}
      <OutageBanner onNavigateTab={onNavigateTab} />

      {/* Top 5 Carrier Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
        {/* Card 1: Live Subscriber Fleet - Derived Exclusively from activeSessions */}
        <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-xl relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              PPPoE Subscribers
            </span>
            <Users className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-white">{activeCount}</span>
            <span className="text-xs text-emerald-400 font-medium">
              {activeCount} Active Online
            </span>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-slate-400 pt-2 border-t border-slate-800">
            <span className="flex items-center gap-1 text-slate-400">
              <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block animate-pulse" />
              {activeCount} Live Sessions
            </span>
            <span className="font-mono text-cyan-400">
              {totalSecrets > 0 ? `of ${totalSecrets} Provisioned` : `${activeCount} Online`}
            </span>
          </div>
        </div>

        {/* Card 2: Core Bandwidth Throughput - Calculated strictly from real interface throughput */}
        <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-xl relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Aggregate WAN Traffic
            </span>
            <Activity className="w-4 h-4 text-emerald-400 animate-pulse" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-white">
              {currentWanRx >= 1000 ? (currentWanRx / 1000).toFixed(2) : currentWanRx.toFixed(1)}{' '}
              <span className="text-xs font-sans text-slate-400">
                {currentWanRx >= 1000 ? 'Gbps' : 'Mbps'}
              </span>
            </span>
            <span className="text-xs text-emerald-400 font-mono">RX</span>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-slate-400 pt-2 border-t border-slate-800">
            <span className="flex items-center gap-1 font-mono text-cyan-300">
              <ArrowUpRight className="w-3.5 h-3.5 text-cyan-400" />
              TX: {currentWanTx} Mbps
            </span>
            <span className="font-mono text-slate-400">
              <ArrowDownLeft className="w-3.5 h-3.5 text-emerald-400 inline" /> RX: {currentWanRx} Mbps
            </span>
          </div>
        </div>

        {/* Card 3: Monthly Billing & Recovery - Based on localStorage invoices */}
        <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-xl relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Billed Revenue &amp; Recovery
            </span>
            <CreditCard className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-white">
              {formatCurrency(totalCollected, 0)}
            </span>
            <span className="text-xs text-slate-400 font-mono">
              {invoices.length > 0 ? `of ${formatCurrency(totalMonthlyBilled, 0)} billed` : 'No invoices generated'}
            </span>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-slate-400 pt-2 border-t border-slate-800">
            {invoices.length > 0 ? (
              <>
                <span className="text-rose-400 font-medium font-mono">
                  Overdue: {formatCurrency(totalDueAmount, 1)}
                </span>
                <span className="text-emerald-400 font-medium">
                  {Math.round((totalCollected / (totalMonthlyBilled || 1)) * 100)}% Collected
                </span>
              </>
            ) : (
              <span
                onClick={() => onNavigateTab('billing')}
                className="text-cyan-400 hover:text-cyan-300 cursor-pointer flex items-center gap-1 font-mono"
              >
                + Create First Invoice &rarr;
              </span>
            )}
          </div>
        </div>

        {/* Card 4: SLA Complaints & Fiber Cuts - Based on localStorage tickets */}
        <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-xl relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Field SLA Tickets
            </span>
            <AlertTriangle className="w-4 h-4 text-amber-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-white">{complaints.length}</span>
            <span className={`text-xs font-semibold ${urgentComplaints.length > 0 ? 'text-rose-400' : 'text-slate-500'}`}>
              {urgentComplaints.length > 0 ? `${urgentComplaints.length} Critical Fiber/LOS` : '0 Critical Issues'}
            </span>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-slate-400 pt-2 border-t border-slate-800">
            <span className="text-slate-400">
              {complaints.length > 0 ? 'SLA Queues Active' : 'All SLA Queues Clear'}
            </span>
            <span className="text-cyan-400 cursor-pointer" onClick={() => onNavigateTab('complaints')}>
              {complaints.length > 0 ? 'Dispatch &rarr;' : '+ Log Ticket'}
            </span>
          </div>
        </div>

        {/* Card 5: VSOL OLT Optical Health */}
        <div
          onClick={() => onNavigateTab('olt')}
          className="bg-slate-900/90 border border-slate-800 hover:border-cyan-500/50 p-4 rounded-xl relative overflow-hidden transition cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider group-hover:text-cyan-400 transition">
              VSOL OLT Optics
            </span>
            <Layers className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-white">{onus.length}</span>
            <span className="text-xs text-emerald-400 font-medium">
              {onus.length > 0 ? `${onus.filter((o) => o.opticalQuality === 'good').length} Optimal` : 'No OLT Connected'}
            </span>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-slate-400 pt-2 border-t border-slate-800">
            <span className="text-slate-400">PON Optical Health</span>
            <span className="text-cyan-400 group-hover:translate-x-0.5 transition font-mono">
              {olts.length > 0 ? `${olts.length} OLTs Online` : 'Configure &rarr;'}
            </span>
          </div>
        </div>
      </div>

      {/* Usage Analytics Component with Recharts (Disabled / hidden when no routers exist) */}
      {currentRouter ? (
        <UsageAnalytics />
      ) : (
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-8 text-center space-y-3 shadow-lg">
          <div className="w-12 h-12 bg-slate-800/80 rounded-xl flex items-center justify-center mx-auto border border-slate-700 text-slate-400">
            <Activity className="w-6 h-6 text-cyan-400/50" />
          </div>
          <h4 className="text-sm font-bold text-white">Live Telemetry Graphs Inactive</h4>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            No MikroTik Routers Connected. Click "+ Add Router" to register a BNG/BRAS device and stream real-time throughput.
          </p>
          <button
            onClick={() => onOpenAddRouterModal ? onOpenAddRouterModal() : onNavigateTab('mikrotik')}
            className="inline-flex items-center gap-1.5 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs px-4 py-2 rounded-lg transition cursor-pointer"
          >
            <Server className="w-3.5 h-3.5" />
            <span>+ Add Router</span>
          </button>
        </div>
      )}

      {/* Quick Automation CRON Execution Bar */}
      <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl flex flex-wrap items-center justify-between gap-4 shadow-lg">
        <div>
          <span className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <Zap className="w-4 h-4 text-cyan-400" />
            Carrier Engine Automations & CRON Simulators
          </span>
          <p className="text-xs text-slate-400 mt-0.5">
            Trigger production CRON jobs manually to test invoice generation & MikroTik walled-garden isolation.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => runMonthlyBillingCron()}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-3.5 py-2 rounded-lg transition shadow-sm"
          >
            <Zap className="w-3.5 h-3.5" />
            <span>Simulate 1st Month Billing CRON</span>
          </button>

          <button
            onClick={() => runOverdueScanCron()}
            className="flex items-center gap-1.5 bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold px-3.5 py-2 rounded-lg transition shadow-sm"
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Simulate Overdue Walled Garden Scan</span>
          </button>
        </div>
      </div>

      {/* Bottom Grid: MikroTik Hardware Telemetry & Automated WhatsApp Feed */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Active MikroTik BNG Router Card */}
        {currentRouter ? (
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 space-y-3.5 shadow-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Server className="w-4 h-4 text-cyan-400" />
                <span className="font-bold text-slate-200 text-sm font-mono">{currentRouter.name}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] bg-cyan-950 text-cyan-300 border border-cyan-800 px-2 py-0.5 rounded font-mono">
                  {routers.length} Fleet
                </span>
                <span className="text-[10px] bg-emerald-950 text-emerald-300 border border-emerald-800 px-2 py-0.5 rounded font-mono">
                  {currentRouter.version}
                </span>
              </div>
            </div>

            <p className="text-xs text-slate-400">{currentRouter.location}</p>

            <div className="space-y-2 text-xs">
              <div>
                <div className="flex justify-between text-slate-300 font-mono mb-1">
                  <span>CPU Load:</span>
                  <span className="text-cyan-400">{currentRouter.cpuLoad ?? 0}%</span>
                </div>
                <div className="w-full bg-slate-800 rounded-full h-1.5">
                  <div
                    className="bg-cyan-500 h-1.5 rounded-full transition-all duration-500"
                    style={{ width: `${currentRouter.cpuLoad || 0}%` }}
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-slate-300 font-mono mb-1">
                  <span>RAM Used:</span>
                  <span className="text-indigo-400">
                    {currentRouter.memoryUsageMb ?? 0} MB / {currentRouter.totalMemoryMb ?? 0} MB
                  </span>
                </div>
                <div className="w-full bg-slate-800 rounded-full h-1.5">
                  <div
                    className="bg-indigo-500 h-1.5 rounded-full"
                    style={{
                      width: `${
                        currentRouter.totalMemoryMb && currentRouter.totalMemoryMb > 0
                          ? ((currentRouter.memoryUsageMb || 0) / currentRouter.totalMemoryMb) * 100
                          : 0
                      }%`,
                    }}
                  />
                </div>
              </div>

              <div className="pt-2 border-t border-slate-800 flex justify-between text-slate-400 text-[11px] font-mono">
                <span>Uptime: {currentRouter.uptime || 'Offline'}</span>
                <span className="text-slate-300">IP: {currentRouter.ipAddress}</span>
              </div>
            </div>

            <button
              onClick={() => onNavigateTab('mikrotik')}
              className="w-full bg-slate-800 hover:bg-slate-700 text-cyan-400 font-semibold text-xs py-2 rounded-lg transition text-center"
            >
              Open MikroTik v7 Console &rarr;
            </button>
          </div>
        ) : (
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 text-center space-y-3 shadow-lg flex flex-col items-center justify-center">
            <Server className="w-8 h-8 text-slate-600" />
            <h4 className="text-sm font-bold text-white">No MikroTik Routers Connected</h4>
            <p className="text-xs text-slate-400 max-w-xs">
              No MikroTik Routers Connected. Click "+ Add Router" to register a BNG/BRAS device.
            </p>
            <button
              onClick={() => onOpenAddRouterModal ? onOpenAddRouterModal() : onNavigateTab('mikrotik')}
              className="bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs px-4 py-2 rounded-lg transition cursor-pointer"
            >
              + Add Router
            </button>
          </div>
        )}

        {/* WhatsApp Automated Delivery Feed */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 space-y-3.5 shadow-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Send className="w-4 h-4 text-emerald-400" />
              <span className="font-bold text-slate-200 text-sm">Automated WhatsApp Feed</span>
            </div>
            <span className="text-[10px] bg-emerald-950 text-emerald-300 px-2 py-0.5 rounded font-mono">
              Cloud API Active
            </span>
          </div>

          <div className="space-y-2.5 max-h-56 overflow-y-auto pr-1">
            {whatsAppLogs.slice(0, 4).map((log) => (
              <div
                key={log.id}
                className="bg-slate-950/70 border border-slate-800/80 p-2.5 rounded text-xs space-y-1"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-200">{log.recipientName}</span>
                  <span className="text-[10px] text-slate-500 font-mono">
                    {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <p className="text-slate-400 text-[11px] line-clamp-2">{log.messageBody}</p>
                <div className="flex items-center justify-between text-[10px] pt-1 text-slate-500">
                  <span className="font-mono text-slate-400">{log.recipientPhone}</span>
                  <span className="text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Delivered
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
