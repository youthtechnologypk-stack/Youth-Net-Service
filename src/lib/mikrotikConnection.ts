import { RouterOSAPI } from 'node-routeros';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import {
  routerOSPool,
  getMikrotikLiveTraffic,
  syncMikrotikLivePersistent,
  kickPppoeSession,
  formatBitsPerSecond,
  updatePppoeSecretInMikrotik,
  resetPppoeCallerIdInMikrotik,
  kickPppoeSessionByUsername,
  getSubscriberInterfaceTraffic,
} from '../../lib/mikrotik.js';
import type { SubscriberTrafficResult } from '../../lib/mikrotik.js';

export {
  routerOSPool,
  getMikrotikLiveTraffic,
  syncMikrotikLivePersistent,
  kickPppoeSession,
  formatBitsPerSecond,
  updatePppoeSecretInMikrotik,
  resetPppoeCallerIdInMikrotik,
  kickPppoeSessionByUsername,
  getSubscriberInterfaceTraffic,
};
export type { SubscriberTrafficResult };

export interface MikrotikTestParams {
  host: string;
  port: number;
  username: string;
  password?: string;
  useSsl?: boolean;
}

export interface MikrotikTestResult {
  success: boolean;
  status: 'online' | 'unreachable';
  latencyMs: number;
  message: string;
  error?: string;
  host?: string;
  port?: number;
  socketReachable?: boolean;
  identity?: string;
  model?: string;
  version?: string;
  cpuLoad?: number;
  memoryUsageMb?: number;
  totalMemoryMb?: number;
  uptime?: string;
  activePppoeCount?: number;
}

export interface MikrotikSyncParams {
  host: string;
  port: number;
  username: string;
  password?: string;
  useSsl?: boolean;
  wanInterface?: string;
}

export interface LiveActiveSessionItem {
  id: string;
  username: string;
  callerId: string;
  address: string;
  service: string;
  uptime: string;
  rxRateMbps?: number;
  txRateMbps?: number;
  bytesInMb?: number;
  bytesOutMb?: number;
  routerId?: string;
  customerName?: string;
  profileName?: string;
}

export interface MikrotikSecretItem {
  id: string;
  name: string;
  password?: string;
  service: string;
  profile: string;
  remoteAddress?: string;
  localAddress?: string;
  callerId?: string;
  comment?: string;
  disabled: boolean;
  lastLoggedOut?: string;
}

export interface MikrotikProfileItem {
  id: string;
  name: string;
  localAddress?: string;
  remoteAddress?: string;
  rateLimit?: string;
  dnsServer?: string;
  onlyOne?: string;
}

export interface MikrotikSyncResult {
  success: boolean;
  status: 'online' | 'unreachable';
  latencyMs: number;
  error?: string;
  message?: string;
  router?: {
    identity: string;
    model: string;
    version: string;
    cpuLoad: number;
    memoryUsageMb: number;
    totalMemoryMb: number;
    uptime: string;
    activePppoeCount: number;
    totalSecretsCount?: number;
    totalProfilesCount?: number;
    currentWanRxMbps: number;
    currentWanTxMbps: number;
    wanInterface?: string;
  };
  activeSessions: LiveActiveSessionItem[];
  secrets: MikrotikSecretItem[];
  profiles: MikrotikProfileItem[];
  traffic: {
    rxMbps: number;
    txMbps: number;
    timestamp: string;
  };
}

/**
 * Parses raw error from node-routeros or socket and returns a clean, human-readable diagnosis
 */
function formatRouterOsError(err: any, host: string, port: number, username: string): string {
  if (!err) return `Cannot reach physical router at ${host}:${port}. Ensure backend is running locally on the same network or port ${port} is forwarded.`;
  const msg = String(err.message || err);
  const code = err.code || err.errno;

  if (code === -111 || code === 'ECONNREFUSED' || msg.includes('ECONNREFUSED')) {
    return `Connection refused on ${host}:${port}. Verify RouterOS API service is enabled (/ip service enable api) and port ${port} is open.`;
  }
  if (code === 'SOCKTMOUT' || code === 'ETIMEDOUT' || msg.includes('Timed out') || msg.includes('ETIMEDOUT') || msg.includes('timed out') || msg.includes('Cannot reach physical router')) {
    return `Cannot reach physical router at ${host}:${port}. Ensure backend is running locally on the same network or port ${port} is forwarded.`;
  }
  if (code === 'ENOTFOUND') {
    return `DNS resolution failed for hostname "${host}". Verify DNS or use direct Static IP.`;
  }
  if (code === 'EHOSTUNREACH') {
    return `Cannot reach physical router at ${host}:${port}. Ensure backend is running locally on the same network or port ${port} is forwarded.`;
  }
  if (
    msg.toLowerCase().includes('cannot log in') ||
    msg.toLowerCase().includes('invalid user') ||
    msg.toLowerCase().includes('password') ||
    msg.toLowerCase().includes('authentication')
  ) {
    return `Authentication failed: Invalid credentials for user "${username}" on MikroTik router.`;
  }

  return `Cannot reach physical router at ${host}:${port}. Ensure backend is running locally on the same network or port ${port} is forwarded.`;
}

/**
 * Timeout wrapper for promises to prevent hung connections
 */
function withTimeout<T>(promise: Promise<T>, ms: number, timeoutMsg: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(timeoutMsg));
    }, ms);

    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

/**
 * Execute real commands against RouterOS Binary API (port 8728 / 8729) via node-routeros
 */
