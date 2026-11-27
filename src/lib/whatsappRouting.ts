import {
  supabase,
  type SupabasePaymentAccount,
  type SupabasePortalUser,
  type WhatsAppEventType,
} from '../services/supabaseClient';
import { getStoredToken, getStoredUser } from './auth';
import {
  DEFAULT_TEMPLATE_MAP,
  mapEventTypeToTemplateKey,
  renderWhatsAppTemplate,
  type EditableWhatsAppTemplateKey,
} from './whatsappTemplates';

export const DEFAULT_MASTER_COMPANY_NAME = 'Youth Net Service';
export const WHATSAPP_GATEWAY_URL_STORAGE_KEY = 'youthnet_baileys_gateway_url';
export const DEFAULT_STANDALONE_GATEWAY_URL = 'http://localhost:3001';

export const WHATSAPP_GATEWAY_MIGRATION_SQL = `-- Multi-Tenant Baileys WhatsApp Gateway & Reseller Branding Migration
ALTER TABLE public.portal_users
  ADD COLUMN IF NOT EXISTS company_name TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_status TEXT DEFAULT 'DISCONNECTED',
  ADD COLUMN IF NOT EXISTS whatsapp_phone TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_auto_send BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS whatsapp_support_phone TEXT,
  ADD COLUMN IF NOT EXISTS allow_subdealer_whatsapp BOOLEAN DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS public.whatsapp_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_portal_user_id TEXT,
  sender_company_name TEXT NOT NULL DEFAULT 'Youth Net Service',
  sender_phone TEXT,
  sender_tier TEXT DEFAULT 'ADMIN',
  subscriber_id TEXT,
  subscriber_username TEXT,
  recipient_phone TEXT NOT NULL,
  dealer_id TEXT,
  sub_dealer_id TEXT,
  event_type TEXT NOT NULL,
  message_body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'SENT',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_created_at ON public.whatsapp_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_dealer_id ON public.whatsapp_logs (dealer_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_sub_dealer_id ON public.whatsapp_logs (sub_dealer_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_event_user ON public.whatsapp_logs (event_type, subscriber_username, created_at DESC);

CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_app_settings" ON public.app_settings;
CREATE POLICY "allow_all_app_settings"
  ON public.app_settings FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

ALTER TABLE public.whatsapp_logs ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'whatsapp_logs' AND policyname = 'Allow authenticated full access to whatsapp_logs'
  ) THEN
    CREATE POLICY "Allow authenticated full access to whatsapp_logs"
      ON public.whatsapp_logs FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
GRANT ALL ON public.whatsapp_logs TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.whatsapp_auth_sessions (
  tenant_id TEXT NOT NULL,
  key_id TEXT NOT NULL,
  key_data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, key_id)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_auth_sessions_tenant_id
  ON public.whatsapp_auth_sessions (tenant_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_auth_sessions_creds_lookup
  ON public.whatsapp_auth_sessions (key_id, tenant_id);

ALTER TABLE public.whatsapp_auth_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_auth_sessions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.whatsapp_auth_sessions TO service_role;

NOTIFY pgrst, 'reload schema';`;

export interface WhatsAppSenderCandidate {
  id: string;
  username?: string | null;
  full_name?: string | null;
  role?: string | null;
  tier_level?: string | null;
  parent_dealer_id?: string | null;
  company_name?: string | null;
  whatsapp_status?: string | null;
  whatsapp_phone?: string | null;
  whatsapp_auto_send?: boolean | null;
  whatsapp_support_phone?: string | null;
  allow_subdealer_whatsapp?: boolean | null;
  phone?: string | null;
}

export interface SubscriberOwnershipRef {
  id?: string | null;
  username?: string | null;
  full_name?: string | null;
  phone?: string | null;
  dealer_id?: string | null;
  sub_dealer_id?: string | null;
  created_by_id?: string | null;
}

export interface ResolvedWhatsAppSender {
  senderUser: WhatsAppSenderCandidate | null;
  senderPortalUserId: string | null;
  senderTier: 'SUB_DEALER' | 'DEALER' | 'ADMIN';
  companyName: string;
  supportPhone: string;
  senderPhone: string | null;
  isConnected: boolean;
  autoSendEnabled: boolean;
  resolutionNote: string;
}

/**
 * Normalizes a Pakistani or international phone number to pure WhatsApp digits (e.g. "923001234567").
 */
export function formatWhatsAppDigits(phone?: string | null): string {
  const digits = String(phone || '').replace(/[^0-9]/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) {
    const stripped = digits.slice(2);
    return stripped.length >= 10 ? stripped : '';
  }
  if (digits.startsWith('03') && digits.length === 11) {
    return `92${digits.slice(1)}`;
  }
  if (digits.startsWith('3') && digits.length === 10) {
    return `92${digits}`;
  }
  if (digits.startsWith('0') && digits.length >= 10 && digits.length <= 12) {
    return `92${digits.slice(1)}`;
  }
  return digits.length >= 10 ? digits : '';
}

/**
 * Converts a raw phone number or JID into a valid Baileys JID.
 * Preserves `@g.us` group JIDs and `@s.whatsapp.net` user JIDs exact as-is.
 * Formats plain phone numbers (`+923...`, `03...`) into `923...@s.whatsapp.net`.
 */
export function formatWhatsAppJid(phone?: string | null): string | null {
  const clean = String(phone || '').trim();
  if (!clean) return null;
  if (/^[0-9-]{6,40}@g\.us$/i.test(clean)) {
    return clean.toLowerCase();
  }
  if (/^[0-9]{10,15}@s\.whatsapp\.net$/i.test(clean)) {
    return clean.toLowerCase();
  }
  const digits = formatWhatsAppDigits(clean);
  if (!digits) return null;
  return `${digits}@s.whatsapp.net`;
}

/**
 * Validates and normalizes a WhatsApp Group JID (`120363012345678901@g.us`).
 */
export function formatWhatsAppGroupJid(raw?: string | null): string | null {
  const clean = String(raw || '').trim();
  if (!clean) return null;
  if (/^[0-9-]{6,40}@g\.us$/i.test(clean)) {
    return clean.toLowerCase();
  }
  return null;
}

export function isValidWhatsAppGroupJid(raw?: string | null): boolean {
  return Boolean(formatWhatsAppGroupJid(raw));
}

/**
 * Formats a phone number for user-facing toast display (e.g. "+923001234567").
 */
export function formatWhatsAppDisplayPhone(phone?: string | null): string {
  const digits = formatWhatsAppDigits(phone);
  if (digits) return `+${digits}`;
  return String(phone || '').trim() || 'subscriber';
}

/**
 * Returns true if the supplied phone string normalizes to a valid WhatsApp phone number.
 */
export function isValidWhatsAppPhone(phone?: string | null): boolean {
  const digits = formatWhatsAppDigits(phone);
  if (!digits || digits.length < 10) return false;
  // Reject placeholder all-zero local numbers like 923000000000 or 0000000000
  if (/^0+$/.test(digits) || /^923000000000$/.test(digits)) return false;
  return true;
}

