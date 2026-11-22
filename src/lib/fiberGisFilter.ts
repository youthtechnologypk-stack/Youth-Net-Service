import type {
  GisLatLng,
  SupabaseGisCable,
  SupabaseGisFdbPort,
  SupabaseGisNode,
  SupabaseGisOlt,
  SupabaseGisOltPonPort,
  SupabaseGisSplitterOutput,
} from '../services/supabaseClient';
import type { GisSubscriberSummary } from '../services/fiberGisService';
import type { NodeOpticalBudgetResult } from './fiberOpticEngine';

export interface GisHighlightFilterInput {
  filterOltId: string;
  filterPonPortId: string;
  filterAreaName: string;
  oltsById: Record<string, SupabaseGisOlt>;
  ponPortsById: Record<string, SupabaseGisOltPonPort>;
  nodes: SupabaseGisNode[];
  cables: SupabaseGisCable[];
  portsByNodeId: Record<string, SupabaseGisFdbPort[]>;
  splitterOutputsByNodeId: Record<string, SupabaseGisSplitterOutput[]>;
  budgetsByNodeId: Record<string, NodeOpticalBudgetResult>;
  subscribers: GisSubscriberSummary[];
}

export interface AreaIsolationSummary {
  areaName: string;
  distBoxCount: number;
  subDistNames: string[];
  fdbCount: number;
  totalPorts: number;
  usedPorts: number;
  freePorts: number;
  onlineOnts: number;
  offlineOnts: number;
  feederDbm: number | null;
  feederLabel: string;
}

export interface AreaQuickChip {
  areaName: string;
  nodeCount: number;
  fdbCount: number;
  distCount: number;
}

export interface GisHighlightFilterResult {
  isFilterActive: boolean;
  highlightedNodeIds: Record<string, boolean>;
  highlightedCableIds: Record<string, boolean>;
  cableCount: number;
  foscCount: number;
  fatCount: number;
  activeClientCount: number;
  summaryLabel: string;
  fitBoundsCoords: [number, number][];
  areaSummary: AreaIsolationSummary | null;
}

export function collectSortedAreaOptions(params: {
  nodes: SupabaseGisNode[];
  olts: SupabaseGisOlt[];
  subscribers: GisSubscriberSummary[];
  splitterOutputs: SupabaseGisSplitterOutput[];
  areaZones?: Array<{ name: string }>;
}): string[] {
  const seen: Record<string, string> = {};

  const register = (raw?: string | null) => {
    const clean = (raw || '').trim();
    if (!clean) return;
    const key = clean.toLowerCase();
    if (!seen[key]) {
      seen[key] = clean;
    }
  };

  for (const n of params.nodes) register(n.area_name);
  for (const o of params.olts) register(o.area_name);
  for (const z of params.areaZones || []) register(z.name);
  for (const s of params.subscribers) register(s.area);
  for (const out of params.splitterOutputs) {
    if (out.utilization_type === 'DOWNSTREAM_AREA_FEED') {
      register(out.target_area_or_node);
    }
  }

  return Object.values(seen).sort((a, b) => a.localeCompare(b));
}

export function computeAreaQuickChips(params: {
  nodes: SupabaseGisNode[];
  areaZones?: Array<{ name: string }>;
  subscribers?: GisSubscriberSummary[];
}): AreaQuickChip[] {
  const buckets: Record<string, AreaQuickChip> = {};
  const ensure = (raw?: string | null): AreaQuickChip | null => {
    const clean = (raw || '').trim();
    if (!clean) return null;
    const key = clean.toLowerCase();
    if (!buckets[key]) {
      buckets[key] = { areaName: clean, nodeCount: 0, fdbCount: 0, distCount: 0 };
    }
    return buckets[key];
  };

  for (const n of params.nodes) {
    const b = ensure(n.area_name);
    if (!b) continue;
    b.nodeCount++;
    if (n.node_type === 'FDB_FAT') b.fdbCount++;
    if (n.node_type === 'DIST_NODE' || n.node_type === 'FOSC_JOINT') b.distCount++;
  }
  for (const z of params.areaZones || []) {
    ensure(z.name);
  }

  return Object.values(buckets)
    .filter((chip) => chip.nodeCount > 0 || (params.areaZones || []).some((z) => z.name.trim().toLowerCase() === chip.areaName.toLowerCase()))
    .sort((a, b) => {
      if (b.nodeCount !== a.nodeCount) return b.nodeCount - a.nodeCount;
      return a.areaName.localeCompare(b.areaName);
    });
}

