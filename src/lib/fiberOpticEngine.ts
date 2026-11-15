import type {
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
  OltPonMode,
  OltSfpClass,
  SupabaseGisCable,
  SupabaseGisNode,
  SupabaseGisOlt,
  SupabaseGisOltPonPort,
  SupabaseGisSplitterOutput,
} from '../services/supabaseClient';

export const FIBER_ATTENUATION_DB_PER_KM = 0.35;
export const DEFAULT_FUSION_SPLICE_LOSS_DB = 0.5;

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

export function generateDefaultSpliceTray(capacity: number): GisSpliceEntry[] {
  const count = Math.max(2, Math.min(48, Math.floor(capacity || 12)));
  const rows: GisSpliceEntry[] = [];
  for (let i = 1; i <= count; i++) {
    rows.push({
      coreIn: i,
      coreOut: i,
      status: 'Straight Splice',
      note: '',
    });
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
  for (const n of nodes) {
    nodeById[n.id] = n;
  }

  const adj: Record<string, Array<{ neighborId: string; cable: SupabaseGisCable }>> = {};
  for (const c of cables) {
    if (!adj[c.source_node_id]) adj[c.source_node_id] = [];
    if (!adj[c.target_node_id]) adj[c.target_node_id] = [];
    adj[c.source_node_id].push({ neighborId: c.target_node_id, cable: c });
    adj[c.target_node_id].push({ neighborId: c.source_node_id, cable: c });
  }

  const results: Record<string, NodeOpticalBudgetResult> = {};

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

  for (const n of nodes) {
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
        oltId: n.id,
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
        oltId: n.id,
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

  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const curNode = nodeById[cur.nodeId];
    if (!curNode) continue;

    // Determine exact calculated optical power leaving curNode along a downstream trunk fiber
    let outgoingTrunkDbm = cur.inputDbm;
    let addedThruLoss = 0;
    let addedSpliceCount = 0;
    let addedSpliceLoss = 0;
    let curLeaveStep: OpticalBudgetStep | null = null;

    if (curNode.node_type !== 'OLT') {
      const spec = SPLITTER_SPECS[curNode.splitter_type] || SPLITTER_SPECS['none'];
      const nodeSplice = resolveHopSpliceLoss(curNode.loss_per_splice);
      addedSpliceCount = 1;
      addedSpliceLoss = nodeSplice;
      if (spec.isAsymmetricFbt) {
        addedThruLoss = spec.thruLossDb;
        outgoingTrunkDbm -= spec.thruLossDb + nodeSplice;
        curLeaveStep = {
          id: `up-fbt-${curNode.id}`,
          kind: 'UPSTREAM_SPLITTER',
          label: `Upstream FBT (${curNode.name})`,
          detail: `${spec.type} Thru (-${spec.thruLossDb.toFixed(1)} dB) & Splice (-${nodeSplice.toFixed(2)} dB)`,
          deltaDb: round2(-(spec.thruLossDb + nodeSplice)),
          powerAfterDbm: round2(outgoingTrunkDbm),
        };
      } else if (spec.type !== 'none') {
        // Cascaded PLC Splitter: downstream nodes fed from curNode inherit curNode's splitter output power
        addedThruLoss = spec.dropLossDb;
        outgoingTrunkDbm -= spec.dropLossDb + nodeSplice;
        curLeaveStep = {
          id: `up-plc-${curNode.id}`,
          kind: 'UPSTREAM_SPLITTER',
          label: `Upstream Splitter (${curNode.name})`,
          detail: `${spec.type} PLC (-${spec.dropLossDb.toFixed(1)} dB) & Splice (-${nodeSplice.toFixed(2)} dB)`,
          deltaDb: round2(-(spec.dropLossDb + nodeSplice)),
          powerAfterDbm: round2(outgoingTrunkDbm),
        };
      } else {
        // Pure straight pass-through splice (e.g., FOSC Joint Closure with no splitter)
        outgoingTrunkDbm -= nodeSplice;
        curLeaveStep = {
          id: `up-joint-${curNode.id}`,
          kind: 'UPSTREAM_JOINT',
          label: `Upstream Splice (${curNode.name})`,
          detail: `Straight Fusion Splice (-${nodeSplice.toFixed(2)} dB)`,
          deltaDb: round2(-nodeSplice),
          powerAfterDbm: round2(outgoingTrunkDbm),
        };
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

      let effectiveOutgoingDbm = outgoingTrunkDbm;
      let branchOltTxDbm = cur.oltTxDbm;
      let branchPonPortId = cur.sourcePonPortId;
      let branchPonLabel = cur.sourcePonLabel;
      let branchSteps = cur.upstreamSteps.slice();

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
          effectiveOutgoingDbm = branchOltTxDbm;
          branchPonPortId = ponPort.id;
          branchPonLabel = ponPort.port_label
            ? `PON-${ponPort.port_number} (${ponPort.port_label})`
            : `PON-${ponPort.port_number}`;
        }
        branchSteps = [
          {
            id: `olt-${curNode.id}-${cable.id}`,
            kind: 'OLT_SOURCE',
            label: 'OLT Source',
            detail: `${curNode.name}${branchPonLabel ? ` · ${branchPonLabel}` : ''}`,
            deltaDb: null,
            powerAfterDbm: round2(branchOltTxDbm),
          },
        ];
      } else if (curLeaveStep) {
        branchSteps.push(curLeaveStep);
      }

      const arrivalDbm = effectiveOutgoingDbm - spanFiberLoss;

      const prevBest = bestInputByNode[neighborId];
      const isForcedFeed = targetNode.feed_cable_id === cable.id;
      if (prevBest !== undefined) {
        if (isForcedFeed) {
          if (Math.abs(arrivalDbm - prevBest) <= 0.001) continue;
        } else if (arrivalDbm <= prevBest + 0.001) {
          continue;
        }
      }
      if (cur.hopCount >= 24) continue;

      bestInputByNode[neighborId] = arrivalDbm;

      const totalDist = cur.totalDistanceMeters + spanMeters;
      const totalFiberLoss = cur.fiberLossDb + spanFiberLoss;
      const totalSpliceCount = cur.spliceCount + addedSpliceCount;
      const totalSpliceLoss = cur.spliceLossDb + addedSpliceLoss;
      const totalThruLoss = cur.upstreamThruLossDb + addedThruLoss;

      const splitterSpec = SPLITTER_SPECS[targetNode.splitter_type] || SPLITTER_SPECS['none'];
      const targetSpliceDb = resolveHopSpliceLoss(targetNode.loss_per_splice);
      const hasSplitter = splitterSpec.type !== 'none';
      const ontRx = hasSplitter
        ? arrivalDbm - splitterSpec.dropLossDb - targetSpliceDb
        : arrivalDbm - targetSpliceDb;
      const thruOut = splitterSpec.isAsymmetricFbt
        ? arrivalDbm - splitterSpec.thruLossDb - targetSpliceDb
        : hasSplitter
        ? arrivalDbm - splitterSpec.dropLossDb - targetSpliceDb
        : arrivalDbm - targetSpliceDb;

      const feedAndSpliceDelta = -(spanFiberLoss + targetSpliceDb);
      const afterFeedAndSplice = arrivalDbm - targetSpliceDb;
      const targetSteps: OpticalBudgetStep[] = [
        ...branchSteps,
        {
          id: `feed-${cable.id}-${neighborId}`,
          kind: 'FEED_SPLICE',
          label: 'Feed Cable & Splice',
          detail: `${cable.cable_cores}C ${Math.round(spanMeters)}m (-${spanFiberLoss.toFixed(2)} dB) + Splice (-${targetSpliceDb.toFixed(2)} dB)`,
          deltaDb: round2(feedAndSpliceDelta),
          powerAfterDbm: round2(afterFeedAndSplice),
        },
        hasSplitter
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
            },
      ];

      // Steps recorded onto traversal state if neighborId itself feeds a further downstream node
      const nextUpstreamSteps: OpticalBudgetStep[] = [
        ...branchSteps,
        {
          id: `cable-${cable.id}-${neighborId}`,
          kind: 'CABLE',
          label: `Cable to ${targetNode.name}`,
          detail: `${cable.cable_cores}C · ${Math.round(spanMeters)}m @ 0.35 dB/km`,
          deltaDb: round2(-spanFiberLoss),
          powerAfterDbm: round2(arrivalDbm),
        },
      ];

      results[neighborId] = {
        nodeId: neighborId,
        oltId: cur.oltId,
        oltName: cur.oltName,
        sourcePonPortId: branchPonPortId,
        sourcePonLabel: branchPonLabel,
        oltTxDbm: round2(branchOltTxDbm),
        parentOutputDbm: curNode.node_type === 'OLT' ? null : round2(effectiveOutgoingDbm),
        inputDbm: round2(arrivalDbm),
        thruOutputDbm: round2(thruOut),
        ontRxDbm: round2(ontRx),
        totalDistanceMeters: Math.round(totalDist),
        fiberLossDb: round2(totalFiberLoss),
        spliceCount: totalSpliceCount + 1,
        spliceLossDb: round2(totalSpliceLoss + targetSpliceDb),
        upstreamThruLossDb: round2(totalThruLoss),
        splitterLossDb: round2(splitterSpec.dropLossDb),
        localFiberLossDb: round2(spanFiberLoss),
        localSpliceLossDb: round2(targetSpliceDb),
        healthBand: classifyOpticalHealth(ontRx),
        incomingCableId: cable.id,
        incomingCoreNumber: targetNode.feed_core_number ?? 1,
        parentNodeId: cur.nodeId,
        hopCount: cur.hopCount + 1,
        budgetSteps: targetSteps,
      };

      queue.push({
        nodeId: neighborId,
        oltId: cur.oltId,
        oltName: cur.oltName,
        sourcePonPortId: branchPonPortId,
        sourcePonLabel: branchPonLabel,
        oltTxDbm: branchOltTxDbm,
        inputDbm: arrivalDbm,
        totalDistanceMeters: totalDist,
        fiberLossDb: totalFiberLoss,
        spliceCount: totalSpliceCount,
        spliceLossDb: totalSpliceLoss,
        upstreamThruLossDb: totalThruLoss,
        incomingCableId: cable.id,
        incomingCoreNumber: targetNode.feed_core_number ?? 1,
        hopCount: cur.hopCount + 1,
        pathNodeIds: [...cur.pathNodeIds, neighborId],
        upstreamSteps: nextUpstreamSteps,
      });
    }
  }

  for (const n of nodes) {
    if (!results[n.id]) {
      const spec = SPLITTER_SPECS[n.splitter_type] || SPLITTER_SPECS['none'];
      results[n.id] = {
        nodeId: n.id,
        oltId: null,
        oltName: null,
        sourcePonPortId: null,
        sourcePonLabel: null,
        oltTxDbm: null,
        parentOutputDbm: null,
        inputDbm: null,
        thruOutputDbm: null,
        ontRxDbm: null,
        totalDistanceMeters: 0,
        fiberLossDb: 0,
        spliceCount: 0,
        spliceLossDb: 0,
        upstreamThruLossDb: 0,
        splitterLossDb: spec.dropLossDb,
        localFiberLossDb: 0,
        localSpliceLossDb: 0,
        healthBand: 'UNLINKED',
        incomingCableId: n.feed_cable_id || null,
        incomingCoreNumber: n.feed_core_number || null,
        parentNodeId: null,
        hopCount: 0,
        budgetSteps: [],
      };
    }
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
      const estRx =
        out.estimated_rx_dbm !== null && out.estimated_rx_dbm !== undefined
          ? Number(out.estimated_rx_dbm)
          : isThroughLeg
          ? targetBudget.thruOutputDbm
          : targetBudget.ontRxDbm;

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

