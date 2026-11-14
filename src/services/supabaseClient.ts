import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = 'https://qstqegwpibztpirncpga.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_Ce_QIF3wHFISjJtTiYGY-Q_qs6miPTU';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});

export interface SupabasePortalUser {
  id: string;
  username: string;
  password?: string;
  role: 'ADMIN' | 'MANAGER' | 'AGENT' | 'CLIENT';
  full_name: string;
  phone: string;
  area: string;
  cnic?: string | null;
  address?: string | null;
  base_salary?: number;
  cash_in_hand?: number;
  advance_balance?: number;
  account_status?: 'ACTIVE' | 'EXPIRED' | 'SUSPENDED';
  package_speed?: string | null;
  package_volume_gb?: number | null;
  monthly_fee?: number | null;
  onu_device_model?: string | null;
  onu_mac?: string | null;
  onu_pon_serial?: string | null;
  fiber_box_location?: string | null;
  drop_wire_meters?: number | null;
  patch_cord_qty?: number | null;
  installation_date?: string | null;
  expiry_date?: string | null;
  package_profile_name?: string | null;
  original_package_profile?: string | null;
  billing_status?: 'ACTIVE' | 'REMINDER_SENT' | 'GRACE_PERIOD' | 'SUSPENDED_EXPIRED' | string | null;
  grace_ends_at?: string | null;
  last_reminder_cycle?: string | null;
  suspended_at?: string | null;
  last_restored_at?: string | null;
  created_at?: string;
}

export interface SupabaseInvoice {
  id: string;
  invoice_no: string;
  subscriber_username: string;
  assigned_agent_id?: string | null;
  assigned_agent_name?: string | null;
  amount: number;
  paid_amount?: number;
  status: 'DUE' | 'PARTIAL' | 'PAID' | 'OVERDUE';
  due_date: string;
  cycle_day: number;
  paid_at?: string | null;
  created_at?: string;
}

export interface SupabasePaymentTransaction {
  id?: string;
  invoice_id: string;
  subscriber_username: string;
  collected_by_id?: string | null;
  collected_by_name?: string | null;
  amount_paid: number;
  payment_mode?: string;
  payment_method?: string;
  payment_date?: string;
  notes?: string;
  previous_amount?: number | null;
  edited_by?: string | null;
  edited_at?: string | null;
  edit_reason?: string | null;
  created_at?: string;
}

export interface SupabaseRecoveryLedgerRow {
  id: string;
  invoice_id?: string | null;
  subscriber_username?: string | null;
  agent_id?: string | null;
  agent_name?: string | null;
  amount: number;
  payment_method: string;
  collected_at: string;
  remarks?: string | null;
  previous_amount?: number | null;
  edited_by?: string | null;
  edited_at?: string | null;
  edit_reason?: string | null;
  created_at?: string;
}

export interface SupabaseTicket {
  id: string;
  ticket_no: string;
  subscriber_username: string;
  assigned_agent_id?: string | null;
  assigned_agent_name?: string | null;
  issue: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  status: 'OPEN' | 'RESOLVED';
  created_at?: string;
}

export interface SupabaseSubscriberInventoryLog {
  id?: string;
  subscriber_username: string;
  item_name: string;
  quantity: number;
  unit_cost: number;
  added_to_invoice?: boolean;
  installed_by_agent_name?: string | null;
  created_at?: string;
}

export interface SupabaseSubscriberSessionLog {
  id?: string;
  subscriber_username: string;
  session_id?: string | null;
  ip_address?: string | null;
  mac_address?: string | null;
  uptime_duration?: string | null;
  uptime_seconds?: number | null;
  bytes_in: number;
  bytes_out: number;
  session_status?: 'ACTIVE' | 'DISCONNECTED' | 'RECONNECTED' | 'KICKED' | string | null;
  disconnect_reason?: string | null;
  connected_at?: string | null;
  recorded_at?: string;
  disconnected_at?: string | null;
}

export interface SupabaseAgentCashTransaction {
  id?: string;
  agent_id: string;
  agent_name?: string | null;
  agent_username?: string | null;
  amount: number;
  transaction_type: 'CASH_HANDOVER' | 'ADVANCE_TAKEN' | 'ADVANCE_RETURN' | 'SALARY_PAYOUT' | string;
  received_by?: string | null;
  notes?: string | null;
  previous_amount?: number | null;
  edited_by?: string | null;
  edited_at?: string | null;
  edit_reason?: string | null;
  created_at?: string;
}

export interface SupabaseUpstreamCapacityConfig {
  id: string;
  provider_name: string;
  total_dedicated_mbps: number;
  contention_ratio: number;
  warning_threshold_pct: number;
  critical_threshold_pct: number;
  wan_interface_name: string;
  updated_at?: string;
}

export type IspExpenseCategory =
  | 'UPSTREAM_BANDWIDTH'
  | 'FIBER_HARDWARE'
  | 'POWER_SOLAR_UPS'
  | 'FIELD_MAINTENANCE'
  | 'OFFICE_RENT_UTILS'
  | 'OTHER';

export type IspExpensePaymentMethod =
  | 'BANK_TRANSFER'
  | 'CASH'
  | 'JAZZCASH_EASYPAISA';

export interface SupabaseIspExpense {
  id?: string;
  expense_category: IspExpenseCategory | string;
  title: string;
  amount: number;
  payment_method: IspExpensePaymentMethod | string;
  expense_date: string;
  notes?: string | null;
  recorded_by?: string | null;
  created_at?: string;
}

