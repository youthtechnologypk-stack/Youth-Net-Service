import {
  PaymentAccountType,
  SupabaseInvoice,
  SupabasePaymentAccount,
  SupabasePortalUser,
  SupabaseWhatsappBillingConfig,
  supabase,
} from '../services/supabaseClient';
import { parseFlexibleDate } from './dateFilter';

export const DEFAULT_SUPPORT_WHATSAPP = '+923234193599';
export const WHATSAPP_CONFIG_STORAGE_KEY = 'youthnet_whatsapp_billing_config';
export const WHATSAPP_CONFIG_UPDATED_EVENT = 'youthnet_whatsapp_config_updated';

export const PAYMENT_ACCOUNT_TYPES: Array<{ value: PaymentAccountType; label: string }> = [
  { value: 'BANK', label: 'Bank Account (IBAN)' },
  { value: 'JAZZCASH', label: 'JazzCash Mobile Wallet' },
  { value: 'EASYPAISA', label: 'EasyPaisa Mobile Wallet' },
  { value: 'RAST', label: 'Raast ID' },
];

let configTableUnavailable = false;

export function getDefaultWhatsappConfig(): SupabaseWhatsappBillingConfig {
  return {
    support_whatsapp: DEFAULT_SUPPORT_WHATSAPP,
    cloud_api_enabled: false,
    webhook_url: '',
    phone_number_id: '',
    auto_remind_days_before: 3,
  };
}

export function loadLocalWhatsappConfig(): SupabaseWhatsappBillingConfig {
  const fallback = getDefaultWhatsappConfig();
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(WHATSAPP_CONFIG_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return {
      ...fallback,
      ...parsed,
      support_whatsapp: (parsed?.support_whatsapp || '').trim() || DEFAULT_SUPPORT_WHATSAPP,
    };
  } catch {
    return fallback;
  }
}

export async function fetchWhatsappBillingConfig(): Promise<SupabaseWhatsappBillingConfig> {
  const local = loadLocalWhatsappConfig();
  if (configTableUnavailable) return local;

  try {
    const { data, error } = await supabase
      .from('whatsapp_billing_config')
      .select('*')
      .limit(1)
      .maybeSingle();

    if (error) {
      if (error.code === 'PGRST205' || error.message?.includes('schema cache')) {
        configTableUnavailable = true;
      }
      return local;
    }

    if (data) {
      const merged: SupabaseWhatsappBillingConfig = {
        ...local,
        ...(data as SupabaseWhatsappBillingConfig),
        support_whatsapp:
          ((data as any).support_whatsapp || '').trim() || DEFAULT_SUPPORT_WHATSAPP,
      };
      try {
        localStorage.setItem(WHATSAPP_CONFIG_STORAGE_KEY, JSON.stringify(merged));
      } catch {}
      return merged;
    }
  } catch {
    // Graceful fallback to local config
  }
  return local;
}

