import { MikrotikRouter, ActiveSession, RouterInterface, InternetPackage } from '../types/isp';

export interface BandwidthDataPoint {
  time: string;
  rxMbps: number;
  txMbps: number;
}

export interface RouterTelemetryState {
  routerId: string;
  sessions: ActiveSession[];
  interfaces: RouterInterface[];
  bandwidthHistory: BandwidthDataPoint[];
  cpuLoad: number;
  memoryUsageMb: number;
  totalMemoryMb: number;
  uptime: string;
  currentWanRxMbps: number;
  currentWanTxMbps: number;
}

const STORAGE_PREFIX_SESSIONS = 'router_telemetry_sessions_';
const STORAGE_PREFIX_INTERFACES = 'router_telemetry_interfaces_';
const STORAGE_PREFIX_BANDWIDTH = 'router_telemetry_bandwidth_';

// Pakistani & enterprise subscriber names pool for realistic simulation
const SUBSCRIBER_PROFILES = [
  { name: 'Dr. Imran Hashmi (Medical Clinic)', userPrefix: 'dr_imran', profile: '100M_Ultra_Profile', weight: 45 },
  { name: 'Al-Rehman Traders Markaz', userPrefix: 'al_rehman_trd', profile: '100M_Ultra_Profile', weight: 65 },
  { name: 'Apex Digital Creative Studio', userPrefix: 'apex_studio', profile: '300M_Enterprise_Profile', weight: 140 },
  { name: 'Fatima Noor Residence', userPrefix: 'fatima_noor', profile: '20M_Home_Profile', weight: 14 },
  { name: 'CyberZone Gaming & Net Cafe', userPrefix: 'cyberzone_pk', profile: '300M_Enterprise_Profile', weight: 185 },
  { name: 'Usman Ali Fiber Home', userPrefix: 'usman_ali', profile: '50M_Turbo_Profile', weight: 32 },
  { name: 'Qureshi Mart POS Terminal', userPrefix: 'qureshi_pos', profile: '20M_Home_Profile', weight: 12 },
  { name: 'Skyline Real Estate Office', userPrefix: 'skyline_prop', profile: '50M_Turbo_Profile', weight: 28 },
  { name: 'Hassan Telecom Distribution', userPrefix: 'hassan_dist', profile: '100M_Ultra_Profile', weight: 70 },
  { name: 'Ayesha Siddiqua Fiber Home', userPrefix: 'ayesha_sid', profile: '50M_Turbo_Profile', weight: 26 },
  { name: 'Hamza Farooq Smart Home', userPrefix: 'hamza_farooq', profile: '20M_Home_Profile', weight: 15 },
  { name: 'Shahid Mehmood Electronics', userPrefix: 'shahid_elec', profile: '50M_Turbo_Profile', weight: 35 },
  { name: 'Khyber Shinwari Restaurant', userPrefix: 'khyber_shinwari', profile: '100M_Ultra_Profile', weight: 55 },
  { name: 'Zeeshan Akhtar Studio', userPrefix: 'zeeshan_akt', profile: '50M_Turbo_Profile', weight: 30 },
  { name: 'Crown Pharmacy 24/7', userPrefix: 'crown_pharm', profile: '20M_Home_Profile', weight: 18 },
  { name: 'Islamabad Model College Lab', userPrefix: 'imc_lab_net', profile: '300M_Enterprise_Profile', weight: 160 },
  { name: 'Bilal Khan Corporate Fiber', userPrefix: 'bilal_corp', profile: '100M_Ultra_Profile', weight: 80 },
  { name: 'Zubair Autos Workshop', userPrefix: 'zubair_autos', profile: '20M_Home_Profile', weight: 16 },
  { name: 'Tariq Javed Residence', userPrefix: 'tariq_javed', profile: '50M_Turbo_Profile', weight: 24 },
  { name: 'Al-Madina Departmental Store', userPrefix: 'almadina_store', profile: '100M_Ultra_Profile', weight: 60 },
  { name: 'Mustafa Law Associates', userPrefix: 'mustafa_law', profile: '50M_Turbo_Profile', weight: 25 },
  { name: 'Pak-China Logistics Hub', userPrefix: 'pakchina_log', profile: '300M_Enterprise_Profile', weight: 175 },
  { name: 'Raza Dental Care Facility', userPrefix: 'raza_dental', profile: '50M_Turbo_Profile', weight: 34 },
  { name: 'Nova Diagnostic Pathology', userPrefix: 'nova_diag', profile: '100M_Ultra_Profile', weight: 58 },
];

