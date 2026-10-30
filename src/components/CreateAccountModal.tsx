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
  CheckCircle2,
  AlertCircle,
  Link as LinkIcon,
  Briefcase,
  Send,
  Radio,
  Search,
  UserCheck,
  Check,
  Copy,
  ExternalLink,
  Wifi,
} from 'lucide-react';
import { UserAccount, SystemRole } from '../types/auth';
import { useISP } from '../context/ISPContext';
import { generateRandomPassword, buildStandardWhatsAppCredentialText, getPortalUrlForRole } from '../services/authUtils';
import {
  RealMikrotikSubscriber,
  fetchLiveMikrotikSubscribers,
  getCachedSubscribers,
} from '../services/mikrotikSubscriberSync';

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
  const { routers, selectedRouterId, agents, logWhatsAppNotice } = useISP();

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

  // Agent specific fields
  const [assignedArea, setAssignedArea] = useState('Sector G-11 & G-10 (North Zone)');
  const [cashLimit, setCashLimit] = useState<number>(50000);
  const [linkedAgentId, setLinkedAgentId] = useState('');

  // Manager specific fields
  const [department, setDepartment] = useState('NOC & Network Operations');
  const [operationalPermissions, setOperationalPermissions] = useState('Full NOC Operations & SLA Oversight');

  // WhatsApp checkbox
  const [sendWhatsApp, setSendWhatsApp] = useState(true);

  // Submission & Toast state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [createdSuccessToast, setCreatedSuccessToast] = useState<{
    user: UserAccount;
    plainPassword: string;
    waUrl: string;
    waText: string;
  } | null>(null);
  const [copiedSuccess, setCopiedSuccess] = useState(false);

  const currentRouter = useMemo(
    () => routers.find((r) => r.id === selectedRouterId) || routers[0],
    [routers, selectedRouterId]
  );

  // Update live subscribers from props or fetch directly from MikroTik REST API
  useEffect(() => {
    if (!isOpen) {
      setCreatedSuccessToast(null);
      setErrorMessage(null);
      setSubscriberSearchQuery('');
      setIsSubscriberSearchOpen(false);
      return;
    }

    setPassword(generateRandomPassword());
    setErrorMessage(null);
    setCreatedSuccessToast(null);

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
      createdAt: new Date().toISOString(),
    };

    // 1. Save the created portal user credential into localStorage (youthnet_portal_users)
    try {
      const existingPortalUsersRaw = localStorage.getItem('youthnet_portal_users');
      const existingList: any[] = existingPortalUsersRaw ? JSON.parse(existingPortalUsersRaw) : [];
      const portalUserRecord = {
        id: newUser.id,
        username: cleanUsername,
        password: plainPass,
        fullName: fullName.trim(),
        phone: cleanPhone,
        role,
        linkedCustomerId: selectedSubscriber?.username || cleanUsername,
        pppoeUsername: selectedSubscriber?.username || cleanUsername,
        assignedIp: selectedSubscriber?.address || '',
        callerId: selectedSubscriber?.callerId || '',
        profile: selectedSubscriber?.profile || 'default',
        createdAt: new Date().toISOString(),
      };

      const updatedList = [
        portalUserRecord,
        ...existingList.filter((u) => u.username?.toLowerCase() !== cleanUsername),
      ];
      localStorage.setItem('youthnet_portal_users', JSON.stringify(updatedList));
    } catch (storageErr) {
      console.warn('Failed saving to youthnet_portal_users:', storageErr);
    }

    // 2. Persist to server backend API
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

    // 3. Build WhatsApp credentials text & link
    const waText = buildStandardWhatsAppCredentialText(
      fullName.trim(),
      cleanUsername,
      plainPass,
      getPortalUrlForRole(role)
    );
    const cleanWaPhone = cleanPhone.replace(/[^0-9]/g, '');
    const waUrl = `https://wa.me/${cleanWaPhone}?text=${encodeURIComponent(waText)}`;

    // Log to system WhatsApp notification history
    logWhatsAppNotice(
      cleanPhone,
      fullName.trim(),
      waText,
      'isp_user_credentials_provisioned'
    );

    setIsSubmitting(false);

    // Requirement 4: Show a success toast with the option to send credentials via WhatsApp
    setCreatedSuccessToast({
      user: newUser,
      plainPassword: plainPass,
      waUrl,
      waText,
    });
  };

  const handleFinishAndClose = () => {
    if (createdSuccessToast) {
      onSuccess(createdSuccessToast.user, createdSuccessToast.plainPassword, sendWhatsApp);
    }
    onClose();
  };

  const handleCopyToastCredentials = () => {
    if (!createdSuccessToast) return;
    const text = `=== YOUTH NET PORTAL CREDENTIALS ===\nSubscriber: ${createdSuccessToast.user.fullName}\nUsername: ${createdSuccessToast.user.username}\nPassword: ${createdSuccessToast.plainPassword}\nRole: ${createdSuccessToast.user.role}\nPortal URL: ${window.location.origin}/login`;
    navigator.clipboard.writeText(text);
    setCopiedSuccess(true);
    setTimeout(() => setCopiedSuccess(false), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in font-sans">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-xl w-full overflow-hidden shadow-2xl shadow-cyan-950/40 max-h-[92vh] flex flex-col">
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
          {/* Requirement 4: Success Toast with WhatsApp and Login Details */}
          {createdSuccessToast && (
            <div className="p-4 bg-emerald-950/90 border-2 border-emerald-500 rounded-2xl space-y-3 shadow-xl animate-fade-in">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-xl bg-emerald-500 text-slate-950 font-bold">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">
                      Portal Account Ready for @{createdSuccessToast.user.username}
                    </h4>
                    <p className="text-[11px] text-emerald-300 font-mono mt-0.5">
                      Saved to <code className="bg-emerald-900/60 px-1 py-0.5 rounded text-emerald-200">youthnet_portal_users</code> &bull; Ready for instant login
                    </p>
                  </div>
                </div>
              </div>

              {/* Account Credentials Card */}
              <div className="bg-slate-950/90 p-3 rounded-xl border border-emerald-800/80 space-y-1.5 font-mono text-[11px]">
                <div className="flex justify-between items-center text-slate-300">
                  <span className="text-slate-400">Portal Login:</span>
                  <span className="text-cyan-300 font-bold">@{createdSuccessToast.user.username}</span>
                </div>
                <div className="flex justify-between items-center text-slate-300">
                  <span className="text-slate-400">Password:</span>
                  <span className="text-amber-300 font-bold">{createdSuccessToast.plainPassword}</span>
                </div>
                <div className="flex justify-between items-center text-slate-300">
                  <span className="text-slate-400">Assigned Role:</span>
                  <span className="text-emerald-400">{createdSuccessToast.user.role}</span>
                </div>
                {selectedSubscriber && (
                  <div className="flex justify-between items-center text-slate-300 pt-1 border-t border-slate-800">
                    <span className="text-slate-400">MikroTik IP / MAC:</span>
                    <span className="text-slate-300 text-[10px]">
                      {selectedSubscriber.address || 'Dynamic'} &bull; {selectedSubscriber.callerId || 'Unbound'}
                    </span>
                  </div>
                )}
              </div>

              {/* Action Buttons: WhatsApp & Finish */}
              <div className="flex flex-col sm:flex-row items-center gap-2 pt-1">
                <a
                  href={createdSuccessToast.waUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full sm:flex-1 py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/40 transition"
                >
                  <Send className="w-4 h-4" />
                  <span>Send Credentials via WhatsApp</span>
                </a>

                <button
                  type="button"
                  onClick={handleCopyToastCredentials}
                  className="w-full sm:w-auto py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center justify-center gap-1.5 transition"
                >
                  {copiedSuccess ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedSuccess ? 'Copied!' : 'Copy'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleFinishAndClose}
                  className="w-full sm:w-auto py-2.5 px-4 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs transition"
                >
                  Done
                </button>
              </div>
            </div>
          )}

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

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-slate-300 font-medium block mb-1">Assigned Area / POP Sector *</label>
                    <input
                      type="text"
                      value={assignedArea}
                      onChange={(e) => setAssignedArea(e.target.value)}
                      placeholder="e.g. Sector G-11 & G-10"
                      required
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-slate-200 font-mono text-xs focus:outline-none focus:border-cyan-500"
                    />
                  </div>
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
                    onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s+/g, '_'))}
                    placeholder="e.g. pppoe_user01"
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
                  Generates instant 1-click WhatsApp message button with the portal link, username, and password immediately upon account creation.
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
