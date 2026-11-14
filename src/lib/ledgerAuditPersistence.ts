import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  SupabaseAgentCashTransaction,
  SupabaseInvoice,
  SupabasePaymentTransaction,
  SupabasePortalUser,
  SupabaseRecoveryLedgerRow,
} from '../services/supabaseClient';
import { isMissingTableOrColumnError } from './expiryUtils';

export type AuditLedgerSourceTable =
  | 'recovery_ledger'
  | 'payment_transactions'
  | 'agent_cash_transactions'
  | 'invoices';

export interface FieldAuditLedgerRow {
  uid: string;
  recordId: string;
  sourceTable: AuditLedgerSourceTable;
  invoiceId?: string | null;
  invoiceNo?: string | null;
  subscriberUsername?: string | null;
  agentId: string;
  agentName: string;
  entryType: string;
  amount: number;
  previousAmount?: number | null;
  paymentMethod: string;
  collectedAt: string;
  remarks: string;
  editedBy?: string | null;
  editedAt?: string | null;
  editReason?: string | null;
}

export interface UpdateLedgerEntryParams {
  supabaseClient: SupabaseClient;
  entry: FieldAuditLedgerRow;
  amount: number;
  paymentMethod: string;
  collectedAtIso: string;
  agentId: string;
  agentName: string;
  remarks: string;
  editedBy: string;
  editReason?: string;
}

export interface VerifiedLedgerUpdateResult {
  updatedRow: Record<string, any>;
  usedFallbackCoreColumns: boolean;
  linkedInvoiceUpdated: boolean;
  auditColumnsMissingInSchema: boolean;
}

function appendAuditTrailToNotes(
  baseRemarks: string,
  previousAmount: number,
  newAmount: number,
  editedBy: string,
  editedAtIso: string,
  editReason?: string
): string {
  const cleanBase = baseRemarks.replace(/\s*\[Audit Edit:[^\]]*\]/g, '').trim();
  const reasonPart = editReason?.trim() ? ` | Reason: ${editReason.trim()}` : '';
  const stamp = `[Audit Edit: Prev Rs.${Math.round(previousAmount)} -> Rs.${Math.round(newAmount)} by ${editedBy} @ ${editedAtIso.slice(0, 16).replace('T', ' ')}${reasonPart}]`;
  return cleanBase ? `${cleanBase} ${stamp}` : stamp;
}

function parseEmbeddedAuditFromNotes(notes?: string | null): {
  previousAmount: number | null;
  editedBy: string | null;
  editedAt: string | null;
  editReason: string | null;
} {
  const text = String(notes || '');
  const match = text.match(/\[Audit Edit:\s*Prev Rs\.([\d.]+)\s*->\s*Rs\.[\d.]+\s*by\s*([^@|]+?)\s*@\s*([^|\]]+?)(?:\|\s*Reason:\s*([^\]]+))?\]/);
  if (!match) {
    return { previousAmount: null, editedBy: null, editedAt: null, editReason: null };
  }
  return {
    previousAmount: Number.isFinite(Number(match[1])) ? Number(match[1]) : null,
    editedBy: match[2]?.trim() || null,
    editedAt: match[3]?.trim() || null,
    editReason: match[4]?.trim() || null,
  };
}

/**
 * Merge live Supabase rows into unified Field Agent Audit Ledger rows.
 */
