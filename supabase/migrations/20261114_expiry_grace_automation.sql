-- ============================================================================
-- Youth Net Service NOC - Persistent Supabase Schema for Automated Expiry,
-- 2:00 PM PKT Cut-Off, 24h Grace Period & Instant Restore Engine (16.16.16.0/24)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Single-Row Persistent Config Table: isp_billing_settings
CREATE TABLE IF NOT EXISTS public.isp_billing_settings (
    id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    expiry_ppp_profile TEXT NOT NULL DEFAULT 'EXPIRED-16-POOL',
    suspension_mode TEXT NOT NULL DEFAULT 'EXPIRED_PROFILE'
        CHECK (suspension_mode IN ('EXPIRED_PROFILE', 'DISABLE_SECRET')),
    grace_hours INT NOT NULL DEFAULT 24 CHECK (grace_hours >= 0 AND grace_hours <= 720),
    cutoff_time_pkt TEXT NOT NULL DEFAULT '14:00',
    jazzcash_title TEXT DEFAULT '',
    jazzcash_number TEXT DEFAULT '',
    easypaisa_title TEXT DEFAULT '',
    easypaisa_number TEXT DEFAULT '',
    bank_name TEXT DEFAULT '',
    bank_account_title TEXT DEFAULT '',
    bank_iban TEXT DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.isp_billing_settings (
    id,
    expiry_ppp_profile,
    suspension_mode,
    grace_hours,
    cutoff_time_pkt
) VALUES (
    1,
    'EXPIRED-16-POOL',
    'EXPIRED_PROFILE',
    24,
    '14:00'
) ON CONFLICT (id) DO NOTHING;

-- 2. Subscribers (portal_users + optional subscribers compatibility table/view)
ALTER TABLE public.portal_users
    ADD COLUMN IF NOT EXISTS expiry_date TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS original_package_profile TEXT,
    ADD COLUMN IF NOT EXISTS billing_status TEXT DEFAULT 'ACTIVE',
    ADD COLUMN IF NOT EXISTS grace_ends_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_reminder_cycle TEXT,
    ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_restored_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_portal_users_role_billing_status
    ON public.portal_users (role, billing_status);
CREATE INDEX IF NOT EXISTS idx_portal_users_expiry_date
    ON public.portal_users (expiry_date);
CREATE INDEX IF NOT EXISTS idx_portal_users_grace_ends_at
    ON public.portal_users (grace_ends_at);
CREATE INDEX IF NOT EXISTS idx_portal_users_username_lower
    ON public.portal_users (LOWER(username));

DO $$
BEGIN
    IF to_regclass('public.subscribers') IS NULL THEN
        EXECUTE 'CREATE VIEW public.subscribers AS SELECT * FROM public.portal_users WHERE role = ''CLIENT''';
    ELSE
        EXECUTE 'ALTER TABLE public.subscribers
            ADD COLUMN IF NOT EXISTS expiry_date TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS original_package_profile TEXT,
            ADD COLUMN IF NOT EXISTS billing_status TEXT DEFAULT ''ACTIVE'',
            ADD COLUMN IF NOT EXISTS grace_ends_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS last_reminder_cycle TEXT,
            ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS last_restored_at TIMESTAMPTZ';
    END IF;
END $$;

-- 3. Permanent History Table: expiry_audit_logs
CREATE TABLE IF NOT EXISTS public.expiry_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscriber_id UUID,
    username TEXT NOT NULL,
    action_type TEXT NOT NULL CHECK (
        action_type IN (
            'REMINDER_3D',
            'ENTERED_GRACE',
            'SUSPENDED_16_POOL',
            'DISABLED_SECRET',
            'RESTORED_ON_PAYMENT',
            'GRACE_EXTENDED'
        )
    ),
    previous_profile TEXT,
    applied_profile TEXT,
    triggered_by TEXT NOT NULL CHECK (
        triggered_by IN ('CRON_2PM', 'ADMIN', 'AGENT_PAYMENT_SYNC')
    ),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expiry_audit_logs_username
    ON public.expiry_audit_logs (username);
CREATE INDEX IF NOT EXISTS idx_expiry_audit_logs_action_type
    ON public.expiry_audit_logs (action_type);
CREATE INDEX IF NOT EXISTS idx_expiry_audit_logs_created_at
    ON public.expiry_audit_logs (created_at DESC);

-- 4. Persistent Dispatch Ledger: whatsapp_reminder_logs
CREATE TABLE IF NOT EXISTS public.whatsapp_reminder_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscriber_id UUID,
    username TEXT NOT NULL,
    phone TEXT,
    message_body TEXT NOT NULL,
    amount_due NUMERIC(12, 2) NOT NULL DEFAULT 0,
    expiry_date TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'SENT', 'FAILED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_reminder_logs_username
    ON public.whatsapp_reminder_logs (username);
CREATE INDEX IF NOT EXISTS idx_whatsapp_reminder_logs_status
    ON public.whatsapp_reminder_logs (status);
CREATE INDEX IF NOT EXISTS idx_whatsapp_reminder_logs_created_at
    ON public.whatsapp_reminder_logs (created_at DESC);

-- 5. Enable Row Level Security (RLS) & Policies
ALTER TABLE public.isp_billing_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expiry_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_reminder_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow full access to isp_billing_settings" ON public.isp_billing_settings;
CREATE POLICY "Allow full access to isp_billing_settings"
    ON public.isp_billing_settings FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow full access to expiry_audit_logs" ON public.expiry_audit_logs;
CREATE POLICY "Allow full access to expiry_audit_logs"
    ON public.expiry_audit_logs FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow full access to whatsapp_reminder_logs" ON public.whatsapp_reminder_logs;
CREATE POLICY "Allow full access to whatsapp_reminder_logs"
    ON public.whatsapp_reminder_logs FOR ALL USING (true) WITH CHECK (true);
