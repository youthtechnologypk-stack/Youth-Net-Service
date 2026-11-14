import { ActiveSession, RouterInterface } from '../types/isp';
import { safeMikrotikFetch } from './mikrotikRestClient';
import { supabase, SupabaseSubscriberSessionLog } from './supabaseClient';

export interface TrackedSessionSnapshot {
  username: string;
  sessionId: string;
  hasRealId: boolean;
  ipAddress: string;
  macAddress: string;
  uptime: string;
  uptimeSeconds: number;
  bytesIn: number;
  bytesOut: number;
  connectedAtIso: string;
  connectedAtMs: number;
  startMinute: number;
  lastSeenMs: number;
}

export interface MikrotikLogEntry {
  '.id'?: string;
  time?: string;
  topics?: string;
  message?: string;
}

export interface SyncCycleOptions {
  routerId?: string;
  sessionsPolledOk?: boolean;
  interfacesFresh?: boolean;
  interfacesPolledAtMs?: number;
  nowMs?: number;
  mikrotikLogs?: MikrotikLogEntry[];
}

/**
 * Converts RouterOS uptime string (e.g., "1d2h30m15s", "1w2d", "02:15:30", "45m12s")
 * into total seconds.
 */
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

/**
 * Formats total seconds strictly as HH:MM:SS (e.g., "02:15:37", "25:42:40", "00:03:04").
 */
