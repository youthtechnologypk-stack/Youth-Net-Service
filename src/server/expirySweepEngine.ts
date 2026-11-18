import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { dispatchOutboundWhatsAppReply, normalizeToPlus92 } from './whatsappBotEngine';
import { resolveRouterRestTarget } from './sessionGeneratorEngine';
import {
  DEFAULT_ISP_BILLING_SETTINGS,
  IspBillingSettingsRecord,
  buildBilingualPaymentSlip,
  isMissingTableOrColumnError,
  loadBillingSettingsFromDb,
  parseExpiryDateWithCutoffMs,
} from '../lib/expiryUtils';
import { resolveSubscriberAnniversaryNextDue } from '../lib/anniversaryBilling';
import {
  resolveExactSubscriberProfile,
  upsertOrigPkgComment,
} from '../lib/mikrotikProfileSync';

export {
  DEFAULT_ISP_BILLING_SETTINGS,
  buildBilingualPaymentSlip,
  isMissingTableOrColumnError,
  loadBillingSettingsFromDb,
  parseExpiryDateWithCutoffMs,
};
export type { IspBillingSettingsRecord };

const DEFAULT_SUPABASE_URL = 'https://qstqegwpibztpirncpga.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_Ce_QIF3wHFISjJtTiYGY-Q_qs6miPTU';

export interface MikrotikApiAdapter {
  getSecrets(): Promise<Array<Record<string, any>>>;
  getProfiles?(): Promise<Array<Record<string, any>>>;
  getActiveSessions(): Promise<Array<Record<string, any>>>;
  patchSecret(secretId: string, body: Record<string, any>): Promise<boolean>;
  kickActiveSession(activeId: string): Promise<boolean>;
}

export interface ExpirySweepOptions {
  supabaseClient?: SupabaseClient;
  mikrotikAdapter?: MikrotikApiAdapter;
  routerHost?: string;
  routerPort?: number;
  useSsl?: boolean;
  authHeader?: string;
  username?: string;
  password?: string;
  triggeredBy?: 'CRON_2PM' | 'ADMIN' | 'AGENT_PAYMENT_SYNC';
  nowMs?: number;
  skipExternalWhatsapp?: boolean;
}

export interface ExpirySweepResult {
  success: boolean;
  scanned: number;
  remindersSent: number;
  enteredGrace: number;
  suspendedTo16Pool: number;
  disabledSecrets: number;
  kickedActiveSessions: number;
  skippedPaid: number;
  restoredPaid?: number;
  errors: string[];
  schemaWarnings: string[];
  durationMs: number;
  timestamp: string;
}

