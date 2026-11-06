import { useState } from 'react';
import Dialog from './Dialog';
import MediaCover from '../../media/MediaCover';
import { MediaItem, messageOf, saveVideoCover } from './data';

export default function VideoCoverDialog({ items, onClose, onSaved }: { items: MediaItem[]; onClose: () => void; onSaved: (message: string) => void }) {
  const [file, setFile] = useState<File>();
  const [seconds, setSeconds] = useState('1');
  const [busy, setBusy] = useState(false);
  const [remaining, setRemaining] = useState(items);
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState(0);
  const [revision, setRevision] = useState(0);
  const single = items.length === 1;
  async function generate() {
    const position = Number(seconds);
    if (!Number.isFinite(position) || position < 0 || seconds.trim() === '') { setErrors(['Enter a valid frame time in seconds.']); return; }
    setBusy(true); setErrors([]);
    const failed: MediaItem[] = [];
    const messages: string[] = [];
    let count = 0;
    for (const item of remaining) {
      try { await saveVideoCover(item, single ? file : undefined, position); count++; setSaved(value => value + 1); }
      catch (error) { failed.push(item); messages.push(item.title + ': ' + messageOf(error)); }
    }
    setRemaining(failed); setErrors(messages); setBusy(false); setRevision(Date.now());
    if (count) onSaved(count + (count === 1 ? ' video cover saved.' : ' video covers saved.'));
  }
  return <Dialog title={single ? 'Video cover' : 'Generate video covers'} onClose={onClose} busy={busy}>
    <div className="studio-form">
      <p className="studio-muted">{single ? 'Choose a frame from the video or upload a cover image.' : 'Create covers for the selected videos, one at a time. Successful covers are saved even if another video fails.'}</p>
      {single && <div style={{ aspectRatio: '16 / 9', maxHeight: 220 }}><MediaCover src={items[0].image_url} alt={items[0].title} revision={revision} /></div>}
      <div className="studio-field"><label htmlFor="cover-seconds">Frame time (seconds)</label><input id="cover-seconds" type="number" min="0" step="0.1" value={seconds} disabled={busy || Boolean(file) || !remaining.length} onChange={event => setSeconds(event.target.value)} /><p className="studio-help">For short videos, the nearest available frame is used.</p></div>
      {single && <div className="studio-field"><label htmlFor="cover-file">Or choose a cover image</label><input id="cover-file" type="file" accept=".jpg,.jpeg,.png,.webp" disabled={busy || !remaining.length} onChange={event => setFile(event.target.files?.[0])} /></div>}
      {errors.map(error => <p className="studio-alert" role="alert" key={error}>{error}</p>)}
      {(busy || saved > 0) && <p className="studio-help" role="status">{saved} of {items.length} covers saved.{busy ? ' Keep this window open.' : ''}</p>}
      <div className="studio-dialog-actions"><button type="button" className="studio-button studio-quiet" disabled={busy} onClick={onClose}>{remaining.length ? 'Cancel' : 'Done'}</button>{remaining.length > 0 && <button type="button" className="studio-button studio-primary" disabled={busy} onClick={generate}>{busy ? 'Creating covers…' : errors.length ? 'Retry remaining' : file ? 'Save cover' : 'Generate cover' + (single ? '' : 's')}</button>}</div>
    </div>
  </Dialog>;
}
