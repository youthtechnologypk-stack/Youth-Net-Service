import { OpticalSignalQuality, OnuStatus } from '../types/olt';

export interface RawSnmpVarbind {
  oid: string;
  type?: number;
  value: any;
}

export interface ParsedOnuMetrics {
  slot: number;
  ponPort: string;
  portIndex: number;
  onuIndex: number;
  rxPowerDbm: number;
  txPowerDbm: number;
  oltRxPowerDbm?: number;
  temperatureC?: number;
  voltageV?: number;
  biasCurrentMa?: number;
  distanceMeters?: number;
  attenuationLossDb: number;
  status: OnuStatus;
  opticalQuality: OpticalSignalQuality;
  timestamp: string;
}

/**
 * Standard VSOL Enterprise OID Prefixes
 */
export const VSOL_OPTICAL_OIDS = {
  ONU_STATUS: '1.3.6.1.4.1.37950.1.1.5.12.1.1.5',
  ONU_RX_POWER: '1.3.6.1.4.1.37950.1.1.5.12.2.1.8',
  ONU_TX_POWER: '1.3.6.1.4.1.37950.1.1.5.12.2.1.9',
  ONU_OLT_RX_POWER: '1.3.6.1.4.1.37950.1.1.5.12.2.1.10',
  ONU_TEMPERATURE: '1.3.6.1.4.1.37950.1.1.5.12.2.1.5',
  ONU_VOLTAGE: '1.3.6.1.4.1.37950.1.1.5.12.2.1.6',
  ONU_BIAS_CURRENT: '1.3.6.1.4.1.37950.1.1.5.12.2.1.7',
  ONU_DISTANCE: '1.3.6.1.4.1.37950.1.1.5.12.1.1.8',
};

/**
 * Parses raw integer optical power encoded in 0.01 dBm from VSOL SNMP varbinds.
 * Handles 16-bit and 32-bit two's-complement signed integers.
 * Example: -1945 -> -19.45 dBm; 63591 (unsigned 16-bit) -> -19.45 dBm
 */
export function parseVsolRawOpticalPower(rawValue: number | string): number {
  let val = typeof rawValue === 'string' ? parseFloat(rawValue) : rawValue;
  if (isNaN(val)) {
    throw new Error(`Invalid optical power raw value: ${rawValue}`);
  }

  // Handle 16-bit unsigned overflow for negative values
  if (val > 32767 && val <= 65535) {
    val = val - 65536;
  }

  // VSOL scale is 0.01 dBm
  return Math.round((val / 100) * 100) / 100;
}

/**
 * Classifies optical signal quality according to ITU-T G.984 GPON standards:
 * - Optimal: -12.0 dBm to -23.0 dBm (Carrier recommended range)
 * - Warning: -23.01 dBm to -27.5 dBm (High attenuation, dirty connector or macro-bend)
 * - Critical: Below -27.5 dBm (Approaching receiver sensitivity limit or dying gasp)
 */
export function classifyOpticalSignalHealth(
  rxPowerDbm: number,
  status: OnuStatus
): OpticalSignalQuality {
  if (status === 'offline' || status === 'dying_gasp') {
    return 'critical';
  }
  if (rxPowerDbm >= -23.0 && rxPowerDbm <= -12.0) {
    return 'good';
  }
  if (rxPowerDbm < -23.0 && rxPowerDbm >= -27.5) {
    return 'warning';
  }
  return 'critical';
}

/**
 * Calculates optical link attenuation loss (dB)
 * Attenuation = OLT Tx Power (dBm) - ONU Rx Power (dBm)
 * Assuming default OLT SFP+ Tx Power of +2.5 dBm if not explicitly provided.
 */
export function calculateOpticalAttenuationLoss(
  onuRxPowerDbm: number,
  oltTxPowerDbm = 2.5
): number {
  return Math.round((oltTxPowerDbm - onuRxPowerDbm) * 100) / 100;
}

/**
 * Extracts slot, port, and ONU index from standard VSOL OID suffix
 * Format: [prefix].<slot>.<portIndex>.<onuIndex>
 */
export function extractVsolOidIndices(oid: string): { slot: number; port: number; onu: number } | null {
  const parts = oid.split('.').filter(Boolean);
  if (parts.length < 3) return null;

  const onu = parseInt(parts[parts.length - 1], 10);
  const port = parseInt(parts[parts.length - 2], 10);
  const slot = parseInt(parts[parts.length - 3], 10);

  if (isNaN(onu) || isNaN(port) || isNaN(slot)) {
    return null;
  }

  return { slot, port, onu };
}

/**
 * Parses raw CLI output from VSOL OLT console
 * Supports command outputs like:
 * `show onu optical-info pon 1/1 onu 4`
 * OR
 * `show pon onu ctc optical-power`
 *
 * Example input line:
 * "GPON0/1:4   Online   -19.42   2.15   -20.10   42.5   3.30   14.2   1420m"
 */
