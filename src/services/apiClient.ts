import {
  ActiveSession,
  MikrotikPppSecret,
  MikrotikPppProfile,
  RouterInterface,
  MikrotikRouter,
} from '../types/isp';

export interface RouterAuthInfo {
  id?: string;
  username?: string;
  password?: string;
  ip?: string;
  ipAddress?: string;
  port?: number;
  apiPort?: number;
  useSsl?: boolean;
  proxyMode?: 'proxy' | 'direct';
}

export type RouterProxyMode = 'proxy' | 'direct';

/**
 * Get active router proxy mode:
 * 'proxy' = Netlify Managed Proxy Mode (/api/mikrotik rewrite) - DEFAULT
 * 'direct' = Direct IP Mode (raw IP/port)
 */
export function getRouterProxyMode(router?: RouterAuthInfo): RouterProxyMode {
  if (router?.proxyMode) return router.proxyMode;
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('netpulse_router_proxy_mode');
    if (saved === 'direct' || saved === 'proxy') return saved;
  }
  return 'proxy'; // Default to "Netlify Managed Proxy Mode"
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  status: number;
  isSslOrCorsBlocked?: boolean;
  directCertUrl?: string;
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  router?: RouterAuthInfo;
  params?: Record<string, string | number | boolean>;
  timeoutMs?: number;
  body?: any;
}

/**
 * Resolve REST API host, port, SSL, and protocol strictly per RouterOS v7 specs.
 * DO NOT use port 8728 or 8729 for REST API calls. Strip any custom port :8729/:8728 automatically.
 */
export function resolveRestHostAndPort(router?: RouterAuthInfo): {
  host: string;
  port: number;
  useSsl: boolean;
  protocol: 'http' | 'https';
} {
  let rawHost = (router?.ip || router?.ipAddress || '202.142.186.150').trim();
  rawHost = rawHost.replace(/^https?:\/\//i, '');

  let embeddedPort: number | undefined;
  if (rawHost.includes(':')) {
    const parts = rawHost.split(':');
    rawHost = parts[0].trim();
    const p = parseInt(parts[1], 10);
    if (!isNaN(p)) embeddedPort = p;
  }

  // Strictly strip any lingering port suffix e.g. :443 or :80
  rawHost = rawHost.replace(/:\d+$/, '').trim();

  let useSsl = router?.useSsl ?? (embeddedPort === 443 || router?.port === 443 || router?.apiPort === 443);
  let targetPort = router?.port || router?.apiPort || embeddedPort;

  // Physical testbed router strictly serves RouterOS v7 REST on port 81 (HTTP)
  if (rawHost === '202.142.186.150') {
    targetPort = (targetPort && targetPort !== 443 && targetPort !== 8728 && targetPort !== 8729) ? targetPort : 81;
    useSsl = false;
  } else if (!targetPort || targetPort === 8728 || targetPort === 8729) {
    if (useSsl) {
      targetPort = 443;
    } else {
      targetPort = 80;
    }
  }

  const protocol: 'http' | 'https' = useSsl || targetPort === 443 || targetPort === 8443 ? 'https' : 'http';
  return { host: rawHost, port: targetPort, useSsl, protocol };
}

/**
 * Extract active router credentials from auth state or localStorage ('registered_routers')
 * Inherits credentials reliably across router switches
 */
export function getActiveRouterAuth(activeRouter?: RouterAuthInfo): {
  username: string;
  password: string;
  authHeader: string;
} {
  let username = activeRouter?.username?.trim() || '';
  let password = activeRouter?.password || '';

  if (typeof window !== 'undefined') {
    try {
      const selectedId = activeRouter?.id || localStorage.getItem('netpulse_selected_router_id');
      const raw = localStorage.getItem('registered_routers');
      if (raw) {
        const routers = JSON.parse(raw);
        if (Array.isArray(routers) && routers.length > 0) {
          const match = selectedId ? routers.find((r: any) => r.id === selectedId) : undefined;
          const target =
            match ||
            (activeRouter?.ip || activeRouter?.ipAddress
              ? routers.find(
                  (r: any) =>
                    r.ip === (activeRouter?.ip || activeRouter?.ipAddress) ||
                    r.ipAddress === (activeRouter?.ip || activeRouter?.ipAddress)
                )
              : undefined) ||
            routers[0];

          if (target) {
            if (!username) username = target.username || 'admin';
            if (!password && target.password !== undefined) password = target.password;
          }
        }
      }
    } catch {}
  }

  if (!username) username = 'admin';

  let authHeader = '';
  try {
    authHeader = 'Basic ' + btoa(`${username}:${password}`);
  } catch {
    try {
      authHeader = 'Basic ' + btoa(unescape(encodeURIComponent(`${username}:${password}`)));
    } catch {
      authHeader = 'Basic ' + btoa('admin:');
    }
  }

  return { username, password, authHeader };
}

/**
 * Returns the base URL for RouterOS REST API:
 * In browser: uses `/api/mikrotik` (proxied to RouterOS REST)
 * On server / node: uses standard HTTP/HTTPS with sanitized ports (443/80/81, never 8729)
 */
export function getBaseUrl(activeRouter?: RouterAuthInfo): string {
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/api/mikrotik`;
  }
  const { host, port, protocol } = resolveRestHostAndPort(activeRouter);
  return `${protocol}://${host}:${port}/rest`;
}

/**
 * Broadcast custom event for UI toast feedback on auth failure
 */
export function notifyAuthError(customMessage?: string) {
  const msg = customMessage || 'Action failed: Router authentication error. Please verify credentials.';
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('mikrotik_auth_error', {
        detail: { message: msg },
      })
    );
  }
}

