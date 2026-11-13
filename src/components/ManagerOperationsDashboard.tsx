import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Activity,
  AlertTriangle,
  Users,
  CreditCard,
  ShieldAlert,
  Layers,
  CheckCircle2,
  Clock,
  Search,
  DollarSign,
  TrendingUp,
  Edit,
  Lock,
  RefreshCw,
  Power,
  MapPin,
  Server,
  Phone,
  Wrench,
} from 'lucide-react';
import { useISP } from '../context/ISPContext';
import { useCurrency } from '../context/CurrencyContext';
import { Customer } from '../types/isp';
import { FeatureGate } from './FeatureGate';
import { useAuth } from '../context/AuthContext';
import { UserAccount } from '../types/auth';
import {
  supabase,
  SupabasePortalUser,
  SupabaseTicket,
  SupabaseInvoice,
  SupabasePaymentTransaction,
  SupabaseAgentCashTransaction,
} from '../services/supabaseClient';
import {
  PARENT_FLEET_ROUTER,
  NetworkAreaNode,
  fetchNetworkAreas,
} from '../lib/billingAndNetwork';
import { AreaNodeSelector } from './AreaNodeSelector';

interface ManagerOperationsDashboardProps {
  onOpenTicketModal: () => void;
  onOpenOutageModal: () => void;
  onSelectCustomer?: (customer: Customer) => void;
  currentUser?: UserAccount;
}

interface LiveMikrotikSession {
  '.id'?: string;
  name?: string;
  address?: string;
  uptime?: string;
  'caller-id'?: string;
}

