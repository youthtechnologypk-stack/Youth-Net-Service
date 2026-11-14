import { createClient, SupabaseClient } from '@supabase/supabase-js';

const DEFAULT_SUPABASE_URL = 'https://qstqegwpibztpirncpga.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_Ce_QIF3wHFISjJtTiYGY-Q_qs6miPTU';

const DEFAULT_ROUTER_HOST = process.env.MIKROTIK_HOST || '202.142.186.150';
const DEFAULT_ROUTER_PORT = process.env.MIKROTIK_PORT ? Number(process.env.MIKROTIK_PORT) : 81;
const DEFAULT_ROUTER_USER = process.env.MIKROTIK_USER || 'admin';
const DEFAULT_ROUTER_PASS = process.env.MIKROTIK_PASS || 'P@ssword@9595';

export interface LightweightPppActiveSession {
  '.id'?: string;
  id?: string;
  name?: string;
  username?: string;
  address?: string;
  'caller-id'?: string;
  callerId?: string;
  uptime?: string;
  bytes?: string;
  'rx-byte'?: string | number;
  'tx-byte'?: string | number;
  rawBytesIn?: number;
  rawBytesOut?: number;
}

export interface SyncSessionsOptions {
  routerHost?: string;
  routerPort?: number;
  useSsl?: boolean;
  authHeader?: string;
  username?: string;
  password?: string;
  activeSessions?: LightweightPppActiveSession[];
  nowMs?: number;
  supabaseClient?: SupabaseClient;
  timeoutMs?: number;
}

export interface SyncSessionsResult {
  success: boolean;
  routerStatus: 'online' | 'unreachable';
  onlineCount: number;
  inserted: number;
  updated: number;
  disconnected: number;
  durationMs: number;
  timestamp: string;
  error?: string;
}

export function getServerSupabaseClient(): SupabaseClient {
  const url =
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    DEFAULT_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    DEFAULT_SUPABASE_ANON_KEY;

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function parseRouterOsUptimeSeconds(uptimeStr?: string | null): number {
  if (!uptimeStr) return 0;
  const str = String(uptimeStr).trim();
  if (!str) return 0;

  let total = 0;
  const weeks = str.match(/(\d+)\s*w/i);
  const days = str.match(/(\d+)\s*d/i);
  const hours = str.match(/(\d+)\s*h/i);
  const minutes = str.match(/(\d+)\s*m(?!s)/i);
  const seconds = str.match(/(\d+)\s*s/i);

  if (weeks) total += parseInt(weeks[1], 10) * 604800;
  if (days) total += parseInt(days[1], 10) * 86400;
  if (hours) total += parseInt(hours[1], 10) * 3600;
  if (minutes) total += parseInt(minutes[1], 10) * 60;
  if (seconds) total += parseInt(seconds[1], 10);

  if (!weeks && !days && !hours && !minutes && !seconds && str.includes(':')) {
    const parts = str.split(':').map((p) => parseInt(p, 10));
    if (parts.length === 3 && parts.every((n) => !Number.isNaN(n))) {
      total = parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2 && parts.every((n) => !Number.isNaN(n))) {
      total = parts[0] * 60 + parts[1];
    }
  }

  return Math.max(0, total);
}

export function formatDurationHms(totalSeconds?: number | null): string {
  const safe = Math.max(0, Math.floor(Number(totalSeconds || 0)));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function resolveRouterRestTarget(options?: SyncSessionsOptions): {
  host: string;
  port: number;
  protocol: 'http' | 'https';
  authHeader: string;
} {
  let host = String(options?.routerHost || DEFAULT_ROUTER_HOST)
    .trim()
    .replace(/^https?:\/\//i, '');
  let embeddedPort: number | undefined;
  if (host.includes(':')) {
    const parts = host.split(':');
    host = parts[0].trim();
    const parsed = parseInt(parts[1], 10);
    if (!Number.isNaN(parsed)) embeddedPort = parsed;
  }
  host = host.replace(/:\d+$/, '').trim() || DEFAULT_ROUTER_HOST;

  let isSsl = Boolean(options?.useSsl);
  let port = Number(options?.routerPort || embeddedPort || 0);

  if (host === '202.142.186.150') {
    port = port && port !== 443 && port !== 8728 && port !== 8729 ? port : 81;
    isSsl = false;
  } else if (!port || port === 8728 || port === 8729) {
    port = isSsl ? 443 : 80;
  }

  const protocol: 'http' | 'https' =
    isSsl || port === 443 || port === 8443 ? 'https' : 'http';

  let authHeader = (options?.authHeader || '').trim();
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    const user = (options?.username || DEFAULT_ROUTER_USER).trim();
    const pass = options?.password ?? DEFAULT_ROUTER_PASS;
    authHeader = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
  }

  return { host, port, protocol, authHeader };
}

/**
 * Fetches `/rest/ppp/active` selecting only `.id,name,address,caller-id,uptime`
 * with automatic fallback to `/rest/ppp/active` in one lightweight call.
 */
export async function fetchActivePppoeSessionsLightweight(
  options?: SyncSessionsOptions
): Promise<LightweightPppActiveSession[]> {
  const target = resolveRouterRestTarget(options);
  const timeoutMs = options?.timeoutMs ?? 5500;
  const baseUrl = `${target.protocol}://${target.host}:${target.port}/rest/ppp/active`;
  const urls = [
    `${baseUrl}?.proplist=.id,name,address,caller-id,uptime`,
    baseUrl,
  ];

  let lastError: Error | null = null;
  for (const url of urls) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: target.authHeader,
          Accept: 'application/json',
          Connection: 'close',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (res.status === 401) {
        throw new Error('Router authentication failed (HTTP 401)');
      }
      if (!res.ok) {
        lastError = new Error(`RouterOS REST returned HTTP ${res.status}`);
        continue;
      }

      const data = await res.json();
      if (!Array.isArray(data)) {
        lastError = new Error('RouterOS /rest/ppp/active returned non-array JSON');
        continue;
      }
      return data as LightweightPppActiveSession[];
    } catch (err: any) {
      clearTimeout(timer);
      lastError = err instanceof Error ? err : new Error(String(err));
      if (lastError.message.includes('HTTP 401')) {
        throw lastError;
      }
    }
  }

  throw lastError || new Error(`Unable to reach MikroTik at ${target.host}:${target.port}`);
}

