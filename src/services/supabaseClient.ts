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
  role: 'ADMIN' | 'MANAGER' | 'AGENT' | 'CLIENT' | 'DEALER' | 'SUB_DEALER';
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
  billing_anchor_day?: number | null;
  next_billing_date?: string | null;
  expiry_date?: string | null;
  package_name?: string | null;
  package_profile_name?: string | null;
  original_package_profile?: string | null;
  billing_status?: 'ACTIVE' | 'REMINDER_SENT' | 'GRACE_PERIOD' | 'SUSPENDED_EXPIRED' | string | null;
  is_suspended?: boolean | null;
  shifted_to_next_month?: boolean | null;
  grace_until?: string | null;
  grace_ends_at?: string | null;
  last_reminder_cycle?: string | null;
  suspended_at?: string | null;
  last_restored_at?: string | null;
  can_access_gis_map?: boolean | null;
  gis_map_permission?: 'none' | 'view' | 'edit' | string | null;
  permissions?: Record<string, any> | null;
  tier_level?: 'MASTER' | 'DEALER' | 'SUB_DEALER' | string | null;
  parent_dealer_id?: string | null;
  dealer_id?: string | null;
  sub_dealer_id?: string | null;
  created_by_id?: string | null;
  wallet_balance?: number | null;
  credit_limit?: number | null;
  bandwidth_pool_cap_mbps?: number | null;
  assigned_pool_mbps?: number | null;
  max_active_users?: number | null;
  can_create_subdealers?: boolean | null;
  company_name?: string | null;
  whatsapp_status?: 'DISCONNECTED' | 'CONNECTING' | 'QR_READY' | 'CONNECTED' | string | null;
  whatsapp_phone?: string | null;
  whatsapp_auto_send?: boolean | null;
  whatsapp_support_phone?: string | null;
  allow_subdealer_whatsapp?: boolean | null;
  created_at?: string;
}

export type WhatsAppEventType =
  | 'PROVISION_WELCOME'
  | 'PORTAL_CREDENTIALS'
  | 'INVOICE_GENERATED'
  | 'PRE_EXPIRY_3D'
  | 'GRACE_PERIOD_3D'
  | 'AUTO_SUSPENSION'
  | 'PAYMENT_RESTORED'
  | 'AGENT_PAYMENT_RECEIPT'
  | 'COMPLAINT_CREATED_CLIENT'
  | 'COMPLAINT_CREATED_GROUP'
  | 'COMPLAINT_RESOLVED_CLIENT'
  | 'CUSTOM_MESSAGE'
  | 'MANUAL_TEST';

export interface SupabaseWhatsappLog {
  id: string;
  sender_portal_user_id?: string | null;
  sender_company_name: string;
  sender_phone?: string | null;
  sender_tier?: string | null;
  subscriber_id?: string | null;
  subscriber_username?: string | null;
  recipient_phone: string;
  dealer_id?: string | null;
  sub_dealer_id?: string | null;
  event_type: WhatsAppEventType | string;
  message_body: string;
  status: 'SENT' | 'FAILED' | 'SKIPPED' | string;
  error_message?: string | null;
  created_at: string;
}

export interface SupabaseResellerTariff {
  id: string;
  reseller_id: string;
  profile_name: string;
  wholesale_price: number;
  retail_price: number;
  updated_by?: string | null;
  updated_at?: string;
  created_at?: string;
}

export type ResellerWalletTxType =
  | 'RECHARGE'
  | 'SUBDEALER_TRANSFER'
  | 'USER_ACTIVATION'
  | 'RENEWAL_DEDUCTION'
  | 'REFUND'
  | 'ADJUSTMENT';

export interface SupabaseResellerWalletLedger {
  id: string;
  reseller_id: string;
  reseller_name?: string | null;
  reseller_username?: string | null;
  tx_type: ResellerWalletTxType;
  amount: number;
  balance_before?: number | null;
  balance_after: number;
  subscriber_username?: string | null;
  profile_name?: string | null;
  counterparty_reseller_id?: string | null;
  performed_by?: string | null;
  notes?: string | null;
  created_at?: string;
}

