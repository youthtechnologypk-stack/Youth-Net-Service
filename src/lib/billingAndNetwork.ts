import { supabase, SupabaseInvoice } from '../services/supabaseClient';
import { safeMikrotikFetch } from '../services/mikrotikRestClient';
import { RouterAuthInfo, getActiveRouterAuth, resolveRestHostAndPort } from '../services/apiClient';
import { addCalendarMonthsYmd, computeBillingAnchorDay, extractYmdString } from './anniversaryBilling';

export const PARENT_FLEET_ROUTER = 'SADDAR FLEET ROUTER';

export interface NetworkAreaNode {
  id?: string;
  parent_router: string;
  area_name: string;
  prefix_code: string;
  created_at?: string;
}

export const DEFAULT_NETWORK_AREAS: NetworkAreaNode[] = [
  { parent_router: PARENT_FLEET_ROUTER, area_name: 'Baza Mohallah', prefix_code: 'bz' },
  { parent_router: PARENT_FLEET_ROUTER, area_name: 'Digi Mohallah', prefix_code: 'dgi' },
  { parent_router: PARENT_FLEET_ROUTER, area_name: 'Hatha Al Faisal', prefix_code: 'hf' },
  { parent_router: PARENT_FLEET_ROUTER, area_name: 'Hatha Al Farooq', prefix_code: 'fh' },
  { parent_router: PARENT_FLEET_ROUTER, area_name: 'Lalkurti Basti', prefix_code: 'lal' },
  { parent_router: PARENT_FLEET_ROUTER, area_name: 'Bangali Mohallah', prefix_code: 'bm' },
  { parent_router: PARENT_FLEET_ROUTER, area_name: 'Dhaka Road', prefix_code: 'dh' },
  { parent_router: PARENT_FLEET_ROUTER, area_name: 'Tall', prefix_code: 'tl' },
  { parent_router: PARENT_FLEET_ROUTER, area_name: 'Bakar Mohallah', prefix_code: 'bk' },
  { parent_router: PARENT_FLEET_ROUTER, area_name: 'Lahore Road', prefix_code: 'lhr' },
  { parent_router: PARENT_FLEET_ROUTER, area_name: 'Mochi Bazar', prefix_code: 'mb' },
  { parent_router: PARENT_FLEET_ROUTER, area_name: 'Qazi Mohallah', prefix_code: 'qz' },
  { parent_router: PARENT_FLEET_ROUTER, area_name: 'New Officer Colony', prefix_code: 'noc' },
  { parent_router: PARENT_FLEET_ROUTER, area_name: 'Biri Gali', prefix_code: 'gb' },
  { parent_router: PARENT_FLEET_ROUTER, area_name: 'Delhi Road', prefix_code: 'dl' },
  { parent_router: PARENT_FLEET_ROUTER, area_name: 'Sagar Road', prefix_code: 'sgr' },
  { parent_router: PARENT_FLEET_ROUTER, area_name: 'Sarwar Road', prefix_code: 'sw' },
  { parent_router: PARENT_FLEET_ROUTER, area_name: 'Hata Al Hussain', prefix_code: 'hh' },
  { parent_router: PARENT_FLEET_ROUTER, area_name: 'Shuttar Mohallah', prefix_code: 'st' },
];

export const PREFIX_TO_AREA_MAP: Record<string, string> = {
  bz: 'Baza Mohallah',
  dgi: 'Digi Mohallah',
  gb: 'Biri Gali',
  tl: 'Tall',
  bm: 'Bangali Mohallah',
  lhr: 'Lahore Road',
  dl: 'Delhi Road',
  sgr: 'Sagar Road',
  sw: 'Sarwar Road',
  st: 'Shuttar Mohallah',
  fh: 'Hatha Al Farooq',
  lal: 'Lalkurti Basti',
  hh: 'Hata Al Hussain',
  dh: 'Dhaka Road',
  hf: 'Hatha Al Faisal',
  bk: 'Bakar Mohallah',
  mb: 'Mochi Bazar',
  qz: 'Qazi Mohallah',
  noc: 'New Officer Colony',
};

