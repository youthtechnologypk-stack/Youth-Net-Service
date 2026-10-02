// Offline-First Sync Protocol Types & Schemas

export type SyncEngineState = 
  | 'IDLE' 
  | 'OFFLINE_RECORDING' 
  | 'OFFLINE_PENDING' 
  | 'SYNCING' 
  | 'SYNCED' 
  | 'CONFLICT_RESOLVED' 
  | 'SYNC_ERROR';

export interface OfflineCollectionRecord {
  id: string; // Client-generated UUID (v4)
  offlineReceiptNumber: string; // e.g. "OFF-REC-202610-8492"
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  customerArea: string;
  amount: number;
  paymentMethod: 'cash' | 'online_easypaisa' | 'online_jazzcash' | 'bank_transfer';
  agentId: string;
  agentName: string;
  collectedAt: string; // ISO 8601 string
  clientNonce: string; // Unique nonce to prevent replay attacks
  cryptographicSignature: string; // HMAC-SHA256(agentSecret, invoiceId + amount + nonce + timestamp)
  syncStatus: 'pending' | 'syncing' | 'synced' | 'conflict_rejected';
  syncedAt?: string;
  serverReceiptNumber?: string;
  conflictReason?: string;
  retryCount: number;
}

export interface OfflineSyncRequestPayload {
  protocolVersion: '1.2.0';
  batchId: string;
  agentId: string;
  deviceMetadata: {
    deviceId: string;
    os: string;
    appVersion: string;
    networkType: string;
    batteryLevel?: number;
    clockSkewMs: number;
  };
  collections: OfflineCollectionRecord[];
  clientBatchHash: string; // Hash of all record IDs and signatures
  requestTimestamp: string;
}

export interface OfflineSyncResponsePayload {
  success: boolean;
  batchId: string;
  serverTimestamp: string;
  processedCount: number;
  results: Array<{
    clientRecordId: string;
    offlineReceiptNumber: string;
    serverReceiptNumber: string;
    invoiceId: string;
    status: 'COMMITTED' | 'CONFLICT_ALREADY_PAID' | 'INVALID_SIGNATURE' | 'INVOICE_NOT_FOUND';
    reconciledAmount: number;
    whatsappDispatched: boolean;
    serverNotes?: string;
  }>;
  conflictsCount: number;
  updatedAgentCashInHand: number;
  serverAuditRef: string;
}

export interface OfflineStorageMetrics {
  totalCachedCustomers: number;
  totalCachedInvoices: number;
  pendingQueueRecords: number;
  failedConflictRecords: number;
  storageUsageKb: number;
  lastOnlineSyncAt: string | null;
  isOfflineLocked: boolean; // Locked if offline > 24 hours
  offlineHoursElapsed: number;
  maxOfflineHoursAllowed: number;
}
