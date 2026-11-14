import {
  supabase,
  OltPonMode,
  OltPonPortStatus,
  OltSfpClass,
  SupabaseGisCable,
  SupabaseGisFdbPort,
  SupabaseGisNode,
  SupabaseGisOlt,
  SupabaseGisOltPonPort,
  SupabaseGisSplitterOutput,
  SupabasePortalUser,
} from './supabaseClient';
import {
  buildCableSplitPlan,
  calculateTopologyOpticalBudgets,
  computePolylineDistanceMeters,
  generateDefaultSpliceTray,
  generateTia598Cores,
  getDefaultMaxOnuLimit,
  getFbtLegOutputs,
  inferSfpClassFromDbm,
  inferSplitterCategory,
  normalizeCableCores,
  SPLITTER_SPECS,
} from '../lib/fiberOpticEngine';
import type {
  GisLatLng,
  GisNodeType,
  GisPortStatus,
  GisSplitterCategory,
  GisSplitterType,
  SplitterUtilizationType,
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
  olts: SupabaseGisOlt[];
  ponPorts: SupabaseGisOltPonPort[];
  nodes: SupabaseGisNode[];
  cables: SupabaseGisCable[];
  ports: SupabaseGisFdbPort[];
  splitterOutputs: SupabaseGisSplitterOutput[];
  subscribers: GisSubscriberSummary[];
  schemaMissing: boolean;
  oltSchemaMissing?: boolean;
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

export function normalizeGisOltRow(o: any): SupabaseGisOlt {
  const totalPon = Number(o.total_pon_ports ?? 8);
  const validTotal: 2 | 4 | 8 | 16 =
    totalPon === 2 || totalPon === 4 || totalPon === 8 || totalPon === 16 ? totalPon : 8;
  return {
    ...o,
    pon_mode: o.pon_mode === 'EPON' ? 'EPON' : 'GPON',
    total_pon_ports: validTotal,
    lat: o.lat !== null && o.lat !== undefined ? Number(o.lat) : null,
    lng: o.lng !== null && o.lng !== undefined ? Number(o.lng) : null,
    status: o.status === 'OFFLINE' ? 'OFFLINE' : 'ONLINE',
  };
}

export function normalizeGisOltPonPortRow(p: any): SupabaseGisOltPonPort {
  const tx = Number(p.tx_power_dbm ?? 5.0);
  const sfp: OltSfpClass =
    p.sfp_class === 'B+' ||
    p.sfp_class === 'C+' ||
    p.sfp_class === 'C++' ||
    p.sfp_class === 'C+++' ||
    p.sfp_class === 'CUSTOM'
      ? p.sfp_class
      : inferSfpClassFromDbm(tx);

  return {
    ...p,
    port_number: Number(p.port_number),
    sfp_class: sfp,
    tx_power_dbm: tx,
    max_onu_limit: Number(p.max_onu_limit ?? 128),
    active_onus: Number(p.active_onus ?? 0),
    status: p.status === 'SPARE' || p.status === 'FAULT' ? p.status : 'ACTIVE',
  };
}

export function normalizeGisNodeRow(n: any): SupabaseGisNode {
  const splitterType = (n.splitter_type || 'none') as GisSplitterType;
  const splitterCategory: GisSplitterCategory =
    n.splitter_category === 'PLC_EQUAL' ||
    n.splitter_category === 'FBT_RATIO' ||
    n.splitter_category === 'NONE'
      ? n.splitter_category
      : inferSplitterCategory(splitterType);

  return {
    ...n,
    lat: Number(n.lat),
    lng: Number(n.lng),
    tx_power_dbm: Number(n.tx_power_dbm ?? 5.0),
    splitter_category: splitterCategory,
    splitter_type: splitterType,
    total_ports: Number(n.total_ports ?? 8),
    tray_capacity: Number(n.tray_capacity ?? 12),
    loss_per_splice: Number(n.loss_per_splice ?? 0.08),
    calculated_input_dbm:
      n.calculated_input_dbm !== null && n.calculated_input_dbm !== undefined
        ? Number(n.calculated_input_dbm)
        : null,
    calculated_output_dbm:
      n.calculated_output_dbm !== null && n.calculated_output_dbm !== undefined
        ? Number(n.calculated_output_dbm)
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
  const rawCores =
    Array.isArray(c.cores_allocation_json) && c.cores_allocation_json.length > 0
      ? c.cores_allocation_json
      : c.cores_tia598_json;
  const normalizedCores = normalizeCableCores(cores, rawCores);
  return {
    ...c,
    cable_cores: cores,
    distance_meters: Number(c.distance_meters ?? 0),
    route_coordinates_json: Array.isArray(c.route_coordinates_json) ? c.route_coordinates_json : [],
    cores_tia598_json: normalizedCores,
    cores_allocation_json: normalizedCores,
  };
}

export function normalizeGisPortRow(p: any): SupabaseGisFdbPort {
  return {
    ...p,
    port_number: Number(p.port_number),
    drop_cable_meters: Number(p.drop_cable_meters ?? 30),
  };
}

export function normalizeGisSplitterOutputRow(r: any): SupabaseGisSplitterOutput {
  const util: SplitterUtilizationType =
    r.utilization_type === 'CLIENT_ONT' ||
    r.utilization_type === 'DOWNSTREAM_AREA_FEED' ||
    r.utilization_type === 'CASCADED_SPLITTER' ||
    r.utilization_type === 'FAULTY'
      ? r.utilization_type
      : 'FREE_PORT';
  return {
    ...r,
    port_number: Number(r.port_number ?? 1),
    utilization_type: util,
    drop_distance_m: Number(r.drop_distance_m ?? 0),
    estimated_rx_dbm:
      r.estimated_rx_dbm !== null && r.estimated_rx_dbm !== undefined
        ? Number(r.estimated_rx_dbm)
        : null,
  };
}

export function applyRealtimeOltDelta(
  current: SupabaseGisOlt[],
  eventType: GisRealtimeEventType,
  newRow?: any,
  oldRow?: any
): SupabaseGisOlt[] {
  if (eventType === 'DELETE') {
    const targetId = oldRow?.id;
    if (!targetId) return current;
    return current.filter((o) => o.id !== targetId);
  }
  if (!newRow?.id) return current;
  const normalized = normalizeGisOltRow(newRow);
  const idx = current.findIndex((o) => o.id === normalized.id);
  if (idx === -1) return [...current, normalized];
  const next = current.slice();
  next[idx] = normalized;
  return next;
}

export function applyRealtimePonPortDelta(
  current: SupabaseGisOltPonPort[],
  eventType: GisRealtimeEventType,
  newRow?: any,
  oldRow?: any
): SupabaseGisOltPonPort[] {
  if (eventType === 'DELETE') {
    const targetId = oldRow?.id;
    if (!targetId) return current;
    return current.filter((p) => p.id !== targetId);
  }
  if (!newRow?.id) return current;
  const normalized = normalizeGisOltPonPortRow(newRow);
  const idx = current.findIndex(
    (p) =>
      p.id === normalized.id ||
      (p.olt_id === normalized.olt_id && p.port_number === normalized.port_number)
  );
  if (idx === -1) {
    return [...current, normalized].sort((a, b) => a.port_number - b.port_number);
  }
  const next = current.slice();
  next[idx] = normalized;
  return next.sort((a, b) => a.port_number - b.port_number);
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

export function applyRealtimeSplitterOutputDelta(
  current: SupabaseGisSplitterOutput[],
  eventType: GisRealtimeEventType,
  newRow?: any,
  oldRow?: any
): SupabaseGisSplitterOutput[] {
  if (eventType === 'DELETE') {
    const targetId = oldRow?.id;
    if (!targetId) return current;
    return current.filter((o) => o.id !== targetId);
  }
  if (!newRow?.id) return current;
  const normalized = normalizeGisSplitterOutputRow(newRow);
  const idx = current.findIndex(
    (o) =>
      o.id === normalized.id ||
      (o.node_id === normalized.node_id && o.port_number === normalized.port_number)
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
 * gis_olts, gis_olt_pon_ports, gis_nodes, gis_cables, gis_fdb_ports, and gis_splitter_outputs.
 */
export function subscribeToGisRealtime(handlers: {
  onOltDelta?: (eventType: GisRealtimeEventType, newRow?: any, oldRow?: any) => void;
  onPonPortDelta?: (eventType: GisRealtimeEventType, newRow?: any, oldRow?: any) => void;
  onNodeDelta: (eventType: GisRealtimeEventType, newRow?: any, oldRow?: any) => void;
  onCableDelta: (eventType: GisRealtimeEventType, newRow?: any, oldRow?: any) => void;
  onPortDelta: (eventType: GisRealtimeEventType, newRow?: any, oldRow?: any) => void;
  onSplitterOutputDelta?: (eventType: GisRealtimeEventType, newRow?: any, oldRow?: any) => void;
  onStatusChange?: (status: GisRealtimeConnectionStatus) => void;
}): () => void {
  handlers.onStatusChange?.('CONNECTING');

  const channelName = `fiber-gis-realtime-${Math.random().toString(36).slice(2, 8)}`;
  let channel = supabase.channel(channelName);

  if (handlers.onOltDelta) {
    channel = channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'gis_olts' },
      (payload) => {
        handlers.onOltDelta?.(
          payload.eventType as GisRealtimeEventType,
          payload.new,
          payload.old
        );
      }
    );
  }

  if (handlers.onPonPortDelta) {
    channel = channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'gis_olt_pon_ports' },
      (payload) => {
        handlers.onPonPortDelta?.(
          payload.eventType as GisRealtimeEventType,
          payload.new,
          payload.old
        );
      }
    );
  }

  if (handlers.onSplitterOutputDelta) {
    channel = channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'gis_splitter_outputs' },
      (payload) => {
        handlers.onSplitterOutputDelta?.(
          payload.eventType as GisRealtimeEventType,
          payload.new,
          payload.old
        );
      }
    );
  }

  channel = channel
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

