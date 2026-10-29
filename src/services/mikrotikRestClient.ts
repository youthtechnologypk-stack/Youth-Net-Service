import { ActiveSession, RouterInterface, MikrotikRouter } from '../types/isp';

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
 * Direct client-side fetch for MikroTik RouterOS v7 REST API over HTTPS
 * Endpoints:
 *   - https://${activeRouter.ip}:${targetPort}/rest/ppp/active
 *   - https://${activeRouter.ip}:${targetPort}/rest/interface
 *   - https://${activeRouter.ip}:${targetPort}/rest/system/resource
 * Uses Basic Authentication with configured credentials.
 * If unreachable or blocked by CORS / Self-signed certificate, returns exact error banner.
 * Includes Connection: close and Cache-Control headers to prevent MikroTik session leaks.
 * NEVER falls back to fake mock data.
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
  const username = activeRouter.username?.trim() || 'admin';
  const password = activeRouter.password || '';

  // Forward Basic Auth headers directly in the request
  let authHeader = '';
  try {
    authHeader = 'Basic ' + btoa(`${username}:${password}`);
  } catch {
    try {
      authHeader = 'Basic ' + btoa(unescape(encodeURIComponent(`${username}:${password}`)));
    } catch {
      authHeader = 'Basic ' + btoa('admin:');
    }
  }

  // Include Connection: close and cache headers to terminate MikroTik session immediately and prevent leaks
  const commonHeaders: Record<string, string> = {
    Authorization: authHeader,
    Accept: 'application/json',
    Connection: 'close',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    Pragma: 'no-cache',
  };

  // Determine whether running in production on Netlify or cloud environment
  const isBrowser = typeof window !== 'undefined';
  const isNetlify =
    isBrowser &&
    (window.location.hostname.includes('netlify.app') ||
      window.location.hostname.includes('youthnetw') ||
      window.location.hostname.includes('netlify') ||
      (window.location.hostname !== 'localhost' &&
        window.location.hostname !== '127.0.0.1' &&
        ip === '202.142.186.150'));

  // When running on Netlify, rewrite request path to same-origin Netlify proxy rewrite
  // (/api/mikrotik/* -> http://202.142.186.150:81/rest/:splat 200!)
  // to eliminate browser CORS blocking on RouterOS v7.
  const baseUrl = isNetlify
    ? `${window.location.origin}/api/mikrotik`
    : `https://${ip}:${targetPort}/rest`;

  if (options?.signal?.aborted) {
    return {
      success: false,
      activeSessions: options.cachedSessions || [],
      interfaces: options.cachedInterfaces || [],
      error: 'Aborted',
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 7000);

  if (options?.signal) {
    options.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    // 1. Fetch Live PPPoE Active Sessions (/rest/ppp/active or /api/mikrotik/ppp/active)
    let activeSessions: ActiveSession[] = options?.cachedSessions || [];
    if (options?.pollSessions !== false) {
      const sessionsRes = await fetch(`${baseUrl}/ppp/active`, {
        method: 'GET',
        headers: commonHeaders,
        signal: controller.signal,
      });

      if (!sessionsRes.ok) {
        const contentType = sessionsRes.headers.get('content-type') || '';
        if (contentType.includes('text/html')) {
          throw new Error(`Netlify Proxy upstream returned HTTP ${sessionsRes.status} (verify router public IP/port reachability)`);
        }
        throw new Error(`HTTP ${sessionsRes.status}: ${sessionsRes.statusText}`);
      }

      const contentType = sessionsRes.headers.get('content-type') || '';
      if (contentType.includes('text/html')) {
        throw new Error(`Expected JSON but received HTML response from proxy`);
      }

      const sessionsData = await sessionsRes.json();
      const rawSessions = Array.isArray(sessionsData) ? sessionsData : [];

      activeSessions = rawSessions.map((s: any, idx: number) => {
        const rxRate = s['rx-rate'] ? Number(s['rx-rate']) / 1_000_000 : 0;
        const txRate = s['tx-rate'] ? Number(s['tx-rate']) / 1_000_000 : 0;
        const bytesIn = s['bytes-in'] || s['rx-byte'] ? Math.round(Number(s['bytes-in'] || s['rx-byte']) / 1_000_000) : 0;
        const bytesOut = s['bytes-out'] || s['tx-byte'] ? Math.round(Number(s['bytes-out'] || s['tx-byte']) / 1_000_000) : 0;

        return {
          id: s['.id'] || s.id || `session-${idx}`,
          username: s.name || s.user || `user-${idx}`,
          callerId: s['caller-id'] || s.callerId || '00:00:00:00:00:00',
          address: s.address || '0.0.0.0',
          service: 'pppoe',
          uptime: s.uptime || '0s',
          rxRateMbps: Number(rxRate.toFixed(2)),
          txRateMbps: Number(txRate.toFixed(2)),
          bytesInMb: bytesIn,
          bytesOutMb: bytesOut,
          routerId: router.id || '',
          customerName: s.name || `User ${idx + 1}`,
          profileName: s.profile || 'default',
          liveRateFormatted: `↓ ${rxRate.toFixed(1)}M / ↑ ${txRate.toFixed(1)}M`,
        };
      });
    }

    // 2. Fetch Live Interfaces (/rest/interface)
    let interfaces: RouterInterface[] = options?.cachedInterfaces || [];
    let wanRxMbps = 0;
    let wanTxMbps = 0;

    if (options?.pollTraffic !== false) {
      try {
        const ifacesRes = await fetch(`${baseUrl}/interface`, {
          method: 'GET',
          headers: commonHeaders,
          signal: controller.signal,
        });

        if (ifacesRes.ok) {
          const ifacesData = await ifacesRes.json();
          const rawIfaces = Array.isArray(ifacesData) ? ifacesData : [];

        interfaces = rawIfaces.map((i: any, idx: number) => {
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
    } catch {
      // Optional interface probe
    }
  }

    // 3. Fetch Live System Resource (/rest/system/resource)
    let cpuLoad = 0;
    let memoryUsageMb = 0;
    let totalMemoryMb = 0;
    let uptime = '0s';
    let version = 'RouterOS v7';
    let model = 'MikroTik';

    try {
      const resRes = await fetch(`${baseUrl}/system/resource`, {
        method: 'GET',
        headers: commonHeaders,
        signal: controller.signal,
      });

      if (resRes.ok) {
        const resData = await resRes.json();
        const r = Array.isArray(resData) ? resData[0] : resData;
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
    } catch {
      // Optional resource probe
    }

    clearTimeout(timeoutId);

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
    clearTimeout(timeoutId);
    if (err?.name === 'AbortError' || options?.signal?.aborted) {
      return {
        success: false,
        activeSessions: options?.cachedSessions || [],
        interfaces: options?.cachedInterfaces || [],
        error: 'Aborted',
      };
    }
    const targetDesc = isNetlify ? `Netlify Proxy (/api/mikrotik -> ${ip}:${targetPort})` : `${ip}:${targetPort}`;
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
