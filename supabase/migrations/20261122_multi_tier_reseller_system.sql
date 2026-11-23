-- Multi-Tier Dealer & Sub-Dealer Reseller System Migration
-- Master ISP -> Dealer -> Sub-Dealer -> Subscriber
-- Idempotent migration safe to run multiple times in Supabase SQL Editor.

-- 1. Extend portal_users with reseller hierarchy, wallet, limits, and subscriber ownership
ALTER TABLE public.portal_users
  ADD COLUMN IF NOT EXISTS tier_level TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS parent_dealer_id UUID REFERENCES public.portal_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS dealer_id UUID REFERENCES public.portal_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sub_dealer_id UUID REFERENCES public.portal_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by_id UUID REFERENCES public.portal_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS wallet_balance NUMERIC(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit_limit NUMERIC(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bandwidth_pool_cap_mbps INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS assigned_pool_mbps INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_active_users INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS can_create_subdealers BOOLEAN NOT NULL DEFAULT false;

-- Allow DEALER and SUB_DEALER roles if an older role CHECK constraint exists
DO $$
DECLARE
  constraint_rec RECORD;
BEGIN
  FOR constraint_rec IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.portal_users'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE public.portal_users DROP CONSTRAINT IF EXISTS %I', constraint_rec.conname);
  END LOOP;
END $$;

ALTER TABLE public.portal_users
  ADD CONSTRAINT portal_users_role_check
  CHECK (UPPER(role) IN ('ADMIN', 'MANAGER', 'AGENT', 'CLIENT', 'DEALER', 'SUB_DEALER', 'TECHNICIAN', 'FIELD_AGENT', 'RECOVERY', 'NOC', 'NOC_OPERATOR'));

-- Optional dealer_id ownership index on invoices for fast dealer-scoped billing queries
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS dealer_id UUID REFERENCES public.portal_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sub_dealer_id UUID REFERENCES public.portal_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by_id UUID REFERENCES public.portal_users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_portal_users_tier_level ON public.portal_users (tier_level);
CREATE INDEX IF NOT EXISTS idx_portal_users_parent_dealer_id ON public.portal_users (parent_dealer_id);
CREATE INDEX IF NOT EXISTS idx_portal_users_dealer_id ON public.portal_users (dealer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_dealer_id ON public.invoices (dealer_id);

-- 2. Wholesale vs Retail Package Tariff Matrix per Dealer / Sub-Dealer & MikroTik Profile
CREATE TABLE IF NOT EXISTS public.reseller_tariffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reseller_id UUID NOT NULL REFERENCES public.portal_users(id) ON DELETE CASCADE,
  profile_name TEXT NOT NULL,
  wholesale_price NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (wholesale_price >= 0),
  retail_price NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (retail_price >= 0),
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (reseller_id, profile_name)
);

CREATE INDEX IF NOT EXISTS idx_reseller_tariffs_reseller_id ON public.reseller_tariffs (reseller_id);
CREATE INDEX IF NOT EXISTS idx_reseller_tariffs_profile_name ON public.reseller_tariffs (profile_name);

-- 3. Immutable Reseller Prepaid Wallet Transaction Ledger
CREATE TABLE IF NOT EXISTS public.reseller_wallet_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reseller_id UUID NOT NULL REFERENCES public.portal_users(id) ON DELETE CASCADE,
  reseller_name TEXT,
  reseller_username TEXT,
  tx_type TEXT NOT NULL CHECK (
    tx_type IN (
      'RECHARGE',
      'SUBDEALER_TRANSFER',
      'USER_ACTIVATION',
      'RENEWAL_DEDUCTION',
      'REFUND',
      'ADJUSTMENT'
    )
  ),
  amount NUMERIC(12, 2) NOT NULL,
  balance_before NUMERIC(12, 2),
  balance_after NUMERIC(12, 2) NOT NULL,
  subscriber_username TEXT,
  profile_name TEXT,
  counterparty_reseller_id UUID REFERENCES public.portal_users(id) ON DELETE SET NULL,
  performed_by TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reseller_wallet_ledger_reseller_id ON public.reseller_wallet_ledger (reseller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reseller_wallet_ledger_tx_type ON public.reseller_wallet_ledger (tx_type);
CREATE INDEX IF NOT EXISTS idx_reseller_wallet_ledger_created_at ON public.reseller_wallet_ledger (created_at DESC);
