import type {
  GisCoreEntry,
  GisCoreStatus,
  GisLatLng,
  GisNodeType,
  GisSpliceEntry,
  GisSplitterType,
  SupabaseGisCable,
  SupabaseGisNode,
} from '../services/supabaseClient';

export const FIBER_ATTENUATION_DB_PER_KM = 0.35;
export const DEFAULT_FUSION_SPLICE_LOSS_DB = 0.08;

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
  label: string;
  dropLossDb: number;
  thruLossDb: number;
  defaultPorts: number;
  isAsymmetricFbt: boolean;
}

export const SPLITTER_SPECS: Record<GisSplitterType, SplitterSpec> = {
  none: { type: 'none', label: 'No Splitter (Through)', dropLossDb: 0, thruLossDb: 0, defaultPorts: 0, isAsymmetricFbt: false },
  '1:2': { type: '1:2', label: '1:2 PLC (-3.6 dB)', dropLossDb: 3.6, thruLossDb: 3.6, defaultPorts: 2, isAsymmetricFbt: false },
  '1:4': { type: '1:4', label: '1:4 PLC (-7.2 dB)', dropLossDb: 7.2, thruLossDb: 7.2, defaultPorts: 4, isAsymmetricFbt: false },
  '1:8': { type: '1:8', label: '1:8 PLC (-10.5 dB)', dropLossDb: 10.5, thruLossDb: 10.5, defaultPorts: 8, isAsymmetricFbt: false },
  '1:16': { type: '1:16', label: '1:16 PLC (-13.8 dB)', dropLossDb: 13.8, thruLossDb: 13.8, defaultPorts: 16, isAsymmetricFbt: false },
  '1:32': { type: '1:32', label: '1:32 PLC (-17.2 dB)', dropLossDb: 17.2, thruLossDb: 17.2, defaultPorts: 32, isAsymmetricFbt: false },
  '90:10': { type: '90:10', label: '90:10 FBT (Drop -10.5 / Thru -0.8 dB)', dropLossDb: 10.5, thruLossDb: 0.8, defaultPorts: 8, isAsymmetricFbt: true },
  '80:20': { type: '80:20', label: '80:20 FBT (Drop -7.5 / Thru -1.2 dB)', dropLossDb: 7.5, thruLossDb: 1.2, defaultPorts: 8, isAsymmetricFbt: true },
  '70:30': { type: '70:30', label: '70:30 FBT (Drop -5.7 / Thru -1.8 dB)', dropLossDb: 5.7, thruLossDb: 1.8, defaultPorts: 8, isAsymmetricFbt: true },
};

export function getTia598Color(oneBasedCoreNumber: number): Tia598ColorSpec {
  const normalized = Math.max(1, Math.floor(oneBasedCoreNumber));
  const idx = (normalized - 1) % 12;
  return TIA_598_COLORS[idx];
}

