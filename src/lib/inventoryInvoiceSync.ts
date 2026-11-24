import { buildPortalAuthHeaders } from './whatsappRouting';

export interface MinimalInventoryLog {
  id?: string;
  subscriber_username?: string;
  item_name: string;
  quantity: number;
  unit_cost: number;
  added_to_invoice?: boolean;
  installed_by_agent_name?: string | null;
  created_at?: string;
}

export interface MinimalInvoice {
  id: string;
  invoice_no: string;
  subscriber_username: string;
  amount: number;
  paid_amount?: number;
  status: string;
  due_date?: string;
  cycle_day?: number;
  assigned_agent_id?: string | null;
  assigned_agent_name?: string | null;
  notes?: string | null;
  created_at?: string;
}

export interface MaterialInvoiceSyncPlan {
  action: 'NOOP' | 'UPDATE_INVOICE' | 'DELETE_INVOICE';
  targetInvoiceId?: string;
  targetInvoiceNo?: string;
  newAmount?: number;
  newStatus?: 'DUE' | 'PARTIAL' | 'PAID';
  reason: string;
}

/**
 * Pure planner that computes how a subscriber's linked material invoice (`INV-MAT-*`,
 * or fallback unpaid invoice when a billed material item was appended) must be updated
 * or deleted after a material row in `subscriber_inventory_logs` is edited or deleted.
 */
export function computeMaterialInvoiceSyncPlan(params: {
  previousItem: MinimalInventoryLog;
  updatedItem: MinimalInventoryLog | null; // null when deleted
  remainingLogsAfterMutation: MinimalInventoryLog[];
  subscriberInvoices: MinimalInvoice[];
}): MaterialInvoiceSyncPlan {
  const { previousItem, updatedItem, remainingLogsAfterMutation, subscriberInvoices } = params;

  const isMaterialInv = (inv: MinimalInvoice) =>
    String(inv.invoice_no || '').trim().toUpperCase().startsWith('INV-MAT-');
  const isUnpaidInv = (inv: MinimalInvoice) =>
    String(inv.status || '').trim().toUpperCase() !== 'PAID';

  const unpaidMatInvoices = subscriberInvoices.filter((i) => isMaterialInv(i) && isUnpaidInv(i));
  const paidMatInvoices = subscriberInvoices.filter((i) => isMaterialInv(i) && !isUnpaidInv(i));
  const targetMatInvoice = unpaidMatInvoices[0] || null;

  const wasBilled = Boolean(previousItem.added_to_invoice);
  const nowBilled = updatedItem ? Boolean(updatedItem.added_to_invoice) : false;

  // If the item was not billed AND there is no unpaid INV-MAT-* invoice, nothing to sync
  if (!wasBilled && !nowBilled && !targetMatInvoice) {
    return { action: 'NOOP', reason: 'Material item is inventory-only (not billed to invoice).' };
  }

  const prevCharge = wasBilled
    ? Math.max(0, (Number(previousItem.quantity) || 0) * (Number(previousItem.unit_cost) || 0))
    : 0;
  const nextCharge = nowBilled && updatedItem
    ? Math.max(0, (Number(updatedItem.quantity) || 0) * (Number(updatedItem.unit_cost) || 0))
    : 0;
  const delta = nextCharge - prevCharge;

  const remainingBilledLogs = remainingLogsAfterMutation.filter((l) => Boolean(l.added_to_invoice));
  const remainingBilledSum = remainingBilledLogs.reduce(
    (sum, l) => sum + Math.max(0, (Number(l.quantity) || 0) * (Number(l.unit_cost) || 0)),
    0
  );

  // Priority 1: Sync dedicated unpaid INV-MAT-* invoice
  if (targetMatInvoice) {
    const paidAmt = Math.max(0, Number(targetMatInvoice.paid_amount) || 0);
    const currentAmt = Math.max(0, Number(targetMatInvoice.amount) || 0);

    // If no prior paid INV-MAT-* invoices exist and only 1 unpaid INV-MAT-* exists,
    // exact sum of remaining billed items guarantees 100% alignment between hardware log & invoice.
    const nextAmountRaw =
      paidMatInvoices.length === 0 && unpaidMatInvoices.length === 1
        ? remainingBilledSum
        : Math.max(0, currentAmt + delta);

    const hasZeroRemainingItems = remainingBilledLogs.length === 0 || nextAmountRaw <= 0;

    if (hasZeroRemainingItems && paidAmt === 0) {
      return {
        action: 'DELETE_INVOICE',
        targetInvoiceId: targetMatInvoice.id,
        targetInvoiceNo: targetMatInvoice.invoice_no,
        reason: `Removed empty unpaid material invoice ${targetMatInvoice.invoice_no}.`,
      };
    }

    const clampedAmount = Math.max(paidAmt, Math.round(nextAmountRaw * 100) / 100);
    if (clampedAmount === currentAmt) {
      return { action: 'NOOP', reason: 'Linked material invoice amount unchanged.' };
    }

    const nextStatus: 'DUE' | 'PARTIAL' | 'PAID' =
      paidAmt > 0 && paidAmt >= clampedAmount
        ? 'PAID'
        : paidAmt > 0
        ? 'PARTIAL'
        : 'DUE';

    return {
      action: 'UPDATE_INVOICE',
      targetInvoiceId: targetMatInvoice.id,
      targetInvoiceNo: targetMatInvoice.invoice_no,
      newAmount: clampedAmount,
      newStatus: nextStatus,
      reason: `Synced material invoice ${targetMatInvoice.invoice_no} amount to Rs. ${clampedAmount.toLocaleString()}.`,
    };
  }

  // Priority 2: Material item was billed into the latest unpaid regular invoice (no INV-MAT-* exists)
  if (wasBilled && delta !== 0) {
    const unpaidRegular = subscriberInvoices.find((i) => isUnpaidInv(i));
    if (unpaidRegular) {
      const paidAmt = Math.max(0, Number(unpaidRegular.paid_amount) || 0);
      const currentAmt = Math.max(0, Number(unpaidRegular.amount) || 0);
      const nextAmt = Math.max(paidAmt, Math.round((currentAmt + delta) * 100) / 100);

      if (nextAmt !== currentAmt) {
        const nextStatus: 'DUE' | 'PARTIAL' | 'PAID' =
          paidAmt > 0 && paidAmt >= nextAmt
            ? 'PAID'
            : paidAmt > 0
            ? 'PARTIAL'
            : 'DUE';

        return {
          action: 'UPDATE_INVOICE',
          targetInvoiceId: unpaidRegular.id,
          targetInvoiceNo: unpaidRegular.invoice_no,
          newAmount: nextAmt,
          newStatus: nextStatus,
          reason: `Adjusted unpaid invoice ${unpaidRegular.invoice_no} by ${delta >= 0 ? '+' : ''}Rs. ${delta.toLocaleString()} -> Rs. ${nextAmt.toLocaleString()}.`,
        };
      }
    }
  }

  return { action: 'NOOP', reason: 'No unpaid linked invoice needed adjustment.' };
}

