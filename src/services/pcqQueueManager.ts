import { apiClient, RouterAuthInfo } from './apiClient';

export type ContentionRatioOption = 1 | 2 | 4 | 6 | 8 | 10;
export type BurstTimeOption = '8s/8s' | '12s/12s' | '16s/16s' | '32s/32s';
export type QueuePoolKey = 'inn' | 'tw' | 'other';

export const CONTENTION_RATIOS: ContentionRatioOption[] = [1, 2, 4, 6, 8, 10];
export const BURST_TIME_OPTIONS: BurstTimeOption[] = ['8s/8s', '12s/12s', '16s/16s', '32s/32s'];

export interface MikrotikSimpleQueueRaw {
  '.id'?: string;
  id?: string;
  name?: string;
  target?: string | string[];
  'packet-marks'?: string;
  packetMarks?: string;
  queue?: string;
  'max-limit'?: string;
  'limit-at'?: string;
  'burst-limit'?: string;
  'burst-threshold'?: string;
  'burst-time'?: string;
  rate?: string;
  bytes?: string;
  packets?: string;
  disabled?: string | boolean;
  comment?: string;
}

export interface MikrotikQueueTypeRaw {
  '.id'?: string;
  id?: string;
  name?: string;
  kind?: string;
  'pcq-rate'?: string | number;
  'pcq-limit'?: string | number;
  'pcq-total-limit'?: string | number;
  'pcq-classifier'?: string;
}

export interface MikrotikActivePppSessionRaw {
  '.id'?: string;
  name?: string;
  address?: string;
  uptime?: string;
  'caller-id'?: string;
}

export interface ParsedRatePair {
  raw: string;
  uploadBps: number;
  downloadBps: number;
  uploadMbps: number;
  downloadMbps: number;
  isUnlimited: boolean;
  displayLabel: string;
}

export interface DiscoveredPoolQueue {
  id: string;
  name: string;
  target: string;
  targets: string[];
  pool: QueuePoolKey;
  packageMbps: number;
  packageLabel: string;
  packetMarks: string;
  isSpeedtest: boolean;
  disabled: boolean;
  activeUsers: number;
  matchedUsernames: string[];
  uploadQueueType: string;
  downloadQueueType: string;
  uploadPcqRateLabel: string;
  downloadPcqRateLabel: string;
  currentMaxLimit: ParsedRatePair;
  currentLimitAt: ParsedRatePair;
  currentBurstLimit: ParsedRatePair;
  currentBurstThreshold: ParsedRatePair;
  currentBurstTime: string;
  liveRate: ParsedRatePair;
  comment: string;
}

export interface CalculatedQueuePlan {
  ratioDivisor: ContentionRatioOption;
  activeUsers: number;
  effectiveUsers: number;
  packageMbps: number;
  rawDemandMbps: number;
  calculatedMaxMbps: number;
  poolMaxMbps: number;
  limitAtMbps: number;
  burstLimitMbps: number;
  burstThresholdMbps: number;
  burstTime: BurstTimeOption;
}

export interface SimpleQueuePatchPayload {
  'max-limit': string;
  'limit-at': string;
  'burst-limit': string;
  'burst-threshold': string;
  'burst-time': string;
}

export interface DiscoveredQueuesSnapshot {
  queues: DiscoveredPoolQueue[];
  innQueues: DiscoveredPoolQueue[];
  twQueues: DiscoveredPoolQueue[];
  otherQueues: DiscoveredPoolQueue[];
  excludedSpeedtestQueues: DiscoveredPoolQueue[];
  queueTypes: MikrotikQueueTypeRaw[];
  activeSessionsCount: number;
  fetchedAtIso: string;
}

/**
 * Parse a single RouterOS bit-rate string such as "20M", "512k", "1G", "20000000", "0" into bps.
 */