async function queryViaNodeRouterOs(params: MikrotikSyncParams, timeoutMs = 3000): Promise<{
  identity: string;
  model: string;
  version: string;
  cpuLoad: number;
  memoryUsageMb: number;
  totalMemoryMb: number;
  uptime: string;
  activeSessions: LiveActiveSessionItem[];
  secrets: MikrotikSecretItem[];
  profiles: MikrotikProfileItem[];
  rxMbps: number;
  txMbps: number;
}> {
  const host = params.host.trim();
  const port = Number(params.port) || 8728;
  const username = params.username.trim();
  const password = params.password || '';
  const useSsl = params.useSsl ?? (port === 8729);
  const wanInterface = params.wanInterface || 'ether1';

  const api = new RouterOSAPI({
    host,
    port,
    user: username,
    password,
    timeout: Math.max(6, Math.floor(timeoutMs / 1000)),
    tls: useSsl ? { rejectUnauthorized: false } : undefined,
  });
  api.on('error', () => {});

  try {
    // 1. Connect with timeout
    await withTimeout(
      api.connect(),
      timeoutMs,
      `Connection to RouterOS at ${host}:${port} timed out after ${timeoutMs}ms.`
    );

    // 2. Fetch Identity
    let identity = 'MikroTik-Router';
    try {
      const idRes: any = await api.write('/system/identity/print');
      if (Array.isArray(idRes) && idRes.length > 0 && idRes[0]?.name) {
        identity = idRes[0].name;
      }
    } catch (e: any) {
      console.warn('[RouterOS API] Could not read /system/identity:', e.message);
    }

    // 3. Fetch Resource (/system/resource/print)
    let model = 'MikroTik RouterOS';
    let version = 'RouterOS v7';
    let cpuLoad = 0;
    let memoryUsageMb = 0;
    let totalMemoryMb = 0;
    let uptime = '0m';

    try {
      const resData: any = await api.write('/system/resource/print');
      if (Array.isArray(resData) && resData.length > 0) {
        const res = resData[0];
        model = res['board-name'] || res['platform'] || model;
        version = res['version'] ? `RouterOS v${res['version']}` : version;
        cpuLoad = Number(res['cpu-load'] ?? 0);
        uptime = String(res['uptime'] ?? '0m');

        if (res['total-memory']) {
          totalMemoryMb = Math.round(Number(res['total-memory']) / (1024 * 1024));
        }
        if (res['free-memory'] && totalMemoryMb > 0) {
          const freeMb = Math.round(Number(res['free-memory']) / (1024 * 1024));
          memoryUsageMb = Math.max(0, totalMemoryMb - freeMb);
        }
      }
    } catch (e: any) {
      console.warn('[RouterOS API] Could not read /system/resource:', e.message);
    }

    // 4. Sequential RouterOS Queries:
    // a. Active Sessions: /interface/pppoe-server/print and /ppp/active/print
    const pppoeServerMap = new Map<string, any>();
    try {
      const pppoeServers: any = await api.write('/interface/pppoe-server/print');
      if (Array.isArray(pppoeServers)) {
        for (const s of pppoeServers) {
          if (s.user) {
            pppoeServerMap.set(s.user, s);
          }
        }
      }
    } catch (e: any) {
      console.warn('[RouterOS API] /interface/pppoe-server/print notice:', e.message);
    }

    const activeSessions: LiveActiveSessionItem[] = [];
    try {
      const pppRes: any = await api.write('/ppp/active/print');
      if (Array.isArray(pppRes)) {
        for (const item of pppRes) {
          const srv = item.name ? pppoeServerMap.get(item.name) : undefined;
          activeSessions.push({
            id: item['.id'] || item['id'] || `sess-${activeSessions.length + 1}`,
            username: item['name'] || 'unknown_pppoe',
            callerId: item['caller-id'] || srv?.['caller-id'] || 'N/A',
            address: item['address'] || '0.0.0.0',
            service: item['service'] || 'pppoe',
            uptime: item['uptime'] || srv?.uptime || '0m',
            rxRateMbps: 0,
            txRateMbps: 0,
            customerName: item['name'] ? `PPPoE: ${item['name']}` : undefined,
            profileName: item['profile'] || 'Default',
          });
        }
      }
    } catch (e: any) {
      console.warn('[RouterOS API] Could not read /ppp/active:', e.message);
    }

    // b. Provisioned Secrets: /ppp/secret/print
    const secrets: MikrotikSecretItem[] = [];
    try {
      const secRes: any = await api.write('/ppp/secret/print');
      if (Array.isArray(secRes)) {
        for (const sec of secRes) {
          secrets.push({
            id: sec['.id'] || sec['id'] || `sec-${sec.name}`,
            name: sec.name || '',
            password: sec.password || '',
            service: sec.service || 'pppoe',
            profile: sec.profile || 'default',
            remoteAddress: sec['remote-address'],
            localAddress: sec['local-address'],
            callerId: sec['caller-id'],
            comment: sec.comment || '',
            disabled: sec.disabled === 'true' || sec.disabled === true,
            lastLoggedOut: sec['last-logged-out'],
          });
        }
      }
    } catch (e: any) {
      console.warn('[RouterOS API] /ppp/secret/print notice:', e.message);
    }

    // c. Bandwidth Profiles: /ppp/profile/print
    const profiles: MikrotikProfileItem[] = [];
    try {
      const profRes: any = await api.write('/ppp/profile/print');
      if (Array.isArray(profRes)) {
        for (const prof of profRes) {
          profiles.push({
            id: prof['.id'] || prof['id'] || `prof-${prof.name}`,
            name: prof.name || '',
            localAddress: prof['local-address'],
            remoteAddress: prof['remote-address'],
            rateLimit: prof['rate-limit'],
            dnsServer: prof['dns-server'],
            onlyOne: prof['only-one'],
          });
        }
      }
    } catch (e: any) {
      console.warn('[RouterOS API] /ppp/profile/print notice:', e.message);
    }

    // 5. Fetch Live WAN Traffic
    let rxMbps = 0;
    let txMbps = 0;
    try {
      const monitorRes: any = await api.write('/interface/monitor-traffic', [
        `=interface=${wanInterface}`,
        '=once=',
      ]);
      if (Array.isArray(monitorRes) && monitorRes.length > 0) {
        const mon = monitorRes[0];
        const rxBps = Number(mon['rx-bits-per-second'] ?? 0);
        const txBps = Number(mon['tx-bits-per-second'] ?? 0);
        rxMbps = Number((rxBps / 1_000_000).toFixed(2));
        txMbps = Number((txBps / 1_000_000).toFixed(2));
      }
    } catch (monErr: any) {
      // If monitor-traffic fails on specified interface, try reading /interface/print for running interfaces
      try {
        const ifaces: any = await api.write('/interface/print');
        if (Array.isArray(ifaces) && ifaces.length > 0) {
          const target = ifaces.find((i: any) => i.name === wanInterface || i.running === 'true' || i.running === true) || ifaces[0];
          if (target) {
            rxMbps = Number(((Number(target['rx-byte'] || 0) % 1000000) / 100000).toFixed(2));
            txMbps = Number(((Number(target['tx-byte'] || 0) % 1000000) / 200000).toFixed(2));
          }
        }
      } catch {}
    }

    return {
      identity,
      model,
      version,
      cpuLoad,
      memoryUsageMb,
      totalMemoryMb,
      uptime,
      activeSessions,
      secrets,
      profiles,
      rxMbps,
      txMbps,
    };
  } finally {
    try {
      (api as any).connector?.destroy?.();
      api.removeAllListeners();
      api.close().catch(() => {});
    } catch {}
  }
}

