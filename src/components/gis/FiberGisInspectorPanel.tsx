import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Cable,
  CheckCircle2,
  ClipboardCheck,
  GitBranch,
  Layers,
  Navigation,
  Phone,
  Radio,
  Save,
  Scissors,
  Search,
  Server,
  ShieldAlert,
  Trash2,
  UserPlus,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import type {
  GisCoreEntry,
  GisCoreStatus,
  GisLatLng,
  GisNodeType,
  GisPortStatus,
  GisSpliceEntry,
  GisSpliceStatus,
  GisSplitterCategory,
  GisSplitterType,
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
  NodeOpticalBudgetResult,
  SFP_CLASS_SPECS,
  SFP_TX_PRESETS,
  SPLITTER_SPECS,
  coreStatusToUsageType,
  generateDefaultSpliceTray,
  getDefaultMaxOnuLimit,
  getFbtLegOutputs,
  getHealthBadgeColors,
  getNodeTypeLabel,
  getTia598Color,
  inferSfpClassFromDbm,
  inferSplitterCategory,
  normalizeCableCores,
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
}) => {
  const [fdbSubTab, setFdbSubTab] = useState<'ports' | 'signal'>('ports');
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
  const [nodeFeedCableId, setNodeFeedCableId] = useState<string>('');
  const [nodeFeedCore, setNodeFeedCore] = useState<number>(1);
  const [nodeFeedCorePair, setNodeFeedCorePair] = useState<string>('');
  const [nodePonPortId, setNodePonPortId] = useState<string>('');
  const [nodeTrayCapacity, setNodeTrayCapacity] = useState<number>(12);
  const [nodeLossPerSplice, setNodeLossPerSplice] = useState<number>(0.08);
  const [nodeNotes, setNodeNotes] = useState('');
  const [spliceTrayDraft, setSpliceTrayDraft] = useState<GisSpliceEntry[]>([]);

  // Cable editable draft
  const [cableName, setCableName] = useState('');
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
    setSubSearch('');
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
      setNodeTotalPorts(Number(selectedNode.total_ports ?? 8));
      setNodeFeedCableId(selectedNode.feed_cable_id || '');
      setNodeFeedCore(Number(selectedNode.feed_core_number ?? 1));
      setNodeFeedCorePair(selectedNode.feed_core_pair || '');
      setNodePonPortId(selectedNode.pon_port_id || '');
      const cap = Number(selectedNode.tray_capacity ?? 12);
      setNodeTrayCapacity(cap);
      setNodeLossPerSplice(Number(selectedNode.loss_per_splice ?? 0.08));
      setNodeNotes(selectedNode.notes || '');
      setSpliceTrayDraft(
        Array.isArray(selectedNode.splice_tray_json) && selectedNode.splice_tray_json.length > 0
          ? selectedNode.splice_tray_json
          : generateDefaultSpliceTray(cap)
      );
    }
  }, [selectedNode]);

  useEffect(() => {
    setConfirmDelete(false);
    if (selectedCable) {
      setCableName(selectedCable.name || '');
      setCableSourceOltId(selectedCable.source_olt_id || '');
      setCableSourcePonPortId(selectedCable.source_pon_port_id || '');
      const rawCores =
        selectedCable.cores_allocation_json && selectedCable.cores_allocation_json.length > 0
          ? selectedCable.cores_allocation_json
          : selectedCable.cores_tia598_json;
      setCableCoresDraft(normalizeCableCores(selectedCable.cable_cores, rawCores));
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

  if (!selectedNode && !selectedCable) {
    return null;
  }

  const handleSplitterChange = (nextType: GisSplitterType) => {
    setNodeSplitter(nextType);
    setNodeSplitterCat(inferSplitterCategory(nextType));
    const spec = SPLITTER_SPECS[nextType];
    if (spec) {
      setNodeTotalPorts(spec.defaultPorts);
    }
  };

  const handleSaveNodeClick = async () => {
    if (!selectedNode) return;
    await onSaveNode(selectedNode.id, {
      name: nodeName.trim() || selectedNode.name,
      area_name: nodeArea.trim(),
      tx_power_dbm: Number(nodeTxPower),
      splitter_category: nodeSplitterCat,
      splitter_type: nodeSplitter,
      total_ports: Math.max(0, Math.min(32, Number(nodeTotalPorts) || 0)),
      feed_cable_id: nodeFeedCableId || null,
      feed_core_number: Number(nodeFeedCore) || 1,
      feed_core_pair: nodeFeedCorePair.trim(),
      pon_port_id: nodePonPortId || null,
      tray_capacity: Math.max(2, Math.min(48, Number(nodeTrayCapacity) || 12)),
      loss_per_splice: Number(nodeLossPerSplice) || 0.08,
      splice_tray_json: spliceTrayDraft,
      notes: nodeNotes,
    });
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
    const budget = budgetsByNodeId[node.id];
    const healthStyle = getHealthBadgeColors(budget?.healthBand || 'UNLINKED');
    const nodePorts = portsByNodeId[node.id] || [];
    const nodeOutputs = splitterOutputsByNodeId[node.id] || [];
    const portsByNumber: Record<number, SupabaseGisFdbPort> = {};
    for (const p of nodePorts) portsByNumber[p.port_number] = p;
    const outputsByNumber: Record<number, SupabaseGisSplitterOutput> = {};
    for (const o of nodeOutputs) outputsByNumber[o.port_number] = o;

    const currentSplitterSpec = SPLITTER_SPECS[nodeSplitter] || SPLITTER_SPECS['none'];
    const totalPorts =
      currentSplitterSpec.type !== 'none'
        ? currentSplitterSpec.isAsymmetricFbt
          ? 2
          : Math.max(1, Number(node.total_ports ?? currentSplitterSpec.defaultPorts ?? 8))
        : Math.max(0, Number(node.total_ports ?? 0));

    let usedCount = 0;
    for (let i = 1; i <= totalPorts; i++) {
      const out = outputsByNumber[i];
      const fdbP = portsByNumber[i];
      if (out ? out.utilization_type !== 'FREE_PORT' : fdbP && fdbP.status !== 'FREE') {
        usedCount++;
      }
    }
    const freePorts = Math.max(0, totalPorts - usedCount);

    const incomingCoreNum = budget?.incomingCoreNumber || node.feed_core_number || 1;
    const incomingCoreSpec = getTia598Color(incomingCoreNum);
    const incomingTubeSpec = getTia598Color(Math.ceil(incomingCoreNum / 12));
    const fbtLegs = currentSplitterSpec.isAsymmetricFbt
      ? getFbtLegOutputs(budget?.inputDbm ?? null, nodeSplitter, nodeLossPerSplice)
      : null;

    const allPonPortOptions: Array<{ id: string; label: string }> = [];
    for (const o of olts) {
      const pps = (ponPortsByOltId[o.id] || []).slice().sort((a, b) => a.port_number - b.port_number);
      for (const pp of pps) {
        allPonPortOptions.push({
          id: pp.id,
          label: `${o.name} · PON-${pp.port_number} (${pp.port_label || 'Main'}) +${Number(
            pp.tx_power_dbm
          ).toFixed(1)}dBm`,
        });
      }
    }

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

        {/* Sub-tabs for FDB_FAT & DIST_NODE */}
        {(node.node_type === 'FDB_FAT' || node.node_type === 'DIST_NODE') && (
          <div className="px-4 pt-2.5 pb-2 border-b border-slate-800 bg-slate-900/80 grid grid-cols-2 gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setFdbSubTab('ports')}
              className={`min-h-[40px] px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition cursor-pointer flex items-center justify-center gap-1.5 ${
                fdbSubTab === 'ports'
                  ? 'bg-cyan-600 text-slate-950 shadow'
                  : 'bg-slate-950 text-slate-300 border border-slate-800 hover:border-slate-700'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>
                {totalPorts > 0 ? `Outputs (${freePorts}/${totalPorts} Free)` : 'Splitter & Legs'}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setFdbSubTab('signal')}
              className={`min-h-[40px] px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition cursor-pointer flex items-center justify-center gap-1.5 ${
                fdbSubTab === 'signal'
                  ? 'bg-cyan-600 text-slate-950 shadow'
                  : 'bg-slate-950 text-slate-300 border border-slate-800 hover:border-slate-700'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>Signal &amp; Triage</span>
            </button>
          </div>
        )}

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
          {/* FDB / DIST / FOSC Optical Summary Strip when applicable */}
          {(node.node_type === 'FDB_FAT' || node.node_type === 'DIST_NODE') && fdbSubTab === 'ports' && (
            <div className="space-y-3">
              {/* Quick Optical Summary Strip */}
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-2 font-mono">
                <div>
                  <span className="text-[10px] text-slate-400 uppercase block">
                    {node.splitter_type === 'none'
                      ? 'Pass-Through / No Splitter'
                      : `${node.splitter_type} ${
                          SPLITTER_SPECS[node.splitter_type]?.isAsymmetricFbt
                            ? 'FBT Ratio'
                            : 'PLC Splitter'
                        }`}
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
                  <span className="text-[10px] text-slate-400 uppercase block">Free Ports</span>
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
                    {freePorts} / {totalPorts}
                  </span>
                </div>
              </div>

              {/* Asymmetric FBT Leg Signal Preview */}
              {fbtLegs && (
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

              {/* Port Cards */}
              {totalPorts === 0 ? (
                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-slate-400 text-center">
                  No splitter ports configured on this box. Select a PLC or FBT splitter in Hardware Properties below.
                </div>
              ) : (
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

          {/* FDB / DIST Signal Tab: Optical Budget + Field Agent Fast Triage Card */}
          {(node.node_type === 'FDB_FAT' || node.node_type === 'DIST_NODE') && fdbSubTab === 'signal' && (
            <div className="space-y-4">
              {/* Optical Signal Budget Breakdown */}
              <div className={`p-3.5 rounded-xl border ${healthStyle.bgClass} ${healthStyle.borderClass} space-y-2.5`}>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono uppercase tracking-wider text-slate-300 font-bold">
                    Optical Power Budget
                  </span>
                  <span className={`text-xs font-mono font-bold ${healthStyle.textClass}`}>
                    {budget?.healthBand || 'UNLINKED'}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px] font-mono bg-slate-950/70 p-2.5 rounded-lg border border-slate-800/80">
                  <div>
                    <span className="text-slate-400 block text-[10px]">Upstream OLT TX</span>
                    <span className="text-sky-300 font-bold tabular-nums block">
                      {budget?.oltTxDbm !== null && budget?.oltTxDbm !== undefined
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
                      Span Loss ({budget?.totalDistanceMeters ?? 0}m)
                    </span>
                    <span className="text-amber-300 tabular-nums">
                      -{budget ? budget.fiberLossDb.toFixed(2) : '0.00'} dB
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">
                      Splices ({budget?.spliceCount ?? 0}×) &amp; Thru
                    </span>
                    <span className="text-amber-300 tabular-nums">
                      -{budget ? (budget.spliceLossDb + budget.upstreamThruLossDb).toFixed(2) : '0.00'} dB
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">Splitter ({nodeSplitter})</span>
                    <span className="text-amber-300 tabular-nums">
                      -{(SPLITTER_SPECS[nodeSplitter]?.dropLossDb ?? 0).toFixed(2)} dB
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">Est. ONT Rx</span>
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
                        Output Ports / Legs
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={32}
                        value={nodeTotalPorts}
                        onChange={(e) => setNodeTotalPorts(Number(e.target.value))}
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

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] font-mono text-slate-400 mb-1">
                        Incoming Feed Cable
                      </label>
                      <select
                        value={nodeFeedCableId}
                        onChange={(e) => setNodeFeedCableId(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white"
                      >
                        <option value="">Auto (Best OLT Path)</option>
                        {connectedCables.map((c) => {
                          const otherId =
                            c.source_node_id === node.id ? c.target_node_id : c.source_node_id;
                          const otherName = nodesById[otherId]?.name || 'Node';
                          return (
                            <option key={c.id} value={c.id}>
                              From {otherName} ({c.cable_cores}C · {c.distance_meters}m)
                            </option>
                          );
                        })}
                      </select>
                    </div>
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
                  </div>

                  <div className="grid grid-cols-2 gap-2">
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
                    <div>
                      <label className="block text-[10px] font-mono text-slate-400 mb-1">
                        Source PON Port
                      </label>
                      <select
                        value={nodePonPortId}
                        onChange={(e) => setNodePonPortId(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white"
                      >
                        <option value="">Auto (Inherited)</option>
                        {allPonPortOptions.map((opt) => (
                          <option key={opt.id} value={opt.id}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
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
        </div>

        {/* Sticky Footer Save / Delete Bar */}
        <div className="p-3 border-t border-slate-800 bg-slate-950 flex items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={isSaving}
            onClick={handleSaveNodeClick}
            className="flex-1 min-h-[44px] px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-slate-950 font-mono font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Save className="w-4 h-4" />
            <span>{isSaving ? 'Saving...' : 'Save Node Changes'}</span>
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
              disabled={isSaving}
              onClick={() => onDeleteNode(node.id)}
              className="min-h-[44px] px-3 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-mono font-bold text-xs flex items-center gap-1 cursor-pointer"
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>Confirm</span>
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderCableInspector = (cable: SupabaseGisCable) => {
    const src = nodesById[cable.source_node_id];
    const dst = nodesById[cable.target_node_id];
    const fiberLossDb = (Number(cable.distance_meters || 0) / 1000) * 0.35;
    const feedPonPort = cableSourcePonPortId ? ponPortsById[cableSourcePonPortId] : undefined;
    const feedOlt = cableSourceOltId ? oltsById[cableSourceOltId] : undefined;
    const coreSummary = summarizeCableCores(cableCoresDraft, cable.cable_cores);
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

    return (
      <div className="flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-slate-800 bg-slate-950/90 flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] font-mono text-cyan-400">
              <Cable className="w-3.5 h-3.5 shrink-0" />
              <span className="uppercase font-bold">{cable.cable_cores}-Core Fiber Span</span>
              <span>·</span>
              <span className="tabular-nums text-white">{cable.distance_meters}m</span>
            </div>
            <h3 className="text-sm font-bold text-white truncate mt-0.5">
              {cable.name || `${src?.name || 'Node'} → ${dst?.name || 'Node'}`}
            </h3>
            <p className="text-[11px] text-slate-400 font-mono mt-0.5 tabular-nums">
              Attenuation: -{fiberLossDb.toFixed(2)} dB @ 0.35 dB/km
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
              <span className="text-[9px] text-slate-400 uppercase block">Total</span>
              <span className="text-xs font-bold text-white tabular-nums">{coreSummary.total}C</span>
            </div>
            <div>
              <span className="text-[9px] text-emerald-400 uppercase block">Splitter</span>
              <span className="text-xs font-bold text-emerald-300 tabular-nums">
                {coreSummary.splitterCount}
              </span>
            </div>
            <div>
              <span className="text-[9px] text-indigo-400 uppercase block">Area Pass</span>
              <span className="text-xs font-bold text-indigo-300 tabular-nums">
                {coreSummary.passThroughCount}
              </span>
            </div>
            <div>
              <span className="text-[9px] text-slate-400 uppercase block">Free Dark</span>
              <span className="text-xs font-bold text-cyan-300 tabular-nums">
                {coreSummary.freeCount}
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
              {cable.cable_cores} TIA-598 core mappings and notes.
            </p>
            <button
              type="button"
              disabled={isSaving}
              onClick={() => onSplitCable(cable, cableClickPoint || undefined)}
              className="w-full min-h-[42px] px-3 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-mono font-bold text-xs flex items-center justify-center gap-2 shadow-lg cursor-pointer transition"
            >
              <Scissors className="w-4 h-4" />
              <span>✂️ Split Cable Here (Insert FOSC Joint Box)</span>
            </button>
          </div>

          {/* Span Name & Origin OLT/PON Binding */}
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5">
            <div>
              <label className="block text-[10px] font-mono text-slate-400 mb-1">Span Name</label>
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
                <label className="block text-[10px] text-slate-400 mb-1">Source OLT</label>
                <select
                  value={cableSourceOltId}
                  onChange={(e) => {
                    const nextOlt = e.target.value;
                    setCableSourceOltId(nextOlt);
                    const pps = nextOlt ? ponPortsByOltId[nextOlt] || [] : [];
                    setCableSourcePonPortId(pps[0]?.id || '');
                  }}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] text-white"
                >
                  <option value="">None / Unassigned</option>
                  {olts.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name} ({o.pon_mode})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">Source PON Port</label>
                <select
                  value={cableSourcePonPortId}
                  onChange={(e) => setCableSourcePonPortId(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] text-white"
                >
                  <option value="">Auto / Any PON</option>
                  {selectedOltPons.map((pp) => (
                    <option key={pp.id} value={pp.id}>
                      PON-{pp.port_number} ({pp.port_label || 'Main'}) +{Number(pp.tx_power_dbm).toFixed(1)}dBm
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {defaultOriginLabel && (
              <button
                type="button"
                onClick={() =>
                  setCableCoresDraft((prev) =>
                    prev.map((c) =>
                      c.status !== 'Free / Dark' && !c.origin_olt_label
                        ? {
                            ...c,
                            origin_olt_id: cableSourceOltId || null,
                            origin_pon_port_id: cableSourcePonPortId || null,
                            origin_olt_label: defaultOriginLabel,
                          }
                        : c
                    )
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
                Core &amp; Pair Allocation ({cable.cable_cores}C)
              </span>
              <span className="text-[10px] text-slate-400">
                {coreSummary.freeCount} Dark Free
              </span>
            </div>

            <datalist id="gis-core-dest-list">
              {nodes.map((n) => (
                <option key={n.id} value={`${n.name}${n.area_name ? ` (${n.area_name})` : ''}`} />
              ))}
              {DEFAULT_NETWORK_AREAS.map((a) => (
                <option key={a.area_name} value={a.area_name} />
              ))}
            </datalist>

            <div className="rounded-xl border border-slate-800 divide-y divide-slate-800/80 bg-slate-950 overflow-hidden">
              {cableCoresDraft.map((core, idx) => (
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
                        Tube {core.tubeNumber} ({core.tubeColorName})
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5">
                    <select
                      value={core.status}
                      onChange={(e) => {
                        const status = e.target.value as GisCoreStatus;
                        const usage_type = coreStatusToUsageType(status);
                        setCableCoresDraft((prev) =>
                          prev.map((item, i) =>
                            i === idx
                              ? {
                                  ...item,
                                  status,
                                  usage_type,
                                  origin_olt_label:
                                    status !== 'Free / Dark' && !item.origin_olt_label
                                      ? defaultOriginLabel
                                      : item.origin_olt_label,
                                }
                              : item
                          )
                        );
                      }}
                      className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] text-slate-200"
                    >
                      <option value="Feed / Splitter">Splitter Feed</option>
                      <option value="Through / Pass">Pass-Through to Area</option>
                      <option value="Free / Dark">Free / Dark Core</option>
                      <option value="Dead / High Loss">Dead / High Loss</option>
                    </select>
                    <input
                      type="text"
                      list="gis-core-dest-list"
                      value={core.forwarded_to_area || core.destinationNote || ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        setCableCoresDraft((prev) =>
                          prev.map((item, i) =>
                            i === idx
                              ? { ...item, forwarded_to_area: val, destinationNote: val }
                              : item
                          )
                        );
                      }}
                      placeholder="Target FAT / Next area..."
                      className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] text-white placeholder-slate-500"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-1.5">
                    <input
                      type="text"
                      value={core.origin_olt_label || ''}
                      onChange={(e) => {
                        const origin_olt_label = e.target.value;
                        setCableCoresDraft((prev) =>
                          prev.map((item, i) =>
                            i === idx ? { ...item, origin_olt_label } : item
                          )
                        );
                      }}
                      placeholder="Origin OLT / PON..."
                      className="bg-slate-900/80 border border-slate-800 rounded-lg px-2 py-1 text-[10px] font-mono text-sky-200 placeholder-slate-600"
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
                      placeholder="Splice / core remarks..."
                      className="bg-slate-900/80 border border-slate-800 rounded-lg px-2 py-1 text-[10px] text-slate-200 placeholder-slate-600"
                    />
                  </div>
                </div>
              ))}
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
                source_olt_id: cableSourceOltId || null,
                source_pon_port_id: cableSourcePonPortId || null,
                cores_tia598_json: cableCoresDraft,
                cores_allocation_json: cableCoresDraft,
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
      <aside className="hidden lg:flex lg:flex-col w-[420px] xl:w-[440px] h-full bg-slate-900 border-l border-slate-800 shrink-0 shadow-2xl z-20">
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
