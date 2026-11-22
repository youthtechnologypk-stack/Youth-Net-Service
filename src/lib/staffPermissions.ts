import { supabase } from '../services/supabaseClient';
import {
  GisMapPermission,
  GIS_PERMISSION_UPDATED_EVENT,
  normalizeGisPermission,
  saveLocalGisPermissionOverride,
} from './gisAccessControl';

export interface StaffPermissions {
  // Network & GIS Controls
  gis_map: GisMapPermission;
  mikrotik_panel: boolean;
  olt_panel: boolean;
  outage_broadcast: boolean;

  // Billing & Cash Controls
  collect_fee: boolean;
  edit_delete_invoice: boolean;
  grace_and_shift: boolean;
  bulk_billing: boolean;
  expenses_ledger: boolean;

  // Subscriber & Data Privacy
  provision_pppoe: boolean;
  view_passwords: boolean;
  export_reports: boolean;
}

export type BooleanPermissionKey = Exclude<keyof StaffPermissions, 'gis_map'>;

export interface StaffPermissionSubject {
  id?: string | null;
  username?: string | null;
  role?: string | null;
  permissions?: Partial<StaffPermissions> | Record<string, any> | null;
  can_access_gis_map?: boolean | null;
  gis_map_permission?: string | null;
}

export type StaffPresetKey = 'field_recovery_agent' | 'noc_technician' | 'branch_manager';

export interface StaffPermissionPreset {
  key: StaffPresetKey;
  label: string;
  subtitle: string;
  badgeColor: string;
  permissions: StaffPermissions;
}

export const STAFF_PERMISSIONS_UPDATED_EVENT = 'youthnet_staff_permissions_updated';
const LOCAL_STAFF_PERMS_OVERRIDES_KEY = 'youthnet_staff_permissions_overrides_v1';

export const STAFF_PERMISSIONS_MIGRATION_SQL = `ALTER TABLE public.portal_users
  ADD COLUMN IF NOT EXISTS can_access_gis_map BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS gis_map_permission TEXT NOT NULL DEFAULT 'view',
  ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '{}'::jsonb;`;

export const ADMIN_FULL_PERMISSIONS: StaffPermissions = {
  gis_map: 'edit',
  mikrotik_panel: true,
  olt_panel: true,
  outage_broadcast: true,
  collect_fee: true,
  edit_delete_invoice: true,
  grace_and_shift: true,
  bulk_billing: true,
  expenses_ledger: true,
  provision_pppoe: true,
  view_passwords: true,
  export_reports: true,
};

export const CLIENT_NO_PERMISSIONS: StaffPermissions = {
  gis_map: 'none',
  mikrotik_panel: false,
  olt_panel: false,
  outage_broadcast: false,
  collect_fee: false,
  edit_delete_invoice: false,
  grace_and_shift: false,
  bulk_billing: false,
  expenses_ledger: false,
  provision_pppoe: false,
  view_passwords: false,
  export_reports: false,
};

export const STAFF_PERMISSION_PRESETS: StaffPermissionPreset[] = [
  {
    key: 'field_recovery_agent',
    label: 'Field Recovery Agent',
    subtitle: 'View-only GIS + doorstep cash collection only',
    badgeColor: 'cyan',
    permissions: {
      gis_map: 'view',
      mikrotik_panel: false,
      olt_panel: false,
      outage_broadcast: false,
      collect_fee: true,
      edit_delete_invoice: false,
      grace_and_shift: false,
      bulk_billing: false,
      expenses_ledger: false,
      provision_pppoe: false,
      view_passwords: false,
      export_reports: false,
    },
  },
  {
    key: 'noc_technician',
    label: 'NOC Technician',
    subtitle: 'Full GIS splice, MikroTik, OLT, PPPoE & outage tools',
    badgeColor: 'emerald',
    permissions: {
      gis_map: 'edit',
      mikrotik_panel: true,
      olt_panel: true,
      outage_broadcast: true,
      collect_fee: false,
      edit_delete_invoice: false,
      grace_and_shift: false,
      bulk_billing: false,
      expenses_ledger: false,
      provision_pppoe: true,
      view_passwords: true,
      export_reports: false,
    },
  },
  {
    key: 'branch_manager',
    label: 'Branch Manager',
    subtitle: 'Billing, grace, bulk recovery, expenses, OLT & reports',
    badgeColor: 'indigo',
    permissions: {
      gis_map: 'view',
      mikrotik_panel: false,
      olt_panel: true,
      outage_broadcast: true,
      collect_fee: true,
      edit_delete_invoice: true,
      grace_and_shift: true,
      bulk_billing: true,
      expenses_ledger: true,
      provision_pppoe: false,
      view_passwords: false,
      export_reports: true,
    },
  },
];

