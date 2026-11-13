import React, { useState, useEffect, useMemo } from 'react';
import {
  CreditCard,
  Plus,
  Search,
  Filter,
  CheckCircle2,
  Clock,
  AlertCircle,
  FileText,
  DollarSign,
  Download,
  Printer,
  X,
  User,
  Calendar,
  Layers,
  ChevronDown,
  RefreshCw,
  Users,
  Edit2,
  Trash2,
  Landmark,
  MessageSquare,
  Send,
  Copy,
  Check,
} from 'lucide-react';
import {
  supabase,
  SupabaseInvoice,
  SupabasePortalUser,
  SupabasePaymentTransaction,
  SupabasePaymentAccount,
  SupabaseWhatsappBillingConfig,
} from '../services/supabaseClient';
import { useISP } from '../context/ISPContext';
import { useCurrency } from '../context/CurrencyContext';
import { SystemRole, UserAccount } from '../types/auth';
import { CreateInvoiceModal } from './CreateInvoiceModal';
import { DateFilterToolbar } from './DateFilterToolbar';
import { ReceivingVsDuesChart } from './ReceivingVsDuesChart';
import { WhatsAppBillingCenter } from './WhatsAppBillingCenter';
import {
  DateFilterState,
  createDefaultDateFilter,
  describeDateFilter,
  matchesDateFilter,
} from '../lib/dateFilter';
import {
  restoreSubscriberOnInvoicePaid,
  enforce31DayAutoExpiry,
  add31DaysDateString,
} from '../lib/billingAndNetwork';
import {
  DEFAULT_SUPPORT_WHATSAPP,
  WHATSAPP_CONFIG_UPDATED_EVENT,
  buildInstantPaymentReceiptMessage,
  buildPreExpiryReminderMessage,
  buildPreExpiryReminderQueue,
  computeDaysUntilDate,
  fetchPaymentAccounts,
  fetchWhatsappBillingConfig,
  getDefaultWhatsappConfig,
  openWhatsAppLink,
} from '../lib/whatsappBilling';

export interface BillingViewProps {
  currentRole?: SystemRole;
  currentUser?: UserAccount | null;
  onOpenReceiptModal?: (invoice: any) => void;
}