export async function loadGisOltsOnly(): Promise<{
  olts: SupabaseGisOlt[];
  ponPorts: SupabaseGisOltPonPort[];
  nodes: SupabaseGisNode[];
  schemaMissing: boolean;
}> {
  const [oltsRes, ponPortsRes, nodesRes] = await Promise.all([
    supabase.from('gis_olts').select('*').order('created_at', { ascending: true }),
    supabase.from('gis_olt_pon_ports').select('*').order('port_number', { ascending: true }),
    supabase.from('gis_nodes').select('*').eq('node_type', 'OLT'),
  ]);

  const missing =
    (oltsRes.error && isMissingTableOrColumnError(oltsRes.error)) ||
    (ponPortsRes.error && isMissingTableOrColumnError(ponPortsRes.error));

  return {
    olts: oltsRes.error ? [] : ((oltsRes.data as any[]) || []).map(normalizeGisOltRow),
    ponPorts: ponPortsRes.error
      ? []
      : ((ponPortsRes.data as any[]) || []).map(normalizeGisOltPonPortRow),
    nodes: nodesRes.error ? [] : ((nodesRes.data as any[]) || []).map(normalizeGisNodeRow),
    schemaMissing: Boolean(missing),
  };
}

export async function loadGisTopology(
  fallbackActiveUsernames: string[] = []
): Promise<LoadedGisTopology> {
  const [oltsRes, ponPortsRes, nodesRes, cablesRes, portsRes, outputsRes, subsRes, onlineMap] =
    await Promise.all([
      supabase.from('gis_olts').select('*').order('created_at', { ascending: true }),
      supabase.from('gis_olt_pon_ports').select('*').order('port_number', { ascending: true }),
      supabase.from('gis_nodes').select('*').order('created_at', { ascending: true }),
      supabase.from('gis_cables').select('*').order('created_at', { ascending: true }),
      supabase.from('gis_fdb_ports').select('*').order('port_number', { ascending: true }),
      supabase.from('gis_splitter_outputs').select('*').order('port_number', { ascending: true }),
      supabase
        .from('portal_users')
        .select('id, username, full_name, phone, area, address, package_speed, account_status')
        .eq('role', 'CLIENT')
        .order('full_name', { ascending: true }),
      fetchOnlineSubscribersMap(fallbackActiveUsernames),
    ]);

  const baseMissing =
    (nodesRes.error && isMissingTableOrColumnError(nodesRes.error)) ||
    (cablesRes.error && isMissingTableOrColumnError(cablesRes.error)) ||
    (portsRes.error && isMissingTableOrColumnError(portsRes.error));

  const oltSchemaMissing =
    (oltsRes.error && isMissingTableOrColumnError(oltsRes.error)) ||
    (ponPortsRes.error && isMissingTableOrColumnError(ponPortsRes.error));

  const splitterSchemaMissing =
    outputsRes.error && isMissingTableOrColumnError(outputsRes.error);

  if (baseMissing) {
    return {
      olts: [],
      ponPorts: [],
      nodes: [],
      cables: [],
      ports: [],
      splitterOutputs: [],
      subscribers: [],
      schemaMissing: true,
      oltSchemaMissing: true,
    };
  }

  const rawOlts: SupabaseGisOlt[] = oltsRes.error
    ? []
    : ((oltsRes.data as any[]) || []).map(normalizeGisOltRow);
  const rawPonPorts: SupabaseGisOltPonPort[] = ponPortsRes.error
    ? []
    : ((ponPortsRes.data as any[]) || []).map(normalizeGisOltPonPortRow);
  const rawNodes: SupabaseGisNode[] = ((nodesRes.data as any[]) || []).map(normalizeGisNodeRow);
  const rawCables: SupabaseGisCable[] = ((cablesRes.data as any[]) || []).map(normalizeGisCableRow);
  const rawPorts: SupabaseGisFdbPort[] = ((portsRes.data as any[]) || []).map(normalizeGisPortRow);
  const rawOutputs: SupabaseGisSplitterOutput[] = outputsRes.error
    ? []
    : ((outputsRes.data as any[]) || []).map(normalizeGisSplitterOutputRow);

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
    olts: rawOlts,
    ponPorts: rawPonPorts,
    nodes: rawNodes,
    cables: rawCables,
    ports: rawPorts,
    splitterOutputs: rawOutputs,
    subscribers,
    schemaMissing: Boolean(baseMissing || oltSchemaMissing || splitterSchemaMissing),
    oltSchemaMissing: Boolean(oltSchemaMissing),
  };
}

