-- ============================================================================
-- Migration: Field Agent Audit Ledger Columns, RLS Policies & Recovery Ledger
-- Ensures permanent PostgreSQL persistence & UPDATE + SELECT permissions
-- ============================================================================

-- 1. Optional unified recovery_ledger table (compatible with direct queries)
CREATE TABLE IF NOT EXISTS public.recovery_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NULL,
  subscriber_username TEXT NULL,
  agent_id UUID NULL,
  agent_name TEXT NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT 'Cash Handover',
  collected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  remarks TEXT NULL,
  previous_amount NUMERIC NULL,
  edited_by TEXT NULL,
  edited_at TIMESTAMPTZ NULL,
  edit_reason TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recovery_ledger_agent ON public.recovery_ledger(agent_id);
CREATE INDEX IF NOT EXISTS idx_recovery_ledger_invoice ON public.recovery_ledger(invoice_id);
CREATE INDEX IF NOT EXISTS idx_recovery_ledger_collected_at ON public.recovery_ledger(collected_at DESC);

-- 2. Add missing audit & timestamp columns to payment_transactions
ALTER TABLE IF EXISTS public.payment_transactions
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS payment_method TEXT,
  ADD COLUMN IF NOT EXISTS previous_amount NUMERIC,
  ADD COLUMN IF NOT EXISTS edited_by TEXT,
  ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS edit_reason TEXT;

-- 3. Add missing audit columns to agent_cash_transactions
ALTER TABLE IF EXISTS public.agent_cash_transactions
  ADD COLUMN IF NOT EXISTS agent_username TEXT,
  ADD COLUMN IF NOT EXISTS previous_amount NUMERIC,
  ADD COLUMN IF NOT EXISTS edited_by TEXT,
  ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS edit_reason TEXT;

-- 4. Add audit metadata columns to invoices
ALTER TABLE IF EXISTS public.invoices
  ADD COLUMN IF NOT EXISTS edited_by TEXT,
  ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;

-- 5. Enforce explicit RLS policies granting SELECT + INSERT + UPDATE + DELETE
ALTER TABLE IF EXISTS public.recovery_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_recovery_ledger" ON public.recovery_ledger;
CREATE POLICY "allow_all_recovery_ledger"
  ON public.recovery_ledger FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

ALTER TABLE IF EXISTS public.payment_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_payment_transactions" ON public.payment_transactions;
CREATE POLICY "allow_all_payment_transactions"
  ON public.payment_transactions FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

ALTER TABLE IF EXISTS public.agent_cash_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_agent_cash_transactions" ON public.agent_cash_transactions;
CREATE POLICY "allow_all_agent_cash_transactions"
  ON public.agent_cash_transactions FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

ALTER TABLE IF EXISTS public.invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_invoices" ON public.invoices;
CREATE POLICY "allow_all_invoices"
  ON public.invoices FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

ALTER TABLE IF EXISTS public.portal_users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_portal_users" ON public.portal_users;
CREATE POLICY "allow_all_portal_users"
  ON public.portal_users FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;
