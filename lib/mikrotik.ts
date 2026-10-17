import { RouterOSAPI } from 'node-routeros';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';

export interface MikrotikConnectionParams {
  host: string;
  port?: number;
  username?: string;
  password?: string;
  useSsl?: boolean;
  wanInterface?: string;
  timeoutMs?: number;
}

export interface LiveSessionTraffic {
  id: string;
  username: string;
  interfaceName?: string;
  callerId: string;
  address: string;
  service: string;
  uptime: string;
  rxBps: number;
  txBps: number;
  rxRateMbps: number;
  txRateMbps: number;
  liveRateFormatted: string;
  customerName?: string;
  profileName?: string;
}

export interface LiveWanTraffic {
  interface: string;
  rxBps: number;
  txBps: number;
  rxMbps: number;
  txMbps: number;
  liveRateFormatted: string;
}

export interface MikrotikLiveTrafficResult {
  success: boolean;
  timestamp: string;
  latencyMs: number;
  error?: string;
  wan: LiveWanTraffic;
  activeSessions: LiveSessionTraffic[];
  cpuLoad?: number;
  uptime?: string;
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
    wanInterface: string;
  };
  activeSessions: LiveSessionTraffic[];
  secrets: MikrotikSecretItem[];
  profiles: MikrotikProfileItem[];
  traffic: {
    rxMbps: number;
    txMbps: number;
    timestamp: string;
  };
}

/**
 * Format bits per second to human-readable telecom unit (Mbps / Kbps)
 */
export function formatBitsPerSecond(bps: number): string {
  if (isNaN(bps) || bps <= 0) return '0.0 Mbps';
  if (bps >= 1_000_000_000) {
    return `${(bps / 1_000_000_000).toFixed(2)} Gbps`;
  }
  if (bps >= 1_000_000) {
    return `${(bps / 1_000_000).toFixed(1)} Mbps`;
  }
  if (bps >= 1_000) {
    return `${(bps / 1_000).toFixed(0)} Kbps`;
  }
  return `${bps} bps`;
}

/**
 * Format RouterOS uptime into clean human-readable format e.g. "6d 19h 51m"
 */
export function formatRouterOsUptime(raw: any): string {
  if (!raw) return '0m';
  const str = String(raw).trim();
  if (!str) return '0m';

  // Already formatted cleanly with spaces e.g. "6d 19h 51m"
  if (/^\d+[wdhms](\s+\d+[wdhms])*$/.test(str)) {
    return str;
  }

  // Compact formats e.g. "6d19h51m30s" or "2w3d4h" or "1d04:22:15"
  const weeks = str.match(/(\d+)\s*w/i);
  const days = str.match(/(\d+)\s*d/i);
  const hours = str.match(/(\d+)\s*h/i);
  const minutes = str.match(/(\d+)\s*m/i);
  const seconds = str.match(/(\d+)\s*s/i);

  if (weeks || days || hours || minutes || seconds) {
    const parts: string[] = [];
    if (weeks) parts.push(`${weeks[1]}w`);
    if (days) parts.push(`${days[1]}d`);
    if (hours) parts.push(`${hours[1]}h`);
    if (minutes) parts.push(`${minutes[1]}m`);
    if (seconds && parts.length === 0) parts.push(`${seconds[1]}s`);
    return parts.join(' ');
  }

  // Format with colon e.g. "1d 04:22:15" or "14:22:10"
  if (str.includes(':')) {
    let dayPrefix = '';
    let timePart = str;
    if (str.includes('d')) {
      const splitD = str.split('d');
      dayPrefix = `${splitD[0].trim()}d `;
      timePart = splitD[1].trim();
    }
    const colonParts = timePart.split(':');
    if (colonParts.length === 3) {
      const h = parseInt(colonParts[0], 10) || 0;
      const m = parseInt(colonParts[1], 10) || 0;
      const s = parseInt(colonParts[2], 10) || 0;
      const parts: string[] = [];
      if (h > 0) parts.push(`${h}h`);
      if (m > 0 || parts.length > 0) parts.push(`${m}m`);
      if (parts.length === 0) parts.push(`${s}s`);
      return `${dayPrefix}${parts.join(' ')}`.trim() || str;
    }
  }

  return str;
}

/**
 * Clean human-readable error diagnosis
 */
export function formatRouterOsError(
  err: any,
  host: string,
  port: number,
  username: string
): string {
  const msg = String(err?.message || err || '');
  const code = String(err?.code || '');

  if (code === 'ECONNREFUSED' || msg.includes('ECONNREFUSED')) {
    return `Connection refused by ${host}:${port}. Port is closed or MikroTik API service (/ip service enable api) is disabled.`;
  }
  if (code === 'ETIMEDOUT' || code === 'ECONNRESET' || msg.includes('timed out') || msg.includes('ETIMEDOUT')) {
    return `Connection timed out reaching ${host}:${port}. Verify firewall filter (/ip firewall filter) and NAT forwarding.`;
  }
  if (code === 'EHOSTUNREACH' || msg.includes('EHOSTUNREACH')) {
    return `No network route to physical host ${host}.`;
  }
  if (msg.toLowerCase().includes('cannot log in') || msg.toLowerCase().includes('invalid user name')) {
    return `RouterOS Authentication Failed for user "${username}" at ${host}:${port}. Check username and password.`;
  }
  return msg || `Unknown connection failure connecting to ${host}:${port}`;
}

