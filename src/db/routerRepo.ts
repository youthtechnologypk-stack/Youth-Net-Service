import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { MikrotikRouter, InternetPackage } from '../types/isp';

const { Pool } = pg;

// Local persistent file storage path
const DATA_DIR = path.resolve('data');
const ROUTERS_FILE = path.join(DATA_DIR, 'routers.json');
const SECRETS_FILE = path.join(DATA_DIR, 'router_secrets.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'system_settings.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const PERMISSIONS_FILE = path.join(DATA_DIR, 'role_permissions.json');
const PACKAGES_FILE = path.join(DATA_DIR, 'packages.json');

export interface StoredRouterCredentials {
  id: string;
  host: string;
  port: number;
  username: string;
  password?: string;
  useSsl?: boolean;
  wanInterface?: string;
}

let pgPool: pg.Pool | null = null;
let isPgAvailable = false;

// Initialize PostgreSQL pool if configured in environment
export async function initPostgres(): Promise<boolean> {
  const host = process.env.SQL_HOST || process.env.PGHOST;
  const user = process.env.SQL_USER || process.env.PGUSER;
  const password = process.env.SQL_PASSWORD || process.env.PGPASSWORD;
  const database = process.env.SQL_DB_NAME || process.env.PGDATABASE;
  const connectionString = process.env.DATABASE_URL;

  if (connectionString || (host && user && database)) {
    try {
      pgPool = new Pool(
        connectionString
          ? { connectionString, connectionTimeoutMillis: 5000 }
          : {
              host,
              user,
              password,
              database,
              port: Number(process.env.SQL_PORT || process.env.PGPORT) || 5432,
              connectionTimeoutMillis: 5000,
            }
      );

      // Verify connection and create table
      const client = await pgPool.connect();
      try {
        await client.query(`
          CREATE TABLE IF NOT EXISTS mikrotik_routers (
            id VARCHAR(64) PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            host VARCHAR(255) NOT NULL,
            port INTEGER NOT NULL DEFAULT 8728,
            username VARCHAR(255) NOT NULL,
            password VARCHAR(255) NOT NULL DEFAULT '',
            is_active BOOLEAN NOT NULL DEFAULT true,
            status VARCHAR(50) NOT NULL DEFAULT 'online',
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
            current_wan_rx_mbps NUMERIC(10,2) DEFAULT 0,
            current_wan_tx_mbps NUMERIC(10,2) DEFAULT 0,
            active_pppoe_count INTEGER DEFAULT 0,
            last_tested_at TIMESTAMP WITH TIME ZONE,
            last_error_message TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          );

          CREATE TABLE IF NOT EXISTS customers (
            id VARCHAR(64) PRIMARY KEY,
            account_number VARCHAR(100),
            name VARCHAR(255) NOT NULL,
            phone VARCHAR(50) NOT NULL,
            email VARCHAR(255),
            address TEXT,
            area_node VARCHAR(100),
            connection_type VARCHAR(50) DEFAULT 'pppoe',
            pppoe_username VARCHAR(100) UNIQUE NOT NULL,
            pppoe_password VARCHAR(100),
            service VARCHAR(50) DEFAULT 'pppoe',
            assigned_ip VARCHAR(50),
            mac_address VARCHAR(50),
            package_id VARCHAR(64),
            router_id VARCHAR(64),
            status VARCHAR(50) DEFAULT 'active',
            balance_due NUMERIC(10,2) DEFAULT 0,
            comment TEXT,
            is_deleted BOOLEAN DEFAULT false,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          );

          CREATE TABLE IF NOT EXISTS system_settings (
            key VARCHAR(100) PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          );

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

          CREATE TABLE IF NOT EXISTS role_permissions (
            role VARCHAR(30) PRIMARY KEY,
            permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_by VARCHAR(100) DEFAULT 'admin'
          );

          CREATE TABLE IF NOT EXISTS packages (
            id VARCHAR(64) PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            download_speed_mbps INTEGER NOT NULL,
            upload_speed_mbps INTEGER NOT NULL,
            price_monthly NUMERIC(10,2) NOT NULL,
            mikrotik_profile VARCHAR(100),
            data_limit_gb INTEGER,
            is_popular BOOLEAN DEFAULT false,
            local_address VARCHAR(50),
            remote_address_pool VARCHAR(100),
            dns_servers VARCHAR(100),
            rate_limit VARCHAR(100),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          );

          CREATE TABLE IF NOT EXISTS routers (
            id VARCHAR(64) PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            host VARCHAR(255) NOT NULL,
            port INTEGER NOT NULL DEFAULT 8728,
            username VARCHAR(255) NOT NULL,
            password VARCHAR(255) NOT NULL DEFAULT '',
            is_active BOOLEAN NOT NULL DEFAULT true,
            status VARCHAR(50) NOT NULL DEFAULT 'online',
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
            current_wan_rx_mbps NUMERIC(10,2) DEFAULT 0,
            current_wan_tx_mbps NUMERIC(10,2) DEFAULT 0,
            active_pppoe_count INTEGER DEFAULT 0,
            last_tested_at TIMESTAMP WITH TIME ZONE,
            last_error_message TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          );

          CREATE TABLE IF NOT EXISTS profiles (
            id VARCHAR(64) PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            mikrotik_profile VARCHAR(100),
            rate_limit VARCHAR(100),
            local_address VARCHAR(50),
            remote_address_pool VARCHAR(100),
            dns_servers VARCHAR(100),
            price_monthly NUMERIC(10,2) DEFAULT 0,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          );

          ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '{}'::jsonb;
        `);
        isPgAvailable = true;
        console.log('[PostgreSQL] mikrotik_routers, routers, customers, packages, profiles, system_settings, users, and role_permissions tables verified and ready.');
        return true;
      } finally {
        client.release();
      }
    } catch (err: any) {
      console.warn('[PostgreSQL] Could not connect to external PostgreSQL, using persistent local JSON storage:', err.message);
      isPgAvailable = false;
    }
  }
  return false;
}

// Ensure data directory and files exist
function ensureFileStorage(): MikrotikRouter[] {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(ROUTERS_FILE)) {
      fs.writeFileSync(ROUTERS_FILE, JSON.stringify([], null, 2), 'utf-8');
      return [];
    }
    const raw = fs.readFileSync(ROUTERS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    fs.writeFileSync(ROUTERS_FILE, JSON.stringify([], null, 2), 'utf-8');
    return [];
  } catch (err) {
    console.error('Error reading routers file:', err);
    return [];
  }
}