export async function saveWhatsappBillingConfig(
  nextConfig: SupabaseWhatsappBillingConfig
): Promise<{ savedTo: 'supabase' | 'local'; config: SupabaseWhatsappBillingConfig }> {
  const normalized: SupabaseWhatsappBillingConfig = {
    ...getDefaultWhatsappConfig(),
    ...nextConfig,
    support_whatsapp: (nextConfig.support_whatsapp || '').trim() || DEFAULT_SUPPORT_WHATSAPP,
    updated_at: new Date().toISOString(),
  };

  try {
    localStorage.setItem(WHATSAPP_CONFIG_STORAGE_KEY, JSON.stringify(normalized));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(WHATSAPP_CONFIG_UPDATED_EVENT, { detail: normalized }));
    }
  } catch {}

  if (!configTableUnavailable) {
    try {
      const payload = {
        support_whatsapp: normalized.support_whatsapp,
        cloud_api_enabled: Boolean(normalized.cloud_api_enabled),
        webhook_url: normalized.webhook_url || null,
        phone_number_id: normalized.phone_number_id || null,
        auto_remind_days_before: Number(normalized.auto_remind_days_before) || 3,
        updated_at: normalized.updated_at,
      };

      if (normalized.id) {
        const { error } = await supabase
          .from('whatsapp_billing_config')
          .update(payload)
          .eq('id', normalized.id);
        if (!error) return { savedTo: 'supabase', config: normalized };
      } else {
        const { data: existing } = await supabase
          .from('whatsapp_billing_config')
          .select('id')
          .limit(1)
          .maybeSingle();

        if (existing?.id) {
          const { error } = await supabase
            .from('whatsapp_billing_config')
            .update(payload)
            .eq('id', existing.id);
          if (!error) {
            const withId = { ...normalized, id: existing.id };
            localStorage.setItem(WHATSAPP_CONFIG_STORAGE_KEY, JSON.stringify(withId));
            return { savedTo: 'supabase', config: withId };
          }
        } else {
          const { data: inserted, error } = await supabase
            .from('whatsapp_billing_config')
            .insert([payload])
            .select()
            .maybeSingle();
          if (!error && inserted) {
            const withId = { ...normalized, ...(inserted as SupabaseWhatsappBillingConfig) };
            localStorage.setItem(WHATSAPP_CONFIG_STORAGE_KEY, JSON.stringify(withId));
            return { savedTo: 'supabase', config: withId };
          }
        }
      }
    } catch {
      // Fall back to local storage silently
    }
  }

  return { savedTo: 'local', config: normalized };
}

export async function fetchPaymentAccounts(): Promise<SupabasePaymentAccount[]> {
  try {
    const { data, error } = await supabase
      .from('payment_accounts')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) {
      console.warn('fetchPaymentAccounts error:', error.message);
      return [];
    }
    return (data as SupabasePaymentAccount[]) || [];
  } catch (err) {
    console.error('fetchPaymentAccounts failed:', err);
    return [];
  }
}

/**
 * Formats Pakistani / international phone strings cleanly for https://wa.me/<digits>
 */
export function formatWhatsAppPhone(phone?: string | null): string {
  const digits = (phone || '').replace(/[^\d]/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) return digits.slice(2);
  if (digits.startsWith('03') && digits.length >= 11) return `92${digits.slice(1)}`;
  if (digits.startsWith('3') && digits.length === 10) return `92${digits}`;
  if (digits === '92') return '';
  return digits;
}

/**
 * Formats phone strings cleanly for tel:<number> URIs in Android Dialer / TWA wrappers
 */
export function formatTelPhone(phone?: string | null): string {
  const raw = (phone || '').trim();
  if (!raw) return '';
  const hasPlus = raw.startsWith('+');
  const digits = raw.replace(/[^\d]/g, '');
  if (!digits) return '';
  return hasPlus ? `+${digits}` : digits;
}

export function buildWhatsAppUrl(phone: string | null | undefined, messageText: string): string {
  const cleanPhone = formatWhatsAppPhone(phone);
  const encoded = encodeURIComponent(messageText);
  if (!messageText) {
    return cleanPhone ? `https://wa.me/${cleanPhone}` : 'https://wa.me/';
  }
  return cleanPhone
    ? `https://wa.me/${cleanPhone}?text=${encoded}`
    : `https://wa.me/?text=${encoded}`;
}

/**
 * Opens https://wa.me/... via a real external anchor click (target="_blank", rel="noopener noreferrer")
 * so Android TWA / Chrome Custom Tabs / APK wrappers trigger the OS App Link / Intent directly
 * into the native WhatsApp app instead of trapping a popup or getting blocked by window.open.
 */
export function openExternalWhatsAppUrl(url: string): void {
  if (typeof document === 'undefined' || !url) return;
  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer external';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function openWhatsAppLink(phone: string | null | undefined, messageText: string): void {
  const url = buildWhatsAppUrl(phone, messageText);
  openExternalWhatsAppUrl(url);
}

/**
 * Returns local calendar days remaining from today (0 = today, 1 = tomorrow, ..., -1 = yesterday).
 */
export function computeDaysUntilDate(dateStr?: string | null): number | null {
  const parsed = parseFlexibleDate(dateStr);
  if (!parsed) return null;
  const targetMidnight = new Date(
    parsed.getFullYear(),
    parsed.getMonth(),
    parsed.getDate(),
    0,
    0,
    0,
    0
  ).getTime();

  const now = new Date();
  const todayMidnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0,
    0,
    0,
    0
  ).getTime();

  return Math.round((targetMidnight - todayMidnight) / 86_400_000);
}

