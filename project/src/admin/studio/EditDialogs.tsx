import { FormEvent, useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import Dialog from './Dialog';
import VideoPlayer from '../../media/VideoPlayer';
import { muxPlaybackId } from '../../media/video';
import { muxEnabled } from '../../media/muxUploads';
import { deleteCategory, deleteMedia, isVideo, MediaItem, mediaTime, messageOf, saveCategory, StudioCategory, updateMedia } from './data';

export function CategoryDialog({ category, onClose, onSaved }: { category?: StudioCategory; onClose: () => void; onSaved: (message: string) => void }) {
  const [name, setName] = useState(category?.name_am || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!name.trim()) { setError('Enter a category name.'); return; }
    setBusy(true); setError('');
    try { await saveCategory(name, category); onSaved(category ? 'Category updated.' : 'Category created.'); onClose(); }
    catch (failure) { setError(messageOf(failure)); } finally { setBusy(false); }
  }
  return <Dialog title={category ? 'Edit category' : 'Create category'} busy={busy} onClose={onClose}><form className="studio-form" onSubmit={submit}><p className="studio-muted">Group your work so visitors can explore it easily.</p><div className="studio-field"><label htmlFor="studio-category-name">Category name</label><input id="studio-category-name" autoFocus value={name} maxLength={100} onChange={event => setName(event.target.value)} placeholder="e.g. Weddings or ሰርግ" required disabled={busy} /><p className="studio-help">Use the name you want visitors to see, in any language.</p></div>{error && <p className="studio-alert" role="alert">{error}</p>}<div className="studio-dialog-actions"><button type="button" className="studio-button studio-quiet" disabled={busy} onClick={onClose}>Cancel</button><button className="studio-button studio-primary" disabled={busy || !name.trim()}>{busy ? 'Saving…' : category ? 'Save changes' : 'Create category'}</button></div></form></Dialog>;
}
export function MediaDialog({ item, categories, onClose, onSaved, onDelete, onCover, onReplace, onOptimize }: { item: MediaItem; categories: StudioCategory[]; onClose: () => void; onSaved: (message: string) => void; onDelete: () => void; onCover: () => void; onReplace: () => void; onOptimize: () => Promise<void> }) {
  const [title, setTitle] = useState(item.title);
  const [category, setCategory] = useState(item.category_id || item.categories?.id || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { await updateMedia(item, title, category); onSaved('Media details saved.'); onClose(); }
    catch (failure) { setError(messageOf(failure)); } finally { setBusy(false); }
  }
  return <Dialog title="Media details" onClose={onClose} busy={busy} wide><form className="studio-form" onSubmit={submit}>
    {isVideo(item.image_url) ? <VideoPlayer src={item.image_url} title={item.title} /> : <a href={item.image_url} target="_blank" rel="noreferrer" aria-label="Open full-size photo in a new tab"><img className="studio-detail-preview" src={item.image_url} alt={item.title} /></a>}
    {isVideo(item.image_url) && <div className="studio-dialog-actions">{!muxPlaybackId(item.image_url) && <button type="button" className="studio-button studio-quiet" disabled={busy} onClick={onCover}>Change video cover</button>}{muxEnabled && !muxPlaybackId(item.image_url) && <button type="button" className="studio-button studio-quiet" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await onOptimize(); } catch (failure) { setError(messageOf(failure)); } finally { setBusy(false); } }}>Optimize for streaming</button>}<button type="button" className="studio-button studio-quiet" disabled={busy} onClick={onReplace}>Replace video</button></div>}
    {Boolean(mediaTime(item)) && <p className="studio-detail-meta">Added {new Date(mediaTime(item)).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</p>}
    <div className="studio-field"><label htmlFor="studio-media-title">Title</label><input id="studio-media-title" value={title} onChange={event => setTitle(event.target.value)} maxLength={200} required disabled={busy} /></div>
    <div className="studio-field"><label htmlFor="studio-media-category">Category</label><select id="studio-media-category" value={category} onChange={event => setCategory(event.target.value)} required disabled={busy}><option value="">Choose a category</option>{categories.map(row => <option key={row.id} value={row.id}>{row.name_am}</option>)}</select></div>
    {error && <p className="studio-alert" role="alert">{error}</p>}
    <div className="studio-dialog-actions"><button type="button" className="studio-button studio-danger" disabled={busy} onClick={onDelete}><Trash2 size={16} />Delete</button><button className="studio-button studio-primary" disabled={busy || !title.trim()}>{busy ? 'Saving…' : 'Save changes'}</button></div>
  </form></Dialog>;
}
export function DeleteDialog({ items, category, onClose, onSaved }: { items?: MediaItem[]; category?: StudioCategory; onClose: () => void; onSaved: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [remaining, setRemaining] = useState(items || []);
  async function confirm() {
    setBusy(true); setError('');
    let removed = 0;
    let warning = '';
    try {
      if (category) { await deleteCategory(category); onSaved('Category deleted.'); onClose(); return; }
      const failures: MediaItem[] = [];
      const messages: string[] = [];
      for (const item of remaining) {
        try { warning = await deleteMedia(item) || warning; removed++; }
        catch (failure) { failures.push(item); messages.push(messageOf(failure)); }
      }
      setRemaining(failures);
      if (removed) onSaved(warning || removed + (removed === 1 ? ' item deleted.' : ' items deleted.'));
      if (failures.length) setError('Could not delete ' + failures.length + ' item(s). ' + messages[0]);
      else onClose();
    } catch (failure) { setError(messageOf(failure)); }
    finally { setBusy(false); }
  }
  return <Dialog title={category ? 'Delete category?' : 'Delete ' + remaining.length + (remaining.length === 1 ? ' item?' : ' items?')} onClose={onClose} busy={busy}><div className="studio-form"><p className="studio-muted">{category ? '“' + category.name_am + '” will be removed. Only empty categories can be deleted.' : 'These items will be removed from your website and library. This cannot be undone.'}</p>{!category && <ul className="studio-bulk-list">{remaining.map(item => <li key={item.id}>{item.title || 'Untitled'}</li>)}</ul>}{error && <p className="studio-alert" role="alert">{error}</p>}<div className="studio-dialog-actions"><button autoFocus type="button" className="studio-button studio-quiet" disabled={busy} onClick={onClose}>Keep {category ? 'category' : 'media'}</button><button className="studio-button studio-danger" disabled={busy} onClick={confirm}>{busy ? <><Loader2 size={17} className="studio-spin" />Deleting…</> : 'Delete permanently'}</button></div></div></Dialog>;
}
export function MoveDialog({ items, categories, onClose, onSaved }: { items: MediaItem[]; categories: StudioCategory[]; onClose: () => void; onSaved: (message: string) => void }) {
  const [category, setCategory] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [remaining, setRemaining] = useState(items);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    const failed: MediaItem[] = [];
    for (const item of remaining) {
      try { await updateMedia(item, item.title, category); }
      catch (failure) { failed.push(item); setError(messageOf(failure)); }
    }
    if (remaining.length > failed.length) onSaved('Media categories updated.');
    setRemaining(failed); setBusy(false);
    if (!failed.length) onClose();
  }
  return <Dialog title="Move media" onClose={onClose} busy={busy}><form className="studio-form" onSubmit={submit}><p className="studio-muted">Choose a category for {remaining.length} selected item(s).</p><div className="studio-field"><label htmlFor="studio-move-category">Destination category</label><select id="studio-move-category" value={category} onChange={event => setCategory(event.target.value)} required disabled={busy}><option value="">Choose a category</option>{categories.map(row => <option key={row.id} value={row.id}>{row.name_am}</option>)}</select></div>{error && <p className="studio-alert" role="alert">{error} Successful changes are saved. Retry to move the remaining items.</p>}<div className="studio-dialog-actions"><button type="button" className="studio-button studio-quiet" disabled={busy} onClick={onClose}>Cancel</button><button className="studio-button studio-primary" disabled={busy || !category}>{busy ? 'Moving…' : 'Move media'}</button></div></form></Dialog>;
}
