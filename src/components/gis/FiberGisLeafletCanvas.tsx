import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type {
  GisLatLng,
  SupabaseGisCable,
  SupabaseGisFdbPort,
  SupabaseGisNode,
  SupabaseGisOlt,
  SupabaseGisOltPonPort,
  SupabaseGisSplitterOutput,
} from '../../services/supabaseClient';
import type { GisSubscriberSummary } from '../../services/fiberGisService';
import {
  AgentLiveLocationRow,
  GisAreaZoneRow,
  formatAgentLastSeen,
} from '../../services/agentGpsService';
import {
  NodeOpticalBudgetResult,
  SPLITTER_SPECS,
  computePortLiveRxDbm,
  getHealthBadgeColors,
  groupParallelCablesByPair,
  summarizeCableCores,
} from '../../lib/fiberOpticEngine';

export type GisToolMode =
  | 'pan'
  | 'place_olt'
  | 'place_dist'
  | 'place_fdb'
  | 'place_fosc'
  | 'place_area_zone'
  | 'connect_cable'
  | 'pick_olt_coords';

export type MapLayerType = 'satellite' | 'hybrid' | 'roadmap';

export interface GisNodeAlertStatus {
  hasOutage: boolean;
  hasHighPriorityTicket: boolean;
  activeOutageCount: number;
  highPriorityTicketCount: number;
  summaryText?: string;
}

interface FiberGisLeafletCanvasProps {
  center: GisLatLng;
  zoom: number;
  layerType: MapLayerType;
  toolMode: GisToolMode;
  nodes: SupabaseGisNode[];
  cables: SupabaseGisCable[];
  portsByNodeId: Record<string, SupabaseGisFdbPort[]>;
  splitterOutputsByNodeId?: Record<string, SupabaseGisSplitterOutput[]>;
  budgetsByNodeId: Record<string, NodeOpticalBudgetResult>;
  oltsById?: Record<string, SupabaseGisOlt>;
  ponPortsByOltId?: Record<string, SupabaseGisOltPonPort[]>;
  ponPortsById?: Record<string, SupabaseGisOltPonPort>;
  subscribers?: GisSubscriberSummary[];
  nodeAlertStatusByNodeId?: Record<string, GisNodeAlertStatus>;
  areaZones?: GisAreaZoneRow[];
  liveAgents?: AgentLiveLocationRow[];
  highlightedAgentId?: string | null;
  showCables?: boolean;
  showFdbNodes?: boolean;
  showCoreHubs?: boolean;
  showSubscribers?: boolean;
  showAreaLabels?: boolean;
  showAgents?: boolean;
  selectedNodeId: string | null;
  selectedCableId: string | null;
  connectSourceNodeId: string | null;
  connectTargetNodeId?: string | null;
  draftWaypoints: GisLatLng[];
  userLocation: GisLatLng | null;
  flyToTarget: { lat: number; lng: number; zoom?: number; ts: number } | null;
  fitBoundsTarget?: { bounds: [number, number][]; ts: number } | null;
  isFilterActive?: boolean;
  hideUnrelatedOnFilter?: boolean;
  highlightedNodeIds?: Record<string, boolean>;
  highlightedCableIds?: Record<string, boolean>;
  onMapClick: (coords: GisLatLng) => void;
  onNodeClick: (node: SupabaseGisNode) => void;
  onNodeDragEnd?: (node: SupabaseGisNode, coords: GisLatLng) => void;
  onCableClick: (cable: SupabaseGisCable, clickCoords?: GisLatLng) => void;
  onAreaZoneClick?: (zone: GisAreaZoneRow) => void;
  onSelectAreaByName?: (areaName: string) => void;
  onAgentClick?: (agent: AgentLiveLocationRow) => void;
  onCameraChange?: (center: GisLatLng, zoom: number) => void;
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface LabelBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function boxesOverlap(a: LabelBox, b: LabelBox, pad = 4): boolean {
  return !(
    a.x2 + pad < b.x1 ||
    a.x1 - pad > b.x2 ||
    a.y2 + pad < b.y1 ||
    a.y1 - pad > b.y2
  );
}

function getMidpointAndBearing(
  map: L.Map,
  flowPath: GisLatLng[]
): { latLng: [number, number]; angleDeg: number; pixelLen: number } | null {
  if (flowPath.length < 2) return null;
  const pts = flowPath.map((p) => map.latLngToLayerPoint([p.lat, p.lng]));
  const segLens: number[] = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1].x - pts[i].x;
    const dy = pts[i + 1].y - pts[i].y;
    const len = Math.hypot(dx, dy);
    segLens.push(len);
    total += len;
  }
  if (total < 24) return null;

  let targetDist = total * 0.5;
  for (let i = 0; i < segLens.length; i++) {
    const len = segLens[i];
    if (targetDist <= len || i === segLens.length - 1) {
      const ratio = len > 0 ? Math.min(1, Math.max(0, targetDist / len)) : 0.5;
      const a = flowPath[i];
      const b = flowPath[i + 1];
      const midLat = a.lat + (b.lat - a.lat) * ratio;
      const midLng = a.lng + (b.lng - a.lng) * ratio;
      const dx = pts[i + 1].x - pts[i].x;
      const dy = pts[i + 1].y - pts[i].y;
      const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
      return { latLng: [midLat, midLng], angleDeg, pixelLen: total };
    }
    targetDist -= len;
  }
  return null;
}

