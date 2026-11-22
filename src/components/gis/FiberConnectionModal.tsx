import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  Cable,
  CheckCircle2,
  MapPin,
  RefreshCw,
  Save,
  Sparkles,
  X,
} from 'lucide-react';
import type {
  GisCableTypeCode,
  GisCoreEntry,
  GisCoreLedgerStatus,
  GisLatLng,
  SupabaseGisCable,
  SupabaseGisFdbPort,
  SupabaseGisNode,
  SupabaseGisOlt,
  SupabaseGisOltPonPort,
  SupabaseGisSplitterOutput,
} from '../../services/supabaseClient';
import {
  CABLE_CAPACITY_PRESETS,
  CableCapacityPreset,
  NodeOpticalBudgetResult,
  SPLITTER_SPECS,
  computePolylineDistanceMeters,
  coreStatusToLedgerStatus,
  coreStatusToUsageType,
  findExistingCableBetweenNodes,
  findNextFreeCoreOnCable,
  ledgerStatusToCoreStatus,
  normalizeCableCores,
  summarizeCableCores,
} from '../../lib/fiberOpticEngine';
import { DEFAULT_NETWORK_AREAS } from '../../lib/billingAndNetwork';
import { SearchableCombobox, SearchableOption } from './SearchableCombobox';

interface FiberConnectionModalProps {
  isOpen: boolean;
  nodes: SupabaseGisNode[];
  existingCables?: SupabaseGisCable[];
  olts: SupabaseGisOlt[];
  oltsById: Record<string, SupabaseGisOlt>;
  ponPortsByOltId: Record<string, SupabaseGisOltPonPort[]>;
  ponPortsById: Record<string, SupabaseGisOltPonPort>;
  budgetsByNodeId?: Record<string, NodeOpticalBudgetResult>;
  portsByNodeId?: Record<string, SupabaseGisFdbPort[]>;
  splitterOutputsByNodeId?: Record<string, SupabaseGisSplitterOutput[]>;
  initialStartNodeId?: string | null;
  initialEndNodeId?: string | null;
  initialWaypoints?: GisLatLng[];
  initialCableCores?: 1 | 2 | 4 | 6 | 8 | 12 | 24 | 48;
  isSaving: boolean;
  onClose: () => void;
  onSaveConnection: (payload: {
    name: string;
    sourceNode: SupabaseGisNode;
    targetNode: SupabaseGisNode;
    sourceOltId: string | null;
    sourcePonPortId: string | null;
    cableType: GisCableTypeCode;
    cableCores: 1 | 2 | 4 | 6 | 8 | 12 | 24 | 48;
    distanceMeters: number;
    routeCoordinates: GisLatLng[];
    cores: GisCoreEntry[];
    notes: string;
    reuseExistingCableId?: string | null;
    forceNewCable?: boolean;
  }) => Promise<void>;
}

function getLedgerBadgeClass(status: GisCoreLedgerStatus): string {
  switch (status) {
    case 'ACTIVE':
      return 'bg-emerald-950/90 text-emerald-300 border-emerald-700';
    case 'RESERVED':
      return 'bg-amber-950/90 text-amber-300 border-amber-700';
    case 'FAULTY':
      return 'bg-rose-950/90 text-rose-300 border-rose-700';
    default:
      return 'bg-slate-900 text-slate-300 border-slate-700';
  }
}

