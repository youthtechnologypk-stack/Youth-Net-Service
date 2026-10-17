import React, { useState, useMemo } from 'react';
import {
  Calendar,
  DollarSign,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Search,
  Filter,
  Plus,
  Edit3,
  Printer,
  RotateCw,
  X,
  User,
  ShieldCheck,
  Undo2,
  CreditCard,
  Building,
  Smartphone,
  ChevronRight,
  TrendingUp,
  Download,
  AlertCircle,
  Wifi,
  Cable,
  Wrench,
  Users,
  Briefcase,
  Layers,
  Send,
  Eye,
  Check,
} from 'lucide-react';
import { Invoice, PaymentMethod, InvoiceStatus, IspExpense, FieldAgent } from '../types/isp';
import { useISP } from '../context/ISPContext';
import { useCurrency } from '../context/CurrencyContext';
import { getStoredUser } from '../lib/auth';
import { SystemRole, UserAccount } from '../types/auth';
import { RecordPaymentModal } from './RecordPaymentModal';
import { ReceiptModal } from './ReceiptModal';
import { CreateInvoiceModal } from './CreateInvoiceModal';
import { EditInvoiceModal } from './EditInvoiceModal';
import { AgentSalaryModal, SalaryModalMode } from './AgentSalaryModal';
import { ReceiveCashHandoverModal } from './ReceiveCashHandoverModal';
import { AddOrEditAgentModal } from './AddOrEditAgentModal';
import { RevenueTrendChart } from './RevenueTrendChart';

export interface BillingManagementProps {
  onOpenReceiptModal?: (invoice: Invoice) => void;
  onOpenPaymentModal?: (invoice: Invoice) => void;
  currentRole?: SystemRole;
  currentUser?: UserAccount | null;
}

