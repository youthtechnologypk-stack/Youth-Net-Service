import React, { useState, useEffect } from 'react';
import {
  X,
  Server,
  Lock,
  Cpu,
  Activity,
  Zap,
  Globe,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Shield,
  Layers,
} from 'lucide-react';
import { useISP } from '../context/ISPContext';
import { MikrotikRouter } from '../types/isp';

interface EditRouterModalProps {
  isOpen: boolean;
  router: MikrotikRouter | null;
  onClose: () => void;
  onSuccess?: (message: string) => void;
}

const POPULAR_MODELS = [
  'CCR2004-16G-2S+',
  'CCR2116-12G-4S+',
  'CCR2216-1G-12XS-2XQ',
  'CCR1036-8G-2S+',
  'RB5009UG+S+IN',
  'RB4011iGS+RM',
  'Cloud Hosted Router (CHR)',
  'x86 Generic Carrier BNG',
];

export const EditRouterModal: React.FC<EditRouterModalProps> = ({
  isOpen,
  router,
  onClose,
  onSuccess,
}) => {
  const { updateMikrotikRouter, testRouterConnection } = useISP();

  const [name, setName] = useState('');
  const [model, setModel] = useState('');
  const [ipAddress, setIpAddress] = useState('');
  const [apiPort, setApiPort] = useState<number>(8728);
  const [useSsl, setUseSsl] = useState<boolean>(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [location, setLocation] = useState('');
  const [wanInterface, setWanInterface] = useState('');
  const [walledGardenPool, setWalledGardenPool] = useState('');

  // Test Connection state
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    latencyMs?: number;
    identity?: string;
  } | null>(null);

  // Saving state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (router && isOpen) {
      setName(router.name || '');
      setModel(router.model || 'CCR2004-16G-2S+');
      setIpAddress(router.ipAddress || '');
      setApiPort(router.apiPort || 8728);
      setUseSsl(Boolean(router.useSsl));
      setUsername(router.username || 'admin');
      setPassword(''); // Blank by default to keep existing
      setLocation(router.location || '');
      setWanInterface(router.wanInterface || 'ether1');
      setWalledGardenPool(router.walledGardenPool || '172.16.100.0/24');
      setTestResult(null);
      setErrorMsg(null);
    }
  }, [router, isOpen]);

  if (!isOpen || !router) return null;

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    setErrorMsg(null);

    try {
      const res = await testRouterConnection({
        host: ipAddress.trim(),
        port: Number(apiPort) || 8728,
        username: username.trim(),
        password: password.trim() || undefined,
        useSsl,
      });

      setTestResult({
        success: res.success,
        message: res.message,
        latencyMs: res.latencyMs,
        identity: (res as any).identity,
      });
    } catch (err: any) {
      setTestResult({
        success: false,
        message: err.message || 'Connection test timed out or failed.',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErrorMsg('Router name is required.');
      return;
    }
    if (!ipAddress.trim()) {
      setErrorMsg('IP Address / Host is required.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const updates: Partial<MikrotikRouter> & { password?: string } = {
        name: name.trim(),
        model: model.trim(),
        ipAddress: ipAddress.trim(),
        apiPort: Number(apiPort) || 8728,
        username: username.trim(),
        useSsl,
        location: location.trim(),
        wanInterface: wanInterface.trim(),
        walledGardenPool: walledGardenPool.trim(),
      };

      if (password.trim()) {
        updates.password = password.trim();
      }

      const res = await updateMikrotikRouter(router.id, updates);

      if (res.success) {
        if (onSuccess) {
          onSuccess(res.message || `Router ${name.trim()} updated successfully`);
        }
        onClose();
      } else {
        setErrorMsg(res.message || 'Failed to update router configuration.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to save changes.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/70">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-cyan-950/80 border border-cyan-700/60 text-cyan-400">
              <Server className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span>Edit Router Configuration</span>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                  {router.id}
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                Update management IP, API authentication, and carrier parameters.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-6 space-y-5">
          {errorMsg && (
            <div className="p-3 bg-rose-950/50 border border-rose-800 text-rose-300 rounded-xl text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Identity & Model */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Router Name / Identity *
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full bg-slate-950 border border-slate-700 text-slate-200 text-xs px-3.5 py-2.5 rounded-xl focus:outline-none focus:border-cyan-500 font-mono"
                placeholder="BRAS-CCR2004-CORE-01"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Hardware Model / Description
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  list="router-models"
                  className="w-full bg-slate-950 border border-slate-700 text-slate-200 text-xs px-3.5 py-2.5 rounded-xl focus:outline-none focus:border-cyan-500 font-mono"
                  placeholder="MikroTik CCR2004-16G-2S+"
                />
                <datalist id="router-models">
                  {POPULAR_MODELS.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </div>
            </div>
          </div>

          {/* Network & API Port */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Management IP Address / Hostname *
              </label>
              <input
                type="text"
                value={ipAddress}
                onChange={(e) => setIpAddress(e.target.value)}
                required
                className="w-full bg-slate-950 border border-slate-700 text-slate-200 text-xs px-3.5 py-2.5 rounded-xl focus:outline-none focus:border-cyan-500 font-mono"
                placeholder="202.142.186.150 or 10.200.0.1"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                API Port
              </label>
              <input
                type="number"
                value={apiPort}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setApiPort(val);
                  if (val === 8729 || val === 443) {
                    setUseSsl(true);
                  }
                }}
                required
                className="w-full bg-slate-950 border border-slate-700 text-slate-200 text-xs px-3.5 py-2.5 rounded-xl focus:outline-none focus:border-cyan-500 font-mono"
                placeholder="8728"
              />
            </div>
          </div>

          {/* Credentials */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                API Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className="w-full bg-slate-950 border border-slate-700 text-slate-200 text-xs px-3.5 py-2.5 rounded-xl focus:outline-none focus:border-cyan-500 font-mono"
                placeholder="admin"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                API Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-slate-200 text-xs px-3.5 py-2.5 rounded-xl focus:outline-none focus:border-cyan-500 font-mono"
                placeholder="Leave blank to keep existing password"
              />
              <span className="text-[10px] text-slate-500 mt-1 block">
                Leave empty to preserve existing stored credentials.
              </span>
            </div>
          </div>

          {/* Location & WAN Interface */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Physical POP Location / Hub
              </label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-slate-200 text-xs px-3.5 py-2.5 rounded-xl focus:outline-none focus:border-cyan-500 font-mono"
                placeholder="Sector G-11 Primary Hub Rack 01"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Uplink WAN Interface Name
              </label>
              <input
                type="text"
                value={wanInterface}
                onChange={(e) => setWanInterface(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-slate-200 text-xs px-3.5 py-2.5 rounded-xl focus:outline-none focus:border-cyan-500 font-mono"
                placeholder="sfp-sfpplus1 or ether1"
              />
            </div>
          </div>

          {/* Walled Garden Pool */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Walled Garden Isolation IP Pool
            </label>
            <input
              type="text"
              value={walledGardenPool}
              onChange={(e) => setWalledGardenPool(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 text-slate-200 text-xs px-3.5 py-2.5 rounded-xl focus:outline-none focus:border-cyan-500 font-mono"
              placeholder="172.16.100.0/24"
            />
          </div>

          {/* TLS / SSL Checkbox */}
          <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-xl flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Shield className="w-4 h-4 text-cyan-400" />
              <div>
                <span className="text-xs font-bold text-slate-200 block">
                  Enable TLS / SSL Encryption
                </span>
                <span className="text-[11px] text-slate-400">
                  Encrypt RouterOS API binary socket communication (standard on port 8729).
                </span>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={useSsl}
                onChange={(e) => setUseSsl(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-600"></div>
            </label>
          </div>

          {/* Test Connection Result Box */}
          {testResult && (
            <div
              className={`p-3.5 rounded-xl border text-xs font-mono flex items-start gap-2.5 ${
                testResult.success
                  ? 'bg-emerald-950/40 border-emerald-700/80 text-emerald-200'
                  : 'bg-rose-950/40 border-rose-700/80 text-rose-200'
              }`}
            >
              {testResult.success ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              )}
              <div className="flex-1 space-y-0.5">
                <span className="font-bold block">
                  {testResult.success ? 'Connection Successful!' : 'Connection Probe Failed'}
                </span>
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  {testResult.message}
                </p>
                {testResult.latencyMs !== undefined && (
                  <span className="text-[10px] text-cyan-300 block">
                    Latency: {testResult.latencyMs}ms
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Footer Actions */}
          <div className="pt-3 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={isTesting || !ipAddress.trim()}
              className="w-full sm:w-auto px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin' : ''}`} />
              <span>{isTesting ? 'Testing Socket...' : 'Test Connection'}</span>
            </button>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="w-full sm:w-auto px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition cursor-pointer"
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full sm:w-auto px-5 py-2.5 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs rounded-xl transition flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-cyan-950/50 disabled:opacity-50"
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Saving Changes...</span>
                  </>
                ) : (
                  <span>Save Changes</span>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