/**
 * Cleanly parse RouterOS error message strings from JSON, HTML, or plain text
 */
function parseErrorMessage(status: number, rawText: string): string {
  if (!rawText) {
    if (status === 401) return 'Action failed: Router authentication error. Please verify credentials.';
    if (status === 404) return 'Requested RouterOS resource not found (HTTP 404)';
    if (status === 502) return 'Router gateway unreachable (HTTP 502)';
    return `Router returned HTTP ${status}`;
  }

  // 1. Try parsing JSON error body
  try {
    const parsed = JSON.parse(rawText);
    if (typeof parsed === 'string') return parsed;
    if (parsed.detail) return String(parsed.detail);
    if (parsed.error) return String(parsed.error);
    if (parsed.message) return String(parsed.message);
  } catch {}

  // 2. If HTML error response (e.g. Netlify 502/504 Bad Gateway), extract title
  if (rawText.includes('<html') || rawText.includes('<!DOCTYPE')) {
    const titleMatch = rawText.match(/<title>([^<]+)<\/title>/i);
    if (titleMatch && titleMatch[1]) {
      return `Upstream Gateway Error (${status}): ${titleMatch[1].trim()}`;
    }
    return `Upstream router proxy error (HTTP ${status})`;
  }

  // 3. Plain text error
  return rawText.length > 250 ? `${rawText.slice(0, 250)}...` : rawText;
}

/**
 * Centralized API Client with Request & Response Interceptors
 */