function extractIncomingBytes(sess: LightweightPppActiveSession): { bytesIn: number; bytesOut: number } {
  let bytesIn = Math.max(0, Number(sess.rawBytesIn || 0));
  let bytesOut = Math.max(0, Number(sess.rawBytesOut || 0));
  if (bytesIn === 0 && bytesOut === 0) {
    if (sess.bytes && typeof sess.bytes === 'string' && sess.bytes.includes('/')) {
      const [rx, tx] = sess.bytes.split('/');
      bytesIn = Math.max(0, Number(rx) || 0);
      bytesOut = Math.max(0, Number(tx) || 0);
    } else {
      bytesIn = Math.max(0, Number(sess['rx-byte'] || 0));
      bytesOut = Math.max(0, Number(sess['tx-byte'] || 0));
    }
  }
  return { bytesIn, bytesOut };
}

async function batchUpdateRows(
  supabase: SupabaseClient,
  rows: Array<Record<string, any>>
): Promise<number> {
  if (rows.length === 0) return 0;

  const { error: upsertErr } = await supabase
    .from('subscriber_session_logs')
    .upsert(rows, { onConflict: 'id' });

  if (!upsertErr) {
    return rows.length;
  }

  // Chunked parallel fallback if partial update is required by RLS
  const CHUNK_SIZE = 20;
  let updatedCount = 0;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const results = await Promise.all(
      chunk.map((row) => {
        const { id, ...fields } = row;
        return supabase.from('subscriber_session_logs').update(fields).eq('id', id);
      })
    );
    for (const r of results) {
      if (!r.error) updatedCount += 1;
    }
  }
  return updatedCount;
}

/**
 * Fast server-side PPPoE session generator & reconciler (< 2s execution).
 * Reads MikroTik `/rest/ppp/active` (or verified poll payload) + Supabase `ACTIVE` rows,
 * then performs batched INSERT + UPDATE + DISCONNECT operations.
 */
