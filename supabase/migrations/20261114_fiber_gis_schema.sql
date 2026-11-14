-- ============================================================================
-- Youth Net Service NOC - Full-Stack FTTH Fiber GIS, Multi-OLT (EPON/GPON),
-- End-to-End Core/Pair Traceability, PLC & FBT Ratio Splitters, FOSC Joints
-- & Subscriber Utilization Schema Migration
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Multi-OLT Registry (EPON / GPON Fleet)
CREATE TABLE IF NOT EXISTS public.gis_olts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    vendor_model TEXT DEFAULT 'VSOL V1600G1',
    pon_mode TEXT NOT NULL DEFAULT 'GPON' CHECK (pon_mode IN ('GPON', 'EPON')),
    total_pon_ports INT NOT NULL DEFAULT 8 CHECK (total_pon_ports IN (2, 4, 8, 16)),
    mgmt_ip TEXT DEFAULT '',
    area_name TEXT DEFAULT '',
    lat DOUBLE PRECISION NULL,
    lng DOUBLE PRECISION NULL,
    status TEXT NOT NULL DEFAULT 'ONLINE' CHECK (status IN ('ONLINE', 'OFFLINE')),
    notes TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gis_olts_pon_mode ON public.gis_olts (pon_mode);
CREATE INDEX IF NOT EXISTS idx_gis_olts_area_name ON public.gis_olts (area_name);

-- 2. Per-PON Port Allocation (PON 1 - PON 16, Class B+/C+/C++/C+++ up to +12 dBm)
CREATE TABLE IF NOT EXISTS public.gis_olt_pon_ports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    olt_id UUID NOT NULL REFERENCES public.gis_olts(id) ON DELETE CASCADE,
    port_number INT NOT NULL CHECK (port_number >= 1 AND port_number <= 16),
    port_label TEXT DEFAULT '',
    sfp_class TEXT NOT NULL DEFAULT 'C+' CHECK (sfp_class IN ('B+', 'C+', 'C++', 'C+++', 'CUSTOM')),
    tx_power_dbm NUMERIC(6, 2) NOT NULL DEFAULT 5.0 CHECK (tx_power_dbm >= -5 AND tx_power_dbm <= 12),
    max_onu_limit INT NOT NULL DEFAULT 128 CHECK (max_onu_limit >= 1 AND max_onu_limit <= 256),
    active_onus INT NOT NULL DEFAULT 0 CHECK (active_onus >= 0),
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SPARE', 'FAULT')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (olt_id, port_number)
);

CREATE INDEX IF NOT EXISTS idx_gis_olt_pon_ports_olt ON public.gis_olt_pon_ports (olt_id);

