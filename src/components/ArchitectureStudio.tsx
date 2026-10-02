import React, { useState } from 'react';
import {
  Database,
  Terminal,
  Code2,
  Clock,
  Layers,
  Copy,
  Check,
  FileCode,
  FolderTree,
  ExternalLink,
} from 'lucide-react';

export const ArchitectureStudio: React.FC = () => {
  const [activeCodeTab, setActiveCodeTab] = useState<'sql' | 'mikrotik' | 'cron' | 'nextjs'>('sql');
  const [copied, setCopied] = useState<boolean>(false);

  const sqlSchemaCode = `-- ============================================================================
-- NETPULSE ISP OS - ENTERPRISE MULTI-TENANT POSTGRESQL DDL SCHEMA
-- Target Database: PostgreSQL 14+ / 16+
-- Engine: Core ISP Operations, MikroTik RouterOS v7 Sync & SLA Ticket Engine
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. ENUM TYPES
CREATE TYPE customer_status_enum AS ENUM ('active', 'expired', 'disabled', 'walled_garden', 'pending_installation');
CREATE TYPE connection_type_enum AS ENUM ('pppoe', 'static_ip', 'hotspot');
CREATE TYPE invoice_status_enum AS ENUM ('unpaid', 'paid', 'overdue', 'cancelled');
CREATE TYPE payment_method_enum AS ENUM ('agent_cash', 'online_gateway', 'bank_transfer', 'easypaisa', 'jazzcash');
CREATE TYPE ticket_category_enum AS ENUM ('fiber_cut', 'router_issue', 'slow_speed', 'no_internet', 'billing_issue');
CREATE TYPE ticket_priority_enum AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE ticket_status_enum AS ENUM ('open', 'assigned', 'in_progress', 'resolved', 'closed');
CREATE TYPE router_status_enum AS ENUM ('online', 'unreachable', 'syncing');
CREATE TYPE outage_severity_enum AS ENUM ('minor', 'major', 'critical');
CREATE TYPE expense_category_enum AS ENUM ('upstream_transit', 'dark_fiber_lease', 'staff_salaries', 'generator_diesel', 'hardware_maintenance', 'office_rent');

-- 2. CORE SYSTEM TABLES
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
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    broadcast_whatsapp_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. HIGH-PERFORMANCE INDEXES
CREATE INDEX idx_customers_pppoe ON customers(pppoe_username);
CREATE INDEX idx_customers_area_node ON customers(area_node);
CREATE INDEX idx_invoices_status_due ON invoices(status, due_date);
CREATE INDEX idx_complaints_deadline ON complaints(status, sla_deadline);
CREATE INDEX idx_payments_agent ON payments(collected_by_agent_id);

-- 4. BUSINESS TRIGGERS
CREATE OR REPLACE FUNCTION trigger_update_agent_cash()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.payment_method = 'agent_cash' AND NEW.collected_by_agent_id IS NOT NULL THEN
        UPDATE agents SET cash_in_hand = cash_in_hand + NEW.amount WHERE id = NEW.collected_by_agent_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_agent_cash_on_payment
AFTER INSERT ON payments FOR EACH ROW EXECUTE PROCEDURE trigger_update_agent_cash();`;

  const mikrotikTsCode = `/**
 * MikroTik RouterOS v7 Native TypeScript Service
 * Implements RouterOS v7 REST API (/rest/*) with TLS Basic Auth
 */
import fetch from 'node-fetch';

export class MikrotikRouterOSv7Service {
  private baseUrl: string;
  private authHeader: string;

  constructor(host: string, port = 443, user: string, pass: string) {
    this.baseUrl = \`https://\${host}:\${port}/rest\`;
    this.authHeader = \`Basic \${Buffer.from(\`\${user}:\${pass}\`).toString('base64')}\`;
  }

  // 1. Live Interface Traffic Polling
  async monitorInterfaceTraffic(iface: string) {
    const res = await fetch(\`\${this.baseUrl}/interface/monitor-traffic\`, {
      method: 'POST',
      headers: { Authorization: this.authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ interface: iface, once: true }),
    });
    return (await res.json())[0];
  }

  // 2. PPPoE Secret Provisioning
  async createPppoeSecret(data: { name: string; password: string; profile: string; remoteAddress?: string }) {
    return await fetch(\`\${this.baseUrl}/ppp/secret\`, {
      method: 'PUT',
      headers: { Authorization: this.authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: data.name,
        password: data.password,
        service: 'pppoe',
        profile: data.profile,
        'remote-address': data.remoteAddress,
      }),
    });
  }

  // 3. Automated Walled Garden Profile Reassignment & Active Kick
  async assignWalledGarden(username: string, walledGardenProfile = 'Walled_Garden_Pool') {
    await fetch(\`\${this.baseUrl}/ppp/secret/\${encodeURIComponent(username)}\`, {
      method: 'PATCH',
      headers: { Authorization: this.authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: walledGardenProfile }),
    });
    // Terminate session so client reconnects with walled-garden IP pool
    await this.killActiveSessionByUsername(username);
  }

  // 4. Force Disconnect Session (/ppp/active/remove)
  async killActiveSessionByUsername(username: string) {
    const listRes = await fetch(\`\${this.baseUrl}/ppp/active\`, {
      headers: { Authorization: this.authHeader },
    });
    const sessions = (await listRes.json()) as any[];
    const match = sessions.find((s) => s.name === username);
    if (match) {
      await fetch(\`\${this.baseUrl}/ppp/active/\${encodeURIComponent(match['.id'])}\`, {
        method: 'DELETE',
        headers: { Authorization: this.authHeader },
      });
    }
  }
}`;

  const cronEngineCode = `/**
 * Automated Monthly Invoicing CRON Engine & WhatsApp Notification Dispatcher
 * Scheduled via node-cron:
 * 1. 0 0 1 * *  -> 1st of month: Generate Invoices & Send WhatsApp Bills
 * 2. 0 6 * * *  -> Daily: Scan Overdue & Isolate to MikroTik Walled Garden
 */
import cron from 'node-cron';
import { db } from '../db';
import { MikrotikRouterOSv7Service } from './mikrotikRouterOSv7';

// 1. MONTHLY INVOICE GENERATION ON 1ST OF EVERY MONTH
cron.schedule('0 0 1 * *', async () => {
  console.log('[CRON] Executing Monthly ISP Invoicing...');
  const activeCustomers = await db.query(
    "SELECT c.*, p.price_monthly, p.name as pkg_name FROM customers c JOIN packages p ON c.package_id = p.id WHERE c.status = 'active'"
  );

  for (const cust of activeCustomers.rows) {
    const base = parseFloat(cust.price_monthly);
    const tax = Math.round(base * 0.16); // 16% Telecom GST
    const total = base + tax;
    const invNum = \`INV-\${new Date().getFullYear()}\${String(new Date().getMonth()+1).padStart(2, '0')}-\${cust.account_number.slice(-4)}\`;

    await db.query(
      \`INSERT INTO invoices (invoice_number, customer_id, package_id, billing_period_start, billing_period_end, base_amount, tax_amount, total_amount, due_date)
       VALUES ($1, $2, $3, date_trunc('month', CURRENT_DATE), (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day'), $4, $5, $6, CURRENT_DATE + interval '10 days')\`,
      [invNum, cust.id, cust.package_id, base, tax, total]
    );

    // Trigger WhatsApp Cloud API Statement
    await sendWhatsAppCloudApiMessage(
      cust.phone,
      \`🔔 *NETPULSE INVOICE STATEMENT*\nDear \${cust.full_name}, your bill of $\${total} for package \${cust.pkg_name} is ready. Due: 10th. Pay via app or area cash agent.\`
    );
  }
});

// 2. DAILY OVERDUE SCANNER & MIKROTIK ISOLATION
cron.schedule('0 6 * * *', async () => {
  console.log('[CRON] Scanning for Past-Due Invoices exceeding Grace Period...');
  const overdueRecords = await db.query(
    \`SELECT i.*, c.pppoe_username, c.phone, c.full_name, r.ip_address, r.api_username
     FROM invoices i
     JOIN customers c ON i.customer_id = c.id
     JOIN mikrotik_routers r ON c.router_id = r.id
     WHERE i.status = 'unpaid' AND i.due_date + interval '3 days' < CURRENT_DATE\`
  );

  for (const row of overdueRecords.rows) {
    const mikrotik = new MikrotikRouterOSv7Service(row.ip_address, 443, row.api_username, process.env.ROUTER_PASS!);
    // Switch to Walled Garden captive portal
    await mikrotik.assignWalledGarden(row.pppoe_username, 'Walled_Garden_Pool');

    // Update customer state
    await db.query("UPDATE customers SET status = 'walled_garden' WHERE id = $1", [row.customer_id]);
    await db.query("UPDATE invoices SET status = 'overdue' WHERE id = $1", [row.id]);

    // Send WhatsApp Suspension Notice
    await sendWhatsAppCloudApiMessage(
      row.phone,
      \`⚠️ *NETPULSE OVERDUE NOTICE*\nDear \${row.full_name}, connection redirected to payment portal. Please clear $\${row.total_amount} via app to restore high-speed fiber.\`
    );
  }
});`;

  const nextJsAppRouterCode = `/**
 * Next.js 15+ App Router Structure for NetPulse ISP OS
 * 
 * /app
 *  ├── layout.tsx                     // Root ISP NOC Layout with sidebar & telemetry
 *  ├── page.tsx                       // Executive Network Operations Center Dashboard
 *  ├── mikrotik/page.tsx              // MikroTik RouterOS v7 Console & Live Sessions
 *  ├── billing/page.tsx               // Invoicing, CRON triggers & Agent Cash Recovery
 *  ├── complaints/page.tsx            // Field SLA Countdown Ticket Dispatch & Outages
 *  └── api
 *       ├── mikrotik
 *       │    ├── traffic/route.ts     // SSE / WebSocket proxy for live traffic stream
 *       │    └── kick-session/route.ts// POST to /ppp/active/remove
 *       ├── billing
 *       │    └── cron/route.ts        // Trigger manual CRON execution
 *       └── webhooks
 *            └── whatsapp/route.ts    // WhatsApp Cloud API delivery callbacks
 */

// Example: /app/billing/page.tsx
import { db } from '@/lib/db';
import { BillingBoard } from '@/components/billing/BillingBoard';
import { AgentCashLedger } from '@/components/billing/AgentCashLedger';

export default async function BillingPage() {
  const invoices = await db.invoices.findMany({ include: { customer: true }, orderBy: { createdAt: 'desc' } });
  const agents = await db.agents.findMany({ where: { isActive: true } });

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold font-mono text-white">ISP Financials & Cash Recovery</h1>
      <BillingBoard initialInvoices={invoices} />
      <AgentCashLedger agents={agents} />
    </div>
  );
}`;

  const currentCode =
    activeCodeTab === 'sql'
      ? sqlSchemaCode
      : activeCodeTab === 'mikrotik'
      ? mikrotikTsCode
      : activeCodeTab === 'cron'
      ? cronEngineCode
      : nextJsAppRouterCode;

  const handleCopy = () => {
    navigator.clipboard.writeText(currentCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Code2 className="w-5 h-5 text-cyan-400" />
            <h2 className="text-base font-bold text-white">
              Foundational Architecture & Code Artifacts
            </h2>
            <span className="text-xs px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 font-mono">
              Production Ready
            </span>
          </div>
          <p className="text-xs text-slate-400">
            Production PostgreSQL DDL scripts, MikroTik RouterOS v7 service, automated CRON billing engine, and Next.js App Router structure.
          </p>
        </div>

        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs px-3.5 py-2 rounded-lg transition shadow-sm"
        >
          {copied ? <Check className="w-4 h-4 text-emerald-950" /> : <Copy className="w-4 h-4" />}
          <span>{copied ? 'Copied to Clipboard!' : 'Copy Code Artifact'}</span>
        </button>
      </div>

      {/* Code File Switcher */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5 bg-slate-950">
          <div className="flex space-x-1 overflow-x-auto text-xs font-mono scrollbar-none">
            <button
              onClick={() => setActiveCodeTab('sql')}
              className={`px-3 py-1.5 rounded-md flex items-center gap-1.5 transition ${
                activeCodeTab === 'sql'
                  ? 'bg-slate-800 text-cyan-300 border border-cyan-800/80 font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Database className="w-3.5 h-3.5 text-cyan-400" />
              1. PostgreSQL DDL (schema.sql)
            </button>

            <button
              onClick={() => setActiveCodeTab('mikrotik')}
              className={`px-3 py-1.5 rounded-md flex items-center gap-1.5 transition ${
                activeCodeTab === 'mikrotik'
                  ? 'bg-slate-800 text-cyan-300 border border-cyan-800/80 font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Terminal className="w-3.5 h-3.5 text-emerald-400" />
              2. MikroTik RouterOS v7 Service
            </button>

            <button
              onClick={() => setActiveCodeTab('cron')}
              className={`px-3 py-1.5 rounded-md flex items-center gap-1.5 transition ${
                activeCodeTab === 'cron'
                  ? 'bg-slate-800 text-cyan-300 border border-cyan-800/80 font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              3. CRON Billing Engine (cron.ts)
            </button>

            <button
              onClick={() => setActiveCodeTab('nextjs')}
              className={`px-3 py-1.5 rounded-md flex items-center gap-1.5 transition ${
                activeCodeTab === 'nextjs'
                  ? 'bg-slate-800 text-cyan-300 border border-cyan-800/80 font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5 text-indigo-400" />
              4. Next.js App Router Structure
            </button>
          </div>

          <span className="text-[11px] font-mono text-slate-500 hidden sm:inline">
            TypeScript / PostgreSQL 16
          </span>
        </div>

        {/* Code Content Viewer */}
        <pre className="p-4 bg-slate-950 text-slate-200 font-mono text-xs overflow-x-auto max-h-[580px] leading-relaxed selection:bg-cyan-900 selection:text-cyan-200">
          <code>{currentCode}</code>
        </pre>
      </div>
    </div>
  );
};
