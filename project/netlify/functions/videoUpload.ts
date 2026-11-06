import type { Config } from '@netlify/functions';
import { createHmac, timingSafeEqual } from 'node:crypto';

export const config: Config = {
  path: '/.netlify/functions/videoUpload',
  rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
interface Ticket { id: string; kind: 'upload' | 'asset'; owner: string; created: number }
interface MuxObject {
  id?: string; url?: string; status?: string; asset_id?: string; passthrough?: string;
  playback_ids?: { id: string; policy: string }[]; object?: { id: string; type: string };
}
const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9-]{1,128}$/.test(value);
const signature = (payload: string) => createHmac('sha256', process.env.MUX_TOKEN_SECRET!).update('hary-video-ticket:' + payload).digest('base64url');
function sign(ticket: Ticket) {
  const payload = Buffer.from(JSON.stringify(ticket)).toString('base64url');
  return payload + '.' + signature(payload);
}
function readTicket(value: unknown, owner: string): Ticket | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const [payload, mac, extra] = value.split('.');
    if (!payload || !mac || extra) return null;
    const expected = Buffer.from(signature(payload));
    const received = Buffer.from(mac);
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
    const ticket = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Ticket;
    return validId(ticket.id) && ['upload', 'asset'].includes(ticket.kind) && ticket.owner === owner &&
      Number.isFinite(ticket.created) && Date.now() - ticket.created < 30 * 86400_000 ? ticket : null;
  } catch { return null; }
}
async function mux(path: string, method = 'GET', body?: object): Promise<MuxObject> {
  const response = await fetch('https://api.mux.com/video/v1/' + path, {
    method, signal: AbortSignal.timeout(12_000),
    headers: { Authorization: 'Basic ' + Buffer.from(process.env.MUX_TOKEN_ID + ':' + process.env.MUX_TOKEN_SECRET).toString('base64'), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error('Mux request failed');
  if (response.status === 204) return {};
  return ((await response.json()) as { data: MuxObject }).data;
}

export default async function handler(request: Request): Promise<Response> {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  const reply = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers });
  const origin = request.headers.get('origin');
  const allowed = ['https://harypictures.netlify.app', process.env.URL, process.env.DEPLOY_PRIME_URL, ...(process.env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim())].filter(Boolean);
  const development = process.env.NETLIFY_DEV === 'true' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || '');
  if (!origin || (!allowed.includes(origin) && !development)) return reply(403, { error: 'Forbidden' });
  if (request.method !== 'POST') return reply(405, { error: 'Method not allowed' });
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return reply(415, { error: 'Expected JSON' });
  if (!/^Bearer [\w.-]+$/.test(request.headers.get('authorization') || '')) return reply(401, { error: 'Sign in to manage videos.' });
  if (!process.env.MUX_TOKEN_ID || !process.env.MUX_TOKEN_SECRET || !process.env.MUX_ADMIN_USER_IDS || !process.env.VITE_SUPABASE_URL || !process.env.VITE_SUPABASE_ANON_KEY) {
    return reply(503, { error: 'Video processing is not connected yet. Complete the video service setup before uploading.' });
  }
  let body: Record<string, unknown>;
  try {
    const reader = request.body?.getReader();
    if (!reader) return reply(400, { error: 'Request body required' });
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8000) { await reader.cancel(); return reply(413, { error: 'Request too large' }); }
      chunks.push(value);
    }
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(400, { error: 'Invalid request' });
  } catch { return reply(400, { error: 'Invalid JSON' }); }
  const supabase = process.env.VITE_SUPABASE_URL.replace(/\/$/, '');
  const authHeaders = { apikey: process.env.VITE_SUPABASE_ANON_KEY, Authorization: request.headers.get('authorization')! };
  try {
    const verified = await fetch(supabase + '/auth/v1/user', { headers: authHeaders, signal: AbortSignal.timeout(10_000) });
    if (!verified.ok) return reply(401, { error: 'Your session expired. Sign in again.' });
    const user = await verified.json() as { id?: string };
    if (!user.id || !process.env.MUX_ADMIN_USER_IDS.split(',').map(value => value.trim()).includes(user.id)) return reply(403, { error: 'This account is not permitted to manage Mux videos.' });
    const hasReference = async (url: string) => {
      const query = new URLSearchParams({ select: 'id', image_url: 'eq.' + url, limit: '1' });
      const response = await fetch(supabase + '/rest/v1/pictures?' + query, { headers: authHeaders, signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error('Reference check failed');
      const rows: unknown = await response.json();
      if (!Array.isArray(rows)) throw new Error('Invalid reference response');
      return rows.length > 0;
    };
    if (body.action === 'create') {
      if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 200) return reply(400, { error: 'Provide a video name.' });
      const upload = await mux('uploads', 'POST', { cors_origin: origin, timeout: 86400, new_asset_settings: { playback_policies: ['public'], video_quality: 'basic', passthrough: 'hary:' + user.id, meta: { title: body.name } } });
      if (!validId(upload.id) || !upload.url || new URL(upload.url).protocol !== 'https:') throw new Error('Invalid upload response');
      return reply(200, { ticket: sign({ id: upload.id, kind: 'upload', owner: user.id, created: Date.now() }), url: upload.url });
    }
    if (body.action === 'import') {
      if (typeof body.url !== 'string') return reply(400, { error: 'Choose an existing video.' });
      const source = new URL(body.url);
      if (source.origin !== new URL(supabase).origin || !source.pathname.startsWith('/storage/v1/object/public/pictures/') || source.username || source.password || !/\.(mp4|webm|mov|m4v|ogv)$/i.test(source.pathname) || !await hasReference(body.url)) return reply(400, { error: 'Choose a video stored in this portfolio.' });
      const asset = await mux('assets', 'POST', { inputs: [{ url: source.href }], playback_policies: ['public'], video_quality: 'basic', passthrough: 'hary:' + user.id });
      if (!validId(asset.id)) throw new Error('Invalid asset response');
      return reply(200, { ticket: sign({ id: asset.id, kind: 'asset', owner: user.id, created: Date.now() }) });
    }
    if (body.action === 'status') {
      const ticket = readTicket(body.ticket, user.id);
      if (!ticket) return reply(403, { error: 'Invalid or expired video reference.' });
      let assetId = ticket.id;
      if (ticket.kind === 'upload') {
        const upload = await mux('uploads/' + ticket.id);
        if (['errored', 'cancelled', 'timed_out'].includes(upload.status || '')) return reply(200, { state: 'failed' });
        if (!validId(upload.asset_id)) return reply(200, { state: 'uploading' });
        assetId = upload.asset_id;
      }
      const asset = await mux('assets/' + assetId);
      if (asset.status === 'errored') return reply(200, { state: 'failed' });
      const playback = asset.playback_ids?.find(item => item.policy === 'public');
      if (asset.status !== 'ready' || !playback || !validId(playback.id)) return reply(200, { state: 'processing' });
      return reply(200, { state: 'ready', url: `https://stream.mux.com/${playback.id}.m3u8` });
    }
    if (body.action === 'delete') {
      if (!validId(body.playbackId)) return reply(400, { error: 'Invalid video.' });
      if (await hasReference(`https://stream.mux.com/${body.playbackId}.m3u8`)) return reply(409, { error: 'This video is still used in the portfolio.' });
      const playback = await mux('playback-ids/' + body.playbackId);
      if (playback.object?.type !== 'asset' || !validId(playback.object.id)) return reply(400, { error: 'Invalid video.' });
      const asset = await mux('assets/' + playback.object.id);
      if (!asset.passthrough?.startsWith('hary:')) return reply(403, { error: 'This video was not created by this website.' });
      await mux('assets/' + playback.object.id, 'DELETE');
      return reply(200, { success: true });
    }
    return reply(400, { error: 'Unknown action.' });
  } catch {
    // Never expose API tokens, upload URLs or provider response details.
    return reply(502, { error: 'Video processing is temporarily unavailable. Check the Mux account limit or try again.' });
  }
}
