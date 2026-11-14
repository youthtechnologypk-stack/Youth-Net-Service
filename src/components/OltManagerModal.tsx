import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Crosshair,
  Database,
  Edit3,
  MapPin,
  Plus,
  RefreshCw,
  Save,
  Server,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react';
import type {
  GisLatLng,
  OltPonMode,
  OltPonPortStatus,
  OltSfpClass,
  SupabaseGisOlt,
  SupabaseGisOltPonPort,
} from '../services/supabaseClient';
import {
  PonPortDraftInput,
  deleteOltById,
  loadGisOltsOnly,
  saveOltWithPonPorts,
} from '../services/fiberGisService';
import {
  SFP_CLASS_SPECS,
  SFP_TX_PRESETS,
  getDefaultMaxOnuLimit,
  inferSfpClassFromDbm,
} from '../lib/fiberOpticEngine';
import { DEFAULT_NETWORK_AREAS } from '../lib/billingAndNetwork';

export interface OltFormDraft {
  oltId?: string;
  name: string;
  vendorModel: string;
  ponMode: OltPonMode;
  totalPonPorts: 2 | 4 | 8 | 16;
  mgmtIp: string;
  areaName: string;
  lat: string;
  lng: string;
  status: 'ONLINE' | 'OFFLINE';
  notes: string;
  ports: PonPortDraftInput[];
}

export interface OltManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialOltId?: string | null;
  pickedCoords?: GisLatLng | null;
  preservedDraft?: OltFormDraft | null;
  onRequestPickOnMap?: (draft: OltFormDraft) => void;
  onPlaceExistingOltOnMap?: (olt: SupabaseGisOlt) => void;
  onOltsChanged?: () => void;
  updatedBy?: string;
}

const VENDOR_MODELS = [
  'VSOL V1600G1 (GPON)',
  'VSOL V1600G2 (GPON)',
  'VSOL V1600D4 (EPON)',
  'VSOL V1600D8 (EPON)',
  'Huawei MA5608T',
  'ZTE ZXA10 C320',
  'BDCOM GP3600-08',
  'C-Data FD1608S',
];

function buildDefaultPonPorts(
  count: 2 | 4 | 8 | 16,
  existing: PonPortDraftInput[] = [],
  defaultTx = 5.0
): PonPortDraftInput[] {
  const byNum: Record<number, PonPortDraftInput> = {};
  for (const p of existing) {
    byNum[p.port_number] = p;
  }
  const list: PonPortDraftInput[] = [];
  for (let i = 1; i <= count; i++) {
    const prev = byNum[i];
    if (prev) {
      list.push(prev);
    } else {
      list.push({
        port_number: i,
        port_label: `PON-${i}`,
        sfp_class: inferSfpClassFromDbm(defaultTx),
        tx_power_dbm: defaultTx,
        active_onus: 0,
        status: 'ACTIVE',
      });
    }
  }
  return list;
}

function createEmptyDraft(defaultCount: 2 | 4 | 8 | 16 = 8): OltFormDraft {
  return {
    name: '',
    vendorModel: 'VSOL V1600G1',
    ponMode: 'GPON',
    totalPonPorts: defaultCount,
    mgmtIp: '',
    areaName: '',
    lat: '',
    lng: '',
    status: 'ONLINE',
    notes: '',
    ports: buildDefaultPonPorts(defaultCount, [], 5.0),
  };
}

