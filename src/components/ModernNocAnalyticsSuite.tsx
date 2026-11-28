import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Bar,
  BarChart,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import {
  TrendingUp,
  Users,
  MapPin,
  Building2,
  RefreshCw,
} from 'lucide-react';
import {
  supabase,
  SupabaseInvoice,
  SupabaseIspExpense,
  SupabasePaymentTransaction,
  SupabasePortalUser,
} from '../services/supabaseClient';
import {
  fetchDailyExpenses,
  SupabaseDailyExpense,
} from '../services/dailyCashReportService';
import { useISP } from '../context/ISPContext';
import { useCurrency } from '../context/CurrencyContext';
import { getStoredUser } from '../lib/auth';
import {
  doesInvoiceMatchScope,
  isResellerUser,
  isVisibleToCurrentUser,
  resolveResellerScope,
} from '../lib/resellerEngine';
import {
  parseFlexibleDate,
  toLocalDateKey,
  toLocalYearMonthKey,
  getCurrentMonthInputValue,
} from '../lib/dateFilter';

export interface ModernNocAnalyticsSuiteProps {
  onOpenDailyCashReport?: () => void;
}

const DONUT_COLORS = {
  online: '#10b981', // Emerald
  activeOffline: '#38bdf8', // Cyan
  expiryPool: '#f59e0b', // Amber
  suspended: '#f43f5e', // Rose
};