/**
 * Pooled active RouterOS API client with command serialization and auto-reconnect
 */
class PooledRouterOSConnection {
  public readonly key: string;
  public readonly host: string;
  public readonly port: number;
  public readonly username: string;
  public readonly password?: string;
  public readonly useSsl: boolean;
  public api: RouterOSAPI | null = null;
  public connected: boolean = false;
  private connectingPromise: Promise<RouterOSAPI> | null = null;
  private commandQueue: Promise<any> = Promise.resolve();
  public lastActive: number = Date.now();
  public errorCount: number = 0;

  constructor(params: MikrotikConnectionParams) {
    this.host = (params.host || '').trim();
    this.port = Number(params.port) || 8728;
    this.username = (params.username || 'admin').trim();
    this.password = params.password || '';
    this.useSsl = params.useSsl ?? (this.port === 8729);
    this.key = `${this.host}:${this.port}:${this.username}`;
  }

  /**
   * Connect or return existing active socket
   */
  public async getConnectedApi(timeoutMs: number = 5000): Promise<RouterOSAPI> {
    if (this.api && this.connected && this.api.connected) {
      this.lastActive = Date.now();
      return this.api;
    }

    if (this.connectingPromise) {
      return this.connectingPromise;
    }

    this.connectingPromise = this.establishConnection(timeoutMs);
    try {
      const api = await this.connectingPromise;
      this.lastActive = Date.now();
      return api;
    } finally {
      this.connectingPromise = null;
    }
  }

  private async establishConnection(timeoutMs: number): Promise<RouterOSAPI> {
    // Teardown any dangling old instance
    if (this.api) {
      try {
        this.api.removeAllListeners();
        this.api.close().catch(() => {});
      } catch {}
      this.api = null;
      this.connected = false;
    }

    const api = new RouterOSAPI({
      host: this.host,
      port: this.port,
      user: this.username,
      password: this.password,
      timeout: Math.max(12, Math.floor((timeoutMs || 10000) / 1000)),
      tls: this.useSsl ? { rejectUnauthorized: false } : undefined,
      keepalive: true,
    });

    // Listeners for unexpected socket drops (state update without noisy console errors)
    api.on('error', (err) => {
      this.connected = false;
      this.errorCount++;
    });

    api.on('close', () => {
      this.connected = false;
    });

    api.on('timeout', () => {
      this.connected = false;
    });

    // Connect with timeout guard
    const effectiveTimeoutMs = Math.max(6000, timeoutMs || 8000);
    const connectPromise = new Promise<RouterOSAPI>((resolve, reject) => {
      const timer = setTimeout(() => {
        try {
          (api as any).connector?.destroy?.();
          api.removeAllListeners();
          api.close().catch(() => {});
        } catch {}
        reject(new Error(`ROUTER_UNREACHABLE: Could not connect to router ${this.host} on port ${this.port}`));
      }, effectiveTimeoutMs);

      api
        .connect()
        .then(() => {
          clearTimeout(timer);
          this.connected = true;
          this.api = api;
          this.errorCount = 0;
          resolve(api);
        })
        .catch((err) => {
          clearTimeout(timer);
          this.connected = false;
          try {
            (api as any).connector?.destroy?.();
            api.removeAllListeners();
            api.close().catch(() => {});
          } catch {}
          reject(new Error(`ROUTER_UNREACHABLE: Could not connect to router ${this.host} on port ${this.port}`));
        });
    });

    return connectPromise;
  }

  /**
   * Execute command safely in queue without closing socket
   */
  public async execute<T>(action: (api: RouterOSAPI) => Promise<T>, timeoutMs: number = 12000): Promise<T> {
    const runTask = async (): Promise<T> => {
      let api: RouterOSAPI;
      try {
        api = await this.getConnectedApi(timeoutMs);
      } catch (connErr) {
        throw connErr;
      }

      try {
        return await action(api);
      } catch (execErr: any) {
        const msg = String(execErr?.message || '');
        const isSocketDead =
          msg.includes('not connected') ||
          msg.includes('socket') ||
          msg.includes('ECONNRESET') ||
          msg.includes('EPIPE') ||
          msg.includes('timed out');

        if (isSocketDead) {
          this.connected = false;
          // Retry once with a fresh socket
          const freshApi = await this.getConnectedApi(timeoutMs);
          return await action(freshApi);
        }
        throw execErr;
      }
    };

    // Chain sequentially to avoid packet interleaving on RouterOS stream
    const resultPromise = this.commandQueue.then(runTask, runTask);
    this.commandQueue = resultPromise.catch(() => {});
    return resultPromise;
  }

