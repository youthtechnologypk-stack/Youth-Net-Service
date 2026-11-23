import {
  supabase,
  SupabasePortalUser,
  SupabaseResellerTariff,
  SupabaseResellerWalletLedger,
  ResellerWalletTxType,
} from '../services/supabaseClient';
import { UserAccount } from '../types/auth';
import { getDefaultPermissionsForRole } from './staffPermissions';

export type ResellerTier = 'DEALER' | 'SUB_DEALER';

export const RESELLER_WALLET_UPDATED_EVENT = 'youthnet_reseller_wallet_updated';

export const RESELLER_MIGRATION_SQL = `-- Multi-Tier Dealer & Sub-Dealer Reseller System Migration
ALTER TABLE public.portal_users
  ADD COLUMN IF NOT EXISTS tier_level TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS parent_dealer_id UUID REFERENCES public.portal_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS dealer_id UUID REFERENCES public.portal_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS wallet_balance NUMERIC(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit_limit NUMERIC(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bandwidth_pool_cap_mbps INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS assigned_pool_mbps INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_active_users INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS can_create_subdealers BOOLEAN NOT NULL DEFAULT false;

DO $$
DECLARE constraint_rec RECORD;
BEGIN
  FOR constraint_rec IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.portal_users'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE public.portal_users DROP CONSTRAINT IF EXISTS %I', constraint_rec.conname);
  END LOOP;
END $$;

ALTER TABLE public.portal_users
  ADD CONSTRAINT portal_users_role_check
  CHECK (UPPER(role) IN ('ADMIN', 'MANAGER', 'AGENT', 'CLIENT', 'DEALER', 'SUB_DEALER', 'TECHNICIAN', 'FIELD_AGENT', 'RECOVERY', 'NOC', 'NOC_OPERATOR'));

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS dealer_id UUID REFERENCES public.portal_users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.reseller_tariffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reseller_id UUID NOT NULL REFERENCES public.portal_users(id) ON DELETE CASCADE,
  profile_name TEXT NOT NULL,
  wholesale_price NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (wholesale_price >= 0),
  retail_price NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (retail_price >= 0),
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (reseller_id, profile_name)
);

CREATE TABLE IF NOT EXISTS public.reseller_wallet_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reseller_id UUID NOT NULL REFERENCES public.portal_users(id) ON DELETE CASCADE,
  reseller_name TEXT,
  reseller_username TEXT,
  tx_type TEXT NOT NULL CHECK (tx_type IN ('RECHARGE', 'SUBDEALER_TRANSFER', 'USER_ACTIVATION', 'RENEWAL_DEDUCTION', 'REFUND', 'ADJUSTMENT')),
  amount NUMERIC(12, 2) NOT NULL,
  balance_before NUMERIC(12, 2),
  balance_after NUMERIC(12, 2) NOT NULL,
  subscriber_username TEXT,
  profile_name TEXT,
  counterparty_reseller_id UUID REFERENCES public.portal_users(id) ON DELETE SET NULL,
  performed_by TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_portal_users_tier_level ON public.portal_users (tier_level);
CREATE INDEX IF NOT EXISTS idx_portal_users_parent_dealer_id ON public.portal_users (parent_dealer_id);
CREATE INDEX IF NOT EXISTS idx_portal_users_dealer_id ON public.portal_users (dealer_id);
CREATE INDEX IF NOT EXISTS idx_reseller_tariffs_reseller_id ON public.reseller_tariffs (reseller_id);
CREATE INDEX IF NOT EXISTS idx_reseller_wallet_ledger_reseller_id ON public.reseller_wallet_ledger (reseller_id, created_at DESC);
NOTIFY pgrst, 'reload schema';`;

export interface ResellerSubjectLike {
  id?: string | null;
  username?: string | null;
  role?: string | null;
  tier_level?: string | null;
  parent_dealer_id?: string | null;
  dealer_id?: string | null;
  wallet_balance?: number | null;
  credit_limit?: number | null;
  bandwidth_pool_cap_mbps?: number | null;
  assigned_pool_mbps?: number | null;
  max_active_users?: number | null;
  can_create_subdealers?: boolean | null;
}

export function getResellerPoolMbps(row?: ResellerSubjectLike | null): number {
  if (!row) return 0;
  const val = row.bandwidth_pool_cap_mbps ?? row.assigned_pool_mbps ?? 0;
  const num = Number(val);
  return Number.isFinite(num) ? Math.max(0, num) : 0;
}

export interface ResellerScope {
  isIsolated: boolean;
  tier: ResellerTier | null;
  resellerId: string | null;
  allowedResellerIds: Set<string> | null;
  allowedSubscriberUsernames: Set<string> | null;
}

export interface WalletEligibilityResult {
  allowed: boolean;
  insufficientFunds: boolean;
  capExceeded: boolean;
  availableCreditAndWallet: number;
  requiredAmount: number;
  projectedBalanceAfter: number;
  shortfall: number;
  error?: string;
}

export interface WalletDeductionResult {
  ok: boolean;
  skipped?: boolean;
  insufficientFunds?: boolean;
  capExceeded?: boolean;
  chargedAmount: number;
  balanceBefore: number;
  balanceAfter: number;
  resellerId?: string;
  resellerName?: string;
  profileName?: string;
  error?: string;
}

export function formatSupabaseError(err: any): string {
  if (!err) return 'Unknown database error';
  const code = err.code ? `[${err.code}] ` : '';
  const message = err.message || String(err);
  const extras = [err.details, err.hint].filter(Boolean).join(' — ');
  return `${code}${message}${extras ? ` (${extras})` : ''}`;
}

