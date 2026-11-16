import type { LoadedGisTopology } from '../services/fiberGisService';
import type { GisAreaZoneRow } from '../services/agentGpsService';
import type { QueuedApiRequest } from './indexedDbRequestQueue';

export interface SqliteAdapterStats {
  engine: 'sqlite-wasm-worker' | 'indexeddb-fallback';
  nodesCount: number;
  cablesCount: number;
  subscribersCount: number;
  invoicesCount: number;
  ticketsCount: number;
  queuedRequestsCount: number;
  lastSyncedAt: number | null;
}

export interface SqliteSyncProgress {
  dataset: string;
  processed: number;
  total: number;
}

export interface CachedAgentSqliteDataset {
  subscribers: Record<
    string,
    {
      phone?: string;
      address?: string;
      full_name?: string;
      area?: string;
      package_speed?: string;
    }
  >;
  invoices: any[];
  tickets: any[];
  wallet: {
    cashInHand: number;
    baseSalary: number;
    advanceBalance: number;
    cashTransactions: any[];
  } | null;
}

const DEFAULT_STATS: SqliteAdapterStats = {
  engine: 'sqlite-wasm-worker',
  nodesCount: 0,
  cablesCount: 0,
  subscribersCount: 0,
  invoicesCount: 0,
  ticketsCount: 0,
  queuedRequestsCount: 0,
  lastSyncedAt: null,
};

// Fallback IndexedDB store used ONLY if Web Worker / WebAssembly is unavailable
const FALLBACK_DB_NAME = 'youthnet_sqlite_fallback_db';
const FALLBACK_DB_VERSION = 1;
const FALLBACK_STORE = 'datasets';

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function openFallbackIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = window.indexedDB.open(FALLBACK_DB_NAME, FALLBACK_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(FALLBACK_STORE)) {
        db.createObjectStore(FALLBACK_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Fallback IDB failed'));
  });
}

async function fallbackSet(key: string, value: unknown): Promise<void> {
  try {
    await yieldToMain();
    const db = await openFallbackIdb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(FALLBACK_STORE, 'readwrite');
      tx.objectStore(FALLBACK_STORE).put(value, key);
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
    // Ignore storage unavailability
  }
}

async function fallbackGet<T>(key: string): Promise<T | null> {
  try {
    const db = await openFallbackIdb();
    return await new Promise<T | null>((resolve) => {
      const tx = db.transaction(FALLBACK_STORE, 'readonly');
      const req = tx.objectStore(FALLBACK_STORE).get(key);
      req.onsuccess = () => {
        db.close();
        resolve((req.result as T) ?? null);
      };
      req.onerror = () => {
        db.close();
        resolve(null);
      };
    });
  } catch {
    return null;
  }
}

interface PendingRpc {
  resolve: (data: any) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

class SqliteOfflineDatabaseAdapter {
  private worker: Worker | null = null;
  private workerFailed = false;
  private initPromise: Promise<void> | null = null;
  private pending = new Map<string, PendingRpc>();
  private rpcSeq = 0;

  private stats: SqliteAdapterStats = { ...DEFAULT_STATS };
  private statsListeners = new Set<(stats: SqliteAdapterStats) => void>();
  private progressListeners = new Set<(progress: SqliteSyncProgress | null) => void>();

  private notifyStats(next?: Partial<SqliteAdapterStats>) {
    if (next) {
      this.stats = { ...this.stats, ...next };
    }
    this.statsListeners.forEach((fn) => fn(this.stats));
  }

  private notifyProgress(progress: SqliteSyncProgress | null) {
    this.progressListeners.forEach((fn) => fn(progress));
  }

  public subscribeStats(listener: (stats: SqliteAdapterStats) => void): () => void {
    this.statsListeners.add(listener);
    listener(this.stats);
    return () => {
      this.statsListeners.delete(listener);
    };
  }

  public subscribeProgress(listener: (progress: SqliteSyncProgress | null) => void): () => void {
    this.progressListeners.add(listener);
    return () => {
      this.progressListeners.delete(listener);
    };
  }

  public getCachedStats(): SqliteAdapterStats {
    return this.stats;
  }

