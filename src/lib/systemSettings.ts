import { supabase } from '../services/supabaseClient';
import {
  DEFAULT_MASTER_COMPANY_NAME,
  formatWhatsAppGroupJid,
  normalizeWhatsAppGatewayUrl,
  WHATSAPP_GATEWAY_URL_STORAGE_KEY,
} from './whatsappRouting';
import { WHATSAPP_TEAM_GROUP_SETTINGS_KEY } from './whatsappTemplates';
import { getStoredUser } from './auth';

export const SYSTEM_SETTINGS_STORAGE_KEY = 'youthnet_global_system_settings';
export const SYSTEM_SETTINGS_UPDATED_EVENT = 'youthnet:system-settings-updated';

export interface GlobalSystemSettings {
  companyDisplayName: string;
  ispName: string;
  supportHelpline: string;
  baileysGatewayUrl: string;
  autoSendMasterSwitch: boolean;
  whatsAppGatewayEnabled: boolean;
  teamWhatsAppGroupJid: string;
  teamWhatsAppGroupName: string;
  billingCycleMode: 'fixed_day' | 'rolling_31';
  billingCycleDay: number;
  autoInvoiceDaysBeforeExpiry: number;
  gracePeriodDays: number;
  expiryPppProfile: string;
  autoWalledGarden: boolean;
  currencyCode: string;
  currencySymbol: string;
  defaultMikrotikApiPort: number;
  defaultSnmpCommunity: string;
  slaAutoAssignMinutes: number;
  fiberCutSlaHours: number;
}

export const DEFAULT_GLOBAL_SYSTEM_SETTINGS: GlobalSystemSettings = {
  companyDisplayName: DEFAULT_MASTER_COMPANY_NAME,
  ispName: DEFAULT_MASTER_COMPANY_NAME,
  supportHelpline: '+92 323 4193599',
  baileysGatewayUrl: '',
  autoSendMasterSwitch: true,
  whatsAppGatewayEnabled: true,
  teamWhatsAppGroupJid: '',
  teamWhatsAppGroupName: '',
  billingCycleMode: 'fixed_day',
  billingCycleDay: 1,
  autoInvoiceDaysBeforeExpiry: 5,
  gracePeriodDays: 3,
  expiryPppProfile: 'EXPIRED-16-POOL',
  autoWalledGarden: true,
  currencyCode: 'PKR',
  currencySymbol: 'Rs.',
  defaultMikrotikApiPort: 8728,
  defaultSnmpCommunity: 'public',
  slaAutoAssignMinutes: 5,
  fiberCutSlaHours: 2,
};

export const SYSTEM_SETTINGS_MIGRATION_SQL = `CREATE TABLE IF NOT EXISTS public.system_settings (
  id TEXT PRIMARY KEY DEFAULT 'global',
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_read_system_settings" ON public.system_settings;
CREATE POLICY "allow_read_system_settings"
  ON public.system_settings FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "allow_write_system_settings" ON public.system_settings;
CREATE POLICY "allow_write_system_settings"
  ON public.system_settings FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

GRANT ALL ON public.system_settings TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';`;

