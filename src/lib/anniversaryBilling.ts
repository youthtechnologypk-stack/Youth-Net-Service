import type { SupabaseClient } from '@supabase/supabase-js';
import type { FieldAgent } from '../types/isp';
import type { SupabaseInvoice, SupabasePortalUser } from '../services/supabaseClient';
import { isMissingTableOrColumnError, parseExpiryDateWithCutoffMs } from './expiryUtils';
import { resolvePackageRate } from '../components/CreateInvoiceModal';
import { triggerAutoWhatsAppNotification } from './whatsappRouting';

export type NormalizedTicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export const FIELD_STAFF_ROLES = [
  'AGENT',
  'TECHNICIAN',
  'FIELD_AGENT',
  'RECOVERY',
  'agent',
  'technician',
  'field_agent',
  'recovery',
] as const;

export function isFieldStaffRole(role?: string | null): boolean {
  const upper = String(role || '').trim().toUpperCase();
  return (
    upper === 'AGENT' ||
    upper === 'TECHNICIAN' ||
    upper === 'FIELD_AGENT' ||
    upper === 'RECOVERY'
  );
}

/**
 * Normalizes any ticket priority label (including legacy 'NORMAL') to match Supabase tickets_priority_check.
 */
export function normalizeTicketPriority(raw?: string | null): NormalizedTicketPriority {
  const upper = String(raw || 'MEDIUM').trim().toUpperCase();
  if (upper === 'CRITICAL') return 'CRITICAL';
  if (upper === 'HIGH') return 'HIGH';
  if (upper === 'LOW') return 'LOW';
  // Map 'NORMAL', 'MED', 'MEDIUM', or unknown values to 'MEDIUM'
  return 'MEDIUM';
}

function isTicketPriorityConstraintError(error: any): boolean {
  const code = String(error?.code || '');
  const msg = String(error?.message || '').toLowerCase();
  return (
    code === '23514' ||
    msg.includes('tickets_priority_check') ||
    (msg.includes('check constraint') && msg.includes('priority'))
  );
}

/**
 * Inserts a ticket row into Supabase while normalizing priority and gracefully retrying
 * lowercase priority if a deployment has a lowercase check constraint.
 */
export async function insertTicketSafe(
  supabase: SupabaseClient,
  payload: Record<string, any>
): Promise<{ data: any; error: any }> {
  const normalizedPriority = normalizeTicketPriority(payload.priority);
  const normalizedStatus = String(payload.status || 'OPEN').trim().toUpperCase();

  const cleanPayload = {
    ...payload,
    priority: normalizedPriority,
    status: normalizedStatus,
  };

  let res = await supabase.from('tickets').insert([cleanPayload]).select().maybeSingle();
  if (res.error && isTicketPriorityConstraintError(res.error)) {
    res = await supabase
      .from('tickets')
      .insert([{ ...cleanPayload, priority: normalizedPriority.toLowerCase() }])
      .select()
      .maybeSingle();
  }
  return res;
}

/**
 * Updates a ticket row in Supabase while normalizing priority cleanly against tickets_priority_check.
 */
export async function updateTicketSafe(
  supabase: SupabaseClient,
  idOrTicketNoFilter: string,
  payload: Record<string, any>
): Promise<{ error: any }> {
  const normalizedPayload: Record<string, any> = { ...payload };
  if (normalizedPayload.priority !== undefined) {
    normalizedPayload.priority = normalizeTicketPriority(normalizedPayload.priority);
  }
  if (normalizedPayload.status !== undefined) {
    normalizedPayload.status = String(normalizedPayload.status).trim().toUpperCase();
  }

  let res = await supabase.from('tickets').update(normalizedPayload).or(idOrTicketNoFilter);
  if (res.error && isTicketPriorityConstraintError(res.error) && normalizedPayload.priority) {
    res = await supabase
      .from('tickets')
      .update({
        ...normalizedPayload,
        priority: String(normalizedPayload.priority).toLowerCase(),
      })
      .or(idOrTicketNoFilter);
  }
  return res;
}

export interface LiveFieldAgentLedger extends FieldAgent {
  username: string;
  role: string;
  tier_level?: string | null;
  dealer_id?: string | null;
  sub_dealer_id?: string | null;
  created_by_id?: string | null;
  parent_dealer_id?: string | null;
  account_status?: string | null;
  totalCashCollected: number;
  totalHandedOver: number;
  advanceBalance: number;
  netPayable: number;
  totalSalaryPaid: number;
  expensesRecorded: number;
}

/**
 * Fetches live field staff from Supabase portal_users + agent_cash_transactions +
 * payment_transactions + tickets + isp_expenses (gracefully ignoring missing optional tables).
 */
