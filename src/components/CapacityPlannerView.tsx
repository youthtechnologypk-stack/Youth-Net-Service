import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Edit3,
  Gauge,
  Layers,
  MapPin,
  Network,
  Radio,
  RefreshCw,
  Search,
  Server,
  ShieldAlert,
  Sliders,
  TrendingUp,
  Tv,
  Users,
  X,
} from 'lucide-react';
import {
  supabase,
  SupabasePortalUser,
  SupabaseUpstreamCapacityConfig,
} from '../services/supabaseClient';
import {
  NetworkAreaNode,
  PARENT_FLEET_ROUTER,
  fetchNetworkAreas,
  fetchMikrotikInterfaceTrafficOnce,
  resolveAreaFromUsername,
} from '../lib/billingAndNetwork';
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from 'recharts';
import { EditUpstreamLinkModal } from './EditUpstreamLinkModal';
import { AreaNodeManagerModal } from './AreaNodeManagerModal';
import { PcqSubnetPoolManager } from './PcqSubnetPoolManager';
import { safeMikrotikFetch } from '../services/mikrotikRestClient';
import { useISP } from '../context/ISPContext';
import { useAuth } from '../context/AuthContext';
import {
  CONTENTION_RATIOS,
  ContentionRatioOption,
  DEFAULT_CDN_GUARDRAIL_MBPS,
  DiscoveredQueuesSnapshot,
  MikrotikQueueTypeRaw,
  MikrotikSimpleQueueRaw,
  QueuePoolKey,
  buildDiscoveredQueuesSnapshot,
  calculateQueueRatioPlan,
  getCdnTierRateMbps,
  isCdnQueueName,
} from '../services/pcqQueueManager';

interface MikrotikInterfaceRow {
  '.id'?: string;
  name?: string;
  type?: string;
  running?: string | boolean;
  'rx-byte'?: string | number;
  'tx-byte'?: string | number;
  comment?: string;
}

interface MikrotikPppSecret {
  '.id'?: string;
  name?: string;
  profile?: string;
  disabled?: string | boolean;
  comment?: string;
}

interface MikrotikPppActive {
  '.id'?: string;
  name?: string;
  address?: string;
  uptime?: string;
  'caller-id'?: string;
}

interface InterfaceByteSnapshot {
  rxBytes: number;
  txBytes: number;
  timestampMs: number;
}

interface WanTrafficPoint {
  time: string;
  rxMbps: number;
  txMbps: number;
  totalTrafficMbps: number;
}

const DEFAULT_CONFIG: SupabaseUpstreamCapacityConfig = {
  id: '',
  provider_name: 'Multinet Dedicated CIR',
  total_dedicated_mbps: 400,
  contention_ratio: 6,
  warning_threshold_pct: 80,
  critical_threshold_pct: 92,
  wan_interface_name: 'ether1-WAN',
};

const PEAK_CONCURRENT_CAP_STORAGE_KEY = 'netpulse_peak_concurrent_cap';
const DEFAULT_PEAK_CONCURRENT_CAP = 390;

/**
 * Extracts package bandwidth in Mbps from strings like "20Mbps", "15M", "50 Mbps Unlimited"
 */
function parsePackageSpeedMbps(raw?: string | null): number {
  const clean = (raw || '').trim();
  if (!clean) return 0;
  const match = clean.match(/(\d+(?:\.\d+)?)/);
  if (!match) return 0;
  const num = Number(match[1]);
  return Number.isFinite(num) && num > 0 ? num : 0;
}

function normalizePackageTierLabel(raw?: string | null): string {
  const speed = parsePackageSpeedMbps(raw);
  if (speed > 0) return `${speed} Mbps`;
  const clean = (raw || '').trim();
  return clean || 'Standard';
}

