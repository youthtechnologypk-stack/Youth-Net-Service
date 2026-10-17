import { testMikrotikConnection } from '@/src/lib/mikrotikConnection';

/**
 * Next.js / Express Route Handler: POST /api/mikrotik/test
 * Perform real RouterOS v7 connection & health test against physical MikroTik device
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { host, ipAddress, port, apiPort, username, password, useSsl } = body;

    const targetHost = (host || ipAddress || '').trim();
    const targetPort = Number(port || apiPort) || 8728;
    const targetUser = (username || 'admin').trim();

    if (!targetHost) {
      return new Response(
        JSON.stringify({
          success: false,
          status: 'unreachable',
          error: 'Host IP or hostname is required for connection testing.',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const result = await testMikrotikConnection({
      host: targetHost,
      port: targetPort,
      username: targetUser,
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
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        success: false,
        status: 'unreachable',
        error: err.message || 'Internal connection test failure',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
