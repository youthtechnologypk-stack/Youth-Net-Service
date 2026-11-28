import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  Clock,
  Plus,
  Edit3,
  Trash2,
  FileSpreadsheet,
  FileDown,
  RefreshCw,
  Search,
  Database,
  Copy,
  Check,
  X,
  Save,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Receipt,
  Calendar,
} from 'lucide-react';
import {
  supabase,
  SupabaseInvoice,
  SupabasePaymentTransaction,
} from '../services/supabaseClient';
import {
  DAILY_EXPENSE_CATEGORIES,
  DAILY_EXPENSE_PAYMENT_METHODS,
  DAILY_EXPENSES_MIGRATION_SQL,
  DailyExpenseCategory,
  DailyExpensePaymentMethod,
  DailyReportFilterState,
  DailyReportPeriodMode,
  SupabaseDailyExpense,
  computeDailyCashReportSummary,
  createDailyExpense,
  deleteDailyExpense,
  describeDailyReportFilter,
  fetchDailyExpenses,
  updateDailyExpense,
} from '../services/dailyCashReportService';
import {
  exportDailyCashReportToExcel,
  exportDailyCashReportToPdf,
} from '../lib/dailyCashReportExport';
import { getCachedGlobalSystemSettings } from '../lib/systemSettings';
import {
  getCurrentMonthInputValue,
  getMonthStartDateInputValue,
  getTodayDateInputValue,
} from '../lib/dateFilter';
import { useCurrency } from '../context/CurrencyContext';
import { SystemRole, UserAccount } from '../types/auth';
import { getStoredUser } from '../lib/auth';

export interface DailyCashReportViewProps {
  currentUser?: UserAccount | null;
  currentRole?: SystemRole;
}

interface ExpenseModalForm {
  expense_date: string;
  category: DailyExpenseCategory;
  description: string;
  amount: string;
  paid_by: string;
  payment_method: DailyExpensePaymentMethod;
}

