export const ERP_MIGRATION_SQL = `-- Youth Net Service ERP Upgrade:
-- 1. Field Agent New-Connection Commission Tracker (agent_commissions)
-- 2. Complete ISP Hardware Inventory, Purchases, Sales & Vendor Payables Ledger
-- Run once in Supabase SQL Editor. Fully idempotent and safe to re-run.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. FIELD AGENT NEW-CONNECTION COMMISSIONS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.agent_commissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES public.portal_users(id) ON DELETE CASCADE,
    agent_name TEXT NOT NULL DEFAULT '',
    subscriber_id UUID NULL,
    subscriber_username TEXT DEFAULT '',
    client_name TEXT DEFAULT '',
    package_name TEXT DEFAULT '',
    commission_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'UNPAID' CHECK (status IN ('UNPAID', 'PAID')),
    paid_at TIMESTAMPTZ NULL,
    ledger_entry_id UUID NULL,
    notes TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 2. ISP HARDWARE INVENTORY ITEMS CATALOG
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.inventory_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'ROUTER_ONT',
    unit TEXT NOT NULL DEFAULT 'pcs',
    avg_purchase_cost NUMERIC(12, 2) NOT NULL DEFAULT 0,
    default_sale_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
    stock_qty NUMERIC(12, 2) NOT NULL DEFAULT 0,
    low_stock_alert NUMERIC(12, 2) NOT NULL DEFAULT 5,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 3. SUPPLIERS / VENDORS & VENDOR TRANSACTIONS LEDGER
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.vendors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_name TEXT NOT NULL,
    company_name TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    total_purchased NUMERIC(14, 2) NOT NULL DEFAULT 0,
    total_paid NUMERIC(14, 2) NOT NULL DEFAULT 0,
    balance_payable NUMERIC(14, 2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.vendor_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_id UUID NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
    tx_type TEXT NOT NULL CHECK (tx_type IN ('PURCHASE_BILL', 'PAYMENT_PAID', 'ADJUSTMENT')),
    amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
    reference_note TEXT DEFAULT '',
    tx_date TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 4. INVENTORY PURCHASES (STOCK IN)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.inventory_purchases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
    item_name TEXT NOT NULL,
    vendor_id UUID NULL REFERENCES public.vendors(id) ON DELETE SET NULL,
    vendor_name TEXT DEFAULT '',
    qty NUMERIC(12, 2) NOT NULL DEFAULT 1,
    unit_cost NUMERIC(12, 2) NOT NULL DEFAULT 0,
    total_cost NUMERIC(14, 2) NOT NULL DEFAULT 0,
    payment_status TEXT NOT NULL DEFAULT 'PAID' CHECK (payment_status IN ('PAID', 'CREDIT_PAYABLE', 'PARTIAL')),
    amount_paid NUMERIC(14, 2) NOT NULL DEFAULT 0,
    purchase_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notes TEXT DEFAULT ''
);

-- ============================================================================
-- 5. INVENTORY SALES (CLIENT / WALK-IN HARDWARE SALE)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.inventory_sales (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
    item_name TEXT NOT NULL,
    subscriber_username TEXT DEFAULT '',
    customer_name TEXT DEFAULT '',
    sold_by_agent TEXT DEFAULT '',
    qty NUMERIC(12, 2) NOT NULL DEFAULT 1,
    unit_cost_snapshot NUMERIC(12, 2) NOT NULL DEFAULT 0,
    unit_sale_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
    total_sale NUMERIC(14, 2) NOT NULL DEFAULT 0,
    net_profit NUMERIC(14, 2) NOT NULL DEFAULT 0,
    payment_status TEXT NOT NULL DEFAULT 'PAID' CHECK (payment_status IN ('PAID', 'UNPAID_BILLED')),
    sale_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notes TEXT DEFAULT ''
);

-- Ensure isp_expenses exists (for commission & vendor expense ledger posting)
CREATE TABLE IF NOT EXISTS public.isp_expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    expense_category TEXT NOT NULL DEFAULT 'OTHER',
    title TEXT NOT NULL,
    amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    payment_method TEXT NOT NULL DEFAULT 'CASH',
    expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
    notes TEXT NULL,
    recorded_by TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 6. INDEXES FOR FAST QUERIES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_agent_commissions_agent ON public.agent_commissions (agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_commissions_status ON public.agent_commissions (status);
CREATE INDEX IF NOT EXISTS idx_inventory_items_category ON public.inventory_items (category);
CREATE INDEX IF NOT EXISTS idx_vendor_transactions_vendor ON public.vendor_transactions (vendor_id);
CREATE INDEX IF NOT EXISTS idx_inventory_purchases_item ON public.inventory_purchases (item_id);
CREATE INDEX IF NOT EXISTS idx_inventory_purchases_vendor ON public.inventory_purchases (vendor_id);
CREATE INDEX IF NOT EXISTS idx_inventory_sales_item ON public.inventory_sales (item_id);
CREATE INDEX IF NOT EXISTS idx_inventory_sales_date ON public.inventory_sales (sale_date);

-- ============================================================================
-- 7. ROW LEVEL SECURITY, GRANTS & REALTIME PUBLICATION
-- ============================================================================
ALTER TABLE public.agent_commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.isp_expenses ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_commissions TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_items TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vendors TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vendor_transactions TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_purchases TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_sales TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.isp_expenses TO anon, authenticated;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='agent_commissions' AND policyname='agent_commissions_full_access') THEN
        CREATE POLICY agent_commissions_full_access ON public.agent_commissions FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='inventory_items' AND policyname='inventory_items_full_access') THEN
        CREATE POLICY inventory_items_full_access ON public.inventory_items FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='vendors' AND policyname='vendors_full_access') THEN
        CREATE POLICY vendors_full_access ON public.vendors FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='vendor_transactions' AND policyname='vendor_transactions_full_access') THEN
        CREATE POLICY vendor_transactions_full_access ON public.vendor_transactions FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='inventory_purchases' AND policyname='inventory_purchases_full_access') THEN
        CREATE POLICY inventory_purchases_full_access ON public.inventory_purchases FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='inventory_sales' AND policyname='inventory_sales_full_access') THEN
        CREATE POLICY inventory_sales_full_access ON public.inventory_sales FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='isp_expenses' AND policyname='isp_expenses_full_access') THEN
        CREATE POLICY isp_expenses_full_access ON public.isp_expenses FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
    END IF;
END $$;

ALTER TABLE public.agent_commissions REPLICA IDENTITY FULL;
ALTER TABLE public.inventory_items REPLICA IDENTITY FULL;
ALTER TABLE public.vendors REPLICA IDENTITY FULL;
ALTER TABLE public.vendor_transactions REPLICA IDENTITY FULL;
ALTER TABLE public.inventory_purchases REPLICA IDENTITY FULL;
ALTER TABLE public.inventory_sales REPLICA IDENTITY FULL;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'agent_commissions') THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_commissions;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'inventory_items') THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_items;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'vendors') THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.vendors;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'vendor_transactions') THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.vendor_transactions;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'inventory_purchases') THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_purchases;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'inventory_sales') THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_sales;
        END IF;
    END IF;
END $$;
`;
