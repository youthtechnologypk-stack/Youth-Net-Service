import { SystemRole } from './auth';

export type ManagerFeatureKey =
  | 'manager_view_billing_revenue'
  | 'manager_manual_cash_approval'
  | 'manager_edit_subscribers'
  | 'manager_routeros_active_kick'
  | 'manager_tickets_create_assign'
  | 'manager_olt_optical_telemetry';

export type AgentFeatureKey =
  | 'agent_collect_cash_receipts'
  | 'agent_view_subscriber_contact_location'
  | 'agent_check_ont_optical_power'
  | 'agent_resolve_fiber_tickets'
  | 'agent_full_area_directory';

export type ClientFeatureKey =
  | 'client_online_bill_payment'
  | 'client_lodge_complaint_ticket'
  | 'client_live_speed_bandwidth_monitor'
  | 'client_download_invoices_receipts'
  | 'client_wifi_password_self_service';

export type FeatureKey = ManagerFeatureKey | AgentFeatureKey | ClientFeatureKey;

export interface FeatureDefinition {
  key: FeatureKey;
  name: string;
  description: string;
  role: SystemRole;
  module: string;
  defaultEnabled: boolean;
  category: 'finance' | 'subscribers' | 'network' | 'field' | 'tickets' | 'self_service' | 'diagnostics';
  impactSummary: string;
}

export const FEATURE_CATALOG: FeatureDefinition[] = [
  // --- MANAGER FEATURES ---
  {
    key: 'manager_view_billing_revenue',
    name: 'View Full Billing & Revenue Figures',
    description: 'Allows Operations Managers to view gross revenue, pending dues, collection totals, and financial metrics.',
    role: 'MANAGER',
    module: 'Billing & Financial Insights',
    defaultEnabled: true,
    category: 'finance',
    impactSummary: 'When disabled, hides revenue totals, cash collection charts, and sensitive financial summaries.',
  },
  {
    key: 'manager_manual_cash_approval',
    name: 'Manual Cash Collection Approval',
    description: 'Enables managers to reconcile and approve cash handovers submitted by field recovery agents.',
    role: 'MANAGER',
    module: 'Cash Recovery & Reconciliation',
    defaultEnabled: true,
    category: 'finance',
    impactSummary: 'When disabled, disables manual cash approval actions and handover reconciliation.',
  },
  {
    key: 'manager_edit_subscribers',
    name: 'Edit / Update Subscriber Profiles',
    description: 'Allows modifying customer package bindings, billing addresses, static IP allocations, and phone numbers.',
    role: 'MANAGER',
    module: 'Subscriber Operations',
    defaultEnabled: true,
    category: 'subscribers',
    impactSummary: 'When disabled, prevents changing subscriber profile attributes and contact records.',
  },
  {
    key: 'manager_routeros_active_kick',
    name: 'Access RouterOS Active Sessions & Force Kick',
    description: 'Permits inspecting active PPPoE sessions on MikroTik BNG and issuing remote disconnect/kick commands.',
    role: 'MANAGER',
    module: 'Network & MikroTik BNG',
    defaultEnabled: true,
    category: 'network',
    impactSummary: 'When disabled, hides or locks the session termination and force kick actions.',
  },
  {
    key: 'manager_tickets_create_assign',
    name: 'Create & Assign Support / SLA Tickets',
    description: 'Enables dispatching fiber break tickets and assigning field recovery technicians directly.',
    role: 'MANAGER',
    module: 'SLA & Field Dispatching',
    defaultEnabled: true,
    category: 'tickets',
    impactSummary: 'When disabled, locks ticket dispatch and reassignment features for managers.',
  },
  {
    key: 'manager_olt_optical_telemetry',
    name: 'Access OLT Optical Telemetry',
    description: 'Allows inspecting VSOL GPON OLT PON ports, optical signal levels, and ONU inventory status.',
    role: 'MANAGER',
    module: 'Fiber Plant & OLT',
    defaultEnabled: true,
    category: 'diagnostics',
    impactSummary: 'When disabled, hides OLT optical power metrics and optical telemetry readouts.',
  },

  // --- FIELD AGENT FEATURES ---
  {
    key: 'agent_collect_cash_receipts',
    name: 'Collect Cash & Issue Instant WhatsApp Receipts',
    description: 'Empowers field riders to accept cash on doorstep and automatically dispatch digital WhatsApp receipts.',
    role: 'AGENT',
    module: 'Doorstep Recovery',
    defaultEnabled: true,
    category: 'field',
    impactSummary: 'When disabled, disables doorstep cash recording and WhatsApp payment dispatch.',
  },
  {
    key: 'agent_view_subscriber_contact_location',
    name: 'View Subscriber Contact & Full Location Details',
    description: 'Provides exact customer street addresses, phone contact links, and mapped node locations to the agent.',
    role: 'AGENT',
    module: 'Field Logistics',
    defaultEnabled: true,
    category: 'field',
    impactSummary: 'When disabled, masks customer telephone numbers and full physical addresses.',
  },
  {
    key: 'agent_check_ont_optical_power',
    name: 'Check ONT Optical Rx/Tx Power (Signal Diagnostic)',
    description: 'Allows on-site field technicians to query live optical receive power (dBm) from the customer ONT.',
    role: 'AGENT',
    module: 'Optical Diagnostics',
    defaultEnabled: true,
    category: 'diagnostics',
    impactSummary: 'When disabled, locks the live optical signal testing dial and ONT diagnostic tools.',
  },
  {
    key: 'agent_resolve_fiber_tickets',
    name: 'Close / Resolve Assigned Fiber Cut Tickets',
    description: 'Allows agents to mark assigned fiber splicing and complaint tickets as resolved directly from the portal.',
    role: 'AGENT',
    module: 'Field SLA & Tickets',
    defaultEnabled: true,
    category: 'tickets',
    impactSummary: 'When disabled, requires an administrator or manager to review and close complaints.',
  },
  {
    key: 'agent_full_area_directory',
    name: 'Access Full Area Subscriber Directory',
    description: 'Grants access to browse all subscribers across the entire city node versus only assigned recovery tickets.',
    role: 'AGENT',
    module: 'Directory & Lookup',
    defaultEnabled: false,
    category: 'subscribers',
    impactSummary: 'When disabled, agents can only see subscribers with active tickets or overdue invoices assigned to them.',
  },

  // --- CLIENT / SUBSCRIBER PORTAL FEATURES ---
  {
    key: 'client_online_bill_payment',
    name: 'Online Bill Payment (EasyPaisa / JazzCash / Bank)',
    description: 'Allows subscribers to pay outstanding invoices using 1-click mobile wallet or online card checkout.',
    role: 'CLIENT',
    module: 'Billing & Self-Service',
    defaultEnabled: true,
    category: 'self_service',
    impactSummary: 'When disabled, hides the "Pay Now" checkout button, directing users to physical agent recovery.',
  },
  {
    key: 'client_lodge_complaint_ticket',
    name: 'Lodge New Complaint / Support Ticket',
    description: 'Enables customers to submit ticket requests directly to the 24/7 NOC engineering queue.',
    role: 'CLIENT',
    module: 'Support Desk',
    defaultEnabled: true,
    category: 'tickets',
    impactSummary: 'When disabled, hides the complaint ticket submission form and urges phone contact.',
  },
  {
    key: 'client_live_speed_bandwidth_monitor',
    name: 'Live Speed & Bandwidth Usage Monitor',
    description: 'Provides live GPON throughput measurement and real-time bandwidth test tool for subscribers.',
    role: 'CLIENT',
    module: 'Network Telemetry',
    defaultEnabled: true,
    category: 'network',
    impactSummary: 'When disabled, replaces the live speed test dial with standard package bandwidth stats.',
  },
  {
    key: 'client_download_invoices_receipts',
    name: 'Download Invoices & Payment Receipts',
    description: 'Allows clients to download PDF and thermal printable payment receipts and invoice breakdowns.',
    role: 'CLIENT',
    module: 'Documents & Receipts',
    defaultEnabled: true,
    category: 'self_service',
    impactSummary: 'When disabled, restricts digital receipt downloads for subscribers.',
  },
  {
    key: 'client_wifi_password_self_service',
    name: 'Change Wi-Fi Password / Basic Self-Service',
    description: 'Empowers clients to remotely update their ONT Wi-Fi SSID, pre-shared key, and restart their router.',
    role: 'CLIENT',
    module: 'Customer Premises Self-Care',
    defaultEnabled: true,
    category: 'self_service',
    impactSummary: 'When disabled, locks self-service ONT configuration and displays contact NOC banner.',
  },
];

