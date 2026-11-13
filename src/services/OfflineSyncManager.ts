import {
  supabase,
  SupabaseAgentCashTransaction,
  SupabaseInvoice,
  SupabaseTicket,
} from './supabaseClient';
import {
  add31DaysDateString,
  restoreSubscriberOnInvoicePaid,
} from '../lib/billingAndNetwork';

export type OfflineActionType = 'COLLECT_CASH' | 'RESOLVE_TICKET';

export interface OfflinePaymentPayload {
  invoiceId: string;
  invoiceNo: string;
  subscriberUsername: string;
  amountPaid: number;
  totalAmount: number;
  previousPaid: number;
  agentId: string;
  agentName: string;
  collectedAtIso: string;
  paymentMethod: string;
}

export interface OfflineResolveTicketPayload {
  ticketId: string;
  ticketNo: string;
  subscriberUsername: string;
  agentId: string;
  agentName: string;
  resolvedAtIso: string;
  resolutionNotes?: string;
}

export interface OfflineOutboxAction {
  action_id: string;
  type: OfflineActionType;
  createdAt: string;
  payload: OfflinePaymentPayload | OfflineResolveTicketPayload;
}

export interface CachedSubscriberDirectory {
  [usernameLower: string]: {
    phone?: string;
    address?: string;
    full_name?: string;
    area?: string;
    package_speed?: string;
  };
}

export interface CachedAgentWallet {
  cashInHand: number;
  baseSalary: number;
  advanceBalance: number;
  cashTransactions: SupabaseAgentCashTransaction[];
}

export interface CachedAgentSnapshot {
  subscribers: CachedSubscriberDirectory;
  invoices: SupabaseInvoice[];
  tickets: SupabaseTicket[];
  wallet: CachedAgentWallet;
  cachedAt: string;
}

export interface AutoSyncResult {
  syncedCount: number;
  remainingCount: number;
  hadNetworkError: boolean;
  skipped?: boolean;
}

/**
 * Strictly restricts offline caching & outbox sync to Field Agents & Admins.
 * Client / Subscriber views must NEVER store or expose offline queues.
 */
export function isOfflineCapableRole(role?: string | null): boolean {
  const normalized = (role || '').trim().toUpperCase();
  return (
    normalized === 'AGENT' ||
    normalized === 'FIELD_AGENT' ||
    normalized === 'ADMIN'
  );
}

/**
 * Detects offline state or transient network/fetch failures across browser/Supabase errors.
 */
export function isLikelyNetworkError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return true;
  }
  const msg = String((err as any)?.message || err || '').toLowerCase();
  return (
    err instanceof TypeError ||
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network request failed') ||
    msg.includes('load failed') ||
    msg.includes('err_internet_disconnected') ||
    msg.includes('network') ||
    msg.includes('timeout') ||
    msg.includes('aborted')
  );
}

function generateActionUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function getStorageKeys(agentId: string) {
  const safeId = (agentId || 'default').trim();
  const prefix = `youthnet_agent_${safeId}`;
  return {
    subscribers: `${prefix}_subscribers`,
    invoices: `${prefix}_invoices`,
    tickets: `${prefix}_tickets`,
    wallet: `${prefix}_wallet`,
    outbox: `${prefix}_outbox`,
    syncedIds: `${prefix}_synced_ids`,
  };
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined' || !window.localStorage) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded or disabled
  }
}

function registerBackgroundSyncTag(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.ready
    .then((reg: any) => {
      if (reg && reg.sync && typeof reg.sync.register === 'function') {
        return reg.sync.register('youthnet-outbox-sync');
      }
      return undefined;
    })
    .catch(() => {});
}

class OfflineSyncManager {
  private syncingAgents = new Set<string>();

  public getOutbox(agentId: string, role?: string | null): OfflineOutboxAction[] {
    if (!agentId || !isOfflineCapableRole(role)) return [];
    const keys = getStorageKeys(agentId);
    const items = readJson<OfflineOutboxAction[]>(keys.outbox, []);
    return Array.isArray(items) ? items : [];
  }

  private saveOutbox(agentId: string, items: OfflineOutboxAction[]): void {
    const keys = getStorageKeys(agentId);
    writeJson(keys.outbox, items);
  }

  private getSyncedIds(agentId: string): string[] {
    const keys = getStorageKeys(agentId);
    const ids = readJson<string[]>(keys.syncedIds, []);
    return Array.isArray(ids) ? ids : [];
  }