/**
 * Determines whether a Sub-Dealer is permitted to pair and send from their own WhatsApp number.
 * Allowed if explicitly granted on the Sub-Dealer row OR enabled at the Parent Dealer level.
 */
export function canSubDealerUseOwnWhatsApp(
  subDealer?: WhatsAppSenderCandidate | null,
  parentDealer?: WhatsAppSenderCandidate | null
): boolean {
  if (!subDealer) return false;
  if (subDealer.allow_subdealer_whatsapp === true) return true;
  if (parentDealer?.allow_subdealer_whatsapp === true) return true;
  return false;
}

function getEffectiveTier(u?: WhatsAppSenderCandidate | null): 'ADMIN' | 'DEALER' | 'SUB_DEALER' | 'OTHER' {
  if (!u) return 'OTHER';
  const tier = String(u.tier_level || '').trim().toUpperCase();
  const role = String(u.role || '').trim().toUpperCase();
  if (tier === 'SUB_DEALER' || role === 'SUB_DEALER') return 'SUB_DEALER';
  if (tier === 'DEALER' || role === 'DEALER') return 'DEALER';
  if (role === 'ADMIN' || tier === 'MASTER' || tier === 'ADMIN') return 'ADMIN';
  return 'OTHER';
}

function resolveDisplayCompanyName(
  u: WhatsAppSenderCandidate | null | undefined,
  fallback = DEFAULT_MASTER_COMPANY_NAME
): string {
  const custom = String(u?.company_name || '').trim();
  if (custom) return custom;
  const tier = getEffectiveTier(u);
  if (tier === 'ADMIN') return DEFAULT_MASTER_COMPANY_NAME;
  const fullName = String(u?.full_name || '').trim();
  return fullName || fallback;
}

/**
 * Hierarchical Multi-Tenant Sender Resolution Rule:
 * 1. Priority 1: Subscriber's `sub_dealer_id` — if connected AND allowed (`allow_subdealer_whatsapp === true` on sub-dealer or parent dealer).
 * 2. Priority 2: Subscriber's `dealer_id` (or sub-dealer's `parent_dealer_id`) — if connected.
 * 3. Priority 3: Fallback to Master ISP Admin WhatsApp session signed with `Youth Net Service` (or Admin's configured company_name).
 */
export function resolveWhatsAppSender(
  subscriber: SubscriberOwnershipRef | null | undefined,
  allPortalUsers: WhatsAppSenderCandidate[],
  connectedSessionUserIds?: Set<string> | null
): ResolvedWhatsAppSender {
  const byId = new Map<string, WhatsAppSenderCandidate>();
  for (const u of allPortalUsers) {
    if (u?.id) byId.set(String(u.id), u);
  }

  const isConnectedUser = (u?: WhatsAppSenderCandidate | null): boolean => {
    if (!u?.id) return false;
    if (connectedSessionUserIds) {
      return connectedSessionUserIds.has(String(u.id));
    }
    return String(u.whatsapp_status || '').trim().toUpperCase() === 'CONNECTED';
  };

  const subDealer = subscriber?.sub_dealer_id
    ? byId.get(String(subscriber.sub_dealer_id)) || null
    : null;

  const effectiveDealerId =
    subscriber?.dealer_id || subDealer?.parent_dealer_id || null;
  const dealer = effectiveDealerId
    ? byId.get(String(effectiveDealerId)) || null
    : null;

  // Locate Master Admin (prefer a connected ADMIN if multiple exist)
  const adminCandidates = allPortalUsers.filter((u) => getEffectiveTier(u) === 'ADMIN');
  const masterAdmin =
    adminCandidates.find((a) => isConnectedUser(a)) || adminCandidates[0] || null;

  // Priority 1: Sub-Dealer's own connected WhatsApp (if permitted)
  if (subDealer && canSubDealerUseOwnWhatsApp(subDealer, dealer) && isConnectedUser(subDealer)) {
    return {
      senderUser: subDealer,
      senderPortalUserId: String(subDealer.id),
      senderTier: 'SUB_DEALER',
      companyName: resolveDisplayCompanyName(subDealer),
      supportPhone: String(subDealer.whatsapp_support_phone || subDealer.whatsapp_phone || subDealer.phone || '').trim(),
      senderPhone: subDealer.whatsapp_phone || null,
      isConnected: true,
      autoSendEnabled: subDealer.whatsapp_auto_send !== false,
      resolutionNote: `Routed via Sub-Dealer @${subDealer.username || subDealer.id}`,
    };
  }

  // Priority 2: Parent Dealer's connected WhatsApp
  if (dealer && isConnectedUser(dealer)) {
    return {
      senderUser: dealer,
      senderPortalUserId: String(dealer.id),
      senderTier: 'DEALER',
      companyName: resolveDisplayCompanyName(dealer),
      supportPhone: String(dealer.whatsapp_support_phone || dealer.whatsapp_phone || dealer.phone || '').trim(),
      senderPhone: dealer.whatsapp_phone || null,
      isConnected: true,
      autoSendEnabled: dealer.whatsapp_auto_send !== false,
      resolutionNote: subDealer
        ? `Sub-Dealer WhatsApp inactive/unpermitted -> routed via Dealer @${dealer.username || dealer.id}`
        : `Routed via Dealer @${dealer.username || dealer.id}`,
    };
  }

  // Priority 3: Fallback to Master ISP Admin session
  const adminConnected = isConnectedUser(masterAdmin);
  return {
    senderUser: masterAdmin,
    senderPortalUserId: masterAdmin?.id ? String(masterAdmin.id) : null,
    senderTier: 'ADMIN',
    companyName: resolveDisplayCompanyName(masterAdmin, DEFAULT_MASTER_COMPANY_NAME),
    supportPhone: String(
      masterAdmin?.whatsapp_support_phone ||
        masterAdmin?.whatsapp_phone ||
        masterAdmin?.phone ||
        ''
    ).trim(),
    senderPhone: masterAdmin?.whatsapp_phone || null,
    isConnected: adminConnected,
    autoSendEnabled: masterAdmin ? masterAdmin.whatsapp_auto_send !== false : true,
    resolutionNote: adminConnected
      ? 'Fallback to Master ISP Admin WhatsApp session'
      : 'Master ISP Admin WhatsApp session not connected',
  };
}

export interface AutomatedMessageTemplateVars {
  eventType: WhatsAppEventType;
  companyName: string;
  supportPhone?: string | null;
  subscriberName?: string | null;
  username?: string | null;
  password?: string | null;
  portalUrl?: string | null;
  accountRole?: string | null;
  packageName?: string | null;
  monthlyFee?: number | null;
  amountDue?: number | null;
  amountPaid?: number | null;
  totalAmount?: number | null;
  remainingBalance?: number | null;
  previousUnpaidBalance?: number | null;
  dueDate?: string | null;
  anchoredDueDate?: string | null;
  graceDate?: string | null;
  expiryDate?: string | null;
  daysRemaining?: number | null;
  invoiceNo?: string | null;
  paymentMethod?: string | null;
  paymentAccounts?: SupabasePaymentAccount[];
  ticketId?: string | null;
  issue?: string | null;
  agentName?: string | null;
  agentBalance?: number | null;
  area?: string | null;
  address?: string | null;
  phone?: string | null;
  customNote?: string | null;
  customMessage?: string | null;
  customTemplates?: Partial<Record<EditableWhatsAppTemplateKey, string>> | null;
}

