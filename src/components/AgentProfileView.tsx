import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ArrowLeft,
  DollarSign,
  Wallet,
  CreditCard,
  TrendingUp,
  Receipt,
  FileText,
  UserCheck,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Phone,
  MapPin,
  Calendar,
  X,
  Send,
  Building,
  Check,
  Edit,
  Award,
  Plus,
  Trash2,
  Copy,
  Database,
  FileSpreadsheet,
  FileDown,
} from 'lucide-react';
import {
  supabase,
  SupabasePortalUser,
  SupabasePaymentTransaction,
  SupabaseAgentCashTransaction,
  SupabaseAgentCommission,
} from '../services/supabaseClient';
import {
  fetchAgentCommissions,
  createAgentCommission,
  markCommissionPaidAndPostToLedger,
  updateAgentCommission,
  deleteAgentCommission,
} from '../services/erpInventoryService';
import { ERP_MIGRATION_SQL } from '../lib/erpMigrationSql';
import { useCurrency } from '../context/CurrencyContext';
import { useAuth } from '../context/AuthContext';
import { EditStaffModal } from './EditStaffModal';
import { EditLedgerEntryModal } from './EditLedgerEntryModal';
import { DeleteLedgerEntryModal } from './DeleteLedgerEntryModal';
import {
  FieldAuditLedgerRow,
  VerifiedLedgerDeleteResult,
  VerifiedLedgerUpdateResult,
} from '../lib/ledgerAuditPersistence';
import { DateFilterToolbar } from './DateFilterToolbar';
import {
  DateFilterState,
  createDefaultDateFilter,
  describeDateFilter,
  matchesDateFilter,
} from '../lib/dateFilter';
import { getCachedGlobalSystemSettings } from '../lib/systemSettings';
import {
  exportSettlementLedgerToExcel,
  exportSettlementLedgerToPdf,
  SettlementExportPayload,
  SettlementExportRow,
} from '../lib/settlementLedgerExport';

export interface AgentProfileViewProps {
  username?: string;
  agentId?: string;
  onBack: () => void;
}