/**
 * Automatically resolves matching area name from PPPoE username starting prefix
 */
export function resolveAreaFromUsername(
  username: string,
  areasList: NetworkAreaNode[] = DEFAULT_NETWORK_AREAS
): string | null {
  const clean = (username || '').trim().toLowerCase();
  if (!clean) return null;

  // Sort prefixes longest-first so 'dgi' matches before 'd', 'sgr' before 's', etc.
  const combined: Array<{ prefix: string; area: string }> = [
    ...areasList
      .filter((a) => a.prefix_code && a.area_name)
      .map((a) => ({ prefix: a.prefix_code.toLowerCase(), area: a.area_name })),
    ...Object.entries(PREFIX_TO_AREA_MAP).map(([prefix, area]) => ({ prefix, area })),
  ];

  combined.sort((a, b) => b.prefix.length - a.prefix.length);

  for (const item of combined) {
    if (clean.startsWith(item.prefix)) {
      return item.area;
    }
  }

  return null;
}

export const NETWORK_AREAS_UPDATED_EVENT = 'youthnet_network_areas_updated';

export function emitNetworkAreasUpdated(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(NETWORK_AREAS_UPDATED_EVENT));
  }
}

/**
 * Fetches child areas from Supabase `network_areas` under `SADDAR FLEET ROUTER`,
 * ordered by area_name ASC, falling back to default nodes if table is empty.
 */
export async function fetchNetworkAreas(): Promise<NetworkAreaNode[]> {
  try {
    const { data, error } = await supabase
      .from('network_areas')
      .select('*')
      .order('area_name', { ascending: true });

    if (!error && Array.isArray(data) && data.length > 0) {
      return data as NetworkAreaNode[];
    }
  } catch (err) {
    console.warn('Could not load network_areas:', err);
  }
  return DEFAULT_NETWORK_AREAS;
}

/**
 * Inserts a new child area node into Supabase `network_areas` under SADDAR FLEET ROUTER
 */
export async function createChildNetworkArea(
  areaName: string,
  prefixCode?: string,
  parentRouter: string = PARENT_FLEET_ROUTER
): Promise<{ success: boolean; data?: NetworkAreaNode; error?: string }> {
  const cleanName = areaName.trim();
  if (!cleanName) {
    return { success: false, error: 'Area name cannot be empty.' };
  }
  const cleanParent = (parentRouter || PARENT_FLEET_ROUTER).trim() || PARENT_FLEET_ROUTER;
  const cleanPrefix = (prefixCode || '').trim().toLowerCase();

  try {
    const { data, error } = await supabase
      .from('network_areas')
      .insert([
        {
          parent_router: cleanParent,
          area_name: cleanName,
          prefix_code: cleanPrefix,
        },
      ])
      .select()
      .single();

    if (error) {
      return { success: false, error: error.message };
    }
    emitNetworkAreasUpdated();
    return { success: true, data: data as NetworkAreaNode };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to insert area.' };
  }
}

/**
 * Updates an existing network area by id and cascades renamed area_name onto portal_users.
 */