function clampInt(val: unknown, fallback: number, min: number, max: number): number {
  const num = Math.round(Number(val));
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

export function sanitizeSystemSettings(
  raw?: Partial<GlobalSystemSettings> | Record<string, any> | null
): GlobalSystemSettings {
  const src: Record<string, any> = raw && typeof raw === 'object' ? (raw as Record<string, any>) : {};

  const companyName = String(
    src.companyDisplayName ??
      src.company_display_name ??
      src.ispName ??
      src.isp_name ??
      DEFAULT_GLOBAL_SYSTEM_SETTINGS.companyDisplayName
  )
    .trim()
    .slice(0, 120) || DEFAULT_GLOBAL_SYSTEM_SETTINGS.companyDisplayName;

  const helpline = String(
    src.supportHelpline ??
      src.support_helpline ??
      src.whatsapp_support_phone ??
      DEFAULT_GLOBAL_SYSTEM_SETTINGS.supportHelpline
  )
    .trim()
    .slice(0, 50);

  const rawGateway = String(
    src.baileysGatewayUrl ?? src.baileys_gateway_url ?? src.whatsapp_gateway_url ?? ''
  ).trim();
  const normalizedGateway = normalizeWhatsAppGatewayUrl(rawGateway);
  const baileysGatewayUrl = normalizedGateway.valid ? normalizedGateway.normalized : '';

  const autoSendRaw =
    src.autoSendMasterSwitch ??
    src.auto_send_master_switch ??
    src.whatsAppGatewayEnabled ??
    src.whatsapp_gateway_enabled;
  const autoSend =
    autoSendRaw === undefined
      ? DEFAULT_GLOBAL_SYSTEM_SETTINGS.autoSendMasterSwitch
      : autoSendRaw !== false && String(autoSendRaw) !== 'false';

  const rawGroupJid = String(
    src.teamWhatsAppGroupJid ??
      src.team_work_group_jid ??
      src.team_whatsapp_group_jid ??
      src.groupJid ??
      ''
  ).trim();
  const teamWhatsAppGroupJid = formatWhatsAppGroupJid(rawGroupJid) || rawGroupJid.slice(0, 80);

  const teamWhatsAppGroupName = String(
    src.teamWhatsAppGroupName ??
      src.team_work_group_name ??
      src.team_whatsapp_group_name ??
      src.groupName ??
      ''
  )
    .trim()
    .slice(0, 120);

  const currencyCode =
    String(src.currencyCode ?? src.currency_code ?? DEFAULT_GLOBAL_SYSTEM_SETTINGS.currencyCode)
      .trim()
      .toUpperCase()
      .slice(0, 10) || 'PKR';

  const currencySymbol =
    String(src.currencySymbol ?? src.currency_symbol ?? DEFAULT_GLOBAL_SYSTEM_SETTINGS.currencySymbol)
      .trim()
      .slice(0, 10) || 'Rs.';

  const expiryPppProfile =
    String(
      src.expiryPppProfile ??
        src.expiry_ppp_profile ??
        DEFAULT_GLOBAL_SYSTEM_SETTINGS.expiryPppProfile
    )
      .trim()
      .slice(0, 80) || 'EXPIRED-16-POOL';

  const autoWalledGardenRaw = src.autoWalledGarden ?? src.auto_walled_garden;
  const autoWalledGarden =
    autoWalledGardenRaw === undefined
      ? DEFAULT_GLOBAL_SYSTEM_SETTINGS.autoWalledGarden
      : autoWalledGardenRaw !== false && String(autoWalledGardenRaw) !== 'false';

  const defaultSnmpCommunity =
    String(
      src.defaultSnmpCommunity ??
        src.default_snmp_community ??
        DEFAULT_GLOBAL_SYSTEM_SETTINGS.defaultSnmpCommunity
    )
      .trim()
      .slice(0, 64) || 'public';

  const rawCycleMode = String(
    src.billingCycleMode ?? src.billing_cycle_mode ?? DEFAULT_GLOBAL_SYSTEM_SETTINGS.billingCycleMode
  )
    .trim()
    .toLowerCase();
  const billingCycleMode: 'fixed_day' | 'rolling_31' =
    rawCycleMode === 'rolling_31' || rawCycleMode === 'rolling' ? 'rolling_31' : 'fixed_day';

  return {
    companyDisplayName: companyName,
    ispName: companyName,
    supportHelpline: helpline,
    baileysGatewayUrl,
    autoSendMasterSwitch: autoSend,
    whatsAppGatewayEnabled: autoSend,
    teamWhatsAppGroupJid,
    teamWhatsAppGroupName,
    billingCycleMode,
    billingCycleDay: clampInt(
      src.billingCycleDay ?? src.billing_cycle_day,
      DEFAULT_GLOBAL_SYSTEM_SETTINGS.billingCycleDay,
      1,
      31
    ),
    autoInvoiceDaysBeforeExpiry: clampInt(
      src.autoInvoiceDaysBeforeExpiry ?? src.auto_invoice_days_before_expiry,
      DEFAULT_GLOBAL_SYSTEM_SETTINGS.autoInvoiceDaysBeforeExpiry,
      1,
      15
    ),
    gracePeriodDays: clampInt(
      src.gracePeriodDays ?? src.grace_period_days,
      DEFAULT_GLOBAL_SYSTEM_SETTINGS.gracePeriodDays,
      0,
      30
    ),
    expiryPppProfile,
    autoWalledGarden,
    currencyCode,
    currencySymbol,
    defaultMikrotikApiPort: clampInt(
      src.defaultMikrotikApiPort ?? src.default_mikrotik_api_port,
      DEFAULT_GLOBAL_SYSTEM_SETTINGS.defaultMikrotikApiPort,
      1,
      65535
    ),
    defaultSnmpCommunity,
    slaAutoAssignMinutes: clampInt(
      src.slaAutoAssignMinutes ?? src.sla_auto_assign_minutes,
      DEFAULT_GLOBAL_SYSTEM_SETTINGS.slaAutoAssignMinutes,
      1,
      240
    ),
    fiberCutSlaHours: clampInt(
      src.fiberCutSlaHours ?? src.fiber_cut_sla_hours,
      DEFAULT_GLOBAL_SYSTEM_SETTINGS.fiberCutSlaHours,
      1,
      72
    ),
  };
}

export function getCachedGlobalSystemSettings(): GlobalSystemSettings {
  if (typeof window === 'undefined') return { ...DEFAULT_GLOBAL_SYSTEM_SETTINGS };
  try {
    const raw = window.localStorage.getItem(SYSTEM_SETTINGS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return sanitizeSystemSettings(parsed);
    }
  } catch {
    // ignore corrupt localStorage
  }
  return { ...DEFAULT_GLOBAL_SYSTEM_SETTINGS };
}

function mirrorSettingsLocally(config: GlobalSystemSettings): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SYSTEM_SETTINGS_STORAGE_KEY, JSON.stringify(config));
    if (config.baileysGatewayUrl) {
      window.localStorage.setItem(WHATSAPP_GATEWAY_URL_STORAGE_KEY, config.baileysGatewayUrl);
    }
    window.localStorage.setItem('isp_currency_code', config.currencyCode);
    window.localStorage.setItem('isp_currency_symbol', config.currencySymbol);
    window.dispatchEvent(
      new CustomEvent<GlobalSystemSettings>(SYSTEM_SETTINGS_UPDATED_EVENT, { detail: config })
    );
  } catch {
    // ignore storage errors
  }
}