function loadSecrets(): Record<string, StoredRouterCredentials> {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(SECRETS_FILE)) {
      fs.writeFileSync(SECRETS_FILE, JSON.stringify({}, null, 2), 'utf-8');
      return {};
    }
    const raw = fs.readFileSync(SECRETS_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveSecrets(secrets: Record<string, StoredRouterCredentials>) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(SECRETS_FILE, JSON.stringify(secrets, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to write router secrets to disk:', err);
  }
}

function saveToFile(routers: MikrotikRouter[]) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(ROUTERS_FILE, JSON.stringify(routers, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to write routers to disk:', err);
  }
}

/**
 * Fetch all saved routers
 */
export async function getAllRouters(): Promise<MikrotikRouter[]> {
  // If PostgreSQL is available, query PostgreSQL
  if (isPgAvailable && pgPool) {
    try {
      const res = await pgPool.query('SELECT * FROM mikrotik_routers ORDER BY created_at ASC');
      return res.rows.map((row) => ({
        id: row.id,
        name: row.name,
        model: row.model || 'MikroTik RouterOS',
        ipAddress: row.host,
        apiPort: row.port,
        username: row.username,
        useSsl: row.use_ssl ?? true,
        version: row.version || 'RouterOS v7',
        location: row.location || 'Central Distribution Node',
        cpuLoad: Number(row.cpu_load || 0),
        memoryUsageMb: Number(row.memory_usage_mb || 0),
        totalMemoryMb: Number(row.total_memory_mb || 0),
        uptime: row.uptime || '0m',
        status: row.status as any,
        wanInterface: row.wan_interface || 'ether1',
        currentWanRxMbps: Number(row.current_wan_rx_mbps || 0),
        currentWanTxMbps: Number(row.current_wan_tx_mbps || 0),
        activePppoeCount: Number(row.active_pppoe_count || 0),
        walledGardenPool: row.walled_garden_pool || '172.16.102.0/24',
      }));
    } catch (err) {
      console.warn('PostgreSQL query error, falling back to disk:', err);
    }
  }

  // Fallback to local persistent file
  return ensureFileStorage();
}

/**
 * Retrieve saved credentials for a specific router (for backend live sync / queries)
 */
export async function getRouterCredentials(id: string): Promise<StoredRouterCredentials | null> {
  // First check PostgreSQL if available
  if (isPgAvailable && pgPool) {
    try {
      const res = await pgPool.query('SELECT id, host, port, username, password, use_ssl, wan_interface FROM mikrotik_routers WHERE id = $1', [id]);
      if (res.rows && res.rows.length > 0) {
        const row = res.rows[0];
        return {
          id: row.id,
          host: row.host,
          port: row.port,
          username: row.username,
          password: row.password || '',
          useSsl: row.use_ssl,
          wanInterface: row.wan_interface,
        };
      }
    } catch (err) {
      console.warn('PostgreSQL credential query error:', err);
    }
  }

  // Fallback to local secrets file
  const secrets = loadSecrets();
  if (secrets[id]) {
    return secrets[id];
  }

  // Fallback to router object without password
  const routers = ensureFileStorage();
  const r = routers.find((item) => item.id === id);
  if (r) {
    return {
      id: r.id,
      host: r.ipAddress,
      port: r.apiPort,
      username: r.username,
      password: '',
      useSsl: r.useSsl,
      wanInterface: r.wanInterface,
    };
  }

  return null;
}

/**
 * Add / Save a router to database and persist credentials
 */
export async function saveRouter(router: MikrotikRouter, rawPassword = ''): Promise<MikrotikRouter> {
  const current = ensureFileStorage();
  const existingIdx = current.findIndex((r) => r.id === router.id);

  if (existingIdx >= 0) {
    current[existingIdx] = router;
  } else {
    current.push(router);
  }
  saveToFile(current);

  // Save secret
  const secrets = loadSecrets();
  secrets[router.id] = {
    id: router.id,
    host: router.ipAddress,
    port: router.apiPort,
    username: router.username,
    password: rawPassword || secrets[router.id]?.password || '',
    useSsl: router.useSsl,
    wanInterface: router.wanInterface,
  };
  saveSecrets(secrets);

  // If PostgreSQL is active, save to PostgreSQL
  if (isPgAvailable && pgPool) {
    try {
      await pgPool.query(
        `INSERT INTO mikrotik_routers (
          id, name, host, port, username, password, is_active, status, model, version,
          location, use_ssl, wan_interface, walled_garden_pool, cpu_load, memory_usage_mb,
          total_memory_mb, uptime, current_wan_rx_mbps, current_wan_tx_mbps, active_pppoe_count,
          updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16,
          $17, $18, $19, $20, $21,
          CURRENT_TIMESTAMP
        )
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          host = EXCLUDED.host,
          port = EXCLUDED.port,
          username = EXCLUDED.username,
          password = CASE WHEN EXCLUDED.password != '' THEN EXCLUDED.password ELSE mikrotik_routers.password END,
          status = EXCLUDED.status,
          model = EXCLUDED.model,
          version = EXCLUDED.version,
          location = EXCLUDED.location,
          use_ssl = EXCLUDED.use_ssl,
          wan_interface = EXCLUDED.wan_interface,
          walled_garden_pool = EXCLUDED.walled_garden_pool,
          cpu_load = EXCLUDED.cpu_load,
          memory_usage_mb = EXCLUDED.memory_usage_mb,
          total_memory_mb = EXCLUDED.total_memory_mb,
          active_pppoe_count = EXCLUDED.active_pppoe_count,
          current_wan_rx_mbps = EXCLUDED.current_wan_rx_mbps,
          current_wan_tx_mbps = EXCLUDED.current_wan_tx_mbps,
          updated_at = CURRENT_TIMESTAMP`,
        [
          router.id,
          router.name,
          router.ipAddress,
          router.apiPort,
          router.username,
          rawPassword,
          true,
          router.status,
          router.model,
          router.version,
          router.location,
          router.useSsl,
          router.wanInterface,
          router.walledGardenPool,
          router.cpuLoad,
          router.memoryUsageMb,
          router.totalMemoryMb,
          router.uptime,
          router.currentWanRxMbps,
          router.currentWanTxMbps,
          router.activePppoeCount,
        ]
      );
    } catch (err) {
      console.error('Failed to save router to PostgreSQL:', err);
    }
  }

  return router;
}

/**
 * Delete a router
 */
export async function deleteRouter(id: string): Promise<boolean> {
  const current = ensureFileStorage();
  const filtered = current.filter((r) => r.id !== id && r.name !== id && r.ipAddress !== id);
  saveToFile(filtered);

  const secrets = loadSecrets();
  delete secrets[id];
  for (const k of Object.keys(secrets)) {
    if (secrets[k].host === id || secrets[k].id === id) {
      delete secrets[k];
    }
  }
  saveSecrets(secrets);

  if (isPgAvailable && pgPool) {
    try {
      await pgPool.query('DELETE FROM mikrotik_routers WHERE id = $1 OR name = $1 OR host = $1', [id]);
      await pgPool.query('DELETE FROM routers WHERE id = $1 OR name = $1 OR host = $1', [id]).catch(() => {});
    } catch (err) {
      console.error('Failed to delete router from PostgreSQL:', err);
    }
  }

  return true;
}

/**
 * Update router status / telemetry
 */
export async function updateRouterTelemetry(
  id: string,
  updates: Partial<MikrotikRouter>
): Promise<MikrotikRouter | null> {
  const current = ensureFileStorage();
  const idx = current.findIndex((r) => r.id === id);
  if (idx < 0) return null;

  current[idx] = { ...current[idx], ...updates };
  saveToFile(current);

  if (isPgAvailable && pgPool) {
    try {
      const sets: string[] = [];
      const values: any[] = [];
      let counter = 1;

      if (updates.status) {
        sets.push(`status = $${counter++}`);
        values.push(updates.status);
      }
      if (updates.cpuLoad !== undefined) {
        sets.push(`cpu_load = $${counter++}`);
        values.push(updates.cpuLoad);
      }
      if (updates.memoryUsageMb !== undefined) {
        sets.push(`memory_usage_mb = $${counter++}`);
        values.push(updates.memoryUsageMb);
      }
      if (updates.activePppoeCount !== undefined) {
        sets.push(`active_pppoe_count = $${counter++}`);
        values.push(updates.activePppoeCount);
      }
      if (updates.currentWanRxMbps !== undefined) {
        sets.push(`current_wan_rx_mbps = $${counter++}`);
        values.push(updates.currentWanRxMbps);
      }
      if (updates.currentWanTxMbps !== undefined) {
        sets.push(`current_wan_tx_mbps = $${counter++}`);
        values.push(updates.currentWanTxMbps);
      }
      if (updates.version) {
        sets.push(`version = $${counter++}`);
        values.push(updates.version);
      }
      if (updates.model) {
        sets.push(`model = $${counter++}`);
        values.push(updates.model);
      }
      if (updates.uptime) {
        sets.push(`uptime = $${counter++}`);
        values.push(updates.uptime);
      }

      if (sets.length > 0) {
        values.push(id);
        await pgPool.query(
          `UPDATE mikrotik_routers SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${counter}`,
          values
        );
      }
    } catch (err) {
      console.error('Failed to update telemetry in PostgreSQL:', err);
    }
  }

  return current[idx];
}

/**
 * Update complete router configuration (credentials, networking, identity)
 */
export async function updateRouter(
  id: string,
  updates: Partial<MikrotikRouter>,
  newPassword?: string
): Promise<MikrotikRouter | null> {
  const current = ensureFileStorage();
  const idx = current.findIndex((r) => r.id === id);
  if (idx < 0) return null;

  current[idx] = { ...current[idx], ...updates };
  saveToFile(current);

  const secrets = loadSecrets();
  if (!secrets[id]) {
    secrets[id] = {
      id,
      host: current[idx].ipAddress,
      port: current[idx].apiPort,
      username: current[idx].username,
      useSsl: current[idx].useSsl,
      wanInterface: current[idx].wanInterface,
    };
  }
  if (updates.ipAddress) secrets[id].host = updates.ipAddress;
  if (updates.apiPort) secrets[id].port = updates.apiPort;
  if (updates.username) secrets[id].username = updates.username;
  if (updates.useSsl !== undefined) secrets[id].useSsl = updates.useSsl;
  if (updates.wanInterface) secrets[id].wanInterface = updates.wanInterface;
  if (newPassword !== undefined && newPassword !== '') {
    secrets[id].password = newPassword;
  }
  saveSecrets(secrets);

  if (isPgAvailable && pgPool) {
    try {
      const sets: string[] = [];
      const values: any[] = [];
      let counter = 1;

      if (updates.name) {
        sets.push(`name = $${counter++}`);
        values.push(updates.name);
      }
      if (updates.ipAddress) {
        sets.push(`host = $${counter++}`);
        values.push(updates.ipAddress);
      }
      if (updates.apiPort) {
        sets.push(`port = $${counter++}`);
        values.push(updates.apiPort);
      }
      if (updates.username) {
        sets.push(`username = $${counter++}`);
        values.push(updates.username);
      }
      if (newPassword !== undefined && newPassword !== '') {
        sets.push(`password = $${counter++}`);
        values.push(newPassword);
      }
      if (updates.useSsl !== undefined) {
        sets.push(`use_ssl = $${counter++}`);
        values.push(updates.useSsl);
      }
      if (updates.model) {
        sets.push(`model = $${counter++}`);
        values.push(updates.model);
      }
      if (updates.location) {
        sets.push(`location = $${counter++}`);
        values.push(updates.location);
      }
      if (updates.wanInterface) {
        sets.push(`wan_interface = $${counter++}`);
        values.push(updates.wanInterface);
      }
      if (updates.walledGardenPool) {
        sets.push(`walled_garden_pool = $${counter++}`);
        values.push(updates.walledGardenPool);
      }

      if (sets.length > 0) {
        values.push(id);
        await pgPool.query(
          `UPDATE mikrotik_routers SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${counter}`,
          values
        );
      }
    } catch (err) {
      console.error('Failed to update router in PostgreSQL:', err);
    }
  }

  return current[idx];
}

const CUSTOMERS_FILE = path.join(DATA_DIR, 'customers.json');

export interface CustomerRecord {
  id: string;
  accountNumber?: string;
  name: string;
  phone: string;
  email?: string;
  address?: string;
  areaNode?: string;
  connectionType?: string;
  pppoeUsername: string;
  pppoePassword?: string;
  service?: string;
  assignedIp?: string;
  macAddress?: string;
  packageId?: string;
  routerId?: string;
  status?: string;
  balanceDue?: number;
  comment?: string;
  isDeleted?: boolean;
  createdAt?: string;
}

function ensureCustomersFile(): CustomerRecord[] {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(CUSTOMERS_FILE)) {
      fs.writeFileSync(CUSTOMERS_FILE, JSON.stringify([], null, 2), 'utf-8');
      return [];
    }
    const raw = fs.readFileSync(CUSTOMERS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveCustomersFile(list: CustomerRecord[]) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(CUSTOMERS_FILE, JSON.stringify(list, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to write customers to disk:', err);
  }
}

/**
 * Save customer into database (PostgreSQL + persistent JSON fallback)
 */
export async function saveCustomerInDb(customer: CustomerRecord): Promise<CustomerRecord> {
  const current = ensureCustomersFile();
  const existingIdx = current.findIndex(
    (c) => c.id === customer.id || c.pppoeUsername === customer.pppoeUsername
  );

  const fullRecord: CustomerRecord = {
    accountNumber: `NP-${Math.floor(1000 + Math.random() * 9000)}`,
    connectionType: 'pppoe',
    service: 'pppoe',
    status: 'active',
    balanceDue: 0,
    isDeleted: false,
    createdAt: new Date().toISOString(),
    ...customer,
  };

  if (existingIdx >= 0) {
    current[existingIdx] = { ...current[existingIdx], ...fullRecord };
  } else {
    current.unshift(fullRecord);
  }
  saveCustomersFile(current);

  if (isPgAvailable && pgPool) {
    try {
      await pgPool.query(
        `INSERT INTO customers (
          id, account_number, name, phone, email, address, area_node,
          connection_type, pppoe_username, pppoe_password, service, assigned_ip,
          mac_address, package_id, router_id, status, balance_due, comment, is_deleted
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
        ON CONFLICT (pppoe_username) DO UPDATE SET
          name = EXCLUDED.name,
          phone = EXCLUDED.phone,
          address = EXCLUDED.address,
          area_node = EXCLUDED.area_node,
          pppoe_password = EXCLUDED.pppoe_password,
          package_id = EXCLUDED.package_id,
          assigned_ip = EXCLUDED.assigned_ip,
          router_id = EXCLUDED.router_id,
          comment = EXCLUDED.comment,
          is_deleted = false,
          updated_at = CURRENT_TIMESTAMP`,
        [
          fullRecord.id,
          fullRecord.accountNumber,
          fullRecord.name,
          fullRecord.phone,
          fullRecord.email || '',
          fullRecord.address || '',
          fullRecord.areaNode || 'Sector G-11',
          fullRecord.connectionType || 'pppoe',
          fullRecord.pppoeUsername,
          fullRecord.pppoePassword || '',
          fullRecord.service || 'pppoe',
          fullRecord.assignedIp || '',
          fullRecord.macAddress || '',
          fullRecord.packageId || '',
          fullRecord.routerId || '',
          fullRecord.status || 'active',
          fullRecord.balanceDue || 0,
          fullRecord.comment || '',
          false,
        ]
      );
    } catch (err: any) {
      console.error('Failed to save customer in PostgreSQL:', err.message);
    }
  }

  return fullRecord;
}

/**
 * Dual-cleanup: Permanent delete customer record in database
 */
export async function deleteCustomerInDb(username: string): Promise<boolean> {
  const current = ensureCustomersFile();
  const updated = current.filter(
    (c) =>
      c.pppoeUsername.toLowerCase() !== username.toLowerCase() &&
      c.id !== username
  );
  saveCustomersFile(updated);

  if (isPgAvailable && pgPool) {
    try {
      await pgPool.query(
        'DELETE FROM customers WHERE LOWER(pppoe_username) = LOWER($1) OR id = $1',
        [username]
      );
    } catch (err: any) {
      console.error('Failed to delete customer in PostgreSQL:', err.message);
    }
  }

  return true;
}

/**
 * Update customer status (e.g. active, walled_garden, disabled)
 */
export async function updateCustomerStatusInDb(username: string, status: string): Promise<boolean> {
  const current = ensureCustomersFile();
  const updated = current.map((c) =>
    c.pppoeUsername.toLowerCase() === username.toLowerCase()
      ? { ...c, status }
      : c
  );
  saveCustomersFile(updated);

  if (isPgAvailable && pgPool) {
    try {
      await pgPool.query(
        'UPDATE customers SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE LOWER(pppoe_username) = LOWER($2)',
        [status, username]
      );
    } catch (err: any) {
      console.error('Failed to update customer status in PostgreSQL:', err.message);
    }
  }

  return true;
}

/**
 * Reset customer MAC address binding in DB
 */
export async function resetCustomerMacInDb(username: string): Promise<boolean> {
  const current = ensureCustomersFile();
  const updated = current.map((c) =>
    c.pppoeUsername.toLowerCase() === username.toLowerCase()
      ? { ...c, macAddress: '' }
      : c
  );
  saveCustomersFile(updated);

  if (isPgAvailable && pgPool) {
    try {
      await pgPool.query(
        'UPDATE customers SET mac_address = $1, updated_at = CURRENT_TIMESTAMP WHERE LOWER(pppoe_username) = LOWER($2)',
        ['', username]
      );
    } catch (err: any) {
      console.error('Failed to reset customer MAC in PostgreSQL:', err.message);
    }
  }

  return true;
}

/**
 * Fetch active customers from database
 */
export async function getAllCustomersFromDb(): Promise<CustomerRecord[]> {
  if (isPgAvailable && pgPool) {
    try {
      const res = await pgPool.query(
        'SELECT * FROM customers WHERE is_deleted = false ORDER BY created_at DESC'
      );
      // Return PostgreSQL result directly (even if 0 rows, respect deleted state)
      return res.rows.map((row) => ({
        id: row.id,
        accountNumber: row.account_number,
        name: row.name,
        phone: row.phone,
        email: row.email,
        address: row.address,
        areaNode: row.area_node,
        connectionType: row.connection_type,
        pppoeUsername: row.pppoe_username,
        pppoePassword: row.pppoe_password,
        service: row.service,
        assignedIp: row.assigned_ip,
        macAddress: row.mac_address,
        packageId: row.package_id,
        routerId: row.router_id,
        status: row.status,
        balanceDue: Number(row.balance_due || 0),
        comment: row.comment,
        isDeleted: row.is_deleted,
        createdAt: row.created_at,
      }));
    } catch (err: any) {
      console.error('Failed to query customers from PostgreSQL:', err.message);
    }
  }

  return ensureCustomersFile().filter((c) => !c.isDeleted);
}

// -----------------------------------------------------------------------------
// Packages & Profiles Persistence (PostgreSQL packages table + JSON fallback)
// -----------------------------------------------------------------------------

function ensurePackagesFile(): InternetPackage[] {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(PACKAGES_FILE)) {
      return [];
    }
    const raw = fs.readFileSync(PACKAGES_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function savePackagesFile(list: InternetPackage[]) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(PACKAGES_FILE, JSON.stringify(list, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to write packages to disk:', err);
  }
}

export async function getAllPackagesFromDb(): Promise<InternetPackage[]> {
  if (isPgAvailable && pgPool) {
    try {
      const res = await pgPool.query('SELECT * FROM packages ORDER BY created_at ASC');
      return res.rows.map((r) => ({
        id: r.id,
        name: r.name,
        downloadSpeedMbps: Number(r.download_speed_mbps || 0),
        uploadSpeedMbps: Number(r.upload_speed_mbps || 0),
        priceMonthly: Number(r.price_monthly || 0),
        mikrotikProfile: r.mikrotik_profile || r.name,
        dataLimitGb: r.data_limit_gb ? Number(r.data_limit_gb) : null,
        isPopular: Boolean(r.is_popular),
        localAddress: r.local_address || '192.168.8.1',
        remoteAddressPool: r.remote_address_pool || 'pppoe-pool-1',
        dnsServers: r.dns_servers || '8.8.8.8, 1.1.1.1',
        rateLimit: r.rate_limit,
      }));
    } catch (err: any) {
      console.warn('PostgreSQL query error for packages:', err.message);
    }
  }
  return ensurePackagesFile();
}

export async function savePackageInDb(pkg: InternetPackage): Promise<InternetPackage> {
  const current = ensurePackagesFile();
  const idx = current.findIndex((p) => p.id === pkg.id);
  if (idx >= 0) {
    current[idx] = { ...current[idx], ...pkg };
  } else {
    current.push(pkg);
  }
  savePackagesFile(current);

  if (isPgAvailable && pgPool) {
    try {
      await pgPool.query(
        `INSERT INTO packages (
          id, name, download_speed_mbps, upload_speed_mbps, price_monthly,
          mikrotik_profile, data_limit_gb, is_popular, local_address,
          remote_address_pool, dns_servers, rate_limit, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          download_speed_mbps = EXCLUDED.download_speed_mbps,
          upload_speed_mbps = EXCLUDED.upload_speed_mbps,
          price_monthly = EXCLUDED.price_monthly,
          mikrotik_profile = EXCLUDED.mikrotik_profile,
          data_limit_gb = EXCLUDED.data_limit_gb,
          is_popular = EXCLUDED.is_popular,
          local_address = EXCLUDED.local_address,
          remote_address_pool = EXCLUDED.remote_address_pool,
          dns_servers = EXCLUDED.dns_servers,
          rate_limit = EXCLUDED.rate_limit,
          updated_at = CURRENT_TIMESTAMP`,
        [
          pkg.id,
          pkg.name,
          pkg.downloadSpeedMbps,
          pkg.uploadSpeedMbps,
          pkg.priceMonthly,
          pkg.mikrotikProfile,
          pkg.dataLimitGb,
          pkg.isPopular || false,
          pkg.localAddress || '192.168.8.1',
          pkg.remoteAddressPool || 'pppoe-pool-1',
          pkg.dnsServers || '8.8.8.8, 1.1.1.1',
          (pkg as any).rateLimit || `${pkg.uploadSpeedMbps}M/${pkg.downloadSpeedMbps}M`,
        ]
      );
    } catch (err: any) {
      console.error('Failed to save package in PostgreSQL:', err.message);
    }
  }

  return pkg;
}

export async function deletePackageInDb(id: string): Promise<boolean> {
  const current = ensurePackagesFile();
  const filtered = current.filter((p) => p.id !== id && p.name !== id && p.mikrotikProfile !== id);
  savePackagesFile(filtered);

  if (isPgAvailable && pgPool) {
    try {
      await pgPool.query('DELETE FROM packages WHERE id = $1 OR name = $1 OR mikrotik_profile = $1', [id]);
      await pgPool.query('DELETE FROM profiles WHERE id = $1 OR name = $1 OR mikrotik_profile = $1', [id]).catch(() => {});
    } catch (err: any) {
      console.error('Failed to delete package in PostgreSQL:', err.message);
    }
  }

  return true;
}

// -----------------------------------------------------------------------------
// System Settings Persistence (PostgreSQL system_settings table + JSON fallback)
// -----------------------------------------------------------------------------

function ensureSettingsFile(): Record<string, string> {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(SETTINGS_FILE)) {
      const initial: Record<string, string> = {
        currency_code: 'PKR',
        currency_symbol: 'Rs.',
        isp_name: 'Youth Net Fiber Broadband',
      };
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(initial, null, 2), 'utf-8');
      return initial;
    }
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {
      currency_code: 'PKR',
      currency_symbol: 'Rs.',
      isp_name: 'Youth Net Fiber Broadband',
    };
  }
}

