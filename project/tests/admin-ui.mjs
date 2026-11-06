import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import puppeteer from 'puppeteer';

const base = process.env.ADMIN_TEST_URL || 'http://127.0.0.1:5173';
const output = path.resolve('test-results/admin');
await fs.mkdir(output, { recursive: true });
const browserPath = process.env.BROWSER_EXECUTABLE || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);
if (!browserPath) throw new Error('Set BROWSER_EXECUTABLE to a locally installed Chrome or Edge.');
const browser = await puppeteer.launch({ executablePath: browserPath, headless: true });
const page = await browser.newPage();
const categories = [
  { id: '11111111-1111-4111-8111-111111111111', name_am: 'Weddings', slug: 'weddings' },
  { id: '22222222-2222-4222-8222-222222222222', name_am: 'Portraits', slug: 'portraits' },
  { id: '33333333-3333-4333-8333-333333333333', name_am: 'Events & celebrations', slug: 'events' },
  { id: '44444444-4444-4444-8444-444444444444', name_am: 'Hero', slug: 'hero' },
  { id: '55555555-5555-4555-8555-555555555555', name_am: 'About Me', slug: 'about-me' },
];
const media = Array.from({ length: 10 }, (_, i) => ({
  id: String(i + 1), title: ['Golden hour vows', 'A quiet moment', 'Together, always', 'Sunday in the city', 'Wedding highlights', 'A celebration of love', 'Studio portrait', 'Light & shadow', 'Evening gathering', 'Behind the scenes'][i],
  category_id: categories[i % 3].id,
  image_url: 'https://studio-fixtures.invalid/' + (1700000000000 + i * 86400000) + '-sample.' + (i === 4 ? 'mp4' : 'webp'),
  created_at: new Date(1700000000000 + i * 86400000).toISOString(),
}));
media.push({ id: 'hero-photo', title: 'Homepage photo', category_id: categories[3].id, image_url: 'https://studio-fixtures.invalid/hero.webp', created_at: new Date().toISOString() });
media.push({ id: 'about-photo', title: 'About photo', category_id: categories[4].id, image_url: 'https://studio-fixtures.invalid/about.webp', created_at: new Date().toISOString() });
const user = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', aud: 'authenticated', role: 'authenticated', email: 'studio@example.test', email_confirmed_at: new Date().toISOString(), app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, created_at: new Date().toISOString() };
const token = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url') + '.' + Buffer.from(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' })).toString('base64url') + '.test-signature';
let failTitle = '';
let failReplacement = false;
let failLoading = false;
let originalHeroUrl = '';