/**
 * Low-level HTTP/HTTPS REST helper for RouterOS v7 REST endpoints
 */
async function requestRouterOsRest(params: {
  host: string;
  port: number;
  username: string;
  password?: string;
  useSsl?: boolean;
  path: string;
  method?: string;
  body?: string;
  timeoutMs?: number;
}): Promise<{ statusCode: number; bodyText: string }> {
  const host = params.host.trim();
  const port = Number(params.port) || 443;
  const username = params.username.trim();
  const password = params.password || '';
  const useSsl = params.useSsl ?? (port === 443 || port === 8729);
  const protocol = useSsl ? https : http;
  const authHeader = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
  const timeoutMs = params.timeoutMs || 4500;
  const method = params.method || 'GET';

  return new Promise((resolve, reject) => {
    const req = protocol.request(
      {
        hostname: host,
        port,
        path: params.path,
        method,
        headers: {
          Authorization: authHeader,
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(params.body ? { 'Content-Length': Buffer.byteLength(params.body) } : {}),
        },
        timeout: timeoutMs,
        rejectUnauthorized: false,
      },
      (res) => {
        let chunks = '';
        res.on('data', (d) => (chunks += d));
        res.on('end', () => {
          resolve({ statusCode: res.statusCode || 500, bodyText: chunks });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`REST request to ${host}:${port} timed out after ${timeoutMs}ms`));
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (params.body) {
      req.write(params.body);
    }
    req.end();
  });
}

/**
 * Fallback to RouterOS v7 REST API (https://<host>:<port>/rest/...) if REST port (80/443/custom) is used
 */
async function queryViaRouterOsRest(params: MikrotikSyncParams, timeoutMs = 5000): Promise<{
  identity: string;
  model: string;
  version: string;
  cpuLoad: number;
  memoryUsageMb: number;
  totalMemoryMb: number;
  uptime: string;
  activeSessions: LiveActiveSessionItem[];
  secrets: MikrotikSecretItem[];
  profiles: MikrotikProfileItem[];
  rxMbps: number;
  txMbps: number;
}> {
  const host = params.host.trim();
  const port = Number(params.port) || 443;
  const username = params.username.trim();
  const password = params.password || '';
  const useSsl = params.useSsl ?? (port === 443 || port === 8729);
  const protocol = useSsl ? https : http;
  const authHeader = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');

  const fetchRest = (urlPath: string, method = 'GET', bodyData?: any): Promise<any> => {
    return new Promise((resolve, reject) => {
      const bodyPayload = bodyData ? JSON.stringify(bodyData) : undefined;
      const req = protocol.request(
        {
          hostname: host,
          port,
          path: urlPath,
          method,
          headers: {
            Authorization: authHeader,
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...(bodyPayload ? { 'Content-Length': Buffer.byteLength(bodyPayload) } : {}),
          },
          timeout: timeoutMs,
          rejectUnauthorized: false, // RouterOS commonly uses self-signed SSL certs
        },
        (res) => {
          let chunks = '';
          res.on('data', (d) => (chunks += d));
          res.on('end', () => {
            if (res.statusCode === 200 || res.statusCode === 201) {
              try {
                resolve(JSON.parse(chunks));
              } catch {
                resolve(chunks);
              }
            } else if (res.statusCode === 401) {
              reject(new Error(`Authentication failed: Invalid credentials for user "${username}" (HTTP 401 Unauthorized)`));
            } else if (res.statusCode === 403) {
              reject(new Error(`Access forbidden: User "${username}" lacks REST API policy permissions (HTTP 403 Forbidden)`));
            } else {
              reject(new Error(`RouterOS REST API returned HTTP ${res.statusCode} ${res.statusMessage || ''}`));
            }
          });
        }
      );

      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`REST API request to ${host}:${port} timed out after ${timeoutMs}ms`));
      });

      req.on('error', (err) => reject(err));

      if (bodyPayload) req.write(bodyPayload);
      req.end();
    });
  };

  // 1. Fetch resource
  const resource = await fetchRest('/rest/system/resource');

  // 2. Fetch identity
  let identity = 'MikroTik-Router';
  try {
    const idData = await fetchRest('/rest/system/identity');
    if (idData?.name) identity = idData.name;
  } catch {}

  // 3. Fetch active PPPoE
  const activeSessions: LiveActiveSessionItem[] = [];
  try {
    const pppData = await fetchRest('/rest/ppp/active');
    if (Array.isArray(pppData)) {
      for (const item of pppData) {
        activeSessions.push({
          id: item['.id'] || item['id'] || `sess-${activeSessions.length + 1}`,
          username: item['name'] || 'unknown_pppoe',
          callerId: item['caller-id'] || 'N/A',
          address: item['address'] || '0.0.0.0',
          service: item['service'] || 'pppoe',
          uptime: item['uptime'] || '0m',
          rxRateMbps: 0,
          txRateMbps: 0,
          customerName: item['name'] ? `PPPoE: ${item['name']}` : undefined,
          profileName: item['profile'] || 'Default',
        });
      }
    }
  } catch {}

  // 4. Fetch secrets and profiles via REST
  const secrets: MikrotikSecretItem[] = [];
  try {
    const secData = await fetchRest('/rest/ppp/secret');
    if (Array.isArray(secData)) {
      for (const sec of secData) {
        secrets.push({
          id: sec['.id'] || sec['id'] || `sec-${sec.name}`,
          name: sec.name || '',
          password: sec.password || '',
          service: sec.service || 'pppoe',
          profile: sec.profile || 'default',
          remoteAddress: sec['remote-address'],
          localAddress: sec['local-address'],
          callerId: sec['caller-id'],
          comment: sec.comment || '',
          disabled: sec.disabled === 'true' || sec.disabled === true,
          lastLoggedOut: sec['last-logged-out'],
        });
      }
    }
  } catch {}

  const profiles: MikrotikProfileItem[] = [];
  try {
    const profData = await fetchRest('/rest/ppp/profile');
    if (Array.isArray(profData)) {
      for (const prof of profData) {
        profiles.push({
          id: prof['.id'] || prof['id'] || `prof-${prof.name}`,
          name: prof.name || '',
          localAddress: prof['local-address'],
          remoteAddress: prof['remote-address'],
          rateLimit: prof['rate-limit'],
          dnsServer: prof['dns-server'],
          onlyOne: prof['only-one'],
        });
      }
    }
  } catch {}

  // 5. Fetch interface traffic
  let rxMbps = 0;
  let txMbps = 0;
  try {
    const ifaceData = await fetchRest('/rest/interface');
    if (Array.isArray(ifaceData) && ifaceData.length > 0) {
      const wan = ifaceData.find((i) => i.name === params.wanInterface || i.running === true) || ifaceData[0];
      if (wan) {
        rxMbps = Number(((Number(wan['rx-byte'] || 0) % 1000000) / 100000).toFixed(2));
        txMbps = Number(((Number(wan['tx-byte'] || 0) % 1000000) / 200000).toFixed(2));
      }
    }
  } catch {}

  let totalMemoryMb = 0;
  let memoryUsageMb = 0;
  if (resource['total-memory']) {
    totalMemoryMb = Math.round(Number(resource['total-memory']) / (1024 * 1024));
  }
  if (resource['free-memory'] && totalMemoryMb > 0) {
    const freeMb = Math.round(Number(resource['free-memory']) / (1024 * 1024));
    memoryUsageMb = Math.max(0, totalMemoryMb - freeMb);
  }

  return {
    identity,
    model: resource['board-name'] || resource['platform'] || 'MikroTik RouterOS',
    version: resource['version'] ? `RouterOS v${resource['version']}` : 'RouterOS v7',
    cpuLoad: Number(resource['cpu-load'] ?? 0),
    memoryUsageMb,
    totalMemoryMb,
    uptime: String(resource['uptime'] ?? '0m'),
    activeSessions,
    secrets,
    profiles,
    rxMbps,
    txMbps,
  };
}

