import React, { useEffect, useRef } from 'react';
import {
  APIProvider,
  APILoadingStatus,
  AdvancedMarker,
  Map,
  MapMouseEvent,
  useApiLoadingStatus,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
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

export type GisToolMode =
  | 'pan'
  | 'place_olt'
  | 'place_fdb'
  | 'place_fosc'
  | 'connect_cable';

export type MapLayerType = 'satellite' | 'hybrid' | 'roadmap';

interface FiberGisGoogleCanvasProps {
  apiKey: string;
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
  onMapsAuthOrLoadError?: () => void;
}

const CameraController: React.FC<{
  flyToTarget: { lat: number; lng: number; zoom?: number; ts: number } | null;
}> = ({ flyToTarget }) => {
  const map = useMap();
  const lastTsRef = useRef<number>(0);

  useEffect(() => {
    if (!map || !flyToTarget || flyToTarget.ts === lastTsRef.current) return;
    lastTsRef.current = flyToTarget.ts;
    map.panTo({ lat: flyToTarget.lat, lng: flyToTarget.lng });
    if (flyToTarget.zoom) {
      map.setZoom(flyToTarget.zoom);
    }
  }, [map, flyToTarget]);

  return null;
};

const GooglePolylinesOverlay: React.FC<{
  cables: SupabaseGisCable[];
  nodesById: Record<string, SupabaseGisNode>;
  budgetsByNodeId: Record<string, NodeOpticalBudgetResult>;
  selectedCableId: string | null;
  draftWaypoints: GisLatLng[];
  onCableClick: (cable: SupabaseGisCable, clickCoords?: GisLatLng) => void;
}> = ({
  cables,
  nodesById,
  budgetsByNodeId,
  selectedCableId,
  draftWaypoints,
  onCableClick,
}) => {
  const map = useMap();
  const mapsLib = useMapsLibrary('maps');

  useEffect(() => {
    if (!map || !mapsLib) return;

    const polylines: Array<{ setMap: (m: null) => void }> = [];

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
      const strokeHex = isSelected
        ? '#facc15'
        : dstBudget && dstBudget.healthBand !== 'UNLINKED'
        ? getHealthBadgeColors(dstBudget.healthBand).hex
        : '#38bdf8';

      const line = new mapsLib.Polyline({
        path,
        geodesic: true,
        strokeColor: strokeHex,
        strokeOpacity: isSelected ? 1.0 : 0.88,
        strokeWeight: isSelected ? 6 : 4,
        zIndex: isSelected ? 30 : 15,
        map,
      });

      line.addListener('click', (ev: { latLng?: { lat: () => number; lng: () => number } }) => {
        const clickCoords = ev?.latLng
          ? { lat: ev.latLng.lat(), lng: ev.latLng.lng() }
          : undefined;
        onCableClick(cable, clickCoords);
      });

      polylines.push(line);
    }

    if (draftWaypoints.length >= 2) {
      const draftLine = new mapsLib.Polyline({
        path: draftWaypoints,
        geodesic: true,
        strokeColor: '#22d3ee',
        strokeOpacity: 0.95,
        strokeWeight: 4,
        zIndex: 40,
        icons: [
          {
            icon: {
              path: 'M 0,-1 0,1',
              strokeOpacity: 1,
              scale: 3,
            },
            offset: '0',
            repeat: '16px',
          },
        ],
        map,
      });
      polylines.push(draftLine);
    }

    return () => {
      for (const p of polylines) {
        p.setMap(null);
      }
    };
  }, [map, mapsLib, cables, nodesById, budgetsByNodeId, selectedCableId, draftWaypoints, onCableClick]);

  return null;
};

const GoogleApiStatusWatcher: React.FC<{
  onError?: () => void;
}> = ({ onError }) => {
  const status = useApiLoadingStatus();
  const notifiedRef = useRef(false);

  useEffect(() => {
    if (
      (status === APILoadingStatus.AUTH_FAILURE || status === APILoadingStatus.FAILED) &&
      !notifiedRef.current
    ) {
      notifiedRef.current = true;
      if (status === APILoadingStatus.AUTH_FAILURE && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
      }
      onError?.();
    }
  }, [status, onError]);

  return null;
};