export function buildFieldAuditLedgerRows(params: {
  recoveryLedgerRows?: SupabaseRecoveryLedgerRow[];
  paymentTxns: SupabasePaymentTransaction[];
  cashLedger: SupabaseAgentCashTransaction[];
  invoices: SupabaseInvoice[];
  agents: SupabasePortalUser[];
}): FieldAuditLedgerRow[] {
  const { recoveryLedgerRows = [], paymentTxns, cashLedger, invoices, agents } = params;
  const rows: FieldAuditLedgerRow[] = [];

  const resolveAgent = (id?: string | null, name?: string | null) => {
    if (id) {
      const byId = agents.find((a) => a.id === id);
      if (byId) return { id: byId.id, name: byId.full_name };
    }
    const clean = (name || '').trim().toLowerCase();
    if (clean) {
      const byName = agents.find(
        (a) =>
          (a.full_name || '').trim().toLowerCase() === clean ||
          (a.username || '').trim().toLowerCase() === clean
      );
      if (byName) return { id: byName.id, name: byName.full_name };
    }
    return { id: id || '', name: name || 'NOC Desk / Direct' };
  };

  const invoiceById = new Map<string, SupabaseInvoice>();
  for (const inv of invoices) {
    if (inv?.id) invoiceById.set(inv.id, inv);
  }

  const coveredInvoiceIds = new Set<string>();

  // 1. Dedicated recovery_ledger rows (when present)
  for (const rl of recoveryLedgerRows) {
    if (!rl?.id) continue;
    if (rl.invoice_id) coveredInvoiceIds.add(rl.invoice_id);
    const ag = resolveAgent(rl.agent_id, rl.agent_name);
    const inv = rl.invoice_id ? invoiceById.get(rl.invoice_id) : undefined;
    rows.push({
      uid: `rl-${rl.id}`,
      recordId: rl.id,
      sourceTable: 'recovery_ledger',
      invoiceId: rl.invoice_id || null,
      invoiceNo: inv?.invoice_no || null,
      subscriberUsername: rl.subscriber_username || inv?.subscriber_username || null,
      agentId: ag.id,
      agentName: ag.name,
      entryType: 'COLLECTION',
      amount: Number(rl.amount) || 0,
      previousAmount: rl.previous_amount ?? null,
      paymentMethod: rl.payment_method || 'Cash Handover',
      collectedAt: rl.collected_at || rl.created_at || new Date().toISOString(),
      remarks: rl.remarks || '',
      editedBy: rl.edited_by || null,
      editedAt: rl.edited_at || null,
      editReason: rl.edit_reason || null,
    });
  }

  // 2. Live payment_transactions rows
  for (const tx of paymentTxns) {
    if (!tx?.id) continue;
    if (tx.invoice_id) coveredInvoiceIds.add(tx.invoice_id);
    const ag = resolveAgent(tx.collected_by_id, tx.collected_by_name);
    const inv = tx.invoice_id ? invoiceById.get(tx.invoice_id) : undefined;
    const embedded = parseEmbeddedAuditFromNotes(tx.notes);
    rows.push({
      uid: `pt-${tx.id}`,
      recordId: tx.id,
      sourceTable: 'payment_transactions',
      invoiceId: tx.invoice_id || null,
      invoiceNo: inv?.invoice_no || null,
      subscriberUsername: tx.subscriber_username || inv?.subscriber_username || null,
      agentId: ag.id,
      agentName: ag.name,
      entryType: 'COLLECTION',
      amount: Number(tx.amount_paid) || 0,
      previousAmount: tx.previous_amount ?? embedded.previousAmount,
      paymentMethod: tx.payment_mode || tx.payment_method || 'Cash Handover',
      collectedAt: tx.payment_date || tx.created_at || new Date().toISOString(),
      remarks: tx.notes || (inv ? `Collection for Invoice #${inv.invoice_no}` : 'Subscriber recovery'),
      editedBy: tx.edited_by || embedded.editedBy,
      editedAt: tx.edited_at || embedded.editedAt,
      editReason: tx.edit_reason || embedded.editReason,
    });
  }

  // 3. Paid/partial invoices that don't yet have an explicit payment_transactions row
  for (const inv of invoices) {
    const paidAmt = Number(inv?.paid_amount) || 0;
    if (paidAmt <= 0 || coveredInvoiceIds.has(inv.id)) continue;
    const ag = resolveAgent(inv.assigned_agent_id, inv.assigned_agent_name);
    rows.push({
      uid: `inv-${inv.id}`,
      recordId: inv.id,
      sourceTable: 'invoices',
      invoiceId: inv.id,
      invoiceNo: inv.invoice_no,
      subscriberUsername: inv.subscriber_username,
      agentId: ag.id,
      agentName: ag.name,
      entryType: 'COLLECTION',
      amount: paidAmt,
      previousAmount: null,
      paymentMethod: 'Cash Handover',
      collectedAt: inv.paid_at || inv.created_at || new Date().toISOString(),
      remarks: `Invoice #${inv.invoice_no} settled payment`,
      editedBy: (inv as any).edited_by || null,
      editedAt: (inv as any).edited_at || null,
      editReason: null,
    });
  }

  // 4. Handover, advance, & salary entries in agent_cash_transactions
  for (const ct of cashLedger) {
    if (!ct?.id) continue;
    const ag = resolveAgent(ct.agent_id, ct.agent_name);
    const embedded = parseEmbeddedAuditFromNotes(ct.notes);
    rows.push({
      uid: `act-${ct.id}`,
      recordId: ct.id,
      sourceTable: 'agent_cash_transactions',
      invoiceId: null,
      invoiceNo: null,
      subscriberUsername: null,
      agentId: ag.id,
      agentName: ag.name,
      entryType: String(ct.transaction_type || 'CASH_HANDOVER').toUpperCase(),
      amount: Number(ct.amount) || 0,
      previousAmount: ct.previous_amount ?? embedded.previousAmount,
      paymentMethod: ct.received_by || 'NOC Vault',
      collectedAt: ct.created_at || new Date().toISOString(),
      remarks: ct.notes || '',
      editedBy: ct.edited_by || embedded.editedBy,
      editedAt: ct.edited_at || embedded.editedAt,
      editReason: ct.edit_reason || embedded.editReason,
    });
  }

  rows.sort((a, b) => {
    const ta = new Date(a.collectedAt || 0).getTime();
    const tb = new Date(b.collectedAt || 0).getTime();
    return tb - ta;
  });

  return rows;
}

