import { getSubscriberInterfaceTraffic } from '@/src/lib/mikrotikConnection';
import { getRouterCredentials, getAllRouters } from '@/src/db/routerRepo';

/**
 * Route Handler: GET & POST /api/mikrotik/subscriber-traffic
 * Queries real-time RouterOS interface telemetry for open subscriber drawer:
 * 1. Dynamic Interface Resolution: `<pppoe-USERNAME>`
 * 2. Real-Time Monitor: `/interface/monitor-traffic interface=<pppoe-USERNAME> once=true`
 * 3. Graceful fallback: `/queue/simple/print` bytes-rate or active session telemetry
 */
export async function GET(req: Request) {
  return handleSubscriberTraffic(req);
}

export async function POST(req: Request) {
  return handleSubscriberTraffic(req);
}

async function handleSubscriberTraffic(req: Request) {
  try {
    const url = new URL(req.url);
    let username = url.searchParams.get('username') || '';
    let routerId = url.searchParams.get('routerId') || url.searchParams.get('id') || '';

    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      if (body.username) username = body.username;
      if (body.routerId) routerId = body.routerId;
    }

    if (!username) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Username is required',
          rxMbps: 0,
          txMbps: 0,
          downloadRateMbps: 0,
          uploadRateMbps: 0,
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Resolve Router Credentials
    let creds: any = null;
    if (routerId) {
      creds = await getRouterCredentials(routerId);
    }
    if (!creds || !creds.password) {
      const routers = await getAllRouters();
      for (const r of routers) {
        const c = await getRouterCredentials(r.id);
        if (c && c.password) {
          creds = c;
          break;
        }
      }
    }

    // Default connection parameters
    const connParams = {
      host: creds?.host || '202.142.186.150',
      port: creds?.port || 8728,
      username: creds?.username || 'admin',
      password: creds?.password || 'P@ssword@9595',
      useSsl: creds?.useSsl,
    };

    const result = await getSubscriberInterfaceTraffic(connParams, username);

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        success: false,
        error: err?.message || 'Failed to fetch subscriber traffic',
        rxMbps: 0,
        txMbps: 0,
        downloadRateMbps: 0,
        uploadRateMbps: 0,
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
