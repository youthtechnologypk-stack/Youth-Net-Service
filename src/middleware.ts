import { isRouteAllowedForRole, getStoredToken, getStoredUser } from './lib/auth';
import { SystemRole } from './types/auth';

export interface RouteCheckResult {
  authorized: boolean;
  status: 200 | 401 | 403;
  redirectTo?: string;
  reason?: string;
}

/**
 * Route Protection Guard
 * Evaluates whether the current session has permission to access the target pathname
 */
export function checkRouteAccess(pathname: string, userRole?: SystemRole | null): RouteCheckResult {
  const cleanPath = pathname.toLowerCase().replace(/^\//, '');

  // 1. Public routes (e.g. login, api routes)
  if (cleanPath === 'login' || cleanPath.startsWith('api/auth') || cleanPath === '') {
    return { authorized: true, status: 200 };
  }

  // 2. Authentication check
  if (!userRole) {
    return {
      authorized: false,
      status: 401,
      redirectTo: '/login',
      reason: 'Authentication required. Please log in.',
    };
  }

  // 3. Strict RBAC path protection
  // Admin only paths
  if (
    cleanPath.includes('dashboard/admin') ||
    cleanPath.includes('mikrotik') ||
    cleanPath.includes('settings') ||
    cleanPath.includes('architecture')
  ) {
    if (userRole !== 'ADMIN') {
      return {
        authorized: false,
        status: 403,
        redirectTo: userRole === 'MANAGER' ? '/dashboard/operations' : userRole === 'AGENT' ? '/agent/portal' : '/client/portal',
        reason: 'Access Denied: 403 Forbidden. This area requires Master Administrator privileges.',
      };
    }
  }

  // Manager or Admin paths
  if (cleanPath.includes('dashboard/operations') || cleanPath.includes('operations')) {
    if (userRole !== 'ADMIN' && userRole !== 'MANAGER') {
      return {
        authorized: false,
        status: 403,
        redirectTo: userRole === 'AGENT' ? '/agent/portal' : '/client/portal',
        reason: 'Access Denied: 403 Forbidden. NOC Operations view requires Manager or Admin role.',
      };
    }
  }

  // General check via helper
  const isAllowed = isRouteAllowedForRole(userRole, cleanPath);
  if (!isAllowed) {
    return {
      authorized: false,
      status: 403,
      redirectTo: userRole === 'ADMIN' ? '/dashboard/admin' : userRole === 'MANAGER' ? '/dashboard/operations' : userRole === 'AGENT' ? '/agent/portal' : '/client/portal',
      reason: `Access Denied: 403 Forbidden. Your role (${userRole}) is not authorized to view this resource.`,
    };
  }

  return { authorized: true, status: 200 };
}

/**
 * Next.js / Server style middleware handler export
 */
export default function middleware(request: { nextUrl: { pathname: string }; cookies?: any }) {
  const pathname = request.nextUrl.pathname;
  const user = getStoredUser();
  return checkRouteAccess(pathname, user?.role);
}
