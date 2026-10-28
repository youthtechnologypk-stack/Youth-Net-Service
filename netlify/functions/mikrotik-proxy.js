const https = require('https');

// Ignore self-signed certificate from MikroTik in Node native fetch
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const agent = new https.Agent({
  rejectUnauthorized: false // Ignore self-signed cert from MikroTik
});

const corsHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: corsHeaders,
      body: ''
    };
  }

  // Handle both /.netlify/functions/mikrotik-proxy/<splat> and /api/mikrotik/<splat>
  let subpath = (event.path || '')
    .replace('/.netlify/functions/mikrotik-proxy', '')
    .replace('/api/mikrotik', '');

  if (!subpath.startsWith('/')) {
    subpath = '/' + subpath;
  }

  const queryStr = event.rawQuery
    ? `?${event.rawQuery}`
    : event.queryStringParameters && Object.keys(event.queryStringParameters).length > 0
    ? '?' + new URLSearchParams(event.queryStringParameters).toString()
    : '';

  const url = `https://202.142.186.150:8729/rest${subpath}${queryStr}`;

  const authHeader = event.headers['authorization'] || event.headers['Authorization'] || '';
  const acceptHeader = event.headers['accept'] || event.headers['Accept'] || 'application/json';

  try {
    const fetchOptions = {
      method: event.httpMethod || 'GET',
      headers: {
        'Authorization': authHeader,
        'Accept': acceptHeader,
        'Content-Type': 'application/json'
      },
      agent
    };

    if (event.body && (event.httpMethod === 'POST' || event.httpMethod === 'PUT' || event.httpMethod === 'PATCH')) {
      fetchOptions.body = event.body;
    }

    const response = await fetch(url, fetchOptions);
    const data = await response.text();

    return {
      statusCode: response.status,
      body: data,
      headers: corsHeaders
    };
  } catch (err) {
    return {
      statusCode: 502,
      body: JSON.stringify({ error: err.message, targetUrl: url }),
      headers: corsHeaders
    };
  }
};
