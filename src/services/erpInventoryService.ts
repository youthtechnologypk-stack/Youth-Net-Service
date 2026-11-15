import {
  supabase,
  IspExpensePaymentMethod,
  SupabaseAgentCommission,
  SupabaseInventoryItem,
  SupabaseInventoryPurchase,
  SupabaseInventorySale,
  SupabaseVendor,
  SupabaseVendorTransaction,
} from './supabaseClient';
import { getTodayDateInputValue } from '../lib/dateFilter';
import { encodeExpenseNotes } from '../lib/profitLoss';

export const INVENTORY_CATEGORIES: Array<{
  value: string;
  label: string;
  shortLabel: string;
  color: string;
}> = [
  { value: 'ROUTER_ONT', label: 'Routers / ONTs', shortLabel: 'Routers/ONTs', color: '#06b6d4' },
  { value: 'PATCH_CORD', label: 'Fiber Patch Cords', shortLabel: 'Patch Cords', color: '#8b5cf6' },
  { value: 'FDB_SPLITTER', label: 'FDB Boxes & Splitters', shortLabel: 'FDB / Splitters', color: '#10b981' },
  { value: 'CAT6_CABLE', label: 'Cat6 / Ethernet Cable', shortLabel: 'Cat6 Cable', color: '#f59e0b' },
  { value: 'FIBER_CABLE', label: 'FTTH Drop / Fiber Cable', shortLabel: 'Fiber Cable', color: '#3b82f6' },
  { value: 'ACCESSORY', label: 'Adapters, Connectors & Accessories', shortLabel: 'Accessories', color: '#ec4899' },
];

export function getInventoryCategoryMeta(category?: string | null) {
  const key = (category || 'ACCESSORY').toUpperCase();
  return (
    INVENTORY_CATEGORIES.find((c) => c.value === key) || {
      value: key,
      label: key.replace(/_/g, ' '),
      shortLabel: key.replace(/_/g, ' '),
      color: '#64748b',
    }
  );
}

export function isMissingErpTableError(error: any): boolean {
  if (!error) return false;
  const code = String(error.code || '').toUpperCase();
  const msg = String(error.message || error.details || error.hint || '').toLowerCase();
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache')
  );
}

