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
} from 'recharts';
import { BarChart3, TrendingUp } from 'lucide-react';
import {
  supabase,
  SupabaseInvoice,
  SupabasePaymentTransaction,
} from '../services/supabaseClient';
import { useCurrency } from '../context/CurrencyContext';
import {
  DateFilterState,
  createDefaultDateFilter,
  describeDateFilter,
  matchesDateFilter,
  parseFlexibleDate,
  toLocalDateKey,
  toLocalYearMonthKey,
} from '../lib/dateFilter';
import { DateFilterToolbar } from './DateFilterToolbar';

export interface ReceivingVsDuesChartProps {
  invoices?: SupabaseInvoice[];
  paymentTransactions?: SupabasePaymentTransaction[];
  filter?: DateFilterState;
  autoFetch?: boolean;
  showFilterToolbar?: boolean;
  title?: string;
}

interface ChartBucket {
  sortKey: string;
  label: string;
  received: number;
  dues: number;
  invoiceCount: number;
  collectionPct: number;
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

export const ReceivingVsDuesChart: React.FC<ReceivingVsDuesChartProps> = ({
  invoices: propInvoices,
  paymentTransactions: propPayments,
  filter: propFilter,
  autoFetch = false,
  showFilterToolbar = false,
  title = 'Receiving vs. Pending Dues Analytics',
}) => {
  const { formatCurrency } = useCurrency();

  const [fetchedInvoices, setFetchedInvoices] = useState<SupabaseInvoice[]>([]);
  const [fetchedPayments, setFetchedPayments] = useState<SupabasePaymentTransaction[]>([]);
  const [internalFilter, setInternalFilter] = useState<DateFilterState>(() =>
    createDefaultDateFilter('month')
  );
  const [isLoading, setIsLoading] = useState<boolean>(autoFetch);

  const activeFilter = propFilter || internalFilter;

  const loadSupabaseFinancials = useCallback(async () => {
    if (!autoFetch) return;
    try {
      const [invRes, txRes] = await Promise.all([
        supabase.from('invoices').select('*').order('created_at', { ascending: false }),
        supabase.from('payment_transactions').select('*').order('payment_date', { ascending: false }),
      ]);
      if (Array.isArray(invRes.data)) setFetchedInvoices(invRes.data as SupabaseInvoice[]);
      if (Array.isArray(txRes.data)) setFetchedPayments(txRes.data as SupabasePaymentTransaction[]);
    } catch (err) {
      console.warn('ReceivingVsDuesChart load notice:', err);
    } finally {
      setIsLoading(false);
    }
  }, [autoFetch]);

  useEffect(() => {
    if (!autoFetch) return;
    loadSupabaseFinancials();

    const ch = supabase
      .channel('public:receiving_vs_dues_chart')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices' }, () => {
        loadSupabaseFinancials();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_transactions' }, () => {
        loadSupabaseFinancials();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, [autoFetch, loadSupabaseFinancials]);

  const rawInvoices = propInvoices ?? fetchedInvoices;
  const rawPayments = propPayments ?? fetchedPayments;

  const filteredInvoices = useMemo(() => {
    if (!propFilter && !autoFetch) return rawInvoices;
    // When parent passes already-filtered invoices alongside propFilter, re-check cleanly (idempotent)
    return (rawInvoices || []).filter((inv) =>
      matchesDateFilter([inv.created_at, inv.due_date, inv.paid_at], activeFilter)
    );
  }, [rawInvoices, activeFilter, propFilter, autoFetch]);

  const filteredPayments = useMemo(() => {
    return (rawPayments || []).filter((tx) =>
      matchesDateFilter(tx.payment_date || tx.created_at, activeFilter)
    );
  }, [rawPayments, activeFilter]);

  const isMonthlyGrouping = activeFilter.mode === 'all';

  const chartData = useMemo<ChartBucket[]>(() => {
    const buckets: Record<string, { received: number; dues: number; invoiceCount: number }> = {};

    const ensureBucket = (key: string) => {
      if (!buckets[key]) {
        buckets[key] = { received: 0, dues: 0, invoiceCount: 0 };
      }
      return buckets[key];
    };

    const getBucketKey = (rawDate?: string | null): string | null => {
      const parsed = parseFlexibleDate(rawDate);
      if (!parsed) return null;
      return isMonthlyGrouping ? toLocalYearMonthKey(parsed) : toLocalDateKey(parsed);
    };

    // Track payments by invoice_id from payment_transactions to avoid double-counting against invoices.paid_amount
    const recordedPaidByInvoiceId: Record<string, number> = {};
    const filteredInvoiceIds = new Set(filteredInvoices.map((i) => i.id));

    for (const tx of filteredPayments) {
      const amt = Number(tx.amount_paid) || 0;
      if (amt <= 0) continue;
      const key = getBucketKey(tx.payment_date || tx.created_at);
      if (!key) continue;

      ensureBucket(key).received += amt;
      if (tx.invoice_id) {
        recordedPaidByInvoiceId[tx.invoice_id] =
          (recordedPaidByInvoiceId[tx.invoice_id] || 0) + amt;
      }
    }

    for (const inv of filteredInvoices) {
      const totalAmt = Number(inv.amount) || 0;
      const statusUpper = (inv.status || '').toUpperCase();
      const paidAmt =
        Number(inv.paid_amount) || (statusUpper === 'PAID' ? totalAmt : 0);
      const pendingDue = Math.max(0, totalAmt - paidAmt);

      const invKey = getBucketKey(inv.created_at || inv.due_date);
      if (invKey) {
        const b = ensureBucket(invKey);
        b.dues += pendingDue;
        b.invoiceCount += 1;
      }

      // Credit any invoice paid_amount not already represented in payment_transactions
      const alreadyCredited = recordedPaidByInvoiceId[inv.id] || 0;
      const residualPaid = Math.max(0, paidAmt - alreadyCredited);
      if (residualPaid > 0) {
        const paidKey =
          getBucketKey(inv.paid_at || inv.created_at || inv.due_date) || invKey;
        if (paidKey) {
          ensureBucket(paidKey).received += residualPaid;
        }
      }
    }

    // Keep track of standalone payment_transactions whose invoice_id wasn't in filteredInvoices
    // (already added above; no extra action needed, ensure invoiceCount stays numeric)
    void filteredInvoiceIds;

    return Object.entries(buckets)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([sortKey, vals]) => {
        const received = Math.round(vals.received * 100) / 100;
        const dues = Math.round(vals.dues * 100) / 100;
        const total = received + dues;
        const collectionPct = total > 0 ? Math.round((received / total) * 1000) / 10 : 0;
        return {
          sortKey,
          label: formatBucketLabel(sortKey, isMonthlyGrouping),
          received,
          dues,
          invoiceCount: vals.invoiceCount,
          collectionPct,
        };
      });
  }, [filteredInvoices, filteredPayments, isMonthlyGrouping]);

  const summaryTotals = useMemo(() => {
    const received = chartData.reduce((s, d) => s + d.received, 0);
    const dues = chartData.reduce((s, d) => s + d.dues, 0);
    const total = received + dues;
    const pct = total > 0 ? Math.round((received / total) * 1000) / 10 : 0;
    return { received, dues, pct };
  }, [chartData]);

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload || !payload.length) return null;
    const row = payload[0]?.payload as ChartBucket | undefined;
    if (!row) return null;