  /**
   * Explicit socket closure (only when router is removed or reset)
   */
  public async destroy(): Promise<void> {
    this.connected = false;
    if (this.api) {
      try {
        this.api.removeAllListeners();
        await this.api.close().catch(() => {});
      } catch {}
      this.api = null;
    }
  }
}

/**
 * Singleton RouterOS Connection Pool
 */
class RouterOSConnectionPool {
  private static instance: RouterOSConnectionPool;
  private connections: Map<string, PooledRouterOSConnection> = new Map();

  private constructor() {
    // Periodic idle reaper: checks every 60s
    if (typeof setInterval !== 'undefined') {
      setInterval(() => this.reapStaleConnections(), 60000).unref?.();
    }
  }

  public static getInstance(): RouterOSConnectionPool {
    if (!RouterOSConnectionPool.instance) {
      RouterOSConnectionPool.instance = new RouterOSConnectionPool();
    }
    return RouterOSConnectionPool.instance;
  }

  private getKey(params: MikrotikConnectionParams): string {
    const host = (params.host || '').trim();
    const port = Number(params.port) || 8728;
    const username = (params.username || 'admin').trim();
    return `${host}:${port}:${username}`;
  }

  public getOrCreateConnection(params: MikrotikConnectionParams): PooledRouterOSConnection {
    const key = this.getKey(params);
    let conn = this.connections.get(key);
    if (!conn) {
      conn = new PooledRouterOSConnection(params);
      this.connections.set(key, conn);
    }
    return conn;
  }

  public async execute<T>(
    params: MikrotikConnectionParams,
    action: (api: RouterOSAPI) => Promise<T>,
    timeoutMs: number = 6000
  ): Promise<T> {
    const conn = this.getOrCreateConnection(params);
    return conn.execute(action, timeoutMs);
  }

  public async closeConnection(params: MikrotikConnectionParams): Promise<void> {
    const key = this.getKey(params);
    const conn = this.connections.get(key);
    if (conn) {
      await conn.destroy();
      this.connections.delete(key);
    }
  }

  public async closeAll(): Promise<void> {
    for (const conn of this.connections.values()) {
      await conn.destroy();
    }
    this.connections.clear();
  }

  private reapStaleConnections(): void {
    const maxIdleMs = 15 * 60 * 1000; // 15 minutes of zero activity
    const now = Date.now();
    for (const [key, conn] of this.connections.entries()) {
      if (now - conn.lastActive > maxIdleMs) {
        console.info(`[RouterOS Pool] Reaping idle connection ${key}`);
        conn.destroy().catch(() => {});
        this.connections.delete(key);
      }
    }
  }
}

export const routerOSPool = RouterOSConnectionPool.getInstance();

/**
 * Measure live interface traffic using `/interface/monitor-traffic`
 */
async function monitorInterfaceTraffic(
  api: RouterOSAPI,
  interfaces: string[]
): Promise<Map<string, { rxBps: number; txBps: number }>> {
  const result = new Map<string, { rxBps: number; txBps: number }>();
  if (!interfaces || interfaces.length === 0) return result;

  const validIfaces = Array.from(
    new Set(interfaces.filter((i) => i && typeof i === 'string' && i.trim().length > 0))
  );
  if (validIfaces.length === 0) return result;

  // MikroTik RouterOS v7 limits =interface= list to at most 100 elements.
  // Chunk safely into batches of 60 interfaces to prevent "value of interface should have no more than 100 elements".
  const chunkSize = 60;
  const chunks: string[][] = [];
  for (let i = 0; i < validIfaces.length; i += chunkSize) {
    chunks.push(validIfaces.slice(i, i + chunkSize));
  }

  // Monitor first 2 chunks (up to 120 interfaces, WAN + top subscribers) for sub-second telemetry
  for (const chunk of chunks.slice(0, 2)) {
    try {
      const batchRes: any = await api.write('/interface/monitor-traffic', [
        `=interface=${chunk.join(',')}`,
        '=once=',
      ]);

      if (Array.isArray(batchRes)) {
        for (const item of batchRes) {
          const name = item['name'] || item['interface'];
          if (name) {
            result.set(name, {
              rxBps: Number(item['rx-bits-per-second'] ?? 0),
              txBps: Number(item['tx-bits-per-second'] ?? 0),
            });
          }
        }
      }
    } catch {
      // If batch query fails on an interface name, ensure at least first interface (WAN) is monitored
      if (chunk.length > 0 && !result.has(chunk[0])) {
        try {
          const singleWanRes: any = await api.write('/interface/monitor-traffic', [
            `=interface=${chunk[0]}`,
            '=once=',
          ]);
          if (Array.isArray(singleWanRes) && singleWanRes.length > 0) {
            result.set(chunk[0], {
              rxBps: Number(singleWanRes[0]['rx-bits-per-second'] ?? 0),
              txBps: Number(singleWanRes[0]['tx-bits-per-second'] ?? 0),
            });
          }
        } catch {}
      }
    }
  }

  return result;
}

/**
 * Fetch Live Realtime Traffic Telemetry (WAN + Active Sessions) using Persistent Connection
 */