export interface PermissionToggleMeta {
  key: BooleanPermissionKey;
  label: string;
  description: string;
}

export interface PermissionCategoryMeta {
  id: 'network_gis' | 'billing_cash' | 'subscriber_privacy';
  title: string;
  subtitle: string;
  accent: 'sky' | 'emerald' | 'amber';
  includesGisSelector?: boolean;
  toggles: PermissionToggleMeta[];
}

export const PERMISSION_CATEGORIES: PermissionCategoryMeta[] = [
  {
    id: 'network_gis',
    title: 'Network & GIS Controls',
    subtitle: 'RouterOS core, OLT optical terminals, Fiber GIS map, and outage alerts',
    accent: 'sky',
    includesGisSelector: true,
    toggles: [
      {
        key: 'mikrotik_panel',
        label: 'MikroTik RouterOS v7 Tab Access',
        description: 'Open MikroTik PPPoE sessions, secrets, router profiles & queues',
      },
      {
        key: 'olt_panel',
        label: 'VSOL OLT GPON Tab Access',
        description: 'Access VSOL OLT PON ports, ONU optical signal levels & telemetry',
      },
      {
        key: 'outage_broadcast',
        label: 'Send Bulk Outage WhatsApp Broadcast',
        description: 'Launch mass area outage alerts and WhatsApp broadcasts to subscribers',
      },
    ],
  },
  {
    id: 'billing_cash',
    title: 'Billing & Cash Controls',
    subtitle: 'Cash collections, invoice modifications, grace extensions, bulk actions & ledger',
    accent: 'emerald',
    toggles: [
      {
        key: 'collect_fee',
        label: 'Receive Cash / Mark Invoice Paid',
        description: 'Collect subscriber fees, mark invoices paid, and credit field cash-in-hand',
      },
      {
        key: 'edit_delete_invoice',
        label: 'Edit Invoice Amount, Apply Discount & Delete Invoice',
        description: 'Modify invoice amounts/plans, apply discounts, or permanently delete invoices',
      },
      {
        key: 'grace_and_shift',
        label: 'Grant Extra Grace Period & Shift Bill to Next Month',
        description: 'Grant, edit, or cancel extra grace periods and shift bills to next calendar month',
      },
      {
        key: 'bulk_billing',
        label: 'Bulk Activate & Bulk Receive Payments',
        description: 'Execute multi-subscriber Bulk Activate and Bulk Receive Amount operations',
      },
      {
        key: 'expenses_ledger',
        label: 'View & Add Office Expenses / Salary Advances',
        description: 'Open Profit & Expenses tab, record office expenses, and manage salary advances',
      },
    ],
  },
  {
    id: 'subscriber_privacy',
    title: 'Subscriber & Data Privacy',
    subtitle: 'Account provisioning, sensitive PPPoE credentials, CNIC visibility & data export',
    accent: 'amber',
    toggles: [
      {
        key: 'provision_pppoe',
        label: '+ Provision New PPPoE User',
        description: 'Create new PPPoE secrets and provision subscribers directly onto RouterOS',
      },
      {
        key: 'view_passwords',
        label: 'Reveal Subscriber PPPoE Passwords & CNIC',
        description: 'Unmask subscriber PPPoE passwords, copy secrets, and view full CNIC numbers',
      },
      {
        key: 'export_reports',
        label: 'Export / Download CSV & Financial Reports',
        description: 'Export CSV sheets, billing ledgers, audit logs, and financial summary reports',
      },
    ],
  },
];

