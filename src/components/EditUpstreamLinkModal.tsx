import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  AlertTriangle,
  Network,
  RefreshCw,
  Save,
  X,
} from 'lucide-react';
import {
  supabase,
  SupabaseUpstreamCapacityConfig,
} from '../services/supabaseClient';
import { safeMikrotikFetch } from '../services/mikrotikRestClient';
import { useISP } from '../context/ISPContext';
import { useAuth } from '../context/AuthContext';

export interface MikrotikInterfaceOption {
  '.id'?: string;
  name?: string;
  type?: string;
  running?: string | boolean;
  comment?: string;
}

export interface EditUpstreamLinkModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: SupabaseUpstreamCapacityConfig;
  initialInterfaces?: MikrotikInterfaceOption[];
  onSaved: (updated: SupabaseUpstreamCapacityConfig) => void | Promise<void>;
}

export const EditUpstreamLinkModal: React.FC<EditUpstreamLinkModalProps> = ({
  isOpen,
  onClose,
  config,
  initialInterfaces = [],
  onSaved,
}) => {
  const [providerName, setProviderName] = useState<string>('Multinet Dedicated CIR');
  const [totalDedicatedMbps, setTotalDedicatedMbps] = useState<string>('50');
  const [contentionRatio, setContentionRatio] = useState<string>('6');
  const [warningThresholdPct, setWarningThresholdPct] = useState<string>('80');
  const [criticalThresholdPct, setCriticalThresholdPct] = useState<string>('92');
  const [wanInterfaceName, setWanInterfaceName] = useState<string>('ether1-WAN');

  const [interfaces, setInterfaces] = useState<MikrotikInterfaceOption[]>([]);
  const [isLoadingInterfaces, setIsLoadingInterfaces] = useState<boolean>(false);
  const [interfaceError, setInterfaceError] = useState<string | null>(null);
  const [isCustomInterface, setIsCustomInterface] = useState<boolean>(false);

  const { routers, selectedRouterId } = useISP();
  const { currentUser } = useAuth();
  const activeRouter = routers.find((r) => r.id === selectedRouterId) || routers[0];
  const isAdmin = !currentUser?.role || currentUser.role.toUpperCase() === 'ADMIN';

  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);

  const wasOpenRef = useRef<boolean>(false);
  const initialInterfacesRef = useRef<MikrotikInterfaceOption[]>(initialInterfaces);
  useEffect(() => {
    initialInterfacesRef.current = initialInterfaces;
  }, [initialInterfaces]);

  const loadMikrotikInterfaces = useCallback(async () => {
    setIsLoadingInterfaces(true);
    setInterfaceError(null);
    try {
      const res = await safeMikrotikFetch('/api/mikrotik/interface', {}, activeRouter);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      if (!Array.isArray(data)) {
        throw new Error('Unexpected response from /api/mikrotik/interface');
      }
      const filtered = (data as MikrotikInterfaceOption[]).filter((item) => {
        const name = String(item?.name || '').trim();
        return Boolean(name) && !name.startsWith('<pppoe-');
      });
      setInterfaces(filtered);
      if (filtered.length === 0) {
        setIsCustomInterface(true);
      }
    } catch {
      const fallback = (initialInterfacesRef.current || []).filter((item) => {
        const name = String(item?.name || '').trim();
        return Boolean(name) && !name.startsWith('<pppoe-');
      });
      setInterfaces(fallback);
      setInterfaceError('Could not reach live RouterOS /api/mikrotik/interface; using cached or manual input.');
      if (fallback.length === 0) {
        setIsCustomInterface(true);
      }
    } finally {
      setIsLoadingInterfaces(false);
    }
  }, [activeRouter]);

  // Initialize form fields ONLY when the modal transitions from closed -> open
  // so 3s background telemetry polling never overwrites user edits.
  useEffect(() => {
    if (!isOpen) {
      wasOpenRef.current = false;
      return;
    }
    if (wasOpenRef.current) return;
    wasOpenRef.current = true;

    const cleanWan = (config.wan_interface_name || 'ether1-WAN')
      .replace(/\s*\(Configured\)\s*$/i, '')
      .trim();

    setProviderName(config.provider_name || 'Multinet Dedicated CIR');
    setTotalDedicatedMbps(String(config.total_dedicated_mbps || 50));
    setContentionRatio(String(config.contention_ratio || 6));
    setWarningThresholdPct(String(config.warning_threshold_pct || 80));
    setCriticalThresholdPct(String(config.critical_threshold_pct || 92));
    setWanInterfaceName(cleanWan || 'ether1-WAN');
    setFormError(null);
    setIsCustomInterface(false);

    const cached = (initialInterfacesRef.current || []).filter((item) => {
      const name = String(item?.name || '').trim();
      return Boolean(name) && !name.startsWith('<pppoe-');
    });
    if (cached.length > 0) {
      setInterfaces(cached);
    }
    loadMikrotikInterfaces();
  }, [isOpen, config, loadMikrotikInterfaces]);

  if (!isOpen) return null;

  const dedicatedNum = Number(totalDedicatedMbps) || 0;
  const ratioNum = Number(contentionRatio) || 1;
  const warnNum = Number(warningThresholdPct) || 0;
  const critNum = Number(criticalThresholdPct) || 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!isAdmin) {
      setFormError('Administrator privileges are required to modify upstream capacity configuration.');
      return;
    }

    const cleanWanName = wanInterfaceName.replace(/\s*\(Configured\)\s*$/i, '').trim();

    if (!Number.isFinite(dedicatedNum) || dedicatedNum <= 0) {
      setFormError('Total Dedicated CIR (Mbps) must be greater than 0.');
      return;
    }
    if (!Number.isFinite(ratioNum) || ratioNum < 1) {
      setFormError('Contention ratio must be 1 or greater.');
      return;
    }
    if (!Number.isFinite(warnNum) || warnNum < 10 || warnNum > 98) {
      setFormError('Warning threshold must be between 10% and 98%.');
      return;
    }
    if (!Number.isFinite(critNum) || critNum <= warnNum || critNum > 100) {
      setFormError('Critical threshold must be greater than Warning threshold and at most 100%.');
      return;
    }
    if (!cleanWanName) {
      setFormError('Please select or enter a WAN interface name.');
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        provider_name: providerName.trim() || 'Multinet Dedicated CIR',
        total_dedicated_mbps: Number(dedicatedNum),
        contention_ratio: Number(ratioNum),
        warning_threshold_pct: Number(warnNum),
        critical_threshold_pct: Number(critNum),
        wan_interface_name: cleanWanName,
        updated_at: new Date().toISOString(),
      };

      let savedRecord: SupabaseUpstreamCapacityConfig | null = null;

      if (config?.id) {
        const { data, error } = await supabase
          .from('upstream_capacity_config')
          .update(payload)
          .eq('id', config.id)
          .select()
          .single();

        if (error) throw new Error(`Database Save Error: ${error.message}`);
        savedRecord = data as SupabaseUpstreamCapacityConfig;
      } else {
        const { data: existing } = await supabase
          .from('upstream_capacity_config')
          .select('id')
          .limit(1)
          .maybeSingle();

        if (existing?.id) {
          const { data, error } = await supabase
            .from('upstream_capacity_config')
            .update(payload)
            .eq('id', existing.id)
            .select()
            .single();

          if (error) throw new Error(`Database Save Error: ${error.message}`);
          savedRecord = data as SupabaseUpstreamCapacityConfig;
        } else {
          const { data, error } = await supabase
            .from('upstream_capacity_config')
            .insert([payload])
            .select()
            .single();

          if (error) throw new Error(`Database Save Error: ${error.message}`);
          savedRecord = data as SupabaseUpstreamCapacityConfig;
        }
      }

      if (savedRecord) {
        await onSaved(savedRecord);
      }
      onClose();
    } catch (err: any) {
      setFormError(err?.message || 'Failed to save upstream capacity configuration.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-upstream-modal-title"
    >
      <form
        onSubmit={handleSubmit}
        className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-5 space-y-4 shadow-2xl"
      >
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Network className="w-4 h-4 text-cyan-400" />
            <h3 id="edit-upstream-modal-title" className="font-bold text-white text-sm">
              Edit Upstream Link &amp; Contention Config
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg transition cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {formError && (
          <div className="p-2.5 rounded-lg bg-rose-950/80 border border-rose-700 text-rose-200 text-xs font-mono flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{formError}</span>
          </div>
        )}

        <div className="space-y-3.5 text-xs">
          {/* Provider Label */}
          <div>
            <label className="block text-slate-400 text-[11px] font-medium mb-1">
              Upstream Provider / Link Label
            </label>
            <input
              type="text"
              value={providerName}
              onChange={(e) => setProviderName(e.target.value)}
              placeholder="Multinet Dedicated CIR"
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-cyan-500"
            />
          </div>

          {/* Dedicated CIR + Contention Ratio */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-slate-400 text-[11px] font-medium">
                  Dedicated CIR (Mbps)
                </label>
                <div className="flex items-center gap-1 font-mono text-[10px]">
                  {[50, 100, 200].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setTotalDedicatedMbps(String(preset))}
                      className={`px-1.5 py-0.5 rounded border transition cursor-pointer ${
                        Number(totalDedicatedMbps) === preset
                          ? 'bg-cyan-600 text-slate-950 border-cyan-500 font-bold'
                          : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
                      }`}
                    >
                      {preset}M
                    </button>
                  ))}
                </div>
              </div>
              <input
                type="number"
                min={1}
                step="1"
                value={totalDedicatedMbps}
                onChange={(e) => setTotalDedicatedMbps(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono tabular-nums focus:outline-none focus:border-cyan-500"
                required
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-slate-400 text-[11px] font-medium">
                  Contention Ratio (1 : N)
                </label>
                <div className="flex items-center gap-1 font-mono text-[10px]">
                  {[4, 6, 8, 10].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setContentionRatio(String(preset))}
                      className={`px-1.5 py-0.5 rounded border transition cursor-pointer ${
                        Number(contentionRatio) === preset
                          ? 'bg-indigo-600 text-white border-indigo-500 font-bold'
                          : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
                      }`}
                    >
                      1:{preset}
                    </button>
                  ))}
                </div>
              </div>
              <input
                type="number"
                min={1}
                max={50}
                step="1"
                value={contentionRatio}
                onChange={(e) => setContentionRatio(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono tabular-nums focus:outline-none focus:border-cyan-500"
                required
              />
            </div>
          </div>

          {/* Warning & Critical Thresholds */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 text-[11px] font-medium mb-1">
                Warning Threshold (%)
              </label>
              <input
                type="number"
                min={10}
                max={98}
                step="1"
                value={warningThresholdPct}
                onChange={(e) => setWarningThresholdPct(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-amber-300 font-mono tabular-nums focus:outline-none focus:border-amber-500"
                required
              />
            </div>

            <div>
              <label className="block text-slate-400 text-[11px] font-medium mb-1">
                Critical Threshold (%)
              </label>
              <input
                type="number"
                min={15}
                max={100}
                step="1"
                value={criticalThresholdPct}
                onChange={(e) => setCriticalThresholdPct(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-rose-300 font-mono tabular-nums focus:outline-none focus:border-rose-500"
                required
              />
            </div>
          </div>

          {/* Live WAN Interface Dropdown from /api/mikrotik/interface */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label className="text-slate-400 text-[11px] font-medium">
                WAN Interface (MikroTik /api/mikrotik/interface)
              </label>
              <div className="flex items-center gap-2 font-mono text-[10px]">
                <button
                  type="button"
                  onClick={() => setIsCustomInterface((prev) => !prev)}
                  className="text-slate-400 hover:text-cyan-300 cursor-pointer"
                >
                  {isCustomInterface ? 'Use Dropdown' : 'Manual Entry'}
                </button>
                <button
                  type="button"
                  onClick={loadMikrotikInterfaces}
                  disabled={isLoadingInterfaces}
                  className="text-cyan-400 hover:text-cyan-300 flex items-center gap-1 cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3 h-3 ${isLoadingInterfaces ? 'animate-spin' : ''}`} />
                  <span>Refresh</span>
                </button>
              </div>
            </div>

            {!isCustomInterface && interfaces.length > 0 ? (
              <select
                value={wanInterfaceName}
                onChange={(e) => setWanInterfaceName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-cyan-500 cursor-pointer"
              >
                {!interfaces.some(
                  (i) => (i.name || '').toLowerCase() === wanInterfaceName.trim().toLowerCase()
                ) &&
                  wanInterfaceName.trim() && (
                    <option value={wanInterfaceName}>{wanInterfaceName} (Configured)</option>
                  )}
                {interfaces.map((iface) => {
                  const isUp = iface.running === 'true' || iface.running === true;
                  return (
                    <option key={iface['.id'] || iface.name} value={iface.name}>
                      {iface.name} · {iface.type || 'ether'}
                      {isUp ? ' · RUNNING' : ''}
                      {iface.comment ? ` (${iface.comment})` : ''}
                    </option>
                  );
                })}
              </select>
            ) : (
              <input
                type="text"
                value={wanInterfaceName}
                onChange={(e) => setWanInterfaceName(e.target.value)}
                placeholder="ether1-WAN"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-cyan-500"
                required
              />
            )}

            {interfaceError && (
              <p className="text-[11px] text-amber-400 font-mono">{interfaceError}</p>
            )}
          </div>

          {/* Live Calculated Capacity Summary */}
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 font-mono text-[11px] text-slate-300 flex flex-wrap items-center justify-between gap-2 tabular-nums">
            <span>
              Max Sold @ 1:{ratioNum}: <strong className="text-cyan-400">{(dedicatedNum * ratioNum).toLocaleString()} Mbps</strong>
            </span>
            <span>
              85% Safe Cap: <strong className="text-emerald-400">{(dedicatedNum * 0.85).toFixed(1)} Mbps</strong>
            </span>
            <span>
              Warn / Crit: <strong className="text-amber-300">{warnNum}%</strong> / <strong className="text-rose-400">{critNum}%</strong>
            </span>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold transition cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{isSaving ? 'Saving...' : 'Save Upstream Config'}</span>
          </button>
        </div>
      </form>
    </div>
  );
};

export default EditUpstreamLinkModal;
