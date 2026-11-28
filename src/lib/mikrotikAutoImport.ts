import {
  NetworkAreaNode,
  DEFAULT_NETWORK_AREAS,
  resolveAreaFromUsername,
} from './billingAndNetwork';
import { lookupPackageTariffPrice } from './packageTariffs';
import { sanitizeSpreadsheetCell } from './settlementLedgerExport';
import { MikrotikPppSecret } from '../types/isp';
import { SupabasePortalUser } from '../services/supabaseClient';

export interface ParsedMikrotikComment {
  fullName: string;
  phoneWhatsapp: string;
  commentArea: string | null;
}

export interface MikrotikAutoImportCandidate {
  username: string;
  password: string;
  profile: string;
  monthlyRate: number;
  status: 'ACTIVE' | 'EXPIRED';
  statusReason: string;
  isDisabled: boolean;
  isExpiryPool: boolean;
  fullName: string;
  phoneWhatsapp: string;
  coverageArea: string;
  rawComment: string;
  remoteAddress: string;
  isLikelySystemSecret: boolean;
}

export interface MikrotikAutoImportScanResult {
  totalSecrets: number;
  alreadyLinkedCount: number;
  alreadyLinkedUsernames: string[];
  candidates: MikrotikAutoImportCandidate[];
}

export interface MikrotikAutoImportResultRow {
  username: string;
  fullName: string;
  phoneWhatsapp: string;
  profile: string;
  monthlyRate: number;
  status: 'ACTIVE' | 'EXPIRED';
  coverageArea: string;
  outcome: 'CREATED' | 'SKIPPED_EXISTS' | 'FAILED';
  message: string;
}

const SYSTEM_OR_TEST_USERNAME_PATTERN =
  /^(office|guest|officeguest|test|testing|demo|temp|tmp|admin|noc|staff|backup|monitor|check|lab|router|mikrotik|isp|support|trial)/i;

/**
 * Normalizes a Pakistani mobile number into +923XXXXXXXXX format.
 */
export function normalizePakistaniPhone(raw?: string | null): string {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00923') && digits.length >= 14) {
    return `+92${digits.slice(4, 14)}`;
  }
  if (digits.startsWith('923') && digits.length >= 12) {
    return `+${digits.slice(0, 12)}`;
  }
  if (digits.startsWith('03') && digits.length >= 11) {
    return `+92${digits.slice(1, 11)}`;
  }
  if (digits.startsWith('3') && digits.length === 10) {
    return `+92${digits}`;
  }
  return '';
}

/**
 * Smart Comment Parser for MikroTik PPPoE secret comments:
 * - Extracts any Pakistani mobile number (03XXXXXXXXX, 03XX-XXXXXXX, +923XXXXXXXXX, 923XXXXXXXXX, 00923XXXXXXXXX)
 *   into normalized `phoneWhatsapp` (+923XXXXXXXXX).
 * - Handles pipe-separated formats like "Muhammad Waqas | 0300-1234567 | Baza Mohallah" cleanly.
 * - Uses the remaining cleaned text as `fullName`, falling back to `fallbackName` (secret.name) if empty.
 */