export const BillingManagement: React.FC<BillingManagementProps> = ({
  onOpenReceiptModal,
  onOpenPaymentModal,
  currentRole,
  currentUser,
}) => {
  const {
    invoices,
    customers,
    agents,
    expenses,
    cashHandovers,
    confirmCashHandover,
    salaryTransactions,
    runMonthlyBillingCron,
    runOverdueScanCron,
    addExpense,
    updateInvoice,
    whatsAppLogs,
  } = useISP();
  const { formatCurrency, currencySymbol, currencyCode } = useCurrency();

  // Determine current user & admin rights
  const activeUser = currentUser || getStoredUser();
  const role = currentRole || activeUser?.role || 'ADMIN';
  const isAdmin = role === 'ADMIN';

  // Sub-tabs
  const [activeTab, setActiveTab] = useState<'invoices' | 'agents' | 'expenses' | 'whatsapp'>('invoices');

  // Filter states
  const [filterStatus, setFilterStatus] = useState<string>('all'); // 'all' | 'unpaid' | 'paid' | 'overdue'
  const [dueDateFilter, setDueDateFilter] = useState<'all' | 'today' | 'this_week' | 'overdue'>('all');
  const [paymentStartDate, setPaymentStartDate] = useState<string>('');
  const [paymentEndDate, setPaymentEndDate] = useState<string>('');
  const [selectedMonth, setSelectedMonth] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isCronRunning, setIsCronRunning] = useState<boolean>(false);

  // Modals state
  const [recordModalInvoice, setRecordModalInvoice] = useState<Invoice | null>(null);
  const [isRecordPaymentOpen, setIsRecordPaymentOpen] = useState<boolean>(false);
  const [receiptModalInvoice, setReceiptModalInvoice] = useState<Invoice | null>(null);
  const [isReceiptModalOpen, setIsReceiptModalOpen] = useState<boolean>(false);
  const [invoiceToRevert, setInvoiceToRevert] = useState<Invoice | null>(null);
  const [isRevertModalOpen, setIsRevertModalOpen] = useState<boolean>(false);
  const [selectedInvoiceToEdit, setSelectedInvoiceToEdit] = useState<Invoice | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState<boolean>(false);
  const [isCreateInvoiceModalOpen, setIsCreateInvoiceModalOpen] = useState<boolean>(false);

  // Field Agent & Salary Modals state
  const [selectedAgentForSalary, setSelectedAgentForSalary] = useState<FieldAgent | null>(null);
  const [salaryModalMode, setSalaryModalMode] = useState<SalaryModalMode>('disburse_advance');
  const [isSalaryModalOpen, setIsSalaryModalOpen] = useState<boolean>(false);
  const [isReceiveCashModalOpen, setIsReceiveCashModalOpen] = useState<boolean>(false);
  const [receiveCashDefaultAgentId, setReceiveCashDefaultAgentId] = useState<string | undefined>(undefined);
  const [isAddOrEditAgentModalOpen, setIsAddOrEditAgentModalOpen] = useState<boolean>(false);
  const [selectedAgentToManage, setSelectedAgentToManage] = useState<FieldAgent | null>(null);

  // Expense modal state
  const [showAddExpenseModal, setShowAddExpenseModal] = useState<boolean>(false);
  const [newExpTitle, setNewExpTitle] = useState<string>('');
  const [newExpAmount, setNewExpAmount] = useState<string>('');
  const [newExpCategory, setNewExpCategory] = useState<IspExpense['category']>('upstream_transit');
  const [newExpPaidTo, setNewExpPaidTo] = useState<string>('');

  // Customer map for rapid PPPoE lookup
  const customerMap = useMemo(() => {
    const map = new Map<string, (typeof customers)[0]>();
    customers.forEach((c) => {
      map.set(c.id, c);
      map.set(c.name.toLowerCase(), c);
    });
    return map;
  }, [customers]);

  // Available unique billing cycle months
  const availableMonths = useMemo(() => {
    const monthsSet = new Set<string>();
    monthsSet.add('October 2026');
    monthsSet.add('September 2026');
    monthsSet.add('August 2026');
    invoices.forEach((inv) => {
      if (inv.billingMonth) {
        monthsSet.add(inv.billingMonth.trim());
      }
    });
    return Array.from(monthsSet);
  }, [invoices]);

  // Helper date checking
  const isToday = (dateStr?: string) => {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return false;
    const now = new Date();
    return (
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate()
    );
  };

  const isThisWeek = (dateStr?: string) => {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return false;
    const now = new Date();
    // within 7 days
    const diffDays = Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return diffDays >= -1 && diffDays <= 7;
  };

  // Instant Audit Summary Calculations
  const auditSummary = useMemo(() => {
    // 1. Total Due Outstanding (unpaid + overdue)
    const dueInvoices = invoices.filter((i) => i.status === 'unpaid' || i.status === 'overdue');
    const totalDueCount = dueInvoices.length;
    const totalDueAmount = dueInvoices.reduce((sum, i) => sum + i.totalAmount, 0);

    // 2. Fees Collected Today (Payment Received Date = Today)
    const collectedTodayInvoices = invoices.filter(
      (i) => i.status === 'paid' && isToday(i.paidAt)
    );
    const feesCollectedTodayCount = collectedTodayInvoices.length;
    const feesCollectedTodayAmount = collectedTodayInvoices.reduce(
      (sum, i) => sum + i.totalAmount,
      0
    );

    // 3. Overdue Defaulters Count
    const overdueInvoices = invoices.filter((i) => i.status === 'overdue');
    const overdueDefaultersCount = overdueInvoices.length;
    const overdueDefaultersAmount = overdueInvoices.reduce((sum, i) => sum + i.totalAmount, 0);

    // 4. Paid invoices total
    const paidInvoices = invoices.filter((i) => i.status === 'paid');
    const totalPaidAmount = paidInvoices.reduce((sum, i) => sum + i.totalAmount, 0);

    // 5. Total Billed
    const totalBilledAmount = invoices.reduce((sum, i) => sum + i.totalAmount, 0);

    return {
      totalDueCount,
      totalDueAmount,
      feesCollectedTodayCount,
      feesCollectedTodayAmount,
      overdueDefaultersCount,
      overdueDefaultersAmount,
      totalPaidAmount,
      totalBilledAmount,
      paidCount: paidInvoices.length,
      unpaidCount: invoices.filter((i) => i.status === 'unpaid').length,
      allCount: invoices.length,
    };
  }, [invoices]);

  // Filtered invoices according to all active criteria
  const filteredInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      // 1. Billing Cycle Month filter
      if (
        selectedMonth !== 'all' &&
        inv.billingMonth &&
        inv.billingMonth.trim().toLowerCase() !== selectedMonth.trim().toLowerCase()
      ) {
        return false;
      }

      // 2. Status Filter
      if (filterStatus === 'unpaid' && inv.status !== 'unpaid') return false;
      if (filterStatus === 'paid' && inv.status !== 'paid') return false;
      if (filterStatus === 'overdue' && inv.status !== 'overdue') return false;

      // 3. Invoice Due Date filter
      if (dueDateFilter === 'today') {
        const todayStr = new Date().toISOString().slice(0, 10);
        if (inv.dueDate !== todayStr) return false;
      } else if (dueDateFilter === 'this_week') {
        if (!isThisWeek(inv.dueDate)) return false;
      } else if (dueDateFilter === 'overdue') {
        if (inv.status !== 'overdue') return false;
      }

      // 4. Payment Arrival Date Range filter
      if (paymentStartDate) {
        if (!inv.paidAt) return false;
        const paidDatePart = inv.paidAt.slice(0, 10);
        if (paidDatePart < paymentStartDate) return false;
      }
      if (paymentEndDate) {
        if (!inv.paidAt) return false;
        const paidDatePart = inv.paidAt.slice(0, 10);
        if (paidDatePart > paymentEndDate) return false;
      }

      // 5. Search Query (invoice number, customer name, PPPoE username, phone)
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const cust = customerMap.get(inv.customerId) || customerMap.get(inv.customerName.toLowerCase());
        const pppoeUser = cust?.pppoeUsername ? cust.pppoeUsername.toLowerCase() : '';
        const matchesInv = inv.invoiceNumber.toLowerCase().includes(query);
        const matchesName = inv.customerName.toLowerCase().includes(query);
        const matchesPhone = inv.customerPhone.includes(query);
        const matchesPppoe = pppoeUser.includes(query);

        if (!matchesInv && !matchesName && !matchesPhone && !matchesPppoe) {
          return false;
        }
      }

      return true;
    });
  }, [
    invoices,
    selectedMonth,
    filterStatus,
    dueDateFilter,
    paymentStartDate,
    paymentEndDate,
    searchQuery,
    customerMap,
  ]);

  // Formatter helpers
  const formatDateTimeDisplay = (isoString?: string) => {
    if (!isoString) return '-';
    try {
      const d = new Date(isoString);
      if (isNaN(d.getTime())) return isoString;
      return d.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });
    } catch {
      return isoString;
    }
  };

  const formatDateDisplay = (dateString?: string) => {
    if (!dateString) return '-';
    try {
      const d = new Date(dateString);
      if (isNaN(d.getTime())) return dateString;
      return d.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return dateString;
    }
  };

  // Payment method badge renderer
  const renderPaymentMethodBadge = (method?: PaymentMethod | string) => {
    if (!method) {
      return <span className="text-slate-500 font-mono text-[11px]">-</span>;
    }

    const clean = method.toLowerCase();
    if (clean === 'agent_cash' || clean === 'cash') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-950 text-emerald-300 border border-emerald-800">
          <DollarSign className="w-3 h-3 text-emerald-400" />
          <span>Cash</span>
        </span>
      );
    }
    if (clean === 'easypaisa') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-900/60 text-emerald-200 border border-emerald-700">
          <Smartphone className="w-3 h-3 text-emerald-400" />
          <span>EasyPaisa</span>
        </span>
      );
    }
    if (clean === 'jazzcash') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-950 text-rose-300 border border-rose-800">
          <Smartphone className="w-3 h-3 text-rose-400" />
          <span>JazzCash</span>
        </span>
      );
    }
    if (clean === 'bank_transfer') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-950 text-indigo-300 border border-indigo-800">
          <Building className="w-3 h-3 text-indigo-400" />
          <span>Bank Transfer</span>
        </span>
      );
    }
    if (clean === 'online_gateway') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-cyan-950 text-cyan-300 border border-cyan-800">
          <CreditCard className="w-3 h-3 text-cyan-400" />
          <span>Online Gateway</span>
        </span>
      );
    }

    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
        <span>{method}</span>
      </span>
    );
  };

  // Quick Action Handlers
  const handleOpenMarkPaid = (inv: Invoice) => {
    setRecordModalInvoice(inv);
    setIsRecordPaymentOpen(true);
  };

  const handlePaymentRecorded = (
    invoice: Invoice,
    details: {
      paidAt: string;
      amount: number;
      paymentMethod: PaymentMethod | string;
      collectorName: string;
      reference?: string;
      sendWhatsAppReceipt?: boolean;
    }
  ) => {
    updateInvoice(invoice.id, {
      status: 'paid',
      paidAt: details.paidAt,
      totalAmount: details.amount,
      paymentMethod: details.paymentMethod,
      agentName: details.collectorName,
      receiptNumber: `RCPT-${invoice.invoiceNumber.replace('INV-', '')}-${Date.now().toString().slice(-4)}`,
      whatsappNoticeSent: Boolean(details.sendWhatsAppReceipt),
      whatsappNoticeTimestamp: details.sendWhatsAppReceipt ? new Date().toISOString() : undefined,
    });
    setIsRecordPaymentOpen(false);
    setRecordModalInvoice(null);
  };

  // Revert action (Admin only)
  const handleOpenRevert = (inv: Invoice) => {
    setInvoiceToRevert(inv);
    setIsRevertModalOpen(true);
  };

  const handleConfirmRevert = () => {
    if (!invoiceToRevert) return;
    // Determine whether to set to overdue or unpaid based on due date
    const isPastDue = new Date(invoiceToRevert.dueDate) < new Date();
    const newStatus: InvoiceStatus = isPastDue ? 'overdue' : 'unpaid';

    updateInvoice(invoiceToRevert.id, {
      status: newStatus,
      paidAt: undefined,
      paymentMethod: undefined,
      receiptNumber: undefined,
    });

    setIsRevertModalOpen(false);
    setInvoiceToRevert(null);
  };

  // Receipt modal handler
  const handleViewReceipt = (inv: Invoice) => {
    if (onOpenReceiptModal) {
      onOpenReceiptModal(inv);
    } else {
      setReceiptModalInvoice(inv);
      setIsReceiptModalOpen(true);
    }
  };

  // CRON simulations
  const handleRunBilling = async () => {
    setIsCronRunning(true);
    await runMonthlyBillingCron();
    setTimeout(() => setIsCronRunning(false), 600);
  };

  const handleRunOverdue = async () => {
    setIsCronRunning(true);
    await runOverdueScanCron();
    setTimeout(() => setIsCronRunning(false), 600);
  };

  // Add Expense handler
  const handleCreateExpense = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newExpTitle || !newExpAmount) return;

    addExpense({
      title: newExpTitle,
      amount: parseFloat(newExpAmount),
      category: newExpCategory,
      date: new Date().toISOString().split('T')[0],
      paidTo: newExpPaidTo || 'Vendor Escrow',
      paymentMode: 'bank_transfer',
      receiptReference: `EXP-REF-${Date.now().toString().slice(-5)}`,
    });

    setNewExpTitle('');
    setNewExpAmount('');
    setShowAddExpenseModal(false);
  };

  return (
    <div className="space-y-6">
      {/* 4 INSTANT AUDIT SUMMARY TILES */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Tile 1: Total Due Outstanding */}
        <div className="bg-slate-900 border border-slate-800 hover:border-amber-700/50 p-4 rounded-xl shadow-lg relative overflow-hidden transition group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/5 rounded-full blur-2xl pointer-events-none" />
          <div className="flex items-center justify-between">
            <span className="text-slate-400 text-xs font-mono uppercase tracking-wider flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              <span>Total Due Outstanding</span>
            </span>
            <span className="px-2 py-0.5 rounded-full bg-amber-950 text-amber-300 border border-amber-800 text-[10px] font-bold font-mono">
              {auditSummary.totalDueCount} Invoices
            </span>
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-amber-400 tracking-tight">
            {formatCurrency(auditSummary.totalDueAmount)}
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400 border-t border-slate-800/80 pt-2 font-sans">
            <span>
              {auditSummary.unpaidCount} regular due &bull; {auditSummary.overdueDefaultersCount} overdue
            </span>
            <button
              onClick={() => {
                setFilterStatus('unpaid');
                setDueDateFilter('all');
              }}
              className="text-amber-400 hover:text-amber-300 font-semibold font-mono text-[10px] flex items-center gap-0.5"
            >
              Filter Dues &rarr;
            </button>
          </div>
        </div>

        {/* Tile 2: Fees Collected Today */}
        <div className="bg-slate-900 border border-slate-800 hover:border-emerald-700/50 p-4 rounded-xl shadow-lg relative overflow-hidden transition group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 rounded-full blur-2xl pointer-events-none" />
          <div className="flex items-center justify-between">
            <span className="text-slate-400 text-xs font-mono uppercase tracking-wider flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>Fees Collected Today</span>
            </span>
            <span className="px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-800 text-[10px] font-bold font-mono flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              {auditSummary.feesCollectedTodayCount} Today
            </span>
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-emerald-400 tracking-tight">
            {formatCurrency(auditSummary.feesCollectedTodayAmount)}
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400 border-t border-slate-800/80 pt-2 font-sans">
            <span>Verified arrival date: {formatDateDisplay(new Date().toISOString())}</span>
            <button
              onClick={() => {
                setFilterStatus('paid');
                const todayStr = new Date().toISOString().slice(0, 10);
                setPaymentStartDate(todayStr);
                setPaymentEndDate(todayStr);
              }}
              className="text-emerald-400 hover:text-emerald-300 font-semibold font-mono text-[10px] flex items-center gap-0.5"
            >
              View Today &rarr;
            </button>
          </div>
        </div>

        {/* Tile 3: Overdue Defaulters Count */}
        <div className="bg-slate-900 border border-slate-800 hover:border-rose-700/50 p-4 rounded-xl shadow-lg relative overflow-hidden transition group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-rose-500/5 rounded-full blur-2xl pointer-events-none" />
          <div className="flex items-center justify-between">
            <span className="text-slate-400 text-xs font-mono uppercase tracking-wider flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
              <span>Overdue Defaulters</span>
            </span>
            <span className="px-2 py-0.5 rounded-full bg-rose-950 text-rose-300 border border-rose-800 text-[10px] font-bold font-mono">
              {auditSummary.overdueDefaultersCount} Accounts
            </span>
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-rose-400 tracking-tight">
            {formatCurrency(auditSummary.overdueDefaultersAmount)}
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400 border-t border-slate-800/80 pt-2 font-sans">
            <span>Walled garden isolation candidate</span>
            <button
              onClick={() => {
                setFilterStatus('overdue');
                setDueDateFilter('overdue');
              }}
              className="text-rose-400 hover:text-rose-300 font-semibold font-mono text-[10px] flex items-center gap-0.5"
            >
              Isolate &rarr;
            </button>
          </div>
        </div>

        {/* Tile 4: Total Period Revenue & Recovery Rate */}
        <div className="bg-slate-900 border border-slate-800 hover:border-cyan-700/50 p-4 rounded-xl shadow-lg relative overflow-hidden transition group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-cyan-500/5 rounded-full blur-2xl pointer-events-none" />
          <div className="flex items-center justify-between">
            <span className="text-slate-400 text-xs font-mono uppercase tracking-wider flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-cyan-400" />
              <span>Cleared Revenue</span>
            </span>
            <span className="px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-800 text-[10px] font-bold font-mono">
              {auditSummary.paidCount} / {auditSummary.allCount} Paid
            </span>
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-white tracking-tight">
            {formatCurrency(auditSummary.totalPaidAmount)}
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400 border-t border-slate-800/80 pt-2 font-sans">
            <span>
              Recovery Rate:{' '}
              <strong className="text-emerald-400 font-mono">
                {Math.round((auditSummary.totalPaidAmount / (auditSummary.totalBilledAmount || 1)) * 100)}%
              </strong>
            </span>
            <button
              onClick={() => {
                setFilterStatus('paid');
                setPaymentStartDate('');
                setPaymentEndDate('');
              }}
              className="text-cyan-400 hover:text-cyan-300 font-semibold font-mono text-[10px] flex items-center gap-0.5"
            >
              All Paid &rarr;
            </button>
          </div>
        </div>
      </div>

      {/* SUB-TABS NAVIGATION & ACTIONS */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-900 border border-slate-800 p-2.5 rounded-xl shadow-md">
        <div className="flex items-center gap-1.5 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
          <button
            onClick={() => setActiveTab('invoices')}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition ${
              activeTab === 'invoices'
                ? 'bg-cyan-600 text-slate-950 font-bold shadow-md'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <CreditCard className="w-4 h-4" />
            <span>Billing Ledger &amp; Invoices</span>
            <span
              className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                activeTab === 'invoices' ? 'bg-cyan-950 text-cyan-200' : 'bg-slate-800 text-slate-400'
              }`}
            >
              {invoices.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('agents')}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition ${
              activeTab === 'agents'
                ? 'bg-cyan-600 text-slate-950 font-bold shadow-md'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Field Agents &amp; Cash Recovery</span>
            <span
              className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                activeTab === 'agents' ? 'bg-cyan-950 text-cyan-200' : 'bg-slate-800 text-slate-400'
              }`}
            >
              {agents.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('expenses')}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition ${
              activeTab === 'expenses'
                ? 'bg-cyan-600 text-slate-950 font-bold shadow-md'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Briefcase className="w-4 h-4" />
            <span>ISP Expenses</span>
            <span
              className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                activeTab === 'expenses' ? 'bg-cyan-950 text-cyan-200' : 'bg-slate-800 text-slate-400'
              }`}
            >
              {expenses.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('whatsapp')}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition ${
              activeTab === 'whatsapp'
                ? 'bg-cyan-600 text-slate-950 font-bold shadow-md'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Send className="w-4 h-4" />
            <span>WhatsApp Billing Dispatch</span>
            <span
              className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                activeTab === 'whatsapp' ? 'bg-cyan-950 text-cyan-200' : 'bg-slate-800 text-slate-400'
              }`}
            >
              {whatsAppLogs.length}
            </span>
          </button>
        </div>

        {/* Global CRON Simulations */}
        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={handleRunBilling}
            disabled={isCronRunning}
            className="flex items-center gap-1.5 bg-indigo-950 hover:bg-indigo-900 text-indigo-300 border border-indigo-800 text-xs font-semibold px-3 py-1.5 rounded-lg transition disabled:opacity-50"
            title="Trigger automated 1st-of-month invoice generation for all active subscribers"
          >
            <RotateCw className={`w-3.5 h-3.5 ${isCronRunning ? 'animate-spin' : ''}`} />
            <span className="hidden md:inline">Run Invoicing CRON</span>
          </button>

          <button
            onClick={handleRunOverdue}
            disabled={isCronRunning}
            className="flex items-center gap-1.5 bg-amber-950 hover:bg-amber-900 text-amber-300 border border-amber-800 text-xs font-semibold px-3 py-1.5 rounded-lg transition disabled:opacity-50"
            title="Scan past due invoices and switch subscribers to walled-garden pool"
          >
            <Clock className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Overdue Scan</span>
          </button>

          <button
            onClick={() => setIsCreateInvoiceModalOpen(true)}
            className="bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs px-3.5 py-1.5 rounded-lg transition flex items-center gap-1.5 shadow-md shadow-emerald-950/40"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>+ Create Invoice</span>
          </button>
        </div>
      </div>

      {/* TAB 1: INVOICES LEDGER WITH DYNAMIC FILTERS & REVENUE TREND */}
      {activeTab === 'invoices' && (
        <div className="space-y-5">
          {/* 30-Day Revenue Trend Analysis (Collected vs. Projected Fees) */}
          <RevenueTrendChart />

          {/* TOP FILTER TOOLBAR */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg space-y-4">
            {/* ROW 1: Status Filter Pills & Month Selector */}
            <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
              {/* STATUS FILTER PILLS */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider font-mono mr-1">
                  Status:
                </span>

                {/* 1. All Invoices */}
                <button
                  type="button"
                  onClick={() => setFilterStatus('all')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-2 cursor-pointer ${
                    filterStatus === 'all'
                      ? 'bg-slate-200 text-slate-950 shadow-md font-bold'
                      : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
                  }`}
                >
                  <span>All Invoices</span>
                  <span
                    className={`px-1.5 py-0.2 rounded font-mono text-[10px] font-bold ${
                      filterStatus === 'all' ? 'bg-slate-400 text-slate-900' : 'bg-slate-800 text-slate-300'
                    }`}
                  >
                    {auditSummary.allCount}
                  </span>
                </button>

                {/* 2. Due / Unpaid (Amber/Yellow badge) */}
                <button
                  type="button"
                  onClick={() => setFilterStatus('unpaid')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-2 cursor-pointer ${
                    filterStatus === 'unpaid'
                      ? 'bg-amber-500 text-slate-950 shadow-md font-bold ring-2 ring-amber-400/50'
                      : 'bg-amber-950/50 text-amber-300 hover:bg-amber-900/60 border border-amber-800/80'
                  }`}
                >
                  <Clock className="w-3.5 h-3.5" />
                  <span>Due / Unpaid</span>
                  <span
                    className={`px-1.5 py-0.2 rounded font-mono text-[10px] font-bold ${
                      filterStatus === 'unpaid' ? 'bg-amber-700 text-amber-100' : 'bg-amber-900 text-amber-200'
                    }`}
                  >
                    {auditSummary.unpaidCount}
                  </span>
                </button>

                {/* 3. Paid / Cleared (Green badge) */}
                <button
                  type="button"
                  onClick={() => setFilterStatus('paid')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-2 cursor-pointer ${
                    filterStatus === 'paid'
                      ? 'bg-emerald-500 text-slate-950 shadow-md font-bold ring-2 ring-emerald-400/50'
                      : 'bg-emerald-950/50 text-emerald-300 hover:bg-emerald-900/60 border border-emerald-800/80'
                  }`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Paid / Cleared</span>
                  <span
                    className={`px-1.5 py-0.2 rounded font-mono text-[10px] font-bold ${
                      filterStatus === 'paid' ? 'bg-emerald-700 text-emerald-100' : 'bg-emerald-900 text-emerald-200'
                    }`}
                  >
                    {auditSummary.paidCount}
                  </span>
                </button>

                {/* 4. Overdue / Grace Expired (Red badge) */}
                <button
                  type="button"
                  onClick={() => setFilterStatus('overdue')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-2 cursor-pointer ${
                    filterStatus === 'overdue'
                      ? 'bg-rose-500 text-slate-950 shadow-md font-bold ring-2 ring-rose-400/50'
                      : 'bg-rose-950/50 text-rose-300 hover:bg-rose-900/60 border border-rose-800/80'
                  }`}
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>Overdue / Grace Expired</span>
                  <span
                    className={`px-1.5 py-0.2 rounded font-mono text-[10px] font-bold ${
                      filterStatus === 'overdue' ? 'bg-rose-700 text-rose-100' : 'bg-rose-900 text-rose-200'
                    }`}
                  >
                    {auditSummary.overdueDefaultersCount}
                  </span>
                </button>
              </div>

              {/* BILLING CYCLE MONTH SELECTOR */}
              <div className="flex items-center gap-2 w-full lg:w-auto">
                <span className="text-xs font-bold text-slate-400 font-mono uppercase tracking-wider whitespace-nowrap">
                  Billing Cycle:
                </span>
                <select
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="bg-slate-950 border border-slate-700 text-slate-200 text-xs px-3 py-1.5 rounded-lg focus:outline-none focus:border-cyan-500 font-mono w-full sm:w-auto cursor-pointer"
                >
                  <option value="all">All Billing Cycles</option>
                  {availableMonths.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* ROW 2: DATE FILTERS & SEARCH TOOLBAR */}
            <div className="pt-3 border-t border-slate-800 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 text-xs">
              {/* Left: Date Filters Group */}
              <div className="flex flex-wrap items-center gap-3">
                {/* INVOICE DUE DATE FILTER */}
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-400 font-mono text-[11px] whitespace-nowrap">Due Date:</span>
                  <select
                    value={dueDateFilter}
                    onChange={(e) => setDueDateFilter(e.target.value as any)}
                    className="bg-slate-950 border border-slate-700 text-slate-300 text-xs px-2.5 py-1.5 rounded-lg focus:outline-none focus:border-cyan-500 font-mono cursor-pointer"
                  >
                    <option value="all">All Due Dates</option>
                    <option value="today">Due Today</option>
                    <option value="this_week">Due This Week</option>
                    <option value="overdue">Overdue Only</option>
                  </select>
                </div>

                {/* PAYMENT ARRIVAL DATE RANGE */}
                <div className="flex items-center gap-1.5 bg-slate-950/80 p-1 rounded-lg border border-slate-800">
                  <Calendar className="w-3.5 h-3.5 text-cyan-400 ml-1.5 shrink-0" />
                  <span className="text-slate-400 font-mono text-[11px] whitespace-nowrap">Payment Arrival:</span>
                  <input
                    type="date"
                    value={paymentStartDate}
                    onChange={(e) => setPaymentStartDate(e.target.value)}
                    title="From payment arrival date"
                    className="bg-slate-900 border border-slate-700 text-slate-200 text-[11px] px-2 py-1 rounded focus:outline-none focus:border-cyan-500 font-mono"
                  />
                  <span className="text-slate-500 font-mono text-[11px]">to</span>
                  <input
                    type="date"
                    value={paymentEndDate}
                    onChange={(e) => setPaymentEndDate(e.target.value)}
                    title="To payment arrival date"
                    className="bg-slate-900 border border-slate-700 text-slate-200 text-[11px] px-2 py-1 rounded focus:outline-none focus:border-cyan-500 font-mono"
                  />
                  {(paymentStartDate || paymentEndDate) && (
                    <button
                      onClick={() => {
                        setPaymentStartDate('');
                        setPaymentEndDate('');
                      }}
                      className="text-slate-400 hover:text-rose-400 p-1 transition cursor-pointer"
                      title="Clear Payment Date Range"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Right: Search Input */}
              <div className="relative min-w-[260px]">
                <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search invoice, subscriber, PPPoE @username..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 text-slate-200 pl-8 pr-8 py-1.5 rounded-lg text-xs focus:outline-none focus:border-cyan-500 font-mono placeholder:text-slate-500"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-2 text-slate-400 hover:text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Active Filters Summary Bar */}
            {(filterStatus !== 'all' ||
              dueDateFilter !== 'all' ||
              paymentStartDate ||
              paymentEndDate ||
              selectedMonth !== 'all' ||
              searchQuery) && (
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800/80 text-[11px] font-mono">
                <span className="text-slate-500">Active Filters:</span>
                {filterStatus !== 'all' && (
                  <span className="px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 flex items-center gap-1">
                    Status: {filterStatus}
                    <button onClick={() => setFilterStatus('all')} className="hover:text-white">
                      &times;
                    </button>
                  </span>
                )}
                {dueDateFilter !== 'all' && (
                  <span className="px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800 flex items-center gap-1">
                    Due: {dueDateFilter}
                    <button onClick={() => setDueDateFilter('all')} className="hover:text-white">
                      &times;
                    </button>
                  </span>
                )}
                {(paymentStartDate || paymentEndDate) && (
                  <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 flex items-center gap-1">
                    Arrival: {paymentStartDate || 'Any'} &rarr; {paymentEndDate || 'Any'}
                    <button
                      onClick={() => {
                        setPaymentStartDate('');
                        setPaymentEndDate('');
                      }}
                      className="hover:text-white"
                    >
                      &times;
                    </button>
                  </span>
                )}
                {selectedMonth !== 'all' && (
                  <span className="px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800 flex items-center gap-1">
                    Cycle: {selectedMonth}
                    <button onClick={() => setSelectedMonth('all')} className="hover:text-white">
                      &times;
                    </button>
                  </span>
                )}
                {searchQuery && (
                  <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 flex items-center gap-1">
                    Query: "{searchQuery}"
                    <button onClick={() => setSearchQuery('')} className="hover:text-white">
                      &times;
                    </button>
                  </span>
                )}
                <button
                  onClick={() => {
                    setFilterStatus('all');
                    setDueDateFilter('all');
                    setPaymentStartDate('');
                    setPaymentEndDate('');
                    setSelectedMonth('all');
                    setSearchQuery('');
                  }}
                  className="text-rose-400 hover:text-rose-300 underline ml-auto text-[10px]"
                >
                  Reset All Filters
                </button>
              </div>
            )}
          </div>

          {/* DEDICATED BILLING LEDGER TABLE */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-slate-950 text-slate-400 uppercase tracking-wider text-[11px] border-b border-slate-800">
                  <tr>
                    <th className="py-3 px-4">Invoice #</th>
                    {/* Dedicated Column 1: Subscriber (Name & PPPoE Username) */}
                    <th className="py-3 px-4">Subscriber &amp; PPPoE</th>
                    {/* Dedicated Column 2: Bill Amount / Due Balance (PKR) */}
                    <th className="py-3 px-4">Bill Amount / Balance</th>
                    {/* Dedicated Column 3: Invoice Due Date */}
                    <th className="py-3 px-4">Invoice Due Date</th>
                    {/* Dedicated Column 4: Payment Received Date */}
                    <th className="py-3 px-4">Payment Received Date</th>
                    {/* Dedicated Column 5: Payment Method */}
                    <th className="py-3 px-4">Payment Method</th>
                    {/* Dedicated Column 6: Fee Status Badge */}
                    <th className="py-3 px-4">Fee Status</th>
                    {/* Dedicated Column 7: Quick Actions */}
                    <th className="py-3 px-4 text-right">Quick Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 text-slate-300">
                  {filteredInvoices.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-slate-500 font-sans">
                        <AlertCircle className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                        <span className="font-bold text-slate-400 block text-sm">No Invoices Found</span>
                        <span className="text-xs text-slate-500">
                          Try adjusting the fee status pills, date ranges, or search filters.
                        </span>
                      </td>
                    </tr>
                  ) : (
                    filteredInvoices.map((inv) => {
                      const linkedCustomer =
                        customerMap.get(inv.customerId) ||
                        customerMap.get(inv.customerName.toLowerCase());
                      const pppoeUsername = linkedCustomer?.pppoeUsername || inv.customerId;
                      const isPastDue = new Date(inv.dueDate) < new Date();

                      return (
                        <tr key={inv.id} className="hover:bg-slate-800/60 transition group">
                          {/* Invoice # */}
                          <td className="py-3 px-4 font-bold text-white whitespace-nowrap">
                            <span className="text-cyan-400 font-mono">{inv.invoiceNumber}</span>
                            <span className="text-[10px] text-slate-500 block font-sans">
                              {inv.billingMonth}
                            </span>
                          </td>

                          {/* Column 1: Subscriber (Name & PPPoE Username) */}
                          <td className="py-3 px-4">
                            <div className="font-bold text-slate-100 font-sans">{inv.customerName}</div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="px-1.5 py-0.2 rounded bg-cyan-950/80 text-cyan-300 border border-cyan-800/60 font-mono text-[10px] font-semibold">
                                @{pppoeUsername}
                              </span>
                              <span className="text-[10px] text-slate-400 font-sans">
                                {inv.customerPhone}
                              </span>
                            </div>
                            <div className="text-[10px] text-slate-500 font-sans mt-0.5">
                              Pkg: <span className="text-slate-300">{inv.packageName}</span>
                            </div>
                          </td>

                          {/* Column 2: Bill Amount / Due Balance (PKR) */}
                          <td className="py-3 px-4 whitespace-nowrap">
                            <div className="font-bold text-sm text-cyan-300">
                              {formatCurrency(inv.totalAmount)}
                            </div>
                            <div className="text-[10px] text-slate-400 font-sans mt-0.5">
                              Base: {formatCurrency(inv.baseAmount)} + Tax: {formatCurrency(inv.taxAmount)}
                            </div>
                            {linkedCustomer && linkedCustomer.balanceDue > 0 && inv.status !== 'paid' && (
                              <div className="text-[10px] text-amber-400/90 font-mono">
                                Total Acct Due: {formatCurrency(linkedCustomer.balanceDue)}
                              </div>
                            )}
                          </td>

                          {/* Column 3: Invoice Due Date */}
                          <td className="py-3 px-4 whitespace-nowrap font-sans">
                            <div
                              className={`font-semibold flex items-center gap-1 ${
                                inv.status !== 'paid' && isPastDue ? 'text-rose-400' : 'text-slate-200'
                              }`}
                            >
                              <Calendar className="w-3 h-3 text-slate-400" />
                              <span>{formatDateDisplay(inv.dueDate)}</span>
                            </div>
                            {inv.status !== 'paid' && isPastDue && (
                              <span className="inline-block mt-0.5 px-1.5 py-0.2 rounded bg-rose-950 text-rose-300 border border-rose-800 text-[9px] font-mono uppercase">
                                Grace Expired
                              </span>
                            )}
                          </td>

                          {/* Column 4: Payment Received Date */}
                          <td className="py-3 px-4 whitespace-nowrap font-mono">
                            {inv.status === 'paid' && inv.paidAt ? (
                              <div>
                                <span className="text-emerald-300 font-semibold flex items-center gap-1 font-sans text-xs">
                                  <Clock className="w-3 h-3 text-emerald-400 shrink-0" />
                                  <span>{formatDateTimeDisplay(inv.paidAt)}</span>
                                </span>
                                {inv.agentName && (
                                  <span className="text-[10px] text-slate-400 block font-sans">
                                    by: {inv.agentName}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-slate-500 text-xs font-mono">-</span>
                            )}
                          </td>

                          {/* Column 5: Payment Method */}
                          <td className="py-3 px-4 whitespace-nowrap">
                            {inv.status === 'paid' ? (
                              renderPaymentMethodBadge(inv.paymentMethod)
                            ) : (
                              <span className="text-slate-500 text-xs font-mono">-</span>
                            )}
                          </td>

                          {/* Column 6: Fee Status Badge */}
                          <td className="py-3 px-4 whitespace-nowrap font-sans">
                            {inv.status === 'paid' ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold uppercase bg-emerald-950 text-emerald-300 border border-emerald-800 shadow-sm">
                                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                                <span>Paid</span>
                              </span>
                            ) : inv.status === 'overdue' ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold uppercase bg-rose-950 text-rose-300 border border-rose-800 shadow-sm">
                                <AlertTriangle className="w-3 h-3 text-rose-400" />
                                <span>Overdue</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold uppercase bg-amber-950 text-amber-300 border border-amber-800 shadow-sm">
                                <Clock className="w-3 h-3 text-amber-400" />
                                <span>Due</span>
                              </span>
                            )}
                          </td>

                          {/* Column 7: Quick Actions */}
                          <td className="py-3 px-4 text-right whitespace-nowrap font-sans">
                            <div className="flex items-center justify-end gap-1.5">
                              {/* 1-CLICK MARK AS PAID (For Due & Overdue) */}
                              {inv.status !== 'paid' ? (
                                <button
                                  type="button"
                                  onClick={() => handleOpenMarkPaid(inv)}
                                  className="bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold px-3 py-1.5 rounded-lg text-xs transition shadow-md shadow-emerald-950/40 flex items-center gap-1 active:scale-95 cursor-pointer"
                                  title="1-Click Mark as Paid & Record Fee Receipt"
                                >
                                  <CheckCircle2 className="w-3.5 h-3.5 text-slate-950" />
                                  <span>Mark Paid</span>
                                </button>
                              ) : (
                                <>
                                  {/* RECEIPT BUTTON */}
                                  <button
                                    type="button"
                                    onClick={() => handleViewReceipt(inv)}
                                    className="bg-slate-800 hover:bg-slate-700 text-cyan-400 hover:text-white border border-slate-700 px-2.5 py-1.5 rounded-lg text-xs flex items-center gap-1 transition cursor-pointer"
                                    title="View & Print Official Receipt"
                                  >
                                    <Printer className="w-3.5 h-3.5" />
                                    <span>Receipt</span>
                                  </button>

                                  {/* MARK AS DUE / REVERT (Admin only) */}
                                  {isAdmin && (
                                    <button
                                      type="button"
                                      onClick={() => handleOpenRevert(inv)}
                                      className="bg-slate-800/80 hover:bg-rose-950 text-slate-400 hover:text-rose-300 border border-slate-700 hover:border-rose-800 px-2 py-1.5 rounded-lg text-xs flex items-center gap-1 transition cursor-pointer"
                                      title="Mark as Due / Revert Payment Entry (Admin only)"
                                    >
                                      <Undo2 className="w-3.5 h-3.5" />
                                      <span className="hidden sm:inline">Revert</span>
                                    </button>
                                  )}
                                </>
                              )}

                              {/* EDIT INVOICE */}
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedInvoiceToEdit(inv);
                                  setIsEditModalOpen(true);
                                }}
                                className="bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 p-1.5 rounded-lg text-xs transition cursor-pointer"
                                title="Edit Line Items or Package Details"
                              >
                                <Edit3 className="w-3.5 h-3.5 text-slate-400" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Table Footer with Summary Count */}
            <div className="bg-slate-950 p-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400 font-mono">
              <div>
                Showing <strong className="text-white">{filteredInvoices.length}</strong> of{' '}
                <strong className="text-white">{invoices.length}</strong> invoices
              </div>
              <div className="flex items-center gap-3">
                <span>
                  Filtered Sum:{' '}
                  <strong className="text-cyan-400">
                    {formatCurrency(filteredInvoices.reduce((sum, i) => sum + i.totalAmount, 0))}
                  </strong>
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: FIELD AGENT RECOVERY & SALARIES */}
      {activeTab === 'agents' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-slate-900 border border-slate-800 p-4 rounded-xl shadow-lg">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span>Field Recovery &amp; Area Support Team</span>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-800 font-mono font-semibold">
                  {agents.length} Enrolled Agents
                </span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Onboard field personnel, monitor physical cash in hand, and disburse salary advances.
              </p>
            </div>
            <button
              onClick={() => {
                setSelectedAgentToManage(null);
                setIsAddOrEditAgentModalOpen(true);
              }}
              className="bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs px-4 py-2 rounded-lg transition flex items-center gap-1.5 shadow-lg shadow-emerald-950/40 shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>+ Add New Agent</span>
            </button>
          </div>

          {/* Agent Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {agents.map((agent) => {
              const outstandingAdvance = Math.max(0, agent.advanceSalaryTaken - agent.advanceSalaryReturned);
              const netSalary = Math.max(0, agent.baseSalary - outstandingAdvance);

              return (
                <div
                  key={agent.id}
                  className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4 hover:border-slate-700 transition"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="font-bold text-white text-base">{agent.name}</h4>
                      <div className="text-xs text-slate-400 font-mono">{agent.phone}</div>
                      <span className="inline-block mt-1 text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded font-mono">
                        {agent.assignedArea}
                      </span>
                    </div>
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded uppercase ${
                        agent.status === 'active'
                          ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                          : 'bg-rose-950 text-rose-300 border border-rose-800'
                      }`}
                    >
                      {agent.status}
                    </span>
                  </div>

                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800/80 space-y-1.5 font-mono text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Cash in Hand:</span>
                      <strong className="text-cyan-400 font-bold">
                        {formatCurrency(agent.cashInHand)}
                      </strong>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Base Salary:</span>
                      <span className="text-white">{formatCurrency(agent.baseSalary)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Advance Taken:</span>
                      <span className="text-amber-400">+{formatCurrency(agent.advanceSalaryTaken)}</span>
                    </div>
                    <div className="flex justify-between pt-1 border-t border-slate-800 font-bold">
                      <span className="text-slate-300">Net Payable:</span>
                      <span className="text-emerald-400">{formatCurrency(netSalary)}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1 font-sans">
                    <button
                      onClick={() => {
                        setReceiveCashDefaultAgentId(agent.id);
                        setIsReceiveCashModalOpen(true);
                      }}
                      className="bg-cyan-950 hover:bg-cyan-900 text-cyan-300 border border-cyan-800 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition"
                    >
                      Receive Cash
                    </button>
                    <button
                      onClick={() => {
                        setSelectedAgentForSalary(agent);
                        setSalaryModalMode('disburse_advance');
                        setIsSalaryModalOpen(true);
                      }}
                      className="bg-amber-950 hover:bg-amber-900 text-amber-300 border border-amber-800 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition"
                    >
                      Disburse Advance
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 3: ISP EXPENSES */}
      {activeTab === 'expenses' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between bg-slate-900 border border-slate-800 p-4 rounded-xl shadow-lg">
            <div>
              <h3 className="text-base font-bold text-white">ISP Operational Expenditures</h3>
              <p className="text-xs text-slate-400">
                Track upstream transit, power generator fuel, fiber splicing tools, and building rent.
              </p>
            </div>
            <button
              onClick={() => setShowAddExpenseModal(true)}
              className="bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs px-3.5 py-2 rounded-lg transition flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>+ Record Expense</span>
            </button>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-slate-950 text-slate-400 uppercase tracking-wider text-[11px] border-b border-slate-800">
                  <tr>
                    <th className="py-3 px-4">Title</th>
                    <th className="py-3 px-4">Category</th>
                    <th className="py-3 px-4">Paid To</th>
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-4 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 text-slate-300">
                  {expenses.map((exp) => (
                    <tr key={exp.id} className="hover:bg-slate-800/50">
                      <td className="py-3 px-4 font-bold text-white">{exp.title}</td>
                      <td className="py-3 px-4 uppercase text-slate-400">{exp.category.replace('_', ' ')}</td>
                      <td className="py-3 px-4">{exp.paidTo}</td>
                      <td className="py-3 px-4 text-slate-400">{exp.date}</td>
                      <td className="py-3 px-4 text-right font-bold text-rose-400">
                        {formatCurrency(exp.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: WHATSAPP DISPATCH LOGS */}
      {activeTab === 'whatsapp' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Smartphone className="w-5 h-5 text-emerald-400" />
                <span>WhatsApp Billing &amp; Payment Receipts Dispatch Log</span>
              </h3>
              <p className="text-xs text-slate-400">
                Audit trail of automated and agent-sent WhatsApp billing notices and PDF receipts.
              </p>
            </div>
          </div>

          <div className="divide-y divide-slate-800 border border-slate-800 rounded-xl overflow-hidden font-mono text-xs">
            {whatsAppLogs.map((log) => (
              <div key={log.id} className="p-3 bg-slate-950/60 flex items-center justify-between hover:bg-slate-800/40 transition">
                <div>
                  <div className="text-white font-bold font-sans">{log.recipientName} ({log.recipientPhone})</div>
                  <div className="text-[11px] text-slate-400 mt-0.5 line-clamp-1">{log.messageBody}</div>
                </div>
                <div className="text-right shrink-0">
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800 uppercase">
                    {log.status}
                  </span>
                  <span className="text-[10px] text-slate-500 block font-sans mt-0.5">
                    {formatDateTimeDisplay(log.timestamp)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MODAL 1: RECORD PAYMENT MODAL */}
      <RecordPaymentModal
        isOpen={isRecordPaymentOpen}
        onClose={() => {
          setIsRecordPaymentOpen(false);
          setRecordModalInvoice(null);
        }}
        invoice={recordModalInvoice}
        onPaymentRecorded={handlePaymentRecorded}
      />

      {/* MODAL 2: REVERT PAYMENT CONFIRMATION (Admin Only) */}
      {isRevertModalOpen && invoiceToRevert && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-rose-800/80 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 text-xs font-sans">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-rose-950 border border-rose-800 rounded-xl text-rose-400">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Revert Invoice to Due?</h3>
                <span className="text-slate-400 text-xs">Admin Ledger Correction Action</span>
              </div>
            </div>

            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-1.5 font-mono text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">Invoice Ref:</span>
                <strong className="text-cyan-400">{invoiceToRevert.invoiceNumber}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Subscriber:</span>
                <span className="text-white font-bold">{invoiceToRevert.customerName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Amount to Reinstate:</span>
                <span className="text-amber-400 font-bold">{formatCurrency(invoiceToRevert.totalAmount)}</span>
              </div>
            </div>

            <p className="text-slate-300 text-xs leading-relaxed">
              This action will mark the invoice status back to{' '}
              <strong className="text-amber-400 font-mono">DUE</strong>, remove the payment arrival
              timestamp, and reinstate the customer's outstanding balance in the ledger.
            </p>

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setIsRevertModalOpen(false);
                  setInvoiceToRevert(null);
                }}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmRevert}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold transition flex items-center gap-1.5 cursor-pointer shadow-lg shadow-rose-950/50"
              >
                <Undo2 className="w-4 h-4" />
                <span>Confirm Revert to Due</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: RECEIPT MODAL */}
      <ReceiptModal
        invoice={receiptModalInvoice}
        onClose={() => {
          setIsReceiptModalOpen(false);
          setReceiptModalInvoice(null);
        }}
      />

      {/* MODAL 4: CREATE INVOICE MODAL */}
      <CreateInvoiceModal
        isOpen={isCreateInvoiceModalOpen}
        onClose={() => setIsCreateInvoiceModalOpen(false)}
      />

      {/* MODAL 5: EDIT INVOICE MODAL */}
      <EditInvoiceModal
        invoice={selectedInvoiceToEdit}
        isOpen={isEditModalOpen}
        onClose={() => {
          setIsEditModalOpen(false);
          setSelectedInvoiceToEdit(null);
        }}
      />

      {/* MODAL 6: AGENT SALARY MODAL */}
      <AgentSalaryModal
        isOpen={isSalaryModalOpen}
        onClose={() => {
          setIsSalaryModalOpen(false);
          setSelectedAgentForSalary(null);
        }}
        agent={selectedAgentForSalary}
        mode={salaryModalMode}
      />

      {/* MODAL 7: RECEIVE CASH MODAL */}
      <ReceiveCashHandoverModal
        isOpen={isReceiveCashModalOpen}
        onClose={() => {
          setIsReceiveCashModalOpen(false);
          setReceiveCashDefaultAgentId(undefined);
        }}
        defaultAgentId={receiveCashDefaultAgentId}
      />

      {/* MODAL 8: ADD/EDIT AGENT MODAL */}
      <AddOrEditAgentModal
        isOpen={isAddOrEditAgentModalOpen}
        onClose={() => {
          setIsAddOrEditAgentModalOpen(false);
          setSelectedAgentToManage(null);
        }}
        agentToEdit={selectedAgentToManage}
      />

      {/* MODAL 9: ADD EXPENSE MODAL */}
      {showAddExpenseModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 text-xs font-sans">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Briefcase className="w-5 h-5 text-indigo-400" />
                <span>Record Operational Expense</span>
              </h3>
              <button
                onClick={() => setShowAddExpenseModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateExpense} className="space-y-3 font-mono">
              <div>
                <label className="block text-slate-400 text-[11px] mb-1">Expense Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 100 Liters Generator Diesel"
                  value={newExpTitle}
                  onChange={(e) => setNewExpTitle(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs font-sans"
                />
              </div>

              <div>
                <label className="block text-slate-400 text-[11px] mb-1">
                  Amount ({currencySymbol}) *
                </label>
                <input
                  type="number"
                  step="any"
                  required
                  placeholder="0.00"
                  value={newExpAmount}
                  onChange={(e) => setNewExpAmount(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs"
                />
              </div>

              <div>
                <label className="block text-slate-400 text-[11px] mb-1">Category</label>
                <select
                  value={newExpCategory}
                  onChange={(e) => setNewExpCategory(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs cursor-pointer"
                >
                  <option value="upstream_transit">Upstream IP Transit</option>
                  <option value="power_fuel">Generator Fuel &amp; Power</option>
                  <option value="fiber_maintenance">Fiber Splicing &amp; Tools</option>
                  <option value="staff_lunch">Staff Catering &amp; Logistics</option>
                  <option value="office_rent">Office / Tower Rent</option>
                  <option value="other">Miscellaneous</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-400 text-[11px] mb-1">Paid To / Vendor</label>
                <input
                  type="text"
                  placeholder="e.g. Shell Petrol Pump G-11"
                  value={newExpPaidTo}
                  onChange={(e) => setNewExpPaidTo(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs font-sans"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddExpenseModal(false)}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold"
                >
                  Save Expense
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default BillingManagement;
