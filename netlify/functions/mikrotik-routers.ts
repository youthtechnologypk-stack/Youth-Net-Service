import { INITIAL_ROUTERS } from '../../src/data/initialData';

const corsHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// In-memory router cache for serverless invocation lifetime
const deletedRouterIds = new Set<string>();
let serverlessRouters = [...INITIAL_ROUTERS];

export const handler = async (event: any) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: corsHeaders,
      body: '',
    };
  }

  if (event.httpMethod === 'GET') {
    const activeRouters = serverlessRouters.filter(
      (r) => !deletedRouterIds.has(r.id) && !deletedRouterIds.has(r.name) && !deletedRouterIds.has(r.ipAddress)
    );
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        routers: activeRouters,
      }),
    };
  }

  if (event.httpMethod === 'POST') {
    try {
      const body = event.body ? JSON.parse(event.body) : {};
      const {
        name,
        host,
        ipAddress,
        port,
        apiPort,
        username,
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
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'Router name and host IP are required.' }),
        };
      }

      const newRouter = {
        id: `r-${Date.now()}`,
        name: name.trim(),
        model: model || 'MikroTik Cloud Core Router',
        ipAddress: finalHost,
        apiPort: finalPort,
        useSsl: Boolean(useSsl),
        username: (username || 'admin').trim(),
        version: version || 'RouterOS v7.16',
        location: location || 'Sector Hub',
        status: 'online',
        cpuLoad: 12,
        memoryUsageMb: 512,
        totalMemoryMb: 4096,
        temperatureC: 41,
        activePppoeCount: 0,
        wanInterface: wanInterface || 'sfp-sfpplus1',
        walledGardenPool: walledGardenPool || '172.16.102.0/24',
        lastSeen: new Date().toISOString(),
      };

      serverlessRouters.push(newRouter as any);

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          router: newRouter,
          message: `Router ${newRouter.name} registered successfully.`,
        }),
      };
    } catch (err: any) {
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: err.message || 'Serverless router registration error' }),
      };
    }
  }

  if (event.httpMethod === 'DELETE') {
    try {
      const pathSegments = (event.path || '').split('/').filter(Boolean);
      const idFromPath = pathSegments[pathSegments.length - 1];
      const routerId = (event.queryStringParameters?.id || idFromPath || '').trim();

      if (!routerId || routerId === 'routers') {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'Router ID is required for deletion' }),
        };
      }

      deletedRouterIds.add(routerId);
      serverlessRouters = serverlessRouters.filter(
        (r) => r.id !== routerId && r.name !== routerId && r.ipAddress !== routerId
      );

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          message: `Router ${routerId} deleted successfully from serverless storage.`,
        }),
      };
    } catch (err: any) {
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: err.message || 'Serverless router delete error' }),
      };
    }
  }

  return {
    statusCode: 405,
    headers: corsHeaders,
    body: JSON.stringify({ success: false, error: 'Method not allowed' }),
  };
};