function writeSettingsFile(settings: Record<string, string>) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to write settings file:', err);
  }
}

export async function getAllSystemSettings(): Promise<Record<string, string>> {
  const fileSettings = ensureSettingsFile();

  if (isPgAvailable && pgPool) {
    try {
      const res = await pgPool.query('SELECT key, value FROM system_settings');
      const dbSettings: Record<string, string> = {};
      for (const row of res.rows) {
        dbSettings[row.key] = row.value;
      }
      return { ...fileSettings, ...dbSettings };
    } catch (err: any) {
      console.warn('PostgreSQL system_settings query failed, using file storage:', err.message);
    }
  }

  return fileSettings;
}

export async function getSystemSetting(key: string, defaultValue = ''): Promise<string> {
  if (isPgAvailable && pgPool) {
    try {
      const res = await pgPool.query('SELECT value FROM system_settings WHERE key = $1', [key]);
      if (res.rows.length > 0) {
        return res.rows[0].value;
      }
    } catch (err: any) {
      console.warn(`PostgreSQL system_settings get '${key}' failed:`, err.message);
    }
  }

  const fileSettings = ensureSettingsFile();
  return fileSettings[key] !== undefined ? fileSettings[key] : defaultValue;
}

export async function saveSystemSetting(key: string, value: string): Promise<void> {
  // Update local file storage
  const settings = ensureSettingsFile();
  settings[key] = value;
  writeSettingsFile(settings);

  // Update PostgreSQL if available
  if (isPgAvailable && pgPool) {
    try {
      await pgPool.query(
        `INSERT INTO system_settings (key, value, updated_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP)
         ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        [key, value]
      );
    } catch (err: any) {
      console.error(`Failed to save setting '${key}' in PostgreSQL:`, err.message);
    }
  }
}

export async function saveAllSystemSettings(updates: Record<string, string>): Promise<Record<string, string>> {
  const current = ensureSettingsFile();
  const merged = { ...current, ...updates };
  writeSettingsFile(merged);

  if (isPgAvailable && pgPool) {
    for (const [key, value] of Object.entries(updates)) {
      try {
        await pgPool.query(
          `INSERT INTO system_settings (key, value, updated_at)
           VALUES ($1, $2, CURRENT_TIMESTAMP)
           ON CONFLICT (key) DO UPDATE
           SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
          [key, String(value)]
        );
      } catch (err: any) {
        console.error(`Failed to update setting '${key}' in PostgreSQL:`, err.message);
      }
    }
  }

  return merged;
}

