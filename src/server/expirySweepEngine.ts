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
      const res = await doFetch('/ppp/secret?.proplist=.id,name,profile,disabled');
      if (res.ok) {
        const json = await res.json();
        return Array.isArray(json) ? json : [];
      }
      const fallback = await doFetch('/ppp/secret');
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

/**
 * Full-Stack Automated Expiry, 2:00 PM PKT Cut-Off, 24h Grace Period & 16.16.16.0/24 Sweep Engine.
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
      errors: [`Supabase query failed: ${clientsRes.error.message}`],
      schemaWarnings: Array.from(schemaWarningsSet),
      durationMs: Date.now() - startedAt,
      timestamp: nowIso,
    };
  }

  const subscribers = (clientsRes.data || []) as Array<Record<string, any>>;
  const openInvoices = (invoicesRes.data || []) as Array<Record<string, any>>;

  // Index open unpaid dues per lowercase username
  const unpaidByUser = new Map<string, { totalDue: number; earliestDueDate: string | null }>();
  for (const inv of openInvoices) {
    const uname = String(inv?.subscriber_username || '').trim().toLowerCase();
    if (!uname) continue;
    const bal = Math.max(0, (Number(inv.amount) || 0) - (Number(inv.paid_amount) || 0));
    if (bal <= 0) continue;
    const prev = unpaidByUser.get(uname) || { totalDue: 0, earliestDueDate: null };
    prev.totalDue += bal;
    if (inv.due_date && (!prev.earliestDueDate || inv.due_date < prev.earliestDueDate)) {
      prev.earliestDueDate = String(inv.due_date);
    }
    unpaidByUser.set(uname, prev);
  }

  // Lazy-fetch MikroTik secrets & active sessions once only if needed for suspensions
  let cachedMikrotik: {
    secretsCache: Map<string, Record<string, any>>;
    activeCache: Map<string, Array<Record<string, any>>>;
  } | null = null;

  const ensureMikrotikCaches = async () => {
    if (cachedMikrotik) return cachedMikrotik;
    const [secretsList, activeList] = await Promise.all([
      mk.getSecrets().catch(() => []),
      mk.getActiveSessions().catch(() => []),
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
    cachedMikrotik = { secretsCache, activeCache };
    return cachedMikrotik;
  };

  const graceHours = Math.max(0, Number(settings.grace_hours) || 24);
  const threeDaysMs = 3 * 86_400_000;
  const supportWhatsapp = waConfig?.support_whatsapp || '+923234193599';

  for (const sub of subscribers) {
    const uname = String(sub.username || '').trim().toLowerCase();
    if (!uname) continue;

    const unpaidInfo = unpaidByUser.get(uname);
    const rawExpiry = sub.expiry_date || unpaidInfo?.earliestDueDate || null;
    const expiryMs = parseExpiryDateWithCutoffMs(rawExpiry, settings.cutoff_time_pkt);

    if (!expiryMs) {
      skippedPaid++;
      continue;
    }

    const billingStatus = String(sub.billing_status || '').toUpperCase();
    const accountStatus = String(sub.account_status || 'ACTIVE').toUpperCase();
    const amountDue =
      unpaidInfo && unpaidInfo.totalDue > 0
        ? unpaidInfo.totalDue
        : Number(sub.monthly_fee) || 2500;

    // -----------------------------------------------------------------------
    // STAGE 1: 3-Day Advance Reminder (now < expiry && expiry <= now + 3 days)
    // -----------------------------------------------------------------------
    if (nowMs < expiryMs && expiryMs <= nowMs + threeDaysMs) {
      if (billingStatus === 'SUSPENDED_EXPIRED' || billingStatus === 'GRACE_PERIOD') {
        continue;
      }
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
      continue;
    }

    // -----------------------------------------------------------------------
    // STAGE 2: Expiry Day -> 24h Grace Period (now >= expiry && now < graceEnds)
    // -----------------------------------------------------------------------
    const computedGraceEndsMs = sub.grace_ends_at
      ? Date.parse(String(sub.grace_ends_at))
      : expiryMs + graceHours * 3_600_000;
    const graceEndsMs = Number.isNaN(computedGraceEndsMs)
      ? expiryMs + graceHours * 3_600_000
      : computedGraceEndsMs;

    if (nowMs >= expiryMs && nowMs < graceEndsMs) {
      if (billingStatus === 'GRACE_PERIOD' || billingStatus === 'SUSPENDED_EXPIRED') {
        continue;
      }

      const graceEndsIso = new Date(graceEndsMs).toISOString();
      await safeUpdateSubscriber(
        supabase,
        sub.id,
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

      enteredGrace++;
      continue;
    }

    // -----------------------------------------------------------------------
    // STAGE 3: Post-Grace Suspension (now >= graceEndsMs)
    // -----------------------------------------------------------------------
    if (nowMs >= graceEndsMs) {
      if (billingStatus === 'SUSPENDED_EXPIRED' && accountStatus === 'EXPIRED') {
        continue;
      }

      try {
        const { secretsCache, activeCache } = await ensureMikrotikCaches();
        const liveSecret = secretsCache.get(uname);
        const secretId = String(liveSecret?.['.id'] || liveSecret?.id || '').trim();
        const liveProfile = String(liveSecret?.profile || '').trim();

        const backupProfile =
          String(sub.original_package_profile || '').trim() ||
          (liveProfile && liveProfile.toLowerCase() !== settings.expiry_ppp_profile.toLowerCase()
            ? liveProfile
            : '') ||
          String(sub.package_profile_name || '').trim() ||
          String(sub.package_speed || '').trim().replace(/\s+/g, '') ||
          '20Mbps';

        // CRITICAL: Persist backup original_package_profile in Supabase BEFORE altering MikroTik
        await safeUpdateSubscriber(
          supabase,
          sub.id,
          {
            original_package_profile: backupProfile,
          },
          {
            package_profile_name: backupProfile,
          },
          schemaWarningsSet
        );

        const isDisableMode =
          String(settings.suspension_mode || '').toUpperCase() === 'DISABLE_SECRET';

        if (secretId) {
          const patchPayload = isDisableMode
            ? { disabled: 'true' }
            : { profile: settings.expiry_ppp_profile, disabled: 'false' };
          const patched = await mk.patchSecret(secretId, patchPayload);
          if (!patched) {
            errors.push(`MikroTik secret patch failed for @${uname}`);
          }
        } else {
          errors.push(`No MikroTik /ppp/secret found for @${uname}`);
        }

        // Kick active PPPoE session so CPE drops & redials into 16.16.16.0/24 immediately
        const activeSessionsForUser = activeCache.get(uname) || [];
        for (const sess of activeSessionsForUser) {
          const activeId = String(sess?.['.id'] || sess?.id || '').trim();
          if (activeId) {
            const kicked = await mk.kickActiveSession(activeId);
            if (kicked) kickedActiveSessions++;
          }
        }

        await safeUpdateSubscriber(
          supabase,
          sub.id,
          {
            billing_status: 'SUSPENDED_EXPIRED',
            account_status: 'EXPIRED',
            suspended_at: nowIso,
            original_package_profile: backupProfile,
          },
          {
            account_status: 'EXPIRED',
            package_profile_name: backupProfile,
          },
          schemaWarningsSet
        );

        await safeInsertAuditLog(
          supabase,
          {
            subscriber_id: sub.id,
            username: uname,
            action_type: isDisableMode ? 'DISABLED_SECRET' : 'SUSPENDED_16_POOL',
            previous_profile: backupProfile,
            applied_profile: isDisableMode ? 'DISABLED' : settings.expiry_ppp_profile,
            triggered_by: triggeredBy,
            notes: `Post-grace suspension executed (${isDisableMode ? 'Secret Disabled' : `Shifted to ${settings.expiry_ppp_profile} 16.16.16.0/24`}). Active sessions kicked: ${activeSessionsForUser.length}.`,
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
    scanned: subscribers.length,
    remindersSent,
    enteredGrace,
    suspendedTo16Pool,
    disabledSecrets,
    kickedActiveSessions,
    skippedPaid,
    errors,
    schemaWarnings: Array.from(schemaWarningsSet),
    durationMs: Date.now() - startedAt,
    timestamp: nowIso,
  };
}