-- 3. GIS Nodes (OLT, Distribution Node, FOSC Joint Closure, FAT / FDB Splitter Box)
CREATE TABLE IF NOT EXISTS public.gis_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    node_type TEXT NOT NULL,
    olt_id UUID NULL REFERENCES public.gis_olts(id) ON DELETE CASCADE,
    pon_port_id UUID NULL REFERENCES public.gis_olt_pon_ports(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    area_name TEXT DEFAULT '',
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    tx_power_dbm NUMERIC(6, 2) NOT NULL DEFAULT 5.0,
    splitter_category TEXT NOT NULL DEFAULT 'NONE',
    splitter_type TEXT NOT NULL DEFAULT '1:8',
    total_ports INT NOT NULL DEFAULT 8 CHECK (total_ports >= 0 AND total_ports <= 32),
    feed_cable_id UUID NULL,
    feed_core_number INT NULL,
    feed_core_pair TEXT DEFAULT '',
    calculated_input_dbm NUMERIC(6, 2) NULL,
    calculated_output_dbm NUMERIC(6, 2) NULL,
    calculated_ont_rx_dbm NUMERIC(6, 2) NULL,
    tray_capacity INT NOT NULL DEFAULT 12 CHECK (tray_capacity >= 2 AND tray_capacity <= 48),
    loss_per_splice NUMERIC(5, 3) NOT NULL DEFAULT 0.08,
    splice_tray_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    notes TEXT DEFAULT '',
    updated_by TEXT DEFAULT 'admin',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE IF EXISTS public.gis_nodes
    ADD COLUMN IF NOT EXISTS olt_id UUID NULL REFERENCES public.gis_olts(id) ON DELETE CASCADE;
ALTER TABLE IF EXISTS public.gis_nodes
    ADD COLUMN IF NOT EXISTS pon_port_id UUID NULL REFERENCES public.gis_olt_pon_ports(id) ON DELETE SET NULL;
ALTER TABLE IF EXISTS public.gis_nodes
    ADD COLUMN IF NOT EXISTS splitter_category TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE IF EXISTS public.gis_nodes
    ADD COLUMN IF NOT EXISTS feed_core_pair TEXT DEFAULT '';
ALTER TABLE IF EXISTS public.gis_nodes
    ADD COLUMN IF NOT EXISTS calculated_output_dbm NUMERIC(6, 2) NULL;

-- Safely refresh node_type, splitter_category, and splitter_type constraints for new types
DO $$
DECLARE
    c_name TEXT;
BEGIN
    FOR c_name IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'public.gis_nodes'::regclass AND contype = 'c'
          AND (pg_get_constraintdef(oid) LIKE '%node_type%'
            OR pg_get_constraintdef(oid) LIKE '%splitter_type%'
            OR pg_get_constraintdef(oid) LIKE '%splitter_category%')
    LOOP
        EXECUTE format('ALTER TABLE public.gis_nodes DROP CONSTRAINT IF EXISTS %I', c_name);
    END LOOP;

    ALTER TABLE public.gis_nodes
        ADD CONSTRAINT gis_nodes_node_type_check
        CHECK (node_type IN ('OLT', 'DIST_NODE', 'FOSC_JOINT', 'FDB_FAT'));

    ALTER TABLE public.gis_nodes
        ADD CONSTRAINT gis_nodes_splitter_category_check
        CHECK (splitter_category IN ('NONE', 'PLC_EQUAL', 'FBT_RATIO'));

    ALTER TABLE public.gis_nodes
        ADD CONSTRAINT gis_nodes_splitter_type_check
        CHECK (splitter_type IN ('none', '1:2', '1:4', '1:8', '1:16', '1:32', '90:10', '85:15', '80:20', '70:30', '60:40', '50:50'));
END $$;

CREATE INDEX IF NOT EXISTS idx_gis_nodes_node_type ON public.gis_nodes (node_type);
CREATE INDEX IF NOT EXISTS idx_gis_nodes_area_name ON public.gis_nodes (area_name);
CREATE INDEX IF NOT EXISTS idx_gis_nodes_olt_id ON public.gis_nodes (olt_id);
CREATE INDEX IF NOT EXISTS idx_gis_nodes_pon_port_id ON public.gis_nodes (pon_port_id);

-- 4. GIS Fiber Cables (Multi-point Street Polylines + TIA-598 Cores/Pairs + OLT/PON Lineage)
CREATE TABLE IF NOT EXISTS public.gis_cables (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT DEFAULT '',
    source_node_id UUID NOT NULL REFERENCES public.gis_nodes(id) ON DELETE CASCADE,
    target_node_id UUID NOT NULL REFERENCES public.gis_nodes(id) ON DELETE CASCADE,
    source_olt_id UUID NULL REFERENCES public.gis_olts(id) ON DELETE SET NULL,
    source_pon_port_id UUID NULL REFERENCES public.gis_olt_pon_ports(id) ON DELETE SET NULL,
    cable_cores INT NOT NULL DEFAULT 12 CHECK (cable_cores IN (2, 4, 6, 8, 12, 24, 48)),
    distance_meters INT NOT NULL DEFAULT 0 CHECK (distance_meters >= 0),
    route_coordinates_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    cores_tia598_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    cores_allocation_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    notes TEXT DEFAULT '',
    updated_by TEXT DEFAULT 'admin',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE IF EXISTS public.gis_cables
    ADD COLUMN IF NOT EXISTS source_olt_id UUID NULL REFERENCES public.gis_olts(id) ON DELETE SET NULL;
ALTER TABLE IF EXISTS public.gis_cables
    ADD COLUMN IF NOT EXISTS source_pon_port_id UUID NULL REFERENCES public.gis_olt_pon_ports(id) ON DELETE SET NULL;
ALTER TABLE IF EXISTS public.gis_cables
    ADD COLUMN IF NOT EXISTS cores_allocation_json JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_gis_cables_source ON public.gis_cables (source_node_id);
CREATE INDEX IF NOT EXISTS idx_gis_cables_target ON public.gis_cables (target_node_id);
CREATE INDEX IF NOT EXISTS idx_gis_cables_source_olt ON public.gis_cables (source_olt_id);
CREATE INDEX IF NOT EXISTS idx_gis_cables_source_pon_port ON public.gis_cables (source_pon_port_id);

-- 5. GIS FDB / FAT Port Assignments Linked to Live Subscribers (portal_users)
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

CREATE INDEX IF NOT EXISTS idx_gis_fdb_ports_node ON public.gis_fdb_ports (fdb_node_id);
CREATE INDEX IF NOT EXISTS idx_gis_fdb_ports_subscriber ON public.gis_fdb_ports (subscriber_id);
CREATE INDEX IF NOT EXISTS idx_gis_fdb_ports_username ON public.gis_fdb_ports (LOWER(subscriber_username));

-- 6. GIS Splitter Outputs (Full PLC Port & FBT Ratio Leg Utilization Tracking)
CREATE TABLE IF NOT EXISTS public.gis_splitter_outputs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    node_id UUID NOT NULL REFERENCES public.gis_nodes(id) ON DELETE CASCADE,
    port_number INT NOT NULL CHECK (port_number >= 1 AND port_number <= 32),
    leg_label TEXT DEFAULT '',
    utilization_type TEXT NOT NULL DEFAULT 'FREE_PORT' CHECK (
        utilization_type IN ('CLIENT_ONT', 'DOWNSTREAM_AREA_FEED', 'CASCADED_SPLITTER', 'FREE_PORT', 'FAULTY')
    ),
    subscriber_id UUID NULL REFERENCES public.portal_users(id) ON DELETE SET NULL,
    subscriber_username TEXT DEFAULT '',
    client_name_manual TEXT DEFAULT '',
    target_area_or_node TEXT DEFAULT '',
    drop_distance_m INT NOT NULL DEFAULT 30 CHECK (drop_distance_m >= 0),
    estimated_rx_dbm NUMERIC(6, 2) NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (node_id, port_number)
);

CREATE INDEX IF NOT EXISTS idx_gis_splitter_outputs_node ON public.gis_splitter_outputs (node_id);
CREATE INDEX IF NOT EXISTS idx_gis_splitter_outputs_sub ON public.gis_splitter_outputs (subscriber_id);

-- 7. Row Level Security & Explicit Policies (NOC + Field Agent Portal Sync)
ALTER TABLE public.gis_olts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gis_olt_pon_ports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gis_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gis_cables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gis_fdb_ports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gis_splitter_outputs ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.gis_olts TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gis_olt_pon_ports TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gis_nodes TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gis_cables TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gis_fdb_ports TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gis_splitter_outputs TO anon, authenticated;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='gis_olts' AND policyname='gis_olts_full_access') THEN
        CREATE POLICY gis_olts_full_access ON public.gis_olts FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='gis_olt_pon_ports' AND policyname='gis_olt_pon_ports_full_access') THEN
        CREATE POLICY gis_olt_pon_ports_full_access ON public.gis_olt_pon_ports FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='gis_nodes' AND policyname='gis_nodes_full_access') THEN
        CREATE POLICY gis_nodes_full_access ON public.gis_nodes FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='gis_cables' AND policyname='gis_cables_full_access') THEN
        CREATE POLICY gis_cables_full_access ON public.gis_cables FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='gis_fdb_ports' AND policyname='gis_fdb_ports_full_access') THEN
        CREATE POLICY gis_fdb_ports_full_access ON public.gis_fdb_ports FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='gis_splitter_outputs' AND policyname='gis_splitter_outputs_full_access') THEN
        CREATE POLICY gis_splitter_outputs_full_access ON public.gis_splitter_outputs FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
    END IF;
END $$;

-- 8. Supabase Realtime Publication & Replica Identity (Live Multi-User NOC + Field Sync)
ALTER TABLE public.gis_olts REPLICA IDENTITY FULL;
ALTER TABLE public.gis_olt_pon_ports REPLICA IDENTITY FULL;
ALTER TABLE public.gis_nodes REPLICA IDENTITY FULL;
ALTER TABLE public.gis_cables REPLICA IDENTITY FULL;
ALTER TABLE public.gis_fdb_ports REPLICA IDENTITY FULL;
ALTER TABLE public.gis_splitter_outputs REPLICA IDENTITY FULL;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'gis_olts') THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.gis_olts;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'gis_olt_pon_ports') THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.gis_olt_pon_ports;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'gis_nodes') THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.gis_nodes;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'gis_cables') THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.gis_cables;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'gis_fdb_ports') THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.gis_fdb_ports;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'gis_splitter_outputs') THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.gis_splitter_outputs;
        END IF;
    END IF;
END $$;