export function parseRouterOsBpsToken(token?: string | number | null): number {
  if (token === undefined || token === null) return 0;
  const raw = String(token).trim();
  if (!raw || raw === '0') return 0;

  const match = raw.match(/^(\d+(?:\.\d+)?)\s*([kKmMgG]?)$/);
  if (!match) return 0;
  const num = Number(match[1]);
  if (!Number.isFinite(num) || num <= 0) return 0;

  const unit = match[2].toLowerCase();
  if (unit === 'g') return Math.round(num * 1_000_000_000);
  if (unit === 'm') return Math.round(num * 1_000_000);
  if (unit === 'k') return Math.round(num * 1_000);
  return Math.round(num);
}

export function formatBpsShort(bps: number): string {
  if (!bps || bps <= 0) return '0';
  if (bps >= 1_000_000_000 && bps % 1_000_000_000 === 0) {
    return `${bps / 1_000_000_000}G`;
  }
  if (bps >= 1_000_000) {
    const mbps = bps / 1_000_000;
    return Number.isInteger(mbps) ? `${mbps}M` : `${mbps.toFixed(2)}M`;
  }
  if (bps >= 1_000) {
    const kbps = bps / 1_000;
    return Number.isInteger(kbps) ? `${kbps}k` : `${kbps.toFixed(1)}k`;
  }
  return `${bps}bps`;
}

/**
 * Parse RouterOS "upload/download" pair e.g. "20000000/20000000", "20M/20M", or "0/0".
 */
export function parseRouterOsRatePair(rawValue?: string | null): ParsedRatePair {
  const raw = String(rawValue || '').trim();
  if (!raw) {
    return {
      raw: '0/0',
      uploadBps: 0,
      downloadBps: 0,
      uploadMbps: 0,
      downloadMbps: 0,
      isUnlimited: true,
      displayLabel: 'Unlimited (0/0)',
    };
  }

  const parts = raw.split('/');
  const uploadBps = parseRouterOsBpsToken(parts[0]);
  const downloadBps = parseRouterOsBpsToken(parts[1] ?? parts[0]);
  const isUnlimited = uploadBps === 0 && downloadBps === 0;

  return {
    raw,
    uploadBps,
    downloadBps,
    uploadMbps: Math.round((uploadBps / 1_000_000) * 100) / 100,
    downloadMbps: Math.round((downloadBps / 1_000_000) * 100) / 100,
    isUnlimited,
    displayLabel: isUnlimited
      ? 'Unlimited (0/0)'
      : `${formatBpsShort(uploadBps)}/${formatBpsShort(downloadBps)}`,
  };
}

/**
 * Convert IPv4 string to unsigned 32-bit integer.
 */
export function ipv4ToUint32(ip?: string | null): number | null {
  const clean = String(ip || '').trim();
  const parts = clean.split('.');
  if (parts.length !== 4) return null;
  let acc = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const octet = Number(part);
    if (octet < 0 || octet > 255) return null;
    acc = (acc << 8) | octet;
  }
  return acc >>> 0;
}

/**
 * Check if an IPv4 address belongs to a CIDR block (e.g., "80.10.4.0/24") or single IP.
 */
export function cidrContainsIp(cidrOrIp: string, candidateIp: string): boolean {
  const ipNum = ipv4ToUint32(candidateIp);
  if (ipNum === null) return false;

  const clean = cidrOrIp.trim();
  if (!clean) return false;

  const [netPart, prefixPart] = clean.split('/');
  const netNum = ipv4ToUint32(netPart);
  if (netNum === null) return false;

  const prefix = prefixPart !== undefined ? Number(prefixPart) : 32;
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
  if (prefix === 0) return true;

  const mask = (~0 << (32 - prefix)) >>> 0;
  return (ipNum & mask) === (netNum & mask);
}

/**
 * Strictly identify Speed-PKT speedtest queues so they are never throttled or modified.
 */
