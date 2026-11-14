import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Cable,
  CheckCircle2,
  ClipboardCheck,
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
  GisPortStatus,
  GisSpliceEntry,
  GisSpliceStatus,
  GisSplitterType,
  SupabaseGisCable,
  SupabaseGisFdbPort,
  SupabaseGisNode,
} from '../../services/supabaseClient';
import type { GisSubscriberSummary } from '../../services/fiberGisService';
import {
  NodeOpticalBudgetResult,
  SPLITTER_SPECS,
  generateDefaultSpliceTray,
  getHealthBadgeColors,
  getNodeTypeLabel,
  getTia598Color,
  normalizeCableCores,
} from '../../lib/fiberOpticEngine';
import { DEFAULT_NETWORK_AREAS } from '../../lib/billingAndNetwork';

interface FiberGisInspectorPanelProps {
  selectedNode: SupabaseGisNode | null;
  selectedCable: SupabaseGisCable | null;
  cableClickPoint: GisLatLng | null;
  nodes: SupabaseGisNode[];
  cables: SupabaseGisCable[];
  portsByNodeId: Record<string, SupabaseGisFdbPort[]>;
  budgetsByNodeId: Record<string, NodeOpticalBudgetResult>;
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
  onFocusNode?: (node: SupabaseGisNode) => void;
}