export const BillingView: React.FC<BillingViewProps> = ({
  currentRole = 'ADMIN',
  currentUser,
  onOpenReceiptModal,
}) => {
  const { formatCurrency, currencySymbol } = useCurrency();
  const { customers, agents } = useISP();

  const [invoices, setInvoices] = useState<SupabaseInvoice[]>([]);
  const [paymentTransactions, setPaymentTransactions] = useState<SupabasePaymentTransaction[]>([]);
  const [portalAgents, setPortalAgents] = useState<SupabasePortalUser[]>([]);
  const [portalClients, setPortalClients] = useState<SupabasePortalUser[]>([]);
  const [paymentAccounts, setPaymentAccounts] = useState<SupabasePaymentAccount[]>([]);
  const [whatsappConfig, setWhatsappConfig] = useState<SupabaseWhatsappBillingConfig>(() =>
    getDefaultWhatsappConfig()
  );
  const [isPaymentAccountsOpen, setIsPaymentAccountsOpen] = useState<boolean>(false);
  const [copiedReminderKey, setCopiedReminderKey] = useState<string | null>(null);
  const [lastPaidReceiptPayload, setLastPaidReceiptPayload] = useState<{
    username: string;
    fullName: string;
    phone: string;
    invoiceNo: string;
    amountPaid: number;
    totalAmount: number;
    remainingBalance: number;
    paymentMethod: string;
    collectorName: string;
    nextExpiryDate: string;
  } | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'DUE' | 'PARTIAL' | 'PAID'>('ALL');
  const [dateFilter, setDateFilter] = useState<DateFilterState>(() => createDefaultDateFilter('month'));
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // Modal States
  const [isGenerateModalOpen, setIsGenerateModalOpen] = useState<boolean>(false);
  const [isMarkPaidModalOpen, setIsMarkPaidModalOpen] = useState<boolean>(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState<boolean>(false);
  const [invoiceToEdit, setInvoiceToEdit] = useState<SupabaseInvoice | null>(null);
  const [invoiceToDelete, setInvoiceToDelete] = useState<SupabaseInvoice | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<SupabaseInvoice | null>(null);
  const [collectingAgentId, setCollectingAgentId] = useState<string>('');
  const [paidPaymentMethod, setPaidPaymentMethod] = useState<string>('Cash Handover');
  const [paymentReceivedInput, setPaymentReceivedInput] = useState<number | string>('');

  // Edit Invoice Form State
  const [editAmount, setEditAmount] = useState<number>(0);
  const [editDueDate, setEditDueDate] = useState<string>('');
  const [editCycleDay, setEditCycleDay] = useState<number>(31);
  const [editStatus, setEditStatus] = useState<'DUE' | 'PARTIAL' | 'PAID' | 'OVERDUE'>('DUE');
  const [editAssignedAgentId, setEditAssignedAgentId] = useState<string>('');

  // New Invoice Form State
  const [newSubUsername, setNewSubUsername] = useState<string>('');
  const [newAmount, setNewAmount] = useState<number>(2500);
  const [newDueDate, setNewDueDate] = useState<string>(() => add31DaysDateString());
  const [newAssignedAgentId, setNewAssignedAgentId] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // 1. Fetch Invoices and Agents from Supabase
  const fetchInvoices = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('invoices')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.warn('Error fetching Supabase invoices:', error);
      } else if (data) {
        setInvoices(data as SupabaseInvoice[]);
        // Enforce 31-day auto-expiry & Walled Garden profile sync asynchronously without dropping active sessions
        enforce31DayAutoExpiry(data as SupabaseInvoice[]).catch(() => {});
      }

      // Also fetch portal_users agents/clients, payment_transactions, payment_accounts & whatsapp config
      const [
        { data: agentUsers },
        { data: clientUsers },
        { data: paymentRows },
        loadedAccounts,
        loadedWaConfig,
      ] = await Promise.all([
        supabase.from('portal_users').select('*').eq('role', 'AGENT'),
        supabase.from('portal_users').select('*').eq('role', 'CLIENT'),
        supabase.from('payment_transactions').select('*').order('created_at', { ascending: false }),
        fetchPaymentAccounts(),
        fetchWhatsappBillingConfig(),
      ]);

      if (agentUsers) {
        setPortalAgents(agentUsers as SupabasePortalUser[]);
      }
      if (clientUsers) {
        setPortalClients(clientUsers as SupabasePortalUser[]);
      }
      if (paymentRows) {
        setPaymentTransactions(paymentRows as SupabasePaymentTransaction[]);
      }
      setPaymentAccounts(loadedAccounts);
      setWhatsappConfig(loadedWaConfig);
    } catch (err) {
      console.warn('Supabase fetch invoices failed:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchInvoices();

    const handleWaConfigUpdated = (e: Event) => {
      const detail = (e as CustomEvent)?.detail;
      if (detail) setWhatsappConfig(detail);
    };
    window.addEventListener(WHATSAPP_CONFIG_UPDATED_EVENT, handleWaConfigUpdated);

    // 2. Enable Supabase Realtime Subscriptions
    const channel = supabase
      .channel('public:billing_view_invoices')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices' }, (payload) => {
        console.log('[Supabase Realtime] Invoices table change detected:', payload);
        fetchInvoices();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_transactions' }, () => {
        fetchInvoices();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_accounts' }, () => {
        fetchPaymentAccounts().then(setPaymentAccounts).catch(() => {});
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'portal_users' }, (payload) => {
        console.log('[Supabase Realtime] Portal users table change detected:', payload);
        fetchInvoices();
      })
      .subscribe();

    return () => {
      window.removeEventListener(WHATSAPP_CONFIG_UPDATED_EVENT, handleWaConfigUpdated);
      supabase.removeChannel(channel);
    };
  }, []);

  // 3. "+ Generate Invoice" Direct Supabase INSERT
  const handleGenerateInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubUsername.trim()) {
      alert('Please specify a subscriber username.');
      return;
    }

    setIsSubmitting(true);
    try {
      const selectedAgent = portalAgents.find((a) => a.id === newAssignedAgentId);
      const generatedInvoiceNo = `INV-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`;

      const newInvoicePayload = {
        invoice_no: generatedInvoiceNo,
        subscriber_username: newSubUsername.trim().toLowerCase(),
        assigned_agent_id: newAssignedAgentId || null,
        assigned_agent_name: selectedAgent ? selectedAgent.full_name : null,
        amount: Number(newAmount) || 0,
        due_date: newDueDate,
        status: 'DUE',
        cycle_day: 31,
        created_at: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from('invoices')
        .insert([newInvoicePayload])
        .select()
        .maybeSingle();

      if (error) {
        throw new Error(error.message);
      }

      setActionNotice(`Invoice ${generatedInvoiceNo} generated successfully for @${newSubUsername}!`);
      setTimeout(() => setActionNotice(null), 5000);
      setIsGenerateModalOpen(false);
      setNewSubUsername('');
      await fetchInvoices();
    } catch (err: any) {
      alert(`Failed to generate invoice: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Helper to open Record Payment modal with accurate remaining balance
  const handleOpenMarkPaid = (inv: SupabaseInvoice) => {
    setSelectedInvoice(inv);
    const alreadyPaid = Number(inv.paid_amount) || 0;
    const remainingDue = Math.max(0, (Number(inv.amount) || 0) - alreadyPaid);
    if (remainingDue <= 0) {
      alert('This invoice has already been settled and marked PAID.');
      return;
    }
    setPaymentReceivedInput(remainingDue);
    setCollectingAgentId(inv.assigned_agent_id || (portalAgents[0]?.id ?? ''));
    setIsMarkPaidModalOpen(true);
  };

  // 4. "Record Payment / Mark Paid" Direct Supabase UPDATE & Agent cash_in_hand Increment
  const handleConfirmMarkPaid = async () => {
    if (!selectedInvoice) return;

    const enteredVal = Number(paymentReceivedInput);
    if (isNaN(enteredVal) || enteredVal <= 0) {
      alert('Please enter a valid payment amount greater than 0.');
      return;
    }

    setIsSubmitting(true);
    try {
      const invoiceId = selectedInvoice.id;
      const totalAmount = Number(selectedInvoice.amount || 0);
      const previousPaid = Number(selectedInvoice.paid_amount || 0);
      const collectedNow = Number(enteredVal || 0);
      const newPaidTotal = previousPaid + collectedNow;
      const remaining = totalAmount - newPaidTotal;

      // Strictly evaluate PAID vs PARTIAL
      const newStatus = remaining <= 0 ? 'PAID' : 'PARTIAL';
      const finalPaidAmount = remaining <= 0 ? totalAmount : newPaidTotal;
      const nowIso = new Date().toISOString();

      // 1. Update invoice in Supabase: status, paid_amount, paid_at, and extend 31-day expiry when PAID
      const invoiceUpdateData: Partial<SupabaseInvoice> = {
        status: newStatus,
        paid_amount: finalPaidAmount,
        paid_at: newStatus === 'PAID' ? nowIso : (selectedInvoice.paid_at || null),
        cycle_day: 31,
      };
      if (newStatus === 'PAID') {
        invoiceUpdateData.due_date = add31DaysDateString(new Date());
      }

      const { error: invError } = await supabase
        .from('invoices')
        .update(invoiceUpdateData)
        .eq('id', invoiceId);

      if (invError) {
        throw new Error(invError.message);
      }

      // Immediately restore subscriber ACTIVE status & MikroTik active PPPoE package profile on PAID
      if (newStatus === 'PAID') {
        await restoreSubscriberOnInvoicePaid(selectedInvoice.subscriber_username);
      }

      // 2. Update collecting agent's cash_in_hand in portal_users by ONLY enteredVal
      const targetAgentId = collectingAgentId || selectedInvoice.assigned_agent_id;
      let targetAgentName = selectedInvoice.assigned_agent_name || 'Field Agent';

      if (targetAgentId) {
        const { data: agentRecord } = await supabase
          .from('portal_users')
          .select('id, cash_in_hand, full_name')
          .eq('id', targetAgentId)
          .maybeSingle();

        if (agentRecord) {
          targetAgentName = agentRecord.full_name;
          const currentCash = Number(agentRecord.cash_in_hand) || 0;
          const updatedCash = currentCash + enteredVal;

          await supabase
            .from('portal_users')
            .update({ cash_in_hand: updatedCash })
            .eq('id', agentRecord.id);
        }
      }

      // 3. Record in payment_transactions table
      const collectorId = currentUser?.id || targetAgentId || null;
      const collectorName = currentUser?.fullName || targetAgentName;

      const { error: txError } = await supabase
        .from('payment_transactions')
        .insert([{
          invoice_id: selectedInvoice.id,
          subscriber_username: selectedInvoice.subscriber_username,
          collected_by_id: collectorId,
          collected_by_name: collectorName,
          amount_paid: enteredVal,
          payment_method: paidPaymentMethod,
          created_at: nowIso,
        }]);

      if (txError) {
        console.warn('payment_transactions insert notice:', txError.message);
      }

      const clientMatch = portalClients.find(
        (c) =>
          (c.username || '').trim().toLowerCase() ===
          (selectedInvoice.subscriber_username || '').trim().toLowerCase()
      );
      const nextExpiryStr =
        invoiceUpdateData.due_date || selectedInvoice.due_date || add31DaysDateString(new Date());

      setLastPaidReceiptPayload({
        username: selectedInvoice.subscriber_username,
        fullName: clientMatch?.full_name || selectedInvoice.subscriber_username,
        phone: clientMatch?.phone || '',
        invoiceNo: selectedInvoice.invoice_no,
        amountPaid: enteredVal,
        totalAmount,
        remainingBalance: Math.max(0, totalAmount - finalPaidAmount),
        paymentMethod: paidPaymentMethod,
        collectorName,
        nextExpiryDate: nextExpiryStr,
      });

      setActionNotice(
        `Recorded ${formatCurrency(enteredVal)} for Invoice #${selectedInvoice.invoice_no}! Status: ${newStatus}.${
          targetAgentId ? ` Credited to ${targetAgentName}'s Cash-in-Hand.` : ''
        }`
      );

      setTimeout(() => setActionNotice(null), 10000);
      setIsMarkPaidModalOpen(false);
      setSelectedInvoice(null);
      await fetchInvoices();
    } catch (err: any) {
      alert(`Failed to record payment: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // 5. Open Edit Invoice Modal
  const handleOpenEditModal = (inv: SupabaseInvoice) => {
    setInvoiceToEdit(inv);
    setEditAmount(Number(inv.amount) || 0);
    setEditDueDate(inv.due_date || '');
    setEditCycleDay(inv.cycle_day || 31);
    setEditStatus((inv.status as any) || 'DUE');
    setEditAssignedAgentId(inv.assigned_agent_id || '');
    setIsEditModalOpen(true);
  };

  // 6. Execute Invoice Update in Supabase
  const handleUpdateInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invoiceToEdit) return;

    setIsSubmitting(true);
    try {
      const selectedAgent = portalAgents.find((a) => a.id === editAssignedAgentId);
      const updatedData: Partial<SupabaseInvoice> = {
        amount: Number(editAmount) || 0,
        due_date: editDueDate,
        cycle_day: Number(editCycleDay) || 31,
        status: editStatus as any,
        assigned_agent_id: editAssignedAgentId || null,
        assigned_agent_name: selectedAgent ? selectedAgent.full_name : null,
      };

      if (editStatus === 'PAID') {
        if (!invoiceToEdit.paid_at) {
          updatedData.paid_at = new Date().toISOString();
        }
        updatedData.paid_amount = Number(editAmount) || Number(invoiceToEdit.amount) || 0;
      }

      const { error } = await supabase
        .from('invoices')
        .update(updatedData)
        .eq('id', invoiceToEdit.id);

      if (error) {
        throw new Error(error.message);
      }

      if (editStatus === 'PAID') {
        await restoreSubscriberOnInvoicePaid(invoiceToEdit.subscriber_username);
      }

      // Update local state immediately
      setInvoices((prev) =>
        prev.map((i) => (i.id === invoiceToEdit.id ? { ...i, ...updatedData } : i))
      );

      setActionNotice(`Invoice ${invoiceToEdit.invoice_no} updated successfully!`);
      setTimeout(() => setActionNotice(null), 5000);
      setIsEditModalOpen(false);
      setInvoiceToEdit(null);
      await fetchInvoices();
    } catch (err: any) {
      alert(`Failed to update invoice: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // 7. Execute Invoice Delete in Supabase
  const handleDeleteInvoice = async () => {
    if (!invoiceToDelete) return;

    setIsSubmitting(true);
    try {
      const invoiceId = invoiceToDelete.id;
      const invoiceNo = invoiceToDelete.invoice_no;

      const { error } = await supabase
        .from('invoices')
        .delete()
        .eq('id', invoiceId);

      if (error) {
        throw new Error(error.message);
      }

      // Remove from local state instantly
      setInvoices((prev) => prev.filter((i) => i.id !== invoiceId));

      setActionNotice(`Invoice ${invoiceNo} deleted successfully.`);
      setTimeout(() => setActionNotice(null), 5000);
      setInvoiceToDelete(null);
    } catch (err: any) {
      alert(`Failed to delete invoice: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Date-filtered Invoices & Payments
  const dateFilteredInvoices = useMemo(() => {
    return (invoices || []).filter((inv) =>
      matchesDateFilter([inv.created_at, inv.due_date, inv.paid_at], dateFilter)
    );
  }, [invoices, dateFilter]);

  const dateFilteredPayments = useMemo(() => {
    return (paymentTransactions || []).filter((tx) =>
      matchesDateFilter(tx.payment_date || tx.created_at, dateFilter)
    );
  }, [paymentTransactions, dateFilter]);

  // Filtered Invoices (Date + Search + Status)
  const filteredInvoices = useMemo(() => {
    const searchClean = (searchTerm || '').trim().toLowerCase();
    return dateFilteredInvoices.filter((inv) => {
      const matchSearch =
        !searchClean ||
        (inv?.invoice_no || '').toLowerCase().includes(searchClean) ||
        (inv?.subscriber_username || '').toLowerCase().includes(searchClean) ||
        Boolean(inv?.assigned_agent_name && (inv.assigned_agent_name || '').toLowerCase().includes(searchClean));

      const balanceDue = Math.max(0, (Number(inv?.amount) || 0) - (Number(inv?.paid_amount) || 0));
      const displayStatus = balanceDue === 0 ? 'PAID' : (inv?.status || 'DUE').toUpperCase();
      const matchStatus =
        statusFilter === 'ALL'
          ? true
          : statusFilter === 'PAID'
          ? displayStatus === 'PAID'
          : statusFilter === 'PARTIAL'
          ? displayStatus === 'PARTIAL'
          : displayStatus === 'DUE';

      return matchSearch && matchStatus;
    });
  }, [dateFilteredInvoices, searchTerm, statusFilter]);

  // Dynamic Period Aggregate Metrics
  const totalBilled = dateFilteredInvoices.reduce((acc, i) => acc + (Number(i.amount) || 0), 0);
  const totalPaid = dateFilteredInvoices.reduce(
    (acc, i) => acc + (Number(i.paid_amount) || ((i.status || '').toUpperCase() === 'PAID' ? Number(i.amount) : 0)),
    0
  );
  const totalDue = dateFilteredInvoices
    .reduce((acc, i) => acc + Math.max(0, (Number(i.amount) || 0) - (Number(i.paid_amount) || 0)), 0);
  const totalAgentCash = (portalAgents || []).reduce((acc, a) => acc + (Number(a.cash_in_hand) || 0), 0);

  const activePaymentAccounts = useMemo(
    () => (paymentAccounts || []).filter((acc) => acc.is_active !== false),
    [paymentAccounts]
  );

  const clientByUsername = useMemo(() => {
    const map: Record<string, SupabasePortalUser> = {};
    for (const c of portalClients) {
      const key = (c.username || '').trim().toLowerCase();
      if (key) map[key] = c;
    }
    return map;
  }, [portalClients]);

  const preExpiryReminderQueue = useMemo(
    () =>
      buildPreExpiryReminderQueue({
        subscribers: portalClients,
        invoices,
        maxDays: whatsappConfig.auto_remind_days_before ?? 3,
      }),
    [portalClients, invoices, whatsappConfig.auto_remind_days_before]
  );

  const supportWhatsapp = whatsappConfig.support_whatsapp || DEFAULT_SUPPORT_WHATSAPP;

  const handleSendPreExpiryReminder = (item: (typeof preExpiryReminderQueue)[number]) => {
    const msg = buildPreExpiryReminderMessage({
      fullName: item.fullName,
      username: item.username,
      packageSpeed: item.packageSpeed,
      daysRemaining: item.daysRemaining,
      expiryDate: item.expiryDate,
      invoiceNo: item.invoiceNo,
      amountDue: item.amountDue,
      activePaymentAccounts,
      supportWhatsapp,
    });
    openWhatsAppLink(item.phone, msg);
  };

  const handleCopyPreExpiryReminder = (item: (typeof preExpiryReminderQueue)[number]) => {
    const msg = buildPreExpiryReminderMessage({
      fullName: item.fullName,
      username: item.username,
      packageSpeed: item.packageSpeed,
      daysRemaining: item.daysRemaining,
      expiryDate: item.expiryDate,
      invoiceNo: item.invoiceNo,
      amountDue: item.amountDue,
      activePaymentAccounts,
      supportWhatsapp,
    });
    navigator.clipboard?.writeText(msg);
    setCopiedReminderKey(item.key);
    setTimeout(() => setCopiedReminderKey((prev) => (prev === item.key ? null : prev)), 2000);
  };

  const handleSendInvoiceWhatsApp = (inv: SupabaseInvoice) => {
    const client = clientByUsername[(inv.subscriber_username || '').trim().toLowerCase()];
    const totalAmount = Number(inv.amount) || 0;
    const paidAmount = Number(inv.paid_amount) || 0;
    const balanceDue = Math.max(0, totalAmount - paidAmount);
    const isPaid = balanceDue <= 0 || (inv.status || '').toUpperCase() === 'PAID';

    if (isPaid) {
      const receiptMsg = buildInstantPaymentReceiptMessage({
        fullName: client?.full_name || inv.subscriber_username,
        username: inv.subscriber_username,
        invoiceNo: inv.invoice_no,
        amountPaid: paidAmount > 0 ? paidAmount : totalAmount,
        totalAmount,
        remainingBalance: 0,
        paymentMethod: 'Verified Payment',
        collectorName: inv.assigned_agent_name || 'Youth Net NOC',
        nextExpiryDate: inv.due_date,
        activePaymentAccounts,
        supportWhatsapp,
      });
      openWhatsAppLink(client?.phone, receiptMsg);
    } else {
      const daysLeft = computeDaysUntilDate(inv.due_date);
      const reminderMsg = buildPreExpiryReminderMessage({
        fullName: client?.full_name || inv.subscriber_username,
        username: inv.subscriber_username,
        packageSpeed: client?.package_speed || 'Fiber Broadband',
        daysRemaining: daysLeft !== null ? Math.max(0, daysLeft) : 0,
        expiryDate: inv.due_date,
        invoiceNo: inv.invoice_no,
        amountDue: balanceDue,
        activePaymentAccounts,
        supportWhatsapp,
      });
      openWhatsAppLink(client?.phone, reminderMsg);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              <CreditCard className="w-6 h-6 text-cyan-400" />
              <span>Billing & Invoices (Supabase PostgreSQL)</span>
            </h1>
            <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-950 text-emerald-400 border border-emerald-800 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              Live PostgreSQL
            </span>
          </div>
          <p className="text-slate-400 text-sm mt-1">
            Realtime invoice lifecycle, automated collections reconciliation, and field agent cash settlement.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => setIsPaymentAccountsOpen(true)}
            className="px-3.5 py-2.5 rounded-xl border border-emerald-700/60 bg-emerald-950/50 hover:bg-emerald-900/60 text-emerald-300 font-semibold text-xs flex items-center gap-2 transition cursor-pointer whitespace-nowrap shrink-0"
            title="Manage Bank/Wallet Accounts & Support WhatsApp Config"
          >
            <Landmark className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>Payment Accounts &amp; WhatsApp</span>
          </button>

          <button
            type="button"
            onClick={fetchInvoices}
            disabled={isLoading}
            className="p-2.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white transition cursor-pointer shrink-0"
            title="Refresh Invoices from Supabase"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-cyan-400' : ''}`} />
          </button>

          <button
            type="button"
            onClick={() => setIsGenerateModalOpen(true)}
            className="px-4 py-2.5 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold rounded-xl transition flex items-center gap-2 shadow-lg shadow-cyan-950/50 cursor-pointer active:scale-95 whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4 stroke-[3]" />
            <span>+ Generate Invoice</span>
          </button>
        </div>
      </div>

      {/* Action Notification Banner with 1-Click Instant WhatsApp Receipt */}
      {actionNotice && (
        <div className="p-3.5 bg-emerald-950/80 border border-emerald-800 rounded-xl text-emerald-300 text-sm flex flex-wrap items-center justify-between gap-3 shadow-lg">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            <span>{actionNotice}</span>
          </div>
          <div className="flex items-center gap-2">
            {lastPaidReceiptPayload && (
              <button
                type="button"
                onClick={() =>
                  openWhatsAppLink(
                    lastPaidReceiptPayload.phone,
                    buildInstantPaymentReceiptMessage({
                      ...lastPaidReceiptPayload,
                      activePaymentAccounts,
                      supportWhatsapp,
                    })
                  )
                }
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Send Instant WhatsApp Receipt</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setActionNotice(null);
                setLastPaidReceiptPayload(null);
              }}
              className="text-emerald-400 hover:text-white transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Date Filter Toolbar */}
      <DateFilterToolbar
        value={dateFilter}
        onChange={setDateFilter}
        totalCount={invoices.length}
        filteredCount={dateFilteredInvoices.length}
        recordLabel="invoices"
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-[#111A2E] border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>TOTAL BILLED ({describeDateFilter(dateFilter).toUpperCase()})</span>
            <FileText className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="text-2xl font-bold text-white mt-2 font-mono tabular-nums">{formatCurrency(totalBilled)}</div>
          <div className="text-slate-500 text-xs mt-1 font-mono tabular-nums">{dateFilteredInvoices.length} invoices in period</div>
        </div>

        <div className="p-4 rounded-xl bg-[#111A2E] border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>TOTAL RECEIVED</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-emerald-400 mt-2 font-mono tabular-nums">{formatCurrency(totalPaid)}</div>
          <div className="text-slate-500 text-xs mt-1 font-mono tabular-nums">
            {dateFilteredInvoices.filter((i) => (i.status || '').toUpperCase() === 'PAID').length} settled
            {dateFilteredInvoices.filter((i) => (i.status || '').toUpperCase() === 'PARTIAL').length > 0 &&
              ` · ${dateFilteredInvoices.filter((i) => (i.status || '').toUpperCase() === 'PARTIAL').length} partial`}
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#111A2E] border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>PENDING DUES</span>
            <Clock className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-bold text-amber-400 mt-2 font-mono tabular-nums">{formatCurrency(totalDue)}</div>
          <div className="text-slate-500 text-xs mt-1 font-mono tabular-nums">
            {dateFilteredInvoices.filter((i) => (i.status || '').toUpperCase() !== 'PAID').length} pending collection / arrears
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#111A2E] border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>FIELD AGENT CASH-IN-HAND</span>
            <Users className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-2xl font-bold text-purple-400 mt-2 font-mono tabular-nums">{formatCurrency(totalAgentCash)}</div>
          <div className="text-slate-500 text-xs mt-1 font-mono tabular-nums">{portalAgents.length} active field collection agents</div>
        </div>
      </div>

      {/* Receiving vs. Pending Dues Analytics Graph */}
      <ReceivingVsDuesChart
        invoices={dateFilteredInvoices}
        paymentTransactions={dateFilteredPayments}
        filter={dateFilter}
      />

      {/* 3-Day Pre-Expiry WhatsApp Reminder Queue */}
      <div className="p-4 rounded-xl border border-slate-800 bg-[#111A2E] space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-slate-800">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>3-Day Pre-Expiry WhatsApp Reminder Queue ({preExpiryReminderQueue.length})</span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5 font-mono tabular-nums">
              Expiring within 0&ndash;{whatsappConfig.auto_remind_days_before ?? 3} days &middot; {activePaymentAccounts.length} active payment account{activePaymentAccounts.length === 1 ? '' : 's'} &middot; Support: {supportWhatsapp}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsPaymentAccountsOpen(true)}
            className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0 self-start sm:self-auto"
          >
            <Landmark className="w-3.5 h-3.5 text-emerald-400" />
            <span>Edit Accounts ({activePaymentAccounts.length} Active)</span>
          </button>
        </div>

        {preExpiryReminderQueue.length === 0 ? (
          <div className="py-5 px-4 rounded-lg bg-slate-950/70 border border-slate-800/80 text-xs text-slate-400 flex items-center justify-between gap-3">
            <span>
              No active subscribers are expiring within the next {whatsappConfig.auto_remind_days_before ?? 3} days.
            </span>
            <span className="font-mono text-emerald-400 shrink-0">Queue Clear</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {preExpiryReminderQueue.map((item) => (
              <div
                key={item.key}
                className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex flex-col justify-between gap-2.5 text-xs"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-bold text-white truncate">
                      {item.fullName}{' '}
                      <span className="font-mono text-cyan-400 font-normal">@{item.username}</span>
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                      {item.packageSpeed} &middot; {item.invoiceNo} &middot; {item.phone || 'No phone'}
                    </div>
                  </div>
                  <div className="text-right font-mono tabular-nums shrink-0">
                    <div className="font-bold text-amber-400">
                      {formatCurrency(item.amountDue, 0)}
                    </div>
                    <div
                      className={`text-[11px] font-semibold ${
                        item.daysRemaining === 0 ? 'text-rose-400' : 'text-amber-300'
                      }`}
                    >
                      {item.daysRemaining === 0
                        ? 'Expires Today'
                        : `${item.daysRemaining} day(s) left · ${item.expiryDate}`}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800/80">
                  <button
                    type="button"
                    onClick={() => handleCopyPreExpiryReminder(item)}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1 transition cursor-pointer whitespace-nowrap"
                  >
                    {copiedReminderKey === item.key ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-emerald-400">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy Message</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSendPreExpiryReminder(item)}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Send WhatsApp Reminder</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Search and Filters Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3 bg-[#111A2E] rounded-xl border border-slate-800">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by Invoice #, subscriber username, or agent..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
          />
        </div>

        <div className="flex items-center gap-2 overflow-x-auto">
          <button
            type="button"
            onClick={() => setStatusFilter('ALL')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer whitespace-nowrap ${
              statusFilter === 'ALL'
                ? 'bg-cyan-600 text-slate-950 font-bold'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            All ({dateFilteredInvoices.length})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('DUE')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer whitespace-nowrap ${
              statusFilter === 'DUE'
                ? 'bg-rose-600 text-white font-bold'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            Due ({dateFilteredInvoices.filter((i) => (i.status || '').toUpperCase() === 'DUE').length})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('PARTIAL')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer whitespace-nowrap ${
              statusFilter === 'PARTIAL'
                ? 'bg-amber-600 text-slate-950 font-bold'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            Partial ({dateFilteredInvoices.filter((i) => (i.status || '').toUpperCase() === 'PARTIAL').length})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('PAID')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer whitespace-nowrap ${
              statusFilter === 'PAID'
                ? 'bg-emerald-600 text-slate-950 font-bold'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            Paid ({dateFilteredInvoices.filter((i) => (i.status || '').toUpperCase() === 'PAID').length})
          </button>
        </div>
      </div>

      {/* Invoices Table */}
      <div className="rounded-xl border border-slate-800 bg-[#111A2E] overflow-hidden shadow-lg">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-900/80 text-xs uppercase tracking-wider text-slate-400 border-b border-slate-800">
              <tr>
                <th className="py-3 px-4">Invoice #</th>
                <th className="py-3 px-4">Subscriber</th>
                <th className="py-3 px-4">Assigned Agent</th>
                <th className="py-3 px-4">Due Date</th>
                <th className="py-3 px-4 text-right">Amount</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-sans">
              {filteredInvoices.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-500">
                    <FileText className="w-10 h-10 text-slate-600 mx-auto mb-2 opacity-50" />
                    <p className="text-base font-semibold text-slate-400">No invoices found</p>
                    <p className="text-xs text-slate-500 mt-1">
                      Click "+ Generate Invoice" to create an invoice in Supabase PostgreSQL.
                    </p>
                  </td>
                </tr>
              ) : (
                filteredInvoices.map((inv) => {
                  const totalAmount = Number(inv.amount || 0);
                  const alreadyPaid = Number(inv.paid_amount || 0);
                  const balanceDue = Math.max(0, totalAmount - alreadyPaid);
                  const displayStatus = balanceDue === 0 ? 'PAID' : (inv.status || 'DUE').toUpperCase();
                  const isPaid = displayStatus === 'PAID';
                  const isPartial = displayStatus === 'PARTIAL';

                  return (
                    <tr key={inv.id} className="hover:bg-slate-800/30 transition">
                      <td className="py-3 px-4 font-mono font-semibold text-cyan-400">{inv.invoice_no}</td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-white">@{inv.subscriber_username}</div>
                        <div className="text-xs text-slate-500">Cycle: {inv.cycle_day || 31} Days</div>
                      </td>
                      <td className="py-3 px-4">
                        {inv.assigned_agent_name ? (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs bg-purple-950 text-purple-300 border border-purple-800">
                            <User className="w-3 h-3" />
                            <span>{inv.assigned_agent_name}</span>
                          </span>
                        ) : (
                          <span className="text-slate-500 text-xs italic">Unassigned</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-300 font-mono text-xs">{inv.due_date}</td>
                      <td className="py-3 px-4 text-right">
                        <div className="font-mono font-bold text-white text-base">
                          {formatCurrency(totalAmount)}
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono mt-0.5 whitespace-nowrap">
                          (Paid: {formatCurrency(alreadyPaid)} | Balance: {formatCurrency(balanceDue)})
                        </div>
                      </td>
                      <td className="py-3 px-4 text-center">
                        {displayStatus === 'PAID' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                            <span>PAID</span>
                          </span>
                        ) : displayStatus === 'PARTIAL' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">
                            <Clock className="w-3.5 h-3.5 text-amber-400" />
                            <span>PARTIAL</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30">
                            <Clock className="w-3.5 h-3.5 text-rose-400" />
                            <span>DUE</span>
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          {balanceDue > 0 && displayStatus !== 'PAID' ? (
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleOpenMarkPaid(inv)}
                                className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold rounded-lg text-xs flex items-center gap-1 transition active:scale-95 shadow cursor-pointer"
                                title="Record Payment & Credit Field Agent"
                              >
                                <DollarSign className="w-3.5 h-3.5" />
                                <span>{isPartial ? 'Add Payment' : 'Mark Paid'}</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSendInvoiceWhatsApp(inv)}
                                className="px-2 py-1.5 bg-emerald-950/60 hover:bg-emerald-900/70 text-emerald-300 border border-emerald-700/60 rounded-lg text-xs flex items-center gap-1 transition cursor-pointer"
                                title="Send WhatsApp Payment Reminder with Active Bank/Wallet Accounts"
                              >
                                <Send className="w-3 h-3" />
                                <span>Remind</span>
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <span className="text-emerald-400 font-mono text-[11px] font-semibold flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-950/40 border border-emerald-800/60">
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                                <span>✓ Settled / Paid in Full</span>
                              </span>
                              <button
                                type="button"
                                onClick={() => handleSendInvoiceWhatsApp(inv)}
                                className="px-2.5 py-1.5 bg-emerald-950/60 hover:bg-emerald-900/70 text-emerald-300 border border-emerald-700/60 rounded-lg text-xs flex items-center gap-1 transition cursor-pointer"
                                title="Send Instant WhatsApp Payment Receipt"
                              >
                                <Send className="w-3.5 h-3.5" />
                                <span>WA Receipt</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => onOpenReceiptModal?.(inv)}
                                className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-400 hover:text-white border border-slate-700 rounded-lg text-xs flex items-center gap-1 transition cursor-pointer"
                                title="View & Print Official Receipt"
                              >
                                <Printer className="w-3.5 h-3.5" />
                                <span>Receipt</span>
                              </button>
                            </div>
                          )}

                          {/* Edit Invoice Button (Admin/Manager) */}
                          {(currentRole === 'ADMIN' || currentRole === 'MANAGER') && (
                            <button
                              type="button"
                              onClick={() => handleOpenEditModal(inv)}
                              className="p-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-400 hover:text-white border border-slate-700 rounded-lg text-xs transition cursor-pointer"
                              title="Edit Invoice Details"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                              <span className="sr-only">Edit Invoice</span>
                            </button>
                          )}

                          {/* Delete Invoice Button (Admin/Manager) */}
                          {(currentRole === 'ADMIN' || currentRole === 'MANAGER') && (
                            <button
                              type="button"
                              onClick={() => setInvoiceToDelete(inv)}
                              className="p-1.5 bg-rose-950/80 hover:bg-rose-900 text-rose-300 hover:text-rose-100 border border-rose-800 rounded-lg text-xs transition cursor-pointer"
                              title="Delete Invoice"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span className="sr-only">Delete Invoice</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Field Agents Cash Overview */}
      <div className="p-4 rounded-xl border border-slate-800 bg-[#111A2E]">
        <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
          <Users className="w-4 h-4 text-purple-400" />
          <span>Field Agent Cash Recovery Status (portal_users)</span>
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          {portalAgents.map((ag) => (
            <div key={ag.id} className="p-3 bg-slate-900/80 rounded-lg border border-slate-800">
              <div className="font-semibold text-white text-sm">{ag.full_name}</div>
              <div className="text-xs text-slate-500">@{ag.username} • {ag.area}</div>
              <div className="mt-2 text-lg font-mono font-bold text-emerald-400">
                {formatCurrency(Number(ag.cash_in_hand) || 0)}
              </div>
              <div className="text-[10px] text-slate-500">Cash-in-Hand Balance</div>
            </div>
          ))}
        </div>
      </div>

      {/* Modal: + Generate Invoice */}
      <CreateInvoiceModal
        isOpen={isGenerateModalOpen}
        onClose={() => setIsGenerateModalOpen(false)}
        onSuccess={() => {
          setActionNotice('Invoice created successfully');
          fetchInvoices();
        }}
      />

      {/* Modal: Record Payment / Mark Paid */}
      {isMarkPaidModalOpen && selectedInvoice && (() => {
        const alreadyPaid = Number(selectedInvoice.paid_amount) || 0;
        const totalAmount = Number(selectedInvoice.amount) || 0;
        const remainingDue = Math.max(0, totalAmount - alreadyPaid);
        const enteredVal = Number(paymentReceivedInput) || 0;
        const projectedTotalPaid = alreadyPaid + enteredVal;
        const willBeFullyPaid = projectedTotalPaid >= totalAmount;

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in font-sans">
            <div className="bg-[#111A2E] border border-slate-700 rounded-2xl w-full max-w-md p-6 shadow-2xl relative">
              <div className="flex items-center justify-between pb-4 border-b border-slate-800">
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <DollarSign className="w-5 h-5 text-emerald-400" />
                  <span>Record Payment &amp; Arrears</span>
                </h2>
                <button
                  type="button"
                  onClick={() => setIsMarkPaidModalOpen(false)}
                  className="text-slate-400 hover:text-white transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4 mt-4">
                {/* Financial Summary */}
                <div className="p-3.5 bg-slate-900 rounded-xl border border-slate-800 space-y-2">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-400">Invoice No:</span>
                    <span className="text-cyan-400 font-mono font-bold">#{selectedInvoice.invoice_no}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-400">Subscriber:</span>
                    <span className="text-white font-semibold">@{selectedInvoice.subscriber_username}</span>
                  </div>
                  <div className="pt-2 border-t border-slate-800/80 flex justify-between items-center text-xs">
                    <span className="text-slate-400">Total Amount:</span>
                    <span className="text-white font-mono font-bold">{formatCurrency(totalAmount)}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-400">Already Paid:</span>
                    <span className="text-emerald-400 font-mono font-semibold">{formatCurrency(alreadyPaid)}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm font-semibold">
                    <span className="text-amber-300">Remaining Due:</span>
                    <span className="text-amber-400 font-mono font-bold text-base">{formatCurrency(remainingDue)}</span>
                  </div>
                </div>

                {/* Payment Input Field */}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs font-medium text-slate-300">
                      Payment Received (Rs.)
                    </label>
                    <button
                      type="button"
                      onClick={() => setPaymentReceivedInput(remainingDue)}
                      className="text-cyan-400 hover:text-cyan-300 text-[11px] underline cursor-pointer"
                    >
                      Fill Full Remaining ({formatCurrency(remainingDue)})
                    </button>
                  </div>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-slate-500 font-mono text-sm">Rs.</span>
                    <input
                      type="number"
                      min="1"
                      step="any"
                      value={paymentReceivedInput}
                      onChange={(e) => setPaymentReceivedInput(e.target.value)}
                      placeholder={`Default: ${remainingDue}`}
                      className="w-full pl-10 pr-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono text-base focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] mt-1.5 px-0.5">
                    <span className="text-slate-400">
                      Resulting Status:{' '}
                      <span className={`font-bold ${willBeFullyPaid ? 'text-emerald-400' : 'text-amber-400'}`}>
                        {willBeFullyPaid ? 'PAID (Settled)' : 'PARTIAL (Arrears Remaining)'}
                      </span>
                    </span>
                    {!willBeFullyPaid && (
                      <span className="text-amber-400 font-mono">
                        Arrears: {formatCurrency(Math.max(0, totalAmount - projectedTotalPaid))}
                      </span>
                    )}
                  </div>
                </div>

                {/* Collecting Agent Selection */}
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Collecting Field Recovery Agent (Credits Cash-in-Hand)
                  </label>
                  <select
                    value={collectingAgentId}
                    onChange={(e) => setCollectingAgentId(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-cyan-500"
                  >
                    <option value="">-- No Agent Credit (Direct NOC Collection) --</option>
                    {portalAgents.map((ag) => (
                      <option key={ag.id} value={ag.id}>
                        {ag.full_name} ({ag.area})
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Selected agent's `cash_in_hand` in Supabase `portal_users` will be credited by{' '}
                    <span className="text-emerald-400 font-mono font-bold">
                      {formatCurrency(Number(paymentReceivedInput) || 0)}
                    </span>.
                  </p>
                </div>

                {/* Payment Method */}
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Payment Method</label>
                  <select
                    value={paidPaymentMethod}
                    onChange={(e) => setPaidPaymentMethod(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-cyan-500"
                  >
                    <option value="Cash Handover">Cash Handover</option>
                    <option value="JazzCash">JazzCash</option>
                    <option value="EasyPaisa">EasyPaisa</option>
                    <option value="Bank Transfer">Bank Transfer</option>
                  </select>
                </div>

                <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => setIsMarkPaidModalOpen(false)}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm transition cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmMarkPaid}
                    disabled={isSubmitting || Number(paymentReceivedInput) <= 0}
                    className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-bold rounded-lg text-sm transition shadow-lg shadow-emerald-950/50 flex items-center gap-1.5 cursor-pointer"
                  >
                    {isSubmitting ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Recording...</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4" />
                        <span>Confirm &amp; Record Payment</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Modal: Edit Invoice */}
      {isEditModalOpen && invoiceToEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in font-sans">
          <div className="bg-[#111A2E] border border-slate-700 rounded-2xl w-full max-w-md p-6 shadow-2xl relative">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-indigo-950 border border-indigo-700/60 text-indigo-400 rounded-xl">
                  <Edit2 className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">Edit Invoice Details</h2>
                  <p className="text-xs text-slate-400 font-mono">Invoice #{invoiceToEdit.invoice_no}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsEditModalOpen(false);
                  setInvoiceToEdit(null);
                }}
                className="text-slate-400 hover:text-white transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleUpdateInvoice} className="space-y-4 mt-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Subscriber Username
                </label>
                <input
                  type="text"
                  disabled
                  value={`@${invoiceToEdit.subscriber_username}`}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-400 font-mono cursor-not-allowed"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Amount (PKR)</label>
                  <input
                    type="number"
                    required
                    min="0"
                    step="50"
                    value={editAmount}
                    onChange={(e) => setEditAmount(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white font-mono focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Billing Cycle Day</label>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    value={editCycleDay}
                    onChange={(e) => setEditCycleDay(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white font-mono focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Due Date</label>
                  <input
                    type="date"
                    required
                    value={editDueDate}
                    onChange={(e) => setEditDueDate(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Payment Status</label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as any)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-cyan-500"
                  >
                    <option value="DUE">DUE</option>
                    <option value="PARTIAL">PARTIAL</option>
                    <option value="PAID">PAID</option>
                    <option value="OVERDUE">OVERDUE</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Assigned Field Recovery Agent</label>
                <select
                  value={editAssignedAgentId}
                  onChange={(e) => setEditAssignedAgentId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-cyan-500"
                >
                  <option value="">-- Unassigned --</option>
                  {portalAgents.map((ag) => (
                    <option key={ag.id} value={ag.id}>
                      {ag.full_name} ({ag.area})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setIsEditModalOpen(false);
                    setInvoiceToEdit(null);
                  }}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg text-sm transition shadow-lg shadow-indigo-950/50 flex items-center gap-1.5"
                >
                  {isSubmitting ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <span>Save Changes</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Delete Invoice Confirmation */}
      {invoiceToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in font-sans">
          <div className="bg-[#111A2E] border border-rose-800/80 rounded-2xl w-full max-w-sm p-6 shadow-2xl relative space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-rose-950/90 border border-rose-700 text-rose-400 rounded-xl">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Delete Invoice?</h3>
                <p className="text-xs text-rose-300 font-mono">Invoice #{invoiceToDelete.invoice_no}</p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Are you sure you want to permanently delete Invoice <strong className="text-white font-mono">#{invoiceToDelete.invoice_no}</strong> for <strong className="text-cyan-300">@{invoiceToDelete.subscriber_username}</strong> ({formatCurrency(Number(invoiceToDelete.amount) || 0)})?
            </p>

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setInvoiceToDelete(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteInvoice}
                disabled={isSubmitting}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-lg text-xs transition shadow-lg shadow-rose-950/50 flex items-center gap-1.5 cursor-pointer"
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <span>Delete Permanently</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Payment Accounts & WhatsApp Billing Center Drawer */}
      <WhatsAppBillingCenter
        isOpen={isPaymentAccountsOpen}
        onClose={() => setIsPaymentAccountsOpen(false)}
        onAccountsOrConfigChanged={(updatedAccounts, updatedConfig) => {
          setPaymentAccounts(updatedAccounts);
          setWhatsappConfig(updatedConfig);
        }}
      />
    </div>
  );
};

export default BillingView;
