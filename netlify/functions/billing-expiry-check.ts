import { runExpirySweep } from '../../src/server/expirySweepEngine';

interface NetlifyEvent {
  httpMethod?: string;
  headers?: Record<string, string | undefined>;
  body?: string | null;
}

const CORS_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, x-router-host, x-router-ip, x-router-port, x-router-ssl, x-router-id',
  'Cache-Control': 'no-cache, no-store, must-revalidate',
};

export const config = {
  // Scheduled daily at 09:00 UTC = 2:00 PM PKT (UTC+5)
  schedule: '0 9 * * *',
};

export async function handler(event: NetlifyEvent = {}) {
  const method = String(event.httpMethod || 'POST').toUpperCase();

  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  let body: Record<string, any> = {};
  if (event.body) {
    try {
      body = JSON.parse(event.body);
    } catch {}
  }

  const headers = event.headers || {};
  const routerHost =
    body.routerHost ||
    headers['x-router-host'] ||
    headers['x-router-ip'] ||
    headers['X-Router-Host'] ||
    undefined;
  const rawPort =
    body.routerPort || headers['x-router-port'] || headers['X-Router-Port'] || undefined;
  const routerPort = rawPort ? Number(rawPort) : undefined;
  const rawSsl = body.useSsl ?? headers['x-router-ssl'] ?? headers['X-Router-Ssl'];
  const useSsl = rawSsl === true || rawSsl === 'true';
  const authHeader = headers['authorization'] || headers['Authorization'] || undefined;

  const isScheduled = !event.httpMethod;
  const triggeredBy =
    body.triggeredBy || (isScheduled ? 'CRON_2PM' : 'ADMIN');

  try {
    const result = await runExpirySweep({
      routerHost: routerHost ? String(routerHost) : undefined,
      routerPort: routerPort && !Number.isNaN(routerPort) ? routerPort : undefined,
      useSsl,
      authHeader,
      triggeredBy,
    });

    return {
      statusCode: result.success ? 200 : 500,
      headers: CORS_HEADERS,
      body: JSON.stringify(result),
    };
  } catch (err: any) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: false,
        errors: [err?.message || 'Expiry sweep execution failed'],
      }),
    };
  }
}
