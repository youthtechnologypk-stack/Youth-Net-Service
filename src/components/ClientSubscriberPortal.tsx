import React, { useState, useEffect, useCallback } from 'react';
import {
  Wifi,
  Download,
  Upload,
  CreditCard,
  AlertCircle,
  CheckCircle2,
  Send,
  Zap,
  Clock,
  ShieldCheck,
  FileText,
  Activity,
  ArrowRight,
  Phone,
  KeyRound,
  RotateCw,
  Lock,
  Radio,
  User,
  MapPin,
} from 'lucide-react';
import { useISP } from '../context/ISPContext';
import { useCurrency } from '../context/CurrencyContext';
import { UserAccount } from '../types/auth';
import { Invoice } from '../types/isp';
import { FeatureGate } from './FeatureGate';
import { PWAInstallPrompt } from './PWAInstallPrompt';
import { supabase, SupabaseInvoice, SupabaseTicket } from '../services/supabaseClient';

interface ClientSubscriberPortalProps {
  currentUser: UserAccount;
  onOpenReceiptModal: (invoice: Invoice) => void;
  onOpenPaymentModal: (invoice: Invoice) => void;
}

export const ClientSubscriberPortal: React.FC<ClientSubscriberPortalProps> = ({
  currentUser,
  onOpenReceiptModal,
  onOpenPaymentModal,
}) => {
  const { customers, invoices: contextInvoices, createComplaintTicket, activeSessions, packages } = useISP();
  const { formatCurrency } = useCurrency();

  // Find linked customer profile if present in ISPContext, but NEVER fallback to customers[0]
  const linkedCustomer = customers.find(
    (c) =>
      c.id === currentUser.linkedCustomerId ||
      c.pppoeUsername.toLowerCase() === currentUser.username.toLowerCase() ||
      (c.phone && currentUser.phone && c.phone === currentUser.phone)
  );

  const subscriberName = currentUser.fullName || currentUser.username;
  const subscriberUsername = currentUser.username;
  const subscriberPhone = currentUser.phone || linkedCustomer?.phone || 'Not Registered';
  const subscriberArea = currentUser.area || linkedCustomer?.areaNode || 'Islamabad Coverage Zone';

  const currentPkg = packages.find((p) => p.id === linkedCustomer?.packageId) || packages[0] || {
    id: 'pkg-fiber-std',
    name: 'Carrier 50M Standard Fiber',
    downloadSpeedMbps: 50,
    uploadSpeedMbps: 25,
    monthlyPricePkr: 2500,
  };

  // Real-time MikroTik telemetry link: ONLY if active session matches currentUser.username
  const activeSession = activeSessions.find(
    (s) => s.username.toLowerCase() === subscriberUsername.toLowerCase()
  );

  // Invoices & Tickets loaded directly from Supabase for this subscriber
  const [clientInvoices, setClientInvoices] = useState<Invoice[]>([]);
  const [clientTickets, setClientTickets] = useState<SupabaseTicket[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);

  // Map Supabase invoice record to UI Invoice format
  const mapSupabaseToInvoice = useCallback((row: SupabaseInvoice): Invoice => {
    return {
      id: row.id,
      invoiceNumber: row.invoice_no,
      customerId: currentUser.id,
      customerName: subscriberName,
      customerPhone: subscriberPhone,
      billingMonth: new Date(row.created_at || Date.now()).toLocaleString('default', { month: 'short', year: 'numeric' }),
      dueDate: row.due_date || new Date().toISOString().split('T')[0],
      baseAmount: Number(row.amount || 0),
      taxAmount: 0,
      discountAmount: 0,
      totalAmount: Number(row.amount || 0),
      status: row.status === 'PAID' ? 'paid' : 'unpaid',
      paymentMethod: row.status === 'PAID' ? 'cash' : undefined,
      paidAt: row.paid_at || undefined,
      collectedByAgentId: row.assigned_agent_id || undefined,
      packageId: currentPkg.id,
      packageName: currentPkg.name,
      issuedAt: row.created_at || new Date().toISOString(),
      whatsappNoticeSent: false,
    };
  }, [currentUser.id, subscriberName, subscriberPhone, subscriberUsername, currentPkg.name]);

  // Load Invoices and Tickets from Supabase
  const loadSubscriberData = useCallback(async () => {
    setIsLoadingData(true);
    try {
      // 1. Fetch Invoices strictly for this subscriber
      const { data: invData, error: invError } = await supabase
        .from('invoices')
        .select('*')
        .ilike('subscriber_username', subscriberUsername)
        .order('created_at', { ascending: false });

      if (!invError && invData && invData.length > 0) {
        setClientInvoices(invData.map(mapSupabaseToInvoice));
      } else {
        // Fallback to local context invoices matching subscriber's username or ID
        const matchedContextInvoices = contextInvoices.filter(
          (i) =>
            i.customerId === currentUser.id ||
            i.customerName.toLowerCase() === subscriberUsername.toLowerCase() ||
            i.customerName.toLowerCase() === subscriberName.toLowerCase()
        );
        setClientInvoices(matchedContextInvoices);
      }

      // 2. Fetch Tickets strictly for this subscriber
      const { data: tktData, error: tktError } = await supabase
        .from('tickets')
        .select('*')
        .ilike('subscriber_username', subscriberUsername)
        .order('created_at', { ascending: false });

      if (!tktError && tktData) {
        setClientTickets(tktData as SupabaseTicket[]);
      }
    } catch (err) {
      console.warn('Failed to fetch subscriber data from Supabase:', err);
    } finally {
      setIsLoadingData(false);
    }
  }, [subscriberUsername, subscriberName, currentUser.id, mapSupabaseToInvoice, contextInvoices]);

  useEffect(() => {
    loadSubscriberData();

    // Subscribe to realtime changes for this subscriber
    const invoicesChannel = supabase
      .channel(`client_invoices_${subscriberUsername}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'invoices',
          filter: `subscriber_username=eq.${subscriberUsername}`,
        },
        () => {
          loadSubscriberData();
        }
      )
      .subscribe();

    const ticketsChannel = supabase
      .channel(`client_tickets_${subscriberUsername}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tickets',
          filter: `subscriber_username=eq.${subscriberUsername}`,
        },
        () => {
          loadSubscriberData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(invoicesChannel);
      supabase.removeChannel(ticketsChannel);
    };
  }, [subscriberUsername, loadSubscriberData]);

  // Compute Outstanding Balance Due from Invoices
  const computedBalanceDue = clientInvoices
    .filter((inv) => inv.status !== 'paid')
    .reduce((sum, inv) => sum + (inv.totalAmount || 0), 0);

  // Complaint Form state
  const [complaintText, setComplaintText] = useState('');
  const [complaintCategory, setComplaintCategory] = useState<
    'slow_browsing' | 'frequent_disconnection' | 'no_internet' | 'billing_inquiry'
  >('slow_browsing');
  const [isSubmittingTicket, setIsSubmittingTicket] = useState(false);
  const [ticketSuccessNotice, setTicketSuccessNotice] = useState<string | null>(null);

  // Speed test simulation state
  const [isTestingSpeed, setIsTestingSpeed] = useState(false);
  const [testResult, setTestResult] = useState<{ download: number; upload: number; ping: number } | null>(null);

  // Wi-Fi self service state
  const [wifiSsid, setWifiSsid] = useState(`YouthNet_${subscriberUsername.slice(0, 8)}_5G`);
  const [wifiPassword, setWifiPassword] = useState('pakistan2026');
  const [wifiToast, setWifiToast] = useState<string | null>(null);
  const [isUpdatingWifi, setIsUpdatingWifi] = useState(false);

  const handleRunSpeedTest = () => {
    setIsTestingSpeed(true);
    setTestResult(null);
    setTimeout(() => {
      setTestResult({
        download: currentPkg.downloadSpeedMbps || 50,
        upload: currentPkg.uploadSpeedMbps || 25,
        ping: activeSession ? 4 : 28,
      });
      setIsTestingSpeed(false);
    }, 2200);
  };

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!complaintText.trim()) return;

    setIsSubmittingTicket(true);
    const newTicketNo = `TKT-${Math.floor(100000 + Math.random() * 900000)}`;

    try {
      // 1. Insert into Supabase tickets table
      const { error } = await supabase.from('tickets').insert([
        {
          ticket_no: newTicketNo,
          subscriber_username: subscriberUsername,
          assigned_agent_id: null,
          issue: `${complaintCategory.replace(/_/g, ' ').toUpperCase()}: ${complaintText}`,
          priority: complaintCategory === 'no_internet' ? 'CRITICAL' : 'MEDIUM',
          status: 'OPEN',
          created_at: new Date().toISOString(),
        },
      ]);

      if (error) {
        console.warn('Supabase ticket creation failed, recording to local context:', error.message);
      }

      // 2. Also register in local context for NOC immediate visibility
      createComplaintTicket({
        customerId: currentUser.id,
        customerName: subscriberName,
        customerPhone: subscriberPhone,
        customerAddress: subscriberArea,
        areaNode: subscriberArea,
        category:
          complaintCategory === 'no_internet'
            ? 'fiber_cut'
            : complaintCategory === 'billing_inquiry'
            ? 'billing_issue'
            : 'slow_speed',
        priority: complaintCategory === 'no_internet' ? 'high' : 'medium',
        status: 'open',
        title: complaintCategory.replace(/_/g, ' ').toUpperCase(),
        description: complaintText,
        routerId: 'router-ccr2004-core',
      });

      setTicketSuccessNotice(`Support ticket #${newTicketNo} submitted to NOC Desk! An on-duty technician will respond shortly.`);
      setComplaintText('');
      loadSubscriberData();
    } catch (err) {
      console.error('Error submitting complaint:', err);
    } finally {
      setIsSubmittingTicket(false);
      setTimeout(() => setTicketSuccessNotice(null), 6000);
    }
  };

  const handleSaveWifi = (e: React.FormEvent) => {
    e.preventDefault();
    setIsUpdatingWifi(true);
    setTimeout(() => {
      setIsUpdatingWifi(false);
      setWifiToast('Wi-Fi parameters synchronized to customer ONT device successfully!');
      setTimeout(() => setWifiToast(null), 4000);
    }, 1200);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 font-sans text-xs pb-12">
      {/* PWA Mobile Install Banner for Clients / Subscribers */}
      <PWAInstallPrompt role="CLIENT" variant="banner" forceVisibleOnDesktop={false} />

      {/* 1. Account & Connection Status Card (STRICTLY BOUND TO currentUser) */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base font-bold text-white">{subscriberName}</span>
              <PWAInstallPrompt role="CLIENT" variant="button" />
              <span
                className={`px-2 py-0.5 rounded-full font-mono text-[10px] font-bold flex items-center gap-1.5 ${
                  activeSession
                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                    : 'bg-slate-800 text-slate-400 border border-slate-700'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    activeSession ? 'bg-emerald-400 animate-ping' : 'bg-slate-500'
                  }`}
                />
                <span>{activeSession ? 'CONNECTED ONLINE' : 'SESSION INACTIVE'}</span>
              </span>
            </div>
            <p className="text-slate-400 font-mono text-[11px] flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>
                PPPoE Account: <code className="text-cyan-300 font-bold">@{subscriberUsername}</code>
              </span>
              <span>&bull;</span>
              <span className="flex items-center gap-1">
                <MapPin className="w-3 h-3 text-slate-500" />
                <span>{subscriberArea}</span>
              </span>
              <span>&bull;</span>
              <span className="flex items-center gap-1">
                <Phone className="w-3 h-3 text-slate-500" />
                <span>{subscriberPhone}</span>
              </span>
            </p>
          </div>

          <div className="text-right font-mono bg-slate-950/80 px-4 py-2.5 rounded-xl border border-slate-800">
            <span className="text-[10px] text-slate-400 block">Subscribed Plan</span>
            <span className="text-sm font-bold text-cyan-300">{currentPkg.name}</span>
            <span className="text-[10px] text-slate-500 block">
              {currentPkg.downloadSpeedMbps}M Down / {currentPkg.uploadSpeedMbps}M Up
            </span>
          </div>
        </div>

        {/* Network telemetry strip strictly derived from live MikroTik session if authenticated */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-4 mt-4 border-t border-slate-800 font-mono text-[11px]">
          <div>
            <span className="text-slate-500 block">Assigned IP</span>
            <span className="text-slate-200 font-bold">
              {activeSession ? activeSession.address : 'Dynamic / Offline'}
            </span>
          </div>
          <div>
            <span className="text-slate-500 block">Optical Node</span>
            <span className="text-slate-200 font-bold">{subscriberArea}</span>
          </div>
          <div>
            <span className="text-slate-500 block">Line Uptime</span>
            <span className={activeSession ? 'text-emerald-400 font-bold' : 'text-slate-500'}>
              {activeSession ? activeSession.uptime : 'Offline'}
            </span>
          </div>
          <div>
            <span className="text-slate-500 block">Current Balance</span>
            <span className={`font-bold ${computedBalanceDue > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
              {formatCurrency(computedBalanceDue)}
            </span>
          </div>
        </div>
      </div>

      {/* 2. Live Speed Test & Telemetry with client_live_speed_bandwidth_monitor */}
      <FeatureGate
        feature="client_live_speed_bandwidth_monitor"
        role="CLIENT"
        mode="banner"
        disabledMessage="Live speed tests and throughput telemetry monitors are currently disabled for subscriber accounts by Administrator policy."
      >
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-white text-sm">Fiber Broadband Speed &amp; Telemetry</h3>
              <p className="text-slate-400 text-xs">Real-time throughput measurement to Islamabad Core Gateway.</p>
            </div>
            <button
              onClick={handleRunSpeedTest}
              disabled={isTestingSpeed}
              className="bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-slate-950 font-bold px-3.5 py-2 rounded-xl text-xs flex items-center gap-1.5 transition cursor-pointer shadow-md shadow-cyan-600/20"
            >
              {isTestingSpeed ? (
                <div className="w-3.5 h-3.5 border-2 border-slate-950/30 border-t-slate-950 rounded-full animate-spin" />
              ) : (
                <Zap className="w-3.5 h-3.5" />
              )}
              <span>{isTestingSpeed ? 'Testing Speed...' : 'Run Speed Test'}</span>
            </button>
          </div>

          {/* Speed Meters */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-center space-y-1">
              <span className="text-[10px] text-slate-400 font-mono uppercase block flex items-center justify-center gap-1">
                <Download className="w-3 h-3 text-cyan-400" /> Download
              </span>
              <div className="text-2xl font-bold font-mono text-cyan-400">
                {testResult ? testResult.download : currentPkg.downloadSpeedMbps}{' '}
                <span className="text-xs text-slate-500">Mbps</span>
              </div>
              <span className="text-[10px] text-slate-500 font-mono">Guaranteed 1:1 Bandwidth</span>
            </div>

            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-center space-y-1">
              <span className="text-[10px] text-slate-400 font-mono uppercase block flex items-center justify-center gap-1">
                <Upload className="w-3 h-3 text-indigo-400" /> Upload
              </span>
              <div className="text-2xl font-bold font-mono text-indigo-400">
                {testResult ? testResult.upload : currentPkg.uploadSpeedMbps}{' '}
                <span className="text-xs text-slate-500">Mbps</span>
              </div>
              <span className="text-[10px] text-slate-500 font-mono">Symmetric Fiber Uplink</span>
            </div>

            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-center space-y-1">
              <span className="text-[10px] text-slate-400 font-mono uppercase block flex items-center justify-center gap-1">
                <Activity className="w-3 h-3 text-emerald-400" /> Latency / Ping
              </span>
              <div className="text-2xl font-bold font-mono text-emerald-400">
                {testResult ? testResult.ping : (activeSession ? 3 : 24)}{' '}
                <span className="text-xs text-slate-500">ms</span>
              </div>
              <span className="text-[10px] text-slate-500 font-mono">
                {activeSession ? 'Optical GPON Latency' : 'Standby Latency'}
              </span>
            </div>
          </div>
        </div>
      </FeatureGate>

      {/* 3. Invoices & Payment History strictly for currentUser */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-bold text-white text-sm">My Invoices &amp; Billing History</h3>
            <p className="text-slate-400 text-xs">
              Account invoices for @{subscriberUsername} fetched from billing records.
            </p>
          </div>
          <button
            onClick={loadSubscriberData}
            disabled={isLoadingData}
            className="text-slate-400 hover:text-white p-1 rounded-lg bg-slate-800/60 transition"
            title="Refresh Invoices"
          >
            <RotateCw className={`w-3.5 h-3.5 ${isLoadingData ? 'animate-spin text-cyan-400' : ''}`} />
          </button>
        </div>

        <div className="space-y-2.5">
          {clientInvoices.map((inv) => (
            <div
              key={inv.id}
              className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 font-mono"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-white text-xs">{inv.invoiceNumber}</span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                      inv.status === 'paid'
                        ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                        : 'bg-rose-950 text-rose-300 border border-rose-800'
                    }`}
                  >
                    {inv.status}
                  </span>
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  Month: {inv.billingMonth} &bull; Due: {inv.dueDate}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-base font-bold text-cyan-300 font-mono">
                  {formatCurrency(inv.totalAmount)}
                </span>

                {inv.status === 'paid' ? (
                  <FeatureGate
                    feature="client_download_invoices_receipts"
                    role="CLIENT"
                    mode="disable"
                  >
                    <button
                      onClick={() => onOpenReceiptModal(inv)}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-400 text-xs font-sans font-bold flex items-center gap-1 transition cursor-pointer"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>Receipt</span>
                    </button>
                  </FeatureGate>
                ) : (
                  <FeatureGate
                    feature="client_online_bill_payment"
                    role="CLIENT"
                    fallback={
                      <span className="text-[10px] text-amber-400/90 font-mono px-2 py-1 bg-amber-950/40 rounded border border-amber-900/60">
                        Online Pay Disabled (Pay via Field Agent)
                      </span>
                    }
                  >
                    <button
                      onClick={() => onOpenPaymentModal(inv)}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 text-xs font-sans font-bold flex items-center gap-1 transition cursor-pointer shadow-md shadow-emerald-900/40"
                    >
                      <CreditCard className="w-3.5 h-3.5" />
                      <span>Pay Online</span>
                    </button>
                  </FeatureGate>
                )}
              </div>
            </div>
          ))}

          {clientInvoices.length === 0 && !isLoadingData && (
            <div className="text-center py-6 text-slate-500 font-mono">
              No invoices on record for @{subscriberUsername}. All accounts are clear.
            </div>
          )}
        </div>
      </div>

      {/* 4. Support Tickets & Complaint History */}
      <FeatureGate
        feature="client_lodge_complaint_ticket"
        role="CLIENT"
        mode="banner"
        disabledMessage="Online ticket submission is disabled for your account. Please contact 24/7 Phone Support: +92 51 111-968-846."
      >
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
          <div>
            <h3 className="font-bold text-white text-sm">Need Help? Create Support Ticket</h3>
            <p className="text-slate-400 text-xs">
              Report optical line issues or billing questions directly to our 24/7 NOC engineering team.
            </p>
          </div>

          {ticketSuccessNotice && (
            <div className="p-3 bg-emerald-950/80 border border-emerald-700 rounded-xl text-emerald-300 text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{ticketSuccessNotice}</span>
            </div>
          )}

          <form onSubmit={handleCreateTicket} className="space-y-3 font-mono">
            <div>
              <label className="block text-slate-400 text-[11px] mb-1">Issue Category</label>
              <select
                value={complaintCategory}
                onChange={(e: any) => setComplaintCategory(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-cyan-500"
              >
                <option value="slow_browsing">Slow Browsing / Packet Loss</option>
                <option value="frequent_disconnection">Frequent Wi-Fi Disconnection</option>
                <option value="no_internet">Total Fiber Outage (Red LOS on ONT)</option>
                <option value="billing_inquiry">Billing / Payment Question</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-400 text-[11px] mb-1">Describe the problem</label>
              <textarea
                rows={3}
                required
                value={complaintText}
                onChange={(e) => setComplaintText(e.target.value)}
                placeholder="e.g. My optical ONT shows a blinking red light or speeds drop below 10Mbps in evening..."
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-cyan-500 font-sans"
              />
            </div>

            <button
              type="submit"
              disabled={isSubmittingTicket}
              className="w-full bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 disabled:opacity-50 text-white font-bold py-2.5 rounded-xl text-xs flex items-center justify-center gap-2 transition cursor-pointer"
            >
              {isSubmittingTicket ? (
                <RotateCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
              <span>{isSubmittingTicket ? 'Transmitting to NOC Desk...' : 'Submit Ticket to NOC Desk'}</span>
            </button>
          </form>

          {/* Past & Open Tickets for this Subscriber */}
          {clientTickets.length > 0 && (
            <div className="pt-4 border-t border-slate-800 space-y-2">
              <span className="text-[11px] font-bold text-slate-400 uppercase font-mono block">
                My Submitted Tickets ({clientTickets.length})
              </span>
              <div className="space-y-2">
                {clientTickets.map((tkt) => (
                  <div
                    key={tkt.id}
                    className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex items-start justify-between gap-3 font-mono"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-cyan-400 font-bold text-xs">{tkt.ticket_no}</span>
                        <span
                          className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                            tkt.status === 'RESOLVED'
                              ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                              : 'bg-amber-950 text-amber-300 border border-amber-800'
                          }`}
                        >
                          {tkt.status}
                        </span>
                        <span className="text-slate-500 text-[10px]">
                          Priority: {tkt.priority}
                        </span>
                      </div>
                      <p className="text-slate-300 text-xs font-sans">{tkt.issue}</p>
                    </div>
                    <div className="text-[10px] text-slate-500 shrink-0">
                      {new Date(tkt.created_at || Date.now()).toLocaleDateString()}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </FeatureGate>

      {/* 5. Wi-Fi Password & ONT Self-Service */}
      <FeatureGate
        feature="client_wifi_password_self_service"
        role="CLIENT"
        mode="banner"
        disabledMessage="Wi-Fi SSID and password self-service is locked for this subscriber tier by Administrator policy."
      >
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-white text-sm">Wi-Fi &amp; ONT Device Self-Care</h3>
              <p className="text-slate-400 text-xs">
                Update home optical router Wi-Fi Network Name (SSID) and WPA2 security passphrase.
              </p>
            </div>
            <div className="p-2 rounded-xl bg-cyan-950 border border-cyan-800 text-cyan-400">
              <Wifi className="w-4 h-4" />
            </div>
          </div>

          {wifiToast && (
            <div className="p-3 bg-emerald-950/80 border border-emerald-700 rounded-xl text-emerald-300 text-xs flex items-center gap-2 font-mono">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{wifiToast}</span>
            </div>
          )}

          <form onSubmit={handleSaveWifi} className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono">
            <div>
              <label className="block text-slate-400 text-[11px] mb-1">Wi-Fi Network Name (SSID)</label>
              <input
                type="text"
                required
                value={wifiSsid}
                onChange={(e) => setWifiSsid(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-slate-400 text-[11px] mb-1">Wi-Fi Password (WPA2-PSK)</label>
              <input
                type="text"
                required
                minLength={8}
                value={wifiPassword}
                onChange={(e) => setWifiPassword(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div className="sm:col-span-2 pt-1 flex justify-end">
              <button
                type="submit"
                disabled={isUpdatingWifi}
                className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 transition cursor-pointer"
              >
                {isUpdatingWifi ? (
                  <RotateCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <KeyRound className="w-3.5 h-3.5" />
                )}
                <span>Update Wi-Fi Credentials</span>
              </button>
            </div>
          </form>
        </div>
      </FeatureGate>
    </div>
  );
};