export interface LoadSystemSettingsResult {
  settings: GlobalSystemSettings;
  source: 'supabase' | 'backend' | 'local';
  updatedAt: string | null;
  error?: string;
  tableMissing?: boolean;
}

/**
 * Fetches global System Settings & Carrier Configuration from Supabase `system_settings` (`id = 'global'`).
 * Hydrates localStorage and fires the settings-updated event so all views/contexts stay synced.
 */
export async function loadGlobalSystemSettings(): Promise<LoadSystemSettingsResult> {
  const cached = getCachedGlobalSystemSettings();

  // 1. Primary source: Supabase `system_settings` table (`id = 'global'`)
  try {
    const { data, error } = await supabase
      .from('system_settings')
      .select('id, config, updated_at')
      .eq('id', 'global')
      .maybeSingle();

    if (!error && data && data.config && typeof data.config === 'object') {
      const merged = sanitizeSystemSettings(data.config as Record<string, any>);
      mirrorSettingsLocally(merged);
      return {
        settings: merged,
        source: 'supabase',
        updatedAt: data.updated_at ? String(data.updated_at) : null,
      };
    }

    if (error) {
      const msg = String(error.message || '');
      const tableMissing =
        error.code === '42P01' ||
        /relation .*system_settings.* does not exist|Could not find the table .*system_settings/i.test(msg);

      // Fall through to backend API / cached local settings while reporting error metadata
      try {
        const res = await fetch('/api/settings');
        const ct = String(res.headers.get('content-type') || '').toLowerCase();
        if (res.ok && ct.includes('application/json')) {
          const json = await res.json();
          if (json?.success && json?.settings) {
            const merged = sanitizeSystemSettings({ ...cached, ...json.settings });
            mirrorSettingsLocally(merged);
            return {
              settings: merged,
              source: 'backend',
              updatedAt: null,
              error: msg,
              tableMissing,
            };
          }
        }
      } catch {
        // ignore backend fallback error
      }

      return {
        settings: cached,
        source: 'local',
        updatedAt: null,
        error: msg,
        tableMissing,
      };
    }
  } catch (err: any) {
    // Network or client failure -> try backend fallback
    try {
      const res = await fetch('/api/settings');
      const ct = String(res.headers.get('content-type') || '').toLowerCase();
      if (res.ok && ct.includes('application/json')) {
        const json = await res.json();
        if (json?.success && json?.settings) {
          const merged = sanitizeSystemSettings({ ...cached, ...json.settings });
          mirrorSettingsLocally(merged);
          return { settings: merged, source: 'backend', updatedAt: null };
        }
      }
    } catch {
      // ignore
    }
    return {
      settings: cached,
      source: 'local',
      updatedAt: null,
      error: err?.message || 'Unable to load system settings from Supabase.',
    };
  }

  // Row not seeded yet in Supabase -> try enriching from existing app_settings / isp_billing_settings / backend
  let hydrated = { ...cached };
  try {
    const [appRes, billingRes] = await Promise.all([
      supabase
        .from('app_settings')
        .select('key, value')
        .in('key', ['whatsapp_gateway_url', WHATSAPP_TEAM_GROUP_SETTINGS_KEY]),
      supabase.from('isp_billing_settings').select('expiry_ppp_profile, grace_hours').eq('id', 1).maybeSingle(),
    ]);
    if (!appRes.error && Array.isArray(appRes.data)) {
      for (const row of appRes.data as Array<{ key?: string; value?: string }>) {
        if (row.key === 'whatsapp_gateway_url' && row.value) {
          hydrated.baileysGatewayUrl = String(row.value).trim();
        } else if (row.key === WHATSAPP_TEAM_GROUP_SETTINGS_KEY && row.value) {
          try {
            const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
            if (parsed?.groupJid) hydrated.teamWhatsAppGroupJid = String(parsed.groupJid);
            if (parsed?.groupName) hydrated.teamWhatsAppGroupName = String(parsed.groupName);
          } catch {
            // ignore
          }
        }
      }
    }
    if (!billingRes.error && billingRes.data) {
      if (billingRes.data.expiry_ppp_profile) {
        hydrated.expiryPppProfile = String(billingRes.data.expiry_ppp_profile);
      }
      if (Number(billingRes.data.grace_hours) >= 0) {
        hydrated.gracePeriodDays = Math.max(0, Math.round(Number(billingRes.data.grace_hours) / 24));
      }
    }
  } catch {
    // optional enrichment tables may not exist
  }

  const sanitized = sanitizeSystemSettings(hydrated);
  mirrorSettingsLocally(sanitized);
  return {
    settings: sanitized,
    source: 'supabase',
    updatedAt: null,
  };
}

