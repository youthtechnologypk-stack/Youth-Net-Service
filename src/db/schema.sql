-- ============================================================================
-- SQL Migration / Schema for MikroTik Routers
-- Table: mikrotik_routers
-- Purpose: Persistent storage for MikroTik BNG/BRAS hardware & CHR instances
-- ============================================================================

CREATE TABLE IF NOT EXISTS mikrotik_routers (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    host VARCHAR(255) NOT NULL,
    port INTEGER NOT NULL DEFAULT 8728,
    username VARCHAR(255) NOT NULL,
    password VARCHAR(255) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    status VARCHAR(50) NOT NULL DEFAULT 'online', -- 'online' | 'unreachable' | 'syncing'
    model VARCHAR(255) DEFAULT 'MikroTik CCR2004-16G-2S+',
    version VARCHAR(255) DEFAULT 'RouterOS v7.16.2',
    location VARCHAR(255) DEFAULT 'Central Distribution Node',
    use_ssl BOOLEAN NOT NULL DEFAULT true,
    wan_interface VARCHAR(100) DEFAULT 'sfp-sfpplus1',
    walled_garden_pool VARCHAR(100) DEFAULT '172.16.102.0/24',
    cpu_load INTEGER DEFAULT 18,
    memory_usage_mb INTEGER DEFAULT 840,
    total_memory_mb INTEGER DEFAULT 4096,
    uptime VARCHAR(100) DEFAULT '14d 08h 32m',
    current_wan_rx_mbps INTEGER DEFAULT 840,
    current_wan_tx_mbps INTEGER DEFAULT 320,
    active_pppoe_count INTEGER DEFAULT 142,
    last_tested_at TIMESTAMP WITH TIME ZONE,
    last_error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for rapid lookup and active router filtering
CREATE INDEX IF NOT EXISTS idx_mikrotik_routers_host ON mikrotik_routers(host);
CREATE INDEX IF NOT EXISTS idx_mikrotik_routers_is_active ON mikrotik_routers(is_active);
CREATE INDEX IF NOT EXISTS idx_mikrotik_routers_status ON mikrotik_routers(status);

-- Optional seed for default initial core carrier router if table is empty
INSERT INTO mikrotik_routers (
    id, name, host, port, username, password, is_active, status, model, version, location,
    use_ssl, wan_interface, walled_garden_pool, cpu_load, memory_usage_mb, total_memory_mb,
    uptime, current_wan_rx_mbps, current_wan_tx_mbps, active_pppoe_count
) VALUES (
    'rt-core-01',
    'BRAS-CCR2004-CORE-01',
    '10.200.0.1',
    8729,
    'netpulse_noc',
    'RouterOS#2026!',
    true,
    'online',
    'MikroTik CCR2004-16G-2S+',
    'RouterOS v7.16.2',
    'Sector G-11 Primary Hub Rack 01',
    true,
    'sfp-sfpplus1',
    '172.16.100.0/24',
    24,
    1120,
    4096,
    '28d 14h 12m',
    880,
    340,
    142
) ON CONFLICT (id) DO NOTHING;

-- Table: system_settings
CREATE TABLE IF NOT EXISTS system_settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO system_settings (key, value) VALUES
    ('currency_code', 'PKR'),
    ('currency_symbol', 'Rs.'),
    ('isp_name', 'Youth Net Fiber Broadband')
ON CONFLICT (key) DO NOTHING;

-- Table: users
-- Purpose: Authentication & RBAC (Admin, Manager, Agent, Client)
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(64) PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    role VARCHAR(30) NOT NULL CHECK (role IN ('ADMIN', 'MANAGER', 'AGENT', 'CLIENT')),
    permissions JSONB DEFAULT '{}'::jsonb,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Table: role_permissions
-- Purpose: Granular Feature & Permission Management Matrix
CREATE TABLE IF NOT EXISTS role_permissions (
    role VARCHAR(30) PRIMARY KEY,
    permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_by VARCHAR(100) DEFAULT 'admin'
);

-- Seed default permissions for roles
INSERT INTO role_permissions (role, permissions, updated_by) VALUES
    ('MANAGER', '{"manager_view_billing_revenue": true, "manager_manual_cash_approval": true, "manager_edit_subscribers": true, "manager_routeros_active_kick": true, "manager_tickets_create_assign": true, "manager_olt_optical_telemetry": true}'::jsonb, 'system_init'),
    ('AGENT', '{"agent_collect_cash_receipts": true, "agent_view_subscriber_contact_location": true, "agent_check_ont_optical_power": true, "agent_resolve_fiber_tickets": true, "agent_full_area_directory": false}'::jsonb, 'system_init'),
    ('CLIENT', '{"client_online_bill_payment": true, "client_lodge_complaint_ticket": true, "client_live_speed_bandwidth_monitor": true, "client_download_invoices_receipts": true, "client_wifi_password_self_service": true}'::jsonb, 'system_init')
ON CONFLICT (role) DO NOTHING;

-- Seed 4 default testing accounts:
-- admin/admin@123, manager/mgr@123, agent/agent@123, client/client@123
INSERT INTO users (id, username, password_hash, full_name, phone, role, is_active) VALUES
    ('usr-admin-01', 'admin', '$2b$12$netpulse.7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f', 'NOC Master Administrator', '+92 300 1234567', 'ADMIN', TRUE),
    ('usr-mgr-01', 'manager', '$2b$12$netpulse.manager123hash7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d', 'NOC Operations Manager', '+92 301 9876543', 'MANAGER', TRUE),
    ('usr-agent-01', 'agent', '$2b$12$netpulse.agent123hash7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e', 'Bilal Khan (Field Recovery Agent)', '+92 301 5550192', 'AGENT', TRUE),
    ('usr-client-01', 'client', '$2b$12$netpulse.client123hash7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3', 'Dr. Shahzad Rafique (Subscriber)', '+92 300 5559812', 'CLIENT', TRUE)
ON CONFLICT (username) DO UPDATE
SET role = EXCLUDED.role, full_name = EXCLUDED.full_name;