export function formatPaymentAccountsBulletList(
  accounts: SupabasePaymentAccount[]
): string {
  const activeAccounts = (accounts || []).filter((a) => a.is_active !== false);
  if (activeAccounts.length === 0) {
    return '• Please contact NOC Support for online bank/wallet account details.';
  }
  return activeAccounts
    .map(
      (acc) =>
        `• *${acc.provider_name}:* ${acc.account_number_or_iban} (Title: ${acc.account_title})`
    )
    .join('\n');
}

export function buildPreExpiryReminderMessage(params: {
  fullName: string;
  username: string;
  packageSpeed: string;
  daysRemaining: number;
  expiryDate: string;
  invoiceNo: string;
  amountDue: number;
  activePaymentAccounts: SupabasePaymentAccount[];
  supportWhatsapp?: string | null;
}): string {
  const supportNo = (params.supportWhatsapp || '').trim() || DEFAULT_SUPPORT_WHATSAPP;
  const accountsBlock = formatPaymentAccountsBulletList(params.activePaymentAccounts);

  return `*YOUTH NET SERVICE — Billing & Expiry Reminder* 🌐
Dear *${params.fullName}* (\`${params.username}\`),
Your *${params.packageSpeed}* internet package will expire in *${params.daysRemaining} day(s)* on *${params.expiryDate}*.

*Invoice #:* ${params.invoiceNo}
*Payable Amount:* Rs. ${Number(params.amountDue || 0).toLocaleString()}

*Online Payment Accounts:*
${accountsBlock}

Please share payment screenshot on *${supportNo}* after transfer to avoid service interruption.
— *Youth Net Service NOC* (\`${supportNo}\`)`;
}

export function buildInstantPaymentReceiptMessage(params: {
  fullName: string;
  username: string;
  invoiceNo: string;
  amountPaid: number;
  totalAmount: number;
  remainingBalance: number;
  paymentMethod?: string | null;
  collectorName?: string | null;
  nextExpiryDate?: string | null;
  activePaymentAccounts: SupabasePaymentAccount[];
  supportWhatsapp?: string | null;
}): string {
  const supportNo = (params.supportWhatsapp || '').trim() || DEFAULT_SUPPORT_WHATSAPP;
  const isSettled = params.remainingBalance <= 0;
  const statusLabel = isSettled ? 'PAID IN FULL (ACTIVE)' : 'PARTIAL PAYMENT RECEIVED';
  const accountsBlock = formatPaymentAccountsBulletList(params.activePaymentAccounts);

  const renewalOrBalanceSection = isSettled
    ? `*Next 31-Day Expiry:* ${params.nextExpiryDate || 'Extended +31 Days'}`
    : `*Remaining Balance:* Rs. ${Number(params.remainingBalance || 0).toLocaleString()}

*Online Payment Accounts (For Remaining Balance):*
${accountsBlock}`;

  return `*YOUTH NET SERVICE — Official Payment Receipt* ✅
Dear *${params.fullName}* (\`${params.username}\`),
Thank you! Your broadband payment has been recorded.

*Invoice #:* ${params.invoiceNo}
*Amount Paid:* Rs. ${Number(params.amountPaid || 0).toLocaleString()}
*Total Billed:* Rs. ${Number(params.totalAmount || 0).toLocaleString()}
*Status:* ${statusLabel}
*Method:* ${params.paymentMethod || 'Cash Handover'}
*Collector:* ${params.collectorName || 'Youth Net NOC'}
${renewalOrBalanceSection}

For billing queries or screenshots, contact WhatsApp *${supportNo}*.
— *Youth Net Service NOC* (\`${supportNo}\`)`;
}

export interface PreExpiryReminderItem {
  key: string;
  username: string;
  fullName: string;
  phone: string;
  area: string;
  packageSpeed: string;
  expiryDate: string;
  daysRemaining: number;
  invoiceId?: string;
  invoiceNo: string;
  amountDue: number;
  accountStatus: string;
}

