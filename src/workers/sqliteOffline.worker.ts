import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import sqlWasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';

const SNAPSHOT_DB_NAME = 'youthnet_sqlite_snapshot_db';
const SNAPSHOT_DB_VERSION = 1;
const SNAPSHOT_STORE = 'snapshots';
const SNAPSHOT_KEY = 'main_v1';

let SQL: SqlJsStatic | null = null;
let db: Database | null = null;
let initPromise: Promise<void> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let isPersisting = false;
let pendingPersistAgain = false;

function yieldWorker(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function openSnapshotIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SNAPSHOT_DB_NAME, SNAPSHOT_DB_VERSION);
    req.onupgradeneeded = () => {
      const idb = req.result;
      if (!idb.objectStoreNames.contains(SNAPSHOT_STORE)) {
        idb.createObjectStore(SNAPSHOT_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open SQLite snapshot IDB'));
  });
}

async function readSnapshotBinary(): Promise<Uint8Array | null> {
  try {
    const idb = await openSnapshotIdb();
    return await new Promise((resolve) => {
      const tx = idb.transaction(SNAPSHOT_STORE, 'readonly');
      const req = tx.objectStore(SNAPSHOT_STORE).get(SNAPSHOT_KEY);
      req.onsuccess = () => {
        const res = req.result;
        idb.close();
        if (res instanceof Uint8Array) {
          resolve(res);
        } else if (res instanceof ArrayBuffer) {
          resolve(new Uint8Array(res));
        } else {
          resolve(null);
        }
      };
      req.onerror = () => {
        idb.close();
        resolve(null);
      };
    });
  } catch {
    return null;
  }
}

async function writeSnapshotBinary(): Promise<number> {
  if (!db) return 0;
  if (isPersisting) {
    pendingPersistAgain = true;
    return 0;
  }

  isPersisting = true;
  let bytesLen = 0;
  try {
    const exported = db.export();
    bytesLen = exported.byteLength;
    const idb = await openSnapshotIdb();
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction(SNAPSHOT_STORE, 'readwrite');
      tx.objectStore(SNAPSHOT_STORE).put(exported, SNAPSHOT_KEY);
      tx.oncomplete = () => {
        idb.close();
        resolve();
      };
      tx.onerror = () => {
        idb.close();
        reject(tx.error || new Error('Failed to persist SQLite binary'));
      };
    });
  } catch (err) {
    console.warn('[sqliteOffline.worker] Snapshot persist warning:', err);
  } finally {
    isPersisting = false;
    if (pendingPersistAgain) {
      pendingPersistAgain = false;
      void writeSnapshotBinary();
    }
  }
  return bytesLen;
}

function scheduleSnapshotPersist(immediate = false): Promise<number> {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (immediate) {
    return writeSnapshotBinary();
  }
  return new Promise((resolve) => {
    persistTimer = setTimeout(async () => {
      persistTimer = null;
      const bytes = await writeSnapshotBinary();
      resolve(bytes);
    }, 200);
  });
}

function ensureSchema(database: Database): void {
  database.run(`
    CREATE TABLE IF NOT EXISTS gis_nodes (
      id TEXT PRIMARY KEY,
      name TEXT,
      node_type TEXT,
      area_name TEXT,
      lat REAL,
      lng REAL,
      payload_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_gis_nodes_area ON gis_nodes(area_name);

    CREATE TABLE IF NOT EXISTS gis_cables (
      id TEXT PRIMARY KEY,
      name TEXT,
      cable_type TEXT,
      payload_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS gis_ports (
      id TEXT PRIMARY KEY,
      node_id TEXT,
      payload_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_gis_ports_node ON gis_ports(node_id);

    CREATE TABLE IF NOT EXISTS gis_splitter_outputs (
      id TEXT PRIMARY KEY,
      node_id TEXT,
      payload_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_gis_outputs_node ON gis_splitter_outputs(node_id);

    CREATE TABLE IF NOT EXISTS gis_olts (
      id TEXT PRIMARY KEY,
      name TEXT,
      payload_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS gis_olt_pon_ports (
      id TEXT PRIMARY KEY,
      olt_id TEXT,
      payload_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS gis_area_zones (
      id TEXT PRIMARY KEY,
      name TEXT,
      payload_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS subscribers (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      area TEXT,
      account_status TEXT,
      payload_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_subscribers_username ON subscribers(username);
    CREATE INDEX IF NOT EXISTS idx_subscribers_area ON subscribers(area);

    CREATE TABLE IF NOT EXISTS agent_invoices (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      subscriber_username TEXT,
      status TEXT,
      payload_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_invoices_agent ON agent_invoices(agent_id);

    CREATE TABLE IF NOT EXISTS agent_tickets (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      subscriber_username TEXT,
      status TEXT,
      payload_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_tickets_agent ON agent_tickets(agent_id);

    CREATE TABLE IF NOT EXISTS agent_wallet_snapshots (
      agent_id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS offline_api_queue (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      url TEXT NOT NULL,
      method TEXT NOT NULL,
      headers_json TEXT NOT NULL,
      body TEXT,
      created_at INTEGER NOT NULL,
      retry_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_offline_queue_agent_created ON offline_api_queue(agent_id, created_at);

    CREATE TABLE IF NOT EXISTS dataset_meta (
      dataset_key TEXT PRIMARY KEY,
      row_count INTEGER NOT NULL,
      synced_at INTEGER NOT NULL
    );
  `);
}

