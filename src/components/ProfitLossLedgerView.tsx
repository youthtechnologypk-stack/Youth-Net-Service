import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  PlusCircle,
  Search,
  Edit3,
  Trash2,
  X,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Server,
  Users,
  Wrench,
  DollarSign,
  PieChart as PieChartIcon,
  BarChart3,
  Receipt,
} from 'lucide-react';
import {
  supabase,
  IspExpenseCategory,
  IspExpensePaymentMethod,
  SupabaseAgentCashTransaction,
  SupabaseInvoice,
  SupabaseIspExpense,
  SupabasePaymentTransaction,
  SupabasePortalUser,
} from '../services/supabaseClient';
import { useCurrency } from '../context/CurrencyContext';
import { getStoredUser } from '../lib/auth';
import {
  DateFilterState,
  createDefaultDateFilter,
  describeDateFilter,
  getTodayDateInputValue,
  parseFlexibleDate,
} from '../lib/dateFilter';
import { DateFilterToolbar } from './DateFilterToolbar';
import {
  ISP_EXPENSE_CATEGORIES,
  PAYMENT_METHODS,
  computeProfitLossSummary,
  encodeExpenseNotes,
  formatPaymentMethodLabel,
  getExpenseCategoryMeta,
  parseExpenseNotes,
} from '../lib/profitLoss';

interface UnifiedLedgerRow {
  uid: string;
  sourceType: 'EXPENSE' | 'SALARY';
  expenseRecord?: SupabaseIspExpense;
  dateValue: string;
  sortTimeMs: number;
  category: string;
  categoryLabel: string;
  categoryColor: string;
  title: string;
  vendor: string;
  paymentMethod: string;
  amount: number;
  recordedBy: string;
  notes: string;
}

interface ExpenseFormState {
  expense_category: IspExpenseCategory;
  title: string;
  vendor: string;
  amount: string;
  payment_method: IspExpensePaymentMethod;
  expense_date: string;
  notes: string;
}

const createInitialExpenseForm = (): ExpenseFormState => ({
  expense_category: 'UPSTREAM_BANDWIDTH',
  title: '',
  vendor: '',
  amount: '',
  payment_method: 'BANK_TRANSFER',
  expense_date: getTodayDateInputValue(),
  notes: '',
});

