import type { SupabaseClient } from '@supabase/supabase-js';
import type { FieldAgent } from '../types/isp';
import type { SupabaseInvoice, SupabasePortalUser } from '../services/supabaseClient';
import { isMissingTableOrColumnError, parseExpiryDateWithCutoffMs } from './expiryUtils';
import { resolvePackageRate } from '../components/CreateInvoiceModal';

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
      return r !== 'ADMIN' && r !== 'CLIENT' && u.account_status !== 'DELETED';
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
 * Extracts day-of-month anchor (1..31) from subscriber installation_date || created_at.
 */
export function computeBillingAnchorDay(sub: {
  installation_date?: string | null;
  created_at?: string | null;
  expiry_date?: string | null;
}): number {
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
 * Builds YYYY-MM-DD for the given year & 0-indexed month, clamping anchorDay to month's max days.
 */
export function buildCycleDateString(year: number, monthIndex0: number, anchorDay: number): string {
  const lastDay = new Date(year, monthIndex0 + 1, 0).getDate();
  const clampedDay = Math.min(Math.max(1, anchorDay), lastDay);
  const mm = String(monthIndex0 + 1).padStart(2, '0');
  const dd = String(clampedDay).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
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
  if (String(inv.created_at || '').slice(0, 7) === targetYm) return true;
  return false;
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
 * Creation-Date Anniversary Billing Model:
 * Bills each active subscriber monthly on their exact anchor day (`installation_date || created_at`),
 * skipping any YYYY-MM cycle already present in `invoices`.
 * Note: Supabase `invoices_status_check` allows ('DUE', 'PARTIAL', 'PAID', 'OVERDUE').
 */
export async function runAnniversaryInvoicingCron(
  supabase: SupabaseClient,
  options?: { force?: boolean; refDate?: Date; includeMissedDaysInCycle?: boolean }
): Promise<AnniversaryCronSummary> {
  const now = options?.refDate || new Date();
  const cycleMonth = getCycleYearMonth(now);

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
    supabase.from('invoices').select('id, invoice_no, subscriber_username, amount, paid_amount, status, due_date, cycle_day, created_at'),
  ]);

  const activeClients = ((clients || []) as SupabasePortalUser[]).filter((c) => {
    const st = String(c.account_status || 'ACTIVE').toUpperCase();
    return st !== 'SUSPENDED' && st !== 'DELETED';
  });

  const allInvoices = (existingInvoices || []) as SupabaseInvoice[];
  const invoicedThisMonth = new Set<string>();
  for (const inv of allInvoices) {
    const uname = String(inv.subscriber_username || '').trim().toLowerCase();
    if (!uname) continue;
    if (doesInvoiceCoverMonth(inv, cycleMonth)) {
      invoicedThisMonth.add(uname);
    }
  }

  const todayDay = now.getDate();
  const compactYm = cycleMonth.replace('-', '');
  const nowIso = now.toISOString();
  const includeMissed = options?.includeMissedDaysInCycle !== false;

  const toInsert: Array<Record<string, any>> = [];
  let skippedExisting = 0;
  let skippedUpcomingAnchor = 0;

  for (const sub of activeClients) {
    const uname = String(sub.username || '').trim().toLowerCase();
    if (!uname) continue;

    if (invoicedThisMonth.has(uname)) {
      skippedExisting++;
      continue;
    }

    const anchorDay = computeBillingAnchorDay(sub);
    const shouldBill = includeMissed ? anchorDay <= todayDay : anchorDay === todayDay;
    if (!shouldBill) {
      skippedUpcomingAnchor++;
      continue;
    }

    const dueDate = buildCycleDateString(now.getFullYear(), now.getMonth(), anchorDay);
    const rate =
      Number(sub.monthly_fee) > 0
        ? Number(sub.monthly_fee)
        : resolvePackageRate(
            sub.package_profile_name || sub.original_package_profile || sub.package_speed || undefined
          );

    if (rate <= 0) continue;

    const invoiceNo = `INV-${compactYm}-${Math.floor(1000 + Math.random() * 9000)}`;
    invoicedThisMonth.add(uname);

    toInsert.push({
      invoice_no: invoiceNo,
      subscriber_username: uname,
      assigned_agent_id: null,
      assigned_agent_name: null,
      amount: rate,
      paid_amount: 0,
      status: 'DUE',
      due_date: dueDate,
      cycle_day: anchorDay,
      created_at: nowIso,
    });
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

  const totalBilled = insertedRows.reduce((sum, i) => sum + (Number(i.amount) || 0), 0);

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
  amountDue: number;
  effectiveExpiryMs: number | null;
  graceEndsMs: number | null;
  daysRemaining: number;
  bucket: ExpiryBucket;
  isSyntheticRecord: boolean;
  suspensionReason?: string;
}

/**
 * Evaluates live expiry & 24h grace period buckets by combining:
 * 1) Creation-date anniversary due dates (installation_date || created_at)
 * 2) Unpaid/partial invoices (including subscribers not yet mirrored into portal_users)
 * 3) Live MikroTik 16.16.16.0/24 / Expire / disabled state
 */
export function evaluateSubscribersExpiryBuckets(params: {
  subscribers: SupabasePortalUser[];
  allInvoices: SupabaseInvoice[];
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
} {
  const nowMs = params.nowMs ?? Date.now();
  const nowDate = new Date(nowMs);
  const currentYm = getCycleYearMonth(nowDate);
  const cutoffPkt = params.cutoffTimePkt || '14:00';
  const graceHours = Math.max(0, Number(params.graceHours ?? 24));
  const threeDaysMs = 3 * 86_400_000;
  const expiryProfLower = String(params.expiryProfileName || 'EXPIRED-16-POOL').trim().toLowerCase();

  // Index invoices by subscriber username
  const unpaidByUser = new Map<
    string,
    { amountDue: number; earliestDueDate: string | null; cycleDay?: number | null }
  >();
  const paidThisMonthUsers = new Set<string>();

  for (const inv of params.allInvoices || []) {
    const uname = String(inv.subscriber_username || '').trim().toLowerCase();
    if (!uname) continue;
    const total = Number(inv.amount) || 0;
    const paid = Number(inv.paid_amount) || 0;
    const balance = Math.max(0, total - paid);
    const status = String(inv.status || '').toUpperCase();

    if (status === 'PAID' || balance <= 0) {
      if (doesInvoiceCoverMonth(inv, currentYm) || String(inv.paid_at || '').slice(0, 7) === currentYm) {
        paidThisMonthUsers.add(uname);
      }
      continue;
    }

    const prev = unpaidByUser.get(uname) || { amountDue: 0, earliestDueDate: null, cycleDay: null };
    prev.amountDue += balance;
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
        monthly_fee: resolvePackageRate(sec?.profile),
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
          monthly_fee: resolvePackageRate(sec?.profile),
          created_at: new Date().toISOString(),
        },
      });
    }
  }

  const expiring3d: EvaluatedSubscriberExpiry[] = [];
  const inGrace: EvaluatedSubscriberExpiry[] = [];
  const suspended16: EvaluatedSubscriberExpiry[] = [];

  for (const [uname, entry] of candidates.entries()) {
    const { sub, isSynthetic } = entry;
    const unpaid = unpaidByUser.get(uname);
    const hasPaidThisMonth = paidThisMonthUsers.has(uname);
    const anchorDay = computeBillingAnchorDay(sub);
    const sec = mkSecretByUser.get(uname);
    const act = mkActiveByUser.get(uname);

    const amountDue =
      unpaid && unpaid.amountDue > 0
        ? unpaid.amountDue
        : Number(sub.monthly_fee) > 0
        ? Number(sub.monthly_fee)
        : resolvePackageRate(sub.package_profile_name || sub.package_speed || sec?.profile);

    const billingStatus = String(sub.billing_status || '').toUpperCase();
    const accountStatus = String(sub.account_status || 'ACTIVE').toUpperCase();
    const isMkSuspendedIp = String(act?.address || '').startsWith('16.16.16.');
    const isMkExpiredProfile = isExpiredProfile(sec?.profile);
    const isMkDisabled = sec?.disabled === 'true' || sec?.disabled === true;

    // 1. Check explicit DB or MikroTik suspension state first
    if (
      billingStatus === 'SUSPENDED_EXPIRED' ||
      accountStatus === 'EXPIRED' ||
      accountStatus === 'SUSPENDED' ||
      isMkSuspendedIp ||
      isMkExpiredProfile ||
      isMkDisabled
    ) {
      const fallbackExpMs = parseExpiryDateWithCutoffMs(
        unpaid?.earliestDueDate || sub.expiry_date || buildCycleDateString(nowDate.getFullYear(), nowDate.getMonth(), anchorDay),
        cutoffPkt
      );
      suspended16.push({
        subscriber: sub,
        username: uname,
        anchorDay,
        amountDue,
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

    // 2. Determine effective expiry date using unpaid invoice due_date OR anniversary date
    const currentAnniversaryDate = buildCycleDateString(
      nowDate.getFullYear(),
      nowDate.getMonth(),
      anchorDay
    );
    const nextMonthDateObj = new Date(nowDate.getFullYear(), nowDate.getMonth() + 1, 1);
    const nextAnniversaryDate = buildCycleDateString(
      nextMonthDateObj.getFullYear(),
      nextMonthDateObj.getMonth(),
      anchorDay
    );

    const currentAnniversaryMs = parseExpiryDateWithCutoffMs(currentAnniversaryDate, cutoffPkt);
    const explicitExpiryMs = parseExpiryDateWithCutoffMs(sub.expiry_date, cutoffPkt);
    const unpaidDueMs = parseExpiryDateWithCutoffMs(unpaid?.earliestDueDate, cutoffPkt);

    let effectiveExpiryMs: number | null = null;

    if (unpaidDueMs !== null) {
      // Unpaid invoice due date takes precedence when sooner, or use current cycle anniversary if overdue
      effectiveExpiryMs =
        explicitExpiryMs !== null && explicitExpiryMs < unpaidDueMs ? explicitExpiryMs : unpaidDueMs;
    } else if (hasPaidThisMonth) {
      // Paid current cycle: upcoming due date is explicit expiry_date or next month's anniversary date
      effectiveExpiryMs =
        explicitExpiryMs !== null
          ? explicitExpiryMs
          : parseExpiryDateWithCutoffMs(nextAnniversaryDate, cutoffPkt);
    } else {
      // Active subscriber without current-month payment: check anniversary day!
      // If installed/created in a prior month OR anniversary is today/upcoming within 3 days, use current anniversary;
      // otherwise fall back to explicit expiry_date or next month's anniversary.
      const instYm = String(sub.installation_date || sub.created_at || '').slice(0, 7);
      const isInstalledThisMonth = instYm === currentYm;

      if (!isInstalledThisMonth && currentAnniversaryMs !== null) {
        effectiveExpiryMs = currentAnniversaryMs;
      } else if (
        currentAnniversaryMs !== null &&
        Math.abs(currentAnniversaryMs - nowMs) <= threeDaysMs
      ) {
        // Installed this month with anchor within +/- 3 days (e.g. today's anniversary batch)
        effectiveExpiryMs = currentAnniversaryMs;
      } else {
        effectiveExpiryMs =
          explicitExpiryMs !== null
            ? explicitExpiryMs
            : parseExpiryDateWithCutoffMs(nextAnniversaryDate, cutoffPkt);
      }
    }

    if (effectiveExpiryMs === null) continue;

    const graceEndsMs = sub.grace_ends_at
      ? Date.parse(String(sub.grace_ends_at))
      : effectiveExpiryMs + graceHours * 3_600_000;

    if (
      billingStatus === 'GRACE_PERIOD' ||
      (nowMs >= effectiveExpiryMs && nowMs < graceEndsMs)
    ) {
      inGrace.push({
        subscriber: sub,
        username: uname,
        anchorDay,
        amountDue,
        effectiveExpiryMs,
        graceEndsMs,
        daysRemaining: 0,
        bucket: 'grace_24h',
        isSyntheticRecord: isSynthetic,
      });
      continue;
    }

    if (nowMs >= graceEndsMs) {
      suspended16.push({
        subscriber: sub,
        username: uname,
        anchorDay,
        amountDue,
        effectiveExpiryMs,
        graceEndsMs,
        daysRemaining: 0,
        bucket: 'suspended_16',
        isSyntheticRecord: isSynthetic,
        suspensionReason: 'Past Due & 24h Grace Expired',
      });
      continue;
    }

    if (nowMs < effectiveExpiryMs && effectiveExpiryMs <= nowMs + threeDaysMs) {
      const daysRemaining = Math.max(0, Math.ceil((effectiveExpiryMs - nowMs) / 86_400_000));
      expiring3d.push({
        subscriber: sub,
        username: uname,
        anchorDay,
        amountDue,
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

  return { expiring3d, inGrace, suspended16 };
}
