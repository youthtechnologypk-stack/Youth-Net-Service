import {
  processIncomingWhatsAppMessage,
  verifyWebhookChallenge,
} from '../../src/server/whatsappBotEngine';

interface NetlifyEvent {
  httpMethod: string;
  headers?: Record<string, string | undefined>;
  queryStringParameters?: Record<string, string | undefined> | null;
  body?: string | null;
  isBase64Encoded?: boolean;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Hub-Signature-256',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function parseBody(event: NetlifyEvent): any {
  if (!event.body) return {};
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;

  const contentType =
    event.headers?.['content-type'] || event.headers?.['Content-Type'] || '';

  if (contentType.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(raw);
    const obj: Record<string, string> = {};
    params.forEach((v, k) => {
      obj[k] = v;
    });
    return obj;
  }

  try {
    return JSON.parse(raw);
  } catch {
    // Fallback URL-encoded parse
    const params = new URLSearchParams(raw);
    const obj: Record<string, string> = {};
    params.forEach((v, k) => {
      obj[k] = v;
    });
    return obj;
  }
}

export const handler = async (event: NetlifyEvent) => {
  const method = (event.httpMethod || 'GET').toUpperCase();

  if (method === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: CORS_HEADERS,
      body: '',
    };
  }

  if (method === 'GET') {
    const query = event.queryStringParameters || {};
    const verification = await verifyWebhookChallenge(query);
    return {
      statusCode: verification.statusCode,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'text/plain; charset=utf-8',
      },
      body: verification.body,
    };
  }

  if (method === 'POST') {
    try {
      const payload = parseBody(event);
      const result = await processIncomingWhatsAppMessage(payload);

      // Twilio form-urlencoded expects TwiML XML response
      const contentType =
        event.headers?.['content-type'] || event.headers?.['Content-Type'] || '';
      if (
        result.provider === 'twilio' &&
        contentType.includes('application/x-www-form-urlencoded')
      ) {
        const twiml = result.reply
          ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(
              result.reply
            )}</Message></Response>`
          : '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
        return {
          statusCode: 200,
          headers: {
            ...CORS_HEADERS,
            'Content-Type': 'text/xml; charset=utf-8',
          },
          body: twiml,
        };
      }

      return {
        statusCode: 200,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(result),
      };
    } catch (err: any) {
      console.error('[netlify/whatsapp-webhook] Error:', err);
      return {
        statusCode: 500,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          success: false,
          error: err?.message || 'WhatsApp webhook processing error',
        }),
      };
    }
  }

  return {
    statusCode: 405,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ success: false, error: 'Method Not Allowed' }),
  };
};