export async function updateNetworkArea(
  id: string,
  oldAreaName: string,
  updates: {
    parent_router?: string;
    area_name: string;
    prefix_code?: string;
  }
): Promise<{ success: boolean; data?: NetworkAreaNode; error?: string }> {
  const cleanNewName = updates.area_name.trim();
  if (!cleanNewName) {
    return { success: false, error: 'Area / Mohallah name is required.' };
  }
  const cleanParent = (updates.parent_router || PARENT_FLEET_ROUTER).trim() || PARENT_FLEET_ROUTER;
  const cleanPrefix = (updates.prefix_code || '').trim().toLowerCase();

  try {
    const { data, error } = await supabase
      .from('network_areas')
      .update({
        parent_router: cleanParent,
        area_name: cleanNewName,
        prefix_code: cleanPrefix,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    if (oldAreaName && oldAreaName.trim() !== cleanNewName) {
      await supabase
        .from('portal_users')
        .update({ area: cleanNewName })
        .eq('area', oldAreaName.trim());
    }

    emitNetworkAreasUpdated();
    return { success: true, data: data as NetworkAreaNode };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to update area.' };
  }
}

/**
 * Updates a subscriber's PPPoE secret profile (and optionally disabled flag) on MikroTik RouterOS v7
 * via /api/mikrotik/ppp/secret/{id} (with /ppp/secret/set fallback).
 */
export async function syncMikrotikSecretProfile(
  subscriberUsername: string,
  targetProfile: string,
  options?: { disabled?: 'true' | 'false' },
  activeRouter?: RouterAuthInfo
): Promise<{ ok: boolean; previousProfile?: string | null; secretId?: string | null }> {
  const cleanUser = (subscriberUsername || '').trim();
  if (!cleanUser || !targetProfile) return { ok: false };

  try {
    let secretId: string | null = null;
    let previousProfile: string | null = null;

    try {
      const res = await safeMikrotikFetch(
        `/api/mikrotik/ppp/secret?name=${encodeURIComponent(cleanUser)}`,
        {},
        activeRouter
      );
      if (res.ok) {
        const list = await res.json();
        if (Array.isArray(list)) {
          const match = list.find(
            (s: any) => (s?.name || '').toLowerCase() === cleanUser.toLowerCase()
          );
          if (match) {
            secretId = match['.id'] || match.id || null;
            previousProfile = match.profile || null;
          }
        }
      }
    } catch {}

    const patchFields: Record<string, any> = {
      profile: targetProfile,
    };
    if (options?.disabled !== undefined) {
      patchFields.disabled = options.disabled;
    }

    if (secretId) {
      const patchRes = await safeMikrotikFetch(
        `/api/mikrotik/ppp/secret/${encodeURIComponent(secretId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patchFields),
        },
        activeRouter
      );
      if (patchRes.ok) {
        return { ok: true, previousProfile, secretId };
      }
    }

    const setPayload: Record<string, any> = {
      ...patchFields,
      ...(secretId ? { '.id': secretId, numbers: secretId } : { name: cleanUser, numbers: cleanUser }),
    };

    const setRes = await safeMikrotikFetch(
      '/api/mikrotik/ppp/secret/set',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(setPayload),
      },
      activeRouter
    );

    return { ok: setRes.ok, previousProfile, secretId };
  } catch {
    return { ok: false };
  }
}

/**
 * Kicks any active PPPoE session for a subscriber (e.g. trapped on 16.16.16.x)
 * so their CPE immediately redials within ~5 seconds on the restored profile.
 */
export async function kickMikrotikActiveSessionForUser(
  subscriberUsername: string,
  activeRouter?: RouterAuthInfo
): Promise<number> {
  const cleanUser = (subscriberUsername || '').trim().toLowerCase();
  if (!cleanUser) return 0;

  let kicked = 0;
  try {
    const activeRes = await safeMikrotikFetch('/api/mikrotik/ppp/active', {}, activeRouter);
    if (!activeRes.ok) return 0;
    const list = await activeRes.json();
    if (!Array.isArray(list)) return 0;

    const matching = list.filter(
      (s: any) => String(s?.name || '').trim().toLowerCase() === cleanUser
    );

    for (const sess of matching) {
      const activeId = String(sess?.['.id'] || sess?.id || '').trim();
      if (!activeId) continue;

      const delRes = await safeMikrotikFetch(
        `/api/mikrotik/ppp/active/${encodeURIComponent(activeId)}`,
        { method: 'DELETE' },
        activeRouter
      );
      if (delRes.ok) {
        kicked++;
      } else {
        const remRes = await safeMikrotikFetch(
          '/api/mikrotik/ppp/active/remove',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ '.id': activeId, numbers: activeId }),
          },
          activeRouter
        );
        if (remRes.ok) kicked++;
      }
    }
  } catch {}
  return kicked;
}

/**
 * Instant 5-Second Restore Hook (DB + MikroTik Atomic Sync):
 * 1. Updates Supabase first: +1 calendar month expiry_date/next_billing_date anchored to installation day, billing_status='ACTIVE', grace_ends_at=null, last_restored_at=now
 * 2. Restores MikroTik /rest/ppp/secret/{id} to original_package_profile (disabled: 'false')
 * 3. Kicks any 16.16.16.x / stale active PPPoE session for instant reconnect
 * 4. Inserts 'RESTORED_ON_PAYMENT' into expiry_audit_logs
 */
export async function restoreSubscriberOnInvoicePaid(
  subscriberUsername: string,
  options?: {
    triggeredBy?: 'ADMIN' | 'AGENT_PAYMENT_SYNC' | 'CRON_2PM';
    notes?: string;
    expiryProfileName?: string;
  }
): Promise<{
  success: boolean;
  restoredProfile: string;
  kickedSessions: number;
  newExpiryIso: string;
}> {
  const cleanUser = (subscriberUsername || '').trim().toLowerCase();
  const nowIso = new Date().toISOString();
  const triggeredBy = options?.triggeredBy || 'AGENT_PAYMENT_SYNC';

  if (!cleanUser) {
    const fallbackExpiryIso = `${addCalendarMonthDateString(new Date())}T14:00:00+05:00`;
    return { success: false, restoredProfile: '20Mbps', kickedSessions: 0, newExpiryIso: fallbackExpiryIso };
  }

  let restoredProfile = '20Mbps';
  let previousProfile: string | null = null;
  let subscriberId: string | null = null;
  let anchorDay = new Date().getDate();
  let nextAnniversaryYmd = addCalendarMonthDateString(new Date(), anchorDay);

  try {
    // 1. Read current subscriber profile backups from Supabase portal_users
    const { data: userRecord } = await supabase
      .from('portal_users')
      .select('*')
      .ilike('username', cleanUser)
      .limit(1)
      .maybeSingle();

    subscriberId = userRecord?.id || null;
    if (userRecord) {
      anchorDay = computeBillingAnchorDay(userRecord);
      const baseAnchor =
        extractYmdString((userRecord as any).next_billing_date) ||
        extractYmdString(userRecord.expiry_date) ||
        extractYmdString(new Date().toISOString())!;
      const todayYmd = extractYmdString(new Date().toISOString())!;
      // Advance +1 calendar month from current cycle/today anchored to installation day
      let candidateNext = addCalendarMonthsYmd(baseAnchor, 1, anchorDay);
      if (candidateNext <= todayYmd) {
        candidateNext = addCalendarMonthsYmd(todayYmd, 1, anchorDay);
      }
      nextAnniversaryYmd = candidateNext;
    }
    const finalExpiryIso = `${nextAnniversaryYmd}T14:00:00+05:00`;

    const rawOriginal = String((userRecord as any)?.original_package_profile || '').trim();
    const rawProfileName = String(userRecord?.package_profile_name || '').trim();
    const rawPkgSpeed = String(userRecord?.package_speed || '').trim().replace(/\s+/g, '');
    const expiryProfLower = String(options?.expiryProfileName || '').trim().toLowerCase();

    const isExpiryPlaceholder = (val: string) => {
      const low = val.toLowerCase();
      return !low || low === 'expired' || low.includes('walled') || (expiryProfLower && low === expiryProfLower);
    };

    if (!isExpiryPlaceholder(rawOriginal)) {
      restoredProfile = rawOriginal;
    } else if (!isExpiryPlaceholder(rawProfileName)) {
      restoredProfile = rawProfileName;
    } else if (rawPkgSpeed) {
      restoredProfile = rawPkgSpeed;
    }

    // 2. Update Supabase first (+1 calendar month anniversary expiry, ACTIVE status, clear grace)
    if (userRecord?.id) {
      const fullUpdate = {
        account_status: 'ACTIVE',
        billing_status: 'ACTIVE',
        is_suspended: false,
        grace_until: null,
        grace_ends_at: null,
        last_restored_at: nowIso,
        expiry_date: finalExpiryIso,
        billing_anchor_day: anchorDay,
        next_billing_date: nextAnniversaryYmd,
      };
      const { error: updErr } = await supabase
        .from('portal_users')
        .update(fullUpdate as any)
        .eq('id', userRecord.id);

      if (updErr) {
        // Fallback to guaranteed existing schema columns
        const { error: midErr } = await supabase
          .from('portal_users')
          .update({
            account_status: 'ACTIVE',
            billing_status: 'ACTIVE',
            grace_ends_at: null,
            last_restored_at: nowIso,
            expiry_date: finalExpiryIso,
          })
          .eq('id', userRecord.id);

        if (midErr) {
          await supabase
            .from('portal_users')
            .update({
              account_status: 'ACTIVE',
              expiry_date: nextAnniversaryYmd,
            })
            .eq('id', userRecord.id);
        }
      }
    }

    // 3. Resolve exact active PPP profile on MikroTik if we only have package speed
    if (isExpiryPlaceholder(rawOriginal) && isExpiryPlaceholder(rawProfileName)) {
      try {
        const profRes = await safeMikrotikFetch('/api/mikrotik/ppp/profile');
        if (profRes.ok) {
          const profiles = await profRes.json();
          if (Array.isArray(profiles) && profiles.length > 0) {
            const speedDigits = restoredProfile.match(/\d+/)?.[0];
            const matched = profiles.find((p: any) => {
              const pName = String(p?.name || '').toLowerCase();
              if (isExpiryPlaceholder(pName) || pName.includes('expire') || pName.includes('16.16')) {
                return false;
              }
              return (
                pName === restoredProfile.toLowerCase() ||
                Boolean(speedDigits && pName.includes(speedDigits))
              );
            });
            if (matched?.name) {
              restoredProfile = matched.name;
            }
          }
        }
      } catch {}
    }

    // 4. Restore MikroTik secret back to original_package_profile & disabled='false'
    const syncRes = await syncMikrotikSecretProfile(cleanUser, restoredProfile, {
      disabled: 'false',
    });
    previousProfile =
      syncRes.previousProfile ||
      ((userRecord as any)?.billing_status === 'SUSPENDED_EXPIRED'
        ? options?.expiryProfileName || 'EXPIRED-16-POOL'
        : null);

    // 5. Kick any stale or 16.16.16.x active PPPoE session so CPE reconnects in <= 5s
    const kickedSessions = await kickMikrotikActiveSessionForUser(cleanUser);

    // 6. Write permanent audit log entry
    try {
      await supabase.from('expiry_audit_logs').insert([
        {
          subscriber_id: subscriberId,
          username: cleanUser,
          action_type: 'RESTORED_ON_PAYMENT',
          previous_profile: previousProfile,
          applied_profile: restoredProfile,
          triggered_by: triggeredBy,
          notes:
            options?.notes ||
            `Atomic payment restore: +1 calendar month expiry (${nextAnniversaryYmd}), profile=${restoredProfile}, kicked=${kickedSessions}`,
          created_at: nowIso,
        },
      ]);
    } catch {}

    return {
      success: true,
      restoredProfile,
      kickedSessions,
      newExpiryIso: nextAnniversaryYmd,
    };
  } catch (err) {
    console.warn('restoreSubscriberOnInvoicePaid notice:', err);
    return {
      success: false,
      restoredProfile,
      kickedSessions: 0,
      newExpiryIso: nextAnniversaryYmd,
    };
  }
}

/**
 * Computes +1 calendar month YYYY-MM-DD anchored to anchorDay (clamping Feb 28/29 & Apr 30).
 */
export function addCalendarMonthDateString(
  baseDate: Date | string = new Date(),
  anchorDay?: number
): string {
  return addCalendarMonthsYmd(baseDate, 1, anchorDay);
}

/**
 * Legacy helper name preserved for compatibility; now computes +1 true calendar month.
 */
export function add31DaysDateString(baseDate: Date = new Date(), anchorDay?: number): string {
  return addCalendarMonthsYmd(baseDate, 1, anchorDay);
}

/**
 * Runs the backend Expiry & Grace Period Enforcement Sweep (/api/billing/run-expiry-check),
 * pushing any unpaid subscribers past their `grace_until` / `grace_ends_at` deadline
 * into MikroTik's `EXPIRED-16-POOL`, kicking their active session, and writing audit logs.
 */
let lastAutoExpiryCheckAt = 0;
let inflightAutoSweep: Promise<any> | null = null;

export async function triggerAutoExpirySweep(
  activeRouter?: RouterAuthInfo,
  options?: { force?: boolean; triggeredBy?: 'ADMIN' | 'CRON_2PM' }
): Promise<{
  success: boolean;
  ran: boolean;
  suspendedTo16Pool: number;
  disabledSecrets: number;
  enteredGrace: number;
  kickedActiveSessions: number;
  durationMs?: number;
  errors?: string[];
  schemaWarnings?: string[];
}> {
  const now = Date.now();
  if (!options?.force && now - lastAutoExpiryCheckAt < 60_000) {
    return {
      success: true,
      ran: false,
      suspendedTo16Pool: 0,
      disabledSecrets: 0,
      enteredGrace: 0,
      kickedActiveSessions: 0,
    };
  }
  if (inflightAutoSweep) {
    return inflightAutoSweep;
  }

  lastAutoExpiryCheckAt = now;
  const run = async () => {
    try {
      const auth = getActiveRouterAuth(activeRouter);
      const resolved = resolveRestHostAndPort(activeRouter);
      const res = await fetch('/api/billing/run-expiry-check', {
        method: 'POST',
        credentials: 'omit',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: auth.authHeader,
          'x-router-host': resolved.host,
          'x-router-ip': resolved.host,
          'x-router-port': String(resolved.port),
          'x-router-ssl': resolved.useSsl ? 'true' : 'false',
          'x-router-id': activeRouter?.id || '',
        },
        body: JSON.stringify({
          routerHost: resolved.host,
          routerPort: resolved.port,
          useSsl: resolved.useSsl,
          triggeredBy: options?.triggeredBy || 'ADMIN',
        }),
      });
      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      if (!contentType.includes('application/json')) {
        return {
          success: false,
          ran: true,
          suspendedTo16Pool: 0,
          disabledSecrets: 0,
          enteredGrace: 0,
          kickedActiveSessions: 0,
          errors: ['Backend /api/billing/run-expiry-check did not return JSON.'],
        };
      }
      const data = await res.json();
      return {
        ...data,
        success: Boolean(res.ok && data.success),
        ran: true,
        suspendedTo16Pool: Number(data.suspendedTo16Pool) || 0,
        disabledSecrets: Number(data.disabledSecrets) || 0,
        enteredGrace: Number(data.enteredGrace) || 0,
        kickedActiveSessions: Number(data.kickedActiveSessions) || 0,
      };
    } catch (err: any) {
      return {
        success: false,
        ran: true,
        suspendedTo16Pool: 0,
        disabledSecrets: 0,
        enteredGrace: 0,
        kickedActiveSessions: 0,
        errors: [err?.message || 'Unable to execute /api/billing/run-expiry-check'],
      };
    } finally {
      inflightAutoSweep = null;
    }
  };

  inflightAutoSweep = run();
  return inflightAutoSweep;
}

/**
 * Legacy helper name retained for BillingView load hook: delegates directly to the unified
 * Grace + MikroTik EXPIRED-16-POOL auto-expiry sweep engine.
 */
export async function enforce31DayAutoExpiry(
  _invoices: SupabaseInvoice[],
  activeRouter?: RouterAuthInfo
): Promise<number> {
  const res = await triggerAutoExpirySweep(activeRouter);
  return (res.suspendedTo16Pool || 0) + (res.disabledSecrets || 0);
}

const prevInterfaceByteCounters: Record<string, { rxBytes: number; txBytes: number; ts: number }> = {};

/**
 * Lightweight, read-only interface traffic fetch using authenticated safeMikrotikFetch
 * Calls POST /api/mikrotik/interface/monitor-traffic with { interface, once: '' } (and fallback 'yes'),
 * plus byte-counter delta fallback from /api/mikrotik/interface.
 */
export async function fetchMikrotikInterfaceTrafficOnce(
  interfaceName: string,
  activeRouter?: RouterAuthInfo
): Promise<{ rxMbps: number; txMbps: number; ok: boolean }> {
  if (!interfaceName) return { rxMbps: 0, txMbps: 0, ok: false };

  const parseMonitorPayload = (data: any): { rxMbps: number; txMbps: number; ok: boolean } | null => {
    const target = Array.isArray(data) ? data[0] : data;
    if (
      target &&
      (target['rx-bits-per-second'] !== undefined ||
        target['tx-bits-per-second'] !== undefined ||
        target['rx-bps'] !== undefined ||
        target['tx-bps'] !== undefined)
    ) {
      const rxBps = Number(target['rx-bits-per-second'] ?? target['rx-bps'] ?? 0);
      const txBps = Number(target['tx-bits-per-second'] ?? target['tx-bps'] ?? 0);
      return {
        rxMbps: Math.round((rxBps / 1_000_000) * 100) / 100,
        txMbps: Math.round((txBps / 1_000_000) * 100) / 100,
        ok: true,
      };
    }
    return null;
  };

  // 1. Standard RouterOS v7 REST POST /interface/monitor-traffic with { interface, once: '' }
  try {
    const postRes = await safeMikrotikFetch(
      '/api/mikrotik/interface/monitor-traffic',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interface: interfaceName, once: '' }),
      },
      activeRouter
    );
    if (postRes.ok) {
      const data = await postRes.json();
      const parsed = parseMonitorPayload(data);
      if (parsed) return parsed;
    }
  } catch {}

  // 2. Fallback POST with { interface, once: 'yes' } for older RouterOS v7 builds
  try {
    const postRes = await safeMikrotikFetch(
      '/api/mikrotik/interface/monitor-traffic',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interface: interfaceName, once: 'yes' }),
      },
      activeRouter
    );
    if (postRes.ok) {
      const data = await postRes.json();
      const parsed = parseMonitorPayload(data);
      if (parsed) return parsed;
    }
  } catch {}

  // 3. Fallback: compute real instantaneous Mbps from /api/mikrotik/interface byte counter deltas
  try {
    const ifaceRes = await safeMikrotikFetch(
      `/api/mikrotik/interface?name=${encodeURIComponent(interfaceName)}`,
      { method: 'GET' },
      activeRouter
    );
    if (ifaceRes.ok) {
      const list = await ifaceRes.json();
      const match = Array.isArray(list)
        ? list.find((i: any) => (i?.name || '').toLowerCase() === interfaceName.toLowerCase()) || list[0]
        : list;
      if (match && (match['rx-byte'] !== undefined || match['tx-byte'] !== undefined)) {
        const rxBytes = Number(match['rx-byte'] || 0);
        const txBytes = Number(match['tx-byte'] || 0);
        const now = Date.now();
        const prev = prevInterfaceByteCounters[interfaceName];
        prevInterfaceByteCounters[interfaceName] = { rxBytes, txBytes, ts: now };
        if (prev && now > prev.ts && rxBytes >= prev.rxBytes && txBytes >= prev.txBytes) {
          const dtSec = (now - prev.ts) / 1000;
          const rxMbps = Math.round((((rxBytes - prev.rxBytes) * 8) / (dtSec * 1_000_000)) * 100) / 100;
          const txMbps = Math.round((((txBytes - prev.txBytes) * 8) / (dtSec * 1_000_000)) * 100) / 100;
          return { rxMbps, txMbps, ok: true };
        }
      }
    }
  } catch {}

  return { rxMbps: 0, txMbps: 0, ok: false };
}