function generateMac(seed: number): string {
  const hex = (val: number) => val.toString(16).padStart(2, '0').toUpperCase();
  const b1 = '48';
  const b2 = '8F';
  const b3 = hex((seed * 17 + 23) % 256);
  const b4 = hex((seed * 31 + 47) % 256);
  const b5 = hex((seed * 53 + 89) % 256);
  const b6 = hex((seed * 97 + 131) % 256);
  return `${b1}:${b2}:${b3}:${b4}:${b5}:${b6}`;
}

function parseSubnetBase(ip: string): string {
  const parts = ip.split('.');
  if (parts.length === 4) {
    return `${parts[0]}.${parts[1]}.${parts[2]}`;
  }
  return '10.200.1';
}

/**
 * Generate full realistic interface inventory for any MikroTik RouterOS device
 */
export function generateInterfacesForRouter(router: MikrotikRouter): RouterInterface[] {
  const modelUpper = (router.model || '').toUpperCase();
  const isCcr = modelUpper.includes('CCR');
  const isRb = modelUpper.includes('RB');
  const wanName = router.wanInterface || (isCcr ? 'sfp-sfpplus1' : 'ether1');
  const routerSubnet = parseSubnetBase(router.ipAddress);

  const interfaces: RouterInterface[] = [];

  // 1. WAN Uplink Interface
  interfaces.push({
    id: `if-${router.id}-wan`,
    name: wanName,
    type: wanName.startsWith('sfp') ? 'sfp-sfpplus' : 'ether',
    status: 'running',
    running: true,
    disabled: false,
    comment: 'Primary Upstream Carrier Transit (Cogent / PTCL Tier-1 Uplink)',
    macAddress: generateMac(101),
    mtu: 1500,
    actualMtu: 1500,
    linkSpeed: wanName.startsWith('sfp') ? '10Gbps' : '1Gbps',
    fullDuplex: true,
    rxBytes: 48920140291,
    txBytes: 19284019284,
    rxRateMbps: router.currentWanRxMbps || 1240,
    txRateMbps: router.currentWanTxMbps || 580,
    routerId: router.id,
  });

  // 2. Secondary SFP+ Trunk / Metro Ring (if CCR or high-end)
  if (isCcr || wanName !== 'sfp-sfpplus2') {
    interfaces.push({
      id: `if-${router.id}-sfp2`,
      name: 'sfp-sfpplus2',
      type: 'sfp-sfpplus',
      status: 'running',
      running: true,
      disabled: false,
      comment: '10G Metro Ring Distribution Trunk (Sector Aggregation)',
      macAddress: generateMac(102),
      mtu: 1500,
      actualMtu: 1500,
      linkSpeed: '10Gbps',
      fullDuplex: true,
      rxBytes: 28410294102,
      txBytes: 11204910294,
      rxRateMbps: 340.5,
      txRateMbps: 125.2,
      routerId: router.id,
    });
  }

  // 3. PPPoE Subscriber Bridge
  interfaces.push({
    id: `if-${router.id}-bridge`,
    name: 'bridge-bng-subscribers',
    type: 'bridge',
    status: 'running',
    running: true,
    disabled: false,
    comment: 'Core PPPoE Subscriber Aggregation & VLAN Concentrator',
    macAddress: generateMac(103),
    mtu: 1500,
    actualMtu: 1500,
    linkSpeed: '10Gbps',
    fullDuplex: true,
    rxBytes: 74920194820,
    txBytes: 30482019482,
    rxRateMbps: router.currentWanRxMbps || 1240,
    txRateMbps: router.currentWanTxMbps || 580,
    routerId: router.id,
  });

  // 4. Physical Gigabit Ethernet Ports (OLT Uplinks, Management, Hotspot)
  const ethConfigs = [
    { name: 'ether1', comment: 'VSOL GPON OLT 01 Uplink (North Sector)', speed: '1Gbps', status: 'running' as const, rx: 280, tx: 95 },
    { name: 'ether2', comment: 'VSOL EPON OLT 02 Uplink (South Sector)', speed: '1Gbps', status: 'running' as const, rx: 245, tx: 88 },
    { name: 'ether3', comment: 'Commercial Plaza Dedicated Fiber Switch', speed: '1Gbps', status: 'running' as const, rx: 190, tx: 65 },
    { name: 'ether4', comment: 'NOC Out-of-Band Management & Syslog Server', speed: '1Gbps', status: 'running' as const, rx: 2.5, tx: 1.2 },
    { name: 'ether5', comment: 'Secondary Fiber Backup Gateway (Failover)', speed: '1Gbps', status: 'running' as const, rx: 45, tx: 12 },
    { name: 'ether6', comment: 'Field Agent Station & Testing Node', speed: '1Gbps', status: 'running' as const, rx: 8.4, tx: 3.1 },
    { name: 'ether7', comment: 'Spare Distribution Port (Unassigned)', speed: '1Gbps', status: 'disabled' as const, rx: 0, tx: 0 },
    { name: 'ether8', comment: 'Auxiliary SFP Failover Port (Link Down)', speed: '1Gbps', status: 'link_down' as const, rx: 0, tx: 0 },
  ];

  ethConfigs.forEach((eth, idx) => {
    // If wanName is ether1, don't duplicate
    if (wanName === eth.name) return;

    interfaces.push({
      id: `if-${router.id}-${eth.name}`,
      name: eth.name,
      type: 'ether',
      status: eth.status,
      running: eth.status === 'running',
      disabled: eth.status === 'disabled',
      comment: eth.comment,
      macAddress: generateMac(110 + idx),
      mtu: 1500,
      actualMtu: 1500,
      linkSpeed: eth.speed,
      fullDuplex: true,
      rxBytes: eth.status === 'running' ? 1204910293 + idx * 849201 : 0,
      txBytes: eth.status === 'running' ? 491029482 + idx * 284910 : 0,
      rxRateMbps: eth.rx,
      txRateMbps: eth.tx,
      routerId: router.id,
    });
  });

  return interfaces;
}

