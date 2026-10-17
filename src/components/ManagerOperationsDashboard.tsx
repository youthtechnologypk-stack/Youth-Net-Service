import React, { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Users,
  CreditCard,
  ShieldAlert,
  Layers,
  CheckCircle2,
  Clock,
  Send,
  UserCheck,
  Search,
  Filter,
  DollarSign,
  ArrowRight,
  TrendingUp,
  Radio,
  Wifi,
  Edit,
  Zap,
  Lock,
  RefreshCw,
  Power,
  Shield,
  Eye,
} from 'lucide-react';
import { useISP } from '../context/ISPContext';
import { useCurrency } from '../context/CurrencyContext';
import { Customer, ComplaintTicket } from '../types/isp';
import { FeatureGate } from './FeatureGate';

interface ManagerOperationsDashboardProps {
  onOpenTicketModal: () => void;
  onOpenOutageModal: () => void;
  onSelectCustomer?: (customer: Customer) => void;
}

export const ManagerOperationsDashboard: React.FC<ManagerOperationsDashboardProps> = ({
  onOpenTicketModal,
  onOpenOutageModal,
  onSelectCustomer,
}) => {
  const {
    customers,
    complaints,
    outages,
    agents,
    packages,
    invoices,
    onus,
    activeSessions,
    updateOutage,
    resolveOutage,
    assignTicketToAgent,
    resolveTicket,
    kickSession,
  } = useISP();
  const { formatCurrency, currencySymbol } = useCurrency();

  const [activeSubTab, setActiveSubTab] = useState<
    'outages' | 'tickets' | 'subscribers' | 'agent_cash' | 'olt_telemetry'
  >('outages');
  const [ticketFilter, setTicketFilter] = useState<'all' | 'open' | 'critical'>('all');
  const [searchSubscriber, setSearchSubscriber] = useState('');
  const [toastNotice, setToastNotice] = useState<string | null>(null);

  // Edit subscriber state
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [editPhone, setEditPhone] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editArea, setEditArea] = useState('');

  const showToast = (msg: string) => {
    setToastNotice(msg);
    setTimeout(() => setToastNotice(null), 4000);
  };

  // Critical metrics for Manager
  const activeOutages = outages.filter((o) => o.status !== 'resolved');
  const openComplaints = complaints.filter((c) => c.status !== 'resolved');
  const totalAgentCashInHand = agents.reduce((acc, a) => acc + (a.cashInHand || 0), 0);
  const totalCollectedToday = agents.reduce((acc, a) => acc + (a.totalCollectedToday || 0), 0);

  const filteredTickets = complaints.filter((c) => {
    if (ticketFilter === 'open') return c.status !== 'resolved';
    if (ticketFilter === 'critical') return c.priority === 'critical' && c.status !== 'resolved';
    return true;
  });

  const filteredSubscribers = customers.filter(
    (c) =>
      c.name.toLowerCase().includes(searchSubscriber.toLowerCase()) ||
      c.pppoeUsername.toLowerCase().includes(searchSubscriber.toLowerCase()) ||
      c.accountNumber.toLowerCase().includes(searchSubscriber.toLowerCase()) ||
      c.phone.includes(searchSubscriber)
  );

  // Handle active session kick
  const handleKickUserSession = async (cust: Customer) => {
    const session = activeSessions.find(
      (s) => s.username.toLowerCase() === cust.pppoeUsername.toLowerCase()
    );
    if (session) {
      await kickSession(session.id);
      showToast(`Terminated active PPPoE session for @${cust.pppoeUsername} on RouterOS.`);
    } else {
      showToast(`No active online session found on RouterOS for @${cust.pppoeUsername}.`);
    }
  };

  // Handle Cash Handover Approval
  const handleApproveHandover = (agentId: string, agentName: string, amount: number) => {
    showToast(`Approved cash handover of ${formatCurrency(amount)} from Agent ${agentName}. Recorded to office vault.`);
  };

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
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-gradient-to-tr from-indigo-600 to-cyan-600 text-white shadow-lg shadow-indigo-500/20">
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-white">NOC Operations &amp; Dispatch Control</h2>
              <span className="px-2 py-0.5 rounded bg-indigo-950 border border-indigo-800 text-indigo-300 font-mono text-[10px] font-bold">
                OPERATIONS MANAGER
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Supervise fiber cuts, SLA dispatching, subscriber profiles, and field agent cash reconciliation.
            </p>
          </div>
        </div>

        {/* Manager Navigation Subtabs */}
        <div className="flex flex-wrap items-center gap-1.5 bg-slate-950 p-1.5 rounded-xl border border-slate-800 font-mono text-xs">
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
            onClick={() => setActiveSubTab('tickets')}
            className={`px-3 py-1.5 rounded-lg font-bold transition flex items-center gap-1.5 cursor-pointer ${
              activeSubTab === 'tickets'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>SLA Tickets ({openComplaints.length})</span>
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
            <span>Subscribers ({customers.length})</span>
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
            onClick={() => setActiveSubTab('olt_telemetry')}
            className={`px-3 py-1.5 rounded-lg font-bold transition flex items-center gap-1.5 cursor-pointer ${
              activeSubTab === 'olt_telemetry'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Layers className="w-3.5 h-3.5 text-cyan-400" />
            <span>OLT Telemetry</span>
          </button>
        </div>
      </div>

      {/* KPI Status Strip for Manager with FeatureGate on financial figures */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-xl">
          <span className="text-slate-400 text-[10px] uppercase font-mono block">Active Fiber Cuts</span>
          <div className="text-xl font-bold font-mono text-rose-400 mt-1 flex items-center justify-between">
            <span>{activeOutages.length}</span>
            <AlertTriangle className="w-4 h-4 text-rose-500" />
          </div>
          <span className="text-[10px] text-slate-500 mt-0.5 block">Automated OLT detection</span>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-xl">
          <span className="text-slate-400 text-[10px] uppercase font-mono block">Pending Complaints</span>
          <div className="text-xl font-bold font-mono text-amber-400 mt-1 flex items-center justify-between">
            <span>{openComplaints.length}</span>
            <Clock className="w-4 h-4 text-amber-500" />
          </div>
          <span className="text-[10px] text-slate-500 mt-0.5 block">Target resolution &lt; 2h</span>
        </div>

        {/* FeatureGate: manager_view_billing_revenue */}
        <FeatureGate
          feature="manager_view_billing_revenue"
          role="MANAGER"
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
            <span className="text-[10px] text-slate-500 mt-0.5 block">{agents.length} Field Agents Active</span>
          </div>
        </FeatureGate>

        {/* FeatureGate: manager_view_billing_revenue */}
        <FeatureGate
          feature="manager_view_billing_revenue"
          role="MANAGER"
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
            <span className="text-[10px] text-slate-500 mt-0.5 block">Doorstep cash recoveries</span>
          </div>
        </FeatureGate>
      </div>

      {/* Subtab 1: Outages & Fiber Breaks */}
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
            {outages.map((outage) => (
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
                    <span className="text-slate-500 text-[10px] font-mono">({outage.affectedCustomersCount} Subscribers Impacted)</span>
                  </div>
                  <p className="text-slate-400 text-xs">{outage.cause || 'Physical optical trunk fracture detected.'}</p>
                  <div className="flex items-center gap-3 text-[10px] font-mono text-slate-500">
                    <span>Started: {new Date(outage.startTime).toLocaleTimeString()}</span>
                    <span>&bull;</span>
                    <span>Title: <strong className="text-cyan-400">{outage.title}</strong></span>
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
            ))}
          </div>
        </div>
      )}

      {/* Subtab 2: Complaints & SLA Tickets with manager_tickets_create_assign */}
      {activeSubTab === 'tickets' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-white text-sm">Subscriber Complaint SLA Management</h3>
              <p className="text-slate-400 text-xs">
                Review subscriber tickets, assign to field recovery agents, and track resolution SLA.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setTicketFilter('all')}
                className={`px-2.5 py-1 rounded font-mono font-bold ${
                  ticketFilter === 'all' ? 'bg-indigo-600 text-white' : 'bg-slate-950 text-slate-400'
                }`}
              >
                All ({complaints.length})
              </button>
              <button
                onClick={() => setTicketFilter('open')}
                className={`px-2.5 py-1 rounded font-mono font-bold ${
                  ticketFilter === 'open' ? 'bg-indigo-600 text-white' : 'bg-slate-950 text-slate-400'
                }`}
              >
                Open ({openComplaints.length})
              </button>

              {/* FeatureGate: manager_tickets_create_assign */}
              <FeatureGate
                feature="manager_tickets_create_assign"
                role="MANAGER"
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
                  <th className="py-2.5 px-3">Issue Category</th>
                  <th className="py-2.5 px-3">Priority</th>
                  <th className="py-2.5 px-3">Assigned Agent</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredTickets.map((ticket) => (
                  <tr key={ticket.id} className="hover:bg-slate-800/30">
                    <td className="py-2.5 px-3 font-bold text-cyan-400">{ticket.ticketNumber}</td>
                    <td className="py-2.5 px-3 font-sans">
                      <div className="font-bold text-white">{ticket.customerName}</div>
                      <div className="text-[10px] text-slate-400 font-mono">{ticket.customerPhone}</div>
                    </td>
                    <td className="py-2.5 px-3 text-slate-300">{ticket.category}</td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          ticket.priority === 'critical'
                            ? 'bg-rose-950 text-rose-300 border border-rose-800'
                            : ticket.priority === 'high'
                            ? 'bg-amber-950 text-amber-300 border border-amber-800'
                            : 'bg-slate-800 text-slate-300'
                        }`}
                      >
                        {ticket.priority}
                      </span>
                    </td>
                    <td className="py-2.5 px-3">
                      {/* FeatureGate: manager_tickets_create_assign */}
                      <FeatureGate
                        feature="manager_tickets_create_assign"
                        role="MANAGER"
                        mode="disable"
                      >
                        <select
                          value={ticket.assignedAgentId || ''}
                          onChange={(e) => assignTicketToAgent(ticket.id, e.target.value)}
                          className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-200 text-xs focus:outline-none focus:border-cyan-500"
                        >
                          <option value="">Unassigned</option>
                          {agents.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name} ({a.assignedArea})
                            </option>
                          ))}
                        </select>
                      </FeatureGate>
                    </td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] ${
                          ticket.status === 'resolved'
                            ? 'bg-emerald-950 text-emerald-300'
                            : 'bg-amber-950 text-amber-300'
                        }`}
                      >
                        {ticket.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      {ticket.status !== 'resolved' && (
                        <button
                          onClick={() => resolveTicket(ticket.id, 'Resolved by NOC Operations Manager')}
                          className="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold transition cursor-pointer"
                        >
                          Resolve
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Subtab 3: Subscriber Overview with manager_edit_subscribers and manager_routeros_active_kick */}
      {activeSubTab === 'subscribers' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-white text-sm">Subscriber Directory &amp; Speeds</h3>
              <p className="text-slate-400 text-xs">
                Inspect subscriber provisioning parameters and current line state.
              </p>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
              <input
                type="text"
                value={searchSubscriber}
                onChange={(e) => setSearchSubscriber(e.target.value)}
                placeholder="Search name, PPPoE user..."
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
                  <th className="py-2.5 px-3">Assigned IP</th>
                  <th className="py-2.5 px-3">Area Node</th>
                  <th className="py-2.5 px-3">Balance Due</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3 text-right">Control Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredSubscribers.slice(0, 15).map((cust) => {
                  const isOnline = activeSessions.some(
                    (s) => s.username.toLowerCase() === cust.pppoeUsername.toLowerCase()
                  );

                  return (
                    <tr key={cust.id} className="hover:bg-slate-800/30">
                      <td className="py-2 px-3 font-sans font-bold text-white">{cust.name}</td>
                      <td className="py-2 px-3 text-cyan-400">{cust.pppoeUsername}</td>
                      <td className="py-2 px-3 text-slate-300">{cust.assignedIp}</td>
                      <td className="py-2 px-3 text-slate-400">{cust.areaNode}</td>
                      <td className="py-2 px-3 text-rose-400 font-bold">{formatCurrency(cust.balanceDue)}</td>
                      <td className="py-2 px-3">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] ${
                            isOnline
                              ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {isOnline ? 'ONLINE' : cust.status}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* FeatureGate: manager_edit_subscribers */}
                          <FeatureGate
                            feature="manager_edit_subscribers"
                            role="MANAGER"
                            mode="disable"
                          >
                            <button
                              onClick={() => {
                                setEditingCustomer(cust);
                                setEditPhone(cust.phone || '');
                                setEditAddress(cust.address || '');
                                setEditArea(cust.areaNode || '');
                              }}
                              className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 text-[11px] font-sans font-bold flex items-center gap-1 transition cursor-pointer"
                              title="Edit Subscriber Profile"
                            >
                              <Edit className="w-3 h-3" />
                              <span>Edit</span>
                            </button>
                          </FeatureGate>

                          {/* FeatureGate: manager_routeros_active_kick */}
                          <FeatureGate
                            feature="manager_routeros_active_kick"
                            role="MANAGER"
                            mode="disable"
                          >
                            <button
                              onClick={() => handleKickUserSession(cust)}
                              className="px-2 py-1 rounded bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-800 text-[11px] font-sans font-bold flex items-center gap-1 transition cursor-pointer"
                              title="Force Disconnect PPPoE Session on RouterOS"
                            >
                              <Power className="w-3 h-3" />
                              <span>Kick</span>
                            </button>
                          </FeatureGate>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Subtab 4: Agent Cash Summary with manager_view_billing_revenue and manager_manual_cash_approval */}
      {activeSubTab === 'agent_cash' && (
        <FeatureGate
          feature="manager_view_billing_revenue"
          role="MANAGER"
          mode="banner"
          disabledMessage="Detailed revenue, collection figures, and agent cash handovers are hidden for this role by Administrator policy."
        >
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
            <div>
              <h3 className="font-bold text-white text-sm">Field Agent Cash Recovery Status</h3>
              <p className="text-slate-400 text-xs">
                Live tracking of cash held by recovery agents awaiting office vault handover.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {agents.map((agent) => (
                <div key={agent.id} className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-white text-sm font-sans">{agent.name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 font-mono">
                      {agent.assignedArea}
                    </span>
                  </div>
                  <div className="flex justify-between font-mono text-xs pt-1 border-t border-slate-800">
                    <span className="text-slate-400">Cash in Hand:</span>
                    <span className="text-cyan-300 font-bold">{formatCurrency(agent.cashInHand)}</span>
                  </div>
                  <div className="flex justify-between font-mono text-xs">
                    <span className="text-slate-400">Collected Today:</span>
                    <span className="text-emerald-400 font-bold">{formatCurrency(agent.totalCollectedToday)}</span>
                  </div>
                  <div className="flex justify-between font-mono text-xs text-slate-500">
                    <span>Phone:</span>
                    <span>{agent.phone}</span>
                  </div>

                  {/* FeatureGate: manager_manual_cash_approval */}
                  <FeatureGate
                    feature="manager_manual_cash_approval"
                    role="MANAGER"
                    mode="disable"
                  >
                    <button
                      onClick={() => handleApproveHandover(agent.id, agent.name, agent.cashInHand || 0)}
                      disabled={!agent.cashInHand || agent.cashInHand <= 0}
                      className="w-full mt-2 py-1.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Approve Cash Handover</span>
                    </button>
                  </FeatureGate>
                </div>
              ))}
            </div>
          </div>
        </FeatureGate>
      )}

      {/* Subtab 5: OLT Optical Telemetry with manager_olt_optical_telemetry */}
      {activeSubTab === 'olt_telemetry' && (
        <FeatureGate
          feature="manager_olt_optical_telemetry"
          role="MANAGER"
          mode="banner"
          disabledMessage="OLT Optical Telemetry and GPON port diagnostics are disabled for this role by Administrator policy."
        >
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-white text-sm">VSOL OLT Optical Port Telemetry &amp; Signal Levels</h3>
                <p className="text-slate-400 text-xs">
                  GPON PON port optical status, active ONU attenuation, and laser Tx power levels.
                </p>
              </div>
              <span className="px-2.5 py-1 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 text-[11px] font-mono font-bold">
                SNMP v2c Online
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono">
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-1">
                <span className="text-[10px] text-slate-400 uppercase block">Total ONUs Tracked</span>
                <span className="text-2xl font-bold text-cyan-400">{onus.length} ONUs</span>
                <span className="text-[10px] text-slate-500 block">All GPON PON Ports</span>
              </div>
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-1">
                <span className="text-[10px] text-slate-400 uppercase block">Average Rx Power</span>
                <span className="text-2xl font-bold text-emerald-400">-19.4 dBm</span>
                <span className="text-[10px] text-slate-500 block">Optimal Range (-14 to -24 dBm)</span>
              </div>
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-1">
                <span className="text-[10px] text-slate-400 uppercase block">Degraded / Critical Signals</span>
                <span className="text-2xl font-bold text-amber-400">
                  {onus.filter((o) => (o.rxPowerDbm || 0) < -25).length} ONUs
                </span>
                <span className="text-[10px] text-slate-500 block">High Attenuation Alerts</span>
              </div>
            </div>

            <div className="overflow-x-auto pt-2">
              <table className="w-full text-left font-mono text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-2 px-3">ONU Device</th>
                    <th className="py-2 px-3">Subscriber</th>
                    <th className="py-2 px-3">PON Port</th>
                    <th className="py-2 px-3">Rx Power (dBm)</th>
                    <th className="py-2 px-3">Tx Power (dBm)</th>
                    <th className="py-2 px-3">Optical Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {onus.map((onu) => {
                    const rx = onu.rxPowerDbm || -19.5;
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
                        <td className="py-2 px-3 text-slate-400">+2.4 dBm</td>
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
          </div>
        </FeatureGate>
      )}

      {/* Edit Subscriber Modal */}
      {editingCustomer && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="font-bold text-white text-sm">
                Edit Subscriber: {editingCustomer.name}
              </h3>
              <button
                onClick={() => setEditingCustomer(null)}
                className="text-slate-400 hover:text-white text-lg"
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

              <div>
                <label className="block text-slate-400 text-[11px] mb-1">Area / Sector Node</label>
                <input
                  type="text"
                  value={editArea}
                  onChange={(e) => setEditArea(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-white text-xs focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                onClick={() => setEditingCustomer(null)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 font-bold hover:bg-slate-700 transition"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  editingCustomer.phone = editPhone;
                  editingCustomer.address = editAddress;
                  editingCustomer.areaNode = editArea;
                  setEditingCustomer(null);
                  showToast(`Updated subscriber profile for ${editingCustomer.name}.`);
                }}
                className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold transition"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
