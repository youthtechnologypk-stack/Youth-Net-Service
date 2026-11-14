import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Cable,
  CheckCircle2,
  Copy,
  Crosshair,
  Database,
  Layers,
  MapPin,
  MousePointer,
  Plus,
  Radio,
  RefreshCw,
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
  SFP_TX_PRESETS,
  SPLITTER_SPECS,
  calculateTopologyOpticalBudgets,
  computePolylineDistanceMeters,
  inferSfpClassFromDbm,
  inferSplitterCategory,
  traceOpticalPathToNode,
} from '../lib/fiberOpticEngine';
import { FIBER_GIS_MIGRATION_SQL } from '../lib/gisMigrationSql';
import { DEFAULT_NETWORK_AREAS } from '../lib/billingAndNetwork';
import {
  FiberGisLeafletCanvas,
  GisToolMode,
  MapLayerType,
} from './gis/FiberGisLeafletCanvas';
import { FiberGisInspectorPanel } from './gis/FiberGisInspectorPanel';
import { FiberTraceabilityDrawer } from './gis/FiberTraceabilityDrawer';
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

  // Multi-waypoint cable drawing state + OLT PON Port feeder selection modal
  const [connectSourceNodeId, setConnectSourceNodeId] = useState<string | null>(null);
  const [draftWaypoints, setDraftWaypoints] = useState<GisLatLng[]>([]);
  const [draftCableCores, setDraftCableCores] = useState<2 | 4 | 6 | 8 | 12 | 24 | 48>(12);
  const [pendingCablePonSelect, setPendingCablePonSelect] = useState<{
    sourceNode: SupabaseGisNode;
    targetNode: SupabaseGisNode;
    routeCoordinates: GisLatLng[];
    olt: SupabaseGisOlt;
    oltPorts: SupabaseGisOltPonPort[];
    selectedPonPortId: string;
  } | null>(null);

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
      sourceNode: SupabaseGisNode;
      targetNode: SupabaseGisNode;
      routeCoordinates: GisLatLng[];
      sourceOltId?: string | null;
      sourcePonPortId?: string | null;
    }) => {
      setIsSaving(true);
      try {
        const ponLabel =
          params.sourcePonPortId && ponPortsById[params.sourcePonPortId]
            ? ` [PON-${ponPortsById[params.sourcePonPortId].port_number}]`
            : '';
        const created = await createGisCable({
          name: `${params.sourceNode.name}${ponLabel} → ${params.targetNode.name}`,
          sourceNodeId: params.sourceNode.id,
          targetNodeId: params.targetNode.id,
          sourceOltId: params.sourceOltId || null,
          sourcePonPortId: params.sourcePonPortId || null,
          cableCores: draftCableCores,
          routeCoordinates: params.routeCoordinates,
          updatedBy: actorUsername,
        });
        setCables((prev) => applyRealtimeCableDelta(prev, 'INSERT', created));
        setConnectSourceNodeId(null);
        setDraftWaypoints([]);
        setToolMode('pan');
        setSelectedCableId(created.id);
        setSelectedNodeId(null);
        showToast(
          `Saved ${created.cable_cores}-core span${ponLabel} (${created.distance_meters}m) to Supabase.`
        );
      } catch (err: any) {
        showToast(err?.message || 'Failed to save fiber cable route', 'err');
      } finally {
        setIsSaving(false);
      }
    },
    [ponPortsById, draftCableCores, actorUsername, showToast]
  );

  const handleNodeClick = useCallback(
    async (node: SupabaseGisNode) => {
      setIsSearchOpen(false);
      if (toolMode === 'connect_cable') {
        if (!connectSourceNodeId) {
          setConnectSourceNodeId(node.id);
          setDraftWaypoints([{ lat: node.lat, lng: node.lng }]);
          setSelectedNodeId(null);
          setSelectedCableId(null);
          return;
        }
        if (connectSourceNodeId === node.id) {
          showToast('Select a different destination node to finish the fiber route.', 'err');
          return;
        }

        const routeCoordinates = [...draftWaypoints, { lat: node.lat, lng: node.lng }];
        const sourceNode = nodes.find((n) => n.id === connectSourceNodeId);
        if (!sourceNode) return;

        // If starting from a Multi-OLT hub that has PON ports, prompt user which PON Port feeds this fiber
        if (sourceNode.node_type === 'OLT' && sourceNode.olt_id && oltsById[sourceNode.olt_id]) {
          const olt = oltsById[sourceNode.olt_id];
          const oltPorts = (ponPortsByOltId[olt.id] || [])
            .slice()
            .sort((a, b) => a.port_number - b.port_number);
          if (oltPorts.length > 0) {
            setPendingCablePonSelect({
              sourceNode,
              targetNode: node,
              routeCoordinates,
              olt,
              oltPorts,
              selectedPonPortId: oltPorts[0].id,
            });
            return;
          }
        }

        const upstreamBudget = budgetsByNodeId[sourceNode.id];
        await finalizeCreateCable({
          sourceNode,
          targetNode: node,
          routeCoordinates,
          sourceOltId: sourceNode.olt_id || upstreamBudget?.oltId || null,
          sourcePonPortId: sourceNode.pon_port_id || upstreamBudget?.sourcePonPortId || null,
        });
        return;
      }

      setSelectedNodeId(node.id);
      setSelectedCableId(null);
      setCableClickPoint(null);
    },
    [
      toolMode,
      connectSourceNodeId,
      draftWaypoints,
      nodes,
      oltsById,
      ponPortsByOltId,
      budgetsByNodeId,
      finalizeCreateCable,
      showToast,
    ]
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
        setPonPorts((prev) => applyRealtimePonPortDelta(prev, 'UPDATE', updatedPort));
        showToast(
          `Updated PON-${updatedPort.port_number} TX to +${Number(updatedPort.tx_power_dbm).toFixed(1)} dBm (${updatedPort.sfp_class}).`
        );
      } catch (err: any) {
        showToast(err?.message || 'Failed to update PON port TX power', 'err');
      } finally {
        setIsSaving(false);
      }
    },
    [showToast]
  );

  const handleSaveNode = async (nodeId: string, patch: Partial<SupabaseGisNode>) => {
    setIsSaving(true);
    try {
      const updated = await updateGisNode(nodeId, { ...patch, updated_by: actorUsername });
      setNodes((prev) => applyRealtimeNodeDelta(prev, 'UPDATE', updated));
      showToast('Node & optical parameters saved to Supabase.');
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
      setNodes((prev) => applyRealtimeNodeDelta(prev, 'DELETE', undefined, { id: nodeId }));
      setCables((prev) =>
        prev.filter((c) => c.source_node_id !== nodeId && c.target_node_id !== nodeId)
      );
      setPorts((prev) => prev.filter((p) => p.fdb_node_id !== nodeId));
      setSelectedNodeId(null);
      showToast('Node deleted from GIS topology.');
    } catch (err: any) {
      showToast(err?.message || 'Failed to delete node', 'err');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveCable = async (cableId: string, patch: Partial<SupabaseGisCable>) => {
    setIsSaving(true);
    try {
      const updated = await updateGisCable(cableId, { ...patch, updated_by: actorUsername });
      setCables((prev) => applyRealtimeCableDelta(prev, 'UPDATE', updated));
      showToast('TIA-598 core mapping committed to Supabase.');
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
      setCables((prev) => applyRealtimeCableDelta(prev, 'DELETE', undefined, { id: cableId }));
      setSelectedCableId(null);
      showToast('Fiber cable span deleted.');
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
      setNodes((prev) => applyRealtimeNodeDelta(prev, 'INSERT', res.jointNode));
      setCables((prev) => {
        let next = applyRealtimeCableDelta(prev, 'DELETE', undefined, { id: cable.id });
        next = applyRealtimeCableDelta(next, 'INSERT', res.spanA);
        next = applyRealtimeCableDelta(next, 'INSERT', res.spanB);
        return next;
      });
      setSelectedCableId(null);
      setSelectedNodeId(res.jointNode.id);
      setCableClickPoint(null);
      showToast(
        `Inserted ${res.jointNode.name} (${res.spanA.distance_meters}m + ${res.spanB.distance_meters}m) with all core colors preserved.`
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
      showToast(`Port ${params.portNumber} assignment saved to Supabase.`);
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
          <div className="flex items-center bg-slate-950 border border-slate-700 rounded-lg overflow-hidden min-h-[40px]">
            {(['satellite', 'hybrid', 'roadmap'] as MapLayerType[]).map((lt) => (
              <button
                key={lt}
                type="button"
                onClick={() => setLayerType(lt)}
                className={`px-2.5 h-full min-h-[38px] text-[11px] font-mono font-semibold capitalize cursor-pointer transition ${
                  layerType === lt
                    ? 'bg-cyan-600 text-slate-950 font-bold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {lt === 'roadmap' ? 'Street' : lt}
              </button>
            ))}
          </div>

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
            <>
              <div className="flex items-center gap-2">
                <Cable className="w-4 h-4 text-cyan-400 shrink-0" />
                {!connectSourceNodeId ? (
                  <span>Step 1: Tap the starting OLT, FOSC, or FDB node on the map.</span>
                ) : (
                  <span>
                    Step 2: Click street corners/poles to trace route ({draftWaypoints.length - 1}{' '}
                    waypoints · {draftDistanceMeters}m), then tap destination node.
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={draftCableCores}
                  onChange={(e) =>
                    setDraftCableCores(Number(e.target.value) as 2 | 4 | 6 | 8 | 12 | 24 | 48)
                  }
                  className="bg-slate-950 border border-cyan-700 rounded px-2 py-1 text-xs text-white"
                >
                  {[2, 4, 6, 8, 12, 24, 48].map((c) => (
                    <option key={c} value={c}>
                      {c} Cores
                    </option>
                  ))}
                </select>
                {draftWaypoints.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setDraftWaypoints((prev) => prev.slice(0, -1))}
                    className="px-2.5 py-1 rounded bg-slate-900 border border-slate-700 text-slate-200 flex items-center gap-1 cursor-pointer"
                  >
                    <Undo2 className="w-3 h-3" />
                    <span>Undo Pt</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setToolMode('pan');
                    setConnectSourceNodeId(null);
                    setDraftWaypoints([]);
                  }}
                  className="px-2.5 py-1 rounded bg-rose-900/70 border border-rose-700 text-rose-100 cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </>
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
            draftWaypoints={draftWaypoints}
            userLocation={userLocation}
            flyToTarget={flyToTarget}
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
        />
      </div>

      {/* Quick Place Node Modal */}
      {pendingPlaceCoords && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleCreatePendingNode}
            className="w-full max-w-sm bg-slate-900 border border-slate-700 rounded-2xl p-5 shadow-2xl space-y-3.5"
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
                className="flex-1 min-h-[42px] rounded-xl bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-mono font-bold text-xs cursor-pointer"
              >
                {isSaving ? 'Saving...' : 'Save Pin'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* PON Port Feeder Selector Modal when connecting fiber starting from an OLT */}
      {pendingCablePonSelect && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-5 shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-2 pb-2 border-b border-slate-800">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Server className="w-4 h-4 text-sky-400" />
                  <span>Select OLT Source PON Port</span>
                </h3>
                <p className="text-[11px] font-mono text-slate-400 mt-0.5">
                  {pendingCablePonSelect.olt.name} ({pendingCablePonSelect.olt.pon_mode}) →{' '}
                  {pendingCablePonSelect.targetNode.name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPendingCablePonSelect(null)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
              {pendingCablePonSelect.oltPorts.map((pp) => {
                const picked = pendingCablePonSelect.selectedPonPortId === pp.id;
                const existingFeeder = cables.find((c) => c.source_pon_port_id === pp.id);
                return (
                  <button
                    key={pp.id}
                    type="button"
                    onClick={() =>
                      setPendingCablePonSelect((prev) =>
                        prev ? { ...prev, selectedPonPortId: pp.id } : null
                      )
                    }
                    className={`w-full text-left p-3 rounded-xl border font-mono transition cursor-pointer ${
                      picked
                        ? 'bg-sky-950/90 border-sky-400 text-white'
                        : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-bold">
                        PON {pp.port_number} · {pp.port_label || `PON-${pp.port_number}`}
                      </span>
                      <span className="text-sky-300 font-bold tabular-nums">
                        +{Number(pp.tx_power_dbm).toFixed(1)} dBm ({pp.sfp_class})
                      </span>
                    </div>
                    {existingFeeder && (
                      <div className="text-[10px] text-amber-300 mt-1">
                        Already feeding: {existingFeeder.name || `${existingFeeder.cable_cores}C span`}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => setPendingCablePonSelect(null)}
                className="flex-1 min-h-[42px] rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono text-xs cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSaving}
                onClick={async () => {
                  const job = pendingCablePonSelect;
                  setPendingCablePonSelect(null);
                  await finalizeCreateCable({
                    sourceNode: job.sourceNode,
                    targetNode: job.targetNode,
                    routeCoordinates: job.routeCoordinates,
                    sourceOltId: job.olt.id,
                    sourcePonPortId: job.selectedPonPortId,
                  });
                }}
                className="flex-1 min-h-[42px] rounded-xl bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-mono font-bold text-xs cursor-pointer"
              >
                Bind PON Port &amp; Save Cable
              </button>
            </div>
          </div>
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
    </div>
  );
};

export default FiberGisMapView;
