import { useState } from 'react';
import { Film } from 'lucide-react';
import { isVideoUrl, videoPosterUrl } from './video';
import './media.css';

export default function MediaCover({ src, alt, className = '', revision = 0 }: { src: string; alt: string; className?: string; revision?: number }) {
  const video = isVideoUrl(src);
  const url = video ? videoPosterUrl(src) : src;
  const [failedUrl, setFailedUrl] = useState('');
  const imageUrl = revision ? url + (url.includes('?') ? '&' : '?') + 'cover=' + revision : url;
  return <span className={'media-cover ' + className}>
    {failedUrl === imageUrl ? <span className="media-cover-fallback" role="img" aria-label={alt || 'Video cover unavailable'}><Film size={32} /><span>{video ? 'Film' : 'Preview unavailable'}</span></span> :
      <img src={imageUrl} alt={alt} loading="lazy" decoding="async" onError={() => setFailedUrl(imageUrl)} />}
    {video && <span className="media-cover-badge" aria-label="Video"><Film size={14} />Video</span>}
  </span>;
}
