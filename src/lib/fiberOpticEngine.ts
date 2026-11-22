import type {
  CoreSpliceAction,
  EnclosureCoreSpliceEntry,
  GisCableTypeCode,
  GisCoreEntry,
  GisCoreLedgerStatus,
  GisCoreStatus,
  GisCoreUsageType,
  GisLatLng,
  GisNodeType,
  GisSpliceEntry,
  GisSplitterCategory,
  GisSplitterType,
  InternalSplitterLeg,
  InternalSplitterUnit,
  OltPonMode,
  OltSfpClass,
  SupabaseGisCable,
  SupabaseGisNode,
  SupabaseGisOlt,
  SupabaseGisOltPonPort,
  SupabaseGisSplitterOutput,
} from '../services/supabaseClient';

export const FIBER_ATTENUATION_DB_PER_KM = 0.35;
export const DROP_ATTENUATION_DB_PER_METER = 0.00035;
export const FAST_CONNECTOR_LOSS_DB = 0.3;
export const DEFAULT_FUSION_SPLICE_LOSS_DB = 0.5;
export const DEFAULT_PASS_THROUGH_SPLICE_LOSS_DB = 0.2;
export const FDB_ENCLOSURE_CAPACITIES = [4, 8, 12, 16, 24, 32, 48] as const;

/**
 * Computes live optical power (dBm) at a port / ONT from the parent FDB or splitter's
 * active output power minus drop cable attenuation (dropMeters * 0.00035) and
 * 0.3 dB fast-connector loss. Returns null when no valid parent output power exists.
 */
export function computePortLiveRxDbm(
  parentOutputDbm: number | null | undefined,
  dropMeters: number | null | undefined = 0,
  options?: { includeConnectorLoss?: boolean }
): number | null {
  if (
    parentOutputDbm === null ||
    parentOutputDbm === undefined ||
    Number.isNaN(Number(parentOutputDbm))
  ) {
    return null;
  }
  const safeDrop = Math.max(0, Number(dropMeters || 0));
  const connectorLoss = options?.includeConnectorLoss === false ? 0 : FAST_CONNECTOR_LOSS_DB;
  return round2(
    Number(parentOutputDbm) - safeDrop * DROP_ATTENUATION_DB_PER_METER - connectorLoss
  );
}

export function resolveHopSpliceLoss(rawLoss?: number | null): number {
  if (rawLoss === null || rawLoss === undefined || Number.isNaN(Number(rawLoss))) {
    return DEFAULT_FUSION_SPLICE_LOSS_DB;
  }
  const n = Number(rawLoss);
  // Migrate legacy 0.08 dB DB default transparently to realistic 0.5 dB connector/splice hop loss
  if (n <= 0 || Math.abs(n - 0.08) < 0.001) {
    return DEFAULT_FUSION_SPLICE_LOSS_DB;
  }
  return n;
}

export interface SfpClassSpec {
  sfpClass: OltSfpClass;
  label: string;
  shortLabel: string;
  txPowerDbm: number;
}

export const SFP_CLASS_SPECS: Record<Exclude<OltSfpClass, 'CUSTOM'>, SfpClassSpec> = {
  'B+': { sfpClass: 'B+', label: 'Class B+ (+3.5 dBm)', shortLabel: 'B+ (+3.5)', txPowerDbm: 3.5 },
  'C+': { sfpClass: 'C+', label: 'Class C+ (+5.0 dBm)', shortLabel: 'C+ (+5.0)', txPowerDbm: 5.0 },
  'C++': { sfpClass: 'C++', label: 'Class C++ (+7.5 dBm)', shortLabel: 'C++ (+7.5)', txPowerDbm: 7.5 },
  'C+++': { sfpClass: 'C+++', label: 'Class C+++ (+9.0 dBm)', shortLabel: 'C+++ (+9.0)', txPowerDbm: 9.0 },
};

export const SFP_TX_PRESETS: SfpClassSpec[] = [
  SFP_CLASS_SPECS['B+'],
  SFP_CLASS_SPECS['C+'],
  SFP_CLASS_SPECS['C++'],
  SFP_CLASS_SPECS['C+++'],
];

export function getDefaultMaxOnuLimit(ponMode: OltPonMode): number {
  return ponMode === 'EPON' ? 64 : 128;
}

export function inferSfpClassFromDbm(txPowerDbm: number): OltSfpClass {
  const val = Number(txPowerDbm);
  if (Math.abs(val - 3.5) < 0.05) return 'B+';
  if (Math.abs(val - 5.0) < 0.05) return 'C+';
  if (Math.abs(val - 7.5) < 0.05) return 'C++';
  if (Math.abs(val - 9.0) < 0.05) return 'C+++';
  return 'CUSTOM';
}

export interface Tia598ColorSpec {
  index: number;
  name: string;
  hex: string;
  textHex: string;
}

export const TIA_598_COLORS: Tia598ColorSpec[] = [
  { index: 1, name: 'Blue', hex: '#2563EB', textHex: '#FFFFFF' },
  { index: 2, name: 'Orange', hex: '#F97316', textHex: '#FFFFFF' },
  { index: 3, name: 'Green', hex: '#16A34A', textHex: '#FFFFFF' },
  { index: 4, name: 'Brown', hex: '#92400E', textHex: '#FFFFFF' },
  { index: 5, name: 'Slate', hex: '#64748B', textHex: '#FFFFFF' },
  { index: 6, name: 'White', hex: '#F8FAFC', textHex: '#0F172A' },
  { index: 7, name: 'Red', hex: '#DC2626', textHex: '#FFFFFF' },
  { index: 8, name: 'Black', hex: '#1E293B', textHex: '#FFFFFF' },
  { index: 9, name: 'Yellow', hex: '#EAB308', textHex: '#0F172A' },
  { index: 10, name: 'Violet', hex: '#9333EA', textHex: '#FFFFFF' },
  { index: 11, name: 'Rose', hex: '#EC4899', textHex: '#FFFFFF' },
  { index: 12, name: 'Aqua', hex: '#06B6D4', textHex: '#0F172A' },
];

export interface SplitterSpec {
  type: GisSplitterType;
  category: GisSplitterCategory;
  label: string;
  dropLossDb: number;
  thruLossDb: number;
  defaultPorts: number;
  isAsymmetricFbt: boolean;
  dropPercent?: number;
  thruPercent?: number;
}

export const SPLITTER_SPECS: Record<GisSplitterType, SplitterSpec> = {
  none: {
    type: 'none',
    category: 'NONE',
    label: 'No Splitter (Through / Splice)',
    dropLossDb: 0,
    thruLossDb: 0,
    defaultPorts: 0,
    isAsymmetricFbt: false,
  },
  '1:2': {
    type: '1:2',
    category: 'PLC_EQUAL',
    label: '1:2 PLC (-3.6 dB)',
    dropLossDb: 3.6,
    thruLossDb: 3.6,
    defaultPorts: 2,
    isAsymmetricFbt: false,
  },
  '1:4': {
    type: '1:4',
    category: 'PLC_EQUAL',
    label: '1:4 PLC (-7.2 dB)',
    dropLossDb: 7.2,
    thruLossDb: 7.2,
    defaultPorts: 4,
    isAsymmetricFbt: false,
  },
  '1:8': {
    type: '1:8',
    category: 'PLC_EQUAL',
    label: '1:8 PLC (-10.5 dB)',
    dropLossDb: 10.5,
    thruLossDb: 10.5,
    defaultPorts: 8,
    isAsymmetricFbt: false,
  },
  '1:16': {
    type: '1:16',
    category: 'PLC_EQUAL',
    label: '1:16 PLC (-13.8 dB)',
    dropLossDb: 13.8,
    thruLossDb: 13.8,
    defaultPorts: 16,
    isAsymmetricFbt: false,
  },
  '1:32': {
    type: '1:32',
    category: 'PLC_EQUAL',
    label: '1:32 PLC (-17.2 dB)',
    dropLossDb: 17.2,
    thruLossDb: 17.2,
    defaultPorts: 32,
    isAsymmetricFbt: false,
  },
  '90:10': {
    type: '90:10',
    category: 'FBT_RATIO',
    label: '90:10 FBT (10% Drop -10.5 / 90% Thru -0.8 dB)',
    dropLossDb: 10.5,
    thruLossDb: 0.8,
    defaultPorts: 2,
    isAsymmetricFbt: true,
    dropPercent: 10,
    thruPercent: 90,
  },
  '85:15': {
    type: '85:15',
    category: 'FBT_RATIO',
    label: '85:15 FBT (15% Drop -8.6 / 85% Thru -1.0 dB)',
    dropLossDb: 8.6,
    thruLossDb: 1.0,
    defaultPorts: 2,
    isAsymmetricFbt: true,
    dropPercent: 15,
    thruPercent: 85,
  },
  '80:20': {
    type: '80:20',
    category: 'FBT_RATIO',
    label: '80:20 FBT (20% Drop -7.5 / 80% Thru -1.2 dB)',
    dropLossDb: 7.5,
    thruLossDb: 1.2,
    defaultPorts: 2,
    isAsymmetricFbt: true,
    dropPercent: 20,
    thruPercent: 80,
  },
  '70:30': {
    type: '70:30',
    category: 'FBT_RATIO',
    label: '70:30 FBT (30% Drop -5.7 / 70% Thru -1.8 dB)',
    dropLossDb: 5.7,
    thruLossDb: 1.8,
    defaultPorts: 2,
    isAsymmetricFbt: true,
    dropPercent: 30,
    thruPercent: 70,
  },
  '60:40': {
    type: '60:40',
    category: 'FBT_RATIO',
    label: '60:40 FBT (40% Drop -4.4 / 60% Thru -2.5 dB)',
    dropLossDb: 4.4,
    thruLossDb: 2.5,
    defaultPorts: 2,
    isAsymmetricFbt: true,
    dropPercent: 40,
    thruPercent: 60,
  },
  '50:50': {
    type: '50:50',
    category: 'FBT_RATIO',
    label: '50:50 FBT (50% Drop -3.4 / 50% Thru -3.4 dB)',
    dropLossDb: 3.4,
    thruLossDb: 3.4,
    defaultPorts: 2,
    isAsymmetricFbt: true,
    dropPercent: 50,
    thruPercent: 50,
  },
};

export function inferSplitterCategory(splitterType: GisSplitterType): GisSplitterCategory {
  return SPLITTER_SPECS[splitterType]?.category || 'NONE';
}

export interface FbtLegOutputs {
  dropPercent: number;
  thruPercent: number;
  dropLossDb: number;
  thruLossDb: number;
  dropOutputDbm: number | null;
  thruOutputDbm: number | null;
}

export function getFbtLegOutputs(
  inputDbm: number | null | undefined,
  splitterType: GisSplitterType,
  lossPerSplice = DEFAULT_FUSION_SPLICE_LOSS_DB
): FbtLegOutputs | null {
  const spec = SPLITTER_SPECS[splitterType];
  if (!spec || !spec.isAsymmetricFbt) return null;
  const hasInput = inputDbm !== null && inputDbm !== undefined && !Number.isNaN(Number(inputDbm));
  const dropDbm = hasInput ? round2(Number(inputDbm) - spec.dropLossDb - lossPerSplice) : null;
  const thruDbm = hasInput ? round2(Number(inputDbm) - spec.thruLossDb - lossPerSplice) : null;
  return {
    dropPercent: spec.dropPercent ?? 10,
    thruPercent: spec.thruPercent ?? 90,
    dropLossDb: spec.dropLossDb,
    thruLossDb: spec.thruLossDb,
    dropOutputDbm: dropDbm,
    thruOutputDbm: thruDbm,
  };
}

export interface CableCapacityPreset {
  id: string;
  label: string;
  cores: 1 | 2 | 4 | 6 | 8 | 12 | 24 | 48;
  cableType: GisCableTypeCode;
}

export const CABLE_CAPACITY_PRESETS: CableCapacityPreset[] = [
  { id: 'DROP_1C', label: 'Drop Wire 1C', cores: 1, cableType: 'DROP' },
  { id: 'DROP_2C', label: 'Drop Wire 2C', cores: 2, cableType: 'DROP' },
  { id: '2C', label: '2 Core', cores: 2, cableType: '2C' },
  { id: '4C', label: '4 Core', cores: 4, cableType: '4C' },
  { id: '6C', label: '6 Core', cores: 6, cableType: '6C' },
  { id: '8C', label: '8 Core', cores: 8, cableType: '8C' },
  { id: '12C', label: '12 Core', cores: 12, cableType: '12C' },
  { id: '24C', label: '24 Core', cores: 24, cableType: '24C' },
  { id: '48C', label: '48 Core', cores: 48, cableType: '48C' },
];

