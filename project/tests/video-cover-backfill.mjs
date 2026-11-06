import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backfillVideoCovers } from '../scripts/backfill-video-covers.mjs';
const base = 'https://fixture.supabase.co';
const row = { id: 'video-1', source: base + '/storage/v1/object/public/pictures/film.mp4', url: 'https://stream.mux.com/playback123.m3u8', state: 'ready', duration: 30 };
const current = [{ id: row.id, image_url: row.source }];
const key = 'fixture-secret';
const webp = Buffer.from('RIFF0000WEBPfixture');
test('fills missing covers without modifying records or overwriting stored covers', async () => {
  let stored = false;
  const calls = [];
  const request = async (url, options = {}) => {
    calls.push({ url: String(url), ...options });
    if (new URL(url).hostname === 'image.mux.com') { assert.equal(options.headers, undefined); return new Response(webp); }
    if (options.method === 'POST') { assert.equal(options.headers['x-upsert'], 'false'); stored = true; return Response.json({}); }
    return stored ? new Response(webp) : Response.json({ statusCode: '404', message: 'Object not found' }, { status: 400 });
  };
  assert.deepEqual(await backfillVideoCovers([row], { base, key, current, request }), [{ id: row.id, state: 'created' }]);
  assert.deepEqual(await backfillVideoCovers([row], { base, key, current, request }), [{ id: row.id, state: 'preserved' }]);
  assert.equal(calls.filter(call => call.method === 'POST').length, 1);
  assert.equal(calls.find(call => call.method === 'POST').url, base + '/storage/v1/object/pictures/film.mp4.poster.webp');
  assert(!calls.some(call => call.url.includes('/rest/v1/')));
});
test('skips records that changed and preserves custom covers', async () => {
  let calls = 0;
  const request = async () => { calls++; return new Response(webp); };
  assert.deepEqual(await backfillVideoCovers([row], { base, key, current: [], request }), []);
  assert.equal(calls, 0);
  assert.deepEqual(await backfillVideoCovers([row], { base, key, current, request }), [{ id: row.id, state: 'preserved' }]);
  assert.equal(calls, 1);
});
test('does not mistake authentication failures for missing covers', async () => {
  await assert.rejects(backfillVideoCovers([row], { base, key, current, request: async () => Response.json({ message: 'Not allowed' }, { status: 403 }) }), /confirm/);
});
test('rejects invalid thumbnails and sources before writing', async () => {
  await assert.rejects(backfillVideoCovers([{ ...row, url: 'https://other.test/video.m3u8' }], { base, key, current }), /source/);
  await assert.rejects(backfillVideoCovers([row], { base, key, current, request: async url => new URL(url).hostname === 'image.mux.com' ? new Response('<html>Error</html>') : Response.json({}, { status: 404 }) }), /WebP/);
});