export const FiberConnectionModal: React.FC<FiberConnectionModalProps> = ({
  isOpen,
  nodes,
  existingCables = [],
  olts,
  oltsById,
  ponPortsByOltId,
  ponPortsById,
  budgetsByNodeId = {},
  portsByNodeId = {},
  splitterOutputsByNodeId = {},
  initialStartNodeId = null,
  initialEndNodeId = null,
  initialWaypoints = [],
  initialCableCores = 12,
  isSaving,
  onClose,
  onSaveConnection,
}) => {
  const [startNodeId, setStartNodeId] = useState<string>('');
  const [endNodeId, setEndNodeId] = useState<string>('');
  const [presetId, setPresetId] = useState<string>('12C');
  const [cableName, setCableName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [distanceMeters, setDistanceMeters] = useState<number>(100);
  const [sourceOltId, setSourceOltId] = useState<string>('');
  const [sourcePonPortId, setSourcePonPortId] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [coresDraft, setCoresDraft] = useState<GisCoreEntry[]>([]);
  const [formError, setFormError] = useState<string>('');
  const [forceNewPhysicalCable, setForceNewPhysicalCable] = useState<boolean>(false);

  const existingSpanCable = useMemo(
    () => findExistingCableBetweenNodes(existingCables, startNodeId, endNodeId),
    [existingCables, startNodeId, endNodeId]
  );
  const isReusingExistingCable = Boolean(existingSpanCable && !forceNewPhysicalCable);
  const existingNextFreeCore = useMemo(
    () => (existingSpanCable ? findNextFreeCoreOnCable(existingSpanCable) : null),
    [existingSpanCable]
  );
  const existingSpanSummary = useMemo(
    () =>
      existingSpanCable
        ? summarizeCableCores(
            existingSpanCable.cores_allocation_json?.length
              ? existingSpanCable.cores_allocation_json
              : existingSpanCable.cores_tia598_json,
            existingSpanCable.cable_cores
          )
        : null,
    [existingSpanCable]
  );

  const nodesById = useMemo(() => {
    const map: Record<string, SupabaseGisNode> = {};
    for (const n of nodes) map[n.id] = n;
    return map;
  }, [nodes]);

  const sortedNodes = useMemo(
    () =>
      nodes
        .slice()
        .sort((a, b) => {
          const order: Record<string, number> = {
            OLT: 0,
            DIST_NODE: 1,
            FOSC_JOINT: 2,
            FDB_FAT: 3,
          };
          const diff = (order[a.node_type] ?? 9) - (order[b.node_type] ?? 9);
          if (diff !== 0) return diff;
          return a.name.localeCompare(b.name);
        }),
    [nodes]
  );

  const nodeOptions: SearchableOption[] = useMemo(() => {
    return sortedNodes.map((n) => {
      const budget = budgetsByNodeId[n.id];
      const summary = budget?.enclosureSummary;
      const spec = SPLITTER_SPECS[n.splitter_type] || SPLITTER_SPECS['none'];
      const nodePorts = portsByNodeId[n.id] || [];
      const nodeOutputs = splitterOutputsByNodeId[n.id] || [];

      const totalPorts = summary
        ? summary.boxCapacity
        : Math.max(Number(n.box_capacity || 0), Number(n.total_ports || 0), spec.defaultPorts || 0);
      const usedPorts = summary
        ? summary.usedPorts
        : nodeOutputs.length > 0
        ? nodeOutputs.filter((o) => o.utilization_type !== 'FREE_PORT').length
        : nodePorts.filter((p) => p.status !== 'FREE').length;
      const freePorts = Math.max(0, totalPorts - usedPorts);

      const dbmVal =
        n.node_type === 'OLT'
          ? Number(n.tx_power_dbm ?? 5.0)
          : budget?.ontRxDbm ?? budget?.thruOutputDbm ?? budget?.inputDbm;
      const metric =
        dbmVal !== null && dbmVal !== undefined
          ? `${dbmVal >= 0 && n.node_type === 'OLT' ? '+' : ''}${dbmVal.toFixed(1)} dBm`
          : undefined;
      const metricTone: SearchableOption['metricTone'] =
        n.node_type === 'OLT'
          ? 'sky'
          : budget?.healthBand === 'IDEAL' || budget?.healthBand === 'GOOD'
          ? 'emerald'
          : budget?.healthBand === 'MARGINAL'
          ? 'amber'
          : budget?.healthBand === 'CRITICAL LOS RISK'
          ? 'rose'
          : 'slate';

      const subParts: string[] = [n.node_type];
      if (n.area_name) subParts.push(n.area_name);
      if (totalPorts > 0) subParts.push(`${freePorts}/${totalPorts} Free`);
      else if (n.node_type === 'FOSC_JOINT') subParts.push(`${n.tray_capacity}C`);

      return {
        value: n.id,
        label: n.name,
        sublabel: subParts.join(' · '),
        metric,
        metricTone,
        keywords: `${n.name} ${n.area_name || ''} ${n.node_type} ${n.splitter_type || ''}`,
      };
    });
  }, [sortedNodes, budgetsByNodeId, portsByNodeId, splitterOutputsByNodeId]);

  const activePreset: CableCapacityPreset = useMemo(
    () =>
      CABLE_CAPACITY_PRESETS.find((p) => p.id === presetId) ||
      CABLE_CAPACITY_PRESETS.find((p) => p.id === '12C')!,
    [presetId]
  );

  // Build route coordinates from waypoints + current start/end nodes
  const buildRouteCoords = (sNode?: SupabaseGisNode, eNode?: SupabaseGisNode): GisLatLng[] => {
    if (!sNode || !eNode) return [];
    const pts: GisLatLng[] = [{ lat: sNode.lat, lng: sNode.lng }];
    if (initialWaypoints.length > 2) {
      pts.push(...initialWaypoints.slice(1, initialWaypoints.length - 1));
    } else if (initialWaypoints.length === 2) {
      // Keep any intermediate bend only if it wasn't just start/end
      const second = initialWaypoints[1];
      if (
        Math.abs(second.lat - eNode.lat) > 0.00001 ||
        Math.abs(second.lng - eNode.lng) > 0.00001
      ) {
        pts.push(second);
      }
    }
    pts.push({ lat: eNode.lat, lng: eNode.lng });
    return pts;
  };

  // Initialize modal state when opened
  useEffect(() => {
    if (!isOpen) return;
    setFormError('');
    setNameTouched(false);
    setNotes('');
    setForceNewPhysicalCable(false);

    const fallbackStart = sortedNodes.find((n) => n.node_type === 'OLT')?.id || sortedNodes[0]?.id || '';
    const resolvedStartId = initialStartNodeId || fallbackStart;
    const resolvedEndId =
      initialEndNodeId && initialEndNodeId !== resolvedStartId
        ? initialEndNodeId
        : sortedNodes.find((n) => n.id !== resolvedStartId)?.id || '';

    setStartNodeId(resolvedStartId);
    setEndNodeId(resolvedEndId);

    const existingBetween = findExistingCableBetweenNodes(
      existingCables,
      resolvedStartId,
      resolvedEndId
    );
    const effectiveCoreCap = existingBetween ? existingBetween.cable_cores : initialCableCores;

    const matchedPreset =
      CABLE_CAPACITY_PRESETS.find((p) => p.cores === effectiveCoreCap && p.cableType !== 'DROP') ||
      CABLE_CAPACITY_PRESETS.find((p) => p.cores === effectiveCoreCap) ||
      CABLE_CAPACITY_PRESETS[6];
    setPresetId(matchedPreset.id);

    const sNode = resolvedStartId ? nodesById[resolvedStartId] : undefined;
    const eNode = resolvedEndId ? nodesById[resolvedEndId] : undefined;

    // Auto-select OLT & PON if Start Node is OLT
    let initOltId = existingBetween?.source_olt_id || '';
    let initPonId = existingBetween?.source_pon_port_id || '';
    if (!initOltId && sNode?.olt_id && oltsById[sNode.olt_id]) {
      initOltId = sNode.olt_id;
      const pps = (ponPortsByOltId[initOltId] || [])
        .slice()
        .sort((a, b) => a.port_number - b.port_number);
      initPonId = sNode.pon_port_id || pps[0]?.id || '';
    } else if (!initPonId && sNode?.pon_port_id && ponPortsById[sNode.pon_port_id]) {
      initPonId = sNode.pon_port_id;
      initOltId = ponPortsById[initPonId].olt_id;
    }
    setSourceOltId(initOltId);
    setSourcePonPortId(initPonId);

    const ponTag = initPonId && ponPortsById[initPonId]
      ? ` [PON-${ponPortsById[initPonId].port_number}]`
      : '';
    setCableName(
      existingBetween?.name ||
        (sNode && eNode ? `${sNode.name}${ponTag} → ${eNode.name}` : 'New Fiber Span')
    );

    const coords = buildRouteCoords(sNode, eNode);
    const calcM = existingBetween
      ? Math.max(1, Number(existingBetween.distance_meters || 100))
      : coords.length >= 2
      ? Math.max(1, computePolylineDistanceMeters(coords))
      : 100;
    setDistanceMeters(calcM);

    const initialOriginLabel =
      initPonId && ponPortsById[initPonId]
        ? `${oltsById[initOltId]?.name || sNode?.name || 'OLT'} · PON-${
            ponPortsById[initPonId].port_number
          }`
        : sNode?.name || '';

    if (existingBetween) {
      const existingRaw = existingBetween.cores_allocation_json?.length
        ? existingBetween.cores_allocation_json
        : existingBetween.cores_tia598_json;
      setCoresDraft(normalizeCableCores(existingBetween.cable_cores, existingRaw));
      setNotes(existingBetween.notes || '');
      return;
    }

    const normalized = normalizeCableCores(matchedPreset.cores, []);
    // Pre-mark Core #1 as ACTIVE if start & end nodes exist for fast workflow
    if (normalized.length > 0 && sNode && eNode) {
      const destLabel = `${eNode.name}${eNode.area_name ? ` (${eNode.area_name})` : ''}`;
      normalized[0] = {
        ...normalized[0],
        status: 'Feed / Splitter',
        core_status: 'ACTIVE',
        usage_type: 'SPLITTER_FEED',
        origin_olt_id: initOltId || null,
        origin_pon_port_id: initPonId || null,
        origin_olt_label: initialOriginLabel,
        source_signal: initialOriginLabel,
        forwarded_to_area: destLabel,
        destination_target: destLabel,
        destinationNote: destLabel,
      };
    }
    setCoresDraft(normalized);
  }, [isOpen, initialStartNodeId, initialEndNodeId, initialCableCores]);

  // When user changes A-End or B-End inside the modal and an existing cable connects them, load its core ledger unless + Lay New Physical Cable is active
  useEffect(() => {
    if (!isOpen) return;
    if (existingSpanCable && !forceNewPhysicalCable) {
      const matchedPreset =
        CABLE_CAPACITY_PRESETS.find((p) => p.cores === existingSpanCable.cable_cores && p.cableType !== 'DROP') ||
        CABLE_CAPACITY_PRESETS.find((p) => p.cores === existingSpanCable.cable_cores);
      if (matchedPreset) setPresetId(matchedPreset.id);
      if (!nameTouched && existingSpanCable.name) setCableName(existingSpanCable.name);
      setDistanceMeters(Math.max(1, Number(existingSpanCable.distance_meters || distanceMeters)));
      const raw = existingSpanCable.cores_allocation_json?.length
        ? existingSpanCable.cores_allocation_json
        : existingSpanCable.cores_tia598_json;
      setCoresDraft(normalizeCableCores(existingSpanCable.cable_cores, raw));
    }
  }, [existingSpanCable?.id, forceNewPhysicalCable]);

  const handleRecalcDistance = (sId = startNodeId, eId = endNodeId) => {
    const sNode = nodesById[sId];
    const eNode = nodesById[eId];
    const coords = buildRouteCoords(sNode, eNode);
    if (coords.length >= 2) {
      setDistanceMeters(Math.max(1, computePolylineDistanceMeters(coords)));
    }
  };

  const handleStartNodeChange = (nextStartId: string) => {
    setStartNodeId(nextStartId);
    const sNode = nodesById[nextStartId];
    const eNode = nodesById[endNodeId];

    let nextOlt = sourceOltId;
    let nextPon = sourcePonPortId;
    if (sNode?.olt_id && oltsById[sNode.olt_id]) {
      nextOlt = sNode.olt_id;
      const pps = (ponPortsByOltId[nextOlt] || [])
        .slice()
        .sort((a, b) => a.port_number - b.port_number);
      nextPon = sNode.pon_port_id || pps[0]?.id || '';
      setSourceOltId(nextOlt);
      setSourcePonPortId(nextPon);
    }

    if (!nameTouched && sNode && eNode) {
      const ponTag =
        nextPon && ponPortsById[nextPon] ? ` [PON-${ponPortsById[nextPon].port_number}]` : '';
      setCableName(`${sNode.name}${ponTag} → ${eNode.name}`);
    }
    handleRecalcDistance(nextStartId, endNodeId);
  };

  const handleEndNodeChange = (nextEndId: string) => {
    setEndNodeId(nextEndId);
    const sNode = nodesById[startNodeId];
    const eNode = nodesById[nextEndId];
    if (!nameTouched && sNode && eNode) {
      const ponTag =
        sourcePonPortId && ponPortsById[sourcePonPortId]
          ? ` [PON-${ponPortsById[sourcePonPortId].port_number}]`
          : '';
      setCableName(`${sNode.name}${ponTag} → ${eNode.name}`);
    }
    handleRecalcDistance(startNodeId, nextEndId);
  };

  const handleCapacityChange = (nextPresetId: string) => {
    setPresetId(nextPresetId);
    const preset = CABLE_CAPACITY_PRESETS.find((p) => p.id === nextPresetId);
    if (!preset) return;
    setCoresDraft((prev) => normalizeCableCores(preset.cores, prev));
  };

  const selectedOltPons = useMemo(
    () =>
      sourceOltId
        ? (ponPortsByOltId[sourceOltId] || [])
            .slice()
            .sort((a, b) => a.port_number - b.port_number)
        : [],
    [sourceOltId, ponPortsByOltId]
  );

  const defaultOriginLabel = useMemo(() => {
    const feedPon = sourcePonPortId ? ponPortsById[sourcePonPortId] : undefined;
    const feedOlt = sourceOltId ? oltsById[sourceOltId] : undefined;
    const sNode = startNodeId ? nodesById[startNodeId] : undefined;
    if (feedPon) {
      return `${feedOlt?.name || sNode?.name || 'OLT'} · PON-${feedPon.port_number}`;
    }
    if (feedOlt) return feedOlt.name;
    return sNode?.name || '';
  }, [sourceOltId, sourcePonPortId, startNodeId, oltsById, ponPortsById, nodesById]);

  const coreSummary = useMemo(
    () => summarizeCableCores(coresDraft, activePreset.cores),
    [coresDraft, activePreset.cores]
  );

  const sourceSignalSuggestions = useMemo(() => {
    const list: string[] = [];
    for (const olt of olts) {
      const pps = (ponPortsByOltId[olt.id] || []).slice().sort((a, b) => a.port_number - b.port_number);
      for (const pp of pps) {
        list.push(`${olt.name} · PON-${pp.port_number} (${pp.port_label || 'Main'})`);
      }
    }
    for (const n of sortedNodes) {
      if (n.node_type === 'FOSC_JOINT' || n.node_type === 'DIST_NODE') {
        list.push(`${n.name} · Core #1`);
      }
    }
    return list;
  }, [olts, ponPortsByOltId, sortedNodes]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    const sNode = nodesById[startNodeId];
    const eNode = nodesById[endNodeId];
    if (!sNode || !eNode) {
      setFormError('Please select both Start Node (A-End) and End Node (B-End).');
      return;
    }
    if (sNode.id === eNode.id) {
      setFormError('Start Node and End Node cannot be the same device.');
      return;
    }

    const routeCoordinates = buildRouteCoords(sNode, eNode);
    const safeMeters = Math.max(1, Math.round(Number(distanceMeters) || 1));

    await onSaveConnection({
      name: cableName.trim() || `${sNode.name} → ${eNode.name}`,
      sourceNode: sNode,
      targetNode: eNode,
      sourceOltId: sourceOltId || null,
      sourcePonPortId: sourcePonPortId || null,
      cableType: activePreset.cableType,
      cableCores: activePreset.cores,
      distanceMeters: safeMeters,
      routeCoordinates,
      cores: normalizeCableCores(activePreset.cores, coresDraft),
      notes: notes.trim(),
      reuseExistingCableId: isReusingExistingCable ? existingSpanCable?.id || null : null,
      forceNewCable: forceNewPhysicalCable,
    });
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 overflow-y-auto">
      <form
        onSubmit={handleSubmit}
        className="w-[95vw] sm:w-full max-w-4xl max-h-[90vh] overflow-y-auto mx-auto my-auto rounded-2xl box-border bg-slate-900 border border-slate-700 shadow-2xl flex flex-col text-slate-100"
      >
        {/* Sticky Modal Header */}
        <div className="px-4 py-3.5 border-b border-slate-800 bg-slate-950/95 flex items-center justify-between gap-3 sticky top-0 z-10">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400 shrink-0">
              <Cable className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-white truncate">
                Fiber Cable Connection &amp; Core Marking Ledger
              </h3>
              <p className="text-[11px] font-mono text-slate-400 truncate">
                Define A-End &rarr; B-End route, core capacity &amp; TIA-598 signal routing
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[36px] min-w-[36px] rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center cursor-pointer shrink-0"
            aria-label="Close fiber connection modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4 text-xs">
          {formError && (
            <div className="p-2.5 rounded-xl bg-rose-950/80 border border-rose-700 text-rose-200 font-mono text-xs">
              {formError}
            </div>
          )}

          {/* Dual Start & End Node Picker */}
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5" />
                Route Endpoints (A-End &rarr; B-End)
              </span>
              <button
                type="button"
                onClick={() => {
                  const prevStart = startNodeId;
                  const prevEnd = endNodeId;
                  setStartNodeId(prevEnd);
                  setEndNodeId(prevStart);
                  handleStartNodeChange(prevEnd);
                }}
                className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[11px] font-mono text-cyan-300 flex items-center gap-1 cursor-pointer"
              >
                <ArrowLeftRight className="w-3 h-3" />
                <span>Swap A &harr; B</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Start Node (A-End) */}
              <div className="p-2.5 rounded-lg bg-slate-900/70 border border-emerald-800/50 space-y-1.5">
                <label className="block text-[10px] font-mono font-bold uppercase text-emerald-400">
                  Start Node (A-End · NOC / OLT / Joint)
                </label>
                <SearchableCombobox
                  value={startNodeId}
                  options={nodeOptions}
                  onChange={handleStartNodeChange}
                  placeholder="-- Choose Start Node --"
                  searchPlaceholder="Search node name, area, type, dBm..."
                  emptyOptionLabel="-- Choose Start Node --"
                  accentColor="emerald"
                  ariaLabel="Start Node (A-End)"
                />
              </div>

              {/* End Node (B-End) */}
              <div className="p-2.5 rounded-lg bg-slate-900/70 border border-amber-800/50 space-y-1.5">
                <label className="block text-[10px] font-mono font-bold uppercase text-amber-400">
                  End Node (B-End · FDB / FAT / Joint)
                </label>
                <SearchableCombobox
                  value={endNodeId}
                  options={nodeOptions}
                  onChange={handleEndNodeChange}
                  placeholder="-- Choose End Node --"
                  searchPlaceholder="Search node name, area, type, dBm..."
                  emptyOptionLabel="-- Choose End Node --"
                  accentColor="amber"
                  ariaLabel="End Node (B-End)"
                />
              </div>
            </div>

            {/* Multi-Core Cable Reuse Detection Banner (Prevents Duplicate Parallel Cables) */}
            {existingSpanCable && (
              <div
                className={`p-3 rounded-xl border flex flex-wrap items-center justify-between gap-2.5 text-[11px] font-mono ${
                  isReusingExistingCable
                    ? 'bg-emerald-950/50 border-emerald-600/70 text-emerald-200'
                    : 'bg-amber-950/45 border-amber-600/70 text-amber-200'
                }`}
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="font-bold flex items-center gap-1.5 flex-wrap">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      {isReusingExistingCable
                        ? `Reusing Existing ${existingSpanCable.cable_cores}C Cable (${existingSpanCable.name || 'Trunk Span'})`
                        : `Laying NEW Parallel Cable (Existing ${existingSpanCable.cable_cores}C span already exists)`}
                    </span>
                  </div>
                  <div className="text-[10px] opacity-90">
                    {existingSpanSummary
                      ? `${existingSpanSummary.litCount + existingSpanSummary.reservedCount}/${existingSpanSummary.total} Cores Used/Reserved • ${existingSpanSummary.spareCount} Free`
                      : ''}
                    {existingNextFreeCore !== null
                      ? ` • Next Free: Core #${existingNextFreeCore}`
                      : ' • All cores currently allocated'}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {isReusingExistingCable ? (
                    <button
                      type="button"
                      onClick={() => {
                        setForceNewPhysicalCable(true);
                        setCoresDraft(normalizeCableCores(activePreset.cores, []));
                      }}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-amber-500/70 text-amber-300 font-bold text-[10px] cursor-pointer"
                    >
                      + Lay New Physical Cable
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setForceNewPhysicalCable(false)}
                      className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-[10px] cursor-pointer"
                    >
                      Bind to Existing {existingSpanCable.cable_cores}C Cable
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Cable Capacity, Name, Distance, OLT/PON Binding */}
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div>
                <label className="block text-[10px] font-mono text-slate-400 mb-1">
                  Cable Name / Tag
                </label>
                <input
                  type="text"
                  value={cableName}
                  onChange={(e) => {
                    setCableName(e.target.value);
                    setNameTouched(true);
                  }}
                  placeholder="e.g. Feeder-Main-12C"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-[10px] font-mono text-slate-400 mb-1">
                  Fiber Cable Core Count
                </label>
                <select
                  value={presetId}
                  onChange={(e) => handleCapacityChange(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-xs font-mono font-bold text-cyan-300"
                >
                  {CABLE_CAPACITY_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label} ({p.cores} {p.cores === 1 ? 'Core' : 'Cores'})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-mono text-slate-400 mb-1">
                  Total Meters (Auto / Manual)
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min={1}
                    max={50000}
                    value={distanceMeters}
                    onChange={(e) => setDistanceMeters(Number(e.target.value))}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-xs font-mono text-white tabular-nums"
                  />
                  <button
                    type="button"
                    onClick={() => handleRecalcDistance()}
                    className="min-h-[36px] px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-cyan-300 cursor-pointer shrink-0"
                    title="Recalculate map distance"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 font-mono">
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">Source OLT</label>
                <SearchableCombobox
                  value={sourceOltId}
                  options={olts.map((o) => ({
                    value: o.id,
                    label: o.name,
                    sublabel: `${o.pon_mode} · ${o.total_pon_ports} PON`,
                    metricTone: 'sky',
                  }))}
                  onChange={(nextOlt) => {
                    setSourceOltId(nextOlt);
                    const pps = nextOlt ? ponPortsByOltId[nextOlt] || [] : [];
                    setSourcePonPortId(pps[0]?.id || '');
                  }}
                  emptyOptionLabel="None / Downstream Span"
                  searchPlaceholder="Search OLT..."
                  accentColor="sky"
                  ariaLabel="Source OLT"
                />
              </div>

              <div>
                <label className="block text-[10px] text-slate-400 mb-1">Source PON Port</label>
                <SearchableCombobox
                  value={sourcePonPortId}
                  options={selectedOltPons.map((pp) => ({
                    value: pp.id,
                    label: `PON-${pp.port_number}`,
                    sublabel: pp.port_label || 'Main',
                    metric: `+${Number(pp.tx_power_dbm).toFixed(1)} dBm`,
                    metricTone: 'emerald',
                  }))}
                  onChange={(val) => setSourcePonPortId(val)}
                  emptyOptionLabel="Auto / Any PON"
                  searchPlaceholder="Search PON port..."
                  accentColor="cyan"
                  ariaLabel="Source PON Port"
                />
              </div>

              <div>
                <label className="block text-[10px] text-slate-400 mb-1">Route Notes</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Pole #, duct, aerial landmark..."
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-xs font-sans text-white placeholder-slate-500"
                />
              </div>
            </div>
          </div>

          {/* Core Summary & Quick Fill Strip */}
          <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-slate-950 border border-slate-800">
            <div className="flex items-center flex-wrap gap-3 font-mono text-[11px] tabular-nums">
              <span className="font-bold text-white">{activePreset.label}</span>
              <span className="text-emerald-400 font-bold">{coreSummary.litCount} Lit / Active</span>
              <span className="text-amber-400 font-bold">{coreSummary.reservedCount} Reserved</span>
              <span className="text-slate-400">{coreSummary.spareCount} Spare / Dark</span>
              {coreSummary.faultyCount > 0 && (
                <span className="text-rose-400 font-bold">{coreSummary.faultyCount} Faulty</span>
              )}
            </div>

            <div className="flex items-center flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => {
                  const eNode = nodesById[endNodeId];
                  const destLabel = eNode
                    ? `${eNode.name}${eNode.area_name ? ` (${eNode.area_name})` : ''}`
                    : '';
                  setCoresDraft((prev) =>
                    prev.map((c, idx) =>
                      idx === 0
                        ? {
                            ...c,
                            core_status: 'ACTIVE',
                            status: 'Feed / Splitter',
                            usage_type: 'SPLITTER_FEED',
                            origin_olt_id: sourceOltId || null,
                            origin_pon_port_id: sourcePonPortId || null,
                            origin_olt_label: defaultOriginLabel,
                            source_signal: defaultOriginLabel,
                            forwarded_to_area: destLabel,
                            destination_target: destLabel,
                            destinationNote: destLabel,
                          }
                        : c
                    )
                  );
                }}
                className="px-2.5 py-1 rounded-lg bg-emerald-950 hover:bg-emerald-900 border border-emerald-700 text-[10px] font-mono font-bold text-emerald-300 flex items-center gap-1 cursor-pointer"
              >
                <Sparkles className="w-3 h-3" />
                <span>Auto-Fill Core #1</span>
              </button>
              {defaultOriginLabel && (
                <button
                  type="button"
                  onClick={() =>
                    setCoresDraft((prev) =>
                      prev.map((c) => {
                        const ledger = coreStatusToLedgerStatus(c.status, c.core_status);
                        return ledger !== 'SPARE'
                          ? {
                              ...c,
                              origin_olt_id: sourceOltId || null,
                              origin_pon_port_id: sourcePonPortId || null,
                              origin_olt_label: defaultOriginLabel,
                              source_signal: c.source_signal || defaultOriginLabel,
                            }
                          : c;
                      })
                    )
                  }
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[10px] font-mono text-sky-300 cursor-pointer"
                >
                  Tag Lit Origin
                </button>
              )}
            </div>
          </div>

          <datalist id="fiber-conn-source-list">
            {sourceSignalSuggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>

          <datalist id="fiber-conn-dest-list">
            {sortedNodes.map((n) => (
              <option
                key={n.id}
                value={`${n.name}${n.area_name ? ` (${n.area_name})` : ''}`}
              />
            ))}
            {DEFAULT_NETWORK_AREAS.map((a) => (
              <option key={a.area_name} value={a.area_name} />
            ))}
          </datalist>

          {/* Interactive TIA-598 Fiber Core / Pair Table */}
          <div className="rounded-xl border border-slate-800 bg-slate-950 overflow-hidden">
            <div className="px-3 py-2 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between text-[11px] font-mono font-bold text-slate-300">
              <span>TIA-598 Core / Pair Signal Routing Ledger ({coresDraft.length} Cores)</span>
              <span className="text-[10px] text-slate-400">
                1: Blue &middot; 2: Orange &middot; 3: Green &middot; 4: Brown &hellip;
              </span>
            </div>

            <div className="max-h-72 overflow-y-auto divide-y divide-slate-800/80">
              {coresDraft.map((core, idx) => {
                const ledgerStatus = coreStatusToLedgerStatus(core.status, core.core_status);
                return (
                  <div
                    key={core.coreNumber}
                    className="p-2.5 grid grid-cols-1 lg:grid-cols-12 gap-2 items-center hover:bg-slate-900/50 transition"
                  >
                    {/* Core Color & Tube */}
                    <div className="lg:col-span-3 flex items-center justify-between lg:justify-start gap-2 font-mono text-[11px]">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="w-4 h-4 rounded border border-white/40 shrink-0"
                          style={{ backgroundColor: core.coreColorHex }}
                          title={`Core #${core.coreNumber} ${core.coreColorName}`}
                        />
                        <span className="font-bold text-white tabular-nums truncate">
                          #{core.coreNumber} {core.coreColorName}
                        </span>
                      </div>
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-[10px] text-slate-300 shrink-0">
                        <span
                          className="w-2 h-2 rounded-full border border-white/30"
                          style={{ backgroundColor: core.tubeColorHex }}
                        />
                        Tube #{core.tubeNumber}
                      </span>
                    </div>

                    {/* Status */}
                    <div className="lg:col-span-2">
                      <select
                        value={ledgerStatus}
                        onChange={(e) => {
                          const nextLedger = e.target.value as GisCoreLedgerStatus;
                          const nextLegacyStatus = ledgerStatusToCoreStatus(
                            nextLedger,
                            core.destination_target || core.forwarded_to_area
                          );
                          setCoresDraft((prev) =>
                            prev.map((item, i) =>
                              i === idx
                                ? {
                                    ...item,
                                    core_status: nextLedger,
                                    status: nextLegacyStatus,
                                    usage_type: coreStatusToUsageType(nextLegacyStatus),
                                    source_signal:
                                      nextLedger !== 'SPARE' &&
                                      !item.source_signal &&
                                      !item.origin_olt_label
                                        ? defaultOriginLabel
                                        : item.source_signal,
                                    origin_olt_label:
                                      nextLedger !== 'SPARE' && !item.origin_olt_label
                                        ? defaultOriginLabel
                                        : item.origin_olt_label,
                                  }
                                : item
                            )
                          );
                        }}
                        className={`w-full rounded-lg border px-2 py-1.5 text-[11px] font-mono font-bold ${getLedgerBadgeClass(
                          ledgerStatus
                        )}`}
                      >
                        <option value="ACTIVE">ACTIVE / LIT</option>
                        <option value="SPARE">SPARE / DARK</option>
                        <option value="RESERVED">RESERVED</option>
                        <option value="FAULTY">FAULTY / CUT</option>
                      </select>
                    </div>

                    {/* Source Signal */}
                    <div className="lg:col-span-3">
                      <input
                        type="text"
                        list="fiber-conn-source-list"
                        value={core.source_signal ?? core.origin_olt_label ?? ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          setCoresDraft((prev) =>
                            prev.map((item, i) =>
                              i === idx
                                ? { ...item, source_signal: val, origin_olt_label: val }
                                : item
                            )
                          );
                        }}
                        placeholder="From NOC / OLT & PON..."
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] font-mono text-sky-200 placeholder-slate-500"
                      />
                    </div>

                    {/* Destination / Drop Target */}
                    <div className="lg:col-span-2">
                      <input
                        type="text"
                        list="fiber-conn-dest-list"
                        value={
                          core.destination_target ??
                          core.forwarded_to_area ??
                          core.destinationNote ??
                          ''
                        }
                        onChange={(e) => {
                          const val = e.target.value;
                          setCoresDraft((prev) =>
                            prev.map((item, i) =>
                              i === idx
                                ? {
                                    ...item,
                                    destination_target: val,
                                    forwarded_to_area: val,
                                    destinationNote: val,
                                  }
                                : item
                            )
                          );
                        }}
                        placeholder="To FAT / FDB..."
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] text-white placeholder-slate-500"
                      />
                    </div>

                    {/* Power (dBm) & Notes */}
                    <div className="lg:col-span-2 grid grid-cols-2 gap-1">
                      <input
                        type="text"
                        value={core.optical_power_dbm || ''}
                        onChange={(e) => {
                          const optical_power_dbm = e.target.value;
                          setCoresDraft((prev) =>
                            prev.map((item, i) =>
                              i === idx ? { ...item, optical_power_dbm } : item
                            )
                          );
                        }}
                        placeholder="dBm"
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-1.5 py-1.5 text-[10px] font-mono text-cyan-300 tabular-nums placeholder-slate-500"
                      />
                      <input
                        type="text"
                        value={core.remarks || ''}
                        onChange={(e) => {
                          const remarks = e.target.value;
                          setCoresDraft((prev) =>
                            prev.map((item, i) => (i === idx ? { ...item, remarks } : item))
                          );
                        }}
                        placeholder="Note"
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-1.5 py-1.5 text-[10px] text-slate-200 placeholder-slate-500"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Sticky Footer */}
        <div className="px-4 py-3 border-t border-slate-800 bg-slate-950 flex flex-wrap items-center justify-between gap-2 sticky bottom-0 z-10">
          <div className="flex items-center gap-1.5 text-[11px] font-mono text-emerald-400">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Persists directly to Supabase PostgreSQL</span>
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[40px] px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono text-xs cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="min-h-[40px] px-5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-slate-950 font-mono font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-lg"
            >
              <Save className="w-4 h-4" />
              <span>
                {isSaving
                  ? 'Saving to Supabase...'
                  : isReusingExistingCable
                  ? `Update Existing ${existingSpanCable?.cable_cores}C Cable Cores`
                  : 'Lay New Cable & Save Core Ledger'}
              </span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