/**
 * Generate 18-24 realistic active PPPoE sessions for a router
 */
export function generateSessionsForRouter(
  router: MikrotikRouter,
  packages: InternetPackage[] = []
): ActiveSession[] {
  const subnetBase = parseSubnetBase(router.ipAddress);
  const routerNum = parseInt(router.id.replace(/\D/g, '').slice(-2) || '1', 10);
  const count = 22; // 22 realistic online PPPoE sessions
  const sessions: ActiveSession[] = [];

  const uptimes = [
    '1d 08h 15m',
    '3d 14h 22m',
    '18h 45m',
    '5d 21h 05m',
    '2d 06h 40m',
    '8d 02h 19m',
    '4d 19h 30m',
    '12h 10m',
    '6d 11h 09m',
    '22d 19h 45m',
  ];

  for (let i = 0; i < count; i++) {
    const profileObj = SUBSCRIBER_PROFILES[i % SUBSCRIBER_PROFILES.length];
    const username = `${profileObj.userPrefix}_${routerNum || 1}`;
    const ip = `${subnetBase}.${10 + i}`;
    const uptime = uptimes[i % uptimes.length];
    const mac = generateMac(routerNum * 100 + i);

    // Speed calculation
    const baseWeight = profileObj.weight;
    const jitterRx = (Math.random() * 0.4 + 0.8) * (baseWeight * 0.4);
    const jitterTx = (Math.random() * 0.3 + 0.7) * (baseWeight * 0.12);
    const rxRateMbps = Number(Math.max(1.5, jitterRx).toFixed(1));
    const txRateMbps = Number(Math.max(0.4, jitterTx).toFixed(1));

    const bytesInMb = Math.round(15000 + i * 4200 + Math.random() * 8000);
    const bytesOutMb = Math.round(3800 + i * 1100 + Math.random() * 2400);

    sessions.push({
      id: `*${router.id.slice(-3).toUpperCase()}${i + 1}`,
      username,
      callerId: mac,
      address: ip,
      service: 'pppoe',
      uptime,
      rxRateMbps,
      txRateMbps,
      bytesInMb,
      bytesOutMb,
      routerId: router.id,
      customerName: profileObj.name,
      profileName: profileObj.profile,
      liveRateFormatted: `↓ ${rxRateMbps}M / ↑ ${txRateMbps}M`,
    });
  }

  return sessions;
}

