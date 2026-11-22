import { supabase } from '../services/supabaseClient';
import type { SystemRole, UserAccount } from '../types/auth';

export type GisMapPermission = 'none' | 'view' | 'edit';

export interface ResolvedGisAccess {
  canAccess: boolean;
  permission: GisMapPermission;
  canEdit: boolean;
  isViewOnly: boolean;
  isAdminOverride: boolean;
}

export interface GisPermissionUserLike {
  id?: string | null;
  username?: string | null;
  role?: string | null;
  can_access_gis_map?: boolean | null;
  gis_map_permission?: string | null;
}

export const GIS_PERMISSION_UPDATED_EVENT = 'youthnet-gis-permission-updated';
const LOCAL_GIS_OVERRIDE_STORAGE_KEY = 'youthnet_gis_access_overrides_v1';

export const GIS_ACCESS_MIGRATION_SQL = `-- Add granular Fiber GIS & Map RBAC columns to portal_users
ALTER TABLE IF EXISTS public.portal_users
  ADD COLUMN IF NOT EXISTS can_access_gis_map BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE IF EXISTS public.portal_users
  ADD COLUMN IF NOT EXISTS gis_map_permission TEXT NOT NULL DEFAULT 'view'
  CHECK (gis_map_permission IN ('none', 'view', 'edit'));

-- Ensure Admin accounts always have full edit access
UPDATE public.portal_users
SET can_access_gis_map = TRUE,
    gis_map_permission = 'edit'
WHERE UPPER(COALESCE(role, '')) = 'ADMIN';

-- Ensure Client/Subscriber accounts do not have GIS map access
UPDATE public.portal_users
SET can_access_gis_map = FALSE,
    gis_map_permission = 'none'
WHERE UPPER(COALESCE(role, '')) = 'CLIENT';
`;

export const GIS_PERMISSION_OPTIONS: Array<{
  value: GisMapPermission;
  label: string;
  shortLabel: string;
  description: string;
  canAccess: boolean;
}> = [
  {
    value: 'none',
    label: 'Disabled (No Access)',
    shortLabel: 'Disabled',
    description: 'Hides Fiber GIS & Map tab and blocks direct map route access.',
    canAccess: false,
  },
  {
    value: 'view',
    label: 'View & Trace Only (Field Mode)',
    shortLabel: 'View & Trace Only',
    description: 'Can view map, search FDBs/clients, trace paths, check signal & GPS; editing hidden.',
    canAccess: true,
  },
  {
    value: 'edit',
    label: 'Full Edit & Splice Access',
    shortLabel: 'Full Edit & Splice',
    description: 'Full topology editing: place OLT/Dist/FDB/FOSC, route cables, splice cores & upgrade gear.',
    canAccess: true,
  },
];

interface LocalGisOverrideEntry {
  can_access_gis_map: boolean;
  gis_map_permission: GisMapPermission;
  updatedAt: string;
}