export const ModernNocAnalyticsSuite: React.FC<ModernNocAnalyticsSuiteProps> = ({
  onOpenDailyCashReport,
}) => {
  const { activeSessions } = useISP();
  const { formatCurrency } = useCurrency();
  const loggedInUser = getStoredUser();
  const isResellerSession = isResellerUser(loggedInUser);

  const [portalUsers, setPortalUsers] = useState<SupabasePortalUser[]>([]);
  const [invoices, setInvoices] = useState<SupabaseInvoice[]>([]);
  const [payments, setPayments] = useState<SupabasePaymentTransaction[]>([]);
  const [dailyExpenses, setDailyExpenses] = useState<SupabaseDailyExpense[]>([]);
  const [ispExpenses, setIspExpenses] = useState<SupabaseIspExpense[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [breakdownMode, setBreakdownMode] = useState<'area' | 'dealer'>('area');
  const [cashflowWindow, setCashflowWindow] = useState<'current_month' | 'last_6_months'>(
    'current_month'
  );

  const loadAnalytics = useCallback(async () => {
    try {
      const [uRes, iRes, pRes, dExpRes, ispExpRes] = await Promise.all([
        supabase.from('portal_users').select('*'),
        supabase.from('invoices').select('*').order('created_at', { ascending: false }),
        supabase
          .from('payment_transactions')
          .select('*')
          .order('payment_date', { ascending: false }),
        isResellerSession
          ? Promise.resolve({ data: [] as SupabaseDailyExpense[], tableMissing: false })
          : fetchDailyExpenses(),
        isResellerSession
          ? Promise.resolve({ data: [] as SupabaseIspExpense[] })
          : supabase.from('isp_expenses').select('*'),
      ]);

      const allUsers = (uRes.data || []) as SupabasePortalUser[];
      const scope = resolveResellerScope(loggedInUser, allUsers);

      if (scope.isIsolated) {
        const scopedUsers = allUsers.filter((u) =>
          isVisibleToCurrentUser(u, loggedInUser, {
            childSubDealerIds: scope.allowedResellerIds,
            allowedSubscriberUsernames: scope.allowedSubscriberUsernames,
          })
        );
        const scopedInvs = ((iRes.data || []) as SupabaseInvoice[]).filter((inv) =>
          doesInvoiceMatchScope(inv, scope)
        );
        const allowedNames = new Set<string>([
          ...(scope.allowedSubscriberUsernames || []),
          ...scopedInvs.map((inv) => String(inv.subscriber_username || '').trim().toLowerCase()),
        ]);
        const scopedPays = ((pRes.data || []) as SupabasePaymentTransaction[]).filter((tx) =>
          allowedNames.has(String(tx.subscriber_username || '').trim().toLowerCase())
        );
        setPortalUsers(scopedUsers);
        setInvoices(scopedInvs);
        setPayments(scopedPays);
        setDailyExpenses([]);
        setIspExpenses([]);
      } else {
        setPortalUsers(allUsers);
        setInvoices((iRes.data || []) as SupabaseInvoice[]);
        setPayments((pRes.data || []) as SupabasePaymentTransaction[]);
        setDailyExpenses(dExpRes.data || []);
        setIspExpenses((ispExpRes.data || []) as SupabaseIspExpense[]);
      }
    } catch {
      // Non-fatal fallback to empty state
    } finally {
      setIsLoading(false);
    }
  }, [isResellerSession, loggedInUser?.id]);

  useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics]);

  // 1. Daily Collections vs. Expenses vs. Net Profit Series
  const cashflowSeries = useMemo(() => {
    const currentMonth = getCurrentMonthInputValue();
    const isMonthly = cashflowWindow === 'last_6_months';
    const buckets = new Map<string, { collections: number; expenses: number }>();

    const touch = (rawDate: string | null | undefined, field: 'collections' | 'expenses', amount: number) => {
      if (!amount || amount <= 0) return;
      const parsed = parseFlexibleDate(rawDate);
      if (!parsed) return;
      const ym = toLocalYearMonthKey(parsed);
      if (!isMonthly && ym !== currentMonth) return;
      const key = isMonthly ? ym : toLocalDateKey(parsed);
      const cur = buckets.get(key) || { collections: 0, expenses: 0 };
      cur[field] += amount;
      buckets.set(key, cur);
    };

    const creditedByInv: Record<string, number> = {};
    for (const tx of payments) {
      const amt = Number(tx.amount_paid) || 0;
      if (amt <= 0) continue;
      touch(tx.payment_date || tx.created_at, 'collections', amt);
      if (tx.invoice_id) creditedByInv[tx.invoice_id] = (creditedByInv[tx.invoice_id] || 0) + amt;
    }

    for (const inv of invoices) {
      const total = Number(inv.amount) || 0;
      const statusUpper = String(inv.status || '').toUpperCase();
      const paid = Number(inv.paid_amount) || (statusUpper === 'PAID' ? total : 0);
      const residual = Math.max(0, paid - (creditedByInv[inv.id] || 0));
      if (residual > 0) {
        touch(inv.paid_at || inv.created_at || inv.due_date, 'collections', residual);
      }
    }

    for (const dExp of dailyExpenses) {
      touch(dExp.expense_date || dExp.created_at, 'expenses', Number(dExp.amount) || 0);
    }
    for (const iExp of ispExpenses) {
      touch(iExp.expense_date || iExp.created_at, 'expenses', Number(iExp.amount) || 0);
    }

    const sortedKeys = Array.from(buckets.keys()).sort((a, b) => a.localeCompare(b));
    const slicedKeys = isMonthly ? sortedKeys.slice(-6) : sortedKeys;

    return slicedKeys.map((key) => {
      const vals = buckets.get(key)!;
      const collections = Math.round(vals.collections);
      const expenses = Math.round(vals.expenses);
      let label = key;
      if (isMonthly) {
        const [y, m] = key.split('-').map(Number);
        if (y && m) {
          label = new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
        }
      } else {
        const [y, m, d] = key.split('-').map(Number);
        if (y && m && d) {
          label = new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
        }
      }
      return {
        key,
        label,
        collections,
        expenses,
        netProfit: collections - expenses,
      };
    });
  }, [payments, invoices, dailyExpenses, ispExpenses, cashflowWindow]);

  // 2. Subscriber Growth & Active vs. Expiry Pool Distribution Donut
  const subscriberDistribution = useMemo(() => {
    const clients = portalUsers.filter((u) => String(u.role || '').toUpperCase() === 'CLIENT');
    const onlineSet = new Set(
      (activeSessions || [])
        .map((s) => String(s?.username || '').trim().toLowerCase())
        .filter(Boolean)
    );

    let online = 0;
    let activeOffline = 0;
    let expiryPool = 0;
    let suspended = 0;

    for (const c of clients) {
      const uname = String(c.username || '').trim().toLowerCase();
      const statusUpper = String(c.account_status || '').toUpperCase();
      const billingUpper = String(c.billing_status || '').toUpperCase();

      if (statusUpper === 'EXPIRED' || billingUpper === 'SUSPENDED_EXPIRED') {
        expiryPool++;
      } else if (statusUpper === 'SUSPENDED' || c.is_suspended === true) {
        suspended++;
      } else if (onlineSet.has(uname)) {
        online++;
      } else {
        activeOffline++;
      }
    }

    const segments = [
      { name: 'Active Online', value: online, color: DONUT_COLORS.online },
      { name: 'Active Offline', value: activeOffline, color: DONUT_COLORS.activeOffline },
      { name: 'Expiry Pool', value: expiryPool, color: DONUT_COLORS.expiryPool },
      { name: 'Suspended', value: suspended, color: DONUT_COLORS.suspended },
    ];

    return {
      total: clients.length,
      activeTotal: online + activeOffline,
      expiryTotal: expiryPool + suspended,
      segments,
      nonZeroSegments: segments.filter((s) => s.value > 0),
    };
  }, [portalUsers, activeSessions]);

  // 3. Coverage Area / Dealer Revenue Breakdown Horizontal Gradient Bar Chart
  const revenueBreakdownData = useMemo(() => {
    const userByUsername = new Map<string, SupabasePortalUser>();
    const dealerNameById = new Map<string, string>();
    for (const u of portalUsers) {
      const uname = String(u.username || '').trim().toLowerCase();
      if (uname) userByUsername.set(uname, u);
      if (u.id) dealerNameById.set(u.id, u.full_name || `@${u.username}`);
    }

    const totals = new Map<string, { revenue: number; dues: number; subscribers: number }>();

    // Attribute subscriber counts first
    for (const u of portalUsers) {
      if (String(u.role || '').toUpperCase() !== 'CLIENT') continue;
      const key =
        breakdownMode === 'area'
          ? (u.area || 'Unassigned Area').trim()
          : u.sub_dealer_id
          ? dealerNameById.get(u.sub_dealer_id) || 'Sub-Dealer'
          : u.dealer_id
          ? dealerNameById.get(u.dealer_id) || 'Dealer'
          : 'Master Direct ISP';
      const cur = totals.get(key) || { revenue: 0, dues: 0, subscribers: 0 };
      cur.subscribers += 1;
      totals.set(key, cur);
    }

    // Attribute realized & pending invoice amounts
    for (const inv of invoices) {
      const uname = String(inv.subscriber_username || '').trim().toLowerCase();
      const matchedUser = userByUsername.get(uname);
      const key =
        breakdownMode === 'area'
          ? (matchedUser?.area || 'Unassigned Area').trim()
          : inv.sub_dealer_id
          ? dealerNameById.get(inv.sub_dealer_id) || 'Sub-Dealer'
          : inv.dealer_id
          ? dealerNameById.get(inv.dealer_id) || 'Dealer'
          : matchedUser?.sub_dealer_id
          ? dealerNameById.get(matchedUser.sub_dealer_id) || 'Sub-Dealer'
          : matchedUser?.dealer_id
          ? dealerNameById.get(matchedUser.dealer_id) || 'Dealer'
          : 'Master Direct ISP';

      const amt = Number(inv.amount) || 0;
      const st = String(inv.status || '').toUpperCase();
      const paid = Number(inv.paid_amount) || (st === 'PAID' ? amt : 0);
      const pending = Math.max(0, amt - paid);

      const cur = totals.get(key) || { revenue: 0, dues: 0, subscribers: 0 };
      cur.revenue += paid;
      cur.dues += pending;
      totals.set(key, cur);
    }

    return Array.from(totals.entries())
      .map(([name, vals]) => ({
        name: name.length > 20 ? `${name.slice(0, 18)}…` : name,
        fullName: name,
        revenue: Math.round(vals.revenue),
        dues: Math.round(vals.dues),
        subscribers: vals.subscribers,
      }))
      .sort((a, b) => b.revenue + b.dues - (a.revenue + a.dues))
      .slice(0, 8);
  }, [portalUsers, invoices, breakdownMode]);

  const CashflowTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const row = payload[0]?.payload;
    if (!row) return null;
    return (
      <div className="bg-slate-950/95 border border-cyan-500/35 rounded-xl p-3.5 shadow-2xl backdrop-blur-md text-xs font-mono tabular-nums min-w-[220px] space-y-1.5">
        <div className="font-bold text-white border-b border-slate-800 pb-1.5">{row.label}</div>
        <div className="flex justify-between gap-4 text-emerald-400">
          <span>Collections:</span>
          <span className="font-bold">{formatCurrency(row.collections, 0)}</span>
        </div>
        <div className="flex justify-between gap-4 text-rose-400">
          <span>Expenses:</span>
          <span className="font-bold">{formatCurrency(row.expenses, 0)}</span>
        </div>
        <div className="pt-1.5 border-t border-slate-800 flex justify-between gap-4">
          <span className="text-slate-300">Net Profit:</span>
          <span className={`font-bold ${row.netProfit >= 0 ? 'text-cyan-300' : 'text-rose-400'}`}>
            {formatCurrency(row.netProfit, 0)}
          </span>
        </div>
      </div>
    );
  };

  const BreakdownTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const row = payload[0]?.payload;
    if (!row) return null;
    return (
      <div className="bg-slate-950/95 border border-indigo-500/35 rounded-xl p-3.5 shadow-2xl backdrop-blur-md text-xs font-mono tabular-nums min-w-[220px] space-y-1.5">
        <div className="font-bold text-white border-b border-slate-800 pb-1.5">{row.fullName}</div>
        <div className="flex justify-between gap-4 text-cyan-300">
          <span>Collected Revenue:</span>
          <span className="font-bold">{formatCurrency(row.revenue, 0)}</span>
        </div>
        <div className="flex justify-between gap-4 text-amber-300">
          <span>Pending Dues:</span>
          <span className="font-bold">{formatCurrency(row.dues, 0)}</span>
        </div>
        <div className="pt-1 border-t border-slate-800 flex justify-between gap-4 text-slate-400">
          <span>Subscribers:</span>
          <span className="font-bold text-white">{row.subscribers}</span>
        </div>
      </div>
    );
  };

  const DonutTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const item = payload[0]?.payload;
    if (!item) return null;
    const pct =
      subscriberDistribution.total > 0
        ? ((item.value / subscriberDistribution.total) * 100).toFixed(1)
        : '0.0';
    return (
      <div className="bg-slate-950/95 border border-slate-700 rounded-xl p-3 shadow-2xl backdrop-blur-md text-xs font-mono tabular-nums">
        <div className="font-bold text-white">{item.name}</div>
        <div className="text-cyan-300 mt-1">
          {item.value} subscribers ({pct}%)
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {/* Row 1: Daily Collections vs Expenses vs Net Profit (7 cols) + Subscriber Donut (5 cols) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        {/* Chart A: Dual Smooth Gradient Area + Bar Chart */}
        <div className="xl:col-span-7 bg-slate-900/90 backdrop-blur-md border border-slate-800/90 rounded-2xl p-5 shadow-xl space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Collections vs. Expenses vs. Net Profit</span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Live financial flow combining verified invoices, daily expenses &amp; operating ledger
              </p>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800 text-[11px] font-mono">
                <button
                  type="button"
                  onClick={() => setCashflowWindow('current_month')}
                  className={`px-2.5 py-1 rounded transition cursor-pointer ${
                    cashflowWindow === 'current_month'
                      ? 'bg-cyan-600 text-slate-950 font-bold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  This Month
                </button>
                <button
                  type="button"
                  onClick={() => setCashflowWindow('last_6_months')}
                  className={`px-2.5 py-1 rounded transition cursor-pointer ${
                    cashflowWindow === 'last_6_months'
                      ? 'bg-cyan-600 text-slate-950 font-bold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  6 Months
                </button>
              </div>
              {onOpenDailyCashReport && !isResellerSession && (
                <button
                  type="button"
                  onClick={onOpenDailyCashReport}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-cyan-300 text-[11px] font-mono font-semibold cursor-pointer transition whitespace-nowrap"
                >
                  Daily Report &rarr;
                </button>
              )}
            </div>
          </div>

          {isLoading ? (
            <div className="h-[270px] flex items-center justify-center bg-slate-950/60 border border-slate-800 rounded-xl text-xs font-mono text-slate-500">
              <RefreshCw className="w-4 h-4 animate-spin mr-2 text-cyan-400" />
              Loading live cashflow analytics...
            </div>
          ) : cashflowSeries.length === 0 ? (
            <div className="h-[270px] flex flex-col items-center justify-center bg-slate-950/60 border border-slate-800 rounded-xl text-center p-6 text-xs text-slate-400 font-mono">
              No collections or expenses recorded for this window yet.
            </div>
          ) : (
            <div className="h-[270px] w-full bg-slate-950/75 border border-slate-800/80 rounded-xl p-3">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={cashflowSeries}
                  margin={{ top: 10, right: 14, left: 2, bottom: 2 }}
                  barGap={4}
                >
                  <defs>
                    <linearGradient id="nocColGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.92} />
                      <stop offset="100%" stopColor="#059669" stopOpacity={0.35} />
                    </linearGradient>
                    <linearGradient id="nocExpGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.92} />
                      <stop offset="100%" stopColor="#be123c" stopOpacity={0.35} />
                    </linearGradient>
                    <linearGradient id="nocNetAreaGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.42} />
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
                  <Tooltip content={<CashflowTooltip />} cursor={{ fill: 'rgba(56,189,248,0.06)' }} />
                  <Legend
                    verticalAlign="top"
                    align="right"
                    wrapperStyle={{ fontSize: '11px', fontFamily: 'monospace', paddingBottom: '6px' }}
                  />
                  <Bar
                    dataKey="collections"
                    name="Collections"
                    fill="url(#nocColGrad)"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={28}
                  />
                  <Bar
                    dataKey="expenses"
                    name="Expenses"
                    fill="url(#nocExpGrad)"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={28}
                  />
                  <Area
                    type="monotone"
                    dataKey="netProfit"
                    name="Net Profit"
                    stroke="#38bdf8"
                    strokeWidth={2.5}
                    fill="url(#nocNetAreaGrad)"
                    dot={{ r: 3, fill: '#38bdf8', strokeWidth: 0 }}
                    activeDot={{ r: 5, fill: '#38bdf8', stroke: '#0f172a', strokeWidth: 2 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Chart B: Modern Subscriber Donut with Center KPI Badge */}
        <div className="xl:col-span-5 bg-slate-900/90 backdrop-blur-md border border-slate-800/90 rounded-2xl p-5 shadow-xl space-y-4">
          <div className="pb-3 border-b border-slate-800/80 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Users className="w-4 h-4 text-cyan-400 shrink-0" />
                <span>Subscriber Active vs. Expiry Pool</span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Live PPPoE account distribution across active &amp; restricted pools
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-center">
            <div className="sm:col-span-6 h-[240px] relative">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={
                      subscriberDistribution.nonZeroSegments.length > 0
                        ? subscriberDistribution.nonZeroSegments
                        : [{ name: 'No Subscribers', value: 1, color: '#1e293b' }]
                    }
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={62}
                    outerRadius={92}
                    paddingAngle={3}
                    stroke="#0f172a"
                    strokeWidth={3}
                  >
                    {(subscriberDistribution.nonZeroSegments.length > 0
                      ? subscriberDistribution.nonZeroSegments
                      : [{ name: 'No Subscribers', value: 1, color: '#1e293b' }]
                    ).map((seg) => (
                      <Cell key={seg.name} fill={seg.color} />
                    ))}
                  </Pie>
                  {subscriberDistribution.total > 0 && <Tooltip content={<DonutTooltip />} />}
                </PieChart>
              </ResponsiveContainer>

              {/* Center Total KPI Badge */}
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
                  Total Clients
                </span>
                <span className="text-2xl font-extrabold font-mono tabular-nums text-white">
                  {subscriberDistribution.total}
                </span>
                <span className="text-[10px] font-mono text-emerald-400 tabular-nums">
                  {subscriberDistribution.total > 0
                    ? `${Math.round((subscriberDistribution.activeTotal / subscriberDistribution.total) * 100)}% Active`
                    : '0% Active'}
                </span>
              </div>
            </div>

            <div className="sm:col-span-6 space-y-2.5">
              {subscriberDistribution.segments.map((seg) => {
                const pct =
                  subscriberDistribution.total > 0
                    ? Math.round((seg.value / subscriberDistribution.total) * 100)
                    : 0;
                return (
                  <div
                    key={seg.name}
                    className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800/80 space-y-1.5"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-2 text-slate-200 font-medium">
                        <span
                          className="w-2.5 h-2.5 rounded-sm shrink-0"
                          style={{ backgroundColor: seg.color }}
                        />
                        <span>{seg.name}</span>
                      </span>
                      <span className="font-mono tabular-nums font-bold text-white">
                        {seg.value}{' '}
                        <span className="text-slate-400 font-normal">({pct}%)</span>
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${pct}%`, backgroundColor: seg.color }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Row 2: Coverage Area / Dealer Revenue Breakdown Horizontal Gradient Bar Chart */}
      <div className="bg-slate-900/90 backdrop-blur-md border border-slate-800/90 rounded-2xl p-5 shadow-xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              {breakdownMode === 'area' ? (
                <MapPin className="w-4 h-4 text-cyan-400 shrink-0" />
              ) : (
                <Building2 className="w-4 h-4 text-indigo-400 shrink-0" />
              )}
              <span>
                {breakdownMode === 'area'
                  ? 'Coverage Area Revenue & Dues Breakdown'
                  : 'Dealer & Reseller Revenue Breakdown'}
              </span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Top performing {breakdownMode === 'area' ? 'coverage sectors' : 'dealer accounts'} ranked by collected revenue and pending dues
            </p>
          </div>

          <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs font-mono">
            <button
              type="button"
              onClick={() => setBreakdownMode('area')}
              className={`px-3 py-1 rounded transition cursor-pointer ${
                breakdownMode === 'area'
                  ? 'bg-cyan-600 text-slate-950 font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              By Coverage Area
            </button>
            <button
              type="button"
              onClick={() => setBreakdownMode('dealer')}
              className={`px-3 py-1 rounded transition cursor-pointer ${
                breakdownMode === 'dealer'
                  ? 'bg-indigo-600 text-white font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              By Dealer / Owner
            </button>
          </div>
        </div>

        {revenueBreakdownData.length === 0 ? (
          <div className="h-[220px] flex items-center justify-center bg-slate-950/70 border border-slate-800 rounded-xl text-xs font-mono text-slate-500">
            No invoice or area revenue data available yet.
          </div>
        ) : (
          <div className="h-[280px] w-full bg-slate-950/75 border border-slate-800/80 rounded-xl p-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={revenueBreakdownData}
                layout="vertical"
                margin={{ top: 8, right: 24, left: 10, bottom: 4 }}
                barGap={3}
              >
                <defs>
                  <linearGradient id="horizRevGrad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.75} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0.98} />
                  </linearGradient>
                  <linearGradient id="horizDueGrad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.7} />
                    <stop offset="100%" stopColor="#f43f5e" stopOpacity={0.95} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" horizontal={false} />
                <XAxis
                  type="number"
                  stroke="#64748b"
                  fontSize={11}
                  tickLine={false}
                  fontFamily="monospace"
                  tickFormatter={(v: number) =>
                    v >= 1000 ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k` : `${v}`
                  }
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  stroke="#cbd5e1"
                  fontSize={11}
                  tickLine={false}
                  width={130}
                  fontFamily="monospace"
                />
                <Tooltip content={<BreakdownTooltip />} cursor={{ fill: 'rgba(99,102,241,0.08)' }} />
                <Legend
                  verticalAlign="top"
                  align="right"
                  wrapperStyle={{ fontSize: '11px', fontFamily: 'monospace', paddingBottom: '6px' }}
                />
                <Bar
                  dataKey="revenue"
                  name="Collected Revenue (Rs.)"
                  fill="url(#horizRevGrad)"
                  radius={[0, 6, 6, 0]}
                  barSize={14}
                />
                <Bar
                  dataKey="dues"
                  name="Pending Dues (Rs.)"
                  fill="url(#horizDueGrad)"
                  radius={[0, 6, 6, 0]}
                  barSize={14}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
};

export default ModernNocAnalyticsSuite;