  private markActionSynced(agentId: string, actionId: string): void {
    const keys = getStorageKeys(agentId);
    const existing = this.getSyncedIds(agentId);
    if (!existing.includes(actionId)) {
      const next = [actionId, ...existing].slice(0, 250);
      writeJson(keys.syncedIds, next);
    }
  }

  /**
   * Persist latest online snapshot in role-scoped localStorage for seamless offline fallback.
   */
  public cacheAgentSnapshot(
    agentId: string,
    role: string | null | undefined,
    snapshot: Partial<CachedAgentSnapshot>
  ): void {
    if (!agentId || !isOfflineCapableRole(role)) return;
    const keys = getStorageKeys(agentId);

    if (snapshot.subscribers) {
      writeJson(keys.subscribers, snapshot.subscribers);
    }
    if (snapshot.invoices) {
      writeJson(keys.invoices, snapshot.invoices);
    }
    if (snapshot.tickets) {
      writeJson(keys.tickets, snapshot.tickets);
    }
    if (snapshot.wallet) {
      writeJson(keys.wallet, snapshot.wallet);
    }
  }

  /**
   * Overlays any still-pending local outbox actions onto server/cached invoices, tickets,
   * and agent wallet so collected invoices show PAID and resolved tickets show RESOLVED immediately.
   */
  public applyOutboxOverlay(
    agentId: string,
    role: string | null | undefined,
    input: {
      invoices: SupabaseInvoice[];
      tickets: SupabaseTicket[];
      cashInHand: number;
    }
  ): {
    invoices: SupabaseInvoice[];
    tickets: SupabaseTicket[];
    cashInHand: number;
  } {
    if (!agentId || !isOfflineCapableRole(role)) {
      return input;
    }

    const outbox = this.getOutbox(agentId, role);
    if (outbox.length === 0) return input;

    let invoices = input.invoices.map((inv) => ({ ...inv }));
    let tickets = input.tickets.map((t) => ({ ...t }));
    let cashInHand = Number(input.cashInHand || 0);

    for (const action of outbox) {
      if (action.type === 'COLLECT_CASH') {
        const p = action.payload as OfflinePaymentPayload;
        cashInHand += Number(p.amountPaid || 0);
        invoices = invoices.map((inv) => {
          if (inv.id !== p.invoiceId) return inv;
          const totalAmount = Number(inv.amount || p.totalAmount || 0);
          const nextPaid = Math.min(
            totalAmount,
            Number(inv.paid_amount || 0) + Number(p.amountPaid || 0)
          );
          const isFull = totalAmount - nextPaid <= 0;
          return {
            ...inv,
            paid_amount: nextPaid,
            status: isFull ? 'PAID' : 'PARTIAL',
            paid_at: isFull ? p.collectedAtIso : inv.paid_at || null,
            due_date: isFull
              ? add31DaysDateString(new Date(p.collectedAtIso))
              : inv.due_date,
          };
        });
      } else if (action.type === 'RESOLVE_TICKET') {
        const p = action.payload as OfflineResolveTicketPayload;
        tickets = tickets.map((t) =>
          t.id === p.ticketId ? { ...t, status: 'RESOLVED' } : t
        );
      }
    }

    return { invoices, tickets, cashInHand };
  }

  /**
   * Loads cached subscribers, invoices, tickets, and wallet with pending outbox overlay applied.
   */
  public getCachedAgentSnapshot(
    agentId: string,
    role: string | null | undefined
  ): CachedAgentSnapshot | null {
    if (!agentId || !isOfflineCapableRole(role)) return null;
    const keys = getStorageKeys(agentId);
    const subscribers = readJson<CachedSubscriberDirectory>(keys.subscribers, {});
    const rawInvoices = readJson<SupabaseInvoice[]>(keys.invoices, []);
    const rawTickets = readJson<SupabaseTicket[]>(keys.tickets, []);
    const wallet = readJson<CachedAgentWallet>(keys.wallet, {
      cashInHand: 0,
      baseSalary: 0,
      advanceBalance: 0,
      cashTransactions: [],
    });

    const overlaid = this.applyOutboxOverlay(agentId, role, {
      invoices: rawInvoices,
      tickets: rawTickets,
      cashInHand: wallet.cashInHand,
    });

    return {
      subscribers,
      invoices: overlaid.invoices,
      tickets: overlaid.tickets,
      wallet: {
        ...wallet,
        cashInHand: overlaid.cashInHand,
      },
      cachedAt: new Date().toISOString(),
    };
  }

