export const FIBER_GIS_MIGRATION_SQL = `-- Youth Net Service NOC: Full-Stack FTTH Fiber GIS, FOSC Joint Closure & Subscriber Map
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

ALTER TABLE IF EXISTS public.isp_billing_settings
    ADD COLUMN IF NOT EXISTS google_maps_api_key TEXT DEFAULT '';

ALTER TABLE IF EXISTS public.whatsapp_billing_config
    ADD COLUMN IF NOT EXISTS google_maps_api_key TEXT DEFAULT '';

CREATE TABLE IF NOT EXISTS public.gis_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    node_type TEXT NOT NULL CHECK (node_type IN ('OLT', 'FOSC_JOINT', 'FDB_FAT')),
    name TEXT NOT NULL,
    area_name TEXT DEFAULT '',
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    tx_power_dbm NUMERIC(6, 2) NOT NULL DEFAULT 5.0,
    splitter_type TEXT NOT NULL DEFAULT '1:8' CHECK (
        splitter_type IN ('none', '1:2', '1:4', '1:8', '1:16', '1:32', '90:10', '80:20', '70:30')
    ),
    total_ports INT NOT NULL DEFAULT 8 CHECK (total_ports >= 0 AND total_ports <= 32),
    feed_cable_id UUID NULL,
    feed_core_number INT NULL,
    calculated_input_dbm NUMERIC(6, 2) NULL,
    calculated_ont_rx_dbm NUMERIC(6, 2) NULL,
    tray_capacity INT NOT NULL DEFAULT 12 CHECK (tray_capacity >= 2 AND tray_capacity <= 48),
    loss_per_splice NUMERIC(5, 3) NOT NULL DEFAULT 0.08,
    splice_tray_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    notes TEXT DEFAULT '',
    updated_by TEXT DEFAULT 'admin',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.gis_cables (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT DEFAULT '',
    source_node_id UUID NOT NULL REFERENCES public.gis_nodes(id) ON DELETE CASCADE,
    target_node_id UUID NOT NULL REFERENCES public.gis_nodes(id) ON DELETE CASCADE,
    cable_cores INT NOT NULL DEFAULT 12 CHECK (cable_cores IN (2, 4, 6, 8, 12, 24, 48)),
    distance_meters INT NOT NULL DEFAULT 0 CHECK (distance_meters >= 0),
    route_coordinates_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    cores_tia598_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    notes TEXT DEFAULT '',
    updated_by TEXT DEFAULT 'admin',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.gis_fdb_ports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fdb_node_id UUID NOT NULL REFERENCES public.gis_nodes(id) ON DELETE CASCADE,
    port_number INT NOT NULL CHECK (port_number >= 1 AND port_number <= 32),
    subscriber_id UUID NULL REFERENCES public.portal_users(id) ON DELETE SET NULL,
    subscriber_username TEXT DEFAULT '',
    client_label TEXT DEFAULT '',
    drop_cable_meters INT NOT NULL DEFAULT 30 CHECK (drop_cable_meters >= 0),
    status TEXT NOT NULL DEFAULT 'FREE' CHECK (status IN ('ACTIVE', 'FREE', 'FAULTY')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (fdb_node_id, port_number)
);

CREATE INDEX IF NOT EXISTS idx_gis_nodes_node_type ON public.gis_nodes (node_type);
CREATE INDEX IF NOT EXISTS idx_gis_cables_source ON public.gis_cables (source_node_id);
CREATE INDEX IF NOT EXISTS idx_gis_cables_target ON public.gis_cables (target_node_id);
CREATE INDEX IF NOT EXISTS idx_gis_fdb_ports_node ON public.gis_fdb_ports (fdb_node_id);
CREATE INDEX IF NOT EXISTS idx_gis_fdb_ports_subscriber ON public.gis_fdb_ports (subscriber_id);

ALTER TABLE public.gis_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gis_cables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gis_fdb_ports ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.gis_nodes TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gis_cables TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gis_fdb_ports TO anon, authenticated;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='gis_nodes' AND policyname='gis_nodes_full_access') THEN
        CREATE POLICY gis_nodes_full_access ON public.gis_nodes FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='gis_cables' AND policyname='gis_cables_full_access') THEN
        CREATE POLICY gis_cables_full_access ON public.gis_cables FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='gis_fdb_ports' AND policyname='gis_fdb_ports_full_access') THEN
        CREATE POLICY gis_fdb_ports_full_access ON public.gis_fdb_ports FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
    END IF;
END $$;

ALTER TABLE public.gis_nodes REPLICA IDENTITY FULL;
ALTER TABLE public.gis_cables REPLICA IDENTITY FULL;
ALTER TABLE public.gis_fdb_ports REPLICA IDENTITY FULL;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'gis_nodes') THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.gis_nodes;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'gis_cables') THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.gis_cables;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'gis_fdb_ports') THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.gis_fdb_ports;
        END IF;
    END IF;
END $$;
`;
