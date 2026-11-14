import { syncSessionsFromMikrotik } from '../../src/server/sessionGeneratorEngine';

interface NetlifyEvent {
  httpMethod?: string;
  headers?: Record<string, string | undefined>;
  queryStringParameters?: Record<string, string | undefined> | null;
  body?: string | null;
  isBase64Encoded?: boolean;
}

export const config = {
  schedule: '*/2 * * * *',
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, x-router-host, x-router-ip, x-router-port, x-router-ssl, x-router-id',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Cache-Control': 'no-cache, no-store, must-revalidate',
};

function parseBody(event: NetlifyEvent): Record<string, any> {
  if (!event.body) return {};
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export const handler = async (event: NetlifyEvent = {}) => {
  const method = (event.httpMethod || 'GET').toUpperCase();

  if (method === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: CORS_HEADERS,
      body: '',
    };
  }

  const headers = event.headers || {};
  const body = method === 'POST' ? parseBody(event) : {};
  const query = event.queryStringParameters || {};

  const routerHost =
    body.routerHost ||
    headers['x-router-host'] ||
    headers['x-router-ip'] ||
    query.host;
  const rawPort =
    body.routerPort ||
    headers['x-router-port'] ||
    query.port;
  const routerPort = rawPort ? Number(rawPort) : undefined;
  const sslVal =
    body.useSsl ??
    headers['x-router-ssl'] ??
    query.useSsl;
  const useSsl = sslVal === true || sslVal === 'true';
  const authHeader =
    headers.authorization ||
    headers.Authorization;

  const result = await syncSessionsFromMikrotik({
    routerHost: routerHost ? String(routerHost) : undefined,
    routerPort: routerPort && !Number.isNaN(routerPort) ? routerPort : undefined,
    useSsl,
    authHeader,
    username: body.username ? String(body.username) : undefined,
    password: body.password !== undefined ? String(body.password) : undefined,
    activeSessions: Array.isArray(body.activeSessions) ? body.activeSessions : undefined,
  });

  return {
    statusCode: result.success ? 200 : 502,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(result),
  };
};