export function cableCoresToType(cores: number, explicitType?: string): GisCableTypeCode {
  if (explicitType === 'DROP' || cores === 1) return 'DROP';
  if (cores === 2) return '2C';
  if (cores === 4) return '4C';
  if (cores === 6) return '6C';
  if (cores === 8) return '8C';
  if (cores === 24) return '24C';
  if (cores === 48) return '48C';
  return '12C';
}

export function coreStatusToUsageType(status: GisCoreStatus): GisCoreUsageType {
  switch (status) {
    case 'Feed / Splitter':
      return 'SPLITTER_FEED';
    case 'Through / Pass':
      return 'PASS_THROUGH_AREA';
    case 'Dead / High Loss':
      return 'DEAD_FAULT';
    default:
      return 'FREE_SPARE';
  }
}

export function usageTypeToCoreStatus(usage: GisCoreUsageType): GisCoreStatus {
  switch (usage) {
    case 'SPLITTER_FEED':
      return 'Feed / Splitter';
    case 'PASS_THROUGH_AREA':
      return 'Through / Pass';
    case 'DEAD_FAULT':
      return 'Dead / High Loss';
    default:
      return 'Free / Dark';
  }
}

export function coreStatusToLedgerStatus(
  status: GisCoreStatus,
  explicit?: GisCoreLedgerStatus
): GisCoreLedgerStatus {
  if (
    explicit === 'ACTIVE' ||
    explicit === 'SPARE' ||
    explicit === 'RESERVED' ||
    explicit === 'FAULTY'
  ) {
    return explicit;
  }
  switch (status) {
    case 'Feed / Splitter':
    case 'Through / Pass':
      return 'ACTIVE';
    case 'Dead / High Loss':
      return 'FAULTY';
    default:
      return 'SPARE';
  }
}

export function ledgerStatusToCoreStatus(
  ledger: GisCoreLedgerStatus,
  destinationTarget?: string
): GisCoreStatus {
  switch (ledger) {
    case 'ACTIVE':
      return (destinationTarget || '').toLowerCase().includes('pass')
        ? 'Through / Pass'
        : 'Feed / Splitter';
    case 'RESERVED':
      return 'Through / Pass';
    case 'FAULTY':
      return 'Dead / High Loss';
    default:
      return 'Free / Dark';
  }
}

export interface CableCoreSummary {
  total: number;
  splitterCount: number;
  passThroughCount: number;
  freeCount: number;
  deadCount: number;
  litCount: number;
  reservedCount: number;
  spareCount: number;
  faultyCount: number;
}

export function summarizeCableCores(
  cores: GisCoreEntry[] | null | undefined,
  fallbackTotal = 12
): CableCoreSummary {
  if (!Array.isArray(cores) || cores.length === 0) {
    return {
      total: fallbackTotal,
      splitterCount: 0,
      passThroughCount: 0,
      freeCount: fallbackTotal,
      deadCount: 0,
      litCount: 0,
      reservedCount: 0,
      spareCount: fallbackTotal,
      faultyCount: 0,
    };
  }
  let splitterCount = 0;
  let passThroughCount = 0;
  let freeCount = 0;
  let deadCount = 0;
  let litCount = 0;
  let reservedCount = 0;
  let spareCount = 0;
  let faultyCount = 0;

  for (const c of cores) {
    const usage = c.usage_type || coreStatusToUsageType(c.status);
    if (usage === 'SPLITTER_FEED') splitterCount++;
    else if (usage === 'PASS_THROUGH_AREA') passThroughCount++;
    else if (usage === 'DEAD_FAULT') deadCount++;
    else freeCount++;

    const ledger = coreStatusToLedgerStatus(c.status, c.core_status);
    if (ledger === 'ACTIVE') litCount++;
    else if (ledger === 'RESERVED') reservedCount++;
    else if (ledger === 'FAULTY') faultyCount++;
    else spareCount++;
  }
  return {
    total: cores.length,
    splitterCount,
    passThroughCount,
    freeCount,
    deadCount,
    litCount,
    reservedCount,
    spareCount,
    faultyCount,
  };
}

export function getTia598Color(oneBasedCoreNumber: number): Tia598ColorSpec {
  const normalized = Math.max(1, Math.floor(oneBasedCoreNumber));
  const idx = (normalized - 1) % 12;
  return TIA_598_COLORS[idx];
}

export function generateTia598Cores(cableCores: number): GisCoreEntry[] {
  const total = Math.max(1, Math.min(48, Math.floor(cableCores || 12)));
  const cores: GisCoreEntry[] = [];
  for (let i = 1; i <= total; i++) {
    const tubeNumber = Math.ceil(i / 12);
    const tubeColor = getTia598Color(tubeNumber);
    const coreColor = getTia598Color(i);
    cores.push({
      coreNumber: i,
      tubeNumber,
      tubeColorName: tubeColor.name,
      tubeColorHex: tubeColor.hex,
      coreColorName: coreColor.name,
      coreColorHex: coreColor.hex,
      status: 'Free / Dark',
      core_status: 'SPARE',
      usage_type: 'FREE_SPARE',
      origin_olt_id: null,
      origin_pon_port_id: null,
      origin_olt_label: '',
      source_signal: '',
      assigned_splitter_node_id: null,
      forwarded_to_area: '',
      destination_target: '',
      optical_power_dbm: '',
      remarks: '',
      destinationNote: '',
    });
  }
  return cores;
}

export function normalizeCableCores(
  cableCores: number,
  existing?: GisCoreEntry[] | null
): GisCoreEntry[] {
  const base = generateTia598Cores(cableCores);
  if (!Array.isArray(existing) || existing.length === 0) return base;
  const byNum: Record<number, GisCoreEntry> = {};
  for (const item of existing) {
    if (item && typeof item.coreNumber === 'number') {
      byNum[item.coreNumber] = item;
    }
  }
  return base.map((b) => {
    const prev = byNum[b.coreNumber];
    if (!prev) return b;
    const status = prev.usage_type
      ? usageTypeToCoreStatus(prev.usage_type)
      : (prev.status as GisCoreStatus) || b.status;
    const usageType = prev.usage_type || coreStatusToUsageType(status);
    const ledgerStatus = coreStatusToLedgerStatus(status, prev.core_status);
    const sourceSignal = prev.source_signal || prev.origin_olt_label || '';
    const destinationTarget =
      prev.destination_target || prev.forwarded_to_area || prev.destinationNote || '';
    return {
      ...b,
      status,
      core_status: ledgerStatus,
      usage_type: usageType,
      origin_olt_id: prev.origin_olt_id ?? null,
      origin_pon_port_id: prev.origin_pon_port_id ?? null,
      origin_olt_label: sourceSignal,
      source_signal: sourceSignal,
      assigned_splitter_node_id: prev.assigned_splitter_node_id ?? prev.assignedNodeId ?? null,
      forwarded_to_area: destinationTarget,
      destination_target: destinationTarget,
      optical_power_dbm:
        prev.optical_power_dbm !== undefined && prev.optical_power_dbm !== null
          ? String(prev.optical_power_dbm)
          : '',
      remarks: prev.remarks || '',
      destinationNote: destinationTarget,
      assignedNodeId: prev.assignedNodeId ?? prev.assigned_splitter_node_id ?? null,
    };
  });
}

export function generateDefaultSpliceTray(
  capacity: number,
  existing?: GisSpliceEntry[] | null
): GisSpliceEntry[] {
  const count = Math.max(2, Math.min(48, Math.floor(capacity || 12)));
  const existingByCoreIn: Record<number, GisSpliceEntry> = {};
  if (Array.isArray(existing)) {
    for (const row of existing) {
      if (row && typeof row.coreIn === 'number') {
        existingByCoreIn[row.coreIn] = row;
      }
    }
  }
  const rows: GisSpliceEntry[] = [];
  for (let i = 1; i <= count; i++) {
    const prev = existingByCoreIn[i];
    rows.push(
      prev
        ? {
            coreIn: i,
            coreOut: Math.max(1, Math.min(count, Number(prev.coreOut || i))),
            status: prev.status || 'Straight Splice',
            note: prev.note || '',
          }
        : {
            coreIn: i,
            coreOut: i,
            status: 'Straight Splice',
            note: '',
          }
    );
  }
  return rows;
}

export function haversineMeters(a: GisLatLng, b: GisLatLng): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return Math.round(R * c);
}

export function computePolylineDistanceMeters(points: GisLatLng[]): number {
  if (!Array.isArray(points) || points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineMeters(points[i - 1], points[i]);
  }
  return Math.round(total);
}

export type OpticalHealthBand = 'IDEAL' | 'GOOD' | 'MARGINAL' | 'CRITICAL LOS RISK' | 'UNLINKED';

export interface OpticalBudgetStep {
  id: string;
  kind: 'OLT_SOURCE' | 'CABLE' | 'UPSTREAM_SPLITTER' | 'UPSTREAM_JOINT' | 'FEED_SPLICE' | 'CURRENT_SPLITTER' | 'PASS_THROUGH';
  label: string;
  detail: string;
  deltaDb: number | null;
  powerAfterDbm: number;
}

export interface EnclosureSummaryStats {
  boxCapacity: number;
  splitterCount: number;
  totalAllocatedPorts: number;
  usedPorts: number;
  freePorts: number;
  passThroughJointCount: number;
}

export interface CoreArrivalMeta {
  dbm: number;
  oltId: string | null;
  oltName: string | null;
  ponPortId: string | null;
  ponLabel: string | null;
  oltTxDbm: number | null;
}

export interface NodeOpticalBudgetResult {
  nodeId: string;
  oltId: string | null;
  oltName: string | null;
  sourcePonPortId: string | null;
  sourcePonLabel: string | null;
  oltTxDbm: number | null;
  parentOutputDbm: number | null;
  inputDbm: number | null;
  thruOutputDbm: number | null;
  ontRxDbm: number | null;
  totalDistanceMeters: number;
  fiberLossDb: number;
  spliceCount: number;
  spliceLossDb: number;
  upstreamThruLossDb: number;
  splitterLossDb: number;
  localFiberLossDb: number;
  localSpliceLossDb: number;
  healthBand: OpticalHealthBand;
  incomingCableId: string | null;
  incomingCoreNumber: number | null;
  parentNodeId: string | null;
  hopCount: number;
  budgetSteps: OpticalBudgetStep[];
  arrivalDbmByCoreKey?: Record<string, number>;
  arrivalMetaByCoreKey?: Record<string, CoreArrivalMeta>;
  isMultiPonTrunkBox?: boolean;
  evaluatedSplitters?: InternalSplitterUnit[];
  evaluatedCoreSplices?: EnclosureCoreSpliceEntry[];
  enclosureSummary?: EnclosureSummaryStats;
}

export function classifyOpticalHealth(ontRxDbm: number | null): OpticalHealthBand {
  if (ontRxDbm === null || Number.isNaN(ontRxDbm)) return 'UNLINKED';
  if (ontRxDbm >= -22.0) return 'IDEAL';
  if (ontRxDbm >= -25.0) return 'MARGINAL';
  return 'CRITICAL LOS RISK';
}

