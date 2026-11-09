/**
 * Centralized Persistence Engine (Repository Pattern)
 * Production-ready storage service using Supabase PostgreSQL + IndexedDB + LocalStorage fallback.
 * Manages: portal_users, bandwidth_profiles, invoices, tickets, consumption_logs
 */

import { supabase, SupabasePortalUser, SupabaseInvoice, SupabaseTicket } from './supabaseClient';

export interface PortalUser {
  id: string;
  username: string;
  password?: string;
  passwordHash?: string;
  role: 'ADMIN' | 'MANAGER' | 'AGENT' | 'CLIENT';
  fullName: string;
  phone: string;
  email?: string;
  area?: string;
  balance: number;
  commissionRate?: number;
  baseSalary?: number;
  cnic?: string;
  address?: string;
  isActive?: boolean;
  linkedAgentId?: string;
  linkedCustomerId?: string;
  createdAt: string;
}

export interface BandwidthProfile {
  id: string;
  name: string;
  rateLimit: string;
  pricePkr: number;
  localAddress?: string;
  remoteAddress?: string;
}

export interface StorageInvoice {
  id: string;
  invoiceNo: string;
  subscriberUsername: string;
  agentId: string;
  amount: number;
  dueDate: string;
  status: 'DUE' | 'PAID';
  createdDate: string;
  cycleDay: number; // e.g. 5th of the month
  paidDate?: string;
  paymentMethod?: string;
  receiptNumber?: string;
  subtotal?: number;
  taxAmount?: number;
  notes?: string;
}

export interface StorageTicket {
  id: string;
  ticketNo: string;
  subscriberUsername: string;
  agentId: string;
  issue: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  status: 'OPEN' | 'RESOLVED';
  createdAt: string;
  resolutionNotes?: string;
  resolvedAt?: string;
}

export interface ConsumptionLog {
  username: string;
  lastSessionDuration: string;
  totalDownloadMB: number;
  totalUploadMB: number;
  lastSeen: string;
}

export type AuditSeverity = 'INFO' | 'SUCCESS' | 'WARNING' | 'CRITICAL';

export type AuditActionType =
  | 'AUTH_LOGIN'
  | 'AUTH_LOGOUT'
  | 'AUTH_FAILED'
  | 'AUTH_PASSWORD_RESET'
  | 'SUBSCRIBER_PROVISION'
  | 'SUBSCRIBER_DELETE'
  | 'SUBSCRIBER_RENEW'
  | 'SUBSCRIBER_EXPIRED_POOL'
  | 'SESSION_KICK'
  | 'MAC_RESET'
  | 'WALLED_GARDEN_TOGGLE'
  | 'ROUTER_CONFIG_UPDATE'
  | 'ROUTER_SYNC'
  | 'CONFIG_CHANGE'
  | 'BILLING_INVOICE_CREATE'
  | 'BILLING_PAYMENT_RECORD'
  | 'BILLING_CRON_EXEC'
  | 'SECURITY_ALERT';

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actor: string;
  actorRole: 'ADMIN' | 'MANAGER' | 'AGENT' | 'CLIENT' | 'SYSTEM';
  actionType: AuditActionType;
  actionTitle: string;
  target?: string;
  severity: AuditSeverity;
  ipAddress?: string;
  details?: string;
  metadata?: Record<string, any>;
}

const DB_NAME = 'YouthNetCarrierDB';
const DB_VERSION = 1;

// Seed Defaults
const INITIAL_PORTAL_USERS: PortalUser[] = [
  {
    id: 'usr-admin-01',
    username: 'admin',
    password: 'admin123',
    role: 'ADMIN',
    fullName: 'NOC Master Administrator',
    phone: '+92 300 1234567',
    email: 'admin@youthnet.pk',
    area: 'Central NOC Core',
    balance: 0,
    commissionRate: 0,
    baseSalary: 150000,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'usr-mgr-01',
    username: 'manager',
    password: 'manager123',
    role: 'MANAGER',
    fullName: 'NOC Operations Manager',
    phone: '+92 301 9876543',
    email: 'manager@youthnet.pk',
    area: 'Islamabad Federal Division',
    balance: 0,
    commissionRate: 0,
    baseSalary: 95000,
    isActive: true,
    createdAt: '2026-01-15T00:00:00.000Z',
  },
  {
    id: 'usr-agent-01',
    username: 'agent',
    password: 'fiber1234',
    role: 'AGENT',
    fullName: 'Bilal Khan (Field Agent)',
    phone: '+92 301 5550192',
    email: 'bilal.agent@youthnet.pk',
    area: 'Sector G-11 & G-10',
    balance: 0,
    commissionRate: 5,
    baseSalary: 35000,
    linkedAgentId: 'agent-1',
    isActive: true,
    createdAt: '2026-02-01T00:00:00.000Z',
  },
  {
    id: 'usr-agent-02',
    username: 'agent_tariq',
    password: 'fiber1234',
    role: 'AGENT',
    fullName: 'Tariq Mehmood',
    phone: '+92 312 8884910',
    email: 'tariq.agent@youthnet.pk',
    area: 'Sector I-8 & H-8',
    balance: 0,
    commissionRate: 5,
    baseSalary: 32000,
    linkedAgentId: 'agent-2',
    isActive: true,
    createdAt: '2026-02-10T00:00:00.000Z',
  },
  {
    id: 'usr-agent-03',
    username: 'agent_hamza',
    password: 'fiber1234',
    role: 'AGENT',
    fullName: 'Hamza Farooq',
    phone: '+92 333 4441093',
    email: 'hamza.agent@youthnet.pk',
    area: 'Blue Area Commercial Node',
    balance: 0,
    commissionRate: 5,
    baseSalary: 38000,
    linkedAgentId: 'agent-3',
    isActive: true,
    createdAt: '2026-02-15T00:00:00.000Z',
  },
  {
    id: 'usr-client-01',
    username: 'client',
    password: 'client123',
    role: 'CLIENT',
    fullName: 'Dr. Shahzad Rafique',
    phone: '+92 300 5559812',
    email: 'shahzad@gmail.com',
    area: 'Sector G-11/3',
    address: 'House 42, Street 18, Sector G-11/3, Islamabad',
    cnic: '37405-1928472-1',
    balance: 2500,
    isActive: true,
    linkedCustomerId: 'client',
    createdAt: '2026-02-20T00:00:00.000Z',
  },
];

