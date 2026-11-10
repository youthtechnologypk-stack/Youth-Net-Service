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
  ip_address?: string | null;
  mac_address?: string | null;
  uptime_duration?: string | null;
  bytes_in: number;
  bytes_out: number;
  disconnect_reason?: string | null;
  connected_at?: string | null;
  disconnected_at: string;
}