export function getOpticalHealthLabel(band: OpticalHealthBand): string {
  switch (band) {
    case 'IDEAL':
      return 'OPTIMAL (-8 to -22 dBm)';
    case 'GOOD':
    case 'MARGINAL':
      return 'WARNING (-22 to -25 dBm)';
    case 'CRITICAL LOS RISK':
      return 'CRITICAL (< -25 dBm)';
    default:
      return 'UNLINKED';
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function buildDefaultLegsForSplitter(
  splitterType: GisSplitterType,
  existingLegs?: InternalSplitterLeg[] | null
): InternalSplitterLeg[] {
  const spec = SPLITTER_SPECS[splitterType] || SPLITTER_SPECS['none'];
  if (spec.type === 'none') return [];
  const count = spec.isAsymmetricFbt ? 2 : Math.max(1, spec.defaultPorts || 8);
  const existingByNum: Record<number, InternalSplitterLeg> = {};
  if (Array.isArray(existingLegs)) {
    for (const l of existingLegs) {
      if (l && typeof l.legNumber === 'number') existingByNum[l.legNumber] = l;
    }
  }
  const legs: InternalSplitterLeg[] = [];
  for (let i = 1; i <= count; i++) {
    const prev = existingByNum[i];
    const defaultLabel = spec.isAsymmetricFbt
      ? i === 1
        ? `Leg 1 · Drop (${spec.dropPercent ?? 10}%)`
        : `Leg 2 · Through (${spec.thruPercent ?? 90}%)`
      : `Leg ${i}`;
    legs.push({
      legNumber: i,
      legLabel: defaultLabel,
      status: prev?.status || 'FREE',
      subscriber_id: prev?.status === 'SUBSCRIBER_DROP' ? prev.subscriber_id || null : null,
      subscriber_username: prev?.status === 'SUBSCRIBER_DROP' ? prev.subscriber_username || '' : '',
      client_label: prev?.client_label || '',
      target_splitter_id: prev?.status === 'INTERNAL_CASCADE' ? prev.target_splitter_id || null : null,
      target_cable_id: prev?.status === 'OUTGOING_CABLE_FEED' ? prev.target_cable_id || null : null,
      target_core_number: prev?.status === 'OUTGOING_CABLE_FEED' ? prev.target_core_number || 1 : null,
      target_node_name: prev?.target_node_name || '',
      drop_distance_m: prev?.drop_distance_m ?? 30,
      calculated_output_dbm: prev?.calculated_output_dbm ?? null,
    });
  }
  return legs;
}

/**
 * Evaluates all internal splitters (including splitter-to-splitter cascades within the same enclosure)
 * and all core splices (Pass-Through Jointing + Internal Splitter Feed) inside a single enclosure node.
 */
export function evaluateEnclosureOpticalState(params: {
  node: SupabaseGisNode;
  arrivalDbmByCoreKey: Record<string, number>;
  fallbackInputDbm: number | null;
  ponPortsById?: Record<string, SupabaseGisOltPonPort>;
  cablesById?: Record<string, SupabaseGisCable>;
}): {
  evaluatedSplitters: InternalSplitterUnit[];
  evaluatedCoreSplices: EnclosureCoreSpliceEntry[];
} {
  const rawSplitters = Array.isArray(params.node.internal_splitters)
    ? params.node.internal_splitters
    : [];
  const rawSplices = Array.isArray(params.node.core_splices)
    ? params.node.core_splices
    : [];
  const isDistOrJoint =
    params.node.node_type === 'DIST_NODE' || params.node.node_type === 'FOSC_JOINT';
  const hasExplicitPerCoreOverrides = rawSplices.some(
    (sp) =>
      Boolean(sp.source_pon_port_id) ||
      Boolean(sp.source_olt_id) ||
      (sp.source_tx_dbm !== null && sp.source_tx_dbm !== undefined)
  );

  // Build effective arrival dBm map honoring explicit per-core OLT/PON overrides on this enclosure
  const effectiveArrivalDbmByKey: Record<string, number> = {
    ...params.arrivalDbmByCoreKey,
  };
  for (const sp of rawSplices) {
    const key = `${sp.incoming_cable_id}:${sp.incoming_core_number}`;
    const hasExplicitSource =
      Boolean(sp.source_pon_port_id) ||
      (sp.source_tx_dbm !== null &&
        sp.source_tx_dbm !== undefined &&
        !Number.isNaN(Number(sp.source_tx_dbm)));
    if (hasExplicitSource) {
      const ponPort =
        sp.source_pon_port_id && params.ponPortsById
          ? params.ponPortsById[sp.source_pon_port_id]
          : undefined;
      const txDbm =
        ponPort && !Number.isNaN(Number(ponPort.tx_power_dbm))
          ? Number(ponPort.tx_power_dbm)
          : sp.source_tx_dbm !== null && sp.source_tx_dbm !== undefined
          ? Number(sp.source_tx_dbm)
          : null;
      if (txDbm !== null) {
        const incCable = params.cablesById ? params.cablesById[sp.incoming_cable_id] : undefined;
        const spanMeters = incCable
          ? Number(incCable.distance_meters) > 0
            ? Number(incCable.distance_meters)
            : computePolylineDistanceMeters(incCable.route_coordinates_json || [])
          : 0;
        const spanLoss = (spanMeters / 1000) * FIBER_ATTENUATION_DB_PER_KM;
        effectiveArrivalDbmByKey[key] = round2(txDbm - spanLoss);
      }
    }
  }

  // Map splitter id -> feeding core splice (if any)
  const coreFeedBySplitterId: Record<string, EnclosureCoreSpliceEntry> = {};
  for (const sp of rawSplices) {
    if (sp.action === 'FEED_INTERNAL_SPLITTER' && sp.target_splitter_id) {
      coreFeedBySplitterId[sp.target_splitter_id] = sp;
    }
  }

  // Clone splitters so multi-pass topological resolution inside the enclosure never mutates inputs
  const working: InternalSplitterUnit[] = rawSplitters.map((s) => ({
    ...s,
    legs: buildDefaultLegsForSplitter(s.splitter_type, s.legs),
  }));
  const byId: Record<string, InternalSplitterUnit> = {};
  for (const s of working) byId[s.id] = s;

  // Iterative resolution handles arbitrary internal cascade ordering (e.g. SPL-2 -> SPL-1 or SPL-1 -> SPL-2 -> SPL-3)
  const passes = Math.max(1, working.length + 1);
  for (let pass = 0; pass < passes; pass++) {
    for (const unit of working) {
      let inputDbm: number | null = null;
      if (unit.input_source_type === 'INTERNAL_SPLITTER_LEG' && unit.parent_splitter_id) {
        const parentUnit = byId[unit.parent_splitter_id];
        if (parentUnit && parentUnit.id !== unit.id) {
          const parentSpec = SPLITTER_SPECS[parentUnit.splitter_type] || SPLITTER_SPECS['none'];
          const legNum = Number(unit.parent_splitter_leg || 1);
          if (parentSpec.isAsymmetricFbt && legNum === 2) {
            inputDbm =
              parentUnit.calculated_thru_dbm !== undefined &&
              parentUnit.calculated_thru_dbm !== null
                ? Number(parentUnit.calculated_thru_dbm)
                : null;
          } else {
            inputDbm =
              parentUnit.calculated_output_dbm !== undefined &&
              parentUnit.calculated_output_dbm !== null
                ? Number(parentUnit.calculated_output_dbm)
                : null;
          }
        }
      } else {
        // Explicit incoming core on unit, else mapped via core_splices, else fallback node inputDbm
        const directKey =
          unit.incoming_cable_id && unit.incoming_core_number
            ? `${unit.incoming_cable_id}:${unit.incoming_core_number}`
            : null;
        const linkedSplice = coreFeedBySplitterId[unit.id];
        const spliceKey =
          linkedSplice?.incoming_cable_id && linkedSplice?.incoming_core_number
            ? `${linkedSplice.incoming_cable_id}:${linkedSplice.incoming_core_number}`
            : null;
        if (directKey && effectiveArrivalDbmByKey[directKey] !== undefined) {
          inputDbm = effectiveArrivalDbmByKey[directKey];
        } else if (spliceKey && effectiveArrivalDbmByKey[spliceKey] !== undefined) {
          inputDbm = effectiveArrivalDbmByKey[spliceKey];
        } else if (!(isDistOrJoint && hasExplicitPerCoreOverrides && (directKey || spliceKey))) {
          inputDbm = params.fallbackInputDbm;
        }
      }

      const spec = SPLITTER_SPECS[unit.splitter_type] || SPLITTER_SPECS['none'];
      const hasInput = inputDbm !== null && !Number.isNaN(Number(inputDbm));
      const cleanIn = hasInput ? round2(Number(inputDbm)) : null;
      const dropOut = hasInput
        ? round2(Number(inputDbm) - spec.dropLossDb)
        : null;
      const thruOut = hasInput
        ? round2(Number(inputDbm) - (spec.isAsymmetricFbt ? spec.thruLossDb : spec.dropLossDb))
        : null;

      unit.calculated_input_dbm = cleanIn;
      unit.calculated_output_dbm = dropOut;
      unit.calculated_thru_dbm = thruOut;
      unit.legs = unit.legs.map((leg) => ({
        ...leg,
        calculated_output_dbm:
          spec.isAsymmetricFbt && leg.legNumber === 2 ? thruOut : dropOut,
      }));
    }
  }

  // Evaluate core splices (Pass-Through Joints, Reserved/Locked, and Internal Splitter Feeds)
  const evaluatedCoreSplices: EnclosureCoreSpliceEntry[] = rawSplices.map((sp) => {
    const key = `${sp.incoming_cable_id}:${sp.incoming_core_number}`;
    const hasArrival = effectiveArrivalDbmByKey[key] !== undefined;
    // For multi-PON DIST_NODE / FOSC boxes, never stamp a global fallback dBm onto an unmapped dark/reserved core
    const allowGlobalFallback =
      !isDistOrJoint ||
      (!hasExplicitPerCoreOverrides && sp.action !== 'SPARE_DARK' && sp.action !== 'RESERVED_LOCKED');
    const inDbm = hasArrival
      ? round2(effectiveArrivalDbmByKey[key])
      : allowGlobalFallback && params.fallbackInputDbm !== null
      ? round2(params.fallbackInputDbm)
      : null;
    const loss =
      sp.splice_loss_db !== undefined && !Number.isNaN(Number(sp.splice_loss_db))
        ? Number(sp.splice_loss_db)
        : DEFAULT_PASS_THROUGH_SPLICE_LOSS_DB;
    let outDbm: number | null = null;
    if (inDbm !== null) {
      if (sp.action === 'PASS_THROUGH_JOINT') {
        outDbm = round2(inDbm - loss);
      } else if (sp.action === 'FEED_INTERNAL_SPLITTER') {
        const targetSpl = sp.target_splitter_id ? byId[sp.target_splitter_id] : undefined;
        outDbm = targetSpl?.calculated_output_dbm ?? round2(inDbm - loss);
      } else {
        outDbm = inDbm;
      }
    }
    return {
      ...sp,
      splice_loss_db: loss,
      calculated_in_dbm: inDbm,
      calculated_out_dbm: outDbm,
    };
  });

  return {
    evaluatedSplitters: working,
    evaluatedCoreSplices,
  };
}

/**
 * Traverses OLT -> Cable -> DIST_NODE / FOSC_JOINT / FDB_FAT graph and computes exact
 * optical signal budget for every node. Avoids native ES6 Map to keep React
 * map components safe from global Map constructor collisions.
 */
export function calculateTopologyOpticalBudgets(
  nodes: SupabaseGisNode[],
  cables: SupabaseGisCable[],
  ponPortsById: Record<string, SupabaseGisOltPonPort> = {}
): Record<string, NodeOpticalBudgetResult> {
  const nodeById: Record<string, SupabaseGisNode> = {};
  const oltNodeByOltId: Record<string, SupabaseGisNode> = {};
  for (const n of nodes) {
    nodeById[n.id] = n;
    if (n.node_type === 'OLT' && n.olt_id) {
      oltNodeByOltId[n.olt_id] = n;
    }
  }

  const cablesById: Record<string, SupabaseGisCable> = {};
  const adj: Record<string, Array<{ neighborId: string; cable: SupabaseGisCable }>> = {};
  for (const c of cables) {
    cablesById[c.id] = c;
    if (!adj[c.source_node_id]) adj[c.source_node_id] = [];
    if (!adj[c.target_node_id]) adj[c.target_node_id] = [];
    adj[c.source_node_id].push({ neighborId: c.target_node_id, cable: c });
    adj[c.target_node_id].push({ neighborId: c.source_node_id, cable: c });
  }

  const results: Record<string, NodeOpticalBudgetResult> = {};
  const coreArrivalDbmByNode: Record<string, Record<string, number>> = {};
  const coreArrivalMetaByNode: Record<string, Record<string, CoreArrivalMeta>> = {};

  interface TraversalState {
    nodeId: string;
    oltId: string;
    oltName: string;
    sourcePonPortId: string | null;
    sourcePonLabel: string | null;
    oltTxDbm: number;
    inputDbm: number;
    totalDistanceMeters: number;
    fiberLossDb: number;
    spliceCount: number;
    spliceLossDb: number;
    upstreamThruLossDb: number;
    incomingCableId: string | null;
    incomingCoreNumber: number | null;
    hopCount: number;
    pathNodeIds: string[];
    upstreamSteps: OpticalBudgetStep[];
  }

  const queue: TraversalState[] = [];
  const bestInputByNode: Record<string, number> = {};
  const nodeExpansionCount: Record<string, number> = {};

  const resolvePonMeta = (
    ponPortId: string | null | undefined,
    fallbackOltId: string | null,
    fallbackOltName: string | null,
    fallbackTxDbm: number | null
  ): {
    oltId: string | null;
    oltName: string | null;
    ponPortId: string | null;
    ponLabel: string | null;
    txDbm: number | null;
  } => {
    if (ponPortId && ponPortsById[ponPortId]) {
      const pp = ponPortsById[ponPortId];
      const matchedOltNode = pp.olt_id ? oltNodeByOltId[pp.olt_id] : undefined;
      return {
        oltId: pp.olt_id || fallbackOltId,
        oltName: matchedOltNode?.name || fallbackOltName,
        ponPortId: pp.id,
        ponLabel: pp.port_label
          ? `PON-${pp.port_number} (${pp.port_label})`
          : `PON-${pp.port_number}`,
        txDbm: Number(pp.tx_power_dbm ?? fallbackTxDbm ?? 5.0),
      };
    }
    return {
      oltId: fallbackOltId,
      oltName: fallbackOltName,
      ponPortId: ponPortId || null,
      ponLabel: null,
      txDbm: fallbackTxDbm,
    };
  };

  // Pre-seed explicit per-core OLT/PON trunk assignments on DIST_NODE / FOSC_JOINT enclosures
  // (Supports a 24-Core trunk feeding DIST-MAIN carrying 12 PONs across OLT1, OLT2, OLT3!)
  const seedNodePerCoreArrivals = (targetNode: SupabaseGisNode) => {
    const splices = Array.isArray(targetNode.core_splices) ? targetNode.core_splices : [];
    if (!coreArrivalDbmByNode[targetNode.id]) coreArrivalDbmByNode[targetNode.id] = {};
    if (!coreArrivalMetaByNode[targetNode.id]) coreArrivalMetaByNode[targetNode.id] = {};

    for (const sp of splices) {
      if (!sp.incoming_cable_id || !sp.incoming_core_number) continue;
      const hasExplicitPon = Boolean(sp.source_pon_port_id);
      const hasExplicitTx =
        sp.source_tx_dbm !== null &&
        sp.source_tx_dbm !== undefined &&
        !Number.isNaN(Number(sp.source_tx_dbm));
      if (!hasExplicitPon && !hasExplicitTx) continue;

      const incCable = cablesById[sp.incoming_cable_id];
      const spanMeters = incCable
        ? Number(incCable.distance_meters) > 0
          ? Number(incCable.distance_meters)
          : computePolylineDistanceMeters(incCable.route_coordinates_json || [])
        : 0;
      const spanLoss = (spanMeters / 1000) * FIBER_ATTENUATION_DB_PER_KM;

      const oltNode = sp.source_olt_id ? oltNodeByOltId[sp.source_olt_id] : undefined;
      const resolved = resolvePonMeta(
        sp.source_pon_port_id,
        sp.source_olt_id || oltNode?.olt_id || oltNode?.id || null,
        oltNode?.name || null,
        hasExplicitTx ? Number(sp.source_tx_dbm) : oltNode ? Number(oltNode.tx_power_dbm ?? 5.0) : null
      );
      if (resolved.txDbm === null) continue;
      const arrDbm = round2(resolved.txDbm - spanLoss);
      const key = `${sp.incoming_cable_id}:${sp.incoming_core_number}`;
      coreArrivalDbmByNode[targetNode.id][key] = arrDbm;
      coreArrivalMetaByNode[targetNode.id][key] = {
        dbm: arrDbm,
        oltId: resolved.oltId,
        oltName: resolved.oltName,
        ponPortId: resolved.ponPortId,
        ponLabel: sp.source_pon_label || resolved.ponLabel,
        oltTxDbm: round2(resolved.txDbm),
      };
    }
  };

  for (const n of nodes) {
    coreArrivalDbmByNode[n.id] = {};
    coreArrivalMetaByNode[n.id] = {};
    seedNodePerCoreArrivals(n);
    if (n.node_type === 'OLT') {
      const tx = Number(n.tx_power_dbm ?? 5.0);
      bestInputByNode[n.id] = tx;
      const rootStep: OpticalBudgetStep = {
        id: `olt-${n.id}`,
        kind: 'OLT_SOURCE',
        label: 'OLT Source',
        detail: n.name,
        deltaDb: null,
        powerAfterDbm: round2(tx),
      };
      results[n.id] = {
        nodeId: n.id,
        oltId: n.olt_id || n.id,
        oltName: n.name,
        sourcePonPortId: null,
        sourcePonLabel: null,
        oltTxDbm: round2(tx),
        parentOutputDbm: null,
        inputDbm: round2(tx),
        thruOutputDbm: round2(tx),
        ontRxDbm: round2(tx),
        totalDistanceMeters: 0,
        fiberLossDb: 0,
        spliceCount: 0,
        spliceLossDb: 0,
        upstreamThruLossDb: 0,
        splitterLossDb: 0,
        localFiberLossDb: 0,
        localSpliceLossDb: 0,
        healthBand: 'IDEAL',
        incomingCableId: null,
        incomingCoreNumber: null,
        parentNodeId: null,
        hopCount: 0,
        budgetSteps: [rootStep],
      };
      queue.push({
        nodeId: n.id,
        oltId: n.olt_id || n.id,
        oltName: n.name,
        sourcePonPortId: null,
        sourcePonLabel: null,
        oltTxDbm: tx,
        inputDbm: tx,
        totalDistanceMeters: 0,
        fiberLossDb: 0,
        spliceCount: 0,
        spliceLossDb: 0,
        upstreamThruLossDb: 0,
        incomingCableId: null,
        incomingCoreNumber: null,
        hopCount: 0,
        pathNodeIds: [n.id],
        upstreamSteps: [rootStep],
      });
    }
  }

  // Also enqueue any DIST_NODE / FOSC_JOINT that has explicit per-core OLT/PON trunk overrides
  // even if not directly linked to an OLT marker yet (ensuring Area Dist -> FDB propagation works!).
  for (const n of nodes) {
    if (n.node_type !== 'DIST_NODE' && n.node_type !== 'FOSC_JOINT') continue;
    const seededKeys = Object.keys(coreArrivalMetaByNode[n.id] || {});
    if (seededKeys.length === 0) continue;
    const firstKey = seededKeys[0];
    const firstMeta = coreArrivalMetaByNode[n.id][firstKey];
    const [firstCableId, firstCoreStr] = firstKey.split(':');
    const firstCoreNum = Number(firstCoreStr) || 1;
    const hasOltNeighbor = (adj[n.id] || []).some(
      ({ neighborId }) => nodeById[neighborId]?.node_type === 'OLT'
    );
    if (!hasOltNeighbor) {
      queue.push({
        nodeId: n.id,
        oltId: firstMeta.oltId || n.id,
        oltName: firstMeta.oltName || n.name,
        sourcePonPortId: firstMeta.ponPortId,
        sourcePonLabel: firstMeta.ponLabel,
        oltTxDbm: firstMeta.oltTxDbm ?? firstMeta.dbm,
        inputDbm: firstMeta.dbm,
        totalDistanceMeters: 0,
        fiberLossDb: 0,
        spliceCount: 0,
        spliceLossDb: 0,
        upstreamThruLossDb: 0,
        incomingCableId: firstCableId || null,
        incomingCoreNumber: firstCoreNum,
        hopCount: 1,
        pathNodeIds: [n.id],
        upstreamSteps: [
          {
            id: `trunk-seed-${n.id}`,
            kind: 'OLT_SOURCE',
            label: firstMeta.oltName || 'Trunk OLT Source',
            detail: firstMeta.ponLabel || `Core #${firstCoreNum}`,
            deltaDb: null,
            powerAfterDbm: round2(firstMeta.oltTxDbm ?? firstMeta.dbm),
          },
        ],
      });
    }
  }

  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const curNode = nodeById[cur.nodeId];
    if (!curNode) continue;

    // Guard against runaway re-expansions in cyclic topologies while still allowing multi-PON trunk propagation
    const expCount = (nodeExpansionCount[cur.nodeId] || 0) + 1;
    if (expCount > 24) continue;
    nodeExpansionCount[cur.nodeId] = expCount;

    const curIsDistOrJoint =
      curNode.node_type === 'DIST_NODE' || curNode.node_type === 'FOSC_JOINT';
    const curHasPerCoreTrunkMap =
      curIsDistOrJoint &&
      Array.isArray(curNode.core_splices) &&
      curNode.core_splices.some(
        (sp) =>
          Boolean(sp.source_pon_port_id) ||
          Boolean(sp.source_olt_id) ||
          (sp.source_tx_dbm !== null && sp.source_tx_dbm !== undefined) ||
          sp.action === 'PASS_THROUGH_JOINT'
      );

    // Evaluate internal splitters + pass-through core splices inside curNode given current core arrivals
    const curEnclosureEval =
      curNode.node_type !== 'OLT'
        ? evaluateEnclosureOpticalState({
            node: curNode,
            arrivalDbmByCoreKey: coreArrivalDbmByNode[curNode.id] || {},
            fallbackInputDbm: cur.inputDbm,
            ponPortsById,
            cablesById,
          })
        : { evaluatedSplitters: [], evaluatedCoreSplices: [] };

    // Determine default optical power leaving curNode along a downstream trunk fiber (fallback when no pass-through joint or explicit leg feed exists)
    let defaultOutgoingDbm = cur.inputDbm;
    let defaultAddedThruLoss = 0;
    let defaultAddedSpliceCount = 0;
    let defaultAddedSpliceLoss = 0;
    let defaultLeaveStep: OpticalBudgetStep | null = null;

    if (curNode.node_type !== 'OLT') {
      const nodeSplice = resolveHopSpliceLoss(curNode.loss_per_splice);
      if (curEnclosureEval.evaluatedSplitters.length > 0) {
        const primarySpl = curEnclosureEval.evaluatedSplitters[0];
        const primarySpec = SPLITTER_SPECS[primarySpl.splitter_type] || SPLITTER_SPECS['none'];
        const splOut = primarySpl.calculated_thru_dbm ?? primarySpl.calculated_output_dbm;
        if (splOut !== null && splOut !== undefined) {
          defaultAddedThruLoss = primarySpec.isAsymmetricFbt
            ? primarySpec.thruLossDb
            : primarySpec.dropLossDb;
          defaultOutgoingDbm = Number(splOut);
          defaultLeaveStep = {
            id: `up-ispl-${curNode.id}-${primarySpl.id}`,
            kind: 'UPSTREAM_SPLITTER',
            label: `Upstream Splitter (${curNode.name} · ${primarySpl.label})`,
            detail: `${primarySpec.type} (-${defaultAddedThruLoss.toFixed(1)} dB)`,
            deltaDb: round2(-defaultAddedThruLoss),
            powerAfterDbm: round2(defaultOutgoingDbm),
          };
        }
      } else {
        const spec = SPLITTER_SPECS[curNode.splitter_type] || SPLITTER_SPECS['none'];
        defaultAddedSpliceCount = 1;
        defaultAddedSpliceLoss = nodeSplice;
        if (spec.isAsymmetricFbt) {
          defaultAddedThruLoss = spec.thruLossDb;
          defaultOutgoingDbm -= spec.thruLossDb + nodeSplice;
          defaultLeaveStep = {
            id: `up-fbt-${curNode.id}`,
            kind: 'UPSTREAM_SPLITTER',
            label: `Upstream FBT (${curNode.name})`,
            detail: `${spec.type} Thru (-${spec.thruLossDb.toFixed(1)} dB) & Splice (-${nodeSplice.toFixed(2)} dB)`,
            deltaDb: round2(-(spec.thruLossDb + nodeSplice)),
            powerAfterDbm: round2(defaultOutgoingDbm),
          };
        } else if (spec.type !== 'none') {
          defaultAddedThruLoss = spec.dropLossDb;
          defaultOutgoingDbm -= spec.dropLossDb + nodeSplice;
          defaultLeaveStep = {
            id: `up-plc-${curNode.id}`,
            kind: 'UPSTREAM_SPLITTER',
            label: `Upstream Splitter (${curNode.name})`,
            detail: `${spec.type} PLC (-${spec.dropLossDb.toFixed(1)} dB) & Splice (-${nodeSplice.toFixed(2)} dB)`,
            deltaDb: round2(-(spec.dropLossDb + nodeSplice)),
            powerAfterDbm: round2(defaultOutgoingDbm),
          };
        } else {
          defaultOutgoingDbm -= nodeSplice;
          defaultLeaveStep = {
            id: `up-joint-${curNode.id}`,
            kind: 'UPSTREAM_JOINT',
            label: `Upstream Splice (${curNode.name})`,
            detail: `Straight Fusion Splice (-${nodeSplice.toFixed(2)} dB)`,
            deltaDb: round2(-nodeSplice),
            powerAfterDbm: round2(defaultOutgoingDbm),
          };
        }
      }
    }

    const neighbors = adj[cur.nodeId] || [];
    for (const { neighborId, cable } of neighbors) {
      const targetNode = nodeById[neighborId];
      if (!targetNode || targetNode.node_type === 'OLT') continue;
      if (cur.pathNodeIds.includes(neighborId)) continue;

      if (targetNode.feed_cable_id && targetNode.feed_cable_id !== cable.id) {
        continue;
      }

      const spanMeters =
        Number(cable.distance_meters) > 0
          ? Number(cable.distance_meters)
          : computePolylineDistanceMeters(cable.route_coordinates_json || []);
      const spanFiberLoss = (spanMeters / 1000) * FIBER_ATTENUATION_DB_PER_KM;

      let branchOltTxDbm = cur.oltTxDbm;
      let branchPonPortId = cur.sourcePonPortId;
      let branchPonLabel = cur.sourcePonLabel;
      let baseOltOutDbm = defaultOutgoingDbm;

      if (curNode.node_type === 'OLT') {
        const directTargetPon =
          targetNode.pon_port_id &&
          ponPortsById[targetNode.pon_port_id] &&
          ponPortsById[targetNode.pon_port_id].olt_id === curNode.olt_id
            ? targetNode.pon_port_id
            : null;
        const cablePonId = cable.source_pon_port_id || curNode.pon_port_id || directTargetPon || null;
        if (cablePonId && ponPortsById[cablePonId]) {
          const ponPort = ponPortsById[cablePonId];
          branchOltTxDbm = Number(ponPort.tx_power_dbm ?? branchOltTxDbm);
          baseOltOutDbm = branchOltTxDbm;
          branchPonPortId = ponPort.id;
          branchPonLabel = ponPort.port_label
            ? `PON-${ponPort.port_number} (${ponPort.port_label})`
            : `PON-${ponPort.port_number}`;
        }
      }

      const targetIsDistOrJoint =
        targetNode.node_type === 'DIST_NODE' || targetNode.node_type === 'FOSC_JOINT';
      const targetSpliceByCoreKey: Record<string, EnclosureCoreSpliceEntry> = {};
      for (const sp of targetNode.core_splices || []) {
        if (sp.incoming_cable_id === cable.id && sp.incoming_core_number) {
          targetSpliceByCoreKey[`${cable.id}:${sp.incoming_core_number}`] = sp;
        }
      }
      const cableCoreEntries =
        Array.isArray(cable.cores_allocation_json) && cable.cores_allocation_json.length > 0
          ? cable.cores_allocation_json
          : Array.isArray(cable.cores_tia598_json)
          ? cable.cores_tia598_json
          : [];
      const cableCoreByNum: Record<number, GisCoreEntry> = {};
      for (const ce of cableCoreEntries) {
        if (ce && typeof ce.coreNumber === 'number') {
          cableCoreByNum[ce.coreNumber] = ce;
        }
      }

      // Compute outgoing optical power & source metadata for EVERY core on this cable
      const totalCores = Math.max(1, Number(cable.cable_cores || 2));
      const requestedFeedCore = Math.max(1, Number(targetNode.feed_core_number || 1));
      const targetArrivalByCore: Record<
        number,
        {
          outDbm: number;
          meta: CoreArrivalMeta;
          passThroughSplice?: EnclosureCoreSpliceEntry;
          splitterLegFeed?: { splitter: InternalSplitterUnit; leg: InternalSplitterLeg };
        }
      > = {};

      if (!coreArrivalDbmByNode[neighborId]) coreArrivalDbmByNode[neighborId] = {};
      if (!coreArrivalMetaByNode[neighborId]) coreArrivalMetaByNode[neighborId] = {};
      let anyCoreArrivalChanged = false;

      for (let outCore = 1; outCore <= totalCores; outCore++) {
        let outCoreDbm = curNode.node_type === 'OLT' ? baseOltOutDbm : defaultOutgoingDbm;
        let coreOltId: string | null = cur.oltId;
        let coreOltName: string | null = cur.oltName;
        let corePonPortId: string | null = branchPonPortId;
        let corePonLabel: string | null = branchPonLabel;
        let coreOltTxDbm: number | null = branchOltTxDbm;
        let matchedPt: EnclosureCoreSpliceEntry | undefined;
        let matchedLegFeed: { splitter: InternalSplitterUnit; leg: InternalSplitterLeg } | undefined;
        let hasExplicitCoreRoute = false;

        if (curNode.node_type === 'OLT') {
          // Check per-core OLT/PON override on targetNode.core_splices OR cable.cores_allocation_json!
          const targetCoreSplice = targetSpliceByCoreKey[`${cable.id}:${outCore}`];
          const cableCore = cableCoreByNum[outCore];
          const explicitPonId =
            targetCoreSplice?.source_pon_port_id || cableCore?.origin_pon_port_id || null;
          const explicitOltId =
            targetCoreSplice?.source_olt_id || cableCore?.origin_olt_id || null;
          const explicitTx =
            targetCoreSplice?.source_tx_dbm !== null &&
            targetCoreSplice?.source_tx_dbm !== undefined &&
            !Number.isNaN(Number(targetCoreSplice.source_tx_dbm))
              ? Number(targetCoreSplice.source_tx_dbm)
              : null;

          if (explicitPonId || explicitTx !== null || explicitOltId) {
            const matchedOltNode = explicitOltId ? oltNodeByOltId[explicitOltId] : undefined;
            const resolved = resolvePonMeta(
              explicitPonId,
              explicitOltId || coreOltId,
              matchedOltNode?.name || coreOltName,
              explicitTx !== null
                ? explicitTx
                : matchedOltNode
                ? Number(matchedOltNode.tx_power_dbm ?? coreOltTxDbm)
                : coreOltTxDbm
            );
            if (resolved.txDbm !== null) {
              outCoreDbm = resolved.txDbm;
              coreOltTxDbm = resolved.txDbm;
              coreOltId = resolved.oltId;
              coreOltName = resolved.oltName;
              corePonPortId = resolved.ponPortId;
              corePonLabel = targetCoreSplice?.source_pon_label || resolved.ponLabel;
              hasExplicitCoreRoute = true;
            }
          }
        } else {
          // Priority 1: Pass-Through Joint Splice on curNode targeting (cable.id, outCore)
          matchedPt = curEnclosureEval.evaluatedCoreSplices.find(
            (sp) =>
              sp.action === 'PASS_THROUGH_JOINT' &&
              sp.outgoing_cable_id === cable.id &&
              Number(sp.outgoing_core_number || 1) === outCore
          );
          if (
            matchedPt &&
            matchedPt.calculated_out_dbm !== null &&
            matchedPt.calculated_out_dbm !== undefined
          ) {
            outCoreDbm = Number(matchedPt.calculated_out_dbm);
            hasExplicitCoreRoute = true;
            // Preserve the EXACT upstream OLT / PON identity of the pass-through core!
            const inKey = `${matchedPt.incoming_cable_id}:${matchedPt.incoming_core_number}`;
            const upMeta = coreArrivalMetaByNode[curNode.id]?.[inKey];
            if (upMeta) {
              coreOltId = upMeta.oltId;
              coreOltName = upMeta.oltName;
              corePonPortId = upMeta.ponPortId;
              corePonLabel = upMeta.ponLabel;
              coreOltTxDbm = upMeta.oltTxDbm;
            } else if (matchedPt.source_pon_port_id) {
              const resolved = resolvePonMeta(
                matchedPt.source_pon_port_id,
                matchedPt.source_olt_id || coreOltId,
                coreOltName,
                matchedPt.source_tx_dbm ?? coreOltTxDbm
              );
              coreOltId = resolved.oltId;
              coreOltName = resolved.oltName;
              corePonPortId = resolved.ponPortId;
              corePonLabel = matchedPt.source_pon_label || resolved.ponLabel;
              coreOltTxDbm = resolved.txDbm;
            }
          } else {
            // Priority 2: Internal Splitter Leg assigned as OUTGOING_CABLE_FEED to (cable.id, outCore)
            for (const spl of curEnclosureEval.evaluatedSplitters) {
              const foundLeg = spl.legs.find(
                (l) =>
                  l.status === 'OUTGOING_CABLE_FEED' &&
                  l.target_cable_id === cable.id &&
                  Number(l.target_core_number || 1) === outCore
              );
              if (
                foundLeg &&
                foundLeg.calculated_output_dbm !== null &&
                foundLeg.calculated_output_dbm !== undefined
              ) {
                matchedLegFeed = { splitter: spl, leg: foundLeg };
                outCoreDbm = Number(foundLeg.calculated_output_dbm);
                hasExplicitCoreRoute = true;
                if (spl.incoming_cable_id && spl.incoming_core_number) {
                  const splInMeta =
                    coreArrivalMetaByNode[curNode.id]?.[
                      `${spl.incoming_cable_id}:${spl.incoming_core_number}`
                    ];
                  if (splInMeta) {
                    coreOltId = splInMeta.oltId;
                    coreOltName = splInMeta.oltName;
                    corePonPortId = splInMeta.ponPortId;
                    corePonLabel = splInMeta.ponLabel;
                    coreOltTxDbm = splInMeta.oltTxDbm;
                  }
                }
                break;
              }
            }
          }

          // If curNode is a multi-PON DIST_NODE/FOSC with explicit per-core trunk mappings,
          // do NOT flood unrouted dark cores on an outgoing trunk with a single arbitrary OLT power!
          if (!hasExplicitCoreRoute && curHasPerCoreTrunkMap && targetIsDistOrJoint) {
            continue;
          }
        }

        // For DIST_NODE / FOSC_JOINT receiving a multi-core cable directly from an OLT:
        // If targetNode has explicit per-core mappings on this cable, do not overwrite an unmapped core with forced OLT power
        const targetHasExplicitPerCoreOnCable =
          targetIsDistOrJoint &&
          Object.values(targetSpliceByCoreKey).some(
            (sp) =>
              Boolean(sp.source_pon_port_id) ||
              (sp.source_tx_dbm !== null && sp.source_tx_dbm !== undefined)
          );
        if (
          curNode.node_type === 'OLT' &&
          targetHasExplicitPerCoreOnCable &&
          !hasExplicitCoreRoute
        ) {
          continue;
        }

        const arrivalCoreDbm = round2(outCoreDbm - spanFiberLoss);
        const coreKey = `${cable.id}:${outCore}`;
        const prevCoreDbm = coreArrivalDbmByNode[neighborId][coreKey];
        const prevCorePon = coreArrivalMetaByNode[neighborId][coreKey]?.ponPortId;
        if (
          prevCoreDbm === undefined ||
          Math.abs(prevCoreDbm - arrivalCoreDbm) > 0.005 ||
          prevCorePon !== corePonPortId
        ) {
          anyCoreArrivalChanged = true;
        }
        const meta: CoreArrivalMeta = {
          dbm: arrivalCoreDbm,
          oltId: coreOltId,
          oltName: coreOltName,
          ponPortId: corePonPortId,
          ponLabel: corePonLabel,
          oltTxDbm: coreOltTxDbm !== null ? round2(coreOltTxDbm) : null,
        };
        coreArrivalDbmByNode[neighborId][coreKey] = arrivalCoreDbm;
        coreArrivalMetaByNode[neighborId][coreKey] = meta;
        targetArrivalByCore[outCore] = {
          outDbm: outCoreDbm,
          meta,
          passThroughSplice: matchedPt,
          splitterLegFeed: matchedLegFeed,
        };
      }

      const availableCoreNums = Object.keys(targetArrivalByCore)
        .map(Number)
        .sort((a, b) => a - b);
      if (availableCoreNums.length === 0) {
        continue;
      }

      const requestedInfo = targetArrivalByCore[requestedFeedCore];
      const requestedHasExplicitRoute = Boolean(
        requestedInfo?.passThroughSplice || requestedInfo?.splitterLegFeed
      );
      let effectiveCoreNumber = requestedInfo ? requestedFeedCore : availableCoreNums[0];
      let selectedCoreInfo = requestedInfo || targetArrivalByCore[availableCoreNums[0]];

      if (!requestedHasExplicitRoute && (!targetNode.feed_core_number || requestedFeedCore === 1)) {
        for (const outCore of availableCoreNums) {
          const candidate = targetArrivalByCore[outCore];
          if (candidate?.passThroughSplice || candidate?.splitterLegFeed) {
            effectiveCoreNumber = outCore;
            selectedCoreInfo = candidate;
            break;
          }
        }
      }

      const effectiveOutgoingDbm = selectedCoreInfo.outDbm;
      const arrivalDbm = effectiveOutgoingDbm - spanFiberLoss;
      const effectiveMeta = selectedCoreInfo.meta;
      const effOltId = effectiveMeta.oltId || cur.oltId;
      const effOltName = effectiveMeta.oltName || cur.oltName;
      const effPonPortId = effectiveMeta.ponPortId ?? branchPonPortId;
      const effPonLabel = effectiveMeta.ponLabel ?? branchPonLabel;
      const effOltTxDbm = effectiveMeta.oltTxDbm ?? branchOltTxDbm;

      let branchSteps = cur.upstreamSteps.slice();
      let hopThruLoss = defaultAddedThruLoss;
      let hopSpliceCount = defaultAddedSpliceCount;
      let hopSpliceLoss = defaultAddedSpliceLoss;

      if (curNode.node_type === 'OLT') {
        branchSteps = [
          {
            id: `olt-${curNode.id}-${cable.id}-${effectiveCoreNumber}`,
            kind: 'OLT_SOURCE',
            label: 'OLT Source',
            detail: `${effOltName || curNode.name}${effPonLabel ? ` · ${effPonLabel}` : ''}`,
            deltaDb: null,
            powerAfterDbm: round2(effOltTxDbm),
          },
        ];
      } else if (selectedCoreInfo.passThroughSplice) {
        const pt = selectedCoreInfo.passThroughSplice;
        const ptLoss = Number(pt.splice_loss_db ?? DEFAULT_PASS_THROUGH_SPLICE_LOSS_DB);
        hopThruLoss = 0;
        hopSpliceCount = 1;
        hopSpliceLoss = ptLoss;
        branchSteps.push({
          id: `up-pt-${curNode.id}-${cable.id}-${effectiveCoreNumber}`,
          kind: 'UPSTREAM_JOINT',
          label: `Pass-Through Joint (${curNode.name})`,
          detail: `In Core #${pt.incoming_core_number} ➔ Out Core #${pt.outgoing_core_number || effectiveCoreNumber} (-${ptLoss.toFixed(2)} dB Fusion Splice · Splitter Bypassed)`,
          deltaDb: round2(-ptLoss),
          powerAfterDbm: round2(effectiveOutgoingDbm),
        });
      } else if (selectedCoreInfo.splitterLegFeed) {
        const { splitter, leg } = selectedCoreInfo.splitterLegFeed;
        const spec = SPLITTER_SPECS[splitter.splitter_type] || SPLITTER_SPECS['none'];
        const legLoss = spec.isAsymmetricFbt && leg.legNumber === 2 ? spec.thruLossDb : spec.dropLossDb;
        hopThruLoss = legLoss;
        hopSpliceCount = 0;
        hopSpliceLoss = 0;
        branchSteps.push({
          id: `up-leg-${curNode.id}-${splitter.id}-${leg.legNumber}`,
          kind: 'UPSTREAM_SPLITTER',
          label: `Upstream Splitter (${curNode.name} · ${splitter.label})`,
          detail: `${leg.legLabel} · ${splitter.splitter_type} (-${legLoss.toFixed(1)} dB)`,
          deltaDb: round2(-legLoss),
          powerAfterDbm: round2(effectiveOutgoingDbm),
        });
      } else if (defaultLeaveStep) {
        branchSteps.push(defaultLeaveStep);
      }

      const prevBest = bestInputByNode[neighborId];
      const isForcedFeed = targetNode.feed_cable_id === cable.id;
      const shouldSkipResultUpdate =
        prevBest !== undefined &&
        (isForcedFeed
          ? Math.abs(arrivalDbm - prevBest) <= 0.001
          : arrivalDbm <= prevBest + 0.001);

      if (cur.hopCount >= 24) continue;
      if (shouldSkipResultUpdate && !anyCoreArrivalChanged) {
        continue;
      }

      if (!shouldSkipResultUpdate) {
        bestInputByNode[neighborId] = arrivalDbm;

        const totalDist = cur.totalDistanceMeters + spanMeters;
        const totalFiberLoss = cur.fiberLossDb + spanFiberLoss;
        const totalSpliceCount = cur.spliceCount + hopSpliceCount;
        const totalSpliceLoss = cur.spliceLossDb + hopSpliceLoss;
        const totalThruLoss = cur.upstreamThruLossDb + hopThruLoss;

        const targetInternalEval = evaluateEnclosureOpticalState({
          node: targetNode,
          arrivalDbmByCoreKey: coreArrivalDbmByNode[neighborId],
          fallbackInputDbm: arrivalDbm,
          ponPortsById,
          cablesById,
        });

        const targetSpliceDb = resolveHopSpliceLoss(targetNode.loss_per_splice);
        let ontRx = arrivalDbm - targetSpliceDb;
        let thruOut = arrivalDbm - targetSpliceDb;
        let targetSplitterLoss = 0;
        let targetStepDetail: OpticalBudgetStep;

        if (targetInternalEval.evaluatedSplitters.length > 0) {
          const primarySpl = targetInternalEval.evaluatedSplitters[0];
          const primarySpec = SPLITTER_SPECS[primarySpl.splitter_type] || SPLITTER_SPECS['none'];
          targetSplitterLoss = primarySpec.dropLossDb;
          ontRx = primarySpl.calculated_output_dbm ?? round2(arrivalDbm - primarySpec.dropLossDb);
          thruOut = primarySpl.calculated_thru_dbm ?? ontRx;
          targetStepDetail = {
            id: `split-${neighborId}-${primarySpl.id}`,
            kind: 'CURRENT_SPLITTER',
            label: `${primarySpl.label} (${primarySpl.splitter_type})`,
            detail: `${targetInternalEval.evaluatedSplitters.length} internal splitter${
              targetInternalEval.evaluatedSplitters.length > 1 ? 's' : ''
            } (-${primarySpec.dropLossDb.toFixed(1)} dB)`,
            deltaDb: round2(-primarySpec.dropLossDb),
            powerAfterDbm: round2(ontRx),
          };
        } else {
          const splitterSpec = SPLITTER_SPECS[targetNode.splitter_type] || SPLITTER_SPECS['none'];
          const hasSplitter = splitterSpec.type !== 'none';
          targetSplitterLoss = splitterSpec.dropLossDb;
          ontRx = hasSplitter
            ? arrivalDbm - splitterSpec.dropLossDb - targetSpliceDb
            : arrivalDbm - targetSpliceDb;
          thruOut = splitterSpec.isAsymmetricFbt
            ? arrivalDbm - splitterSpec.thruLossDb - targetSpliceDb
            : hasSplitter
            ? arrivalDbm - splitterSpec.dropLossDb - targetSpliceDb
            : arrivalDbm - targetSpliceDb;
          targetStepDetail = hasSplitter
            ? {
                id: `split-${neighborId}`,
                kind: 'CURRENT_SPLITTER',
                label: `This Splitter (${splitterSpec.type})`,
                detail: `${splitterSpec.isAsymmetricFbt ? 'Drop Leg' : 'PLC Split'} (-${splitterSpec.dropLossDb.toFixed(1)} dB)`,
                deltaDb: round2(-splitterSpec.dropLossDb),
                powerAfterDbm: round2(ontRx),
              }
            : {
                id: `pass-${neighborId}`,
                kind: 'PASS_THROUGH',
                label: 'Straight Splice / Pass-Through',
                detail: 'No internal splitter',
                deltaDb: 0,
                powerAfterDbm: round2(ontRx),
              };
        }

        const feedAndSpliceDelta =
          targetInternalEval.evaluatedSplitters.length > 0
            ? -spanFiberLoss
            : -(spanFiberLoss + targetSpliceDb);
        const afterFeedAndSplice =
          targetInternalEval.evaluatedSplitters.length > 0
            ? arrivalDbm
            : arrivalDbm - targetSpliceDb;

        const targetSteps: OpticalBudgetStep[] = [
          ...branchSteps,
          {
            id: `feed-${cable.id}-${neighborId}`,
            kind: 'FEED_SPLICE',
            label:
              targetInternalEval.evaluatedSplitters.length > 0
                ? `Feed Cable (Core #${effectiveCoreNumber} · ${getTia598Color(effectiveCoreNumber).name})`
                : 'Feed Cable & Splice',
            detail:
              targetInternalEval.evaluatedSplitters.length > 0
                ? `${cable.cable_cores}C ${Math.round(spanMeters)}m (-${spanFiberLoss.toFixed(2)} dB)`
                : `${cable.cable_cores}C ${Math.round(spanMeters)}m (-${spanFiberLoss.toFixed(2)} dB) + Splice (-${targetSpliceDb.toFixed(2)} dB)`,
            deltaDb: round2(feedAndSpliceDelta),
            powerAfterDbm: round2(afterFeedAndSplice),
          },
          targetStepDetail,
        ];

        const nextUpstreamSteps: OpticalBudgetStep[] = [
          ...branchSteps,
          {
            id: `cable-${cable.id}-${neighborId}`,
            kind: 'CABLE',
            label: `Cable to ${targetNode.name}`,
            detail: `${cable.cable_cores}C · Core #${effectiveCoreNumber} · ${Math.round(spanMeters)}m @ 0.35 dB/km`,
            deltaDb: round2(-spanFiberLoss),
            powerAfterDbm: round2(arrivalDbm),
          },
        ];

        results[neighborId] = {
          nodeId: neighborId,
          oltId: effOltId,
          oltName: effOltName,
          sourcePonPortId: effPonPortId,
          sourcePonLabel: effPonLabel,
          oltTxDbm: round2(effOltTxDbm),
          parentOutputDbm: curNode.node_type === 'OLT' ? null : round2(effectiveOutgoingDbm),
          inputDbm: round2(arrivalDbm),
          thruOutputDbm: round2(thruOut),
          ontRxDbm: round2(ontRx),
          totalDistanceMeters: Math.round(totalDist),
          fiberLossDb: round2(totalFiberLoss),
          spliceCount: totalSpliceCount + (targetInternalEval.evaluatedSplitters.length > 0 ? 0 : 1),
          spliceLossDb: round2(
            totalSpliceLoss + (targetInternalEval.evaluatedSplitters.length > 0 ? 0 : targetSpliceDb)
          ),
          upstreamThruLossDb: round2(totalThruLoss),
          splitterLossDb: round2(targetSplitterLoss),
          localFiberLossDb: round2(spanFiberLoss),
          localSpliceLossDb:
            targetInternalEval.evaluatedSplitters.length > 0 ? 0 : round2(targetSpliceDb),
          healthBand: classifyOpticalHealth(ontRx),
          incomingCableId: cable.id,
          incomingCoreNumber: effectiveCoreNumber,
          parentNodeId: cur.nodeId,
          hopCount: cur.hopCount + 1,
          budgetSteps: targetSteps,
        };

        queue.push({
          nodeId: neighborId,
          oltId: effOltId,
          oltName: effOltName,
          sourcePonPortId: effPonPortId,
          sourcePonLabel: effPonLabel,
          oltTxDbm: effOltTxDbm,
          inputDbm: arrivalDbm,
          totalDistanceMeters: totalDist,
          fiberLossDb: totalFiberLoss,
          spliceCount: totalSpliceCount,
          spliceLossDb: totalSpliceLoss,
          upstreamThruLossDb: totalThruLoss,
          incomingCableId: cable.id,
          incomingCoreNumber: effectiveCoreNumber,
          hopCount: cur.hopCount + 1,
          pathNodeIds: [...cur.pathNodeIds, neighborId],
          upstreamSteps: nextUpstreamSteps,
        });
      } else if (anyCoreArrivalChanged) {
        // Re-propagate updated per-core arrivals downstream (e.g., DIST-MAIN -> Area Dist -> Local FDBs)
        const existingResult = results[neighborId];
        queue.push({
          nodeId: neighborId,
          oltId: existingResult?.oltId || effOltId,
          oltName: existingResult?.oltName || effOltName,
          sourcePonPortId: existingResult?.sourcePonPortId ?? effPonPortId,
          sourcePonLabel: existingResult?.sourcePonLabel ?? effPonLabel,
          oltTxDbm: existingResult?.oltTxDbm ?? effOltTxDbm,
          inputDbm: existingResult?.inputDbm ?? arrivalDbm,
          totalDistanceMeters: existingResult?.totalDistanceMeters ?? cur.totalDistanceMeters + spanMeters,
          fiberLossDb: existingResult?.fiberLossDb ?? cur.fiberLossDb + spanFiberLoss,
          spliceCount: existingResult?.spliceCount ?? cur.spliceCount + hopSpliceCount,
          spliceLossDb: existingResult?.spliceLossDb ?? cur.spliceLossDb + hopSpliceLoss,
          upstreamThruLossDb: existingResult?.upstreamThruLossDb ?? cur.upstreamThruLossDb + hopThruLoss,
          incomingCableId: existingResult?.incomingCableId ?? cable.id,
          incomingCoreNumber: existingResult?.incomingCoreNumber ?? effectiveCoreNumber,
          hopCount: cur.hopCount + 1,
          pathNodeIds: [...cur.pathNodeIds, neighborId],
          upstreamSteps: cur.upstreamSteps.slice(),
        });
      }
    }
  }

  for (const n of nodes) {
    const arrivals = coreArrivalDbmByNode[n.id] || {};
    const arrivalMetas = coreArrivalMetaByNode[n.id] || {};
    const isDistOrJoint = n.node_type === 'DIST_NODE' || n.node_type === 'FOSC_JOINT';
    const distinctPonIds = new Set<string>();
    for (const m of Object.values(arrivalMetas)) {
      if (m.ponPortId) distinctPonIds.add(m.ponPortId);
    }
    for (const sp of n.core_splices || []) {
      if (sp.source_pon_port_id) distinctPonIds.add(sp.source_pon_port_id);
    }
    const isMultiPonTrunkBox =
      isDistOrJoint &&
      (distinctPonIds.size > 1 ||
        (n.core_splices || []).some(
          (sp) =>
            Boolean(sp.source_pon_port_id) ||
            Boolean(sp.source_olt_id) ||
            (sp.source_tx_dbm !== null && sp.source_tx_dbm !== undefined)
        ));

    if (!results[n.id]) {
      const spec = SPLITTER_SPECS[n.splitter_type] || SPLITTER_SPECS['none'];
      const seededMetaKeys = Object.keys(arrivalMetas);
      const firstMeta = seededMetaKeys.length > 0 ? arrivalMetas[seededMetaKeys[0]] : undefined;
      const seededInDbm = firstMeta ? firstMeta.dbm : null;
      const seededRx =
        seededInDbm !== null
          ? round2(
              seededInDbm -
                (spec.type !== 'none' ? spec.dropLossDb : 0) -
                resolveHopSpliceLoss(n.loss_per_splice)
            )
          : null;
      results[n.id] = {
        nodeId: n.id,
        oltId: firstMeta?.oltId || null,
        oltName: firstMeta?.oltName || null,
        sourcePonPortId: firstMeta?.ponPortId || null,
        sourcePonLabel: firstMeta?.ponLabel || null,
        oltTxDbm: firstMeta?.oltTxDbm ?? null,
        parentOutputDbm: null,
        inputDbm: seededInDbm,
        thruOutputDbm: seededRx,
        ontRxDbm: seededRx,
        totalDistanceMeters: 0,
        fiberLossDb: 0,
        spliceCount: 0,
        spliceLossDb: 0,
        upstreamThruLossDb: 0,
        splitterLossDb: spec.dropLossDb,
        localFiberLossDb: 0,
        localSpliceLossDb: 0,
        healthBand: classifyOpticalHealth(seededRx),
        incomingCableId: n.feed_cable_id || null,
        incomingCoreNumber: n.feed_core_number || null,
        parentNodeId: null,
        hopCount: firstMeta ? 1 : 0,
        budgetSteps: [],
      };
    }

    const r = results[n.id];
    const evalState = evaluateEnclosureOpticalState({
      node: n,
      arrivalDbmByCoreKey: arrivals,
      fallbackInputDbm: r.inputDbm,
      ponPortsById,
      cablesById,
    });
    const boxCapacity = Math.max(
      Number(n.box_capacity || 0),
      Number(n.total_ports || 0),
      n.node_type === 'FDB_FAT' ? 8 : 0
    );
    let totalAllocated = 0;
    let usedPorts = 0;
    if (evalState.evaluatedSplitters.length > 0) {
      for (const sp of evalState.evaluatedSplitters) {
        totalAllocated += sp.legs.length;
        usedPorts += sp.legs.filter((l) => l.status !== 'FREE').length;
      }
    } else {
      totalAllocated = Number(n.total_ports || 0);
    }

    r.arrivalDbmByCoreKey = arrivals;
    r.arrivalMetaByCoreKey = arrivalMetas;
    r.isMultiPonTrunkBox = isMultiPonTrunkBox;
    r.evaluatedSplitters = evalState.evaluatedSplitters;
    r.evaluatedCoreSplices = evalState.evaluatedCoreSplices;
    r.enclosureSummary = {
      boxCapacity: Math.max(boxCapacity, totalAllocated),
      splitterCount:
        evalState.evaluatedSplitters.length > 0
          ? evalState.evaluatedSplitters.length
          : n.splitter_type && n.splitter_type !== 'none'
          ? 1
          : 0,
      totalAllocatedPorts: totalAllocated,
      usedPorts,
      freePorts: Math.max(0, Math.max(boxCapacity, totalAllocated) - usedPorts),
      passThroughJointCount: evalState.evaluatedCoreSplices.filter(
        (s) => s.action === 'PASS_THROUGH_JOINT'
      ).length,
    };
  }

  return results;
}

export interface OpticalTraceHop {
  kind: 'OLT' | 'CABLE' | 'NODE' | 'OUTPUT';
  id: string;
  title: string;
  subtitle: string;
  badge?: string;
  powerDbm?: number | null;
  lossDb?: number | null;
  coreColorHex?: string;
  nodeType?: GisNodeType;
}

export interface OpticalTraceResult {
  isLinked: boolean;
  targetNode: SupabaseGisNode;
  budget: NodeOpticalBudgetResult | null;
  hops: OpticalTraceHop[];
  downstreamBranches: Array<{
    nodeName: string;
    nodeType: GisNodeType;
    areaName: string;
    cableName: string;
    distanceMeters: number;
  }>;
}

/**
 * Reconstructs the complete end-to-end optical breadcrumb chain from the source OLT/PON port
 * down through every feeder cable, core color/pair, distribution node, FOSC joint closure,
 * FAT/FDB splitter, and optional final output port or subscriber ONT.
 */
export function traceOpticalPathToNode(params: {
  targetNodeId: string;
  nodes: SupabaseGisNode[];
  cables: SupabaseGisCable[];
  budgetsByNodeId: Record<string, NodeOpticalBudgetResult>;
  oltsById?: Record<string, SupabaseGisOlt>;
  ponPortsById?: Record<string, SupabaseGisOltPonPort>;
  selectedOutput?: SupabaseGisSplitterOutput | null;
  subscriberLabel?: string | null;
  subscriberOnline?: boolean | null;
}): OpticalTraceResult | null {
  const nodeById: Record<string, SupabaseGisNode> = {};
  for (const n of params.nodes) nodeById[n.id] = n;
  const cableById: Record<string, SupabaseGisCable> = {};
  for (const c of params.cables) cableById[c.id] = c;

  const targetNode = nodeById[params.targetNodeId];
  if (!targetNode) return null;

  const targetBudget = params.budgetsByNodeId[targetNode.id] || null;
  const hops: OpticalTraceHop[] = [];

  if (targetBudget && targetBudget.healthBand !== 'UNLINKED') {
    const chainIds: string[] = [];
    const seen: Record<string, boolean> = {};
    let curId: string | null = targetNode.id;
    while (curId && !seen[curId]) {
      seen[curId] = true;
      chainIds.unshift(curId);
      curId = params.budgetsByNodeId[curId]?.parentNodeId || null;
    }

    for (let i = 0; i < chainIds.length; i++) {
      const nid = chainIds[i];
      const node = nodeById[nid];
      const b = params.budgetsByNodeId[nid];
      if (!node) continue;

      if (i > 0 && b?.incomingCableId) {
        const cable = cableById[b.incomingCableId];
        if (cable) {
          const coreNum = node.feed_core_number || b.incomingCoreNumber || 1;
          const coreColor = getTia598Color(coreNum);
          const coreEntry = (cable.cores_allocation_json || cable.cores_tia598_json || []).find(
            (c) => c.coreNumber === coreNum
          );
          const feedLabel =
            node.feed_core_pair || `Core #${coreNum} ${coreColor.name}`;
          const spanLoss = round2((Number(cable.distance_meters || 0) / 1000) * FIBER_ATTENUATION_DB_PER_KM);
          hops.push({
            kind: 'CABLE',
            id: cable.id,
            title: `${cable.cable_cores}C ${cable.name || 'Fiber Span'}`,
            subtitle: `${feedLabel} · ${cable.distance_meters}m${
              coreEntry?.forwarded_to_area ? ` · To ${coreEntry.forwarded_to_area}` : ''
            }`,
            badge: `${cable.distance_meters}m`,
            lossDb: spanLoss,
            coreColorHex: coreColor.hex,
          });
        }
      }

      if (node.node_type === 'OLT') {
        const olt = node.olt_id && params.oltsById ? params.oltsById[node.olt_id] : undefined;
        const ponPortId = targetBudget.sourcePonPortId || node.pon_port_id || null;
        const ponPort = ponPortId && params.ponPortsById ? params.ponPortsById[ponPortId] : undefined;
        const tx = ponPort ? Number(ponPort.tx_power_dbm) : Number(node.tx_power_dbm ?? 5.0);
        const modeTxt = olt ? olt.pon_mode : 'OLT';
        const ponTxt = ponPort ? `PON ${ponPort.port_number}${ponPort.port_label ? ` (${ponPort.port_label})` : ''}` : 'Direct Tx';
        hops.push({
          kind: 'OLT',
          id: node.id,
          title: `${node.name} (${modeTxt})`,
          subtitle: `${ponTxt} · ${ponPort?.sfp_class || inferSfpClassFromDbm(tx)} SFP`,
          badge: `${tx >= 0 ? '+' : ''}${tx.toFixed(1)} dBm`,
          powerDbm: tx,
          nodeType: 'OLT',
        });
      } else {
        const spec = SPLITTER_SPECS[node.splitter_type] || SPLITTER_SPECS['none'];
        let detail = getNodeTypeLabel(node.node_type);
        const hopSplice = resolveHopSpliceLoss(node.loss_per_splice);
        if (node.node_type === 'FOSC_JOINT') {
          const activeSplice = (node.splice_tray_json || []).find(
            (s) => s.coreIn === (node.feed_core_number || 1)
          );
          detail = activeSplice
            ? `${activeSplice.status} (-${hopSplice.toFixed(2)} dB)`
            : `Straight Splice (-${hopSplice.toFixed(2)} dB)`;
          if (spec.type !== 'none') detail += ` + ${node.splitter_type}`;
        } else if (spec.type !== 'none') {
          detail = `${node.splitter_type} ${spec.isAsymmetricFbt ? 'FBT Ratio' : 'PLC Splitter'} (-${spec.dropLossDb} dB · Splice -${hopSplice.toFixed(2)} dB)`;
        }

        const isIntermediateFbt = i < chainIds.length - 1 && spec.isAsymmetricFbt;
        const displayDbm = isIntermediateFbt ? b?.thruOutputDbm : b?.ontRxDbm ?? b?.inputDbm;

        hops.push({
          kind: 'NODE',
          id: node.id,
          title: node.name,
          subtitle: `${detail}${node.area_name ? ` · ${node.area_name}` : ''}`,
          badge:
            displayDbm !== null && displayDbm !== undefined
              ? `Out ${displayDbm >= 0 ? '+' : ''}${displayDbm.toFixed(2)} dBm`
              : undefined,
          powerDbm: displayDbm ?? null,
          nodeType: node.node_type,
        });
      }
    }

    if (params.selectedOutput) {
      const out = params.selectedOutput;
      const spec = SPLITTER_SPECS[targetNode.splitter_type] || SPLITTER_SPECS['none'];
      const isThroughLeg =
        spec.isAsymmetricFbt &&
        (out.port_number === 2 || out.utilization_type === 'DOWNSTREAM_AREA_FEED');
      const activeSplitterOutputDbm = isThroughLeg
        ? targetBudget.thruOutputDbm
        : targetBudget.ontRxDbm;
      const estRx =
        activeSplitterOutputDbm !== null && activeSplitterOutputDbm !== undefined
          ? computePortLiveRxDbm(activeSplitterOutputDbm, out.drop_distance_m ?? 0)
          : null;

      const labelTitle =
        out.utilization_type === 'CLIENT_ONT'
          ? `Port ${out.port_number}: ${params.subscriberLabel || out.client_name_manual || out.subscriber_username || 'Subscriber'}`
          : out.utilization_type === 'DOWNSTREAM_AREA_FEED' ||
            out.utilization_type === 'CASCADED_SPLITTER'
          ? `${out.leg_label || `Port ${out.port_number}`}: ${out.target_area_or_node || 'Downstream Feed'}`
          : `${out.leg_label || `Port ${out.port_number}`}: ${out.utilization_type}`;

      const onlineSuffix =
        params.subscriberOnline === true
          ? 'Online'
          : params.subscriberOnline === false
          ? 'Offline'
          : out.utilization_type === 'DOWNSTREAM_AREA_FEED'
          ? 'Trunk Forward'
          : out.utilization_type;

      hops.push({
        kind: 'OUTPUT',
        id: out.id || `port-${out.port_number}`,
        title: labelTitle,
        subtitle: `${onlineSuffix}${out.drop_distance_m ? ` · ${out.drop_distance_m}m` : ''}`,
        badge: estRx !== null && estRx !== undefined ? `${estRx.toFixed(2)} dBm` : undefined,
        powerDbm: estRx ?? null,
      });
    }
  } else {
    hops.push({
      kind: 'NODE',
      id: targetNode.id,
      title: targetNode.name,
      subtitle: 'Unlinked from OLT — Connect a fiber cable span from an OLT or upstream node.',
      nodeType: targetNode.node_type,
    });
  }

  // Downstream branches leaving this node
  const downstreamBranches: OpticalTraceResult['downstreamBranches'] = [];
  for (const c of params.cables) {
    if (c.source_node_id === targetNode.id || c.target_node_id === targetNode.id) {
      const otherId = c.source_node_id === targetNode.id ? c.target_node_id : c.source_node_id;
      const otherBudget = params.budgetsByNodeId[otherId];
      const otherNode = nodeById[otherId];
      if (otherNode && otherBudget?.parentNodeId === targetNode.id) {
        downstreamBranches.push({
          nodeName: otherNode.name,
          nodeType: otherNode.node_type,
          areaName: otherNode.area_name || '',
          cableName: c.name || `${c.cable_cores}C Span`,
          distanceMeters: Number(c.distance_meters || 0),
        });
      }
    }
  }

  return {
    isLinked: Boolean(targetBudget && targetBudget.healthBand !== 'UNLINKED'),
    targetNode,
    budget: targetBudget,
    hops,
    downstreamBranches,
  };
}

export interface CableSplitPlan {
  splitPoint: GisLatLng;
  spanARoute: GisLatLng[];
  spanADistanceMeters: number;
  spanBRoute: GisLatLng[];
  spanBDistanceMeters: number;
  preservedCores: GisCoreEntry[];
  defaultSpliceTray: GisSpliceEntry[];
}

function pointToSegmentDistanceSq(p: GisLatLng, a: GisLatLng, b: GisLatLng): number {
  const dx = b.lng - a.lng;
  const dy = b.lat - a.lat;
  if (dx === 0 && dy === 0) {
    return (p.lng - a.lng) ** 2 + (p.lat - a.lat) ** 2;
  }
  const t = Math.max(0, Math.min(1, ((p.lng - a.lng) * dx + (p.lat - a.lat) * dy) / (dx * dx + dy * dy)));
  const projLng = a.lng + t * dx;
  const projLat = a.lat + t * dy;
  return (p.lng - projLng) ** 2 + (p.lat - projLat) ** 2;
}

export function getCableMidpoint(route: GisLatLng[]): GisLatLng {
  if (!route || route.length === 0) return { lat: 31.5204, lng: 74.3587 };
  if (route.length === 1) return route[0];
  const total = computePolylineDistanceMeters(route);
  if (total === 0) {
    return {
      lat: (route[0].lat + route[route.length - 1].lat) / 2,
      lng: (route[0].lng + route[route.length - 1].lng) / 2,
    };
  }
  const half = total / 2;
  let acc = 0;
  for (let i = 1; i < route.length; i++) {
    const seg = haversineMeters(route[i - 1], route[i]);
    if (acc + seg >= half && seg > 0) {
      const ratio = (half - acc) / seg;
      return {
        lat: route[i - 1].lat + (route[i].lat - route[i - 1].lat) * ratio,
        lng: route[i - 1].lng + (route[i].lng - route[i - 1].lng) * ratio,
      };
    }
    acc += seg;
  }
  return route[Math.floor(route.length / 2)];
}

/**
 * Splits a cable polyline into Span A and Span B at a given cut coordinate
 * while preserving every TIA-598 core status & destination note into both spans
 * and generating the FOSC Joint Closure straight-through splice tray mapping.
 */
export function buildCableSplitPlan(
  cable: SupabaseGisCable,
  sourceNode: SupabaseGisNode | undefined,
  targetNode: SupabaseGisNode | undefined,
  customSplitPoint?: GisLatLng
): CableSplitPlan {
  const fallbackRoute: GisLatLng[] = [];
  if (sourceNode) fallbackRoute.push({ lat: sourceNode.lat, lng: sourceNode.lng });
  if (targetNode) fallbackRoute.push({ lat: targetNode.lat, lng: targetNode.lng });

  const route =
    Array.isArray(cable.route_coordinates_json) && cable.route_coordinates_json.length >= 2
      ? cable.route_coordinates_json
      : fallbackRoute;

  const splitPoint = customSplitPoint || getCableMidpoint(route);

  let bestSegIdx = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < route.length - 1; i++) {
    const d = pointToSegmentDistanceSq(splitPoint, route[i], route[i + 1]);
    if (d < bestDist) {
      bestDist = d;
      bestSegIdx = i;
    }
  }

  const spanARoute = [...route.slice(0, bestSegIdx + 1), splitPoint];
  const spanBRoute = [splitPoint, ...route.slice(bestSegIdx + 1)];

  const preservedCores = normalizeCableCores(
    cable.cable_cores,
    cable.cores_allocation_json?.length ? cable.cores_allocation_json : cable.cores_tia598_json
  );
  const defaultSpliceTray: GisSpliceEntry[] = preservedCores.map((c) => ({
    coreIn: c.coreNumber,
    coreOut: c.coreNumber,
    status: c.status === 'Dead / High Loss' ? 'Cut / Dead' : 'Straight Splice',
    note: c.forwarded_to_area || c.destinationNote || '',
  }));

  return {
    splitPoint,
    spanARoute,
    spanADistanceMeters: Math.max(1, computePolylineDistanceMeters(spanARoute)),
    spanBRoute,
    spanBDistanceMeters: Math.max(1, computePolylineDistanceMeters(spanBRoute)),
    preservedCores,
    defaultSpliceTray,
  };
}