    return (
      <div className="bg-slate-950 border border-slate-700 rounded-xl p-3 shadow-2xl text-xs font-mono tabular-nums space-y-1.5 min-w-[220px]">
        <div className="text-white font-bold border-b border-slate-800 pb-1 flex items-center justify-between gap-3">
          <span>{row.label}</span>
          <span className="text-cyan-400">{row.collectionPct.toFixed(1)}% Collected</span>
        </div>
        <div className="flex items-center justify-between gap-4 text-emerald-400">
          <span>Amount Received:</span>
          <span className="font-bold">{formatCurrency(row.received)}</span>
        </div>
        <div className="flex items-center justify-between gap-4 text-rose-400">
          <span>Pending Dues:</span>
          <span className="font-bold">{formatCurrency(row.dues)}</span>
        </div>
        <div className="pt-1 border-t border-slate-800 flex items-center justify-between gap-4 text-slate-300">
          <span>Period Volume:</span>
          <span className="font-bold text-white">{formatCurrency(row.received + row.dues)}</span>
        </div>
      </div>
    );
  };

  return (
    <div className="bg-[#111A2E] border border-slate-800 rounded-xl p-5 space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{title}</span>
          </h3>
          <p className="text-xs text-slate-400 mt-0.5 font-mono tabular-nums">
            {isMonthlyGrouping ? 'Month-by-month' : 'Day-by-day'} breakdown ({describeDateFilter(activeFilter)}) · Received:{' '}
            <strong className="text-emerald-400">{formatCurrency(summaryTotals.received)}</strong> · Dues:{' '}
            <strong className="text-rose-400">{formatCurrency(summaryTotals.dues)}</strong> ({summaryTotals.pct.toFixed(1)}% recovery)
          </p>
        </div>

        <div className="flex items-center gap-3 font-mono text-xs tabular-nums shrink-0">
          <span className="flex items-center gap-1.5 text-emerald-400 font-semibold">
            <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" />
            Received
          </span>
          <span className="flex items-center gap-1.5 text-rose-400 font-semibold">
            <span className="w-2.5 h-2.5 rounded-sm bg-rose-500 inline-block" />
            Pending Dues
          </span>
        </div>
      </div>

      {showFilterToolbar && (
        <DateFilterToolbar
          value={activeFilter}
          onChange={setInternalFilter}
          totalCount={rawInvoices.length}
          filteredCount={filteredInvoices.length}
          recordLabel="invoices"
          compact
        />
      )}

      {isLoading ? (
        <div className="h-[280px] flex items-center justify-center bg-slate-950/60 border border-slate-800 rounded-xl text-xs font-mono text-slate-500">
          Loading Receiving vs. Dues analytics...
        </div>
      ) : chartData.length === 0 ? (
        <div className="h-[260px] flex flex-col items-center justify-center bg-slate-950/60 border border-slate-800 rounded-xl text-center p-6 space-y-1.5">
          <TrendingUp className="w-7 h-7 text-slate-600" />
          <p className="text-sm font-semibold text-slate-300">
            No billing or recovery records in {describeDateFilter(activeFilter)}
          </p>
          <p className="text-xs text-slate-500 font-mono">
            Switch to All Time or adjust the month/date range to inspect historical collections and dues.
          </p>
        </div>
      ) : (
        <div className="bg-slate-950/80 border border-slate-800/80 rounded-xl p-4 h-[290px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              margin={{ top: 10, right: 16, left: 4, bottom: 4 }}
              barGap={4}
            >
              <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" opacity={0.65} />
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
                  val >= 1000 ? `${(val / 1000).toFixed(val % 1000 === 0 ? 0 : 1)}k` : `${val}`
                }
              />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }} />
              <Legend
                verticalAlign="top"
                align="right"
                wrapperStyle={{ fontSize: '11px', fontFamily: 'monospace', paddingBottom: '8px' }}
              />
              <Bar
                dataKey="received"
                name="Amount Received (PKR)"
                fill="#10b981"
                radius={[4, 4, 0, 0]}
                maxBarSize={44}
              />
              <Bar
                dataKey="dues"
                name="Pending Dues (PKR)"
                fill="#ef4444"
                radius={[4, 4, 0, 0]}
                maxBarSize={44}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};

export default ReceivingVsDuesChart;
