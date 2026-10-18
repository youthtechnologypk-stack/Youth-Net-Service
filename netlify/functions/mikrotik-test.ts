import https from 'node:https';
import http from 'node:http';

const corsHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export const handler = async (event: any) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: corsHeaders,
      body: '',
    };
  }

  try {
    let body: any = {};
    if (event.body) {
      try {
        body = JSON.parse(event.body);
      } catch {}
    }

    const host = (body.host || body.ipAddress || event.queryStringParameters?.host || '').trim();
    const port = Number(body.port || body.apiPort || event.queryStringParameters?.port) || 8728;
    const username = (body.username || event.queryStringParameters?.username || 'admin').trim();
    const password = body.password || event.queryStringParameters?.password || '';
    const useSsl = Boolean(body.useSsl || port === 8729 || port === 443);

    if (!host) {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          status: 'online',
          message: 'YouthNet Netlify Serverless Function is active.',
        }),
      };
    }

    const startTime = Date.now();

    // Probe RouterOS v7 REST API (e.g. port 443 or specified port)
    const restPorts = useSsl || port === 443 || port === 8729 ? (port === 443 ? [443] : [port, 443]) : [port, 443];

    for (const tryPort of restPorts) {
      try {
        const result = await probeRest(host, tryPort, username, password, 3500);
        if (result.success) {
          return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
              ...result,
              latencyMs: Date.now() - startTime,
            }),
          };
        }
      } catch {}
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: false,
        status: 'unreachable',
        latencyMs: Date.now() - startTime,
        host,
        port,
        message: `Cannot reach RouterOS at ${host}:${port}. Verify port forwarding or enable RouterOS v7 REST API (/ip service enable www-ssl).`,
        error: `Cannot reach RouterOS at ${host}:${port}.`,
      }),
    };
  } catch (err: any) {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: false,
        status: 'unreachable',
        error: err.message || 'Serverless probe error',
        message: err.message || 'Serverless probe error',
      }),
    };
  }
};

function probeRest(host: string, port: number, user: string, pass: string, timeoutMs = 3500): Promise<any> {
  return new Promise((resolve, reject) => {
    const isSsl = port === 443 || port === 8729 || port !== 80;
    const protocol = isSsl ? https : http;
    const auth = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
    const start = Date.now();

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
          'User-Agent': 'YouthNet-Netlify-Agent',
        },
        timeout: timeoutMs,
        rejectUnauthorized: false,
      },
      (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const j = JSON.parse(text);
              resolve({
                success: true,
                status: 'online',
                latencyMs: Date.now() - start,
                model: j['board-name'] || j['platform'] || 'MikroTik RouterOS',
                version: j['version'] ? `RouterOS v${j['version']}` : 'RouterOS v7.16',
                cpuLoad: Number(j['cpu-load'] ?? 0),
                uptime: String(j['uptime'] ?? '0m'),
                message: `Connected successfully to MikroTik router at ${host}:${port} via RouterOS v7 HTTPS REST API`,
              });
            } catch {
              resolve({ success: true, status: 'online', latencyMs: Date.now() - start, message: `Connected to ${host}:${port}` });
            }
          } else if (res.statusCode === 401) {
            resolve({
              success: false,
              status: 'unreachable',
              error: 'Authentication failed: Invalid credentials (HTTP 401)',
              message: 'Authentication failed: Invalid credentials (HTTP 401)',
            });
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
    req.on('error', reject);
    req.end();
  });
}
