import React, { useState } from 'react';
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
} from 'lucide-react';
import { useISP } from '../context/ISPContext';
import { useCurrency } from '../context/CurrencyContext';
import { UserAccount } from '../types/auth';
import { Invoice } from '../types/isp';
import { FeatureGate } from './FeatureGate';
import { PWAInstallPrompt } from './PWAInstallPrompt';

interface FieldAgentPortalProps {
  currentUser: UserAccount;
  onOpenReceiptModal: (invoice: Invoice) => void;
  onOpenPaymentModal: (invoice: Invoice) => void;
}

export const FieldAgentPortal: React.FC<FieldAgentPortalProps> = ({
  currentUser,
  onOpenReceiptModal,
  onOpenPaymentModal,
}) => {
  const {
    agents,
    customers,
    complaints,
    invoices,
    onus,
    collectAgentCashPayment,
    resolveTicket,
  } = useISP();
  const { formatCurrency, currencySymbol } = useCurrency();

  // Find agent matching currentUser
  const activeAgent =
    agents.find((a) => a.id === currentUser.linkedAgentId || a.name.toLowerCase().includes(currentUser.username)) ||
    agents[0];

  const [activeTab, setActiveTab] = useState<'tickets' | 'collections' | 'ont_checker' | 'directory'>('tickets');
  const [collectionSuccessToast, setCollectionSuccessToast] = useState<string | null>(null);
  const [ontSearchQuery, setOntSearchQuery] = useState('');
  const [dirSearchQuery, setDirSearchQuery] = useState('');

  // Agent's assigned tickets
  const myAssignedTickets = complaints.filter(
    (c) => c.assignedAgentId === activeAgent.id || c.status !== 'resolved'
  );

  // Unpaid invoices in agent's area
  const areaInvoices = invoices.filter((i) => i.status !== 'paid');

  // Handle direct cash collection with 1-click WhatsApp receipt
  const handleCollectCash = async (invoice: Invoice) => {
    try {
      await collectAgentCashPayment(invoice.id, activeAgent.id, invoice.totalAmount);
      setCollectionSuccessToast(
        `Collected ${formatCurrency(invoice.totalAmount)} from ${invoice.customerName}! 1-Click WhatsApp receipt dispatched.`
      );
      setTimeout(() => setCollectionSuccessToast(null), 5000);
    } catch (err: any) {
      setCollectionSuccessToast(`Collection error: ${err.message || 'Failed'}`);
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
                <h2 className="text-sm font-bold text-white">{activeAgent.name}</h2>
                <PWAInstallPrompt role="AGENT" variant="button" />
              </div>
              <span className="text-[11px] text-emerald-400 font-mono flex items-center gap-1">
                <MapPin className="w-3 h-3" /> {activeAgent.assignedArea}
              </span>
            </div>
          </div>

          <div className="text-right">
            <span className="text-[10px] text-slate-400 block font-mono">Cash in Hand</span>
            <span className="text-sm font-bold text-cyan-300 font-mono block">
              {formatCurrency(activeAgent.cashInHand)}
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
          <span>Tickets</span>
        </button>

        <button
          onClick={() => setActiveTab('collections')}
          className={`py-2 rounded-lg transition flex items-center justify-center gap-1 cursor-pointer ${
            activeTab === 'collections' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'
          }`}
        >
          <DollarSign className="w-3 h-3" />
          <span>Cash</span>
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

      {/* Tab 1: My Assigned Tickets */}
      {activeTab === 'tickets' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-slate-400 text-[11px] px-1 font-mono">
            <span>Active Dispatch Tasks in your Sector</span>
            <span>{myAssignedTickets.length} Pending</span>
          </div>

          {myAssignedTickets.map((ticket) => (
            <div
              key={ticket.id}
              className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 space-y-2.5 shadow-md"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="font-bold text-white text-xs block">{ticket.customerName}</span>

                  {/* FeatureGate: agent_view_subscriber_contact_location */}
                  <FeatureGate
                    feature="agent_view_subscriber_contact_location"
                    role="AGENT"
                    fallback={
                      <span className="text-[10px] text-slate-500 font-mono italic block mt-0.5">
                        [Location masked by Admin policy]
                      </span>
                    }
                  >
                    <span className="text-[11px] text-slate-400 block mt-0.5">{ticket.customerAddress}</span>
                  </FeatureGate>
                </div>
                <span
                  className={`px-1.5 py-0.5 rounded font-mono font-bold text-[10px] ${
                    ticket.priority === 'critical'
                      ? 'bg-rose-950 text-rose-300 border border-rose-800'
                      : 'bg-amber-950 text-amber-300 border border-amber-800'
                  }`}
                >
                  {ticket.priority}
                </span>
              </div>

              <div className="p-2 bg-slate-950 rounded-lg text-slate-300 text-[11px] font-mono leading-relaxed">
                🚨 {ticket.description || 'Optical fiber drop disconnected. Verify subscriber splice point.'}
              </div>

              <div className="flex items-center justify-between pt-1 border-t border-slate-800/80">
                {/* FeatureGate: agent_view_subscriber_contact_location */}
                <FeatureGate
                  feature="agent_view_subscriber_contact_location"
                  role="AGENT"
                  fallback={
                    <span className="text-[10px] text-slate-500 font-mono py-1">
                      [Phone Contact Restricted]
                    </span>
                  }
                >
                  <a
                    href={`tel:${ticket.customerPhone}`}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-400 font-mono text-[11px] flex items-center gap-1.5"
                  >
                    <Phone className="w-3 h-3" />
                    <span>Call: {ticket.customerPhone}</span>
                  </a>
                </FeatureGate>

                {ticket.status !== 'resolved' ? (
                  /* FeatureGate: agent_resolve_fiber_tickets */
                  <FeatureGate
                    feature="agent_resolve_fiber_tickets"
                    role="AGENT"
                    mode="disable"
                  >
                    <button
                      onClick={() => resolveTicket(ticket.id, 'Resolved in field by technician')}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold font-mono text-[11px] flex items-center gap-1 transition cursor-pointer"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Mark Fixed</span>
                    </button>
                  </FeatureGate>
                ) : (
                  <span className="text-emerald-400 font-mono text-[11px]">✓ Resolved</span>
                )}
              </div>
            </div>
          ))}

          {myAssignedTickets.length === 0 && (
            <div className="text-center py-10 bg-slate-900 border border-slate-800 rounded-xl text-slate-500">
              No pending field tickets assigned. All subscriber lines nominal!
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Doorstep Cash Collection with agent_collect_cash_receipts */}
      {activeTab === 'collections' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-slate-400 text-[11px] px-1 font-mono">
            <span>Outstanding Subscriber Dues</span>
            <span>1-Click Cash Recovery</span>
          </div>

          {areaInvoices.slice(0, 10).map((inv) => (
            <div
              key={inv.id}
              className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 space-y-2.5 shadow-md"
            >
              <div className="flex items-start justify-between">
                <div>
                  <span className="font-bold text-white text-xs block">{inv.customerName}</span>
                  <span className="text-[11px] text-slate-400 font-mono">Invoice #{inv.invoiceNumber}</span>
                  <span className="text-[10px] text-slate-500 block">{inv.packageName}</span>
                </div>
                <div className="text-right">
                  <span className="text-rose-400 font-bold font-mono text-sm block">
                    {formatCurrency(inv.totalAmount)}
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono">Due: {inv.dueDate}</span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-800">
                {/* FeatureGate: agent_view_subscriber_contact_location */}
                <FeatureGate
                  feature="agent_view_subscriber_contact_location"
                  role="AGENT"
                  fallback={
                    <span className="text-[10px] text-slate-500 font-mono">[Contact Protected]</span>
                  }
                >
                  <a
                    href={`tel:${inv.customerPhone}`}
                    className="px-2 py-1 rounded bg-slate-800 text-slate-300 text-[11px] flex items-center gap-1"
                  >
                    <Phone className="w-3 h-3 text-cyan-400" />
                    <span>{inv.customerPhone}</span>
                  </a>
                </FeatureGate>

                {/* FeatureGate: agent_collect_cash_receipts */}
                <FeatureGate
                  feature="agent_collect_cash_receipts"
                  role="AGENT"
                  mode="disable"
                >
                  <button
                    onClick={() => handleCollectCash(inv)}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold font-mono text-xs flex items-center gap-1.5 shadow transition cursor-pointer"
                  >
                    <DollarSign className="w-3.5 h-3.5" />
                    <span>Receive Cash &amp; Issue Receipt</span>
                  </button>
                </FeatureGate>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tab 3: Quick ONT Signal Checker with agent_check_ont_optical_power */}
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

      {/* Tab 4: Full Area Directory with agent_full_area_directory */}
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