export interface SaveSystemSettingsResult {
  ok: boolean;
  settings: GlobalSystemSettings;
  updatedAt?: string;
  error?: string;
  tableMissing?: boolean;
}

/**
 * Persists the full System Settings & Carrier Configuration directly to Supabase
 * `system_settings` (`id = 'global'`, `onConflict: 'id'`), then mirrors key linked
 * fields to localStorage, app_settings, isp_billing_settings, and `/api/settings`.
 */
export async function saveGlobalSystemSettings(
  nextConfig: Partial<GlobalSystemSettings>
): Promise<SaveSystemSettingsResult> {
  // Validate Gateway URL before saving
  if (nextConfig.baileysGatewayUrl !== undefined && String(nextConfig.baileysGatewayUrl).trim()) {
    const urlCheck = normalizeWhatsAppGatewayUrl(String(nextConfig.baileysGatewayUrl));
    if (!urlCheck.valid) {
      return {
        ok: false,
        settings: getCachedGlobalSystemSettings(),
        error: urlCheck.error || 'Invalid Baileys Gateway Server URL.',
      };
    }
  }

  // Validate optional Team WhatsApp Group JID format if non-empty
  if (
    nextConfig.teamWhatsAppGroupJid !== undefined &&
    String(nextConfig.teamWhatsAppGroupJid).trim() !== '' &&
    !formatWhatsAppGroupJid(nextConfig.teamWhatsAppGroupJid)
  ) {
    return {
      ok: false,
      settings: getCachedGlobalSystemSettings(),
      error: 'Invalid Team WhatsApp Group JID. Expected format like 120363012345678901@g.us.',
    };
  }

  const existing = getCachedGlobalSystemSettings();
  const sanitized = sanitizeSystemSettings({ ...existing, ...nextConfig });
  const nowIso = new Date().toISOString();

  // 1. Primary durable write: Supabase `system_settings` table (`id = 'global'`)
  const { data, error } = await supabase
    .from('system_settings')
    .upsert(
      {
        id: 'global',
        config: {
          ...sanitized,
          team_work_group_jid: sanitized.teamWhatsAppGroupJid,
          team_work_group_name: sanitized.teamWhatsAppGroupName,
        },
        updated_at: nowIso,
      },
      { onConflict: 'id' }
    )
    .select('id, updated_at')
    .maybeSingle();

  if (error) {
    const msg = String(error.message || 'Supabase failed to save system_settings.');
    const tableMissing =
      error.code === '42P01' ||
      /relation .*system_settings.* does not exist|Could not find the table .*system_settings/i.test(msg);
    return {
      ok: false,
      settings: sanitized,
      error: tableMissing
        ? `Supabase table "system_settings" does not exist yet (${msg}). Run the SQL migration below in Supabase SQL Editor.`
        : `Supabase error saving system_settings: ${msg}`,
      tableMissing,
    };
  }

  // 2. Mirror locally and broadcast change event across all open views/contexts
  mirrorSettingsLocally(sanitized);

  // 3. Best-effort sync to linked auxiliary tables so WhatsApp Gateway & Expiry Automation stay aligned
  const sideEffects: Array<Promise<any>> = [];

  sideEffects.push(
    Promise.resolve(
      supabase.from('app_settings').upsert(
        [
          {
            key: 'whatsapp_gateway_url',
            value: sanitized.baileysGatewayUrl,
            updated_at: nowIso,
          },
          ...(sanitized.teamWhatsAppGroupJid || sanitized.teamWhatsAppGroupName
            ? [
                {
                  key: WHATSAPP_TEAM_GROUP_SETTINGS_KEY,
                  value: JSON.stringify({
                    groupJid: sanitized.teamWhatsAppGroupJid,
                    groupName: sanitized.teamWhatsAppGroupName,
                    inviteLink: '',
                  }),
                  updated_at: nowIso,
                },
              ]
            : []),
        ],
        { onConflict: 'key' }
      )
    ).catch(() => {})
  );

  sideEffects.push(
    Promise.resolve(
      supabase
        .from('isp_billing_settings')
        .update({
          expiry_ppp_profile: sanitized.expiryPppProfile,
          grace_hours: sanitized.gracePeriodDays * 24,
          updated_at: nowIso,
        })
        .eq('id', 1)
    ).catch(() => {})
  );

  const currentUser = getStoredUser();
  if (currentUser && String(currentUser.role || '').toUpperCase() === 'ADMIN' && currentUser.id) {
    sideEffects.push(
      Promise.resolve(
        supabase
          .from('portal_users')
          .update({
            company_name: sanitized.companyDisplayName,
            whatsapp_support_phone: sanitized.supportHelpline || null,
            whatsapp_auto_send: sanitized.autoSendMasterSwitch,
          })
          .eq('id', currentUser.id)
      ).catch(() => {})
    );
  }

  sideEffects.push(
    fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sanitized),
    }).catch(() => {})
  );

  await Promise.allSettled(sideEffects);

  return {
    ok: true,
    settings: sanitized,
    updatedAt: data?.updated_at ? String(data.updated_at) : nowIso,
  };
}