const calls = [];
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.setRequestInterception(true);
page.on('request', async request => {
  try {
    const url = new URL(request.url());
    if (url.origin === new URL(base).origin || url.protocol === 'data:' || url.protocol === 'blob:') { await request.continue(); return; }
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS', 'Access-Control-Expose-Headers': 'Content-Range' };
    const respond = (data, status = 200, extra = {}) => request.respond({ status, headers: { ...headers, ...extra }, contentType: 'application/json', body: JSON.stringify(data) });
    if (request.method() === 'OPTIONS') { await respond({}, 200); return; }
    const method = request.method();
    let body = {};
    try { body = JSON.parse(request.postData() || '{}'); } catch {}
    if (url.pathname.includes('/auth/v1/')) {
      calls.push({ method, path: url.pathname, body });
      if (url.pathname.endsWith('/token')) { await respond({ access_token: token, refresh_token: 'fixture-refresh', expires_in: 3600, token_type: 'bearer', user }); return; }
      if (url.pathname.endsWith('/user')) { await respond(user); return; }
      await respond({}); return;
    }
    if (url.pathname.includes('/rest/v1/')) {
      if (!originalHeroUrl) { originalHeroUrl = url.origin + '/storage/v1/object/public/pictures/public/hero/old.webp'; media.find(item => item.id === 'hero-photo').image_url = originalHeroUrl; }
      calls.push({ method, path: url.pathname, body });
      if (failLoading && method === 'GET') { await respond({ message: 'Fixture: unable to load media' }, 500); return; }
      const list = url.pathname.endsWith('/categories') ? categories : media;
      let rows = list.filter(row => [...url.searchParams].every(([key, value]) => !value.startsWith('eq.') || String(row[key]) === value.slice(3)));
      if (method === 'HEAD') { await respond(null, 200, { 'Content-Range': '0-0/' + rows.length }); return; }
      if (method === 'POST') {
        const additions = Array.isArray(body) ? body : [body];
        if (additions.some(row => row.title === failTitle && failTitle)) { failTitle = ''; await respond({ message: 'Fixture: one upload failed' }, 500); return; }
        rows = additions.map(row => ({ id: randomUUID(), created_at: new Date().toISOString(), ...row }));
        list.push(...rows);
      }
      if (method === 'PATCH') {
        if (failReplacement && body.image_url) { failReplacement = false; await respond({ message: 'Fixture: replacement could not be saved' }, 500); return; }
        rows.forEach(row => Object.assign(row, body));
      }
      if (method === 'DELETE') rows.forEach(row => list.splice(list.indexOf(row), 1));
      const result = rows.map(row => list === media ? { ...row, categories: categories.find(category => category.id === row.category_id) || null } : row);
      await respond(request.headers().accept?.includes('vnd.pgrst.object') ? result[0] || null : result); return;
    }
    if (url.pathname.includes('/storage/v1/object/') && method !== 'GET') {
      calls.push({ method, path: url.pathname, body, contentType: request.headers()['content-type'] });
      if (url.pathname.includes('/list/')) { await respond([]); return; }
      await respond({ Key: url.pathname.split('/object/')[1], Id: randomUUID() }); return;
    }
    if (request.resourceType() === 'image') {
      // Deliberately synthetic artwork: screenshots exercise layout without using live content.
      const id = Number(url.pathname.match(/\d+/)?.[0]?.slice(-3) || 20);
      const hue = 20 + id % 110;
      await request.respond({ status: 200, headers, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="hsl(' + hue + ',20%,58%)"/><stop offset="1" stop-color="hsl(' + hue + ',17%,22%)"/></linearGradient></defs><rect width="800" height="600" fill="url(#g)"/><circle cx="560" cy="130" r="90" fill="#f1debc" opacity=".5"/><path d="M0 480L280 190L510 510L680 340L800 500V600H0" fill="#242822" opacity=".4"/></svg>' }); return;
    }
    // No request in this test may reach a live third party.
    await request.abort();
  } catch (error) { errors.push('Mock handler: ' + error.message); if (!request.isInterceptResolutionHandled()) await request.abort(); }
});
async function waitText(text) { await page.waitForFunction(text => document.body.innerText.includes(text), {}, text); }
async function clickText(text, selector = 'button') {
  const elements = await page.$$(selector);
  for (const element of elements) {
    const matches = await element.evaluate((node, text) => node.textContent.trim() === text && node.getBoundingClientRect().width > 0, text);
    if (matches) { await element.click(); return; }
  }
  throw new Error('Visible control not found: ' + text);
}
async function closeDialog() { const button = await page.$('dialog[open] button[aria-label="Close dialog"]'); if (button) await button.click(); await page.waitForFunction(() => !document.querySelector('dialog[open]')); }
async function assertLayout(label) {
  const result = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const dialogs = [...document.querySelectorAll('dialog[open]')];
    const overflowing = [...document.querySelectorAll('.studio button,.studio input,.studio select,.studio-dialog')]
      .filter(node => node.getBoundingClientRect().width && !node.closest('.studio-sidebar'))
      .filter(node => { const r = node.getBoundingClientRect(); return r.right > width + 1 || r.left < -1; })
      .map(node => node.getAttribute('aria-label') || node.textContent.slice(0, 60));
    return { overflow: document.documentElement.scrollWidth > width + 1, overflowing, dialogsFit: dialogs.every(node => { const r = node.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight + 1; }) };
  });
  assert.equal(result.overflow, false, label + ': horizontal page overflow');
  assert.deepEqual(result.overflowing, [], label + ': overflowing controls');
  assert.equal(result.dialogsFit, true, label + ': dialog outside viewport');
}
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8l8AAAAASUVORK5CYII=', 'base64');
const firstFile = path.join(output, 'first.png'), retryFile = path.join(output, 'retry.png');
await fs.writeFile(firstFile, png); await fs.writeFile(retryFile, png);
try {
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(base + '/admin', { waitUntil: 'networkidle0' });
  await waitText('Welcome back');
  assert.equal(await page.$$eval('[aria-invalid=true]', nodes => nodes.length), 0, 'Fresh login should not show validation errors');
  await page.screenshot({ path: path.join(output, 'login-desktop.png') });
  for (const width of [280, 320, 360, 390, 430, 600, 768, 1024]) {
    await page.setViewport({ width, height: 844 }); await assertLayout('Login ' + width);
  }
  await clickText('Sign in'); await waitText('Enter a valid email address.');
  await clickText('Forgot password?'); await waitText('Let’s get you back in');
  await assertLayout('Password recovery');
  await page.type('#studio-email', user.email);
  await clickText('Send reset link');
  await waitText('If an account exists');
  assert(calls.some(call => call.path.endsWith('/recover')), 'Reset link request was not sent to the mock');
  await clickText('Back to sign in');
  await page.setViewport({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(output, 'login-mobile.png') });
  await page.locator('#studio-email').fill(user.email);
  await page.type('#studio-password', 'fixture-password');
  await clickText('Sign in');
  await waitText('Media library');
  await page.waitForSelector('.studio-media-card');
  assert.equal(await page.$eval('.studio-page-heading h1', node => node.textContent), 'Media library');
  assert.equal(await page.$$eval('.studio-media-card', nodes => nodes.length), 10);
  await page.screenshot({ path: path.join(output, 'library-mobile.png'), fullPage: true });
  await page.setViewport({ width: 1440, height: 1000 });
  await page.screenshot({ path: path.join(output, 'library-desktop.png'), fullPage: true });

  console.log('Login and initial library checks passed.');
  if (!process.argv.includes('--flows-only')) for (const [width, height] of [[280,653],[320,568],[360,740],[390,844],[430,932],[600,900],[768,1024],[1024,768],[1440,1000],[844,390]]) {
    await page.setViewport({ width, height });
    for (const route of ['library', 'categories', 'website', 'overview']) {
      await page.goto(base + '/admin/' + route, { waitUntil: 'networkidle0' });
      await page.waitForSelector('.studio-page-heading');
      await assertLayout(route + ' ' + width + 'x' + height);
    }
  }
  console.log('Responsive layout checks passed.');
  await page.setViewport({ width: 320, height: 568 });
  await page.goto(base + '/admin/library', { waitUntil: 'networkidle0' });
  await page.select('select[aria-label="Sort media"]', 'oldest');
  await page.waitForFunction(() => document.querySelector('.studio-media-card h3')?.textContent === 'Golden hour vows');
  await page.select('select[aria-label="Sort media"]', 'newest');
  await page.waitForFunction(() => document.querySelector('.studio-media-card h3')?.textContent === 'Behind the scenes');
  await page.type('input[aria-label="Search media"]', 'not-a-photo');
  await waitText('No matching media');
  await clickText('Clear filters');
  await page.select('select[aria-label="Filter by category"]', categories[1].id);
  await page.reload({ waitUntil: 'networkidle0' });
  assert.equal(await page.$eval('select[aria-label="Filter by category"]', node => node.value), categories[1].id);
  await page.select('select[aria-label="Filter by category"]', '');

  await clickText('Upload media');
  await assertLayout('Upload 320');
  await page.setViewport({ width: 390, height: 320 });
  await assertLayout('Upload with short keyboard-sized viewport');
  // Native dialog traps focus and returns it to the opener.
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => !!document.activeElement.closest('dialog')), true);
  await page.setViewport({ width: 390, height: 844 });
  const input = await page.$('#studio-upload-files');
  await input.uploadFile(firstFile, retryFile);
  await page.select('#studio-upload-category', categories[0].id);
  await page.screenshot({ path: path.join(output, 'upload-mobile.png') });
  assert(await page.$eval('dialog .studio-dialog-actions', node => node.getBoundingClientRect().bottom <= innerHeight), 'Upload actions should stay visible on mobile');
  console.log('Search, sorting, filters, and dialogs passed.');
  failTitle = 'retry';
  await clickText('Upload 2 files');
  await waitText('Some files could not be uploaded.');
  assert.equal(media.filter(item => item.title === 'first').length, 1);
  assert.equal(media.filter(item => item.title === 'retry').length, 0);
  await clickText('Upload 1 file');
  await waitText('All done.');
  assert.equal(media.filter(item => item.title === 'first').length, 1, 'Retry duplicated a successful file');
  assert.equal(media.filter(item => item.title === 'retry').length, 1);
  await clickText('Done');
  await clickText('Upload media');
  await (await page.$('#studio-upload-files')).uploadFile(firstFile);
  await clickText('Create a category');
  await page.type('#studio-category-name', 'Inline collection');
  await clickText('Create category');
  await page.waitForFunction(() => document.querySelectorAll('dialog[open]').length === 1);
  assert.equal(await page.$$eval('.studio-upload-row', rows => rows.length), 1, 'Creating a category discarded the upload queue');
  await closeDialog();

  console.log('Upload and retry checks passed.');
  await page.goto(base + '/admin/categories', { waitUntil: 'networkidle0' });
  await clickText('New category');
  await page.type('#studio-category-name', 'New collection');
  await assertLayout('Create category');
  await clickText('Create category');
  await page.waitForFunction(() => !document.querySelector('dialog[open]'));
  await waitText('New collection');
  await page.click('button[aria-label="Edit category New collection"]');
  await page.$eval('#studio-category-name', node => { node.value = ''; node.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.locator('#studio-category-name').fill('Renamed collection');
  await clickText('Save changes');
  await waitText('Renamed collection');
  await page.click('button[aria-label="Delete category Weddings"]');
  await clickText('Delete permanently');
  await waitText('Move this category’s media');
  assert(categories.some(item => item.name_am === 'Weddings'), 'Deleted a populated category');
  await closeDialog();

  await page.goto(base + '/admin/website', { waitUntil: 'networkidle0' });
  await page.screenshot({ path: path.join(output, 'website-mobile.png'), fullPage: true });
  console.log('Category checks passed.');
  const oldHero = media.find(item => item.id === 'hero-photo').image_url;
  await clickText('Replace photo');
  await (await page.$('#studio-upload-files')).uploadFile(firstFile);
  failReplacement = true;
  await clickText('Save photo');
  await waitText('Some files could not be uploaded.');
  assert.equal(media.find(item => item.id === 'hero-photo').image_url, oldHero, 'Failed replacement removed the current photo');
  assert(!calls.some(call => call.method === 'DELETE' && call.path.includes('/storage/') && call.body.prefixes?.includes('public/hero/old.webp')), 'Failed replacement deleted the published file');
  await clickText('Save photo');
  await waitText('All done.');
  assert.notEqual(media.find(item => item.id === 'hero-photo').image_url, oldHero);
  assert.equal(media.filter(item => item.category_id === categories[3].id).length, 1);
  assert(calls.some(call => call.method === 'DELETE' && call.path.includes('/storage/') && call.body.prefixes?.includes('public/hero/old.webp')), 'Successful replacement did not clean up the old file');
  await clickText('Done');

  await page.goto(base + '/admin/library', { waitUntil: 'networkidle0' });
  await page.click('button[aria-label="Edit Golden hour vows"]');
  await assertLayout('Media details');
  await page.screenshot({ path: path.join(output, 'details-mobile.png') });
  await page.select('#studio-media-category', categories[1].id);
  await clickText('Save changes');
  await page.waitForFunction(() => !document.querySelector('dialog[open]'));
  assert.equal(media.find(item => item.id === '1').category_id, categories[1].id);
  await page.click('input[aria-label="Select Golden hour vows"]');
  await clickText('Move');
  await page.select('#studio-move-category', categories[0].id);
  await clickText('Move media');
  await page.waitForFunction(() => !document.querySelector('dialog[open]'));
  assert.equal(media.find(item => item.id === '1').category_id, categories[0].id);
  await page.click('input[aria-label="Select Golden hour vows"]');
  await clickText('Delete');
  await assertLayout('Delete confirmation');
  await clickText('Keep media');
  assert(media.some(item => item.id === '1'), 'Cancel deleted media');
  await clickText('Delete');
  await clickText('Delete permanently');
  await page.waitForFunction(() => !document.querySelector('dialog[open]'));
  assert(!media.some(item => item.id === '1'), 'Confirmed delete did not remove media');

  await page.goto(base + '/admin/reset-password', { waitUntil: 'networkidle0' });
  await waitText('Set a new password');
  await page.type('#studio-password', 'new-fixture-password');
  await clickText('Save password');
  await waitText('Media library');
  assert(calls.some(call => call.path.endsWith('/user') && call.method === 'PUT'), 'New password was not sent to the mock');
  failLoading = true;
  await page.reload({ waitUntil: 'networkidle0' });
  await waitText('Fixture: unable to load media');
  failLoading = false; await clickText('Try again'); await page.waitForSelector('.studio-media-card');
  await page.click('button[aria-label="Your account"]');
  await clickText('Sign out');
  await waitText('Welcome back');
  await page.goto(base + '/admin/website', { waitUntil: 'networkidle0' });
  await waitText('Welcome back');
  assert.equal(await page.$('.studio-workspace'), null, 'An unauthenticated admin route rendered the workspace');
  assert.deepEqual(errors, [], 'Browser errors');
  const report = { passed: true, viewports: process.argv.includes('--flows-only') ? 'flow checks only' : 10, flows: ['login validation', 'password recovery screen', 'unauthenticated deep links', 'responsive screens', 'keyboard-sized dialog viewport', 'focus trap', 'search and empty states', 'sort and persisted filters', 'mixed batch failure and retry', 'category create/edit', 'populated category protection', 'safe photo replacement', 'media edit/move', 'delete cancel and confirm', 'data-load recovery', 'sign out'], screenshots: output, mockedApiCalls: calls.length };
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true });
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: false, error: String(error) }, null, 2));
  console.error(error);
  process.exitCode = 1;
} finally { await browser.close(); }
