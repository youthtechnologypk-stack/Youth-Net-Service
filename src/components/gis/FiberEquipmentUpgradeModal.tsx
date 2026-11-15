import React, { useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Package,
  RefreshCw,
  ShieldCheck,
  Wrench,
  X,
} from 'lucide-react';
import type {
  GisNodeType,
  GisSplitterType,
  SupabaseFiberNode,
  SupabaseGisCable,
  SupabaseGisFdbPort,
  SupabaseGisNode,
  SupabaseGisOltPonPort,
  SupabaseGisSplitterOutput,
  SupabaseInventoryItem,
} from '../../services/supabaseClient';
import {
  SPLITTER_SPECS,
  calculateTopologyOpticalBudgets,
  getNodeTypeLabel,
  getOpticalHealthLabel,
} from '../../lib/fiberOpticEngine';
import { fetchInventoryItems } from '../../services/erpInventoryService';
import type { ReplaceGisNodeEquipmentParams } from '../../services/fiberGisService';

export type ReplacementEquipmentFamily =
  | 'FDB_BOX'
  | 'FAT_BOX'
  | 'PLC_FBT_SPLITTER'
  | 'JOINT_CLOSURE'
  | 'MICRO_POP_SWITCH'
  | 'OLT_CHASSIS';

interface FiberEquipmentUpgradeModalProps {
  isOpen: boolean;
  node: SupabaseGisNode | null;
  allNodes: SupabaseGisNode[];
  allCables: SupabaseGisCable[];
  ponPortsById: Record<string, SupabaseGisOltPonPort>;
  existingPorts: SupabaseGisFdbPort[];
  existingOutputs: SupabaseGisSplitterOutput[];
  actorUsername: string;
  isSaving: boolean;
  onClose: () => void;
  onConfirmReplace: (
    params: Omit<
      ReplaceGisNodeEquipmentParams,
      'node' | 'allNodes' | 'allCables' | 'ponPortsById' | 'existingPorts' | 'existingOutputs' | 'actor'
    >
  ) => Promise<void>;
}

const EQUIPMENT_FAMILIES: Array<{
  id: ReplacementEquipmentFamily;
  label: string;
  targetNodeType: GisNodeType;
  fiberNodeType: SupabaseFiberNode['node_type'];
  defaultSplitter: GisSplitterType;
  defaultPorts: number;
  defaultTray: number;
}> = [
  {
    id: 'FDB_BOX',
    label: 'FDB Box (2P / 4P / 8P / 16P / 24P)',
    targetNodeType: 'FDB_FAT',
    fiberNodeType: 'FDB',
    defaultSplitter: '1:8',
    defaultPorts: 8,
    defaultTray: 12,
  },
  {
    id: 'FAT_BOX',
    label: 'FAT Termination Box (8P / 16P)',
    targetNodeType: 'FDB_FAT',
    fiberNodeType: 'FAT',
    defaultSplitter: '1:8',
    defaultPorts: 8,
    defaultTray: 12,
  },
  {
    id: 'PLC_FBT_SPLITTER',
    label: 'PLC / FBT Splitter (1:2–1:32 or Tap)',
    targetNodeType: 'FDB_FAT',
    fiberNodeType: 'FAT',
    defaultSplitter: '1:8',
    defaultPorts: 8,
    defaultTray: 12,
  },
  {
    id: 'JOINT_CLOSURE',
    label: 'Joint Closure / Dome Enclosure (12C / 24C / 48C)',
    targetNodeType: 'FOSC_JOINT',
    fiberNodeType: 'JOINT_CLOSURE',
    defaultSplitter: 'none',
    defaultPorts: 0,
    defaultTray: 24,
  },
  {
    id: 'MICRO_POP_SWITCH',
    label: 'Micro-POP / Outdoor Pole Switch / Dist Box',
    targetNodeType: 'DIST_NODE',
    fiberNodeType: 'FDB',
    defaultSplitter: 'none',
    defaultPorts: 8,
    defaultTray: 12,
  },
  {
    id: 'OLT_CHASSIS',
    label: 'OLT Hub Chassis (EPON / GPON)',
    targetNodeType: 'OLT',
    fiberNodeType: 'OLT',
    defaultSplitter: 'none',
    defaultPorts: 0,
    defaultTray: 12,
  },
];

