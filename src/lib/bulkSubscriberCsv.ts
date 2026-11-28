import * as XLSX from 'xlsx';
import { sanitizeSpreadsheetCell } from './settlementLedgerExport';
import { lookupPackageTariffPrice } from './packageTariffs';
import { SupabaseInvoice, SupabasePortalUser } from '../services/supabaseClient';

export const BULK_CSV_HEADERS = [
  'full_name',
  'pppoe_username',
  'pppoe_password',
  'phone_whatsapp',
  'package_profile',
  'coverage_area',
  'address',
  'dealer_username',
  'billing_cycle_day',
  'initial_status',
] as const;

export const MAX_BULK_CSV_ROWS = 2000;
export const MAX_BULK_CSV_BYTES = 5 * 1024 * 1024; // 5 MB

export type BulkRowValidationStatus = 'VALID' | 'AUTO_LINK' | 'INVALID';

export interface MikrotikExistingSecretLite {
  username: string;
  password?: string;
  profile?: string;
  comment?: string;
  remoteAddress?: string;
}

export interface ParsedBulkSubscriberRow {
  rowNumber: number;
  full_name: string;
  pppoe_username: string;
  pppoe_password: string;
  phone_whatsapp: string;
  package_profile: string;
  coverage_area: string;
  address: string;
  dealer_username: string;
  billing_cycle_day: number;
  initial_status: 'ACTIVE' | 'EXPIRED' | 'SUSPENDED';
  resolvedMonthlyRate: number;
  resolvedDealerId: string | null;
  resolvedSubDealerId: string | null;
  validationStatus: BulkRowValidationStatus;
  validationReason: string;
  mikrotikMatch?: MikrotikExistingSecretLite | null;
}

export interface BulkImportExecutionResultRow {
  rowNumber: number;
  pppoe_username: string;
  full_name: string;
  package_profile: string;
  monthly_rate: number;
  mode: 'AUTO_LINKED' | 'CREATED_NEW' | 'SKIPPED_INVALID' | 'FAILED';
  mikrotik_status: string;
  supabase_status: string;
  whatsapp_status: string;
  message: string;
}

/**
 * RFC-4180 compliant CSV parser handling quoted fields, embedded commas, escaped quotes (""),
 * UTF-8 BOM stripping, and CRLF/LF line endings.
 */