export async function getMikrotikLiveTraffic(
  params: MikrotikConnectionParams
): Promise<MikrotikLiveTrafficResult> {
  const host = (params.host || '').trim();
  const wanInterface = params.wanInterface || 'ether1';
  const startTime = Date.now();

  if (!host) {
    return {
      success: false,
      timestamp: new Date().toISOString(),
      latencyMs: 0,
      error: 'Host IP or domain is required.',
      wan: {
        interface: wanInterface,
        rxBps: 0,
        txBps: 0,
        rxMbps: 0,
        txMbps: 0,
        liveRateFormatted: '0.0 Mbps / 0.0 Mbps',
      },
      activeSessions: [],
    };
  }

  try {
    return await routerOSPool.execute(params, async (api) => {
      // 1. Fetch system resource and active sessions concurrently for maximum speed
      const resPromise: Promise<any> = api.write('/system/resource/print').catch(() => []);
      const pppPromise: Promise<any> = api.write('/ppp/active/print').catch(() => []);

      const [resData, pppRes] = await Promise.all([resPromise, pppPromise]);

      let cpuLoad = 0;
      let uptime = '0m';
      if (Array.isArray(resData) && resData.length > 0) {
        cpuLoad = Number(resData[0]['cpu-load'] ?? 0);
        uptime = String(resData[0]['uptime'] ?? '0m');
      }

      // 2. Active PPPoE sessions
      const rawSessions = Array.isArray(pppRes) ? pppRes : [];

      // 3. Build dynamic interface names for PPPoE sessions (<pppoe-username>)
      const ifaceToMonitor = [wanInterface];
      const sessionIfaceMap = new Map<string, string>();

      for (const item of rawSessions) {
        const user = String(item.name || '').trim();
        if (user) {
          const dynIface = `<pppoe-${user}>`;
          sessionIfaceMap.set(user, dynIface);
          ifaceToMonitor.push(dynIface);
        }
      }

      // 4. Query live traffic rates via chunked /interface/monitor-traffic
      const trafficMap = await monitorInterfaceTraffic(api, ifaceToMonitor);

      // Extract WAN Rates
      const wanTraffic = trafficMap.get(wanInterface) || { rxBps: 0, txBps: 0 };
      const wanRxMbps = Number((wanTraffic.rxBps / 1_000_000).toFixed(2));
      const wanTxMbps = Number((wanTraffic.txBps / 1_000_000).toFixed(2));
      const wanLiveRateFormatted = `${formatBitsPerSecond(wanTraffic.rxBps)} / ${formatBitsPerSecond(wanTraffic.txBps)}`;

      // Extract Active Session Rates
      const activeSessions: LiveSessionTraffic[] = rawSessions.map((item, idx) => {
        const user = item.name || 'unknown_pppoe';
        const iface = sessionIfaceMap.get(user) || `<pppoe-${user}>`;
        const traf = trafficMap.get(iface) || trafficMap.get(user) || { rxBps: 0, txBps: 0 };

        const rxRateMbps = Number((traf.rxBps / 1_000_000).toFixed(2));
        const txRateMbps = Number((traf.txBps / 1_000_000).toFixed(2));
        const liveRateFormatted = `${formatBitsPerSecond(traf.rxBps)} / ${formatBitsPerSecond(traf.txBps)}`;

        return {
          id: item['.id'] || item['id'] || `sess-${idx + 1}`,
          username: user,
          interfaceName: iface,
          callerId: item['caller-id'] || 'N/A',
          address: item['address'] || '0.0.0.0',
          service: item['service'] || 'pppoe',
          uptime: item['uptime'] || '0m',
          rxBps: traf.rxBps,
          txBps: traf.txBps,
          rxRateMbps,
          txRateMbps,
          liveRateFormatted,
          customerName: user ? `PPPoE: ${user}` : undefined,
          profileName: item['profile'] || 'Default',
        };
      });

      return {
        success: true,
        timestamp: new Date().toISOString(),
        latencyMs: Date.now() - startTime,
        cpuLoad,
        uptime,
        wan: {
          interface: wanInterface,
          rxBps: wanTraffic.rxBps,
          txBps: wanTraffic.txBps,
          rxMbps: wanRxMbps,
          txMbps: wanTxMbps,
          liveRateFormatted: wanLiveRateFormatted,
        },
        activeSessions,
      };
    });
  } catch (err: any) {
    const errorMsg = formatRouterOsError(err, host, params.port || 8728, params.username || 'admin');
    return {
      success: false,
      timestamp: new Date().toISOString(),
      latencyMs: Date.now() - startTime,
      error: errorMsg,
      wan: {
        interface: wanInterface,
        rxBps: 0,
        txBps: 0,
        rxMbps: 0,
        txMbps: 0,
        liveRateFormatted: '0.0 Mbps / 0.0 Mbps',
      },
      activeSessions: [],
    };
  }
}

/**
 * Full RouterOS Synchronization using Persistent Connection Pool
 * (DOES NOT close socket, preventing instant logout in RouterOS)
 */
