import { testMikrotikConnection } from '../../../../src/lib/mikrotikConnection';
import https from 'node:https';
import http from 'node:http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const corsHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const host = url.searchParams.get('host') || url.searchParams.get('ipAddress');
  const port = Number(url.searchParams.get('port') || url.searchParams.get('apiPort')) || 8728;
  const username = url.searchParams.get('username') || 'admin';
  const password = url.searchParams.get('password') || '';
  const useSsl = url.searchParams.get('useSsl') === 'true' || port === 8729 || port === 443;

  if (!host) {
    return new Response(
      JSON.stringify({
        success: true,
        service: 'YouthNet MikroTik Test API',
        runtime: 'Netlify / Next.js Serverless Node.js',
        status: 'online',
        supportedProtocols: ['RouterOS v7 Native HTTPS REST API (Port 443/8729)', 'RouterOS Binary API (Port 8728/8729)'],
      }),
      { status: 200, headers: corsHeaders }
    );
  }

  return runTest({ host, port, username, password, useSsl });
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { host, ipAddress, port, apiPort, username, password, useSsl } = body;

    const targetHost = (host || ipAddress || '').trim();
    const targetPort = Number(port || apiPort) || (useSsl ? 8729 : 8728);
    const targetUser = (username || 'admin').trim();

    if (!targetHost) {
      return new Response(
        JSON.stringify({
          success: false,
          status: 'unreachable',
          error: 'Host IP or hostname is required for connection testing.',
          message: 'Host IP or hostname cannot be empty.',
        }),
        { status: 400, headers: corsHeaders }
      );
    }

    return await runTest({
      host: targetHost,
      port: targetPort,
      username: targetUser,
      password: password || '',
      useSsl: Boolean(useSsl || targetPort === 8729 || targetPort === 443),
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        success: false,
        status: 'unreachable',
        error: err.message || 'Internal connection test failure',
        message: err.message || 'Internal connection test failure',
      }),
      { status: 500, headers: corsHeaders }
    );
  }
}

/**
 * Execute RouterOS Connection Test with REST API support for RouterOS v7.16+
 */
async function runTest(params: {
  host: string;
  port: number;
  username: string;
  password?: string;
  useSsl?: boolean;
}) {
  const startTime = Date.now();
  const { host, port, username, password, useSsl } = params;

  // 1. If SSL/TLS is checked, or if port is 443/8729/80, query RouterOS v7 native REST API first
  // This bypasses serverless raw socket blockades on Netlify / cloud environments!
  if (useSsl || port === 443 || port === 8729 || port === 80) {
    const portsToTry = port === 443 ? [443] : [port, 443];
    for (const tryPort of portsToTry) {
      try {
        const restResult = await fetchRouterOsRest(host, tryPort, username, password || '', 4000);
        if (restResult.success) {
          return new Response(
            JSON.stringify({
              ...restResult,
              latencyMs: Date.now() - startTime,
            }),
            { status: 200, headers: corsHeaders }
          );
        }
      } catch (restErr: any) {
        console.warn(`[Netlify REST probe] Failed on port ${tryPort}:`, restErr.message);
      }
    }
  }

  // 2. Execute standard binary & socket probe via testMikrotikConnection
  try {
    const result = await testMikrotikConnection({
      host,
      port,
      username,
      password: password || '',
      useSsl,
    });

    if (!result.success) {
      return new Response(
        JSON.stringify({
          success: false,
          status: 'unreachable',
          error: result.error || result.message,
          message: result.message,
          latencyMs: result.latencyMs,
          host,
          port,
        }),
        { status: 200, headers: corsHeaders }
      );
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        success: false,
        status: 'unreachable',
        error: err.message || 'Connection probe failed',
        message: err.message || 'Connection probe failed',
        latencyMs: Date.now() - startTime,
      }),
      { status: 200, headers: corsHeaders }
    );
  }
}

/**
 * Direct HTTPS/HTTP REST query to RouterOS v7.16+ endpoint (/rest/system/resource)
 */
function fetchRouterOsRest(
  host: string,
  port: number,
  username: string,
  password = '',
  timeoutMs = 4000
): Promise<{
  success: boolean;
  status: 'online' | 'unreachable';
  latencyMs: number;
  identity?: string;
  model?: string;
  version?: string;
  cpuLoad?: number;
  uptime?: string;
  memoryUsageMb?: number;
  totalMemoryMb?: number;
  activePppoeCount?: number;
  message: string;
  error?: string;
}> {
  return new Promise((resolve, reject) => {
    const isSsl = port === 443 || port === 8729 || port !== 80;
    const protocol = isSsl ? https : http;
    const auth = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
    const startTime = Date.now();

    const req = protocol.request(
      {
        hostname: host,
        port,
        path: '/rest/system/resource',
        method: 'GET',
        headers: {
          Authorization: auth,
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'YouthNet-NOC-Controller/v7',
        },
        timeout: timeoutMs,
        rejectUnauthorized: false, // RouterOS uses self-signed SSL certs
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          const latencyMs = Date.now() - startTime;
          if (res.statusCode === 200) {
            try {
              const json = JSON.parse(data);
              const model = json['board-name'] || json['platform'] || 'MikroTik RouterOS';
              const version = json['version'] ? `RouterOS v${json['version']}` : 'RouterOS v7.16';
              const cpuLoad = Number(json['cpu-load'] ?? 0);
              const uptime = String(json['uptime'] ?? '0m');
              const totalMem = Number(json['total-memory'] || 0);
              const freeMem = Number(json['free-memory'] || 0);
              const memoryUsageMb = Math.round((totalMem - freeMem) / (1024 * 1024));
              const totalMemoryMb = Math.round(totalMem / (1024 * 1024));

              resolve({
                success: true,
                status: 'online',
                latencyMs,
                identity: json['identity'] || 'MikroTik-Router',
                model,
                version,
                cpuLoad,
                uptime,
                memoryUsageMb,
                totalMemoryMb,
                activePppoeCount: 0,
                message: `Connected successfully to MikroTik router at ${host}:${port} via RouterOS v7 HTTPS REST API (Model: ${model}, ${version})`,
              });
            } catch {
              resolve({
                success: true,
                status: 'online',
                latencyMs,
                message: `Connected to ${host}:${port} (HTTP 200 OK)`,
              });
            }
          } else if (res.statusCode === 401) {
            resolve({
              success: false,
              status: 'unreachable',
              latencyMs,
              error: `Authentication failed: Invalid credentials for user "${username}" (HTTP 401 Unauthorized)`,
              message: `Authentication failed: Invalid credentials for user "${username}" (HTTP 401 Unauthorized)`,
            });
          } else if (res.statusCode === 403) {
            resolve({
              success: false,
              status: 'unreachable',
              latencyMs,
              error: `Access forbidden: User "${username}" lacks REST API policy permissions on MikroTik router.`,
              message: `Access forbidden: User "${username}" lacks REST API policy permissions on MikroTik router.`,
            });
          } else {
            reject(new Error(`RouterOS REST API returned HTTP ${res.statusCode} ${res.statusMessage || ''}`));
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`REST API timeout connecting to ${host}:${port} after ${timeoutMs}ms`));
    });

    req.on('error', (err) => reject(err));
    req.end();
  });
}