export async function fetchLiveFieldStaffWithBalances(
  supabase: SupabaseClient
): Promise<LiveFieldAgentLedger[]> {
  const [usersRes, cashTxRes, ticketsRes, expensesRes, billingLedgerRes, handoversRes] =
    await Promise.all([
      supabase
        .from('portal_users')
        .select('*')
        .in('role', [...FIELD_STAFF_ROLES])
        .order('full_name', { ascending: true }),
      supabase
        .from('agent_cash_transactions')
        .select('*')
        .order('created_at', { ascending: false }),
      supabase
        .from('tickets')
        .select('id, assigned_agent_id, assigned_agent_name, status')
        .neq('status', 'RESOLVED'),
      supabase.from('isp_expenses').select('*'),
      supabase.from('billing_ledger').select('*'),
      supabase.from('agent_handovers').select('*'),
    ]);

  let staffRows = (usersRes.data || []) as Array<Record<string, any>>;

  // Fallback: if filtered IN returned empty (e.g. mixed-case role), fetch non-CLIENT/non-ADMIN rows
  if (staffRows.length === 0) {
    const allRes = await supabase
      .from('portal_users')
      .select('*')
      .neq('role', 'CLIENT')
      .order('full_name', { ascending: true });
    staffRows = ((allRes.data || []) as Array<Record<string, any>>).filter((u) => {
      const r = String(u.role || '').trim().toUpperCase();
      const t = String(u.tier_level || '').trim().toUpperCase();
      return (
        r !== 'ADMIN' &&
        r !== 'CLIENT' &&
        r !== 'DEALER' &&
        r !== 'SUB_DEALER' &&
        t !== 'DEALER' &&
        t !== 'SUB_DEALER' &&
        u.account_status !== 'DELETED'
      );
    });
  }

  const cashTxns =
    cashTxRes.error && isMissingTableOrColumnError(cashTxRes.error)
      ? []
      : ((cashTxRes.data || []) as Array<Record<string, any>>);

  const openTickets =
    ticketsRes.error && isMissingTableOrColumnError(ticketsRes.error)
      ? []
      : ((ticketsRes.data || []) as Array<Record<string, any>>);

  const ispExpenses =
    expensesRes.error && isMissingTableOrColumnError(expensesRes.error)
      ? []
      : ((expensesRes.data || []) as Array<Record<string, any>>);

  const billingLedgerRows =
    billingLedgerRes.error && isMissingTableOrColumnError(billingLedgerRes.error)
      ? []
      : ((billingLedgerRes.data || []) as Array<Record<string, any>>);

  const handoverRows =
    handoversRes.error && isMissingTableOrColumnError(handoversRes.error)
      ? []
      : ((handoversRes.data || []) as Array<Record<string, any>>);

  const todayStr = new Date().toISOString().slice(0, 10);

  return staffRows.map((u) => {
    const id = String(u.id || '');
    const name = String(u.full_name || u.username || 'Field Agent').trim();
    const uname = String(u.username || '').trim().toLowerCase();
    const nameLower = name.toLowerCase();

    const matchesAgent = (row: Record<string, any>) => {
      const rid = String(row.agent_id || row.collected_by_id || '').trim();
      const rname = String(row.agent_name || row.collected_by_name || '').trim().toLowerCase();
      return (rid && rid === id) || (rname && rname === nameLower);
    };

    const agentTxns = cashTxns.filter(matchesAgent);
    let advTakenFromTxns = 0;
    let advReturnedFromTxns = 0;
    let totalHandedOver = 0;
    let totalSalaryPaid = 0;
    let totalCollectedFromTxns = 0;
    let collectedToday = 0;

    for (const tx of agentTxns) {
      const amt = Number(tx.amount) || 0;
      const t = String(tx.transaction_type || '').toUpperCase();
      if (t === 'ADVANCE_TAKEN' || t === 'ADVANCE_DISBURSED') {
        advTakenFromTxns += amt;
      } else if (t === 'ADVANCE_RETURNED' || t === 'ADVANCE_REPAID') {
        advReturnedFromTxns += amt;
      } else if (t === 'CASH_HANDOVER' || t === 'HANDOVER') {
        totalHandedOver += amt;
      } else if (t === 'SALARY_PAYOUT' || t === 'SALARY_PAID') {
        totalSalaryPaid += amt;
      } else if (t === 'CASH_COLLECTED' || t === 'COLLECTION' || t === 'PAYMENT_COLLECTED') {
        totalCollectedFromTxns += amt;
        if (String(tx.created_at || '').slice(0, 10) === todayStr) {
          collectedToday += amt;
        }
      }
    }

    // Also include optional agent_handovers & billing_ledger if present
    for (const ho of handoverRows) {
      if (matchesAgent(ho)) {
        totalHandedOver += Number(ho.amount) || 0;
      }
    }
    for (const bl of billingLedgerRows) {
      if (matchesAgent(bl)) {
        totalCollectedFromTxns += Number(bl.credit || bl.amount || 0);
      }
    }

    const expensesRecorded = ispExpenses
      .filter((exp) => {
        const title = String(exp.title || '').toLowerCase();
        const notes = String(exp.notes || '').toLowerCase();
        const vendor = String(exp.vendor_or_payee || '').toLowerCase();
        return (
          (nameLower && (title.includes(nameLower) || notes.includes(nameLower) || vendor.includes(nameLower))) ||
          (uname && (title.includes(uname) || notes.includes(uname)))
        );
      })
      .reduce((sum, exp) => sum + (Number(exp.amount) || 0), 0);

    const activeTicketsAssigned = openTickets.filter((t) => {
      const tid = String(t.assigned_agent_id || '').trim();
      const tname = String(t.assigned_agent_name || '').trim().toLowerCase();
      return (tid && tid === id) || (tname && tname === nameLower);
    }).length;

    const dbCash = u.cash_in_hand !== null && u.cash_in_hand !== undefined ? Number(u.cash_in_hand) : null;
    const cashInHand =
      dbCash !== null && !Number.isNaN(dbCash)
        ? Math.max(0, dbCash)
        : Math.max(0, totalCollectedFromTxns - totalHandedOver);

    const dbAdvance =
      u.advance_balance !== null && u.advance_balance !== undefined ? Number(u.advance_balance) : null;
    const computedAdvance = Math.max(0, advTakenFromTxns - advReturnedFromTxns);
    const advanceBalance =
      dbAdvance !== null && !Number.isNaN(dbAdvance) ? Math.max(0, dbAdvance) : computedAdvance;

    const baseSalary = Number(u.base_salary) || 0;
    const netPayable = Math.max(0, baseSalary - advanceBalance);
    const statusRaw = String(u.account_status || 'ACTIVE').toUpperCase();
    const status: FieldAgent['status'] =
      statusRaw === 'SUSPENDED' || statusRaw === 'OFFLINE' || statusRaw === 'INACTIVE'
        ? 'offline'
        : 'active';

    return {
      id,
      username: uname,
      role: String(u.role || 'AGENT').toUpperCase(),
      tier_level: u.tier_level ?? null,
      dealer_id: u.dealer_id ?? null,
      sub_dealer_id: u.sub_dealer_id ?? null,
      created_by_id: u.created_by_id ?? null,
      parent_dealer_id: u.parent_dealer_id ?? null,
      account_status: u.account_status ?? 'ACTIVE',
      name,
      phone: String(u.phone || ''),
      email: uname.includes('@') ? uname : `${uname || 'agent'}@youthnet.pk`,
      assignedArea: String(u.area || 'Saddar Node'),
      status,
      cashInHand,
      totalCollectedToday: collectedToday,
      activeTicketsAssigned,
      baseSalary,
      advanceSalaryTaken: Math.max(advanceBalance, advTakenFromTxns),
      advanceSalaryReturned: Math.max(0, Math.max(advanceBalance, advTakenFromTxns) - advanceBalance),
      totalCashCollected: totalCollectedFromTxns,
      totalHandedOver,
      advanceBalance,
      netPayable,
      totalSalaryPaid,
      expensesRecorded,
    };
  });
}