export const DailyCashReportView: React.FC<DailyCashReportViewProps> = ({
  currentUser: propUser,
  currentRole: propRole,
}) => {
  const { formatCurrency } = useCurrency();
  const activeUser = propUser || getStoredUser();
  const effectiveRole: SystemRole = propRole || activeUser?.role || 'ADMIN';
  const isAdmin = effectiveRole === 'ADMIN';
  const canAddExpense = effectiveRole === 'ADMIN' || effectiveRole === 'MANAGER';

  const [filter, setFilter] = useState<DailyReportFilterState>(() => {
    const today = getTodayDateInputValue();
    const month = getCurrentMonthInputValue();
    return {
      mode: 'month',
      day: today,
      month,
      startDate: getMonthStartDateInputValue(month),
      endDate: today,
    };
  });

  const [dailyExpenses, setDailyExpenses] = useState<SupabaseDailyExpense[]>([]);
  const [invoices, setInvoices] = useState<SupabaseInvoice[]>([]);
  const [paymentTransactions, setPaymentTransactions] = useState<SupabasePaymentTransaction[]>([]);
  const [tableMissing, setTableMissing] = useState<boolean>(false);
  const [copiedSql, setCopiedSql] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const [activeLedgerTab, setActiveLedgerTab] = useState<'expenses' | 'collections'>('expenses');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');

  // Add / Edit Expense Modal
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [editingRow, setEditingRow] = useState<SupabaseDailyExpense | null>(null);
  const [formState, setFormState] = useState<ExpenseModalForm>({
    expense_date: getTodayDateInputValue(),
    category: 'Fuel / Bike Patrol',
    description: '',
    amount: '',
    paid_by: activeUser?.fullName || 'Office Cashier',
    payment_method: 'Cash',
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Delete Confirmation Modal (ADMIN only)
  const [pendingDelete, setPendingDelete] = useState<SupabaseDailyExpense | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  // Toast
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    setToast({ type, message });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  const loadReportData = useCallback(async (quiet = false) => {
    if (!quiet) setIsRefreshing(true);
    try {
      const [expRes, invRes, payRes] = await Promise.all([
        fetchDailyExpenses(),
        supabase.from('invoices').select('*').order('created_at', { ascending: false }),
        supabase
          .from('payment_transactions')
          .select('*')
          .order('payment_date', { ascending: false }),
      ]);

      setTableMissing(expRes.tableMissing);
      setDailyExpenses(expRes.data);
      if (Array.isArray(invRes.data)) setInvoices(invRes.data as SupabaseInvoice[]);
      if (Array.isArray(payRes.data)) {
        setPaymentTransactions(payRes.data as SupabasePaymentTransaction[]);
      }
    } catch (err: any) {
      showToast('error', err?.message || 'Failed to load daily cash report.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [showToast]);

  useEffect(() => {
    void loadReportData(true);

    const ch = supabase
      .channel('public:daily_cash_report_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_expenses' }, () => {
        void loadReportData(true);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices' }, () => {
        void loadReportData(true);
      })
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'payment_transactions' },
        () => {
          void loadReportData(true);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, [loadReportData]);

  const summary = useMemo(
    () =>
      computeDailyCashReportSummary({
        invoices,
        paymentTransactions,
        dailyExpenses,
        filter,
      }),
    [invoices, paymentTransactions, dailyExpenses, filter]
  );

  const visibleExpenses = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return summary.filteredExpenses.filter((e) => {
      if (categoryFilter !== 'ALL' && e.category !== categoryFilter) return false;
      if (!q) return true;
      return [e.category, e.description, e.paid_by, e.payment_method, e.recorded_by, e.expense_date]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [summary.filteredExpenses, categoryFilter, searchQuery]);

  const visibleCollections = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return summary.filteredCollections.filter((c) => {
      if (!q) return true;
      return [c.invoiceNo, c.subscriberUsername, c.collectedBy, c.paymentMethod, c.notes, c.date]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [summary.filteredCollections, searchQuery]);

  const openAddModal = () => {
    setEditingRow(null);
    setFormState({
      expense_date: filter.mode === 'day' ? filter.day : getTodayDateInputValue(),
      category: 'Fuel / Bike Patrol',
      description: '',
      amount: '',
      paid_by: activeUser?.fullName || 'Office Cashier',
      payment_method: 'Cash',
    });
    setFormError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (row: SupabaseDailyExpense) => {
    if (!isAdmin) return;
    setEditingRow(row);
    setFormState({
      expense_date: row.expense_date || getTodayDateInputValue(),
      category: (DAILY_EXPENSE_CATEGORIES.includes(row.category as any)
        ? row.category
        : 'Other') as DailyExpenseCategory,
      description: row.description || '',
      amount: String(row.amount || ''),
      paid_by: row.paid_by || 'Office Cashier',
      payment_method: (DAILY_EXPENSE_PAYMENT_METHODS.includes(row.payment_method as any)
        ? row.payment_method
        : 'Cash') as DailyExpensePaymentMethod,
    });
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleSaveExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const parsedAmount = Number(formState.amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setFormError('Please enter a valid positive amount in Rs.');
      return;
    }
    if (!formState.description.trim()) {
      setFormError('Please enter a clear description of the expense.');
      return;
    }

    setIsSaving(true);
    try {
      if (editingRow) {
        const updated = await updateDailyExpense(
          editingRow.id,
          {
            expense_date: formState.expense_date,
            category: formState.category,
            description: formState.description.trim(),
            amount: parsedAmount,
            paid_by: formState.paid_by.trim() || 'Office Cashier',
            payment_method: formState.payment_method,
          },
          effectiveRole
        );
        setDailyExpenses((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
        showToast('success', 'Daily expense updated in PostgreSQL.');
      } else {
        const created = await createDailyExpense(
          {
            expense_date: formState.expense_date,
            category: formState.category,
            description: formState.description.trim(),
            amount: parsedAmount,
            paid_by: formState.paid_by.trim() || 'Office Cashier',
            payment_method: formState.payment_method,
            recorded_by: activeUser?.fullName || activeUser?.username || 'Master Admin',
          },
          effectiveRole
        );
        setDailyExpenses((prev) => [created, ...prev]);
        showToast('success', `Recorded Rs. ${parsedAmount.toLocaleString()} expense under ${formState.category}.`);
      }
      setIsModalOpen(false);
      setEditingRow(null);
    } catch (err: any) {
      setFormError(err?.message || 'Failed to save daily expense.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete || !isAdmin) return;
    setIsDeleting(true);
    try {
      await deleteDailyExpense(pendingDelete.id, effectiveRole);
      setDailyExpenses((prev) => prev.filter((r) => r.id !== pendingDelete.id));
      showToast('success', 'Daily expense deleted & cash-in-hand recalculated.');
      setPendingDelete(null);
    } catch (err: any) {
      showToast('error', err?.message || 'Failed to delete expense.');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleExportExcel = () => {
    const brand = getCachedGlobalSystemSettings().companyDisplayName || 'Youth Net Service';
    const file = exportDailyCashReportToExcel({
      companyName: brand,
      filter,
      summary,
      generatedBy: activeUser?.fullName || activeUser?.username || 'Admin',
    });
    showToast('success', `Downloaded ${file}`);
  };

  const handleExportPdf = () => {
    const brand = getCachedGlobalSystemSettings().companyDisplayName || 'Youth Net Service';
    const file = exportDailyCashReportToPdf({
      companyName: brand,
      filter,
      summary,
      generatedBy: activeUser?.fullName || activeUser?.username || 'Admin',
    });
    showToast('success', `Downloaded ${file}`);
  };

  const handleCopySql = async () => {
    try {
      await navigator.clipboard.writeText(DAILY_EXPENSES_MIGRATION_SQL);
      setCopiedSql(true);
      showToast('success', 'SQL copied! Run it in Supabase SQL Editor, then click Refresh.');
      setTimeout(() => setCopiedSql(false), 3000);
    } catch {
      showToast('error', 'Clipboard unavailable. Copy SQL manually.');
    }
  };

  const CustomCashflowTooltip = ({ active, payload }: any) => {
    if (!active || !payload || !payload.length) return null;
    const row = payload[0]?.payload;
    if (!row) return null;
    return (
      <div className="bg-slate-950/95 border border-cyan-500/30 rounded-xl p-3.5 shadow-2xl backdrop-blur-md text-xs font-mono tabular-nums min-w-[220px] space-y-1.5">
        <div className="font-bold text-white border-b border-slate-800 pb-1.5">{row.label}</div>
        <div className="flex items-center justify-between gap-4 text-emerald-400">
          <span>Collections:</span>
          <span className="font-bold">{formatCurrency(row.collections, 0)}</span>
        </div>
        <div className="flex items-center justify-between gap-4 text-rose-400">
          <span>Expenses:</span>
          <span className="font-bold">{formatCurrency(row.expenses, 0)}</span>
        </div>
        <div className="pt-1.5 border-t border-slate-800 flex items-center justify-between gap-4">
          <span className="text-slate-300">Net Cash:</span>
          <span className={`font-bold ${row.netProfit >= 0 ? 'text-cyan-300' : 'text-rose-400'}`}>
            {formatCurrency(row.netProfit, 0)}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5 max-w-full min-w-0">
      {/* Header Banner */}
      <div className="bg-slate-900/95 border border-slate-800 rounded-2xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
              <Wallet className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white tracking-tight">
                Daily Cash, Expense &amp; Collection Report
              </h1>
              <p className="text-xs text-slate-400">
                Real-time cashier reconciliation combining verified subscriber collections minus daily operational expenses ({describeDailyReportFilter(filter)})
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleExportExcel}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-950/80 hover:bg-emerald-900/80 border border-emerald-600/60 text-emerald-300 text-xs font-semibold transition cursor-pointer whitespace-nowrap"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Export Daily Report (Excel)</span>
          </button>
          <button
            type="button"
            onClick={handleExportPdf}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-rose-950/80 hover:bg-rose-900/80 border border-rose-600/60 text-rose-300 text-xs font-semibold transition cursor-pointer whitespace-nowrap"
          >
            <FileDown className="w-3.5 h-3.5" />
            <span>Export Daily Report (PDF)</span>
          </button>
          {canAddExpense && (
            <button
              type="button"
              onClick={openAddModal}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-slate-950 text-xs font-bold transition cursor-pointer shadow-sm whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>+ Add Daily Expense</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => void loadReportData(false)}
            disabled={isRefreshing}
            className="p-2 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-700 text-slate-300 transition cursor-pointer disabled:opacity-50"
            title="Refresh Report"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-cyan-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`px-4 py-3 rounded-xl border text-xs font-medium flex items-center justify-between gap-2 ${
            toast.type === 'success'
              ? 'bg-emerald-950/80 border-emerald-700/70 text-emerald-200'
              : 'bg-rose-950/80 border-rose-700/70 text-rose-200'
          }`}
        >
          <span className="flex items-center gap-2">
            {toast.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            )}
            <span>{toast.message}</span>
          </span>
          <button type="button" onClick={() => setToast(null)} className="cursor-pointer opacity-70 hover:opacity-100">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Missing Table Setup Banner */}
      {tableMissing && (
        <div className="p-4 rounded-xl bg-amber-950/60 border border-amber-700/70 text-amber-200 text-xs space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-bold text-amber-100">
              <Database className="w-4 h-4 text-amber-400" />
              <span>Supabase Table Setup Required: `daily_expenses`</span>
            </div>
            <button
              type="button"
              onClick={() => void handleCopySql()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-mono font-bold text-xs cursor-pointer transition"
            >
              {copiedSql ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedSql ? 'SQL Copied!' : 'Copy daily_expenses SQL'}</span>
            </button>
          </div>
          <p className="text-amber-200/90">
            Paste and execute the copied SQL inside your Supabase SQL Editor once to enable persistent Daily Expense tracking, then click Refresh.
          </p>
        </div>
      )}

      {/* Period Filter Toolbar (Single Day / Month / Custom Range / All Time) */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-slate-950 border border-slate-800 rounded-lg text-xs font-medium">
            {(
              [
                { id: 'day', label: 'Single Day' },
                { id: 'month', label: 'Month-Wise' },
                { id: 'range', label: 'Custom Range' },
                { id: 'all', label: 'All Time' },
              ] as Array<{ id: DailyReportPeriodMode; label: string }>
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setFilter((prev) => ({ ...prev, mode: opt.id }))}
                className={`px-3 py-1.5 rounded-md transition cursor-pointer whitespace-nowrap ${
                  filter.mode === opt.id
                    ? 'bg-cyan-600 text-slate-950 font-bold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {filter.mode === 'day' && (
            <div className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-cyan-400" />
              <input
                type="date"
                value={filter.day}
                onChange={(e) => setFilter((prev) => ({ ...prev, day: e.target.value }))}
                className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-cyan-500"
              />
            </div>
          )}

          {filter.mode === 'month' && (
            <input
              type="month"
              value={filter.month}
              onChange={(e) => setFilter((prev) => ({ ...prev, month: e.target.value }))}
              className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-cyan-500"
            />
          )}

          {filter.mode === 'range' && (
            <div className="flex items-center gap-1.5 text-xs font-mono text-slate-400">
              <input
                type="date"
                value={filter.startDate}
                onChange={(e) => setFilter((prev) => ({ ...prev, startDate: e.target.value }))}
                className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500"
              />
              <span>to</span>
              <input
                type="date"
                value={filter.endDate}
                onChange={(e) => setFilter((prev) => ({ ...prev, endDate: e.target.value }))}
                className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500"
              />
            </div>
          )}
        </div>

        <div className="text-xs font-mono text-slate-400 tabular-nums">
          {summary.collectionsCount} collections · {summary.expensesCount} expenses
        </div>
      </div>

      {/* 4 Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900/90 border border-emerald-500/30 rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="font-semibold text-emerald-400">Total Daily Collections</span>
            <TrendingUp className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-emerald-300">
            {isLoading ? '—' : formatCurrency(summary.totalCollections, 0)}
          </div>
          <div className="text-[11px] text-slate-400 font-mono tabular-nums">
            {summary.collectionsCount} verified client payment{summary.collectionsCount === 1 ? '' : 's'}
          </div>
        </div>

        <div className="bg-slate-900/90 border border-rose-500/30 rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="font-semibold text-rose-400">Total Daily Expenses</span>
            <TrendingDown className="w-4 h-4 text-rose-400" />
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-rose-300">
            {isLoading ? '—' : formatCurrency(summary.totalExpenses, 0)}
          </div>
          <div className="text-[11px] text-slate-400 font-mono tabular-nums">
            {summary.expensesCount} operational expense{summary.expensesCount === 1 ? '' : 's'}
          </div>
        </div>

        <div
          className={`rounded-xl p-4 space-y-2 border ${
            summary.netCashInHand >= 0
              ? 'bg-slate-900/90 border-cyan-500/40'
              : 'bg-rose-950/30 border-rose-500/50'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="font-semibold text-cyan-300">Net Daily Cash-in-Hand</span>
            <Wallet className="w-4 h-4 text-cyan-400" />
          </div>
          <div
            className={`text-2xl font-bold font-mono tabular-nums ${
              summary.netCashInHand >= 0 ? 'text-cyan-300' : 'text-rose-400'
            }`}
          >
            {isLoading ? '—' : formatCurrency(summary.netCashInHand, 0)}
          </div>
          <div className="text-[11px] text-slate-400 font-mono">
            Collections &minus; Expenses
          </div>
        </div>

        <div className="bg-slate-900/90 border border-amber-500/30 rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="font-semibold text-amber-400">Pending / Uncollected Dues</span>
            <Clock className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-amber-300">
            {isLoading ? '—' : formatCurrency(summary.pendingDues, 0)}
          </div>
          <div className="text-[11px] text-slate-400 font-mono">
            Remaining unpaid invoices in period
          </div>
        </div>
      </div>

      {/* Modern Recharts Cashflow Chart: Daily Collections vs Expenses vs Net Profit */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800">
          <div>
            <h2 className="text-sm font-bold text-white">
              Daily Collections vs. Expenses vs. Net Cashflow
            </h2>
            <p className="text-xs text-slate-400 font-mono tabular-nums">
              Visual breakdown for {describeDailyReportFilter(filter)}
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs font-mono">
            <span className="text-emerald-400">Collections</span>
            <span className="text-rose-400">Expenses</span>
            <span className="text-cyan-300">Net Cash</span>
          </div>
        </div>

        {summary.dailySeries.length === 0 ? (
          <div className="h-[240px] flex flex-col items-center justify-center bg-slate-950/70 border border-slate-800 rounded-xl text-center p-6 space-y-1">
            <Receipt className="w-7 h-7 text-slate-600" />
            <p className="text-sm font-semibold text-slate-300">
              No collections or expenses logged in {describeDailyReportFilter(filter)}
            </p>
            <p className="text-xs text-slate-500">
              Add a daily expense or switch to Month-Wise / All Time to inspect cashflow trends.
            </p>
          </div>
        ) : (
          <div className="h-[270px] w-full bg-slate-950/80 border border-slate-800/80 rounded-xl p-3">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={summary.dailySeries}
                margin={{ top: 10, right: 16, left: 4, bottom: 4 }}
                barGap={4}
              >
                <defs>
                  <linearGradient id="dailyColBarGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.95} />
                    <stop offset="100%" stopColor="#059669" stopOpacity={0.45} />
                  </linearGradient>
                  <linearGradient id="dailyExpBarGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.95} />
                    <stop offset="100%" stopColor="#be123c" stopOpacity={0.45} />
                  </linearGradient>
                  <linearGradient id="dailyNetAreaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.38} />
                    <stop offset="95%" stopColor="#38bdf8" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" vertical={false} />
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
                  tickFormatter={(v: number) =>
                    Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k` : `${v}`
                  }
                />
                <Tooltip content={<CustomCashflowTooltip />} cursor={{ fill: 'rgba(56,189,248,0.06)' }} />
                <Legend
                  verticalAlign="top"
                  align="right"
                  wrapperStyle={{ fontSize: '11px', fontFamily: 'monospace', paddingBottom: '8px' }}
                />
                <Bar
                  dataKey="collections"
                  name="Collections (Rs.)"
                  fill="url(#dailyColBarGrad)"
                  radius={[6, 6, 0, 0]}
                  maxBarSize={32}
                />
                <Bar
                  dataKey="expenses"
                  name="Expenses (Rs.)"
                  fill="url(#dailyExpBarGrad)"
                  radius={[6, 6, 0, 0]}
                  maxBarSize={32}
                />
                <Area
                  type="monotone"
                  dataKey="netProfit"
                  name="Net Cash-in-Hand (Rs.)"
                  stroke="#38bdf8"
                  strokeWidth={2.5}
                  fill="url(#dailyNetAreaGrad)"
                  dot={{ r: 3, fill: '#38bdf8', strokeWidth: 0 }}
                  activeDot={{ r: 5, fill: '#38bdf8', stroke: '#0f172a', strokeWidth: 2 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Itemized Ledger Tabs: Daily Expenses vs Client Collections */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 p-1 bg-slate-950 border border-slate-800 rounded-lg text-xs">
            <button
              type="button"
              onClick={() => setActiveLedgerTab('expenses')}
              className={`px-3 py-1.5 rounded-md font-semibold transition cursor-pointer ${
                activeLedgerTab === 'expenses'
                  ? 'bg-rose-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Daily Expenses ({visibleExpenses.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveLedgerTab('collections')}
              className={`px-3 py-1.5 rounded-md font-semibold transition cursor-pointer ${
                activeLedgerTab === 'collections'
                  ? 'bg-emerald-600 text-slate-950 font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Client Collections ({visibleCollections.length})
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {activeLedgerTab === 'expenses' && (
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
              >
                <option value="ALL">All Categories</option>
                {DAILY_EXPENSE_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            )}

            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search description, staff, invoice..."
                className="bg-slate-950 border border-slate-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 w-56"
              />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          {activeLedgerTab === 'expenses' ? (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-950 border-b border-slate-800 text-slate-400 font-mono text-[11px] uppercase tracking-wider">
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">Description</th>
                  <th className="py-3 px-4">Paid By &amp; Method</th>
                  <th className="py-3 px-4">Recorded By</th>
                  <th className="py-3 px-4 text-right">Amount</th>
                  {isAdmin && <th className="py-3 px-4 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {visibleExpenses.length === 0 ? (
                  <tr>
                    <td colSpan={isAdmin ? 7 : 6} className="py-10 text-center text-slate-400 font-mono">
                      No daily expenses recorded in {describeDailyReportFilter(filter)}.
                    </td>
                  </tr>
                ) : (
                  visibleExpenses.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-950/60 transition">
                      <td className="py-3 px-4 font-mono tabular-nums text-slate-300 whitespace-nowrap">
                        {row.expense_date}
                      </td>
                      <td className="py-3 px-4 font-medium text-amber-300 whitespace-nowrap">
                        {row.category}
                      </td>
                      <td className="py-3 px-4 text-slate-100 max-w-xs">{row.description}</td>
                      <td className="py-3 px-4 text-slate-300 whitespace-nowrap">
                        <span>{row.paid_by}</span>
                        <span className="text-slate-500"> · </span>
                        <span className="font-mono text-cyan-300">{row.payment_method}</span>
                      </td>
                      <td className="py-3 px-4 text-slate-400 whitespace-nowrap">
                        {row.recorded_by}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums font-bold text-rose-400 whitespace-nowrap">
                        {formatCurrency(row.amount, 0)}
                      </td>
                      {isAdmin && (
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => openEditModal(row)}
                              className="p-1.5 rounded-lg bg-sky-950/70 hover:bg-sky-900 border border-sky-700/60 text-sky-300 transition cursor-pointer"
                              title="Edit Expense"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setPendingDelete(row)}
                              className="p-1.5 rounded-lg bg-rose-950/70 hover:bg-rose-900 border border-rose-700/60 text-rose-300 transition cursor-pointer"
                              title="Delete Expense"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-950 border-b border-slate-800 text-slate-400 font-mono text-[11px] uppercase tracking-wider">
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Invoice #</th>
                  <th className="py-3 px-4">Subscriber</th>
                  <th className="py-3 px-4">Collected By</th>
                  <th className="py-3 px-4">Method</th>
                  <th className="py-3 px-4">Notes</th>
                  <th className="py-3 px-4 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {visibleCollections.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-slate-400 font-mono">
                      No client collections recorded in {describeDailyReportFilter(filter)}.
                    </td>
                  </tr>
                ) : (
                  visibleCollections.map((col) => (
                    <tr key={col.id} className="hover:bg-slate-950/60 transition">
                      <td className="py-3 px-4 font-mono tabular-nums text-slate-300 whitespace-nowrap">
                        {col.date}
                      </td>
                      <td className="py-3 px-4 font-mono text-cyan-300 whitespace-nowrap">
                        {col.invoiceNo}
                      </td>
                      <td className="py-3 px-4 font-mono font-bold text-white whitespace-nowrap">
                        @{col.subscriberUsername}
                      </td>
                      <td className="py-3 px-4 text-slate-300 whitespace-nowrap">
                        {col.collectedBy}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-400 whitespace-nowrap">
                        {col.paymentMethod}
                      </td>
                      <td className="py-3 px-4 text-slate-400 max-w-xs truncate">
                        {col.notes || '—'}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums font-bold text-emerald-400 whitespace-nowrap">
                        {formatCurrency(col.amount, 0)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Add / Edit Daily Expense Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[100] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-5 py-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">
                {editingRow ? 'Edit Daily Expense Entry' : 'Add Daily Expense'}
              </h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="p-1 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveExpense} className="p-5 space-y-4 text-xs">
              {formError && (
                <div className="p-3 rounded-lg bg-rose-950/80 border border-rose-700 text-rose-200 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Expense Date</label>
                  <input
                    type="date"
                    required
                    value={formState.expense_date}
                    onChange={(e) => setFormState((p) => ({ ...p, expense_date: e.target.value }))}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-cyan-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Category</label>
                  <select
                    value={formState.category}
                    onChange={(e) =>
                      setFormState((p) => ({
                        ...p,
                        category: e.target.value as DailyExpenseCategory,
                      }))
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cyan-500"
                  >
                    {DAILY_EXPENSE_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Description</label>
                <input
                  type="text"
                  required
                  placeholder="e.g., Bike petrol for Saddar recovery run / Drop wire roll purchase"
                  value={formState.description}
                  onChange={(e) => setFormState((p) => ({ ...p, description: e.target.value }))}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Amount (Rs.)</label>
                  <input
                    type="number"
                    min="1"
                    step="any"
                    required
                    placeholder="1500"
                    value={formState.amount}
                    onChange={(e) => setFormState((p) => ({ ...p, amount: e.target.value }))}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono tabular-nums focus:outline-none focus:border-cyan-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Paid By</label>
                  <input
                    type="text"
                    required
                    value={formState.paid_by}
                    onChange={(e) => setFormState((p) => ({ ...p, paid_by: e.target.value }))}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cyan-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Payment Method</label>
                  <select
                    value={formState.payment_method}
                    onChange={(e) =>
                      setFormState((p) => ({
                        ...p,
                        payment_method: e.target.value as DailyExpensePaymentMethod,
                      }))
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cyan-500"
                  >
                    {DAILY_EXPENSE_PAYMENT_METHODS.map((pm) => (
                      <option key={pm} value={pm}>
                        {pm}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold cursor-pointer disabled:opacity-50"
                >
                  {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  <span>{editingRow ? 'Save Changes' : 'Record Expense'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal (ADMIN Only) */}
      {pendingDelete && isAdmin && (
        <div className="fixed inset-0 z-[105] bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 border border-rose-700/70 rounded-2xl p-5 space-y-4 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-xl bg-rose-950 text-rose-400 border border-rose-800 shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-white">Delete Daily Expense?</h3>
                <p className="text-xs text-slate-400">
                  This permanently deletes the entry from PostgreSQL and recalculates Net Cash-in-Hand.
                </p>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-400">Date:</span>
                <span className="text-white">{pendingDelete.expense_date}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Category:</span>
                <span className="text-amber-300">{pendingDelete.category}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Amount:</span>
                <span className="text-rose-400 font-bold">
                  {formatCurrency(pendingDelete.amount, 0)}
                </span>
              </div>
              <div className="pt-1 border-t border-slate-800 text-slate-300 font-sans">
                {pendingDelete.description}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingDelete(null)}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmDelete()}
                disabled={isDeleting}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                {isDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                <span>Confirm Delete</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DailyCashReportView;