class ApiClient {
  /**
   * Request Interceptor:
   * Normalizes endpoint, attaches router credentials, anti-caching headers,
   * sets credentials: 'omit' to strictly suppress native browser Basic Auth modal,
   * and attaches AbortController timeout.
   */
  private async executeRequest<T = any>(
    endpoint: string,
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    bodyData?: any,
    options: RequestOptions = {}
  ): Promise<ApiResponse<T>> {
    // Resolve active router and auth
    let effectiveRouter = options.router;
    if (!effectiveRouter && typeof window !== 'undefined') {
      try {
        const selectedId = localStorage.getItem('netpulse_selected_router_id');
        const raw = localStorage.getItem('registered_routers');
        if (raw) {
          const routers = JSON.parse(raw);
          if (Array.isArray(routers) && routers.length > 0) {
            effectiveRouter = selectedId ? routers.find((r: any) => r.id === selectedId) || routers[0] : routers[0];
          }
        }
      } catch {}
    }

    const proxyMode = getRouterProxyMode(effectiveRouter);
    const auth = getActiveRouterAuth(effectiveRouter);
    const resolved = resolveRestHostAndPort(effectiveRouter);

    // Normalize endpoint path: ensure leading slash and strip duplicate /rest/ or /api/mikrotik/
    let cleanEndpoint = endpoint.trim();
    if (cleanEndpoint.startsWith('/api/mikrotik/')) {
      cleanEndpoint = cleanEndpoint.replace(/^\/api\/mikrotik\//, '/');
    } else if (cleanEndpoint.startsWith('/api/mikrotik')) {
      cleanEndpoint = cleanEndpoint.replace(/^\/api\/mikrotik/, '/');
    }
    if (cleanEndpoint.startsWith('/rest/')) {
      cleanEndpoint = cleanEndpoint.replace(/^\/rest\//, '/');
    } else if (cleanEndpoint.startsWith('rest/')) {
      cleanEndpoint = cleanEndpoint.replace(/^rest\//, '/');
    }
    if (!cleanEndpoint.startsWith('/')) {
      cleanEndpoint = `/${cleanEndpoint}`;
    }

    // 1. ROUTE ALL ROUTEROS REST CALLS THROUGH REVERSE PROXY:
    // Default to 'Netlify Managed Proxy Mode' (/api/mikrotik/*)
    // Only use direct IP if user explicitly switched to 'direct'
    let fullUrl: string;
    if (proxyMode === 'direct') {
      fullUrl = `${resolved.protocol}://${resolved.host}:${resolved.port}/rest${cleanEndpoint}`;
    } else {
      fullUrl = `/api/mikrotik${cleanEndpoint}`;
    }

    // Append query params if provided
    if (options.params) {
      const searchParams = new URLSearchParams();
      Object.entries(options.params).forEach(([key, val]) => {
        if (val !== undefined && val !== null) {
          searchParams.append(key, String(val));
        }
      });
      const qs = searchParams.toString();
      if (qs) {
        fullUrl += (fullUrl.includes('?') ? '&' : '?') + qs;
      }
    }

    // 2. ATTACH EXPLICIT PROXY HEADERS
    const incomingHeaders = (options.headers as Record<string, string>) || {};
    const headers: Record<string, string> = {
      Authorization: auth.authHeader,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Connection: 'close',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
      'x-router-host': resolved.host,
      'x-router-ip': resolved.host,
      'x-router-port': String(resolved.port),
      'x-router-ssl': resolved.useSsl ? 'true' : 'false',
      'x-router-id': effectiveRouter?.id || '',
      ...incomingHeaders,
    };

    // Timeout and AbortController integration
    const timeoutMs = options.timeoutMs || 8000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    if (options.signal) {
      options.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    const fetchInit: RequestInit = {
      method,
      headers,
      signal: controller.signal,
      // CRITICAL: 'omit' prevents modern browsers from triggering the native HTTP Basic Auth modal on 401
      credentials: 'omit',
      mode: proxyMode === 'direct' ? 'cors' : 'same-origin',
    };

    if (bodyData !== undefined && method !== 'GET') {
      fetchInit.body = typeof bodyData === 'string' ? bodyData : JSON.stringify(bodyData);
    }

    let response: Response;
    try {
      response = await fetch(fullUrl, fetchInit);
    } catch (networkErr: any) {
      clearTimeout(timeoutId);
      if (networkErr?.name === 'AbortError' || options.signal?.aborted) {
        return {
          success: false,
          status: 0,
          error: 'Aborted',
          message: 'Request was cancelled',
        };
      }

      const isTypeError =
        networkErr instanceof TypeError ||
        (networkErr?.message || '').toLowerCase().includes('failed to fetch') ||
        (networkErr?.message || '').toLowerCase().includes('networkerror');

      const directCertUrl = `https://${resolved.host}:${resolved.port}/rest/system/resource`;
      let errMsg = networkErr.message || 'Network connection failure';
      if (isTypeError) {
        errMsg =
          'Browser blocked self-signed SSL. [Click here to authorize certificate in new tab], then click Retry Sync.';
      }

      return {
        success: false,
        status: 0,
        error: errMsg,
        message: errMsg,
        isSslOrCorsBlocked: isTypeError,
        directCertUrl,
      };
    }

    clearTimeout(timeoutId);

    // Response Interceptor: 401 Unauthorized handling
    if (response.status === 401) {
      notifyAuthError('Action failed: Router authentication error. Please verify credentials.');
      return {
        success: false,
        status: 401,
        error: 'Action failed: Router authentication error. Please verify credentials.',
        message: 'Action failed: Router authentication error. Please verify credentials.',
      };
    }

    // Response Interceptor: Non-2xx (4xx, 5xx) handling
    if (!response.ok) {
      const rawText = await response.text().catch(() => '');
      const errMsg = parseErrorMessage(response.status, rawText);
      return {
        success: false,
        status: response.status,
        error: errMsg,
        message: errMsg,
      };
    }

    // Response Interceptor: 2xx Success handling
    if (response.status === 204) {
      return {
        success: true,
        status: response.status,
        data: {} as T,
        message: 'Success',
      };
    }

    try {
      const data = await response.json();
      return {
        success: true,
        status: response.status,
        data: data as T,
        message: 'Success',
      };
    } catch {
      return {
        success: true,
        status: response.status,
        data: {} as T,
        message: 'Success',
      };
    }
  }

  // Public HTTP Verbs
  public get<T = any>(endpoint: string, options?: RequestOptions): Promise<ApiResponse<T>> {
    return this.executeRequest<T>(endpoint, 'GET', undefined, options);
  }

  public post<T = any>(endpoint: string, body?: any, options?: RequestOptions): Promise<ApiResponse<T>> {
    return this.executeRequest<T>(endpoint, 'POST', body, options);
  }

  public patch<T = any>(endpoint: string, body?: any, options?: RequestOptions): Promise<ApiResponse<T>> {
    return this.executeRequest<T>(endpoint, 'PATCH', body, options);
  }

  public put<T = any>(endpoint: string, body?: any, options?: RequestOptions): Promise<ApiResponse<T>> {
    return this.executeRequest<T>(endpoint, 'PUT', body, options);
  }

  public delete<T = any>(endpoint: string, options?: RequestOptions): Promise<ApiResponse<T>> {
    return this.executeRequest<T>(endpoint, 'DELETE', options?.body, options);
  }

  public request<T = any>(endpoint: string, options?: RequestOptions): Promise<ApiResponse<T>> {
    const method = (options?.method?.toUpperCase() as any) || 'GET';
    return this.executeRequest<T>(endpoint, method, options?.body, options);
  }
}

export const apiClient = new ApiClient();

/* =========================================================================
   REFACTORED ENDPOINT SERVICES (Centralized, Cleanly Typed)
   ========================================================================= */

/**
 * 1. getActiveSessions() -> GET /ppp/active
 * Fetches real-time PPPoE sessions with raw uptime and internal RouterOS .id
 */
export async function getActiveSessions(
  router?: RouterAuthInfo,
  signal?: AbortSignal
): Promise<{ success: boolean; activeSessions: ActiveSession[]; error?: string }> {
  const res = await apiClient.get<any[]>('/ppp/active', { router, signal });

  if (!res.success) {
    return {
      success: false,
      activeSessions: [],
      error: res.error || res.message,
    };
  }

  const rawSessions = Array.isArray(res.data) ? res.data : [];
  const activeSessions: ActiveSession[] = rawSessions.map((s: any, idx: number) => {
    const rxRate = s['rx-rate'] ? Number(s['rx-rate']) / 1_000_000 : 0;
    const txRate = s['tx-rate'] ? Number(s['tx-rate']) / 1_000_000 : 0;

    // Check for standard RouterOS v7 properties:
    // - bytes (often formatted as rx-bytes/tx-bytes e.g., "15423456/98765432")
    // - Direct properties: item['rx-byte'] || item['bytes-in'] || item['bytes']?.split('/')[0] || 0
    // - Direct properties: item['tx-byte'] || item['bytes-out'] || item['bytes']?.split('/')[1] || 0
    let rawBytesIn = 0;
    let rawBytesOut = 0;
    if (s.bytes && typeof s.bytes === 'string' && s.bytes.includes('/')) {
      const parts = s.bytes.split('/');
      rawBytesIn = Number(parts[0]) || 0;
      rawBytesOut = Number(parts[1]) || 0;
    } else {
      rawBytesIn = Number(s['rx-byte'] || s['bytes-in'] || s['rx-bytes'] || (typeof s.bytes === 'string' ? s.bytes.split('/')[0] : 0) || 0);
      rawBytesOut = Number(s['tx-byte'] || s['bytes-out'] || s['tx-bytes'] || (typeof s.bytes === 'string' ? s.bytes.split('/')[1] : 0) || 0);
    }

    const gbIn = (Number(rawBytesIn) / (1024 * 1024 * 1024)).toFixed(2);
    const gbOut = (Number(rawBytesOut) / (1024 * 1024 * 1024)).toFixed(2);
    const bytesIn = Math.round(rawBytesIn / 1_000_000);
    const bytesOut = Math.round(rawBytesOut / 1_000_000);
    const internalId = s['.id'] || s.id || `*${idx + 1}`;

    return {
      id: internalId,
      '.id': s['.id'] || internalId,
      username: s.name || s.user || `user-${idx}`,
      callerId: s['caller-id'] || s.callerId || '00:00:00:00:00:00',
      address: s.address || '0.0.0.0',
      service: 'pppoe',
      uptime: s.uptime || '0s',
      rxRateMbps: Number(rxRate.toFixed(2)),
      txRateMbps: Number(txRate.toFixed(2)),
      bytesInMb: bytesIn,
      bytesOutMb: bytesOut,
      rawBytesIn,
      rawBytesOut,
      gbIn,
      gbOut,
      routerId: router?.id || '',
      customerName: s.name || s.user || `User ${idx + 1}`,
      profileName: s.profile || 'default',
      liveRateFormatted: `↓ ${rxRate.toFixed(1)}M / ↑ ${txRate.toFixed(1)}M`,
    };
  });

  return {
    success: true,
    activeSessions,
  };
}

/**
 * 2. getProvisionedSecrets() -> GET /ppp/secret
 * Fetches all registered subscriber secrets
 */
export async function getProvisionedSecrets(
  router?: RouterAuthInfo,
  signal?: AbortSignal
): Promise<{ success: boolean; secrets: MikrotikPppSecret[]; error?: string }> {
  const res = await apiClient.get<any[]>('/ppp/secret', { router, signal });

  if (!res.success) {
    return {
      success: false,
      secrets: [],
      error: res.error || res.message,
    };
  }

  const rawSecrets = Array.isArray(res.data) ? res.data : [];
  const secrets: MikrotikPppSecret[] = rawSecrets.map((s: any, idx: number) => ({
    '.id': s['.id'] || s.id || `*${idx}`,
    name: s.name || s.user || '',
    password: s.password || '',
    service: s.service || 'pppoe',
    profile: s.profile || 'default',
    comment: s.comment || '',
    disabled: s.disabled === true || s.disabled === 'true',
    'remote-address': s['remote-address'] || s.remoteAddress || '',
    'local-address': s['local-address'] || s.localAddress || '',
    'last-logged-out': s['last-logged-out'] || '',
  }));

  return {
    success: true,
    secrets,
  };
}

/**
 * 3. getBandwidthProfiles() -> GET /ppp/profile
 * Fetches bandwidth profiles from RouterOS
 */
export async function getBandwidthProfiles(
  router?: RouterAuthInfo,
  signal?: AbortSignal
): Promise<{
  success: boolean;
  profiles: Array<{ id: string; name: string; rateLimit?: string }>;
  rawProfiles: MikrotikPppProfile[];
  error?: string;
}> {
  const res = await apiClient.get<any[]>('/ppp/profile', { router, signal });

  if (!res.success) {
    return {
      success: false,
      profiles: [],
      rawProfiles: [],
      error: res.error || res.message,
    };
  }

  const raw = Array.isArray(res.data) ? res.data : [];
  const profiles = raw.map((p: any) => ({
    id: p['.id'] || p.id || p.name,
    name: p.name || 'default',
    rateLimit: p['rate-limit'] || p.rateLimit || undefined,
  }));

  const rawProfiles: MikrotikPppProfile[] = raw.map((p: any) => ({
    '.id': p['.id'] || p.id || p.name,
    name: p.name || 'default',
    'local-address': p['local-address'] || '',
    'remote-address': p['remote-address'] || '',
    'rate-limit': p['rate-limit'] || '',
    'dns-server': p['dns-server'] || '',
    'only-one': p['only-one'] || '',
    comment: p.comment || '',
  }));

  return {
    success: true,
    profiles,
    rawProfiles,
  };
}

/**
 * 4. kickSession(id) -> POST /ppp/active/remove with body { ".id": id }
 * RouterOS v7 strictly expects { ".id": session[".id"] }
 */
export async function kickSession(
  sessionIdOrName: string,
  router?: RouterAuthInfo
): Promise<{ success: boolean; error?: string }> {
  if (!sessionIdOrName) {
    return { success: false, error: 'Session ID is required' };
  }

  // RouterOS v7 strictly expects body: { ".id": id }
  const res = await apiClient.post('/ppp/active/remove', { '.id': sessionIdOrName }, { router });

  if (res.success) {
    return { success: true };
  }

  // Fallback to DELETE /ppp/active/:id if remove endpoint returned 404 or 405
  if (res.status === 404 || res.status === 405) {
    const fallbackRes = await apiClient.delete(`/ppp/active/${encodeURIComponent(sessionIdOrName)}`, { router });
    if (fallbackRes.success) {
      return { success: true };
    }
    return { success: false, error: fallbackRes.error || fallbackRes.message };
  }

  return { success: false, error: res.error || res.message };
}

/**
 * 5. createSecret(payload) -> POST /ppp/secret/add
 * Provisions new subscriber secret on RouterOS
 */
export async function createSecret(
  payload: {
    name: string;
    password: string;
    service?: string;
    profile?: string;
    comment?: string;
    remoteAddress?: string;
  },
  router?: RouterAuthInfo
): Promise<{ success: boolean; data?: any; error?: string }> {
  const body: Record<string, any> = {
    name: payload.name.trim(),
    password: payload.password,
    service: payload.service || 'pppoe',
    profile: payload.profile || 'default',
  };

  if (payload.comment) body.comment = payload.comment;
  if (payload.remoteAddress) body['remote-address'] = payload.remoteAddress;

  const res = await apiClient.post('/ppp/secret/add', body, { router });

  if (res.success) {
    return { success: true, data: res.data };
  }

  return { success: false, error: res.error || res.message };
}

/**
 * 6. createScheduler(payload) -> POST /system/scheduler/add
 * Schedules automatic router-level expiry
 */
export async function createScheduler(
  payload: {
    name: string;
    startDate: string; // e.g. "nov/02/2026"
    startTime: string; // e.g. "14:30:00"
    interval?: string; // "0s"
    onEvent: string; // RouterOS command script
    comment?: string;
  },
  router?: RouterAuthInfo
): Promise<{ success: boolean; data?: any; error?: string }> {
  const body = {
    name: payload.name,
    'start-date': payload.startDate,
    'start-time': payload.startTime,
    interval: payload.interval || '0s',
    'on-event': payload.onEvent,
    comment: payload.comment || `Auto-expiry schedule for ${payload.name}`,
  };

  const res = await apiClient.post('/system/scheduler/add', body, { router });

  if (res.success) {
    return { success: true, data: res.data };
  }

  return { success: false, error: res.error || res.message };
}

/**
 * 7. removeSecret(id) -> POST /ppp/secret/remove with { ".id": id }
 */
export async function removeSecret(
  secretIdOrName: string,
  router?: RouterAuthInfo
): Promise<{ success: boolean; error?: string }> {
  if (!secretIdOrName) {
    return { success: false, error: 'Secret identifier required' };
  }

  const res = await apiClient.post('/ppp/secret/remove', { '.id': secretIdOrName }, { router });

  if (res.success) {
    return { success: true };
  }

  // Fallback to DELETE /ppp/secret/:id
  if (res.status === 404 || res.status === 405) {
    const fallbackRes = await apiClient.delete(`/ppp/secret/${encodeURIComponent(secretIdOrName)}`, { router });
    if (fallbackRes.success) {
      return { success: true };
    }
    return { success: false, error: fallbackRes.error || fallbackRes.message };
  }

  return { success: false, error: res.error || res.message };
}

/**
 * 8. updateSecret(id, updates) -> POST /ppp/secret/set
 */
export async function updateSecret(
  secretIdOrName: string,
  updates: {
    profile?: string;
    remoteAddress?: string;
    comment?: string;
    disabled?: boolean | string;
    password?: string;
  },
  router?: RouterAuthInfo
): Promise<{ success: boolean; data?: any; error?: string }> {
  const bodyData: Record<string, any> = {
    '.id': secretIdOrName,
    numbers: secretIdOrName,
  };
  if (updates.profile) bodyData.profile = updates.profile;
  if (updates.remoteAddress) bodyData['remote-address'] = updates.remoteAddress;
  if (updates.comment !== undefined) bodyData.comment = updates.comment;
  if (updates.disabled !== undefined) bodyData.disabled = String(updates.disabled);
  if (updates.password) bodyData.password = updates.password;

  const res = await apiClient.post('/ppp/secret/set', bodyData, { router });

  if (res.success) {
    return { success: true, data: res.data };
  }

  // Fallback to PATCH /ppp/secret/:id
  if (res.status === 404 || res.status === 405) {
    const fallbackRes = await apiClient.patch(`/ppp/secret/${encodeURIComponent(secretIdOrName)}`, bodyData, { router });
    if (fallbackRes.success) {
      return { success: true, data: fallbackRes.data };
    }
    return { success: false, error: fallbackRes.error || fallbackRes.message };
  }

  return { success: false, error: res.error || res.message };
}

/**
 * 9. monitorInterfaceTraffic(interfaceName) -> POST /interface/monitor-traffic
 */
export async function monitorInterfaceTrafficRest(
  router?: RouterAuthInfo,
  interfaceName: string = 'WAN3',
  signal?: AbortSignal
): Promise<{ success: boolean; rxMbps: number; txMbps: number; error?: string }> {
  const res = await apiClient.post<any[]>(
    '/interface/monitor-traffic',
    { interface: interfaceName, once: 'yes' },
    { router, signal, timeoutMs: 3000 }
  );

  if (!res.success) {
    return { success: false, rxMbps: 0, txMbps: 0, error: res.error };
  }

  const raw = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!raw) {
    return { success: false, rxMbps: 0, txMbps: 0 };
  }

  const rxBps = Number(raw['rx-bits-per-second'] || raw['rx-bps'] || 0);
  const txBps = Number(raw['tx-bits-per-second'] || raw['tx-bps'] || 0);

  return {
    success: true,
    rxMbps: Math.round((rxBps / 1_000_000) * 10) / 10,
    txMbps: Math.round((txBps / 1_000_000) * 10) / 10,
  };
}