export type PaymentAccountType = 'BANK' | 'JAZZCASH' | 'EASYPAISA' | 'RAST';

export interface SupabasePaymentAccount {
  id: string;
  account_type: PaymentAccountType | string;
  provider_name: string;
  account_title: string;
  account_number_or_iban: string;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface SupabaseWhatsappBillingConfig {
  id?: string;
  company_name?: string | null;
  support_whatsapp: string;
  cloud_api_enabled?: boolean;
  webhook_url?: string | null;
  phone_number_id?: string | null;
  auto_remind_days_before?: number;
  bot_enabled?: boolean;
  webhook_verify_token?: string | null;
  ai_bot_system_prompt?: string | null;
  api_gateway_url?: string | null;
  api_token?: string | null;
  auto_api_enabled?: boolean;
  updated_at?: string;
}

export interface SupabaseWhatsappBotSession {
  id: string;
  sender_phone: string;
  subscriber_username?: string | null;
  conversation_state?: string | null;
  last_message_in?: string | null;
  last_bot_reply?: string | null;
  created_ticket_no?: string | null;
  updated_at?: string;
}

export type ExpirySuspensionMode = 'EXPIRED_PROFILE' | 'DISABLE_SECRET';
export type SubscriberBillingStatus =
  | 'ACTIVE'
  | 'REMINDER_SENT'
  | 'GRACE_PERIOD'
  | 'SUSPENDED_EXPIRED';

export interface SupabaseIspBillingSettings {
  id: number;
  expiry_ppp_profile: string;
  suspension_mode: ExpirySuspensionMode | string;
  grace_hours: number;
  cutoff_time_pkt: string;
  jazzcash_title?: string | null;
  jazzcash_number?: string | null;
  easypaisa_title?: string | null;
  easypaisa_number?: string | null;
  bank_name?: string | null;
  bank_account_title?: string | null;
  bank_iban?: string | null;
  google_maps_api_key?: string | null;
  updated_at?: string;
}

export type ExpiryAuditActionType =
  | 'REMINDER_3D'
  | 'ENTERED_GRACE'
  | 'SUSPENDED_16_POOL'
  | 'DISABLED_SECRET'
  | 'RESTORED_ON_PAYMENT'
  | 'GRACE_EXTENDED';

export type ExpiryTriggeredBy = 'CRON_2PM' | 'ADMIN' | 'AGENT_PAYMENT_SYNC';

export interface SupabaseExpiryAuditLog {
  id?: string;
  subscriber_id?: string | null;
  username: string;
  action_type: ExpiryAuditActionType | string;
  previous_profile?: string | null;
  applied_profile?: string | null;
  triggered_by: ExpiryTriggeredBy | string;
  notes?: string | null;
  created_at?: string;
}

export interface SupabaseWhatsappReminderLog {
  id?: string;
  subscriber_id?: string | null;
  username: string;
  phone?: string | null;
  message_body: string;
  amount_due: number;
  expiry_date?: string | null;
  status: 'QUEUED' | 'SENT' | 'FAILED' | string;
  created_at?: string;
}

export type GisNodeType = 'OLT' | 'FOSC_JOINT' | 'FDB_FAT';
export type GisSplitterType =
  | 'none'
  | '1:2'
  | '1:4'
  | '1:8'
  | '1:16'
  | '1:32'
  | '90:10'
  | '80:20'
  | '70:30';
export type GisCoreStatus =
  | 'Feed / Splitter'
  | 'Through / Pass'
  | 'Free / Dark'
  | 'Dead / High Loss';
export type GisSpliceStatus = 'Straight Splice' | 'Cross Splice' | 'Cut / Dead';
export type GisPortStatus = 'ACTIVE' | 'FREE' | 'FAULTY';

export interface GisLatLng {
  lat: number;
  lng: number;
}

export interface GisSpliceEntry {
  coreIn: number;
  coreOut: number;
  status: GisSpliceStatus;
  note?: string;
}

export interface GisCoreEntry {
  coreNumber: number;
  tubeNumber: number;
  tubeColorName: string;
  tubeColorHex: string;
  coreColorName: string;
  coreColorHex: string;
  status: GisCoreStatus;
  destinationNote?: string;
  assignedNodeId?: string | null;
}

export interface SupabaseGisNode {
  id: string;
  node_type: GisNodeType;
  name: string;
  area_name?: string | null;
  lat: number;
  lng: number;
  tx_power_dbm: number;
  splitter_type: GisSplitterType;
  total_ports: number;
  feed_cable_id?: string | null;
  feed_core_number?: number | null;
  calculated_input_dbm?: number | null;
  calculated_ont_rx_dbm?: number | null;
  tray_capacity: number;
  loss_per_splice: number;
  splice_tray_json: GisSpliceEntry[];
  notes?: string | null;
  updated_by?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface SupabaseGisCable {
  id: string;
  name?: string | null;
  source_node_id: string;
  target_node_id: string;
  cable_cores: 2 | 4 | 6 | 8 | 12 | 24 | 48;
  distance_meters: number;
  route_coordinates_json: GisLatLng[];
  cores_tia598_json: GisCoreEntry[];
  notes?: string | null;
  updated_by?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface SupabaseGisFdbPort {
  id: string;
  fdb_node_id: string;
  port_number: number;
  subscriber_id?: string | null;
  subscriber_username?: string | null;
  client_label?: string | null;
  drop_cable_meters: number;
  status: GisPortStatus;
  updated_at?: string;
}