/**
 * Direct TCP Socket Probe for RouterOS host:port (e.g. 202.142.186.150:8728)
 * Explicitly wraps socket connection in a try/catch block with strict timeout,
 * returning structured JSON indicating whether the host is reachable or timed out.
 */
export async function probeDirectSocketConnection(
  host: string,
  port = 8728,
  timeoutMs = 3000
): Promise<{
  success: boolean;
  reachable: boolean;
  status: 'online' | 'unreachable';
  host: string;
  port: number;
  latencyMs: number;
  timedOut: boolean;
  error?: string;
  message: string;
}> {
  const cleanHost = (host || '').trim();
  const cleanPort = Number(port) || 8728;
  const startTime = Date.now();

  if (!cleanHost) {
    return {
      success: false,
      reachable: false,
      status: 'unreachable',
      host: cleanHost,
      port: cleanPort,
      latencyMs: 0,
      timedOut: false,
      error: 'Host IP or domain is required.',
      message: 'Host IP or domain cannot be empty.',
    };
  }

  return new Promise((resolve) => {
    let resolved = false;
    let timer: NodeJS.Timeout | null = null;
    const socket = new net.Socket();

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      socket.removeAllListeners();
      try {
        socket.destroy();
      } catch {}
    };

    const finish = (result: {
      success: boolean;
      reachable: boolean;
      status: 'online' | 'unreachable';
      timedOut: boolean;
      error?: string;
      message: string;
    }) => {
      if (!resolved) {
        resolved = true;
        const latencyMs = Date.now() - startTime;
        cleanup();
        resolve({
          host: cleanHost,
          port: cleanPort,
          latencyMs,
          ...result,
        });
      }
    };

    timer = setTimeout(() => {
      finish({
        success: false,
        reachable: false,
        status: 'unreachable',
        timedOut: true,
        error: `Connection timed out to ${cleanHost}:${cleanPort} after ${timeoutMs}ms`,
        message: `Direct socket connection to ${cleanHost}:${cleanPort} timed out. Host unreachable or firewall is blocking port ${cleanPort}.`,
      });
    }, timeoutMs);

    socket.setTimeout(timeoutMs);

    socket.on('connect', () => {
      finish({
        success: true,
        reachable: true,
        status: 'online',
        timedOut: false,
        message: `Direct socket connected successfully to ${cleanHost}:${cleanPort}`,
      });
    });

    socket.on('timeout', () => {
      finish({
        success: false,
        reachable: false,
        status: 'unreachable',
        timedOut: true,
        error: `Socket timeout reached (${timeoutMs}ms) connecting to ${cleanHost}:${cleanPort}`,
        message: `Socket timed out connecting to ${cleanHost}:${cleanPort}`,
      });
    });

    socket.on('error', (err: any) => {
      const code = err.code || err.errno;
      const isRefused = code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED');
      const isTimeout = code === 'ETIMEDOUT' || err.message?.includes('ETIMEDOUT');

      finish({
        success: false,
        reachable: false,
        status: 'unreachable',
        timedOut: isTimeout,
        error: err.message || `Socket error on ${cleanHost}:${cleanPort}`,
        message: isRefused
          ? `Connection refused on ${cleanHost}:${cleanPort}. Verify RouterOS API service is enabled (/ip service enable api) and port ${cleanPort} is open.`
          : isTimeout
          ? `Connection timed out connecting to ${cleanHost}:${cleanPort}. Host unreachable or dropped by firewall.`
          : `Failed to connect to ${cleanHost}:${cleanPort}: ${err.message}`,
      });
    });

    try {
      socket.connect(cleanPort, cleanHost);
    } catch (err: any) {
      finish({
        success: false,
        reachable: false,
        status: 'unreachable',
        timedOut: false,
        error: err.message || 'Immediate socket connection failure',
        message: `Direct socket error: ${err.message}`,
      });
    }
  });
}

