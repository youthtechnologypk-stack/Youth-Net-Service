import {
  supabase,
  SupabaseGisCable,
  SupabaseGisFdbPort,
  SupabaseGisNode,
  SupabasePortalUser,
} from './supabaseClient';
import {
  buildCableSplitPlan,
  calculateTopologyOpticalBudgets,
  computePolylineDistanceMeters,
  generateDefaultSpliceTray,
  generateTia598Cores,
  normalizeCableCores,
  SPLITTER_SPECS,
} from '../lib/fiberOpticEngine';
import type {
  GisLatLng,
  GisNodeType,
  GisPortStatus,
  GisSplitterType,
} from './supabaseClient';
import { isMissingTableOrColumnError } from '../lib/expiryUtils';

export interface GisSubscriberSummary {
  id: string;
  username: string;
  fullName: string;
  phone: string;
  area: string;
  address: string;
  packageSpeed: string;
  accountStatus: string;
  isOnline: boolean;
  activeIp?: string;
  activeUptime?: string;
}

export interface LoadedGisTopology {
  nodes: SupabaseGisNode[];
  cables: SupabaseGisCable[];
  ports: SupabaseGisFdbPort[];
  subscribers: GisSubscriberSummary[];
  schemaMissing: boolean;
}

/**
 * Fetches live PPPoE active usernames from backend /api/mikrotik proxy + session logs fallback.
 */
async function fetchOnlineSubscribersMap(
  fallbackActiveUsernames: string[] = []
): Promise<Record<string, { ip?: string; uptime?: string }>> {
  const onlineMap: Record<string, { ip?: string; uptime?: string }> = {};
  for (const u of fallbackActiveUsernames) {
    const k = (u || '').trim().toLowerCase();
    if (k) onlineMap[k] = {};
  }

  try {
    const res = await fetch('/api/mikrotik/ppp/active', { method: 'GET' });
    if (res.ok) {
      const payload = await res.json();
      const rows = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.active)
        ? payload.active
        : Array.isArray(payload?.sessions)
        ? payload.sessions
        : [];
      for (const r of rows) {
        const uname = String(r?.name || r?.user || r?.username || '').trim().toLowerCase();
        if (uname) {
          onlineMap[uname] = {
            ip: r?.address || r?.ip_address || undefined,
            uptime: r?.uptime || undefined,
          };
        }
      }
      if (Object.keys(onlineMap).length > 0) return onlineMap;
    }
  } catch {
    // Fall back to Supabase subscriber_session_logs
  }

  try {
    const { data: sessRows } = await supabase
      .from('subscriber_session_logs')
      .select('subscriber_username, ip_address, uptime_duration, session_status')
      .eq('session_status', 'ACTIVE');
    if (Array.isArray(sessRows)) {
      for (const s of sessRows as any[]) {
        const uname = String(s?.subscriber_username || '').trim().toLowerCase();
        if (uname) {
          onlineMap[uname] = {
            ip: s?.ip_address || undefined,
            uptime: s?.uptime_duration || undefined,
          };
        }
      }
    }
  } catch {
    // ignore fallback errors
  }

  return onlineMap;
}

export type GisRealtimeEventType = 'INSERT' | 'UPDATE' | 'DELETE';
export type GisRealtimeConnectionStatus =
  | 'CONNECTING'
  | 'SUBSCRIBED'
  | 'RECONNECTING'
  | 'ERROR';

export function normalizeGisNodeRow(n: any): SupabaseGisNode {
  return {
    ...n,
    lat: Number(n.lat),
    lng: Number(n.lng),
    tx_power_dbm: Number(n.tx_power_dbm ?? 5.0),
    total_ports: Number(n.total_ports ?? 8),
    tray_capacity: Number(n.tray_capacity ?? 12),
    loss_per_splice: Number(n.loss_per_splice ?? 0.08),
    calculated_input_dbm:
      n.calculated_input_dbm !== null && n.calculated_input_dbm !== undefined
        ? Number(n.calculated_input_dbm)
        : null,
    calculated_ont_rx_dbm:
      n.calculated_ont_rx_dbm !== null && n.calculated_ont_rx_dbm !== undefined
        ? Number(n.calculated_ont_rx_dbm)
        : null,
    splice_tray_json: Array.isArray(n.splice_tray_json) ? n.splice_tray_json : [],
  };
}

