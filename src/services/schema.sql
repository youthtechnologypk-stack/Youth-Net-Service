-- ============================================================================
-- NETPULSE ISP OS - ENTERPRISE MULTI-TENANT POSTGRESQL DDL SCHEMA
-- Target Database: PostgreSQL 14+ / 16+
-- Engine: Core ISP Operations, MikroTik RouterOS v7 Sync & SLA Ticket Engine
-- ============================================================================

-- 0. EXTENSIONS & PREREQUISITES
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. CUSTOM ENUM TYPES
DO $$ BEGIN
    CREATE TYPE customer_status_enum AS ENUM (
        'active', 
        'expired', 
        'disabled', 
        'walled_garden', 
        'pending_installation'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE connection_type_enum AS ENUM (
        'pppoe', 
        'static_ip', 
        'hotspot'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE invoice_status_enum AS ENUM (
        'unpaid', 
        'paid', 
        'overdue', 
        'cancelled'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE payment_method_enum AS ENUM (
        'agent_cash', 
        'online_gateway', 
        'bank_transfer', 
        'easypaisa', 
        'jazzcash'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE ticket_category_enum AS ENUM (
        'fiber_cut', 
        'router_issue', 
        'slow_speed', 
        'no_internet', 
        'billing_issue'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE ticket_priority_enum AS ENUM (
        'low', 
        'medium', 
        'high', 
        'critical'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE ticket_status_enum AS ENUM (
        'open', 
        'assigned', 
        'in_progress', 
        'resolved', 
        'closed'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE router_status_enum AS ENUM (
        'online', 
        'unreachable', 
        'syncing'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE outage_severity_enum AS ENUM (
        'minor', 
        'major', 
        'critical'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE expense_category_enum AS ENUM (
        'upstream_transit', 
        'dark_fiber_lease', 
        'staff_salaries', 
        'generator_diesel', 
        'hardware_maintenance', 
        'office_rent'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ============================================================================
-- 2. CORE SYSTEM TABLES
-- ============================================================================

-- Table 1: MIKROTIK ROUTERS (BRASS / Core / Aggregation Routers)
CREATE TABLE IF NOT EXISTS mikrotik_routers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(120) NOT NULL,
    model VARCHAR(100) NOT NULL DEFAULT 'MikroTik CCR2004-16G-2S+',
    ip_address INET NOT NULL UNIQUE,
    api_port INT NOT NULL DEFAULT 8728,
    rest_api_port INT NOT NULL DEFAULT 443,
    api_username VARCHAR(80) NOT NULL,
    api_password_hash VARCHAR(255) NOT NULL,
    use_ssl BOOLEAN NOT NULL DEFAULT TRUE,
    routeros_version VARCHAR(50) NOT NULL DEFAULT 'RouterOS v7.16',
    location VARCHAR(150) NOT NULL,
    wan_interface VARCHAR(60) NOT NULL DEFAULT 'sfp-sfpplus1',
    walled_garden_pool CIDR NOT NULL DEFAULT '172.16.100.0/24',
    status router_status_enum NOT NULL DEFAULT 'online',
    last_ping_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Table 2: INTERNET PACKAGES / BANDWIDTH PROFILES
CREATE TABLE IF NOT EXISTS packages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    download_speed_mbps INT NOT NULL CHECK (download_speed_mbps > 0),
    upload_speed_mbps INT NOT NULL CHECK (upload_speed_mbps > 0),
    price_monthly NUMERIC(10, 2) NOT NULL CHECK (price_monthly >= 0),
    mikrotik_profile VARCHAR(100) NOT NULL, -- Corresponds to /ppp/profile in RouterOS
    data_limit_gb INT NULL, -- NULL implies uncapped/unlimited
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Table 3: FIELD & RECOVERY AGENTS
CREATE TABLE IF NOT EXISTS agents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    full_name VARCHAR(120) NOT NULL,
    phone VARCHAR(30) NOT NULL UNIQUE,
    email VARCHAR(120) UNIQUE,
    assigned_area VARCHAR(100) NOT NULL,
    cash_in_hand NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (cash_in_hand >= 0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Table 4: CUSTOMERS / SUBSCRIBERS
CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_number VARCHAR(40) NOT NULL UNIQUE,
    full_name VARCHAR(150) NOT NULL,
    phone VARCHAR(30) NOT NULL,
    email VARCHAR(120),
    national_id_cnic VARCHAR(40),
    installation_address TEXT NOT NULL,
    area_node VARCHAR(100) NOT NULL, -- e.g. 'Sector-G11-PON-02'
    connection_type connection_type_enum NOT NULL DEFAULT 'pppoe',
    pppoe_username VARCHAR(80) NOT NULL UNIQUE,
    pppoe_password VARCHAR(80) NOT NULL,
    assigned_ip INET,
    mac_address MACADDR,
    package_id UUID NOT NULL REFERENCES packages(id) ON DELETE RESTRICT,
    router_id UUID NOT NULL REFERENCES mikrotik_routers(id) ON DELETE RESTRICT,
    status customer_status_enum NOT NULL DEFAULT 'active',
    billing_day INT NOT NULL DEFAULT 1 CHECK (billing_day BETWEEN 1 AND 28),
    balance_due NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    ont_optical_power_dbm NUMERIC(5, 2) DEFAULT -19.50,
    installed_at DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Table 5: MONTHLY INVOICES
CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_number VARCHAR(50) NOT NULL UNIQUE,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    package_id UUID NOT NULL REFERENCES packages(id) ON DELETE RESTRICT,
    billing_period_start DATE NOT NULL,
    billing_period_end DATE NOT NULL,
    base_amount NUMERIC(10, 2) NOT NULL CHECK (base_amount >= 0),
    tax_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (tax_amount >= 0),
    discount_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (discount_amount >= 0),
    total_amount NUMERIC(10, 2) NOT NULL CHECK (total_amount >= 0),
    status invoice_status_enum NOT NULL DEFAULT 'unpaid',
    due_date DATE NOT NULL,
    paid_at TIMESTAMP WITH TIME ZONE NULL,
    whatsapp_notice_sent BOOLEAN NOT NULL DEFAULT FALSE,
    whatsapp_sent_at TIMESTAMP WITH TIME ZONE NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Table 6: PAYMENTS & AGENT CASH RECOVERY
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    amount NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
    payment_method payment_method_enum NOT NULL,
    collected_by_agent_id UUID NULL REFERENCES agents(id) ON DELETE SET NULL,
    receipt_number VARCHAR(60) NOT NULL UNIQUE,
    transaction_ref VARCHAR(100),
    reconciled_with_bank BOOLEAN NOT NULL DEFAULT FALSE,
    collected_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Table 7: COMPLAINTS & FIELD SLA DISPATCH
CREATE TABLE IF NOT EXISTS complaints (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ticket_number VARCHAR(40) NOT NULL UNIQUE,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    router_id UUID NOT NULL REFERENCES mikrotik_routers(id) ON DELETE RESTRICT,
    category ticket_category_enum NOT NULL,
    priority ticket_priority_enum NOT NULL DEFAULT 'medium',
    status ticket_status_enum NOT NULL DEFAULT 'open',
    title VARCHAR(200) NOT NULL,
    description TEXT NOT NULL,
    area_node VARCHAR(100) NOT NULL,
    assigned_agent_id UUID NULL REFERENCES agents(id) ON DELETE SET NULL,
    sla_target_hours INT NOT NULL DEFAULT 4,
    sla_deadline TIMESTAMP WITH TIME ZONE NOT NULL,
    resolved_at TIMESTAMP WITH TIME ZONE NULL,
    resolution_notes TEXT,
    proof_image_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Table 8: AREA OUTAGES & BROADCAST NOTICES
CREATE TABLE IF NOT EXISTS outages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    router_id UUID NOT NULL REFERENCES mikrotik_routers(id) ON DELETE RESTRICT,
    area_node VARCHAR(100) NOT NULL,
    title VARCHAR(200) NOT NULL,
    root_cause TEXT NOT NULL,
    severity outage_severity_enum NOT NULL DEFAULT 'major',
    affected_customers_count INT NOT NULL DEFAULT 0,
    start_time TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    estimated_resolution_time TIMESTAMP WITH TIME ZONE NOT NULL,
    actual_resolution_time TIMESTAMP WITH TIME ZONE,
    status VARCHAR(30) NOT NULL DEFAULT 'active', -- active, investigating, resolved
    broadcast_whatsapp_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Table 9: ISP OPERATING EXPENSES (Bandwidth, Salaries, Maintenance)
CREATE TABLE IF NOT EXISTS expenses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category expense_category_enum NOT NULL,
    title VARCHAR(200) NOT NULL,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
    paid_to VARCHAR(150) NOT NULL,
    payment_mode VARCHAR(40) NOT NULL DEFAULT 'bank_transfer',
    receipt_reference VARCHAR(100),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Table 10: AUTOMATED WHATSAPP NOTIFICATION LOGS
CREATE TABLE IF NOT EXISTS whatsapp_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    recipient_phone VARCHAR(30) NOT NULL,
    recipient_name VARCHAR(150) NOT NULL,
    notification_type VARCHAR(50) NOT NULL, -- invoice_generated, reminder, receipt, outage
    template_name VARCHAR(80) NOT NULL,
    payload JSONB NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'sent', -- sent, delivered, failed
    external_message_id VARCHAR(100),
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 3. HIGH-PERFORMANCE INDEXES
-- ============================================================================

-- Customers Indexes
CREATE INDEX IF NOT EXISTS idx_customers_pppoe_username ON customers(pppoe_username);
CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status);
CREATE INDEX IF NOT EXISTS idx_customers_area_node ON customers(area_node);
CREATE INDEX IF NOT EXISTS idx_customers_router_id ON customers(router_id);
CREATE INDEX IF NOT EXISTS idx_customers_billing_day ON customers(billing_day);

-- Invoices Indexes
CREATE INDEX IF NOT EXISTS idx_invoices_customer_id ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status_due_date ON invoices(status, due_date);
CREATE INDEX IF NOT EXISTS idx_invoices_billing_period ON invoices(billing_period_start, billing_period_end);

-- Complaints & SLA Indexes
CREATE INDEX IF NOT EXISTS idx_complaints_customer_id ON complaints(customer_id);
CREATE INDEX IF NOT EXISTS idx_complaints_assigned_agent ON complaints(assigned_agent_id);
CREATE INDEX IF NOT EXISTS idx_complaints_status_deadline ON complaints(status, sla_deadline);
CREATE INDEX IF NOT EXISTS idx_complaints_area_node ON complaints(area_node);

-- Payments & Cash Recovery Indexes
CREATE INDEX IF NOT EXISTS idx_payments_agent_id ON payments(collected_by_agent_id);
CREATE INDEX IF NOT EXISTS idx_payments_invoice_id ON payments(invoice_id);

-- Outages Indexes
CREATE INDEX IF NOT EXISTS idx_outages_area_node_status ON outages(area_node, status);

-- ============================================================================
-- 4. BUSINESS LOGIC TRIGGERS
-- ============================================================================

-- Trigger 1: Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_timestamp_customers
BEFORE UPDATE ON customers
FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

CREATE TRIGGER set_timestamp_invoices
BEFORE UPDATE ON invoices
FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

CREATE TRIGGER set_timestamp_complaints
BEFORE UPDATE ON complaints
FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

-- Trigger 2: Update Agent Cash-in-Hand on Cash Payment Collection
CREATE OR REPLACE FUNCTION trigger_update_agent_cash()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.payment_method = 'agent_cash' AND NEW.collected_by_agent_id IS NOT NULL THEN
        UPDATE agents 
        SET cash_in_hand = cash_in_hand + NEW.amount 
        WHERE id = NEW.collected_by_agent_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_agent_cash_on_payment
AFTER INSERT ON payments
FOR EACH ROW EXECUTE PROCEDURE trigger_update_agent_cash();