// -----------------------------------------------------------------------------
// Users & RBAC Persistence (PostgreSQL users table + JSON fallback)
// -----------------------------------------------------------------------------

export interface DbUserRecord {
  id: string;
  username: string;
  password_hash: string;
  full_name: string;
  phone: string;
  role: 'ADMIN' | 'MANAGER' | 'AGENT' | 'CLIENT';
  is_active: boolean;
  permissions?: Record<string, boolean>;
  created_at?: string;
}

const DEFAULT_SEED_USERS: DbUserRecord[] = [
  {
    id: 'usr-admin-01',
    username: 'admin',
    password_hash: '$2b$12$netpulse.7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f',
    full_name: 'NOC Master Administrator',
    phone: '+92 300 1234567',
    role: 'ADMIN',
    is_active: true,
  },
  {
    id: 'usr-mgr-01',
    username: 'manager',
    password_hash: '$2b$12$netpulse.manager123hash7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d',
    full_name: 'NOC Operations Manager',
    phone: '+92 301 9876543',
    role: 'MANAGER',
    is_active: true,
  },
  {
    id: 'usr-agent-01',
    username: 'agent',
    password_hash: '$2b$12$netpulse.agent123hash7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e',
    full_name: 'Bilal Khan (Field Recovery Agent)',
    phone: '+92 301 5550192',
    role: 'AGENT',
    is_active: true,
  },
  {
    id: 'usr-client-01',
    username: 'client',
    password_hash: '$2b$12$netpulse.client123hash7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3',
    full_name: 'Dr. Shahzad Rafique (Subscriber)',
    phone: '+92 300 5559812',
    role: 'CLIENT',
    is_active: true,
  },
];

