import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer';

const base = process.env.MEDIA_TEST_URL || 'http://127.0.0.1:5174';
const output = path.resolve('test-results/media');
await fs.mkdir(output, { recursive: true });
const browser = await puppeteer.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync) });
const page = await browser.newPage();
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const user = { id: owner, aud: 'authenticated', role: 'authenticated', email: 'studio@example.test', created_at: new Date().toISOString(), app_metadata: {}, user_metadata: {} };
const token = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url') + '.' + Buffer.from(JSON.stringify({ sub: owner, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' })).toString('base64url') + '.test';
const categories = [{ id: 'films', name_am: 'Films', slug: 'films' }, { id: 'hero', name_am: 'Hero', slug: 'hero' }];
let media = [];
const requests = [], errors = [];
let videoBytes = Buffer.alloc(0), videoType = 'video/webm', ready = false, failSave = false, jobs = 0;
const poster = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8l8AAAAASUVORK5CYII=', 'base64');
page.on('pageerror', error => errors.push(error.message));
await page.setRequestInterception(true);
page.on('request', async request => {
  const url = new URL(request.url());
  const method = request.method();
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS', 'Access-Control-Expose-Headers': 'Content-Range,Range' };
  const respond = (body, status = 200, extra = {}) => request.respond({ status, headers: { ...headers, ...extra }, contentType: 'application/json', body: JSON.stringify(body) });
  try {
    let body = {};
    try { body = JSON.parse(request.postData() || '{}'); } catch {}
    if (url.pathname.endsWith('/.netlify/functions/videoUpload')) {
      requests.push({ path: url.pathname, method, body });
      if (body.action === 'create') { jobs++; return respond({ ticket: 'fixture-ticket-' + jobs, url: 'https://storage.googleapis.com/fixture-upload/' + jobs }); }
      if (body.action === 'import') { jobs++; return respond({ ticket: 'fixture-ticket-' + jobs }); }
      if (body.action === 'status') return respond(ready ? { state: 'ready', url: 'https://stream.mux.com/fixturePlayback' + body.ticket.split('-').at(-1) + '.m3u8' } : { state: 'processing' });
      return respond({ success: true });
    }
    if (url.origin === new URL(base).origin || ['blob:', 'data:'].includes(url.protocol)) return request.continue();
    if (method === 'OPTIONS') return respond({});
    if (url.pathname.includes('/auth/v1/')) {
      if (url.pathname.endsWith('/token')) return respond({ access_token: token, refresh_token: 'fixture-refresh', expires_in: 3600, token_type: 'bearer', user });
      if (url.pathname.endsWith('/user')) return respond(user);
      return respond({});
    }
    if (url.pathname.includes('/rest/v1/')) {
      requests.push({ path: url.pathname, method, body });
      const list = url.pathname.endsWith('/categories') ? categories : media;
      let rows = list.filter(row => [...url.searchParams].every(([key, value]) => !value.startsWith('eq.') || String(row[key]) === value.slice(3)));
      if (method === 'HEAD') return respond(null, 200, { 'Content-Range': '0-0/' + rows.length });
      if (method === 'POST') {
        if (failSave) { failSave = false; return respond({ message: 'Fixture save failed' }, 500); }
        rows = (Array.isArray(body) ? body : [body]).map(row => ({ id: crypto.randomUUID(), ...row }));
        list.push(...rows);
      }
      if (method === 'PATCH') rows.forEach(row => Object.assign(row, body));
      if (method === 'DELETE') rows.forEach(row => list.splice(list.indexOf(row), 1));
      const result = rows.map(row => list === media ? { ...row, categories: categories.find(category => category.id === row.category_id) } : row);
      return respond(request.headers().accept?.includes('vnd.pgrst.object') ? result[0] || null : result);
    }
    if (url.hostname === 'storage.googleapis.com') {
      requests.push({ path: url.pathname, method });
      return request.respond({ status: 200, headers, body: '' });
    }
    if (url.hostname === 'player.mux.com') {
      requests.push({ path: 'mux-player', method });
      return request.respond({ status: 200, headers, contentType: 'text/html', body: '<html><body>Fixture adaptive player</body></html>' });
    }
    if (url.pathname.includes('/storage/v1/object/') && method !== 'GET') {
      requests.push({ path: url.pathname, method, body });
      return respond(url.pathname.includes('/list/') ? [] : { Key: url.pathname });
    }
    if (request.resourceType() === 'image') return request.respond({ status: 200, headers, contentType: 'image/png', body: poster });
    if (request.resourceType() === 'media') {
      requests.push({ path: 'video-bytes', method });
      const range = request.headers().range?.match(/bytes=(\d+)-(\d*)/);
      const start = Number(range?.[1] || 0), end = range?.[2] ? Math.min(Number(range[2]), videoBytes.length - 1) : videoBytes.length - 1;
      return request.respond({ status: range ? 206 : 200, headers: { ...headers, 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${videoBytes.length}` } : {}) }, contentType: videoType, body: videoBytes.subarray(start, end + 1) });
    }
    await request.abort();
  } catch (error) { errors.push('Mock: ' + error.message); if (!request.isInterceptResolutionHandled()) await request.abort(); }
});
const waitText = text => page.waitForFunction(text => document.body.innerText.includes(text), {}, text);
async function click(text) { await page.waitForFunction(text => [...document.querySelectorAll('button')].some(node => node.textContent.trim() === text && !node.disabled), {}, text); for (const button of await page.$$('button')) if (await button.evaluate((node, text) => node.textContent.trim() === text, text)) { await button.click(); return; } throw new Error('Button not found: ' + text); }
async function close() { await page.click('dialog[open] button[aria-label="Close dialog"]'); }
try {
  await page.goto(base + '/admin', { waitUntil: 'networkidle0' });
  const fixture = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
    const context = canvas.getContext('2d');
    const type = MediaRecorder.isTypeSupported('video/mp4') ? 'video/mp4' : 'video/webm';
    const stream = canvas.captureStream(15);
    const recorder = new MediaRecorder(stream, { mimeType: type });
    const chunks = [];
    const result = new Promise(resolve => { recorder.ondataavailable = event => chunks.push(event.data); recorder.onstop = async () => resolve([...new Uint8Array(await new Blob(chunks, { type }).arrayBuffer())]); });
    let tick = 0;
    const draw = setInterval(() => { context.fillStyle = tick++ % 2 ? '#3529f9' : '#efbd6a'; context.fillRect(0, 0, 320, 180); }, 70);
    recorder.start(); await new Promise(resolve => setTimeout(resolve, 1800)); recorder.stop(); clearInterval(draw); stream.getTracks().forEach(track => track.stop());
    return { type, bytes: await result };
  });
  videoBytes = Buffer.from(fixture.bytes); videoType = fixture.type;
  const extension = videoType === 'video/mp4' ? 'mp4' : 'webm';
  const file = path.join(output, 'phone-video.' + extension); await fs.writeFile(file, videoBytes);
  const backend = await page.evaluate(async () => (await import('/src/admin/supabaseClient.ts')).supabase.supabaseUrl);
  const source = backend + '/storage/v1/object/public/pictures/public/films/legacy.' + extension;
  media = [{ id: 'legacy', title: 'Legacy film', category_id: 'films', image_url: source }];
  const extraction = await page.evaluate(async (bytes, type) => {
    const { createVideoPoster, videoMimeType } = await import('/src/media/video.ts');
    const file = await createVideoPoster(new File([new Uint8Array(bytes)], 'short-video', { type }), 0.3);
    const bitmap = await createImageBitmap(file);
    return { type: file.type, size: file.size, width: bitmap.width, height: bitmap.height, mp4: videoMimeType('https://example.test/FILM.MP4?token=test#t=1') };
  }, fixture.bytes, videoType);
  assert.equal(extraction.type, 'image/webp'); assert(extraction.size > 0); assert.equal(extraction.width, 320); assert.equal(extraction.mp4, 'video/mp4');
  requests.length = 0;
  await page.goto(base, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.media-cover img');
  assert.equal(await page.$$eval('video', nodes => nodes.length), 0);
  assert.equal(requests.filter(request => request.path === 'video-bytes').length, 0);
  for (const width of [280, 320, 390, 768, 1440]) {
    await page.setViewport({ width, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Home overflow at ' + width);
  }
  await page.goto(base + '/portfolio', { waitUntil: 'networkidle0' });
  assert.equal(requests.filter(request => request.path === 'video-bytes').length, 0);
  await page.click('[aria-label="Open Legacy film"]');
  await page.waitForFunction(() => document.querySelector('.media-player video')?.readyState >= 2);
  assert(requests.some(request => request.path === 'video-bytes'));
  assert.equal(await page.$eval('.media-player source', node => node.type), videoType);
  await page.goto(base + '/admin', { waitUntil: 'networkidle0' });
  await page.locator('#studio-email').fill(user.email); await page.locator('#studio-password').fill('fixture-password'); await click('Sign in');
  await waitText('Media library'); await waitText('Processing videos');
  await page.setViewport({ width: 320, height: 740 });
  await click('Upload media'); await page.select('#studio-upload-category', 'films');
  await (await page.$('#studio-upload-files')).uploadFile(file); await click('Upload 1 file');
  await waitText('Uploads finished.'); assert.equal(jobs, 1); assert.equal(media.length, 1);
  await close(); await page.reload({ waitUntil: 'networkidle0' });
  await click('Processing videos'); await click('Publish ready videos'); await waitText('Still processing.');
  assert.equal(media.length, 1);
  ready = true; failSave = true;
  await click('Publish ready videos'); await waitText('Fixture save failed');
  await click('Publish ready videos'); await waitText('No videos waiting');
  assert.equal(media.length, 2); assert.equal(jobs, 1); assert(media.some(row => row.image_url.includes('stream.mux.com')));
  await close();
  await page.click('[aria-label="Open Legacy film"]'); await click('Optimize for streaming');
  assert.equal(media.find(row => row.id === 'legacy').image_url, source);
  await click('Publish ready videos'); await waitText('No videos waiting');
  assert(media.find(row => row.id === 'legacy').image_url.includes('stream.mux.com'));
  assert(requests.some(request => request.method === 'DELETE' && request.path.includes('/storage/') && request.body.prefixes?.includes('public/films/legacy.' + extension)));
  await close();
  await page.goto(base + '/portfolio', { waitUntil: 'networkidle0' });
  assert.equal(await page.$$('iframe').then(nodes => nodes.length), 0);
  await page.click('[aria-label="Open Legacy film"]'); await page.waitForSelector('iframe[src^="https://player.mux.com/"]');
  await page.screenshot({ path: path.join(output, 'player-mobile.png') });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, viewports: 5, poster: extraction, scenarios: ['no gallery video downloads', 'native playback', 'Mux chunk upload', 'pending jobs survive reload', 'processing state', 'database failure retry without duplicate upload', 'safe legacy migration and cleanup', 'Mux player opens on demand'] }, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true });
  throw error;
} finally { await browser.close(); }
