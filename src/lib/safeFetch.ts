/**
 * NetPulse Safe Fetch & JSON Safeguard
 * 
 * Prevents: "Unexpected token '<', '<!doctype '... is not valid JSON"
 * Inspects `response.headers.get("content-type")` before executing `response.json()`.
 * If response is HTML or malformed, catches gracefully and provides a clean structured payload.
 */

export interface SafeFetchResult<T = any> {
  ok: boolean;
  status: number;
  data: T;
  isJson: boolean;
  error?: string;
}

/**
 * Safely parse a fetch Response object, checking content-type header first
 */
export async function safeResponseJson<T = any>(
  response: Response,
  fallbackData?: Partial<T>
): Promise<T> {
  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.toLowerCase().includes('application/json');

  if (!isJson) {
    const text = await response.text();
    const cleanPreview = text.slice(0, 150).replace(/\s+/g, ' ').trim();
    
    // Graceful error message if serverless host returns 404 HTML fallback
    let errorMessage = `API returned non-JSON response (${contentType || 'text/html'}) [HTTP ${response.status}]: ${cleanPreview || 'Empty/HTML body'}`;
    if (response.status === 404 || cleanPreview.toLowerCase().includes('not found') || cleanPreview.toLowerCase().includes('<!doctype')) {
      errorMessage = 'Backend API route not deployed on this host. Run locally or configure Netlify Next.js runtime.';
    }
    
    console.warn('[SafeFetch Safeguard] Non-JSON payload intercepted:', errorMessage);
    
    return {
      success: false,
      status: 'unreachable',
      is404: response.status === 404,
      isHtmlFallback: true,
      error: errorMessage,
      message: errorMessage,
      ...(fallbackData || {}),
    } as unknown as T;
  }

  try {
    const data = await response.json();
    return data as T;
  } catch (parseError: any) {
    const errorMessage = `JSON parse failed [HTTP ${response.status}]: ${parseError.message}`;
    console.warn('[SafeFetch Safeguard] JSON parse error:', errorMessage);
    
    return {
      success: false,
      error: errorMessage,
      message: errorMessage,
      ...(fallbackData || {}),
    } as unknown as T;
  }
}

/**
 * Safe fetch wrapper that handles non-JSON responses and network failures gracefully
 */
export async function safeFetchJson<T = any>(
  input: RequestInfo | URL,
  init?: RequestInit,
  fallbackData?: Partial<T>
): Promise<SafeFetchResult<T>> {
  try {
    const response = await fetch(input, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init?.headers || {}),
      },
    });

    const contentType = response.headers.get('content-type') || '';
    const isJson = contentType.toLowerCase().includes('application/json');

    if (!isJson) {
      const text = await response.text();
      const cleanPreview = text.slice(0, 150).replace(/\s+/g, ' ').trim();
      const errorMsg = `Endpoint returned non-JSON payload (${contentType || 'text/html'}) [HTTP ${response.status}]: ${cleanPreview}`;
      
      console.warn(`[SafeFetch Safeguard] ${typeof input === 'string' ? input : 'request'} returned non-JSON:`, errorMsg);

      return {
        ok: false,
        status: response.status,
        isJson: false,
        error: errorMsg,
        data: {
          success: false,
          error: errorMsg,
          message: errorMsg,
          ...(fallbackData || {}),
        } as unknown as T,
      };
    }

    try {
      const data = await response.json();
      return {
        ok: response.ok,
        status: response.status,
        isJson: true,
        data,
        error: response.ok ? undefined : (data?.error || data?.message || `HTTP ${response.status}`),
      };
    } catch (parseErr: any) {
      const errorMsg = `Invalid JSON response: ${parseErr.message}`;
      return {
        ok: false,
        status: response.status,
        isJson: false,
        error: errorMsg,
        data: {
          success: false,
          error: errorMsg,
          ...(fallbackData || {}),
        } as unknown as T,
      };
    }
  } catch (networkErr: any) {
    const errorMsg = networkErr.message || 'Network request failed';
    console.error(`[SafeFetch Network Failure]:`, errorMsg);
    
    return {
      ok: false,
      status: 0,
      isJson: false,
      error: errorMsg,
      data: {
        success: false,
        status: 'unreachable',
        error: errorMsg,
        ...(fallbackData || {}),
      } as unknown as T,
    };
  }
}