/**
 * Recompute fresh agent cash_in_hand and advance_balance directly from Supabase
 * and commit back to portal_users with .select().single().
 */
export async function reconcileAgentVaultBalancesInDb(
  supabaseClient: SupabaseClient,
  agentIds: string[]
): Promise<void> {
  const uniqueIds = Array.from(new Set(agentIds.filter(Boolean)));
  if (uniqueIds.length === 0) return;

  const [agentsRes, payRes, invRes, cashRes] = await Promise.all([
    supabaseClient.from('portal_users').select('id, full_name, username, cash_in_hand, advance_balance').in('id', uniqueIds),
    supabaseClient.from('payment_transactions').select('*'),
    supabaseClient.from('invoices').select('*').gt('paid_amount', 0),
    supabaseClient.from('agent_cash_transactions').select('*').in('agent_id', uniqueIds),
  ]);

  const agents = (agentsRes.data || []) as SupabasePortalUser[];
  const payments = (payRes.data || []) as SupabasePaymentTransaction[];
  const invoices = (invRes.data || []) as SupabaseInvoice[];
  const cashRows = (cashRes.data || []) as SupabaseAgentCashTransaction[];

  const recordedInvIds = new Set(payments.map((p) => p.invoice_id).filter(Boolean));

  for (const ag of agents) {
    const agFull = (ag.full_name || '').trim().toLowerCase();
    const agUser = (ag.username || '').trim().toLowerCase();
    const matchesName = (raw?: string | null) => {
      const c = (raw || '').trim().toLowerCase();
      if (!c) return false;
      return (agFull && c === agFull) || (agUser && c === agUser);
    };

    const txTotal = payments
      .filter((p) => p.collected_by_id === ag.id || (!p.collected_by_id && matchesName(p.collected_by_name)))
      .reduce((s, p) => s + (Number(p.amount_paid) || 0), 0);

    const invTotal = invoices
      .filter((inv) => !recordedInvIds.has(inv.id) && (inv.assigned_agent_id === ag.id || (!inv.assigned_agent_id && matchesName(inv.assigned_agent_name))))
      .reduce((s, inv) => s + (Number(inv.paid_amount) || 0), 0);

    const agCashRows = cashRows.filter((c) => c.agent_id === ag.id);
    const handedOver = agCashRows
      .filter((c) => ['CASH_HANDOVER', 'HANDOVER'].includes(String(c.transaction_type || '').toUpperCase()))
      .reduce((s, c) => s + (Number(c.amount) || 0), 0);

    const advTaken = agCashRows
      .filter((c) => String(c.transaction_type || '').toUpperCase() === 'ADVANCE_TAKEN')
      .reduce((s, c) => s + (Number(c.amount) || 0), 0);
    const advRet = agCashRows
      .filter((c) => ['ADVANCE_RETURN', 'ADVANCE_DEDUCTION'].includes(String(c.transaction_type || '').toUpperCase()))
      .reduce((s, c) => s + (Number(c.amount) || 0), 0);

    const nextCashInHand = Math.max(0, txTotal + invTotal - handedOver);
    const nextAdvance = Math.max(0, advTaken - advRet);

    if (Number(ag.cash_in_hand ?? 0) !== nextCashInHand || Number(ag.advance_balance ?? 0) !== nextAdvance) {
      await supabaseClient
        .from('portal_users')
        .update({ cash_in_hand: nextCashInHand, advance_balance: nextAdvance })
        .eq('id', ag.id)
        .select('id, cash_in_hand, advance_balance')
        .maybeSingle();
    }
  }
}