function formatPaymentAccountLines(accounts?: SupabasePaymentAccount[]): string {
  const active = (accounts || []).filter((a) => a.is_active !== false);
  if (active.length === 0) return '';
  const lines = active.map(
    (acc) => `• *${acc.provider_name}:* ${acc.account_number_or_iban} (${acc.account_title})`
  );
  return `\n\n*Payment Methods:*\n${lines.join('\n')}`;
}

export function buildAutomatedWhatsAppMessage(vars: AutomatedMessageTemplateVars): string {
  const company = String(vars.companyName || DEFAULT_MASTER_COMPANY_NAME).trim();
  const clientName = String(vars.subscriberName || vars.username || 'Valued Subscriber').trim();
  const uname = String(vars.username || '').trim();
  const supportPhone = String(vars.supportPhone || '+923234193599').trim();
  const supportLine = vars.supportPhone ? `\nSupport Helpline: ${vars.supportPhone}` : '';
  const paymentBlock = formatPaymentAccountLines(vars.paymentAccounts);

  const primaryAmount =
    vars.eventType === 'PAYMENT_RESTORED' || vars.eventType === 'AGENT_PAYMENT_RECEIPT'
      ? Math.round(Number(vars.amountPaid ?? vars.totalAmount ?? vars.amountDue ?? 0))
      : Math.round(Number(vars.amountDue ?? vars.totalAmount ?? vars.monthlyFee ?? 0));

  const renderValues = {
    client_name: clientName,
    username: uname || 'N/A',
    password: vars.password || 'As configured',
    package: vars.packageName || vars.accountRole || 'Fiber Broadband',
    amount: primaryAmount,
    due_date: vars.dueDate || vars.expiryDate || 'Current Cycle',
    grace_date: vars.graceDate || vars.dueDate || 'Within 3 days',
    expiry_date: vars.expiryDate || vars.dueDate || 'Active',
    ticket_id: vars.ticketId || 'TKT-NEW',
    issue: vars.issue || vars.customNote || 'Technical / Connectivity Support',
    agent_name: vars.agentName || 'Field Support Team',
    company_name: company,
    helpline: supportPhone,
    invoice_no: vars.invoiceNo || 'N/A',
    area: vars.area || 'Main Service Area',
    phone: vars.phone || 'N/A',
    address: vars.address || 'On file',
    agent_balance: vars.agentBalance ?? 0,
    payment_method: vars.paymentMethod || 'Cash',
    remaining_balance: Math.max(0, Math.round(Number(vars.remainingBalance ?? 0))),
    portal_url: vars.portalUrl || '',
  };

  if (vars.eventType === 'CUSTOM_MESSAGE') {
    const rawCustom = String(vars.customMessage || vars.customNote || '').trim();
    if (rawCustom) {
      return renderWhatsAppTemplate(rawCustom, renderValues);
    }
  }

  const templateKey = mapEventTypeToTemplateKey(vars.eventType);
  if (templateKey) {
    const customText = vars.customTemplates?.[templateKey];
    const templateBody =
      typeof customText === 'string' && customText.trim()
        ? customText
        : DEFAULT_TEMPLATE_MAP[templateKey];
    let rendered = renderWhatsAppTemplate(templateBody, renderValues);
    const prevUnpaid = Math.max(0, Math.round(Number(vars.previousUnpaidBalance || 0)));
    if (vars.eventType === 'INVOICE_GENERATED' && prevUnpaid > 0) {
      const combinedDue = Math.round(primaryAmount + prevUnpaid);
      rendered += `\n\n⚠️ *Previous Unpaid Balance:* Rs. ${prevUnpaid.toLocaleString()}\n• *Total Combined Payable:* Rs. ${combinedDue.toLocaleString()}`;
    }
    const anchoredDue = String(vars.anchoredDueDate || '').trim();
    const validTill = String(vars.expiryDate || '').trim();
    if (
      vars.eventType === 'PAYMENT_RESTORED' &&
      anchoredDue &&
      validTill &&
      !rendered.includes('Recharged from Due Date')
    ) {
      rendered += `\n• *Billing Cycle:* Recharged from Due Date ${anchoredDue} -> Valid till ${validTill}`;
    }
    const shouldAppendPaymentBlock =
      (vars.eventType === 'INVOICE_GENERATED' ||
        vars.eventType === 'PRE_EXPIRY_3D' ||
        vars.eventType === 'GRACE_PERIOD_3D' ||
        vars.eventType === 'AUTO_SUSPENSION') &&
      Boolean(paymentBlock) &&
      !rendered.includes('*Payment Methods:*');
    return shouldAppendPaymentBlock ? `${rendered}${paymentBlock}` : rendered;
  }

  if (vars.eventType === 'COMPLAINT_ASSIGNED_AGENT') {
    return (
      `🛠️ *ASSIGNED TICKET ALERT — ${renderValues.ticket_id}*\n\n` +
      `Dear *${renderValues.agent_name}*,\n` +
      `A new subscriber complaint has been assigned to you:\n\n` +
      `• *Ticket ID:* ${renderValues.ticket_id}\n` +
      `• *Client Name:* ${renderValues.client_name} (${renderValues.username})\n` +
      `• *Client Phone:* ${renderValues.phone}\n` +
      `• *Area / Node:* ${renderValues.area}\n` +
      `• *Address:* ${renderValues.address}\n` +
      `• *Issue Details:* ${renderValues.issue}\n\n` +
      `Please contact the subscriber and resolve promptly.\n` +
      `— *${company}* NOC`
    );
  }

  return (
    `*${company} — WhatsApp Gateway Active*\n\n` +
    `${vars.customNote || vars.customMessage || 'Automated multi-tenant WhatsApp notifications are connected and ready for zero-click delivery.'}\n\n` +
    `— *${company}*` +
    supportLine
  );
}

export function buildPortalAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (typeof window === 'undefined') return headers;
  const user = getStoredUser();
  const token = getStoredToken();
  if (user?.id) headers['x-portal-user-id'] = String(user.id);
  if (user?.username) headers['x-portal-username'] = String(user.username);
  if (user?.role) headers['x-portal-role'] = String(user.role);
  if (user?.tier_level) headers['x-portal-tier'] = String(user.tier_level);
  if (user?.parent_dealer_id) {
    headers['x-portal-parent-dealer-id'] = String(user.parent_dealer_id);
  }
  if (token) headers['x-portal-auth-token'] = `Bearer ${token}`;
  return headers;
}

export interface AutoWhatsAppTriggerResponse {
  ok: boolean;
  status?: 'SENT' | 'FAILED' | 'SKIPPED';
  formattedPhone?: string;
  senderCompanyName?: string;
  senderPhone?: string | null;
  error?: string;
  skippedReason?: string;
  isGatewayUnreachable?: boolean;
}

/**
 * Normalizes and validates a Baileys Gateway base URL.
 * Empty string means same-origin integrated Node server.
 * Non-empty values must be valid http:// or https:// URLs (blocks javascript:, data:, etc.).
 */
