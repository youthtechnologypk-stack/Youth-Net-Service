import { supabase, SupabaseInvoice } from '../services/supabaseClient';
import { safeMikrotikFetch } from '../services/mikrotikRestClient';
import { RouterAuthInfo, getActiveRouterAuth, resolveRestHostAndPort } from '../services/apiClient';
import { addCalendarMonthsYmd, computeBillingAnchorDay, extractYmdString } from './anniversaryBilling';
import { isMissingTableOrColumnError } from './expiryUtils';
import {
  extractOrigPkgFromComment,
  isExpiryOrBlockedProfile,
  resolveExactSubscriberProfile,
  upsertOrigPkgComment,
} from './mikrotikProfileSync';
import {
  checkAndDeductResellerWallet,
  refundResellerWallet,
  resolveActiveResellerIdForSubscriber,
} from './resellerEngine';
import { getStoredUser } from './auth';
import { hasExplicitAdminGracePermission } from './staffPermissions';
import { triggerAutoWhatsAppNotification } from './whatsappRouting';

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

async function safeUpdatePortalUserFields(
  userId: string,
  fullFields: Record<string, any>,
  safeExistingFields: Record<string, any>,
  minimalFields: Record<string, any>
): Promise<void> {
  const { error } = await supabase
    .from('portal_users')
    .update(fullFields as any)
    .eq('id', userId);

  if (error) {
    if (isMissingTableOrColumnError(error)) {
      if (Object.keys(safeExistingFields).length > 0) {
        const res2 = await supabase
          .from('portal_users')
          .update(safeExistingFields as any)
          .eq('id', userId);
        if (!res2.error) return;
      }
      if (Object.keys(minimalFields).length > 0) {
        await supabase.from('portal_users').update(minimalFields as any).eq('id', userId);
      }
    } else {
      throw new Error(error.message);
    }
  }
}

/**
 * Updates a subscriber's PPPoE secret profile (and optionally disabled / comment flags) on MikroTik RouterOS v7
 * via /api/mikrotik/ppp/secret/{id} (with /ppp/secret/set fallback).
 */
export async function syncMikrotikSecretProfile(
  subscriberUsername: string,
  targetProfile: string,
  options?: {
    disabled?: 'true' | 'false';
    comment?: string;
    preloadedSecret?: Record<string, any> | null;
  },
  activeRouter?: RouterAuthInfo
): Promise<{
  ok: boolean;
  previousProfile?: string | null;
  secretId?: string | null;
  secretComment?: string | null;
}> {
  const cleanUser = (subscriberUsername || '').trim();
  if (!cleanUser || !targetProfile) return { ok: false };

  try {
    let secretId: string | null = options?.preloadedSecret
      ? String(options.preloadedSecret['.id'] || options.preloadedSecret.id || '').trim() || null
      : null;
    let previousProfile: string | null = options?.preloadedSecret?.profile || null;
    let secretComment: string | null = options?.preloadedSecret?.comment || null;

    if (!secretId) {
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
              secretComment = match.comment || null;
            }
          }
        }
      } catch {}
    }

    const patchFields: Record<string, any> = {
      profile: targetProfile,
    };
    if (options?.disabled !== undefined) {
      patchFields.disabled = options.disabled;
    }
    if (options?.comment !== undefined) {
      patchFields.comment = options.comment;
    }

    const reqHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-subscriber-username': cleanUser,
    };

    if (secretId) {
      const patchRes = await safeMikrotikFetch(
        `/api/mikrotik/ppp/secret/${encodeURIComponent(secretId)}`,
        {
          method: 'PATCH',
          headers: reqHeaders,
          body: JSON.stringify(patchFields),
        },
        activeRouter
      );
      if (patchRes.ok) {
        return { ok: true, previousProfile, secretId, secretComment };
      }
      if (patchRes.status === 402 || patchRes.status === 403) {
        const errBody = await patchRes.json().catch(() => ({} as any));
        return {
          ok: false,
          previousProfile,
          secretId,
          secretComment,
          error: errBody?.error || 'Blocked by Prepaid Wallet Payment Gate.',
        } as any;
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
        headers: reqHeaders,
        body: JSON.stringify(setPayload),
      },
      activeRouter
    );

    if (!setRes.ok && (setRes.status === 402 || setRes.status === 403)) {
      const errBody = await setRes.json().catch(() => ({} as any));
      return {
        ok: false,
        previousProfile,
        secretId,
        secretComment,
        error: errBody?.error || 'Blocked by Prepaid Wallet Payment Gate.',
      } as any;
    }

    return { ok: setRes.ok, previousProfile, secretId, secretComment };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'MikroTik update failed' } as any;
  }
}

/**
 * Kicks any active PPPoE session for a subscriber (e.g. trapped on 16.16.16.x)
 * so their CPE immediately redials within ~5 seconds on the restored profile.
 */