export function getHealthBadgeColors(band: OpticalHealthBand): {
  bgClass: string;
  textClass: string;
  borderClass: string;
  hex: string;
} {
  switch (band) {
    case 'IDEAL':
      return {
        bgClass: 'bg-emerald-950/80',
        textClass: 'text-emerald-300',
        borderClass: 'border-emerald-700/70',
        hex: '#10b981',
      };
    case 'GOOD':
      return {
        bgClass: 'bg-cyan-950/80',
        textClass: 'text-cyan-300',
        borderClass: 'border-cyan-700/70',
        hex: '#06b6d4',
      };
    case 'MARGINAL':
      return {
        bgClass: 'bg-amber-950/80',
        textClass: 'text-amber-300',
        borderClass: 'border-amber-700/70',
        hex: '#f59e0b',
      };
    case 'CRITICAL LOS RISK':
      return {
        bgClass: 'bg-rose-950/85',
        textClass: 'text-rose-300',
        borderClass: 'border-rose-700/80',
        hex: '#f43f5e',
      };
    default:
      return {
        bgClass: 'bg-slate-800/80',
        textClass: 'text-slate-300',
        borderClass: 'border-slate-700',
        hex: '#64748b',
      };
  }
}

export function getNodeTypeLabel(type: GisNodeType): string {
  switch (type) {
    case 'OLT':
      return 'OLT Hub';
    case 'DIST_NODE':
      return 'Distribution Node';
    case 'FOSC_JOINT':
      return 'FOSC Joint Box';
    case 'FDB_FAT':
      return 'FAT / FDB Splitter';
  }
}