export function normalizeWhatsAppGatewayUrl(raw: string): { valid: boolean; normalized: string; error?: string } {
  const trimmed = String(raw || '').trim();
  if (!trimmed) {
    return { valid: true, normalized: '' };
  }
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { valid: false, normalized: '', error: 'Gateway URL must start with http:// or https://' };
    }
    if (parsed.hostname.toLowerCase().endsWith('.supabase.co')) {
      return {
        valid: false,
        normalized: '',
        error:
          'That is your Supabase Database URL (*.supabase.co), not a Baileys WhatsApp Gateway server. Enter your Node.js baileys-server.js URL (e.g. http://localhost:3001 or your Railway/Render/VPS HTTPS URL), or leave blank on the integrated preview server.',
      };
    }
    const cleanOriginPath = `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '');
    return { valid: true, normalized: cleanOriginPath };
  } catch {
    return {
      valid: false,
      normalized: '',
      error: 'Please enter a valid Gateway URL (e.g. https://wa.youthtechnology.pk or http://localhost:3001).',
    };
  }
}

function getEnvWhatsAppGatewayUrl(): string {
  try {
    const envVal = (import.meta as any)?.env?.VITE_WHATSAPP_GATEWAY_URL;
    if (typeof envVal === 'string' && envVal.trim()) {
      const check = normalizeWhatsAppGatewayUrl(envVal);
      if (check.valid) return check.normalized;
    }
  } catch {
    // ignore in Node/test contexts
  }
  return '';
}

function isStaticSpaHost(): boolean {
  if (typeof window === 'undefined') return false;
  const host = String(window.location?.hostname || '').toLowerCase();
  return (
    host.endsWith('.netlify.app') ||
    host.endsWith('.netlify.com') ||
    host.endsWith('.vercel.app') ||
    host.endsWith('.pages.dev') ||
    host.endsWith('.github.io')
  );
}

/**
 * Resolves the active Baileys WhatsApp Gateway base URL:
 * 1. Saved override in localStorage (synced from Supabase app_settings / UI input)
 * 2. VITE_WHATSAPP_GATEWAY_URL build-time env var
 * 3. On static hosts (Netlify/Vercel), defaults to http://localhost:3001
 * 4. Otherwise "" (same-origin integrated Node server)
 */
export function getConfiguredWhatsAppGatewayUrl(): string {
  if (typeof window !== 'undefined') {
    try {
      const stored = window.localStorage.getItem(WHATSAPP_GATEWAY_URL_STORAGE_KEY);
      if (stored !== null) {
        const trimmed = stored.trim();
        if (trimmed) {
          const parsed = normalizeWhatsAppGatewayUrl(trimmed);
          if (parsed.valid) return parsed.normalized;
        }
      }
    } catch {
      // ignore storage errors
    }
  }

  const fromEnv = getEnvWhatsAppGatewayUrl();
  if (fromEnv) return fromEnv;

  if (isStaticSpaHost()) {
    return DEFAULT_STANDALONE_GATEWAY_URL;
  }

  return '';
}

export function getDisplayWhatsAppGatewayUrl(overrideBaseUrl?: string): string {
  const base =
    overrideBaseUrl !== undefined
      ? normalizeWhatsAppGatewayUrl(overrideBaseUrl).normalized
      : getConfiguredWhatsAppGatewayUrl();
  if (base) return base;
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return DEFAULT_STANDALONE_GATEWAY_URL;
}

export async function loadPersistedWhatsAppGatewayUrl(): Promise<string> {
  const localCurrent = getConfiguredWhatsAppGatewayUrl();

  // 1. Check primary global `system_settings` table first
  try {
    const { data: sysRow, error: sysErr } = await supabase
      .from('system_settings')
      .select('config')
      .eq('id', 'global')
      .maybeSingle();

    const sysUrl =
      !sysErr && sysRow?.config && typeof sysRow.config === 'object'
        ? String((sysRow.config as Record<string, any>).baileysGatewayUrl || '').trim()
        : '';

    if (sysUrl) {
      const parsed = normalizeWhatsAppGatewayUrl(sysUrl);
      if (parsed.valid && parsed.normalized) {
        if (typeof window !== 'undefined') {
          try {
            window.localStorage.setItem(WHATSAPP_GATEWAY_URL_STORAGE_KEY, parsed.normalized);
          } catch {
            // ignore
          }
        }
        return parsed.normalized;
      }
    }
  } catch {
    // system_settings table may not exist yet; fall through to app_settings
  }

  // 2. Fallback to legacy `app_settings` table
  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'whatsapp_gateway_url')
      .maybeSingle();

    if (!error && data && typeof data.value === 'string' && data.value.trim()) {
      const parsed = normalizeWhatsAppGatewayUrl(data.value);
      if (parsed.valid && parsed.normalized) {
        if (typeof window !== 'undefined') {
          try {
            window.localStorage.setItem(WHATSAPP_GATEWAY_URL_STORAGE_KEY, parsed.normalized);
          } catch {
            // ignore
          }
        }
        return parsed.normalized;
      }
    }
  } catch {
    // app_settings table may not exist yet; gracefully keep local/env value
  }
  return localCurrent;
}

export async function saveWhatsAppGatewayUrl(rawUrl: string): Promise<{
  ok: boolean;
  normalizedUrl: string;
  savedToSupabase: boolean;
  error?: string;
}> {
  const check = normalizeWhatsAppGatewayUrl(rawUrl);
  if (!check.valid) {
    return { ok: false, normalizedUrl: '', savedToSupabase: false, error: check.error };
  }

  if (typeof window !== 'undefined') {
    try {
      if (check.normalized) {
        window.localStorage.setItem(WHATSAPP_GATEWAY_URL_STORAGE_KEY, check.normalized);
      } else {
        window.localStorage.removeItem(WHATSAPP_GATEWAY_URL_STORAGE_KEY);
      }
    } catch {
      // ignore storage errors
    }
  }

  let savedToSupabase = false;
  const nowIso = new Date().toISOString();

  // Persist into `system_settings` (`id = 'global'`) so System Settings & WhatsApp Gateway stay unified
  try {
    const { data: existingRow } = await supabase
      .from('system_settings')
      .select('config')
      .eq('id', 'global')
      .maybeSingle();
    const mergedConfig = {
      ...(existingRow?.config && typeof existingRow.config === 'object'
        ? (existingRow.config as Record<string, any>)
        : {}),
      baileysGatewayUrl: check.normalized,
    };
    const { error: sysErr } = await supabase.from('system_settings').upsert(
      {
        id: 'global',
        config: mergedConfig,
        updated_at: nowIso,
      },
      { onConflict: 'id' }
    );
    if (!sysErr) {
      savedToSupabase = true;
    }
  } catch {
    // fallback to app_settings below
  }

  try {
    const { error } = await supabase.from('app_settings').upsert(
      [
        {
          key: 'whatsapp_gateway_url',
          value: check.normalized,
          updated_at: nowIso,
        },
      ],
      { onConflict: 'key' }
    );
    if (!error) {
      savedToSupabase = true;
    }
  } catch {
    // Graceful fallback: localStorage already persisted the URL
  }

  return {
    ok: true,
    normalizedUrl: check.normalized,
    savedToSupabase,
  };
}

export interface SafeWhatsAppApiResult<T = any> {
  ok: boolean;
  httpStatus: number;
  data: T | null;
  error: string | null;
  isGatewayUnreachable: boolean;
  gatewayUrl: string;
}

export function buildGatewayUnreachableMessage(gatewayUrl: string): string {
  return `Baileys WhatsApp Gateway Server is unreachable at ${gatewayUrl}. Start the Node.js Baileys server or set your Gateway URL below.`;
}

/**
 * Safely calls any /api/whatsapp/* endpoint on either the configured external Baileys server
 * or the same-origin integrated server. Inspects content-type and raw response text BEFORE
 * parsing JSON so SPA HTML fallbacks (e.g. Netlify index.html `<!doctype html>`) NEVER throw
 * `Unexpected token '<', "<!doctype "... is not valid JSON`.
 */
export async function safeWhatsAppApiFetch<T = any>(
  endpointPath: string,
  init?: RequestInit,
  overrideBaseUrl?: string
): Promise<SafeWhatsAppApiResult<T>> {
  const normalizedBase =
    overrideBaseUrl !== undefined
      ? normalizeWhatsAppGatewayUrl(overrideBaseUrl).normalized
      : getConfiguredWhatsAppGatewayUrl();

  const cleanPath = endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`;
  const fullUrl = normalizedBase ? `${normalizedBase}${cleanPath}` : cleanPath;
  const displayGateway = getDisplayWhatsAppGatewayUrl(overrideBaseUrl);

  try {
    const res = await fetch(fullUrl, init);
    const contentType = String(res.headers.get('content-type') || '').toLowerCase();
    const rawText = await res.text();
    const trimmed = rawText.trim();

    if (!contentType.includes('application/json') || trimmed.startsWith('<')) {
      return {
        ok: false,
        httpStatus: res.status,
        data: null,
        error: buildGatewayUnreachableMessage(displayGateway),
        isGatewayUnreachable: true,
        gatewayUrl: displayGateway,
      };
    }

    let parsed: any = null;
    try {
      parsed = trimmed ? JSON.parse(trimmed) : {};
    } catch {
      return {
        ok: false,
        httpStatus: res.status,
        data: null,
        error: buildGatewayUnreachableMessage(displayGateway),
        isGatewayUnreachable: true,
        gatewayUrl: displayGateway,
      };
    }

    return {
      ok: res.ok,
      httpStatus: res.status,
      data: parsed as T,
      error: res.ok ? null : parsed?.error || `Gateway returned HTTP ${res.status}`,
      isGatewayUnreachable: false,
      gatewayUrl: displayGateway,
    };
  } catch {
    return {
      ok: false,
      httpStatus: 0,
      data: null,
      error: buildGatewayUnreachableMessage(displayGateway),
      isGatewayUnreachable: true,
      gatewayUrl: displayGateway,
    };
  }
}