const INITIAL_PROFILES: BandwidthProfile[] = [
  { id: 'prof-5m', name: '5M_Home', rateLimit: '5M/5M', pricePkr: 1000 },
  { id: 'prof-10m', name: '10M_Standard', rateLimit: '10M/10M', pricePkr: 1500 },
  { id: 'prof-20m', name: '20M_Ultra', rateLimit: '20M/20M', pricePkr: 2500 },
  { id: 'prof-50m', name: '50M_Gaming', rateLimit: '50M/50M', pricePkr: 4000 },
  { id: 'prof-100m', name: '100M_Enterprise', rateLimit: '100M/100M', pricePkr: 7500 },
  { id: 'prof-expired', name: 'EXPIRED-POOL', rateLimit: '256k/256k', pricePkr: 0, remoteAddress: '16.16.16.0/24' },
];

const INITIAL_AUDIT_LOGS: AuditLogEntry[] = [
  {
    id: 'audit-101',
    timestamp: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
    actor: 'admin',
    actorRole: 'ADMIN',
    actionType: 'AUTH_LOGIN',
    actionTitle: 'Administrative Console Sign-In',
    target: 'NOC Command Center',
    severity: 'SUCCESS',
    ipAddress: '192.168.10.45',
    details: 'Master administrator logged in successfully with MFA credential validation.',
  },
  {
    id: 'audit-102',
    timestamp: new Date(Date.now() - 1000 * 60 * 25).toISOString(),
    actor: 'admin',
    actorRole: 'ADMIN',
    actionType: 'SUBSCRIBER_PROVISION',
    actionTitle: 'Single-Click PPPoE Provisioning',
    target: 'client',
    severity: 'SUCCESS',
    ipAddress: '202.142.186.150',
    details: 'Provisioned 20M_Ultra PPPoE secret on BRAS-CCR2004-CORE-NOC. RouterOS scheduler auto-expiry registered.',
    metadata: { profile: '20M_Ultra', validityDays: 30, invoiceAmount: 2500 },
  },
  {
    id: 'audit-103',
    timestamp: new Date(Date.now() - 1000 * 60 * 48).toISOString(),
    actor: 'system',
    actorRole: 'SYSTEM',
    actionType: 'BILLING_CRON_EXEC',
    actionTitle: 'Automated Overdue Isolation Scan',
    target: 'RouterOS /ppp/secret',
    severity: 'INFO',
    ipAddress: '127.0.0.1',
    details: 'Automated CRON scan inspected 124 PPPoE accounts. 0 accounts shifted to EXPIRED-POOL isolation.',
  },
  {
    id: 'audit-104',
    timestamp: new Date(Date.now() - 1000 * 60 * 75).toISOString(),
    actor: 'usr-agent-01',
    actorRole: 'AGENT',
    actionType: 'BILLING_PAYMENT_RECORD',
    actionTitle: 'Field Cash Collection Recorded',
    target: 'INV-FEB2026-CLIENT',
    severity: 'SUCCESS',
    ipAddress: '10.50.12.89',
    details: 'Agent Bilal Khan collected Rs. 2,500 cash payment for subscriber Dr. Shahzad Rafique. Receipt #REC-892147.',
    metadata: { agentName: 'Bilal Khan', amount: 2500, method: 'CASH' },
  },
  {
    id: 'audit-105',
    timestamp: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
    actor: 'admin',
    actorRole: 'ADMIN',
    actionType: 'ROUTER_CONFIG_UPDATE',
    actionTitle: 'RouterOS REST API Sync',
    target: 'BRAS-CCR2004-CORE-NOC',
    severity: 'INFO',
    ipAddress: '202.142.186.150',
    details: 'Synchronized live bandwidth profiles (5M_Home, 10M_Standard, 20M_Ultra, EXPIRED-POOL) from CCR2004.',
  },
  {
    id: 'audit-106',
    timestamp: new Date(Date.now() - 1000 * 60 * 180).toISOString(),
    actor: 'system',
    actorRole: 'SYSTEM',
    actionType: 'SECURITY_ALERT',
    actionTitle: 'Caller-ID MAC Lock Verification',
    target: 'pppoe-user_4821',
    severity: 'WARNING',
    ipAddress: '10.50.40.12',
    details: 'Authentication mismatch detected on PON-03 port. Auto-restricted by RouterOS isolation rule.',
  },
];