// ============================================================================
// MULTI-CORE CABLE REUSE & PARALLEL TRUNK GROUPING UTILITIES
// ============================================================================

export function getCablePairKey(nodeAId: string, nodeBId: string): string {
  return nodeAId < nodeBId ? `${nodeAId}::${nodeBId}` : `${nodeBId}::${nodeAId}`;
}

export function isCoreLockedOrUsed(core: GisCoreEntry | undefined): boolean {
  if (!core) return false;
  const ledger = coreStatusToLedgerStatus(core.status, core.core_status);
  if (ledger === 'ACTIVE' || ledger === 'RESERVED' || ledger === 'FAULTY') {
    return true;
  }
  const usage = core.usage_type || coreStatusToUsageType(core.status);
  return usage !== 'FREE_SPARE';
}

export function findExistingCablesBetweenNodes(
  cables: SupabaseGisCable[],
  nodeAId: string,
  nodeBId: string
): SupabaseGisCable[] {
  if (!nodeAId || !nodeBId || nodeAId === nodeBId) return [];
  const targetKey = getCablePairKey(nodeAId, nodeBId);
  return cables
    .filter((c) => getCablePairKey(c.source_node_id, c.target_node_id) === targetKey)
    .sort((a, b) => Number(b.cable_cores || 0) - Number(a.cable_cores || 0));
}

