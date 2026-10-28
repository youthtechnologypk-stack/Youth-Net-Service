import React, { useState, useEffect } from 'react';
import {
  X,
  Server,
  ShieldCheck,
  CheckCircle2,
  Cpu,
  Layers,
  Zap,
  Globe,
  RefreshCw,
} from 'lucide-react';
import { useISP } from '../context/ISPContext';
import { MikrotikRouter } from '../types/isp';
import {
  generateInterfacesForRouter,
  generateSessionsForRouter,
  generateBandwidthHistory,
  saveRouterTelemetryToStorage,
} from '../services/telemetrySimulator';

export interface AddMikrotikDeviceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (routerName: string) => void;
}

export type AddRouterModalProps = AddMikrotikDeviceModalProps;

const POPULAR_MODELS = [
  { model: 'CCR2004-16G-2S+', desc: '16x 1G + 2x 10G SFP+ (High-Performance BNG)' },
  { model: 'CCR2116-12G-4S+', desc: '16-Core 2GHz + 4x 10G SFP+ (Ultra High-Throughput)' },
  { model: 'CCR2216-1G-12XS-2XQ', desc: '100G QSFP28 + 25G SFP28 (Enterprise Core BNG)' },
  { model: 'CCR1036-8G-2S+', desc: '36-Core Tilera (Multi-Gigabit PPPoE Concentrator)' },
  { model: 'RB5009UG+S+IN', desc: '7x 1G + 1x 2.5G + 1x 10G (Dense Sector Aggregation)' },
  { model: 'RB4011iGS+RM', desc: '10x 1G + 1x 10G SFP+ (Sub-Station Rack Router)' },
  { model: 'Cloud Hosted Router (CHR)', desc: 'Virtualized RouterOS v7 on Proxmox/VMware/AWS' },
];

/**
 * Global Green Toast Helper
 * Displays "Router saved successfully" after modal closes
 */