export async function syncMikrotikLivePersistent(
  params: MikrotikConnectionParams
): Promise<MikrotikSyncResult> {
  const host = (params.host || '').trim();
  const port = Number(params.port) || 8728;
  const username = (params.username || 'admin').trim();
  const wanInterface = params.wanInterface || 'ether1';
  const startTime = Date.now();

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

  try {
    return await routerOSPool.execute(params, async (api) => {
      // Step 1: Sequential Query /ppp/active/print (Active PPPoE Sessions)
      const pppRes: any = await api.write('/ppp/active/print');
      const rawSessions = Array.isArray(pppRes) ? pppRes : [];

      // Step 2: Sequential Query /ppp/secret/print (Provisioned PPPoE Secrets)
      const secRes: any = await api.write('/ppp/secret/print');
      const rawSecrets = Array.isArray(secRes) ? secRes : [];

      // Step 3: Sequential Query /ppp/profile/print (Bandwidth Profiles)
      const profRes: any = await api.write('/ppp/profile/print');
      const rawProfiles = Array.isArray(profRes) ? profRes : [];

      // Step 4: Sequential Query /system/resource/print (CPU, Uptime, Free Memory)
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
          uptime = formatRouterOsUptime(res['uptime'] ?? '0m');

          if (res['total-memory']) {
            totalMemoryMb = Math.round(Number(res['total-memory']) / (1024 * 1024));
          }
          if (res['free-memory'] && totalMemoryMb > 0) {
            const freeMb = Math.round(Number(res['free-memory']) / (1024 * 1024));
            memoryUsageMb = Math.max(0, totalMemoryMb - freeMb);
          }
        }
      } catch (err: any) {
        console.warn('[RouterOS Sync] /system/resource notice:', err?.message);
      }

      // Step 5: Optional Identity & Interface Monitor
      let identity = 'MikroTik-Router';
      try {
        const idRes: any = await api.write('/system/identity/print');
        if (Array.isArray(idRes) && idRes.length > 0 && idRes[0]?.name) {
          identity = idRes[0].name;
        }
      } catch {}

      // Build dynamic interface names for PPPoE sessions (<pppoe-username>)
      const ifaceToMonitor = [wanInterface];
      const sessionIfaceMap = new Map<string, string>();

      for (const item of rawSessions) {
        const user = String(item.name || '').trim();
        if (user) {
          const dynIface = `<pppoe-${user}>`;
          sessionIfaceMap.set(user, dynIface);
          ifaceToMonitor.push(dynIface);
        }
      }

      // Query live traffic rates via chunked /interface/monitor-traffic
      const trafficMap = await monitorInterfaceTraffic(api, ifaceToMonitor);

      // WAN Rates
      const wanTraffic = trafficMap.get(wanInterface) || { rxBps: 0, txBps: 0 };
      const wanRxMbps = Number((wanTraffic.rxBps / 1_000_000).toFixed(2));
      const wanTxMbps = Number((wanTraffic.txBps / 1_000_000).toFixed(2));

      // DATA NORMALIZATION:
      // Active Sessions: name -> username, caller-id -> MAC address, address -> assigned IP, uptime -> human readable format
      const activeSessions: LiveSessionTraffic[] = rawSessions.map((item, idx) => {
        const user = String(item.name || 'unknown_pppoe').trim();
        const iface = sessionIfaceMap.get(user) || `<pppoe-${user}>`;
        const traf = trafficMap.get(iface) || trafficMap.get(user) || { rxBps: 0, txBps: 0 };

        const rxRateMbps = Number((traf.rxBps / 1_000_000).toFixed(2));
        const txRateMbps = Number((traf.txBps / 1_000_000).toFixed(2));
        const liveRateFormatted = `${formatBitsPerSecond(traf.rxBps)} / ${formatBitsPerSecond(traf.txBps)}`;

        return {
          id: item['.id'] || item['id'] || `sess-${idx + 1}`,
          username: user,
          interfaceName: iface,
          callerId: String(item['caller-id'] || 'N/A').trim(),
          address: String(item['address'] || '0.0.0.0').trim(),
          service: String(item['service'] || 'pppoe').trim(),
          uptime: formatRouterOsUptime(item['uptime']),
          rxBps: traf.rxBps,
          txBps: traf.txBps,
          rxRateMbps,
          txRateMbps,
          liveRateFormatted,
          customerName: user ? `PPPoE: ${user}` : undefined,
          profileName: String(item['profile'] || 'Default').trim(),
        };
      });

      // Provisioned Secrets: Normalize name, caller-id, remote-address, disabled
      const secrets: MikrotikSecretItem[] = rawSecrets.map((sec, idx) => ({
        id: sec['.id'] || sec['id'] || `sec-${sec.name || idx}`,
        name: String(sec.name || '').trim(),
        password: String(sec.password || ''),
        service: String(sec.service || 'pppoe').trim(),
        profile: String(sec.profile || 'default').trim(),
        remoteAddress: String(sec['remote-address'] || ''),
        localAddress: String(sec['local-address'] || ''),
        callerId: String(sec['caller-id'] || ''),
        comment: String(sec.comment || ''),
        disabled: sec.disabled === 'true' || sec.disabled === true,
        lastLoggedOut: sec['last-logged-out'] || '',
      }));

      // Bandwidth Profiles: Normalize fields
      const profiles: MikrotikProfileItem[] = rawProfiles.map((prof, idx) => ({
        id: prof['.id'] || prof['id'] || `prof-${prof.name || idx}`,
        name: String(prof.name || '').trim(),
        localAddress: String(prof['local-address'] || ''),
        remoteAddress: String(prof['remote-address'] || ''),
        rateLimit: String(prof['rate-limit'] || ''),
        dnsServer: String(prof['dns-server'] || ''),
        onlyOne: String(prof['only-one'] || ''),
      }));

      const nowIso = new Date().toISOString();

      return {
        success: true,
        status: 'online',
        latencyMs: Date.now() - startTime,
        message: `Synchronized ${activeSessions.length} active sessions, ${secrets.length} secrets successfully from ${host}:${port}`,
        router: {
          identity,
          model,
          version,
          cpuLoad,
          memoryUsageMb,
          totalMemoryMb,
          uptime,
          activePppoeCount: activeSessions.length,
          totalSecretsCount: secrets.length,
          totalProfilesCount: profiles.length,
          currentWanRxMbps: wanRxMbps,
          currentWanTxMbps: wanTxMbps,
          wanInterface,
        },
        activeSessions,
        secrets,
        profiles,
        traffic: {
          rxMbps: wanRxMbps,
          txMbps: wanTxMbps,
          timestamp: nowIso,
        },
      };
    });
  } catch (err: any) {
    const isUnreachable =
      err?.message?.includes('ROUTER_UNREACHABLE') ||
      err?.code === 'ECONNREFUSED' ||
      err?.code === 'ETIMEDOUT' ||
      err?.code === 'EHOSTUNREACH' ||
      String(err?.message || '').includes('timed out');

    const errorType = isUnreachable ? 'ROUTER_UNREACHABLE' : (err?.code || 'ROUTER_ERROR');
    const errorMsg = isUnreachable
      ? `Could not connect to router ${host} on port ${port}`
      : formatRouterOsError(err, host, port, username);

    return {
      success: false,
      status: 'unreachable',
      latencyMs: Date.now() - startTime,
      error: errorType,
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
 * Kick PPPoE Session using Persistent Connection
 */
export async function kickPppoeSession(
  params: MikrotikConnectionParams,
  sessionId: string
): Promise<{ success: boolean; message: string }> {
  return routerOSPool.execute(params, async (api) => {
    await api.write('/ppp/active/remove', [`=.id=${sessionId}`]);
    return { success: true, message: `PPPoE session ${sessionId} successfully removed` };
  });
}

/**
 * Add PPPoE User using Persistent Connection
 */
export async function addPppoeUserToMikrotik(
  params: MikrotikConnectionParams,
  user: {
    username: string;
    password: string;
    service?: string;
    profile: string;
    remoteAddress?: string;
    comment?: string;
  }
): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    return await routerOSPool.execute(params, async (api) => {
      const cmdParams: string[] = [
        `=name=${user.username}`,
        `=password=${user.password}`,
        `=service=${user.service || 'pppoe'}`,
        `=profile=${user.profile || 'default'}`,
      ];
      if (user.remoteAddress) cmdParams.push(`=remote-address=${user.remoteAddress}`);
      if (user.comment) cmdParams.push(`=comment=${user.comment}`);

      const res: any = await api.write('/ppp/secret/add', cmdParams);
      const newId = Array.isArray(res) && res[0]?.['ret'] ? res[0]['ret'] : `sec-${user.username}`;
      return { success: true, id: newId };
    });
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to add PPPoE user' };
  }
}

