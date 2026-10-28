import React, { useState, useMemo } from 'react';
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  Cpu,
  Layers,
  Radio,
  Search,
  Server,
  ShieldAlert,
  Zap,
} from 'lucide-react';
import { RouterInterface } from '../types/isp';

export interface RouterInterfacesTableProps {
  interfaces: RouterInterface[];
  routerName?: string;
  routerIp?: string;
  onRefresh?: () => void;
}

export const RouterInterfacesTable: React.FC<RouterInterfacesTableProps> = ({
  interfaces,
  routerName = 'MikroTik BNG',
  routerIp = '10.200.0.1',
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'running' | 'disabled' | 'link_down'>('all');

  const filteredInterfaces = useMemo(() => {
    return interfaces.filter((iface) => {
      const matchSearch =
        iface.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (iface.comment && iface.comment.toLowerCase().includes(searchQuery.toLowerCase())) ||
        iface.type.toLowerCase().includes(searchQuery.toLowerCase()) ||
        iface.macAddress.toLowerCase().includes(searchQuery.toLowerCase());

      const matchStatus =
        statusFilter === 'all' ||
        (statusFilter === 'running' && iface.status === 'running') ||
        (statusFilter === 'disabled' && iface.disabled) ||
        (statusFilter === 'link_down' && iface.status === 'link_down');

      return matchSearch && matchStatus;
    });
  }, [interfaces, searchQuery, statusFilter]);

  const runningCount = interfaces.filter((i) => i.status === 'running').length;
  const totalRx = interfaces.reduce((sum, i) => sum + (i.rxRateMbps || 0), 0);
  const totalTx = interfaces.reduce((sum, i) => sum + (i.txRateMbps || 0), 0);

  return (
    <div className="space-y-4 font-sans text-xs">
      {/* Top Controls Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-slate-900 border border-slate-800 p-4 rounded-xl shadow-lg">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <span>Hardware Port &amp; Interface Status (/interface)</span>
            <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 font-mono">
              {runningCount} / {interfaces.length} Up &amp; Running
            </span>
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Real-time interface link states, duplex speeds, and port traffic telemetry for {routerName} ({routerIp}).
          </p>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-60">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-500" />
            <input
              type="text"
              placeholder="Search port, comment, MAC..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 text-slate-200 text-xs pl-8 pr-3 py-1.5 rounded-lg focus:outline-none focus:border-cyan-500 font-mono"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="bg-slate-950 border border-slate-700 text-slate-200 text-xs px-3 py-1.5 rounded-lg focus:outline-none focus:border-cyan-500 font-mono"
          >
            <option value="all">All States ({interfaces.length})</option>
            <option value="running">Link Up ({runningCount})</option>
            <option value="disabled">Disabled</option>
            <option value="link_down">Link Down</option>
          </select>
        </div>
      </div>

      {/* Aggregate Traffic Summary Chips */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono">
        <div className="bg-slate-900/90 border border-slate-800 p-3 rounded-xl">
          <span className="text-slate-400 text-[11px] block">Aggregate Ports RX</span>
          <span className="text-emerald-400 font-bold text-sm flex items-center gap-1 mt-0.5">
            <ArrowDownLeft className="w-3.5 h-3.5" />
            {totalRx.toFixed(1)} Mbps
          </span>
        </div>
        <div className="bg-slate-900/90 border border-slate-800 p-3 rounded-xl">
          <span className="text-slate-400 text-[11px] block">Aggregate Ports TX</span>
          <span className="text-cyan-400 font-bold text-sm flex items-center gap-1 mt-0.5">
            <ArrowUpRight className="w-3.5 h-3.5" />
            {totalTx.toFixed(1)} Mbps
          </span>
        </div>
        <div className="bg-slate-900/90 border border-slate-800 p-3 rounded-xl">
          <span className="text-slate-400 text-[11px] block">10G SFP+ Uplinks</span>
          <span className="text-indigo-300 font-bold text-sm mt-0.5 block">
            {interfaces.filter((i) => i.linkSpeed === '10Gbps' && i.status === 'running').length} Active
          </span>
        </div>
        <div className="bg-slate-900/90 border border-slate-800 p-3 rounded-xl">
          <span className="text-slate-400 text-[11px] block">1G Distribution Ports</span>
          <span className="text-slate-200 font-bold text-sm mt-0.5 block">
            {interfaces.filter((i) => i.linkSpeed === '1Gbps' && i.status === 'running').length} Active
          </span>
        </div>
      </div>

      {/* Interface Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-950 border-b border-slate-800 text-[11px] font-semibold text-slate-400 uppercase tracking-wider font-mono">
                <th className="py-3 px-4">Interface Name</th>
                <th className="py-3 px-4">Type</th>
                <th className="py-3 px-4">Link State</th>
                <th className="py-3 px-4">Speed &amp; Duplex</th>
                <th className="py-3 px-4">Live RX Rate</th>
                <th className="py-3 px-4">Live TX Rate</th>
                <th className="py-3 px-4">MTU</th>
                <th className="py-3 px-4">MAC Address</th>
                <th className="py-3 px-4">Comment / Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 font-mono text-xs">
              {filteredInterfaces.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-slate-500 font-sans">
                    No interfaces match current search filter.
                  </td>
                </tr>
              ) : (
                filteredInterfaces.map((iface) => {
                  const isRunning = iface.status === 'running';
                  const isDown = iface.status === 'link_down';

                  return (
                    <tr
                      key={iface.id}
                      className="hover:bg-slate-800/40 transition group"
                    >
                      {/* Name */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-2 h-2 rounded-full ${
                              isRunning
                                ? 'bg-emerald-400 animate-pulse'
                                : isDown
                                ? 'bg-rose-500'
                                : 'bg-slate-600'
                            }`}
                          />
                          <span className="font-bold text-slate-100 group-hover:text-cyan-300 transition">
                            {iface.name}
                          </span>
                        </div>
                      </td>

                      {/* Type */}
                      <td className="py-3 px-4">
                        <span className="text-[10px] px-2 py-0.5 rounded bg-slate-950 text-slate-300 border border-slate-800">
                          {iface.type.toUpperCase()}
                        </span>
                      </td>

                      {/* Link State */}
                      <td className="py-3 px-4">
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded border uppercase font-bold ${
                            isRunning
                              ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                              : isDown
                              ? 'bg-rose-950 text-rose-300 border-rose-800'
                              : 'bg-slate-800 text-slate-400 border-slate-700'
                          }`}
                        >
                          {isRunning ? 'Running (Up)' : isDown ? 'Link Down' : 'Disabled'}
                        </span>
                      </td>

                      {/* Speed & Duplex */}
                      <td className="py-3 px-4 text-slate-300">
                        {isRunning ? (
                          <span className="text-cyan-300">
                            {iface.linkSpeed || '1Gbps'} {iface.fullDuplex ? 'Full' : 'Half'}
                          </span>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>

                      {/* Live RX Rate */}
                      <td className="py-3 px-4">
                        {isRunning && iface.rxRateMbps > 0 ? (
                          <span className="text-emerald-400 font-bold flex items-center gap-1">
                            <ArrowDownLeft className="w-3 h-3" />
                            {iface.rxRateMbps.toFixed(1)} Mbps
                          </span>
                        ) : (
                          <span className="text-slate-600">0.0 Mbps</span>
                        )}
                      </td>

                      {/* Live TX Rate */}
                      <td className="py-3 px-4">
                        {isRunning && iface.txRateMbps > 0 ? (
                          <span className="text-cyan-400 font-bold flex items-center gap-1">
                            <ArrowUpRight className="w-3 h-3" />
                            {iface.txRateMbps.toFixed(1)} Mbps
                          </span>
                        ) : (
                          <span className="text-slate-600">0.0 Mbps</span>
                        )}
                      </td>

                      {/* MTU */}
                      <td className="py-3 px-4 text-slate-400">
                        {iface.mtu || 1500}
                      </td>

                      {/* MAC Address */}
                      <td className="py-3 px-4 text-slate-400 text-[11px]">
                        {iface.macAddress}
                      </td>

                      {/* Comment */}
                      <td className="py-3 px-4 text-slate-300 font-sans max-w-xs truncate" title={iface.comment}>
                        {iface.comment || '—'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default RouterInterfacesTable;