/**
 * STRICT VERIFIED SUPABASE WRITE:
 * Executes .update(...).eq('id', ...).select().single(), guards against RLS empty responses,
 * updates linked invoices/payments if referenced, and reconciles agent vault totals.
 * Never swallows errors or writes optimistic-only state.
 */
export async function updateFieldAuditLedgerEntry(
  params: UpdateLedgerEntryParams
): Promise<VerifiedLedgerUpdateResult> {
  const {
    supabaseClient,
    entry,
    amount,
    paymentMethod,
    collectedAtIso,
    agentId,
    agentName,
    remarks,
    editedBy,
    editReason,
  } = params;

  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error('Amount must be a valid non-negative number.');
  }
  if (!entry.recordId) {
    throw new Error('Missing database row ID for this ledger entry.');
  }

  const nowIso = new Date().toISOString();
  const previousAmount = Number(entry.amount) || 0;
  let updatedRow: Record<string, any> | null = null;
  let usedFallbackCoreColumns = false;
  let auditColumnsMissingInSchema = false;
  let linkedInvoiceUpdated = false;

  if (entry.sourceTable === 'recovery_ledger') {
    const { data, error } = await supabaseClient
      .from('recovery_ledger')
      .update({
        amount,
        payment_method: paymentMethod,
        collected_at: collectedAtIso,
        agent_id: agentId || null,
        agent_name: agentName || null,
        remarks,
        previous_amount: previousAmount,
        edited_by: editedBy,
        edited_at: nowIso,
        edit_reason: editReason || null,
      })
      .eq('id', entry.recordId)
      .select()
      .single();

    if (error) {
      throw new Error(error.message);
    }
    if (!data) {
      throw new Error('Supabase update returned 0 rows (blocked by RLS policy or record not found).');
    }
    updatedRow = data as Record<string, any>;
  } else if (entry.sourceTable === 'payment_transactions') {
    const fullPayload = {
      amount_paid: amount,
      payment_mode: paymentMethod,
      payment_method: paymentMethod,
      payment_date: collectedAtIso,
      collected_by_id: agentId || null,
      collected_by_name: agentName || null,
      notes: remarks,
      previous_amount: previousAmount,
      edited_by: editedBy,
      edited_at: nowIso,
      edit_reason: editReason || null,
    };

    const { data, error } = await supabaseClient
      .from('payment_transactions')
      .update(fullPayload)
      .eq('id', entry.recordId)
      .select()
      .single();

    if (error && isMissingTableOrColumnError(error)) {
      auditColumnsMissingInSchema = true;
      usedFallbackCoreColumns = true;
      const fallbackNotes = appendAuditTrailToNotes(
        remarks,
        previousAmount,
        amount,
        editedBy,
        nowIso,
        editReason
      );
      const { data: coreData, error: coreErr } = await supabaseClient
        .from('payment_transactions')
        .update({
          amount_paid: amount,
          payment_mode: paymentMethod,
          payment_date: collectedAtIso,
          collected_by_id: agentId || null,
          collected_by_name: agentName || null,
          notes: fallbackNotes,
        })
        .eq('id', entry.recordId)
        .select()
        .single();

      if (coreErr) {
        throw new Error(coreErr.message);
      }
      if (!coreData) {
        throw new Error('Supabase update returned 0 rows on payment_transactions (check RLS UPDATE policy).');
      }
      updatedRow = coreData as Record<string, any>;
    } else if (error) {
      throw new Error(error.message);
    } else if (!data) {
      throw new Error('Supabase update returned 0 rows on payment_transactions (blocked by RLS policy or record missing).');
    } else {
      updatedRow = data as Record<string, any>;
    }
  } else if (entry.sourceTable === 'agent_cash_transactions') {
    const fullPayload = {
      amount,
      received_by: paymentMethod,
      created_at: collectedAtIso,
      agent_id: agentId || entry.agentId,
      agent_name: agentName || entry.agentName,
      notes: remarks,
      previous_amount: previousAmount,
      edited_by: editedBy,
      edited_at: nowIso,
      edit_reason: editReason || null,
    };

    const { data, error } = await supabaseClient
      .from('agent_cash_transactions')
      .update(fullPayload)
      .eq('id', entry.recordId)
      .select()
      .single();

    if (error && isMissingTableOrColumnError(error)) {
      auditColumnsMissingInSchema = true;
      usedFallbackCoreColumns = true;
      const fallbackNotes = appendAuditTrailToNotes(
        remarks,
        previousAmount,
        amount,
        editedBy,
        nowIso,
        editReason
      );
      const { data: coreData, error: coreErr } = await supabaseClient
        .from('agent_cash_transactions')
        .update({
          amount,
          received_by: paymentMethod,
          created_at: collectedAtIso,
          agent_id: agentId || entry.agentId,
          agent_name: agentName || entry.agentName,
          notes: fallbackNotes,
        })
        .eq('id', entry.recordId)
        .select()
        .single();

      if (coreErr) {
        throw new Error(coreErr.message);
      }
      if (!coreData) {
        throw new Error('Supabase update returned 0 rows on agent_cash_transactions (check RLS UPDATE policy).');
      }
      updatedRow = coreData as Record<string, any>;
    } else if (error) {
      throw new Error(error.message);
    } else if (!data) {
      throw new Error('Supabase update returned 0 rows on agent_cash_transactions (blocked by RLS policy or record missing).');
    } else {
      updatedRow = data as Record<string, any>;
    }
  } else if (entry.sourceTable === 'invoices') {
    const { data: invRow, error: invFetchErr } = await supabaseClient
      .from('invoices')
      .select('id, amount')
      .eq('id', entry.recordId)
      .maybeSingle();

    if (invFetchErr) throw new Error(invFetchErr.message);
    if (!invRow) throw new Error('Referenced invoice row not found in Supabase.');

    const invoiceAmount = Number(invRow.amount) || 0;
    const nextStatus = amount >= invoiceAmount ? 'PAID' : amount > 0 ? 'PARTIAL' : 'DUE';

    const { data: invUpd, error: invUpdErr } = await supabaseClient
      .from('invoices')
      .update({
        paid_amount: amount,
        status: nextStatus,
        assigned_agent_id: agentId || null,
        assigned_agent_name: agentName || null,
        paid_at: amount > 0 ? collectedAtIso : null,
      })
      .eq('id', entry.recordId)
      .select()
      .single();

    if (invUpdErr) throw new Error(invUpdErr.message);
    if (!invUpd) throw new Error('Invoice update returned 0 rows (blocked by RLS policy).');
    updatedRow = invUpd as Record<string, any>;
    linkedInvoiceUpdated = true;
  }

  // Update linked invoice row whenever this ledger entry references an invoice_id
  if (entry.invoiceId && entry.sourceTable !== 'invoices') {
    const [{ data: invRow, error: invErr }, { data: invTxRows }] = await Promise.all([
      supabaseClient.from('invoices').select('id, amount, paid_amount').eq('id', entry.invoiceId).maybeSingle(),
      supabaseClient.from('payment_transactions').select('id, amount_paid').eq('invoice_id', entry.invoiceId),
    ]);

    if (!invErr && invRow) {
      const invoiceTotal = Number(invRow.amount) || 0;
      const sumFromTxns = Array.isArray(invTxRows) && invTxRows.length > 0
        ? invTxRows.reduce((s, t: any) => s + (Number(t.amount_paid) || 0), 0)
        : amount;

      const clampedPaid = Math.max(0, sumFromTxns);
      const nextStatus = clampedPaid >= invoiceTotal && invoiceTotal > 0 ? 'PAID' : clampedPaid > 0 ? 'PARTIAL' : 'DUE';

      const { data: updInv, error: updInvErr } = await supabaseClient
        .from('invoices')
        .update({
          paid_amount: clampedPaid,
          status: nextStatus,
          assigned_agent_id: agentId || null,
          assigned_agent_name: agentName || null,
          paid_at: clampedPaid > 0 ? collectedAtIso : null,
        })
        .eq('id', entry.invoiceId)
        .select()
        .single();

      if (updInvErr) {
        throw new Error(`Ledger updated, but linked invoice update failed: ${updInvErr.message}`);
      }
      if (!updInv) {
        throw new Error('Linked invoice update returned 0 rows (check RLS UPDATE policy on invoices).');
      }
      linkedInvoiceUpdated = true;
    }
  }

  // Reconcile affected agent(s)' Cash in Hand & Advance Balance in portal_users
  await reconcileAgentVaultBalancesInDb(supabaseClient, [entry.agentId, agentId]);

  return {
    updatedRow: updatedRow!,
    usedFallbackCoreColumns,
    linkedInvoiceUpdated,
    auditColumnsMissingInSchema,
  };
}

