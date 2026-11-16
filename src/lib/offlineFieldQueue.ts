import { SUPABASE_ANON_KEY, SUPABASE_URL, supabase } from '../services/supabaseClient';
import { isMissingTableOrColumnError } from './expiryUtils';
import { getNativeFetch } from './indexedDbRequestQueue';

export const OFFLINE_SYNC_QUEUE_KEY = 'offline_sync_queue';
const IDB_NAME = 'youthnet_offline_sync_queue_db';
const IDB_VERSION = 1;
const IDB_STORE = 'sync_queue_state';

export interface OfflineGpsBreadcrumb {
  id: string;
  agent_id: string;
  agent_name: string;
  lat: number;
  lng: number;
  accuracy_meters: number | null;
  recorded_at: string;
}

export interface OfflineSyncQueueSnapshot {
  gps_breadcrumbs: OfflineGpsBreadcrumb[];
  pending_payments: any[];
  updated_at: string;
}

export interface OfflineConnectivitySnapshot {
  deviceOnline: boolean;
  supabaseReachable: boolean;
  isOfflineOrBlocked: boolean;
  gpsBreadcrumbsCount: number;
  pendingPaymentsCount: number;
  totalQueuedItems: number;
}

const EMPTY_QUEUE: OfflineSyncQueueSnapshot = {
  gps_breadcrumbs: [],
  pending_payments: [],
  updated_at: new Date().toISOString(),
};

let supabaseReachableState: boolean =
  typeof navigator !== 'undefined' ? navigator.onLine : true;

const connectivityListeners = new Set<(state: OfflineConnectivitySnapshot) => void>();

