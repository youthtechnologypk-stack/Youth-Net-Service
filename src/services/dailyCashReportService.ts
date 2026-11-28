import {
  supabase,
  SupabaseInvoice,
  SupabasePaymentTransaction,
} from './supabaseClient';
import {
  parseFlexibleDate,
  toLocalDateKey,
  toLocalYearMonthKey,
} from '../lib/dateFilter';
import { SystemRole } from '../types/auth';

export const DAILY_EXPENSE_CATEGORIES = [
  'Fuel / Bike Patrol',
  'Fiber & Splicing Material',
  'Staff Tea / Food',
  'Office / Electricity',
  'Technician Advance',
  'Bandwidth / Upstream Bill',
  'Other',
] as const;

export type DailyExpenseCategory = (typeof DAILY_EXPENSE_CATEGORIES)[number];

export const DAILY_EXPENSE_PAYMENT_METHODS = [
  'Cash',
  'EasyPaisa',
  'JazzCash',
  'Bank Transfer',
  'Agent Wallet',
] as const;

export type DailyExpensePaymentMethod = (typeof DAILY_EXPENSE_PAYMENT_METHODS)[number];

export interface SupabaseDailyExpense {
  id: string;
  expense_date: string; // YYYY-MM-DD
  category: DailyExpenseCategory | string;
  description: string;
  amount: number;
  paid_by: string;
  payment_method: DailyExpensePaymentMethod | string;
  recorded_by: string;
  created_at: string;
}

export interface DailyCollectionLineItem {
  id: string;
  date: string; // YYYY-MM-DD
  timestamp: string;
  invoiceNo: string;
  subscriberUsername: string;
  collectedBy: string;
  paymentMethod: string;
  amount: number;
  notes: string;
}

export type DailyReportPeriodMode = 'day' | 'month' | 'range' | 'all';

export interface DailyReportFilterState {
  mode: DailyReportPeriodMode;
  /** YYYY-MM-DD for single-day mode */
  day: string;
  /** YYYY-MM for month mode */
  month: string;
  /** YYYY-MM-DD start for custom range */
  startDate: string;
  /** YYYY-MM-DD end for custom range */
  endDate: string;
}

export interface DailyCashChartPoint {
  dateKey: string;
  label: string;
  collections: number;
  expenses: number;
  netProfit: number;
}

export interface DailyCashReportSummary {
  totalCollections: number;
  totalExpenses: number;
  netCashInHand: number;
  pendingDues: number;
  collectionsCount: number;
  expensesCount: number;
  filteredCollections: DailyCollectionLineItem[];
  filteredExpenses: SupabaseDailyExpense[];
  dailySeries: DailyCashChartPoint[];
  expensesByCategory: Array<{
    category: string;
    amount: number;
    count: number;
    pct: number;
  }>;
}

export const DAILY_EXPENSES_MIGRATION_SQL = `-- Run once in Supabase SQL Editor to enable the Daily Cash, Expense & Collection Report
CREATE TABLE IF NOT EXISTS public.daily_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  paid_by TEXT NOT NULL DEFAULT 'Office Cashier',
  payment_method TEXT NOT NULL DEFAULT 'Cash',
  recorded_by TEXT NOT NULL DEFAULT 'Master Admin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_daily_expenses_date
  ON public.daily_expenses (expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_expenses_category
  ON public.daily_expenses (category);

ALTER TABLE public.daily_expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow portal access to daily_expenses" ON public.daily_expenses;
CREATE POLICY "Allow portal access to daily_expenses"
  ON public.daily_expenses
  FOR ALL
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_expenses TO anon, authenticated, service_role;`;

export function isMissingDailyExpensesTableError(error: any): boolean {
  const msg = String(error?.message || error?.details || '').toLowerCase();
  const code = String(error?.code || '');
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    (msg.includes('daily_expenses') &&
      (msg.includes('does not exist') || msg.includes('schema cache') || msg.includes('not found')))
  );
}