export function findExistingCableBetweenNodes(
  cables: SupabaseGisCable[],
  nodeAId: string,
  nodeBId: string
): SupabaseGisCable | null {
  const matches = findExistingCablesBetweenNodes(cables, nodeAId, nodeBId);
  return matches.length > 0 ? matches[0] : null;
}

export function findNextFreeCoreOnCable(
  cable: SupabaseGisCable,
  preferredCore?: number
): number | null {
  const total = Math.max(1, Number(cable.cable_cores || 12));
  const raw =
    Array.isArray(cable.cores_allocation_json) && cable.cores_allocation_json.length > 0
      ? cable.cores_allocation_json
      : cable.cores_tia598_json;
  const normalized = normalizeCableCores(total, raw);
  const byNum: Record<number, GisCoreEntry> = {};
  for (const c of normalized) byNum[c.coreNumber] = c;

  if (
    preferredCore &&
    preferredCore >= 1 &&
    preferredCore <= total &&
    !isCoreLockedOrUsed(byNum[preferredCore])
  ) {
    return preferredCore;
  }
  for (let i = 1; i <= total; i++) {
    if (!isCoreLockedOrUsed(byNum[i])) return i;
  }
  return null;
}

export function allocateCoreOnCable(params: {
  cable: SupabaseGisCable;
  coreNumber: number;
  originOltId?: string | null;
  originPonPortId?: string | null;
  originLabel?: string;
  destinationTarget?: string;
  opticalPowerDbm?: number | null;
  coreStatus?: GisCoreLedgerStatus;
  usageType?: GisCoreUsageType;
  remarks?: string;
}): GisCoreEntry[] {
  const total = Math.max(1, Number(params.cable.cable_cores || 12));
  const raw =
    Array.isArray(params.cable.cores_allocation_json) && params.cable.cores_allocation_json.length > 0
      ? params.cable.cores_allocation_json
      : params.cable.cores_tia598_json;
  const normalized = normalizeCableCores(total, raw);
  const nextLedger: GisCoreLedgerStatus = params.coreStatus || 'ACTIVE';
  const nextUsage: GisCoreUsageType =
    params.usageType || (nextLedger === 'RESERVED' ? 'PASS_THROUGH_AREA' : 'SPLITTER_FEED');
  const nextStatus: GisCoreStatus = usageTypeToCoreStatus(nextUsage);
  const cleanOrigin = (params.originLabel || '').trim();
  const cleanDest = (params.destinationTarget || '').trim();

  return normalized.map((c) => {
    if (c.coreNumber !== params.coreNumber) return c;
    return {
      ...c,
      core_status: nextLedger,
      status: nextStatus,
      usage_type: nextUsage,
      origin_olt_id: params.originOltId ?? c.origin_olt_id ?? null,
      origin_pon_port_id: params.originPonPortId ?? c.origin_pon_port_id ?? null,
      origin_olt_label: cleanOrigin || c.origin_olt_label || '',
      source_signal: cleanOrigin || c.source_signal || '',
      forwarded_to_area: cleanDest || c.forwarded_to_area || '',
      destination_target: cleanDest || c.destination_target || '',
      destinationNote: cleanDest || c.destinationNote || '',
      optical_power_dbm:
        params.opticalPowerDbm !== null &&
        params.opticalPowerDbm !== undefined &&
        !Number.isNaN(Number(params.opticalPowerDbm))
          ? Number(params.opticalPowerDbm).toFixed(2)
          : c.optical_power_dbm || '',
      remarks: params.remarks !== undefined ? params.remarks : c.remarks || '',
    };
  });
}