/**
 * Zero-click background dispatcher calling POST ${gatewayUrl}/api/whatsapp/send.
 * Uses the configured Baileys Gateway URL and safe JSON parsing.
 * Never opens wa.me popups and never throws into calling UI/billing transactions.
 */
export async function triggerAutoWhatsAppNotification(payload: {
  eventType: WhatsAppEventType;
  subscriberUsername?: string | null;
  subscriber?: Partial<SupabasePortalUser> | null;
  messageVars?: Partial<AutomatedMessageTemplateVars> & { phone?: string | null };
  to?: string | null;
  groupJid?: string | null;
  customMessage?: string | null;
  manualTrigger?: boolean;
}): Promise<AutoWhatsAppTriggerResponse> {
  const rawPhone = payload.messageVars?.phone || payload.subscriber?.phone || '';
  const explicitTo = String(payload.to || '').trim();
  const formattedPhone = payload.groupJid
    ? payload.groupJid
    : explicitTo
    ? formatWhatsAppGroupJid(explicitTo) || formatWhatsAppDisplayPhone(explicitTo)
    : formatWhatsAppDisplayPhone(rawPhone);
  if (typeof window === 'undefined') {
    return { ok: false, status: 'SKIPPED', formattedPhone, skippedReason: 'Non-browser environment' };
  }
  const result = await safeWhatsAppApiFetch<any>('/api/whatsapp/send', {
    method: 'POST',
    headers: buildPortalAuthHeaders(),
    body: JSON.stringify({
      ...payload,
      to: explicitTo || payload.groupJid || undefined,
      phone: rawPhone || undefined,
      groupJid: payload.groupJid || undefined,
      customMessage: payload.customMessage || undefined,
    }),
  });

  if (result.isGatewayUnreachable || !result.data) {
    return {
      ok: false,
      status: 'FAILED',
      formattedPhone,
      isGatewayUnreachable: result.isGatewayUnreachable,
      error: result.error || 'Unable to reach WhatsApp gateway API',
    };
  }

  const data = result.data;
  if (!result.ok) {
    return {
      ok: false,
      status: data?.status || 'FAILED',
      formattedPhone,
      senderCompanyName: data?.senderCompanyName,
      error: data?.error || result.error || `HTTP ${result.httpStatus}`,
    };
  }

  return {
    ok: Boolean(data?.ok),
    status: data?.status || (data?.ok ? 'SENT' : 'FAILED'),
    formattedPhone,
    senderCompanyName: data?.senderCompanyName,
    senderPhone: data?.senderPhone || null,
    error: data?.error,
    skippedReason: data?.skippedReason,
  };
}

export interface SendPortalCredentialsWhatsAppResult extends AutoWhatsAppTriggerResponse {
  formattedPhone: string;
}

/**
 * Zero-click background dispatcher calling POST ${gatewayUrl}/api/whatsapp/send
 * for newly created portal account credentials.
 * Routes hierarchically (Sub-Dealer -> Dealer -> Master Admin) and signs with the
 * resolved sender's configured Company Display Name & Support Helpline footer.
 */
