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

      // 2. Fetch tickets strictly assigned to this agent
      const { data: tktData } = await supabase
        .from('tickets')
        .select('*')
        .or(`assigned_agent_id.eq.${currentUser.id},assigned_agent_id.eq.${currentUser.username}`)
        .order('created_at', { ascending: false });

      if (tktData) {
        setAssignedTickets(tktData as SupabaseTicket[]);
      }

      // 3. Fetch unpaid recovery invoices strictly assigned to this agent
      const { data: invData } = await supabase
        .from('invoices')
        .select('*')
        .or(`assigned_agent_id.eq.${currentUser.id},assigned_agent_id.eq.${currentUser.username},assigned_agent_name.eq.${currentUser.fullName}`)
        .eq('status', 'DUE')
        .order('created_at', { ascending: false });

      if (invData) {
        setAssignedInvoices(invData as SupabaseInvoice[]);
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

  // Handle direct cash collection with 1-click WhatsApp receipt
  const handleCollectCash = async (inv: SupabaseInvoice) => {
    try {
      const amount = Number(inv.amount) || 0;
      const nowIso = new Date().toISOString();

      // 1. Mark invoice as PAID in Supabase
      const { error: invErr } = await supabase
        .from('invoices')
        .update({ status: 'PAID', paid_at: nowIso })
        .eq('id', inv.id);

      if (invErr) throw new Error(invErr.message);

      // 2. Increment agent's cash_in_hand in portal_users
      const newCash = agentCash + amount;
      await supabase
        .from('portal_users')
        .update({ cash_in_hand: newCash })
        .eq('id', currentUser.id);

      setAgentCash(newCash);

      // Context sync fallback
      try {
        await collectAgentCashPayment(inv.id, currentUser.id, amount);
      } catch {}

      setCollectionSuccessToast(
        `Collected ${formatCurrency(amount)} from @${inv.subscriber_username}! Receipt recorded & added to Cash-in-Hand.`
      );
      setTimeout(() => setCollectionSuccessToast(null), 5000);
      await fetchAgentData();
    } catch (err: any) {
      setCollectionSuccessToast(`Collection error: ${err.message || 'Failed'}`);
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
          <span>Tickets ({assignedTickets.filter((t) => t.status !== 'RESOLVED').length})</span>
        </button>

        <button
          onClick={() => setActiveTab('collections')}
          className={`py-2 rounded-lg transition flex items-center justify-center gap-1 cursor-pointer ${
            activeTab === 'collections' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'
          }`}
        >
          <DollarSign className="w-3 h-3" />
          <span>Cash ({assignedInvoices.length})</span>
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

          {assignedInvoices.map((inv) => (
            <div
              key={inv.id}
              className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 space-y-2.5 shadow-md"
            >
              <div className="flex items-start justify-between">
                <div>
                  <span className="font-bold text-white text-xs block">@{inv.subscriber_username}</span>
                  <span className="text-[11px] text-slate-400 font-mono">Invoice #{inv.invoice_no}</span>
                  <span className="text-[10px] text-slate-500 block">Cycle Day: {inv.cycle_day || 5}th</span>
                </div>
                <div className="text-right">
                  <span className="text-rose-400 font-bold font-mono text-sm block">
                    Rs. {Number(inv.amount).toLocaleString()}
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono">Due: {inv.due_date}</span>
                </div>
              </div>

              <div className="flex items-center justify-end pt-2 border-t border-slate-800">
                <button
                  onClick={() => handleCollectCash(inv)}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold font-mono text-xs flex items-center gap-1.5 shadow transition cursor-pointer"
                >
                  <DollarSign className="w-3.5 h-3.5" />
                  <span>Receive Cash &amp; Credit My Wallet</span>
                </button>
              </div>
            </div>
          ))}

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
    </div>
  );
};

export default FieldAgentPortal;