export const FiberGisLeafletCanvas: React.FC<FiberGisLeafletCanvasProps> = ({
  center,
  zoom,
  layerType,
  toolMode,
  nodes,
  cables,
  portsByNodeId,
  splitterOutputsByNodeId = {},
  budgetsByNodeId,
  oltsById = {},
  ponPortsByOltId = {},
  ponPortsById = {},
  subscribers = [],
  nodeAlertStatusByNodeId = {},
  areaZones = [],
  liveAgents = [],
  highlightedAgentId = null,
  showCables = true,
  showFdbNodes = true,
  showCoreHubs = true,
  showSubscribers = true,
  showAreaLabels = true,
  showAgents = true,
  selectedNodeId,
  selectedCableId,
  connectSourceNodeId,
  connectTargetNodeId = null,
  draftWaypoints,
  userLocation,
  flyToTarget,
  fitBoundsTarget = null,
  isFilterActive = false,
  hideUnrelatedOnFilter = false,
  highlightedNodeIds = {},
  highlightedCableIds = {},
  onMapClick,
  onNodeClick,
  onNodeDragEnd,
  onCableClick,
  onAreaZoneClick,
  onSelectAreaByName,
  onAgentClick,
  onCameraChange,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const labelsLayerRef = useRef<L.TileLayer | null>(null);
  const roadsLayerRef = useRef<L.TileLayer | null>(null);
  const featureLayerRef = useRef<L.LayerGroup | null>(null);
  const lastFlyTsRef = useRef<number>(0);
  const lastFitBoundsTsRef = useRef<number>(0);
  const [liveZoom, setLiveZoom] = useState<number>(zoom);

  const onMapClickRef = useRef(onMapClick);
  const onNodeClickRef = useRef(onNodeClick);
  const onNodeDragEndRef = useRef(onNodeDragEnd);
  const onCableClickRef = useRef(onCableClick);
  const onAreaZoneClickRef = useRef(onAreaZoneClick);
  const onSelectAreaByNameRef = useRef(onSelectAreaByName);
  const onAgentClickRef = useRef(onAgentClick);
  const onCameraChangeRef = useRef(onCameraChange);
  onMapClickRef.current = onMapClick;
  onNodeClickRef.current = onNodeClick;
  onNodeDragEndRef.current = onNodeDragEnd;
  onCableClickRef.current = onCableClick;
  onAreaZoneClickRef.current = onAreaZoneClick;
  onSelectAreaByNameRef.current = onSelectAreaByName;
  onAgentClickRef.current = onAgentClick;
  onCameraChangeRef.current = onCameraChange;

  useEffect(() => {
    setLiveZoom(zoom);
  }, [zoom]);

  // Initialize Leaflet Map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [center.lat, center.lng],
      zoom,
      zoomControl: true,
    });

    const features = L.layerGroup().addTo(map);
    featureLayerRef.current = features;
    mapRef.current = map;
    setLiveZoom(map.getZoom());

    map.on('click', (e: L.LeafletMouseEvent) => {
      onMapClickRef.current({ lat: e.latlng.lat, lng: e.latlng.lng });
    });

    map.on('moveend zoomend', () => {
      const c = map.getCenter();
      const z = map.getZoom();
      setLiveZoom(z);
      onCameraChangeRef.current?.({ lat: c.lat, lng: c.lng }, z);
    });

    return () => {
      map.remove();
      mapRef.current = null;
      featureLayerRef.current = null;
      tileLayerRef.current = null;
      labelsLayerRef.current = null;
      roadsLayerRef.current = null;
    };
  }, []);

  // Update cursor style
  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.style.cursor = toolMode === 'pan' ? 'grab' : 'crosshair';
  }, [toolMode]);

  // Switch tile layer cleanly (Esri World Imagery + Dual Esri Reference Labels/Roads + OpenStreetMap)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
      tileLayerRef.current = null;
    }
    if (labelsLayerRef.current) {
      map.removeLayer(labelsLayerRef.current);
      labelsLayerRef.current = null;
    }
    if (roadsLayerRef.current) {
      map.removeLayer(roadsLayerRef.current);
      roadsLayerRef.current = null;
    }

    const disableTilePointerEvents = (layer: L.TileLayer) => {
      const el = layer.getContainer();
      if (el) {
        el.style.pointerEvents = 'none';
      }
      layer.on('add load', () => {
        const c = layer.getContainer();
        if (c) c.style.pointerEvents = 'none';
      });
    };

    if (layerType === 'satellite' || layerType === 'hybrid') {
      tileLayerRef.current = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        {
          attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics',
          maxZoom: 19,
        }
      ).addTo(map);

      if (showAreaLabels) {
        roadsLayerRef.current = L.tileLayer(
          'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',
          {
            attribution: 'Roads &copy; Esri',
            maxZoom: 19,
            pane: 'overlayPane',
            zIndex: 450,
          }
        ).addTo(map);
        disableTilePointerEvents(roadsLayerRef.current);

        labelsLayerRef.current = L.tileLayer(
          'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
          {
            attribution: 'Labels &copy; Esri',
            maxZoom: 19,
            pane: 'overlayPane',
            zIndex: 451,
          }
        ).addTo(map);
        disableTilePointerEvents(labelsLayerRef.current);
      }
    } else {
      tileLayerRef.current = L.tileLayer(
        'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        {
          attribution: '&copy; OpenStreetMap contributors',
          maxZoom: 19,
        }
      ).addTo(map);
    }
  }, [layerType, showAreaLabels]);

  // Fly to searched/GPS coordinate
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyToTarget || flyToTarget.ts === lastFlyTsRef.current) return;
    lastFlyTsRef.current = flyToTarget.ts;
    map.setView([flyToTarget.lat, flyToTarget.lng], flyToTarget.zoom || map.getZoom(), {
      animate: true,
    });
  }, [flyToTarget]);

  // Smoothly zoom to highlighted OLT/PON/Area filter bounds
  useEffect(() => {
    const map = mapRef.current;
    if (
      !map ||
      !fitBoundsTarget ||
      fitBoundsTarget.ts === lastFitBoundsTsRef.current ||
      fitBoundsTarget.bounds.length === 0
    ) {
      return;
    }
    lastFitBoundsTsRef.current = fitBoundsTarget.ts;
    if (fitBoundsTarget.bounds.length === 1) {
      map.setView(fitBoundsTarget.bounds[0], 17, { animate: true });
    } else {
      map.fitBounds(L.latLngBounds(fitBoundsTarget.bounds), {
        padding: [52, 52],
        maxZoom: 18,
        animate: true,
      });
    }
  }, [fitBoundsTarget]);

  // Render nodes, cables, waypoints & user GPS dot
  useEffect(() => {
    const map = mapRef.current;
    const group = featureLayerRef.current;
    if (!map || !group) return;
    group.clearLayers();

    const nodesById: Record<string, SupabaseGisNode> = {};
    for (const n of nodes) {
      nodesById[n.id] = n;
    }

    // 1. Render existing cables grouped by node pair (collapses duplicate parallel cables into 1 crisp trunk line)
    if (showCables) {
      const cableGroups = groupParallelCablesByPair(cables);
      for (const cableGroup of cableGroups) {
        const selectedInGroup = cableGroup.cables.find((c) => c.id === selectedCableId);
        const highlightedInGroup = cableGroup.cables.find((c) => Boolean(highlightedCableIds[c.id]));
        const cable = selectedInGroup || highlightedInGroup || cableGroup.primaryCable;

        const isSelected = Boolean(selectedInGroup);
        const isHighlighted =
          !isFilterActive || cableGroup.cables.some((c) => Boolean(highlightedCableIds[c.id]));
        const isDimmed = isFilterActive && !isHighlighted;
        if (isDimmed && hideUnrelatedOnFilter) continue;

        const src = nodesById[cable.source_node_id];
        const dst = nodesById[cable.target_node_id];
        const path: GisLatLng[] =
          Array.isArray(cable.route_coordinates_json) && cable.route_coordinates_json.length >= 2
            ? cable.route_coordinates_json
            : src && dst
            ? [
                { lat: src.lat, lng: src.lng },
                { lat: dst.lat, lng: dst.lng },
              ]
            : [];
        if (path.length < 2) continue;

        const srcBudget = budgetsByNodeId[cable.source_node_id];
        const dstBudget = budgetsByNodeId[cable.target_node_id];

        const isReversedFlow = Boolean(
          srcBudget &&
            srcBudget.parentNodeId === cable.target_node_id &&
            dstBudget?.parentNodeId !== cable.source_node_id
        );
        const downstreamBudget = isReversedFlow ? srcBudget : dstBudget;

        const color = isSelected
          ? '#facc15'
          : downstreamBudget && downstreamBudget.healthBand !== 'UNLINKED'
          ? getHealthBadgeColors(downstreamBudget.healthBand).hex
          : '#38bdf8';

        const latLngs = path.map((p) => [p.lat, p.lng] as [number, number]);
        const baseGlowOpacity = isSelected ? 0.3 : isFilterActive && isHighlighted ? 0.34 : 0;

        const primaryCores = Number(cableGroup.primaryCable.cable_cores || 12);
        const glowPoly = L.polyline(latLngs, {
          color: isSelected ? '#fde047' : color,
          weight: primaryCores >= 12 ? 10 : 9,
          opacity: baseGlowOpacity,
          lineCap: 'round',
          lineJoin: 'round',
          interactive: false,
        }).addTo(group);

        const baseWeight = primaryCores >= 24 ? 4 : primaryCores >= 12 ? 3.5 : 3;
        const poly = L.polyline(latLngs, {
          color,
          weight: isSelected ? 4.8 : isFilterActive && isHighlighted ? 4.2 : isDimmed ? 1.8 : baseWeight,
          opacity: isDimmed ? 0.08 : isSelected || (isFilterActive && isHighlighted) ? 0.98 : 0.9,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(group);

        const feedPon = cable.source_pon_port_id ? ponPortsById[cable.source_pon_port_id] : undefined;
        const coreSum = summarizeCableCores(
          cable.cores_allocation_json?.length ? cable.cores_allocation_json : cable.cores_tia598_json,
          cable.cable_cores
        );
        const flowOrderLabel =
          isReversedFlow && dst && src
            ? `${dst.name} → ${src.name}`
            : src && dst
            ? `${src.name} → ${dst.name}`
            : `${primaryCores}C Trunk`;
        const cableLabel = (cable.name || '').trim() || flowOrderLabel;
        const totalCapDisplay =
          cableGroup.cables.length > 1 ? cableGroup.totalCores : coreSum.total;
        const totalUsedDisplay =
          cableGroup.cables.length > 1 ? cableGroup.usedCores : coreSum.litCount;
        const parallelNote =
          cableGroup.cables.length > 1
            ? ` • [${cableGroup.cables.length} Parallel Spans Collapsed]`
            : '';
        const tipText = `${feedPon ? `PON-${feedPon.port_number} · ` : ''}${cableLabel} • ${
          primaryCores
        }C Trunk • ${totalUsedDisplay}/${totalCapDisplay} Cores Used (${
          Math.max(0, totalCapDisplay - totalUsedDisplay)
        } Spare) • ${cable.distance_meters}m${parallelNote}`;
        poly.bindTooltip(tipText, { sticky: true, direction: 'top', opacity: 0.96 });

        poly.on('mouseover', () => {
          if (!isDimmed) {
            glowPoly.setStyle({ opacity: 0.36 });
          }
        });
        poly.on('mouseout', () => {
          glowPoly.setStyle({ opacity: baseGlowOpacity });
        });

        poly.on('click', (e: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(e);
          onCableClickRef.current(cable, { lat: e.latlng.lat, lng: e.latlng.lng });
        });

        // Directional arrowhead showing optical flow along span
        if (!isDimmed) {
          const flowPath = isReversedFlow ? [...path].reverse() : path;
          const arrowMeta = getMidpointAndBearing(map, flowPath);
          if (arrowMeta) {
            const arrowSvg = `<div style="transform:translate(-50%,-50%) rotate(${arrowMeta.angleDeg.toFixed(
              1
            )}deg);pointer-events:none;filter:drop-shadow(0 1px 3px rgba(2,6,23,0.9));">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M2 1.5L10.5 6L2 10.5L4.1 6L2 1.5Z" fill="${color}" stroke="#020617" stroke-width="1" stroke-linejoin="round"/>
              </svg>
            </div>`;
            const arrowIcon = L.divIcon({
              className: 'youthnet-flow-arrow',
              html: arrowSvg,
              iconSize: [0, 0],
              iconAnchor: [0, 0],
            });
            L.marker(arrowMeta.latLng, {
              icon: arrowIcon,
              interactive: false,
              zIndexOffset: -50,
            }).addTo(group);
          }
        }
      }
    }

    // 2. Render draft fiber route waypoints + optional End Node preview
    const previewPoints: GisLatLng[] = [...draftWaypoints];
    const connectSourceNode = connectSourceNodeId ? nodesById[connectSourceNodeId] : undefined;
    const connectTargetNode = connectTargetNodeId ? nodesById[connectTargetNodeId] : undefined;
    if (previewPoints.length === 0 && connectSourceNode) {
      previewPoints.push({ lat: connectSourceNode.lat, lng: connectSourceNode.lng });
    }
    if (connectTargetNode) {
      const last = previewPoints[previewPoints.length - 1];
      if (!last || last.lat !== connectTargetNode.lat || last.lng !== connectTargetNode.lng) {
        previewPoints.push({ lat: connectTargetNode.lat, lng: connectTargetNode.lng });
      }
    }

    if (previewPoints.length >= 2) {
      L.polyline(
        previewPoints.map((p) => [p.lat, p.lng] as [number, number]),
        {
          color: connectTargetNode ? '#f59e0b' : '#22d3ee',
          weight: 3.5,
          dashArray: '8 6',
          lineCap: 'round',
          interactive: false,
        }
      ).addTo(group);
    }
    for (const wp of draftWaypoints.slice(1)) {
      L.circleMarker([wp.lat, wp.lng], {
        radius: 5,
        color: '#020617',
        weight: 2,
        fillColor: '#22d3ee',
        fillOpacity: 1,
        interactive: false,
      }).addTo(group);
    }

    // 3. Render zoom-adaptive GIS nodes (< 17 compact dot + non-overlapping tooltip, >= 17 translucent pill badge)
    const isCompactZoom = liveZoom < 17;
    const placedLabelRects: LabelBox[] = [];

    const sortedRenderNodes = nodes.slice().sort((a, b) => {
      const score = (n: SupabaseGisNode) => {
        if (n.id === connectSourceNodeId || n.id === connectTargetNodeId || n.id === selectedNodeId) {
          return 0;
        }
        if (n.node_type === 'OLT') return 1;
        if (n.node_type === 'DIST_NODE') return 2;
        if (n.node_type === 'FOSC_JOINT') return 3;
        return 4;
      };
      return score(a) - score(b);
    });

    for (const node of sortedRenderNodes) {
      const isFdbNode = node.node_type === 'FDB_FAT';
      if (isFdbNode && !showFdbNodes) continue;
      if (!isFdbNode && !showCoreHubs) continue;

      const isConnectStart = node.id === connectSourceNodeId;
      const isConnectTarget = node.id === connectTargetNodeId;
      const isSelected = node.id === selectedNodeId || isConnectStart || isConnectTarget;
      const nodePorts = portsByNodeId[node.id] || [];
      const nodeOutputs = splitterOutputsByNodeId[node.id] || [];
      const budget = budgetsByNodeId[node.id];
      const summary = budget?.enclosureSummary;
      const splitterSpec = SPLITTER_SPECS[node.splitter_type] || SPLITTER_SPECS['none'];
      const hasMultiSplitters = Boolean(summary && (node.internal_splitters?.length || 0) > 0);
      const totalPorts =
        hasMultiSplitters && summary
          ? summary.boxCapacity
          : splitterSpec.type !== 'none'
          ? splitterSpec.isAsymmetricFbt
            ? 2
            : Math.max(
                Number(node.box_capacity || 0),
                Number(node.total_ports || 0),
                splitterSpec.defaultPorts
              )
          : Math.max(Number(node.box_capacity || 0), Number(node.total_ports || 0));

      let usedPortsCount = 0;
      if (hasMultiSplitters && summary) {
        usedPortsCount = summary.usedPorts;
      } else if (nodeOutputs.length > 0) {
        usedPortsCount = nodeOutputs.filter((o) => o.utilization_type !== 'FREE_PORT').length;
      } else {
        usedPortsCount = nodePorts.filter((p) => p.status !== 'FREE').length;
      }
      const freePorts = Math.max(0, totalPorts - usedPortsCount);
      const splitterCount = summary?.splitterCount ?? (splitterSpec.type !== 'none' ? 1 : 0);
      const ptJointCount = summary?.passThroughJointCount ?? 0;

      let dotColor = '#10b981';
      let accentBorderColor = 'rgba(148,163,184,0.45)';
      let compactMetricText = '';
      let pillTypeOrPortText = '';
      let pillMetricText = '';
      let pillMetricColor = '#94a3b8';
      let tooltipText = `${node.name}${node.area_name ? ` (${node.area_name})` : ''}`;

      if (node.node_type === 'OLT') {
        const linkedOlt = node.olt_id ? oltsById[node.olt_id] : undefined;
        const oltPorts = linkedOlt ? ponPortsByOltId[linkedOlt.id] || [] : [];
        const peakTx =
          oltPorts.length > 0
            ? Math.max(...oltPorts.map((p) => Number(p.tx_power_dbm ?? 5.0)))
            : Number(node.tx_power_dbm ?? 5.0);
        const modeTag = linkedOlt ? linkedOlt.pon_mode : 'OLT';
        const portBadge = linkedOlt ? ` ${linkedOlt.total_pon_ports}P` : '';
        dotColor = '#0ea5e9';
        accentBorderColor = isSelected ? '#ffffff' : 'rgba(56,189,248,0.7)';
        compactMetricText = `${peakTx >= 0 ? '+' : ''}${peakTx.toFixed(1)}dBm`;
        pillTypeOrPortText = `${modeTag}${portBadge}`;
        pillMetricText = `${peakTx >= 0 ? '+' : ''}${peakTx.toFixed(1)} dBm`;
        pillMetricColor = '#38bdf8';

        tooltipText = `${node.name} (${modeTag} · ${linkedOlt?.total_pon_ports || 1} PON · Peak ${
          peakTx >= 0 ? '+' : ''
        }${peakTx.toFixed(1)} dBm)`;
      } else if (node.node_type === 'DIST_NODE') {
        const ratioBadge =
          splitterCount > 1
            ? `${splitterCount}Spl`
            : splitterSpec.type !== 'none'
            ? splitterSpec.type
            : `${node.tray_capacity}C`;
        const distOutputDbm = splitterSpec.isAsymmetricFbt
          ? budget?.thruOutputDbm
          : splitterSpec.type !== 'none' || splitterCount > 0
          ? budget?.ontRxDbm
          : budget?.thruOutputDbm ?? budget?.inputDbm;
        const healthColor =
          budget && budget.healthBand !== 'UNLINKED'
            ? getHealthBadgeColors(budget.healthBand).hex
            : '#a5b4fc';
        dotColor = '#6366f1';
        accentBorderColor = isSelected ? '#ffffff' : healthColor;
        compactMetricText =
          distOutputDbm !== null && distOutputDbm !== undefined
            ? `${distOutputDbm.toFixed(1)}dBm`
            : ratioBadge;
        pillTypeOrPortText = totalPorts > 0 ? `${usedPortsCount}/${totalPorts}` : ratioBadge;
        pillMetricText =
          distOutputDbm !== null && distOutputDbm !== undefined
            ? `${distOutputDbm.toFixed(1)} dBm`
            : 'Unlinked';
        pillMetricColor = healthColor;

        tooltipText = `${node.name} · Dist Node (${ratioBadge})${
          totalPorts > 0 ? ` · ${usedPortsCount}/${totalPorts} Used · ${freePorts} Free` : ''
        }${ptJointCount > 0 ? ` · ${ptJointCount} Pass-Thru` : ''}${
          budget?.inputDbm !== null &&
          budget?.inputDbm !== undefined &&
          distOutputDbm !== null &&
          distOutputDbm !== undefined
            ? ` · In ${budget.inputDbm.toFixed(1)} → Out ${distOutputDbm.toFixed(1)} dBm`
            : ''
        }`;
      } else if (node.node_type === 'FOSC_JOINT') {
        const splitTag =
          splitterCount > 1
            ? ` · ${splitterCount} Splitters`
            : splitterSpec.type !== 'none'
            ? ` · ${splitterSpec.type}`
            : '';
        const foscOutDbm =
          (splitterSpec.type !== 'none' || splitterCount > 0) && !splitterSpec.isAsymmetricFbt
            ? budget?.ontRxDbm
            : budget?.thruOutputDbm ?? budget?.inputDbm;
        const healthColor =
          budget && budget.healthBand !== 'UNLINKED'
            ? getHealthBadgeColors(budget.healthBand).hex
            : '#c084fc';
        dotColor = '#a855f7';
        accentBorderColor = isSelected ? '#ffffff' : 'rgba(192,132,252,0.7)';
        compactMetricText =
          foscOutDbm !== null && foscOutDbm !== undefined
            ? `${foscOutDbm.toFixed(1)}dBm`
            : `${node.tray_capacity}C`;
        pillTypeOrPortText = `${node.tray_capacity}C`;
        pillMetricText =
          foscOutDbm !== null && foscOutDbm !== undefined
            ? `${foscOutDbm.toFixed(1)} dBm`
            : `${ptJointCount} PT`;
        pillMetricColor = healthColor;

        tooltipText = `${node.name} · FOSC Joint (${node.tray_capacity}C${splitTag})${
          ptJointCount > 0 ? ` · ${ptJointCount} Pass-Thru` : ''
        }${
          budget?.inputDbm !== null && budget?.inputDbm !== undefined
            ? ` · In ${budget.inputDbm.toFixed(1)}${
                foscOutDbm !== null && foscOutDbm !== undefined
                  ? ` → Out ${foscOutDbm.toFixed(1)}`
                  : ''
              } dBm`
            : ''
        }`;
      } else {
        const healthHex =
          budget && budget.healthBand !== 'UNLINKED'
            ? getHealthBadgeColors(budget.healthBand).hex
            : totalPorts > 0 && freePorts === 0
            ? '#f43f5e'
            : freePorts <= 2
            ? '#f59e0b'
            : '#10b981';
        dotColor =
          totalPorts > 0 && freePorts === 0
            ? '#e11d48'
            : budget?.healthBand === 'CRITICAL LOS RISK'
            ? '#f43f5e'
            : freePorts <= 2
            ? '#f59e0b'
            : '#10b981';
        accentBorderColor = isSelected
          ? '#ffffff'
          : budget?.healthBand === 'CRITICAL LOS RISK'
          ? 'rgba(244,63,94,0.85)'
          : 'rgba(148,163,184,0.45)';
        compactMetricText =
          budget?.ontRxDbm !== null && budget?.ontRxDbm !== undefined
            ? `${budget.ontRxDbm.toFixed(1)}dBm`
            : `${usedPortsCount}/${totalPorts}`;
        pillTypeOrPortText = `${usedPortsCount}/${totalPorts}`;
        pillMetricText =
          budget?.ontRxDbm !== null && budget?.ontRxDbm !== undefined
            ? `${budget.ontRxDbm.toFixed(1)} dBm`
            : 'Unlinked';
        pillMetricColor = healthHex;

        tooltipText = `${node.name} · ${
          splitterCount > 1 ? `${splitterCount} Internal Splitters` : node.splitter_type
        } · ${usedPortsCount}/${totalPorts} Used (${freePorts} Free)${
          ptJointCount > 0 ? ` · ${ptJointCount} Pass-Thru` : ''
        }${
          budget?.inputDbm !== null && budget?.inputDbm !== undefined
            ? ` · In ${budget.inputDbm.toFixed(1)} dBm`
            : ''
        }${
          budget?.ontRxDbm !== null && budget?.ontRxDbm !== undefined
            ? ` → Out ${budget.ontRxDbm.toFixed(1)} dBm`
            : ''
        }`;
      }

      const isHighlightedNode = !isFilterActive || Boolean(highlightedNodeIds[node.id]);
      const isDimmedNode = isFilterActive && !isHighlightedNode;
      if (isDimmedNode && hideUnrelatedOnFilter) continue;
      const nodeOpacity = isDimmedNode ? 0.08 : 1;

      const alertStatus = isFdbNode ? nodeAlertStatusByNodeId[node.id] : undefined;
      const hasActiveAlert = Boolean(
        alertStatus && (alertStatus.hasOutage || alertStatus.hasHighPriorityTicket) && !isDimmedNode
      );
      const alertRingClass = alertStatus?.hasOutage
        ? 'youthnet-fdb-pulse-outage'
        : 'youthnet-fdb-pulse-ticket';
      const alertPillClass = alertStatus?.hasOutage
        ? 'youthnet-fdb-pill-pulse-outage'
        : 'youthnet-fdb-pill-pulse-ticket';

      if (hasActiveAlert && alertStatus) {
        const alertParts: string[] = [];
        if (alertStatus.hasOutage) {
          alertParts.push(
            `${alertStatus.activeOutageCount} Active Outage${alertStatus.activeOutageCount > 1 ? 's' : ''}`
          );
        }
        if (alertStatus.hasHighPriorityTicket) {
          alertParts.push(
            `${alertStatus.highPriorityTicketCount} High-Priority Ticket${
              alertStatus.highPriorityTicketCount > 1 ? 's' : ''
            }`
          );
        }
        tooltipText = `${tooltipText} • ALERT: ${alertParts.join(' & ')}`;
      }

      const startEndTag = isConnectStart
        ? `<div style="position:absolute;top:-18px;left:0;transform:translate(-50%,-100%);background:#10b981;color:#022c22;font-family:monospace;font-size:9px;font-weight:800;padding:1px 5px;border-radius:4px;white-space:nowrap;box-shadow:0 2px 8px rgba(16,185,129,0.75);pointer-events:none;">A-START</div>`
        : isConnectTarget
        ? `<div style="position:absolute;top:-18px;left:0;transform:translate(-50%,-100%);background:#f59e0b;color:#0f172a;font-family:monospace;font-size:9px;font-weight:800;padding:1px 5px;border-radius:4px;white-space:nowrap;box-shadow:0 2px 8px rgba(245,158,11,0.75);pointer-events:none;">B-END</div>`
        : '';

      const connectGlow = isConnectStart
        ? 'filter:drop-shadow(0 0 8px rgba(16,185,129,0.95));'
        : isConnectTarget
        ? 'filter:drop-shadow(0 0 8px rgba(245,158,11,0.95));'
        : isFilterActive && isHighlightedNode
        ? 'filter:drop-shadow(0 0 5px rgba(56,189,248,0.65));'
        : '';

      const safeNodeName = escapeHtml(node.name);
      const cursorCss = toolMode === 'pan' ? 'grab' : 'pointer';

      const pulseHaloHtml = hasActiveAlert
        ? `<div class="youthnet-fdb-pulse-ring ${alertRingClass}"></div>`
        : '';

      const alertBadgeHtml =
        hasActiveAlert && alertStatus
          ? `<span style="margin-left:2px;padding:0 4px;border-radius:9999px;font-size:9px;font-weight:800;letter-spacing:0.02em;background:${
              alertStatus.hasOutage ? 'rgba(244,63,94,0.22)' : 'rgba(245,158,11,0.22)'
            };color:${alertStatus.hasOutage ? '#fda4af' : '#fcd34d'};border:1px solid ${
              alertStatus.hasOutage ? 'rgba(251,113,133,0.55)' : 'rgba(251,191,36,0.55)'
            };">${
              alertStatus.hasOutage
                ? 'OUTAGE'
                : `${alertStatus.highPriorityTicketCount} TKT`
            }</span>`
          : '';

      let html = '';
      if (isCompactZoom) {
        const dotSize = node.node_type === 'OLT' || isSelected ? 14 : 12;
        html = `${pulseHaloHtml}<div style="position:relative;width:${dotSize}px;height:${dotSize}px;border-radius:9999px;background:${dotColor};border:2px solid ${
          isSelected ? '#ffffff' : hasActiveAlert ? (alertStatus?.hasOutage ? '#fda4af' : '#fcd34d') : '#020617'
        };box-shadow:0 0 0 1.5px rgba(255,255,255,0.65),0 2px 8px rgba(0,0,0,0.65);transform:translate(-50%,-50%);cursor:${cursorCss};"></div>`;
      } else {
        html = `<div class="${
          hasActiveAlert ? alertPillClass : ''
        }" style="display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:9999px;border:1px solid ${accentBorderColor};background:rgba(2,6,23,0.9);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);color:#f8fafc;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;font-weight:600;white-space:nowrap;box-shadow:0 4px 14px rgba(0,0,0,0.5);transform:translate(-50%,-50%);cursor:${cursorCss};">
          <span style="width:7px;height:7px;border-radius:9999px;background:${dotColor};flex-shrink:0;"></span>
          <span style="font-weight:700;color:#ffffff;max-width:118px;overflow:hidden;text-overflow:ellipsis;">${safeNodeName}</span>
          <span style="color:#475569;">|</span>
          <span style="color:#cbd5e1;font-variant-numeric:tabular-nums;">${escapeHtml(pillTypeOrPortText)}</span>
          <span style="color:#475569;">|</span>
          <span style="color:${pillMetricColor};font-weight:700;font-variant-numeric:tabular-nums;">${escapeHtml(
            pillMetricText
          )}</span>${alertBadgeHtml}
        </div>`;
      }

      const wrappedHtml = `<div style="position:relative;opacity:${nodeOpacity};pointer-events:auto;${connectGlow}">${startEndTag}${html}</div>`;

      const icon = L.divIcon({
        className: 'youthnet-gis-marker',
        html: wrappedHtml,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });

      const canDragNode = toolMode === 'pan' && Boolean(onNodeDragEndRef.current);
      const zIndexOffset =
        isConnectStart || isConnectTarget
          ? 1200
          : toolMode === 'connect_cable'
          ? 1000
          : isSelected
          ? 700
          : isFilterActive && isHighlightedNode
          ? 500
          : node.node_type === 'OLT'
          ? 250
          : 0;

      const marker = L.marker([node.lat, node.lng], {
        icon,
        draggable: canDragNode,
        zIndexOffset,
        bubblingMouseEvents: false,
      }).addTo(group);

      if (isCompactZoom && !isDimmedNode) {
        const compactLabel = compactMetricText
          ? `${node.name} • ${compactMetricText}`
          : node.name;
        const pt = map.latLngToContainerPoint([node.lat, node.lng]);
        const estWidth = Math.min(180, Math.max(72, compactLabel.length * 6.3 + 16));
        const estHeight = 20;

        const candidates: Array<{
          dir: L.Direction;
          offset: [number, number];
          box: LabelBox;
        }> = [
          {
            dir: 'right',
            offset: [10, 0],
            box: { x1: pt.x + 10, y1: pt.y - estHeight / 2, x2: pt.x + 10 + estWidth, y2: pt.y + estHeight / 2 },
          },
          {
            dir: 'left',
            offset: [-10, 0],
            box: { x1: pt.x - 10 - estWidth, y1: pt.y - estHeight / 2, x2: pt.x - 10, y2: pt.y + estHeight / 2 },
          },
          {
            dir: 'top',
            offset: [0, -10],
            box: { x1: pt.x - estWidth / 2, y1: pt.y - 10 - estHeight, x2: pt.x + estWidth / 2, y2: pt.y - 10 },
          },
          {
            dir: 'bottom',
            offset: [0, 10],
            box: { x1: pt.x - estWidth / 2, y1: pt.y + 10, x2: pt.x + estWidth / 2, y2: pt.y + 10 + estHeight },
          },
        ];

        const chosen = candidates.find(
          (cand) => !placedLabelRects.some((existing) => boxesOverlap(existing, cand.box, 4))
        );

        if (chosen || isSelected || node.node_type === 'OLT') {
          const picked = chosen || candidates[0];
          placedLabelRects.push(picked.box);
          marker.bindTooltip(compactLabel, {
            permanent: true,
            direction: picked.dir,
            offset: picked.offset,
            className: 'youthnet-compact-label',
            opacity: 0.96,
          });
        } else {
          marker.bindTooltip(tooltipText, {
            direction: 'top',
            offset: [0, -10],
            opacity: 0.95,
          });
        }
      } else {
        marker.bindTooltip(tooltipText, {
          direction: 'top',
          offset: [0, -16],
          opacity: 0.96,
        });
      }

      if (toolMode === 'connect_cable') {
        marker.on('mousedown', (e: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(e);
        });
      }

      marker.on('click', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e);
        onNodeClickRef.current(node);
      });

      if (canDragNode) {
        marker.on('dragend', () => {
          const pos = marker.getLatLng();
          onNodeDragEndRef.current?.(node, { lat: pos.lat, lng: pos.lng });
        });
      }
    }

    // 4. Render Subscriber Drop Markers around assigned FDB / FAT / Dist Boxes
    if (showSubscribers) {
      const subsById: Record<string, GisSubscriberSummary> = {};
      const subsByUsername: Record<string, GisSubscriberSummary> = {};
      for (const s of subscribers) {
        subsById[s.id] = s;
        if (s.username) subsByUsername[s.username.toLowerCase()] = s;
      }

      for (const node of nodes) {
        const nodePorts = portsByNodeId[node.id] || [];
        const nodeOutputs = splitterOutputsByNodeId[node.id] || [];
        const nodeBudget = budgetsByNodeId[node.id];
        const isHighlightedNode = !isFilterActive || Boolean(highlightedNodeIds[node.id]);
        const isDimmedSub = isFilterActive && !isHighlightedNode;
        if (isDimmedSub && hideUnrelatedOnFilter) continue;

        interface ResolvedSubDrop {
          key: string;
          label: string;
          sub: GisSubscriberSummary | null;
          dropMeters: number;
          estDbm: number | null;
          portInfo: string;
        }

        const dropsMap = new Map<string, ResolvedSubDrop>();

        // 1) Multi-splitter internal legs first
        if (Array.isArray(node.internal_splitters) && node.internal_splitters.length > 0) {
          for (const sp of node.internal_splitters) {
            for (const leg of sp.legs || []) {
              if (leg.status !== 'SUBSCRIBER_DROP') continue;
              const sub =
                (leg.subscriber_id && subsById[leg.subscriber_id]) ||
                (leg.subscriber_username &&
                  subsByUsername[leg.subscriber_username.toLowerCase()]) ||
                null;
              const label = sub
                ? `@${sub.username}`
                : leg.client_label || leg.subscriber_username || `${sp.label} #${leg.legNumber}`;
              const key = sub?.id || `${sp.id}-${leg.legNumber}`;
              const dropMeters = Number(leg.drop_distance_m ?? 30);
              dropsMap.set(key, {
                key,
                label,
                sub,
                dropMeters,
                estDbm: computePortLiveRxDbm(
                  leg.calculated_output_dbm ?? nodeBudget?.ontRxDbm ?? null,
                  dropMeters
                ),
                portInfo: `${sp.label} ${leg.legLabel}`,
              });
            }
          }
        }

        // 2) Legacy / normalized splitter_outputs
        for (const out of nodeOutputs) {
          if (out.utilization_type !== 'CLIENT_ONT') continue;
          const sub =
            (out.subscriber_id && subsById[out.subscriber_id]) ||
            (out.subscriber_username &&
              subsByUsername[out.subscriber_username.toLowerCase()]) ||
            null;
          const label = sub
            ? `@${sub.username}`
            : out.client_name_manual || out.subscriber_username || `Port #${out.port_number}`;
          const key = sub?.id || `out-${out.port_number}`;
          if (!dropsMap.has(key)) {
            const dropMeters = Number(out.drop_distance_m ?? 30);
            const activeNodeOut =
              nodeBudget?.ontRxDbm ??
              (nodeBudget?.healthBand !== 'UNLINKED'
                ? node.calculated_ont_rx_dbm ?? node.calculated_output_dbm ?? null
                : null);
            dropsMap.set(key, {
              key,
              label,
              sub,
              dropMeters,
              estDbm: computePortLiveRxDbm(activeNodeOut, dropMeters),
              portInfo: out.leg_label || `Port ${out.port_number}`,
            });
          }
        }

        // 3) Legacy gis_fdb_ports fallback
        for (const fp of nodePorts) {
          if (fp.status !== 'ACTIVE') continue;
          const sub =
            (fp.subscriber_id && subsById[fp.subscriber_id]) ||
            (fp.subscriber_username &&
              subsByUsername[fp.subscriber_username.toLowerCase()]) ||
            null;
          const label = sub
            ? `@${sub.username}`
            : fp.client_label || fp.subscriber_username || `Port #${fp.port_number}`;
          const key = sub?.id || `port-${fp.port_number}`;
          if (!dropsMap.has(key)) {
            const dropMeters = Number(fp.drop_cable_meters ?? 30);
            const activeNodeOut =
              nodeBudget?.ontRxDbm ??
              (nodeBudget?.healthBand !== 'UNLINKED'
                ? node.calculated_ont_rx_dbm ?? node.calculated_output_dbm ?? null
                : null);
            dropsMap.set(key, {
              key,
              label,
              sub,
              dropMeters,
              estDbm: computePortLiveRxDbm(activeNodeOut, dropMeters),
              portInfo: `Port ${fp.port_number}`,
            });
          }
        }

        const subDrops = Array.from(dropsMap.values());
        if (subDrops.length === 0) continue;

        const cosLat = Math.max(0.25, Math.cos((node.lat * Math.PI) / 180));
        subDrops.forEach((drop, idx) => {
          const visualMeters = Math.min(68, Math.max(24, Number(drop.dropMeters || 30) * 0.65));
          const latRadius = visualMeters / 111320;
          const lngRadius = visualMeters / (111320 * cosLat);
          const angle = (idx * 2 * Math.PI) / Math.max(1, subDrops.length) - Math.PI / 4;
          const subLat = node.lat + latRadius * Math.sin(angle);
          const subLng = node.lng + lngRadius * Math.cos(angle);

          const pinColor = drop.sub
            ? drop.sub.isOnline
              ? '#22c55e'
              : '#f43f5e'
            : '#06b6d4';

          if (!isDimmedSub && liveZoom >= 15) {
            L.polyline(
              [
                [node.lat, node.lng],
                [subLat, subLng],
              ],
              {
                color: pinColor,
                weight: 1.5,
                dashArray: '3 4',
                opacity: 0.65,
                interactive: false,
              }
            ).addTo(group);
          }

          const showMiniTag = liveZoom >= 18 && !isDimmedSub;
          const subHtml = showMiniTag
            ? `<div style="display:inline-flex;align-items:center;gap:4px;padding:1.5px 6px;border-radius:9999px;background:rgba(2,6,23,0.88);border:1px solid ${pinColor};color:#f8fafc;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:9px;font-weight:700;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,0.55);transform:translate(-50%,-50%);opacity:${
                isDimmedSub ? 0.08 : 1
              };cursor:pointer;">
                <span style="width:6px;height:6px;border-radius:9999px;background:${pinColor};flex-shrink:0;"></span>
                <span style="max-width:85px;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(
                  drop.label
                )}</span>
              </div>`
            : `<div style="width:9px;height:9px;border-radius:9999px;background:${pinColor};border:1.5px solid #ffffff;box-shadow:0 1px 4px rgba(0,0,0,0.7);transform:translate(-50%,-50%);opacity:${
                isDimmedSub ? 0.08 : 1
              };cursor:pointer;"></div>`;

          const subIcon = L.divIcon({
            className: 'youthnet-sub-marker',
            html: subHtml,
            iconSize: [0, 0],
            iconAnchor: [0, 0],
          });

          const subMarker = L.marker([subLat, subLng], {
            icon: subIcon,
            zIndexOffset: isDimmedSub ? -20 : 120,
            bubblingMouseEvents: false,
          }).addTo(group);

          const statusText = drop.sub
            ? drop.sub.isOnline
              ? 'ONLINE'
              : 'OFFLINE'
            : 'CLIENT DROP';
          const tipLines = [
            `${drop.sub ? `${drop.sub.fullName} (@${drop.sub.username})` : drop.label} · ${statusText}`,
            `${drop.portInfo} on ${node.name} · Drop ${drop.dropMeters}m`,
            ...(drop.sub?.packageSpeed ? [`Plan: ${drop.sub.packageSpeed}`] : []),
            ...(drop.estDbm !== null ? [`Est. Signal: ${drop.estDbm.toFixed(1)} dBm`] : []),
          ];
          subMarker.bindTooltip(tipLines.join(' | '), {
            direction: 'top',
            offset: [0, -8],
            opacity: 0.96,
          });
          subMarker.on('click', (e: L.LeafletMouseEvent) => {
            L.DomEvent.stopPropagation(e);
            onNodeClickRef.current(node);
          });
        });
      }
    }

    // 4b. Custom & Auto Area / Sector Zone Labels
    if (showAreaLabels) {
      const customNameSet: Record<string, boolean> = {};
      for (const zone of areaZones) {
        if (!zone.name) continue;
        customNameSet[zone.name.trim().toLowerCase()] = true;
        const zoneColor = zone.color || '#22d3ee';
        const zoneIcon = L.divIcon({
          className: 'youthnet-area-zone-label',
          html: `<div style="display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:6px;background:rgba(2,6,23,0.68);border:1px solid ${zoneColor};color:#f8fafc;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;white-space:nowrap;text-shadow:0 1px 3px rgba(0,0,0,0.9);box-shadow:0 2px 8px rgba(0,0,0,0.45);transform:translate(-50%,-50%);cursor:pointer;">
            <span style="width:5px;height:5px;border-radius:9999px;background:${zoneColor};flex-shrink:0;"></span>
            <span>${escapeHtml(zone.name)}</span>
          </div>`,
          iconSize: [0, 0],
          iconAnchor: [0, 0],
        });
        const zm = L.marker([zone.lat, zone.lng], {
          icon: zoneIcon,
          zIndexOffset: -200,
          bubblingMouseEvents: false,
        }).addTo(group);
        zm.bindTooltip(`Area Zone: ${zone.name} (Click to isolate area)`, {
          direction: 'top',
          offset: [0, -10],
          opacity: 0.92,
        });
        zm.on('click', (e: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(e);
          if (onSelectAreaByNameRef.current) {
            onSelectAreaByNameRef.current(zone.name);
          } else {
            onAreaZoneClickRef.current?.(zone);
          }
        });
      }

      // Auto-derived neighborhood/area centroids from nodes with area_name when no manual label exists
      const areaBuckets: Record<string, { label: string; lats: number[]; lngs: number[] }> = {};
      for (const n of nodes) {
        const cleanArea = (n.area_name || '').trim();
        if (!cleanArea) continue;
        const key = cleanArea.toLowerCase();
        if (customNameSet[key]) continue;
        if (!areaBuckets[key]) {
          areaBuckets[key] = { label: cleanArea, lats: [], lngs: [] };
        }
        areaBuckets[key].lats.push(n.lat);
        areaBuckets[key].lngs.push(n.lng);
      }
      for (const bucket of Object.values(areaBuckets)) {
        const avgLat = bucket.lats.reduce((a, b) => a + b, 0) / bucket.lats.length;
        const avgLng = bucket.lngs.reduce((a, b) => a + b, 0) / bucket.lngs.length;
        const autoIcon = L.divIcon({
          className: 'youthnet-area-auto-label',
          html: `<div style="padding:2px 8px;border-radius:6px;background:rgba(15,23,42,0.72);border:1px solid rgba(56,189,248,0.45);color:rgba(226,232,240,0.95);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;white-space:nowrap;text-shadow:0 1px 4px rgba(0,0,0,0.95);transform:translate(-50%,-160%);cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,0.45);">${escapeHtml(
            bucket.label
          )}</div>`,
          iconSize: [0, 0],
          iconAnchor: [0, 0],
        });
        const amAuto = L.marker([avgLat, avgLng], {
          icon: autoIcon,
          interactive: true,
          zIndexOffset: -220,
          bubblingMouseEvents: false,
        }).addTo(group);
        amAuto.bindTooltip(`Area: ${bucket.label} (Click to isolate area)`, {
          direction: 'top',
          offset: [0, -10],
          opacity: 0.92,
        });
        amAuto.on('click', (e: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(e);
          onSelectAreaByNameRef.current?.(bucket.label);
        });
      }
    }

    // 5. Live GPS user dot (NOC / browser local GPS)
    if (userLocation) {
      const gpsIcon = L.divIcon({
        className: 'youthnet-gps-marker',
        html: `<div style="position:relative;width:14px;height:14px;transform:translate(-50%,-50%);">
          <div style="position:absolute;inset:-5px;border-radius:9999px;background:rgba(56,189,248,0.32);"></div>
          <div style="position:relative;width:14px;height:14px;border-radius:9999px;background:#0ea5e9;border:2px solid #ffffff;box-shadow:0 0 8px rgba(14,165,233,0.9);"></div>
        </div>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });
      L.marker([userLocation.lat, userLocation.lng], { icon: gpsIcon }).addTo(group);
    }

    // 5b. Live Moving Field Agent GPS Markers
    if (showAgents && liveAgents.length > 0) {
      for (const agent of liveAgents) {
        if (!agent.is_online) continue;
        const isNearest = highlightedAgentId === agent.agent_id;
        const seenText = formatAgentLastSeen(agent.updated_at);
        const ageSec = Math.max(
          0,
          Math.floor((Date.now() - new Date(agent.updated_at).getTime()) / 1000)
        );
        const isFresh = ageSec <= 180;
        const badgeAccent = isNearest
          ? '#f59e0b'
          : isFresh
          ? '#10b981'
          : '#38bdf8';

        if (agent.accuracy_meters && agent.accuracy_meters > 5 && agent.accuracy_meters <= 180) {
          L.circle([agent.lat, agent.lng], {
            radius: agent.accuracy_meters,
            color: badgeAccent,
            weight: 1,
            opacity: 0.35,
            fillColor: badgeAccent,
            fillOpacity: 0.08,
            interactive: false,
          }).addTo(group);
        }

        const agentHtml = `<div style="position:relative;pointer-events:auto;">
          <div class="youthnet-agent-pulse-ring"></div>
          ${
            isNearest
              ? `<div style="position:absolute;top:-20px;left:0;transform:translate(-50%,-100%);background:#f59e0b;color:#0f172a;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:9px;font-weight:800;padding:1px 6px;border-radius:9999px;white-space:nowrap;box-shadow:0 2px 8px rgba(245,158,11,0.7);">NEAREST AGENT</div>`
              : ''
          }
          <div style="position:relative;display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:9999px;background:rgba(2,6,23,0.92);border:1.5px solid ${badgeAccent};color:#f8fafc;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;font-weight:700;white-space:nowrap;box-shadow:0 4px 14px rgba(0,0,0,0.6);transform:translate(-50%,-50%);cursor:pointer;">
            <span>🛵</span>
            <span style="color:#ffffff;">${escapeHtml(agent.agent_name)}</span>
            <span style="color:#475569;">•</span>
            <span style="color:${badgeAccent};font-size:10px;">${escapeHtml(seenText)}</span>
          </div>
        </div>`;

        const agentIcon = L.divIcon({
          className: 'youthnet-live-agent-marker',
          html: agentHtml,
          iconSize: [0, 0],
          iconAnchor: [0, 0],
        });

        const am = L.marker([agent.lat, agent.lng], {
          icon: agentIcon,
          zIndexOffset: isNearest ? 1300 : 850,
          bubblingMouseEvents: false,
        }).addTo(group);

        am.bindTooltip(
          `Field Agent: ${agent.agent_name} • ${seenText}${
            agent.accuracy_meters ? ` • Accuracy ±${Math.round(agent.accuracy_meters)}m` : ''
          }`,
          { direction: 'top', offset: [0, -14], opacity: 0.96 }
        );
        am.on('click', (e: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(e);
          onAgentClickRef.current?.(agent);
        });
      }
    }
  }, [
    liveZoom,
    nodes,
    cables,
    portsByNodeId,
    splitterOutputsByNodeId,
    budgetsByNodeId,
    oltsById,
    ponPortsByOltId,
    ponPortsById,
    subscribers,
    nodeAlertStatusByNodeId,
    areaZones,
    liveAgents,
    highlightedAgentId,
    showCables,
    showFdbNodes,
    showCoreHubs,
    showSubscribers,
    showAreaLabels,
    showAgents,
    toolMode,
    selectedNodeId,
    selectedCableId,
    connectSourceNodeId,
    connectTargetNodeId,
    draftWaypoints,
    userLocation,
    isFilterActive,
    hideUnrelatedOnFilter,
    highlightedNodeIds,
    highlightedCableIds,
  ]);

  return <div ref={containerRef} className="w-full h-full z-0" />;
};
