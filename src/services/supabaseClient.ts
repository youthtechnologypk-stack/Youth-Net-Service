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
  base_salary?: number;
  cash_in_hand?: number;
  created_at?: string;
}

export interface SupabaseInvoice {
  id: string;
  invoice_no: string;
  subscriber_username: string;
  assigned_agent_id?: string | null;
  assigned_agent_name?: string | null;
  amount: number;
  status: 'DUE' | 'PAID';
  due_date: string;
  cycle_day: number;
  paid_at?: string | null;
  created_at?: string;
}

export interface SupabaseTicket {
  id: string;
  ticket_no: string;
  subscriber_username: string;
  assigned_agent_id?: string | null;
  issue: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  status: 'OPEN' | 'RESOLVED';
  created_at?: string;
}
