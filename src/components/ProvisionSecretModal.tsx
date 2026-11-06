import React, { useState, useEffect, useMemo } from 'react';
import { X, Server, CheckCircle2, ShieldCheck, Zap, Calendar, Clock, DollarSign } from 'lucide-react';
import { useISP } from '../context/ISPContext';
import { storageService, BandwidthProfile } from '../services/storageService';
import { formatRouterOSSchedule, calculateRemainingTime } from '../services/mikrotikSubscriberSync';

interface ProvisionSecretModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export type ValidityPreset = '2_hours' | '1_day' | '3_days' | '7_days' | '1_month' | 'custom';

export const ProvisionSecretModal: React.FC<ProvisionSecretModalProps> = ({ isOpen, onClose }) => {
  const {
    packages,
    routers,
    selectedRouterId,
    provisionPppoeSecret,
    dynamicPppProfiles,
    bandwidthProfiles: contextProfiles,
    agents,
  } = useISP();

  const [storedProfiles, setStoredProfiles] = useState<BandwidthProfile[]>(() =>
    storageService.getBandwidthProfiles()
  );

  useEffect(() => {
    const handleUpdate = () => {
      setStoredProfiles(storageService.getBandwidthProfiles());
    };
    window.addEventListener('youthnet_storage_updated', handleUpdate);
    return () => window.removeEventListener('youthnet_storage_updated', handleUpdate);
  }, []);

  const availableProfiles = useMemo(() => {
    if (storedProfiles.length > 0) return storedProfiles;
    if (contextProfiles && contextProfiles.length > 0) return contextProfiles;
    if (dynamicPppProfiles && dynamicPppProfiles.length > 0) return dynamicPppProfiles;
    return [];
  }, [storedProfiles, contextProfiles, dynamicPppProfiles]);

  const defaultProfileName =
    availableProfiles.find((p) => p.name === '20M_Ultra' || p.name === '10M_Standard' || p.name === 'default')?.name ||
    availableProfiles[0]?.name ||
    'default';

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('+92 ');
  const [address, setAddress] = useState('');
  const [areaNode, setAreaNode] = useState('Sector G-11 (North Zone)');
  const [pppoeUsername, setPppoeUsername] = useState('');
  const [pppoePassword, setPppoePassword] = useState('fiber1234');
  const [packageId, setPackageId] = useState(defaultProfileName);
  const [assignedAgentId, setAssignedAgentId] = useState(agents[0]?.id || '');
  const [ponPort, setPonPort] = useState('PON-01');
  const [cnic, setCnic] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Package Validity section states
  const [validityPreset, setValidityPreset] = useState<ValidityPreset>('1_month');
  const [customDateTime, setCustomDateTime] = useState<string>(() => {
    const d = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
  });

  // Calculate target expiration Date object based on preset or custom date
  const targetExpiryDate = useMemo(() => {
    const now = new Date();
    switch (validityPreset) {
      case '2_hours':
        return new Date(now.getTime() + 2 * 60 * 60 * 1000);
      case '1_day':
        return new Date(now.getTime() + 24 * 60 * 60 * 1000);
      case '3_days':
        return new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
      case '7_days':
        return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      case '1_month':
        return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      case 'custom': {
        const parsed = new Date(customDateTime);
        return isNaN(parsed.getTime()) ? new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000) : parsed;
      }
      default:
        return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    }
  }, [validityPreset, customDateTime]);

  // Formatted schedule info for display badge
  const scheduleMeta = useMemo(() => {
    const formatted = formatRouterOSSchedule(targetExpiryDate);
    const timeRemaining = calculateRemainingTime(targetExpiryDate);
    return {
      readable: formatted.readable,
      startDate: formatted.startDate,
      startTime: formatted.startTime,
      remainingText: timeRemaining.remainingText,
      badgeClass: timeRemaining.badgeClass,
    };
  }, [targetExpiryDate]);

  // Dynamic price calculation
  const selectedProfilePrice = useMemo(() => {
    const matched = storageService.getProfileByName(packageId);
    if (matched && matched.pricePkr !== undefined) return matched.pricePkr;
    const pkg = packages.find((p) => p.mikrotikProfile === packageId || p.id === packageId);
    return pkg?.priceMonthly || 2000;
  }, [packageId, packages]);

  useEffect(() => {
    if (availableProfiles.length > 0 && (!packageId || packageId === 'default')) {
      setPackageId(defaultProfileName);
    }
  }, [availableProfiles, defaultProfileName]);

  useEffect(() => {
    if (agents.length > 0 && !assignedAgentId) {
      setAssignedAgentId(agents[0].id);
    }
  }, [agents, assignedAgentId]);

  if (!isOpen) return null;

  const currentRouter = routers.find((r) => r.id === selectedRouterId) || routers[0];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !pppoeUsername) return;

    setIsSubmitting(true);
    const selectedAgent = agents.find((a) => a.id === assignedAgentId) || agents[0];

    // Compute validity in fractional days or hours
    const now = new Date();
    const diffHours = Math.max(1, Math.round((targetExpiryDate.getTime() - now.getTime()) / (1000 * 60 * 60)));
    const diffDays = Math.max(1, Math.round(diffHours / 24));

    await provisionPppoeSecret({
      name,
      phone,
      address,
      areaNode,
      pppoeUsername,
      pppoePassword,
      packageId,
      assignedIp: `10.50.${Math.floor(Math.random() * 40 + 10)}.${Math.floor(Math.random() * 240 + 10)}`,
      macAddress: `00:1E:67:${Math.floor(10 + Math.random() * 89)}:${Math.floor(10 + Math.random() * 89)}:${Math.floor(10 + Math.random() * 89)}`,
      ...({
        cnic,
        ponPort,
        assignedAgentId: selectedAgent?.id,
        assignedAgentName: selectedAgent?.name,
        validityDays: diffDays,
        validityPreset,
        targetExpiryDate: targetExpiryDate.toISOString(),
        priceMonthly: selectedProfilePrice,
      } as any),
    });

    setIsSubmitting(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-xl w-full overflow-hidden shadow-2xl my-8">
        {/* Header */}
        <div className="bg-slate-950 p-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-cyan-950 border border-cyan-800 text-cyan-400 rounded-lg">
              <Server className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">
                Single-Click Provision Subscriber
              </h3>
              <p className="text-xs text-slate-400 font-mono">
                BRAS: {currentRouter?.name || 'Default Router'} ({currentRouter?.ipAddress || 'Offline'})
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded-lg">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          {/* Identity & Contact */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 mb-1 font-medium">Subscriber Full Name</label>
              <input
                type="text"
                required
                placeholder="e.g. Asad Ullah Khan"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!pppoeUsername) {
                    setPppoeUsername(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '_'));
                  }
                }}
                className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2.5 rounded-lg focus:outline-none focus:border-cyan-500 font-medium"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1 font-medium">Mobile / WhatsApp Number</label>
              <input
                type="text"
                required
                placeholder="+92 300 1234567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2.5 rounded-lg focus:outline-none focus:border-cyan-500 font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-slate-400 mb-1 font-medium">Installation Address</label>
            <input
              type="text"
              required
              placeholder="e.g. House 14, Street 9, Sector G-11/3"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2.5 rounded-lg focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 mb-1 font-medium">Area Node</label>
              <select
                value={areaNode}
                onChange={(e) => setAreaNode(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2.5 rounded-lg focus:outline-none focus:border-cyan-500"
              >
                <option value="Sector G-11 (North Zone)">Sector G-11 (North Zone)</option>
                <option value="Sector F-10 (Commercial Zone)">Sector F-10 (Commercial Zone)</option>
                <option value="Sector I-8 (East Zone)">Sector I-8 (East Zone)</option>
                <option value="Blue Area (Main Business Hub)">Blue Area (Main Business Hub)</option>
                <option value="Sector F-11 (West Zone)">Sector F-11 (West Zone)</option>
                <option value="Sector G-10 (South Zone)">Sector G-10 (South Zone)</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-400 mb-1 font-medium">OLT PON Port</label>
              <select
                value={ponPort}
                onChange={(e) => setPonPort(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-cyan-300 font-mono p-2.5 rounded-lg focus:outline-none focus:border-cyan-500"
              >
                <option value="PON-01">PON-01 (Feeder 1-16)</option>
                <option value="PON-02">PON-02 (Feeder 17-32)</option>
                <option value="PON-03">PON-03 (Feeder 33-48)</option>
                <option value="PON-04">PON-04 (Feeder 49-64)</option>
                <option value="PON-05">PON-05 (North Splitter)</option>
                <option value="PON-06">PON-06 (Commercial Hub)</option>
              </select>
            </div>
          </div>

          {/* Profile & Dynamic Price Card */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 mb-1 font-medium">Bandwidth Profile</label>
              <select
                value={packageId}
                onChange={(e) => setPackageId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2.5 rounded-lg focus:outline-none focus:border-cyan-500 font-mono"
              >
                {availableProfiles.length > 0 ? (
                  availableProfiles.map((p: any) => (
                    <option key={p.id || p.name} value={p.name}>
                      {p.name} {p.rateLimit || p['rate-limit'] ? `(${p.rateLimit || p['rate-limit']})` : ''}
                      {p.pricePkr ? ` · Rs. ${p.pricePkr.toLocaleString()}` : ''}
                    </option>
                  ))
                ) : (
                  packages.map((pkg) => (
                    <option key={pkg.id} value={pkg.mikrotikProfile || pkg.name}>
                      {pkg.name} ({pkg.downloadSpeedMbps}M/{pkg.uploadSpeedMbps}M)
                    </option>
                  ))
                )}
              </select>
            </div>

            <div>
              <label className="block text-slate-400 mb-1 font-medium">Assigned Field Agent</label>
              <select
                value={assignedAgentId}
                onChange={(e) => setAssignedAgentId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2.5 rounded-lg focus:outline-none focus:border-cyan-500"
              >
                {agents.map((ag) => (
                  <option key={ag.id} value={ag.id}>
                    {ag.name} ({ag.assignedArea})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* PACKAGE VALIDITY SECTION (RouterOS Scheduler & Expiration) */}
          <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-200 flex items-center gap-1.5 text-xs">
                <Clock className="w-4 h-4 text-cyan-400" />
                Package Validity &amp; On-Router Auto-Expiration
              </span>
              <span className="text-[11px] font-mono text-cyan-400">
                Monthly Rate: Rs. {selectedProfilePrice.toLocaleString()}
              </span>
            </div>

            {/* Validity Presets */}
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
              {[
                { id: '2_hours', label: '2 Hours' },
                { id: '1_day', label: '1 Day' },
                { id: '3_days', label: '3 Days' },
                { id: '7_days', label: '7 Days' },
                { id: '1_month', label: '1 Month' },
                { id: 'custom', label: 'Custom' },
              ].map((opt) => (
                <button
                  type="button"
                  key={opt.id}
                  onClick={() => setValidityPreset(opt.id as ValidityPreset)}
                  className={`py-1.5 px-2 rounded-lg font-mono text-[11px] transition text-center cursor-pointer ${
                    validityPreset === opt.id
                      ? 'bg-cyan-600 text-slate-950 font-bold shadow'
                      : 'bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-800'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Custom Date & Time Picker */}
            {validityPreset === 'custom' && (
              <div className="pt-2 border-t border-slate-800/80">
                <label className="block text-slate-400 mb-1 text-[11px]">Pick Exact Expiry Date &amp; Time</label>
                <input
                  type="datetime-local"
                  required
                  value={customDateTime}
                  onChange={(e) => setCustomDateTime(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 text-slate-100 p-2 rounded-lg focus:outline-none focus:border-cyan-500 font-mono text-xs"
                />
              </div>
            )}

            {/* Live Expiration Preview Badge */}
            <div className="flex items-center justify-between bg-slate-900/90 p-2.5 rounded-lg border border-slate-800 font-mono text-[11px]">
              <div className="text-slate-300 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                <span>Expires on: <strong className="text-cyan-300">{scheduleMeta.readable}</strong></span>
              </div>
              <span className={`px-2 py-0.5 rounded text-[10px] ${scheduleMeta.badgeClass}`}>
                {scheduleMeta.remainingText}
              </span>
            </div>
          </div>

          {/* RouterOS PPPoE Credentials */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-800">
            <div>
              <label className="block text-slate-400 mb-1 font-mono">PPPoE Username</label>
              <input
                type="text"
                required
                placeholder="user_pppoe"
                value={pppoeUsername}
                onChange={(e) => setPppoeUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                className="w-full bg-slate-950 border border-slate-700 text-cyan-300 font-mono p-2.5 rounded-lg focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1 font-mono">PPPoE Password</label>
              <input
                type="text"
                required
                value={pppoePassword}
                onChange={(e) => setPppoePassword(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-slate-100 font-mono p-2.5 rounded-lg focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          {/* Single-Pipeline Execution Summary */}
          <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 text-[11px] text-slate-400 space-y-1">
            <div className="flex items-center gap-2 text-cyan-300 font-semibold">
              <Zap className="w-4 h-4 text-cyan-400 shrink-0" />
              <span>Automated 5-Step Single-Action Pipeline:</span>
            </div>
            <p className="text-[10px] text-slate-500 leading-relaxed">
              1. Adds PPPoE Secret with metadata on RouterOS · 2. Creates Client Portal user · 3. Generates Invoice #1 anchored to 5th cycle · 4. Schedules RouterOS `/system/scheduler` expiry script · 5. Dispatches welcome WhatsApp.
            </p>
          </div>

          {/* Buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-6 py-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold transition disabled:opacity-50 cursor-pointer shadow-lg shadow-cyan-600/20"
            >
              {isSubmitting ? 'Executing Pipeline...' : 'Provision on MikroTik'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
