import React from 'react';
import {
  Activity,
  ArrowRight,
  Cable,
  ChevronRight,
  GitBranch,
  Layers,
  Radio,
  Server,
  Wrench,
  X,
} from 'lucide-react';
import {
  OpticalTraceResult,
  SPLITTER_SPECS,
  getFbtLegOutputs,
  getHealthBadgeColors,
  getNodeTypeLabel,
} from '../../lib/fiberOpticEngine';
import type { SupabaseGisSplitterOutput } from '../../services/supabaseClient';

interface FiberTraceabilityDrawerProps {
  isOpen: boolean;
  traceResult: OpticalTraceResult | null;
  selectedOutput?: SupabaseGisSplitterOutput | null;
  onClose: () => void;
  onFocusNode?: (nodeId: string) => void;
  onFocusCable?: (cableId: string) => void;
}

export const FiberTraceabilityDrawer: React.FC<FiberTraceabilityDrawerProps> = ({
  isOpen,
  traceResult,
  selectedOutput,
  onClose,
  onFocusNode,
  onFocusCable,
}) => {
  if (!isOpen || !traceResult) return null;

  const { targetNode, budget, hops, downstreamBranches, isLinked } = traceResult;
  const healthStyle = getHealthBadgeColors(budget?.healthBand || 'UNLINKED');
  const splitterSpec = SPLITTER_SPECS[targetNode.splitter_type] || SPLITTER_SPECS['none'];
  const fbtPreview = splitterSpec.isAsymmetricFbt
    ? getFbtLegOutputs(budget?.inputDbm ?? null, targetNode.splitter_type, targetNode.loss_per_splice)
    : null;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5">
      <div className="w-full max-w-4xl max-h-[90vh] bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-100">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800 bg-slate-950/95 flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] font-mono text-cyan-400">
              <GitBranch className="w-4 h-4 shrink-0" />
              <span className="uppercase tracking-wider font-bold">
                End-to-End Optical Traceability Path
              </span>
              <span className="text-slate-600">·</span>
              <span className="text-slate-300">{getNodeTypeLabel(targetNode.node_type)}</span>
            </div>
            <h3 className="text-base font-bold text-white truncate mt-0.5">
              {targetNode.name}
              {selectedOutput
                ? ` — ${selectedOutput.leg_label || `Port ${selectedOutput.port_number}`}`
                : ''}
            </h3>
            <p className="text-[11px] font-mono text-slate-400 mt-0.5">
              {targetNode.area_name ? `${targetNode.area_name} · ` : ''}
              {targetNode.lat.toFixed(6)}, {targetNode.lng.toFixed(6)}
              {targetNode.feed_core_pair ? ` · Feed: ${targetNode.feed_core_pair}` : ''}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div
              className={`px-3 py-1.5 rounded-lg border font-mono text-xs font-bold tabular-nums ${healthStyle.bgClass} ${healthStyle.borderClass} ${healthStyle.textClass}`}
            >
              {budget?.healthBand || 'UNLINKED'}
              {budget?.ontRxDbm !== null && budget?.ontRxDbm !== undefined
                ? ` · ${budget.ontRxDbm.toFixed(2)} dBm`
                : ''}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white cursor-pointer"
              aria-label="Close trace drawer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
          {/* 1. Horizontal Visual Breadcrumb Chain */}
          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between font-mono">
              <span className="text-[11px] uppercase tracking-wider text-cyan-400 font-bold">
                Optical Lineage Breadcrumb (OLT ➔ Core ➔ Splice ➔ Splitter ➔ Endpoint)
              </span>
              <span className="text-[10px] text-slate-400 tabular-nums">
                {hops.length} Hop{hops.length === 1 ? '' : 's'}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {hops.map((hop, idx) => {
                const isClickable =
                  (hop.kind === 'OLT' || hop.kind === 'NODE') && onFocusNode
                    ? true
                    : hop.kind === 'CABLE' && onFocusCable
                    ? true
                    : false;

                return (
                  <React.Fragment key={`${hop.kind}-${hop.id}-${idx}`}>
                    {idx > 0 && (
                      <ArrowRight className="w-4 h-4 text-slate-500 shrink-0" />
                    )}
                    <button
                      type="button"
                      disabled={!isClickable}
                      onClick={() => {
                        if ((hop.kind === 'OLT' || hop.kind === 'NODE') && onFocusNode) {
                          onFocusNode(hop.id);
                          onClose();
                        } else if (hop.kind === 'CABLE' && onFocusCable) {
                          onFocusCable(hop.id);
                          onClose();
                        }
                      }}
                      className={`text-left px-3 py-2 rounded-xl border transition font-mono ${
                        isClickable ? 'cursor-pointer hover:border-cyan-400' : 'cursor-default'
                      } ${
                        hop.kind === 'OLT'
                          ? 'bg-sky-950/70 border-sky-700/80 text-sky-100'
                          : hop.kind === 'CABLE'
                          ? 'bg-slate-900 border-slate-700 text-slate-200'
                          : hop.kind === 'OUTPUT'
                          ? 'bg-emerald-950/70 border-emerald-700/80 text-emerald-100'
                          : 'bg-purple-950/50 border-purple-700/70 text-purple-100'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 font-bold text-[11px]">
                        {hop.kind === 'OLT' && <Server className="w-3.5 h-3.5 text-sky-400" />}
                        {hop.kind === 'CABLE' && (
                          <span
                            className="w-3 h-3 rounded-sm border border-white/50 shrink-0"
                            style={{ backgroundColor: hop.coreColorHex || '#38bdf8' }}
                          />
                        )}
                        {hop.kind === 'NODE' &&
                          (hop.nodeType === 'FOSC_JOINT' ? (
                            <Wrench className="w-3.5 h-3.5 text-purple-400" />
                          ) : hop.nodeType === 'DIST_NODE' ? (
                            <Layers className="w-3.5 h-3.5 text-indigo-400" />
                          ) : (
                            <Radio className="w-3.5 h-3.5 text-emerald-400" />
                          ))}
                        {hop.kind === 'OUTPUT' && <Activity className="w-3.5 h-3.5 text-emerald-400" />}
                        <span>{hop.title}</span>
                        {hop.badge && (
                          <span className="ml-1 px-1.5 py-0.5 rounded bg-black/40 text-[10px] text-cyan-300 tabular-nums">
                            {hop.badge}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-300/90 mt-0.5">{hop.subtitle}</div>
                    </button>
                  </React.Fragment>
                );
              })}
            </div>
          </div>

          {/* 2. Optical Power Budget Summary Cards */}
          {isLinked && budget && (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 font-mono">
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                <span className="text-[10px] text-slate-400 uppercase block">OLT SFP Tx</span>
                <span className="text-sm font-bold text-sky-300 tabular-nums mt-0.5 block">
                  {budget.oltTxDbm !== null
                    ? `${budget.oltTxDbm >= 0 ? '+' : ''}${budget.oltTxDbm.toFixed(2)} dBm`
                    : '—'}
                </span>
                <span className="text-[10px] text-slate-400 truncate block">
                  {budget.sourcePonLabel || 'Direct Tx'}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                <span className="text-[10px] text-slate-400 uppercase block">
                  Span ({budget.totalDistanceMeters}m)
                </span>
                <span className="text-sm font-bold text-amber-300 tabular-nums mt-0.5 block">
                  -{budget.fiberLossDb.toFixed(2)} dB
                </span>
                <span className="text-[10px] text-slate-500 block">0.35 dB / km</span>
              </div>

              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                <span className="text-[10px] text-slate-400 uppercase block">Splices &amp; Thru</span>
                <span className="text-sm font-bold text-amber-300 tabular-nums mt-0.5 block">
                  -{(budget.spliceLossDb + budget.upstreamThruLossDb).toFixed(2)} dB
                </span>
                <span className="text-[10px] text-slate-500 block">
                  {budget.spliceCount} splice{budget.spliceCount === 1 ? '' : 's'}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                <span className="text-[10px] text-slate-400 uppercase block">Box Input</span>
                <span className="text-sm font-bold text-white tabular-nums mt-0.5 block">
                  {budget.inputDbm !== null ? `${budget.inputDbm.toFixed(2)} dBm` : '—'}
                </span>
                <span className="text-[10px] text-slate-500 block">
                  Thru: {budget.thruOutputDbm !== null ? `${budget.thruOutputDbm.toFixed(2)} dBm` : '—'}
                </span>
              </div>

              <div className={`p-3 rounded-xl border ${healthStyle.bgClass} ${healthStyle.borderClass}`}>
                <span className="text-[10px] text-slate-300 uppercase block">
                  Drop / ONT Rx
                </span>
                <span className={`text-sm font-bold tabular-nums mt-0.5 block ${healthStyle.textClass}`}>
                  {budget.ontRxDbm !== null ? `${budget.ontRxDbm.toFixed(2)} dBm` : '—'}
                </span>
                <span className="text-[10px] text-slate-300/80 block">
                  Splitter: -{budget.splitterLossDb.toFixed(1)} dB
                </span>
              </div>
            </div>
          )}

          {/* 3. Asymmetric FBT Ratio Leg Preview (if target node uses FBT) */}
          {fbtPreview && (
            <div className="p-4 rounded-xl bg-slate-950 border border-indigo-800/70 space-y-2 font-mono">
              <div className="text-[11px] uppercase tracking-wider text-indigo-300 font-bold">
                Asymmetric FBT Tap Ratio Breakdown ({targetNode.splitter_type})
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] text-slate-400 block">
                      Leg 1 · Local Drop ({fbtPreview.dropPercent}%)
                    </span>
                    <span className="text-amber-300 font-bold tabular-nums">
                      -{fbtPreview.dropLossDb.toFixed(1)} dB Insertion Loss
                    </span>
                  </div>
                  <span className="text-sm font-bold text-emerald-300 tabular-nums">
                    {fbtPreview.dropOutputDbm !== null ? `${fbtPreview.dropOutputDbm.toFixed(2)} dBm` : '—'}
                  </span>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] text-slate-400 block">
                      Leg 2 · Trunk Pass-Through ({fbtPreview.thruPercent}%)
                    </span>
                    <span className="text-cyan-300 font-bold tabular-nums">
                      -{fbtPreview.thruLossDb.toFixed(1)} dB Through Loss
                    </span>
                  </div>
                  <span className="text-sm font-bold text-sky-300 tabular-nums">
                    {fbtPreview.thruOutputDbm !== null ? `${fbtPreview.thruOutputDbm.toFixed(2)} dBm` : '—'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* 4. Step-by-Step Signal Attenuation Table */}
          <div className="rounded-xl border border-slate-800 bg-slate-950 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-800 flex items-center justify-between font-mono">
              <span className="text-[11px] uppercase tracking-wider text-slate-300 font-bold">
                Step-by-Step Segment &amp; Signal Ledger
              </span>
              <span className="text-[10px] text-slate-500">Click any map element to inspect</span>
            </div>
            <div className="divide-y divide-slate-800/80">
              {hops.map((hop, idx) => (
                <div
                  key={`step-${hop.id}-${idx}`}
                  className="px-4 py-2.5 flex items-center justify-between gap-3 font-mono text-[11px]"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="w-6 h-6 rounded-lg bg-slate-900 border border-slate-700 text-slate-300 flex items-center justify-center font-bold shrink-0 tabular-nums">
                      {idx + 1}
                    </span>
                    <div className="min-w-0">
                      <div className="text-white font-semibold flex items-center gap-1.5 truncate">
                        {hop.kind === 'CABLE' && <Cable className="w-3.5 h-3.5 text-cyan-400 shrink-0" />}
                        <span className="truncate">{hop.title}</span>
                      </div>
                      <div className="text-[10px] text-slate-400 truncate">{hop.subtitle}</div>
                    </div>
                  </div>
                  <div className="text-right shrink-0 tabular-nums">
                    {hop.lossDb !== undefined && hop.lossDb !== null && (
                      <span className="text-amber-300 font-bold block">-{hop.lossDb.toFixed(2)} dB</span>
                    )}
                    {hop.powerDbm !== undefined && hop.powerDbm !== null && (
                      <span className="text-emerald-300 font-bold block">
                        {hop.powerDbm >= 0 ? '+' : ''}
                        {hop.powerDbm.toFixed(2)} dBm
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 5. Downstream Branches */}
          {downstreamBranches.length > 0 && (
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5 font-mono">
              <div className="text-[11px] uppercase tracking-wider text-purple-300 font-bold">
                Downstream Forwarded Branches ({downstreamBranches.length})
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {downstreamBranches.map((br, idx) => (
                  <div
                    key={`${br.nodeName}-${idx}`}
                    className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between gap-2 text-[11px]"
                  >
                    <div className="min-w-0">
                      <div className="text-white font-bold truncate flex items-center gap-1">
                        <ChevronRight className="w-3 h-3 text-purple-400 shrink-0" />
                        <span>{br.nodeName}</span>
                      </div>
                      <div className="text-[10px] text-slate-400 truncate">
                        {br.areaName || getNodeTypeLabel(br.nodeType)} · {br.cableName}
                      </div>
                    </div>
                    <span className="text-cyan-300 font-bold tabular-nums shrink-0">
                      {br.distanceMeters}m
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FiberTraceabilityDrawer;
