import type { SupabaseClient } from '@supabase/supabase-js';

export interface IspBillingSettingsRecord {
  id: number;
  expiry_ppp_profile: string;
  suspension_mode: 'EXPIRED_PROFILE' | 'DISABLE_SECRET' | string;
  grace_hours: number;
  cutoff_time_pkt: string;
  jazzcash_title: string;
  jazzcash_number: string;
  easypaisa_title: string;
  easypaisa_number: string;
  bank_name: string;
  bank_account_title: string;
  bank_iban: string;
  google_maps_api_key?: string | null;
  updated_at?: string;
}

export const DEFAULT_ISP_BILLING_SETTINGS: IspBillingSettingsRecord = {
  id: 1,
  expiry_ppp_profile: 'EXPIRED-16-POOL',
  suspension_mode: 'EXPIRED_PROFILE',
  grace_hours: 24,
  cutoff_time_pkt: '14:00',
  jazzcash_title: '',
  jazzcash_number: '',
  easypaisa_title: '',
  easypaisa_number: '',
  bank_name: '',
  bank_account_title: '',
  bank_iban: '',
  google_maps_api_key: '',
};

export function isMissingTableOrColumnError(err: any): boolean {
  const code = String(err?.code || '');
  const msg = String(err?.message || '').toLowerCase();
  return (
    code === 'PGRST205' ||
    code === 'PGRST204' ||
    code === '42P01' ||
    code === '42703' ||
    msg.includes('schema cache') ||
    msg.includes('does not exist')
  );
}

/**
 * Parse an expiry_date into an exact UTC epoch ms.
 * Date-only strings ("YYYY-MM-DD") default to PKT (UTC+5) cut-off time (default 14:00 PKT = 09:00 UTC).
 */
export function parseExpiryDateWithCutoffMs(
  rawExpiry?: string | null,
  cutoffTimePkt: string = '14:00'
): number | null {
  if (!rawExpiry) return null;
  const clean = String(rawExpiry).trim();
  if (!clean) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    const [hhRaw, mmRaw] = String(cutoffTimePkt || '14:00').split(':');
    const hh = String(Math.min(23, Math.max(0, parseInt(hhRaw || '14', 10) || 14))).padStart(2, '0');
    const mm = String(Math.min(59, Math.max(0, parseInt(mmRaw || '0', 10) || 0))).padStart(2, '0');
    const iso = `${clean}T${hh}:${mm}:00+05:00`;
    const ms = Date.parse(iso);
    return Number.isNaN(ms) ? null : ms;
  }

  const ms = Date.parse(clean);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Bilingual Urdu/English 3-Day Advance Payment Slip built from persistent isp_billing_settings.
 */
export function buildBilingualPaymentSlip(params: {
  fullName: string;
  username: string;
  packageLabel: string;
  amountDue: number;
  expiryDateLabel: string;
  settings: IspBillingSettingsRecord;
  supportWhatsapp?: string;
}): string {
  const support = params.supportWhatsapp || '+923234193599';
  const lines: string[] = [
    `*Youth Net Service — Renewal Reminder / تجدیدِ انٹرنیٹ نوٹس*`,
    `Assalam-o-Alaikum *${params.fullName || params.username}* (\`@${params.username}\`)`,
    ``,
    `Apka *${params.packageLabel}* internet package *${params.expiryDateLabel}* ko 2:00 PM PKT par expire ho raha hai.`,
    `آپ کا انٹرنیٹ کنکشن مقررہ تاریخ کو دوپہر 2:00 بجے ایکسپائر ہو جائے گا۔`,
    ``,
    `• *Payable Amount / واجب الادا رقم:* Rs. ${Math.round(params.amountDue).toLocaleString()}`,
    `• *Grace Period:* ${params.settings.grace_hours} Hours (cut-off ke baad ${params.settings.grace_hours} ghante grace milega, phir line 16.16.16.0/24 expired pool par shift ho jayegi).`,
    ``,
    `*Online Payment Accounts (ادائیگی کے اکاؤنٹس):*`,
  ];

  if (params.settings.jazzcash_number) {
    lines.push(
      `• *JazzCash:* ${params.settings.jazzcash_number}${
        params.settings.jazzcash_title ? ` (${params.settings.jazzcash_title})` : ''
      }`
    );
  }
  if (params.settings.easypaisa_number) {
    lines.push(
      `• *EasyPaisa:* ${params.settings.easypaisa_number}${
        params.settings.easypaisa_title ? ` (${params.settings.easypaisa_title})` : ''
      }`
    );
  }
  if (params.settings.bank_iban || params.settings.bank_name) {
    lines.push(
      `• *Bank (${params.settings.bank_name || 'Bank Transfer'}):* ${
        params.settings.bank_iban || '-'
      }${params.settings.bank_account_title ? ` (${params.settings.bank_account_title})` : ''}`
    );
  }

  lines.push(
    ``,
    `Payment karne ke baad screenshot WhatsApp *${support}* par send karein — apki service 5 seconds mein restore/renew ho jayegi.`,
    `ادائیگی کے بعد اسکرین شاٹ واٹس ایپ کریں۔ شکریہ!`
  );

  return lines.join('\n');
}

