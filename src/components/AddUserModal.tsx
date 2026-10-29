import React, { useState, useEffect } from 'react';
import {
  X,
  Server,
  UserPlus,
  Lock,
  Key,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Copy,
  Check,
  Globe,
  Radio,
  RefreshCw,
} from 'lucide-react';
import { useISP } from '../context/ISPContext';
import { safeResponseJson } from '../lib/safeFetch';
import {
  fetchMikrotikPppProfiles,
  provisionPppoeSecretRest,
  fetchMikrotikPppSecrets,
  fetchMikrotikLiveTelemetry,
} from '../services/mikrotikRestClient';

interface AddUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (userData: any) => void;
}

interface DynamicProfile {
  id: string;
  name: string;
  localAddress?: string;
  remoteAddress?: string;
  rateLimit?: string;
}

export const AddUserModal: React.FC<AddUserModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const {
    routers,
    selectedRouterId,
    packages,
    fetchCustomersFromDb,
    syncSelectedRouterNow,
    dynamicPppProfiles,
  } = useISP();

  const [routerId, setRouterId] = useState(selectedRouterId || (routers[0]?.id || ''));
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('fiber1234');
  const [service, setService] = useState('pppoe');
  const [profile, setProfile] = useState('');
  const [remoteIp, setRemoteIp] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('+92 ');
  const [address, setAddress] = useState('');
  const [areaNode, setAreaNode] = useState('Sector G-11 (North Zone)');

  // State for dynamic profiles fetched from MikroTik
  const [profiles, setProfiles] = useState<DynamicProfile[]>([]);
  const [isLoadingProfiles, setIsLoadingProfiles] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  // Submission state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [successData, setSuccessData] = useState<any | null>(null);
  const [copiedSuccess, setCopiedSuccess] = useState(false);

  // Sync selected router
  useEffect(() => {
    if (selectedRouterId) {
      setRouterId(selectedRouterId);
    } else if (routers[0]) {
      setRouterId(routers[0].id);
    }
  }, [selectedRouterId, routers]);

  // Fetch dynamic profiles from target router
  useEffect(() => {
    if (!isOpen) {
      setSuccessData(null);
      setSubmissionError(null);
      return;
    }

    const loadProfiles = async () => {
      setIsLoadingProfiles(true);
      setProfileError(null);

      try {
        const targetRouter = routers.find((r) => r.id === routerId) || routers[0];
        // 1. Fetch PPPoE Bandwidth profiles from GET /api/mikrotik/ppp/profile (RouterOS v7)
        if (targetRouter) {
          const restResult = await fetchMikrotikPppProfiles(targetRouter);
          if (restResult.success && Array.isArray(restResult.profiles) && restResult.profiles.length > 0) {
            setProfiles(restResult.profiles);
            if (!profile || !restResult.profiles.some((p: any) => p.name === profile)) {
              setProfile(restResult.profiles[0].name);
            }
            return;
          }
        }

        // 2. Fallback to dynamicPppProfiles from context if available
        if (dynamicPppProfiles && dynamicPppProfiles.length > 0) {
          setProfiles(dynamicPppProfiles);
          if (!profile || !dynamicPppProfiles.some((p: any) => p.name === profile)) {
            setProfile(dynamicPppProfiles[0].name);
          }
          return;
        }

        const res = await fetch(`/api/mikrotik/profiles?routerId=${encodeURIComponent(routerId)}`);
        const json = await safeResponseJson<any>(res, { success: false, profiles: [] });

        if (json.success && Array.isArray(json.profiles) && json.profiles.length > 0) {
          setProfiles(json.profiles);
          if (!profile || !json.profiles.some((p: any) => p.name === profile)) {
            setProfile(json.profiles[0].name);
          }
        } else {
          // Fallback to configured bandwidth profiles
          const fallbackList: DynamicProfile[] = packages.map((pkg) => ({
            id: pkg.id,
            name: pkg.mikrotikProfile,
            rateLimit: `${pkg.uploadSpeedMbps}M/${pkg.downloadSpeedMbps}M`,
          }));
          setProfiles(fallbackList);
          if (fallbackList[0] && !profile) {
            setProfile(fallbackList[0].name);
          }
        }
      } catch (err: any) {
        // Fallback to packages
        const fallbackList: DynamicProfile[] = packages.map((pkg) => ({
          id: pkg.id,
          name: pkg.mikrotikProfile,
          rateLimit: `${pkg.uploadSpeedMbps}M/${pkg.downloadSpeedMbps}M`,
        }));
        setProfiles(fallbackList);
        if (fallbackList[0] && !profile) {
          setProfile(fallbackList[0].name);
        }
      } finally {
        setIsLoadingProfiles(false);
      }
    };

    loadProfiles();
  }, [isOpen, routerId, packages, dynamicPppProfiles]);

  if (!isOpen) return null;

  const currentRouter = routers.find((r) => r.id === routerId) || routers[0];

  const handleCopySuccess = () => {
    if (!successData) return;
    const credsText = `=== NETPULSE PPPoE SUBSCRIBER CREDENTIALS ===\nSubscriber: ${fullName || username}\nUsername: ${successData.username}\nPassword: ${successData.password}\nService: ${service.toUpperCase()}\nProfile: ${profile}\nStatic IP: ${remoteIp || 'Dynamic DHCP Pool'}\nRouter BNG: ${currentRouter?.name} (${currentRouter?.ipAddress})\nStatus: ACTIVE & PROVISIONED`;
    navigator.clipboard.writeText(credsText);
    setCopiedSuccess(true);
    setTimeout(() => setCopiedSuccess(null as any), 2500);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setSubmissionError('Please provide both username and password.');
      return;
    }

    setIsSubmitting(true);
    setSubmissionError(null);

    const comment = `${fullName.trim() || username} | ${phone.trim()} | ${address.trim()} | YouthNet-App`;

    try {
      // 1. Direct Creation Endpoint: POST /api/mikrotik/ppp/secret/add
      let restProvisioned = false;
      if (currentRouter) {
        try {
          const restRes = await provisionPppoeSecretRest(currentRouter, {
            name: username.trim(),
            password: password.trim(),
            service: service || 'pppoe',
            profile: profile || 'default',
            comment,
          });
          if (restRes.success) {
            restProvisioned = true;
          }
        } catch (restErr) {
          console.warn('REST Secret provision warning:', restErr);
        }
      }

      // 2. Persist to database & cache
      const res = await fetch('/api/mikrotik/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          routerId,
          username: username.trim(),
          password: password.trim(),
          service,
          profile: profile || 'default',
          remoteAddress: remoteIp.trim() || undefined,
          remoteIp: remoteIp.trim() || undefined,
          comment,
          name: fullName.trim() || username.trim(),
          phone: phone.trim(),
          address: address.trim(),
          areaNode,
          packageId: packages.find((p) => p.mikrotikProfile === profile)?.id,
        }),
      });

      const data = await safeResponseJson(res);

      if (!res.ok || !data.success) {
        if (!restProvisioned) {
          throw new Error(data.error || 'Failed to provision user on MikroTik router.');
        }
      }

      setSuccessData(data.user || {
        username: username.trim(),
        password: password.trim(),
        service,
        profile,
        remoteAddress: remoteIp.trim(),
      });

      // 3. Immediately trigger a re-fetch of /api/mikrotik/ppp/active and /api/mikrotik/ppp/secret
      if (currentRouter) {
        Promise.all([
          fetchMikrotikLiveTelemetry(currentRouter, { pollSessions: true, pollTraffic: false }),
          fetchMikrotikPppSecrets(currentRouter),
        ]).catch(() => {});
      }

      if (syncSelectedRouterNow) {
        await syncSelectedRouterNow().catch(() => {});
      }
      if (fetchCustomersFromDb) {
        await fetchCustomersFromDb();
      }
      if (onSuccess) {
        onSuccess(data);
      }
    } catch (err: any) {
      setSubmissionError(err.message || 'An unexpected error occurred during provisioning.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-xl w-full overflow-hidden shadow-2xl shadow-cyan-950/30 flex flex-col max-h-[92vh]">
        {/* Modal Header */}
        <div className="bg-slate-950 p-5 border-b border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-cyan-950 border border-cyan-800 text-cyan-400 rounded-xl">
              <UserPlus className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span>Provision New PPPoE Subscriber</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 font-mono">
                  Live RouterOS API
                </span>
              </h3>
              <p className="text-xs text-slate-400 font-mono mt-0.5">
                Target BRAS: <span className="text-cyan-400 font-bold">{currentRouter?.name}</span> ({currentRouter?.ipAddress}:{currentRouter?.apiPort})
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs font-sans">
          {/* Success Banner Card */}
          {successData && (
            <div className="bg-emerald-950/80 border border-emerald-700 rounded-xl p-4 space-y-3 animate-fade-in">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 text-emerald-300 font-bold">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                  <span>PPPoE Secret Successfully Provisioned on RouterOS!</span>
                </div>
                <button
                  type="button"
                  onClick={handleCopySuccess}
                  className="px-2.5 py-1 rounded bg-emerald-900 hover:bg-emerald-800 text-emerald-200 text-xs font-mono flex items-center gap-1.5 transition cursor-pointer"
                >
                  {copiedSuccess ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedSuccess ? 'Copied' : 'Copy Credentials'}</span>
                </button>
              </div>

              <div className="bg-slate-950/90 rounded-lg p-3 font-mono text-[11px] space-y-1 border border-emerald-800/60">
                <div className="flex justify-between">
                  <span className="text-slate-400">Username:</span>
                  <span className="text-cyan-300 font-bold">{successData.username}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Password:</span>
                  <span className="text-amber-300 font-bold">{successData.password}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Bandwidth Profile:</span>
                  <span className="text-emerald-300">{successData.profile}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Target Router:</span>
                  <span className="text-slate-200">{currentRouter?.name} ({currentRouter?.ipAddress})</span>
                </div>
                {successData.remoteAddress && (
                  <div className="flex justify-between">
                    <span className="text-slate-400">Static Remote IP:</span>
                    <span className="text-indigo-300">{successData.remoteAddress}</span>
                  </div>
                )}
              </div>

              <p className="text-[11px] text-emerald-300/80">
                Record committed to physical MikroTik <code className="bg-emerald-950 px-1 py-0.5 rounded font-mono">/ppp secret add</code> and synchronized to PostgreSQL <code className="bg-emerald-950 px-1 py-0.5 rounded font-mono">customers</code> table.
              </p>
            </div>
          )}

          {/* Submission Error Banner */}
          {submissionError && (
            <div className="p-3.5 bg-rose-950/80 border border-rose-700 rounded-xl flex items-start gap-3 text-xs text-rose-200">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <strong className="text-white block">RouterOS Provisioning Failed:</strong>
                <p className="text-rose-300 font-mono text-[11px] mt-0.5">{submissionError}</p>
                <p className="text-rose-400/80 text-[10px] mt-1">
                  Ensure the router is reachable, the credentials are valid, and the username is not already registered in <code className="bg-rose-900/40 px-1 rounded">/ppp secret</code>.
                </p>
              </div>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Target MikroTik Router Selector */}
            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-slate-300 font-medium flex items-center gap-1.5">
                  <Server className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Target MikroTik Router (BNG / BRAS)</span>
                </label>
                <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                  currentRouter?.status === 'online'
                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                    : 'bg-rose-950 text-rose-300 border border-rose-800'
                }`}>
                  {currentRouter?.status?.toUpperCase() || 'UNKNOWN'}
                </span>
              </div>
              <select
                value={routerId}
                onChange={(e) => setRouterId(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 text-slate-100 p-2 rounded-lg font-mono focus:outline-none focus:border-cyan-500"
              >
                {routers.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} &bull; {r.ipAddress}:{r.apiPort} [{r.status.toUpperCase()}]
                  </option>
                ))}
              </select>
            </div>

            {/* PPPoE Credentials Section */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-950/60 p-3.5 rounded-xl border border-slate-800">
              <div>
                <label className="block text-slate-300 mb-1 font-semibold flex items-center gap-1">
                  <Key className="w-3.5 h-3.5 text-cyan-400" />
                  <span>PPPoE Secret Username *</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. pppoe_subscriber01"
                  value={username}
                  onChange={(e) => {
                    const clean = e.target.value.toLowerCase().replace(/[^a-z0-9_.-]/g, '');
                    setUsername(clean);
                  }}
                  className="w-full bg-slate-900 border border-slate-700 text-cyan-300 font-mono p-2.5 rounded-lg focus:outline-none focus:border-cyan-500"
                />
                <span className="text-[10px] text-slate-500 font-mono mt-0.5 block">
                  Executed as: <code className="text-cyan-400">=name={username || '<user>'}</code>
                </span>
              </div>

              <div>
                <label className="block text-slate-300 mb-1 font-semibold flex items-center gap-1">
                  <Lock className="w-3.5 h-3.5 text-amber-400" />
                  <span>PPPoE Secret Password *</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Secret password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 text-amber-300 font-mono p-2.5 rounded-lg focus:outline-none focus:border-cyan-500"
                />
                <span className="text-[10px] text-slate-500 font-mono mt-0.5 block">
                  Client authentication tunnel key
                </span>
              </div>
            </div>

            {/* Service & Profile Selection */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-400 mb-1">Service Type</label>
                <select
                  value={service}
                  onChange={(e) => setService(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2.5 rounded-lg font-mono focus:outline-none focus:border-cyan-500"
                >
                  <option value="pppoe">pppoe (Carrier Default)</option>
                  <option value="any">any</option>
                  <option value="l2tp">l2tp</option>
                  <option value="sstp">sstp</option>
                  <option value="ovpn">ovpn</option>
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-slate-400 flex items-center gap-1">
                    <span>MikroTik Profile *</span>
                    {isLoadingProfiles && <RefreshCw className="w-3 h-3 text-cyan-400 animate-spin" />}
                  </label>
                  <span className="text-[10px] text-cyan-400 font-mono">/ppp/profile/print</span>
                </div>
                <select
                  value={profile}
                  onChange={(e) => setProfile(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2.5 rounded-lg font-mono focus:outline-none focus:border-cyan-500"
                >
                  {profiles.map((p) => (
                    <option key={p.id} value={p.name}>
                      {p.name} {p.rateLimit ? `(${p.rateLimit})` : ''}
                    </option>
                  ))}
                </select>
                {profileError && (
                  <span className="text-[10px] text-amber-400 block mt-1 font-mono">
                    {profileError}
                  </span>
                )}
              </div>
            </div>

            {/* Static IP & IP Pool Options */}
            <div>
              <label className="block text-slate-400 mb-1 flex items-center justify-between">
                <span>Remote IP / Static IP (Optional)</span>
                <span className="text-[10px] text-slate-500 font-mono">RouterOS =remote-address=</span>
              </label>
              <input
                type="text"
                placeholder="e.g. 10.50.14.88 (leave empty for dynamic IP pool allocation)"
                value={remoteIp}
                onChange={(e) => setRemoteIp(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-slate-100 font-mono p-2.5 rounded-lg focus:outline-none focus:border-cyan-500"
              />
            </div>

            {/* Customer Details & Comment */}
            <div className="border-t border-slate-800 pt-3 space-y-3">
              <h4 className="text-xs font-semibold text-slate-300">
                Subscriber Details (Synchronized to PostgreSQL customers table)
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Full Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Asad Ullah Khan"
                    value={fullName}
                    onChange={(e) => {
                      setFullName(e.target.value);
                      if (!username) {
                        setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''));
                      }
                    }}
                    className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded-lg focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Mobile / WhatsApp Number</label>
                  <input
                    type="text"
                    placeholder="+92 300 1234567"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 text-slate-100 font-mono p-2 rounded-lg focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Physical Address</label>
                  <input
                    type="text"
                    placeholder="e.g. House 14, Street 9, Sector G-11/3"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded-lg focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Distribution Area Node</label>
                  <select
                    value={areaNode}
                    onChange={(e) => setAreaNode(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded-lg focus:outline-none focus:border-cyan-500 font-sans"
                  >
                    <option value="Sector G-11 (North Zone)">Sector G-11 (North Zone)</option>
                    <option value="Sector F-10 (Commercial Zone)">Sector F-10 (Commercial Zone)</option>
                    <option value="Sector I-8 (East Zone)">Sector I-8 (East Zone)</option>
                    <option value="Blue Area (Main Business Hub)">Blue Area (Main Business Hub)</option>
                    <option value="Sector F-11 (West Zone)">Sector F-11 (West Zone)</option>
                    <option value="Sector G-10 (South Zone)">Sector G-10 (South Zone)</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium transition cursor-pointer"
              >
                {successData ? 'Close' : 'Cancel'}
              </button>

              <button
                type="submit"
                disabled={isSubmitting}
                className="px-5 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold transition flex items-center gap-2 shadow-lg shadow-cyan-950/40 disabled:opacity-50 cursor-pointer"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
                    <span>Executing /ppp/secret/add...</span>
                  </>
                ) : (
                  <>
                    <UserPlus className="w-4 h-4" />
                    <span>Provision on MikroTik Router</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
