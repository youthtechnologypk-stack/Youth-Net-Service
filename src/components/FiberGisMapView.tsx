import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Cable,
  CheckCircle2,
  Copy,
  Crosshair,
  Database,
  Filter,
  Layers,
  MapPin,
  MousePointer,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  Undo2,
  Wifi,
  Wrench,
  X,
} from 'lucide-react';
import { useISP } from '../context/ISPContext';
import type { UserAccount } from '../types/auth';
import type {
  GisCableTypeCode,
  GisCoreEntry,
  GisLatLng,
  GisNodeType,
  GisPortStatus,
  GisSplitterType,
  OltPonMode,
  SplitterUtilizationType,
  SupabaseGisCable,
  SupabaseGisFdbPort,
  SupabaseGisNode,
  SupabaseGisOlt,
  SupabaseGisOltPonPort,
  SupabaseGisSplitterOutput,
} from '../services/supabaseClient';
import {
  GisRealtimeConnectionStatus,
  GisSubscriberSummary,
  applyRealtimeCableDelta,
  applyRealtimeNodeDelta,
  applyRealtimeOltDelta,
  applyRealtimePonPortDelta,
  applyRealtimePortDelta,
  applyRealtimeSplitterOutputDelta,
  createGisCable,
  createGisNode,
  deleteGisCable,
  deleteGisNode,
  initializeSplitterOutputsForNode,
  loadGisTopology,
  placeOrMoveOltOnMap,
  replaceGisNodeEquipment,
  splitCableWithFoscJoint,
  subscribeToGisRealtime,
  syncOpticalBudgetsToDb,
  updateGisCable,
  updateGisNode,
  updateOltPonPort,
  upsertFdbPortAssignment,
  upsertSplitterOutput,
} from '../services/fiberGisService';
import {
  CABLE_CAPACITY_PRESETS,
  SFP_TX_PRESETS,
  SPLITTER_SPECS,
  calculateTopologyOpticalBudgets,
  computePolylineDistanceMeters,
  inferSfpClassFromDbm,
  inferSplitterCategory,
  traceOpticalPathToNode,
} from '../lib/fiberOpticEngine';
import { FIBER_GIS_MIGRATION_SQL } from '../lib/gisMigrationSql';
import {
  collectSortedAreaOptions,
  computeGisHighlightFilter,
} from '../lib/fiberGisFilter';
import { DEFAULT_NETWORK_AREAS } from '../lib/billingAndNetwork';
import {
  FiberGisLeafletCanvas,
  GisToolMode,
  MapLayerType,
} from './gis/FiberGisLeafletCanvas';
import { FiberGisInspectorPanel } from './gis/FiberGisInspectorPanel';
import { FiberTraceabilityDrawer } from './gis/FiberTraceabilityDrawer';
import { FiberConnectionModal } from './gis/FiberConnectionModal';
import { FiberEquipmentUpgradeModal } from './gis/FiberEquipmentUpgradeModal';
import { OltFormDraft, OltManagerModal } from './OltManagerModal';

interface FiberGisMapViewProps {
  currentUser?: UserAccount | null;
  compactMobile?: boolean;
}

const DEFAULT_MAP_CENTER: GisLatLng = { lat: 31.5204, lng: 74.3587 };
const DEFAULT_MAP_ZOOM = 15;