/**
 * Delete PPPoE User using Persistent Connection
 */
export async function deletePppoeUserFromMikrotik(
  params: MikrotikConnectionParams,
  username: string
): Promise<{ success: boolean; error?: string }> {
  try {
    return await routerOSPool.execute(params, async (api) => {
      const secrets: any = await api.write('/ppp/secret/print');
      if (Array.isArray(secrets)) {
        const target = secrets.find((s: any) => s.name === username);
        if (target) {
          const secId = target['.id'] || target['id'];
          await api.write('/ppp/secret/remove', [`=.id=${secId}`]);
        }
      }
      return { success: true };
    });
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to delete PPPoE user' };
  }
}

/**
 * Update PPPoE Secret in MikroTik (Profile, Remote Address, Caller ID)
 */
export async function updatePppoeSecretInMikrotik(
  params: MikrotikConnectionParams,
  username: string,
  updates: {
    profile?: string;
    remoteAddress?: string;
    callerId?: string;
    comment?: string;
    disabled?: boolean;
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    return await routerOSPool.execute(params, async (api) => {
      const secrets: any = await api.write('/ppp/secret/print');
      if (Array.isArray(secrets)) {
        const target = secrets.find((s: any) => s.name?.toLowerCase() === username.toLowerCase());
        if (target) {
          const secId = target['.id'] || target['id'];
          const cmdParams = [`=.id=${secId}`];
          if (updates.profile !== undefined) cmdParams.push(`=profile=${updates.profile}`);
          if (updates.remoteAddress !== undefined) cmdParams.push(`=remote-address=${updates.remoteAddress}`);
          if (updates.callerId !== undefined) cmdParams.push(`=caller-id=${updates.callerId}`);
          if (updates.comment !== undefined) cmdParams.push(`=comment=${updates.comment}`);
          if (updates.disabled !== undefined) cmdParams.push(`=disabled=${updates.disabled ? 'yes' : 'no'}`);

          await api.write('/ppp/secret/set', cmdParams);
          return { success: true };
        }
      }
      return { success: false, error: `Secret ${username} not found on router` };
    });
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to update PPPoE secret' };
  }
}

