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
} from 'lucide-react';
import { supabase, SupabasePortalUser, SupabasePaymentTransaction, SupabaseAgentCashTransaction } from '../services/supabaseClient';
import { useCurrency } from '../context/CurrencyContext';
import { EditStaffModal } from './EditStaffModal';

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

  // Agent profile state
  const [agent, setAgent] = useState<SupabasePortalUser | null>(null);
  const [collections, setCollections] = useState<SupabasePaymentTransaction[]>([]);
  const [cashTransactions, setCashTransactions] = useState<SupabaseAgentCashTransaction[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<'collections' | 'ledger'>('collections');
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Modals
  const [isEditStaffModalOpen, setIsEditStaffModalOpen] = useState(false);
  const [isHandoverModalOpen, setIsHandoverModalOpen] = useState(false);
  const [isAdvanceModalOpen, setIsAdvanceModalOpen] = useState(false);
  const [isAdvanceReturnModalOpen, setIsAdvanceReturnModalOpen] = useState(false);
  const [isSalaryPayoutModalOpen, setIsSalaryPayoutModalOpen] = useState(false);

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
      setSalaryPayoutAmount(String(userData.base_salary || 35000));

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

      // 1.3 Fetch handover & settlement ledger from agent_cash_transactions
      let cashRecords: SupabaseAgentCashTransaction[] = [];
      const { data: cashData } = await supabase
        .from('agent_cash_transactions')
        .select('*')
        .or(`agent_id.eq.${userData.id},agent_username.eq.${userData.username}`)
        .order('created_at', { ascending: false });

      if (cashData) {
        cashRecords = cashData as SupabaseAgentCashTransaction[];
        setCashTransactions(cashRecords);
      }

      // Reconcile and calculate Cash in Hand (Collections minus Handovers)
      const calculatedCollections = txns.reduce((sum, item) => sum + (Number(item.amount_paid) || 0), 0);
      const totalHandedOver = cashRecords
        .filter((t) => (t.transaction_type || '').toUpperCase() === 'HANDOVER')
        .reduce((sum, item) => sum + (Number(item.amount) || 0), 0);

      const netPendingCash = Math.max(0, calculatedCollections - totalHandedOver);
      const finalCashInHand = (userData.cash_in_hand && userData.cash_in_hand > 0)
        ? userData.cash_in_hand
        : netPendingCash;

      if ((!userData.cash_in_hand || userData.cash_in_hand === 0) && netPendingCash > 0) {
        await supabase
          .from('portal_users')
          .update({ cash_in_hand: netPendingCash })
          .eq('id', userData.id);
        userData.cash_in_hand = netPendingCash;
      }

      setAgent({ ...userData, cash_in_hand: finalCashInHand });
      setHandoverAmount(String(finalCashInHand));
      setSalaryPayoutAmount(String(userData.base_salary || 35000));
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
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchAgentProfile]);

  // Derived KPI metrics
  const cashInHand = agent?.cash_in_hand || 0;
  const advanceBalance = agent?.advance_balance || 0;
  const baseSalary = agent?.base_salary || 35000;
  const totalCollections = useMemo(() => {
    return (collections || []).reduce((sum, item) => sum + (Number(item.amount_paid) || 0), 0);
  }, [collections]);

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
          agent_username: agent.username,
          amount: amountNum,
          transaction_type: 'CASH_HANDOVER',
          received_by: handoverReceivedBy || 'Admin',
          notes: handoverNotes || 'Cash collection handed over to Admin',
          created_at: new Date().toISOString(),
        },
      ]);

      if (txError) console.warn('agent_cash_transactions notice:', txError);

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
      await supabase.from('agent_cash_transactions').insert([
        {
          agent_id: agent.id,
          agent_name: agent.full_name,
          agent_username: agent.username,
          amount: amountNum,
          transaction_type: 'ADVANCE_TAKEN',
          received_by: agent.full_name,
          notes: advanceNotes || 'Advance issued to agent',
          created_at: new Date().toISOString(),
        },
      ]);

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
      await supabase.from('agent_cash_transactions').insert([
        {
          agent_id: agent.id,
          agent_name: agent.full_name,
          agent_username: agent.username,
          amount: amountNum,
          transaction_type: 'ADVANCE_RETURN',
          received_by: 'Admin / Accounts',
          notes: returnNotes || 'Advance salary deduction recorded',
          created_at: new Date().toISOString(),
        },
      ]);

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
      await supabase.from('agent_cash_transactions').insert([
        {
          agent_id: agent.id,
          agent_name: agent.full_name,
          agent_username: agent.username,
          amount: amountNum,
          transaction_type: 'SALARY_PAYOUT',
          received_by: agent.full_name,
          notes: salaryNotes || 'Monthly salary disbursement',
          created_at: new Date().toISOString(),
        },
      ]);

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
          {/* 1. Cash In Hand (Recovery Pending Handover) */}
          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
            <span className="text-[10px] text-slate-400 font-mono uppercase block flex items-center justify-between">
              <span>Cash in Hand (Pending)</span>
              <Wallet className="w-3.5 h-3.5 text-emerald-400" />
            </span>
            <div className="text-2xl font-bold font-mono text-emerald-400">
              {formatCurrency(cashInHand)}
            </div>
            <span className="text-[10px] text-slate-500 font-mono block">
              Physical cash collected from subscribers
            </span>
          </div>

          {/* 2. Advance Balance */}
          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
            <span className="text-[10px] text-slate-400 font-mono uppercase block flex items-center justify-between">
              <span>Advance Balance</span>
              <DollarSign className="w-3.5 h-3.5 text-amber-400" />
            </span>
            <div className="text-2xl font-bold font-mono text-amber-400">
              {formatCurrency(advanceBalance)}
            </div>
            <span className="text-[10px] text-slate-500 font-mono block">
              Outstanding advance pending settlement
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

          {/* 4. Total Client Collections */}
          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
            <span className="text-[10px] text-slate-400 font-mono uppercase block flex items-center justify-between">
              <span>Total Client Collections</span>
              <TrendingUp className="w-3.5 h-3.5 text-cyan-400" />
            </span>
            <div className="text-2xl font-bold font-mono text-cyan-300">
              {formatCurrency(totalCollections)}
            </div>
            <span className="text-[10px] text-slate-500 font-mono block">
              {collections.length} verified invoice transactions
            </span>
          </div>
        </div>
      </div>

      {/* Financial Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-2 font-mono">
        <button
          onClick={() => setActiveTab('collections')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-xs transition cursor-pointer ${
            activeTab === 'collections'
              ? 'bg-cyan-600 text-slate-950 shadow-md shadow-cyan-950/40'
              : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
          }`}
        >
          <Receipt className="w-3.5 h-3.5" />
          <span>Client Collections Breakdown ({collections.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('ledger')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-xs transition cursor-pointer ${
            activeTab === 'ledger'
              ? 'bg-cyan-600 text-slate-950 shadow-md shadow-cyan-950/40'
              : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          <span>Handover &amp; Settlement Audit Ledger ({cashTransactions.length})</span>
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
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 font-mono">
                {collections.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-500 font-mono">
                      No customer collections recorded yet for this field agent.
                    </td>
                  </tr>
                ) : (
                  collections.map((tx) => (
                    <tr key={tx.id || Math.random()} className="hover:bg-slate-950/50 transition">
                      <td className="py-3.5 px-4 text-slate-400">
                        {tx.created_at ? new Date(tx.created_at).toLocaleString() : 'Recent'}
                      </td>
                      <td className="py-3.5 px-4 font-bold text-cyan-400">
                        @{tx.subscriber_username}
                      </td>
                      <td className="py-3.5 px-4 text-slate-300">
                        {tx.invoice_id || 'Direct'}
                      </td>
                      <td className="py-3.5 px-4 font-bold text-emerald-400">
                        {formatCurrency(Number(tx.amount_paid) || 0)}
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-950 text-slate-300 border border-slate-800">
                          {tx.payment_mode || tx.payment_method || 'CASH'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-slate-400 truncate max-w-xs">
                        {tx.notes || 'Verified field collection'}
                      </td>
                    </tr>
                  ))
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
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 font-mono">
                {cashTransactions.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-slate-500 font-mono">
                      No cash handovers or advance transactions recorded in ledger.
                    </td>
                  </tr>
                ) : (
                  cashTransactions.map((tx) => {
                    const isHandover = tx.transaction_type === 'CASH_HANDOVER';
                    const isAdvanceTaken = tx.transaction_type === 'ADVANCE_TAKEN';
                    const isAdvanceReturn = tx.transaction_type === 'ADVANCE_RETURN';
                    const isSalary = tx.transaction_type === 'SALARY_PAYOUT';

                    return (
                      <tr key={tx.id || Math.random()} className="hover:bg-slate-950/50 transition">
                        <td className="py-3.5 px-4 text-slate-400">
                          {tx.created_at ? new Date(tx.created_at).toLocaleString() : 'Recent'}
                        </td>
                        <td className="py-3.5 px-4">
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
                        <td className="py-3.5 px-4 font-bold text-white">
                          {formatCurrency(Number(tx.amount) || 0)}
                        </td>
                        <td className="py-3.5 px-4 text-slate-300">
                          {tx.received_by || 'Admin'}
                        </td>
                        <td className="py-3.5 px-4 text-slate-400 truncate max-w-sm">
                          {tx.notes || '—'}
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

      {/* MODAL 1: Cash Handover Modal */}
      {isHandoverModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn font-sans">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn font-sans">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn font-sans">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn font-sans">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
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
    </div>
  );
};

export default AgentProfileView;
