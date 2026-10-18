import { SystemRole, UserAccount } from '../types/auth';

export interface AuthSessionData {
  token: string;
  user: UserAccount;
}

const AUTH_STORAGE_KEY = 'youthnet_auth_session';

/**
 * Default Landing Route by Role
 */
export function getLandingRouteForRole(role: SystemRole): string {
  switch (role) {
    case 'ADMIN':
      return '/dashboard/admin';
    case 'MANAGER':
      return '/dashboard/operations';
    case 'AGENT':
      return '/agent/portal';
    case 'CLIENT':
      return '/client/portal';
    default:
      return '/login';
  }
}

/**
 * Checks if a given role is permitted to access a specific feature/tab
 */
export function isRouteAllowedForRole(role: SystemRole, routeOrTab: string): boolean {
  if (role === 'ADMIN') {
    return true; // Complete unrestricted access
  }

  const clean = routeOrTab.toLowerCase().replace(/^\//, '');

  if (role === 'MANAGER') {
    // Allowed: NOC Command Center, Complaints & Ticketing SLA, Subscribers, Cash Overview
    // Strictly Hidden: hardware credentials/passwords, router deletion, system settings, global currency configs
    const managerAllowed = [
      'noc',
      'operations',
      'dashboard/operations',
      'complaints',
      'subscribers',
      'billing', // Can view collections & agent cash
      'olt', // Can view optical status
    ];
    // Explicitly forbidden for Manager
    const managerForbidden = ['settings', 'mikrotik', 'architecture'];
    if (managerForbidden.some((f) => clean.includes(f))) return false;
    return managerAllowed.some((a) => clean.includes(a));
  }

  if (role === 'AGENT') {
    // Allowed: /agent/portal, mobile simulator, tickets, cash collection, ont checker
    const agentAllowed = ['agent', 'agent/portal', 'mobile', 'tickets', 'collections', 'ont_checker'];
    return agentAllowed.some((a) => clean.includes(a));
  }

  if (role === 'CLIENT') {
    // Allowed: /client/portal, connection status, invoices, speed test, support
    const clientAllowed = ['client', 'client/portal', 'my_connection', 'my_invoices', 'my_support'];
    return clientAllowed.some((a) => clean.includes(a));
  }

  return false;
}

/**
 * Get current authenticated user from storage
 */
export function getStoredUser(): UserAccount | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed: AuthSessionData = JSON.parse(raw);
    return parsed.user || null;
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
    const parsed: AuthSessionData = JSON.parse(raw);
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
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ token, user }));
  if (!isRoleSimulation) {
    if (user.role === 'ADMIN') {
      sessionStorage.setItem('auth_original_role', 'ADMIN');
    } else {
      sessionStorage.setItem('auth_original_role', user.role);
    }
  }
}

/**
 * Check if the active logged-in session was genuinely authenticated as ADMIN
 */
export function isOriginalAdminSession(): boolean {
  if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') return false;
  return sessionStorage.getItem('auth_original_role') === 'ADMIN';
}

/**
 * Clear auth session from storage
 */
export function clearAuthSession(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(AUTH_STORAGE_KEY);
  sessionStorage.removeItem('auth_original_role');
}

/**
 * API Login call
 */
export async function apiLogin(
  username: string,
  password: string
): Promise<{ success: boolean; user?: UserAccount; token?: string; error?: string }> {
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, error: data.error || 'Authentication failed' };
    }

    saveAuthSession(data.token, data.user);
    return { success: true, user: data.user, token: data.token };
  } catch (err: any) {
    // Browser fallback for demo resilience
    const cleanUser = username.trim().toLowerCase();
    const cleanPass = password.trim();

    const matches: Record<string, { role: SystemRole; fullName: string; phone: string }> = {
      admin: { role: 'ADMIN', fullName: 'NOC Master Administrator', phone: '+92 300 1234567' },
      manager: { role: 'MANAGER', fullName: 'NOC Operations Manager', phone: '+92 301 9876543' },
      agent: { role: 'AGENT', fullName: 'Bilal Khan (Field Agent)', phone: '+92 301 5550192' },
      client: { role: 'CLIENT', fullName: 'Dr. Shahzad Rafique (Subscriber)', phone: '+92 300 5559812' },
    };

    const validPasswords: Record<string, string[]> = {
      admin: ['admin@123'],
      manager: ['mgr@123', 'manager@123'],
      agent: ['agent@123'],
      client: ['client@123'],
    };

    if (matches[cleanUser] && validPasswords[cleanUser]?.includes(cleanPass)) {
      const fallbackUser: UserAccount = {
        id: `usr-${cleanUser}-01`,
        username: cleanUser,
        fullName: matches[cleanUser].fullName,
        displayName: matches[cleanUser].fullName,
        phone: matches[cleanUser].phone,
        role: matches[cleanUser].role,
        isActive: true,
        createdAt: new Date().toISOString(),
      };
      const fallbackToken = `mock-token-${cleanUser}-${Date.now()}`;
      saveAuthSession(fallbackToken, fallbackUser);
      return { success: true, user: fallbackUser, token: fallbackToken };
    }

    return { success: false, error: 'Invalid username or password. Please check your credentials.' };
  }
}

/**
 * API Logout call
 */
export async function apiLogout(): Promise<void> {
  try {
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