export interface PonPortDraftInput {
  port_number: number;
  port_label: string;
  sfp_class: OltSfpClass;
  tx_power_dbm: number;
  active_onus?: number;
  status: OltPonPortStatus;
}

/**
 * Creates or updates an OLT in `gis_olts`, synchronizes `PON 1..N` rows in `gis_olt_pon_ports`,
 * and creates/updates the companion `gis_nodes` map marker if lat/lng coordinates exist.
 */
export async function saveOltWithPonPorts(params: {
  oltId?: string;
  name: string;
  vendorModel: string;
  ponMode: OltPonMode;
  totalPonPorts: 2 | 4 | 8 | 16;
  mgmtIp: string;
  areaName: string;
  lat: number | null;
  lng: number | null;
  status: 'ONLINE' | 'OFFLINE';
  notes?: string;
  ports: PonPortDraftInput[];
  updatedBy?: string;
}): Promise<{
  olt: SupabaseGisOlt;
  ponPorts: SupabaseGisOltPonPort[];
  mapNode: SupabaseGisNode | null;
}> {
  const nowIso = new Date().toISOString();
  const oltPayload = {
    name: params.name.trim(),
    vendor_model: params.vendorModel.trim() || 'VSOL V1600G1',
    pon_mode: params.ponMode,
    total_pon_ports: params.totalPonPorts,
    mgmt_ip: params.mgmtIp.trim(),
    area_name: params.areaName.trim(),
    lat: params.lat !== null && Number.isFinite(params.lat) ? params.lat : null,
    lng: params.lng !== null && Number.isFinite(params.lng) ? params.lng : null,
    status: params.status,
    notes: (params.notes || '').trim(),
    updated_at: nowIso,
  };

  let savedOltRaw: any;
  if (params.oltId) {
    const { data, error } = await supabase
      .from('gis_olts')
      .update(oltPayload)
      .eq('id', params.oltId)
      .select('*')
      .single();
    if (error) throw error;
    savedOltRaw = data;
  } else {
    const { data, error } = await supabase
      .from('gis_olts')
      .insert({ ...oltPayload, created_at: nowIso })
      .select('*')
      .single();
    if (error) throw error;
    savedOltRaw = data;
  }

  const olt = normalizeGisOltRow(savedOltRaw);
  const maxOnu = getDefaultMaxOnuLimit(params.ponMode);

  // Build normalized PON 1..N payloads
  const portRows: Array<Record<string, any>> = [];
  for (let num = 1; num <= params.totalPonPorts; num++) {
    const draft = params.ports.find((p) => p.port_number === num);
    const tx = Math.max(-5, Math.min(12, Number(draft?.tx_power_dbm ?? 5.0)));
    const sfpClass = draft?.sfp_class || inferSfpClassFromDbm(tx);
    portRows.push({
      olt_id: olt.id,
      port_number: num,
      port_label: (draft?.port_label || '').trim() || `PON-${num}`,
      sfp_class: sfpClass,
      tx_power_dbm: tx,
      max_onu_limit: maxOnu,
      active_onus: Math.max(0, Number(draft?.active_onus ?? 0)),
      status: draft?.status || 'ACTIVE',
      updated_at: nowIso,
    });
  }

  // Delete any ports > total_pon_ports if reduced
  await supabase
    .from('gis_olt_pon_ports')
    .delete()
    .eq('olt_id', olt.id)
    .gt('port_number', params.totalPonPorts);

  const { data: upsertedPorts, error: portErr } = await supabase
    .from('gis_olt_pon_ports')
    .upsert(portRows, { onConflict: 'olt_id,port_number' })
    .select('*');
  if (portErr) throw portErr;

  const ponPorts = ((upsertedPorts as any[]) || [])
    .map(normalizeGisOltPonPortRow)
    .sort((a, b) => a.port_number - b.port_number);

  // Synchronize companion GIS Map Marker node if coordinates are provided
  let mapNode: SupabaseGisNode | null = null;
  const leadTx = ponPorts[0]?.tx_power_dbm ?? 5.0;

  if (olt.lat !== null && olt.lat !== undefined && olt.lng !== null && olt.lng !== undefined) {
    const { data: existingNode } = await supabase
      .from('gis_nodes')
      .select('*')
      .eq('olt_id', olt.id)
      .maybeSingle();

    if (existingNode?.id) {
      const { data: updatedNode, error: nodeUpdErr } = await supabase
        .from('gis_nodes')
        .update({
          name: olt.name,
          area_name: olt.area_name || '',
          lat: olt.lat,
          lng: olt.lng,
          tx_power_dbm: leadTx,
          updated_by: params.updatedBy || 'admin',
          updated_at: nowIso,
        })
        .eq('id', existingNode.id)
        .select('*')
        .single();
      if (nodeUpdErr) throw nodeUpdErr;
      mapNode = normalizeGisNodeRow(updatedNode);
    } else {
      const { data: createdNode, error: nodeInsErr } = await supabase
        .from('gis_nodes')
        .insert({
          node_type: 'OLT',
          olt_id: olt.id,
          name: olt.name,
          area_name: olt.area_name || '',
          lat: olt.lat,
          lng: olt.lng,
          tx_power_dbm: leadTx,
          splitter_type: 'none',
          total_ports: 0,
          tray_capacity: 12,
          loss_per_splice: 0.08,
          splice_tray_json: [],
          notes: `${olt.pon_mode} · ${olt.total_pon_ports} PON Ports · ${olt.mgmt_ip || ''}`,
          updated_by: params.updatedBy || 'admin',
          updated_at: nowIso,
        })
        .select('*')
        .single();
      if (nodeInsErr) throw nodeInsErr;
      mapNode = normalizeGisNodeRow(createdNode);
    }
  }

  return { olt, ponPorts, mapNode };
}

