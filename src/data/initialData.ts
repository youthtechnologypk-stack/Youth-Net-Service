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
} from '../types/isp';

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

export const INITIAL_ROUTERS: MikrotikRouter[] = [
  {
    id: 'rt-1',
    name: 'BRAS-CCR2004-CORE-NOC',
    model: 'MikroTik CCR2004-16G-2S+',
    ipAddress: '202.142.186.150',
    ip: '202.142.186.150',
    apiPort: 8729,
    port: 8729,
    username: 'admin',
    password: '',
    useSsl: true,
    version: 'RouterOS v7.16.2',
    location: 'Central NOC Data Center - Rack 04',
    cpuLoad: 0,
    memoryUsageMb: 0,
    totalMemoryMb: 4096,
    uptime: '0s',
    status: 'unreachable',
    wanInterface: 'WAN3',
    currentWanRxMbps: 0,
    currentWanTxMbps: 0,
    activePppoeCount: 0,
    walledGardenPool: '172.16.100.0/24',
  },
];

export const INITIAL_AGENTS: FieldAgent[] = [
  {
    id: 'agent-1',
    name: 'Bilal Khan',
    phone: '+92 301 5550192',
    email: 'bilal.field@netpulse.io',
    assignedArea: 'Sector G-11 & F-11',
    status: 'on_field',
    cashInHand: 0.0,
    totalCollectedToday: 0.0,
    activeTicketsAssigned: 0,
    baseSalary: 650.0,
    advanceSalaryTaken: 0.0,
    advanceSalaryReturned: 0.0,
  },
  {
    id: 'agent-2',
    name: 'Tariq Mehmood',
    phone: '+92 312 8884910',
    email: 'tariq.splicer@netpulse.io',
    assignedArea: 'Sector I-8 & H-8',
    status: 'on_field',
    cashInHand: 0.0,
    totalCollectedToday: 0.0,
    activeTicketsAssigned: 0,
    baseSalary: 600.0,
    advanceSalaryTaken: 0.0,
    advanceSalaryReturned: 0.0,
  },
  {
    id: 'agent-3',
    name: 'Hamza Farooq',
    phone: '+92 333 4441093',
    email: 'hamza.recovery@netpulse.io',
    assignedArea: 'Blue Area Commercial Node',
    status: 'active',
    cashInHand: 0.0,
    totalCollectedToday: 0.0,
    activeTicketsAssigned: 0,
    baseSalary: 700.0,
    advanceSalaryTaken: 0.0,
    advanceSalaryReturned: 0.0,
  },
];

export const INITIAL_CUSTOMERS: Customer[] = [];

export const INITIAL_ACTIVE_SESSIONS: ActiveSession[] = [];

export const INITIAL_INVOICES: Invoice[] = [];

export const INITIAL_COMPLAINTS: ComplaintTicket[] = [];

export const INITIAL_OUTAGES: AreaOutage[] = [];

export const INITIAL_EXPENSES: IspExpense[] = [];

export const INITIAL_WHATSAPP_LOGS: WhatsAppNotificationLog[] = [];
