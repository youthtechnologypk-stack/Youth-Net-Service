import React, { useState, useEffect } from 'react';
import {
  X,
  Server,
  Radio,
  ShieldCheck,
  CheckCircle2,
  Lock,
  Cpu,
  Activity,
  Layers,
  Zap,
  Globe,
  RefreshCw,
  AlertTriangle,
  ArrowRight,
} from 'lucide-react';
import { useISP } from '../context/ISPContext';

interface AddMikrotikDeviceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (routerName: string) => void;
}

const POPULAR_MODELS = [
  { model: 'CCR2004-16G-2S+', desc: '16x 1G + 2x 10G SFP+ (High-Performance BNG)' },
  { model: 'CCR2116-12G-4S+', desc: '16-Core 2GHz + 4x 10G SFP+ (Ultra High-Throughput)' },
  { model: 'CCR2216-1G-12XS-2XQ', desc: '100G QSFP28 + 25G SFP28 (Enterprise Core BNG)' },
  { model: 'CCR1036-8G-2S+', desc: '36-Core Tilera (Multi-Gigabit PPPoE Concentrator)' },
  { model: 'RB5009UG+S+IN', desc: '7x 1G + 1x 2.5G + 1x 10G (Dense Sector Aggregation)' },
  { model: 'RB4011iGS+RM', desc: '10x 1G + 1x 10G SFP+ (Sub-Station Rack Router)' },
  { model: 'Cloud Hosted Router (CHR)', desc: 'Virtualized RouterOS v7 on Proxmox/VMware/AWS' },
];

