export const FIBER_GIS_MIGRATION_SQL = `-- Youth Net Service NOC: Full-Stack FTTH Fiber GIS, Multi-OLT (EPON/GPON), End-to-End Traceability & Splitter Utilization
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

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
    total_ports INT NOT NULL DEFAULT 8 CHECK (total_ports >= 0 AND total_ports <= 48),
    box_capacity INT NOT NULL DEFAULT 8 CHECK (box_capacity >= 0 AND box_capacity <= 48),
    feed_cable_id UUID NULL,
    feed_core_number INT NULL,
    feed_core_pair TEXT DEFAULT '',
    calculated_input_dbm NUMERIC(6, 2) NULL,
    calculated_output_dbm NUMERIC(6, 2) NULL,
    calculated_ont_rx_dbm NUMERIC(6, 2) NULL,
    tray_capacity INT NOT NULL DEFAULT 12 CHECK (tray_capacity >= 2 AND tray_capacity <= 48),
    loss_per_splice NUMERIC(5, 3) NOT NULL DEFAULT 0.08,
    splice_tray_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    internal_splitters JSONB NOT NULL DEFAULT '[]'::jsonb,
    core_splices JSONB NOT NULL DEFAULT '[]'::jsonb,
    equipment_history JSONB NOT NULL DEFAULT '[]'::jsonb,
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
ALTER TABLE IF EXISTS public.gis_nodes
    ADD COLUMN IF NOT EXISTS box_capacity INT NOT NULL DEFAULT 8;
ALTER TABLE IF EXISTS public.gis_nodes
    ADD COLUMN IF NOT EXISTS internal_splitters JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE IF EXISTS public.gis_nodes
    ADD COLUMN IF NOT EXISTS core_splices JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE IF EXISTS public.gis_nodes
    ADD COLUMN IF NOT EXISTS equipment_history JSONB NOT NULL DEFAULT '[]'::jsonb;

DO $$
DECLARE
    c_name TEXT;
BEGIN
    FOR c_name IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'public.gis_nodes'::regclass AND contype = 'c'
          AND (pg_get_constraintdef(oid) LIKE '%node_type%'
            OR pg_get_constraintdef(oid) LIKE '%splitter_type%'
            OR pg_get_constraintdef(oid) LIKE '%splitter_category%'
            OR pg_get_constraintdef(oid) LIKE '%total_ports%')
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

    ALTER TABLE public.gis_nodes
        ADD CONSTRAINT gis_nodes_total_ports_check
        CHECK (total_ports >= 0 AND total_ports <= 48);
END $$;

CREATE TABLE IF NOT EXISTS public.gis_cables (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT DEFAULT '',
    source_node_id UUID NOT NULL REFERENCES public.gis_nodes(id) ON DELETE CASCADE,
    target_node_id UUID NOT NULL REFERENCES public.gis_nodes(id) ON DELETE CASCADE,
    source_olt_id UUID NULL REFERENCES public.gis_olts(id) ON DELETE SET NULL,
    source_pon_port_id UUID NULL REFERENCES public.gis_olt_pon_ports(id) ON DELETE SET NULL,
    cable_type TEXT DEFAULT '12C',
    cable_cores INT NOT NULL DEFAULT 12 CHECK (cable_cores IN (1, 2, 4, 6, 8, 12, 24, 48)),
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
ALTER TABLE IF EXISTS public.gis_cables
    ADD COLUMN IF NOT EXISTS cable_type TEXT DEFAULT '12C';

DO $$
DECLARE
    c_name TEXT;
BEGIN
    FOR c_name IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'public.gis_cables'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%cable_cores%'
    LOOP
        EXECUTE format('ALTER TABLE public.gis_cables DROP CONSTRAINT IF EXISTS %I', c_name);
    END LOOP;

    ALTER TABLE public.gis_cables
        ADD CONSTRAINT gis_cables_cable_cores_check
        CHECK (cable_cores IN (1, 2, 4, 6, 8, 12, 24, 48));
END $$;

CREATE TABLE IF NOT EXISTS public.gis_fdb_ports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fdb_node_id UUID NOT NULL REFERENCES public.gis_nodes(id) ON DELETE CASCADE,
    port_number INT NOT NULL CHECK (port_number >= 1 AND port_number <= 48),
    subscriber_id UUID NULL REFERENCES public.portal_users(id) ON DELETE SET NULL,
    subscriber_username TEXT DEFAULT '',
    client_label TEXT DEFAULT '',
    drop_cable_meters INT NOT NULL DEFAULT 30 CHECK (drop_cable_meters >= 0),
    status TEXT NOT NULL DEFAULT 'FREE' CHECK (status IN ('ACTIVE', 'FREE', 'FAULTY')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (fdb_node_id, port_number)
);

CREATE TABLE IF NOT EXISTS public.gis_splitter_outputs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    node_id UUID NOT NULL REFERENCES public.gis_nodes(id) ON DELETE CASCADE,
    port_number INT NOT NULL CHECK (port_number >= 1 AND port_number <= 48),
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

DO $$
DECLARE
    c_name TEXT;
BEGIN
    FOR c_name IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'public.gis_fdb_ports'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%port_number%'
    LOOP
        EXECUTE format('ALTER TABLE public.gis_fdb_ports DROP CONSTRAINT IF EXISTS %I', c_name);
    END LOOP;
    ALTER TABLE public.gis_fdb_ports
        ADD CONSTRAINT gis_fdb_ports_port_number_check
        CHECK (port_number >= 1 AND port_number <= 48);

    FOR c_name IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'public.gis_splitter_outputs'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%port_number%'
    LOOP
        EXECUTE format('ALTER TABLE public.gis_splitter_outputs DROP CONSTRAINT IF EXISTS %I', c_name);
    END LOOP;
    ALTER TABLE public.gis_splitter_outputs
        ADD CONSTRAINT gis_splitter_outputs_port_number_check
        CHECK (port_number >= 1 AND port_number <= 48);
END $$;

CREATE INDEX IF NOT EXISTS idx_gis_olts_pon_mode ON public.gis_olts (pon_mode);
CREATE INDEX IF NOT EXISTS idx_gis_olt_pon_ports_olt ON public.gis_olt_pon_ports (olt_id);
CREATE INDEX IF NOT EXISTS idx_gis_nodes_node_type ON public.gis_nodes (node_type);
CREATE INDEX IF NOT EXISTS idx_gis_nodes_olt_id ON public.gis_nodes (olt_id);
CREATE INDEX IF NOT EXISTS idx_gis_nodes_pon_port_id ON public.gis_nodes (pon_port_id);
CREATE INDEX IF NOT EXISTS idx_gis_cables_source ON public.gis_cables (source_node_id);
CREATE INDEX IF NOT EXISTS idx_gis_cables_target ON public.gis_cables (target_node_id);
CREATE INDEX IF NOT EXISTS idx_gis_cables_source_pon_port ON public.gis_cables (source_pon_port_id);
CREATE INDEX IF NOT EXISTS idx_gis_fdb_ports_node ON public.gis_fdb_ports (fdb_node_id);
CREATE INDEX IF NOT EXISTS idx_gis_fdb_ports_subscriber ON public.gis_fdb_ports (subscriber_id);
CREATE INDEX IF NOT EXISTS idx_gis_splitter_outputs_node ON public.gis_splitter_outputs (node_id);

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

-- Multi-Device MikroTik Router Sync Registry (Desktop + Mobile)
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

ALTER TABLE IF EXISTS public.mikrotik_routers ADD COLUMN IF NOT EXISTS host TEXT;
ALTER TABLE IF EXISTS public.mikrotik_routers ADD COLUMN IF NOT EXISTS port INTEGER NOT NULL DEFAULT 81;
ALTER TABLE IF EXISTS public.mikrotik_routers ADD COLUMN IF NOT EXISTS use_ssl BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE IF EXISTS public.mikrotik_routers ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE IF EXISTS public.mikrotik_routers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_mikrotik_routers_default_updated
    ON public.mikrotik_routers (is_default DESC, updated_at DESC);

ALTER TABLE public.mikrotik_routers ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mikrotik_routers TO anon, authenticated;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='mikrotik_routers' AND policyname='mikrotik_routers_full_access') THEN
        CREATE POLICY mikrotik_routers_full_access ON public.mikrotik_routers FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
    END IF;
END $$;

ALTER TABLE public.mikrotik_routers REPLICA IDENTITY FULL;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'mikrotik_routers') THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.mikrotik_routers;
        END IF;
    END IF;
END $$;

-- Dedicated FTTH Outside-Plant Fiber Nodes & Core/Pair Routing Ledger
CREATE TABLE IF NOT EXISTS public.fiber_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    node_type TEXT NOT NULL CHECK (node_type IN ('OLT', 'FDB', 'FAT', 'JOINT_CLOSURE', 'POLE')),
    name TEXT NOT NULL,
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    pon_ports INT NOT NULL DEFAULT 0,
    box_capacity INT NOT NULL DEFAULT 8,
    optical_power_dbm NUMERIC(6, 2) NULL,
    address_note TEXT DEFAULT '',
    internal_splitters JSONB NOT NULL DEFAULT '[]'::jsonb,
    core_splices JSONB NOT NULL DEFAULT '[]'::jsonb,
    equipment_history JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE IF EXISTS public.fiber_nodes
    ADD COLUMN IF NOT EXISTS core_splices JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS internal_splitters JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS box_capacity INTEGER DEFAULT 8,
    ADD COLUMN IF NOT EXISTS equipment_history JSONB DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS public.fiber_routes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cable_name TEXT NOT NULL DEFAULT '',
    cable_type TEXT NOT NULL DEFAULT '12C' CHECK (cable_type IN ('2C', '4C', '6C', '8C', '12C', '24C', '48C', 'DROP')),
    core_count INT NOT NULL DEFAULT 12,
    length_meters NUMERIC(10, 2) NOT NULL DEFAULT 0,
    start_node_id UUID NULL,
    start_node_name TEXT DEFAULT '',
    end_node_id UUID NULL,
    end_node_name TEXT DEFAULT '',
    waypoints JSONB NOT NULL DEFAULT '[]'::jsonb,
    core_allocations JSONB NOT NULL DEFAULT '[]'::jsonb,
    notes TEXT DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE IF EXISTS public.fiber_routes
    ADD COLUMN IF NOT EXISTS core_allocations JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE IF EXISTS public.fiber_routes
    ADD COLUMN IF NOT EXISTS waypoints JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE IF EXISTS public.fiber_routes
    ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT '';
ALTER TABLE IF EXISTS public.fiber_routes
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_fiber_nodes_type ON public.fiber_nodes (node_type);
CREATE INDEX IF NOT EXISTS idx_fiber_routes_start_end ON public.fiber_routes (start_node_id, end_node_id);

ALTER TABLE public.fiber_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiber_routes ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fiber_nodes TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fiber_routes TO anon, authenticated;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='fiber_nodes' AND policyname='fiber_nodes_full_access') THEN
        CREATE POLICY fiber_nodes_full_access ON public.fiber_nodes FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='fiber_routes' AND policyname='fiber_routes_full_access') THEN
        CREATE POLICY fiber_routes_full_access ON public.fiber_routes FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
    END IF;
END $$;

ALTER TABLE public.fiber_nodes REPLICA IDENTITY FULL;
ALTER TABLE public.fiber_routes REPLICA IDENTITY FULL;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'fiber_nodes') THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.fiber_nodes;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'fiber_routes') THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.fiber_routes;
        END IF;
    END IF;
END $$;

-- Live Field Agent GPS Tracking & Custom Area/Sector Zone Labels
CREATE TABLE IF NOT EXISTS public.agent_live_locations (
    agent_id TEXT PRIMARY KEY,
    agent_name TEXT NOT NULL DEFAULT 'Field Agent',
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    accuracy_meters DOUBLE PRECISION NULL,
    is_online BOOLEAN NOT NULL DEFAULT true,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.gis_area_zones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    color TEXT DEFAULT '#22d3ee',
    updated_by TEXT DEFAULT 'admin',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_live_locations_updated ON public.agent_live_locations (updated_at DESC);

ALTER TABLE public.agent_live_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gis_area_zones ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_live_locations TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gis_area_zones TO anon, authenticated;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='agent_live_locations' AND policyname='agent_live_locations_full_access') THEN
        CREATE POLICY agent_live_locations_full_access ON public.agent_live_locations FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='gis_area_zones' AND policyname='gis_area_zones_full_access') THEN
        CREATE POLICY gis_area_zones_full_access ON public.gis_area_zones FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
    END IF;
END $$;

ALTER TABLE public.agent_live_locations REPLICA IDENTITY FULL;
ALTER TABLE public.gis_area_zones REPLICA IDENTITY FULL;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'agent_live_locations') THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_live_locations;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'gis_area_zones') THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.gis_area_zones;
        END IF;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.agent_gps_breadcrumbs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id TEXT NOT NULL,
    agent_name TEXT NOT NULL DEFAULT 'Field Agent',
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    accuracy_meters DOUBLE PRECISION NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_gps_breadcrumbs_agent_time ON public.agent_gps_breadcrumbs (agent_id, recorded_at DESC);
ALTER TABLE public.agent_gps_breadcrumbs ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_gps_breadcrumbs TO anon, authenticated;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='agent_gps_breadcrumbs' AND policyname='agent_gps_breadcrumbs_full_access') THEN
        CREATE POLICY agent_gps_breadcrumbs_full_access ON public.agent_gps_breadcrumbs FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
    END IF;
END $$;
`;