export async function sendWhatsAppCredentialsViaGateway(payload: {
  phone: string;
  username: string;
  fullName: string;
  password: string;
  role: string;
  portalUrl: string;
  subscriber?: Partial<SupabasePortalUser> | null;
}): Promise<SendPortalCredentialsWhatsAppResult> {
  const formattedPhone = formatWhatsAppDisplayPhone(payload.phone);
  if (typeof window === 'undefined') {
    return {
      ok: false,
      status: 'SKIPPED',
      formattedPhone,
      skippedReason: 'Non-browser environment',
    };
  }

  const result = await safeWhatsAppApiFetch<any>('/api/whatsapp/send', {
    method: 'POST',
    headers: buildPortalAuthHeaders(),
    body: JSON.stringify({
      eventType: 'PORTAL_CREDENTIALS',
      phone: payload.phone,
      subscriberUsername: payload.username,
      subscriber: payload.subscriber || {
        username: payload.username,
        full_name: payload.fullName,
        phone: payload.phone,
      },
      messageVars: {
        subscriberName: payload.fullName,
        username: payload.username,
        password: payload.password,
        accountRole: payload.role,
        packageName: payload.role,
        portalUrl: payload.portalUrl,
        phone: payload.phone,
      },
    }),
  });

  if (result.isGatewayUnreachable || !result.data) {
    return {
      ok: false,
      status: 'FAILED',
      formattedPhone,
      isGatewayUnreachable: result.isGatewayUnreachable,
      error: result.error || 'Unable to reach WhatsApp gateway API',
    };
  }

  const data = result.data;
  if (!result.ok) {
    return {
      ok: false,
      status: data?.status || 'FAILED',
      formattedPhone,
      senderCompanyName: data?.senderCompanyName,
      error: data?.error || result.error || `HTTP ${result.httpStatus}`,
    };
  }

  return {
    ok: Boolean(data?.ok),
    status: data?.status || (data?.ok ? 'SENT' : 'FAILED'),
    formattedPhone,
    senderCompanyName: data?.senderCompanyName,
    senderPhone: data?.senderPhone || null,
    error: data?.error,
    skippedReason: data?.skippedReason,
  };
}

export const GLOBAL_TOAST_EVENT = 'youthnet:global-toast';

export function emitGlobalToast(
  message: string,
  type: 'success' | 'warning' | 'error' = 'success'
): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(GLOBAL_TOAST_EVENT, { detail: { message, type } }));
  } catch {
    // ignore
  }
}

async function resolveTeamWorkGroupJidForDispatch(explicitGroupJid?: string | null): Promise<string | null> {
  const direct = formatWhatsAppGroupJid(explicitGroupJid);
  if (direct) return direct;

  // 1. Primary source: Supabase `system_settings` (`id = 'global'`)
  try {
    const { data, error } = await supabase
      .from('system_settings')
      .select('config')
      .eq('id', 'global')
      .maybeSingle();
    if (!error && data?.config && typeof data.config === 'object') {
      const cfg = data.config as Record<string, any>;
      const fromSystem = formatWhatsAppGroupJid(
        cfg.team_work_group_jid || cfg.teamWhatsAppGroupJid || cfg.team_whatsapp_group_jid || cfg.groupJid
      );
      if (fromSystem) return fromSystem;
    }
  } catch {
    // fallback below
  }

  // 2. Secondary source: Supabase `app_settings` (`whatsapp_team_group_config`)
  try {
    const user = getStoredUser();
    const keys = user?.id
      ? [`whatsapp_team_group_config:${user.id}`, 'whatsapp_team_group_config']
      : ['whatsapp_team_group_config'];
    const { data, error } = await supabase
      .from('app_settings')
      .select('key, value')
      .in('key', keys);
    if (!error && Array.isArray(data)) {
      const scoped = user?.id
        ? data.find((r: any) => r.key === `whatsapp_team_group_config:${user.id}`)
        : null;
      const globalRow = data.find((r: any) => r.key === 'whatsapp_team_group_config');
      for (const row of [scoped, globalRow]) {
        if (!row?.value) continue;
        try {
          const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
          const jid = formatWhatsAppGroupJid(parsed?.groupJid);
          if (jid) return jid;
        } catch {
          // ignore malformed row
        }
      }
    }
  } catch {
    // fallback below
  }

  // 3. Fallback: Local cached settings in localStorage
  if (typeof window !== 'undefined') {
    try {
      const rawSys = window.localStorage.getItem('youthnet_global_system_settings');
      if (rawSys) {
        const parsed = JSON.parse(rawSys);
        const jid = formatWhatsAppGroupJid(
          parsed?.team_work_group_jid || parsed?.teamWhatsAppGroupJid || parsed?.team_whatsapp_group_jid
        );
        if (jid) return jid;
      }
      const rawGroup = window.localStorage.getItem('youthnet_whatsapp_team_group');
      if (rawGroup) {
        const parsed = JSON.parse(rawGroup);
        const jid = formatWhatsAppGroupJid(parsed?.groupJid);
        if (jid) return jid;
      }
    } catch {
      // ignore localStorage read errors
    }
  }

  return null;
}

async function resolveAssignedAgentPhoneForDispatch(params: {
  assignedAgentId?: string | null;
  assignedAgentName?: string | null;
  assignedAgentPhone?: string | null;
}): Promise<{ phone: string; fullName?: string }> {
  const directPhone = String(params.assignedAgentPhone || '').trim();
  if (isValidWhatsAppPhone(directPhone)) {
    return { phone: directPhone, fullName: params.assignedAgentName || undefined };
  }

  const cleanAgentId = String(params.assignedAgentId || '').trim();
  const cleanAgentName = String(params.assignedAgentName || '').trim();
  if (!cleanAgentId && !cleanAgentName) {
    return { phone: '' };
  }

  try {
    if (cleanAgentId && cleanAgentId !== 'AUTO') {
      const { data } = await supabase
        .from('portal_users')
        .select('id, full_name, phone, whatsapp_phone, whatsapp_support_phone')
        .eq('id', cleanAgentId)
        .maybeSingle();
      if (data) {
        const row = data as any;
        const foundPhone = String(
          row.whatsapp_phone || row.phone || row.whatsapp_support_phone || ''
        ).trim();
        return { phone: foundPhone, fullName: row.full_name || cleanAgentName || undefined };
      }
    }

    if (cleanAgentName && !/^(field support team|noc support|unassigned)$/i.test(cleanAgentName)) {
      const { data } = await supabase
        .from('portal_users')
        .select('id, full_name, phone, whatsapp_phone, whatsapp_support_phone')
        .ilike('full_name', cleanAgentName)
        .limit(1)
        .maybeSingle();
      if (data) {
        const row = data as any;
        const foundPhone = String(
          row.whatsapp_phone || row.phone || row.whatsapp_support_phone || ''
        ).trim();
        return { phone: foundPhone, fullName: row.full_name || cleanAgentName };
      }
    }
  } catch {
    // ignore lookup failure
  }

  return { phone: '' };
}

export interface ComplaintWhatsAppDispatchResult {
  clientResult: AutoWhatsAppTriggerResponse;
  groupResult: AutoWhatsAppTriggerResponse;
  agentResult: AutoWhatsAppTriggerResponse;
  resolvedGroupJid: string | null;
  resolvedAgentPhone: string | null;
}

/**
 * Formats a concise, exact toast message summarizing which of the 3 complaint recipients
 * (Client, Team Group, Assigned Agent) received WhatsApp alerts and any missing fields/errors.
 */
