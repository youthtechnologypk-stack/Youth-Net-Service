import React, { useState, useEffect, useMemo } from 'react';
import {
  Smartphone,
  CheckCircle2,
  DollarSign,
  AlertTriangle,
  Phone,
  MapPin,
  Send,
  Zap,
  Radio,
  Clock,
  ShieldCheck,
  Search,
  ArrowRight,
  Sparkles,
  Users,
  Lock,
  RefreshCw,
  X,
  Receipt,
  CreditCard,
  FileText,
  Check,
} from 'lucide-react';
import { useISP } from '../context/ISPContext';
import { useCurrency } from '../context/CurrencyContext';
import { UserAccount } from '../types/auth';
import { Invoice } from '../types/isp';
import { FeatureGate } from './FeatureGate';
import { PWAInstallPrompt } from './PWAInstallPrompt';
import { FiberGisMapView } from './FiberGisMapView';
import {
  supabase,
  SupabaseInvoice,
  SupabaseTicket,
  SupabaseAgentCashTransaction,
  SupabasePaymentAccount,
  SupabaseWhatsappBillingConfig,
} from '../services/supabaseClient';
import { restoreSubscriberOnInvoicePaid, add31DaysDateString } from '../lib/billingAndNetwork';
import {
  DEFAULT_SUPPORT_WHATSAPP,
  WHATSAPP_CONFIG_UPDATED_EVENT,
  buildInstantPaymentReceiptMessage,
  buildPreExpiryReminderMessage,
  computeDaysUntilDate,
  fetchPaymentAccounts,
  fetchWhatsappBillingConfig,
  getDefaultWhatsappConfig,
  openWhatsAppLink,
  formatTelPhone,
} from '../lib/whatsappBilling';
import {
  offlineSyncManager,
  isLikelyNetworkError,
  isOfflineCapableRole,
} from '../services/OfflineSyncManager';

interface FieldAgentPortalProps {
  currentUser: UserAccount;
  onOpenReceiptModal?: (invoice: Invoice) => void;
  onOpenPaymentModal?: (invoice: Invoice) => void;
}

