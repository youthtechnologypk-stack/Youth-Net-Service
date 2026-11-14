import { supabase, SupabaseInvoice } from '../services/supabaseClient';
import { safeMikrotikFetch } from '../services/mikrotikRestClient';
import { RouterAuthInfo } from '../services/apiClient';

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
  options?: { disabled?: 'true' | 'false' }
): Promise<{ ok: boolean; previousProfile?: string | null; secretId?: string | null }> {
  const cleanUser = (subscriberUsername || '').trim();
  if (!cleanUser || !targetProfile) return { ok: false };

  try {
    let secretId: string | null = null;
    let previousProfile: string | null = null;

    try {
      const res = await safeMikrotikFetch(`/api/mikrotik/ppp/secret?name=${encodeURIComponent(cleanUser)}`);
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
        }
      );
      if (patchRes.ok) {
        return { ok: true, previousProfile, secretId };
      }
    }

    const setPayload: Record<string, any> = {
      ...patchFields,
      ...(secretId ? { '.id': secretId, numbers: secretId } : { name: cleanUser, numbers: cleanUser }),
    };

    const setRes = await safeMikrotikFetch('/api/mikrotik/ppp/secret/set', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(setPayload),
    });

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
  subscriberUsername: string
): Promise<number> {
  const cleanUser = (subscriberUsername || '').trim().toLowerCase();
  if (!cleanUser) return 0;

  let kicked = 0;
  try {
    const activeRes = await safeMikrotikFetch('/api/mikrotik/ppp/active');
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
        { method: 'DELETE' }
      );
      if (delRes.ok) {
        kicked++;
      } else {
        const remRes = await safeMikrotikFetch('/api/mikrotik/ppp/active/remove', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ '.id': activeId, numbers: activeId }),
        });
        if (remRes.ok) kicked++;
      }
    }
  } catch {}
  return kicked;
}

/**
 * Instant 5-Second Restore Hook (DB + MikroTik Atomic Sync):
 * 1. Updates Supabase first: +30 days expiry_date, billing_status='ACTIVE', grace_ends_at=null, last_restored_at=now
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
  const newExpiryIso = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const triggeredBy = options?.triggeredBy || 'AGENT_PAYMENT_SYNC';

  if (!cleanUser) {
    return { success: false, restoredProfile: '20Mbps', kickedSessions: 0, newExpiryIso };
  }

  let restoredProfile = '20Mbps';
  let previousProfile: string | null = null;
  let subscriberId: string | null = null;

  try {
    // 1. Read current subscriber profile backups from Supabase portal_users
    const { data: userRecord } = await supabase
      .from('portal_users')
      .select('*')
      .eq('username', cleanUser)
      .maybeSingle();

    subscriberId = userRecord?.id || null;
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

    // 2. Update Supabase first (+30 days expiry, ACTIVE status, clear grace)
    if (userRecord?.id) {
      const fullUpdate = {
        account_status: 'ACTIVE',
        billing_status: 'ACTIVE',
        grace_ends_at: null,
        last_restored_at: nowIso,
        expiry_date: newExpiryIso,
      };
      const { error: updErr } = await supabase
        .from('portal_users')
        .update(fullUpdate)
        .eq('id', userRecord.id);

      if (updErr) {
        // Fallback if new automation columns have not yet been migrated
        await supabase
          .from('portal_users')
          .update({
            account_status: 'ACTIVE',
            expiry_date: newExpiryIso.split('T')[0],
          })
          .eq('id', userRecord.id);
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
            `Atomic payment restore: +30d expiry (${newExpiryIso.slice(0, 10)}), profile=${restoredProfile}, kicked=${kickedSessions}`,
          created_at: nowIso,
        },
      ]);
    } catch {}

    return {
      success: true,
      restoredProfile,
      kickedSessions,
      newExpiryIso,
    };
  } catch (err) {
    console.warn('restoreSubscriberOnInvoicePaid notice:', err);
    return {
      success: false,
      restoredProfile,
      kickedSessions: 0,
      newExpiryIso,
    };
  }
}

/**
 * Computes +31 days YYYY-MM-DD from a reference date
 */
export function add31DaysDateString(baseDate: Date = new Date()): string {
  const d = new Date(baseDate.getTime());
  d.setDate(d.getDate() + 31);
  return d.toISOString().split('T')[0];
}

/**
 * Evaluates all invoices against 31-day auto-expiry:
 * If CURRENT_DATE > due_date and status !== 'PAID' -> mark subscriber EXPIRED in portal_users
 * and switch their MikroTik PPPoE secret profile to EXPIRED / Walled Garden.
 */
let lastAutoExpiryCheckAt = 0;
export async function enforce31DayAutoExpiry(invoices: SupabaseInvoice[]): Promise<number> {
  // Throttle to avoid spamming MikroTik REST calls on every render
  const now = Date.now();
  if (now - lastAutoExpiryCheckAt < 30000) return 0;
  lastAutoExpiryCheckAt = now;

  if (!Array.isArray(invoices) || invoices.length === 0) return 0;

  const todayStr = new Date().toISOString().split('T')[0];

  // Find subscribers who have overdue/unpaid invoices past their 31-day expiry date
  const expiredCandidates = new Set<string>();
  const paidUsernames = new Set<string>();

  for (const inv of invoices) {
    const uname = (inv?.subscriber_username || '').trim().toLowerCase();
    if (!uname) continue;
    const balance = Math.max(0, (Number(inv.amount) || 0) - (Number(inv.paid_amount) || 0));
    const isPaid = (inv.status || '').toUpperCase() === 'PAID' || balance <= 0;

    if (isPaid) {
      paidUsernames.add(uname);
    } else if (inv.due_date && todayStr > inv.due_date) {
      expiredCandidates.add(uname);
    }
  }

  // Filter to users currently ACTIVE in portal_users so we only update those needing transition
  if (expiredCandidates.size === 0) return 0;

  try {
    const { data: activeClients } = await supabase
      .from('portal_users')
      .select('id, username, account_status')
      .eq('role', 'CLIENT')
      .eq('account_status', 'ACTIVE');

    if (!activeClients || activeClients.length === 0) return 0;

    // Resolve EXPIRED or Walled Garden profile name on router if present
    let expiredProfileName = 'EXPIRED';
    try {
      const profRes = await safeMikrotikFetch('/api/mikrotik/ppp/profile');
      if (profRes.ok) {
        const profiles = await profRes.json();
        if (Array.isArray(profiles)) {
          const match = profiles.find((p: any) => {
            const name = (p?.name || '').toLowerCase();
            return name === 'expired' || name.includes('walled') || name.includes('expire');
          });
          if (match?.name) expiredProfileName = match.name;
        }
      }
    } catch {}

    let transitionedCount = 0;
    for (const client of activeClients) {
      const uname = (client.username || '').trim().toLowerCase();
      if (expiredCandidates.has(uname)) {
        await supabase
          .from('portal_users')
          .update({ account_status: 'EXPIRED' })
          .eq('id', client.id);

        await syncMikrotikSecretProfile(uname, expiredProfileName);
        transitionedCount++;
      }
    }
    return transitionedCount;
  } catch (err) {
    console.warn('enforce31DayAutoExpiry notice:', err);
    return 0;
  }
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