export function extractMissingColumnName(err: any): string | null {
  if (!err) return null;
  const msg = String(err.message || err.details || '');
  // PostgREST: Could not find the 'bandwidth_pool_cap_mbps' column of 'portal_users' in the schema cache
  const pgrstMatch = msg.match(/Could not find the ['"]([a-zA-Z0-9_]+)['"] column/i);
  if (pgrstMatch?.[1]) return pgrstMatch[1];
  // Postgres: column "bandwidth_pool_cap_mbps" of relation "portal_users" does not exist
  const pgMatch = msg.match(/column\s+["']?([a-zA-Z0-9_]+)["']?\s+of\s+relation/i);
  if (pgMatch?.[1]) return pgMatch[1];
  // Postgres: column portal_users.bandwidth_pool_cap_mbps does not exist
  const pgDotMatch = msg.match(/column\s+[a-zA-Z0-9_]+\.["']?([a-zA-Z0-9_]+)["']?\s+does not exist/i);
  if (pgDotMatch?.[1]) return pgDotMatch[1];
  return null;
}

export function isResellerTableMissingError(err: any): boolean {
  if (!err) return false;
  const code = String(err.code || '').toUpperCase();
  const msg = String(err.message || err.details || '').toLowerCase();
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    (msg.includes('could not find the table') && msg.includes('schema cache')) ||
    (msg.includes('relation') && msg.includes('does not exist'))
  );
}

export function isResellerSchemaMissingError(err: any): boolean {
  if (!err) return false;
  return isResellerTableMissingError(err);
}

const OPTIONAL_PORTAL_USER_COLUMNS = new Set([
  'bandwidth_pool_cap_mbps',
  'assigned_pool_mbps',
  'can_access_gis_map',
  'gis_map_permission',
  'permissions',
  'account_status',
  'can_create_subdealers',
  'max_active_users',
  'credit_limit',
  'wallet_balance',
  'parent_dealer_id',
  'dealer_id',
  'tier_level',
  'created_at',
  'phone',
  'area',
]);

async function adaptivePortalUsersInsert(
  initialPayload: Record<string, any>
): Promise<{ data: any; error: any; strippedColumns: string[] }> {
  const working: Record<string, any> = { ...initialPayload };
  const strippedColumns: string[] = [];
  let roleFallbackTried = false;
  let swappedPoolColumn = false;

  for (let attempt = 0; attempt < 14; attempt++) {
    const { data, error } = await supabase
      .from('portal_users')
      .insert([working])
      .select('*')
      .single();

    if (!error) {
      return { data, error: null, strippedColumns };
    }

    console.error(`[ResellerEngine] portal_users insert attempt ${attempt + 1} failed:`, error);

    const code = String(error.code || '').toUpperCase();
    const msgLower = String(error.message || '').toLowerCase();

    // Handle role CHECK constraint (e.g. legacy constraint allowing only ADMIN/MANAGER/AGENT/CLIENT)
    if (
      !roleFallbackTried &&
      (code === '23514' || msgLower.includes('check constraint')) &&
      working.role !== 'MANAGER'
    ) {
      roleFallbackTried = true;
      working.role = 'MANAGER';
      continue;
    }

    // Handle missing column in PostgREST schema cache (PGRST204) or PostgreSQL (42703)
    const missingCol = extractMissingColumnName(error);
    if (missingCol && (code === 'PGRST204' || code === '42703' || msgLower.includes('schema cache') || msgLower.includes('does not exist'))) {
      if (missingCol === 'bandwidth_pool_cap_mbps' && !swappedPoolColumn && 'bandwidth_pool_cap_mbps' in working) {
        swappedPoolColumn = true;
        const val = working.bandwidth_pool_cap_mbps;
        delete working.bandwidth_pool_cap_mbps;
        working.assigned_pool_mbps = val;
        console.warn('[ResellerEngine] Swapped bandwidth_pool_cap_mbps -> assigned_pool_mbps on portal_users.');
        continue;
      }

      if (missingCol in working && OPTIONAL_PORTAL_USER_COLUMNS.has(missingCol)) {
        delete working[missingCol];
        strippedColumns.push(missingCol);
        console.warn(`[ResellerEngine] Stripped unavailable optional column "${missingCol}" and retrying portal_users insert.`);
        continue;
      }
    }

    return { data: null, error, strippedColumns };
  }

  return {
    data: null,
    error: { message: 'Exceeded retry attempts while adapting portal_users columns.' },
    strippedColumns,
  };
}

async function adaptivePortalUsersUpdate(
  resellerId: string,
  initialPatch: Record<string, any>
): Promise<{ error: any; strippedColumns: string[] }> {
  const working: Record<string, any> = { ...initialPatch };
  const strippedColumns: string[] = [];
  let swappedPoolColumn = false;

  for (let attempt = 0; attempt < 12; attempt++) {
    if (Object.keys(working).length === 0) {
      return { error: null, strippedColumns };
    }

    const { error } = await supabase.from('portal_users').update(working).eq('id', resellerId);
    if (!error) {
      return { error: null, strippedColumns };
    }

    console.error(`[ResellerEngine] portal_users update attempt ${attempt + 1} failed:`, error);

    const code = String(error.code || '').toUpperCase();
    const msgLower = String(error.message || '').toLowerCase();
    const missingCol = extractMissingColumnName(error);

    if (missingCol && (code === 'PGRST204' || code === '42703' || msgLower.includes('schema cache') || msgLower.includes('does not exist'))) {
      if (missingCol === 'bandwidth_pool_cap_mbps' && !swappedPoolColumn && 'bandwidth_pool_cap_mbps' in working) {
        swappedPoolColumn = true;
        const val = working.bandwidth_pool_cap_mbps;
        delete working.bandwidth_pool_cap_mbps;
        working.assigned_pool_mbps = val;
        continue;
      }

      if (missingCol in working && OPTIONAL_PORTAL_USER_COLUMNS.has(missingCol)) {
        delete working[missingCol];
        strippedColumns.push(missingCol);
        continue;
      }
    }

    return { error, strippedColumns };
  }

  return {
    error: { message: 'Exceeded retry attempts while updating portal_users.' },
    strippedColumns,
  };
}

async function adaptiveLedgerInsert(rows: Array<Record<string, any>>): Promise<{ error: any }> {
  let workingRows = rows.map((r) => ({ ...r }));
  for (let attempt = 0; attempt < 8; attempt++) {
    const { error } = await supabase.from('reseller_wallet_ledger').insert(workingRows);
    if (!error) return { error: null };

    console.error(`[ResellerEngine] reseller_wallet_ledger insert attempt ${attempt + 1} failed:`, error);
    const missingCol = extractMissingColumnName(error);
    if (missingCol && workingRows.some((r) => missingCol in r)) {
      workingRows = workingRows.map((r) => {
        const copy = { ...r };
        delete copy[missingCol];
        return copy;
      });
      continue;
    }
    return { error };
  }
  return { error: { message: 'Failed to insert wallet ledger row after retries.' } };
}

/**
 * Resolves whether a user/row is a DEALER, SUB_DEALER, or non-reseller (null).
 * Supports both native `role = 'DEALER' | 'SUB_DEALER'` and `tier_level = 'DEALER' | 'SUB_DEALER'`.
 */
export function getResellerTier(user?: ResellerSubjectLike | null): ResellerTier | null {
  if (!user) return null;
  const tier = String(user.tier_level || '').trim().toUpperCase();
  if (tier === 'DEALER') return 'DEALER';
  if (tier === 'SUB_DEALER') return 'SUB_DEALER';

  const role = String(user.role || '').trim().toUpperCase();
  if (role === 'DEALER') return 'DEALER';
  if (role === 'SUB_DEALER') return 'SUB_DEALER';

  return null;
}

export function isResellerUser(user?: ResellerSubjectLike | null): boolean {
  return getResellerTier(user) !== null;
}

export function canAccessDealersTab(
  user?: ResellerSubjectLike | null,
  effectiveRole?: string | null
): boolean {
  const role = String(effectiveRole || user?.role || '').trim().toUpperCase();
  if (role === 'ADMIN') return true;
  const tier = getResellerTier(user);
  return tier === 'DEALER' || role === 'DEALER';
}

/**
 * Computes strict multi-tenant data isolation scope:
 * - ADMIN / internal staff: unrestricted (`isIsolated: false`)
 * - DEALER: owns their own subscribers + all their child SUB_DEALERs' subscribers
 * - SUB_DEALER: owns ONLY their own subscribers
 */
export function resolveResellerScope(
  currentUser: ResellerSubjectLike | null | undefined,
  allPortalUsers: Array<Partial<SupabasePortalUser>>
): ResellerScope {
  const tier = getResellerTier(currentUser);
  if (!tier || !currentUser?.id) {
    return {
      isIsolated: false,
      tier: null,
      resellerId: null,
      allowedResellerIds: null,
      allowedSubscriberUsernames: null,
    };
  }

  const allowedResellerIds = new Set<string>([currentUser.id]);

  if (tier === 'DEALER') {
    for (const u of allPortalUsers) {
      if (
        u.id &&
        u.parent_dealer_id === currentUser.id &&
        getResellerTier(u) === 'SUB_DEALER'
      ) {
        allowedResellerIds.add(u.id);
      }
    }
  }

  const allowedSubscriberUsernames = new Set<string>();
  for (const u of allPortalUsers) {
    const roleUpper = String(u.role || '').toUpperCase();
    if (roleUpper !== 'CLIENT') continue;
    const ownerDealerId = u.dealer_id || u.parent_dealer_id || null;
    if (ownerDealerId && allowedResellerIds.has(ownerDealerId)) {
      const uname = String(u.username || '').trim().toLowerCase();
      if (uname) allowedSubscriberUsernames.add(uname);
    }
  }

  return {
    isIsolated: true,
    tier,
    resellerId: currentUser.id,
    allowedResellerIds,
    allowedSubscriberUsernames,
  };
}

/**
 * Resolves the set of reseller IDs matching an Admin's selected dealer filter value:
 * - 'ALL': null (no filtering)
 * - 'DIRECT_ISP': direct ISP subscribers with no dealer_id
 * - '<dealer_uuid>': that dealer + if it's a DEALER, optionally its nested Sub-Dealers (controlled via includeChildren)
 */
export function resolveAdminDealerFilterIds(
  selectedFilter: string,
  allResellers: Array<Partial<SupabasePortalUser>>,
  includeSubDealers = true
): { mode: 'ALL' | 'DIRECT_ISP' | 'RESELLER'; resellerIds: Set<string> } {
  if (!selectedFilter || selectedFilter === 'ALL') {
    return { mode: 'ALL', resellerIds: new Set() };
  }
  if (selectedFilter === 'DIRECT_ISP') {
    return { mode: 'DIRECT_ISP', resellerIds: new Set() };
  }
  const ids = new Set<string>([selectedFilter]);
  if (includeSubDealers) {
    const target = allResellers.find((r) => r.id === selectedFilter);
    if (target && getResellerTier(target) === 'DEALER') {
      for (const r of allResellers) {
        if (r.id && r.parent_dealer_id === selectedFilter) {
          ids.add(r.id);
        }
      }
    }
  }
  return { mode: 'RESELLER', resellerIds: ids };
}

export function doesSubscriberMatchScope(
  subscriber: { username?: string | null; dealer_id?: string | null; parent_dealer_id?: string | null },
  scope: ResellerScope
): boolean {
  if (!scope.isIsolated) return true;
  const ownerId = subscriber.dealer_id || subscriber.parent_dealer_id || null;
  if (ownerId && scope.allowedResellerIds?.has(ownerId)) return true;
  const uname = String(subscriber.username || '').trim().toLowerCase();
  if (uname && scope.allowedSubscriberUsernames?.has(uname)) return true;
  return false;
}

export function doesInvoiceMatchScope(
  invoice: { subscriber_username?: string | null; dealer_id?: string | null },
  scope: ResellerScope
): boolean {
  if (!scope.isIsolated) return true;
  if (invoice.dealer_id && scope.allowedResellerIds?.has(invoice.dealer_id)) return true;
  const uname = String(invoice.subscriber_username || '').trim().toLowerCase();
  if (uname && scope.allowedSubscriberUsernames?.has(uname)) return true;
  return false;
}

/**
 * Pure financial & cap eligibility check before provisioning/renewing a subscriber for a reseller.
 */
export function evaluateWalletEligibility(params: {
  walletBalance: number;
  creditLimit: number;
  wholesalePrice: number;
  currentActiveUsers?: number;
  maxActiveUsers?: number;
  enforceUserCap?: boolean;
}): WalletEligibilityResult {
  const walletBalance = Number(params.walletBalance) || 0;
  const creditLimit = Math.max(0, Number(params.creditLimit) || 0);
  const wholesalePrice = Math.max(0, Number(params.wholesalePrice) || 0);
  const currentActiveUsers = Math.max(0, Number(params.currentActiveUsers) || 0);
  const maxActiveUsers = Math.max(0, Number(params.maxActiveUsers) || 0);

  const availableCreditAndWallet = walletBalance + creditLimit;
  const projectedBalanceAfter = walletBalance - wholesalePrice;
  const shortfall = Math.max(0, wholesalePrice - availableCreditAndWallet);

  if (params.enforceUserCap && maxActiveUsers > 0 && currentActiveUsers >= maxActiveUsers) {
    return {
      allowed: false,
      insufficientFunds: false,
      capExceeded: true,
      availableCreditAndWallet,
      requiredAmount: wholesalePrice,
      projectedBalanceAfter,
      shortfall: 0,
      error: `Reseller Active User Cap Reached (${currentActiveUsers}/${maxActiveUsers} active users). Ask Master ISP Admin to raise the Max Active Users cap.`,
    };
  }

  if (availableCreditAndWallet + 0.0001 < wholesalePrice) {
    return {
      allowed: false,
      insufficientFunds: true,
      capExceeded: false,
      availableCreditAndWallet,
      requiredAmount: wholesalePrice,
      projectedBalanceAfter,
      shortfall,
      error: `Insufficient Dealer Wallet Balance: Required Rs. ${wholesalePrice.toLocaleString()}, Available Rs. ${availableCreditAndWallet.toLocaleString()} (Wallet Rs. ${walletBalance.toLocaleString()} + Credit Limit Rs. ${creditLimit.toLocaleString()}). Recharge wallet to proceed.`,
    };
  }

  return {
    allowed: true,
    insufficientFunds: false,
    capExceeded: false,
    availableCreditAndWallet,
    requiredAmount: wholesalePrice,
    projectedBalanceAfter,
    shortfall: 0,
  };
}

/**
 * Pure validation guard for Dealer -> Sub-Dealer wallet transfers.
 */
export function validateSubDealerTransfer(params: {
  dealerId: string;
  dealerWalletBalance: number;
  subDealer: { id: string; parent_dealer_id?: string | null; tier_level?: string | null; role?: string | null } | null;
  amount: number;
  isAdminOverride?: boolean;
}): { valid: boolean; error?: string } {
  const amt = Number(params.amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return { valid: false, error: 'Transfer amount must be a positive number.' };
  }
  if (!params.subDealer || !params.subDealer.id) {
    return { valid: false, error: 'Target Sub-Dealer account not found.' };
  }
  if (params.subDealer.id === params.dealerId) {
    return { valid: false, error: 'Cannot transfer wallet balance to the same account.' };
  }
  if (!params.isAdminOverride && params.subDealer.parent_dealer_id !== params.dealerId) {
    return {
      valid: false,
      error: 'Access Denied: Dealers can only transfer balance to their own linked Sub-Dealers.',
    };
  }
  if ((Number(params.dealerWalletBalance) || 0) < amt) {
    return {
      valid: false,
      error: `Insufficient Dealer Wallet Balance: Wallet has Rs. ${(Number(params.dealerWalletBalance) || 0).toLocaleString()}, cannot transfer Rs. ${amt.toLocaleString()}.`,
    };
  }
  return { valid: true };
}

export function computeTariffMargin(wholesalePrice: number, retailPrice: number): {
  marginRs: number;
  marginPct: number;
} {
  const w = Math.max(0, Number(wholesalePrice) || 0);
  const r = Math.max(0, Number(retailPrice) || 0);
  const marginRs = r - w;
  const marginPct = r > 0 ? Math.round((marginRs / r) * 1000) / 10 : 0;
  return { marginRs, marginPct };
}

export function resolveTariffForProfile(
  resellerId: string,
  profileName: string,
  tariffs: SupabaseResellerTariff[],
  fallbackPrice = 0
): { wholesalePrice: number; retailPrice: number; matchedTariff: SupabaseResellerTariff | null } {
  const cleanProf = String(profileName || '').trim().toLowerCase();
  const matched =
    tariffs.find(
      (t) =>
        t.reseller_id === resellerId &&
        String(t.profile_name || '').trim().toLowerCase() === cleanProf
    ) || null;

  if (matched) {
    return {
      wholesalePrice: Number(matched.wholesale_price) || 0,
      retailPrice: Number(matched.retail_price) || 0,
      matchedTariff: matched,
    };
  }

  return {
    wholesalePrice: Math.max(0, Number(fallbackPrice) || 0),
    retailPrice: Math.max(0, Number(fallbackPrice) || 0),
    matchedTariff: null,
  };
}

export function broadcastResellerWalletUpdated(detail: {
  resellerId: string;
  walletBalance: number;
}): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(RESELLER_WALLET_UPDATED_EVENT, { detail }));
  } catch {
    // ignore
  }
}

export async function fetchResellerDataBundle(): Promise<{
  allUsers: SupabasePortalUser[];
  resellers: SupabasePortalUser[];
  dealers: SupabasePortalUser[];
  subDealers: SupabasePortalUser[];
  subscribers: SupabasePortalUser[];
  tariffs: SupabaseResellerTariff[];
  ledger: SupabaseResellerWalletLedger[];
  missingSchema: boolean;
  loadErrors: string[];
}> {
  const [usersRes, tariffsRes, ledgerRes] = await Promise.all([
    supabase.from('portal_users').select('*').order('created_at', { ascending: false }),
    supabase.from('reseller_tariffs').select('*'),
    supabase
      .from('reseller_wallet_ledger')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(400),
  ]);

  const loadErrors: string[] = [];
  if (usersRes.error) {
    console.error('[ResellerEngine] Failed loading portal_users:', usersRes.error);
    loadErrors.push(`portal_users: ${formatSupabaseError(usersRes.error)}`);
  }
  if (tariffsRes.error) {
    console.error('[ResellerEngine] Failed loading reseller_tariffs:', tariffsRes.error);
    loadErrors.push(`reseller_tariffs: ${formatSupabaseError(tariffsRes.error)}`);
  }
  if (ledgerRes.error) {
    console.error('[ResellerEngine] Failed loading reseller_wallet_ledger:', ledgerRes.error);
    loadErrors.push(`reseller_wallet_ledger: ${formatSupabaseError(ledgerRes.error)}`);
  }

  const missingSchema =
    isResellerTableMissingError(tariffsRes.error) ||
    isResellerTableMissingError(ledgerRes.error);

  const allUsers = (usersRes.data || []) as SupabasePortalUser[];
  const dealers = allUsers.filter((u) => getResellerTier(u) === 'DEALER');
  const subDealers = allUsers.filter((u) => getResellerTier(u) === 'SUB_DEALER');
  const resellers = [...dealers, ...subDealers];
  const subscribers = allUsers.filter((u) => String(u.role || '').toUpperCase() === 'CLIENT');

  const rawTariffs = tariffsRes.error ? [] : ((tariffsRes.data || []) as any[]);
  const normalizedTariffs: SupabaseResellerTariff[] = rawTariffs
    .map((t) => ({
      ...t,
      profile_name: String(t.profile_name || t.package_name || t.mikrotik_profile || '').trim(),
      wholesale_price: Number(t.wholesale_price ?? 0),
      retail_price: Number(t.retail_price ?? 0),
    }))
    .sort((a, b) => a.profile_name.localeCompare(b.profile_name));

  return {
    allUsers,
    resellers,
    dealers,
    subDealers,
    subscribers,
    tariffs: normalizedTariffs,
    ledger: ledgerRes.error ? [] : ((ledgerRes.data || []) as SupabaseResellerWalletLedger[]),
    missingSchema,
    loadErrors,
  };
}

export async function createResellerAccount(input: {
  tierLevel: ResellerTier;
  fullName: string;
  username: string;
  password: string;
  phone: string;
  area: string;
  parentDealerId?: string | null;
  creditLimit: number;
  bandwidthPoolCapMbps: number;
  maxActiveUsers: number;
  canCreateSubdealers: boolean;
  initialWalletBalance?: number;
  performedBy?: string;
}): Promise<{ ok: boolean; user?: SupabasePortalUser; schemaMissing?: boolean; error?: string }> {
  const cleanUsername = input.username.trim().toLowerCase().replace(/\s+/g, '');
  const cleanName = input.fullName.trim();
  const cleanPassword = input.password.trim();

  if (!cleanName || !cleanUsername || !cleanPassword) {
    return { ok: false, error: 'Name, login username, and password are required.' };
  }
  if (input.tierLevel === 'SUB_DEALER' && !input.parentDealerId) {
    return { ok: false, error: 'Please select a Parent Dealer for this Sub-Dealer.' };
  }

  const creditLimit = Math.max(0, Number(input.creditLimit) || 0);
  const bandwidthCap = Math.max(0, Math.round(Number(input.bandwidthPoolCapMbps) || 0));
  const maxActiveUsers = Math.max(0, Math.round(Number(input.maxActiveUsers) || 0));
  const initialWallet = Math.max(0, Number(input.initialWalletBalance) || 0);
  const perms = getDefaultPermissionsForRole(input.tierLevel);

  const payload: Record<string, any> = {
    username: cleanUsername,
    password: cleanPassword,
    full_name: cleanName,
    phone: input.phone.trim() || '+92 300 0000000',
    area: input.area.trim() || 'Main Zone',
    role: input.tierLevel,
    tier_level: input.tierLevel,
    parent_dealer_id: input.tierLevel === 'SUB_DEALER' ? input.parentDealerId : null,
    account_status: 'ACTIVE',
    wallet_balance: initialWallet,
    credit_limit: creditLimit,
    bandwidth_pool_cap_mbps: bandwidthCap,
    max_active_users: maxActiveUsers,
    can_create_subdealers: input.tierLevel === 'DEALER' ? Boolean(input.canCreateSubdealers) : false,
    can_access_gis_map: perms.gis_map !== 'none',
    gis_map_permission: perms.gis_map,
    permissions: perms,
    created_at: new Date().toISOString(),
  };

  const { data, error } = await adaptivePortalUsersInsert(payload);

  if (error) {
    const code = String(error.code || '').toUpperCase();
    if (code === '23505') {
      return {
        ok: false,
        error: `Username "@${cleanUsername}" already exists in portal_users. Choose a different username.`,
      };
    }
    return {
      ok: false,
      schemaMissing: isResellerTableMissingError(error),
      error: `Failed to create reseller in portal_users: ${formatSupabaseError(error)}`,
    };
  }

  if (data && initialWallet > 0) {
    await adaptiveLedgerInsert([
      {
        reseller_id: data.id,
        reseller_name: data.full_name,
        reseller_username: data.username,
        tx_type: 'RECHARGE',
        amount: initialWallet,
        balance_before: 0,
        balance_after: initialWallet,
        performed_by: input.performedBy || 'Admin',
        notes: 'Opening wallet balance on reseller account creation',
      },
    ]);
  }

  return { ok: true, user: data as SupabasePortalUser };
}

export async function updateResellerAccount(
  resellerId: string,
  updates: {
    fullName?: string;
    phone?: string;
    area?: string;
    creditLimit?: number;
    bandwidthPoolCapMbps?: number;
    maxActiveUsers?: number;
    canCreateSubdealers?: boolean;
    accountStatus?: 'ACTIVE' | 'SUSPENDED';
    password?: string;
  }
): Promise<{ ok: boolean; error?: string }> {
  const patch: Record<string, any> = {};
  if (updates.fullName !== undefined) patch.full_name = updates.fullName.trim();
  if (updates.phone !== undefined) patch.phone = updates.phone.trim();
  if (updates.area !== undefined) patch.area = updates.area.trim();
  if (updates.creditLimit !== undefined) patch.credit_limit = Math.max(0, Number(updates.creditLimit) || 0);
  if (updates.bandwidthPoolCapMbps !== undefined) {
    patch.bandwidth_pool_cap_mbps = Math.max(0, Math.round(Number(updates.bandwidthPoolCapMbps) || 0));
  }
  if (updates.maxActiveUsers !== undefined) {
    patch.max_active_users = Math.max(0, Math.round(Number(updates.maxActiveUsers) || 0));
  }
  if (updates.canCreateSubdealers !== undefined) {
    patch.can_create_subdealers = Boolean(updates.canCreateSubdealers);
  }
  if (updates.accountStatus !== undefined) patch.account_status = updates.accountStatus;
  if (updates.password && updates.password.trim()) patch.password = updates.password.trim();

  const { error } = await adaptivePortalUsersUpdate(resellerId, patch);
  if (error) {
    return { ok: false, error: formatSupabaseError(error) };
  }
  return { ok: true };
}

export async function upsertResellerTariff(params: {
  resellerId: string;
  profileName: string;
  wholesalePrice: number;
  retailPrice: number;
  updatedBy?: string;
}): Promise<{ ok: boolean; tariff?: SupabaseResellerTariff; schemaMissing?: boolean; error?: string }> {
  const wholesale = Number(params.wholesalePrice);
  const retail = Number(params.retailPrice);
  if (!params.resellerId || !params.profileName.trim()) {
    return { ok: false, error: 'Reseller ID and MikroTik profile name are required.' };
  }
  if (!Number.isFinite(wholesale) || wholesale < 0 || !Number.isFinite(retail) || retail < 0) {
    return { ok: false, error: 'Wholesale and retail prices must be zero or positive numbers.' };
  }

  const rowPayload: Record<string, any> = {
    reseller_id: params.resellerId,
    profile_name: params.profileName.trim(),
    wholesale_price: wholesale,
    retail_price: retail,
    updated_by: params.updatedBy || 'Admin',
    updated_at: new Date().toISOString(),
  };

  let { data, error } = await supabase
    .from('reseller_tariffs')
    .upsert([rowPayload], { onConflict: 'reseller_id,profile_name' })
    .select('*')
    .single();

  if (error) {
    const missingCol = extractMissingColumnName(error);
    if (missingCol && (missingCol === 'updated_by' || missingCol === 'updated_at')) {
      delete rowPayload[missingCol];
      const retry = await supabase
        .from('reseller_tariffs')
        .upsert([rowPayload], { onConflict: 'reseller_id,profile_name' })
        .select('*')
        .single();
      data = retry.data;
      error = retry.error;
    }
  }

  if (error) {
    console.error('[ResellerEngine] upsertResellerTariff failed:', error);
    return {
      ok: false,
      schemaMissing: isResellerTableMissingError(error),
      error: `Failed to save reseller tariff: ${formatSupabaseError(error)}`,
    };
  }
  return { ok: true, tariff: data as SupabaseResellerTariff };
}

export async function rechargeResellerWallet(params: {
  resellerId: string;
  amount: number;
  performedBy: string;
  notes?: string;
}): Promise<{ ok: boolean; balanceAfter?: number; schemaMissing?: boolean; error?: string }> {
  const amount = Number(params.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: 'Recharge amount must be greater than Rs. 0.' };
  }

  const { data: reseller, error: fetchErr } = await supabase
    .from('portal_users')
    .select('*')
    .eq('id', params.resellerId)
    .single();

  if (fetchErr || !reseller) {
    console.error('[ResellerEngine] rechargeResellerWallet fetch failed:', fetchErr);
    return {
      ok: false,
      schemaMissing: isResellerTableMissingError(fetchErr),
      error: fetchErr ? formatSupabaseError(fetchErr) : 'Reseller account not found.',
    };
  }

  const before = Number(reseller.wallet_balance || 0);
  const after = Math.round((before + amount) * 100) / 100;

  const { error: updErr } = await supabase
    .from('portal_users')
    .update({ wallet_balance: after })
    .eq('id', reseller.id);

  if (updErr) {
    console.error('[ResellerEngine] rechargeResellerWallet update failed:', updErr);
    return {
      ok: false,
      schemaMissing: isResellerTableMissingError(updErr),
      error: formatSupabaseError(updErr),
    };
  }

  const { error: ledgerErr } = await adaptiveLedgerInsert([
    {
      reseller_id: reseller.id,
      reseller_name: reseller.full_name,
      reseller_username: reseller.username,
      tx_type: 'RECHARGE' as ResellerWalletTxType,
      amount,
      balance_before: before,
      balance_after: after,
      performed_by: params.performedBy,
      notes: params.notes?.trim() || 'Master ISP prepaid wallet recharge',
    },
  ]);

  broadcastResellerWalletUpdated({ resellerId: reseller.id, walletBalance: after });

  if (ledgerErr && isResellerTableMissingError(ledgerErr)) {
    return { ok: true, balanceAfter: after, schemaMissing: true };
  }

  return { ok: true, balanceAfter: after };
}

/**
 * Atomic Dealer -> Sub-Dealer Balance Transfer (`SUBDEALER_TRANSFER`):
 * Re-reads live wallet balances, enforces parent_dealer_id ownership,
 * debits Dealer and credits Sub-Dealer, and logs both sides in `reseller_wallet_ledger`.
 */
export async function transferDealerToSubDealer(params: {
  fromDealerId: string;
  toSubDealerId: string;
  amount: number;
  performedBy: string;
  isAdminOverride?: boolean;
  notes?: string;
}): Promise<{
  ok: boolean;
  dealerBalanceAfter?: number;
  subDealerBalanceAfter?: number;
  error?: string;
}> {
  const amount = Number(params.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: 'Transfer amount must be greater than Rs. 0.' };
  }

  const [{ data: dealer, error: dErr }, { data: subDealer, error: sErr }] = await Promise.all([
    supabase.from('portal_users').select('*').eq('id', params.fromDealerId).single(),
    supabase.from('portal_users').select('*').eq('id', params.toSubDealerId).single(),
  ]);

  if (dErr || !dealer) {
    console.error('[ResellerEngine] transfer source dealer fetch failed:', dErr);
    return { ok: false, error: dErr ? formatSupabaseError(dErr) : 'Source Dealer account not found.' };
  }
  if (sErr || !subDealer) {
    console.error('[ResellerEngine] transfer target sub-dealer fetch failed:', sErr);
    return { ok: false, error: sErr ? formatSupabaseError(sErr) : 'Destination Sub-Dealer account not found.' };
  }

  const validation = validateSubDealerTransfer({
    dealerId: dealer.id,
    dealerWalletBalance: Number(dealer.wallet_balance || 0),
    subDealer: subDealer as any,
    amount,
    isAdminOverride: params.isAdminOverride,
  });

  if (!validation.valid) {
    return { ok: false, error: validation.error };
  }

  const dealerBefore = Number(dealer.wallet_balance || 0);
  const dealerAfter = Math.round((dealerBefore - amount) * 100) / 100;
  const subBefore = Number(subDealer.wallet_balance || 0);
  const subAfter = Math.round((subBefore + amount) * 100) / 100;

  // 1. Debit Dealer first
  const { error: debitErr } = await supabase
    .from('portal_users')
    .update({ wallet_balance: dealerAfter })
    .eq('id', dealer.id);

  if (debitErr) {
    return { ok: false, error: debitErr.message || 'Failed to debit Dealer wallet.' };
  }

  // 2. Credit Sub-Dealer (rollback Dealer debit if credit fails)
  const { error: creditErr } = await supabase
    .from('portal_users')
    .update({ wallet_balance: subAfter })
    .eq('id', subDealer.id);

  if (creditErr) {
    await supabase
      .from('portal_users')
      .update({ wallet_balance: dealerBefore })
      .eq('id', dealer.id);
    return { ok: false, error: creditErr.message || 'Failed to credit Sub-Dealer wallet; debit rolled back.' };
  }

  // 3. Log both ledger entries
  const cleanNotes = params.notes?.trim();
  await adaptiveLedgerInsert([
    {
      reseller_id: dealer.id,
      reseller_name: dealer.full_name,
      reseller_username: dealer.username,
      tx_type: 'SUBDEALER_TRANSFER' as ResellerWalletTxType,
      amount: -amount,
      balance_before: dealerBefore,
      balance_after: dealerAfter,
      counterparty_reseller_id: subDealer.id,
      performed_by: params.performedBy,
      notes: cleanNotes
        ? `Transfer to Sub-Dealer @${subDealer.username}: ${cleanNotes}`
        : `Balance transfer to Sub-Dealer ${subDealer.full_name} (@${subDealer.username})`,
    },
    {
      reseller_id: subDealer.id,
      reseller_name: subDealer.full_name,
      reseller_username: subDealer.username,
      tx_type: 'SUBDEALER_TRANSFER' as ResellerWalletTxType,
      amount,
      balance_before: subBefore,
      balance_after: subAfter,
      counterparty_reseller_id: dealer.id,
      performed_by: params.performedBy,
      notes: cleanNotes
        ? `Received from Parent Dealer @${dealer.username}: ${cleanNotes}`
        : `Balance received from Parent Dealer ${dealer.full_name} (@${dealer.username})`,
    },
  ]);

  broadcastResellerWalletUpdated({ resellerId: dealer.id, walletBalance: dealerAfter });
  broadcastResellerWalletUpdated({ resellerId: subDealer.id, walletBalance: subAfter });

  return {
    ok: true,
    dealerBalanceAfter: dealerAfter,
    subDealerBalanceAfter: subAfter,
  };
}

