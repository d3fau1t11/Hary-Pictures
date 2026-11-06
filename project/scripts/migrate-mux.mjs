// One-time operator migration. Never shipped to the browser or run during builds.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { backfillVideoCovers } from './backfill-video-covers.mjs';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const importTag = url => 'hary:import:' + createHash('sha256').update(url).digest('hex');
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";

export function deployedScriptUrls(html, site) {
  return [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)]
    .map(match => new URL(match[1], site))
    .filter(url => url.origin === new URL(site).origin && url.pathname.startsWith('/assets/'));
}

export function migrationSql(rows, reverse = false) {
  if (!rows.length || rows.some(row => !row.url || row.state !== 'ready')) throw new Error('Every video must be ready before generating SQL.');
  return '-- Update video URLs only; preserve titles, categories, IDs and original files.\nBEGIN;\nDO $migration$\nBEGIN\n' + rows.map(row => {
    const from = reverse ? row.url : row.source;
    const to = reverse ? row.source : row.url;
    return `  IF NOT EXISTS (SELECT 1 FROM public.pictures WHERE id = ${quote(row.id)}::uuid AND image_url = ${quote(to)}) THEN
    UPDATE public.pictures SET image_url = ${quote(to)}
      WHERE id = ${quote(row.id)}::uuid AND image_url = ${quote(from)};
    IF NOT FOUND THEN RAISE EXCEPTION 'Video ${row.id.replaceAll("'", "''")} changed or was removed; migration cancelled.'; END IF;
  END IF;`;
  }).join('\n') + '\nEND;\n$migration$;\nCOMMIT;\n';
}

export function planImports(rows, assets, base, limit = 10) {
  const native = rows.filter(row => {
    const url = new URL(row.image_url);
    return url.origin === new URL(base).origin && url.pathname.startsWith('/storage/v1/object/public/pictures/') && /\.(mp4|webm|mov|m4v|ogv)$/i.test(url.pathname);
  });
  const sources = [...new Set(native.map(row => row.image_url))];
  const missing = sources.filter(url => !assets.some(asset => asset.passthrough === importTag(url)));
  if (assets.length + missing.length > limit) throw new Error(`Migration would exceed the ${limit}-video free-plan limit. No new assets created.`);
  return { native, sources, missing };
}

