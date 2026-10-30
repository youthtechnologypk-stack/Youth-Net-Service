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

/**
 * 2. Fetch RouterOS PPPoE Bandwidth Profiles (/rest/ppp/profile)
 * Resolves profile names like "10M-Unlimited", "default-encryption", etc.
 */
export async function fetchMikrotikPppProfiles(
  activeRouter?: {
    ipAddress?: string;
    ip?: string;
    apiPort?: number;
    port?: number;
    username?: string;
    password?: string;
  },
  signal?: AbortSignal
): Promise<{
  success: boolean;
  profiles: Array<{ id: string; name: string; rateLimit?: string }>;
  error?: string;
}> {
  const isBrowser = typeof window !== 'undefined';
  const targetPort = activeRouter?.port || activeRouter?.apiPort || 8729;
  const ip = (activeRouter?.ip || activeRouter?.ipAddress || '202.142.186.150').trim();
  const username = activeRouter?.username?.trim() || 'admin';
  const password = activeRouter?.password || '';

  let authHeader = '';
  try {
    authHeader = 'Basic ' + btoa(`${username}:${password}`);
  } catch {
    authHeader = 'Basic ' + btoa('admin:');
  }

  const isNetlify =
    isBrowser &&
    (window.location.hostname.includes('netlify.app') ||
      window.location.hostname.includes('youthnetw') ||
      window.location.hostname.includes('netlify') ||
      (window.location.hostname !== 'localhost' &&
        window.location.hostname !== '127.0.0.1' &&
        ip === '202.142.186.150'));

  const baseUrl = isNetlify
    ? `${window.location.origin}/api/mikrotik`
    : `https://${ip}:${targetPort}/rest`;

  const commonHeaders: Record<string, string> = {
    Authorization: authHeader,
    Accept: 'application/json',
    Connection: 'close',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    Pragma: 'no-cache',
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);
  if (signal) {
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const res = await fetch(`${baseUrl}/ppp/profile`, {
      method: 'GET',
      headers: commonHeaders,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    const rawList = Array.isArray(data) ? data : [];
    const profiles = rawList
      .map((p: any, idx: number) => ({
        ...p,
        id: p['.id'] || p.id || `prof-${idx}`,
        '.id': p['.id'] || p.id || `prof-${idx}`,
        name: p.name || `profile-${idx}`,
        'rate-limit': p['rate-limit'] || p.rateLimit || '',
        rateLimit: p['rate-limit'] || p.rateLimit || '',
        'local-address': p['local-address'] || p.localAddress || '',
        localAddress: p['local-address'] || p.localAddress || '',
        'remote-address': p['remote-address'] || p.remoteAddress || '',
        remoteAddress: p['remote-address'] || p.remoteAddress || '',
        'only-one': p['only-one'] !== undefined ? p['only-one'] : p.onlyOne,
        onlyOne: p['only-one'] !== undefined ? p['only-one'] : p.onlyOne,
      }))
      .filter((p: any) => p.name);

    return {
      success: true,
      profiles,
    };
  } catch (err: any) {
    clearTimeout(timeoutId);
    return {
      success: false,
      profiles: [],
      error: err.message,
    };
  }
}

/**
 * 3. Monitor Interface Live Traffic (/rest/interface/monitor-traffic)
 * Calls POST /api/mikrotik/interface/monitor-traffic with body {"interface": interfaceName, "once": "yes"}
 */
export async function monitorInterfaceTraffic(
  activeRouter: {
    ipAddress?: string;
    ip?: string;
    apiPort?: number;
    port?: number;
    username?: string;
    password?: string;
    uplinkInterface?: string;
    wanInterface?: string;
  },
  signal?: AbortSignal
): Promise<{
  success: boolean;
  rxMbps: number;
  txMbps: number;
  rxBps: number;
  txBps: number;
  interfaceName: string;
  error?: string;
}> {
  const isBrowser = typeof window !== 'undefined';
  const targetPort = activeRouter?.port || activeRouter?.apiPort || 8729;
  const ip = (activeRouter?.ip || activeRouter?.ipAddress || '202.142.186.150').trim();
  const username = activeRouter?.username?.trim() || 'admin';
  const password = activeRouter?.password || '';
  const ifaceName = activeRouter?.uplinkInterface || activeRouter?.wanInterface || 'WAN3';

  let authHeader = '';
  try {
    authHeader = 'Basic ' + btoa(`${username}:${password}`);
  } catch {
    authHeader = 'Basic ' + btoa('admin:');
  }

  const isNetlify =
    isBrowser &&
    (window.location.hostname.includes('netlify.app') ||
      window.location.hostname.includes('youthnetw') ||
      window.location.hostname.includes('netlify') ||
      (window.location.hostname !== 'localhost' &&
        window.location.hostname !== '127.0.0.1' &&
        ip === '202.142.186.150'));

  const baseUrl = isNetlify
    ? `${window.location.origin}/api/mikrotik`
    : `https://${ip}:${targetPort}/rest`;

  const commonHeaders: Record<string, string> = {
    Authorization: authHeader,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Connection: 'close',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    Pragma: 'no-cache',
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000);
  if (signal) {
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const res = await fetch(`${baseUrl}/interface/monitor-traffic`, {
      method: 'POST',
      headers: commonHeaders,
      body: JSON.stringify({
        interface: ifaceName,
        once: 'yes',
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    const item = Array.isArray(data) ? data[0] : data;
    const rxBps = Number(item?.['rx-bits-per-second'] ?? item?.rxBitsPerSecond ?? 0);
    const txBps = Number(item?.['tx-bits-per-second'] ?? item?.txBitsPerSecond ?? 0);
    const rxMbps = Number((rxBps / 1_000_000).toFixed(2));
    const txMbps = Number((txBps / 1_000_000).toFixed(2));

    return {
      success: true,
      rxMbps,
      txMbps,
      rxBps,
      txBps,
      interfaceName: item?.name || ifaceName,
    };
  } catch (err: any) {
    clearTimeout(timeoutId);
    return {
      success: false,
      rxMbps: 0,
      txMbps: 0,
      rxBps: 0,
      txBps: 0,
      interfaceName: ifaceName,
      error: err.message,
    };
  }
}

/**
 * 4. Provision PPPoE Secret (/rest/ppp/secret/add)
 * Creation Endpoint: POST /api/mikrotik/ppp/secret/add
 */
export async function provisionPppoeSecretRest(
  activeRouter: {
    ipAddress?: string;
    ip?: string;
    apiPort?: number;
    port?: number;
    username?: string;
    password?: string;
  },
  payload: {
    name: string;
    password: string;
    service?: string;
    profile: string;
    comment?: string;
  }
): Promise<{ success: boolean; data?: any; error?: string }> {
  const isBrowser = typeof window !== 'undefined';
  const targetPort = activeRouter?.port || activeRouter?.apiPort || 8729;
  const ip = (activeRouter?.ip || activeRouter?.ipAddress || '202.142.186.150').trim();
  const username = activeRouter?.username?.trim() || 'admin';
  const password = activeRouter?.password || '';

  let authHeader = '';
  try {
    authHeader = 'Basic ' + btoa(`${username}:${password}`);
  } catch {
    authHeader = 'Basic ' + btoa('admin:');
  }

  const isNetlify =
    isBrowser &&
    (window.location.hostname.includes('netlify.app') ||
      window.location.hostname.includes('youthnetw') ||
      window.location.hostname.includes('netlify') ||
      (window.location.hostname !== 'localhost' &&
        window.location.hostname !== '127.0.0.1' &&
        ip === '202.142.186.150'));

  const baseUrl = isNetlify
    ? `${window.location.origin}/api/mikrotik`
    : `https://${ip}:${targetPort}/rest`;

  const commonHeaders: Record<string, string> = {
    Authorization: authHeader,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Connection: 'close',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    Pragma: 'no-cache',
  };

  const bodyData = {
    name: payload.name,
    password: payload.password,
    service: payload.service || 'pppoe',
    profile: payload.profile,
    comment: payload.comment || 'YouthNet-App',
  };

  try {
    let res = await fetch(`${baseUrl}/ppp/secret/add`, {
      method: 'POST',
      headers: commonHeaders,
      body: JSON.stringify(bodyData),
    });

    if (!res.ok && (res.status === 404 || res.status === 405)) {
      res = await fetch(`${baseUrl}/ppp/secret`, {
        method: 'PUT',
        headers: commonHeaders,
        body: JSON.stringify(bodyData),
      });
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Router returned HTTP ${res.status}: ${errText || res.statusText}`);
    }

    const data = await res.json().catch(() => ({ success: true }));
    return { success: true, data };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Fetch PPPoE Secrets (/rest/ppp/secret)
 */
export async function fetchMikrotikPppSecrets(
  activeRouter?: {
    ipAddress?: string;
    ip?: string;
    apiPort?: number;
    port?: number;
    username?: string;
    password?: string;
  }
): Promise<{ success: boolean; secrets: any[]; error?: string }> {
  const isBrowser = typeof window !== 'undefined';
  const targetPort = activeRouter?.port || activeRouter?.apiPort || 8729;
  const ip = (activeRouter?.ip || activeRouter?.ipAddress || '202.142.186.150').trim();
  const username = activeRouter?.username?.trim() || 'admin';
  const password = activeRouter?.password || '';

  let authHeader = '';
  try {
    authHeader = 'Basic ' + btoa(`${username}:${password}`);
  } catch {
    authHeader = 'Basic ' + btoa('admin:');
  }

  const isNetlify =
    isBrowser &&
    (window.location.hostname.includes('netlify.app') ||
      window.location.hostname.includes('youthnetw') ||
      window.location.hostname.includes('netlify') ||
      (window.location.hostname !== 'localhost' &&
        window.location.hostname !== '127.0.0.1' &&
        ip === '202.142.186.150'));

  const baseUrl = isNetlify
    ? `${window.location.origin}/api/mikrotik`
    : `https://${ip}:${targetPort}/rest`;

  const commonHeaders: Record<string, string> = {
    Authorization: authHeader,
    Accept: 'application/json',
    Connection: 'close',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    Pragma: 'no-cache',
  };

  try {
    const res = await fetch(`${baseUrl}/ppp/secret`, {
      method: 'GET',
      headers: commonHeaders,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    const data = await res.json();
    return {
      success: true,
      secrets: Array.isArray(data) ? data : [],
    };
  } catch (err: any) {
    return {
      success: false,
      secrets: [],
      error: err.message,
    };
  }
}

/**
 * Update RouterOS PPPoE Secret Profile, Remote-Address, or Comment
 * Target Endpoint: POST /api/mikrotik/ppp/secret/set (or PATCH /ppp/secret/:id)
 */
export async function updateMikrotikPppSecretRest(
  activeRouter?: {
    ipAddress?: string;
    ip?: string;
    apiPort?: number;
    port?: number;
    username?: string;
    password?: string;
  },
  secretIdOrName?: string,
  updates?: {
    profile?: string;
    remoteAddress?: string;
    comment?: string;
    disabled?: boolean | string;
    password?: string;
  }
): Promise<{ success: boolean; data?: any; error?: string }> {
  const isBrowser = typeof window !== 'undefined';
  const targetPort = activeRouter?.port || activeRouter?.apiPort || 8729;
  const ip = (activeRouter?.ip || activeRouter?.ipAddress || '202.142.186.150').trim();
  const username = activeRouter?.username?.trim() || 'admin';
  const password = activeRouter?.password || '';

  let authHeader = '';
  try {
    authHeader = 'Basic ' + btoa(`${username}:${password}`);
  } catch {
    authHeader = 'Basic ' + btoa('admin:');
  }

  const isNetlify =
    isBrowser &&
    (window.location.hostname.includes('netlify.app') ||
      window.location.hostname.includes('youthnetw') ||
      window.location.hostname.includes('netlify') ||
      (window.location.hostname !== 'localhost' &&
        window.location.hostname !== '127.0.0.1' &&
        ip === '202.142.186.150'));

  const baseUrl = isNetlify
    ? `${window.location.origin}/api/mikrotik`
    : `https://${ip}:${targetPort}/rest`;

  const commonHeaders: Record<string, string> = {
    Authorization: authHeader,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Connection: 'close',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    Pragma: 'no-cache',
  };

  const bodyData: Record<string, any> = {};
  if (secretIdOrName) {
    bodyData['.id'] = secretIdOrName;
    bodyData['numbers'] = secretIdOrName;
  }
  if (updates?.profile) bodyData['profile'] = updates.profile;
  if (updates?.remoteAddress) bodyData['remote-address'] = updates.remoteAddress;
  if (updates?.comment !== undefined) bodyData['comment'] = updates.comment;
  if (updates?.disabled !== undefined) bodyData['disabled'] = String(updates.disabled);
  if (updates?.password) bodyData['password'] = updates.password;

  try {
    // 1. Try POST /ppp/secret/set
    let res = await fetch(`${baseUrl}/ppp/secret/set`, {
      method: 'POST',
      headers: commonHeaders,
      body: JSON.stringify(bodyData),
    });

    // 2. Fallback to PATCH /ppp/secret/:id
    if (!res.ok && (res.status === 404 || res.status === 405)) {
      const targetPath = secretIdOrName ? `${baseUrl}/ppp/secret/${encodeURIComponent(secretIdOrName)}` : `${baseUrl}/ppp/secret`;
      res = await fetch(targetPath, {
        method: 'PATCH',
        headers: commonHeaders,
        body: JSON.stringify(bodyData),
      });
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Router returned HTTP ${res.status}: ${errText || res.statusText}`);
    }

    const data = await res.json().catch(() => ({ success: true }));
    return { success: true, data };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Terminate Active Session so subscriber reconnects into restricted or updated pool
 * POST /api/mikrotik/ppp/active/remove with { ".id": activeSession[".id"] }
 */
export async function disconnectMikrotikActiveSessionRest(
  activeRouter?: {
    ipAddress?: string;
    ip?: string;
    apiPort?: number;
    port?: number;
    username?: string;
    password?: string;
  },
  sessionIdOrName?: string
): Promise<{ success: boolean; error?: string }> {
  if (!sessionIdOrName) return { success: false, error: 'Session ID or username required' };

  const isBrowser = typeof window !== 'undefined';
  const targetPort = activeRouter?.port || activeRouter?.apiPort || 8729;
  const ip = (activeRouter?.ip || activeRouter?.ipAddress || '202.142.186.150').trim();
  const username = activeRouter?.username?.trim() || 'admin';
  const password = activeRouter?.password || '';

  let authHeader = '';
  try {
    authHeader = 'Basic ' + btoa(`${username}:${password}`);
  } catch {
    authHeader = 'Basic ' + btoa('admin:');
  }

  const isNetlify =
    isBrowser &&
    (window.location.hostname.includes('netlify.app') ||
      window.location.hostname.includes('youthnetw') ||
      window.location.hostname.includes('netlify') ||
      (window.location.hostname !== 'localhost' &&
        window.location.hostname !== '127.0.0.1' &&
        ip === '202.142.186.150'));

  const baseUrl = isNetlify
    ? `${window.location.origin}/api/mikrotik`
    : `https://${ip}:${targetPort}/rest`;

  const commonHeaders: Record<string, string> = {
    Authorization: authHeader,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Connection: 'close',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    Pragma: 'no-cache',
  };

  try {
    // 1. Try POST /ppp/active/remove
    let res = await fetch(`${baseUrl}/ppp/active/remove`, {
      method: 'POST',
      headers: commonHeaders,
      body: JSON.stringify({ '.id': sessionIdOrName, numbers: sessionIdOrName }),
    });

    // 2. Fallback to DELETE /ppp/active/:id
    if (!res.ok && (res.status === 404 || res.status === 405)) {
      res = await fetch(`${baseUrl}/ppp/active/${encodeURIComponent(sessionIdOrName)}`, {
        method: 'DELETE',
        headers: commonHeaders,
      });
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Router returned HTTP ${res.status}: ${errText || res.statusText}`);
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}