export function parseCsvText(rawText: string): string[][] {
  const cleaned = String(rawText || '').replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    const next = cleaned[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        currentCell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        currentCell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      currentRow.push(currentCell.trim());
      currentCell = '';
    } else if (ch === '\r' && next === '\n') {
      currentRow.push(currentCell.trim());
      if (currentRow.some((cell) => cell.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentCell = '';
      i++;
    } else if (ch === '\n' || ch === '\r') {
      currentRow.push(currentCell.trim());
      if (currentRow.some((cell) => cell.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentCell = '';
    } else {
      currentCell += ch;
    }
  }

  currentRow.push(currentCell.trim());
  if (currentRow.some((cell) => cell.length > 0)) {
    rows.push(currentRow);
  }

  return rows;
}

export function normalizeInitialStatus(raw?: string | null): 'ACTIVE' | 'EXPIRED' | 'SUSPENDED' {
  const upper = String(raw || '').trim().toUpperCase();
  if (upper === 'ACTIVE' || upper === 'PAID' || upper === 'ONLINE') return 'ACTIVE';
  if (upper === 'SUSPENDED' || upper === 'DISABLED' || upper === 'BLOCKED') return 'SUSPENDED';
  if (upper === 'EXPIRED' || upper === 'DUE' || upper === 'EXPIRY' || upper === 'EXPIRY_POOL') {
    return 'EXPIRED';
  }
  return 'EXPIRED';
}

export function normalizeWhatsappPhone(raw?: string | null): string {
  const digits = String(raw || '').replace(/[^\d+]/g, '').trim();
  if (!digits) return '';
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  if (digits.startsWith('03') && digits.length === 11) return `+92${digits.slice(1)}`;
  if (digits.startsWith('923') && digits.length === 12) return `+${digits}`;
  if (digits.startsWith('3') && digits.length === 10) return `+92${digits}`;
  return digits;
}

export function buildSampleBulkCsvContent(): string {
  const header = BULK_CSV_HEADERS.join(',');
  const sampleRows = [
    [
      'Muhammad Waqas',
      'bzwaqas74',
      'fiber1234',
      '+923001234567',
      '4 MB - TW',
      'Baza Mohallah',
      'Street 4 House 12 Baza Mohallah',
      '',
      '1',
      'EXPIRED',
    ],
    [
      'Bilal Ahmed Khan',
      'dgibilal22',
      'net7860',
      '03125554321',
      '8 MB - Local',
      'Digi Mohallah',
      'Near Jamia Masjid Digi Mohallah',
      '',
      '10',
      'ACTIVE',
    ],
    [
      'Imran Qureshi',
      'saddarimran09',
      'pass9090',
      '+923459876543',
      '10 MB - TW',
      'Saddar Node',
      'Main Market Shop 9 Saddar',
      '',
      '15',
      'EXPIRED',
    ],
  ];

  const escapeCsv = (val: string) => {
    const safe = String(sanitizeSpreadsheetCell(val) ?? '');
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };

  return [header, ...sampleRows.map((r) => r.map(escapeCsv).join(','))].join('\r\n');
}

export function downloadBulkCsvTemplate(): void {
  const csv = buildSampleBulkCsvContent();
  triggerBlobDownload(csv, 'YouthNet_Bulk_Subscribers_Template.csv', 'text/csv;charset=utf-8;');
}

/**
 * Validates parsed CSV text against live MikroTik PPPoE secrets, dealers directory, and package tariffs.
 * Existing MikroTik secrets are marked as AUTO_LINK (never skipped or failed).
 */
export function parseAndValidateBulkCsv(params: {
  csvText: string;
  mikrotikSecretsMap: Map<string, MikrotikExistingSecretLite>;
  resellersList: SupabasePortalUser[];
  tariffMap: Record<string, number>;
  defaultArea?: string;
}): {
  rows: ParsedBulkSubscriberRow[];
  headerError?: string;
} {
  const matrix = parseCsvText(params.csvText);
  if (matrix.length < 2) {
    return {
      rows: [],
      headerError: 'CSV file must contain a header row and at least one subscriber row.',
    };
  }

  const rawHeaders = matrix[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const colIndex = (aliases: string[]): number => {
    for (const a of aliases) {
      const idx = rawHeaders.indexOf(a);
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const idxName = colIndex(['full_name', 'fullname', 'name', 'subscriber_name']);
  const idxUser = colIndex(['pppoe_username', 'username', 'pppoe', 'user']);
  const idxPass = colIndex(['pppoe_password', 'password', 'secret_password', 'pass']);
  const idxPhone = colIndex(['phone_whatsapp', 'phone', 'whatsapp', 'mobile', 'contact']);
  const idxPkg = colIndex(['package_profile', 'package', 'profile', 'plan', 'package_speed']);
  const idxArea = colIndex(['coverage_area', 'area', 'sector', 'node']);
  const idxAddr = colIndex(['address', 'street', 'location']);
  const idxDealer = colIndex(['dealer_username', 'dealer', 'reseller_username', 'assigned_dealer']);
  const idxDay = colIndex(['billing_cycle_day', 'billing_day', 'cycle_day', 'anchor_day']);
  const idxStatus = colIndex(['initial_status', 'status', 'account_status']);

  if (idxUser === -1) {
    return {
      rows: [],
      headerError: 'Missing required column "pppoe_username" in CSV header. Download the sample template to see expected columns.',
    };
  }

  const resellerByUsername = new Map<string, SupabasePortalUser>();
  for (const r of params.resellersList || []) {
    const uname = String(r.username || '').trim().toLowerCase();
    if (uname) resellerByUsername.set(uname, r);
  }

  const seenUsernames = new Set<string>();
  const dataRows = matrix.slice(1, MAX_BULK_CSV_ROWS + 1);
  const parsedRows: ParsedBulkSubscriberRow[] = [];

  for (let i = 0; i < dataRows.length; i++) {
    const cols = dataRows[i];
    const rowNumber = i + 2; // 1-indexed including header

    const getVal = (idx: number) => (idx >= 0 && idx < cols.length ? cols[idx].trim() : '');

    const rawUsername = getVal(idxUser).toLowerCase();
    const rawFullName = getVal(idxName);
    const rawPassword = getVal(idxPass);
    const rawPhone = getVal(idxPhone);
    const rawPackage = getVal(idxPkg);
    const rawArea = getVal(idxArea) || params.defaultArea || 'Baza Mohallah';
    const rawAddress = getVal(idxAddr);
    const rawDealer = getVal(idxDealer).replace(/^@/, '').toLowerCase();
    const rawDayStr = getVal(idxDay);
    const rawStatusStr = getVal(idxStatus);

    const mkMatch = rawUsername ? params.mikrotikSecretsMap.get(rawUsername) || null : null;

    const effectivePassword =
      rawPassword || (mkMatch?.password ? String(mkMatch.password).trim() : '') || 'fiber1234';
    const effectiveProfile =
      rawPackage || (mkMatch?.profile ? String(mkMatch.profile).trim() : '') || '4 MB - Local';
    const effectiveName =
      rawFullName ||
      rawUsername
        .replace(/[._-]/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .trim();
    const normalizedPhone = normalizeWhatsappPhone(rawPhone);

    const parsedDay = rawDayStr ? Math.round(Number(rawDayStr)) : 1;
    const billingCycleDay =
      Number.isFinite(parsedDay) && parsedDay >= 1 && parsedDay <= 31 ? parsedDay : 1;
    const initialStatus = normalizeInitialStatus(rawStatusStr);

    const tariffHit = lookupPackageTariffPrice(effectiveProfile, params.tariffMap);

    let resolvedDealerId: string | null = null;
    let resolvedSubDealerId: string | null = null;
    let dealerError = '';
    if (rawDealer) {
      const matchedDealer = resellerByUsername.get(rawDealer);
      if (!matchedDealer) {
        dealerError = `Unknown dealer_username "@${rawDealer}"`;
      } else {
        const tier = String(matchedDealer.tier_level || matchedDealer.role || '').toUpperCase();
        if (tier === 'SUB_DEALER') {
          resolvedSubDealerId = matchedDealer.id;
          resolvedDealerId = matchedDealer.parent_dealer_id || null;
        } else {
          resolvedDealerId = matchedDealer.id;
        }
      }
    }

    const errors: string[] = [];
    if (!rawUsername) {
      errors.push('pppoe_username is required');
    } else if (!/^[a-z0-9._@-]{2,64}$/i.test(rawUsername)) {
      errors.push('Invalid pppoe_username characters (use letters, numbers, ., _, -)');
    } else if (seenUsernames.has(rawUsername)) {
      errors.push('Duplicate pppoe_username in this CSV');
    }

    if (!rawFullName && !mkMatch) {
      errors.push('full_name is required');
    }
    if (!mkMatch && rawPassword && rawPassword.length < 3) {
      errors.push('pppoe_password must be at least 3 chars');
    }
    if (rawDayStr && (!Number.isFinite(Number(rawDayStr)) || Number(rawDayStr) < 1 || Number(rawDayStr) > 31)) {
      errors.push('billing_cycle_day must be 1–31');
    }
    if (dealerError) {
      errors.push(dealerError);
    }

    if (rawUsername) {
      seenUsernames.add(rawUsername);
    }

    let validationStatus: BulkRowValidationStatus = 'VALID';
    let validationReason = 'Ready to provision & import';
    if (errors.length > 0) {
      validationStatus = 'INVALID';
      validationReason = errors.join('; ');
    } else if (mkMatch) {
      validationStatus = 'AUTO_LINK';
      validationReason = `Exists on MikroTik (${mkMatch.profile || 'default'}) — will Auto-Link & upsert to Supabase`;
    }

    parsedRows.push({
      rowNumber,
      full_name: effectiveName,
      pppoe_username: rawUsername,
      pppoe_password: effectivePassword,
      phone_whatsapp: normalizedPhone || rawPhone,
      package_profile: effectiveProfile,
      coverage_area: rawArea,
      address: rawAddress,
      dealer_username: rawDealer,
      billing_cycle_day: billingCycleDay,
      initial_status: initialStatus,
      resolvedMonthlyRate: tariffHit.pricePkr,
      resolvedDealerId,
      resolvedSubDealerId,
      validationStatus,
      validationReason,
      mikrotikMatch: mkMatch,
    });
  }

  return { rows: parsedRows };
}

export function downloadBulkImportResultsCsv(results: BulkImportExecutionResultRow[]): void {
  const headers = [
    'Row #',
    'PPPoE Username',
    'Full Name',
    'Package Profile',
    'Monthly Rate (Rs.)',
    'Import Mode',
    'MikroTik Status',
    'Supabase Status',
    'WhatsApp Status',
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
        r.rowNumber,
        r.pppoe_username,
        r.full_name,
        r.package_profile,
        r.monthly_rate,
        r.mode,
        r.mikrotik_status,
        r.supabase_status,
        r.whatsapp_status,
        r.message,
      ]
        .map(escapeCsv)
        .join(',')
    ),
  ];

  const today = getLocalYmd();
  triggerBlobDownload(
    lines.join('\r\n'),
    `YouthNet_Bulk_Import_Results_${today}.csv`,
    'text/csv;charset=utf-8;'
  );
}

export interface SubscriberExportRowInput {
  user: Partial<SupabasePortalUser> & {
    id: string;
    username: string;
    fullName?: string;
    displayName?: string;
    assignedArea?: string;
    isActive?: boolean;
  };
  dealerName: string;
  netArrears: number;
  monthlyRate: number;
}

export const SUBSCRIBER_EXPORT_HEADERS = [
  'Full Name',
  'PPPoE Username',
  'Password',
  'Phone/WhatsApp',
  'Package Profile',
  'Monthly Rate (Rs.)',
  'Status',
  'Expiry Date',
  'Billing Cycle Day',
  'Coverage Area',
  'Address',
  'Assigned Dealer',
  'Net Arrears (Rs.)',
] as const;

export function buildSubscriberExportRows(params: {
  users: Array<
    Partial<SupabasePortalUser> & {
      id: string;
      username: string;
      fullName?: string;
      displayName?: string;
      assignedArea?: string;
      isActive?: boolean;
    }
  >;
  allPortalUsers: Array<Partial<SupabasePortalUser> & { id?: string; username?: string }>;
  invoices: SupabaseInvoice[];
  tariffMap: Record<string, number>;
}): Array<Record<(typeof SUBSCRIBER_EXPORT_HEADERS)[number], string | number>> {
  const dealerLookup = new Map<string, string>();
  for (const u of params.allPortalUsers || []) {
    if (u.id) {
      const label = u.full_name || u.username || u.id;
      dealerLookup.set(u.id, u.username ? `${label} (@${u.username})` : label);
    }
  }

  const arrearsByUsername = new Map<string, number>();
  for (const inv of params.invoices || []) {
    const statusUpper = String(inv.status || '').toUpperCase();
    if (statusUpper === 'PAID') continue;
    const uname = String(inv.subscriber_username || '').trim().toLowerCase();
    if (!uname) continue;
    const totalAmt = Number(inv.amount) || 0;
    const paidAmt = Number(inv.paid_amount) || 0;
    const pending = Math.max(0, totalAmt - paidAmt);
    if (pending > 0) {
      arrearsByUsername.set(uname, (arrearsByUsername.get(uname) || 0) + pending);
    }
  }

  return (params.users || []).map((u) => {
    const uname = String(u.username || '').trim();
    const unameLower = uname.toLowerCase();
    const pkg =
      u.original_package_profile ||
      u.package_profile_name ||
      u.package_name ||
      u.package_speed ||
      '—';
    const monthlyRate =
      Number(u.monthly_fee) > 0
        ? Math.round(Number(u.monthly_fee))
        : pkg !== '—'
        ? lookupPackageTariffPrice(pkg, params.tariffMap).pricePkr
        : 0;

    const statusUpper = String(u.account_status || '').toUpperCase();
    const billingUpper = String(u.billing_status || '').toUpperCase();
    const resolvedStatus =
      u.is_suspended === true || statusUpper === 'SUSPENDED'
        ? 'SUSPENDED'
        : statusUpper === 'EXPIRED' || billingUpper === 'SUSPENDED_EXPIRED'
        ? 'EXPIRED'
        : u.isActive === false
        ? 'SUSPENDED'
        : 'ACTIVE';

    const assignedDealerLabel = u.sub_dealer_id
      ? dealerLookup.get(u.sub_dealer_id) || 'Sub-Dealer'
      : u.dealer_id
      ? dealerLookup.get(u.dealer_id) || 'Dealer'
      : 'Master Direct ISP';

    const netArrears = Math.round(arrearsByUsername.get(unameLower) || 0);

    return {
      'Full Name': sanitizeSpreadsheetCell(u.full_name || u.fullName || u.displayName || uname),
      'PPPoE Username': sanitizeSpreadsheetCell(uname),
      Password: sanitizeSpreadsheetCell(u.password || ''),
      'Phone/WhatsApp': sanitizeSpreadsheetCell(u.phone || ''),
      'Package Profile': sanitizeSpreadsheetCell(pkg),
      'Monthly Rate (Rs.)': monthlyRate,
      Status: resolvedStatus,
      'Expiry Date': sanitizeSpreadsheetCell(u.expiry_date || u.next_billing_date || '—'),
      'Billing Cycle Day': Number(u.billing_anchor_day) || 1,
      'Coverage Area': sanitizeSpreadsheetCell(u.area || u.assignedArea || '—'),
      Address: sanitizeSpreadsheetCell(u.address || ''),
      'Assigned Dealer': sanitizeSpreadsheetCell(assignedDealerLabel),
      'Net Arrears (Rs.)': netArrears,
    };
  });
}

export function exportSubscribersToCsv(params: {
  users: Array<
    Partial<SupabasePortalUser> & {
      id: string;
      username: string;
      fullName?: string;
      displayName?: string;
      assignedArea?: string;
      isActive?: boolean;
    }
  >;
  allPortalUsers: Array<Partial<SupabasePortalUser> & { id?: string; username?: string }>;
  invoices: SupabaseInvoice[];
  tariffMap: Record<string, number>;
}): { filename: string; count: number } {
  const rows = buildSubscriberExportRows(params);
  const escapeCsv = (val: unknown) => {
    const str = String(val ?? '');
    return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };

  const csvLines = [
    SUBSCRIBER_EXPORT_HEADERS.join(','),
    ...rows.map((row) =>
      SUBSCRIBER_EXPORT_HEADERS.map((h) => escapeCsv(row[h])).join(',')
    ),
  ];

  const filename = `YouthNet_Subscribers_Export_${getLocalYmd()}.csv`;
  triggerBlobDownload(csvLines.join('\r\n'), filename, 'text/csv;charset=utf-8;');
  return { filename, count: rows.length };
}

export function exportSubscribersToExcel(params: {
  users: Array<
    Partial<SupabasePortalUser> & {
      id: string;
      username: string;
      fullName?: string;
      displayName?: string;
      assignedArea?: string;
      isActive?: boolean;
    }
  >;
  allPortalUsers: Array<Partial<SupabasePortalUser> & { id?: string; username?: string }>;
  invoices: SupabaseInvoice[];
  tariffMap: Record<string, number>;
}): { filename: string; count: number } {
  const rows = buildSubscriberExportRows(params);
  const wb = XLSX.utils.book_new();
  const aoa: Array<Array<string | number>> = [
    [...SUBSCRIBER_EXPORT_HEADERS],
    ...rows.map((row) => SUBSCRIBER_EXPORT_HEADERS.map((h) => row[h])),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [
    { wch: 24 },
    { wch: 20 },
    { wch: 16 },
    { wch: 18 },
    { wch: 18 },
    { wch: 16 },
    { wch: 12 },
    { wch: 14 },
    { wch: 16 },
    { wch: 18 },
    { wch: 28 },
    { wch: 24 },
    { wch: 16 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'Subscribers');
  const filename = `YouthNet_Subscribers_Export_${getLocalYmd()}.xlsx`;
  XLSX.writeFile(wb, filename);
  return { filename, count: rows.length };
}

function getLocalYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function triggerBlobDownload(content: string, filename: string, mimeType: string): void {
  if (typeof window === 'undefined') return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