function ensureUsersFile(): DbUserRecord[] {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(USERS_FILE)) {
      fs.writeFileSync(USERS_FILE, JSON.stringify(DEFAULT_SEED_USERS, null, 2), 'utf-8');
      return DEFAULT_SEED_USERS;
    }
    const raw = fs.readFileSync(USERS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
    fs.writeFileSync(USERS_FILE, JSON.stringify(DEFAULT_SEED_USERS, null, 2), 'utf-8');
    return DEFAULT_SEED_USERS;
  } catch (err: any) {
    console.error('Error accessing users file:', err.message);
    return DEFAULT_SEED_USERS;
  }
}

function writeUsersFile(users: DbUserRecord[]) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8');
  } catch (err: any) {
    console.error('Error writing users file:', err.message);
  }
}

export async function getAllUsersFromDb(): Promise<DbUserRecord[]> {
  if (isPgAvailable && pgPool) {
    try {
      const res = await pgPool.query('SELECT * FROM users ORDER BY created_at ASC');
      if (res.rows.length > 0) {
        return res.rows.map((r) => ({
          id: r.id,
          username: r.username,
          password_hash: r.password_hash,
          full_name: r.full_name,
          phone: r.phone || '',
          role: r.role,
          is_active: r.is_active,
          created_at: r.created_at,
        }));
      }
    } catch (err: any) {
      console.warn('Could not query users from PostgreSQL, falling back to local file:', err.message);
    }
  }
  return ensureUsersFile();
}

