import React, { useState, useEffect, useMemo, useRef } from 'react';
import ReactDOM from 'react-dom';
import {
  CreditCard,
  Plus,
  Search,
  Filter,
  CheckCircle2,
  Clock,
  AlertCircle,
  AlertTriangle,
  FileText,
  DollarSign,
  Download,
  FastForward,
  Printer,
  X,
  User,
  Calendar,
  Layers,
  ChevronDown,
  RefreshCw,
  Timer,
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
  triggerAutoExpirySweep,
  addCalendarMonthDateString,
  bulkReceivePayments,
  fetchLiveMikrotikProfilesAndSecrets,
  safeInsertInvoiceInSupabase,
  safeUpdateInvoiceInSupabase,
  syncSubscriberPackageAndRestoreIfPaid,
  shiftBillToNextMonth,
} from '../lib/billingAndNetwork';
import {
  buildLiveMikrotikPlanOptions,
  resolvePreselectedInvoiceProfile,
} from '../lib/mikrotikProfileSync';
import { BulkReceiveAmountModal } from './BulkReceiveAmountModal';
import {
  DEFAULT_SUPPORT_WHATSAPP,
  WHATSAPP_CONFIG_UPDATED_EVENT,
  buildPreExpiryReminderMessage,
  buildPreExpiryReminderQueue,
  computeDaysUntilDate,
  fetchPaymentAccounts,
  fetchWhatsappBillingConfig,
  getDefaultWhatsappConfig,
} from '../lib/whatsappBilling';
import { triggerAutoWhatsAppNotification } from '../lib/whatsappRouting';
import { deleteInvoiceApi, updateInvoiceApi } from '../lib/inventoryInvoiceSync';
import {
  FIELD_STAFF_ROLES,
  LiveFieldAgentLedger,
  computeBillingAnchorDay,
  fetchLiveFieldStaffWithBalances,
  formatShortGraceDate,
  getSubscriberGraceUntilIso,
  hasSubscriberActiveGrace,
  isInvoiceOverdueOrGraceExpired,
  isSubscriberShiftedNextMonth,
  runAnniversaryInvoicingCron,
} from '../lib/anniversaryBilling';

import {
  StaffPermissions,
  hasExplicitAdminGracePermission,
  resolveStaffPermissions,
} from '../lib/staffPermissions';
import {
  buildOwnershipStamp,
  doesInvoiceMatchScope,
  doesRecordMatchAdminOwnerFilter,
  filterFieldAgentsForUser,
  getResellerTier,
  isResellerUser,
  isVisibleToCurrentUser,
  resolveAdminDealerFilterIds,
  resolveResellerScope,
  WalletGatePreviewResult,
} from '../lib/resellerEngine';
import { AddScopedFieldAgentModal } from './AddScopedFieldAgentModal';
import { ResellerWalletGatePreview } from './ResellerWalletGatePreview';

export interface BillingViewProps {
  currentRole?: SystemRole;
  currentUser?: UserAccount | null;
  staffPermissions?: StaffPermissions;
  onOpenReceiptModal?: (invoice: any) => void;
}

