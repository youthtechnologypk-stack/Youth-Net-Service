import React, { useState, useEffect } from 'react';
import {
  X,
  Zap,
  Sliders,
  Radio,
  Server,
  Terminal,
  Copy,
  Check,
  CheckCircle2,
  DollarSign,
  ArrowDown,
  ArrowUp,
  Cpu,
  Layers,
  Sparkles,
} from 'lucide-react';
import { InternetPackage } from '../types/isp';
import { useISP } from '../context/ISPContext';
import { useCurrency } from '../context/CurrencyContext';

interface AddBandwidthProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  profileToEdit?: InternetPackage | null;
}

export const AddBandwidthProfileModal: React.FC<AddBandwidthProfileModalProps> = ({
  isOpen,
  onClose,
  profileToEdit,
}) => {
  const { addPackage, updatePackage, selectedRouterId, routers } = useISP();
  const { currencySymbol } = useCurrency();
  const currentRouter = routers.find((r) => r.id === selectedRouterId) || routers[0];

  const [name, setName] = useState('');
  const [mikrotikProfile, setMikrotikProfile] = useState('');
  const [downloadSpeedMbps, setDownloadSpeedMbps] = useState<number>(30);
  const [uploadSpeedMbps, setUploadSpeedMbps] = useState<number>(15);
  const [priceMonthly, setPriceMonthly] = useState<number>(35);
  const [isUnlimited, setIsUnlimited] = useState(true);
  const [dataLimitGb, setDataLimitGb] = useState<number>(500);
  const [isPopular, setIsPopular] = useState(false);

  // Advanced BNG Settings
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [localAddress, setLocalAddress] = useState('192.168.8.1');
  const [remoteAddressPool, setRemoteAddressPool] = useState('pppoe-pool-default');
  const [dnsServers, setDnsServers] = useState('8.8.8.8, 1.1.1.1');
  const [queueType, setQueueType] = useState('default-small');
  const [enableBurst, setEnableBurst] = useState(false);
  const [burstDownloadMbps, setBurstDownloadMbps] = useState<number>(45);
  const [burstUploadMbps, setBurstUploadMbps] = useState<number>(25);
  const [burstThresholdMbps, setBurstThresholdMbps] = useState<number>(20);
  const [burstTimeSeconds, setBurstTimeSeconds] = useState<number>(16);
  const [description, setDescription] = useState('');

  const [copiedCli, setCopiedCli] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (profileToEdit) {
      setName(profileToEdit.name);
      setMikrotikProfile(profileToEdit.mikrotikProfile);
      setDownloadSpeedMbps(profileToEdit.downloadSpeedMbps);
      setUploadSpeedMbps(profileToEdit.uploadSpeedMbps);
      setPriceMonthly(profileToEdit.priceMonthly);
      setIsUnlimited(profileToEdit.dataLimitGb === null);
      setDataLimitGb(profileToEdit.dataLimitGb || 500);
      setIsPopular(!!profileToEdit.isPopular);
      setLocalAddress(profileToEdit.localAddress || '192.168.8.1');
      setRemoteAddressPool(profileToEdit.remoteAddressPool || 'pppoe-pool-default');
      setDnsServers(profileToEdit.dnsServers || '8.8.8.8, 1.1.1.1');
      setQueueType(profileToEdit.queueType || 'default-small');
      if (profileToEdit.burstDownloadMbps) {
        setEnableBurst(true);
        setBurstDownloadMbps(profileToEdit.burstDownloadMbps);
        setBurstUploadMbps(profileToEdit.burstUploadMbps || 20);
        setBurstThresholdMbps(profileToEdit.burstThresholdMbps || 25);
        setBurstTimeSeconds(profileToEdit.burstTimeSeconds || 16);
      } else {
        setEnableBurst(false);
      }
      setDescription(profileToEdit.description || '');
    } else {
      setName('');
      setMikrotikProfile('');
      setDownloadSpeedMbps(30);
      setUploadSpeedMbps(15);
      setPriceMonthly(35);
      setIsUnlimited(true);
      setDataLimitGb(500);
      setIsPopular(false);
      setLocalAddress('192.168.8.1');
      setRemoteAddressPool('pppoe-pool-default');
      setDnsServers('8.8.8.8, 1.1.1.1');
      setQueueType('default-small');
      setEnableBurst(false);
      setDescription('');
    }
  }, [profileToEdit, isOpen]);

  // Auto-generate suggested RouterOS profile name when display name or speed changes
  const handleNameChange = (val: string) => {
    setName(val);
    if (!profileToEdit) {
      const slug = val
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_');
      if (slug) {
        setMikrotikProfile(`profile_${slug}`);
      }
    }
  };

  const handleSpeedPreset = (dl: number, ul: number, price: number) => {
    setDownloadSpeedMbps(dl);
    setUploadSpeedMbps(ul);
    setPriceMonthly(price);
    if (!name || name.includes('Mbps') || name.includes('M')) {
      setName(`${dl}M Turbo Fiber`);
      setMikrotikProfile(`profile_${dl}m_${ul}m`);
    }
  };

  if (!isOpen) return null;

  // Generate RouterOS v7 CLI Command
  const rateLimitStr = `${uploadSpeedMbps}M/${downloadSpeedMbps}M`;
  const burstStr = enableBurst
    ? ` ${burstUploadMbps}M/${burstDownloadMbps}M ${burstThresholdMbps}M/${burstThresholdMbps}M ${burstTimeSeconds}/${burstTimeSeconds}`
    : '';
  const fullRateLimitParam = `${rateLimitStr}${burstStr}`;

  const generatedCli = `/ppp profile add name="${mikrotikProfile || `profile_${downloadSpeedMbps}m`}" \\
  local-address=${localAddress} \\
  remote-address=${remoteAddressPool} \\
  rate-limit="${fullRateLimitParam}" \\
  dns-server=${dnsServers.replace(/\s+/g, '')} \\
  queue-type-upload=${queueType} \\
  queue-type-download=${queueType} \\
  comment="Youth Net - ${name || 'Fiber Profile'} (${currencySymbol}${priceMonthly}/mo)"`;

  const handleCopyCli = () => {
    navigator.clipboard.writeText(generatedCli);
    setCopiedCli(true);
    setTimeout(() => setCopiedCli(false), 2000);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsSubmitting(true);
    const finalProfileName =
      mikrotikProfile.trim() || `profile_${downloadSpeedMbps}m_${uploadSpeedMbps}m`;

    const payload = {
      name: name.trim(),
      downloadSpeedMbps: Number(downloadSpeedMbps),
      uploadSpeedMbps: Number(uploadSpeedMbps),
      priceMonthly: Number(priceMonthly),
      mikrotikProfile: finalProfileName,
      dataLimitGb: isUnlimited ? null : Number(dataLimitGb),
      isPopular,
      localAddress,
      remoteAddressPool,
      dnsServers,
      queueType,
      burstDownloadMbps: enableBurst ? Number(burstDownloadMbps) : undefined,
      burstUploadMbps: enableBurst ? Number(burstUploadMbps) : undefined,
      burstThresholdMbps: enableBurst ? Number(burstThresholdMbps) : undefined,
      burstTimeSeconds: enableBurst ? Number(burstTimeSeconds) : undefined,
      description: description.trim() || undefined,
    };

    if (profileToEdit) {
      await updatePackage(profileToEdit.id, payload);
    } else {
      await addPackage(payload);
    }

    setIsSubmitting(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in font-sans">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 bg-slate-950 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-gradient-to-tr from-cyan-600 to-blue-600 text-white shadow-md shadow-cyan-500/20">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-sm text-white">
                  {profileToEdit ? 'Edit Bandwidth Profile' : 'Add Bandwidth Profile'}
                </h3>
                <span className="text-[10px] px-2 py-0.5 rounded font-mono font-bold uppercase bg-cyan-950 text-cyan-300 border border-cyan-800">
                  RouterOS /ppp/profile
                </span>
              </div>
              <p className="text-slate-400 text-xs mt-0.5 font-mono">
                Synchronized across active BNG: <span className="text-cyan-300">{currentRouter.name}</span>
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto space-y-4 text-xs font-mono">
          {/* Quick Presets Strip */}
          <div>
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-1.5">
              Quick Carrier Presets:
            </span>
            <div className="flex flex-wrap gap-1.5">
              {[
                { name: '15M Eco', dl: 15, ul: 10, price: 20 },
                { name: '25M Plus', dl: 25, ul: 15, price: 30 },
                { name: '50M Turbo', dl: 50, ul: 25, price: 45 },
                { name: '75M Gamer', dl: 75, ul: 40, price: 60 },
                { name: '100M Fiber', dl: 100, ul: 50, price: 75 },
                { name: '200M Ultra', dl: 200, ul: 100, price: 120 },
              ].map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  onClick={() => handleSpeedPreset(preset.dl, preset.ul, preset.price)}
                  className={`px-2.5 py-1 rounded-lg border text-[11px] font-bold transition cursor-pointer ${
                    downloadSpeedMbps === preset.dl && uploadSpeedMbps === preset.ul
                      ? 'bg-cyan-600 text-slate-950 border-cyan-500 shadow-sm'
                      : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  {preset.name} ({preset.dl}M/${preset.price})
                </button>
              ))}
            </div>
          </div>

          {/* Profile Name & MikroTik Identifier */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 font-semibold mb-1">
                Profile Display Name *
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="e.g. 50M Turbo Fiber"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-slate-400 font-semibold mb-1">
                MikroTik RouterOS Profile Name *
              </label>
              <input
                type="text"
                required
                value={mikrotikProfile}
                onChange={(e) => setMikrotikProfile(e.target.value)}
                placeholder="e.g. profile_50m_turbo"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-cyan-300 text-xs focus:outline-none focus:border-cyan-500 font-mono"
              />
              <span className="text-[10px] text-slate-500 mt-0.5 block">
                Exact identifier written to `/ppp/profile` in RouterOS
              </span>
            </div>
          </div>

          {/* Speeds & Pricing */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
              <label className="block text-emerald-400 font-bold mb-1 flex items-center gap-1">
                <ArrowDown className="w-3.5 h-3.5" />
                <span>Download Speed (Mbps) *</span>
              </label>
              <input
                type="number"
                min="1"
                max="10000"
                required
                value={downloadSpeedMbps}
                onChange={(e) => setDownloadSpeedMbps(Number(e.target.value))}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-white font-bold text-sm focus:outline-none focus:border-emerald-500"
              />
              <span className="text-[10px] text-slate-500 mt-1 block">Customer RX bandwidth limit</span>
            </div>

            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
              <label className="block text-cyan-400 font-bold mb-1 flex items-center gap-1">
                <ArrowUp className="w-3.5 h-3.5" />
                <span>Upload Speed (Mbps) *</span>
              </label>
              <input
                type="number"
                min="1"
                max="10000"
                required
                value={uploadSpeedMbps}
                onChange={(e) => setUploadSpeedMbps(Number(e.target.value))}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-white font-bold text-sm focus:outline-none focus:border-cyan-500"
              />
              <span className="text-[10px] text-slate-500 mt-1 block">Customer TX bandwidth limit</span>
            </div>

            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
              <label className="block text-white font-bold mb-1 flex items-center gap-1">
                <DollarSign className="w-3.5 h-3.5 text-amber-400" />
                <span>Monthly Price ({currencySymbol}) *</span>
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                required
                value={priceMonthly}
                onChange={(e) => setPriceMonthly(Number(e.target.value))}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-emerald-400 font-bold text-sm focus:outline-none focus:border-cyan-500"
              />
              <span className="text-[10px] text-slate-500 mt-1 block">Auto-billed on 1st of month</span>
            </div>
          </div>

          {/* Data Cap & Featured Flags */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex items-center justify-between">
              <div>
                <span className="font-bold text-white block">Data Quota Policy</span>
                <span className="text-[10px] text-slate-400">
                  {isUnlimited ? 'Unlimited data / Unmetered' : `Capped at ${dataLimitGb} GB / Month`}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {!isUnlimited && (
                  <input
                    type="number"
                    min="1"
                    value={dataLimitGb}
                    onChange={(e) => setDataLimitGb(Number(e.target.value))}
                    className="w-20 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white"
                  />
                )}
                <button
                  type="button"
                  onClick={() => setIsUnlimited(!isUnlimited)}
                  className={`px-2 py-1 rounded text-[10px] font-bold border transition cursor-pointer ${
                    isUnlimited
                      ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                      : 'bg-slate-800 text-slate-300 border-slate-700'
                  }`}
                >
                  {isUnlimited ? 'Unlimited' : 'Cap (GB)'}
                </button>
              </div>
            </div>

            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex items-center justify-between">
              <div>
                <span className="font-bold text-white block">Featured in Client Portal</span>
                <span className="text-[10px] text-slate-400">Display "Popular" badge on mobile app</span>
              </div>
              <input
                type="checkbox"
                checked={isPopular}
                onChange={(e) => setIsPopular(e.target.checked)}
                className="w-4 h-4 accent-cyan-500 cursor-pointer"
              />
            </div>
          </div>

          {/* Toggle Advanced BNG & RouterOS Parameters */}
          <div className="pt-1">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-cyan-400 hover:text-cyan-300 text-xs font-mono font-bold flex items-center gap-1 cursor-pointer"
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>{showAdvanced ? 'Hide Advanced BNG Queue Settings ▲' : 'Show Advanced BNG & Burst Settings ▼'}</span>
            </button>
          </div>

          {showAdvanced && (
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3 animate-fade-in">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Local Gateway IP</label>
                  <input
                    type="text"
                    value={localAddress}
                    onChange={(e) => setLocalAddress(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-slate-200 text-xs"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Remote IP Pool</label>
                  <input
                    type="text"
                    value={remoteAddressPool}
                    onChange={(e) => setRemoteAddressPool(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-slate-200 text-xs"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 font-semibold mb-1">DNS Servers</label>
                  <input
                    type="text"
                    value={dnsServers}
                    onChange={(e) => setDnsServers(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-slate-200 text-xs"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Queue Type</label>
                  <select
                    value={queueType}
                    onChange={(e) => setQueueType(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-slate-200 text-xs cursor-pointer"
                  >
                    <option value="default-small">default-small (Standard FIFO)</option>
                    <option value="pcq-download-default">pcq-download-default (Per-Connection Queue)</option>
                    <option value="fq_codel">fq_codel (Bufferbloat Killer)</option>
                    <option value="cake">cake (RouterOS v7 Advanced CAKE)</option>
                  </select>
                </div>
              </div>

              {/* Burst Speed Options */}
              <div className="pt-2 border-t border-slate-800/80">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-white text-xs">Temporary Speed Bursting</span>
                  <label className="flex items-center gap-1.5 text-[11px] text-cyan-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={enableBurst}
                      onChange={(e) => setEnableBurst(e.target.checked)}
                      className="accent-cyan-500"
                    />
                    <span>Enable Burst</span>
                  </label>
                </div>

                {enableBurst && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <div>
                      <span className="text-[10px] text-slate-500 block">Burst DL (Mbps)</span>
                      <input
                        type="number"
                        value={burstDownloadMbps}
                        onChange={(e) => setBurstDownloadMbps(Number(e.target.value))}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-emerald-400"
                      />
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 block">Burst UL (Mbps)</span>
                      <input
                        type="number"
                        value={burstUploadMbps}
                        onChange={(e) => setBurstUploadMbps(Number(e.target.value))}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-cyan-400"
                      />
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 block">Threshold (Mbps)</span>
                      <input
                        type="number"
                        value={burstThresholdMbps}
                        onChange={(e) => setBurstThresholdMbps(Number(e.target.value))}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200"
                      />
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 block">Burst Time (s)</span>
                      <input
                        type="number"
                        value={burstTimeSeconds}
                        onChange={(e) => setBurstTimeSeconds(Number(e.target.value))}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Live RouterOS v7 CLI Command Preview */}
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-400 font-bold flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5 text-cyan-400" />
                <span>Live RouterOS v7 CLI Syntax Preview</span>
              </span>
              <button
                type="button"
                onClick={handleCopyCli}
                className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 font-mono transition flex items-center gap-1 cursor-pointer"
              >
                {copiedCli ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                <span>{copiedCli ? 'Copied!' : 'Copy Script'}</span>
              </button>
            </div>
            <pre className="p-2.5 rounded bg-slate-900/90 text-slate-300 text-[10px] font-mono overflow-x-auto border border-slate-800 whitespace-pre">
              {generatedCli}
            </pre>
          </div>

          {/* Modal Actions */}
          <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-bold transition cursor-pointer"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-slate-950 font-bold rounded-xl transition shadow-lg shadow-cyan-950/50 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Zap className="w-4 h-4" />
              <span>{profileToEdit ? 'Save Profile Changes' : 'Deploy Bandwidth Profile'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
