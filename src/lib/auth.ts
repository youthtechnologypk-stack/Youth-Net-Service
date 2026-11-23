import { SystemRole, UserAccount } from '../types/auth';
import { storageService } from '../services/storageService';
import { supabase } from '../services/supabaseClient';
import { normalizeGisMapPermission } from './gisAccessControl';
import { resolveStaffPermissions } from './staffPermissions';
import {
  USERS_STORAGE_KEY,
  AUTH_STORAGE_KEY,
  authenticateAgainstRepository,
  saveUnifiedPortalUser,
  getStandardPortalUsers,
  UnifiedPortalUser,
} from './userRepository';

export { USERS_STORAGE_KEY, saveUnifiedPortalUser, getStandardPortalUsers };
export type { UnifiedPortalUser };

export interface AuthSessionData {
  token: string;
  user: UserAccount;
  username?: string;
  role?: SystemRole;
  fullName?: string;
}

/**
 * Default Landing Route by Role
 * Requirement:
 * 'AGENT' -> /agent/portal
 * 'CLIENT' -> /client/portal
 * 'ADMIN' -> /admin/noc
 * 'MANAGER' -> /manager/dashboard
 */
export function getLandingRouteForRole(role: SystemRole): string {
  switch (role) {
    case 'ADMIN':
      return '/admin/noc';
    case 'MANAGER':
      return '/manager/dashboard';
    case 'DEALER':
      return '/dealers';
    case 'SUB_DEALER':
      return '/billing';
    case 'AGENT':
      return '/agent/portal';
    case 'CLIENT':
      return '/client/portal';
    default:
      return '/login';
  }
}