export function isStaffRoleEligibleForPermissions(role?: string | null): boolean {
  const r = String(role || '').trim().toUpperCase();
  return (
    r === 'MANAGER' ||
    r === 'AGENT' ||
    r === 'FIELD_AGENT' ||
    r === 'TECHNICIAN' ||
    r === 'NOC' ||
    r === 'NOC_OPERATOR' ||
    r === 'RECOVERY'
  );
}

export function getDefaultPermissionsForRole(role?: string | null): StaffPermissions {
  const r = String(role || '').trim().toUpperCase();
  if (r === 'ADMIN') return { ...ADMIN_FULL_PERMISSIONS };
  if (r === 'CLIENT') return { ...CLIENT_NO_PERMISSIONS };
  if (r === 'NOC' || r === 'NOC_OPERATOR' || r === 'TECHNICIAN') {
    return { ...STAFF_PERMISSION_PRESETS[1].permissions };
  }
  if (r === 'MANAGER') {
    return { ...STAFF_PERMISSION_PRESETS[2].permissions };
  }
  // Default for AGENT / FIELD_AGENT / RECOVERY
  return { ...STAFF_PERMISSION_PRESETS[0].permissions };
}

export function getPresetPermissions(presetKey: StaffPresetKey): StaffPermissions {
  const found = STAFF_PERMISSION_PRESETS.find((p) => p.key === presetKey);
  return found ? { ...found.permissions } : { ...STAFF_PERMISSION_PRESETS[0].permissions };
}

export function detectMatchingPreset(perms: StaffPermissions): StaffPresetKey | null {
  for (const preset of STAFF_PERMISSION_PRESETS) {
    const p = preset.permissions;
    if (
      perms.gis_map === p.gis_map &&
      perms.mikrotik_panel === p.mikrotik_panel &&
      perms.olt_panel === p.olt_panel &&
      perms.outage_broadcast === p.outage_broadcast &&
      perms.collect_fee === p.collect_fee &&
      perms.edit_delete_invoice === p.edit_delete_invoice &&
      perms.grace_and_shift === p.grace_and_shift &&
      perms.bulk_billing === p.bulk_billing &&
      perms.expenses_ledger === p.expenses_ledger &&
      perms.provision_pppoe === p.provision_pppoe &&
      perms.view_passwords === p.view_passwords &&
      perms.export_reports === p.export_reports
    ) {
      return preset.key;
    }
  }
  return null;
}

export function countEnabledPermissions(perms: StaffPermissions): number {
  let count = perms.gis_map !== 'none' ? 1 : 0;
  const boolKeys: BooleanPermissionKey[] = [
    'mikrotik_panel',
    'olt_panel',
    'outage_broadcast',
    'collect_fee',
    'edit_delete_invoice',
    'grace_and_shift',
    'bulk_billing',
    'expenses_ledger',
    'provision_pppoe',
    'view_passwords',
    'export_reports',
  ];
  for (const key of boolKeys) {
    if (perms[key]) count += 1;
  }
  return count;
}