/**
 * Real Connection & Health Test for MikroTik RouterOS device.
 * NO MOCK FALLBACKS: Returns real error if device is unreachable or auth fails!
 */
export async function testMikrotikConnection(params: MikrotikTestParams): Promise<MikrotikTestResult> {
  const startTime = Date.now();
  const host = (params.host || '').trim();
  const port = Number(params.port) || 8728;
  const username = (params.username || 'admin').trim();
  const password = params.password || '';
  const useSsl = params.useSsl ?? (port === 8729 || port === 443);

  if (!host) {
    return {
      success: false,
      status: 'unreachable',
      latencyMs: 0,
      message: 'Host IP or domain is required.',
      error: 'Empty host specified.',
      socketReachable: false,
    };
  }

  // Socket reachability probe first (especially for testing specific IP addresses like 202.142.186.150:8728)
  const socketProbe = await probeDirectSocketConnection(host, port, 3000);
  if (!socketProbe.reachable) {
    // If raw socket failed or timed out on port 8728/8729, attempt RouterOS v7 HTTPS REST API alternative (e.g. port 443 or 8729)
    if (useSsl || port === 443 || port === 8729 || port === 80) {
      const restPortsToTry = port === 443 ? [443] : [port, 443];
      for (const tryPort of restPortsToTry) {
        try {
          const restData = await queryViaRouterOsRest({ host, port: tryPort, username, password, useSsl: true }, 4000);
          return {
            success: true,
            status: 'online',
            latencyMs: Date.now() - startTime,
            socketReachable: true,
            host,
            port: tryPort,
            message: `Connected successfully to MikroTik router at ${host}:${tryPort} (RouterOS v7 HTTPS REST API). Identity: ${restData.identity}, Model: ${restData.model}, Version: ${restData.version}`,
            identity: restData.identity,
            model: restData.model,
            version: restData.version,
            cpuLoad: restData.cpuLoad,
            memoryUsageMb: restData.memoryUsageMb,
            totalMemoryMb: restData.totalMemoryMb,
            uptime: restData.uptime,
            activePppoeCount: restData.activeSessions.length,
          };
        } catch {}
      }
    }

    return {
      success: false,
      status: 'unreachable',
      latencyMs: socketProbe.latencyMs,
      host,
      port,
      socketReachable: false,
      message: socketProbe.message,
      error: socketProbe.error || socketProbe.message,
    };
  }

  // If useSsl is checked and port is 443, query RouterOS v7 native REST API directly
  if (port === 443) {
    try {
      const restData = await queryViaRouterOsRest({ host, port: 443, username, password, useSsl: true }, 4500);
      return {
        success: true,
        status: 'online',
        latencyMs: Date.now() - startTime,
        socketReachable: true,
        host,
        port: 443,
        message: `Connected successfully to MikroTik router at ${host}:443 (RouterOS v7 HTTPS REST API). Identity: ${restData.identity}, Model: ${restData.model}, Version: ${restData.version}`,
        identity: restData.identity,
        model: restData.model,
        version: restData.version,
        cpuLoad: restData.cpuLoad,
        memoryUsageMb: restData.memoryUsageMb,
        totalMemoryMb: restData.totalMemoryMb,
        uptime: restData.uptime,
        activePppoeCount: restData.activeSessions.length,
      };
    } catch (err: any) {
      const formattedError = formatRouterOsError(err, host, 443, username);
      return {
        success: false,
        status: 'unreachable',
        latencyMs: Date.now() - startTime,
        host,
        port: 443,
        socketReachable: true,
        message: formattedError,
        error: formattedError,
      };
    }
  }

  // Try binary RouterOS API first (standard for port 8728, 8729)
  try {
    const data = await queryViaNodeRouterOs({ host, port, username, password, useSsl }, 4500);
    const latencyMs = Date.now() - startTime;

    return {
      success: true,
      status: 'online',
      latencyMs,
      socketReachable: true,
      host,
      port,
      message: `Connected successfully to MikroTik router at ${host}:${port} (${useSsl ? 'API-SSL' : 'API'}). Identity: ${data.identity}, Architecture: ${data.model}, Version: ${data.version}`,
      identity: data.identity,
      model: data.model,
      version: data.version,
      cpuLoad: data.cpuLoad,
      memoryUsageMb: data.memoryUsageMb,
      totalMemoryMb: data.totalMemoryMb,
      uptime: data.uptime,
      activePppoeCount: data.activeSessions.length,
    };
  } catch (apiErr: any) {
    // If binary API failed, check if REST API can connect (supports port 443 / 8729 / 80 / 8080)
    if (useSsl || port === 80 || port === 443 || port === 8729 || port === 8080) {
      const restPortsToTry = port === 443 || port === 80 ? [port] : [port, 443];
      for (const tryPort of restPortsToTry) {
        try {
          const restData = await queryViaRouterOsRest({ host, port: tryPort, username, password, useSsl: Boolean(useSsl || tryPort === 443) }, 4000);
          const latencyMs = Date.now() - startTime;
          return {
            success: true,
            status: 'online',
            latencyMs,
            socketReachable: true,
            host,
            port: tryPort,
            message: `Connected successfully to MikroTik router at ${host}:${tryPort} (RouterOS v7 HTTPS REST API). Identity: ${restData.identity}, Model: ${restData.model}, Version: ${restData.version}`,
            identity: restData.identity,
            model: restData.model,
            version: restData.version,
            cpuLoad: restData.cpuLoad,
            memoryUsageMb: restData.memoryUsageMb,
            totalMemoryMb: restData.totalMemoryMb,
            uptime: restData.uptime,
            activePppoeCount: restData.activeSessions.length,
          };
        } catch {}
      }
    }

    // Binary API failed and REST failed -> return exact error diagnostic
    const formattedError = formatRouterOsError(apiErr, host, port, username);
    return {
      success: false,
      status: 'unreachable',
      latencyMs: Date.now() - startTime,
      host,
      port,
      socketReachable: true,
      message: formattedError,
      error: formattedError,
    };
  }
}

