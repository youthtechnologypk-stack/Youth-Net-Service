import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  X,
  UserPlus,
  Shield,
  Smartphone,
  Key,
  RefreshCw,
  Eye,
  EyeOff,
  Users,
  AlertCircle,
  Link as LinkIcon,
  Briefcase,
  Send,
  Radio,
  Search,
  UserCheck,
  Wifi,
  MapPin,
} from 'lucide-react';
import { UserAccount, SystemRole } from '../types/auth';
import { useISP } from '../context/ISPContext';
import { generateRandomPassword } from '../services/authUtils';
import { saveUnifiedPortalUser } from '../lib/userRepository';
import { getStoredUser } from '../lib/auth';
import {
  RealMikrotikSubscriber,
  fetchLiveMikrotikSubscribers,
  getCachedSubscribers,
} from '../services/mikrotikSubscriberSync';
import { supabase } from '../services/supabaseClient';
import { AreaNodeSelector } from './AreaNodeSelector';
import {
  fetchNetworkAreas,
  resolveAreaFromUsername,
  NetworkAreaNode,
  NETWORK_AREAS_UPDATED_EVENT,
} from '../lib/billingAndNetwork';
import {
  ADMIN_FULL_PERMISSIONS,
  CLIENT_NO_PERMISSIONS,
  StaffPermissions,
  getDefaultPermissionsForRole,
  isMissingPermissionsColumnError,
  updatePortalUserPermissions,
} from '../lib/staffPermissions';
import { StaffPermissionsEditor } from './StaffPermissionsEditor';

export interface CreateAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (newUser: UserAccount, plainPassword: string, sendWhatsApp: boolean) => void;
  subscribers?: RealMikrotikSubscriber[];
}

