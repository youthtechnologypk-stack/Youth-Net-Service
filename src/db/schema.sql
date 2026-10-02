-- ============================================================================
-- NETPULSE CARRIER-GRADE ISP PLATFORM
-- SQL SCHEMA UPDATE: Authentication & Role-Based Access Control (RBAC)
-- ============================================================================

-- 1. Create Roles Enum and Roles Lookup Table
CREATE TYPE system_role_enum AS ENUM ('ADMIN', 'AGENT', 'CLIENT');

CREATE TABLE IF NOT EXISTS roles (
    id SERIAL PRIMARY KEY,
    name system_role_enum UNIQUE NOT NULL,
    description TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO roles (name, description) VALUES
    ('ADMIN', 'Full system access: MikroTik BNG, OLT, Billing CRON, Staff & Customer control'),
    ('AGENT', 'Field recovery app, cash collection, assigned complaint resolution, offline sync'),
    ('CLIENT', 'Subscriber self-service, invoice history, live optical stats, ticket reporting')
ON CONFLICT (name) DO NOTHING;

-- 2. Create Users Table Linking with Agents and Customers Foreign Keys
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(100) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    role system_role_enum NOT NULL DEFAULT 'CLIENT',
    password_hash VARCHAR(255) NOT NULL, -- bcrypt/argon2 hash with salt ($2b$12$...)
    display_name VARCHAR(150) NOT NULL,
    phone VARCHAR(30) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
    
    -- Foreign key to Field Agent (Optional: Only populated for AGENT role)
    linked_agent_id VARCHAR(50),
    -- Foreign key to Customer (Optional: Only populated for CLIENT role)
    linked_customer_id VARCHAR(50),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_login_at TIMESTAMP WITH TIME ZONE,
    
    -- Foreign key constraints (assumes existing agents and customers tables)
    CONSTRAINT fk_user_agent FOREIGN KEY (linked_agent_id) 
        REFERENCES agents(id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_user_customer FOREIGN KEY (linked_customer_id) 
        REFERENCES customers(id) ON DELETE SET NULL ON UPDATE CASCADE
);

-- Indexing for high-performance authentication lookups
CREATE INDEX IF NOT EXISTS idx_users_username ON users (LOWER(username));
CREATE INDEX IF NOT EXISTS idx_users_email ON users (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);
CREATE INDEX IF NOT EXISTS idx_users_linked_agent ON users (linked_agent_id);
CREATE INDEX IF NOT EXISTS idx_users_linked_customer ON users (linked_customer_id);

-- 3. JWT Refresh Tokens Table (with Revocation & Device Tracking)
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,
    device_info VARCHAR(255),
    ip_address VARCHAR(45),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    revoked_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens (token_hash);

-- 4. Credential Reset & Security Audit Log Table
CREATE TABLE IF NOT EXISTS user_security_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    performed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action_type VARCHAR(50) NOT NULL, -- 'PASSWORD_RESET', 'STATUS_TOGGLE', 'WHATSAPP_SHARED', 'ROLE_CHANGED'
    ip_address VARCHAR(45),
    details JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_target_user ON user_security_audit_logs (target_user_id);

-- ============================================================================
-- 5. VSOL OLT (EPON/GPON) & ONU OPTICAL MONITORING SCHEMA
-- ============================================================================

CREATE TYPE olt_pon_type_enum AS ENUM ('EPON', 'GPON');
CREATE TYPE onu_status_enum AS ENUM ('online', 'offline', 'dying_gasp');
CREATE TYPE optical_quality_enum AS ENUM ('good', 'warning', 'critical');

-- OLT Hardware Table
CREATE TABLE IF NOT EXISTS olts (
    id VARCHAR(50) PRIMARY KEY, -- e.g. 'olt-vsol-g11'
    name VARCHAR(150) NOT NULL,
    model VARCHAR(100) NOT NULL DEFAULT 'VSOL V1600G1-B (8-Port GPON)',
    ip_address VARCHAR(45) NOT NULL,
    snmp_port INTEGER NOT NULL DEFAULT 161,
    snmp_community VARCHAR(100) NOT NULL DEFAULT 'public',
    firmware_version VARCHAR(50) NOT NULL DEFAULT 'v2.03.54R',
    pon_type olt_pon_type_enum NOT NULL DEFAULT 'GPON',
    total_pon_ports INTEGER NOT NULL DEFAULT 8,
    active_onu_count INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'online', -- 'online', 'warning', 'offline'
    cpu_load_percent INTEGER NOT NULL DEFAULT 12,
    temperature_celsius NUMERIC(5,2) NOT NULL DEFAULT 38.5,
    power_supply VARCHAR(50) NOT NULL DEFAULT 'dual_ac_redundant',
    area_node VARCHAR(100) NOT NULL, -- Links to area_nodes (e.g. 'Sector-G11-PON-02')
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_olts_ip ON olts (ip_address);
CREATE INDEX IF NOT EXISTS idx_olts_area_node ON olts (area_node);

-- Customer ONU/ONT Hardware Table with Optical Power Metrics
CREATE TABLE IF NOT EXISTS onus (
    id VARCHAR(50) PRIMARY KEY, -- e.g. 'onu-g11-01'
    olt_id VARCHAR(50) NOT NULL REFERENCES olts(id) ON DELETE CASCADE,
    pon_port VARCHAR(30) NOT NULL, -- e.g. 'GPON0/1' or 'EPON0/2'
    onu_index INTEGER NOT NULL, -- 1 to 128
    mac_address VARCHAR(50) UNIQUE NOT NULL, -- e.g. 'E0:67:B3:4A:21:8F'
    serial_number VARCHAR(100),
    vendor VARCHAR(50) NOT NULL DEFAULT 'VSOL',
    model VARCHAR(50) NOT NULL DEFAULT 'V2801SG',
    
    -- Foreign Key to Customer Record
    customer_id VARCHAR(50) REFERENCES customers(id) ON DELETE SET NULL,
    area_node VARCHAR(100) NOT NULL,
    
    -- Real-time Optical Signal Telemetry (in dBm)
    rx_power_dbm NUMERIC(5,2) NOT NULL DEFAULT -19.40, -- Received Optical Power at ONU
    tx_power_dbm NUMERIC(5,2) NOT NULL DEFAULT 2.30,   -- Transmit Optical Power from ONU
    olt_tx_power_dbm NUMERIC(5,2) NOT NULL DEFAULT 4.50, -- SFP module Tx Power at OLT
    
    -- Signal Threshold Health: 'good' (-12 to -23), 'warning' (-24 to -27), 'critical' (<-28 or offline)
    optical_quality optical_quality_enum NOT NULL DEFAULT 'good',
    status onu_status_enum NOT NULL DEFAULT 'online', -- 'online', 'offline', 'dying_gasp'
    
    distance_meters INTEGER NOT NULL DEFAULT 820,
    firmware VARCHAR(50) DEFAULT 'V1.0.4',
    last_dying_gasp_time TIMESTAMP WITH TIME ZONE,
    last_online_time TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT uq_olt_pon_onu UNIQUE (olt_id, pon_port, onu_index)
);

CREATE INDEX IF NOT EXISTS idx_onus_customer_id ON onus (customer_id);
CREATE INDEX IF NOT EXISTS idx_onus_mac_address ON onus (LOWER(mac_address));
CREATE INDEX IF NOT EXISTS idx_onus_pon_port ON onus (olt_id, pon_port);
CREATE INDEX IF NOT EXISTS idx_onus_rx_power ON onus (rx_power_dbm);
CREATE INDEX IF NOT EXISTS idx_onus_optical_quality ON onus (optical_quality);
CREATE INDEX IF NOT EXISTS idx_onus_status ON onus (status);