export async function getUserByUsernameFromDb(username: string): Promise<DbUserRecord | null> {
  const clean = username.trim().toLowerCase();
  if (isPgAvailable && pgPool) {
    try {
      const res = await pgPool.query('SELECT * FROM users WHERE LOWER(username) = $1 LIMIT 1', [clean]);
      if (res.rows.length > 0) {
        const r = res.rows[0];
        return {
          id: r.id,
          username: r.username,
          password_hash: r.password_hash,
          full_name: r.full_name,
          phone: r.phone || '',
          role: r.role,
          is_active: r.is_active,
          created_at: r.created_at,
        };
      }
    } catch (err: any) {
      console.warn('PostgreSQL user lookup error, falling back to file:', err.message);
    }
  }
  const users = ensureUsersFile();
  return users.find((u) => u.username.toLowerCase() === clean) || null;
}

export async function seedDefaultUsersInDb(): Promise<void> {
  const users = ensureUsersFile();
  if (isPgAvailable && pgPool) {
    for (const u of DEFAULT_SEED_USERS) {
      try {
        await pgPool.query(
          `INSERT INTO users (id, username, password_hash, full_name, phone, role, is_active, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
           ON CONFLICT (username) DO UPDATE
           SET password_hash = EXCLUDED.password_hash,
               full_name = EXCLUDED.full_name,
               role = EXCLUDED.role`,
          [u.id, u.username, u.password_hash, u.full_name, u.phone, u.role, u.is_active]
        );
      } catch (err: any) {
        console.warn(`Could not seed user '${u.username}' in PostgreSQL:`, err.message);
      }
    }
  }
}

