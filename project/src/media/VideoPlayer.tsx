import { useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { muxPlaybackId, videoMimeType, videoPosterUrl } from './video';
import './media.css';

export default function VideoPlayer({ src, title, autoPlay = false }: { src: string; title: string; autoPlay?: boolean }) {
  const player = useRef<HTMLVideoElement>(null);
  const [waiting, setWaiting] = useState(false);
  const [failed, setFailed] = useState(false);
  const playback = muxPlaybackId(src);
  if (playback) return <div className="media-player media-mux-player"><iframe src={`https://player.mux.com/${playback}?accent-color=%233529F9&autoplay=${autoPlay ? 'true' : 'false'}`} title={title || 'Video player'} allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowFullScreen /></div>;
  return <div className="media-player" onKeyDown={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}>
    <video ref={player} controls playsInline preload="auto" autoPlay={autoPlay} poster={videoPosterUrl(src)} aria-label={title || 'Video player'}
      onWaiting={() => setWaiting(true)} onPlaying={() => setWaiting(false)} onCanPlay={() => setWaiting(false)} onPause={() => setWaiting(false)} onError={() => { setFailed(true); setWaiting(false); }}>
      <source src={src} type={videoMimeType(src)} onError={() => { setFailed(true); setWaiting(false); }} />
    </video>
    {waiting && !failed && <span className="media-player-loading" role="status"><Loader2 size={20} className="media-spin" />Buffering…</span>}
    {failed && <div className="media-player-error" role="alert"><p>This video could not play. Check your connection or try another browser.</p><button type="button" onClick={() => { setFailed(false); player.current?.load(); }}>Try again</button><a href={src} target="_blank" rel="noreferrer">Open original video</a></div>}
  </div>;
}