export function normalizeGisCableRow(c: any): SupabaseGisCable {
  const cores = Number(c.cable_cores ?? 12) as SupabaseGisCable['cable_cores'];
  return {
    ...c,
    cable_cores: cores,
    distance_meters: Number(c.distance_meters ?? 0),
    route_coordinates_json: Array.isArray(c.route_coordinates_json) ? c.route_coordinates_json : [],
    cores_tia598_json: normalizeCableCores(cores, c.cores_tia598_json),
  };
}

export function normalizeGisPortRow(p: any): SupabaseGisFdbPort {
  return {
    ...p,
    port_number: Number(p.port_number),
    drop_cable_meters: Number(p.drop_cable_meters ?? 30),
  };
}

export function applyRealtimeNodeDelta(
  current: SupabaseGisNode[],
  eventType: GisRealtimeEventType,
  newRow?: any,
  oldRow?: any
): SupabaseGisNode[] {
  if (eventType === 'DELETE') {
    const targetId = oldRow?.id;
    if (!targetId) return current;
    return current.filter((n) => n.id !== targetId);
  }
  if (!newRow?.id) return current;
  const normalized = normalizeGisNodeRow(newRow);
  const idx = current.findIndex((n) => n.id === normalized.id);
  if (idx === -1) {
    return [...current, normalized];
  }
  const next = current.slice();
  next[idx] = normalized;
  return next;
}

export function applyRealtimeCableDelta(
  current: SupabaseGisCable[],
  eventType: GisRealtimeEventType,
  newRow?: any,
  oldRow?: any
): SupabaseGisCable[] {
  if (eventType === 'DELETE') {
    const targetId = oldRow?.id;
    if (!targetId) return current;
    return current.filter((c) => c.id !== targetId);
  }
  if (!newRow?.id) return current;
  const normalized = normalizeGisCableRow(newRow);
  const idx = current.findIndex((c) => c.id === normalized.id);
  if (idx === -1) {
    return [...current, normalized];
  }
  const next = current.slice();
  next[idx] = normalized;
  return next;
}

export function applyRealtimePortDelta(
  current: SupabaseGisFdbPort[],
  eventType: GisRealtimeEventType,
  newRow?: any,
  oldRow?: any
): SupabaseGisFdbPort[] {
  if (eventType === 'DELETE') {
    const targetId = oldRow?.id;
    if (!targetId) return current;
    return current.filter((p) => p.id !== targetId);
  }
  if (!newRow?.id) return current;
  const normalized = normalizeGisPortRow(newRow);
  const idx = current.findIndex(
    (p) =>
      p.id === normalized.id ||
      (p.fdb_node_id === normalized.fdb_node_id && p.port_number === normalized.port_number)
  );
  if (idx === -1) {
    return [...current, normalized].sort((a, b) => a.port_number - b.port_number);
  }
  const next = current.slice();
  next[idx] = normalized;
  return next.sort((a, b) => a.port_number - b.port_number);
}

/**
 * Opens a live Supabase Realtime channel subscribing to postgres_changes on
 * gis_nodes, gis_cables, and gis_fdb_ports for multi-user NOC <-> Field Agent sync.
 */
export function subscribeToGisRealtime(handlers: {
  onNodeDelta: (eventType: GisRealtimeEventType, newRow?: any, oldRow?: any) => void;
  onCableDelta: (eventType: GisRealtimeEventType, newRow?: any, oldRow?: any) => void;
  onPortDelta: (eventType: GisRealtimeEventType, newRow?: any, oldRow?: any) => void;
  onStatusChange?: (status: GisRealtimeConnectionStatus) => void;
}): () => void {
  handlers.onStatusChange?.('CONNECTING');

  const channelName = `fiber-gis-realtime-${Math.random().toString(36).slice(2, 8)}`;
  const channel = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'gis_nodes' },
      (payload) => {
        handlers.onNodeDelta(
          payload.eventType as GisRealtimeEventType,
          payload.new,
          payload.old
        );
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'gis_cables' },
      (payload) => {
        handlers.onCableDelta(
          payload.eventType as GisRealtimeEventType,
          payload.new,
          payload.old
        );
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'gis_fdb_ports' },
      (payload) => {
        handlers.onPortDelta(
          payload.eventType as GisRealtimeEventType,
          payload.new,
          payload.old
        );
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        handlers.onStatusChange?.('SUBSCRIBED');
      } else if (status === 'TIMED_OUT' || status === 'CLOSED') {
        handlers.onStatusChange?.('RECONNECTING');
      } else if (status === 'CHANNEL_ERROR') {
        handlers.onStatusChange?.('ERROR');
      }
    });

  return () => {
    try {
      supabase.removeChannel(channel);
    } catch {
      // ignore cleanup error
    }
  };
}