export function normalizeDailyExpenseCategory(raw?: string | null): DailyExpenseCategory {
  const clean = String(raw || '').trim().toLowerCase();
  const hit = DAILY_EXPENSE_CATEGORIES.find((c) => c.toLowerCase() === clean);
  return hit || 'Other';
}

export function normalizeDailyPaymentMethod(raw?: string | null): DailyExpensePaymentMethod {
  const clean = String(raw || '').trim().toLowerCase();
  const hit = DAILY_EXPENSE_PAYMENT_METHODS.find((m) => m.toLowerCase() === clean);
  return hit || 'Cash';
}

export function matchesDailyReportFilter(
  candidates: string | null | undefined | Array<string | null | undefined>,
  filter: DailyReportFilterState
): boolean {
  if (filter.mode === 'all') return true;
  const list = Array.isArray(candidates) ? candidates : [candidates];
  const validDates = list
    .map((raw) => ({ raw: raw ? String(raw).trim() : '', parsed: parseFlexibleDate(raw) }))
    .filter((item): item is { raw: string; parsed: Date } => item.parsed !== null);

  if (validDates.length === 0) return false;

  if (filter.mode === 'day') {
    const targetDay = (filter.day || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDay)) return true;
    return validDates.some(({ raw, parsed }) => {
      if (raw.startsWith(targetDay)) return true;
      return toLocalDateKey(parsed) === targetDay;
    });
  }

  if (filter.mode === 'month') {
    const targetMonth = (filter.month || '').trim();
    if (!/^\d{4}-\d{2}$/.test(targetMonth)) return true;
    return validDates.some(({ raw, parsed }) => {
      if (raw.startsWith(targetMonth)) return true;
      return toLocalYearMonthKey(parsed) === targetMonth;
    });
  }

  if (filter.mode === 'range') {
    const hasStart = Boolean(filter.startDate && /^\d{4}-\d{2}-\d{2}$/.test(filter.startDate));
    const hasEnd = Boolean(filter.endDate && /^\d{4}-\d{2}-\d{2}$/.test(filter.endDate));
    if (!hasStart && !hasEnd) return true;

    let startMs = -Infinity;
    let endMs = Infinity;
    if (hasStart) {
      const [sy, sm, sd] = filter.startDate.split('-').map(Number);
      startMs = new Date(sy, sm - 1, sd, 0, 0, 0, 0).getTime();
    }
    if (hasEnd) {
      const [ey, em, ed] = filter.endDate.split('-').map(Number);
      endMs = new Date(ey, em - 1, ed, 23, 59, 59, 999).getTime();
    }
    return validDates.some(({ parsed }) => {
      const ts = parsed.getTime();
      return ts >= startMs && ts <= endMs;
    });
  }

  return true;
}

export function describeDailyReportFilter(filter: DailyReportFilterState): string {
  if (filter.mode === 'all') return 'All Time';
  if (filter.mode === 'day') {
    const d = parseFlexibleDate(filter.day);
    return d
      ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
      : filter.day;
  }
  if (filter.mode === 'month') {
    const [y, m] = (filter.month || '').split('-').map(Number);
    if (!y || !m) return 'Selected Month';
    return new Date(y, m - 1, 1).toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
    });
  }
  return `${filter.startDate || '...'} to ${filter.endDate || '...'}`;
}

export async function fetchDailyExpenses(): Promise<{
  data: SupabaseDailyExpense[];
  tableMissing: boolean;
  error?: string;
}> {
  const { data, error } = await supabase
    .from('daily_expenses')
    .select('*')
    .order('expense_date', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) {
    if (isMissingDailyExpensesTableError(error)) {
      return { data: [], tableMissing: true };
    }
    return { data: [], tableMissing: false, error: error.message };
  }

  return {
    data: (data || []).map((row: any) => ({
      ...row,
      amount: Number(row.amount) || 0,
    })) as SupabaseDailyExpense[],
    tableMissing: false,
  };
}