/**
 * Generate initial 15-point bandwidth history for smooth chart visualization
 */
export function generateBandwidthHistory(baseRx = 1240, baseTx = 580): BandwidthDataPoint[] {
  const points: BandwidthDataPoint[] = [];
  const now = Date.now();

  for (let i = 14; i >= 0; i--) {
    const t = new Date(now - i * 4000);
    const time = t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const wave = Math.sin(((14 - i) / 14) * Math.PI * 2);
    const rx = Math.round(baseRx + wave * 90 + (Math.random() - 0.5) * 40);
    const tx = Math.round(baseTx + wave * 40 + (Math.random() - 0.5) * 20);

    points.push({
      time,
      rxMbps: Math.max(100, rx),
      txMbps: Math.max(30, tx),
    });
  }

  return points;
}

/**
 * Save router telemetry to localStorage
 */
export function saveRouterTelemetryToStorage(
  routerId: string,
  sessions: ActiveSession[],
  interfaces: RouterInterface[],
  bandwidthHistory?: BandwidthDataPoint[]
): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_PREFIX_SESSIONS + routerId, JSON.stringify(sessions));
    localStorage.setItem(STORAGE_PREFIX_INTERFACES + routerId, JSON.stringify(interfaces));
    if (bandwidthHistory) {
      localStorage.setItem(STORAGE_PREFIX_BANDWIDTH + routerId, JSON.stringify(bandwidthHistory));
    }
  } catch (e) {
    console.warn(`Failed to store mock telemetry for ${routerId}:`, e);
  }
}

/**
 * Load router telemetry from localStorage
 */
