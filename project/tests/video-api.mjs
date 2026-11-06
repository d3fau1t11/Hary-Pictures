import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../netlify/functions/videoUpload.ts';
const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
const admin = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let user, calls, referenced, broken;
beforeEach(() => {
  Object.assign(process.env, { MUX_TOKEN_ID: 'fixture-id', MUX_TOKEN_SECRET: 'fixture-secret', MUX_ADMIN_USER_IDS: admin, VITE_SUPABASE_URL: 'https://fixture.supabase.co', VITE_SUPABASE_ANON_KEY: 'fixture-anon' });
  user = admin; calls = []; referenced = false; broken = false;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), ...options });
    if (String(url).includes('/auth/v1/user')) return Response.json({ id: user });
    if (String(url).includes('/rest/v1/')) return Response.json(referenced ? [{ id: 'record' }] : []);
    assert(String(url).startsWith('https://api.mux.com/video/v1/'));
    if (broken) throw new Error('fixture-secret: provider failure');
    if (String(url).endsWith('/uploads') && options.method === 'POST') return Response.json({ data: { id: 'upload123', url: 'https://storage.googleapis.com/fixture' } });
    if (String(url).includes('/uploads/')) return Response.json({ data: { id: 'upload123', asset_id: 'asset123', status: 'asset_created' } });
    if (String(url).endsWith('/assets') && options.method === 'POST') return Response.json({ data: { id: 'asset123' } });
    if (options.method === 'DELETE') return new Response(null, { status: 204 });
    if (String(url).includes('/playback-ids/')) return Response.json({ data: { object: { id: 'asset123', type: 'asset' } } });
    return Response.json({ data: { id: 'asset123', status: 'ready', passthrough: 'hary:' + admin, playback_ids: [{ id: 'playback123', policy: 'public' }] } });
  };
});
afterEach(() => { globalThis.fetch = originalFetch; process.env = { ...originalEnv }; });
function req(body, headers = {}) { return new Request('https://harypictures.netlify.app/.netlify/functions/videoUpload', { method: 'POST', headers: { origin: 'https://harypictures.netlify.app', 'content-type': 'application/json', authorization: 'Bearer fixture-token', ...headers }, body: JSON.stringify(body) }); }
test('fails closed for missing configuration, foreign origins and non-admin signups', async () => {
  assert.equal((await handler(req({ action: 'create', name: 'Film' }, { origin: 'https://other.netlify.app' }))).status, 403);
  assert.equal((await handler(req({}, { authorization: '' }))).status, 401);
  user = 'unapproved-user';
  assert.equal((await handler(req({ action: 'create', name: 'Film' }))).status, 403);
  assert(!calls.some(call => call.url.includes('api.mux.com')));
  delete process.env.MUX_TOKEN_SECRET;
  assert.equal((await handler(req({ action: 'create', name: 'Film' }))).status, 503);
});
test('creates basic-quality direct uploads and binds status tickets to the approved user', async () => {
  const response = await handler(req({ action: 'create', name: 'A film' }));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert(!JSON.stringify(data).includes('fixture-secret'));
  const create = calls.find(call => call.url.endsWith('/uploads'));
  assert.equal(JSON.parse(create.body).new_asset_settings.video_quality, 'basic');
  assert.equal(JSON.parse(create.body).cors_origin, 'https://harypictures.netlify.app');
  const ready = await handler(req({ action: 'status', ticket: data.ticket }));
  assert.deepEqual(await ready.json(), { state: 'ready', url: 'https://stream.mux.com/playback123.m3u8' });
  assert.equal((await handler(req({ action: 'status', ticket: data.ticket + 'tampered' }))).status, 403);
  process.env.MUX_ADMIN_USER_IDS += ',second-admin'; user = 'second-admin';
  assert.equal((await handler(req({ action: 'status', ticket: data.ticket }))).status, 403);
});
test('imports only referenced videos from this Supabase bucket', async () => {
  for (const url of ['https://evil.test/video.mp4', 'https://fixture.supabase.co/storage/v1/object/public/other/video.mp4', 'https://fixture.supabase.co/storage/v1/object/public/pictures/private.txt']) {
    assert.equal((await handler(req({ action: 'import', url }))).status, 400);
  }
  const url = 'https://fixture.supabase.co/storage/v1/object/public/pictures/public/films/video.mp4';
  assert.equal((await handler(req({ action: 'import', url }))).status, 400);
  referenced = true;
  const response = await handler(req({ action: 'import', url }));
  assert.equal(response.status, 200);
  assert((await response.json()).ticket);
});
test('never deletes a referenced video and redacts provider failures', async () => {
  referenced = true;
  assert.equal((await handler(req({ action: 'delete', playbackId: 'playback123' }))).status, 409);
  assert(!calls.some(call => call.method === 'DELETE'));
  referenced = false;
  assert.equal((await handler(req({ action: 'delete', playbackId: 'playback123' }))).status, 200);
  assert(calls.some(call => call.method === 'DELETE' && call.url.endsWith('/assets/asset123')));
  broken = true;
  const failed = await handler(req({ action: 'create', name: 'Film' }));
  assert.equal(failed.status, 502);
  assert(!(await failed.text()).includes('fixture-secret'));
});
test('rejects oversized and malformed bodies before provider work', async () => {
  assert.equal((await handler(req({ name: 'x'.repeat(9000) }))).status, 413);
  assert.equal((await handler(req([], {}))).status, 400);
  assert(!calls.length);
});
