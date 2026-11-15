-- Youth Net Service NOC: Multi-Device MikroTik Router Registry Sync
-- Syncs all BNG/BRAS routers and credentials across Desktop & Mobile sessions

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS public.mikrotik_routers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER NOT NULL DEFAULT 81,
    username TEXT NOT NULL DEFAULT 'admin',
    password TEXT NOT NULL DEFAULT '',
    use_ssl BOOLEAN NOT NULL DEFAULT false,
    is_default BOOLEAN NOT NULL DEFAULT false,
    model TEXT DEFAULT 'MikroTik CCR2004-16G-2S+',
    version TEXT DEFAULT 'RouterOS v7.16.2',
    location TEXT DEFAULT 'Saddar Core NOC',
    wan_interface TEXT DEFAULT 'WAN3',
    walled_garden_pool TEXT DEFAULT '16.16.16.0/24',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE IF EXISTS public.mikrotik_routers
    ADD COLUMN IF NOT EXISTS host TEXT;
ALTER TABLE IF EXISTS public.mikrotik_routers
    ADD COLUMN IF NOT EXISTS port INTEGER NOT NULL DEFAULT 81;
ALTER TABLE IF EXISTS public.mikrotik_routers
    ADD COLUMN IF NOT EXISTS username TEXT NOT NULL DEFAULT 'admin';
ALTER TABLE IF EXISTS public.mikrotik_routers
    ADD COLUMN IF NOT EXISTS password TEXT NOT NULL DEFAULT '';
ALTER TABLE IF EXISTS public.mikrotik_routers
    ADD COLUMN IF NOT EXISTS use_ssl BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE IF EXISTS public.mikrotik_routers
    ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE IF EXISTS public.mikrotik_routers
    ADD COLUMN IF NOT EXISTS model TEXT DEFAULT 'MikroTik CCR2004-16G-2S+';
ALTER TABLE IF EXISTS public.mikrotik_routers
    ADD COLUMN IF NOT EXISTS version TEXT DEFAULT 'RouterOS v7.16.2';
ALTER TABLE IF EXISTS public.mikrotik_routers
    ADD COLUMN IF NOT EXISTS location TEXT DEFAULT 'Saddar Core NOC';
ALTER TABLE IF EXISTS public.mikrotik_routers
    ADD COLUMN IF NOT EXISTS wan_interface TEXT DEFAULT 'WAN3';
ALTER TABLE IF EXISTS public.mikrotik_routers
    ADD COLUMN IF NOT EXISTS walled_garden_pool TEXT DEFAULT '16.16.16.0/24';
ALTER TABLE IF EXISTS public.mikrotik_routers
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_mikrotik_routers_default_updated
    ON public.mikrotik_routers (is_default DESC, updated_at DESC);

ALTER TABLE public.mikrotik_routers ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mikrotik_routers TO anon, authenticated;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'mikrotik_routers'
          AND policyname = 'mikrotik_routers_full_access'
    ) THEN
        CREATE POLICY mikrotik_routers_full_access
            ON public.mikrotik_routers
            FOR ALL
            TO anon, authenticated
            USING (true)
            WITH CHECK (true);
    END IF;
END $$;

ALTER TABLE public.mikrotik_routers REPLICA IDENTITY FULL;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime'
              AND schemaname = 'public'
              AND tablename = 'mikrotik_routers'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.mikrotik_routers;
        END IF;
    END IF;
END $$;
