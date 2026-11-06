export function videoMimeType(url: string): string | undefined {
  if (muxPlaybackId(url)) return 'application/vnd.apple.mpegurl';
  const extension = url.split(/[?#]/)[0].split('.').pop()?.toLowerCase();
  return ({ mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', ogv: 'video/ogg', avi: 'video/x-msvideo', mkv: 'video/x-matroska' } as Record<string, string>)[extension || ''];
}

export const isVideoUrl = (url: string) => Boolean(videoMimeType(url));

export function muxPlaybackId(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === 'stream.mux.com'
      ? parsed.pathname.match(/^\/([a-zA-Z0-9]+)\.m3u8$/)?.[1] || null : null;
  } catch { return null; }
}

// Sidecars need no database migration and stay associated when categories change.
export function videoPosterUrl(url: string): string {
  const playback = muxPlaybackId(url);
  if (playback) return `https://image.mux.com/${playback}/thumbnail.webp?width=800&fit_mode=preserve`;
  const parsed = new URL(url, window.location.origin);
  parsed.pathname += '.poster.webp';
  parsed.hash = '';
  return parsed.href;
}

/** Extract once in the admin, never on a visitor's gallery load. */
export async function createVideoPoster(source: File | string, seconds = 1): Promise<File> {
  const video = document.createElement('video');
  const ownedUrl = typeof source !== 'string' ? URL.createObjectURL(source) : null;
  video.crossOrigin = 'anonymous';
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  let timeout: ReturnType<typeof setTimeout>;
  try {
    const blob = await new Promise<Blob>((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error('Could not read a video frame. Choose a cover image or prepare the video as MP4.')), 20_000);
      let capturing = false;
      const capture = () => {
        if (capturing || video.readyState < 2 || !video.videoWidth) return;
        capturing = true;
        const scale = Math.min(1, 800 / Math.max(video.videoWidth, video.videoHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        try {
          const context = canvas.getContext('2d');
          if (!context) throw new Error('Image processing is unavailable.');
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(result => result?.type === 'image/webp' ? resolve(result) : reject(new Error('This browser cannot create WebP covers.')), 'image/webp', 0.82);
        } catch { reject(new Error('Could not capture this video. Choose a cover image instead.')); }
      };
      video.onerror = () => reject(new Error('This browser cannot read this video. Prepare it as MP4 or choose a cover image.'));
      video.onloadedmetadata = () => {
        const duration = Number.isFinite(video.duration) ? video.duration : 1;
        const target = Math.min(Math.max(0, seconds), Math.max(0, duration - 0.1));
        if (target === 0) { video.onloadeddata = capture; capture(); }
        else { video.onseeked = capture; video.currentTime = target; }
      };
      video.src = ownedUrl || String(source);
      video.load();
    });
    return new File([blob], 'cover.webp', { type: 'image/webp' });
  } finally {
    clearTimeout(timeout!);
    video.onloadedmetadata = video.onloadeddata = video.onseeked = video.onerror = null;
    video.pause();
    video.removeAttribute('src');
    video.load();
    if (ownedUrl) URL.revokeObjectURL(ownedUrl);
  }
}