  /**
   * Queue a cash collection locally when offline or on network failure.
   */
  public enqueueOfflinePayment(
    agentId: string,
    role: string | null | undefined,
    payload: OfflinePaymentPayload
  ): OfflineOutboxAction {
    if (!agentId || !isOfflineCapableRole(role)) {
      throw new Error('Offline queuing is only enabled for Field Agents and Admins.');
    }

    const outbox = this.getOutbox(agentId, role);

    // Prevent duplicate full-collection queue entry for the same invoice while offline
    const alreadyQueuedForInvoice = outbox
      .filter(
        (item) =>
          item.type === 'COLLECT_CASH' &&
          (item.payload as OfflinePaymentPayload).invoiceId === payload.invoiceId
      )
      .reduce(
        (sum, item) => sum + Number((item.payload as OfflinePaymentPayload).amountPaid || 0),
        0
      );

    const remainingBeforeThis = Math.max(
      0,
      Number(payload.totalAmount || 0) -
        (Number(payload.previousPaid || 0) + alreadyQueuedForInvoice)
    );
    if (remainingBeforeThis <= 0) {
      throw new Error('Payment for this invoice is already queued locally for auto-sync.');
    }

    const action: OfflineOutboxAction = {
      action_id: generateActionUuid(),
      type: 'COLLECT_CASH',
      createdAt: payload.collectedAtIso || new Date().toISOString(),
      payload,
    };

    const nextOutbox = [...outbox, action];
    this.saveOutbox(agentId, nextOutbox);

    registerBackgroundSyncTag();
    return action;
  }

  /**
   * Queue a ticket resolution locally when offline or on network failure.
   */
  public enqueueOfflineTicketResolution(
    agentId: string,
    role: string | null | undefined,
    payload: OfflineResolveTicketPayload
  ): OfflineOutboxAction {
    if (!agentId || !isOfflineCapableRole(role)) {
      throw new Error('Offline queuing is only enabled for Field Agents and Admins.');
    }

    const outbox = this.getOutbox(agentId, role);
    const existing = outbox.find(
      (item) =>
        item.type === 'RESOLVE_TICKET' &&
        (item.payload as OfflineResolveTicketPayload).ticketId === payload.ticketId
    );
    if (existing) {
      return existing;
    }

    const action: OfflineOutboxAction = {
      action_id: generateActionUuid(),
      type: 'RESOLVE_TICKET',
      createdAt: payload.resolvedAtIso || new Date().toISOString(),
      payload,
    };

    this.saveOutbox(agentId, [...outbox, action]);

    registerBackgroundSyncTag();
    return action;
  }

