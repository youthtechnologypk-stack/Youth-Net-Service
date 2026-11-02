import {
  ActiveSession,
  RouterInterface,
  MikrotikRouter,
  MikrotikPppSecret,
  MikrotikPppProfile,
} from '../types/isp';
import {
  apiClient,
  getActiveSessions,
  getProvisionedSecrets,
  getBandwidthProfiles,
  kickSession,
  createSecret,
  createScheduler,
  removeSecret,
  updateSecret,
  monitorInterfaceTrafficRest,
  getActiveRouterAuth,
  getBaseUrl,
  notifyAuthError,
  RouterAuthInfo,
} from './apiClient';

export interface FetchRouterLiveResult {
  success: boolean;
  router?: {
    cpuLoad?: number;
    memoryUsageMb?: number;
    totalMemoryMb?: number;
    uptime?: string;
    version?: string;
    model?: string;
    status: 'online' | 'unreachable';
    currentWanRxMbps?: number;
    currentWanTxMbps?: number;
  };
  activeSessions: ActiveSession[];
  interfaces: RouterInterface[];
  traffic?: {
    rxMbps: number;
    txMbps: number;
  };
  error?: string;
}

export interface FetchTelemetryOptions {
  signal?: AbortSignal;
  pollSessions?: boolean;
  pollTraffic?: boolean;
  pollSystem?: boolean;
  cachedSessions?: ActiveSession[];
  cachedInterfaces?: RouterInterface[];
}

/**
 * Re-export credentials helper for backward compatibility
 */
export const getStoredRouterAuth = getActiveRouterAuth;

/**
 * Re-export base URL helper for backward compatibility
 */
export const getMikrotikRestBaseUrl = getBaseUrl;

/**
 * Re-export auth error notification
 */
export const notifyRouterAuthError = notifyAuthError;

/**
 * Safe fetch wrapper with auth header injection and credentials: 'omit'
 */
