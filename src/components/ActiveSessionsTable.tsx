import React, { useState, useMemo } from 'react';
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Activity,
  Zap,
  Clock,
  Search,
  Filter,
  ShieldAlert,
  ChevronRight,
  ExternalLink,
  Wifi,
  Radio,
  Download,
  Upload,
} from 'lucide-react';
import { ActiveSession, InternetPackage } from '../types/isp';

export interface ActiveSessionsTableProps {
  sessions: ActiveSession[];
  packages?: InternetPackage[];
  isRouterOnline?: boolean;
  routerIp?: string;
  onSelectSession?: (session: ActiveSession) => void;
  onKickSession?: (sessionId: string, username: string) => Promise<void> | void;
  isKickingId?: string | null;
}

export type SortField = 'tx' | 'rx' | 'uptime' | 'user' | 'ip';
export type SortDirection = 'asc' | 'desc';

/**
 * Robust RouterOS uptime parser converts "6d 19h 51m 30s", "1w2d", "02:15:30", "45m" to total seconds
 */
export function parseUptimeSeconds(uptimeStr: string): number {
  if (!uptimeStr) return 0;
  const str = String(uptimeStr).trim();
  let total = 0;

  const weeks = str.match(/(\d+)\s*w/i);
  const days = str.match(/(\d+)\s*d/i);
  const hours = str.match(/(\d+)\s*h/i);
  const minutes = str.match(/(\d+)\s*m(?!s)/i);
  const seconds = str.match(/(\d+)\s*s/i);

  if (weeks) total += parseInt(weeks[1], 10) * 7 * 86400;
  if (days) total += parseInt(days[1], 10) * 86400;
  if (hours) total += parseInt(hours[1], 10) * 3600;
  if (minutes) total += parseInt(minutes[1], 10) * 60;
  if (seconds) total += parseInt(seconds[1], 10);

  if (!weeks && !days && !hours && !minutes && !seconds && str.includes(':')) {
    const parts = str.split(':').map((p) => parseInt(p, 10));
    if (parts.length === 3) {
      total = (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
    } else if (parts.length === 2) {
      total = (parts[0] || 0) * 60 + (parts[1] || 0);
    }
  }

  return total;
}

/**
 * Calculates whether a session is consuming > 80% of its provisioned package speed
 */
export function getBandwidthUtilization(session: ActiveSession, packages?: InternetPackage[]) {
  let profileSpeed = 20; // Default fallback in Mbps

  if (session.profileName && packages && packages.length > 0) {
    const matched = packages.find(
      (p) =>
        p.mikrotikProfile?.toLowerCase() === session.profileName.toLowerCase() ||
        p.name?.toLowerCase().includes(session.profileName.toLowerCase()) ||
        p.id?.toLowerCase() === session.profileName.toLowerCase()
    );
    if (matched && matched.downloadSpeedMbps > 0) {
      profileSpeed = matched.downloadSpeedMbps;
    }
  }

  if (profileSpeed === 20 && session.profileName) {
    const match = session.profileName.match(/(\d+)\s*(?:m|mbps)/i);
    if (match) {
      profileSpeed = parseInt(match[1], 10);
    }
  }

  const maxLiveRate = Math.max(session.txRateMbps || 0, session.rxRateMbps || 0);
  const ratio = profileSpeed > 0 ? maxLiveRate / profileSpeed : 0;
  const isHighUsage = ratio >= 0.8;
  const percentage = Math.round(ratio * 100);

  return {
    profileSpeed,
    maxLiveRate,
    isHighUsage,
    percentage,
  };
}

export const ActiveSessionsTable: React.FC<ActiveSessionsTableProps> = ({
  sessions,
  packages = [],
  isRouterOnline = true,
  routerIp,
  onSelectSession,
  onKickSession,
  isKickingId,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [quickSort, setQuickSort] = useState<'highest-tx' | 'highest-rx' | 'longest-uptime' | 'alpha-asc' | 'custom'>('highest-tx');
  const [sortField, setSortField] = useState<SortField>('tx');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [filterMode, setFilterMode] = useState<'all' | 'high_usage' | 'walled_garden'>('all');

  // Handle column header clicks
  const handleSortHeaderClick = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection(field === 'user' ? 'asc' : 'desc');
    }
    setQuickSort('custom');
  };

  // Handle quick sort dropdown change
  const handleQuickSortChange = (value: string) => {
    if (value === 'highest-tx') {
      setQuickSort('highest-tx');
      setSortField('tx');
      setSortDirection('desc');
    } else if (value === 'highest-rx') {
      setQuickSort('highest-rx');
      setSortField('rx');
      setSortDirection('desc');
    } else if (value === 'longest-uptime') {
      setQuickSort('longest-uptime');
      setSortField('uptime');
      setSortDirection('desc');
    } else if (value === 'alpha-asc') {
      setQuickSort('alpha-asc');
      setSortField('user');
      setSortDirection('asc');
    }
  };

  // Filter and sort sessions
  const processedSessions = useMemo(() => {
    let result = [...sessions];

    // 1. Text Search Filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (s) =>
          s.username.toLowerCase().includes(q) ||
          (s.customerName && s.customerName.toLowerCase().includes(q)) ||
          s.address.toLowerCase().includes(q) ||
          s.callerId.toLowerCase().includes(q) ||
          (s.profileName && s.profileName.toLowerCase().includes(q))
      );
    }

    // 2. Filter mode (All, High Usage > 80%, Walled Garden)
    if (filterMode === 'high_usage') {
      result = result.filter((s) => {
        const util = getBandwidthUtilization(s, packages);
        return util.isHighUsage;
      });
    } else if (filterMode === 'walled_garden') {
      result = result.filter((s) => s.address.startsWith('172.16.100') || s.profileName?.toLowerCase().includes('walled'));
    }

    // 3. Sorting
    result.sort((a, b) => {
      let comparison = 0;

      switch (sortField) {
        case 'tx':
          comparison = (a.txRateMbps || 0) - (b.txRateMbps || 0);
          break;
        case 'rx':
          comparison = (a.rxRateMbps || 0) - (b.rxRateMbps || 0);
          break;
        case 'uptime':
          comparison = parseUptimeSeconds(a.uptime) - parseUptimeSeconds(b.uptime);
          break;
        case 'user':
          comparison = a.username.localeCompare(b.username);
          break;
        case 'ip':
          comparison = a.address.localeCompare(b.address);
          break;
        default:
          comparison = (a.txRateMbps || 0) - (b.txRateMbps || 0);
      }

      return sortDirection === 'desc' ? -comparison : comparison;
    });

    return result;
  }, [sessions, searchQuery, filterMode, sortField, sortDirection, packages]);

  // High usage count
  const highUsageCount = useMemo(() => {
    return sessions.filter((s) => getBandwidthUtilization(s, packages).isHighUsage).length;
  }, [sessions, packages]);

  const walledGardenCount = useMemo(() => {
    return sessions.filter((s) => s.address.startsWith('172.16.100') || s.profileName?.toLowerCase().includes('walled')).length;
  }, [sessions]);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
      {/* Table Header & Controls Bar */}
      <div className="p-4 border-b border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3 bg-slate-900/90">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Radio className="w-4 h-4 text-cyan-400 animate-pulse" />
              Live Active PPPoE Sessions (/ppp/active)
            </h3>
            <span className="px-2 py-0.5 rounded-full text-[11px] font-mono bg-cyan-950 text-cyan-300 border border-cyan-800">
              {sessions.length} Online
            </span>
            {highUsageCount > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-950 text-amber-300 border border-amber-800 flex items-center gap-1 animate-pulse">
                <Zap className="w-3 h-3 text-amber-400" />
                {highUsageCount} Top Consumers (&gt;80%)
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Real-time interface telemetry via <code className="text-cyan-400">/interface/monitor-traffic</code>. Click any row to open Subscriber 360° Profile.
          </p>
        </div>

        {/* Live sync pulse indicator */}
        <div className="flex items-center gap-3">
          {isRouterOnline ? (
            <span className="text-xs font-mono text-emerald-400 flex items-center gap-1.5 bg-emerald-950/40 border border-emerald-800/60 px-2.5 py-1 rounded-md">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              <span>Real-time Live Sync</span>
            </span>
          ) : (
            <span className="text-xs font-mono text-rose-400 flex items-center gap-1.5 bg-rose-950/40 border border-rose-800/60 px-2.5 py-1 rounded-md">
              <span className="w-2 h-2 rounded-full bg-rose-500" />
              <span>Router Offline</span>
            </span>
          )}
        </div>
      </div>

      {/* Control Bar: Filter Pills, Quick Sort Dropdown & Search */}
      <div className="p-3 bg-slate-950/60 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
        {/* Quick Filter Buttons */}
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <button
            onClick={() => setFilterMode('all')}
            className={`px-2.5 py-1 rounded-md transition font-medium ${
              filterMode === 'all'
                ? 'bg-slate-800 text-cyan-300 border border-cyan-700/60 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
            }`}
          >
            All Sessions ({sessions.length})
          </button>
          <button
            onClick={() => setFilterMode('high_usage')}
            className={`px-2.5 py-1 rounded-md transition font-medium flex items-center gap-1 ${
              filterMode === 'high_usage'
                ? 'bg-amber-950 text-amber-300 border border-amber-700 shadow-sm'
                : 'text-slate-400 hover:text-amber-300 hover:bg-slate-800/40'
            }`}
          >
            <Zap className="w-3 h-3 text-amber-400" />
            Top Bandwidth ({highUsageCount})
          </button>
          <button
            onClick={() => setFilterMode('walled_garden')}
            className={`px-2.5 py-1 rounded-md transition font-medium flex items-center gap-1 ${
              filterMode === 'walled_garden'
                ? 'bg-rose-950 text-rose-300 border border-rose-700 shadow-sm'
                : 'text-slate-400 hover:text-rose-300 hover:bg-slate-800/40'
            }`}
          >
            <ShieldAlert className="w-3 h-3 text-rose-400" />
            Walled Garden ({walledGardenCount})
          </button>
        </div>

        <div className="flex items-center gap-2.5 flex-1 sm:flex-initial justify-end">
          {/* Quick Sort Dropdown */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400 text-xs hidden sm:inline">Sort:</span>
            <select
              value={quickSort === 'custom' ? '' : quickSort}
              onChange={(e) => handleQuickSortChange(e.target.value)}
              className="bg-slate-900 border border-slate-700 text-slate-200 text-xs py-1 px-2.5 rounded-md focus:outline-none focus:border-cyan-500 font-sans cursor-pointer"
            >
              <option value="highest-tx">Highest Download (TX) First</option>
              <option value="highest-rx">Highest Upload (RX) First</option>
              <option value="longest-uptime">Longest Uptime First</option>
              <option value="alpha-asc">Alphabetical (A-Z)</option>
              {quickSort === 'custom' && <option value="">Custom Column Sort</option>}
            </select>
          </div>

          {/* Search Bar */}
          <div className="relative w-full sm:w-56">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-500" />
            <input
              type="text"
              placeholder="Search user, IP, MAC..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 text-slate-200 text-xs pl-8 pr-3 py-1.5 rounded-md focus:outline-none focus:border-cyan-500 font-mono"
            />
          </div>
        </div>
      </div>

      {/* Main Sessions Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs font-mono">
          <thead className="bg-slate-950 text-slate-400 uppercase tracking-wider text-[11px] border-b border-slate-800 select-none">
            <tr>
              {/* PPPoE User */}
              <th
                onClick={() => handleSortHeaderClick('user')}
                className="py-3 px-4 cursor-pointer hover:text-cyan-400 transition"
              >
                <div className="flex items-center gap-1.5">
                  <span>PPPoE User</span>
                  {sortField === 'user' ? (
                    sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-cyan-400" /> : <ArrowDown className="w-3 h-3 text-cyan-400" />
                  ) : (
                    <ArrowUpDown className="w-3 h-3 text-slate-600" />
                  )}
                </div>
              </th>

              {/* Caller MAC */}
              <th className="py-3 px-4">Caller ID (MAC)</th>

              {/* Assigned IP */}
              <th
                onClick={() => handleSortHeaderClick('ip')}
                className="py-3 px-4 cursor-pointer hover:text-cyan-400 transition"
              >
                <div className="flex items-center gap-1.5">
                  <span>Assigned IP</span>
                  {sortField === 'ip' && (
                    sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-cyan-400" /> : <ArrowDown className="w-3 h-3 text-cyan-400" />
                  )}
                </div>
              </th>

              {/* Profile */}
              <th className="py-3 px-4">Profile</th>

              {/* Uptime (Clickable sort header) */}
              <th
                onClick={() => handleSortHeaderClick('uptime')}
                className="py-3 px-4 cursor-pointer hover:text-cyan-400 transition"
              >
                <div className="flex items-center gap-1.5">
                  <Clock className="w-3 h-3 text-slate-500" />
                  <span>Uptime</span>
                  {sortField === 'uptime' ? (
                    sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-cyan-400" /> : <ArrowDown className="w-3 h-3 text-cyan-400" />
                  ) : (
                    <ArrowUpDown className="w-3 h-3 text-slate-600" />
                  )}
                </div>
              </th>

              {/* Live Rate (RX / TX) (Clickable sort header) */}
              <th
                onClick={() => handleSortHeaderClick('tx')}
                className="py-3 px-4 cursor-pointer hover:text-cyan-400 transition"
              >
                <div className="flex items-center gap-1.5">
                  <Activity className="w-3 h-3 text-slate-500" />
                  <span>Live Rate (RX / TX)</span>
                  {sortField === 'tx' || sortField === 'rx' ? (
                    sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-cyan-400" /> : <ArrowDown className="w-3 h-3 text-cyan-400" />
                  ) : (
                    <ArrowUpDown className="w-3 h-3 text-slate-600" />
                  )}
                </div>
              </th>

              {/* Usage & Status Indicator */}
              <th className="py-3 px-4">Status & Usage</th>

              {/* Actions */}
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 text-slate-300">
            {processedSessions.map((session) => {
              const util = getBandwidthUtilization(session, packages);
              const isWalledGarden = session.address.startsWith('172.16.100') || session.profileName?.toLowerCase().includes('walled');

              return (
                <tr
                  key={session.id}
                  onClick={() => onSelectSession?.(session)}
                  className="hover:bg-slate-800/70 transition group cursor-pointer"
                  title="Click to open Subscriber 360° Profile"
                >
                  {/* PPPoE User */}
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                      <div>
                        <div className="font-bold text-slate-100 group-hover:text-cyan-300 transition flex items-center gap-1.5">
                          <span>{session.username}</span>
                          <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 text-cyan-400 transition" />
                        </div>
                        <div className="text-[11px] text-slate-400 font-sans">
                          {session.customerName || `PPPoE Account`}
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* Caller ID (MAC) */}
                  <td className="py-3 px-4 text-slate-400 font-mono text-[11px]">
                    {session.callerId || 'N/A'}
                  </td>

                  {/* Assigned IP */}
                  <td className="py-3 px-4">
                    <span
                      className={`px-2 py-0.5 rounded text-[11px] font-mono border ${
                        isWalledGarden
                          ? 'bg-rose-950/80 text-rose-300 border-rose-800'
                          : 'bg-slate-950 text-cyan-300 border-slate-700'
                      }`}
                    >
                      {session.address}
                    </span>
                  </td>

                  {/* Profile */}
                  <td className="py-3 px-4 text-slate-300">
                    <span className="bg-slate-800/80 px-2 py-0.5 rounded text-[11px] text-slate-200">
                      {session.profileName}
                    </span>
                  </td>

                  {/* Uptime */}
                  <td className="py-3 px-4 text-slate-400 text-[11px]">
                    {session.uptime}
                  </td>

                  {/* Live Rate (RX / TX) */}
                  <td className="py-3 px-4">
                    {session.liveRateFormatted ? (
                      <div className="flex items-center gap-1.5 font-mono text-xs">
                        <Download className="w-3 h-3 text-emerald-400 shrink-0" />
                        <span className="text-emerald-400 font-bold">
                          {session.liveRateFormatted.split('/')[0]?.trim()}
                        </span>
                        <span className="text-slate-600">/</span>
                        <Upload className="w-3 h-3 text-cyan-400 shrink-0" />
                        <span className="text-cyan-400 font-bold">
                          {session.liveRateFormatted.split('/')[1]?.trim()}
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 font-mono text-xs">
                        <Download className="w-3 h-3 text-emerald-400 shrink-0" />
                        <span className="text-emerald-400 font-bold">
                          {(session.rxRateMbps || 0) > 0 ? `${session.rxRateMbps} Mbps` : '0 Mbps'}
                        </span>
                        <span className="text-slate-600">/</span>
                        <Upload className="w-3 h-3 text-cyan-400 shrink-0" />
                        <span className="text-cyan-400 font-bold">
                          {(session.txRateMbps || 0) > 0 ? `${session.txRateMbps} Mbps` : '0 Mbps'}
                        </span>
                      </div>
                    )}
                  </td>

                  {/* Status & High-Usage Highlight */}
                  <td className="py-3 px-4">
                    {util.isHighUsage ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-700 shadow-sm animate-pulse">
                        <Zap className="w-3 h-3 text-amber-400" />
                        <span>High Load ({util.percentage}%)</span>
                      </span>
                    ) : isWalledGarden ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-rose-950 text-rose-300 border border-rose-800">
                        <ShieldAlert className="w-3 h-3 text-rose-400" />
                        <span>Walled Garden</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-800 text-emerald-400 border border-emerald-900/50">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                        <span>Nominal</span>
                      </span>
                    )}
                  </td>

                  {/* Actions */}
                  <td className="py-3 px-4 text-right">
                    <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => onSelectSession?.(session)}
                        className="bg-slate-800 hover:bg-slate-700 text-cyan-300 hover:text-cyan-200 border border-slate-700 px-2.5 py-1 rounded text-[11px] font-sans font-medium transition flex items-center gap-1"
                        title="Inspect 360° subscriber detail"
                      >
                        <span>360°</span>
                        <ChevronRight className="w-3 h-3" />
                      </button>

                      {onKickSession && (
                        <button
                          onClick={() => onKickSession(session.id, session.username)}
                          disabled={isKickingId === session.id}
                          className="bg-rose-950/80 hover:bg-rose-900 border border-rose-800/80 text-rose-300 hover:text-white px-2.5 py-1 rounded text-[11px] font-sans font-medium transition disabled:opacity-50 cursor-pointer"
                          title="Force disconnect / kick session"
                        >
                          {isKickingId === session.id ? 'Kicking...' : 'Kick'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}

            {processedSessions.length === 0 && (
              <tr>
                <td colSpan={8} className="py-12 text-center text-slate-400 font-sans">
                  {!isRouterOnline ? (
                    <div className="space-y-1">
                      <p className="text-rose-400 font-medium">Router {routerIp || ''} is unreachable.</p>
                      <p className="text-xs text-slate-500">
                        Live active PPPoE sessions cannot be retrieved until the physical router is online.
                      </p>
                    </div>
                  ) : searchQuery ? (
                    <div className="space-y-1">
                      <p className="text-slate-300 font-medium">No sessions matching "{searchQuery}"</p>
                      <p className="text-xs text-slate-500">Try clearing the search or changing the filter mode.</p>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <p className="text-slate-300 font-medium">No active PPPoE sessions found on this router.</p>
                      <p className="text-xs text-slate-500">
                        RouterOS <code className="text-cyan-400">/ppp/active/print</code> returned 0 connected clients.
                      </p>
                    </div>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