export function formatComplaintDispatchToastSummary(
  ticketId: string,
  result: ComplaintWhatsAppDispatchResult
): { message: string; type: 'success' | 'warning' } {
  const sentTo: string[] = [];
  const notes: string[] = [];

  if (result.clientResult.ok && result.clientResult.status === 'SENT') {
    sentTo.push('Client');
  } else {
    notes.push(
      `Client: ${result.clientResult.skippedReason || result.clientResult.error || 'not sent'}`
    );
  }

  if (result.groupResult.ok && result.groupResult.status === 'SENT') {
    sentTo.push('Team Group');
  } else {
    notes.push(
      `Team Group: ${result.groupResult.skippedReason || result.groupResult.error || 'not sent'}`
    );
  }

  if (result.agentResult.ok && result.agentResult.status === 'SENT') {
    sentTo.push('Assigned Agent');
  } else {
    notes.push(
      `Agent: ${result.agentResult.skippedReason || result.agentResult.error || 'not sent'}`
    );
  }

  const formatList = (items: string[]) =>
    items.length <= 1
      ? items[0] || ''
      : `${items.slice(0, -1).join(', ')} & ${items[items.length - 1]}`;

  if (sentTo.length === 3) {
    return {
      message: `Ticket #${ticketId} created: WhatsApp sent to Client, Team Group & Assigned Agent`,
      type: 'success',
    };
  }

  if (sentTo.length > 0) {
    return {
      message: `Ticket #${ticketId} created: WhatsApp sent to ${formatList(sentTo)} (${notes.join(' | ')})`,
      type: 'warning',
    };
  }

  return {
    message: `Ticket #${ticketId} created — WhatsApp alerts skipped/failed (${notes.join(' | ')})`,
    type: 'warning',
  };
}

/**
 * Automated Complaint Creation WhatsApp Dispatch (3 Parallel Dispatches):
 *  a) Confirmation message to the Client's phone number (`COMPLAINT_CREATED_CLIENT`)
 *  b) Dispatch alert to the configured Team WhatsApp Work Group (`COMPLAINT_CREATED_GROUP`, `@g.us`)
 *  c) Assigned Ticket Alert directly to the Assigned Field Agent's WhatsApp (`COMPLAINT_ASSIGNED_AGENT`)
 */
export async function dispatchComplaintCreatedWhatsApp(payload: {
  ticketId: string;
  subscriberUsername: string;
  clientName?: string | null;
  phone?: string | null;
  area?: string | null;
  address?: string | null;
  issue: string;
  assignedAgentId?: string | null;
  assignedAgentName?: string | null;
  assignedAgentPhone?: string | null;
  subscriber?: Partial<SupabasePortalUser> | null;
  groupJid?: string | null;
}): Promise<ComplaintWhatsAppDispatchResult> {
  const cleanUser = String(payload.subscriberUsername || '').trim();
  let subData: Partial<SupabasePortalUser> | null = payload.subscriber ? { ...payload.subscriber } : null;

  const [freshSubRes, resolvedGroupJid, resolvedAgent] = await Promise.all([
    cleanUser && (!subData?.phone || !subData?.address || !subData?.area)
      ? Promise.resolve(
          supabase
            .from('portal_users')
            .select('id, username, full_name, phone, area, address, dealer_id, sub_dealer_id')
            .ilike('username', cleanUser)
            .maybeSingle()
        ).catch(() => ({ data: null }))
      : Promise.resolve({ data: null }),
    resolveTeamWorkGroupJidForDispatch(payload.groupJid),
    resolveAssignedAgentPhoneForDispatch({
      assignedAgentId: payload.assignedAgentId,
      assignedAgentName: payload.assignedAgentName,
      assignedAgentPhone: payload.assignedAgentPhone,
    }),
  ]);

  if (freshSubRes?.data) {
    subData = { ...(freshSubRes.data as Partial<SupabasePortalUser>), ...(subData || {}) };
  }

  const clientName = payload.clientName || subData?.full_name || cleanUser || 'Subscriber';
  const clientPhone = payload.phone || subData?.phone || '';
  const area = payload.area || subData?.area || 'Main Service Area';
  const address = payload.address || subData?.address || 'On file';
  const agentName = resolvedAgent.fullName || payload.assignedAgentName || 'Field Support Team';
  const agentPhone = resolvedAgent.phone || '';

  const baseVars = {
    subscriberName: clientName,
    username: cleanUser,
    phone: clientPhone,
    area,
    address,
    ticketId: payload.ticketId,
    issue: payload.issue,
    agentName,
  };

  const subscriberRef = {
    ...(subData || {}),
    username: cleanUser,
    full_name: clientName,
    phone: clientPhone,
  };

  // 1. To Client
  const clientPromise: Promise<AutoWhatsAppTriggerResponse> = isValidWhatsAppPhone(clientPhone)
    ? triggerAutoWhatsAppNotification({
        eventType: 'COMPLAINT_CREATED_CLIENT',
        manualTrigger: true,
        subscriberUsername: cleanUser,
        subscriber: subscriberRef,
        to: clientPhone,
        messageVars: baseVars,
      })
    : Promise.resolve({
        ok: false,
        status: 'SKIPPED',
        skippedReason: 'Subscriber phone missing',
      });

  // 2. To Team WhatsApp Work Group (@g.us)
  const groupPromise: Promise<AutoWhatsAppTriggerResponse> = resolvedGroupJid
    ? triggerAutoWhatsAppNotification({
        eventType: 'COMPLAINT_CREATED_GROUP',
        manualTrigger: true,
        subscriberUsername: cleanUser,
        subscriber: subscriberRef,
        to: resolvedGroupJid,
        groupJid: resolvedGroupJid,
        messageVars: baseVars,
      })
    : Promise.resolve({
        ok: false,
        status: 'SKIPPED',
        skippedReason: 'Team Work Group JID (@g.us) not configured',
      });

  // 3. To Assigned Field Agent
  const hasAssignedAgent = Boolean(
    payload.assignedAgentId ||
      (payload.assignedAgentName &&
        !/^(field support team|noc support|unassigned)$/i.test(payload.assignedAgentName.trim()))
  );
  const agentPromise: Promise<AutoWhatsAppTriggerResponse> = isValidWhatsAppPhone(agentPhone)
    ? triggerAutoWhatsAppNotification({
        eventType: 'COMPLAINT_ASSIGNED_AGENT',
        manualTrigger: true,
        subscriberUsername: cleanUser,
        subscriber: subscriberRef,
        to: agentPhone,
        messageVars: baseVars,
      })
    : Promise.resolve({
        ok: false,
        status: 'SKIPPED',
        skippedReason: hasAssignedAgent
          ? 'Assigned Agent phone missing in portal_users'
          : 'No field agent assigned',
      });

  const [clientResult, groupResult, agentResult] = await Promise.all([
    clientPromise,
    groupPromise,
    agentPromise,
  ]);

  return {
    clientResult,
    groupResult,
    agentResult,
    resolvedGroupJid,
    resolvedAgentPhone: agentPhone || null,
  };
}

/**
 * Automated Complaint Resolved WhatsApp Dispatch:
 * Sends `COMPLAINT_RESOLVED_CLIENT` to the client's phone via Baileys.
 */
