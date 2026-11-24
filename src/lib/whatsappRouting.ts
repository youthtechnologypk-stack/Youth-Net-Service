import {
  supabase,
  type SupabasePaymentAccount,
  type SupabasePortalUser,
  type WhatsAppEventType,
} from '../services/supabaseClient';
import { getStoredToken, getStoredUser } from './auth';

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
 * Converts a raw phone number into a valid Baileys JID (`923001234567@s.whatsapp.net`).
 */
export function formatWhatsAppJid(phone?: string | null): string | null {
  const digits = formatWhatsAppDigits(phone);
  if (!digits) return null;
  return `${digits}@s.whatsapp.net`;
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
  dueDate?: string | null;
  expiryDate?: string | null;
  daysRemaining?: number | null;
  invoiceNo?: string | null;
  paymentMethod?: string | null;
  paymentAccounts?: SupabasePaymentAccount[];
  customNote?: string | null;
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
  const supportLine = vars.supportPhone ? `\nSupport Helpline: ${vars.supportPhone}` : '';
  const paymentBlock = formatPaymentAccountLines(vars.paymentAccounts);

  switch (vars.eventType) {
    case 'PROVISION_WELCOME': {
      const feeText =
        Number(vars.monthlyFee) > 0
          ? `\n• *Monthly Package Fee:* Rs. ${Math.round(Number(vars.monthlyFee)).toLocaleString()}`
          : '';
      const expText = vars.expiryDate ? `\n• *Next Renewal Date:* ${vars.expiryDate}` : '';
      return (
        `*Welcome to ${company}!*\n\n` +
        `Dear *${clientName}*,\n` +
        `Your high-speed Fiber Broadband connection is now *ACTIVE*.\n\n` +
        `• *PPPoE Username:* ${uname || 'N/A'}\n` +
        `• *Password:* ${vars.password || 'As configured'}\n` +
        `• *Internet Package:* ${vars.packageName || 'Fiber Broadband'}` +
        feeText +
        expText +
        `\n\nThank you for choosing *${company}*.` +
        supportLine
      );
    }

    case 'PORTAL_CREDENTIALS': {
      const roleText = vars.accountRole ? `\n• *Account Role:* ${vars.accountRole}` : '';
      const portalLink = vars.portalUrl ? `\n• *Portal Link:* ${vars.portalUrl}` : '';
      return (
        `*Welcome to ${company}!*\n\n` +
        `Dear *${clientName}*,\n` +
        `Your portal login account has been created and is now active.\n\n` +
        `• *Username:* ${uname || 'N/A'}\n` +
        `• *Password:* ${vars.password || 'As configured'}` +
        roleText +
        portalLink +
        `\n\nPlease keep your login details secure.\n— *${company}*` +
        supportLine
      );
    }

    case 'INVOICE_GENERATED': {
      const amt = Math.round(Number(vars.amountDue ?? vars.totalAmount ?? vars.monthlyFee ?? 0));
      const invLine = vars.invoiceNo ? `\n• *Invoice #:* ${vars.invoiceNo}` : '';
      return (
        `*${company} — Monthly Bill Issued*\n\n` +
        `Dear *${clientName}* (${uname}),\n` +
        `Your monthly broadband invoice has been generated.` +
        invLine +
        `\n• *Package:* ${vars.packageName || 'Fiber Broadband'}` +
        `\n• *Amount Due:* Rs. ${amt.toLocaleString()}` +
        `\n• *Due Date:* ${vars.dueDate || vars.expiryDate || 'Within 3 days'}` +
        paymentBlock +
        `\n\nPlease pay on time to enjoy uninterrupted service.\n— *${company}*` +
        supportLine
      );
    }

    case 'PRE_EXPIRY_3D': {
      const amt = Math.round(Number(vars.amountDue ?? vars.monthlyFee ?? 0));
      const daysText =
        vars.daysRemaining !== undefined && vars.daysRemaining !== null
          ? vars.daysRemaining <= 0
            ? 'TODAY'
            : `in ${vars.daysRemaining} day(s)`
          : 'within 3 days';
      return (
        `*${company} — Renewal Reminder*\n\n` +
        `Dear *${clientName}* (${uname}),\n` +
        `Your internet package (${vars.packageName || 'Fiber Broadband'}) is due to expire *${daysText}* (${vars.expiryDate || vars.dueDate || 'Upcoming'}).\n\n` +
        `• *Amount Due:* Rs. ${amt.toLocaleString()}` +
        paymentBlock +
        `\n\nKindly clear your bill before the due date to avoid automatic disconnection.\n— *${company}*` +
        supportLine
      );
    }

    case 'AUTO_SUSPENSION': {
      const amt = Math.round(Number(vars.amountDue ?? vars.monthlyFee ?? 0));
      return (
        `*${company} — Service Temporarily Suspended*\n\n` +
        `Dear *${clientName}* (${uname}),\n` +
        `Your broadband internet connection has been automatically isolated (Expired Pool) due to unpaid dues.\n\n` +
        `• *Outstanding Due:* Rs. ${amt.toLocaleString()}\n` +
        `• *Package:* ${vars.packageName || 'Fiber Broadband'}` +
        paymentBlock +
        `\n\nYour connection will be *instantly restored* as soon as payment is received.\n— *${company}*` +
        supportLine
      );
    }

    case 'PAYMENT_RESTORED': {
      const paid = Math.round(Number(vars.amountPaid ?? vars.totalAmount ?? 0));
      const remaining = Math.max(0, Math.round(Number(vars.remainingBalance ?? 0)));
      const invLine = vars.invoiceNo ? `\n• *Receipt / Invoice #:* ${vars.invoiceNo}` : '';
      const methodLine = vars.paymentMethod ? `\n• *Method:* ${vars.paymentMethod}` : '';
      const nextLine = vars.expiryDate || vars.dueDate
        ? `\n• *Next Renewal Date:* ${vars.expiryDate || vars.dueDate}`
        : '';
      const statusText =
        remaining <= 0
          ? 'PAID IN FULL & INTERNET ACTIVE'
          : `PARTIAL PAYMENT RECEIVED (Remaining: Rs. ${remaining.toLocaleString()})`;
      return (
        `*${company} — Payment Receipt & Service Confirmation*\n\n` +
        `Dear *${clientName}* (${uname}),\n` +
        `Thank you! Your payment has been confirmed.` +
        invLine +
        `\n• *Amount Paid:* Rs. ${paid.toLocaleString()}` +
        `\n• *Remaining Balance:* Rs. ${remaining.toLocaleString()}` +
        methodLine +
        `\n• *Account Status:* ${statusText}` +
        nextLine +
        `\n\nThank you for staying connected with *${company}*!` +
        supportLine
      );
    }

    case 'MANUAL_TEST':
    default: {
      return (
        `*${company} — WhatsApp Gateway Active*\n\n` +
        `${vars.customNote || 'Automated multi-tenant WhatsApp notifications are connected and ready for zero-click delivery.'}\n\n` +
        `— *${company}*` +
        supportLine
      );
    }
  }
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
  try {
    const { error } = await supabase.from('app_settings').upsert(
      [
        {
          key: 'whatsapp_gateway_url',
          value: check.normalized,
          updated_at: new Date().toISOString(),
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
 * Zero-click background dispatcher calling POST /api/whatsapp/send-auto.
 * Uses the configured Baileys Gateway URL and safe JSON parsing.
 * Never opens wa.me popups and never throws into calling UI/billing transactions.
 */
export async function triggerAutoWhatsAppNotification(payload: {
  eventType: WhatsAppEventType;
  subscriberUsername?: string | null;
  subscriber?: Partial<SupabasePortalUser> | null;
  messageVars?: Partial<AutomatedMessageTemplateVars> & { phone?: string | null };
}): Promise<AutoWhatsAppTriggerResponse> {
  if (typeof window === 'undefined') {
    return { ok: false, status: 'SKIPPED', skippedReason: 'Non-browser environment' };
  }
  const result = await safeWhatsAppApiFetch<any>('/api/whatsapp/send-auto', {
    method: 'POST',
    headers: buildPortalAuthHeaders(),
    body: JSON.stringify(payload),
  });

  if (result.isGatewayUnreachable || !result.data) {
    return {
      ok: false,
      status: 'FAILED',
      isGatewayUnreachable: result.isGatewayUnreachable,
      error: result.error || 'Unable to reach WhatsApp gateway API',
    };
  }

  const data = result.data;
  if (!result.ok) {
    return {
      ok: false,
      status: data?.status || 'FAILED',
      senderCompanyName: data?.senderCompanyName,
      error: data?.error || result.error || `HTTP ${result.httpStatus}`,
    };
  }

  return {
    ok: Boolean(data?.ok),
    status: data?.status || (data?.ok ? 'SENT' : 'FAILED'),
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