export const ManagerOperationsDashboard: React.FC<ManagerOperationsDashboardProps> = ({
  onOpenTicketModal,
  onOpenOutageModal,
  currentUser,
}) => {
  const {
    outages,
    onus,
    updateOutage,
    resolveOutage,
  } = useISP();
  const { formatCurrency } = useCurrency();
  const { currentUser: authUser } = useAuth();

  const activeManager = currentUser || authUser;
  const managerName = activeManager?.fullName || 'NOC Operations Manager';
  const managerUsername = activeManager?.username || 'manager';
  const managerArea = activeManager?.area || 'All Coverage Sectors';
  const hasSpecificSector = Boolean(
    managerArea &&
      managerArea !== 'All Federal Sectors' &&
      managerArea !== 'All Coverage Sectors' &&
      managerArea !== 'Central NOC Core'
  );

  // Live Supabase + MikroTik state (zero static/mock fallbacks)
  const [subscribers, setSubscribers] = useState<SupabasePortalUser[]>([]);
  const [agents, setAgents] = useState<SupabasePortalUser[]>([]);
  const [tickets, setTickets] = useState<SupabaseTicket[]>([]);
  const [invoices, setInvoices] = useState<SupabaseInvoice[]>([]);
  const [paymentTxns, setPaymentTxns] = useState<SupabasePaymentTransaction[]>([]);
  const [cashLedger, setCashLedger] = useState<SupabaseAgentCashTransaction[]>([]);
  const [networkAreas, setNetworkAreas] = useState<NetworkAreaNode[]>([]);
  const [liveSessions, setLiveSessions] = useState<LiveMikrotikSession[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const [sectorFilter, setSectorFilter] = useState<string>(() =>
    hasSpecificSector ? managerArea : 'ALL'
  );

  const [activeSubTab, setActiveSubTab] = useState<
    'tickets' | 'subscribers' | 'agent_cash' | 'outages' | 'olt_telemetry'
  >('tickets');
  const [ticketFilter, setTicketFilter] = useState<'all' | 'open' | 'critical'>('all');
  const [searchSubscriber, setSearchSubscriber] = useState('');
  const [toastNotice, setToastNotice] = useState<string | null>(null);
  const [kickingUsername, setKickingUsername] = useState<string | null>(null);
  const [approvingAgentId, setApprovingAgentId] = useState<string | null>(null);

  // Edit subscriber state (persisted to Supabase portal_users)
  const [editingSubscriber, setEditingSubscriber] = useState<SupabasePortalUser | null>(null);
  const [editPhone, setEditPhone] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editArea, setEditArea] = useState('');
  const [isSavingSub, setIsSavingSub] = useState(false);

  const showToast = (msg: string) => {
    setToastNotice(msg);
    setTimeout(() => setToastNotice(null), 4000);
  };

  const fetchOperationsData = useCallback(async (showSpinner = false) => {
    if (showSpinner) setIsRefreshing(true);
    try {
      const [usersRes, ticketsRes, invoicesRes, paymentsRes, ledgerRes, areasList, sessionsRes] =
        await Promise.all([
          supabase.from('portal_users').select('*').order('full_name', { ascending: true }),
          supabase.from('tickets').select('*').order('created_at', { ascending: false }),
          supabase.from('invoices').select('*').order('created_at', { ascending: false }),
          supabase.from('payment_transactions').select('*').order('created_at', { ascending: false }),
          supabase.from('agent_cash_transactions').select('*').order('created_at', { ascending: false }),
          fetchNetworkAreas(),
          fetch('/api/mikrotik/ppp/active').then((r) => (r.ok ? r.json() : [])).catch(() => []),
        ]);

      if (Array.isArray(usersRes.data)) {
        const allUsers = usersRes.data as SupabasePortalUser[];
        setSubscribers(allUsers.filter((u) => (u?.role || '').toUpperCase() === 'CLIENT'));
        setAgents(allUsers.filter((u) => (u?.role || '').toUpperCase() === 'AGENT'));
      }
      if (Array.isArray(ticketsRes.data)) {
        setTickets(ticketsRes.data as SupabaseTicket[]);
      }
      if (Array.isArray(invoicesRes.data)) {
        setInvoices(invoicesRes.data as SupabaseInvoice[]);
      }
      if (Array.isArray(paymentsRes.data)) {
        setPaymentTxns(paymentsRes.data as SupabasePaymentTransaction[]);
      }
      if (Array.isArray(ledgerRes.data)) {
        setCashLedger(ledgerRes.data as SupabaseAgentCashTransaction[]);
      }
      if (Array.isArray(areasList)) {
        setNetworkAreas(areasList);
      }
      if (Array.isArray(sessionsRes)) {
        setLiveSessions(sessionsRes as LiveMikrotikSession[]);
      }
    } catch (err) {
      console.warn('Operations dashboard sync notice:', err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchOperationsData();

    // Realtime Supabase subscriptions for zero-stale operational dispatch
    const ch = supabase
      .channel('public:ops_dispatch_live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, () => {
        fetchOperationsData();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'portal_users' }, () => {
        fetchOperationsData();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices' }, () => {
        fetchOperationsData();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_transactions' }, () => {
        fetchOperationsData();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_cash_transactions' }, () => {
        fetchOperationsData();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'network_areas' }, () => {
        fetchOperationsData();
      })
      .subscribe();

    const pollTimer = setInterval(() => {
      fetch('/api/mikrotik/ppp/active')
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (Array.isArray(data)) setLiveSessions(data as LiveMikrotikSession[]);
        })
        .catch(() => {});
    }, 10000);

    return () => {
      supabase.removeChannel(ch);
      clearInterval(pollTimer);
    };
  }, [fetchOperationsData]);

  const cleanSector = (sectorFilter || '').toLowerCase();
  const cleanSearchSub = (searchSubscriber || '').toLowerCase();

  // Map active MikroTik sessions by lowercase username
  const liveSessionByUsername = useMemo(() => {
    const map: Record<string, LiveMikrotikSession> = {};
    for (const s of liveSessions) {
      const uname = (s?.name || '').trim().toLowerCase();
      if (uname) map[uname] = s;
    }
    return map;
  }, [liveSessions]);

  // Map subscriber directory by lowercase username for enriching tickets & balances
  const subscriberMap = useMemo(() => {
    const map: Record<string, SupabasePortalUser> = {};
    for (const sub of subscribers) {
      const uname = (sub?.username || '').trim().toLowerCase();
      if (uname) map[uname] = sub;
    }
    return map;
  }, [subscribers]);

  // Compute unpaid balance due per subscriber strictly from Supabase invoices
  const dueBalanceByUsername = useMemo(() => {
    const map: Record<string, number> = {};
    for (const inv of invoices) {
      const uname = (inv?.subscriber_username || '').trim().toLowerCase();
      if (!uname) continue;
      const status = (inv?.status || '').toUpperCase();
      if (status === 'PAID') continue;
      const rem = Math.max(0, (Number(inv?.amount) || 0) - (Number(inv?.paid_amount) || 0));
      map[uname] = (map[uname] || 0) + rem;
    }
    return map;
  }, [invoices]);

  // Compute live agent cash-in-hand & collected today strictly from payment_transactions + agent_cash_transactions
  const agentFinancials = useMemo(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    const map: Record<string, { cashInHand: number; collectedToday: number; openTickets: number }> = {};

    for (const ag of agents) {
      map[ag.id] = { cashInHand: 0, collectedToday: 0, openTickets: 0 };
    }

    const totalCollectedByAgent: Record<string, number> = {};
    for (const tx of paymentTxns) {
      const matchedAgent = agents.find(
        (ag) =>
          (tx.collected_by_id && ag.id === tx.collected_by_id) ||
          (tx.collected_by_name &&
            (ag.full_name || '').toLowerCase() === (tx.collected_by_name || '').toLowerCase())
      );
      if (!matchedAgent) continue;
      const amt = Number(tx.amount_paid) || 0;
      totalCollectedByAgent[matchedAgent.id] = (totalCollectedByAgent[matchedAgent.id] || 0) + amt;
      const dtStr = tx.payment_date || tx.created_at || '';
      if (dtStr.startsWith(todayStr)) {
        map[matchedAgent.id].collectedToday += amt;
      }
    }

    const totalHandoverByAgent: Record<string, number> = {};
    for (const row of cashLedger) {
      const agId = row?.agent_id;
      if (!agId || !map[agId]) continue;
      const amt = Number(row?.amount) || 0;
      const t = (row?.transaction_type || '').toUpperCase();
      if (t === 'CASH_HANDOVER' || t === 'HANDOVER') {
        totalHandoverByAgent[agId] = (totalHandoverByAgent[agId] || 0) + amt;
      }
    }

    for (const ag of agents) {
      map[ag.id].cashInHand = Math.max(
        0,
        (totalCollectedByAgent[ag.id] || 0) - (totalHandoverByAgent[ag.id] || 0)
      );
    }

    for (const t of tickets) {
      const st = (t?.status || '').toUpperCase();
      if (st !== 'RESOLVED' && t?.assigned_agent_id && map[t.assigned_agent_id]) {
        map[t.assigned_agent_id].openTickets += 1;
      }
    }

    return map;
  }, [agents, paymentTxns, cashLedger, tickets]);

  // Sector-scoped datasets
  const scopedOutages = (outages || []).filter((o) =>
    sectorFilter === 'ALL' ? true : (o?.areaNode || '').toLowerCase().includes(cleanSector)
  );

  const scopedTickets = tickets.filter((t) => {
    if (sectorFilter === 'ALL') return true;
    const sub = subscriberMap[(t?.subscriber_username || '').toLowerCase()];
    const subArea = sub?.area || '';
    const subAddr = sub?.address || '';
    return (
      subArea.toLowerCase().includes(cleanSector) ||
      subAddr.toLowerCase().includes(cleanSector)
    );
  });

  const scopedSubscribers = subscribers.filter((s) =>
    sectorFilter === 'ALL' ? true : (s?.area || '').toLowerCase().includes(cleanSector)
  );

  const scopedAgents = agents.filter((a) =>
    sectorFilter === 'ALL' ? true : (a?.area || '').toLowerCase().includes(cleanSector)
  );

  const activeOutages = scopedOutages.filter((o) => (o?.status || '').toLowerCase() !== 'resolved');
  const openTickets = scopedTickets.filter((t) => (t?.status || '').toUpperCase() !== 'RESOLVED');

  const totalAgentCashInHand = scopedAgents.reduce(
    (acc, a) => acc + Math.max(0, agentFinancials[a.id]?.cashInHand || 0),
    0
  );
  const totalCollectedToday = scopedAgents.reduce(
    (acc, a) => acc + (agentFinancials[a.id]?.collectedToday || 0),
    0
  );

  const filteredTickets = scopedTickets.filter((t) => {
    const statusUpper = (t?.status || '').toUpperCase();
    const priorityUpper = (t?.priority || '').toUpperCase();
    const isResolved = statusUpper === 'RESOLVED';
    if (ticketFilter === 'open') return !isResolved;
    if (ticketFilter === 'critical') return priorityUpper === 'CRITICAL' && !isResolved;
    return true;
  });

  const filteredSubscribers = scopedSubscribers.filter(
    (s) =>
      !cleanSearchSub ||
      (s?.full_name || '').toLowerCase().includes(cleanSearchSub) ||
      (s?.username || '').toLowerCase().includes(cleanSearchSub) ||
      (s?.area || '').toLowerCase().includes(cleanSearchSub) ||
      (s?.phone || '').includes(searchSubscriber || '')
  );

  // Real Supabase Ticket Assignment
  const handleAssignTicket = async (ticket: SupabaseTicket, agentId: string) => {
    const targetAgent = agents.find((a) => a.id === agentId);
    const { error } = await supabase
      .from('tickets')
      .update({
        assigned_agent_id: agentId || null,
        assigned_agent_name: targetAgent ? targetAgent.full_name : null,
      })
      .eq('id', ticket.id);

    if (error) {
      showToast(`Failed to assign ticket: ${error.message}`);
      return;
    }
    showToast(
      targetAgent
        ? `Ticket ${ticket.ticket_no} assigned to ${targetAgent.full_name}.`
        : `Ticket ${ticket.ticket_no} unassigned.`
    );
    await fetchOperationsData();
  };

  // Real Supabase Ticket Resolution
  const handleResolveTicket = async (ticket: SupabaseTicket) => {
    const { error } = await supabase
      .from('tickets')
      .update({
        status: 'RESOLVED',
      })
      .eq('id', ticket.id);

    if (error) {
      showToast(`Failed to resolve ticket: ${error.message}`);
      return;
    }
    showToast(`Ticket ${ticket.ticket_no} marked RESOLVED in Supabase.`);
    await fetchOperationsData();
  };

  // Real MikroTik Active Session Kick
  const handleKickUserSession = async (sub: SupabasePortalUser) => {
    const uname = (sub?.username || '').trim();
    if (!uname) return;

    setKickingUsername(uname);
    try {
      const lookupRes = await fetch(`/api/mikrotik/ppp/active?name=${encodeURIComponent(uname)}`);
      const activeList = lookupRes.ok ? await lookupRes.json() : [];
      const match = Array.isArray(activeList)
        ? activeList.find((s: any) => (s?.name || '').toLowerCase() === uname.toLowerCase())
        : null;

      if (!match || !match['.id']) {
        showToast(`No active online session found on RouterOS for @${uname}.`);
        return;
      }

      const removeRes = await fetch('/api/mikrotik/ppp/active/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ '.id': match['.id'], numbers: match['.id'] }),
      });

      if (!removeRes.ok) {
        showToast(`RouterOS failed to kick @${uname}.`);
        return;
      }

      showToast(`Terminated active PPPoE session for @${uname} on RouterOS.`);
      await fetchOperationsData();
    } catch (err: any) {
      showToast(`Kick error: ${err?.message || 'Router unreachable'}`);
    } finally {
      setKickingUsername(null);
    }
  };

  // Real Supabase Cash Handover Approval (writes CASH_HANDOVER entry to agent_cash_transactions & zeroes cash_in_hand)
  const handleApproveHandover = async (agent: SupabasePortalUser, amount: number) => {
    if (amount <= 0) return;
    setApprovingAgentId(agent.id);
    try {
      const { error } = await supabase.from('agent_cash_transactions').insert([
        {
          agent_id: agent.id,
          agent_name: agent.full_name,
          agent_username: agent.username,
          transaction_type: 'CASH_HANDOVER',
          amount: Number(amount),
          received_by: `${managerName} (@${managerUsername})`,
          notes: `Approved cash vault handover by ${managerName}`,
          created_at: new Date().toISOString(),
        },
      ]);

      if (error) {
        showToast(`Handover error: ${error.message}`);
        return;
      }

      await supabase
        .from('portal_users')
        .update({ cash_in_hand: 0 })
        .eq('id', agent.id);

      showToast(`Approved cash handover of ${formatCurrency(amount)} from ${agent.full_name}.`);
      await fetchOperationsData();
    } finally {
      setApprovingAgentId(null);
    }
  };

  // Real Supabase Subscriber Edit
  const handleSaveSubscriberEdit = async () => {
    if (!editingSubscriber) return;
    setIsSavingSub(true);
    try {
      const { error } = await supabase
        .from('portal_users')
        .update({
          phone: editPhone.trim(),
          address: editAddress.trim(),
          area: editArea.trim(),
        })
        .eq('id', editingSubscriber.id);

      if (error) {
        showToast(`Failed to update subscriber: ${error.message}`);
        return;
      }

      showToast(`Updated subscriber profile for ${editingSubscriber.full_name} in Supabase.`);
      setEditingSubscriber(null);
      await fetchOperationsData();
    } finally {
      setIsSavingSub(false);
    }
  };

  const validOnus = (onus || []).filter((o) => typeof o?.rxPowerDbm === 'number');
  const averageRxDbm =
    validOnus.length > 0
      ? (validOnus.reduce((s, o) => s + (o.rxPowerDbm || 0), 0) / validOnus.length).toFixed(1)
      : null;

  return (
    <div className="space-y-6 text-xs font-sans max-w-7xl mx-auto">
      {/* Toast Alert */}
      {toastNotice && (
        <div className="p-3 bg-emerald-950/90 border border-emerald-600 rounded-xl text-emerald-200 text-xs font-mono flex items-center gap-2 animate-fadeIn shadow-lg">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toastNotice}</span>
        </div>
      )}

      {/* Top Operations Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg flex flex-col gap-4">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-gradient-to-tr from-indigo-600 to-cyan-600 text-white shadow-lg shadow-indigo-500/20">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-bold text-white">NOC Operations &amp; Dispatch Control</h2>
                <span className="px-2 py-0.5 rounded bg-indigo-950 border border-indigo-800 text-indigo-300 font-mono text-[10px] font-bold">
                  LIVE TELEMETRY &bull; {managerName} (@{managerUsername})
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 mt-1">
                <span className="flex items-center gap-1 font-mono text-cyan-400 font-bold">
                  <Server className="w-3 h-3 text-cyan-400 shrink-0" />
                  <span>Parent Fleet: {PARENT_FLEET_ROUTER}</span>
                </span>
                <span>&bull;</span>
                <span>Live Supabase tickets, technician dispatch, and RouterOS v7 active sessions ({liveSessions.length} online).</span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Sector / Child Area Node Filter */}
            <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 px-2.5 py-1.5 rounded-lg">
              <MapPin className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              <select
                value={sectorFilter}
                onChange={(e) => setSectorFilter(e.target.value)}
                className="bg-transparent text-slate-200 text-xs font-mono focus:outline-none cursor-pointer"
              >
                <option value="ALL" className="bg-slate-900">
                  All Child Area Nodes ({networkAreas.length})
                </option>
                {hasSpecificSector &&
                  !networkAreas.some((a) => a.area_name.toLowerCase() === managerArea.toLowerCase()) && (
                    <option value={managerArea} className="bg-slate-900">
                      My Sector: {managerArea}
                    </option>
                  )}
                {networkAreas.map((area) => (
                  <option key={area.id || area.area_name} value={area.area_name} className="bg-slate-900">
                    {area.area_name} {area.prefix_code ? `[${area.prefix_code}]` : ''}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={() => fetchOperationsData(true)}
              disabled={isRefreshing}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 font-mono text-xs flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>Sync Live</span>
            </button>
          </div>
        </div>

        {/* Navigation Subtabs */}
        <div className="flex flex-wrap items-center gap-1.5 bg-slate-950 p-1.5 rounded-xl border border-slate-800 font-mono text-xs">
          <button
            onClick={() => setActiveSubTab('tickets')}
            className={`px-3 py-1.5 rounded-lg font-bold transition flex items-center gap-1.5 cursor-pointer ${
              activeSubTab === 'tickets'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>SLA Tickets &amp; Dispatch ({openTickets.length})</span>
          </button>
          <button
            onClick={() => setActiveSubTab('subscribers')}
            className={`px-3 py-1.5 rounded-lg font-bold transition flex items-center gap-1.5 cursor-pointer ${
              activeSubTab === 'subscribers'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Subscribers ({scopedSubscribers.length})</span>
          </button>
          <button
            onClick={() => setActiveSubTab('agent_cash')}
            className={`px-3 py-1.5 rounded-lg font-bold transition flex items-center gap-1.5 cursor-pointer ${
              activeSubTab === 'agent_cash'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <DollarSign className="w-3.5 h-3.5" />
            <span>Agent Cash ({formatCurrency(totalAgentCashInHand)})</span>
          </button>
          <button
            onClick={() => setActiveSubTab('outages')}
            className={`px-3 py-1.5 rounded-lg font-bold transition flex items-center gap-1.5 cursor-pointer ${
              activeSubTab === 'outages'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Fiber Outages ({activeOutages.length})</span>
          </button>
          <button
            onClick={() => setActiveSubTab('olt_telemetry')}
            className={`px-3 py-1.5 rounded-lg font-bold transition flex items-center gap-1.5 cursor-pointer ${
              activeSubTab === 'olt_telemetry'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Layers className="w-3.5 h-3.5 text-cyan-400" />
            <span>OLT Telemetry ({validOnus.length})</span>
          </button>
        </div>
      </div>

      {/* Live KPI Status Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-xl">
          <span className="text-slate-400 text-[10px] uppercase font-mono block">Online PPPoE Sessions</span>
          <div className="text-xl font-bold font-mono text-emerald-400 mt-1 flex items-center justify-between">
            <span>{liveSessions.length}</span>
            <Activity className="w-4 h-4 text-emerald-500" />
          </div>
          <span className="text-[10px] text-slate-500 mt-0.5 block">
            of {scopedSubscribers.length} registered subscribers
          </span>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-xl">
          <span className="text-slate-400 text-[10px] uppercase font-mono block">Pending SLA Tickets</span>
          <div className="text-xl font-bold font-mono text-amber-400 mt-1 flex items-center justify-between">
            <span>{openTickets.length}</span>
            <Clock className="w-4 h-4 text-amber-500" />
          </div>
          <span className="text-[10px] text-slate-500 mt-0.5 block">
            {scopedTickets.length} total in Supabase
          </span>
        </div>

        <FeatureGate
          feature="manager_view_billing_revenue"
          role={activeManager?.role === 'ADMIN' ? 'ADMIN' : 'MANAGER'}
          fallback={
            <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-xl opacity-60">
              <span className="text-slate-400 text-[10px] uppercase font-mono block">Agent Cash In Hand</span>
              <div className="text-sm font-bold font-mono text-slate-500 mt-2 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-amber-400" />
                <span>Restricted by Admin</span>
              </div>
              <span className="text-[10px] text-slate-600 mt-1 block">Revenue hidden</span>
            </div>
          }
        >
          <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-xl">
            <span className="text-slate-400 text-[10px] uppercase font-mono block">Agent Cash In Hand</span>
            <div className="text-xl font-bold font-mono text-cyan-300 mt-1 flex items-center justify-between">
              <span>{formatCurrency(totalAgentCashInHand)}</span>
              <CreditCard className="w-4 h-4 text-cyan-400" />
            </div>
            <span className="text-[10px] text-slate-500 mt-0.5 block">
              {scopedAgents.length} Field Agents Tracked
            </span>
          </div>
        </FeatureGate>

        <FeatureGate
          feature="manager_view_billing_revenue"
          role={activeManager?.role === 'ADMIN' ? 'ADMIN' : 'MANAGER'}
          fallback={
            <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-xl opacity-60">
              <span className="text-slate-400 text-[10px] uppercase font-mono block">Collected Today</span>
              <div className="text-sm font-bold font-mono text-slate-500 mt-2 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-amber-400" />
                <span>Restricted by Admin</span>
              </div>
              <span className="text-[10px] text-slate-600 mt-1 block">Revenue hidden</span>
            </div>
          }
        >
          <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-xl">
            <span className="text-slate-400 text-[10px] uppercase font-mono block">Collected Today</span>
            <div className="text-xl font-bold font-mono text-emerald-400 mt-1 flex items-center justify-between">
              <span>{formatCurrency(totalCollectedToday)}</span>
              <TrendingUp className="w-4 h-4 text-emerald-400" />
            </div>
            <span className="text-[10px] text-slate-500 mt-0.5 block">Live Supabase ledger recoveries</span>
          </div>
        </FeatureGate>
      </div>

      {/* Live Technician Workload Strip */}
      {scopedAgents.length > 0 && (
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400 font-bold flex items-center gap-1.5">
              <Wrench className="w-3.5 h-3.5 text-cyan-400" />
              <span>Live Technician &amp; Field Agent Workload</span>
            </span>
            <span className="text-[10px] font-mono text-slate-500">
              {scopedAgents.length} Active Staff
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {scopedAgents.map((ag) => {
              const stats = agentFinancials[ag.id] || { openTickets: 0, cashInHand: 0, collectedToday: 0 };
              return (
                <div
                  key={ag.id}
                  className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 flex items-center gap-3 text-xs font-mono"
                >
                  <div>
                    <span className="font-bold text-white font-sans block">{ag.full_name}</span>
                    <span className="text-[10px] text-slate-400">{ag.area || 'Unassigned Area'}</span>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      stats.openTickets > 0
                        ? 'bg-amber-950 text-amber-300 border border-amber-800'
                        : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                    }`}
                  >
                    {stats.openTickets} Open
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Subtab 1: Live Supabase Tickets & Dispatch */}
      {activeSubTab === 'tickets' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-white text-sm">Subscriber Complaint SLA &amp; Dispatch</h3>
              <p className="text-slate-400 text-xs">
                Real-time Supabase ticket queue. Assign field technicians and mark resolved tickets.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setTicketFilter('all')}
                className={`px-2.5 py-1 rounded font-mono font-bold cursor-pointer ${
                  ticketFilter === 'all' ? 'bg-indigo-600 text-white' : 'bg-slate-950 text-slate-400'
                }`}
              >
                All ({scopedTickets.length})
              </button>
              <button
                onClick={() => setTicketFilter('open')}
                className={`px-2.5 py-1 rounded font-mono font-bold cursor-pointer ${
                  ticketFilter === 'open' ? 'bg-indigo-600 text-white' : 'bg-slate-950 text-slate-400'
                }`}
              >
                Open ({openTickets.length})
              </button>
              <button
                onClick={() => setTicketFilter('critical')}
                className={`px-2.5 py-1 rounded font-mono font-bold cursor-pointer ${
                  ticketFilter === 'critical' ? 'bg-rose-600 text-white' : 'bg-slate-950 text-slate-400'
                }`}
              >
                Critical
              </button>

              <FeatureGate
                feature="manager_tickets_create_assign"
                role={activeManager?.role === 'ADMIN' ? 'ADMIN' : 'MANAGER'}
                mode="disable"
              >
                <button
                  onClick={onOpenTicketModal}
                  className="bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold px-3 py-1 rounded-lg transition cursor-pointer"
                >
                  + New Ticket
                </button>
              </FeatureGate>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2.5 px-3">Ticket #</th>
                  <th className="py-2.5 px-3">Subscriber</th>
                  <th className="py-2.5 px-3">Issue Details</th>
                  <th className="py-2.5 px-3">Priority</th>
                  <th className="py-2.5 px-3">Assigned Technician</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {isLoading ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-500">
                      Loading live dispatch tickets...
                    </td>
                  </tr>
                ) : filteredTickets.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-500">
                      No tickets match the current filter.
                    </td>
                  </tr>
                ) : (
                  filteredTickets.map((ticket) => {
                    const sub = subscriberMap[(ticket.subscriber_username || '').toLowerCase()];
                    const phone = sub?.phone || '';
                    const stUpper = (ticket.status || 'OPEN').toUpperCase();
                    const prioUpper = (ticket.priority || 'MEDIUM').toUpperCase();
                    const isResolved = stUpper === 'RESOLVED';

                    return (
                      <tr key={ticket.id} className="hover:bg-slate-800/30">
                        <td className="py-2.5 px-3 font-bold text-cyan-400">{ticket.ticket_no}</td>
                        <td className="py-2.5 px-3 font-sans">
                          <div className="font-bold text-white">
                            {sub?.full_name || `@${ticket.subscriber_username}`}
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono flex items-center gap-2">
                            <span>@{ticket.subscriber_username}</span>
                            {phone && (
                              <a href={`tel:${phone}`} className="text-cyan-400 hover:underline flex items-center gap-0.5">
                                <Phone className="w-2.5 h-2.5" />
                                {phone}
                              </a>
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-slate-300">
                          <div className="max-w-[240px] truncate">{ticket.issue}</div>
                          {sub?.area && (
                            <div className="text-[10px] text-slate-500">{sub.area}</div>
                          )}
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              prioUpper === 'CRITICAL'
                                ? 'bg-rose-950 text-rose-300 border border-rose-800'
                                : prioUpper === 'HIGH'
                                ? 'bg-amber-950 text-amber-300 border border-amber-800'
                                : 'bg-slate-800 text-slate-300'
                            }`}
                          >
                            {prioUpper}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          <FeatureGate
                            feature="manager_tickets_create_assign"
                            role={activeManager?.role === 'ADMIN' ? 'ADMIN' : 'MANAGER'}
                            mode="disable"
                          >
                            <select
                              value={ticket.assigned_agent_id || ''}
                              onChange={(e) => handleAssignTicket(ticket, e.target.value)}
                              className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-200 text-xs focus:outline-none focus:border-cyan-500"
                            >
                              <option value="">Unassigned</option>
                              {agents.map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.full_name} ({a.area || 'Field'})
                                </option>
                              ))}
                            </select>
                          </FeatureGate>
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              isResolved
                                ? 'bg-emerald-950 text-emerald-300'
                                : 'bg-amber-950 text-amber-300'
                            }`}
                          >
                            {stUpper}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          {!isResolved && (
                            <button
                              onClick={() => handleResolveTicket(ticket)}
                              className="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold transition cursor-pointer"
                            >
                              Resolve
                            </button>
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

      {/* Subtab 2: Live Supabase Subscribers & MikroTik Sessions */}
      {activeSubTab === 'subscribers' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-white text-sm">Subscriber Directory &amp; Live Sessions</h3>
              <p className="text-slate-400 text-xs">
                Live Supabase subscriber accounts synced with active MikroTik RouterOS sessions.
              </p>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
              <input
                type="text"
                value={searchSubscriber}
                onChange={(e) => setSearchSubscriber(e.target.value)}
                placeholder="Search name, PPPoE user, area..."
                className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500 font-mono"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2.5 px-3">Subscriber</th>
                  <th className="py-2.5 px-3">PPPoE User</th>
                  <th className="py-2.5 px-3">Active IP / Uptime</th>
                  <th className="py-2.5 px-3">Area Node</th>
                  <th className="py-2.5 px-3">Balance Due</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3 text-right">Control Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredSubscribers.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-500">
                      No subscribers match this search or sector filter.
                    </td>
                  </tr>
                ) : (
                  filteredSubscribers.slice(0, 30).map((sub) => {
                    const subKey = (sub?.username || '').trim().toLowerCase();
                    const liveSess = liveSessionByUsername[subKey];
                    const isOnline = Boolean(liveSess);
                    const dueBal = dueBalanceByUsername[subKey] || 0;
                    const acctStatus = (sub?.account_status || 'ACTIVE').toUpperCase();

                    return (
                      <tr key={sub.id} className="hover:bg-slate-800/30">
                        <td className="py-2 px-3 font-sans">
                          <div className="font-bold text-white">{sub.full_name}</div>
                          {sub.phone && (
                            <a href={`tel:${sub.phone}`} className="text-[10px] text-cyan-400 hover:underline font-mono">
                              {sub.phone}
                            </a>
                          )}
                        </td>
                        <td className="py-2 px-3 text-cyan-400">{sub.username}</td>
                        <td className="py-2 px-3 text-slate-300">
                          {liveSess ? (
                            <div>
                              <span className="text-emerald-300">{liveSess.address || 'Connected'}</span>
                              {liveSess.uptime && (
                                <span className="text-[10px] text-slate-500 block">{liveSess.uptime}</span>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-500">Offline</span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-slate-400">{sub.area || 'Unassigned'}</td>
                        <td className="py-2 px-3 font-bold">
                          <span className={dueBal > 0 ? 'text-rose-400' : 'text-emerald-400'}>
                            {formatCurrency(dueBal)}
                          </span>
                        </td>
                        <td className="py-2 px-3">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              isOnline
                                ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                                : acctStatus === 'EXPIRED' || acctStatus === 'SUSPENDED'
                                ? 'bg-rose-950 text-rose-300 border border-rose-800'
                                : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            {isOnline ? 'ONLINE' : acctStatus}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <FeatureGate
                              feature="manager_edit_subscribers"
                              role={activeManager?.role === 'ADMIN' ? 'ADMIN' : 'MANAGER'}
                              mode="disable"
                            >
                              <button
                                onClick={() => {
                                  setEditingSubscriber(sub);
                                  setEditPhone(sub.phone || '');
                                  setEditAddress(sub.address || '');
                                  setEditArea(sub.area || '');
                                }}
                                className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 text-[11px] font-sans font-bold flex items-center gap-1 transition cursor-pointer"
                                title="Edit Subscriber Profile"
                              >
                                <Edit className="w-3 h-3" />
                                <span>Edit</span>
                              </button>
                            </FeatureGate>

                            <FeatureGate
                              feature="manager_routeros_active_kick"
                              role={activeManager?.role === 'ADMIN' ? 'ADMIN' : 'MANAGER'}
                              mode="disable"
                            >
                              <button
                                onClick={() => handleKickUserSession(sub)}
                                disabled={kickingUsername === sub.username || !isOnline}
                                className="px-2 py-1 rounded bg-rose-950/80 hover:bg-rose-900 disabled:opacity-40 text-rose-300 border border-rose-800 text-[11px] font-sans font-bold flex items-center gap-1 transition cursor-pointer"
                                title="Force Disconnect PPPoE Session on RouterOS"
                              >
                                <Power className="w-3 h-3" />
                                <span>{kickingUsername === sub.username ? 'Kicking...' : 'Kick'}</span>
                              </button>
                            </FeatureGate>
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
      )}

      {/* Subtab 3: Live Supabase Agent Cash Recovery */}
      {activeSubTab === 'agent_cash' && (
        <FeatureGate
          feature="manager_view_billing_revenue"
          role={activeManager?.role === 'ADMIN' ? 'ADMIN' : 'MANAGER'}
          mode="banner"
          disabledMessage="Detailed revenue, collection figures, and agent cash handovers are hidden for this role by Administrator policy."
        >
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
            <div>
              <h3 className="font-bold text-white text-sm">Field Agent Cash Recovery Status</h3>
              <p className="text-slate-400 text-xs">
                Live balance computed directly from Supabase <code className="text-cyan-400">payment_transactions</code> &amp; <code className="text-cyan-400">agent_cash_transactions</code>.
              </p>
            </div>

            {scopedAgents.length === 0 ? (
              <div className="py-8 text-center text-slate-500 font-mono text-xs">
                No field agents found for this area filter.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {scopedAgents.map((agent) => {
                  const fin = agentFinancials[agent.id] || { cashInHand: 0, collectedToday: 0, openTickets: 0 };
                  return (
                    <div key={agent.id} className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-white text-sm font-sans">{agent.full_name}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 font-mono">
                          {agent.area || 'Field'}
                        </span>
                      </div>
                      <div className="flex justify-between font-mono text-xs pt-1 border-t border-slate-800">
                        <span className="text-slate-400">Cash in Hand:</span>
                        <span className="text-cyan-300 font-bold">{formatCurrency(Math.max(0, fin.cashInHand))}</span>
                      </div>
                      <div className="flex justify-between font-mono text-xs">
                        <span className="text-slate-400">Collected Today:</span>
                        <span className="text-emerald-400 font-bold">{formatCurrency(fin.collectedToday)}</span>
                      </div>
                      <div className="flex justify-between font-mono text-xs text-slate-500">
                        <span>Phone:</span>
                        <span>{agent.phone || 'Not set'}</span>
                      </div>

                      <FeatureGate
                        feature="manager_manual_cash_approval"
                        role={activeManager?.role === 'ADMIN' ? 'ADMIN' : 'MANAGER'}
                        mode="disable"
                      >
                        <button
                          onClick={() => handleApproveHandover(agent, fin.cashInHand)}
                          disabled={fin.cashInHand <= 0 || approvingAgentId === agent.id}
                          className="w-full mt-2 py-1.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>
                            {approvingAgentId === agent.id ? 'Recording...' : 'Approve Cash Handover'}
                          </span>
                        </button>
                      </FeatureGate>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </FeatureGate>
      )}

      {/* Subtab 4: Outages & Fiber Breaks */}
      {activeSubTab === 'outages' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-white text-sm">Fiber Outage Incidents &amp; Splice Teams</h3>
              <p className="text-slate-400 text-xs">
                Acknowledge line fractures, assign emergency field teams, and trigger restoration.
              </p>
            </div>
            <button
              onClick={onOpenOutageModal}
              className="bg-rose-600 hover:bg-rose-500 text-white font-bold px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 transition cursor-pointer"
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Broadcast Outage Alert</span>
            </button>
          </div>

          <div className="space-y-3">
            {scopedOutages.length === 0 ? (
              <div className="py-8 text-center text-slate-500 font-mono text-xs bg-slate-950 border border-slate-800 rounded-xl">
                No active fiber outages recorded. All child area nodes under {PARENT_FLEET_ROUTER} are healthy.
              </div>
            ) : (
              scopedOutages.map((outage) => {
                const areaSubCount = subscribers.filter(
                  (s) => (s?.area || '').toLowerCase() === (outage?.areaNode || '').toLowerCase()
                ).length;

                return (
                  <div
                    key={outage.id}
                    className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-3"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2 py-0.5 rounded font-mono font-bold text-[10px] uppercase ${
                            outage.status === 'active'
                              ? 'bg-rose-950 text-rose-300 border border-rose-800'
                              : outage.status === 'splicing' || outage.status === 'testing'
                              ? 'bg-amber-950 text-amber-300 border border-amber-800'
                              : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                          }`}
                        >
                          {outage.status}
                        </span>
                        <span className="font-bold text-white">{outage.areaNode}</span>
                        <span className="text-slate-500 text-[10px] font-mono">
                          ({areaSubCount || outage.affectedCustomersCount || 0} Subscribers Impacted)
                        </span>
                      </div>
                      <p className="text-slate-400 text-xs">{outage.cause || 'Physical optical trunk fracture detected.'}</p>
                      <div className="flex items-center gap-3 text-[10px] font-mono text-slate-500">
                        <span>Started: {new Date(outage.startTime).toLocaleTimeString()}</span>
                        <span>&bull;</span>
                        <span>
                          Title: <strong className="text-cyan-400">{outage.title}</strong>
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {outage.status === 'active' && (
                        <button
                          onClick={() => updateOutage(outage.id, { status: 'splicing' })}
                          className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold font-mono transition cursor-pointer"
                        >
                          Acknowledge &amp; Dispatch
                        </button>
                      )}
                      {outage.status !== 'resolved' && (
                        <button
                          onClick={() => resolveOutage(outage.id, 'Resolved by NOC Operations Manager')}
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold font-mono transition cursor-pointer"
                        >
                          Mark Resolved
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Subtab 5: OLT Optical Telemetry (Strict real data / clean empty state) */}
      {activeSubTab === 'olt_telemetry' && (
        <FeatureGate
          feature="manager_olt_optical_telemetry"
          role={activeManager?.role === 'ADMIN' ? 'ADMIN' : 'MANAGER'}
          mode="banner"
          disabledMessage="OLT Optical Telemetry and GPON port diagnostics are disabled for this role by Administrator policy."
        >
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-white text-sm">VSOL OLT Optical Port Telemetry &amp; Signal Levels</h3>
                <p className="text-slate-400 text-xs">
                  GPON PON port optical status and active ONU attenuation.
                </p>
              </div>
              <span
                className={`px-2.5 py-1 rounded text-[11px] font-mono font-bold border ${
                  validOnus.length > 0
                    ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                    : 'bg-slate-950 text-slate-400 border-slate-800'
                }`}
              >
                {validOnus.length > 0 ? 'SNMP v2c Online' : 'No OLT Polled'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono">
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-1">
                <span className="text-[10px] text-slate-400 uppercase block">Total ONUs Tracked</span>
                <span className="text-2xl font-bold text-cyan-400">{validOnus.length} ONUs</span>
                <span className="text-[10px] text-slate-500 block">Live GPON PON Ports</span>
              </div>
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-1">
                <span className="text-[10px] text-slate-400 uppercase block">Average Rx Power</span>
                <span className="text-2xl font-bold text-emerald-400">
                  {averageRxDbm ? `${averageRxDbm} dBm` : 'N/A'}
                </span>
                <span className="text-[10px] text-slate-500 block">Optimal Range (-14 to -24 dBm)</span>
              </div>
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-1">
                <span className="text-[10px] text-slate-400 uppercase block">Degraded / Critical Signals</span>
                <span className="text-2xl font-bold text-amber-400">
                  {validOnus.filter((o) => (o.rxPowerDbm || 0) < -25).length} ONUs
                </span>
                <span className="text-[10px] text-slate-500 block">High Attenuation Alerts</span>
              </div>
            </div>

            {validOnus.length === 0 ? (
              <div className="py-8 text-center text-slate-500 font-mono text-xs bg-slate-950 border border-slate-800 rounded-xl">
                No VSOL OLT ONU telemetry devices connected yet. Configure an OLT in VSOL OLT Studio to view live optical dBm signals.
              </div>
            ) : (
              <div className="overflow-x-auto pt-2">
                <table className="w-full text-left font-mono text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400">
                      <th className="py-2 px-3">ONU Device</th>
                      <th className="py-2 px-3">Subscriber</th>
                      <th className="py-2 px-3">PON Port</th>
                      <th className="py-2 px-3">Rx Power (dBm)</th>
                      <th className="py-2 px-3">Optical Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {validOnus.map((onu) => {
                      const rx = onu.rxPowerDbm || 0;
                      const isGood = rx > -24 && rx < -14;
                      const isWarn = rx <= -24 && rx >= -27;

                      return (
                        <tr key={onu.id} className="hover:bg-slate-800/30">
                          <td className="py-2 px-3 font-bold text-white">{onu.model}</td>
                          <td className="py-2 px-3 text-cyan-400 font-sans">{onu.customerName}</td>
                          <td className="py-2 px-3 text-slate-300">PON {onu.ponPort || '1/1'}</td>
                          <td className="py-2 px-3 font-bold">
                            <span
                              className={
                                isGood
                                  ? 'text-emerald-400'
                                  : isWarn
                                  ? 'text-amber-400'
                                  : 'text-rose-400'
                              }
                            >
                              {rx.toFixed(1)} dBm
                            </span>
                          </td>
                          <td className="py-2 px-3">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                isGood
                                  ? 'bg-emerald-950 text-emerald-300'
                                  : isWarn
                                  ? 'bg-amber-950 text-amber-300'
                                  : 'bg-rose-950 text-rose-300'
                              }`}
                            >
                              {isGood ? 'OPTIMAL' : isWarn ? 'WARNING' : 'CRITICAL'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </FeatureGate>
      )}

      {/* Edit Subscriber Modal (Persisted to Supabase portal_users + AreaNodeSelector) */}
      {editingSubscriber && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="font-bold text-white text-sm">
                Edit Subscriber: {editingSubscriber.full_name} (@{editingSubscriber.username})
              </h3>
              <button
                onClick={() => setEditingSubscriber(null)}
                className="text-slate-400 hover:text-white text-lg cursor-pointer"
              >
                &times;
              </button>
            </div>

            <div className="space-y-3 font-mono">
              <div>
                <label className="block text-slate-400 text-[11px] mb-1">Contact Phone</label>
                <input
                  type="text"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-white text-xs focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 text-[11px] mb-1">Physical Address</label>
                <input
                  type="text"
                  value={editAddress}
                  onChange={(e) => setEditAddress(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-white text-xs focus:outline-none focus:border-cyan-500"
                />
              </div>

              <AreaNodeSelector
                value={editArea}
                onChange={setEditArea}
                areas={networkAreas}
                onAreasUpdated={setNetworkAreas}
                label="Area / Child Node"
              />
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                onClick={() => setEditingSubscriber(null)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 font-bold hover:bg-slate-700 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveSubscriberEdit}
                disabled={isSavingSub}
                className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold transition cursor-pointer disabled:opacity-50"
              >
                {isSavingSub ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