export function getTabFromPath(path: string): string | null {
  const clean = path.toLowerCase().replace(/^\//, '').split('?')[0].split('#')[0].trim();
  if (clean === 'agent/portal' || clean === 'agent') return 'agent_portal';
  if (clean === 'client/portal' || clean === 'client') return 'client_portal';
  if (clean === 'admin/noc' || clean === 'admin' || clean === 'dashboard/admin' || clean === 'noc' || clean === '') return 'noc';
  if (clean === 'capacity' || clean === 'capacity-pools' || clean === 'admin/capacity') return 'capacity';
  if (clean === 'manager/dashboard' || clean === 'manager' || clean === 'dashboard/operations' || clean === 'operations') return 'operations';
  if (clean === 'dealers' || clean === 'resellers' || clean === 'dealers-subdealers') return 'dealers';
  if (clean === 'billing') return 'billing';
  if (clean === 'profit-expenses' || clean === 'profit_expenses') return 'profit_expenses';
  if (clean === 'inventory' || clean === 'hardware-inventory') return 'inventory';
  if (clean === 'complaints') return 'complaints';
  if (clean === 'mikrotik') return 'mikrotik';
  if (clean === 'olt') return 'olt';
  if (clean === 'users') return 'users';
  if (clean === 'permissions') return 'permissions';
  if (clean === 'settings') return 'settings';
  if (clean === 'architecture') return 'architecture';
  if (clean === 'logs' || clean === 'activity' || clean === 'audit') return 'logs';
  if (clean === 'fiber-gis' || clean === 'fiber_gis' || clean === 'gis' || clean === 'map') return 'fiber_gis';
  if (clean === 'mobile') return 'mobile';
  if (clean === 'login') return 'login';
  return null;
}

export function getPathFromTab(tab: string): string {
  switch (tab) {
    case 'agent_portal':
      return '/agent/portal';
    case 'client_portal':
      return '/client/portal';
    case 'noc':
      return '/admin/noc';
    case 'operations':
      return '/manager/dashboard';
    case 'dealers':
      return '/dealers';
    case 'profit_expenses':
      return '/profit-expenses';
    case 'logs':
      return '/logs';
    case 'fiber_gis':
      return '/fiber-gis';
    default:
      return `/${tab}`;
  }
}


/**
 * Checks if a given role is permitted to access a specific feature/tab
 */
export function isRouteAllowedForRole(
  role: SystemRole,
  routeOrTab: string,
  user?: UserAccount | null
): boolean {
  if (role === 'ADMIN') {
    return true; // Complete unrestricted access
  }

  const clean = routeOrTab.toLowerCase().replace(/^\//, '');
  const perms = resolveStaffPermissions(user, role);

  // Granular RBAC checks for feature-gated modules
  if (clean === 'mikrotik' || clean.includes('mikrotik')) {
    return perms.mikrotik_panel;
  }
  if (clean === 'olt' || clean === '/olt') {
    return perms.olt_panel;
  }
  if (clean === 'fiber_gis' || clean === 'fiber-gis' || clean === 'gis' || clean === 'map') {
    return perms.gis_map !== 'none';
  }
  if (clean === 'profit_expenses' || clean === 'profit-expenses') {
    return perms.expenses_ledger;
  }

  if (clean === 'dealers' || clean === 'resellers') {
    return (
      role === 'DEALER' ||
      String(user?.tier_level || '').toUpperCase() === 'DEALER'
    );
  }

  if (role === 'DEALER' || String(user?.tier_level || '').toUpperCase() === 'DEALER') {
    const dealerAllowed = ['dealers', 'billing', 'users', 'complaints', 'subscribers'];
    return dealerAllowed.some((a) => clean === a || clean.includes(a));
  }

  if (role === 'SUB_DEALER' || String(user?.tier_level || '').toUpperCase() === 'SUB_DEALER') {
    const subDealerAllowed = ['billing', 'users', 'complaints', 'subscribers'];
    return subDealerAllowed.some((a) => clean === a || clean.includes(a));
  }

  if (role === 'MANAGER') {
    const managerAllowed = [
      'noc',
      'capacity',
      'operations',
      'dashboard/operations',
      'complaints',
      'subscribers',
      'billing',
      'inventory',
      'logs',
    ];
    const managerForbidden = ['settings', 'architecture', 'users', 'permissions', 'dealers'];
    if (managerForbidden.some((f) => clean.includes(f))) return false;
    return managerAllowed.some((a) => clean.includes(a));
  }

  if (role === 'AGENT') {
    const agentAllowed = ['agent', 'agent/portal', 'agent_portal', 'mobile', 'tickets', 'collections', 'ont_checker'];
    return agentAllowed.some((a) => clean === a || clean.includes(a));
  }

  if (role === 'CLIENT') {
    const clientAllowed = ['client', 'client/portal', 'client_portal', 'my_connection', 'my_invoices', 'my_support'];
    return clientAllowed.some((a) => clean === a || clean.includes(a));
  }

  return false;
}

const DEFAULT_ADMIN_USER: UserAccount = {
  id: 'usr-admin-01',
  username: 'admin',
  fullName: 'NOC Master Administrator',
  displayName: 'NOC Master Administrator',
  phone: '+92 300 1234567',
  role: 'ADMIN',
  area: 'Central NOC Core',
  assignedArea: 'Central NOC Core',
  cashInHand: 0,
  balance: 0,
  isActive: true,
  createdAt: new Date().toISOString(),
};

/**
 * Get current authenticated user from storage (Strict RBAC - returns null if not logged in)
 */
export function getStoredUser(): UserAccount | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed: any = JSON.parse(raw);
    const u = parsed.user || (parsed.username && parsed.role ? parsed : null);
    if (u) {
      return {
        id: u.id || `usr-${u.username}`,
        username: u.username,
        fullName: u.fullName || u.displayName || u.username,
        displayName: u.displayName || u.fullName || u.username,
        phone: u.phone || '+92 300 0000000',
        role: u.role,
        area: u.area || u.assignedArea || 'Central Zone',
        assignedArea: u.area || u.assignedArea || 'Central Zone',
        cashInHand: Number(u.cashInHand ?? u.balance ?? 0),
        balance: Number(u.cashInHand ?? u.balance ?? 0),
        email: u.email || `${u.username}@youthnet.pk`,
        isActive: u.isActive !== false,
        linkedAgentId: u.linkedAgentId,
        linkedCustomerId: u.linkedCustomerId,
        can_access_gis_map:
          typeof u.can_access_gis_map === 'boolean' ? u.can_access_gis_map : undefined,
        gis_map_permission: u.gis_map_permission
          ? normalizeGisMapPermission(u.gis_map_permission, u.can_access_gis_map, u.role)
          : undefined,
        permissions:
          u.permissions && typeof u.permissions === 'object' ? u.permissions : undefined,
        tier_level: u.tier_level ?? (u.role === 'DEALER' || u.role === 'SUB_DEALER' ? u.role : null),
        parent_dealer_id: u.parent_dealer_id ?? null,
        dealer_id: u.dealer_id ?? null,
        wallet_balance: Number(u.wallet_balance ?? 0),
        credit_limit: Number(u.credit_limit ?? 0),
        bandwidth_pool_cap_mbps: Number(u.bandwidth_pool_cap_mbps ?? u.assigned_pool_mbps ?? 0),
        max_active_users: Number(u.max_active_users ?? 0),
        can_create_subdealers: Boolean(u.can_create_subdealers),
        createdAt: u.createdAt || new Date().toISOString(),
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Get stored JWT auth token
 */
export function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed: any = JSON.parse(raw);
    return parsed.token || null;
  } catch {
    return null;
  }
}

/**
 * Save auth session to localStorage and track authentic session role
 */
export function saveAuthSession(token: string, user: UserAccount, isRoleSimulation = false): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(
      AUTH_STORAGE_KEY,
      JSON.stringify({
        token,
        user,
        username: user.username,
        role: user.role,
        fullName: user.fullName || user.displayName,
      })
    );
    if (!isRoleSimulation) {
      if (user.role === 'ADMIN') {
        sessionStorage.setItem('auth_original_role', 'ADMIN');
      } else {
        sessionStorage.setItem('auth_original_role', user.role);
      }
    }
  } catch {}
}