export interface ApiMutationResponse<T = any> {
  success: boolean;
  data?: T;
  invoiceSync?: MaterialInvoiceSyncPlan;
  deletedPaymentsCount?: number;
  error?: string;
}

export async function updateInventoryLogApi(
  id: string,
  payload: {
    item_name: string;
    quantity: number;
    unit_cost: number;
    installed_by_agent_name?: string | null;
    created_at?: string;
  }
): Promise<ApiMutationResponse> {
  const res = await fetch(`/api/subscribers/inventory-logs/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...buildPortalAuthHeaders(),
    },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    throw new Error(json.error || `Failed to update material log (HTTP ${res.status})`);
  }
  return json;
}

export async function deleteInventoryLogApi(id: string): Promise<ApiMutationResponse> {
  const res = await fetch(`/api/subscribers/inventory-logs/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      ...buildPortalAuthHeaders(),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    throw new Error(json.error || `Failed to delete material log (HTTP ${res.status})`);
  }
  return json;
}

export async function updateInvoiceApi(
  id: string,
  payload: {
    amount: number;
    due_date: string;
    status: 'DUE' | 'PARTIAL' | 'PAID' | 'OVERDUE';
    assigned_agent_id?: string | null;
    assigned_agent_name?: string | null;
    notes?: string | null;
    cycle_day?: number;
    package_profile?: string | null;
    package_name?: string | null;
    paid_amount?: number;
    paid_at?: string | null;
  }
): Promise<ApiMutationResponse> {
  const res = await fetch(`/api/invoices/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...buildPortalAuthHeaders(),
    },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    throw new Error(json.error || `Failed to update invoice (HTTP ${res.status})`);
  }
  return json;
}

export async function deleteInvoiceApi(
  id: string,
  options?: { deleteLinkedPayments?: boolean }
): Promise<ApiMutationResponse> {
  const res = await fetch(`/api/invoices/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      ...buildPortalAuthHeaders(),
    },
    body: JSON.stringify({
      deleteLinkedPayments: Boolean(options?.deleteLinkedPayments),
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    throw new Error(json.error || `Failed to delete invoice (HTTP ${res.status})`);
  }
  return json;
}