export function loadRouterTelemetryFromStorage(routerId: string): {
  sessions: ActiveSession[];
  interfaces: RouterInterface[];
  bandwidthHistory?: BandwidthDataPoint[];
} | null {
  if (typeof window === 'undefined') return null;
  try {
    const rawSessions = localStorage.getItem(STORAGE_PREFIX_SESSIONS + routerId);
    const rawInterfaces = localStorage.getItem(STORAGE_PREFIX_INTERFACES + routerId);
    const rawBandwidth = localStorage.getItem(STORAGE_PREFIX_BANDWIDTH + routerId);

    if (!rawSessions && !rawInterfaces) return null;

    return {
      sessions: rawSessions ? JSON.parse(rawSessions) : [],
      interfaces: rawInterfaces ? JSON.parse(rawInterfaces) : [],
      bandwidthHistory: rawBandwidth ? JSON.parse(rawBandwidth) : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Real-time Jitter Engine: Simulates live streaming telemetry without requiring a backend TCP socket
 */
export function jitterTelemetryTick(
  router: MikrotikRouter,
  currentSessions: ActiveSession[],
  currentInterfaces: RouterInterface[]
): {
  updatedRouter: MikrotikRouter;
  updatedSessions: ActiveSession[];
  updatedInterfaces: RouterInterface[];
  bandwidthPoint: BandwidthDataPoint;
} {
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  // 1. Gently jitter sessions
  let totalSessionRx = 0;
  let totalSessionTx = 0;

  const updatedSessions = currentSessions.map((session, idx) => {
    // 30% chance of sudden burst, otherwise minor jitter
    const isBurst = Math.random() < 0.15;
    const deltaRx = isBurst
      ? (Math.random() - 0.4) * 12
      : (Math.random() - 0.5) * 2.5;
    const deltaTx = isBurst
      ? (Math.random() - 0.4) * 4
      : (Math.random() - 0.5) * 1.0;

    const newRx = Math.max(0.8, Math.min(290, Number((session.rxRateMbps + deltaRx).toFixed(1))));
    const newTx = Math.max(0.3, Math.min(120, Number((session.txRateMbps + deltaTx).toFixed(1))));

    totalSessionRx += newRx;
    totalSessionTx += newTx;

    return {
      ...session,
      rxRateMbps: newRx,
      txRateMbps: newTx,
      bytesInMb: session.bytesInMb + Math.round(newRx * 0.4),
      bytesOutMb: session.bytesOutMb + Math.round(newTx * 0.4),
      liveRateFormatted: `↓ ${newRx}M / ↑ ${newTx}M`,
    };
  });

  // 2. WAN throughput jitter (sessions + core backbone overhead)
  const baseOverheadRx = 650;
  const baseOverheadTx = 220;
  const targetWanRx = Math.round(totalSessionRx + baseOverheadRx + (Math.random() - 0.5) * 40);
  const targetWanTx = Math.round(totalSessionTx + baseOverheadTx + (Math.random() - 0.5) * 20);

  // 3. CPU Load slight jitter (e.g. 14% -> 17% -> 15%)
  const cpuDelta = Math.floor(Math.random() * 5) - 2; // -2 to +2
  const newCpu = Math.min(85, Math.max(9, (router.cpuLoad || 16) + cpuDelta));

  // 4. Update router object
  const updatedRouter: MikrotikRouter = {
    ...router,
    status: 'online',
    mode: 'live',
    cpuLoad: newCpu,
    currentWanRxMbps: targetWanRx,
    currentWanTxMbps: targetWanTx,
    activePppoeCount: updatedSessions.length || router.activePppoeCount,
  };

  // 5. Update interfaces
  const updatedInterfaces = currentInterfaces.map((iface) => {
    if (iface.name === router.wanInterface || iface.type === 'sfp-sfpplus') {
      return {
        ...iface,
        rxRateMbps: targetWanRx,
        txRateMbps: targetWanTx,
        rxBytes: iface.rxBytes + Math.round(targetWanRx * 125000),
        txBytes: iface.txBytes + Math.round(targetWanTx * 125000),
      };
    }
    if (iface.name.startsWith('ether') && iface.running) {
      const ethRx = Math.max(5, Math.round(iface.rxRateMbps + (Math.random() - 0.5) * 8));
      const ethTx = Math.max(2, Math.round(iface.txRateMbps + (Math.random() - 0.5) * 4));
      return {
        ...iface,
        rxRateMbps: ethRx,
        txRateMbps: ethTx,
        rxBytes: iface.rxBytes + Math.round(ethRx * 125000),
        txBytes: iface.txBytes + Math.round(ethTx * 125000),
      };
    }
    return iface;
  });

  const bandwidthPoint: BandwidthDataPoint = {
    time: timeStr,
    rxMbps: targetWanRx,
    txMbps: targetWanTx,
  };

  return {
    updatedRouter,
    updatedSessions,
    updatedInterfaces,
    bandwidthPoint,
  };
}
