export type UserRole = 'super_admin' | 'noc_engineer' | 'billing_accountant' | 'field_agent' | 'customer';

export type CustomerStatus = 'active' | 'expired' | 'disabled' | 'walled_garden' | 'pending_installation';

export type ConnectionType = 'pppoe' | 'static_ip' | 'hotspot';

export type InvoiceStatus = 'paid' | 'unpaid' | 'overdue' | 'cancelled';

export type PaymentMethod = 'agent_cash' | 'online_gateway' | 'bank_transfer' | 'easypaisa' | 'jazzcash';

export type TicketCategory = 'fiber_cut' | 'router_issue' | 'slow_speed' | 'no_internet' | 'billing_issue';

export type TicketPriority = 'low' | 'medium' | 'high' | 'critical';

export type TicketStatus = 'open' | 'assigned' | 'in_progress' | 'resolved' | 'closed';

export type OutageSeverity = 'minor' | 'major' | 'critical';

export interface InternetPackage {
  id: string;
  name: string;
  downloadSpeedMbps: number;
  uploadSpeedMbps: number;
  priceMonthly: number;
  mikrotikProfile: string;
  dataLimitGb: number | null; // null for unlimited
  isPopular?: boolean;
  localAddress?: string; // e.g. "192.168.8.1"
  remoteAddressPool?: string; // e.g. "pppoe-pool-1"
  dnsServers?: string; // e.g. "8.8.8.8, 1.1.1.1"
  queueType?: string; // e.g. "default" | "pcq-download-default" | "fq_codel"
  burstDownloadMbps?: number;
  burstUploadMbps?: number;
  burstThresholdMbps?: number;
  burstTimeSeconds?: number;
  description?: string;
}

export interface Customer {
  id: string;
  accountNumber: string; // e.g. NP-CUST-1042
  name: string;
  phone: string; // international format for WhatsApp e.g. +923001234567
  email: string;
  address: string;
  areaNode: string; // e.g. "Sector-G11-PON-02"
  connectionType: ConnectionType;
  pppoeUsername: string;
  pppoePassword?: string;
  assignedIp: string;
  macAddress: string;
  packageId: string;
  package?: InternetPackage;
  routerId: string; // Foreign key to mikrotik_routers
  status: CustomerStatus;
  installationDate: string;
  billingDay: number; // 1st of month
  balanceDue: number;
  lastPaymentDate?: string;
  ontSignalDbm?: number; // e.g. -19.4 dBm
  createdDate?: string; // YYYY-MM-DD
  validityDays?: number; // e.g. 30
  expiryDate?: string; // YYYY-MM-DD
  expiredProfile?: string; // default "EXPIRED-POOL" or "walled_garden"
  isolationPool?: string; // default "16.16.16.0/24"
  comment?: string;
}

export interface MikrotikRouter {
  id: string;
  name: string;
  model: string;
  ipAddress: string;
  ip?: string;
  apiPort: number;
  port?: number;
  username: string;
  password?: string;
  useSsl: boolean;
  version: string; // e.g. "RouterOS v7.16.2"
  location: string;
  cpuLoad: number; // %
  memoryUsageMb: number;
  totalMemoryMb: number;
  uptime: string;
  status: 'online' | 'unreachable' | 'syncing' | 'hybrid_online';
  mode?: 'live' | 'hybrid';
  wanInterface: string;
  currentWanRxMbps: number;
  currentWanTxMbps: number;
  activePppoeCount: number;
  walledGardenPool: string; // e.g. "172.16.100.0/24"
}

export interface ActiveSession {
  id: string;
  username: string;
  callerId: string; // MAC address
  address: string; // IP
  service: 'pppoe';
  uptime: string; // e.g. "3d 14h 22m"
  rxRateMbps: number;
  txRateMbps: number;
  bytesInMb: number;
  bytesOutMb: number;
  routerId: string;
  customerName?: string;
  profileName: string;
  liveRateFormatted?: string;
}

export interface RouterInterface {
  id: string;
  name: string;
  type: 'ether' | 'sfp-sfpplus' | 'bridge' | 'vlan';
  status: 'running' | 'disabled' | 'link_down';
  running: boolean;
  disabled: boolean;
  comment?: string;
  macAddress: string;
  mtu: number;
  actualMtu?: number;
  linkSpeed?: string; // e.g. "10Gbps" | "1Gbps" | "2.5Gbps"
  fullDuplex?: boolean;
  rxBytes: number;
  txBytes: number;
  rxRateMbps: number;
  txRateMbps: number;
  routerId: string;
}

export type InvoiceItemCategory =
  | 'monthly_subscription'
  | 'installation_fee'
  | 'router_onu_ont'
  | 'fiber_cable'
  | 'patch_cord'
  | 'joint_box_splitter'
  | 'custom_hardware';

export interface InvoiceLineItem {
  id: string;
  category: InvoiceItemCategory;
  description: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  serialNumber?: string; // Optional MAC / Serial Number for ONUs, ONT devices, routers
  unit?: string; // e.g. "meter", "pcs", "month"
}