export async function updateOltPonPort(
  portId: string,
  patch: Partial<SupabaseGisOltPonPort>
): Promise<SupabaseGisOltPonPort> {
  const clampedTx =
    patch.tx_power_dbm !== undefined
      ? Math.max(-5, Math.min(12, Number(patch.tx_power_dbm)))
      : undefined;
  const resolvedSfp =
    patch.sfp_class || (clampedTx !== undefined ? inferSfpClassFromDbm(clampedTx) : undefined);

  const { data, error } = await supabase
    .from('gis_olt_pon_ports')
    .update({
      ...patch,
      ...(clampedTx !== undefined ? { tx_power_dbm: clampedTx } : {}),
      ...(resolvedSfp ? { sfp_class: resolvedSfp } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', portId)
    .select('*')
    .single();
  if (error) throw error;
  return normalizeGisOltPonPortRow(data);
}

/**
 * Places an unplaced OLT on the GIS Map OR drags/moves an existing OLT marker to new GPS coordinates,
 * persisting lat/lng to both `gis_olts` and its companion `gis_nodes` pin.
 */
export async function placeOrMoveOltOnMap(params: {
  olt: SupabaseGisOlt;
  lat: number;
  lng: number;
  defaultTxPowerDbm?: number;
  updatedBy?: string;
}): Promise<{ olt: SupabaseGisOlt; mapNode: SupabaseGisNode }> {
  const nowIso = new Date().toISOString();
  const { data: updatedOlt, error: oltErr } = await supabase
    .from('gis_olts')
    .update({
      lat: params.lat,
      lng: params.lng,
      updated_at: nowIso,
    })
    .eq('id', params.olt.id)
    .select('*')
    .single();
  if (oltErr) throw oltErr;

  const { data: existingNode } = await supabase
    .from('gis_nodes')
    .select('*')
    .eq('olt_id', params.olt.id)
    .maybeSingle();

  let savedNode: any;
  if (existingNode?.id) {
    const { data: upd, error: updErr } = await supabase
      .from('gis_nodes')
      .update({
        lat: params.lat,
        lng: params.lng,
        updated_by: params.updatedBy || 'admin',
        updated_at: nowIso,
      })
      .eq('id', existingNode.id)
      .select('*')
      .single();
    if (updErr) throw updErr;
    savedNode = upd;
  } else {
    const { data: ins, error: insErr } = await supabase
      .from('gis_nodes')
      .insert({
        node_type: 'OLT',
        olt_id: params.olt.id,
        name: params.olt.name,
        area_name: params.olt.area_name || '',
        lat: params.lat,
        lng: params.lng,
        tx_power_dbm: params.defaultTxPowerDbm ?? 5.0,
        splitter_type: 'none',
        total_ports: 0,
        tray_capacity: 12,
        loss_per_splice: 0.08,
        splice_tray_json: [],
        updated_by: params.updatedBy || 'admin',
        updated_at: nowIso,
      })
      .select('*')
      .single();
    if (insErr) throw insErr;
    savedNode = ins;
  }

  return {
    olt: normalizeGisOltRow(updatedOlt),
    mapNode: normalizeGisNodeRow(savedNode),
  };
}

export async function deleteOltById(oltId: string): Promise<void> {
  // Remove linked GIS nodes explicitly as well as cascading via FK
  await supabase.from('gis_nodes').delete().eq('olt_id', oltId);
  const { error } = await supabase.from('gis_olts').delete().eq('id', oltId);
  if (error) throw error;
}

export async function createGisNode(params: {
  nodeType: GisNodeType;
  name: string;
  areaName?: string;
  lat: number;
  lng: number;
  txPowerDbm?: number;
  splitterCategory?: GisSplitterCategory;
  splitterType?: GisSplitterType;
  totalPorts?: number;
  trayCapacity?: number;
  feedCorePair?: string;
  ponPortId?: string | null;
  ponMode?: OltPonMode;
  totalPonPorts?: 2 | 4 | 8 | 16;
  vendorModel?: string;
  mgmtIp?: string;
  sfpClass?: OltSfpClass;
  updatedBy?: string;
}): Promise<{
  node: SupabaseGisNode;
  olt?: SupabaseGisOlt;
  ponPorts?: SupabaseGisOltPonPort[];
}> {
  if (params.nodeType === 'OLT') {
    const mode: OltPonMode = params.ponMode || 'GPON';
    const portCount: 2 | 4 | 8 | 16 = params.totalPonPorts || 8;
    const tx = Math.max(-5, Math.min(12, Number(params.txPowerDbm ?? 5.0)));
    const sfpClass = params.sfpClass || inferSfpClassFromDbm(tx);

    try {
      const ports: PonPortDraftInput[] = Array.from({ length: portCount }, (_, idx) => ({
        port_number: idx + 1,
        port_label: `PON-${idx + 1}`,
        sfp_class: sfpClass,
        tx_power_dbm: tx,
        active_onus: 0,
        status: 'ACTIVE',
      }));
      const saved = await saveOltWithPonPorts({
        name: params.name,
        vendorModel: params.vendorModel || 'VSOL V1600G1',
        ponMode: mode,
        totalPonPorts: portCount,
        mgmtIp: params.mgmtIp || '',
        areaName: params.areaName || '',
        lat: params.lat,
        lng: params.lng,
        status: 'ONLINE',
        ports,
        updatedBy: params.updatedBy,
      });
      if (saved.mapNode) {
        return { node: saved.mapNode, olt: saved.olt, ponPorts: saved.ponPorts };
      }
    } catch {
      // Fall back to direct gis_nodes insert if gis_olts migration hasn't been applied yet
    }
  }

  const splitterType: GisSplitterType =
    params.splitterType || (params.nodeType === 'FDB_FAT' ? '1:8' : 'none');
  const splitterCategory: GisSplitterCategory =
    params.splitterCategory || inferSplitterCategory(splitterType);
  const totalPorts =
    splitterType !== 'none'
      ? params.totalPorts ?? SPLITTER_SPECS[splitterType]?.defaultPorts ?? 8
      : params.nodeType === 'FDB_FAT'
      ? params.totalPorts ?? 8
      : 0;
  const trayCapacity = params.trayCapacity ?? 12;

  const fullPayload: Record<string, any> = {
    node_type: params.nodeType,
    name: params.name.trim(),
    area_name: (params.areaName || '').trim(),
    lat: params.lat,
    lng: params.lng,
    tx_power_dbm: params.txPowerDbm ?? (params.nodeType === 'OLT' ? 5.0 : 0),
    splitter_category: splitterCategory,
    splitter_type: splitterType,
    total_ports: totalPorts,
    tray_capacity: trayCapacity,
    loss_per_splice: 0.08,
    splice_tray_json:
      params.nodeType === 'FOSC_JOINT' || params.nodeType === 'DIST_NODE'
        ? generateDefaultSpliceTray(trayCapacity)
        : [],
    feed_core_pair: (params.feedCorePair || '').trim(),
    pon_port_id: params.ponPortId || null,
    updated_by: params.updatedBy || 'admin',
    updated_at: new Date().toISOString(),
  };

  let res = await supabase.from('gis_nodes').insert(fullPayload).select('*').single();
  if (res.error && isMissingTableOrColumnError(res.error)) {
    const legacyPayload = { ...fullPayload };
    delete legacyPayload.splitter_category;
    delete legacyPayload.feed_core_pair;
    delete legacyPayload.pon_port_id;
    res = await supabase.from('gis_nodes').insert(legacyPayload).select('*').single();
  }
  if (res.error) throw res.error;
  return { node: normalizeGisNodeRow(res.data) };
}

export async function updateGisNode(
  nodeId: string,
  patch: Partial<SupabaseGisNode>
): Promise<SupabaseGisNode> {
  const payload: Record<string, any> = {
    ...patch,
    updated_at: new Date().toISOString(),
  };
  if (patch.splitter_type && !patch.splitter_category) {
    payload.splitter_category = inferSplitterCategory(patch.splitter_type);
  }

  let res = await supabase
    .from('gis_nodes')
    .update(payload)
    .eq('id', nodeId)
    .select('*')
    .single();

  if (res.error && isMissingTableOrColumnError(res.error)) {
    const legacyPayload = { ...payload };
    delete legacyPayload.splitter_category;
    delete legacyPayload.feed_core_pair;
    delete legacyPayload.pon_port_id;
    delete legacyPayload.calculated_output_dbm;
    res = await supabase
      .from('gis_nodes')
      .update(legacyPayload)
      .eq('id', nodeId)
      .select('*')
      .single();
  }

  if (res.error) throw res.error;
  const normalized = normalizeGisNodeRow(res.data);

  // Sync lat/lng/name back to gis_olts when an OLT marker moves or edits
  if (normalized.node_type === 'OLT' && normalized.olt_id) {
    await supabase
      .from('gis_olts')
      .update({
        name: normalized.name,
        area_name: normalized.area_name || '',
        lat: normalized.lat,
        lng: normalized.lng,
        updated_at: new Date().toISOString(),
      })
      .eq('id', normalized.olt_id);
  }

  return normalized;
}

export async function deleteGisNode(nodeId: string): Promise<void> {
  const { error } = await supabase.from('gis_nodes').delete().eq('id', nodeId);
  if (error) throw error;
}

export async function createGisCable(params: {
  name?: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourceOltId?: string | null;
  sourcePonPortId?: string | null;
  cableCores: 2 | 4 | 6 | 8 | 12 | 24 | 48;
  routeCoordinates: GisLatLng[];
  initialCores?: ReturnType<typeof generateTia598Cores>;
  updatedBy?: string;
}): Promise<SupabaseGisCable> {
  const distanceMeters = Math.max(1, computePolylineDistanceMeters(params.routeCoordinates));
  const coresJson = params.initialCores || generateTia598Cores(params.cableCores);

  const insertPayload: Record<string, any> = {
    name: (params.name || '').trim(),
    source_node_id: params.sourceNodeId,
    target_node_id: params.targetNodeId,
    cable_cores: params.cableCores,
    distance_meters: distanceMeters,
    route_coordinates_json: params.routeCoordinates,
    cores_tia598_json: coresJson,
    cores_allocation_json: coresJson,
    updated_by: params.updatedBy || 'admin',
    updated_at: new Date().toISOString(),
  };

  if (params.sourceOltId) insertPayload.source_olt_id = params.sourceOltId;
  if (params.sourcePonPortId) insertPayload.source_pon_port_id = params.sourcePonPortId;

  let res = await supabase.from('gis_cables').insert(insertPayload).select('*').single();
  if (res.error && isMissingTableOrColumnError(res.error)) {
    const legacy = { ...insertPayload };
    delete legacy.cores_allocation_json;
    res = await supabase.from('gis_cables').insert(legacy).select('*').single();
  }
  if (res.error) throw res.error;
  return normalizeGisCableRow(res.data);
}

export async function updateGisCable(
  cableId: string,
  patch: Partial<SupabaseGisCable>
): Promise<SupabaseGisCable> {
  const payload: Record<string, any> = {
    ...patch,
    updated_at: new Date().toISOString(),
  };
  const coresPayload = patch.cores_allocation_json || patch.cores_tia598_json;
  if (coresPayload) {
    payload.cores_tia598_json = coresPayload;
    payload.cores_allocation_json = coresPayload;
  }

  let res = await supabase
    .from('gis_cables')
    .update(payload)
    .eq('id', cableId)
    .select('*')
    .single();
  if (res.error && isMissingTableOrColumnError(res.error)) {
    const legacy = { ...payload };
    delete legacy.cores_allocation_json;
    res = await supabase
      .from('gis_cables')
      .update(legacy)
      .eq('id', cableId)
      .select('*')
      .single();
  }
  if (res.error) throw res.error;
  return normalizeGisCableRow(res.data);
}

export async function deleteGisCable(cableId: string): Promise<void> {
  const { error } = await supabase.from('gis_cables').delete().eq('id', cableId);
  if (error) throw error;
}

/**
 * One-click "Split Cable Here (Insert FOSC Joint Box)":
 * Inserts a new FOSC_JOINT node, creates Span A (retaining OLT/PON port binding) and Span B
 * preserving all TIA-598 core color statuses, origin lineage & notes, and deletes the original undivided span.
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
  const jointNode = normalizeGisNodeRow(jointRow);

  const baseName = params.cable.name || `${params.sourceNode?.name || 'Node'} → ${params.targetNode?.name || 'Node'}`;

  const spanAInsert: Record<string, any> = {
    name: `${baseName} (Span A)`,
    source_node_id: params.cable.source_node_id,
    target_node_id: jointNode.id,
    cable_cores: params.cable.cable_cores,
    distance_meters: plan.spanADistanceMeters,
    route_coordinates_json: plan.spanARoute,
    cores_tia598_json: plan.preservedCores,
    cores_allocation_json: plan.preservedCores,
    notes: params.cable.notes || '',
    updated_by: params.updatedBy || 'admin',
    updated_at: new Date().toISOString(),
  };
  if (params.cable.source_olt_id) spanAInsert.source_olt_id = params.cable.source_olt_id;
  if (params.cable.source_pon_port_id) spanAInsert.source_pon_port_id = params.cable.source_pon_port_id;

  const spanBInsert: Record<string, any> = {
    name: `${baseName} (Span B)`,
    source_node_id: jointNode.id,
    target_node_id: params.cable.target_node_id,
    cable_cores: params.cable.cable_cores,
    distance_meters: plan.spanBDistanceMeters,
    route_coordinates_json: plan.spanBRoute,
    cores_tia598_json: plan.preservedCores,
    cores_allocation_json: plan.preservedCores,
    notes: params.cable.notes || '',
    updated_by: params.updatedBy || 'admin',
    updated_at: new Date().toISOString(),
  };
  if (params.cable.source_olt_id) spanBInsert.source_olt_id = params.cable.source_olt_id;
  if (params.cable.source_pon_port_id) spanBInsert.source_pon_port_id = params.cable.source_pon_port_id;

  let [spanARes, spanBRes] = await Promise.all([
    supabase.from('gis_cables').insert(spanAInsert).select('*').single(),
    supabase.from('gis_cables').insert(spanBInsert).select('*').single(),
  ]);

  if (
    (spanARes.error && isMissingTableOrColumnError(spanARes.error)) ||
    (spanBRes.error && isMissingTableOrColumnError(spanBRes.error))
  ) {
    delete spanAInsert.cores_allocation_json;
    delete spanBInsert.cores_allocation_json;
    [spanARes, spanBRes] = await Promise.all([
      supabase.from('gis_cables').insert(spanAInsert).select('*').single(),
      supabase.from('gis_cables').insert(spanBInsert).select('*').single(),
    ]);
  }

  if (spanARes.error) throw spanARes.error;
  if (spanBRes.error) throw spanBRes.error;

  if (params.targetNode?.feed_cable_id === params.cable.id) {
    await supabase
      .from('gis_nodes')
      .update({
        feed_cable_id: (spanBRes.data as SupabaseGisCable).id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', params.targetNode.id);
  }

  await supabase.from('gis_cables').delete().eq('id', params.cable.id);

  return {
    jointNode,
    spanA: normalizeGisCableRow(spanARes.data),
    spanB: normalizeGisCableRow(spanBRes.data),
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

/**
 * Upserts a splitter output leg / port into `gis_splitter_outputs` and mirrors
 * subscriber / free / faulty status to `gis_fdb_ports` if the parent node is FDB_FAT.
 */
export async function upsertSplitterOutput(params: {
  nodeId: string;
  nodeType?: GisNodeType;
  portNumber: number;
  legLabel?: string | null;
  utilizationType: SplitterUtilizationType;
  subscriberId?: string | null;
  subscriberUsername?: string | null;
  clientNameManual?: string | null;
  targetAreaOrNode?: string | null;
  dropDistanceMeters?: number;
  estimatedRxDbm?: number | null;
}): Promise<{
  output: SupabaseGisSplitterOutput;
  fdbPort?: SupabaseGisFdbPort | null;
}> {
  const nowIso = new Date().toISOString();
  const isFree = params.utilizationType === 'FREE_PORT';
  const payload = {
    node_id: params.nodeId,
    port_number: params.portNumber,
    leg_label: (params.legLabel || `Port ${params.portNumber}`).trim(),
    utilization_type: params.utilizationType,
    subscriber_id:
      params.utilizationType === 'CLIENT_ONT' && params.subscriberId ? params.subscriberId : null,
    subscriber_username:
      params.utilizationType === 'CLIENT_ONT' ? (params.subscriberUsername || '').trim() : '',
    client_name_manual:
      params.utilizationType === 'CLIENT_ONT' ? (params.clientNameManual || '').trim() : '',
    target_area_or_node: isFree ? '' : (params.targetAreaOrNode || '').trim(),
    drop_distance_m: isFree ? 0 : Math.max(0, Math.round(params.dropDistanceMeters || 0)),
    estimated_rx_dbm:
      params.estimatedRxDbm !== undefined && params.estimatedRxDbm !== null
        ? Number(params.estimatedRxDbm)
        : null,
    updated_at: nowIso,
  };

  const { data, error } = await supabase
    .from('gis_splitter_outputs')
    .upsert(payload, { onConflict: 'node_id,port_number' })
    .select('*')
    .single();
  if (error) throw error;

  let mirroredPort: SupabaseGisFdbPort | null = null;
  if (!params.nodeType || params.nodeType === 'FDB_FAT') {
    const mappedStatus: GisPortStatus =
      params.utilizationType === 'FREE_PORT'
        ? 'FREE'
        : params.utilizationType === 'FAULTY'
        ? 'FAULTY'
        : 'ACTIVE';
    const mappedLabel =
      params.utilizationType === 'CLIENT_ONT'
        ? params.clientNameManual || (params.subscriberUsername ? `@${params.subscriberUsername}` : '')
        : params.utilizationType === 'DOWNSTREAM_AREA_FEED' ||
          params.utilizationType === 'CASCADED_SPLITTER'
        ? `Feed -> ${params.targetAreaOrNode || 'Downstream'}`
        : '';

    try {
      mirroredPort = await upsertFdbPortAssignment({
        fdbNodeId: params.nodeId,
        portNumber: params.portNumber,
        subscriberId:
          params.utilizationType === 'CLIENT_ONT' ? params.subscriberId || null : null,
        subscriberUsername:
          params.utilizationType === 'CLIENT_ONT' ? params.subscriberUsername || '' : '',
        clientLabel: mappedLabel,
        dropCableMeters: params.dropDistanceMeters || 0,
        status: mappedStatus,
      });
    } catch {
      // ignore if node isn't an FDB_FAT or mirror fails
    }
  }

  return {
    output: normalizeGisSplitterOutputRow(data),
    fdbPort: mirroredPort,
  };
}

/**
 * Generates or synchronizes splitter output legs for PLC (Port 1..N) or FBT Ratio
 * (Leg 1 Drop X% + Leg 2 Through Y%) on any FAT, FOSC Joint, or Distribution Node.
 */
export async function initializeSplitterOutputsForNode(params: {
  node: SupabaseGisNode;
  splitterType: GisSplitterType;
  totalPorts?: number;
  inputDbm?: number | null;
  existingOutputs?: SupabaseGisSplitterOutput[];
}): Promise<SupabaseGisSplitterOutput[]> {
  const spec = SPLITTER_SPECS[params.splitterType] || SPLITTER_SPECS['none'];
  if (spec.type === 'none') {
    await supabase.from('gis_splitter_outputs').delete().eq('node_id', params.node.id);
    return [];
  }

  const nowIso = new Date().toISOString();
  const count = spec.isAsymmetricFbt
    ? 2
    : Math.max(1, Math.min(32, params.totalPorts || spec.defaultPorts || 8));

  const existingByPort: Record<number, SupabaseGisSplitterOutput> = {};
  for (const o of params.existingOutputs || []) {
    existingByPort[o.port_number] = o;
  }

  const fbtLegs = spec.isAsymmetricFbt
    ? getFbtLegOutputs(params.inputDbm ?? null, spec.type, params.node.loss_per_splice || 0.08)
    : null;

  const plcRx =
    params.inputDbm !== null && params.inputDbm !== undefined
      ? Math.round((Number(params.inputDbm) - spec.dropLossDb - (params.node.loss_per_splice || 0.08)) * 100) /
        100
      : null;

  const rows: Array<Record<string, any>> = [];
  for (let p = 1; p <= count; p++) {
    const prev = existingByPort[p];
    let legLabel = `Port ${p}`;
    let defaultUtil: SplitterUtilizationType = prev?.utilization_type || 'FREE_PORT';
    let estRx: number | null = plcRx;

    if (spec.isAsymmetricFbt && fbtLegs) {
      if (p === 1) {
        legLabel = `Leg 1 · Drop (${fbtLegs.dropPercent}%)`;
        estRx = fbtLegs.dropOutputDbm;
      } else {
        legLabel = `Leg 2 · Through (${fbtLegs.thruPercent}%)`;
        estRx = fbtLegs.thruOutputDbm;
        if (!prev) defaultUtil = 'DOWNSTREAM_AREA_FEED';
      }
    }

    rows.push({
      node_id: params.node.id,
      port_number: p,
      leg_label: legLabel,
      utilization_type: defaultUtil,
      subscriber_id: defaultUtil === 'CLIENT_ONT' ? prev?.subscriber_id || null : null,
      subscriber_username: defaultUtil === 'CLIENT_ONT' ? prev?.subscriber_username || '' : '',
      client_name_manual: defaultUtil === 'CLIENT_ONT' ? prev?.client_name_manual || '' : '',
      target_area_or_node: prev?.target_area_or_node || '',
      drop_distance_m: prev?.drop_distance_m ?? 0,
      estimated_rx_dbm: estRx,
      updated_at: nowIso,
    });
  }

  await supabase
    .from('gis_splitter_outputs')
    .delete()
    .eq('node_id', params.node.id)
    .gt('port_number', count);

  const { data, error } = await supabase
    .from('gis_splitter_outputs')
    .upsert(rows, { onConflict: 'node_id,port_number' })
    .select('*');
  if (error) throw error;

  return ((data as any[]) || [])
    .map(normalizeGisSplitterOutputRow)
    .sort((a, b) => a.port_number - b.port_number);
}

function numericDiffers(a: number | null | undefined, b: number | null | undefined): boolean {
  const aNull = a === null || a === undefined;
  const bNull = b === null || b === undefined;
  if (aNull !== bNull) return true;
  if (aNull && bNull) return false;
  return Math.abs(Number(a) - Number(b)) > 0.01;
}

/**
 * Persists calculated optical input, thru output & ONT RX levels back to gis_nodes in background.
 * Uses a 0.01 dB threshold so cross-client Realtime broadcasts never ping-pong updates.
 */
export async function syncOpticalBudgetsToDb(
  nodes: SupabaseGisNode[],
  cables: SupabaseGisCable[],
  ponPortsById: Record<string, SupabaseGisOltPonPort> = {}
): Promise<void> {
  const budgets = calculateTopologyOpticalBudgets(nodes, cables, ponPortsById);
  const updates = nodes
    .filter((n) => n.node_type !== 'OLT')
    .map((n) => {
      const b = budgets[n.id];
      if (!b) return null;
      const changed =
        numericDiffers(n.calculated_input_dbm, b.inputDbm) ||
        numericDiffers(n.calculated_output_dbm, b.thruOutputDbm) ||
        numericDiffers(n.calculated_ont_rx_dbm, b.ontRxDbm);
      if (!changed) return null;
      return Promise.resolve(
        supabase
          .from('gis_nodes')
          .update({
            calculated_input_dbm: b.inputDbm,
            calculated_output_dbm: b.thruOutputDbm,
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