export interface SupabaseInvoice {
  id: string;
  invoice_no: string;
  subscriber_id?: string | null;
  subscriber_username: string;
  dealer_id?: string | null;
  sub_dealer_id?: string | null;
  created_by_id?: string | null;
  assigned_agent_id?: string | null;
  assigned_agent_name?: string | null;
  package_profile?: string | null;
  package_name?: string | null;
  amount: number;
  paid_amount?: number;
  status: 'DUE' | 'PARTIAL' | 'PAID' | 'OVERDUE';
  due_date: string;
  cycle_day: number;
  shifted_to_next_month?: boolean | null;
  notes?: string | null;
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
  | 'AGENT_COMMISSION'
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
  | 'GRACE_EXTENDED'
  | 'GRACE_REMOVED'
  | 'SHIFTED_NEXT_MONTH';

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

export type GisNodeType = 'OLT' | 'DIST_NODE' | 'FOSC_JOINT' | 'FDB_FAT';
export type GisSplitterCategory = 'NONE' | 'PLC_EQUAL' | 'FBT_RATIO';
export type GisSplitterType =
  | 'none'
  | '1:2'
  | '1:4'
  | '1:8'
  | '1:16'
  | '1:32'
  | '90:10'
  | '85:15'
  | '80:20'
  | '70:30'
  | '60:40'
  | '50:50';
export type GisCoreStatus =
  | 'Feed / Splitter'
  | 'Through / Pass'
  | 'Free / Dark'
  | 'Dead / High Loss';
export type GisCoreUsageType =
  | 'SPLITTER_FEED'
  | 'PASS_THROUGH_AREA'
  | 'FREE_SPARE'
  | 'DEAD_FAULT';
export type GisSpliceStatus = 'Straight Splice' | 'Cross Splice' | 'Cut / Dead';
export type GisPortStatus = 'ACTIVE' | 'FREE' | 'FAULTY';
export type SplitterUtilizationType =
  | 'CLIENT_ONT'
  | 'DOWNSTREAM_AREA_FEED'
  | 'CASCADED_SPLITTER'
  | 'FREE_PORT'
  | 'FAULTY';

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

export type GisCoreLedgerStatus = 'ACTIVE' | 'SPARE' | 'RESERVED' | 'FAULTY';
export type GisCableTypeCode = 'DROP' | '2C' | '4C' | '6C' | '8C' | '12C' | '24C' | '48C';

export interface GisCoreEntry {
  coreNumber: number;
  tubeNumber: number;
  tubeColorName: string;
  tubeColorHex: string;
  coreColorName: string;
  coreColorHex: string;
  status: GisCoreStatus;
  core_status?: GisCoreLedgerStatus;
  usage_type?: GisCoreUsageType;
  origin_olt_id?: string | null;
  origin_pon_port_id?: string | null;
  origin_olt_label?: string;
  source_signal?: string;
  assigned_splitter_node_id?: string | null;
  forwarded_to_area?: string;
  destination_target?: string;
  optical_power_dbm?: string;
  remarks?: string;
  destinationNote?: string;
  assignedNodeId?: string | null;
}

export type OltPonMode = 'GPON' | 'EPON';
export type OltSfpClass = 'B+' | 'C+' | 'C++' | 'C+++' | 'CUSTOM';
export type OltPonPortStatus = 'ACTIVE' | 'SPARE' | 'FAULT';

export interface SupabaseGisOlt {
  id: string;
  name: string;
  vendor_model?: string | null;
  pon_mode: OltPonMode;
  total_pon_ports: 2 | 4 | 8 | 16;
  mgmt_ip?: string | null;
  area_name?: string | null;
  lat?: number | null;
  lng?: number | null;
  status: 'ONLINE' | 'OFFLINE';
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface SupabaseGisOltPonPort {
  id: string;
  olt_id: string;
  port_number: number;
  port_label?: string | null;
  sfp_class: OltSfpClass;
  tx_power_dbm: number;
  max_onu_limit: number;
  active_onus: number;
  status: OltPonPortStatus;
  updated_at?: string;
}

export interface GisEquipmentHistoryEntry {
  id: string;
  timestamp: string;
  actor: string;
  previous_type: GisNodeType | string;
  previous_label: string;
  previous_ports: number;
  previous_splitter: string;
  new_type: GisNodeType | string;
  new_label: string;
  new_ports: number;
  new_splitter: string;
  reason: string;
  deducted_inventory_item?: string | null;
  returned_inventory_item?: string | null;
  summary: string;
}

export type InternalSplitterInputType = 'INCOMING_CORE' | 'INTERNAL_SPLITTER_LEG';
export type InternalSplitterLegStatus =
  | 'FREE'
  | 'SUBSCRIBER_DROP'
  | 'INTERNAL_CASCADE'
  | 'OUTGOING_CABLE_FEED'
  | 'FAULTY';

export interface InternalSplitterLeg {
  legNumber: number;
  legLabel: string;
  status: InternalSplitterLegStatus;
  subscriber_id?: string | null;
  subscriber_username?: string | null;
  client_label?: string | null;
  target_splitter_id?: string | null;
  target_cable_id?: string | null;
  target_core_number?: number | null;
  target_node_name?: string | null;
  drop_distance_m?: number;
  calculated_output_dbm?: number | null;
}

export interface InternalSplitterUnit {
  id: string;
  label: string;
  splitter_type: GisSplitterType;
  input_source_type: InternalSplitterInputType;
  incoming_cable_id?: string | null;
  incoming_core_number?: number | null;
  parent_splitter_id?: string | null;
  parent_splitter_leg?: number | null;
  calculated_input_dbm?: number | null;
  calculated_output_dbm?: number | null;
  calculated_thru_dbm?: number | null;
  legs: InternalSplitterLeg[];
}

export type CoreSpliceAction =
  | 'FEED_INTERNAL_SPLITTER'
  | 'PASS_THROUGH_JOINT'
  | 'RESERVED_LOCKED'
  | 'SPARE_DARK';

export interface EnclosureCoreSpliceEntry {
  id: string;
  incoming_cable_id: string;
  incoming_core_number: number;
  action: CoreSpliceAction;
  source_olt_id?: string | null;
  source_pon_port_id?: string | null;
  source_pon_label?: string | null;
  source_tx_dbm?: number | null;
  locked_reserved?: boolean;
  forwarded_to_node_id?: string | null;
  forwarded_to_area?: string | null;
  target_splitter_id?: string | null;
  outgoing_cable_id?: string | null;
  outgoing_core_number?: number | null;
  splice_loss_db?: number;
  note?: string;
  calculated_in_dbm?: number | null;
  calculated_out_dbm?: number | null;
}

export interface SupabaseGisNode {
  id: string;
  node_type: GisNodeType;
  olt_id?: string | null;
  pon_port_id?: string | null;
  name: string;
  area_name?: string | null;
  lat: number;
  lng: number;
  tx_power_dbm: number;
  splitter_category?: GisSplitterCategory;
  splitter_type: GisSplitterType;
  total_ports: number;
  box_capacity?: number;
  feed_cable_id?: string | null;
  feed_core_number?: number | null;
  feed_core_pair?: string | null;
  calculated_input_dbm?: number | null;
  calculated_output_dbm?: number | null;
  calculated_ont_rx_dbm?: number | null;
  tray_capacity: number;
  loss_per_splice: number;
  splice_tray_json: GisSpliceEntry[];
  internal_splitters?: InternalSplitterUnit[];
  core_splices?: EnclosureCoreSpliceEntry[];
  equipment_history?: GisEquipmentHistoryEntry[];
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
  source_olt_id?: string | null;
  source_pon_port_id?: string | null;
  cable_type?: GisCableTypeCode | string;
  cable_cores: 1 | 2 | 4 | 6 | 8 | 12 | 24 | 48;
  distance_meters: number;
  route_coordinates_json: GisLatLng[];
  cores_tia598_json: GisCoreEntry[];
  cores_allocation_json?: GisCoreEntry[];
  notes?: string | null;
  updated_by?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface SupabaseFiberNode {
  id: string;
  node_type: 'OLT' | 'FDB' | 'FAT' | 'JOINT_CLOSURE' | 'POLE';
  name: string;
  lat: number;
  lng: number;
  pon_ports: number;
  box_capacity?: number;
  optical_power_dbm?: number | null;
  address_note?: string | null;
  internal_splitters?: InternalSplitterUnit[];
  core_splices?: EnclosureCoreSpliceEntry[];
  equipment_history?: GisEquipmentHistoryEntry[];
  created_at?: string;
}

export interface SupabaseFiberRoute {
  id: string;
  cable_name: string;
  cable_type: GisCableTypeCode | string;
  core_count: number;
  length_meters: number;
  start_node_id: string;
  start_node_name: string;
  end_node_id: string;
  end_node_name: string;
  waypoints: GisLatLng[];
  core_allocations: GisCoreEntry[];
  notes?: string | null;
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
  rx_power_dbm?: number | null;
  status: GisPortStatus;
  updated_at?: string;
}

export interface SupabaseGisSplitterOutput {
  id: string;
  node_id: string;
  port_number: number;
  leg_label?: string | null;
  utilization_type: SplitterUtilizationType;
  subscriber_id?: string | null;
  subscriber_username?: string | null;
  client_name_manual?: string | null;
  target_area_or_node?: string | null;
  drop_distance_m: number;
  estimated_rx_dbm?: number | null;
  updated_at?: string;
}

// ============================================================================
// ERP UPGRADE: FIELD AGENT COMMISSIONS, HARDWARE INVENTORY & VENDOR LEDGER
// ============================================================================
export type AgentCommissionStatus = 'UNPAID' | 'PAID';

export interface SupabaseAgentCommission {
  id: string;
  agent_id: string;
  agent_name: string;
  subscriber_id?: string | null;
  subscriber_username: string;
  client_name: string;
  package_name: string;
  commission_amount: number;
  status: AgentCommissionStatus;
  paid_at?: string | null;
  ledger_entry_id?: string | null;
  notes?: string | null;
  created_at?: string;
}

export type InventoryItemCategory =
  | 'ROUTER_ONT'
  | 'PATCH_CORD'
  | 'FDB_SPLITTER'
  | 'CAT6_CABLE'
  | 'FIBER_CABLE'
  | 'ACCESSORY';

export interface SupabaseInventoryItem {
  id: string;
  item_name: string;
  category: InventoryItemCategory | string;
  unit: string;
  avg_purchase_cost: number;
  default_sale_price: number;
  stock_qty: number;
  low_stock_alert: number;
  updated_at?: string;
}

export interface SupabaseVendor {
  id: string;
  vendor_name: string;
  company_name?: string | null;
  phone?: string | null;
  total_purchased: number;
  total_paid: number;
  balance_payable: number;
  created_at?: string;
}

export type VendorTransactionType = 'PURCHASE_BILL' | 'PAYMENT_PAID' | 'ADJUSTMENT';

export interface SupabaseVendorTransaction {
  id: string;
  vendor_id: string;
  tx_type: VendorTransactionType | string;
  amount: number;
  reference_note?: string | null;
  tx_date: string;
}

export type InventoryPurchasePaymentStatus = 'PAID' | 'CREDIT_PAYABLE' | 'PARTIAL';

export interface SupabaseInventoryPurchase {
  id: string;
  item_id: string;
  item_name: string;
  vendor_id?: string | null;
  vendor_name?: string | null;
  qty: number;
  unit_cost: number;
  total_cost: number;
  payment_status: InventoryPurchasePaymentStatus;
  amount_paid: number;
  purchase_date: string;
  notes?: string | null;
}

export type InventorySalePaymentStatus = 'PAID' | 'UNPAID_BILLED';

export interface SupabaseInventorySale {
  id: string;
  item_id: string;
  item_name: string;
  subscriber_username?: string | null;
  customer_name?: string | null;
  sold_by_agent?: string | null;
  qty: number;
  unit_cost_snapshot: number;
  unit_sale_price: number;
  total_sale: number;
  net_profit: number;
  payment_status: InventorySalePaymentStatus;
  sale_date: string;
  notes?: string | null;
}





