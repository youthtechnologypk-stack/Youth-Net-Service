import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Cable,
  CheckCircle2,
  ClipboardCheck,
  GitBranch,
  History,
  Layers,
  Link2,
  Navigation,
  Phone,
  Plus,
  Radio,
  RefreshCw,
  Save,
  Scissors,
  Search,
  Server,
  ShieldAlert,
  Sliders,
  Trash2,
  UserPlus,
  Users,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import { SearchableCombobox, SearchableOption } from './SearchableCombobox';
import type {
  CoreSpliceAction,
  EnclosureCoreSpliceEntry,
  GisCableTypeCode,
  GisCoreEntry,
  GisCoreLedgerStatus,
  GisLatLng,
  GisNodeType,
  GisPortStatus,
  GisSpliceEntry,
  GisSpliceStatus,
  GisSplitterCategory,
  GisSplitterType,
  InternalSplitterInputType,
  InternalSplitterLegStatus,
  InternalSplitterUnit,
  OltSfpClass,
  SplitterUtilizationType,
  SupabaseGisCable,
  SupabaseGisFdbPort,
  SupabaseGisNode,
  SupabaseGisOlt,
  SupabaseGisOltPonPort,
  SupabaseGisSplitterOutput,
} from '../../services/supabaseClient';
import type { GisSubscriberSummary } from '../../services/fiberGisService';
import {
  CABLE_CAPACITY_PRESETS,
  DEFAULT_FUSION_SPLICE_LOSS_DB,
  DEFAULT_PASS_THROUGH_SPLICE_LOSS_DB,
  FDB_ENCLOSURE_CAPACITIES,
  NodeOpticalBudgetResult,
  SFP_TX_PRESETS,
  SPLITTER_SPECS,
  buildDefaultLegsForSplitter,
  cableCoresToType,
  calculateTopologyOpticalBudgets,
  coreStatusToLedgerStatus,
  coreStatusToUsageType,
  evaluateEnclosureOpticalState,
  generateDefaultSpliceTray,
  getDefaultMaxOnuLimit,
  getFbtLegOutputs,
  getHealthBadgeColors,
  getNodeTypeLabel,
  getOpticalHealthLabel,
  getTia598Color,
  inferSfpClassFromDbm,
  inferSplitterCategory,
  ledgerStatusToCoreStatus,
  normalizeCableCores,
  resolveHopSpliceLoss,
  summarizeCableCores,
} from '../../lib/fiberOpticEngine';
import { DEFAULT_NETWORK_AREAS } from '../../lib/billingAndNetwork';

interface FiberGisInspectorPanelProps {
  selectedNode: SupabaseGisNode | null;
  selectedCable: SupabaseGisCable | null;
  cableClickPoint: GisLatLng | null;
  nodes: SupabaseGisNode[];
  cables: SupabaseGisCable[];
  portsByNodeId: Record<string, SupabaseGisFdbPort[]>;
  splitterOutputsByNodeId?: Record<string, SupabaseGisSplitterOutput[]>;
  budgetsByNodeId: Record<string, NodeOpticalBudgetResult>;
  olts?: SupabaseGisOlt[];
  oltsById?: Record<string, SupabaseGisOlt>;
  ponPortsByOltId?: Record<string, SupabaseGisOltPonPort[]>;
  ponPortsById?: Record<string, SupabaseGisOltPonPort>;
  subscribers: GisSubscriberSummary[];
  isSaving: boolean;
  onClose: () => void;
  onSaveNode: (nodeId: string, patch: Partial<SupabaseGisNode>) => Promise<void>;
  onDeleteNode: (nodeId: string) => Promise<void>;
  onSaveCable: (cableId: string, patch: Partial<SupabaseGisCable>) => Promise<void>;
  onDeleteCable: (cableId: string) => Promise<void>;
  onSplitCable: (cable: SupabaseGisCable, splitPoint?: GisLatLng) => Promise<void>;
  onAssignPort: (params: {
    fdbNodeId: string;
    portNumber: number;
    subscriberId?: string | null;
    subscriberUsername?: string | null;
    clientLabel?: string | null;
    dropCableMeters: number;
    status: GisPortStatus;
  }) => Promise<void>;
  onUpsertSplitterOutput?: (params: {
    nodeId: string;
    nodeType: GisNodeType;
    portNumber: number;
    legLabel?: string | null;
    utilizationType: SplitterUtilizationType;
    subscriberId?: string | null;
    subscriberUsername?: string | null;
    clientNameManual?: string | null;
    targetAreaOrNode?: string | null;
    dropDistanceMeters?: number;
    estimatedRxDbm?: number | null;
  }) => Promise<void>;
  onInitializeSplitterOutputs?: (params: {
    node: SupabaseGisNode;
    splitterType: GisSplitterType;
    totalPorts: number;
    inputDbm?: number | null;
  }) => Promise<void>;
  onOpenTrace?: (nodeId: string, output?: SupabaseGisSplitterOutput | null) => void;
  onOpenEditOlt?: (oltId: string) => void;
  onUpdatePonPort?: (portId: string, patch: Partial<SupabaseGisOltPonPort>) => Promise<void>;
  onOpenUpgradeModal?: (node: SupabaseGisNode) => void;
  onRouteCableFromNode?: (node: SupabaseGisNode) => void;
  onQuickSpliceAndExtendCore?: (params: {
    sourceNode: SupabaseGisNode;
    incomingCableId: string;
    incomingCoreNumber: number;
    targetNodeId: string;
    outgoingCableCores: 1 | 2 | 4 | 6 | 8 | 12 | 24 | 48;
    outgoingCoreNumber: number;
    spliceLossDb: number;
  }) => Promise<void>;
  onFocusNode?: (node: SupabaseGisNode) => void;
}