export async function saveUserInDb(user: DbUserRecord): Promise<DbUserRecord> {
  const users = ensureUsersFile();
  const existingIdx = users.findIndex(
    (u) => u.id === user.id || u.username.toLowerCase() === user.username.toLowerCase()
  );

  const now = new Date().toISOString();
  const finalRecord: DbUserRecord = {
    ...user,
    created_at: user.created_at || (existingIdx >= 0 ? users[existingIdx].created_at : now),
  };

  if (existingIdx >= 0) {
    users[existingIdx] = finalRecord;
  } else {
    users.unshift(finalRecord);
  }
  writeUsersFile(users);

  if (isPgAvailable && pgPool) {
    try {
      await pgPool.query(
        `INSERT INTO users (id, username, password_hash, full_name, phone, role, is_active, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
         ON CONFLICT (username) DO UPDATE
         SET full_name = EXCLUDED.full_name,
             phone = EXCLUDED.phone,
             role = EXCLUDED.role,
             is_active = EXCLUDED.is_active,
             password_hash = CASE WHEN EXCLUDED.password_hash <> '' THEN EXCLUDED.password_hash ELSE users.password_hash END`,
        [
          finalRecord.id,
          finalRecord.username,
          finalRecord.password_hash,
          finalRecord.full_name,
          finalRecord.phone,
          finalRecord.role,
          finalRecord.is_active,
        ]
      );
    } catch (err: any) {
      console.warn('Could not save user to PostgreSQL, saved to JSON:', err.message);
    }
  }

  return finalRecord;
}

export async function deleteUserInDb(idOrUsername: string): Promise<boolean> {
  const users = ensureUsersFile();
  const filtered = users.filter(
    (u) => u.id !== idOrUsername && u.username.toLowerCase() !== idOrUsername.toLowerCase()
  );
  writeUsersFile(filtered);

  if (isPgAvailable && pgPool) {
    try {
      await pgPool.query('DELETE FROM users WHERE id = $1 OR username = $1', [idOrUsername]);
    } catch (err: any) {
      console.warn('Could not delete user in PostgreSQL:', err.message);
    }
  }
  return true;
}

export async function updateUserPasswordInDb(userId: string, newPasswordHash: string): Promise<boolean> {
  const users = ensureUsersFile();
  const user = users.find((u) => u.id === userId || u.username.toLowerCase() === userId.toLowerCase());
  if (user) {
    user.password_hash = newPasswordHash;
    writeUsersFile(users);
  }

  if (isPgAvailable && pgPool) {
    try {
      await pgPool.query(
        'UPDATE users SET password_hash = $1 WHERE id = $2 OR username = $2',
        [newPasswordHash, userId]
      );
    } catch (err: any) {
      console.warn('Could not update user password in PostgreSQL:', err.message);
    }
  }
  return true;
}

export async function toggleUserStatusInDb(userId: string, isActive: boolean): Promise<boolean> {
  const users = ensureUsersFile();
  const user = users.find((u) => u.id === userId || u.username.toLowerCase() === userId.toLowerCase());
  if (user) {
    user.is_active = isActive;
    writeUsersFile(users);
  }

  if (isPgAvailable && pgPool) {
    try {
      await pgPool.query(
        'UPDATE users SET is_active = $1 WHERE id = $2 OR username = $2',
        [isActive, userId]
      );
    } catch (err: any) {
      console.warn('Could not toggle user status in PostgreSQL:', err.message);
    }
  }
  return true;
}

// ============================================================================
// Granular Feature & Role Permissions Management Matrix Repository
// ============================================================================

const DEFAULT_ROLE_PERMS_MAP: Record<string, Record<string, boolean>> = {
  ADMIN: {
    manager_view_billing_revenue: true,
    manager_manual_cash_approval: true,
    manager_edit_subscribers: true,
    manager_routeros_active_kick: true,
    manager_tickets_create_assign: true,
    manager_olt_optical_telemetry: true,
    agent_collect_cash_receipts: true,
    agent_view_subscriber_contact_location: true,
    agent_check_ont_optical_power: true,
    agent_resolve_fiber_tickets: true,
    agent_full_area_directory: true,
    client_online_bill_payment: true,
    client_lodge_complaint_ticket: true,
    client_live_speed_bandwidth_monitor: true,
    client_download_invoices_receipts: true,
    client_wifi_password_self_service: true,
  },
  MANAGER: {
    manager_view_billing_revenue: true,
    manager_manual_cash_approval: true,
    manager_edit_subscribers: true,
    manager_routeros_active_kick: true,
    manager_tickets_create_assign: true,
    manager_olt_optical_telemetry: true,
  },
  AGENT: {
    agent_collect_cash_receipts: true,
    agent_view_subscriber_contact_location: true,
    agent_check_ont_optical_power: true,
    agent_resolve_fiber_tickets: true,
    agent_full_area_directory: false,
  },
  CLIENT: {
    client_online_bill_payment: true,
    client_lodge_complaint_ticket: true,
    client_live_speed_bandwidth_monitor: true,
    client_download_invoices_receipts: true,
    client_wifi_password_self_service: true,
  },
};

interface StoredPermissionsData {
  roles: Record<string, Record<string, boolean>>;
  userOverrides: Record<string, Record<string, boolean>>;
  updatedAt: string;
  updatedBy: string;
}

function ensurePermissionsFile(): StoredPermissionsData {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(PERMISSIONS_FILE)) {
      const initial: StoredPermissionsData = {
        roles: { ...DEFAULT_ROLE_PERMS_MAP },
        userOverrides: {},
        updatedAt: new Date().toISOString(),
        updatedBy: 'system_init',
      };
      fs.writeFileSync(PERMISSIONS_FILE, JSON.stringify(initial, null, 2), 'utf-8');
      return initial;
    }
    const raw = fs.readFileSync(PERMISSIONS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      roles: { ...DEFAULT_ROLE_PERMS_MAP, ...(parsed.roles || {}) },
      userOverrides: parsed.userOverrides || {},
      updatedAt: parsed.updatedAt || new Date().toISOString(),
      updatedBy: parsed.updatedBy || 'admin',
    };
  } catch (err) {
    console.error('Error reading permissions file:', err);
    return {
      roles: { ...DEFAULT_ROLE_PERMS_MAP },
      userOverrides: {},
      updatedAt: new Date().toISOString(),
      updatedBy: 'system_init',
    };
  }
}