/**
 * Check if the active logged-in session was genuinely authenticated as ADMIN
 */
export function isOriginalAdminSession(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const role = sessionStorage.getItem('auth_original_role');
    if (!role) {
      const user = getStoredUser();
      if (user?.role === 'ADMIN') {
        sessionStorage.setItem('auth_original_role', 'ADMIN');
        return true;
      }
    }
    return role === 'ADMIN' || !role;
  } catch {
    return true;
  }
}

/**
 * Clear auth session from storage
 */
export function clearAuthSession(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(AUTH_STORAGE_KEY);
  sessionStorage.removeItem('auth_original_role');
  sessionStorage.clear();
  try {
    localStorage.removeItem('netpulse_active_subscriber_session');
    localStorage.removeItem('netpulse_agent_filter');
    window.dispatchEvent(new Event('youthnet_auth_changed'));
    window.dispatchEvent(new Event('storage'));
  } catch {}
}

/**
 * API Login Authentication Handler
 * Authenticates directly against Supabase PostgreSQL (portal_users) with repository & local fallbacks
 */
export async function apiLogin(
  username: string,
  password: string
): Promise<{ success: boolean; user?: UserAccount; token?: string; error?: string }> {
  const enteredUser = (username || '').trim().toLowerCase();
  const enteredPass = (password || '').trim();

  if (!enteredUser || !enteredPass) {
    return { success: false, error: 'Please enter both username and password.' };
  }

  const LEGACY_ADMIN_PASSWORDS = ['admin123', 'P@ssword', 'admin@123'];
  const isAdminIdentifier = enteredUser === 'admin' || enteredUser === 'admin@youthnet.pk';

  if (isAdminIdentifier && LEGACY_ADMIN_PASSWORDS.includes(enteredPass)) {
    storageService.logAuditEvent({
      actor: enteredUser,
      actorRole: 'SYSTEM',
      actionType: 'AUTH_FAILED',
      actionTitle: 'Rejected Deprecated Admin Password Attempt',
      severity: 'WARNING',
      details: `Deprecated admin password rejected for "${username}".`,
    });
    return { success: false, error: 'Invalid username or password. Please verify your credentials.' };
  }

  // 1. Direct Authentication against Supabase PostgreSQL portal_users table
  try {
    let { data: user, error } = await supabase
      .from('portal_users')
      .select('*')
      .ilike('username', enteredUser)
      .eq('password', enteredPass)
      .maybeSingle();

    // Check if short username (e.g. "hassnain") matches email in Supabase ("hassnain@youthnet.pk")
    if (!user && !enteredUser.includes('@')) {
      const { data: userEmailMatch } = await supabase
        .from('portal_users')
        .select('*')
        .ilike('username', `${enteredUser}@youthnet.pk`)
        .eq('password', enteredPass)
        .maybeSingle();
      if (userEmailMatch) {
        user = userEmailMatch;
      }
    }

    // Auto-migrate legacy Supabase portal_users admin row when signing in with Web@9595
    if (!user && isAdminIdentifier && enteredPass === 'Web@9595') {
      const { data: legacyAdmin } = await supabase
        .from('portal_users')
        .select('*')
        .ilike('username', 'admin')
        .maybeSingle();
      if (legacyAdmin && LEGACY_ADMIN_PASSWORDS.includes((legacyAdmin.password || '').trim())) {
        await supabase
          .from('portal_users')
          .update({ password: 'Web@9595' })
          .eq('id', legacyAdmin.id);
        user = { ...legacyAdmin, password: 'Web@9595' };
      }
    }

    if (user) {
      const resolvedRoleUpper = String(user.role || 'CLIENT').toUpperCase();
      const resolvedTierUpper = String(user.tier_level || '').toUpperCase();
      const effectiveRole: SystemRole =
        resolvedRoleUpper === 'DEALER' || resolvedTierUpper === 'DEALER'
          ? 'DEALER'
          : resolvedRoleUpper === 'SUB_DEALER' || resolvedTierUpper === 'SUB_DEALER'
          ? 'SUB_DEALER'
          : (resolvedRoleUpper as SystemRole);

      const userAccount: UserAccount = {
        id: user.id,
        username: user.username,
        fullName: user.full_name || user.username,
        displayName: user.full_name || user.username,
        phone: user.phone || '+92 300 0000000',
        role: effectiveRole,
        area: user.area || 'Central NOC Core',
        assignedArea: user.area || 'Central NOC Core',
        cashInHand: Number(user.cash_in_hand || 0),
        balance: Number(user.cash_in_hand || 0),
        email: user.username.includes('@') ? user.username : `${user.username}@youthnet.pk`,
        isActive: user.account_status !== 'SUSPENDED',
        can_access_gis_map:
          effectiveRole === 'ADMIN'
            ? true
            : effectiveRole === 'CLIENT'
            ? false
            : typeof user.can_access_gis_map === 'boolean'
            ? user.can_access_gis_map
            : normalizeGisMapPermission(user.gis_map_permission, user.can_access_gis_map, effectiveRole) !== 'none',
        gis_map_permission: normalizeGisMapPermission(
          user.gis_map_permission,
          user.can_access_gis_map,
          effectiveRole
        ),
        permissions:
          user.permissions && typeof user.permissions === 'object'
            ? user.permissions
            : resolveStaffPermissions(
                {
                  id: user.id,
                  username: user.username,
                  role: effectiveRole,
                  can_access_gis_map: user.can_access_gis_map,
                  gis_map_permission: user.gis_map_permission,
                },
                effectiveRole
              ),
        tier_level:
          resolvedTierUpper === 'DEALER' || resolvedTierUpper === 'SUB_DEALER' || resolvedTierUpper === 'MASTER'
            ? resolvedTierUpper
            : effectiveRole === 'DEALER' || effectiveRole === 'SUB_DEALER'
            ? effectiveRole
            : null,
        parent_dealer_id: user.parent_dealer_id || null,
        dealer_id: user.dealer_id || null,
        wallet_balance: Number(user.wallet_balance ?? 0),
        credit_limit: Number(user.credit_limit ?? 0),
        bandwidth_pool_cap_mbps: Number(user.bandwidth_pool_cap_mbps ?? user.assigned_pool_mbps ?? 0),
        max_active_users: Number(user.max_active_users ?? 0),
        can_create_subdealers: Boolean(user.can_create_subdealers),
        createdAt: user.created_at || new Date().toISOString(),
      };

      const token = `supabase_token_${Date.now()}_${user.id}`;
      saveAuthSession(token, userAccount);

      // Reconcile into local cache for offline availability
      try {
        saveUnifiedPortalUser({
          username: user.username,
          password: enteredPass,
          role: user.role,
          fullName: user.full_name || user.username,
          phone: user.phone,
          area: user.area,
          email: user.username.includes('@') ? user.username : `${user.username}@youthnet.pk`,
        });
      } catch {}

      storageService.logAuditEvent({
        actor: user.username,
        actorRole: user.role,
        actionType: 'AUTH_LOGIN',
        actionTitle: 'User Authenticated via Supabase PostgreSQL',
        target: getLandingRouteForRole(user.role),
        severity: 'SUCCESS',
        details: `Account @${user.username} (${user.role}) signed in successfully via Supabase.`,
      });

      return { success: true, user: userAccount, token };
    }
  } catch (sbErr) {
    console.warn('Supabase authentication check failed, trying local repository:', sbErr);
  }

  // 2. Authenticate against live local repository (USERS_STORAGE_KEY = 'youthnet_portal_users')
  // Also checks MikroTik secrets array if subscriber
  const repoResult = authenticateAgainstRepository(enteredUser, enteredPass);
  if (repoResult.success && repoResult.user) {
    saveAuthSession(repoResult.token || `session_${Date.now()}`, repoResult.user);
    storageService.logAuditEvent({
      actor: repoResult.user.username,
      actorRole: repoResult.user.role,
      actionType: 'AUTH_LOGIN',
      actionTitle: 'User Authenticated Session',
      target: getLandingRouteForRole(repoResult.user.role),
      severity: 'SUCCESS',
      details: `Account @${repoResult.user.username} signed in successfully.`,
    });
    return { success: true, user: repoResult.user, token: repoResult.token };
  }

  // 2. Fallback to server API if available
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: enteredUser, password: enteredPass }),
    });

    const data = await res.json();
    if (res.ok && data.success && data.user) {
      saveAuthSession(data.token, data.user);
      storageService.logAuditEvent({
        actor: data.user.username,
        actorRole: data.user.role,
        actionType: 'AUTH_LOGIN',
        actionTitle: 'User Authenticated Session',
        target: getLandingRouteForRole(data.user.role),
        severity: 'SUCCESS',
        details: `Account @${data.user.username} signed in successfully via server DB.`,
      });
      return { success: true, user: data.user, token: data.token };
    }
  } catch (err: any) {
    // Network or server offline - continue with repository error
  }

  // Log failed authentication attempt
  storageService.logAuditEvent({
    actor: enteredUser,
    actorRole: 'SYSTEM',
    actionType: 'AUTH_FAILED',
    actionTitle: 'Failed Authentication Attempt',
    severity: 'WARNING',
    details: `Failed sign-in attempt for username "${username}".`,
  });

  return { success: false, error: 'Invalid username or password. Please verify your credentials.' };
}

/**
 * API Logout call
 */
export async function apiLogout(): Promise<void> {
  try {
    const user = getStoredUser();
    if (user) {
      storageService.logAuditEvent({
        actor: user.username,
        actorRole: user.role,
        actionType: 'AUTH_LOGOUT',
        actionTitle: 'User Session Terminated',
        severity: 'INFO',
        details: `User @${user.username} logged out from active portal session.`,
      });
    }

    const token = getStoredToken();
    if (token) {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    }
  } catch {
    // ignore network errors on logout
  } finally {
    clearAuthSession();
  }
}
