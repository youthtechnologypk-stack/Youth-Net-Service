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
}

export function collectSortedAreaOptions(params: {
  nodes: SupabaseGisNode[];
  olts: SupabaseGisOlt[];
  subscribers: GisSubscriberSummary[];
  splitterOutputs: SupabaseGisSplitterOutput[];
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
  for (const s of params.subscribers) register(s.area);
  for (const out of params.splitterOutputs) {
    if (out.utilization_type === 'DOWNSTREAM_AREA_FEED') {
      register(out.target_area_or_node);
    }
  }

  return Object.values(seen).sort((a, b) => a.localeCompare(b));
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
    };
  }

  // Subscriber area lookup by ID and lowercase username
  const subAreaById: Record<string, string> = {};
  const subAreaByUser: Record<string, string> = {};
  for (const s of subscribers) {
    const area = (s.area || '').trim().toLowerCase();
    if (!area) continue;
    if (s.id) subAreaById[s.id] = area;
    if (s.username) subAreaByUser[s.username.trim().toLowerCase()] = area;
  }

  const cableById: Record<string, SupabaseGisCable> = {};
  for (const c of cables) {
    cableById[c.id] = c;
  }

  // Step 1: OLT & PON Port branch matching
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
          allocCores.some((core) => core.origin_pon_port_id === filterPonPortId);
      } else if (effectiveOltId) {
        matchesCable =
          c.source_olt_id === effectiveOltId ||
          targetBudget?.oltId === effectiveOltId ||
          allocCores.some((core) => core.origin_olt_id === effectiveOltId);
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
          (n.node_type === 'OLT' && Boolean(effectiveOltId) && n.olt_id === effectiveOltId);
      } else if (effectiveOltId) {
        matchesNode =
          n.olt_id === effectiveOltId ||
          b?.oltId === effectiveOltId;
      }
      if (matchesNode) {
        oltPonNodeIds[n.id] = true;
      }
    }
  } else {
    for (const n of nodes) oltPonNodeIds[n.id] = true;
    for (const c of cables) oltPonCableIds[c.id] = true;
  }

  // Step 2: Area / Mohallah filtering + upstream optical feeder path tracing
  const highlightedNodeIds: Record<string, boolean> = {};
  const highlightedCableIds: Record<string, boolean> = {};

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

      if (matchesArea) {
        seedNodeIds.push(n.id);
      }
    }

    for (const c of cables) {
      if (!oltPonCableIds[c.id]) continue;
      const allocCores = c.cores_allocation_json || [];
      const coreMatchesArea = allocCores.some(
        (core) => (core.forwarded_to_area || '').trim().toLowerCase() === targetAreaLower
      );
      if (coreMatchesArea) {
        highlightedCableIds[c.id] = true;
        seedNodeIds.push(c.source_node_id);
        seedNodeIds.push(c.target_node_id);
      }
    }

    // Trace upstream path from every matched area node to its feeding OLT
    for (const startId of seedNodeIds) {
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

  for (const c of cables) {
    if (!highlightedCableIds[c.id]) continue;
    cableCount++;
    const routePts: GisLatLng[] = Array.isArray(c.route_coordinates_json)
      ? c.route_coordinates_json
      : [];
    for (const pt of routePts) {
      if (typeof pt.lat === 'number' && typeof pt.lng === 'number') {
        fitBoundsCoords.push([pt.lat, pt.lng]);
      }
    }
  }

  for (const n of nodes) {
    if (!highlightedNodeIds[n.id]) continue;
    fitBoundsCoords.push([n.lat, n.lng]);

    if (n.node_type === 'FOSC_JOINT') foscCount++;
    if (n.node_type === 'FDB_FAT') fatCount++;

    // Deduplicate active client ports per node across splitter outputs & FDB ports
    const countedPorts: Record<number, boolean> = {};
    const nodeOutputs = splitterOutputsByNodeId[n.id] || [];
    for (const o of nodeOutputs) {
      if (o.utilization_type === 'CLIENT_ONT') {
        countedPorts[o.port_number] = true;
      }
    }
    const nodePorts = portsByNodeId[n.id] || [];
    for (const p of nodePorts) {
      if (p.status === 'ACTIVE') {
        countedPorts[p.port_number] = true;
      }
    }
    activeClientCount += Object.keys(countedPorts).length;
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

  return {
    isFilterActive: true,
    highlightedNodeIds,
    highlightedCableIds,
    cableCount,
    foscCount,
    fatCount,
    activeClientCount,
    summaryLabel: parts.join(' '),
    fitBoundsCoords,
  };
}