  /**
   * Replays all pending actions in FIFO order with single-flight lock & action_id deduplication.
   */
  public async autoSyncOutbox(
    agentId: string,
    role: string | null | undefined
  ): Promise<AutoSyncResult> {
    if (!agentId || !isOfflineCapableRole(role)) {
      return { syncedCount: 0, remainingCount: 0, hadNetworkError: false, skipped: true };
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      const current = this.getOutbox(agentId, role);
      return {
        syncedCount: 0,
        remainingCount: current.length,
        hadNetworkError: false,
        skipped: true,
      };
    }
    if (this.syncingAgents.has(agentId)) {
      const current = this.getOutbox(agentId, role);
      return {
        syncedCount: 0,
        remainingCount: current.length,
        hadNetworkError: false,
        skipped: true,
      };
    }

    const initialOutbox = this.getOutbox(agentId, role);
    if (initialOutbox.length === 0) {
      return { syncedCount: 0, remainingCount: 0, hadNetworkError: false };
    }

    this.syncingAgents.add(agentId);
    let syncedCount = 0;
    let hadNetworkError = false;

    try {
      let workingOutbox = [...initialOutbox];

      for (const item of initialOutbox) {
        const syncedIds = this.getSyncedIds(agentId);
        if (syncedIds.includes(item.action_id)) {
          workingOutbox = workingOutbox.filter((x) => x.action_id !== item.action_id);
          this.saveOutbox(agentId, workingOutbox);
          continue;
        }

        try {
          if (item.type === 'COLLECT_CASH') {
            const p = item.payload as OfflinePaymentPayload;

            // Server-side deduplication via action_id marker inside payment_transactions.notes
            const { data: dupRows, error: dupErr } = await supabase
              .from('payment_transactions')
              .select('id')
              .ilike('notes', `%[action_id:${item.action_id}]%`)
              .limit(1);

            if (dupErr && isLikelyNetworkError(dupErr)) {
              throw dupErr;
            }

            if (Array.isArray(dupRows) && dupRows.length > 0) {
              // Already recorded on server -> drop cleanly from local outbox
              this.markActionSynced(agentId, item.action_id);
              workingOutbox = workingOutbox.filter((x) => x.action_id !== item.action_id);
              this.saveOutbox(agentId, workingOutbox);
              continue;
            }

            // 1. Fetch fresh invoice state from Supabase so partial/concurrent payments reconcile cleanly
            const { data: liveInv, error: invFetchErr } = await supabase
              .from('invoices')
              .select('id, amount, paid_amount, status, due_date, paid_at')
              .eq('id', p.invoiceId)
              .maybeSingle();

            if (invFetchErr) throw invFetchErr;

            const totalAmount = Number(liveInv?.amount ?? p.totalAmount ?? 0);
            const serverPaid = Number(liveInv?.paid_amount ?? p.previousPaid ?? 0);
            const collectedNow = Number(p.amountPaid || 0);
            const nextPaidTotal = Math.min(totalAmount, serverPaid + collectedNow);
            const remaining = totalAmount - nextPaidTotal;
            const newStatus: 'PAID' | 'PARTIAL' = remaining <= 0 ? 'PAID' : 'PARTIAL';
            const nowIso = new Date().toISOString();

            const invoiceUpdateData: Partial<SupabaseInvoice> = {
              status: newStatus,
              paid_amount: newStatus === 'PAID' ? totalAmount : nextPaidTotal,
              paid_at: newStatus === 'PAID' ? p.collectedAtIso || nowIso : (liveInv?.paid_at || null),
              cycle_day: 31,
            };
            if (newStatus === 'PAID') {
              invoiceUpdateData.due_date = add31DaysDateString(new Date());
            }

            const { error: invUpdErr } = await supabase
              .from('invoices')
              .update(invoiceUpdateData)
              .eq('id', p.invoiceId);

            if (invUpdErr) throw invUpdErr;

            // 2. Extend +31 days and restore ACTIVE status on portal_users + MikroTik when PAID
            if (newStatus === 'PAID') {
              await restoreSubscriberOnInvoicePaid(p.subscriberUsername);
            }

            // 3. Insert payment_transactions record with action_id deduplication marker
            const { error: txErr } = await supabase
              .from('payment_transactions')
              .insert([
                {
                  invoice_id: p.invoiceId,
                  subscriber_username: p.subscriberUsername,
                  collected_by_id: p.agentId,
                  collected_by_name: p.agentName,
                  amount_paid: collectedNow,
                  payment_mode: p.paymentMethod || 'Cash Handover',
                  payment_date: p.collectedAtIso || nowIso,
                  notes: `Offline auto-sync collection [action_id:${item.action_id}]`,
                },
              ]);

            if (txErr && isLikelyNetworkError(txErr)) {
              throw txErr;
            }

            // 4. Increment agent's cash_in_hand in portal_users
            const { data: agentRow, error: agFetchErr } = await supabase
              .from('portal_users')
              .select('cash_in_hand')
              .eq('id', p.agentId)
              .maybeSingle();

            if (agFetchErr && isLikelyNetworkError(agFetchErr)) {
              throw agFetchErr;
            }

            const nextCash = (Number(agentRow?.cash_in_hand) || 0) + collectedNow;
            const { error: agUpdErr } = await supabase
              .from('portal_users')
              .update({ cash_in_hand: nextCash })
              .eq('id', p.agentId);

            if (agUpdErr && isLikelyNetworkError(agUpdErr)) {
              throw agUpdErr;
            }
          } else if (item.type === 'RESOLVE_TICKET') {
            const p = item.payload as OfflineResolveTicketPayload;
            const { error: tktErr } = await supabase
              .from('tickets')
              .update({ status: 'RESOLVED' })
              .eq('id', p.ticketId);

            if (tktErr) throw tktErr;
          }

          // Mark item synced & remove immediately from outbox
          this.markActionSynced(agentId, item.action_id);
          workingOutbox = workingOutbox.filter((x) => x.action_id !== item.action_id);
          this.saveOutbox(agentId, workingOutbox);
          syncedCount++;
        } catch (err) {
          if (isLikelyNetworkError(err)) {
            hadNetworkError = true;
            break;
          }
          console.warn('[OfflineSyncManager] Non-network replay error for action', item.action_id, err);
          // Do not drop unexpectedly failing non-network error unless already synced; stop loop cleanly
          break;
        }
      }

      return {
        syncedCount,
        remainingCount: workingOutbox.length,
        hadNetworkError,
      };
    } finally {
      this.syncingAgents.delete(agentId);
    }
  }
}

export const offlineSyncManager = new OfflineSyncManager();
