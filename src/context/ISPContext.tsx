import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import {
  Customer,
  InternetPackage,
  MikrotikRouter,
  ActiveSession,
  Invoice,
  ComplaintTicket,
  FieldAgent,
  CashHandover,
  AgentSalaryTransaction,
  AreaOutage,
  IspExpense,
  WhatsAppNotificationLog,
  CustomerStatus,
} from '../types/isp';
import { VsolOlt, OnuDevice } from '../types/olt';
import {
  INITIAL_PACKAGES,
  INITIAL_ROUTERS,
  INITIAL_CUSTOMERS,
  INITIAL_ACTIVE_SESSIONS,
  INITIAL_INVOICES,
  INITIAL_COMPLAINTS,
  INITIAL_AGENTS,
  INITIAL_OUTAGES,
  INITIAL_EXPENSES,
  INITIAL_WHATSAPP_LOGS,
} from '../data/initialData';
import { INITIAL_OLTS, INITIAL_ONUS } from '../data/initialOlts';
import { classifyOpticalSignal } from '../services/oltUtils';
import { MikrotikRouterOSv7Service } from '../services/mikrotikRouterOSv7';
import { BillingCronEngine } from '../services/cronBillingEngine';

interface BandwidthDataPoint {
  time: string;
  rxMbps: number;
  txMbps: number;
}

interface ISPContextType {
  routers: MikrotikRouter[];
  packages: InternetPackage[];
  customers: Customer[];
  activeSessions: ActiveSession[];
  invoices: Invoice[];
  complaints: ComplaintTicket[];
  agents: FieldAgent[];
  outages: AreaOutage[];
  expenses: IspExpense[];
  whatsAppLogs: WhatsAppNotificationLog[];
  selectedRouterId: string;
  setSelectedRouterId: (id: string) => void;
  bandwidthHistory: BandwidthDataPoint[];
  isTrafficStreaming: boolean;
  setIsTrafficStreaming: (val: boolean) => void;
  lastCronMessage: string | null;
  // MikroTik Actions
  kickSession: (sessionId: string) => Promise<void>;
  provisionPppoeSecret: (newCustomer: Partial<Customer>, initialBalance?: number) => Promise<void>;
  toggleCustomerStatus: (customerId: string, targetStatus: CustomerStatus) => Promise<void>;
  addMikrotikRouter: (
    newRouter: Omit<
      MikrotikRouter,
      'id' | 'cpuLoad' | 'memoryUsageMb' | 'totalMemoryMb' | 'uptime' | 'status' | 'currentWanRxMbps' | 'currentWanTxMbps' | 'activePppoeCount'
    > & Partial<MikrotikRouter>
  ) => Promise<MikrotikRouter>;
  deleteMikrotikRouter: (routerId: string) => void;
  // Billing & Cash Recovery Actions
  cashHandovers: CashHandover[];
  collectAgentCashPayment: (
    invoiceId: string,
    agentId: string,
    amount: number
  ) => Promise<{ receiptNumber: string }>;
  handoverCashToBoss: (
    agentId: string,
    amount: number,
    receiver?: string,
    notes?: string
  ) => Promise<{ handoverNumber: string }>;
  confirmCashHandover: (handoverId: string, confirmedBy?: string) => Promise<void>;
  receiveDirectHandoverFromAgent: (
    agentId: string,
    amount: number,
    receiver?: string,
    notes?: string
  ) => Promise<{ handoverNumber: string }>;
  // Agent Salary & Advances
  salaryTransactions: AgentSalaryTransaction[];
  disburseAdvanceSalary: (
    agentId: string,
    amount: number,
    paymentMethod: 'cash' | 'bank_transfer',
    notes: string
  ) => Promise<{ transactionNumber: string }>;
  recordAdvanceReturn: (
    agentId: string,
    amount: number,
    paymentMethod: 'cash' | 'bank_transfer' | 'salary_deduction',
    notes: string,
    deductFromCashInHand?: boolean
  ) => Promise<{ transactionNumber: string }>;
  payMonthlySalary: (
    agentId: string,
    month: string,
    deductAdvance: boolean,
    paymentMethod: 'cash' | 'bank_transfer',
    notes?: string
  ) => Promise<{ transactionNumber: string; netAmount: number }>;
  updateAgentSalary: (agentId: string, newBaseSalary: number) => void;
  addAgent: (
    agentData: Omit<
      FieldAgent,
      'id' | 'cashInHand' | 'totalCollectedToday' | 'activeTicketsAssigned' | 'advanceSalaryTaken' | 'advanceSalaryReturned'
    > & Partial<FieldAgent>
  ) => FieldAgent;
  updateAgent: (agentId: string, updatedFields: Partial<FieldAgent>) => void;
  deleteAgent: (agentId: string) => void;
  runMonthlyBillingCron: () => Promise<string>;
  runOverdueScanCron: () => Promise<string>;
  createInvoice: (newInvoice: Omit<Invoice, 'id'>) => Invoice;
  updateInvoice: (invoiceId: string, updatedFields: Partial<Invoice>) => void;
  addExpense: (expense: Omit<IspExpense, 'id'>) => void;
  // Complaints & SLA Actions
  createComplaintTicket: (
    ticket: Omit<ComplaintTicket, 'id' | 'ticketNumber' | 'createdAt' | 'slaDeadline' | 'slaTargetHours'>,
    autoAssignNow?: boolean
  ) => ComplaintTicket;
  assignTicketToAgent: (ticketId: string, agentId: string) => void;
  autoAssignTicket: (ticketId: string, reason?: string) => Promise<{ agent: FieldAgent; ticket: ComplaintTicket } | null>;
  run5MinComplaintAutoAssignEngine: (forceAllOpen?: boolean) => Promise<{ assignedCount: number; message: string }>;
  resolveTicket: (ticketId: string, resolutionNotes: string, proofImageUrl?: string) => void;
  broadcastAreaOutage: (areaNode: string, title: string, cause: string, severity: 'minor' | 'major' | 'critical', estimatedHours: number, ponPort?: string) => void;
  updateOutage: (outageId: string, updates: Partial<AreaOutage>, broadcastWhatsApp?: boolean, customMessage?: string) => void;
  resolveOutage: (outageId: string, resolutionNotes?: string, broadcastWhatsApp?: boolean) => void;
  logWhatsAppNotice: (recipientPhone: string, recipientName: string, messageBody: string, templateName?: string) => void;
  // VSOL OLT & Optical Diagnostics
  olts: VsolOlt[];
  onus: OnuDevice[];
  selectedOltId: string;
  setSelectedOltId: (id: string) => void;
  refreshOnuSignal: (onuId: string) => Promise<OnuDevice>;
  rebootOnu: (onuId: string) => Promise<void>;
  addOlt: (olt: Omit<VsolOlt, 'id'>) => void;
  updateOlt: (oltId: string, updated: Partial<VsolOlt>) => void;
  deleteOlt: (oltId: string) => void;
  testOltSnmpConnection: (ipAddress: string, community: string, port: number) => Promise<{ success: boolean; latencyMs: number; sysDescr?: string; message: string }>;
}

const ISPContext = createContext<ISPContextType | undefined>(undefined);

