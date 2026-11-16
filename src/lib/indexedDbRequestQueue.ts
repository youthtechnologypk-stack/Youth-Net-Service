import { SUPABASE_URL } from '../services/supabaseClient';
import { sqliteOfflineAdapter } from './sqliteOfflineAdapter';

export interface QueuedApiRequest {
  id: string;
  agentId: string;
  url: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers: Record<string, string>;
  body: string | null;
  createdAt: number;
  retryCount: number;
  lastError?: string;
}

export interface SyncQueueProgress {
  processed: number;
  total: number;
  syncedCount: number;
}

export interface SyncQueueResult {
  syncedCount: number;
  remainingCount: number;
  failedCount: number;
  stoppedOnNetworkError: boolean;
}

function yieldMainThread(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const DB_NAME = 'youthnet_offline_api_queue_db';
const DB_VERSION = 1;
const STORE_NAME = 'queued_requests';
const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Preserve the true browser fetch before any interception
const nativeFetch: typeof window.fetch | null =
  typeof window !== 'undefined' && typeof window.fetch === 'function'
    ? window.fetch.bind(window)
    : null;

export function getNativeFetch(): typeof window.fetch {
  if (!nativeFetch) {
    throw new Error('Fetch API is unavailable in this environment.');
  }
  return nativeFetch;
}

function generateRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function openOfflineQueueDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB is not supported in this browser.'));
      return;
    }

    const req = window.indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('by_createdAt', 'createdAt', { unique: false });
        store.createIndex('by_agentId', 'agentId', { unique: false });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open IndexedDB offline queue.'));
  });
}

export async function enqueueOfflineApiRequest(
  item: Omit<QueuedApiRequest, 'id' | 'createdAt' | 'retryCount'>
): Promise<QueuedApiRequest> {
  const record: QueuedApiRequest = {
    ...item,
    id: generateRequestId(),
    createdAt: Date.now(),
    retryCount: 0,
  };

  // Persist into Local SQLite Database Adapter (Web Worker)
  await sqliteOfflineAdapter.enqueueRequest(record).catch(() => {});

  // Mirror into IndexedDB object store for redundancy
  try {
    const db = await openOfflineQueueDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).add(record);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error || new Error('Failed to enqueue offline API request.'));
      };
    });
  } catch {
    // SQLite adapter remains authoritative
  }

  return record;
}

export async function getQueuedApiRequests(agentId?: string): Promise<QueuedApiRequest[]> {
  if (typeof window === 'undefined') return [];

  try {
    const sqlRows = await sqliteOfflineAdapter.getQueuedRequests(agentId);
    if (sqlRows.length > 0) {
      return sqlRows;
    }
  } catch {
    // Fallback to direct IndexedDB store below
  }

  if (!window.indexedDB) return [];

  try {
    const db = await openOfflineQueueDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();

      req.onsuccess = () => {
        const all = (Array.isArray(req.result) ? req.result : []) as QueuedApiRequest[];
        const filtered = agentId ? all.filter((item) => item.agentId === agentId) : all;
        filtered.sort((a, b) => a.createdAt - b.createdAt);
        db.close();
        resolve(filtered);
      };
      req.onerror = () => {
        db.close();
        reject(req.error || new Error('Failed to read IndexedDB offline queue.'));
      };
    });
  } catch {
    return [];
  }
}

export async function removeQueuedApiRequest(id: string): Promise<void> {
  await sqliteOfflineAdapter.removeQueuedRequest(id).catch(() => {});
  try {
    const db = await openOfflineQueueDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error || new Error('Failed to remove synced request from IndexedDB.'));
      };
    });
  } catch {
    // Ignore IDB mirror failure
  }
}

export async function updateQueuedApiRequest(record: QueuedApiRequest): Promise<void> {
  await sqliteOfflineAdapter.updateQueuedRequest(record).catch(() => {});
  try {
    const db = await openOfflineQueueDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(record);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error || new Error('Failed to update queued request in IndexedDB.'));
      };
    });
  } catch {
    // Ignore IDB mirror failure
  }
}

function normalizeUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function normalizeHeaders(
  input: RequestInfo | URL,
  init?: RequestInit
): Record<string, string> {
  const result: Record<string, string> = {};

  const assignFromHeadersInit = (source?: HeadersInit) => {
    if (!source) return;
    if (source instanceof Headers) {
      source.forEach((value, key) => {
        result[key] = value;
      });
    } else if (Array.isArray(source)) {
      for (const [key, value] of source) {
        result[key] = value;
      }
    } else {
      Object.entries(source).forEach(([key, value]) => {
        if (value !== undefined) result[key] = String(value);
      });
    }
  };

  if (typeof Request !== 'undefined' && input instanceof Request) {
    assignFromHeadersInit(input.headers);
  }
  if (init?.headers) {
    assignFromHeadersInit(init.headers);
  }

  return result;
}

export function shouldCaptureOfflineApiRequest(
  url: string,
  method: string,
  headers: Record<string, string>
): boolean {
  const upperMethod = (method || 'GET').toUpperCase();
  if (!MUTATION_METHODS.has(upperMethod)) return false;

  // Never capture already-replayed calls
  const lowerHeaderKeys = Object.keys(headers).reduce<Record<string, string>>((acc, k) => {
    acc[k.toLowerCase()] = headers[k];
    return acc;
  }, {});
  if (lowerHeaderKeys['x-offline-queue-replay'] === '1') return false;

  const lowerUrl = url.toLowerCase();

  // Exclude ephemeral GPS telemetry pings & auth session endpoints
  if (
    lowerUrl.includes('/agent_live_locations') ||
    lowerUrl.includes('/api/auth/login') ||
    lowerUrl.includes('/api/auth/logout') ||
    lowerUrl.includes('/auth/v1/')
  ) {
    return false;
  }

  const isLocalApi =
    lowerUrl.startsWith('/api/') ||
    (typeof window !== 'undefined' && lowerUrl.startsWith(`${window.location.origin.toLowerCase()}/api/`));

  const isSupabaseRest =
    lowerUrl.startsWith(`${SUPABASE_URL.toLowerCase()}/rest/v1/`);

  return isLocalApi || isSupabaseRest;
}