export const FiberGisMapView: React.FC<FiberGisMapViewProps> = ({
  currentUser,
  compactMobile = false,
}) => {
  const { activeSessions } = useISP();

  const [olts, setOlts] = useState<SupabaseGisOlt[]>([]);
  const [ponPorts, setPonPorts] = useState<SupabaseGisOltPonPort[]>([]);
  const [nodes, setNodes] = useState<SupabaseGisNode[]>([]);
  const [cables, setCables] = useState<SupabaseGisCable[]>([]);
  const [ports, setPorts] = useState<SupabaseGisFdbPort[]>([]);
  const [splitterOutputs, setSplitterOutputs] = useState<SupabaseGisSplitterOutput[]>([]);
  const [subscribers, setSubscribers] = useState<GisSubscriberSummary[]>([]);
  const [schemaMissing, setSchemaMissing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [realtimeStatus, setRealtimeStatus] =
    useState<GisRealtimeConnectionStatus>('CONNECTING');
  const [lastSyncedAt, setLastSyncedAt] = useState<string>('');
  const wasDisconnectedRef = useRef(false);
  const [toastMsg, setToastMsg] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null);

  // Free OpenStreetMap + Esri World Imagery Layer State
  const [layerType, setLayerType] = useState<MapLayerType>('hybrid');
  const [mapCenter, setMapCenter] = useState<GisLatLng>(DEFAULT_MAP_CENTER);
  const [mapZoom, setMapZoom] = useState<number>(DEFAULT_MAP_ZOOM);
  const [flyToTarget, setFlyToTarget] = useState<{
    lat: number;
    lng: number;
    zoom?: number;
    ts: number;
  } | null>(null);

  // Interactive Modes
  const [toolMode, setToolMode] = useState<GisToolMode>('pan');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedCableId, setSelectedCableId] = useState<string | null>(null);
  const [cableClickPoint, setCableClickPoint] = useState<GisLatLng | null>(null);
  const [traceRequest, setTraceRequest] = useState<{
    nodeId: string;
    output?: SupabaseGisSplitterOutput | null;
  } | null>(null);

  // Multi-OLT Manager & Pick/Place on Map state
  const [isOltManagerOpen, setIsOltManagerOpen] = useState(false);
  const [editingOltId, setEditingOltId] = useState<string | null>(null);
  const [oltDraftForPick, setOltDraftForPick] = useState<OltFormDraft | null>(null);
  const [pickedCoordsForModal, setPickedCoordsForModal] = useState<GisLatLng | null>(null);
  const [pendingPlaceOltFromRegistry, setPendingPlaceOltFromRegistry] =
    useState<SupabaseGisOlt | null>(null);

  // Multi-waypoint cable drawing state + Dual-Selection Connection Modal
  const [connectSourceNodeId, setConnectSourceNodeId] = useState<string | null>(null);
  const [connectTargetNodeId, setConnectTargetNodeId] = useState<string | null>(null);
  const [draftWaypoints, setDraftWaypoints] = useState<GisLatLng[]>([]);
  const [draftCableCores, setDraftCableCores] = useState<1 | 2 | 4 | 6 | 8 | 12 | 24 | 48>(12);
  const [isConnectionModalOpen, setIsConnectionModalOpen] = useState(false);
  const [isSqlModalOpen, setIsSqlModalOpen] = useState(false);
  const [upgradeTargetNodeId, setUpgradeTargetNodeId] = useState<string | null>(null);

  // Live GPS Tracking
  const [userLocation, setUserLocation] = useState<GisLatLng | null>(null);
  const [isTrackingGps, setIsTrackingGps] = useState(false);
  const gpsWatchRef = useRef<number | null>(null);

  // Quick Place Node Dialog State
  const [pendingPlaceCoords, setPendingPlaceCoords] = useState<{
    coords: GisLatLng;
    nodeType: GisNodeType;
  } | null>(null);
  const [newNodeName, setNewNodeName] = useState('');
  const [newNodeArea, setNewNodeArea] = useState('');
  const [newNodeTxPower, setNewNodeTxPower] = useState<number>(5.0);
  const [newOltPonMode, setNewOltPonMode] = useState<OltPonMode>('GPON');
  const [newOltTotalPorts, setNewOltTotalPorts] = useState<2 | 4 | 8 | 16>(8);
  const [newOltVendorModel, setNewOltVendorModel] = useState<string>('VSOL V1600G1');
  const [newOltMgmtIp, setNewOltMgmtIp] = useState<string>('');
  const [newNodeSplitter, setNewNodeSplitter] = useState<GisSplitterType>('1:8');
  const [newNodeTrayCap, setNewNodeTrayCap] = useState<number>(12);

  // Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);

  // Highlight Filter State (OLT / PON Port / Area)
  const [filterOltId, setFilterOltId] = useState<string>('ALL');
  const [filterPonPortId, setFilterPonPortId] = useState<string>('ALL');
  const [filterAreaName, setFilterAreaName] = useState<string>('ALL');
  const [filterZoomTriggerTs, setFilterZoomTriggerTs] = useState<number>(0);

  const actorUsername = currentUser?.username || 'admin';

  const showToast = useCallback((text: string, tone: 'ok' | 'err' = 'ok') => {
    setToastMsg({ text, tone });
    setTimeout(() => {
      setToastMsg((prev) => (prev?.text === text ? null : prev));
    }, 4500);
  }, []);

  const activeSessionNames = useMemo(
    () =>
      (activeSessions || [])
        .map((s: any) => s?.username || s?.name || '')
        .filter(Boolean),
    [activeSessions]
  );

  const refreshTopology = useCallback(
    async (centerOnFirstNode = false) => {
      setIsLoading(true);
      try {
        const data = await loadGisTopology(activeSessionNames);
        setSchemaMissing(data.schemaMissing);
        setOlts(data.olts);
        setPonPorts(data.ponPorts);
        setNodes(data.nodes);
        setCables(data.cables);
        setPorts(data.ports);
        setSplitterOutputs(data.splitterOutputs);
        setSubscribers(data.subscribers);

        // Check if NOC requested placing or viewing an OLT pin
        let handledNocJump = false;
        try {
          const jumpOltId = sessionStorage.getItem('youthnet_gis_place_olt_id');
          if (jumpOltId) {
            sessionStorage.removeItem('youthnet_gis_place_olt_id');
            const targetOlt = data.olts.find((o) => o.id === jumpOltId);
            if (targetOlt) {
              handledNocJump = true;
              const existingPin = data.nodes.find((n) => n.olt_id === targetOlt.id);
              if (
                existingPin &&
                targetOlt.lat !== null &&
                targetOlt.lat !== undefined &&
                targetOlt.lng !== null &&
                targetOlt.lng !== undefined
              ) {
                setSelectedNodeId(existingPin.id);
                setFlyToTarget({
                  lat: targetOlt.lat,
                  lng: targetOlt.lng,
                  zoom: 17,
                  ts: Date.now(),
                });
              } else {
                setPendingPlaceOltFromRegistry(targetOlt);
                setToolMode('pick_olt_coords');
                showToast(`Tap anywhere on the map to place OLT "${targetOlt.name}".`);
              }
            }
          }
        } catch {
          // ignore storage access issues
        }

        if (!handledNocJump && centerOnFirstNode && data.nodes.length > 0) {
          const anchor =
            data.nodes.find((n) => n.node_type === 'OLT') || data.nodes[0];
          setFlyToTarget({ lat: anchor.lat, lng: anchor.lng, zoom: 16, ts: Date.now() });
        }

        if (data.nodes.length > 0 && !data.schemaMissing) {
          const portMap: Record<string, SupabaseGisOltPonPort> = {};
          for (const pp of data.ponPorts) portMap[pp.id] = pp;
          syncOpticalBudgetsToDb(data.nodes, data.cables, portMap).catch(() => {});
        }
        setLastSyncedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      } catch (err: any) {
        showToast(err?.message || 'Failed to load FTTH GIS topology', 'err');
      } finally {
        setIsLoading(false);
      }
    },
    [activeSessionNames, showToast]
  );

  useEffect(() => {
    refreshTopology(true);
  }, []);

  // Real-time Supabase WebSocket syncing across gis_olts, gis_olt_pon_ports, gis_nodes, gis_cables, and gis_fdb_ports
  useEffect(() => {
    if (schemaMissing) return;

    const unsubscribe = subscribeToGisRealtime({
      onOltDelta: (eventType, newRow, oldRow) => {
        setOlts((prev) => applyRealtimeOltDelta(prev, eventType, newRow, oldRow));
        setLastSyncedAt(
          new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        );
      },
      onPonPortDelta: (eventType, newRow, oldRow) => {
        setPonPorts((prev) => applyRealtimePonPortDelta(prev, eventType, newRow, oldRow));
        setLastSyncedAt(
          new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        );
      },
      onNodeDelta: (eventType, newRow, oldRow) => {
        setNodes((prev) => applyRealtimeNodeDelta(prev, eventType, newRow, oldRow));
        if (eventType === 'DELETE' && oldRow?.id) {
          setSelectedNodeId((cur) => (cur === oldRow.id ? null : cur));
        }
        setLastSyncedAt(
          new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        );
      },
      onCableDelta: (eventType, newRow, oldRow) => {
        setCables((prev) => applyRealtimeCableDelta(prev, eventType, newRow, oldRow));
        if (eventType === 'DELETE' && oldRow?.id) {
          setSelectedCableId((cur) => (cur === oldRow.id ? null : cur));
        }
        setLastSyncedAt(
          new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        );
      },
      onPortDelta: (eventType, newRow, oldRow) => {
        setPorts((prev) => applyRealtimePortDelta(prev, eventType, newRow, oldRow));
        setLastSyncedAt(
          new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        );
      },
      onSplitterOutputDelta: (eventType, newRow, oldRow) => {
        setSplitterOutputs((prev) =>
          applyRealtimeSplitterOutputDelta(prev, eventType, newRow, oldRow)
        );
        setLastSyncedAt(
          new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        );
      },
      onStatusChange: (status) => {
        setRealtimeStatus(status);
        if (status === 'RECONNECTING' || status === 'ERROR') {
          wasDisconnectedRef.current = true;
        } else if (status === 'SUBSCRIBED' && wasDisconnectedRef.current) {
          wasDisconnectedRef.current = false;
          refreshTopology(false);
        }
      },
    });

    const handleOnline = () => {
      refreshTopology(false);
    };
    window.addEventListener('online', handleOnline);

    return () => {
      window.removeEventListener('online', handleOnline);
      unsubscribe();
    };
  }, [schemaMissing, refreshTopology]);

  // Stop GPS watch on unmount
  useEffect(() => {
    return () => {
      if (gpsWatchRef.current !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
        navigator.geolocation.clearWatch(gpsWatchRef.current);
      }
    };
  }, []);

  const oltsById = useMemo(() => {
    const map: Record<string, SupabaseGisOlt> = {};
    for (const o of olts) map[o.id] = o;
    return map;
  }, [olts]);

  const ponPortsById = useMemo(() => {
    const map: Record<string, SupabaseGisOltPonPort> = {};
    for (const p of ponPorts) map[p.id] = p;
    return map;
  }, [ponPorts]);

  const ponPortsByOltId = useMemo(() => {
    const map: Record<string, SupabaseGisOltPonPort[]> = {};
    for (const p of ponPorts) {
      if (!map[p.olt_id]) map[p.olt_id] = [];
      map[p.olt_id].push(p);
    }
    return map;
  }, [ponPorts]);

  const portsByNodeId = useMemo(() => {
    const map: Record<string, SupabaseGisFdbPort[]> = {};
    for (const p of ports) {
      if (!map[p.fdb_node_id]) map[p.fdb_node_id] = [];
      map[p.fdb_node_id].push(p);
    }
    return map;
  }, [ports]);

  const splitterOutputsByNodeId = useMemo(() => {
    const map: Record<string, SupabaseGisSplitterOutput[]> = {};
    for (const o of splitterOutputs) {
      if (!map[o.node_id]) map[o.node_id] = [];
      map[o.node_id].push(o);
    }
    return map;
  }, [splitterOutputs]);

  const budgetsByNodeId = useMemo(
    () => calculateTopologyOpticalBudgets(nodes, cables, ponPortsById),
    [nodes, cables, ponPortsById]
  );

  const areaFilterOptions = useMemo(
    () =>
      collectSortedAreaOptions({
        nodes,
        olts,
        subscribers,
        splitterOutputs,
      }),
    [nodes, olts, subscribers, splitterOutputs]
  );

  const availablePonPortsForFilter = useMemo(() => {
    const base =
      filterOltId !== 'ALL' ? ponPortsByOltId[filterOltId] || [] : ponPorts;
    return base.slice().sort((a, b) => {
      if (a.olt_id !== b.olt_id) {
        const na = oltsById[a.olt_id]?.name || '';
        const nb = oltsById[b.olt_id]?.name || '';
        return na.localeCompare(nb);
      }
      return a.port_number - b.port_number;
    });
  }, [filterOltId, ponPortsByOltId, ponPorts, oltsById]);

  const highlightFilterResult = useMemo(
    () =>
      computeGisHighlightFilter({
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
      }),
    [
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
    ]
  );

  const fitBoundsTarget = useMemo(() => {
    if (
      !highlightFilterResult.isFilterActive ||
      highlightFilterResult.fitBoundsCoords.length === 0 ||
      filterZoomTriggerTs === 0
    ) {
      return null;
    }
    return {
      bounds: highlightFilterResult.fitBoundsCoords,
      ts: filterZoomTriggerTs,
    };
  }, [
    highlightFilterResult.isFilterActive,
    highlightFilterResult.fitBoundsCoords,
    filterZoomTriggerTs,
  ]);

  const traceResult = useMemo(() => {
    if (!traceRequest) return null;
    const out = traceRequest.output;
    const subMatch = out
      ? subscribers.find(
          (s) =>
            (out.subscriber_id && s.id === out.subscriber_id) ||
            (out.subscriber_username &&
              s.username.toLowerCase() === out.subscriber_username.toLowerCase())
        )
      : undefined;
    return traceOpticalPathToNode({
      targetNodeId: traceRequest.nodeId,
      nodes,
      cables,
      budgetsByNodeId,
      oltsById,
      ponPortsById,
      selectedOutput: out || null,
      subscriberLabel: subMatch ? `${subMatch.fullName} (@${subMatch.username})` : undefined,
      subscriberOnline: subMatch ? subMatch.isOnline : undefined,
    });
  }, [traceRequest, nodes, cables, budgetsByNodeId, oltsById, ponPortsById, subscribers]);

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) || null,
    [nodes, selectedNodeId]
  );

  const selectedCable = useMemo(
    () => cables.find((c) => c.id === selectedCableId) || null,
    [cables, selectedCableId]
  );

  // Quick search matches across Nodes and Subscriber Port Links
  const searchMatches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    const results: Array<{
      id: string;
      title: string;
      subtitle: string;
      node: SupabaseGisNode;
    }> = [];
    for (const n of nodes) {
      if (
        n.name.toLowerCase().includes(q) ||
        (n.area_name || '').toLowerCase().includes(q) ||
        n.node_type.toLowerCase().includes(q)
      ) {
        results.push({
          id: `node-${n.id}`,
          title: n.name,
          subtitle: `${n.node_type}${n.area_name ? ` · ${n.area_name}` : ''}`,
          node: n,
        });
      }
    }
    for (const p of ports) {
      if (
        p.status !== 'FREE' &&
        ((p.subscriber_username || '').toLowerCase().includes(q) ||
          (p.client_label || '').toLowerCase().includes(q))
      ) {
        const parentNode = nodes.find((n) => n.id === p.fdb_node_id);
        if (parentNode) {
          results.push({
            id: `port-${p.id}`,
            title: p.client_label || `@${p.subscriber_username}`,
            subtitle: `${parentNode.name} · Port ${p.port_number}`,
            node: parentNode,
          });
        }
      }
    }
    return results.slice(0, 10);
  }, [searchQuery, nodes, ports]);

  const handleToggleGps = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      showToast('GPS geolocation is unavailable in this browser.', 'err');
      return;
    }

    if (isTrackingGps) {
      if (gpsWatchRef.current !== null) {
        navigator.geolocation.clearWatch(gpsWatchRef.current);
        gpsWatchRef.current = null;
      }
      setIsTrackingGps(false);
      return;
    }

    setIsTrackingGps(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserLocation(coords);
        setFlyToTarget({ ...coords, zoom: 17, ts: Date.now() });
      },
      () => {
        showToast('Unable to read GPS location. Allow location access in browser.', 'err');
        setIsTrackingGps(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );

    gpsWatchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000 }
    );
  };

  const handleMapClick = useCallback(
    async (coords: GisLatLng) => {
      setIsSearchOpen(false);

      if (toolMode === 'pick_olt_coords') {
        if (pendingPlaceOltFromRegistry) {
          setIsSaving(true);
          try {
            const oltPorts = ponPortsByOltId[pendingPlaceOltFromRegistry.id] || [];
            const defaultTx = oltPorts[0]?.tx_power_dbm ?? 5.0;
            const res = await placeOrMoveOltOnMap({
              olt: pendingPlaceOltFromRegistry,
              lat: coords.lat,
              lng: coords.lng,
              defaultTxPowerDbm: defaultTx,
              updatedBy: actorUsername,
            });
            setOlts((prev) => applyRealtimeOltDelta(prev, 'UPDATE', res.olt));
            setNodes((prev) => applyRealtimeNodeDelta(prev, 'INSERT', res.mapNode));
            setPendingPlaceOltFromRegistry(null);
            setToolMode('pan');
            setSelectedNodeId(res.mapNode.id);
            showToast(`Placed "${res.olt.name}" on map at ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}.`);
          } catch (err: any) {
            showToast(err?.message || 'Failed to place OLT marker on map', 'err');
          } finally {
            setIsSaving(false);
          }
          return;
        }

        if (oltDraftForPick) {
          setPickedCoordsForModal(coords);
          setToolMode('pan');
          setIsOltManagerOpen(true);
          return;
        }
      }

      if (
        toolMode === 'place_olt' ||
        toolMode === 'place_dist' ||
        toolMode === 'place_fdb' ||
        toolMode === 'place_fosc'
      ) {
        const nodeType: GisNodeType =
          toolMode === 'place_olt'
            ? 'OLT'
            : toolMode === 'place_dist'
            ? 'DIST_NODE'
            : toolMode === 'place_fosc'
            ? 'FOSC_JOINT'
            : 'FDB_FAT';
        const prefix =
          nodeType === 'OLT'
            ? 'OLT-POP'
            : nodeType === 'DIST_NODE'
            ? 'DIST'
            : nodeType === 'FOSC_JOINT'
            ? 'FOSC'
            : 'FDB';
        const existingCount = nodes.filter((n) => n.node_type === nodeType).length + 1;
        setNewNodeName(`${prefix}-${existingCount}`);
        setNewNodeArea('');
        setNewNodeTxPower(5.0);
        setNewOltPonMode('GPON');
        setNewOltTotalPorts(8);
        setNewOltVendorModel('VSOL V1600G1');
        setNewOltMgmtIp('');
        setNewNodeSplitter(nodeType === 'FDB_FAT' ? '1:8' : nodeType === 'DIST_NODE' ? '90:10' : 'none');
        setNewNodeTrayCap(12);
        setPendingPlaceCoords({ coords, nodeType });
        return;
      }

      if (toolMode === 'connect_cable' && connectSourceNodeId) {
        setDraftWaypoints((prev) => [...prev, coords]);
      }
    },
    [
      toolMode,
      pendingPlaceOltFromRegistry,
      oltDraftForPick,
      ponPortsByOltId,
      actorUsername,
      nodes,
      connectSourceNodeId,
      showToast,
    ]
  );

  const finalizeCreateCable = useCallback(
    async (params: {
      name?: string;
      sourceNode: SupabaseGisNode;
      targetNode: SupabaseGisNode;
      routeCoordinates: GisLatLng[];
      sourceOltId?: string | null;
      sourcePonPortId?: string | null;
      cableType?: GisCableTypeCode;
      cableCores?: 1 | 2 | 4 | 6 | 8 | 12 | 24 | 48;
      distanceMeters?: number;
      cores?: GisCoreEntry[];
      notes?: string;
    }) => {
      setIsSaving(true);
      try {
        const ponLabel =
          params.sourcePonPortId && ponPortsById[params.sourcePonPortId]
            ? ` [PON-${ponPortsById[params.sourcePonPortId].port_number}]`
            : '';
        const created = await createGisCable({
          name:
            params.name?.trim() ||
            `${params.sourceNode.name}${ponLabel} → ${params.targetNode.name}`,
          sourceNodeId: params.sourceNode.id,
          targetNodeId: params.targetNode.id,
          startNodeName: params.sourceNode.name,
          endNodeName: params.targetNode.name,
          sourceOltId: params.sourceOltId || null,
          sourcePonPortId: params.sourcePonPortId || null,
          cableType: params.cableType,
          cableCores: params.cableCores || draftCableCores,
          distanceMeters: params.distanceMeters,
          routeCoordinates: params.routeCoordinates,
          initialCores: params.cores,
          notes: params.notes,
          updatedBy: actorUsername,
        });
        const nextCables = applyRealtimeCableDelta(cables, 'INSERT', created);
        setCables(nextCables);
        syncOpticalBudgetsToDb(nodes, nextCables, ponPortsById).catch(() => {});
        setConnectSourceNodeId(null);
        setConnectTargetNodeId(null);
        setDraftWaypoints([]);
        setIsConnectionModalOpen(false);
        setToolMode('pan');
        setSelectedCableId(created.id);
        setSelectedNodeId(null);
        showToast(
          `✅ Saved to Supabase DB — ${created.cable_cores}-core span${ponLabel} (${created.distance_meters}m).`
        );
      } catch (err: any) {
        showToast(err?.message || 'Failed to save fiber cable route', 'err');
      } finally {
        setIsSaving(false);
      }
    },
    [nodes, cables, ponPortsById, draftCableCores, actorUsername, showToast]
  );

  const handleNodeClick = useCallback(
    async (node: SupabaseGisNode) => {
      setIsSearchOpen(false);
      if (toolMode === 'connect_cable') {
        if (!connectSourceNodeId) {
          setConnectSourceNodeId(node.id);
          setConnectTargetNodeId(null);
          setDraftWaypoints([{ lat: node.lat, lng: node.lng }]);
          setSelectedNodeId(null);
          setSelectedCableId(null);
          showToast(`A-Start selected: ${node.name}. Now click End Node (B-End) or pick below.`);
          return;
        }
        if (connectSourceNodeId === node.id) {
          showToast('Select a different End Node (B-End) to complete the fiber route.', 'err');
          return;
        }

        setConnectTargetNodeId(node.id);
        setDraftWaypoints((prev) => {
          const base = prev.length > 0 ? prev : [{ lat: node.lat, lng: node.lng }];
          const last = base[base.length - 1];
          if (last && last.lat === node.lat && last.lng === node.lng) return base;
          return [...base, { lat: node.lat, lng: node.lng }];
        });
        setIsConnectionModalOpen(true);
        return;
      }

      setSelectedNodeId(node.id);
      setSelectedCableId(null);
      setCableClickPoint(null);
    },
    [toolMode, connectSourceNodeId, showToast]
  );

  const handleNodeDragEnd = useCallback(
    async (node: SupabaseGisNode, coords: GisLatLng) => {
      setIsSaving(true);
      try {
        if (node.node_type === 'OLT' && node.olt_id && oltsById[node.olt_id]) {
          const res = await placeOrMoveOltOnMap({
            olt: oltsById[node.olt_id],
            lat: coords.lat,
            lng: coords.lng,
            updatedBy: actorUsername,
          });
          setOlts((prev) => applyRealtimeOltDelta(prev, 'UPDATE', res.olt));
          setNodes((prev) => applyRealtimeNodeDelta(prev, 'UPDATE', res.mapNode));
        } else {
          const updated = await updateGisNode(node.id, {
            lat: coords.lat,
            lng: coords.lng,
            updated_by: actorUsername,
          });
          setNodes((prev) => applyRealtimeNodeDelta(prev, 'UPDATE', updated));
        }
        showToast(
          `Moved "${node.name}" to ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)} in Supabase.`
        );
      } catch (err: any) {
        showToast(err?.message || 'Failed to update node coordinates', 'err');
      } finally {
        setIsSaving(false);
      }
    },
    [oltsById, actorUsername, showToast]
  );

  const handleCableClick = useCallback(
    (cable: SupabaseGisCable, clickCoords?: GisLatLng) => {
      if (toolMode === 'connect_cable') return;
      setSelectedCableId(cable.id);
      setSelectedNodeId(null);
      setCableClickPoint(clickCoords || null);
    },
    [toolMode]
  );

  const handleCreatePendingNode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingPlaceCoords) return;
    setIsSaving(true);
    try {
      const chosenSplitter =
        pendingPlaceCoords.nodeType === 'FDB_FAT' || pendingPlaceCoords.nodeType === 'DIST_NODE'
          ? newNodeSplitter
          : 'none';
      const { node: createdNode, olt: createdOlt, ponPorts: createdPonPorts } = await createGisNode({
        nodeType: pendingPlaceCoords.nodeType,
        name: newNodeName || 'GIS-Node',
        areaName: newNodeArea,
        lat: pendingPlaceCoords.coords.lat,
        lng: pendingPlaceCoords.coords.lng,
        txPowerDbm: newNodeTxPower,
        sfpClass: inferSfpClassFromDbm(newNodeTxPower),
        ponMode: newOltPonMode,
        totalPonPorts: newOltTotalPorts,
        vendorModel: newOltVendorModel,
        mgmtIp: newOltMgmtIp,
        splitterCategory: inferSplitterCategory(chosenSplitter),
        splitterType: chosenSplitter,
        trayCapacity: newNodeTrayCap,
        updatedBy: actorUsername,
      });
      setNodes((prev) => applyRealtimeNodeDelta(prev, 'INSERT', createdNode));
      if (chosenSplitter !== 'none') {
        try {
          const createdOutputs = await initializeSplitterOutputsForNode({
            node: createdNode,
            splitterType: chosenSplitter,
            totalPorts: createdNode.total_ports,
            inputDbm: null,
            existingOutputs: [],
          });
          setSplitterOutputs((prev) => {
            let next = prev;
            for (const o of createdOutputs) {
              next = applyRealtimeSplitterOutputDelta(next, 'INSERT', o);
            }
            return next;
          });
        } catch {
          // ignore if gis_splitter_outputs migration hasn't been applied yet
        }
      }
      if (createdOlt) {
        setOlts((prev) => applyRealtimeOltDelta(prev, 'INSERT', createdOlt));
      }
      if (Array.isArray(createdPonPorts)) {
        setPonPorts((prev) => {
          let next = prev;
          for (const pp of createdPonPorts) {
            next = applyRealtimePonPortDelta(next, 'INSERT', pp);
          }
          return next;
        });
      }
      setPendingPlaceCoords(null);
      setToolMode('pan');
      setSelectedNodeId(createdNode.id);
      setSelectedCableId(null);
      showToast(`Created ${createdNode.name} and saved to PostgreSQL.`);
    } catch (err: any) {
      showToast(err?.message || 'Failed to save GIS node', 'err');
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdatePonPort = useCallback(
    async (portId: string, patch: Partial<SupabaseGisOltPonPort>) => {
      setIsSaving(true);
      try {
        const updatedPort = await updateOltPonPort(portId, patch);
        const nextPorts = applyRealtimePonPortDelta(ponPorts, 'UPDATE', updatedPort);
        setPonPorts(nextPorts);
        const nextPortMap: Record<string, SupabaseGisOltPonPort> = {};
        for (const pp of nextPorts) nextPortMap[pp.id] = pp;
        syncOpticalBudgetsToDb(nodes, cables, nextPortMap).catch(() => {});
        showToast(
          `Updated PON-${updatedPort.port_number} TX to +${Number(updatedPort.tx_power_dbm).toFixed(1)} dBm (${updatedPort.sfp_class}).`
        );
      } catch (err: any) {
        showToast(err?.message || 'Failed to update PON port TX power', 'err');
      } finally {
        setIsSaving(false);
      }
    },
    [ponPorts, nodes, cables, showToast]
  );

  const handleSaveNode = async (nodeId: string, patch: Partial<SupabaseGisNode>) => {
    setIsSaving(true);
    try {
      const updated = await updateGisNode(nodeId, { ...patch, updated_by: actorUsername });
      const nextNodes = applyRealtimeNodeDelta(nodes, 'UPDATE', updated);
      setNodes(nextNodes);
      syncOpticalBudgetsToDb(nextNodes, cables, ponPortsById).catch(() => {});
      showToast('✅ Saved to Supabase DB — Node & cascaded optical power updated.');
    } catch (err: any) {
      showToast(err?.message || 'Failed to update node', 'err');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteNode = async (nodeId: string) => {
    setIsSaving(true);
    try {
      await deleteGisNode(nodeId);
      const nextNodes = applyRealtimeNodeDelta(nodes, 'DELETE', undefined, { id: nodeId });
      const nextCables = cables.filter((c) => c.source_node_id !== nodeId && c.target_node_id !== nodeId);
      setNodes(nextNodes);
      setCables(nextCables);
      setPorts((prev) => prev.filter((p) => p.fdb_node_id !== nodeId));
      setSelectedNodeId(null);
      syncOpticalBudgetsToDb(nextNodes, nextCables, ponPortsById).catch(() => {});
      showToast('Node deleted from Supabase GIS topology.');
    } catch (err: any) {
      showToast(err?.message || 'Failed to delete node', 'err');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveCable = async (cableId: string, patch: Partial<SupabaseGisCable>) => {
    setIsSaving(true);
    try {
      const existing = cables.find((c) => c.id === cableId);
      const startNodeName = existing
        ? nodes.find((n) => n.id === existing.source_node_id)?.name
        : undefined;
      const endNodeName = existing
        ? nodes.find((n) => n.id === existing.target_node_id)?.name
        : undefined;
      const updated = await updateGisCable(
        cableId,
        { ...patch, updated_by: actorUsername },
        { startNodeName, endNodeName }
      );
      const nextCables = applyRealtimeCableDelta(cables, 'UPDATE', updated);
      setCables(nextCables);
      syncOpticalBudgetsToDb(nodes, nextCables, ponPortsById).catch(() => {});
      showToast('✅ Saved to Supabase DB — Fiber core routing & optical power updated.');
    } catch (err: any) {
      showToast(err?.message || 'Failed to save cable cores', 'err');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteCable = async (cableId: string) => {
    setIsSaving(true);
    try {
      await deleteGisCable(cableId);
      const nextCables = applyRealtimeCableDelta(cables, 'DELETE', undefined, { id: cableId });
      setCables(nextCables);
      setSelectedCableId(null);
      syncOpticalBudgetsToDb(nodes, nextCables, ponPortsById).catch(() => {});
      showToast('Fiber cable span deleted from Supabase.');
    } catch (err: any) {
      showToast(err?.message || 'Failed to delete cable', 'err');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSplitCable = async (cable: SupabaseGisCable, splitPoint?: GisLatLng) => {
    setIsSaving(true);
    try {
      const src = nodes.find((n) => n.id === cable.source_node_id);
      const dst = nodes.find((n) => n.id === cable.target_node_id);
      const res = await splitCableWithFoscJoint({
        cable,
        sourceNode: src,
        targetNode: dst,
        splitPoint,
        updatedBy: actorUsername,
      });
      const nextNodes = applyRealtimeNodeDelta(nodes, 'INSERT', res.jointNode);
      let nextCables = applyRealtimeCableDelta(cables, 'DELETE', undefined, { id: cable.id });
      nextCables = applyRealtimeCableDelta(nextCables, 'INSERT', res.spanA);
      nextCables = applyRealtimeCableDelta(nextCables, 'INSERT', res.spanB);
      setNodes(nextNodes);
      setCables(nextCables);
      syncOpticalBudgetsToDb(nextNodes, nextCables, ponPortsById).catch(() => {});
      setSelectedCableId(null);
      setSelectedNodeId(res.jointNode.id);
      setCableClickPoint(null);
      showToast(
        `✅ Saved to Supabase DB — Inserted ${res.jointNode.name} (${res.spanA.distance_meters}m + ${res.spanB.distance_meters}m).`
      );
    } catch (err: any) {
      showToast(err?.message || 'Failed to split cable at joint closure', 'err');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAssignPort = async (params: {
    fdbNodeId: string;
    portNumber: number;
    subscriberId?: string | null;
    subscriberUsername?: string | null;
    clientLabel?: string | null;
    dropCableMeters: number;
    status: GisPortStatus;
  }) => {
    setIsSaving(true);
    try {
      const savedPort = await upsertFdbPortAssignment(params);
      setPorts((prev) => applyRealtimePortDelta(prev, 'INSERT', savedPort));
      showToast(`✅ Saved to Supabase DB — Port ${params.portNumber} assignment updated.`);
    } catch (err: any) {
      showToast(err?.message || 'Failed to update port assignment', 'err');
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpsertSplitterOutput = async (params: {
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
  }) => {
    setIsSaving(true);
    try {
      const res = await upsertSplitterOutput(params);
      setSplitterOutputs((prev) =>
        applyRealtimeSplitterOutputDelta(prev, 'INSERT', res.output)
      );
      if (res.fdbPort) {
        setPorts((prev) => applyRealtimePortDelta(prev, 'INSERT', res.fdbPort));
      }
      showToast(`${res.output.leg_label || `Port ${params.portNumber}`} saved to Supabase.`);
    } catch (err: any) {
      showToast(err?.message || 'Failed to save splitter output assignment', 'err');
    } finally {
      setIsSaving(false);
    }
  };

  const handleInitializeSplitterOutputs = async (params: {
    node: SupabaseGisNode;
    splitterType: GisSplitterType;
    totalPorts: number;
    inputDbm?: number | null;
  }) => {
    setIsSaving(true);
    try {
      const updatedNode = await updateGisNode(params.node.id, {
        splitter_category: inferSplitterCategory(params.splitterType),
        splitter_type: params.splitterType,
        total_ports: params.totalPorts,
        updated_by: actorUsername,
      });
      setNodes((prev) => applyRealtimeNodeDelta(prev, 'UPDATE', updatedNode));

      const synced = await initializeSplitterOutputsForNode({
        node: updatedNode,
        splitterType: params.splitterType,
        totalPorts: params.totalPorts,
        inputDbm: params.inputDbm ?? null,
        existingOutputs: splitterOutputsByNodeId[params.node.id] || [],
      });
      setSplitterOutputs((prev) => {
        const filtered = prev.filter((o) => o.node_id !== params.node.id);
        return [...filtered, ...synced];
      });
      showToast(`Synchronized ${synced.length} splitter output legs for ${updatedNode.name}.`);
    } catch (err: any) {
      showToast(err?.message || 'Failed to initialize splitter outputs', 'err');
    } finally {
      setIsSaving(false);
    }
  };

  const upgradeTargetNode = useMemo(
    () => (upgradeTargetNodeId ? nodes.find((n) => n.id === upgradeTargetNodeId) || null : null),
    [nodes, upgradeTargetNodeId]
  );

  const handleReplaceNodeEquipment = async (params: {
    newNodeType: GisNodeType;
    fiberNodeTypeOverride?: 'OLT' | 'FDB' | 'FAT' | 'JOINT_CLOSURE' | 'POLE';
    newEquipmentLabel: string;
    newSplitterType: GisSplitterType;
    newTotalPorts: number;
    newTrayCapacity: number;
    newTxPowerDbm?: number;
    reason: string;
    deductInventoryItemId?: string | null;
    returnInventoryItemId?: string | null;
  }) => {
    if (!upgradeTargetNode) return;
    setIsSaving(true);
    try {
      const result = await replaceGisNodeEquipment({
        node: upgradeTargetNode,
        allNodes: nodes,
        allCables: cables,
        ponPortsById,
        existingPorts: portsByNodeId[upgradeTargetNode.id] || [],
        existingOutputs: splitterOutputsByNodeId[upgradeTargetNode.id] || [],
        newNodeType: params.newNodeType,
        fiberNodeTypeOverride: params.fiberNodeTypeOverride,
        newEquipmentLabel: params.newEquipmentLabel,
        newSplitterType: params.newSplitterType,
        newTotalPorts: params.newTotalPorts,
        newTrayCapacity: params.newTrayCapacity,
        newTxPowerDbm: params.newTxPowerDbm,
        reason: params.reason,
        actor: actorUsername,
        deductInventoryItemId: params.deductInventoryItemId,
        returnInventoryItemId: params.returnInventoryItemId,
      });

      setNodes((prev) => applyRealtimeNodeDelta(prev, 'UPDATE', result.updatedNode));
      setPorts((prev) => {
        const filtered = prev.filter((p) => p.fdb_node_id !== result.updatedNode.id);
        return [...filtered, ...result.updatedPorts];
      });
      setSplitterOutputs((prev) => {
        const filtered = prev.filter((o) => o.node_id !== result.updatedNode.id);
        return [...filtered, ...result.updatedOutputs];
      });

      setUpgradeTargetNodeId(null);
      const stockNotes = [
        result.deductedItemName ? `-1 ${result.deductedItemName}` : null,
        result.returnedItemName ? `+1 returned ${result.returnedItemName}` : null,
      ]
        .filter(Boolean)
        .join(', ');
      showToast(
        `Replaced equipment on "${result.updatedNode.name}" -> ${params.newEquipmentLabel}${
          stockNotes ? ` (${stockNotes})` : ''
        }. Cascaded optical power recalculated.`
      );
      refreshTopology(false);
    } catch (err: any) {
      showToast(err?.message || 'Equipment upgrade failed', 'err');
      throw err;
    } finally {
      setIsSaving(false);
    }
  };

  // Summary Stats (zero-pill clean metrics)
  const summaryStats = useMemo(() => {
    let oltCount = 0;
    let distCount = 0;
    let fdbCount = 0;
    let foscCount = 0;
    let totalPorts = 0;
    let usedPorts = 0;
    for (const n of nodes) {
      if (n.node_type === 'OLT') oltCount++;
      else if (n.node_type === 'DIST_NODE') distCount++;
      else if (n.node_type === 'FOSC_JOINT') foscCount++;
      else {
        fdbCount++;
        totalPorts += Number(n.total_ports || 0);
        const np = portsByNodeId[n.id] || [];
        usedPorts += np.filter((p) => p.status !== 'FREE').length;
      }
    }
    const totalFiberMeters = cables.reduce((acc, c) => acc + Number(c.distance_meters || 0), 0);
    return {
      oltCount,
      distCount,
      fdbCount,
      foscCount,
      freePorts: Math.max(0, totalPorts - usedPorts),
      totalPorts,
      totalFiberKm: (totalFiberMeters / 1000).toFixed(2),
    };
  }, [nodes, cables, portsByNodeId]);

  const draftDistanceMeters = useMemo(
    () => computePolylineDistanceMeters(draftWaypoints),
    [draftWaypoints]
  );

  return (
    <div className="flex flex-col bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl text-slate-100">
      {/* Migration Required Banner */}
      {schemaMissing && (
        <div className="p-4 bg-amber-950/90 border-b border-amber-700/80 text-amber-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="font-bold text-xs font-mono flex items-center gap-2 text-amber-300">
              <Database className="w-4 h-4" />
              <span>Supabase FTTH Fiber GIS Tables Not Initialized Yet</span>
            </div>
            <p className="text-[11px] text-amber-200/90">
              Run the SQL migration in your Supabase SQL Editor to update{' '}
              <code className="font-mono text-white">gis_olts</code>,{' '}
              <code className="font-mono text-white">gis_nodes</code>,{' '}
              <code className="font-mono text-white">gis_cables</code>,{' '}
              <code className="font-mono text-white">gis_fdb_ports</code>, and{' '}
              <code className="font-mono text-white">gis_splitter_outputs</code>.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(FIBER_GIS_MIGRATION_SQL);
                setCopiedSql(true);
                setTimeout(() => setCopiedSql(false), 3000);
              }}
              className="min-h-[40px] px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-mono font-bold text-xs flex items-center gap-1.5 cursor-pointer"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>{copiedSql ? 'Copied SQL!' : 'Copy GIS SQL'}</span>
            </button>
            <button
              type="button"
              onClick={() => refreshTopology(true)}
              className="min-h-[40px] px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white border border-slate-700 font-mono text-xs flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry</span>
            </button>
          </div>
        </div>
      )}

      {/* Top GIS Toolbar */}
      <div className="p-3 bg-slate-900/95 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2.5">
        {/* Title & Compact Search */}
        <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[240px]">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-sky-600/20 border border-sky-500/40 flex items-center justify-center text-sky-400 shrink-0">
              <MapPin className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xs sm:text-sm font-bold text-white leading-tight whitespace-nowrap">
                  FTTH Fiber GIS &amp; Area Map
                </h2>
                <span
                  className={`inline-flex items-center gap-1 text-[10px] font-mono whitespace-nowrap ${
                    realtimeStatus === 'SUBSCRIBED'
                      ? 'text-emerald-400'
                      : realtimeStatus === 'ERROR'
                      ? 'text-rose-400'
                      : 'text-amber-400'
                  }`}
                  title={
                    lastSyncedAt
                      ? `Supabase Realtime Sync (${realtimeStatus}) · Last event ${lastSyncedAt}`
                      : `Supabase Realtime Sync (${realtimeStatus})`
                  }
                >
                  <Wifi className="w-3 h-3" />
                  <span>
                    {realtimeStatus === 'SUBSCRIBED'
                      ? 'Live Sync'
                      : realtimeStatus === 'ERROR'
                      ? 'Sync Offline'
                      : 'Syncing...'}
                  </span>
                </span>
              </div>
              <p className="text-[10px] font-mono text-slate-400 tabular-nums whitespace-nowrap">
                {summaryStats.oltCount} OLT · {summaryStats.distCount} Dist · {summaryStats.fdbCount} FDB ({summaryStats.freePorts}/
                {summaryStats.totalPorts} Free) · {summaryStats.foscCount} FOSC ·{' '}
                {summaryStats.totalFiberKm} km
              </p>
            </div>
          </div>

          {/* Search Bar */}
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onFocus={() => setIsSearchOpen(true)}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setIsSearchOpen(true);
              }}
              placeholder="Find FDB, area, or @subscriber..."
              className="w-full min-h-[40px] bg-slate-950 border border-slate-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />
            {isSearchOpen && searchMatches.length > 0 && (
              <div className="absolute left-0 right-0 top-11 z-50 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl divide-y divide-slate-800 max-h-60 overflow-y-auto">
                {searchMatches.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      setIsSearchOpen(false);
                      setSearchQuery(m.title);
                      setSelectedNodeId(m.node.id);
                      setSelectedCableId(null);
                      setFlyToTarget({
                        lat: m.node.lat,
                        lng: m.node.lng,
                        zoom: 18,
                        ts: Date.now(),
                      });
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-slate-800 transition cursor-pointer"
                  >
                    <div className="text-xs font-semibold text-white truncate">{m.title}</div>
                    <div className="text-[10px] font-mono text-cyan-400 truncate">{m.subtitle}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Interactive Tool Actions */}
        <div className="flex items-center flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => {
              setToolMode('pan');
              setConnectSourceNodeId(null);
              setConnectTargetNodeId(null);
              setDraftWaypoints([]);
            }}
            className={`min-h-[40px] px-2.5 py-1.5 rounded-lg border text-xs font-mono font-semibold flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition ${
              toolMode === 'pan'
                ? 'bg-slate-100 text-slate-950 border-white'
                : 'bg-slate-950 text-slate-300 border-slate-700 hover:border-slate-500'
            }`}
          >
            <MousePointer className="w-3.5 h-3.5" />
            <span>Select</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setEditingOltId(null);
              setOltDraftForPick(null);
              setPickedCoordsForModal(null);
              setIsOltManagerOpen(true);
            }}
            className="min-h-[40px] px-2.5 py-1.5 rounded-lg border text-xs font-mono font-semibold flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition bg-sky-950/80 text-sky-300 border-sky-700/80 hover:border-sky-500"
            title="Add, Edit & Delete EPON/GPON OLTs and PON Ports"
          >
            <Server className="w-3.5 h-3.5" />
            <span>Manage OLTs</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setToolMode('place_olt');
              setConnectSourceNodeId(null);
              setConnectTargetNodeId(null);
              setDraftWaypoints([]);
            }}
            className={`min-h-[40px] px-2.5 py-1.5 rounded-lg border text-xs font-mono font-semibold flex items-center gap-1 whitespace-nowrap cursor-pointer transition ${
              toolMode === 'place_olt'
                ? 'bg-sky-600 text-white border-sky-300'
                : 'bg-slate-950 text-sky-300 border-slate-700 hover:border-sky-600'
            }`}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>OLT</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setToolMode('place_dist');
              setConnectSourceNodeId(null);
              setConnectTargetNodeId(null);
              setDraftWaypoints([]);
            }}
            className={`min-h-[40px] px-2.5 py-1.5 rounded-lg border text-xs font-mono font-semibold flex items-center gap-1 whitespace-nowrap cursor-pointer transition ${
              toolMode === 'place_dist'
                ? 'bg-indigo-600 text-white border-indigo-300'
                : 'bg-slate-950 text-indigo-300 border-slate-700 hover:border-indigo-500'
            }`}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Dist Node</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setToolMode('place_fdb');
              setConnectSourceNodeId(null);
              setConnectTargetNodeId(null);
              setDraftWaypoints([]);
            }}
            className={`min-h-[40px] px-2.5 py-1.5 rounded-lg border text-xs font-mono font-semibold flex items-center gap-1 whitespace-nowrap cursor-pointer transition ${
              toolMode === 'place_fdb'
                ? 'bg-emerald-600 text-white border-emerald-300'
                : 'bg-slate-950 text-emerald-300 border-slate-700 hover:border-emerald-600'
            }`}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>FDB / FAT</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setToolMode('place_fosc');
              setConnectSourceNodeId(null);
              setConnectTargetNodeId(null);
              setDraftWaypoints([]);
            }}
            className={`min-h-[40px] px-2.5 py-1.5 rounded-lg border text-xs font-mono font-semibold flex items-center gap-1 whitespace-nowrap cursor-pointer transition ${
              toolMode === 'place_fosc'
                ? 'bg-purple-600 text-white border-purple-300'
                : 'bg-slate-950 text-purple-300 border-slate-700 hover:border-purple-600'
            }`}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>FOSC Joint</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setToolMode('connect_cable');
              setConnectSourceNodeId(null);
              setConnectTargetNodeId(null);
              setDraftWaypoints([]);
            }}
            className={`min-h-[40px] px-2.5 py-1.5 rounded-lg border text-xs font-mono font-semibold flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition ${
              toolMode === 'connect_cable'
                ? 'bg-cyan-500 text-slate-950 border-white font-bold'
                : 'bg-slate-950 text-cyan-300 border-slate-700 hover:border-cyan-500'
            }`}
          >
            <Cable className="w-3.5 h-3.5" />
            <span>Connect Fiber</span>
          </button>

          <button
            type="button"
            onClick={handleToggleGps}
            className={`min-h-[40px] px-2.5 py-1.5 rounded-lg border text-xs font-mono font-semibold flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition ${
              isTrackingGps
                ? 'bg-sky-500 text-slate-950 border-white font-bold'
                : 'bg-slate-950 text-slate-300 border-slate-700 hover:border-sky-500'
            }`}
            title="Track My GPS Location"
          >
            <Crosshair className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{isTrackingGps ? 'GPS Live' : 'My GPS'}</span>
          </button>

          {/* Layer Selector (Esri Satellite / Hybrid Labels / OpenStreetMap Street) */}
          <div className="flex items-center bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden min-h-[40px]">
            {(['satellite', 'hybrid', 'roadmap'] as MapLayerType[]).map((lt) => (
              <button
                key={lt}
                type="button"
                onClick={() => setLayerType(lt)}
                className={`px-2.5 h-full min-h-[38px] text-[11px] font-mono font-semibold capitalize cursor-pointer transition ${
                  layerType === lt
                    ? 'bg-sky-600 text-white font-bold dark:bg-sky-500/20 dark:text-sky-300'
                    : 'text-slate-700 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                {lt === 'roadmap' ? 'Street' : lt}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setIsSqlModalOpen(true)}
            className="min-h-[40px] px-2.5 py-1.5 rounded-lg bg-slate-950 border border-amber-700/70 hover:border-amber-500 text-amber-300 font-mono font-semibold text-xs flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            title="View & Copy Supabase GIS SQL Schema"
          >
            <Database className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">GIS SQL</span>
          </button>

          <button
            type="button"
            onClick={() => refreshTopology(false)}
            className="min-h-[40px] min-w-[40px] rounded-lg bg-slate-950 border border-slate-700 hover:border-slate-500 text-slate-300 flex items-center justify-center cursor-pointer"
            title="Reload Topology"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-cyan-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Highlight Filter Bar (OLT / PON Port / Area) */}
      <div className="px-3 py-2 bg-slate-900/80 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
          <div className="flex items-center gap-1.5 text-[11px] font-mono font-bold text-cyan-400 shrink-0">
            <Filter className="w-3.5 h-3.5" />
            <span>Highlight Filter</span>
          </div>

          <select
            aria-label="Filter by OLT"
            value={filterOltId}
            onChange={(e) => {
              const nextOltId = e.target.value;
              setFilterOltId(nextOltId);
              if (
                nextOltId !== 'ALL' &&
                filterPonPortId !== 'ALL' &&
                ponPortsById[filterPonPortId]?.olt_id !== nextOltId
              ) {
                setFilterPonPortId('ALL');
              }
              setFilterZoomTriggerTs(Date.now());
            }}
            className="min-h-[36px] max-w-full bg-slate-950 border border-slate-700 hover:border-cyan-600/70 rounded-lg px-2.5 py-1 text-xs font-mono text-white focus:outline-none focus:border-cyan-500 cursor-pointer"
          >
            <option value="ALL">All OLTs ({olts.length})</option>
            {olts
              .slice()
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((olt) => (
                <option key={olt.id} value={olt.id}>
                  {olt.name} ({olt.pon_mode})
                </option>
              ))}
          </select>

          <select
            aria-label="Filter by PON Port"
            value={filterPonPortId}
            onChange={(e) => {
              const nextPonId = e.target.value;
              setFilterPonPortId(nextPonId);
              if (nextPonId !== 'ALL' && filterOltId === 'ALL') {
                const parentOltId = ponPortsById[nextPonId]?.olt_id;
                if (parentOltId) setFilterOltId(parentOltId);
              }
              setFilterZoomTriggerTs(Date.now());
            }}
            className="min-h-[36px] max-w-full bg-slate-950 border border-slate-700 hover:border-cyan-600/70 rounded-lg px-2.5 py-1 text-xs font-mono text-white focus:outline-none focus:border-cyan-500 cursor-pointer"
          >
            <option value="ALL">All PON Ports ({availablePonPortsForFilter.length})</option>
            {availablePonPortsForFilter.map((pp) => {
              const oltName = oltsById[pp.olt_id]?.name || 'OLT';
              const prefix = filterOltId === 'ALL' ? `${oltName} · ` : '';
              return (
                <option key={pp.id} value={pp.id}>
                  {prefix}PON {pp.port_number}
                  {pp.port_label ? ` — ${pp.port_label}` : ''}
                </option>
              );
            })}
          </select>

          <select
            aria-label="Filter by Area or Mohallah"
            value={filterAreaName}
            onChange={(e) => {
              setFilterAreaName(e.target.value);
              setFilterZoomTriggerTs(Date.now());
            }}
            className="min-h-[36px] max-w-full bg-slate-950 border border-slate-700 hover:border-cyan-600/70 rounded-lg px-2.5 py-1 text-xs font-mono text-white focus:outline-none focus:border-cyan-500 cursor-pointer"
          >
            <option value="ALL">All Areas ({areaFilterOptions.length})</option>
            {areaFilterOptions.map((area) => (
              <option key={area} value={area}>
                {area}
              </option>
            ))}
          </select>

          {highlightFilterResult.isFilterActive && (
            <button
              type="button"
              onClick={() => {
                setFilterOltId('ALL');
                setFilterPonPortId('ALL');
                setFilterAreaName('ALL');
                setFilterZoomTriggerTs(0);
              }}
              className="min-h-[36px] px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-xs font-mono text-slate-200 flex items-center gap-1 cursor-pointer shrink-0"
            >
              <RotateCcw className="w-3 h-3 text-cyan-400" />
              <span>Reset Filter</span>
            </button>
          )}
        </div>

        {highlightFilterResult.isFilterActive && (
          <div className="px-2.5 py-1 rounded-lg bg-cyan-950/70 border border-cyan-700/60 text-[11px] font-mono text-cyan-200 tabular-nums">
            <strong className="text-white">{highlightFilterResult.summaryLabel || 'Filtered Branch'}:</strong>{' '}
            {highlightFilterResult.cableCount} Cables &bull; {highlightFilterResult.foscCount} FOSC &bull;{' '}
            {highlightFilterResult.fatCount} FAT Boxes &bull; {highlightFilterResult.activeClientCount} Active Clients
          </div>
        )}
      </div>

      {/* Mode Instruction Strip (Placement / Pick OLT Coords / Connect Cable Route) */}
      {toolMode !== 'pan' && (
        <div className="px-4 py-2 bg-cyan-950/90 border-b border-cyan-700/70 text-cyan-100 text-xs font-mono flex flex-wrap items-center justify-between gap-2">
          {toolMode === 'pick_olt_coords' ? (
            <>
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-sky-400 shrink-0" />
                <span>
                  {pendingPlaceOltFromRegistry
                    ? `Tap the exact building/POP on the map to place OLT "${pendingPlaceOltFromRegistry.name}".`
                    : 'Tap anywhere on the map to capture GPS coordinates for your OLT.'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setToolMode('pan');
                  setPendingPlaceOltFromRegistry(null);
                  if (oltDraftForPick) {
                    setIsOltManagerOpen(true);
                  }
                }}
                className="px-2.5 py-1 rounded bg-slate-900 border border-slate-700 text-slate-200 cursor-pointer"
              >
                Cancel
              </button>
            </>
          ) : toolMode === 'connect_cable' ? (
            <div className="w-full flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Cable className="w-4 h-4 text-cyan-400 shrink-0" />
                  {!connectSourceNodeId ? (
                    <span className="font-bold text-emerald-300">
                      Step 1: Click Start Node on map OR choose A-End below
                    </span>
                  ) : !connectTargetNodeId ? (
                    <span className="font-bold text-amber-300">
                      Step 2: Click street bends ({Math.max(0, draftWaypoints.length - 1)} pts ·{' '}
                      {draftDistanceMeters}m), then click End Node (B-End) OR choose below
                    </span>
                  ) : (
                    <span className="font-bold text-cyan-300">
                      A &rarr; B Selected! Open Connection Form to mark cores &amp; save
                    </span>
                  )}
                </div>

                <div className="flex items-center flex-wrap gap-1.5">
                  <select
                    aria-label="Default Cable Core Capacity"
                    value={draftCableCores}
                    onChange={(e) =>
                      setDraftCableCores(
                        Number(e.target.value) as 1 | 2 | 4 | 6 | 8 | 12 | 24 | 48
                      )
                    }
                    className="bg-slate-950 border border-cyan-700 rounded-lg px-2 py-1 text-xs text-white"
                  >
                    {CABLE_CAPACITY_PRESETS.filter((p) => p.id !== 'DROP_2C').map((p) => (
                      <option key={p.id} value={p.cores}>
                        {p.label} ({p.cores}C)
                      </option>
                    ))}
                  </select>

                  {draftWaypoints.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setDraftWaypoints((prev) => prev.slice(0, -1))}
                      className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 flex items-center gap-1 cursor-pointer"
                    >
                      <Undo2 className="w-3 h-3" />
                      <span>Undo Pt</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setIsConnectionModalOpen(true)}
                    className="px-3 py-1 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold flex items-center gap-1 cursor-pointer shadow"
                  >
                    <Cable className="w-3 h-3" />
                    <span>Open Connection Form</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setToolMode('pan');
                      setConnectSourceNodeId(null);
                      setConnectTargetNodeId(null);
                      setDraftWaypoints([]);
                    }}
                    className="px-2.5 py-1 rounded-lg bg-rose-900/70 border border-rose-700 text-rose-100 cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </div>

              {/* Fallback Start / End Node Dropdown Pickers (handles overlapping map markers) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-cyan-800/50">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-bold text-emerald-300 shrink-0 uppercase">
                    A-Start:
                  </span>
                  <select
                    aria-label="Fallback Start Node"
                    value={connectSourceNodeId || ''}
                    onChange={(e) => {
                      const nextId = e.target.value || null;
                      setConnectSourceNodeId(nextId);
                      const matched = nextId ? nodes.find((n) => n.id === nextId) : undefined;
                      if (matched) {
                        setDraftWaypoints([{ lat: matched.lat, lng: matched.lng }]);
                      } else {
                        setDraftWaypoints([]);
                      }
                    }}
                    className="w-full bg-slate-950 border border-emerald-700/70 rounded-lg px-2 py-1 text-xs text-white"
                  >
                    <option value="">-- Select Start Node (OLT / Joint / FDB) --</option>
                    {nodes.map((n) => (
                      <option key={n.id} value={n.id}>
                        [{n.node_type}] {n.name}
                        {n.area_name ? ` (${n.area_name})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-bold text-amber-300 shrink-0 uppercase">
                    B-End:
                  </span>
                  <select
                    aria-label="Fallback End Node"
                    value={connectTargetNodeId || ''}
                    onChange={(e) => {
                      const nextId = e.target.value || null;
                      setConnectTargetNodeId(nextId);
                      if (nextId && connectSourceNodeId && nextId !== connectSourceNodeId) {
                        setIsConnectionModalOpen(true);
                      }
                    }}
                    className="w-full bg-slate-950 border border-amber-700/70 rounded-lg px-2 py-1 text-xs text-white"
                  >
                    <option value="">-- Select End Node (FDB / FAT / Joint) --</option>
                    {nodes
                      .filter((n) => n.id !== connectSourceNodeId)
                      .map((n) => (
                        <option key={n.id} value={n.id}>
                          [{n.node_type}] {n.name}
                          {n.area_name ? ` (${n.area_name})` : ''}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-cyan-400 shrink-0" />
                <span>
                  Tap anywhere on the map to place a new{' '}
                  <strong>
                    {toolMode === 'place_olt'
                      ? 'OLT Hub'
                      : toolMode === 'place_dist'
                      ? 'Distribution Node'
                      : toolMode === 'place_fosc'
                      ? 'FOSC Joint Closure'
                      : 'FDB / FAT Splitter Box'}
                  </strong>
                  .
                </span>
              </div>
              <button
                type="button"
                onClick={() => setToolMode('pan')}
                className="px-2.5 py-1 rounded bg-slate-900 border border-slate-700 text-slate-200 cursor-pointer"
              >
                Cancel
              </button>
            </>
          )}
        </div>
      )}

      {/* Toast Notification Strip */}
      {toastMsg && (
        <div
          className={`px-4 py-2 text-xs font-mono flex items-center justify-between border-b ${
            toastMsg.tone === 'err'
              ? 'bg-rose-950/90 border-rose-700 text-rose-200'
              : 'bg-emerald-950/90 border-emerald-700 text-emerald-200'
          }`}
        >
          <span className="flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            <span>{toastMsg.text}</span>
          </span>
          <button
            type="button"
            onClick={() => setToastMsg(null)}
            className="text-slate-300 hover:text-white cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main Split Map + Inspector Viewport (Explicit Height Required — CF2) */}
      <div
        className={`flex w-full relative overflow-hidden ${
          compactMobile
            ? 'h-[calc(100vh-210px)] min-h-[460px]'
            : 'h-[calc(100vh-205px)] min-h-[540px]'
        }`}
      >
        <div className="flex-1 h-full relative min-w-0">
          <FiberGisLeafletCanvas
            center={mapCenter}
            zoom={mapZoom}
            layerType={layerType}
            toolMode={toolMode}
            nodes={nodes}
            cables={cables}
            portsByNodeId={portsByNodeId}
            splitterOutputsByNodeId={splitterOutputsByNodeId}
            budgetsByNodeId={budgetsByNodeId}
            oltsById={oltsById}
            ponPortsByOltId={ponPortsByOltId}
            ponPortsById={ponPortsById}
            selectedNodeId={selectedNodeId}
            selectedCableId={selectedCableId}
            connectSourceNodeId={connectSourceNodeId}
            connectTargetNodeId={connectTargetNodeId}
            draftWaypoints={draftWaypoints}
            userLocation={userLocation}
            flyToTarget={flyToTarget}
            fitBoundsTarget={fitBoundsTarget}
            isFilterActive={highlightFilterResult.isFilterActive}
            highlightedNodeIds={highlightFilterResult.highlightedNodeIds}
            highlightedCableIds={highlightFilterResult.highlightedCableIds}
            onMapClick={handleMapClick}
            onNodeClick={handleNodeClick}
            onNodeDragEnd={handleNodeDragEnd}
            onCableClick={handleCableClick}
            onCameraChange={(c, z) => {
              setMapCenter(c);
              setMapZoom(z);
            }}
          />

          {/* Compact Bottom-Left Legend Overlay */}
          <div className="absolute bottom-3 left-3 z-10 pointer-events-none hidden sm:flex items-center gap-3 px-3 py-1.5 rounded-xl bg-slate-950/90 border border-slate-800 backdrop-blur-md text-[10px] font-mono text-slate-300 shadow-xl">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-sky-500" /> OLT
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-indigo-500" /> Dist Node
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> FDB &gt;2 Free
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-amber-500" /> FDB ≤2 Free
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-rose-600" /> FDB Full
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-purple-600" /> FOSC Joint
            </span>
          </div>
        </div>

        {/* Desktop Drawer & Mobile Slide-Up Bottom Sheet Inspector */}
        <FiberGisInspectorPanel
          selectedNode={selectedNode}
          selectedCable={selectedCable}
          cableClickPoint={cableClickPoint}
          nodes={nodes}
          cables={cables}
          portsByNodeId={portsByNodeId}
          splitterOutputsByNodeId={splitterOutputsByNodeId}
          budgetsByNodeId={budgetsByNodeId}
          olts={olts}
          oltsById={oltsById}
          ponPortsByOltId={ponPortsByOltId}
          ponPortsById={ponPortsById}
          subscribers={subscribers}
          isSaving={isSaving}
          onClose={() => {
            setSelectedNodeId(null);
            setSelectedCableId(null);
            setCableClickPoint(null);
          }}
          onSaveNode={handleSaveNode}
          onDeleteNode={handleDeleteNode}
          onSaveCable={handleSaveCable}
          onDeleteCable={handleDeleteCable}
          onSplitCable={handleSplitCable}
          onAssignPort={handleAssignPort}
          onUpsertSplitterOutput={handleUpsertSplitterOutput}
          onInitializeSplitterOutputs={handleInitializeSplitterOutputs}
          onOpenTrace={(nodeId, output) => setTraceRequest({ nodeId, output })}
          onOpenEditOlt={(oltId) => {
            setEditingOltId(oltId);
            setOltDraftForPick(null);
            setPickedCoordsForModal(null);
            setIsOltManagerOpen(true);
          }}
          onUpdatePonPort={handleUpdatePonPort}
          onOpenUpgradeModal={(node) => setUpgradeTargetNodeId(node.id)}
          onRouteCableFromNode={(node) => {
            setToolMode('connect_cable');
            setConnectSourceNodeId(node.id);
            setConnectTargetNodeId(null);
            setDraftWaypoints([{ lat: node.lat, lng: node.lng }]);
            setSelectedNodeId(null);
            setSelectedCableId(null);
            showToast(`A-Start set to "${node.name}". Click the next FDB / Joint Box on map to route outgoing cable.`);
          }}
        />
      </div>

      {/* Quick Place Node Modal */}
      {pendingPlaceCoords && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 overflow-y-auto">
          <form
            onSubmit={handleCreatePendingNode}
            className="w-[95vw] sm:w-full max-w-lg max-h-[90vh] overflow-y-auto mx-auto my-auto rounded-2xl box-border bg-slate-900 border border-slate-700 p-4 sm:p-5 shadow-2xl space-y-3.5"
          >
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                {pendingPlaceCoords.nodeType === 'OLT' ? (
                  <Server className="w-4 h-4 text-sky-400" />
                ) : pendingPlaceCoords.nodeType === 'DIST_NODE' ? (
                  <Layers className="w-4 h-4 text-indigo-400" />
                ) : pendingPlaceCoords.nodeType === 'FOSC_JOINT' ? (
                  <Wrench className="w-4 h-4 text-purple-400" />
                ) : (
                  <Radio className="w-4 h-4 text-emerald-400" />
                )}
                <span>
                  Place{' '}
                  {pendingPlaceCoords.nodeType === 'OLT'
                    ? 'OLT Hub'
                    : pendingPlaceCoords.nodeType === 'DIST_NODE'
                    ? 'Distribution Node'
                    : pendingPlaceCoords.nodeType === 'FOSC_JOINT'
                    ? 'FOSC Joint Closure'
                    : 'FDB / FAT Splitter Box'}
                </span>
              </h3>
              <button
                type="button"
                onClick={() => setPendingPlaceCoords(null)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-[11px] font-mono text-cyan-400 tabular-nums bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800">
              GPS: {pendingPlaceCoords.coords.lat.toFixed(6)},{' '}
              {pendingPlaceCoords.coords.lng.toFixed(6)}
            </div>

            <div>
              <label className="block text-[10px] font-mono text-slate-400 mb-1">
                Node Name / Tag
              </label>
              <input
                type="text"
                required
                value={newNodeName}
                onChange={(e) => setNewNodeName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-[10px] font-mono text-slate-400 mb-1">
                Area / Mohallah
              </label>
              <input
                type="text"
                list="gis-place-area-list"
                value={newNodeArea}
                onChange={(e) => setNewNodeArea(e.target.value)}
                placeholder="e.g. Lahore Road, Baza Mohallah..."
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
              />
              <datalist id="gis-place-area-list">
                {DEFAULT_NETWORK_AREAS.map((a) => (
                  <option key={a.area_name} value={a.area_name} />
                ))}
              </datalist>
            </div>

            {pendingPlaceCoords.nodeType === 'OLT' && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-mono text-slate-400 mb-1">
                      PON Mode
                    </label>
                    <select
                      value={newOltPonMode}
                      onChange={(e) => setNewOltPonMode(e.target.value as OltPonMode)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-white font-mono"
                    >
                      <option value="GPON">GPON (128/PON)</option>
                      <option value="EPON">EPON (64/PON)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-mono text-slate-400 mb-1">
                      PON Ports
                    </label>
                    <select
                      value={newOltTotalPorts}
                      onChange={(e) =>
                        setNewOltTotalPorts(Number(e.target.value) as 2 | 4 | 8 | 16)
                      }
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-white font-mono"
                    >
                      {[2, 4, 8, 16].map((cnt) => (
                        <option key={cnt} value={cnt}>
                          {cnt} PON Ports
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-mono text-slate-400 mb-1">
                      Model
                    </label>
                    <input
                      type="text"
                      value={newOltVendorModel}
                      onChange={(e) => setNewOltVendorModel(e.target.value)}
                      placeholder="VSOL V1600G1"
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-mono text-slate-400 mb-1">
                      Mgmt IP
                    </label>
                    <input
                      type="text"
                      value={newOltMgmtIp}
                      onChange={(e) => setNewOltMgmtIp(e.target.value)}
                      placeholder="192.168.100.10"
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-white font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-mono text-slate-400 mb-1">
                    Default PON SFP TX Power (dBm)
                  </label>
                  <div className="grid grid-cols-4 gap-1 mb-1.5">
                    {SFP_TX_PRESETS.map((preset) => (
                      <button
                        key={preset.sfpClass}
                        type="button"
                        onClick={() => setNewNodeTxPower(preset.txPowerDbm)}
                        className={`py-1.5 rounded border text-[10px] font-mono font-bold cursor-pointer ${
                          Math.abs(Number(newNodeTxPower) - preset.txPowerDbm) < 0.05
                            ? 'bg-sky-600 text-slate-950 border-sky-300'
                            : 'bg-slate-950 text-slate-300 border-slate-700'
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
                    value={newNodeTxPower}
                    onChange={(e) => setNewNodeTxPower(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono tabular-nums"
                  />
                </div>
              </div>
            )}

            {(pendingPlaceCoords.nodeType === 'FDB_FAT' ||
              pendingPlaceCoords.nodeType === 'DIST_NODE') && (
              <div>
                <label className="block text-[10px] font-mono text-slate-400 mb-1">
                  Splitter / Ratio Configuration
                </label>
                <select
                  value={newNodeSplitter}
                  onChange={(e) => setNewNodeSplitter(e.target.value as GisSplitterType)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
                >
                  {(Object.keys(SPLITTER_SPECS) as GisSplitterType[])
                    .filter((k) => pendingPlaceCoords.nodeType === 'DIST_NODE' || k !== 'none')
                    .map((k) => (
                      <option key={k} value={k}>
                        {SPLITTER_SPECS[k].label}
                        {SPLITTER_SPECS[k].defaultPorts > 0
                          ? ` (${SPLITTER_SPECS[k].defaultPorts} outputs)`
                          : ''}
                      </option>
                    ))}
                </select>
              </div>
            )}

            {pendingPlaceCoords.nodeType === 'FOSC_JOINT' && (
              <div>
                <label className="block text-[10px] font-mono text-slate-400 mb-1">
                  Splice Tray Capacity
                </label>
                <select
                  value={newNodeTrayCap}
                  onChange={(e) => setNewNodeTrayCap(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
                >
                  {[2, 4, 6, 8, 12, 24, 48].map((cap) => (
                    <option key={cap} value={cap}>
                      {cap}-Core Tray
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPendingPlaceCoords(null)}
                className="flex-1 min-h-[42px] rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-mono cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="flex-1 min-h-[42px] rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-mono font-bold text-xs cursor-pointer shadow-sm"
              >
                {isSaving ? 'Saving...' : 'Save Pin'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Full Multi-OLT Manager Modal */}
      <OltManagerModal
        isOpen={isOltManagerOpen}
        initialOltId={editingOltId}
        preservedDraft={oltDraftForPick}
        pickedCoords={pickedCoordsForModal}
        updatedBy={actorUsername}
        onClose={() => {
          setIsOltManagerOpen(false);
          setEditingOltId(null);
          setOltDraftForPick(null);
          setPickedCoordsForModal(null);
        }}
        onRequestPickOnMap={(draft) => {
          setOltDraftForPick(draft);
          setPendingPlaceOltFromRegistry(null);
          setIsOltManagerOpen(false);
          setToolMode('pick_olt_coords');
          showToast('Tap anywhere on the map to pick GPS coordinates for this OLT.');
        }}
        onPlaceExistingOltOnMap={(olt) => {
          setIsOltManagerOpen(false);
          const existingPin = nodes.find((n) => n.olt_id === olt.id);
          if (
            existingPin &&
            olt.lat !== null &&
            olt.lat !== undefined &&
            olt.lng !== null &&
            olt.lng !== undefined
          ) {
            setSelectedNodeId(existingPin.id);
            setFlyToTarget({ lat: olt.lat, lng: olt.lng, zoom: 17, ts: Date.now() });
            showToast(`Centered map on "${olt.name}". Drag marker anytime to adjust location.`);
          } else {
            setPendingPlaceOltFromRegistry(olt);
            setToolMode('pick_olt_coords');
            showToast(`Tap anywhere on the map to place "${olt.name}".`);
          }
        }}
        onOltsChanged={() => {
          refreshTopology(false);
        }}
      />

      {/* Dual-Picker Fiber Cable Connection & Core Marking Modal */}
      <FiberConnectionModal
        isOpen={isConnectionModalOpen}
        nodes={nodes}
        olts={olts}
        oltsById={oltsById}
        ponPortsByOltId={ponPortsByOltId}
        ponPortsById={ponPortsById}
        initialStartNodeId={connectSourceNodeId}
        initialEndNodeId={connectTargetNodeId}
        initialWaypoints={draftWaypoints}
        initialCableCores={draftCableCores}
        isSaving={isSaving}
        onClose={() => setIsConnectionModalOpen(false)}
        onSaveConnection={async (payload) => {
          await finalizeCreateCable({
            name: payload.name,
            sourceNode: payload.sourceNode,
            targetNode: payload.targetNode,
            routeCoordinates: payload.routeCoordinates,
            sourceOltId: payload.sourceOltId,
            sourcePonPortId: payload.sourcePonPortId,
            cableType: payload.cableType,
            cableCores: payload.cableCores,
            distanceMeters: payload.distanceMeters,
            cores: payload.cores,
            notes: payload.notes,
          });
        }}
      />

      {/* Persistent Supabase GIS SQL Setup Modal */}
      {isSqlModalOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 overflow-y-auto">
          <div className="w-[95vw] sm:w-full max-w-3xl max-h-[90vh] overflow-y-auto mx-auto my-auto rounded-2xl box-border bg-slate-900 border border-slate-700 p-4 sm:p-5 shadow-2xl space-y-3">
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-bold text-white">
                  Supabase FTTH GIS &amp; Fiber Core Ledger SQL Schema
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsSqlModalOpen(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
                aria-label="Close SQL modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-300">
              Copy and run this SQL in your Supabase SQL Editor to ensure{' '}
              <code className="font-mono text-cyan-300">gis_olts</code>,{' '}
              <code className="font-mono text-cyan-300">gis_nodes</code>,{' '}
              <code className="font-mono text-cyan-300">gis_cables</code>,{' '}
              <code className="font-mono text-cyan-300">fiber_nodes</code>, and{' '}
              <code className="font-mono text-cyan-300">fiber_routes</code> tables &amp; RLS policies are initialized.
            </p>

            <pre className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-[11px] font-mono text-emerald-300 overflow-x-auto max-h-[52vh]">
              {FIBER_GIS_MIGRATION_SQL}
            </pre>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(FIBER_GIS_MIGRATION_SQL);
                  setCopiedSql(true);
                  setTimeout(() => setCopiedSql(false), 3000);
                }}
                className="min-h-[40px] px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-mono font-bold text-xs flex items-center gap-1.5 cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>{copiedSql ? 'Copied GIS SQL!' : 'Copy Full GIS SQL'}</span>
              </button>
              <button
                type="button"
                onClick={() => setIsSqlModalOpen(false)}
                className="min-h-[40px] px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono text-xs cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* End-to-End Optical Traceability Path Drawer */}
      <FiberTraceabilityDrawer
        isOpen={Boolean(traceRequest && traceResult)}
        traceResult={traceResult}
        selectedOutput={traceRequest?.output || null}
        onClose={() => setTraceRequest(null)}
        onFocusNode={(nodeId) => {
          const match = nodes.find((n) => n.id === nodeId);
          setSelectedNodeId(nodeId);
          setSelectedCableId(null);
          if (match) {
            setFlyToTarget({ lat: match.lat, lng: match.lng, zoom: 18, ts: Date.now() });
          }
        }}
        onFocusCable={(cableId) => {
          setSelectedCableId(cableId);
          setSelectedNodeId(null);
        }}
      />

      {/* Zero-Loss Deployed Equipment Replacement / Upgrade Modal */}
      <FiberEquipmentUpgradeModal
        isOpen={Boolean(upgradeTargetNode)}
        node={upgradeTargetNode}
        allNodes={nodes}
        allCables={cables}
        ponPortsById={ponPortsById}
        existingPorts={upgradeTargetNode ? portsByNodeId[upgradeTargetNode.id] || [] : []}
        existingOutputs={
          upgradeTargetNode ? splitterOutputsByNodeId[upgradeTargetNode.id] || [] : []
        }
        actorUsername={actorUsername}
        isSaving={isSaving}
        onClose={() => setUpgradeTargetNodeId(null)}
        onConfirmReplace={handleReplaceNodeEquipment}
      />
    </div>
  );
};

export default FiberGisMapView;