export interface Invoice {
  id: string;
  invoiceNumber: string; // e.g. "INV-202609-0842"
  customerId: string;
  customerName: string;
  customerPhone: string;
  packageId: string;
  packageName: string;
  billingMonth: string; // e.g. "September 2026"
  baseAmount: number;
  taxAmount: number;
  discountAmount: number;
  totalAmount: number;
  status: InvoiceStatus;
  dueDate: string;
  issuedAt: string;
  paidAt?: string;
  paymentMethod?: PaymentMethod | string;
  collectedByAgentId?: string;
  agentName?: string;
  receiptNumber?: string;
  whatsappNoticeSent: boolean;
  whatsappNoticeTimestamp?: string;
  lineItems?: InvoiceLineItem[];
}

export interface PaymentCollection {
  id: string;
  invoiceId: string;
  customerId: string;
  customerName: string;
  amount: number;
  paymentMethod: PaymentMethod;
  collectedByAgentId: string;
  agentName: string;
  transactionReference: string;
  collectedAt: string;
  reconciledWithBank: boolean;
}

export interface ComplaintTicket {
  id: string;
  ticketNumber: string; // e.g. "TKT-4921"
  customerId: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  areaNode: string;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  title: string;
  description: string;
  assignedAgentId?: string;
  assignedAgentName?: string;
  slaTargetHours: number;
  createdAt: string;
  slaDeadline: string; // ISO date string
  resolvedAt?: string;
  resolutionNotes?: string;
  proofImageUrl?: string;
  routerId: string;
  autoAssigned?: boolean;
  autoAssignedAt?: string;
}

export interface FieldAgent {
  id: string;
  name: string;
  phone: string;
  email: string;
  assignedArea: string;
  status: 'active' | 'on_field' | 'offline';
  cashInHand: number;
  totalCollectedToday: number;
  activeTicketsAssigned: number;
  avatarUrl?: string;
  // Salary & Advances
  baseSalary: number;
  advanceSalaryTaken: number;
  advanceSalaryReturned: number;
}

export interface CashHandover {
  id: string;
  handoverNumber: string;
  agentId: string;
  agentName: string;
  amount: number;
  receiver: string;
  notes?: string;
  timestamp: string;
  status: 'confirmed' | 'pending';
  confirmedBy?: string;
  confirmedAt?: string;
}

export type SalaryTransactionType = 'advance_disbursed' | 'advance_returned' | 'salary_paid';

export interface AgentSalaryTransaction {
  id: string;
  transactionNumber: string;
  agentId: string;
  agentName: string;
  type: SalaryTransactionType;
  amount: number;
  date: string;
  paymentMethod: 'cash' | 'bank_transfer' | 'salary_deduction';
  notes: string;
  recordedBy: string;
}

export type OutageStatus = 'investigating' | 'splicing' | 'testing' | 'active' | 'resolved';

export interface AreaOutage {
  id: string;
  areaNode: string;
  title: string;
  cause: string;
  severity: OutageSeverity;
  affectedCustomersCount: number;
  startTime: string;
  estimatedResolutionTime: string;
  status: OutageStatus;
  broadcastSentToWhatsAppCount: number;
  routerId: string;
  ponPort?: string;
  workNotes?: string;
  resolvedAt?: string;
}

export interface IspExpense {
  id: string;
  category: 'upstream_transit' | 'dark_fiber_lease' | 'staff_salaries' | 'generator_diesel' | 'hardware_maintenance' | 'office_rent';
  title: string;
  amount: number;
  date: string;
  paidTo: string;
  paymentMode: 'bank_transfer' | 'cash' | 'cheque';
  receiptReference: string;
  notes?: string;
}

export interface WhatsAppNotificationLog {
  id: string;
  recipientPhone: string;
  recipientName: string;
  type: 'invoice_generated' | 'payment_reminder' | 'payment_receipt' | 'line_disabled' | 'outage_alert' | 'ticket_update';
  templateName: string;
  messageBody: string;
  status: 'read' | 'delivered' | 'sent' | 'failed' | 'queued';
  timestamp: string;
}

export interface MikrotikPppProfile {
  '.id'?: string;
  id?: string;
  name: string;
  'rate-limit'?: string;
  rateLimit?: string;
  'local-address'?: string;
  localAddress?: string;
  'remote-address'?: string;
  remoteAddress?: string;
  'only-one'?: string | boolean;
  onlyOne?: string | boolean;
  'dns-server'?: string;
  comment?: string;
}

export interface MikrotikPppSecret {
  '.id'?: string;
  id?: string;
  name: string;
  user?: string;
  password?: string;
  profile: string;
  service?: string;
  'remote-address'?: string;
  remoteAddress?: string;
  'local-address'?: string;
  localAddress?: string;
  comment?: string;
  disabled?: boolean | string;
  'caller-id'?: string;
  callerId?: string;
}
