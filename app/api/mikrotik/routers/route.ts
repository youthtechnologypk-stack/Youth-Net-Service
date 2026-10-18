import { getAllRouters, saveRouter } from '../../../../src/db/routerRepo';

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

export async function GET() {
  try {
    const routers = await getAllRouters();
    return new Response(JSON.stringify({ success: true, routers }), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Failed to fetch routers' }),
      { status: 500, headers: corsHeaders }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      name,
      host,
      ipAddress,
      port,
      apiPort,
      username,
      password,
      useSsl,
      model,
      version,
      location,
      wanInterface,
      walledGardenPool,
    } = body;

    const finalHost = (host || ipAddress || '').trim();
    const finalPort = Number(port || apiPort) || (useSsl ? 8729 : 8728);

    if (!name || !finalHost) {
      return new Response(
        JSON.stringify({ success: false, error: 'Router name and host IP are required.' }),
        { status: 400, headers: corsHeaders }
      );
    }

    const newRouter = {
      id: `r-${Date.now()}`,
      name: name.trim(),
      ipAddress: finalHost,
      apiPort: finalPort,
      username: (username || 'admin').trim(),
      useSsl: Boolean(useSsl),
      model: model || 'CCR2004-16G-2S+',
      version: version || 'RouterOS v7.16.2',
      location: location || 'Central Distribution Node',
      wanInterface: wanInterface || 'sfp-sfpplus1',
      walledGardenPool: walledGardenPool || '172.16.102.0/24',
      status: 'online' as const,
      cpuLoad: 14,
      memoryUsageMb: 512,
      totalMemoryMb: 4096,
      uptime: '1d 04:12:00',
      temperatureC: 42,
      activePppoeCount: 0,
      currentWanRxMbps: 0,
      currentWanTxMbps: 0,
      lastSeen: new Date().toISOString(),
    };

    const router = await saveRouter(newRouter, password || '');

    return new Response(
      JSON.stringify({
        success: true,
        router,
        message: `Router ${router.name} saved successfully.`,
      }),
      { status: 201, headers: corsHeaders }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Failed to save router' }),
      { status: 500, headers: corsHeaders }
    );
  }
}