function roundMoney(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// ============================================================================
// 1. FIELD AGENT NEW-CONNECTION COMMISSIONS (100% SUPABASE + LEDGER SYNC)
// ============================================================================

export async function fetchAgentCommissions(agentId?: string): Promise<{
  data: SupabaseAgentCommission[];
  missingTable: boolean;
  error?: string;
}> {
  let q = supabase
    .from('agent_commissions')
    .select('*')
    .order('created_at', { ascending: false });

  if (agentId) {
    q = q.eq('agent_id', agentId);
  }

  const { data, error } = await q;
  if (error) {
    if (isMissingErpTableError(error)) {
      return { data: [], missingTable: true, error: error.message };
    }
    return { data: [], missingTable: false, error: error.message };
  }
  return {
    data: (data || []).map((row: any) => ({
      ...row,
      commission_amount: Number(row.commission_amount) || 0,
    })),
    missingTable: false,
  };
}

export async function createAgentCommission(input: {
  agent_id: string;
  agent_name: string;
  subscriber_id?: string | null;
  subscriber_username: string;
  client_name: string;
  package_name: string;
  commission_amount: number;
  notes?: string;
}): Promise<SupabaseAgentCommission> {
  const payload = {
    agent_id: input.agent_id,
    agent_name: input.agent_name.trim(),
    subscriber_id: input.subscriber_id || null,
    subscriber_username: input.subscriber_username.trim().toLowerCase(),
    client_name: input.client_name.trim() || input.subscriber_username.trim(),
    package_name: input.package_name.trim() || 'Standard Fiber',
    commission_amount: roundMoney(input.commission_amount),
    status: 'UNPAID',
    paid_at: null,
    ledger_entry_id: null,
    notes: (input.notes || '').trim(),
  };

  const { data, error } = await supabase
    .from('agent_commissions')
    .insert([payload])
    .select('*')
    .single();

  if (error) throw error;
  return { ...data, commission_amount: Number(data.commission_amount) || 0 };
}

function buildCommissionExpenseTitle(agentName: string, subscriberUsername: string, clientName: string): string {
  const cleanHandle = subscriberUsername.trim().replace(/^@+/, '');
  const refLabel = cleanHandle ? `@${cleanHandle}` : clientName.trim() || 'New Subscriber';
  return `New Connection Commission - Agent ${agentName.trim()} for Client ${refLabel}`;
}

export async function markCommissionPaidAndPostToLedger(
  commission: SupabaseAgentCommission,
  recordedBy: string = 'Admin'
): Promise<SupabaseAgentCommission> {
  const amount = roundMoney(commission.commission_amount);
  if (amount <= 0) {
    throw new Error('Commission amount must be greater than zero before posting to ledger.');
  }

  const paidAtIso = new Date().toISOString();
  const expenseDate = getTodayDateInputValue();
  const expenseTitle = buildCommissionExpenseTitle(
    commission.agent_name,
    commission.subscriber_username,
    commission.client_name
  );

  let ledgerEntryId = commission.ledger_entry_id || null;

  if (ledgerEntryId) {
    // Sync existing ledger entry if already linked
    const { error: updExpErr } = await supabase
      .from('isp_expenses')
      .update({
        expense_category: 'AGENT_COMMISSION',
        title: expenseTitle,
        amount,
        payment_method: 'CASH',
        expense_date: expenseDate,
        notes: encodeExpenseNotes(
          commission.agent_name,
          commission.notes || `New connection commission (${commission.package_name || 'Fiber'})`
        ),
        recorded_by: recordedBy,
      })
      .eq('id', ledgerEntryId);
    if (updExpErr) throw updExpErr;
  } else {
    const { data: expenseData, error: expError } = await supabase
      .from('isp_expenses')
      .insert([
        {
          expense_category: 'AGENT_COMMISSION',
          title: expenseTitle,
          amount,
          payment_method: 'CASH',
          expense_date: expenseDate,
          notes: encodeExpenseNotes(
            commission.agent_name,
            commission.notes || `New connection commission (${commission.package_name || 'Fiber'})`
          ),
          recorded_by: recordedBy,
        },
      ])
      .select('id')
      .single();

    if (expError) throw expError;
    ledgerEntryId = expenseData?.id || null;
  }

  const { data: updated, error: updErr } = await supabase
    .from('agent_commissions')
    .update({
      status: 'PAID',
      paid_at: paidAtIso,
      ledger_entry_id: ledgerEntryId,
    })
    .eq('id', commission.id)
    .select('*')
    .single();

  if (updErr) throw updErr;
  return { ...updated, commission_amount: Number(updated.commission_amount) || 0 };
}

export async function updateAgentCommission(
  existing: SupabaseAgentCommission,
  updates: {
    subscriber_username: string;
    client_name: string;
    package_name: string;
    commission_amount: number;
    status: 'UNPAID' | 'PAID';
    notes?: string;
  },
  recordedBy: string = 'Admin'
): Promise<SupabaseAgentCommission> {
  const nextAmount = roundMoney(updates.commission_amount);
  const nextUsername = updates.subscriber_username.trim().toLowerCase();
  const nextClient = updates.client_name.trim() || nextUsername;
  const nextPkg = updates.package_name.trim();
  const nextNotes = (updates.notes || '').trim();

  // Case A: Transitioning UNPAID -> PAID
  if (existing.status !== 'PAID' && updates.status === 'PAID') {
    const { data: preUpdated, error: preErr } = await supabase
      .from('agent_commissions')
      .update({
        subscriber_username: nextUsername,
        client_name: nextClient,
        package_name: nextPkg,
        commission_amount: nextAmount,
        notes: nextNotes,
      })
      .eq('id', existing.id)
      .select('*')
      .single();
    if (preErr) throw preErr;
    return markCommissionPaidAndPostToLedger(
      { ...preUpdated, commission_amount: Number(preUpdated.commission_amount) || 0 },
      recordedBy
    );
  }

  // Case B: Reverting PAID -> UNPAID (remove linked expense entry so ledger stays accurate)
  let ledgerEntryId = existing.ledger_entry_id || null;
  let paidAt = existing.paid_at || null;
  if (existing.status === 'PAID' && updates.status === 'UNPAID') {
    if (ledgerEntryId) {
      await supabase.from('isp_expenses').delete().eq('id', ledgerEntryId);
    }
    ledgerEntryId = null;
    paidAt = null;
  }

  // Case C: Still PAID -> update linked expense entry in isp_expenses
  if (existing.status === 'PAID' && updates.status === 'PAID' && ledgerEntryId) {
    const expenseTitle = buildCommissionExpenseTitle(existing.agent_name, nextUsername, nextClient);
    await supabase
      .from('isp_expenses')
      .update({
        title: expenseTitle,
        amount: nextAmount,
        notes: encodeExpenseNotes(
          existing.agent_name,
          nextNotes || `New connection commission (${nextPkg || 'Fiber'})`
        ),
      })
      .eq('id', ledgerEntryId);
  }

  const { data, error } = await supabase
    .from('agent_commissions')
    .update({
      subscriber_username: nextUsername,
      client_name: nextClient,
      package_name: nextPkg,
      commission_amount: nextAmount,
      status: updates.status,
      paid_at: paidAt,
      ledger_entry_id: ledgerEntryId,
      notes: nextNotes,
    })
    .eq('id', existing.id)
    .select('*')
    .single();

  if (error) throw error;
  return { ...data, commission_amount: Number(data.commission_amount) || 0 };
}

export async function deleteAgentCommission(commission: SupabaseAgentCommission): Promise<void> {
  if (commission.ledger_entry_id) {
    await supabase.from('isp_expenses').delete().eq('id', commission.ledger_entry_id);
  }
  const { error } = await supabase.from('agent_commissions').delete().eq('id', commission.id);
  if (error) throw error;
}

// ============================================================================
// 2. HARDWARE INVENTORY ITEMS CRUD
// ============================================================================

export async function fetchInventoryItems(): Promise<{
  data: SupabaseInventoryItem[];
  missingTable: boolean;
  error?: string;
}> {
  const { data, error } = await supabase
    .from('inventory_items')
    .select('*')
    .order('item_name', { ascending: true });

  if (error) {
    return {
      data: [],
      missingTable: isMissingErpTableError(error),
      error: error.message,
    };
  }

  return {
    data: (data || []).map((r: any) => ({
      ...r,
      avg_purchase_cost: Number(r.avg_purchase_cost) || 0,
      default_sale_price: Number(r.default_sale_price) || 0,
      stock_qty: Number(r.stock_qty) || 0,
      low_stock_alert: Number(r.low_stock_alert) || 5,
    })),
    missingTable: false,
  };
}

export async function createInventoryItem(input: {
  item_name: string;
  category: string;
  unit: string;
  avg_purchase_cost: number;
  default_sale_price: number;
  stock_qty: number;
  low_stock_alert: number;
}): Promise<SupabaseInventoryItem> {
  const { data, error } = await supabase
    .from('inventory_items')
    .insert([
      {
        item_name: input.item_name.trim(),
        category: input.category.trim(),
        unit: input.unit.trim() || 'pcs',
        avg_purchase_cost: roundMoney(input.avg_purchase_cost),
        default_sale_price: roundMoney(input.default_sale_price),
        stock_qty: roundMoney(input.stock_qty),
        low_stock_alert: roundMoney(input.low_stock_alert),
        updated_at: new Date().toISOString(),
      },
    ])
    .select('*')
    .single();
  if (error) throw error;
  return data as SupabaseInventoryItem;
}

export async function updateInventoryItem(
  id: string,
  input: Partial<{
    item_name: string;
    category: string;
    unit: string;
    avg_purchase_cost: number;
    default_sale_price: number;
    stock_qty: number;
    low_stock_alert: number;
  }>
): Promise<SupabaseInventoryItem> {
  const payload: Record<string, any> = { updated_at: new Date().toISOString() };
  if (input.item_name !== undefined) payload.item_name = input.item_name.trim();
  if (input.category !== undefined) payload.category = input.category.trim();
  if (input.unit !== undefined) payload.unit = input.unit.trim() || 'pcs';
  if (input.avg_purchase_cost !== undefined) payload.avg_purchase_cost = roundMoney(input.avg_purchase_cost);
  if (input.default_sale_price !== undefined) payload.default_sale_price = roundMoney(input.default_sale_price);
  if (input.stock_qty !== undefined) payload.stock_qty = roundMoney(input.stock_qty);
  if (input.low_stock_alert !== undefined) payload.low_stock_alert = roundMoney(input.low_stock_alert);

  const { data, error } = await supabase
    .from('inventory_items')
    .update(payload)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as SupabaseInventoryItem;
}

export async function deleteInventoryItem(id: string): Promise<void> {
  const { error } = await supabase.from('inventory_items').delete().eq('id', id);
  if (error) throw error;
}

export async function applyEquipmentSwapInventory(params: {
  deductItemId?: string | null;
  returnItemId?: string | null;
}): Promise<{
  deductedItemName: string | null;
  returnedItemName: string | null;
}> {
  const deductId = (params.deductItemId || '').trim();
  const returnId = (params.returnItemId || '').trim();
  let deductedItemName: string | null = null;
  let returnedItemName: string | null = null;

  if (!deductId && !returnId) {
    return { deductedItemName, returnedItemName };
  }

  // Same item selected for both deduct (-1) and return (+1) -> net zero stock change
  if (deductId && returnId && deductId === returnId) {
    const { data: item, error } = await supabase
      .from('inventory_items')
      .select('id, item_name, stock_qty')
      .eq('id', deductId)
      .single();
    if (error) throw error;
    if ((Number(item?.stock_qty) || 0) < 1) {
      throw new Error(`Insufficient stock for "${item?.item_name || 'selected hardware'}" (0 available).`);
    }
    deductedItemName = item?.item_name || null;
    returnedItemName = item?.item_name || null;
    return { deductedItemName, returnedItemName };
  }

  if (deductId) {
    const { data: deductRow, error: fetchDedErr } = await supabase
      .from('inventory_items')
      .select('id, item_name, stock_qty')
      .eq('id', deductId)
      .single();
    if (fetchDedErr) throw fetchDedErr;
    const currentQty = Number(deductRow?.stock_qty) || 0;
    if (currentQty < 1) {
      throw new Error(
        `Cannot deduct "${deductRow?.item_name || 'item'}": stock quantity is 0.`
      );
    }
    const { error: updDedErr } = await supabase
      .from('inventory_items')
      .update({
        stock_qty: roundMoney(currentQty - 1),
        updated_at: new Date().toISOString(),
      })
      .eq('id', deductId);
    if (updDedErr) throw updDedErr;
    deductedItemName = deductRow?.item_name || null;
  }

  if (returnId) {
    const { data: returnRow, error: fetchRetErr } = await supabase
      .from('inventory_items')
      .select('id, item_name, stock_qty')
      .eq('id', returnId)
      .single();
    if (fetchRetErr) throw fetchRetErr;
    const currentQty = Number(returnRow?.stock_qty) || 0;
    const { error: updRetErr } = await supabase
      .from('inventory_items')
      .update({
        stock_qty: roundMoney(currentQty + 1),
        updated_at: new Date().toISOString(),
      })
      .eq('id', returnId);
    if (updRetErr) throw updRetErr;
    returnedItemName = returnRow?.item_name || null;
  }

  return { deductedItemName, returnedItemName };
}

// ============================================================================
// 3. VENDORS & VENDOR PAYABLES LEDGER
// ============================================================================

export async function fetchVendors(): Promise<{
  data: SupabaseVendor[];
  missingTable: boolean;
  error?: string;
}> {
  const { data, error } = await supabase
    .from('vendors')
    .select('*')
    .order('vendor_name', { ascending: true });

  if (error) {
    return {
      data: [],
      missingTable: isMissingErpTableError(error),
      error: error.message,
    };
  }
  return {
    data: (data || []).map((v: any) => ({
      ...v,
      total_purchased: Number(v.total_purchased) || 0,
      total_paid: Number(v.total_paid) || 0,
      balance_payable: Number(v.balance_payable) || 0,
    })),
    missingTable: false,
  };
}

export async function createVendor(input: {
  vendor_name: string;
  company_name?: string;
  phone?: string;
}): Promise<SupabaseVendor> {
  const { data, error } = await supabase
    .from('vendors')
    .insert([
      {
        vendor_name: input.vendor_name.trim(),
        company_name: (input.company_name || '').trim(),
        phone: (input.phone || '').trim(),
        total_purchased: 0,
        total_paid: 0,
        balance_payable: 0,
      },
    ])
    .select('*')
    .single();
  if (error) throw error;
  return data as SupabaseVendor;
}

export async function updateVendor(
  id: string,
  input: { vendor_name: string; company_name?: string; phone?: string }
): Promise<SupabaseVendor> {
  const { data, error } = await supabase
    .from('vendors')
    .update({
      vendor_name: input.vendor_name.trim(),
      company_name: (input.company_name || '').trim(),
      phone: (input.phone || '').trim(),
    })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as SupabaseVendor;
}

export async function deleteVendor(id: string): Promise<void> {
  const { error } = await supabase.from('vendors').delete().eq('id', id);
  if (error) throw error;
}

export async function fetchVendorTransactions(vendorId?: string): Promise<SupabaseVendorTransaction[]> {
  let q = supabase.from('vendor_transactions').select('*').order('tx_date', { ascending: false });
  if (vendorId) q = q.eq('vendor_id', vendorId);
  const { data, error } = await q;
  if (error) return [];
  return (data || []).map((t: any) => ({ ...t, amount: Number(t.amount) || 0 }));
}

export async function recordVendorPayment(input: {
  vendor: SupabaseVendor;
  amount: number;
  payment_method?: IspExpensePaymentMethod;
  reference_note?: string;
  tx_date?: string;
  postToExpenseLedger?: boolean;
  recordedBy?: string;
}): Promise<void> {
  const payAmount = roundMoney(input.amount);
  if (payAmount <= 0) throw new Error('Payment amount must be greater than zero.');

  const txDate = input.tx_date || new Date().toISOString();
  const note =
    (input.reference_note || '').trim() || `Vendor settlement payment to ${input.vendor.vendor_name}`;

  const { error: txErr } = await supabase.from('vendor_transactions').insert([
    {
      vendor_id: input.vendor.id,
      tx_type: 'PAYMENT_PAID',
      amount: payAmount,
      reference_note: note,
      tx_date: txDate,
    },
  ]);
  if (txErr) throw txErr;

  const newTotalPaid = roundMoney((Number(input.vendor.total_paid) || 0) + payAmount);
  const newBalancePayable = roundMoney(
    Math.max(0, (Number(input.vendor.total_purchased) || 0) - newTotalPaid)
  );

  const { error: updErr } = await supabase
    .from('vendors')
    .update({
      total_paid: newTotalPaid,
      balance_payable: newBalancePayable,
    })
    .eq('id', input.vendor.id);
  if (updErr) throw updErr;

  if (input.postToExpenseLedger) {
    const expDateStr = txDate.slice(0, 10) || getTodayDateInputValue();
    await supabase.from('isp_expenses').insert([
      {
        expense_category: 'FIBER_HARDWARE',
        title: `Vendor Payment - ${input.vendor.vendor_name}${
          input.vendor.company_name ? ` (${input.vendor.company_name})` : ''
        }`,
        amount: payAmount,
        payment_method: input.payment_method || 'CASH',
        expense_date: expDateStr,
        notes: encodeExpenseNotes(input.vendor.vendor_name, note),
        recorded_by: input.recordedBy || 'Admin',
      },
    ]);
  }
}

// ============================================================================
// 4. INVENTORY PURCHASES (STOCK IN + WEIGHTED AVG COST + VENDOR PAYABLES)
// ============================================================================

export async function fetchInventoryPurchases(): Promise<SupabaseInventoryPurchase[]> {
  const { data, error } = await supabase
    .from('inventory_purchases')
    .select('*')
    .order('purchase_date', { ascending: false });
  if (error) return [];
  return (data || []).map((p: any) => ({
    ...p,
    qty: Number(p.qty) || 0,
    unit_cost: Number(p.unit_cost) || 0,
    total_cost: Number(p.total_cost) || 0,
    amount_paid: Number(p.amount_paid) || 0,
  }));
}

export async function createInventoryPurchase(input: {
  item: SupabaseInventoryItem;
  vendor?: SupabaseVendor | null;
  qty: number;
  unit_cost: number;
  payment_status: 'PAID' | 'CREDIT_PAYABLE' | 'PARTIAL';
  amount_paid?: number;
  purchase_date?: string;
  notes?: string;
}): Promise<SupabaseInventoryPurchase> {
  const qty = roundMoney(input.qty);
  const unitCost = roundMoney(input.unit_cost);
  if (qty <= 0) throw new Error('Purchase quantity must be greater than zero.');
  if (unitCost < 0) throw new Error('Unit cost cannot be negative.');

  const totalCost = roundMoney(qty * unitCost);
  const amountPaid =
    input.payment_status === 'PAID'
      ? totalCost
      : input.payment_status === 'CREDIT_PAYABLE'
      ? 0
      : Math.min(totalCost, Math.max(0, roundMoney(input.amount_paid || 0)));
  const purchaseDate = input.purchase_date || new Date().toISOString();

  const { data: insertedPurchase, error: insErr } = await supabase
    .from('inventory_purchases')
    .insert([
      {
        item_id: input.item.id,
        item_name: input.item.item_name,
        vendor_id: input.vendor?.id || null,
        vendor_name: input.vendor
          ? `${input.vendor.vendor_name}${input.vendor.company_name ? ` (${input.vendor.company_name})` : ''}`
          : 'Direct Cash Market',
        qty,
        unit_cost: unitCost,
        total_cost: totalCost,
        payment_status: input.payment_status,
        amount_paid: amountPaid,
        purchase_date: purchaseDate,
        notes: (input.notes || '').trim(),
      },
    ])
    .select('*')
    .single();
  if (insErr) throw insErr;

  // Update item stock_qty & weighted avg_purchase_cost
  const oldStock = Math.max(0, Number(input.item.stock_qty) || 0);
  const oldAvgCost = Math.max(0, Number(input.item.avg_purchase_cost) || 0);
  const newStock = roundMoney(oldStock + qty);
  const newAvgCost =
    newStock > 0 ? roundMoney((oldStock * oldAvgCost + totalCost) / newStock) : unitCost;

  const { error: itemUpdErr } = await supabase
    .from('inventory_items')
    .update({
      stock_qty: newStock,
      avg_purchase_cost: newAvgCost,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.item.id);
  if (itemUpdErr) throw itemUpdErr;

  // Sync Vendor Totals & Ledger Transactions
  if (input.vendor) {
    const newTotalPurchased = roundMoney((Number(input.vendor.total_purchased) || 0) + totalCost);
    const newTotalPaid = roundMoney((Number(input.vendor.total_paid) || 0) + amountPaid);
    const newBalancePayable = roundMoney(Math.max(0, newTotalPurchased - newTotalPaid));

    await supabase
      .from('vendors')
      .update({
        total_purchased: newTotalPurchased,
        total_paid: newTotalPaid,
        balance_payable: newBalancePayable,
      })
      .eq('id', input.vendor.id);

    await supabase.from('vendor_transactions').insert([
      {
        vendor_id: input.vendor.id,
        tx_type: 'PURCHASE_BILL',
        amount: totalCost,
        reference_note: `Purchased ${qty} ${input.item.unit} × ${input.item.item_name} @ Rs. ${unitCost}`,
        tx_date: purchaseDate,
      },
    ]);

    if (amountPaid > 0) {
      await supabase.from('vendor_transactions').insert([
        {
          vendor_id: input.vendor.id,
          tx_type: 'PAYMENT_PAID',
          amount: amountPaid,
          reference_note: `Paid on purchase (${input.payment_status}) for ${input.item.item_name}`,
          tx_date: purchaseDate,
        },
      ]);
    }
  }

  return {
    ...insertedPurchase,
    qty: Number(insertedPurchase.qty) || 0,
    unit_cost: Number(insertedPurchase.unit_cost) || 0,
    total_cost: Number(insertedPurchase.total_cost) || 0,
    amount_paid: Number(insertedPurchase.amount_paid) || 0,
  };
}

export async function deleteInventoryPurchase(purchase: SupabaseInventoryPurchase): Promise<void> {
  const { error: delErr } = await supabase
    .from('inventory_purchases')
    .delete()
    .eq('id', purchase.id);
  if (delErr) throw delErr;

  // Rollback stock quantity safely
  const { data: itemRow } = await supabase
    .from('inventory_items')
    .select('id,stock_qty')
    .eq('id', purchase.item_id)
    .maybeSingle();
  if (itemRow) {
    const nextQty = roundMoney(Math.max(0, (Number(itemRow.stock_qty) || 0) - (Number(purchase.qty) || 0)));
    await supabase
      .from('inventory_items')
      .update({ stock_qty: nextQty, updated_at: new Date().toISOString() })
      .eq('id', purchase.item_id);
  }

  // Rollback vendor balances if linked
  if (purchase.vendor_id) {
    const { data: vRow } = await supabase
      .from('vendors')
      .select('id,total_purchased,total_paid')
      .eq('id', purchase.vendor_id)
      .maybeSingle();
    if (vRow) {
      const nextPurchased = roundMoney(
        Math.max(0, (Number(vRow.total_purchased) || 0) - (Number(purchase.total_cost) || 0))
      );
      const nextPaid = roundMoney(
        Math.max(0, (Number(vRow.total_paid) || 0) - (Number(purchase.amount_paid) || 0))
      );
      await supabase
        .from('vendors')
        .update({
          total_purchased: nextPurchased,
          total_paid: nextPaid,
          balance_payable: roundMoney(Math.max(0, nextPurchased - nextPaid)),
        })
        .eq('id', purchase.vendor_id);
    }
  }
}

// ============================================================================
// 5. INVENTORY SALES (CLIENT / WALK-IN HARDWARE SALE + AUTO PROFIT)
// ============================================================================

export async function fetchInventorySales(): Promise<SupabaseInventorySale[]> {
  const { data, error } = await supabase
    .from('inventory_sales')
    .select('*')
    .order('sale_date', { ascending: false });
  if (error) return [];
  return (data || []).map((s: any) => ({
    ...s,
    qty: Number(s.qty) || 0,
    unit_cost_snapshot: Number(s.unit_cost_snapshot) || 0,
    unit_sale_price: Number(s.unit_sale_price) || 0,
    total_sale: Number(s.total_sale) || 0,
    net_profit: Number(s.net_profit) || 0,
  }));
}

export async function createInventorySale(input: {
  item: SupabaseInventoryItem;
  subscriber_username?: string;
  customer_name?: string;
  sold_by_agent?: string;
  qty: number;
  unit_sale_price: number;
  payment_status: 'PAID' | 'UNPAID_BILLED';
  sale_date?: string;
  notes?: string;
}): Promise<SupabaseInventorySale> {
  const qty = roundMoney(input.qty);
  const unitSalePrice = roundMoney(input.unit_sale_price);
  if (qty <= 0) throw new Error('Sale quantity must be greater than zero.');
  if (unitSalePrice < 0) throw new Error('Sale price cannot be negative.');

  const currentStock = Number(input.item.stock_qty) || 0;
  if (currentStock < qty) {
    throw new Error(
      `Insufficient stock for "${input.item.item_name}". Available: ${currentStock} ${input.item.unit}, Requested: ${qty} ${input.item.unit}.`
    );
  }

  const unitCostSnapshot = roundMoney(input.item.avg_purchase_cost);
  const totalSale = roundMoney(qty * unitSalePrice);
  const netProfit = roundMoney((unitSalePrice - unitCostSnapshot) * qty);
  const saleDate = input.sale_date || new Date().toISOString();

  const { data: insertedSale, error: insErr } = await supabase
    .from('inventory_sales')
    .insert([
      {
        item_id: input.item.id,
        item_name: input.item.item_name,
        subscriber_username: (input.subscriber_username || '').trim().toLowerCase(),
        customer_name: (input.customer_name || '').trim() || 'Walk-in Buyer',
        sold_by_agent: (input.sold_by_agent || '').trim(),
        qty,
        unit_cost_snapshot: unitCostSnapshot,
        unit_sale_price: unitSalePrice,
        total_sale: totalSale,
        net_profit: netProfit,
        payment_status: input.payment_status,
        sale_date: saleDate,
        notes: (input.notes || '').trim(),
      },
    ])
    .select('*')
    .single();
  if (insErr) throw insErr;

  const nextStock = roundMoney(Math.max(0, currentStock - qty));
  const { error: stockErr } = await supabase
    .from('inventory_items')
    .update({
      stock_qty: nextStock,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.item.id);
  if (stockErr) throw stockErr;

  return {
    ...insertedSale,
    qty: Number(insertedSale.qty) || 0,
    unit_cost_snapshot: Number(insertedSale.unit_cost_snapshot) || 0,
    unit_sale_price: Number(insertedSale.unit_sale_price) || 0,
    total_sale: Number(insertedSale.total_sale) || 0,
    net_profit: Number(insertedSale.net_profit) || 0,
  };
}

export async function updateInventorySale(
  existing: SupabaseInventorySale,
  updates: {
    subscriber_username?: string;
    customer_name?: string;
    sold_by_agent?: string;
    qty: number;
    unit_sale_price: number;
    payment_status: 'PAID' | 'UNPAID_BILLED';
    sale_date?: string;
    notes?: string;
  }
): Promise<SupabaseInventorySale> {
  const newQty = roundMoney(updates.qty);
  const newSalePrice = roundMoney(updates.unit_sale_price);
  if (newQty <= 0) throw new Error('Sale quantity must be greater than zero.');

  const qtyDelta = roundMoney(newQty - (Number(existing.qty) || 0)); // positive = need more stock
  if (qtyDelta !== 0) {
    const { data: itemRow } = await supabase
      .from('inventory_items')
      .select('id,item_name,unit,stock_qty')
      .eq('id', existing.item_id)
      .maybeSingle();

    if (itemRow) {
      const currentStock = Number(itemRow.stock_qty) || 0;
      if (qtyDelta > 0 && currentStock < qtyDelta) {
        throw new Error(
          `Insufficient stock to increase quantity by ${qtyDelta}. Available: ${currentStock} ${itemRow.unit}.`
        );
      }
      await supabase
        .from('inventory_items')
        .update({
          stock_qty: roundMoney(Math.max(0, currentStock - qtyDelta)),
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.item_id);
    }
  }

  const unitCost = roundMoney(existing.unit_cost_snapshot);
  const totalSale = roundMoney(newQty * newSalePrice);
  const netProfit = roundMoney((newSalePrice - unitCost) * newQty);

  const { data, error } = await supabase
    .from('inventory_sales')
    .update({
      subscriber_username: (updates.subscriber_username || '').trim().toLowerCase(),
      customer_name: (updates.customer_name || '').trim() || 'Walk-in Buyer',
      sold_by_agent: (updates.sold_by_agent || '').trim(),
      qty: newQty,
      unit_sale_price: newSalePrice,
      total_sale: totalSale,
      net_profit: netProfit,
      payment_status: updates.payment_status,
      sale_date: updates.sale_date || existing.sale_date,
      notes: (updates.notes || '').trim(),
    })
    .eq('id', existing.id)
    .select('*')
    .single();
  if (error) throw error;

  return {
    ...data,
    qty: Number(data.qty) || 0,
    unit_cost_snapshot: Number(data.unit_cost_snapshot) || 0,
    unit_sale_price: Number(data.unit_sale_price) || 0,
    total_sale: Number(data.total_sale) || 0,
    net_profit: Number(data.net_profit) || 0,
  };
}

export async function deleteInventorySale(sale: SupabaseInventorySale): Promise<void> {
  const { error } = await supabase.from('inventory_sales').delete().eq('id', sale.id);
  if (error) throw error;

  // Restore sold qty back to inventory stock
  const { data: itemRow } = await supabase
    .from('inventory_items')
    .select('id,stock_qty')
    .eq('id', sale.item_id)
    .maybeSingle();

  if (itemRow) {
    await supabase
      .from('inventory_items')
      .update({
        stock_qty: roundMoney((Number(itemRow.stock_qty) || 0) + (Number(sale.qty) || 0)),
        updated_at: new Date().toISOString(),
      })
      .eq('id', sale.item_id);
  }
}