export interface CreateDailyExpenseInput {
  expense_date: string;
  category: DailyExpenseCategory | string;
  description: string;
  amount: number;
  paid_by: string;
  payment_method: DailyExpensePaymentMethod | string;
  recorded_by: string;
}

export async function createDailyExpense(
  input: CreateDailyExpenseInput,
  callerRole: SystemRole
): Promise<SupabaseDailyExpense> {
  if (callerRole !== 'ADMIN' && callerRole !== 'MANAGER') {
    throw new Error('Only Admin or Operations Manager can record daily expenses.');
  }

  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000_000) {
    throw new Error('Expense amount must be a positive number.');
  }

  const description = String(input.description || '').trim();
  if (!description || description.length > 500) {
    throw new Error('Please enter a valid expense description (max 500 chars).');
  }

  const expenseDate = /^\d{4}-\d{2}-\d{2}$/.test(String(input.expense_date || '').trim())
    ? String(input.expense_date).trim()
    : toLocalDateKey(new Date());

  const payload = {
    expense_date: expenseDate,
    category: normalizeDailyExpenseCategory(input.category),
    description,
    amount: Math.round(amount * 100) / 100,
    paid_by: String(input.paid_by || 'Office Cashier').trim().slice(0, 120),
    payment_method: normalizeDailyPaymentMethod(input.payment_method),
    recorded_by: String(input.recorded_by || 'Master Admin').trim().slice(0, 120),
  };

  const { data, error } = await supabase
    .from('daily_expenses')
    .insert(payload)
    .select('*')
    .single();

  if (error) {
    throw new Error(error.message || 'Failed to save daily expense.');
  }

  return {
    ...(data as any),
    amount: Number((data as any).amount) || 0,
  } as SupabaseDailyExpense;
}

export async function updateDailyExpense(
  id: string,
  updates: Partial<CreateDailyExpenseInput>,
  callerRole: SystemRole
): Promise<SupabaseDailyExpense> {
  if (callerRole !== 'ADMIN') {
    throw new Error('Only Master Admin (ADMIN) can edit daily expenses.');
  }
  if (!id || typeof id !== 'string') {
    throw new Error('Valid expense ID is required.');
  }

  const patch: Record<string, any> = {};
  if (updates.expense_date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(updates.expense_date).trim())) {
      throw new Error('Expense date must be in YYYY-MM-DD format.');
    }
    patch.expense_date = String(updates.expense_date).trim();
  }
  if (updates.category !== undefined) {
    patch.category = normalizeDailyExpenseCategory(updates.category);
  }
  if (updates.description !== undefined) {
    const desc = String(updates.description).trim();
    if (!desc || desc.length > 500) {
      throw new Error('Description is required (max 500 chars).');
    }
    patch.description = desc;
  }
  if (updates.amount !== undefined) {
    const amt = Number(updates.amount);
    if (!Number.isFinite(amt) || amt <= 0 || amt > 100_000_000) {
      throw new Error('Amount must be a positive number.');
    }
    patch.amount = Math.round(amt * 100) / 100;
  }
  if (updates.paid_by !== undefined) {
    patch.paid_by = String(updates.paid_by || 'Office Cashier').trim().slice(0, 120);
  }
  if (updates.payment_method !== undefined) {
    patch.payment_method = normalizeDailyPaymentMethod(updates.payment_method);
  }

  const { data, error } = await supabase
    .from('daily_expenses')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    throw new Error(error.message || 'Failed to update daily expense.');
  }

  return {
    ...(data as any),
    amount: Number((data as any).amount) || 0,
  } as SupabaseDailyExpense;
}

