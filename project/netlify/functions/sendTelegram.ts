import type { Config } from '@netlify/functions';

// Applied by Netlify at the edge, shared across function instances.
export const config: Config = {
  path: '/.netlify/functions/sendTelegram',
  rateLimit: { windowLimit: 5, windowSize: 180, aggregateBy: ['ip', 'domain'] },
};

const MAX_BODY_BYTES = 20_000;

function isOriginAllowed(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.origin !== origin) return false;
    const local = process.env.NETLIFY_DEV === 'true' && url.protocol === 'http:' &&
      ['localhost', '127.0.0.1'].includes(url.hostname);
    if (local) return true;
    if (url.protocol !== 'https:') return false;
    // Exact deployment origins only; never trust every Netlify site or preview.
    const allowed = ['https://harypictures.netlify.app', process.env.URL,
      process.env.DEPLOY_PRIME_URL, ...(process.env.ALLOWED_ORIGINS || '').split(',')];
    return allowed.some(value => value?.trim() === origin);
  } catch {
    return false;
  }
}

export default async function handler(request: Request): Promise<Response> {
  const origin = request.headers.get('origin') || '';
  const allowed = isOriginAllowed(origin);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Vary': 'Origin',
  };
  if (allowed) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
  }
  const reply = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers });
  if (!allowed) return reply(403, { error: 'Forbidden' });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') {
    headers.Allow = 'POST, OPTIONS';
    return reply(405, { error: 'Method not allowed' });
  }
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return reply(415, { error: 'Expected application/json' });
  }
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) {
    return reply(413, { error: 'Request too large' });
  }

  let body: unknown;
  try {
    const reader = request.body?.getReader();
    if (!reader) return reply(400, { error: 'Message is required' });
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return reply(413, { error: 'Request too large' });
      }
      chunks.push(value);
    }
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return reply(400, { error: 'Invalid JSON body' });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      !('message' in body) || typeof body.message !== 'string' ||
      !body.message.trim() || body.message.length > 4000 ||
      Object.keys(body).some(key => key !== 'message')) {
    return reply(400, { error: 'Provide a message of 1 to 4000 characters' });
  }
  const message = body.message.trim();
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chats = [...new Set((process.env.TELEGRAM_CHAT_IDS || '').split(',').map(id => id.trim()).filter(Boolean))];
  if (!token || !chats.length) return reply(503, { error: 'Notification service unavailable' });

  const deliveries = await Promise.all(chats.map(async chatId => {
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(8000),
        // Plain text prevents user input from becoming Telegram markup.
        body: JSON.stringify({ chat_id: chatId, text: message, disable_web_page_preview: true }),
      });
      const data: unknown = await response.json();
      return response.ok && typeof data === 'object' && data !== null && 'ok' in data && data.ok === true;
    } catch {
      // Upstream errors may contain the token-bearing URL. Never log or return them.
      return false;
    }
  }));
  return deliveries.some(Boolean)
    ? reply(200, { success: true })
    : reply(502, { error: 'Notification could not be delivered' });
}