export function parseVsolCliOpticalShow(cliOutput: string): ParsedOnuMetrics[] {
  if (!cliOutput || typeof cliOutput !== 'string') {
    return [];
  }

  const results: ParsedOnuMetrics[] = [];
  const lines = cliOutput.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('---') || trimmed.toLowerCase().includes('port')) {
      continue;
    }

    // Match pattern: (GPON|EPON)?0?/?(\d+)[:/](\d+)\s+([A-Za-z_]+)\s+([-\d.]+)\s+([-\d.]+)
    const match = trimmed.match(
      /(?:(?:GPON|EPON|pon)\s*0?\/?)?(\d+)[:/](\d+)\s+(Online|Offline|Dying[ _]Gasp|Active|LOS)\s+([-\d.]+)\s+([-\d.]+)(?:\s+([-\d.]+))?(?:\s+([-\d.]+))?(?:\s+([-\d.]+))?(?:\s+([-\d.]+))?(?:\s+(\d+)\s*m?)?/i
    );

    if (match) {
      const portIndex = parseInt(match[1], 10);
      const onuIndex = parseInt(match[2], 10);
      const rawStatusStr = match[3].toLowerCase();

      let status: OnuStatus = 'online';
      if (rawStatusStr.includes('off') || rawStatusStr.includes('los')) {
        status = 'offline';
      } else if (rawStatusStr.includes('dying')) {
        status = 'dying_gasp';
      }

      const rxPowerDbm = parseFloat(match[4]);
      const txPowerDbm = parseFloat(match[5]);
      const oltRxPowerDbm = match[6] ? parseFloat(match[6]) : undefined;
      const temperatureC = match[7] ? parseFloat(match[7]) : undefined;
      const voltageV = match[8] ? parseFloat(match[8]) : undefined;
      const biasCurrentMa = match[9] ? parseFloat(match[9]) : undefined;
      const distanceMeters = match[10] ? parseInt(match[10], 10) : undefined;

      const opticalQuality = classifyOpticalSignalHealth(rxPowerDbm, status);
      const attenuationLossDb = calculateOpticalAttenuationLoss(rxPowerDbm);

      results.push({
        slot: 1,
        ponPort: `GPON0/${portIndex}`,
        portIndex,
        onuIndex,
        rxPowerDbm,
        txPowerDbm,
        oltRxPowerDbm,
        temperatureC,
        voltageV,
        biasCurrentMa,
        distanceMeters,
        attenuationLossDb,
        status,
        opticalQuality,
        timestamp: new Date().toISOString(),
      });
    }
  }

  return results;
}

/**
 * Aggregates and correlates a list of SNMP varbinds into structured ParsedOnuMetrics
 */
export function parseVsolSnmpVarbindList(varbinds: RawSnmpVarbind[]): ParsedOnuMetrics[] {
  const map = new Map<string, Partial<ParsedOnuMetrics>>();

  for (const vb of varbinds) {
    const indices = extractVsolOidIndices(vb.oid);
    if (!indices) continue;

    const key = `${indices.port}:${indices.onu}`;
    if (!map.has(key)) {
      map.set(key, {
        slot: indices.slot,
        portIndex: indices.port,
        onuIndex: indices.onu,
        ponPort: `GPON0/${indices.port}`,
        status: 'online',
        timestamp: new Date().toISOString(),
      });
    }

    const item = map.get(key)!;

    if (vb.oid.startsWith(VSOL_OPTICAL_OIDS.ONU_RX_POWER)) {
      item.rxPowerDbm = parseVsolRawOpticalPower(vb.value);
    } else if (vb.oid.startsWith(VSOL_OPTICAL_OIDS.ONU_TX_POWER)) {
      item.txPowerDbm = parseVsolRawOpticalPower(vb.value);
    } else if (vb.oid.startsWith(VSOL_OPTICAL_OIDS.ONU_OLT_RX_POWER)) {
      item.oltRxPowerDbm = parseVsolRawOpticalPower(vb.value);
    } else if (vb.oid.startsWith(VSOL_OPTICAL_OIDS.ONU_STATUS)) {
      const code = Number(vb.value);
      item.status = code === 1 ? 'online' : code === 3 ? 'dying_gasp' : 'offline';
    } else if (vb.oid.startsWith(VSOL_OPTICAL_OIDS.ONU_DISTANCE)) {
      item.distanceMeters = Number(vb.value);
    } else if (vb.oid.startsWith(VSOL_OPTICAL_OIDS.ONU_TEMPERATURE)) {
      item.temperatureC = Math.round((Number(vb.value) / 100) * 10) / 10;
    }
  }

  const output: ParsedOnuMetrics[] = [];
  for (const entry of map.values()) {
    if (entry.portIndex !== undefined && entry.onuIndex !== undefined && entry.rxPowerDbm !== undefined) {
      const status = entry.status || 'online';
      const rx = entry.rxPowerDbm;
      const tx = entry.txPowerDbm ?? 2.1;
      const quality = classifyOpticalSignalHealth(rx, status);
      const loss = calculateOpticalAttenuationLoss(rx);

      output.push({
        slot: entry.slot || 1,
        ponPort: entry.ponPort || `GPON0/${entry.portIndex}`,
        portIndex: entry.portIndex,
        onuIndex: entry.onuIndex,
        rxPowerDbm: rx,
        txPowerDbm: tx,
        oltRxPowerDbm: entry.oltRxPowerDbm,
        temperatureC: entry.temperatureC,
        voltageV: entry.voltageV,
        biasCurrentMa: entry.biasCurrentMa,
        distanceMeters: entry.distanceMeters,
        attenuationLossDb: loss,
        status,
        opticalQuality: quality,
        timestamp: entry.timestamp || new Date().toISOString(),
      });
    }
  }

  return output;
}