export async function loadBillingSettingsFromDb(
  supabase: SupabaseClient
): Promise<{ settings: IspBillingSettingsRecord; waConfig: any; tableExists: boolean }> {
  let settings: IspBillingSettingsRecord = { ...DEFAULT_ISP_BILLING_SETTINGS };
  let tableExists = true;

  const [settingsRes, waRes, accountsRes] = await Promise.all([
    supabase.from('isp_billing_settings').select('*').eq('id', 1).maybeSingle(),
    supabase.from('whatsapp_billing_config').select('*').limit(1).maybeSingle(),
    supabase.from('payment_accounts').select('*').eq('is_active', true),
  ]);

  if (settingsRes.error && isMissingTableOrColumnError(settingsRes.error)) {
    tableExists = false;
  } else if (settingsRes.data) {
    const d = settingsRes.data as any;
    settings = {
      id: Number(d.id) || 1,
      expiry_ppp_profile: String(d.expiry_ppp_profile || 'EXPIRED-16-POOL').trim(),
      suspension_mode:
        String(d.suspension_mode || 'EXPIRED_PROFILE').toUpperCase() === 'DISABLE_SECRET'
          ? 'DISABLE_SECRET'
          : 'EXPIRED_PROFILE',
      grace_hours: Number.isFinite(Number(d.grace_hours)) ? Number(d.grace_hours) : 24,
      cutoff_time_pkt: String(d.cutoff_time_pkt || '14:00').trim(),
      jazzcash_title: String(d.jazzcash_title || ''),
      jazzcash_number: String(d.jazzcash_number || ''),
      easypaisa_title: String(d.easypaisa_title || ''),
      easypaisa_number: String(d.easypaisa_number || ''),
      bank_name: String(d.bank_name || ''),
      bank_account_title: String(d.bank_account_title || ''),
      bank_iban: String(d.bank_iban || ''),
      google_maps_api_key: String(d.google_maps_api_key || ''),
      updated_at: d.updated_at,
    };
  }

  const wa = waRes.data as any;
  if (wa) {
    if (!settings.jazzcash_number && wa.jazzcash_number) {
      settings.jazzcash_title = String(wa.jazzcash_title || '');
      settings.jazzcash_number = String(wa.jazzcash_number || '');
    }
    if (!settings.easypaisa_number && wa.easypaisa_number) {
      settings.easypaisa_title = String(wa.easypaisa_title || '');
      settings.easypaisa_number = String(wa.easypaisa_number || '');
    }
    if (!settings.bank_iban && (wa.bank_iban_or_acc || wa.bank_name)) {
      settings.bank_name = String(wa.bank_name || '');
      settings.bank_account_title = String(wa.bank_account_title || '');
      settings.bank_iban = String(wa.bank_iban_or_acc || '');
    }
  }

  if (Array.isArray(accountsRes.data)) {
    for (const acc of accountsRes.data as any[]) {
      const type = String(acc.account_type || '').toUpperCase();
      if (type === 'JAZZCASH' && !settings.jazzcash_number) {
        settings.jazzcash_title = String(acc.account_title || '');
        settings.jazzcash_number = String(acc.account_number_or_iban || '');
      } else if (type === 'EASYPAISA' && !settings.easypaisa_number) {
        settings.easypaisa_title = String(acc.account_title || '');
        settings.easypaisa_number = String(acc.account_number_or_iban || '');
      } else if ((type === 'BANK' || type === 'RAST') && !settings.bank_iban) {
        settings.bank_name = String(acc.provider_name || '');
        settings.bank_account_title = String(acc.account_title || '');
        settings.bank_iban = String(acc.account_number_or_iban || '');
      }
    }
  }

  return { settings, waConfig: wa || null, tableExists };
}