export function generateTia598Cores(cableCores: number): GisCoreEntry[] {
  const total = Math.max(2, Math.min(48, Math.floor(cableCores || 12)));
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
    return {
      ...b,
      status: (prev.status as GisCoreStatus) || b.status,
      destinationNote: prev.destinationNote || '',
      assignedNodeId: prev.assignedNodeId,
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

export interface NodeOpticalBudgetResult {
  nodeId: string;
  oltId: string | null;
  oltName: string | null;
  oltTxDbm: number | null;
  inputDbm: number | null;
  ontRxDbm: number | null;
  totalDistanceMeters: number;
  fiberLossDb: number;
  spliceCount: number;
  spliceLossDb: number;
  upstreamThruLossDb: number;
  splitterLossDb: number;
  healthBand: OpticalHealthBand;
  incomingCableId: string | null;
  incomingCoreNumber: number | null;
  hopCount: number;
}

export function classifyOpticalHealth(ontRxDbm: number | null): OpticalHealthBand {
  if (ontRxDbm === null || Number.isNaN(ontRxDbm)) return 'UNLINKED';
  if (ontRxDbm >= -22.0) return 'IDEAL';
  if (ontRxDbm >= -25.0) return 'GOOD';
  if (ontRxDbm >= -27.0) return 'MARGINAL';
  return 'CRITICAL LOS RISK';
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Traverses OLT -> Cable -> FOSC_JOINT / FDB_FAT graph and computes exact
 * optical signal budget for every node. Avoids native ES6 Map to keep React
 * map components safe from global Map constructor collisions.
 */
export function calculateTopologyOpticalBudgets(
  nodes: SupabaseGisNode[],
  cables: SupabaseGisCable[]
): Record<string, NodeOpticalBudgetResult> {
  const nodeById: Record<string, SupabaseGisNode> = {};
  for (const n of nodes) {
    nodeById[n.id] = n;
  }

  const cableById: Record<string, SupabaseGisCable> = {};
  const adj: Record<string, Array<{ neighborId: string; cable: SupabaseGisCable }>> = {};
  for (const c of cables) {
    cableById[c.id] = c;
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
  }

  const queue: TraversalState[] = [];
  const bestInputByNode: Record<string, number> = {};

  for (const n of nodes) {
    if (n.node_type === 'OLT') {
      const tx = Number(n.tx_power_dbm ?? 5.0);
      bestInputByNode[n.id] = tx;
      results[n.id] = {
        nodeId: n.id,
        oltId: n.id,
        oltName: n.name,
        oltTxDbm: round2(tx),
        inputDbm: round2(tx),
        ontRxDbm: round2(tx),
        totalDistanceMeters: 0,
        fiberLossDb: 0,
        spliceCount: 0,
        spliceLossDb: 0,
        upstreamThruLossDb: 0,
        splitterLossDb: 0,
        healthBand: 'IDEAL',
        incomingCableId: null,
        incomingCoreNumber: null,
        hopCount: 0,
      };
      queue.push({
        nodeId: n.id,
        oltId: n.id,
        oltName: n.name,
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
      });
    }
  }

  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const curNode = nodeById[cur.nodeId];
    if (!curNode) continue;

    // Determine power leaving curNode along a downstream trunk fiber
    let outgoingTrunkDbm = cur.inputDbm;
    let addedThruLoss = 0;
    let addedSpliceCount = 0;
    let addedSpliceLoss = 0;

    if (curNode.node_type === 'FOSC_JOINT') {
      const jointSpliceLoss = Number(curNode.loss_per_splice ?? DEFAULT_FUSION_SPLICE_LOSS_DB);
      addedSpliceCount = 1;
      addedSpliceLoss = jointSpliceLoss;
      outgoingTrunkDbm -= jointSpliceLoss;
    } else if (curNode.node_type === 'FDB_FAT') {
      const spec = SPLITTER_SPECS[curNode.splitter_type] || SPLITTER_SPECS['1:8'];
      if (spec.isAsymmetricFbt) {
        // Downstream trunk uses the FBT thru leg + 1 fusion splice
        const nodeSplice = Number(curNode.loss_per_splice ?? DEFAULT_FUSION_SPLICE_LOSS_DB);
        addedThruLoss = spec.thruLossDb;
        addedSpliceCount = 1;
        addedSpliceLoss = nodeSplice;
        outgoingTrunkDbm -= spec.thruLossDb + nodeSplice;
      } else {
        // Standard FDB also introduces a fusion splice if passing spare dark core downstream
        const nodeSplice = Number(curNode.loss_per_splice ?? DEFAULT_FUSION_SPLICE_LOSS_DB);
        addedSpliceCount = 1;
        addedSpliceLoss = nodeSplice;
        outgoingTrunkDbm -= nodeSplice;
      }
    }

    const neighbors = adj[cur.nodeId] || [];
    for (const { neighborId, cable } of neighbors) {
      const targetNode = nodeById[neighborId];
      if (!targetNode || targetNode.node_type === 'OLT') continue;

      // If targetNode pins a specific feed_cable_id, honor that link priority
      if (targetNode.feed_cable_id && targetNode.feed_cable_id !== cable.id) {
        continue;
      }

      const spanMeters =
        Number(cable.distance_meters) > 0
          ? Number(cable.distance_meters)
          : computePolylineDistanceMeters(cable.route_coordinates_json || []);
      const spanFiberLoss = (spanMeters / 1000) * FIBER_ATTENUATION_DB_PER_KM;
      const arrivalDbm = outgoingTrunkDbm - spanFiberLoss;

      // Avoid infinite loops by only accepting strictly better signal paths (with epsilon) or explicit feed cable
      const prevBest = bestInputByNode[neighborId];
      const isForcedFeed = targetNode.feed_cable_id === cable.id;
      if (prevBest !== undefined && !isForcedFeed && arrivalDbm <= prevBest + 0.001) {
        continue;
      }
      if (cur.hopCount >= 24) continue;

      bestInputByNode[neighborId] = arrivalDbm;

      const totalDist = cur.totalDistanceMeters + spanMeters;
      const totalFiberLoss = cur.fiberLossDb + spanFiberLoss;
      const totalSpliceCount = cur.spliceCount + addedSpliceCount;
      const totalSpliceLoss = cur.spliceLossDb + addedSpliceLoss;
      const totalThruLoss = cur.upstreamThruLossDb + addedThruLoss;

      const splitterSpec =
        targetNode.node_type === 'FDB_FAT'
          ? SPLITTER_SPECS[targetNode.splitter_type] || SPLITTER_SPECS['1:8']
          : SPLITTER_SPECS['none'];
      const targetSpliceDb =
        targetNode.node_type === 'FOSC_JOINT'
          ? Number(targetNode.loss_per_splice ?? DEFAULT_FUSION_SPLICE_LOSS_DB)
          : Number(targetNode.loss_per_splice ?? DEFAULT_FUSION_SPLICE_LOSS_DB);
      const ontRx =
        targetNode.node_type === 'FDB_FAT'
          ? arrivalDbm - splitterSpec.dropLossDb - targetSpliceDb
          : arrivalDbm - targetSpliceDb;

      results[neighborId] = {
        nodeId: neighborId,
        oltId: cur.oltId,
        oltName: cur.oltName,
        oltTxDbm: round2(cur.oltTxDbm),
        inputDbm: round2(arrivalDbm),
        ontRxDbm: round2(ontRx),
        totalDistanceMeters: Math.round(totalDist),
        fiberLossDb: round2(totalFiberLoss),
        spliceCount: totalSpliceCount + 1,
        spliceLossDb: round2(totalSpliceLoss + targetSpliceDb),
        upstreamThruLossDb: round2(totalThruLoss),
        splitterLossDb: round2(splitterSpec.dropLossDb),
        healthBand: classifyOpticalHealth(ontRx),
        incomingCableId: cable.id,
        incomingCoreNumber: targetNode.feed_core_number ?? 1,
        hopCount: cur.hopCount + 1,
      };

      queue.push({
        nodeId: neighborId,
        oltId: cur.oltId,
        oltName: cur.oltName,
        oltTxDbm: cur.oltTxDbm,
        inputDbm: arrivalDbm,
        totalDistanceMeters: totalDist,
        fiberLossDb: totalFiberLoss,
        spliceCount: totalSpliceCount,
        spliceLossDb: totalSpliceLoss,
        upstreamThruLossDb: totalThruLoss,
        incomingCableId: cable.id,
        incomingCoreNumber: targetNode.feed_core_number ?? 1,
        hopCount: cur.hopCount + 1,
      });
    }
  }

  // Fill unlinked non-OLT nodes with local estimate markers
  for (const n of nodes) {
    if (!results[n.id]) {
      const spec = SPLITTER_SPECS[n.splitter_type] || SPLITTER_SPECS['none'];
      results[n.id] = {
        nodeId: n.id,
        oltId: null,
        oltName: null,
        oltTxDbm: null,
        inputDbm: null,
        ontRxDbm: null,
        totalDistanceMeters: 0,
        fiberLossDb: 0,
        spliceCount: 0,
        spliceLossDb: 0,
        upstreamThruLossDb: 0,
        splitterLossDb: spec.dropLossDb,
        healthBand: 'UNLINKED',
        incomingCableId: n.feed_cable_id || null,
        incomingCoreNumber: n.feed_core_number || null,
        hopCount: 0,
      };
    }
  }

  return results;
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

  const preservedCores = normalizeCableCores(cable.cable_cores, cable.cores_tia598_json);
  const defaultSpliceTray: GisSpliceEntry[] = preservedCores.map((c) => ({
    coreIn: c.coreNumber,
    coreOut: c.coreNumber,
    status: c.status === 'Dead / High Loss' ? 'Cut / Dead' : 'Straight Splice',
    note: c.destinationNote || '',
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
    case 'FOSC_JOINT':
      return 'FOSC Joint Box';
    case 'FDB_FAT':
      return 'FDB / FAT Splitter';
  }
}
