import {
  Customer,
  InternetPackage,
  MikrotikRouter,
  ActiveSession,
  Invoice,
  ComplaintTicket,
  FieldAgent,
  AreaOutage,
  IspExpense,
  WhatsAppNotificationLog,
} from '../types/isp.ts';

export const INITIAL_PACKAGES: InternetPackage[] = [
  {
    id: 'pkg-1',
    name: '20 Mbps Home Starter',
    downloadSpeedMbps: 20,
    uploadSpeedMbps: 20,
    priceMonthly: 25.0,
    mikrotikProfile: '20M_Home_Profile',
    dataLimitGb: null,
  },
  {
    id: 'pkg-2',
    name: '50 Mbps Turbo Gamer',
    downloadSpeedMbps: 50,
    uploadSpeedMbps: 50,
    priceMonthly: 45.0,
    mikrotikProfile: '50M_Turbo_Profile',
    dataLimitGb: null,
    isPopular: true,
  },
  {
    id: 'pkg-3',
    name: '100 Mbps Ultra Stream',
    downloadSpeedMbps: 100,
    uploadSpeedMbps: 100,
    priceMonthly: 75.0,
    mikrotikProfile: '100M_Ultra_Profile',
    dataLimitGb: null,
  },
  {
    id: 'pkg-4',
    name: '300 Mbps Enterprise Lease',
    downloadSpeedMbps: 300,
    uploadSpeedMbps: 300,
    priceMonthly: 190.0,
    mikrotikProfile: '300M_Enterprise_Profile',
    dataLimitGb: null,
  },
  {
    id: 'pkg-wg',
    name: 'Walled Garden Restricted (512Kbps)',
    downloadSpeedMbps: 0.5,
    uploadSpeedMbps: 0.5,
    priceMonthly: 0.0,
    mikrotikProfile: 'Walled_Garden_Pool',
    dataLimitGb: 1,
  },
];

const DEFAULT_MIKROTIK_HOST =
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_MIKROTIK_HOST) ||
  '202.142.186.150';
const DEFAULT_MIKROTIK_PORT =
  Number((typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_MIKROTIK_PORT) || 81) ||
  81;
const DEFAULT_MIKROTIK_USER =
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_MIKROTIK_USER) ||
  'admin';
const DEFAULT_MIKROTIK_PASS =
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_MIKROTIK_PASSWORD) ||
  '';

export const INITIAL_ROUTERS: MikrotikRouter[] = [
  {
    id: 'rt-saddar',
    name: 'SADDAR',
    model: 'MikroTik CCR2004-16G-2S+',
    ipAddress: DEFAULT_MIKROTIK_HOST,
    ip: DEFAULT_MIKROTIK_HOST,
    apiPort: DEFAULT_MIKROTIK_PORT,
    port: DEFAULT_MIKROTIK_PORT,
    username: DEFAULT_MIKROTIK_USER,
    password: DEFAULT_MIKROTIK_PASS,
    useSsl: DEFAULT_MIKROTIK_PORT === 443,
    version: 'RouterOS v7.16.2',
    location: 'Saddar Core NOC',
    cpuLoad: 0,
    memoryUsageMb: 0,
    totalMemoryMb: 4096,
    uptime: '0s',
    status: 'unreachable',
    wanInterface: 'WAN3',
    currentWanRxMbps: 0,
    currentWanTxMbps: 0,
    activePppoeCount: 0,
    walledGardenPool: '16.16.16.0/24',
    proxyMode: 'proxy',
    isDefault: true,
  },
];

export const INITIAL_AGENTS: FieldAgent[] = [];

export const INITIAL_CUSTOMERS: Customer[] = [];

export const INITIAL_ACTIVE_SESSIONS: ActiveSession[] = [];

export const INITIAL_INVOICES: Invoice[] = [];

export const INITIAL_COMPLAINTS: ComplaintTicket[] = [];

export const INITIAL_OUTAGES: AreaOutage[] = [];

export const INITIAL_EXPENSES: IspExpense[] = [];

export const INITIAL_WHATSAPP_LOGS: WhatsAppNotificationLog[] = [];
