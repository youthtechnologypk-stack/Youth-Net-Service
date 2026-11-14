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
  draftWaypoints: GisLatLng[];
  userLocation: GisLatLng | null;
  flyToTarget: { lat: number; lng: number; zoom?: number; ts: number } | null;
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
  draftWaypoints,
  userLocation,
  flyToTarget,
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
          'https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png',
          {
            attribution: '&copy; OpenStreetMap &copy; CARTO',
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
      const dstBudget = budgetsByNodeId[cable.target_node_id];
      const color = isSelected
        ? '#facc15'
        : dstBudget && dstBudget.healthBand !== 'UNLINKED'
        ? getHealthBadgeColors(dstBudget.healthBand).hex
        : '#38bdf8';

      const poly = L.polyline(
        path.map((p) => [p.lat, p.lng] as [number, number]),
        {
          color,
          weight: isSelected ? 6 : 4,
          opacity: isSelected ? 1 : 0.88,
        }
      ).addTo(group);

      const feedPon = cable.source_pon_port_id ? ponPortsById[cable.source_pon_port_id] : undefined;
      const coreSum = summarizeCableCores(
        cable.cores_allocation_json?.length ? cable.cores_allocation_json : cable.cores_tia598_json,
        cable.cable_cores
      );
      const tipText = `${feedPon ? `PON-${feedPon.port_number} · ` : ''}${coreSum.total}C Total (${
        coreSum.splitterCount
      } Split | ${coreSum.passThroughCount} Area | ${coreSum.freeCount} Free) · ${
        cable.distance_meters
      }m`;
      poly.bindTooltip(tipText, { sticky: true, direction: 'top', opacity: 0.94 });

      poly.on('click', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e);
        onCableClickRef.current(cable, { lat: e.latlng.lat, lng: e.latlng.lng });
      });
    }

    // 2. Render draft fiber route waypoints
    if (draftWaypoints.length >= 2) {
      L.polyline(
        draftWaypoints.map((p) => [p.lat, p.lng] as [number, number]),
        {
          color: '#22d3ee',
          weight: 4,
          dashArray: '8 6',
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
      }).addTo(group);
    }

    // 3. Render GIS nodes
    for (const node of nodes) {
      const isSelected = node.id === selectedNodeId || node.id === connectSourceNodeId;
      const nodePorts = portsByNodeId[node.id] || [];
      const nodeOutputs = splitterOutputsByNodeId[node.id] || [];
      const splitterSpec = SPLITTER_SPECS[node.splitter_type] || SPLITTER_SPECS['none'];
      const totalPorts =
        splitterSpec.type !== 'none'
          ? splitterSpec.isAsymmetricFbt
            ? 2
            : Math.max(Number(node.total_ports || 0), splitterSpec.defaultPorts)
          : Number(node.total_ports || 0);

      let usedPortsCount = 0;
      if (nodeOutputs.length > 0) {
        usedPortsCount = nodeOutputs.filter((o) => o.utilization_type !== 'FREE_PORT').length;
      } else {
        usedPortsCount = nodePorts.filter((p) => p.status !== 'FREE').length;
      }
      const freePorts = Math.max(0, totalPorts - usedPortsCount);
      const budget = budgetsByNodeId[node.id];

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
        const ratioBadge = splitterSpec.type !== 'none' ? splitterSpec.type : `${node.tray_capacity}C`;
        const dbTxt =
          budget?.inputDbm !== null && budget?.inputDbm !== undefined
            ? ` ${budget.inputDbm.toFixed(1)}dB`
            : '';
        tooltipText = `${node.name} · Dist Node (${ratioBadge})${
          totalPorts > 0 ? ` · ${usedPortsCount}/${totalPorts} Used · ${freePorts} Free` : ''
        }`;
        html = `<div style="display:inline-flex;align-items:center;gap:4px;padding:4px 8px;border-radius:8px;border:1.5px solid ${
          isSelected ? '#ffffff' : '#a5b4fc'
        };background:${isSelected ? '#6366f1' : '#4338ca'};color:#fff;font-family:monospace;font-size:10px;font-weight:700;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,0.45);transform:translate(-50%,-50%);cursor:${
          toolMode === 'pan' ? 'grab' : 'pointer'
        };">
          <span>DIST</span><span style="background:rgba(0,0,0,0.28);padding:1px 4px;border-radius:4px">${ratioBadge}</span><span>${dbTxt}</span>
        </div>`;
      } else if (node.node_type === 'FOSC_JOINT') {
        const splitTag = splitterSpec.type !== 'none' ? ` · ${splitterSpec.type}` : '';
        tooltipText = `${node.name} · FOSC Joint (${node.tray_capacity}C${splitTag})${
          budget?.inputDbm !== null && budget?.inputDbm !== undefined
            ? ` · In ${budget.inputDbm.toFixed(1)} dBm`
            : ''
        }`;
        html = `<div style="display:inline-flex;align-items:center;gap:4px;padding:4px 8px;border-radius:8px;border:1.5px solid ${
          isSelected ? '#ffffff' : '#d8b4fe'
        };background:${isSelected ? '#a855f7' : '#7e22ce'};color:#fff;font-family:monospace;font-size:10px;font-weight:700;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,0.45);transform:translate(-50%,-50%);cursor:${
          toolMode === 'pan' ? 'grab' : 'pointer'
        };">
          <span>FOSC</span><span>${node.tray_capacity}C${splitterSpec.type !== 'none' ? `·${splitterSpec.type}` : ''}</span>
        </div>`;
      } else {
        const bg =
          totalPorts > 0 && freePorts === 0
            ? '#e11d48'
            : freePorts <= 2
            ? '#f59e0b'
            : '#059669';
        const fg = freePorts > 0 && freePorts <= 2 ? '#0f172a' : '#ffffff';
        const dbTxt =
          budget?.ontRxDbm !== null && budget?.ontRxDbm !== undefined
            ? ` ${budget.ontRxDbm.toFixed(1)}dB`
            : '';
        tooltipText = `${node.name} · ${node.splitter_type} · ${usedPortsCount}/${totalPorts} Used · ${freePorts} Free${
          budget?.ontRxDbm !== null && budget?.ontRxDbm !== undefined
            ? ` · Rx ${budget.ontRxDbm.toFixed(1)} dBm`
            : ''
        }`;
        html = `<div style="display:inline-flex;align-items:center;gap:5px;padding:4px 8px;border-radius:8px;border:1.5px solid ${
          isSelected ? '#ffffff' : 'rgba(255,255,255,0.7)'
        };background:${bg};color:${fg};font-family:monospace;font-size:10px;font-weight:700;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,0.45);transform:translate(-50%,-50%);cursor:${
          toolMode === 'pan' ? 'grab' : 'pointer'
        };">
          <span>FDB</span><span style="background:rgba(0,0,0,0.22);padding:1px 4px;border-radius:4px">${freePorts}/${totalPorts}</span><span>${dbTxt}</span>
        </div>`;
      }

      const icon = L.divIcon({
        className: 'youthnet-gis-marker',
        html,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });

      const canDragNode = toolMode === 'pan' && Boolean(onNodeDragEndRef.current);
      const marker = L.marker([node.lat, node.lng], {
        icon,
        draggable: canDragNode,
      }).addTo(group);

      marker.bindTooltip(tooltipText, { direction: 'top', offset: [0, -14], opacity: 0.94 });

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
    draftWaypoints,
    userLocation,
  ]);

  return <div ref={containerRef} className="w-full h-full z-0" />;
};