export async function run(command, supplied = {}) {
  const env = { ...supplied };
  const stateFile = resolve(project, 'test-results/mux-migration.json');
  const save = rows => { mkdirSync(dirname(stateFile), { recursive: true }); writeFileSync(stateFile, JSON.stringify(rows, null, 2) + '\n'); };
  const load = () => existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : [];
  const required = name => { if (!env[name]) throw new Error(`Missing ${name}. Set it in an ignored local environment file.`); return env[name]; };
  const base = required('VITE_SUPABASE_URL').replace(/\/$/, '');
  const anon = required('VITE_SUPABASE_ANON_KEY');
  const muxAuth = 'Basic ' + Buffer.from(required('MUX_TOKEN_ID') + ':' + required('MUX_TOKEN_SECRET')).toString('base64');
  async function request(url, options, label) {
    let response;
    try { response = await fetch(url, { ...options, signal: AbortSignal.timeout(30_000) }); }
    catch { throw new Error(`${label}: connection failed. Retry the same command; prepared assets are reused.`); }
    if (!response.ok) throw new Error(`${label}: HTTP ${response.status}. Provider details withheld to protect credentials.`);
    return response;
  }
  const mux = async (path, method = 'GET', body) => (await (await request('https://api.mux.com/video/v1/' + path, {
    method, headers: { Authorization: muxAuth, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  }, 'Mux')).json()).data;
  const db = async (query, key = anon, options = {}) => (await request(base + '/rest/v1/pictures?' + query, {
    ...options, headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Prefer: 'return=representation', ...options.headers },
  }, 'Supabase')).json();
  async function inventory() {
    const rows = [];
    for (let offset = 0; ; offset += 1000) {
      const page = await db('select=id,title,category_id,image_url&order=id&limit=1000&offset=' + offset);
      rows.push(...page);
      if (page.length < 1000) return rows;
    }
  }
  async function refresh(rows) {
    const checked = new Map();
    for (const row of rows) {
      if (!row.assetId) throw new Error('Preparation is incomplete. Run --prepare again to recover existing imports.');
      if (!checked.has(row.assetId)) checked.set(row.assetId, await mux('assets/' + row.assetId));
      const asset = checked.get(row.assetId);
      if (asset.passthrough !== importTag(row.source)) throw new Error('Asset ownership does not match the saved source.');
      if (asset.test) throw new Error('The Mux token targets a test environment. Use a Production token for full-length videos.');
      row.state = asset.status;
      const playback = asset.playback_ids?.find(item => item.policy === 'public');
      if (row.state === 'ready' && playback && /^[a-zA-Z0-9]+$/.test(playback.id)) {
        row.url = `https://stream.mux.com/${playback.id}.m3u8`;
        row.duration = asset.duration;
      } else delete row.url;
      save(rows);
    }
    return rows;
  }
  async function verifyPlayback(rows) {
    for (const url of new Set(rows.map(row => row.url))) {
      const stream = await request(url, { method: 'GET' }, 'Playback verification');
      if (!(await stream.text()).startsWith('#EXTM3U')) throw new Error('Mux did not return an HLS playlist.');
      const id = new URL(url).pathname.slice(1, -5);
      const cover = await request(`https://image.mux.com/${id}/thumbnail.webp?width=800`, { method: 'GET' }, 'Thumbnail verification');
      const bytes = Buffer.from(await cover.arrayBuffer());
      if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') throw new Error('Mux did not return a WebP thumbnail.');
    }
  }
  async function verifyDeployment() {
    const site = env.MIGRATION_SITE_URL || 'https://harypictures.netlify.app';
    const html = await (await request(new URL('/portfolio', site), { cache: 'no-store' }, 'Deployment verification')).text();
    for (const url of deployedScriptUrls(html, site)) {
      const script = await (await request(url, {}, 'Deployment script')).text();
      if (script.includes('player.mux.com') && script.includes('media-cover')) return;
    }
    throw new Error('The live site does not contain the Mux player yet. Deploy the latest main branch before publishing video URLs. Original records preserved.');
  }
  if (command === '--prepare') {
    const pictures = await inventory();
    const assets = [];
    for (let page = 1; ; page++) {
      const data = await mux('assets?limit=100&page=' + page);
      assets.push(...data);
      if (data.length < 100) break;
    }
    const { native, sources } = planImports(pictures, assets, base);
    const rows = load();
    for (const row of native) if (!rows.some(saved => saved.id === row.id && saved.source === row.image_url)) rows.push({ id: row.id, title: row.title, source: row.image_url });
    save(rows);
    for (const source of sources) {
      let asset = assets.find(value => value.passthrough === importTag(source));
      if (!asset) {
        await request(source, { method: 'HEAD' }, 'Original video');
        asset = await mux('assets', 'POST', { inputs: [{ url: source }], playback_policies: ['public'], video_quality: 'basic', passthrough: importTag(source), meta: { title: native.find(row => row.image_url === source).title.slice(0, 200) } });
        assets.push(asset);
      }
      for (const row of rows.filter(value => value.source === source)) { row.assetId = asset.id; row.state = asset.status; }
      save(rows);
      console.log('Prepared source; existing portfolio URLs preserved.');
    }
    console.log(JSON.stringify({ preparedRecords: rows.length, muxAssetCount: assets.length, next: 'Run --status after Mux finishes processing.' }));
    return;
  }
  const rows = load();
  if (!rows.length) throw new Error('No migration state. Run --prepare first.');
  if (command === '--covers') {
    const key = required('SUPABASE_SERVICE_ROLE_KEY');
    await refresh(rows);
    const current = await inventory();
    const results = await backfillVideoCovers(rows, { base, key, current });
    console.log(JSON.stringify({ covers: results, videoRecordsChanged: 0 }));
    return;
  }
  if (command === '--verify') {
    const current = await inventory();
    const published = rows.filter(row => row.url && current.some(item => item.id === row.id && item.image_url === row.url)).length;
    console.log(JSON.stringify({ total: rows.length, published, remaining: rows.length - published }));
    if (published !== rows.length) throw new Error('Some video URLs have not been published.');
    await verifyDeployment();
    await verifyPlayback(rows);
    return;
  }
  if (!['--status', '--publish'].includes(command)) throw new Error('Use --prepare, --status, --covers, --publish or --verify.');
  await refresh(rows);
  const ready = rows.filter(row => row.state === 'ready' && row.url).length;
  console.log(JSON.stringify({ total: rows.length, ready, states: rows.map(row => row.state) }));
  if (ready !== rows.length) { if (command === '--publish') throw new Error('All videos must finish processing before publication.'); return; }
  await verifyPlayback(rows);
  writeFileSync(resolve(project, 'test-results/mux-migration.sql'), migrationSql(rows));
  writeFileSync(resolve(project, 'test-results/mux-rollback.sql'), migrationSql(rows, true));
  if (command === '--status') { console.log('Playback and thumbnails verified. Migration and rollback SQL written to test-results/.'); return; }
  await verifyDeployment();
  const key = required('SUPABASE_SERVICE_ROLE_KEY');
  const current = await inventory();
  if (rows.some(row => !current.some(item => item.id === row.id && [row.source, row.url].includes(item.image_url)))) throw new Error('A video changed or was removed. Review before publishing; no records updated.');
  for (const row of rows) {
    if (current.some(item => item.id === row.id && item.image_url === row.url)) continue;
    const query = new URLSearchParams({ id: 'eq.' + row.id, image_url: 'eq.' + row.source, select: 'id,image_url' });
    const updated = await db(query, key, { method: 'PATCH', body: JSON.stringify({ image_url: row.url }) });
    if (updated.length !== 1 || updated[0].image_url !== row.url) throw new Error('Record changed during publication or write access denied. No original file was deleted; rerun to resume.');
    console.log('Published a ready video; original retained for rollback.');
  }
  console.log('Publication finished. Run --verify to confirm public portfolio records.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const env = {};
  const path = resolve(project, '.env');
  if (existsSync(path)) Object.assign(env, parseEnv(readFileSync(path, 'utf8')));
  run(process.argv[2], { ...env, ...process.env }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
