import { buildPortalAuthHeaders } from './whatsappRouting';
import { supabase } from '../services/supabaseClient';
import { getStoredUser } from './auth';
import { resolveStaffPermissions } from './staffPermissions';
import { getResellerTier } from './resellerEngine';

export interface MinimalInventoryLog {
  id?: string;
  subscriber_username?: string;
  item_name: string;
  quantity: number;
  unit_cost: number;
  total_charge?: number;
  added_to_invoice?: boolean;
  installed_by_agent_name?: string | null;
  installed_by?: string | null;
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
  billing_cycle_day?: number;
  assigned_agent_id?: string | null;
  assigned_agent_name?: string | null;
  assigned_agent?: string | null;
  notes?: string | null;
  dealer_id?: string | null;
  sub_dealer_id?: string | null;
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
  const nextCharge =
    nowBilled && updatedItem
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

function assertCanEditDeleteLedgerClient() {
  const actor = getStoredUser();
  if (!actor) return null;
  const perms = resolveStaffPermissions(actor as any);
  if (!perms.edit_delete_invoice) {
    throw new Error('Permission Denied: Edit & Delete Invoice / Hardware Log permission is required.');
  }
  return actor;
}

async function assertResellerRecordScopeClient(
  actor: ReturnType<typeof getStoredUser>,
  subscriberUsername: string | null | undefined,
  recordOwnerIds?: { dealer_id?: string | null; sub_dealer_id?: string | null }
): Promise<void> {
  if (!actor) return;
  const tier = getResellerTier(actor as any);
  if (tier !== 'DEALER' && tier !== 'SUB_DEALER') return;

  const allowedIds = new Set<string>([String(actor.id)]);
  if (tier === 'DEALER') {
    const { data: childSubs } = await supabase
      .from('portal_users')
      .select('id')
      .eq('parent_dealer_id', actor.id);
    for (const row of childSubs || []) {
      if (row?.id) allowedIds.add(String(row.id));
    }
  }

  if (recordOwnerIds) {
    if (recordOwnerIds.sub_dealer_id && allowedIds.has(String(recordOwnerIds.sub_dealer_id))) {
      return;
    }
    if (tier === 'DEALER' && recordOwnerIds.dealer_id && allowedIds.has(String(recordOwnerIds.dealer_id))) {
      return;
    }
  }

  const cleanSub = String(subscriberUsername || '').trim();
  if (cleanSub) {
    const { data: subRec } = await supabase
      .from('portal_users')
      .select('id, dealer_id, sub_dealer_id, created_by_id')
      .ilike('username', cleanSub)
      .maybeSingle();

    if (subRec) {
      if (subRec.sub_dealer_id && allowedIds.has(String(subRec.sub_dealer_id))) return;
      if (tier === 'DEALER' && subRec.dealer_id && allowedIds.has(String(subRec.dealer_id))) return;
      if (subRec.created_by_id && allowedIds.has(String(subRec.created_by_id))) return;
    }
  }

  throw new Error('Access Denied: Record is outside your Dealer/Sub-Dealer scope.');
}

async function adaptiveSupabaseUpdate(
  table: string,
  id: string,
  payload: Record<string, any>,
  optionalCols: Set<string>
): Promise<{ data: any; error: any; appliedPayload: Record<string, any> }> {
  const working: Record<string, any> = { ...payload };
  let lastError: any = null;

  for (let attempt = 0; attempt < optionalCols.size + 3; attempt++) {
    const { data, error } = await supabase
      .from(table)
      .update(working)
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (!error) {
      return { data, error: null, appliedPayload: working };
    }

    lastError = error;
    const msg = String(error.message || '');
    const colMatch =
      msg.match(/Could not find the ['"]([a-zA-Z0-9_]+)['"] column/i) ||
      msg.match(/column\s+["']?([a-zA-Z0-9_]+)["']?\s+(?:of relation|does not exist)/i);

    if (colMatch?.[1] && colMatch[1] in working && optionalCols.has(colMatch[1])) {
      delete working[colMatch[1]];
      continue;
    }
    break;
  }

  return { data: null, error: lastError, appliedPayload: working };
}

async function tryBackendJsonFallback(
  url: string,
  method: 'PATCH' | 'PUT' | 'DELETE' | 'POST',
  body?: Record<string, any>,
  postFallbackUrl?: string
): Promise<{ ok: boolean; json?: ApiMutationResponse }> {
  const attempt = async (targetUrl: string, targetMethod: string) => {
    try {
      const res = await fetch(targetUrl, {
        method: targetMethod,
        headers: {
          'Content-Type': 'application/json',
          ...buildPortalAuthHeaders(),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      const rawText = await res.text();
      if (
        res.status === 404 ||
        res.status === 405 ||
        !contentType.includes('application/json') ||
        rawText.trim().startsWith('<')
      ) {
        return { ok: false as const, retryableMethod: res.status === 405 };
      }
      const parsed = JSON.parse(rawText);
      if (res.ok && parsed && parsed.success !== false) {
        return { ok: true as const, json: parsed as ApiMutationResponse };
      }
      return { ok: false as const, retryableMethod: false };
    } catch {
      return { ok: false as const, retryableMethod: false };
    }
  };

  const first = await attempt(url, method);
  if (first.ok) return first;
  if (first.retryableMethod && postFallbackUrl) {
    const second = await attempt(postFallbackUrl, 'POST');
    if (second.ok) return second;
  }
  return { ok: false };
}

async function applyMaterialInvoiceSyncInSupabase(params: {
  subscriberUsername: string;
  previousItem: MinimalInventoryLog;
  updatedItem: MinimalInventoryLog | null;
}): Promise<MaterialInvoiceSyncPlan> {
  const { subscriberUsername, previousItem, updatedItem } = params;
  const cleanSub = String(subscriberUsername || '').trim();
  if (!cleanSub) {
    return { action: 'NOOP', reason: 'No subscriber username attached to material log.' };
  }

  const [{ data: remainingLogs, error: logsErr }, { data: subscriberInvoices, error: invErr }] =
    await Promise.all([
      supabase
        .from('subscriber_inventory_logs')
        .select('*')
        .ilike('subscriber_username', cleanSub)
        .order('created_at', { ascending: false }),
      supabase
        .from('invoices')
        .select('*')
        .ilike('subscriber_username', cleanSub)
        .order('created_at', { ascending: false }),
    ]);

  if (logsErr || invErr) {
    return {
      action: 'NOOP',
      reason: `Material saved, but skipped invoice sync (${logsErr?.message || invErr?.message}).`,
    };
  }

  const plan = computeMaterialInvoiceSyncPlan({
    previousItem,
    updatedItem,
    remainingLogsAfterMutation: (remainingLogs || []) as MinimalInventoryLog[],
    subscriberInvoices: (subscriberInvoices || []) as MinimalInvoice[],
  });

  if (plan.action === 'DELETE_INVOICE' && plan.targetInvoiceId) {
    const { error } = await supabase.from('invoices').delete().eq('id', plan.targetInvoiceId);
    if (error) {
      throw new Error(`Material saved, but failed to delete linked invoice: ${error.message}`);
    }
  } else if (plan.action === 'UPDATE_INVOICE' && plan.targetInvoiceId && plan.newAmount !== undefined) {
    const patch: Record<string, any> = { amount: plan.newAmount };
    if (plan.newStatus) patch.status = plan.newStatus;
    if (plan.newStatus === 'PAID') patch.paid_at = new Date().toISOString();
    const { error } = await supabase.from('invoices').update(patch).eq('id', plan.targetInvoiceId);
    if (error) {
      throw new Error(`Material saved, but failed to sync linked invoice: ${error.message}`);
    }
  }

  return plan;
}

/**
 * Direct Supabase mutation (with optional Node Express backend fallback) for editing
 * a subscriber's hardware/material log row and auto-recalculating any linked INV-MAT-* invoice.
 */
export async function updateInventoryLogApi(
  id: string,
  payload: {
    item_name: string;
    quantity: number;
    unit_cost: number;
    installed_by_agent_name?: string | null;
    installed_by?: string | null;
    created_at?: string;
  }
): Promise<ApiMutationResponse> {
  const actor = assertCanEditDeleteLedgerClient();
  const logId = String(id || '').trim();
  if (!logId || logId.length > 80) {
    throw new Error('Invalid inventory log ID.');
  }

  const itemName = String(payload.item_name || '').trim().slice(0, 180);
  const quantity = Number(payload.quantity);
  const unitCost = Number(payload.unit_cost);
  const installedBy = String(
    payload.installed_by_agent_name ?? payload.installed_by ?? 'Field Technician'
  )
    .trim()
    .slice(0, 120);

  if (!itemName) throw new Error('Item Name is required.');
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error('Quantity must be a positive number.');
  }
  if (!Number.isFinite(unitCost) || unitCost < 0) {
    throw new Error('Unit Cost must be 0 or greater.');
  }

  const { data: existing, error: fetchErr } = await supabase
    .from('subscriber_inventory_logs')
    .select('*')
    .eq('id', logId)
    .maybeSingle();

  if (fetchErr) {
    const fb = await tryBackendJsonFallback(
      `/api/subscribers/inventory-logs/${encodeURIComponent(logId)}`,
      'PATCH',
      payload,
      `/api/subscribers/inventory-logs/${encodeURIComponent(logId)}/update`
    );
    if (fb.ok && fb.json) return fb.json;
    throw new Error(fetchErr.message || 'Failed to fetch material log from Supabase.');
  }

  if (!existing) {
    throw new Error('Inventory log entry not found.');
  }

  await assertResellerRecordScopeClient(actor, existing.subscriber_username);

  const totalCharge = Math.round(quantity * unitCost * 100) / 100;
  const updatePayload: Record<string, any> = {
    item_name: itemName,
    quantity,
    unit_cost: unitCost,
    total_charge: totalCharge,
    installed_by_agent_name: installedBy || 'Field Technician',
    installed_by: installedBy || 'Field Technician',
  };

  if (payload.created_at) {
    const parsedDate = new Date(String(payload.created_at));
    if (!Number.isNaN(parsedDate.getTime())) {
      updatePayload.created_at = parsedDate.toISOString();
    }
  }

  const { data: updated, error: updateErr, appliedPayload } = await adaptiveSupabaseUpdate(
    'subscriber_inventory_logs',
    logId,
    updatePayload,
    new Set(['total_charge', 'installed_by'])
  );

  if (updateErr) {
    const fb = await tryBackendJsonFallback(
      `/api/subscribers/inventory-logs/${encodeURIComponent(logId)}`,
      'PATCH',
      payload,
      `/api/subscribers/inventory-logs/${encodeURIComponent(logId)}/update`
    );
    if (fb.ok && fb.json) return fb.json;
    throw new Error(updateErr.message || 'Failed to update material log.');
  }

  const finalRow = updated || { ...existing, ...appliedPayload };
  const invoiceSync = await applyMaterialInvoiceSyncInSupabase({
    subscriberUsername: existing.subscriber_username,
    previousItem: existing as MinimalInventoryLog,
    updatedItem: finalRow as MinimalInventoryLog,
  });

  return {
    success: true,
    data: finalRow,
    invoiceSync,
  };
}

/**
 * Direct Supabase mutation (with optional Node Express backend fallback) for deleting
 * a subscriber's hardware/material log row and syncing/cleaning up any linked INV-MAT-* invoice.
 */
export async function deleteInventoryLogApi(id: string): Promise<ApiMutationResponse> {
  const actor = assertCanEditDeleteLedgerClient();
  const logId = String(id || '').trim();
  if (!logId || logId.length > 80) {
    throw new Error('Invalid inventory log ID.');
  }

  const { data: existing, error: fetchErr } = await supabase
    .from('subscriber_inventory_logs')
    .select('*')
    .eq('id', logId)
    .maybeSingle();

  if (fetchErr) {
    const fb = await tryBackendJsonFallback(
      `/api/subscribers/inventory-logs/${encodeURIComponent(logId)}`,
      'DELETE',
      undefined,
      `/api/subscribers/inventory-logs/${encodeURIComponent(logId)}/delete`
    );
    if (fb.ok && fb.json) return fb.json;
    throw new Error(fetchErr.message || 'Failed to fetch material log from Supabase.');
  }

  if (!existing) {
    throw new Error('Inventory log entry not found.');
  }

  await assertResellerRecordScopeClient(actor, existing.subscriber_username);

  const { error: delErr } = await supabase
    .from('subscriber_inventory_logs')
    .delete()
    .eq('id', logId);

  if (delErr) {
    const fb = await tryBackendJsonFallback(
      `/api/subscribers/inventory-logs/${encodeURIComponent(logId)}`,
      'DELETE',
      undefined,
      `/api/subscribers/inventory-logs/${encodeURIComponent(logId)}/delete`
    );
    if (fb.ok && fb.json) return fb.json;
    throw new Error(delErr.message || 'Failed to delete material log.');
  }

  const invoiceSync = await applyMaterialInvoiceSyncInSupabase({
    subscriberUsername: existing.subscriber_username,
    previousItem: existing as MinimalInventoryLog,
    updatedItem: null,
  });

  return {
    success: true,
    data: { id: logId },
    invoiceSync,
  };
}

/**
 * Direct Supabase mutation (with optional Node Express backend fallback) for editing
 * an invoice row (`invoices` table). Never triggers HTTP 405 on static hosts like Netlify.
 */
export async function updateInvoiceApi(
  id: string,
  payload: {
    amount: number;
    due_date: string;
    status: 'DUE' | 'PARTIAL' | 'PAID' | 'OVERDUE';
    assigned_agent_id?: string | null;
    assigned_agent_name?: string | null;
    assigned_agent?: string | null;
    notes?: string | null;
    cycle_day?: number;
    billing_cycle_day?: number;
    package_profile?: string | null;
    package_name?: string | null;
    paid_amount?: number;
    paid_at?: string | null;
  }
): Promise<ApiMutationResponse> {
  const actor = assertCanEditDeleteLedgerClient();
  const invoiceId = String(id || '').trim();
  if (!invoiceId || invoiceId.length > 80) {
    throw new Error('Invalid invoice ID.');
  }

  const amount = Number(payload.amount);
  const dueDate = String(payload.due_date || '').trim();
  const rawStatus = String(payload.status || 'DUE').trim().toUpperCase();
  const validStatuses = new Set(['DUE', 'PARTIAL', 'PAID', 'OVERDUE']);

  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error('Invoice amount must be 0 or greater.');
  }
  if (!dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate.slice(0, 10))) {
    throw new Error('Valid Due Date (YYYY-MM-DD) is required.');
  }
  if (!validStatuses.has(rawStatus)) {
    throw new Error('Invalid invoice status.');
  }

  const { data: existing, error: fetchErr } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', invoiceId)
    .maybeSingle();

  if (fetchErr) {
    const fb = await tryBackendJsonFallback(
      `/api/invoices/${encodeURIComponent(invoiceId)}`,
      'PATCH',
      payload,
      `/api/invoices/${encodeURIComponent(invoiceId)}/update`
    );
    if (fb.ok && fb.json) return fb.json;
    throw new Error(fetchErr.message || 'Failed to fetch invoice from Supabase.');
  }

  if (!existing) {
    throw new Error('Invoice not found.');
  }

  await assertResellerRecordScopeClient(actor, existing.subscriber_username, {
    dealer_id: existing.dealer_id,
    sub_dealer_id: existing.sub_dealer_id,
  });

  const updatePayload: Record<string, any> = {
    amount,
    due_date: dueDate.slice(0, 10),
    status: rawStatus,
  };

  const requestedCycleDay = payload.cycle_day ?? payload.billing_cycle_day;
  if (requestedCycleDay !== undefined) {
    const cDay = Number(requestedCycleDay);
    if (Number.isFinite(cDay) && cDay >= 1 && cDay <= 31) {
      updatePayload.cycle_day = Math.round(cDay);
      updatePayload.billing_cycle_day = Math.round(cDay);
    }
  }

  if (payload.assigned_agent_id !== undefined) {
    updatePayload.assigned_agent_id = payload.assigned_agent_id
      ? String(payload.assigned_agent_id).trim()
      : null;
  }

  const requestedAgentName =
    payload.assigned_agent_name !== undefined
      ? payload.assigned_agent_name
      : payload.assigned_agent;
  if (requestedAgentName !== undefined) {
    const cleanAgent = requestedAgentName ? String(requestedAgentName).trim().slice(0, 120) : null;
    updatePayload.assigned_agent_name = cleanAgent;
    updatePayload.assigned_agent = cleanAgent;
  }

  if (payload.notes !== undefined) {
    updatePayload.notes = payload.notes ? String(payload.notes).trim().slice(0, 500) : null;
  }

  const requestedPkg = payload.package_profile || payload.package_name;
  if (requestedPkg) {
    const pkg = String(requestedPkg).trim().slice(0, 100);
    updatePayload.package_profile = pkg;
    updatePayload.package_name = pkg;
  }

  if (rawStatus === 'PAID') {
    updatePayload.paid_amount =
      payload.paid_amount !== undefined && Number.isFinite(Number(payload.paid_amount))
        ? Math.max(amount, Number(payload.paid_amount))
        : amount;
    updatePayload.paid_at = existing.paid_at || payload.paid_at || new Date().toISOString();
  } else if (rawStatus === 'DUE' || rawStatus === 'OVERDUE') {
    if (payload.paid_amount !== undefined && Number.isFinite(Number(payload.paid_amount))) {
      updatePayload.paid_amount = Math.max(0, Math.min(amount, Number(payload.paid_amount)));
    } else if (String(existing.status || '').toUpperCase() === 'PAID') {
      updatePayload.paid_amount = 0;
      updatePayload.paid_at = null;
    }
    if (payload.paid_at === null) {
      updatePayload.paid_at = null;
    }
  } else if (rawStatus === 'PARTIAL') {
    const existingPaid = Number(existing.paid_amount) || 0;
    const requestedPaid =
      payload.paid_amount !== undefined && Number.isFinite(Number(payload.paid_amount))
        ? Number(payload.paid_amount)
        : existingPaid;
    updatePayload.paid_amount = Math.max(0, Math.min(amount, requestedPaid));
  }

  const { data: updatedRow, error: updateErr, appliedPayload } = await adaptiveSupabaseUpdate(
    'invoices',
    invoiceId,
    updatePayload,
    new Set([
      'notes',
      'package_profile',
      'package_name',
      'billing_cycle_day',
      'assigned_agent',
      'shifted_to_next_month',
    ])
  );

  if (updateErr) {
    const fb = await tryBackendJsonFallback(
      `/api/invoices/${encodeURIComponent(invoiceId)}`,
      'PATCH',
      payload,
      `/api/invoices/${encodeURIComponent(invoiceId)}/update`
    );
    if (fb.ok && fb.json) return fb.json;
    throw new Error(updateErr.message || 'Failed to update invoice.');
  }

  return {
    success: true,
    data: updatedRow || { ...existing, ...appliedPayload },
  };
}

/**
 * Direct Supabase mutation (with optional Node Express backend fallback) for deleting
 * an invoice row (`invoices` table) and optionally its linked `payment_transactions`.
 */
export async function deleteInvoiceApi(
  id: string,
  options?: { deleteLinkedPayments?: boolean }
): Promise<ApiMutationResponse> {
  const actor = assertCanEditDeleteLedgerClient();
  const invoiceId = String(id || '').trim();
  if (!invoiceId || invoiceId.length > 80) {
    throw new Error('Invalid invoice ID.');
  }

  const { data: existing, error: fetchErr } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', invoiceId)
    .maybeSingle();

  if (fetchErr) {
    const fb = await tryBackendJsonFallback(
      `/api/invoices/${encodeURIComponent(invoiceId)}`,
      'DELETE',
      { deleteLinkedPayments: Boolean(options?.deleteLinkedPayments) },
      `/api/invoices/${encodeURIComponent(invoiceId)}/delete`
    );
    if (fb.ok && fb.json) return fb.json;
    throw new Error(fetchErr.message || 'Failed to fetch invoice from Supabase.');
  }

  if (!existing) {
    throw new Error('Invoice not found.');
  }

  await assertResellerRecordScopeClient(actor, existing.subscriber_username, {
    dealer_id: existing.dealer_id,
    sub_dealer_id: existing.sub_dealer_id,
  });

  let deletedPaymentsCount = 0;
  if (options?.deleteLinkedPayments) {
    const { data: deletedTxs, error: txErr } = await supabase
      .from('payment_transactions')
      .delete()
      .eq('invoice_id', invoiceId)
      .select('id');
    if (txErr) {
      throw new Error(`Failed to delete linked payment receipts: ${txErr.message}`);
    }
    deletedPaymentsCount = Array.isArray(deletedTxs) ? deletedTxs.length : 0;
  }

  const { error: delErr } = await supabase.from('invoices').delete().eq('id', invoiceId);

  if (delErr) {
    const fb = await tryBackendJsonFallback(
      `/api/invoices/${encodeURIComponent(invoiceId)}`,
      'DELETE',
      { deleteLinkedPayments: Boolean(options?.deleteLinkedPayments) },
      `/api/invoices/${encodeURIComponent(invoiceId)}/delete`
    );
    if (fb.ok && fb.json) return fb.json;
    throw new Error(delErr.message || 'Failed to delete invoice.');
  }

  return {
    success: true,
    data: { id: invoiceId, invoice_no: existing.invoice_no },
    deletedPaymentsCount,
  };
}