export async function dispatchComplaintResolvedWhatsApp(payload: {
  ticketId: string;
  subscriberUsername: string;
  clientName?: string | null;
  phone?: string | null;
  area?: string | null;
  issue?: string | null;
  resolvedByName?: string | null;
  subscriber?: Partial<SupabasePortalUser> | null;
}): Promise<AutoWhatsAppTriggerResponse> {
  const cleanUser = String(payload.subscriberUsername || '').trim();
  let subData: Partial<SupabasePortalUser> | null = payload.subscriber ? { ...payload.subscriber } : null;

  if (cleanUser && !isValidWhatsAppPhone(payload.phone || subData?.phone)) {
    try {
      const { data: freshSub } = await supabase
        .from('portal_users')
        .select('id, username, full_name, phone, area, dealer_id, sub_dealer_id')
        .ilike('username', cleanUser)
        .maybeSingle();
      if (freshSub) {
        subData = { ...(freshSub as Partial<SupabasePortalUser>), ...(subData || {}) };
      }
    } catch {
      // keep existing
    }
  }

  const clientPhone = payload.phone || subData?.phone || '';
  if (!isValidWhatsAppPhone(clientPhone)) {
    return {
      ok: false,
      status: 'SKIPPED',
      skippedReason: 'Subscriber phone missing for complaint resolved notice',
    };
  }

  return triggerAutoWhatsAppNotification({
    eventType: 'COMPLAINT_RESOLVED_CLIENT',
    manualTrigger: true,
    subscriberUsername: cleanUser,
    subscriber: {
      ...(subData || {}),
      username: cleanUser,
      full_name: payload.clientName || subData?.full_name || cleanUser,
      phone: clientPhone,
    },
    messageVars: {
      subscriberName: payload.clientName || subData?.full_name || cleanUser,
      username: cleanUser,
      phone: clientPhone,
      area: payload.area || subData?.area || 'Main Service Area',
      ticketId: payload.ticketId,
      issue: payload.issue || 'Internet Service Fault',
      agentName: payload.resolvedByName || 'Technical Support Team',
    },
  });
}

/**
 * Dual Payment Receipt Automation:
 * Simultaneously dispatches:
 *  a) Paid Receipt (`PAYMENT_RESTORED`) to the Client
 *  b) Cash Collection Confirmation (`AGENT_PAYMENT_RECEIPT`) to the Recovery Agent's phone
 */
export async function dispatchDualPaymentReceiptWhatsApp(payload: {
  invoiceNo: string;
  subscriberUsername: string;
  subscriber?: Partial<SupabasePortalUser> | null;
  clientName?: string | null;
  clientPhone?: string | null;
  packageName?: string | null;
  amountPaid: number;
  totalAmount?: number;
  remainingBalance?: number;
  paymentMethod?: string | null;
  expiryDate?: string | null;
  anchoredDueDate?: string | null;
  agentId?: string | null;
  agentName?: string | null;
  agentPhone?: string | null;
  agentUpdatedCashBalance?: number | null;
}): Promise<{
  clientResult: AutoWhatsAppTriggerResponse;
  agentResult: AutoWhatsAppTriggerResponse;
}> {
  const cleanUser = String(payload.subscriberUsername || '').trim();
  let resolvedSub: Partial<SupabasePortalUser> | null = payload.subscriber
    ? { ...payload.subscriber }
    : null;

  if (cleanUser && !isValidWhatsAppPhone(payload.clientPhone || resolvedSub?.phone)) {
    try {
      const { data: freshSub } = await supabase
        .from('portal_users')
        .select('id, username, full_name, phone, package_speed, dealer_id, sub_dealer_id')
        .ilike('username', cleanUser)
        .maybeSingle();
      if (freshSub) {
        resolvedSub = { ...(freshSub as Partial<SupabasePortalUser>), ...(resolvedSub || {}) };
      }
    } catch {
      // keep fallback
    }
  }

  let resolvedAgentPhone = String(payload.agentPhone || '').trim();
  let resolvedAgentName = String(payload.agentName || '').trim() || 'Recovery Agent';
  let resolvedAgentBalance = payload.agentUpdatedCashBalance;

  if (payload.agentId && (!isValidWhatsAppPhone(resolvedAgentPhone) || resolvedAgentBalance === undefined || resolvedAgentBalance === null)) {
    try {
      const { data: agentRow } = await supabase
        .from('portal_users')
        .select('id, full_name, phone, cash_in_hand')
        .eq('id', payload.agentId)
        .maybeSingle();
      if (agentRow) {
        if (!isValidWhatsAppPhone(resolvedAgentPhone) && agentRow.phone) {
          resolvedAgentPhone = String(agentRow.phone);
        }
        if (agentRow.full_name) resolvedAgentName = String(agentRow.full_name);
        if (resolvedAgentBalance === undefined || resolvedAgentBalance === null) {
          resolvedAgentBalance = Number(agentRow.cash_in_hand) || 0;
        }
      }
    } catch {
      // keep existing
    }
  }

  const clientPhone = payload.clientPhone || resolvedSub?.phone || '';
  const clientName = payload.clientName || resolvedSub?.full_name || cleanUser || 'Subscriber';
  const pkgName = payload.packageName || resolvedSub?.package_speed || 'Fiber Broadband';

  const clientPromise: Promise<AutoWhatsAppTriggerResponse> = isValidWhatsAppPhone(clientPhone)
    ? triggerAutoWhatsAppNotification({
        eventType: 'PAYMENT_RESTORED',
        manualTrigger: true,
        subscriberUsername: cleanUser,
        subscriber: {
          ...(resolvedSub || {}),
          username: cleanUser,
          full_name: clientName,
          phone: clientPhone,
        },
        messageVars: {
          subscriberName: clientName,
          username: cleanUser,
          phone: clientPhone,
          packageName: pkgName,
          invoiceNo: payload.invoiceNo,
          amountPaid: payload.amountPaid,
          totalAmount: payload.totalAmount ?? payload.amountPaid,
          remainingBalance: payload.remainingBalance ?? 0,
          paymentMethod: payload.paymentMethod || 'Cash',
          expiryDate: payload.expiryDate || undefined,
          anchoredDueDate: payload.anchoredDueDate || undefined,
          agentName: resolvedAgentName,
        },
      })
    : Promise.resolve({
        ok: false,
        status: 'FAILED',
        formattedPhone: formatWhatsAppDisplayPhone(clientPhone),
        error: 'Subscriber phone number missing. Please update contact number first.',
      });

  const agentPromise: Promise<AutoWhatsAppTriggerResponse> = isValidWhatsAppPhone(resolvedAgentPhone)
    ? triggerAutoWhatsAppNotification({
        eventType: 'AGENT_PAYMENT_RECEIPT',
        manualTrigger: true,
        subscriberUsername: cleanUser,
        subscriber: {
          ...(resolvedSub || {}),
          username: cleanUser,
          full_name: clientName,
          phone: resolvedAgentPhone,
        },
        messageVars: {
          subscriberName: clientName,
          username: cleanUser,
          phone: resolvedAgentPhone,
          packageName: pkgName,
          invoiceNo: payload.invoiceNo,
          amountPaid: payload.amountPaid,
          paymentMethod: payload.paymentMethod || 'Cash',
          agentName: resolvedAgentName,
          agentBalance: resolvedAgentBalance ?? 0,
        },
      })
    : Promise.resolve({
        ok: false,
        status: 'SKIPPED',
        skippedReason: 'Collecting recovery agent phone number not set',
      });

  const [clientResult, agentResult] = await Promise.all([clientPromise, agentPromise]);
  return { clientResult, agentResult };
}