/**
 * Reset MAC Binding (Caller ID) on MikroTik router
 */
export async function resetPppoeCallerIdInMikrotik(
  params: MikrotikConnectionParams,
  username: string
): Promise<{ success: boolean; error?: string }> {
  return updatePppoeSecretInMikrotik(params, username, { callerId: '' });
}

/**
 * Kick session by username
 */
export async function kickPppoeSessionByUsername(
  params: MikrotikConnectionParams,
  username: string
): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    return await routerOSPool.execute(params, async (api) => {
      const active: any = await api.write('/ppp/active/print');
      if (Array.isArray(active)) {
        const target = active.find((s: any) => s.name?.toLowerCase() === username.toLowerCase());
        if (target) {
          const sessId = target['.id'] || target['id'];
          await api.write('/ppp/active/remove', [`=.id=${sessId}`]);
          return { success: true, message: `Active session for ${username} kicked.` };
        }
      }
      return { success: true, message: `No active session found for ${username}.` };
    });
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to kick session by username' };
  }
}

export interface SubscriberTrafficResult {
  success: boolean;
  username: string;
  interfaceName: string;
  isOnline: boolean;
  rxBps: number;
  txBps: number;
  rxMbps: number;
  txMbps: number;
  downloadRateMbps: number;
  uploadRateMbps: number;
  liveRateFormatted: string;
  timestamp: string;
  source: 'monitor-traffic' | 'queue-simple' | 'session-active' | 'offline';
  error?: string;
}

/**
 * Real-Time Interface Traffic Telemetry for a specific subscriber (/interface/monitor-traffic)
 * Resolves dynamic interface `<pppoe-USERNAME>` with graceful queue-simple fallback
 */