async function ensureDb(): Promise<Database> {
  if (db) return db;
  if (!initPromise) {
    initPromise = (async () => {
      const loader =
        typeof initSqlJs === 'function'
          ? initSqlJs
          : (initSqlJs as unknown as { default: typeof initSqlJs }).default;
      SQL = await loader({
        locateFile: () => sqlWasmUrl,
      });
      const savedBytes = await readSnapshotBinary();
      db = savedBytes && savedBytes.byteLength > 0 ? new SQL.Database(savedBytes) : new SQL.Database();
      ensureSchema(db);
    })();
  }
  await initPromise;
  if (!db) throw new Error('SQLite database failed to initialize');
  return db;
}

function queryScalar(database: Database, sql: string): number {
  const res = database.exec(sql);
  if (!res.length || !res[0].values.length) return 0;
  return Number(res[0].values[0][0] || 0);
}

function readJsonPayloadList<T>(database: Database, sql: string, params: (string | number | null)[] = []): T[] {
  const stmt = database.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  const out: T[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    const raw = row.payload_json;
    if (typeof raw === 'string') {
      try {
        out.push(JSON.parse(raw) as T);
      } catch {
        // Ignore corrupted row
      }
    }
  }
  stmt.free();
  return out;
}

async function runChunkedUpsert<T>(
  database: Database,
  datasetName: string,
  items: T[],
  clearSql: string | null,
  clearParams: (string | number | null)[],
  insertSql: string,
  mapParams: (item: T, now: number) => (string | number | null)[],
  chunkSize = 150
): Promise<void> {
  const now = Date.now();
  const total = items.length;

  if (clearSql) {
    database.run('BEGIN IMMEDIATE');
    try {
      database.run(clearSql, clearParams);
      database.run('COMMIT');
    } catch (err) {
      database.run('ROLLBACK');
      throw err;
    }
  }

  for (let start = 0; start < total; start += chunkSize) {
    const end = Math.min(total, start + chunkSize);
    database.run('BEGIN IMMEDIATE');
    const stmt = database.prepare(insertSql);
    try {
      for (let i = start; i < end; i++) {
        stmt.run(mapParams(items[i], now));
      }
      stmt.free();
      database.run('COMMIT');
    } catch (err) {
      stmt.free();
      database.run('ROLLBACK');
      throw err;
    }

    self.postMessage({
      type: 'SYNC_PROGRESS',
      dataset: datasetName,
      processed: end,
      total,
    });

    if (end < total) {
      await yieldWorker();
    }
  }

  database.run(
    `INSERT OR REPLACE INTO dataset_meta (dataset_key, row_count, synced_at) VALUES (?, ?, ?)`,
    [datasetName, total, now]
  );
}

function getStatsSync(database: Database) {
  const nodesCount = queryScalar(database, 'SELECT COUNT(*) FROM gis_nodes');
  const cablesCount = queryScalar(database, 'SELECT COUNT(*) FROM gis_cables');
  const subscribersCount = queryScalar(database, 'SELECT COUNT(*) FROM subscribers');
  const invoicesCount = queryScalar(database, 'SELECT COUNT(*) FROM agent_invoices');
  const ticketsCount = queryScalar(database, 'SELECT COUNT(*) FROM agent_tickets');
  const queuedRequestsCount = queryScalar(database, 'SELECT COUNT(*) FROM offline_api_queue');
  const lastSyncedAt = queryScalar(database, 'SELECT COALESCE(MAX(synced_at), 0) FROM dataset_meta');

  return {
    engine: 'sqlite-wasm-worker' as const,
    nodesCount,
    cablesCount,
    subscribersCount,
    invoicesCount,
    ticketsCount,
    queuedRequestsCount,
    lastSyncedAt: lastSyncedAt > 0 ? lastSyncedAt : null,
  };
}

