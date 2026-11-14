import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Gauge,
  Layers,
  Lock,
  Network,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sliders,
  Users,
  Zap,
} from 'lucide-react';
import { RouterAuthInfo } from '../services/apiClient';
import {
  BURST_TIME_OPTIONS,
  BurstTimeOption,
  CONTENTION_RATIOS,
  ContentionRatioOption,
  DiscoveredPoolQueue,
  DiscoveredQueuesSnapshot,
  QueuePoolKey,
  applyRatioBurstToSimpleQueue,
  calculateQueueRatioPlan,
  fetchMikrotikQueuesSnapshot,
  getDefaultBurstTimeForRatio,
  resetSimpleQueueToUnlimited,
} from '../services/pcqQueueManager';

interface CardOverrideState {
  ratio?: ContentionRatioOption;
  overrideMaxMbps?: number;
  burstTime?: BurstTimeOption;
}

export interface PcqSubnetPoolManagerProps {
  activeRouter?: RouterAuthInfo & { name?: string; ip?: string; ipAddress?: string };
  isAdmin?: boolean;
  onNotify?: (text: string, type?: 'success' | 'error') => void;
}

export const PcqSubnetPoolManager: React.FC<PcqSubnetPoolManagerProps> = ({
  activeRouter,
  isAdmin = true,
  onNotify,
}) => {
  const [snapshot, setSnapshot] = useState<DiscoveredQueuesSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [selectedPool, setSelectedPool] = useState<QueuePoolKey>('inn');
  const [poolRatios, setPoolRatios] = useState<Record<QueuePoolKey, ContentionRatioOption>>({
    inn: 6,
    tw: 6,
    other: 6,
  });
  const [poolBurstTimes, setPoolBurstTimes] = useState<Record<QueuePoolKey, BurstTimeOption>>({
    inn: '16s/16s',
    tw: '16s/16s',
    other: '16s/16s',
  });

  const [cardOverrides, setCardOverrides] = useState<Record<string, CardOverrideState>>({});
  const [busyQueueIds, setBusyQueueIds] = useState<Record<string, boolean>>({});
  const [isBulkApplying, setIsBulkApplying] = useState<boolean>(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [localToast, setLocalToast] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const emitToast = useCallback(
    (text: string, type: 'success' | 'error' = 'success') => {
      setLocalToast({ text, type });
      onNotify?.(text, type);
      setTimeout(() => {
        setLocalToast((prev) => (prev?.text === text ? null : prev));
      }, 5500);
    },
    [onNotify]
  );

  const loadQueues = useCallback(
    async (showSpinner = false) => {
      if (showSpinner) setIsRefreshing(true);
      try {
        const res = await fetchMikrotikQueuesSnapshot(activeRouter);
        if (res.success && res.snapshot) {
          setSnapshot(res.snapshot);
          setFetchError(null);

          // Automatically switch tab if Inn is empty and TW has queues
          setSelectedPool((prev) => {
            if (prev === 'inn' && res.snapshot!.innQueues.length === 0 && res.snapshot!.twQueues.length > 0) {
              return 'tw';
            }
            return prev;
          });
        } else {
          setFetchError(res.error || 'Could not retrieve /rest/queue/simple from MikroTik proxy.');
        }
      } catch (err: any) {
        setFetchError(err?.message || 'Failed to fetch live Simple Queues.');
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [activeRouter]
  );

  useEffect(() => {
    loadQueues(false);
    const interval = setInterval(() => {
      if (typeof document === 'undefined' || !document.hidden) {
        loadQueues(false);
      }
    }, 25000);
    return () => clearInterval(interval);
  }, [loadQueues]);

  const activePoolQueues = useMemo(() => {
    if (!snapshot) return [];
    if (selectedPool === 'inn') return snapshot.innQueues;
    if (selectedPool === 'tw') return snapshot.twQueues;
    return snapshot.otherQueues;
  }, [snapshot, selectedPool]);

  const activePoolMeta = useMemo(() => {
    if (selectedPool === 'inn') {
      return {
        title: 'Multinet / Inn Pool',
        subnetBadge: '80.10.x.0/24',
        accentText: 'text-cyan-400',
        accentBg: 'bg-cyan-950/60 border-cyan-700/60',
      };
    }
    if (selectedPool === 'tw') {
      return {
        title: 'Transworld / TW Pool',
        subnetBadge: '60.10.x.0/24',
        accentText: 'text-indigo-400',
        accentBg: 'bg-indigo-950/60 border-indigo-700/60',
      };
    }
    return {
      title: 'Other Subnet Queues',
      subnetBadge: 'Custom Subnets',
      accentText: 'text-slate-300',
      accentBg: 'bg-slate-800/70 border-slate-700',
    };
  }, [selectedPool]);

  const getPlanForQueue = useCallback(
    (queue: DiscoveredPoolQueue) => {
      const ov = cardOverrides[queue.id] || {};
      const ratioDivisor = ov.ratio ?? poolRatios[queue.pool] ?? 6;
      const burstTime =
        ov.burstTime ??
        (ov.ratio ? getDefaultBurstTimeForRatio(ov.ratio) : poolBurstTimes[queue.pool]) ??
        getDefaultBurstTimeForRatio(ratioDivisor);

      return calculateQueueRatioPlan({
        activeUsers: queue.activeUsers,
        packageMbps: queue.packageMbps,
        ratioDivisor,
        overrideMaxMbps: ov.overrideMaxMbps,
        burstTime,
      });
    },
    [cardOverrides, poolRatios, poolBurstTimes]
  );

  const handleSelectPoolRatio = (ratio: ContentionRatioOption) => {
    const defaultBurst = getDefaultBurstTimeForRatio(ratio);
    setPoolRatios((prev) => ({ ...prev, [selectedPool]: ratio }));
    setPoolBurstTimes((prev) => ({ ...prev, [selectedPool]: defaultBurst }));

    // Clear per-card overrides for queues inside this pool so pool selection updates every card cleanly
    setCardOverrides((prev) => {
      const next = { ...prev };
      for (const q of activePoolQueues) {
        delete next[q.id];
      }
      return next;
    });
  };

  const handleSelectPoolBurstTime = (burst: BurstTimeOption) => {
    setPoolBurstTimes((prev) => ({ ...prev, [selectedPool]: burst }));
    setCardOverrides((prev) => {
      const next = { ...prev };
      for (const q of activePoolQueues) {
        if (next[q.id]) {
          next[q.id] = { ...next[q.id], burstTime: burst };
        }
      }
      return next;
    });
  };

  const handleApplySingleQueue = async (queue: DiscoveredPoolQueue) => {
    if (!isAdmin) return;
    const plan = getPlanForQueue(queue);
    setBusyQueueIds((prev) => ({ ...prev, [queue.id]: true }));
    try {
      const res = await applyRatioBurstToSimpleQueue(queue, plan, activeRouter);
      if (res.success) {
        emitToast(
          `Applied 1:${plan.ratioDivisor} to "${queue.name}" -> max-limit ${res.payload['max-limit']}, limit-at ${res.payload['limit-at']}, burst ${res.payload['burst-limit']} @ ${res.payload['burst-threshold']} (${res.payload['burst-time']}) · PCQ preserved.`,
          'success'
        );
        await loadQueues(false);
      } else {
        emitToast(res.error || `Failed to update "${queue.name}"`, 'error');
      }
    } finally {
      setBusyQueueIds((prev) => {
        const next = { ...prev };
        delete next[queue.id];
        return next;
      });
    }
  };

  const handleResetSingleQueue = async (queue: DiscoveredPoolQueue) => {
    if (!isAdmin) return;
    setBusyQueueIds((prev) => ({ ...prev, [queue.id]: true }));
    try {
      const res = await resetSimpleQueueToUnlimited(queue, activeRouter);
      if (res.success) {
        setCardOverrides((prev) => {
          const next = { ...prev };
          delete next[queue.id];
          return next;
        });
        emitToast(
          `Reset "${queue.name}" to Unlimited (0/0) for max-limit, limit-at, burst-limit, burst-threshold & burst-time · PCQ preserved.`,
          'success'
        );
        await loadQueues(false);
      } else {
        emitToast(res.error || `Failed to reset "${queue.name}" to 0/0`, 'error');
      }
    } finally {
      setBusyQueueIds((prev) => {
        const next = { ...prev };
        delete next[queue.id];
        return next;
      });
    }
  };

  const handleApplyEntirePool = async () => {
    if (!isAdmin || activePoolQueues.length === 0) return;
    const targetQueues = activePoolQueues.filter((q) => !q.isSpeedtest && q.id);
    if (targetQueues.length === 0) return;

    setIsBulkApplying(true);
    setBulkProgress({ done: 0, total: targetQueues.length });

    let succeeded = 0;
    let failed = 0;
    let lastError = '';

    // Batch concurrency of 3 so we don't overload RouterOS REST daemon
    const batchSize = 3;
    for (let i = 0; i < targetQueues.length; i += batchSize) {
      const chunk = targetQueues.slice(i, i + batchSize);
      const results = await Promise.all(
        chunk.map((q) => {
          const plan = getPlanForQueue(q);
          return applyRatioBurstToSimpleQueue(q, plan, activeRouter);
        })
      );
      for (const r of results) {
        if (r.success) succeeded++;
        else {
          failed++;
          lastError = r.error || lastError;
        }
      }
      setBulkProgress({ done: Math.min(targetQueues.length, i + chunk.length), total: targetQueues.length });
    }

    setIsBulkApplying(false);
    setBulkProgress(null);

    const poolRatio = poolRatios[selectedPool];
    const poolBurst = poolBurstTimes[selectedPool];

    if (failed === 0) {
      emitToast(
        `Bulk Applied 1:${poolRatio} (${poolBurst}) to all ${succeeded} queues in ${activePoolMeta.title} (${activePoolMeta.subnetBadge}). Speed-PKT & per-user PCQ untouched.`,
        'success'
      );
    } else {
      emitToast(
        `Pool sync finished: ${succeeded} updated, ${failed} failed${lastError ? ` (${lastError})` : ''}.`,
        succeeded > 0 ? 'success' : 'error'
      );
    }

    await loadQueues(false);
  };

  const totalInnUsers = useMemo(
    () => (snapshot?.innQueues || []).reduce((acc, q) => acc + q.activeUsers, 0),
    [snapshot]
  );
  const totalTwUsers = useMemo(
    () => (snapshot?.twQueues || []).reduce((acc, q) => acc + q.activeUsers, 0),
    [snapshot]
  );

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 space-y-5">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-slate-400">
            <span className="text-cyan-400 font-semibold">
              RouterOS v7 Simple Queues + PCQ
            </span>
            <span aria-hidden="true">·</span>
            <span>Proxy: /api/mikrotik/queue/simple</span>
            {activeRouter?.ip || activeRouter?.ipAddress ? (
              <>
                <span aria-hidden="true">·</span>
                <span>Target: {activeRouter.ip || activeRouter.ipAddress}</span>
              </>
            ) : null}
            {snapshot && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-emerald-400 inline-flex items-center gap-1">
                  <Lock className="w-3 h-3" />
                  {snapshot.excludedSpeedtestQueues.length} Speed-PKT Queues Protected
                </span>
              </>
            )}
          </div>
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <Sliders className="w-4 h-4 text-cyan-400 shrink-0" />
            <span>Live MikroTik PCQ &amp; Subnet Pool Ratio / Auto-Burst Manager</span>
          </h3>
          <p className="text-xs text-slate-400">
            Manage contention ratios (<code className="text-slate-300">1:1</code> to{' '}
            <code className="text-slate-300">1:10</code>) and push calculated{' '}
            <code className="text-slate-300">max-limit</code>, <code className="text-slate-300">limit-at</code>, and{' '}
            <code className="text-slate-300">burst</code> caps onto <strong className="text-cyan-300">Inn</strong> (80.10.x.0/24) and{' '}
            <strong className="text-indigo-300">TW</strong> (60.10.x.0/24) subnet queues without touching per-user PCQ rates or{' '}
            <code className="text-emerald-300">Speed-PKT</code> queues.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => loadQueues(true)}
            disabled={isRefreshing || isBulkApplying}
            className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold text-xs flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50 whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>Refresh Live Queues</span>
          </button>
        </div>
      </div>

      {/* Inline Instant Confirmation Toast */}
      {localToast && (
        <div
          className={`p-3 rounded-xl border font-mono text-xs flex items-center gap-2 ${
            localToast.type === 'error'
              ? 'bg-rose-950/90 border-rose-700 text-rose-200'
              : 'bg-emerald-950/90 border-emerald-700 text-emerald-200'
          }`}
        >
          {localToast.type === 'error' ? (
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          )}
          <span>{localToast.text}</span>
        </div>
      )}

      {/* Pool Selector Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSelectedPool('inn')}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold border transition cursor-pointer flex items-center gap-2 ${
              selectedPool === 'inn'
                ? 'bg-cyan-600 text-slate-950 border-cyan-500 font-bold'
                : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700'
            }`}
          >
            <Network className="w-3.5 h-3.5" />
            <span>Multinet / Inn Pool (80.10.x.0/24)</span>
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                selectedPool === 'inn' ? 'bg-slate-950/20 text-slate-950' : 'bg-slate-800 text-cyan-300'
              }`}
            >
              {snapshot?.innQueues.length ?? 0} queues · {totalInnUsers} online
            </span>
          </button>

          <button
            type="button"
            onClick={() => setSelectedPool('tw')}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold border transition cursor-pointer flex items-center gap-2 ${
              selectedPool === 'tw'
                ? 'bg-indigo-500 text-slate-950 border-indigo-400 font-bold'
                : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Transworld / TW Pool (60.10.x.0/24)</span>
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                selectedPool === 'tw' ? 'bg-slate-950/20 text-slate-950' : 'bg-slate-800 text-indigo-300'
              }`}
            >
              {snapshot?.twQueues.length ?? 0} queues · {totalTwUsers} online
            </span>
          </button>

          {snapshot && snapshot.otherQueues.length > 0 && (
            <button
              type="button"
              onClick={() => setSelectedPool('other')}
              className={`px-3.5 py-2 rounded-lg text-xs font-semibold border transition cursor-pointer flex items-center gap-2 ${
                selectedPool === 'other'
                  ? 'bg-slate-200 text-slate-950 border-white font-bold'
                  : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700'
              }`}
            >
              <span>Other Queues</span>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-300">
                {snapshot.otherQueues.length}
              </span>
            </button>
          )}
        </div>

        {snapshot && snapshot.excludedSpeedtestQueues.length > 0 && (
          <div
            className="text-[11px] font-mono text-emerald-300 bg-emerald-950/50 border border-emerald-800/60 rounded-lg px-3 py-1.5 flex items-center gap-1.5"
            title={`Protected queues: ${snapshot.excludedSpeedtestQueues.map((q) => q.name).join(', ')}`}
          >
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>
              Speed-PKT Excluded: {snapshot.excludedSpeedtestQueues.map((q) => q.name).slice(0, 2).join(', ')}
              {snapshot.excludedSpeedtestQueues.length > 2
                ? ` +${snapshot.excludedSpeedtestQueues.length - 2} more`
                : ''}
            </span>
          </div>
        )}
      </div>

      {/* Pool-Level Bulk Contention Ratio & Auto-Burst Control Bar */}
      <div className={`p-4 rounded-xl border ${activePoolMeta.accentBg} flex flex-col xl:flex-row xl:items-center justify-between gap-4`}>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Gauge className={`w-4 h-4 ${activePoolMeta.accentText}`} />
            <span className="text-xs font-bold text-white">
              Pool-Level Bulk Ratio &amp; Burst — {activePoolMeta.title} ({activePoolMeta.subnetBadge})
            </span>
          </div>
          <p className="text-[11px] text-slate-300 font-mono">
            Formula: max-limit = max(Tier, ceil(max(1, Active) × Tier ÷ Ratio)) · limit-at = 50% · burst-limit = 125% · burst-threshold = 75%
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Ratio Selector Buttons */}
          <div className="flex items-center gap-1 bg-slate-950/90 border border-slate-800 rounded-lg p-1">
            <span className="text-[10px] font-mono text-slate-400 px-1.5">Ratio:</span>
            {CONTENTION_RATIOS.map((r) => {
              const active = poolRatios[selectedPool] === r;
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => handleSelectPoolRatio(r)}
                  className={`px-2 py-1 rounded text-[11px] font-mono font-bold transition cursor-pointer ${
                    active
                      ? 'bg-cyan-500 text-slate-950'
                      : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  1:{r}
                </button>
              );
            })}
          </div>

          {/* Pool Burst Time Selector */}
          <div className="flex items-center gap-1.5 bg-slate-950/90 border border-slate-800 rounded-lg px-2.5 py-1">
            <span className="text-[10px] font-mono text-slate-400">Burst Time:</span>
            <select
              value={poolBurstTimes[selectedPool]}
              onChange={(e) => handleSelectPoolBurstTime(e.target.value as BurstTimeOption)}
              className="bg-transparent text-xs font-mono font-bold text-cyan-300 focus:outline-none cursor-pointer"
            >
              {BURST_TIME_OPTIONS.map((opt) => (
                <option key={opt} value={opt} className="bg-slate-900 text-white">
                  {opt}
                </option>
              ))}
            </select>
          </div>

          {/* Apply to Entire Pool Button */}
          {isAdmin && (
            <button
              type="button"
              onClick={handleApplyEntirePool}
              disabled={isBulkApplying || activePoolQueues.length === 0}
              className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50 whitespace-nowrap"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>
                {isBulkApplying && bulkProgress
                  ? `Applying ${bulkProgress.done}/${bulkProgress.total}...`
                  : `Apply to Entire Pool (${activePoolQueues.length})`}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Content Area: Loading / Error / Queue Cards */}
      {isLoading ? (
        <div className="py-12 flex flex-col items-center justify-center text-slate-400 font-mono text-xs gap-2 bg-slate-950/50 border border-slate-800 rounded-xl">
          <RefreshCw className="w-5 h-5 text-cyan-400 animate-spin" />
          <span>Discovering live Simple Queues, PCQ Queue Types &amp; PPPoE subnets via /api/mikrotik...</span>
        </div>
      ) : fetchError && !snapshot ? (
        <div className="p-5 rounded-xl bg-rose-950/50 border border-rose-800/80 text-rose-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-bold text-xs text-white">Unable to Discover RouterOS Simple Queues</div>
              <p className="font-mono text-[11px] text-rose-200/90">{fetchError}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => loadQueues(true)}
            className="px-3.5 py-2 rounded-lg bg-rose-900/70 hover:bg-rose-800 text-white font-semibold text-xs border border-rose-700 cursor-pointer shrink-0"
          >
            Retry Discovery
          </button>
        </div>
      ) : activePoolQueues.length === 0 ? (
        <div className="py-10 text-center bg-slate-950/50 border border-slate-800 rounded-xl space-y-1.5">
          <p className="text-xs font-semibold text-slate-300">
            No editable queues found in {activePoolMeta.title} ({activePoolMeta.subnetBadge}).
          </p>
          <p className="text-[11px] font-mono text-slate-500">
            Verify Simple Queue names/targets on RouterOS or switch pools above. Any Speed-PKT queues are automatically hidden &amp; protected.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {activePoolQueues.map((queue) => {
            const plan = getPlanForQueue(queue);
            const isBusy = Boolean(busyQueueIds[queue.id]) || isBulkApplying;
            const ov = cardOverrides[queue.id] || {};

            return (
              <div
                key={queue.id || queue.name}
                className="bg-slate-950/85 border border-slate-800 hover:border-slate-700 rounded-xl p-4 space-y-3.5 transition"
              >
                {/* Card Top Header */}
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-cyan-500/15 border border-cyan-500/40 text-cyan-300 font-mono font-bold text-[11px]">
                        {queue.packageLabel}
                      </span>
                      <h4 className="text-sm font-bold text-white">{queue.name}</h4>
                      {queue.disabled && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-950 border border-amber-700 text-amber-300 text-[10px] font-mono">
                          Disabled
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-slate-400">
                      <span className="text-slate-300">{queue.target}</span>
                      <span aria-hidden="true">·</span>
                      <span className="inline-flex items-center gap-1 text-emerald-400 font-semibold">
                        <Users className="w-3 h-3" />
                        {queue.activeUsers} Online
                        {queue.activeUsers === 0 ? ' (1 min calc)' : ''}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="inline-flex items-center gap-1 text-cyan-300">
                        <Activity className="w-3 h-3" />
                        DL {queue.liveRate.downloadMbps.toFixed(2)}M / UL {queue.liveRate.uploadMbps.toFixed(2)}M
                      </span>
                    </div>
                  </div>

                  {/* Preserved PCQ Type Badge */}
                  <div className="text-right font-mono text-[10px] bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 space-y-0.5">
                    <div className="text-emerald-400 font-semibold flex items-center justify-end gap-1">
                      <Lock className="w-2.5 h-2.5" />
                      <span>PCQ Preserved</span>
                    </div>
                    <div className="text-slate-300">
                      UL: <span className="text-white">{queue.uploadQueueType}</span> ({queue.uploadPcqRateLabel})
                    </div>
                    <div className="text-slate-300">
                      DL: <span className="text-white">{queue.downloadQueueType}</span> ({queue.downloadPcqRateLabel})
                    </div>
                  </div>
                </div>

                {/* Live RouterOS Active Settings */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 p-2.5 rounded-lg bg-slate-900/75 border border-slate-800/80 font-mono text-[11px] tabular-nums">
                  <div>
                    <span className="text-[10px] text-slate-500 block">Current max-limit</span>
                    <span className={queue.currentMaxLimit.isUnlimited ? 'text-slate-400' : 'text-cyan-300 font-bold'}>
                      {queue.currentMaxLimit.displayLabel}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 block">Current limit-at</span>
                    <span className="text-slate-200">{queue.currentLimitAt.displayLabel}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 block">Burst limit</span>
                    <span className="text-slate-200">{queue.currentBurstLimit.displayLabel}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 block">Burst thresh</span>
                    <span className="text-slate-200">{queue.currentBurstThreshold.displayLabel}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 block">Burst time</span>
                    <span className="text-slate-200">{queue.currentBurstTime}</span>
                  </div>
                </div>

                {/* Ratio Selector + Editable Max-Limit + Auto-Burst Preview */}
                <div className="space-y-3 p-3 rounded-lg bg-slate-900/50 border border-slate-800">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1">
                      <span className="text-[11px] font-mono text-slate-400 mr-1">Ratio:</span>
                      {CONTENTION_RATIOS.map((r) => {
                        const active = plan.ratioDivisor === r;
                        return (
                          <button
                            key={r}
                            type="button"
                            onClick={() =>
                              setCardOverrides((prev) => ({
                                ...prev,
                                [queue.id]: {
                                  ratio: r,
                                  burstTime: getDefaultBurstTimeForRatio(r),
                                  overrideMaxMbps: undefined,
                                },
                              }))
                            }
                            className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold border transition cursor-pointer ${
                              active
                                ? 'bg-cyan-500 text-slate-950 border-cyan-400'
                                : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-600'
                            }`}
                          >
                            1:{r}
                          </button>
                        );
                      })}
                    </div>

                    <div className="text-[10px] font-mono text-slate-400 tabular-nums">
                      Demand: {plan.effectiveUsers} × {plan.packageMbps}M ={' '}
                      <span className="text-slate-200">{plan.rawDemandMbps}M</span> ÷ {plan.ratioDivisor} ={' '}
                      <span className="text-cyan-300 font-bold">{plan.calculatedMaxMbps}M</span>
                    </div>
                  </div>

                  {/* Editable Pool Max-Limit & Auto-Burst Targets */}
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 items-end font-mono text-[11px] tabular-nums">
                    <div>
                      <label className="text-[10px] text-cyan-400 font-semibold block mb-1">
                        max-limit (Mbps)
                      </label>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={ov.overrideMaxMbps ?? plan.poolMaxMbps}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10);
                          setCardOverrides((prev) => ({
                            ...prev,
                            [queue.id]: {
                              ...prev[queue.id],
                              ratio: plan.ratioDivisor,
                              overrideMaxMbps: Number.isFinite(val) && val > 0 ? val : undefined,
                            },
                          }));
                        }}
                        className="w-full px-2 py-1.5 rounded bg-slate-950 border border-cyan-700/70 text-white font-bold text-xs focus:outline-none focus:border-cyan-400"
                      />
                    </div>

                    <div className="bg-slate-950/70 border border-slate-800 rounded px-2 py-1.5">
                      <span className="text-[10px] text-slate-500 block">limit-at (50%)</span>
                      <span className="text-emerald-300 font-bold">
                        {plan.limitAtMbps}M/{plan.limitAtMbps}M
                      </span>
                    </div>

                    <div className="bg-slate-950/70 border border-slate-800 rounded px-2 py-1.5">
                      <span className="text-[10px] text-slate-500 block">burst-limit (125%)</span>
                      <span className="text-indigo-300 font-bold">
                        {plan.burstLimitMbps}M/{plan.burstLimitMbps}M
                      </span>
                    </div>

                    <div className="bg-slate-950/70 border border-slate-800 rounded px-2 py-1.5">
                      <span className="text-[10px] text-slate-500 block">burst-thresh (75%)</span>
                      <span className="text-amber-300 font-bold">
                        {plan.burstThresholdMbps}M/{plan.burstThresholdMbps}M
                      </span>
                    </div>

                    <div>
                      <label className="text-[10px] text-slate-400 block mb-1">burst-time</label>
                      <select
                        value={plan.burstTime}
                        onChange={(e) =>
                          setCardOverrides((prev) => ({
                            ...prev,
                            [queue.id]: {
                              ...prev[queue.id],
                              ratio: plan.ratioDivisor,
                              burstTime: e.target.value as BurstTimeOption,
                            },
                          }))
                        }
                        className="w-full px-2 py-1.5 rounded bg-slate-950 border border-slate-700 text-cyan-300 font-bold text-xs focus:outline-none cursor-pointer"
                      >
                        {BURST_TIME_OPTIONS.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                {/* Action Footer */}
                {isAdmin && (
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => handleResetSingleQueue(queue)}
                      disabled={isBusy}
                      className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-rose-950/70 text-slate-300 hover:text-rose-200 border border-slate-700 hover:border-rose-700/70 font-semibold text-xs flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Reset to Unlimited (0/0)</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleApplySingleQueue(queue)}
                      disabled={isBusy}
                      className="px-3.5 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
                    >
                      <Zap className="w-3.5 h-3.5" />
                      <span>{busyQueueIds[queue.id] ? 'Applying...' : 'Apply Ratio & Burst'}</span>
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default PcqSubnetPoolManager;