export function isSpeedtestQueue(queue: MikrotikSimpleQueueRaw): boolean {
  const packetMarks = String(queue['packet-marks'] || queue.packetMarks || '').trim();
  return packetMarks.toLowerCase().includes('speed-pkt');
}

/**
 * Classify a queue into Multinet/Inn (80.10.x.0/24), Transworld/TW (60.10.x.0/24), or Other.
 */
export function classifyQueuePool(name: string, targets: string[]): QueuePoolKey {
  const joinedTargets = targets.join(',');
  if (/(^|,|\s)80\.10\./.test(joinedTargets)) return 'inn';
  if (/(^|,|\s)60\.10\./.test(joinedTargets)) return 'tw';

  const cleanName = name.trim();
  if (/(\b|-)inn\b/i.test(cleanName)) return 'inn';
  if (/(\b|-)tw\b/i.test(cleanName)) return 'tw';
  return 'other';
}

/**
 * Extract numeric package bandwidth in Mbps from queue name (e.g. "2 MB -Inn", "15 MB - Tw"),
 * falling back to PCQ queue type name or current max-limit.
 */
export function extractPackageMbpsFromQueue(
  name: string,
  downloadQueueType: string,
  currentMaxLimit: ParsedRatePair
): number {
  const fromName = name.match(/(\d+(?:\.\d+)?)\s*(?:mbps|mb|m\b)/i) || name.match(/^(\d+(?:\.\d+)?)\b/);
  if (fromName) {
    const val = Number(fromName[1]);
    if (Number.isFinite(val) && val > 0) return val;
  }

  const fromPcq = downloadQueueType.match(/(\d+(?:\.\d+)?)\s*(?:mbps|mb|m\b)/i);
  if (fromPcq) {
    const val = Number(fromPcq[1]);
    if (Number.isFinite(val) && val > 0) return val;
  }

  if (!currentMaxLimit.isUnlimited && currentMaxLimit.downloadMbps > 0) {
    return currentMaxLimit.downloadMbps;
  }

  return 2;
}

/**
 * Parse RouterOS queue types string e.g. "6 MB - U/6 MB - D".
 */
export function parseQueueTypesPair(rawQueueField?: string | null): {
  uploadQueueType: string;
  downloadQueueType: string;
} {
  const clean = String(rawQueueField || '').trim();
  if (!clean) {
    return { uploadQueueType: 'default-small', downloadQueueType: 'default-small' };
  }
  const parts = clean.split('/').map((s) => s.trim());
  return {
    uploadQueueType: parts[0] || 'default-small',
    downloadQueueType: parts[1] || parts[0] || 'default-small',
  };
}

/**
 * Compute default burst-time for a given contention ratio.
 * 1:2-1:8 => 16s/16s (also 16s/16s for 1:1), 1:10 => 12s/12s.
 */
export function getDefaultBurstTimeForRatio(ratioDivisor: ContentionRatioOption): BurstTimeOption {
  return ratioDivisor === 10 ? '12s/12s' : '16s/16s';
}

/**
 * Exact Ratio (1:1 to 1:10) & Auto-Burst Calculation Engine.
 */