self.onmessage = async (event: MessageEvent<{ id: string; action: string; payload?: any }>) => {
  const { id, action, payload } = event.data;

  try {
    const database = await ensureDb();

    switch (action) {
      case 'INIT': {
        const stats = getStatsSync(database);
        self.postMessage({ id, ok: true, data: stats });
        break;
      }

      case 'GET_STATS': {
        self.postMessage({ id, ok: true, data: getStatsSync(database) });
        break;
      }

      case 'ENQUEUE_REQUEST': {
        const item = payload;
        database.run(
          `INSERT OR REPLACE INTO offline_api_queue
           (id, agent_id, url, method, headers_json, body, created_at, retry_count, last_error)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            item.id,
            item.agentId,
            item.url,
            item.method,
            JSON.stringify(item.headers || {}),
            item.body ?? null,
            item.createdAt,
            item.retryCount || 0,
            item.lastError ?? null,
          ]
        );
        await scheduleSnapshotPersist(true);
        self.postMessage({ id, ok: true, data: getStatsSync(database) });
        break;
      }

      case 'GET_QUEUED_REQUESTS': {
        const agentId = payload?.agentId as string | undefined;
        const sql = agentId
          ? `SELECT * FROM offline_api_queue WHERE agent_id = ? ORDER BY created_at ASC`
          : `SELECT * FROM offline_api_queue ORDER BY created_at ASC`;
        const stmt = database.prepare(sql);
        if (agentId) stmt.bind([agentId]);
        const rows: any[] = [];
        while (stmt.step()) {
          const r = stmt.getAsObject();
          let headers: Record<string, string> = {};
          try {
            headers = JSON.parse(String(r.headers_json || '{}'));
          } catch {}
          rows.push({
            id: String(r.id),
            agentId: String(r.agent_id),
            url: String(r.url),
            method: String(r.method),
            headers,
            body: r.body !== null && r.body !== undefined ? String(r.body) : null,
            createdAt: Number(r.created_at),
            retryCount: Number(r.retry_count || 0),
            lastError: r.last_error ? String(r.last_error) : undefined,
          });
        }
        stmt.free();
        self.postMessage({ id, ok: true, data: rows });
        break;
      }

      case 'UPDATE_QUEUED_REQUEST': {
        const item = payload;
        database.run(
          `UPDATE offline_api_queue SET retry_count = ?, last_error = ? WHERE id = ?`,
          [item.retryCount || 0, item.lastError ?? null, item.id]
        );
        await scheduleSnapshotPersist(false);
        self.postMessage({ id, ok: true, data: getStatsSync(database) });
        break;
      }

      case 'REMOVE_QUEUED_REQUEST': {
        database.run(`DELETE FROM offline_api_queue WHERE id = ?`, [payload.id]);
        await scheduleSnapshotPersist(true);
        self.postMessage({ id, ok: true, data: getStatsSync(database) });
        break;
      }

      case 'PERSIST_GIS_TOPOLOGY': {
        const t = payload || {};
        await runChunkedUpsert(
          database,
          'gis_olts',
          Array.isArray(t.olts) ? t.olts : [],
          'DELETE FROM gis_olts',
          [],
          `INSERT OR REPLACE INTO gis_olts (id, name, payload_json, updated_at) VALUES (?, ?, ?, ?)`,
          (o: any, now) => [String(o.id), String(o.name || ''), JSON.stringify(o), now]
        );
        await runChunkedUpsert(
          database,
          'gis_olt_pon_ports',
          Array.isArray(t.ponPorts) ? t.ponPorts : [],
          'DELETE FROM gis_olt_pon_ports',
          [],
          `INSERT OR REPLACE INTO gis_olt_pon_ports (id, olt_id, payload_json, updated_at) VALUES (?, ?, ?, ?)`,
          (p: any, now) => [String(p.id), String(p.olt_id || ''), JSON.stringify(p), now]
        );
        await runChunkedUpsert(
          database,
          'gis_nodes',
          Array.isArray(t.nodes) ? t.nodes : [],
          'DELETE FROM gis_nodes',
          [],
          `INSERT OR REPLACE INTO gis_nodes (id, name, node_type, area_name, lat, lng, payload_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          (n: any, now) => [
            String(n.id),
            String(n.name || ''),
            String(n.node_type || ''),
            String(n.area_name || ''),
            Number(n.lat || 0),
            Number(n.lng || 0),
            JSON.stringify(n),
            now,
          ]
        );
        await runChunkedUpsert(
          database,
          'gis_cables',
          Array.isArray(t.cables) ? t.cables : [],
          'DELETE FROM gis_cables',
          [],
          `INSERT OR REPLACE INTO gis_cables (id, name, cable_type, payload_json, updated_at) VALUES (?, ?, ?, ?, ?)`,
          (c: any, now) => [String(c.id), String(c.name || ''), String(c.cable_type || ''), JSON.stringify(c), now]
        );
        await runChunkedUpsert(
          database,
          'gis_ports',
          Array.isArray(t.ports) ? t.ports : [],
          'DELETE FROM gis_ports',
          [],
          `INSERT OR REPLACE INTO gis_ports (id, node_id, payload_json, updated_at) VALUES (?, ?, ?, ?)`,
          (p: any, now) => [String(p.id), String(p.node_id || ''), JSON.stringify(p), now]
        );
        await runChunkedUpsert(
          database,
          'gis_splitter_outputs',
          Array.isArray(t.splitterOutputs) ? t.splitterOutputs : [],
          'DELETE FROM gis_splitter_outputs',
          [],
          `INSERT OR REPLACE INTO gis_splitter_outputs (id, node_id, payload_json, updated_at) VALUES (?, ?, ?, ?)`,
          (o: any, now) => [String(o.id), String(o.node_id || ''), JSON.stringify(o), now]
        );
        if (Array.isArray(t.subscribers)) {
          await runChunkedUpsert(
            database,
            'subscribers',
            t.subscribers,
            null,
            [],
            `INSERT OR REPLACE INTO subscribers (id, username, area, account_status, payload_json, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
            (s: any, now) => [
              String(s.id || s.username),
              String(s.username || ''),
              String(s.area || ''),
              String(s.accountStatus || s.account_status || ''),
              JSON.stringify(s),
              now,
            ]
          );
        }
        await scheduleSnapshotPersist(false);
        self.postMessage({ id, ok: true, data: getStatsSync(database) });
        break;
      }

      case 'LOAD_GIS_TOPOLOGY': {
        const result = {
          olts: readJsonPayloadList(database, 'SELECT payload_json FROM gis_olts'),
          ponPorts: readJsonPayloadList(database, 'SELECT payload_json FROM gis_olt_pon_ports'),
          nodes: readJsonPayloadList(database, 'SELECT payload_json FROM gis_nodes'),
          cables: readJsonPayloadList(database, 'SELECT payload_json FROM gis_cables'),
          ports: readJsonPayloadList(database, 'SELECT payload_json FROM gis_ports'),
          splitterOutputs: readJsonPayloadList(database, 'SELECT payload_json FROM gis_splitter_outputs'),
          subscribers: readJsonPayloadList(database, 'SELECT payload_json FROM subscribers'),
          schemaMissing: false,
          oltSchemaMissing: false,
        };
        self.postMessage({ id, ok: true, data: result });
        break;
      }

      case 'PERSIST_AREA_ZONES': {
        const zones = Array.isArray(payload?.zones) ? payload.zones : [];
        await runChunkedUpsert(
          database,
          'gis_area_zones',
          zones,
          'DELETE FROM gis_area_zones',
          [],
          `INSERT OR REPLACE INTO gis_area_zones (id, name, payload_json, updated_at) VALUES (?, ?, ?, ?)`,
          (z: any, now) => [String(z.id), String(z.name || ''), JSON.stringify(z), now]
        );
        await scheduleSnapshotPersist(false);
        self.postMessage({ id, ok: true, data: getStatsSync(database) });
        break;
      }

      case 'LOAD_AREA_ZONES': {
        const zones = readJsonPayloadList(database, 'SELECT payload_json FROM gis_area_zones');
        self.postMessage({ id, ok: true, data: zones });
        break;
      }

      case 'PERSIST_AGENT_DATASET': {
        const { agentId, subscribers, invoices, tickets, wallet } = payload || {};
        if (subscribers && typeof subscribers === 'object') {
          const entries = Object.entries(subscribers).map(([uname, info]: [string, any]) => ({
            id: `sub_${uname.toLowerCase()}`,
            username: uname,
            ...(info || {}),
          }));
          await runChunkedUpsert(
            database,
            'subscribers',
            entries,
            null,
            [],
            `INSERT OR REPLACE INTO subscribers (id, username, area, account_status, payload_json, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
            (s: any, now) => [
              String(s.id || s.username),
              String(s.username || ''),
              String(s.area || ''),
              String(s.account_status || 'ACTIVE'),
              JSON.stringify(s),
              now,
            ]
          );
        }
        if (Array.isArray(invoices) && agentId) {
          await runChunkedUpsert(
            database,
            'agent_invoices',
            invoices,
            'DELETE FROM agent_invoices WHERE agent_id = ?',
            [agentId],
            `INSERT OR REPLACE INTO agent_invoices (id, agent_id, subscriber_username, status, payload_json, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
            (inv: any, now) => [
              String(inv.id),
              String(agentId),
              String(inv.subscriber_username || ''),
              String(inv.status || ''),
              JSON.stringify(inv),
              now,
            ]
          );
        }
        if (Array.isArray(tickets) && agentId) {
          await runChunkedUpsert(
            database,
            'agent_tickets',
            tickets,
            'DELETE FROM agent_tickets WHERE agent_id = ?',
            [agentId],
            `INSERT OR REPLACE INTO agent_tickets (id, agent_id, subscriber_username, status, payload_json, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
            (t: any, now) => [
              String(t.id),
              String(agentId),
              String(t.subscriber_username || ''),
              String(t.status || ''),
              JSON.stringify(t),
              now,
            ]
          );
        }
        if (wallet && agentId) {
          database.run(
            `INSERT OR REPLACE INTO agent_wallet_snapshots (agent_id, payload_json, updated_at) VALUES (?, ?, ?)`,
            [String(agentId), JSON.stringify(wallet), Date.now()]
          );
        }
        await scheduleSnapshotPersist(false);
        self.postMessage({ id, ok: true, data: getStatsSync(database) });
        break;
      }

      case 'LOAD_AGENT_DATASET': {
        const agentId = String(payload?.agentId || '');
        const subRows = readJsonPayloadList<any>(database, 'SELECT payload_json FROM subscribers');
        const subscribers: Record<string, any> = {};
        for (const s of subRows) {
          const uname = String(s.username || '').trim().toLowerCase();
          if (uname) {
            subscribers[uname] = {
              phone: s.phone || '',
              address: s.address || '',
              full_name: s.full_name || s.fullName || '',
              area: s.area || '',
              package_speed: s.package_speed || s.packageSpeed || '',
            };
          }
        }
        const invoices = readJsonPayloadList(
          database,
          'SELECT payload_json FROM agent_invoices WHERE agent_id = ?',
          [agentId]
        );
        const tickets = readJsonPayloadList(
          database,
          'SELECT payload_json FROM agent_tickets WHERE agent_id = ?',
          [agentId]
        );
        const wallets = readJsonPayloadList(
          database,
          'SELECT payload_json FROM agent_wallet_snapshots WHERE agent_id = ?',
          [agentId]
        );
        self.postMessage({
          id,
          ok: true,
          data: {
            subscribers,
            invoices,
            tickets,
            wallet: wallets[0] || null,
          },
        });
        break;
      }

      case 'QUERY_SUBSCRIBERS': {
        const search = String(payload?.search || '').trim().toLowerCase();
        const limit = Math.max(1, Math.min(500, Number(payload?.limit || 100)));
        const sql = search
          ? `SELECT payload_json FROM subscribers WHERE LOWER(username) LIKE ? OR LOWER(area) LIKE ? LIMIT ?`
          : `SELECT payload_json FROM subscribers LIMIT ?`;
        const params = search ? [`%${search}%`, `%${search}%`, limit] : [limit];
        const rows = readJsonPayloadList(database, sql, params);
        self.postMessage({ id, ok: true, data: rows });
        break;
      }

      default:
        throw new Error(`Unknown SQLite worker action: ${action}`);
    }
  } catch (err: any) {
    self.postMessage({
      id,
      ok: false,
      error: String(err?.message || err || 'SQLite worker error'),
    });
  }
};