export function computeGisHighlightFilter(
  input: GisHighlightFilterInput
): GisHighlightFilterResult {
  const {
    filterOltId,
    filterPonPortId,
    filterAreaName,
    oltsById,
    ponPortsById,
    nodes,
    cables,
    portsByNodeId,
    splitterOutputsByNodeId,
    budgetsByNodeId,
    subscribers,
  } = input;

  const hasOlt = Boolean(filterOltId && filterOltId !== 'ALL');
  const hasPon = Boolean(filterPonPortId && filterPonPortId !== 'ALL');
  const hasArea = Boolean(filterAreaName && filterAreaName !== 'ALL');
  const isFilterActive = hasOlt || hasPon || hasArea;

  if (!isFilterActive) {
    return {
      isFilterActive: false,
      highlightedNodeIds: {},
      highlightedCableIds: {},
      cableCount: 0,
      foscCount: 0,
      fatCount: 0,
      activeClientCount: 0,
      summaryLabel: '',
      fitBoundsCoords: [],
      areaSummary: null,
    };
  }

  // Subscriber lookups
  const subAreaById: Record<string, string> = {};
  const subAreaByUser: Record<string, string> = {};
  const subById: Record<string, GisSubscriberSummary> = {};
  const subByUser: Record<string, GisSubscriberSummary> = {};
  for (const s of subscribers) {
    if (s.id) subById[s.id] = s;
    if (s.username) subByUser[s.username.trim().toLowerCase()] = s;
    const area = (s.area || '').trim().toLowerCase();
    if (!area) continue;
    if (s.id) subAreaById[s.id] = area;
    if (s.username) subAreaByUser[s.username.trim().toLowerCase()] = area;
  }

  const nodeById: Record<string, SupabaseGisNode> = {};
  for (const n of nodes) nodeById[n.id] = n;

  const cableById: Record<string, SupabaseGisCable> = {};
  for (const c of cables) {
    cableById[c.id] = c;
  }

  // Step 1: OLT & PON Port branch matching (including per-core multi-PON trunk metadata!)
  const oltPonNodeIds: Record<string, boolean> = {};
  const oltPonCableIds: Record<string, boolean> = {};

  if (hasOlt || hasPon) {
    const selectedPon = hasPon ? ponPortsById[filterPonPortId] : undefined;
    const effectiveOltId = selectedPon?.olt_id || (hasOlt ? filterOltId : '');

    for (const c of cables) {
      const targetBudget = budgetsByNodeId[c.target_node_id];
      const allocCores = c.cores_allocation_json || [];
      let matchesCable = false;

      if (hasPon) {
        matchesCable =
          c.source_pon_port_id === filterPonPortId ||
          targetBudget?.sourcePonPortId === filterPonPortId ||
          allocCores.some((core) => core.origin_pon_port_id === filterPonPortId) ||
          Object.values(targetBudget?.arrivalMetaByCoreKey || {}).some(
            (m) => m.ponPortId === filterPonPortId
          );
      } else if (effectiveOltId) {
        matchesCable =
          c.source_olt_id === effectiveOltId ||
          targetBudget?.oltId === effectiveOltId ||
          allocCores.some((core) => core.origin_olt_id === effectiveOltId) ||
          Object.values(targetBudget?.arrivalMetaByCoreKey || {}).some(
            (m) => m.oltId === effectiveOltId
          );
      }

      if (matchesCable) {
        oltPonCableIds[c.id] = true;
        oltPonNodeIds[c.source_node_id] = true;
        oltPonNodeIds[c.target_node_id] = true;
      }
    }

    for (const n of nodes) {
      const b = budgetsByNodeId[n.id];
      let matchesNode = false;
      if (hasPon) {
        matchesNode =
          n.pon_port_id === filterPonPortId ||
          b?.sourcePonPortId === filterPonPortId ||
          (n.core_splices || []).some((sp) => sp.source_pon_port_id === filterPonPortId) ||
          Object.values(b?.arrivalMetaByCoreKey || {}).some(
            (m) => m.ponPortId === filterPonPortId
          ) ||
          (n.node_type === 'OLT' && Boolean(effectiveOltId) && n.olt_id === effectiveOltId);
      } else if (effectiveOltId) {
        matchesNode =
          n.olt_id === effectiveOltId ||
          b?.oltId === effectiveOltId ||
          (n.core_splices || []).some((sp) => sp.source_olt_id === effectiveOltId) ||
          Object.values(b?.arrivalMetaByCoreKey || {}).some((m) => m.oltId === effectiveOltId);
      }
      if (matchesNode) {
        oltPonNodeIds[n.id] = true;
      }
    }
  } else {
    for (const n of nodes) oltPonNodeIds[n.id] = true;
    for (const c of cables) oltPonCableIds[c.id] = true;
  }

  // Step 2: Area / Mohallah filtering + upstream optical feeder & downstream sub-dist tracing
  const highlightedNodeIds: Record<string, boolean> = {};
  const highlightedCableIds: Record<string, boolean> = {};
  const areaLocalNodeIds: Record<string, boolean> = {};

  if (hasArea) {
    const targetAreaLower = filterAreaName.trim().toLowerCase();
    const seedNodeIds: string[] = [];

    for (const n of nodes) {
      if (!oltPonNodeIds[n.id]) continue;

      let matchesArea = (n.area_name || '').trim().toLowerCase() === targetAreaLower;

      if (!matchesArea) {
        const nodePorts = portsByNodeId[n.id] || [];
        for (const p of nodePorts) {
          if (p.status === 'FREE') continue;
          const pSubArea =
            (p.subscriber_id && subAreaById[p.subscriber_id]) ||
            (p.subscriber_username &&
              subAreaByUser[p.subscriber_username.trim().toLowerCase()]) ||
            '';
          if (pSubArea === targetAreaLower) {
            matchesArea = true;
            break;
          }
        }
      }

      if (!matchesArea) {
        const nodeOutputs = splitterOutputsByNodeId[n.id] || [];
        for (const o of nodeOutputs) {
          if (o.utilization_type === 'FREE_PORT') continue;
          const oArea = (o.target_area_or_node || '').trim().toLowerCase();
          const oSubArea =
            (o.subscriber_id && subAreaById[o.subscriber_id]) ||
            (o.subscriber_username &&
              subAreaByUser[o.subscriber_username.trim().toLowerCase()]) ||
            '';
          if (oArea === targetAreaLower || oSubArea === targetAreaLower) {
            matchesArea = true;
            break;
          }
        }
      }

      if (!matchesArea && Array.isArray(n.core_splices)) {
        for (const sp of n.core_splices) {
          if ((sp.forwarded_to_area || '').trim().toLowerCase() === targetAreaLower) {
            if (sp.outgoing_cable_id && oltPonCableIds[sp.outgoing_cable_id]) {
              highlightedCableIds[sp.outgoing_cable_id] = true;
            }
            if (sp.forwarded_to_node_id && oltPonNodeIds[sp.forwarded_to_node_id]) {
              seedNodeIds.push(sp.forwarded_to_node_id);
              areaLocalNodeIds[sp.forwarded_to_node_id] = true;
            }
            highlightedNodeIds[n.id] = true;
          }
        }
      }

      if (matchesArea) {
        seedNodeIds.push(n.id);
        areaLocalNodeIds[n.id] = true;
      }
    }

    for (const c of cables) {
      if (!oltPonCableIds[c.id]) continue;
      const allocCores = c.cores_allocation_json || [];
      const coreMatchesArea = allocCores.some(
        (core) =>
          (core.forwarded_to_area || '').trim().toLowerCase() === targetAreaLower ||
          (core.destination_target || '').trim().toLowerCase().includes(targetAreaLower)
      );
      if (coreMatchesArea) {
        highlightedCableIds[c.id] = true;
        seedNodeIds.push(c.source_node_id);
        seedNodeIds.push(c.target_node_id);
      }
    }

    // Include downstream local FDBs fed from any area Sub-Distribution Box
    const downQueue = [...seedNodeIds];
    const downVisited: Record<string, boolean> = {};
    while (downQueue.length > 0) {
      const curId = downQueue.shift()!;
      if (downVisited[curId]) continue;
      downVisited[curId] = true;
      const curNode = nodeById[curId];
      if (!curNode || curNode.node_type === 'OLT') continue;
      // Only cascade downstream from nodes that explicitly belong to this area (never fan out from DIST-MAIN into OTHER areas!)
      if (!areaLocalNodeIds[curId]) continue;
      for (const n of nodes) {
        const b = budgetsByNodeId[n.id];
        if (b?.parentNodeId === curId && oltPonNodeIds[n.id]) {
          const childArea = (n.area_name || '').trim().toLowerCase();
          if (!childArea || childArea === targetAreaLower) {
            areaLocalNodeIds[n.id] = true;
            highlightedNodeIds[n.id] = true;
            if (b.incomingCableId && oltPonCableIds[b.incomingCableId]) {
              highlightedCableIds[b.incomingCableId] = true;
            }
            downQueue.push(n.id);
          }
        }
      }
    }

    // Trace upstream feeder path from every matched area node to its feeding DIST-MAIN / OLT
    for (const startId of Object.keys(areaLocalNodeIds)) {
      let curId: string | null = startId;
      const visited: Record<string, boolean> = {};
      while (curId && !visited[curId]) {
        visited[curId] = true;
        if (oltPonNodeIds[curId]) {
          highlightedNodeIds[curId] = true;
        }
        const budget: NodeOpticalBudgetResult | undefined = budgetsByNodeId[curId];
        if (!budget) break;
        if (budget.incomingCableId && oltPonCableIds[budget.incomingCableId]) {
          highlightedCableIds[budget.incomingCableId] = true;
        }
        curId = budget.parentNodeId;
      }
    }

    // Also highlight any direct cable connecting two area-local nodes
    for (const c of cables) {
      if (
        oltPonCableIds[c.id] &&
        areaLocalNodeIds[c.source_node_id] &&
        areaLocalNodeIds[c.target_node_id]
      ) {
        highlightedCableIds[c.id] = true;
      }
    }
  } else {
    for (const id of Object.keys(oltPonNodeIds)) highlightedNodeIds[id] = true;
    for (const id of Object.keys(oltPonCableIds)) highlightedCableIds[id] = true;
  }

  // Step 3: Live summary metrics & fitBounds coordinates
  let cableCount = 0;
  let foscCount = 0;
  let fatCount = 0;
  let activeClientCount = 0;
  const fitBoundsCoords: [number, number][] = [];
  const areaFocusCoords: [number, number][] = [];

  for (const c of cables) {
    if (!highlightedCableIds[c.id]) continue;
    cableCount++;
    const routePts: GisLatLng[] = Array.isArray(c.route_coordinates_json)
      ? c.route_coordinates_json
      : [];
    const isAreaLocalCable =
      !hasArea ||
      areaLocalNodeIds[c.source_node_id] ||
      areaLocalNodeIds[c.target_node_id];
    for (const pt of routePts) {
      if (typeof pt.lat === 'number' && typeof pt.lng === 'number') {
        fitBoundsCoords.push([pt.lat, pt.lng]);
        if (isAreaLocalCable) areaFocusCoords.push([pt.lat, pt.lng]);
      }
    }
  }

  // Area Summary Card counters
  let areaDistBoxCount = 0;
  const areaSubDistNames: string[] = [];
  let areaFdbCount = 0;
  let areaTotalPorts = 0;
  let areaUsedPorts = 0;
  let areaOnlineOnts = 0;
  let areaOfflineOnts = 0;
  let bestFeederDbm: number | null = null;
  let bestFeederLabel = '';
  const seenAreaSubs: Record<string, boolean> = {};

  for (const n of nodes) {
    if (!highlightedNodeIds[n.id]) continue;
    fitBoundsCoords.push([n.lat, n.lng]);
    if (areaLocalNodeIds[n.id]) {
      areaFocusCoords.push([n.lat, n.lng]);
    }

    if (n.node_type === 'FOSC_JOINT') foscCount++;
    if (n.node_type === 'FDB_FAT') fatCount++;

    const b = budgetsByNodeId[n.id];
    const nodeOutputs = splitterOutputsByNodeId[n.id] || [];
    const nodePorts = portsByNodeId[n.id] || [];

    // Deduplicate active client ports per node across splitter outputs & FDB ports
    const countedPorts: Record<number, boolean> = {};
    for (const o of nodeOutputs) {
      if (o.utilization_type === 'CLIENT_ONT') {
        countedPorts[o.port_number] = true;
      }
    }
    for (const p of nodePorts) {
      if (p.status === 'ACTIVE') {
        countedPorts[p.port_number] = true;
      }
    }
    activeClientCount += Object.keys(countedPorts).length;

    if (hasArea && areaLocalNodeIds[n.id]) {
      if (n.node_type === 'DIST_NODE' || n.node_type === 'FOSC_JOINT') {
        areaDistBoxCount++;
        areaSubDistNames.push(n.name);
        if (
          b?.inputDbm !== null &&
          b?.inputDbm !== undefined &&
          (bestFeederDbm === null || b.inputDbm > bestFeederDbm)
        ) {
          bestFeederDbm = b.inputDbm;
          const incCable = b.incomingCableId ? cableById[b.incomingCableId] : undefined;
          bestFeederLabel = incCable?.name || `${n.name} Feeder`;
        }
      }
      if (n.node_type === 'FDB_FAT') {
        areaFdbCount++;
        if (
          bestFeederDbm === null &&
          b?.inputDbm !== null &&
          b?.inputDbm !== undefined
        ) {
          bestFeederDbm = b.inputDbm;
          const incCable = b.incomingCableId ? cableById[b.incomingCableId] : undefined;
          bestFeederLabel = incCable?.name || `${n.name} Input`;
        }
        const sum = b?.enclosureSummary;
        const nTotal = sum
          ? sum.boxCapacity
          : Math.max(Number(n.box_capacity || 0), Number(n.total_ports || 0), 8);
        const nUsed = sum
          ? sum.usedPorts
          : nodeOutputs.length > 0
          ? nodeOutputs.filter((o) => o.utilization_type !== 'FREE_PORT').length
          : nodePorts.filter((p) => p.status !== 'FREE').length;
        areaTotalPorts += nTotal;
        areaUsedPorts += Math.min(nTotal, nUsed);
      }

      // Count Online / Offline ONTs inside isolated area
      const checkSub = (subId?: string | null, subUsername?: string | null, fallbackKey?: string) => {
        const sub =
          (subId && subById[subId]) ||
          (subUsername && subByUser[subUsername.trim().toLowerCase()]) ||
          null;
        const key = sub?.id || fallbackKey;
        if (!key || seenAreaSubs[key]) return;
        seenAreaSubs[key] = true;
        if (sub) {
          if (sub.isOnline) areaOnlineOnts++;
          else areaOfflineOnts++;
        } else {
          areaOfflineOnts++;
        }
      };

      for (const sp of n.internal_splitters || []) {
        for (const leg of sp.legs || []) {
          if (leg.status === 'SUBSCRIBER_DROP') {
            checkSub(leg.subscriber_id, leg.subscriber_username, `${n.id}-${sp.id}-${leg.legNumber}`);
          }
        }
      }
      for (const o of nodeOutputs) {
        if (o.utilization_type === 'CLIENT_ONT') {
          checkSub(o.subscriber_id, o.subscriber_username, `${n.id}-out-${o.port_number}`);
        }
      }
      for (const p of nodePorts) {
        if (p.status === 'ACTIVE') {
          checkSub(p.subscriber_id, p.subscriber_username, `${n.id}-port-${p.port_number}`);
        }
      }
    }
  }

  // Build readable selection label e.g. "PON 2 (Baza Mohallah)"
  const selectedOlt = hasOlt ? oltsById[filterOltId] : undefined;
  const selectedPon = hasPon ? ponPortsById[filterPonPortId] : undefined;
  const parts: string[] = [];
  if (selectedOlt && !selectedPon) {
    parts.push(selectedOlt.name);
  }
  if (selectedPon) {
    const ponOlt = oltsById[selectedPon.olt_id];
    const ponTag = `PON ${selectedPon.port_number}`;
    if (ponOlt && !hasArea && !selectedPon.port_label) {
      parts.push(`${ponOlt.name} · ${ponTag}`);
    } else if (ponOlt && selectedOlt) {
      parts.push(`${ponOlt.name} · ${ponTag}`);
    } else {
      parts.push(ponTag);
    }
    if (!hasArea && selectedPon.port_label) {
      parts.push(`(${selectedPon.port_label})`);
    }
  }
  if (hasArea) {
    if (parts.length > 0) {
      parts.push(`(${filterAreaName})`);
    } else {
      parts.push(filterAreaName);
    }
  }

  const areaSummary: AreaIsolationSummary | null = hasArea
    ? {
        areaName: filterAreaName,
        distBoxCount: areaDistBoxCount,
        subDistNames: areaSubDistNames,
        fdbCount: areaFdbCount,
        totalPorts: areaTotalPorts,
        usedPorts: areaUsedPorts,
        freePorts: Math.max(0, areaTotalPorts - areaUsedPorts),
        onlineOnts: areaOnlineOnts,
        offlineOnts: areaOfflineOnts,
        feederDbm: bestFeederDbm,
        feederLabel: bestFeederLabel,
      }
    : null;

  return {
    isFilterActive: true,
    highlightedNodeIds,
    highlightedCableIds,
    cableCount,
    foscCount,
    fatCount,
    activeClientCount,
    summaryLabel: parts.join(' '),
    fitBoundsCoords: hasArea && areaFocusCoords.length > 0 ? areaFocusCoords : fitBoundsCoords,
    areaSummary,
  };
}