export function calculateQueueRatioPlan(params: {
  activeUsers: number;
  packageMbps: number;
  ratioDivisor: ContentionRatioOption;
  overrideMaxMbps?: number;
  burstTime?: BurstTimeOption;
}): CalculatedQueuePlan {
  const packageMbps = Math.max(1, Number(params.packageMbps) || 1);
  const activeUsers = Math.max(0, Math.floor(Number(params.activeUsers) || 0));
  const effectiveUsers = Math.max(1, activeUsers);
  const ratioDivisor = params.ratioDivisor;

  const rawDemandMbps = effectiveUsers * packageMbps;
  const calculatedMaxMbps = Math.max(packageMbps, Math.ceil(rawDemandMbps / ratioDivisor));

  const hasValidOverride =
    params.overrideMaxMbps !== undefined &&
    Number.isFinite(params.overrideMaxMbps) &&
    params.overrideMaxMbps > 0;
  const poolMaxMbps = hasValidOverride
    ? Math.max(1, Math.round(params.overrideMaxMbps!))
    : calculatedMaxMbps;

  const limitAtMbps = Math.max(1, Math.round(poolMaxMbps * 0.5));
  const burstLimitMbps = Math.max(poolMaxMbps, Math.round(poolMaxMbps * 1.25));
  const burstThresholdMbps = Math.max(1, Math.round(poolMaxMbps * 0.75));
  const burstTime = params.burstTime || getDefaultBurstTimeForRatio(ratioDivisor);

  return {
    ratioDivisor,
    activeUsers,
    effectiveUsers,
    packageMbps,
    rawDemandMbps,
    calculatedMaxMbps,
    poolMaxMbps,
    limitAtMbps,
    burstLimitMbps,
    burstThresholdMbps,
    burstTime,
  };
}

export function buildApplyPatchPayload(plan: CalculatedQueuePlan): SimpleQueuePatchPayload {
  return {
    'max-limit': `${plan.poolMaxMbps}M/${plan.poolMaxMbps}M`,
    'limit-at': `${plan.limitAtMbps}M/${plan.limitAtMbps}M`,
    'burst-limit': `${plan.burstLimitMbps}M/${plan.burstLimitMbps}M`,
    'burst-threshold': `${plan.burstThresholdMbps}M/${plan.burstThresholdMbps}M`,
    'burst-time': plan.burstTime,
  };
}

export function buildUnlimitedResetPayload(burstTimeReset: '0/0' | '0s/0s' = '0/0'): SimpleQueuePatchPayload {
  return {
    'max-limit': '0/0',
    'limit-at': '0/0',
    'burst-limit': '0/0',
    'burst-threshold': '0/0',
    'burst-time': burstTimeReset,
  };
}

/**
 * Pure transformer converting raw RouterOS /rest/queue/simple, /rest/queue/type, and /rest/ppp/active
 * datasets into grouped, Speed-PKT-protected queue cards with live subnet user counts.
 */