export const CreateAccountModal: React.FC<CreateAccountModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  subscribers: propSubscribers,
}) => {
  const { routers, selectedRouterId, agents } = useISP();

  const [role, setRole] = useState<SystemRole>('CLIENT');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('+92 ');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState(() => generateRandomPassword());
  const [showPassword, setShowPassword] = useState(false);

  // Live real MikroTik PPPoE subscribers state
  const [liveSubscribers, setLiveSubscribers] = useState<RealMikrotikSubscriber[]>(() => {
    if (propSubscribers && propSubscribers.length > 0) return propSubscribers;
    return getCachedSubscribers();
  });
  const [isLoadingSubscribers, setIsLoadingSubscribers] = useState(false);
  const [selectedSubscriber, setSelectedSubscriber] = useState<RealMikrotikSubscriber | null>(null);

  // Client specific fields
  const [linkedCustomerId, setLinkedCustomerId] = useState('');
  const [grantClientPortal, setGrantClientPortal] = useState(true);
  const [subscriberSearchQuery, setSubscriberSearchQuery] = useState('');
  const [isSubscriberSearchOpen, setIsSubscriberSearchOpen] = useState(false);

  // Agent & Area specific fields
  const [networkAreas, setNetworkAreas] = useState<NetworkAreaNode[]>([]);
  const [assignedArea, setAssignedArea] = useState('Baza Mohallah');
  const [cashLimit, setCashLimit] = useState<number>(50000);
  const [linkedAgentId, setLinkedAgentId] = useState('');

  useEffect(() => {
    const loadAreas = () => {
      fetchNetworkAreas().then(setNetworkAreas).catch(() => {});
    };
    loadAreas();
    window.addEventListener(NETWORK_AREAS_UPDATED_EVENT, loadAreas);
    return () => window.removeEventListener(NETWORK_AREAS_UPDATED_EVENT, loadAreas);
  }, [isOpen]);

  const handleUsernameUpdate = (rawVal: string) => {
    const clean = rawVal.toLowerCase().replace(/\s+/g, '_');
    setUsername(clean);
    const matched = resolveAreaFromUsername(clean, networkAreas);
    if (matched) {
      setAssignedArea(matched);
    }
  };

  // Manager specific fields
  const [department, setDepartment] = useState('NOC & Network Operations');
  const [operationalPermissions, setOperationalPermissions] = useState('Full NOC Operations & SLA Oversight');
  const [staffPermissions, setStaffPermissions] = useState<StaffPermissions>(() =>
    getDefaultPermissionsForRole('AGENT')
  );

  useEffect(() => {
    if (role === 'MANAGER' || role === 'AGENT') {
      setStaffPermissions(getDefaultPermissionsForRole(role));
    }
  }, [role]);

  // WhatsApp checkbox
  const [sendWhatsApp, setSendWhatsApp] = useState(true);

  // Submission state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const currentRouter = useMemo(
    () => routers.find((r) => r.id === selectedRouterId) || routers[0],
    [routers, selectedRouterId]
  );

  // Update live subscribers from props or fetch directly from MikroTik REST API
  useEffect(() => {
    if (!isOpen) {
      setErrorMessage(null);
      setSubscriberSearchQuery('');
      setIsSubscriberSearchOpen(false);
      return;
    }

    setPassword(generateRandomPassword());
    setErrorMessage(null);

    if (propSubscribers && propSubscribers.length > 0) {
      setLiveSubscribers(propSubscribers);
    }

    // Always fetch fresh real MikroTik subscribers from /api/mikrotik/ppp/active & /api/mikrotik/ppp/secret
    setIsLoadingSubscribers(true);
    fetchLiveMikrotikSubscribers(currentRouter)
      .then((subs) => {
        if (subs && subs.length > 0) {
          setLiveSubscribers(subs);
        }
      })
      .catch((err) => {
        console.warn('Live subscriber fetch notice:', err);
      })
      .finally(() => {
        setIsLoadingSubscribers(false);
      });
  }, [isOpen, propSubscribers, currentRouter]);

  // Filtered subscribers for dynamic search
  const filteredSubscribers = useMemo(() => {
    const q = subscriberSearchQuery.trim().toLowerCase();
    if (!q) {
      return liveSubscribers.slice(0, 40);
    }
    return liveSubscribers
      .filter((sub) => {
        const matchUname = (sub.username || '').toLowerCase().includes(q);
        const matchIp = (sub.address || '').toLowerCase().includes(q);
        const matchMac = (sub.callerId || '').toLowerCase().includes(q);
        const matchProf = (sub.profile || '').toLowerCase().includes(q);
        const matchName = (sub.fullName || '').toLowerCase().includes(q);
        const matchPhone = (sub.phone || '').toLowerCase().includes(q);
        const matchComment = (sub.comment || '').toLowerCase().includes(q);
        return matchUname || matchIp || matchMac || matchProf || matchName || matchPhone || matchComment;
      })
      .slice(0, 50);
  }, [liveSubscribers, subscriberSearchQuery]);

  // Requirement 3: Auto-fill Upon Selection
  const handleSelectSubscriber = (sub: RealMikrotikSubscriber) => {
    setSelectedSubscriber(sub);
    setLinkedCustomerId(sub.username);
    setIsSubscriberSearchOpen(false);
    setSubscriberSearchQuery('');

    // 1. Auto-fill the "Portal Login Username" field with their PPPoE username
    setUsername(sub.username.toLowerCase().replace(/\s+/g, '_'));

    // 2. Auto-fill phone number / comment if present in the MikroTik secret comment
    if (sub.phone && sub.phone !== '+92 ') {
      setPhone(sub.phone);
    }

    // 3. Auto-fill subscriber full name
    if (sub.fullName) {
      setFullName(sub.fullName);
    } else {
      setFullName(sub.username);
    }
  };

  const handleClearSelectedCustomer = () => {
    setSelectedSubscriber(null);
    setLinkedCustomerId('');
    setSubscriberSearchQuery('');
  };

  // Agent selector helper
  const handleSelectAgent = (agentId: string) => {
    setLinkedAgentId(agentId);
    const targetAgent = agents.find((a) => a.id === agentId);
    if (targetAgent) {
      if (!fullName) setFullName(targetAgent.name);
      if (!phone || phone === '+92 ') setPhone(targetAgent.phone);
      if (!username) {
        setUsername(targetAgent.name.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 15));
      }
      if (targetAgent.assignedArea) setAssignedArea(targetAgent.assignedArea);
    }
  };

  if (!isOpen) return null;

  // Requirement 4: Form Submission & localStorage (youthnet_portal_users)
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim() || !username.trim() || !password.trim()) {
      setErrorMessage('Full Name, Username, and Password are required.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    const cleanUsername = username.trim().toLowerCase();
    const cleanPhone = phone.trim() || '+92 300 0000000';
    const plainPass = password.trim();

    const newUser: UserAccount = {
      id: `usr-${cleanUsername}-${Date.now().toString().slice(-4)}`,
      username: cleanUsername,
      fullName: fullName.trim(),
      displayName: fullName.trim(),
      email: `${cleanUsername}@youthnet.pk`,
      role,
      phone: cleanPhone,
      isActive: true,
      mustChangePassword: false,
      linkedCustomerId: role === 'CLIENT' ? (selectedSubscriber?.username || linkedCustomerId || cleanUsername) : undefined,
      linkedAgentId: role === 'AGENT' ? (linkedAgentId || undefined) : undefined,
      assignedArea: role === 'AGENT' ? assignedArea : undefined,
      department: role === 'MANAGER' ? department : undefined,
      cashLimit: role === 'AGENT' ? Number(cashLimit) : undefined,
      grantClientPortal: role === 'CLIENT' ? grantClientPortal : undefined,
      sendWhatsAppNotice: sendWhatsApp,
      can_access_gis_map:
        role === 'ADMIN' ? true : role === 'CLIENT' ? false : staffPermissions.gis_map !== 'none',
      gis_map_permission:
        role === 'ADMIN' ? 'edit' : role === 'CLIENT' ? 'none' : staffPermissions.gis_map,
      permissions:
        role === 'ADMIN'
          ? { ...ADMIN_FULL_PERMISSIONS }
          : role === 'CLIENT'
          ? { ...CLIENT_NO_PERMISSIONS }
          : { ...staffPermissions },
      createdAt: new Date().toISOString(),
    };

    // 1. Save the created portal user into standardized USERS_STORAGE_KEY (youthnet_portal_users)
    try {
      saveUnifiedPortalUser({
        username: cleanUsername,
        password: plainPass,
        role,
        fullName: fullName.trim(),
        phone: cleanPhone,
        area: assignedArea || 'Sector G-11',
        linkedCustomerId: selectedSubscriber?.username || cleanUsername,
        linkedAgentId: role === 'AGENT' ? linkedAgentId : undefined,
        department: role === 'MANAGER' ? department : undefined,
      });
    } catch (storageErr) {
      console.warn('Failed saving to youthnet_portal_users:', storageErr);
    }

    // 2. Persist directly to Supabase PostgreSQL portal_users table
    try {
      const effectivePerms: StaffPermissions =
        role === 'ADMIN'
          ? { ...ADMIN_FULL_PERMISSIONS }
          : role === 'CLIENT'
          ? { ...CLIENT_NO_PERMISSIONS }
          : { ...staffPermissions };
      const creator = getStoredUser();
      const creatorTier = String(creator?.tier_level || creator?.role || '').toUpperCase();
      const creatorDealerId =
        creatorTier === 'DEALER'
          ? String(creator?.id || '')
          : creatorTier === 'SUB_DEALER'
          ? String(creator?.parent_dealer_id || '') || null
          : null;
      const creatorSubDealerId =
        creatorTier === 'SUB_DEALER' ? String(creator?.id || '') : null;

      const newUserPayload: Record<string, any> = {
        username: cleanUsername,
        password: plainPass,
        role,
        full_name: fullName.trim(),
        phone: cleanPhone,
        area: assignedArea || 'Sector G-11',
        base_salary: 0,
        cash_in_hand: 0,
        can_access_gis_map: effectivePerms.gis_map !== 'none',
        gis_map_permission: effectivePerms.gis_map,
        permissions: effectivePerms,
        ...(creatorDealerId ? { dealer_id: creatorDealerId } : {}),
        ...(creatorSubDealerId ? { sub_dealer_id: creatorSubDealerId } : {}),
        ...(creator?.id ? { created_by_id: String(creator.id) } : {}),
        created_at: new Date().toISOString(),
      };
      const { error: insertErr } = await supabase.from('portal_users').insert([newUserPayload]);
      if (insertErr && isMissingPermissionsColumnError(insertErr)) {
        const {
          can_access_gis_map: _c,
          gis_map_permission: _p,
          permissions: _perms,
          ...legacyPayload
        } = newUserPayload;
        await supabase.from('portal_users').insert([legacyPayload]);
        await updatePortalUserPermissions({
          userId: newUser.id,
          username: cleanUsername,
          permissions: effectivePerms,
        });
      }
    } catch (sbErr) {
      console.warn('Failed inserting to Supabase portal_users:', sbErr);
    }

    // 3. Persist to server backend API
    try {
      await fetch('/api/auth/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: cleanUsername,
          fullName: fullName.trim(),
          phone: cleanPhone,
          role,
          password: plainPass,
          isActive: true,
        }),
      }).catch(() => {});
    } catch {}

    setIsSubmitting(false);

    // Close modal immediately and hand off to parent for zero-click background Baileys WhatsApp dispatch & non-blocking toast
    onSuccess(newUser, plainPass, sendWhatsApp);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 overflow-y-auto animate-fade-in font-sans">
      <div className={`w-[95vw] sm:w-full ${role === 'MANAGER' || role === 'AGENT' ? 'max-w-2xl' : 'max-w-lg sm:max-w-xl'} max-h-[92vh] overflow-y-auto mx-auto my-auto rounded-2xl box-border bg-slate-900 border border-slate-800 shadow-2xl shadow-cyan-950/40 flex flex-col`}>
        {/* Modal Header */}
        <div className="bg-slate-950/90 border-b border-slate-800 p-5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-gradient-to-tr from-cyan-600 to-blue-600 text-slate-950 font-bold rounded-xl shadow-md shadow-cyan-950/40">
              <UserPlus className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white tracking-tight">
                Create New Portal Account
              </h3>
              <p className="text-xs text-slate-400 font-mono mt-0.5">
                Real MikroTik PPPoE Linkage &bull; {liveSubscribers.length} Live Subscribers Loaded
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Form Scrollable Body */}
        <div className="p-6 space-y-5 overflow-y-auto text-xs flex-1">
          {errorMessage && (
            <div className="p-3 bg-rose-950/80 border border-rose-800 rounded-xl text-rose-300 flex items-center gap-2 font-mono">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{errorMessage}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* 1. Role Selection */}
            <div className="space-y-1.5">
              <label className="text-slate-300 font-bold flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-cyan-400" />
                <span>Role Selection *</span>
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'CLIENT', label: 'Client / Subscriber', desc: 'Self-Service Speed & Bills' },
                  { id: 'AGENT', label: 'Field Agent', desc: 'Cash & Field SLA Tickets' },
                  { id: 'MANAGER', label: 'Operations Manager', desc: 'NOC & Team Dispatch' },
                ].map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setRole(r.id as SystemRole)}
                    className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                      role === r.id
                        ? 'bg-slate-800/90 border-cyan-500 text-white shadow-md shadow-cyan-950/40 ring-1 ring-cyan-500'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                    }`}
                  >
                    <span className={`block font-bold text-xs ${role === r.id ? 'text-cyan-400' : 'text-slate-200'}`}>
                      {r.label}
                    </span>
                    <span className="block text-[10px] text-slate-400 mt-1 leading-tight">{r.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Requirement 1 & 2: Subscriber Profile Linkage (Real MikroTik Data) */}
            {role === 'CLIENT' && (
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3.5">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 text-emerald-400 font-bold">
                    <LinkIcon className="w-3.5 h-3.5" />
                    <span>Subscriber Profile Linkage (MikroTik RouterOS)</span>
                  </div>
                  <div className="flex items-center gap-1 text-[10px] font-mono text-cyan-400">
                    {isLoadingSubscribers ? (
                      <span className="flex items-center gap-1 text-amber-400">
                        <RefreshCw className="w-3 h-3 animate-spin" />
                        <span>Syncing MikroTik...</span>
                      </span>
                    ) : (
                      <span>{liveSubscribers.length} real subscribers</span>
                    )}
                  </div>
                </div>

                <div className="relative">
                  <label className="text-slate-300 font-medium block mb-1 text-xs">
                    Link to Real MikroTik PPPoE Account
                  </label>

                  {selectedSubscriber ? (
                    // Selected Subscriber Card Badge
                    <div className="p-3 bg-emerald-950/40 border border-emerald-500/50 rounded-xl space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold">
                            <UserCheck className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-white text-xs">
                                @{selectedSubscriber.username}
                              </span>
                              {selectedSubscriber.address && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-900 text-emerald-300 border border-slate-700">
                                  {selectedSubscriber.address}
                                </span>
                              )}
                              <span className={`px-1.5 py-0.2 rounded text-[9px] font-semibold ${
                                selectedSubscriber.isActiveNow
                                  ? 'bg-emerald-900/80 text-emerald-200 border border-emerald-600'
                                  : 'bg-slate-800 text-slate-400'
                              }`}>
                                {selectedSubscriber.isActiveNow ? 'ACTIVE NOW' : 'REGISTERED'}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-400 flex items-center gap-2 mt-0.5 flex-wrap">
                              {selectedSubscriber.fullName && selectedSubscriber.fullName !== selectedSubscriber.username && (
                                <span className="text-slate-300">{selectedSubscriber.fullName} &bull;</span>
                              )}
                              {selectedSubscriber.profile && (
                                <span className="text-cyan-400 font-mono text-[10px]">
                                  Profile: {selectedSubscriber.profile}
                                </span>
                              )}
                              {selectedSubscriber.callerId && (
                                <span className="text-slate-400 font-mono text-[10px]">
                                  &bull; MAC: {selectedSubscriber.callerId}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={handleClearSelectedCustomer}
                          className="px-2.5 py-1 text-xs font-semibold text-emerald-300 hover:text-white bg-emerald-900/50 hover:bg-emerald-800/80 border border-emerald-600/50 rounded-lg transition cursor-pointer"
                        >
                          Change
                        </button>
                      </div>
                      {selectedSubscriber.comment && (
                        <div className="text-[10px] text-slate-400 bg-slate-900/60 p-1.5 rounded font-mono border border-slate-800">
                          Router Comment: <span className="text-slate-300">{selectedSubscriber.comment}</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    // Searchable Combobox with Real MikroTik Data
                    <div className="relative">
                      <div className="relative flex items-center">
                        <Search className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none" />
                        <input
                          type="text"
                          value={subscriberSearchQuery}
                          onChange={(e) => {
                            setSubscriberSearchQuery(e.target.value);
                            setIsSubscriberSearchOpen(true);
                          }}
                          onFocus={() => setIsSubscriberSearchOpen(true)}
                          placeholder="Type username, customer name, or phone number to search..."
                          className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-9 pr-9 py-2.5 text-slate-200 text-xs placeholder:text-slate-500 focus:outline-none focus:border-cyan-500 transition font-mono"
                        />
                        {subscriberSearchQuery && (
                          <button
                            type="button"
                            onClick={() => setSubscriberSearchQuery('')}
                            className="absolute right-3 text-slate-400 hover:text-white p-0.5 rounded-full hover:bg-slate-800 transition cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      {/* Requirement 2: Populated Linkage Dropdown with Real Data */}
                      {isSubscriberSearchOpen && (
                        <div className="absolute z-30 left-0 right-0 mt-1 max-h-64 overflow-y-auto bg-slate-900/98 backdrop-blur-md border border-slate-700 rounded-xl shadow-2xl divide-y divide-slate-800/80">
                          {filteredSubscribers.length > 0 ? (
                            filteredSubscribers.map((sub) => (
                              <button
                                key={sub.id || sub.username}
                                type="button"
                                onClick={() => handleSelectSubscriber(sub)}
                                className="w-full text-left px-3.5 py-2.5 hover:bg-slate-800/90 transition flex items-center justify-between group cursor-pointer"
                              >
                                <div className="min-w-0 pr-2 space-y-1">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    {/* Primary Text: Subscriber PPPoE Username */}
                                    <span className="font-mono font-bold text-cyan-400 group-hover:text-cyan-300 text-xs">
                                      @{sub.username}
                                    </span>
                                    {/* Secondary Badge: Assigned IP */}
                                    {sub.address && (
                                      <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-950 text-emerald-300 border border-slate-800">
                                        {sub.address}
                                      </span>
                                    )}
                                    {/* Live Status indicator */}
                                    <span className={`px-1.5 py-0.2 rounded text-[9px] font-semibold ${
                                      sub.isActiveNow
                                        ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                                        : 'bg-slate-800 text-slate-400'
                                    }`}>
                                      {sub.isActiveNow ? 'ACTIVE' : 'OFFLINE'}
                                    </span>
                                    {/* Profile */}
                                    {sub.profile && (
                                      <span className="text-[10px] text-cyan-300 font-mono bg-cyan-950/70 border border-cyan-800/60 px-1.5 py-0.5 rounded">
                                        {sub.profile}
                                      </span>
                                    )}
                                  </div>

                                  <div className="text-[11px] text-slate-400 flex items-center gap-2 flex-wrap">
                                    {sub.fullName && sub.fullName !== sub.username && (
                                      <span className="text-slate-200 font-medium">{sub.fullName} &bull;</span>
                                    )}
                                    {/* Caller ID / MAC */}
                                    {sub.callerId && (
                                      <span className="font-mono text-slate-400 text-[10px]">
                                        MAC: {sub.callerId}
                                      </span>
                                    )}
                                    {sub.phone && sub.phone !== '+92 ' && (
                                      <>
                                        <span className="text-slate-600">&bull;</span>
                                        <span className="text-slate-300 font-mono text-[10px]">{sub.phone}</span>
                                      </>
                                    )}
                                    {sub.comment && sub.comment !== 'YouthNet-App' && (
                                      <>
                                        <span className="text-slate-600">&bull;</span>
                                        <span className="text-slate-500 text-[10px] truncate max-w-xs">{sub.comment}</span>
                                      </>
                                    )}
                                  </div>
                                </div>

                                <span className="text-[10px] font-semibold text-emerald-400 opacity-0 group-hover:opacity-100 transition whitespace-nowrap pl-2">
                                  Select &rarr;
                                </span>
                              </button>
                            ))
                          ) : (
                            <div className="px-4 py-3 text-center text-xs text-slate-400">
                              {isLoadingSubscribers ? (
                                <span className="flex items-center justify-center gap-2 text-cyan-400">
                                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                  <span>Querying MikroTik RouterOS...</span>
                                </span>
                              ) : (
                                <span>{subscriberSearchQuery ? `No subscribers found matching "${subscriberSearchQuery}"` : 'No subscribers found'}</span>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  <p className="text-[11px] text-slate-400 mt-1">
                    Selecting a subscriber automatically auto-fills their portal login username and phone number.
                  </p>
                </div>

                {/* Toggle: Grant Client Self-Service Portal Access */}
                <div className="flex items-center justify-between pt-2 border-t border-slate-800/80">
                  <div>
                    <span className="font-bold text-white block text-xs">
                      Grant Client Self-Service Portal Access
                    </span>
                    <span className="text-[11px] text-slate-400 block">
                      Allows subscriber to login, run line tests, view invoices, and submit complaints.
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setGrantClientPortal((prev) => !prev)}
                    className={`w-11 h-6 flex items-center rounded-full p-1 transition cursor-pointer ${
                      grantClientPortal ? 'bg-emerald-600 justify-end' : 'bg-slate-800 justify-start'
                    }`}
                  >
                    <span className="w-4 h-4 rounded-full bg-white shadow-md transform transition" />
                  </button>
                </div>

                <AreaNodeSelector
                  label="Subscriber Coverage Area / Child Node"
                  value={assignedArea}
                  onChange={setAssignedArea}
                  areas={networkAreas}
                  onAreasUpdated={setNetworkAreas}
                  compact
                />
              </div>
            )}

            {/* B. If Field Agent */}
            {role === 'AGENT' && (
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3.5">
                <div className="flex items-center gap-2 text-cyan-400 font-bold text-xs">
                  <Briefcase className="w-3.5 h-3.5" />
                  <span>Field Recovery &amp; POP Sector Assignments</span>
                </div>

                {agents.length > 0 && (
                  <div>
                    <label className="text-slate-300 font-medium block mb-1">
                      Link to Field Agent Roster Profile (Optional)
                    </label>
                    <select
                      value={linkedAgentId}
                      onChange={(e) => handleSelectAgent(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-slate-200 font-mono text-xs focus:outline-none focus:border-cyan-500"
                    >
                      <option value="">-- Or enter new agent details below --</option>
                      {agents.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} ({a.phone}) &bull; {a.assignedArea}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
                  <AreaNodeSelector
                    label="Assigned Area / Child Node *"
                    value={assignedArea}
                    onChange={setAssignedArea}
                    areas={networkAreas}
                    onAreasUpdated={setNetworkAreas}
                    compact
                  />
                  <div>
                    <label className="text-slate-300 font-medium block mb-1">
                      Cash Collection Limit (PKR) *
                    </label>
                    <select
                      value={cashLimit}
                      onChange={(e) => setCashLimit(Number(e.target.value))}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-slate-200 font-mono text-xs focus:outline-none focus:border-cyan-500"
                    >
                      <option value={25000}>Rs. 25,000 / Maximum</option>
                      <option value={50000}>Rs. 50,000 / Standard</option>
                      <option value={100000}>Rs. 100,000 / Senior Agent</option>
                      <option value={250000}>Rs. 250,000 / High Value Area</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* C. If Manager */}
            {role === 'MANAGER' && (
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3.5">
                <div className="flex items-center gap-2 text-indigo-400 font-bold text-xs">
                  <Users className="w-3.5 h-3.5" />
                  <span>NOC Department &amp; Supervisory Scope</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-slate-300 font-medium block mb-1">Assigned Department *</label>
                    <select
                      value={department}
                      onChange={(e) => setDepartment(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-slate-200 font-mono text-xs focus:outline-none focus:border-cyan-500"
                    >
                      <option value="NOC & Network Operations">NOC &amp; Network Operations</option>
                      <option value="Complaints & SLA Dispatch">Complaints &amp; SLA Dispatch</option>
                      <option value="Billing & Cash Reconciliation">Billing &amp; Cash Reconciliation</option>
                      <option value="Subscriber Retention">Subscriber Retention</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-slate-300 font-medium block mb-1">Operational Permissions</label>
                    <input
                      type="text"
                      value={operationalPermissions}
                      onChange={(e) => setOperationalPermissions(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-slate-200 font-mono text-xs focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                </div>
              </div>
            )}

            {(role === 'MANAGER' || role === 'AGENT') && (
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                <StaffPermissionsEditor
                  value={staffPermissions}
                  onChange={setStaffPermissions}
                  disabled={isSubmitting}
                  compact
                />
              </div>
            )}

            {/* Core Credentials Form */}
            <div className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-300 font-medium block mb-1">Full Name *</label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="e.g. Asad Ullah Khan"
                    required
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-200 text-xs focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div>
                  <label className="text-slate-300 font-medium block mb-1">
                    Contact Phone (WhatsApp Number) *
                  </label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+92 300 1234567"
                    required
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-200 font-mono text-xs focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-300 font-medium block mb-1">
                    Portal Login Username *
                  </label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => handleUsernameUpdate(e.target.value)}
                    placeholder="e.g. bz_ahmed, dgi_sana"
                    required
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-200 font-mono text-xs focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-slate-300 font-medium">Password *</label>
                    <button
                      type="button"
                      onClick={() => setPassword(generateRandomPassword())}
                      className="text-cyan-400 hover:text-cyan-300 text-[10px] font-mono flex items-center gap-1 cursor-pointer transition"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>Auto-Generate</span>
                    </button>
                  </div>

                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-3 pr-9 py-2 text-slate-200 font-mono text-xs focus:outline-none focus:border-cyan-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((p) => !p)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-1 cursor-pointer"
                    >
                      {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Instant WhatsApp Dispatch Checkbox */}
            <label className="flex items-start gap-2.5 p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-800/60 cursor-pointer hover:border-emerald-700 transition">
              <input
                type="checkbox"
                checked={sendWhatsApp}
                onChange={(e) => setSendWhatsApp(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-emerald-700 text-emerald-600 focus:ring-emerald-500 cursor-pointer bg-slate-900"
              />
              <div className="space-y-0.5">
                <span className="font-bold text-emerald-300 text-xs flex items-center gap-1.5">
                  <Send className="w-3.5 h-3.5" />
                  <span>Send Login Credentials to User via WhatsApp</span>
                </span>
                <p className="text-[11px] text-slate-300 leading-normal">
                  Automatically dispatches portal link, username, and password directly via your linked WhatsApp session (zero-click).
                </p>
              </div>
            </label>

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-800 shrink-0">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-5 py-2 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-slate-950 font-bold transition shadow-lg shadow-cyan-950/50 cursor-pointer disabled:opacity-50 active:scale-95"
              >
                {isSubmitting ? 'Creating Account...' : '+ Create Account & Credentials'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
