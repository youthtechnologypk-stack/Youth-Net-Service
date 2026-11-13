import { ActiveSession, RouterInterface } from '../types/isp';
import { supabase, SupabaseSubscriberSessionLog } from './supabaseClient';

export interface TrackedSessionSnapshot {
  username: string;
  sessionId: string;
  ipAddress: string;
  macAddress: string;
  uptime: string;
  uptimeSeconds: number;
  bytesIn: number;
  bytesOut: number;
  connectedAtIso: string;
  lastSeenMs: number;
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
 * Live Session Diff & Supabase Persistence Engine
 * Tracks active PPPoE sessions in memory and persists Connects, 60s Telemetry
 * Checkpoints, Reconnects, Disconnects, and Manual Kicks into `subscriber_session_logs`.
 */
class SessionSyncEngine {
  private prevActiveSessions = new Map<string, TrackedSessionSnapshot>();
  private activeLogIds = new Map<string, string>();
  private lastPersistedAt = new Map<string, number>();
  private kickedRecently = new Map<string, number>();
  private hydrated = false;
  private hydrationPromise: Promise<void> | null = null;
  private syncInFlight = false;
  private readonly TELEMETRY_INTERVAL_MS = 60_000;

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
          const recordedMs = row.recorded_at ? new Date(row.recorded_at).getTime() : 0;
          if (recordedMs > 0) {
            this.lastPersistedAt.set(key, recordedMs);
          }

          this.prevActiveSessions.set(key, {
            username: uname,
            sessionId: row.session_id || '',
            ipAddress: row.ip_address || '',
            macAddress: row.mac_address || '',
            uptime: row.uptime_duration || '0s',
            uptimeSeconds: Number(row.uptime_seconds ?? parseRouterOsUptimeSeconds(row.uptime_duration)),
            bytesIn: Number(row.bytes_in || 0),
            bytesOut: Number(row.bytes_out || 0),
            connectedAtIso: row.connected_at || row.recorded_at || nowIso,
            lastSeenMs: recordedMs || Date.now(),
          });
        }