function writePermissionsFile(data: StoredPermissionsData): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(PERMISSIONS_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error writing permissions file:', err);
  }
}

/**
 * Fetch all role permissions and user overrides from PostgreSQL or file fallback
 */
export async function getDbRolePermissions(): Promise<{
  roles: Record<string, Record<string, boolean>>;
  userOverrides: Record<string, Record<string, boolean>>;
  updatedAt: string;
  updatedBy: string;
}> {
  const fileData = ensurePermissionsFile();
  const roles: Record<string, Record<string, boolean>> = { ...fileData.roles };
  const userOverrides: Record<string, Record<string, boolean>> = { ...fileData.userOverrides };

  if (isPgAvailable && pgPool) {
    try {
      const res = await pgPool.query('SELECT role, permissions, updated_at, updated_by FROM role_permissions');
      for (const row of res.rows) {
        if (row.role && row.permissions) {
          roles[row.role] = { ...(roles[row.role] || {}), ...row.permissions };
        }
      }

      // Also fetch user overrides from users table if available
      const usersRes = await pgPool.query('SELECT id, permissions FROM users WHERE permissions IS NOT NULL');
      for (const row of usersRes.rows) {
        if (row.id && row.permissions && Object.keys(row.permissions).length > 0) {
          userOverrides[row.id] = row.permissions;
        }
      }
    } catch (err: any) {
      console.warn('Could not query role_permissions from PostgreSQL, returning file data:', err.message);
    }
  }

  return {
    roles,
    userOverrides,
    updatedAt: fileData.updatedAt,
    updatedBy: fileData.updatedBy,
  };
}

/**
 * Save role permissions to PostgreSQL & file storage
 */
export async function saveDbRolePermissions(
  role: string,
  permissions: Record<string, boolean>,
  updatedBy: string = 'admin'
): Promise<Record<string, Record<string, boolean>>> {
  const normRole = role.toUpperCase();
  const fileData = ensurePermissionsFile();
  fileData.roles[normRole] = { ...(fileData.roles[normRole] || {}), ...permissions };
  fileData.updatedAt = new Date().toISOString();
  fileData.updatedBy = updatedBy;
  writePermissionsFile(fileData);

  if (isPgAvailable && pgPool) {
    try {
      await pgPool.query(
        `INSERT INTO role_permissions (role, permissions, updated_at, updated_by)
         VALUES ($1, $2, CURRENT_TIMESTAMP, $3)
         ON CONFLICT (role) DO UPDATE
         SET permissions = EXCLUDED.permissions, updated_at = CURRENT_TIMESTAMP, updated_by = EXCLUDED.updated_by`,
        [normRole, JSON.stringify(fileData.roles[normRole]), updatedBy]
      );
    } catch (err: any) {
      console.warn('Could not save role permissions to PostgreSQL:', err.message);
    }
  }

  return fileData.roles;
}

/**
 * Reset role permissions to defaults
 */
export async function resetDbRolePermissions(role?: string): Promise<Record<string, Record<string, boolean>>> {
  const fileData = ensurePermissionsFile();
  if (role) {
    const norm = role.toUpperCase();
    if (DEFAULT_ROLE_PERMS_MAP[norm]) {
      fileData.roles[norm] = { ...DEFAULT_ROLE_PERMS_MAP[norm] };
    }
  } else {
    fileData.roles = { ...DEFAULT_ROLE_PERMS_MAP };
  }
  fileData.updatedAt = new Date().toISOString();
  fileData.updatedBy = 'reset_to_defaults';
  writePermissionsFile(fileData);

  if (isPgAvailable && pgPool) {
    try {
      if (role) {
        const norm = role.toUpperCase();
        await pgPool.query(
          `INSERT INTO role_permissions (role, permissions, updated_at, updated_by)
           VALUES ($1, $2, CURRENT_TIMESTAMP, 'reset_to_defaults')
           ON CONFLICT (role) DO UPDATE
           SET permissions = EXCLUDED.permissions, updated_at = CURRENT_TIMESTAMP, updated_by = 'reset_to_defaults'`,
          [norm, JSON.stringify(fileData.roles[norm])]
        );
      } else {
        for (const [r, perms] of Object.entries(DEFAULT_ROLE_PERMS_MAP)) {
          await pgPool.query(
            `INSERT INTO role_permissions (role, permissions, updated_at, updated_by)
             VALUES ($1, $2, CURRENT_TIMESTAMP, 'reset_to_defaults')
             ON CONFLICT (role) DO UPDATE
             SET permissions = EXCLUDED.permissions, updated_at = CURRENT_TIMESTAMP, updated_by = 'reset_to_defaults'`,
            [r, JSON.stringify(perms)]
          );
        }
      }
    } catch (err: any) {
      console.warn('Could not reset role permissions in PostgreSQL:', err.message);
    }
  }

  return fileData.roles;
}

/**
 * Save user-level permission override
 */
export async function saveDbUserPermissionOverrides(
  userId: string,
  overrides: Record<string, boolean>
): Promise<Record<string, boolean>> {
  const fileData = ensurePermissionsFile();
  fileData.userOverrides[userId] = { ...(fileData.userOverrides[userId] || {}), ...overrides };
  writePermissionsFile(fileData);

  // Update in users.json
  const users = ensureUsersFile();
  const u = users.find((x) => x.id === userId || x.username === userId);
  if (u) {
    u.permissions = fileData.userOverrides[userId];
    writeUsersFile(users);
  }

  if (isPgAvailable && pgPool) {
    try {
      await pgPool.query(
        'UPDATE users SET permissions = $1 WHERE id = $2 OR username = $2',
        [JSON.stringify(fileData.userOverrides[userId]), userId]
      );
    } catch (err: any) {
      console.warn('Could not save user permission overrides in PostgreSQL:', err.message);
    }
  }

  return fileData.userOverrides[userId];
}


