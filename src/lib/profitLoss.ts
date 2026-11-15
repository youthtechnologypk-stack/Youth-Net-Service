import {
  IspExpenseCategory,
  IspExpensePaymentMethod,
  SupabaseAgentCashTransaction,
  SupabaseInventoryItem,
  SupabaseInventorySale,
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
    value: 'AGENT_COMMISSION',
    label: 'Agent New-Connection Commissions',
    shortLabel: 'Agent Commissions',
    color: '#a855f7', // purple-500
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

export interface HardwareCategoryBreakdownItem {
  categoryKey: string;
  label: string;
  color: string;
  salesCount: number;
  qtySold: number;
  revenue: number;
  cogs: number;
  netProfit: number;
}

export interface ProfitLossSummary {
  totalCollections: number;
  paymentTxCount: number;
  upstreamCost: number;
  actualSalaryPayouts: number;
  projectedBaseSalaries: number;
  staffSalaries: number;
  infraMaintenanceCost: number;
  agentCommissionsCost: number;
  totalOutgoing: number;
  netProfit: number;
  marginPct: number;
  // Segmented Hardware & Combined Profit Metrics
  hardwareRevenue: number;
  hardwareCogs: number;
  hardwareNetProfit: number;
  hardwareMarginPct: number;
  hardwareSalesCount: number;
  hardwareCategoryBreakdown: HardwareCategoryBreakdownItem[];
  combinedGrossRevenue: number;
  combinedNetProfit: number;
  combinedMarginPct: number;
  filteredExpenses: SupabaseIspExpense[];
  filteredSalaries: SupabaseAgentCashTransaction[];
  filteredHardwareSales: SupabaseInventorySale[];
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
  inventorySales?: SupabaseInventorySale[];
  inventoryItems?: SupabaseInventoryItem[];
  filter: DateFilterState;
  includeProjectedBaseSalaries?: boolean;
}): ProfitLossSummary {
  const {
    invoices,
    paymentTransactions,
    expenses,
    salaryTransactions,
    staffUsers = [],
    inventorySales = [],
    inventoryItems = [],
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
  let agentCommissionsCost = 0;
  const categoryTotals: Record<string, number> = {
    UPSTREAM_BANDWIDTH: 0,
    SALARY_PAYOUT: 0,
    AGENT_COMMISSION: 0,
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
    } else if (cat === 'AGENT_COMMISSION') {
      agentCommissionsCost += amt;
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

  const totalOutgoing =
    upstreamCost + staffSalaries + agentCommissionsCost + infraMaintenanceCost;
  const netProfit = totalCollections - totalOutgoing;
  const marginPct =
    totalCollections > 0
      ? (netProfit / totalCollections) * 100
      : netProfit < 0
      ? -100
      : 0;

  // Segmented Hardware & Accessories Sales Profit (Independent of Subscription MRR)
  const itemCategoryById = new Map<string, string>();
  for (const it of inventoryItems || []) {
    if (it?.id) {
      itemCategoryById.set(it.id, (it.category || 'ACCESSORY').toUpperCase());
    }
  }

  const inferHardwareCategory = (sale: SupabaseInventorySale): string => {
    if (sale.item_id && itemCategoryById.has(sale.item_id)) {
      return itemCategoryById.get(sale.item_id)!;
    }
    const nm = (sale.item_name || '').toLowerCase();
    if (nm.includes('router') || nm.includes('ont') || nm.includes('onu') || nm.includes('tenda') || nm.includes('tplink')) {
      return 'ROUTER_ONT';
    }
    if (nm.includes('patch')) return 'PATCH_CORD';
    if (nm.includes('fdb') || nm.includes('splitter') || nm.includes('fosc') || nm.includes('fat')) {
      return 'FDB_SPLITTER';
    }
    if (nm.includes('cat6') || nm.includes('cat-6') || nm.includes('ethernet') || nm.includes('rj45')) {
      return 'CAT6_CABLE';
    }
    if (nm.includes('fiber') || nm.includes('drop') || nm.includes('wire')) return 'FIBER_CABLE';
    return 'ACCESSORY';
  };

  const HARDWARE_CAT_META: Record<string, { label: string; color: string }> = {
    ROUTER_ONT: { label: 'Routers / ONTs', color: '#06b6d4' },
    PATCH_CORD: { label: 'Fiber Patch Cords', color: '#8b5cf6' },
    FDB_SPLITTER: { label: 'FDB Boxes & Splitters', color: '#10b981' },
    CAT6_CABLE: { label: 'Cat6 Cable', color: '#f59e0b' },
    FIBER_CABLE: { label: 'Fiber Drop Cable', color: '#3b82f6' },
    ACCESSORY: { label: 'Accessories & Connectors', color: '#ec4899' },
  };

  const filteredHardwareSales = (inventorySales || []).filter((sale) =>
    matchesDateFilter(sale.sale_date, filter)
  );

  let hardwareRevenue = 0;
  let hardwareCogs = 0;
  let hardwareNetProfit = 0;
  const hwCatMap = new Map<string, HardwareCategoryBreakdownItem>();

  for (const key of Object.keys(HARDWARE_CAT_META)) {
    hwCatMap.set(key, {
      categoryKey: key,
      label: HARDWARE_CAT_META[key].label,
      color: HARDWARE_CAT_META[key].color,
      salesCount: 0,
      qtySold: 0,
      revenue: 0,
      cogs: 0,
      netProfit: 0,
    });
  }

  for (const sale of filteredHardwareSales) {
    const qty = Number(sale.qty) || 0;
    const rev = Number(sale.total_sale) || qty * (Number(sale.unit_sale_price) || 0);
    const cogs = qty * (Number(sale.unit_cost_snapshot) || 0);
    const profit =
      sale.net_profit !== undefined && sale.net_profit !== null
        ? Number(sale.net_profit)
        : rev - cogs;

    hardwareRevenue += rev;
    hardwareCogs += cogs;
    hardwareNetProfit += profit;

    const catKey = inferHardwareCategory(sale);
    const existingCat = hwCatMap.get(catKey) || {
      categoryKey: catKey,
      label: catKey.replace(/_/g, ' '),
      color: '#64748b',
      salesCount: 0,
      qtySold: 0,
      revenue: 0,
      cogs: 0,
      netProfit: 0,
    };
    existingCat.salesCount += 1;
    existingCat.qtySold += qty;
    existingCat.revenue += rev;
    existingCat.cogs += cogs;
    existingCat.netProfit += profit;
    hwCatMap.set(catKey, existingCat);
  }

  const hardwareMarginPct =
    hardwareRevenue > 0
      ? (hardwareNetProfit / hardwareRevenue) * 100
      : hardwareNetProfit < 0
      ? -100
      : 0;

  const hardwareCategoryBreakdown = Array.from(hwCatMap.values()).map((c) => ({
    ...c,
    qtySold: Math.round(c.qtySold * 100) / 100,
    revenue: Math.round(c.revenue * 100) / 100,
    cogs: Math.round(c.cogs * 100) / 100,
    netProfit: Math.round(c.netProfit * 100) / 100,
  }));

  const combinedGrossRevenue = totalCollections + hardwareRevenue;
  const combinedNetProfit = netProfit + hardwareNetProfit;
  const combinedMarginPct =
    combinedGrossRevenue > 0
      ? (combinedNetProfit / combinedGrossRevenue) * 100
      : combinedNetProfit < 0
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
    'AGENT_COMMISSION',
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
    agentCommissionsCost,
    totalOutgoing,
    netProfit,
    marginPct,
    hardwareRevenue: Math.round(hardwareRevenue * 100) / 100,
    hardwareCogs: Math.round(hardwareCogs * 100) / 100,
    hardwareNetProfit: Math.round(hardwareNetProfit * 100) / 100,
    hardwareMarginPct,
    hardwareSalesCount: filteredHardwareSales.length,
    hardwareCategoryBreakdown,
    combinedGrossRevenue: Math.round(combinedGrossRevenue * 100) / 100,
    combinedNetProfit: Math.round(combinedNetProfit * 100) / 100,
    combinedMarginPct,
    filteredExpenses,
    filteredSalaries,
    filteredHardwareSales,
    periodSeries,
    distribution,
  };
}