class StorageService {
  private db: IDBDatabase | null = null;
  private isInitialized = false;
  private initPromise: Promise<void> | null = null;

  // In-memory sync mirror for synchronous read access
  private cache = {
    portal_users: [] as PortalUser[],
    bandwidth_profiles: [] as BandwidthProfile[],
    invoices: [] as StorageInvoice[],
    tickets: [] as StorageTicket[],
    consumption_logs: new Map<string, ConsumptionLog>(),
    audit_logs: [] as AuditLogEntry[],
  };

  constructor() {
    this.init();
  }

  public async init(): Promise<void> {
    if (this.isInitialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      // 1. First populate in-memory cache from LocalStorage fallback so it is never empty
      this.loadFromLocalStorageFallback();

      // 2. Open IndexedDB if available in browser
      if (typeof window !== 'undefined' && 'indexedDB' in window) {
        try {
          this.db = await this.openIndexedDB();
          await this.syncFromIndexedDB();
        } catch (err) {
          console.warn('[StorageService] IndexedDB unavailable, continuing with LocalStorage fallback:', err);
        }
      }

      // 3. Seed defaults if empty
      if (this.cache.portal_users.length === 0) {
        this.cache.portal_users = [...INITIAL_PORTAL_USERS];
        await this.persistPortalUsers();
      }

      if (this.cache.bandwidth_profiles.length === 0) {
        this.cache.bandwidth_profiles = [...INITIAL_PROFILES];
        await this.persistBandwidthProfiles();
      }

      if (this.cache.audit_logs.length === 0) {
        this.cache.audit_logs = [...INITIAL_AUDIT_LOGS];
        await this.persistAuditLogs();
      }

      // 4. Synchronize live with Supabase PostgreSQL and subscribe to Realtime updates
      await this.syncWithSupabase();
      this.setupSupabaseRealtime();

      this.isInitialized = true;
    })();