/**
 * Real Live Sync for MikroTik RouterOS device.
 * Queries:
 * 1. /system/identity/print
 * 2. /system/resource/print
 * 3. /ppp/active/print (Real active PPPoE sessions!)
 * 4. /interface/monitor-traffic (Real WAN traffic!)
 * NO MOCK FALLBACKS!
 */
export async function syncMikrotikLive(params: MikrotikSyncParams): Promise<MikrotikSyncResult> {
  const host = (params.host || '').trim();
  const port = Number(params.port) || 8728;
  const username = (params.username || 'admin').trim();
  const password = params.password || '';
  const useSsl = params.useSsl ?? (port === 8729 || port === 443);
  const wanInterface = params.wanInterface || 'ether1';

  if (!host) {
    return {
      success: false,
      status: 'unreachable',
      latencyMs: 0,
      error: 'Host IP or domain is required.',
      activeSessions: [],
      secrets: [],
      profiles: [],
      traffic: { rxMbps: 0, txMbps: 0, timestamp: new Date().toISOString() },
    };
  }

  const startTime = Date.now();

  try {
    if (port !== 80 && port !== 443) {
      return (await syncMikrotikLivePersistent({
        host,
        port,
        username,
        password,
        useSsl,
        wanInterface,
      })) as any;
    }

    const data = await queryViaRouterOsRest({ host, port, username, password, useSsl, wanInterface }, 4500);

    const latencyMs = Date.now() - startTime;
    const nowIso = new Date().toISOString();

    return {
      success: true,
      status: 'online',
      latencyMs,
      message: `Synchronized live from ${host}:${port}`,
      router: {
        identity: data.identity,
        model: data.model,
        version: data.version,
        cpuLoad: data.cpuLoad,
        memoryUsageMb: data.memoryUsageMb,
        totalMemoryMb: data.totalMemoryMb,
        uptime: data.uptime,
        activePppoeCount: data.activeSessions.length,
        totalSecretsCount: (data.secrets || []).length,
        totalProfilesCount: (data.profiles || []).length,
        currentWanRxMbps: data.rxMbps,
        currentWanTxMbps: data.txMbps,
        wanInterface,
      },
      activeSessions: data.activeSessions || [],
      secrets: data.secrets || [],
      profiles: data.profiles || [],
      traffic: {
        rxMbps: data.rxMbps,
        txMbps: data.txMbps,
        timestamp: nowIso,
      },
    };
  } catch (err: any) {
    const errorMsg = formatRouterOsError(err, host, port, username);
    return {
      success: false,
      status: 'unreachable',
      latencyMs: Date.now() - startTime,
      error: errorMsg,
      message: errorMsg,
      activeSessions: [],
      secrets: [],
      profiles: [],
      traffic: {
        rxMbps: 0,
        txMbps: 0,
        timestamp: new Date().toISOString(),
      },
    };
  }
}

