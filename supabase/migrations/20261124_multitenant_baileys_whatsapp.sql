-- Multi-Tenant Baileys WhatsApp Gateway & Reseller Branding Migration
-- Run this SQL in your Supabase SQL Editor

ALTER TABLE public.portal_users
  ADD COLUMN IF NOT EXISTS company_name TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_status TEXT DEFAULT 'DISCONNECTED',
  ADD COLUMN IF NOT EXISTS whatsapp_phone TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_auto_send BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS whatsapp_support_phone TEXT,
  ADD COLUMN IF NOT EXISTS allow_subdealer_whatsapp BOOLEAN DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS public.whatsapp_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_portal_user_id TEXT,
  sender_company_name TEXT NOT NULL DEFAULT 'Youth Net Service',
  sender_phone TEXT,
  sender_tier TEXT DEFAULT 'ADMIN',
  subscriber_id TEXT,
  subscriber_username TEXT,
  recipient_phone TEXT NOT NULL,
  dealer_id TEXT,
  sub_dealer_id TEXT,
  event_type TEXT NOT NULL,
  message_body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'SENT',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_created_at ON public.whatsapp_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_dealer_id ON public.whatsapp_logs (dealer_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_sub_dealer_id ON public.whatsapp_logs (sub_dealer_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_sender_id ON public.whatsapp_logs (sender_portal_user_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_event_user ON public.whatsapp_logs (event_type, subscriber_username, created_at DESC);

ALTER TABLE public.whatsapp_logs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'whatsapp_logs' AND policyname = 'Allow authenticated full access to whatsapp_logs'
  ) THEN
    CREATE POLICY "Allow authenticated full access to whatsapp_logs"
      ON public.whatsapp_logs
      FOR ALL
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

GRANT ALL ON public.whatsapp_logs TO anon, authenticated, service_role;