export const FieldAgentPortal: React.FC<FieldAgentPortalProps> = ({
  currentUser,
  onOpenReceiptModal,
  onOpenPaymentModal,
}) => {
  const {
    customers,
    onus,
    collectAgentCashPayment,
    resolveTicket,
  } = useISP();
  const { formatCurrency, currencySymbol } = useCurrency();

  const [activeTab, setActiveTab] = useState<'tickets' | 'collections' | 'ledger' | 'ont_checker' | 'directory' | 'fiber_gis'>('tickets');
  const [collectionSuccessToast, setCollectionSuccessToast] = useState<string | null>(null);
  const [ontSearchQuery, setOntSearchQuery] = useState('');
  const [dirSearchQuery, setDirSearchQuery] = useState('');

  // Agent dynamic state from Supabase
  const [agentCash, setAgentCash] = useState<number>(Number(currentUser.cashInHand || 0));
  const [agentBaseSalary, setAgentBaseSalary] = useState<number>(Number(currentUser.base_salary ?? 0));
  const [agentAdvanceBalance, setAgentAdvanceBalance] = useState<number>(Number(currentUser.advance_balance || 0));
  const [agentCashTransactions, setAgentCashTransactions] = useState<SupabaseAgentCashTransaction[]>([]);
  const [assignedTickets, setAssignedTickets] = useState<SupabaseTicket[]>([]);
  const [assignedInvoices, setAssignedInvoices] = useState<SupabaseInvoice[]>([]);
  const [subscriberDirectory, setSubscriberDirectory] = useState<Record<string, { phone?: string; address?: string; full_name?: string; area?: string; package_speed?: string }>>({});
  const [paymentAccounts, setPaymentAccounts] = useState<SupabasePaymentAccount[]>([]);
  const [whatsappConfig, setWhatsappConfig] = useState<SupabaseWhatsappBillingConfig>(() => getDefaultWhatsappConfig());
  const [lastCollectedReceipt, setLastCollectedReceipt] = useState<{
    phone: string;
    fullName: string;
    username: string;
    invoiceNo: string;
    amountPaid: number;
    totalAmount: number;
    remainingBalance: number;
    nextExpiryDate: string;
  } | null>(null);
  const [isLoadingData, setIsLoadingData] = useState<boolean>(true);
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const resolvedAgentIdRef = React.useRef<string>(currentUser.id);

  // Modal State for Cash Collection
  const [isCollectModalOpen, setIsCollectModalOpen] = useState<boolean>(false);
  const [selectedInvForCollection, setSelectedInvForCollection] = useState<SupabaseInvoice | null>(null);
  const [collectionAmountInput, setCollectionAmountInput] = useState<number | string>('');
  const [isSubmittingCollection, setIsSubmittingCollection] = useState<boolean>(false);

  const showNoticeToast = (msg: string, durationMs = 6000) => {
    setCollectionSuccessToast(msg);
    setTimeout(() => {
      setCollectionSuccessToast((prev) => (prev === msg ? null : prev));
    }, durationMs);
  };

  const applyCachedOfflineSnapshot = (agentIdToLoad: string) => {
    const cached = offlineSyncManager.getCachedAgentSnapshot(agentIdToLoad, currentUser.role);
    if (!cached) return false;
    setAssignedTickets(cached.tickets);
    setAssignedInvoices(cached.invoices);
    setSubscriberDirectory(cached.subscribers);
    setAgentCash(cached.wallet.cashInHand);
    setAgentBaseSalary(cached.wallet.baseSalary);
    setAgentAdvanceBalance(cached.wallet.advanceBalance);
    setAgentCashTransactions(cached.wallet.cashTransactions);
    return true;
  };

  // Fetch this specific agent's live data from Supabase (with automatic offline cache fallback)
  const fetchAgentData = async () => {
    setIsLoadingData(true);
    try {
      const effectiveId = resolvedAgentIdRef.current || currentUser.id;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        applyCachedOfflineSnapshot(effectiveId);
        return;
      }

      // 1. Fetch agent's latest cash_in_hand, advance_balance, base_salary from portal_users
      let { data: userRow, error: userErr } = await supabase
        .from('portal_users')
        .select('id, cash_in_hand, advance_balance, base_salary, area, full_name')
        .eq('id', currentUser.id)
        .maybeSingle();

      if (userErr && isLikelyNetworkError(userErr)) {
        throw userErr;
      }

      if (!userRow && currentUser.username) {
        const res = await supabase
          .from('portal_users')
          .select('id, cash_in_hand, advance_balance, base_salary, area, full_name')
          .ilike('username', currentUser.username)
          .maybeSingle();
        userRow = res.data;
      }

      const resolvedAgentId = userRow?.id || currentUser.id;
      resolvedAgentIdRef.current = resolvedAgentId;

      const nextBaseSalary =
        userRow?.base_salary !== undefined && userRow?.base_salary !== null
          ? Number(userRow.base_salary) || 0
          : agentBaseSalary;
      const nextAdvanceBal =
        userRow?.advance_balance !== undefined && userRow?.advance_balance !== null
          ? Number(userRow.advance_balance) || 0
          : agentAdvanceBalance;
      const serverCash =
        userRow?.cash_in_hand !== undefined && userRow?.cash_in_hand !== null
          ? Number(userRow.cash_in_hand) || 0
          : agentCash;

      setAgentBaseSalary(nextBaseSalary);
      setAgentAdvanceBalance(nextAdvanceBal);

      // 1b. Fetch cash ledger transactions, assigned tickets, recovery invoices & subscriber directory
      const [
        { data: cashTxns },
        { data: tktData, error: tktErr },
        { data: agentInvoices, error: invErr },
        { data: clientRows },
        loadedAccounts,
        loadedWaConfig,
      ] = await Promise.all([
        supabase
          .from('agent_cash_transactions')
          .select('*')
          .eq('agent_id', resolvedAgentId)
          .order('created_at', { ascending: false }),
        supabase
          .from('tickets')
          .select('*')
          .or(`assigned_agent_id.eq.${resolvedAgentId},assigned_agent_name.ilike.%${currentUser.fullName}%`)
          .order('created_at', { ascending: false }),
        supabase
          .from('invoices')
          .select('*')
          .or(`assigned_agent_id.eq.${resolvedAgentId},assigned_agent_name.ilike.%${currentUser.fullName}%`)
          .order('created_at', { ascending: false }),
        supabase
          .from('portal_users')
          .select('username, full_name, phone, address, area, package_speed')
          .eq('role', 'CLIENT'),
        fetchPaymentAccounts(),
        fetchWhatsappBillingConfig(),
      ]);

      if ((tktErr && isLikelyNetworkError(tktErr)) || (invErr && isLikelyNetworkError(invErr))) {
        throw tktErr || invErr;
      }

      const nextCashTxns = (cashTxns as SupabaseAgentCashTransaction[]) || agentCashTransactions;
      if (cashTxns) {
        setAgentCashTransactions(nextCashTxns);
      }

      let uniqueTickets: SupabaseTicket[] = assignedTickets;
      if (tktData) {
        const seenTicketIds = new Set<string>();
        uniqueTickets = (tktData as SupabaseTicket[]).filter((t) => {
          if (!t?.id || seenTicketIds.has(t.id)) return false;
          seenTicketIds.add(t.id);
          return true;
        });
      }

      const rawInvoices = (agentInvoices as SupabaseInvoice[]) || assignedInvoices;

      let lookup: Record<string, { phone?: string; address?: string; full_name?: string; area?: string; package_speed?: string }> = subscriberDirectory;
      if (clientRows && Array.isArray(clientRows)) {
        const freshLookup: typeof lookup = {};
        clientRows.forEach((c: any) => {
          const uname = (c.username || '').trim().toLowerCase();
          if (uname) {
            freshLookup[uname] = {
              phone: c.phone || '',
              address: c.address || '',
              full_name: c.full_name || '',
              area: c.area || '',
              package_speed: c.package_speed || '',
            };
          }
        });
        lookup = freshLookup;
        setSubscriberDirectory(freshLookup);
      }

      // Role-guarded automatic offline snapshot caching
      if (isOfflineCapableRole(currentUser.role)) {
        offlineSyncManager.cacheAgentSnapshot(resolvedAgentId, currentUser.role, {
          subscribers: lookup,
          invoices: rawInvoices,
          tickets: uniqueTickets,
          wallet: {
            cashInHand: serverCash,
            baseSalary: nextBaseSalary,
            advanceBalance: nextAdvanceBal,
            cashTransactions: nextCashTxns,
          },
        });
      }

      // Overlay any queued offline actions until auto-sync clears them
      const overlaid = offlineSyncManager.applyOutboxOverlay(
        resolvedAgentId,
        currentUser.role,
        {
          invoices: rawInvoices,
          tickets: uniqueTickets,
          cashInHand: serverCash,
        }
      );

      setAssignedTickets(overlaid.tickets);
      setAssignedInvoices(overlaid.invoices);
      setAgentCash(overlaid.cashInHand);
      setPaymentAccounts(loadedAccounts);
      setWhatsappConfig(loadedWaConfig);
    } catch (err) {
      console.warn('FieldAgentPortal fetch error:', err);
      const effectiveId = resolvedAgentIdRef.current || currentUser.id;
      applyCachedOfflineSnapshot(effectiveId);
    } finally {
      setIsLoadingData(false);
    }
  };

  // Automatic Background Sync runner on mount, reconnect, and visibility return
  const runAutoSync = async () => {
    if (!isOfflineCapableRole(currentUser.role)) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

    const effectiveId = resolvedAgentIdRef.current || currentUser.id;
    const res = await offlineSyncManager.autoSyncOutbox(effectiveId, currentUser.role);
    if (res.syncedCount > 0) {
      await fetchAgentData();
      showNoticeToast('✅ 4G/Wi-Fi connected — Offline records synced!', 6000);
    }
  };

  useEffect(() => {
    const initialize = async () => {
      await fetchAgentData();
      if (typeof navigator === 'undefined' || navigator.onLine) {
        await runAutoSync();
      }
    };
    void initialize();

    const handleOnline = () => {
      setIsOnline(true);
      void runAutoSync();
    };
    const handleOffline = () => {
      setIsOnline(false);
    };
    const handleVisibilityChange = () => {
      const onlineNow = typeof navigator === 'undefined' ? true : navigator.onLine;
      setIsOnline(onlineNow);
      if (document.visibilityState === 'visible' && onlineNow) {
        void runAutoSync();
      }
    };
    const handleSwMessage = (event: MessageEvent) => {
      if (event.data?.type === 'AUTO_SYNC_OUTBOX' && navigator.onLine) {
        void runAutoSync();
      }
    };
    const handleWaConfigUpdated = (e: Event) => {
      const detail = (e as CustomEvent)?.detail;
      if (detail) setWhatsappConfig(detail);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener(WHATSAPP_CONFIG_UPDATED_EVENT, handleWaConfigUpdated);
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handleSwMessage);
    }

    // Realtime subscriptions for agent portal
    const channel = supabase
      .channel(`public:agent_${currentUser.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, (payload) => {
        if (payload.eventType === 'INSERT' && payload.new) {
          const newTicket = payload.new as SupabaseTicket;
          const matchesAgent =
            newTicket.assigned_agent_id === currentUser.id ||
            (newTicket.assigned_agent_name || '').toLowerCase().includes((currentUser.fullName || '').toLowerCase());
          if (matchesAgent) {
            setAssignedTickets((prev) =>
              prev.some((t) => t.id === newTicket.id) ? prev : [newTicket, ...prev]
            );
          } else {
            void fetchAgentData();
          }
        } else {
          void fetchAgentData();
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices' }, () => {
        void fetchAgentData();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_accounts' }, () => {
        fetchPaymentAccounts().then(setPaymentAccounts).catch(() => {});
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_cash_transactions' }, () => {
        void fetchAgentData();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'portal_users' }, (payload) => {
        if (payload.new && (payload.new as any).id === currentUser.id) {
          setAgentCash(Number((payload.new as any).cash_in_hand) || 0);
          if ((payload.new as any).advance_balance !== undefined) {
            setAgentAdvanceBalance(Number((payload.new as any).advance_balance) || 0);
          }
          if ((payload.new as any).base_salary !== undefined) {
            setAgentBaseSalary(Number((payload.new as any).base_salary) || 0);
          }
        }
      })
      .subscribe();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener(WHATSAPP_CONFIG_UPDATED_EVENT, handleWaConfigUpdated);
      if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', handleSwMessage);
      }
      void supabase.removeChannel(channel);
    };
  }, [currentUser.id]);

  // Open modal for recording payment
  const handleOpenCollectionModal = (inv: SupabaseInvoice) => {
    const alreadyPaid = Number(inv.paid_amount) || 0;
    const remainingDue = Math.max(0, (Number(inv.amount) || 0) - alreadyPaid);
    if (remainingDue <= 0 || (inv.status || '').toUpperCase() === 'PAID') {
      showNoticeToast('This invoice has already been settled and marked PAID.', 4000);
      return;
    }
    setSelectedInvForCollection(inv);
    setCollectionAmountInput(remainingDue);
    setIsCollectModalOpen(true);
  };

  // Handle direct cash collection with transparent offline saving fallback
  const handleConfirmCollection = async () => {
    if (!selectedInvForCollection) return;
    const enteredVal = Number(collectionAmountInput);
    if (isNaN(enteredVal) || enteredVal <= 0) {
      showNoticeToast('Please enter a valid payment amount greater than 0.', 4000);
      return;
    }

    setIsSubmittingCollection(true);
    const inv = selectedInvForCollection;
    const totalAmount = Number(inv.amount || 0);
    const previousPaid = Number(inv.paid_amount || 0);
    const collectedNow = Number(enteredVal || 0);
    const newPaidTotal = previousPaid + collectedNow;
    const remaining = totalAmount - newPaidTotal;
    const newStatus: 'PAID' | 'PARTIAL' = remaining <= 0 ? 'PAID' : 'PARTIAL';
    const finalPaidAmount = remaining <= 0 ? totalAmount : newPaidTotal;
    const nowIso = new Date().toISOString();
    const nextExpiryDate =
      newStatus === 'PAID' ? add31DaysDateString(new Date()) : inv.due_date || add31DaysDateString(new Date());
    const effectiveAgentId = resolvedAgentIdRef.current || currentUser.id;

    const applyOptimisticAndReceipt = (offlineSaved: boolean) => {
      const subKey = (inv.subscriber_username || '').trim().toLowerCase();
      const subInfo = subscriberDirectory[subKey];
      const subPhone =
        subInfo?.phone ||
        customers.find((c) => c.pppoeUsername?.toLowerCase() === subKey)?.phone ||
        '';

      // Immediately update local UI state to prevent double collection
      setAssignedInvoices((prev) =>
        prev.map((row) =>
          row.id === inv.id
            ? {
                ...row,
                paid_amount: finalPaidAmount,
                status: newStatus,
                paid_at: newStatus === 'PAID' ? nowIso : row.paid_at || null,
                due_date: newStatus === 'PAID' ? nextExpiryDate : row.due_date,
              }
            : row
        )
      );
      setAgentCash((prev) => Number(prev || 0) + enteredVal);

      setLastCollectedReceipt({
        phone: subPhone,
        fullName: subInfo?.full_name || inv.subscriber_username,
        username: inv.subscriber_username,
        invoiceNo: inv.invoice_no,
        amountPaid: enteredVal,
        totalAmount,
        remainingBalance: Math.max(0, totalAmount - finalPaidAmount),
        nextExpiryDate,
      });

      setIsCollectModalOpen(false);
      setSelectedInvForCollection(null);

      if (offlineSaved) {
        showNoticeToast('Saved locally — will auto-sync when 4G/Wi-Fi returns', 6000);
      } else {
        showNoticeToast(
          `Collected ${formatCurrency(enteredVal)} from @${inv.subscriber_username}! Status: ${newStatus}. Credited to Wallet.`,
          8000
        );
      }
    };

    try {
      const isOfflineNow = typeof navigator !== 'undefined' && navigator.onLine === false;
      if (isOfflineNow && isOfflineCapableRole(currentUser.role)) {
        offlineSyncManager.enqueueOfflinePayment(effectiveAgentId, currentUser.role, {
          invoiceId: inv.id,
          invoiceNo: inv.invoice_no,
          subscriberUsername: inv.subscriber_username,
          amountPaid: collectedNow,
          totalAmount,
          previousPaid,
          agentId: effectiveAgentId,
          agentName: currentUser.fullName,
          collectedAtIso: nowIso,
          paymentMethod: 'Cash Handover',
        });
        applyOptimisticAndReceipt(true);
        return;
      }

      // 1. Update invoice in Supabase: status, paid_amount, paid_at, and 31-day renewal on PAID
      const invoiceUpdateData: Partial<SupabaseInvoice> = {
        status: newStatus,
        paid_amount: finalPaidAmount,
        paid_at: newStatus === 'PAID' ? nowIso : (inv.paid_at || null),
        cycle_day: 31,
      };
      if (newStatus === 'PAID') {
        invoiceUpdateData.due_date = nextExpiryDate;
      }

      const { error: invErr } = await supabase
        .from('invoices')
        .update(invoiceUpdateData)
        .eq('id', inv.id);

      if (invErr) throw invErr;

      if (newStatus === 'PAID') {
        await restoreSubscriberOnInvoicePaid(inv.subscriber_username);
      }

      // 2. Increment agent's cash_in_hand in portal_users by ONLY enteredVal
      const { data: agentRecord } = await supabase
        .from('portal_users')
        .select('cash_in_hand')
        .eq('id', effectiveAgentId)
        .maybeSingle();

      const currentCash = Number(agentRecord?.cash_in_hand ?? agentCash) || 0;
      const newCash = currentCash + enteredVal;

      await supabase
        .from('portal_users')
        .update({ cash_in_hand: newCash })
        .eq('id', effectiveAgentId);

      // 3. Record in payment_transactions table (matching actual PostgreSQL columns)
      const { error: txError } = await supabase
        .from('payment_transactions')
        .insert([{
          invoice_id: inv.id,
          subscriber_username: inv.subscriber_username,
          collected_by_id: effectiveAgentId,
          collected_by_name: currentUser.fullName,
          amount_paid: enteredVal,
          payment_mode: 'Cash Handover',
          payment_date: nowIso,
          notes: `Field collection for Invoice #${inv.invoice_no}`,
        }]);

      if (txError) {
        console.warn('payment_transactions insert error:', txError.message);
      }

      try {
        await collectAgentCashPayment(inv.id, effectiveAgentId, enteredVal);
      } catch {}

      applyOptimisticAndReceipt(false);
      await fetchAgentData();
    } catch (err: any) {
      if (isLikelyNetworkError(err) && isOfflineCapableRole(currentUser.role)) {
        try {
          offlineSyncManager.enqueueOfflinePayment(effectiveAgentId, currentUser.role, {
            invoiceId: inv.id,
            invoiceNo: inv.invoice_no,
            subscriberUsername: inv.subscriber_username,
            amountPaid: collectedNow,
            totalAmount,
            previousPaid,
            agentId: effectiveAgentId,
            agentName: currentUser.fullName,
            collectedAtIso: nowIso,
            paymentMethod: 'Cash Handover',
          });
          applyOptimisticAndReceipt(true);
          return;
        } catch (queueErr: any) {
          showNoticeToast(queueErr?.message || 'Already saved locally.', 5000);
          setIsCollectModalOpen(false);
          setSelectedInvForCollection(null);
          return;
        }
      }
      showNoticeToast(`Collection error: ${err?.message || 'Failed'}`, 5000);
    } finally {
      setIsSubmittingCollection(false);
    }
  };

  // Handle marking ticket fixed with transparent offline saving fallback
  const handleMarkTicketFixed = async (ticketId: string) => {
    const ticketObj = assignedTickets.find((t) => t.id === ticketId);
    const effectiveAgentId = resolvedAgentIdRef.current || currentUser.id;
    const nowIso = new Date().toISOString();

    const saveTicketOffline = () => {
      offlineSyncManager.enqueueOfflineTicketResolution(effectiveAgentId, currentUser.role, {
        ticketId,
        ticketNo: ticketObj?.ticket_no || ticketId,
        subscriberUsername: ticketObj?.subscriber_username || '',
        agentId: effectiveAgentId,
        agentName: currentUser.fullName,
        resolvedAtIso: nowIso,
        resolutionNotes: 'Resolved in field by technician',
      });
      setAssignedTickets((prev) =>
        prev.map((t) => (t.id === ticketId ? { ...t, status: 'RESOLVED' } : t))
      );
      resolveTicket(ticketId, 'Resolved in field by technician');
      showNoticeToast('Saved locally — will auto-sync when 4G/Wi-Fi returns', 6000);
    };

    try {
      if (
        typeof navigator !== 'undefined' &&
        navigator.onLine === false &&
        isOfflineCapableRole(currentUser.role)
      ) {
        saveTicketOffline();
        return;
      }

      const { error } = await supabase
        .from('tickets')
        .update({ status: 'RESOLVED' })
        .eq('id', ticketId);

      if (error) throw error;

      setAssignedTickets((prev) =>
        prev.map((t) => (t.id === ticketId ? { ...t, status: 'RESOLVED' } : t))
      );
      resolveTicket(ticketId, 'Resolved in field by technician');
      showNoticeToast('Complaint marked RESOLVED successfully!', 4000);
      await fetchAgentData();
    } catch (err: any) {
      if (isLikelyNetworkError(err) && isOfflineCapableRole(currentUser.role)) {
        saveTicketOffline();
        return;
      }
      showNoticeToast(`Failed to resolve ticket: ${err?.message || 'Unknown error'}`, 5000);
    }
  };

  const filteredOnus = onus.filter(
    (o) =>
      o.model.toLowerCase().includes(ontSearchQuery.toLowerCase()) ||
      o.macAddress.toLowerCase().includes(ontSearchQuery.toLowerCase()) ||
      o.customerName.toLowerCase().includes(ontSearchQuery.toLowerCase())
  );

  const activePaymentAccounts = useMemo(
    () => (paymentAccounts || []).filter((acc) => acc.is_active !== false),
    [paymentAccounts]
  );

  const supportWhatsapp = whatsappConfig.support_whatsapp || DEFAULT_SUPPORT_WHATSAPP;

  const handleSendAgentInvoiceWhatsApp = (inv: SupabaseInvoice) => {
    const subKey = (inv.subscriber_username || '').trim().toLowerCase();
    const subInfo = subscriberDirectory[subKey];
    const subPhone =
      subInfo?.phone ||
      customers.find((c) => c.pppoeUsername?.toLowerCase() === subKey)?.phone ||
      '';
    const totalAmount = Number(inv.amount || 0);
    const paidAmount = Number(inv.paid_amount || 0);
    const balanceDue = Math.max(0, totalAmount - paidAmount);
    const isPaid = balanceDue <= 0 || (inv.status || '').toUpperCase() === 'PAID';

    if (isPaid) {
      const msg = buildInstantPaymentReceiptMessage({
        fullName: subInfo?.full_name || inv.subscriber_username,
        username: inv.subscriber_username,
        invoiceNo: inv.invoice_no,
        amountPaid: paidAmount > 0 ? paidAmount : totalAmount,
        totalAmount,
        remainingBalance: 0,
        paymentMethod: 'Cash Handover',
        collectorName: currentUser.fullName,
        nextExpiryDate: inv.due_date,
        activePaymentAccounts,
        supportWhatsapp,
      });
      openWhatsAppLink(subPhone, msg);
    } else {
      const daysLeft = computeDaysUntilDate(inv.due_date);
      const msg = buildPreExpiryReminderMessage({
        fullName: subInfo?.full_name || inv.subscriber_username,
        username: inv.subscriber_username,
        packageSpeed: subInfo?.package_speed || 'Fiber Broadband',
        daysRemaining: daysLeft !== null ? Math.max(0, daysLeft) : 0,
        expiryDate: inv.due_date,
        invoiceNo: inv.invoice_no,
        amountDue: balanceDue,
        activePaymentAccounts,
        supportWhatsapp,
      });
      openWhatsAppLink(subPhone, msg);
    }
  };

  const allAreaSubscribers = customers.filter(
    (c) =>
      !dirSearchQuery.trim() ||
      c.name.toLowerCase().includes(dirSearchQuery.toLowerCase()) ||
      c.pppoeUsername.toLowerCase().includes(dirSearchQuery.toLowerCase()) ||
      c.phone.includes(dirSearchQuery)
  );

  return (
    <div
      className={`${
        activeTab === 'fiber_gis' ? 'max-w-6xl' : 'max-w-md'
      } mx-auto space-y-4 font-sans text-xs pb-12 transition-all`}
    >
      {/* Agent Identity & Cash Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-emerald-950/40 to-slate-900 border border-emerald-800/60 rounded-2xl p-4 shadow-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-full bg-emerald-600/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 font-bold font-mono">
              🛵
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm font-bold text-white">{currentUser.fullName}</h2>
                {isOfflineCapableRole(currentUser.role) && (
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold border whitespace-nowrap ${
                      isOnline
                        ? 'bg-emerald-950/70 text-emerald-300 border-emerald-700/60'
                        : 'bg-amber-950/80 text-amber-300 border-amber-700/70'
                    }`}
                  >
                    {isOnline ? '🟢 Online' : '🟠 Offline (Auto-Sync Ready)'}
                  </span>
                )}
              </div>
              <span className="text-[11px] text-emerald-400 font-mono flex items-center gap-1">
                <MapPin className="w-3 h-3" /> {currentUser.area || 'Assigned Zone'}
              </span>
            </div>
          </div>

          <div className="text-right">
            <span className="text-[10px] text-slate-400 block font-mono">Cash in Hand</span>
            <span className="text-sm font-bold text-cyan-300 font-mono block">
              Rs. {Number(agentCash).toLocaleString()}
            </span>
          </div>
        </div>
      </div>

      {/* Success Notification Banner with 1-Click Instant WhatsApp Receipt */}
      {collectionSuccessToast && (
        <div className="p-3 bg-emerald-950/90 border border-emerald-700 rounded-xl text-emerald-300 text-xs space-y-2 shadow-lg animate-fadeIn">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{collectionSuccessToast}</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setCollectionSuccessToast(null);
                setLastCollectedReceipt(null);
              }}
              className="text-emerald-400 hover:text-white cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          {lastCollectedReceipt && (
            <button
              type="button"
              onClick={() =>
                openWhatsAppLink(
                  lastCollectedReceipt.phone,
                  buildInstantPaymentReceiptMessage({
                    fullName: lastCollectedReceipt.fullName,
                    username: lastCollectedReceipt.username,
                    invoiceNo: lastCollectedReceipt.invoiceNo,
                    amountPaid: lastCollectedReceipt.amountPaid,
                    totalAmount: lastCollectedReceipt.totalAmount,
                    remainingBalance: lastCollectedReceipt.remainingBalance,
                    paymentMethod: 'Cash Handover',
                    collectorName: currentUser.fullName,
                    nextExpiryDate: lastCollectedReceipt.nextExpiryDate,
                    activePaymentAccounts,
                    supportWhatsapp,
                  })
                )
              }
              className="w-full py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Send Instant WhatsApp Receipt to Subscriber</span>
            </button>
          )}
        </div>
      )}

      {/* Navigation Tabs for Agent */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800 text-[10px] sm:text-[11px] font-mono font-bold">
        <button
          onClick={() => setActiveTab('tickets')}
          className={`min-h-[40px] py-2 rounded-lg transition flex items-center justify-center gap-1 cursor-pointer ${
            activeTab === 'tickets' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'
          }`}
        >
          <Clock className="w-3 h-3" />
          <span>Tickets ({assignedTickets?.filter((t) => (t.status || '').toUpperCase() !== 'RESOLVED').length || 0})</span>
        </button>

        <button
          onClick={() => setActiveTab('collections')}
          className={`min-h-[40px] py-2 rounded-lg transition flex items-center justify-center gap-1 cursor-pointer ${
            activeTab === 'collections' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'
          }`}
        >
          <DollarSign className="w-3 h-3" />
          <span>$ Cash ({(assignedInvoices || []).filter((inv) => (Number(inv.amount) - Number(inv.paid_amount || 0)) > 0).length})</span>
        </button>

        <button
          onClick={() => setActiveTab('ledger')}
          className={`min-h-[40px] py-2 rounded-lg transition flex items-center justify-center gap-1 cursor-pointer ${
            activeTab === 'ledger' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'
          }`}
        >
          <Receipt className="w-3 h-3" />
          <span>$ Ledger</span>
        </button>

        <button
          onClick={() => setActiveTab('ont_checker')}
          className={`min-h-[40px] py-2 rounded-lg transition flex items-center justify-center gap-1 cursor-pointer ${
            activeTab === 'ont_checker' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'
          }`}
        >
          <Radio className="w-3 h-3" />
          <span>ONT</span>
        </button>

        <button
          onClick={() => setActiveTab('directory')}
          className={`min-h-[40px] py-2 rounded-lg transition flex items-center justify-center gap-1 cursor-pointer ${
            activeTab === 'directory' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'
          }`}
        >
          <Users className="w-3 h-3" />
          <span>Directory</span>
        </button>

        <button
          onClick={() => setActiveTab('fiber_gis')}
          className={`min-h-[40px] py-2 rounded-lg transition flex items-center justify-center gap-1 cursor-pointer ${
            activeTab === 'fiber_gis' ? 'bg-sky-600 text-white shadow' : 'text-slate-400 hover:text-white'
          }`}
        >
          <MapPin className="w-3 h-3" />
          <span>Fiber GIS</span>
        </button>
      </div>

      {/* Tab 1: My Assigned Tickets (Strictly filtered to currentUser) */}
      {activeTab === 'tickets' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-slate-400 text-[11px] px-1 font-mono">
            <span>Assigned Tasks for @{currentUser.username}</span>
            <span>{assignedTickets.filter((t) => t.status !== 'RESOLVED').length} Active</span>
          </div>

          {assignedTickets.map((ticket) => {
            const isResolved = ticket.status === 'RESOLVED';
            const subInfo = subscriberDirectory[(ticket.subscriber_username || '').trim().toLowerCase()];
            const subPhone = subInfo?.phone || customers.find((c) => c.pppoeUsername?.toLowerCase() === (ticket.subscriber_username || '').toLowerCase())?.phone || '';
            const subAddress = subInfo?.address || subInfo?.area || '';
            return (
              <div
                key={ticket.id}
                className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 space-y-2.5 shadow-md"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-white text-xs">@{ticket.subscriber_username}</span>
                      {subInfo?.full_name && (
                        <span className="text-[11px] text-slate-400">({subInfo.full_name})</span>
                      )}
                    </div>
                    <span className="text-[10px] text-slate-400 font-mono block">Ticket #{ticket.ticket_no}</span>
                    {subAddress && (
                      <span className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5">
                        <MapPin className="w-3 h-3 text-cyan-400 shrink-0" />
                        <span>{subAddress}</span>
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <span
                      className={`px-1.5 py-0.5 rounded font-mono font-bold text-[10px] ${
                        ticket.priority?.toUpperCase() === 'CRITICAL'
                          ? 'bg-rose-950 text-rose-300 border border-rose-800'
                          : 'bg-amber-950 text-amber-300 border border-amber-800'
                      }`}
                    >
                      {ticket.priority || 'MEDIUM'}
                    </span>
                    {subPhone ? (
                      <a
                        href={`tel:${formatTelPhone(subPhone)}`}
                        className="px-2.5 py-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold font-mono text-[10px] flex items-center gap-1 shadow transition"
                      >
                        <Phone className="w-3 h-3" />
                        <span>📞 Call Subscriber</span>
                      </a>
                    ) : (
                      <span className="text-[10px] text-slate-500 font-mono">No phone on file</span>
                    )}
                  </div>
                </div>

                <div className="p-2 bg-slate-950 rounded-lg text-slate-300 text-[11px] font-mono leading-relaxed">
                  🚨 {ticket.issue || 'Broadband line disturbance. Inspect connection.'}
                </div>

                <div className="flex items-center justify-between pt-1 border-t border-slate-800/80">
                  <span className="text-[10px] text-slate-500 font-mono">
                    Logged: {new Date(ticket.created_at || Date.now()).toLocaleDateString()}
                  </span>

                  {!isResolved ? (
                    <button
                      onClick={() => handleMarkTicketFixed(ticket.id)}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold font-mono text-[11px] flex items-center gap-1 transition cursor-pointer"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Mark Fixed</span>
                    </button>
                  ) : (
                    <span className="text-emerald-400 font-mono text-[11px]">✓ Resolved</span>
                  )}
                </div>
              </div>
            );
          })}

          {assignedTickets.length === 0 && (
            <div className="text-center py-10 bg-slate-900 border border-slate-800 rounded-xl text-slate-500">
              No tasks currently assigned to {currentUser.fullName}. All systems running smoothly!
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Doorstep Cash Collection (Strictly filtered to currentUser) */}
      {activeTab === 'collections' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-slate-400 text-[11px] px-1 font-mono">
            <span>Assigned Recovery Dues for @{currentUser.username}</span>
            <span>1-Click Recovery</span>
          </div>

          {assignedInvoices.map((inv) => {
            const totalAmount = Number(inv.amount || 0);
            const alreadyPaid = Number(inv.paid_amount || 0);
            const balanceDue = Math.max(0, totalAmount - alreadyPaid);
            const displayStatus = balanceDue === 0 ? 'PAID' : (inv.status || 'DUE').toUpperCase();
            const subInfo = subscriberDirectory[(inv.subscriber_username || '').trim().toLowerCase()];
            const subPhone = subInfo?.phone || customers.find((c) => c.pppoeUsername?.toLowerCase() === (inv.subscriber_username || '').toLowerCase())?.phone || '';
            const subAddress = subInfo?.address || subInfo?.area || '';

            return (
              <div
                key={inv.id}
                className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 space-y-2.5 shadow-md"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-white text-xs block">@{inv.subscriber_username}</span>
                      {displayStatus === 'PAID' ? (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                          <span>PAID</span>
                        </span>
                      ) : displayStatus === 'PARTIAL' ? (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">
                          PARTIAL
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30">
                          DUE
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] text-slate-400 font-mono">Invoice #{inv.invoice_no}</span>
                    {subAddress && (
                      <span className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5">
                        <MapPin className="w-3 h-3 text-cyan-400 shrink-0" />
                        <span>{subAddress}</span>
                      </span>
                    )}
                    <span className="text-[10px] text-slate-500 block">Cycle: {inv.cycle_day || 31} Days</span>
                  </div>
                  <div className="text-right">
                    <span className={`font-bold font-mono text-sm block ${balanceDue > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                      {formatCurrency(balanceDue)}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono block">
                      Total: {formatCurrency(totalAmount)}
                    </span>
                    {alreadyPaid > 0 && (
                      <span className="text-[10px] text-emerald-400 font-mono block">
                        Paid: {formatCurrency(alreadyPaid)}
                      </span>
                    )}
                    <span className="text-[10px] text-slate-500 font-mono">Due: {inv.due_date}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-800 flex-wrap">
                  {subPhone ? (
                    <a
                      href={`tel:${formatTelPhone(subPhone)}`}
                      className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold font-mono text-[11px] flex items-center gap-1.5 shadow transition"
                    >
                      <Phone className="w-3.5 h-3.5" />
                      <span>📞 Call Subscriber</span>
                    </a>
                  ) : (
                    <span className="text-[10px] text-slate-500 font-mono">No phone on file</span>
                  )}

                  {balanceDue > 0 && displayStatus !== 'PAID' ? (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button
                        type="button"
                        onClick={() => handleSendAgentInvoiceWhatsApp(inv)}
                        className="px-2.5 py-1.5 rounded-lg bg-emerald-950/70 hover:bg-emerald-900 text-emerald-300 border border-emerald-700/70 font-bold font-mono text-[11px] flex items-center gap-1 transition cursor-pointer"
                        title="Send WhatsApp Billing Reminder with Active Accounts"
                      >
                        <Send className="w-3 h-3" />
                        <span>WA Remind</span>
                      </button>
                      <button
                        onClick={() => handleOpenCollectionModal(inv)}
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold font-mono text-xs flex items-center gap-1.5 shadow transition cursor-pointer"
                      >
                        <DollarSign className="w-3.5 h-3.5" />
                        <span>Collect Payment / Mark Paid</span>
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-emerald-400 font-mono text-[11px] font-semibold flex items-center gap-1.5 py-1 px-2.5 rounded-lg bg-emerald-950/60 border border-emerald-800/80">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        <span>✓ Settled</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => handleSendAgentInvoiceWhatsApp(inv)}
                        className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold font-mono text-[11px] flex items-center gap-1 transition cursor-pointer"
                        title="Send Instant WhatsApp Payment Receipt"
                      >
                        <Send className="w-3 h-3" />
                        <span>WA Receipt</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {assignedInvoices.length === 0 && (
            <div className="text-center py-10 bg-slate-900 border border-slate-800 rounded-xl text-slate-500">
              No outstanding dues pending recovery for {currentUser.fullName}.
            </div>
          )}
        </div>
      )}

      {/* Tab 2.5: My Financial Ledger & Salary */}
      {activeTab === 'ledger' && (
        <div className="space-y-4">
          {/* Top Summary Cards */}
          <div className="grid grid-cols-3 gap-2">
            <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl space-y-1">
              <span className="text-[10px] text-slate-400 font-mono uppercase block flex items-center justify-between">
                <span>Base Salary</span>
                <CreditCard className="w-3.5 h-3.5 text-indigo-400" />
              </span>
              <div className="text-sm sm:text-base font-bold font-mono text-indigo-300">
                {formatCurrency(agentBaseSalary)}
              </div>
              <span className="text-[9px] text-slate-500 font-mono block">Monthly</span>
            </div>

            <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl space-y-1">
              <span className="text-[10px] text-slate-400 font-mono uppercase block flex items-center justify-between">
                <span>Cash in Hand</span>
                <DollarSign className="w-3.5 h-3.5 text-cyan-400" />
              </span>
              <div className="text-sm sm:text-base font-bold font-mono text-cyan-300">
                {formatCurrency(agentCash)}
              </div>
              <span className="text-[9px] text-slate-500 font-mono block">Pending Handover</span>
            </div>

            <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl space-y-1">
              <span className="text-[10px] text-slate-400 font-mono uppercase block flex items-center justify-between">
                <span>Advance Bal</span>
                <DollarSign className="w-3.5 h-3.5 text-amber-400" />
              </span>
              <div className="text-sm sm:text-base font-bold font-mono text-amber-400">
                {formatCurrency(agentAdvanceBalance)}
              </div>
              <span className="text-[9px] text-slate-500 font-mono block">Outstanding</span>
            </div>
          </div>

          {/* Audit Ledger Table */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-md">
            <div className="p-3 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-bold text-white font-mono">
                <FileText className="w-3.5 h-3.5 text-cyan-400" />
                <span>Financial Ledger ({agentCashTransactions.length})</span>
              </div>
              <button
                type="button"
                onClick={fetchAgentData}
                className="text-slate-400 hover:text-white transition p-1 cursor-pointer"
                title="Refresh Ledger"
              >
                <RefreshCw className="w-3 h-3" />
              </button>
            </div>

            <div className="divide-y divide-slate-800/80 font-mono text-[11px]">
              {agentCashTransactions.length === 0 ? (
                <div className="py-8 text-center text-slate-500 font-mono text-xs">
                  No cash handover or advance transactions recorded in your ledger yet.
                </div>
              ) : (
                agentCashTransactions.map((tx) => {
                  const isHandover = tx.transaction_type === 'CASH_HANDOVER';
                  const isAdvanceTaken = tx.transaction_type === 'ADVANCE_TAKEN';
                  const isAdvanceReturn = tx.transaction_type === 'ADVANCE_RETURN';

                  return (
                    <div key={tx.id || Math.random()} className="p-3 hover:bg-slate-950/40 transition space-y-1">
                      <div className="flex items-center justify-between">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                            isHandover
                              ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                              : isAdvanceTaken
                              ? 'bg-amber-950 text-amber-300 border border-amber-800'
                              : isAdvanceReturn
                              ? 'bg-purple-950 text-purple-300 border border-purple-800'
                              : 'bg-indigo-950 text-indigo-300 border border-indigo-800'
                          }`}
                        >
                          {tx.transaction_type?.replace(/_/g, ' ')}
                        </span>
                        <span className="font-bold text-xs text-white">
                          {formatCurrency(Number(tx.amount) || 0)}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-[10px] text-slate-400 pt-0.5">
                        <span>
                          {tx.created_at
                            ? new Date(tx.created_at).toLocaleDateString() + ' ' + new Date(tx.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                            : 'Recent'}
                        </span>
                        <span className="text-slate-300 truncate max-w-[150px]">{tx.received_by || 'Admin'}</span>
                      </div>

                      {tx.notes && (
                        <p className="text-[10px] text-slate-500 truncate pt-0.5 font-sans italic">
                          {tx.notes}
                        </p>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Quick ONT Signal Checker */}
      {activeTab === 'ont_checker' && (
        <FeatureGate
          feature="agent_check_ont_optical_power"
          role="AGENT"
          mode="banner"
          disabledMessage="Live optical signal power queries (dBm) from ONUs are restricted for Field Agents by Administrator policy."
        >
          <div className="space-y-3">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-3 pointer-events-none" />
              <input
                type="text"
                value={ontSearchQuery}
                onChange={(e) => setOntSearchQuery(e.target.value)}
                placeholder="Search subscriber name or MAC address..."
                className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-mono"
              />
            </div>

            <div className="space-y-2.5">
              {filteredOnus.map((onu) => {
                const isGood = onu.rxPowerDbm >= -24 && onu.rxPowerDbm <= -14;
                return (
                  <div
                    key={onu.id}
                    className="bg-slate-900 border border-slate-800 rounded-xl p-3 space-y-1.5 font-mono"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-white font-sans text-xs">{onu.customerName}</span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          onu.status === 'online'
                            ? 'bg-emerald-950 text-emerald-300'
                            : 'bg-rose-950 text-rose-300'
                        }`}
                      >
                        {onu.status.toUpperCase()}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[11px] pt-1 border-t border-slate-800">
                      <span className="text-slate-400">Rx Optical Power:</span>
                      <span
                        className={`font-bold ${
                          isGood ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {onu.rxPowerDbm.toFixed(1)} dBm ({isGood ? 'Optimal' : 'Low Optical Power'})
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-slate-500">
                      <span>MAC: {onu.macAddress}</span>
                      <span>Distance: {onu.distanceMeters}m</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </FeatureGate>
      )}

      {/* Tab 4: Assigned Recovery Directory */}
      {activeTab === 'directory' && (() => {
        const query = dirSearchQuery.trim().toLowerCase();
        const filteredList = (assignedInvoices || []).filter((inv) => {
          if (!query) return true;
          return (
            (inv.subscriber_username || '').toLowerCase().includes(query) ||
            (inv.invoice_no || '').toLowerCase().includes(query) ||
            (inv.status || '').toLowerCase().includes(query)
          );
        });

        return (
          <div className="space-y-3">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-3 pointer-events-none" />
              <input
                type="text"
                value={dirSearchQuery}
                onChange={(e) => setDirSearchQuery(e.target.value)}
                placeholder="Search assigned recovery subscriber or invoice #..."
                className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-mono"
              />
            </div>

            <div className="flex items-center justify-between text-slate-400 text-[11px] px-1 font-mono">
              <span>All Assigned Recovery Invoices</span>
              <span>{filteredList.length} Records</span>
            </div>

            <div className="space-y-2">
              {filteredList.length === 0 ? (
                <div className="py-8 text-center text-slate-500 font-mono text-xs bg-slate-900 border border-slate-800 rounded-xl">
                  No assigned recovery invoices match this filter.
                </div>
              ) : (
                filteredList.map((inv) => {
                  const paid = Number(inv.paid_amount) || 0;
                  const total = Number(inv.amount) || 0;
                  const remaining = Math.max(0, total - paid);
                  const status = (inv.status || (remaining <= 0 ? 'PAID' : 'DUE')).toUpperCase();
                  const subKey = (inv.subscriber_username || '').toLowerCase();
                  const subInfo = subscriberDirectory[subKey];
                  const subPhone = subInfo?.phone || '';
                  const subAddress = subInfo?.address || '';
                  const subFullName = subInfo?.full_name || '';

                  return (
                    <div
                      key={inv.id}
                      className="bg-slate-900 border border-slate-800 rounded-xl p-3 space-y-1.5 font-mono text-xs shadow-md"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="font-bold text-white font-sans text-xs block">
                            {subFullName ? `${subFullName} (@${inv.subscriber_username})` : `@${inv.subscriber_username}`}
                          </span>
                          {subAddress && (
                            <span className="text-[10px] text-slate-400 font-sans block">{subAddress}</span>
                          )}
                        </div>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            status === 'PAID'
                              ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                              : status === 'PARTIAL'
                              ? 'bg-amber-950 text-amber-300 border border-amber-800'
                              : 'bg-rose-950 text-rose-300 border border-rose-800'
                          }`}
                        >
                          {status}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-slate-400">
                        <span>Invoice: #{inv.invoice_no}</span>
                        <span>Due: {inv.due_date || 'Current Cycle'}</span>
                      </div>

                      <div className="flex items-center justify-between text-[11px] pt-1 border-t border-slate-800">
                        <span className="text-slate-400">Total: {formatCurrency(total)}</span>
                        <span className="text-slate-400">Paid: <strong className="text-emerald-400">{formatCurrency(paid)}</strong></span>
                        <span className={remaining > 0 ? 'text-rose-400 font-bold' : 'text-emerald-400'}>
                          Bal: {formatCurrency(remaining)}
                        </span>
                      </div>

                      <div className="pt-1 flex flex-wrap gap-2">
                        {subPhone && (
                          <a
                            href={`tel:${formatTelPhone(subPhone)}`}
                            className="flex-1 min-w-[120px] py-1.5 px-2.5 rounded-lg bg-cyan-950 hover:bg-cyan-900 border border-cyan-800 text-cyan-300 font-bold text-xs transition flex items-center justify-center gap-1.5"
                          >
                            <span>&#128222; Call ({subPhone})</span>
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => handleSendAgentInvoiceWhatsApp(inv)}
                          className="flex-1 min-w-[120px] py-1.5 px-2.5 rounded-lg bg-emerald-950/70 hover:bg-emerald-900 border border-emerald-700/70 text-emerald-300 font-bold text-xs transition flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <Send className="w-3.5 h-3.5" />
                          <span>{remaining > 0 ? 'WA Remind' : 'WA Receipt'}</span>
                        </button>
                        {remaining > 0 && (
                          <button
                            type="button"
                            onClick={() => handleOpenCollectionModal(inv)}
                            className="flex-1 min-w-[140px] py-1.5 px-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 active:scale-98 text-slate-950 font-bold text-xs transition flex items-center justify-center gap-1.5 shadow-md shadow-emerald-950/40 cursor-pointer"
                          >
                            <DollarSign className="w-3.5 h-3.5" />
                            <span>Collect Cash ({formatCurrency(remaining)})</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        );
      })()}

      {/* Tab 5: Live FTTH Fiber GIS & Area Map */}
      {activeTab === 'fiber_gis' && (
        <FiberGisMapView currentUser={currentUser} compactMobile />
      )}

      {/* Cash Collection Modal with Partial Payment Support */}
      {isCollectModalOpen && selectedInvForCollection && (() => {
        const alreadyPaid = Number(selectedInvForCollection.paid_amount) || 0;
        const totalAmount = Number(selectedInvForCollection.amount) || 0;
        const remainingDue = Math.max(0, totalAmount - alreadyPaid);
        const enteredVal = Number(collectionAmountInput) || 0;
        const projectedTotalPaid = alreadyPaid + enteredVal;
        const willBeFullyPaid = projectedTotalPaid >= totalAmount;

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in font-sans">
            <div className="bg-[#111A2E] border border-slate-700 rounded-2xl w-full max-w-sm p-5 shadow-2xl relative">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-emerald-400" />
                  <span>Receive Cash Handover</span>
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    setIsCollectModalOpen(false);
                    setSelectedInvForCollection(null);
                  }}
                  className="text-slate-400 hover:text-white transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3.5 mt-3.5">
                {/* Financial Summary */}
                <div className="p-3 bg-slate-900 rounded-xl border border-slate-800 space-y-1.5 font-mono text-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400 font-sans">Invoice:</span>
                    <span className="text-cyan-400 font-bold">#{selectedInvForCollection.invoice_no}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400 font-sans">Subscriber:</span>
                    <span className="text-white font-semibold font-sans">@{selectedInvForCollection.subscriber_username}</span>
                  </div>
                  <div className="pt-1.5 border-t border-slate-800 flex justify-between items-center">
                    <span className="text-slate-400 font-sans">Total Billed:</span>
                    <span className="text-white">{formatCurrency(totalAmount)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400 font-sans">Already Paid:</span>
                    <span className="text-emerald-400">{formatCurrency(alreadyPaid)}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm font-bold pt-1 border-t border-slate-800">
                    <span className="text-amber-300 font-sans">Remaining Due:</span>
                    <span className="text-amber-400">{formatCurrency(remainingDue)}</span>
                  </div>
                </div>

                {/* Amount Input */}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs font-medium text-slate-300">
                      Payment Received (Rs.)
                    </label>
                    <button
                      type="button"
                      onClick={() => setCollectionAmountInput(remainingDue)}
                      className="text-cyan-400 hover:text-cyan-300 text-[11px] underline cursor-pointer"
                    >
                      Fill Full ({formatCurrency(remainingDue)})
                    </button>
                  </div>
                  <div className="relative">
                    <span className="absolute left-3 top-2 text-slate-500 font-mono text-sm">Rs.</span>
                    <input
                      type="number"
                      min="1"
                      step="any"
                      value={collectionAmountInput}
                      onChange={(e) => setCollectionAmountInput(e.target.value)}
                      placeholder={`Max: ${remainingDue}`}
                      className="w-full pl-9 pr-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono text-base focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] mt-1.5 px-0.5">
                    <span className="text-slate-400">
                      Result: <span className={`font-bold ${willBeFullyPaid ? 'text-emerald-400' : 'text-amber-400'}`}>
                        {willBeFullyPaid ? 'PAID' : 'PARTIAL'}
                      </span>
                    </span>
                    {!willBeFullyPaid && (
                      <span className="text-amber-400 font-mono">
                        Arrears: {formatCurrency(Math.max(0, totalAmount - projectedTotalPaid))}
                      </span>
                    )}
                  </div>
                </div>

                <div className="p-2.5 bg-emerald-950/40 border border-emerald-900/60 rounded-lg text-[11px] text-emerald-300 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Your Cash-in-Hand wallet will increment by exactly <strong className="font-mono text-emerald-300">{formatCurrency(enteredVal)}</strong> upon confirmation.</span>
                </div>

                <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => {
                      setIsCollectModalOpen(false);
                      setSelectedInvForCollection(null);
                    }}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs transition cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmCollection}
                    disabled={isSubmittingCollection || enteredVal <= 0}
                    className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-bold rounded-lg text-xs transition shadow flex items-center gap-1.5 cursor-pointer font-mono"
                  >
                    {isSubmittingCollection ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Collecting...</span>
                      </>
                    ) : (
                      <>
                        <DollarSign className="w-3.5 h-3.5" />
                        <span>Confirm Cash Collection</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default FieldAgentPortal;