export async function safeMikrotikFetch(
  url: string,
  init: RequestInit = {},
  activeRouter?: RouterAuthInfo
): Promise<Response> {
  const auth = getActiveRouterAuth(activeRouter);

  const incomingHeaders = (init.headers as Record<string, string>) || {};
  const headers: Record<string, string> = {
    Authorization: auth.authHeader,
    Accept: 'application/json',
    Connection: 'close',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
    ...incomingHeaders,
  };

  if (init.method && init.method !== 'GET' && init.method !== 'HEAD' && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const fetchInit: RequestInit = {
    ...init,
    headers,
    credentials: 'omit',
  };

  let res: Response;
  try {
    res = await fetch(url, fetchInit);
  } catch (err: any) {
    console.warn(`[SafeMikrotikFetch] Network error for ${url}:`, err);
    throw err;
  }

  if (res.status === 401) {
    notifyAuthError('Action failed: Router authentication error. Please verify credentials.');
  }

  return res;
}

/**
 * Direct client-side fetch for MikroTik RouterOS v7 Live Telemetry
 * Utilizes centralized apiClient with request/response interceptors
 */
export async function fetchMikrotikLiveTelemetry(
  activeRouter: {
    id?: string;
    ipAddress?: string;
    ip?: string;
    apiPort?: number;
    port?: number;
    username: string;
    password?: string;
    useSsl?: boolean;
    wanInterface?: string;
  },
  options?: FetchTelemetryOptions
): Promise<FetchRouterLiveResult> {
  const router = activeRouter;
  const targetPort = activeRouter.port || activeRouter.apiPort || 8729;
  const ip = (activeRouter.ip || activeRouter.ipAddress || '127.0.0.1').trim();

  try {
    const sessionsPromise: Promise<{ success: boolean; activeSessions: ActiveSession[]; error?: string }> =
      options?.pollSessions !== false
        ? getActiveSessions(activeRouter, options?.signal)
        : Promise.resolve({ success: true, activeSessions: options?.cachedSessions || [], error: undefined });

    const ifacesPromise = options?.pollTraffic !== false
      ? apiClient.get<any[]>('/interface', { router: activeRouter, signal: options?.signal, timeoutMs: 5000 })
      : Promise.resolve({ success: true, data: options?.cachedInterfaces || [] });

    const resourcePromise = apiClient.get<any>('/system/resource', { router: activeRouter, signal: options?.signal, timeoutMs: 5000 });

    const [sessionsRes, ifacesRes, resRes] = await Promise.all([
      sessionsPromise,
      ifacesPromise,
      resourcePromise,
    ]);

    if (!sessionsRes.success && sessionsRes.error?.includes('authentication error')) {
      return {
        success: false,
        activeSessions: options?.cachedSessions || [],
        interfaces: options?.cachedInterfaces || [],
        error: 'Action failed: Router authentication error. Please verify credentials.',
      };
    }

    const activeSessions = sessionsRes.success ? sessionsRes.activeSessions : (options?.cachedSessions || []);

    let interfaces: RouterInterface[] = options?.cachedInterfaces || [];
    let wanRxMbps = 0;
    let wanTxMbps = 0;

    if (ifacesRes.success && Array.isArray(ifacesRes.data)) {
      interfaces = ifacesRes.data.map((i: any, idx: number) => {
        const isRunning = i.running === true || i.running === 'true';
        const isDisabled = i.disabled === true || i.disabled === 'true';
        const rxRate = i['rx-rate'] ? Number(i['rx-rate']) / 1_000_000 : 0;
        const txRate = i['tx-rate'] ? Number(i['tx-rate']) / 1_000_000 : 0;

        if (i.name === router.wanInterface || idx === 0) {
          wanRxMbps = rxRate;
          wanTxMbps = txRate;
        }

        return {
          id: i['.id'] || i.id || `if-${idx}`,
          name: i.name || `ether${idx + 1}`,
          type: i.type || 'ether',
          status: isRunning ? 'running' : isDisabled ? 'disabled' : 'link_down',
          running: isRunning,
          disabled: isDisabled,
          comment: i.comment || '',
          macAddress: i['mac-address'] || '00:00:00:00:00:00',
          mtu: Number(i.mtu) || 1500,
          actualMtu: Number(i['actual-mtu']) || 1500,
          linkSpeed: i.type === 'sfp-sfpplus' ? '10Gbps' : '1Gbps',
          fullDuplex: true,
          rxBytes: Number(i['rx-byte']) || 0,
          txBytes: Number(i['tx-byte']) || 0,
          rxRateMbps: Number(rxRate.toFixed(2)),
          txRateMbps: Number(txRate.toFixed(2)),
          routerId: router.id || '',
        };
      });
    }

    let cpuLoad = 0;
    let memoryUsageMb = 0;
    let totalMemoryMb = 0;
    let uptime = '0s';
    let version = 'RouterOS v7';
    let model = 'MikroTik';

    if (resRes.success && resRes.data) {
      const r = Array.isArray(resRes.data) ? resRes.data[0] : resRes.data;
      if (r) {
        cpuLoad = Number(r['cpu-load']) || 0;
        const freeMem = Number(r['free-memory']) || 0;
        const totalMem = Number(r['total-memory']) || 0;
        totalMemoryMb = Math.round(totalMem / (1024 * 1024));
        memoryUsageMb = Math.round((totalMem - freeMem) / (1024 * 1024));
        uptime = r.uptime || '0s';
        version = r.version ? `RouterOS ${r.version}` : 'RouterOS v7';
        model = r['board-name'] || 'MikroTik';
      }
    }

    return {
      success: true,
      router: {
        status: 'online',
        cpuLoad,
        memoryUsageMb,
        totalMemoryMb,
        uptime,
        version,
        model,
        currentWanRxMbps: wanRxMbps,
        currentWanTxMbps: wanTxMbps,
      },
      activeSessions,
      interfaces,
      traffic: {
        rxMbps: wanRxMbps,
        txMbps: wanTxMbps,
      },
    };
  } catch (err: any) {
    if (err?.name === 'AbortError' || options?.signal?.aborted) {
      return {
        success: false,
        activeSessions: options?.cachedSessions || [],
        interfaces: options?.cachedInterfaces || [],
        error: 'Aborted',
      };
    }
    const isNetlifyHost = typeof window !== 'undefined' && window.location.hostname.includes('netlify.app');
    const targetDesc = isNetlifyHost ? `Netlify Proxy (/api/mikrotik -> ${ip}:${targetPort})` : `${ip}:${targetPort}`;
    return {
      success: false,
      error: `Cannot reach router at ${targetDesc} - ${err?.message || 'Check Public IP reachability, SSL cert, or CORS.'}`,
      activeSessions: options?.cachedSessions || [],
      interfaces: options?.cachedInterfaces || [],
      router: {
        status: 'unreachable',
      },
    };
  }
}

/**
 * 1. Fetch Live PPPoE Active Sessions (/api/mikrotik/ppp/active)
 */
export async function fetchMikrotikActiveSessions(
  activeRouter?: RouterAuthInfo,
  signal?: AbortSignal
): Promise<{ success: boolean; activeSessions: ActiveSession[]; error?: string }> {
  return getActiveSessions(activeRouter, signal);
}

/**
 * 2. Fetch RouterOS PPPoE Bandwidth Profiles (/rest/ppp/profile)
 */
export async function fetchMikrotikPppProfiles(
  activeRouter?: RouterAuthInfo,
  signal?: AbortSignal
): Promise<{
  success: boolean;
  profiles: Array<{ id: string; name: string; rateLimit?: string }>;
  error?: string;
}> {
  const result = await getBandwidthProfiles(activeRouter, signal);
  return {
    success: result.success,
    profiles: result.profiles,
    error: result.error,
  };
}

/**
 * 3. Provision new PPPoE Secret (/rest/ppp/secret/add)
 */
export async function provisionPppoeSecretRest(
  activeRouter: RouterAuthInfo,
  payload: {
    name: string;
    password: string;
    service?: string;
    profile?: string;
    comment?: string;
    remoteAddress?: string;
  }
): Promise<{ success: boolean; data?: any; error?: string }> {
  return createSecret(payload, activeRouter);
}

/**
 * 4. Create Native RouterOS Scheduler Entry (/rest/system/scheduler/add)
 */
export async function createMikrotikSchedulerRest(
  activeRouter: RouterAuthInfo,
  payload: {
    name: string;
    startDate: string;
    startTime: string;
    interval?: string;
    onEvent: string;
    comment?: string;
  }
): Promise<{ success: boolean; data?: any; error?: string }> {
  return createScheduler(payload, activeRouter);
}

/**
 * 5. Fetch PPPoE Secrets (/rest/ppp/secret)
 */
export async function fetchMikrotikPppSecrets(
  activeRouter?: RouterAuthInfo
): Promise<{ success: boolean; secrets: MikrotikPppSecret[]; error?: string }> {
  return getProvisionedSecrets(activeRouter);
}

/**
 * 6. Update PPPoE Secret Profile (/rest/ppp/secret/set)
 */
export async function updateMikrotikPppSecretRest(
  activeRouter: RouterAuthInfo,
  secretIdOrName: string,
  updates: {
    profile?: string;
    remoteAddress?: string;
    comment?: string;
    disabled?: boolean | string;
    password?: string;
  }
): Promise<{ success: boolean; data?: any; error?: string }> {
  return updateSecret(secretIdOrName, updates, activeRouter);
}

/**
 * 7. Disconnect / Kick Active Session (/rest/ppp/active/remove)
 */
export async function disconnectMikrotikActiveSessionRest(
  activeRouter?: RouterAuthInfo,
  sessionIdOrName?: string
): Promise<{ success: boolean; error?: string }> {
  if (!sessionIdOrName) return { success: false, error: 'Session ID required' };
  return kickSession(sessionIdOrName, activeRouter);
}

/**
 * 8. Remove PPPoE Secret (/rest/ppp/secret/remove)
 */
export async function removeMikrotikPppSecretRest(
  activeRouter?: RouterAuthInfo,
  secretIdOrName?: string
): Promise<{ success: boolean; error?: string }> {
  if (!secretIdOrName) return { success: false, error: 'Secret identifier required' };
  return removeSecret(secretIdOrName, activeRouter);
}

/**
 * 9. Real-Time Interface Throughput Monitor (/rest/interface/monitor-traffic)
 */
export async function monitorInterfaceTraffic(
  activeRouter?: RouterAuthInfo,
  signal?: AbortSignal
): Promise<{ success: boolean; rxMbps: number; txMbps: number; error?: string }> {
  const targetInterface = (activeRouter as any)?.wanInterface || 'WAN3';
  return monitorInterfaceTrafficRest(activeRouter, targetInterface, signal);
}
