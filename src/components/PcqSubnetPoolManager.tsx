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
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Tv,
  Users,
  Zap,
} from 'lucide-react';
import { RouterAuthInfo } from '../services/apiClient';
import {
  BURST_TIME_OPTIONS,
  BurstTimeOption,
  CDN_TIER_RATE_MAP,
  CONTENTION_RATIOS,
  CalculatedQueuePlan,
  ContentionRatioOption,
  DEFAULT_CDN_GUARDRAIL_MBPS,
  DiscoveredPoolQueue,
  DiscoveredQueuesSnapshot,
  QueuePoolKey,
  RegularPriorityOption,
  applyCdnGuardrailToPlans,
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
  upstreamDedicatedMbps?: number;
  externalSelectedPool?: QueuePoolKey;
  poolSelectNonce?: number;
  onSnapshotUpdated?: (snapshot: DiscoveredQueuesSnapshot) => void;
  onNotify?: (text: string, type?: 'success' | 'error') => void;
}

export const PcqSubnetPoolManager: React.FC<PcqSubnetPoolManagerProps> = ({
  activeRouter,
  isAdmin = true,
  upstreamDedicatedMbps = 400,
  externalSelectedPool,
  poolSelectNonce = 0,
  onSnapshotUpdated,
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
    cdn: 6,
    other: 6,
  });
  const [poolBurstTimes, setPoolBurstTimes] = useState<Record<QueuePoolKey, BurstTimeOption>>({
    inn: '16s/16s',
    tw: '16s/16s',
    cdn: '8s/8s',
    other: '16s/16s',
  });
  const [regularPriority, setRegularPriority] = useState<RegularPriorityOption>(4);
  const [cdnGuardrailEnabled, setCdnGuardrailEnabled] = useState<boolean>(true);

  const [cardOverrides, setCardOverrides] = useState<Record<string, CardOverrideState>>({});
  const [busyQueueIds, setBusyQueueIds] = useState<Record<string, boolean>>({});
  const [isBulkApplying, setIsBulkApplying] = useState<boolean>(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [localToast, setLocalToast] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    if (externalSelectedPool && poolSelectNonce > 0) {
      setSelectedPool(externalSelectedPool);
    }
  }, [externalSelectedPool, poolSelectNonce]);

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
          onSnapshotUpdated?.(res.snapshot);
          setFetchError(null);

          // Automatically select an available pool tab if current Inn is empty
          setSelectedPool((prev) => {
            if (prev === 'inn' && res.snapshot!.innQueues.length === 0) {
              if (res.snapshot!.twQueues.length > 0) return 'tw';
              if (res.snapshot!.cdnQueues.length > 0) return 'cdn';
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
    [activeRouter, onSnapshotUpdated]
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
    if (selectedPool === 'cdn') return snapshot.cdnQueues;
    return snapshot.otherQueues;
  }, [snapshot, selectedPool]);

  const activePoolMeta = useMemo(() => {
    if (selectedPool === 'inn') {
      return {
        title: 'Multinet / Inn Pool',
        subnetBadge: '80.10.x.0/24 · Regular Internet',
        accentText: 'text-cyan-400',
        accentBg: 'bg-cyan-950/50 border-cyan-700/60',
      };
    }
    if (selectedPool === 'tw') {
      return {
        title: 'Transworld / TW Pool',
        subnetBadge: '60.10.x.0/24 · Regular Internet',
        accentText: 'text-indigo-400',
        accentBg: 'bg-indigo-950/50 border-indigo-700/60',
      };
    }
    if (selectedPool === 'cdn') {
      return {
        title: 'YouTube + Meta CDN Pool',
        subnetBadge: 'Auto-Detected CDN Queues · Priority 8 · Burst 8s/8s',
        accentText: 'text-rose-400',
        accentBg: 'bg-rose-950/40 border-rose-700/60',
      };
    }
    return {
      title: 'Other Subnet Queues',
      subnetBadge: 'Custom Subnets · Regular Internet',
      accentText: 'text-slate-300',
      accentBg: 'bg-slate-800/70 border-slate-700',
    };
  }, [selectedPool]);

  // Base plan calculator before CDN 240 Mbps guardrail
  const getBasePlanForQueue = useCallback(
    (queue: DiscoveredPoolQueue): CalculatedQueuePlan => {
      const ov = cardOverrides[queue.id] || {};
      const ratioDivisor = ov.ratio ?? poolRatios[queue.pool] ?? 6;
      const burstTime =
        ov.burstTime ??
        (ov.ratio ? getDefaultBurstTimeForRatio(ov.ratio, queue.isCdn) : poolBurstTimes[queue.pool]) ??
        getDefaultBurstTimeForRatio(ratioDivisor, queue.isCdn);

      return calculateQueueRatioPlan({
        activeUsers: queue.activeUsers,
        packageMbps: queue.packageMbps,
        ratioDivisor,
        isCdn: queue.isCdn,
        regularPriority,
        overrideMaxMbps: ov.overrideMaxMbps,
        burstTime,
      });
    },
    [cardOverrides, poolRatios, poolBurstTimes, regularPriority]
  );

  // Compute CDN Guardrail summary across all discovered CDN queues
  const cdnGuardrailSummary = useMemo(() => {
    const cdnQueues = snapshot?.cdnQueues || [];
    const items = cdnQueues.map((queue) => ({
      queue,
      plan: getBasePlanForQueue(queue),
    }));
    return applyCdnGuardrailToPlans(items, cdnGuardrailEnabled, DEFAULT_CDN_GUARDRAIL_MBPS);
  }, [snapshot?.cdnQueues, getBasePlanForQueue, cdnGuardrailEnabled]);

  const getPlanForQueue = useCallback(
    (queue: DiscoveredPoolQueue): CalculatedQueuePlan => {
      if (queue.isCdn) {
        const key = queue.id || queue.name;
        const guarded = cdnGuardrailSummary.plansById[key];
        if (guarded) return guarded;
      }
      return getBasePlanForQueue(queue);
    },
    [cdnGuardrailSummary.plansById, getBasePlanForQueue]
  );

  const handleSelectPoolRatio = (ratio: ContentionRatioOption) => {
    const isCdnPool = selectedPool === 'cdn';
    const defaultBurst = getDefaultBurstTimeForRatio(ratio, isCdnPool);
    setPoolRatios((prev) => ({ ...prev, [selectedPool]: ratio }));
    setPoolBurstTimes((prev) => ({ ...prev, [selectedPool]: defaultBurst }));

    // Guardrail auto-enables on 1:6, 1:8, 1:10 and defaults off on 1:1-1:4 so high-demand warning triggers clearly
    if (isCdnPool) {
      setCdnGuardrailEnabled(ratio >= 6);
    }

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
          `Applied 1:${plan.ratioDivisor}${queue.isCdn ? ' CDN' : ''} to "${queue.name}" -> max-limit ${res.payload['max-limit']}, limit-at ${res.payload['limit-at']}, burst ${res.payload['burst-limit']} (${res.payload['burst-time']}), priority ${res.payload.priority} · PCQ preserved.`,
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
      const priorityNote =
        selectedPool === 'cdn'
          ? `Priority 8/8${cdnGuardrailSummary.guardrailApplied ? ` · 240M Guardrail Active (${cdnGuardrailSummary.effectiveTotalMbps}M total)` : ''}`
          : `Priority ${regularPriority}/${regularPriority}`;
      emitToast(
        `Bulk Applied 1:${poolRatio} (${poolBurst} · ${priorityNote}) to all ${succeeded} queues in ${activePoolMeta.title}. Speed-PKT & per-user PCQ untouched.`,
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
  const totalCdnUsers = useMemo(
    () => (snapshot?.cdnQueues || []).reduce((acc, q) => acc + q.activeUsers, 0),
    [snapshot]
  );

  // Combined regular pool planned max-limit total for current selection visibility
  const activePoolTotalPlannedMbps = useMemo(
    () => activePoolQueues.reduce((sum, q) => sum + getPlanForQueue(q).poolMaxMbps, 0),
    [activePoolQueues, getPlanForQueue]
  );

  const cdnTierReferenceList = useMemo(
    () =>
      Object.entries(CDN_TIER_RATE_MAP)
        .map(([pkg, cdn]) => ({ pkg: Number(pkg), cdn }))
        .sort((a, b) => a.pkg - b.pkg),
    []
  );

  return (
    <div className="w-full max-w-full min-w-0 box-border bg-slate-900/90 border border-slate-800 rounded-xl p-4 sm:p-5 space-y-5 overflow-hidden">
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
                  {snapshot.excludedSpeedtestQueues.length} Speed-PKT Protected
                </span>
              </>
            )}
          </div>
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <Sliders className="w-4 h-4 text-cyan-400 shrink-0" />
            <span>Live MikroTik PCQ, CDN &amp; Subnet Pool Contention Manager</span>
          </h3>
          <p className="text-xs text-slate-400">
            Manage full <code className="text-slate-300">1:1</code>–<code className="text-slate-300">1:10</code> contention ratios for{' '}
            <strong className="text-cyan-300">Regular Internet Pools</strong> (Priority 4/5) and{' '}
            <strong className="text-rose-300">YouTube + Meta CDN Pools</strong> (Priority 8 · Burst 8s/8s) without modifying PCQ Queue Types or{' '}
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
                ? 'bg-sky-600 text-white border-sky-500 font-bold shadow-sm'
                : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700'
            }`}
          >
            <Network className="w-3.5 h-3.5" />
            <span>Multinet / Inn Pool (80.10.x.0/24)</span>
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                selectedPool === 'inn' ? 'bg-black/25 text-white' : 'bg-slate-800 text-cyan-300'
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
                ? 'bg-indigo-600 text-white border-indigo-500 font-bold shadow-sm'
                : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Transworld / TW Pool (60.10.x.0/24)</span>
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                selectedPool === 'tw' ? 'bg-black/25 text-white' : 'bg-slate-800 text-indigo-300'
              }`}
            >
              {snapshot?.twQueues.length ?? 0} queues · {totalTwUsers} online
            </span>
          </button>

          <button
            type="button"
            onClick={() => setSelectedPool('cdn')}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold border transition cursor-pointer flex items-center gap-2 ${
              selectedPool === 'cdn'
                ? 'bg-rose-600 text-white border-rose-500 font-bold shadow-sm'
                : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700'
            }`}
          >
            <Tv className="w-3.5 h-3.5" />
            <span>YouTube + Meta CDN Pool</span>
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                selectedPool === 'cdn' ? 'bg-black/25 text-white' : 'bg-slate-800 text-rose-300'
              }`}
            >
              {snapshot?.cdnQueues.length ?? 0} queues · {totalCdnUsers} online
            </span>
          </button>

          {snapshot && snapshot.otherQueues.length > 0 && (
            <button
              type="button"
              onClick={() => setSelectedPool('other')}
              className={`px-3.5 py-2 rounded-lg text-xs font-semibold border transition cursor-pointer flex items-center gap-2 ${
                selectedPool === 'other'
                  ? 'bg-slate-700 text-white border-slate-500 font-bold'
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

      {/* Pool-Level Bulk Contention Ratio, Priority & Auto-Burst Control Bar */}
      <div className={`p-4 rounded-xl border ${activePoolMeta.accentBg} space-y-3.5`}>
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Gauge className={`w-4 h-4 ${activePoolMeta.accentText}`} />
              <span className="text-xs font-bold text-white">
                {activePoolMeta.title} ({activePoolMeta.subnetBadge})
              </span>
              <span className="text-[11px] font-mono text-cyan-300">
                · Planned Pool Total: <strong>{activePoolTotalPlannedMbps} Mbps</strong>
              </span>
            </div>
            <p className="text-[11px] text-slate-300 font-mono">
              {selectedPool === 'cdn' ? (
                <>
                  CDN Formula: max-limit = max(Tier_CDN_Rate, ceil((Active × Tier_CDN_Rate) ÷ Ratio)) · limit-at = 50% · burst-limit = 125% · burst-threshold = 75% · burst-time = 8s/8s · Priority = 8
                </>
              ) : (
                <>
                  Regular Formula: max-limit = max(Tier, ceil(max(1, Active) × Tier ÷ Ratio)) · limit-at = 50% · burst-limit = 125% · burst-threshold = 75% · Priority = {regularPriority}/{regularPriority} (High)
                </>
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* All 6 Contention Ratio Selector Buttons */}
            <div className="flex flex-wrap items-center gap-1 bg-slate-950/90 border border-slate-800 rounded-lg p-1 max-w-full">
              <span className="text-[10px] font-mono text-slate-400 px-1.5">Contention Ratio:</span>
              {CONTENTION_RATIOS.map((r) => {
                const active = poolRatios[selectedPool] === r;
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => handleSelectPoolRatio(r)}
                    className={`px-2.5 py-1 rounded text-[11px] font-mono font-bold transition cursor-pointer ${
                      active
                        ? selectedPool === 'cdn'
                          ? 'bg-rose-600 text-white shadow-sm'
                          : 'bg-sky-600 text-white shadow-sm'
                        : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    1:{r}
                  </button>
                );
              })}
            </div>

            {/* Priority Selector (Regular: 4 or 5; CDN: Locked 8) */}
            {selectedPool === 'cdn' ? (
              <div className="flex items-center gap-1.5 bg-slate-950/90 border border-slate-800 rounded-lg px-2.5 py-1.5 text-[11px] font-mono">
                <span className="text-slate-400">Priority:</span>
                <span className="font-bold text-amber-300">8/8 (CDN Lowest)</span>
              </div>
            ) : (
              <div className="flex items-center gap-1 bg-slate-950/90 border border-slate-800 rounded-lg p-1 text-[11px] font-mono">
                <span className="text-[10px] text-slate-400 px-1.5">Priority:</span>
                {([4, 5] as RegularPriorityOption[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setRegularPriority(p)}
                    title="Higher priority than CDN (Priority 8) so browsing, WhatsApp, Zoom & gaming never lag"
                    className={`px-2 py-0.5 rounded font-bold transition cursor-pointer ${
                      regularPriority === p
                        ? 'bg-emerald-600 text-white'
                        : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    {p}/{p}
                  </button>
                ))}
              </div>
            )}

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

            {/* One-Click Bulk Apply Button */}
            {isAdmin && (
              <button
                type="button"
                onClick={handleApplyEntirePool}
                disabled={isBulkApplying || activePoolQueues.length === 0}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50 whitespace-nowrap shadow-sm"
              >
                <Zap className="w-3.5 h-3.5" />
                <span>
                  {isBulkApplying && bulkProgress
                    ? `Applying ${bulkProgress.done}/${bulkProgress.total}...`
                    : selectedPool === 'cdn'
                    ? `Apply Selected Ratio (1:${poolRatios.cdn}) to All CDN Queues (${activePoolQueues.length})`
                    : `Apply 1:${poolRatios[selectedPool]} to Entire Pool (${activePoolQueues.length})`}
                </span>
              </button>
            )}
          </div>
        </div>

        {/* CDN-Specific Guardrail + Tier Rate Strip */}
        {selectedPool === 'cdn' && (
          <div className="pt-3 border-t border-slate-800/70 space-y-3">
            {/* Tier CDN Rate Reference */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono text-slate-300">
              <span className="text-rose-300 font-bold">Per-User CDN Rates:</span>
              {cdnTierReferenceList.map((entry, idx) => (
                <span key={entry.pkg} className="tabular-nums">
                  {entry.pkg}M→<strong className="text-white">{entry.cdn}M</strong>
                  {idx < cdnTierReferenceList.length - 1 ? <span className="text-slate-600 ml-2">·</span> : null}
                </span>
              ))}
            </div>

            {/* 400 Mbps Link Protection Guardrail Control Card */}
            <div className="p-3.5 rounded-xl bg-slate-950/85 border border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="space-y-1.5 flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <ShieldCheck
                    className={`w-4 h-4 shrink-0 ${
                      cdnGuardrailEnabled ? 'text-emerald-400' : 'text-amber-400'
                    }`}
                  />
                  <span className="text-xs font-bold text-white">
                    {upstreamDedicatedMbps} Mbps Link Protection Guardrail (Max {DEFAULT_CDN_GUARDRAIL_MBPS} Mbps Combined CDN Cap)
                  </span>
                  <span className="text-[11px] font-mono text-slate-400">
                    · Effective CDN Total:{' '}
                    <strong
                      className={
                        cdnGuardrailSummary.effectiveTotalMbps > DEFAULT_CDN_GUARDRAIL_MBPS
                          ? 'text-amber-400'
                          : 'text-emerald-400'
                      }
                    >
                      {cdnGuardrailSummary.effectiveTotalMbps} Mbps
                    </strong>
                    {cdnGuardrailSummary.guardrailApplied && (
                      <span className="text-cyan-300">
                        {' '}
                        (Uncapped: {cdnGuardrailSummary.uncappedTotalMbps} Mbps → Capped at {DEFAULT_CDN_GUARDRAIL_MBPS} Mbps)
                      </span>
                    )}
                  </span>
                </div>

                {/* Progress bar against 240 Mbps ceiling on 400 Mbps upstream */}
                <div className="space-y-1">
                  <div className="relative h-2.5 w-full rounded-full bg-slate-900 border border-slate-800 overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${
                        cdnGuardrailSummary.effectiveTotalMbps > DEFAULT_CDN_GUARDRAIL_MBPS
                          ? 'bg-amber-500'
                          : 'bg-emerald-500'
                      }`}
                      style={{
                        width: `${Math.min(
                          100,
                          (cdnGuardrailSummary.effectiveTotalMbps / Math.max(1, upstreamDedicatedMbps)) * 100
                        )}%`,
                      }}
                    />
                    {/* 240 Mbps safe cap marker */}
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-rose-400"
                      style={{
                        left: `${Math.min(99, (DEFAULT_CDN_GUARDRAIL_MBPS / Math.max(1, upstreamDedicatedMbps)) * 100)}%`,
                      }}
                      title={`240 Mbps Safe CDN Ceiling on ${upstreamDedicatedMbps} Mbps Link`}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 tabular-nums">
                    <span>0 Mbps</span>
                    <span>
                      Safe CDN Cap: {DEFAULT_CDN_GUARDRAIL_MBPS} Mbps ({Math.round((DEFAULT_CDN_GUARDRAIL_MBPS / Math.max(1, upstreamDedicatedMbps)) * 100)}% of {upstreamDedicatedMbps}M)
                    </span>
                    <span>{upstreamDedicatedMbps} Mbps Link</span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setCdnGuardrailEnabled((prev) => !prev)}
                className={`px-3.5 py-2 rounded-lg text-xs font-bold border transition cursor-pointer shrink-0 flex items-center gap-2 ${
                  cdnGuardrailEnabled
                    ? 'bg-emerald-600 text-white border-emerald-500'
                    : 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Guardrail: {cdnGuardrailEnabled ? 'ENABLED (240M Cap)' : 'DISABLED (Uncapped)'}</span>
              </button>
            </div>

            {/* Amber Warning if 1:1, 1:2, 1:4 or uncapped selection exceeds 240 Mbps safe CDN ceiling */}
            {cdnGuardrailSummary.isOverCap && (
              <div
                className={`p-3 rounded-xl border text-xs flex items-start gap-2.5 ${
                  cdnGuardrailEnabled
                    ? 'bg-cyan-950/50 border-cyan-700/70 text-cyan-200'
                    : 'bg-amber-950/70 border-amber-600/80 text-amber-200'
                }`}
              >
                <ShieldAlert
                  className={`w-4 h-4 shrink-0 mt-0.5 ${
                    cdnGuardrailEnabled ? 'text-cyan-400' : 'text-amber-400'
                  }`}
                />
                <div className="space-y-0.5">
                  <div className="font-bold">
                    {cdnGuardrailEnabled
                      ? `240 Mbps Guardrail Active — Scaled ${cdnGuardrailSummary.uncappedTotalMbps} Mbps CDN demand down to ${cdnGuardrailSummary.effectiveTotalMbps} Mbps`
                      : `Warning: 1:${poolRatios.cdn} Uncapped CDN Demand (${cdnGuardrailSummary.uncappedTotalMbps} Mbps) Exceeds 240 Mbps Safe Ceiling on ${upstreamDedicatedMbps} Mbps Link`}
                  </div>
                  <p className="text-[11px] font-mono opacity-90">
                    {cdnGuardrailEnabled
                      ? `Reserves at least ${Math.max(0, upstreamDedicatedMbps - DEFAULT_CDN_GUARDRAIL_MBPS)} Mbps headroom on your ${upstreamDedicatedMbps} Mbps upstream for Priority ${regularPriority}/${regularPriority} Regular browsing, WhatsApp, Zoom & gaming.`
                      : `Pushing >240 Mbps across CDN queues can saturate your ${upstreamDedicatedMbps} Mbps upstream during peak hours. Enable the 240 Mbps Guardrail or select 1:6, 1:8, or 1:10.`}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Content Area: Loading / Error / Queue Cards */}
      {isLoading ? (
        <div className="py-12 flex flex-col items-center justify-center text-slate-400 font-mono text-xs gap-2 bg-slate-950/50 border border-slate-800 rounded-xl">
          <RefreshCw className="w-5 h-5 text-cyan-400 animate-spin" />
          <span>Discovering live Simple Queues, CDN Pools, PCQ Types &amp; PPPoE subnets via /api/mikrotik...</span>
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
            className="px-3.5 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs border border-rose-500 cursor-pointer shrink-0"
          >
            Retry Discovery
          </button>
        </div>
      ) : activePoolQueues.length === 0 ? (
        <div className="py-10 text-center bg-slate-950/50 border border-slate-800 rounded-xl space-y-1.5">
          <p className="text-xs font-semibold text-slate-300">
            No editable queues found in {activePoolMeta.title}.
          </p>
          <p className="text-[11px] font-mono text-slate-500">
            Verify Simple Queue names (CDN queues auto-match names containing &quot;CDN&quot; e.g. &quot;2 MB - CDN - TW&quot;, &quot;4 MB - CDN - Inn&quot;) or switch pools above.
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
                        {queue.isCdn ? ` → ${queue.cdnTierRateMbps}M CDN` : ''}
                      </span>
                      {queue.isCdn && (
                        <span className="px-1.5 py-0.5 rounded bg-rose-500/15 border border-rose-500/40 text-rose-300 font-mono font-bold text-[10px] uppercase">
                          {queue.sourcePool === 'inn' ? 'CDN · Inn' : queue.sourcePool === 'tw' ? 'CDN · TW' : 'CDN'}
                        </span>
                      )}
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
                        {queue.activeUsers === 0 ? (queue.isCdn ? ' (floor min)' : ' (1 min calc)') : ''}
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
                      <span>PCQ Preserved · Pri {queue.currentPriority}</span>
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
                <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 p-2.5 rounded-lg bg-slate-900/75 border border-slate-800/80 font-mono text-[11px] tabular-nums">
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
                  <div>
                    <span className="text-[10px] text-slate-500 block">Priority</span>
                    <span className="text-amber-300 font-bold">{queue.currentPriority}</span>
                  </div>
                </div>

                {/* Ratio Selector + Editable Max-Limit + Auto-Burst Preview */}
                <div className="space-y-3 p-3 rounded-lg bg-slate-900/50 border border-slate-800">
                  <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
                    <div className="flex flex-wrap items-center gap-1 min-w-0">
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
                                  burstTime: getDefaultBurstTimeForRatio(r, queue.isCdn),
                                  overrideMaxMbps: undefined,
                                },
                              }))
                            }
                            className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold border transition cursor-pointer ${
                              active
                                ? queue.isCdn
                                  ? 'bg-rose-600 text-white border-rose-500'
                                  : 'bg-sky-600 text-white border-sky-500'
                                : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-600'
                            }`}
                          >
                            1:{r}
                          </button>
                        );
                      })}
                    </div>

                    <div className="text-[10px] font-mono text-slate-400 tabular-nums">
                      {queue.isCdn ? (
                        <>
                          max({plan.tierRateMbps}M, ⌈({plan.activeUsers} × {plan.tierRateMbps}M) ÷ {plan.ratioDivisor}⌉) ={' '}
                          <span className="text-rose-300 font-bold">{plan.calculatedMaxMbps}M</span>
                          {plan.wasGuardrailCapped && (
                            <span className="text-amber-300 font-bold"> → Guardrail {plan.poolMaxMbps}M</span>
                          )}
                        </>
                      ) : (
                        <>
                          Demand: {plan.effectiveUsers} × {plan.packageMbps}M ={' '}
                          <span className="text-slate-200">{plan.rawDemandMbps}M</span> ÷ {plan.ratioDivisor} ={' '}
                          <span className="text-cyan-300 font-bold">{plan.calculatedMaxMbps}M</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Editable Pool Max-Limit & Auto-Burst Targets */}
                  <div className="grid grid-cols-2 sm:grid-cols-6 gap-2.5 items-end font-mono text-[11px] tabular-nums">
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

                    <div className="bg-slate-950/70 border border-slate-800 rounded px-2 py-1.5">
                      <span className="text-[10px] text-slate-500 block">Target Priority</span>
                      <span className={queue.isCdn ? 'text-amber-300 font-bold' : 'text-emerald-300 font-bold'}>
                        {plan.priorityString} {queue.isCdn ? '(CDN)' : '(High)'}
                      </span>
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
                      className="px-3.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50 shadow-sm"
                    >
                      <Zap className="w-3.5 h-3.5" />
                      <span>
                        {busyQueueIds[queue.id]
                          ? 'Applying...'
                          : queue.isCdn
                          ? 'Apply CDN Ratio & Priority'
                          : 'Apply Ratio & Burst'}
                      </span>
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
