// Fill missing original-video covers using already prepared Mux assets.
// Never replace a custom cover or change the live video URL.
export async function backfillVideoCovers(rows, { base, key, current, request = fetch }) {
  const prefix = '/storage/v1/object/public/pictures/';
  const results = [];
  const visited = new Set();
  for (const row of rows) {
    if (!current.some(item => item.id === row.id && item.image_url === row.source) || visited.has(row.source)) continue;
    visited.add(row.source);
    const source = new URL(row.source);
    const playback = new URL(row.url);
    if (source.origin !== new URL(base).origin || !source.pathname.startsWith(prefix) || source.username || source.password || !/\.(mp4|webm|mov|m4v|ogv)$/i.test(source.pathname) || row.state !== 'ready' || playback.origin !== 'https://stream.mux.com' || !/^\/[a-zA-Z0-9]+\.m3u8$/.test(playback.pathname)) throw new Error('Cover source does not match this portfolio and a ready Mux asset.');
    const poster = new URL(source);
    poster.pathname += '.poster.webp'; poster.search = ''; poster.hash = '';
    const existing = await request(poster, { method: 'GET', signal: AbortSignal.timeout(20_000) });
    if (existing.ok) { await existing.body?.cancel(); results.push({ id: row.id, state: 'preserved' }); continue; }
    const error = await existing.json().catch(() => ({}));
    const missing = existing.status === 404 || (existing.status === 400 && (String(error.statusCode) === '404' || error.message === 'Object not found'));
    if (!missing) throw new Error(`Cannot confirm that the existing cover is missing (HTTP ${existing.status}).`);
    const thumbnail = new URL('https://image.mux.com/' + playback.pathname.slice(1, -5) + '/thumbnail.webp');
    thumbnail.search = new URLSearchParams({ width: '800', fit_mode: 'preserve', time: String(Math.min(2, Math.max(0, Number(row.duration || 4) / 2))) }).toString();
    const image = await request(thumbnail, { signal: AbortSignal.timeout(30_000) });
    if (!image.ok) throw new Error(`Mux cover is unavailable (HTTP ${image.status}).`);
    const bytes = Buffer.from(await image.arrayBuffer());
    if (bytes.length > 2_000_000 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') throw new Error('Mux did not return a valid WebP cover.');
    const destination = new URL(poster);
    destination.pathname = destination.pathname.replace('/storage/v1/object/public/', '/storage/v1/object/');
    const saved = await request(destination, {
      method: 'POST', signal: AbortSignal.timeout(30_000),
      headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'image/webp', 'Cache-Control': 'max-age=3600', 'x-upsert': 'false' }, body: bytes,
    });
    if (!saved.ok) {
      const error = await saved.json().catch(() => ({}));
      if (saved.status === 409 || (saved.status === 400 && (String(error.statusCode) === '409' || error.error === 'Duplicate'))) {
        results.push({ id: row.id, state: 'preserved' }); continue;
      }
      throw new Error(`Cover could not be stored (HTTP ${saved.status}).`);
    }
    results.push({ id: row.id, state: 'created' });
  }
  return results;
}