export async function syncSessionsFromMikrotik(
  options: SyncSessionsOptions = {}
): Promise<SyncSessionsResult> {
  const startedAt = Date.now();
  const nowMs = options.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const supabase = options.supabaseClient || getServerSupabaseClient();

  try {
    // 1. Fetch active PPPoE sessions (use provided verified poll payload or lightweight MikroTik call)
    const rawActiveSessions = Array.isArray(options.activeSessions)
      ? options.activeSessions
      : await fetchActivePppoeSessionsLightweight(options);

    // 2. Fetch all currently 'ACTIVE' rows from Supabase in one single query
    const { data: activeDbRows, error: dbFetchErr } = await supabase
      .from('subscriber_session_logs')
      .select('*')
      .eq('session_status', 'ACTIVE')
      .order('recorded_at', { ascending: false })
      .limit(1000);

    if (dbFetchErr) {
      throw new Error(`Supabase fetch error: ${dbFetchErr.message}`);
    }

    // Index live MikroTik sessions by lowercase username
    const onlineByUser = new Map<
      string,
      {
        username: string;
        sessionId: string;
        hasRealId: boolean;
        ipAddress: string;
        macAddress: string;
        uptimeSeconds: number;
        uptimeFormatted: string;
        connectedAtMs: number;
        connectedAtIso: string;
        bytesIn: number;
        bytesOut: number;
      }
    >();

    for (const raw of rawActiveSessions) {
      const uname = String(raw.name || raw.username || '').trim();
      const key = uname.toLowerCase();
      if (!key) continue;

      const uptimeSeconds = parseRouterOsUptimeSeconds(raw.uptime);
      const uptimeFormatted = formatDurationHms(uptimeSeconds);
      const connectedAtMs = nowMs - uptimeSeconds * 1000;
      const connectedAtIso = new Date(connectedAtMs).toISOString();
      const macAddress = String(raw['caller-id'] || raw.callerId || '').trim();
      const macNorm = (macAddress || 'NO-MAC').toUpperCase();
      const realId = String(raw['.id'] || raw.id || '').trim();
      const hasRealId = Boolean(realId);
      const sessionId = realId || `${macNorm}|${Math.round(connectedAtMs / 60_000)}`;
      const ipAddress = String(raw.address || '').trim() || 'Dynamic IP';
      const { bytesIn, bytesOut } = extractIncomingBytes(raw);

      onlineByUser.set(key, {
        username: uname,
        sessionId,
        hasRealId,
        ipAddress,
        macAddress,
        uptimeSeconds,
        uptimeFormatted,
        connectedAtMs,
        connectedAtIso,
        bytesIn,
        bytesOut,
      });
    }

    // Group existing ACTIVE DB rows by lowercase username
    const dbRowsByUser = new Map<string, Array<Record<string, any>>>();
    for (const row of (activeDbRows || []) as Array<Record<string, any>>) {
      const key = String(row.subscriber_username || '').trim().toLowerCase();
      if (!key || !row.id) continue;
      const list = dbRowsByUser.get(key) || [];
      list.push(row);
      dbRowsByUser.set(key, list);
    }

    const rowsToInsert: Array<Record<string, any>> = [];
    const rowsToUpdateActive: Array<Record<string, any>> = [];
    const rowsToDisconnect: Array<Record<string, any>> = [];

    const buildDisconnectRecord = (row: Record<string, any>): Record<string, any> => {
      const connectedMs =
        new Date(row.connected_at || row.recorded_at || nowIso).getTime() || nowMs;
      const finalSeconds = Math.max(1, Math.floor((nowMs - connectedMs) / 1000));
      return {
        ...row,
        session_status: 'DISCONNECTED',
        disconnect_reason: 'User-Request / Link-Down',
        disconnected_at: nowIso,
        recorded_at: nowIso,
        uptime_seconds: finalSeconds,
        uptime_duration: formatDurationHms(finalSeconds),
      };
    };

    // 3. Reconcile online PPPoE users against existing ACTIVE rows
    for (const [key, live] of onlineByUser.entries()) {
      const existingRows = dbRowsByUser.get(key) || [];
      let matchedPrimary: Record<string, any> | null = null;

      for (const row of existingRows) {
        const dbSessionId = String(row.session_id || '').trim();
        const dbHasRealId = Boolean(dbSessionId && !dbSessionId.includes('|'));
        const dbUptimeSec = Number(
          row.uptime_seconds ?? parseRouterOsUptimeSeconds(row.uptime_duration)
        );
        const dbConnectedMs =
          new Date(row.connected_at || row.recorded_at || nowIso).getTime() || nowMs;
        const dbMac = String(row.mac_address || '').trim().toUpperCase();
        const liveMacNorm = live.macAddress.toUpperCase();

        const isSameSession =
          !matchedPrimary &&
          (dbHasRealId && live.hasRealId
            ? dbSessionId === live.sessionId && live.uptimeSeconds >= dbUptimeSec - 15
            : live.uptimeSeconds >= dbUptimeSec - 15 &&
              (!dbMac || !liveMacNorm || dbMac === liveMacNorm) &&
              Math.abs(dbConnectedMs - live.connectedAtMs) <= 120_000);

        if (isSameSession) {
          matchedPrimary = row;
        } else {
          // Close stale or superseded ACTIVE row cleanly
          rowsToDisconnect.push(buildDisconnectRecord(row));
        }
      }

      if (matchedPrimary) {
        const dbConnectedMs =
          new Date(matchedPrimary.connected_at || matchedPrimary.recorded_at || nowIso).getTime() ||
          nowMs;
        const driftedLogin =
          live.uptimeSeconds > 0 && Math.abs(dbConnectedMs - live.connectedAtMs) > 120_000;
        const effectiveConnectedAt = driftedLogin
          ? live.connectedAtIso
          : matchedPrimary.connected_at || live.connectedAtIso;

        const existingBytesIn = Math.max(0, Number(matchedPrimary.bytes_in || 0));
        const existingBytesOut = Math.max(0, Number(matchedPrimary.bytes_out || 0));

        rowsToUpdateActive.push({
          ...matchedPrimary,
          session_id: live.sessionId,
          ip_address: live.ipAddress,
          mac_address: live.macAddress || matchedPrimary.mac_address || null,
          uptime_seconds: live.uptimeSeconds,
          uptime_duration: live.uptimeFormatted,
          bytes_in: Math.max(existingBytesIn, live.bytesIn),
          bytes_out: Math.max(existingBytesOut, live.bytesOut),
          connected_at: effectiveConnectedAt,
          recorded_at: nowIso,
        });
      } else {
        rowsToInsert.push({
          subscriber_username: live.username,
          session_id: live.sessionId,
          ip_address: live.ipAddress,
          mac_address: live.macAddress || null,
          uptime_duration: live.uptimeFormatted,
          uptime_seconds: live.uptimeSeconds,
          bytes_in: live.bytesIn,
          bytes_out: live.bytesOut,
          session_status: 'ACTIVE',
          disconnect_reason: 'ONLINE (Active)',
          connected_at: live.connectedAtIso,
          disconnected_at: null,
          recorded_at: nowIso,
        });
      }
    }

    // 4. Close every ACTIVE row whose username is no longer in /rest/ppp/active
    for (const [key, existingRows] of dbRowsByUser.entries()) {
      if (onlineByUser.has(key)) continue;
      for (const row of existingRows) {
        rowsToDisconnect.push(buildDisconnectRecord(row));
      }
    }

    // Execute batched INSERT, active UPDATE, and disconnect UPDATE concurrently
    const [insertResult, updatedCount, disconnectedCount] = await Promise.all([
      rowsToInsert.length > 0
        ? supabase.from('subscriber_session_logs').insert(rowsToInsert)
        : Promise.resolve({ error: null }),
      batchUpdateRows(supabase, rowsToUpdateActive),
      batchUpdateRows(supabase, rowsToDisconnect),
    ]);

    if (insertResult.error) {
      throw new Error(`Supabase batch insert error: ${insertResult.error.message}`);
    }

    return {
      success: true,
      routerStatus: 'online',
      onlineCount: onlineByUser.size,
      inserted: rowsToInsert.length,
      updated: updatedCount,
      disconnected: disconnectedCount,
      durationMs: Date.now() - startedAt,
      timestamp: nowIso,
    };
  } catch (err: any) {
    return {
      success: false,
      routerStatus: 'unreachable',
      onlineCount: 0,
      inserted: 0,
      updated: 0,
      disconnected: 0,
      durationMs: Date.now() - startedAt,
      timestamp: nowIso,
      error: err?.message || 'Failed to synchronize PPPoE sessions',
    };
  }
}
