import React, { useState, useEffect } from 'react';
import {
  Smartphone,
  MapPin,
  DollarSign,
  AlertTriangle,
  Receipt,
  CheckCircle,
  Wifi,
  WifiOff,
  Activity,
  ArrowDown,
  ArrowUp,
  FileText,
  UserCheck,
  Send,
  Navigation,
  Camera,
  RotateCw,
  ShieldAlert,
  ShieldCheck,
  Building,
  Database,
  HardDrive,
  Radio,
  Layers,
} from 'lucide-react';
import { useISP } from '../context/ISPContext';
import { Customer, Invoice } from '../types/isp';
import { HandoverCashModal } from './HandoverCashModal';
import { OfflineActivityDashboard } from './OfflineActivityDashboard';
import { offlineQueueManager } from '../services/offlineQueueManager';
import { getSignalColorClass } from '../services/oltUtils';

interface MobileAppSimulatorProps {
  onOpenReceiptModal: (invoice: Invoice) => void;
  onOpenPaymentModal: (invoice: Invoice) => void;
}

export const MobileAppSimulator: React.FC<MobileAppSimulatorProps> = ({
  onOpenReceiptModal,
  onOpenPaymentModal,
}) => {
  const {
    customers,
    agents,
    invoices,
    complaints,
    cashHandovers,
    onus,
    collectAgentCashPayment,
    createComplaintTicket,
  } = useISP();

  const [deviceMode, setDeviceMode] = useState<'agent' | 'client'>('agent');
  const [selectedAgentId, setSelectedAgentId] = useState<string>(agents[0]?.id || '');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>(customers[0]?.id || '');

  // Agent App internal tabs
  const [agentTab, setAgentTab] = useState<'dues' | 'tickets' | 'history' | 'offline_dashboard'>('dues');
  const [isHandoverModalOpen, setIsHandoverModalOpen] = useState<boolean>(false);
  const [historySubTab, setHistorySubTab] = useState<'collections' | 'handovers'>('collections');
  const [handoverSuccessBanner, setHandoverSuccessBanner] = useState<string | null>(null);
  const [offlineQueueCount, setOfflineQueueCount] = useState<number>(offlineQueueManager.getMetrics().pendingQueueRecords);
  const [isSimulatorOnline, setIsSimulatorOnline] = useState<boolean>(offlineQueueManager.getNetworkStatus());

  useEffect(() => {
    const unsub = offlineQueueManager.subscribe((_state, metrics) => {
      setOfflineQueueCount(metrics.pendingQueueRecords);
      setIsSimulatorOnline(offlineQueueManager.getNetworkStatus());
    });
    return () => unsub();
  }, []);

  // Client App internal tabs
  const [clientTab, setClientTab] = useState<'home' | 'tickets' | 'bills'>('home');

  // Client App new complaint form
  const [ticketCategory, setTicketCategory] = useState<any>('slow_speed');
  const [ticketTitle, setTicketTitle] = useState('');
  const [ticketDescription, setTicketDescription] = useState('');
  const [ticketSubmittedMsg, setTicketSubmittedMsg] = useState(false);

  const currentAgent = agents.find((a) => a.id === selectedAgentId) || agents[0];
  const currentCustomer = customers.find((c) => c.id === selectedCustomerId) || customers[0];

  // Customers with pending dues for Agent App
  const customersWithDues = customers.filter((c) => c.balanceDue > 0);

  // Tickets assigned to current agent
  const agentTickets = complaints.filter(
    (t) => currentAgent && t.assignedAgentId === currentAgent.id && t.status !== 'resolved'
  );

  // Current customer invoices
  const customerInvoices = invoices.filter((i) => currentCustomer && i.customerId === currentCustomer.id);
  const customerTickets = complaints.filter((t) => currentCustomer && t.customerId === currentCustomer.id);

  // Strictly collections and handovers belonging to THIS specific agent
  const specificAgentInvoices = invoices.filter((i) => currentAgent && i.collectedByAgentId === currentAgent.id);
  const specificAgentTotalCollected = specificAgentInvoices.reduce((sum, inv) => sum + inv.totalAmount, 0);
  const specificAgentHandovers = cashHandovers.filter((h) => currentAgent && h.agentId === currentAgent.id);
  const specificAgentTotalHandedOver = specificAgentHandovers.reduce((sum, h) => sum + h.amount, 0);

  const handleAgentInstantCollect = async (cust: Customer) => {
    const targetInv = invoices.find(
      (inv) => inv.customerId === cust.id && inv.status !== 'paid'
    );
    if (!targetInv) return;

    if (!offlineQueueManager.getNetworkStatus()) {
      // Offline mode: generate local receipt & queue in WatermelonDB / SQLite
      const record = offlineQueueManager.recordOfflinePayment(
        cust,
        targetInv,
        currentAgent.id,
        currentAgent.name,
        targetInv.totalAmount,
        'cash'
      );
      currentAgent.cashInHand += record.amount;
      alert(
        `[OFFLINE MODE - NO CELL COVERAGE]\n\n` +
        `Collected: $${targetInv.totalAmount.toFixed(2)} Cash from ${cust.name}\n` +
        `Offline Receipt Ref: ${record.offlineReceiptNumber}\n` +
        `HMAC Signature: ${record.cryptographicSignature.slice(0, 16)}...\n\n` +
        `Payment committed locally to SQLite storage. Switch to the 'Offline Sync' tab to review and batch-sync with server!`
      );
    } else {
      await collectAgentCashPayment(targetInv.id, currentAgent.id, targetInv.totalAmount);
      alert(`Collected $${targetInv.totalAmount.toFixed(2)} cash from ${cust.name}. Digital WhatsApp receipt issued!`);
    }
  };

  const handleClientSubmitTicket = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticketTitle) return;

    createComplaintTicket({
      customerId: currentCustomer.id,
      customerName: currentCustomer.name,
      customerPhone: currentCustomer.phone,
      customerAddress: currentCustomer.address,
      areaNode: currentCustomer.areaNode,
      category: ticketCategory,
      priority: ticketCategory === 'fiber_cut' ? 'critical' : 'medium',
      status: 'open',
      title: ticketTitle,
      description: ticketDescription || 'Customer submitted via NetPulse Mobile Portal.',
      routerId: currentCustomer.routerId,
    });

    setTicketTitle('');
    setTicketDescription('');
    setTicketSubmittedMsg(true);
    setTimeout(() => {
      setTicketSubmittedMsg(false);
      setClientTab('tickets');
    }, 1200);
  };

  return (
    <div className="space-y-6">
      {/* Top Device & Profile Selector Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Smartphone className="w-5 h-5 text-cyan-400" />
            <h2 className="text-base font-bold text-white">
              Field Recovery & Client Mobile Application Preview
            </h2>
            <span className="text-xs px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 font-mono">
              React Native / Flutter Shell
            </span>
          </div>
          <p className="text-xs text-slate-400">
            Simulate native field operations (cash recovery & SLA fixes) and subscriber self-care.
          </p>
        </div>

        {/* Switcher Controls */}
        <div className="flex items-center gap-3">
          <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800">
            <button
              onClick={() => setDeviceMode('agent')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                deviceMode === 'agent'
                  ? 'bg-cyan-600 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Field Agent App
            </button>
            <button
              onClick={() => setDeviceMode('client')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                deviceMode === 'client'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Subscriber Portal App
            </button>
          </div>

          {/* User selector for device */}
          {deviceMode === 'agent' ? (
            <select
              value={selectedAgentId}
              onChange={(e) => setSelectedAgentId(e.target.value)}
              className="bg-slate-950 border border-slate-700 text-slate-200 text-xs px-3 py-2 rounded-lg focus:outline-none"
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  Agent: {a.name} ({a.assignedArea})
                </option>
              ))}
            </select>
          ) : (
            <select
              value={selectedCustomerId}
              onChange={(e) => setSelectedCustomerId(e.target.value)}
              className="bg-slate-950 border border-slate-700 text-slate-200 text-xs px-3 py-2 rounded-lg focus:outline-none"
            >
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  Customer: {c.name} ({c.status})
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Centered Mobile Phone Mockup Frame */}
      <div className="flex justify-center py-4">
        <div className="w-[380px] h-[740px] bg-slate-950 border-[10px] border-slate-800 rounded-[48px] shadow-2xl overflow-hidden flex flex-col relative ring-1 ring-slate-700">
          {/* Phone Notch & Speaker */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-36 h-6 bg-slate-800 rounded-b-2xl z-30 flex items-center justify-center">
            <div className="w-12 h-1.5 bg-slate-900 rounded-full" />
            <div className="w-3 h-3 rounded-full bg-slate-900 ml-3" />
          </div>

          {/* Phone Status Bar */}
          <div className="h-10 pt-2 px-6 flex items-center justify-between text-[11px] font-mono text-slate-400 z-20">
            <span>09:41</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const next = !offlineQueueManager.getNetworkStatus();
                  offlineQueueManager.setNetworkStatus(next);
                  setIsSimulatorOnline(next);
                }}
                className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase transition flex items-center gap-1 cursor-pointer ${
                  isSimulatorOnline
                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-700'
                    : 'bg-rose-950 text-rose-300 border border-rose-700 animate-pulse'
                }`}
                title="Toggle Simulated 4G LTE Online / Offline Signal"
              >
                {isSimulatorOnline ? <Wifi className="w-2.5 h-2.5" /> : <WifiOff className="w-2.5 h-2.5" />}
                <span>{isSimulatorOnline ? '4G' : 'OFFLINE'}</span>
              </button>
              <span className="font-bold text-slate-300">100%</span>
            </div>
          </div>

          {/* ======================================================== */}
          {/* SCREEN TYPE A: FIELD RECOVERY AGENT APP */}
          {/* ======================================================== */}
          {deviceMode === 'agent' && (
            <div className="flex-1 flex flex-col overflow-hidden bg-slate-900 text-slate-100">
              {/* Agent App Top Header */}
              <div className="p-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-cyan-400 font-mono uppercase tracking-wider">
                    Youth Net Field Agent
                  </span>
                  <h3 className="font-bold text-white text-sm">{currentAgent.name}</h3>
                  <p className="text-[11px] text-slate-400">{currentAgent.assignedArea}</p>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-slate-400 block font-mono">Cash in Hand</span>
                  <span className="text-sm font-bold text-cyan-300 font-mono block">
                    ${currentAgent.cashInHand.toFixed(2)}
                  </span>
                  <button
                    onClick={() => setIsHandoverModalOpen(true)}
                    className="mt-1 px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-[9px] flex items-center gap-1 ml-auto shadow-sm transition"
                    title="Handover Cash to Boss"
                  >
                    🤝 Handover
                  </button>
                </div>
              </div>

              {/* Agent Tab Bar inside App */}
              <div className="grid grid-cols-4 bg-slate-950/80 border-b border-slate-800 text-[10px] font-medium text-center">
                <button
                  onClick={() => setAgentTab('dues')}
                  className={`py-2 border-b-2 transition ${
                    agentTab === 'dues'
                      ? 'border-cyan-500 text-cyan-400 font-bold'
                      : 'border-transparent text-slate-400'
                  }`}
                >
                  Dues ({customersWithDues.length})
                </button>
                <button
                  onClick={() => setAgentTab('tickets')}
                  className={`py-2 border-b-2 transition ${
                    agentTab === 'tickets'
                      ? 'border-cyan-500 text-cyan-400 font-bold'
                      : 'border-transparent text-slate-400'
                  }`}
                >
                  SLA ({agentTickets.length})
                </button>
                <button
                  onClick={() => setAgentTab('history')}
                  className={`py-2 border-b-2 transition ${
                    agentTab === 'history'
                      ? 'border-cyan-500 text-cyan-400 font-bold'
                      : 'border-transparent text-slate-400'
                  }`}
                >
                  Ledger
                </button>
                <button
                  onClick={() => setAgentTab('offline_dashboard')}
                  className={`py-2 border-b-2 transition flex items-center justify-center gap-1 ${
                    agentTab === 'offline_dashboard'
                      ? 'border-cyan-500 text-cyan-400 font-bold bg-cyan-950/20'
                      : 'border-transparent text-slate-400'
                  }`}
                  title="Offline-First Sync & Activity Dashboard"
                >
                  <Database className="w-3 h-3 text-cyan-400" />
                  <span>Offline</span>
                  {offlineQueueCount > 0 && (
                    <span className="w-4 h-4 rounded-full bg-amber-500 text-slate-950 font-bold text-[9px] flex items-center justify-center ml-0.5 animate-bounce">
                      {offlineQueueCount}
                    </span>
                  )}
                </button>
              </div>

              {/* Agent App Scrollable Content */}
              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {/* SUB-VIEW 1: Nearby Customer Dues */}
                {agentTab === 'dues' && (
                  <>
                    <div className="flex items-center justify-between text-[11px] text-slate-400 px-1">
                      <span>Subscribers with overdue balances:</span>
                      <span className="text-cyan-400 flex items-center gap-1 font-mono">
                        <MapPin className="w-3 h-3" /> Within 1.5 km
                      </span>
                    </div>

                    {customersWithDues.map((cust) => (
                      <div
                        key={cust.id}
                        className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2 shadow-sm"
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="font-bold text-xs text-white">{cust.name}</div>
                            <div className="text-[11px] text-slate-400">{cust.address}</div>
                            <div className="text-[10px] text-slate-500 font-mono">
                              PPPoE: {cust.pppoeUsername}
                            </div>
                          </div>
                          <div className="text-right">
                            <span className="text-xs font-bold text-rose-400 font-mono block">
                              ${cust.balanceDue.toFixed(2)}
                            </span>
                            <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-950 text-amber-300 font-mono">
                              {cust.status === 'walled_garden' ? 'Walled Garden' : 'Overdue'}
                            </span>
                          </div>
                        </div>

                        {/* Live VSOL OLT / ONU Optical Signal for Field Agent */}
                        {(() => {
                          const custOnu = onus.find((o) => o.customerId === cust.id || o.pppoeUsername === cust.pppoeUsername);
                          if (!custOnu) return null;
                          const clr = getSignalColorClass(custOnu.opticalQuality);
                          return (
                            <div className="flex items-center justify-between text-[10px] font-mono px-2 py-1 rounded bg-slate-900 border border-slate-800">
                              <span className="text-slate-400 flex items-center gap-1">
                                <Radio className="w-2.5 h-2.5 text-cyan-400" />
                                <span>Fiber Rx:</span>
                                <strong className={clr.text}>{custOnu.rxPowerDbm.toFixed(1)} dBm</strong>
                              </span>
                              <span className={`text-[9px] px-1 rounded uppercase font-bold border ${clr.badge}`}>
                                {custOnu.opticalQuality}
                              </span>
                            </div>
                          );
                        })()}

                        <div className="flex items-center gap-2 pt-1 border-t border-slate-800/80">
                          <button
                            onClick={() => handleAgentInstantCollect(cust)}
                            className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold py-1.5 rounded-lg text-xs transition flex items-center justify-center gap-1"
                          >
                            <DollarSign className="w-3.5 h-3.5" />
                            <span>Collect Cash & Restore</span>
                          </button>
                          <a
                            href={`tel:${cust.phone}`}
                            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs"
                            title="Call customer"
                          >
                            📞
                          </a>
                        </div>
                      </div>
                    ))}

                    {customersWithDues.length === 0 && (
                      <div className="py-12 text-center text-slate-500 text-xs">
                        🎉 All customer dues in this sector are collected!
                      </div>
                    )}
                  </>
                )}

                {/* SUB-VIEW 2: Assigned SLA Tickets */}
                {agentTab === 'tickets' && (
                  <>
                    {agentTickets.map((tkt) => (
                      <div
                        key={tkt.id}
                        className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2"
                      >
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-mono font-bold text-cyan-400">{tkt.ticketNumber}</span>
                          <span className="text-rose-400 font-mono font-bold text-[10px]">
                            {tkt.priority.toUpperCase()} SLA
                          </span>
                        </div>
                        <h5 className="font-bold text-xs text-white">{tkt.title}</h5>
                        <p className="text-[11px] text-slate-400">{tkt.customerAddress}</p>
                        <div className="text-[10px] text-slate-500 font-mono">
                          Customer: {tkt.customerName} ({tkt.customerPhone})
                        </div>

                        <div className="flex items-center gap-2 pt-2 border-t border-slate-800">
                          <button
                            onClick={() => alert(`Starting GPS navigation to ${tkt.customerAddress}`)}
                            className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-200 py-1.5 rounded-lg text-xs font-medium flex items-center justify-center gap-1"
                          >
                            <Navigation className="w-3 h-3 text-cyan-400" />
                            <span>GPS Route</span>
                          </button>
                          <button
                            onClick={() => alert(`Ticket ${tkt.ticketNumber} resolution camera opened. Ready to capture splicer proof.`)}
                            className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-slate-950 py-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1"
                          >
                            <Camera className="w-3 h-3" />
                            <span>Resolve</span>
                          </button>
                        </div>
                      </div>
                    ))}
                    {agentTickets.length === 0 && (
                      <div className="py-12 text-center text-slate-500 text-xs">
                        No pending tickets assigned to this agent.
                      </div>
                    )}
                  </>
                )}

                {/* SUB-VIEW 3: Collections History strictly by this specific agent & Handover to Boss */}
                {agentTab === 'history' && (
                  <div className="space-y-3">
                    {/* Collection Summary Cards strictly for this specific agent */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800 text-left">
                        <span className="text-[10px] text-slate-400 block font-sans">
                          Collected by {currentAgent.name.split(' ')[0]}
                        </span>
                        <div className="text-base font-bold text-emerald-400 font-mono mt-0.5">
                          ${specificAgentTotalCollected.toFixed(2)}
                        </div>
                        <span className="text-[9px] text-slate-500 font-mono">
                          {specificAgentInvoices.length} Paid Receipts
                        </span>
                      </div>

                      <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800 text-left">
                        <span className="text-[10px] text-slate-400 block font-sans">
                          Cash in Hand
                        </span>
                        <div className="text-base font-bold text-cyan-300 font-mono mt-0.5">
                          ${currentAgent.cashInHand.toFixed(2)}
                        </div>
                        <span className="text-[9px] text-slate-500 font-mono">
                          Available to Handover
                        </span>
                      </div>
                    </div>

                    {/* Handover to Boss Action Card */}
                    <div className="bg-slate-950/80 p-3 rounded-xl border border-emerald-800/60 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-white flex items-center gap-1.5">
                          <Building className="w-3.5 h-3.5 text-emerald-400" />
                          Handover Cash to Boss
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          Deposited: ${specificAgentTotalHandedOver.toFixed(2)}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 leading-tight">
                        Deposit collected physical cash with Boss / Accounts desk and generate digital settlement receipt.
                      </p>
                      <button
                        onClick={() => setIsHandoverModalOpen(true)}
                        className="w-full bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold py-2 rounded-lg text-xs flex items-center justify-center gap-1.5 transition shadow-sm"
                      >
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>Handover Cash to Boss (${currentAgent.cashInHand.toFixed(2)})</span>
                      </button>
                    </div>

                    {/* Sub-tab toggle between Collections by this agent vs Handover slips */}
                    <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800 text-[10px] font-medium">
                      <button
                        onClick={() => setHistorySubTab('collections')}
                        className={`flex-1 py-1 rounded transition ${
                          historySubTab === 'collections'
                            ? 'bg-slate-800 text-cyan-300 font-bold'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Collections by {currentAgent.name.split(' ')[0]} ({specificAgentInvoices.length})
                      </button>
                      <button
                        onClick={() => setHistorySubTab('handovers')}
                        className={`flex-1 py-1 rounded transition ${
                          historySubTab === 'handovers'
                            ? 'bg-slate-800 text-emerald-300 font-bold'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Boss Handovers ({specificAgentHandovers.length})
                      </button>
                    </div>

                    {/* View A: Invoices strictly collected by THIS agent */}
                    {historySubTab === 'collections' && (
                      <div className="space-y-2">
                        {specificAgentInvoices.map((inv) => (
                          <div
                            key={inv.id}
                            className="bg-slate-950 p-2.5 rounded-lg border border-slate-800 text-xs flex items-center justify-between"
                          >
                            <div>
                              <div className="font-semibold text-slate-200">{inv.customerName}</div>
                              <div className="text-[10px] text-slate-500 font-mono">
                                {inv.receiptNumber || 'RCPT-CASH'} &bull; {inv.packageName}
                              </div>
                            </div>
                            <div className="text-right">
                              <span className="font-mono font-bold text-emerald-400 block">
                                +${inv.totalAmount.toFixed(2)}
                              </span>
                              <span className="text-[9px] text-cyan-400">Paid to {currentAgent.name.split(' ')[0]}</span>
                            </div>
                          </div>
                        ))}

                        {specificAgentInvoices.length === 0 && (
                          <div className="py-8 text-center text-slate-500 text-xs">
                            No cash receipts collected by {currentAgent.name} yet.
                          </div>
                        )}
                      </div>
                    )}

                    {/* View B: Handover slips submitted to boss by THIS agent */}
                    {historySubTab === 'handovers' && (
                      <div className="space-y-2">
                        {specificAgentHandovers.map((h) => (
                          <div
                            key={h.id}
                            className="bg-slate-950 p-2.5 rounded-lg border border-slate-800 text-xs flex items-center justify-between"
                          >
                            <div>
                              <div className="font-semibold text-emerald-300 font-mono">
                                {h.handoverNumber}
                              </div>
                              <div className="text-[10px] text-slate-400">
                                To: {h.receiver}
                              </div>
                              <div className="text-[9px] text-slate-500 font-mono">
                                {new Date(h.timestamp).toLocaleDateString()} at{' '}
                                {new Date(h.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </div>
                            </div>
                            <div className="text-right">
                              <span className="font-mono font-bold text-amber-300 block">
                                -${h.amount.toFixed(2)}
                              </span>
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-400 font-mono">
                                Confirmed
                              </span>
                            </div>
                          </div>
                        ))}

                        {specificAgentHandovers.length === 0 && (
                          <div className="py-8 text-center text-slate-500 text-xs">
                            No cash handovers submitted to boss by {currentAgent.name} yet.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* SUB-VIEW 4: OFFLINE-FIRST ACTIVITY DASHBOARD */}
                {agentTab === 'offline_dashboard' && (
                  <OfflineActivityDashboard
                    currentAgentId={currentAgent.id}
                    onOpenReceiptModal={onOpenReceiptModal}
                  />
                )}
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* SCREEN TYPE B: SUBSCRIBER SELF-SERVICE PORTAL */}
          {/* ======================================================== */}
          {deviceMode === 'client' && (
            <div className="flex-1 flex flex-col overflow-hidden bg-slate-900 text-slate-100">
              {/* Client App Top Bar */}
              <div className="p-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-indigo-400 font-mono uppercase tracking-wider">
                    Youth Net Fiber Home
                  </span>
                  <h3 className="font-bold text-white text-sm">{currentCustomer.name}</h3>
                  <div className="flex items-center gap-1.5 text-[10px] font-mono mt-0.5">
                    <span className="text-slate-400">ONT Signal:</span>
                    <span className="text-emerald-400 font-bold">{currentCustomer.ontSignalDbm} dBm</span>
                  </div>
                </div>

                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase font-bold ${
                    currentCustomer.status === 'active'
                      ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                      : 'bg-amber-950 text-amber-300 border border-amber-800'
                  }`}
                >
                  {currentCustomer.status.replace('_', ' ')}
                </span>
              </div>

              {/* Client Tab Navigation */}
              <div className="grid grid-cols-3 bg-slate-950/80 border-b border-slate-800 text-[11px] font-medium text-center">
                <button
                  onClick={() => setClientTab('home')}
                  className={`py-2 border-b-2 transition ${
                    clientTab === 'home'
                      ? 'border-indigo-500 text-indigo-400 font-bold'
                      : 'border-transparent text-slate-400'
                  }`}
                >
                  Connection
                </button>
                <button
                  onClick={() => setClientTab('bills')}
                  className={`py-2 border-b-2 transition ${
                    clientTab === 'bills'
                      ? 'border-indigo-500 text-indigo-400 font-bold'
                      : 'border-transparent text-slate-400'
                  }`}
                >
                  Bills & Receipts
                </button>
                <button
                  onClick={() => setClientTab('tickets')}
                  className={`py-2 border-b-2 transition ${
                    clientTab === 'tickets'
                      ? 'border-indigo-500 text-indigo-400 font-bold'
                      : 'border-transparent text-slate-400'
                  }`}
                >
                  Complaints ({customerTickets.length})
                </button>
              </div>

              {/* Client Scrollable Area */}
              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {/* SUB-VIEW 1: Live Connection & Speed Meter */}
                {clientTab === 'home' && (
                  <div className="space-y-3">
                    {/* Walled Garden Notice if suspended */}
                    {currentCustomer.status === 'walled_garden' && (
                      <div className="bg-amber-950/80 border border-amber-700/80 p-3 rounded-xl space-y-1">
                        <div className="flex items-center gap-1.5 text-amber-300 font-bold text-xs">
                          <ShieldAlert className="w-4 h-4" />
                          <span>Line Redirected to Payment Portal</span>
                        </div>
                        <p className="text-[11px] text-amber-200/90 leading-tight">
                          Please clear your balance of ${currentCustomer.balanceDue.toFixed(2)} to restore full broadband speeds.
                        </p>
                      </div>
                    )}

                    {/* Speed Meter Dial Graphic */}
                    <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-center space-y-2">
                      <span className="text-[10px] text-slate-400 uppercase tracking-wider font-mono">
                        Live Optical Line Meter
                      </span>
                      <div className="relative flex items-center justify-center my-2">
                        <div className="w-32 h-32 rounded-full border-4 border-slate-800 border-t-cyan-400 border-r-indigo-500 flex flex-col items-center justify-center">
                          <span className="text-2xl font-bold font-mono text-white">48.2</span>
                          <span className="text-[10px] text-slate-400 font-mono">Mbps Download</span>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs font-mono pt-2 border-t border-slate-800/80">
                        <div className="bg-slate-900 p-2 rounded">
                          <span className="text-[10px] text-slate-400 block">Download</span>
                          <span className="text-emerald-400 font-bold flex items-center justify-center gap-1">
                            <ArrowDown className="w-3 h-3" /> 48.2 Mbps
                          </span>
                        </div>
                        <div className="bg-slate-900 p-2 rounded">
                          <span className="text-[10px] text-slate-400 block">Upload</span>
                          <span className="text-cyan-400 font-bold flex items-center justify-center gap-1">
                            <ArrowUp className="w-3 h-3" /> 47.9 Mbps
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Subscription & Account Details */}
                    <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-2 text-xs font-mono">
                      <div className="flex justify-between">
                        <span className="text-slate-400">Account ID:</span>
                        <span className="text-slate-200">{currentCustomer.accountNumber}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Assigned IP:</span>
                        <span className="text-cyan-400">{currentCustomer.assignedIp}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Fiber Node:</span>
                        <span className="text-slate-300">{currentCustomer.areaNode}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Outstanding Due:</span>
                        <span className="text-rose-400 font-bold">
                          ${currentCustomer.balanceDue.toFixed(2)}
                        </span>
                      </div>
                    </div>

                    {/* Live VSOL OLT Optical Telemetry Card */}
                    {(() => {
                      const customerOnu = onus.find(
                        (o) => o.customerId === currentCustomer.id || o.pppoeUsername === currentCustomer.pppoeUsername
                      );
                      if (!customerOnu) return null;
                      const clr = getSignalColorClass(customerOnu.opticalQuality);

                      return (
                        <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-2.5 text-xs font-mono">
                          <div className="flex items-center justify-between">
                            <span className="text-white font-bold flex items-center gap-1.5">
                              <Radio className="w-3.5 h-3.5 text-cyan-400" />
                              <span>VSOL OLT Optical Signal</span>
                            </span>
                            <span className={`text-[9px] px-2 py-0.5 rounded font-bold uppercase border ${clr.badge}`}>
                              {customerOnu.opticalQuality}
                            </span>
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-[11px]">
                            <div className="bg-slate-900 p-2 rounded">
                              <span className="text-slate-400 text-[10px] block">Rx Optical Power</span>
                              <span className={`font-bold text-sm ${clr.text}`}>
                                {customerOnu.rxPowerDbm.toFixed(1)} dBm
                              </span>
                            </div>
                            <div className="bg-slate-900 p-2 rounded">
                              <span className="text-slate-400 text-[10px] block">Tx Output Power</span>
                              <span className="font-bold text-sm text-cyan-300">
                                +{customerOnu.txPowerDbm.toFixed(1)} dBm
                              </span>
                            </div>
                          </div>

                          {/* Optical Power Gauge */}
                          <div className="space-y-1">
                            <div className="flex justify-between text-[10px] text-slate-400">
                              <span>Signal Quality: {clr.label}</span>
                              <span>{customerOnu.distanceMeters}m from OLT</span>
                            </div>
                            <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${
                                  customerOnu.opticalQuality === 'good'
                                    ? 'bg-emerald-400'
                                    : customerOnu.opticalQuality === 'warning'
                                    ? 'bg-amber-400'
                                    : 'bg-rose-500'
                                }`}
                                style={{
                                  width: `${Math.min(100, Math.max(10, ((customerOnu.rxPowerDbm + 35) / 25) * 100))}%`,
                                }}
                              />
                            </div>
                          </div>

                          <div className="text-[10px] text-slate-500 flex justify-between pt-1 border-t border-slate-800">
                            <span>PON Port: {customerOnu.ponPort}</span>
                            <span>ONT: {customerOnu.model}</span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* SUB-VIEW 2: Invoices & Receipts */}
                {clientTab === 'bills' && (
                  <div className="space-y-3">
                    {customerInvoices.map((inv) => (
                      <div
                        key={inv.id}
                        className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-2 text-xs"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-200 font-mono">{inv.invoiceNumber}</span>
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded font-mono uppercase font-bold ${
                              inv.status === 'paid'
                                ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                                : 'bg-rose-950 text-rose-300 border border-rose-800'
                            }`}
                          >
                            {inv.status}
                          </span>
                        </div>
                        <div className="flex justify-between text-slate-400 font-mono text-[11px]">
                          <span>Period: {inv.billingMonth}</span>
                          <span>Due: {inv.dueDate}</span>
                        </div>
                        <div className="flex justify-between items-center pt-2 border-t border-slate-800 font-mono">
                          <span className="text-slate-300 text-sm font-bold">
                            ${inv.totalAmount.toFixed(2)}
                          </span>
                          {inv.status === 'paid' ? (
                            <button
                              onClick={() => onOpenReceiptModal(inv)}
                              className="bg-slate-800 hover:bg-slate-700 text-cyan-400 px-2.5 py-1 rounded text-[11px] font-sans transition"
                            >
                              Download Receipt
                            </button>
                          ) : (
                            <button
                              onClick={() => onOpenPaymentModal(inv)}
                              className="bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold px-2.5 py-1 rounded text-[11px] font-sans transition"
                            >
                              Pay Now
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* SUB-VIEW 3: Register Complaint & Status */}
                {clientTab === 'tickets' && (
                  <div className="space-y-3">
                    {ticketSubmittedMsg && (
                      <div className="bg-emerald-950 border border-emerald-800 p-2.5 rounded-lg text-emerald-300 text-xs flex items-center gap-1.5">
                        <CheckCircle className="w-4 h-4" />
                        <span>Ticket lodged successfully! Field SLA dispatched.</span>
                      </div>
                    )}

                    {/* New Complaint Form */}
                    <form
                      onSubmit={handleClientSubmitTicket}
                      className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-2.5 text-xs"
                    >
                      <span className="font-bold text-white block">Log Technical Complaint</span>

                      <div>
                        <label className="text-slate-400 block mb-1">Issue Type</label>
                        <select
                          value={ticketCategory}
                          onChange={(e) => setTicketCategory(e.target.value as any)}
                          className="w-full bg-slate-900 border border-slate-700 text-slate-200 p-2 rounded focus:outline-none"
                        >
                          <option value="fiber_cut">Physical Fiber Cut / Red Light</option>
                          <option value="slow_speed">Slow Browsing / High Ping</option>
                          <option value="no_internet">No Internet Connection</option>
                          <option value="router_issue">Wi-Fi Router / ONT Fault</option>
                          <option value="billing_issue">Billing Inquiries</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-slate-400 block mb-1">Brief Description</label>
                        <input
                          type="text"
                          required
                          placeholder="e.g. ONT red LOS light blinking"
                          value={ticketTitle}
                          onChange={(e) => setTicketTitle(e.target.value)}
                          className="w-full bg-slate-900 border border-slate-700 text-slate-200 p-2 rounded focus:outline-none"
                        />
                      </div>

                      <div className="p-2 bg-slate-900 rounded border border-slate-800 flex items-center justify-between text-slate-400 text-[11px]">
                        <span className="flex items-center gap-1.5">
                          <Camera className="w-3.5 h-3.5 text-cyan-400" />
                          <span>Attach ONT Photo</span>
                        </span>
                        <span className="text-[10px] text-slate-500">Optional</span>
                      </div>

                      <button
                        type="submit"
                        className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 rounded-lg transition text-xs"
                      >
                        Submit Ticket (SLA Guaranteed)
                      </button>
                    </form>

                    {/* Customer existing tickets */}
                    {customerTickets.map((tkt) => (
                      <div
                        key={tkt.id}
                        className="bg-slate-950 p-2.5 rounded-lg border border-slate-800 text-xs space-y-1"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-bold text-cyan-400">{tkt.ticketNumber}</span>
                          <span className="text-emerald-400 font-semibold capitalize">{tkt.status}</span>
                        </div>
                        <div className="font-semibold text-slate-200">{tkt.title}</div>
                        <div className="text-[10px] text-slate-400">
                          Assigned: {tkt.assignedAgentName || 'NOC Queue'}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Phone Bottom Home Bar */}
          <div className="h-6 bg-slate-950 flex items-center justify-center">
            <div className="w-28 h-1 bg-slate-700 rounded-full" />
          </div>
        </div>
      </div>

      {/* Handover Cash to Boss Modal */}
      <HandoverCashModal
        agent={currentAgent}
        isOpen={isHandoverModalOpen}
        onClose={() => setIsHandoverModalOpen(false)}
        onHandoverSuccess={(handoverNum, amount) => {
          setHandoverSuccessBanner(`Handover ${handoverNum} ($${amount.toFixed(2)}) submitted to Boss!`);
          setTimeout(() => setHandoverSuccessBanner(null), 5000);
        }}
      />
    </div>
  );
};