export const OltManagerModal: React.FC<OltManagerModalProps> = ({
  isOpen,
  onClose,
  initialOltId = null,
  pickedCoords = null,
  preservedDraft = null,
  onRequestPickOnMap,
  onPlaceExistingOltOnMap,
  onOltsChanged,
  updatedBy = 'admin',
}) => {
  const [olts, setOlts] = useState<SupabaseGisOlt[]>([]);
  const [ponPorts, setPonPorts] = useState<SupabaseGisOltPonPort[]>([]);
  const [schemaMissing, setSchemaMissing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'form'>('list');
  const [draft, setDraft] = useState<OltFormDraft>(() => createEmptyDraft(8));
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null);

  const showToast = useCallback((text: string, tone: 'ok' | 'err' = 'ok') => {
    setToast({ text, tone });
    setTimeout(() => {
      setToast((prev) => (prev?.text === text ? null : prev));
    }, 4500);
  }, []);

  const ponPortsByOltId = useMemo(() => {
    const grouped: Record<string, SupabaseGisOltPonPort[]> = {};
    for (const p of ponPorts) {
      if (!grouped[p.olt_id]) grouped[p.olt_id] = [];
      grouped[p.olt_id].push(p);
    }
    return grouped;
  }, [ponPorts]);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await loadGisOltsOnly();
      setOlts(res.olts);
      setPonPorts(res.ponPorts);
      setSchemaMissing(res.schemaMissing);
      return res;
    } catch (err: any) {
      showToast(err?.message || 'Failed to load OLTs from Supabase', 'err');
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  const openEditOlt = useCallback(
    (olt: SupabaseGisOlt, allPorts: SupabaseGisOltPonPort[]) => {
      const myPorts = allPorts
        .filter((p) => p.olt_id === olt.id)
        .map((p) => ({
          port_number: p.port_number,
          port_label: p.port_label || `PON-${p.port_number}`,
          sfp_class: p.sfp_class,
          tx_power_dbm: Number(p.tx_power_dbm ?? 5.0),
          active_onus: Number(p.active_onus ?? 0),
          status: p.status,
        }));

      setDraft({
        oltId: olt.id,
        name: olt.name,
        vendorModel: olt.vendor_model || 'VSOL V1600G1',
        ponMode: olt.pon_mode,
        totalPonPorts: olt.total_pon_ports,
        mgmtIp: olt.mgmt_ip || '',
        areaName: olt.area_name || '',
        lat: olt.lat !== null && olt.lat !== undefined ? String(olt.lat) : '',
        lng: olt.lng !== null && olt.lng !== undefined ? String(olt.lng) : '',
        status: olt.status,
        notes: olt.notes || '',
        ports: buildDefaultPonPorts(olt.total_pon_ports, myPorts, 5.0),
      });
      setViewMode('form');
      setConfirmDeleteId(null);
    },
    []
  );

  useEffect(() => {
    if (!isOpen) {
      setConfirmDeleteId(null);
      return;
    }

    let cancelled = false;
    loadData().then((res) => {
      if (cancelled) return;
      if (preservedDraft) {
        setDraft({
          ...preservedDraft,
          lat: pickedCoords ? pickedCoords.lat.toFixed(6) : preservedDraft.lat,
          lng: pickedCoords ? pickedCoords.lng.toFixed(6) : preservedDraft.lng,
        });
        setViewMode('form');
      } else if (initialOltId && res) {
        const found = res.olts.find((o) => o.id === initialOltId);
        if (found) {
          openEditOlt(found, res.ponPorts);
        } else {
          setViewMode('list');
        }
      } else {
        setViewMode('list');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isOpen, initialOltId, pickedCoords, preservedDraft, loadData, openEditOlt]);

  if (!isOpen) return null;

  const handleTotalPortsChange = (nextCount: 2 | 4 | 8 | 16) => {
    setDraft((prev) => ({
      ...prev,
      totalPonPorts: nextCount,
      ports: buildDefaultPonPorts(nextCount, prev.ports, 5.0),
    }));
  };

  const handleApplyAllSfp = (sfpClass: Exclude<OltSfpClass, 'CUSTOM'>) => {
    const spec = SFP_CLASS_SPECS[sfpClass];
    setDraft((prev) => ({
      ...prev,
      ports: prev.ports.map((p) => ({
        ...p,
        sfp_class: sfpClass,
        tx_power_dbm: spec.txPowerDbm,
      })),
    }));
  };

  const handleUpdateDraftPort = (portNumber: number, patch: Partial<PonPortDraftInput>) => {
    setDraft((prev) => ({
      ...prev,
      ports: prev.ports.map((p) => (p.port_number === portNumber ? { ...p, ...patch } : p)),
    }));
  };

  const handleUseCurrentGps = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      showToast('Browser GPS geolocation is unavailable.', 'err');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setDraft((prev) => ({
          ...prev,
          lat: pos.coords.latitude.toFixed(6),
          lng: pos.coords.longitude.toFixed(6),
        }));
        showToast('Captured GPS coordinates for OLT marker.');
      },
      () => {
        showToast('Unable to read GPS coordinates. Allow location access in browser.', 'err');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleSaveOlt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.name.trim()) {
      showToast('Please enter an OLT Name (e.g. VSOL-Saddar-OLT-01).', 'err');
      return;
    }

    const parsedLat = draft.lat.trim() !== '' ? Number(draft.lat.trim()) : null;
    const parsedLng = draft.lng.trim() !== '' ? Number(draft.lng.trim()) : null;
    if (
      (parsedLat !== null && !Number.isFinite(parsedLat)) ||
      (parsedLng !== null && !Number.isFinite(parsedLng))
    ) {
      showToast('Invalid GPS Latitude / Longitude values.', 'err');
      return;
    }
    if ((parsedLat === null) !== (parsedLng === null)) {
      showToast('Enter both Latitude and Longitude, or leave both empty.', 'err');
      return;
    }

    setIsSaving(true);
    try {
      await saveOltWithPonPorts({
        oltId: draft.oltId,
        name: draft.name,
        vendorModel: draft.vendorModel,
        ponMode: draft.ponMode,
        totalPonPorts: draft.totalPonPorts,
        mgmtIp: draft.mgmtIp,
        areaName: draft.areaName,
        lat: parsedLat,
        lng: parsedLng,
        status: draft.status,
        notes: draft.notes,
        ports: draft.ports,
        updatedBy,
      });

      await loadData();
      onOltsChanged?.();
      setViewMode('list');
      showToast(
        `${draft.name.trim()} (${draft.ponMode} · ${draft.totalPonPorts} PON Ports) saved to Supabase.`
      );
    } catch (err: any) {
      showToast(
        err?.message || 'Failed to save OLT. Ensure GIS Multi-OLT SQL migration is applied.',
        'err'
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteOlt = async (olt: SupabaseGisOlt) => {
    setIsSaving(true);
    try {
      await deleteOltById(olt.id);
      setConfirmDeleteId(null);
      await loadData();
      onOltsChanged?.();
      showToast(`Deleted OLT "${olt.name}" and its PON ports from Supabase.`);
    } catch (err: any) {
      showToast(err?.message || 'Failed to delete OLT', 'err');
    } finally {
      setIsSaving(false);
    }
  };

  const maxOnusForMode = getDefaultMaxOnuLimit(draft.ponMode);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4">
      <div className="w-full max-w-5xl max-h-[92vh] bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-100">
        {/* Header */}
        <div className="px-4 sm:px-6 py-3.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-sky-500/15 border border-sky-500/40 flex items-center justify-center text-sky-400 shrink-0">
              <Server className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm sm:text-base font-bold text-white truncate">
                Multi-OLT &amp; PON Port Manager (EPON / GPON)
              </h3>
              <p className="text-[11px] font-mono text-slate-400 truncate">
                {olts.length} OLT{olts.length === 1 ? '' : 's'} registered · Persistent Supabase GIS Fleet
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {viewMode === 'list' ? (
              <button
                type="button"
                onClick={() => {
                  setDraft(createEmptyDraft(8));
                  setViewMode('form');
                }}
                className="min-h-[38px] px-3 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-mono font-bold text-xs flex items-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Add New OLT</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className="min-h-[38px] px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-mono text-xs cursor-pointer"
              >
                Back to Fleet
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white cursor-pointer"
              aria-label="Close OLT Manager"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Toast Strip */}
        {toast && (
          <div
            className={`px-4 py-2 text-xs font-mono flex items-center justify-between border-b shrink-0 ${
              toast.tone === 'err'
                ? 'bg-rose-950/90 border-rose-800 text-rose-200'
                : 'bg-emerald-950/90 border-emerald-800 text-emerald-200'
            }`}
          >
            <span className="flex items-center gap-2">
              {toast.tone === 'err' ? (
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              )}
              <span>{toast.text}</span>
            </span>
            <button
              type="button"
              onClick={() => setToast(null)}
              className="text-slate-300 hover:text-white cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {schemaMissing && (
            <div className="p-3.5 rounded-xl bg-amber-950/70 border border-amber-700/70 text-amber-200 text-xs flex items-start gap-2.5">
              <Database className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-amber-300">
                  Supabase `gis_olts` / `gis_olt_pon_ports` Tables Required
                </div>
                <p className="text-[11px] text-amber-200/90 mt-0.5">
                  Apply the updated FTTH GIS migration SQL (via the &quot;Copy GIS SQL&quot; button in
                  Fiber GIS &amp; Area Map or `/supabase/migrations/20261114_fiber_gis_schema.sql`) before
                  saving new OLTs.
                </p>
              </div>
            </div>
          )}

          {viewMode === 'list' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono uppercase tracking-wider text-slate-400 font-bold">
                  Registered OLT Hardware Fleet
                </span>
                <button
                  type="button"
                  onClick={() => loadData()}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 hover:border-slate-700 text-xs font-mono text-slate-300 flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-cyan-400' : ''}`} />
                  <span>Refresh</span>
                </button>
              </div>

              {isLoading && olts.length === 0 ? (
                <div className="p-8 text-center text-xs font-mono text-slate-400 bg-slate-950 border border-slate-800 rounded-xl">
                  Loading OLTs from Supabase PostgreSQL...
                </div>
              ) : olts.length === 0 ? (
                <div className="p-8 text-center bg-slate-950 border border-slate-800 border-dashed rounded-xl space-y-3">
                  <Server className="w-8 h-8 text-sky-400 mx-auto opacity-80" />
                  <div>
                    <div className="text-sm font-bold text-white">No OLTs Configured Yet</div>
                    <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
                      Add your EPON or GPON OLTs (VSOL, Huawei, ZTE, BDCOM) with 2–16 PON ports,
                      individual SFP TX levels (up to +9.0 dBm C+++ / +12 dBm), and map pin coordinates.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(createEmptyDraft(8));
                      setViewMode('form');
                    }}
                    className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-mono font-bold text-xs inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Add First OLT</span>
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {olts.map((olt) => {
                    const myPorts = ponPortsByOltId[olt.id] || [];
                    const isPlaced =
                      olt.lat !== null &&
                      olt.lat !== undefined &&
                      olt.lng !== null &&
                      olt.lng !== undefined;
                    const maxTx =
                      myPorts.length > 0
                        ? Math.max(...myPorts.map((p) => Number(p.tx_power_dbm ?? 5.0)))
                        : 5.0;
                    const totalActiveOnus = myPorts.reduce(
                      (acc, p) => acc + Number(p.active_onus || 0),
                      0
                    );
                    const isConfirmDel = confirmDeleteId === olt.id;

                    return (
                      <div
                        key={olt.id}
                        className="p-4 rounded-xl bg-slate-950 border border-slate-800 hover:border-slate-700 transition flex flex-col justify-between gap-3"
                      >
                        <div className="space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${
                                    olt.pon_mode === 'GPON'
                                      ? 'bg-cyan-950/90 text-cyan-300 border-cyan-700/80'
                                      : 'bg-amber-950/90 text-amber-300 border-amber-700/80'
                                  }`}
                                >
                                  {olt.pon_mode}
                                </span>
                                <span
                                  className={`text-[10px] font-mono font-bold ${
                                    olt.status === 'ONLINE' ? 'text-emerald-400' : 'text-rose-400'
                                  }`}
                                >
                                  {olt.status}
                                </span>
                                <span className="text-[10px] font-mono text-slate-400">
                                  {olt.total_pon_ports} PON Ports
                                </span>
                              </div>
                              <h4 className="text-sm font-bold text-white truncate mt-1">
                                {olt.name}
                              </h4>
                              <p className="text-[11px] font-mono text-slate-400 truncate">
                                {olt.vendor_model || 'Standard OLT'}
                                {olt.mgmt_ip ? ` · ${olt.mgmt_ip}` : ''}
                              </p>
                            </div>

                            <div className="text-right font-mono shrink-0">
                              <div className="text-[10px] text-slate-400">Peak SFP TX</div>
                              <div className="text-xs font-bold text-sky-300 tabular-nums">
                                +{maxTx.toFixed(1)} dBm
                              </div>
                            </div>
                          </div>

                          <div className="grid grid-cols-3 gap-2 p-2 rounded-lg bg-slate-900 border border-slate-800/80 text-[11px] font-mono">
                            <div>
                              <span className="text-[10px] text-slate-500 block">Area</span>
                              <span className="text-slate-200 truncate block">
                                {olt.area_name || 'All Sectors'}
                              </span>
                            </div>
                            <div>
                              <span className="text-[10px] text-slate-500 block">ONUs</span>
                              <span className="text-slate-200 tabular-nums">
                                {totalActiveOnus} /{' '}
                                {olt.total_pon_ports * getDefaultMaxOnuLimit(olt.pon_mode)}
                              </span>
                            </div>
                            <div>
                              <span className="text-[10px] text-slate-500 block">GIS Pin</span>
                              <span
                                className={
                                  isPlaced
                                    ? 'text-emerald-400 font-semibold'
                                    : 'text-amber-400 font-semibold'
                                }
                              >
                                {isPlaced ? 'Placed on Map' : 'Not Placed'}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center flex-wrap gap-2 pt-1 border-t border-slate-800/80">
                          <button
                            type="button"
                            onClick={() => openEditOlt(olt, ponPorts)}
                            className="flex-1 min-h-[36px] px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 font-mono font-semibold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span>Edit OLT &amp; PON Ports</span>
                          </button>

                          {onPlaceExistingOltOnMap && (
                            <button
                              type="button"
                              onClick={() => onPlaceExistingOltOnMap(olt)}
                              className="min-h-[36px] px-3 py-1.5 rounded-lg bg-sky-950/80 hover:bg-sky-900 text-sky-300 border border-sky-700/80 font-mono font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
                            >
                              <MapPin className="w-3.5 h-3.5" />
                              <span>{isPlaced ? 'View / Move Pin' : 'Place on Map'}</span>
                            </button>
                          )}

                          {!isConfirmDel ? (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(olt.id)}
                              className="min-h-[36px] px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-rose-950 text-rose-400 border border-slate-800 text-xs cursor-pointer"
                              title="Delete OLT"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={isSaving}
                              onClick={() => handleDeleteOlt(olt)}
                              className="min-h-[36px] px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-mono font-bold text-[11px] flex items-center gap-1 cursor-pointer"
                            >
                              <ShieldAlert className="w-3.5 h-3.5" />
                              <span>Confirm Del</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {viewMode === 'form' && (
            <form onSubmit={handleSaveOlt} className="space-y-5">
              {/* Top Hardware Metadata Card */}
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <span className="text-xs font-mono uppercase tracking-wider text-sky-400 font-bold flex items-center gap-1.5">
                    <Cpu className="w-4 h-4" />
                    <span>{draft.oltId ? 'Edit OLT Chassis & PON Profile' : 'Register New OLT Chassis'}</span>
                  </span>

                  {/* EPON vs GPON Mode Toggle */}
                  <div className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-xl font-mono text-xs">
                    {(['GPON', 'EPON'] as OltPonMode[]).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setDraft((prev) => ({ ...prev, ponMode: mode }))}
                        className={`px-3 py-1 rounded-lg font-bold transition cursor-pointer ${
                          draft.ponMode === mode
                            ? mode === 'GPON'
                              ? 'bg-cyan-600 text-slate-950'
                              : 'bg-amber-500 text-slate-950'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        {mode} ({mode === 'GPON' ? '1:128' : '1:64'})
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                  <div>
                    <label className="block text-[10px] font-mono text-slate-400 mb-1">
                      OLT Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={draft.name}
                      onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
                      placeholder="e.g. VSOL-Saddar-OLT-01"
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-mono text-slate-400 mb-1">
                      Vendor / Model
                    </label>
                    <input
                      type="text"
                      list="olt-vendor-models"
                      value={draft.vendorModel}
                      onChange={(e) => setDraft((p) => ({ ...p, vendorModel: e.target.value }))}
                      placeholder="e.g. VSOL V1600G1"
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
                    />
                    <datalist id="olt-vendor-models">
                      {VENDOR_MODELS.map((m) => (
                        <option key={m} value={m} />
                      ))}
                    </datalist>
                  </div>

                  <div>
                    <label className="block text-[10px] font-mono text-slate-400 mb-1">
                      Total PON Ports
                    </label>
                    <div className="grid grid-cols-4 gap-1.5">
                      {([2, 4, 8, 16] as const).map((cnt) => (
                        <button
                          key={cnt}
                          type="button"
                          onClick={() => handleTotalPortsChange(cnt)}
                          className={`min-h-[34px] rounded-lg border font-mono font-bold text-xs cursor-pointer transition ${
                            draft.totalPonPorts === cnt
                              ? 'bg-sky-600 text-slate-950 border-sky-300'
                              : 'bg-slate-900 text-slate-300 border-slate-700 hover:border-slate-500'
                          }`}
                        >
                          {cnt}P
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-mono text-slate-400 mb-1">
                      Management IP
                    </label>
                    <input
                      type="text"
                      value={draft.mgmtIp}
                      onChange={(e) => setDraft((p) => ({ ...p, mgmtIp: e.target.value }))}
                      placeholder="e.g. 192.168.100.10"
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-cyan-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-mono text-slate-400 mb-1">
                      Primary Area / POP Sector
                    </label>
                    <input
                      type="text"
                      list="olt-area-list"
                      value={draft.areaName}
                      onChange={(e) => setDraft((p) => ({ ...p, areaName: e.target.value }))}
                      placeholder="e.g. Baza Mohallah"
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
                    />
                    <datalist id="olt-area-list">
                      {DEFAULT_NETWORK_AREAS.map((a) => (
                        <option key={a.area_name} value={a.area_name} />
                      ))}
                    </datalist>
                  </div>

                  <div>
                    <label className="block text-[10px] font-mono text-slate-400 mb-1">
                      Chassis Status
                    </label>
                    <select
                      value={draft.status}
                      onChange={(e) =>
                        setDraft((p) => ({ ...p, status: e.target.value as 'ONLINE' | 'OFFLINE' }))
                      }
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono"
                    >
                      <option value="ONLINE">ONLINE (Operational)</option>
                      <option value="OFFLINE">OFFLINE (Maintenance)</option>
                    </select>
                  </div>
                </div>

                {/* GIS Coordinates Row */}
                <div className="pt-2 border-t border-slate-800/80 grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
                  <div className="sm:col-span-3">
                    <label className="block text-[10px] font-mono text-slate-400 mb-1">
                      Latitude (Optional)
                    </label>
                    <input
                      type="text"
                      value={draft.lat}
                      onChange={(e) => setDraft((p) => ({ ...p, lat: e.target.value }))}
                      placeholder="31.520400"
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono tabular-nums"
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <label className="block text-[10px] font-mono text-slate-400 mb-1">
                      Longitude (Optional)
                    </label>
                    <input
                      type="text"
                      value={draft.lng}
                      onChange={(e) => setDraft((p) => ({ ...p, lng: e.target.value }))}
                      placeholder="74.358700"
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono tabular-nums"
                    />
                  </div>
                  <div className="sm:col-span-6 flex items-center flex-wrap gap-2">
                    {onRequestPickOnMap && (
                      <button
                        type="button"
                        onClick={() => onRequestPickOnMap(draft)}
                        className="min-h-[36px] px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-slate-950 font-mono font-bold text-xs flex items-center gap-1.5 cursor-pointer"
                      >
                        <MapPin className="w-3.5 h-3.5" />
                        <span>Pick on Map</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleUseCurrentGps}
                      className="min-h-[36px] px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 font-mono text-xs flex items-center gap-1.5 cursor-pointer"
                    >
                      <Crosshair className="w-3.5 h-3.5" />
                      <span>Use My GPS</span>
                    </button>
                    {(draft.lat || draft.lng) && (
                      <button
                        type="button"
                        onClick={() => setDraft((p) => ({ ...p, lat: '', lng: '' }))}
                        className="min-h-[36px] px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 border border-slate-800 font-mono text-[11px] cursor-pointer"
                      >
                        Clear GPS
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Per-PON Port Configuration Matrix */}
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="text-xs font-mono uppercase tracking-wider text-cyan-300 font-bold">
                      PON Port Allocation (PON 1 – PON {draft.totalPonPorts})
                    </h4>
                    <p className="text-[11px] text-slate-400">
                      Max {maxOnusForMode} ONUs per port in {draft.ponMode} mode. Supports up to +12.0 dBm
                      high-power optical SFPs.
                    </p>
                  </div>

                  {/* Apply-All Quick SFP Presets */}
                  <div className="flex items-center flex-wrap gap-1.5 font-mono text-[11px]">
                    <span className="text-slate-400 mr-1">Set All Ports:</span>
                    {SFP_TX_PRESETS.map((preset) => (
                      <button
                        key={preset.sfpClass}
                        type="button"
                        onClick={() =>
                          handleApplyAllSfp(preset.sfpClass as Exclude<OltSfpClass, 'CUSTOM'>)
                        }
                        className="px-2 py-1 rounded-lg bg-slate-900 hover:bg-sky-900/60 text-sky-300 border border-slate-700 hover:border-sky-500 cursor-pointer"
                      >
                        {preset.sfpClass} (+{preset.txPowerDbm.toFixed(1)})
                      </button>
                    ))}
                  </div>
                </div>

                <div className="overflow-x-auto rounded-xl border border-slate-800">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-900/90 border-b border-slate-800 text-[10px] font-mono uppercase text-slate-400">
                        <th className="py-2 px-3">Port</th>
                        <th className="py-2 px-3">Target Area / Feeder Label</th>
                        <th className="py-2 px-3">SFP Class</th>
                        <th className="py-2 px-3">Tx Power (dBm)</th>
                        <th className="py-2 px-3">Active ONUs</th>
                        <th className="py-2 px-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/80">
                      {draft.ports.map((port) => (
                        <tr key={port.port_number} className="hover:bg-slate-900/40">
                          <td className="py-2 px-3 font-mono font-bold text-white whitespace-nowrap">
                            PON {port.port_number}
                          </td>
                          <td className="py-2 px-3 min-w-[160px]">
                            <input
                              type="text"
                              list="olt-area-list"
                              value={port.port_label}
                              onChange={(e) =>
                                handleUpdateDraftPort(port.port_number, {
                                  port_label: e.target.value,
                                })
                              }
                              placeholder={`e.g. Baza Mohallah North`}
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                            />
                          </td>
                          <td className="py-2 px-3 min-w-[140px]">
                            <select
                              value={port.sfp_class}
                              onChange={(e) => {
                                const cls = e.target.value as OltSfpClass;
                                if (cls !== 'CUSTOM') {
                                  handleUpdateDraftPort(port.port_number, {
                                    sfp_class: cls,
                                    tx_power_dbm: SFP_CLASS_SPECS[cls].txPowerDbm,
                                  });
                                } else {
                                  handleUpdateDraftPort(port.port_number, { sfp_class: 'CUSTOM' });
                                }
                              }}
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white font-mono"
                            >
                              <option value="B+">B+ (+3.5 dBm)</option>
                              <option value="C+">C+ (+5.0 dBm)</option>
                              <option value="C++">C++ (+7.5 dBm)</option>
                              <option value="C+++">C+++ (+9.0 dBm)</option>
                              <option value="CUSTOM">Custom dBm</option>
                            </select>
                          </td>
                          <td className="py-2 px-3 w-28">
                            <input
                              type="number"
                              step="0.1"
                              min="-5"
                              max="12"
                              value={port.tx_power_dbm}
                              onChange={(e) => {
                                const val = Number(e.target.value);
                                handleUpdateDraftPort(port.port_number, {
                                  tx_power_dbm: val,
                                  sfp_class: inferSfpClassFromDbm(val),
                                });
                              }}
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-sky-300 font-mono font-bold tabular-nums"
                            />
                          </td>
                          <td className="py-2 px-3 w-28">
                            <div className="flex items-center gap-1 font-mono">
                              <input
                                type="number"
                                min="0"
                                max={maxOnusForMode}
                                value={port.active_onus ?? 0}
                                onChange={(e) =>
                                  handleUpdateDraftPort(port.port_number, {
                                    active_onus: Number(e.target.value),
                                  })
                                }
                                className="w-16 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white tabular-nums"
                              />
                              <span className="text-[10px] text-slate-500">/{maxOnusForMode}</span>
                            </div>
                          </td>
                          <td className="py-2 px-3 min-w-[110px]">
                            <select
                              value={port.status}
                              onChange={(e) =>
                                handleUpdateDraftPort(port.port_number, {
                                  status: e.target.value as OltPonPortStatus,
                                })
                              }
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white font-mono"
                            >
                              <option value="ACTIVE">ACTIVE</option>
                              <option value="SPARE">SPARE</option>
                              <option value="FAULT">FAULT</option>
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Footer Submit */}
              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setViewMode('list')}
                  className="min-h-[42px] px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono text-xs cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="min-h-[42px] px-5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-slate-950 font-mono font-bold text-xs flex items-center gap-2 cursor-pointer shadow-lg"
                >
                  <Save className="w-4 h-4" />
                  <span>
                    {isSaving
                      ? 'Saving OLT to Supabase...'
                      : draft.oltId
                      ? 'Save OLT & PON Ports'
                      : 'Create OLT & PON Ports'}
                  </span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default OltManagerModal;