export async function extractSerializableBody(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<{ serializable: boolean; body: string | null }> {
  const rawBody = init?.body;

  if (rawBody !== undefined) {
    if (rawBody === null) return { serializable: true, body: null };
    if (typeof rawBody === 'string') return { serializable: true, body: rawBody };
    if (rawBody instanceof URLSearchParams) {
      return { serializable: true, body: rawBody.toString() };
    }
    // Skip binary streams or FormData that cannot be serialized as JSON/text safely
    return { serializable: false, body: null };
  }

  if (typeof Request !== 'undefined' && input instanceof Request) {
    try {
      const cloned = input.clone();
      const text = await cloned.text();
      return { serializable: true, body: text || null };
    } catch {
      return { serializable: false, body: null };
    }
  }

  return { serializable: true, body: null };
}

export function buildOfflineQueuedResponse(
  url: string,
  headers: Record<string, string>,
  queuedId: string
): Response {
  const lowerHeaders = Object.keys(headers).reduce<Record<string, string>>((acc, k) => {
    acc[k.toLowerCase()] = headers[k];
    return acc;
  }, {});

  const accept = (lowerHeaders['accept'] || '').toLowerCase();
  const prefer = (lowerHeaders['prefer'] || '').toLowerCase();
  const isSupabaseRest = url.toLowerCase().includes('/rest/v1/');

  let payload: unknown = {
    ok: true,
    queued: true,
    offlineQueued: true,
    queueId: queuedId,
  };

  if (isSupabaseRest && prefer.includes('return=representation') && !accept.includes('vnd.pgrst.object+json')) {
    payload = [];
  }

  return new Response(JSON.stringify(payload), {
    status: 202,
    statusText: 'Accepted (Queued in IndexedDB)',
    headers: {
      'Content-Type': 'application/json',
      'X-Offline-Queued': 'true',
      'X-Offline-Queue-Id': queuedId,
    },
  });
}

export function isNetworkFetchError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  if (err instanceof TypeError) return true;
  const msg = String((err as any)?.message || err || '').toLowerCase();
  return (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network request failed') ||
    msg.includes('load failed') ||
    msg.includes('err_internet_disconnected')
  );
}

/**
 * Replays queued SQLite / IndexedDB API requests in chronological FIFO order,
 * yielding cooperatively to keep the UI responsive during heavy sync bursts.
 */
export async function syncIndexedDbApiQueue(
  agentId: string,
  onProgress?: (progress: SyncQueueProgress) => void
): Promise<SyncQueueResult> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    const remaining = await getQueuedApiRequests(agentId);
    return {
      syncedCount: 0,
      remainingCount: remaining.length,
      failedCount: 0,
      stoppedOnNetworkError: true,
    };
  }

  const items = await getQueuedApiRequests(agentId);
  if (items.length === 0) {
    return {
      syncedCount: 0,
      remainingCount: 0,
      failedCount: 0,
      stoppedOnNetworkError: false,
    };
  }

  const fetchImpl = getNativeFetch();
  let syncedCount = 0;
  let failedCount = 0;
  let processed = 0;
  let stoppedOnNetworkError = false;

  for (const item of items) {
    try {
      const replayHeaders: Record<string, string> = {
        ...item.headers,
        'X-Offline-Queue-Replay': '1',
      };

      const res = await fetchImpl(item.url, {
        method: item.method,
        headers: replayHeaders,
        body: item.body ?? undefined,
      });

      if (res.ok) {
        await removeQueuedApiRequest(item.id);
        syncedCount++;
      } else if (res.status === 408 || res.status === 429 || res.status >= 500) {
        await updateQueuedApiRequest({
          ...item,
          retryCount: item.retryCount + 1,
          lastError: `HTTP ${res.status}`,
        });
        failedCount++;
        stoppedOnNetworkError = true;
        break;
      } else {
        const nextRetry = item.retryCount + 1;
        if (nextRetry >= 2) {
          console.warn(
            '[OfflineApiQueue] Dropping permanently rejected queued request:',
            item.method,
            item.url,
            res.status
          );
          await removeQueuedApiRequest(item.id);
        } else {
          await updateQueuedApiRequest({
            ...item,
            retryCount: nextRetry,
            lastError: `HTTP ${res.status}`,
          });
        }
        failedCount++;
      }
    } catch (err) {
      if (isNetworkFetchError(err)) {
        await updateQueuedApiRequest({
          ...item,
          retryCount: item.retryCount + 1,
          lastError: 'Offline / Network unreachable',
        });
        stoppedOnNetworkError = true;
        break;
      }

      await updateQueuedApiRequest({
        ...item,
        retryCount: item.retryCount + 1,
        lastError: String((err as any)?.message || err || 'Sync error'),
      });
      failedCount++;
    }

    processed++;
    onProgress?.({ processed, total: items.length, syncedCount });

    // Yield back to UI event loop after every request so scrolling/taps stay fluid
    if (processed < items.length) {
      await yieldMainThread();
    }
  }

  const remaining = await getQueuedApiRequests(agentId);
  return {
    syncedCount,
    remainingCount: remaining.length,
    failedCount,
    stoppedOnNetworkError,
  };
}

export { normalizeUrl, normalizeHeaders };