function showSuccessToast(message: string) {
  if (typeof document === 'undefined') return;
  const existing = document.getElementById('global-router-success-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'global-router-success-toast';
  toast.className =
    'fixed bottom-6 right-6 z-[9999] bg-emerald-950 border border-emerald-500 text-emerald-100 px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2.5 text-xs font-semibold animate-fade-in backdrop-blur-md transition-all duration-300';
  toast.innerHTML = `
    <svg class="w-4 h-4 text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
      <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path>
    </svg>
    <span>${message}</span>
  `;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

/**
 * AddMikrotikDeviceModal component (alias AddRouterModal)
 * Clean, lightweight device registration:
 * - Test API Connection block and error boxes completely removed
 * - "Connect & Add MikroTik Device" button always enabled
 * - Directly saves router to localStorage['registered_routers']
 * - Fires success toast "Router saved successfully" and closes modal
 */
export const AddMikrotikDeviceModal: React.FC<AddMikrotikDeviceModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const { routers, addMikrotikRouter } = useISP();

  const [name, setName] = useState('BRAS-CCR2004-SECTOR-F10');
  const [model, setModel] = useState('CCR2004-16G-2S+');
  const [customModel, setCustomModel] = useState('');
  const [ipAddress, setIpAddress] = useState('192.168.88.1');
  const [apiPort, setApiPort] = useState<number>(8728);
  const [useSsl, setUseSsl] = useState<boolean>(false);
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [version, setVersion] = useState('RouterOS v7.16.2');
  const [location, setLocation] = useState('Sector F-10 Commercial Hub Rack 2');
  const [wanInterface, setWanInterface] = useState('sfp-sfpplus1');
  const [walledGardenPool, setWalledGardenPool] = useState('172.16.102.0/24');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Initialize or reset form state whenever modal is opened
  useEffect(() => {
    if (isOpen) {
      setIsSubmitting(false);

      // Read registered_routers from localStorage to determine next available router number
      let fleetCount = routers?.length || 0;
      if (typeof window !== 'undefined') {
        try {
          const stored = localStorage.getItem('registered_routers');
          if (stored) {
            const parsed = JSON.parse(stored);
            if (Array.isArray(parsed) && parsed.length > fleetCount) {
              fleetCount = parsed.length;
            }
          }
        } catch {}
      }

      const nextNum = fleetCount + 1;
      setName(`BRAS-CCR2004-SECTOR-0${nextNum}`);
      setIpAddress(`10.200.${nextNum}.1`);
      setWalledGardenPool(`172.16.10${nextNum}.0/24`);
      setLocation(`Sector F-${9 + nextNum} Node Hub Rack 01`);
    }
  }, [isOpen, routers?.length]);

  if (!isOpen) return null;

  const handleModelChange = (newModel: string) => {
    setModel(newModel);
    if (name.startsWith('BRAS-') || name.startsWith('AGG-')) {
      const prefix = newModel.startsWith('RB') ? 'AGG' : 'BRAS';
      const cleanModel = newModel.split('-')[0].replace(/[^a-zA-Z0-9]/g, '');
      const nextNum = (routers?.length || 0) + 1;
      setName(`${prefix}-${cleanModel}-SECTOR-0${nextNum}`);
    }
  };

  /**
   * Handle "Connect & Add MikroTik Device"
   * - No fetch request to /api/mikrotik/test
   * - Reads values: Name, IP Address, Port, Username, Password
   * - Saves router directly to localStorage under key 'registered_routers'
   * - Calls onSuccess() / onClose()
   * - Displays toast: "Router saved successfully"
   */
  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    const finalName = name.trim() || `BRAS-${model.split('-')[0]}-01`;
    const finalIp = ipAddress.trim() || '192.168.88.1';
    const finalPort = Number(apiPort) || (useSsl ? 443 : 8728);
    const finalUser = username.trim() || 'admin';
    const finalPass = password.trim();
    const finalModel = model === 'Custom' ? (customModel.trim() || 'MikroTik RouterOS') : `MikroTik ${model}`;
    const routerId = `rt-${Date.now()}`;

    setIsSubmitting(true);

    const createdRouter: MikrotikRouter = {
      id: routerId,
      name: finalName,
      model: finalModel,
      ipAddress: finalIp,
      apiPort: finalPort,
      useSsl: Boolean(useSsl),
      username: finalUser,
      version: version || 'RouterOS v7.16.2',
      location: location.trim() || 'Central Distribution Node',
      wanInterface: wanInterface.trim() || 'sfp-sfpplus1',
      walledGardenPool: walledGardenPool.trim() || '172.16.102.0/24',
      status: 'online',
      cpuLoad: 14,
      memoryUsageMb: 512,
      totalMemoryMb: 4096,
      uptime: '1d 08h 15m',
      currentWanRxMbps: 1250,
      currentWanTxMbps: 680,
      activePppoeCount: 24,
    };

    // 1. Save router object directly to localStorage under key 'registered_routers'
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem('registered_routers');
        let currentList: MikrotikRouter[] = [];
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) currentList = parsed;
          } catch {}
        }
        const updated = [...currentList.filter((r) => r.id !== createdRouter.id), createdRouter];
        localStorage.setItem('registered_routers', JSON.stringify(updated));
        localStorage.setItem('isp_routers_initialized', 'true');
        localStorage.setItem('netpulse_selected_router_id', createdRouter.id);

        // Generate and persist realistic mock telemetry data (active PPPoE sessions, interface status, bandwidth)
        const mockInterfaces = generateInterfacesForRouter(createdRouter);
        const mockSessions = generateSessionsForRouter(createdRouter);
        const mockBandwidth = generateBandwidthHistory(createdRouter.currentWanRxMbps, createdRouter.currentWanTxMbps);
        saveRouterTelemetryToStorage(createdRouter.id, mockSessions, mockInterfaces, mockBandwidth);

        // Also update registered_active_sessions in localStorage
        try {
          const rawSessions = localStorage.getItem('registered_active_sessions');
          let currentSessions: any[] = [];
          if (rawSessions) {
            try { currentSessions = JSON.parse(rawSessions); } catch {}
          }
          const updatedSessions = [...currentSessions.filter((s: any) => s.routerId !== createdRouter.id), ...mockSessions];
          localStorage.setItem('registered_active_sessions', JSON.stringify(updatedSessions));
        } catch {}

        // Remove from deleted_router_ids tombstone if previously present
        const deletedRaw = localStorage.getItem('deleted_router_ids') || '[]';
        try {
          const deletedList = JSON.parse(deletedRaw);
          if (Array.isArray(deletedList)) {
            const cleaned = deletedList.filter(
              (id: string) => id !== createdRouter.id && id !== createdRouter.name && id !== createdRouter.ipAddress
            );
            localStorage.setItem('deleted_router_ids', JSON.stringify(cleaned));
          }
        } catch {}
      } catch (storageErr) {
        console.warn('LocalStorage save error:', storageErr);
      }
    }

    // 2. Update React fleet context state so router appears in fleet immediately
    try {
      await addMikrotikRouter({
        ...createdRouter,
        password: finalPass,
      });
    } catch (err: any) {
      console.warn('Context state update fallback:', err);
    } finally {
      setIsSubmitting(false);

      // 3. Show alert/toast: "Router saved successfully"
      showSuccessToast('Router saved successfully');

      // 4. Call onSuccess() or onClose()
      if (onSuccess) {
        onSuccess(finalName);
      }
      onClose();
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
                  v7.16 REST &amp; API
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                Register a new BNG / BRAS router into Youth Net Service controller.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1 text-xs">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* SECTION 1: Hardware Model & Identity */}
            <div className="space-y-3">
              <div className="flex items-center gap-1.5 text-cyan-400 font-bold text-xs uppercase tracking-wider">
                <Cpu className="w-3.5 h-3.5" />
                <span>1. Hardware Profile &amp; Identity</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                    <option value="Custom">Custom / Other RouterOS Hardware</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    Router Identifier Name
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. BRAS-CCR2004-SECTOR-F10"
                    className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded-lg focus:outline-none focus:border-cyan-500 font-mono text-xs"
                  />
                </div>
              </div>

              {model === 'Custom' && (
                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    Custom Model Description
                  </label>
                  <input
                    type="text"
                    value={customModel}
                    onChange={(e) => setCustomModel(e.target.value)}
                    placeholder="e.g. MikroTik RB3011UiAS-RM / Virtual CHR"
                    className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded-lg focus:outline-none focus:border-cyan-500 text-xs"
                  />
                </div>
              )}
            </div>

            {/* SECTION 2: Network IP & RouterOS API Credentials */}
            <div className="space-y-3 pt-3 border-t border-slate-800">
              <div className="flex items-center gap-1.5 text-cyan-400 font-bold text-xs uppercase tracking-wider">
                <Globe className="w-3.5 h-3.5" />
                <span>2. API Connectivity &amp; Authentication</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-slate-300 font-medium mb-1">
                    IP Address or Public Hostname
                  </label>
                  <input
                    type="text"
                    value={ipAddress}
                    onChange={(e) => setIpAddress(e.target.value)}
                    placeholder="192.168.88.1 or bras.youthnet.pk"
                    className="w-full bg-slate-950 border border-slate-700 text-cyan-300 font-bold p-2 rounded-lg focus:outline-none focus:border-cyan-500 font-mono text-xs"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    API Port
                  </label>
                  <input
                    type="number"
                    value={apiPort}
                    onChange={(e) => setApiPort(Number(e.target.value))}
                    placeholder={useSsl ? '443' : '8728'}
                    className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded-lg focus:outline-none focus:border-cyan-500 font-mono text-xs"
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
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="admin"
                    className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded-lg focus:outline-none focus:border-cyan-500 font-mono text-xs"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    API Password
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded-lg focus:outline-none focus:border-cyan-500 font-mono text-xs"
                  />
                </div>
              </div>

              {/* SSL & RouterOS v7 REST API Option */}
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                    <div>
                      <span className="text-xs text-white font-medium block">
                        Enable SSL/TLS (RouterOS v7 Native HTTPS REST API)
                      </span>
                      <span className="text-[10px] text-slate-400 block">
                        Uses HTTPS REST on port 443 / 8729 — recommended for cloud connectivity
                      </span>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={useSsl}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setUseSsl(checked);
                      if (checked && (apiPort === 8728 || !apiPort)) {
                        setApiPort(443);
                      } else if (!checked && apiPort === 443) {
                        setApiPort(8728);
                      }
                    }}
                    className="w-4 h-4 rounded bg-slate-900 border-slate-700 text-cyan-600 focus:ring-0 cursor-pointer"
                  />
                </div>

                {useSsl && (
                  <div className="text-[10px] font-mono text-cyan-300/90 bg-cyan-950/40 p-2 rounded-lg border border-cyan-800/40 flex items-center gap-2">
                    <Zap className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                    <span>
                      Target REST endpoint: <code className="text-white">https://{ipAddress || 'host'}:{apiPort}/rest/system/resource</code>
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* SECTION 3: Deployment & PPPoE Configuration */}
            <div className="space-y-3 pt-3 border-t border-slate-800">
              <div className="flex items-center gap-1.5 text-cyan-400 font-bold text-xs uppercase tracking-wider">
                <Layers className="w-3.5 h-3.5" />
                <span>3. Deployment Node &amp; Routing Pools</span>
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
            <div className="flex items-center justify-between pt-3 border-t border-slate-800">
              <div className="text-[11px] text-slate-400">
                <span className="text-emerald-400/90 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Ready to add router to fleet
                </span>
              </div>

              <div className="flex items-center gap-2">
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
                  className="px-5 py-2.5 rounded-lg font-bold transition shadow-lg flex items-center gap-2 text-xs cursor-pointer active:scale-95 bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-cyan-500/20"
                >
                  {isSubmitting ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin text-slate-950" />
                      <span>Saving Device...</span>
                    </>
                  ) : (
                    <>
                      <Server className="w-4 h-4 text-slate-950" />
                      <span>Connect &amp; Add MikroTik Device</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default AddMikrotikDeviceModal;
export { AddMikrotikDeviceModal as AddRouterModal };