export function getLocalStaffPermissionsOverrides(): Record<string, Partial<StaffPermissions>> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(LOCAL_STAFF_PERMS_OVERRIDES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveLocalStaffPermissionsOverride(
  keys: Array<string | null | undefined>,
  permissions: StaffPermissions
): void {
  if (typeof window === 'undefined') return;
  try {
    const map = getLocalStaffPermissionsOverrides();
    keys.forEach((k) => {
      const clean = String(k || '').trim().toLowerCase();
      if (clean) map[clean] = { ...permissions };
    });
    window.localStorage.setItem(LOCAL_STAFF_PERMS_OVERRIDES_KEY, JSON.stringify(map));
  } catch {
    // ignore storage quota errors
  }
}

export function clearLocalStaffPermissionsOverride(keys: Array<string | null | undefined>): void {
  if (typeof window === 'undefined') return;
  try {
    const map = getLocalStaffPermissionsOverrides();
    let changed = false;
    keys.forEach((k) => {
      const clean = String(k || '').trim().toLowerCase();
      if (clean && clean in map) {
        delete map[clean];
        changed = true;
      }
    });
    if (changed) {
      window.localStorage.setItem(LOCAL_STAFF_PERMS_OVERRIDES_KEY, JSON.stringify(map));
    }
  } catch {
    // ignore
  }
}

function readLocalStaffPermissionsOverride(
  user?: StaffPermissionSubject | null
): Partial<StaffPermissions> | null {
  if (!user || typeof window === 'undefined') return null;
  const map = getLocalStaffPermissionsOverrides();
  const idKey = String(user.id || '').trim().toLowerCase();
  if (idKey && map[idKey]) return map[idKey];
  const unameKey = String(user.username || '').trim().toLowerCase();
  if (unameKey && map[unameKey]) return map[unameKey];
  return null;
}

export function normalizePermissionsObject(
  raw: Record<string, any> | null | undefined,
  fallbackRole?: string | null,
  explicitGisColumns?: { can_access_gis_map?: boolean | null; gis_map_permission?: string | null }
): StaffPermissions {
  const base = getDefaultPermissionsForRole(fallbackRole);
  const src = raw && typeof raw === 'object' ? raw : {};

  // Resolve GIS state cleanly from permissions.gis_map or explicit columns
  let resolvedGis: GisMapPermission = base.gis_map;
  if (src.gis_map !== undefined && src.gis_map !== null) {
    resolvedGis = normalizeGisPermission(String(src.gis_map), base.gis_map);
  } else if (
    explicitGisColumns?.gis_map_permission !== undefined &&
    explicitGisColumns?.gis_map_permission !== null &&
    String(explicitGisColumns.gis_map_permission).trim() !== ''
  ) {
    resolvedGis = normalizeGisPermission(explicitGisColumns.gis_map_permission, base.gis_map);
  } else if (explicitGisColumns?.can_access_gis_map === false) {
    resolvedGis = 'none';
  } else if (explicitGisColumns?.can_access_gis_map === true && resolvedGis === 'none') {
    resolvedGis = 'view';
  }

  if (explicitGisColumns?.can_access_gis_map === false && src.gis_map === undefined) {
    resolvedGis = 'none';
  }

  const pickBool = (key: BooleanPermissionKey): boolean => {
    if (typeof src[key] === 'boolean') return src[key];
    return base[key];
  };

  return {
    gis_map: resolvedGis,
    mikrotik_panel: pickBool('mikrotik_panel'),
    olt_panel: pickBool('olt_panel'),
    outage_broadcast: pickBool('outage_broadcast'),
    collect_fee: pickBool('collect_fee'),
    edit_delete_invoice: pickBool('edit_delete_invoice'),
    grace_and_shift: pickBool('grace_and_shift'),
    bulk_billing: pickBool('bulk_billing'),
    expenses_ledger: pickBool('expenses_ledger'),
    provision_pppoe: pickBool('provision_pppoe'),
    view_passwords: pickBool('view_passwords'),
    export_reports: pickBool('export_reports'),
  };
}

/**
 * Single source of truth for resolving effective RBAC permissions for any logged-in user.
 * - ADMIN always receives unrestricted full access across all 12 switches.
 * - CLIENT always receives zero staff permissions.
 * - MANAGER / AGENT / TECHNICIAN / NOC receive role defaults overlaid with their
 *   live `portal_users.permissions` JSONB (and synchronized GIS columns).
 */
export function resolveStaffPermissions(
  user?: StaffPermissionSubject | null,
  effectiveRole?: string | null
): StaffPermissions {
  const role = String(effectiveRole || user?.role || '').trim().toUpperCase();
  if (role === 'ADMIN') return { ...ADMIN_FULL_PERMISSIONS };
  if (role === 'CLIENT' || !role) return { ...CLIENT_NO_PERMISSIONS };

  const dbPerms =
    user?.permissions && typeof user.permissions === 'object' ? user.permissions : null;
  const hasDbKeys = Boolean(dbPerms && Object.keys(dbPerms).length > 0);
  const localOverride = !hasDbKeys ? readLocalStaffPermissionsOverride(user) : null;
  const sourcePerms = hasDbKeys ? dbPerms : localOverride;

  return normalizePermissionsObject(sourcePerms, role, {
    can_access_gis_map: user?.can_access_gis_map,
    gis_map_permission: user?.gis_map_permission,
  });
}

export function isMissingPermissionsColumnError(err: any): boolean {
  if (!err) return false;
  const code = String(err.code || '').toUpperCase();
  const msg = String(err.message || err.details || err.hint || '').toLowerCase();
  return (
    code === '42703' ||
    code === 'PGRST204' ||
    msg.includes('permissions') ||
    msg.includes('can_access_gis_map') ||
    msg.includes('gis_map_permission')
  );
}

export function broadcastStaffPermissionsUpdated(detail: {
  userId?: string;
  username?: string;
  permissions: StaffPermissions;
}): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(STAFF_PERMISSIONS_UPDATED_EVENT, { detail }));
    window.dispatchEvent(
      new CustomEvent(GIS_PERMISSION_UPDATED_EVENT, {
        detail: {
          userId: detail.userId,
          username: detail.username,
          can_access_gis_map: detail.permissions.gis_map !== 'none',
          gis_map_permission: detail.permissions.gis_map,
        },
      })
    );
  } catch {
    // ignore
  }
}