export function formatDurationHms(totalSeconds?: number | null): string {
  const safe = Math.max(0, Math.floor(Number(totalSeconds || 0)));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Formats an ISO string, timestamp, or Date strictly as DD/MM/YYYY HH:mm:ss.
 */
export function formatRadiusDateTime(input?: string | number | Date | null): string {
  if (input === null || input === undefined || input === '') return '—';
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${hh}:${min}:${ss}`;
}

/**
 * Normalizes RADIUS/RouterOS disconnect reason labels cleanly for display.
 */
export function formatDisconnectReasonBadge(
  reason?: string | null,
  status?: string | null
): string {
  const upperStatus = (status || '').toUpperCase();
  if (upperStatus === 'ACTIVE') return 'ONLINE (Active)';

  const raw = (reason || '').trim();
  const lower = raw.toLowerCase();

  if (upperStatus === 'KICKED' || /admin|noc|kicked/.test(lower)) {
    return 'Admin-Reset';
  }
  if (/user[\s_-]*request/.test(lower)) {
    return 'User-Request';
  }
  if (/peer[\s_-]*not[\s_-]*responding|lcp.*timeout|echo/.test(lower)) {
    return 'Peer-Not-Responding';
  }
  if (/lost[\s_-]*carrier|hungup/.test(lower)) {
    return 'Lost-Carrier';
  }
  if (/reconnect/.test(lower)) {
    return 'Session-Reconnect';
  }
  if (!raw || /link[\s_-]*down|client disconnected|closed stale|duplicate|disconnected|ended|pppoe session/.test(lower)) {
    return 'Link-Down';
  }
  return raw;
}

/**
 * Computes exact elapsed seconds from (Logoff - Login) when closed, or fallback live uptime.
 */
export function computeExactSessionUptimeSeconds(
  connectedAt?: string | null,
  disconnectedAt?: string | null,
  fallbackSeconds?: number | null,
  fallbackDurationStr?: string | null
): number {
  if (connectedAt && disconnectedAt) {
    const startMs = new Date(connectedAt).getTime();
    const endMs = new Date(disconnectedAt).getTime();
    if (!Number.isNaN(startMs) && !Number.isNaN(endMs) && endMs >= startMs) {
      return Math.max(0, Math.floor((endMs - startMs) / 1000));
    }
  }
  if (typeof fallbackSeconds === 'number' && !Number.isNaN(fallbackSeconds) && fallbackSeconds >= 0) {
    return Math.floor(fallbackSeconds);
  }
  return parseRouterOsUptimeSeconds(fallbackDurationStr);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extracts the latest RouterOS PPPoE disconnect reason for a given subscriber
 * from `/api/mikrotik/log` entries.
 */
export function parseMikrotikDisconnectReason(
  username: string,
  logs: MikrotikLogEntry[] = []
): string {
  const uname = (username || '').trim().toLowerCase();
  if (!uname || !Array.isArray(logs) || logs.length === 0) {
    return 'Link-Down';
  }

  const userBoundaryRegex = new RegExp(`(^|[^a-z0-9_.-])${escapeRegExp(uname)}([^a-z0-9_.-]|$)`, 'i');

  for (let i = logs.length - 1; i >= 0; i -= 1) {
    const entry = logs[i];
    const topics = String(entry?.topics || '').toLowerCase();
    const message = String(entry?.message || '').toLowerCase();
    if (!message) continue;

    const mentionsUser =
      message.includes(`<pppoe-${uname}>`) ||
      message.includes(`${uname}:`) ||
      userBoundaryRegex.test(message);
    if (!mentionsUser) continue;

    const relevantTopic = !topics || topics.includes('ppp') || topics.includes('account') || topics.includes('info');
    if (!relevantTopic) continue;

    const isDisconnectEvent =
      message.includes('terminating') ||
      message.includes('logged out') ||
      message.includes('disconnected') ||
      message.includes('user request') ||
      message.includes('user-request') ||
      message.includes('lost carrier') ||
      message.includes('lost-carrier') ||
      message.includes('hungup') ||
      message.includes('peer is not responding') ||
      message.includes('peer-not-responding') ||
      message.includes('link down') ||
      message.includes('link-down') ||
      message.includes('admin');

    if (!isDisconnectEvent) continue;

    if (message.includes('user request') || message.includes('user-request')) {
      return 'User-Request';
    }
    if (
      message.includes('peer is not responding') ||
      message.includes('peer-not-responding') ||
      message.includes('echo') ||
      message.includes('timeout')
    ) {
      return 'Peer-Not-Responding';
    }
    if (
      message.includes('lost carrier') ||
      message.includes('lost-carrier') ||
      message.includes('hungup')
    ) {
      return 'Lost-Carrier';
    }
    if (message.includes('admin') || message.includes('kicked') || message.includes('reset')) {
      return 'Admin-Reset';
    }
    if (message.includes('terminat')) {
      return 'Lost-Carrier';
    }
    return 'Link-Down';
  }

  return 'Link-Down';
}

/**
 * Queries RouterOS `/api/mikrotik/log` once and resolves disconnect reasons for usernames.
 * Safely falls back to 'Link-Down' if unreachable or running headless.
 */
export async function fetchMikrotikDisconnectReasons(
  usernames: string[],
  providedLogs?: MikrotikLogEntry[]
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const cleanNames = Array.from(
    new Set(usernames.map((u) => (u || '').trim()).filter(Boolean))
  );
  if (cleanNames.length === 0) return result;

  let logs: MikrotikLogEntry[] = Array.isArray(providedLogs) ? providedLogs : [];

  if (!Array.isArray(providedLogs) && typeof window !== 'undefined') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      const res = await safeMikrotikFetch('/api/mikrotik/log', {
        method: 'GET',
        signal: controller.signal,
      });
      if (res.ok) {
        const parsed = await res.json();
        if (Array.isArray(parsed)) {
          logs = parsed as MikrotikLogEntry[];
        }
      }
    } catch {
      // Fallback to Link-Down cleanly when log fetch fails or times out
    } finally {
      clearTimeout(timer);
    }
  }

  for (const uname of cleanNames) {
    result[uname.toLowerCase()] = parseMikrotikDisconnectReason(uname, logs);
  }
  return result;
}

/**
 * Formats raw bytes into human-readable MB or GB string.
 */
export function formatBytesTransfer(bytes?: number | null): string {
  const safeBytes = Math.max(0, Number(bytes || 0));
  const gb = safeBytes / (1024 * 1024 * 1024);
  if (gb >= 1) {
    return `${gb.toFixed(2)} GB`;
  }
  const mb = safeBytes / (1024 * 1024);
  if (mb >= 0.01) {
    return `${mb.toFixed(2)} MB`;
  }
  if (safeBytes > 0) {
    return `${(safeBytes / 1024).toFixed(1)} KB`;
  }
  return '0.00 MB';
}

/**
 * Matches `<pppoe-username>` / `pppoe-username` inside RouterOS /interface telemetry
 * and merges with any raw byte counters returned on /ppp/active.
 */
export function resolveSessionInterfaceBytes(
  session: Partial<ActiveSession> & { username?: string; name?: string; rawBytesIn?: number; rawBytesOut?: number },
  interfaces: RouterInterface[] = []
): { bytesIn: number; bytesOut: number } {
  const uname = (session.username || session.name || '').trim().toLowerCase();
  const baseIn = Math.max(0, Number(session.rawBytesIn || 0));
  const baseOut = Math.max(0, Number(session.rawBytesOut || 0));

  if (!uname || !interfaces || interfaces.length === 0) {
    return { bytesIn: baseIn, bytesOut: baseOut };
  }

  const targetWrapped = `<pppoe-${uname}>`;
  const targetBare = `pppoe-${uname}`;

  const matchedIface = interfaces.find((iface) => {
    const n = (iface.name || '').trim().toLowerCase();
    return n === targetWrapped || n === targetBare;
  });

  if (!matchedIface) {
    return { bytesIn: baseIn, bytesOut: baseOut };
  }

  const ifaceRx = Math.max(0, Number(matchedIface.rxBytes || 0));
  const ifaceTx = Math.max(0, Number(matchedIface.txBytes || 0));

  return {
    bytesIn: Math.max(baseIn, ifaceRx),
    bytesOut: Math.max(baseOut, ifaceTx),
  };
}

/**
 * Computes deterministic identity for a MikroTik PPPoE session.
 * Uses MikroTik's real `.id` when present, otherwise falls back to
 * `callerId + roundedStartMinute`.
 */
function resolveSessionIdentity(
  sess: ActiveSession,
  uptimeSeconds: number,
  nowMs: number
): {
  sessionId: string;
  hasRealId: boolean;
  macNormalized: string;
  connectedAtMs: number;
  connectedAtIso: string;
  startMinute: number;
} {
  const hasDotIdProp = Object.prototype.hasOwnProperty.call(sess, '.id');
  const rawId = hasDotIdProp
    ? String((sess as any)['.id'] || '').trim()
    : String((sess as any)['.id'] || sess.id || '').trim();

  const connectedAtMs = nowMs - uptimeSeconds * 1000;
  const connectedAtIso = new Date(connectedAtMs).toISOString();
  const startMinute = Math.round(connectedAtMs / 60_000);
  const macNormalized = (sess.callerId || 'NO-MAC').trim().toUpperCase();

  if (rawId) {
    return {
      sessionId: rawId,
      hasRealId: true,
      macNormalized,
      connectedAtMs,
      connectedAtIso,
      startMinute,
    };
  }

  return {
    sessionId: `${macNormalized}|${startMinute}`,
    hasRealId: false,
    macNormalized,
    connectedAtMs,
    connectedAtIso,
    startMinute,
  };
}

/**
 * Live Session Diff & Supabase Persistence Engine
 * Strictly tracks each PPPoE session independently with exact RADIUS-style
 * (Logoff - Login) HH:MM:SS uptime accounting and RouterOS disconnect reasons.
 */
class SessionSyncEngine {
  private prevActiveSessions = new Map<string, TrackedSessionSnapshot>();
  private activeLogIds = new Map<string, string>();
  private lastPersistedAt = new Map<string, number>();
  private kickedRecently = new Map<string, number>();
  private hydrated = false;
  private hydrationPromise: Promise<void> | null = null;
  private syncInFlight = false;
  private activeRouterId: string | null = null;
  private lastOrphanSweepMs = 0;
  private readonly TELEMETRY_INTERVAL_MS = 30_000;
  private readonly ORPHAN_SWEEP_INTERVAL_MS = 60_000;

  /**
   * Reset in-memory session cache (useful on router switch or test runs).
   */
  public resetInMemoryState(): void {
    this.prevActiveSessions.clear();
    this.activeLogIds.clear();
    this.lastPersistedAt.clear();
    this.kickedRecently.clear();
    this.hydrated = false;
    this.hydrationPromise = null;
    this.lastOrphanSweepMs = 0;
  }

  private async ensureHydrated(): Promise<void> {
    if (this.hydrated) return;
    if (this.hydrationPromise) return this.hydrationPromise;

    this.hydrationPromise = (async () => {
      try {
        const { data, error } = await supabase
          .from('subscriber_session_logs')
          .select('*')
          .eq('session_status', 'ACTIVE')
          .order('recorded_at', { ascending: false })
          .limit(500);

        if (error || !Array.isArray(data)) {
          this.hydrated = true;
          return;
        }

        const nowMs = Date.now();
        const nowIso = new Date(nowMs).toISOString();

        for (const row of data as SupabaseSubscriberSessionLog[]) {
          const uname = (row.subscriber_username || '').trim();
          const key = uname.toLowerCase();
          if (!key || !row.id) continue;

          if (this.activeLogIds.has(key)) {
            const rowConnectedMs =
              new Date(row.connected_at || row.recorded_at || nowIso).getTime() || nowMs;
            const exactSeconds = Math.max(1, Math.floor((nowMs - rowConnectedMs) / 1000));
            await supabase
              .from('subscriber_session_logs')
              .update({
                session_status: 'DISCONNECTED',
                disconnect_reason: 'Link-Down',
                disconnected_at: nowIso,
                recorded_at: nowIso,
                uptime_seconds: exactSeconds,
                uptime_duration: formatDurationHms(exactSeconds),
              })
              .eq('id', row.id);
            continue;
          }

          this.activeLogIds.set(key, row.id);
          const recordedMs = row.recorded_at ? new Date(row.recorded_at).getTime() : nowMs;
          const connectedAtIso = row.connected_at || row.recorded_at || nowIso;
          const connectedAtMs = new Date(connectedAtIso).getTime() || nowMs;
          const uptimeSeconds = Number(
            row.uptime_seconds ?? parseRouterOsUptimeSeconds(row.uptime_duration)
          );
          const rawSessionId = String(row.session_id || '').trim();
          const hasRealId = Boolean(rawSessionId && !rawSessionId.includes('|'));

          if (recordedMs > 0) {
            this.lastPersistedAt.set(key, recordedMs);
          }

          this.prevActiveSessions.set(key, {
            username: uname,
            sessionId: rawSessionId,
            hasRealId,
            ipAddress: row.ip_address || '',
            macAddress: (row.mac_address || '').trim().toUpperCase(),
            uptime: formatDurationHms(uptimeSeconds),
            uptimeSeconds,
            bytesIn: Number(row.bytes_in || 0),
            bytesOut: Number(row.bytes_out || 0),
            connectedAtIso,
            connectedAtMs,
            startMinute: Math.round(connectedAtMs / 60_000),
            lastSeenMs: recordedMs || nowMs,
          });
        }
      } catch (err) {
        console.warn('[SessionSyncEngine] Hydration error:', err);
      } finally {
        this.hydrated = true;
        this.hydrationPromise = null;
      }
    })();

    return this.hydrationPromise;
  }

  /**
   * Closes orphaned 'ACTIVE' DB rows whose subscriber is absent from live /ppp/active.
   */
  private async closeOrphanedActiveRows(
    currentKeys: Set<string>,
    nowMs: number,
    getDisconnectReason: (uname: string) => Promise<string>
  ): Promise<void> {
    const nowIso = new Date(nowMs).toISOString();
    const { data: openRows } = await supabase
      .from('subscriber_session_logs')
      .select('*')
      .eq('session_status', 'ACTIVE')
      .limit(500);

    if (!Array.isArray(openRows) || openRows.length === 0) return;

    for (const row of openRows as SupabaseSubscriberSessionLog[]) {
      if (!row.id) continue;
      const uname = (row.subscriber_username || '').trim();
      const key = uname.toLowerCase();
      if (!key) continue;

      const kickTs = this.kickedRecently.get(key);
      if (kickTs && nowMs - kickTs < 25_000) continue;

      // Keep only the single tracked active row for currently online users
      if (currentKeys.has(key) && this.activeLogIds.get(key) === row.id) {
        continue;
      }

      const connectedMs =
        new Date(row.connected_at || row.recorded_at || nowIso).getTime() || nowMs;
      const finalSeconds = Math.max(1, Math.floor((nowMs - connectedMs) / 1000));
      const finalDuration = formatDurationHms(finalSeconds);
      const reason = await getDisconnectReason(uname);

      await supabase
        .from('subscriber_session_logs')
        .update({
          session_status: 'DISCONNECTED',
          disconnect_reason: reason,
          disconnected_at: nowIso,
          recorded_at: nowIso,
          uptime_seconds: finalSeconds,
          uptime_duration: finalDuration,
        })
        .eq('id', row.id);

      if (!currentKeys.has(key)) {
        this.prevActiveSessions.delete(key);
        this.activeLogIds.delete(key);
        this.lastPersistedAt.delete(key);
      }
    }
  }

  /**
   * Reconciles a specific subscriber's stale ACTIVE rows when MikroTik /ppp/active
   * confirms they are currently Offline.
   */
  public async reconcileOfflineSubscriberActiveRows(
    username: string,
    isLiveOnline: boolean,
    providedLogs?: MikrotikLogEntry[]
  ): Promise<SupabaseSubscriberSessionLog[] | null> {
    const uname = (username || '').trim();
    const key = uname.toLowerCase();
    if (!key) return null;

    if (!isLiveOnline) {
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      const kickTs = this.kickedRecently.get(key);

      if (!kickTs || nowMs - kickTs >= 25_000) {
        const { data: openRows } = await supabase
          .from('subscriber_session_logs')
          .select('*')
          .ilike('subscriber_username', uname)
          .eq('session_status', 'ACTIVE')
          .limit(20);

        if (Array.isArray(openRows) && openRows.length > 0) {
          const reasonMap = await fetchMikrotikDisconnectReasons([uname], providedLogs);
          const reason = reasonMap[key] || 'Link-Down';

          for (const row of openRows as SupabaseSubscriberSessionLog[]) {
            if (!row.id) continue;
            const connectedMs =
              new Date(row.connected_at || row.recorded_at || nowIso).getTime() || nowMs;
            const finalSeconds = Math.max(1, Math.floor((nowMs - connectedMs) / 1000));
            const finalDuration = formatDurationHms(finalSeconds);

            await supabase
              .from('subscriber_session_logs')
              .update({
                session_status: 'DISCONNECTED',
                disconnect_reason: reason,
                disconnected_at: nowIso,
                recorded_at: nowIso,
                uptime_seconds: finalSeconds,
                uptime_duration: finalDuration,
              })
              .eq('id', row.id);
          }
        }
      }

      this.prevActiveSessions.delete(key);
      this.activeLogIds.delete(key);
      this.lastPersistedAt.delete(key);
    }

    const { data: refreshed } = await supabase
      .from('subscriber_session_logs')
      .select('*')
      .in('subscriber_username', [uname, uname.toLowerCase()])
      .order('recorded_at', { ascending: false })
      .limit(50);

    return Array.isArray(refreshed) ? (refreshed as SupabaseSubscriberSessionLog[]) : null;
  }

  /**
   * Synchronize current MikroTik active sessions & interface bytes to Supabase.
   */
  public async syncCycle(
    activeSessions: ActiveSession[],
    interfaces: RouterInterface[] = [],
    options?: SyncCycleOptions
  ): Promise<void> {
    if (options?.sessionsPolledOk === false) {
      return;
    }

    if (this.syncInFlight) return;
    this.syncInFlight = true;

    try {
      if (options?.routerId && this.activeRouterId && this.activeRouterId !== options.routerId) {
        // Router switched: clear local memory and re-hydrate cleanly without marking previous router's users offline
        this.resetInMemoryState();
      }
      if (options?.routerId) {
        this.activeRouterId = options.routerId;
      }

      await this.ensureHydrated();

      const nowMs = options?.nowMs ?? Date.now();
      const nowIso = new Date(nowMs).toISOString();
      const currentKeys = new Set<string>();

      // Expire old manual-kick suppression entries (> 25s)
      for (const [k, ts] of this.kickedRecently.entries()) {
        if (nowMs - ts > 25_000) {
          this.kickedRecently.delete(k);
        }
      }

      // Lazy single-fetch MikroTik log helper (runs only if a disconnect/reconnect actually occurs)
      let reasonCachePromise: Promise<Record<string, string>> | null = null;
      const getDisconnectReason = async (uname: string): Promise<string> => {
        if (!reasonCachePromise) {
          const allTargets = Array.from(
            new Set([
              uname,
              ...Array.from(this.prevActiveSessions.values()).map((p) => p.username),
            ])
          );
          reasonCachePromise = fetchMikrotikDisconnectReasons(allTargets, options?.mikrotikLogs);
        }
        const map = await reasonCachePromise;
        const cleanKey = (uname || '').trim().toLowerCase();
        if (map[cleanKey]) return map[cleanKey];
        // Handle newly encountered username if providedLogs exist
        if (options?.mikrotikLogs) {
          return parseMikrotikDisconnectReason(uname, options.mikrotikLogs);
        }
        return 'Link-Down';
      };

      // Deduplicate activeSessions by lowercase username
      const dedupedSessions = new Map<string, ActiveSession>();
      for (const sess of activeSessions) {
        const key = (sess.username || '').trim().toLowerCase();
        if (!key) continue;
        dedupedSessions.set(key, sess);
      }

      for (const [key, sess] of dedupedSessions.entries()) {
        const uname = (sess.username || '').trim();
        currentKeys.add(key);

        const uptimeStr = sess.uptime || '0s';
        const uptimeSeconds = parseRouterOsUptimeSeconds(uptimeStr);
        const formattedUptime = formatDurationHms(uptimeSeconds);
        const identity = resolveSessionIdentity(sess, uptimeSeconds, nowMs);
        const ipAddress = sess.address || 'Dynamic IP';
        const macAddress = sess.callerId || '';

        let prev = this.prevActiveSessions.get(key);
        let existingLogId = this.activeLogIds.get(key);

        // If memory doesn't have an active row yet for this username, verify against Supabase first
        // so page reloads or concurrent tabs NEVER insert a duplicate row for an ongoing session.
        if (!prev || !existingLogId) {
          const { data: dbActiveRows } = await supabase
            .from('subscriber_session_logs')
            .select('*')
            .ilike('subscriber_username', uname)
            .eq('session_status', 'ACTIVE')
            .order('recorded_at', { ascending: false })
            .limit(5);

          if (Array.isArray(dbActiveRows) && dbActiveRows.length > 0) {
            const primary = dbActiveRows[0] as SupabaseSubscriberSessionLog;
            const dbConnectedMs =
              new Date(primary.connected_at || primary.recorded_at || nowIso).getTime() || nowMs;
            const dbUptimeSec = Number(
              primary.uptime_seconds ?? parseRouterOsUptimeSeconds(primary.uptime_duration)
            );
            const dbSessionId = String(primary.session_id || '').trim();
            const dbHasRealId = Boolean(dbSessionId && !dbSessionId.includes('|'));
            const dbMac = (primary.mac_address || '').trim().toUpperCase();

            const bothHaveRealIds = dbHasRealId && identity.hasRealId;
            const matchesOngoing = bothHaveRealIds
              ? dbSessionId === identity.sessionId && uptimeSeconds >= dbUptimeSec - 15
              : uptimeSeconds >= dbUptimeSec - 15 &&
                (!dbMac || !identity.macNormalized || dbMac === identity.macNormalized) &&
                Math.abs(dbConnectedMs - identity.connectedAtMs) <= 120_000;

            if (matchesOngoing && primary.id) {
              existingLogId = primary.id;
              this.activeLogIds.set(key, primary.id);
              const normalizedConnectedMs =
                uptimeSeconds > 0 && Math.abs(dbConnectedMs - identity.connectedAtMs) > 120_000
                  ? identity.connectedAtMs
                  : dbConnectedMs;
              const normalizedConnectedIso = new Date(normalizedConnectedMs).toISOString();

              prev = {
                username: primary.subscriber_username || uname,
                sessionId: identity.hasRealId ? identity.sessionId : dbSessionId || identity.sessionId,
                hasRealId: identity.hasRealId || dbHasRealId,
                ipAddress: primary.ip_address || ipAddress,
                macAddress: dbMac || identity.macNormalized,
                uptime: formatDurationHms(dbUptimeSec),
                uptimeSeconds: dbUptimeSec,
                bytesIn: Number(primary.bytes_in || 0),
                bytesOut: Number(primary.bytes_out || 0),
                connectedAtIso: normalizedConnectedIso,
                connectedAtMs: normalizedConnectedMs,
                startMinute: Math.round(normalizedConnectedMs / 60_000),
                lastSeenMs: primary.recorded_at ? new Date(primary.recorded_at).getTime() : nowMs,
              };
              this.prevActiveSessions.set(key, prev);

              // Close any older extra duplicate ACTIVE rows for this user with exact (Logoff - Login)
              for (const extra of dbActiveRows.slice(1) as SupabaseSubscriberSessionLog[]) {
                if (!extra?.id) continue;
                const extraConnectedMs =
                  new Date(extra.connected_at || extra.recorded_at || nowIso).getTime() || nowMs;
                const exactSec = Math.max(1, Math.floor((nowMs - extraConnectedMs) / 1000));
                await supabase
                  .from('subscriber_session_logs')
                  .update({
                    session_status: 'DISCONNECTED',
                    disconnect_reason: 'Link-Down',
                    disconnected_at: nowIso,
                    recorded_at: nowIso,
                    uptime_seconds: exactSec,
                    uptime_duration: formatDurationHms(exactSec),
                  })
                  .eq('id', extra.id);
              }
            } else {
              // Stale ACTIVE rows from an earlier disconnected session: close them cleanly with (Logoff - Login)
              const reason = await getDisconnectReason(uname);
              for (const stale of dbActiveRows as SupabaseSubscriberSessionLog[]) {
                if (!stale?.id) continue;
                const staleConnectedMs =
                  new Date(stale.connected_at || stale.recorded_at || nowIso).getTime() || nowMs;
                const exactSec = Math.max(1, Math.floor((nowMs - staleConnectedMs) / 1000));
                await supabase
                  .from('subscriber_session_logs')
                  .update({
                    session_status: 'DISCONNECTED',
                    disconnect_reason: reason,
                    disconnected_at: nowIso,
                    recorded_at: nowIso,
                    uptime_seconds: exactSec,
                    uptime_duration: formatDurationHms(exactSec),
                  })
                  .eq('id', stale.id);
              }
              this.prevActiveSessions.delete(key);
              this.activeLogIds.delete(key);
              this.lastPersistedAt.delete(key);
              prev = undefined;
              existingLogId = undefined;
            }
          }
        }

        // Suppress stale router echo for 4s immediately after a manual NOC kick
        const recentKickTs = this.kickedRecently.get(key);
        if (recentKickTs && nowMs - recentKickTs < 4000 && prev?.sessionId === identity.sessionId) {
          continue;
        }

        // Strict Continuity vs Reconnect Detection (Rule A vs Rule B/C)
        let sessionIdChanged = false;
        if (prev) {
          if (prev.hasRealId && identity.hasRealId) {
            sessionIdChanged = identity.sessionId !== prev.sessionId;
          } else if (!prev.hasRealId && !identity.hasRealId) {
            const macChanged = Boolean(
              prev.macAddress &&
                identity.macNormalized &&
                prev.macAddress !== 'NO-MAC' &&
                identity.macNormalized !== 'NO-MAC' &&
                prev.macAddress !== identity.macNormalized
            );
            const startShiftedSignificantly =
              Math.abs(identity.startMinute - prev.startMinute) > 2;
            sessionIdChanged = macChanged || startShiftedSignificantly;
          }
        }

        const uptimeDropped = Boolean(
          prev && prev.uptimeSeconds > 30 && uptimeSeconds < prev.uptimeSeconds - 30
        );

        const isReconnect = Boolean(prev && (sessionIdChanged || uptimeDropped));
        const isBrandNewSession = !prev || isReconnect;

        const sessionConnectedAtMs = isBrandNewSession
          ? identity.connectedAtMs
          : prev!.connectedAtMs;

        const interfacesAreSafeForSession = (() => {
          if (options?.interfacesFresh === false && isBrandNewSession) {
            return false;
          }
          if (options?.interfacesPolledAtMs !== undefined) {
            return options.interfacesPolledAtMs >= sessionConnectedAtMs - 2000;
          }
          return options?.interfacesFresh !== false;
        })();

        const resolvedBytes = interfacesAreSafeForSession
          ? resolveSessionInterfaceBytes(sess, interfaces)
          : {
              bytesIn: Math.max(0, Number(sess.rawBytesIn || 0)),
              bytesOut: Math.max(0, Number(sess.rawBytesOut || 0)),
            };

        if (isReconnect && prev) {
          // Rule B: True reconnect detected -> Close prior ACTIVE session cleanly as DISCONNECTED
          // Recalculating Uptime strictly as (Logoff - Login) in HH:MM:SS.
          const prevConnectedMs = prev.connectedAtMs || nowMs - (prev.uptimeSeconds || 0) * 1000;
          const exactSeconds = Math.max(1, Math.floor((nowMs - prevConnectedMs) / 1000));
          const exactDuration = formatDurationHms(exactSeconds);
          const reason = await getDisconnectReason(prev.username || uname);

          const disconnectUpdate = {
            uptime_duration: exactDuration,
            uptime_seconds: exactSeconds,
            bytes_in: prev.bytesIn,
            bytes_out: prev.bytesOut,
            session_status: 'DISCONNECTED' as const,
            disconnect_reason: reason,
            disconnected_at: nowIso,
            recorded_at: nowIso,
          };

          if (existingLogId) {
            await supabase
              .from('subscriber_session_logs')
              .update(disconnectUpdate)
              .eq('id', existingLogId);
          } else {
            await supabase
              .from('subscriber_session_logs')
              .update(disconnectUpdate)
              .ilike('subscriber_username', prev.username || uname)
              .eq('session_status', 'ACTIVE');
          }

          this.activeLogIds.delete(key);
          this.lastPersistedAt.delete(key);
          existingLogId = undefined;
        }

        if (isBrandNewSession) {
          // Rule C: Insert ONE fresh ACTIVE row for the new session with zero carry-over from older rows
          const freshBytesIn = resolvedBytes.bytesIn;
          const freshBytesOut = resolvedBytes.bytesOut;

          const { data: inserted, error: insertErr } = await supabase
            .from('subscriber_session_logs')
            .insert([
              {
                subscriber_username: uname,
                session_id: identity.sessionId,
                ip_address: ipAddress,
                mac_address: macAddress || null,
                uptime_duration: formattedUptime,
                uptime_seconds: uptimeSeconds,
                bytes_in: freshBytesIn,
                bytes_out: freshBytesOut,
                session_status: 'ACTIVE',
                disconnect_reason: 'ONLINE (Active)',
                connected_at: identity.connectedAtIso,
                disconnected_at: null,
                recorded_at: nowIso,
              },
            ])
            .select('id')
            .single();

          if (!insertErr && inserted?.id) {
            this.activeLogIds.set(key, inserted.id);
          }
          this.lastPersistedAt.set(key, nowMs);
          this.prevActiveSessions.set(key, {
            username: uname,
            sessionId: identity.sessionId,
            hasRealId: identity.hasRealId,
            ipAddress,
            macAddress: identity.macNormalized,
            uptime: formattedUptime,
            uptimeSeconds,
            bytesIn: freshBytesIn,
            bytesOut: freshBytesOut,
            connectedAtIso: identity.connectedAtIso,
            connectedAtMs: identity.connectedAtMs,
            startMinute: identity.startMinute,
            lastSeenMs: nowMs,
          });
          this.kickedRecently.delete(key);
        } else if (prev) {
          // Rule A: Same ongoing continuous session -> NEVER insert a new row, ONLY update the existing ACTIVE row.
          const effectiveSessionId = identity.hasRealId ? identity.sessionId : prev.sessionId;
          const effectiveHasRealId = identity.hasRealId || prev.hasRealId;
          const mergedBytesIn = Math.max(prev.bytesIn, resolvedBytes.bytesIn);
          const mergedBytesOut = Math.max(prev.bytesOut, resolvedBytes.bytesOut);
          const effectiveUptimeSeconds =
            uptimeSeconds >= prev.uptimeSeconds - 15
              ? Math.max(uptimeSeconds, prev.uptimeSeconds)
              : uptimeSeconds;
          const effectiveUptimeStr = formatDurationHms(effectiveUptimeSeconds);

          // Self-heal drifted connected_at if corrupted by a historical mismatch (> 120s off from now - uptime)
          const hasDriftedLogin =
            uptimeSeconds > 0 && Math.abs(prev.connectedAtMs - identity.connectedAtMs) > 120_000;
          const effectiveConnectedAtMs = hasDriftedLogin
            ? identity.connectedAtMs
            : prev.connectedAtMs;
          const effectiveConnectedAtIso = hasDriftedLogin
            ? identity.connectedAtIso
            : prev.connectedAtIso;

          const legacyFormatNeedsUpgrade =
            !/^\d{2,}:\d{2}:\d{2}$/.test(prev.uptime || '');

          this.prevActiveSessions.set(key, {
            username: uname,
            sessionId: effectiveSessionId,
            hasRealId: effectiveHasRealId,
            ipAddress: ipAddress || prev.ipAddress || 'Dynamic IP',
            macAddress: identity.macNormalized || prev.macAddress,
            uptime: effectiveUptimeStr,
            uptimeSeconds: effectiveUptimeSeconds,
            bytesIn: mergedBytesIn,
            bytesOut: mergedBytesOut,
            connectedAtIso: effectiveConnectedAtIso,
            connectedAtMs: effectiveConnectedAtMs,
            startMinute: Math.round(effectiveConnectedAtMs / 60_000),
            lastSeenMs: nowMs,
          });

          const lastWrite = this.lastPersistedAt.get(key) || 0;
          const shouldWriteTelemetry =
            nowMs - lastWrite >= this.TELEMETRY_INTERVAL_MS ||
            (!prev.hasRealId && identity.hasRealId) ||
            hasDriftedLogin ||
            legacyFormatNeedsUpgrade;

          if (shouldWriteTelemetry && existingLogId) {
            await supabase
              .from('subscriber_session_logs')
              .update({
                session_id: effectiveSessionId || null,
                ip_address: ipAddress || prev.ipAddress || 'Dynamic IP',
                mac_address: macAddress || null,
                uptime_duration: effectiveUptimeStr,
                uptime_seconds: effectiveUptimeSeconds,
                bytes_in: mergedBytesIn,
                bytes_out: mergedBytesOut,
                connected_at: effectiveConnectedAtIso,
                recorded_at: nowIso,
              })
              .eq('id', existingLogId);

            this.lastPersistedAt.set(key, nowMs);
          }
        }
      }

      // Rule B: Complete disappearance from /api/mikrotik/ppp/active -> Mark ACTIVE row as DISCONNECTED
      // Recalculating Uptime strictly as (Logoff - Login) in HH:MM:SS + fetching MikroTik /log reason.
      for (const [key, prev] of Array.from(this.prevActiveSessions.entries())) {
        if (currentKeys.has(key)) continue;

        const kickTs = this.kickedRecently.get(key);
        if (kickTs && nowMs - kickTs < 25_000) {
          this.prevActiveSessions.delete(key);
          this.activeLogIds.delete(key);
          this.lastPersistedAt.delete(key);
          continue;
        }

        const prevConnectedMs = prev.connectedAtMs || nowMs - (prev.uptimeSeconds || 0) * 1000;
        const exactSeconds = Math.max(1, Math.floor((nowMs - prevConnectedMs) / 1000));
        const exactDuration = formatDurationHms(exactSeconds);
        const reason = await getDisconnectReason(prev.username || key);

        const logId = this.activeLogIds.get(key);
        const updatePayload = {
          uptime_duration: exactDuration,
          uptime_seconds: exactSeconds,
          bytes_in: prev.bytesIn,
          bytes_out: prev.bytesOut,
          session_status: 'DISCONNECTED' as const,
          disconnect_reason: reason,
          disconnected_at: nowIso,
          recorded_at: nowIso,
        };

        if (logId) {
          await supabase
            .from('subscriber_session_logs')
            .update(updatePayload)
            .eq('id', logId);
        } else {
          await supabase
            .from('subscriber_session_logs')
            .update(updatePayload)
            .ilike('subscriber_username', prev.username)
            .eq('session_status', 'ACTIVE');
        }

        this.prevActiveSessions.delete(key);
        this.activeLogIds.delete(key);
        this.lastPersistedAt.delete(key);
      }

      // Sweep orphaned DB ACTIVE rows once after hydration and periodically every 60s
      if (this.lastOrphanSweepMs === 0 || nowMs - this.lastOrphanSweepMs >= this.ORPHAN_SWEEP_INTERVAL_MS) {
        this.lastOrphanSweepMs = nowMs;
        await this.closeOrphanedActiveRows(currentKeys, nowMs, getDisconnectReason);
      }
    } catch (err) {
      console.warn('[SessionSyncEngine] syncCycle error:', err);
    } finally {
      this.syncInFlight = false;
    }
  }

  /**
   * Finalize an active session row as KICKED immediately before calling /ppp/active/remove.
   */
  public async finalizeSessionKick(
    username: string,
    sessionSnapshot?: {
      id?: string;
      username?: string;
      address?: string;
      callerId?: string;
      uptime?: string;
      rawBytesIn?: number;
      rawBytesOut?: number;
    },
    interfaces: RouterInterface[] = []
  ): Promise<void> {
    const cleanUsername = (username || '').trim();
    const key = cleanUsername.toLowerCase();
    if (!key) return;

    try {
      await this.ensureHydrated();

      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      this.kickedRecently.set(key, nowMs);

      const prev = this.prevActiveSessions.get(key);
      const logId = this.activeLogIds.get(key);

      const ifaceBytes = resolveSessionInterfaceBytes(
        {
          username: cleanUsername,
          rawBytesIn: sessionSnapshot?.rawBytesIn ?? prev?.bytesIn ?? 0,
          rawBytesOut: sessionSnapshot?.rawBytesOut ?? prev?.bytesOut ?? 0,
        },
        interfaces
      );

      const finalBytesIn = Math.max(prev?.bytesIn || 0, ifaceBytes.bytesIn);
      const finalBytesOut = Math.max(prev?.bytesOut || 0, ifaceBytes.bytesOut);
      const snapshotUptimeSec = parseRouterOsUptimeSeconds(sessionSnapshot?.uptime);
      const connectedAtMs =
        prev?.connectedAtMs ||
        nowMs - (snapshotUptimeSec || prev?.uptimeSeconds || 1) * 1000;
      const connectedAtIso = prev?.connectedAtIso || new Date(connectedAtMs).toISOString();
      const finalUptimeSec = Math.max(1, Math.floor((nowMs - connectedAtMs) / 1000));
      const finalUptime = formatDurationHms(finalUptimeSec);

      const finalIp = sessionSnapshot?.address || prev?.ipAddress || 'Dynamic IP';
      const finalMac = sessionSnapshot?.callerId || prev?.macAddress || null;
      const finalSessionId = sessionSnapshot?.id || prev?.sessionId || null;

      const updateFields = {
        ip_address: finalIp,
        mac_address: finalMac,
        uptime_duration: finalUptime,
        uptime_seconds: finalUptimeSec,
        bytes_in: finalBytesIn,
        bytes_out: finalBytesOut,
        session_status: 'KICKED',
        disconnect_reason: 'Admin-Reset',
        disconnected_at: nowIso,
        recorded_at: nowIso,
      };

      let updated = false;
      if (logId) {
        const { error } = await supabase
          .from('subscriber_session_logs')
          .update(updateFields)
          .eq('id', logId);
        if (!error) updated = true;
      }

      if (!updated) {
        const { data: openRows } = await supabase
          .from('subscriber_session_logs')
          .select('id, connected_at, recorded_at')
          .ilike('subscriber_username', prev?.username || cleanUsername)
          .eq('session_status', 'ACTIVE')
          .limit(5);

        if (openRows && openRows.length > 0) {
          for (const row of openRows as Array<{ id: string; connected_at?: string; recorded_at?: string }>) {
            const rowConnectedMs =
              new Date(row.connected_at || row.recorded_at || connectedAtIso).getTime() ||
              connectedAtMs;
            const rowUptimeSec = Math.max(1, Math.floor((nowMs - rowConnectedMs) / 1000));
            await supabase
              .from('subscriber_session_logs')
              .update({
                ...updateFields,
                uptime_seconds: rowUptimeSec,
                uptime_duration: formatDurationHms(rowUptimeSec),
              })
              .eq('id', row.id);
          }
          updated = true;
        }
      }

      if (!updated) {
        await supabase.from('subscriber_session_logs').insert([
          {
            subscriber_username: prev?.username || cleanUsername,
            session_id: finalSessionId,
            ip_address: finalIp,
            mac_address: finalMac,
            uptime_duration: finalUptime,
            uptime_seconds: finalUptimeSec,
            bytes_in: finalBytesIn,
            bytes_out: finalBytesOut,
            session_status: 'KICKED',
            disconnect_reason: 'Admin-Reset',
            connected_at: connectedAtIso,
            disconnected_at: nowIso,
            recorded_at: nowIso,
          },
        ]);
      }

      this.prevActiveSessions.delete(key);
      this.activeLogIds.delete(key);
      this.lastPersistedAt.delete(key);
    } catch (err) {
      console.warn('[SessionSyncEngine] finalizeSessionKick error:', err);
    }
  }
}

export const sessionSyncEngine = new SessionSyncEngine();
