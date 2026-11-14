import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Edit3,
  Gauge,
  MapPin,
  Plus,
  RefreshCw,
  Server,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { NocOverview } from './NocOverview';
import { CapacityPlannerView } from './CapacityPlannerView';
import { AreaNodeManagerModal } from './AreaNodeManagerModal';
import { OltManagerModal } from './OltManagerModal';
import { ActiveTab } from './Header';
import type { SupabaseGisOlt, SupabaseGisOltPonPort } from '../services/supabaseClient';
import {
  applyRealtimeOltDelta,
  applyRealtimePonPortDelta,
  deleteOltById,
  loadGisOltsOnly,
  subscribeToGisRealtime,
} from '../services/fiberGisService';
import { getDefaultMaxOnuLimit } from '../lib/fiberOpticEngine';

export interface NocCommandCenterProps {
  onNavigateTab: (tab: ActiveTab) => void;
  onOpenOutageModal: () => void;
  onOpenTicketModal: () => void;
  onOpenAddRouterModal?: () => void;
  initialSection?: 'overview' | 'capacity';
}

export const NocCommandCenter: React.FC<NocCommandCenterProps> = ({
  initialSection = 'overview',
  ...props
}) => {
  const [section, setSection] = useState<'overview' | 'capacity'>(initialSection);
  const [isAreaManagerOpen, setIsAreaManagerOpen] = useState<boolean>(false);
  const [isOltManagerOpen, setIsOltManagerOpen] = useState<boolean>(false);
  const [editingOltId, setEditingOltId] = useState<string | null>(null);

  const [olts, setOlts] = useState<SupabaseGisOlt[]>([]);
  const [ponPorts, setPonPorts] = useState<SupabaseGisOltPonPort[]>([]);
  const [oltSchemaMissing, setOltSchemaMissing] = useState<boolean>(false);
  const [isLoadingOlts, setIsLoadingOlts] = useState<boolean>(false);
  const [confirmDeleteOltId, setConfirmDeleteOltId] = useState<string | null>(null);

  const refreshOlts = useCallback(async () => {
    setIsLoadingOlts(true);
    try {
      const res = await loadGisOltsOnly();
      setOlts(res.olts);
      setPonPorts(res.ponPorts);
      setOltSchemaMissing(res.schemaMissing);
    } catch {
      // non-fatal if offline or schema pending
    } finally {
      setIsLoadingOlts(false);
    }
  }, []);

  useEffect(() => {
    refreshOlts();
  }, [refreshOlts]);

  useEffect(() => {
    if (oltSchemaMissing) return;
    const unsubscribe = subscribeToGisRealtime({
      onOltDelta: (eventType, newRow, oldRow) => {
        setOlts((prev) => applyRealtimeOltDelta(prev, eventType, newRow, oldRow));
      },
      onPonPortDelta: (eventType, newRow, oldRow) => {
        setPonPorts((prev) => applyRealtimePonPortDelta(prev, eventType, newRow, oldRow));
      },
      onNodeDelta: () => {},
      onCableDelta: () => {},
      onPortDelta: () => {},
    });
    return unsubscribe;
  }, [oltSchemaMissing]);

  const ponPortsByOltId = useMemo(() => {
    const grouped: Record<string, SupabaseGisOltPonPort[]> = {};
    for (const p of ponPorts) {
      if (!grouped[p.olt_id]) grouped[p.olt_id] = [];
      grouped[p.olt_id].push(p);
    }
    return grouped;
  }, [ponPorts]);

  const handleJumpToMapForOlt = useCallback(
    (olt: SupabaseGisOlt) => {
      try {
        sessionStorage.setItem('youthnet_gis_place_olt_id', olt.id);
      } catch {
        // ignore storage restrictions
      }
      setIsOltManagerOpen(false);
      props.onNavigateTab('fiber_gis');
    },
    [props]
  );

  const handleQuickDeleteOlt = async (oltId: string) => {
    try {
      await deleteOltById(oltId);
      setConfirmDeleteOltId(null);
      await refreshOlts();
    } catch {
      // handled cleanly on next refresh
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-xl w-fit">
          <button
            type="button"
            onClick={() => setSection('overview')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap ${
              section === 'overview'
                ? 'bg-cyan-600 text-slate-950 font-bold shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>NOC Overview</span>
          </button>

          <button
            type="button"
            onClick={() => setSection('capacity')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap ${
              section === 'capacity'
                ? 'bg-cyan-600 text-slate-950 font-bold shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Gauge className="w-3.5 h-3.5" />
            <span>Capacity &amp; Pools (1:6 CIR)</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setEditingOltId(null);
              setIsOltManagerOpen(true);
            }}
            className="px-3.5 py-2 rounded-xl bg-sky-950/80 hover:bg-sky-900/80 text-sky-300 border border-sky-700/80 font-semibold text-xs flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap"
          >
            <Server className="w-3.5 h-3.5 text-sky-400" />
            <span>Manage OLTs (EPON/GPON)</span>
          </button>

          <button
            type="button"
            onClick={() => setIsAreaManagerOpen(true)}
            className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-slate-800 font-semibold text-xs flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap"
          >
            <MapPin className="w-3.5 h-3.5 text-cyan-400" />
            <span>Area &amp; Node Manager</span>
          </button>
        </div>
      </div>

      {section === 'capacity' ? (
        <CapacityPlannerView />
      ) : (
        <div className="space-y-5">
          {/* Multi-OLT Hardware Fleet Panel */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-3 shadow-lg">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-sky-500/15 border border-sky-500/40 flex items-center justify-center text-sky-400">
                  <Server className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white leading-tight">
                    OLT &amp; PON Fleet ({olts.length})
                  </h3>
                  <p className="text-[11px] font-mono text-slate-400">
                    Multi-OLT Registry · EPON (64 ONU/PON) &amp; GPON (128 ONU/PON) synced with Fiber GIS Map
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => refreshOlts()}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 hover:border-slate-700 text-xs font-mono text-slate-300 flex items-center gap-1 cursor-pointer"
                  title="Reload OLT Fleet"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${isLoadingOlts ? 'animate-spin text-cyan-400' : ''}`}
                  />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingOltId(null);
                    setIsOltManagerOpen(true);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-mono font-bold text-xs flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add OLT</span>
                </button>
              </div>
            </div>

            {oltSchemaMissing ? (
              <div className="p-3 rounded-xl bg-amber-950/60 border border-amber-700/60 text-amber-200 text-xs flex flex-wrap items-center justify-between gap-2">
                <span>
                  Run the updated GIS SQL migration in Supabase to enable persistent{' '}
                  <code className="font-mono text-white">gis_olts</code> &amp;{' '}
                  <code className="font-mono text-white">gis_olt_pon_ports</code> tables.
                </span>
                <button
                  type="button"
                  onClick={() => props.onNavigateTab('fiber_gis')}
                  className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-mono font-bold text-xs cursor-pointer"
                >
                  Open Fiber GIS SQL Setup
                </button>
              </div>
            ) : olts.length === 0 ? (
              <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800/80 border-dashed flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-slate-400">
                  No EPON/GPON OLTs registered in Supabase yet. Click{' '}
                  <strong className="text-white">Add OLT</strong> to configure ports (PON 1–16), SFP Tx
                  power (up to +9.0 dBm C+++), and place on your area map.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setEditingOltId(null);
                    setIsOltManagerOpen(true);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 font-mono text-xs cursor-pointer"
                >
                  Configure OLT Fleet
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {olts.map((olt) => {
                  const myPorts = ponPortsByOltId[olt.id] || [];
                  const isPlaced =
                    olt.lat !== null &&
                    olt.lat !== undefined &&
                    olt.lng !== null &&
                    olt.lng !== undefined;
                  const peakTx =
                    myPorts.length > 0
                      ? Math.max(...myPorts.map((p) => Number(p.tx_power_dbm ?? 5.0)))
                      : 5.0;
                  const totalActiveOnus = myPorts.reduce(
                    (acc, p) => acc + Number(p.active_onus || 0),
                    0
                  );
                  const maxOnuCap = olt.total_pon_ports * getDefaultMaxOnuLimit(olt.pon_mode);

                  return (
                    <div
                      key={olt.id}
                      className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex flex-col justify-between gap-2.5"
                    >
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${
                                olt.pon_mode === 'GPON'
                                  ? 'bg-cyan-950 text-cyan-300 border-cyan-700/80'
                                  : 'bg-amber-950 text-amber-300 border-amber-700/80'
                              }`}
                            >
                              {olt.pon_mode}
                            </span>
                            <span className="text-[11px] font-mono text-slate-400">
                              {olt.total_pon_ports} PON
                            </span>
                            <span className="text-[11px] font-mono text-sky-300 font-bold tabular-nums">
                              +{peakTx.toFixed(1)} dBm
                            </span>
                          </div>
                          <span
                            className={`text-[10px] font-mono font-bold ${
                              olt.status === 'ONLINE' ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {olt.status}
                          </span>
                        </div>

                        <div className="text-sm font-bold text-white truncate">{olt.name}</div>
                        <div className="text-[11px] font-mono text-slate-400 truncate">
                          {olt.vendor_model || 'OLT'} · {olt.mgmt_ip || 'No Mgmt IP'} ·{' '}
                          {olt.area_name || 'Unassigned Area'}
                        </div>
                        <div className="text-[11px] font-mono text-slate-400 tabular-nums">
                          ONUs: <span className="text-slate-200">{totalActiveOnus}</span> / {maxOnuCap}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 pt-2 border-t border-slate-800/80">
                        <button
                          type="button"
                          onClick={() => handleJumpToMapForOlt(olt)}
                          className={`flex-1 min-h-[32px] px-2.5 py-1 rounded-lg border font-mono text-[11px] font-semibold flex items-center justify-center gap-1 cursor-pointer ${
                            isPlaced
                              ? 'bg-emerald-950/60 hover:bg-emerald-900/60 text-emerald-300 border-emerald-700/70'
                              : 'bg-amber-950/70 hover:bg-amber-900/70 text-amber-300 border-amber-700/70'
                          }`}
                        >
                          <MapPin className="w-3 h-3" />
                          <span>{isPlaced ? 'Placed on Map' : 'Place on Map'}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setEditingOltId(olt.id);
                            setIsOltManagerOpen(true);
                          }}
                          className="min-h-[32px] px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 font-mono text-[11px] flex items-center gap-1 cursor-pointer"
                          title="Edit OLT & PON Ports"
                        >
                          <Edit3 className="w-3 h-3" />
                          <span>Edit</span>
                        </button>

                        {confirmDeleteOltId !== olt.id ? (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteOltId(olt.id)}
                            className="min-h-[32px] px-2 py-1 rounded-lg bg-slate-900 hover:bg-rose-950 text-rose-400 border border-slate-800 text-[11px] cursor-pointer"
                            title="Delete OLT"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleQuickDeleteOlt(olt.id)}
                            className="min-h-[32px] px-2 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-mono font-bold text-[10px] flex items-center gap-1 cursor-pointer"
                          >
                            <ShieldAlert className="w-3 h-3" />
                            <span>Confirm</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <NocOverview {...props} />
        </div>
      )}

      <AreaNodeManagerModal
        isOpen={isAreaManagerOpen}
        onClose={() => setIsAreaManagerOpen(false)}
      />

      <OltManagerModal
        isOpen={isOltManagerOpen}
        initialOltId={editingOltId}
        onClose={() => {
          setIsOltManagerOpen(false);
          setEditingOltId(null);
        }}
        onPlaceExistingOltOnMap={handleJumpToMapForOlt}
        onOltsChanged={refreshOlts}
      />
    </div>
  );
};

export default NocCommandCenter;