/**
 * Builds the 3-day pre-expiry reminder queue (0 <= daysRemaining <= 3)
 * by combining active portal_users subscribers and unpaid invoices.
 */
export function buildPreExpiryReminderQueue(params: {
  subscribers: SupabasePortalUser[];
  invoices: SupabaseInvoice[];
  maxDays?: number;
}): PreExpiryReminderItem[] {
  const { subscribers, invoices, maxDays = 3 } = params;
  const subByUsername: Record<string, SupabasePortalUser> = {};
  for (const sub of subscribers || []) {
    const uname = (sub.username || '').trim().toLowerCase();
    if (uname) subByUsername[uname] = sub;
  }

  // Group unpaid invoices per subscriber (pick earliest due date)
  const unpaidByUsername: Record<string, SupabaseInvoice> = {};
  for (const inv of invoices || []) {
    const uname = (inv.subscriber_username || '').trim().toLowerCase();
    if (!uname) continue;
    const total = Number(inv.amount) || 0;
    const paid = Number(inv.paid_amount) || 0;
    const balance = Math.max(0, total - paid);
    const status = (inv.status || '').toUpperCase();
    if (status === 'PAID' || balance <= 0) continue;

    const existing = unpaidByUsername[uname];
    if (!existing || (inv.due_date && (!existing.due_date || inv.due_date < existing.due_date))) {
      unpaidByUsername[uname] = inv;
    }
  }

  const seenUsers = new Set<string>();
  const queue: PreExpiryReminderItem[] = [];

  for (const sub of subscribers || []) {
    if (sub.role !== 'CLIENT') continue;
    const uname = (sub.username || '').trim().toLowerCase();
    if (!uname || seenUsers.has(uname)) continue;
    seenUsers.add(uname);

    const statusUpper = (sub.account_status || 'ACTIVE').toUpperCase();
    const unpaidInv = unpaidByUsername[uname];
    if (statusUpper !== 'ACTIVE' && !unpaidInv) continue;

    const targetDate = unpaidInv?.due_date || sub.expiry_date;
    const daysRemaining = computeDaysUntilDate(targetDate);
    if (daysRemaining === null || daysRemaining < 0 || daysRemaining > maxDays) continue;

    const amountDue = unpaidInv
      ? Math.max(0, (Number(unpaidInv.amount) || 0) - (Number(unpaidInv.paid_amount) || 0))
      : Number(sub.monthly_fee) || 0;

    queue.push({
      key: `sub-${sub.id}-${uname}`,
      username: sub.username,
      fullName: sub.full_name || sub.username,
      phone: sub.phone || '',
      area: sub.area || 'Central Zone',
      packageSpeed: sub.package_speed || sub.package_profile_name || 'Fiber Broadband',
      expiryDate: targetDate || '',
      daysRemaining,
      invoiceId: unpaidInv?.id,
      invoiceNo: unpaidInv?.invoice_no || 'UPCOMING-RENEWAL',
      amountDue,
      accountStatus: statusUpper,
    });
  }

  // Also check unpaid invoices whose subscriber might not be in the subscribers slice
  for (const [uname, inv] of Object.entries(unpaidByUsername)) {
    if (seenUsers.has(uname)) continue;
    const daysRemaining = computeDaysUntilDate(inv.due_date);
    if (daysRemaining === null || daysRemaining < 0 || daysRemaining > maxDays) continue;
    const sub = subByUsername[uname];
    const amountDue = Math.max(0, (Number(inv.amount) || 0) - (Number(inv.paid_amount) || 0));

    queue.push({
      key: `inv-${inv.id}`,
      username: inv.subscriber_username,
      fullName: sub?.full_name || inv.subscriber_username,
      phone: sub?.phone || '',
      area: sub?.area || 'Central Zone',
      packageSpeed: sub?.package_speed || 'Fiber Broadband',
      expiryDate: inv.due_date,
      daysRemaining,
      invoiceId: inv.id,
      invoiceNo: inv.invoice_no,
      amountDue,
      accountStatus: (sub?.account_status || 'ACTIVE').toUpperCase(),
    });
  }

  return queue.sort((a, b) => a.daysRemaining - b.daysRemaining);
}