export async function getSubscriberInterfaceTraffic(
  params: MikrotikConnectionParams,
  username: string
): Promise<SubscriberTrafficResult> {
  const cleanUser = (username || '').trim();
  const ifaceName = `<pppoe-${cleanUser}>`;
  const host = (params.host || '').trim();

  if (!cleanUser) {
    return {
      success: false,
      username: '',
      interfaceName: '',
      isOnline: false,
      rxBps: 0,
      txBps: 0,
      rxMbps: 0,
      txMbps: 0,
      downloadRateMbps: 0,
      uploadRateMbps: 0,
      liveRateFormatted: '0.0 Mbps / 0.0 Mbps',
      timestamp: new Date().toISOString(),
      source: 'offline',
      error: 'Username is required',
    };
  }

  if (!host) {
    return {
      success: true,
      username: cleanUser,
      interfaceName: ifaceName,
      isOnline: false,
      rxBps: 0,
      txBps: 0,
      rxMbps: 0,
      txMbps: 0,
      downloadRateMbps: 0,
      uploadRateMbps: 0,
      liveRateFormatted: '0.0 Mbps / 0.0 Mbps',
      timestamp: new Date().toISOString(),
      source: 'offline',
    };
  }

  try {
    return await routerOSPool.execute(params, async (api) => {
      // 1. Try /interface/monitor-traffic interface=<pppoe-USERNAME> once=true
      try {
        const traf: any = await api.write('/interface/monitor-traffic', [
          `=interface=${ifaceName}`,
          '=once=true',
        ]);

        if (Array.isArray(traf) && traf.length > 0) {
          const item = traf[0];
          const rxBps = Number(item['rx-bits-per-second'] ?? 0);
          const txBps = Number(item['tx-bits-per-second'] ?? 0);
          const rxMbps = Number((rxBps / 1_000_000).toFixed(2));
          const txMbps = Number((txBps / 1_000_000).toFixed(2));

          return {
            success: true,
            username: cleanUser,
            interfaceName: ifaceName,
            isOnline: true,
            rxBps,
            txBps,
            rxMbps,
            txMbps,
            downloadRateMbps: rxMbps,
            uploadRateMbps: txMbps,
            liveRateFormatted: `${formatBitsPerSecond(rxBps)} / ${formatBitsPerSecond(txBps)}`,
            timestamp: new Date().toISOString(),
            source: 'monitor-traffic',
          };
        }
      } catch (monitorErr: any) {
        // Continue to fallback if interface not found directly
      }

      // 2. Graceful fallback 1: Check /interface/print where name matches or contains username
      try {
        const ifaces: any = await api.write('/interface/print').catch(() => []);
        if (Array.isArray(ifaces)) {
          const matchedIface = ifaces.find((i: any) =>
            i.name?.toLowerCase() === ifaceName.toLowerCase() ||
            i.name?.toLowerCase() === cleanUser.toLowerCase() ||
            i.name?.toLowerCase().includes(cleanUser.toLowerCase())
          );

          if (matchedIface?.name) {
            const traf: any = await api.write('/interface/monitor-traffic', [
              `=interface=${matchedIface.name}`,
              '=once=true',
            ]).catch(() => []);

            if (Array.isArray(traf) && traf.length > 0) {
              const item = traf[0];
              const rxBps = Number(item['rx-bits-per-second'] ?? 0);
              const txBps = Number(item['tx-bits-per-second'] ?? 0);
              const rxMbps = Number((rxBps / 1_000_000).toFixed(2));
              const txMbps = Number((txBps / 1_000_000).toFixed(2));

              return {
                success: true,
                username: cleanUser,
                interfaceName: matchedIface.name,
                isOnline: true,
                rxBps,
                txBps,
                rxMbps,
                txMbps,
                downloadRateMbps: rxMbps,
                uploadRateMbps: txMbps,
                liveRateFormatted: `${formatBitsPerSecond(rxBps)} / ${formatBitsPerSecond(txBps)}`,
                timestamp: new Date().toISOString(),
                source: 'monitor-traffic',
              };
            }
          }
        }
      } catch (err) {}

      // 3. Graceful fallback 2: Check /queue/simple/print where name matches
      try {
        const queues: any = await api.write('/queue/simple/print').catch(() => []);
        if (Array.isArray(queues)) {
          const matchedQ = queues.find((q: any) =>
            q.name?.toLowerCase() === ifaceName.toLowerCase() ||
            q.name?.toLowerCase() === cleanUser.toLowerCase() ||
            q.name?.toLowerCase().includes(cleanUser.toLowerCase())
          );

          if (matchedQ && matchedQ.rate) {
            const parts = String(matchedQ.rate).split('/');
            const rxBps = Number(parts[0] || 0);
            const txBps = Number(parts[1] || 0);
            const rxMbps = Number((rxBps / 1_000_000).toFixed(2));
            const txMbps = Number((txBps / 1_000_000).toFixed(2));

            return {
              success: true,
              username: cleanUser,
              interfaceName: matchedQ.name || ifaceName,
              isOnline: true,
              rxBps,
              txBps,
              rxMbps,
              txMbps,
              downloadRateMbps: rxMbps,
              uploadRateMbps: txMbps,
              liveRateFormatted: `${formatBitsPerSecond(rxBps)} / ${formatBitsPerSecond(txBps)}`,
              timestamp: new Date().toISOString(),
              source: 'queue-simple',
            };
          }
        }
      } catch (err) {}

      // 4. Check /ppp/active/print
      const active: any = await api.write('/ppp/active/print').catch(() => []);
      const isActive = Array.isArray(active) && active.some((a: any) => a.name?.toLowerCase() === cleanUser.toLowerCase());

      return {
        success: true,
        username: cleanUser,
        interfaceName: ifaceName,
        isOnline: isActive,
        rxBps: 0,
        txBps: 0,
        rxMbps: 0,
        txMbps: 0,
        downloadRateMbps: 0,
        uploadRateMbps: 0,
        liveRateFormatted: '0.0 Mbps / 0.0 Mbps',
        timestamp: new Date().toISOString(),
        source: isActive ? 'session-active' : 'offline',
      };
    });
  } catch (poolErr: any) {
    return {
      success: false,
      username: cleanUser,
      interfaceName: ifaceName,
      isOnline: false,
      rxBps: 0,
      txBps: 0,
      rxMbps: 0,
      txMbps: 0,
      downloadRateMbps: 0,
      uploadRateMbps: 0,
      liveRateFormatted: '0.0 Mbps / 0.0 Mbps',
      timestamp: new Date().toISOString(),
      source: 'offline',
      error: poolErr.message || 'Router unreachable',
    };
  }
}

/**
 * Fast direct socket probe
 */
export function probeDirectSocketConnection(
  host: string,
  port: number,
  timeoutMs: number = 2500
): Promise<{ reachable: boolean; latencyMs: number; error?: string }> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const socket = new net.Socket();
    let isResolved = false;

    const cleanup = () => {
      socket.removeAllListeners();
      socket.destroy();
    };

    socket.setTimeout(timeoutMs);

    socket.on('connect', () => {
      if (isResolved) return;
      isResolved = true;
      const latencyMs = Date.now() - startTime;
      cleanup();
      resolve({ reachable: true, latencyMs });
    });

    socket.on('timeout', () => {
      if (isResolved) return;
      isResolved = true;
      cleanup();
      resolve({ reachable: false, latencyMs: Date.now() - startTime, error: 'Socket timed out' });
    });

    socket.on('error', (err: any) => {
      if (isResolved) return;
      isResolved = true;
      cleanup();
      resolve({ reachable: false, latencyMs: Date.now() - startTime, error: err.message });
    });

    socket.connect(port, host);
  });
}
