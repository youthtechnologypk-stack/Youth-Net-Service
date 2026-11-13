import {
  IspExpenseCategory,
  IspExpensePaymentMethod,
  SupabaseAgentCashTransaction,
  SupabaseInvoice,
  SupabaseIspExpense,
  SupabasePaymentTransaction,
  SupabasePortalUser,
} from '../services/supabaseClient';
import {
  DateFilterState,
  matchesDateFilter,
  parseFlexibleDate,
  toLocalDateKey,
  toLocalYearMonthKey,
} from './dateFilter';

export interface ExpenseCategoryMeta {
  value: IspExpenseCategory;
  label: string;
  shortLabel: string;
  color: string;
}

export const ISP_EXPENSE_CATEGORIES: ExpenseCategoryMeta[] = [
  {
    value: 'UPSTREAM_BANDWIDTH',
    label: 'Upstream Bandwidth Bill (Multinet / CIR)',
    shortLabel: 'Upstream Bandwidth',
    color: '#06b6d4', // cyan-500
  },
  {
    value: 'FIBER_HARDWARE',
    label: 'Fiber Roll, Splitters, ONU & DB Hardware',
    shortLabel: 'Fiber & Hardware',
    color: '#6366f1', // indigo-500
  },
  {
    value: 'POWER_SOLAR_UPS',
    label: 'Solar / Inverter / Battery & Electricity',
    shortLabel: 'Solar & Power',
    color: '#f59e0b', // amber-500
  },
  {
    value: 'FIELD_MAINTENANCE',
    label: 'Field Maintenance, Splicer & Fuel',
    shortLabel: 'Field Maintenance',
    color: '#ec4899', // pink-500
  },
  {
    value: 'OFFICE_RENT_UTILS',
    label: 'NOC Office Rent & Utilities',
    shortLabel: 'Office Rent & Utils',
    color: '#8b5cf6', // violet-500
  },
  {
    value: 'OTHER',
    label: 'Other Operational Expense',
    shortLabel: 'Other Expense',
    color: '#64748b', // slate-500
  },
];

export const PAYMENT_METHODS: Array<{ value: IspExpensePaymentMethod; label: string }> = [
  { value: 'BANK_TRANSFER', label: 'Bank Transfer' },
  { value: 'CASH', label: 'Cash' },
  { value: 'JAZZCASH_EASYPAISA', label: 'JazzCash / Easypaisa' },
];

export function getExpenseCategoryMeta(category: string): {
  label: string;
  shortLabel: string;
  color: string;
} {
  if (category === 'SALARY_PAYOUT') {
    return {
      label: 'Staff & Field Agent Salaries',
      shortLabel: 'Agent Salaries',
      color: '#10b981', // emerald-500 (distinct from rose/cyan in distribution)
    };
  }
  const found = ISP_EXPENSE_CATEGORIES.find((c) => c.value === category);
  if (found) {
    return {
      label: found.label,
      shortLabel: found.shortLabel,
      color: found.color,
    };
  }
  return {
    label: 'Other Operational Expense',
    shortLabel: 'Other Expense',
    color: '#64748b',
  };
}

export function formatPaymentMethodLabel(method?: string | null): string {
  switch ((method || '').toUpperCase()) {
    case 'BANK_TRANSFER':
      return 'Bank Transfer';
    case 'CASH':
      return 'Cash';
    case 'JAZZCASH_EASYPAISA':
      return 'JazzCash / Easypaisa';
    case 'SALARY_PAYOUT':
      return 'Cash / Payroll';
    default:
      return method || 'Cash';
  }
}

/**
 * Since `isp_expenses` persists strictly `notes` (without a dedicated `vendor_name` column),
 * encode optional vendor/payee cleanly using a `[Vendor: ...]` tag at the start of `notes`.
 */
export function encodeExpenseNotes(vendor?: string | null, notes?: string | null): string | null {
  const cleanVendor = (vendor || '').trim();
  const cleanNotes = (notes || '').trim();
  if (cleanVendor && cleanNotes) {
    return `[Vendor: ${cleanVendor}] ${cleanNotes}`;
  }
  if (cleanVendor) {
    return `[Vendor: ${cleanVendor}]`;
  }
  return cleanNotes || null;
}

export function parseExpenseNotes(rawNotes?: string | null): {
  vendor: string;
  cleanNotes: string;
} {
  const text = (rawNotes || '').trim();
  if (!text) return { vendor: '', cleanNotes: '' };
  const match = text.match(/^\[Vendor:\s*([^\]]+)\]\s*(.*)$/is);
  if (match) {
    return {
      vendor: match[1].trim(),
      cleanNotes: (match[2] || '').trim(),
    };
  }
  return { vendor: '', cleanNotes: text };
}

