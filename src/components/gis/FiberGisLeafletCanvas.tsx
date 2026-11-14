import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type {
  GisLatLng,
  SupabaseGisCable,
  SupabaseGisFdbPort,
  SupabaseGisNode,
} from '../../services/supabaseClient';
import {
  NodeOpticalBudgetResult,
  getHealthBadgeColors,
} from '../../lib/fiberOpticEngine';
import type { GisToolMode, MapLayerType } from './FiberGisGoogleCanvas';

interface FiberGisLeafletCanvasProps {
  center: GisLatLng;
  zoom: number;
  layerType: MapLayerType;
  toolMode: GisToolMode;
  nodes: SupabaseGisNode[];
  cables: SupabaseGisCable[];
  portsByNodeId: Record<string, SupabaseGisFdbPort[]>;
  budgetsByNodeId: Record<string, NodeOpticalBudgetResult>;
  selectedNodeId: string | null;
  selectedCableId: string | null;
  connectSourceNodeId: string | null;
  draftWaypoints: GisLatLng[];
  userLocation: GisLatLng | null;
  flyToTarget: { lat: number; lng: number; zoom?: number; ts: number } | null;
  onMapClick: (coords: GisLatLng) => void;
  onNodeClick: (node: SupabaseGisNode) => void;
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
  budgetsByNodeId,
  selectedNodeId,
  selectedCableId,
  connectSourceNodeId,
  draftWaypoints,
  userLocation,
  flyToTarget,
  onMapClick,
  onNodeClick,
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
  const onCableClickRef = useRef(onCableClick);
  const onCameraChangeRef = useRef(onCameraChange);
  onMapClickRef.current = onMapClick;
  onNodeClickRef.current = onNodeClick;
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

  // Switch tile layer cleanly
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
          'https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png',
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
      const usedPortsCount = nodePorts.filter((p) => p.status !== 'FREE').length;
      const totalPorts = Number(node.total_ports || 0);
      const freePorts = Math.max(0, totalPorts - usedPortsCount);
      const budget = budgetsByNodeId[node.id];

      let html = '';
      if (node.node_type === 'OLT') {
        html = `<div style="display:inline-flex;align-items:center;gap:5px;padding:4px 9px;border-radius:8px;border:1.5px solid ${
          isSelected ? '#ffffff' : '#7dd3fc'
        };background:${isSelected ? '#0ea5e9' : '#0284c7'};color:#fff;font-family:monospace;font-size:11px;font-weight:700;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,0.45);transform:translate(-50%,-50%);">
          <span>OLT</span><span style="opacity:.9">+${Number(node.tx_power_dbm ?? 5).toFixed(1)}dBm</span>
        </div>`;
      } else if (node.node_type === 'FOSC_JOINT') {
        html = `<div style="display:inline-flex;align-items:center;gap:4px;padding:4px 8px;border-radius:8px;border:1.5px solid ${
          isSelected ? '#ffffff' : '#d8b4fe'
        };background:${isSelected ? '#a855f7' : '#7e22ce'};color:#fff;font-family:monospace;font-size:10px;font-weight:700;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,0.45);transform:translate(-50%,-50%);">
          <span>FOSC</span><span>${node.tray_capacity}C</span>
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
        html = `<div style="display:inline-flex;align-items:center;gap:5px;padding:4px 8px;border-radius:8px;border:1.5px solid ${
          isSelected ? '#ffffff' : 'rgba(255,255,255,0.7)'
        };background:${bg};color:${fg};font-family:monospace;font-size:10px;font-weight:700;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,0.45);transform:translate(-50%,-50%);">
          <span>FDB</span><span style="background:rgba(0,0,0,0.22);padding:1px 4px;border-radius:4px">${freePorts}/${totalPorts}</span><span>${dbTxt}</span>
        </div>`;
      }

      const icon = L.divIcon({
        className: 'youthnet-gis-marker',
        html,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });

      const marker = L.marker([node.lat, node.lng], { icon }).addTo(group);
      marker.on('click', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e);
        onNodeClickRef.current(node);
      });
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
    budgetsByNodeId,
    selectedNodeId,
    selectedCableId,
    connectSourceNodeId,
    draftWaypoints,
    userLocation,
  ]);

  return <div ref={containerRef} className="w-full h-full z-0" />;
};