export async function loadGisTopology(
  fallbackActiveUsernames: string[] = []
): Promise<LoadedGisTopology> {
  const [nodesRes, cablesRes, portsRes, subsRes, onlineMap] = await Promise.all([
    supabase.from('gis_nodes').select('*').order('created_at', { ascending: true }),
    supabase.from('gis_cables').select('*').order('created_at', { ascending: true }),
    supabase.from('gis_fdb_ports').select('*').order('port_number', { ascending: true }),
    supabase
      .from('portal_users')
      .select('id, username, full_name, phone, area, address, package_speed, account_status')
      .eq('role', 'CLIENT')
      .order('full_name', { ascending: true }),
    fetchOnlineSubscribersMap(fallbackActiveUsernames),
  ]);

  const missing =
    (nodesRes.error && isMissingTableOrColumnError(nodesRes.error)) ||
    (cablesRes.error && isMissingTableOrColumnError(cablesRes.error)) ||
    (portsRes.error && isMissingTableOrColumnError(portsRes.error));

  if (missing) {
    return {
      nodes: [],
      cables: [],
      ports: [],
      subscribers: [],
      schemaMissing: true,
    };
  }

  const rawNodes: SupabaseGisNode[] = ((nodesRes.data as any[]) || []).map(normalizeGisNodeRow);
  const rawCables: SupabaseGisCable[] = ((cablesRes.data as any[]) || []).map(normalizeGisCableRow);
  const rawPorts: SupabaseGisFdbPort[] = ((portsRes.data as any[]) || []).map(normalizeGisPortRow);

  const subscribers: GisSubscriberSummary[] = ((subsRes.data as SupabasePortalUser[]) || []).map((u) => {
    const uname = (u.username || '').trim();
    const key = uname.toLowerCase();
    const live = onlineMap[key];
    return {
      id: u.id,
      username: uname,
      fullName: u.full_name || uname,
      phone: u.phone || '',
      area: u.area || '',
      address: u.address || '',
      packageSpeed: u.package_speed || 'Fiber Plan',
      accountStatus: u.account_status || 'ACTIVE',
      isOnline: Boolean(live),
      activeIp: live?.ip,
      activeUptime: live?.uptime,
    };
  });

  return {
    nodes: rawNodes,
    cables: rawCables,
    ports: rawPorts,
    subscribers,
    schemaMissing: false,
  };
}

export async function createGisNode(params: {
  nodeType: GisNodeType;
  name: string;
  areaName?: string;
  lat: number;
  lng: number;
  txPowerDbm?: number;
  splitterType?: GisSplitterType;
  totalPorts?: number;
  trayCapacity?: number;
  updatedBy?: string;
}): Promise<SupabaseGisNode> {
  const splitterType: GisSplitterType =
    params.nodeType === 'FDB_FAT'
      ? params.splitterType || '1:8'
      : 'none';
  const totalPorts =
    params.nodeType === 'FDB_FAT'
      ? params.totalPorts ?? SPLITTER_SPECS[splitterType]?.defaultPorts ?? 8
      : 0;
  const trayCapacity = params.trayCapacity ?? (params.nodeType === 'FOSC_JOINT' ? 12 : 12);

  const payload = {
    node_type: params.nodeType,
    name: params.name.trim(),
    area_name: (params.areaName || '').trim(),
    lat: params.lat,
    lng: params.lng,
    tx_power_dbm: params.txPowerDbm ?? (params.nodeType === 'OLT' ? 5.0 : 0),
    splitter_type: splitterType,
    total_ports: totalPorts,
    tray_capacity: trayCapacity,
    loss_per_splice: 0.08,
    splice_tray_json:
      params.nodeType === 'FOSC_JOINT' ? generateDefaultSpliceTray(trayCapacity) : [],
    updated_by: params.updatedBy || 'admin',
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('gis_nodes')
    .insert(payload)
    .select('*')
    .single();
  if (error) throw error;
  return normalizeGisNodeRow(data);
}

export async function updateGisNode(
  nodeId: string,
  patch: Partial<SupabaseGisNode>
): Promise<SupabaseGisNode> {
  const { data, error } = await supabase
    .from('gis_nodes')
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
    })
    .eq('id', nodeId)
    .select('*')
    .single();
  if (error) throw error;
  return normalizeGisNodeRow(data);
}

