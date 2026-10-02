import React, { useState } from 'react';
import {
  Layers,
  Activity,
  Server,
  Zap,
  Radio,
  Search,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Smartphone,
  ExternalLink,
  Plus,
  Sliders,
  Send,
  SlidersHorizontal,
  HardDrive,
  Info,
  Power,
  RotateCw,
  Edit2,
  Settings,
} from 'lucide-react';
import { useISP } from '../context/ISPContext';
import { OnuDevice, VsolOlt, OpticalSignalQuality } from '../types/olt';
import { getSignalColorClass } from '../services/oltUtils';
import { AddEditOltModal } from './AddEditOltModal';
import { OltFleetManagerModal } from './OltFleetManagerModal';

export const VsolOltStudio: React.FC = () => {
  const {
    olts,
    onus,
    selectedOltId,
    setSelectedOltId,
    refreshOnuSignal,
    rebootOnu,
    logWhatsAppNotice,
  } = useISP();

  const [searchQuery, setSearchQuery] = useState('');
  const [qualityFilter, setQualityFilter] = useState<'ALL' | OpticalSignalQuality | 'offline'>('ALL');
  const [ponPortFilter, setPonPortFilter] = useState<string>('ALL');
  const [pollingOnuId, setPollingOnuId] = useState<string | null>(null);
  const [rebootingOnuId, setRebootingOnuId] = useState<string | null>(null);
  const [notificationMsg, setNotificationMsg] = useState<{ text: string; type: 'success' | 'warning' | 'info' } | null>(null);

  // OLT Fleet Modals state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isFleetManagerOpen, setIsFleetManagerOpen] = useState(false);
  const [oltToEdit, setOltToEdit] = useState<VsolOlt | null>(null);

  const currentOlt = olts.find((o) => o.id === selectedOltId) || olts[0];
  const oltOnus = onus.filter((o) => !currentOlt || o.oltId === currentOlt.id);

  // Optical Health Counts
  const goodCount = oltOnus.filter((o) => o.opticalQuality === 'good' && o.status === 'online').length;
  const warningCount = oltOnus.filter((o) => o.opticalQuality === 'warning' && o.status === 'online').length;
  const criticalCount = oltOnus.filter((o) => o.opticalQuality === 'critical' || o.status !== 'online').length;
  const dyingGaspCount = oltOnus.filter((o) => o.status === 'dying_gasp').length;

  const filteredOnus = oltOnus.filter((onu) => {
    if (qualityFilter === 'offline' && onu.status === 'online') return false;
    if (qualityFilter !== 'ALL' && qualityFilter !== 'offline' && onu.opticalQuality !== qualityFilter) return false;
    if (ponPortFilter !== 'ALL' && !onu.ponPort.startsWith(ponPortFilter)) return false;

    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      onu.customerName.toLowerCase().includes(q) ||
      onu.pppoeUsername.toLowerCase().includes(q) ||
      onu.macAddress.toLowerCase().includes(q) ||
      onu.ponPort.toLowerCase().includes(q) ||
      onu.model.toLowerCase().includes(q)
    );
  });

  const handlePollSignal = async (onu: OnuDevice) => {
    setPollingOnuId(onu.id);
    try {
      const updated = await refreshOnuSignal(onu.id);
      setNotificationMsg({
        type: 'success',
        text: `SNMP Poll Success: ${updated.customerName} Rx Power: ${updated.rxPowerDbm} dBm (Tx: +${updated.txPowerDbm} dBm)`,
      });
    } catch {
      setNotificationMsg({ type: 'warning', text: `Failed to poll SNMP for ${onu.customerName}` });
    } finally {
      setPollingOnuId(null);
      setTimeout(() => setNotificationMsg(null), 4000);
    }
  };

  const handleRebootOnu = async (onu: OnuDevice) => {
    setRebootingOnuId(onu.id);
    try {
      await rebootOnu(onu.id);
      setNotificationMsg({
        type: 'info',
        text: `Sent OMCI Remote Reboot command to ONU ${onu.macAddress} (${onu.customerName}).`,
      });
    } finally {
      setRebootingOnuId(null);
      setTimeout(() => setNotificationMsg(null), 4000);
    }
  };

  const handleShareOpticalReportWhatsApp = (onu: OnuDevice) => {
    const text =
      `📡 *YOUTH NET FIBER - OPTICAL LINE HEALTH REPORT*\n` +
      `----------------------------------------\n` +
      `Subscriber: *${onu.customerName}*\n` +
      `PPPoE Login: \`${onu.pppoeUsername}\`\n` +
      `PON Port: ${onu.ponPort} (ONU #${onu.onuIndex})\n` +
      `ONT MAC: \`${onu.macAddress}\`\n` +
      `Fiber Distance: ${onu.distanceMeters} meters\n\n` +
      `📶 *Optical Rx Power:* ${onu.rxPowerDbm} dBm\n` +
      `📶 *Optical Tx Power:* +${onu.txPowerDbm} dBm\n` +
      `💡 *OLT SFP Tx Power:* +${onu.oltTxPowerDbm} dBm\n` +
      `🛡️ *Signal Quality:* ${onu.opticalQuality.toUpperCase()} (${onu.opticalQuality === 'good' ? 'Optimal - No Attenuation' : onu.opticalQuality === 'warning' ? 'Warning - Minor Bend/Dirty Connector' : 'Critical - Fiber Loss Detected'})\n` +
      `⚡ *Status:* ${onu.status.toUpperCase()}\n\n` +
      `_Youth Net NOC Fiber Transmission Team_`;

    logWhatsAppNotice(onu.customerPhone, onu.customerName, text, 'onu_optical_signal_report');

    const cleanPhone = onu.customerPhone.replace(/[^\d+]/g, '').replace('+', '');
    const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');

    setNotificationMsg({
      type: 'success',
      text: `Optical signal report generated & dispatched to ${onu.customerName} via WhatsApp!`,
    });
    setTimeout(() => setNotificationMsg(null), 4000);
  };

  return (
    <div className="space-y-6 text-xs font-sans">
      {/* Top Header & VSOL OLT Hardware Overview */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-gradient-to-tr from-cyan-600 to-blue-600 text-white shadow-lg shadow-cyan-500/20">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white">
                  VSOL OLT (EPON / GPON) Carrier Integration
                </h3>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-800 font-mono font-bold">
                  SNMP v2c &amp; OMCI
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Real-time Optical Signal (Rx/Tx dBm) Telemetry, High Attenuation Warnings, and Dying Gasp Detection.
              </p>
            </div>
          </div>

          {/* OLT Selector Dropdown and Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 px-3 py-1.5 rounded-xl">
              <Server className="w-4 h-4 text-cyan-400 shrink-0" />
              <div className="flex flex-col">
                <span className="text-[9px] text-slate-400 uppercase font-mono">Active OLT Hardware</span>
                <select
                  value={selectedOltId}
                  onChange={(e) => setSelectedOltId(e.target.value)}
                  className="bg-transparent text-white font-bold text-xs focus:outline-none cursor-pointer"
                >
                  {olts.map((olt) => (
                    <option key={olt.id} value={olt.id} className="bg-slate-900 text-white">
                      {olt.name} ({olt.ponType} - {olt.ipAddress})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <button
              onClick={() => {
                setOltToEdit(currentOlt);
                setIsAddModalOpen(true);
              }}
              className="p-2.5 bg-slate-950 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 rounded-xl transition cursor-pointer"
              title="Edit Current OLT Configuration"
            >
              <Edit2 className="w-4 h-4 text-cyan-400" />
            </button>

            <button
              onClick={() => setIsFleetManagerOpen(true)}
              className="px-3 py-2 bg-slate-950 hover:bg-slate-800 text-slate-200 border border-slate-800 rounded-xl font-bold text-xs transition flex items-center gap-1.5 cursor-pointer"
              title="Manage OLT Fleet & Hardware Hub"
            >
              <Settings className="w-3.5 h-3.5 text-cyan-400" />
              <span>Manage Fleet ({olts.length})</span>
            </button>

            <button
              onClick={() => {
                setOltToEdit(null);
                setIsAddModalOpen(true);
              }}
              className="px-3 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-slate-950 rounded-xl font-bold text-xs transition flex items-center gap-1.5 cursor-pointer shadow-md shadow-cyan-950/40"
              title="Register a New OLT"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>+ Add OLT</span>
            </button>
          </div>
        </div>

        {/* Selected OLT Live Specs Strip */}
        {currentOlt && (
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2.5 pt-3 border-t border-slate-800 text-[11px] font-mono">
            <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800/80">
              <span className="text-slate-400 text-[10px] block">Model</span>
              <span className="text-white font-bold truncate block">{currentOlt.model.split(' ')[1]}</span>
            </div>

            <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800/80">
              <span className="text-slate-400 text-[10px] block">IP &amp; SNMP Port</span>
              <span className="text-cyan-400 font-bold block">{currentOlt.ipAddress}:{currentOlt.snmpPort}</span>
            </div>

            <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800/80">
              <span className="text-slate-400 text-[10px] block">Firmware</span>
              <span className="text-slate-300 font-bold block">{currentOlt.firmwareVersion.slice(0, 10)}</span>
            </div>

            <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800/80">
              <span className="text-slate-400 text-[10px] block">CPU Load</span>
              <span className="text-emerald-400 font-bold block">{currentOlt.cpuLoad}%</span>
            </div>

            <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800/80">
              <span className="text-slate-400 text-[10px] block">Chassis Temp</span>
              <span className="text-amber-400 font-bold block">{currentOlt.temperatureC}°C</span>
            </div>

            <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800/80">
              <span className="text-slate-400 text-[10px] block">Power Supply</span>
              <span className="text-cyan-300 font-bold block">Dual AC (OK)</span>
            </div>
          </div>
        )}

        {/* Quick OLT Fleet Switcher Strip (Old and New OLTs) */}
        <div className="pt-3 border-t border-slate-800/80">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider font-mono flex items-center gap-1.5">
              <span>OLT Fleet Quick Switcher</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-300">
                {olts.length} Units Registered
              </span>
            </span>
            <button
              onClick={() => setIsFleetManagerOpen(true)}
              className="text-[11px] text-cyan-400 hover:underline flex items-center gap-1 font-mono cursor-pointer"
            >
              Configure Fleet &rarr;
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {olts.map((olt) => {
              const mappedCount = onus.filter((o) => o.oltId === olt.id).length;
              const isSelected = selectedOltId === olt.id;

              return (
                <div
                  key={olt.id}
                  onClick={() => setSelectedOltId(olt.id)}
                  className={`p-2.5 rounded-xl border transition cursor-pointer font-mono ${
                    isSelected
                      ? 'bg-slate-950 border-cyan-500 ring-1 ring-cyan-500/50 shadow-md shadow-cyan-950/40'
                      : 'bg-slate-950/50 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 truncate">
                      <span className={`w-2 h-2 rounded-full ${isSelected ? 'bg-cyan-400 animate-pulse' : 'bg-slate-500'}`} />
                      <span className="font-bold text-white text-xs truncate">{olt.name}</span>
                    </div>
                    <span className={`text-[9px] px-1.5 py-0.2 rounded font-bold uppercase ${
                      olt.ponType === 'GPON' ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-indigo-950 text-indigo-300 border border-indigo-800'
                    }`}>
                      {olt.ponType}
                    </span>
                  </div>

                  <div className="flex items-center justify-between mt-2 text-[10px] text-slate-400 pt-1 border-t border-slate-800/80">
                    <span className="text-cyan-400">{olt.ipAddress}</span>
                    <span>{mappedCount} ONUs Mapped</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {notificationMsg && (
        <div className={`p-3 rounded-xl border text-xs font-mono flex items-center gap-2 animate-fade-in shadow-md ${
          notificationMsg.type === 'success'
            ? 'bg-emerald-950/80 border-emerald-700 text-emerald-300'
            : notificationMsg.type === 'warning'
            ? 'bg-amber-950/80 border-amber-700 text-amber-300'
            : 'bg-cyan-950/80 border-cyan-700 text-cyan-300'
        }`}>
          {notificationMsg.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          )}
          <span>{notificationMsg.text}</span>
        </div>
      )}

      {/* Optical Health Threshold Cards (Good, Warning, Critical) */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        {/* Good Signal */}
        <div
          onClick={() => setQualityFilter(qualityFilter === 'good' ? 'ALL' : 'good')}
          className={`p-3.5 rounded-xl border transition cursor-pointer ${
            qualityFilter === 'good'
              ? 'bg-emerald-950/80 border-emerald-500 shadow-lg shadow-emerald-950/40 ring-1 ring-emerald-500'
              : 'bg-slate-900 border-slate-800 hover:border-emerald-700/60'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-emerald-400 flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
              <span>Optimal Signal</span>
            </span>
            <span className="text-[10px] text-slate-400 font-mono">-12 to -23 dBm</span>
          </div>
          <div className="flex items-baseline justify-between mt-2">
            <span className="text-2xl font-bold font-mono text-emerald-300">{goodCount}</span>
            <span className="text-[10px] text-slate-400">ONUs Optimal</span>
          </div>
        </div>

        {/* Warning / High Attenuation */}
        <div
          onClick={() => setQualityFilter(qualityFilter === 'warning' ? 'ALL' : 'warning')}
          className={`p-3.5 rounded-xl border transition cursor-pointer ${
            qualityFilter === 'warning'
              ? 'bg-amber-950/80 border-amber-500 shadow-lg shadow-amber-950/40 ring-1 ring-amber-500'
              : 'bg-slate-900 border-slate-800 hover:border-amber-700/60'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-amber-400 flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
              <span>High Attenuation</span>
            </span>
            <span className="text-[10px] text-slate-400 font-mono">-24 to -27 dBm</span>
          </div>
          <div className="flex items-baseline justify-between mt-2">
            <span className="text-2xl font-bold font-mono text-amber-300">{warningCount}</span>
            <span className="text-[10px] text-slate-400">Needs Cleaning/Splice</span>
          </div>
        </div>

        {/* Critical / Fiber Cut */}
        <div
          onClick={() => setQualityFilter(qualityFilter === 'critical' ? 'ALL' : 'critical')}
          className={`p-3.5 rounded-xl border transition cursor-pointer ${
            qualityFilter === 'critical'
              ? 'bg-rose-950/80 border-rose-500 shadow-lg shadow-rose-950/40 ring-1 ring-rose-500'
              : 'bg-slate-900 border-slate-800 hover:border-rose-700/60'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-rose-400 flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping" />
              <span>Critical / Cut</span>
            </span>
            <span className="text-[10px] text-slate-400 font-mono">&lt; -28 dBm</span>
          </div>
          <div className="flex items-baseline justify-between mt-2">
            <span className="text-2xl font-bold font-mono text-rose-400">{criticalCount}</span>
            <span className="text-[10px] text-slate-400">LOS / Fiber Cut</span>
          </div>
        </div>

        {/* Dying Gasp Alert */}
        <div
          onClick={() => setQualityFilter(qualityFilter === 'offline' ? 'ALL' : 'offline')}
          className={`p-3.5 rounded-xl border transition cursor-pointer ${
            qualityFilter === 'offline'
              ? 'bg-purple-950/80 border-purple-500 shadow-lg shadow-purple-950/40 ring-1 ring-purple-500'
              : 'bg-slate-900 border-slate-800 hover:border-purple-700/60'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-purple-400 flex items-center gap-1.5">
              <Power className="w-3.5 h-3.5 text-purple-400" />
              <span>Dying Gasp / Off</span>
            </span>
            <span className="text-[10px] text-slate-400 font-mono">AC Power Loss</span>
          </div>
          <div className="flex items-baseline justify-between mt-2">
            <span className="text-2xl font-bold font-mono text-purple-300">{dyingGaspCount}</span>
            <span className="text-[10px] text-slate-400">Power Failure</span>
          </div>
        </div>
      </div>

      {/* PON Port SFP Optics Visualizer */}
      {currentOlt && currentOlt.sfpModules && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Radio className="w-4 h-4 text-cyan-400" />
              <h4 className="font-bold text-white text-xs">OLT PON Port SFP Transceiver Status</h4>
            </div>
            <span className="text-[10px] text-slate-400 font-mono">
              Tx: 1490nm DFB Laser | Rx: 1310nm APD Receiver
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs font-mono">
            {currentOlt.sfpModules.map((sfp) => (
              <div
                key={sfp.port}
                onClick={() => setPonPortFilter(ponPortFilter === sfp.port ? 'ALL' : sfp.port)}
                className={`p-3 rounded-lg border transition cursor-pointer ${
                  ponPortFilter === sfp.port
                    ? 'bg-cyan-950/70 border-cyan-500 ring-1 ring-cyan-500'
                    : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-cyan-300">{sfp.port}</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                    SFP+ Class C+
                  </span>
                </div>
                <div className="space-y-0.5 text-[11px]">
                  <div className="flex justify-between text-slate-400">
                    <span>Tx Power:</span>
                    <span className="text-emerald-400 font-bold">+{sfp.sfpTxPowerDbm} dBm</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Active ONUs:</span>
                    <span className="text-white font-bold">{sfp.activeOnus}/{sfp.maxOnus}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filter and Live Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-900 border border-slate-800 p-3 rounded-xl">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none text-xs">
          {[
            { id: 'ALL', label: `All ONUs (${oltOnus.length})` },
            { id: 'good', label: `Optimal 🟢 (${goodCount})` },
            { id: 'warning', label: `Warning 🟡 (${warningCount})` },
            { id: 'critical', label: `Critical 🔴 (${criticalCount})` },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setQualityFilter(tab.id as any)}
              className={`px-3 py-1.5 rounded-lg font-semibold whitespace-nowrap transition cursor-pointer ${
                qualityFilter === tab.id
                  ? 'bg-cyan-600 text-slate-950 font-bold'
                  : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Search Subscriber, MAC, PON Port..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full sm:w-64 pl-8 pr-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-200 text-xs focus:outline-none focus:border-cyan-500 font-mono"
          />
        </div>
      </div>

      {/* Live ONU Optical Power Monitoring Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-950 border-b border-slate-800 text-slate-400 font-mono text-[11px] uppercase tracking-wider">
                <th className="py-3 px-4">Subscriber &amp; PPPoE Account</th>
                <th className="py-3 px-4">PON Port &amp; ONT Model</th>
                <th className="py-3 px-4">MAC Address &amp; Distance</th>
                <th className="py-3 px-4">Received Power (Rx dBm)</th>
                <th className="py-3 px-4">Tx Power</th>
                <th className="py-3 px-4">Status &amp; Quality</th>
                <th className="py-3 px-4 text-right">SNMP Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {filteredOnus.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500 font-mono">
                    No ONUs match the selected criteria.
                  </td>
                </tr>
              ) : (
                filteredOnus.map((onu) => {
                  const color = getSignalColorClass(onu.opticalQuality);
                  const isPolling = pollingOnuId === onu.id;
                  const isRebooting = rebootingOnuId === onu.id;

                  return (
                    <tr key={onu.id} className="hover:bg-slate-950/40 transition">
                      {/* Subscriber Name & PPPoE */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs ${color.bg} ${color.text} border ${color.border}`}>
                            <Radio className="w-4 h-4" />
                          </div>
                          <div>
                            <span className="font-bold text-white block">{onu.customerName}</span>
                            <span className="text-[10px] text-cyan-400 font-mono block">
                              PPPoE: @{onu.pppoeUsername}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* PON Port & ONT Model */}
                      <td className="py-3 px-4 font-mono text-[11px]">
                        <span className="text-slate-200 font-bold block">{onu.ponPort} #{onu.onuIndex}</span>
                        <span className="text-slate-400">{onu.vendor} {onu.model}</span>
                      </td>

                      {/* MAC Address & Distance */}
                      <td className="py-3 px-4 font-mono text-[11px]">
                        <span className="text-slate-300 block">{onu.macAddress}</span>
                        <span className="text-slate-500">{onu.distanceMeters} m from OLT</span>
                      </td>

                      {/* Rx Power (dBm) with Visual Gauge */}
                      <td className="py-3 px-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className={`font-mono font-bold text-sm ${color.text}`}>
                              {onu.rxPowerDbm.toFixed(1)} dBm
                            </span>
                            {onu.status === 'dying_gasp' && (
                              <span className="text-[9px] px-1 py-0.2 rounded bg-purple-950 text-purple-300 font-mono border border-purple-700">
                                Dying Gasp
                              </span>
                            )}
                          </div>

                          {/* Optical Power Gauge Bar (-35 to -10 dBm) */}
                          <div className="w-28 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                onu.opticalQuality === 'good'
                                  ? 'bg-emerald-400'
                                  : onu.opticalQuality === 'warning'
                                  ? 'bg-amber-400'
                                  : 'bg-rose-500'
                              }`}
                              style={{
                                width: `${Math.min(100, Math.max(10, ((onu.rxPowerDbm + 35) / 25) * 100))}%`,
                              }}
                            />
                          </div>
                        </div>
                      </td>

                      {/* Tx Power */}
                      <td className="py-3 px-4 font-mono text-[11px] text-slate-300">
                        +{onu.txPowerDbm.toFixed(1)} dBm
                      </td>

                      {/* Signal Quality & Status Badge */}
                      <td className="py-3 px-4">
                        <span className={`text-[10px] px-2 py-0.5 rounded font-mono font-bold uppercase tracking-wider inline-flex items-center gap-1.5 border ${color.badge}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${color.dot}`} />
                          <span>{onu.opticalQuality}</span>
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5 font-mono">
                          <button
                            onClick={() => handlePollSignal(onu)}
                            disabled={isPolling}
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-400 hover:text-cyan-300 border border-slate-700 transition cursor-pointer"
                            title="Poll Real-Time Optical Signal via SNMP"
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${isPolling ? 'animate-spin' : ''}`} />
                          </button>

                          <button
                            onClick={() => handleShareOpticalReportWhatsApp(onu)}
                            className="p-1.5 rounded-lg bg-emerald-950 hover:bg-emerald-900 text-emerald-400 border border-emerald-800 transition cursor-pointer"
                            title="Share Optical Signal Health Report via WhatsApp"
                          >
                            <Send className="w-3.5 h-3.5" />
                          </button>

                          <button
                            onClick={() => handleRebootOnu(onu)}
                            disabled={isRebooting}
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition cursor-pointer"
                            title="Remote OMCI Reboot ONT"
                          >
                            <Power className={`w-3.5 h-3.5 ${isRebooting ? 'text-amber-400 animate-pulse' : ''}`} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit OLT Hardware Modal */}
      <AddEditOltModal
        isOpen={isAddModalOpen}
        onClose={() => {
          setIsAddModalOpen(false);
          setOltToEdit(null);
        }}
        oltToEdit={oltToEdit}
      />

      {/* Fleet Management Drawer/Modal */}
      <OltFleetManagerModal
        isOpen={isFleetManagerOpen}
        onClose={() => setIsFleetManagerOpen(false)}
        onAddNew={() => {
          setOltToEdit(null);
          setIsAddModalOpen(true);
        }}
        onEditOlt={(olt) => {
          setOltToEdit(olt);
          setIsAddModalOpen(true);
        }}
      />
    </div>
  );
};
