import React, { useState, useEffect, useMemo } from 'react';
import { X, Server, CheckCircle2, ShieldCheck, Zap, Calendar, Clock, DollarSign } from 'lucide-react';
import { useISP } from '../context/ISPContext';
import { storageService, BandwidthProfile } from '../services/storageService';
import { formatRouterOSSchedule, calculateRemainingTime } from '../services/mikrotikSubscriberSync';
import { AreaNodeSelector } from './AreaNodeSelector';
import {
  fetchNetworkAreas,
  resolveAreaFromUsername,
  NetworkAreaNode,
  NETWORK_AREAS_UPDATED_EVENT,
} from '../lib/billingAndNetwork';
import { supabase, SupabasePortalUser, SupabaseResellerTariff } from '../services/supabaseClient';
import { createAgentCommission } from '../services/erpInventoryService';
import { addCalendarMonthsYmd, extractYmdString } from '../lib/anniversaryBilling';
import { getStoredUser } from '../lib/auth';
import {
  checkAndDeductResellerWallet,
  getResellerTier,
  isResellerUser,
  resolveTariffForProfile,
} from '../lib/resellerEngine';

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
  const [networkAreas, setNetworkAreas] = useState<NetworkAreaNode[]>([]);
  const [areaNode, setAreaNode] = useState('Baza Mohallah');
  const [pppoeUsername, setPppoeUsername] = useState('');
  const [pppoePassword, setPppoePassword] = useState('fiber1234');
  const [packageId, setPackageId] = useState(defaultProfileName);
  const [assignedAgentId, setAssignedAgentId] = useState(agents[0]?.id || '');
  const [ponPort, setPonPort] = useState('PON-01');
  const [cnic, setCnic] = useState('');
  const [portalAgents, setPortalAgents] = useState<SupabasePortalUser[]>([]);
  const [referredByAgentId, setReferredByAgentId] = useState('');
  const [commissionAmount, setCommissionAmount] = useState('500');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reseller Wallet & Ownership State
  const activeLoggedInUser = useMemo(() => getStoredUser(), [isOpen]);
  const isResellerSession = useMemo(() => isResellerUser(activeLoggedInUser), [activeLoggedInUser]);
  const [resellerOptions, setResellerOptions] = useState<SupabasePortalUser[]>([]);
  const [selectedDealerId, setSelectedDealerId] = useState<string>('');
  const [resellerTariffs, setResellerTariffs] = useState<SupabaseResellerTariff[]>([]);
  const [walletError, setWalletError] = useState<string | null>(null);

  useEffect(() => {
    const loadAreas = () => {
      fetchNetworkAreas().then(setNetworkAreas).catch(() => {});
    };
    loadAreas();
    window.addEventListener(NETWORK_AREAS_UPDATED_EVENT, loadAreas);
    return () => window.removeEventListener(NETWORK_AREAS_UPDATED_EVENT, loadAreas);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    setWalletError(null);
    if (isResellerSession && activeLoggedInUser?.id) {
      setSelectedDealerId(activeLoggedInUser.id);
    }
    supabase
      .from('portal_users')
      .select('id,username,full_name,area,role,tier_level,parent_dealer_id,wallet_balance,credit_limit,max_active_users')
      .order('full_name', { ascending: true })
      .then(({ data }) => {
        if (Array.isArray(data)) {
          const allRows = data as SupabasePortalUser[];
          setPortalAgents(allRows.filter((u) => String(u.role || '').toUpperCase() === 'AGENT'));
          setResellerOptions(allRows.filter((u) => getResellerTier(u) !== null));
        }
      });
    supabase
      .from('reseller_tariffs')
      .select('*')
      .then(({ data }) => {
        if (Array.isArray(data)) setResellerTariffs(data as SupabaseResellerTariff[]);
      });
  }, [isOpen, isResellerSession, activeLoggedInUser?.id]);

  const handlePppoeUsernameChange = (rawVal: string) => {
    const clean = rawVal.toLowerCase().replace(/[^a-z0-9_]/g, '');
    setPppoeUsername(clean);
    const matchedArea = resolveAreaFromUsername(clean, networkAreas);
    if (matchedArea) {
      setAreaNode(matchedArea);
    }
  };

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
      case '1_month': {
        const nowYmd = extractYmdString(now.toISOString()) || new Date().toISOString().slice(0, 10);
        const nextYmd = addCalendarMonthsYmd(nowYmd, 1, now.getDate());
        const d = new Date(`${nextYmd}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`);
        return isNaN(d.getTime()) ? new Date(now.getFullYear(), now.getMonth() + 1, now.getDate()) : d;
      }
      case 'custom': {
        const parsed = new Date(customDateTime);
        if (!isNaN(parsed.getTime())) return parsed;
        return new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
      }
      default:
        return new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
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

  const effectiveDealerId = isResellerSession ? activeLoggedInUser?.id || '' : selectedDealerId;
  const activeResellerRecord = resellerOptions.find((r) => r.id === effectiveDealerId) || null;
  const resolvedResellerTariff = effectiveDealerId
    ? resolveTariffForProfile(effectiveDealerId, packageId, resellerTariffs, selectedProfilePrice)
    : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !pppoeUsername) return;

    setIsSubmitting(true);
    setWalletError(null);

    // Reseller Prepaid Wallet Deduction Guard BEFORE calling MikroTik API
    if (effectiveDealerId) {
      const walletCheck = await checkAndDeductResellerWallet({
        resellerId: effectiveDealerId,
        profileName: packageId,
        subscriberUsername: pppoeUsername,
        txType: 'USER_ACTIVATION',
        performedBy: activeLoggedInUser?.fullName || activeLoggedInUser?.username || 'Reseller',
        fallbackWholesalePrice: selectedProfilePrice,
        notes: `New PPPoE activation for @${pppoeUsername.trim().toLowerCase()} (${packageId})`,
      });

      if (!walletCheck.ok) {
        setWalletError(walletCheck.error || 'Insufficient Dealer Wallet Balance');
        setIsSubmitting(false);
        return;
      }
    }

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
        priceMonthly: resolvedResellerTariff?.retailPrice || selectedProfilePrice,
        dealerId: effectiveDealerId || null,
      } as any),
    });

    // Link subscriber ownership to Dealer / Sub-Dealer in Supabase portal_users & invoices
    const cleanSubUsername = pppoeUsername.trim().toLowerCase();
    if (effectiveDealerId && cleanSubUsername) {
      try {
        await supabase
          .from('portal_users')
          .update({ dealer_id: effectiveDealerId } as any)
          .ilike('username', cleanSubUsername);
        await supabase
          .from('invoices')
          .update({ dealer_id: effectiveDealerId } as any)
          .ilike('subscriber_username', cleanSubUsername);
      } catch {}
    }

    const commAmtNum = Number(commissionAmount) || 0;
    const refAgent = portalAgents.find((a) => a.id === referredByAgentId);
    if (refAgent && commAmtNum > 0) {
      try {
        const { data: subRow } = await supabase
          .from('portal_users')
          .select('id')
          .ilike('username', cleanSubUsername)
          .maybeSingle();

        await createAgentCommission({
          agent_id: refAgent.id,
          agent_name: refAgent.full_name || refAgent.username,
          subscriber_id: subRow?.id || null,
          subscriber_username: cleanSubUsername,
          client_name: name.trim() || cleanSubUsername,
          package_name: packageId,
          commission_amount: commAmtNum,
          notes: `New PPPoE connection referred by ${refAgent.full_name || refAgent.username}`,
        });
      } catch (commErr) {
        console.warn('Could not save agent commission to Supabase:', commErr);
      }
    }

    setIsSubmitting(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 overflow-y-auto animate-fade-in">
      <div className="w-[95vw] sm:w-full max-w-lg sm:max-w-xl max-h-[90vh] overflow-y-auto mx-auto my-auto rounded-2xl box-border bg-slate-900 border border-slate-800 shadow-2xl">
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
          {walletError && (
            <div className="rounded-xl border border-rose-500/50 bg-rose-950/70 px-3.5 py-3 text-rose-200 flex items-start gap-2.5">
              <ShieldCheck className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-rose-100">Insufficient Dealer Wallet Balance</div>
                <div className="text-[11px] mt-0.5 text-rose-200/90">{walletError}</div>
              </div>
            </div>
          )}

          {/* Reseller Ownership & Prepaid Wallet Preview */}
          {(isResellerSession || resellerOptions.length > 0) && (
            <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3.5 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-slate-200">
                  {isResellerSession
                    ? `Reseller Account: ${activeLoggedInUser?.fullName || activeLoggedInUser?.username}`
                    : 'Assign Subscriber to Dealer / Sub-Dealer (Optional)'}
                </span>
                {activeResellerRecord && (
                  <span className="font-mono text-[11px] text-emerald-400 tabular-nums">
                    Wallet: Rs. {Number(activeResellerRecord.wallet_balance || 0).toLocaleString()} · Credit: Rs. {Number(activeResellerRecord.credit_limit || 0).toLocaleString()}
                  </span>
                )}
              </div>

              {!isResellerSession && (
                <select
                  value={selectedDealerId}
                  onChange={(e) => {
                    setSelectedDealerId(e.target.value);
                    setWalletError(null);
                  }}
                  className="w-full bg-slate-900 border border-slate-700 text-slate-100 p-2 rounded-lg focus:outline-none focus:border-cyan-500"
                >
                  <option value="">Direct Master ISP Subscriber (No Wallet Deduction)</option>
                  {resellerOptions.map((r) => (
                    <option key={r.id} value={r.id}>
                      [{getResellerTier(r) === 'DEALER' ? 'Dealer' : 'Sub-Dealer'}] {r.full_name} (@{r.username}) — Wallet Rs. {Number(r.wallet_balance || 0).toLocaleString()}
                    </option>
                  ))}
                </select>
              )}

              {effectiveDealerId && resolvedResellerTariff && (
                <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 pt-1 border-t border-slate-800">
                  <span>Wholesale Deduction ({packageId}):</span>
                  <span className="text-amber-300 font-semibold">
                    Rs. {resolvedResellerTariff.wholesalePrice.toLocaleString()}
                  </span>
                </div>
              )}
            </div>
          )}

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
            <AreaNodeSelector
              label="Area / Child Node"
              value={areaNode}
              onChange={setAreaNode}
              areas={networkAreas}
              onAreasUpdated={setNetworkAreas}
              compact
            />

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

          {/* Field Agent New-Connection Commission Tracker */}
          <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-200 flex items-center gap-1.5 text-xs">
                <DollarSign className="w-4 h-4 text-emerald-400" />
                <span>Agent New-Connection Commission (Optional)</span>
              </span>
              <span className="text-[10px] font-mono text-slate-400">
                Saved as UNPAID in Supabase
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-400 mb-1 font-medium">
                  Connection Referred / Brought By Agent
                </label>
                <select
                  value={referredByAgentId}
                  onChange={(e) => setReferredByAgentId(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 text-slate-100 p-2.5 rounded-lg focus:outline-none focus:border-cyan-500"
                >
                  <option value="">None / Direct Walk-in</option>
                  {portalAgents.map((ag) => (
                    <option key={ag.id} value={ag.id}>
                      {ag.full_name} (@{ag.username}) · {ag.area || 'Field'}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-slate-400 mb-1 font-medium">
                  Commission Amount (Rs.)
                </label>
                <input
                  type="number"
                  min="0"
                  step="50"
                  disabled={!referredByAgentId}
                  placeholder="e.g. 500"
                  value={commissionAmount}
                  onChange={(e) => setCommissionAmount(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 text-emerald-300 font-mono tabular-nums p-2.5 rounded-lg focus:outline-none focus:border-cyan-500 disabled:opacity-40"
                />
              </div>
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
                placeholder="e.g. bz_ahmed, dgi_sana"
                value={pppoeUsername}
                onChange={(e) => handlePppoeUsernameChange(e.target.value)}
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
              1. Adds PPPoE Secret with metadata on RouterOS · 2. Creates Client Portal user · 3. Generates Invoice #1 anchored to monthly anniversary cycle · 4. Schedules RouterOS `/system/scheduler` expiry script · 5. Dispatches welcome WhatsApp.
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