export interface ParallelCableGroup {
  pairKey: string;
  primaryCable: SupabaseGisCable;
  cables: SupabaseGisCable[];
  duplicateCount: number;
  totalCores: number;
  usedCores: number;
  reservedCores: number;
  spareCores: number;
}

export function groupParallelCablesByPair(cables: SupabaseGisCable[]): ParallelCableGroup[] {
  const buckets: Record<string, SupabaseGisCable[]> = {};
  for (const c of cables) {
    const key = getCablePairKey(c.source_node_id, c.target_node_id);
    if (!buckets[key]) buckets[key] = [];
    buckets[key].push(c);
  }

  const groups: ParallelCableGroup[] = [];
  for (const [pairKey, list] of Object.entries(buckets)) {
    const sorted = list
      .slice()
      .sort((a, b) => Number(b.cable_cores || 0) - Number(a.cable_cores || 0));
    const primaryCable = sorted[0];
    let totalCores = 0;
    let usedCores = 0;
    let reservedCores = 0;
    let spareCores = 0;
    for (const c of sorted) {
      const s = summarizeCableCores(
        c.cores_allocation_json?.length ? c.cores_allocation_json : c.cores_tia598_json,
        c.cable_cores
      );
      totalCores += s.total;
      usedCores += s.litCount;
      reservedCores += s.reservedCount;
      spareCores += s.spareCount;
    }
    groups.push({
      pairKey,
      primaryCable,
      cables: sorted,
      duplicateCount: Math.max(0, sorted.length - 1),
      totalCores,
      usedCores,
      reservedCores,
      spareCores,
    });
  }
  return groups;
}