export function parseMikrotikSecretComment(
  comment: string | null | undefined,
  fallbackName: string
): ParsedMikrotikComment {
  const cleanFallback = String(fallbackName || '').trim() || 'Subscriber';
  const raw = String(comment || '').trim();
  if (!raw) {
    return {
      fullName: cleanFallback,
      phoneWhatsapp: '',
      commentArea: null,
    };
  }

  // Match Pakistani mobile numbers with optional spaces or hyphens
  const pkPhoneRegex = /(?:\+?92|0092|0)[\s-]*3\d{2}[\s-]*\d{7}\b|\b3\d{2}[\s-]*\d{7}\b/g;
  const matches = raw.match(pkPhoneRegex) || [];
  let phoneWhatsapp = '';
  let matchedRawPhone = '';

  for (const m of matches) {
    const normalized = normalizePakistaniPhone(m);
    if (normalized) {
      phoneWhatsapp = normalized;
      matchedRawPhone = m;
      break;
    }
  }

  // If comment is pipe-delimited (e.g. "Full Name | Phone | Coverage Area"), parse segments cleanly
  if (raw.includes('|')) {
    const segments = raw
      .split('|')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const nonPhoneSegments: string[] = [];
    for (const seg of segments) {
      const stripped = seg.replace(pkPhoneRegex, '').replace(/^[\s\-:,/()]+|[\s\-:,/()]+$/g, '').trim();
      if (stripped.length > 0) {
        nonPhoneSegments.push(stripped);
      }
    }

    const fullName = nonPhoneSegments[0] || cleanFallback;
    const commentArea = nonPhoneSegments.length >= 2 ? nonPhoneSegments[nonPhoneSegments.length - 1] : null;
    return {
      fullName,
      phoneWhatsapp,
      commentArea,
    };
  }

  // Otherwise strip extracted phone number and tidy remaining name text
  const withoutPhone = matchedRawPhone ? raw.replace(matchedRawPhone, ' ') : raw;
  const cleanedName = withoutPhone
    .replace(/\b(?:ph|phone|mob|mobile|cell|wa|whatsapp|tel)\b\s*[:#-]*/gi, ' ')
    .replace(/[|]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-:,/()]+|[\s\-:,/()]+$/g, '')
    .trim();

  return {
    fullName: cleanedName || cleanFallback,
    phoneWhatsapp,
    commentArea: null,
  };
}

/**
 * Determines whether a MikroTik secret is expired based on disabled flag or Expiry Pool profile match.
 */
export function isMikrotikSecretExpired(
  secret: Pick<MikrotikPppSecret, 'disabled' | 'profile'>,
  expiryProfileName: string
): { isExpired: boolean; isDisabled: boolean; isExpiryPool: boolean; reason: string } {
  const isDisabled =
    secret.disabled === true ||
    String(secret.disabled || '').trim().toLowerCase() === 'true' ||
    String(secret.disabled || '').trim().toLowerCase() === 'yes';

  const profileClean = String(secret.profile || '').trim();
  const profileLower = profileClean.toLowerCase();
  const expiryClean = String(expiryProfileName || '').trim().toLowerCase();

  const isExpiryPool =
    Boolean(expiryClean && profileLower === expiryClean) ||
    /(?:expir|walled|suspend|disconnect|disable|block)/i.test(profileClean);

  if (isDisabled && isExpiryPool) {
    return {
      isExpired: true,
      isDisabled: true,
      isExpiryPool: true,
      reason: 'Disabled + Expiry Pool',
    };
  }
  if (isDisabled) {
    return {
      isExpired: true,
      isDisabled: true,
      isExpiryPool: false,
      reason: 'Disabled on MikroTik',
    };
  }
  if (isExpiryPool) {
    return {
      isExpired: true,
      isDisabled: false,
      isExpiryPool: true,
      reason: `Expiry Pool (${profileClean || 'Expired'})`,
    };
  }

  return {
    isExpired: false,
    isDisabled: false,
    isExpiryPool: false,
    reason: 'Active PPPoE Profile',
  };
}

/**
 * Compares live MikroTik PPPoE secrets against Supabase portal_users and prepares
 * all unlinked secrets for 1-Click Auto-Import.
 */
export function classifyMikrotikSecretsForImport(params: {
  secrets: MikrotikPppSecret[];
  existingPortalUsers: Array<Pick<SupabasePortalUser, 'username'>>;
  expiryProfileName: string;
  tariffMap: Record<string, number>;
  networkAreas?: NetworkAreaNode[];
  defaultArea?: string;
}): MikrotikAutoImportScanResult {
  const existingSet = new Set<string>();
  for (const u of params.existingPortalUsers || []) {
    const uname = String(u?.username || '').trim().toLowerCase();
    if (uname) existingSet.add(uname);
  }

  const areas =
    params.networkAreas && params.networkAreas.length > 0
      ? params.networkAreas
      : DEFAULT_NETWORK_AREAS;
  const fallbackArea = String(params.defaultArea || 'Baza Mohallah').trim() || 'Baza Mohallah';

  const seenSecrets = new Set<string>();
  const alreadyLinkedUsernames: string[] = [];
  const candidates: MikrotikAutoImportCandidate[] = [];

  for (const rawSecret of params.secrets || []) {
    const exactUsername = String(rawSecret?.name || '').trim();
    if (!exactUsername) continue;

    const lower = exactUsername.toLowerCase();
    if (seenSecrets.has(lower)) continue;
    seenSecrets.add(lower);

    if (existingSet.has(lower)) {
      alreadyLinkedUsernames.push(exactUsername);
      continue;
    }

    const profile = String(rawSecret?.profile || 'default').trim() || 'default';
    const password = String(rawSecret?.password || '').trim() || 'fiber1234';
    const rawComment = String(rawSecret?.comment || '').trim();
    const remoteAddress = String(rawSecret?.['remote-address'] || '').trim();

    const parsedComment = parseMikrotikSecretComment(rawComment, exactUsername);
    const expiryInfo = isMikrotikSecretExpired(rawSecret, params.expiryProfileName);
    const tariffHit = lookupPackageTariffPrice(profile, params.tariffMap);
    const areaFromPrefix = resolveAreaFromUsername(exactUsername, areas);
    const coverageArea = parsedComment.commentArea || areaFromPrefix || fallbackArea;

    candidates.push({
      username: exactUsername,
      password,
      profile,
      monthlyRate: expiryInfo.isExpiryPool ? 0 : tariffHit.pricePkr,
      status: expiryInfo.isExpired ? 'EXPIRED' : 'ACTIVE',
      statusReason: expiryInfo.reason,
      isDisabled: expiryInfo.isDisabled,
      isExpiryPool: expiryInfo.isExpiryPool,
      fullName: parsedComment.fullName,
      phoneWhatsapp: parsedComment.phoneWhatsapp,
      coverageArea,
      rawComment,
      remoteAddress,
      isLikelySystemSecret: SYSTEM_OR_TEST_USERNAME_PATTERN.test(exactUsername),
    });
  }

  // Sort active real subscribers first, likely system/test accounts last
  candidates.sort((a, b) => {
    if (a.isLikelySystemSecret !== b.isLikelySystemSecret) {
      return a.isLikelySystemSecret ? 1 : -1;
    }
    return a.username.localeCompare(b.username);
  });

  return {
    totalSecrets: seenSecrets.size,
    alreadyLinkedCount: alreadyLinkedUsernames.length,
    alreadyLinkedUsernames,
    candidates,
  };
}

export function computeDefaultExpiryYmd(
  status: 'ACTIVE' | 'EXPIRED',
  validityDays = 31,
  baseDate = new Date()
): string {
  const d = new Date(baseDate.getTime());
  const days = status === 'ACTIVE' ? Math.max(1, Math.min(365, Math.round(validityDays || 31))) : 0;
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function buildAutoImportPayloads(
  candidate: MikrotikAutoImportCandidate,
  options: {
    billingCycleDay: number;
    validityDays: number;
    createdById?: string | null;
    nowIso?: string;
  }
): {
  id: string;
  fullPayload: Record<string, any>;
  minimalPayload: Record<string, any>;
} {
  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `mk-sub-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  const nowIso = options.nowIso || new Date().toISOString();
  const anchorDay = Math.max(1, Math.min(31, Math.round(options.billingCycleDay || 1)));
  const expiryYmd = computeDefaultExpiryYmd(candidate.status, options.validityDays);
  const isExpired = candidate.status === 'EXPIRED';

  const fullPayload: Record<string, any> = {
    id,
    username: candidate.username,
    password: candidate.password,
    role: 'CLIENT',
    full_name: candidate.fullName,
    phone: candidate.phoneWhatsapp || '+92 ',
    area: candidate.coverageArea,
    account_status: candidate.status,
    billing_status: isExpired ? 'SUSPENDED_EXPIRED' : 'ACTIVE',
    is_suspended: isExpired,
    package_speed: candidate.profile,
    package_name: candidate.profile,
    package_profile_name: candidate.profile,
    original_package_profile: candidate.profile,
    monthly_fee: candidate.monthlyRate,
    billing_anchor_day: anchorDay,
    expiry_date: expiryYmd,
    next_billing_date: expiryYmd,
    created_by_id: options.createdById || null,
    created_at: nowIso,
  };

  const minimalPayload: Record<string, any> = {
    id,
    username: candidate.username,
    password: candidate.password,
    role: 'CLIENT',
    full_name: candidate.fullName,
    phone: candidate.phoneWhatsapp || '+92 ',
    area: candidate.coverageArea,
    account_status: candidate.status,
    package_speed: candidate.profile,
    monthly_fee: candidate.monthlyRate,
    created_at: nowIso,
  };

  return { id, fullPayload, minimalPayload };
}

export function downloadAutoImportResultsCsv(results: MikrotikAutoImportResultRow[]): void {
  const headers = [
    'PPPoE Username',
    'Full Name',
    'Phone / WhatsApp',
    'MikroTik Profile',
    'Monthly Rate (Rs.)',
    'Account Status',
    'Coverage Area',
    'Import Result',
    'Details',
  ];

  const escapeCsv = (val: unknown) => {
    const safe = String(sanitizeSpreadsheetCell(String(val ?? '')) ?? '');
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };

  const lines = [
    headers.join(','),
    ...results.map((r) =>
      [
        r.username,
        r.fullName,
        r.phoneWhatsapp,
        r.profile,
        r.monthlyRate,
        r.status,
        r.coverageArea,
        r.outcome,
        r.message,
      ]
        .map(escapeCsv)
        .join(',')
    ),
  ];

  if (typeof window === 'undefined') return;
  const now = new Date();
  const ymd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`;
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `YouthNet_MikroTik_AutoImport_Results_${ymd}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
