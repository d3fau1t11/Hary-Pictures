import { supabase } from '../admin/supabaseClient';
import type { MediaItem, StudioCategory } from '../admin/studio/data';

export const muxEnabled = import.meta.env.VITE_MUX_ENABLED === 'true';
export interface VideoJob {
  id: string; owner: string; ticket: string; name: string; categoryId: string;
  replacement?: { id: string; url: string }; uploaded: boolean; fingerprint?: string;
}
const storageKey = 'hary-video-jobs-v1';
export function videoJobs(): VideoJob[] {
  try { const value = JSON.parse(localStorage.getItem(storageKey) || '[]'); return Array.isArray(value) ? value.filter(job => typeof job.id === 'string' && typeof job.ticket === 'string') : []; }
  catch { return []; }
}
function storeJob(job: VideoJob) {
  const jobs = videoJobs().filter(value => value.id !== job.id);
  localStorage.setItem(storageKey, JSON.stringify([...jobs, job]));
}
export function forgetJob(id: string) { localStorage.setItem(storageKey, JSON.stringify(videoJobs().filter(job => job.id !== id))); }
export async function muxApi(body: object): Promise<{ ticket?: string; url?: string; state?: string; success?: boolean }> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new Error('Sign in again to manage videos.');
  const response = await fetch('/.netlify/functions/videoUpload', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + data.session.access_token },
    body: JSON.stringify(body), signal: AbortSignal.timeout(40_000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Video processing is unavailable.');
  return result;
}
async function owner() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error('Sign in again to upload.');
  return data.session.user.id;
}
function makeJob(user: string, name: string, categoryId: string, replacement?: MediaItem): VideoJob {
  return { id: crypto.randomUUID(), owner: user, name, categoryId, ticket: '', uploaded: false,
    replacement: replacement ? { id: replacement.id, url: replacement.image_url } : undefined };
}
export async function uploadMuxVideo(file: File, category: StudioCategory, title: string, replacement?: MediaItem, progress?: (message: string) => void) {
  const user = await owner();
  const fingerprint = [file.name, file.size, file.lastModified, category.id, replacement?.id || ''].join('|');
  const previous = videoJobs().find(job => job.owner === user && job.fingerprint === fingerprint);
  if (previous?.uploaded) return 'Video uploaded and processing. Open Processing videos to finish publishing it.';
  // Verify persistence before creating a remote upload, so its ticket cannot be lost.
  localStorage.setItem(storageKey, JSON.stringify(videoJobs()));
  const job = previous || makeJob(user, title.trim() || file.name, category.id, replacement);
  let url: string;
  if (previous) {
    const state = await muxApi({ action: 'status', ticket: previous.ticket });
    if (state.state === 'ready' || state.state === 'processing') { storeJob({ ...previous, uploaded: true }); return 'Video is processing. Open Processing videos to finish publishing it.'; }
    throw new Error('The earlier transfer was interrupted. Open Processing videos for recovery instructions before starting a new upload.');
  } else {
    const result = await muxApi({ action: 'create', name: job.name.slice(0, 200) });
    if (!result.ticket || !result.url) throw new Error('No upload destination was returned.');
    job.ticket = result.ticket; job.fingerprint = fingerprint; url = result.url;
    storeJob(job);
  }
  const { createUpload } = await import('@mux/upchunk');
  await new Promise<void>((resolve, reject) => {
    const upload = createUpload({ endpoint: url, file, chunkSize: 5120, dynamicChunkSize: true, attempts: 5, delayBeforeAttempt: 2 });
    upload.on('progress', event => progress?.('Uploading video… ' + Math.round(Number(event.detail)) + '%'));
    upload.on('offline', () => progress?.('Connection lost. Upload will continue when you are online.'));
    upload.on('success', () => resolve());
    upload.on('error', () => { upload.abort(); reject(new Error('The video transfer was interrupted. Check Processing videos before uploading again.')); });
  });
  storeJob({ ...job, uploaded: true });
  return 'Video uploaded. Open Processing videos to publish it when processing finishes. You can close this upload window.';
}
export async function importMuxVideo(item: MediaItem) {
  if (!item.category_id) throw new Error('Choose a category for this video first.');
  const user = await owner();
  const previous = videoJobs().find(job => job.owner === user && job.replacement?.id === item.id);
  if (previous) return;
  localStorage.setItem(storageKey, JSON.stringify(videoJobs()));
  const job = makeJob(user, item.title, item.category_id, item);
  const result = await muxApi({ action: 'import', url: item.image_url });
  if (!result.ticket) throw new Error('Video processing could not start.');
  storeJob({ ...job, ticket: result.ticket, uploaded: true });
}
export async function publishVideoJob(job: VideoJob): Promise<string> {
  if (job.owner !== await owner()) throw new Error('Sign in with the account that uploaded this video.');
  const result = await muxApi({ action: 'status', ticket: job.ticket });
  if (result.state === 'failed') throw new Error('This transfer expired or processing failed. Remove the failed video in Mux, then dismiss this item and upload again.');
  if (result.state !== 'ready' || !result.url) return result.state || 'processing';
  const id = job.replacement?.id || job.id;
  const current = await supabase.from('pictures').select('id,image_url').eq('id', id).maybeSingle();
  if (current.error) throw current.error;
  if (current.data?.image_url !== result.url) {
    if (job.replacement && current.data?.image_url !== job.replacement.url) throw new Error('The original video changed or was removed. Review it before publishing this replacement.');
    if (!job.replacement && current.data) throw new Error('Another item already uses this reference.');
    const record = { title: job.name, category_id: job.categoryId, image_url: result.url };
    const saved = job.replacement
      ? await supabase.from('pictures').update(record).eq('id', id).eq('image_url', job.replacement.url).select('id').single()
      : await supabase.from('pictures').insert({ id, ...record });
    if (saved.error) throw saved.error;
  }
  forgetJob(job.id);
  // Publication succeeds even when old-file cleanup needs a later manual retry.
  if (job.replacement) {
    try { const { removeStoredFile } = await import('../admin/studio/data'); await removeStoredFile(job.replacement.url); }
    catch { return 'published-cleanup-pending'; }
  }
  return 'published';
}