function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `gps_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function readLocalQueue(): OfflineSyncQueueSnapshot {
  if (typeof window === 'undefined' || !window.localStorage) return { ...EMPTY_QUEUE };
  try {
    const raw = window.localStorage.getItem(OFFLINE_SYNC_QUEUE_KEY);
    if (!raw) return { ...EMPTY_QUEUE };
    const parsed = JSON.parse(raw) as Partial<OfflineSyncQueueSnapshot>;
    return {
      gps_breadcrumbs: Array.isArray(parsed.gps_breadcrumbs) ? parsed.gps_breadcrumbs : [],
      pending_payments: Array.isArray(parsed.pending_payments) ? parsed.pending_payments : [],
      updated_at: parsed.updated_at || new Date().toISOString(),
    };
  } catch {
    return { ...EMPTY_QUEUE };
  }
}

function openSyncQueueIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = window.indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open offline_sync_queue IDB'));
  });
}

async function mirrorQueueToIndexedDb(snapshot: OfflineSyncQueueSnapshot): Promise<void> {
  try {
    const db = await openSyncQueueIdb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(snapshot, OFFLINE_SYNC_QUEUE_KEY);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch {
    // localStorage copy remains intact
  }
}

export async function hydrateOfflineQueueFromIndexedDb(): Promise<OfflineSyncQueueSnapshot> {
  const local = readLocalQueue();
  if (local.gps_breadcrumbs.length > 0 || local.pending_payments.length > 0) {
    return local;
  }

  try {
    const db = await openSyncQueueIdb();
    const idbVal = await new Promise<OfflineSyncQueueSnapshot | null>((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(OFFLINE_SYNC_QUEUE_KEY);
      req.onsuccess = () => {
        db.close();
        resolve((req.result as OfflineSyncQueueSnapshot) || null);
      };
      req.onerror = () => {
        db.close();
        resolve(null);
      };
    });
    if (idbVal) {
      writeQueue(idbVal);
      return idbVal;
    }
  } catch {}
  return local;
}

function writeQueue(snapshot: OfflineSyncQueueSnapshot): void {
  const normalized: OfflineSyncQueueSnapshot = {
    gps_breadcrumbs: Array.isArray(snapshot.gps_breadcrumbs)
      ? snapshot.gps_breadcrumbs.slice(-500)
      : [],
    pending_payments: Array.isArray(snapshot.pending_payments)
      ? snapshot.pending_payments
      : [],
    updated_at: new Date().toISOString(),
  };

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(OFFLINE_SYNC_QUEUE_KEY, JSON.stringify(normalized));
    } catch {
      // Fallback to IndexedDB only if localStorage quota exceeded
    }
  }

  void mirrorQueueToIndexedDb(normalized);
  notifyConnectivityListeners();
}

export function getOfflineSyncQueueSnapshot(): OfflineSyncQueueSnapshot {
  return readLocalQueue();
}

export function getConnectivitySnapshot(extraApiQueuedCount = 0): OfflineConnectivitySnapshot {
  const deviceOnline =
    typeof navigator !== 'undefined' ? navigator.onLine !== false : true;
  const q = readLocalQueue();
  const gpsBreadcrumbsCount = q.gps_breadcrumbs.length;
  const pendingPaymentsCount = q.pending_payments.length;
  return {
    deviceOnline,
    supabaseReachable: deviceOnline && supabaseReachableState,
    isOfflineOrBlocked: !deviceOnline || !supabaseReachableState,
    gpsBreadcrumbsCount,
    pendingPaymentsCount,
    totalQueuedItems: gpsBreadcrumbsCount + pendingPaymentsCount + extraApiQueuedCount,
  };
}

function notifyConnectivityListeners(): void {
  const snap = getConnectivitySnapshot();
  connectivityListeners.forEach((fn) => fn(snap));
}

export function subscribeOfflineFieldConnectivity(
  listener: (state: OfflineConnectivitySnapshot) => void
): () => void {
  connectivityListeners.add(listener);
  listener(getConnectivitySnapshot());
  return () => {
    connectivityListeners.delete(listener);
  };
}

export function reportSupabaseReachability(reachable: boolean): void {
  const next = typeof navigator !== 'undefined' && navigator.onLine === false ? false : reachable;
  if (supabaseReachableState !== next) {
    supabaseReachableState = next;
    notifyConnectivityListeners();
  }
}

/**
 * Actively probes Supabase REST endpoint (detects WhatsApp-only SIM packages where
 * navigator.onLine is true but general HTTPS internet access to Supabase is blocked).
 */
export async function probeSupabaseReachability(timeoutMs = 4500): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    reportSupabaseReachability(false);
    return false;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const fetchImpl = getNativeFetch();
    const res = await fetchImpl(
      `${SUPABASE_URL}/rest/v1/agent_live_locations?select=agent_id&limit=1`,
      {
        method: 'GET',
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        cache: 'no-store',
        signal: controller.signal,
      }
    );

    const ok = res.status > 0 && res.status < 500;
    reportSupabaseReachability(ok);
    return ok;
  } catch {
    reportSupabaseReachability(false);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function enqueueGpsBreadcrumb(input: {
  agent_id: string;
  agent_name: string;
  lat: number;
  lng: number;
  accuracy_meters?: number | null;
  recorded_at?: string;
}): OfflineGpsBreadcrumb {
  const current = readLocalQueue();
  const recordedAt = input.recorded_at || new Date().toISOString();

  // Deduplicate rapid double captures within 10s
  const last = current.gps_breadcrumbs[current.gps_breadcrumbs.length - 1];
  if (last && last.agent_id === input.agent_id) {
    const deltaMs = new Date(recordedAt).getTime() - new Date(last.recorded_at).getTime();
    if (!Number.isNaN(deltaMs) && deltaMs < 10000) {
      return last;
    }
  }

  const entry: OfflineGpsBreadcrumb = {
    id: generateUuid(),
    agent_id: input.agent_id,
    agent_name: input.agent_name || 'Field Agent',
    lat: Number(input.lat),
    lng: Number(input.lng),
    accuracy_meters:
      input.accuracy_meters !== undefined && input.accuracy_meters !== null
        ? Math.round(Number(input.accuracy_meters))
        : null,
    recorded_at: recordedAt,
  };

  writeQueue({
    ...current,
    gps_breadcrumbs: [...current.gps_breadcrumbs, entry],
  });
  return entry;
}

export function mirrorPendingPaymentsInSyncQueue(pendingPayments: any[]): void {
  const current = readLocalQueue();
  writeQueue({
    ...current,
    pending_payments: Array.isArray(pendingPayments) ? pendingPayments : [],
  });
}

/**
 * Flushes queued GPS route breadcrumbs straight to Supabase (updating agent_live_locations
 * with the freshest fix and writing the historical breadcrumb trail if table exists).
 */
export async function flushGpsBreadcrumbsToSupabase(agentId?: string): Promise<{
  syncedCount: number;
  remainingCount: number;
  hadNetworkError: boolean;
}> {
  const current = readLocalQueue();
  const all = current.gps_breadcrumbs;
  const targetItems = agentId ? all.filter((b) => b.agent_id === agentId) : all;

  if (targetItems.length === 0) {
    return { syncedCount: 0, remainingCount: all.length, hadNetworkError: false };
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { syncedCount: 0, remainingCount: all.length, hadNetworkError: true };
  }

  try {
    // 1. Update agent_live_locations with the latest captured coordinate per agent
    const latestByAgent = new Map<string, OfflineGpsBreadcrumb>();
    for (const item of targetItems) {
      latestByAgent.set(item.agent_id, item);
    }

    for (const latest of latestByAgent.values()) {
      const { error: liveErr } = await supabase
        .from('agent_live_locations')
        .upsert(
          {
            agent_id: latest.agent_id,
            agent_name: latest.agent_name,
            lat: latest.lat,
            lng: latest.lng,
            accuracy_meters: latest.accuracy_meters,
            is_online: true,
            updated_at: latest.recorded_at,
          },
          { onConflict: 'agent_id' }
        );

      if (liveErr && !isMissingTableOrColumnError(liveErr)) {
        const msg = String(liveErr.message || '').toLowerCase();
        if (msg.includes('fetch') || msg.includes('network')) {
          reportSupabaseReachability(false);
          return { syncedCount: 0, remainingCount: all.length, hadNetworkError: true };
        }
      }
    }

    // 2. Persist full GPS breadcrumb trail to agent_gps_breadcrumbs in batches of 50
    for (let i = 0; i < targetItems.length; i += 50) {
      const batch = targetItems.slice(i, i + 50).map((b) => ({
        id: b.id,
        agent_id: b.agent_id,
        agent_name: b.agent_name,
        lat: b.lat,
        lng: b.lng,
        accuracy_meters: b.accuracy_meters,
        recorded_at: b.recorded_at,
      }));

      const { error: trailErr } = await supabase
        .from('agent_gps_breadcrumbs')
        .upsert(batch, { onConflict: 'id' });

      if (trailErr) {
        if (isMissingTableOrColumnError(trailErr)) {
          // Optional trail table not migrated yet; agent_live_locations already updated
          break;
        }
        const msg = String(trailErr.message || '').toLowerCase();
        if (msg.includes('fetch') || msg.includes('network')) {
          reportSupabaseReachability(false);
          return { syncedCount: 0, remainingCount: all.length, hadNetworkError: true };
        }
      }
    }

    // 3. Remove synced breadcrumbs cleanly
    const syncedIds = new Set(targetItems.map((b) => b.id));
    const remaining = all.filter((b) => !syncedIds.has(b.id));
    writeQueue({
      ...readLocalQueue(),
      gps_breadcrumbs: remaining,
    });
    reportSupabaseReachability(true);

    return {
      syncedCount: targetItems.length,
      remainingCount: remaining.length,
      hadNetworkError: false,
    };
  } catch {
    reportSupabaseReachability(false);
    return { syncedCount: 0, remainingCount: all.length, hadNetworkError: true };
  }
}