export const BillingView: React.FC<BillingViewProps> = ({
  currentRole = 'ADMIN',
  currentUser,
  staffPermissions,
  onOpenReceiptModal,
}) => {
  const perms = useMemo(
    () => staffPermissions || resolveStaffPermissions(currentUser, currentRole),
    [staffPermissions, currentUser, currentRole]
  );
  const canBulkReceive = perms.bulk_billing && perms.collect_fee;
  const canUseGraceAndShift = useMemo(
    () => hasExplicitAdminGracePermission(currentUser as any, perms),
    [currentUser, perms]
  );
  const { formatCurrency, currencySymbol } = useCurrency();
  const { customers, agents, routers, selectedRouterId, packages, profilePriceMap } = useISP();
  const activeRouter = routers.find((r) => r.id === selectedRouterId) || routers[0];
  const activeRouterRef = useRef(activeRouter);
  activeRouterRef.current = activeRouter;

  const [invoices, setInvoices] = useState<SupabaseInvoice[]>([]);
  const [paymentTransactions, setPaymentTransactions] = useState<SupabasePaymentTransaction[]>([]);
  const [portalAgents, setPortalAgents] = useState<SupabasePortalUser[]>([]);
  const [liveFieldStaff, setLiveFieldStaff] = useState<LiveFieldAgentLedger[]>([]);
  const [portalClients, setPortalClients] = useState<SupabasePortalUser[]>([]);
  const [allResellers, setAllResellers] = useState<SupabasePortalUser[]>([]);
  const [dealerFilter, setDealerFilter] = useState<string>('ALL');
  const [staffOwnerFilter, setStaffOwnerFilter] = useState<string>('DIRECT_ISP');
  const [isAddFieldAgentModalOpen, setIsAddFieldAgentModalOpen] = useState<boolean>(false);
  const [isRunningCron, setIsRunningCron] = useState<boolean>(false);
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
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'DUE' | 'PARTIAL' | 'PAID' | 'OVERDUE' | 'GRACE'>('ALL');
  const [shiftingInvoiceId, setShiftingInvoiceId] = useState<string | null>(null);
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
  const [markPaidError, setMarkPaidError] = useState<string | null>(null);
  const [markPaidWalletStatus, setMarkPaidWalletStatus] = useState<WalletGatePreviewResult | null>(null);
  const [editInvoiceError, setEditInvoiceError] = useState<string | null>(null);
  const [editInvoiceWalletStatus, setEditInvoiceWalletStatus] = useState<WalletGatePreviewResult | null>(null);

  // Live MikroTik RouterOS Profiles & Secrets (Single Source of Truth)
  const [liveMikrotikProfiles, setLiveMikrotikProfiles] = useState<
    Array<{ name: string; rateLimit?: string }>
  >([]);
  const [liveMikrotikSecrets, setLiveMikrotikSecrets] = useState<Array<Record<string, any>>>([]);
  const [isLoadingMkProfiles, setIsLoadingMkProfiles] = useState<boolean>(false);

  // Edit Invoice Form State
  const [editAmount, setEditAmount] = useState<number>(0);
  const [editDueDate, setEditDueDate] = useState<string>('');
  const [editCycleDay, setEditCycleDay] = useState<number>(() => new Date().getDate());
  const [editStatus, setEditStatus] = useState<'DUE' | 'PARTIAL' | 'PAID' | 'OVERDUE'>('DUE');
  const [editAssignedAgentId, setEditAssignedAgentId] = useState<string>('');
  const [editNotes, setEditNotes] = useState<string>('');
  const [editPackageProfile, setEditPackageProfile] = useState<string>('');
  const [editDetectedMkProfile, setEditDetectedMkProfile] = useState<string | null>(null);
  const [deleteLinkedPayments, setDeleteLinkedPayments] = useState<boolean>(true);
  const [deleteInvoiceError, setDeleteInvoiceError] = useState<string | null>(null);

  // New Invoice Form State
  const [newSubUsername, setNewSubUsername] = useState<string>('');
  const [newAmount, setNewAmount] = useState<number>(2500);
  const [newDueDate, setNewDueDate] = useState<string>(() => addCalendarMonthDateString());
  const [newAssignedAgentId, setNewAssignedAgentId] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Bulk Receive Amount States
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<Record<string, boolean>>({});
  const [isBulkReceiveModalOpen, setIsBulkReceiveModalOpen] = useState<boolean>(false);
  const [isBulkReceiving, setIsBulkReceiving] = useState<boolean>(false);
  const [bulkReceiveProgress, setBulkReceiveProgress] = useState<string | null>(null);

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
        // Run unified Grace + MikroTik EXPIRED-16-POOL auto-expiry sweep asynchronously on load
        enforce31DayAutoExpiry(data as SupabaseInvoice[], activeRouterRef.current)
          .then((suspendedCount) => {
            if (suspendedCount > 0) {
              setActionNotice(
                `Auto-Expiry Engine: Suspended ${suspendedCount} past-grace unpaid account${
                  suspendedCount === 1 ? '' : 's'
                } to EXPIRED-16-POOL.`
              );
            }
          })
          .catch(() => {});
      }

      // Also fetch portal_users (all staff/clients/resellers), live agent balances, payment_transactions, payment_accounts & whatsapp config
      const [
        { data: allPortalUsersData },
        { data: paymentRows },
        loadedAccounts,
        loadedWaConfig,
        computedStaff,
      ] = await Promise.all([
        supabase.from('portal_users').select('*').order('full_name', { ascending: true }),
        supabase.from('payment_transactions').select('*').order('payment_date', { ascending: false }),
        fetchPaymentAccounts(),
        fetchWhatsappBillingConfig(),
        fetchLiveFieldStaffWithBalances(supabase),
      ]);

      const allPortalList = (allPortalUsersData || []) as SupabasePortalUser[];
      const fieldRoleSet = new Set(FIELD_STAFF_ROLES.map((r) => r.toUpperCase()));
      setPortalAgents(
        allPortalList.filter((u) => fieldRoleSet.has(String(u.role || '').toUpperCase()))
      );
      setPortalClients(
        allPortalList.filter((u) => String(u.role || '').toUpperCase() === 'CLIENT')
      );
      setAllResellers(allPortalList.filter((u) => getResellerTier(u) !== null));
      if (Array.isArray(computedStaff)) {
        setLiveFieldStaff(computedStaff);
      }
      if (paymentRows) {
        setPaymentTransactions(paymentRows as SupabasePaymentTransaction[]);
      }
      setPaymentAccounts(loadedAccounts);
      setWhatsappConfig(loadedWaConfig);

      // Refresh live MikroTik /ppp/profile & /ppp/secret in background
      fetchLiveMikrotikProfilesAndSecrets(activeRouterRef.current)
        .then((mk) => {
          if (mk.profiles.length > 0) setLiveMikrotikProfiles(mk.profiles);
          if (mk.secrets.length > 0) setLiveMikrotikSecrets(mk.secrets);
        })
        .catch(() => {});
    } catch (err) {
      console.warn('Supabase fetch invoices failed:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRunAnniversaryCron = async () => {
    setIsRunningCron(true);
    try {
      const summary = await runAnniversaryInvoicingCron(supabase, { force: true });
      setActionNotice(
        summary.generatedCount > 0
          ? `Anniversary Invoicing CRON (${summary.cycleMonth}): Generated ${summary.generatedCount} invoice${summary.generatedCount === 1 ? '' : 's'} totaling ${formatCurrency(summary.totalBilled)}.`
          : `Anniversary Invoicing CRON (${summary.cycleMonth}): Checked ${summary.scanned} active subscribers — all due anniversary bills (${summary.skippedExisting}) already generated, ${summary.skippedUpcomingAnchor} upcoming.`
      );
      await fetchInvoices();
    } catch (err: any) {
      setActionNotice(`Invoicing CRON notice: ${err?.message || 'Unable to generate invoices'}`);
    } finally {
      setIsRunningCron(false);
    }
  };

  useEffect(() => {
    fetchInvoices();

    // Auto-run Creation-Date Anniversary Billing check cleanly on load
    runAnniversaryInvoicingCron(supabase)
      .then((summary) => {
        if (summary.generatedCount > 0) {
          setActionNotice(
            `Auto-Invoicing (${summary.cycleMonth}): Generated ${summary.generatedCount} anniversary invoice${summary.generatedCount === 1 ? '' : 's'} (${formatCurrency(summary.totalBilled)}).`
          );
          fetchInvoices();
        }
      })
      .catch((err) => console.warn('Auto anniversary cron notice:', err));

    const handleWaConfigUpdated = (e: Event) => {
      const detail = (e as CustomEvent)?.detail;
      if (detail) setWhatsappConfig(detail);
    };
    window.addEventListener(WHATSAPP_CONFIG_UPDATED_EVENT, handleWaConfigUpdated);

    // 2. Enable Supabase Realtime Subscriptions
    const channel = supabase
      .channel('public:billing_view_invoices')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices' }, () => {
        fetchInvoices();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_transactions' }, () => {
        fetchInvoices();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_cash_transactions' }, () => {
        fetchInvoices();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'isp_expenses' }, () => {
        fetchInvoices();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_accounts' }, () => {
        fetchPaymentAccounts().then(setPaymentAccounts).catch(() => {});
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'portal_users' }, () => {
        fetchInvoices();
      })
      .subscribe();

    const periodicExpiryTimer = setInterval(() => {
      triggerAutoExpirySweep(activeRouterRef.current)
        .then((res) => {
          if (res.ran && (res.suspendedTo16Pool > 0 || res.disabledSecrets > 0)) {
            fetchInvoices();
          }
        })
        .catch(() => {});
    }, 5 * 60_000);

    return () => {
      clearInterval(periodicExpiryTimer);
      window.removeEventListener(WHATSAPP_CONFIG_UPDATED_EVENT, handleWaConfigUpdated);
      supabase.removeChannel(channel);
    };
  }, []);

  // 3. "+ Generate Invoice" Direct Supabase INSERT
  const handleGenerateInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubUsername.trim()) {
      setActionNotice('Please specify a subscriber username.');
      return;
    }

    setIsSubmitting(true);
    try {
      const selectedAgent = portalAgents.find((a) => a.id === newAssignedAgentId);
      const subClean = newSubUsername.trim().toLowerCase();
      const clientMatch = portalClients.find(
        (c) => (c.username || '').trim().toLowerCase() === subClean
      );
      const anchorDay = clientMatch ? computeBillingAnchorDay(clientMatch) : new Date().getDate();
      const generatedInvoiceNo = `INV-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`;

      const ownershipStamp = isResellerUser(currentUser)
        ? buildOwnershipStamp(currentUser)
        : {
            dealer_id: clientMatch?.dealer_id || null,
            sub_dealer_id: clientMatch?.sub_dealer_id || null,
            created_by_id: currentUser?.id || null,
          };

      const newInvoicePayload: Record<string, any> = {
        invoice_no: generatedInvoiceNo,
        subscriber_username: subClean,
        assigned_agent_id: newAssignedAgentId || null,
        assigned_agent_name: selectedAgent ? selectedAgent.full_name : null,
        amount: Number(newAmount) || 0,
        due_date: newDueDate,
        status: 'DUE',
        cycle_day: anchorDay,
        created_at: new Date().toISOString(),
        ...(ownershipStamp.dealer_id ? { dealer_id: ownershipStamp.dealer_id } : {}),
        ...(ownershipStamp.sub_dealer_id ? { sub_dealer_id: ownershipStamp.sub_dealer_id } : {}),
        ...(ownershipStamp.created_by_id ? { created_by_id: ownershipStamp.created_by_id } : {}),
      };

      const { error } = await safeInsertInvoiceInSupabase(newInvoicePayload);

      if (error) {
        throw new Error(error.message);
      }

      setActionNotice(`Invoice ${generatedInvoiceNo} generated successfully for @${newSubUsername}!`);
      setTimeout(() => setActionNotice(null), 5000);
      setIsGenerateModalOpen(false);
      setNewSubUsername('');
      await fetchInvoices();
    } catch (err: any) {
      setActionNotice(`Failed to generate invoice: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Helper to open Record Payment modal with accurate remaining balance
  const handleOpenMarkPaid = (inv: SupabaseInvoice) => {
    if (!perms.collect_fee) return;
    setSelectedInvoice(inv);
    setMarkPaidError(null);
    setMarkPaidWalletStatus(null);
    const alreadyPaid = Number(inv.paid_amount) || 0;
    const remainingDue = Math.max(0, (Number(inv.amount) || 0) - alreadyPaid);
    if (remainingDue <= 0) {
      setActionNotice('This invoice has already been settled and marked PAID.');
      return;
    }
    setPaymentReceivedInput(remainingDue);
    setCollectingAgentId(
      inv.assigned_agent_id && scopedPortalAgents.some((a) => a.id === inv.assigned_agent_id)
        ? inv.assigned_agent_id
        : scopedPortalAgents[0]?.id ?? ''
    );
    setIsMarkPaidModalOpen(true);
  };

  // 4. "Record Payment / Mark Paid" Direct Supabase UPDATE & Agent cash_in_hand Increment
  const handleConfirmMarkPaid = async () => {
    if (!perms.collect_fee) return;
    if (!selectedInvoice) return;

    const enteredVal = Number(paymentReceivedInput);
    if (isNaN(enteredVal) || enteredVal <= 0) {
      setMarkPaidError('Please enter a valid payment amount greater than 0.');
      return;
    }

    setMarkPaidError(null);
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

      const clientForRenewal = portalClients.find(
        (c) =>
          (c.username || '').trim().toLowerCase() ===
          (selectedInvoice.subscriber_username || '').trim().toLowerCase()
      );
      const renewalAnchorDay = clientForRenewal
        ? computeBillingAnchorDay(clientForRenewal)
        : selectedInvoice.cycle_day || new Date().getDate();
      const todayYmd = new Date().toISOString().slice(0, 10);
      const renewalBase =
        selectedInvoice.due_date && selectedInvoice.due_date >= todayYmd
          ? selectedInvoice.due_date
          : new Date();

      // STRICT PREPAID WALLET PAYMENT GATE BEFORE MARKING INVOICE PAID OR RESTORING MIKROTIK
      if (newStatus === 'PAID') {
        if (markPaidWalletStatus?.blocked) {
          const msg =
            markPaidWalletStatus.error || 'Insufficient Dealer Wallet Balance: Renewal blocked.';
          setMarkPaidError(msg);
          setActionNotice(msg);
          setIsSubmitting(false);
          return;
        }
        const restoreRes = await restoreSubscriberOnInvoicePaid(selectedInvoice.subscriber_username, {
          triggeredBy: 'ADMIN',
          performedBy: currentUser?.fullName || currentUser?.username || 'Billing Desk',
          notes: `Payment recorded on Invoice #${selectedInvoice.invoice_no} (${paidPaymentMethod})`,
          activeRouter: activeRouterRef.current,
          amountPaid: enteredVal,
          invoiceNo: selectedInvoice.invoice_no,
          paymentMethod: paidPaymentMethod,
        });
        if (restoreRes.insufficientWalletFunds || !restoreRes.success) {
          const msg = restoreRes.error || 'Insufficient Dealer Wallet Balance: Renewal blocked.';
          setMarkPaidError(msg);
          setActionNotice(msg);
          setIsSubmitting(false);
          return;
        }
      }

      // 1. Update invoice in Supabase ONLY AFTER prepaid wallet & MikroTik restore succeed
      const invoiceUpdateData: Partial<SupabaseInvoice> = {
        status: newStatus,
        paid_amount: finalPaidAmount,
        paid_at: newStatus === 'PAID' ? nowIso : (selectedInvoice.paid_at || null),
        cycle_day: renewalAnchorDay,
      };
      if (newStatus === 'PAID') {
        invoiceUpdateData.due_date = addCalendarMonthDateString(renewalBase, renewalAnchorDay);
        invoiceUpdateData.shifted_to_next_month = false;
      }

      const { error: invError } = await safeUpdateInvoiceInSupabase(
        { id: invoiceId, invoiceNo: selectedInvoice.invoice_no },
        invoiceUpdateData as Record<string, any>
      );

      if (invError) {
        throw new Error(invError.message);
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
          payment_mode: paidPaymentMethod,
          payment_date: nowIso,
          notes: `Billing collection for Invoice #${selectedInvoice.invoice_no}`,
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
        invoiceUpdateData.due_date ||
        selectedInvoice.due_date ||
        addCalendarMonthDateString(new Date(), renewalAnchorDay);

      // For partial payments (where restoreSubscriberOnInvoicePaid was not called), still auto-send instant WhatsApp receipt in background
      if (newStatus !== 'PAID') {
        void triggerAutoWhatsAppNotification({
          eventType: 'PAYMENT_RESTORED',
          subscriberUsername: selectedInvoice.subscriber_username,
          subscriber: clientMatch || { username: selectedInvoice.subscriber_username },
          messageVars: {
            subscriberName: clientMatch?.full_name || selectedInvoice.subscriber_username,
            username: selectedInvoice.subscriber_username,
            phone: clientMatch?.phone || undefined,
            invoiceNo: selectedInvoice.invoice_no,
            amountPaid: enteredVal,
            totalAmount: Number(selectedInvoice.amount) || 0,
            remainingBalance: Math.max(0, (Number(selectedInvoice.amount) || 0) - finalPaidAmount),
            paymentMethod: paidPaymentMethod,
            expiryDate: nextExpiryStr,
          },
        });
      }

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
      setMarkPaidError(`Failed to record payment: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // 5. Open Edit Invoice Modal with auto-preselected live MikroTik secret profile
  const handleOpenEditModal = (inv: SupabaseInvoice) => {
    if (!perms.edit_delete_invoice) return;
    setEditInvoiceError(null);
    setEditInvoiceWalletStatus(null);
    setInvoiceToEdit(inv);
    setEditAmount(Number(inv.amount) || 0);
    setEditDueDate(inv.due_date || '');
    setEditCycleDay(inv.cycle_day || new Date().getDate());
    setEditStatus((inv.status as any) || 'DUE');
    setEditAssignedAgentId(inv.assigned_agent_id || '');
    setEditNotes(inv.notes || '');

    const subClean = (inv.subscriber_username || '').trim().toLowerCase();
    const clientMatch = portalClients.find(
      (c) => (c.username || '').trim().toLowerCase() === subClean
    );
    const initialResolved = resolvePreselectedInvoiceProfile({
      username: inv.subscriber_username,
      invoicePackage: inv.package_profile || inv.package_name,
      secrets: liveMikrotikSecrets,
      subscriber: clientMatch || null,
      mikrotikProfiles: liveMikrotikProfiles,
    });
    setEditPackageProfile(initialResolved.selectedProfile);
    setEditDetectedMkProfile(
      initialResolved.origPkgFromComment || initialResolved.liveSecretProfile || null
    );
    setIsEditModalOpen(true);

    // Fetch fresh /ppp/profile and /ppp/secret right on modal open so dropdown & preselection are exact
    setIsLoadingMkProfiles(true);
    fetchLiveMikrotikProfilesAndSecrets(activeRouterRef.current)
      .then((mk) => {
        const nextProfiles = mk.profiles.length > 0 ? mk.profiles : liveMikrotikProfiles;
        const nextSecrets = mk.secrets.length > 0 ? mk.secrets : liveMikrotikSecrets;
        if (mk.profiles.length > 0) setLiveMikrotikProfiles(mk.profiles);
        if (mk.secrets.length > 0) setLiveMikrotikSecrets(mk.secrets);

        const freshResolved = resolvePreselectedInvoiceProfile({
          username: inv.subscriber_username,
          invoicePackage: inv.package_profile || inv.package_name,
          secrets: nextSecrets,
          subscriber: clientMatch || null,
          mikrotikProfiles: nextProfiles,
        });
        if (freshResolved.selectedProfile) {
          setEditPackageProfile(freshResolved.selectedProfile);
        }
        setEditDetectedMkProfile(
          freshResolved.origPkgFromComment || freshResolved.liveSecretProfile || null
        );
      })
      .catch(() => {})
      .finally(() => setIsLoadingMkProfiles(false));
  };

  const editModalPlanOptions = useMemo(() => {
    return buildLiveMikrotikPlanOptions({
      mikrotikProfiles: liveMikrotikProfiles,
      secrets: liveMikrotikSecrets,
      portalClients,
      assignedProfileName:
        editPackageProfile || invoiceToEdit?.package_profile || invoiceToEdit?.package_name || null,
      profilePriceMap,
      packages,
    });
  }, [
    liveMikrotikProfiles,
    liveMikrotikSecrets,
    portalClients,
    editPackageProfile,
    invoiceToEdit,
    profilePriceMap,
    packages,
  ]);

  // 6. Execute Invoice Update in Supabase + Sync Package Profile & Restore MikroTik if PAID
  const handleUpdateInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!perms.edit_delete_invoice) return;
    if (!invoiceToEdit) return;

    if (editStatus === 'PAID' && editInvoiceWalletStatus?.blocked) {
      setEditInvoiceError(
        editInvoiceWalletStatus.error || 'Insufficient Dealer Wallet Balance: Renewal blocked.'
      );
      return;
    }

    setEditInvoiceError(null);
    setIsSubmitting(true);
    try {
      const selectedAgent = scopedPortalAgents.find((a) => a.id === editAssignedAgentId);
      const selectedProfileClean = (editPackageProfile || '').trim();
      const updatedData: Partial<SupabaseInvoice> = {
        amount: Number(editAmount) || 0,
        due_date: editDueDate,
        cycle_day: Number(editCycleDay) || new Date().getDate(),
        status: editStatus as any,
        assigned_agent_id: editAssignedAgentId || null,
        assigned_agent_name: selectedAgent ? selectedAgent.full_name : null,
        notes: editNotes.trim() || null,
      };
      if (selectedProfileClean) {
        updatedData.package_profile = selectedProfileClean;
        updatedData.package_name = selectedProfileClean;
      }

      if (editStatus === 'PAID') {
        if (!invoiceToEdit.paid_at) {
          updatedData.paid_at = new Date().toISOString();
        }
        updatedData.paid_amount = Number(editAmount) || Number(invoiceToEdit.amount) || 0;
      } else if (editStatus === 'DUE' || editStatus === 'OVERDUE') {
        if (String(invoiceToEdit.status || '').toUpperCase() === 'PAID') {
          updatedData.paid_amount = 0;
          updatedData.paid_at = null;
        }
      }

      let syncNote = '';
      if (selectedProfileClean) {
        const syncRes = await syncSubscriberPackageAndRestoreIfPaid({
          username: invoiceToEdit.subscriber_username,
          selectedProfile: selectedProfileClean,
          isPaid: editStatus === 'PAID',
          invoiceNo: invoiceToEdit.invoice_no,
          triggeredBy: 'ADMIN',
          activeRouter: activeRouterRef.current,
          preloadedSecrets: liveMikrotikSecrets,
        });
        if (syncRes.insufficientWalletFunds || syncRes.error) {
          throw new Error(syncRes.error || 'Insufficient Dealer Wallet Balance');
        }
        if (editStatus === 'PAID') {
          syncNote = ` MikroTik set to "${syncRes.appliedProfile}" & kicked ${syncRes.kickedSessions} session(s).`;
        } else {
          syncNote = ` Package profile "${syncRes.appliedProfile}" synced to subscriber.`;
        }
      } else if (editStatus === 'PAID') {
        const restoreRes = await restoreSubscriberOnInvoicePaid(invoiceToEdit.subscriber_username, {
          triggeredBy: 'ADMIN',
          notes: `Invoice #${invoiceToEdit.invoice_no} updated to PAID`,
          activeRouter: activeRouterRef.current,
        });
        if (restoreRes.insufficientWalletFunds || (!restoreRes.success && restoreRes.error)) {
          throw new Error(restoreRes.error || 'Insufficient Dealer Wallet Balance');
        }
        syncNote = ` Restored to "${restoreRes.restoredProfile}" & kicked ${restoreRes.kickedSessions} session(s).`;
      }

      await updateInvoiceApi(invoiceToEdit.id, {
        amount: Number(updatedData.amount) || 0,
        due_date: updatedData.due_date || editDueDate,
        cycle_day: updatedData.cycle_day,
        billing_cycle_day: updatedData.cycle_day,
        status: editStatus,
        assigned_agent_id: updatedData.assigned_agent_id || null,
        assigned_agent_name: updatedData.assigned_agent_name || null,
        assigned_agent: updatedData.assigned_agent_name || null,
        notes: updatedData.notes ?? null,
        package_profile: updatedData.package_profile || null,
        package_name: updatedData.package_name || null,
        paid_amount: updatedData.paid_amount,
        paid_at: updatedData.paid_at,
      });

      // Update local state immediately
      setInvoices((prev) =>
        prev.map((i) => (i.id === invoiceToEdit.id ? { ...i, ...updatedData } : i))
      );

      setActionNotice(`Invoice ${invoiceToEdit.invoice_no} updated successfully!${syncNote}`);
      setTimeout(() => setActionNotice(null), 6000);
      setEditInvoiceError(null);
      setIsEditModalOpen(false);
      setInvoiceToEdit(null);
      await fetchInvoices();
    } catch (err: any) {
      setEditInvoiceError(err?.message || 'Failed to update invoice.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // 7. Execute Invoice Delete via Direct Supabase (+ Optional Linked Payment Cleanup)
  const handleDeleteInvoice = async () => {
    if (!perms.edit_delete_invoice) return;
    if (!invoiceToDelete) return;

    setDeleteInvoiceError(null);
    setIsSubmitting(true);
    try {
      const invoiceId = invoiceToDelete.id;
      const invoiceNo = invoiceToDelete.invoice_no;

      const res = await deleteInvoiceApi(invoiceId, {
        deleteLinkedPayments,
      });

      // Remove from local state instantly
      setInvoices((prev) => prev.filter((i) => i.id !== invoiceId));
      if (deleteLinkedPayments) {
        setPaymentTransactions((prev) => prev.filter((tx) => tx.invoice_id !== invoiceId));
      }

      const txNote =
        res.deletedPaymentsCount && res.deletedPaymentsCount > 0
          ? ` Also removed ${res.deletedPaymentsCount} linked payment receipt(s).`
          : '';
      setActionNotice(`Invoice ${invoiceNo} deleted successfully.${txNote}`);
      setTimeout(() => setActionNotice(null), 5000);
      setDeleteInvoiceError(null);
      setInvoiceToDelete(null);
      await fetchInvoices();
    } catch (err: any) {
      const msg = err?.message || 'Failed to delete invoice.';
      setDeleteInvoiceError(msg);
      setActionNotice(`Failed to delete invoice: ${msg}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Client lookup map (used for grace/overdue/shifted badges & filters)
  const clientByUsername = useMemo(() => {
    const map: Record<string, SupabasePortalUser> = {};
    for (const c of portalClients) {
      const key = (c.username || '').trim().toLowerCase();
      if (key) map[key] = c;
    }
    return map;
  }, [portalClients]);

  // Multi-Tier Reseller Scope Isolation + Admin Dealer/Sub-Dealer Filter
  const resellerScope = useMemo(
    () => resolveResellerScope(currentUser, [...allResellers, ...portalClients]),
    [currentUser, allResellers, portalClients]
  );

  const adminDealerSelection = useMemo(
    () => resolveAdminDealerFilterIds(dealerFilter, allResellers, true),
    [dealerFilter, allResellers]
  );

  const subscriberOwnerByUsername = useMemo(() => {
    const map = new Map<string, { dealer_id?: string | null; sub_dealer_id?: string | null }>();
    for (const c of portalClients) {
      const key = String(c.username || '').trim().toLowerCase();
      if (key) {
        map.set(key, {
          dealer_id: c.dealer_id || null,
          sub_dealer_id: c.sub_dealer_id || null,
        });
      }
    }
    return map;
  }, [portalClients]);

  const scopedPortalClients = useMemo(() => {
    return (portalClients || []).filter((client) => {
      if (resellerScope.isIsolated) {
        return isVisibleToCurrentUser(client, currentUser, {
          childSubDealerIds: resellerScope.allowedResellerIds,
          allowedSubscriberUsernames: resellerScope.allowedSubscriberUsernames,
        });
      }
      return doesRecordMatchAdminOwnerFilter(client, adminDealerSelection, subscriberOwnerByUsername);
    });
  }, [portalClients, resellerScope, currentUser, adminDealerSelection, subscriberOwnerByUsername]);

  // Strict Multi-Tenant Field Agents & Recovery Staff Isolation
  // - ADMIN: Master ISP direct field agents by default (with optional Dealer/Sub-Dealer inspector dropdown)
  // - DEALER: ONLY own created agents + child Sub-Dealers' agents
  // - SUB_DEALER: ONLY own created agents (sub_dealer_id === self || created_by_id === self)
  const scopedPortalAgents = useMemo(() => {
    if (resellerScope.isIsolated && isLoading && portalAgents.length === 0) return [];
    return filterFieldAgentsForUser(portalAgents, currentUser, {
      childSubDealerIds: resellerScope.allowedResellerIds,
      adminOwnerFilter: staffOwnerFilter,
      allResellers,
    });
  }, [portalAgents, currentUser, resellerScope, staffOwnerFilter, allResellers, isLoading]);

  const scopedLiveFieldStaff = useMemo(() => {
    if (resellerScope.isIsolated && isLoading && liveFieldStaff.length === 0) return [];
    const filteredLedger = filterFieldAgentsForUser(liveFieldStaff, currentUser, {
      childSubDealerIds: resellerScope.allowedResellerIds,
      adminOwnerFilter: staffOwnerFilter,
      allResellers,
    });
    if (filteredLedger.length > 0) return filteredLedger;
    // Also synthesize clean cards for newly created scoped agents before their first transaction
    return scopedPortalAgents.map((a) => ({
      id: a.id,
      username: a.username,
      role: String(a.role || 'AGENT').toUpperCase(),
      tier_level: a.tier_level ?? 'STAFF',
      dealer_id: a.dealer_id ?? null,
      sub_dealer_id: a.sub_dealer_id ?? null,
      created_by_id: a.created_by_id ?? null,
      name: a.full_name || a.username,
      phone: a.phone || '',
      email: `${a.username}@youthnet.pk`,
      assignedArea: a.area || 'Field Sector',
      status: 'active' as const,
      cashInHand: Number(a.cash_in_hand) || 0,
      totalCollectedToday: 0,
      activeTicketsAssigned: 0,
      baseSalary: Number(a.base_salary) || 0,
      advanceSalaryTaken: Number(a.advance_balance) || 0,
      advanceSalaryReturned: 0,
      totalCashCollected: 0,
      totalHandedOver: 0,
      advanceBalance: Number(a.advance_balance) || 0,
      netPayable: Math.max(0, (Number(a.base_salary) || 0) - (Number(a.advance_balance) || 0)),
      totalSalaryPaid: 0,
      expensesRecorded: 0,
    }));
  }, [
    liveFieldStaff,
    scopedPortalAgents,
    currentUser,
    resellerScope,
    staffOwnerFilter,
    allResellers,
    isLoading,
  ]);

  const scopedInvoices = useMemo(() => {
    return (invoices || []).filter((inv) => {
      const uname = (inv.subscriber_username || '').trim().toLowerCase();
      const client = clientByUsername[uname];
      const enrichedRecord = {
        ...inv,
        subscriber_username: uname,
        dealer_id: inv.dealer_id || client?.dealer_id || null,
        sub_dealer_id: inv.sub_dealer_id || client?.sub_dealer_id || null,
        created_by_id: inv.created_by_id || client?.created_by_id || null,
      };

      if (resellerScope.isIsolated) {
        return doesInvoiceMatchScope(enrichedRecord, resellerScope);
      }
      return doesRecordMatchAdminOwnerFilter(
        enrichedRecord,
        adminDealerSelection,
        subscriberOwnerByUsername
      );
    });
  }, [invoices, clientByUsername, resellerScope, adminDealerSelection, subscriberOwnerByUsername]);

  // Date-filtered Invoices & Payments (strictly scoped by reseller/dealer filter)
  const dateFilteredInvoices = useMemo(() => {
    return scopedInvoices.filter((inv) =>
      matchesDateFilter([inv.created_at, inv.due_date, inv.paid_at], dateFilter)
    );
  }, [scopedInvoices, dateFilter]);

  const dateFilteredPayments = useMemo(() => {
    const scopedUsernames = new Set<string>([
      ...scopedInvoices.map((i) => String(i.subscriber_username || '').trim().toLowerCase()),
      ...scopedPortalClients.map((c) => String(c.username || '').trim().toLowerCase()),
    ]);
    return (paymentTransactions || []).filter((tx) => {
      if (resellerScope.isIsolated || adminDealerSelection.mode !== 'ALL') {
        const u = String(tx.subscriber_username || '').trim().toLowerCase();
        if (!scopedUsernames.has(u)) return false;
      }
      return matchesDateFilter(tx.payment_date || tx.created_at, dateFilter);
    });
  }, [
    paymentTransactions,
    dateFilter,
    scopedInvoices,
    scopedPortalClients,
    resellerScope.isIsolated,
    adminDealerSelection.mode,
  ]);

  const invoiceStatusCounts = useMemo(() => {
    let due = 0;
    let partial = 0;
    let paid = 0;
    let overdue = 0;
    let grace = 0;
    for (const inv of dateFilteredInvoices) {
      const balanceDue = Math.max(0, (Number(inv?.amount) || 0) - (Number(inv?.paid_amount) || 0));
      const displayStatus = balanceDue === 0 ? 'PAID' : (inv?.status || 'DUE').toUpperCase();
      const client = clientByUsername[(inv?.subscriber_username || '').trim().toLowerCase()] || null;
      if (displayStatus === 'PAID') paid++;
      else if (displayStatus === 'PARTIAL') partial++;
      else due++;

      if (
        isInvoiceOverdueOrGraceExpired({
          status: inv?.status,
          amount: inv?.amount,
          paidAmount: inv?.paid_amount,
          dueDate: inv?.due_date,
          shiftedToNextMonth: inv?.shifted_to_next_month,
          subscriber: client,
        })
      ) {
        overdue++;
      }
      if (balanceDue > 0 && displayStatus !== 'PAID' && hasSubscriberActiveGrace(client)) {
        grace++;
      }
    }
    return {
      all: dateFilteredInvoices.length,
      due,
      partial,
      paid,
      overdue,
      grace,
    };
  }, [dateFilteredInvoices, clientByUsername]);

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
      const client = clientByUsername[(inv?.subscriber_username || '').trim().toLowerCase()] || null;

      const matchStatus =
        statusFilter === 'ALL'
          ? true
          : statusFilter === 'PAID'
          ? displayStatus === 'PAID'
          : statusFilter === 'PARTIAL'
          ? displayStatus === 'PARTIAL'
          : statusFilter === 'OVERDUE'
          ? isInvoiceOverdueOrGraceExpired({
              status: inv?.status,
              amount: inv?.amount,
              paidAmount: inv?.paid_amount,
              dueDate: inv?.due_date,
              shiftedToNextMonth: inv?.shifted_to_next_month,
              subscriber: client,
            })
          : statusFilter === 'GRACE'
          ? balanceDue > 0 && displayStatus !== 'PAID' && hasSubscriberActiveGrace(client)
          : displayStatus === 'DUE';

      return matchSearch && matchStatus;
    });
  }, [dateFilteredInvoices, searchTerm, statusFilter, clientByUsername]);

  const selectableUnpaidInvoices = useMemo(
    () =>
      filteredInvoices.filter((inv) => {
        const balanceDue = Math.max(0, (Number(inv?.amount) || 0) - (Number(inv?.paid_amount) || 0));
        const displayStatus = balanceDue === 0 ? 'PAID' : (inv?.status || 'DUE').toUpperCase();
        return balanceDue > 0 && displayStatus !== 'PAID';
      }),
    [filteredInvoices]
  );

  const selectedInvoices = useMemo(
    () => selectableUnpaidInvoices.filter((inv) => Boolean(selectedInvoiceIds[inv.id])),
    [selectableUnpaidInvoices, selectedInvoiceIds]
  );

  const selectedInvoicesTotal = useMemo(
    () =>
      selectedInvoices.reduce(
        (sum, inv) => sum + Math.max(0, (Number(inv.amount) || 0) - (Number(inv.paid_amount) || 0)),
        0
      ),
    [selectedInvoices]
  );

  const allUnpaidSelected =
    selectableUnpaidInvoices.length > 0 &&
    selectedInvoices.length === selectableUnpaidInvoices.length;

  const toggleSelectAllInvoices = () => {
    if (allUnpaidSelected) {
      setSelectedInvoiceIds((prev) => {
        const next = { ...prev };
        for (const inv of selectableUnpaidInvoices) {
          delete next[inv.id];
        }
        return next;
      });
    } else {
      setSelectedInvoiceIds((prev) => {
        const next = { ...prev };
        for (const inv of selectableUnpaidInvoices) {
          next[inv.id] = true;
        }
        return next;
      });
    }
  };

  const toggleSelectOneInvoice = (invoiceId: string) => {
    if (!invoiceId) return;
    setSelectedInvoiceIds((prev) => ({ ...prev, [invoiceId]: !prev[invoiceId] }));
  };

  const bulkAgentOptions = useMemo(() => {
    if (scopedLiveFieldStaff.length > 0) {
      return scopedLiveFieldStaff.map((s) => ({
        id: s.id,
        full_name: s.name,
        area: s.assignedArea,
        role: s.role,
      }));
    }
    return scopedPortalAgents.map((a) => ({
      id: a.id,
      full_name: a.full_name,
      area: a.area,
      role: a.role,
    }));
  }, [scopedLiveFieldStaff, scopedPortalAgents]);

  const handleConfirmBulkReceive = async (payload: {
    paymentMethod: string;
    agentId: string;
    agentName: string;
    referenceNote: string;
  }) => {
    if (!canBulkReceive) return;
    if (selectedInvoices.length === 0 || isBulkReceiving) return;
    setIsBulkReceiving(true);
    setBulkReceiveProgress(`Processing 0 / ${selectedInvoices.length}...`);
    try {
      const res = await bulkReceivePayments({
        items: selectedInvoices.map((inv) => ({
          invoice: inv,
          amountToCollect: Math.max(0, (Number(inv.amount) || 0) - (Number(inv.paid_amount) || 0)),
        })),
        allInvoices: invoices,
        portalClients,
        paymentMethod: payload.paymentMethod,
        agentId: payload.agentId || null,
        agentName: payload.agentName,
        collectedByName: currentUser?.fullName || payload.agentName,
        referenceNote: payload.referenceNote,
        activeRouter: activeRouterRef.current,
        onProgress: (curr, total, label) => {
          setBulkReceiveProgress(`Collecting ${curr} / ${total} (${label})...`);
        },
      });

      setSelectedInvoiceIds({});
      setIsBulkReceiveModalOpen(false);
      setActionNotice(
        `Bulk Payment Complete: Settled ${res.settledInvoicesCount} invoice(s) (${formatCurrency(
          res.totalCollected,
          0
        )}) via ${payload.paymentMethod}${
          payload.agentId ? ` -> Credited ${payload.agentName}` : ''
        } • Restored ${res.restoredSubscribersCount} MikroTik account(s) & kicked ${
          res.kickedSessions
        } session(s)${res.errors.length > 0 ? ` (${res.errors.length} warning)` : ''}.`
      );
      setTimeout(() => setActionNotice(null), 10000);
      await fetchInvoices();
    } catch (err: any) {
      setActionNotice(`Bulk payment notice: ${err?.message || 'Unable to process bulk payment'}`);
    } finally {
      setIsBulkReceiving(false);
      setBulkReceiveProgress(null);
    }
  };

  // Dynamic Period Aggregate Metrics
  const totalBilled = dateFilteredInvoices.reduce((acc, i) => acc + (Number(i.amount) || 0), 0);
  const totalPaid = dateFilteredInvoices.reduce(
    (acc, i) => acc + (Number(i.paid_amount) || ((i.status || '').toUpperCase() === 'PAID' ? Number(i.amount) : 0)),
    0
  );
  const totalDue = dateFilteredInvoices
    .reduce((acc, i) => acc + Math.max(0, (Number(i.amount) || 0) - (Number(i.paid_amount) || 0)), 0);
  const totalAgentCash =
    scopedLiveFieldStaff.length > 0
      ? scopedLiveFieldStaff.reduce((acc, a) => acc + (Number(a.cashInHand) || 0), 0)
      : (scopedPortalAgents || []).reduce((acc, a) => acc + (Number(a.cash_in_hand) || 0), 0);

  const activePaymentAccounts = useMemo(
    () => (paymentAccounts || []).filter((acc) => acc.is_active !== false),
    [paymentAccounts]
  );

  const handleShiftInvoiceNextMonth = async (inv: SupabaseInvoice) => {
    if (!canUseGraceAndShift) {
      setActionNotice(
        'Shift Bill to Next Month is disabled for Dealers/Sub-Dealers unless explicitly permitted by Admin.'
      );
      return;
    }
    const uname = String(inv.subscriber_username || '').trim().toLowerCase();
    const client = clientByUsername[uname] || null;
    setShiftingInvoiceId(inv.id);
    try {
      const res = await shiftBillToNextMonth({
        username: uname,
        subscriberId: client?.id || inv.subscriber_id || null,
        targetInvoice: inv,
        allInvoices: invoices,
        activeRouter: activeRouterRef.current,
        preloadedSecrets: liveMikrotikSecrets,
        preloadedProfiles: liveMikrotikProfiles.map((p) => p.name),
      });
      setActionNotice(
        `Shifted Invoice #${inv.invoice_no} (@${uname}) to Next Month (${res.nextDueDate}) — exempt from expiry pool${
          res.restoredMikrotik
            ? ` · Restored MikroTik "${res.appliedProfile}" (kicked ${res.kickedSessions} session(s))`
            : ''
        }.`
      );
      setTimeout(() => setActionNotice(null), 9000);
      await fetchInvoices();
    } catch (err: any) {
      setActionNotice(`Unable to shift invoice #${inv.invoice_no}: ${err?.message || 'Error'}`);
    } finally {
      setShiftingInvoiceId(null);
    }
  };

  const preExpiryReminderQueue = useMemo(
    () =>
      buildPreExpiryReminderQueue({
        subscribers: scopedPortalClients,
        invoices: scopedInvoices,
        maxDays: whatsappConfig.auto_remind_days_before ?? 3,
      }),
    [scopedPortalClients, scopedInvoices, whatsappConfig.auto_remind_days_before]
  );

  const supportWhatsapp = whatsappConfig.support_whatsapp || DEFAULT_SUPPORT_WHATSAPP;

  const handleSendPreExpiryReminder = async (item: (typeof preExpiryReminderQueue)[number]) => {
    const res = await triggerAutoWhatsAppNotification({
      eventType: 'PRE_EXPIRY_3D',
      subscriberUsername: item.username,
      messageVars: {
        subscriberName: item.fullName,
        username: item.username,
        phone: item.phone,
        packageName: item.packageSpeed,
        daysRemaining: item.daysRemaining,
        expiryDate: item.expiryDate,
        invoiceNo: item.invoiceNo,
        amountDue: item.amountDue,
      },
    });
    if (res.ok && res.status === 'SENT') {
      setActionNotice(`WhatsApp reminder sent automatically to @${item.username} via ${res.senderCompanyName || 'Gateway'}.`);
    } else if (res.status === 'SKIPPED') {
      setActionNotice(res.skippedReason || `Reminder skipped for @${item.username}.`);
    } else {
      setActionNotice(`WhatsApp delivery failed for @${item.username}: ${res.error || 'Connect WhatsApp in WhatsApp & Branding.'}`);
    }
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

  const handleSendInvoiceWhatsApp = async (inv: SupabaseInvoice) => {
    const client = clientByUsername[(inv.subscriber_username || '').trim().toLowerCase()];
    const totalAmount = Number(inv.amount) || 0;
    const paidAmount = Number(inv.paid_amount) || 0;
    const balanceDue = Math.max(0, totalAmount - paidAmount);
    const isPaid = balanceDue <= 0 || (inv.status || '').toUpperCase() === 'PAID';
    const daysLeft = computeDaysUntilDate(inv.due_date);

    const res = await triggerAutoWhatsAppNotification({
      eventType: isPaid ? 'PAYMENT_RESTORED' : 'PRE_EXPIRY_3D',
      subscriberUsername: inv.subscriber_username,
      subscriber: client || { username: inv.subscriber_username },
      messageVars: {
        subscriberName: client?.full_name || inv.subscriber_username,
        username: inv.subscriber_username,
        phone: client?.phone || undefined,
        invoiceNo: inv.invoice_no,
        packageName: client?.package_speed || 'Fiber Broadband',
        amountPaid: isPaid ? (paidAmount > 0 ? paidAmount : totalAmount) : 0,
        amountDue: isPaid ? 0 : balanceDue,
        totalAmount,
        remainingBalance: balanceDue,
        daysRemaining: daysLeft !== null ? Math.max(0, daysLeft) : 0,
        expiryDate: inv.due_date,
        paymentMethod: 'Verified Payment',
      },
    });

    if (res.ok && res.status === 'SENT') {
      setActionNotice(
        `WhatsApp ${isPaid ? 'receipt' : 'reminder'} sent automatically to @${inv.subscriber_username} via ${res.senderCompanyName || 'Gateway'}.`
      );
    } else if (res.status === 'SKIPPED') {
      setActionNotice(res.skippedReason || `WhatsApp message skipped for @${inv.subscriber_username}.`);
    } else {
      setActionNotice(
        `WhatsApp send failed for @${inv.subscriber_username}: ${res.error || 'Pair WhatsApp in WhatsApp & Branding.'}`
      );
    }
  };

  return (
    <div className="w-full max-w-full min-w-0 box-border space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-800 min-w-0">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              <CreditCard className="w-5 h-5 sm:w-6 sm:h-6 text-cyan-400 shrink-0" />
              <span>Billing &amp; Invoices (Supabase PostgreSQL)</span>
            </h1>
            <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-950 text-emerald-400 border border-emerald-800 flex items-center gap-1 shrink-0">
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
            onClick={handleRunAnniversaryCron}
            disabled={isRunningCron}
            className="px-3.5 py-2.5 rounded-xl border border-cyan-700/60 bg-cyan-950/50 hover:bg-cyan-900/60 text-cyan-300 font-semibold text-xs flex items-center gap-2 transition cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
            title="Generate anniversary-date monthly invoices for active subscribers"
          >
            <RefreshCw className={`w-4 h-4 text-cyan-400 shrink-0 ${isRunningCron ? 'animate-spin' : ''}`} />
            <span>{isRunningCron ? 'Running CRON...' : 'Run Invoicing CRON'}</span>
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
            className="px-4 py-2.5 bg-sky-600 hover:bg-sky-500 text-white font-bold rounded-xl transition flex items-center gap-2 shadow-sm cursor-pointer active:scale-95 whitespace-nowrap shrink-0"
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
                onClick={async () => {
                  const res = await triggerAutoWhatsAppNotification({
                    eventType: 'PAYMENT_RESTORED',
                    subscriberUsername: lastPaidReceiptPayload.username,
                    messageVars: {
                      subscriberName: lastPaidReceiptPayload.fullName,
                      username: lastPaidReceiptPayload.username,
                      phone: lastPaidReceiptPayload.phone,
                      invoiceNo: lastPaidReceiptPayload.invoiceNo,
                      amountPaid: lastPaidReceiptPayload.amountPaid,
                      totalAmount: lastPaidReceiptPayload.totalAmount,
                      remainingBalance: lastPaidReceiptPayload.remainingBalance,
                      paymentMethod: lastPaidReceiptPayload.paymentMethod,
                      expiryDate: lastPaidReceiptPayload.nextExpiryDate,
                    },
                  });
                  if (res.ok && res.status === 'SENT') {
                    setActionNotice(`Receipt re-sent automatically via ${res.senderCompanyName || 'Gateway'}!`);
                  } else {
                    setActionNotice(`WhatsApp receipt failed: ${res.error || 'Ensure WhatsApp is connected.'}`);
                  }
                }}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Resend Auto WhatsApp Receipt</span>
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
          <div className="text-slate-500 text-xs mt-1 font-mono tabular-nums">{scopedLiveFieldStaff.length} active field staff</div>
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
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shadow-sm"
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
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 flex-1">
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

          {!resellerScope.isIsolated && allResellers.length > 0 && (
            <select
              value={dealerFilter}
              onChange={(e) => setDealerFilter(e.target.value)}
              className="px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-cyan-500 shrink-0"
              title="Filter by Owner (All / Master Direct / Dealer / Sub-Dealer)"
            >
              <option value="ALL">Filter by Owner: All Owners</option>
              <option value="DIRECT_ISP">Master Direct ISP Only</option>
              {allResellers
                .filter((r) => getResellerTier(r) === 'DEALER')
                .map((d) => (
                  <React.Fragment key={d.id}>
                    <option value={d.id}>
                      [Dealer] {d.full_name || d.username} (@{d.username})
                    </option>
                    {allResellers
                      .filter((s) => s.parent_dealer_id === d.id)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          &nbsp;&nbsp;↳ [Sub-Dealer] {s.full_name || s.username} (@{s.username})
                        </option>
                      ))}
                  </React.Fragment>
                ))}
              {allResellers
                .filter((r) => getResellerTier(r) === 'SUB_DEALER' && !r.parent_dealer_id)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    [Sub-Dealer] {s.full_name || s.username} (@{s.username})
                  </option>
                ))}
            </select>
          )}
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
          <button
            type="button"
            onClick={() => setStatusFilter('ALL')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer whitespace-nowrap border ${
              statusFilter === 'ALL'
                ? 'bg-sky-600 text-white border-sky-600 font-bold dark:bg-sky-500/20 dark:text-sky-300 dark:border-sky-400/60'
                : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700 dark:hover:bg-slate-700'
            }`}
          >
            All ({invoiceStatusCounts.all})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('DUE')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer whitespace-nowrap border ${
              statusFilter === 'DUE'
                ? 'bg-amber-600 text-white border-amber-600 font-bold dark:bg-amber-500/20 dark:text-amber-300 dark:border-amber-400/60'
                : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700 dark:hover:bg-slate-700'
            }`}
          >
            Due ({invoiceStatusCounts.due})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('PARTIAL')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer whitespace-nowrap border ${
              statusFilter === 'PARTIAL'
                ? 'bg-amber-600 text-white border-amber-600 font-bold dark:bg-amber-500/20 dark:text-amber-300 dark:border-amber-400/60'
                : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700 dark:hover:bg-slate-700'
            }`}
          >
            Partial ({invoiceStatusCounts.partial})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('OVERDUE')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer whitespace-nowrap border inline-flex items-center gap-1 ${
              statusFilter === 'OVERDUE'
                ? 'bg-rose-600 text-white border-rose-500 font-bold'
                : 'bg-rose-950/60 text-rose-300 border-rose-800/80 hover:bg-rose-900/70'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>Overdue / Grace Expired ({invoiceStatusCounts.overdue})</span>
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('GRACE')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer whitespace-nowrap border inline-flex items-center gap-1 ${
              statusFilter === 'GRACE'
                ? 'bg-cyan-600 text-white border-cyan-500 font-bold'
                : 'bg-cyan-950/60 text-cyan-300 border-cyan-800/80 hover:bg-cyan-900/70'
            }`}
          >
            <Timer className="w-3.5 h-3.5" />
            <span>Grace Period Assigned ({invoiceStatusCounts.grace})</span>
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('PAID')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer whitespace-nowrap border ${
              statusFilter === 'PAID'
                ? 'bg-emerald-600 text-white border-emerald-600 font-bold dark:bg-emerald-500/20 dark:text-emerald-300 dark:border-emerald-400/60'
                : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700 dark:hover:bg-slate-700'
            }`}
          >
            Paid ({invoiceStatusCounts.paid})
          </button>
        </div>
      </div>

      {/* Sticky Bulk Payment Action Bar */}
      {canBulkReceive && selectedInvoices.length > 0 && (
        <div className="sticky top-2 z-30 rounded-xl border border-emerald-500/60 bg-slate-950/95 backdrop-blur-md px-3.5 py-2.5 shadow-2xl flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2 text-xs">
            <span className="px-2.5 py-1 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-mono font-bold">
              {selectedInvoices.length} Invoice{selectedInvoices.length === 1 ? '' : 's'} Selected • Total{' '}
              {formatCurrency(selectedInvoicesTotal, 0)}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setIsBulkReceiveModalOpen(true)}
              disabled={isBulkReceiving}
              className="px-3.5 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition cursor-pointer shadow disabled:opacity-50"
            >
              <DollarSign className="w-3.5 h-3.5" />
              <span>
                Bulk Receive Amount ({selectedInvoices.length} Selected • Total{' '}
                {formatCurrency(selectedInvoicesTotal, 0)})
              </span>
            </button>
            <button
              type="button"
              onClick={() => setSelectedInvoiceIds({})}
              disabled={isBulkReceiving}
              className="px-2.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Mobile Invoice Card List (< 768px) */}
      <div className="flex flex-col gap-3 md:hidden w-full max-w-full">
        {canBulkReceive && selectableUnpaidInvoices.length > 0 && (
          <div className="flex items-center justify-between px-3 py-2 rounded-xl border border-slate-800 bg-[#111A2E] text-xs">
            <label className="inline-flex items-center gap-2 font-semibold text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={allUnpaidSelected}
                onChange={toggleSelectAllInvoices}
                className="w-4 h-4 rounded border-slate-600 bg-slate-900 text-emerald-500 focus:ring-emerald-500 cursor-pointer"
              />
              <span>Select All Unpaid ({selectableUnpaidInvoices.length})</span>
            </label>
            <span className="font-mono text-slate-400">
              {selectedInvoices.length} selected
            </span>
          </div>
        )}
        {filteredInvoices.length === 0 ? (
          <div className="w-full max-w-full overflow-hidden rounded-xl border border-slate-800 bg-[#111A2E] py-10 px-4 text-center text-slate-500 box-border shadow-lg">
            <FileText className="w-10 h-10 text-slate-600 mx-auto mb-2 opacity-50" />
            <p className="text-base font-semibold text-slate-400">No invoices found</p>
            <p className="text-xs text-slate-500 mt-1">
              Click &quot;+ Generate Invoice&quot; to create an invoice in Supabase PostgreSQL.
            </p>
          </div>
        ) : (
          filteredInvoices.map((inv) => {
            const totalAmount = Number(inv.amount || 0);
            const alreadyPaid = Number(inv.paid_amount || 0);
            const balanceDue = Math.max(0, totalAmount - alreadyPaid);
            const displayStatus = balanceDue === 0 ? 'PAID' : (inv.status || 'DUE').toUpperCase();
            const isPaid = displayStatus === 'PAID';
            const isPartial = displayStatus === 'PARTIAL';
            const isSelectable = balanceDue > 0 && !isPaid;
            const isChecked = Boolean(isSelectable && selectedInvoiceIds[inv.id]);
            const clientMatch = clientByUsername[(inv.subscriber_username || '').trim().toLowerCase()] || null;
            const hasGrace = !isPaid && hasSubscriberActiveGrace(clientMatch);
            const graceIso = hasGrace ? getSubscriberGraceUntilIso(clientMatch) : null;
            const isShifted = !isPaid && isSubscriberShiftedNextMonth(clientMatch, inv);

            return (
              <div
                key={inv.id}
                className={`w-full max-w-full overflow-hidden rounded-xl border p-3.5 space-y-3 box-border shadow-lg transition ${
                  isChecked
                    ? 'border-emerald-500/70 bg-emerald-950/15'
                    : 'border-slate-800 bg-[#111A2E]'
                }`}
              >
                {/* Row 1: Checkbox + @username (bold) + INV-# + Status Badge */}
                <div className="flex items-start justify-between gap-2 min-w-0">
                  <div className="flex items-start gap-2.5 min-w-0 flex-1">
                    {canBulkReceive && isSelectable && (
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleSelectOneInvoice(inv.id)}
                        aria-label={`Select invoice ${inv.invoice_no}`}
                        className="mt-1 w-4 h-4 rounded border-slate-600 bg-slate-900 text-emerald-500 focus:ring-emerald-500 cursor-pointer shrink-0"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-white text-base truncate">
                        @{inv.subscriber_username}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs mt-0.5">
                        <span className="font-mono font-semibold text-cyan-400">
                          #{inv.invoice_no}
                        </span>
                        <span className="text-slate-500">• Bill Day: {inv.cycle_day || 'Monthly'}</span>
                      </div>
                      {(hasGrace || isShifted) && (
                        <div className="flex flex-wrap items-center gap-1.5 mt-1">
                          {hasGrace && (
                            <span className="px-2 py-0.5 rounded bg-cyan-950 border border-cyan-700 text-cyan-300 font-mono text-[10px] font-bold">
                              ⏳ Grace until {graceIso ? formatShortGraceDate(graceIso) : 'Active'}
                            </span>
                          )}
                          {isShifted && (
                            <span className="px-2 py-0.5 rounded bg-indigo-950 border border-indigo-700 text-indigo-300 font-mono text-[10px] font-bold">
                              ⏭ Shifted Next Month
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0">
                    {isPaid ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        <span>PAID</span>
                      </span>
                    ) : isPartial ? (
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
                  </div>
                </div>

                {/* Row 2: Amount, Paid, Remaining Balance (highlighted), Due Date, Agent */}
                <div className="grid grid-cols-2 gap-2 p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs min-w-0">
                  <div className="min-w-0">
                    <span className="text-[11px] text-slate-400 block">Invoice Amount</span>
                    <span className="font-mono font-bold text-white text-sm">
                      {formatCurrency(totalAmount)}
                    </span>
                  </div>
                  <div className="min-w-0 text-right">
                    <span className="text-[11px] text-slate-400 block">Paid</span>
                    <span className="font-mono font-semibold text-emerald-400 text-sm">
                      {formatCurrency(alreadyPaid)}
                    </span>
                  </div>
                  <div className="min-w-0 col-span-2 flex items-center justify-between pt-1.5 border-t border-slate-800/80">
                    <span className="font-semibold text-amber-300">Remaining Balance</span>
                    <span
                      className={`font-mono font-bold text-sm ${
                        balanceDue > 0 ? 'text-amber-400' : 'text-emerald-400'
                      }`}
                    >
                      {formatCurrency(balanceDue)}
                    </span>
                  </div>
                  <div className="min-w-0 pt-1 border-t border-slate-800/80">
                    <span className="text-[11px] text-slate-400 block">Due Date</span>
                    <span className="font-mono text-slate-200">{inv.due_date}</span>
                  </div>
                  <div className="min-w-0 pt-1 border-t border-slate-800/80 text-right">
                    <span className="text-[11px] text-slate-400 block">Agent</span>
                    <span className="text-slate-200 font-medium truncate block">
                      {inv.assigned_agent_name || 'Unassigned'}
                    </span>
                  </div>
                </div>

                {/* Row 3: Full-Width Action Buttons directly visible without scrolling */}
                <div className="flex flex-col gap-2 w-full min-w-0">
                  {balanceDue > 0 && displayStatus !== 'PAID' ? (
                    <>
                      {perms.collect_fee && (
                        <button
                          type="button"
                          onClick={() => handleOpenMarkPaid(inv)}
                          className="w-full py-2.5 px-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-sm flex items-center justify-center gap-1.5 transition active:scale-[0.99] shadow cursor-pointer"
                        >
                          <DollarSign className="w-4 h-4 shrink-0" />
                          <span>$ Add Payment</span>
                        </button>
                      )}
                      <div className="flex flex-wrap items-center gap-2 w-full min-w-0">
                        {canUseGraceAndShift && (
                          <button
                            type="button"
                            disabled={shiftingInvoiceId === inv.id}
                            onClick={() => handleShiftInvoiceNextMonth(inv)}
                            className="flex-1 min-w-0 py-2 px-2.5 bg-indigo-950/70 hover:bg-indigo-900/80 text-indigo-300 border border-indigo-700/70 rounded-xl text-xs font-semibold flex items-center justify-center gap-1 transition cursor-pointer disabled:opacity-50"
                          >
                            <FastForward className="w-3.5 h-3.5 shrink-0" />
                            <span className="truncate">
                              {shiftingInvoiceId === inv.id ? 'Shifting...' : 'Shift Next Mo'}
                            </span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleSendInvoiceWhatsApp(inv)}
                          className="flex-1 min-w-0 py-2 px-3 bg-emerald-950/60 hover:bg-emerald-900/70 text-emerald-300 border border-emerald-700/60 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer"
                        >
                          <Send className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">WA Receipt</span>
                        </button>
                        {perms.edit_delete_invoice && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleOpenEditModal(inv)}
                              className="p-2 bg-slate-800 hover:bg-slate-700 text-cyan-400 border border-slate-700 rounded-xl transition cursor-pointer shrink-0"
                              title="Edit Invoice Details"
                            >
                              <Edit2 className="w-4 h-4" />
                              <span className="sr-only">Edit Invoice</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setDeleteInvoiceError(null);
                                setInvoiceToDelete(inv);
                              }}
                              className="p-2 bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-800 rounded-xl transition cursor-pointer shrink-0"
                              title="Delete Invoice"
                            >
                              <Trash2 className="w-4 h-4" />
                              <span className="sr-only">Delete Invoice</span>
                            </button>
                          </>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2 w-full min-w-0">
                      <button
                        type="button"
                        onClick={() => handleSendInvoiceWhatsApp(inv)}
                        className="flex-1 min-w-0 py-2.5 px-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition cursor-pointer shadow"
                      >
                        <Send className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">WA Receipt</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenReceiptModal?.(inv)}
                        className="flex-1 min-w-0 py-2.5 px-3 bg-slate-800 hover:bg-slate-700 text-cyan-400 border border-slate-700 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer"
                      >
                        <Printer className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">Receipt</span>
                      </button>
                      {perms.edit_delete_invoice && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleOpenEditModal(inv)}
                            className="p-2.5 bg-slate-800 hover:bg-slate-700 text-cyan-400 border border-slate-700 rounded-xl transition cursor-pointer shrink-0"
                            title="Edit Invoice Details"
                          >
                            <Edit2 className="w-4 h-4" />
                            <span className="sr-only">Edit Invoice</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setDeleteInvoiceError(null);
                              setInvoiceToDelete(inv);
                            }}
                            className="p-2.5 bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-800 rounded-xl transition cursor-pointer shrink-0"
                            title="Delete Invoice"
                          >
                            <Trash2 className="w-4 h-4" />
                            <span className="sr-only">Delete Invoice</span>
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Desktop Invoices Table (>= 768px) */}
      <div className="hidden md:block rounded-xl border border-slate-800 bg-[#111A2E] overflow-hidden shadow-lg">
        <div className="overflow-x-auto">
          <table className="hidden md:table w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-900/80 text-xs uppercase tracking-wider text-slate-400 border-b border-slate-800">
              <tr>
                {canBulkReceive && (
                  <th className="py-3 px-3 w-10 text-center">
                    <input
                      type="checkbox"
                      checked={allUnpaidSelected}
                      disabled={selectableUnpaidInvoices.length === 0}
                      onChange={toggleSelectAllInvoices}
                      title="Select All Unpaid Invoices"
                      aria-label="Select All Unpaid Invoices"
                      className="w-4 h-4 rounded border-slate-600 bg-slate-900 text-emerald-500 focus:ring-emerald-500 cursor-pointer disabled:opacity-30"
                    />
                  </th>
                )}
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
                  <td colSpan={canBulkReceive ? 8 : 7} className="py-12 text-center text-slate-500">
                    <FileText className="w-10 h-10 text-slate-600 mx-auto mb-2 opacity-50" />
                    <p className="text-base font-semibold text-slate-400">No invoices found</p>
                    <p className="text-xs text-slate-500 mt-1">
                      Click &quot;+ Generate Invoice&quot; to create an invoice in Supabase PostgreSQL.
                    </p>
                  </td>
                </tr>
              ) : (
                filteredInvoices.map((inv) => {
                  const totalAmount = Number(inv.amount || 0);
                  const alreadyPaid = Number(inv.paid_amount || 0);
                  const balanceDue = Math.max(0, totalAmount - alreadyPaid);
                  const displayStatus = balanceDue === 0 ? 'PAID' : (inv.status || 'DUE').toUpperCase();
                  const isPartial = displayStatus === 'PARTIAL';
                  const isSelectable = balanceDue > 0 && displayStatus !== 'PAID';
                  const isChecked = Boolean(isSelectable && selectedInvoiceIds[inv.id]);
                  const clientMatch = clientByUsername[(inv.subscriber_username || '').trim().toLowerCase()] || null;
                  const isPaidRow = displayStatus === 'PAID' || balanceDue <= 0;
                  const hasGrace = !isPaidRow && hasSubscriberActiveGrace(clientMatch);
                  const graceIso = hasGrace ? getSubscriberGraceUntilIso(clientMatch) : null;
                  const isShifted = !isPaidRow && isSubscriberShiftedNextMonth(clientMatch, inv);

                  return (
                    <tr
                      key={inv.id}
                      className={`transition ${
                        isChecked ? 'bg-emerald-950/20 hover:bg-emerald-950/30' : 'hover:bg-slate-800/30'
                      }`}
                    >
                      {canBulkReceive && (
                        <td className="py-3 px-3 text-center">
                          {isSelectable ? (
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleSelectOneInvoice(inv.id)}
                              aria-label={`Select invoice ${inv.invoice_no}`}
                              className="w-4 h-4 rounded border-slate-600 bg-slate-900 text-emerald-500 focus:ring-emerald-500 cursor-pointer"
                            />
                          ) : (
                            <Check className="w-3.5 h-3.5 text-emerald-600/60 mx-auto" />
                          )}
                        </td>
                      )}
                      <td className="py-3 px-4 font-mono font-semibold text-cyan-400">{inv.invoice_no}</td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-white">@{inv.subscriber_username}</div>
                        <div className="text-xs text-slate-500">
                          Monthly (Day {inv.cycle_day || 'Auto'})
                          {(inv.package_profile || inv.package_name) && (
                            <span className="ml-1.5 font-mono text-cyan-400">
                              • {inv.package_profile || inv.package_name}
                            </span>
                          )}
                        </div>
                        {(hasGrace || isShifted) && (
                          <div className="flex flex-wrap items-center gap-1.5 mt-1">
                            {hasGrace && (
                              <span className="px-1.5 py-0.5 rounded bg-cyan-950 border border-cyan-700 text-cyan-300 font-mono text-[10px] font-bold">
                                ⏳ Grace until {graceIso ? formatShortGraceDate(graceIso) : 'Active'}
                              </span>
                            )}
                            {isShifted && (
                              <span className="px-1.5 py-0.5 rounded bg-indigo-950 border border-indigo-700 text-indigo-300 font-mono text-[10px] font-bold">
                                ⏭ Shifted Next Month
                              </span>
                            )}
                          </div>
                        )}
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
                              {perms.collect_fee && (
                                <button
                                  type="button"
                                  onClick={() => handleOpenMarkPaid(inv)}
                                  className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg text-xs flex items-center gap-1 transition active:scale-95 shadow cursor-pointer"
                                  title="Record Payment & Credit Field Agent"
                                >
                                  <DollarSign className="w-3.5 h-3.5" />
                                  <span>{isPartial ? 'Add Payment' : 'Mark Paid'}</span>
                                </button>
                              )}
                              {canUseGraceAndShift && (
                                <button
                                  type="button"
                                  disabled={shiftingInvoiceId === inv.id}
                                  onClick={() => handleShiftInvoiceNextMonth(inv)}
                                  className="px-2 py-1.5 bg-indigo-950/70 hover:bg-indigo-900/80 text-indigo-300 border border-indigo-700/70 rounded-lg text-xs font-semibold flex items-center gap-1 transition cursor-pointer disabled:opacity-50"
                                  title="Shift bill to next calendar month & exempt from expiry pool"
                                >
                                  <FastForward className="w-3 h-3" />
                                  <span>{shiftingInvoiceId === inv.id ? 'Shifting...' : 'Shift Next Mo'}</span>
                                </button>
                              )}
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

                          {/* Edit Invoice Button (RBAC edit_delete_invoice) */}
                          {perms.edit_delete_invoice && (
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

                          {/* Delete Invoice Button (RBAC edit_delete_invoice) */}
                          {perms.edit_delete_invoice && (
                            <button
                              type="button"
                              onClick={() => {
                                setDeleteInvoiceError(null);
                                setInvoiceToDelete(inv);
                              }}
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

      {/* Field Agents Cash Overview (Strictly Isolated per Master ISP / Dealer / Sub-Dealer) */}
      <div className="p-4 rounded-xl border border-slate-800 bg-[#111A2E]">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Users className="w-4 h-4 text-purple-400 shrink-0" />
            <span>
              {resellerScope.isIsolated
                ? 'My Field Agent Cash Recovery & Payroll Status'
                : 'Field Agent Cash Recovery & Payroll Status (Live portal_users)'}
            </span>
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            {!resellerScope.isIsolated && allResellers.length > 0 && (
              <select
                value={staffOwnerFilter}
                onChange={(e) => setStaffOwnerFilter(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-slate-200 text-[11px] font-mono focus:outline-none focus:border-cyan-500"
                title="Filter Field Agents by Owner"
              >
                <option value="DIRECT_ISP">Master ISP Agents (Direct)</option>
                <option value="ALL">All Agents (Master + Resellers)</option>
                {allResellers
                  .filter((r) => getResellerTier(r) === 'DEALER')
                  .map((d) => (
                    <React.Fragment key={d.id}>
                      <option value={d.id}>
                        [Dealer] {d.full_name || d.username} (@{d.username})
                      </option>
                      {allResellers
                        .filter((s) => s.parent_dealer_id === d.id)
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            &nbsp;&nbsp;↳ [Sub-Dealer] {s.full_name || s.username} (@{s.username})
                          </option>
                        ))}
                    </React.Fragment>
                  ))}
              </select>
            )}
            <span className="text-[11px] font-mono text-slate-400">
              {scopedLiveFieldStaff.length} Active Staff
            </span>
            <button
              type="button"
              onClick={() => setIsAddFieldAgentModalOpen(true)}
              className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition cursor-pointer shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{resellerScope.isIsolated ? '+ Add My Field Agent' : '+ Add Field Agent'}</span>
            </button>
          </div>
        </div>
        {scopedLiveFieldStaff.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-400 bg-slate-900/50 rounded-lg border border-slate-800 space-y-3">
            <div className="font-mono text-slate-300">
              {resellerScope.isIsolated
                ? 'You have not added any Field Recovery Agents yet.'
                : 'No active field staff found for this selection.'}
            </div>
            <p className="text-[11px] text-slate-500 max-w-md mx-auto">
              {resellerScope.isIsolated
                ? 'Add your own field recovery agents to track their cash-in-hand, collections, and assign them to your subscriber invoices.'
                : 'Create a new field recovery agent or switch the owner filter above.'}
            </p>
            <div>
              <button
                type="button"
                onClick={() => setIsAddFieldAgentModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs transition cursor-pointer shadow-md shadow-cyan-950/40"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{resellerScope.isIsolated ? '+ Add My Field Agent' : '+ Add Field Agent'}</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
            {scopedLiveFieldStaff.map((ag) => (
              <div key={ag.id} className="p-3.5 bg-slate-900/80 rounded-lg border border-slate-800 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-white text-sm truncate">{ag.name}</div>
                    <div className="text-[11px] text-slate-400 font-mono truncate">
                      @{ag.username} · {ag.assignedArea}
                    </div>
                  </div>
                  <span className="px-1.5 py-0.5 rounded bg-slate-800 text-cyan-300 border border-slate-700 font-mono text-[10px] shrink-0">
                    {ag.role}
                  </span>
                </div>

                <div className="pt-2 border-t border-slate-800/80 space-y-1 font-mono text-[11px] tabular-nums">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Cash in Hand:</span>
                    <span className="font-bold text-cyan-400">{formatCurrency(ag.cashInHand)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Advance Balance:</span>
                    <span className="text-amber-400">{formatCurrency(ag.advanceBalance)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Base Salary:</span>
                    <span className="text-white">{formatCurrency(ag.baseSalary)}</span>
                  </div>
                  <div className="flex justify-between pt-1 border-t border-slate-800/80 font-bold">
                    <span className="text-slate-300">Net Payable:</span>
                    <span className="text-emerald-400">{formatCurrency(ag.netPayable)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal: + Add Scoped Field Agent */}
      <AddScopedFieldAgentModal
        isOpen={isAddFieldAgentModalOpen}
        onClose={() => setIsAddFieldAgentModalOpen(false)}
        currentUser={currentUser}
        onSuccess={(created) => {
          setActionNotice(`Field Agent ${created.full_name} (@${created.username}) added to your team.`);
          setTimeout(() => setActionNotice(null), 6000);
          void fetchInvoices();
        }}
      />

      {/* Modal: + Generate Invoice */}
      <CreateInvoiceModal
        isOpen={isGenerateModalOpen}
        onClose={() => setIsGenerateModalOpen(false)}
        onSuccess={() => {
          setActionNotice('Invoice created successfully');
          fetchInvoices();
        }}
      />

      {/* Modal: Record Payment / Mark Paid (Portal to document.body for mobile viewport lock) */}
      {isMarkPaidModalOpen &&
        selectedInvoice &&
        typeof document !== 'undefined' &&
        (() => {
          const alreadyPaid = Number(selectedInvoice.paid_amount) || 0;
          const totalAmount = Number(selectedInvoice.amount) || 0;
          const remainingDue = Math.max(0, totalAmount - alreadyPaid);
          const enteredVal = Number(paymentReceivedInput) || 0;
          const projectedTotalPaid = alreadyPaid + enteredVal;
          const willBeFullyPaid = projectedTotalPaid >= totalAmount;

          return ReactDOM.createPortal(
            <div
              style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                width: '100vw',
                height: '100dvh',
                zIndex: 999999,
              }}
              className="bg-black/85 backdrop-blur-sm flex items-center justify-center p-3 overflow-y-auto font-sans"
            >
              <div
                style={{ width: '100%', maxWidth: '390px', maxHeight: '88dvh' }}
                className="mobile-safe-modal overflow-y-auto overflow-x-hidden rounded-2xl p-4 box-border mx-auto bg-[#111A2E] border border-slate-700 shadow-2xl relative"
              >
                <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-800 w-full min-w-0">
                  <h2 className="text-base font-bold text-white flex items-center gap-2 min-w-0 truncate">
                    <DollarSign className="w-5 h-5 text-emerald-400 shrink-0" />
                    <span className="truncate">Record Payment &amp; Arrears</span>
                  </h2>
                  <button
                    type="button"
                    onClick={() => setIsMarkPaidModalOpen(false)}
                    className="text-slate-400 hover:text-white transition p-1 shrink-0 cursor-pointer"
                    aria-label="Close modal"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="space-y-3.5 mt-3.5 w-full min-w-0">
                  {/* Financial Summary */}
                  <div className="p-3 bg-slate-900 rounded-xl border border-slate-800 space-y-1.5 w-full min-w-0">
                    <div className="flex justify-between items-center gap-2 text-xs w-full min-w-0">
                      <span className="text-slate-400 shrink-0">Invoice No:</span>
                      <span className="text-cyan-400 font-mono font-bold truncate">
                        #{selectedInvoice.invoice_no}
                      </span>
                    </div>
                    <div className="flex justify-between items-center gap-2 text-xs w-full min-w-0">
                      <span className="text-slate-400 shrink-0">Subscriber:</span>
                      <span className="text-white font-semibold truncate">
                        @{selectedInvoice.subscriber_username}
                      </span>
                    </div>
                    <div className="pt-1.5 border-t border-slate-800/80 flex justify-between items-center gap-2 text-xs w-full min-w-0">
                      <span className="text-slate-400 shrink-0">Total Amount:</span>
                      <span className="text-white font-mono font-bold">
                        {formatCurrency(totalAmount)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center gap-2 text-xs w-full min-w-0">
                      <span className="text-slate-400 shrink-0">Already Paid:</span>
                      <span className="text-emerald-400 font-mono font-semibold">
                        {formatCurrency(alreadyPaid)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center gap-2 text-sm font-semibold w-full min-w-0">
                      <span className="text-amber-300 shrink-0">Remaining Due:</span>
                      <span className="text-amber-400 font-mono font-bold text-base">
                        {formatCurrency(remainingDue)}
                      </span>
                    </div>
                  </div>

                  {/* Payment Input Field */}
                  <div className="w-full min-w-0">
                    <div className="flex flex-wrap justify-between items-center gap-1 mb-1 w-full min-w-0">
                      <label className="text-xs font-medium text-slate-300">
                        Payment Received (Rs.)
                      </label>
                      <button
                        type="button"
                        onClick={() => setPaymentReceivedInput(remainingDue)}
                        className="text-cyan-400 hover:text-cyan-300 text-xs underline cursor-pointer"
                      >
                        Fill Full ({formatCurrency(remainingDue)})
                      </button>
                    </div>
                    <div className="relative w-full min-w-0">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 font-mono text-sm">
                        Rs.
                      </span>
                      <input
                        type="number"
                        min="1"
                        step="any"
                        value={paymentReceivedInput}
                        onChange={(e) => setPaymentReceivedInput(e.target.value)}
                        placeholder={`Default: ${remainingDue}`}
                        className="w-full min-w-0 pl-10 pr-3 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white font-mono text-base focus:outline-none focus:border-cyan-500"
                      />
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-1 text-xs mt-1.5 px-0.5 w-full min-w-0">
                      <span className="text-slate-400">
                        Status:{' '}
                        <span
                          className={`font-bold ${
                            willBeFullyPaid ? 'text-emerald-400' : 'text-amber-400'
                          }`}
                        >
                          {willBeFullyPaid ? 'PAID (Settled)' : 'PARTIAL'}
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
                  <div className="w-full min-w-0">
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Collecting Field Agent (Credits Cash-in-Hand)
                    </label>
                    <select
                      value={collectingAgentId}
                      onChange={(e) => setCollectingAgentId(e.target.value)}
                      className="w-full min-w-0 px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-base text-white focus:outline-none focus:border-cyan-500"
                    >
                      <option value="">{resellerScope.isIsolated ? '-- Direct Self / Counter Collection --' : '-- Direct NOC Collection --'}</option>
                      {scopedPortalAgents.map((ag) => (
                        <option key={ag.id} value={ag.id}>
                          {ag.full_name} ({ag.area || 'Field'})
                        </option>
                      ))}
                    </select>
                    <p className="text-[11px] text-slate-500 mt-1 leading-snug">
                      Credits agent&apos;s cash-in-hand by{' '}
                      <span className="text-emerald-400 font-mono font-bold">
                        {formatCurrency(Number(paymentReceivedInput) || 0)}
                      </span>
                      .
                    </p>
                  </div>

                  {/* Payment Method */}
                  <div className="w-full min-w-0">
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Payment Method
                    </label>
                    <select
                      value={paidPaymentMethod}
                      onChange={(e) => setPaidPaymentMethod(e.target.value)}
                      className="w-full min-w-0 px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-base text-white focus:outline-none focus:border-cyan-500"
                    >
                      <option value="Cash Handover">Cash Handover</option>
                      <option value="JazzCash">JazzCash</option>
                      <option value="EasyPaisa">EasyPaisa</option>
                      <option value="Bank Transfer">Bank Transfer</option>
                    </select>
                  </div>

                  {willBeFullyPaid && (
                    <ResellerWalletGatePreview
                      subscriberUsername={selectedInvoice.subscriber_username}
                      profileName={
                        selectedInvoice.package_profile ||
                        selectedInvoice.package_name ||
                        clientByUsername[(selectedInvoice.subscriber_username || '').trim().toLowerCase()]
                          ?.original_package_profile ||
                        clientByUsername[(selectedInvoice.subscriber_username || '').trim().toLowerCase()]
                          ?.package_profile_name ||
                        clientByUsername[(selectedInvoice.subscriber_username || '').trim().toLowerCase()]
                          ?.package_speed ||
                        ''
                      }
                      actionLabel="renewal"
                      compact
                      onStatusChange={setMarkPaidWalletStatus}
                    />
                  )}

                  {markPaidError && (
                    <div className="rounded-xl border border-rose-500/70 bg-rose-950/90 px-3 py-2.5 text-xs font-semibold text-rose-200 flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                      <span>{markPaidError}</span>
                    </div>
                  )}

                  <div className="flex flex-col gap-2 pt-3 border-t border-slate-800 w-full min-w-0">
                    <button
                      type="button"
                      onClick={handleConfirmMarkPaid}
                      disabled={
                        isSubmitting ||
                        Number(paymentReceivedInput) <= 0 ||
                        Boolean(willBeFullyPaid && markPaidWalletStatus?.blocked)
                      }
                      className="w-full min-w-0 py-3 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl text-base transition shadow-sm flex items-center justify-center gap-2 cursor-pointer"
                    >
                      {isSubmitting ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
                          <span>Recording Payment...</span>
                        </>
                      ) : willBeFullyPaid && markPaidWalletStatus?.blocked ? (
                        <>
                          <AlertTriangle className="w-4 h-4 shrink-0" />
                          <span>Wallet Payment Gate Blocked</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-4 h-4 shrink-0" />
                          <span>Confirm &amp; Save Payment</span>
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsMarkPaidModalOpen(false)}
                      className="w-full min-w-0 py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-base font-medium transition cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            </div>,
            document.body
          );
        })()}

      {/* Modal: Edit Invoice */}
      {isEditModalOpen &&
        invoiceToEdit &&
        typeof document !== 'undefined' &&
        ReactDOM.createPortal(
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              width: '100vw',
              height: '100dvh',
              zIndex: 999999,
            }}
            className="bg-black/85 backdrop-blur-sm flex items-center justify-center p-3 overflow-y-auto font-sans"
          >
            <div
              style={{ width: '100%', maxWidth: '390px', maxHeight: '88dvh' }}
              className="mobile-safe-modal overflow-y-auto overflow-x-hidden rounded-2xl p-4 box-border mx-auto bg-[#111A2E] border border-slate-700 shadow-2xl relative"
            >
              <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-800 w-full min-w-0">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="p-2 bg-indigo-950 border border-indigo-700/60 text-indigo-400 rounded-xl shrink-0">
                    <Edit2 className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-base font-bold text-white truncate">Edit Invoice Details</h2>
                    <p className="text-xs text-slate-400 font-mono truncate">
                      Invoice #{invoiceToEdit.invoice_no}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsEditModalOpen(false);
                    setInvoiceToEdit(null);
                  }}
                  className="text-slate-400 hover:text-white transition shrink-0"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleUpdateInvoice} className="space-y-3.5 mt-4 w-full min-w-0">
                <div className="w-full min-w-0">
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Subscriber Username
                  </label>
                  <input
                    type="text"
                    disabled
                    value={`@${invoiceToEdit.subscriber_username}`}
                    className="w-full min-w-0 px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-base text-slate-400 font-mono cursor-not-allowed"
                  />
                </div>

                <div className="w-full min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <label className="block text-xs font-medium text-slate-300">
                      Package Plan (Live MikroTik PPPoE Profile)
                    </label>
                    {isLoadingMkProfiles && (
                      <span className="text-[10px] font-mono text-cyan-400 animate-pulse">
                        Syncing RouterOS...
                      </span>
                    )}
                  </div>
                  <select
                    value={editPackageProfile}
                    onChange={(e) => {
                      const nextProf = e.target.value;
                      setEditPackageProfile(nextProf);
                      const matchedOpt = editModalPlanOptions.find(
                        (opt) => opt.profileName === nextProf
                      );
                      if (matchedOpt && matchedOpt.pricePkr > 0) {
                        setEditAmount(matchedOpt.pricePkr);
                      }
                    }}
                    className="w-full min-w-0 px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-sm text-white font-mono focus:outline-none focus:border-cyan-500"
                  >
                    {editModalPlanOptions.length === 0 ? (
                      <option value="">
                        {isLoadingMkProfiles
                          ? 'Loading live MikroTik profiles...'
                          : 'No live MikroTik profiles found'}
                      </option>
                    ) : (
                      editModalPlanOptions.map((opt) => (
                        <option key={opt.profileName} value={opt.profileName}>
                          {opt.profileName} ({formatCurrency(opt.pricePkr, 0)}/mo)
                          {opt.rateLimit ? ` • ${opt.rateLimit}` : ''}
                        </option>
                      ))
                    )}
                  </select>
                  {editDetectedMkProfile && (
                    <p className="text-[11px] font-mono text-cyan-300/90 mt-1">
                      MikroTik Secret Profile: <strong>{editDetectedMkProfile}</strong>
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full min-w-0">
                  <div className="w-full min-w-0">
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Amount (PKR)
                    </label>
                    <input
                      type="number"
                      required
                      min="0"
                      step="50"
                      value={editAmount}
                      onChange={(e) => setEditAmount(Number(e.target.value))}
                      className="w-full min-w-0 px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-base text-white font-mono focus:outline-none focus:border-cyan-500"
                    />
                  </div>

                  <div className="w-full min-w-0">
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Billing Cycle Day
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="31"
                      value={editCycleDay}
                      onChange={(e) => setEditCycleDay(Number(e.target.value))}
                      className="w-full min-w-0 px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-base text-white font-mono focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full min-w-0">
                  <div className="w-full min-w-0">
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Due Date
                    </label>
                    <input
                      type="date"
                      required
                      value={editDueDate}
                      onChange={(e) => setEditDueDate(e.target.value)}
                      className="w-full min-w-0 px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-base text-white focus:outline-none focus:border-cyan-500"
                    />
                  </div>

                  <div className="w-full min-w-0">
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Payment Status
                    </label>
                    <select
                      value={editStatus}
                      onChange={(e) => setEditStatus(e.target.value as any)}
                      className="w-full min-w-0 px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-base text-white focus:outline-none focus:border-cyan-500"
                    >
                      <option value="DUE">DUE</option>
                      <option value="PARTIAL">PARTIAL</option>
                      <option value="PAID">PAID</option>
                      <option value="OVERDUE">OVERDUE</option>
                    </select>
                  </div>
                </div>

                <div className="w-full min-w-0">
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Assigned Field Recovery Agent
                  </label>
                  <select
                    value={editAssignedAgentId}
                    onChange={(e) => setEditAssignedAgentId(e.target.value)}
                    className="w-full min-w-0 px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-base text-white focus:outline-none focus:border-cyan-500"
                  >
                    <option value="">-- Unassigned --</option>
                    {scopedPortalAgents.map((ag) => (
                      <option key={ag.id} value={ag.id}>
                        {ag.full_name} ({ag.area || 'Field'})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="w-full min-w-0">
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Notes
                  </label>
                  <textarea
                    rows={2}
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    placeholder="Optional billing adjustment remark..."
                    className="w-full min-w-0 px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-cyan-500"
                  />
                </div>

                {editStatus === 'PAID' && (
                  <ResellerWalletGatePreview
                    subscriberUsername={invoiceToEdit.subscriber_username}
                    profileName={
                      editPackageProfile ||
                      invoiceToEdit.package_profile ||
                      invoiceToEdit.package_name ||
                      ''
                    }
                    actionLabel="renewal"
                    compact
                    onStatusChange={setEditInvoiceWalletStatus}
                  />
                )}

                {editInvoiceError && (
                  <div className="rounded-xl border border-rose-500/70 bg-rose-950/90 px-3 py-2.5 text-xs font-semibold text-rose-200 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                    <span>{editInvoiceError}</span>
                  </div>
                )}

                <div className="flex flex-col gap-2 pt-3 border-t border-slate-800 w-full min-w-0">
                  <button
                    type="submit"
                    disabled={
                      isSubmitting ||
                      Boolean(editStatus === 'PAID' && editInvoiceWalletStatus?.blocked)
                    }
                    className="w-full min-w-0 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl text-base transition shadow-lg flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    {isSubmitting ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Saving...</span>
                      </>
                    ) : editStatus === 'PAID' && editInvoiceWalletStatus?.blocked ? (
                      <>
                        <AlertTriangle className="w-4 h-4" />
                        <span>Wallet Payment Gate Blocked</span>
                      </>
                    ) : (
                      <span>Save Changes</span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditModalOpen(false);
                      setInvoiceToEdit(null);
                    }}
                    className="w-full min-w-0 py-2 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-base transition cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}

      {/* Modal: Delete Invoice Confirmation */}
      {invoiceToDelete &&
        typeof document !== 'undefined' &&
        ReactDOM.createPortal(
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              width: '100vw',
              height: '100dvh',
              zIndex: 999999,
            }}
            className="bg-black/85 backdrop-blur-sm flex items-center justify-center p-3 overflow-y-auto font-sans"
          >
            <div
              style={{ width: '100%', maxWidth: '390px', maxHeight: '88dvh' }}
              className="mobile-safe-modal overflow-y-auto overflow-x-hidden rounded-2xl p-4 box-border mx-auto bg-[#111A2E] border border-rose-800/80 shadow-2xl relative space-y-4"
            >
              <div className="flex items-center gap-3 w-full min-w-0">
                <div className="p-3 bg-rose-950/90 border border-rose-700 text-rose-400 rounded-xl shrink-0">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-white">Delete Invoice?</h3>
                  <p className="text-xs text-rose-300 font-mono truncate">
                    Invoice #{invoiceToDelete.invoice_no}
                  </p>
                </div>
              </div>

              <p className="text-sm text-slate-300 leading-relaxed">
                Are you sure you want to permanently delete Invoice{' '}
                <strong className="text-white font-mono">#{invoiceToDelete.invoice_no}</strong> for{' '}
                <strong className="text-cyan-300">@{invoiceToDelete.subscriber_username}</strong> (
                {formatCurrency(Number(invoiceToDelete.amount) || 0)})?
              </p>

              {(() => {
                const linkedCount = paymentTransactions.filter(
                  (tx) => tx.invoice_id === invoiceToDelete.id
                ).length;
                if (linkedCount === 0) return null;
                return (
                  <label className="flex items-start gap-2.5 p-3 rounded-xl bg-rose-950/35 border border-rose-800/60 cursor-pointer text-xs">
                    <input
                      type="checkbox"
                      checked={deleteLinkedPayments}
                      onChange={(e) => setDeleteLinkedPayments(e.target.checked)}
                      className="mt-0.5 w-4 h-4 rounded bg-slate-900 border-slate-700 text-rose-600 cursor-pointer"
                    />
                    <span className="text-rose-200 leading-relaxed">
                      Also delete <strong>{linkedCount}</strong> linked receipt(s) from{' '}
                      <code className="text-cyan-300">payment_transactions</code> to keep balances accurate.
                    </span>
                  </label>
                );
              })()}

              {deleteInvoiceError && (
                <div className="rounded-xl border border-rose-500/70 bg-rose-950/90 px-3 py-2.5 text-xs font-semibold text-rose-200 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <span>{deleteInvoiceError}</span>
                </div>
              )}

              <div className="flex flex-col gap-2 pt-3 border-t border-slate-800 w-full min-w-0">
                <button
                  type="button"
                  onClick={handleDeleteInvoice}
                  disabled={isSubmitting}
                  className="w-full min-w-0 py-2.5 px-4 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl text-base transition flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  {isSubmitting ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Deleting...</span>
                    </>
                  ) : (
                    <span>Delete Permanently</span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDeleteInvoiceError(null);
                    setInvoiceToDelete(null);
                  }}
                  className="w-full min-w-0 py-2 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-base font-semibold transition cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* Bulk Receive Amount Confirmation Modal */}
      <BulkReceiveAmountModal
        isOpen={isBulkReceiveModalOpen}
        onClose={() => !isBulkReceiving && setIsBulkReceiveModalOpen(false)}
        title="Bulk Receive Invoice Payments"
        itemLabel="Invoices"
        previewRows={selectedInvoices.map((inv) => ({
          key: inv.id,
          username: inv.subscriber_username,
          label: `#${inv.invoice_no} (Due ${inv.due_date})`,
          amount: Math.max(0, (Number(inv.amount) || 0) - (Number(inv.paid_amount) || 0)),
        }))}
        totalAmount={selectedInvoicesTotal}
        agents={bulkAgentOptions}
        isProcessing={isBulkReceiving}
        progressLabel={bulkReceiveProgress}
        onConfirm={handleConfirmBulkReceive}
      />

      {/* Payment Accounts & WhatsApp Billing Center Drawer */}
      <WhatsAppBillingCenter
        isOpen={isPaymentAccountsOpen}
        onClose={() => setIsPaymentAccountsOpen(false)}
        initialAccounts={paymentAccounts}
        initialConfig={whatsappConfig}
        onAccountsOrConfigChanged={(updatedAccounts, updatedConfig) => {
          setPaymentAccounts(updatedAccounts);
          setWhatsappConfig(updatedConfig);
        }}
      />
    </div>
  );
};

export default BillingView;
