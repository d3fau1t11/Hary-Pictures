import { supabase } from '../supabaseClient';
import { convertToWebP } from '../utils/convertToWebP';
import { createVideoPoster, isVideoUrl, muxPlaybackId, videoMimeType } from '../../media/video';
import { muxApi, muxEnabled, uploadMuxVideo } from '../../media/muxUploads';

export interface StudioCategory { id: string; name_am: string; slug: string }
export interface MediaItem { id: string; title: string; image_url: string; category_id: string | null; created_at?: string; categories: StudioCategory | null }
export const isWebsiteCategory = (category: StudioCategory) => ['hero', 'about-me', 'aboutme'].includes(category.slug.toLowerCase());
export const messageOf = (error: unknown) => error instanceof Error ? error.message : typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : 'Something went wrong. Please try again.';
export const isVideo = isVideoUrl;
export function mediaTime(item: MediaItem) {
  const date = item.created_at ? Date.parse(item.created_at) : NaN;
  if (Number.isFinite(date)) return date;
  const timestamp = item.image_url.match(/\/(\d{13})[-.]/)?.[1];
  return timestamp ? Number(timestamp) : 0;
}
export function sortMedia(items: MediaItem[], sort: string) {
  return [...items].sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title) : (sort === 'oldest' ? 1 : -1) * (mediaTime(a) - mediaTime(b)) || a.id.localeCompare(b.id));
}
export function makeSlug(name: string) {
  return name.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'collection-' + crypto.randomUUID().slice(0, 8);
}
export async function loadStudio() {
  const [categories, pictures] = await Promise.all([
    supabase.from('categories').select('id,name_am,slug').order('name_am'),
    supabase.from('pictures').select('*,categories(id,name_am,slug)'),
  ]);
  if (categories.error) throw categories.error;
  if (pictures.error) throw pictures.error;
  return { categories: categories.data as StudioCategory[], media: pictures.data.map(item => ({ ...item, categories: Array.isArray(item.categories) ? item.categories[0] || null : item.categories })) as MediaItem[] };
}
export async function saveCategory(name: string, current?: StudioCategory) {
  const query = current
    ? supabase.from('categories').update({ name_am: name.trim() }).eq('id', current.id)
    : supabase.from('categories').insert({ name_am: name.trim(), slug: makeSlug(name) });
  const { error } = await query.select('id').single();
  if (error?.code === '23505') throw new Error('A category with this name already exists. Try another name.');
  if (error) throw error;
}
export async function deleteCategory(category: StudioCategory) {
  // A fresh count prevents deleting a category that acquired media since the page loaded.
  const { count, error } = await supabase.from('pictures').select('id', { count: 'exact', head: true }).eq('category_id', category.id);
  if (error) throw error;
  if (count) throw new Error('Move this category’s media to another category before deleting it.');
  const result = await supabase.from('categories').delete().eq('id', category.id).select('id').single();
  if (result.error) throw result.error;
}
export function storagePath(url: string) {
  try {
    const parsed = new URL(url);
    const base = new URL(import.meta.env.VITE_SUPABASE_URL);
    const prefix = '/storage/v1/object/public/pictures/';
    return parsed.origin === base.origin && parsed.pathname.startsWith(prefix) ? decodeURIComponent(parsed.pathname.slice(prefix.length)) : null;
  } catch { return null; }
}
export async function removeStoredFile(url: string) {
  const playbackId = muxPlaybackId(url);
  if (playbackId) { await muxApi({ action: 'delete', playbackId }); return; }
  const path = storagePath(url);
  if (!path) return;
  // Shared URL imports must keep working when one record is removed or replaced.
  const references = await supabase.from('pictures').select('id', { count: 'exact', head: true }).eq('image_url', url);
  if (references.error) throw references.error;
  if (references.count) return;
  const { error } = await supabase.storage.from('pictures').remove(isVideo(url) ? [path, path + '.poster.webp'] : [path]);
  if (error) throw error;
}
export async function deleteMedia(item: MediaItem) {
  const { error } = await supabase.from('pictures').delete().eq('id', item.id).select('id').single();
  if (error) throw error;
  try { await removeStoredFile(item.image_url); }
  catch { return 'Media removed from the website. Its stored file could not be cleaned up.'; }
}
export async function updateMedia(item: MediaItem, title: string, categoryId: string) {
  const { error } = await supabase.from('pictures').update({ title: title.trim(), category_id: categoryId }).eq('id', item.id).select('id').single();
  if (error) throw error;
}
export function validateFile(file: File, imagesOnly = false) {
  const image = /\.(jpe?g|png|webp|jfif|jpe)$/i.test(file.name);
  const video = /\.(mp4|webm|mov|m4v|ogv)$/i.test(file.name);
  if (!image && (!video || imagesOnly)) return imagesOnly ? 'Choose a JPG, PNG, or WebP image.' : 'Choose JPG, PNG, WebP, MP4, WebM, MOV, M4V, or OGV files.';
  if (file.size === 0) return 'This file is empty.';
  return '';
}
export async function uploadMedia(file: File, category: StudioCategory, title: string, replace?: MediaItem, progress?: (message: string) => void) {
  const validation = validateFile(file, isWebsiteCategory(category));
  if (validation) throw new Error(validation);
  const video = /\.(mp4|webm|mov|m4v|ogv)$/i.test(file.name);
  if (video && muxEnabled) return uploadMuxVideo(file, category, title, replace, progress);
  const prepared = video ? file : await convertToWebP(file);
  let poster: File | undefined;
  let warning = '';
  if (video) {
    try { poster = await createVideoPoster(file); }
    catch { warning = 'Video saved. This browser could not create its cover. Open the video details to choose a cover image.'; }
  }
  const extension = video ? file.name.split('.').pop()!.toLowerCase() : 'webp';
  const path = 'public/' + category.slug + '/' + Date.now() + '-' + crypto.randomUUID() + '.' + extension;
  const bucket = supabase.storage.from('pictures');
  const upload = await bucket.upload(path, prepared, { upsert: false, contentType: video ? videoMimeType(file.name) : 'image/webp' });
  if (upload.error) throw upload.error;
  if (poster) {
    const cover = await bucket.upload(path + '.poster.webp', poster, { upsert: false, contentType: 'image/webp', cacheControl: '60' });
    if (cover.error) { await bucket.remove([path, path + '.poster.webp']); throw cover.error; }
  }
  const publicUrl = bucket.getPublicUrl(path).data.publicUrl;
  const record = { title: title.trim() || file.name.replace(/\.[^.]+$/, ''), image_url: publicUrl, category_id: category.id };
  const saved = replace ? await supabase.from('pictures').update(record).eq('id', replace.id).select('id').single() : await supabase.from('pictures').insert(record);
  if (saved.error) {
    await bucket.remove(poster ? [path, path + '.poster.webp'] : [path]);
    throw saved.error;
  }
  // Keep the currently published photo until the replacement is saved successfully.
  if (replace) {
    try { await removeStoredFile(replace.image_url); }
    catch { return 'Media replaced. The old stored file could not be cleaned up.'; }
  }
  return warning;
}