export const FiberGisInspectorPanel: React.FC<FiberGisInspectorPanelProps> = ({
  selectedNode,
  selectedCable,
  cableClickPoint,
  nodes,
  cables,
  portsByNodeId,
  splitterOutputsByNodeId = {},
  budgetsByNodeId,
  olts = [],
  oltsById = {},
  ponPortsByOltId = {},
  ponPortsById = {},
  subscribers,
  isSaving,
  onClose,
  onSaveNode,
  onDeleteNode,
  onSaveCable,
  onDeleteCable,
  onSplitCable,
  onAssignPort,
  onUpsertSplitterOutput,
  onInitializeSplitterOutputs,
  onOpenTrace,
  onOpenEditOlt,
  onUpdatePonPort,
  onOpenUpgradeModal,
  onRouteCableFromNode,
  onQuickSpliceAndExtendCore,
}) => {
  const [fdbSubTab, setFdbSubTab] = useState<'ports' | 'splices' | 'signal'>('ports');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [ponTxDrafts, setPonTxDrafts] = useState<Record<string, number>>({});
  const [editingPonId, setEditingPonId] = useState<string | null>(null);

  // Node editable draft
  const [nodeName, setNodeName] = useState('');
  const [nodeArea, setNodeArea] = useState('');
  const [nodeTxPower, setNodeTxPower] = useState<number>(5.0);
  const [nodeSplitter, setNodeSplitter] = useState<GisSplitterType>('1:8');
  const [nodeSplitterCat, setNodeSplitterCat] = useState<GisSplitterCategory>('PLC_EQUAL');
  const [nodeTotalPorts, setNodeTotalPorts] = useState<number>(8);
  const [nodeBoxCapacity, setNodeBoxCapacity] = useState<number>(8);
  const [nodeFeedCableId, setNodeFeedCableId] = useState<string>('');
  const [nodeFeedCore, setNodeFeedCore] = useState<number>(1);
  const [nodeFeedCorePair, setNodeFeedCorePair] = useState<string>('');
  const [nodePonPortId, setNodePonPortId] = useState<string>('');
  const [nodeTrayCapacity, setNodeTrayCapacity] = useState<number>(12);
  const [nodeLossPerSplice, setNodeLossPerSplice] = useState<number>(DEFAULT_FUSION_SPLICE_LOSS_DB);
  const [nodeNotes, setNodeNotes] = useState('');
  const [spliceTrayDraft, setSpliceTrayDraft] = useState<GisSpliceEntry[]>([]);
  const [internalSplittersDraft, setInternalSplittersDraft] = useState<InternalSplitterUnit[]>([]);
  const [coreSplicesDraft, setCoreSplicesDraft] = useState<EnclosureCoreSpliceEntry[]>([]);
  const [activeLegEditor, setActiveLegEditor] = useState<{ splitterId: string; legNumber: number } | null>(null);
  const [legSubSearch, setLegSubSearch] = useState('');
  const [showAllSpliceCables, setShowAllSpliceCables] = useState(false);
  const [quickExtendCoreKey, setQuickExtendCoreKey] = useState<string | null>(null);
  const [quickExtendTargetNodeId, setQuickExtendTargetNodeId] = useState<string>('');
  const [quickExtendCableCores, setQuickExtendCableCores] = useState<
    1 | 2 | 4 | 6 | 8 | 12 | 24 | 48
  >(2);
  const [quickExtendOutCore, setQuickExtendOutCore] = useState<number>(1);
  const [localSaving, setLocalSaving] = useState(false);
  const [localSaveError, setLocalSaveError] = useState<string | null>(null);

  // Cable editable draft
  const [cableName, setCableName] = useState('');
  const [cablePresetId, setCablePresetId] = useState<string>('12C');
  const [cableDistanceMeters, setCableDistanceMeters] = useState<number>(0);
  const [cableNotes, setCableNotes] = useState('');
  const [cableSourceOltId, setCableSourceOltId] = useState<string>('');
  const [cableSourcePonPortId, setCableSourcePonPortId] = useState<string>('');
  const [cableCoresDraft, setCableCoresDraft] = useState<GisCoreEntry[]>([]);

  // Port / Ratio Leg assignment editor state
  const [editingPortNum, setEditingPortNum] = useState<number | null>(null);
  const [portUtilDraft, setPortUtilDraft] = useState<SplitterUtilizationType>('CLIENT_ONT');
  const [subSearch, setSubSearch] = useState('');
  const [selectedSubId, setSelectedSubId] = useState<string>('');
  const [manualClientName, setManualClientName] = useState('');
  const [targetAreaOrNodeDraft, setTargetAreaOrNodeDraft] = useState('');
  const [portDropMeters, setPortDropMeters] = useState<number>(30);
  const [portStatusDraft, setPortStatusDraft] = useState<GisPortStatus>('ACTIVE');

  // Field Triage interactive checklist state
  const [triageChecks, setTriageChecks] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setConfirmDelete(false);
    setEditingPortNum(null);
    setActiveLegEditor(null);
    setSubSearch('');
    setLegSubSearch('');
    setShowAllSpliceCables(false);
    setQuickExtendCoreKey(null);
    setQuickExtendTargetNodeId('');
    setQuickExtendCableCores(2);
    setQuickExtendOutCore(1);
    setLocalSaveError(null);
    if (selectedNode) {
      const spType = (selectedNode.splitter_type ||
        (selectedNode.node_type === 'FDB_FAT' ? '1:8' : 'none')) as GisSplitterType;
      setNodeName(selectedNode.name || '');
      setNodeArea(selectedNode.area_name || '');
      setNodeTxPower(Number(selectedNode.tx_power_dbm ?? 5.0));
      setNodeSplitter(spType);
      setNodeSplitterCat(
        selectedNode.splitter_category || inferSplitterCategory(spType)
      );
      const tPorts = Number(selectedNode.total_ports ?? 8);
      setNodeTotalPorts(tPorts);
      setNodeBoxCapacity(Math.max(Number(selectedNode.box_capacity ?? tPorts), tPorts));
      setNodeFeedCableId(selectedNode.feed_cable_id || '');
      setNodeFeedCore(Number(selectedNode.feed_core_number ?? 1));
      setNodeFeedCorePair(selectedNode.feed_core_pair || '');
      setNodePonPortId(selectedNode.pon_port_id || '');
      const cap = Number(selectedNode.tray_capacity ?? 12);
      setNodeTrayCapacity(cap);
      setNodeLossPerSplice(resolveHopSpliceLoss(selectedNode.loss_per_splice));
      setNodeNotes(selectedNode.notes || '');
      setSpliceTrayDraft(
        Array.isArray(selectedNode.splice_tray_json) && selectedNode.splice_tray_json.length > 0
          ? selectedNode.splice_tray_json
          : generateDefaultSpliceTray(cap)
      );
      setInternalSplittersDraft(
        Array.isArray(selectedNode.internal_splitters)
          ? selectedNode.internal_splitters.map((s) => ({
              ...s,
              legs: buildDefaultLegsForSplitter(s.splitter_type, s.legs),
            }))
          : []
      );
      setCoreSplicesDraft(
        Array.isArray(selectedNode.core_splices) ? selectedNode.core_splices : []
      );
    }
  }, [selectedNode]);

  useEffect(() => {
    setConfirmDelete(false);
    if (selectedCable) {
      setCableName(selectedCable.name || '');
      setCableDistanceMeters(Number(selectedCable.distance_meters || 0));
      setCableNotes(selectedCable.notes || '');
      const resolvedType = cableCoresToType(
        selectedCable.cable_cores,
        selectedCable.cable_type
      );
      const matchedPreset =
        CABLE_CAPACITY_PRESETS.find(
          (p) => p.cores === selectedCable.cable_cores && p.cableType === resolvedType
        ) ||
        CABLE_CAPACITY_PRESETS.find((p) => p.cores === selectedCable.cable_cores) ||
        CABLE_CAPACITY_PRESETS[6];
      setCablePresetId(matchedPreset.id);
      setCableSourceOltId(selectedCable.source_olt_id || '');
      setCableSourcePonPortId(selectedCable.source_pon_port_id || '');
      const rawCores =
        selectedCable.cores_allocation_json && selectedCable.cores_allocation_json.length > 0
          ? selectedCable.cores_allocation_json
          : selectedCable.cores_tia598_json;
      setCableCoresDraft(normalizeCableCores(matchedPreset.cores, rawCores));
    }
  }, [selectedCable]);

  const nodesById = useMemo(() => {
    const map: Record<string, SupabaseGisNode> = {};
    for (const n of nodes) map[n.id] = n;
    return map;
  }, [nodes]);

  const subscribersById = useMemo(() => {
    const map: Record<string, GisSubscriberSummary> = {};
    for (const s of subscribers) map[s.id] = s;
    return map;
  }, [subscribers]);

  const subscribersByUsername = useMemo(() => {
    const map: Record<string, GisSubscriberSummary> = {};
    for (const s of subscribers) map[s.username.toLowerCase()] = s;
    return map;
  }, [subscribers]);

  const connectedCables = useMemo(() => {
    if (!selectedNode) return [];
    return cables.filter(
      (c) => c.source_node_id === selectedNode.id || c.target_node_id === selectedNode.id
    );
  }, [cables, selectedNode]);

  const filteredSubscribers = useMemo(() => {
    const q = subSearch.trim().toLowerCase();
    if (!q) return subscribers.slice(0, 40);
    return subscribers
      .filter(
        (s) =>
          s.username.toLowerCase().includes(q) ||
          s.fullName.toLowerCase().includes(q) ||
          s.phone.toLowerCase().includes(q) ||
          s.area.toLowerCase().includes(q)
      )
      .slice(0, 40);
  }, [subscribers, subSearch]);

  const filteredLegSubscribers = useMemo(() => {
    const q = legSubSearch.trim().toLowerCase();
    if (!q) return subscribers.slice(0, 40);
    return subscribers
      .filter(
        (s) =>
          s.username.toLowerCase().includes(q) ||
          s.fullName.toLowerCase().includes(q) ||
          s.phone.toLowerCase().includes(q) ||
          s.area.toLowerCase().includes(q)
      )
      .slice(0, 40);
  }, [subscribers, legSubSearch]);

  const hasUnsavedOpticalEdits = useMemo(() => {
    if (!selectedNode) return false;
    const savedSplitters = Array.isArray(selectedNode.internal_splitters)
      ? selectedNode.internal_splitters
      : [];
    const savedSplices = Array.isArray(selectedNode.core_splices)
      ? selectedNode.core_splices
      : [];
    return (
      (selectedNode.feed_cable_id || '') !== nodeFeedCableId ||
      Number(selectedNode.feed_core_number ?? 1) !== Number(nodeFeedCore) ||
      (selectedNode.splitter_type || 'none') !== nodeSplitter ||
      (selectedNode.pon_port_id || '') !== nodePonPortId ||
      Number(selectedNode.box_capacity ?? selectedNode.total_ports ?? 8) !== Number(nodeBoxCapacity) ||
      JSON.stringify(savedSplitters) !== JSON.stringify(internalSplittersDraft) ||
      JSON.stringify(savedSplices) !== JSON.stringify(coreSplicesDraft) ||
      Math.abs(resolveHopSpliceLoss(selectedNode.loss_per_splice) - Number(nodeLossPerSplice || DEFAULT_FUSION_SPLICE_LOSS_DB)) > 0.001 ||
      (selectedNode.node_type === 'OLT' && Math.abs(Number(selectedNode.tx_power_dbm ?? 5.0) - Number(nodeTxPower)) > 0.01)
    );
  }, [
    selectedNode,
    nodeFeedCableId,
    nodeFeedCore,
    nodeSplitter,
    nodePonPortId,
    nodeBoxCapacity,
    internalSplittersDraft,
    coreSplicesDraft,
    nodeLossPerSplice,
    nodeTxPower,
  ]);

  const liveDraftBudget = useMemo(() => {
    if (!selectedNode || !hasUnsavedOpticalEdits) return null;
    const patchedNodes = nodes.map((n) =>
      n.id === selectedNode.id
        ? {
            ...n,
            feed_cable_id: nodeFeedCableId || null,
            feed_core_number: Number(nodeFeedCore) || 1,
            pon_port_id: nodePonPortId || null,
            splitter_type: nodeSplitter,
            splitter_category: nodeSplitterCat,
            total_ports: Math.max(Number(nodeTotalPorts) || 0, Number(nodeBoxCapacity) || 0),
            box_capacity: Number(nodeBoxCapacity) || 8,
            internal_splitters: internalSplittersDraft,
            core_splices: coreSplicesDraft,
            loss_per_splice: Number(nodeLossPerSplice) || DEFAULT_FUSION_SPLICE_LOSS_DB,
            tx_power_dbm: Number(nodeTxPower),
          }
        : n
    );
    const liveMap = calculateTopologyOpticalBudgets(patchedNodes, cables, ponPortsById);
    return liveMap[selectedNode.id] || null;
  }, [
    selectedNode,
    hasUnsavedOpticalEdits,
    nodes,
    cables,
    ponPortsById,
    nodeFeedCableId,
    nodeFeedCore,
    nodePonPortId,
    nodeSplitter,
    nodeSplitterCat,
    nodeTotalPorts,
    nodeBoxCapacity,
    internalSplittersDraft,
    coreSplicesDraft,
    nodeLossPerSplice,
    nodeTxPower,
  ]);

  if (!selectedNode && !selectedCable) {
    return null;
  }

  const handleSplitterChange = (nextType: GisSplitterType) => {
    setNodeSplitter(nextType);
    setNodeSplitterCat(inferSplitterCategory(nextType));
    const spec = SPLITTER_SPECS[nextType];
    if (spec) {
      setNodeTotalPorts(spec.defaultPorts);
      setNodeBoxCapacity((prev) => Math.max(prev, spec.defaultPorts));
    }
  };

  const handleSaveNodeClick = async () => {
    if (!selectedNode || localSaving || isSaving) return;
    setLocalSaveError(null);
    setLocalSaving(true);
    try {
      const budgetForSave = liveDraftBudget || budgetsByNodeId[selectedNode.id];
      const evalState = evaluateEnclosureOpticalState({
        node: {
          ...selectedNode,
          internal_splitters: internalSplittersDraft,
          core_splices: coreSplicesDraft,
        },
        arrivalDbmByCoreKey: budgetForSave?.arrivalDbmByCoreKey || {},
        fallbackInputDbm: budgetForSave?.inputDbm ?? null,
      });
      const effectivePorts = Math.max(
        0,
        Math.min(
          48,
          internalSplittersDraft.length > 0
            ? Number(nodeBoxCapacity) || 8
            : Number(nodeTotalPorts) || 0
        )
      );
      await onSaveNode(selectedNode.id, {
        name: nodeName.trim() || selectedNode.name,
        area_name: nodeArea.trim(),
        tx_power_dbm: Number(nodeTxPower),
        splitter_category: nodeSplitterCat,
        splitter_type: nodeSplitter,
        total_ports: effectivePorts,
        box_capacity: Math.max(4, Math.min(48, Number(nodeBoxCapacity) || effectivePorts || 8)),
        internal_splitters: evalState.evaluatedSplitters,
        core_splices: evalState.evaluatedCoreSplices,
        feed_cable_id: nodeFeedCableId || null,
        feed_core_number: Number(nodeFeedCore) || 1,
        feed_core_pair: nodeFeedCorePair.trim(),
        pon_port_id: nodePonPortId || null,
        tray_capacity: Math.max(2, Math.min(48, Number(nodeTrayCapacity) || 12)),
        loss_per_splice: Number(nodeLossPerSplice) || DEFAULT_FUSION_SPLICE_LOSS_DB,
        splice_tray_json: spliceTrayDraft,
        notes: nodeNotes,
      });
    } catch (err: any) {
      setLocalSaveError(err?.message || 'Failed to save node changes to Supabase.');
    } finally {
      setLocalSaving(false);
    }
  };

  const handleTrayCapacityChange = (nextCap: number) => {
    const clamped = Math.max(2, Math.min(48, nextCap));
    setNodeTrayCapacity(clamped);
    setSpliceTrayDraft((prev) => {
      const next: GisSpliceEntry[] = [];
      for (let i = 1; i <= clamped; i++) {
        const existing = prev.find((r) => r.coreIn === i);
        next.push(
          existing || {
            coreIn: i,
            coreOut: i,
            status: 'Straight Splice',
            note: '',
          }
        );
      }
      return next;
    });
  };

  const renderNodeInspector = (node: SupabaseGisNode) => {
    const budget = liveDraftBudget || budgetsByNodeId[node.id];
    const healthStyle = getHealthBadgeColors(budget?.healthBand || 'UNLINKED');
    const healthLabel = getOpticalHealthLabel(budget?.healthBand || 'UNLINKED');
    const nodePorts = portsByNodeId[node.id] || [];
    const nodeOutputs = splitterOutputsByNodeId[node.id] || [];
    const portsByNumber: Record<number, SupabaseGisFdbPort> = {};
    for (const p of nodePorts) portsByNumber[p.port_number] = p;
    const outputsByNumber: Record<number, SupabaseGisSplitterOutput> = {};
    for (const o of nodeOutputs) outputsByNumber[o.port_number] = o;

    const hasMultiSplitters = internalSplittersDraft.length > 0;
    const liveEnclosureEval = evaluateEnclosureOpticalState({
      node: {
        ...node,
        box_capacity: nodeBoxCapacity,
        internal_splitters: internalSplittersDraft,
        core_splices: coreSplicesDraft,
      },
      arrivalDbmByCoreKey: budget?.arrivalDbmByCoreKey || {},
      fallbackInputDbm: budget?.inputDbm ?? null,
    });
    const evaluatedSplitters = liveEnclosureEval.evaluatedSplitters;
    const evaluatedCoreSplices = liveEnclosureEval.evaluatedCoreSplices;

    const currentSplitterSpec = SPLITTER_SPECS[nodeSplitter] || SPLITTER_SPECS['none'];
    const totalAllocatedLegs = evaluatedSplitters.reduce((sum, sp) => sum + sp.legs.length, 0);
    const totalPorts = hasMultiSplitters
      ? Math.max(nodeBoxCapacity, totalAllocatedLegs)
      : currentSplitterSpec.type !== 'none'
      ? currentSplitterSpec.isAsymmetricFbt
        ? 2
        : Math.max(1, Number(nodeBoxCapacity || node.total_ports || currentSplitterSpec.defaultPorts || 8))
      : Math.max(0, Number(nodeBoxCapacity || node.total_ports || 0));

    let usedCount = 0;
    if (hasMultiSplitters) {
      for (const sp of evaluatedSplitters) {
        usedCount += sp.legs.filter((l) => l.status !== 'FREE').length;
      }
    } else {
      for (let i = 1; i <= totalPorts; i++) {
        const out = outputsByNumber[i];
        const fdbP = portsByNumber[i];
        if (out ? out.utilization_type !== 'FREE_PORT' : fdbP && fdbP.status !== 'FREE') {
          usedCount++;
        }
      }
    }
    const freePorts = Math.max(0, totalPorts - usedCount);
    const passThroughCount = evaluatedCoreSplices.filter(
      (sp) => sp.action === 'PASS_THROUGH_JOINT'
    ).length;

    const incomingCoreNum = budget?.incomingCoreNumber || node.feed_core_number || 1;
    const incomingCoreSpec = getTia598Color(incomingCoreNum);
    const incomingTubeSpec = getTia598Color(Math.ceil(incomingCoreNum / 12));
    const fbtLegs = currentSplitterSpec.isAsymmetricFbt
      ? getFbtLegOutputs(budget?.inputDbm ?? null, nodeSplitter, nodeLossPerSplice)
      : null;

    const incomingFeedCableId =
      nodeFeedCableId || budget?.incomingCableId || node.feed_cable_id || '';
    const incomingCablesForBox = connectedCables.filter((c) => {
      if (incomingFeedCableId && c.id === incomingFeedCableId) return true;
      const otherId = c.source_node_id === node.id ? c.target_node_id : c.source_node_id;
      const otherNode = nodesById[otherId];
      if (otherNode?.node_type === 'OLT') return true;
      if (budget?.parentNodeId && otherId === budget.parentNodeId) return true;
      return c.target_node_id === node.id && !evaluatedCoreSplices.some((s) => s.outgoing_cable_id === c.id);
    });
    const normalizedIncomingCables =
      incomingCablesForBox.length > 0 ? incomingCablesForBox : connectedCables.slice(0, 1);
    const outgoingCablesForBox = connectedCables.filter(
      (c) => c.id !== incomingFeedCableId && !normalizedIncomingCables.some((inc) => inc.id === c.id)
    );

    const addInternalSplitterUnit = (seedFromLegacy = false) => {
      const nextNum = internalSplittersDraft.length + 1;
      const defaultId = `SPL-${nextNum}-${Math.random().toString(36).slice(2, 5)}`;
      const chosenType: GisSplitterType = seedFromLegacy
        ? nodeSplitter !== 'none'
          ? nodeSplitter
          : '1:8'
        : nextNum === 1
        ? nodeSplitter !== 'none'
          ? nodeSplitter
          : '1:8'
        : '1:8';
      const defaultCable = incomingFeedCableId || normalizedIncomingCables[0]?.id || null;
      const defaultCore = Number(nodeFeedCore || 1);
      let seededLegs = buildDefaultLegsForSplitter(chosenType, null);
      if (seedFromLegacy) {
        seededLegs = seededLegs.map((leg) => {
          const out = outputsByNumber[leg.legNumber];
          const fp = portsByNumber[leg.legNumber];
          if (out) {
            return {
              ...leg,
              status:
                out.utilization_type === 'CLIENT_ONT'
                  ? 'SUBSCRIBER_DROP'
                  : out.utilization_type === 'FAULTY'
                  ? 'FAULTY'
                  : out.utilization_type === 'DOWNSTREAM_AREA_FEED' ||
                    out.utilization_type === 'CASCADED_SPLITTER'
                  ? 'OUTGOING_CABLE_FEED'
                  : 'FREE',
              subscriber_id: out.subscriber_id || null,
              subscriber_username: out.subscriber_username || '',
              client_label: out.client_name_manual || '',
              target_node_name: out.target_area_or_node || '',
              drop_distance_m: out.drop_distance_m ?? 30,
            };
          }
          if (fp && fp.status !== 'FREE') {
            return {
              ...leg,
              status: fp.status === 'FAULTY' ? 'FAULTY' : 'SUBSCRIBER_DROP',
              subscriber_id: fp.subscriber_id || null,
              subscriber_username: fp.subscriber_username || '',
              client_label: fp.client_label || '',
              drop_distance_m: fp.drop_cable_meters ?? 30,
            };
          }
          return leg;
        });
      }
      const newUnit: InternalSplitterUnit = {
        id: defaultId,
        label: `SPL-${nextNum}`,
        splitter_type: chosenType,
        input_source_type: 'INCOMING_CORE',
        incoming_cable_id: defaultCable,
        incoming_core_number: defaultCore,
        parent_splitter_id: null,
        parent_splitter_leg: null,
        legs: seededLegs,
      };
      setInternalSplittersDraft((prev) => [...prev, newUnit]);
      setNodeBoxCapacity((prev) => Math.max(prev, totalAllocatedLegs + seededLegs.length, 16));
    };

    const allPonPortOptions: SearchableOption[] = [];
    for (const o of olts) {
      const pps = (ponPortsByOltId[o.id] || []).slice().sort((a, b) => a.port_number - b.port_number);
      for (const pp of pps) {
        allPonPortOptions.push({
          value: pp.id,
          label: `${o.name} · PON-${pp.port_number}`,
          sublabel: pp.port_label || 'Main',
          metric: `+${Number(pp.tx_power_dbm).toFixed(1)} dBm`,
          metricTone: 'sky',
          keywords: `${o.name} PON-${pp.port_number} ${pp.port_label || ''}`,
        });
      }
    }

    const connectedCableOptions: SearchableOption[] = connectedCables.map((c) => {
      const otherId = c.source_node_id === node.id ? c.target_node_id : c.source_node_id;
      const otherNode = nodesById[otherId];
      const otherName = otherNode?.name || 'Node';
      const otherBudget = budgetsByNodeId[otherId];
      const otherOutDbm =
        otherNode?.node_type === 'OLT'
          ? otherBudget?.oltTxDbm
          : SPLITTER_SPECS[otherNode?.splitter_type || 'none']?.isAsymmetricFbt
          ? otherBudget?.thruOutputDbm
          : otherBudget?.ontRxDbm ?? otherBudget?.thruOutputDbm;
      return {
        value: c.id,
        label: `From ${otherName}`,
        sublabel: `${c.cable_cores}C · ${c.distance_meters}m${otherNode?.area_name ? ` · ${otherNode.area_name}` : ''}`,
        metric:
          otherOutDbm !== null && otherOutDbm !== undefined
            ? `${otherOutDbm >= 0 ? '+' : ''}${otherOutDbm.toFixed(1)} dBm`
            : undefined,
        metricTone:
          otherNode?.node_type === 'OLT'
            ? 'sky'
            : otherBudget?.healthBand === 'CRITICAL LOS RISK'
            ? 'rose'
            : otherBudget?.healthBand === 'MARGINAL'
            ? 'amber'
            : 'emerald',
        keywords: `${otherName} ${otherNode?.area_name || ''} ${c.name || ''} ${c.cable_cores}C`,
      };
    });

    const destinationNodeOptions: SearchableOption[] = nodes
      .filter((n) => n.id !== node.id && n.node_type !== 'OLT')
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((n) => {
        const b = budgetsByNodeId[n.id];
        const sum = b?.enclosureSummary;
        const spec = SPLITTER_SPECS[n.splitter_type] || SPLITTER_SPECS['none'];
        const tPorts = sum
          ? sum.boxCapacity
          : Math.max(Number(n.box_capacity || 0), Number(n.total_ports || 0), spec.defaultPorts || 0);
        const uPorts = sum
          ? sum.usedPorts
          : (splitterOutputsByNodeId[n.id] || []).filter((o) => o.utilization_type !== 'FREE_PORT').length ||
            (portsByNodeId[n.id] || []).filter((p) => p.status !== 'FREE').length;
        const fPorts = Math.max(0, tPorts - uPorts);
        const dbmVal = b?.ontRxDbm ?? b?.thruOutputDbm ?? b?.inputDbm;
        return {
          value: n.id,
          label: n.name,
          sublabel: `${n.node_type}${n.area_name ? ` · ${n.area_name}` : ''}${
            tPorts > 0 ? ` · ${fPorts}/${tPorts} Free` : ''
          }`,
          metric: dbmVal !== null && dbmVal !== undefined ? `${dbmVal.toFixed(1)} dBm` : 'Unlinked',
          metricTone:
            b?.healthBand === 'IDEAL' || b?.healthBand === 'GOOD'
              ? 'emerald'
              : b?.healthBand === 'MARGINAL'
              ? 'amber'
              : b?.healthBand === 'CRITICAL LOS RISK'
              ? 'rose'
              : 'slate',
          keywords: `${n.name} ${n.area_name || ''} ${n.node_type}`,
        };
      });

    return (
      <div className="flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-slate-800 bg-slate-950/90 flex items-start justify-between gap-2 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] font-mono text-slate-400">
              {node.node_type === 'OLT' ? (
                <Server className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              ) : node.node_type === 'DIST_NODE' ? (
                <Layers className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
              ) : node.node_type === 'FOSC_JOINT' ? (
                <Wrench className="w-3.5 h-3.5 text-purple-400 shrink-0" />
              ) : (
                <Radio className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              )}
              <span className="uppercase tracking-wider font-semibold">
                {getNodeTypeLabel(node.node_type)}
              </span>
              {node.area_name && (
                <>
                  <span>·</span>
                  <span className="text-cyan-400 truncate">{node.area_name}</span>
                </>
              )}
            </div>
            <h3 className="text-sm font-bold text-white truncate mt-0.5">{node.name}</h3>
            <p className="text-[11px] text-slate-400 font-mono tabular-nums mt-0.5">
              {node.lat.toFixed(6)}, {node.lng.toFixed(6)}
            </p>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {node.node_type !== 'OLT' && onOpenTrace && (
              <button
                type="button"
                onClick={() => onOpenTrace(node.id, null)}
                className="min-h-[38px] px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white border border-indigo-400/50 text-[11px] font-mono font-bold flex items-center gap-1 transition cursor-pointer shadow"
                title="Trace End-to-End Optical Path from OLT"
              >
                <GitBranch className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Trace Path</span>
              </button>
            )}
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${node.lat},${node.lng}`}
              target="_blank"
              rel="noopener noreferrer"
              className="min-h-[38px] px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 text-[11px] font-mono font-semibold flex items-center gap-1 transition"
              title="Open GPS Navigation"
            >
              <Navigation className="w-3.5 h-3.5" />
            </a>
            <button
              type="button"
              onClick={onClose}
              className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition cursor-pointer"
              aria-label="Close inspector"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Sub-tabs for FDB_FAT, DIST_NODE, & FOSC_JOINT */}
        {(node.node_type === 'FDB_FAT' ||
          node.node_type === 'DIST_NODE' ||
          node.node_type === 'FOSC_JOINT') && (
          <div className="px-3 pt-2 pb-2 border-b border-slate-800 bg-slate-900/80 grid grid-cols-3 gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setFdbSubTab('ports')}
              className={`min-h-[38px] px-2 py-1.5 rounded-lg text-[11px] font-mono font-bold transition cursor-pointer flex items-center justify-center gap-1 ${
                fdbSubTab === 'ports'
                  ? 'bg-cyan-600 text-slate-950 shadow'
                  : 'bg-slate-950 text-slate-300 border border-slate-800 hover:border-slate-700'
              }`}
            >
              <Users className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">
                {hasMultiSplitters
                  ? `Splitters (${evaluatedSplitters.length})`
                  : totalPorts > 0
                  ? `Ports (${freePorts}/${totalPorts})`
                  : 'Splitters'}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setFdbSubTab('splices')}
              className={`min-h-[38px] px-2 py-1.5 rounded-lg text-[11px] font-mono font-bold transition cursor-pointer flex items-center justify-center gap-1 ${
                fdbSubTab === 'splices'
                  ? 'bg-cyan-600 text-slate-950 shadow'
                  : 'bg-slate-950 text-slate-300 border border-slate-800 hover:border-slate-700'
              }`}
            >
              <Link2 className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">
                Core Splices{passThroughCount > 0 ? ` (${passThroughCount})` : ''}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setFdbSubTab('signal')}
              className={`min-h-[38px] px-2 py-1.5 rounded-lg text-[11px] font-mono font-bold transition cursor-pointer flex items-center justify-center gap-1 ${
                fdbSubTab === 'signal'
                  ? 'bg-cyan-600 text-slate-950 shadow'
                  : 'bg-slate-950 text-slate-300 border border-slate-800 hover:border-slate-700'
              }`}
            >
              <Activity className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Signal &amp; Log</span>
            </button>
          </div>
        )}

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
          {/* TAB 1: Multi-Splitter Enclosure & Outputs */}
          {(node.node_type === 'FDB_FAT' ||
            node.node_type === 'DIST_NODE' ||
            node.node_type === 'FOSC_JOINT') &&
            fdbSubTab === 'ports' && (
            <div className="space-y-3">
              {/* Box Capacity Selector (4 - 48 Ports) & Optical Summary */}
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5 font-mono">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase block">
                      Enclosure Capacity &amp; Splitters
                    </span>
                    <div className="text-xs font-bold text-white tabular-nums mt-0.5">
                      {budget?.oltName ? `${budget.oltName} · ` : ''}
                      <span className={healthStyle.textClass}>
                        {budget?.ontRxDbm !== null && budget?.ontRxDbm !== undefined
                          ? `${budget.ontRxDbm.toFixed(1)} dBm`
                          : 'Unlinked'}
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-slate-400 uppercase block">
                      Ports Used / Cap
                    </span>
                    <span
                      className={`text-sm font-bold tabular-nums ${
                        totalPorts === 0
                          ? 'text-slate-400'
                          : freePorts === 0
                          ? 'text-rose-400'
                          : freePorts <= 2
                          ? 'text-amber-400'
                          : 'text-emerald-400'
                      }`}
                    >
                      {usedCount} / {totalPorts} ({freePorts} Free)
                    </span>
                  </div>
                </div>

                <div>
                  <span className="text-[10px] text-slate-400 block mb-1">
                    Box Port Capacity (Up to 48 Ports)
                  </span>
                  <div className="grid grid-cols-7 gap-1">
                    {FDB_ENCLOSURE_CAPACITIES.map((cap) => (
                      <button
                        key={cap}
                        type="button"
                        onClick={() => {
                          setNodeBoxCapacity(cap);
                          setNodeTotalPorts(cap);
                        }}
                        className={`py-1.5 rounded-lg border text-[11px] font-bold transition cursor-pointer ${
                          nodeBoxCapacity === cap
                            ? 'bg-cyan-600 text-slate-950 border-cyan-300 shadow'
                            : 'bg-slate-900 text-slate-300 border-slate-700 hover:border-slate-500'
                        }`}
                      >
                        {cap}P
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => addInternalSplitterUnit(internalSplittersDraft.length === 0 && nodeSplitter !== 'none')}
                    className="flex-1 min-h-[36px] px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-[11px] flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>
                      {internalSplittersDraft.length === 0 && nodeSplitter !== 'none'
                        ? 'Convert & Add Multi-Splitter Inside FDB'
                        : 'Add Splitter Inside This FDB'}
                    </span>
                  </button>
                  {onRouteCableFromNode && (
                    <button
                      type="button"
                      onClick={() => onRouteCableFromNode(node)}
                      className="min-h-[36px] px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 font-bold text-[11px] flex items-center gap-1 cursor-pointer"
                      title="Draw outgoing fiber cable from this box"
                    >
                      <Cable className="w-3.5 h-3.5" />
                      <span>+ Out Cable</span>
                    </button>
                  )}
                </div>

                {hasMultiSplitters && totalAllocatedLegs > nodeBoxCapacity && (
                  <div className="p-2 rounded-lg bg-amber-950/60 border border-amber-600/70 text-[11px] text-amber-200 flex items-center justify-between gap-2">
                    <span>
                      Total splitter legs ({totalAllocatedLegs}) exceed {nodeBoxCapacity}P box capacity.
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const nextFit = FDB_ENCLOSURE_CAPACITIES.find((c) => c >= totalAllocatedLegs) || 48;
                        setNodeBoxCapacity(nextFit);
                        setNodeTotalPorts(nextFit);
                      }}
                      className="px-2 py-0.5 rounded bg-amber-500 text-slate-950 font-bold text-[10px] shrink-0 cursor-pointer"
                    >
                      Expand to {FDB_ENCLOSURE_CAPACITIES.find((c) => c >= totalAllocatedLegs) || 48}P
                    </button>
                  </div>
                )}
              </div>

              {/* MULTI-SPLITTER UNITS LIST (When 1 or more splitters are added inside this FDB) */}
              {hasMultiSplitters && (
                <div className="space-y-3">
                  {evaluatedSplitters.map((unit, unitIdx) => {
                    const unitUsed = unit.legs.filter((l) => l.status !== 'FREE').length;
                    const unitInDbm = unit.calculated_input_dbm;
                    const unitOutDbm = unit.calculated_output_dbm;
                    const unitHealth =
                      unitOutDbm !== null && unitOutDbm !== undefined
                        ? unitOutDbm >= -22
                          ? 'text-emerald-400'
                          : unitOutDbm >= -25
                          ? 'text-amber-400'
                          : 'text-rose-400'
                        : 'text-slate-400';

                    const siblingSplitters = evaluatedSplitters.filter((s) => s.id !== unit.id);
                    const selectedIncomingCable =
                      connectedCables.find((c) => c.id === unit.incoming_cable_id) ||
                      connectedCables.find((c) => c.id === incomingFeedCableId) ||
                      connectedCables[0];
                    const maxCoresOnSelected = selectedIncomingCable
                      ? Number(selectedIncomingCable.cable_cores || 12)
                      : 12;

                    return (
                      <div
                        key={unit.id}
                        className="rounded-xl border border-cyan-800/60 bg-slate-950/95 p-3 space-y-2.5"
                      >
                        {/* Splitter Header Controls */}
                        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="px-2 py-0.5 rounded bg-cyan-950 border border-cyan-700/70 text-cyan-300 font-mono font-bold text-[11px]">
                              #{unitIdx + 1}
                            </span>
                            <input
                              type="text"
                              value={unit.label}
                              onChange={(e) => {
                                const label = e.target.value;
                                setInternalSplittersDraft((prev) =>
                                  prev.map((s) => (s.id === unit.id ? { ...s, label } : s))
                                );
                              }}
                              className="w-24 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs font-mono font-bold text-white"
                            />
                            <select
                              value={unit.splitter_type}
                              onChange={(e) => {
                                const nextSp = e.target.value as GisSplitterType;
                                setInternalSplittersDraft((prev) =>
                                  prev.map((s) =>
                                    s.id === unit.id
                                      ? {
                                          ...s,
                                          splitter_type: nextSp,
                                          legs: buildDefaultLegsForSplitter(nextSp, s.legs),
                                        }
                                      : s
                                  )
                                );
                              }}
                              className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs font-mono text-white"
                            >
                              {(Object.keys(SPLITTER_SPECS) as GisSplitterType[])
                                .filter((k) => k !== 'none')
                                .map((k) => (
                                  <option key={k} value={k}>
                                    {k} ({SPLITTER_SPECS[k].isAsymmetricFbt ? 'FBT' : `-${SPLITTER_SPECS[k].dropLossDb}dB`})
                                  </option>
                                ))}
                            </select>
                          </div>

                          <div className="flex items-center gap-2 font-mono text-[11px]">
                            <span className="text-slate-400">
                              {unitUsed}/{unit.legs.length} Used
                            </span>
                            <span className={`font-bold tabular-nums ${unitHealth}`}>
                              {unitInDbm !== null && unitInDbm !== undefined
                                ? `${unitInDbm.toFixed(1)} → `
                                : ''}
                              {unitOutDbm !== null && unitOutDbm !== undefined
                                ? `${unitOutDbm.toFixed(1)} dBm`
                                : 'Unlinked'}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setInternalSplittersDraft((prev) =>
                                  prev.filter((s) => s.id !== unit.id)
                                );
                              }}
                              className="p-1 rounded bg-slate-900 hover:bg-rose-950 text-rose-400 border border-slate-800 cursor-pointer"
                              title="Remove this internal splitter"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Splitter Signal Input Source (Incoming Core OR Internal Cascade) */}
                        <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 space-y-2 font-mono text-[11px]">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] uppercase text-cyan-300 font-bold flex items-center gap-1">
                              <Sliders className="w-3 h-3" />
                              Splitter Input Source
                            </span>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() =>
                                  setInternalSplittersDraft((prev) =>
                                    prev.map((s) =>
                                      s.id === unit.id
                                        ? {
                                            ...s,
                                            input_source_type: 'INCOMING_CORE' as InternalSplitterInputType,
                                            incoming_cable_id:
                                              s.incoming_cable_id ||
                                              incomingFeedCableId ||
                                              connectedCables[0]?.id ||
                                              null,
                                            incoming_core_number: s.incoming_core_number || 1,
                                          }
                                        : s
                                    )
                                  )
                                }
                                className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer ${
                                  unit.input_source_type !== 'INTERNAL_SPLITTER_LEG'
                                    ? 'bg-cyan-600 text-slate-950'
                                    : 'bg-slate-950 text-slate-300 border border-slate-700'
                                }`}
                              >
                                Incoming Core
                              </button>
                              <button
                                type="button"
                                disabled={siblingSplitters.length === 0}
                                onClick={() =>
                                  setInternalSplittersDraft((prev) =>
                                    prev.map((s) =>
                                      s.id === unit.id
                                        ? {
                                            ...s,
                                            input_source_type: 'INTERNAL_SPLITTER_LEG' as InternalSplitterInputType,
                                            parent_splitter_id:
                                              s.parent_splitter_id || siblingSplitters[0]?.id || null,
                                            parent_splitter_leg: s.parent_splitter_leg || 1,
                                          }
                                        : s
                                    )
                                  )
                                }
                                className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer disabled:opacity-40 ${
                                  unit.input_source_type === 'INTERNAL_SPLITTER_LEG'
                                    ? 'bg-indigo-500 text-white'
                                    : 'bg-slate-950 text-slate-300 border border-slate-700'
                                }`}
                              >
                                Cascade From Splitter
                              </button>
                            </div>
                          </div>

                          {unit.input_source_type === 'INTERNAL_SPLITTER_LEG' ? (
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="block text-[9px] text-slate-400 mb-0.5">
                                  Parent Splitter (Same Box)
                                </label>
                                <select
                                  value={unit.parent_splitter_id || ''}
                                  onChange={(e) => {
                                    const pId = e.target.value;
                                    setInternalSplittersDraft((prev) =>
                                      prev.map((s) =>
                                        s.id === unit.id
                                          ? { ...s, parent_splitter_id: pId || null }
                                          : s
                                      )
                                    );
                                  }}
                                  className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-[11px] text-white"
                                >
                                  <option value="">Select Splitter...</option>
                                  {siblingSplitters.map((sib) => (
                                    <option key={sib.id} value={sib.id}>
                                      {sib.label} ({sib.splitter_type} · Out{' '}
                                      {sib.calculated_output_dbm !== null &&
                                      sib.calculated_output_dbm !== undefined
                                        ? `${sib.calculated_output_dbm.toFixed(1)}dBm`
                                        : '—'}
                                      )
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label className="block text-[9px] text-slate-400 mb-0.5">
                                  Parent Splitter Leg #
                                </label>
                                <select
                                  value={unit.parent_splitter_leg || 1}
                                  onChange={(e) => {
                                    const legN = Number(e.target.value);
                                    setInternalSplittersDraft((prev) =>
                                      prev.map((s) =>
                                        s.id === unit.id ? { ...s, parent_splitter_leg: legN } : s
                                      )
                                    );
                                  }}
                                  className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-[11px] text-white"
                                >
                                  {(
                                    siblingSplitters.find((sib) => sib.id === unit.parent_splitter_id)
                                      ?.legs || Array.from({ length: 8 }, (_, idx) => ({ legNumber: idx + 1, legLabel: `Leg ${idx + 1}` }))
                                  ).map((lg) => (
                                    <option key={lg.legNumber} value={lg.legNumber}>
                                      {lg.legLabel}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>
                          ) : (
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="block text-[9px] text-slate-400 mb-0.5">
                                  Incoming Cable
                                </label>
                                <SearchableCombobox
                                  compact
                                  value={unit.incoming_cable_id || ''}
                                  options={connectedCableOptions}
                                  onChange={(cId) => {
                                    setInternalSplittersDraft((prev) =>
                                      prev.map((s) =>
                                        s.id === unit.id
                                          ? { ...s, incoming_cable_id: cId || null }
                                          : s
                                      )
                                    );
                                  }}
                                  emptyOptionLabel="Auto Box Feed"
                                  searchPlaceholder="Search cable or node..."
                                  accentColor="cyan"
                                  ariaLabel="Splitter incoming cable"
                                />
                              </div>
                              <div>
                                <label className="block text-[9px] text-slate-400 mb-0.5">
                                  Feed Core #
                                </label>
                                <select
                                  value={unit.incoming_core_number || 1}
                                  onChange={(e) => {
                                    const cNum = Number(e.target.value);
                                    setInternalSplittersDraft((prev) =>
                                      prev.map((s) =>
                                        s.id === unit.id
                                          ? { ...s, incoming_core_number: cNum }
                                          : s
                                      )
                                    );
                                  }}
                                  className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-[11px] text-white"
                                >
                                  {Array.from({ length: maxCoresOnSelected }, (_, idx) => idx + 1).map(
                                    (cNum) => {
                                      const arrivalVal = selectedIncomingCable
                                        ? budget?.arrivalDbmByCoreKey?.[
                                            `${selectedIncomingCable.id}:${cNum}`
                                          ]
                                        : undefined;
                                      return (
                                        <option key={cNum} value={cNum}>
                                          Core #{cNum} ({getTia598Color(cNum).name})
                                          {arrivalVal !== undefined
                                            ? ` · ${arrivalVal.toFixed(1)}dBm`
                                            : ''}
                                        </option>
                                      );
                                    }
                                  )}
                                </select>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Individual Output Legs inside this splitter */}
                        <div className="space-y-1.5">
                          {unit.legs.map((leg) => {
                            const isLegEditing =
                              activeLegEditor?.splitterId === unit.id &&
                              activeLegEditor?.legNumber === leg.legNumber;
                            const legOutDbm = leg.calculated_output_dbm;
                            const linkedSub =
                              (leg.subscriber_id && subscribersById[leg.subscriber_id]) ||
                              (leg.subscriber_username &&
                                subscribersByUsername[leg.subscriber_username.toLowerCase()]) ||
                              null;
                            const targetSplitter = leg.target_splitter_id
                              ? evaluatedSplitters.find((s) => s.id === leg.target_splitter_id)
                              : undefined;
                            const targetCable = leg.target_cable_id
                              ? cables.find((c) => c.id === leg.target_cable_id)
                              : undefined;

                            return (
                              <div
                                key={leg.legNumber}
                                className={`rounded-lg border p-2 transition ${
                                  leg.status === 'FAULTY'
                                    ? 'bg-rose-950/30 border-rose-800/70'
                                    : leg.status === 'INTERNAL_CASCADE'
                                    ? 'bg-indigo-950/40 border-indigo-700/70'
                                    : leg.status === 'OUTGOING_CABLE_FEED'
                                    ? 'bg-amber-950/30 border-amber-700/70'
                                    : leg.status === 'SUBSCRIBER_DROP'
                                    ? 'bg-slate-900 border-emerald-800/60'
                                    : 'bg-slate-900/50 border-slate-800 border-dashed'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className="font-bold text-white">{leg.legLabel}</span>
                                      {legOutDbm !== null && legOutDbm !== undefined && (
                                        <span className="text-[10px] text-cyan-300 font-bold tabular-nums">
                                          ({legOutDbm.toFixed(1)} dBm)
                                        </span>
                                      )}
                                      <span
                                        className={`text-[10px] font-bold ${
                                          leg.status === 'FREE'
                                            ? 'text-emerald-400'
                                            : leg.status === 'FAULTY'
                                            ? 'text-rose-400'
                                            : leg.status === 'INTERNAL_CASCADE'
                                            ? 'text-indigo-300'
                                            : leg.status === 'OUTGOING_CABLE_FEED'
                                            ? 'text-amber-300'
                                            : 'text-cyan-300'
                                        }`}
                                      >
                                        · {leg.status.replace(/_/g, ' ')}
                                      </span>
                                    </div>
                                    <div className="text-[10px] text-slate-300 truncate mt-0.5">
                                      {leg.status === 'SUBSCRIBER_DROP'
                                        ? linkedSub
                                          ? `${linkedSub.fullName} (@${linkedSub.username}) · Drop ${leg.drop_distance_m || 30}m`
                                          : leg.client_label || leg.subscriber_username || 'Subscriber ONT'
                                        : leg.status === 'INTERNAL_CASCADE'
                                        ? `Feeds ${targetSplitter?.label || 'Internal Splitter'}`
                                        : leg.status === 'OUTGOING_CABLE_FEED'
                                        ? `Feeds ${targetCable?.name || 'Outgoing Cable'} Core #${leg.target_core_number || 1}`
                                        : leg.status === 'FAULTY'
                                        ? 'Damaged / High loss leg'
                                        : 'Available spare leg'}
                                    </div>
                                  </div>

                                  <button
                                    type="button"
                                    onClick={() => {
                                      setLegSubSearch('');
                                      setActiveLegEditor(
                                        isLegEditing
                                          ? null
                                          : { splitterId: unit.id, legNumber: leg.legNumber }
                                      );
                                    }}
                                    className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 text-[10px] font-bold shrink-0 cursor-pointer"
                                  >
                                    {isLegEditing ? 'Close' : leg.status === 'FREE' ? 'Assign' : 'Edit'}
                                  </button>
                                </div>

                                {isLegEditing && (
                                  <div className="mt-2 pt-2 border-t border-slate-800 space-y-2 text-[11px]">
                                    <select
                                      value={leg.status}
                                      onChange={(e) => {
                                        const nextSt = e.target.value as InternalSplitterLegStatus;
                                        setInternalSplittersDraft((prev) =>
                                          prev.map((s) =>
                                            s.id === unit.id
                                              ? {
                                                  ...s,
                                                  legs: s.legs.map((l) =>
                                                    l.legNumber === leg.legNumber
                                                      ? { ...l, status: nextSt }
                                                      : l
                                                  ),
                                                }
                                              : s
                                          )
                                        );
                                      }}
                                      className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-white font-mono"
                                    >
                                      <option value="FREE">Free / Spare Leg</option>
                                      <option value="SUBSCRIBER_DROP">Subscriber ONT Drop</option>
                                      <option value="INTERNAL_CASCADE">
                                        Cascade Into Another Splitter (Same FDB)
                                      </option>
                                      <option value="OUTGOING_CABLE_FEED">
                                        Feed Outgoing Cable Core
                                      </option>
                                      <option value="FAULTY">Faulty / Damaged</option>
                                    </select>

                                    {leg.status === 'SUBSCRIBER_DROP' && (
                                      <div className="space-y-1.5">
                                        <div className="relative">
                                          <Search className="w-3 h-3 text-slate-500 absolute left-2 top-2" />
                                          <input
                                            type="text"
                                            value={legSubSearch}
                                            onChange={(e) => setLegSubSearch(e.target.value)}
                                            placeholder="Search subscriber name / username..."
                                            className="w-full bg-slate-950 border border-slate-700 rounded pl-7 pr-2 py-1 text-white"
                                          />
                                        </div>
                                        <div className="max-h-28 overflow-y-auto rounded border border-slate-800 bg-slate-950 divide-y divide-slate-800">
                                          {filteredLegSubscribers.map((sub) => (
                                            <button
                                              key={sub.id}
                                              type="button"
                                              onClick={() => {
                                                setInternalSplittersDraft((prev) =>
                                                  prev.map((s) =>
                                                    s.id === unit.id
                                                      ? {
                                                          ...s,
                                                          legs: s.legs.map((l) =>
                                                            l.legNumber === leg.legNumber
                                                              ? {
                                                                  ...l,
                                                                  subscriber_id: sub.id,
                                                                  subscriber_username: sub.username,
                                                                  client_label: `${sub.fullName} (@${sub.username})`,
                                                                }
                                                              : l
                                                          ),
                                                        }
                                                      : s
                                                  )
                                                );
                                              }}
                                              className={`w-full text-left px-2 py-1 flex items-center justify-between text-[10px] cursor-pointer ${
                                                leg.subscriber_id === sub.id
                                                  ? 'bg-cyan-950 text-cyan-200'
                                                  : 'hover:bg-slate-800 text-slate-200'
                                              }`}
                                            >
                                              <span className="truncate">
                                                {sub.fullName} (@{sub.username})
                                              </span>
                                              <span
                                                className={`w-2 h-2 rounded-full shrink-0 ${
                                                  sub.isOnline ? 'bg-emerald-400' : 'bg-rose-500'
                                                }`}
                                              />
                                            </button>
                                          ))}
                                        </div>
                                        <div className="grid grid-cols-2 gap-1.5">
                                          <input
                                            type="text"
                                            value={leg.client_label || ''}
                                            onChange={(e) => {
                                              const val = e.target.value;
                                              setInternalSplittersDraft((prev) =>
                                                prev.map((s) =>
                                                  s.id === unit.id
                                                    ? {
                                                        ...s,
                                                        legs: s.legs.map((l) =>
                                                          l.legNumber === leg.legNumber
                                                            ? { ...l, client_label: val }
                                                            : l
                                                        ),
                                                      }
                                                    : s
                                                )
                                              );
                                            }}
                                            placeholder="Manual label / House #"
                                            className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-white"
                                          />
                                          <input
                                            type="number"
                                            min={0}
                                            max={3000}
                                            value={leg.drop_distance_m ?? 30}
                                            onChange={(e) => {
                                              const dist = Number(e.target.value);
                                              setInternalSplittersDraft((prev) =>
                                                prev.map((s) =>
                                                  s.id === unit.id
                                                    ? {
                                                        ...s,
                                                        legs: s.legs.map((l) =>
                                                          l.legNumber === leg.legNumber
                                                            ? { ...l, drop_distance_m: dist }
                                                            : l
                                                        ),
                                                      }
                                                    : s
                                                )
                                              );
                                            }}
                                            placeholder="Drop (m)"
                                            className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-white font-mono"
                                          />
                                        </div>
                                      </div>
                                    )}

                                    {leg.status === 'INTERNAL_CASCADE' && (
                                      <div>
                                        <label className="block text-[9px] text-indigo-300 mb-0.5">
                                          Target Internal Splitter in This FDB
                                        </label>
                                        <select
                                          value={leg.target_splitter_id || ''}
                                          onChange={(e) => {
                                            const tSplId = e.target.value || null;
                                            setInternalSplittersDraft((prev) =>
                                              prev.map((s) => {
                                                if (s.id === unit.id) {
                                                  return {
                                                    ...s,
                                                    legs: s.legs.map((l) =>
                                                      l.legNumber === leg.legNumber
                                                        ? { ...l, target_splitter_id: tSplId }
                                                        : l
                                                    ),
                                                  };
                                                }
                                                if (tSplId && s.id === tSplId) {
                                                  return {
                                                    ...s,
                                                    input_source_type: 'INTERNAL_SPLITTER_LEG',
                                                    parent_splitter_id: unit.id,
                                                    parent_splitter_leg: leg.legNumber,
                                                  };
                                                }
                                                return s;
                                              })
                                            );
                                          }}
                                          className="w-full bg-slate-950 border border-indigo-700 rounded px-2 py-1.5 text-white font-mono"
                                        >
                                          <option value="">Select Splitter Inside This Box...</option>
                                          {siblingSplitters.map((sib) => (
                                            <option key={sib.id} value={sib.id}>
                                              {sib.label} ({sib.splitter_type})
                                            </option>
                                          ))}
                                        </select>
                                      </div>
                                    )}

                                    {leg.status === 'OUTGOING_CABLE_FEED' && (
                                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 font-mono">
                                        <div className="sm:col-span-2">
                                          <SearchableCombobox
                                            compact
                                            value={leg.target_cable_id || ''}
                                            options={connectedCables.map((c) => {
                                              const oId =
                                                c.source_node_id === node.id
                                                  ? c.target_node_id
                                                  : c.source_node_id;
                                              const oNode = nodesById[oId];
                                              return {
                                                value: c.id,
                                                label: `To ${oNode?.name || 'Node'}`,
                                                sublabel: `${c.cable_cores}C · ${c.distance_meters}m${
                                                  oNode?.area_name ? ` · ${oNode.area_name}` : ''
                                                }`,
                                                keywords: `${oNode?.name || ''} ${oNode?.area_name || ''} ${c.name || ''}`,
                                              };
                                            })}
                                            onChange={(cId) => {
                                              setInternalSplittersDraft((prev) =>
                                                prev.map((s) =>
                                                  s.id === unit.id
                                                    ? {
                                                        ...s,
                                                        legs: s.legs.map((l) =>
                                                          l.legNumber === leg.legNumber
                                                            ? { ...l, target_cable_id: cId || null }
                                                            : l
                                                        ),
                                                      }
                                                    : s
                                                )
                                              );
                                            }}
                                            emptyOptionLabel="Outgoing Cable..."
                                            searchPlaceholder="Search outgoing cable..."
                                            accentColor="amber"
                                            ariaLabel="Outgoing cable"
                                          />
                                        </div>
                                        <select
                                          value={leg.target_core_number || 1}
                                          onChange={(e) => {
                                            const cN = Number(e.target.value);
                                            setInternalSplittersDraft((prev) =>
                                              prev.map((s) =>
                                                s.id === unit.id
                                                  ? {
                                                      ...s,
                                                      legs: s.legs.map((l) =>
                                                        l.legNumber === leg.legNumber
                                                          ? { ...l, target_core_number: cN }
                                                          : l
                                                      ),
                                                    }
                                                  : s
                                              )
                                            );
                                          }}
                                          className="bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-white"
                                        >
                                          {Array.from(
                                            { length: Number(targetCable?.cable_cores || 12) },
                                            (_, idx) => idx + 1
                                          ).map((cN) => (
                                            <option key={cN} value={cN}>
                                              Core #{cN} ({getTia598Color(cN).name})
                                            </option>
                                          ))}
                                        </select>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Asymmetric FBT Leg Signal Preview (Single-Splitter Fallback Mode) */}
              {!hasMultiSplitters && fbtLegs && (
                <div className="p-3 rounded-xl bg-indigo-950/40 border border-indigo-700/60 space-y-1.5 font-mono">
                  <div className="flex items-center justify-between text-[11px] font-bold text-indigo-300">
                    <span>FBT Asymmetric Ratio Outputs ({nodeSplitter})</span>
                    {onInitializeSplitterOutputs && (
                      <button
                        type="button"
                        disabled={isSaving}
                        onClick={() =>
                          onInitializeSplitterOutputs({
                            node,
                            splitterType: nodeSplitter,
                            totalPorts: 2,
                            inputDbm: budget?.inputDbm ?? null,
                          })
                        }
                        className="px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] cursor-pointer"
                      >
                        Sync Ratio Legs
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div className="p-2 rounded bg-slate-950/80 border border-slate-800">
                      <span className="text-[10px] text-slate-400 block">
                        Drop ({fbtLegs.dropPercent}% · -{fbtLegs.dropLossDb}dB)
                      </span>
                      <span className="text-emerald-300 font-bold tabular-nums">
                        {fbtLegs.dropOutputDbm !== null ? `${fbtLegs.dropOutputDbm.toFixed(2)} dBm` : '—'}
                      </span>
                    </div>
                    <div className="p-2 rounded bg-slate-950/80 border border-slate-800">
                      <span className="text-[10px] text-slate-400 block">
                        Through ({fbtLegs.thruPercent}% · -{fbtLegs.thruLossDb}dB)
                      </span>
                      <span className="text-sky-300 font-bold tabular-nums">
                        {fbtLegs.thruOutputDbm !== null ? `${fbtLegs.thruOutputDbm.toFixed(2)} dBm` : '—'}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Legacy Single-Splitter Port Cards (Shown when multi-splitter array is empty) */}
              {!hasMultiSplitters && totalPorts === 0 ? (
                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-slate-400 text-center">
                  No splitter ports configured yet. Click <strong>&ldquo;Add Splitter Inside This FDB&rdquo;</strong> above or select a splitter ratio in Hardware Properties.
                </div>
              ) : !hasMultiSplitters && (
                <div className="space-y-2">
                  {Array.from({ length: totalPorts }, (_, i) => i + 1).map((portNum) => {
                    const out = outputsByNumber[portNum];
                    const port = portsByNumber[portNum];
                    const util: SplitterUtilizationType = out
                      ? out.utilization_type
                      : port?.status === 'FAULTY'
                      ? 'FAULTY'
                      : port?.status === 'ACTIVE'
                      ? 'CLIENT_ONT'
                      : 'FREE_PORT';

                    const linkedSub =
                      (out?.subscriber_id && subscribersById[out.subscriber_id]) ||
                      (out?.subscriber_username &&
                        subscribersByUsername[out.subscriber_username.toLowerCase()]) ||
                      (port?.subscriber_id && subscribersById[port.subscriber_id]) ||
                      (port?.subscriber_username &&
                        subscribersByUsername[port.subscriber_username.toLowerCase()]) ||
                      null;

                    const isEditing = editingPortNum === portNum;
                    const legLabel =
                      out?.leg_label ||
                      (fbtLegs
                        ? portNum === 1
                          ? `Leg 1 · Drop (${fbtLegs.dropPercent}%)`
                          : `Leg 2 · Through (${fbtLegs.thruPercent}%)`
                        : `Port ${portNum}`);
                    const estDbm =
                      out?.estimated_rx_dbm !== null && out?.estimated_rx_dbm !== undefined
                        ? Number(out.estimated_rx_dbm)
                        : fbtLegs
                        ? portNum === 1
                          ? fbtLegs.dropOutputDbm
                          : fbtLegs.thruOutputDbm
                        : budget?.ontRxDbm ?? null;

                    const displayDistance = out?.drop_distance_m ?? port?.drop_cable_meters ?? 0;
                    const displayManualName = out?.client_name_manual || port?.client_label || '';
                    const displayAreaOrNode = out?.target_area_or_node || '';

                    return (
                      <div
                        key={portNum}
                        className={`rounded-xl border p-3 transition ${
                          util === 'FAULTY'
                            ? 'bg-rose-950/30 border-rose-800/70'
                            : util === 'FREE_PORT'
                            ? 'bg-slate-900/60 border-slate-800/70 border-dashed'
                            : util === 'DOWNSTREAM_AREA_FEED' || util === 'CASCADED_SPLITTER'
                            ? 'bg-indigo-950/35 border-indigo-800/70'
                            : 'bg-slate-950/90 border-slate-800'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap font-mono">
                              <span className="text-xs font-bold text-white tabular-nums">
                                {legLabel}
                              </span>
                              {estDbm !== null && (
                                <span className="text-[10px] text-cyan-300 font-bold tabular-nums">
                                  ({estDbm >= 0 ? '+' : ''}
                                  {estDbm.toFixed(1)} dBm)
                                </span>
                              )}
                              <span className="text-slate-600">·</span>
                              {util === 'CLIENT_ONT' && linkedSub ? (
                                <span className="flex items-center gap-1.5 text-[11px]">
                                  <span
                                    className={`w-2 h-2 rounded-full ${
                                      linkedSub.isOnline
                                        ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)]'
                                        : 'bg-rose-500'
                                    }`}
                                  />
                                  <span
                                    className={
                                      linkedSub.isOnline
                                        ? 'text-emerald-400 font-bold'
                                        : 'text-rose-400 font-bold'
                                    }
                                  >
                                    {linkedSub.isOnline ? 'ONLINE' : 'OFFLINE'}
                                  </span>
                                </span>
                              ) : (
                                <span
                                  className={`text-[10px] font-bold ${
                                    util === 'FAULTY'
                                      ? 'text-rose-400'
                                      : util === 'FREE_PORT'
                                      ? 'text-emerald-400'
                                      : util === 'DOWNSTREAM_AREA_FEED'
                                      ? 'text-indigo-300'
                                      : util === 'CASCADED_SPLITTER'
                                      ? 'text-purple-300'
                                      : 'text-cyan-400'
                                  }`}
                                >
                                  {util === 'DOWNSTREAM_AREA_FEED'
                                    ? 'NEXT AREA FEED'
                                    : util === 'CASCADED_SPLITTER'
                                    ? 'CASCADED SPLITTER'
                                    : util === 'CLIENT_ONT'
                                    ? 'SUBSCRIBER'
                                    : util}
                                </span>
                              )}
                            </div>

                            {util === 'CLIENT_ONT' && linkedSub ? (
                              <div className="mt-1 space-y-0.5">
                                <div className="text-xs font-semibold text-white">
                                  {linkedSub.fullName}{' '}
                                  <span className="text-cyan-400 font-mono font-normal">
                                    @{linkedSub.username}
                                  </span>
                                </div>
                                <div className="text-[11px] text-slate-400 font-mono">
                                  {linkedSub.packageSpeed} · Drop {displayDistance}m
                                  {linkedSub.activeIp ? ` · ${linkedSub.activeIp}` : ''}
                                </div>
                                {linkedSub.phone && (
                                  <a
                                    href={`tel:${linkedSub.phone.replace(/\s+/g, '')}`}
                                    className="inline-flex items-center gap-1 text-[11px] text-cyan-300 hover:text-cyan-200 font-mono mt-0.5"
                                  >
                                    <Phone className="w-3 h-3" />
                                    <span>{linkedSub.phone}</span>
                                  </a>
                                )}
                              </div>
                            ) : util === 'CLIENT_ONT' && displayManualName ? (
                              <div className="mt-1 text-xs text-slate-200">
                                {displayManualName}{' '}
                                <span className="text-slate-400 font-mono">· {displayDistance}m</span>
                              </div>
                            ) : (util === 'DOWNSTREAM_AREA_FEED' || util === 'CASCADED_SPLITTER') &&
                              displayAreaOrNode ? (
                              <div className="mt-1 text-xs text-indigo-200 font-mono">
                                To: <strong>{displayAreaOrNode}</strong>
                                {displayDistance > 0 ? ` · ${displayDistance}m span` : ''}
                              </div>
                            ) : (
                              <div className="mt-1 text-[11px] text-slate-500">
                                {util === 'FREE_PORT'
                                  ? 'Available for subscriber ONT or downstream feed'
                                  : 'Click Assign to bind subscriber or downstream branch'}
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            {onOpenTrace && (
                              <button
                                type="button"
                                onClick={() =>
                                  onOpenTrace(node.id, {
                                    id: out?.id || `port-${portNum}`,
                                    node_id: node.id,
                                    port_number: portNum,
                                    leg_label: legLabel,
                                    utilization_type: util,
                                    subscriber_id: linkedSub?.id || out?.subscriber_id || null,
                                    subscriber_username:
                                      linkedSub?.username || out?.subscriber_username || '',
                                    client_name_manual: displayManualName,
                                    target_area_or_node: displayAreaOrNode,
                                    drop_distance_m: displayDistance,
                                    estimated_rx_dbm: estDbm,
                                  })
                                }
                                className="min-h-[34px] px-2 py-1 rounded-lg bg-indigo-950/90 hover:bg-indigo-800 text-indigo-200 border border-indigo-700/70 text-[10px] font-mono font-bold cursor-pointer"
                                title="Trace Optical Path to this port"
                              >
                                Trace
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                if (isEditing) {
                                  setEditingPortNum(null);
                                } else {
                                  setEditingPortNum(portNum);
                                  setPortUtilDraft(util === 'FREE_PORT' ? 'CLIENT_ONT' : util);
                                  setSelectedSubId(out?.subscriber_id || port?.subscriber_id || linkedSub?.id || '');
                                  setManualClientName(out?.client_name_manual || port?.client_label || '');
                                  setTargetAreaOrNodeDraft(out?.target_area_or_node || '');
                                  setPortDropMeters(Number(displayDistance || 30));
                                  setPortStatusDraft(port?.status || 'ACTIVE');
                                  setSubSearch('');
                                }
                              }}
                              className="min-h-[34px] px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 text-[11px] font-mono font-semibold flex items-center gap-1 cursor-pointer"
                            >
                              <UserPlus className="w-3 h-3" />
                              <span>{isEditing ? 'Close' : util === 'FREE_PORT' ? 'Assign' : 'Edit'}</span>
                            </button>
                          </div>
                        </div>

                        {isEditing && (
                          <div className="mt-3 pt-3 border-t border-slate-800 space-y-2.5">
                            <div>
                              <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1">
                                Output Assignment Mode
                              </label>
                              <select
                                value={portUtilDraft}
                                onChange={(e) => {
                                  const nextU = e.target.value as SplitterUtilizationType;
                                  setPortUtilDraft(nextU);
                                  setPortStatusDraft(
                                    nextU === 'FREE_PORT'
                                      ? 'FREE'
                                      : nextU === 'FAULTY'
                                      ? 'FAULTY'
                                      : 'ACTIVE'
                                  );
                                }}
                                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono"
                              >
                                <option value="CLIENT_ONT">Subscriber ONT (PPPoE Client)</option>
                                <option value="DOWNSTREAM_AREA_FEED">Downstream Area / Trunk Feed</option>
                                <option value="CASCADED_SPLITTER">Cascaded Secondary Splitter</option>
                                <option value="FREE_PORT">Free / Spare Port</option>
                                <option value="FAULTY">Faulty / Damaged Port</option>
                              </select>
                            </div>

                            {portUtilDraft === 'CLIENT_ONT' && (
                              <>
                                <div>
                                  <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1">
                                    Search Live Subscriber (Name / PPPoE / Phone)
                                  </label>
                                  <div className="relative">
                                    <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
                                    <input
                                      type="text"
                                      value={subSearch}
                                      onChange={(e) => setSubSearch(e.target.value)}
                                      placeholder="Type username, name, or phone..."
                                      className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-8 pr-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                                    />
                                  </div>
                                </div>

                                <div className="max-h-32 overflow-y-auto rounded-lg border border-slate-800 bg-slate-900 divide-y divide-slate-800/80">
                                  {filteredSubscribers.length === 0 ? (
                                    <div className="p-2 text-[11px] text-slate-500 text-center">
                                      No matching subscribers found
                                    </div>
                                  ) : (
                                    filteredSubscribers.map((sub) => {
                                      const picked = selectedSubId === sub.id;
                                      return (
                                        <button
                                          key={sub.id}
                                          type="button"
                                          onClick={() => {
                                            setSelectedSubId(sub.id);
                                            setManualClientName(`${sub.fullName} (@${sub.username})`);
                                            setPortStatusDraft('ACTIVE');
                                          }}
                                          className={`w-full text-left px-2.5 py-1.5 flex items-center justify-between gap-2 text-[11px] transition cursor-pointer ${
                                            picked
                                              ? 'bg-cyan-950/80 text-cyan-200'
                                              : 'hover:bg-slate-800/80 text-slate-200'
                                          }`}
                                        >
                                          <div className="min-w-0">
                                            <div className="font-semibold truncate">
                                              {sub.fullName}{' '}
                                              <span className="font-mono text-cyan-400">@{sub.username}</span>
                                            </div>
                                            <div className="text-[10px] text-slate-400 font-mono truncate">
                                              {sub.packageSpeed} · {sub.phone || 'No phone'}
                                            </div>
                                          </div>
                                          <span
                                            className={`w-2 h-2 rounded-full shrink-0 ${
                                              sub.isOnline ? 'bg-emerald-400' : 'bg-rose-500'
                                            }`}
                                          />
                                        </button>
                                      );
                                    })
                                  )}
                                </div>

                                <div>
                                  <label className="block text-[10px] font-mono text-slate-400 mb-1">
                                    Or Manual Subscriber Label (Optional)
                                  </label>
                                  <input
                                    type="text"
                                    value={manualClientName}
                                    onChange={(e) => setManualClientName(e.target.value)}
                                    placeholder="House # / Custom customer name..."
                                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                                  />
                                </div>
                              </>
                            )}

                            {(portUtilDraft === 'DOWNSTREAM_AREA_FEED' ||
                              portUtilDraft === 'CASCADED_SPLITTER') && (
                              <div>
                                <label className="block text-[10px] font-mono text-slate-400 mb-1">
                                  Target Downstream Area / Node / FAT Box
                                </label>
                                <input
                                  type="text"
                                  list="gis-target-nodes-areas"
                                  value={targetAreaOrNodeDraft}
                                  onChange={(e) => setTargetAreaOrNodeDraft(e.target.value)}
                                  placeholder="e.g. FAT-Lalkurti-02 or Mohallah Street 4"
                                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                                />
                                <datalist id="gis-target-nodes-areas">
                                  {nodes
                                    .filter((n) => n.id !== node.id)
                                    .map((n) => (
                                      <option key={n.id} value={`${n.name}${n.area_name ? ` (${n.area_name})` : ''}`} />
                                    ))}
                                  {DEFAULT_NETWORK_AREAS.map((a) => (
                                    <option key={a.area_name} value={a.area_name} />
                                  ))}
                                </datalist>
                              </div>
                            )}

                            <div className="grid grid-cols-2 gap-2 font-mono">
                              <div>
                                <label className="block text-[10px] text-slate-400 mb-1">
                                  Drop / Link Distance (m)
                                </label>
                                <input
                                  type="number"
                                  min={0}
                                  max={5000}
                                  value={portDropMeters}
                                  onChange={(e) => setPortDropMeters(Number(e.target.value))}
                                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white tabular-nums"
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] text-slate-400 mb-1">
                                  Est. Signal (dBm)
                                </label>
                                <div className="w-full bg-slate-900/70 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-cyan-300 tabular-nums">
                                  {estDbm !== null ? `${estDbm.toFixed(2)} dBm` : 'Unlinked'}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 pt-1">
                              <button
                                type="button"
                                disabled={isSaving}
                                onClick={async () => {
                                  const sub = selectedSubId ? subscribersById[selectedSubId] : null;
                                  if (onUpsertSplitterOutput) {
                                    await onUpsertSplitterOutput({
                                      nodeId: node.id,
                                      nodeType: node.node_type,
                                      portNumber: portNum,
                                      legLabel,
                                      utilizationType: portUtilDraft,
                                      subscriberId:
                                        portUtilDraft === 'CLIENT_ONT' ? sub?.id || null : null,
                                      subscriberUsername:
                                        portUtilDraft === 'CLIENT_ONT' ? sub?.username || '' : '',
                                      clientNameManual:
                                        portUtilDraft === 'CLIENT_ONT'
                                          ? manualClientName.trim() ||
                                            (sub ? `${sub.fullName} (@${sub.username})` : '')
                                          : '',
                                      targetAreaOrNode:
                                        portUtilDraft === 'DOWNSTREAM_AREA_FEED' ||
                                        portUtilDraft === 'CASCADED_SPLITTER'
                                          ? targetAreaOrNodeDraft.trim()
                                          : '',
                                      dropDistanceMeters: portDropMeters,
                                      estimatedRxDbm: estDbm,
                                    });
                                  } else {
                                    await onAssignPort({
                                      fdbNodeId: node.id,
                                      portNumber: portNum,
                                      subscriberId:
                                        portUtilDraft === 'FREE_PORT' ? null : sub?.id || null,
                                      subscriberUsername:
                                        portUtilDraft === 'FREE_PORT' ? '' : sub?.username || '',
                                      clientLabel:
                                        portUtilDraft === 'FREE_PORT'
                                          ? ''
                                          : sub
                                          ? `${sub.fullName} (@${sub.username})`
                                          : manualClientName.trim(),
                                      dropCableMeters: portDropMeters,
                                      status: portStatusDraft,
                                    });
                                  }
                                  setEditingPortNum(null);
                                }}
                                className="flex-1 min-h-[40px] px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-slate-950 font-mono font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                              >
                                <Save className="w-3.5 h-3.5" />
                                <span>Save Port {portNum}</span>
                              </button>
                              {util !== 'FREE_PORT' && (
                                <button
                                  type="button"
                                  disabled={isSaving}
                                  onClick={async () => {
                                    if (onUpsertSplitterOutput) {
                                      await onUpsertSplitterOutput({
                                        nodeId: node.id,
                                        nodeType: node.node_type,
                                        portNumber: portNum,
                                        legLabel,
                                        utilizationType: 'FREE_PORT',
                                        subscriberId: null,
                                        subscriberUsername: '',
                                        clientNameManual: '',
                                        targetAreaOrNode: '',
                                        dropDistanceMeters: 0,
                                        estimatedRxDbm: estDbm,
                                      });
                                    } else {
                                      await onAssignPort({
                                        fdbNodeId: node.id,
                                        portNumber: portNum,
                                        subscriberId: null,
                                        subscriberUsername: '',
                                        clientLabel: '',
                                        dropCableMeters: 0,
                                        status: 'FREE',
                                      });
                                    }
                                    setEditingPortNum(null);
                                  }}
                                  className="min-h-[40px] px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-950 text-rose-300 border border-slate-700 font-mono text-xs cursor-pointer"
                                >
                                  Clear
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: Core Splices & Pass-Through Jointing */}
          {(node.node_type === 'FDB_FAT' ||
            node.node_type === 'DIST_NODE' ||
            node.node_type === 'FOSC_JOINT') &&
            fdbSubTab === 'splices' && (
            <div className="space-y-3">
              {/* Top Action Header + One-Click Outgoing Cable Route Button */}
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="text-[11px] font-mono uppercase tracking-wider text-cyan-300 font-bold flex items-center gap-1.5">
                      <Link2 className="w-3.5 h-3.5" />
                      Core Splices &amp; Pass-Through Tray
                    </span>
                    <p className="text-[11px] text-slate-400 mt-1 leading-snug">
                      Route incoming cores into local splitters OR fusion-splice pass-through cores straight onto outgoing cables (-0.2 dB splice loss, bypassing splitter loss).
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {onRouteCableFromNode && (
                    <button
                      type="button"
                      onClick={() => onRouteCableFromNode(node)}
                      className="flex-1 min-h-[38px] px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-mono font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Route Outgoing Cable From This Box</span>
                    </button>
                  )}
                  {connectedCables.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setShowAllSpliceCables((v) => !v)}
                      className="min-h-[38px] px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 font-mono text-[10px] font-bold cursor-pointer"
                    >
                      {showAllSpliceCables ? 'Incoming Only' : `All Cables (${connectedCables.length})`}
                    </button>
                  )}
                </div>
              </div>

              {connectedCables.length === 0 ? (
                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-slate-400 text-center space-y-2">
                  <p>No fiber cables connected to this box yet.</p>
                </div>
              ) : (
                (showAllSpliceCables ? connectedCables : normalizedIncomingCables).map((incCable) => {
                  const otherNodeId =
                    incCable.source_node_id === node.id
                      ? incCable.target_node_id
                      : incCable.source_node_id;
                  const otherNodeName = nodesById[otherNodeId]?.name || 'Upstream Node';
                  const coreCount = Math.max(1, Number(incCable.cable_cores || 12));
                  const candidateOutCables = connectedCables.filter((c) => c.id !== incCable.id);

                  return (
                    <div
                      key={incCable.id}
                      className="rounded-xl border border-slate-800 bg-slate-950/95 p-3 space-y-2.5"
                    >
                      <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-slate-800 font-mono">
                        <div className="min-w-0">
                          <span className="text-[10px] uppercase text-emerald-400 font-bold block">
                            Incoming Cable ({coreCount}C · {incCable.distance_meters}m)
                          </span>
                          <span className="text-xs font-bold text-white truncate block">
                            From {otherNodeName} {incCable.name ? `(${incCable.name})` : ''}
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-400 shrink-0">
                          {candidateOutCables.length} Outgoing Cable{candidateOutCables.length === 1 ? '' : 's'}
                        </span>
                      </div>

                      <div className="space-y-2 max-h-[380px] overflow-y-auto pr-0.5">
                        {Array.from({ length: coreCount }, (_, idx) => idx + 1).map((coreNum) => {
                          const coreColor = getTia598Color(coreNum);
                          const arrivalKey = `${incCable.id}:${coreNum}`;
                          const arrivalDbm = budget?.arrivalDbmByCoreKey?.[arrivalKey];
                          const savedEntry = evaluatedCoreSplices.find(
                            (sp) =>
                              sp.incoming_cable_id === incCable.id &&
                              sp.incoming_core_number === coreNum
                          );
                          const currentAction: CoreSpliceAction =
                            savedEntry?.action ||
                            (coreNum === Number(nodeFeedCore || 1) && incCable.id === incomingFeedCableId
                              ? 'FEED_INTERNAL_SPLITTER'
                              : 'SPARE_DARK');
                          const selectedOutCableId =
                            savedEntry?.outgoing_cable_id || outgoingCablesForBox[0]?.id || candidateOutCables[0]?.id || '';
                          const selectedOutCable = connectedCables.find(
                            (c) => c.id === selectedOutCableId
                          );
                          const selectedOutCore =
                            savedEntry?.outgoing_core_number ||
                            Math.min(coreNum, Math.max(1, Number(selectedOutCable?.cable_cores || 12)));
                          const spliceLoss =
                            savedEntry?.splice_loss_db ?? DEFAULT_PASS_THROUGH_SPLICE_LOSS_DB;

                          const updateCoreSplice = (patch: Partial<EnclosureCoreSpliceEntry>) => {
                            setCoreSplicesDraft((prev) => {
                              const existsIdx = prev.findIndex(
                                (p) =>
                                  p.incoming_cable_id === incCable.id &&
                                  p.incoming_core_number === coreNum
                              );
                              const base: EnclosureCoreSpliceEntry =
                                existsIdx >= 0
                                  ? prev[existsIdx]
                                  : {
                                      id: `${incCable.id}-${coreNum}`,
                                      incoming_cable_id: incCable.id,
                                      incoming_core_number: coreNum,
                                      action: currentAction,
                                      target_splitter_id: evaluatedSplitters[0]?.id || null,
                                      outgoing_cable_id: selectedOutCableId || null,
                                      outgoing_core_number: selectedOutCore,
                                      splice_loss_db: DEFAULT_PASS_THROUGH_SPLICE_LOSS_DB,
                                    };
                              const nextEntry: EnclosureCoreSpliceEntry = { ...base, ...patch };
                              if (existsIdx >= 0) {
                                return prev.map((item, i) => (i === existsIdx ? nextEntry : item));
                              }
                              return [...prev, nextEntry];
                            });
                          };

                          return (
                            <div
                              key={arrivalKey}
                              className={`p-2.5 rounded-lg border space-y-2 font-mono text-[11px] ${
                                currentAction === 'PASS_THROUGH_JOINT'
                                  ? 'bg-indigo-950/35 border-indigo-700/70'
                                  : currentAction === 'FEED_INTERNAL_SPLITTER'
                                  ? 'bg-emerald-950/25 border-emerald-800/60'
                                  : 'bg-slate-900/70 border-slate-800'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span
                                    className="w-3.5 h-3.5 rounded border border-white/40 shrink-0"
                                    style={{ backgroundColor: coreColor.hex }}
                                  />
                                  <span className="font-bold text-white">
                                    Core #{coreNum} ({coreColor.name})
                                  </span>
                                </div>
                                <span className="text-[10px] font-bold tabular-nums text-cyan-300 shrink-0">
                                  {arrivalDbm !== undefined
                                    ? `In: ${arrivalDbm >= 0 ? '+' : ''}${arrivalDbm.toFixed(2)} dBm`
                                    : 'In: —'}
                                </span>
                              </div>

                              <select
                                value={currentAction}
                                onChange={(e) => {
                                  const act = e.target.value as CoreSpliceAction;
                                  updateCoreSplice({
                                    action: act,
                                    target_splitter_id:
                                      act === 'FEED_INTERNAL_SPLITTER'
                                        ? savedEntry?.target_splitter_id ||
                                          evaluatedSplitters[0]?.id ||
                                          null
                                        : null,
                                    outgoing_cable_id:
                                      act === 'PASS_THROUGH_JOINT'
                                        ? selectedOutCableId || null
                                        : null,
                                    outgoing_core_number:
                                      act === 'PASS_THROUGH_JOINT' ? selectedOutCore : null,
                                  });
                                }}
                                className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-[11px] text-white"
                              >
                                <option value="FEED_INTERNAL_SPLITTER">
                                  Route Into Internal Splitter (Drop Locally)
                                </option>
                                <option value="PASS_THROUGH_JOINT">
                                  Fusion-Splice Pass-Through to Outgoing Cable (-0.2 dB)
                                </option>
                                <option value="SPARE_DARK">Leave Dark / Spare Inside Tray</option>
                              </select>

                              {currentAction === 'FEED_INTERNAL_SPLITTER' && (
                                <div>
                                  {evaluatedSplitters.length > 0 ? (
                                    <select
                                      value={savedEntry?.target_splitter_id || evaluatedSplitters[0]?.id || ''}
                                      onChange={(e) => {
                                        const tSplId = e.target.value || null;
                                        updateCoreSplice({ target_splitter_id: tSplId });
                                        if (tSplId) {
                                          setInternalSplittersDraft((prev) =>
                                            prev.map((s) =>
                                              s.id === tSplId
                                                ? {
                                                    ...s,
                                                    input_source_type: 'INCOMING_CORE',
                                                    incoming_cable_id: incCable.id,
                                                    incoming_core_number: coreNum,
                                                  }
                                                : s
                                            )
                                          );
                                        }
                                      }}
                                      className="w-full bg-slate-950 border border-emerald-700/70 rounded px-2 py-1 text-[11px] text-emerald-200"
                                    >
                                      {evaluatedSplitters.map((sp) => (
                                        <option key={sp.id} value={sp.id}>
                                          Feeds {sp.label} ({sp.splitter_type})
                                        </option>
                                      ))}
                                    </select>
                                  ) : (
                                    <div className="text-[10px] text-emerald-300">
                                      Feeds box primary splitter ({nodeSplitter})
                                    </div>
                                  )}
                                </div>
                              )}

                              {currentAction === 'PASS_THROUGH_JOINT' && (
                                <div className="space-y-2">
                                  {candidateOutCables.length === 0 ? (
                                    <div className="p-2 rounded bg-amber-950/50 border border-amber-700/60 text-[10px] text-amber-200">
                                      No outgoing cable connected yet — use{' '}
                                      <strong>&ldquo;Splice &amp; Extend Core Directly to Next FDB&rdquo;</strong>{' '}
                                      below to create the span and bind this pass-through joint in 1 click.
                                    </div>
                                  ) : (
                                    <>
                                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                                        <div className="sm:col-span-2">
                                          <SearchableCombobox
                                            compact
                                            value={selectedOutCableId}
                                            options={candidateOutCables.map((oc) => {
                                              const oTargetId =
                                                oc.source_node_id === node.id
                                                  ? oc.target_node_id
                                                  : oc.source_node_id;
                                              const oNode = nodesById[oTargetId];
                                              return {
                                                value: oc.id,
                                                label: `Out → ${oNode?.name || 'Node'}`,
                                                sublabel: `${oc.cable_cores}C · ${oc.distance_meters}m${
                                                  oNode?.area_name ? ` · ${oNode.area_name}` : ''
                                                }`,
                                                keywords: `${oNode?.name || ''} ${oNode?.area_name || ''} ${oc.name || ''}`,
                                              };
                                            })}
                                            onChange={(val) =>
                                              updateCoreSplice({
                                                outgoing_cable_id: val || null,
                                              })
                                            }
                                            placeholder="Select outgoing cable..."
                                            searchPlaceholder="Search target FDB / cable..."
                                            accentColor="indigo"
                                            ariaLabel="Outgoing pass-through cable"
                                          />
                                        </div>
                                        <select
                                          value={selectedOutCore}
                                          onChange={(e) =>
                                            updateCoreSplice({
                                              outgoing_core_number: Number(e.target.value),
                                            })
                                          }
                                          className="bg-slate-950 border border-indigo-600/80 rounded-lg px-2 py-1.5 text-[11px] text-white"
                                        >
                                          {Array.from(
                                            {
                                              length: Math.max(
                                                1,
                                                Number(selectedOutCable?.cable_cores || 12)
                                              ),
                                            },
                                            (_, cIdx) => cIdx + 1
                                          ).map((ocNum) => (
                                            <option key={ocNum} value={ocNum}>
                                              Out #{ocNum} ({getTia598Color(ocNum).name})
                                            </option>
                                          ))}
                                        </select>
                                      </div>

                                      <div className="flex items-center justify-between gap-2 text-[10px] px-1">
                                        <span className="text-indigo-200 flex items-center gap-1">
                                          <ArrowRight className="w-3 h-3 text-indigo-400" />
                                          <span>
                                            Splitter Bypassed (-{spliceLoss.toFixed(2)} dB Splice)
                                          </span>
                                        </span>
                                        <span className="font-bold text-emerald-300 tabular-nums">
                                          {arrivalDbm !== undefined
                                            ? `Out: ${(arrivalDbm - spliceLoss).toFixed(2)} dBm`
                                            : ''}
                                        </span>
                                      </div>
                                    </>
                                  )}
                                </div>
                              )}

                              {/* 1-Step Mid-Span Splice & Extend Core Directly to Next FDB */}
                              {onQuickSpliceAndExtendCore && (
                                <div className="pt-1 border-t border-slate-800/80">
                                  {quickExtendCoreKey !== arrivalKey ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setQuickExtendCoreKey(arrivalKey);
                                        setQuickExtendCableCores(2);
                                        setQuickExtendOutCore(1);
                                        setQuickExtendTargetNodeId('');
                                      }}
                                      className="w-full py-1.5 px-2.5 rounded-lg bg-indigo-950/70 hover:bg-indigo-900/80 border border-indigo-700/70 text-[10px] font-bold text-indigo-200 flex items-center justify-center gap-1.5 cursor-pointer transition"
                                    >
                                      <Zap className="w-3 h-3 text-amber-300 shrink-0" />
                                      <span>Splice &amp; Extend Core #{coreNum} Directly to Next FDB</span>
                                    </button>
                                  ) : (
                                    <div className="p-2.5 rounded-lg bg-slate-950 border border-indigo-600/80 space-y-2">
                                      <div className="flex items-center justify-between gap-2">
                                        <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-300 flex items-center gap-1">
                                          <Zap className="w-3 h-3 text-amber-300" />
                                          1-Step Mid-Span Extend (Core #{coreNum} {coreColor.name})
                                        </span>
                                        <button
                                          type="button"
                                          onClick={() => setQuickExtendCoreKey(null)}
                                          className="text-slate-400 hover:text-white text-[10px] cursor-pointer"
                                        >
                                          Cancel
                                        </button>
                                      </div>

                                      <div>
                                        <label className="block text-[9px] text-slate-400 mb-1">
                                          Destination FDB / FAT / Joint (e.g. LAL-CHAND)
                                        </label>
                                        <SearchableCombobox
                                          compact
                                          value={quickExtendTargetNodeId}
                                          options={destinationNodeOptions}
                                          onChange={setQuickExtendTargetNodeId}
                                          placeholder="Search target FDB / FAT..."
                                          searchPlaceholder="Type box name, area, or dBm..."
                                          accentColor="indigo"
                                          ariaLabel="Target FDB for mid-span core extension"
                                        />
                                      </div>

                                      <div className="grid grid-cols-2 gap-1.5">
                                        <div>
                                          <label className="block text-[9px] text-slate-400 mb-0.5">
                                            New Cable Capacity
                                          </label>
                                          <select
                                            value={quickExtendCableCores}
                                            onChange={(e) => {
                                              const nextC = Number(e.target.value) as
                                                | 1
                                                | 2
                                                | 4
                                                | 6
                                                | 8
                                                | 12
                                                | 24
                                                | 48;
                                              setQuickExtendCableCores(nextC);
                                              if (quickExtendOutCore > nextC) {
                                                setQuickExtendOutCore(1);
                                              }
                                            }}
                                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] text-white"
                                          >
                                            {[1, 2, 4, 6, 8, 12, 24, 48].map((cnt) => (
                                              <option key={cnt} value={cnt}>
                                                {cnt}C Fiber Cable
                                              </option>
                                            ))}
                                          </select>
                                        </div>
                                        <div>
                                          <label className="block text-[9px] text-slate-400 mb-0.5">
                                            Target Incoming Core #
                                          </label>
                                          <select
                                            value={quickExtendOutCore}
                                            onChange={(e) =>
                                              setQuickExtendOutCore(Number(e.target.value))
                                            }
                                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] text-white"
                                          >
                                            {Array.from(
                                              { length: quickExtendCableCores },
                                              (_, i) => i + 1
                                            ).map((cIdx) => (
                                              <option key={cIdx} value={cIdx}>
                                                Core #{cIdx} ({getTia598Color(cIdx).name})
                                              </option>
                                            ))}
                                          </select>
                                        </div>
                                      </div>

                                      <div className="text-[10px] text-emerald-300 bg-emerald-950/40 border border-emerald-800/60 rounded px-2 py-1.5">
                                        {arrivalDbm !== undefined
                                          ? `Signal: ${arrivalDbm.toFixed(
                                              2
                                            )} dBm - ${DEFAULT_PASS_THROUGH_SPLICE_LOSS_DB.toFixed(
                                              2
                                            )} dB splice = ${(
                                              arrivalDbm - DEFAULT_PASS_THROUGH_SPLICE_LOSS_DB
                                            ).toFixed(2)} dBm → Core #${quickExtendOutCore} (${
                                              getTia598Color(quickExtendOutCore).name
                                            }), bypassing local splitter!`
                                          : `Bypasses local splitter (-${DEFAULT_PASS_THROUGH_SPLICE_LOSS_DB.toFixed(
                                              2
                                            )} dB splice loss)`}
                                      </div>

                                      <button
                                        type="button"
                                        disabled={
                                          !quickExtendTargetNodeId || isSaving || localSaving
                                        }
                                        onClick={async () => {
                                          if (!quickExtendTargetNodeId) return;
                                          setLocalSaveError(null);
                                          setLocalSaving(true);
                                          try {
                                            await onQuickSpliceAndExtendCore({
                                              sourceNode: node,
                                              incomingCableId: incCable.id,
                                              incomingCoreNumber: coreNum,
                                              targetNodeId: quickExtendTargetNodeId,
                                              outgoingCableCores: quickExtendCableCores,
                                              outgoingCoreNumber: quickExtendOutCore,
                                              spliceLossDb: DEFAULT_PASS_THROUGH_SPLICE_LOSS_DB,
                                            });
                                            setQuickExtendCoreKey(null);
                                          } catch (err: any) {
                                            setLocalSaveError(
                                              err?.message ||
                                                'Failed to extend pass-through core to destination FDB.'
                                            );
                                          } finally {
                                            setLocalSaving(false);
                                          }
                                        }}
                                        className="w-full min-h-[36px] py-1.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-slate-950 font-bold text-[11px] flex items-center justify-center gap-1.5 cursor-pointer"
                                      >
                                        <Zap className="w-3.5 h-3.5" />
                                        <span>
                                          {localSaving
                                            ? 'Creating Cable & Saving Splice...'
                                            : 'Create Cable & Bind Pass-Through Splice'}
                                        </span>
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* FDB / DIST / FOSC Signal Tab: Optical Budget + Field Agent Fast Triage Card */}
          {(node.node_type === 'FDB_FAT' ||
            node.node_type === 'DIST_NODE' ||
            node.node_type === 'FOSC_JOINT') &&
            fdbSubTab === 'signal' && (
            <div className="space-y-4">
              {/* Optical Signal Budget Breakdown */}
              <div className={`p-3.5 rounded-xl border ${healthStyle.bgClass} ${healthStyle.borderClass} space-y-3`}>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <span className="text-[11px] font-mono uppercase tracking-wider text-slate-200 font-bold block">
                      Optical Power Budget
                    </span>
                    {hasUnsavedOpticalEdits && (
                      <span className="text-[10px] font-mono text-amber-300">
                        Live Preview (Click Save Node Changes to persist)
                      </span>
                    )}
                  </div>
                  <span className={`text-[11px] font-mono font-bold text-right ${healthStyle.textClass}`}>
                    {healthLabel}
                  </span>
                </div>

                {/* Cascaded Link Budget Chain */}
                {budget && budget.budgetSteps && budget.budgetSteps.length > 0 && (
                  <div className="p-2.5 rounded-lg bg-slate-950/85 border border-slate-800 space-y-1.5 font-mono">
                    <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-cyan-300 font-bold">
                      <span>Optical Power Link Budget Chain</span>
                      <span className="text-slate-400">
                        {budget.hopCount} Hop{budget.hopCount === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className="space-y-1">
                      {budget.budgetSteps.map((step, idx) => (
                        <div
                          key={step.id}
                          className="flex items-center justify-between gap-2 text-[11px] py-1 px-2 rounded bg-slate-900/90 border border-slate-800/80"
                        >
                          <div className="min-w-0">
                            <div className="text-slate-200 font-semibold truncate">
                              {idx + 1}. {step.label}
                            </div>
                            <div className="text-[10px] text-slate-400 truncate">{step.detail}</div>
                          </div>
                          <div className="text-right shrink-0 tabular-nums">
                            {step.deltaDb !== null && step.deltaDb !== 0 && (
                              <span className="text-amber-300 font-bold mr-2">
                                {step.deltaDb > 0 ? `+${step.deltaDb.toFixed(2)}` : step.deltaDb.toFixed(2)} dB
                              </span>
                            )}
                            <span
                              className={`font-bold ${
                                idx === budget.budgetSteps.length - 1
                                  ? healthStyle.textClass
                                  : 'text-sky-300'
                              }`}
                            >
                              {step.powerAfterDbm >= 0 ? '+' : ''}
                              {step.powerAfterDbm.toFixed(2)} dBm
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="pt-1.5 mt-1 border-t border-slate-800 flex items-center justify-between text-xs font-bold tabular-nums">
                      <span className="text-slate-300">Final Splitter Output Power</span>
                      <span className={healthStyle.textClass}>
                        {budget.ontRxDbm !== null ? `${budget.ontRxDbm.toFixed(2)} dBm` : '—'}
                      </span>
                    </div>
                  </div>
                )}

                {hasMultiSplitters && (
                  <div className="p-2.5 rounded-lg bg-slate-950/85 border border-cyan-800/50 space-y-1.5 font-mono">
                    <span className="text-[10px] uppercase tracking-wider text-cyan-300 font-bold block">
                      Internal Splitters Cascade Breakdown ({evaluatedSplitters.length} Units · {nodeBoxCapacity}P Box)
                    </span>
                    <div className="space-y-1">
                      {evaluatedSplitters.map((sp) => (
                        <div
                          key={sp.id}
                          className="flex items-center justify-between gap-2 text-[11px] py-1 px-2 rounded bg-slate-900 border border-slate-800"
                        >
                          <div className="min-w-0 truncate">
                            <span className="text-white font-bold">{sp.label}</span>{' '}
                            <span className="text-slate-400">({sp.splitter_type})</span>
                            {sp.input_source_type === 'INTERNAL_SPLITTER_LEG' && sp.parent_splitter_id && (
                              <span className="text-indigo-300 ml-1">
                                ← {evaluatedSplitters.find((p) => p.id === sp.parent_splitter_id)?.label || 'Parent'} Leg #{sp.parent_splitter_leg || 1}
                              </span>
                            )}
                          </div>
                          <div className="shrink-0 tabular-nums">
                            <span className="text-slate-400 mr-1.5">
                              {sp.calculated_input_dbm !== null && sp.calculated_input_dbm !== undefined
                                ? `${sp.calculated_input_dbm.toFixed(1)} →`
                                : ''}
                            </span>
                            <span className="font-bold text-emerald-300">
                              {sp.calculated_output_dbm !== null && sp.calculated_output_dbm !== undefined
                                ? `${sp.calculated_output_dbm.toFixed(2)} dBm`
                                : 'Unlinked'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2 text-[11px] font-mono bg-slate-950/70 p-2.5 rounded-lg border border-slate-800/80">
                  <div>
                    <span className="text-slate-400 block text-[10px]">
                      {budget?.parentOutputDbm !== null && budget?.parentOutputDbm !== undefined
                        ? `Inherited Parent (${nodesById[budget.parentNodeId || '']?.name || 'Upstream'})`
                        : 'Upstream OLT TX'}
                    </span>
                    <span className="text-sky-300 font-bold tabular-nums block">
                      {budget?.parentOutputDbm !== null && budget?.parentOutputDbm !== undefined
                        ? `${budget.parentOutputDbm >= 0 ? '+' : ''}${budget.parentOutputDbm.toFixed(2)} dBm`
                        : budget?.oltTxDbm !== null && budget?.oltTxDbm !== undefined
                        ? `${budget.oltTxDbm >= 0 ? '+' : ''}${budget.oltTxDbm.toFixed(2)} dBm`
                        : 'No OLT Path'}
                    </span>
                    {budget?.sourcePonLabel && (
                      <span className="text-[10px] text-cyan-400 block truncate">
                        {budget.oltName ? `${budget.oltName} · ` : ''}
                        {budget.sourcePonLabel}
                      </span>
                    )}
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">Box Input Power</span>
                    <span className="text-white font-bold tabular-nums">
                      {budget?.inputDbm !== null && budget?.inputDbm !== undefined
                        ? `${budget.inputDbm.toFixed(2)} dBm`
                        : '—'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">
                      Total Span ({budget?.totalDistanceMeters ?? 0}m)
                    </span>
                    <span className="text-amber-300 tabular-nums">
                      -{budget ? budget.fiberLossDb.toFixed(2) : '0.00'} dB
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">
                      Splices ({budget?.spliceCount ?? 0}×) &amp; Upstream Split
                    </span>
                    <span className="text-amber-300 tabular-nums">
                      -{budget ? (budget.spliceLossDb + budget.upstreamThruLossDb).toFixed(2) : '0.00'} dB
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">This Splitter ({nodeSplitter})</span>
                    <span className="text-amber-300 tabular-nums">
                      -{(SPLITTER_SPECS[nodeSplitter]?.dropLossDb ?? 0).toFixed(2)} dB
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">Final Output / ONT Rx</span>
                    <span className={`font-bold text-sm tabular-nums ${healthStyle.textClass}`}>
                      {budget?.ontRxDbm !== null && budget?.ontRxDbm !== undefined
                        ? `${budget.ontRxDbm.toFixed(2)} dBm`
                        : '—'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Field Agent Fast Triage Card */}
              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono uppercase tracking-wider text-cyan-300 font-bold flex items-center gap-1.5">
                    <ClipboardCheck className="w-3.5 h-3.5" />
                    Field Agent Fast Triage Card
                  </span>
                  <span className="text-[10px] font-mono text-slate-400">
                    {freePorts} Free Ports
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 p-2.5 rounded-lg bg-slate-900 border border-slate-800 font-mono text-[11px]">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-4 h-4 rounded border border-white/30 shrink-0"
                      style={{ backgroundColor: incomingCoreSpec.hex }}
                    />
                    <div className="min-w-0">
                      <span className="text-[10px] text-slate-400 block">Feed Core</span>
                      <span className="text-white font-bold truncate block">
                        #{incomingCoreNum} {incomingCoreSpec.name}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className="w-4 h-4 rounded-full border border-white/30 shrink-0"
                      style={{ backgroundColor: incomingTubeSpec.hex }}
                    />
                    <div className="min-w-0">
                      <span className="text-[10px] text-slate-400 block">Buffer Tube</span>
                      <span className="text-white font-bold truncate block">
                        Tube {Math.ceil(incomingCoreNum / 12)} ({incomingTubeSpec.name})
                      </span>
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  {[
                    {
                      id: 'opm',
                      label: `Verify Optical Power Meter reads ~${
                        budget?.ontRxDbm !== null && budget?.ontRxDbm !== undefined
                          ? `${budget.ontRxDbm.toFixed(1)} dBm`
                          : '-18 to -24 dBm'
                      } on splitter port`,
                    },
                    {
                      id: 'clean',
                      label: 'Inspect & alcohol-clean SC/APC connector + pigtail sleeve',
                    },
                    {
                      id: 'core',
                      label: `Confirm Core #${incomingCoreNum} (${incomingCoreSpec.name}) splice integrity at upstream FOSC`,
                    },
                    {
                      id: 'pppoe',
                      label: 'Check live PPPoE session status & assign active subscriber port',
                    },
                  ].map((step) => {
                    const checked = Boolean(triageChecks[`${node.id}:${step.id}`]);
                    return (
                      <label
                        key={step.id}
                        className="flex items-start gap-2.5 p-2 rounded-lg bg-slate-900/70 hover:bg-slate-900 border border-slate-800/80 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            setTriageChecks((prev) => ({
                              ...prev,
                              [`${node.id}:${step.id}`]: e.target.checked,
                            }))
                          }
                          className="mt-0.5 w-4 h-4 accent-emerald-500 shrink-0"
                        />
                        <span
                          className={`text-[11px] leading-snug ${
                            checked ? 'line-through text-slate-500' : 'text-slate-200'
                          }`}
                        >
                          {step.label}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Equipment Swap & Maintenance History Log */}
              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-mono uppercase tracking-wider text-amber-300 font-bold flex items-center gap-1.5">
                    <History className="w-3.5 h-3.5" />
                    Equipment Swap History Log
                  </span>
                  {onOpenUpgradeModal && (
                    <button
                      type="button"
                      onClick={() => onOpenUpgradeModal(node)}
                      className="px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/50 text-amber-300 text-[10px] font-mono font-bold cursor-pointer"
                    >
                      + Replace Box
                    </button>
                  )}
                </div>
                {Array.isArray(node.equipment_history) && node.equipment_history.length > 0 ? (
                  <div className="space-y-1.5 max-h-52 overflow-y-auto">
                    {node.equipment_history.map((entry) => (
                      <div
                        key={entry.id}
                        className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 space-y-1 text-[11px]"
                      >
                        <div className="text-slate-100 font-medium leading-snug">{entry.summary}</div>
                        <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono text-slate-400">
                          <span>By {entry.actor || 'Admin'}</span>
                          {entry.deducted_inventory_item && (
                            <span className="text-amber-300">
                              -1 Stock: {entry.deducted_inventory_item}
                            </span>
                          )}
                          {entry.returned_inventory_item && (
                            <span className="text-emerald-300">
                              +1 Returned: {entry.returned_inventory_item}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-500 font-mono">
                    No hardware upgrades or replacements recorded on this node yet.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* OLT & PON Ports Drawer */}
          {node.node_type === 'OLT' && (() => {
            const linkedOlt = node.olt_id ? oltsById[node.olt_id] : undefined;
            const oltPonPorts = linkedOlt
              ? (ponPortsByOltId[linkedOlt.id] || []).slice().sort((a, b) => a.port_number - b.port_number)
              : [];

            if (linkedOlt) {
              const maxPerPon = getDefaultMaxOnuLimit(linkedOlt.pon_mode);
              return (
                <div className="space-y-3">
                  {/* OLT Hardware Identity Card */}
                  <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap font-mono">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                              linkedOlt.pon_mode === 'GPON'
                                ? 'bg-cyan-950 text-cyan-300 border-cyan-700/80'
                                : 'bg-amber-950 text-amber-300 border-amber-700/80'
                            }`}
                          >
                            {linkedOlt.pon_mode}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            {linkedOlt.total_pon_ports} PON Ports · {maxPerPon} ONU/Port
                          </span>
                          <span
                            className={`text-[10px] font-bold ${
                              linkedOlt.status === 'ONLINE' ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {linkedOlt.status}
                          </span>
                        </div>
                        <div className="text-xs font-bold text-white mt-1 truncate">
                          {linkedOlt.vendor_model || 'OLT Chassis'}
                        </div>
                        <div className="text-[11px] font-mono text-slate-400 truncate">
                          Mgmt IP: <span className="text-cyan-300">{linkedOlt.mgmt_ip || 'Not set'}</span>
                        </div>
                      </div>

                      {onOpenEditOlt && (
                        <button
                          type="button"
                          onClick={() => onOpenEditOlt(linkedOlt.id)}
                          className="min-h-[34px] px-2.5 py-1 rounded-lg bg-sky-600 hover:bg-sky-500 text-slate-950 font-mono font-bold text-[11px] shrink-0 cursor-pointer"
                        >
                          Edit OLT
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Interactive PON 1..N List */}
                  <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-mono uppercase tracking-wider text-sky-400 font-bold">
                        PON Ports (PON 1 – PON {linkedOlt.total_pon_ports})
                      </span>
                      <span className="text-[10px] font-mono text-slate-400">
                        Max +12.0 dBm
                      </span>
                    </div>

                    {oltPonPorts.length === 0 ? (
                      <div className="p-3 rounded-lg bg-slate-900 text-slate-400 text-[11px] font-mono">
                        No PON port rows found yet. Click &quot;Edit OLT&quot; to initialize PON 1–
                        {linkedOlt.total_pon_ports}.
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-[380px] overflow-y-auto pr-0.5">
                        {oltPonPorts.map((port) => {
                          const feederCables = cables.filter(
                            (c) => c.source_pon_port_id === port.id
                          );
                          const downstreamBudgets = (Object.values(budgetsByNodeId) as NodeOpticalBudgetResult[]).filter(
                            (b) => b.sourcePonPortId === port.id && b.nodeId !== node.id
                          );
                          let liveAssignedOnus = 0;
                          for (const b of downstreamBudgets) {
                            const fdbPorts = portsByNodeId[b.nodeId] || [];
                            liveAssignedOnus += fdbPorts.filter((fp) => fp.status === 'ACTIVE').length;
                          }
                          const usedOnus = Math.max(liveAssignedOnus, Number(port.active_onus || 0));
                          const remainingOnus = Math.max(0, Number(port.max_onu_limit || maxPerPon) - usedOnus);
                          const isEditingTx = editingPonId === port.id;
                          const draftTx =
                            ponTxDrafts[port.id] !== undefined
                              ? ponTxDrafts[port.id]
                              : Number(port.tx_power_dbm ?? 5.0);

                          return (
                            <div
                              key={port.id}
                              className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 space-y-2 font-mono text-[11px]"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="font-bold text-white">PON {port.port_number}</span>
                                    <span className="text-slate-500">·</span>
                                    <span className="text-cyan-300 truncate">
                                      {port.port_label || `PON-${port.port_number}`}
                                    </span>
                                  </div>
                                  <div className="text-[10px] text-slate-400 mt-0.5">
                                    SFP {port.sfp_class} ·{' '}
                                    <span className="text-sky-300 font-bold tabular-nums">
                                      {Number(port.tx_power_dbm) >= 0 ? '+' : ''}
                                      {Number(port.tx_power_dbm).toFixed(1)} dBm
                                    </span>{' '}
                                    · {downstreamBudgets.length} Downstream Node
                                    {downstreamBudgets.length === 1 ? '' : 's'}
                                  </div>
                                  <div className="text-[10px] text-slate-400 tabular-nums">
                                    Capacity: <span className="text-white">{usedOnus}</span> /{' '}
                                    {port.max_onu_limit || maxPerPon} ({linkedOlt.pon_mode}) ·{' '}
                                    <span className="text-emerald-400">{remainingOnus} Free</span>
                                  </div>
                                  {feederCables.length > 0 && (
                                    <div className="text-[10px] text-purple-300 truncate mt-0.5">
                                      Feeder: {feederCables.map((fc) => fc.name || `${fc.cable_cores}C`).join(', ')}
                                    </div>
                                  )}
                                </div>

                                {onUpdatePonPort && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (isEditingTx) {
                                        setEditingPonId(null);
                                      } else {
                                        setEditingPonId(port.id);
                                        setPonTxDrafts((prev) => ({
                                          ...prev,
                                          [port.id]: Number(port.tx_power_dbm ?? 5.0),
                                        }));
                                      }
                                    }}
                                    className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-sky-300 border border-slate-700 text-[10px] shrink-0 cursor-pointer"
                                  >
                                    {isEditingTx ? 'Close' : 'Edit TX'}
                                  </button>
                                )}
                              </div>

                              {isEditingTx && onUpdatePonPort && (
                                <div className="pt-2 border-t border-slate-800 space-y-2">
                                  <div className="grid grid-cols-4 gap-1">
                                    {SFP_TX_PRESETS.map((preset) => (
                                      <button
                                        key={preset.sfpClass}
                                        type="button"
                                        onClick={() =>
                                          setPonTxDrafts((prev) => ({
                                            ...prev,
                                            [port.id]: preset.txPowerDbm,
                                          }))
                                        }
                                        className={`py-1 rounded border text-[10px] font-bold cursor-pointer ${
                                          Math.abs(draftTx - preset.txPowerDbm) < 0.05
                                            ? 'bg-sky-600 text-slate-950 border-sky-300'
                                            : 'bg-slate-950 text-slate-300 border-slate-700'
                                        }`}
                                      >
                                        {preset.sfpClass} +{preset.txPowerDbm.toFixed(1)}
                                      </button>
                                    ))}
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <input
                                      type="number"
                                      step="0.1"
                                      min="-5"
                                      max="12"
                                      value={draftTx}
                                      onChange={(e) =>
                                        setPonTxDrafts((prev) => ({
                                          ...prev,
                                          [port.id]: Number(e.target.value),
                                        }))
                                      }
                                      className="w-24 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-white tabular-nums"
                                    />
                                    <span className="text-[10px] text-slate-400 flex-1">
                                      dBm ({inferSfpClassFromDbm(draftTx)})
                                    </span>
                                    <button
                                      type="button"
                                      disabled={isSaving}
                                      onClick={async () => {
                                        const clamped = Math.max(-5, Math.min(12, Number(draftTx)));
                                        const cls: OltSfpClass = inferSfpClassFromDbm(clamped);
                                        await onUpdatePonPort(port.id, {
                                          tx_power_dbm: clamped,
                                          sfp_class: cls,
                                        });
                                        setEditingPonId(null);
                                      }}
                                      className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-[10px] cursor-pointer"
                                    >
                                      Save TX
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            }

            return (
              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5 font-mono">
                <label className="block text-[10px] uppercase tracking-wider text-sky-400 font-bold">
                  PON SFP Module TX Power (dBm)
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  {SFP_TX_PRESETS.map((preset) => (
                    <button
                      key={preset.sfpClass}
                      type="button"
                      onClick={() => setNodeTxPower(preset.txPowerDbm)}
                      className={`min-h-[38px] rounded-lg border text-[11px] font-bold transition cursor-pointer ${
                        Number(nodeTxPower) === preset.txPowerDbm
                          ? 'bg-sky-600 text-slate-950 border-sky-300'
                          : 'bg-slate-900 text-slate-300 border-slate-700 hover:border-slate-500'
                      }`}
                    >
                      {preset.sfpClass} +{preset.txPowerDbm.toFixed(1)}
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  step="0.1"
                  min="-5"
                  max="12"
                  value={nodeTxPower}
                  onChange={(e) => setNodeTxPower(Number(e.target.value))}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-sky-500 tabular-nums"
                />
              </div>
            );
          })()}

          {/* FOSC Joint Closure Splice Tray Matrix */}
          {node.node_type === 'FOSC_JOINT' && (
            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono uppercase tracking-wider text-purple-300 font-bold">
                  FOSC Joint Splice Tray Matrix
                </span>
                <span className="text-[10px] font-mono text-slate-400">
                  Input:{' '}
                  {budget?.inputDbm !== null && budget?.inputDbm !== undefined
                    ? `${budget.inputDbm.toFixed(2)} dBm`
                    : 'Unlinked'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 font-mono">
                <div>
                  <label className="block text-[10px] text-slate-400 mb-1">Tray Capacity (Cores)</label>
                  <select
                    value={nodeTrayCapacity}
                    onChange={(e) => handleTrayCapacityChange(Number(e.target.value))}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-white"
                  >
                    {[2, 4, 6, 8, 12, 24, 48].map((cap) => (
                      <option key={cap} value={cap}>
                        {cap} Cores
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-slate-400 mb-1">Splice Loss (dB)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="2"
                    value={nodeLossPerSplice}
                    onChange={(e) => setNodeLossPerSplice(Number(e.target.value))}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-white tabular-nums"
                  />
                </div>
              </div>

              <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-800 divide-y divide-slate-800/80">
                {spliceTrayDraft.map((row, idx) => {
                  const inColor = getTia598Color(row.coreIn);
                  const outColor = getTia598Color(row.coreOut);
                  return (
                    <div key={row.coreIn} className="p-2 bg-slate-900/70 space-y-1.5">
                      <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
                        <div className="flex items-center gap-1.5">
                          <span
                            className="w-3 h-3 rounded-sm border border-white/30"
                            style={{ backgroundColor: inColor.hex }}
                          />
                          <span className="text-white font-bold tabular-nums">
                            In #{row.coreIn} ({inColor.name})
                          </span>
                        </div>
                        <span className="text-slate-500">→</span>
                        <div className="flex items-center gap-1">
                          <span
                            className="w-3 h-3 rounded-sm border border-white/30"
                            style={{ backgroundColor: outColor.hex }}
                          />
                          <select
                            value={row.coreOut}
                            onChange={(e) => {
                              const val = Number(e.target.value);
                              setSpliceTrayDraft((prev) =>
                                prev.map((r, i) => (i === idx ? { ...r, coreOut: val } : r))
                              );
                            }}
                            className="bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-[11px] text-white"
                          >
                            {Array.from({ length: nodeTrayCapacity }, (_, c) => c + 1).map((n) => (
                              <option key={n} value={n}>
                                Out #{n} ({getTia598Color(n).name})
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-1.5">
                        <select
                          value={row.status}
                          onChange={(e) => {
                            const status = e.target.value as GisSpliceStatus;
                            setSpliceTrayDraft((prev) =>
                              prev.map((r, i) => (i === idx ? { ...r, status } : r))
                            );
                          }}
                          className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-200"
                        >
                          <option value="Straight Splice">Straight Splice</option>
                          <option value="Cross Splice">Cross Splice</option>
                          <option value="Cut / Dead">Cut / Dead</option>
                        </select>
                        <input
                          type="text"
                          value={row.note || ''}
                          onChange={(e) => {
                            const note = e.target.value;
                            setSpliceTrayDraft((prev) =>
                              prev.map((r, i) => (i === idx ? { ...r, note } : r))
                            );
                          }}
                          placeholder="Downstream area / splitter..."
                          className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-[11px] text-white placeholder-slate-500"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Optional FOSC Joint Internal FBT Ratio / PLC Splitter Card */}
          {node.node_type === 'FOSC_JOINT' && currentSplitterSpec.type !== 'none' && (
            <div className="p-3.5 rounded-xl bg-indigo-950/35 border border-indigo-700/60 space-y-2 font-mono">
              <div className="flex items-center justify-between text-[11px] font-bold text-indigo-300">
                <span>Joint Internal Splitter ({nodeSplitter})</span>
                {onInitializeSplitterOutputs && (
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={() =>
                      onInitializeSplitterOutputs({
                        node,
                        splitterType: nodeSplitter,
                        totalPorts,
                        inputDbm: budget?.inputDbm ?? null,
                      })
                    }
                    className="px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] cursor-pointer"
                  >
                    Sync {nodeSplitter} Legs
                  </button>
                )}
              </div>
              {fbtLegs ? (
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="p-2 rounded bg-slate-950/80 border border-slate-800">
                    <span className="text-[10px] text-slate-400 block">
                      Drop ({fbtLegs.dropPercent}% · -{fbtLegs.dropLossDb}dB)
                    </span>
                    <span className="text-emerald-300 font-bold tabular-nums">
                      {fbtLegs.dropOutputDbm !== null ? `${fbtLegs.dropOutputDbm.toFixed(2)} dBm` : '—'}
                    </span>
                  </div>
                  <div className="p-2 rounded bg-slate-950/80 border border-slate-800">
                    <span className="text-[10px] text-slate-400 block">
                      Thru ({fbtLegs.thruPercent}% · -{fbtLegs.thruLossDb}dB)
                    </span>
                    <span className="text-sky-300 font-bold tabular-nums">
                      {fbtLegs.thruOutputDbm !== null ? `${fbtLegs.thruOutputDbm.toFixed(2)} dBm` : '—'}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="text-[11px] text-emerald-300 font-bold tabular-nums">
                  {totalPorts}× Ports · Est. Output:{' '}
                  {budget?.ontRxDbm !== null && budget?.ontRxDbm !== undefined
                    ? `${budget.ontRxDbm.toFixed(2)} dBm`
                    : 'Unlinked'}
                </div>
              )}
            </div>
          )}

          {/* Node General Properties (Always visible for editing name/area/splitter) */}
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
            <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400 font-bold block">
              Hardware Properties
            </span>

            <div className="space-y-2.5">
              <div>
                <label className="block text-[10px] font-mono text-slate-400 mb-1">Node Name / ID</label>
                <input
                  type="text"
                  value={nodeName}
                  onChange={(e) => setNodeName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-[10px] font-mono text-slate-400 mb-1">Area / Sector</label>
                <input
                  type="text"
                  list="gis-area-suggestions"
                  value={nodeArea}
                  onChange={(e) => setNodeArea(e.target.value)}
                  placeholder="e.g. Baza Mohallah, Lahore Road..."
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
                />
                <datalist id="gis-area-suggestions">
                  {DEFAULT_NETWORK_AREAS.map((a) => (
                    <option key={a.area_name} value={a.area_name} />
                  ))}
                </datalist>
              </div>

              {node.node_type !== 'OLT' && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] font-mono text-slate-400 mb-1">
                        Splitter / Ratio Mode
                      </label>
                      <select
                        value={nodeSplitter}
                        onChange={(e) => handleSplitterChange(e.target.value as GisSplitterType)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white"
                      >
                        {(Object.keys(SPLITTER_SPECS) as GisSplitterType[]).map((k) => (
                          <option key={k} value={k}>
                            {SPLITTER_SPECS[k].label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-mono text-slate-400 mb-1">
                        Box Port Capacity (4–48P)
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={48}
                        value={nodeBoxCapacity}
                        onChange={(e) => {
                          const v = Math.max(0, Math.min(48, Number(e.target.value) || 0));
                          setNodeBoxCapacity(v);
                          setNodeTotalPorts(v);
                        }}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-white tabular-nums"
                      />
                    </div>
                  </div>

                  {nodeSplitter !== 'none' && onInitializeSplitterOutputs && (
                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={() =>
                        onInitializeSplitterOutputs({
                          node,
                          splitterType: nodeSplitter,
                          totalPorts: nodeTotalPorts,
                          inputDbm: budget?.inputDbm ?? null,
                        })
                      }
                      className="w-full min-h-[36px] px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 text-[11px] font-mono font-semibold cursor-pointer"
                    >
                      Generate / Sync {nodeSplitter} Output Legs in DB
                    </button>
                  )}

                  <div className="grid grid-cols-1 gap-2.5">
                    <div>
                      <label className="block text-[10px] font-mono text-slate-400 mb-1">
                        Incoming Feed Cable
                      </label>
                      <SearchableCombobox
                        value={nodeFeedCableId}
                        options={connectedCableOptions}
                        onChange={(val) => setNodeFeedCableId(val)}
                        emptyOptionLabel="Auto (Best OLT Path)"
                        searchPlaceholder="Search upstream cable or dBm..."
                        accentColor="cyan"
                        ariaLabel="Incoming Feed Cable"
                      />
                      {budget?.parentOutputDbm !== null && budget?.parentOutputDbm !== undefined && (
                        <span className="block text-[10px] font-mono text-cyan-400 mt-1">
                          Inherits {nodesById[budget.parentNodeId || '']?.name || 'parent'} output ({budget.parentOutputDbm >= 0 ? '+' : ''}
                          {budget.parentOutputDbm.toFixed(1)} dBm)
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] font-mono text-slate-400 mb-1">
                          Incoming Core #
                        </label>
                        <select
                          value={nodeFeedCore}
                          onChange={(e) => setNodeFeedCore(Number(e.target.value))}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white"
                        >
                          {Array.from({ length: 48 }, (_, i) => i + 1).map((num) => (
                            <option key={num} value={num}>
                              Core #{num} ({getTia598Color(num).name})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-mono text-slate-400 mb-1">
                          Feed Core / Pair Label
                        </label>
                        <input
                          type="text"
                          value={nodeFeedCorePair}
                          onChange={(e) => setNodeFeedCorePair(e.target.value)}
                          placeholder={`Core #${nodeFeedCore} (${getTia598Color(nodeFeedCore).name})`}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-white"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-mono text-slate-400 mb-1">
                        Source PON Port
                      </label>
                      <SearchableCombobox
                        value={nodePonPortId}
                        options={allPonPortOptions}
                        onChange={(val) => setNodePonPortId(val)}
                        emptyOptionLabel="Auto (Inherited)"
                        searchPlaceholder="Search OLT or PON port..."
                        accentColor="sky"
                        ariaLabel="Source PON Port"
                      />
                    </div>
                  </div>
                </>
              )}

              <div>
                <label className="block text-[10px] font-mono text-slate-400 mb-1">Field Notes</label>
                <textarea
                  rows={2}
                  value={nodeNotes}
                  onChange={(e) => setNodeNotes(e.target.value)}
                  placeholder="Pole number, building landmark, splitter ID..."
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>
          </div>

          {/* Swap History Preview for OLT / FOSC_JOINT nodes (Signal tab handles FDB_FAT/DIST_NODE) */}
          {(node.node_type === 'FOSC_JOINT' || node.node_type === 'OLT') && (
            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-mono uppercase tracking-wider text-amber-300 font-bold flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5" />
                  Equipment Swap History Log
                </span>
              </div>
              {Array.isArray(node.equipment_history) && node.equipment_history.length > 0 ? (
                <div className="space-y-1.5 max-h-44 overflow-y-auto">
                  {node.equipment_history.map((entry) => (
                    <div
                      key={entry.id}
                      className="p-2 rounded-lg bg-slate-900 border border-slate-800 space-y-1 text-[11px]"
                    >
                      <div className="text-slate-100 font-medium leading-snug">{entry.summary}</div>
                      <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono text-slate-400">
                        <span>By {entry.actor || 'Admin'}</span>
                        {entry.deducted_inventory_item && (
                          <span className="text-amber-300">-1: {entry.deducted_inventory_item}</span>
                        )}
                        {entry.returned_inventory_item && (
                          <span className="text-emerald-300">+1: {entry.returned_inventory_item}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[11px] text-slate-500 font-mono">
                  No equipment upgrades recorded yet.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Sticky Footer Upgrade / Save / Delete Bar */}
        <div className="p-3 border-t border-slate-800 bg-slate-950 flex flex-col gap-2 shrink-0">
          {localSaveError && (
            <div className="p-2 rounded-lg bg-rose-950/90 border border-rose-700 text-[11px] font-mono text-rose-200 flex items-start justify-between gap-2">
              <span className="leading-snug break-words">{localSaveError}</span>
              <button
                type="button"
                onClick={() => setLocalSaveError(null)}
                className="text-rose-300 hover:text-white shrink-0 cursor-pointer"
                aria-label="Dismiss save error"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          {onOpenUpgradeModal && (
            <button
              type="button"
              disabled={isSaving || localSaving}
              onClick={() => onOpenUpgradeModal(node)}
              className="w-full min-h-[40px] px-3 py-2 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/60 text-amber-300 font-mono font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer transition"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Upgrade / Replace Equipment</span>
            </button>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isSaving || localSaving}
              onClick={handleSaveNodeClick}
              className="flex-1 min-h-[44px] px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-slate-950 font-mono font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Save className="w-4 h-4" />
              <span>{isSaving || localSaving ? 'Saving...' : 'Save Node Changes'}</span>
            </button>

            {!confirmDelete ? (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="min-h-[44px] px-3 py-2 rounded-xl bg-slate-900 hover:bg-rose-950 text-rose-400 border border-slate-800 hover:border-rose-800 text-xs font-mono flex items-center justify-center gap-1 cursor-pointer"
                title="Delete node"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                disabled={isSaving || localSaving}
                onClick={() => onDeleteNode(node.id)}
                className="min-h-[44px] px-3 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-mono font-bold text-xs flex items-center gap-1 cursor-pointer"
              >
                <ShieldAlert className="w-3.5 h-3.5" />
                <span>Confirm</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderCableInspector = (cable: SupabaseGisCable) => {
    const src = nodesById[cable.source_node_id];
    const dst = nodesById[cable.target_node_id];
    const activePreset =
      CABLE_CAPACITY_PRESETS.find((p) => p.id === cablePresetId) ||
      CABLE_CAPACITY_PRESETS.find((p) => p.cores === cable.cable_cores) ||
      CABLE_CAPACITY_PRESETS[6];
    const effectiveMeters = Math.max(0, Number(cableDistanceMeters || 0));
    const fiberLossDb = (effectiveMeters / 1000) * 0.35;
    const feedPonPort = cableSourcePonPortId ? ponPortsById[cableSourcePonPortId] : undefined;
    const feedOlt = cableSourceOltId ? oltsById[cableSourceOltId] : undefined;
    const coreSummary = summarizeCableCores(cableCoresDraft, activePreset.cores);
    const selectedOltPons = cableSourceOltId
      ? (ponPortsByOltId[cableSourceOltId] || [])
          .slice()
          .sort((a, b) => a.port_number - b.port_number)
      : [];

    const defaultOriginLabel = feedPonPort
      ? `${feedOlt?.name || src?.name || 'OLT'} PON-${feedPonPort.port_number}`
      : feedOlt
      ? feedOlt.name
      : src?.name || '';

    const sourceSuggestions: string[] = [];
    for (const o of olts) {
      const pps = (ponPortsByOltId[o.id] || []).slice().sort((a, b) => a.port_number - b.port_number);
      for (const pp of pps) {
        sourceSuggestions.push(`${o.name} · PON-${pp.port_number} (${pp.port_label || 'Main'})`);
      }
    }
    for (const n of nodes) {
      if (n.node_type === 'FOSC_JOINT' || n.node_type === 'DIST_NODE') {
        sourceSuggestions.push(`${n.name} · Core #1`);
      }
    }

    const getLedgerSelectClass = (ledger: GisCoreLedgerStatus) => {
      switch (ledger) {
        case 'ACTIVE':
          return 'bg-emerald-950/90 text-emerald-300 border-emerald-700';
        case 'RESERVED':
          return 'bg-amber-950/90 text-amber-300 border-amber-700';
        case 'FAULTY':
          return 'bg-rose-950/90 text-rose-300 border-rose-700';
        default:
          return 'bg-slate-900 text-slate-300 border-slate-700';
      }
    };

    return (
      <div className="flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-slate-800 bg-slate-950/90 flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] font-mono text-cyan-400">
              <Cable className="w-3.5 h-3.5 shrink-0" />
              <span className="uppercase font-bold">{activePreset.label}</span>
              <span>·</span>
              <span className="tabular-nums text-white">{effectiveMeters}m</span>
              <span>·</span>
              <span className="tabular-nums text-emerald-300">
                {coreSummary.litCount}/{coreSummary.total} Lit
              </span>
            </div>
            <h3 className="text-sm font-bold text-white truncate mt-0.5">
              {cableName || cable.name || `${src?.name || 'Node'} → ${dst?.name || 'Node'}`}
            </h3>
            <p className="text-[11px] text-slate-400 font-mono mt-0.5 tabular-nums">
              {src?.name || 'Start'} &rarr; {dst?.name || 'End'} · -{fiberLossDb.toFixed(2)} dB @ 0.35 dB/km
            </p>
            {feedPonPort && (
              <p className="text-[11px] text-sky-300 font-mono mt-0.5 truncate">
                Fed by {feedOlt?.name || src?.name || 'OLT'} · PON-{feedPonPort.port_number} (
                {feedPonPort.port_label || 'Main'}) · +{Number(feedPonPort.tx_power_dbm).toFixed(1)} dBm
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white cursor-pointer"
            aria-label="Close cable inspector"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
          {/* Core Summary Counters Bar */}
          <div className="grid grid-cols-4 gap-1.5 p-2.5 rounded-xl bg-slate-950 border border-slate-800 font-mono text-center">
            <div>
              <span className="text-[9px] text-emerald-400 uppercase block">Active / Lit</span>
              <span className="text-xs font-bold text-emerald-300 tabular-nums">
                {coreSummary.litCount}
              </span>
            </div>
            <div>
              <span className="text-[9px] text-amber-400 uppercase block">Reserved</span>
              <span className="text-xs font-bold text-amber-300 tabular-nums">
                {coreSummary.reservedCount}
              </span>
            </div>
            <div>
              <span className="text-[9px] text-slate-400 uppercase block">Spare / Dark</span>
              <span className="text-xs font-bold text-cyan-300 tabular-nums">
                {coreSummary.spareCount}
              </span>
            </div>
            <div>
              <span className="text-[9px] text-rose-400 uppercase block">Faulty / Cut</span>
              <span className="text-xs font-bold text-rose-300 tabular-nums">
                {coreSummary.faultyCount}
              </span>
            </div>
          </div>

          {/* One-Click Cable Cut & FOSC Joint Box Insertion */}
          <div className="p-3.5 rounded-xl bg-purple-950/35 border border-purple-700/60 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-mono font-bold uppercase text-purple-300 flex items-center gap-1.5">
                <Scissors className="w-3.5 h-3.5" />
                Cable Cut &amp; Repair Workflow
              </span>
              {cableClickPoint && (
                <span className="text-[10px] font-mono text-purple-200 tabular-nums">
                  Point Ready
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-300 leading-relaxed">
              Insert a FOSC Joint Closure directly on this span. Both resulting spans preserve all{' '}
              {activePreset.cores} TIA-598 core mappings and notes.
            </p>
            <button
              type="button"
              disabled={isSaving}
              onClick={() => onSplitCable(cable, cableClickPoint || undefined)}
              className="w-full min-h-[42px] px-3 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-mono font-bold text-xs flex items-center justify-center gap-2 shadow-lg cursor-pointer transition"
            >
              <Scissors className="w-4 h-4" />
              <span>Split Cable Here (Insert FOSC Joint Box)</span>
            </button>
          </div>

          {/* Span Name, Capacity, Length & Origin OLT/PON Binding */}
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5">
            <div>
              <label className="block text-[10px] font-mono text-slate-400 mb-1">Span Name / Tag</label>
              <input
                type="text"
                value={cableName}
                onChange={(e) => setCableName(e.target.value)}
                placeholder={`${src?.name || 'Start'} → ${dst?.name || 'End'}`}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-2 font-mono">
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">Cable Capacity</label>
                <select
                  value={cablePresetId}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    setCablePresetId(nextId);
                    const preset = CABLE_CAPACITY_PRESETS.find((p) => p.id === nextId);
                    if (preset) {
                      setCableCoresDraft((prev) => normalizeCableCores(preset.cores, prev));
                    }
                  }}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] font-bold text-cyan-300"
                >
                  {CABLE_CAPACITY_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label} ({p.cores}C)
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">Total Meters</label>
                <input
                  type="number"
                  min={1}
                  max={50000}
                  value={cableDistanceMeters}
                  onChange={(e) => setCableDistanceMeters(Number(e.target.value))}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-[11px] text-white tabular-nums"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono">
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">Source OLT</label>
                <SearchableCombobox
                  compact
                  value={cableSourceOltId}
                  options={olts.map((o) => ({
                    value: o.id,
                    label: o.name,
                    sublabel: `${o.pon_mode} · ${o.total_pon_ports} PON`,
                    metricTone: 'sky',
                  }))}
                  onChange={(nextOlt) => {
                    setCableSourceOltId(nextOlt);
                    const pps = nextOlt ? ponPortsByOltId[nextOlt] || [] : [];
                    setCableSourcePonPortId(pps[0]?.id || '');
                  }}
                  emptyOptionLabel="None / Unassigned"
                  searchPlaceholder="Search OLT..."
                  accentColor="sky"
                  ariaLabel="Cable Source OLT"
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">Source PON Port</label>
                <SearchableCombobox
                  compact
                  value={cableSourcePonPortId}
                  options={selectedOltPons.map((pp) => ({
                    value: pp.id,
                    label: `PON-${pp.port_number}`,
                    sublabel: pp.port_label || 'Main',
                    metric: `+${Number(pp.tx_power_dbm).toFixed(1)} dBm`,
                    metricTone: 'emerald',
                  }))}
                  onChange={(val) => setCableSourcePonPortId(val)}
                  emptyOptionLabel="Auto / Any PON"
                  searchPlaceholder="Search PON port..."
                  accentColor="cyan"
                  ariaLabel="Cable Source PON Port"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-mono text-slate-400 mb-1">Route Notes</label>
              <input
                type="text"
                value={cableNotes}
                onChange={(e) => setCableNotes(e.target.value)}
                placeholder="Pole #, aerial duct, street notes..."
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500"
              />
            </div>

            {defaultOriginLabel && (
              <button
                type="button"
                onClick={() =>
                  setCableCoresDraft((prev) =>
                    prev.map((c) => {
                      const ledger = coreStatusToLedgerStatus(c.status, c.core_status);
                      return ledger !== 'SPARE' && !c.origin_olt_label && !c.source_signal
                        ? {
                            ...c,
                            origin_olt_id: cableSourceOltId || null,
                            origin_pon_port_id: cableSourcePonPortId || null,
                            origin_olt_label: defaultOriginLabel,
                            source_signal: defaultOriginLabel,
                          }
                        : c;
                    })
                  )
                }
                className="w-full py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[10px] font-mono text-sky-300 cursor-pointer"
              >
                Tag Used Cores with Origin: {defaultOriginLabel}
              </button>
            )}
          </div>

          {/* TIA-598 Core & Pair Allocation Manager */}
          <div className="space-y-2">
            <div className="flex items-center justify-between font-mono">
              <span className="text-[11px] uppercase tracking-wider text-slate-300 font-bold">
                Core &amp; Pair Signal Routing ({cableCoresDraft.length}C)
              </span>
              <span className="text-[10px] text-emerald-400">
                {coreSummary.litCount} Lit · {coreSummary.spareCount} Spare
              </span>
            </div>

            <datalist id="gis-core-source-list">
              {sourceSuggestions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>

            <datalist id="gis-core-dest-list">
              {nodes.map((n) => (
                <option key={n.id} value={`${n.name}${n.area_name ? ` (${n.area_name})` : ''}`} />
              ))}
              {DEFAULT_NETWORK_AREAS.map((a) => (
                <option key={a.area_name} value={a.area_name} />
              ))}
            </datalist>

            <div className="rounded-xl border border-slate-800 divide-y divide-slate-800/80 bg-slate-950 overflow-hidden">
              {cableCoresDraft.map((core, idx) => {
                const ledgerStatus = coreStatusToLedgerStatus(core.status, core.core_status);
                return (
                  <div key={core.coreNumber} className="p-2.5 space-y-1.5">
                    <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-3.5 h-3.5 rounded-sm border border-white/40 shrink-0"
                          style={{ backgroundColor: core.coreColorHex }}
                          title={`Core ${core.coreColorName}`}
                        />
                        <span className="font-bold text-white tabular-nums">
                          #{core.coreNumber} {core.coreColorName}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                        <span
                          className="w-2.5 h-2.5 rounded-full border border-white/30"
                          style={{ backgroundColor: core.tubeColorHex }}
                        />
                        <span>
                          Tube #{core.tubeNumber} ({core.tubeColorName})
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-1.5">
                      <select
                        value={ledgerStatus}
                        onChange={(e) => {
                          const nextLedger = e.target.value as GisCoreLedgerStatus;
                          const nextLegacyStatus = ledgerStatusToCoreStatus(
                            nextLedger,
                            core.destination_target || core.forwarded_to_area
                          );
                          setCableCoresDraft((prev) =>
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
                        className={`border rounded-lg px-2 py-1.5 text-[11px] font-mono font-bold ${getLedgerSelectClass(
                          ledgerStatus
                        )}`}
                      >
                        <option value="ACTIVE">ACTIVE / LIT</option>
                        <option value="SPARE">SPARE / DARK</option>
                        <option value="RESERVED">RESERVED</option>
                        <option value="FAULTY">FAULTY / CUT</option>
                      </select>

                      <input
                        type="text"
                        list="gis-core-dest-list"
                        value={
                          core.destination_target ??
                          core.forwarded_to_area ??
                          core.destinationNote ??
                          ''
                        }
                        onChange={(e) => {
                          const val = e.target.value;
                          setCableCoresDraft((prev) =>
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
                        placeholder="To FAT / FDB / Splitter..."
                        className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] text-white placeholder-slate-500"
                      />
                    </div>

                    <div className="grid grid-cols-12 gap-1.5">
                      <input
                        type="text"
                        list="gis-core-source-list"
                        value={core.source_signal ?? core.origin_olt_label ?? ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          setCableCoresDraft((prev) =>
                            prev.map((item, i) =>
                              i === idx
                                ? { ...item, source_signal: val, origin_olt_label: val }
                                : item
                            )
                          );
                        }}
                        placeholder="From NOC / OLT & PON..."
                        className="col-span-5 bg-slate-900/80 border border-slate-800 rounded-lg px-2 py-1 text-[10px] font-mono text-sky-200 placeholder-slate-600"
                      />
                      <input
                        type="text"
                        value={core.optical_power_dbm || ''}
                        onChange={(e) => {
                          const optical_power_dbm = e.target.value;
                          setCableCoresDraft((prev) =>
                            prev.map((item, i) =>
                              i === idx ? { ...item, optical_power_dbm } : item
                            )
                          );
                        }}
                        placeholder="Power dBm"
                        className="col-span-3 bg-slate-900/80 border border-slate-800 rounded-lg px-2 py-1 text-[10px] font-mono text-cyan-300 tabular-nums placeholder-slate-600"
                      />
                      <input
                        type="text"
                        value={core.remarks || ''}
                        onChange={(e) => {
                          const remarks = e.target.value;
                          setCableCoresDraft((prev) =>
                            prev.map((item, i) => (i === idx ? { ...item, remarks } : item))
                          );
                        }}
                        placeholder="Notes..."
                        className="col-span-4 bg-slate-900/80 border border-slate-800 rounded-lg px-2 py-1 text-[10px] text-slate-200 placeholder-slate-600"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Sticky Footer */}
        <div className="p-3 border-t border-slate-800 bg-slate-950 flex items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={isSaving}
            onClick={() =>
              onSaveCable(cable.id, {
                name: cableName.trim(),
                cable_type: activePreset.cableType as GisCableTypeCode,
                cable_cores: activePreset.cores,
                distance_meters: Math.max(1, Math.round(Number(cableDistanceMeters) || 1)),
                notes: cableNotes.trim(),
                source_olt_id: cableSourceOltId || null,
                source_pon_port_id: cableSourcePonPortId || null,
                cores_tia598_json: normalizeCableCores(activePreset.cores, cableCoresDraft),
                cores_allocation_json: normalizeCableCores(activePreset.cores, cableCoresDraft),
              })
            }
            className="flex-1 min-h-[44px] px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-slate-950 font-mono font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Save className="w-4 h-4" />
            <span>{isSaving ? 'Saving...' : 'Save Core Allocation'}</span>
          </button>

          {!confirmDelete ? (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="min-h-[44px] px-3 py-2 rounded-xl bg-slate-900 hover:bg-rose-950 text-rose-400 border border-slate-800 text-xs font-mono flex items-center justify-center cursor-pointer"
              title="Delete cable span"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              disabled={isSaving}
              onClick={() => onDeleteCable(cable.id)}
              className="min-h-[44px] px-3 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-mono font-bold text-xs flex items-center gap-1 cursor-pointer"
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Confirm</span>
            </button>
          )}
        </div>
      </div>
    );
  };

  const body = selectedNode
    ? renderNodeInspector(selectedNode)
    : selectedCable
    ? renderCableInspector(selectedCable)
    : null;

  return (
    <>
      {/* Desktop Right-Side Drawer */}
      <aside className="hidden lg:flex lg:flex-col w-[460px] xl:w-[500px] h-full bg-slate-900 border-l border-slate-800 shrink-0 shadow-2xl z-20">
        {body}
      </aside>

      {/* Mobile Slide-Up Bottom Sheet */}
      <div className="lg:hidden fixed inset-x-0 bottom-0 z-40 flex flex-col max-h-[82vh] bg-slate-900 border-t border-slate-700 rounded-t-3xl shadow-2xl overflow-hidden">
        <div className="py-2 bg-slate-950 flex justify-center shrink-0" onClick={onClose}>
          <div className="w-10 h-1.5 bg-slate-700 rounded-full" />
        </div>
        <div className="flex-1 overflow-hidden flex flex-col">{body}</div>
      </div>
    </>
  );
};
