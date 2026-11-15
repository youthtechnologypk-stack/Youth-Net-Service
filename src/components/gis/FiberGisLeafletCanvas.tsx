import React, { useEffect, useRef } from 'react';
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
import {
  NodeOpticalBudgetResult,
  SPLITTER_SPECS,
  getHealthBadgeColors,
  summarizeCableCores,
} from '../../lib/fiberOpticEngine';

export type GisToolMode =
  | 'pan'
  | 'place_olt'
  | 'place_dist'
  | 'place_fdb'
  | 'place_fosc'
  | 'connect_cable'
  | 'pick_olt_coords';

export type MapLayerType = 'satellite' | 'hybrid' | 'roadmap';

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
  selectedNodeId: string | null;
  selectedCableId: string | null;
  connectSourceNodeId: string | null;
  connectTargetNodeId?: string | null;
  draftWaypoints: GisLatLng[];
  userLocation: GisLatLng | null;
  flyToTarget: { lat: number; lng: number; zoom?: number; ts: number } | null;
  fitBoundsTarget?: { bounds: [number, number][]; ts: number } | null;
  isFilterActive?: boolean;
  highlightedNodeIds?: Record<string, boolean>;
  highlightedCableIds?: Record<string, boolean>;
  onMapClick: (coords: GisLatLng) => void;
  onNodeClick: (node: SupabaseGisNode) => void;
  onNodeDragEnd?: (node: SupabaseGisNode, coords: GisLatLng) => void;
  onCableClick: (cable: SupabaseGisCable, clickCoords?: GisLatLng) => void;
  onCameraChange?: (center: GisLatLng, zoom: number) => void;
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
  selectedNodeId,
  selectedCableId,
  connectSourceNodeId,
  connectTargetNodeId = null,
  draftWaypoints,
  userLocation,
  flyToTarget,
  fitBoundsTarget = null,
  isFilterActive = false,
  highlightedNodeIds = {},
  highlightedCableIds = {},
  onMapClick,
  onNodeClick,
  onNodeDragEnd,
  onCableClick,
  onCameraChange,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const labelsLayerRef = useRef<L.TileLayer | null>(null);
  const featureLayerRef = useRef<L.LayerGroup | null>(null);
  const lastFlyTsRef = useRef<number>(0);
  const lastFitBoundsTsRef = useRef<number>(0);

  const onMapClickRef = useRef(onMapClick);
  const onNodeClickRef = useRef(onNodeClick);
  const onNodeDragEndRef = useRef(onNodeDragEnd);
  const onCableClickRef = useRef(onCableClick);
  const onCameraChangeRef = useRef(onCameraChange);
  onMapClickRef.current = onMapClick;
  onNodeClickRef.current = onNodeClick;
  onNodeDragEndRef.current = onNodeDragEnd;
  onCableClickRef.current = onCableClick;
  onCameraChangeRef.current = onCameraChange;

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

    map.on('click', (e: L.LeafletMouseEvent) => {
      onMapClickRef.current({ lat: e.latlng.lat, lng: e.latlng.lng });
    });

    map.on('moveend zoomend', () => {
      const c = map.getCenter();
      onCameraChangeRef.current?.({ lat: c.lat, lng: c.lng }, map.getZoom());
    });

    return () => {
      map.remove();
      mapRef.current = null;
      featureLayerRef.current = null;
      tileLayerRef.current = null;
      labelsLayerRef.current = null;
    };
  }, []);

  // Update cursor style
  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.style.cursor = toolMode === 'pan' ? 'grab' : 'crosshair';
  }, [toolMode]);

  // Switch tile layer cleanly (100% Free OpenStreetMap + Esri World Imagery)
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

    if (layerType === 'satellite' || layerType === 'hybrid') {
      tileLayerRef.current = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        {
          attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics',
          maxZoom: 19,
        }
      ).addTo(map);

      if (layerType === 'hybrid') {
        labelsLayerRef.current = L.tileLayer(
          'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
          {
            attribution: 'Labels &copy; Esri',
            maxZoom: 19,
            pane: 'overlayPane',
          }
        ).addTo(map);
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
  }, [layerType]);

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
    const group = featureLayerRef.current;
    if (!group) return;
    group.clearLayers();

    const nodesById: Record<string, SupabaseGisNode> = {};
    for (const n of nodes) {
      nodesById[n.id] = n;
    }

    // 1. Render existing cables
    for (const cable of cables) {
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

      const isSelected = cable.id === selectedCableId;
      const isHighlighted = !isFilterActive || Boolean(highlightedCableIds[cable.id]);
      const isDimmed = isFilterActive && !isHighlighted;
      const dstBudget = budgetsByNodeId[cable.target_node_id];
      const color = isSelected
        ? '#facc15'
        : dstBudget && dstBudget.healthBand !== 'UNLINKED'
        ? getHealthBadgeColors(dstBudget.healthBand).hex
        : '#38bdf8';

      const latLngs = path.map((p) => [p.lat, p.lng] as [number, number]);

      if (isFilterActive && isHighlighted) {
        L.polyline(latLngs, {
          color: '#38bdf8',
          weight: 11,
          opacity: 0.35,
          interactive: false,
        }).addTo(group);
      }

      const poly = L.polyline(latLngs, {
        color,
        weight: isSelected ? 6 : isFilterActive && isHighlighted ? 6 : isDimmed ? 3 : 5,
        opacity: isDimmed ? 0.18 : isSelected || (isFilterActive && isHighlighted) ? 1 : 0.9,
      }).addTo(group);

      const feedPon = cable.source_pon_port_id ? ponPortsById[cable.source_pon_port_id] : undefined;
      const coreSum = summarizeCableCores(
        cable.cores_allocation_json?.length ? cable.cores_allocation_json : cable.cores_tia598_json,
        cable.cable_cores
      );
      const cableLabel =
        (cable.name || '').trim() ||
        (src && dst ? `${src.name} → ${dst.name}` : `${coreSum.total}C Trunk`);
      const tipText = `${feedPon ? `PON-${feedPon.port_number} · ` : ''}${cableLabel} • ${
        cable.distance_meters
      }m • ${coreSum.litCount}/${coreSum.total} Lit (${coreSum.spareCount} Spare)`;
      poly.bindTooltip(tipText, { sticky: true, direction: 'top', opacity: 0.96 });

      poly.on('click', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e);
        onCableClickRef.current(cable, { lat: e.latlng.lat, lng: e.latlng.lng });
      });
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
          weight: 5,
          dashArray: '8 6',
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

    // 3. Render GIS nodes
    for (const node of nodes) {
      const isConnectStart = node.id === connectSourceNodeId;
      const isConnectTarget = node.id === connectTargetNodeId;
      const isSelected = node.id === selectedNodeId || isConnectStart || isConnectTarget;
      const nodePorts = portsByNodeId[node.id] || [];
      const nodeOutputs = splitterOutputsByNodeId[node.id] || [];
      const budget = budgetsByNodeId[node.id];
      const summary = budget?.enclosureSummary;
      const splitterSpec = SPLITTER_SPECS[node.splitter_type] || SPLITTER_SPECS['none'];
      const hasMultiSplitters = Boolean(summary && (node.internal_splitters?.length || 0) > 0);
      const totalPorts = hasMultiSplitters && summary
        ? summary.boxCapacity
        : splitterSpec.type !== 'none'
        ? splitterSpec.isAsymmetricFbt
          ? 2
          : Math.max(Number(node.box_capacity || 0), Number(node.total_ports || 0), splitterSpec.defaultPorts)
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

      let html = '';
      let tooltipText = `${node.name}${node.area_name ? ` (${node.area_name})` : ''}`;

      if (node.node_type === 'OLT') {
        const linkedOlt = node.olt_id ? oltsById[node.olt_id] : undefined;
        const oltPorts = linkedOlt ? ponPortsByOltId[linkedOlt.id] || [] : [];
        const peakTx =
          oltPorts.length > 0
            ? Math.max(...oltPorts.map((p) => Number(p.tx_power_dbm ?? 5.0)))
            : Number(node.tx_power_dbm ?? 5.0);
        const modeTag = linkedOlt ? linkedOlt.pon_mode : 'OLT';
        const modeBg =
          linkedOlt?.pon_mode === 'EPON' ? '#d97706' : linkedOlt?.pon_mode === 'GPON' ? '#0891b2' : 'rgba(0,0,0,0.25)';
        const portBadge = linkedOlt ? ` ${linkedOlt.total_pon_ports}P` : '';

        tooltipText = `${node.name} (${modeTag} · ${linkedOlt?.total_pon_ports || 1} PON · Peak ${
          peakTx >= 0 ? '+' : ''
        }${peakTx.toFixed(1)} dBm)`;

        html = `<div style="display:inline-flex;align-items:center;gap:5px;padding:4px 9px;border-radius:8px;border:1.5px solid ${
          isSelected ? '#ffffff' : '#7dd3fc'
        };background:${isSelected ? '#0ea5e9' : '#0284c7'};color:#fff;font-family:monospace;font-size:11px;font-weight:700;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,0.45);transform:translate(-50%,-50%);cursor:${
          toolMode === 'pan' ? 'grab' : 'pointer'
        };">
          <span style="background:${modeBg};padding:1px 4px;border-radius:4px;font-size:10px;">${modeTag}${portBadge}</span>
          <span style="opacity:.95">${peakTx >= 0 ? '+' : ''}${peakTx.toFixed(1)}dBm</span>
        </div>`;
      } else if (node.node_type === 'DIST_NODE') {
        const ratioBadge =
          splitterCount > 1
            ? `${splitterCount} Spl`
            : splitterSpec.type !== 'none'
            ? splitterSpec.type
            : `${node.tray_capacity}C`;
        const distOutputDbm =
          splitterSpec.isAsymmetricFbt
            ? budget?.thruOutputDbm
            : splitterSpec.type !== 'none' || splitterCount > 0
            ? budget?.ontRxDbm
            : budget?.thruOutputDbm ?? budget?.inputDbm;
        const healthColor = budget && budget.healthBand !== 'UNLINKED' ? getHealthBadgeColors(budget.healthBand).hex : '#a5b4fc';
        const dbTxt =
          distOutputDbm !== null && distOutputDbm !== undefined
            ? ` ${distOutputDbm.toFixed(1)}dBm`
            : '';
        tooltipText = `${node.name} · Dist Node (${ratioBadge})${
          totalPorts > 0 ? ` · ${usedPortsCount}/${totalPorts} Used · ${freePorts} Free` : ''
        }${ptJointCount > 0 ? ` · ${ptJointCount} Pass-Thru` : ''}${
          budget?.inputDbm !== null && budget?.inputDbm !== undefined && distOutputDbm !== null && distOutputDbm !== undefined
            ? ` · In ${budget.inputDbm.toFixed(1)} → Out ${distOutputDbm.toFixed(1)} dBm`
            : ''
        }`;
        html = `<div style="display:inline-flex;align-items:center;gap:4px;padding:4px 8px;border-radius:8px;border:1.5px solid ${
          isSelected ? '#ffffff' : healthColor
        };background:${isSelected ? '#6366f1' : '#4338ca'};color:#fff;font-family:monospace;font-size:10px;font-weight:700;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,0.45);transform:translate(-50%,-50%);cursor:${
          toolMode === 'pan' ? 'grab' : 'pointer'
        };">
          <span>DIST</span><span style="background:rgba(0,0,0,0.28);padding:1px 4px;border-radius:4px">${ratioBadge}</span>${
            dbTxt ? `<span style="color:${healthColor}">${dbTxt}</span>` : ''
          }
        </div>`;
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
        const dbTxt =
          foscOutDbm !== null && foscOutDbm !== undefined
            ? ` ${foscOutDbm.toFixed(1)}dBm`
            : '';
        tooltipText = `${node.name} · FOSC Joint (${node.tray_capacity}C${splitTag})${
          ptJointCount > 0 ? ` · ${ptJointCount} Pass-Thru` : ''
        }${
          budget?.inputDbm !== null && budget?.inputDbm !== undefined
            ? ` · In ${budget.inputDbm.toFixed(1)}${
                foscOutDbm !== null && foscOutDbm !== undefined ? ` → Out ${foscOutDbm.toFixed(1)}` : ''
              } dBm`
            : ''
        }`;
        html = `<div style="display:inline-flex;align-items:center;gap:4px;padding:4px 8px;border-radius:8px;border:1.5px solid ${
          isSelected ? '#ffffff' : '#d8b4fe'
        };background:${isSelected ? '#a855f7' : '#7e22ce'};color:#fff;font-family:monospace;font-size:10px;font-weight:700;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,0.45);transform:translate(-50%,-50%);cursor:${
          toolMode === 'pan' ? 'grab' : 'pointer'
        };">
          <span>FOSC</span><span>${node.tray_capacity}C${splitterCount > 1 ? `·${splitterCount}Spl` : splitterSpec.type !== 'none' ? `·${splitterSpec.type}` : ''}</span>${
            dbTxt ? `<span style="background:rgba(0,0,0,0.28);padding:1px 4px;border-radius:4px">${dbTxt}</span>` : ''
          }
        </div>`;
      } else {
        const bg =
          totalPorts > 0 && freePorts === 0
            ? '#e11d48'
            : freePorts <= 2
            ? '#f59e0b'
            : '#059669';
        const fg = freePorts > 0 && freePorts <= 2 ? '#0f172a' : '#ffffff';
        const signalHex =
          budget && budget.healthBand !== 'UNLINKED'
            ? getHealthBadgeColors(budget.healthBand).hex
            : '#94a3b8';
        const dbTxt =
          budget?.ontRxDbm !== null && budget?.ontRxDbm !== undefined
            ? `${budget.ontRxDbm.toFixed(1)}dBm`
            : '';
        const splBadge = splitterCount > 1 ? ` · ${splitterCount} Spl` : '';
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
        html = `<div style="display:inline-flex;align-items:center;gap:5px;padding:4px 8px;border-radius:8px;border:1.5px solid ${
          isSelected
            ? '#ffffff'
            : budget?.healthBand === 'CRITICAL LOS RISK'
            ? '#f43f5e'
            : 'rgba(255,255,255,0.75)'
        };background:${bg};color:${fg};font-family:monospace;font-size:10px;font-weight:700;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,0.45);transform:translate(-50%,-50%);cursor:${
          toolMode === 'pan' ? 'grab' : 'pointer'
        };">
          <span>FDB</span><span style="background:rgba(0,0,0,0.22);padding:1px 4px;border-radius:4px">${usedPortsCount}/${totalPorts}${splBadge}</span>${
            dbTxt
              ? `<span style="background:rgba(15,23,42,0.82);color:${signalHex};padding:1px 4px;border-radius:4px">${dbTxt}</span>`
              : ''
          }
        </div>`;
      }

      const isHighlightedNode = !isFilterActive || Boolean(highlightedNodeIds[node.id]);
      const isDimmedNode = isFilterActive && !isHighlightedNode;
      const nodeOpacity = isDimmedNode ? 0.18 : 1;
      const startEndTag = isConnectStart
        ? `<div style="position:absolute;top:-22px;left:0;transform:translate(-50%,-100%);background:#10b981;color:#022c22;font-family:monospace;font-size:9px;font-weight:800;padding:1px 5px;border-radius:4px;white-space:nowrap;box-shadow:0 2px 8px rgba(16,185,129,0.75);pointer-events:none;">A-START</div>`
        : isConnectTarget
        ? `<div style="position:absolute;top:-22px;left:0;transform:translate(-50%,-100%);background:#f59e0b;color:#0f172a;font-family:monospace;font-size:9px;font-weight:800;padding:1px 5px;border-radius:4px;white-space:nowrap;box-shadow:0 2px 8px rgba(245,158,11,0.75);pointer-events:none;">B-END</div>`
        : '';
      const connectGlow = isConnectStart
        ? 'filter:drop-shadow(0 0 10px rgba(16,185,129,0.95));'
        : isConnectTarget
        ? 'filter:drop-shadow(0 0 10px rgba(245,158,11,0.95));'
        : isFilterActive && isHighlightedNode
        ? 'filter:drop-shadow(0 0 6px rgba(56,189,248,0.65));'
        : '';
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
          : 0;

      const marker = L.marker([node.lat, node.lng], {
        icon,
        draggable: canDragNode,
        zIndexOffset,
        bubblingMouseEvents: false,
      }).addTo(group);

      marker.bindTooltip(tooltipText, { direction: 'top', offset: [0, -14], opacity: 0.94 });

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

    // 4. Live GPS user dot
    if (userLocation) {
      const gpsIcon = L.divIcon({
        className: 'youthnet-gps-marker',
        html: `<div style="position:relative;width:16px;height:16px;transform:translate(-50%,-50%);">
          <div style="position:absolute;inset:-6px;border-radius:9999px;background:rgba(56,189,248,0.35);"></div>
          <div style="position:relative;width:16px;height:16px;border-radius:9999px;background:#0ea5e9;border:2px solid #ffffff;box-shadow:0 0 8px rgba(14,165,233,0.9);"></div>
        </div>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });
      L.marker([userLocation.lat, userLocation.lng], { icon: gpsIcon }).addTo(group);
    }
  }, [
    nodes,
    cables,
    portsByNodeId,
    splitterOutputsByNodeId,
    budgetsByNodeId,
    oltsById,
    ponPortsByOltId,
    ponPortsById,
    toolMode,
    selectedNodeId,
    selectedCableId,
    connectSourceNodeId,
    connectTargetNodeId,
    draftWaypoints,
    userLocation,
    isFilterActive,
    highlightedNodeIds,
    highlightedCableIds,
  ]);

  return <div ref={containerRef} className="w-full h-full z-0" />;
};