/**
 * Recompute fresh totals directly from Supabase tables (no stale cache).
 */
export function computeDatabaseLedgerTotals(params: {
  invoices: SupabaseInvoice[];
  paymentTxns: SupabasePaymentTransaction[];
  cashLedger: SupabaseAgentCashTransaction[];
  recoveryLedgerRows?: SupabaseRecoveryLedgerRow[];
}) {
  const billedRevenueMrr = (params.invoices || []).reduce(
    (sum, inv) => sum + (Number(inv.amount) || 0),
    0
  );

  const coveredInvIds = new Set<string>();
  let totalCollected = 0;

  for (const rl of params.recoveryLedgerRows || []) {
    if (rl.invoice_id) coveredInvIds.add(rl.invoice_id);
    totalCollected += Number(rl.amount) || 0;
  }

  for (const tx of params.paymentTxns || []) {
    if (tx.invoice_id) coveredInvIds.add(tx.invoice_id);
    totalCollected += Number(tx.amount_paid) || 0;
  }

  for (const inv of params.invoices || []) {
    const paidAmt = Number(inv.paid_amount) || 0;
    if (paidAmt > 0 && !coveredInvIds.has(inv.id)) {
      totalCollected += paidAmt;
    }
  }

  const totalHandedOver = (params.cashLedger || [])
    .filter((c) => ['CASH_HANDOVER', 'HANDOVER'].includes(String(c.transaction_type || '').toUpperCase()))
    .reduce((sum, c) => sum + (Number(c.amount) || 0), 0);

  const totalCashInHand = Math.max(0, totalCollected - totalHandedOver);

  return {
    billedRevenueMrr,
    totalCollected,
    totalHandedOver,
    totalCashInHand,
  };
}