export async function saveVideoCover(item: MediaItem, cover?: File, seconds = 1) {
  const path = storagePath(item.image_url);
  if (!path || !isVideo(item.image_url)) throw new Error('Only videos stored in this library can have saved covers.');
  if (cover) {
    const error = validateFile(cover, true);
    if (error) throw new Error(error);
    if (cover.size > 20 * 1024 * 1024) throw new Error('Choose a cover image smaller than 20 MB.');
  }
  const file = cover ? await convertToWebP(cover) : await createVideoPoster(item.image_url, seconds);
  const { error } = await supabase.storage.from('pictures').upload(path + '.poster.webp', file, { upsert: true, contentType: 'image/webp', cacheControl: '60' });
  if (error) throw error;
}
export async function importMedia(url: string, category: StudioCategory, title: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !/\.webp$/i.test(parsed.pathname)) throw new Error('Use a direct HTTPS link to a WebP image.');
  const { error } = await supabase.from('pictures').insert({ title: title.trim() || category.name_am, category_id: category.id, image_url: parsed.href });
  if (error) throw error;
}
export async function websiteCategory(kind: 'hero' | 'about-me', categories: StudioCategory[]) {
  const existing = categories.find(category => category.slug === kind);
  if (existing) return existing;
  const { data, error } = await supabase.from('categories').insert({ name_am: kind === 'hero' ? 'Hero' : 'About Me', slug: kind }).select('id,name_am,slug').single();
  if (error) throw error;
  return data as StudioCategory;
}
export async function loadStorageSize() {
  let size = 0;
  const folders = ['public'];
  const bucket = supabase.storage.from('pictures');
  while (folders.length) {
    const folder = folders.pop()!;
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await bucket.list(folder, { limit: 100, offset });
      if (error) throw error;
      for (const file of data) {
        if (file.id) size += Number(file.metadata?.size) || 0;
        else folders.push(folder + '/' + file.name);
      }
      if (data.length < 100) break;
    }
  }
  return size;
}