        if (duplicateIdsToClose.length > 0) {
          await supabase
            .from('subscriber_session_logs')
            .update({
              session_status: 'DISCONNECTED',
              disconnect_reason: 'Closed stale duplicate session record',
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
    interfaces: RouterInterface[] = []
  ): Promise<void> {
    if (this.syncInFlight) return;
    this.syncInFlight = true;

    try {
      await this.ensureHydrated();

      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      const currentKeys = new Set<string>();

      // Expire old manual-kick suppression entries (> 25s)
      for (const [k, ts] of this.kickedRecently.entries()) {
        if (nowMs - ts > 25_000) {
          this.kickedRecently.delete(k);
        }
      }

      for (const sess of activeSessions) {
        const uname = (sess.username || '').trim();
        const key = uname.toLowerCase();
        if (!key) continue;

        currentKeys.add(key);

        const sessionId = String((sess as any)['.id'] || sess.id || '').trim();
        const uptimeStr = sess.uptime || '0s';
        const uptimeSeconds = parseRouterOsUptimeSeconds(uptimeStr);
        const { bytesIn, bytesOut } = resolveSessionInterfaceBytes(sess, interfaces);
        const ipAddress = sess.address || 'Dynamic IP';
        const macAddress = sess.callerId || '';

        const prev = this.prevActiveSessions.get(key);
        const existingLogId = this.activeLogIds.get(key);

        // If user was kicked within the last 2s and router briefly still returned the stale session, ignore re-insert
        const recentKickTs = this.kickedRecently.get(key);
        if (recentKickTs && nowMs - recentKickTs < 4000 && prev?.sessionId === sessionId) {
          continue;
        }

        const sessionIdChanged = Boolean(
          prev && sessionId && prev.sessionId && sessionId !== prev.sessionId
        );
        const uptimeDropped = Boolean(
          prev && prev.uptimeSeconds > 15 && uptimeSeconds + 10 < prev.uptimeSeconds
        );

        const isReconnect = Boolean(prev && (sessionIdChanged || uptimeDropped));
        const isNewSession = !prev && !existingLogId;

        if (isReconnect) {
          // Finalize prior ACTIVE row as RECONNECTED before opening the new session row
          const finalUptime = prev?.uptime || uptimeStr;
          const finalUptimeSec = prev?.uptimeSeconds ?? uptimeSeconds;
          const finalBytesIn = prev?.bytesIn ?? 0;
          const finalBytesOut = prev?.bytesOut ?? 0;

          if (existingLogId) {
            await supabase
              .from('subscriber_session_logs')
              .update({
                uptime_duration: finalUptime,
                uptime_seconds: finalUptimeSec,
                bytes_in: finalBytesIn,
                bytes_out: finalBytesOut,
                session_status: 'RECONNECTED',
                disconnect_reason: 'Session Dropped & Reconnected',
                disconnected_at: nowIso,
                recorded_at: nowIso,
              })
              .eq('id', existingLogId);
          } else {
            await supabase
              .from('subscriber_session_logs')
              .update({
                session_status: 'RECONNECTED',
                disconnect_reason: 'Session Dropped & Reconnected',
                disconnected_at: nowIso,
                recorded_at: nowIso,
              })
              .eq('subscriber_username', prev?.username || uname)
              .eq('session_status', 'ACTIVE');
          }

          this.activeLogIds.delete(key);
          this.lastPersistedAt.delete(key);
        }

        if (isNewSession || isReconnect) {
          const connectedAtIso = new Date(nowMs - uptimeSeconds * 1000).toISOString();
          const { data: inserted, error: insertErr } = await supabase
            .from('subscriber_session_logs')
            .insert([
              {
                subscriber_username: uname,
                session_id: sessionId || null,
                ip_address: ipAddress,
                mac_address: macAddress || null,
                uptime_duration: uptimeStr,
                uptime_seconds: uptimeSeconds,
                bytes_in: bytesIn,
                bytes_out: bytesOut,
                session_status: 'ACTIVE',
                disconnect_reason: 'PPPoE Session Connected',
                connected_at: connectedAtIso,
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
            sessionId,
            ipAddress,
            macAddress,
            uptime: uptimeStr,
            uptimeSeconds,
            bytesIn,
            bytesOut,
            connectedAtIso,
            lastSeenMs: nowMs,
          });
          this.kickedRecently.delete(key);
        } else {
          // Ongoing active session: preserve monotonic byte maxima & update DB every 60s
          const mergedBytesIn = Math.max(prev?.bytesIn || 0, bytesIn);
          const mergedBytesOut = Math.max(prev?.bytesOut || 0, bytesOut);
          const connectedAtIso =
            prev?.connectedAtIso || new Date(nowMs - uptimeSeconds * 1000).toISOString();

          this.prevActiveSessions.set(key, {
            username: uname,
            sessionId: sessionId || prev?.sessionId || '',
            ipAddress: ipAddress || prev?.ipAddress || 'Dynamic IP',
            macAddress: macAddress || prev?.macAddress || '',
            uptime: uptimeStr,
            uptimeSeconds,
            bytesIn: mergedBytesIn,
            bytesOut: mergedBytesOut,
            connectedAtIso,
            lastSeenMs: nowMs,
          });

          const lastWrite = this.lastPersistedAt.get(key) || 0;
          if (nowMs - lastWrite >= this.TELEMETRY_INTERVAL_MS) {
            if (existingLogId) {
              await supabase
                .from('subscriber_session_logs')
                .update({
                  session_id: sessionId || prev?.sessionId || null,
                  ip_address: ipAddress || prev?.ipAddress || 'Dynamic IP',
                  mac_address: macAddress || prev?.macAddress || null,
                  uptime_duration: uptimeStr,
                  uptime_seconds: uptimeSeconds,
                  bytes_in: mergedBytesIn,
                  bytes_out: mergedBytesOut,
                  recorded_at: nowIso,
                })
                .eq('id', existingLogId);
            }
            this.lastPersistedAt.set(key, nowMs);
          }
        }
      }

      // Disconnected / Went Offline sweep
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
          session_status: 'DISCONNECTED',
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
            .eq('subscriber_username', prev.username)
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
          .eq('subscriber_username', prev?.username || cleanUsername)
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