/**
 * Automatic Wallet Deduction Guard on PPPoE Provisioning & Renewal:
 * 1. Fetches live reseller wallet_balance, credit_limit, max_active_users, and reseller_tariffs row for the MikroTik profile.
 * 2. Verifies `wallet_balance + credit_limit >= wholesale_price` and `max_active_users` cap (on new activations).
 * 3. Blocks activation immediately with `Insufficient Dealer Wallet Balance` when funds are low.
 * 4. Deducts `wholesale_price` from `portal_users.wallet_balance` and logs `USER_ACTIVATION` or `RENEWAL_DEDUCTION`
 *    into `reseller_wallet_ledger`.
 */
export async function checkAndDeductResellerWallet(params: {
  resellerId?: string | null;
  profileName: string;
  subscriberUsername: string;
  txType: 'USER_ACTIVATION' | 'RENEWAL_DEDUCTION';
  performedBy?: string;
  fallbackWholesalePrice?: number;
  notes?: string;
}): Promise<WalletDeductionResult> {
  if (!params.resellerId) {
    return { ok: true, skipped: true, chargedAmount: 0, balanceBefore: 0, balanceAfter: 0 };
  }

  const { data: reseller, error: resErr } = await supabase
    .from('portal_users')
    .select('*')
    .eq('id', params.resellerId)
    .maybeSingle();

  if (resErr) {
    console.error('[ResellerEngine] checkAndDeductResellerWallet fetch failed:', resErr);
    if (isResellerTableMissingError(resErr)) {
      return { ok: true, skipped: true, chargedAmount: 0, balanceBefore: 0, balanceAfter: 0 };
    }
    return {
      ok: false,
      chargedAmount: 0,
      balanceBefore: 0,
      balanceAfter: 0,
      error: formatSupabaseError(resErr),
    };
  }

  if (!reseller || !getResellerTier(reseller)) {
    return { ok: true, skipped: true, chargedAmount: 0, balanceBefore: 0, balanceAfter: 0 };
  }

  if (String(reseller.account_status || 'ACTIVE').toUpperCase() === 'SUSPENDED') {
    return {
      ok: false,
      chargedAmount: 0,
      balanceBefore: Number(reseller.wallet_balance || 0),
      balanceAfter: Number(reseller.wallet_balance || 0),
      resellerId: reseller.id,
      resellerName: reseller.full_name,
      error: `Reseller account @${reseller.username} is currently SUSPENDED. Contact Master ISP Admin.`,
    };
  }

  // Fetch tariff for selected MikroTik profile + count current active users if enforcing cap
  const [tariffRes, activeCountRes] = await Promise.all([
    supabase
      .from('reseller_tariffs')
      .select('*')
      .eq('reseller_id', reseller.id),
    params.txType === 'USER_ACTIVATION' && Number(reseller.max_active_users || 0) > 0
      ? supabase
          .from('portal_users')
          .select('id', { count: 'exact', head: true })
          .eq('role', 'CLIENT')
          .eq('dealer_id', reseller.id)
          .neq('account_status', 'SUSPENDED')
      : Promise.resolve({ count: 0, error: null } as any),
  ]);

  const tariffs = tariffRes.error ? [] : ((tariffRes.data || []) as SupabaseResellerTariff[]);
  const { wholesalePrice } = resolveTariffForProfile(
    reseller.id,
    params.profileName,
    tariffs,
    params.fallbackWholesalePrice ?? 0
  );

  const balanceBefore = Number(reseller.wallet_balance || 0);
  const eligibility = evaluateWalletEligibility({
    walletBalance: balanceBefore,
    creditLimit: Number(reseller.credit_limit || 0),
    wholesalePrice,
    currentActiveUsers: Number(activeCountRes?.count || 0),
    maxActiveUsers: Number(reseller.max_active_users || 0),
    enforceUserCap: params.txType === 'USER_ACTIVATION',
  });

  if (!eligibility.allowed) {
    return {
      ok: false,
      insufficientFunds: eligibility.insufficientFunds,
      capExceeded: eligibility.capExceeded,
      chargedAmount: wholesalePrice,
      balanceBefore,
      balanceAfter: balanceBefore,
      resellerId: reseller.id,
      resellerName: reseller.full_name,
      profileName: params.profileName,
      error: eligibility.error,
    };
  }

  const balanceAfter = Math.round((balanceBefore - wholesalePrice) * 100) / 100;

  if (wholesalePrice > 0) {
    const { error: updErr } = await supabase
      .from('portal_users')
      .update({ wallet_balance: balanceAfter })
      .eq('id', reseller.id);

    if (updErr) {
      return {
        ok: false,
        chargedAmount: wholesalePrice,
        balanceBefore,
        balanceAfter: balanceBefore,
        resellerId: reseller.id,
        resellerName: reseller.full_name,
        error: updErr.message || 'Failed to deduct reseller wallet balance.',
      };
    }

    await adaptiveLedgerInsert([
      {
        reseller_id: reseller.id,
        reseller_name: reseller.full_name,
        reseller_username: reseller.username,
        tx_type: params.txType,
        amount: -wholesalePrice,
        balance_before: balanceBefore,
        balance_after: balanceAfter,
        subscriber_username: params.subscriberUsername.trim().toLowerCase(),
        profile_name: params.profileName.trim(),
        performed_by: params.performedBy || reseller.username,
        notes:
          params.notes ||
          (params.txType === 'USER_ACTIVATION'
            ? `PPPoE activation for @${params.subscriberUsername} (${params.profileName})`
            : `Monthly renewal / restore for @${params.subscriberUsername} (${params.profileName})`),
      },
    ]);

    broadcastResellerWalletUpdated({ resellerId: reseller.id, walletBalance: balanceAfter });
  }

  return {
    ok: true,
    chargedAmount: wholesalePrice,
    balanceBefore,
    balanceAfter,
    resellerId: reseller.id,
    resellerName: reseller.full_name,
    profileName: params.profileName,
  };
}

/**
 * Helper to fetch the live wallet balance & credit limit for a logged-in reseller.
 */
export async function fetchLiveResellerWalletSnapshot(
  user?: UserAccount | null
): Promise<{
  wallet_balance: number;
  credit_limit: number;
  bandwidth_pool_cap_mbps: number;
  max_active_users: number;
  can_create_subdealers: boolean;
} | null> {
  if (!user?.id || !isResellerUser(user)) return null;
  const { data, error } = await supabase
    .from('portal_users')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  if (error || !data) {
    if (error) console.error('[ResellerEngine] fetchLiveResellerWalletSnapshot failed:', error);
    return null;
  }
  return {
    wallet_balance: Number(data.wallet_balance || 0),
    credit_limit: Number(data.credit_limit || 0),
    bandwidth_pool_cap_mbps: getResellerPoolMbps(data),
    max_active_users: Number(data.max_active_users || 0),
    can_create_subdealers: Boolean(data.can_create_subdealers),
  };
}