export function buildDiscoveredQueuesSnapshot(params: {
  rawQueues: MikrotikSimpleQueueRaw[];
  queueTypes: MikrotikQueueTypeRaw[];
  activeSessions: MikrotikActivePppSessionRaw[];
  fetchedAtIso?: string;
}): DiscoveredQueuesSnapshot {
  const typeByName = new Map<string, MikrotikQueueTypeRaw>();
  for (const qt of params.queueTypes || []) {
    const key = String(qt?.name || '').trim().toLowerCase();
    if (key) typeByName.set(key, qt);
  }

  const resolvePcqRateLabel = (typeName: string): string => {
    const qt = typeByName.get(typeName.trim().toLowerCase());
    if (!qt) return typeName;
    const pcqRateBps = parseRouterOsBpsToken(qt['pcq-rate']);
    if (pcqRateBps > 0) {
      return `${formatBpsShort(pcqRateBps)} PCQ`;
    }
    return qt.kind ? `${qt.kind.toUpperCase()}` : typeName;
  };

  const normalizeTargets = (rawTarget?: string | string[]): string[] => {
    if (Array.isArray(rawTarget)) {
      return rawTarget.map((t) => String(t).trim()).filter(Boolean);
    }
    return String(rawTarget || '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
  };

  const innQueues: DiscoveredPoolQueue[] = [];
  const twQueues: DiscoveredPoolQueue[] = [];
  const otherQueues: DiscoveredPoolQueue[] = [];
  const excludedSpeedtestQueues: DiscoveredPoolQueue[] = [];
  const queues: DiscoveredPoolQueue[] = [];

  for (const raw of params.rawQueues || []) {
    const id = String(raw['.id'] || raw.id || '').trim();
    const name = String(raw.name || '').trim();
    if (!id && !name) continue;

    const targets = normalizeTargets(raw.target);
    const targetDisplay = targets.join(', ') || '0.0.0.0/0';
    const packetMarks = String(raw['packet-marks'] || raw.packetMarks || '').trim();
    const speedtest = isSpeedtestQueue(raw);
    const pool = classifyQueuePool(name, targets);

    const { uploadQueueType, downloadQueueType } = parseQueueTypesPair(raw.queue);
    const currentMaxLimit = parseRouterOsRatePair(raw['max-limit']);
    const currentLimitAt = parseRouterOsRatePair(raw['limit-at']);
    const currentBurstLimit = parseRouterOsRatePair(raw['burst-limit']);
    const currentBurstThreshold = parseRouterOsRatePair(raw['burst-threshold']);
    const currentBurstTime = String(raw['burst-time'] || '0/0').trim() || '0/0';
    const liveRate = parseRouterOsRatePair(raw.rate);

    const packageMbps = extractPackageMbpsFromQueue(name, downloadQueueType, currentMaxLimit);
    const packageLabel = `${packageMbps} MB`;

    // Match online PPPoE sessions by IP subnet
    const matchedUserSet = new Set<string>();
    if (targets.length > 0) {
      for (const sess of params.activeSessions || []) {
        const ip = String(sess?.address || '').trim();
        if (!ip) continue;
        if (targets.some((cidr) => cidrContainsIp(cidr, ip))) {
          matchedUserSet.add(String(sess?.name || ip).trim());
        }
      }
    }

    const item: DiscoveredPoolQueue = {
      id,
      name: name || targetDisplay,
      target: targetDisplay,
      targets,
      pool,
      packageMbps,
      packageLabel,
      packetMarks,
      isSpeedtest: speedtest,
      disabled: raw.disabled === true || raw.disabled === 'true',
      activeUsers: matchedUserSet.size,
      matchedUsernames: Array.from(matchedUserSet),
      uploadQueueType,
      downloadQueueType,
      uploadPcqRateLabel: resolvePcqRateLabel(uploadQueueType),
      downloadPcqRateLabel: resolvePcqRateLabel(downloadQueueType),
      currentMaxLimit,
      currentLimitAt,
      currentBurstLimit,
      currentBurstThreshold,
      currentBurstTime,
      liveRate,
      comment: String(raw.comment || '').trim(),
    };

    if (speedtest) {
      excludedSpeedtestQueues.push(item);
      continue;
    }

    queues.push(item);
    if (pool === 'inn') {
      innQueues.push(item);
    } else if (pool === 'tw') {
      twQueues.push(item);
    } else {
      otherQueues.push(item);
    }
  }

  const sortByTier = (a: DiscoveredPoolQueue, b: DiscoveredPoolQueue) => {
    if (a.packageMbps !== b.packageMbps) return a.packageMbps - b.packageMbps;
    return a.name.localeCompare(b.name);
  };

  innQueues.sort(sortByTier);
  twQueues.sort(sortByTier);
  otherQueues.sort(sortByTier);
  queues.sort(sortByTier);
  excludedSpeedtestQueues.sort(sortByTier);

  return {
    queues,
    innQueues,
    twQueues,
    otherQueues,
    excludedSpeedtestQueues,
    queueTypes: params.queueTypes || [],
    activeSessionsCount: (params.activeSessions || []).length,
    fetchedAtIso: params.fetchedAtIso || new Date().toISOString(),
  };
}

/**
 * Fetch /rest/queue/simple, /rest/queue/type, and /rest/ppp/active exclusively via /api/mikrotik/...
 */
export async function fetchMikrotikQueuesSnapshot(
  router?: RouterAuthInfo
): Promise<{ success: boolean; snapshot?: DiscoveredQueuesSnapshot; error?: string }> {
  const [simpleRes, typesRes, activeRes] = await Promise.all([
    apiClient.get<MikrotikSimpleQueueRaw[]>('/queue/simple', { router, timeoutMs: 7500 }),
    apiClient.get<MikrotikQueueTypeRaw[]>('/queue/type', { router, timeoutMs: 7500 }),
    apiClient.get<MikrotikActivePppSessionRaw[]>('/ppp/active', { router, timeoutMs: 7500 }),
  ]);

  if (!simpleRes.success || !Array.isArray(simpleRes.data)) {
    return {
      success: false,
      error: simpleRes.error || 'Unable to fetch /rest/queue/simple via /api/mikrotik proxy',
    };
  }

  const queueTypes = typesRes.success && Array.isArray(typesRes.data) ? typesRes.data : [];
  const activeSessions = activeRes.success && Array.isArray(activeRes.data) ? activeRes.data : [];

  return {
    success: true,
    snapshot: buildDiscoveredQueuesSnapshot({
      rawQueues: simpleRes.data,
      queueTypes,
      activeSessions,
    }),
  };
}

/**
 * PATCH /rest/queue/simple/{id} via /api/mikrotik/... with Ratio & Auto-Burst settings.
 * Never modifies /rest/queue/type (preserves per-user PCQ caps).
 */
export async function applyRatioBurstToSimpleQueue(
  queue: DiscoveredPoolQueue,
  plan: CalculatedQueuePlan,
  router?: RouterAuthInfo
): Promise<{ success: boolean; payload: SimpleQueuePatchPayload; error?: string }> {
  if (queue.isSpeedtest) {
    return {
      success: false,
      payload: buildApplyPatchPayload(plan),
      error: `Refused: ${queue.name} is a protected Speed-PKT queue.`,
    };
  }
  if (!queue.id) {
    return {
      success: false,
      payload: buildApplyPatchPayload(plan),
      error: `Missing RouterOS .id for queue ${queue.name}`,
    };
  }

  const payload = buildApplyPatchPayload(plan);
  const res = await apiClient.patch(
    `/queue/simple/${encodeURIComponent(queue.id)}`,
    payload,
    { router, timeoutMs: 7500 }
  );

  if (!res.success) {
    return {
      success: false,
      payload,
      error: res.error || `Failed to update ${queue.name}`,
    };
  }

  return { success: true, payload };
}

/**
 * Safety Reset: PATCH /rest/queue/simple/{id} reverting limits back to "0/0".
 */
export async function resetSimpleQueueToUnlimited(
  queue: DiscoveredPoolQueue,
  router?: RouterAuthInfo
): Promise<{ success: boolean; payload: SimpleQueuePatchPayload; error?: string }> {
  if (queue.isSpeedtest) {
    return {
      success: false,
      payload: buildUnlimitedResetPayload('0/0'),
      error: `Refused: ${queue.name} is a protected Speed-PKT queue.`,
    };
  }
  if (!queue.id) {
    return {
      success: false,
      payload: buildUnlimitedResetPayload('0/0'),
      error: `Missing RouterOS .id for queue ${queue.name}`,
    };
  }

  const payload = buildUnlimitedResetPayload('0/0');
  let res = await apiClient.patch(
    `/queue/simple/${encodeURIComponent(queue.id)}`,
    payload,
    { router, timeoutMs: 7500 }
  );

  // Fallback for RouterOS versions that require "0s/0s" for burst-time
  if (!res.success && res.status === 400) {
    const fallbackPayload = buildUnlimitedResetPayload('0s/0s');
    res = await apiClient.patch(
      `/queue/simple/${encodeURIComponent(queue.id)}`,
      fallbackPayload,
      { router, timeoutMs: 7500 }
    );
    if (res.success) {
      return { success: true, payload: fallbackPayload };
    }
  }

  if (!res.success) {
    return {
      success: false,
      payload,
      error: res.error || `Failed to reset ${queue.name}`,
    };
  }

  return { success: true, payload };
}