/**
 * Extracts a YYYY-MM-DD string from an ISO date or timestamp string.
 */
export function extractYmdString(raw?: string | null): string | null {
  const clean = String(raw || '').trim();
  if (!clean) return null;
  const ymdMatch = clean.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymdMatch) {
    return `${ymdMatch[1]}-${ymdMatch[2]}-${ymdMatch[3]}`;
  }
  const d = new Date(clean);
  if (Number.isNaN(d.getTime())) return null;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Extracts day-of-month anchor (1..31) from billing_anchor_day || installation_date || created_at.
 */
export function computeBillingAnchorDay(sub: {
  billing_anchor_day?: number | null;
  installation_date?: string | null;
  created_at?: string | null;
  expiry_date?: string | null;
}): number {
  const explicit = Number(sub.billing_anchor_day);
  if (Number.isFinite(explicit) && explicit >= 1 && explicit <= 31) {
    return Math.floor(explicit);
  }
  const raw = String(sub.installation_date || sub.created_at || '').trim();
  const ymdMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymdMatch) {
    const day = parseInt(ymdMatch[3], 10);
    if (day >= 1 && day <= 31) return day;
  }
  const parsed = raw ? new Date(raw) : null;
  if (parsed && !Number.isNaN(parsed.getTime())) {
    return parsed.getDate();
  }
  const expRaw = String(sub.expiry_date || '').trim();
  const expMatch = expRaw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (expMatch) {
    const day = parseInt(expMatch[3], 10);
    if (day >= 1 && day <= 31) return day;
  }
  return new Date().getDate();
}

/**
 * Builds YYYY-MM-DD for the given year & 0-indexed month, clamping anchorDay to month's max days
 * (e.g. Jan 31 -> Feb 28/29, Mar 31 -> Apr 30).
 */