  private createWorker(): Worker | null {
    if (typeof window === 'undefined' || typeof Worker === 'undefined') {
      this.workerFailed = true;
      return null;
    }

    try {
      const w = new Worker(new URL('../workers/sqliteOffline.worker.ts', import.meta.url), {
        type: 'module',
      });

      w.onmessage = (event: MessageEvent<any>) => {
        const msg = event.data;
        if (!msg) return;

        if (msg.type === 'SYNC_PROGRESS') {
          this.notifyProgress({
            dataset: String(msg.dataset || ''),
            processed: Number(msg.processed || 0),
            total: Number(msg.total || 0),
          });
          if (msg.processed >= msg.total) {
            setTimeout(() => this.notifyProgress(null), 600);
          }
          return;
        }

        const entry = this.pending.get(msg.id);
        if (!entry) return;
        clearTimeout(entry.timer);
        this.pending.delete(msg.id);

        if (msg.ok) {
          entry.resolve(msg.data);
        } else {
          entry.reject(new Error(msg.error || 'SQLite worker request failed'));
        }
      };

      w.onerror = () => {
        this.workerFailed = true;
        this.stats = { ...this.stats, engine: 'indexeddb-fallback' };
        this.pending.forEach((entry) => {
          clearTimeout(entry.timer);
          entry.reject(new Error('SQLite worker failed, switching to IndexedDB fallback'));
        });
        this.pending.clear();
        this.worker = null;
      };

      return w;
    } catch {
      this.workerFailed = true;
      return null;
    }
  }

