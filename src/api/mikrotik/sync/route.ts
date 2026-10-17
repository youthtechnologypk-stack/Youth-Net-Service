import { syncMikrotikLive } from '@/src/lib/mikrotikConnection';
import { getRouterCredentials, updateRouterTelemetry } from '@/src/db/routerRepo';

/**
 * Next.js / Modular Route Handler: GET & POST /api/mikrotik/sync
 * Real Live Sync from physical MikroTik RouterOS v7 device:
 * - /system/identity/print
 * - /system/resource/print
 * - /ppp/active/print (real active PPPoE sessions)
 * - /interface/monitor-traffic (real live WAN traffic)
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const url = new URL(req.url);
    const routerId = body.routerId || url.searchParams.get('routerId');

    let targetHost = body.host || body.ipAddress;
    let targetPort = Number(body.port || body.apiPort) || 8728;
    let targetUser = body.username;
    let targetPassword = body.password;
    let targetUseSsl = body.useSsl;
    let targetWan = body.wanInterface;

    if (routerId) {
      const creds = await getRouterCredentials(routerId);
      if (creds) {
        targetHost = targetHost || creds.host;
        targetPort = targetPort || creds.port;
        targetUser = targetUser || creds.username;
        targetPassword = targetPassword !== undefined ? targetPassword : creds.password;
        targetUseSsl = targetUseSsl !== undefined ? targetUseSsl : creds.useSsl;
        targetWan = targetWan || creds.wanInterface;
      }
    }

    if (!targetHost) {
      return new Response(
        JSON.stringify({
          success: false,
          status: 'unreachable',
          error: 'Router host / IP address is required for live sync.',
          activeSessions: [],
          traffic: { rxMbps: 0, txMbps: 0, timestamp: new Date().toISOString() },
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const syncResult = await syncMikrotikLive({
      host: targetHost,
      port: targetPort,
      username: targetUser || 'admin',
      password: targetPassword || '',
      useSsl: targetUseSsl,
      wanInterface: targetWan || 'ether1',
    });

    if (!syncResult.success) {
      if (routerId) {
        await updateRouterTelemetry(routerId, {
          status: 'unreachable',
          currentWanRxMbps: 0,
          currentWanTxMbps: 0,
        }).catch(() => {});
      }

      return new Response(
        JSON.stringify({
          success: false,
          error: syncResult.error || 'ROUTER_UNREACHABLE',
          message: syncResult.message || `Could not connect to router ${targetHost} on port ${targetPort}`,
          host: targetHost,
          port: targetPort,
          activeSessions: [],
          secrets: [],
          profiles: [],
        }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (routerId && syncResult.router) {
      await updateRouterTelemetry(routerId, {
        status: syncResult.status,
        cpuLoad: syncResult.router.cpuLoad,
        memoryUsageMb: syncResult.router.memoryUsageMb,
        totalMemoryMb: syncResult.router.totalMemoryMb,
        uptime: syncResult.router.uptime,
        activePppoeCount: syncResult.activeSessions.length,
        currentWanRxMbps: syncResult.traffic.rxMbps,
        currentWanTxMbps: syncResult.traffic.txMbps,
        version: syncResult.router.version,
        model: syncResult.router.model,
      }).catch(() => {});
    }

    return new Response(JSON.stringify(syncResult), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'ROUTER_UNREACHABLE',
        message: err.message || 'Could not connect to router on port 8728',
        activeSessions: [],
        secrets: [],
        profiles: [],
      }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

export async function GET(req: Request) {
  return POST(req);
}