export interface ProfitLossPeriodBucket {
  sortKey: string;
  label: string;
  collections: number;
  expenses: number;
  netProfit: number;
}

export interface ExpenseDistributionItem {
  key: string;
  label: string;
  amount: number;
  sharePct: number;
  color: string;
}

export interface ProfitLossSummary {
  totalCollections: number;
  paymentTxCount: number;
  upstreamCost: number;
  actualSalaryPayouts: number;
  projectedBaseSalaries: number;
  staffSalaries: number;
  infraMaintenanceCost: number;
  totalOutgoing: number;
  netProfit: number;
  marginPct: number;
  filteredExpenses: SupabaseIspExpense[];
  filteredSalaries: SupabaseAgentCashTransaction[];
  periodSeries: ProfitLossPeriodBucket[];
  distribution: ExpenseDistributionItem[];
}

function formatBucketLabel(sortKey: string, isMonthly: boolean): string {
  if (isMonthly) {
    const [y, m] = sortKey.split('-').map(Number);
    if (!y || !m) return sortKey;
    return new Date(y, m - 1, 1).toLocaleDateString('en-US', {
      month: 'short',
      year: 'numeric',
    });
  }
  const [y, m, d] = sortKey.split('-').map(Number);
  if (!y || !m || !d) return sortKey;
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

export function computeProfitLossSummary(params: {
  invoices: SupabaseInvoice[];
  paymentTransactions: SupabasePaymentTransaction[];
  expenses: SupabaseIspExpense[];
  salaryTransactions: SupabaseAgentCashTransaction[];
  staffUsers?: SupabasePortalUser[];
  filter: DateFilterState;
  includeProjectedBaseSalaries?: boolean;
}): ProfitLossSummary {
  const {
    invoices,
    paymentTransactions,
    expenses,
    salaryTransactions,
    staffUsers = [],
    filter,
    includeProjectedBaseSalaries = false,
  } = params;

  const isMonthlyGrouping = filter.mode === 'all';
  const buckets: Record<string, { collections: number; expenses: number }> = {};

  const ensureBucket = (key: string) => {
    if (!buckets[key]) {
      buckets[key] = { collections: 0, expenses: 0 };
    }
    return buckets[key];
  };

  const getBucketKey = (rawDate?: string | null): string | null => {
    const parsed = parseFlexibleDate(rawDate);
    if (!parsed) return null;
    return isMonthlyGrouping ? toLocalYearMonthKey(parsed) : toLocalDateKey(parsed);
  };

  // Track all invoice_ids that have at least one payment_transactions record across DB
  // so legacy/manual PAID invoices without payment_transactions are reconciled without double counting.
  const allRecordedPaidByInvoiceId: Record<string, number> = {};
  for (const tx of paymentTransactions || []) {
    const amt = Number(tx.amount_paid) || 0;
    if (amt > 0 && tx.invoice_id) {
      allRecordedPaidByInvoiceId[tx.invoice_id] =
        (allRecordedPaidByInvoiceId[tx.invoice_id] || 0) + amt;
    }
  }

  let totalCollections = 0;
  let paymentTxCount = 0;

  for (const tx of paymentTransactions || []) {
    if (!matchesDateFilter(tx.payment_date || tx.created_at, filter)) continue;
    const amt = Number(tx.amount_paid) || 0;
    if (amt <= 0) continue;
    totalCollections += amt;
    paymentTxCount += 1;

    const key = getBucketKey(tx.payment_date || tx.created_at);
    if (key) {
      ensureBucket(key).collections += amt;
    }
  }

  for (const inv of invoices || []) {
    const statusUpper = (inv.status || '').toUpperCase();
    const totalAmt = Number(inv.amount) || 0;
    const paidAmt = Number(inv.paid_amount) || (statusUpper === 'PAID' ? totalAmt : 0);
    if (paidAmt <= 0) continue;

    const alreadyRecorded = allRecordedPaidByInvoiceId[inv.id] || 0;
    const residualPaid = Math.max(0, paidAmt - alreadyRecorded);
    if (residualPaid <= 0) continue;

    const effectiveDate = inv.paid_at || inv.created_at || inv.due_date;
    if (!matchesDateFilter(effectiveDate, filter)) continue;

    totalCollections += residualPaid;
    paymentTxCount += 1;

    const key = getBucketKey(effectiveDate);
    if (key) {
      ensureBucket(key).collections += residualPaid;
    }
  }

  // Expenses
  const filteredExpenses = (expenses || []).filter((exp) =>
    matchesDateFilter(exp.expense_date || exp.created_at, filter)
  );

  let upstreamCost = 0;
  let infraMaintenanceCost = 0;
  const categoryTotals: Record<string, number> = {
    UPSTREAM_BANDWIDTH: 0,
    SALARY_PAYOUT: 0,
    FIBER_HARDWARE: 0,
    POWER_SOLAR_UPS: 0,
    FIELD_MAINTENANCE: 0,
    OFFICE_RENT_UTILS: 0,
    OTHER: 0,
  };

  for (const exp of filteredExpenses) {
    const amt = Number(exp.amount) || 0;
    if (amt <= 0) continue;
    const cat = (exp.expense_category || 'OTHER').toUpperCase();
    if (cat === 'UPSTREAM_BANDWIDTH') {
      upstreamCost += amt;
    } else {
      infraMaintenanceCost += amt;
    }

    if (categoryTotals[cat] !== undefined) {
      categoryTotals[cat] += amt;
    } else {
      categoryTotals.OTHER += amt;
    }

    const key = getBucketKey(exp.expense_date || exp.created_at);
    if (key) {
      ensureBucket(key).expenses += amt;
    }
  }

  // Staff & Field Agent Salaries
  const filteredSalaries = (salaryTransactions || []).filter(
    (tx) =>
      (tx.transaction_type || '').toUpperCase() === 'SALARY_PAYOUT' &&
      matchesDateFilter(tx.created_at, filter)
  );

  let actualSalaryPayouts = 0;
  const payoutsByStaffId: Record<string, number> = {};

  for (const sal of filteredSalaries) {
    const amt = Number(sal.amount) || 0;
    if (amt <= 0) continue;
    actualSalaryPayouts += amt;
    if (sal.agent_id) {
      payoutsByStaffId[sal.agent_id] = (payoutsByStaffId[sal.agent_id] || 0) + amt;
    }

    const key = getBucketKey(sal.created_at);
    if (key) {
      ensureBucket(key).expenses += amt;
    }
  }

  const eligibleStaff = (staffUsers || []).filter(
    (u) => u.role === 'AGENT' || u.role === 'MANAGER'
  );
  const projectedBaseSalaries = eligibleStaff.reduce(
    (sum, u) => sum + (Number(u.base_salary) || 0),
    0
  );

  let staffSalaries = actualSalaryPayouts;
  if (includeProjectedBaseSalaries) {
    let combined = 0;
    const accountedStaffIds = new Set<string>();
    for (const staff of eligibleStaff) {
      accountedStaffIds.add(staff.id);
      const paid = payoutsByStaffId[staff.id] || 0;
      const base = Number(staff.base_salary) || 0;
      combined += Math.max(paid, base);
    }
    for (const [staffId, paid] of Object.entries(payoutsByStaffId)) {
      if (!accountedStaffIds.has(staffId)) {
        combined += paid;
      }
    }
    staffSalaries = combined;
  }

  categoryTotals.SALARY_PAYOUT = staffSalaries;

  const totalOutgoing = upstreamCost + staffSalaries + infraMaintenanceCost;
  const netProfit = totalCollections - totalOutgoing;
  const marginPct =
    totalCollections > 0
      ? (netProfit / totalCollections) * 100
      : netProfit < 0
      ? -100
      : 0;

  const periodSeries: ProfitLossPeriodBucket[] = Object.entries(buckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([sortKey, vals]) => {
      const collections = Math.round(vals.collections * 100) / 100;
      const expensesTotal = Math.round(vals.expenses * 100) / 100;
      return {
        sortKey,
        label: formatBucketLabel(sortKey, isMonthlyGrouping),
        collections,
        expenses: expensesTotal,
        netProfit: Math.round((collections - expensesTotal) * 100) / 100,
      };
    });

  const distributionOrder = [
    'UPSTREAM_BANDWIDTH',
    'SALARY_PAYOUT',
    'FIBER_HARDWARE',
    'POWER_SOLAR_UPS',
    'FIELD_MAINTENANCE',
    'OFFICE_RENT_UTILS',
    'OTHER',
  ];

  const distribution: ExpenseDistributionItem[] = distributionOrder.map((key) => {
    const meta = getExpenseCategoryMeta(key);
    const amount = Math.round((categoryTotals[key] || 0) * 100) / 100;
    const sharePct = totalOutgoing > 0 ? Math.round((amount / totalOutgoing) * 1000) / 10 : 0;
    return {
      key,
      label: meta.shortLabel,
      amount,
      sharePct,
      color: meta.color,
    };
  });

  return {
    totalCollections,
    paymentTxCount,
    upstreamCost,
    actualSalaryPayouts,
    projectedBaseSalaries,
    staffSalaries,
    infraMaintenanceCost,
    totalOutgoing,
    netProfit,
    marginPct,
    filteredExpenses,
    filteredSalaries,
    periodSeries,
    distribution,
  };
}