export async function deleteGisNode(nodeId: string): Promise<void> {
  const { error } = await supabase.from('gis_nodes').delete().eq('id', nodeId);
  if (error) throw error;
}

export async function createGisCable(params: {
  name?: string;
  sourceNodeId: string;
  targetNodeId: string;
  cableCores: 2 | 4 | 6 | 8 | 12 | 24 | 48;
  routeCoordinates: GisLatLng[];
  updatedBy?: string;
}): Promise<SupabaseGisCable> {
  const distanceMeters = Math.max(1, computePolylineDistanceMeters(params.routeCoordinates));
  const coresJson = generateTia598Cores(params.cableCores);

  const { data, error } = await supabase
    .from('gis_cables')
    .insert({
      name: (params.name || '').trim(),
      source_node_id: params.sourceNodeId,
      target_node_id: params.targetNodeId,
      cable_cores: params.cableCores,
      distance_meters: distanceMeters,
      route_coordinates_json: params.routeCoordinates,
      cores_tia598_json: coresJson,
      updated_by: params.updatedBy || 'admin',
      updated_at: new Date().toISOString(),
    })
    .select('*')
    .single();
  if (error) throw error;
  return normalizeGisCableRow(data);
}

export async function updateGisCable(
  cableId: string,
  patch: Partial<SupabaseGisCable>
): Promise<SupabaseGisCable> {
  const { data, error } = await supabase
    .from('gis_cables')
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
    })
    .eq('id', cableId)
    .select('*')
    .single();
  if (error) throw error;
  return normalizeGisCableRow(data);
}

export async function deleteGisCable(cableId: string): Promise<void> {
  const { error } = await supabase.from('gis_cables').delete().eq('id', cableId);
  if (error) throw error;
}

/**
 * One-click "Split Cable Here (Insert FOSC Joint Box)":
 * Inserts a new FOSC_JOINT node, creates Span A and Span B preserving all TIA-598
 * core color statuses & notes, updates any FDB feed_cable_id referencing the old cable,
 * and deletes the original undivided span.
 */