export const CapacityPlannerView: React.FC = () => {
  const { routers, selectedRouterId } = useISP();
  const { currentUser } = useAuth();
  const activeRouter = routers.find((r) => r.id === selectedRouterId) || routers[0];
  const isAdmin = !currentUser?.role || currentUser.role.toUpperCase() === 'ADMIN';

  // Config state from Supabase `upstream_capacity_config`
  const [config, setConfig] = useState<SupabaseUpstreamCapacityConfig>(DEFAULT_CONFIG);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  // Edit Upstream Link & Area Manager modal state
  const [isEditModalOpen, setIsEditModalOpen] = useState<boolean>(false);
  const [isAreaManagerOpen, setIsAreaManagerOpen] = useState<boolean>(false);
  const [saveNotice, setSaveNotice] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Live MikroTik & Supabase datasets
  const [interfaces, setInterfaces] = useState<MikrotikInterfaceRow[]>([]);
  const [pppSecrets, setPppSecrets] = useState<MikrotikPppSecret[]>([]);
  const [pppActive, setPppActive] = useState<MikrotikPppActive[]>([]);
  const [portalClients, setPortalClients] = useState<SupabasePortalUser[]>([]);
  const [networkAreas, setNetworkAreas] = useState<NetworkAreaNode[]>([]);

  // Live WAN throughput, rolling 30-point chart series, & per-user rate deltas
  const [liveDownloadMbps, setLiveDownloadMbps] = useState<number>(0);
  const [liveUploadMbps, setLiveUploadMbps] = useState<number>(0);
  const [peakDownloadMbps, setPeakDownloadMbps] = useState<number>(0);
  const [trafficSeries, setTrafficSeries] = useState<WanTrafficPoint[]>([]);
  const [lastPolledAt, setLastPolledAt] = useState<string>('');
  const [mikrotikReachable, setMikrotikReachable] = useState<boolean>(true);

  const prevInterfaceBytesRef = useRef<Record<string, InterfaceByteSnapshot>>({});
  const [userLiveMbps, setUserLiveMbps] = useState<Record<string, number>>({});
  const mohallahPeakMbpsRef = useRef<Record<string, number>>({});

  // Auto-scanned MikroTik Simple Queues snapshot (grouping 'CDN' queues into YouTube + Meta CDN Pool)
  const [simpleQueuesSnapshot, setSimpleQueuesSnapshot] = useState<DiscoveredQueuesSnapshot | null>(null);
  const [poolManagerTargetPool, setPoolManagerTargetPool] = useState<QueuePoolKey | undefined>(undefined);
  const [poolManagerSelectNonce, setPoolManagerSelectNonce] = useState<number>(0);
  const poolManagerSectionRef = useRef<HTMLDivElement | null>(null);

  // Filtering & Real-world Peak Concurrent Calibration (default 390 max concurrent online)
  const [areaSearch, setAreaSearch] = useState<string>('');
  const [showAllAreas, setShowAllAreas] = useState<boolean>(true);
  const [peakConcurrentCap, setPeakConcurrentCap] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = Number(localStorage.getItem(PEAK_CONCURRENT_CAP_STORAGE_KEY));
      if (Number.isFinite(saved) && saved >= 1) return Math.round(saved);
    }
    return DEFAULT_PEAK_CONCURRENT_CAP;
  });
  const [isUpdatingRatio, setIsUpdatingRatio] = useState<boolean>(false);

  const handleUpdatePeakCap = useCallback((rawVal: number) => {
    const clamped = Number.isFinite(rawVal) && rawVal >= 1 ? Math.min(10000, Math.round(rawVal)) : DEFAULT_PEAK_CONCURRENT_CAP;
    setPeakConcurrentCap(clamped);
    if (typeof window !== 'undefined') {
      localStorage.setItem(PEAK_CONCURRENT_CAP_STORAGE_KEY, String(clamped));
    }
  }, []);

  const showToast = useCallback((text: string, type: 'success' | 'error' = 'success') => {
    setSaveNotice({ text, type });
    setTimeout(() => setSaveNotice(null), 4500);
  }, []);

  // Dedicated Supabase fetch for upstream_capacity_config (no localStorage override)
  const fetchUpstreamConfig = useCallback(async () => {
    const { data, error } = await supabase
      .from('upstream_capacity_config')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data && !error) {
      const loaded = data as SupabaseUpstreamCapacityConfig;
      setConfig({
        id: loaded.id,
        provider_name: loaded.provider_name ?? DEFAULT_CONFIG.provider_name,
        total_dedicated_mbps: Number(loaded.total_dedicated_mbps) || DEFAULT_CONFIG.total_dedicated_mbps,
        contention_ratio: Number(loaded.contention_ratio) || DEFAULT_CONFIG.contention_ratio,
        warning_threshold_pct: Number(loaded.warning_threshold_pct) || DEFAULT_CONFIG.warning_threshold_pct,
        critical_threshold_pct: Number(loaded.critical_threshold_pct) || DEFAULT_CONFIG.critical_threshold_pct,
        wan_interface_name: (loaded.wan_interface_name || DEFAULT_CONFIG.wan_interface_name)
          .replace(/\s*\(Configured\)\s*$/i, '')
          .trim(),
        updated_at: loaded.updated_at,
      });
    }
  }, []);

  // Load Supabase config, portal_users, network_areas, and MikroTik secrets/active/queues
  const fetchPlannerDatasets = useCallback(async (showSpinner = false) => {
    if (showSpinner) setIsRefreshing(true);
    try {
      const [, usersRes, areasRes, secretsRes, activeRes, ifaceRes, simpleQueuesRes, queueTypesRes] = await Promise.all([
        fetchUpstreamConfig(),
        supabase.from('portal_users').select('*').eq('role', 'CLIENT'),
        fetchNetworkAreas(),
        safeMikrotikFetch('/api/mikrotik/ppp/secret', {}, activeRouter).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        safeMikrotikFetch('/api/mikrotik/ppp/active', {}, activeRouter).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        safeMikrotikFetch('/api/mikrotik/interface', {}, activeRouter).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        safeMikrotikFetch('/api/mikrotik/queue/simple', {}, activeRouter).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        safeMikrotikFetch('/api/mikrotik/queue/type', {}, activeRouter).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);

      if (Array.isArray(usersRes.data)) {
        setPortalClients(usersRes.data as SupabasePortalUser[]);
      }
      if (Array.isArray(areasRes)) {
        setNetworkAreas(areasRes);
      }
      if (Array.isArray(secretsRes)) {
        setPppSecrets(secretsRes as MikrotikPppSecret[]);
        setMikrotikReachable(true);
      } else if (secretsRes === null && activeRes === null && ifaceRes === null) {
        setMikrotikReachable(false);
      }
      if (Array.isArray(activeRes)) {
        setPppActive(activeRes as MikrotikPppActive[]);
      }
      if (Array.isArray(ifaceRes)) {
        setInterfaces(ifaceRes as MikrotikInterfaceRow[]);
      }
      if (Array.isArray(simpleQueuesRes)) {
        const snapshot = buildDiscoveredQueuesSnapshot({
          rawQueues: simpleQueuesRes as MikrotikSimpleQueueRaw[],
          queueTypes: Array.isArray(queueTypesRes) ? (queueTypesRes as MikrotikQueueTypeRaw[]) : [],
          activeSessions: Array.isArray(activeRes) ? (activeRes as MikrotikPppActive[]) : [],
        });
        setSimpleQueuesSnapshot(snapshot);
      }
    } catch (err) {
      console.warn('Capacity planner sync notice:', err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [activeRouter, fetchUpstreamConfig]);

  useEffect(() => {
    fetchPlannerDatasets();

    const ch = supabase
      .channel('public:capacity_planner_sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'upstream_capacity_config' }, () => {
        fetchUpstreamConfig();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'portal_users' }, () => {
        fetchPlannerDatasets();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'network_areas' }, () => {
        fetchPlannerDatasets();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, [fetchPlannerDatasets, fetchUpstreamConfig]);

  // Determine the active WAN interface name to monitor (strictly honoring saved Supabase config)
  const physicalInterfaces = useMemo(() => {
    return interfaces.filter((iface) => {
      const name = String(iface?.name || '').trim();
      return Boolean(name) && !name.startsWith('<pppoe-');
    });
  }, [interfaces]);

  const effectiveWanInterface = useMemo(() => {
    const configured = (config.wan_interface_name || '')
      .replace(/\s*\(Configured\)\s*$/i, '')
      .trim();

    if (configured) {
      const exact = physicalInterfaces.find(
        (i) => (i.name || '').toLowerCase() === configured.toLowerCase()
      );
      return exact?.name || configured;
    }

    const preferred =
      physicalInterfaces.find((i) => /wan|ether1|sfp/i.test(i.name || '') && i.running !== 'false' && i.running !== false) ||
      physicalInterfaces.find((i) => /ether|sfp|bridge/i.test(i.name || '')) ||
      physicalInterfaces[0];

    return preferred?.name || 'ether1-WAN';
  }, [config.wan_interface_name, physicalInterfaces]);

  // Poll live WAN traffic every 15 seconds with single in-flight locking to prevent MikroTik rest-api session pile-up
  useEffect(() => {
    let isMounted = true;
    let inFlight = false;
    setTrafficSeries([]);

    const pollLiveTraffic = async () => {
      if (inFlight || (typeof document !== 'undefined' && document.hidden)) return;
      inFlight = true;
      try {
        const [wanSample, ifaceList, activeList] = await Promise.all([
          fetchMikrotikInterfaceTrafficOnce(effectiveWanInterface, activeRouter),
          safeMikrotikFetch('/api/mikrotik/interface', {}, activeRouter).then((r) => (r.ok ? r.json() : null)).catch(() => null),
          safeMikrotikFetch('/api/mikrotik/ppp/active', {}, activeRouter).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        ]);

        if (!isMounted) return;

        if (wanSample.ok) {
          const rxMbps = Number(wanSample.rxMbps) || 0;
          const txMbps = Number(wanSample.txMbps) || 0;
          const totalTrafficMbps = Math.round((rxMbps + txMbps) * 100) / 100;
          const nowTimeStr = new Date().toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          });

          setMikrotikReachable(true);
          setLiveDownloadMbps(rxMbps);
          setLiveUploadMbps(txMbps);
          setPeakDownloadMbps((prev) => Math.max(prev, rxMbps));
          setLastPolledAt(nowTimeStr);
          setTrafficSeries((prev) => [
            ...prev.slice(-29),
            {
              time: nowTimeStr,
              rxMbps,
              txMbps,
              totalTrafficMbps,
            },
          ]);
        }

        if (Array.isArray(activeList)) {
          setPppActive(activeList as MikrotikPppActive[]);
        }

        if (Array.isArray(ifaceList)) {
          setInterfaces(ifaceList as MikrotikInterfaceRow[]);
          const nowMs = Date.now();
          const nextRates: Record<string, number> = {};

          for (const item of ifaceList as MikrotikInterfaceRow[]) {
            const name = String(item?.name || '').trim();
            if (!name.startsWith('<pppoe-')) continue;

            // Extract username from "<pppoe-username>"
            const cleanUser = name.replace(/^<pppoe-/i, '').replace(/>$/, '').trim().toLowerCase();
            if (!cleanUser) continue;

            const rxBytes = Number(item['rx-byte'] || 0);
            const txBytes = Number(item['tx-byte'] || 0);
            const prev = prevInterfaceBytesRef.current[cleanUser];

            if (prev && nowMs > prev.timestampMs) {
              const dtSec = (nowMs - prev.timestampMs) / 1000;
              // Subscriber download on RouterOS <pppoe-user> interface is tx-byte (or rx+tx if mirrored)
              const deltaTx = Math.max(0, txBytes - prev.txBytes);
              const mbps = Math.round(((deltaTx * 8) / dtSec / 1_000_000) * 100) / 100;
              nextRates[cleanUser] = mbps;
            } else {
              nextRates[cleanUser] = 0;
            }

            prevInterfaceBytesRef.current[cleanUser] = {
              rxBytes,
              txBytes,
              timestampMs: nowMs,
            };
          }

          setUserLiveMbps(nextRates);
        }
      } catch {
        // Keep last valid state on transient error
      } finally {
        inFlight = false;
      }
    };

    pollLiveTraffic();
    const timer = setInterval(pollLiveTraffic, 15000);
    return () => {
      isMounted = false;
      clearInterval(timer);
    };
  }, [effectiveWanInterface]);

  // Unified subscriber catalog merging Supabase `portal_users` + MikroTik `/ppp/secret` + `/ppp/active`
  const unifiedPoolSubscribers = useMemo(() => {
    const activeUserSet = new Set(
      pppActive.map((s) => (s?.name || '').trim().toLowerCase()).filter(Boolean)
    );

    const secretByUser: Record<string, MikrotikPppSecret> = {};
    for (const sec of pppSecrets) {
      const uname = (sec?.name || '').trim().toLowerCase();
      if (uname) secretByUser[uname] = sec;
    }

    const portalByUser: Record<string, SupabasePortalUser> = {};
    for (const pu of portalClients) {
      const uname = (pu?.username || '').trim().toLowerCase();
      if (uname) portalByUser[uname] = pu;
    }

    const allUsernames = new Set<string>([
      ...Object.keys(portalByUser),
      ...Object.keys(secretByUser),
      ...Array.from(activeUserSet),
    ]);

    const rows: Array<{
      username: string;
      areaName: string;
      packageLabel: string;
      packageMbps: number;
      isOnline: boolean;
      isActiveAccount: boolean;
      liveMbps: number;
    }> = [];

    for (const uname of allUsernames) {
      const pu = portalByUser[uname];
      const sec = secretByUser[uname];
      const isOnline = activeUserSet.has(uname);

      const acctStatus = (pu?.account_status || 'ACTIVE').toUpperCase();
      const secDisabled = sec?.disabled === true || sec?.disabled === 'true';
      const secProfile = (sec?.profile || '').trim();
      const isExpiredProfile =
        secProfile.toLowerCase() === 'expired' || secProfile.toLowerCase().includes('walled');

      const isActiveAccount =
        !secDisabled &&
        !isExpiredProfile &&
        acctStatus !== 'EXPIRED' &&
        acctStatus !== 'SUSPENDED';

      // Resolve package speed cleanly from portal_users first, then PPPoE secret profile
      const rawPackage =
        (pu?.package_speed && parsePackageSpeedMbps(pu.package_speed) > 0 ? pu.package_speed : '') ||
        (!isExpiredProfile && parsePackageSpeedMbps(secProfile) > 0 ? secProfile : '') ||
        pu?.package_speed ||
        secProfile ||
        '20Mbps';

      const packageMbps = parsePackageSpeedMbps(rawPackage) || 20;
      const packageLabel = normalizePackageTierLabel(rawPackage);

      // Resolve child mohallah area from portal_users.area or username prefix
      const resolvedFromPrefix = resolveAreaFromUsername(uname, networkAreas);
      const portalArea = (pu?.area || '').trim();
      const isGenericArea =
        !portalArea ||
        portalArea.toLowerCase() === 'saddar node' ||
        portalArea.toLowerCase() === 'central noc core' ||
        portalArea.toLowerCase() === 'unassigned';

      const areaName =
        (!isGenericArea && portalArea) ||
        resolvedFromPrefix ||
        portalArea ||
        'Other / Unassigned';

      rows.push({
        username: uname,
        areaName,
        packageLabel,
        packageMbps,
        isOnline,
        isActiveAccount,
        liveMbps: userLiveMbps[uname] || 0,
      });
    }

    return rows;
  }, [portalClients, pppSecrets, pppActive, networkAreas, userLiveMbps]);

  // Core upstream capacity metrics + 390 Peak Concurrent Calibration
  const totalDedicatedMbps = Math.max(1, Number(config.total_dedicated_mbps) || 400);
  const contentionRatio = Math.max(1, Number(config.contention_ratio) || 6);
  const warningThreshold = Number(config.warning_threshold_pct) || 80;
  const criticalThreshold = Number(config.critical_threshold_pct) || 92;

  const activeSubscribers = useMemo(
    () => unifiedPoolSubscribers.filter((s) => s.isActiveAccount),
    [unifiedPoolSubscribers]
  );

  const registeredActiveCount = activeSubscribers.length;
  const effectivePeakConcurrentCap = Math.max(1, Number(peakConcurrentCap) || DEFAULT_PEAK_CONCURRENT_CAP);
  const peakConcurrencyFactor = useMemo(() => {
    if (registeredActiveCount <= 0) return 1;
    return Math.min(1, effectivePeakConcurrentCap / registeredActiveCount);
  }, [registeredActiveCount, effectivePeakConcurrentCap]);

  const calibratedPeakUsersTotal = useMemo(
    () => Math.min(registeredActiveCount, effectivePeakConcurrentCap),
    [registeredActiveCount, effectivePeakConcurrentCap]
  );

  const totalSoldBandwidthMbps = useMemo(
    () => activeSubscribers.reduce((sum, s) => sum + s.packageMbps, 0),
    [activeSubscribers]
  );

  const totalCdnBandwidthMbps = useMemo(
    () => activeSubscribers.reduce((sum, s) => sum + getCdnTierRateMbps(s.packageMbps), 0),
    [activeSubscribers]
  );

  const calibratedSubscribedMbps = totalSoldBandwidthMbps * peakConcurrencyFactor;
  const calibratedCdnPoolMbps = totalCdnBandwidthMbps * peakConcurrencyFactor;

  const unscaledContendedDemandMbps = totalSoldBandwidthMbps / contentionRatio;
  const contendedDemandMbps = calibratedSubscribedMbps / contentionRatio;
  const calibratedCdnDemandMbps = calibratedCdnPoolMbps / contentionRatio;

  const saturationPctRaw = Math.min(100, (liveDownloadMbps / totalDedicatedMbps) * 100);
  const saturationPctStr = saturationPctRaw.toFixed(1);
  const contendedRatioPct = Math.min(999, (contendedDemandMbps / totalDedicatedMbps) * 100);

  // Instant 1:1 - 1:10 Contention Ratio Switcher (optimistic + Supabase sync)
  const handleQuickSelectRatio = useCallback(
    async (nextRatio: ContentionRatioOption) => {
      setConfig((prev) => ({ ...prev, contention_ratio: nextRatio }));
      if (!isAdmin) return;
      setIsUpdatingRatio(true);
      try {
        if (config?.id) {
          const { error } = await supabase
            .from('upstream_capacity_config')
            .update({ contention_ratio: nextRatio, updated_at: new Date().toISOString() })
            .eq('id', config.id);
          if (!error) {
            showToast(`Contention ratio updated to 1:${nextRatio} (calibrated to ${effectivePeakConcurrentCap} peak concurrent users).`);
          }
        } else {
          const { data: existing } = await supabase
            .from('upstream_capacity_config')
            .select('id')
            .limit(1)
            .maybeSingle();
          if (existing?.id) {
            await supabase
              .from('upstream_capacity_config')
              .update({ contention_ratio: nextRatio, updated_at: new Date().toISOString() })
              .eq('id', existing.id);
          }
          showToast(`Contention ratio set to 1:${nextRatio}.`);
        }
      } catch {
        // Optimistic preview remains active
      } finally {
        setIsUpdatingRatio(false);
      }
    },
    [config?.id, effectivePeakConcurrentCap, isAdmin, showToast]
  );

  // Semantic gauge state
  const gaugeStatus = useMemo(() => {
    if (saturationPctRaw >= criticalThreshold) {
      return {
        tone: 'critical' as const,
        label: 'CRITICAL CONGESTION: Upstream Bottleneck Detected — Upgrade Dedicated CIR Immediately',
        barColor: 'bg-rose-500',
        textColor: 'text-rose-400',
        bannerBg: 'bg-rose-950/70 border-rose-700/80 text-rose-200',
      };
    }
    if (saturationPctRaw >= warningThreshold) {
      return {
        tone: 'warning' as const,
        label: 'Warning: Approaching Peak Saturation — Plan Upstream Upgrade',
        barColor: 'bg-amber-500',
        textColor: 'text-amber-400',
        bannerBg: 'bg-amber-950/70 border-amber-700/80 text-amber-200',
      };
    }
    return {
      tone: 'healthy' as const,
      label: `Healthy Headroom — Optimal 1:${contentionRatio} Contention`,
      barColor: 'bg-emerald-500',
      textColor: 'text-emerald-400',
      bannerBg: 'bg-emerald-950/60 border-emerald-700/60 text-emerald-200',
    };
  }, [saturationPctRaw, criticalThreshold, warningThreshold, contentionRatio]);

  // 2. Mohallah / Area Bandwidth Leaderboard
  const mohallahRows = useMemo(() => {
    const areaMap: Record<
      string,
      {
        areaName: string;
        prefixCode: string;
        totalSubscribers: number;
        onlineSessions: number;
        allocatedPoolMbps: number;
        currentLiveMbps: number;
        livePeakMbps: number;
      }
    > = {};

    // Pre-seed all known Saddar Fleet Router child mohallahs from network_areas
    for (const node of networkAreas) {
      const key = node.area_name.trim().toLowerCase();
      if (!key) continue;
      areaMap[key] = {
        areaName: node.area_name,
        prefixCode: node.prefix_code || '',
        totalSubscribers: 0,
        onlineSessions: 0,
        allocatedPoolMbps: 0,
        currentLiveMbps: 0,
        livePeakMbps: mohallahPeakMbpsRef.current[key] || 0,
      };
    }

    for (const sub of unifiedPoolSubscribers) {
      const key = sub.areaName.trim().toLowerCase();
      if (!areaMap[key]) {
        areaMap[key] = {
          areaName: sub.areaName,
          prefixCode: '',
          totalSubscribers: 0,
          onlineSessions: 0,
          allocatedPoolMbps: 0,
          currentLiveMbps: 0,
          livePeakMbps: mohallahPeakMbpsRef.current[key] || 0,
        };
      }

      areaMap[key].totalSubscribers += 1;
      if (sub.isOnline) areaMap[key].onlineSessions += 1;
      if (sub.isActiveAccount) areaMap[key].allocatedPoolMbps += sub.packageMbps;
      areaMap[key].currentLiveMbps += sub.liveMbps;
    }

    const result = Object.entries(areaMap).map(([key, row]) => {
      const currentRounded = Math.round(row.currentLiveMbps * 100) / 100;
      const updatedPeak = Math.max(mohallahPeakMbpsRef.current[key] || 0, currentRounded);
      mohallahPeakMbpsRef.current[key] = updatedPeak;

      const contendedCirShare = row.allocatedPoolMbps / contentionRatio;
      const utilizationPct =
        contendedCirShare > 0
          ? Math.round((updatedPeak / contendedCirShare) * 1000) / 10
          : updatedPeak > 0
          ? 100
          : 0;
      const exceedsFairShare = contendedCirShare > 0 && updatedPeak > contendedCirShare;

      return {
        ...row,
        currentLiveMbps: currentRounded,
        livePeakMbps: updatedPeak,
        contendedCirShare,
        utilizationPct,
        exceedsFairShare,
      };
    });

    const cleanQuery = (areaSearch || '').trim().toLowerCase();
    return result
      .filter((r) => {
        if (!showAllAreas && r.totalSubscribers === 0) return false;
        if (!cleanQuery) return true;
        return (
          (r.areaName || '').toLowerCase().includes(cleanQuery) ||
          (r.prefixCode || '').toLowerCase().includes(cleanQuery)
        );
      })
      .sort((a, b) => {
        if (b.livePeakMbps !== a.livePeakMbps) return b.livePeakMbps - a.livePeakMbps;
        if (b.onlineSessions !== a.onlineSessions) return b.onlineSessions - a.onlineSessions;
        return b.allocatedPoolMbps - a.allocatedPoolMbps;
      });
  }, [networkAreas, unifiedPoolSubscribers, contentionRatio, areaSearch, showAllAreas]);

  // 3. Package Pool Distribution (1:1 to 1:10 Contention Matrix calibrated to 390 Peak Concurrent Online)
  const packagePools = useMemo(() => {
    const tierMap: Record<
      string,
      {
        tierLabel: string;
        tierMbps: number;
        cdnRateMbps: number;
        activeUsers: number;
        onlineUsers: number;
        totalSubscribedMbps: number;
        peakCalibratedUsers: number;
        peakSubscribedMbps: number;
        contendedCirMbps: number;
        peakCdnDemandMbps: number;
        upstreamSharePct: number;
      }
    > = {};

    for (const sub of activeSubscribers) {
      const key = `${sub.packageMbps}`;
      if (!tierMap[key]) {
        tierMap[key] = {
          tierLabel: sub.packageLabel,
          tierMbps: sub.packageMbps,
          cdnRateMbps: getCdnTierRateMbps(sub.packageMbps),
          activeUsers: 0,
          onlineUsers: 0,
          totalSubscribedMbps: 0,
          peakCalibratedUsers: 0,
          peakSubscribedMbps: 0,
          contendedCirMbps: 0,
          peakCdnDemandMbps: 0,
          upstreamSharePct: 0,
        };
      }
      tierMap[key].activeUsers += 1;
      if (sub.isOnline) tierMap[key].onlineUsers += 1;
      tierMap[key].totalSubscribedMbps += sub.packageMbps;
    }

    return Object.values(tierMap)
      .map((row) => {
        const peakCalibratedUsers = row.activeUsers * peakConcurrencyFactor;
        const peakSubscribedMbps = row.totalSubscribedMbps * peakConcurrencyFactor;
        const contendedCirMbps = peakSubscribedMbps / contentionRatio;
        const peakCdnDemandMbps = (peakCalibratedUsers * row.cdnRateMbps) / contentionRatio;
        const upstreamSharePct = (contendedCirMbps / totalDedicatedMbps) * 100;
        return {
          ...row,
          peakCalibratedUsers,
          peakSubscribedMbps,
          contendedCirMbps,
          peakCdnDemandMbps,
          upstreamSharePct,
        };
      })
      .sort((a, b) => a.tierMbps - b.tierMbps);
  }, [activeSubscribers, contentionRatio, peakConcurrencyFactor, totalDedicatedMbps]);

  // All 6 Contention Ratios Comparison Matrix (1:1, 1:2, 1:4, 1:6, 1:8, 1:10) calibrated to Peak Concurrent Cap
  const ratioComparisonMatrix = useMemo(() => {
    const safeCapMbps = totalDedicatedMbps * 0.85;
    return CONTENTION_RATIOS.map((ratio) => {
      const regularCirMbps = calibratedSubscribedMbps / ratio;
      const cdnDemandMbps = calibratedCdnPoolMbps / ratio;
      const upstreamPct = (regularCirMbps / totalDedicatedMbps) * 100;
      const status: 'optimal' | 'tight' | 'over' =
        regularCirMbps <= safeCapMbps
          ? 'optimal'
          : regularCirMbps <= totalDedicatedMbps
          ? 'tight'
          : 'over';
      return {
        ratio,
        regularCirMbps,
        cdnDemandMbps,
        cdnOverSafe240: cdnDemandMbps > DEFAULT_CDN_GUARDRAIL_MBPS,
        upstreamPct,
        status,
      };
    });
  }, [calibratedSubscribedMbps, calibratedCdnPoolMbps, totalDedicatedMbps]);

  // Upgrade Recommendation Calculations (85% safety target of dedicated CIR link, calibrated to peak concurrent cap)
  const upgradeRecommendation = useMemo(() => {
    const safeCeilingMbps = totalDedicatedMbps * 0.85;
    const headroomMbps = safeCeilingMbps - contendedDemandMbps;

    const avgPkgMbps =
      activeSubscribers.length > 0
        ? totalSoldBandwidthMbps / activeSubscribers.length
        : 20;
    const avgPerUserCir = Math.max(0.1, (avgPkgMbps * peakConcurrencyFactor) / contentionRatio);
    const additionalAvgUsers = headroomMbps > 0 ? Math.floor(headroomMbps / avgPerUserCir) : 0;

    // Concrete tier headroom examples
    const add10M = headroomMbps > 0 ? Math.floor(headroomMbps / ((10 * peakConcurrencyFactor) / contentionRatio)) : 0;
    const add20M = headroomMbps > 0 ? Math.floor(headroomMbps / ((20 * peakConcurrencyFactor) / contentionRatio)) : 0;
    const add30M = headroomMbps > 0 ? Math.floor(headroomMbps / ((30 * peakConcurrencyFactor) / contentionRatio)) : 0;

    return {
      safeCeilingMbps,
      headroomMbps,
      avgPkgMbps: Math.round(avgPkgMbps * 10) / 10,
      additionalAvgUsers,
      add10M,
      add20M,
      add30M,
      isOver85Pct: headroomMbps <= 0,
      recommendedUpgradeMbps: Math.ceil((contendedDemandMbps / 0.7) / 10) * 10,
    };
  }, [totalDedicatedMbps, contendedDemandMbps, activeSubscribers.length, totalSoldBandwidthMbps, contentionRatio, peakConcurrencyFactor]);

  // Auto-scanned 'YouTube + Meta CDN Pool' grouped from MikroTik Simple Queues containing 'CDN'
  const youtubeMetaCdnPool = useMemo(() => {
    const allScanned = simpleQueuesSnapshot?.queues || [];
    const cdnQueues = allScanned.filter((q) => q.isCdn || isCdnQueueName(q.name));

    const nearestRatio: ContentionRatioOption = (CONTENTION_RATIOS.find((r) => r === contentionRatio) ||
      CONTENTION_RATIOS.reduce((prev, curr) =>
        Math.abs(curr - contentionRatio) < Math.abs(prev - contentionRatio) ? curr : prev
      )) as ContentionRatioOption;

    const uniqueUserSet = new Set<string>();
    let totalLiveDownloadMbps = 0;
    let totalLiveUploadMbps = 0;
    let totalCurrentMaxLimitMbps = 0;
    let totalRecommendedMaxMbps = 0;
    let innCdnCount = 0;
    let twCdnCount = 0;
    let otherCdnCount = 0;

    const rows = cdnQueues.map((queue) => {
      for (const uname of queue.matchedUsernames) {
        uniqueUserSet.add(uname);
      }
      if (queue.sourcePool === 'inn') innCdnCount += 1;
      else if (queue.sourcePool === 'tw') twCdnCount += 1;
      else otherCdnCount += 1;

      totalLiveDownloadMbps += queue.liveRate.downloadMbps;
      totalLiveUploadMbps += queue.liveRate.uploadMbps;
      if (!queue.currentMaxLimit.isUnlimited) {
        totalCurrentMaxLimitMbps += queue.currentMaxLimit.downloadMbps;
      }

      const plan = calculateQueueRatioPlan({
        activeUsers: queue.activeUsers,
        packageMbps: queue.packageMbps,
        ratioDivisor: nearestRatio,
        isCdn: true,
      });
      totalRecommendedMaxMbps += plan.poolMaxMbps;

      return {
        queue,
        plan,
      };
    });

    return {
      rows,
      queueCount: cdnQueues.length,
      innCdnCount,
      twCdnCount,
      otherCdnCount,
      uniqueOnlineUsers: uniqueUserSet.size,
      totalLiveDownloadMbps: Math.round(totalLiveDownloadMbps * 100) / 100,
      totalLiveUploadMbps: Math.round(totalLiveUploadMbps * 100) / 100,
      totalCurrentMaxLimitMbps: Math.round(totalCurrentMaxLimitMbps * 100) / 100,
      totalRecommendedMaxMbps,
      nearestRatio,
      overSafe240: totalRecommendedMaxMbps > DEFAULT_CDN_GUARDRAIL_MBPS,
    };
  }, [simpleQueuesSnapshot, contentionRatio]);

  const handleOpenCdnPoolInManager = useCallback(() => {
    setPoolManagerTargetPool('cdn');
    setPoolManagerSelectNonce((n) => n + 1);
    poolManagerSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // Open Edit Modal
  const handleOpenEditModal = () => {
    setIsEditModalOpen(true);
  };

  return (
    <div className="w-full max-w-full min-w-0 box-border space-y-6 text-xs font-sans">
      {/* Feedback Banner */}
      {saveNotice && (
        <div
          className={`p-3 rounded-xl border font-mono text-xs flex items-center gap-2 ${
            saveNotice.type === 'error'
              ? 'bg-rose-950/90 border-rose-700 text-rose-200'
              : 'bg-emerald-950/90 border-emerald-700 text-emerald-200'
          }`}
        >
          {saveNotice.type === 'error' ? (
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          )}
          <span>{saveNotice.text}</span>
        </div>
      )}

      {/* Header Action Bar */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-slate-400 font-mono text-[11px]">
            <span>{PARENT_FLEET_ROUTER}</span>
            <span aria-hidden="true">·</span>
            <span>{config.provider_name}</span>
            <span aria-hidden="true">·</span>
            <span>Interface: {effectiveWanInterface}</span>
            {lastPolledAt && (
              <>
                <span aria-hidden="true">·</span>
                <span>Polled {lastPolledAt}</span>
              </>
            )}
          </div>
          <h2 className="text-lg font-bold text-white tracking-tight">
            Upstream Bandwidth Pool &amp; 1:{contentionRatio} Contention Planner
          </h2>
          <p className="text-xs text-slate-400">
            Live upstream CIR saturation against {totalDedicatedMbps} Mbps dedicated capacity across all Saddar child mohallah pools.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {/* Quick 6-Ratio Selector (1:1 to 1:10) */}
          <div className="flex flex-wrap items-center gap-1 bg-slate-950 border border-slate-800 rounded-lg p-1">
            <span className="text-[10px] font-mono text-slate-400 px-1.5">Ratio:</span>
            {CONTENTION_RATIOS.map((r) => (
              <button
                key={r}
                type="button"
                disabled={isUpdatingRatio}
                onClick={() => handleQuickSelectRatio(r)}
                className={`px-2 py-1 rounded text-[11px] font-mono font-bold transition cursor-pointer ${
                  contentionRatio === r
                    ? 'bg-sky-600 text-white shadow-sm'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                1:{r}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => fetchPlannerDatasets(true)}
            disabled={isRefreshing}
            className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold text-xs flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50 whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>Sync Pools</span>
          </button>

          {isAdmin && (
            <button
              type="button"
              onClick={handleOpenEditModal}
              className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shadow-sm"
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>Edit Upstream Link</span>
            </button>
          )}
        </div>
      </div>

      {/* LIVE MIKROTIK PCQ & SUBNET POOL RATIO / AUTO-BURST MANAGER */}
      <div ref={poolManagerSectionRef}>
        <PcqSubnetPoolManager
          activeRouter={activeRouter}
          isAdmin={isAdmin}
          upstreamDedicatedMbps={totalDedicatedMbps}
          externalSelectedPool={poolManagerTargetPool}
          poolSelectNonce={poolManagerSelectNonce}
          onSnapshotUpdated={setSimpleQueuesSnapshot}
          onNotify={showToast}
        />
      </div>

      {/* 1. UPSTREAM CAPACITY & SATURATION METER */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-slate-400 text-xs font-medium">
              <Gauge className="w-4 h-4 text-cyan-400 shrink-0" />
              <span>Live Upstream Saturation Meter ({effectiveWanInterface})</span>
              {!mikrotikReachable && (
                <span className="text-amber-400 font-mono text-[11px]">· RouterOS Offline</span>
              )}
            </div>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono tabular-nums min-w-0">
              <span className={`text-3xl font-bold ${gaugeStatus.textColor}`}>
                {saturationPctStr}%
              </span>
              <span className="text-sm text-slate-300">
                {liveDownloadMbps.toFixed(2)} Mbps RX / {totalDedicatedMbps} Mbps CIR
              </span>
              <span className="text-xs text-slate-500">
                (TX: {liveUploadMbps.toFixed(2)} Mbps · Peak RX: {peakDownloadMbps.toFixed(2)} Mbps)
              </span>
            </div>
          </div>

          <div className={`px-3.5 py-2.5 rounded-lg border text-xs font-semibold flex items-center gap-2 ${gaugeStatus.bannerBg}`}>
            {gaugeStatus.tone === 'healthy' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <ShieldAlert className="w-4 h-4 shrink-0" />
            )}
            <span>{gaugeStatus.label}</span>
          </div>
        </div>

        {/* High-visibility Saturation Progress Gauge with 80% / 92% Threshold Markers */}
        <div className="space-y-2">
          <div className="relative h-5 w-full rounded-lg bg-slate-950 border border-slate-800 overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${gaugeStatus.barColor}`}
              style={{ width: `${Math.max(0, Math.min(100, saturationPctRaw))}%` }}
            />
            {/* Warning threshold marker */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-amber-400/90"
              style={{ left: `${Math.min(99, warningThreshold)}%` }}
              title={`Warning Threshold (${warningThreshold}%)`}
            />
            {/* Critical threshold marker */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-rose-400/90"
              style={{ left: `${Math.min(99.5, criticalThreshold)}%` }}
              title={`Critical Threshold (${criticalThreshold}%)`}
            />
          </div>
          <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-400">
            <span>0 Mbps (0%)</span>
            <span>
              Warning: {((totalDedicatedMbps * warningThreshold) / 100).toFixed(1)} Mbps ({warningThreshold}%)
            </span>
            <span>
              Critical: {((totalDedicatedMbps * criticalThreshold) / 100).toFixed(1)} Mbps ({criticalThreshold}%)
            </span>
            <span>{totalDedicatedMbps} Mbps (100%)</span>
          </div>
        </div>

        {/* 4 Summary Metrics in Clean Hairline Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 pt-3 border-t border-slate-800">
          <div className="space-y-1">
            <span className="text-slate-400 text-[11px] block">Dedicated CIR Link</span>
            <span className="text-xl font-bold font-mono tabular-nums text-white block">
              {totalDedicatedMbps} Mbps
            </span>
            <span className="text-[11px] text-slate-500 font-mono">
              Target 1:{contentionRatio} Contention
            </span>
          </div>

          <div className="space-y-1">
            <span className="text-slate-400 text-[11px] block">Peak-Calibrated Sold Pool</span>
            <span className="text-xl font-bold font-mono tabular-nums text-cyan-400 block">
              {Math.round(calibratedSubscribedMbps).toLocaleString()} Mbps
            </span>
            <span className="text-[11px] text-slate-500 font-mono">
              {calibratedPeakUsersTotal} Peak Cap / {registeredActiveCount} Reg ({pppActive.length} Online)
            </span>
          </div>

          <div className="space-y-1">
            <span className="text-slate-400 text-[11px] block">
              Peak CIR Demand (1:{contentionRatio})
            </span>
            <span
              className={`text-xl font-bold font-mono tabular-nums block ${
                contendedDemandMbps > totalDedicatedMbps * 0.85
                  ? 'text-amber-400'
                  : 'text-emerald-400'
              }`}
            >
              {contendedDemandMbps.toFixed(1)} Mbps
            </span>
            <span className="text-[11px] text-slate-500 font-mono">
              {contendedRatioPct.toFixed(1)}% of {totalDedicatedMbps}M · Unscaled {unscaledContendedDemandMbps.toFixed(1)}M
            </span>
          </div>

          <div className="space-y-1">
            <span className="text-slate-400 text-[11px] block">Safe Remaining CIR (85% Cap)</span>
            <span
              className={`text-xl font-bold font-mono tabular-nums block ${
                upgradeRecommendation.headroomMbps <= 0 ? 'text-rose-400' : 'text-emerald-400'
              }`}
            >
              {upgradeRecommendation.headroomMbps > 0
                ? `+${upgradeRecommendation.headroomMbps.toFixed(1)} Mbps`
                : `${upgradeRecommendation.headroomMbps.toFixed(1)} Mbps`}
            </span>
            <span className="text-[11px] text-slate-500 font-mono">
              85% Cap: {upgradeRecommendation.safeCeilingMbps.toFixed(1)}M · CDN 1:{contentionRatio}: {calibratedCdnDemandMbps.toFixed(1)}M
            </span>
          </div>
        </div>

        {/* Real-Time Recharts Bandwidth Usage vs CIR Limit */}
        {(() => {
          const warningLimitMbps = Number(((totalDedicatedMbps * warningThreshold) / 100).toFixed(2));
          const peakTraffic = trafficSeries.reduce(
            (max, p) => Math.max(max, p.totalTrafficMbps, p.rxMbps, p.txMbps),
            0
          );
          const yAxisUpper = Math.ceil(Math.max(totalDedicatedMbps * 1.15, peakTraffic * 1.15));
          const latestPoint = trafficSeries[trafficSeries.length - 1];
          const liveTotalMbps = latestPoint
            ? latestPoint.totalTrafficMbps
            : Math.round((liveDownloadMbps + liveUploadMbps) * 100) / 100;

          return (
            <div className="pt-4 border-t border-slate-800 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Activity className="w-4 h-4 text-cyan-400" />
                    <span>Real-Time WAN Throughput vs. Dedicated CIR Limit</span>
                  </h3>
                  <p className="text-xs text-slate-400 font-mono tabular-nums mt-0.5">
                    Polling <strong className="text-cyan-300">{effectiveWanInterface}</strong> every 3s · Rolling 30 samples · Current RX+TX:{' '}
                    <strong className="text-white">{liveTotalMbps.toFixed(2)} Mbps</strong> vs {totalDedicatedMbps} Mbps CIR
                  </p>
                </div>
                <span className="text-[11px] font-mono tabular-nums text-slate-400">
                  Warning Line: {warningLimitMbps.toFixed(1)} Mbps ({warningThreshold}%)
                </span>
              </div>

              {trafficSeries.length === 0 ? (
                <div className="h-[320px] rounded-xl bg-slate-950/80 border border-slate-800 flex flex-col items-center justify-center text-center p-6 space-y-2">
                  <Radio className="w-6 h-6 text-cyan-400 animate-pulse" />
                  <p className="text-xs font-mono text-slate-300">
                    Waiting for live /interface/monitor-traffic telemetry on {effectiveWanInterface}...
                  </p>
                  <p className="text-[11px] font-mono text-slate-500">
                    Dedicated CIR Limit configured at {totalDedicatedMbps} Mbps (Warning at {warningLimitMbps} Mbps).
                  </p>
                </div>
              ) : (
                <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 h-[320px]">
                  <ResponsiveContainer width="100%" height={288}>
                    <ComposedChart
                      data={trafficSeries}
                      margin={{ top: 14, right: 18, left: 0, bottom: 4 }}
                    >
                      <defs>
                        <linearGradient id="capTotalTrafficGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.38} />
                          <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.02} />
                        </linearGradient>
                        <linearGradient id="capRxGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" opacity={0.65} />
                      <XAxis
                        dataKey="time"
                        stroke="#64748b"
                        fontSize={10}
                        tickLine={false}
                        fontFamily="monospace"
                      />
                      <YAxis
                        domain={[0, yAxisUpper]}
                        stroke="#64748b"
                        fontSize={10}
                        tickLine={false}
                        fontFamily="monospace"
                        tickFormatter={(val: number) => `${val}M`}
                      />
                      <Tooltip
                        content={({ active, payload, label }) => {
                          if (!active || !payload || !payload.length) return null;
                          const pt = payload[0]?.payload as WanTrafficPoint | undefined;
                          if (!pt) return null;
                          const cirPct = Math.round((pt.totalTrafficMbps / totalDedicatedMbps) * 1000) / 10;
                          return (
                            <div className="bg-slate-950 border border-slate-700 rounded-xl p-3 shadow-2xl text-xs font-mono tabular-nums space-y-1 min-w-[215px]">
                              <div className="text-slate-300 font-bold border-b border-slate-800 pb-1 flex items-center justify-between gap-3">
                                <span>{label}</span>
                                <span className="text-cyan-400">{effectiveWanInterface}</span>
                              </div>
                              <div className="flex justify-between gap-4 text-cyan-300">
                                <span>Total (RX+TX):</span>
                                <span className="font-bold">{pt.totalTrafficMbps.toFixed(2)} Mbps</span>
                              </div>
                              <div className="flex justify-between gap-4 text-emerald-400">
                                <span>Download (RX):</span>
                                <span className="font-bold">{pt.rxMbps.toFixed(2)} Mbps</span>
                              </div>
                              <div className="flex justify-between gap-4 text-indigo-300">
                                <span>Upload (TX):</span>
                                <span className="font-bold">{pt.txMbps.toFixed(2)} Mbps</span>
                              </div>
                              <div className="pt-1 border-t border-slate-800 flex justify-between gap-4 text-rose-300">
                                <span>CIR Limit ({totalDedicatedMbps}M):</span>
                                <span className="font-bold">{cirPct.toFixed(1)}% Used</span>
                              </div>
                            </div>
                          );
                        }}
                      />
                      <Legend
                        verticalAlign="top"
                        align="right"
                        wrapperStyle={{ fontSize: '11px', fontFamily: 'monospace', paddingBottom: '8px' }}
                      />
                      <ReferenceLine
                        y={totalDedicatedMbps}
                        stroke="#ef4444"
                        strokeDasharray="6 4"
                        strokeWidth={2}
                        label={{
                          value: `Dedicated CIR Limit (${totalDedicatedMbps} Mbps)`,
                          fill: '#fca5a5',
                          fontSize: 11,
                          fontFamily: 'monospace',
                          position: 'insideTopRight',
                        }}
                      />
                      <ReferenceLine
                        y={warningLimitMbps}
                        stroke="#f59e0b"
                        strokeDasharray="4 4"
                        strokeWidth={1.5}
                        label={{
                          value: `Warning (${warningThreshold}% · ${warningLimitMbps} Mbps)`,
                          fill: '#fcd34d',
                          fontSize: 10,
                          fontFamily: 'monospace',
                          position: 'insideBottomRight',
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="totalTrafficMbps"
                        name="Total Traffic (RX+TX)"
                        stroke="#06b6d4"
                        strokeWidth={2.5}
                        fill="url(#capTotalTrafficGrad)"
                        isAnimationActive={false}
                      />
                      <Area
                        type="monotone"
                        dataKey="rxMbps"
                        name="Download (RX)"
                        stroke="#10b981"
                        strokeWidth={2}
                        fill="url(#capRxGrad)"
                        isAnimationActive={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="txMbps"
                        name="Upload (TX)"
                        stroke="#6366f1"
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* 2. YOUTUBE + META CDN POOL (AUTO-SCANNED MIKROTIK SIMPLE QUEUES CONTAINING 'CDN') */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Tv className="w-4 h-4 text-rose-400" />
              <span>YouTube + Meta CDN Pool (Auto-Scanned Simple Queues)</span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Automatically scans MikroTik <code className="text-slate-300">/queue/simple</code> for any queue names containing{' '}
              <strong className="text-rose-300">&apos;CDN&apos;</strong> and groups them with Priority 8 &amp; 8s/8s burst isolation.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => fetchPlannerDatasets(true)}
              disabled={isRefreshing}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold text-xs flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50 whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>Rescan CDN Queues</span>
            </button>
            <button
              type="button"
              onClick={handleOpenCdnPoolInManager}
              className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shadow-sm"
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Tune CDN Ratios</span>
            </button>
          </div>
        </div>

        {/* CDN Pool Summary KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-2 border-t border-slate-800">
          <div className="p-3 rounded-lg bg-slate-950/75 border border-slate-800 space-y-0.5">
            <span className="text-[11px] text-slate-400 block">Matched CDN Queues</span>
            <span className="text-lg font-bold font-mono tabular-nums text-white block">
              {youtubeMetaCdnPool.queueCount} Queues
            </span>
            <span className="text-[11px] font-mono text-slate-500">
              {youtubeMetaCdnPool.innCdnCount} Inn · {youtubeMetaCdnPool.twCdnCount} TW
              {youtubeMetaCdnPool.otherCdnCount > 0 ? ` · ${youtubeMetaCdnPool.otherCdnCount} Other` : ''}
            </span>
          </div>

          <div className="p-3 rounded-lg bg-slate-950/75 border border-slate-800 space-y-0.5">
            <span className="text-[11px] text-slate-400 block">Live CDN Throughput</span>
            <span className="text-lg font-bold font-mono tabular-nums text-rose-400 block">
              {youtubeMetaCdnPool.totalLiveDownloadMbps.toFixed(2)} Mbps DL
            </span>
            <span className="text-[11px] font-mono text-slate-500">
              UL: {youtubeMetaCdnPool.totalLiveUploadMbps.toFixed(2)} Mbps
            </span>
          </div>

          <div className="p-3 rounded-lg bg-slate-950/75 border border-slate-800 space-y-0.5">
            <span className="text-[11px] text-slate-400 block">Online Users on CDN Subnets</span>
            <span className="text-lg font-bold font-mono tabular-nums text-emerald-400 block">
              {youtubeMetaCdnPool.uniqueOnlineUsers} Online
            </span>
            <span className="text-[11px] font-mono text-slate-500">
              Matched across target CIDRs
            </span>
          </div>

          <div className="p-3 rounded-lg bg-slate-950/75 border border-slate-800 space-y-0.5">
            <span className="text-[11px] text-slate-400 block">
              1:{youtubeMetaCdnPool.nearestRatio} CDN Cap vs {DEFAULT_CDN_GUARDRAIL_MBPS}M Safe Ceiling
            </span>
            <span
              className={`text-lg font-bold font-mono tabular-nums block ${
                youtubeMetaCdnPool.overSafe240 ? 'text-amber-400' : 'text-cyan-400'
              }`}
            >
              {youtubeMetaCdnPool.totalRecommendedMaxMbps} Mbps
            </span>
            <span className="text-[11px] font-mono text-slate-500">
              Live RouterOS Cap: {youtubeMetaCdnPool.totalCurrentMaxLimitMbps} Mbps
            </span>
          </div>
        </div>

        {/* Discovered CDN Simple Queues Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-xs tabular-nums">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400">
                <th className="py-2.5 px-3 font-sans">CDN Queue Name</th>
                <th className="py-2.5 px-3">Origin / Target</th>
                <th className="py-2.5 px-3 text-right">Tier → CDN</th>
                <th className="py-2.5 px-3 text-right">Online</th>
                <th className="py-2.5 px-3 text-right">Live DL / UL</th>
                <th className="py-2.5 px-3 text-right">Active Max-Limit</th>
                <th className="py-2.5 px-3 text-right">Priority</th>
                <th className="py-2.5 px-3 text-right">1:{youtubeMetaCdnPool.nearestRatio} Target</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {isLoading && !simpleQueuesSnapshot ? (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-slate-500">
                    Scanning MikroTik Simple Queues for CDN entries...
                  </td>
                </tr>
              ) : youtubeMetaCdnPool.rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-slate-500">
                    No Simple Queues containing &quot;CDN&quot; detected on {activeRouter?.name || 'active router'}. Queues like &quot;2 MB - CDN - TW&quot; or &quot;4 MB - CDN - Inn&quot; appear here automatically.
                  </td>
                </tr>
              ) : (
                youtubeMetaCdnPool.rows.map(({ queue, plan }) => (
                  <tr key={queue.id || queue.name} className="hover:bg-slate-800/30">
                    <td className="py-2.5 px-3 font-sans font-bold text-white">
                      <div className="flex items-center gap-2">
                        <span>{queue.name}</span>
                        {queue.disabled && (
                          <span className="text-[10px] font-mono text-amber-400">(Disabled)</span>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-slate-300">
                      <span className="uppercase text-rose-300 font-bold mr-1.5">
                        {queue.sourcePool === 'inn' ? 'Inn' : queue.sourcePool === 'tw' ? 'TW' : 'Custom'}
                      </span>
                      <span className="text-slate-400 text-[11px]">{queue.target}</span>
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-200">
                      {queue.packageMbps}M → <strong className="text-rose-300">{queue.cdnTierRateMbps}M</strong>
                    </td>
                    <td className="py-2.5 px-3 text-right text-emerald-400 font-bold">
                      {queue.activeUsers}
                    </td>
                    <td className="py-2.5 px-3 text-right text-cyan-300">
                      {queue.liveRate.downloadMbps.toFixed(2)}M / {queue.liveRate.uploadMbps.toFixed(2)}M
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-200">
                      {queue.currentMaxLimit.displayLabel}
                    </td>
                    <td className="py-2.5 px-3 text-right text-amber-300 font-semibold">
                      {queue.currentPriority}
                    </td>
                    <td className="py-2.5 px-3 text-right text-indigo-300 font-bold">
                      {plan.poolMaxMbps}M/{plan.poolMaxMbps}M
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {youtubeMetaCdnPool.rows.length > 0 && (
              <tfoot>
                <tr className="border-t border-slate-700 bg-slate-950/70 font-bold">
                  <td className="py-2.5 px-3 font-sans text-white">
                    YouTube + Meta CDN Pool Total ({youtubeMetaCdnPool.queueCount})
                  </td>
                  <td className="py-2.5 px-3 text-slate-400">Priority 8/8 · 8s/8s</td>
                  <td className="py-2.5 px-3 text-right text-slate-300">—</td>
                  <td className="py-2.5 px-3 text-right text-emerald-400">
                    {youtubeMetaCdnPool.uniqueOnlineUsers}
                  </td>
                  <td className="py-2.5 px-3 text-right text-cyan-300">
                    {youtubeMetaCdnPool.totalLiveDownloadMbps.toFixed(2)}M / {youtubeMetaCdnPool.totalLiveUploadMbps.toFixed(2)}M
                  </td>
                  <td className="py-2.5 px-3 text-right text-slate-200">
                    {youtubeMetaCdnPool.totalCurrentMaxLimitMbps}M
                  </td>
                  <td className="py-2.5 px-3 text-right text-amber-300">8/8</td>
                  <td className="py-2.5 px-3 text-right text-rose-300">
                    {youtubeMetaCdnPool.totalRecommendedMaxMbps}M / {DEFAULT_CDN_GUARDRAIL_MBPS}M Cap
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* 3. MOHALLAH / AREA BANDWIDTH CONSUMPTION BREAKDOWN */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <MapPin className="w-4 h-4 text-cyan-400" />
              <span>Mohallah Bandwidth Leaderboard ({PARENT_FLEET_ROUTER})</span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Live PPPoE session &amp; subscriber pool allocation grouped by prefix code and area assignment. Highlighted rows exceed their 1:{contentionRatio} fair-share CIR allocation.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setIsAreaManagerOpen(true)}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 font-semibold text-xs flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap"
            >
              <MapPin className="w-3.5 h-3.5" />
              <span>Manage Areas</span>
            </button>

            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg font-mono text-[11px]">
              <button
                type="button"
                onClick={() => setShowAllAreas(true)}
                className={`px-2.5 py-1 rounded transition cursor-pointer border ${
                  showAllAreas
                    ? 'bg-sky-600 text-white border-sky-600 font-bold dark:bg-sky-500/20 dark:text-sky-300 dark:border-sky-400/60'
                    : 'border-transparent text-slate-700 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                All Nodes ({networkAreas.length})
              </button>
              <button
                type="button"
                onClick={() => setShowAllAreas(false)}
                className={`px-2.5 py-1 rounded transition cursor-pointer border ${
                  !showAllAreas
                    ? 'bg-sky-600 text-white border-sky-600 font-bold dark:bg-sky-500/20 dark:text-sky-300 dark:border-sky-400/60'
                    : 'border-transparent text-slate-700 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                Active Only
              </button>
            </div>

            <div className="relative w-full sm:w-56">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5 pointer-events-none" />
              <input
                type="text"
                value={areaSearch}
                onChange={(e) => setAreaSearch(e.target.value)}
                placeholder="Filter mohallah or prefix..."
                className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-mono"
              />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-xs tabular-nums">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400">
                <th className="py-2.5 px-3 font-sans">Child Area / Mohallah</th>
                <th className="py-2.5 px-3 text-right">Total Subs</th>
                <th className="py-2.5 px-3 text-right">Online Sessions</th>
                <th className="py-2.5 px-3 text-right">Allocated Pool</th>
                <th className="py-2.5 px-3 text-right">1:{contentionRatio} CIR Share</th>
                <th className="py-2.5 px-3 text-right">Live Peak</th>
                <th className="py-2.5 px-3 w-44">Saturation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    Synchronizing mohallah capacity pools...
                  </td>
                </tr>
              ) : mohallahRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    No mohallah nodes match the current filter.
                  </td>
                </tr>
              ) : (
                mohallahRows.map((row) => {
                  const barWidth = Math.min(100, row.utilizationPct);
                  const barTone = row.exceedsFairShare
                    ? 'bg-rose-500'
                    : row.utilizationPct >= warningThreshold
                    ? 'bg-amber-500'
                    : 'bg-emerald-500';

                  return (
                    <tr
                      key={row.areaName}
                      className={
                        row.exceedsFairShare
                          ? 'bg-rose-950/35 hover:bg-rose-950/50'
                          : 'hover:bg-slate-800/30'
                      }
                    >
                      <td className="py-2.5 px-3 font-sans">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-white">{row.areaName}</span>
                          {row.prefixCode && (
                            <span className="text-[11px] font-mono text-slate-400">
                              [{row.prefixCode}]
                            </span>
                          )}
                          {row.exceedsFairShare && (
                            <span className="text-[11px] font-mono font-bold text-rose-400">
                              · Over 1:{contentionRatio} CIR
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-300">
                        {row.totalSubscribers}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <span className={row.onlineSessions > 0 ? 'text-emerald-400 font-bold' : 'text-slate-500'}>
                          {row.onlineSessions}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right text-cyan-300 font-semibold">
                        {row.allocatedPoolMbps} Mbps
                      </td>
                      <td className="py-2.5 px-3 text-right text-indigo-300 font-semibold">
                        {row.contendedCirShare.toFixed(2)} Mbps
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <span className={row.exceedsFairShare ? 'text-rose-400 font-bold' : 'text-white font-semibold'}>
                          {row.livePeakMbps.toFixed(2)} Mbps
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-slate-950 border border-slate-800 rounded-full overflow-hidden">
                            <div
                              className={`h-full ${barTone} transition-all duration-300`}
                              style={{ width: `${barWidth}%` }}
                            />
                          </div>
                          <span
                            className={`w-12 text-right font-bold ${
                              row.exceedsFairShare
                                ? 'text-rose-400'
                                : row.utilizationPct >= warningThreshold
                                ? 'text-amber-400'
                                : 'text-slate-300'
                            }`}
                          >
                            {row.utilizationPct.toFixed(0)}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 3. PACKAGE POOL DISTRIBUTION (1:1–1:10 CONTENTION ENGINE + 390 PEAK CONCURRENT CALIBRATION) */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Layers className="w-4 h-4 text-indigo-400" />
              <span>Package Pool Distribution &amp; 1:{contentionRatio} Contention Matrix</span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Calibrated against <strong className="text-cyan-300">{effectivePeakConcurrentCap}</strong> Peak Concurrent Online Cap ({Math.round(peakConcurrencyFactor * 1000) / 10}% of {registeredActiveCount} registered active) on your {totalDedicatedMbps} Mbps upstream link.
            </p>
          </div>

          {/* Peak Concurrent Online Cap Control + Ratio Buttons */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5">
              <Users className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              <label htmlFor="peak-concurrent-cap-input" className="text-[11px] font-mono text-slate-400 whitespace-nowrap">
                Peak Online Cap:
              </label>
              <input
                id="peak-concurrent-cap-input"
                type="number"
                min={1}
                max={10000}
                step={1}
                value={peakConcurrentCap}
                onChange={(e) => handleUpdatePeakCap(parseInt(e.target.value, 10))}
                className="w-16 bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-xs font-mono font-bold text-cyan-300 text-center focus:outline-none focus:border-cyan-500"
              />
              {peakConcurrentCap !== DEFAULT_PEAK_CONCURRENT_CAP && (
                <button
                  type="button"
                  onClick={() => handleUpdatePeakCap(DEFAULT_PEAK_CONCURRENT_CAP)}
                  className="text-[10px] font-mono text-slate-400 hover:text-cyan-300 cursor-pointer"
                  title="Reset to 390 default"
                >
                  Reset 390
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1 bg-slate-950 border border-slate-800 rounded-lg p-1">
              {CONTENTION_RATIOS.map((r) => (
                <button
                  key={r}
                  type="button"
                  disabled={isUpdatingRatio}
                  onClick={() => handleQuickSelectRatio(r)}
                  className={`px-2 py-1 rounded text-[11px] font-mono font-bold transition cursor-pointer ${
                    contentionRatio === r
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  1:{r}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 400 Mbps Upstream Utilization Bar (Calibrated to 390 Peak Concurrent Online) */}
        <div className="p-4 rounded-xl bg-slate-950/75 border border-slate-800 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-bold text-white flex items-center gap-2">
              <Gauge className="w-4 h-4 text-cyan-400" />
              <span>
                {totalDedicatedMbps} Mbps Upstream Utilization @ 1:{contentionRatio} ({calibratedPeakUsersTotal} Peak Concurrent Users)
              </span>
            </span>
            <span className="font-mono tabular-nums text-xs">
              <strong className={contendedRatioPct > 85 ? 'text-amber-400' : 'text-emerald-400'}>
                {contendedDemandMbps.toFixed(1)} Mbps
              </strong>{' '}
              <span className="text-slate-400">
                / {totalDedicatedMbps} Mbps ({contendedRatioPct.toFixed(1)}%)
              </span>
            </span>
          </div>
          <div className="relative h-3.5 w-full rounded-full bg-slate-900 border border-slate-800 overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                contendedRatioPct >= 100
                  ? 'bg-rose-500'
                  : contendedRatioPct >= 85
                  ? 'bg-amber-500'
                  : 'bg-emerald-500'
              }`}
              style={{ width: `${Math.min(100, contendedRatioPct)}%` }}
            />
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-amber-400"
              style={{ left: '85%' }}
              title={`85% Safe Cap (${(totalDedicatedMbps * 0.85).toFixed(1)} Mbps)`}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-400 tabular-nums">
            <span>
              Calibrated Concurrent Pool: {calibratedPeakUsersTotal} of {registeredActiveCount} subs ({(peakConcurrencyFactor * 100).toFixed(1)}%)
            </span>
            <span>
              85% Safe Ceiling: {(totalDedicatedMbps * 0.85).toFixed(1)} Mbps · CDN Pool @ 1:{contentionRatio}: {calibratedCdnDemandMbps.toFixed(1)} Mbps
            </span>
          </div>
        </div>

        {/* 6-Ratio Contention Comparison Matrix (1:1, 1:2, 1:4, 1:6, 1:8, 1:10) */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          {ratioComparisonMatrix.map((item) => {
            const isSelected = item.ratio === contentionRatio;
            return (
              <button
                key={item.ratio}
                type="button"
                onClick={() => handleQuickSelectRatio(item.ratio)}
                className={`text-left p-3 rounded-xl border transition cursor-pointer space-y-1.5 ${
                  isSelected
                    ? 'bg-sky-600/15 border-sky-500 ring-1 ring-sky-500/40'
                    : 'bg-slate-950/75 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="font-mono font-bold text-xs text-white">1:{item.ratio}</span>
                  <span
                    className={`text-[10px] font-mono font-bold ${
                      item.status === 'optimal'
                        ? 'text-emerald-400'
                        : item.status === 'tight'
                        ? 'text-amber-400'
                        : 'text-rose-400'
                    }`}
                  >
                    {item.upstreamPct.toFixed(0)}%
                  </span>
                </div>
                <div className="font-mono tabular-nums space-y-0.5 text-[11px]">
                  <div className="text-slate-300">
                    Reg CIR: <strong className="text-cyan-300">{item.regularCirMbps.toFixed(1)}M</strong>
                  </div>
                  <div className={item.cdnOverSafe240 ? 'text-amber-300' : 'text-slate-400'}>
                    CDN Pool: <strong>{item.cdnDemandMbps.toFixed(1)}M</strong>
                  </div>
                </div>
                <div className="text-[10px] font-mono text-slate-500">
                  {item.status === 'optimal'
                    ? 'Safe ≤85%'
                    : item.status === 'tight'
                    ? 'Near Cap'
                    : 'Exceeds Link'}
                </div>
              </button>
            );
          })}
        </div>

        {/* Automatic Upgrade Recommendation Banner */}
        <div
          className={`p-4 rounded-xl border flex flex-col lg:flex-row lg:items-center justify-between gap-3 ${
            upgradeRecommendation.isOver85Pct
              ? 'bg-amber-950/60 border-amber-700/80 text-amber-100'
              : 'bg-slate-950 border-slate-800 text-slate-200'
          }`}
        >
          <div className="flex items-start gap-3">
            <TrendingUp
              className={`w-5 h-5 shrink-0 mt-0.5 ${
                upgradeRecommendation.isOver85Pct ? 'text-amber-400' : 'text-cyan-400'
              }`}
            />
            <div className="space-y-1">
              <div className="text-xs font-bold text-white">
                {upgradeRecommendation.isOver85Pct
                  ? `Upstream Upgrade Recommended — Peak-Calibrated 1:${contentionRatio} Pool Exceeds 85% Safe Threshold`
                  : `Safe Onboarding Capacity: Up to +${upgradeRecommendation.additionalAvgUsers} More Subscribers Before 85% Dedicated Cap`}
              </div>
              <p className="text-xs text-slate-300 font-mono tabular-nums">
                {upgradeRecommendation.isOver85Pct ? (
                  <>
                    Peak-calibrated 1:{contentionRatio} demand ({contendedDemandMbps.toFixed(1)} Mbps @ {effectivePeakConcurrentCap} online) exceeds the 85% safe ceiling ({upgradeRecommendation.safeCeilingMbps.toFixed(1)} Mbps) on your {totalDedicatedMbps} Mbps link. Switch to 1:6–1:10 or upgrade CIR to <strong>{upgradeRecommendation.recommendedUpgradeMbps} Mbps</strong>.
                  </>
                ) : (
                  <>
                    Remaining safe CIR headroom: <strong>{upgradeRecommendation.headroomMbps.toFixed(1)} Mbps</strong> (before {upgradeRecommendation.safeCeilingMbps.toFixed(1)} Mbps cap) — supports <strong>+{upgradeRecommendation.add10M}</strong> users @ 10M, <strong>+{upgradeRecommendation.add20M}</strong> users @ 20M, or <strong>+{upgradeRecommendation.add30M}</strong> users @ 30M.
                  </>
                )}
              </p>
            </div>
          </div>

          {isAdmin && (
            <button
              type="button"
              onClick={handleOpenEditModal}
              className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 font-semibold text-xs shrink-0 transition cursor-pointer whitespace-nowrap"
            >
              Adjust CIR / Ratio
            </button>
          )}
        </div>

        {/* Package Contention Matrix Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-xs tabular-nums">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400">
                <th className="py-2.5 px-3 font-sans">Package Tier (Reg / CDN)</th>
                <th className="py-2.5 px-3 text-right">Registered</th>
                <th className="py-2.5 px-3 text-right">Online Now</th>
                <th className="py-2.5 px-3 text-right">Peak Cap (≤{effectivePeakConcurrentCap})</th>
                <th className="py-2.5 px-3 text-right">Peak Subscribed</th>
                <th className="py-2.5 px-3 text-right">1:{contentionRatio} Reg CIR</th>
                <th className="py-2.5 px-3 text-right">1:{contentionRatio} CDN Req</th>
                <th className="py-2.5 px-3 w-48">Share of {totalDedicatedMbps}M</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {packagePools.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-500">
                    No active package tiers found across subscribers.
                  </td>
                </tr>
              ) : (
                packagePools.map((pool) => (
                  <tr key={pool.tierLabel} className="hover:bg-slate-800/30">
                    <td className="py-2.5 px-3 font-sans font-bold text-white">
                      {pool.tierLabel}{' '}
                      <span className="text-[11px] font-mono font-normal text-rose-300">
                        ({pool.cdnRateMbps}M CDN)
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-200 font-semibold">
                      {pool.activeUsers}
                    </td>
                    <td className="py-2.5 px-3 text-right text-emerald-400">
                      {pool.onlineUsers}
                    </td>
                    <td className="py-2.5 px-3 text-right text-cyan-300 font-semibold">
                      {pool.peakCalibratedUsers.toFixed(1)}
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-300">
                      {Math.round(pool.peakSubscribedMbps).toLocaleString()} Mbps
                    </td>
                    <td className="py-2.5 px-3 text-right text-indigo-300 font-bold">
                      {pool.contendedCirMbps.toFixed(2)} Mbps
                    </td>
                    <td className="py-2.5 px-3 text-right text-rose-300 font-semibold">
                      {pool.peakCdnDemandMbps.toFixed(2)} Mbps
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-slate-950 border border-slate-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-indigo-500"
                            style={{ width: `${Math.min(100, pool.upstreamSharePct)}%` }}
                          />
                        </div>
                        <span className="w-14 text-right text-slate-300 font-semibold">
                          {pool.upstreamSharePct.toFixed(1)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {packagePools.length > 0 && (
              <tfoot>
                <tr className="border-t border-slate-700 bg-slate-950/70 font-bold">
                  <td className="py-2.5 px-3 font-sans text-white">Total Peak-Calibrated Fleet</td>
                  <td className="py-2.5 px-3 text-right text-white">{registeredActiveCount}</td>
                  <td className="py-2.5 px-3 text-right text-emerald-400">{pppActive.length}</td>
                  <td className="py-2.5 px-3 text-right text-cyan-300">{calibratedPeakUsersTotal}</td>
                  <td className="py-2.5 px-3 text-right text-cyan-400">
                    {Math.round(calibratedSubscribedMbps).toLocaleString()} Mbps
                  </td>
                  <td className="py-2.5 px-3 text-right text-indigo-300">
                    {contendedDemandMbps.toFixed(2)} Mbps
                  </td>
                  <td className="py-2.5 px-3 text-right text-rose-300">
                    {calibratedCdnDemandMbps.toFixed(2)} Mbps
                  </td>
                  <td className="py-2.5 px-3 text-right text-white">
                    {contendedRatioPct.toFixed(1)}% of {totalDedicatedMbps}M
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Edit Upstream Link Modal Component */}
      <EditUpstreamLinkModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        config={config}
        initialInterfaces={physicalInterfaces}
        onSaved={async (updated) => {
          setConfig(updated);
          setPeakDownloadMbps(0);
          await fetchUpstreamConfig();
          showToast(
            `Upstream capacity saved (${updated.total_dedicated_mbps} Mbps CIR · 1:${updated.contention_ratio} · ${updated.wan_interface_name}).`
          );
        }}
      />

      {/* Area & Node Manager Modal */}
      <AreaNodeManagerModal
        isOpen={isAreaManagerOpen}
        onClose={() => setIsAreaManagerOpen(false)}
        onAreasUpdated={(updated) => setNetworkAreas(updated)}
      />
    </div>
  );
};

export default CapacityPlannerView;