export const DEFAULT_ROLE_PERMISSIONS: Record<SystemRole, Record<string, boolean>> = {
  ADMIN: {
    // Admin has full master privileges
    manager_view_billing_revenue: true,
    manager_manual_cash_approval: true,
    manager_edit_subscribers: true,
    manager_routeros_active_kick: true,
    manager_tickets_create_assign: true,
    manager_olt_optical_telemetry: true,
    agent_collect_cash_receipts: true,
    agent_view_subscriber_contact_location: true,
    agent_check_ont_optical_power: true,
    agent_resolve_fiber_tickets: true,
    agent_full_area_directory: true,
    client_online_bill_payment: true,
    client_lodge_complaint_ticket: true,
    client_live_speed_bandwidth_monitor: true,
    client_download_invoices_receipts: true,
    client_wifi_password_self_service: true,
  },
  MANAGER: {
    manager_view_billing_revenue: true,
    manager_manual_cash_approval: true,
    manager_edit_subscribers: true,
    manager_routeros_active_kick: true,
    manager_tickets_create_assign: true,
    manager_olt_optical_telemetry: true,
  },
  AGENT: {
    agent_collect_cash_receipts: true,
    agent_view_subscriber_contact_location: true,
    agent_check_ont_optical_power: true,
    agent_resolve_fiber_tickets: true,
    agent_full_area_directory: false, // Default restricted to assigned
  },
  CLIENT: {
    client_online_bill_payment: true,
    client_lodge_complaint_ticket: true,
    client_live_speed_bandwidth_monitor: true,
    client_download_invoices_receipts: true,
    client_wifi_password_self_service: true,
  },
};

export interface RolePermissionsState {
  permissions: Record<SystemRole, Record<string, boolean>>;
  userOverrides: Record<string, Record<string, boolean>>; // userId -> { featureKey: boolean }
  lastUpdated?: string;
  updatedBy?: string;
}

export function getFeaturesForRole(role: SystemRole): FeatureDefinition[] {
  if (role === 'ADMIN') return FEATURE_CATALOG;
  return FEATURE_CATALOG.filter((f) => f.role === role);
}