export function buildCycleDateString(year: number, monthIndex0: number, anchorDay: number): string {
  const lastDay = new Date(year, monthIndex0 + 1, 0).getDate();
  const clampedDay = Math.min(Math.max(1, anchorDay), lastDay);
  const mm = String(monthIndex0 + 1).padStart(2, '0');
  const dd = String(clampedDay).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

/**
 * Adds N true calendar months to a date (or YYYY-MM-DD string), anchored to anchorDayOverride
 * (clamping to the last day of shorter months such as Feb 28/29 or Apr 30).
 */
export function addCalendarMonthsYmd(
  baseDate: string | Date,
  monthsToAdd: number = 1,
  anchorDayOverride?: number
): string {
  let year: number;
  let month0: number;
  let day: number;

  if (typeof baseDate === 'string') {
    const ymd = extractYmdString(baseDate);
    if (ymd) {
      const [yStr, mStr, dStr] = ymd.split('-');
      year = parseInt(yStr, 10);
      month0 = parseInt(mStr, 10) - 1;
      day = parseInt(dStr, 10);
    } else {
      const d = new Date();
      year = d.getFullYear();
      month0 = d.getMonth();
      day = d.getDate();
    }
  } else {
    year = baseDate.getFullYear();
    month0 = baseDate.getMonth();
    day = baseDate.getDate();
  }

  const anchorDay =
    anchorDayOverride && anchorDayOverride >= 1 && anchorDayOverride <= 31
      ? Math.floor(anchorDayOverride)
      : day;
  const totalMonths = year * 12 + month0 + monthsToAdd;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth0 = ((totalMonths % 12) + 12) % 12;
  return buildCycleDateString(targetYear, targetMonth0, anchorDay);
}

/**
 * Calculates the subscriber's first/next due date as +1 calendar month from installation_date.
 */
export function computeNextBillingDateFromInstall(
  installationDate?: string | null,
  anchorDayOverride?: number
): string {
  const baseYmd = extractYmdString(installationDate) || extractYmdString(new Date().toISOString())!;
  const anchor = anchorDayOverride ?? computeBillingAnchorDay({ installation_date: baseYmd });
  return addCalendarMonthsYmd(baseYmd, 1, anchor);
}

export function getCycleYearMonth(date: Date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

export function doesInvoiceCoverMonth(inv: Partial<SupabaseInvoice>, targetYm: string): boolean {
  const invNo = String(inv.invoice_no || '').toUpperCase();
  if (invNo.startsWith('INV-MAT-')) return false;
  const compactYm = targetYm.replace('-', '');
  if (invNo.startsWith(`INV-${compactYm}-`)) return true;
  if (String(inv.due_date || '').slice(0, 7) === targetYm) return true;
  if (String(inv.created_at || '').slice(0, 7) === targetYm) return true;
  return false;
}

/**
 * Resolves the effective calendar-month anniversary next_billing_date for a subscriber:
 * - Honors explicit `next_billing_date` if stored on the subscriber record
 * - Otherwise derives +1 calendar month from `installation_date || created_at`, advancing through
 *   prior months if installed >1 month ago and adjusting +1 month if the current cycle invoice is already PAID.
 */
export function resolveSubscriberAnniversaryNextDue(
  sub: Partial<SupabasePortalUser>,
  subscriberInvoices: Array<Partial<SupabaseInvoice>> = [],
  refDate: Date = new Date()
): { anchorDay: number; nextBillingDate: string } {
  const anchorDay = computeBillingAnchorDay(sub);
  const currentYm = getCycleYearMonth(refDate);

  const explicitNext = extractYmdString((sub as any).next_billing_date);
  if (explicitNext) {
    return { anchorDay, nextBillingDate: explicitNext };
  }

  const hasPaidMonth = (ym: string) =>
    subscriberInvoices.some((inv) => {
      const bal = Math.max(0, (Number(inv.amount) || 0) - (Number(inv.paid_amount) || 0));
      const isPaid = String(inv.status || '').toUpperCase() === 'PAID' || bal <= 0;
      return isPaid && (doesInvoiceCoverMonth(inv, ym) || String(inv.paid_at || '').slice(0, 7) === ym);
    });

  const installYmd = extractYmdString(sub.installation_date || sub.created_at);
  if (installYmd) {
    const firstDue = addCalendarMonthsYmd(installYmd, 1, anchorDay);
    const firstYm = firstDue.slice(0, 7);

    // Installed last month or this month: firstDue is this month or next month
    if (firstYm >= currentYm) {
      if (hasPaidMonth(firstYm)) {
        return { anchorDay, nextBillingDate: addCalendarMonthsYmd(firstDue, 1, anchorDay) };
      }
      return { anchorDay, nextBillingDate: firstDue };
    }
  }

  // Installed > 1 month ago: anchor to current calendar month unless already paid for this month
  const currentCycleDue = buildCycleDateString(refDate.getFullYear(), refDate.getMonth(), anchorDay);
  if (hasPaidMonth(currentYm)) {
    return { anchorDay, nextBillingDate: addCalendarMonthsYmd(currentCycleDue, 1, anchorDay) };
  }
  return { anchorDay, nextBillingDate: currentCycleDue };
}

export interface AnniversaryCronSummary {
  cycleMonth: string;
  scanned: number;
  generatedCount: number;
  skippedExisting: number;
  skippedUpcomingAnchor: number;
  totalBilled: number;
  generatedInvoices: SupabaseInvoice[];
}

let lastAutoAnniversaryRunAt = 0;

/**
 * Calendar-Month Anniversary Billing Model:
 * When today >= next_billing_date, bills active subscribers monthly on their exact anchor day
 * (clamping shorter months like Feb 28/29 and Apr 30), skips YYYY-MM cycles already in `invoices`,
 * and advances `next_billing_date` by +1 calendar month anchored to `billing_anchor_day`.
 */
export async function runAnniversaryInvoicingCron(
  supabase: SupabaseClient,
  options?: { force?: boolean; refDate?: Date }
): Promise<AnniversaryCronSummary> {
  const now = options?.refDate || new Date();
  const cycleMonth = getCycleYearMonth(now);
  const todayYmd = extractYmdString(now.toISOString()) || getCycleYearMonth(now) + '-01';

  if (!options?.force) {
    const ts = Date.now();
    if (ts - lastAutoAnniversaryRunAt < 25_000) {
      return {
        cycleMonth,
        scanned: 0,
        generatedCount: 0,
        skippedExisting: 0,
        skippedUpcomingAnchor: 0,
        totalBilled: 0,
        generatedInvoices: [],
      };
    }
    lastAutoAnniversaryRunAt = ts;
  }

  const [{ data: clients }, { data: existingInvoices }] = await Promise.all([
    supabase.from('portal_users').select('*').eq('role', 'CLIENT'),
    supabase
      .from('invoices')
      .select('id, invoice_no, subscriber_username, amount, paid_amount, status, due_date, cycle_day, paid_at, created_at'),
  ]);

  const activeClients = ((clients || []) as SupabasePortalUser[]).filter((c) => {
    const st = String(c.account_status || 'ACTIVE').toUpperCase();
    return st !== 'SUSPENDED' && st !== 'DELETED';
  });

  const allInvoices = (existingInvoices || []) as SupabaseInvoice[];
  const invoicesByUser = new Map<string, SupabaseInvoice[]>();
  const invoicedMonthKeys = new Set<string>();

  for (const inv of allInvoices) {
    const uname = String(inv.subscriber_username || '').trim().toLowerCase();
    if (!uname) continue;
    const arr = invoicesByUser.get(uname) || [];
    arr.push(inv);
    invoicesByUser.set(uname, arr);

    if (doesInvoiceCoverMonth(inv, cycleMonth)) {
      invoicedMonthKeys.add(`${uname}::${cycleMonth}`);
    }
    const dueYm = String(inv.due_date || '').slice(0, 7);
    if (dueYm && !String(inv.invoice_no || '').toUpperCase().startsWith('INV-MAT-')) {
      invoicedMonthKeys.add(`${uname}::${dueYm}`);
    }
  }

  const toInsert: Array<Record<string, any>> = [];
  const subscriberAdvances: Array<{ id: string; anchorDay: number; nextBillingDate: string }> = [];
  let skippedExisting = 0;
  let skippedUpcomingAnchor = 0;
  const nowIso = now.toISOString();

  for (const sub of activeClients) {
    const uname = String(sub.username || '').trim().toLowerCase();
    if (!uname) continue;

    const subInvoices = invoicesByUser.get(uname) || [];
    const { anchorDay, nextBillingDate } = resolveSubscriberAnniversaryNextDue(sub, subInvoices, now);
    const billingYm = nextBillingDate.slice(0, 7);
    const compactBillingYm = billingYm.replace('-', '');

    const alreadyInvoicedForPeriod =
      invoicedMonthKeys.has(`${uname}::${billingYm}`) ||
      subInvoices.some((inv) => doesInvoiceCoverMonth(inv, billingYm));

    if (alreadyInvoicedForPeriod) {
      skippedExisting++;
      // If an invoice already exists for nextBillingDate's YYYY-MM but sub.next_billing_date wasn't advanced yet, sync it forward
      if ((sub as any).next_billing_date && String((sub as any).next_billing_date).slice(0, 10) <= todayYmd && sub.id) {
        subscriberAdvances.push({
          id: sub.id,
          anchorDay,
          nextBillingDate: addCalendarMonthsYmd(nextBillingDate, 1, anchorDay),
        });
      }
      continue;
    }

    // Generate invoice only when today >= next_billing_date
    if (todayYmd < nextBillingDate) {
      skippedUpcomingAnchor++;
      continue;
    }

    const rate =
      Number(sub.monthly_fee) > 0
        ? Number(sub.monthly_fee)
        : resolvePackageRate(
            sub.package_profile_name || sub.original_package_profile || sub.package_speed || undefined
          );

    if (rate <= 0) continue;

    const invoiceNo = `INV-${compactBillingYm}-${Math.floor(1000 + Math.random() * 9000)}`;
    invoicedMonthKeys.add(`${uname}::${billingYm}`);

    toInsert.push({
      invoice_no: invoiceNo,
      subscriber_username: uname,
      assigned_agent_id: null,
      assigned_agent_name: null,
      amount: rate,
      paid_amount: 0,
      status: 'DUE',
      due_date: nextBillingDate,
      cycle_day: anchorDay,
      created_at: nowIso,
    });

    if (sub.id) {
      subscriberAdvances.push({
        id: sub.id,
        anchorDay,
        nextBillingDate: addCalendarMonthsYmd(nextBillingDate, 1, anchorDay),
      });
    }
  }

  let insertedRows: SupabaseInvoice[] = [];
  if (toInsert.length > 0) {
    const { data: inserted, error } = await supabase
      .from('invoices')
      .insert(toInsert)
      .select();
    if (error) {
      throw new Error(`Anniversary invoicing insert failed: ${error.message}`);
    }
    insertedRows = (inserted || []) as SupabaseInvoice[];
  }

  // Advance next_billing_date (+1 calendar month anchored to billing_anchor_day) when columns exist
  for (const adv of subscriberAdvances) {
    try {
      const { error } = await supabase
        .from('portal_users')
        .update({
          billing_anchor_day: adv.anchorDay,
          next_billing_date: adv.nextBillingDate,
        } as any)
        .eq('id', adv.id);
      if (error && isMissingTableOrColumnError(error)) {
        break; // Columns not migrated yet; stop cleanly without repeated errors
      }
    } catch {
      break;
    }
  }

  const totalBilled = insertedRows.reduce((sum, i) => sum + (Number(i.amount) || 0), 0);

  // Fire zero-click automated WhatsApp monthly invoice alerts in the background (browser context)
  if (typeof window !== 'undefined' && insertedRows.length > 0) {
    for (const invRow of insertedRows) {
      void triggerAutoWhatsAppNotification({
        eventType: 'INVOICE_GENERATED',
        subscriberUsername: invRow.subscriber_username,
        messageVars: {
          username: invRow.subscriber_username,
          invoiceNo: invRow.invoice_no,
          amountDue: Number(invRow.amount) || 0,
          totalAmount: Number(invRow.amount) || 0,
          dueDate: invRow.due_date,
          packageName: invRow.package_profile || invRow.package_name || 'Fiber Broadband',
        },
      });
    }
  }

  return {
    cycleMonth,
    scanned: activeClients.length,
    generatedCount: insertedRows.length,
    skippedExisting,
    skippedUpcomingAnchor,
    totalBilled,
    generatedInvoices: insertedRows,
  };
}

export type ExpiryBucket = 'expiring_3d' | 'grace_24h' | 'suspended_16' | 'active';

export interface EvaluatedSubscriberExpiry {
  subscriber: SupabasePortalUser;
  username: string;
  anchorDay: number;
  nextBillingDate: string;
  amountDue: number;
  effectiveExpiryMs: number | null;
  graceEndsMs: number | null;
  daysRemaining: number;
  bucket: ExpiryBucket;
  isSyntheticRecord: boolean;
  isExtraGrace?: boolean;
  extraGraceNote?: string | null;
  suspensionReason?: string;
}

export interface PaidSuspendedSubscriberNotice {
  subscriber: SupabasePortalUser;
  username: string;
  isSyntheticRecord: boolean;
  reason: string;
}

export function getSubscriberGraceUntilIso(
  sub?: Partial<SupabasePortalUser> | null
): string | null {
  if (!sub) return null;
  const raw = (sub as any).grace_until || sub.grace_ends_at || null;
  if (!raw) return null;
  const s = String(raw).trim();
  return s || null;
}

export function hasSubscriberActiveGrace(
  sub?: Partial<SupabasePortalUser> | null,
  nowMs: number = Date.now()
): boolean {
  if (!sub) return false;
  const raw = getSubscriberGraceUntilIso(sub);
  if (raw) {
    const ms = Date.parse(raw);
    if (!Number.isNaN(ms)) {
      return ms > nowMs;
    }
  }
  return String(sub.billing_status || '').toUpperCase() === 'GRACE_PERIOD';
}

export function isSubscriberShiftedNextMonth(
  sub?: Partial<SupabasePortalUser> | null,
  inv?: { shifted_to_next_month?: boolean | null } | null
): boolean {
  return Boolean(
    (sub as any)?.shifted_to_next_month === true || inv?.shifted_to_next_month === true
  );
}

export function formatShortGraceDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

export function isInvoiceOverdueOrGraceExpired(params: {
  status?: string | null;
  amount?: number | null;
  paidAmount?: number | null;
  dueDate?: string | null;
  shiftedToNextMonth?: boolean | null;
  subscriber?: Partial<SupabasePortalUser> | null;
  nowMs?: number;
  todayYmd?: string;
}): boolean {
  const nowMs = params.nowMs ?? Date.now();
  const todayYmd =
    params.todayYmd || extractYmdString(new Date(nowMs).toISOString()) || new Date(nowMs).toISOString().slice(0, 10);

  const st = String(params.status || '').trim().toUpperCase();
  const total = Number(params.amount) || 0;
  const paid = Number(params.paidAmount) || 0;
  const balanceDue = Math.max(0, total - paid);

  if (st === 'PAID' || st === 'CANCELLED' || balanceDue <= 0) {
    return false;
  }

  const sub = params.subscriber || null;
  const dueYmd = extractYmdString(params.dueDate);
  const graceRaw = getSubscriberGraceUntilIso(sub);
  const graceMs = graceRaw ? Date.parse(graceRaw) : NaN;
  const isGraceExpired = !Number.isNaN(graceMs) && graceMs < nowMs;
  const isSuspended = Boolean(
    sub &&
      ((sub as any).is_suspended === true ||
        String(sub.billing_status || '').toUpperCase() === 'SUSPENDED_EXPIRED' ||
        ['EXPIRED', 'SUSPENDED'].includes(String(sub.account_status || '').toUpperCase()))
  );
  const isDueDatePast = Boolean(dueYmd && dueYmd < todayYmd);

  // If shifted to next month with a future due date and not suspended, exempt from overdue
  const isShifted = Boolean(params.shiftedToNextMonth || (sub as any)?.shifted_to_next_month === true);
  if (isShifted && dueYmd && dueYmd >= todayYmd && !isSuspended && !isGraceExpired) {
    return false;
  }

  return Boolean(isDueDatePast || isGraceExpired || isSuspended || st === 'OVERDUE');
}

/**
 * Evaluates live expiry & 24h / Extra Grace period buckets directly from each subscriber's
 * calendar-month anniversary next_billing_date (`installation_date` / `billing_anchor_day`),
 * `grace_until` / `grace_ends_at`, unpaid/partial invoices (`due_amount > 0`),
 * and live MikroTik 16.16.16.0/24 / Expire / disabled state.
 *
 * Guarantees:
 * - Exact Single Source of Truth: `inGrace` and `suspended16` `amountDue` equals exact sum of unpaid invoices.
 * - Paid users (`unpaidInvoiceTotal <= 0`) NEVER appear in `suspended16` or `inGrace` and are returned in `paidSuspendedToRestore`.
 * - Shifted-next-month users (`shifted_to_next_month === true` with upcoming due date) are exempted from suspension.
 */
export function evaluateSubscribersExpiryBuckets(params: {
  subscribers: SupabasePortalUser[];
  allInvoices: SupabaseInvoice[];
  auditLogs?: Array<{
    username?: string | null;
    action_type?: string | null;
    notes?: string | null;
    created_at?: string | null;
  }>;
  cutoffTimePkt?: string;
  graceHours?: number;
  expiryProfileName?: string;
  mikrotikSecrets?: Array<Record<string, any>>;
  mikrotikActive?: Array<Record<string, any>>;
  nowMs?: number;
}): {
  expiring3d: EvaluatedSubscriberExpiry[];
  inGrace: EvaluatedSubscriberExpiry[];
  suspended16: EvaluatedSubscriberExpiry[];
  paidSuspendedToRestore: PaidSuspendedSubscriberNotice[];
} {
  const nowMs = params.nowMs ?? Date.now();
  const nowDate = new Date(nowMs);
  const todayYmd =
    extractYmdString(nowDate.toISOString()) || nowDate.toISOString().slice(0, 10);
  const cutoffPkt = params.cutoffTimePkt || '14:00';
  const graceHours = Math.max(0, Number(params.graceHours ?? 24));
  const threeDaysMs = 3 * 86_400_000;
  const expiryProfLower = String(params.expiryProfileName || 'EXPIRED-16-POOL').trim().toLowerCase();

  // Map subscriber id -> lowercase username so invoices referencing subscriber_id match reliably
  const usernameBySubId = new Map<string, string>();
  for (const sub of params.subscribers || []) {
    const uname = String(sub.username || '').trim().toLowerCase();
    if (sub.id && uname) {
      usernameBySubId.set(String(sub.id), uname);
    }
  }

  // Index latest Extra Grace notes by username from expiry_audit_logs
  const extraGraceAuditByUser = new Map<string, { note: string | null; createdAtMs: number }>();
  for (const log of params.auditLogs || []) {
    const uname = String(log?.username || '').trim().toLowerCase();
    if (!uname) continue;
    if (
      String(log?.action_type || '').toUpperCase() === 'GRACE_EXTENDED' &&
      String(log?.notes || '').includes('[EXTRA_GRACE')
    ) {
      const ts = log?.created_at ? Date.parse(String(log.created_at)) : 0;
      const existing = extraGraceAuditByUser.get(uname);
      if (!existing || ts >= existing.createdAtMs) {
        const rawNote = String(log?.notes || '');
        const noteMatch = rawNote.match(/Note:\s*(.+)$/i);
        extraGraceAuditByUser.set(uname, {
          note: noteMatch ? noteMatch[1].trim() : null,
          createdAtMs: Number.isNaN(ts) ? 0 : ts,
        });
      }
    }
  }

  // Index invoices strictly by subscriber_id (if matched) or lowercase subscriber_username
  const unpaidByUser = new Map<
    string,
    { amountDue: number; earliestDueDate: string | null; cycleDay?: number | null; allShiftedNextMonth: boolean }
  >();
  const invoicesByUser = new Map<string, SupabaseInvoice[]>();

  for (const inv of params.allInvoices || []) {
    const matchedFromId = inv.subscriber_id ? usernameBySubId.get(String(inv.subscriber_id)) : undefined;
    const uname = matchedFromId || String(inv.subscriber_username || '').trim().toLowerCase();
    if (!uname) continue;

    const list = invoicesByUser.get(uname) || [];
    list.push(inv);
    invoicesByUser.set(uname, list);

    const total = Number(inv.amount) || 0;
    const paid = Number(inv.paid_amount) || 0;
    const balance = Math.max(0, total - paid);
    const status = String(inv.status || '').toUpperCase();

    if (status === 'PAID' || status === 'CANCELLED' || balance <= 0) {
      continue;
    }

    const prev = unpaidByUser.get(uname) || {
      amountDue: 0,
      earliestDueDate: null,
      cycleDay: null,
      allShiftedNextMonth: true,
    };
    prev.amountDue += balance;
    if (inv.shifted_to_next_month !== true) {
      prev.allShiftedNextMonth = false;
    }
    if (inv.due_date && (!prev.earliestDueDate || inv.due_date < prev.earliestDueDate)) {
      prev.earliestDueDate = inv.due_date;
      prev.cycleDay = inv.cycle_day;
    }
    unpaidByUser.set(uname, prev);
  }

  // Index MikroTik secrets & active sessions
  const mkSecretByUser = new Map<string, Record<string, any>>();
  for (const sec of params.mikrotikSecrets || []) {
    const key = String(sec?.name || sec?.user || '').trim().toLowerCase();
    if (key) mkSecretByUser.set(key, sec);
  }

  const mkActiveByUser = new Map<string, Record<string, any>>();
  for (const act of params.mikrotikActive || []) {
    const key = String(act?.name || act?.user || '').trim().toLowerCase();
    if (key) mkActiveByUser.set(key, act);
  }

  // Build unified candidate list (portal_users + unpaid-invoice users + 16.16.16/expired MikroTik secrets)
  const candidates = new Map<string, { sub: SupabasePortalUser; isSynthetic: boolean }>();

  for (const sub of params.subscribers || []) {
    const uname = String(sub.username || '').trim().toLowerCase();
    if (!uname) continue;
    candidates.set(uname, { sub, isSynthetic: false });
  }

  for (const [uname, unpaid] of unpaidByUser.entries()) {
    if (candidates.has(uname)) continue;
    const sec = mkSecretByUser.get(uname);
    candidates.set(uname, {
      isSynthetic: true,
      sub: {
        id: `inv-user:${uname}`,
        username: uname,
        full_name: sec?.name || uname,
        role: 'CLIENT',
        phone: '',
        area: 'Saddar Node',
        account_status: 'ACTIVE',
        billing_status: 'ACTIVE',
        package_speed: sec?.profile || 'Fiber Broadband',
        package_profile_name: sec?.profile || 'Fiber Broadband',
        monthly_fee: unpaid.amountDue,
        expiry_date: unpaid.earliestDueDate || undefined,
        shifted_to_next_month: unpaid.allShiftedNextMonth,
        created_at: new Date().toISOString(),
      },
    });
  }

  const isExpiredProfile = (prof?: string | null) => {
    const p = String(prof || '').trim().toLowerCase();
    return Boolean(
      p &&
        (p === expiryProfLower ||
          p === 'expire' ||
          p === 'expired' ||
          p.includes('expired') ||
          p.includes('16-pool') ||
          p.includes('walled'))
    );
  };

  for (const [uname, act] of mkActiveByUser.entries()) {
    const ip = String(act?.address || '').trim();
    if (!ip.startsWith('16.16.16.') || candidates.has(uname)) continue;
    const sec = mkSecretByUser.get(uname);
    candidates.set(uname, {
      isSynthetic: true,
      sub: {
        id: `mk-user:${uname}`,
        username: uname,
        full_name: sec?.name || uname,
        role: 'CLIENT',
        phone: '',
        area: 'Saddar Node',
        account_status: 'EXPIRED',
        billing_status: 'SUSPENDED_EXPIRED',
        package_speed: sec?.profile || 'Expire',
        package_profile_name: sec?.profile || 'Expire',
        monthly_fee: 0,
        created_at: new Date().toISOString(),
      },
    });
  }

  for (const [uname, sec] of mkSecretByUser.entries()) {
    if (candidates.has(uname)) continue;
    if (isExpiredProfile(sec?.profile) || sec?.disabled === 'true' || sec?.disabled === true) {
      candidates.set(uname, {
        isSynthetic: true,
        sub: {
          id: `mk-user:${uname}`,
          username: uname,
          full_name: sec?.name || uname,
          role: 'CLIENT',
          phone: '',
          area: 'Saddar Node',
          account_status: 'EXPIRED',
          billing_status: 'SUSPENDED_EXPIRED',
          package_speed: sec?.profile || 'Expire',
          package_profile_name: sec?.profile || 'Expire',
          monthly_fee: 0,
          created_at: new Date().toISOString(),
        },
      });
    }
  }

  const expiring3d: EvaluatedSubscriberExpiry[] = [];
  const inGrace: EvaluatedSubscriberExpiry[] = [];
  const suspended16: EvaluatedSubscriberExpiry[] = [];
  const paidSuspendedToRestore: PaidSuspendedSubscriberNotice[] = [];

  for (const [uname, entry] of candidates.entries()) {
    const { sub, isSynthetic } = entry;
    const subInvoices = invoicesByUser.get(uname) || [];
    const unpaid = unpaidByUser.get(uname);
    const { anchorDay, nextBillingDate } = resolveSubscriberAnniversaryNextDue(sub, subInvoices, nowDate);
    const sec = mkSecretByUser.get(uname);
    const act = mkActiveByUser.get(uname);

    // Exact sum of unpaid invoices from `invoices` table (Single Source of Truth)
    const unpaidInvoiceTotal = unpaid ? Math.max(0, unpaid.amountDue) : 0;
    const hasUnpaidDue = unpaidInvoiceTotal > 0;
    const upcomingReferenceAmount = hasUnpaidDue
      ? unpaidInvoiceTotal
      : Number(sub.monthly_fee) > 0
      ? Number(sub.monthly_fee)
      : resolvePackageRate(sub.package_profile_name || sub.package_speed || sec?.profile);

    const billingStatus = String(sub.billing_status || '').toUpperCase();
    const accountStatus = String(sub.account_status || 'ACTIVE').toUpperCase();
    const isSuspendedFlag = (sub as any).is_suspended === true;
    const isMkSuspendedIp = String(act?.address || '').startsWith('16.16.16.');
    const isMkExpiredProfile = isExpiredProfile(sec?.profile);
    const isMkDisabled = sec?.disabled === 'true' || sec?.disabled === true;

    const hasSuspensionMarker =
      isSuspendedFlag ||
      billingStatus === 'SUSPENDED_EXPIRED' ||
      accountStatus === 'EXPIRED' ||
      accountStatus === 'SUSPENDED' ||
      isMkSuspendedIp ||
      isMkExpiredProfile ||
      isMkDisabled;

    // 0. Paid Users Guard: NEVER show paid users (unpaidInvoiceTotal <= 0) in Suspended or Grace.
    // Flag any paid user that still has DB/MikroTik suspension markers for auto-restore.
    if (!hasUnpaidDue && hasSuspensionMarker) {
      paidSuspendedToRestore.push({
        subscriber: sub,
        username: uname,
        isSyntheticRecord: isSynthetic,
        reason: isMkSuspendedIp
          ? `Paid subscriber still active in ${act?.address}`
          : isMkExpiredProfile
          ? `Paid subscriber still on MikroTik profile ${sec?.profile}`
          : isMkDisabled
          ? 'Paid subscriber secret still disabled in MikroTik'
          : 'Paid subscriber still marked suspended in DB',
      });
    }

    const subExplicitNextYmd = extractYmdString((sub as any).next_billing_date);
    const isShiftedNextMonth = Boolean(
      ((sub as any).shifted_to_next_month === true && (!subExplicitNextYmd || subExplicitNextYmd > todayYmd)) ||
        (unpaid?.allShiftedNextMonth && (!unpaid.earliestDueDate || unpaid.earliestDueDate > todayYmd))
    );

    const effectiveNextBillingDate =
      unpaid?.earliestDueDate && unpaid.earliestDueDate < nextBillingDate
        ? unpaid.earliestDueDate
        : nextBillingDate;

    const effectiveExpiryMs = parseExpiryDateWithCutoffMs(effectiveNextBillingDate, cutoffPkt);

    // 0b. Exempt subscribers shifted to next month from Suspended & Grace until shifted due date arrives
    if (isShiftedNextMonth) {
      if (effectiveExpiryMs !== null && nowMs < effectiveExpiryMs && effectiveExpiryMs <= nowMs + threeDaysMs) {
        const daysRemaining = Math.max(0, Math.ceil((effectiveExpiryMs - nowMs) / 86_400_000));
        expiring3d.push({
          subscriber: sub,
          username: uname,
          anchorDay,
          nextBillingDate: effectiveNextBillingDate,
          amountDue: upcomingReferenceAmount,
          effectiveExpiryMs,
          graceEndsMs: effectiveExpiryMs + graceHours * 3_600_000,
          daysRemaining,
          bucket: 'expiring_3d',
          isSyntheticRecord: isSynthetic,
        });
      }
      continue;
    }

    // 1. Check explicit DB or MikroTik suspension state (ONLY if unpaidInvoiceTotal > 0!)
    if (hasUnpaidDue && hasSuspensionMarker) {
      const fallbackExpMs = parseExpiryDateWithCutoffMs(
        unpaid?.earliestDueDate || effectiveNextBillingDate || sub.expiry_date,
        cutoffPkt
      );
      suspended16.push({
        subscriber: sub,
        username: uname,
        anchorDay,
        nextBillingDate: effectiveNextBillingDate,
        amountDue: unpaidInvoiceTotal,
        effectiveExpiryMs: fallbackExpMs,
        graceEndsMs: fallbackExpMs ? fallbackExpMs + graceHours * 3_600_000 : null,
        daysRemaining: 0,
        bucket: 'suspended_16',
        isSyntheticRecord: isSynthetic,
        suspensionReason: isMkSuspendedIp
          ? `Active IP ${act?.address}`
          : isMkExpiredProfile
          ? `MikroTik Profile: ${sec?.profile}`
          : isMkDisabled
          ? 'MikroTik Secret Disabled'
          : 'Billing Past Grace / Suspended',
      });
      continue;
    }

    // 2. Compute expiry & grace deadline (`grace_until` / `grace_ends_at`, else `next_billing_date + grace_hours`)
    const explicitGraceRaw = getSubscriberGraceUntilIso(sub);
    const explicitGraceMs = explicitGraceRaw ? Date.parse(explicitGraceRaw) : NaN;
    const standardGraceEndsMs =
      effectiveExpiryMs !== null ? effectiveExpiryMs + graceHours * 3_600_000 : null;
    const graceEndsMs = !Number.isNaN(explicitGraceMs) ? explicitGraceMs : standardGraceEndsMs;

    if (effectiveExpiryMs === null && Number.isNaN(explicitGraceMs)) continue;

    const hasActiveExplicitGrace = !Number.isNaN(explicitGraceMs) && explicitGraceMs > nowMs;
    const extraGraceAudit = extraGraceAuditByUser.get(uname);

    // Only place unpaid subscribers into Grace or Suspended buckets
    if (
      hasUnpaidDue &&
      (hasActiveExplicitGrace ||
        billingStatus === 'GRACE_PERIOD' ||
        (effectiveExpiryMs !== null &&
          graceEndsMs !== null &&
          nowMs >= effectiveExpiryMs &&
          nowMs < graceEndsMs))
    ) {
      // If grace_ends_at already expired while DB still shows GRACE_PERIOD, transition to suspended
      if (graceEndsMs !== null && nowMs >= graceEndsMs) {
        suspended16.push({
          subscriber: sub,
          username: uname,
          anchorDay,
          nextBillingDate: effectiveNextBillingDate,
          amountDue: unpaidInvoiceTotal,
          effectiveExpiryMs,
          graceEndsMs,
          daysRemaining: 0,
          bucket: 'suspended_16',
          isSyntheticRecord: isSynthetic,
          suspensionReason: 'Extra / 24h Grace Expired',
        });
        continue;
      }

      const isExtraGrace = Boolean(
        extraGraceAudit ||
          (standardGraceEndsMs !== null &&
            !Number.isNaN(explicitGraceMs) &&
            (explicitGraceMs > standardGraceEndsMs + 60_000 || nowMs >= standardGraceEndsMs))
      );

      inGrace.push({
        subscriber: sub,
        username: uname,
        anchorDay,
        nextBillingDate: effectiveNextBillingDate,
        amountDue: unpaidInvoiceTotal,
        effectiveExpiryMs,
        graceEndsMs: graceEndsMs ?? nowMs + graceHours * 3_600_000,
        daysRemaining: 0,
        bucket: 'grace_24h',
        isSyntheticRecord: isSynthetic,
        isExtraGrace,
        extraGraceNote: extraGraceAudit?.note || null,
      });
      continue;
    }

    if (graceEndsMs !== null && nowMs >= graceEndsMs && hasUnpaidDue) {
      suspended16.push({
        subscriber: sub,
        username: uname,
        anchorDay,
        nextBillingDate: effectiveNextBillingDate,
        amountDue: unpaidInvoiceTotal,
        effectiveExpiryMs,
        graceEndsMs,
        daysRemaining: 0,
        bucket: 'suspended_16',
        isSyntheticRecord: isSynthetic,
        suspensionReason: 'Past Due & 24h Grace Expired',
      });
      continue;
    }

    if (effectiveExpiryMs !== null && nowMs < effectiveExpiryMs && effectiveExpiryMs <= nowMs + threeDaysMs) {
      const daysRemaining = Math.max(0, Math.ceil((effectiveExpiryMs - nowMs) / 86_400_000));
      expiring3d.push({
        subscriber: sub,
        username: uname,
        anchorDay,
        nextBillingDate: effectiveNextBillingDate,
        amountDue: upcomingReferenceAmount,
        effectiveExpiryMs,
        graceEndsMs,
        daysRemaining,
        bucket: 'expiring_3d',
        isSyntheticRecord: isSynthetic,
      });
    }
  }

  expiring3d.sort((a, b) => (a.effectiveExpiryMs || 0) - (b.effectiveExpiryMs || 0));
  inGrace.sort((a, b) => (a.graceEndsMs || 0) - (b.graceEndsMs || 0));
  suspended16.sort((a, b) => (a.effectiveExpiryMs || 0) - (b.effectiveExpiryMs || 0));

  return { expiring3d, inGrace, suspended16, paidSuspendedToRestore };
}