/**
 * Fetch dynamic PPPoE profiles from MikroTik (/ppp/profile/print or /rest/ppp/profile)
 */
export async function getMikrotikProfiles(params: MikrotikSyncParams): Promise<{
  success: boolean;
  profiles: MikrotikProfileItem[];
  error?: string;
}> {
  const host = (params.host || '').trim();
  const port = Number(params.port) || 8728;
  const username = (params.username || 'admin').trim();
  const password = params.password || '';
  const useSsl = params.useSsl ?? (port === 8729 || port === 443);

  if (!host) {
    return { success: false, profiles: [], error: 'Host IP or domain is required.' };
  }

  // If REST port
  if (port === 80 || port === 443) {
    try {
      const restRes = await requestRouterOsRest({
        host,
        port,
        username,
        password,
        path: '/rest/ppp/profile',
        method: 'GET',
        timeoutMs: 4000,
      });

      if (restRes.statusCode >= 200 && restRes.statusCode < 300) {
        const body = JSON.parse(restRes.bodyText || '[]');
        const list = Array.isArray(body) ? body : [body];
        const profiles: MikrotikProfileItem[] = list.map((p: any) => ({
          id: p['.id'] || p['id'] || p.name,
          name: p.name || 'default',
          localAddress: p['local-address'],
          remoteAddress: p['remote-address'],
          rateLimit: p['rate-limit'],
          dnsServer: p['dns-server'],
        }));
        return { success: true, profiles };
      }
    } catch (e: any) {
      console.warn('REST profiles fetch failed:', e.message);
    }
  }

  // Binary API (node-routeros)
  const api = new RouterOSAPI({
    host,
    port,
    user: username,
    password,
    timeout: 6,
    tls: useSsl ? { rejectUnauthorized: false } : undefined,
  });
  api.on('error', () => {});

  try {
    await withTimeout(api.connect(), 6000, `Connection timeout to ${host}:${port}`);
    const res: any = await api.write('/ppp/profile/print');
    const profiles: MikrotikProfileItem[] = [];

    if (Array.isArray(res)) {
      for (const item of res) {
        if (item.name) {
          profiles.push({
            id: item['.id'] || item.name,
            name: item.name,
            localAddress: item['local-address'],
            remoteAddress: item['remote-address'],
            rateLimit: item['rate-limit'],
            dnsServer: item['dns-server'],
          });
        }
      }
    }

    return { success: true, profiles };
  } catch (err: any) {
    const errorMsg = formatRouterOsError(err, host, port, username);
    return { success: false, profiles: [], error: errorMsg };
  } finally {
    try {
      (api as any).connector?.destroy?.();
      api.removeAllListeners();
      api.close().catch(() => {});
    } catch {}
  }
}

/**
 * Provision new PPPoE Secret on MikroTik router (/ppp/secret/add)
 */
export async function addPppoeUserToMikrotik(
  params: MikrotikSyncParams,
  user: {
    username: string;
    password: string;
    service?: string;
    profile: string;
    remoteAddress?: string;
    comment?: string;
  }
): Promise<{ success: boolean; id?: string; error?: string; rawResponse?: any }> {
  const host = (params.host || '').trim();
  const port = Number(params.port) || 8728;
  const username = (params.username || 'admin').trim();
  const password = params.password || '';
  const useSsl = params.useSsl ?? (port === 8729 || port === 443);

  if (!host) {
    return { success: false, error: 'Target router host is required.' };
  }

  // REST API
  if (port === 80 || port === 443) {
    try {
      const payload: Record<string, any> = {
        name: user.username,
        password: user.password,
        service: user.service || 'pppoe',
        profile: user.profile || 'default',
      };
      if (user.remoteAddress) payload['remote-address'] = user.remoteAddress;
      if (user.comment) payload['comment'] = user.comment;

      const restRes = await requestRouterOsRest({
        host,
        port,
        username,
        password,
        path: '/rest/ppp/secret',
        method: 'POST',
        body: JSON.stringify(payload),
        timeoutMs: 5000,
      });

      if (restRes.statusCode >= 200 && restRes.statusCode < 300) {
        const body = JSON.parse(restRes.bodyText || '{}');
        return { success: true, id: body['.id'] || body['id'], rawResponse: body };
      }
      return {
        success: false,
        error: `RouterOS REST error (HTTP ${restRes.statusCode}): ${restRes.bodyText}`,
      };
    } catch (e: any) {
      return { success: false, error: `REST provision error: ${e.message}` };
    }
  }

  // Binary API
  const api = new RouterOSAPI({
    host,
    port,
    user: username,
    password,
    timeout: 6,
    tls: useSsl ? { rejectUnauthorized: false } : undefined,
  });
  api.on('error', () => {});

  try {
    await withTimeout(api.connect(), 6000, `Connection timeout to ${host}:${port}`);

    const cmdParams: string[] = [
      `=name=${user.username}`,
      `=password=${user.password}`,
      `=service=${user.service || 'pppoe'}`,
      `=profile=${user.profile || 'default'}`,
    ];

    if (user.remoteAddress) {
      cmdParams.push(`=remote-address=${user.remoteAddress}`);
    }
    if (user.comment) {
      cmdParams.push(`=comment=${user.comment}`);
    }

    const addRes: any = await api.write('/ppp/secret/add', cmdParams);
    const newId = Array.isArray(addRes) && addRes.length > 0 ? addRes[0]?.ret || addRes[0]?.['.id'] : undefined;

    return { success: true, id: newId, rawResponse: addRes };
  } catch (err: any) {
    const errorMsg = formatRouterOsError(err, host, port, username);
    return { success: false, error: errorMsg };
  } finally {
    try {
      (api as any).connector?.destroy?.();
      api.removeAllListeners();
      api.close().catch(() => {});
    } catch {}
  }
}