    return this.initPromise;
  }

  /**
   * Synchronize portal_users, invoices, and tickets from production Supabase PostgreSQL
   */
  public async syncWithSupabase(): Promise<void> {
    try {
      // 1. Sync portal_users
      const { data: users, error: uErr } = await supabase.from('portal_users').select('*');
      if (users && users.length > 0) {
        users.forEach((su: SupabasePortalUser) => {
          const cleanU = (su.username || '').toLowerCase();
          const existingIdx = this.cache.portal_users.findIndex(
            (u) => (u.username || '').toLowerCase() === cleanU || u.id === su.id
          );
          const mapped: PortalUser = {
            id: su.id,
            username: su.username,
            password: su.password,
            role: su.role,
            fullName: su.full_name || su.username,
            phone: su.phone || '+92 300 0000000',
            area: su.area || 'Central NOC Core',
            baseSalary: su.base_salary,
            balance: su.cash_in_hand || 0,
            createdAt: su.created_at || new Date().toISOString(),
            isActive: true,
          };
          if (existingIdx >= 0) {
            this.cache.portal_users[existingIdx] = { ...this.cache.portal_users[existingIdx], ...mapped };
          } else {
            this.cache.portal_users.push(mapped);
          }
        });
        await this.persistPortalUsers();
        this.emitChange('portal_users');
      }

      // 2. Sync invoices
      const { data: invoices, error: invErr } = await supabase
        .from('invoices')
        .select('*')
        .order('created_at', { ascending: false });

      if (invoices && invoices.length > 0) {
        this.cache.invoices = invoices.map((inv: any) => ({
          id: inv.id,
          invoiceNo: inv.invoice_no,
          subscriberUsername: inv.subscriber_username,
          agentId: inv.assigned_agent_id || '',
          amount: Number(inv.amount) || 0,
          dueDate: inv.due_date,
          status: (inv.status || 'DUE').toUpperCase() === 'PAID' ? 'PAID' : 'DUE',
          createdDate: inv.created_at || new Date().toISOString(),
          cycleDay: inv.cycle_day || 5,
          paidDate: inv.paid_at || undefined,
        }));
        await this.persistInvoices();
        this.emitChange('invoices');
      }

      // 3. Sync tickets
      const { data: tickets, error: tickErr } = await supabase
        .from('tickets')
        .select('*')
        .order('created_at', { ascending: false });

      if (tickets && tickets.length > 0) {
        this.cache.tickets = tickets.map((t: any) => ({
          id: t.id,
          ticketNo: t.ticket_no,
          subscriberUsername: t.subscriber_username,
          agentId: t.assigned_agent_id || '',
          issue: t.issue,
          priority: (t.priority || 'MEDIUM').toUpperCase() as any,
          status: (t.status || 'OPEN').toUpperCase() === 'RESOLVED' ? 'RESOLVED' : 'OPEN',
          createdAt: t.created_at || new Date().toISOString(),
        }));
        await this.persistTickets();
        this.emitChange('tickets');
      }
    } catch (err) {
      console.warn('[StorageService] Error syncing with Supabase:', err);
    }
  }

  private realtimeSubscribed = false;
  private setupSupabaseRealtime(): void {
    if (this.realtimeSubscribed || typeof window === 'undefined') return;
    try {
      this.realtimeSubscribed = true;
      supabase
        .channel('public:storage_live_sync')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'portal_users' }, () => {
          this.syncWithSupabase();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices' }, () => {
          this.syncWithSupabase();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, () => {
          this.syncWithSupabase();
        })
        .subscribe();
    } catch (err) {
      console.warn('[StorageService] Realtime subscription notice:', err);
    }
  }

  private openIndexedDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event: any) => {
        const db: IDBDatabase = event.target.result;

        if (!db.objectStoreNames.contains('portal_users')) {
          const userStore = db.createObjectStore('portal_users', { keyPath: 'id' });
          userStore.createIndex('username', 'username', { unique: false });
          userStore.createIndex('role', 'role', { unique: false });
        }

        if (!db.objectStoreNames.contains('bandwidth_profiles')) {
          const profStore = db.createObjectStore('bandwidth_profiles', { keyPath: 'id' });
          profStore.createIndex('name', 'name', { unique: false });
        }

        if (!db.objectStoreNames.contains('invoices')) {
          const invStore = db.createObjectStore('invoices', { keyPath: 'id' });
          invStore.createIndex('subscriberUsername', 'subscriberUsername', { unique: false });
          invStore.createIndex('agentId', 'agentId', { unique: false });
          invStore.createIndex('status', 'status', { unique: false });
        }

        if (!db.objectStoreNames.contains('tickets')) {
          const tickStore = db.createObjectStore('tickets', { keyPath: 'id' });
          tickStore.createIndex('subscriberUsername', 'subscriberUsername', { unique: false });
          tickStore.createIndex('agentId', 'agentId', { unique: false });
          tickStore.createIndex('status', 'status', { unique: false });
        }

        if (!db.objectStoreNames.contains('consumption_logs')) {
          db.createObjectStore('consumption_logs', { keyPath: 'username' });
        }

        if (!db.objectStoreNames.contains('audit_logs')) {
          const auditStore = db.createObjectStore('audit_logs', { keyPath: 'id' });
          auditStore.createIndex('timestamp', 'timestamp', { unique: false });
          auditStore.createIndex('actionType', 'actionType', { unique: false });
          auditStore.createIndex('actor', 'actor', { unique: false });
          auditStore.createIndex('severity', 'severity', { unique: false });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private async syncFromIndexedDB(): Promise<void> {
    if (!this.db) return;

    try {
      const users = await this.getAllFromStore<PortalUser>('portal_users');
      if (users.length > 0) this.cache.portal_users = users;

      const profiles = await this.getAllFromStore<BandwidthProfile>('bandwidth_profiles');
      if (profiles.length > 0) this.cache.bandwidth_profiles = profiles;

      const invoices = await this.getAllFromStore<StorageInvoice>('invoices');
      if (invoices.length > 0) this.cache.invoices = invoices;

      const tickets = await this.getAllFromStore<StorageTicket>('tickets');
      if (tickets.length > 0) this.cache.tickets = tickets;

      const logs = await this.getAllFromStore<ConsumptionLog>('consumption_logs');
      logs.forEach((log) => this.cache.consumption_logs.set(log.username, log));

      const audits = await this.getAllFromStore<AuditLogEntry>('audit_logs');
      if (audits.length > 0) this.cache.audit_logs = audits;
    } catch (e) {
      console.warn('[StorageService] Error reading from IndexedDB:', e);
    }
  }

  private getAllFromStore<T>(storeName: string): Promise<T[]> {
    return new Promise((resolve) => {
      if (!this.db) return resolve([]);
      try {
        const tx = this.db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
  }

  private loadFromLocalStorageFallback() {
    if (typeof window === 'undefined') return;

    try {
      const u = localStorage.getItem('youthnet_portal_users') || localStorage.getItem('youthnet_db_portal_users');
      if (u) {
        const parsed = JSON.parse(u);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.cache.portal_users = parsed;
        }
      }

      const p = localStorage.getItem('youthnet_db_bandwidth_profiles');
      if (p) {
        const parsed = JSON.parse(p);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.cache.bandwidth_profiles = parsed;
        }
      }

      const inv = localStorage.getItem('youthnet_invoices') || localStorage.getItem('youthnet_db_invoices');
      if (inv) {
        const parsed = JSON.parse(inv);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.cache.invoices = parsed;
        }
      }

      const t = localStorage.getItem('youthnet_complaints') || localStorage.getItem('youthnet_db_tickets');
      if (t) {
        const parsed = JSON.parse(t);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.cache.tickets = parsed;
        }
      }

      const l = localStorage.getItem('youthnet_db_consumption_logs');
      if (l) {
        const parsed = JSON.parse(l);
        if (Array.isArray(parsed)) {
          parsed.forEach((item: ConsumptionLog) => this.cache.consumption_logs.set(item.username, item));
        }
      }

      const a = localStorage.getItem('youthnet_db_audit_logs');
      if (a) {
        const parsed = JSON.parse(a);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.cache.audit_logs = parsed;
        }
      }
    } catch {}
  }

  private emitChange(entity: string) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('youthnet_storage_updated', { detail: { entity } }));
    }
  }

  // ==================== PORTAL USERS ====================
  public getPortalUsers(): PortalUser[] {
    return [...this.cache.portal_users];
  }

  public getPortalUserByUsername(username: string): PortalUser | undefined {
    const clean = username.trim().toLowerCase();
    return this.cache.portal_users.find(
      (u) => u.username.toLowerCase() === clean
    );
  }

  public getPortalUserById(id: string): PortalUser | undefined {
    return this.cache.portal_users.find((u) => u.id === id);
  }

  public getUsersByRole(role: 'ADMIN' | 'MANAGER' | 'AGENT' | 'CLIENT'): PortalUser[] {
    return this.cache.portal_users.filter((u) => u.role === role);
  }

  public async savePortalUser(user: PortalUser): Promise<void> {
    const index = this.cache.portal_users.findIndex(
      (u) => u.id === user.id || u.username.toLowerCase() === user.username.toLowerCase()
    );

    if (index >= 0) {
      this.cache.portal_users[index] = { ...this.cache.portal_users[index], ...user };
    } else {
      this.cache.portal_users.push(user);
    }

    await this.persistPortalUsers();
    this.emitChange('portal_users');

    // Supabase PostgreSQL insert/upsert
    try {
      const cleanUser = (user.username || '').trim().toLowerCase();
      const payload: any = {
        username: cleanUser,
        password: user.password || 'client123',
        role: user.role,
        full_name: user.fullName || user.username,
        phone: user.phone || '+92 300 0000000',
        area: user.area || 'Sector G-11',
        base_salary: user.baseSalary || 0,
        cash_in_hand: user.balance || 0,
        created_at: user.createdAt || new Date().toISOString(),
      };
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.id)) {
        payload.id = user.id;
      }
      await supabase.from('portal_users').upsert([payload], { onConflict: 'username' });
    } catch (err) {
      console.warn('[StorageService] Supabase savePortalUser notice:', err);
    }
  }

  public async deletePortalUser(id: string): Promise<void> {
    this.cache.portal_users = this.cache.portal_users.filter((u) => u.id !== id && u.username !== id);
    await this.persistPortalUsers();
    this.emitChange('portal_users');

    try {
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        await supabase.from('portal_users').delete().eq('id', id);
      } else {
        await supabase.from('portal_users').delete().eq('username', id);
      }
    } catch {}
  }

  private async persistPortalUsers(): Promise<void> {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('youthnet_portal_users', JSON.stringify(this.cache.portal_users));
        localStorage.setItem('youthnet_db_portal_users', JSON.stringify(this.cache.portal_users));
      } catch {}
    }

    if (this.db) {
      try {
        const tx = this.db.transaction('portal_users', 'readwrite');
        const store = tx.objectStore('portal_users');
        for (const user of this.cache.portal_users) {
          store.put(user);
        }
      } catch {}
    }
  }

  // ==================== BANDWIDTH PROFILES ====================
  public getBandwidthProfiles(): BandwidthProfile[] {
    return [...this.cache.bandwidth_profiles];
  }

  public getProfileByName(name: string): BandwidthProfile | undefined {
    return this.cache.bandwidth_profiles.find(
      (p) => p.name.toLowerCase() === name.toLowerCase()
    );
  }

  public async saveBandwidthProfile(profile: BandwidthProfile): Promise<void> {
    const index = this.cache.bandwidth_profiles.findIndex(
      (p) => p.id === profile.id || p.name.toLowerCase() === profile.name.toLowerCase()
    );

    if (index >= 0) {
      this.cache.bandwidth_profiles[index] = { ...this.cache.bandwidth_profiles[index], ...profile };
    } else {
      this.cache.bandwidth_profiles.push(profile);
    }

    await this.persistBandwidthProfiles();
    this.emitChange('bandwidth_profiles');
  }

  /**
   * Syncs dynamic RouterOS PPP profiles into bandwidth_profiles repository
   */
  public async syncRouterOSProfiles(profiles: Array<{ name: string; rateLimit?: string }>): Promise<void> {
    let changed = false;
    for (const p of profiles) {
      if (!p.name) continue;
      const existing = this.getProfileByName(p.name);
      if (!existing) {
        // Derive reasonable price estimate from rateLimit (e.g. 10M -> Rs 1500)
        let price = 2000;
        const rateMatch = (p.rateLimit || '').match(/(\d+)M/i);
        if (rateMatch) {
          const mbps = parseInt(rateMatch[1], 10);
          price = mbps <= 5 ? 1000 : mbps <= 10 ? 1500 : mbps <= 20 ? 2500 : mbps <= 50 ? 4000 : 7500;
        } else if (p.name.toLowerCase().includes('expired')) {
          price = 0;
        }

        const newProf: BandwidthProfile = {
          id: `prof-${p.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
          name: p.name,
          rateLimit: p.rateLimit || '20M/20M',
          pricePkr: price,
        };
        this.cache.bandwidth_profiles.push(newProf);
        changed = true;
      } else if (p.rateLimit && p.rateLimit !== existing.rateLimit) {
        existing.rateLimit = p.rateLimit;
        changed = true;
      }
    }

    if (changed) {
      await this.persistBandwidthProfiles();
      this.emitChange('bandwidth_profiles');
    }
  }

  private async persistBandwidthProfiles(): Promise<void> {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('youthnet_db_bandwidth_profiles', JSON.stringify(this.cache.bandwidth_profiles));
      } catch {}
    }

    if (this.db) {
      try {
        const tx = this.db.transaction('bandwidth_profiles', 'readwrite');
        const store = tx.objectStore('bandwidth_profiles');
        for (const p of this.cache.bandwidth_profiles) {
          store.put(p);
        }
      } catch {}
    }
  }

  // ==================== INVOICES ====================
  public getInvoices(): StorageInvoice[] {
    return [...this.cache.invoices];
  }

  public getInvoicesBySubscriber(username: string): StorageInvoice[] {
    const clean = username.trim().toLowerCase();
    return this.cache.invoices.filter(
      (inv) => inv.subscriberUsername?.toLowerCase() === clean
    );
  }

  public getInvoicesByAgent(agentId: string): StorageInvoice[] {
    return this.cache.invoices.filter((inv) => inv.agentId === agentId);
  }

  public async saveInvoice(invoice: StorageInvoice): Promise<void> {
    const index = this.cache.invoices.findIndex((inv) => inv.id === invoice.id || inv.invoiceNo === invoice.invoiceNo);
    if (index >= 0) {
      this.cache.invoices[index] = { ...this.cache.invoices[index], ...invoice };
    } else {
      this.cache.invoices.unshift(invoice);
    }

    await this.persistInvoices();
    this.emitChange('invoices');

    // Supabase INSERT directly into invoices
    try {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(invoice.id);
      const payload: any = {
        invoice_no: invoice.invoiceNo,
        subscriber_username: invoice.subscriberUsername,
        amount: invoice.amount,
        due_date: invoice.dueDate,
        status: invoice.status === 'PAID' ? 'PAID' : 'DUE',
        cycle_day: invoice.cycleDay || 5,
        created_at: invoice.createdDate || new Date().toISOString(),
        paid_at: invoice.paidDate || null,
        assigned_agent_id: invoice.agentId || null,
      };
      if (isUuid) {
        payload.id = invoice.id;
      }
      await supabase.from('invoices').insert([payload]);
    } catch (err) {
      console.warn('[StorageService] Supabase saveInvoice error:', err);
    }
  }

  public async markInvoicePaid(
    invoiceId: string,
    paymentMethod: string = 'CASH',
    receiptNumber?: string,
    collectingAgentId?: string
  ): Promise<StorageInvoice | null> {
    const inv = this.cache.invoices.find((i) => i.id === invoiceId || i.invoiceNo === invoiceId);
    if (!inv) return null;

    inv.status = 'PAID';
    inv.paidDate = new Date().toISOString();
    inv.paymentMethod = paymentMethod;
    inv.receiptNumber = receiptNumber || `REC-${Date.now().toString().slice(-6)}`;
    if (collectingAgentId) {
      inv.agentId = collectingAgentId;
    }

    // Update subscriber balance
    const user = this.getPortalUserByUsername(inv.subscriberUsername);
    if (user) {
      user.balance = Math.max(0, (user.balance || 0) - inv.amount);
      await this.savePortalUser(user);
    }

    await this.persistInvoices();
    this.emitChange('invoices');

    // Supabase update: mark paid and update collecting agent's cash_in_hand
    try {
      const nowIso = new Date().toISOString();
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(invoiceId);
      if (isUuid) {
        await supabase.from('invoices').update({ status: 'PAID', paid_at: nowIso }).eq('id', invoiceId);
      } else {
        await supabase.from('invoices').update({ status: 'PAID', paid_at: nowIso }).eq('invoice_no', invoiceId);
      }

      // Update collecting agent cash_in_hand
      const targetAgentId = collectingAgentId || inv.agentId;
      if (targetAgentId) {
        const { data: agentRecord } = await supabase
          .from('portal_users')
          .select('id, cash_in_hand')
          .or(`id.eq.${targetAgentId},username.ilike.${targetAgentId}`)
          .maybeSingle();

        if (agentRecord) {
          const updatedCash = (Number(agentRecord.cash_in_hand) || 0) + Number(inv.amount);
          await supabase.from('portal_users').update({ cash_in_hand: updatedCash }).eq('id', agentRecord.id);
        }
      }
    } catch (err) {
      console.warn('[StorageService] Supabase markInvoicePaid error:', err);
    }

    return inv;
  }

  public async deleteInvoice(id: string): Promise<void> {
    this.cache.invoices = this.cache.invoices.filter((i) => i.id !== id && i.invoiceNo !== id);
    await this.persistInvoices();
    this.emitChange('invoices');

    try {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
      if (isUuid) {
        await supabase.from('invoices').delete().eq('id', id);
      } else {
        await supabase.from('invoices').delete().eq('invoice_no', id);
      }
    } catch {}
  }

  /**
   * Computes dynamic cash-in-hand collected by a field agent
   */
  public getAgentCashInHand(agentId: string): number {
    return this.cache.invoices
      .filter((inv) => inv.agentId === agentId && inv.status === 'PAID')
      .reduce((sum, inv) => sum + (Number(inv.amount) || 0), 0);
  }

  private async persistInvoices(): Promise<void> {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('youthnet_invoices', JSON.stringify(this.cache.invoices));
        localStorage.setItem('youthnet_db_invoices', JSON.stringify(this.cache.invoices));
      } catch {}
    }

    if (this.db) {
      try {
        const tx = this.db.transaction('invoices', 'readwrite');
        const store = tx.objectStore('invoices');
        for (const inv of this.cache.invoices) {
          store.put(inv);
        }
      } catch {}
    }
  }

  // ==================== SLA TICKETS ====================
  public getTickets(): StorageTicket[] {
    return [...this.cache.tickets];
  }

  public getTicketsBySubscriber(username: string): StorageTicket[] {
    const clean = username.trim().toLowerCase();
    return this.cache.tickets.filter((t) => t.subscriberUsername?.toLowerCase() === clean);
  }

  public getTicketsByAgent(agentId: string): StorageTicket[] {
    return this.cache.tickets.filter((t) => t.agentId === agentId);
  }

  public async saveTicket(ticket: StorageTicket): Promise<void> {
    const index = this.cache.tickets.findIndex((t) => t.id === ticket.id || t.ticketNo === ticket.ticketNo);
    if (index >= 0) {
      this.cache.tickets[index] = { ...this.cache.tickets[index], ...ticket };
    } else {
      this.cache.tickets.unshift(ticket);
    }

    await this.persistTickets();
    this.emitChange('tickets');

    // Supabase ticket persistence
    try {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ticket.id);
      const payload: any = {
        ticket_no: ticket.ticketNo,
        subscriber_username: ticket.subscriberUsername,
        issue: ticket.issue,
        priority: ticket.priority,
        status: ticket.status === 'RESOLVED' ? 'RESOLVED' : 'OPEN',
        created_at: ticket.createdAt || new Date().toISOString(),
        assigned_agent_id: ticket.agentId || null,
      };
      if (isUuid) {
        payload.id = ticket.id;
      }
      await supabase.from('tickets').insert([payload]);
    } catch (err) {
      console.warn('[StorageService] Supabase saveTicket error:', err);
    }
  }

  public async resolveTicket(ticketId: string, resolutionNotes: string = 'Resolved by technician'): Promise<void> {
    const t = this.cache.tickets.find((tick) => tick.id === ticketId || tick.ticketNo === ticketId);
    if (!t) return;

    t.status = 'RESOLVED';
    t.resolutionNotes = resolutionNotes;
    t.resolvedAt = new Date().toISOString();

    await this.persistTickets();
    this.emitChange('tickets');

    // Supabase update ticket status
    try {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ticketId);
      if (isUuid) {
        await supabase.from('tickets').update({ status: 'RESOLVED' }).eq('id', ticketId);
      } else {
        await supabase.from('tickets').update({ status: 'RESOLVED' }).eq('ticket_no', ticketId);
      }
    } catch (err) {
      console.warn('[StorageService] Supabase resolveTicket error:', err);
    }
  }

  private async persistTickets(): Promise<void> {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('youthnet_complaints', JSON.stringify(this.cache.tickets));
        localStorage.setItem('youthnet_db_tickets', JSON.stringify(this.cache.tickets));
      } catch {}
    }

    if (this.db) {
      try {
        const tx = this.db.transaction('tickets', 'readwrite');
        const store = tx.objectStore('tickets');
        for (const t of this.cache.tickets) {
          store.put(t);
        }
      } catch {}
    }
  }

  // ==================== CONSUMPTION LOGS ====================
  public getConsumptionLog(username: string): ConsumptionLog | undefined {
    return this.cache.consumption_logs.get(username.trim().toLowerCase());
  }

  public getAllConsumptionLogs(): ConsumptionLog[] {
    return Array.from(this.cache.consumption_logs.values());
  }

  public async saveConsumptionLog(log: ConsumptionLog): Promise<void> {
    const clean = log.username.trim().toLowerCase();
    this.cache.consumption_logs.set(clean, log);

    if (typeof window !== 'undefined') {
      try {
        const arr = Array.from(this.cache.consumption_logs.values());
        localStorage.setItem('youthnet_db_consumption_logs', JSON.stringify(arr));
      } catch {}
    }

    if (this.db) {
      try {
        const tx = this.db.transaction('consumption_logs', 'readwrite');
        tx.objectStore('consumption_logs').put(log);
      } catch {}
    }

    this.emitChange('consumption_logs');
  }

  // ==================== ACTIVITY & AUDIT LOGS ====================
  public getAuditLogs(filter?: {
    actionType?: string;
    severity?: string;
    actor?: string;
    search?: string;
  }): AuditLogEntry[] {
    let list = [...this.cache.audit_logs];

    // Sort descending by timestamp
    list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    if (filter) {
      if (filter.actionType && filter.actionType !== 'ALL') {
        list = list.filter((l) => l.actionType === filter.actionType);
      }
      if (filter.severity && filter.severity !== 'ALL') {
        list = list.filter((l) => l.severity === filter.severity);
      }
      if (filter.actor && filter.actor !== 'ALL') {
        list = list.filter((l) => l.actor.toLowerCase() === filter.actor!.toLowerCase());
      }
      if (filter.search && filter.search.trim()) {
        const q = filter.search.trim().toLowerCase();
        list = list.filter(
          (l) =>
            l.actionTitle.toLowerCase().includes(q) ||
            l.actionType.toLowerCase().includes(q) ||
            l.actor.toLowerCase().includes(q) ||
            (l.target && l.target.toLowerCase().includes(q)) ||
            (l.ipAddress && l.ipAddress.includes(q)) ||
            (l.details && l.details.toLowerCase().includes(q))
        );
      }
    }

    return list;
  }

  public logAuditEvent(entry: Omit<AuditLogEntry, 'id' | 'timestamp'> & { id?: string; timestamp?: string }): AuditLogEntry {
    const fullEntry: AuditLogEntry = {
      id: entry.id || `audit-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: entry.timestamp || new Date().toISOString(),
      actor: entry.actor || 'system',
      actorRole: entry.actorRole || 'SYSTEM',
      actionType: entry.actionType,
      actionTitle: entry.actionTitle,
      target: entry.target,
      severity: entry.severity || 'INFO',
      ipAddress: entry.ipAddress || (typeof window !== 'undefined' ? window.location.hostname : '127.0.0.1'),
      details: entry.details,
      metadata: entry.metadata,
    };

    // Prepend to memory cache
    this.cache.audit_logs.unshift(fullEntry);

    // Keep max 500 in memory/storage to prevent bloat
    if (this.cache.audit_logs.length > 500) {
      this.cache.audit_logs = this.cache.audit_logs.slice(0, 500);
    }

    this.persistAuditLogs();
    this.emitChange('audit_logs');
    return fullEntry;
  }

  public async clearAuditLogs(): Promise<void> {
    this.cache.audit_logs = [];
    await this.persistAuditLogs();
    this.emitChange('audit_logs');
  }

  public exportAuditLogsJson(): string {
    return JSON.stringify(this.getAuditLogs(), null, 2);
  }

  public exportAuditLogsCsv(): string {
    const logs = this.getAuditLogs();
    const headers = ['Timestamp', 'Actor', 'Role', 'Action Type', 'Title', 'Target', 'Severity', 'IP Address', 'Details'];
    const rows = logs.map((l) => [
      `"${l.timestamp}"`,
      `"${l.actor}"`,
      `"${l.actorRole}"`,
      `"${l.actionType}"`,
      `"${l.actionTitle.replace(/"/g, '""')}"`,
      `"${(l.target || '').replace(/"/g, '""')}"`,
      `"${l.severity}"`,
      `"${l.ipAddress || ''}"`,
      `"${(l.details || '').replace(/"/g, '""')}"`,
    ]);

    return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  }

  private async persistAuditLogs(): Promise<void> {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('youthnet_db_audit_logs', JSON.stringify(this.cache.audit_logs));
      } catch {}
    }

    if (this.db) {
      try {
        const tx = this.db.transaction('audit_logs', 'readwrite');
        const store = tx.objectStore('audit_logs');
        for (const a of this.cache.audit_logs) {
          store.put(a);
        }
      } catch {}
    }
  }
}

// Global Singleton Export
export const storageService = new StorageService();