export function getServerSupabase(): SupabaseClient {
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

export function createMikrotikRestAdapter(options: ExpirySweepOptions): MikrotikApiAdapter {
  const target = resolveRouterRestTarget(options);
  const baseUrl = `${target.protocol}://${target.host}:${target.port}/rest`;

  const doFetch = async (path: string, init: RequestInit = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6500);
    try {
      const res = await fetch(`${baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: target.authHeader,
          Connection: 'close',
          ...(init.headers || {}),
        },
      });
      return res;
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    async getSecrets() {
      const res = await doFetch('/ppp/secret?.proplist=.id,name,profile,disabled,comment');
      if (res.ok) {
        const json = await res.json();
        return Array.isArray(json) ? json : [];
      }
      const fallback = await doFetch('/ppp/secret');
      if (!fallback.ok) return [];
      const json = await fallback.json();
      return Array.isArray(json) ? json : [];
    },
    async getProfiles() {
      const res = await doFetch('/ppp/profile?.proplist=.id,name,rate-limit');
      if (res.ok) {
        const json = await res.json();
        return Array.isArray(json) ? json : [];
      }
      const fallback = await doFetch('/ppp/profile');
      if (!fallback.ok) return [];
      const json = await fallback.json();
      return Array.isArray(json) ? json : [];
    },
    async getActiveSessions() {
      const res = await doFetch('/ppp/active?.proplist=.id,name,address');
      if (res.ok) {
        const json = await res.json();
        return Array.isArray(json) ? json : [];
      }
      const fallback = await doFetch('/ppp/active');
      if (!fallback.ok) return [];
      const json = await fallback.json();
      return Array.isArray(json) ? json : [];
    },
    async patchSecret(secretId: string, body: Record<string, any>) {
      const res = await doFetch(`/ppp/secret/${encodeURIComponent(secretId)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      if (res.ok) return true;
      const setRes = await doFetch('/ppp/secret/set', {
        method: 'POST',
        body: JSON.stringify({ '.id': secretId, numbers: secretId, ...body }),
      });
      return setRes.ok;
    },
    async kickActiveSession(activeId: string) {
      const res = await doFetch(`/ppp/active/${encodeURIComponent(activeId)}`, {
        method: 'DELETE',
      });
      if (res.ok) return true;
      const remRes = await doFetch('/ppp/active/remove', {
        method: 'POST',
        body: JSON.stringify({ '.id': activeId, numbers: activeId }),
      });
      return remRes.ok;
    },
  };
}

async function safeUpdateSubscriber(
  supabase: SupabaseClient,
  subscriberId: string,
  fullPatch: Record<string, any>,
  existingMigrationPatch: Record<string, any>,
  corePatch: Record<string, any>,
  schemaWarnings: Set<string>
): Promise<void> {
  const { error } = await supabase
    .from('portal_users')
    .update(fullPatch)
    .eq('id', subscriberId);

  if (error) {
    if (isMissingTableOrColumnError(error)) {
      schemaWarnings.add(
        'portal_users missing one or more expiry automation columns (run SQL migration 20261114_expiry_grace_automation.sql).'
      );
      if (Object.keys(existingMigrationPatch).length > 0) {
        const res2 = await supabase
          .from('portal_users')
          .update(existingMigrationPatch)
          .eq('id', subscriberId);
        if (!res2.error) return;
      }
      if (Object.keys(corePatch).length > 0) {
        await supabase.from('portal_users').update(corePatch).eq('id', subscriberId);
      }
    } else {
      throw new Error(`Subscriber update error: ${error.message}`);
    }
  }
}

async function safeInsertAuditLog(
  supabase: SupabaseClient,
  entry: {
    subscriber_id?: string | null;
    username: string;
    action_type: string;
    previous_profile?: string | null;
    applied_profile?: string | null;
    triggered_by: string;
    notes?: string | null;
    created_at?: string;
  },
  schemaWarnings: Set<string>
): Promise<void> {
  const { error } = await supabase.from('expiry_audit_logs').insert([
    {
      ...entry,
      created_at: entry.created_at || new Date().toISOString(),
    },
  ]);
  if (error && isMissingTableOrColumnError(error)) {
    schemaWarnings.add('Table expiry_audit_logs not found in Supabase (run SQL migration).');
  }
}

async function safeInsertWhatsappReminderLog(
  supabase: SupabaseClient,
  entry: {
    subscriber_id?: string | null;
    username: string;
    phone?: string | null;
    message_body: string;
    amount_due: number;
    expiry_date?: string | null;
    status: 'QUEUED' | 'SENT' | 'FAILED';
    created_at?: string;
  },
  schemaWarnings: Set<string>
): Promise<void> {
  const { error } = await supabase.from('whatsapp_reminder_logs').insert([
    {
      ...entry,
      created_at: entry.created_at || new Date().toISOString(),
    },
  ]);
  if (error && isMissingTableOrColumnError(error)) {
    schemaWarnings.add('Table whatsapp_reminder_logs not found in Supabase (run SQL migration).');
  }
}

async function ensurePortalClientForSuspension(
  supabase: SupabaseClient,
  uname: string,
  backupProfile: string,
  amountDue: number,
  rawExpiry: string | null,
  schemaWarnings: Set<string>
): Promise<string | null> {
  const { data: existing } = await supabase
    .from('portal_users')
    .select('id')
    .ilike('username', uname)
    .limit(1)
    .maybeSingle();

  if (existing?.id) return String(existing.id);

  const basePayload = {
    username: uname,
    password: `Yn@${Math.floor(1000 + Math.random() * 9000)}`,
    role: 'CLIENT',
    full_name: uname,
    phone: '',
    area: 'Saddar Node',
    account_status: 'ACTIVE',
    billing_status: 'ACTIVE',
    package_speed: backupProfile,
    package_profile_name: backupProfile,
    original_package_profile: backupProfile,
    monthly_fee: amountDue,
    expiry_date: rawExpiry ? `${String(rawExpiry).slice(0, 10)}T14:00:00+05:00` : null,
  };

  const { data: inserted, error } = await supabase
    .from('portal_users')
    .insert([basePayload])
    .select('id')
    .maybeSingle();

  if (error) {
    if (isMissingTableOrColumnError(error)) {
      schemaWarnings.add('portal_users missing expiry columns during invoice-user sync.');
      const { data: minimal } = await supabase
        .from('portal_users')
        .insert([
          {
            username: uname,
            password: basePayload.password,
            role: 'CLIENT',
            full_name: uname,
            phone: '',
            area: 'Saddar Node',
            account_status: 'ACTIVE',
          },
        ])
        .select('id')
        .maybeSingle();
      return minimal?.id ? String(minimal.id) : null;
    }
    return null;
  }

  return inserted?.id ? String(inserted.id) : null;
}

/**
 * Full-Stack Automated Expiry, 2:00 PM PKT Cut-Off, Grace / Extra Grace Period & 16.16.16.0/24 Sweep Engine.
 */
export async function runExpirySweep(
  options: ExpirySweepOptions = {}
): Promise<ExpirySweepResult> {
  const startedAt = Date.now();
  const nowMs = options.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const triggeredBy = options.triggeredBy || 'CRON_2PM';
  const supabase = options.supabaseClient || getServerSupabase();
  const mk = options.mikrotikAdapter || createMikrotikRestAdapter(options);

  const errors: string[] = [];
  const schemaWarningsSet = new Set<string>();

  let remindersSent = 0;
  let enteredGrace = 0;
  let suspendedTo16Pool = 0;
  let disabledSecrets = 0;
  let kickedActiveSessions = 0;
  let skippedPaid = 0;
  let restoredPaid = 0;
  const todayYmd = new Date(nowMs).toISOString().slice(0, 10);

  // 1. Load persistent settings, subscribers, and invoices from Supabase
  const [{ settings, waConfig, tableExists }, clientsRes, invoicesRes] = await Promise.all([
    loadBillingSettingsFromDb(supabase),
    supabase.from('portal_users').select('*').eq('role', 'CLIENT'),
    supabase.from('invoices').select('*').neq('status', 'PAID'),
  ]);

  if (!tableExists) {
    schemaWarningsSet.add('Table isp_billing_settings not found in Supabase (using defaults/fallback config).');
  }

  if (clientsRes.error) {
    return {
      success: false,
      scanned: 0,
      remindersSent: 0,
      enteredGrace: 0,
      suspendedTo16Pool: 0,
      disabledSecrets: 0,
      kickedActiveSessions: 0,
      skippedPaid: 0,
      restoredPaid: 0,
      errors: [`Supabase query failed: ${clientsRes.error.message}`],
      schemaWarnings: Array.from(schemaWarningsSet),
      durationMs: Date.now() - startedAt,
      timestamp: nowIso,
    };
  }

  const dbSubscribers = (clientsRes.data || []) as Array<Record<string, any>>;
  const openInvoices = (invoicesRes.data || []) as Array<Record<string, any>>;

  const usernameBySubId = new Map<string, string>();
  for (const s of dbSubscribers) {
    const u = String(s?.username || '').trim().toLowerCase();
    if (s?.id && u) usernameBySubId.set(String(s.id), u);
  }

  // Index open unpaid dues per lowercase username (matching subscriber_id or subscriber_username)
  const unpaidByUser = new Map<
    string,
    { totalDue: number; earliestDueDate: string | null; allShiftedNextMonth: boolean }
  >();
  for (const inv of openInvoices) {
    const matchedFromId = inv?.subscriber_id ? usernameBySubId.get(String(inv.subscriber_id)) : undefined;
    const uname = matchedFromId || String(inv?.subscriber_username || '').trim().toLowerCase();
    if (!uname) continue;
    const st = String(inv?.status || '').toUpperCase();
    if (st === 'PAID' || st === 'CANCELLED') continue;
    const bal = Math.max(0, (Number(inv.amount) || 0) - (Number(inv.paid_amount) || 0));
    if (bal <= 0) continue;
    const prev = unpaidByUser.get(uname) || {
      totalDue: 0,
      earliestDueDate: null,
      allShiftedNextMonth: true,
    };
    prev.totalDue += bal;
    if (inv.shifted_to_next_month !== true) {
      prev.allShiftedNextMonth = false;
    }
    if (inv.due_date && (!prev.earliestDueDate || String(inv.due_date) < prev.earliestDueDate)) {
      prev.earliestDueDate = String(inv.due_date);
    }
    unpaidByUser.set(uname, prev);
  }

  // Merge portal_users (CLIENT) + invoice-only subscribers with unpaid dues
  const candidatesByUser = new Map<string, { sub: Record<string, any>; isSynthetic: boolean }>();
  for (const sub of dbSubscribers) {
    const uname = String(sub.username || '').trim().toLowerCase();
    if (!uname) continue;
    candidatesByUser.set(uname, { sub, isSynthetic: false });
  }
  for (const [uname, unpaid] of unpaidByUser.entries()) {
    if (candidatesByUser.has(uname) || unpaid.totalDue <= 0) continue;
    candidatesByUser.set(uname, {
      isSynthetic: true,
      sub: {
        id: null,
        username: uname,
        full_name: uname,
        role: 'CLIENT',
        account_status: 'ACTIVE',
        billing_status: 'ACTIVE',
        is_suspended: false,
        shifted_to_next_month: unpaid.allShiftedNextMonth,
        monthly_fee: unpaid.totalDue,
        expiry_date: unpaid.earliestDueDate,
        next_billing_date: unpaid.earliestDueDate,
      },
    });
  }

  // Lazy-fetch MikroTik secrets, profiles & active sessions once
  let cachedMikrotik: {
    secretsCache: Map<string, Record<string, any>>;
    activeCache: Map<string, Array<Record<string, any>>>;
    profileNames: string[];
  } | null = null;

  const ensureMikrotikCaches = async () => {
    if (cachedMikrotik) return cachedMikrotik;
    const [secretsList, activeList, profilesList] = await Promise.all([
      mk.getSecrets().catch(() => []),
      mk.getActiveSessions().catch(() => []),
      mk.getProfiles ? mk.getProfiles().catch(() => []) : Promise.resolve([]),
    ]);
    const secretsCache = new Map<string, Record<string, any>>();
    for (const s of secretsList) {
      const key = String(s?.name || '').trim().toLowerCase();
      if (key) secretsCache.set(key, s);
    }
    const activeCache = new Map<string, Array<Record<string, any>>>();
    for (const a of activeList) {
      const key = String(a?.name || '').trim().toLowerCase();
      if (!key) continue;
      const arr = activeCache.get(key) || [];
      arr.push(a);
      activeCache.set(key, arr);
    }
    const profileNames = Array.from(
      new Set(
        (profilesList || [])
          .map((p: any) => String(p?.name || '').trim())
          .filter(Boolean)
      )
    );
    cachedMikrotik = { secretsCache, activeCache, profileNames };
    return cachedMikrotik;
  };

  // Pre-warm MikroTik cache once so paid users stuck in EXPIRED-16-POOL are detected & restored
  const mkCaches = await ensureMikrotikCaches().catch(() => null);

  const graceHours = Math.max(0, Number(settings.grace_hours) || 24);
  const threeDaysMs = 3 * 86_400_000;
  const supportWhatsapp = waConfig?.support_whatsapp || '+923234193599';
  const isDisableMode =
    String(settings.suspension_mode || '').toUpperCase() === 'DISABLE_SECRET';
  const expiryProfileLower = String(settings.expiry_ppp_profile || 'EXPIRED-16-POOL')
    .trim()
    .toLowerCase();

  const isExpiredMkProfileName = (prof?: string | null) => {
    const p = String(prof || '').trim().toLowerCase();
    return Boolean(
      p &&
        (p === expiryProfileLower ||
          p === 'expire' ||
          p === 'expired' ||
          p.includes('expired') ||
          p.includes('16-pool') ||
          p.includes('walled'))
    );
  };

  for (const [uname, entry] of candidatesByUser.entries()) {
    const { sub, isSynthetic } = entry;
    const unpaidInfo = unpaidByUser.get(uname);
    const dueAmount = unpaidInfo?.totalDue || 0;

    const billingStatus = String(sub.billing_status || '').toUpperCase();
    const accountStatus = String(sub.account_status || 'ACTIVE').toUpperCase();
    const isDbSuspended =
      sub.is_suspended === true ||
      billingStatus === 'SUSPENDED_EXPIRED' ||
      accountStatus === 'EXPIRED' ||
      accountStatus === 'SUSPENDED';

    const liveSecForCheck = mkCaches?.secretsCache.get(uname);
    const liveActiveForCheck = mkCaches?.activeCache.get(uname) || [];
    const isMkSuspended = Boolean(
      (liveSecForCheck &&
        (isExpiredMkProfileName(liveSecForCheck.profile) ||
          liveSecForCheck.disabled === 'true' ||
          liveSecForCheck.disabled === true)) ||
        liveActiveForCheck.some((a) => String(a?.address || '').startsWith('16.16.16.'))
    );

    // -----------------------------------------------------------------------
    // STAGE 0: Auto-Restore Paid Subscribers (dueAmount <= 0 yet still suspended)
    // -----------------------------------------------------------------------
    if (dueAmount <= 0 && (isDbSuspended || isMkSuspended)) {
      try {
        const restoreProfile = resolveExactSubscriberProfile({
          liveSecret: liveSecForCheck,
          subscriber: sub as any,
          mikrotikProfiles: mkCaches?.profileNames || [],
          expiryProfileName: settings.expiry_ppp_profile,
        });
        const secretId = String(liveSecForCheck?.['.id'] || liveSecForCheck?.id || '').trim();
        if (secretId && isMkSuspended) {
          await mk.patchSecret(secretId, {
            profile: restoreProfile,
            disabled: 'false',
          });
        }
        for (const sess of liveActiveForCheck) {
          const activeId = String(sess?.['.id'] || sess?.id || '').trim();
          if (activeId) {
            const kicked = await mk.kickActiveSession(activeId);
            if (kicked) kickedActiveSessions++;
          }
        }
        if (!isSynthetic && sub.id) {
          await safeUpdateSubscriber(
            supabase,
            String(sub.id),
            {
              is_suspended: false,
              billing_status: 'ACTIVE',
              account_status: 'ACTIVE',
              grace_until: null,
              grace_ends_at: null,
              last_restored_at: nowIso,
              original_package_profile: restoreProfile,
              package_name: restoreProfile,
              package_profile_name: restoreProfile,
            },
            {
              billing_status: 'ACTIVE',
              account_status: 'ACTIVE',
              grace_ends_at: null,
              last_restored_at: nowIso,
              original_package_profile: restoreProfile,
              package_profile_name: restoreProfile,
            },
            {
              account_status: 'ACTIVE',
              package_profile_name: restoreProfile,
            },
            schemaWarningsSet
          );
          await safeInsertAuditLog(
            supabase,
            {
              subscriber_id: String(sub.id),
              username: uname,
              action_type: 'RESTORED_ON_PAYMENT',
              previous_profile: liveSecForCheck?.profile || settings.expiry_ppp_profile,
              applied_profile: restoreProfile,
              triggered_by: triggeredBy,
              notes: `Auto-restored zero-due paid subscriber during expiry sweep -> "${restoreProfile}".`,
              created_at: nowIso,
            },
            schemaWarningsSet
          );
        }
        restoredPaid++;
      } catch (err: any) {
        errors.push(`Auto-restore error for paid user @${uname}: ${err?.message || 'Unknown error'}`);
      }
      skippedPaid++;
      continue;
    }

    const { nextBillingDate } = resolveSubscriberAnniversaryNextDue(sub, [], new Date(nowMs));
    const subNextDue = sub.next_billing_date ? String(sub.next_billing_date).slice(0, 10) : null;

    // -----------------------------------------------------------------------
    // STAGE 0B: Exempt "Shifted to Next Month" or future next_billing_date subscribers
    // -----------------------------------------------------------------------
    const isShiftedNextMonth = Boolean(
      (sub.shifted_to_next_month === true && (!subNextDue || todayYmd < subNextDue)) ||
        (unpaidInfo?.allShiftedNextMonth && (!unpaidInfo.earliestDueDate || todayYmd < unpaidInfo.earliestDueDate))
    );
    const hasFutureNextBillingOnly = Boolean(
      subNextDue &&
        todayYmd < subNextDue &&
        (!unpaidInfo?.earliestDueDate || unpaidInfo.earliestDueDate > todayYmd)
    );
    if (isShiftedNextMonth || hasFutureNextBillingOnly) {
      skippedPaid++;
      continue;
    }

    const rawExpiry =
      unpaidInfo?.earliestDueDate && (!subNextDue || unpaidInfo.earliestDueDate < subNextDue)
        ? unpaidInfo.earliestDueDate
        : subNextDue || sub.expiry_date || nextBillingDate || null;
    const expiryMs = parseExpiryDateWithCutoffMs(rawExpiry, settings.cutoff_time_pkt);

    const explicitGraceStr = (sub as any).grace_until || sub.grace_ends_at || null;
    const explicitGraceMs = explicitGraceStr ? Date.parse(String(explicitGraceStr)) : NaN;
    const hasExplicitFutureGrace = !Number.isNaN(explicitGraceMs) && explicitGraceMs > nowMs;

    if (!expiryMs && Number.isNaN(explicitGraceMs)) {
      skippedPaid++;
      continue;
    }

    const amountDue = dueAmount > 0 ? dueAmount : Number(sub.monthly_fee) || 2500;

    // -----------------------------------------------------------------------
    // STAGE 1: 3-Day Advance Reminder (now < expiry && expiry <= now + 3 days)
    // -----------------------------------------------------------------------
    if (expiryMs && nowMs < expiryMs && expiryMs <= nowMs + threeDaysMs && !hasExplicitFutureGrace) {
      if (billingStatus === 'SUSPENDED_EXPIRED' || billingStatus === 'GRACE_PERIOD') {
        continue;
      }
      if (!isSynthetic && sub.id) {
        const cycleKey = new Date(expiryMs).toISOString().slice(0, 7);
        if (sub.last_reminder_cycle === cycleKey || billingStatus === 'REMINDER_SENT') {
          continue;
        }

        const packageLabel = String(
          sub.package_speed || sub.package_profile_name || sub.original_package_profile || 'Fiber Broadband'
        );
        const expiryDateLabel = new Date(expiryMs).toISOString().slice(0, 10);
        const slipText = buildBilingualPaymentSlip({
          fullName: String(sub.full_name || sub.username),
          username: uname,
          packageLabel,
          amountDue,
          expiryDateLabel,
          settings,
          supportWhatsapp,
        });

        let sendStatus: 'QUEUED' | 'SENT' | 'FAILED' = 'QUEUED';
        if (!options.skipExternalWhatsapp && sub.phone && waConfig) {
          try {
            const normalizedPhone = normalizeToPlus92(sub.phone);
            const provider = waConfig.phone_number_id ? 'meta' : 'ultramsg';
            const sent = await dispatchOutboundWhatsAppReply(
              provider,
              normalizedPhone,
              slipText,
              waConfig
            );
            if (sent) sendStatus = 'SENT';
          } catch {
            sendStatus = 'FAILED';
          }
        }

        await safeInsertWhatsappReminderLog(
          supabase,
          {
            subscriber_id: sub.id,
            username: uname,
            phone: sub.phone || null,
            message_body: slipText,
            amount_due: amountDue,
            expiry_date: new Date(expiryMs).toISOString(),
            status: sendStatus,
            created_at: nowIso,
          },
          schemaWarningsSet
        );

        await safeUpdateSubscriber(
          supabase,
          sub.id,
          {
            billing_status: 'REMINDER_SENT',
            last_reminder_cycle: cycleKey,
          },
          {
            billing_status: 'REMINDER_SENT',
            last_reminder_cycle: cycleKey,
          },
          {},
          schemaWarningsSet
        );

        await safeInsertAuditLog(
          supabase,
          {
            subscriber_id: sub.id,
            username: uname,
            action_type: 'REMINDER_3D',
            previous_profile: sub.original_package_profile || sub.package_profile_name || null,
            applied_profile: sub.package_profile_name || null,
            triggered_by: triggeredBy,
            notes: `3-Day advance payment slip (${sendStatus}) for cycle ${cycleKey}, due ${expiryDateLabel}`,
            created_at: nowIso,
          },
          schemaWarningsSet
        );

        remindersSent++;
      }
      continue;
    }

    // -----------------------------------------------------------------------
    // STAGE 2: Grace / Extra Grace Window (now < graceEndsMs)
    // -----------------------------------------------------------------------
    const graceEndsMs = !Number.isNaN(explicitGraceMs)
      ? explicitGraceMs
      : (expiryMs ?? nowMs) + graceHours * 3_600_000;

    if ((expiryMs && nowMs >= expiryMs && nowMs < graceEndsMs) || hasExplicitFutureGrace) {
      if (billingStatus === 'GRACE_PERIOD' || billingStatus === 'SUSPENDED_EXPIRED') {
        continue;
      }
      if (dueAmount <= 0) {
        skippedPaid++;
        continue;
      }

      const graceEndsIso = new Date(graceEndsMs).toISOString();
      if (!isSynthetic && sub.id) {
        await safeUpdateSubscriber(
          supabase,
          sub.id,
          {
            billing_status: 'GRACE_PERIOD',
            is_suspended: false,
            grace_until: graceEndsIso,
            grace_ends_at: graceEndsIso,
          },
          {
            billing_status: 'GRACE_PERIOD',
            grace_ends_at: graceEndsIso,
          },
          {},
          schemaWarningsSet
        );

        await safeInsertAuditLog(
          supabase,
          {
            subscriber_id: sub.id,
            username: uname,
            action_type: 'ENTERED_GRACE',
            previous_profile: sub.package_profile_name || sub.package_speed || null,
            applied_profile: sub.package_profile_name || sub.package_speed || null,
            triggered_by: triggeredBy,
            notes: `Entered ${graceHours}h grace period after ${settings.cutoff_time_pkt} PKT cut-off; ends ${graceEndsIso}`,
            created_at: nowIso,
          },
          schemaWarningsSet
        );
      }

      enteredGrace++;
      continue;
    }

    // -----------------------------------------------------------------------
    // STAGE 3: Post-Grace Auto-Expiry Suspension (now >= graceEndsMs AND due_amount > 0)
    // -----------------------------------------------------------------------
    if (nowMs >= graceEndsMs) {
      if (dueAmount <= 0) {
        skippedPaid++;
        continue;
      }

      try {
        const { secretsCache, activeCache, profileNames } = await ensureMikrotikCaches();
        const liveSecret = secretsCache.get(uname);
        const secretId = String(liveSecret?.['.id'] || liveSecret?.id || '').trim();
        const liveProfile = String(liveSecret?.profile || '').trim();
        const isLiveDisabled = liveSecret?.disabled === 'true' || liveSecret?.disabled === true;
        const activeSessionsForUser = activeCache.get(uname) || [];
        const hasNon16Session = activeSessionsForUser.some(
          (sess) => !String(sess?.address || '').startsWith('16.16.16.')
        );

        const isDbMarkedSuspended =
          Boolean((sub as any).is_suspended === true) ||
          (billingStatus === 'SUSPENDED_EXPIRED' && accountStatus === 'EXPIRED');
        const isMkAlreadyIsolated = !liveSecret
          ? true
          : isDisableMode
          ? isLiveDisabled
          : liveProfile.toLowerCase() === expiryProfileLower && !hasNon16Session;

        if (isDbMarkedSuspended && isMkAlreadyIsolated) {
          continue;
        }

        // Adopt exact live MikroTik profile (never guess/hardcode "20Mbps")
        const backupProfile = resolveExactSubscriberProfile({
          liveSecret,
          subscriber: sub as any,
          mikrotikProfiles: profileNames,
          expiryProfileName: settings.expiry_ppp_profile,
        });
        const origPkgComment = upsertOrigPkgComment(liveSecret?.comment, backupProfile);

        // Ensure subscriber row exists in portal_users and back up exact original_package_profile BEFORE altering MikroTik
        let subscriberId: string | null = sub.id ? String(sub.id) : null;
        if (!subscriberId) {
          subscriberId = await ensurePortalClientForSuspension(
            supabase,
            uname,
            backupProfile,
            amountDue,
            rawExpiry,
            schemaWarningsSet
          );
        } else {
          await safeUpdateSubscriber(
            supabase,
            subscriberId,
            {
              original_package_profile: backupProfile,
              package_name: backupProfile,
              package_profile_name: backupProfile,
            },
            {
              original_package_profile: backupProfile,
              package_profile_name: backupProfile,
            },
            { package_profile_name: backupProfile },
            schemaWarningsSet
          );
        }

        if (secretId) {
          const patchPayload = isDisableMode
            ? { disabled: 'true', comment: origPkgComment }
            : {
                profile: settings.expiry_ppp_profile,
                disabled: 'false',
                comment: origPkgComment,
              };
          const patched = await mk.patchSecret(secretId, patchPayload);
          if (!patched) {
            errors.push(`MikroTik secret patch failed for @${uname}`);
          }
        } else {
          errors.push(`No MikroTik /ppp/secret found for @${uname}`);
        }

        // Kick active PPPoE session so CPE drops & redials into 16.16.16.0/24 immediately
        for (const sess of activeSessionsForUser) {
          const activeId = String(sess?.['.id'] || sess?.id || '').trim();
          if (activeId) {
            const kicked = await mk.kickActiveSession(activeId);
            if (kicked) kickedActiveSessions++;
          }
        }

        if (subscriberId) {
          await safeUpdateSubscriber(
            supabase,
            subscriberId,
            {
              is_suspended: true,
              billing_status: 'SUSPENDED_EXPIRED',
              account_status: 'EXPIRED',
              suspended_at: nowIso,
              grace_until: null,
              grace_ends_at: null,
              original_package_profile: backupProfile,
            },
            {
              billing_status: 'SUSPENDED_EXPIRED',
              account_status: 'EXPIRED',
              suspended_at: nowIso,
              grace_ends_at: null,
              original_package_profile: backupProfile,
            },
            {
              account_status: 'EXPIRED',
              package_profile_name: backupProfile,
            },
            schemaWarningsSet
          );
        }

        await safeInsertAuditLog(
          supabase,
          {
            subscriber_id: subscriberId,
            username: uname,
            action_type: isDisableMode ? 'DISABLED_SECRET' : 'SUSPENDED_16_POOL',
            previous_profile: backupProfile,
            applied_profile: isDisableMode ? 'DISABLED' : settings.expiry_ppp_profile,
            triggered_by: triggeredBy,
            notes: `Auto-expiry after grace deadline (Due: Rs. ${Math.round(amountDue).toLocaleString()}). ${
              isDisableMode
                ? 'PPPoE Secret Disabled'
                : `Shifted MikroTik secret to ${settings.expiry_ppp_profile} (16.16.16.0/24)`
            }. Active sessions kicked: ${activeSessionsForUser.length}.`,
            created_at: nowIso,
          },
          schemaWarningsSet
        );

        if (isDisableMode) disabledSecrets++;
        else suspendedTo16Pool++;
      } catch (err: any) {
        errors.push(`Suspension error for @${uname}: ${err?.message || 'Unknown error'}`);
      }
    } else {
      skippedPaid++;
    }
  }

  return {
    success: true,
    scanned: candidatesByUser.size,
    remindersSent,
    enteredGrace,
    suspendedTo16Pool,
    disabledSecrets,
    kickedActiveSessions,
    skippedPaid,
    restoredPaid,
    errors,
    schemaWarnings: Array.from(schemaWarningsSet),
    durationMs: Date.now() - startedAt,
    timestamp: nowIso,
  };
}