export const FiberGisGoogleCanvas: React.FC<FiberGisGoogleCanvasProps> = ({
  apiKey,
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
  onMapsAuthOrLoadError,
}) => {
  const nodesById: Record<string, SupabaseGisNode> = {};
  for (const n of nodes) {
    nodesById[n.id] = n;
  }

  const handleMapClick = (ev: MapMouseEvent) => {
    const latLng = ev.detail?.latLng;
    if (!latLng) return;
    onMapClick({ lat: latLng.lat, lng: latLng.lng });
  };

  return (
    <div className="w-full h-full relative">
      <APIProvider
        apiKey={apiKey}
        libraries={['marker', 'maps']}
        language="en"
        region="PK"
      >
        <GoogleApiStatusWatcher onError={onMapsAuthOrLoadError} />
        <Map
          mapId="DEMO_MAP_ID"
          internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
          defaultCenter={center}
          defaultZoom={zoom}
          mapTypeId={layerType}
          gestureHandling="greedy"
          streetViewControl={false}
          fullscreenControl={false}
          mapTypeControl={false}
          clickableIcons={false}
          onClick={handleMapClick}
          onCameraChanged={(ev) => {
            if (onCameraChange && ev.detail?.center && typeof ev.detail?.zoom === 'number') {
              onCameraChange(ev.detail.center, ev.detail.zoom);
            }
          }}
          style={{
            width: '100%',
            height: '100%',
            cursor: toolMode === 'pan' ? 'grab' : 'crosshair',
          }}
        >
          <CameraController flyToTarget={flyToTarget} />

          <GooglePolylinesOverlay
            cables={cables}
            nodesById={nodesById}
            budgetsByNodeId={budgetsByNodeId}
            selectedCableId={selectedCableId}
            draftWaypoints={draftWaypoints}
            onCableClick={onCableClick}
          />

          {/* Draft Intermediate Waypoints */}
          {draftWaypoints.slice(1).map((pt, idx) => (
            <AdvancedMarker key={`wp-${idx}`} position={pt}>
              <div className="w-3 h-3 rounded-full bg-cyan-400 border-2 border-slate-950 shadow-md" />
            </AdvancedMarker>
          ))}

          {/* GIS Nodes */}
          {nodes.map((node) => {
            const isSelected = node.id === selectedNodeId || node.id === connectSourceNodeId;
            const nodePorts = portsByNodeId[node.id] || [];
            const usedPortsCount = nodePorts.filter((p) => p.status !== 'FREE').length;
            const totalPorts = Number(node.total_ports || 0);
            const freePorts = Math.max(0, totalPorts - usedPortsCount);
            const budget = budgetsByNodeId[node.id];

            if (node.node_type === 'OLT') {
              return (
                <AdvancedMarker
                  key={node.id}
                  position={{ lat: node.lat, lng: node.lng }}
                  onClick={() => onNodeClick(node)}
                  zIndex={isSelected ? 60 : 40}
                  title={`OLT Hub: ${node.name}`}
                >
                  <div
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-mono font-bold shadow-lg transition-transform cursor-pointer ${
                      isSelected
                        ? 'bg-sky-500 text-slate-950 border-white scale-110 ring-2 ring-sky-300'
                        : 'bg-sky-600/95 text-white border-sky-300 hover:scale-105'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                    <span>OLT</span>
                    <span className="opacity-90">+{Number(node.tx_power_dbm ?? 5).toFixed(1)}dBm</span>
                  </div>
                </AdvancedMarker>
              );
            }

            if (node.node_type === 'FOSC_JOINT') {
              return (
                <AdvancedMarker
                  key={node.id}
                  position={{ lat: node.lat, lng: node.lng }}
                  onClick={() => onNodeClick(node)}
                  zIndex={isSelected ? 60 : 35}
                  title={`FOSC Joint Box: ${node.name}`}
                >
                  <div
                    className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-[10px] font-mono font-bold shadow-lg transition-transform cursor-pointer ${
                      isSelected
                        ? 'bg-purple-500 text-white border-white scale-110 ring-2 ring-purple-300'
                        : 'bg-purple-700/95 text-purple-50 border-purple-300 hover:scale-105'
                    }`}
                  >
                    <span>FOSC</span>
                    <span className="opacity-90">{node.tray_capacity}C</span>
                  </div>
                </AdvancedMarker>
              );
            }

            // FDB / FAT Splitter Box: Emerald >2 free, Amber <=2 free, Rose 0 free
            const badgeStyle =
              totalPorts > 0 && freePorts === 0
                ? 'bg-rose-600/95 border-rose-200 text-white'
                : freePorts <= 2
                ? 'bg-amber-500/95 border-amber-100 text-slate-950'
                : 'bg-emerald-600/95 border-emerald-200 text-white';

            return (
              <AdvancedMarker
                key={node.id}
                position={{ lat: node.lat, lng: node.lng }}
                onClick={() => onNodeClick(node)}
                zIndex={isSelected ? 60 : 30}
                title={`FDB / FAT: ${node.name} (${freePorts}/${totalPorts} free)`}
              >
                <div
                  className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[10px] font-mono font-bold shadow-lg transition-transform cursor-pointer ${badgeStyle} ${
                    isSelected ? 'scale-110 ring-2 ring-white' : 'hover:scale-105'
                  }`}
                >
                  <span>FDB</span>
                  <span className="px-1 py-0.2 rounded bg-black/25 tabular-nums">
                    {freePorts}/{totalPorts} Free
                  </span>
                  {budget?.ontRxDbm !== null && budget?.ontRxDbm !== undefined && (
                    <span className="hidden sm:inline opacity-90 tabular-nums">
                      {budget.ontRxDbm.toFixed(1)}dB
                    </span>
                  )}
                </div>
              </AdvancedMarker>
            );
          })}

          {/* Live User GPS Blue Pulsing Dot */}
          {userLocation && (
            <AdvancedMarker position={userLocation} zIndex={80} title="Your Live GPS Location">
              <div className="relative flex items-center justify-center">
                <span className="absolute w-8 h-8 rounded-full bg-sky-400/40 animate-ping" />
                <span className="relative w-4 h-4 rounded-full bg-sky-500 border-2 border-white shadow-lg" />
              </div>
            </AdvancedMarker>
          )}
        </Map>
      </APIProvider>
    </div>
  );
};