export async function kickMikrotikActiveSessionForUser(
  subscriberUsername: string,
  activeRouter?: RouterAuthInfo,
  preloadedActive?: Array<Record<string, any>>
): Promise<number> {
  const cleanUser = (subscriberUsername || '').trim().toLowerCase();
  if (!cleanUser) return 0;

  let kicked = 0;
  try {
    let list = preloadedActive;
    if (!Array.isArray(list)) {
      const activeRes = await safeMikrotikFetch('/api/mikrotik/ppp/active', {}, activeRouter);
      if (!activeRes.ok) return 0;
      const json = await activeRes.json();
      if (!Array.isArray(json)) return 0;
      list = json;
    }

    const matching = list.filter(
      (s: any) => String(s?.name || s?.user || '').trim().toLowerCase() === cleanUser
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
 * Adopts live PPPoE profiles (/ppp/profile) & secret profiles (/ppp/secret) directly
 * from MikroTik RouterOS (Single Source of Truth) into Supabase portal_users
 * (`original_package_profile`, `package_name`, `package_profile_name`) whenever the
 * secret's active profile is NOT Expire / EXPIRED-16-POOL (or from ORIG_PKG comment).
 */
export async function syncProfilesFromMikrotikToSupabase(
  activeRouter?: RouterAuthInfo,
  expiryProfileName: string = 'EXPIRED-16-POOL'
): Promise<{
  success: boolean;
  profiles: string[];
  totalSecrets: number;
  syncedCount: number;
  adoptedFromCommentCount: number;
  alreadySyncedCount: number;
  error?: string;
}> {
  try {
    const [profRes, secRes, usersRes] = await Promise.all([
      safeMikrotikFetch('/api/mikrotik/ppp/profile', {}, activeRouter),
      safeMikrotikFetch('/api/mikrotik/ppp/secret', {}, activeRouter),
      supabase.from('portal_users').select('*').eq('role', 'CLIENT'),
    ]);

    if (!secRes.ok && !profRes.ok) {
      return {
        success: false,
        profiles: [],
        totalSecrets: 0,
        syncedCount: 0,
        adoptedFromCommentCount: 0,
        alreadySyncedCount: 0,
        error: `RouterOS returned HTTP ${secRes.status || profRes.status}. Check router connectivity.`,
      };
    }

    const rawProfiles = profRes.ok ? await profRes.json().catch(() => []) : [];
    const profiles: string[] = Array.isArray(rawProfiles)
      ? Array.from(
          new Set(
            rawProfiles.map((p: any) => String(p?.name || '').trim()).filter(Boolean)
          )
        )
      : [];

    const rawSecrets = secRes.ok ? await secRes.json().catch(() => []) : [];
    const secrets = Array.isArray(rawSecrets) ? rawSecrets : [];
    const secretByUser = new Map<string, Record<string, any>>();
    for (const s of secrets) {
      const key = String(s?.name || '').trim().toLowerCase();
      if (key) secretByUser.set(key, s);
    }

    const dbUsers = (usersRes.data || []) as Array<Record<string, any>>;
    let syncedCount = 0;
    let adoptedFromCommentCount = 0;
    let alreadySyncedCount = 0;

    for (const u of dbUsers) {
      const uname = String(u.username || '').trim().toLowerCase();
      if (!uname) continue;
      const secret = secretByUser.get(uname);
      if (!secret) continue;

      const liveProf = String(secret.profile || '').trim();
      const isLiveExpired = isExpiryOrBlockedProfile(liveProf, expiryProfileName);

      if (!isLiveExpired && liveProf) {
        const currentOrig = String(u.original_package_profile || '').trim();
        const currentPkgProf = String(u.package_profile_name || '').trim();
        const currentPkgName = String((u as any).package_name || '').trim();

        if (
          currentOrig === liveProf &&
          currentPkgProf === liveProf &&
          (!currentPkgName || currentPkgName === liveProf)
        ) {
          alreadySyncedCount++;
          continue;
        }

        await safeUpdatePortalUserFields(
          String(u.id),
          {
            original_package_profile: liveProf,
            package_name: liveProf,
            package_profile_name: liveProf,
          },
          {
            original_package_profile: liveProf,
            package_profile_name: liveProf,
          },
          { package_profile_name: liveProf }
        ).catch(() => {});
        syncedCount++;
      } else {
        // Secret currently on Expire / EXPIRED-16-POOL -> adopt ORIG_PKG:<exact_profile> from comment if missing
        const fromComment = extractOrigPkgFromComment(secret.comment, expiryProfileName);
        if (fromComment) {
          const currentOrig = String(u.original_package_profile || '').trim();
          if (
            !currentOrig ||
            isExpiryOrBlockedProfile(currentOrig, expiryProfileName) ||
            currentOrig !== fromComment
          ) {
            await safeUpdatePortalUserFields(
              String(u.id),
              {
                original_package_profile: fromComment,
                package_name: fromComment,
                package_profile_name: fromComment,
              },
              {
                original_package_profile: fromComment,
                package_profile_name: fromComment,
              },
              { package_profile_name: fromComment }
            ).catch(() => {});
            adoptedFromCommentCount++;
          } else {
            alreadySyncedCount++;
          }
        }
      }
    }

    return {
      success: true,
      profiles,
      totalSecrets: secrets.length,
      syncedCount,
      adoptedFromCommentCount,
      alreadySyncedCount,
    };
  } catch (err: any) {
    return {
      success: false,
      profiles: [],
      totalSecrets: 0,
      syncedCount: 0,
      adoptedFromCommentCount: 0,
      alreadySyncedCount: 0,
      error: err?.message || 'Failed to sync profiles from MikroTik',
    };
  }
}

/**
 * Instant 5-Second Restore Hook (DB + MikroTik Atomic Sync):
 * 1. Reads live MikroTik secret (`ORIG_PKG:<exact_profile>` comment or non-expiry profile) & Supabase backups
 * 2. Updates Supabase first: +1 calendar month expiry_date/next_billing_date anchored to installation day,
 *    is_suspended=false, billing_status='ACTIVE', grace_until=null, grace_ends_at=null, last_restored_at=now
 * 3. Restores MikroTik /rest/ppp/secret/{id} to exact adopted profile (disabled='false')
 * 4. Kicks any 16.16.16.x / stale active PPPoE session for instant reconnect
 * 5. Inserts 'RESTORED_ON_PAYMENT' into expiry_audit_logs
 */
export async function restoreSubscriberOnInvoicePaid(
  subscriberUsername: string,
  options?: {
    triggeredBy?: 'ADMIN' | 'AGENT_PAYMENT_SYNC' | 'CRON_2PM';
    notes?: string;
    expiryProfileName?: string;
    activeRouter?: RouterAuthInfo;
    preloadedSecrets?: Array<Record<string, any>>;
    preloadedProfiles?: string[];
    preloadedActive?: Array<Record<string, any>>;
    performedBy?: string;
    skipWalletDeduction?: boolean;
    amountPaid?: number;
    invoiceNo?: string;
    paymentMethod?: string;
    skipAutoWhatsapp?: boolean;
  }
): Promise<{
  success: boolean;
  restoredProfile: string;
  kickedSessions: number;
  newExpiryIso: string;
  insufficientWalletFunds?: boolean;
  walletChargedAmount?: number;
  error?: string;
}> {
  const cleanUser = (subscriberUsername || '').trim().toLowerCase();
  const nowIso = new Date().toISOString();
  const triggeredBy = options?.triggeredBy || 'AGENT_PAYMENT_SYNC';

  if (!cleanUser) {
    const fallbackExpiryIso = `${addCalendarMonthDateString(new Date())}T14:00:00+05:00`;
    return { success: false, restoredProfile: 'default', kickedSessions: 0, newExpiryIso: fallbackExpiryIso };
  }

  let restoredProfile = 'default';
  let previousProfile: string | null = null;
  let subscriberId: string | null = null;
  let anchorDay = new Date().getDate();
  let nextAnniversaryYmd = addCalendarMonthDateString(new Date(), anchorDay);

  try {
    // 1. Read subscriber record from Supabase + live MikroTik secret/profiles in parallel
    let liveSecret: Record<string, any> | null =
      options?.preloadedSecrets?.find(
        (s) => String(s?.name || '').trim().toLowerCase() === cleanUser
      ) || null;
    let mikrotikProfiles: string[] = options?.preloadedProfiles || [];

    const [userRes, secretRes, profRes] = await Promise.all([
      supabase
        .from('portal_users')
        .select('*')
        .ilike('username', cleanUser)
        .limit(1)
        .maybeSingle(),
      liveSecret
        ? Promise.resolve(null)
        : safeMikrotikFetch(
            `/api/mikrotik/ppp/secret?name=${encodeURIComponent(cleanUser)}`,
            {},
            options?.activeRouter
          ).catch(() => null),
      mikrotikProfiles.length > 0
        ? Promise.resolve(null)
        : safeMikrotikFetch('/api/mikrotik/ppp/profile', {}, options?.activeRouter).catch(() => null),
    ]);

    const userRecord = userRes.data;
    if (!liveSecret && secretRes && secretRes.ok) {
      const list = await secretRes.json().catch(() => []);
      if (Array.isArray(list)) {
        liveSecret =
          list.find((s: any) => String(s?.name || '').trim().toLowerCase() === cleanUser) || null;
      }
    }
    if (mikrotikProfiles.length === 0 && profRes && profRes.ok) {
      const profJson = await profRes.json().catch(() => []);
      if (Array.isArray(profJson)) {
        mikrotikProfiles = Array.from(
          new Set(profJson.map((p: any) => String(p?.name || '').trim()).filter(Boolean))
        );
      }
    }

    subscriberId = userRecord?.id || null;
    if (userRecord) {
      anchorDay = computeBillingAnchorDay(userRecord);
      const baseAnchor =
        extractYmdString((userRecord as any).next_billing_date) ||
        extractYmdString(userRecord.expiry_date) ||
        extractYmdString(new Date().toISOString())!;
      const todayYmd = extractYmdString(new Date().toISOString())!;
      let candidateNext = addCalendarMonthsYmd(baseAnchor, 1, anchorDay);
      if (candidateNext <= todayYmd) {
        candidateNext = addCalendarMonthsYmd(todayYmd, 1, anchorDay);
      }
      nextAnniversaryYmd = candidateNext;
    }
    const finalExpiryIso = `${nextAnniversaryYmd}T14:00:00+05:00`;

    // Resolve exact MikroTik profile: ORIG_PKG comment -> live non-expiry secret -> Supabase original_package_profile -> live profiles
    const origCommentPkg = extractOrigPkgFromComment(
      liveSecret?.comment,
      options?.expiryProfileName
    );
    if (origCommentPkg) {
      restoredProfile =
        resolveExactSubscriberProfile({
          liveSecret: { ...liveSecret, profile: origCommentPkg },
          subscriber: userRecord as any,
          mikrotikProfiles,
          expiryProfileName: options?.expiryProfileName,
        }) || origCommentPkg;
    } else {
      restoredProfile = resolveExactSubscriberProfile({
        liveSecret,
        subscriber: userRecord as any,
        mikrotikProfiles,
        expiryProfileName: options?.expiryProfileName,
      });
    }

    // 1b. Strict Prepaid Reseller Wallet Payment Gate on Renewal / Restore
    let walletChargedAmount = 0;
    const ownerResellerId = resolveActiveResellerIdForSubscriber(userRecord as any, getStoredUser());
    if (ownerResellerId && !options?.skipWalletDeduction && !isExpiryOrBlockedProfile(restoredProfile, options?.expiryProfileName)) {
      const walletRes = await checkAndDeductResellerWallet({
        resellerId: ownerResellerId,
        profileName: restoredProfile,
        subscriberUsername: cleanUser,
        txType: 'RENEWAL_DEDUCTION',
        performedBy: options?.performedBy || triggeredBy,
        notes: options?.notes || `Renewal / restore for @${cleanUser} (${restoredProfile})`,
      });
      if (!walletRes.ok) {
        return {
          success: false,
          restoredProfile,
          kickedSessions: 0,
          newExpiryIso: nextAnniversaryYmd,
          insufficientWalletFunds: Boolean(walletRes.insufficientFunds || walletRes.tariffMissing),
          error: walletRes.error || 'Insufficient Wallet Balance',
        };
      }
      walletChargedAmount = walletRes.chargedAmount;
    }

    // 2. Restore MikroTik secret back to exact adopted profile & disabled='false'
    //    If RouterOS fails AFTER a reseller wallet deduction, automatically refund the wallet!
    const syncRes: any = await syncMikrotikSecretProfile(
      cleanUser,
      restoredProfile,
      { disabled: 'false', preloadedSecret: liveSecret },
      options?.activeRouter
    );

    if (!syncRes.ok && ownerResellerId && walletChargedAmount > 0) {
      await refundResellerWallet({
        resellerId: ownerResellerId,
        amount: walletChargedAmount,
        subscriberUsername: cleanUser,
        profileName: restoredProfile,
        reason: syncRes.error || 'MikroTik /ppp/secret profile restore failed',
        performedBy: options?.performedBy || triggeredBy,
      });
      return {
        success: false,
        restoredProfile,
        kickedSessions: 0,
        newExpiryIso: nextAnniversaryYmd,
        walletChargedAmount: 0,
        error: `MikroTik restore failed (${syncRes.error || 'Router unreachable'}). Rs. ${walletChargedAmount.toLocaleString()} was automatically refunded to your wallet.`,
      };
    }

    previousProfile =
      syncRes.previousProfile ||
      ((userRecord as any)?.billing_status === 'SUSPENDED_EXPIRED'
        ? options?.expiryProfileName || 'EXPIRED-16-POOL'
        : null);

    // 3. Update Supabase (+1 calendar month anniversary expiry, ACTIVE status, clear grace/suspension, persist adopted profile)
    if (userRecord?.id) {
      await safeUpdatePortalUserFields(
        userRecord.id,
        {
          account_status: 'ACTIVE',
          billing_status: 'ACTIVE',
          is_suspended: false,
          shifted_to_next_month: false,
          grace_until: null,
          grace_ends_at: null,
          last_restored_at: nowIso,
          expiry_date: finalExpiryIso,
          billing_anchor_day: anchorDay,
          next_billing_date: nextAnniversaryYmd,
          original_package_profile: restoredProfile,
          package_name: restoredProfile,
          package_profile_name: restoredProfile,
        },
        {
          account_status: 'ACTIVE',
          billing_status: 'ACTIVE',
          grace_ends_at: null,
          last_restored_at: nowIso,
          expiry_date: finalExpiryIso,
          original_package_profile: restoredProfile,
          package_profile_name: restoredProfile,
        },
        {
          account_status: 'ACTIVE',
          expiry_date: nextAnniversaryYmd,
        }
      ).catch(() => {});
    }

    // 4. Kick any stale or 16.16.16.x active PPPoE session so CPE reconnects immediately on real speed profile
    const kickedSessions = await kickMikrotikActiveSessionForUser(
      cleanUser,
      options?.activeRouter,
      options?.preloadedActive
    );

    // 5. Write permanent audit log entry
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

    // 6. Zero-click background WhatsApp Payment Receipt & Service Restored notification
    if (!options?.skipAutoWhatsapp && typeof window !== 'undefined') {
      const subData = userRes?.data as any;
      void triggerAutoWhatsAppNotification({
        eventType: 'PAYMENT_RESTORED',
        subscriberUsername: cleanUser,
        subscriber: subData || { username: cleanUser },
        messageVars: {
          subscriberName: subData?.full_name || cleanUser,
          username: cleanUser,
          phone: subData?.phone || undefined,
          packageName: restoredProfile,
          amountPaid: options?.amountPaid ?? Number(subData?.monthly_fee || 0),
          remainingBalance: 0,
          invoiceNo: options?.invoiceNo,
          paymentMethod: options?.paymentMethod || 'Verified Payment',
          expiryDate: nextAnniversaryYmd,
        },
      });
    }

    return {
      success: true,
      restoredProfile,
      kickedSessions,
      newExpiryIso: nextAnniversaryYmd,
      walletChargedAmount,
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
 * Fetches live PPPoE profiles (/ppp/profile) & secrets (/ppp/secret) directly from the connected MikroTik RouterOS.
 */
export async function fetchLiveMikrotikProfilesAndSecrets(
  activeRouter?: RouterAuthInfo
): Promise<{
  ok: boolean;
  profiles: Array<{ name: string; rateLimit?: string }>;
  secrets: Array<Record<string, any>>;
}> {
  try {
    const [profRes, secRes] = await Promise.all([
      safeMikrotikFetch('/api/mikrotik/ppp/profile', {}, activeRouter).catch(() => null),
      safeMikrotikFetch('/api/mikrotik/ppp/secret', {}, activeRouter).catch(() => null),
    ]);

    const rawProfiles = profRes && profRes.ok ? await profRes.json().catch(() => []) : [];
    const profilesMap = new Map<string, { name: string; rateLimit?: string }>();
    if (Array.isArray(rawProfiles)) {
      for (const p of rawProfiles) {
        const name = String(p?.name || '').trim();
        if (!name) continue;
        const low = name.toLowerCase();
        if (!profilesMap.has(low)) {
          const rl = String(p?.['rate-limit'] || p?.rateLimit || '').trim();
          profilesMap.set(low, { name, rateLimit: rl || undefined });
        }
      }
    }

    const rawSecrets = secRes && secRes.ok ? await secRes.json().catch(() => []) : [];
    const secrets = Array.isArray(rawSecrets) ? rawSecrets : [];

    return {
      ok: Boolean((profRes && profRes.ok) || (secRes && secRes.ok)),
      profiles: Array.from(profilesMap.values()),
      secrets,
    };
  } catch {
    return { ok: false, profiles: [], secrets: [] };
  }
}

/**
 * Updates an invoice row in Supabase, automatically stripping optional `package_profile` / `package_name`
 * columns if the live PostgreSQL `invoices` table has not run the migration yet.
 */
export async function safeUpdateInvoiceInSupabase(
  matcher: { id?: string; invoiceNo?: string },
  payload: Record<string, any>
): Promise<{ error: any; strippedColumns?: string[] }> {
  const applyMatcher = (q: any) => {
    if (matcher.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(matcher.id)) {
      return q.eq('id', matcher.id);
    }
    if (matcher.invoiceNo) {
      return q.eq('invoice_no', matcher.invoiceNo);
    }
    if (matcher.id) {
      return q.eq('id', matcher.id);
    }
    return q;
  };

  const working: Record<string, any> = { ...payload };
  const optionalCols = new Set([
    'notes',
    'package_profile',
    'package_name',
    'shifted_to_next_month',
    'sub_dealer_id',
    'dealer_id',
    'created_by_id',
  ]);
  const strippedColumns: string[] = [];

  for (let attempt = 0; attempt < 8; attempt++) {
    const { error } = await applyMatcher(supabase.from('invoices').update(working as any));
    if (!error) return { error: null, strippedColumns };

    if (!isMissingTableOrColumnError(error)) {
      return { error, strippedColumns };
    }

    const msg = String(error.message || '');
    const colMatch =
      msg.match(/Could not find the ['"]([a-zA-Z0-9_]+)['"] column/i) ||
      msg.match(/column\s+["']?([a-zA-Z0-9_]+)["']?\s+(?:of relation|does not exist)/i);

    if (colMatch?.[1] && colMatch[1] in working && optionalCols.has(colMatch[1])) {
      strippedColumns.push(colMatch[1]);
      delete working[colMatch[1]];
      continue;
    }

    let removedAny = false;
    for (const col of optionalCols) {
      if (col in working) {
        strippedColumns.push(col);
        delete working[col];
        removedAny = true;
      }
    }
    if (!removedAny) {
      return { error, strippedColumns };
    }
  }

  return { error: null, strippedColumns };
}

/**
 * Inserts an invoice row into Supabase, automatically stripping optional `package_profile` / `package_name`
 * columns if the live PostgreSQL `invoices` table lacks them.
 */
export async function safeInsertInvoiceInSupabase(
  payload: Record<string, any>
): Promise<{ data: any; error: any }> {
  const working: Record<string, any> = { ...payload };
  const optionalCols = new Set([
    'package_profile',
    'package_name',
    'shifted_to_next_month',
    'sub_dealer_id',
    'created_by_id',
    'dealer_id',
  ]);

  let lastResult: { data: any; error: any } = { data: null, error: null };

  for (let attempt = 0; attempt < 8; attempt++) {
    const { data, error } = await supabase
      .from('invoices')
      .insert([working as any])
      .select()
      .maybeSingle();

    if (!error) return { data, error: null };
    lastResult = { data, error };

    const msg = String(error.message || error.details || '');
    const match =
      msg.match(/Could not find the ['"]([a-zA-Z0-9_]+)['"] column/i) ||
      msg.match(/column\s+["']?([a-zA-Z0-9_]+)["']?\s+of\s+relation/i) ||
      msg.match(/column\s+[a-zA-Z0-9_]+\.["']?([a-zA-Z0-9_]+)["']?\s+does not exist/i);
    const missingCol = match?.[1] || null;

    if (missingCol && missingCol in working && optionalCols.has(missingCol)) {
      if (missingCol === 'sub_dealer_id' && working.sub_dealer_id && 'dealer_id' in working) {
        working.dealer_id = working.sub_dealer_id;
      }
      delete working[missingCol];
      continue;
    }

    if (isMissingTableOrColumnError(error)) {
      let strippedAny = false;
      for (const col of optionalCols) {
        if (col in working) {
          delete working[col];
          strippedAny = true;
        }
      }
      if (strippedAny) continue;
    }

    break;
  }

  return lastResult;
}

/**
 * Saves the selected MikroTik package profile onto the subscriber in Supabase (`original_package_profile`,
 * `package_name`, `package_profile_name`) and, when the invoice is PAID (changed to Paid or already Paid),
 * immediately sets the subscriber's MikroTik `/ppp/secret` profile to that exact profile and kicks any active
 * `16.16.16.0/24` session so their internet runs on that exact package right away.
 */
export async function syncSubscriberPackageAndRestoreIfPaid(params: {
  username: string;
  selectedProfile: string;
  isPaid: boolean;
  invoiceNo?: string;
  triggeredBy?: 'ADMIN' | 'AGENT_PAYMENT_SYNC' | 'CRON_2PM';
  activeRouter?: RouterAuthInfo;
  preloadedSecrets?: Array<Record<string, any>>;
  preloadedActive?: Array<Record<string, any>>;
}): Promise<{
  subscriberUpdated: boolean;
  mikrotikUpdated: boolean;
  kickedSessions: number;
  appliedProfile: string;
  insufficientWalletFunds?: boolean;
  error?: string;
}> {
  const cleanUser = String(params.username || '').trim().toLowerCase();
  const cleanProfile = String(params.selectedProfile || '').trim();
  const nowIso = new Date().toISOString();

  if (!cleanUser || !cleanProfile) {
    return {
      subscriberUpdated: false,
      mikrotikUpdated: false,
      kickedSessions: 0,
      appliedProfile: cleanProfile,
    };
  }

  let subscriberUpdated = false;
  let mikrotikUpdated = false;
  let kickedSessions = 0;
  let subscriberId: string | null = null;

  try {
    const { data: userRow } = await supabase
      .from('portal_users')
      .select('id, billing_status, account_status, dealer_id, sub_dealer_id, is_suspended')
      .ilike('username', cleanUser)
      .limit(1)
      .maybeSingle();

    const isNonExpiry = !isExpiryOrBlockedProfile(cleanProfile);
    const ownerResellerId = resolveActiveResellerIdForSubscriber(userRow as any, getStoredUser());
    let walletChargedAmount = 0;

    if (params.isPaid && ownerResellerId && isNonExpiry) {
      const walletCheck = await checkAndDeductResellerWallet({
        resellerId: ownerResellerId,
        profileName: cleanProfile,
        subscriberUsername: cleanUser,
        txType: 'RENEWAL_DEDUCTION',
        notes: `Invoice ${params.invoiceNo || ''} marked PAID — ${cleanProfile}`.trim(),
      });
      if (!walletCheck.ok) {
        return {
          subscriberUpdated: false,
          mikrotikUpdated: false,
          kickedSessions: 0,
          appliedProfile: cleanProfile,
          insufficientWalletFunds: Boolean(walletCheck.insufficientFunds || walletCheck.tariffMissing),
          error: walletCheck.error || 'Insufficient Wallet Balance',
        };
      }
      walletChargedAmount = walletCheck.chargedAmount;
    }

    const liveSecret =
      params.preloadedSecrets?.find(
        (s) => String(s?.name || '').trim().toLowerCase() === cleanUser
      ) || null;

    if (params.isPaid) {
      const updatedComment = isNonExpiry
        ? upsertOrigPkgComment(liveSecret?.comment, cleanProfile)
        : undefined;

      const mkRes: any = await syncMikrotikSecretProfile(
        cleanUser,
        cleanProfile,
        {
          disabled: 'false',
          comment: updatedComment,
          preloadedSecret: liveSecret,
        },
        params.activeRouter
      );
      mikrotikUpdated = mkRes.ok;

      if (!mkRes.ok && ownerResellerId && walletChargedAmount > 0) {
        await refundResellerWallet({
          resellerId: ownerResellerId,
          amount: walletChargedAmount,
          subscriberUsername: cleanUser,
          profileName: cleanProfile,
          reason: mkRes.error || 'MikroTik /ppp/secret profile update failed',
          performedBy: params.triggeredBy || 'ADMIN',
        });
        return {
          subscriberUpdated: false,
          mikrotikUpdated: false,
          kickedSessions: 0,
          appliedProfile: cleanProfile,
          error: `MikroTik update failed (${mkRes.error || 'Router unreachable'}). Rs. ${walletChargedAmount.toLocaleString()} was automatically refunded to wallet.`,
        };
      }

      if (userRow?.id) {
        subscriberId = String(userRow.id);
        await safeUpdatePortalUserFields(
          subscriberId,
          {
            original_package_profile: isNonExpiry ? cleanProfile : undefined,
            package_name: cleanProfile,
            package_profile_name: cleanProfile,
            is_suspended: false,
            shifted_to_next_month: false,
            billing_status: 'ACTIVE',
            account_status: 'ACTIVE',
            grace_until: null,
            grace_ends_at: null,
            last_restored_at: nowIso,
          },
          {
            original_package_profile: isNonExpiry ? cleanProfile : undefined,
            package_profile_name: cleanProfile,
            billing_status: 'ACTIVE',
            account_status: 'ACTIVE',
            grace_ends_at: null,
            last_restored_at: nowIso,
          },
          {
            package_profile_name: cleanProfile,
            account_status: 'ACTIVE',
          }
        );
        subscriberUpdated = true;
      }

      kickedSessions = await kickMikrotikActiveSessionForUser(
        cleanUser,
        params.activeRouter,
        params.preloadedActive
      );

      try {
        await supabase.from('expiry_audit_logs').insert([
          {
            subscriber_id: subscriberId,
            username: cleanUser,
            action_type: 'RESTORED_ON_PAYMENT',
            previous_profile: mkRes.previousProfile || null,
            applied_profile: cleanProfile,
            triggered_by: params.triggeredBy || 'ADMIN',
            notes: `Invoice ${params.invoiceNo ? `#${params.invoiceNo} ` : ''}saved as PAID -> MikroTik set to "${cleanProfile}" (kicked ${kickedSessions} session(s)).`,
            created_at: nowIso,
          },
        ]);
      } catch {}
    } else if (userRow?.id && isNonExpiry) {
      subscriberId = String(userRow.id);
      await safeUpdatePortalUserFields(
        subscriberId,
        {
          original_package_profile: cleanProfile,
          package_name: cleanProfile,
          package_profile_name: cleanProfile,
        },
        {
          original_package_profile: cleanProfile,
          package_profile_name: cleanProfile,
        },
        {
          package_profile_name: cleanProfile,
        }
      );
      subscriberUpdated = true;
    }
  } catch (err) {
    console.warn('syncSubscriberPackageAndRestoreIfPaid notice:', err);
  }

  return {
    subscriberUpdated,
    mikrotikUpdated,
    kickedSessions,
    appliedProfile: cleanProfile,
  };
}

export interface BulkActivateSubscriberInput {
  id?: string | null;
  username: string;
  original_package_profile?: string | null;
  package_name?: string | null;
  package_profile_name?: string | null;
  package_speed?: string | null;
  isSyntheticRecord?: boolean;
}

/**
 * Bulk Activate / Restore selected subscribers:
 * Reads ORIG_PKG:<exact_profile> from live MikroTik secret comment (or Supabase original_package_profile),
 * restores MikroTik /ppp/secret profile + kicks active 16.16.16.x sessions, sets is_suspended = false in Supabase,
 * and logs each restoration in expiry_audit_logs.
 */
export async function bulkActivateSubscribers(params: {
  subscribers: BulkActivateSubscriberInput[];
  activeRouter?: RouterAuthInfo;
  expiryProfileName?: string;
  triggeredBy?: 'ADMIN' | 'AGENT_PAYMENT_SYNC' | 'CRON_2PM';
  notesPrefix?: string;
  onProgress?: (current: number, total: number, username: string) => void;
}): Promise<{
  restoredCount: number;
  failedCount: number;
  kickedSessions: number;
  results: Array<{ username: string; profile: string; ok: boolean; kicked: number; error?: string }>;
}> {
  const { subscribers, activeRouter, expiryProfileName, triggeredBy = 'ADMIN', onProgress } = params;
  const total = subscribers.length;
  if (total === 0) {
    return { restoredCount: 0, failedCount: 0, kickedSessions: 0, results: [] };
  }

  // Prefetch live MikroTik profiles, secrets, and active sessions once
  const [profRes, secRes, actRes] = await Promise.all([
    safeMikrotikFetch('/api/mikrotik/ppp/profile', {}, activeRouter).catch(() => null),
    safeMikrotikFetch('/api/mikrotik/ppp/secret', {}, activeRouter).catch(() => null),
    safeMikrotikFetch('/api/mikrotik/ppp/active', {}, activeRouter).catch(() => null),
  ]);

  const rawProfiles = profRes && profRes.ok ? await profRes.json().catch(() => []) : [];
  const mikrotikProfiles: string[] = Array.isArray(rawProfiles)
    ? Array.from(new Set(rawProfiles.map((p: any) => String(p?.name || '').trim()).filter(Boolean)))
    : [];

  const rawSecrets = secRes && secRes.ok ? await secRes.json().catch(() => []) : [];
  const secretsList = Array.isArray(rawSecrets) ? rawSecrets : [];
  const secretByUser = new Map<string, Record<string, any>>();
  for (const s of secretsList) {
    const key = String(s?.name || '').trim().toLowerCase();
    if (key) secretByUser.set(key, s);
  }

  const rawActive = actRes && actRes.ok ? await actRes.json().catch(() => []) : [];
  const activeList = Array.isArray(rawActive) ? rawActive : [];

  let restoredCount = 0;
  let failedCount = 0;
  let totalKicked = 0;
  const results: Array<{ username: string; profile: string; ok: boolean; kicked: number; error?: string }> = [];
  const nowIso = new Date().toISOString();

  for (let i = 0; i < total; i++) {
    const sub = subscribers[i];
    const uname = String(sub.username || '').trim().toLowerCase();
    onProgress?.(i + 1, total, uname);
    if (!uname) continue;

    try {
      const liveSecret = secretByUser.get(uname) || null;
      const origCommentPkg = extractOrigPkgFromComment(liveSecret?.comment, expiryProfileName);
      const targetProfile = origCommentPkg
        ? resolveExactSubscriberProfile({
            liveSecret: { ...liveSecret, profile: origCommentPkg },
            subscriber: sub,
            mikrotikProfiles,
            expiryProfileName,
          }) || origCommentPkg
        : resolveExactSubscriberProfile({
            liveSecret,
            subscriber: sub,
            mikrotikProfiles,
            expiryProfileName,
          });

      // 0. Enforce Strict Prepaid Reseller Wallet Payment Gate if subscriber is owned by a Dealer / Sub-Dealer
      let ownerResellerId: string | null = resolveActiveResellerIdForSubscriber(sub as any, null);
      if (!ownerResellerId) {
        const { data: ownerRow } = await supabase
          .from('portal_users')
          .select('sub_dealer_id, dealer_id, monthly_fee')
          .ilike('username', uname)
          .limit(1)
          .maybeSingle();
        ownerResellerId = resolveActiveResellerIdForSubscriber(ownerRow as any, getStoredUser());
      }
      let chargedAmount = 0;
      if (ownerResellerId && !isExpiryOrBlockedProfile(targetProfile, expiryProfileName)) {
        const walletRes = await checkAndDeductResellerWallet({
          resellerId: ownerResellerId,
          profileName: targetProfile,
          subscriberUsername: uname,
          txType: 'RENEWAL_DEDUCTION',
          performedBy: triggeredBy,
          notes: `Bulk activate renewal for @${uname} (${targetProfile})`,
        });
        if (!walletRes.ok) {
          failedCount++;
          results.push({
            username: uname,
            profile: targetProfile,
            ok: false,
            kicked: 0,
            error: walletRes.error || 'Insufficient Wallet Balance',
          });
          continue;
        }
        chargedAmount = walletRes.chargedAmount;
      }

      // 1. Update MikroTik secret & kick active 16.16.16.x session (auto-refund if MikroTik fails)
      const mkSync: any = await syncMikrotikSecretProfile(
        uname,
        targetProfile,
        { disabled: 'false', preloadedSecret: liveSecret },
        activeRouter
      );
      if (!mkSync.ok && ownerResellerId && chargedAmount > 0) {
        await refundResellerWallet({
          resellerId: ownerResellerId,
          amount: chargedAmount,
          subscriberUsername: uname,
          profileName: targetProfile,
          reason: mkSync.error || 'MikroTik bulk activate failed',
          performedBy: triggeredBy,
        });
        failedCount++;
        results.push({
          username: uname,
          profile: targetProfile,
          ok: false,
          kicked: 0,
          error: `MikroTik update failed (${mkSync.error || 'Router error'}) — Rs. ${chargedAmount.toLocaleString()} refunded.`,
        });
        continue;
      }
      const kicked = await kickMikrotikActiveSessionForUser(uname, activeRouter, activeList);
      totalKicked += kicked;

      // 2. Find or update Supabase portal_users row (is_suspended = false, ACTIVE)
      let realId: string | null =
        !sub.isSyntheticRecord &&
        sub.id &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(sub.id))
          ? String(sub.id)
          : null;

      if (!realId) {
        const { data: found } = await supabase
          .from('portal_users')
          .select('id')
          .ilike('username', uname)
          .limit(1)
          .maybeSingle();
        if (found?.id) realId = String(found.id);
      }

      if (realId) {
        await safeUpdatePortalUserFields(
          realId,
          {
            is_suspended: false,
            billing_status: 'ACTIVE',
            account_status: 'ACTIVE',
            grace_until: null,
            grace_ends_at: null,
            last_restored_at: nowIso,
            original_package_profile: targetProfile,
            package_name: targetProfile,
            package_profile_name: targetProfile,
          },
          {
            billing_status: 'ACTIVE',
            account_status: 'ACTIVE',
            grace_ends_at: null,
            last_restored_at: nowIso,
            original_package_profile: targetProfile,
            package_profile_name: targetProfile,
          },
          {
            account_status: 'ACTIVE',
            package_profile_name: targetProfile,
          }
        );
      }

      // 3. Permanent Audit Log entry
      await supabase.from('expiry_audit_logs').insert([
        {
          subscriber_id: realId,
          username: uname,
          action_type: 'RESTORED_ON_PAYMENT',
          previous_profile: mkSync.previousProfile || expiryProfileName || 'EXPIRED-16-POOL',
          applied_profile: targetProfile,
          triggered_by: triggeredBy,
          notes: `${params.notesPrefix || '[BULK_ACTIVATE]'} Restored exact MikroTik profile "${targetProfile}" (${
            origCommentPkg ? 'from ORIG_PKG comment' : 'from DB/MikroTik'
          }), kicked ${kicked} active session(s).`,
          created_at: nowIso,
        },
      ]);

      restoredCount++;
      results.push({ username: uname, profile: targetProfile, ok: true, kicked });
    } catch (err: any) {
      failedCount++;
      results.push({
        username: uname,
        profile: '',
        ok: false,
        kicked: 0,
        error: err?.message || 'Restore failed',
      });
    }
  }

  return { restoredCount, failedCount, kickedSessions: totalKicked, results };
}

export interface BulkReceiveInvoiceItem {
  invoice: SupabaseInvoice;
  amountToCollect: number;
}

/**
 * Bulk Amount Receiving Engine:
 * Marks selected unpaid invoices as PAID in Supabase, logs each entry in payment_transactions
 * (plus optional billing_ledger), credits the selected receiving agent's cash_in_hand &
 * agent_cash_transactions, and automatically activates/restores the exact adopted MikroTik
 * profile for every subscriber whose remaining unpaid due balance reaches 0.
 */
export async function bulkReceivePayments(params: {
  items: BulkReceiveInvoiceItem[];
  allInvoices: SupabaseInvoice[];
  portalClients: Array<Record<string, any>>;
  paymentMethod: string;
  agentId?: string | null;
  agentName?: string | null;
  collectedByName?: string | null;
  referenceNote?: string;
  activeRouter?: RouterAuthInfo;
  expiryProfileName?: string;
  onProgress?: (current: number, total: number, label: string) => void;
}): Promise<{
  settledInvoicesCount: number;
  totalCollected: number;
  restoredSubscribersCount: number;
  kickedSessions: number;
  errors: string[];
}> {
  const {
    items,
    allInvoices,
    portalClients,
    paymentMethod,
    agentId,
    agentName,
    collectedByName,
    referenceNote,
    activeRouter,
    expiryProfileName,
    onProgress,
  } = params;

  const validItems = items.filter((it) => it.amountToCollect > 0);
  if (validItems.length === 0) {
    return {
      settledInvoicesCount: 0,
      totalCollected: 0,
      restoredSubscribersCount: 0,
      kickedSessions: 0,
      errors: [],
    };
  }

  const nowIso = new Date().toISOString();
  const todayYmd = nowIso.slice(0, 10);
  const errors: string[] = [];

  // Track open balances per subscriber across all invoices so we only auto-restore once balance hits 0
  const openBalanceByUser = new Map<string, number>();
  for (const inv of allInvoices) {
    const uname = String(inv.subscriber_username || '').trim().toLowerCase();
    if (!uname) continue;
    if (String(inv.status || '').toUpperCase() === 'PAID') continue;
    const rem = Math.max(0, (Number(inv.amount) || 0) - (Number(inv.paid_amount) || 0));
    if (rem > 0) {
      openBalanceByUser.set(uname, (openBalanceByUser.get(uname) || 0) + rem);
    }
  }

  // Prefetch live MikroTik profiles, secrets, and active sessions once
  const [profRes, secRes, actRes] = await Promise.all([
    safeMikrotikFetch('/api/mikrotik/ppp/profile', {}, activeRouter).catch(() => null),
    safeMikrotikFetch('/api/mikrotik/ppp/secret', {}, activeRouter).catch(() => null),
    safeMikrotikFetch('/api/mikrotik/ppp/active', {}, activeRouter).catch(() => null),
  ]);
  const rawProfiles = profRes && profRes.ok ? await profRes.json().catch(() => []) : [];
  const preloadedProfiles: string[] = Array.isArray(rawProfiles)
    ? Array.from(new Set(rawProfiles.map((p: any) => String(p?.name || '').trim()).filter(Boolean)))
    : [];
  const rawSecrets = secRes && secRes.ok ? await secRes.json().catch(() => []) : [];
  const preloadedSecrets: Array<Record<string, any>> = Array.isArray(rawSecrets) ? rawSecrets : [];
  const rawActive = actRes && actRes.ok ? await actRes.json().catch(() => []) : [];
  const preloadedActive: Array<Record<string, any>> = Array.isArray(rawActive) ? rawActive : [];

  let settledInvoicesCount = 0;
  let totalCollected = 0;
  const affectedUsers = new Set<string>();

  for (let i = 0; i < validItems.length; i++) {
    const { invoice, amountToCollect } = validItems[i];
    const uname = String(invoice.subscriber_username || '').trim().toLowerCase();
    onProgress?.(i + 1, validItems.length, `@${uname} (${invoice.invoice_no})`);

    try {
      const totalAmount = Number(invoice.amount) || amountToCollect;
      const clientMatch = portalClients.find(
        (c) => String(c.username || '').trim().toLowerCase() === uname
      );
      const anchorDay = clientMatch
        ? computeBillingAnchorDay(clientMatch as any)
        : invoice.cycle_day || new Date().getDate();
      const renewalBase =
        invoice.due_date && invoice.due_date >= todayYmd ? invoice.due_date : new Date();
      const nextDueDate = addCalendarMonthDateString(renewalBase, anchorDay);

      const { error: invErr } = await supabase
        .from('invoices')
        .update({
          status: 'PAID',
          paid_amount: totalAmount,
          paid_at: nowIso,
          cycle_day: anchorDay,
          due_date: nextDueDate,
        })
        .eq('id', invoice.id);

      if (invErr) throw new Error(invErr.message);

      const collectorId = agentId || invoice.assigned_agent_id || null;
      const collectorLabel =
        agentName || collectedByName || invoice.assigned_agent_name || 'NOC Bulk Desk';
      const noteText = `Bulk collection #${invoice.invoice_no} (${paymentMethod})${
        referenceNote ? ` — ${referenceNote}` : ''
      }`;

      await supabase.from('payment_transactions').insert([
        {
          invoice_id: invoice.id,
          subscriber_username: uname,
          collected_by_id: collectorId,
          collected_by_name: collectorLabel,
          amount_paid: amountToCollect,
          payment_mode: paymentMethod,
          payment_date: nowIso,
          notes: noteText,
        },
      ]);

      // Best-effort billing_ledger insert for deployments using unified ledger
      try {
        await supabase.from('billing_ledger').insert([
          {
            invoice_id: invoice.id,
            subscriber_username: uname,
            agent_id: collectorId,
            agent_name: collectorLabel,
            amount: amountToCollect,
            credit: amountToCollect,
            payment_method: paymentMethod,
            notes: noteText,
            created_at: nowIso,
          },
        ]);
      } catch {}

      settledInvoicesCount++;
      totalCollected += amountToCollect;
      if (uname) {
        const remaining = Math.max(0, (openBalanceByUser.get(uname) || 0) - amountToCollect);
        openBalanceByUser.set(uname, remaining);
        affectedUsers.add(uname);
      }
    } catch (err: any) {
      errors.push(`Invoice #${invoice.invoice_no}: ${err?.message || 'Update failed'}`);
    }
  }

  // Credit receiving Field Agent's cash_in_hand & agent_cash_transactions once for totalCollected
  if (agentId && totalCollected > 0) {
    try {
      const { data: agentRow } = await supabase
        .from('portal_users')
        .select('id, cash_in_hand, full_name, username')
        .eq('id', agentId)
        .maybeSingle();

      if (agentRow) {
        const updatedCash = (Number(agentRow.cash_in_hand) || 0) + totalCollected;
        await supabase
          .from('portal_users')
          .update({ cash_in_hand: updatedCash })
          .eq('id', agentRow.id);

        try {
          await supabase.from('agent_cash_transactions').insert([
            {
              agent_id: agentRow.id,
              agent_name: agentRow.full_name || agentName || '',
              agent_username: agentRow.username || '',
              amount: totalCollected,
              transaction_type: 'CASH_COLLECTED',
              received_by: collectedByName || 'Admin NOC',
              notes: `Bulk payment collection (${settledInvoicesCount} invoice${
                settledInvoicesCount === 1 ? '' : 's'
              }, ${paymentMethod})${referenceNote ? ` — ${referenceNote}` : ''}`,
              created_at: nowIso,
            },
          ]);
        } catch {}
      }
    } catch (err: any) {
      errors.push(`Agent cash credit notice: ${err?.message || 'Error'}`);
    }
  }

  // Automatically restore exact MikroTik profile for every subscriber whose balance is now 0
  let restoredSubscribersCount = 0;
  let kickedSessions = 0;
  for (const uname of affectedUsers) {
    const remainingDue = openBalanceByUser.get(uname) ?? 0;
    if (remainingDue > 0) continue;

    const restoreRes = await restoreSubscriberOnInvoicePaid(uname, {
      triggeredBy: agentId ? 'AGENT_PAYMENT_SYNC' : 'ADMIN',
      notes: `Auto-restored on Bulk Receive (${paymentMethod})`,
      expiryProfileName,
      activeRouter,
      preloadedSecrets,
      preloadedProfiles,
      preloadedActive,
    });
    if (restoreRes.success) {
      restoredSubscribersCount++;
      kickedSessions += restoreRes.kickedSessions;
    }
  }

  return {
    settledInvoicesCount,
    totalCollected,
    restoredSubscribersCount,
    kickedSessions,
    errors,
  };
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

/**
 * Inserts into expiry_audit_logs safely, falling back if check constraints haven't migrated
 * new action types (`GRACE_REMOVED`, `SHIFTED_NEXT_MONTH`) yet.
 */
export async function safeInsertExpiryAuditLog(entry: {
  subscriber_id?: string | null;
  username: string;
  action_type: string;
  previous_profile?: string | null;
  applied_profile?: string | null;
  triggered_by?: 'CRON_2PM' | 'ADMIN' | 'AGENT_PAYMENT_SYNC';
  notes?: string | null;
  created_at?: string;
}): Promise<void> {
  try {
    const row = {
      subscriber_id: entry.subscriber_id || null,
      username: String(entry.username || '').trim().toLowerCase(),
      action_type: entry.action_type,
      previous_profile: entry.previous_profile || null,
      applied_profile: entry.applied_profile || null,
      triggered_by: entry.triggered_by || 'ADMIN',
      notes: entry.notes || null,
      created_at: entry.created_at || new Date().toISOString(),
    };
    const { error } = await supabase.from('expiry_audit_logs').insert([row]);
    if (error) {
      const code = String(error.code || '');
      const msg = String(error.message || '').toLowerCase();
      if (code === '23514' || msg.includes('check constraint')) {
        const fallbackType =
          entry.action_type === 'SHIFTED_NEXT_MONTH' ? 'RESTORED_ON_PAYMENT' : 'GRACE_EXTENDED';
        await supabase.from('expiry_audit_logs').insert([
          {
            ...row,
            action_type: fallbackType,
            notes: `[${entry.action_type}] ${row.notes || ''}`.trim(),
          },
        ]);
      }
    }
  } catch {}
}

/**
 * Updates (extends or shortens) a subscriber's grace_until / grace_ends_at timestamp,
 * clears suspension if active, restores MikroTik secret if currently isolated, and writes audit log.
 */
export async function updateSubscriberGracePeriod(params: {
  subscriberId?: string | null;
  username: string;
  graceUntilIso: string;
  note?: string;
  activeRouter?: RouterAuthInfo;
  expiryProfileName?: string;
  preloadedSecrets?: Array<Record<string, any>>;
  preloadedProfiles?: string[];
  preloadedActive?: Array<Record<string, any>>;
}): Promise<{
  success: boolean;
  graceUntilIso: string;
  restoredProfile: string;
  kickedSessions: number;
}> {
  const activeActor = getStoredUser();
  if (activeActor && !hasExplicitAdminGracePermission(activeActor as any)) {
    throw new Error(
      'Blocked: Dealers and Sub-Dealers cannot use Extra Grace to bypass prepaid wallet payment unless explicitly permitted by Admin.'
    );
  }

  const uname = String(params.username || '').trim().toLowerCase();
  const nowIso = new Date().toISOString();
  const expiryProf = params.expiryProfileName || 'EXPIRED-16-POOL';

  const { data: userRow } = await supabase
    .from('portal_users')
    .select('*')
    .ilike('username', uname)
    .limit(1)
    .maybeSingle();

  let subscriberId: string | null = userRow?.id ? String(userRow.id) : null;
  const liveSecret =
    params.preloadedSecrets?.find(
      (s) => String(s?.name || '').trim().toLowerCase() === uname
    ) || null;
  const origCommentPkg = extractOrigPkgFromComment(liveSecret?.comment, expiryProf);
  const restoredProfile = origCommentPkg
    ? resolveExactSubscriberProfile({
        liveSecret: { ...liveSecret, profile: origCommentPkg },
        subscriber: (userRow as any) || { username: uname },
        mikrotikProfiles: params.preloadedProfiles || [],
        expiryProfileName: expiryProf,
      }) || origCommentPkg
    : resolveExactSubscriberProfile({
        liveSecret,
        subscriber: (userRow as any) || { username: uname },
        mikrotikProfiles: params.preloadedProfiles || [],
        expiryProfileName: expiryProf,
      });

  if (subscriberId) {
    await safeUpdatePortalUserFields(
      subscriberId,
      {
        is_suspended: false,
        grace_until: params.graceUntilIso,
        grace_ends_at: params.graceUntilIso,
        billing_status: 'GRACE_PERIOD',
        account_status: 'ACTIVE',
        original_package_profile: restoredProfile,
      },
      {
        grace_ends_at: params.graceUntilIso,
        billing_status: 'GRACE_PERIOD',
        account_status: 'ACTIVE',
        original_package_profile: restoredProfile,
      },
      {
        account_status: 'ACTIVE',
      }
    );
  } else {
    const { data: inserted } = await supabase
      .from('portal_users')
      .insert([
        {
          username: uname,
          password: `Yn@${Math.floor(1000 + Math.random() * 9000)}`,
          role: 'CLIENT',
          full_name: uname,
          phone: '',
          area: 'Saddar Node',
          account_status: 'ACTIVE',
          billing_status: 'GRACE_PERIOD',
          grace_ends_at: params.graceUntilIso,
          original_package_profile: restoredProfile,
          package_profile_name: restoredProfile,
          package_speed: restoredProfile,
        },
      ])
      .select('id')
      .maybeSingle();
    if (inserted?.id) subscriberId = String(inserted.id);
  }

  let kickedSessions = 0;
  const liveProfileStr = String(liveSecret?.profile || '').trim();
  const isIsolatedInMk = Boolean(
    liveSecret &&
      (isExpiryOrBlockedProfile(liveProfileStr, expiryProf) ||
        liveSecret.disabled === 'true' ||
        liveSecret.disabled === true)
  );
  if (isIsolatedInMk || userRow?.is_suspended === true || userRow?.billing_status === 'SUSPENDED_EXPIRED') {
    await syncMikrotikSecretProfile(
      uname,
      restoredProfile,
      { disabled: 'false', preloadedSecret: liveSecret },
      params.activeRouter
    );
    kickedSessions = await kickMikrotikActiveSessionForUser(
      uname,
      params.activeRouter,
      params.preloadedActive
    );
  }

  const noteStr = params.note?.trim()
    ? `[EXTRA_GRACE] Updated grace deadline to ${params.graceUntilIso} — Note: ${params.note.trim()}`
    : `[EXTRA_GRACE] Updated grace deadline to ${params.graceUntilIso}`;

  await safeInsertExpiryAuditLog({
    subscriber_id: subscriberId,
    username: uname,
    action_type: 'GRACE_EXTENDED',
    previous_profile: liveProfileStr || restoredProfile,
    applied_profile: restoredProfile,
    triggered_by: 'ADMIN',
    notes: noteStr,
    created_at: nowIso,
  });

  return {
    success: true,
    graceUntilIso: params.graceUntilIso,
    restoredProfile,
    kickedSessions,
  };
}

/**
 * Removes / Cancels a subscriber's grace period (`grace_until = null`, `grace_ends_at = null`).
 * - If unpaid past-due invoices exist AND subscriber is NOT shifted to next month -> immediately applies expiry rule.
 * - If paid (`unpaidTotal <= 0`) or shifted -> returns subscriber cleanly to ACTIVE and restores MikroTik if needed.
 */
export async function removeSubscriberGracePeriod(params: {
  username: string;
  subscriberId?: string | null;
  allInvoices?: SupabaseInvoice[];
  expiryProfileName?: string;
  suspensionMode?: string;
  activeRouter?: RouterAuthInfo;
  preloadedSecrets?: Array<Record<string, any>>;
  preloadedProfiles?: string[];
  preloadedActive?: Array<Record<string, any>>;
}): Promise<{
  outcome: 'SUSPENDED' | 'RESTORED_ACTIVE';
  unpaidTotal: number;
  kickedSessions: number;
  appliedProfile: string;
}> {
  const uname = String(params.username || '').trim().toLowerCase();
  const nowIso = new Date().toISOString();
  const todayYmd = nowIso.slice(0, 10);
  const expiryProf = params.expiryProfileName || 'EXPIRED-16-POOL';
  const isDisableMode = String(params.suspensionMode || '').toUpperCase() === 'DISABLE_SECRET';

  const [{ data: userRow }, invRes] = await Promise.all([
    supabase
      .from('portal_users')
      .select('*')
      .ilike('username', uname)
      .limit(1)
      .maybeSingle(),
    params.allInvoices
      ? Promise.resolve({ data: params.allInvoices })
      : supabase.from('invoices').select('*').ilike('subscriber_username', uname),
  ]);

  const subscriberId: string | null = userRow?.id
    ? String(userRow.id)
    : params.subscriberId &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(params.subscriberId))
    ? String(params.subscriberId)
    : null;

  const matchingInvoices = ((invRes?.data || []) as SupabaseInvoice[]).filter((inv) => {
    const invUname = String(inv.subscriber_username || '').trim().toLowerCase();
    return invUname === uname || (subscriberId && inv.subscriber_id === subscriberId);
  });

  let unpaidTotal = 0;
  let hasPastDueUnpaid = false;
  let allShifted = true;
  for (const inv of matchingInvoices) {
    const st = String(inv.status || '').toUpperCase();
    if (st === 'PAID' || st === 'CANCELLED') continue;
    const bal = Math.max(0, (Number(inv.amount) || 0) - (Number(inv.paid_amount) || 0));
    if (bal <= 0) continue;
    unpaidTotal += bal;
    if (inv.shifted_to_next_month !== true) allShifted = false;
    const dueYmd = extractYmdString(inv.due_date);
    if (!dueYmd || dueYmd <= todayYmd) hasPastDueUnpaid = true;
  }

  const subNextYmd = extractYmdString((userRow as any)?.next_billing_date);
  const isShiftedExempt = Boolean(
    ((userRow as any)?.shifted_to_next_month === true && (!subNextYmd || todayYmd < subNextYmd)) ||
      (allShifted && unpaidTotal > 0 && !hasPastDueUnpaid)
  );

  const liveSecret =
    params.preloadedSecrets?.find(
      (s) => String(s?.name || '').trim().toLowerCase() === uname
    ) || null;
  const origCommentPkg = extractOrigPkgFromComment(liveSecret?.comment, expiryProf);
  const backupProfile = origCommentPkg
    ? resolveExactSubscriberProfile({
        liveSecret: { ...liveSecret, profile: origCommentPkg },
        subscriber: (userRow as any) || { username: uname },
        mikrotikProfiles: params.preloadedProfiles || [],
        expiryProfileName: expiryProf,
      }) || origCommentPkg
    : resolveExactSubscriberProfile({
        liveSecret,
        subscriber: (userRow as any) || { username: uname },
        mikrotikProfiles: params.preloadedProfiles || [],
        expiryProfileName: expiryProf,
      });

  if (unpaidTotal > 0 && hasPastDueUnpaid && !isShiftedExempt) {
    const origPkgComment = upsertOrigPkgComment(liveSecret?.comment, backupProfile);
    await syncMikrotikSecretProfile(
      uname,
      isDisableMode ? backupProfile : expiryProf,
      {
        disabled: isDisableMode ? 'true' : 'false',
        comment: origPkgComment,
        preloadedSecret: liveSecret,
      },
      params.activeRouter
    );
    const kickedSessions = await kickMikrotikActiveSessionForUser(
      uname,
      params.activeRouter,
      params.preloadedActive
    );

    if (subscriberId) {
      await safeUpdatePortalUserFields(
        subscriberId,
        {
          is_suspended: true,
          billing_status: 'SUSPENDED_EXPIRED',
          account_status: 'EXPIRED',
          grace_until: null,
          grace_ends_at: null,
          suspended_at: nowIso,
          original_package_profile: backupProfile,
        },
        {
          billing_status: 'SUSPENDED_EXPIRED',
          account_status: 'EXPIRED',
          grace_ends_at: null,
          suspended_at: nowIso,
          original_package_profile: backupProfile,
        },
        {
          account_status: 'EXPIRED',
        }
      );
    }

    const appliedProfile = isDisableMode ? 'DISABLED' : expiryProf;
    await safeInsertExpiryAuditLog({
      subscriber_id: subscriberId,
      username: uname,
      action_type: 'GRACE_REMOVED',
      previous_profile: backupProfile,
      applied_profile: appliedProfile,
      triggered_by: 'ADMIN',
      notes: `Grace removed by admin with unpaid balance (Rs. ${Math.round(unpaidTotal).toLocaleString()}) -> immediately suspended (${appliedProfile}), kicked ${kickedSessions} session(s).`,
      created_at: nowIso,
    });

    return {
      outcome: 'SUSPENDED',
      unpaidTotal,
      kickedSessions,
      appliedProfile,
    };
  }

  // Paid or not past-due or shifted -> clear grace & return cleanly to ACTIVE
  if (subscriberId) {
    await safeUpdatePortalUserFields(
      subscriberId,
      {
        is_suspended: false,
        billing_status: 'ACTIVE',
        account_status: 'ACTIVE',
        grace_until: null,
        grace_ends_at: null,
      },
      {
        billing_status: 'ACTIVE',
        account_status: 'ACTIVE',
        grace_ends_at: null,
      },
      {
        account_status: 'ACTIVE',
      }
    );
  }

  let kickedSessions = 0;
  if (
    liveSecret &&
    (isExpiryOrBlockedProfile(liveSecret.profile, expiryProf) ||
      liveSecret.disabled === 'true' ||
      liveSecret.disabled === true)
  ) {
    await syncMikrotikSecretProfile(
      uname,
      backupProfile,
      { disabled: 'false', preloadedSecret: liveSecret },
      params.activeRouter
    );
    kickedSessions = await kickMikrotikActiveSessionForUser(
      uname,
      params.activeRouter,
      params.preloadedActive
    );
  }

  await safeInsertExpiryAuditLog({
    subscriber_id: subscriberId,
    username: uname,
    action_type: 'GRACE_REMOVED',
    previous_profile: liveSecret?.profile || backupProfile,
    applied_profile: backupProfile,
    triggered_by: 'ADMIN',
    notes: `Grace removed by admin -> returned to ACTIVE (${backupProfile}).`,
    created_at: nowIso,
  });

  return {
    outcome: 'RESTORED_ACTIVE',
    unpaidTotal,
    kickedSessions,
    appliedProfile: backupProfile,
  };
}

/**
 * Shifts a subscriber's current unpaid bill & billing cycle to +1 calendar month:
 * - Advances unpaid invoice(s)' `due_date` by +1 calendar month (past today if multi-month overdue),
 *   sets `shifted_to_next_month = true`, and resets `OVERDUE` back to `DUE`.
 * - Advances subscriber's `next_billing_date` (+ `expiry_date`) by +1 calendar month,
 *   sets `shifted_to_next_month = true`, clears `is_suspended = false` and `grace_until = null`.
 * - If currently in `EXPIRED-16-POOL` / `Expire` / disabled, restores their adopted MikroTik PPPoE profile
 *   and kicks any `16.16.16.0/24` session.
 */
export async function shiftBillToNextMonth(params: {
  username: string;
  subscriberId?: string | null;
  targetInvoice?: SupabaseInvoice | null;
  allInvoices?: SupabaseInvoice[];
  activeRouter?: RouterAuthInfo;
  expiryProfileName?: string;
  preloadedSecrets?: Array<Record<string, any>>;
  preloadedProfiles?: string[];
  preloadedActive?: Array<Record<string, any>>;
}): Promise<{
  success: boolean;
  nextDueDate: string;
  updatedInvoicesCount: number;
  restoredMikrotik: boolean;
  kickedSessions: number;
  appliedProfile: string;
}> {
  const activeActor = getStoredUser();
  if (activeActor && !hasExplicitAdminGracePermission(activeActor as any)) {
    throw new Error(
      'Blocked: Dealers and Sub-Dealers cannot use Shift Bill to Next Month to bypass prepaid wallet payment unless explicitly permitted by Admin.'
    );
  }

  const uname = String(params.username || '').trim().toLowerCase();
  const nowIso = new Date().toISOString();
  const todayYmd = nowIso.slice(0, 10);
  const expiryProf = params.expiryProfileName || 'EXPIRED-16-POOL';

  const [{ data: userRow }, invRes] = await Promise.all([
    supabase
      .from('portal_users')
      .select('*')
      .ilike('username', uname)
      .limit(1)
      .maybeSingle(),
    params.targetInvoice
      ? Promise.resolve({ data: [params.targetInvoice] })
      : params.allInvoices
      ? Promise.resolve({ data: params.allInvoices })
      : supabase.from('invoices').select('*').ilike('subscriber_username', uname),
  ]);

  const subscriberId: string | null = userRow?.id
    ? String(userRow.id)
    : params.subscriberId &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(params.subscriberId))
    ? String(params.subscriberId)
    : null;

  const anchorDay = userRow
    ? computeBillingAnchorDay(userRow)
    : params.targetInvoice?.cycle_day || new Date().getDate();

  const advanceNextMonthFutureYmd = (baseRaw?: string | null): string => {
    let candidate = addCalendarMonthsYmd(extractYmdString(baseRaw) || todayYmd, 1, anchorDay);
    let safety = 0;
    while (candidate <= todayYmd && safety < 24) {
      candidate = addCalendarMonthsYmd(candidate, 1, anchorDay);
      safety++;
    }
    return candidate;
  };

  const invoicesToShift = params.targetInvoice
    ? [params.targetInvoice]
    : ((invRes?.data || []) as SupabaseInvoice[]).filter((inv) => {
        const invUname = String(inv.subscriber_username || '').trim().toLowerCase();
        const matchesUser = invUname === uname || (subscriberId && inv.subscriber_id === subscriberId);
        if (!matchesUser) return false;
        const st = String(inv.status || '').toUpperCase();
        const bal = Math.max(0, (Number(inv.amount) || 0) - (Number(inv.paid_amount) || 0));
        return st !== 'PAID' && st !== 'CANCELLED' && bal > 0;
      });

  let updatedInvoicesCount = 0;
  let shiftedInvDueDate = advanceNextMonthFutureYmd(
    params.targetInvoice?.due_date || (userRow as any)?.next_billing_date || userRow?.expiry_date || todayYmd
  );

  for (const inv of invoicesToShift) {
    const nextInvDate = advanceNextMonthFutureYmd(inv.due_date || todayYmd);
    shiftedInvDueDate = nextInvDate;
    const upperSt = String(inv.status || '').toUpperCase();
    const nextStatus = upperSt === 'PARTIAL' ? 'PARTIAL' : 'DUE';

    const { error } = await safeUpdateInvoiceInSupabase(
      { id: inv.id, invoiceNo: inv.invoice_no },
      {
        due_date: nextInvDate,
        status: nextStatus,
        shifted_to_next_month: true,
      }
    );
    if (!error) updatedInvoicesCount++;
  }

  const nextSubscriberBillingDate = advanceNextMonthFutureYmd(
    (userRow as any)?.next_billing_date || userRow?.expiry_date || params.targetInvoice?.due_date || todayYmd
  );
  const finalNextDate =
    shiftedInvDueDate > nextSubscriberBillingDate ? shiftedInvDueDate : nextSubscriberBillingDate;
  const finalExpiryIso = `${finalNextDate}T14:00:00+05:00`;

  const liveSecret =
    params.preloadedSecrets?.find(
      (s) => String(s?.name || '').trim().toLowerCase() === uname
    ) || null;
  const origCommentPkg = extractOrigPkgFromComment(liveSecret?.comment, expiryProf);
  const restoredProfile = origCommentPkg
    ? resolveExactSubscriberProfile({
        liveSecret: { ...liveSecret, profile: origCommentPkg },
        subscriber: (userRow as any) || { username: uname },
        mikrotikProfiles: params.preloadedProfiles || [],
        expiryProfileName: expiryProf,
      }) || origCommentPkg
    : resolveExactSubscriberProfile({
        liveSecret,
        subscriber: (userRow as any) || { username: uname },
        mikrotikProfiles: params.preloadedProfiles || [],
        expiryProfileName: expiryProf,
      });

  if (subscriberId) {
    await safeUpdatePortalUserFields(
      subscriberId,
      {
        shifted_to_next_month: true,
        is_suspended: false,
        grace_until: null,
        grace_ends_at: null,
        billing_status: 'ACTIVE',
        account_status: 'ACTIVE',
        billing_anchor_day: anchorDay,
        next_billing_date: finalNextDate,
        expiry_date: finalExpiryIso,
        last_restored_at: nowIso,
        original_package_profile: restoredProfile,
      },
      {
        billing_status: 'ACTIVE',
        account_status: 'ACTIVE',
        grace_ends_at: null,
        expiry_date: finalExpiryIso,
        last_restored_at: nowIso,
        original_package_profile: restoredProfile,
      },
      {
        account_status: 'ACTIVE',
        expiry_date: finalNextDate,
      }
    );
  }

  let restoredMikrotik = false;
  let kickedSessions = 0;
  const wasSuspended = Boolean(
    userRow?.is_suspended === true ||
      String(userRow?.billing_status || '').toUpperCase() === 'SUSPENDED_EXPIRED' ||
      ['EXPIRED', 'SUSPENDED'].includes(String(userRow?.account_status || '').toUpperCase()) ||
      (liveSecret &&
        (isExpiryOrBlockedProfile(liveSecret.profile, expiryProf) ||
          liveSecret.disabled === 'true' ||
          liveSecret.disabled === true))
  );

  if (wasSuspended) {
    const syncRes = await syncMikrotikSecretProfile(
      uname,
      restoredProfile,
      { disabled: 'false', preloadedSecret: liveSecret },
      params.activeRouter
    );
    restoredMikrotik = syncRes.ok;
    kickedSessions = await kickMikrotikActiveSessionForUser(
      uname,
      params.activeRouter,
      params.preloadedActive
    );
  }

  await safeInsertExpiryAuditLog({
    subscriber_id: subscriberId,
    username: uname,
    action_type: 'SHIFTED_NEXT_MONTH',
    previous_profile: liveSecret?.profile || restoredProfile,
    applied_profile: restoredProfile,
    triggered_by: 'ADMIN',
    notes: `Shifted bill & cycle to next month (${finalNextDate}) · ${updatedInvoicesCount} invoice(s) updated · Exempt from expiry pool${
      wasSuspended ? ` · Restored MikroTik "${restoredProfile}" (kicked ${kickedSessions})` : ''
    }.`,
    created_at: nowIso,
  });

  return {
    success: true,
    nextDueDate: finalNextDate,
    updatedInvoicesCount,
    restoredMikrotik,
    kickedSessions,
    appliedProfile: restoredProfile,
  };
}
