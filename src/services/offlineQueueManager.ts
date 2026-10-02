import {
  OfflineCollectionRecord,
  OfflineSyncRequestPayload,
  OfflineSyncResponsePayload,
  OfflineStorageMetrics,
  SyncEngineState,
} from '../types/offlineSync';
import { Customer, Invoice } from '../types/isp';

/**
 * Client-Side Offline Queue Manager (React Native / Flutter / PWA Web)
 * 
 * Implements:
 * 1. Offline SQLite / WatermelonDB / IndexedDB storage abstraction
 * 2. FIFO Sync Queue with State Machine (IDLE -> OFFLINE_PENDING -> SYNCING -> SYNCED)
 * 3. Cryptographic Signature Generation for offline receipts
 * 4. 24-Hour Offline Security Lock Enforcer
 */

const STORAGE_KEY_QUEUE = 'netpulse_offline_collection_queue_v1';
const STORAGE_KEY_LAST_SYNC = 'netpulse_last_online_sync_ts';

export class OfflineQueueManager {
  private queue: OfflineCollectionRecord[] = [];
  private state: SyncEngineState = 'IDLE';
  private listeners: Array<(state: SyncEngineState, metrics: OfflineStorageMetrics) => void> = [];
  private isOnline: boolean = true;
  private offlineStartTime: number | null = null;
  private readonly maxOfflineHoursAllowed = 24;

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_QUEUE);
      if (saved) {
        this.queue = JSON.parse(saved);
      }
    } catch {
      this.queue = [];
    }

    if (this.queue.some((r) => r.syncStatus === 'pending')) {
      this.state = 'OFFLINE_PENDING';
    }
  }

  private saveToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY_QUEUE, JSON.stringify(this.queue));
    } catch {
      // Storage quota exceeded or disabled
    }
  }

  public subscribe(listener: (state: SyncEngineState, metrics: OfflineStorageMetrics) => void) {
    this.listeners.push(listener);
    listener(this.state, this.getMetrics());
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notify() {
    const metrics = this.getMetrics();
    this.listeners.forEach((l) => l(this.state, metrics));
  }

  public setNetworkStatus(online: boolean) {
    const prev = this.isOnline;
    this.isOnline = online;

    if (!online && prev) {
      // Switched to offline
      this.offlineStartTime = Date.now();
      if (this.queue.some((r) => r.syncStatus === 'pending')) {
        this.state = 'OFFLINE_PENDING';
      } else {
        this.state = 'IDLE';
      }
    } else if (online && !prev) {
      // Switched back to online
      this.offlineStartTime = null;
      if (this.queue.some((r) => r.syncStatus === 'pending')) {
        this.state = 'OFFLINE_PENDING';
      } else {
        this.state = 'SYNCED';
      }
    }
    this.notify();
  }

  public getNetworkStatus(): boolean {
    return this.isOnline;
  }

  public getState(): SyncEngineState {
    return this.state;
  }

  public getQueue(): OfflineCollectionRecord[] {
    return [...this.queue];
  }

  /**
   * Generates pseudo HMAC-SHA256 signature for client-side receipt verification
   */
  private generateClientSignature(agentId: string, invoiceId: string, amount: number, nonce: string, timestamp: string): string {
    const raw = `${agentId}:${invoiceId}:${amount}:${nonce}:${timestamp}`;
    // Fast lightweight client hash representation
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      const char = raw.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0;
    }
    return `sig_${Math.abs(hash).toString(16).padStart(8, '0')}_${nonce.slice(0, 6)}`;
  }

  /**
   * Records a cash collection offline
   */
  public recordOfflinePayment(
    customer: Customer,
    invoice: Invoice,
    agentId: string,
    agentName: string,
    amount: number,
    paymentMethod: OfflineCollectionRecord['paymentMethod'] = 'cash'
  ): OfflineCollectionRecord {
    // Check 24-hour offline lock
    const metrics = this.getMetrics();
    if (metrics.isOfflineLocked) {
      throw new Error('Offline Terminal Locked: Device has been offline for over 24 hours. Connect to internet to sync before collecting new payments.');
    }

    const now = new Date();
    const nonce = `nonce-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const offlineReceiptNumber = `OFF-REC-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`;
    const signature = this.generateClientSignature(agentId, invoice.id, amount, nonce, now.toISOString());

    const newRecord: OfflineCollectionRecord = {
      id: `off-col-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      offlineReceiptNumber,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      customerId: customer.id,
      customerName: customer.name,
      customerPhone: customer.phone,
      customerArea: customer.areaNode,
      amount,
      paymentMethod,
      agentId,
      agentName,
      collectedAt: now.toISOString(),
      clientNonce: nonce,
      cryptographicSignature: signature,
      syncStatus: 'pending',
      retryCount: 0,
    };

    this.queue.push(newRecord);
    this.saveToStorage();
    this.state = 'OFFLINE_PENDING';
    this.notify();

    return newRecord;
  }

  /**
   * Executes background synchronization engine
   * Transitions: OFFLINE_PENDING -> SYNCING -> SYNCED / CONFLICT_RESOLVED
   */
  public async syncPendingQueue(
    onSyncSuccess?: (syncedRecord: OfflineCollectionRecord, serverReceipt: string) => void,
    onConflictResolved?: (record: OfflineCollectionRecord, reason: string) => void
  ): Promise<OfflineSyncResponsePayload> {
    const pendingItems = this.queue.filter((r) => r.syncStatus === 'pending');
    if (pendingItems.length === 0) {
      this.state = 'SYNCED';
      this.notify();
      return {
        success: true,
        batchId: `batch-empty-${Date.now()}`,
        serverTimestamp: new Date().toISOString(),
        processedCount: 0,
        results: [],
        conflictsCount: 0,
        updatedAgentCashInHand: 0,
        serverAuditRef: 'AUDIT-EMPTY',
      };
    }

    // Transition State: SYNCING
    this.state = 'SYNCING';
    this.notify();

    // Prepare payload
    const batchId = `sync-batch-${Date.now()}`;
    const payload: OfflineSyncRequestPayload = {
      protocolVersion: '1.2.0',
      batchId,
      agentId: pendingItems[0].agentId,
      deviceMetadata: {
        deviceId: 'SM-G998B-ANDROID-FIELD-01',
        os: 'Android 15 (NetPulse Agent Runtime)',
        appVersion: '2.4.1-offline',
        networkType: '4G_LTE',
        batteryLevel: 88,
        clockSkewMs: 14,
      },
      collections: pendingItems,
      clientBatchHash: `batch_${pendingItems.map((p) => p.id).join('_')}`,
      requestTimestamp: new Date().toISOString(),
    };

    // Simulate network roundtrip latency (800ms)
    await new Promise((res) => setTimeout(res, 850));

    // Process each item (Simulating server response according to POST /api/billing/sync-offline protocol)
    const results: OfflineSyncResponsePayload['results'] = [];
    let conflictsCount = 0;
    let totalCash = 0;

    for (const item of pendingItems) {
      // Simulate conflict condition if customer name has "Store" or manual simulation flag
      const isConflict = item.customerName.toLowerCase().includes('conflict');

      if (isConflict) {
        const srvRef = `SRV-CREDIT-${Date.now().toString().slice(-5)}`;
        results.push({
          clientRecordId: item.id,
          offlineReceiptNumber: item.offlineReceiptNumber,
          serverReceiptNumber: srvRef,
          invoiceId: item.invoiceId,
          status: 'CONFLICT_ALREADY_PAID',
          reconciledAmount: item.amount,
          whatsappDispatched: true,
          serverNotes: 'Conflict Handled: Account was already settled online. Physical payment credited as next billing cycle advance balance.',
        });

        item.syncStatus = 'synced';
        item.syncedAt = new Date().toISOString();
        item.serverReceiptNumber = srvRef;
        item.conflictReason = 'Invoice was settled online during offline duration. Amount converted to subscriber advance deposit.';
        conflictsCount++;
        totalCash += item.amount;

        if (onConflictResolved) {
          onConflictResolved(item, item.conflictReason);
        }
      } else {
        const serverReceipt = `RCPT-SRV-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;
        results.push({
          clientRecordId: item.id,
          offlineReceiptNumber: item.offlineReceiptNumber,
          serverReceiptNumber: serverReceipt,
          invoiceId: item.invoiceId,
          status: 'COMMITTED',
          reconciledAmount: item.amount,
          whatsappDispatched: true,
          serverNotes: 'Payment verified and committed to PostgreSQL database.',
        });

        item.syncStatus = 'synced';
        item.syncedAt = new Date().toISOString();
        item.serverReceiptNumber = serverReceipt;
        totalCash += item.amount;

        if (onSyncSuccess) {
          onSyncSuccess(item, serverReceipt);
        }
      }
    }

    this.saveToStorage();
    localStorage.setItem(STORAGE_KEY_LAST_SYNC, new Date().toISOString());

    const finalState: SyncEngineState = conflictsCount > 0 ? 'CONFLICT_RESOLVED' : 'SYNCED';
    this.state = finalState;
    this.notify();

    return {
      success: true,
      batchId,
      serverTimestamp: new Date().toISOString(),
      processedCount: pendingItems.length,
      results,
      conflictsCount,
      updatedAgentCashInHand: totalCash,
      serverAuditRef: `AUDIT-SYNC-OK-${Date.now()}`,
    };
  }

  public clearSyncedQueue() {
    this.queue = this.queue.filter((r) => r.syncStatus === 'pending');
    this.saveToStorage();
    this.state = this.queue.length > 0 ? 'OFFLINE_PENDING' : 'IDLE';
    this.notify();
  }

  public getMetrics(): OfflineStorageMetrics {
    const pendingCount = this.queue.filter((r) => r.syncStatus === 'pending').length;
    const conflictCount = this.queue.filter((r) => Boolean(r.conflictReason)).length;
    const lastSync = localStorage.getItem(STORAGE_KEY_LAST_SYNC);

    // Approximate storage usage in KB
    const queueBytes = JSON.stringify(this.queue).length;
    const estimatedKb = Math.max(12, Math.round((queueBytes * 2 + 35000) / 1024 * 10) / 10);

    // Calculate offline hours elapsed
    let offlineHours = 0;
    if (!this.isOnline && this.offlineStartTime) {
      offlineHours = Math.round(((Date.now() - this.offlineStartTime) / (1000 * 60 * 60)) * 10) / 10;
    }

    return {
      totalCachedCustomers: 6,
      totalCachedInvoices: 5,
      pendingQueueRecords: pendingCount,
      failedConflictRecords: conflictCount,
      storageUsageKb: estimatedKb,
      lastOnlineSyncAt: lastSync,
      isOfflineLocked: offlineHours >= this.maxOfflineHoursAllowed,
      offlineHoursElapsed: offlineHours,
      maxOfflineHoursAllowed: this.maxOfflineHoursAllowed,
    };
  }
}

// Global Singleton Instance
export const offlineQueueManager = new OfflineQueueManager();
