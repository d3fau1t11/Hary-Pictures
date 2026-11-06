import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import handler, { config } from '../netlify/functions/sendTelegram.ts';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
afterEach(() => { globalThis.fetch = originalFetch; process.env = { ...originalEnv }; });

const origin = 'https://harypictures.netlify.app';
function request(body = { message: 'A photography inquiry' }, options = {}) {
  return new Request(origin + config.path, {
    method: 'POST', body: JSON.stringify(body),
    ...options,
    headers: { origin, 'content-type': 'application/json', ...options.headers },
  });
}
function mockTelegram() {
  process.env.TELEGRAM_BOT_TOKEN = 'fixture-only-token';
  process.env.TELEGRAM_CHAT_IDS = 'fixture-chat-a,fixture-chat-b';
  const calls = [];
  globalThis.fetch = async (_url, options) => {
    calls.push(JSON.parse(options.body));
    assert(options.signal instanceof AbortSignal);
    return Response.json({ ok: true });
  };
  return calls;
}

test('denies absent, foreign, spoofed and local production origins before delivery', async () => {
  const calls = mockTelegram();
  delete process.env.NETLIFY_DEV;
  for (const value of ['', 'null', 'https://other.netlify.app', origin + '.evil.test', origin + '/path', 'http://localhost:8888']) {
    const response = await handler(request(undefined, { headers: { origin: value } }));
    assert.equal(response.status, 403, value);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  }
  assert.equal(calls.length, 0);
});

test('allows only the explicitly configured deployment and development origins', async () => {
  mockTelegram();
  process.env.DEPLOY_PRIME_URL = 'https://deploy-preview-1--harypictures.netlify.app';
  process.env.NETLIFY_DEV = 'true';
  for (const value of [process.env.DEPLOY_PRIME_URL, 'http://localhost:8888']) {
    const response = await handler(request(undefined, { headers: { origin: value } }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), value);
  }
});

test('checks method, preflight, media type, JSON shape and size', async () => {
  const calls = mockTelegram();
  assert.equal((await handler(request(undefined, { method: 'OPTIONS', body: undefined }))).status, 204);
  assert.equal((await handler(request(undefined, { method: 'GET', body: undefined }))).status, 405);
  assert.equal((await handler(request(undefined, { headers: { 'content-type': 'text/plain' } }))).status, 415);
  assert.equal((await handler(request(undefined, { body: '{' }))).status, 400);
  for (const body of [null, [], {}, { message: 5 }, { message: ' ' }, { message: 'x'.repeat(4001) }, { message: 'hi', chat_id: 'other' }]) {
    assert.equal((await handler(request(body))).status, 400);
  }
  assert.equal((await handler(request(undefined, { body: 'x'.repeat(20_001) }))).status, 413);
  assert.equal((await handler(request(undefined, { headers: { 'content-length': '20001' } }))).status, 413);
  assert.equal(calls.length, 0);
});

test('sends plain text to server-configured recipients without leaking identifiers', async () => {
  const calls = mockTelegram();
  const message = '[misleading link](https://example.test) <b>hello</b>';
  const response = await handler(request({ message }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.text, message);
    assert.equal(call.parse_mode, undefined);
    assert.equal(call.disable_web_page_preview, true);
  }
});

test('redacts provider errors and timeout exceptions; handles partial failure', async () => {
  mockTelegram();
  globalThis.fetch = async () => { throw new Error('fixture-only-token fixture-chat-a'); };
  const response = await handler(request());
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'Notification could not be delivered' });
  globalThis.fetch = async () => Response.json({ ok: false, description: 'fixture-chat-a' }, { status: 400 });
  assert.equal((await handler(request())).status, 502);
  let count = 0;
  globalThis.fetch = async () => Response.json({ ok: ++count > 1 });
  assert.equal((await handler(request())).status, 200);
  delete process.env.TELEGRAM_BOT_TOKEN;
  assert.equal((await handler(request())).status, 503);
});

test('deployment policy covers rate limits, HTML routes, admin caching and structured data', () => {
  assert.equal(config.path, '/.netlify/functions/sendTelegram');
  assert.deepEqual(config.rateLimit, { windowLimit: 5, windowSize: 180, aggregateBy: ['ip', 'domain'] });
  const headers = readFileSync('public/_headers', 'utf8').replaceAll('\r\n', '\n');
  const csp = headers.match(/Content-Security-Policy: (.*)/)[1];
  const script = csp.match(/script-src ([^;]+)/)[1];
  assert(!script.includes('unsafe-inline') && !script.includes('unsafe-eval'));
  for (const directive of ["object-src 'none'", "frame-ancestors 'none'", "form-action 'self'", 'blob:']) assert(csp.includes(directive));
  assert.match(headers, /\/admin\n\s+Cache-Control: no-store\n\s+X-Robots-Tag: noindex/);
  assert.match(headers, /\/admin\/\*\n\s+Cache-Control: no-store/);
  const html = readFileSync('index.html', 'utf8').replaceAll('\r\n', '\n');
  const jsonLd = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
  assert(script.includes('sha256-' + createHash('sha256').update(jsonLd).digest('base64')));
  const netlify = readFileSync('netlify.toml', 'utf8');
  assert(!netlify.includes('TELEGRAM_BOT_TOKEN') && !netlify.includes('TELEGRAM_CHAT_IDS'));
  assert(!netlify.includes('[[headers]]'), 'Keep headers in one source of truth');
});
