import { ActiveSession, RouterInterface } from '../types/isp';
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

export interface SyncCycleOptions {
  routerId?: string;
  sessionsPolledOk?: boolean;
  interfacesFresh?: boolean;
  interfacesPolledAtMs?: number;
  nowMs?: number;
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
 * Strictly tracks each PPPoE session independently without duplicate splits
 * or cumulative byte carry-over across sessions.
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
  private readonly TELEMETRY_INTERVAL_MS = 30_000;

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

        const nowIso = new Date().toISOString();
        const duplicateIdsToClose: string[] = [];

        for (const row of data as SupabaseSubscriberSessionLog[]) {
          const uname = (row.subscriber_username || '').trim();
          const key = uname.toLowerCase();
          if (!key || !row.id) continue;

          if (this.activeLogIds.has(key)) {
            duplicateIdsToClose.push(row.id);
            continue;
          }

          this.activeLogIds.set(key, row.id);
          const recordedMs = row.recorded_at ? new Date(row.recorded_at).getTime() : Date.now();
          const connectedAtIso = row.connected_at || row.recorded_at || nowIso;
          const connectedAtMs = new Date(connectedAtIso).getTime() || Date.now();
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
            uptime: row.uptime_duration || '0s',
            uptimeSeconds,
            bytesIn: Number(row.bytes_in || 0),
            bytesOut: Number(row.bytes_out || 0),
            connectedAtIso,
            connectedAtMs,
            startMinute: Math.round(connectedAtMs / 60_000),
            lastSeenMs: recordedMs || Date.now(),
          });
        }

        if (duplicateIdsToClose.length > 0) {
          await supabase
            .from('subscriber_session_logs')
            .update({
              session_status: 'DISCONNECTED',
              disconnect_reason: 'Closed stale duplicate active record',
              disconnected_at: nowIso,
              recorded_at: nowIso,
            })
            .in('id', duplicateIdsToClose);
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

      // Deduplicate activeSessions by lowercase username (keep the newest / highest-uptime or last entry)
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
            const dbConnectedMs = new Date(
              primary.connected_at || primary.recorded_at || nowIso
            ).getTime();
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
              prev = {
                username: primary.subscriber_username || uname,
                sessionId: identity.hasRealId ? identity.sessionId : dbSessionId || identity.sessionId,
                hasRealId: identity.hasRealId || dbHasRealId,
                ipAddress: primary.ip_address || ipAddress,
                macAddress: dbMac || identity.macNormalized,
                uptime: primary.uptime_duration || uptimeStr,
                uptimeSeconds: dbUptimeSec,
                bytesIn: Number(primary.bytes_in || 0),
                bytesOut: Number(primary.bytes_out || 0),
                connectedAtIso: primary.connected_at || primary.recorded_at || identity.connectedAtIso,
                connectedAtMs: dbConnectedMs,
                startMinute: Math.round(dbConnectedMs / 60_000),
                lastSeenMs: primary.recorded_at ? new Date(primary.recorded_at).getTime() : nowMs,
              };
              this.prevActiveSessions.set(key, prev);

              // Close any older extra duplicate ACTIVE rows for this user
              const extras = dbActiveRows.slice(1).map((r: any) => r.id).filter(Boolean);
              if (extras.length > 0) {
                await supabase
                  .from('subscriber_session_logs')
                  .update({
                    session_status: 'DISCONNECTED',
                    disconnect_reason: 'Closed duplicate active row',
                    disconnected_at: nowIso,
                    recorded_at: nowIso,
                  })
                  .in('id', extras);
              }
            } else {
              // Stale ACTIVE rows from an earlier disconnected session: close them cleanly before Rule C inserts new session
              const staleIds = dbActiveRows.map((r: any) => r.id).filter(Boolean);
              if (staleIds.length > 0) {
                await supabase
                  .from('subscriber_session_logs')
                  .update({
                    session_status: 'DISCONNECTED',
                    disconnect_reason: 'Session Reconnected (New PPPoE Session Started)',
                    disconnected_at: nowIso,
                    recorded_at: nowIso,
                  })
                  .in('id', staleIds);
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

        // Guard against stale <pppoe-user> interface byte carry-over:
        // Only trust cached `interfaces` when they were polled AFTER this session connected
        // (or when caller did not provide interfacesPolledAtMs and interfacesFresh !== false).
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
          // with its frozen final uptime and final bytes (no carry-over into new session).
          const disconnectUpdate = {
            uptime_duration: prev.uptime || 'Ended',
            uptime_seconds: prev.uptimeSeconds,
            bytes_in: prev.bytesIn,
            bytes_out: prev.bytesOut,
            session_status: 'DISCONNECTED' as const,
            disconnect_reason: 'Session Reconnected (New PPPoE Session Started)',
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
                uptime_duration: uptimeStr,
                uptime_seconds: uptimeSeconds,
                bytes_in: freshBytesIn,
                bytes_out: freshBytesOut,
                session_status: 'ACTIVE',
                disconnect_reason: 'PPPoE Session Connected',
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
            uptime: uptimeStr,
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
          const effectiveUptimeStr =
            uptimeSeconds >= prev.uptimeSeconds - 15 && uptimeSeconds < prev.uptimeSeconds
              ? prev.uptime
              : uptimeStr;

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
            connectedAtIso: prev.connectedAtIso,
            connectedAtMs: prev.connectedAtMs,
            startMinute: prev.startMinute,
            lastSeenMs: nowMs,
          });

          const lastWrite = this.lastPersistedAt.get(key) || 0;
          const shouldWriteTelemetry =
            nowMs - lastWrite >= this.TELEMETRY_INTERVAL_MS ||
            (!prev.hasRealId && identity.hasRealId);

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
                recorded_at: nowIso,
              })
              .eq('id', existingLogId);

            this.lastPersistedAt.set(key, nowMs);
          }
        }
      }

      // Rule B: Complete disappearance from /api/mikrotik/ppp/active -> Mark ACTIVE row as DISCONNECTED
      for (const [key, prev] of Array.from(this.prevActiveSessions.entries())) {
        if (currentKeys.has(key)) continue;

        const kickTs = this.kickedRecently.get(key);
        if (kickTs && nowMs - kickTs < 25_000) {
          // Already finalized as KICKED by finalizeSessionKick
          this.prevActiveSessions.delete(key);
          this.activeLogIds.delete(key);
          this.lastPersistedAt.delete(key);
          continue;
        }

        const logId = this.activeLogIds.get(key);
        const updatePayload = {
          uptime_duration: prev.uptime || 'Ended',
          uptime_seconds: prev.uptimeSeconds,
          bytes_in: prev.bytesIn,
          bytes_out: prev.bytesOut,
          session_status: 'DISCONNECTED' as const,
          disconnect_reason: 'Client Disconnected / Link Down',
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
      const finalUptime = sessionSnapshot?.uptime || prev?.uptime || 'Active Session';
      const finalUptimeSec = parseRouterOsUptimeSeconds(finalUptime) || prev?.uptimeSeconds || 0;
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
        disconnect_reason: 'Disconnected by Admin / NOC',
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
          .select('id')
          .ilike('subscriber_username', prev?.username || cleanUsername)
          .eq('session_status', 'ACTIVE')
          .limit(5);

        if (openRows && openRows.length > 0) {
          await supabase
            .from('subscriber_session_logs')
            .update(updateFields)
            .in(
              'id',
              openRows.map((r: any) => r.id)
            );
          updated = true;
        }
      }

      if (!updated) {
        const connectedAtIso =
          prev?.connectedAtIso || new Date(nowMs - finalUptimeSec * 1000).toISOString();
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
            disconnect_reason: 'Disconnected by Admin / NOC',
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
