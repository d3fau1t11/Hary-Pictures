import { FormEvent, useEffect, useState } from 'react';
import { Check, FileImage, Loader2, Upload, X } from 'lucide-react';
import Dialog from './Dialog';
import { CategoryDialog } from './EditDialogs';
import { importMedia, isWebsiteCategory, MediaItem, messageOf, StudioCategory, uploadMedia, validateFile, websiteCategory } from './data';
import { muxEnabled } from '../../media/muxUploads';
import { isVideoUrl } from '../../media/video';
import { formatBytes } from '../utils/formatBytes';

interface QueueItem { id: string; file: File; status: 'ready' | 'uploading' | 'saved' | 'failed' | 'invalid'; error: string }
function FilePreview({ file }: { file: File }) {
  const [url, setUrl] = useState('');
  useEffect(() => { const objectUrl = URL.createObjectURL(file); setUrl(objectUrl); return () => URL.revokeObjectURL(objectUrl); }, [file]);
  return /\.(jpe?g|png|webp|jfif|jpe)$/i.test(file.name) ? <img className="studio-upload-preview" src={url} alt="" /> : <FileImage className="studio-upload-preview" size={22} />;
}
export default function UploadDialog({ categories, initialCategory = '', kind, replace, onClose, onSaved }: {
  categories: StudioCategory[]; initialCategory?: string; kind?: 'hero' | 'about-me'; replace?: MediaItem;
  onClose: () => void; onSaved: (message: string) => void;
}) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [categoryId, setCategoryId] = useState(initialCategory);
  const [title, setTitle] = useState(replace?.title || '');
  const [mode, setMode] = useState<'files' | 'url'>('files');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [complete, setComplete] = useState(false);
  const [creatingCategory, setCreatingCategory] = useState(false);
  const regular = categories.filter(category => !isWebsiteCategory(category));
  const eligible = queue.filter(item => item.status === 'ready' || item.status === 'failed');
  useEffect(() => {
    if (!busy) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [busy]);
  function addFiles(files: File[]) {
    if (busy || complete) return;
    setError(''); setComplete(false);
    if ((kind || replace) && files.length > 1) { setError('Choose one file for this replacement.'); return; }
    const additions = files.map(file => {
      const error = validateFile(file, Boolean(kind));
      return { id: crypto.randomUUID(), file, status: error ? 'invalid' as const : 'ready' as const, error };
    });
    setQueue(previous => kind || replace ? additions : [...previous, ...additions.filter(item => !previous.some(existing => existing.file.name === item.file.name && existing.file.size === item.file.size && existing.file.lastModified === item.file.lastModified))]);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError('');
    let saved = 0;
    let warning = '';
    try {
      const category = kind ? await websiteCategory(kind, categories) : regular.find(item => item.id === categoryId);
      if (!category) throw new Error('Choose a category for your media.');
      if (mode === 'url') { await importMedia(url, category, title); saved = 1; setComplete(true); }
      else {
        for (const item of eligible) {
          setQueue(previous => previous.map(row => row.id === item.id ? { ...row, status: 'uploading', error: '' } : row));
          try {
            const outcome = await uploadMedia(item.file, category, title, replace, message => setQueue(previous => previous.map(row => row.id === item.id ? { ...row, error: message } : row)));
            warning = outcome || warning;
            saved++;
            setQueue(previous => previous.map(row => row.id === item.id ? { ...row, status: 'saved', error: outcome || '' } : row));
          } catch (failure) {
            setQueue(previous => previous.map(row => row.id === item.id ? { ...row, status: 'failed', error: messageOf(failure) } : row));
          }
        }
        setComplete(saved === eligible.length && eligible.length > 0);
        if (saved < eligible.length) setError('Some files could not be uploaded. Your successful uploads are saved. Retry the remaining files below.');
      }
      if (saved) onSaved(warning || (kind ? 'Website photo saved.' : saved + (saved === 1 ? ' item added to your library.' : ' items added to your library.')));
    } catch (failure) { setError(messageOf(failure)); }
    finally { setBusy(false); }
  }
  return <><Dialog title={replace && !kind ? 'Replace video' : kind ? (replace ? 'Replace ' : 'Add ') + (kind === 'hero' ? 'homepage cover' : 'About photo') : 'Upload media'} busy={busy} onClose={onClose} wide>
    {!kind && !replace && <div className="studio-tabs" aria-label="Upload method"><button type="button" aria-pressed={mode === 'files'} disabled={busy || complete} onClick={() => { setMode('files'); setComplete(false); }}>From device</button><button type="button" aria-pressed={mode === 'url'} disabled={busy || complete} onClick={() => { setMode('url'); setComplete(false); }}>From a link</button></div>}
    <form className="studio-form" onSubmit={submit}>
      {kind && <p className="studio-muted">{replace ? 'Your current photo stays live until the replacement is saved.' : 'Choose a photo to display on your website.'}</p>}
      {replace && !kind && <p className="studio-muted">Your current video stays live until the replacement is saved. Videos are prepared for playback after uploading.</p>}
      {mode === 'files' ? <>
        <div className={'studio-dropzone' + (dragging ? ' is-dragging' : '')} onDragOver={event => { event.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); if (!busy) addFiles(Array.from(event.dataTransfer.files)); }}>
          <Upload size={27} /><strong>{kind ? 'Choose your photo' : 'Drop your files here'}</strong><p className="studio-help">{kind ? 'JPG, PNG, WebP · Optimized automatically' : 'Photos and videos · Select multiple files'}</p><label className="studio-button studio-quiet" htmlFor="studio-upload-files">{queue.length && !kind ? 'Add more files' : 'Browse files'}</label><input id="studio-upload-files" type="file" disabled={busy || complete} multiple={!kind && !replace} accept={kind ? '.jpg,.jpeg,.png,.webp,.jfif,.jpe' : '.jpg,.jpeg,.png,.webp,.jfif,.jpe,.mp4,.webm,.mov,.m4v,.ogv'} onChange={event => { addFiles(Array.from(event.target.files || [])); event.target.value = ''; }} />
        </div>
        {queue.length > 0 && <div className="studio-upload-list" aria-label="Selected files">{queue.map(item => <div className="studio-upload-row" key={item.id}><FilePreview file={item.file} /><div className="studio-upload-info"><strong>{item.file.name}</strong><p className={item.status === 'saved' ? 'is-success' : item.status === 'failed' || item.status === 'invalid' ? 'is-error' : ''}>{item.status === 'saved' ? item.error || 'Saved to your website' : item.error || (item.status === 'uploading' ? 'Preparing and uploading…' : formatBytes(item.file.size))}</p></div>{item.status === 'uploading' ? <Loader2 size={18} className="studio-spin" /> : item.status === 'saved' ? <Check size={18} /> : <button type="button" className="studio-icon-button" aria-label={'Remove ' + item.file.name} disabled={busy || complete} onClick={() => setQueue(previous => previous.filter(row => row.id !== item.id))}><X size={18} /></button>}</div>)}</div>}
      </> : <div className="studio-field"><label htmlFor="studio-import-url">Image link</label><input id="studio-import-url" type="url" required value={url} onChange={event => { setUrl(event.target.value); setComplete(false); }} placeholder="https://example.com/photo.webp" disabled={busy || complete} /><p className="studio-help">Use a direct HTTPS link to a WebP image. It will stay hosted at the original address.</p></div>}
      {!kind && <div className="studio-field"><label htmlFor="studio-upload-category">Category</label><select id="studio-upload-category" value={categoryId} onChange={event => setCategoryId(event.target.value)} disabled={busy || complete} required><option value="">Choose a category</option>{regular.map(category => <option key={category.id} value={category.id}>{category.name_am}</option>)}</select><button type="button" className="studio-text-link" disabled={busy || complete} onClick={() => setCreatingCategory(true)}>Create a category</button></div>}
      <div className="studio-field"><label htmlFor="studio-upload-title">Title <span className="studio-muted">(optional)</span></label><input id="studio-upload-title" value={title} onChange={event => setTitle(event.target.value)} disabled={busy || complete} maxLength={200} placeholder="Leave blank to use the file name" /></div>
      {error && <p className="studio-alert" role="alert">{error}</p>}
      {busy && <p role="status" className="studio-help">{queue.filter(item => item.status === 'saved').length} of {queue.filter(item => item.status !== 'invalid').length} files saved. Keep this window open.</p>}
      {complete && <p className="studio-notice" role="status">{muxEnabled && queue.some(item => isVideoUrl(item.file.name)) ? 'Uploads finished. Open Processing videos to publish the videos when ready.' : 'All done. Your files have been saved.'}</p>}
      <div className="studio-dialog-actions"><button type="button" className="studio-button studio-quiet" onClick={onClose} disabled={busy}>{complete ? 'Done' : 'Cancel'}</button>{!complete && <button className="studio-button studio-primary" disabled={busy || (!kind && !categoryId) || (mode === 'files' ? !eligible.length : !url.trim())}>{busy ? <><Loader2 size={18} className="studio-spin" /> Saving…</> : kind ? 'Save photo' : mode === 'url' ? 'Add image' : 'Upload ' + eligible.length + (eligible.length === 1 ? ' file' : ' files')}</button>}</div>
    </form>
  </Dialog>{creatingCategory && <CategoryDialog onClose={() => setCreatingCategory(false)} onSaved={onSaved} />}</>;
}