export async function updatePortalUserPermissions(params: {
  userId?: string;
  username?: string;
  permissions: StaffPermissions;
}): Promise<{
  ok: boolean;
  permissions: StaffPermissions;
  can_access_gis_map: boolean;
  gis_map_permission: GisMapPermission;
  schemaMissing?: boolean;
  error?: string;
}> {
  const normalized = normalizePermissionsObject(params.permissions, 'MANAGER', {
    can_access_gis_map: params.permissions.gis_map !== 'none',
    gis_map_permission: params.permissions.gis_map,
  });
  const canAccessGis = normalized.gis_map !== 'none';
  const gisPerm = normalized.gis_map;

  const isUuid = Boolean(
    params.userId &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.userId)
  );
  const cleanUsername = String(params.username || '').trim().toLowerCase();

  try {
    let query = supabase.from('portal_users').update({
      permissions: normalized,
      can_access_gis_map: canAccessGis,
      gis_map_permission: gisPerm,
    });

    if (isUuid && params.userId) {
      query = query.eq('id', params.userId);
    } else if (cleanUsername) {
      query = query.ilike('username', cleanUsername);
    } else if (params.userId) {
      query = query.eq('id', params.userId);
    } else {
      return {
        ok: false,
        permissions: normalized,
        can_access_gis_map: canAccessGis,
        gis_map_permission: gisPerm,
        error: 'Missing user identifier.',
      };
    }

    const { error } = await query;

    if (error) {
      if (isMissingPermissionsColumnError(error)) {
        // Try updating at least GIS columns if only `permissions` column is missing
        let gisOnlyQuery = supabase.from('portal_users').update({
          can_access_gis_map: canAccessGis,
          gis_map_permission: gisPerm,
        });
        if (isUuid && params.userId) {
          gisOnlyQuery = gisOnlyQuery.eq('id', params.userId);
        } else if (cleanUsername) {
          gisOnlyQuery = gisOnlyQuery.ilike('username', cleanUsername);
        }
        await gisOnlyQuery.then(() => {}, () => {});

        saveLocalStaffPermissionsOverride([params.userId, cleanUsername], normalized);
        saveLocalGisPermissionOverride([params.userId, cleanUsername], gisPerm);
        broadcastStaffPermissionsUpdated({
          userId: params.userId,
          username: cleanUsername || undefined,
          permissions: normalized,
        });
        return {
          ok: true,
          permissions: normalized,
          can_access_gis_map: canAccessGis,
          gis_map_permission: gisPerm,
          schemaMissing: true,
          error:
            'Permissions saved locally for this browser. Run the portal_users `permissions` JSONB SQL migration in Supabase for cross-device enforcement.',
        };
      }

      return {
        ok: false,
        permissions: normalized,
        can_access_gis_map: canAccessGis,
        gis_map_permission: gisPerm,
        error: error.message || 'Failed to update user permissions.',
      };
    }

    // DB update succeeded — clear stale local overrides and broadcast
    clearLocalStaffPermissionsOverride([params.userId, cleanUsername]);
    saveLocalGisPermissionOverride([params.userId, cleanUsername], gisPerm);
    broadcastStaffPermissionsUpdated({
      userId: params.userId,
      username: cleanUsername || undefined,
      permissions: normalized,
    });

    return {
      ok: true,
      permissions: normalized,
      can_access_gis_map: canAccessGis,
      gis_map_permission: gisPerm,
    };
  } catch (err: any) {
    return {
      ok: false,
      permissions: normalized,
      can_access_gis_map: canAccessGis,
      gis_map_permission: gisPerm,
      error: err?.message || 'Unexpected error updating permissions.',
    };
  }
}