function readLocalGisOverrides(): Record<string, LocalGisOverrideEntry> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(LOCAL_GIS_OVERRIDE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeLocalGisOverride(
  key: string,
  permission: GisMapPermission
): void {
  if (typeof window === 'undefined' || !key) return;
  try {
    const existing = readLocalGisOverrides();
    existing[key.toLowerCase()] = {
      can_access_gis_map: permission !== 'none',
      gis_map_permission: permission,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(LOCAL_GIS_OVERRIDE_STORAGE_KEY, JSON.stringify(existing));
  } catch {}
}

export function getLocalGisOverride(
  user?: GisPermissionUserLike | null
): LocalGisOverrideEntry | null {
  if (!user) return null;
  const map = readLocalGisOverrides();
  const byId = user.id ? map[String(user.id).toLowerCase()] : undefined;
  if (byId) return byId;
  const byUsername = user.username ? map[String(user.username).trim().toLowerCase()] : undefined;
  return byUsername || null;
}

export function isValidGisPermission(val: unknown): val is GisMapPermission {
  return val === 'none' || val === 'view' || val === 'edit';
}

export function isStaffRoleEligibleForGisControl(role?: string | null): boolean {
  const upper = (role || '').trim().toUpperCase();
  if (!upper) return false;
  if (upper === 'ADMIN' || upper === 'CLIENT' || upper === 'SUBSCRIBER') return false;
  return true;
}

export function normalizeGisMapPermission(
  rawPermission?: string | null,
  canAccessFlag?: boolean | null,
  role?: string | null
): GisMapPermission {
  const roleUpper = (role || '').trim().toUpperCase();
  if (roleUpper === 'ADMIN') return 'edit';
  if (roleUpper === 'CLIENT' || roleUpper === 'SUBSCRIBER') return 'none';

  if (canAccessFlag === false) return 'none';

  const normalized = (rawPermission || '').trim().toLowerCase();
  if (normalized === 'none' || normalized === 'disabled') return 'none';
  if (normalized === 'edit' || normalized === 'full') return 'edit';
  if (normalized === 'view' || normalized === 'readonly' || normalized === 'read_only') {
    return 'view';
  }

  // Safe least-privilege default for staff rows when columns are not explicitly set yet
  return 'view';
}

/**
 * Resolve effective Fiber GIS & Map access for any user record.
 * Admin tier always retains unrestricted full edit access.
 * Client tier never has GIS access.
 */
export function resolveUserGisAccess(
  user?: GisPermissionUserLike | UserAccount | null,
  effectiveRole?: SystemRole | string | null
): ResolvedGisAccess {
  const roleUpper = ((effectiveRole || user?.role || '') as string).trim().toUpperCase();

  if (roleUpper === 'ADMIN') {
    return {
      canAccess: true,
      permission: 'edit',
      canEdit: true,
      isViewOnly: false,
      isAdminOverride: true,
    };
  }

  if (roleUpper === 'CLIENT' || roleUpper === 'SUBSCRIBER') {
    return {
      canAccess: false,
      permission: 'none',
      canEdit: false,
      isViewOnly: false,
      isAdminOverride: false,
    };
  }

  const hasExplicitDbFields =
    typeof user?.can_access_gis_map === 'boolean' || isValidGisPermission(user?.gis_map_permission);

  const localOverride = !hasExplicitDbFields ? getLocalGisOverride(user) : null;

  const permission = normalizeGisMapPermission(
    hasExplicitDbFields ? user?.gis_map_permission : localOverride?.gis_map_permission,
    hasExplicitDbFields ? user?.can_access_gis_map : localOverride?.can_access_gis_map,
    roleUpper || 'AGENT'
  );

  return {
    canAccess: permission !== 'none',
    permission,
    canEdit: permission === 'edit',
    isViewOnly: permission === 'view',
    isAdminOverride: false,
  };
}

export function isMissingGisPermissionColumnError(err: any): boolean {
  const msg = String(err?.message || err?.details || err?.hint || '').toLowerCase();
  const code = String(err?.code || '');
  return (
    code === '42703' ||
    code === 'PGRST204' ||
    msg.includes('can_access_gis_map') ||
    msg.includes('gis_map_permission')
  );
}

/**
 * Persist a staff user's Fiber GIS & Map permission directly to Supabase portal_users.
 * Falls back gracefully with a clear SQL notice if the columns haven't been migrated yet.
 */
export async function updatePortalUserGisPermission(params: {
  userId: string;
  username?: string;
  permission: GisMapPermission;
}): Promise<{
  ok: boolean;
  persistedToDb: boolean;
  schemaMissing?: boolean;
  can_access_gis_map: boolean;
  gis_map_permission: GisMapPermission;
  error?: string;
}> {
  const safePermission: GisMapPermission = isValidGisPermission(params.permission)
    ? params.permission
    : 'none';
  const canAccess = safePermission !== 'none';

  // Always cache local override for instant UI responsiveness if DB schema lags
  writeLocalGisOverride(params.userId, safePermission);
  if (params.username) {
    writeLocalGisOverride(params.username, safePermission);
  }

  const broadcast = () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent(GIS_PERMISSION_UPDATED_EVENT, {
          detail: {
            userId: params.userId,
            username: params.username,
            can_access_gis_map: canAccess,
            gis_map_permission: safePermission,
          },
        })
      );
    }
  };

  try {
    const query = supabase
      .from('portal_users')
      .update({
        can_access_gis_map: canAccess,
        gis_map_permission: safePermission,
      })
      .eq('id', params.userId);

    const { error } = await query;

    if (error) {
      if (isMissingGisPermissionColumnError(error)) {
        broadcast();
        return {
          ok: true,
          persistedToDb: false,
          schemaMissing: true,
          can_access_gis_map: canAccess,
          gis_map_permission: safePermission,
          error:
            'Run the portal_users GIS permission SQL migration in Supabase to persist across devices.',
        };
      }
      return {
        ok: false,
        persistedToDb: false,
        can_access_gis_map: canAccess,
        gis_map_permission: safePermission,
        error: error.message || 'Failed to update GIS permission in Supabase.',
      };
    }

    broadcast();
    return {
      ok: true,
      persistedToDb: true,
      can_access_gis_map: canAccess,
      gis_map_permission: safePermission,
    };
  } catch (err: any) {
    return {
      ok: false,
      persistedToDb: false,
      can_access_gis_map: canAccess,
      gis_map_permission: safePermission,
      error: err?.message || 'Unexpected error saving GIS permission.',
    };
  }
}

/**
 * Fetch the logged-in user's live Fiber GIS & Map permissions directly from Supabase portal_users.
 */
export async function fetchLiveUserGisPermissionFromSupabase(
  user: Pick<UserAccount, 'id' | 'username' | 'role'>
): Promise<{
  can_access_gis_map: boolean;
  gis_map_permission: GisMapPermission;
  found: boolean;
}> {
  if ((user.role || '').toUpperCase() === 'ADMIN') {
    return { can_access_gis_map: true, gis_map_permission: 'edit', found: true };
  }
  if ((user.role || '').toUpperCase() === 'CLIENT') {
    return { can_access_gis_map: false, gis_map_permission: 'none', found: true };
  }

  try {
    let row: any = null;
    if (user.id && /^[0-9a-f-]{8,}$/i.test(user.id)) {
      const { data } = await supabase
        .from('portal_users')
        .select('id, username, role, can_access_gis_map, gis_map_permission')
        .eq('id', user.id)
        .maybeSingle();
      if (data) row = data;
    }

    if (!row && user.username) {
      const { data } = await supabase
        .from('portal_users')
        .select('id, username, role, can_access_gis_map, gis_map_permission')
        .ilike('username', user.username.trim())
        .maybeSingle();
      if (data) row = data;
    }

    if (row) {
      const resolved = resolveUserGisAccess(row, row.role || user.role);
      return {
        can_access_gis_map: resolved.canAccess,
        gis_map_permission: resolved.permission,
        found: true,
      };
    }
  } catch (err) {
    console.warn('[GIS Access] Live Supabase permission check notice:', err);
  }

  const fallback = resolveUserGisAccess(user, user.role);
  return {
    can_access_gis_map: fallback.canAccess,
    gis_map_permission: fallback.permission,
    found: false,
  };
}
