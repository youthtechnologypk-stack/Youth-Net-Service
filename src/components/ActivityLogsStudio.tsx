import React, { useState, useEffect, useMemo } from 'react';
import {
  ShieldAlert,
  Search,
  Filter,
  Download,
  Trash2,
  RefreshCw,
  Plus,
  AlertTriangle,
  CheckCircle2,
  Info,
  Clock,
  User,
  Server,
  Terminal,
  FileText,
  Lock,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Layers,
  Calendar,
  X,
  Copy,
  Check,
} from 'lucide-react';
import {
  storageService,
  AuditLogEntry,
  AuditSeverity,
  AuditActionType,
} from '../services/storageService';
import { useISP } from '../context/ISPContext';
import { getStoredUser } from '../lib/auth';

export const ActivityLogsStudio: React.FC = () => {
  const { routers, selectedRouterId } = useISP();
  const currentUser = getStoredUser();

  const [logs, setLogs] = useState<AuditLogEntry[]>(() => storageService.getAuditLogs());
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedSeverity, setSelectedSeverity] = useState<string>('ALL');
  const [selectedActor, setSelectedActor] = useState<string>('ALL');
  const [dateRange, setDateRange] = useState<'today' | '24h' | '7d' | 'all'>('all');
  const [isAutoRefresh, setIsAutoRefresh] = useState(true);
  const [selectedLogForDetail, setSelectedLogForDetail] = useState<AuditLogEntry | null>(null);
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [isClearModalOpen, setIsClearModalOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Manual Log Note form state
  const [manualTitle, setManualTitle] = useState('');
  const [manualType, setManualType] = useState<AuditActionType>('CONFIG_CHANGE');
  const [manualTarget, setManualTarget] = useState('');
  const [manualSeverity, setManualSeverity] = useState<AuditSeverity>('INFO');
  const [manualDetails, setManualDetails] = useState('');

  // Synchronize with storage updates
  useEffect(() => {
    const handleStorageUpdate = (e: any) => {
      if (!e.detail || e.detail.entity === 'audit_logs') {
        setLogs(storageService.getAuditLogs());
      }
    };

    window.addEventListener('youthnet_storage_updated', handleStorageUpdate);
    return () => window.removeEventListener('youthnet_storage_updated', handleStorageUpdate);
  }, []);

  // Auto-refresh interval (5s)
  useEffect(() => {
    if (!isAutoRefresh) return;
    const interval = setInterval(() => {
      setLogs(storageService.getAuditLogs());
    }, 5000);
    return () => clearInterval(interval);
  }, [isAutoRefresh]);

  // Copy to clipboard helper
  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Filtered logs
  const filteredLogs = useMemo(() => {
    const now = Date.now();
    return logs.filter((log) => {
      // 1. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matches =
          (log?.actionTitle || '').toLowerCase().includes(q) ||
          (log?.actionType || '').toLowerCase().includes(q) ||
          (log?.actor || '').toLowerCase().includes(q) ||
          Boolean(log?.target && (log.target || '').toLowerCase().includes(q)) ||
          Boolean(log?.ipAddress && log.ipAddress.includes(q)) ||
          Boolean(log?.details && (log.details || '').toLowerCase().includes(q));
        if (!matches) return false;
      }

      // 2. Action Category Filter
      if (selectedCategory !== 'ALL') {
        const actionType = log?.actionType || '';
        if (selectedCategory === 'AUTH' && !actionType.startsWith('AUTH_')) return false;
        if (selectedCategory === 'SUBSCRIBER' && !actionType.startsWith('SUBSCRIBER_') && !actionType.includes('SESSION')) return false;
        if (selectedCategory === 'BILLING' && !actionType.startsWith('BILLING_')) return false;
        if (selectedCategory === 'ROUTER' && !actionType.startsWith('ROUTER_') && !actionType.includes('WALLED')) return false;
        if (selectedCategory === 'SECURITY' && actionType !== 'SECURITY_ALERT') return false;
      }

      // 3. Severity Filter
      if (selectedSeverity !== 'ALL' && log?.severity !== selectedSeverity) {
        return false;
      }

      // 4. Actor Filter
      if (selectedActor !== 'ALL' && (log?.actor || '').toLowerCase() !== (selectedActor || '').toLowerCase()) {
        return false;
      }

      // 5. Date Range Filter
      if (dateRange !== 'all') {
        const logTime = new Date(log.timestamp).getTime();
        if (dateRange === 'today') {
          const startOfToday = new Date();
          startOfToday.setHours(0, 0, 0, 0);
          if (logTime < startOfToday.getTime()) return false;
        } else if (dateRange === '24h') {
          if (now - logTime > 24 * 60 * 60 * 1000) return false;
        } else if (dateRange === '7d') {
          if (now - logTime > 7 * 24 * 60 * 60 * 1000) return false;
        }
      }

      return true;
    });
  }, [logs, searchQuery, selectedCategory, selectedSeverity, selectedActor, dateRange]);

  // Statistics
  const stats = useMemo(() => {
    const total = logs.length;
    const criticalCount = logs.filter((l) => l.severity === 'CRITICAL' || l.severity === 'WARNING').length;
    const securityCount = logs.filter((l) => l.actionType === 'SECURITY_ALERT' || l.actionType === 'AUTH_FAILED').length;
    const actorCounts = logs.reduce((acc, curr) => {
      acc[curr.actor] = (acc[curr.actor] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const mostActiveActor = Object.entries(actorCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'admin';

    return { total, criticalCount, securityCount, mostActiveActor };
  }, [logs]);

  // Unique actors for dropdown
  const uniqueActors = useMemo(() => {
    const set = new Set<string>();
    logs.forEach((l) => set.add(l.actor));
    return Array.from(set);
  }, [logs]);

  // Handle Manual Log Submission
  const handleSaveManualLog = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualTitle.trim()) return;

    storageService.logAuditEvent({
      actor: currentUser?.username || 'admin',
      actorRole: currentUser?.role || 'ADMIN',
      actionType: manualType,
      actionTitle: manualTitle.trim(),
      target: manualTarget.trim() || undefined,
      severity: manualSeverity,
      ipAddress: '127.0.0.1',
      details: manualDetails.trim() || 'Manual administrative audit event logged by technician.',
    });

    setManualTitle('');
    setManualTarget('');
    setManualDetails('');
    setIsManualModalOpen(false);
  };

  // Export handlers
  const handleExportCsv = () => {
    const csv = storageService.exportAuditLogsCsv();
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `youthnet-audit-logs-${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportJson = () => {
    const json = storageService.exportAuditLogsJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `youthnet-audit-logs-${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleClearLogs = async () => {
    await storageService.clearAuditLogs();
    setIsClearModalOpen(false);
  };

  // Helper for relative time
  const getRelativeTime = (timestamp: string) => {
    const diffSec = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000);
    if (diffSec < 60) return `${Math.max(1, diffSec)}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  };

  const getSeverityStyle = (severity: AuditSeverity) => {
    switch (severity) {
      case 'CRITICAL':
        return {
          icon: AlertTriangle,
          textColor: 'text-rose-400',
          dotBg: 'bg-rose-500',
        };
      case 'WARNING':
        return {
          icon: AlertTriangle,
          textColor: 'text-amber-400',
          dotBg: 'bg-amber-500',
        };
      case 'SUCCESS':
        return {
          icon: CheckCircle2,
          textColor: 'text-emerald-400',
          dotBg: 'bg-emerald-500',
        };
      default:
        return {
          icon: Info,
          textColor: 'text-cyan-400',
          dotBg: 'bg-cyan-500',
        };
    }
  };

  return (
    <div className="space-y-6 animate-fade-in font-sans">
      {/* 1. Header & Quick Audit Metrics */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-cyan-950 border border-cyan-800 text-cyan-400 rounded-lg">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white tracking-tight">
                  Carrier Activity &amp; Audit Logs
                </h2>
                <p className="text-xs text-slate-400">
                  Comprehensive audit trail of administrator authentications, PPPoE provisioning, and RouterOS changes
                </p>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setIsAutoRefresh((prev) => !prev)}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono transition flex items-center gap-2 border cursor-pointer ${
                isAutoRefresh
                  ? 'bg-slate-950 text-cyan-300 border-cyan-800/80'
                  : 'bg-slate-800 text-slate-400 border-slate-700'
              }`}
              title="Toggle Live Stream Poll (5s interval)"
            >
              <span className={`w-2 h-2 rounded-full ${isAutoRefresh ? 'bg-cyan-400 animate-ping' : 'bg-slate-600'}`} />
              <span>{isAutoRefresh ? 'Live Streaming' : 'Paused'}</span>
            </button>

            <button
              onClick={() => setLogs(storageService.getAuditLogs())}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition cursor-pointer"
              title="Manual Refresh"
            >
              <RefreshCw className="w-4 h-4" />
            </button>

            <button
              onClick={handleExportCsv}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>

            <button
              onClick={() => setIsManualModalOpen(true)}
              className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-slate-950 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-sm shadow-cyan-600/20"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>+ Log Audit Event</span>
            </button>

            <button
              onClick={() => setIsClearModalOpen(true)}
              className="p-1.5 rounded-lg bg-slate-950 hover:bg-rose-950 text-slate-500 hover:text-rose-400 border border-slate-800 hover:border-rose-900 transition cursor-pointer"
              title="Clear Audit Trail"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Unboxed Metadata Stats Row (Zero-Pill Compliance) */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 text-xs font-mono">
          <div>
            <span className="text-slate-500 block text-[11px]">Total Events</span>
            <span className="text-base font-bold text-white tracking-tight">{stats.total}</span>
          </div>
          <div>
            <span className="text-slate-500 block text-[11px]">Warnings &amp; Critical</span>
            <span className="text-base font-bold text-amber-400 tracking-tight">{stats.criticalCount}</span>
          </div>
          <div>
            <span className="text-slate-500 block text-[11px]">Security Alerts</span>
            <span className="text-base font-bold text-rose-400 tracking-tight">{stats.securityCount}</span>
          </div>
          <div>
            <span className="text-slate-500 block text-[11px]">Top Operator</span>
            <span className="text-base font-bold text-cyan-300 tracking-tight">@{stats.mostActiveActor}</span>
          </div>
        </div>
      </div>

      {/* 2. Interactive Filter Controls */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm space-y-3">
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
          {/* Search Bar */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by actor, IP address, subscriber username, or action..."
              className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-mono transition"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-2.5 text-slate-500 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Quick Filter Dropdowns */}
          <div className="flex items-center gap-2 flex-wrap text-xs">
            {/* Category */}
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="bg-slate-950 border border-slate-800 text-slate-200 py-2 px-3 rounded-lg focus:outline-none focus:border-cyan-500 font-sans"
            >
              <option value="ALL">All Categories</option>
              <option value="AUTH">Authentication &amp; Logins</option>
              <option value="SUBSCRIBER">PPPoE &amp; Provisioning</option>
              <option value="BILLING">Billing &amp; Payments</option>
              <option value="ROUTER">RouterOS &amp; Network</option>
              <option value="SECURITY">Security Alerts</option>
            </select>

            {/* Severity */}
            <select
              value={selectedSeverity}
              onChange={(e) => setSelectedSeverity(e.target.value)}
              className="bg-slate-950 border border-slate-800 text-slate-200 py-2 px-3 rounded-lg focus:outline-none focus:border-cyan-500 font-sans"
            >
              <option value="ALL">All Severities</option>
              <option value="INFO">Info</option>
              <option value="SUCCESS">Success</option>
              <option value="WARNING">Warning</option>
              <option value="CRITICAL">Critical</option>
            </select>

            {/* Actor */}
            <select
              value={selectedActor}
              onChange={(e) => setSelectedActor(e.target.value)}
              className="bg-slate-950 border border-slate-800 text-slate-200 py-2 px-3 rounded-lg focus:outline-none focus:border-cyan-500 font-sans"
            >
              <option value="ALL">All Operators</option>
              {uniqueActors.map((actor) => (
                <option key={actor} value={actor}>
                  @{actor}
                </option>
              ))}
            </select>

            {/* Date Range Buttons */}
            <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg p-0.5 font-mono text-[11px]">
              {(['all', 'today', '24h', '7d'] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setDateRange(r)}
                  className={`px-2 py-1 rounded transition uppercase cursor-pointer ${
                    dateRange === r
                      ? 'bg-cyan-600 text-slate-950 font-bold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Active Filter Notice */}
        {(selectedCategory !== 'ALL' || selectedSeverity !== 'ALL' || selectedActor !== 'ALL' || searchQuery) && (
          <div className="flex items-center justify-between text-[11px] text-slate-400 pt-2 border-t border-slate-800/60 font-mono">
            <span>
              Showing {filteredLogs.length} matching events of {logs.length} total.
            </span>
            <button
              onClick={() => {
                setSelectedCategory('ALL');
                setSelectedSeverity('ALL');
                setSelectedActor('ALL');
                setSearchQuery('');
              }}
              className="text-cyan-400 hover:text-cyan-300 underline cursor-pointer"
            >
              Reset Filters
            </button>
          </div>
        )}
      </div>

      {/* 3. Activity Logs Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-slate-950 text-slate-400 border-b border-slate-800 text-[11px] uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4">Timestamp</th>
                <th className="py-3 px-4">Severity</th>
                <th className="py-3 px-4">Action / Event</th>
                <th className="py-3 px-4">Operator</th>
                <th className="py-3 px-4">Target Entity</th>
                <th className="py-3 px-4">IP Address</th>
                <th className="py-3 px-4 text-right">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 text-slate-300">
              {filteredLogs.map((log) => {
                const style = getSeverityStyle(log.severity);
                const IconComponent = style.icon;

                return (
                  <tr
                    key={log.id}
                    onClick={() => setSelectedLogForDetail(log)}
                    className="hover:bg-slate-800/50 transition cursor-pointer group"
                  >
                    {/* Timestamp & Relative */}
                    <td className="py-3 px-4 whitespace-nowrap">
                      <div className="text-white font-medium">
                        {new Date(log.timestamp).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </div>
                      <div className="text-slate-500 text-[10px] font-sans">
                        {new Date(log.timestamp).toLocaleDateString()} · {getRelativeTime(log.timestamp)}
                      </div>
                    </td>

                    {/* Severity (Unboxed typography separator per zero-pill rule) */}
                    <td className="py-3 px-4 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full ${style.dotBg}`} />
                        <span className={`font-bold text-[11px] ${style.textColor}`}>
                          {log.severity}
                        </span>
                      </div>
                    </td>

                    {/* Action Title & Type */}
                    <td className="py-3 px-4">
                      <div className="text-white font-medium group-hover:text-cyan-300 transition">
                        {log.actionTitle}
                      </div>
                      <div className="text-slate-500 text-[10px]">
                        <code>{log.actionType}</code>
                      </div>
                    </td>

                    {/* Operator / Actor */}
                    <td className="py-3 px-4 whitespace-nowrap">
                      <div className="text-slate-200 flex items-center gap-1.5">
                        <User className="w-3 h-3 text-slate-500" />
                        <span className="font-bold">@{log.actor}</span>
                      </div>
                      <div className="text-slate-500 text-[10px] uppercase font-sans">
                        {log.actorRole}
                      </div>
                    </td>

                    {/* Target */}
                    <td className="py-3 px-4 whitespace-nowrap text-slate-300">
                      {log.target ? (
                        <span className="text-cyan-400 font-medium">
                          {log.target}
                        </span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>

                    {/* IP Address */}
                    <td className="py-3 px-4 whitespace-nowrap text-slate-400 text-[11px]">
                      {log.ipAddress || '127.0.0.1'}
                    </td>

                    {/* Detail button */}
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedLogForDetail(log);
                        }}
                        className="p-1 rounded bg-slate-800 group-hover:bg-cyan-950 text-slate-400 group-hover:text-cyan-300 border border-slate-700 transition"
                        title="View Full Audit Payload"
                      >
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}

              {filteredLogs.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-500 font-sans">
                    <ShieldAlert className="w-8 h-8 text-slate-600 mx-auto mb-2 opacity-50" />
                    <p className="text-sm font-medium">No activity log entries match your filter criteria.</p>
                    <p className="text-xs text-slate-600 mt-1">Try resetting search keywords or expanding date range.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 4. Log Detail Modal / Slide-Out */}
      {selectedLogForDetail && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in font-sans">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-xl w-full overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
            {/* Modal Header */}
            <div className="bg-slate-950 p-4 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-slate-900 border border-slate-700 text-cyan-400 rounded-lg">
                  <Terminal className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    Audit Event Payload #{selectedLogForDetail.id}
                  </h3>
                  <p className="text-xs text-slate-400 font-mono">
                    {new Date(selectedLogForDetail.timestamp).toLocaleString()}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedLogForDetail(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-4 overflow-y-auto text-xs">
              {/* Event Summary Grid */}
              <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-2 font-mono">
                <div className="flex justify-between border-b border-slate-800/80 pb-2">
                  <span className="text-slate-400">Action:</span>
                  <span className="text-white font-bold">{selectedLogForDetail.actionTitle}</span>
                </div>
                <div className="flex justify-between border-b border-slate-800/80 pb-2">
                  <span className="text-slate-400">Action Code:</span>
                  <span className="text-cyan-300"><code>{selectedLogForDetail.actionType}</code></span>
                </div>
                <div className="flex justify-between border-b border-slate-800/80 pb-2">
                  <span className="text-slate-400">Severity:</span>
                  <span className={`font-bold ${getSeverityStyle(selectedLogForDetail.severity).textColor}`}>
                    {selectedLogForDetail.severity}
                  </span>
                </div>
                <div className="flex justify-between border-b border-slate-800/80 pb-2">
                  <span className="text-slate-400">Operator:</span>
                  <span className="text-slate-200">
                    @{selectedLogForDetail.actor} ({selectedLogForDetail.actorRole})
                  </span>
                </div>
                {selectedLogForDetail.target && (
                  <div className="flex justify-between border-b border-slate-800/80 pb-2">
                    <span className="text-slate-400">Target Entity:</span>
                    <span className="text-cyan-400">{selectedLogForDetail.target}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-slate-400">Source IP:</span>
                  <span className="text-slate-300">{selectedLogForDetail.ipAddress || '127.0.0.1'}</span>
                </div>
              </div>

              {/* Event Description */}
              <div>
                <label className="block text-slate-400 font-semibold mb-1">Audit Log Description</label>
                <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-slate-200 leading-relaxed font-sans">
                  {selectedLogForDetail.details || 'No extended text description recorded.'}
                </div>
              </div>

              {/* Raw JSON Trace Payload */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-slate-400 font-semibold font-mono text-[11px]">
                    Structured JSON Trace Payload
                  </label>
                  <button
                    onClick={() => handleCopy(JSON.stringify(selectedLogForDetail, null, 2), selectedLogForDetail.id)}
                    className="text-cyan-400 hover:text-cyan-300 text-[11px] font-mono flex items-center gap-1 cursor-pointer"
                  >
                    {copiedId === selectedLogForDetail.id ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Copy JSON</span>
                      </>
                    )}
                  </button>
                </div>
                <pre className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-cyan-300 font-mono text-[11px] overflow-x-auto max-h-48">
                  {JSON.stringify(selectedLogForDetail, null, 2)}
                </pre>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="bg-slate-950 p-3 border-t border-slate-800 flex justify-end">
              <button
                onClick={() => setSelectedLogForDetail(null)}
                className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. Manual Audit Event Logging Modal */}
      {isManualModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in font-sans">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full overflow-hidden shadow-2xl">
            <div className="bg-slate-950 p-4 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Plus className="w-4 h-4 text-cyan-400" />
                <h3 className="text-sm font-bold text-white">Log Administrative Audit Note</h3>
              </div>
              <button
                onClick={() => setIsManualModalOpen(false)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveManualLog} className="p-4 space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Event Title / Summary</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Scheduled Core Router Maintenance or Fiber Splicing"
                  value={manualTitle}
                  onChange={(e) => setManualTitle(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Action Type</label>
                  <select
                    value={manualType}
                    onChange={(e) => setManualType(e.target.value as AuditActionType)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-white focus:outline-none focus:border-cyan-500 font-mono"
                  >
                    <option value="CONFIG_CHANGE">CONFIG_CHANGE</option>
                    <option value="SECURITY_ALERT">SECURITY_ALERT</option>
                    <option value="ROUTER_CONFIG_UPDATE">ROUTER_CONFIG_UPDATE</option>
                    <option value="SUBSCRIBER_PROVISION">SUBSCRIBER_PROVISION</option>
                    <option value="BILLING_CRON_EXEC">BILLING_CRON_EXEC</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Severity</label>
                  <select
                    value={manualSeverity}
                    onChange={(e) => setManualSeverity(e.target.value as AuditSeverity)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-white focus:outline-none focus:border-cyan-500 font-mono"
                  >
                    <option value="INFO">INFO</option>
                    <option value="SUCCESS">SUCCESS</option>
                    <option value="WARNING">WARNING</option>
                    <option value="CRITICAL">CRITICAL</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Target Entity (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. BRAS-CCR2004 or Sector G-11"
                  value={manualTarget}
                  onChange={(e) => setManualTarget(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-white focus:outline-none focus:border-cyan-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Audit Details &amp; Operational Justification</label>
                <textarea
                  rows={3}
                  required
                  placeholder="Provide technical justification or changelog details for compliance..."
                  value={manualDetails}
                  onChange={(e) => setManualDetails(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-white focus:outline-none focus:border-cyan-500 font-sans"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsManualModalOpen(false)}
                  className="px-3.5 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold"
                >
                  Log Audit Event
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 6. Clear Logs Confirmation Modal */}
      {isClearModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in font-sans">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-sm w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3 text-rose-400">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h3 className="text-base font-bold text-white">Clear Audit Trail?</h3>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Are you sure you want to purge all active activity audit logs? This action is irreversible and should only be performed in accordance with telecom compliance retention policies.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsClearModalOpen(false)}
                className="px-3.5 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleClearLogs}
                className="px-4 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs"
              >
                Clear Audit Trail
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
