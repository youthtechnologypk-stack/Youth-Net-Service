import React, { useState, useEffect } from 'react';
import {
  Wifi,
  WifiOff,
  RefreshCw,
  HardDrive,
  Database,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ArrowRight,
  Send,
  Zap,
  Lock,
  Unlock,
  FileText,
  DollarSign,
  Smartphone,
  Layers,
  Trash2,
} from 'lucide-react';
import { useISP } from '../context/ISPContext';
import { offlineQueueManager } from '../services/offlineQueueManager';
import {
  OfflineCollectionRecord,
  OfflineStorageMetrics,
  SyncEngineState,
} from '../types/offlineSync';
import { Customer, Invoice } from '../types/isp';

interface OfflineActivityDashboardProps {
  currentAgentId: string;
  onOpenReceiptModal: (invoice: Invoice) => void;
}

export const OfflineActivityDashboard: React.FC<OfflineActivityDashboardProps> = ({
  currentAgentId,
  onOpenReceiptModal,
}) => {
  const { customers, invoices, agents, collectAgentCashPayment } = useISP();

  const currentAgent = agents.find((a) => a.id === currentAgentId) || agents[0];

  const [isOnline, setIsOnline] = useState<boolean>(offlineQueueManager.getNetworkStatus());
  const [syncState, setSyncState] = useState<SyncEngineState>(offlineQueueManager.getState());
  const [metrics, setMetrics] = useState<OfflineStorageMetrics>(offlineQueueManager.getMetrics());
  const [queue, setQueue] = useState<OfflineCollectionRecord[]>(offlineQueueManager.getQueue());
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [bannerNotice, setBannerNotice] = useState<{ type: 'success' | 'warning' | 'info'; text: string } | null>(null);

  // Form for quick offline collection test
  const unpaidInvoices = invoices.filter((i) => i.status !== 'paid');
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string>(unpaidInvoices[0]?.id || '');
  const [collectedAmount, setCollectedAmount] = useState<number>(unpaidInvoices[0]?.totalAmount || 25);
  const [simulateConflict, setSimulateConflict] = useState<boolean>(false);

  useEffect(() => {
    const unsubscribe = offlineQueueManager.subscribe((state, newMetrics) => {
      setSyncState(state);
      setMetrics(newMetrics);
      setQueue(offlineQueueManager.getQueue());
      setIsOnline(offlineQueueManager.getNetworkStatus());
    });
    return () => unsubscribe();
  }, []);

  const handleToggleNetwork = () => {
    const nextOnline = !isOnline;
    offlineQueueManager.setNetworkStatus(nextOnline);
    setIsOnline(nextOnline);

    if (nextOnline) {
      setBannerNotice({
        type: 'info',
        text: 'Network restored (4G LTE Connected). Background auto-sync worker initialized.',
      });
      // If there are pending items, auto-sync when network returns
      if (offlineQueueManager.getQueue().some((r) => r.syncStatus === 'pending')) {
        handleTriggerSync();
      }
    } else {
      setBannerNotice({
        type: 'warning',
        text: 'Offline Mode Active (Airplane Mode / No Coverage). Payments will be cryptographically queued locally.',
      });
    }
    setTimeout(() => setBannerNotice(null), 4000);
  };

  const handleOfflineCollect = () => {
    const targetInvoice = invoices.find((i) => i.id === selectedInvoiceId) || unpaidInvoices[0];
    if (!targetInvoice) {
      setBannerNotice({ type: 'warning', text: 'No unpaid invoice available to collect.' });
      return;
    }

    const targetCustomer = customers.find((c) => c.id === targetInvoice.customerId) || customers[0];

    try {
      // Modify name if simulating conflict
      const customerToRecord = simulateConflict
        ? { ...targetCustomer, name: `${targetCustomer.name} (CONFLICT SIMULATED)` }
        : targetCustomer;

      const record = offlineQueueManager.recordOfflinePayment(
        customerToRecord,
        targetInvoice,
        currentAgent.id,
        currentAgent.name,
        Number(collectedAmount) || targetInvoice.totalAmount,
        'cash'
      );

      // In real offline app: local wallet is credited immediately
      currentAgent.cashInHand += record.amount;

      setBannerNotice({
        type: 'success',
        text: `Offline Receipt ${record.offlineReceiptNumber} generated! Digital signature ${record.cryptographicSignature.slice(0, 14)}... stored in SQLite queue.`,
      });
      setTimeout(() => setBannerNotice(null), 5000);
    } catch (err: any) {
      setBannerNotice({ type: 'warning', text: err.message });
    }
  };

  const handleTriggerSync = async () => {
    if (!isOnline) {
      setBannerNotice({
        type: 'warning',
        text: 'Cannot push sync while device is Offline. Please switch network to Online first.',
      });
      setTimeout(() => setBannerNotice(null), 3000);
      return;
    }

    setIsSyncing(true);
    try {
      const response = await offlineQueueManager.syncPendingQueue(
        (syncedRecord, serverReceipt) => {
          // Reconcile with ISPContext / server database
          const targetInv = invoices.find((i) => i.id === syncedRecord.invoiceId);
          if (targetInv && targetInv.status !== 'paid') {
            collectAgentCashPayment(
              targetInv.id,
              syncedRecord.agentId,
              syncedRecord.amount
            );
          }
        },
        (conflictRecord, reason) => {
          setBannerNotice({
            type: 'warning',
            text: `Sync Conflict Handled: ${conflictRecord.customerName} - ${reason}`,
          });
        }
      );

      if (response.processedCount > 0) {
        setBannerNotice({
          type: 'success',
          text: `Sync Complete: ${response.processedCount} offline record(s) reconciled with PostgreSQL & WhatsApp receipts sent!`,
        });
      } else {
        setBannerNotice({ type: 'info', text: 'Queue is clean. No pending offline records to sync.' });
      }
      setTimeout(() => setBannerNotice(null), 5000);
    } catch (err: any) {
      setBannerNotice({ type: 'warning', text: `Sync failed: ${err.message}` });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleClearSynced = () => {
    offlineQueueManager.clearSyncedQueue();
    setBannerNotice({ type: 'info', text: 'Archived synced receipts cleared from local database cache.' });
    setTimeout(() => setBannerNotice(null), 3000);
  };

  return (
    <div className="space-y-4 text-xs font-sans">
      {/* Network Connectivity & Simulation Control Header */}
      <div className={`p-4 rounded-xl border transition-all ${
        isOnline
          ? 'bg-emerald-950/40 border-emerald-800/80 shadow-emerald-950/20'
          : 'bg-rose-950/50 border-rose-800 shadow-rose-950/30'
      }`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl border ${
              isOnline
                ? 'bg-emerald-900/60 border-emerald-600 text-emerald-400'
                : 'bg-rose-900/60 border-rose-600 text-rose-400 animate-pulse'
            }`}>
              {isOnline ? <Wifi className="w-5 h-5" /> : <WifiOff className="w-5 h-5" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-bold text-white">
                  {isOnline ? 'Network Online (4G LTE Connected)' : 'Offline Mode Active (Airplane Mode)'}
                </h4>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-bold uppercase ${
                  isOnline
                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-700'
                    : 'bg-rose-950 text-rose-300 border border-rose-700'
                }`}>
                  {isOnline ? 'Online Sync' : 'Local Storage Only'}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {isOnline
                  ? 'All local SQLite transactions stream automatically to PostgreSQL backend.'
                  : 'Zero connectivity simulated. All collections will be stored locally in SQLite / WatermelonDB.'}
              </p>
            </div>
          </div>

          <button
            onClick={handleToggleNetwork}
            className={`px-3.5 py-2 rounded-lg font-bold text-xs transition flex items-center justify-center gap-2 cursor-pointer shadow-md shrink-0 ${
              isOnline
                ? 'bg-rose-600 hover:bg-rose-500 text-white'
                : 'bg-emerald-600 hover:bg-emerald-500 text-slate-950'
            }`}
          >
            {isOnline ? (
              <>
                <WifiOff className="w-3.5 h-3.5" />
                <span>Simulate Offline Mode</span>
              </>
            ) : (
              <>
                <Wifi className="w-3.5 h-3.5" />
                <span>Restore Online Signal</span>
              </>
            )}
          </button>
        </div>
      </div>

      {bannerNotice && (
        <div className={`p-3 rounded-xl border text-xs font-mono flex items-center gap-2 animate-fade-in ${
          bannerNotice.type === 'success'
            ? 'bg-emerald-950/80 border-emerald-700 text-emerald-300'
            : bannerNotice.type === 'warning'
            ? 'bg-amber-950/80 border-amber-700 text-amber-300'
            : 'bg-cyan-950/80 border-cyan-700 text-cyan-300'
        }`}>
          {bannerNotice.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          )}
          <span>{bannerNotice.text}</span>
        </div>
      )}

      {/* Real-Time Sync Status & State Machine Visualizer */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 space-y-3 shadow-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-cyan-400" />
            <span className="font-bold text-white text-xs">Sync State Machine</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-400 font-mono">Current Status:</span>
            <span className={`px-2.5 py-0.5 rounded-full font-mono text-[10px] font-bold uppercase tracking-wider ${
              syncState === 'SYNCING'
                ? 'bg-amber-950 text-amber-300 border border-amber-700 animate-pulse'
                : syncState === 'OFFLINE_PENDING'
                ? 'bg-cyan-950 text-cyan-300 border border-cyan-700'
                : syncState === 'CONFLICT_RESOLVED'
                ? 'bg-purple-950 text-purple-300 border border-purple-700'
                : 'bg-emerald-950 text-emerald-300 border border-emerald-700'
            }`}>
              {syncState}
            </span>
          </div>
        </div>

        {/* State Flow Steps */}
        <div className="grid grid-cols-4 gap-1.5 text-center font-mono text-[10px]">
          <div className={`p-2 rounded-lg border ${
            syncState === 'OFFLINE_RECORDING' || syncState === 'OFFLINE_PENDING'
              ? 'bg-cyan-950/60 border-cyan-600 text-cyan-300 font-bold'
              : 'bg-slate-950 border-slate-800 text-slate-500'
          }`}>
            <span>1. Local Write</span>
          </div>
          <div className={`p-2 rounded-lg border ${
            metrics.pendingQueueRecords > 0
              ? 'bg-amber-950/60 border-amber-600 text-amber-300 font-bold'
              : 'bg-slate-950 border-slate-800 text-slate-500'
          }`}>
            <span>2. FIFO Queue ({metrics.pendingQueueRecords})</span>
          </div>
          <div className={`p-2 rounded-lg border ${
            syncState === 'SYNCING'
              ? 'bg-indigo-950/60 border-indigo-600 text-indigo-300 font-bold animate-pulse'
              : 'bg-slate-950 border-slate-800 text-slate-500'
          }`}>
            <span>3. Batch Push</span>
          </div>
          <div className={`p-2 rounded-lg border ${
            syncState === 'SYNCED' || syncState === 'CONFLICT_RESOLVED'
              ? 'bg-emerald-950/60 border-emerald-600 text-emerald-300 font-bold'
              : 'bg-slate-950 border-slate-800 text-slate-500'
          }`}>
            <span>4. Reconciled ✓</span>
          </div>
        </div>
      </div>

      {/* Storage, Queue & Security Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="bg-slate-900 border border-slate-800 p-3 rounded-xl">
          <span className="text-[10px] text-slate-400 block">Pending Sync Queue</span>
          <div className="flex items-center justify-between mt-1">
            <span className="text-base font-bold font-mono text-cyan-300">
              {metrics.pendingQueueRecords} <span className="text-[10px] text-slate-400">txs</span>
            </span>
            <Clock className="w-4 h-4 text-cyan-400" />
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-3 rounded-xl">
          <span className="text-[10px] text-slate-400 block">Failed / Conflicts</span>
          <div className="flex items-center justify-between mt-1">
            <span className="text-base font-bold font-mono text-amber-400">
              {metrics.failedConflictRecords} <span className="text-[10px] text-slate-400">resolved</span>
            </span>
            <AlertTriangle className="w-4 h-4 text-amber-400" />
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-3 rounded-xl">
          <span className="text-[10px] text-slate-400 block">SQLite / Storage</span>
          <div className="flex items-center justify-between mt-1">
            <span className="text-base font-bold font-mono text-emerald-400">
              {metrics.storageUsageKb} <span className="text-[10px] text-slate-400">KB</span>
            </span>
            <HardDrive className="w-4 h-4 text-emerald-400" />
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-3 rounded-xl">
          <span className="text-[10px] text-slate-400 block">24h Security Lock</span>
          <div className="flex items-center justify-between mt-1">
            <span className={`text-base font-bold font-mono ${
              metrics.isOfflineLocked ? 'text-rose-400' : 'text-emerald-400'
            }`}>
              {metrics.isOfflineLocked ? 'LOCKED' : 'ACTIVE'}
            </span>
            {metrics.isOfflineLocked ? (
              <Lock className="w-4 h-4 text-rose-400" />
            ) : (
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
            )}
          </div>
        </div>
      </div>

      {/* Offline Cash Collection Tester */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3 shadow-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-emerald-400" />
            <h4 className="font-bold text-white text-xs">Record Field Collection (Offline / Online)</h4>
          </div>
          <span className="text-[10px] text-slate-400 font-mono">
            Agent: <strong className="text-white">{currentAgent.name}</strong>
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <div className="sm:col-span-2">
            <label className="block text-[10px] text-slate-400 mb-1">Select Subscriber Invoice</label>
            <select
              value={selectedInvoiceId}
              onChange={(e) => {
                setSelectedInvoiceId(e.target.value);
                const inv = invoices.find((i) => i.id === e.target.value);
                if (inv) setCollectedAmount(inv.totalAmount);
              }}
              className="w-full bg-slate-950 border border-slate-700 text-slate-200 text-xs p-2 rounded-lg font-mono focus:outline-none focus:border-cyan-500"
            >
              {unpaidInvoices.map((inv) => (
                <option key={inv.id} value={inv.id}>
                  {inv.customerName} - {inv.invoiceNumber} (${inv.totalAmount.toFixed(2)})
                </option>
              ))}
              {unpaidInvoices.length === 0 && (
                <option value="">No pending invoices available</option>
              )}
            </select>
          </div>

          <div>
            <label className="block text-[10px] text-slate-400 mb-1">Amount ($)</label>
            <input
              type="number"
              min={1}
              value={collectedAmount}
              onChange={(e) => setCollectedAmount(parseFloat(e.target.value) || 0)}
              className="w-full bg-slate-950 border border-slate-700 text-emerald-400 font-mono font-bold text-xs p-2 rounded-lg focus:outline-none focus:border-cyan-500"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800">
          <label className="flex items-center gap-2 cursor-pointer text-[11px] text-slate-300">
            <input
              type="checkbox"
              checked={simulateConflict}
              onChange={(e) => setSimulateConflict(e.target.checked)}
              className="rounded bg-slate-950 border-slate-700 text-cyan-500 focus:ring-0"
            />
            <span className="text-amber-300">Simulate Conflict (Customer already paid online via Portal)</span>
          </label>

          <button
            onClick={handleOfflineCollect}
            className="bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-slate-950 font-bold text-xs px-4 py-2 rounded-lg transition flex items-center gap-1.5 shadow-md shadow-emerald-950/40 cursor-pointer"
          >
            <DollarSign className="w-3.5 h-3.5" />
            <span>Generate Offline Receipt &amp; Queue</span>
          </button>
        </div>
      </div>

      {/* Auto-Sync Engine Execution Bar */}
      <div className="bg-slate-950 border border-cyan-800/60 p-3.5 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-cyan-950 border border-cyan-800 text-cyan-400">
            <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-white text-xs">Background Auto-Sync Worker</span>
              <span className="text-[10px] text-slate-400 font-mono">POST /api/billing/sync-offline</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Pushes FIFO local queue, verifies HMAC signatures, resolves conflicts, and sends WhatsApp receipts.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
          <button
            onClick={handleClearSynced}
            className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-mono transition"
            title="Clean local archive"
          >
            Clear Synced
          </button>

          <button
            onClick={handleTriggerSync}
            disabled={isSyncing || metrics.pendingQueueRecords === 0}
            className="bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-slate-950 font-bold text-xs px-4 py-2 rounded-lg transition flex items-center gap-1.5 shadow-md shadow-cyan-950/40 cursor-pointer active:scale-95"
          >
            <Zap className="w-3.5 h-3.5 text-slate-950" />
            <span>{isSyncing ? 'Syncing Queue...' : `Sync Queue (${metrics.pendingQueueRecords})`}</span>
          </button>
        </div>
      </div>

      {/* Pending & Synced Queue Ledger Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
        <div className="p-3 border-b border-slate-800 flex items-center justify-between bg-slate-950/50">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-cyan-400" />
            <span className="font-bold text-white text-xs">Local SQLite / WatermelonDB Queue Ledger</span>
          </div>
          <span className="text-[10px] text-slate-400 font-mono">
            {queue.length} Total Records Stored
          </span>
        </div>

        <div className="divide-y divide-slate-800/80 max-h-60 overflow-y-auto">
          {queue.length === 0 ? (
            <div className="p-6 text-center text-slate-500 font-mono text-xs">
              No offline transactions in local storage. Collect cash payments above to test offline queueing.
            </div>
          ) : (
            queue.map((item) => (
              <div key={item.id} className="p-3 flex items-center justify-between hover:bg-slate-950/40 transition text-xs">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-slate-200">
                      {item.offlineReceiptNumber}
                    </span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono uppercase font-bold ${
                      item.syncStatus === 'pending'
                        ? 'bg-amber-950 text-amber-300 border border-amber-800'
                        : item.conflictReason
                        ? 'bg-purple-950 text-purple-300 border border-purple-800'
                        : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                    }`}>
                      {item.syncStatus === 'pending' ? 'Pending Sync' : item.conflictReason ? 'Conflict Reconciled' : 'Synced'}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 text-[11px] text-slate-400 font-mono">
                    <span>{item.customerName}</span>
                    <span>•</span>
                    <span>{new Date(item.collectedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    <span>•</span>
                    <span className="text-slate-500 truncate max-w-[120px]" title={item.cryptographicSignature}>
                      {item.cryptographicSignature.slice(0, 14)}...
                    </span>
                  </div>

                  {item.conflictReason && (
                    <p className="text-[10px] text-purple-300 font-sans italic">
                      ⚠️ {item.conflictReason}
                    </p>
                  )}
                </div>

                <div className="text-right font-mono">
                  <span className="text-emerald-400 font-bold block text-sm">
                    ${item.amount.toFixed(2)}
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {item.serverReceiptNumber || 'Local Stored'}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
