import React from 'react';
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
import { ActiveTab } from './Header';
import { UsageAnalytics } from './UsageAnalytics';
import { OutageBanner } from './OutageBanner';

interface NocOverviewProps {
  onNavigateTab: (tab: ActiveTab) => void;
  onOpenOutageModal: () => void;
  onOpenTicketModal: () => void;
}

export const NocOverview: React.FC<NocOverviewProps> = ({
  onNavigateTab,
  onOpenOutageModal,
  onOpenTicketModal,
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
    runMonthlyBillingCron,
    runOverdueScanCron,
    isTrafficStreaming,
    setIsTrafficStreaming,
    whatsAppLogs,
    olts,
    onus,
  } = useISP();

  const currentRouter = routers.find((r) => r.id === selectedRouterId) || routers[0];

  const activeCustCount = customers.filter((c) => c.status === 'active').length;
  const walledGardenCount = customers.filter((c) => c.status === 'walled_garden').length;
  const totalDueAmount = customers.reduce((sum, c) => sum + c.balanceDue, 0);

  const totalMonthlyBilled = invoices
    .filter((i) => i.billingMonth === 'September 2026')
    .reduce((sum, i) => sum + i.totalAmount, 0);

  const totalCollected = invoices
    .filter((i) => i.status === 'paid' && i.billingMonth === 'September 2026')
    .reduce((sum, i) => sum + i.totalAmount, 0);

  const urgentComplaints = complaints.filter(
    (c) => (c.priority === 'critical' || c.priority === 'high') && c.status !== 'resolved'
  );

  const currentWanRx = bandwidthHistory[bandwidthHistory.length - 1]?.rxMbps || 820;
  const currentWanTx = bandwidthHistory[bandwidthHistory.length - 1]?.txMbps || 340;

  return (
    <div className="space-y-6">
      {/* Active Outage Warning Banner if any active (with minimize and full update modal) */}
      <OutageBanner onNavigateTab={onNavigateTab} />

      {/* Top 5 Carrier Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
        {/* Card 1: Live Subscriber Fleet */}
        <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-xl relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              PPPoE Subscribers
            </span>
            <Users className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-white">{customers.length}</span>
            <span className="text-xs text-emerald-400 font-medium">
              {activeCustCount} Active Online
            </span>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-slate-400 pt-2 border-t border-slate-800">
            <span className="flex items-center gap-1 text-amber-400">
              <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
              {walledGardenCount} in Walled Garden
            </span>
            <span className="font-mono text-slate-400">{activeSessions.length} Live Sessions</span>
          </div>
        </div>

        {/* Card 2: Core Bandwidth Throughput */}
        <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-xl relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Aggregate WAN Traffic
            </span>
            <Activity className="w-4 h-4 text-emerald-400 animate-pulse" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-white">
              {(currentWanRx / 1000).toFixed(2)}{' '}
              <span className="text-xs font-sans text-slate-400">Gbps</span>
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

        {/* Card 3: Monthly Billing & Recovery */}
        <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-xl relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              September MRR Recovery
            </span>
            <CreditCard className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-white">
              ${totalCollected.toFixed(0)}
            </span>
            <span className="text-xs text-slate-400 font-mono">
              of ${totalMonthlyBilled.toFixed(0)} billed
            </span>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-slate-400 pt-2 border-t border-slate-800">
            <span className="text-rose-400 font-medium font-mono">
              Overdue: ${totalDueAmount.toFixed(1)}
            </span>
            <span className="text-emerald-400 font-medium">
              {Math.round((totalCollected / (totalMonthlyBilled || 1)) * 100)}% Collected
            </span>
          </div>
        </div>

        {/* Card 4: SLA Complaints & Fiber Cuts */}
        <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-xl relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Field SLA Tickets
            </span>
            <AlertTriangle className="w-4 h-4 text-amber-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-white">{complaints.length}</span>
            <span className="text-xs text-rose-400 font-semibold">
              {urgentComplaints.length} Critical Fiber/LOS
            </span>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-slate-400 pt-2 border-t border-slate-800">
            <span className="text-slate-400">Mean SLA: 2.4 hrs</span>
            <span className="text-cyan-400 cursor-pointer" onClick={() => onNavigateTab('complaints')}>
              Dispatch &rarr;
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
              {onus.filter((o) => o.opticalQuality === 'good').length} Optimal
            </span>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-slate-400 pt-2 border-t border-slate-800">
            <span className="text-amber-400 font-mono">
              {onus.filter((o) => o.opticalQuality === 'warning').length} High Attn
            </span>
            <span className="text-cyan-400 group-hover:underline">
              OLT NOC &rarr;
            </span>
          </div>
        </div>
      </div>

      {/* Usage Analytics Component with Recharts */}
      <UsageAnalytics />

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
                <span className="text-cyan-400">{currentRouter.cpuLoad}%</span>
              </div>
              <div className="w-full bg-slate-800 rounded-full h-1.5">
                <div
                  className="bg-cyan-500 h-1.5 rounded-full transition-all duration-500"
                  style={{ width: `${currentRouter.cpuLoad}%` }}
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-slate-300 font-mono mb-1">
                <span>RAM Used:</span>
                <span className="text-indigo-400">
                  {currentRouter.memoryUsageMb} MB / {currentRouter.totalMemoryMb} MB
                </span>
              </div>
              <div className="w-full bg-slate-800 rounded-full h-1.5">
                <div
                  className="bg-indigo-500 h-1.5 rounded-full"
                  style={{ width: `${(currentRouter.memoryUsageMb / currentRouter.totalMemoryMb) * 100}%` }}
                />
              </div>
            </div>

            <div className="pt-2 border-t border-slate-800 flex justify-between text-slate-400 text-[11px] font-mono">
              <span>Uptime: {currentRouter.uptime}</span>
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
