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
} from 'lucide-react';
import { useISP } from '../context/ISPContext';
import { useCurrency } from '../context/CurrencyContext';
import { UserAccount } from '../types/auth';
import { Invoice } from '../types/isp';
import { FeatureGate } from './FeatureGate';
import { PWAInstallPrompt } from './PWAInstallPrompt';
import { supabase, SupabaseInvoice, SupabaseTicket } from '../services/supabaseClient';

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

  const [activeTab, setActiveTab] = useState<'tickets' | 'collections' | 'ont_checker' | 'directory'>('tickets');
  const [collectionSuccessToast, setCollectionSuccessToast] = useState<string | null>(null);
  const [ontSearchQuery, setOntSearchQuery] = useState('');
  const [dirSearchQuery, setDirSearchQuery] = useState('');

  // Agent dynamic state from Supabase
  const [agentCash, setAgentCash] = useState<number>(Number(currentUser.cashInHand || 0));
  const [assignedTickets, setAssignedTickets] = useState<SupabaseTicket[]>([]);
  const [assignedInvoices, setAssignedInvoices] = useState<SupabaseInvoice[]>([]);
  const [isLoadingData, setIsLoadingData] = useState<boolean>(true);

  // Modal State for Cash Collection
  const [isCollectModalOpen, setIsCollectModalOpen] = useState<boolean>(false);
  const [selectedInvForCollection, setSelectedInvForCollection] = useState<SupabaseInvoice | null>(null);
  const [collectionAmountInput, setCollectionAmountInput] = useState<number | string>('');
  const [isSubmittingCollection, setIsSubmittingCollection] = useState<boolean>(false);

  // Fetch this specific agent's live data from Supabase
  const fetchAgentData = async () => {
    setIsLoadingData(true);
    try {
      // 1. Fetch agent's latest cash_in_hand from portal_users
      const { data: userRow } = await supabase
        .from('portal_users')
        .select('cash_in_hand, area, full_name')
        .eq('id', currentUser.id)
        .maybeSingle();

      if (userRow && userRow.cash_in_hand !== undefined) {
        setAgentCash(Number(userRow.cash_in_hand) || 0);
      }

      // 2. Fetch tickets strictly assigned to this agent (by UUID and Name)
      const { data: tktData } = await supabase
        .from('tickets')
        .select('*')
        .or(`assigned_agent_id.eq.${currentUser.id},assigned_agent_name.ilike.%${currentUser.fullName}%`)
        .order('created_at', { ascending: false });

      if (tktData) {
        setAssignedTickets(tktData as SupabaseTicket[]);
      }

      // 3. Fetch recovery invoices strictly assigned to this agent (by UUID and Name)
      const { data: agentInvoices } = await supabase
        .from('invoices')
        .select('*')
        .or(`assigned_agent_id.eq.${currentUser.id},assigned_agent_name.ilike.%${currentUser.fullName}%`)
        .order('created_at', { ascending: false });

      if (agentInvoices) {
        setAssignedInvoices(agentInvoices as SupabaseInvoice[]);
      }
    } catch (err) {
      console.warn('FieldAgentPortal fetch error:', err);
    } finally {
      setIsLoadingData(false);
    }
  };

  useEffect(() => {
    fetchAgentData();

    // Realtime subscriptions for agent portal
    const channel = supabase
      .channel(`public:agent_${currentUser.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, () => {
        fetchAgentData();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices' }, () => {
        fetchAgentData();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'portal_users' }, (payload) => {
        if (payload.new && (payload.new as any).id === currentUser.id) {
          setAgentCash(Number((payload.new as any).cash_in_hand) || 0);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUser.id]);

  // Open modal for recording payment
  const handleOpenCollectionModal = (inv: SupabaseInvoice) => {
    setSelectedInvForCollection(inv);
    const alreadyPaid = Number(inv.paid_amount) || 0;
    const remainingDue = Math.max(0, (Number(inv.amount) || 0) - alreadyPaid);
    if (remainingDue <= 0) {
      alert('This invoice has already been settled and marked PAID.');
      return;
    }
    setCollectionAmountInput(remainingDue);
    setIsCollectModalOpen(true);
  };

  // Handle direct cash collection with partial payment support & payment_transactions record
  const handleConfirmCollection = async () => {
    if (!selectedInvForCollection) return;
    const enteredVal = Number(collectionAmountInput);
    if (isNaN(enteredVal) || enteredVal <= 0) {
      alert('Please enter a valid payment amount greater than 0.');
      return;
    }

    setIsSubmittingCollection(true);
    try {
      const inv = selectedInvForCollection;
      const totalAmount = Number(inv.amount || 0);
      const previousPaid = Number(inv.paid_amount || 0);
      const collectedNow = Number(enteredVal || 0);
      const newPaidTotal = previousPaid + collectedNow;
      const remaining = totalAmount - newPaidTotal;

      // Strictly evaluate PAID vs PARTIAL
      const newStatus = remaining <= 0 ? 'PAID' : 'PARTIAL';
      const finalPaidAmount = remaining <= 0 ? totalAmount : newPaidTotal;
      const nowIso = new Date().toISOString();

      // 1. Update invoice in Supabase: status, paid_amount, paid_at
      const invoiceUpdateData: Partial<SupabaseInvoice> = {
        status: newStatus,
        paid_amount: finalPaidAmount,
        paid_at: newStatus === 'PAID' ? nowIso : (inv.paid_at || null),
      };

      const { error: invErr } = await supabase
        .from('invoices')
        .update(invoiceUpdateData)
        .eq('id', inv.id);

      if (invErr) throw new Error(invErr.message);

      // 2. Increment agent's cash_in_hand in portal_users by ONLY enteredVal
      const { data: agentRecord } = await supabase
        .from('portal_users')
        .select('cash_in_hand')
        .eq('id', currentUser.id)
        .maybeSingle();

      const currentCash = Number(agentRecord?.cash_in_hand ?? agentCash) || 0;
      const newCash = currentCash + enteredVal;

      await supabase
        .from('portal_users')
        .update({ cash_in_hand: newCash })
        .eq('id', currentUser.id);

      setAgentCash(newCash);

      // 3. Record in payment_transactions table
      const { error: txError } = await supabase
        .from('payment_transactions')
        .insert([{
          invoice_id: inv.id,
          subscriber_username: inv.subscriber_username,
          collected_by_id: currentUser.id,
          collected_by_name: currentUser.fullName,
          amount_paid: enteredVal,
          payment_method: 'Cash Handover',
          created_at: nowIso,
        }]);

      if (txError) {
        console.warn('payment_transactions insert error:', txError.message);
      }

      // Context sync fallback
      try {
        await collectAgentCashPayment(inv.id, currentUser.id, enteredVal);
      } catch {}

      setCollectionSuccessToast(
        `Collected ${formatCurrency(enteredVal)} from @${inv.subscriber_username}! Status: ${newStatus}. Credited to Wallet.`
      );
      setTimeout(() => setCollectionSuccessToast(null), 5000);
      setIsCollectModalOpen(false);
      setSelectedInvForCollection(null);
      await fetchAgentData();
    } catch (err: any) {
      alert(`Collection error: ${err.message || 'Failed'}`);
    } finally {
      setIsSubmittingCollection(false);
    }
  };

  // Handle marking ticket fixed
  const handleMarkTicketFixed = async (ticketId: string) => {
    try {
      await supabase
        .from('tickets')
        .update({ status: 'RESOLVED' })
        .eq('id', ticketId);

      resolveTicket(ticketId, 'Resolved in field by technician');
      setCollectionSuccessToast('Complaint marked RESOLVED successfully!');
      setTimeout(() => setCollectionSuccessToast(null), 4000);
      await fetchAgentData();
    } catch (err: any) {
      alert(`Failed to resolve ticket: ${err.message}`);
    }
  };

  const filteredOnus = onus.filter(
    (o) =>
      o.model.toLowerCase().includes(ontSearchQuery.toLowerCase()) ||
      o.macAddress.toLowerCase().includes(ontSearchQuery.toLowerCase()) ||
      o.customerName.toLowerCase().includes(ontSearchQuery.toLowerCase())
  );

  const allAreaSubscribers = customers.filter(
    (c) =>
      !dirSearchQuery.trim() ||
      c.name.toLowerCase().includes(dirSearchQuery.toLowerCase()) ||
      c.pppoeUsername.toLowerCase().includes(dirSearchQuery.toLowerCase()) ||
      c.phone.includes(dirSearchQuery)
  );

  return (
    <div className="max-w-md mx-auto space-y-4 font-sans text-xs pb-12">
      {/* PWA Mobile Install Banner for Field Agents */}
      <PWAInstallPrompt role="AGENT" variant="banner" forceVisibleOnDesktop={false} />

      {/* Agent Identity & Cash Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-emerald-950/40 to-slate-900 border border-emerald-800/60 rounded-2xl p-4 shadow-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-full bg-emerald-600/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 font-bold font-mono">
              🛵
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-white">{currentUser.fullName}</h2>
                <PWAInstallPrompt role="AGENT" variant="button" />
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

      {/* Success Notification Banner */}
      {collectionSuccessToast && (
        <div className="p-3 bg-emerald-950/90 border border-emerald-700 rounded-xl text-emerald-300 text-xs flex items-center gap-2 shadow-lg animate-fadeIn">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{collectionSuccessToast}</span>
        </div>
      )}

      {/* Navigation Tabs for Agent */}
      <div className="grid grid-cols-4 bg-slate-900 p-1 rounded-xl border border-slate-800 text-[11px] font-mono font-bold">
        <button
          onClick={() => setActiveTab('tickets')}
          className={`py-2 rounded-lg transition flex items-center justify-center gap-1 cursor-pointer ${
            activeTab === 'tickets' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'
          }`}
        >
          <Clock className="w-3 h-3" />
          <span>Tickets ({assignedTickets?.filter((t) => (t.status || '').toUpperCase() !== 'RESOLVED').length || 0})</span>
        </button>

        <button
          onClick={() => setActiveTab('collections')}
          className={`py-2 rounded-lg transition flex items-center justify-center gap-1 cursor-pointer ${
            activeTab === 'collections' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'
          }`}
        >
          <DollarSign className="w-3 h-3" />
          <span>$ Cash ({(assignedInvoices || []).filter((inv) => (Number(inv.amount) - Number(inv.paid_amount || 0)) > 0).length})</span>
        </button>

        <button
          onClick={() => setActiveTab('ont_checker')}
          className={`py-2 rounded-lg transition flex items-center justify-center gap-1 cursor-pointer ${
            activeTab === 'ont_checker' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'
          }`}
        >
          <Radio className="w-3 h-3" />
          <span>ONT</span>
        </button>

        <button
          onClick={() => setActiveTab('directory')}
          className={`py-2 rounded-lg transition flex items-center justify-center gap-1 cursor-pointer ${
            activeTab === 'directory' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'
          }`}
        >
          <Users className="w-3 h-3" />
          <span>Directory</span>
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
            return (
              <div
                key={ticket.id}
                className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 space-y-2.5 shadow-md"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="font-bold text-white text-xs block">@{ticket.subscriber_username}</span>
                    <span className="text-[10px] text-slate-400 font-mono">Ticket #{ticket.ticket_no}</span>
                  </div>
                  <span
                    className={`px-1.5 py-0.5 rounded font-mono font-bold text-[10px] ${
                      ticket.priority?.toUpperCase() === 'CRITICAL'
                        ? 'bg-rose-950 text-rose-300 border border-rose-800'
                        : 'bg-amber-950 text-amber-300 border border-amber-800'
                    }`}
                  >
                    {ticket.priority || 'MEDIUM'}
                  </span>
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

            return (
              <div
                key={inv.id}
                className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 space-y-2.5 shadow-md"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
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
                    <span className="text-[10px] text-slate-500 block">Cycle Day: {inv.cycle_day || 5}th</span>
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

                <div className="flex items-center justify-end pt-2 border-t border-slate-800">
                  {balanceDue > 0 && displayStatus !== 'PAID' ? (
                    <button
                      onClick={() => handleOpenCollectionModal(inv)}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold font-mono text-xs flex items-center gap-1.5 shadow transition cursor-pointer"
                    >
                      <DollarSign className="w-3.5 h-3.5" />
                      <span>Collect Payment / Mark Paid</span>
                    </button>
                  ) : (
                    <span className="text-emerald-400 font-mono text-[11px] font-semibold flex items-center gap-1.5 py-1 px-2.5 rounded-lg bg-emerald-950/60 border border-emerald-800/80">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      <span>✓ Settled / Paid in Full</span>
                    </span>
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

      {/* Tab 4: Full Area Directory */}
      {activeTab === 'directory' && (
        <FeatureGate
          feature="agent_full_area_directory"
          role="AGENT"
          mode="banner"
          disabledMessage="Access to the entire city area subscriber directory is restricted. You are limited to assigned recovery tickets and designated sector customers."
        >
          <div className="space-y-3">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-3 pointer-events-none" />
              <input
                type="text"
                value={dirSearchQuery}
                onChange={(e) => setDirSearchQuery(e.target.value)}
                placeholder="Search any subscriber across city node..."
                className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-mono"
              />
            </div>

            <div className="space-y-2">
              {allAreaSubscribers.slice(0, 20).map((sub) => (
                <div
                  key={sub.id}
                  className="bg-slate-900 border border-slate-800 rounded-xl p-3 space-y-1 font-mono text-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-white font-sans">{sub.name}</span>
                    <span className="text-cyan-400 text-[11px]">@{sub.pppoeUsername}</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>Node: {sub.areaNode}</span>
                    <span>IP: {sub.assignedIp}</span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1 border-t border-slate-800">
                    <span>Phone: {sub.phone}</span>
                    <span className={sub.balanceDue > 0 ? 'text-rose-400 font-bold' : 'text-emerald-400'}>
                      Due: {formatCurrency(sub.balanceDue)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </FeatureGate>
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
