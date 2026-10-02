import React, { useState, useMemo } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ComposedChart,
  Bar,
  Line,
} from 'recharts';
import {
  Activity,
  User,
  ArrowUpRight,
  ArrowDownLeft,
  Zap,
  BarChart3,
  Sliders,
  TrendingUp,
  Clock,
  Radio,
  HardDrive,
  Gauge,
  Percent,
} from 'lucide-react';
import { useISP } from '../context/ISPContext';
import { ActiveSession, Customer } from '../types/isp';

export const UsageAnalytics: React.FC = () => {
  const {
    bandwidthHistory,
    activeSessions,
    customers,
    packages,
    isTrafficStreaming,
    setIsTrafficStreaming,
  } = useISP();

  const [analyticsView, setAnalyticsView] = useState<'interface' | 'subscriber' | 'top_talkers'>('interface');
  const [selectedInterface, setSelectedInterface] = useState<string>('sfp-sfpplus1');
  const [timeRange, setTimeRange] = useState<'realtime' | '1h' | '24h' | '7d'>('realtime');
  const [selectedSubscriberUsername, setSelectedSubscriberUsername] = useState<string>(
    activeSessions[0]?.username || 'dr_shahzad_g11'
  );

  // Selected session & matching customer & package
  const currentSession = activeSessions.find((s) => s.username === selectedSubscriberUsername) || activeSessions[0];
  const currentCustomer = customers.find((c) => c.pppoeUsername === selectedSubscriberUsername) || customers[0];
  const currentPackage = packages.find((p) => p.id === currentCustomer?.packageId) || packages[1];

  // Calculate 95th percentile and peak for interface
  const stats = useMemo(() => {
    const rxValues = bandwidthHistory.map((d) => d.rxMbps).sort((a, b) => a - b);
    const txValues = bandwidthHistory.map((d) => d.txMbps).sort((a, b) => a - b);
    const p95Index = Math.floor(rxValues.length * 0.95);
    const p95Rx = rxValues[p95Index] || 0;
    const p95Tx = txValues[p95Index] || 0;
    const peakRx = Math.max(...bandwidthHistory.map((d) => d.rxMbps), 0);
    const peakTx = Math.max(...bandwidthHistory.map((d) => d.txMbps), 0);
    const currentRx = bandwidthHistory[bandwidthHistory.length - 1]?.rxMbps || 0;
    const currentTx = bandwidthHistory[bandwidthHistory.length - 1]?.txMbps || 0;

    return { p95Rx, p95Tx, peakRx, peakTx, currentRx, currentTx };
  }, [bandwidthHistory]);

  // Generate historical data based on timeframe for interface
  const interfaceChartData = useMemo(() => {
    if (timeRange === 'realtime') {
      return bandwidthHistory.map((d) => ({
        time: d.time,
        rx: d.rxMbps,
        tx: d.txMbps,
        total: d.rxMbps + d.txMbps,
      }));
    }

    if (timeRange === '1h') {
      // 12 points, 5 min intervals
      const points = [];
      const now = Date.now();
      for (let i = 11; i >= 0; i--) {
        const t = new Date(now - i * 5 * 60 * 1000);
        const timeLabel = t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const baseRx = 740 + Math.sin((i / 11) * Math.PI) * 160 + (Math.random() - 0.5) * 40;
        const baseTx = 320 + Math.sin((i / 11) * Math.PI) * 70 + (Math.random() - 0.5) * 20;
        points.push({
          time: timeLabel,
          rx: Math.round(baseRx),
          tx: Math.round(baseTx),
          total: Math.round(baseRx + baseTx),
        });
      }
      return points;
    }

    if (timeRange === '24h') {
      // 24 points (hourly)
      const points = [];
      const currentHour = new Date().getHours();
      for (let i = 23; i >= 0; i--) {
        const hour = (currentHour - i + 24) % 24;
        const hourLabel = `${String(hour).padStart(2, '0')}:00`;
        // Typical ISP bell curve: peak between 19:00 - 23:00, trough between 03:00 - 07:00
        const isPeak = hour >= 19 && hour <= 23;
        const isTrough = hour >= 3 && hour <= 7;
        let baseRx = isPeak ? 920 : isTrough ? 280 : 640;
        let baseTx = isPeak ? 420 : isTrough ? 120 : 280;
        baseRx += (Math.random() - 0.5) * 60;
        baseTx += (Math.random() - 0.5) * 30;

        points.push({
          time: hourLabel,
          rx: Math.round(baseRx),
          tx: Math.round(baseTx),
          total: Math.round(baseRx + baseTx),
        });
      }
      return points;
    }

    // 7 Days trend
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return days.map((day, idx) => {
      const isWeekend = idx >= 5;
      const baseRx = isWeekend ? 980 : 790 + idx * 15;
      const baseTx = isWeekend ? 440 : 350 + idx * 8;
      return {
        time: day,
        rx: Math.round(baseRx),
        tx: Math.round(baseTx),
        total: Math.round(baseRx + baseTx),
      };
    });
  }, [bandwidthHistory, timeRange]);

  // Generate historical data for the selected individual PPPoE subscriber
  const subscriberChartData = useMemo(() => {
    const pkgCapRx = currentPackage.downloadSpeedMbps;
    const pkgCapTx = currentPackage.uploadSpeedMbps;
    const points = [];

    // 16 historical minute intervals
    const now = Date.now();
    for (let i = 15; i >= 0; i--) {
      const d = new Date(now - i * 60 * 1000);
      const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      // Generate realistic usage bounded by package cap
      let rxFactor = 0.4 + Math.sin(i / 2) * 0.35 + (Math.random() - 0.5) * 0.15;
      if (currentCustomer.status === 'walled_garden') {
        rxFactor = 0.01;
      }
      rxFactor = Math.max(0.02, Math.min(0.98, rxFactor));

      const subRx = Number((pkgCapRx * rxFactor).toFixed(1));
      const subTx = Number((pkgCapTx * rxFactor * 0.35).toFixed(1));
      const volumeMb = Number(((subRx + subTx) * 0.12).toFixed(1)); // simulated MB transferred in interval

      points.push({
        time: timeStr,
        rxMbps: subRx,
        txMbps: subTx,
        volumeMb: volumeMb,
        capRx: pkgCapRx,
      });
    }

    return points;
  }, [currentPackage, currentCustomer]);

  // Top Talkers Ranking
  const topTalkersData = useMemo(() => {
    return activeSessions.map((session) => {
      const cust = customers.find((c) => c.pppoeUsername === session.username);
      const pkg = packages.find((p) => p.mikrotikProfile === session.profileName);
      const totalRate = session.rxRateMbps + session.txRateMbps;
      const totalGb = Number(((session.bytesInMb + session.bytesOutMb) / 1024).toFixed(2));
      const cap = pkg?.downloadSpeedMbps || 50;
      const utilization = Math.min(100, Math.round((session.rxRateMbps / cap) * 100));

      return {
        username: session.username,
        name: cust?.name || session.customerName || session.username,
        ip: session.address,
        profile: session.profileName,
        rxRate: session.rxRateMbps,
        txRate: session.txRateMbps,
        totalRate: totalRate,
        totalGb: totalGb,
        utilization: utilization,
        cap: cap,
      };
    }).sort((a, b) => b.totalRate - a.totalRate);
  }, [activeSessions, customers, packages]);

  // Custom Dark Recharts Tooltip for Interface Chart
  const CustomInterfaceTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 shadow-xl text-xs font-mono">
          <div className="text-slate-400 font-semibold mb-1.5 flex items-center justify-between gap-4">
            <span>Timestamp: {label}</span>
            <span className="text-cyan-400">{selectedInterface}</span>
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-4 text-emerald-400">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                Download (RX):
              </span>
              <span className="font-bold">{payload[0]?.value} Mbps</span>
            </div>
            <div className="flex items-center justify-between gap-4 text-cyan-400">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-cyan-400" />
                Upload (TX):
              </span>
              <span className="font-bold">{payload[1]?.value} Mbps</span>
            </div>
            <div className="pt-1 mt-1 border-t border-slate-800 flex items-center justify-between gap-4 text-slate-300">
              <span>Combined Aggregate:</span>
              <span className="font-bold text-white">
                {((payload[0]?.value || 0) + (payload[1]?.value || 0)).toFixed(1)} Mbps
              </span>
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  // Custom Dark Tooltip for Subscriber Chart
  const CustomSubscriberTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const rx = payload[0]?.value || 0;
      const tx = payload[1]?.value || 0;
      const cap = currentPackage.downloadSpeedMbps;
      const pct = Math.round((rx / cap) * 100);

      return (
        <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 shadow-xl text-xs font-mono">
          <div className="text-slate-400 font-semibold mb-1 flex items-center justify-between gap-4">
            <span>{label}</span>
            <span className="text-indigo-400 font-sans">{currentCustomer.name}</span>
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-4 text-emerald-400">
              <span>Subscriber RX:</span>
              <span className="font-bold">{rx} Mbps</span>
            </div>
            <div className="flex items-center justify-between gap-4 text-cyan-400">
              <span>Subscriber TX:</span>
              <span className="font-bold">{tx} Mbps</span>
            </div>
            <div className="flex items-center justify-between gap-4 text-indigo-300">
              <span>Plan Speed Cap:</span>
              <span>{cap} Mbps</span>
            </div>
            <div className="pt-1 mt-1 border-t border-slate-800 flex items-center justify-between gap-4">
              <span className="text-slate-400">Profile Utilization:</span>
              <span className={`font-bold ${pct > 85 ? 'text-rose-400' : 'text-emerald-400'}`}>
                {pct}% of max
              </span>
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-5">
      {/* Top Banner & Mode Selector */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-cyan-400" />
            <h3 className="text-base font-bold text-white">Carrier Usage Analytics & Bandwidth Trends</h3>
            <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 font-mono">
              Recharts Telemetry
            </span>
          </div>
          <p className="text-xs text-slate-400">
            Real-time interface throughput, 95th-percentile billing metrics, and subscriber PPPoE historical profiles.
          </p>
        </div>

        {/* View Switcher: Interface vs Subscriber vs Top Talkers */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800">
            <button
              onClick={() => setAnalyticsView('interface')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition flex items-center gap-1.5 ${
                analyticsView === 'interface'
                  ? 'bg-cyan-600 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>Interface Throughput</span>
            </button>

            <button
              onClick={() => setAnalyticsView('subscriber')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition flex items-center gap-1.5 ${
                analyticsView === 'subscriber'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <User className="w-3.5 h-3.5" />
              <span>Subscriber Session Trends</span>
            </button>

            <button
              onClick={() => setAnalyticsView('top_talkers')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition flex items-center gap-1.5 ${
                analyticsView === 'top_talkers'
                  ? 'bg-emerald-600 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              <span>Top Talkers</span>
            </button>
          </div>
        </div>
      </div>

      {/* VIEW 1: INTERFACE THROUGHPUT ANALYTICS */}
      {analyticsView === 'interface' && (
        <div className="space-y-4">
          {/* Sub-controls: Interface Selector & Timeframe */}
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-slate-400 font-mono">Port / Interface:</span>
              <select
                value={selectedInterface}
                onChange={(e) => setSelectedInterface(e.target.value)}
                className="bg-slate-950 border border-slate-700 text-cyan-300 font-mono text-xs px-2.5 py-1.5 rounded-lg focus:outline-none focus:border-cyan-500"
              >
                <option value="sfp-sfpplus1">sfp-sfpplus1 (10G WAN Uplink - Cogent Transit)</option>
                <option value="sfp-sfpplus2">sfp-sfpplus2 (10G Dark Fiber Metro Ring)</option>
                <option value="ether1">ether1 (Local Aggregation Subnet - Sector G-11)</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              {/* Timeframe pill buttons */}
              <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800 text-[11px] font-mono">
                {[
                  { id: 'realtime', label: 'Live 30s' },
                  { id: '1h', label: '1 Hour' },
                  { id: '24h', label: '24 Hours' },
                  { id: '7d', label: '7 Days' },
                ].map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setTimeRange(item.id as any)}
                    className={`px-2.5 py-1 rounded transition ${
                      timeRange === item.id
                        ? 'bg-slate-800 text-cyan-400 font-bold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              {timeRange === 'realtime' && (
                <button
                  onClick={() => setIsTrafficStreaming(!isTrafficStreaming)}
                  className={`px-2.5 py-1 text-xs rounded font-medium transition ${
                    isTrafficStreaming
                      ? 'bg-slate-800 text-cyan-400 border border-cyan-800/60'
                      : 'bg-amber-950 text-amber-300 border border-amber-800'
                  }`}
                >
                  {isTrafficStreaming ? 'Streaming ●' : 'Paused ||'}
                </button>
              )}
            </div>
          </div>

          {/* Metric KPI chips */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
            <div className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800">
              <span className="text-slate-400 block text-[11px]">Current Download (RX)</span>
              <span className="text-emerald-400 font-bold text-sm flex items-center gap-1 mt-0.5">
                <ArrowDownLeft className="w-3.5 h-3.5" />
                {stats.currentRx} Mbps
              </span>
            </div>

            <div className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800">
              <span className="text-slate-400 block text-[11px]">Current Upload (TX)</span>
              <span className="text-cyan-400 font-bold text-sm flex items-center gap-1 mt-0.5">
                <ArrowUpRight className="w-3.5 h-3.5" />
                {stats.currentTx} Mbps
              </span>
            </div>

            <div className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800">
              <span className="text-slate-400 block text-[11px]">95th Percentile Committed</span>
              <span className="text-indigo-300 font-bold text-sm mt-0.5 block">
                {stats.p95Rx} Mbps
              </span>
            </div>

            <div className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800">
              <span className="text-slate-400 block text-[11px]">Peak Throughput Observed</span>
              <span className="text-amber-400 font-bold text-sm mt-0.5 block">
                {stats.peakRx} Mbps
              </span>
            </div>
          </div>

          {/* Recharts Area Chart for Interface */}
          <div className="bg-slate-950 rounded-xl p-4 border border-slate-800/80 h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={interfaceChartData}
                margin={{ top: 10, right: 10, left: -15, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="colorRx" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="colorTx" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" opacity={0.6} />
                <XAxis
                  dataKey="time"
                  stroke="#64748b"
                  fontSize={10}
                  tickLine={false}
                  fontFamily="monospace"
                />
                <YAxis
                  stroke="#64748b"
                  fontSize={10}
                  tickLine={false}
                  fontFamily="monospace"
                  tickFormatter={(val) => `${val}M`}
                />
                <Tooltip content={<CustomInterfaceTooltip />} />
                <Legend
                  verticalAlign="top"
                  align="right"
                  iconType="circle"
                  wrapperStyle={{ fontSize: '11px', fontFamily: 'monospace', paddingBottom: '8px' }}
                />
                <ReferenceLine
                  y={stats.p95Rx}
                  stroke="#818cf8"
                  strokeDasharray="4 4"
                  label={{
                    value: `95th %ile (${stats.p95Rx}M)`,
                    fill: '#a5b4fc',
                    fontSize: 10,
                    position: 'insideTopLeft',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="rx"
                  name="Download (RX)"
                  stroke="#10b981"
                  strokeWidth={2.5}
                  fillOpacity={1}
                  fill="url(#colorRx)"
                  isAnimationActive={timeRange !== 'realtime'}
                />
                <Area
                  type="monotone"
                  dataKey="tx"
                  name="Upload (TX)"
                  stroke="#06b6d4"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorTx)"
                  isAnimationActive={timeRange !== 'realtime'}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* VIEW 2: INDIVIDUAL SUBSCRIBER PPPoE TRENDS */}
      {analyticsView === 'subscriber' && (
        <div className="space-y-4">
          {/* Subscriber Selector & Package Profile Header */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-slate-950 p-3 rounded-lg border border-slate-800 text-xs">
            <div className="flex items-center gap-3">
              <span className="text-slate-400 font-mono">Select PPPoE Session:</span>
              <select
                value={selectedSubscriberUsername}
                onChange={(e) => setSelectedSubscriberUsername(e.target.value)}
                className="bg-slate-900 border border-slate-700 text-cyan-300 font-mono text-xs px-3 py-1.5 rounded-md focus:outline-none focus:border-cyan-500"
              >
                {activeSessions.map((session) => (
                  <option key={session.id} value={session.username}>
                    {session.username} - {session.customerName} ({session.profileName})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-3 font-mono text-[11px]">
              <span className="text-slate-400">Assigned IP:</span>
              <span className="text-cyan-400">{currentSession?.address || currentCustomer.assignedIp}</span>
              <span className="text-slate-600">|</span>
              <span className="text-slate-400">ONT Signal:</span>
              <span className="text-emerald-400 font-bold">{currentCustomer.ontSignalDbm} dBm</span>
            </div>
          </div>

          {/* Subscriber Telemetry Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
            <div className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800">
              <span className="text-slate-400 block text-[11px]">Subscribed Plan</span>
              <span className="text-white font-bold text-sm block mt-0.5">
                {currentPackage.downloadSpeedMbps} Mbps
              </span>
              <span className="text-[10px] text-slate-500">{currentPackage.name}</span>
            </div>

            <div className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800">
              <span className="text-slate-400 block text-[11px]">Current Live RX Rate</span>
              <span className="text-emerald-400 font-bold text-sm block mt-0.5">
                {currentSession?.rxRateMbps || 0} Mbps
              </span>
              <span className="text-[10px] text-emerald-500/80">
                {Math.round(((currentSession?.rxRateMbps || 0) / currentPackage.downloadSpeedMbps) * 100)}% of plan
              </span>
            </div>

            <div className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800">
              <span className="text-slate-400 block text-[11px]">Current Live TX Rate</span>
              <span className="text-cyan-400 font-bold text-sm block mt-0.5">
                {currentSession?.txRateMbps || 0} Mbps
              </span>
              <span className="text-[10px] text-slate-500">Upstream rate</span>
            </div>

            <div className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800">
              <span className="text-slate-400 block text-[11px]">Session Data Transferred</span>
              <span className="text-indigo-300 font-bold text-sm block mt-0.5">
                {(((currentSession?.bytesInMb || 0) + (currentSession?.bytesOutMb || 0)) / 1024).toFixed(2)} GB
              </span>
              <span className="text-[10px] text-slate-500">Uptime: {currentSession?.uptime}</span>
            </div>
          </div>

          {/* Recharts Composed Chart for Subscriber Session */}
          <div className="bg-slate-950 rounded-xl p-4 border border-slate-800/80 h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={subscriberChartData}
                margin={{ top: 10, right: 10, left: -15, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="subRxGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="subTxGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" opacity={0.6} />
                <XAxis
                  dataKey="time"
                  stroke="#64748b"
                  fontSize={10}
                  tickLine={false}
                  fontFamily="monospace"
                />
                <YAxis
                  stroke="#64748b"
                  fontSize={10}
                  tickLine={false}
                  fontFamily="monospace"
                  tickFormatter={(val) => `${val}M`}
                />
                <Tooltip content={<CustomSubscriberTooltip />} />
                <Legend
                  verticalAlign="top"
                  align="right"
                  iconType="circle"
                  wrapperStyle={{ fontSize: '11px', fontFamily: 'monospace', paddingBottom: '8px' }}
                />
                <ReferenceLine
                  y={currentPackage.downloadSpeedMbps}
                  stroke="#f43f5e"
                  strokeDasharray="3 3"
                  label={{
                    value: `Plan Limit (${currentPackage.downloadSpeedMbps} Mbps)`,
                    fill: '#fda4af',
                    fontSize: 10,
                    position: 'insideTopLeft',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="rxMbps"
                  name="Download Speed"
                  stroke="#10b981"
                  strokeWidth={2}
                  fill="url(#subRxGrad)"
                />
                <Line
                  type="monotone"
                  dataKey="txMbps"
                  name="Upload Speed"
                  stroke="#06b6d4"
                  strokeWidth={2}
                  dot={{ r: 2 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* VIEW 3: TOP TALKERS & BANDWIDTH CONSUMERS */}
      {analyticsView === 'top_talkers' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">
              Real-time active PPPoE sessions sorted by highest instantaneous bandwidth consumption:
            </span>
            <span className="text-cyan-400 font-mono">{topTalkersData.length} Active Sessions Analyzed</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-slate-950 text-slate-400 uppercase tracking-wider text-[11px] border-b border-slate-800">
                <tr>
                  <th className="py-2.5 px-3">Subscriber & Account</th>
                  <th className="py-2.5 px-3">Assigned IP</th>
                  <th className="py-2.5 px-3">Package Profile</th>
                  <th className="py-2.5 px-3">Live RX / TX</th>
                  <th className="py-2.5 px-3">Session Volume</th>
                  <th className="py-2.5 px-3">Line Utilization</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-300">
                {topTalkersData.map((talker, idx) => (
                  <tr key={talker.username} className="hover:bg-slate-800/40 transition">
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-slate-800 flex items-center justify-center text-[10px] text-cyan-300 font-bold">
                          #{idx + 1}
                        </span>
                        <div>
                          <div className="font-bold text-slate-100">{talker.username}</div>
                          <div className="text-[11px] text-slate-400 font-sans">{talker.name}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-cyan-300">{talker.ip}</td>
                    <td className="py-2.5 px-3 text-slate-400">{talker.profile}</td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-1.5 font-bold">
                        <span className="text-emerald-400">{talker.rxRate}M</span>
                        <span className="text-slate-600">/</span>
                        <span className="text-cyan-400">{talker.txRate}M</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 font-semibold text-indigo-300">
                      {talker.totalGb} GB
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="w-32">
                        <div className="flex justify-between text-[10px] text-slate-400 mb-0.5">
                          <span>{talker.utilization}%</span>
                          <span>Cap: {talker.cap}M</span>
                        </div>
                        <div className="w-full bg-slate-800 rounded-full h-1.5">
                          <div
                            className={`h-1.5 rounded-full ${
                              talker.utilization > 80
                                ? 'bg-rose-500'
                                : talker.utilization > 50
                                ? 'bg-amber-400'
                                : 'bg-emerald-400'
                            }`}
                            style={{ width: `${talker.utilization}%` }}
                          />
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