export const AgentProfileView: React.FC<AgentProfileViewProps> = ({
  username,
  agentId,
  onBack,
}) => {
  const { formatCurrency } = useCurrency();
  const { currentUser } = useAuth();

  // Agent profile state
  const [agent, setAgent] = useState<SupabasePortalUser | null>(null);
  const [allAgents, setAllAgents] = useState<SupabasePortalUser[]>([]);
  const [collections, setCollections] = useState<SupabasePaymentTransaction[]>([]);
  const [cashTransactions, setCashTransactions] = useState<SupabaseAgentCashTransaction[]>([]);
  const [commissions, setCommissions] = useState<SupabaseAgentCommission[]>([]);
  const [missingCommissionTable, setMissingCommissionTable] = useState<boolean>(false);
  const [copiedErpSql, setCopiedErpSql] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<'collections' | 'ledger' | 'commissions'>('collections');
  const [dateFilter, setDateFilter] = useState<DateFilterState>(() => createDefaultDateFilter('month'));
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const isMasterAdmin = String(currentUser?.role || '').trim().toUpperCase() === 'ADMIN';

  // Modals
  const [editingLedgerEntry, setEditingLedgerEntry] = useState<FieldAuditLedgerRow | null>(null);
  const [deletingLedgerEntry, setDeletingLedgerEntry] = useState<FieldAuditLedgerRow | null>(null);
  const [isEditStaffModalOpen, setIsEditStaffModalOpen] = useState(false);
  const [isHandoverModalOpen, setIsHandoverModalOpen] = useState(false);
  const [isAdvanceModalOpen, setIsAdvanceModalOpen] = useState(false);
  const [isAdvanceReturnModalOpen, setIsAdvanceReturnModalOpen] = useState(false);
  const [isSalaryPayoutModalOpen, setIsSalaryPayoutModalOpen] = useState(false);
  const [isCommissionModalOpen, setIsCommissionModalOpen] = useState(false);
  const [editingCommission, setEditingCommission] = useState<SupabaseAgentCommission | null>(null);
  const [deletingCommission, setDeletingCommission] = useState<SupabaseAgentCommission | null>(null);
  const [markingPaidId, setMarkingPaidId] = useState<string | null>(null);
  const [commForm, setCommForm] = useState<{
    subscriber_username: string;
    client_name: string;
    package_name: string;
    commission_amount: string;
    status: 'UNPAID' | 'PAID';
    notes: string;
  }>({
    subscriber_username: '',
    client_name: '',
    package_name: '30Mbps Fiber',
    commission_amount: '500',
    status: 'UNPAID',
    notes: '',
  });

  // Form Inputs
  const [handoverAmount, setHandoverAmount] = useState<string>('');
  const [handoverReceivedBy, setHandoverReceivedBy] = useState<string>('Admin');
  const [handoverNotes, setHandoverNotes] = useState<string>('Cash handover settlement to NOC cashier');

  const [advanceAmount, setAdvanceAmount] = useState<string>('');
  const [advanceNotes, setAdvanceNotes] = useState<string>('Emergency motorcycle fuel & maintenance advance');

  const [returnAmount, setReturnAmount] = useState<string>('');
  const [returnNotes, setReturnNotes] = useState<string>('Advance salary deduction against monthly cycle');

  const [salaryPayoutAmount, setSalaryPayoutAmount] = useState<string>('');
  const [salaryNotes, setSalaryNotes] = useState<string>('Regular monthly salary payout via direct cash handover');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 4000);
  };

  // 1. Fetch Agent Profile, Collections & Cash Ledger
  const fetchAgentProfile = useCallback(async () => {
    setIsLoading(true);
    try {
      // 1.1 Fetch agent user from portal_users
      let query = supabase.from('portal_users').select('*');
      if (agentId) {
        query = query.eq('id', agentId);
      } else if (username) {
        query = query.ilike('username', username);
      } else {
        return;
      }

      const { data: userData, error: userError } = await query.maybeSingle();
      if (userError || !userData) {
        console.error('Agent not found:', userError);
        setIsLoading(false);
        return;
      }

      setAgent(userData as SupabasePortalUser);
      setHandoverAmount(String(userData.cash_in_hand || 0));
      setSalaryPayoutAmount(String(userData.base_salary ?? 0));

      const { data: agentsList } = await supabase
        .from('portal_users')
        .select('*')
        .eq('role', 'AGENT')
        .order('full_name', { ascending: true });
      if (Array.isArray(agentsList)) {
        setAllAgents(agentsList as SupabasePortalUser[]);
      }

      // 1.2 Fetch client collections from payment_transactions matching both ID and full name
      let txns: SupabasePaymentTransaction[] = [];
      try {
        const { data: txData } = await supabase
          .from('payment_transactions')
          .select('*')
          .or(`collected_by_id.eq.${userData.id},collected_by_name.ilike.%${userData.full_name}%`);

        if (txData && Array.isArray(txData)) {
          txns = txData as SupabasePaymentTransaction[];
        }
      } catch (err) {
        console.warn('payment_transactions query notice:', err);
      }

      // 1.2b Also query invoices where assigned_agent matches this agent and paid_amount > 0
      try {
        const { data: invData } = await supabase
          .from('invoices')
          .select('*')
          .or(`assigned_agent_id.eq.${userData.id},assigned_agent_name.ilike.%${userData.full_name}%`)
          .gt('paid_amount', 0);

        if (invData && Array.isArray(invData)) {
          const existingInvoiceIds = new Set(txns.map((t) => t.invoice_id).filter(Boolean));
          invData.forEach((inv) => {
            if (!existingInvoiceIds.has(inv.id)) {
              txns.push({
                id: `inv-tx-${inv.id}`,
                invoice_id: inv.id,
                subscriber_username: inv.subscriber_username,
                collected_by_id: inv.assigned_agent_id || userData.id,
                collected_by_name: inv.assigned_agent_name || userData.full_name,
                amount_paid: Number(inv.paid_amount) || 0,
                payment_method: 'Cash Handover',
                payment_date: inv.paid_at || inv.created_at || new Date().toISOString(),
                created_at: inv.paid_at || inv.created_at || new Date().toISOString(),
                notes: `Invoice #${inv.invoice_no} collection`,
              });
            }
          });
        }
      } catch (err) {
        console.warn('Invoices query notice for agent profile:', err);
      }

      // Sort descending by date
      txns.sort((a, b) => {
        const dateA = new Date(a.payment_date || a.created_at || 0).getTime();
        const dateB = new Date(b.payment_date || b.created_at || 0).getTime();
        return dateB - dateA;
      });

      setCollections(txns);

      // 1.3 Fetch handover & settlement ledger from agent_cash_transactions strictly by agent_id
      let cashRecords: SupabaseAgentCashTransaction[] = [];
      const { data: cashData } = await supabase
        .from('agent_cash_transactions')
        .select('*')
        .eq('agent_id', userData.id)
        .order('created_at', { ascending: false });

      if (cashData) {
        cashRecords = cashData as SupabaseAgentCashTransaction[];
        setCashTransactions(cashRecords);
      }

      // Accounting Math
      const totalCollected = txns.reduce((sum, item) => sum + (Number(item.amount_paid) || 0), 0);
      const totalHandedOver = cashRecords
        .filter((t) => {
          const type = (t.transaction_type || '').toUpperCase();
          return type === 'CASH_HANDOVER' || type === 'HANDOVER';
        })
        .reduce((sum, item) => sum + (Number(item.amount) || 0), 0);

      const actualCashInHand = Math.max(0, totalCollected - totalHandedOver);

      const totalAdvanceTaken = cashRecords
        .filter((t) => (t.transaction_type || '').toUpperCase() === 'ADVANCE_TAKEN')
        .reduce((sum, item) => sum + (Number(item.amount) || 0), 0);

      const totalAdvanceReturned = cashRecords
        .filter((t) => {
          const type = (t.transaction_type || '').toUpperCase();
          return type === 'ADVANCE_RETURN' || type === 'ADVANCE_DEDUCTION';
        })
        .reduce((sum, item) => sum + (Number(item.amount) || 0), 0);

      const actualAdvanceBalance = Math.max(0, totalAdvanceTaken - totalAdvanceReturned);

      // Reconcile portal_users in Supabase if calculated values differ
      if (userData.cash_in_hand !== actualCashInHand || userData.advance_balance !== actualAdvanceBalance) {
        await supabase
          .from('portal_users')
          .update({
            cash_in_hand: actualCashInHand,
            advance_balance: actualAdvanceBalance,
          })
          .eq('id', userData.id);
        userData.cash_in_hand = actualCashInHand;
        userData.advance_balance = actualAdvanceBalance;
      }

      setAgent({ ...userData, cash_in_hand: actualCashInHand, advance_balance: actualAdvanceBalance });
      setHandoverAmount(String(actualCashInHand));
      setSalaryPayoutAmount(String(userData.base_salary ?? 0));

      // 1.4 Fetch agent new-connection commissions from Supabase
      const commRes = await fetchAgentCommissions(userData.id);
      setCommissions(commRes.data);
      setMissingCommissionTable(commRes.missingTable);
    } catch (err) {
      console.error('Error fetching agent profile:', err);
    } finally {
      setIsLoading(false);
    }
  }, [agentId, username]);

  useEffect(() => {
    fetchAgentProfile();

    // Realtime channel for live balance sync
    const channel = supabase
      .channel('agent_financial_profile_sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'portal_users' }, () => {
        fetchAgentProfile();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_cash_transactions' }, () => {
        fetchAgentProfile();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_transactions' }, () => {
        fetchAgentProfile();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices' }, () => {
        fetchAgentProfile();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_commissions' }, () => {
        fetchAgentProfile();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchAgentProfile]);

  // Period-filtered collections & cash ledger
  const filteredCollections = useMemo(() => {
    return (collections || []).filter((tx) =>
      matchesDateFilter(tx.payment_date || tx.created_at, dateFilter)
    );
  }, [collections, dateFilter]);

  const filteredCashTransactions = useMemo(() => {
    return (cashTransactions || []).filter((tx) =>
      matchesDateFilter(tx.created_at, dateFilter)
    );
  }, [cashTransactions, dateFilter]);

  const filteredCommissions = useMemo(() => {
    return (commissions || []).filter((c) =>
      matchesDateFilter([c.paid_at, c.created_at], dateFilter)
    );
  }, [commissions, dateFilter]);

  // Live cumulative accounting totals derived directly from current ledger rows
  const liveLedgerTotals = useMemo(() => {
    const totalCollectedAll = (collections || []).reduce(
      (sum, item) => sum + (Number(item.amount_paid) || 0),
      0
    );
    const totalHandedOverAll = (cashTransactions || [])
      .filter((t) => {
        const type = (t.transaction_type || '').toUpperCase();
        return type === 'CASH_HANDOVER' || type === 'HANDOVER';
      })
      .reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
    const totalAdvanceTakenAll = (cashTransactions || [])
      .filter((t) => (t.transaction_type || '').toUpperCase() === 'ADVANCE_TAKEN')
      .reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
    const totalAdvanceReturnedAll = (cashTransactions || [])
      .filter((t) => {
        const type = (t.transaction_type || '').toUpperCase();
        return type === 'ADVANCE_RETURN' || type === 'ADVANCE_DEDUCTION';
      })
      .reduce((sum, item) => sum + (Number(item.amount) || 0), 0);

    return {
      totalCollectedAll,
      totalHandedOverAll,
      totalAdvanceTakenAll,
      totalAdvanceReturnedAll,
      netCashInHand: Math.max(0, totalCollectedAll - totalHandedOverAll),
      netAdvanceBalance: Math.max(0, totalAdvanceTakenAll - totalAdvanceReturnedAll),
    };
  }, [collections, cashTransactions]);

  // Derived KPI metrics (live cumulative cash/advance balances + period-filtered recovery)
  const cashInHand = isLoading && !agent ? 0 : liveLedgerTotals.netCashInHand;
  const advanceBalance = isLoading && !agent ? 0 : liveLedgerTotals.netAdvanceBalance;
  const baseSalary = Number(agent?.base_salary ?? 0);
  const totalCollections = useMemo(() => {
    return filteredCollections.reduce((sum, item) => sum + (Number(item.amount_paid) || 0), 0);
  }, [filteredCollections]);
  const periodHandedOverTotal = useMemo(() => {
    return filteredCashTransactions
      .filter((t) => {
        const type = (t.transaction_type || '').toUpperCase();
        return type === 'CASH_HANDOVER' || type === 'HANDOVER';
      })
      .reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  }, [filteredCashTransactions]);
  const periodAdvanceTakenTotal = useMemo(() => {
    return filteredCashTransactions
      .filter((t) => (t.transaction_type || '').toUpperCase() === 'ADVANCE_TAKEN')
      .reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  }, [filteredCashTransactions]);

  const commissionStats = useMemo(() => {
    const totalEarned = filteredCommissions.reduce((sum, c) => sum + (Number(c.commission_amount) || 0), 0);
    const paidTotal = filteredCommissions
      .filter((c) => c.status === 'PAID')
      .reduce((sum, c) => sum + (Number(c.commission_amount) || 0), 0);
    const unpaidTotal = filteredCommissions
      .filter((c) => c.status !== 'PAID')
      .reduce((sum, c) => sum + (Number(c.commission_amount) || 0), 0);
    return {
      totalEarned,
      paidTotal,
      unpaidTotal,
      paidCount: filteredCommissions.filter((c) => c.status === 'PAID').length,
      unpaidCount: filteredCommissions.filter((c) => c.status !== 'PAID').length,
    };
  }, [filteredCommissions]);

  const buildExportPayload = useCallback((): SettlementExportPayload | null => {
    if (!agent) return null;
    const settings = getCachedGlobalSystemSettings();
    const companyName = settings.companyDisplayName || settings.ispName || 'Youth Net Service';

    let rows: SettlementExportRow[] = [];
    let tabTitle = 'Handover & Settlement Audit Ledger';

    if (activeTab === 'collections') {
      tabTitle = 'Client Collections Breakdown';
      rows = filteredCollections.map((tx) => ({
        timestamp: tx.payment_date || tx.created_at || '',
        transactionType: 'CLIENT COLLECTION',
        amount: Number(tx.amount_paid) || 0,
        receivedByOrParty: `@${tx.subscriber_username || 'subscriber'} (${tx.payment_mode || tx.payment_method || 'CASH'})`,
        auditNotes: [tx.invoice_id ? `Invoice: ${tx.invoice_id}` : '', tx.notes || 'Verified field collection']
          .filter(Boolean)
          .join(' | '),
      }));
    } else if (activeTab === 'commissions') {
      tabTitle = 'Commissions';
      rows = filteredCommissions.map((c) => ({
        timestamp: c.paid_at || c.created_at || '',
        transactionType: c.status === 'PAID' ? 'COMMISSION (PAID)' : 'COMMISSION (UNPAID)',
        amount: Number(c.commission_amount) || 0,
        receivedByOrParty: `@${c.subscriber_username || 'subscriber'} — ${c.client_name || ''} (${c.package_name || 'Standard Fiber'})`.trim(),
        auditNotes: c.notes || (c.status === 'PAID' ? 'Posted to Expense Ledger' : 'Awaiting payout'),
      }));
    } else {
      tabTitle = 'Handover & Settlement Audit Ledger';
      rows = filteredCashTransactions.map((tx) => ({
        timestamp: tx.created_at || '',
        transactionType: tx.transaction_type || 'CASH_HANDOVER',
        amount: Number(tx.amount) || 0,
        receivedByOrParty: tx.received_by || 'Admin',
        auditNotes: tx.notes || '—',
      }));
    }

    return {
      companyName,
      supportHelpline: settings.supportHelpline,
      tab: activeTab,
      tabTitle,
      agentName: agent.full_name || agent.username,
      agentUsername: agent.username,
      agentPhone: agent.phone || undefined,
      agentArea: agent.area || undefined,
      dateFilter,
      generatedAt: new Date(),
      summary: {
        totalCollections,
        totalCashHandedOver: periodHandedOverTotal,
        totalAdvanceTaken: periodAdvanceTakenTotal,
        totalCommissions: commissionStats.totalEarned,
        netCashInHand: cashInHand,
      },
      rows,
    };
  }, [
    agent,
    activeTab,
    filteredCollections,
    filteredCashTransactions,
    filteredCommissions,
    dateFilter,
    totalCollections,
    periodHandedOverTotal,
    periodAdvanceTakenTotal,
    commissionStats.totalEarned,
    cashInHand,
  ]);

  const handleExportExcel = () => {
    const payload = buildExportPayload();
    if (!payload) return;
    try {
      const filename = exportSettlementLedgerToExcel(payload);
      showToast(`Exported Excel spreadsheet: ${filename}`, 'success');
    } catch (err: any) {
      showToast(`Excel export failed: ${err?.message || 'Unexpected error'}`, 'error');
    }
  };

  const handleExportPdf = () => {
    const payload = buildExportPayload();
    if (!payload) return;
    try {
      const filename = exportSettlementLedgerToPdf(payload);
      showToast(`Exported PDF audit statement: ${filename}`, 'success');
    } catch (err: any) {
      showToast(`PDF export failed: ${err?.message || 'Unexpected error'}`, 'error');
    }
  };

  const handleCopyErpSql = async () => {
    try {
      await navigator.clipboard.writeText(ERP_MIGRATION_SQL);
      setCopiedErpSql(true);
      showToast('ERP SQL script copied! Paste & run in Supabase SQL Editor.');
      setTimeout(() => setCopiedErpSql(false), 3000);
    } catch {
      showToast('Could not copy automatically. Please check clipboard permissions.', 'error');
    }
  };

  const openAddCommissionModal = () => {
    setEditingCommission(null);
    setCommForm({
      subscriber_username: '',
      client_name: '',
      package_name: '30Mbps Fiber',
      commission_amount: '500',
      status: 'UNPAID',
      notes: '',
    });
    setIsCommissionModalOpen(true);
  };

  const openEditCommissionModal = (comm: SupabaseAgentCommission) => {
    setEditingCommission(comm);
    setCommForm({
      subscriber_username: comm.subscriber_username || '',
      client_name: comm.client_name || '',
      package_name: comm.package_name || '',
      commission_amount: String(comm.commission_amount ?? 0),
      status: comm.status === 'PAID' ? 'PAID' : 'UNPAID',
      notes: comm.notes || '',
    });
    setIsCommissionModalOpen(true);
  };

  const handleSaveCommission = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agent) return;
    const amt = Number(commForm.commission_amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      showToast('Please enter a positive commission amount.', 'error');
      return;
    }
    if (!commForm.subscriber_username.trim() && !commForm.client_name.trim()) {
      showToast('Please enter client username or name.', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const recordedBy = currentUser?.fullName || currentUser?.username || 'Admin';
      if (editingCommission) {
        await updateAgentCommission(
          editingCommission,
          {
            subscriber_username: commForm.subscriber_username,
            client_name: commForm.client_name,
            package_name: commForm.package_name,
            commission_amount: amt,
            status: commForm.status,
            notes: commForm.notes,
          },
          recordedBy
        );
        showToast('Commission record updated & expense ledger synced.');
      } else {
        const created = await createAgentCommission({
          agent_id: agent.id,
          agent_name: agent.full_name || agent.username,
          subscriber_username: commForm.subscriber_username || commForm.client_name,
          client_name: commForm.client_name || commForm.subscriber_username,
          package_name: commForm.package_name,
          commission_amount: amt,
          notes: commForm.notes,
        });
        if (commForm.status === 'PAID') {
          await markCommissionPaidAndPostToLedger(created, recordedBy);
          showToast(`Commission added, marked PAID, and posted to Profit & Expense Ledger.`);
        } else {
          showToast(`Commission of ${formatCurrency(amt)} logged as UNPAID.`);
        }
      }
      setIsCommissionModalOpen(false);
      await fetchAgentProfile();
    } catch (err: any) {
      showToast(`Commission save failed: ${err?.message || 'Unknown error'}`, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMarkCommissionPaid = async (comm: SupabaseAgentCommission) => {
    setMarkingPaidId(comm.id);
    try {
      const recordedBy = currentUser?.fullName || currentUser?.username || 'Admin';
      await markCommissionPaidAndPostToLedger(comm, recordedBy);
      showToast(
        `Commission (${formatCurrency(comm.commission_amount)}) marked PAID & posted to Expense Ledger!`
      );
      await fetchAgentProfile();
    } catch (err: any) {
      showToast(`Failed to mark commission paid: ${err?.message || 'Unknown error'}`, 'error');
    } finally {
      setMarkingPaidId(null);
    }
  };

  const handleConfirmDeleteCommission = async () => {
    if (!deletingCommission) return;
    setIsSubmitting(true);
    try {
      await deleteAgentCommission(deletingCommission);
      showToast('Commission deleted (and linked ledger expense removed if paid).');
      setDeletingCommission(null);
      await fetchAgentProfile();
    } catch (err: any) {
      showToast(`Delete failed: ${err?.message || 'Unknown error'}`, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ACTION 1: Handover Cash
  const handleHandoverCash = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agent) return;
    const amountNum = Number(handoverAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      showToast('Please enter a valid amount to handover', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const nextCashInHand = Math.max(0, cashInHand - amountNum);

      // 1. Update portal_users cash_in_hand
      const { error: updateError } = await supabase
        .from('portal_users')
        .update({ cash_in_hand: nextCashInHand })
        .eq('id', agent.id);

      if (updateError) throw updateError;

      // 2. Insert into agent_cash_transactions
      const { error: txError } = await supabase.from('agent_cash_transactions').insert([
        {
          agent_id: agent.id,
          agent_name: agent.full_name,
          amount: amountNum,
          transaction_type: 'CASH_HANDOVER',
          received_by: handoverReceivedBy || 'Admin',
          notes: handoverNotes || 'Cash collection handed over to Admin',
          created_at: new Date().toISOString(),
        },
      ]);

      if (txError) throw txError;

      showToast(`Successfully received ${formatCurrency(amountNum)} cash handover from @${agent.username}.`);
      setIsHandoverModalOpen(false);
      setAgent((prev) => prev ? { ...prev, cash_in_hand: nextCashInHand } : prev);
      fetchAgentProfile();
    } catch (err: any) {
      showToast(`Handover failed: ${err.message}`, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ACTION 2: Issue Advance
  const handleIssueAdvance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agent) return;
    const amountNum = Number(advanceAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      showToast('Please enter a valid advance amount', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const nextAdvanceBalance = advanceBalance + amountNum;

      // 1. Update portal_users advance_balance
      const { error: updateError } = await supabase
        .from('portal_users')
        .update({ advance_balance: nextAdvanceBalance })
        .eq('id', agent.id);

      if (updateError) throw updateError;

      // 2. Insert into agent_cash_transactions
      const { error: txError } = await supabase.from('agent_cash_transactions').insert([
        {
          agent_id: agent.id,
          agent_name: agent.full_name,
          amount: amountNum,
          transaction_type: 'ADVANCE_TAKEN',
          received_by: agent.full_name,
          notes: advanceNotes || 'Advance issued to agent',
          created_at: new Date().toISOString(),
        },
      ]);

      if (txError) throw txError;

      showToast(`Issued ${formatCurrency(amountNum)} advance to @${agent.username}.`);
      setIsAdvanceModalOpen(false);
      setAdvanceAmount('');
      setAgent((prev) => prev ? { ...prev, advance_balance: nextAdvanceBalance } : prev);
      fetchAgentProfile();
    } catch (err: any) {
      showToast(`Failed to issue advance: ${err.message}`, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ACTION 3: Advance Return / Salary Deduction
  const handleAdvanceReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agent) return;
    const amountNum = Number(returnAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      showToast('Please enter a valid deduction amount', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const nextAdvanceBalance = Math.max(0, advanceBalance - amountNum);

      // 1. Update portal_users advance_balance
      const { error: updateError } = await supabase
        .from('portal_users')
        .update({ advance_balance: nextAdvanceBalance })
        .eq('id', agent.id);

      if (updateError) throw updateError;

      // 2. Insert into agent_cash_transactions
      const { error: txError } = await supabase.from('agent_cash_transactions').insert([
        {
          agent_id: agent.id,
          agent_name: agent.full_name,
          amount: amountNum,
          transaction_type: 'ADVANCE_RETURN',
          received_by: 'Admin / Accounts',
          notes: returnNotes || 'Advance salary deduction recorded',
          created_at: new Date().toISOString(),
        },
      ]);

      if (txError) throw txError;

      showToast(`Recorded ${formatCurrency(amountNum)} advance deduction for @${agent.username}.`);
      setIsAdvanceReturnModalOpen(false);
      setReturnAmount('');
      setAgent((prev) => prev ? { ...prev, advance_balance: nextAdvanceBalance } : prev);
      fetchAgentProfile();
    } catch (err: any) {
      showToast(`Failed to record deduction: ${err.message}`, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ACTION 4: Payout Salary
  const handlePayoutSalary = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agent) return;
    const amountNum = Number(salaryPayoutAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      showToast('Please enter a valid salary amount', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      // Record transaction
      const { error: txError } = await supabase.from('agent_cash_transactions').insert([
        {
          agent_id: agent.id,
          agent_name: agent.full_name,
          amount: amountNum,
          transaction_type: 'SALARY_PAYOUT',
          received_by: agent.full_name,
          notes: salaryNotes || 'Monthly salary disbursement',
          created_at: new Date().toISOString(),
        },
      ]);

      if (txError) throw txError;

      showToast(`Salary of ${formatCurrency(amountNum)} disbursed to @${agent.username}.`);
      setIsSalaryPayoutModalOpen(false);
      fetchAgentProfile();
    } catch (err: any) {
      showToast(`Salary payout failed: ${err.message}`, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading && !agent) {
    return (
      <div className="py-24 text-center font-mono text-xs text-slate-400 space-y-3">
        <div className="w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto" />
        <p>Loading Agent Financial Profile from Supabase...</p>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="p-8 text-center bg-slate-900 border border-slate-800 rounded-2xl space-y-3">
        <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto" />
        <h3 className="font-bold text-white text-base">Field Recovery Agent Not Found</h3>
        <p className="text-slate-400 text-xs">Could not locate an agent matching &ldquo;{username || agentId}&rdquo;.</p>
        <button
          onClick={onBack}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold transition cursor-pointer"
        >
          &larr; Back to Directory
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6 text-xs font-sans animate-fadeIn">
      {/* Toast Notification */}
      {toastMessage && (
        <div
          className={`fixed top-4 right-4 z-50 p-4 rounded-xl border shadow-2xl flex items-center gap-2.5 text-xs font-mono animate-fadeIn ${
            toastMessage.type === 'success'
              ? 'bg-emerald-950/95 border-emerald-600 text-emerald-200'
              : 'bg-rose-950/95 border-rose-600 text-rose-200'
          }`}
        >
          {toastMessage.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          )}
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* Top Breadcrumb & Navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-slate-400 hover:text-white transition font-mono text-xs cursor-pointer group"
        >
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition" />
          <span>&larr; Back to User Directory</span>
        </button>
        <span className="font-mono text-[11px] text-slate-500">
          Agent UUID: <code className="text-slate-400">{agent.id}</code>
        </span>
      </div>

      {/* Header & Agent Profile Card */}
      <div className="bg-[#0f172a] border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-800/80">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-cyan-950 border border-cyan-700 text-cyan-300 font-bold text-lg flex items-center justify-center shadow-lg shadow-cyan-950/50">
              {agent.full_name?.slice(0, 2).toUpperCase() || 'AG'}
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-xl font-bold text-white tracking-tight">{agent.full_name}</h1>
                <span className="px-2.5 py-0.5 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-800 font-mono text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
                  <UserCheck className="w-3 h-3 text-cyan-400" />
                  <span>Field Agent</span>
                </span>
                <span
                  className={`px-2 py-0.5 rounded-full font-mono text-[10px] font-bold ${
                    agent.account_status !== 'SUSPENDED'
                      ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                      : 'bg-rose-950 text-rose-300 border border-rose-800'
                  }`}
                >
                  {agent.account_status !== 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED'}
                </span>
              </div>
              <p className="text-slate-400 text-xs font-mono mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
                <span>
                  Username: <strong className="text-cyan-400">@{agent.username}</strong>
                </span>
                <span>&bull;</span>
                <span className="flex items-center gap-1">
                  <Phone className="w-3 h-3 text-slate-500" />
                  <span>{agent.phone || '+92 300 0000000'}</span>
                </span>
                <span>&bull;</span>
                <span className="flex items-center gap-1">
                  <MapPin className="w-3 h-3 text-slate-500" />
                  <span>{agent.area || 'Saddar Node'}</span>
                </span>
              </p>
            </div>
          </div>

          {/* Quick Action Button Bar */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setIsEditStaffModalOpen(true)}
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold text-xs flex items-center gap-1.5 transition cursor-pointer active:scale-95"
              title="Edit Staff Profile: Name, Phone, Area, Salary, Status, Password"
            >
              <Edit className="w-3.5 h-3.5 text-cyan-400" />
              <span>Edit Profile</span>
            </button>

            <button
              onClick={() => {
                setHandoverAmount(String(cashInHand));
                setIsHandoverModalOpen(true);
              }}
              className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition shadow-md shadow-emerald-950/50 cursor-pointer active:scale-95"
            >
              <Wallet className="w-3.5 h-3.5" />
              <span>Handover Cash</span>
            </button>

            <button
              onClick={() => setIsAdvanceModalOpen(true)}
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold text-xs flex items-center gap-1.5 transition cursor-pointer active:scale-95"
            >
              <DollarSign className="w-3.5 h-3.5 text-amber-400" />
              <span>Issue Advance</span>
            </button>

            <button
              onClick={() => setIsAdvanceReturnModalOpen(true)}
              className="px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 font-semibold text-xs flex items-center gap-1.5 transition cursor-pointer active:scale-95"
            >
              <Receipt className="w-3.5 h-3.5 text-purple-400" />
              <span>Advance Return</span>
            </button>

            <button
              onClick={() => {
                setSalaryPayoutAmount(String(baseSalary));
                setIsSalaryPayoutModalOpen(true);
              }}
              className="px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 font-semibold text-xs flex items-center gap-1.5 transition cursor-pointer active:scale-95"
            >
              <CreditCard className="w-3.5 h-3.5 text-cyan-400" />
              <span>Payout Salary</span>
            </button>
          </div>
        </div>

        {/* 4 Financial KPI Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* 1. Net Cash-in-Hand Balance (Recovery Pending Handover) */}
          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
            <span className="text-[10px] text-slate-400 font-mono uppercase block flex items-center justify-between">
              <span>Net Cash-in-Hand Balance</span>
              <Wallet className="w-3.5 h-3.5 text-emerald-400" />
            </span>
            <div className="text-2xl font-bold font-mono tabular-nums text-emerald-400">
              {formatCurrency(cashInHand)}
            </div>
            <span className="text-[10px] text-slate-500 font-mono tabular-nums block">
              Total Cash Handover: {formatCurrency(liveLedgerTotals.totalHandedOverAll)}
            </span>
          </div>

          {/* 2. Advance Balance */}
          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
            <span className="text-[10px] text-slate-400 font-mono uppercase block flex items-center justify-between">
              <span>Advance Balance</span>
              <DollarSign className="w-3.5 h-3.5 text-amber-400" />
            </span>
            <div className="text-2xl font-bold font-mono tabular-nums text-amber-400">
              {formatCurrency(advanceBalance)}
            </div>
            <span className="text-[10px] text-slate-500 font-mono tabular-nums block">
              Advance Taken: {formatCurrency(liveLedgerTotals.totalAdvanceTakenAll)}
            </span>
          </div>

          {/* 3. Base Salary */}
          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
            <span className="text-[10px] text-slate-400 font-mono uppercase block flex items-center justify-between">
              <span>Base Monthly Salary</span>
              <CreditCard className="w-3.5 h-3.5 text-indigo-400" />
            </span>
            <div className="text-2xl font-bold font-mono text-indigo-300">
              {formatCurrency(baseSalary)}
            </div>
            <span className="text-[10px] text-slate-500 font-mono block">
              Agreed monthly compensation
            </span>
          </div>

          {/* 4. Period Client Collections */}
          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
            <span className="text-[10px] text-slate-400 font-mono uppercase block flex items-center justify-between">
              <span>Recovery ({describeDateFilter(dateFilter)})</span>
              <TrendingUp className="w-3.5 h-3.5 text-cyan-400" />
            </span>
            <div className="text-2xl font-bold font-mono tabular-nums text-cyan-300">
              {formatCurrency(totalCollections)}
            </div>
            <span className="text-[10px] text-slate-500 font-mono tabular-nums block">
              {filteredCollections.length} txns · Handed over: {formatCurrency(periodHandedOverTotal)}
            </span>
          </div>
        </div>
      </div>

      {/* Month-Wise & Custom Date Range Filter Toolbar */}
      <DateFilterToolbar
        value={dateFilter}
        onChange={setDateFilter}
        totalCount={collections.length + cashTransactions.length + commissions.length}
        filteredCount={filteredCollections.length + filteredCashTransactions.length + filteredCommissions.length}
        recordLabel="ledger entries"
        extraActions={
          <>
            <button
              type="button"
              onClick={handleExportExcel}
              className="px-3 py-1.5 rounded-lg bg-emerald-950/60 hover:bg-emerald-900/75 text-emerald-300 border border-emerald-700/80 font-semibold text-xs flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0"
              title="Download filtered report as Excel (.xlsx)"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
              <span>Export Excel</span>
            </button>
            <button
              type="button"
              onClick={handleExportPdf}
              className="px-3 py-1.5 rounded-lg bg-rose-950/60 hover:bg-rose-900/75 text-rose-300 border border-rose-700/80 font-semibold text-xs flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0"
              title="Download printable A4 PDF audit statement"
            >
              <FileDown className="w-3.5 h-3.5 text-rose-400" />
              <span>Export PDF</span>
            </button>
          </>
        }
      />

      {/* Financial Navigation Tabs */}
      <div className="flex items-center overflow-x-auto gap-2 border-b border-slate-800 pb-2 font-mono no-scrollbar">
        <button
          onClick={() => setActiveTab('collections')}
          className={`shrink-0 whitespace-nowrap flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-xs transition cursor-pointer ${
            activeTab === 'collections'
              ? 'bg-cyan-600 text-slate-950 shadow-md shadow-cyan-950/40'
              : 'bg-slate-900 text-slate-300 hover:text-white border border-slate-800'
          }`}
        >
          <Receipt className="w-3.5 h-3.5 shrink-0" />
          <span>Client Collections Breakdown ({filteredCollections.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('ledger')}
          className={`shrink-0 whitespace-nowrap flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-xs transition cursor-pointer ${
            activeTab === 'ledger'
              ? 'bg-cyan-600 text-slate-950 shadow-md shadow-cyan-950/40'
              : 'bg-slate-900 text-slate-300 hover:text-white border border-slate-800'
          }`}
        >
          <FileText className="w-3.5 h-3.5 shrink-0" />
          <span>Handover &amp; Settlement Audit Ledger ({filteredCashTransactions.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('commissions')}
          className={`shrink-0 whitespace-nowrap flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-xs transition cursor-pointer ${
            activeTab === 'commissions'
              ? 'bg-purple-600 text-white shadow-md shadow-purple-950/40'
              : 'bg-slate-900 text-slate-300 hover:text-white border border-slate-800'
          }`}
        >
          <Award className="w-3.5 h-3.5 shrink-0" />
          <span>Commissions ({filteredCommissions.length})</span>
          {commissionStats.unpaidCount > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px]">
              {commissionStats.unpaidCount} Unpaid
            </span>
          )}
        </button>
      </div>

      {/* TAB 1: Client Collections Breakdown */}
      {activeTab === 'collections' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-950 border-b border-slate-800 text-slate-400 font-mono text-[11px] uppercase tracking-wider">
                  <th className="py-3.5 px-4">Date / Time</th>
                  <th className="py-3.5 px-4">Client Username</th>
                  <th className="py-3.5 px-4">Invoice #</th>
                  <th className="py-3.5 px-4">Amount Collected</th>
                  <th className="py-3.5 px-4">Payment Mode</th>
                  <th className="py-3.5 px-4">Notes</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 font-mono">
                {filteredCollections.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-slate-500 font-mono">
                      No customer collections recorded in {describeDateFilter(dateFilter)} for this field agent.
                    </td>
                  </tr>
                ) : (
                  filteredCollections.map((tx) => {
                    const isSyntheticInvRow = String(tx.id || '').startsWith('inv-tx-');
                    const actualRecordId = isSyntheticInvRow
                      ? String(tx.id || '').replace(/^inv-tx-/, '')
                      : String(tx.id || '');
                    const rowPayload: FieldAuditLedgerRow = {
                      uid: String(tx.id || actualRecordId),
                      recordId: actualRecordId,
                      sourceTable: isSyntheticInvRow ? 'invoices' : 'payment_transactions',
                      invoiceId: tx.invoice_id || null,
                      subscriberUsername: tx.subscriber_username,
                      agentId: tx.collected_by_id || agent.id,
                      agentName: tx.collected_by_name || agent.full_name,
                      entryType: 'COLLECTION',
                      amount: Number(tx.amount_paid) || 0,
                      previousAmount: tx.previous_amount ?? null,
                      paymentMethod: tx.payment_mode || tx.payment_method || 'Cash Handover',
                      collectedAt: tx.payment_date || tx.created_at || new Date().toISOString(),
                      remarks: tx.notes || '',
                      editedBy: tx.edited_by || null,
                      editedAt: tx.edited_at || null,
                      editReason: tx.edit_reason || null,
                    };
                    return (
                      <tr key={tx.id || Math.random()} className="hover:bg-slate-950/50 transition">
                        <td className="py-3.5 px-4 text-slate-400 whitespace-nowrap">
                          {tx.payment_date || tx.created_at
                            ? new Date(tx.payment_date || tx.created_at || '').toLocaleString()
                            : 'Recent'}
                        </td>
                        <td className="py-3.5 px-4 font-bold text-cyan-400">
                          @{tx.subscriber_username}
                        </td>
                        <td className="py-3.5 px-4 text-slate-300">
                          {tx.invoice_id || 'Direct'}
                        </td>
                        <td className="py-3.5 px-4 font-bold text-emerald-400 tabular-nums">
                          {formatCurrency(Number(tx.amount_paid) || 0)}
                        </td>
                        <td className="py-3.5 px-4">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-950 text-slate-300 border border-slate-800">
                            {tx.payment_mode || tx.payment_method || 'CASH'}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-slate-400 max-w-xs truncate" title={tx.notes || 'Verified field collection'}>
                          {tx.notes || 'Verified field collection'}
                        </td>
                        <td className="py-3.5 px-4 text-right whitespace-nowrap">
                          {actualRecordId && (
                            <div className="inline-flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => setEditingLedgerEntry(rowPayload)}
                                className="px-2.5 py-1 rounded-lg bg-blue-950/70 hover:bg-blue-900/80 text-blue-300 border border-blue-800/80 font-semibold text-xs inline-flex items-center gap-1 transition cursor-pointer"
                                title="Edit collection entry"
                              >
                                <Edit className="w-3 h-3" />
                                <span>Edit</span>
                              </button>
                              {isMasterAdmin && (
                                <button
                                  type="button"
                                  onClick={() => setDeletingLedgerEntry(rowPayload)}
                                  className="px-2.5 py-1 rounded-lg bg-rose-950/70 hover:bg-rose-900/80 text-rose-300 border border-rose-800/80 font-semibold text-xs inline-flex items-center gap-1 transition cursor-pointer"
                                  title="Delete collection entry (Master Admin)"
                                >
                                  <Trash2 className="w-3 h-3" />
                                  <span>Delete</span>
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: Handover & Settlement Audit Ledger */}
      {activeTab === 'ledger' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-950 border-b border-slate-800 text-slate-400 font-mono text-[11px] uppercase tracking-wider">
                  <th className="py-3.5 px-4">Timestamp</th>
                  <th className="py-3.5 px-4">Transaction Type</th>
                  <th className="py-3.5 px-4">Amount</th>
                  <th className="py-3.5 px-4">Handed Over To / Received By</th>
                  <th className="py-3.5 px-4">Audit Notes</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 font-mono">
                {filteredCashTransactions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-500 font-mono">
                      No cash handovers or advance transactions recorded in {describeDateFilter(dateFilter)}.
                    </td>
                  </tr>
                ) : (
                  filteredCashTransactions.map((tx) => {
                    const txTypeUpper = (tx.transaction_type || '').toUpperCase();
                    const isHandover = txTypeUpper === 'CASH_HANDOVER' || txTypeUpper === 'HANDOVER';
                    const isAdvanceTaken = txTypeUpper === 'ADVANCE_TAKEN';
                    const isAdvanceReturn = txTypeUpper === 'ADVANCE_RETURN' || txTypeUpper === 'ADVANCE_DEDUCTION';
                    const rowPayload: FieldAuditLedgerRow = {
                      uid: `act-${tx.id}`,
                      recordId: String(tx.id || ''),
                      sourceTable: 'agent_cash_transactions',
                      agentId: tx.agent_id || agent.id,
                      agentName: tx.agent_name || agent.full_name,
                      entryType: tx.transaction_type || 'CASH_HANDOVER',
                      amount: Number(tx.amount) || 0,
                      previousAmount: tx.previous_amount ?? null,
                      paymentMethod: tx.received_by || 'Admin',
                      collectedAt: tx.created_at || new Date().toISOString(),
                      remarks: tx.notes || '',
                      editedBy: tx.edited_by || null,
                      editedAt: tx.edited_at || null,
                      editReason: tx.edit_reason || null,
                    };

                    return (
                      <tr key={tx.id || Math.random()} className="hover:bg-slate-950/50 transition">
                        <td className="py-3.5 px-4 text-slate-400 whitespace-nowrap">
                          {tx.created_at ? new Date(tx.created_at).toLocaleString() : 'Recent'}
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
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
                        </td>
                        <td className="py-3.5 px-4 font-bold text-white tabular-nums whitespace-nowrap">
                          {formatCurrency(Number(tx.amount) || 0)}
                        </td>
                        <td className="py-3.5 px-4 text-slate-300">
                          {tx.received_by || 'Admin'}
                        </td>
                        <td className="py-3.5 px-4 text-slate-400 max-w-md break-words" title={tx.notes || ''}>
                          {tx.notes || '—'}
                        </td>
                        <td className="py-3.5 px-4 text-right whitespace-nowrap">
                          {tx.id && (
                            <div className="inline-flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => setEditingLedgerEntry(rowPayload)}
                                className="px-2.5 py-1 rounded-lg bg-blue-950/70 hover:bg-blue-900/80 text-blue-300 border border-blue-800/80 font-semibold text-xs inline-flex items-center gap-1 transition cursor-pointer"
                                title="Edit handover / settlement entry"
                              >
                                <Edit className="w-3 h-3" />
                                <span>Edit</span>
                              </button>
                              {isMasterAdmin && (
                                <button
                                  type="button"
                                  onClick={() => setDeletingLedgerEntry(rowPayload)}
                                  className="px-2.5 py-1 rounded-lg bg-rose-950/70 hover:bg-rose-900/80 text-rose-300 border border-rose-800/80 font-semibold text-xs inline-flex items-center gap-1 transition cursor-pointer"
                                  title="Delete ledger entry (Master Admin)"
                                >
                                  <Trash2 className="w-3 h-3" />
                                  <span>Delete</span>
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: New-Connection Commissions Tracker */}
      {activeTab === 'commissions' && (
        <div className="space-y-4">
          {missingCommissionTable && (
            <div className="p-4 rounded-2xl bg-amber-950/40 border border-amber-700/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-amber-300 font-bold text-xs">
                  <Database className="w-4 h-4 shrink-0" />
                  <span>Supabase `agent_commissions` Table Setup Required</span>
                </div>
                <p className="text-[11px] text-amber-200/80">
                  Copy the one-click ERP SQL script and run it in Supabase SQL Editor to persist new-connection commissions &amp; hardware inventory.
                </p>
              </div>
              <button
                type="button"
                onClick={handleCopyErpSql}
                className="shrink-0 whitespace-nowrap px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 cursor-pointer transition"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>{copiedErpSql ? 'Copied ERP SQL!' : 'Copy ERP SQL'}</span>
              </button>
            </div>
          )}

          {/* 3 Commission Summary Cards + Add Button */}
          <div className="flex flex-col lg:flex-row lg:items-stretch justify-between gap-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 flex-1">
              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
                <span className="text-[10px] text-slate-400 font-mono uppercase block">
                  Total Earned Commission
                </span>
                <div className="text-xl font-bold font-mono tabular-nums text-white">
                  {formatCurrency(commissionStats.totalEarned)}
                </div>
                <span className="text-[10px] text-slate-400 font-mono block">
                  {commissions.length} referred connection{commissions.length === 1 ? '' : 's'}
                </span>
              </div>

              <div className="p-4 rounded-xl bg-slate-900 border border-emerald-800/50 space-y-1">
                <span className="text-[10px] text-emerald-400 font-mono uppercase block">
                  Paid Commission (In Ledger)
                </span>
                <div className="text-xl font-bold font-mono tabular-nums text-emerald-400">
                  {formatCurrency(commissionStats.paidTotal)}
                </div>
                <span className="text-[10px] text-slate-400 font-mono block">
                  {commissionStats.paidCount} posted to isp_expenses
                </span>
              </div>

              <div className="p-4 rounded-xl bg-slate-900 border border-amber-700/50 space-y-1">
                <span className="text-[10px] text-amber-400 font-mono uppercase block">
                  Pending Unpaid Commission
                </span>
                <div className="text-xl font-bold font-mono tabular-nums text-amber-300">
                  {formatCurrency(commissionStats.unpaidTotal)}
                </div>
                <span className="text-[10px] text-slate-400 font-mono block">
                  {commissionStats.unpaidCount} awaiting payout
                </span>
              </div>
            </div>

            <div className="flex items-center justify-end lg:items-start">
              <button
                type="button"
                onClick={openAddCommissionModal}
                className="w-full lg:w-auto shrink-0 whitespace-nowrap px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-md transition cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>+ Add Commission</span>
              </button>
            </div>
          </div>

          {/* Commissions CRUD Table */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-950 border-b border-slate-800 text-slate-400 font-mono text-[11px] uppercase tracking-wider">
                    <th className="py-3.5 px-4">Date</th>
                    <th className="py-3.5 px-4">Client / Username</th>
                    <th className="py-3.5 px-4">Package</th>
                    <th className="py-3.5 px-4 text-right">Commission (Rs.)</th>
                    <th className="py-3.5 px-4">Status &amp; Ledger</th>
                    <th className="py-3.5 px-4">Notes</th>
                    <th className="py-3.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80 font-mono">
                  {filteredCommissions.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-slate-400 font-mono">
                        No new-connection commissions recorded in {describeDateFilter(dateFilter)} for @{agent.username}.
                      </td>
                    </tr>
                  ) : (
                    filteredCommissions.map((c) => {
                      const isPaid = c.status === 'PAID';
                      const dateLabel = c.created_at
                        ? new Date(c.created_at).toLocaleDateString()
                        : 'Recent';
                      return (
                        <tr key={c.id} className="hover:bg-slate-950/50 transition">
                          <td className="py-3.5 px-4 text-slate-400 whitespace-nowrap">
                            {dateLabel}
                          </td>
                          <td className="py-3.5 px-4">
                            <div className="font-bold text-cyan-400">
                              @{c.subscriber_username || 'subscriber'}
                            </div>
                            <div className="text-[11px] text-slate-300 font-sans">
                              {c.client_name}
                            </div>
                          </td>
                          <td className="py-3.5 px-4 text-slate-200 whitespace-nowrap">
                            {c.package_name || 'Standard Fiber'}
                          </td>
                          <td className="py-3.5 px-4 text-right font-bold tabular-nums text-white whitespace-nowrap">
                            {formatCurrency(Number(c.commission_amount) || 0)}
                          </td>
                          <td className="py-3.5 px-4 whitespace-nowrap">
                            {isPaid ? (
                              <div className="space-y-0.5">
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-700">
                                  <Check className="w-3 h-3" />
                                  PAID
                                </span>
                                {c.paid_at && (
                                  <div className="text-[10px] text-slate-400">
                                    {new Date(c.paid_at).toLocaleDateString()}
                                    {c.ledger_entry_id ? ' · Ledger Synced' : ''}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-700">
                                <Clock className="w-3 h-3" />
                                UNPAID
                              </span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-slate-400 max-w-[200px] truncate font-sans">
                            {c.notes || '—'}
                          </td>
                          <td className="py-3.5 px-4 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1.5">
                              {!isPaid && (
                                <button
                                  type="button"
                                  disabled={markingPaidId === c.id}
                                  onClick={() => handleMarkCommissionPaid(c)}
                                  className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-[11px] inline-flex items-center gap-1 transition cursor-pointer disabled:opacity-50"
                                  title="Mark Paid & Auto-Post Expense to Profit & Expense Ledger"
                                >
                                  <CheckCircle2 className="w-3 h-3" />
                                  <span>
                                    {markingPaidId === c.id ? 'Posting...' : 'Mark Paid & Post'}
                                  </span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => openEditCommissionModal(c)}
                                className="px-2.5 py-1 rounded-lg bg-blue-950/70 hover:bg-blue-900/80 text-blue-300 border border-blue-800/80 font-semibold text-xs inline-flex items-center gap-1 transition cursor-pointer"
                                title="Edit Commission"
                              >
                                <Edit className="w-3 h-3" />
                                <span>Edit</span>
                              </button>
                              {isMasterAdmin && (
                                <button
                                  type="button"
                                  onClick={() => setDeletingCommission(c)}
                                  className="px-2.5 py-1 rounded-lg bg-rose-950/70 hover:bg-rose-900/80 text-rose-300 border border-rose-800/80 font-semibold text-xs inline-flex items-center gap-1 transition cursor-pointer"
                                  title="Delete Commission (Master Admin)"
                                >
                                  <Trash2 className="w-3 h-3" />
                                  <span>Delete</span>
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
        </div>
      )}

      {/* MODAL 1: Cash Handover Modal */}
      {isHandoverModalOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 overflow-y-auto animate-fadeIn font-sans">
          <div className="w-[95vw] sm:w-full max-w-lg max-h-[90vh] overflow-y-auto mx-auto my-auto rounded-2xl box-border bg-slate-900 border border-slate-800 shadow-2xl">
            <div className="flex items-center justify-between p-4 bg-slate-950 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Wallet className="w-4 h-4 text-emerald-400" />
                <h3 className="font-bold text-white text-sm">Handover Recovery Cash</h3>
              </div>
              <button
                onClick={() => setIsHandoverModalOpen(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleHandoverCash} className="p-5 space-y-4 text-xs">
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                <div className="flex justify-between text-slate-400">
                  <span>Current Cash in Hand:</span>
                  <span className="font-mono text-emerald-400 font-bold">{formatCurrency(cashInHand)}</span>
                </div>
              </div>

              <div>
                <label className="text-slate-300 font-bold block mb-1">Amount to Handover (Rs.)</label>
                <input
                  type="number"
                  value={handoverAmount}
                  onChange={(e) => setHandoverAmount(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-cyan-500"
                  required
                  min="1"
                  max={cashInHand > 0 ? cashInHand : undefined}
                />
              </div>

              <div>
                <label className="text-slate-300 font-bold block mb-1">Received By (Admin / Cashier)</label>
                <input
                  type="text"
                  value={handoverReceivedBy}
                  onChange={(e) => setHandoverReceivedBy(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-cyan-500"
                  required
                />
              </div>

              <div>
                <label className="text-slate-300 font-bold block mb-1">Notes / Reference</label>
                <textarea
                  rows={2}
                  value={handoverNotes}
                  onChange={(e) => setHandoverNotes(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsHandoverModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-bold cursor-pointer transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-slate-950 rounded-xl font-bold cursor-pointer transition shadow-lg shadow-emerald-950/50 disabled:opacity-50"
                >
                  {isSubmitting ? 'Recording Handover...' : 'Confirm Cash Received'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Issue Advance Modal */}
      {isAdvanceModalOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 overflow-y-auto animate-fadeIn font-sans">
          <div className="w-[95vw] sm:w-full max-w-lg max-h-[90vh] overflow-y-auto mx-auto my-auto rounded-2xl box-border bg-slate-900 border border-slate-800 shadow-2xl">
            <div className="flex items-center justify-between p-4 bg-slate-950 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-amber-400" />
                <h3 className="font-bold text-white text-sm">Issue Agent Cash Advance</h3>
              </div>
              <button
                onClick={() => setIsAdvanceModalOpen(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleIssueAdvance} className="p-5 space-y-4 text-xs">
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                <div className="flex justify-between text-slate-400">
                  <span>Current Advance Balance:</span>
                  <span className="font-mono text-amber-400 font-bold">{formatCurrency(advanceBalance)}</span>
                </div>
              </div>

              <div>
                <label className="text-slate-300 font-bold block mb-1">Advance Amount (Rs.)</label>
                <input
                  type="number"
                  placeholder="e.g. 5000"
                  value={advanceAmount}
                  onChange={(e) => setAdvanceAmount(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-cyan-500"
                  required
                  min="1"
                />
              </div>

              <div>
                <label className="text-slate-300 font-bold block mb-1">Reason / Notes</label>
                <textarea
                  rows={2}
                  value={advanceNotes}
                  onChange={(e) => setAdvanceNotes(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAdvanceModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-bold cursor-pointer transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-slate-950 rounded-xl font-bold cursor-pointer transition shadow-lg shadow-amber-950/50 disabled:opacity-50"
                >
                  {isSubmitting ? 'Issuing Advance...' : 'Confirm Advance Issue'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: Advance Return Modal */}
      {isAdvanceReturnModalOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 overflow-y-auto animate-fadeIn font-sans">
          <div className="w-[95vw] sm:w-full max-w-lg max-h-[90vh] overflow-y-auto mx-auto my-auto rounded-2xl box-border bg-slate-900 border border-slate-800 shadow-2xl">
            <div className="flex items-center justify-between p-4 bg-slate-950 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Receipt className="w-4 h-4 text-purple-400" />
                <h3 className="font-bold text-white text-sm">Advance Return / Salary Deduction</h3>
              </div>
              <button
                onClick={() => setIsAdvanceReturnModalOpen(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAdvanceReturn} className="p-5 space-y-4 text-xs">
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                <div className="flex justify-between text-slate-400">
                  <span>Current Outstanding Advance:</span>
                  <span className="font-mono text-amber-400 font-bold">{formatCurrency(advanceBalance)}</span>
                </div>
              </div>

              <div>
                <label className="text-slate-300 font-bold block mb-1">Return / Deduction Amount (Rs.)</label>
                <input
                  type="number"
                  placeholder="e.g. 2500"
                  value={returnAmount}
                  onChange={(e) => setReturnAmount(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-cyan-500"
                  required
                  min="1"
                  max={advanceBalance > 0 ? advanceBalance : undefined}
                />
              </div>

              <div>
                <label className="text-slate-300 font-bold block mb-1">Deduction Notes</label>
                <textarea
                  rows={2}
                  value={returnNotes}
                  onChange={(e) => setReturnNotes(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAdvanceReturnModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-bold cursor-pointer transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-bold cursor-pointer transition shadow-lg shadow-purple-950/50 disabled:opacity-50"
                >
                  {isSubmitting ? 'Recording Deduction...' : 'Confirm Advance Return'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 4: Salary Payout Modal */}
      {isSalaryPayoutModalOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 overflow-y-auto animate-fadeIn font-sans">
          <div className="w-[95vw] sm:w-full max-w-lg max-h-[90vh] overflow-y-auto mx-auto my-auto rounded-2xl box-border bg-slate-900 border border-slate-800 shadow-2xl">
            <div className="flex items-center justify-between p-4 bg-slate-950 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-cyan-400" />
                <h3 className="font-bold text-white text-sm">Disburse Monthly Salary</h3>
              </div>
              <button
                onClick={() => setIsSalaryPayoutModalOpen(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handlePayoutSalary} className="p-5 space-y-4 text-xs">
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                <div className="flex justify-between text-slate-400">
                  <span>Base Monthly Salary:</span>
                  <span className="font-mono text-indigo-300 font-bold">{formatCurrency(baseSalary)}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Outstanding Advance:</span>
                  <span className="font-mono text-amber-400">{formatCurrency(advanceBalance)}</span>
                </div>
              </div>

              <div>
                <label className="text-slate-300 font-bold block mb-1">Net Payout Amount (Rs.)</label>
                <input
                  type="number"
                  value={salaryPayoutAmount}
                  onChange={(e) => setSalaryPayoutAmount(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-cyan-500"
                  required
                  min="1"
                />
              </div>

              <div>
                <label className="text-slate-300 font-bold block mb-1">Disbursement Remarks</label>
                <textarea
                  rows={2}
                  value={salaryNotes}
                  onChange={(e) => setSalaryNotes(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsSalaryPayoutModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-bold cursor-pointer transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-slate-950 rounded-xl font-bold cursor-pointer transition shadow-lg shadow-cyan-950/50 disabled:opacity-50"
                >
                  {isSubmitting ? 'Processing Payout...' : 'Disburse Salary'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <EditLedgerEntryModal
        entry={editingLedgerEntry}
        agents={allAgents.length > 0 ? allAgents : [agent]}
        editedBy={currentUser?.fullName ? `${currentUser.fullName} (@${currentUser.username})` : 'NOC Admin'}
        onClose={() => setEditingLedgerEntry(null)}
        onErrorToast={(errMsg) => showToast(`❌ ${errMsg}`, 'error')}
        onVerifiedSuccess={async (result: VerifiedLedgerUpdateResult) => {
          const updatedBal = result.reconciledBalances?.[agent.id];
          if (updatedBal) {
            setAgent((prev) =>
              prev
                ? {
                    ...prev,
                    cash_in_hand: updatedBal.cashInHand,
                    advance_balance: updatedBal.advanceBalance,
                  }
                : prev
            );
          }
          await fetchAgentProfile();
          showToast('Ledger entry updated & agent cash balance recalculated.', 'success');
        }}
      />

      <DeleteLedgerEntryModal
        entry={deletingLedgerEntry}
        actorRole={currentUser?.role || ''}
        onClose={() => setDeletingLedgerEntry(null)}
        onErrorToast={(errMsg) => showToast(`❌ ${errMsg}`, 'error')}
        onVerifiedDelete={async (result: VerifiedLedgerDeleteResult, deletedEntry: FieldAuditLedgerRow) => {
          if (deletedEntry.sourceTable === 'agent_cash_transactions') {
            setCashTransactions((prev) => prev.filter((item) => String(item.id) !== deletedEntry.recordId));
          } else {
            setCollections((prev) =>
              prev.filter(
                (item) =>
                  String(item.id) !== deletedEntry.recordId &&
                  String(item.id) !== `inv-tx-${deletedEntry.recordId}`
              )
            );
          }
          const updatedBal = result.reconciledBalances?.[agent.id];
          if (updatedBal) {
            setAgent((prev) =>
              prev
                ? {
                    ...prev,
                    cash_in_hand: updatedBal.cashInHand,
                    advance_balance: updatedBal.advanceBalance,
                  }
                : prev
            );
          }
          await fetchAgentProfile();
          showToast('Ledger entry deleted & agent cash balance recalculated.', 'success');
        }}
      />

      {/* Edit Staff Profile Modal */}
      <EditStaffModal
        isOpen={isEditStaffModalOpen}
        onClose={() => setIsEditStaffModalOpen(false)}
        staff={agent}
        onSuccess={() => {
          showToast(`Staff profile for @${agent.username} updated successfully.`);
          fetchAgentProfile();
        }}
      />

      {/* MODAL 5: Add / Edit New-Connection Commission */}
      {isCommissionModalOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 overflow-y-auto animate-fadeIn font-sans">
          <div className="w-[95vw] sm:w-full max-w-lg max-h-[90vh] overflow-y-auto mx-auto my-auto rounded-2xl box-border bg-slate-900 border border-slate-800 shadow-2xl">
            <div className="flex items-center justify-between p-4 bg-slate-950 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Award className="w-4 h-4 text-purple-400" />
                <h3 className="font-bold text-white text-sm">
                  {editingCommission ? 'Edit Agent Commission' : 'Add New-Connection Commission'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsCommissionModalOpen(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveCommission} className="p-5 space-y-3.5 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-300 font-bold block mb-1">Subscriber Username</label>
                  <input
                    type="text"
                    value={commForm.subscriber_username}
                    onChange={(e) =>
                      setCommForm((p) => ({ ...p, subscriber_username: e.target.value }))
                    }
                    placeholder="e.g. ali_fiber"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-purple-500"
                  />
                </div>
                <div>
                  <label className="text-slate-300 font-bold block mb-1">Client Full Name *</label>
                  <input
                    type="text"
                    required
                    value={commForm.client_name}
                    onChange={(e) => setCommForm((p) => ({ ...p, client_name: e.target.value }))}
                    placeholder="e.g. Ali Raza"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-purple-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-300 font-bold block mb-1">Package Name</label>
                  <input
                    type="text"
                    value={commForm.package_name}
                    onChange={(e) => setCommForm((p) => ({ ...p, package_name: e.target.value }))}
                    placeholder="e.g. 30Mbps Fiber"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-purple-500"
                  />
                </div>
                <div>
                  <label className="text-slate-300 font-bold block mb-1">Commission Amount (Rs.) *</label>
                  <input
                    type="number"
                    required
                    min="1"
                    step="any"
                    value={commForm.commission_amount}
                    onChange={(e) =>
                      setCommForm((p) => ({ ...p, commission_amount: e.target.value }))
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-purple-500"
                  />
                </div>
              </div>

              <div>
                <label className="text-slate-300 font-bold block mb-1">Payment Status</label>
                <select
                  value={commForm.status}
                  onChange={(e) =>
                    setCommForm((p) => ({ ...p, status: e.target.value as 'UNPAID' | 'PAID' }))
                  }
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-purple-500"
                >
                  <option value="UNPAID">UNPAID (Pending Agent Payout)</option>
                  <option value="PAID">PAID (Auto-Post to Expense Ledger)</option>
                </select>
              </div>

              <div>
                <label className="text-slate-300 font-bold block mb-1">Notes</label>
                <textarea
                  rows={2}
                  value={commForm.notes}
                  onChange={(e) => setCommForm((p) => ({ ...p, notes: e.target.value }))}
                  placeholder="Optional installation or area reference..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-purple-500 resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsCommissionModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-bold cursor-pointer transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-bold cursor-pointer transition disabled:opacity-50"
                >
                  {isSubmitting
                    ? 'Saving...'
                    : editingCommission
                    ? 'Save Changes'
                    : 'Save Commission'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 6: Delete Commission Confirmation */}
      {deletingCommission && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 overflow-y-auto animate-fadeIn font-sans">
          <div className="w-[95vw] sm:w-full max-w-lg max-h-[90vh] overflow-y-auto mx-auto my-auto rounded-2xl box-border bg-slate-900 border border-rose-800/70 shadow-2xl p-4 sm:p-5 space-y-4 text-xs">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-xl bg-rose-950 border border-rose-800 text-rose-400 shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Delete Commission Record?</h3>
                <p className="text-slate-300 mt-1">
                  This removes the commission for{' '}
                  <strong className="text-cyan-400">
                    @{deletingCommission.subscriber_username || deletingCommission.client_name}
                  </strong>{' '}
                  ({formatCurrency(deletingCommission.commission_amount)}).
                  {deletingCommission.ledger_entry_id
                    ? ' Its linked entry in the ISP Expense Ledger will also be removed.'
                    : ''}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setDeletingCommission(null)}
                disabled={isSubmitting}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl font-bold cursor-pointer transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteCommission}
                disabled={isSubmitting}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl font-bold cursor-pointer transition disabled:opacity-50"
              >
                {isSubmitting ? 'Deleting...' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AgentProfileView;