export async function splitCableWithFoscJoint(params: {
  cable: SupabaseGisCable;
  sourceNode: SupabaseGisNode | undefined;
  targetNode: SupabaseGisNode | undefined;
  splitPoint?: GisLatLng;
  jointName?: string;
  areaName?: string;
  updatedBy?: string;
}): Promise<{
  jointNode: SupabaseGisNode;
  spanA: SupabaseGisCable;
  spanB: SupabaseGisCable;
}> {
  const plan = buildCableSplitPlan(
    params.cable,
    params.sourceNode,
    params.targetNode,
    params.splitPoint
  );

  const label =
    (params.jointName || '').trim() ||
    `FOSC-${params.cable.cable_cores}C-${Math.floor(100 + Math.random() * 900)}`;

  const { data: jointRow, error: jointErr } = await supabase
    .from('gis_nodes')
    .insert({
      node_type: 'FOSC_JOINT',
      name: label,
      area_name: (params.areaName || params.sourceNode?.area_name || params.targetNode?.area_name || '').trim(),
      lat: plan.splitPoint.lat,
      lng: plan.splitPoint.lng,
      tx_power_dbm: 0,
      splitter_type: 'none',
      total_ports: 0,
      tray_capacity: Math.max(2, Math.min(48, params.cable.cable_cores)),
      loss_per_splice: 0.08,
      splice_tray_json: plan.defaultSpliceTray,
      notes: `Split from ${params.cable.name || `${params.sourceNode?.name || 'Start'} → ${params.targetNode?.name || 'End'}`}`,
      updated_by: params.updatedBy || 'admin',
      updated_at: new Date().toISOString(),
    })
    .select('*')
    .single();
  if (jointErr) throw jointErr;
  const jointNode = jointRow as SupabaseGisNode;

  const baseName = params.cable.name || `${params.sourceNode?.name || 'Node'} → ${params.targetNode?.name || 'Node'}`;

  const [spanARes, spanBRes] = await Promise.all([
    supabase
      .from('gis_cables')
      .insert({
        name: `${baseName} (Span A)`,
        source_node_id: params.cable.source_node_id,
        target_node_id: jointNode.id,
        cable_cores: params.cable.cable_cores,
        distance_meters: plan.spanADistanceMeters,
        route_coordinates_json: plan.spanARoute,
        cores_tia598_json: plan.preservedCores,
        notes: params.cable.notes || '',
        updated_by: params.updatedBy || 'admin',
        updated_at: new Date().toISOString(),
      })
      .select('*')
      .single(),
    supabase
      .from('gis_cables')
      .insert({
        name: `${baseName} (Span B)`,
        source_node_id: jointNode.id,
        target_node_id: params.cable.target_node_id,
        cable_cores: params.cable.cable_cores,
        distance_meters: plan.spanBDistanceMeters,
        route_coordinates_json: plan.spanBRoute,
        cores_tia598_json: plan.preservedCores,
        notes: params.cable.notes || '',
        updated_by: params.updatedBy || 'admin',
        updated_at: new Date().toISOString(),
      })
      .select('*')
      .single(),
  ]);

  if (spanARes.error) throw spanARes.error;
  if (spanBRes.error) throw spanBRes.error;

  // If the target node was explicitly pinned to the old cable ID, re-point it to Span B
  if (params.targetNode?.feed_cable_id === params.cable.id) {
    await supabase
      .from('gis_nodes')
      .update({
        feed_cable_id: (spanBRes.data as SupabaseGisCable).id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', params.targetNode.id);
  }

  // Delete the undivided original cable
  await supabase.from('gis_cables').delete().eq('id', params.cable.id);

  return {
    jointNode,
    spanA: spanARes.data as SupabaseGisCable,
    spanB: spanBRes.data as SupabaseGisCable,
  };
}

export async function upsertFdbPortAssignment(params: {
  fdbNodeId: string;
  portNumber: number;
  subscriberId?: string | null;
  subscriberUsername?: string | null;
  clientLabel?: string | null;
  dropCableMeters: number;
  status: GisPortStatus;
}): Promise<SupabaseGisFdbPort> {
  const payload = {
    fdb_node_id: params.fdbNodeId,
    port_number: params.portNumber,
    subscriber_id: params.status === 'FREE' ? null : params.subscriberId || null,
    subscriber_username: params.status === 'FREE' ? '' : (params.subscriberUsername || '').trim(),
    client_label: params.status === 'FREE' ? '' : (params.clientLabel || '').trim(),
    drop_cable_meters: Math.max(0, Math.round(params.dropCableMeters || 0)),
    status: params.status,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('gis_fdb_ports')
    .upsert(payload, { onConflict: 'fdb_node_id,port_number' })
    .select('*')
    .single();
  if (error) throw error;
  return normalizeGisPortRow(data);
}

function numericDiffers(a: number | null | undefined, b: number | null | undefined): boolean {
  const aNull = a === null || a === undefined;
  const bNull = b === null || b === undefined;
  if (aNull !== bNull) return true;
  if (aNull && bNull) return false;
  return Math.abs(Number(a) - Number(b)) > 0.01;
}

/**
 * Persists calculated optical input & ONT RX levels back to gis_nodes in background.
 * Uses a 0.01 dB threshold so cross-client Realtime broadcasts never ping-pong updates.
 */
export async function syncOpticalBudgetsToDb(
  nodes: SupabaseGisNode[],
  cables: SupabaseGisCable[]
): Promise<void> {
  const budgets = calculateTopologyOpticalBudgets(nodes, cables);
  const updates = nodes
    .filter((n) => n.node_type !== 'OLT')
    .map((n) => {
      const b = budgets[n.id];
      if (!b) return null;
      const changed =
        numericDiffers(n.calculated_input_dbm, b.inputDbm) ||
        numericDiffers(n.calculated_ont_rx_dbm, b.ontRxDbm);
      if (!changed) return null;
      return Promise.resolve(
        supabase
          .from('gis_nodes')
          .update({
            calculated_input_dbm: b.inputDbm,
            calculated_ont_rx_dbm: b.ontRxDbm,
          })
          .eq('id', n.id)
      );
    })
    .filter((p): p is Promise<any> => Boolean(p));

  if (updates.length > 0) {
    await Promise.allSettled(updates);
  }
}