export async function fetchLiveStaffPermissionsFromSupabase(
  user?: StaffPermissionSubject | null
): Promise<{
  permissions?: Partial<StaffPermissions> | null;
  can_access_gis_map?: boolean;
  gis_map_permission?: GisMapPermission;
} | null> {
  if (!user) return null;
  const role = String(user.role || '').trim().toUpperCase();
  if (role === 'ADMIN') {
    return {
      permissions: { ...ADMIN_FULL_PERMISSIONS },
      can_access_gis_map: true,
      gis_map_permission: 'edit',
    };
  }
  if (role === 'CLIENT') {
    return {
      permissions: { ...CLIENT_NO_PERMISSIONS },
      can_access_gis_map: false,
      gis_map_permission: 'none',
    };
  }

  const isUuid = Boolean(
    user.id &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.id)
  );
  const cleanUsername = String(user.username || '').trim().toLowerCase();

  try {
    let query = supabase
      .from('portal_users')
      .select('id, username, role, permissions, can_access_gis_map, gis_map_permission');
    if (isUuid && user.id) {
      query = query.eq('id', user.id);
    } else if (cleanUsername) {
      query = query.ilike('username', cleanUsername);
    } else {
      return null;
    }

    const { data, error } = await query.maybeSingle();
    if (error) {
      if (isMissingPermissionsColumnError(error)) {
        // Fallback to GIS-only select if `permissions` column is not migrated yet
        let fallbackQuery = supabase
          .from('portal_users')
          .select('id, username, role, can_access_gis_map, gis_map_permission');
        if (isUuid && user.id) {
          fallbackQuery = fallbackQuery.eq('id', user.id);
        } else if (cleanUsername) {
          fallbackQuery = fallbackQuery.ilike('username', cleanUsername);
        }
        const { data: gisData, error: gisErr } = await fallbackQuery.maybeSingle();
        if (gisErr || !gisData) return null;
        const resolved = resolveStaffPermissions(
          {
            ...user,
            can_access_gis_map: gisData.can_access_gis_map,
            gis_map_permission: gisData.gis_map_permission,
          },
          gisData.role || role
        );
        return {
          permissions: resolved,
          can_access_gis_map: resolved.gis_map !== 'none',
          gis_map_permission: resolved.gis_map,
        };
      }
      return null;
    }

    if (!data) return null;

    const resolved = resolveStaffPermissions(
      {
        id: data.id,
        username: data.username,
        role: data.role || role,
        permissions: data.permissions as any,
        can_access_gis_map: data.can_access_gis_map,
        gis_map_permission: data.gis_map_permission,
      },
      data.role || role
    );

    return {
      permissions: resolved,
      can_access_gis_map: resolved.gis_map !== 'none',
      gis_map_permission: resolved.gis_map,
    };
  } catch {
    return null;
  }
}

/**
 * Privacy helper: masks a CNIC string when `view_passwords` permission is disabled.
 * Keeps only last digit or full masking if short.
 */
export function maskSensitiveCnic(cnic?: string | null): string {
  const raw = String(cnic || '').trim();
  if (!raw) return 'N/A';
  if (raw.includes('-')) {
    return '*****-*******-*';
  }
  return '•••••••••••••';
}