  private callWorker<T>(action: string, payload?: unknown, timeoutMs = 15000): Promise<T> {
    if (this.workerFailed) {
      return Promise.reject(new Error('Worker unavailable'));
    }

    if (!this.worker) {
      this.worker = this.createWorker();
    }

    const w = this.worker;
    if (!w) {
      return Promise.reject(new Error('Worker unavailable'));
    }

    const id = `sql_${++this.rpcSeq}_${Date.now()}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`SQLite worker timeout for ${action}`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      w.postMessage({ id, action, payload });
    });
  }

  public async init(): Promise<SqliteAdapterStats> {
    if (!this.initPromise) {
      this.initPromise = (async () => {
        try {
          const stats = await this.callWorker<SqliteAdapterStats>('INIT', undefined, 20000);
          this.notifyStats(stats);
        } catch {
          this.workerFailed = true;
          this.notifyStats({ engine: 'indexeddb-fallback' });
        }
      })();
    }
    await this.initPromise;
    return this.stats;
  }

  public async refreshStats(): Promise<SqliteAdapterStats> {
    await this.init();
    if (!this.workerFailed) {
      try {
        const stats = await this.callWorker<SqliteAdapterStats>('GET_STATS');
        this.notifyStats(stats);
        return stats;
      } catch {}
    }
    return this.stats;
  }

  // =========================================================================
  // 1. Offline API Request Queue Storage (Backed by SQLite + IndexedDB fallback)
  // =========================================================================

  public async enqueueRequest(record: QueuedApiRequest): Promise<void> {
    await this.init();
    if (!this.workerFailed) {
      try {
        const stats = await this.callWorker<SqliteAdapterStats>('ENQUEUE_REQUEST', record);
        this.notifyStats(stats);
        return;
      } catch {}
    }
    const existing = (await fallbackGet<QueuedApiRequest[]>('offline_api_queue')) || [];
    const next = [...existing.filter((x) => x.id !== record.id), record].sort(
      (a, b) => a.createdAt - b.createdAt
    );
    await fallbackSet('offline_api_queue', next);
    this.notifyStats({ queuedRequestsCount: next.length });
  }

  public async getQueuedRequests(agentId?: string): Promise<QueuedApiRequest[]> {
    await this.init();
    if (!this.workerFailed) {
      try {
        return await this.callWorker<QueuedApiRequest[]>('GET_QUEUED_REQUESTS', { agentId });
      } catch {}
    }
    const existing = (await fallbackGet<QueuedApiRequest[]>('offline_api_queue')) || [];
    const filtered = agentId ? existing.filter((x) => x.agentId === agentId) : existing;
    return filtered.sort((a, b) => a.createdAt - b.createdAt);
  }

  public async updateQueuedRequest(record: QueuedApiRequest): Promise<void> {
    await this.init();
    if (!this.workerFailed) {
      try {
        const stats = await this.callWorker<SqliteAdapterStats>('UPDATE_QUEUED_REQUEST', record);
        this.notifyStats(stats);
        return;
      } catch {}
    }
    const existing = (await fallbackGet<QueuedApiRequest[]>('offline_api_queue')) || [];
    const next = existing.map((x) => (x.id === record.id ? record : x));
    await fallbackSet('offline_api_queue', next);
  }

  public async removeQueuedRequest(id: string): Promise<void> {
    await this.init();
    if (!this.workerFailed) {
      try {
        const stats = await this.callWorker<SqliteAdapterStats>('REMOVE_QUEUED_REQUEST', { id });
        this.notifyStats(stats);
        return;
      } catch {}
    }
    const existing = (await fallbackGet<QueuedApiRequest[]>('offline_api_queue')) || [];
    const next = existing.filter((x) => x.id !== id);
    await fallbackSet('offline_api_queue', next);
    this.notifyStats({ queuedRequestsCount: next.length });
  }

  // =========================================================================
  // 2. Large Dataset Persistence (GIS Node Maps, Cables, Subscribers, Billing)
  // =========================================================================

  public async persistGisTopology(topology: LoadedGisTopology): Promise<void> {
    await this.init();
    if (!this.workerFailed) {
      try {
        const stats = await this.callWorker<SqliteAdapterStats>(
          'PERSIST_GIS_TOPOLOGY',
          topology,
          30000
        );
        this.notifyStats(stats);
        return;
      } catch {}
    }
    await fallbackSet('gis_topology', topology);
    this.notifyStats({
      nodesCount: topology.nodes.length,
      cablesCount: topology.cables.length,
      subscribersCount: topology.subscribers.length,
      lastSyncedAt: Date.now(),
    });
  }

  public async loadGisTopologySnapshot(): Promise<LoadedGisTopology | null> {
    await this.init();
    if (!this.workerFailed) {
      try {
        const res = await this.callWorker<LoadedGisTopology>('LOAD_GIS_TOPOLOGY');
        if (
          res &&
          (res.nodes.length > 0 ||
            res.cables.length > 0 ||
            res.olts.length > 0 ||
            res.subscribers.length > 0)
        ) {
          return res;
        }
      } catch {}
    }
    return await fallbackGet<LoadedGisTopology>('gis_topology');
  }

  public async persistAreaZones(zones: GisAreaZoneRow[]): Promise<void> {
    await this.init();
    if (!this.workerFailed) {
      try {
        const stats = await this.callWorker<SqliteAdapterStats>('PERSIST_AREA_ZONES', { zones });
        this.notifyStats(stats);
        return;
      } catch {}
    }
    await fallbackSet('gis_area_zones', zones);
  }

  public async loadAreaZones(): Promise<GisAreaZoneRow[]> {
    await this.init();
    if (!this.workerFailed) {
      try {
        const zones = await this.callWorker<GisAreaZoneRow[]>('LOAD_AREA_ZONES');
        if (Array.isArray(zones)) return zones;
      } catch {}
    }
    return (await fallbackGet<GisAreaZoneRow[]>('gis_area_zones')) || [];
  }

  public async persistAgentDataset(
    agentId: string,
    dataset: Partial<CachedAgentSqliteDataset>
  ): Promise<void> {
    if (!agentId) return;
    await this.init();
    if (!this.workerFailed) {
      try {
        const stats = await this.callWorker<SqliteAdapterStats>(
          'PERSIST_AGENT_DATASET',
          { agentId, ...dataset },
          30000
        );
        this.notifyStats(stats);
        return;
      } catch {}
    }
    await fallbackSet(`agent_dataset_${agentId}`, dataset);
    this.notifyStats({
      subscribersCount: dataset.subscribers
        ? Object.keys(dataset.subscribers).length
        : this.stats.subscribersCount,
      invoicesCount: dataset.invoices ? dataset.invoices.length : this.stats.invoicesCount,
      ticketsCount: dataset.tickets ? dataset.tickets.length : this.stats.ticketsCount,
      lastSyncedAt: Date.now(),
    });
  }

  public async loadAgentDataset(agentId: string): Promise<CachedAgentSqliteDataset | null> {
    if (!agentId) return null;
    await this.init();
    if (!this.workerFailed) {
      try {
        const res = await this.callWorker<CachedAgentSqliteDataset>('LOAD_AGENT_DATASET', {
          agentId,
        });
        if (
          res &&
          (Object.keys(res.subscribers || {}).length > 0 ||
            (res.invoices || []).length > 0 ||
            (res.tickets || []).length > 0 ||
            Boolean(res.wallet))
        ) {
          return res;
        }
      } catch {}
    }
    return await fallbackGet<CachedAgentSqliteDataset>(`agent_dataset_${agentId}`);
  }

  public async querySubscribers(search = '', limit = 100): Promise<any[]> {
    await this.init();
    if (!this.workerFailed) {
      try {
        return await this.callWorker<any[]>('QUERY_SUBSCRIBERS', { search, limit });
      } catch {}
    }
    const topo = await fallbackGet<LoadedGisTopology>('gis_topology');
    const list = topo?.subscribers || [];
    const q = search.trim().toLowerCase();
    return (q
      ? list.filter(
          (s) =>
            s.username.toLowerCase().includes(q) ||
            (s.area || '').toLowerCase().includes(q) ||
            (s.fullName || '').toLowerCase().includes(q)
        )
      : list
    ).slice(0, limit);
  }
}

export const sqliteOfflineAdapter = new SqliteOfflineDatabaseAdapter();
