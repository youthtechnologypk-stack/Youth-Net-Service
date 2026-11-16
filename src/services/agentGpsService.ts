import { supabase } from './supabaseClient';
import { isMissingTableOrColumnError } from '../lib/expiryUtils';

export interface AgentLiveLocationRow {
  agent_id: string;
  agent_name: string;
  lat: number;
  lng: number;
  accuracy_meters: number | null;
  is_online: boolean;
  updated_at: string;
}

export interface GisAreaZoneRow {
  id: string;
  name: string;
  lat: number;
  lng: number;
  color?: string | null;
  updated_by?: string | null;
  created_at?: string;
}

const LOCAL_ZONES_STORAGE_KEY = 'youthnet_gis_area_zones';

function readLocalAreaZones(): GisAreaZoneRow[] {
  try {
    const raw = localStorage.getItem(LOCAL_ZONES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalAreaZones(zones: GisAreaZoneRow[]) {
  try {
    localStorage.setItem(LOCAL_ZONES_STORAGE_KEY, JSON.stringify(zones));
  } catch {
    // ignore storage quota errors
  }
}

export async function upsertAgentLiveLocation(payload: {
  agentId: string;
  agentName: string;
  lat: number;
  lng: number;
  accuracyMeters?: number | null;
  isOnline?: boolean;
}): Promise<{ ok: boolean; tableMissing?: boolean; error?: string }> {
  const row: AgentLiveLocationRow = {
    agent_id: payload.agentId,
    agent_name: payload.agentName || 'Field Agent',
    lat: Number(payload.lat),
    lng: Number(payload.lng),
    accuracy_meters:
      payload.accuracyMeters !== undefined && payload.accuracyMeters !== null
        ? Math.round(Number(payload.accuracyMeters))
        : null,
    is_online: payload.isOnline !== false,
    updated_at: new Date().toISOString(),
  };

  try {
    const { error } = await supabase
      .from('agent_live_locations')
      .upsert(row, { onConflict: 'agent_id' });

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        return { ok: false, tableMissing: true, error: error.message };
      }
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Failed to sync GPS location' };
  }
}

export async function markAgentLocationOffline(agentId: string): Promise<void> {
  if (!agentId) return;
  try {
    await supabase
      .from('agent_live_locations')
      .update({ is_online: false, updated_at: new Date().toISOString() })
      .eq('agent_id', agentId);
  } catch {
    // ignore offline cleanup failure
  }
}

export async function fetchLiveAgentLocations(): Promise<{
  agents: AgentLiveLocationRow[];
  tableMissing: boolean;
}> {
  try {
    const { data, error } = await supabase
      .from('agent_live_locations')
      .select('*')
      .order('updated_at', { ascending: false });

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        return { agents: [], tableMissing: true };
      }
      return { agents: [], tableMissing: false };
    }

    const agents: AgentLiveLocationRow[] = (data || [])
      .filter(
        (r: any) =>
          r &&
          typeof r.lat === 'number' &&
          typeof r.lng === 'number' &&
          Number.isFinite(r.lat) &&
          Number.isFinite(r.lng)
      )
      .map((r: any) => ({
        agent_id: String(r.agent_id),
        agent_name: String(r.agent_name || 'Field Agent'),
        lat: Number(r.lat),
        lng: Number(r.lng),
        accuracy_meters:
          r.accuracy_meters !== null && r.accuracy_meters !== undefined
            ? Number(r.accuracy_meters)
            : null,
        is_online: r.is_online !== false,
        updated_at: String(r.updated_at || new Date().toISOString()),
      }));

    return { agents, tableMissing: false };
  } catch {
    return { agents: [], tableMissing: false };
  }
}

export function subscribeToAgentLiveLocations(
  onUpdate: (agents: AgentLiveLocationRow[], tableMissing: boolean) => void
): () => void {
  let stopped = false;

  const refresh = async () => {
    const res = await fetchLiveAgentLocations();
    if (!stopped) {
      onUpdate(res.agents, res.tableMissing);
    }
  };

  void refresh();

  const channelName = `agent-live-gps-${Math.random().toString(36).slice(2, 8)}`;
  const channel = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'agent_live_locations' },
      () => {
        void refresh();
      }
    )
    .subscribe();

  // Reliable 15-second fallback poll in case Supabase Realtime is not yet enabled on the table
  const timer = window.setInterval(() => {
    void refresh();
  }, 15000);

  return () => {
    stopped = true;
    window.clearInterval(timer);
    try {
      supabase.removeChannel(channel);
    } catch {
      // ignore cleanup error
    }
  };
}

export async function loadGisAreaZones(): Promise<GisAreaZoneRow[]> {
  try {
    const { data, error } = await supabase
      .from('gis_area_zones')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) {
      return readLocalAreaZones();
    }
    const rows: GisAreaZoneRow[] = (data || []).map((r: any) => ({
      id: String(r.id),
      name: String(r.name || ''),
      lat: Number(r.lat),
      lng: Number(r.lng),
      color: r.color || '#22d3ee',
      updated_by: r.updated_by || 'admin',
      created_at: r.created_at,
    }));
    writeLocalAreaZones(rows);
    return rows;
  } catch {
    return readLocalAreaZones();
  }
}

export async function createGisAreaZone(input: {
  name: string;
  lat: number;
  lng: number;
  color?: string;
  updatedBy?: string;
}): Promise<GisAreaZoneRow> {
  const cleanName = input.name.trim();
  const payload = {
    name: cleanName,
    lat: Number(input.lat),
    lng: Number(input.lng),
    color: input.color || '#22d3ee',
    updated_by: input.updatedBy || 'admin',
  };

  try {
    const { data, error } = await supabase
      .from('gis_area_zones')
      .insert([payload])
      .select('*')
      .single();
    if (!error && data) {
      const row: GisAreaZoneRow = {
        id: String(data.id),
        name: String(data.name),
        lat: Number(data.lat),
        lng: Number(data.lng),
        color: data.color || '#22d3ee',
        updated_by: data.updated_by || 'admin',
        created_at: data.created_at,
      };
      const existing = readLocalAreaZones();
      writeLocalAreaZones([...existing, row]);
      return row;
    }
  } catch {
    // fallback to local storage
  }

  const localRow: GisAreaZoneRow = {
    id: `zone-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    ...payload,
    created_at: new Date().toISOString(),
  };
  const existing = readLocalAreaZones();
  writeLocalAreaZones([...existing, localRow]);
  return localRow;
}

export async function deleteGisAreaZone(zoneId: string): Promise<void> {
  const existing = readLocalAreaZones().filter((z) => z.id !== zoneId);
  writeLocalAreaZones(existing);
  if (zoneId.startsWith('zone-')) return;
  try {
    await supabase.from('gis_area_zones').delete().eq('id', zoneId);
  } catch {
    // ignore
  }
}

export function formatAgentLastSeen(updatedAtIso?: string | null): string {
  if (!updatedAtIso) return 'Live';
  const diffSec = Math.max(
    0,
    Math.floor((Date.now() - new Date(updatedAtIso).getTime()) / 1000)
  );
  if (diffSec < 10) return 'Live now';
  if (diffSec < 60) return `Live ${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  return `${diffHr}h ago`;
}