export const FiberEquipmentUpgradeModal: React.FC<FiberEquipmentUpgradeModalProps> = ({
  isOpen,
  node,
  allNodes,
  allCables,
  ponPortsById,
  existingPorts,
  existingOutputs,
  isSaving,
  onClose,
  onConfirmReplace,
}) => {
  const [family, setFamily] = useState<ReplacementEquipmentFamily>('FDB_BOX');
  const [splitterType, setSplitterType] = useState<GisSplitterType>('1:8');
  const [totalPorts, setTotalPorts] = useState<number>(8);
  const [trayCapacity, setTrayCapacity] = useState<number>(12);
  const [txPowerDbm, setTxPowerDbm] = useState<number>(5.0);
  const [reason, setReason] = useState<string>('');

  // Inventory integration
  const [inventoryItems, setInventoryItems] = useState<SupabaseInventoryItem[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [deductFromInventory, setDeductFromInventory] = useState(false);
  const [deductItemId, setDeductItemId] = useState<string>('');
  const [returnOldToInventory, setReturnOldToInventory] = useState(false);
  const [returnItemId, setReturnItemId] = useState<string>('');
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !node) return;
    setLocalError(null);
    setReason('');
    setDeductFromInventory(false);
    setReturnOldToInventory(false);
    setDeductItemId('');
    setReturnItemId('');

    if (node.node_type === 'FOSC_JOINT') {
      setFamily('JOINT_CLOSURE');
      setSplitterType(node.splitter_type || 'none');
      setTotalPorts(Number(node.total_ports || 0));
      setTrayCapacity(Number(node.tray_capacity || 12));
    } else if (node.node_type === 'DIST_NODE') {
      setFamily('MICRO_POP_SWITCH');
      setSplitterType(node.splitter_type || 'none');
      setTotalPorts(Number(node.total_ports || 8));
      setTrayCapacity(Number(node.tray_capacity || 12));
    } else if (node.node_type === 'OLT') {
      setFamily('OLT_CHASSIS');
      setSplitterType('none');
      setTotalPorts(0);
      setTrayCapacity(Number(node.tray_capacity || 12));
      setTxPowerDbm(Number(node.tx_power_dbm ?? 5.0));
    } else {
      // Auto-suggest next capacity upgrade for FDB_FAT!
      const curPorts = Number(node.total_ports || 4);
      const nextUpgradeSplitter: GisSplitterType =
        curPorts <= 4 ? '1:8' : curPorts <= 8 ? '1:16' : node.splitter_type || '1:16';
      const nextUpgradePorts = curPorts <= 4 ? 8 : curPorts <= 8 ? 16 : Math.min(32, curPorts);
      setFamily('FDB_BOX');
      setSplitterType(nextUpgradeSplitter);
      setTotalPorts(nextUpgradePorts);
      setTrayCapacity(Number(node.tray_capacity || 12));
    }

    let cancelled = false;
    setInventoryLoading(true);
    fetchInventoryItems()
      .then((res) => {
        if (cancelled) return;
        const sorted = (res.data || []).slice().sort((a, b) => {
          const aPriority =
            a.category === 'FDB_SPLITTER' || a.category === 'ROUTER_ONT' ? 0 : 1;
          const bPriority =
            b.category === 'FDB_SPLITTER' || b.category === 'ROUTER_ONT' ? 0 : 1;
          if (aPriority !== bPriority) return aPriority - bPriority;
          return a.item_name.localeCompare(b.item_name);
        });
        setInventoryItems(sorted);
        const firstInStock = sorted.find((i) => Number(i.stock_qty) > 0);
        if (firstInStock) setDeductItemId(firstInStock.id);
        if (sorted[0]) setReturnItemId(sorted[0].id);
      })
      .catch(() => {
        if (!cancelled) setInventoryItems([]);
      })
      .finally(() => {
        if (!cancelled) setInventoryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, node?.id]);

  const activeFamilyMeta = useMemo(
    () => EQUIPMENT_FAMILIES.find((f) => f.id === family) || EQUIPMENT_FAMILIES[0],
    [family]
  );

  // Occupied ports summary (preserving subscriber / downstream feed ports)
  const occupiedPortsInfo = useMemo(() => {
    const occupiedMap = new Map<number, string>();
    for (const o of existingOutputs) {
      if (o.utilization_type !== 'FREE_PORT') {
        const label =
          o.subscriber_username
            ? `@${o.subscriber_username}`
            : o.client_name_manual ||
              (o.target_area_or_node ? `To ${o.target_area_or_node}` : o.utilization_type);
        occupiedMap.set(o.port_number, label);
      }
    }
    for (const p of existingPorts) {
      if (p.status !== 'FREE' && !occupiedMap.has(p.port_number)) {
        const label = p.subscriber_username
          ? `@${p.subscriber_username}`
          : p.client_label || p.status;
        occupiedMap.set(p.port_number, label);
      }
    }
    const list = Array.from(occupiedMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([portNum, label]) => ({ portNum, label }));
    const maxOccupiedPort = list.reduce((m, item) => Math.max(m, item.portNum), 0);
    return { list, maxOccupiedPort };
  }, [existingOutputs, existingPorts]);

  const connectedCablesCount = useMemo(() => {
    if (!node) return 0;
    return allCables.filter(
      (c) => c.source_node_id === node.id || c.target_node_id === node.id
    ).length;
  }, [allCables, node]);

  // Live optical preview before vs after
  const { currentBudget, previewBudget } = useMemo(() => {
    if (!node) return { currentBudget: null, previewBudget: null };
    const beforeMap = calculateTopologyOpticalBudgets(allNodes, allCables, ponPortsById);
    const candidate: SupabaseGisNode = {
      ...node,
      node_type: activeFamilyMeta.targetNodeType,
      splitter_type: splitterType,
      total_ports: totalPorts,
      tray_capacity: trayCapacity,
      tx_power_dbm: activeFamilyMeta.targetNodeType === 'OLT' ? txPowerDbm : node.tx_power_dbm,
    };
    const nextNodes = allNodes.map((n) => (n.id === node.id ? candidate : n));
    const afterMap = calculateTopologyOpticalBudgets(nextNodes, allCables, ponPortsById);
    return {
      currentBudget: beforeMap[node.id] || null,
      previewBudget: afterMap[node.id] || null,
    };
  }, [
    node,
    allNodes,
    allCables,
    ponPortsById,
    activeFamilyMeta.targetNodeType,
    splitterType,
    totalPorts,
    trayCapacity,
    txPowerDbm,
  ]);

  if (!isOpen || !node) return null;

  const newEquipmentLabel = (() => {
    switch (family) {
      case 'FDB_BOX':
        return `${totalPorts}-Port FDB Box`;
      case 'FAT_BOX':
        return `${totalPorts}-Port FAT Termination Box`;
      case 'PLC_FBT_SPLITTER':
        return SPLITTER_SPECS[splitterType]?.isAsymmetricFbt
          ? `FBT Ratio Splitter (${splitterType})`
          : `${totalPorts}-Port PLC Splitter`;
      case 'JOINT_CLOSURE':
        return `${trayCapacity}C Joint Closure / Dome`;
      case 'MICRO_POP_SWITCH':
        return `${totalPorts}-Port Micro-POP / Outdoor Switch`;
      case 'OLT_CHASSIS':
        return `OLT Hub Chassis (+${txPowerDbm.toFixed(1)} dBm)`;
    }
  })();

  const handleFamilySelect = (nextFamily: ReplacementEquipmentFamily) => {
    setFamily(nextFamily);
    const meta = EQUIPMENT_FAMILIES.find((f) => f.id === nextFamily);
    if (!meta) return;
    if (nextFamily === 'JOINT_CLOSURE') {
      setSplitterType('none');
      setTotalPorts(0);
      setTrayCapacity(Math.max(12, Number(node.tray_capacity || 24)));
    } else if (nextFamily === 'OLT_CHASSIS') {
      setSplitterType('none');
      setTotalPorts(0);
      setTxPowerDbm(Number(node.tx_power_dbm || 5.0));
    } else if (nextFamily === 'MICRO_POP_SWITCH') {
      setSplitterType(node.splitter_type !== 'none' ? node.splitter_type : 'none');
      setTotalPorts(Math.max(Number(node.total_ports || 0), 8));
    } else {
      const nextSplit: GisSplitterType =
        node.splitter_type !== 'none' ? node.splitter_type : meta.defaultSplitter;
      setSplitterType(nextSplit);
      const spec = SPLITTER_SPECS[nextSplit];
      setTotalPorts(
        spec && spec.defaultPorts > 0
          ? Math.max(spec.defaultPorts, Number(node.total_ports || 0))
          : meta.defaultPorts
      );
    }
  };

  const handleSplitterSelect = (nextSplit: GisSplitterType) => {
    setSplitterType(nextSplit);
    const spec = SPLITTER_SPECS[nextSplit];
    if (spec?.isAsymmetricFbt) {
      setTotalPorts(2);
    } else if (spec && spec.defaultPorts > 0) {
      setTotalPorts(spec.defaultPorts);
    } else if (nextSplit === 'none' && family !== 'MICRO_POP_SWITCH') {
      setTotalPorts(0);
    }
  };

  const willTruncateActivePorts =
    activeFamilyMeta.targetNodeType !== 'OLT' &&
    occupiedPortsInfo.maxOccupiedPort > 0 &&
    totalPorts < occupiedPortsInfo.maxOccupiedPort;

  const selectedDeductItem = inventoryItems.find((i) => i.id === deductItemId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (deductFromInventory) {
      if (!deductItemId) {
        setLocalError('Select a replacement hardware item from inventory to deduct.');
        return;
      }
      if (selectedDeductItem && Number(selectedDeductItem.stock_qty) < 1) {
        setLocalError(`"${selectedDeductItem.item_name}" has 0 stock remaining.`);
        return;
      }
    }
    if (returnOldToInventory && !returnItemId) {
      setLocalError('Select an inventory item to credit the returned old box.');
      return;
    }

    try {
      await onConfirmReplace({
        newNodeType: activeFamilyMeta.targetNodeType,
        fiberNodeTypeOverride: activeFamilyMeta.fiberNodeType,
        newEquipmentLabel,
        newSplitterType: splitterType,
        newTotalPorts: totalPorts,
        newTrayCapacity: trayCapacity,
        newTxPowerDbm: activeFamilyMeta.targetNodeType === 'OLT' ? txPowerDbm : undefined,
        reason: reason.trim() || `Replaced with ${newEquipmentLabel}`,
        deductInventoryItemId: deductFromInventory ? deductItemId : null,
        returnInventoryItemId: returnOldToInventory ? returnItemId : null,
      });
    } catch (err: any) {
      setLocalError(err?.message || 'Failed to replace deployed equipment.');
    }
  };

  const currentLoss = SPLITTER_SPECS[node.splitter_type || 'none']?.dropLossDb ?? 0;
  const nextLoss = SPLITTER_SPECS[splitterType]?.dropLossDb ?? 0;

  return ReactDOM.createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 overflow-y-auto"
      style={{ zIndex: 999999 }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSaving) onClose();
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="mobile-safe-modal w-full max-w-[520px] max-h-[88dvh] overflow-y-auto mx-auto my-auto rounded-2xl box-border bg-slate-900 border border-slate-700 shadow-2xl flex flex-col"
      >
        {/* Header */}
        <div className="px-4 py-3.5 border-b border-slate-800 bg-slate-950/90 flex items-center justify-between gap-2 sticky top-0 z-10">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
              <RefreshCw className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-white truncate">
                Upgrade / Replace Equipment
              </h3>
              <p className="text-[11px] font-mono text-cyan-300 truncate">
                {node.name} {node.area_name ? `· ${node.area_name}` : ''}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={isSaving}
            onClick={onClose}
            className="min-h-[36px] min-w-[36px] rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center cursor-pointer"
            aria-label="Close upgrade modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4 text-xs">
          {/* 1. Current Deployed Asset Summary */}
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 font-bold">
                Current Deployed Asset Summary
              </span>
              <span className="px-2 py-0.5 rounded bg-slate-800 text-cyan-300 font-mono text-[10px] font-bold">
                {getNodeTypeLabel(node.node_type)}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 font-mono text-[11px]">
              <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                <span className="text-[9px] text-slate-400 block">Capacity</span>
                <span className="text-white font-bold">
                  {node.total_ports > 0
                    ? `${node.total_ports} Ports`
                    : `${node.tray_capacity || 12}C Tray`}
                </span>
              </div>
              <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                <span className="text-[9px] text-slate-400 block">Splitter Ratio</span>
                <span className="text-emerald-300 font-bold">
                  {node.splitter_type === 'none' ? 'Pass-Through' : node.splitter_type}
                </span>
              </div>
              <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 col-span-2 sm:col-span-1">
                <span className="text-[9px] text-slate-400 block">Fiber Spans</span>
                <span className="text-sky-300 font-bold">{connectedCablesCount} Connected</span>
              </div>
            </div>

            <div className="p-2 rounded-lg bg-emerald-950/30 border border-emerald-800/50 text-[11px] text-emerald-200 flex items-start gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                {occupiedPortsInfo.list.length > 0 ? (
                  <span>
                    <strong>
                      {occupiedPortsInfo.list.length} Active Port
                      {occupiedPortsInfo.list.length === 1 ? '' : 's'}
                    </strong>{' '}
                    (
                    {occupiedPortsInfo.list
                      .slice(0, 4)
                      .map((p) => `P${p.portNum}: ${p.label}`)
                      .join(', ')}
                    {occupiedPortsInfo.list.length > 4
                      ? ` +${occupiedPortsInfo.list.length - 4} more`
                      : ''}
                    ) &amp; all {connectedCablesCount} connected cables will be{' '}
                    <strong>100% preserved</strong>.
                  </span>
                ) : (
                  <span>
                    GPS coordinates, {connectedCablesCount} connected fiber cable(s), and core
                    markings will stay <strong>100% intact</strong>.
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* 2. New Replacement Equipment Type */}
          <div className="space-y-3">
            <div>
              <label className="block text-[10px] font-mono uppercase tracking-wider text-slate-400 mb-1">
                New Replacement Equipment Type
              </label>
              <select
                value={family}
                onChange={(e) => handleFamilySelect(e.target.value as ReplacementEquipmentFamily)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white font-semibold focus:outline-none focus:border-amber-500"
              >
                {EQUIPMENT_FAMILIES.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>

            {/* 3. Port Count, Splitter Ratio & Tray Capacity */}
            {activeFamilyMeta.targetNodeType === 'OLT' ? (
              <div>
                <label className="block text-[10px] font-mono uppercase tracking-wider text-slate-400 mb-1">
                  OLT SFP TX Optical Power (dBm)
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="-5"
                  max="12"
                  value={txPowerDbm}
                  onChange={(e) => setTxPowerDbm(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white font-mono tabular-nums"
                />
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[10px] font-mono uppercase tracking-wider text-slate-400 mb-1">
                    New Splitter Ratio
                  </label>
                  <select
                    value={splitterType}
                    onChange={(e) => handleSplitterSelect(e.target.value as GisSplitterType)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-2.5 text-sm text-white font-mono"
                  >
                    {(Object.keys(SPLITTER_SPECS) as GisSplitterType[]).map((k) => (
                      <option key={k} value={k}>
                        {SPLITTER_SPECS[k].label}
                      </option>
                    ))}
                  </select>
                </div>

                {family === 'JOINT_CLOSURE' ? (
                  <div>
                    <label className="block text-[10px] font-mono uppercase tracking-wider text-slate-400 mb-1">
                      Splice Tray Capacity (Cores)
                    </label>
                    <select
                      value={trayCapacity}
                      onChange={(e) => setTrayCapacity(Number(e.target.value))}
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-2.5 text-sm text-white font-mono"
                    >
                      {[2, 4, 6, 8, 12, 24, 48].map((cap) => (
                        <option key={cap} value={cap}>
                          {cap}-Core Splice Tray
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div>
                    <label className="block text-[10px] font-mono uppercase tracking-wider text-slate-400 mb-1">
                      New Output Port Capacity
                    </label>
                    <select
                      value={totalPorts}
                      onChange={(e) => setTotalPorts(Number(e.target.value))}
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-2.5 text-sm text-white font-mono"
                    >
                      {[0, 2, 4, 8, 12, 16, 24, 32].map((p) => (
                        <option key={p} value={p}>
                          {p === 0 ? '0 Ports (Pass-Through)' : `${p}-Port Output`}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}

            {/* Live Port Migration & Cascaded Optical Power Preview */}
            <div className="p-3 rounded-xl bg-cyan-950/30 border border-cyan-800/60 space-y-2 font-mono text-[11px]">
              <div className="flex items-center justify-between gap-2 text-cyan-300 font-bold">
                <span className="flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5" />
                  Cascaded Optical &amp; Port Impact
                </span>
                <span className="text-[10px] text-slate-300">
                  {splitterType === 'none'
                    ? '0 dB split loss'
                    : `-${nextLoss.toFixed(1)} dB (${splitterType})`}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-slate-300">
                  Old:{' '}
                  <strong className="text-white">
                    {currentBudget?.ontRxDbm !== null && currentBudget?.ontRxDbm !== undefined
                      ? `${currentBudget.ontRxDbm.toFixed(2)} dBm`
                      : node.splitter_type !== 'none'
                      ? `-${currentLoss.toFixed(1)} dB`
                      : 'Pass-Thru'}
                  </strong>
                </span>
                <ArrowRight className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-slate-300">
                  New Est. Output:{' '}
                  <strong className="text-emerald-300">
                    {previewBudget?.ontRxDbm !== null && previewBudget?.ontRxDbm !== undefined
                      ? `${previewBudget.ontRxDbm.toFixed(2)} dBm (${getOpticalHealthLabel(previewBudget.healthBand)})`
                      : previewBudget?.inputDbm !== null && previewBudget?.inputDbm !== undefined
                      ? `${previewBudget.inputDbm.toFixed(2)} dBm`
                      : 'Unlinked'}
                  </strong>
                </span>
              </div>

              {activeFamilyMeta.targetNodeType !== 'OLT' && totalPorts > 0 && (
                <div className="text-[10px] text-emerald-300 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {occupiedPortsInfo.maxOccupiedPort > 0
                      ? `Ports 1–${Math.min(occupiedPortsInfo.maxOccupiedPort, totalPorts)} kept active`
                      : 'Existing configuration kept'}
                    {totalPorts > Number(node.total_ports || 0)
                      ? ` · Ports ${Number(node.total_ports || 0) + 1}–${totalPorts} opened FREE`
                      : ''}
                  </span>
                </div>
              )}

              {willTruncateActivePorts && (
                <div className="p-2 rounded-lg bg-rose-950/70 border border-rose-700 text-rose-200 text-[11px] flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <span>
                    Warning: Active assignment exists on <strong>Port #{occupiedPortsInfo.maxOccupiedPort}</strong>,
                    which exceeds the selected {totalPorts} ports. Increase ports to{' '}
                    {occupiedPortsInfo.maxOccupiedPort}+ to avoid losing that port.
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* 4. Optional Hardware Inventory Stock Link */}
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-mono uppercase tracking-wider text-purple-300 font-bold flex items-center gap-1.5">
                <Package className="w-3.5 h-3.5" />
                Hardware Inventory Stock Sync (Optional)
              </span>
              {inventoryLoading && (
                <span className="text-[10px] font-mono text-slate-400">Loading stock...</span>
              )}
            </div>

            {/* Deduct replacement box */}
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={deductFromInventory}
                  onChange={(e) => setDeductFromInventory(e.target.checked)}
                  className="w-4 h-4 accent-amber-500 rounded"
                />
                <span>Deduct Replacement Box from Hardware Inventory (-1 unit)</span>
              </label>
              {deductFromInventory && (
                <select
                  value={deductItemId}
                  onChange={(e) => setDeductItemId(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-white"
                >
                  <option value="">-- Select replacement hardware from stock --</option>
                  {inventoryItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.item_name} (Stock: {item.stock_qty} {item.unit})
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Return old box */}
            <div className="space-y-1.5 pt-1 border-t border-slate-800/80">
              <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={returnOldToInventory}
                  onChange={(e) => setReturnOldToInventory(e.target.checked)}
                  className="w-4 h-4 accent-emerald-500 rounded"
                />
                <span>Return Old Box to Stock (Reusable, +1 unit)</span>
              </label>
              {returnOldToInventory && (
                <select
                  value={returnItemId}
                  onChange={(e) => setReturnItemId(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-white"
                >
                  <option value="">-- Select stock SKU for returned unit --</option>
                  {inventoryItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.item_name} (Current: {item.stock_qty} {item.unit})
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* 5. Replacement Reason / Maintenance Note */}
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-wider text-slate-400 mb-1">
              Replacement Reason / Maintenance Note
            </label>
            <textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Upgraded 4P FDB to 8P FDB due to new connections in street"
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
            />
          </div>

          {localError && (
            <div className="p-2.5 rounded-xl bg-rose-950/80 border border-rose-700 text-rose-200 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{localError}</span>
            </div>
          )}
        </div>

        {/* Sticky Footer */}
        <div className="p-3.5 border-t border-slate-800 bg-slate-950 flex items-center justify-end gap-2 sticky bottom-0">
          <button
            type="button"
            disabled={isSaving}
            onClick={onClose}
            className="min-h-[42px] px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono text-xs cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="flex-1 min-h-[42px] px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-mono font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow-lg"
          >
            <Wrench className="w-3.5 h-3.5" />
            <span>{isSaving ? 'Replacing & Recalculating...' : 'Confirm Equipment Replacement'}</span>
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
};