export const ProfitLossLedgerView: React.FC = () => {
  const { formatCurrency } = useCurrency();
  const currentUser = getStoredUser();
  const isAdmin = (currentUser?.role || 'ADMIN') === 'ADMIN';

  const [dateFilter, setDateFilter] = useState<DateFilterState>(() =>
    createDefaultDateFilter('month')
  );
  const [includeProjectedBaseSalaries, setIncludeProjectedBaseSalaries] =
    useState<boolean>(false);

  const [expenses, setExpenses] = useState<SupabaseIspExpense[]>([]);
  const [invoices, setInvoices] = useState<SupabaseInvoice[]>([]);
  const [paymentTransactions, setPaymentTransactions] = useState<
    SupabasePaymentTransaction[]
  >([]);
  const [salaryTransactions, setSalaryTransactions] = useState<
    SupabaseAgentCashTransaction[]
  >([]);
  const [staffUsers, setStaffUsers] = useState<SupabasePortalUser[]>([]);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Ledger filters
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');

  // Record / Edit Expense Modal
  const [isFormModalOpen, setIsFormModalOpen] = useState<boolean>(false);
  const [editingExpense, setEditingExpense] = useState<SupabaseIspExpense | null>(
    null
  );
  const [formState, setFormState] = useState<ExpenseFormState>(() =>
    createInitialExpenseForm()
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Delete confirmation modal state
  const [pendingDeleteExpense, setPendingDeleteExpense] =
    useState<SupabaseIspExpense | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  // Feedback banner
  const [toastMessage, setToastMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const showToast = useCallback((type: 'success' | 'error', text: string) => {
    setToastMessage({ type, text });
  }, []);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  const fetchFinancialLedgerData = useCallback(async (quiet = false) => {
    if (!quiet) setIsRefreshing(true);
    setLoadError(null);
    try {
      const [expRes, invRes, payRes, salRes, staffRes] = await Promise.all([
        supabase
          .from('isp_expenses')
          .select(
            'id,expense_category,title,amount,payment_method,expense_date,notes,recorded_by,created_at'
          )
          .order('expense_date', { ascending: false })
          .order('created_at', { ascending: false }),
        supabase
          .from('invoices')
          .select('*')
          .order('created_at', { ascending: false }),
        supabase
          .from('payment_transactions')
          .select('*')
          .order('payment_date', { ascending: false }),
        supabase
          .from('agent_cash_transactions')
          .select('*')
          .eq('transaction_type', 'SALARY_PAYOUT')
          .order('created_at', { ascending: false }),
        supabase
          .from('portal_users')
          .select('id,username,full_name,role,base_salary')
          .in('role', ['AGENT', 'MANAGER']),
      ]);

      if (expRes.error) throw expRes.error;
      if (Array.isArray(expRes.data))
        setExpenses(expRes.data as SupabaseIspExpense[]);
      if (Array.isArray(invRes.data))
        setInvoices(invRes.data as SupabaseInvoice[]);
      if (Array.isArray(payRes.data))
        setPaymentTransactions(payRes.data as SupabasePaymentTransaction[]);
      if (Array.isArray(salRes.data))
        setSalaryTransactions(salRes.data as SupabaseAgentCashTransaction[]);
      if (Array.isArray(staffRes.data))
        setStaffUsers(staffRes.data as SupabasePortalUser[]);
    } catch (err: any) {
      setLoadError(err?.message || 'Failed to load financial ledger from Supabase.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchFinancialLedgerData(true);

    const channel = supabase
      .channel('public:profit_loss_ledger_sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'isp_expenses' },
        () => fetchFinancialLedgerData(true)
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'payment_transactions' },
        () => fetchFinancialLedgerData(true)
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'invoices' },
        () => fetchFinancialLedgerData(true)
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'agent_cash_transactions' },
        () => fetchFinancialLedgerData(true)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchFinancialLedgerData]);

  const summary = useMemo(
    () =>
      computeProfitLossSummary({
        invoices,
        paymentTransactions,
        expenses,
        salaryTransactions,
        staffUsers,
        filter: dateFilter,
        includeProjectedBaseSalaries,
      }),
    [
      invoices,
      paymentTransactions,
      expenses,
      salaryTransactions,
      staffUsers,
      dateFilter,
      includeProjectedBaseSalaries,
    ]
  );

  const unifiedRows = useMemo<UnifiedLedgerRow[]>(() => {
    const rows: UnifiedLedgerRow[] = [];

    for (const exp of summary.filteredExpenses) {
      const meta = getExpenseCategoryMeta(exp.expense_category);
      const { vendor, cleanNotes } = parseExpenseNotes(exp.notes);
      const parsedDate = parseFlexibleDate(exp.expense_date || exp.created_at);
      rows.push({
        uid: `exp-${exp.id || `${exp.expense_date}-${exp.title}`}`,
        sourceType: 'EXPENSE',
        expenseRecord: exp,
        dateValue: exp.expense_date || (exp.created_at ? exp.created_at.slice(0, 10) : ''),
        sortTimeMs: parsedDate ? parsedDate.getTime() : 0,
        category: exp.expense_category,
        categoryLabel: meta.shortLabel,
        categoryColor: meta.color,
        title: exp.title,
        vendor,
        paymentMethod: formatPaymentMethodLabel(exp.payment_method),
        amount: Number(exp.amount) || 0,
        recordedBy: exp.recorded_by || 'Admin',
        notes: cleanNotes,
      });
    }

    for (const sal of summary.filteredSalaries) {
      const meta = getExpenseCategoryMeta('SALARY_PAYOUT');
      const parsedDate = parseFlexibleDate(sal.created_at);
      const dateStr = parsedDate
        ? parsedDate.toISOString().slice(0, 10)
        : (sal.created_at || '').slice(0, 10);
      rows.push({
        uid: `sal-${sal.id || `${sal.agent_id}-${sal.created_at}`}`,
        sourceType: 'SALARY',
        dateValue: dateStr,
        sortTimeMs: parsedDate ? parsedDate.getTime() : 0,
        category: 'SALARY_PAYOUT',
        categoryLabel: meta.shortLabel,
        categoryColor: meta.color,
        title: `Salary Payout — ${sal.agent_name || sal.agent_username || 'Staff Member'}`,
        vendor: sal.agent_name || sal.agent_username || 'Field Staff',
        paymentMethod: 'Payroll / Cash',
        amount: Number(sal.amount) || 0,
        recordedBy: sal.received_by || 'Admin',
        notes: sal.notes || 'Monthly staff salary disbursement',
      });
    }

    return rows.sort((a, b) => b.sortTimeMs - a.sortTimeMs);
  }, [summary.filteredExpenses, summary.filteredSalaries]);

  const filteredLedgerRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return unifiedRows.filter((row) => {
      if (categoryFilter !== 'ALL' && row.category !== categoryFilter) {
        return false;
      }
      if (!q) return true;
      return (
        row.title.toLowerCase().includes(q) ||
        row.vendor.toLowerCase().includes(q) ||
        row.categoryLabel.toLowerCase().includes(q) ||
        row.paymentMethod.toLowerCase().includes(q) ||
        row.recordedBy.toLowerCase().includes(q) ||
        row.notes.toLowerCase().includes(q)
      );
    });
  }, [unifiedRows, categoryFilter, searchQuery]);

  const nonZeroDistribution = useMemo(
    () => summary.distribution.filter((d) => d.amount > 0),
    [summary.distribution]
  );

  const openCreateModal = () => {
    setEditingExpense(null);
    setFormState(createInitialExpenseForm());
    setFormError(null);
    setIsFormModalOpen(true);
  };

  const openEditModal = (exp: SupabaseIspExpense) => {
    const { vendor, cleanNotes } = parseExpenseNotes(exp.notes);
    setEditingExpense(exp);
    setFormState({
      expense_category:
        (exp.expense_category as IspExpenseCategory) || 'UPSTREAM_BANDWIDTH',
      title: exp.title || '',
      vendor,
      amount: String(exp.amount ?? ''),
      payment_method:
        (exp.payment_method as IspExpensePaymentMethod) || 'BANK_TRANSFER',
      expense_date: exp.expense_date || getTodayDateInputValue(),
      notes: cleanNotes,
    });
    setFormError(null);
    setIsFormModalOpen(true);
  };

  const handleSaveExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const cleanTitle = formState.title.trim();
    const numericAmount = Number(formState.amount);
    if (!cleanTitle) {
      setFormError('Please enter a descriptive expense title.');
      return;
    }
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setFormError('Please enter a valid positive amount in PKR.');
      return;
    }
    if (!formState.expense_date) {
      setFormError('Please select the expense date.');
      return;
    }

    const payload = {
      expense_category: formState.expense_category,
      title: cleanTitle,
      amount: Math.round(numericAmount * 100) / 100,
      payment_method: formState.payment_method,
      expense_date: formState.expense_date,
      notes: encodeExpenseNotes(formState.vendor, formState.notes),
      recorded_by:
        currentUser?.fullName || currentUser?.username || 'NOC Administrator',
    };

    setIsSaving(true);
    try {
      if (editingExpense?.id) {
        const { error } = await supabase
          .from('isp_expenses')
          .update(payload)
          .eq('id', editingExpense.id);
        if (error) throw error;
        showToast('success', `Updated expense "${cleanTitle}" (${formatCurrency(payload.amount)}).`);
      } else {
        const { error } = await supabase.from('isp_expenses').insert([payload]);
        if (error) throw error;
        showToast('success', `Recorded expense "${cleanTitle}" (${formatCurrency(payload.amount)}).`);
      }

      setIsFormModalOpen(false);
      setEditingExpense(null);
      await fetchFinancialLedgerData(true);
    } catch (err: any) {
      setFormError(err?.message || 'Failed to save expense to Supabase.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!pendingDeleteExpense?.id) return;
    setIsDeleting(true);
    try {
      const { error } = await supabase
        .from('isp_expenses')
        .delete()
        .eq('id', pendingDeleteExpense.id);
      if (error) throw error;

      showToast('success', `Deleted expense "${pendingDeleteExpense.title}".`);
      setPendingDeleteExpense(null);
      await fetchFinancialLedgerData(true);
    } catch (err: any) {
      showToast('error', err?.message || 'Failed to delete expense record.');
    } finally {
      setIsDeleting(false);
    }
  };

  const isProfitPositive = summary.netProfit >= 0;

  const CustomBarTooltip = ({ active, payload }: any) => {
    if (!active || !payload || !payload.length) return null;
    const row = payload[0]?.payload;
    if (!row) return null;
    return (
      <div className="bg-slate-950 border border-slate-700 rounded-xl p-3 shadow-2xl text-xs font-mono tabular-nums space-y-1.5 min-w-[220px]">
        <div className="text-white font-bold border-b border-slate-800 pb-1">
          {row.label}
        </div>
        <div className="flex items-center justify-between gap-4 text-emerald-400">
          <span>Collections:</span>
          <span className="font-bold">{formatCurrency(row.collections)}</span>
        </div>
        <div className="flex items-center justify-between gap-4 text-rose-400">
          <span>Expenses &amp; Salaries:</span>
          <span className="font-bold">{formatCurrency(row.expenses)}</span>
        </div>
        <div
          className={`pt-1 border-t border-slate-800 flex items-center justify-between gap-4 font-bold ${
            row.netProfit >= 0 ? 'text-cyan-400' : 'text-rose-400'
          }`}
        >
          <span>Net Profit:</span>
          <span>{formatCurrency(row.netProfit)}</span>
        </div>
      </div>
    );
  };

  const CustomPieTooltip = ({ active, payload }: any) => {
    if (!active || !payload || !payload.length) return null;
    const item = payload[0]?.payload;
    if (!item) return null;
    return (
      <div className="bg-slate-950 border border-slate-700 rounded-xl p-2.5 shadow-2xl text-xs font-mono tabular-nums space-y-1">
        <div className="text-white font-bold flex items-center gap-1.5">
          <span
            className="w-2.5 h-2.5 rounded-sm inline-block"
            style={{ backgroundColor: item.color }}
          />
          <span>{item.label}</span>
        </div>
        <div className="text-slate-300">
          Spend: <strong className="text-white">{formatCurrency(item.amount)}</strong> (
          {item.sharePct.toFixed(1)}%)
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Wallet className="w-5 h-5 text-cyan-400 shrink-0" />
            <span>ISP Profit &amp; Expense Ledger</span>
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Youth Net Service &middot; Upstream CIR Bills, Infrastructure Spend, Agent Salaries &amp; Automated Net P&amp;L
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => setIncludeProjectedBaseSalaries((v) => !v)}
            className={`px-3 py-2 rounded-lg text-xs font-semibold border transition cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
              includeProjectedBaseSalaries
                ? 'bg-indigo-600/20 text-indigo-300 border-indigo-500/50'
                : 'bg-slate-900 text-slate-300 border-slate-800 hover:border-slate-700'
            }`}
            title="Include contracted monthly base salaries from portal_users alongside actual SALARY_PAYOUT transactions"
          >
            <Users className="w-3.5 h-3.5 text-indigo-400" />
            <span>
              {includeProjectedBaseSalaries
                ? 'Including Base Salaries'
                : 'Actual Salary Payouts'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => fetchFinancialLedgerData(false)}
            disabled={isRefreshing}
            className="px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 text-cyan-400 ${isRefreshing ? 'animate-spin' : ''}`}
            />
            <span>Refresh</span>
          </button>

          <button
            type="button"
            onClick={openCreateModal}
            className="px-3.5 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition shadow-sm cursor-pointer whitespace-nowrap shrink-0"
          >
            <PlusCircle className="w-4 h-4" />
            <span>+ Record Expense</span>
          </button>
        </div>
      </div>

      {/* Toast Notification */}
      {toastMessage && (
        <div
          className={`px-4 py-2.5 rounded-xl border text-xs font-medium flex items-center justify-between gap-3 ${
            toastMessage.type === 'success'
              ? 'bg-emerald-950/80 border-emerald-700/60 text-emerald-200'
              : 'bg-rose-950/80 border-rose-700/60 text-rose-200'
          }`}
        >
          <span className="flex items-center gap-2">
            {toastMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            )}
            <span>{toastMessage.text}</span>
          </span>
          <button
            type="button"
            onClick={() => setToastMessage(null)}
            className="text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Load Error Banner */}
      {loadError && (
        <div className="px-4 py-3 rounded-xl bg-rose-950/80 border border-rose-700/60 text-rose-200 text-xs flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{loadError}</span>
          </span>
          <button
            type="button"
            onClick={() => fetchFinancialLedgerData(false)}
            className="px-2.5 py-1 rounded bg-rose-900 hover:bg-rose-800 text-white font-semibold cursor-pointer whitespace-nowrap"
          >
            Retry
          </button>
        </div>
      )}

      {/* Period Date Filter Toolbar */}
      <DateFilterToolbar
        value={dateFilter}
        onChange={setDateFilter}
        totalCount={expenses.length + salaryTransactions.length}
        filteredCount={unifiedRows.length}
        recordLabel="ledger entries"
      />

      {/* 5 Top KPI Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
        {/* Card 1: Gross Subscriber Collections */}
        <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-xl flex flex-col justify-between">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              Gross Collections
            </span>
            <DollarSign className="w-4 h-4 text-emerald-400 shrink-0" />
          </div>
          <div className="mt-2">
            <div className="text-xl font-bold font-mono tabular-nums text-white">
              {isLoading ? '—' : formatCurrency(summary.totalCollections, 0)}
            </div>
            <p className="text-[11px] text-slate-400 mt-1 font-mono tabular-nums">
              {summary.paymentTxCount} verified payment{summary.paymentTxCount === 1 ? '' : 's'}
            </p>
          </div>
          <div className="mt-3 pt-2 border-t border-slate-800 flex items-center justify-between text-[11px] font-mono text-emerald-400">
            <span>Total Income</span>
            <span>{describeDateFilter(dateFilter)}</span>
          </div>
        </div>

        {/* Card 2: Upstream Bandwidth Cost */}
        <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-xl flex flex-col justify-between">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              Upstream Bandwidth
            </span>
            <Server className="w-4 h-4 text-cyan-400 shrink-0" />
          </div>
          <div className="mt-2">
            <div className="text-xl font-bold font-mono tabular-nums text-white">
              {isLoading ? '—' : formatCurrency(summary.upstreamCost, 0)}
            </div>
            <p className="text-[11px] text-slate-400 mt-1 font-mono tabular-nums">
              Multinet / CIR Carrier Bills
            </p>
          </div>
          <div className="mt-3 pt-2 border-t border-slate-800 flex items-center justify-between text-[11px] font-mono text-cyan-300 tabular-nums">
            <span>CIR Cost Share</span>
            <span>
              {summary.totalCollections > 0
                ? `${((summary.upstreamCost / summary.totalCollections) * 100).toFixed(1)}% of Rev`
                : '0.0%'}
            </span>
          </div>
        </div>

        {/* Card 3: Staff & Field Agent Salaries */}
        <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-xl flex flex-col justify-between">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              Staff &amp; Agent Salaries
            </span>
            <Users className="w-4 h-4 text-indigo-400 shrink-0" />
          </div>
          <div className="mt-2">
            <div className="text-xl font-bold font-mono tabular-nums text-white">
              {isLoading ? '—' : formatCurrency(summary.staffSalaries, 0)}
            </div>
            <p className="text-[11px] text-slate-400 mt-1 font-mono tabular-nums">
              {includeProjectedBaseSalaries
                ? `Disbursed: ${formatCurrency(summary.actualSalaryPayouts, 0)}`
                : `Base Roster: ${formatCurrency(summary.projectedBaseSalaries, 0)}/mo`}
            </p>
          </div>
          <div className="mt-3 pt-2 border-t border-slate-800 flex items-center justify-between text-[11px] font-mono text-indigo-300 tabular-nums">
            <span>{summary.filteredSalaries.length} payouts logged</span>
            <span>{includeProjectedBaseSalaries ? 'Projected' : 'Actual'}</span>
          </div>
        </div>

        {/* Card 4: Infrastructure, Fiber & Power Maintenance */}
        <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-xl flex flex-col justify-between">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              Infra, Fiber &amp; Power
            </span>
            <Wrench className="w-4 h-4 text-amber-400 shrink-0" />
          </div>
          <div className="mt-2">
            <div className="text-xl font-bold font-mono tabular-nums text-white">
              {isLoading ? '—' : formatCurrency(summary.infraMaintenanceCost, 0)}
            </div>
            <p className="text-[11px] text-slate-400 mt-1 font-mono tabular-nums">
              Fiber, Solar/UPS, Office &amp; Fuel
            </p>
          </div>
          <div className="mt-3 pt-2 border-t border-slate-800 flex items-center justify-between text-[11px] font-mono text-amber-300 tabular-nums">
            <span>Total Outgoing</span>
            <span>{formatCurrency(summary.totalOutgoing, 0)}</span>
          </div>
        </div>

        {/* Card 5: Net Profit (Khalis Bachat) & Margin % */}
        <div
          className={`p-4 rounded-xl border flex flex-col justify-between ${
            isProfitPositive
              ? 'bg-emerald-950/30 border-emerald-500/40'
              : 'bg-rose-950/35 border-rose-500/40'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span
              className={`text-[11px] font-bold uppercase tracking-wider ${
                isProfitPositive ? 'text-emerald-300' : 'text-rose-300'
              }`}
            >
              Net Profit (Khalis Bachat)
            </span>
            {isProfitPositive ? (
              <TrendingUp className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <TrendingDown className="w-4 h-4 text-rose-400 shrink-0" />
            )}
          </div>
          <div className="mt-2">
            <div
              className={`text-xl font-bold font-mono tabular-nums ${
                isProfitPositive ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {isLoading ? '—' : formatCurrency(summary.netProfit, 0)}
            </div>
            <p className="text-[11px] text-slate-300 mt-1 font-mono tabular-nums">
              Income &minus; All Outgoing
            </p>
          </div>
          <div
            className={`mt-3 pt-2 border-t flex items-center justify-between text-[11px] font-mono font-bold tabular-nums ${
              isProfitPositive
                ? 'border-emerald-800/60 text-emerald-300'
                : 'border-rose-800/60 text-rose-300'
            }`}
          >
            <span>{isProfitPositive ? 'Operating Margin' : 'Status'}</span>
            <span>
              {isProfitPositive
                ? `${summary.marginPct.toFixed(1)}% Margin`
                : 'Net Deficit'}
            </span>
          </div>
        </div>
      </div>

      {/* Side-by-Side Recharts Visualizations */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Chart 1: Income vs Expenses vs Net Profit BarChart */}
        <div className="lg:col-span-7 bg-[#111A2E] border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800">
            <div>
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-cyan-400 shrink-0" />
                <span>Income vs. Total Expenses vs. Net Profit</span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5 font-mono tabular-nums">
                {dateFilter.mode === 'all' ? 'Monthly' : 'Daily'} P&amp;L comparison (
                {describeDateFilter(dateFilter)})
              </p>
            </div>
            <div className="text-xs font-mono tabular-nums text-slate-300">
              Net:{' '}
              <strong
                className={
                  isProfitPositive ? 'text-emerald-400' : 'text-rose-400'
                }
              >
                {formatCurrency(summary.netProfit, 0)}
              </strong>
            </div>
          </div>

          {isLoading ? (
            <div className="h-[290px] flex items-center justify-center bg-slate-950/60 border border-slate-800 rounded-xl text-xs font-mono text-slate-500">
              Loading financial analytics...
            </div>
          ) : summary.periodSeries.length === 0 ? (
            <div className="h-[290px] flex flex-col items-center justify-center bg-slate-950/60 border border-slate-800 rounded-xl text-center p-6 space-y-1.5">
              <BarChart3 className="w-7 h-7 text-slate-600" />
              <p className="text-sm font-semibold text-slate-300">
                No income or expense activity in {describeDateFilter(dateFilter)}
              </p>
              <p className="text-xs text-slate-500 font-mono">
                Record an upstream bill or switch to All Time to view historical cashflow.
              </p>
            </div>
          ) : (
            <div className="bg-slate-950/80 border border-slate-800/80 rounded-xl p-4 h-[290px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={summary.periodSeries}
                  margin={{ top: 10, right: 12, left: 4, bottom: 4 }}
                  barGap={4}
                >
                  <CartesianGrid
                    stroke="#1e293b"
                    strokeDasharray="3 3"
                    opacity={0.65}
                  />
                  <XAxis
                    dataKey="label"
                    stroke="#64748b"
                    fontSize={11}
                    tickLine={false}
                    fontFamily="monospace"
                  />
                  <YAxis
                    stroke="#64748b"
                    fontSize={11}
                    tickLine={false}
                    fontFamily="monospace"
                    tickFormatter={(val: number) =>
                      Math.abs(val) >= 1000
                        ? `${(val / 1000).toFixed(val % 1000 === 0 ? 0 : 1)}k`
                        : `${val}`
                    }
                  />
                  <Tooltip
                    content={<CustomBarTooltip />}
                    cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }}
                  />
                  <Legend
                    verticalAlign="top"
                    align="right"
                    wrapperStyle={{
                      fontSize: '11px',
                      fontFamily: 'monospace',
                      paddingBottom: '8px',
                    }}
                  />
                  <Bar
                    dataKey="collections"
                    name="Total Collections"
                    fill="#10b981"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={36}
                  />
                  <Bar
                    dataKey="expenses"
                    name="Expenses & Salaries"
                    fill="#f43f5e"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={36}
                  />
                  <Bar
                    dataKey="netProfit"
                    name="Net Profit"
                    fill="#06b6d4"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={36}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Chart 2: Expense Distribution Breakdown */}
        <div className="lg:col-span-5 bg-[#111A2E] border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-800">
            <div>
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <PieChartIcon className="w-4 h-4 text-amber-400 shrink-0" />
                <span>Expense Distribution Breakdown</span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5 font-mono tabular-nums">
                Total Outgoing: {formatCurrency(summary.totalOutgoing, 0)}
              </p>
            </div>
          </div>

          {nonZeroDistribution.length === 0 ? (
            <div className="h-[290px] flex flex-col items-center justify-center bg-slate-950/60 border border-slate-800 rounded-xl text-center p-6 space-y-1.5">
              <PieChartIcon className="w-7 h-7 text-slate-600" />
              <p className="text-sm font-semibold text-slate-300">
                No expenses recorded for {describeDateFilter(dateFilter)}
              </p>
              <p className="text-xs text-slate-500 font-mono">
                Click &ldquo;+ Record Expense&rdquo; to log Multinet CIR bills or field costs.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
              <div className="sm:col-span-5 h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={nonZeroDistribution}
                      dataKey="amount"
                      nameKey="label"
                      cx="50%"
                      cy="50%"
                      innerRadius={48}
                      outerRadius={78}
                      paddingAngle={2}
                      stroke="#0f172a"
                      strokeWidth={2}
                    >
                      {nonZeroDistribution.map((entry) => (
                        <Cell key={entry.key} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip content={<CustomPieTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="sm:col-span-7 space-y-2">
                {summary.distribution.map((item) => (
                  <div
                    key={item.key}
                    className="flex items-center justify-between gap-2 text-xs px-2.5 py-1.5 rounded-lg bg-slate-950/70 border border-slate-800/80"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2.5 h-2.5 rounded-sm shrink-0"
                        style={{ backgroundColor: item.color }}
                      />
                      <span className="text-slate-300 truncate">{item.label}</span>
                    </div>
                    <div className="flex items-center gap-2 font-mono tabular-nums shrink-0">
                      <span className="text-white font-semibold">
                        {formatCurrency(item.amount, 0)}
                      </span>
                      <span className="text-slate-400 text-[11px] w-11 text-right">
                        {item.sharePct.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Unified ISP Expense & Salary Audit Ledger Table */}
      <div className="bg-[#111A2E] border border-slate-800 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Receipt className="w-4 h-4 text-cyan-400 shrink-0" />
              <span>ISP Expense &amp; Salary Audit Ledger</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5 font-mono tabular-nums">
              Showing {filteredLedgerRows.length} of {unifiedRows.length} entries in{' '}
              {describeDateFilter(dateFilter)}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative min-w-[220px] flex-1 sm:flex-initial">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search title, vendor, notes..."
                className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
              />
            </div>

            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 cursor-pointer"
            >
              <option value="ALL">All Categories</option>
              {ISP_EXPENSE_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.shortLabel}
                </option>
              ))}
              <option value="SALARY_PAYOUT">Agent Salaries</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-950/80 border-b border-slate-800 text-[11px] font-mono uppercase tracking-wider text-slate-400">
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Category</th>
                <th className="py-3 px-4">Title &amp; Vendor / Payee</th>
                <th className="py-3 px-4">Method</th>
                <th className="py-3 px-4 text-right">Amount</th>
                <th className="py-3 px-4">Recorded By &amp; Notes</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {isLoading ? (
                <tr>
                  <td
                    colSpan={7}
                    className="py-10 text-center text-slate-500 font-mono"
                  >
                    Loading Supabase financial ledger...
                  </td>
                </tr>
              ) : filteredLedgerRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center space-y-2">
                    <p className="text-sm font-semibold text-slate-300">
                      No expense or salary entries match the current filters
                    </p>
                    <p className="text-xs text-slate-500 font-mono">
                      Adjust the date range, category filter, or record a new ISP expense.
                    </p>
                  </td>
                </tr>
              ) : (
                filteredLedgerRows.map((row) => (
                  <tr
                    key={row.uid}
                    className="hover:bg-slate-900/60 transition-colors"
                  >
                    <td className="py-3 px-4 font-mono tabular-nums text-slate-300 whitespace-nowrap">
                      {row.dateValue || '—'}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5 text-slate-200 font-medium">
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: row.categoryColor }}
                        />
                        <span>{row.categoryLabel}</span>
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-white">{row.title}</div>
                      {row.vendor && (
                        <div className="text-[11px] text-cyan-300 font-mono">
                          Payee: {row.vendor}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-300 whitespace-nowrap">
                      {row.paymentMethod}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold tabular-nums text-rose-400 whitespace-nowrap">
                      {formatCurrency(row.amount)}
                    </td>
                    <td className="py-3 px-4 max-w-[260px]">
                      <div className="text-[11px] text-slate-300 font-mono">
                        By: {row.recordedBy}
                      </div>
                      {row.notes && (
                        <div className="text-[11px] text-slate-400 truncate" title={row.notes}>
                          {row.notes}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      {row.sourceType === 'EXPENSE' && row.expenseRecord ? (
                        isAdmin ? (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => openEditModal(row.expenseRecord!)}
                              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 transition cursor-pointer"
                              title="Edit Expense"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setPendingDeleteExpense(row.expenseRecord!)
                              }
                              className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-950 text-rose-400 border border-slate-700 hover:border-rose-800 transition cursor-pointer"
                              title="Delete Expense"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <span className="text-[11px] font-mono text-slate-500">
                            Read-only
                          </span>
                        )
                      ) : (
                        <span className="text-[11px] font-mono text-indigo-300">
                          Agent Payroll
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Record / Edit Expense Modal */}
      {isFormModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white">
                  {editingExpense ? 'Edit ISP Expense' : 'Record New ISP Expense'}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Persists directly to Supabase PostgreSQL `isp_expenses`
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsFormModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveExpense} className="p-5 space-y-4 text-xs">
              {formError && (
                <div className="px-3 py-2 rounded-lg bg-rose-950/80 border border-rose-700/60 text-rose-200 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div>
                <label className="block text-slate-300 font-semibold mb-1.5">
                  Expense Category *
                </label>
                <select
                  value={formState.expense_category}
                  onChange={(e) =>
                    setFormState((prev) => ({
                      ...prev,
                      expense_category: e.target.value as IspExpenseCategory,
                    }))
                  }
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cyan-500"
                >
                  {ISP_EXPENSE_CATEGORIES.map((cat) => (
                    <option key={cat.value} value={cat.value}>
                      {cat.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1.5">
                  Expense Title *
                </label>
                <input
                  type="text"
                  required
                  value={formState.title}
                  onChange={(e) =>
                    setFormState((prev) => ({ ...prev, title: e.target.value }))
                  }
                  placeholder="e.g., Multinet 50M CIR Monthly Invoice - Nov"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1.5">
                    Vendor / Payee Name (Optional)
                  </label>
                  <input
                    type="text"
                    value={formState.vendor}
                    onChange={(e) =>
                      setFormState((prev) => ({ ...prev, vendor: e.target.value }))
                    }
                    placeholder="e.g., Multinet / IESCO / Fiber Tech"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1.5">
                    Amount (PKR) *
                  </label>
                  <input
                    type="number"
                    required
                    min="1"
                    step="any"
                    value={formState.amount}
                    onChange={(e) =>
                      setFormState((prev) => ({ ...prev, amount: e.target.value }))
                    }
                    placeholder="e.g., 45000"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono tabular-nums placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1.5">
                    Payment Method *
                  </label>
                  <select
                    value={formState.payment_method}
                    onChange={(e) =>
                      setFormState((prev) => ({
                        ...prev,
                        payment_method: e.target.value as IspExpensePaymentMethod,
                      }))
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cyan-500"
                  >
                    {PAYMENT_METHODS.map((pm) => (
                      <option key={pm.value} value={pm.value}>
                        {pm.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1.5">
                    Expense Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={formState.expense_date}
                    onChange={(e) =>
                      setFormState((prev) => ({
                        ...prev,
                        expense_date: e.target.value,
                      }))
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1.5">
                  Notes (Optional)
                </label>
                <textarea
                  rows={2}
                  value={formState.notes}
                  onChange={(e) =>
                    setFormState((prev) => ({ ...prev, notes: e.target.value }))
                  }
                  placeholder="Invoice reference, meter reading, or hardware batch details..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 resize-none"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2.5 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsFormModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-slate-950 font-bold cursor-pointer"
                >
                  {isSaving
                    ? 'Saving...'
                    : editingExpense
                    ? 'Update Expense'
                    : 'Save Expense'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Inline Delete Confirmation Modal */}
      {pendingDeleteExpense && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-rose-800/70 rounded-2xl w-full max-w-md shadow-2xl p-5 space-y-4 text-xs">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-xl bg-rose-950 border border-rose-800 text-rose-400 shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Delete Expense Record?</h3>
                <p className="text-slate-300 mt-1">
                  This will permanently remove{' '}
                  <strong className="text-white">{pendingDeleteExpense.title}</strong> (
                  <strong className="font-mono text-rose-400">
                    {formatCurrency(Number(pendingDeleteExpense.amount) || 0)}
                  </strong>
                  ) from Supabase and recalculate Monthly Net Profit.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setPendingDeleteExpense(null)}
                disabled={isDeleting}
                className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="px-3.5 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-bold cursor-pointer"
              >
                {isDeleting ? 'Deleting...' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProfitLossLedgerView;
