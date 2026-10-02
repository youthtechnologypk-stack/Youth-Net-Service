// VSOL OLT (EPON / GPON) & ONU Optical Diagnostics Types

export type OpticalSignalQuality = 'good' | 'warning' | 'critical';

export type OnuStatus = 'online' | 'offline' | 'dying_gasp';

export type OltPonType = 'EPON' | 'GPON';

export interface VsolOlt {
  id: string;
  name: string;
  model: string; // e.g. 'VSOL V1600G1-B (8-Port GPON)' | 'VSOL V1600D4-DP (4-Port EPON)'
  ipAddress: string;
  snmpPort: number;
  snmpCommunity: string;
  firmwareVersion: string;
  ponType: OltPonType;
  totalPonPorts: number;
  activeOnuCount: number;
  status: 'online' | 'warning' | 'offline';
  uptime: string;
  cpuLoad: number;
  temperatureC: number;
  powerSupply: 'dual_ac_redundant' | 'single_ac' | 'dc';
  areaNode: string;
  sfpModules: Array<{
    port: string;
    wavelength: string; // e.g. "1490nm Tx / 1310nm Rx"
    sfpTxPowerDbm: number;
    activeOnus: number;
    maxOnus: number;
  }>;
}

export interface OnuDevice {
  id: string;
  oltId: string;
  oltName: string;
  ponPort: string; // e.g. "GPON0/1" or "EPON0/2"
  onuIndex: number; // e.g. 1 to 64
  macAddress: string; // e.g. "E0:67:B3:4A:21:8F"
  serialNumber?: string; // e.g. "VSOL12894A21"
  vendor: string; // 'VSOL', 'Huawei', 'FiberHome', 'ZTE'
  model: string; // 'V2801SG', 'HG8310M', etc.
  customerId: string;
  customerName: string;
  customerPhone: string;
  pppoeUsername: string;
  areaNode: string;
  rxPowerDbm: number; // Received Optical Power in dBm (e.g. -19.4 dBm)
  txPowerDbm: number; // Transmit Optical Power in dBm (e.g. +2.3 dBm)
  oltTxPowerDbm: number; // SFP Output Power from OLT (e.g. +4.5 dBm)
  opticalQuality: OpticalSignalQuality; // 'good' (-12 to -23), 'warning' (-24 to -27), 'critical' (<-28 or offline)
  status: OnuStatus; // 'online' | 'offline' | 'dying_gasp'
  lastDyingGaspTime?: string;
  lastOnlineTime: string;
  distanceMeters: number;
  firmware: string;
  ipAddress?: string;
}

export interface SnmpPollResult {
  macAddress: string;
  ponPort: string;
  onuIndex: number;
  rxPowerDbm: number;
  txPowerDbm: number;
  status: OnuStatus;
  opticalQuality: OpticalSignalQuality;
  timestamp: string;
}