export const FiberGisInspectorPanel: React.FC<FiberGisInspectorPanelProps> = ({
  selectedNode,
  selectedCable,
  cableClickPoint,
  nodes,
  cables,
  portsByNodeId,
  budgetsByNodeId,
  subscribers,
  isSaving,
  onClose,
  onSaveNode,
  onDeleteNode,
  onSaveCable,
  onDeleteCable,
  onSplitCable,
  onAssignPort,
}) => {
  const [fdbSubTab, setFdbSubTab] = useState<'ports' | 'signal'>('ports');
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Node editable draft
  const [nodeName, setNodeName] = useState('');
  const [nodeArea, setNodeArea] = useState('');
  const [nodeTxPower, setNodeTxPower] = useState<number>(5.0);
  const [nodeSplitter, setNodeSplitter] = useState<GisSplitterType>('1:8');
  const [nodeTotalPorts, setNodeTotalPorts] = useState<number>(8);
  const [nodeFeedCableId, setNodeFeedCableId] = useState<string>('');
  const [nodeFeedCore, setNodeFeedCore] = useState<number>(1);
  const [nodeTrayCapacity, setNodeTrayCapacity] = useState<number>(12);
  const [nodeLossPerSplice, setNodeLossPerSplice] = useState<number>(0.08);
  const [nodeNotes, setNodeNotes] = useState('');
  const [spliceTrayDraft, setSpliceTrayDraft] = useState<GisSpliceEntry[]>([]);

  // Cable editable draft
  const [cableName, setCableName] = useState('');
  const [cableCoresDraft, setCableCoresDraft] = useState<GisCoreEntry[]>([]);

  // Port assignment modal/editor state
  const [editingPortNum, setEditingPortNum] = useState<number | null>(null);
  const [subSearch, setSubSearch] = useState('');
  const [selectedSubId, setSelectedSubId] = useState<string>('');
  const [portDropMeters, setPortDropMeters] = useState<number>(30);
  const [portStatusDraft, setPortStatusDraft] = useState<GisPortStatus>('ACTIVE');

  // Field Triage interactive checklist state
  const [triageChecks, setTriageChecks] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setConfirmDelete(false);
    setEditingPortNum(null);
    setSubSearch('');
    if (selectedNode) {
      setNodeName(selectedNode.name || '');
      setNodeArea(selectedNode.area_name || '');
      setNodeTxPower(Number(selectedNode.tx_power_dbm ?? 5.0));
      setNodeSplitter((selectedNode.splitter_type || '1:8') as GisSplitterType);
      setNodeTotalPorts(Number(selectedNode.total_ports ?? 8));
      setNodeFeedCableId(selectedNode.feed_cable_id || '');
      setNodeFeedCore(Number(selectedNode.feed_core_number ?? 1));
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
      setCableCoresDraft(
        normalizeCableCores(selectedCable.cable_cores, selectedCable.cores_tia598_json)
      );
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
    const spec = SPLITTER_SPECS[nextType];
    if (spec && spec.defaultPorts > 0) {
      setNodeTotalPorts(spec.defaultPorts);
    }
  };

  const handleSaveNodeClick = async () => {
    if (!selectedNode) return;
    await onSaveNode(selectedNode.id, {
      name: nodeName.trim() || selectedNode.name,
      area_name: nodeArea.trim(),
      tx_power_dbm: Number(nodeTxPower),
      splitter_type: nodeSplitter,
      total_ports: Math.max(0, Math.min(32, Number(nodeTotalPorts) || 0)),
      feed_cable_id: nodeFeedCableId || null,
      feed_core_number: Number(nodeFeedCore) || 1,
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
    const portsByNumber: Record<number, SupabaseGisFdbPort> = {};
    for (const p of nodePorts) portsByNumber[p.port_number] = p;

    const totalPorts = Math.max(0, Number(node.total_ports ?? 0));
    const usedCount = nodePorts.filter((p) => p.status !== 'FREE').length;
    const freePorts = Math.max(0, totalPorts - usedCount);

    const incomingCoreNum = budget?.incomingCoreNumber || node.feed_core_number || 1;
    const incomingCoreSpec = getTia598Color(incomingCoreNum);
    const incomingTubeSpec = getTia598Color(Math.ceil(incomingCoreNum / 12));

    return (
      <div className="flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-slate-800 bg-slate-950/90 flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] font-mono text-slate-400">
              {node.node_type === 'OLT' ? (
                <Server className="w-3.5 h-3.5 text-sky-400 shrink-0" />
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
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${node.lat},${node.lng}`}
              target="_blank"
              rel="noopener noreferrer"
              className="min-h-[38px] px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 text-[11px] font-mono font-semibold flex items-center gap-1 transition"
              title="Open GPS Navigation"
            >
              <Navigation className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Navigate</span>
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

        {/* Sub-tabs for FDB_FAT */}
        {node.node_type === 'FDB_FAT' && (
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
              <span>Ports ({freePorts}/{totalPorts} Free)</span>
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
          {/* FDB Tab 1: Live Subscriber Port Assignment */}
          {node.node_type === 'FDB_FAT' && fdbSubTab === 'ports' && (
            <div className="space-y-3">
              {/* Quick Optical Summary Strip (Zero-pill clean metrics) */}
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-2 font-mono">
                <div>
                  <span className="text-[10px] text-slate-400 uppercase block">Splitter &amp; RX Budget</span>
                  <div className="text-xs font-bold text-white tabular-nums mt-0.5">
                    {node.splitter_type} PLC/FBT ·{' '}
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
                      freePorts === 0
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

              {/* Port Cards */}
              {totalPorts === 0 ? (
                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-slate-400 text-center">
                  No subscriber drop ports configured on this box. Select a splitter in Signal &amp; Triage.
                </div>
              ) : (
                <div className="space-y-2">
                  {Array.from({ length: totalPorts }, (_, i) => i + 1).map((portNum) => {
                    const port = portsByNumber[portNum];
                    const linkedSub =
                      (port?.subscriber_id && subscribersById[port.subscriber_id]) ||
                      (port?.subscriber_username &&
                        subscribersByUsername[port.subscriber_username.toLowerCase()]) ||
                      null;
                    const isEditing = editingPortNum === portNum;
                    const status: GisPortStatus = port?.status || 'FREE';

                    return (
                      <div
                        key={portNum}
                        className={`rounded-xl border p-3 transition ${
                          status === 'ACTIVE'
                            ? 'bg-slate-950/90 border-slate-800'
                            : status === 'FAULTY'
                            ? 'bg-rose-950/30 border-rose-800/70'
                            : 'bg-slate-900/60 border-slate-800/70 border-dashed'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 font-mono">
                              <span className="text-xs font-bold text-white tabular-nums">
                                Port {portNum}
                              </span>
                              <span className="text-slate-500">·</span>
                              {status === 'ACTIVE' && linkedSub ? (
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
                                      linkedSub.isOnline ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'
                                    }
                                  >
                                    {linkedSub.isOnline ? 'ONLINE' : 'OFFLINE'}
                                  </span>
                                </span>
                              ) : (
                                <span
                                  className={`text-[11px] font-bold ${
                                    status === 'FAULTY'
                                      ? 'text-rose-400'
                                      : status === 'ACTIVE'
                                      ? 'text-cyan-400'
                                      : 'text-emerald-400'
                                  }`}
                                >
                                  {status}
                                </span>
                              )}
                            </div>

                            {linkedSub ? (
                              <div className="mt-1 space-y-0.5">
                                <div className="text-xs font-semibold text-white">
                                  {linkedSub.fullName}{' '}
                                  <span className="text-cyan-400 font-mono font-normal">
                                    @{linkedSub.username}
                                  </span>
                                </div>
                                <div className="text-[11px] text-slate-400 font-mono">
                                  {linkedSub.packageSpeed} · Drop {port?.drop_cable_meters ?? 30}m
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
                            ) : port?.client_label ? (
                              <div className="mt-1 text-xs text-slate-300">
                                {port.client_label} · Drop {port.drop_cable_meters}m
                              </div>
                            ) : (
                              <div className="mt-1 text-[11px] text-slate-500">
                                Available for drop cable termination
                              </div>
                            )}
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              if (isEditing) {
                                setEditingPortNum(null);
                              } else {
                                setEditingPortNum(portNum);
                                setSelectedSubId(port?.subscriber_id || linkedSub?.id || '');
                                setPortDropMeters(Number(port?.drop_cable_meters ?? 30));
                                setPortStatusDraft(port?.status || 'ACTIVE');
                                setSubSearch('');
                              }
                            }}
                            className="min-h-[36px] px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 text-[11px] font-mono font-semibold flex items-center gap-1 shrink-0 cursor-pointer"
                          >
                            <UserPlus className="w-3 h-3" />
                            <span>{isEditing ? 'Close' : linkedSub ? 'Edit' : 'Assign'}</span>
                          </button>
                        </div>

                        {isEditing && (
                          <div className="mt-3 pt-3 border-t border-slate-800 space-y-2.5">
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

                            <div className="max-h-36 overflow-y-auto rounded-lg border border-slate-800 bg-slate-900 divide-y divide-slate-800/80">
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
                                        setPortStatusDraft('ACTIVE');
                                      }}
                                      className={`w-full text-left px-2.5 py-2 flex items-center justify-between gap-2 text-[11px] transition cursor-pointer ${
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
                                        title={sub.isOnline ? 'Online' : 'Offline'}
                                      />
                                    </button>
                                  );
                                })
                              )}
                            </div>

                            <div className="grid grid-cols-2 gap-2 font-mono">
                              <div>
                                <label className="block text-[10px] text-slate-400 mb-1">
                                  Drop Cable (Meters)
                                </label>
                                <input
                                  type="number"
                                  min={0}
                                  max={2000}
                                  value={portDropMeters}
                                  onChange={(e) => setPortDropMeters(Number(e.target.value))}
                                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500 tabular-nums"
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] text-slate-400 mb-1">
                                  Port State
                                </label>
                                <select
                                  value={portStatusDraft}
                                  onChange={(e) => setPortStatusDraft(e.target.value as GisPortStatus)}
                                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                                >
                                  <option value="ACTIVE">ACTIVE (Linked)</option>
                                  <option value="FREE">FREE (Available)</option>
                                  <option value="FAULTY">FAULTY (Damaged)</option>
                                </select>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 pt-1">
                              <button
                                type="button"
                                disabled={isSaving}
                                onClick={async () => {
                                  const sub = selectedSubId ? subscribersById[selectedSubId] : null;
                                  await onAssignPort({
                                    fdbNodeId: node.id,
                                    portNumber: portNum,
                                    subscriberId: portStatusDraft === 'FREE' ? null : sub?.id || null,
                                    subscriberUsername:
                                      portStatusDraft === 'FREE' ? '' : sub?.username || '',
                                    clientLabel:
                                      portStatusDraft === 'FREE'
                                        ? ''
                                        : sub
                                        ? `${sub.fullName} (@${sub.username})`
                                        : '',
                                    dropCableMeters: portDropMeters,
                                    status: portStatusDraft,
                                  });
                                  setEditingPortNum(null);
                                }}
                                className="flex-1 min-h-[40px] px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-slate-950 font-mono font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                              >
                                <Save className="w-3.5 h-3.5" />
                                <span>Save Port {portNum}</span>
                              </button>
                              {port && port.status !== 'FREE' && (
                                <button
                                  type="button"
                                  disabled={isSaving}
                                  onClick={async () => {
                                    await onAssignPort({
                                      fdbNodeId: node.id,
                                      portNumber: portNum,
                                      subscriberId: null,
                                      subscriberUsername: '',
                                      clientLabel: '',
                                      dropCableMeters: 0,
                                      status: 'FREE',
                                    });
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

          {/* FDB Tab 2: Optical Budget + Field Agent Fast Triage Card */}
          {node.node_type === 'FDB_FAT' && fdbSubTab === 'signal' && (
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
                    <span className="text-sky-300 font-bold tabular-nums">
                      {budget?.oltTxDbm !== null && budget?.oltTxDbm !== undefined
                        ? `${budget.oltTxDbm >= 0 ? '+' : ''}${budget.oltTxDbm.toFixed(2)} dBm`
                        : 'No OLT Path'}
                    </span>
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

          {/* OLT Configuration Section */}
          {node.node_type === 'OLT' && (
            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5 font-mono">
              <label className="block text-[10px] uppercase tracking-wider text-sky-400 font-bold">
                PON SFP Module TX Power (dBm)
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[3.5, 5.0, 7.5].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setNodeTxPower(preset)}
                    className={`min-h-[38px] rounded-lg border text-xs font-bold transition cursor-pointer ${
                      Number(nodeTxPower) === preset
                        ? 'bg-sky-600 text-slate-950 border-sky-300'
                        : 'bg-slate-900 text-slate-300 border-slate-700 hover:border-slate-500'
                    }`}
                  >
                    +{preset.toFixed(1)} dBm
                  </button>
                ))}
              </div>
              <input
                type="number"
                step="0.1"
                min="-5"
                max="15"
                value={nodeTxPower}
                onChange={(e) => setNodeTxPower(Number(e.target.value))}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-sky-500 tabular-nums"
              />
            </div>
          )}

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

              {node.node_type === 'FDB_FAT' && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] font-mono text-slate-400 mb-1">
                        Splitter Type
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
                        Total Ports (1-32)
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={32}
                        value={nodeTotalPorts}
                        onChange={(e) => setNodeTotalPorts(Number(e.target.value))}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-white tabular-nums"
                      />
                    </div>
                  </div>

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
              className="w-full min-h-[44px] px-3 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-mono font-bold text-xs flex items-center justify-center gap-2 shadow-lg cursor-pointer transition"
            >
              <Scissors className="w-4 h-4" />
              <span>✂️ Split Cable Here (Insert FOSC Joint Box)</span>
            </button>
          </div>

          {/* Span Label */}
          <div>
            <label className="block text-[10px] font-mono text-slate-400 mb-1">Span Name</label>
            <input
              type="text"
              value={cableName}
              onChange={(e) => setCableName(e.target.value)}
              placeholder={`${src?.name || 'Start'} → ${dst?.name || 'End'}`}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
            />
          </div>

          {/* TIA-598 48-Core Color & Buffer Tube Tracker */}
          <div className="space-y-2">
            <div className="flex items-center justify-between font-mono">
              <span className="text-[11px] uppercase tracking-wider text-slate-300 font-bold">
                TIA-598 Core &amp; Tube Allocation ({cable.cable_cores}C)
              </span>
              <span className="text-[10px] text-slate-400">
                {cableCoresDraft.filter((c) => c.status === 'Free / Dark').length} Dark Free
              </span>
            </div>

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
                        setCableCoresDraft((prev) =>
                          prev.map((item, i) => (i === idx ? { ...item, status } : item))
                        );
                      }}
                      className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] text-slate-200"
                    >
                      <option value="Feed / Splitter">Feed / Splitter</option>
                      <option value="Through / Pass">Through / Pass</option>
                      <option value="Free / Dark">Free / Dark</option>
                      <option value="Dead / High Loss">Dead / High Loss</option>
                    </select>
                    <input
                      type="text"
                      value={core.destinationNote || ''}
                      onChange={(e) => {
                        const destinationNote = e.target.value;
                        setCableCoresDraft((prev) =>
                          prev.map((item, i) => (i === idx ? { ...item, destinationNote } : item))
                        );
                      }}
                      placeholder="Destination FDB / splitter..."
                      className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] text-white placeholder-slate-500"
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
                cores_tia598_json: cableCoresDraft,
              })
            }
            className="flex-1 min-h-[44px] px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-slate-950 font-mono font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Save className="w-4 h-4" />
            <span>{isSaving ? 'Saving...' : 'Save Core Mapping'}</span>
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