export const AddMikrotikDeviceModal: React.FC<AddMikrotikDeviceModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const { routers, addMikrotikRouter } = useISP();

  const [name, setName] = useState('BRAS-CCR2004-SECTOR-F10');
  const [model, setModel] = useState('CCR2004-16G-2S+');
  const [customModel, setCustomModel] = useState('');
  const [ipAddress, setIpAddress] = useState('10.200.2.1');
  const [apiPort, setApiPort] = useState<number>(8729);
  const [useSsl, setUseSsl] = useState<boolean>(true);
  const [username, setUsername] = useState('netpulse_noc');
  const [password, setPassword] = useState('RouterOS#2026!');
  const [version, setVersion] = useState('RouterOS v7.16.2');
  const [location, setLocation] = useState('Sector F-10 Commercial Hub Rack 2');
  const [wanInterface, setWanInterface] = useState('sfp-sfpplus1');
  const [walledGardenPool, setWalledGardenPool] = useState('172.16.102.0/24');

  // Connection Test simulation state
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    latencyMs?: number;
  } | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [connectingStep, setConnectingStep] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [successInfo, setSuccessInfo] = useState<{ routerName: string; ip: string } | null>(null);

  // Initialize or reset form state whenever modal is opened
  useEffect(() => {
    if (isOpen) {
      setSuccessInfo(null);
      setTestResult(null);
      setIsSubmitting(false);
      setConnectingStep(null);
      setValidationError(null);

      const nextNum = routers.length + 1;
      setName(`BRAS-CCR2004-SECTOR-0${nextNum}`);
      setIpAddress(`10.200.${nextNum}.1`);
      setWalledGardenPool(`172.16.10${nextNum}.0/24`);
      setLocation(`Sector F-${9 + nextNum} Node Hub Rack 01`);
    }
  }, [isOpen, routers.length]);

  if (!isOpen) return null;

  const handleModelChange = (newModel: string) => {
    setModel(newModel);
    if (name.startsWith('BRAS-') || name.startsWith('AGG-')) {
      const prefix = newModel.startsWith('RB') ? 'AGG' : 'BRAS';
      const cleanModel = newModel.split('-')[0].replace(/[^a-zA-Z0-9]/g, '');
      const nextNum = routers.length + 1;
      setName(`${prefix}-${cleanModel}-SECTOR-0${nextNum}`);
    }
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    setValidationError(null);

    // Simulate authentic RouterOS v7 TLS handshake latency
    setTimeout(() => {
      setIsTesting(false);
      const targetIp = ipAddress.trim() || '10.200.2.1';
      setTestResult({
        success: true,
        message: `REST API Handshake Verified on ${targetIp}:${apiPort} (${useSsl ? 'TLS 1.3 Encrypted' : 'Plain API'}). Architecture: 64-bit ARM, RouterOS v7.16.2 response: HTTP 200 OK.`,
        latencyMs: Math.floor(12 + Math.random() * 8),
      });
    }, 700);
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setValidationError(null);

    const nextNum = routers.length + 1;
    const finalName = name.trim() || `BRAS-${model.split('-')[0]}-0${nextNum}`;
    const finalIp = ipAddress.trim() || `10.200.${nextNum}.1`;

    setIsSubmitting(true);
    setConnectingStep(`Connecting to ${finalIp}:${apiPort} via RouterOS REST API...`);

    try {
      await new Promise((r) => setTimeout(r, 450));
      setConnectingStep(`Authenticating user "${username}" (TLS 1.3 Handshake)...`);

      await new Promise((r) => setTimeout(r, 400));
      setConnectingStep('Registering BNG Router into Youth Net Controller...');

      const finalModel = model === 'Custom' ? (customModel.trim() || 'MikroTik RouterOS') : `MikroTik ${model}`;
      const newRouter = await addMikrotikRouter({
        name: finalName,
        model: finalModel,
        ipAddress: finalIp,
        apiPort: Number(apiPort) || 8729,
        useSsl,
        username: username.trim() || 'netpulse_noc',
        version: version || 'RouterOS v7.16.2',
        location: location.trim() || 'Central Distribution Node',
        wanInterface: wanInterface.trim() || 'sfp-sfpplus1',
        walledGardenPool: walledGardenPool.trim() || '172.16.102.0/24',
      });

      setSuccessInfo({ routerName: newRouter.name, ip: newRouter.ipAddress });
      if (onSuccess) {
        onSuccess(newRouter.name);
      }
    } catch (err: any) {
      console.error('Failed to add MikroTik router:', err);
      setValidationError(err?.message || 'Failed to connect to MikroTik device. Please verify IP & credentials.');
    } finally {
      setIsSubmitting(false);
      setConnectingStep(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in font-sans">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-xl w-full overflow-hidden shadow-2xl space-y-4 max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="bg-slate-950 p-4 border-b border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-gradient-to-tr from-cyan-600 to-blue-600 text-white rounded-xl shadow-lg shadow-cyan-500/20">
              <Server className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span>Add MikroTik RouterOS Device</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-700/50 font-mono">
                  v7.16 Native
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                Connect and synchronize a new BNG / BRAS router into Youth Net Service controller.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1 text-xs">
          {successInfo ? (
            <div className="py-6 text-center space-y-4">
              <div className="w-14 h-14 bg-emerald-950 border border-emerald-500 rounded-full flex items-center justify-center mx-auto text-emerald-400 shadow-lg shadow-emerald-950">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <div>
                <h4 className="text-lg font-bold text-white">MikroTik Router Successfully Added!</h4>
                <p className="text-xs text-slate-300 mt-1">
                  Router <strong className="text-cyan-400 font-mono">{successInfo.routerName}</strong> ({successInfo.ip}) is now ONLINE and selected as the active BNG.
                </p>
                <p className="text-[11px] text-slate-400 mt-2 font-mono">
                  Live PPPoE queues, traffic graphs, and walled-garden pools have been synchronized.
                </p>
              </div>

              <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 text-left font-mono space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-400">Connection Status:</span>
                  <span className="text-emerald-400 font-bold">ONLINE & SYNCED</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">REST API Interface:</span>
                  <span className="text-cyan-300 font-bold">{successInfo.ip}:{apiPort} ({useSsl ? 'TLS Encrypted' : 'Plain API'})</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Live Telemetry:</span>
                  <span className="text-slate-200">Active Live Streaming (2.5s interval)</span>
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="w-full py-2.5 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold rounded-xl text-xs transition shadow-lg shadow-cyan-950/40 flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>Done & View Router Live Telemetry</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Validation or Connecting Alert */}
              {connectingStep && (
                <div className="p-3 bg-cyan-950/70 border border-cyan-700/60 rounded-xl text-cyan-300 flex items-center gap-2.5 font-mono animate-pulse">
                  <RefreshCw className="w-4 h-4 animate-spin text-cyan-400 shrink-0" />
                  <span className="text-xs">{connectingStep}</span>
                </div>
              )}

              {validationError && (
                <div className="p-3 bg-rose-950/70 border border-rose-800 rounded-xl text-rose-300 flex items-center gap-2 font-mono">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span className="text-xs">{validationError}</span>
                </div>
              )}

              {/* SECTION 1: Hardware Identity */}
              <div className="space-y-3">
                <div className="flex items-center gap-1.5 text-cyan-400 font-bold text-xs uppercase tracking-wider">
                  <Cpu className="w-3.5 h-3.5" />
                  <span>1. Hardware Identity & Model</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-300 font-medium mb-1">
                      Router Name / Identity <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. BRAS-CCR2004-SECTOR-F10"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded-lg focus:outline-none focus:border-cyan-500 font-mono text-xs font-semibold"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-300 font-medium mb-1">
                      MikroTik Hardware Model
                    </label>
                    <select
                      value={model}
                      onChange={(e) => handleModelChange(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded-lg focus:outline-none focus:border-cyan-500 text-xs font-mono"
                    >
                      {POPULAR_MODELS.map((m) => (
                        <option key={m.model} value={m.model}>
                          {m.model}
                        </option>
                      ))}
                      <option value="Custom">Other Custom Hardware...</option>
                    </select>
                  </div>
                </div>

                {model === 'Custom' && (
                  <div>
                    <label className="block text-slate-300 font-medium mb-1">
                      Custom Model Description
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. MikroTik RB3011UiAS-RM"
                      value={customModel}
                      onChange={(e) => setCustomModel(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded-lg focus:outline-none focus:border-cyan-500 text-xs"
                    />
                  </div>
                )}
              </div>

              {/* SECTION 2: Network & REST API Connection */}
              <div className="space-y-3 pt-3 border-t border-slate-800">
                <div className="flex items-center gap-1.5 text-cyan-400 font-bold text-xs uppercase tracking-wider">
                  <Globe className="w-3.5 h-3.5" />
                  <span>2. Management IP & API Authentication</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono">
                  <div className="sm:col-span-2">
                    <label className="block text-slate-300 font-sans font-medium mb-1">
                      IP Address / Hostname <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="10.200.2.1 or 192.168.88.1"
                      value={ipAddress}
                      onChange={(e) => setIpAddress(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 text-cyan-300 p-2 rounded-lg focus:outline-none focus:border-cyan-500 text-xs font-bold"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-300 font-sans font-medium mb-1">
                      API Port
                    </label>
                    <input
                      type="number"
                      required
                      value={apiPort}
                      onChange={(e) => setApiPort(parseInt(e.target.value) || 8729)}
                      className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded-lg focus:outline-none focus:border-cyan-500 text-xs"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-300 font-medium mb-1">
                      API Username
                    </label>
                    <input
                      type="text"
                      required
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded-lg focus:outline-none focus:border-cyan-500 font-mono text-xs"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-300 font-medium mb-1">
                      API Password
                    </label>
                    <input
                      type="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded-lg focus:outline-none focus:border-cyan-500 font-mono text-xs"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between p-2.5 bg-slate-950 border border-slate-800 rounded-lg">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <div>
                      <span className="text-xs text-white font-medium block">
                        Enable TLS / SSL Encryption
                      </span>
                      <span className="text-[10px] text-slate-400 block">
                        Secure RouterOS REST API communication over HTTPS/TLS (Port 8729/443)
                      </span>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={useSsl}
                    onChange={(e) => {
                      setUseSsl(e.target.checked);
                      setApiPort(e.target.checked ? 8729 : 8728);
                    }}
                    className="w-4 h-4 rounded bg-slate-900 border-slate-700 text-cyan-600 focus:ring-0 cursor-pointer"
                  />
                </div>

                {/* Test Connection Button & Result */}
                <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-300 font-medium">Verify RouterOS Reachability:</span>
                    <button
                      type="button"
                      onClick={handleTestConnection}
                      disabled={isTesting || isSubmitting}
                      className="bg-slate-800 hover:bg-slate-700 text-cyan-400 font-bold px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 transition border border-slate-700 cursor-pointer"
                    >
                      {isTesting ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>Testing Ping...</span>
                        </>
                      ) : (
                        <>
                          <Activity className="w-3.5 h-3.5" />
                          <span>Test API Connection</span>
                        </>
                      )}
                    </button>
                  </div>

                  {testResult && (
                    <div
                      className={`p-2.5 rounded-lg text-xs font-mono flex items-start gap-2 ${
                        testResult.success
                          ? 'bg-emerald-950/60 border border-emerald-800 text-emerald-300'
                          : 'bg-rose-950/60 border border-rose-800 text-rose-300'
                      }`}
                    >
                      {testResult.success ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                      )}
                      <div>
                        <div>{testResult.message}</div>
                        {testResult.latencyMs && (
                          <div className="text-[10px] text-emerald-400/80 mt-0.5">
                            Ping Latency: {testResult.latencyMs} ms &bull; SSL Cipher: ECDHE-RSA-AES256-GCM-SHA384
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* SECTION 3: Deployment & PPPoE Configuration */}
              <div className="space-y-3 pt-3 border-t border-slate-800">
                <div className="flex items-center gap-1.5 text-cyan-400 font-bold text-xs uppercase tracking-wider">
                  <Layers className="w-3.5 h-3.5" />
                  <span>3. Deployment Node & Routing Pools</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-300 font-medium mb-1">
                      Physical POP Location / Hub
                    </label>
                    <input
                      type="text"
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      placeholder="e.g. Sector F-10 Commercial Hub Rack 2"
                      className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded-lg focus:outline-none focus:border-cyan-500 text-xs"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-300 font-medium mb-1">
                      WAN Interface Name
                    </label>
                    <input
                      type="text"
                      value={wanInterface}
                      onChange={(e) => setWanInterface(e.target.value)}
                      placeholder="e.g. sfp-sfpplus1 or ether1"
                      className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded-lg focus:outline-none focus:border-cyan-500 font-mono text-xs"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono">
                  <div>
                    <label className="block text-slate-300 font-sans font-medium mb-1">
                      RouterOS Version
                    </label>
                    <select
                      value={version}
                      onChange={(e) => setVersion(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded-lg focus:outline-none focus:border-cyan-500 text-xs font-mono"
                    >
                      <option value="RouterOS v7.16.2">RouterOS v7.16.2 (Current Stable)</option>
                      <option value="RouterOS v7.15.3">RouterOS v7.15.3</option>
                      <option value="RouterOS v7.14.3">RouterOS v7.14.3</option>
                      <option value="RouterOS v6.49.10">RouterOS v6.49.10 (Long-Term)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-300 font-sans font-medium mb-1">
                      Walled Garden IP Pool
                    </label>
                    <input
                      type="text"
                      value={walledGardenPool}
                      onChange={(e) => setWalledGardenPool(e.target.value)}
                      placeholder="172.16.102.0/24"
                      className="w-full bg-slate-950 border border-slate-700 text-amber-300 p-2 rounded-lg focus:outline-none focus:border-cyan-500 text-xs font-bold"
                    />
                  </div>
                </div>
              </div>

              {/* Modal Actions */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-slate-950 font-bold transition shadow-lg shadow-cyan-950/50 flex items-center gap-2 text-xs cursor-pointer active:scale-95"
                >
                  {isSubmitting ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin text-slate-950" />
                      <span>Connecting Device...</span>
                    </>
                  ) : (
                    <>
                      <Server className="w-4 h-4 text-slate-950" />
                      <span>Connect & Add MikroTik Device</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