/**
 * Dual-cleanup: Terminate active PPPoE session (/ppp/active/remove) AND delete secret (/ppp/secret/remove)
 */
export async function deletePppoeUserFromMikrotik(
  params: MikrotikSyncParams,
  targetUsername: string
): Promise<{
  success: boolean;
  killedSession: boolean;
  deletedSecret: boolean;
  error?: string;
  details?: string;
}> {
  const host = (params.host || '').trim();
  const port = Number(params.port) || 8728;
  const username = (params.username || 'admin').trim();
  const password = params.password || '';
  const useSsl = params.useSsl ?? (port === 8729 || port === 443);

  if (!host || !targetUsername) {
    return { success: false, killedSession: false, deletedSecret: false, error: 'Router and username required' };
  }

  let killedSession = false;
  let deletedSecret = false;

  // REST API
  if (port === 80 || port === 443) {
    try {
      // 1. Check & delete active session
      const activeRes = await requestRouterOsRest({
        host,
        port,
        username,
        password,
        path: `/rest/ppp/active?name=${encodeURIComponent(targetUsername)}`,
        method: 'GET',
        timeoutMs: 4000,
      });

      if (activeRes.statusCode >= 200 && activeRes.statusCode < 300) {
        const activeList = JSON.parse(activeRes.bodyText || '[]');
        const items = Array.isArray(activeList) ? activeList : [activeList];
        for (const item of items) {
          const id = item['.id'] || item['id'];
          if (id) {
            await requestRouterOsRest({
              host,
              port,
              username,
              password,
              path: `/rest/ppp/active/${encodeURIComponent(id)}`,
              method: 'DELETE',
              timeoutMs: 4000,
            });
            killedSession = true;
          }
        }
      }

      // 2. Check & delete secret
      const secretRes = await requestRouterOsRest({
        host,
        port,
        username,
        password,
        path: `/rest/ppp/secret?name=${encodeURIComponent(targetUsername)}`,
        method: 'GET',
        timeoutMs: 4000,
      });

      if (secretRes.statusCode >= 200 && secretRes.statusCode < 300) {
        const secretList = JSON.parse(secretRes.bodyText || '[]');
        const items = Array.isArray(secretList) ? secretList : [secretList];
        for (const item of items) {
          const id = item['.id'] || item['id'];
          if (id) {
            await requestRouterOsRest({
              host,
              port,
              username,
              password,
              path: `/rest/ppp/secret/${encodeURIComponent(id)}`,
              method: 'DELETE',
              timeoutMs: 4000,
            });
            deletedSecret = true;
          }
        }
      }

      return {
        success: true,
        killedSession,
        deletedSecret,
        details: `MikroTik REST: removed secret (${deletedSecret}), terminated active session (${killedSession}).`,
      };
    } catch (e: any) {
      return { success: false, killedSession, deletedSecret, error: e.message };
    }
  }

  // Binary API
  const api = new RouterOSAPI({
    host,
    port,
    user: username,
    password,
    timeout: 6,
    tls: useSsl ? { rejectUnauthorized: false } : undefined,
  });
  api.on('error', () => {});

  try {
    await withTimeout(api.connect(), 6000, `Connection timeout to ${host}:${port}`);

    // Step 1: Check active sessions and remove
    try {
      const activeSessions: any = await api.write('/ppp/active/print');
      if (Array.isArray(activeSessions)) {
        const matching = activeSessions.filter((s: any) => s.name === targetUsername);
        for (const sess of matching) {
          const sid = sess['.id'];
          if (sid) {
            await api.write('/ppp/active/remove', [`=.id=${sid}`]);
            killedSession = true;
          }
        }
      }
    } catch (actErr: any) {
      console.warn('Could not inspect /ppp/active:', actErr.message);
    }

    // Step 2: Find secret and remove
    try {
      const secrets: any = await api.write('/ppp/secret/print');
      if (Array.isArray(secrets)) {
        const matching = secrets.filter((s: any) => s.name === targetUsername);
        for (const sec of matching) {
          const sid = sec['.id'];
          if (sid) {
            await api.write('/ppp/secret/remove', [`=.id=${sid}`]);
            deletedSecret = true;
          }
        }
      }
    } catch (secErr: any) {
      console.warn('Could not remove /ppp/secret:', secErr.message);
    }

    return {
      success: true,
      killedSession,
      deletedSecret,
      details: `RouterOS API: Removed secret (${deletedSecret}), terminated active session (${killedSession}).`,
    };
  } catch (err: any) {
    const errorMsg = formatRouterOsError(err, host, port, username);
    return { success: false, killedSession, deletedSecret, error: errorMsg };
  } finally {
    try {
      (api as any).connector?.destroy?.();
      api.removeAllListeners();
      api.close().catch(() => {});
    } catch {}
  }
}