export async function deleteDailyExpense(
  id: string,
  callerRole: SystemRole
): Promise<void> {
  if (callerRole !== 'ADMIN') {
    throw new Error('Only Master Admin (ADMIN) can delete daily expenses.');
  }
  if (!id || typeof id !== 'string') {
    throw new Error('Valid expense ID is required.');
  }

  const { error } = await supabase.from('daily_expenses').delete().eq('id', id);
  if (error) {
    throw new Error(error.message || 'Failed to delete daily expense.');
  }
}

/**
 * Combines verified Client Collections (payment_transactions + residual paid invoices without double-counting)
 * minus Daily Expenses for any selected Day, Month, Custom Date Range, or All Time,
 * plus calculates Pending / Uncollected Dues and builds the time-series data for Recharts.
 */
export function computeDailyCashReportSummary(params: {
  invoices: SupabaseInvoice[];
  paymentTransactions: SupabasePaymentTransaction[];
  dailyExpenses: SupabaseDailyExpense[];
  filter: DailyReportFilterState;
}): DailyCashReportSummary {
  const { invoices, paymentTransactions, dailyExpenses, filter } = params;

  const invoiceMap = new Map<string, SupabaseInvoice>();
  for (const inv of invoices || []) {
    if (inv.id) invoiceMap.set(inv.id, inv);
  }

  const filteredCollections: DailyCollectionLineItem[] = [];
  const creditedByInvoiceId: Record<string, number> = {};

  // 1. Ingest verified payment_transactions
  for (const tx of paymentTransactions || []) {
    const amt = Number(tx.amount_paid) || 0;
    if (amt <= 0) continue;
    const rawDate = tx.payment_date || tx.created_at;
    if (!matchesDailyReportFilter(rawDate, filter)) continue;

    const parsed = parseFlexibleDate(rawDate);
    const dateKey = parsed ? toLocalDateKey(parsed) : toLocalDateKey(new Date());
    const linkedInv = tx.invoice_id ? invoiceMap.get(tx.invoice_id) : undefined;

    filteredCollections.push({
      id: tx.id || `tx-${tx.invoice_id}-${dateKey}-${amt}`,
      date: dateKey,
      timestamp: rawDate || dateKey,
      invoiceNo: linkedInv?.invoice_no || 'DIRECT',
      subscriberUsername: tx.subscriber_username || linkedInv?.subscriber_username || 'Subscriber',
      collectedBy: tx.collected_by_name || 'Cashier / Admin',
      paymentMethod: tx.payment_method || tx.payment_mode || 'Cash',
      amount: Math.round(amt * 100) / 100,
      notes: tx.notes || '',
    });

    if (tx.invoice_id) {
      creditedByInvoiceId[tx.invoice_id] = (creditedByInvoiceId[tx.invoice_id] || 0) + amt;
    }
  }

  // 2. Credit any paid invoices not already represented in payment_transactions (prevents double counting)
  let pendingDues = 0;
  for (const inv of invoices || []) {
    const totalAmt = Number(inv.amount) || 0;
    const statusUpper = String(inv.status || '').toUpperCase();
    const paidAmt = Number(inv.paid_amount) || (statusUpper === 'PAID' ? totalAmt : 0);

    // Pending dues within active period
    if (statusUpper !== 'PAID') {
      const remaining = Math.max(0, totalAmt - paidAmt);
      if (
        remaining > 0 &&
        matchesDailyReportFilter([inv.due_date, inv.created_at], filter)
      ) {
        pendingDues += remaining;
      }
    }

    const alreadyCredited = creditedByInvoiceId[inv.id] || 0;
    const residualPaid = Math.max(0, paidAmt - alreadyCredited);
    if (residualPaid > 0) {
      const paidDateRaw = inv.paid_at || inv.created_at || inv.due_date;
      if (matchesDailyReportFilter(paidDateRaw, filter)) {
        const parsed = parseFlexibleDate(paidDateRaw);
        const dateKey = parsed ? toLocalDateKey(parsed) : toLocalDateKey(new Date());
        filteredCollections.push({
          id: `inv-paid-${inv.id}`,
          date: dateKey,
          timestamp: paidDateRaw || dateKey,
          invoiceNo: inv.invoice_no || 'INV',
          subscriberUsername: inv.subscriber_username || 'Subscriber',
          collectedBy: inv.assigned_agent_name || 'Office Cashier',
          paymentMethod: 'Cash / Verified',
          amount: Math.round(residualPaid * 100) / 100,
          notes: inv.notes || 'Invoice marked PAID',
        });
      }
    }
  }

  filteredCollections.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  // 3. Filter Daily Expenses
  const filteredExpenses = (dailyExpenses || [])
    .filter((exp) => matchesDailyReportFilter([exp.expense_date, exp.created_at], filter))
    .sort((a, b) => {
      const cmp = (b.expense_date || '').localeCompare(a.expense_date || '');
      if (cmp !== 0) return cmp;
      return (b.created_at || '').localeCompare(a.created_at || '');
    });

  const totalCollections =
    Math.round(filteredCollections.reduce((s, c) => s + c.amount, 0) * 100) / 100;
  const totalExpenses =
    Math.round(filteredExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0) * 100) / 100;
  const netCashInHand = Math.round((totalCollections - totalExpenses) * 100) / 100;
  pendingDues = Math.round(pendingDues * 100) / 100;

  // 4. Expense Category Breakdown
  const catMap = new Map<string, { amount: number; count: number }>();
  for (const exp of filteredExpenses) {
    const cat = exp.category || 'Other';
    const cur = catMap.get(cat) || { amount: 0, count: 0 };
    cur.amount += Number(exp.amount) || 0;
    cur.count += 1;
    catMap.set(cat, cur);
  }
  const expensesByCategory = Array.from(catMap.entries())
    .map(([category, vals]) => ({
      category,
      amount: Math.round(vals.amount * 100) / 100,
      count: vals.count,
      pct: totalExpenses > 0 ? Math.round((vals.amount / totalExpenses) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  // 5. Time-series buckets (Daily for day/month/range, Monthly for all-time)
  const groupMonthly = filter.mode === 'all';
  const buckets = new Map<string, { collections: number; expenses: number }>();

  const addBucket = (rawDate: string, field: 'collections' | 'expenses', amount: number) => {
    const parsed = parseFlexibleDate(rawDate);
    if (!parsed) return;
    const key = groupMonthly ? toLocalYearMonthKey(parsed) : toLocalDateKey(parsed);
    const cur = buckets.get(key) || { collections: 0, expenses: 0 };
    cur[field] += amount;
    buckets.set(key, cur);
  };

  for (const col of filteredCollections) {
    addBucket(col.date, 'collections', col.amount);
  }
  for (const exp of filteredExpenses) {
    addBucket(exp.expense_date || exp.created_at, 'expenses', Number(exp.amount) || 0);
  }

  const dailySeries: DailyCashChartPoint[] = Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dateKey, vals]) => {
      let label = dateKey;
      if (groupMonthly) {
        const [y, m] = dateKey.split('-').map(Number);
        if (y && m) {
          label = new Date(y, m - 1, 1).toLocaleDateString('en-US', {
            month: 'short',
            year: 'numeric',
          });
        }
      } else {
        const [y, m, d] = dateKey.split('-').map(Number);
        if (y && m && d) {
          label = new Date(y, m - 1, d).toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'short',
          });
        }
      }
      const collections = Math.round(vals.collections * 100) / 100;
      const expenses = Math.round(vals.expenses * 100) / 100;
      return {
        dateKey,
        label,
        collections,
        expenses,
        netProfit: Math.round((collections - expenses) * 100) / 100,
      };
    });

  return {
    totalCollections,
    totalExpenses,
    netCashInHand,
    pendingDues,
    collectionsCount: filteredCollections.length,
    expensesCount: filteredExpenses.length,
    filteredCollections,
    filteredExpenses,
    dailySeries,
    expensesByCategory,
  };
}