export const ISPProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [routers, setRouters] = useState<MikrotikRouter[]>(INITIAL_ROUTERS);
  const [packages, setPackages] = useState<InternetPackage[]>(INITIAL_PACKAGES);
  const [customers, setCustomers] = useState<Customer[]>(INITIAL_CUSTOMERS);
  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>(INITIAL_ACTIVE_SESSIONS);
  const [invoices, setInvoices] = useState<Invoice[]>(INITIAL_INVOICES);
  const [complaints, setComplaints] = useState<ComplaintTicket[]>(INITIAL_COMPLAINTS);
  const [agents, setAgents] = useState<FieldAgent[]>(INITIAL_AGENTS);
  const [outages, setOutages] = useState<AreaOutage[]>(INITIAL_OUTAGES);
  const [expenses, setExpenses] = useState<IspExpense[]>(INITIAL_EXPENSES);
  const [whatsAppLogs, setWhatsAppLogs] = useState<WhatsAppNotificationLog[]>(INITIAL_WHATSAPP_LOGS);
  const [olts, setOlts] = useState<VsolOlt[]>(INITIAL_OLTS);
  const [onus, setOnus] = useState<OnuDevice[]>(INITIAL_ONUS);
  const [selectedOltId, setSelectedOltId] = useState<string>(INITIAL_OLTS[0]?.id || '');
  const [cashHandovers, setCashHandovers] = useState<CashHandover[]>([
    {
      id: 'ho-1',
      handoverNumber: 'HND-202609-842',
      agentId: 'agent-1',
      agentName: 'Bilal Khan',
      amount: 250,
      receiver: 'Boss / Accounts Desk (Mr. Farhan)',
      notes: 'Evening sector G-11 collections settlement pending verification',
      timestamp: new Date().toISOString(),
      status: 'pending',
    },
    {
      id: 'ho-2',
      handoverNumber: 'HND-202609-819',
      agentId: 'agent-2',
      agentName: 'Tariq Mehmood',
      amount: 320,
      receiver: 'Boss / Accounts Desk (Mr. Farhan)',
      notes: 'Sector I-8 corporate fiber recoveries',
      timestamp: '2026-09-28T18:00:00.000Z',
      status: 'confirmed',
      confirmedBy: 'Boss / Accounts Admin',
      confirmedAt: '2026-09-28T18:30:00.000Z',
    },
  ]);

  const [salaryTransactions, setSalaryTransactions] = useState<AgentSalaryTransaction[]>([
    {
      id: 'stx-1',
      transactionNumber: 'SAL-ADV-202609-101',
      agentId: 'agent-1',
      agentName: 'Bilal Khan',
      type: 'advance_disbursed',
      amount: 150,
      date: '2026-09-10',
      paymentMethod: 'cash',
      notes: 'Advance for motorcycle maintenance and fuel',
      recordedBy: 'Boss / Accounts Admin',
    },
    {
      id: 'stx-2',
      transactionNumber: 'SAL-RET-202609-204',
      agentId: 'agent-1',
      agentName: 'Bilal Khan',
      type: 'advance_returned',
      amount: 50,
      date: '2026-09-20',
      paymentMethod: 'salary_deduction',
      notes: 'Advance return installment from recovery',
      recordedBy: 'Boss / Accounts Admin',
    },
    {
      id: 'stx-3',
      transactionNumber: 'SAL-ADV-202609-105',
      agentId: 'agent-3',
      agentName: 'Hamza Farooq',
      type: 'advance_disbursed',
      amount: 100,
      date: '2026-09-15',
      paymentMethod: 'bank_transfer',
      notes: 'Family emergency advance',
      recordedBy: 'Boss / Accounts Admin',
    },
    {
      id: 'stx-4',
      transactionNumber: 'SAL-RET-202609-209',
      agentId: 'agent-3',
      agentName: 'Hamza Farooq',
      type: 'advance_returned',
      amount: 20,
      date: '2026-09-25',
      paymentMethod: 'cash',
      notes: 'Cash advance partial repayment',
      recordedBy: 'Boss / Accounts Admin',
    },
  ]);
  const [selectedRouterId, setSelectedRouterId] = useState<string>(INITIAL_ROUTERS[0].id);
  const [isTrafficStreaming, setIsTrafficStreaming] = useState<boolean>(true);
  const [lastCronMessage, setLastCronMessage] = useState<string | null>(null);

  // Bandwidth history for real-time live graphs (15 data points)
  const [bandwidthHistory, setBandwidthHistory] = useState<BandwidthDataPoint[]>(() => {
    const initial: BandwidthDataPoint[] = [];
    const now = Date.now();
    for (let i = 14; i >= 0; i--) {
      const d = new Date(now - i * 2000);
      initial.push({
        time: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        rxMbps: Math.floor(750 + Math.random() * 150),
        txMbps: Math.floor(320 + Math.random() * 90),
      });
    }
    return initial;
  });

  const mikrotikService = new MikrotikRouterOSv7Service({
    host: '10.200.0.1',
    username: 'netpulse_noc',
    useSsl: true,
  });

  const billingEngine = new BillingCronEngine(mikrotikService);

  // Periodic real-time traffic streamer (every 2.5 seconds)
  useEffect(() => {
    if (!isTrafficStreaming) return;

    const interval = setInterval(() => {
      const now = new Date();
      const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      // Generate dynamic traffic with natural variance
      const newRx = Math.floor(780 + Math.sin(Date.now() / 8000) * 120 + (Math.random() - 0.5) * 80);
      const newTx = Math.floor(340 + Math.cos(Date.now() / 9000) * 60 + (Math.random() - 0.5) * 40);

      setBandwidthHistory((prev) => [...prev.slice(1), { time: timeStr, rxMbps: newRx, txMbps: newTx }]);

      // Update router current metrics
      setRouters((prev) =>
        prev.map((r) =>
          r.id === selectedRouterId
            ? {
                ...r,
                currentWanRxMbps: newRx,
                currentWanTxMbps: newTx,
                cpuLoad: Math.min(88, Math.max(12, Math.floor(r.cpuLoad + (Math.random() - 0.5) * 4))),
              }
            : r
        )
      );

      // Jitter active session throughput
      setActiveSessions((prev) =>
        prev.map((s) => ({
          ...s,
          rxRateMbps: Math.max(0.1, Number((s.rxRateMbps + (Math.random() - 0.5) * 3).toFixed(1))),
          txRateMbps: Math.max(0.05, Number((s.txRateMbps + (Math.random() - 0.5) * 1.5).toFixed(1))),
        }))
      );
    }, 2500);

    return () => clearInterval(interval);
  }, [isTrafficStreaming, selectedRouterId]);

  // Automated 5-Minute Unassigned Complaint Auto-Escalation Scanner
  useEffect(() => {
    const autoEscalationInterval = setInterval(() => {
      const now = Date.now();

      setComplaints((prevComplaints) => {
        let hasChanges = false;
        const updated = prevComplaints.map((t) => {
          if (!t.assignedAgentId && t.status !== 'resolved' && t.status !== 'closed') {
            const ageMs = now - new Date(t.createdAt).getTime();
            // If complaint is unassigned for 5 minutes (300,000 ms)
            if (ageMs >= 5 * 60 * 1000) {
              const bestAgent = findBestAgentForTicket(t.areaNode);
              if (bestAgent) {
                hasChanges = true;
                const autoAssignedTicket: ComplaintTicket = {
                  ...t,
                  assignedAgentId: bestAgent.id,
                  assignedAgentName: bestAgent.name,
                  status: 'assigned',
                  autoAssigned: true,
                  autoAssignedAt: new Date().toISOString(),
                };

                setAgents((prevAgents) =>
                  prevAgents.map((a) => (a.id === bestAgent.id ? { ...a, activeTicketsAssigned: a.activeTicketsAssigned + 1 } : a))
                );

                dispatchTicketWhatsAppGroupAlert(
                  autoAssignedTicket,
                  bestAgent.name,
                  `Complaint logged ${Math.floor(ageMs / 60000)}m ago without technician assignment (5-Min SLA Policy)`
                );

                return autoAssignedTicket;
              }
            }
          }
          return t;
        });

        return hasChanges ? updated : prevComplaints;
      });
    }, 12000); // Check every 12 seconds

    return () => clearInterval(autoEscalationInterval);
  }, [agents]);

  // Force disconnect / kick PPPoE session
  const kickSession = async (sessionId: string) => {
    const targetSession = activeSessions.find((s) => s.id === sessionId);
    if (!targetSession) return;

    await mikrotikService.killActiveSession(sessionId);

    // Remove from active sessions list
    setActiveSessions((prev) => prev.filter((s) => s.id !== sessionId));

    // After 4 seconds, PPPoE client auto-reconnects (realistic network behavior)
    setTimeout(() => {
      setActiveSessions((prev) => [
        ...prev,
        {
          ...targetSession,
          id: `*${Math.floor(100 + Math.random() * 900).toString(16).toUpperCase()}`,
          uptime: '0d 00h 01m',
          bytesInMb: 1,
          bytesOutMb: 1,
        },
      ]);
    }, 4000);
  };

  // Provision new customer & PPPoE Secret
  const provisionPppoeSecret = async (
    newCustomer: Partial<Customer>,
    initialBalance: number = 0
  ) => {
    const targetPkg = packages.find((p) => p.id === newCustomer.packageId) || packages[0];
    const username = newCustomer.pppoeUsername || `user_${Date.now().toString().slice(-4)}`;

    await mikrotikService.createPppoeSecret({
      name: username,
      password: newCustomer.pppoePassword || 'pass1234',
      profile: targetPkg.mikrotikProfile,
      remoteAddress: newCustomer.assignedIp,
      comment: `NETPULSE_PROVISIONED_${new Date().toISOString()}`,
    });

    const basePrice = targetPkg.priceMonthly;
    const taxRate = 0.16;
    const taxAmount = Math.round(basePrice * taxRate);
    const totalAmount = basePrice + taxAmount;
    const now = new Date();
    const billingMonthName = now.toLocaleString('default', { month: 'long', year: 'numeric' });
    const dueDate = new Date(now.getFullYear(), now.getMonth(), 10).toISOString().split('T')[0];
    const accountNum = `NP-CUST-${Math.floor(1100 + Math.random() * 8000)}`;
    const invoiceNum = `INV-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-${accountNum.slice(-4)}`;

    const createdCust: Customer = {
      id: `cust-${Date.now()}`,
      accountNumber: accountNum,
      name: newCustomer.name || 'New Subscriber',
      phone: newCustomer.phone || '+923000000000',
      email: newCustomer.email || '',
      address: newCustomer.address || 'Standard Address',
      areaNode: newCustomer.areaNode || 'Sector G-11 (North Zone)',
      connectionType: 'pppoe',
      pppoeUsername: username,
      assignedIp: newCustomer.assignedIp || `10.50.${Math.floor(Math.random() * 50)}.${Math.floor(Math.random() * 240 + 10)}`,
      macAddress: newCustomer.macAddress || '44:D9:E7:88:AA:11',
      packageId: targetPkg.id,
      routerId: selectedRouterId,
      status: 'active',
      installationDate: now.toISOString().split('T')[0],
      billingDay: 1,
      balanceDue: totalAmount,
      ontSignalDbm: -19.2,
    };

    setCustomers((prev) => [createdCust, ...prev]);

    // Automatically generate initial monthly invoice for the new client
    const newAutoInvoice: Invoice = {
      id: `inv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      invoiceNumber: invoiceNum,
      customerId: createdCust.id,
      customerName: createdCust.name,
      customerPhone: createdCust.phone,
      packageId: targetPkg.id,
      packageName: targetPkg.name,
      billingMonth: billingMonthName,
      baseAmount: basePrice,
      taxAmount,
      discountAmount: 0,
      totalAmount,
      status: 'unpaid',
      dueDate,
      issuedAt: now.toISOString(),
      whatsappNoticeSent: true,
      whatsappNoticeTimestamp: now.toISOString(),
    };

    setInvoices((prev) => [newAutoInvoice, ...prev]);

    // Auto-generate welcome & initial billing WhatsApp log
    const welcomeWaMsg =
      `🔔 *YOUTH NET SERVICE - WELCOME & INITIAL INVOICE*\n\n` +
      `Dear *${createdCust.name}*,\n` +
      `Welcome to *Youth Net Service*! Your high-speed fiber broadband connection has been provisioned.\n\n` +
      `🆔 *Account ID:* ${createdCust.accountNumber}\n` +
      `🌐 *PPPoE User:* ${createdCust.pppoeUsername}\n` +
      `📄 *Invoice #:* ${invoiceNum}\n` +
      `🚀 *Subscribed Plan:* ${targetPkg.name}\n` +
      `💰 *Total Amount Due:* $${totalAmount.toFixed(2)}\n` +
      `📅 *Due Date:* ${dueDate}\n\n` +
      `Pay online or hand over cash to our assigned Area Field Agent. Thank you for choosing Youth Net Service!`;

    setWhatsAppLogs((prev) => [
      {
        id: `wa-welcome-${Date.now()}`,
        recipientPhone: createdCust.phone,
        recipientName: createdCust.name,
        type: 'invoice_generated',
        templateName: 'youth_net_welcome_invoice',
        messageBody: welcomeWaMsg,
        status: 'delivered',
        timestamp: now.toISOString(),
      },
      ...prev,
    ]);

    // Add into active sessions
    setActiveSessions((prev) => [
      {
        id: `*NEW_${Math.floor(Math.random() * 900)}`,
        username: createdCust.pppoeUsername,
        callerId: createdCust.macAddress,
        address: createdCust.assignedIp,
        service: 'pppoe',
        uptime: '0d 00h 02m',
        rxRateMbps: 12.4,
        txRateMbps: 2.1,
        bytesInMb: 12,
        bytesOutMb: 4,
        routerId: selectedRouterId,
        customerName: createdCust.name,
        profileName: targetPkg.mikrotikProfile,
      },
      ...prev,
    ]);
  };

  // Toggle Customer Status (Active <-> Walled Garden <-> Disabled)
  const toggleCustomerStatus = async (customerId: string, targetStatus: CustomerStatus) => {
    const cust = customers.find((c) => c.id === customerId);
    if (!cust) return;

    if (targetStatus === 'walled_garden') {
      await mikrotikService.assignWalledGarden(cust.pppoeUsername, 'Walled_Garden_Pool');
      // Drop session so reconnect takes walled garden IP
      await mikrotikService.killActiveSessionByUsername(cust.pppoeUsername);
    } else if (targetStatus === 'active') {
      const pkg = packages.find((p) => p.id === cust.packageId);
      await mikrotikService.restoreActiveProfile(cust.pppoeUsername, pkg?.mikrotikProfile || '50M_Turbo_Profile');
    } else if (targetStatus === 'disabled') {
      await mikrotikService.setPppoeSecretDisabled(cust.pppoeUsername, true);
      await mikrotikService.killActiveSessionByUsername(cust.pppoeUsername);
    }

    setCustomers((prev) =>
      prev.map((c) => (c.id === customerId ? { ...c, status: targetStatus } : c))
    );
  };

  // Add new MikroTik Router / Device
  const addMikrotikRouter = async (
    routerData: Omit<
      MikrotikRouter,
      'id' | 'cpuLoad' | 'memoryUsageMb' | 'totalMemoryMb' | 'uptime' | 'status' | 'currentWanRxMbps' | 'currentWanTxMbps' | 'activePppoeCount'
    > & Partial<MikrotikRouter>
  ): Promise<MikrotikRouter> => {
    const newId = `rt-${Date.now()}`;
    const cleanIp = routerData.ipAddress.trim();
    const ipParts = cleanIp.split('.');
    const ipPrefix = ipParts.length === 4 ? `${ipParts[0]}.${ipParts[1]}.${ipParts[2]}` : '10.200.2';

    const fullRouter: MikrotikRouter = {
      id: newId,
      name: routerData.name.trim(),
      model: routerData.model || 'MikroTik CCR2004-16G-2S+',
      ipAddress: cleanIp,
      apiPort: routerData.apiPort || (routerData.useSsl ? 8729 : 8728),
      username: routerData.username?.trim() || 'netpulse_noc',
      useSsl: routerData.useSsl ?? true,
      version: routerData.version || 'RouterOS v7.16.2',
      location: routerData.location?.trim() || 'Central Distribution Node',
      cpuLoad: Math.floor(12 + Math.random() * 14),
      memoryUsageMb: 840,
      totalMemoryMb: 4096,
      uptime: '0d 01h 15m',
      status: 'online',
      wanInterface: routerData.wanInterface?.trim() || 'sfp-sfpplus1',
      currentWanRxMbps: Math.floor(320 + Math.random() * 250),
      currentWanTxMbps: Math.floor(110 + Math.random() * 120),
      activePppoeCount: 2,
      walledGardenPool: routerData.walledGardenPool?.trim() || '172.16.102.0/24',
    };

    setRouters((prev) => [...prev, fullRouter]);
    setSelectedRouterId(newId);

    // Seed active sessions on the new router so telemetry and sessions reflect the new hardware
    setActiveSessions((prev) => [
      {
        id: `*NEW_${Date.now()}_1`,
        username: `client_${fullRouter.name.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 10)}_01`,
        callerId: 'BC:24:11:89:FE:E1',
        address: `${ipPrefix}.101`,
        service: 'pppoe',
        uptime: '0d 01h 10m',
        rxRateMbps: 38.4,
        txRateMbps: 11.2,
        bytesInMb: 420,
        bytesOutMb: 110,
        routerId: newId,
        customerName: 'Fiber User - ' + fullRouter.name,
        profileName: '50M_Turbo_Profile',
      },
      {
        id: `*NEW_${Date.now()}_2`,
        username: `client_${fullRouter.name.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 10)}_02`,
        callerId: 'BC:24:11:89:FE:E2',
        address: `${ipPrefix}.102`,
        service: 'pppoe',
        uptime: '0d 01h 05m',
        rxRateMbps: 76.8,
        txRateMbps: 22.4,
        bytesInMb: 890,
        bytesOutMb: 240,
        routerId: newId,
        customerName: 'Enterprise Fiber - ' + fullRouter.name,
        profileName: '100M_Gigabit_Profile',
      },
      ...prev,
    ]);

    // Notification Log
    setWhatsAppLogs((prev) => [
      {
        id: `wa-rt-${Date.now()}`,
        recipientPhone: '+923001234567',
        recipientName: 'NOC Lead Engineer',
        type: 'ticket_update',
        templateName: 'isp_new_router_added',
        messageBody: `🌐 *NEW MIKROTIK BNG ROUTER CONNECTED*:\nRouter: *${fullRouter.name}*\nModel: ${fullRouter.model}\nIP: ${fullRouter.ipAddress}:${fullRouter.apiPort}\nStatus: ONLINE (RouterOS v7.16 REST API Handshake Verified)\nDeployed at: ${fullRouter.location}`,
        status: 'delivered',
        timestamp: new Date().toISOString(),
      },
      ...prev,
    ]);

    return fullRouter;
  };

  const deleteMikrotikRouter = (routerId: string) => {
    setRouters((prev) => {
      const remaining = prev.filter((r) => r.id !== routerId);
      if (selectedRouterId === routerId && remaining.length > 0) {
        setSelectedRouterId(remaining[0].id);
      }
      return remaining;
    });
  };

  // Agent Cash Recovery Collection
  const collectAgentCashPayment = async (
    invoiceId: string,
    agentId: string,
    amount: number
  ) => {
    const targetInvoice = invoices.find((inv) => inv.id === invoiceId);
    const targetAgent = agents.find((a) => a.id === agentId);
    if (!targetInvoice || !targetAgent) {
      throw new Error('Invoice or Agent not found');
    }

    const receiptNum = `RCPT-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`;

    // Update invoice
    setInvoices((prev) =>
      prev.map((inv) =>
        inv.id === invoiceId
          ? {
              ...inv,
              status: 'paid',
              paidAt: new Date().toISOString(),
              collectedByAgentId: agentId,
              agentName: targetAgent.name,
              receiptNumber: receiptNum,
            }
          : inv
      )
    );

    // Update agent cash in hand and daily total
    setAgents((prev) =>
      prev.map((a) =>
        a.id === agentId
          ? {
              ...a,
              cashInHand: a.cashInHand + amount,
              totalCollectedToday: a.totalCollectedToday + amount,
            }
          : a
      )
    );

    // Restore customer balance and status if previously walled-garden
    const cust = customers.find((c) => c.id === targetInvoice.customerId);
    if (cust) {
      setCustomers((prev) =>
        prev.map((c) =>
          c.id === cust.id
            ? {
                ...c,
                balanceDue: Math.max(0, c.balanceDue - amount),
                status: c.status === 'walled_garden' ? 'active' : c.status,
                lastPaymentDate: new Date().toISOString().split('T')[0],
              }
            : c
        )
      );

      // Restore high-speed profile on MikroTik
      if (cust.status === 'walled_garden') {
        const pkg = packages.find((p) => p.id === cust.packageId);
        await mikrotikService.restoreActiveProfile(cust.pppoeUsername, pkg?.mikrotikProfile || '50M_Turbo_Profile');
      }

      // Generate WhatsApp Payment Confirmation Log
      const receiptMsg = billingEngine.buildWhatsAppPaymentReceipt(
        cust.name,
        receiptNum,
        targetInvoice.invoiceNumber,
        amount,
        targetAgent.name
      );

      setWhatsAppLogs((prev) => [
        {
          id: `wa-rcpt-${Date.now()}`,
          recipientPhone: cust.phone,
          recipientName: cust.name,
          type: 'payment_receipt',
          templateName: 'isp_payment_confirmation_receipt',
          messageBody: receiptMsg,
          status: 'delivered',
          timestamp: new Date().toISOString(),
        },
        ...prev,
      ]);
    }

    return { receiptNumber: receiptNum };
  };

  // Field Agent handover cash to boss / accounts manager
  const handoverCashToBoss = async (
    agentId: string,
    amount: number,
    receiver: string = 'Boss / Accounts Desk',
    notes: string = 'Field cash collection handover'
  ): Promise<{ handoverNumber: string }> => {
    const targetAgent = agents.find((a) => a.id === agentId);
    if (!targetAgent) throw new Error('Agent not found');

    const now = new Date();
    const handoverNum = `HND-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-${Math.floor(100 + Math.random() * 900)}`;

    // Deduct cash from agent's cashInHand
    setAgents((prev) =>
      prev.map((a) =>
        a.id === agentId
          ? {
              ...a,
              cashInHand: Math.max(0, a.cashInHand - amount),
            }
          : a
      )
    );

    const newHandover: CashHandover = {
      id: `ho-${Date.now()}`,
      handoverNumber: handoverNum,
      agentId,
      agentName: targetAgent.name,
      amount,
      receiver,
      notes,
      timestamp: now.toISOString(),
      status: 'pending',
    };

    setCashHandovers((prev) => [newHandover, ...prev]);

    // Send WhatsApp settlement submission alert
    const remainingCash = Math.max(0, targetAgent.cashInHand - amount);
    const handoverWaMsg =
      `💼 *YOUTH NET SERVICE - CASH HANDOVER SUBMITTED*\n\n` +
      `Agent *${targetAgent.name}* has submitted cash handover awaiting Boss confirmation:\n\n` +
      `💵 *Amount Handed Over:* $${amount.toFixed(2)}\n` +
      `👔 *Receiver Desk:* ${receiver}\n` +
      `💼 *Remaining Cash in Hand:* $${remainingCash.toFixed(2)}\n` +
      `🧾 *Settlement Ref:* ${handoverNum}\n` +
      `🕒 *Timestamp:* ${now.toLocaleTimeString()} on ${now.toLocaleDateString()}\n` +
      `📝 *Notes:* ${notes}\n\n` +
      `_Status: Awaiting Boss / Accounts Desk Acceptance Verification._`;

    setWhatsAppLogs((prev) => [
      {
        id: `wa-ho-${Date.now()}`,
        recipientPhone: targetAgent.phone,
        recipientName: `${targetAgent.name} (Copy to Boss)`,
        type: 'payment_receipt',
        templateName: 'youth_net_cash_handover_boss',
        messageBody: handoverWaMsg,
        status: 'delivered',
        timestamp: now.toISOString(),
      },
      ...prev,
    ]);

    return { handoverNumber: handoverNum };
  };

  // Boss confirms cash handover received from recovery agent
  const confirmCashHandover = async (handoverId: string, confirmedBy: string = 'Boss / Accounts Admin') => {
    const now = new Date().toISOString();
    let targetHandover: CashHandover | undefined;

    setCashHandovers((prev) =>
      prev.map((h) => {
        if (h.id === handoverId) {
          targetHandover = { ...h, status: 'confirmed', confirmedBy, confirmedAt: now };
          return targetHandover;
        }
        return h;
      })
    );

    if (targetHandover) {
      const targetAgent = agents.find((a) => a.id === targetHandover!.agentId);
      const msg =
        `✅ *YOUTH NET SERVICE - CASH HANDOVER CONFIRMED*\n\n` +
        `Dear *${targetHandover.agentName}*,\n` +
        `The Boss / Accounts Desk has officially verified and accepted your cash handover.\n\n` +
        `🧾 *Settlement Ref:* ${targetHandover.handoverNumber}\n` +
        `💵 *Amount Confirmed:* $${targetHandover.amount.toFixed(2)}\n` +
        `👮 *Confirmed By:* ${confirmedBy}\n` +
        `🕒 *Timestamp:* ${new Date().toLocaleTimeString()} on ${new Date().toLocaleDateString()}\n\n` +
        `_The recovery cash has been officially deposited into the Youth Net Service Vault._`;

      setWhatsAppLogs((prev) => [
        {
          id: `wa-conf-${Date.now()}`,
          recipientPhone: targetAgent?.phone || '+92 300 0000000',
          recipientName: `${targetHandover!.agentName}`,
          type: 'payment_receipt',
          templateName: 'youth_net_handover_confirmed',
          messageBody: msg,
          status: 'delivered',
          timestamp: now,
        },
        ...prev,
      ]);
    }
  };

  // Boss directly receives cash handover from agent in admin panel
  const receiveDirectHandoverFromAgent = async (
    agentId: string,
    amount: number,
    receiver: string = 'Boss / Accounts Desk',
    notes: string = 'Direct counter cash handover'
  ): Promise<{ handoverNumber: string }> => {
    const targetAgent = agents.find((a) => a.id === agentId);
    if (!targetAgent) throw new Error('Agent not found');

    const now = new Date();
    const handoverNum = `HND-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-${Math.floor(100 + Math.random() * 900)}`;

    setAgents((prev) =>
      prev.map((a) =>
        a.id === agentId
          ? {
              ...a,
              cashInHand: Math.max(0, a.cashInHand - amount),
            }
          : a
      )
    );

    const newHandover: CashHandover = {
      id: `ho-${Date.now()}`,
      handoverNumber: handoverNum,
      agentId,
      agentName: targetAgent.name,
      amount,
      receiver,
      notes,
      timestamp: now.toISOString(),
      status: 'confirmed',
      confirmedBy: 'Boss / Accounts Admin',
      confirmedAt: now.toISOString(),
    };

    setCashHandovers((prev) => [newHandover, ...prev]);

    const remainingCash = Math.max(0, targetAgent.cashInHand - amount);
    const handoverWaMsg =
      `💼 *YOUTH NET SERVICE - CASH RECEIVED & CONFIRMED*\n\n` +
      `Boss has directly accepted and verified recovery cash deposit from Agent *${targetAgent.name}*.\n\n` +
      `🧾 *Settlement Ref:* ${handoverNum}\n` +
      `💵 *Amount Received:* $${amount.toFixed(2)}\n` +
      `💼 *Remaining Cash in Hand:* $${remainingCash.toFixed(2)}\n` +
      `🕒 *Timestamp:* ${now.toLocaleTimeString()} on ${now.toLocaleDateString()}\n` +
      `📝 *Notes:* ${notes}\n\n` +
      `_Cash safely locked in Youth Net Service office vault._`;

    setWhatsAppLogs((prev) => [
      {
        id: `wa-ho-${Date.now()}`,
        recipientPhone: targetAgent.phone,
        recipientName: `${targetAgent.name}`,
        type: 'payment_receipt',
        templateName: 'youth_net_cash_direct_received',
        messageBody: handoverWaMsg,
        status: 'delivered',
        timestamp: now.toISOString(),
      },
      ...prev,
    ]);

    return { handoverNumber: handoverNum };
  };

  // Disburse Advance Salary to Field Agent
  const disburseAdvanceSalary = async (
    agentId: string,
    amount: number,
    paymentMethod: 'cash' | 'bank_transfer',
    notes: string
  ): Promise<{ transactionNumber: string }> => {
    const targetAgent = agents.find((a) => a.id === agentId);
    if (!targetAgent) throw new Error('Agent not found');

    const now = new Date();
    const txNum = `SAL-ADV-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-${Math.floor(100 + Math.random() * 900)}`;

    setAgents((prev) =>
      prev.map((a) =>
        a.id === agentId
          ? {
              ...a,
              advanceSalaryTaken: a.advanceSalaryTaken + amount,
            }
          : a
      )
    );

    const newTx: AgentSalaryTransaction = {
      id: `stx-${Date.now()}`,
      transactionNumber: txNum,
      agentId,
      agentName: targetAgent.name,
      type: 'advance_disbursed',
      amount,
      date: now.toISOString().split('T')[0],
      paymentMethod,
      notes,
      recordedBy: 'Boss / Accounts Admin',
    };

    setSalaryTransactions((prev) => [newTx, ...prev]);

    // Record as ISP expense
    addExpense({
      title: `Salary Advance Disbursed: ${targetAgent.name}`,
      category: 'staff_salaries',
      amount,
      paidTo: targetAgent.name,
      date: now.toISOString().split('T')[0],
      paymentMode: paymentMethod === 'cash' ? 'cash' : 'bank_transfer',
      receiptReference: txNum,
      notes: `Advance salary: ${notes}`,
    });

    const outstanding = targetAgent.advanceSalaryTaken + amount - targetAgent.advanceSalaryReturned;
    const waMsg =
      `💸 *YOUTH NET SERVICE - ADVANCE SALARY DISBURSED*\n\n` +
      `Dear *${targetAgent.name}*,\n` +
      `Your advance salary request has been approved and disbursed.\n\n` +
      `🧾 *Ref #:* ${txNum}\n` +
      `💵 *Advance Amount:* $${amount.toFixed(2)}\n` +
      `💳 *Method:* ${paymentMethod.toUpperCase()}\n` +
      `💼 *Total Outstanding Advance Balance:* $${outstanding.toFixed(2)}\n` +
      `📅 *Date:* ${now.toISOString().split('T')[0]}\n` +
      `📝 *Notes:* ${notes}\n\n` +
      `_This will be adjusted against your monthly salary settlement._`;

    setWhatsAppLogs((prev) => [
      {
        id: `wa-sal-adv-${Date.now()}`,
        recipientPhone: targetAgent.phone,
        recipientName: targetAgent.name,
        type: 'payment_receipt',
        templateName: 'youth_net_advance_disbursed',
        messageBody: waMsg,
        status: 'delivered',
        timestamp: now.toISOString(),
      },
      ...prev,
    ]);

    return { transactionNumber: txNum };
  };

  // Record Advance Salary Return / Repayment
  const recordAdvanceReturn = async (
    agentId: string,
    amount: number,
    paymentMethod: 'cash' | 'bank_transfer' | 'salary_deduction',
    notes: string,
    deductFromCashInHand: boolean = false
  ): Promise<{ transactionNumber: string }> => {
    const targetAgent = agents.find((a) => a.id === agentId);
    if (!targetAgent) throw new Error('Agent not found');

    const now = new Date();
    const txNum = `SAL-RET-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-${Math.floor(100 + Math.random() * 900)}`;

    setAgents((prev) =>
      prev.map((a) =>
        a.id === agentId
          ? {
              ...a,
              advanceSalaryReturned: a.advanceSalaryReturned + amount,
              cashInHand: deductFromCashInHand ? Math.max(0, a.cashInHand - amount) : a.cashInHand,
            }
          : a
      )
    );

    const newTx: AgentSalaryTransaction = {
      id: `stx-${Date.now()}`,
      transactionNumber: txNum,
      agentId,
      agentName: targetAgent.name,
      type: 'advance_returned',
      amount,
      date: now.toISOString().split('T')[0],
      paymentMethod,
      notes,
      recordedBy: 'Boss / Accounts Admin',
    };

    setSalaryTransactions((prev) => [newTx, ...prev]);

    const remainingAdvance = Math.max(0, targetAgent.advanceSalaryTaken - (targetAgent.advanceSalaryReturned + amount));
    const waMsg =
      `↩️ *YOUTH NET SERVICE - ADVANCE SALARY REPAYMENT*\n\n` +
      `Dear *${targetAgent.name}*,\n` +
      `We have successfully received your advance salary return.\n\n` +
      `🧾 *Ref #:* ${txNum}\n` +
      `💵 *Amount Returned:* $${amount.toFixed(2)}\n` +
      `💳 *Method:* ${paymentMethod.replace('_', ' ').toUpperCase()}\n` +
      `💼 *Remaining Outstanding Advance:* $${remainingAdvance.toFixed(2)}\n` +
      `📅 *Date:* ${now.toISOString().split('T')[0]}\n` +
      `📝 *Notes:* ${notes}\n\n` +
      `_Official Youth Net Accounts Entry._`;

    setWhatsAppLogs((prev) => [
      {
        id: `wa-sal-ret-${Date.now()}`,
        recipientPhone: targetAgent.phone,
        recipientName: targetAgent.name,
        type: 'payment_receipt',
        templateName: 'youth_net_advance_returned',
        messageBody: waMsg,
        status: 'delivered',
        timestamp: now.toISOString(),
      },
      ...prev,
    ]);

    return { transactionNumber: txNum };
  };

  // Pay Monthly Salary with Advance Settlement
  const payMonthlySalary = async (
    agentId: string,
    month: string,
    deductAdvance: boolean,
    paymentMethod: 'cash' | 'bank_transfer',
    notes: string = 'Monthly field recovery agent salary payout'
  ): Promise<{ transactionNumber: string; netAmount: number }> => {
    const targetAgent = agents.find((a) => a.id === agentId);
    if (!targetAgent) throw new Error('Agent not found');

    const outstandingAdvance = Math.max(0, targetAgent.advanceSalaryTaken - targetAgent.advanceSalaryReturned);
    const deduction = deductAdvance ? outstandingAdvance : 0;
    const netAmount = Math.max(0, targetAgent.baseSalary - deduction);

    const now = new Date();
    const txNum = `SAL-PAY-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-${Math.floor(100 + Math.random() * 900)}`;

    setAgents((prev) =>
      prev.map((a) =>
        a.id === agentId
          ? {
              ...a,
              advanceSalaryTaken: deductAdvance ? 0 : a.advanceSalaryTaken,
              advanceSalaryReturned: deductAdvance ? 0 : a.advanceSalaryReturned,
            }
          : a
      )
    );

    const newTx: AgentSalaryTransaction = {
      id: `stx-${Date.now()}`,
      transactionNumber: txNum,
      agentId,
      agentName: targetAgent.name,
      type: 'salary_paid',
      amount: netAmount,
      date: now.toISOString().split('T')[0],
      paymentMethod,
      notes: `${notes} (Base: $${targetAgent.baseSalary.toFixed(2)}, Advance Deducted: $${deduction.toFixed(2)}) for ${month}`,
      recordedBy: 'Boss / Accounts Admin',
    };

    setSalaryTransactions((prev) => [newTx, ...prev]);

    // Record in ISP Expenses
    addExpense({
      title: `Salary Disbursed: ${targetAgent.name} (${month})`,
      category: 'staff_salaries',
      amount: netAmount,
      paidTo: targetAgent.name,
      date: now.toISOString().split('T')[0],
      paymentMode: paymentMethod === 'cash' ? 'cash' : 'bank_transfer',
      receiptReference: txNum,
      notes: `Net Salary for ${month}. Gross: $${targetAgent.baseSalary.toFixed(2)}, Advance Deducted: $${deduction.toFixed(2)}`,
    });

    const waMsg =
      `💰 *YOUTH NET SERVICE - MONTHLY SALARY PAY-SLIP*\n\n` +
      `Dear *${targetAgent.name}*,\n` +
      `Your monthly salary for *${month}* has been disbursed!\n\n` +
      `🧾 *Pay-Slip Ref:* ${txNum}\n` +
      `💼 *Base Monthly Salary:* $${targetAgent.baseSalary.toFixed(2)}\n` +
      `➖ *Advance Deducted:* $${deduction.toFixed(2)}\n` +
      `💵 *Net Disbursed Amount:* $${netAmount.toFixed(2)}\n` +
      `💳 *Disbursement Mode:* ${paymentMethod.toUpperCase()}\n` +
      `📅 *Date:* ${now.toISOString().split('T')[0]}\n\n` +
      `_Thank you for your dedicated service with Youth Net Service!_`;

    setWhatsAppLogs((prev) => [
      {
        id: `wa-sal-pay-${Date.now()}`,
        recipientPhone: targetAgent.phone,
        recipientName: targetAgent.name,
        type: 'payment_receipt',
        templateName: 'youth_net_salary_payslip',
        messageBody: waMsg,
        status: 'delivered',
        timestamp: now.toISOString(),
      },
      ...prev,
    ]);

    return { transactionNumber: txNum, netAmount };
  };

  // Update Agent Base Salary
  const updateAgentSalary = (agentId: string, newBaseSalary: number) => {
    setAgents((prev) =>
      prev.map((a) =>
        a.id === agentId ? { ...a, baseSalary: Math.max(0, newBaseSalary) } : a
      )
    );
  };

  // Add New Field Recovery Agent
  const addAgent = (
    agentData: Omit<
      FieldAgent,
      'id' | 'cashInHand' | 'totalCollectedToday' | 'activeTicketsAssigned' | 'advanceSalaryTaken' | 'advanceSalaryReturned'
    > & Partial<FieldAgent>
  ): FieldAgent => {
    const newId = `agent-${Date.now()}`;
    const newAgent: FieldAgent = {
      id: newId,
      name: agentData.name.trim(),
      phone: agentData.phone.trim(),
      email: agentData.email?.trim() || `${agentData.name.toLowerCase().replace(/[^a-z0-9]/g, '.')}@netpulse.io`,
      assignedArea: agentData.assignedArea.trim(),
      status: agentData.status || 'active',
      cashInHand: agentData.cashInHand ?? 0,
      totalCollectedToday: agentData.totalCollectedToday ?? 0,
      activeTicketsAssigned: agentData.activeTicketsAssigned ?? 0,
      baseSalary: agentData.baseSalary ?? 600,
      advanceSalaryTaken: agentData.advanceSalaryTaken ?? 0,
      advanceSalaryReturned: agentData.advanceSalaryReturned ?? 0,
    };

    setAgents((prev) => [...prev, newAgent]);

    // Send Onboarding WhatsApp Notification Log
    setWhatsAppLogs((prev) => [
      {
        id: `wa-agent-onboard-${Date.now()}`,
        recipientPhone: newAgent.phone,
        recipientName: newAgent.name,
        type: 'ticket_update',
        templateName: 'agent_onboarding_welcome',
        messageBody: `👋 *WELCOME TO YOUTH NET SERVICE FIELD TEAM*\n\nDear *${newAgent.name}*,\nYou have been enrolled as an official Field Recovery & Area Support Agent.\n\n📍 *Assigned Sector:* ${newAgent.assignedArea}\n💼 *Monthly Base Salary:* $${newAgent.baseSalary.toFixed(2)}\n📱 *Mobile Terminal Access:* Active\n\nLogin to the Youth Net Field Agent Mobile App to collect subscriber payments, record cash receipts, and manage fiber tickets.`,
        status: 'delivered',
        timestamp: new Date().toISOString(),
      },
      ...prev,
    ]);

    return newAgent;
  };

  // Update Existing Agent Details
  const updateAgent = (agentId: string, updatedFields: Partial<FieldAgent>) => {
    setAgents((prev) =>
      prev.map((a) => (a.id === agentId ? { ...a, ...updatedFields } : a))
    );
  };

  // Delete / Offboard Agent
  const deleteAgent = (agentId: string) => {
    setAgents((prev) => prev.filter((a) => a.id !== agentId));
  };

  // Run Automated Monthly Billing CRON Job
  const runMonthlyBillingCron = async (): Promise<string> => {
    const { summary, generatedInvoices, notificationLogs } = await billingEngine.runMonthlyInvoiceGeneration(
      customers,
      packages
    );

    setInvoices((prev) => [...generatedInvoices, ...prev]);
    setWhatsAppLogs((prev) => [...notificationLogs, ...prev]);

    // Update customer balances
    setCustomers((prev) =>
      prev.map((c) => {
        const matchingNewInv = generatedInvoices.find((inv) => inv.customerId === c.id);
        if (matchingNewInv) {
          return { ...c, balanceDue: c.balanceDue + matchingNewInv.totalAmount };
        }
        return c;
      })
    );

    const msg = `Billing CRON Completed: Generated ${summary.invoicesGenerated} invoices ($${summary.totalBilledAmount.toFixed(2)}) & sent ${summary.whatsAppAlertsDispatched} WhatsApp statements.`;
    setLastCronMessage(msg);
    return msg;
  };

  // Run Overdue Scanner & MikroTik Isolation CRON Job
  const runOverdueScanCron = async (): Promise<string> => {
    const { summary, updatedCustomers, updatedInvoices, notificationLogs } = await billingEngine.runOverdueIsolationCheck(
      customers,
      invoices,
      1 // 1 day grace for quick demo test
    );

    setCustomers(updatedCustomers);
    setInvoices(updatedInvoices);
    setWhatsAppLogs((prev) => [...notificationLogs, ...prev]);

    const msg = `Overdue Scanner Completed: Scanned ${summary.customersScanned} subscribers. Isolated ${summary.isolatedToWalledGarden} past-due accounts to Walled-Garden and sent WhatsApp suspension alerts.`;
    setLastCronMessage(msg);
    return msg;
  };

  // Create new manual or ad-hoc invoice
  const createInvoice = (newInvoiceData: Omit<Invoice, 'id'>): Invoice => {
    const newInv: Invoice = {
      ...newInvoiceData,
      id: `inv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    };

    setInvoices((prev) => [newInv, ...prev]);

    // Update customer's balance due if invoice is unpaid or overdue
    if (newInv.status !== 'paid') {
      setCustomers((prev) =>
        prev.map((c) =>
          c.id === newInv.customerId
            ? { ...c, balanceDue: c.balanceDue + newInv.totalAmount }
            : c
        )
      );
    }

    // If WhatsApp statement notice is enabled, queue a log
    if (newInv.whatsappNoticeSent) {
      const waMsg =
        `🔔 *YOUTH NET SERVICE - NEW INVOICE STATEMENT*\n\n` +
        `Dear *${newInv.customerName}*,\n` +
        `A new invoice has been generated for your broadband account.\n\n` +
        `📄 *Invoice #:* ${newInv.invoiceNumber}\n` +
        `🚀 *Service Plan:* ${newInv.packageName}\n` +
        `💰 *Payable Total:* $${newInv.totalAmount.toFixed(2)}\n` +
        `📅 *Due Date:* ${newInv.dueDate}\n` +
        `🕒 *Billing Period:* ${newInv.billingMonth}\n\n` +
        `Pay online or hand over cash to our assigned Area Field Agent. Thank you for choosing Youth Net Service!`;

      setWhatsAppLogs((prev) => [
        {
          id: `wa-inv-${Date.now()}`,
          recipientPhone: newInv.customerPhone,
          recipientName: newInv.customerName,
          type: 'invoice_generated',
          templateName: 'youth_net_new_invoice_statement',
          messageBody: waMsg,
          status: 'delivered',
          timestamp: new Date().toISOString(),
        },
        ...prev,
      ]);
    }

    return newInv;
  };

  // Edit and update invoice
  const updateInvoice = (invoiceId: string, updatedFields: Partial<Invoice>) => {
    setInvoices((prev) =>
      prev.map((inv) => {
        if (inv.id === invoiceId) {
          const updated = { ...inv, ...updatedFields };
          if (
            updatedFields.baseAmount !== undefined ||
            updatedFields.taxAmount !== undefined ||
            updatedFields.discountAmount !== undefined
          ) {
            const base = updatedFields.baseAmount !== undefined ? Number(updatedFields.baseAmount) : inv.baseAmount;
            const tax = updatedFields.taxAmount !== undefined ? Number(updatedFields.taxAmount) : inv.taxAmount;
            const discount = updatedFields.discountAmount !== undefined ? Number(updatedFields.discountAmount) : inv.discountAmount;
            updated.totalAmount = Math.max(0, base + tax - discount);
          }
          return updated;
        }
        return inv;
      })
    );

    // If invoice is marked paid or amount changed, reconcile customer balance
    if (updatedFields.status === 'paid') {
      const target = invoices.find((i) => i.id === invoiceId);
      if (target) {
        setCustomers((prev) =>
          prev.map((c) =>
            c.id === target.customerId
              ? {
                  ...c,
                  balanceDue: Math.max(0, c.balanceDue - (updatedFields.totalAmount || target.totalAmount)),
                  status: c.status === 'walled_garden' ? 'active' : c.status,
                }
              : c
          )
        );
      }
    }
  };

  // Add Expense
  const addExpense = (expense: Omit<IspExpense, 'id'>) => {
    const newExp: IspExpense = {
      ...expense,
      id: `exp-${Date.now()}`,
    };
    setExpenses((prev) => [newExp, ...prev]);
  };

  // Complaints & SLA actions
  const createComplaintTicket = (
    ticket: Omit<ComplaintTicket, 'id' | 'ticketNumber' | 'createdAt' | 'slaDeadline' | 'slaTargetHours'>,
    autoAssignNow?: boolean
  ): ComplaintTicket => {
    const slaTarget = ticket.category === 'fiber_cut' ? 2 : ticket.category === 'no_internet' ? 3 : 4;
    const now = new Date();
    const deadline = new Date(now.getTime() + slaTarget * 60 * 60 * 1000);

    let assignedAgentId = ticket.assignedAgentId;
    let assignedAgentName = ticket.assignedAgentName;
    let status = ticket.status || 'open';
    let wasAutoAssigned = false;

    // If auto-assign was requested immediately at creation time
    if (autoAssignNow && !assignedAgentId) {
      const best = findBestAgentForTicket(ticket.areaNode);
      if (best) {
        assignedAgentId = best.id;
        assignedAgentName = best.name;
        status = 'assigned';
        wasAutoAssigned = true;
      }
    }

    const newTkt: ComplaintTicket = {
      ...ticket,
      id: `tkt-${Date.now()}`,
      ticketNumber: `TKT-${Math.floor(4900 + Math.random() * 5000)}`,
      createdAt: now.toISOString(),
      slaTargetHours: slaTarget,
      slaDeadline: deadline.toISOString(),
      assignedAgentId,
      assignedAgentName,
      status,
      autoAssigned: wasAutoAssigned,
      autoAssignedAt: wasAutoAssigned ? now.toISOString() : undefined,
    };

    setComplaints((prev) => [newTkt, ...prev]);

    if (wasAutoAssigned && assignedAgentId) {
      setAgents((prev) =>
        prev.map((a) => (a.id === assignedAgentId ? { ...a, activeTicketsAssigned: a.activeTicketsAssigned + 1 } : a))
      );

      // Send Instant WhatsApp Alert
      dispatchTicketWhatsAppGroupAlert(newTkt, assignedAgentName || 'Field Agent', 'Instant Auto-Assignment on Ticket Creation');
    } else if (assignedAgentId) {
      setAgents((prev) =>
        prev.map((a) => (a.id === assignedAgentId ? { ...a, activeTicketsAssigned: a.activeTicketsAssigned + 1 } : a))
      );
    }

    return newTkt;
  };

  // Helper to select best matching agent
  const findBestAgentForTicket = (areaNode: string): FieldAgent | null => {
    if (!agents.length) return null;

    const cleanArea = areaNode.toLowerCase();
    // 1. Try matching area sector keyword
    const areaKeywords = ['g-11', 'g11', 'i-8', 'i8', 'f-10', 'f10', 'f-11', 'f11', 'e-11', 'e11', 'bahria', 'blue area'];
    const matchedKeyword = areaKeywords.find((kw) => cleanArea.includes(kw));

    if (matchedKeyword) {
      const sectorAgents = agents.filter((a) =>
        a.assignedArea.toLowerCase().includes(matchedKeyword)
      );
      if (sectorAgents.length > 0) {
        // Pick least loaded from sector
        return sectorAgents.sort((a, b) => a.activeTicketsAssigned - b.activeTicketsAssigned)[0];
      }
    }

    // 2. Pick least loaded on-duty agent
    const activeAgents = agents.filter((a) => a.status === 'on_field' || a.status === 'active');
    if (activeAgents.length > 0) {
      return activeAgents.sort((a, b) => a.activeTicketsAssigned - b.activeTicketsAssigned)[0];
    }

    return agents[0];
  };

  // Helper to dispatch WhatsApp Group Escalation Message
  const dispatchTicketWhatsAppGroupAlert = (
    ticket: ComplaintTicket,
    agentName: string,
    reason: string
  ) => {
    const groupAlertBody =
      `🚨 *YOUTH NET SLA ESCALATION: COMPLAINT AUTO-ASSIGNED* 🚨\n\n` +
      `📢 *NOC Field Ops WhatsApp Group Broadcast*\n` +
      `----------------------------------------\n` +
      `🎫 *Ticket:* *${ticket.ticketNumber}*\n` +
      `⚡ *Priority:* ${ticket.priority.toUpperCase()} | *Category:* ${ticket.category.replace('_', ' ')}\n` +
      `⚠️ *Reason:* ${reason}\n\n` +
      `👤 *Subscriber:* ${ticket.customerName} (${ticket.customerPhone})\n` +
      `📍 *Node / Sector:* ${ticket.areaNode}\n` +
      `🏠 *Physical Address:* ${ticket.customerAddress}\n` +
      `📝 *Complaint Subject:* ${ticket.title}\n` +
      `📋 *Technical Details:* ${ticket.description}\n\n` +
      `🛵 *AUTO-ASSIGNED FIELD TECHNICIAN:* *${agentName}*\n` +
      `⏱️ *Resolution SLA Target:* ${ticket.slaTargetHours} Hours\n` +
      `📅 *Logged At:* ${new Date(ticket.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}\n\n` +
      `_⚠️ Required Action: @${agentName} please acknowledge in WhatsApp group immediately and proceed to subscriber premises._`;

    setWhatsAppLogs((prev) => [
      {
        id: `wa-group-sla-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`,
        recipientPhone: '+92 300 0000000',
        recipientName: 'Youth Net NOC Field Ops WhatsApp Group',
        type: 'ticket_update',
        templateName: 'complaint_5min_auto_assign_group_alert',
        messageBody: groupAlertBody,
        status: 'delivered',
        timestamp: new Date().toISOString(),
      },
      ...prev,
    ]);
  };

  const assignTicketToAgent = (ticketId: string, agentId: string) => {
    const agent = agents.find((a) => a.id === agentId);
    if (!agent) return;

    let targetTicket: ComplaintTicket | undefined;

    setComplaints((prev) =>
      prev.map((t) => {
        if (t.id === ticketId) {
          targetTicket = {
            ...t,
            assignedAgentId: agentId,
            assignedAgentName: agent.name,
            status: 'assigned',
          };
          return targetTicket;
        }
        return t;
      })
    );

    setAgents((prev) =>
      prev.map((a) => (a.id === agentId ? { ...a, activeTicketsAssigned: a.activeTicketsAssigned + 1 } : a))
    );

    // Send direct assignment WhatsApp alert to agent
    if (targetTicket) {
      setWhatsAppLogs((prev) => [
        {
          id: `wa-tkt-direct-${Date.now()}`,
          recipientPhone: agent.phone,
          recipientName: agent.name,
          type: 'ticket_update',
          templateName: 'complaint_manual_technician_dispatch',
          messageBody: `📋 *NEW COMPLAINT ASSIGNED TO YOU*\n\nDear *${agent.name}*,\nTicket *${targetTicket?.ticketNumber}* has been manually assigned to you by NOC.\n\n👤 *Subscriber:* ${targetTicket?.customerName} (${targetTicket?.customerPhone})\n📍 *Node:* ${targetTicket?.areaNode}\n📝 *Fault:* ${targetTicket?.title}\n⏱️ *SLA Target:* ${targetTicket?.slaTargetHours} Hours\n\nPlease open your Field Agent App to navigate and resolve.`,
          status: 'delivered',
          timestamp: new Date().toISOString(),
        },
        ...prev,
      ]);
    }
  };

  // Auto-Assign a specific ticket (e.g. on 5-min SLA timeout or explicit 1-click)
  const autoAssignTicket = async (
    ticketId: string,
    reason?: string
  ): Promise<{ agent: FieldAgent; ticket: ComplaintTicket } | null> => {
    const targetTicket = complaints.find((t) => t.id === ticketId);
    if (!targetTicket) return null;

    const bestAgent = findBestAgentForTicket(targetTicket.areaNode);
    if (!bestAgent) return null;

    const nowIso = new Date().toISOString();
    const updatedTicket: ComplaintTicket = {
      ...targetTicket,
      assignedAgentId: bestAgent.id,
      assignedAgentName: bestAgent.name,
      status: 'assigned',
      autoAssigned: true,
      autoAssignedAt: nowIso,
    };

    setComplaints((prev) =>
      prev.map((t) => (t.id === ticketId ? updatedTicket : t))
    );

    setAgents((prev) =>
      prev.map((a) => (a.id === bestAgent.id ? { ...a, activeTicketsAssigned: a.activeTicketsAssigned + 1 } : a))
    );

    // Send the WhatsApp Group Broadcast!
    dispatchTicketWhatsAppGroupAlert(
      updatedTicket,
      bestAgent.name,
      reason || 'Complaint remained unassigned for >5 minutes with no technician specified'
    );

    return { agent: bestAgent, ticket: updatedTicket };
  };

  // Run 5-Minute Auto-Assignment Engine
  const run5MinComplaintAutoAssignEngine = async (
    forceAllOpen = false
  ): Promise<{ assignedCount: number; message: string }> => {
    const nowTime = Date.now();
    const unassignedTickets = complaints.filter(
      (t) => !t.assignedAgentId && t.status !== 'resolved' && t.status !== 'closed'
    );

    let assignedCount = 0;

    for (const tkt of unassignedTickets) {
      const elapsedMs = nowTime - new Date(tkt.createdAt).getTime();
      const isPast5Min = elapsedMs >= 5 * 60 * 1000;

      if (forceAllOpen || isPast5Min) {
        await autoAssignTicket(
          tkt.id,
          isPast5Min
            ? `Complaint logged ${Math.floor(elapsedMs / 60000)}m ago without technician assignment (5-Min SLA Policy)`
            : 'Manual 1-Click Auto-Assignment Triggered by NOC Dispatcher'
        );
        assignedCount++;
      }
    }

    const message =
      assignedCount > 0
        ? `⚡ 5-Min SLA Engine: Successfully auto-assigned ${assignedCount} complaint(s) & dispatched alerts to NOC Field Ops WhatsApp Group.`
        : `⚡ 5-Min SLA Engine: All open complaints are already assigned or within the initial 5-minute manual triage window.`;

    return { assignedCount, message };
  };

  const resolveTicket = (ticketId: string, resolutionNotes: string, proofImageUrl?: string) => {
    setComplaints((prev) =>
      prev.map((t) =>
        t.id === ticketId
          ? {
              ...t,
              status: 'resolved',
              resolvedAt: new Date().toISOString(),
              resolutionNotes,
              proofImageUrl: proofImageUrl || t.proofImageUrl,
            }
          : t
      )
    );
  };

  const broadcastAreaOutage = (
    areaNode: string,
    title: string,
    cause: string,
    severity: 'minor' | 'major' | 'critical',
    estimatedHours: number
  ) => {
    const affectedCusts = customers.filter((c) => c.areaNode === areaNode);
    const count = affectedCusts.length || 18;

    const newOutage: AreaOutage = {
      id: `outage-${Date.now()}`,
      areaNode,
      title,
      cause,
      severity,
      affectedCustomersCount: count,
      startTime: new Date().toISOString(),
      estimatedResolutionTime: new Date(Date.now() + estimatedHours * 60 * 60 * 1000).toISOString(),
      status: 'investigating',
      broadcastSentToWhatsAppCount: count,
      routerId: selectedRouterId,
    };

    setOutages((prev) => [newOutage, ...prev]);

    // Emit WhatsApp logs for affected users
    const newLogs: WhatsAppNotificationLog[] = affectedCusts.map((c) => ({
      id: `wa-outage-${c.id}-${Date.now()}`,
      recipientPhone: c.phone,
      recipientName: c.name,
      type: 'outage_alert',
      templateName: 'isp_area_outage_broadcast',
      messageBody: `⚠️ *NETPULSE AREA OUTAGE ALERT*:\nNode ${areaNode} is experiencing service disruption due to: ${cause}. Our fiber restoration team is deployed. ETA: ${estimatedHours} hours.`,
      status: 'delivered',
      timestamp: new Date().toISOString(),
    }));

    setWhatsAppLogs((prev) => [...newLogs, ...prev]);
  };

  const updateOutage = (
    outageId: string,
    updates: Partial<AreaOutage>,
    broadcastWhatsApp = false,
    customMessage?: string
  ) => {
    setOutages((prev) =>
      prev.map((o) => {
        if (o.id !== outageId) return o;
        const updated = { ...o, ...updates };

        if (broadcastWhatsApp) {
          const affectedCusts = customers.filter(
            (c) => c.areaNode === updated.areaNode || (updated.ponPort && c.areaNode.includes(updated.ponPort))
          );
          const etaFormatted = updated.estimatedResolutionTime
            ? new Date(updated.estimatedResolutionTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : 'Pending update';

          const msg =
            customMessage ||
            `⚠️ *YOUTH NET FIBER - OUTAGE STATUS UPDATE*\nNode / Area: *${updated.areaNode}*\nStatus: *${(updated.status || 'investigating').toUpperCase()}*\nETA: ${etaFormatted}\nWork Note: ${updated.workNotes || 'Our fiber optic technicians are actively working to restore connectivity.'}\n_Youth Net NOC Field Ops_`;

          const targets = affectedCusts.length > 0 ? affectedCusts : customers.slice(0, 5);
          const newLogs: WhatsAppNotificationLog[] = targets.map((c) => ({
            id: `wa-outage-update-${c.id}-${Date.now()}`,
            recipientPhone: c.phone,
            recipientName: c.name,
            type: 'outage_alert',
            templateName: 'isp_area_outage_update',
            messageBody: msg,
            status: 'delivered',
            timestamp: new Date().toISOString(),
          }));

          setWhatsAppLogs((wLogs) => [...newLogs, ...wLogs]);
        }

        return updated;
      })
    );
  };

  const resolveOutage = (
    outageId: string,
    resolutionNotes = 'Fiber spliced, optical power verified at -19.2 dBm, PPPoE sessions restored.',
    broadcastWhatsApp = true
  ) => {
    setOutages((prev) =>
      prev.map((o) => {
        if (o.id !== outageId) return o;
        const resolved: AreaOutage = {
          ...o,
          status: 'resolved',
          resolvedAt: new Date().toISOString(),
          workNotes: resolutionNotes,
        };

        if (broadcastWhatsApp) {
          const affectedCusts = customers.filter(
            (c) => c.areaNode === resolved.areaNode || (resolved.ponPort && c.areaNode.includes(resolved.ponPort))
          );
          const msg =
            `🟢 *YOUTH NET FIBER - NETWORK RESTORED*\nAll optical and routing services for node *${resolved.areaNode}* have been successfully cleared and tested.\nResolution: ${resolutionNotes}\nInternet connectivity is fully restored. Thank you for your patience.\n_Youth Net NOC Transmission Team_`;

          const targets = affectedCusts.length > 0 ? affectedCusts : customers.slice(0, 5);
          const newLogs: WhatsAppNotificationLog[] = targets.map((c) => ({
            id: `wa-outage-resolved-${c.id}-${Date.now()}`,
            recipientPhone: c.phone,
            recipientName: c.name,
            type: 'outage_alert',
            templateName: 'isp_area_outage_resolved',
            messageBody: msg,
            status: 'delivered',
            timestamp: new Date().toISOString(),
          }));

          setWhatsAppLogs((wLogs) => [...newLogs, ...wLogs]);
        }

        return resolved;
      })
    );
  };

  const logWhatsAppNotice = (
    recipientPhone: string,
    recipientName: string,
    messageBody: string,
    templateName: string = 'user_account_credentials_notice'
  ) => {
    setWhatsAppLogs((prev) => [
      {
        id: `wa-notice-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`,
        recipientPhone,
        recipientName,
        type: 'ticket_update',
        templateName,
        messageBody,
        status: 'delivered',
        timestamp: new Date().toISOString(),
      },
      ...prev,
    ]);
  };

  const refreshOnuSignal = async (onuId: string): Promise<OnuDevice> => {
    await new Promise((res) => setTimeout(res, 450));
    let updatedDevice: OnuDevice | undefined;

    setOnus((prev) =>
      prev.map((onu) => {
        if (onu.id === onuId) {
          const jitter = (Math.random() - 0.5) * 0.6;
          const newRx = Math.round((onu.rxPowerDbm + jitter) * 10) / 10;
          const newQuality = classifyOpticalSignal(newRx, onu.status);
          updatedDevice = {
            ...onu,
            rxPowerDbm: newRx,
            opticalQuality: newQuality,
            lastOnlineTime: new Date().toISOString(),
          };
          return updatedDevice;
        }
        return onu;
      })
    );

    return updatedDevice || onus.find((o) => o.id === onuId)!;
  };

  const rebootOnu = async (onuId: string): Promise<void> => {
    await new Promise((res) => setTimeout(res, 600));
    setOnus((prev) =>
      prev.map((onu) =>
        onu.id === onuId
          ? { ...onu, status: 'online', opticalQuality: classifyOpticalSignal(onu.rxPowerDbm, 'online'), lastOnlineTime: new Date().toISOString() }
          : onu
      )
    );
  };

  const addOlt = (newOlt: Omit<VsolOlt, 'id'>) => {
    const id = `olt-vsol-${Date.now().toString().slice(-4)}`;
    const createdOlt: VsolOlt = { ...newOlt, id };
    setOlts((prev) => [...prev, createdOlt]);
    setSelectedOltId(id);
  };

  const updateOlt = (oltId: string, updated: Partial<VsolOlt>) => {
    setOlts((prev) =>
      prev.map((o) => (o.id === oltId ? { ...o, ...updated } : o))
    );
  };

  const deleteOlt = (oltId: string) => {
    setOlts((prev) => {
      const remaining = prev.filter((o) => o.id !== oltId);
      if (selectedOltId === oltId && remaining.length > 0) {
        setSelectedOltId(remaining[0].id);
      }
      return remaining;
    });
  };

  const testOltSnmpConnection = async (
    ipAddress: string,
    community: string,
    port: number
  ): Promise<{ success: boolean; latencyMs: number; sysDescr?: string; message: string }> => {
    await new Promise((res) => setTimeout(res, 500));
    const latency = Math.floor(8 + Math.random() * 15);
    return {
      success: true,
      latencyMs: latency,
      sysDescr: `VSOL V1600 Series SNMP Agent v2c (${ipAddress}:${port}, community: ${community})`,
      message: `SNMP handshake successful (${latency}ms round-trip). Optical MIBs reachable.`,
    };
  };

  return (
    <ISPContext.Provider
      value={{
        routers,
        packages,
        customers,
        activeSessions,
        invoices,
        complaints,
        agents,
        outages,
        expenses,
        whatsAppLogs,
        selectedRouterId,
        setSelectedRouterId,
        bandwidthHistory,
        isTrafficStreaming,
        setIsTrafficStreaming,
        lastCronMessage,
        kickSession,
        provisionPppoeSecret,
        toggleCustomerStatus,
        addMikrotikRouter,
        deleteMikrotikRouter,
        collectAgentCashPayment,
        handoverCashToBoss,
        confirmCashHandover,
        receiveDirectHandoverFromAgent,
        cashHandovers,
        salaryTransactions,
        disburseAdvanceSalary,
        recordAdvanceReturn,
        payMonthlySalary,
        updateAgentSalary,
        addAgent,
        updateAgent,
        deleteAgent,
        runMonthlyBillingCron,
        runOverdueScanCron,
        createInvoice,
        updateInvoice,
        addExpense,
        createComplaintTicket,
        assignTicketToAgent,
        autoAssignTicket,
        run5MinComplaintAutoAssignEngine,
        resolveTicket,
        broadcastAreaOutage,
        updateOutage,
        resolveOutage,
        logWhatsAppNotice,
        olts,
        onus,
        selectedOltId,
        setSelectedOltId,
        refreshOnuSignal,
        rebootOnu,
        addOlt,
        updateOlt,
        deleteOlt,
        testOltSnmpConnection,
      }}
    >
      {children}
    </ISPContext.Provider>
  );
};

export const useISP = () => {
  const context = useContext(ISPContext);
  if (!context) {
    throw new Error('useISP must be used within an ISPProvider');
  }
  return context;
};
