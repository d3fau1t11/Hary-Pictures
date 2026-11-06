import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, NavLink, useLocation, useSearchParams } from 'react-router-dom';
import { ArrowRight, Check, ExternalLink, Folder, FolderPlus, Image, LayoutGrid, LogOut, MoreHorizontal, PanelTop, Plus, Search, Trash2, Upload, X } from 'lucide-react';
import { supabase } from './supabaseClient';
import { formatBytes } from './utils/formatBytes';
import { isVideo, isWebsiteCategory, loadStorageSize, loadStudio, MediaItem, mediaTime, messageOf, sortMedia, StudioCategory } from './studio/data';
import Dialog from './studio/Dialog';
import MediaCover from '../media/MediaCover';
import VideoCoverDialog from './studio/VideoCoverDialog';
import ProcessingVideosDialog from './studio/ProcessingVideosDialog';
import { importMuxVideo, muxEnabled } from '../media/muxUploads';
import { muxPlaybackId } from '../media/video';
import Brand from './studio/Brand';
import UploadDialog from './studio/UploadDialog';
import { CategoryDialog, DeleteDialog, MediaDialog, MoveDialog } from './studio/EditDialogs';

const destinations = [
  { id: 'library', label: 'Library', icon: Image },
  { id: 'categories', label: 'Categories', icon: Folder },
  { id: 'website', label: 'Website', icon: PanelTop },
  { id: 'overview', label: 'Overview', icon: LayoutGrid },
];
type Modal = { type: 'upload'; kind?: 'hero' | 'about-me'; replace?: MediaItem } | { type: 'category'; category?: StudioCategory } | { type: 'detail'; item: MediaItem } | { type: 'delete'; items?: MediaItem[]; category?: StudioCategory } | { type: 'move'; items: MediaItem[] } | { type: 'processing' } | { type: 'covers'; items: MediaItem[] } | { type: 'account' } | null;

export default function AdminPanel({ email }: { email: string }) {
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const section = location.pathname.split('/')[2] || 'library';
  const [categories, setCategories] = useState<StudioCategory[]>([]);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [limit, setLimit] = useState(48);
  const [modal, setModal] = useState<Modal>(section === 'media' ? { type: 'upload' } : null);
  const [signingOut, setSigningOut] = useState(false);
  const [storage, setStorage] = useState<{ size?: number; error?: string }>({});
  const [revision, setRevision] = useState(0);
  const request = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const selectAll = useRef<HTMLInputElement>(null);
  const regularCategories = useMemo(() => categories.filter(category => !isWebsiteCategory(category)), [categories]);
  const library = useMemo(() => media.filter(item => !item.categories || !isWebsiteCategory(item.categories)), [media]);
  const refresh = useCallback(async (initial = false) => {
    const id = ++request.current;
    if (initial) setLoading(true);
    try {
      const data = await loadStudio();
      if (id !== request.current) return;
      setCategories(data.categories); setMedia(data.media); setError('');
    } catch (failure) { if (id === request.current) setError(messageOf(failure)); }
    finally { if (id === request.current) setLoading(false); }
  }, []);
  useEffect(() => { const counter = request; void refresh(true); return () => { counter.current++; }; }, [refresh]);
  useEffect(() => { setSelected([]); setLimit(48); heading.current?.focus({ preventScroll: true }); }, [section]);
  useEffect(() => {
    if (section !== 'overview') return;
    let current = true;
    setStorage({});
    loadStorageSize().then(size => { if (current) setStorage({ size }); }).catch(error => { if (current) setStorage({ error: messageOf(error) }); });
    return () => { current = false; };
  }, [section, revision]);
  function saved(message: string) { setToast(message); setSelected([]); setRevision(value => value + 1); void refresh(); }
  const query = params.get('q') || '';
  const categoryId = params.get('cat') || '';
  const type = params.get('type') || '';
  const sort = params.get('sort') || 'newest';
  const filtered = useMemo(() => sortMedia(library.filter(item =>
    (!categoryId || (item.category_id || item.categories?.id) === categoryId) &&
    (!query || (item.title + ' ' + (item.categories?.name_am || '')).toLocaleLowerCase().includes(query.toLocaleLowerCase())) &&
    (!type || (type === 'video' ? isVideo(item.image_url) : !isVideo(item.image_url)))
  ), sort), [library, categoryId, query, type, sort]);
  const visible = filtered.slice(0, limit);
  useEffect(() => {
    if (selectAll.current) selectAll.current.indeterminate = selected.length > 0 && !visible.every(item => selected.includes(item.id));
  }, [selected, visible]);
  function filter(key: string, value: string) {
    setParams(previous => { const next = new URLSearchParams(previous); if (value) next.set(key, value); else next.delete(key); return next; }, { replace: true });
    setSelected([]); setLimit(48);
  }
  async function signOut() {
    setSigningOut(true); setError('');
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    } catch (failure) { setError(messageOf(failure)); }
    finally { setSigningOut(false); }
  }
  const selectedItems = library.filter(item => selected.includes(item.id));
  const page = destinations.find(item => item.id === section);
  if (location.pathname === '/admin' || location.pathname === '/admin/') return <Navigate to={'/admin/library' + location.search} replace />;
  if (!page) return <Navigate to={(section === 'dashboard' ? '/admin/overview' : '/admin/library') + location.search} replace />;
  const descriptions: Record<string, string> = { library: 'Your photographs and films, all in one place.', categories: 'Give every story a place in your portfolio.', website: 'The photographs that introduce your work.', overview: 'A clear picture of your portfolio.' };
  function navLinks() { return destinations.map(({ id, label, icon: Icon }) => <NavLink key={id} to={'/admin/' + id}><Icon size={19} /><span>{label}</span></NavLink>); }
  function cards(items: MediaItem[], selectable = true) {
    return <div className="studio-grid">{items.map(item => <article className={'studio-media-card' + (selected.includes(item.id) ? ' is-selected' : '')} key={item.id}>
      {selectable && <label className="studio-media-check"><input type="checkbox" aria-label={'Select ' + item.title} checked={selected.includes(item.id)} onChange={event => setSelected(previous => event.target.checked ? [...previous, item.id] : previous.filter(id => id !== item.id))} /></label>}
      <button className="studio-thumbnail" onClick={() => setModal({ type: 'detail', item })} aria-label={'Open ' + item.title}><MediaCover src={item.image_url} alt="" revision={revision} />{isVideo(item.image_url) && <span className="studio-type-badge">VIDEO</span>}</button>
      <div className="studio-media-caption"><div><h3 title={item.title}>{item.title || 'Untitled'}</h3><p>{item.categories?.name_am || 'Uncategorized'}</p></div><button className="studio-icon-button" aria-label={'Edit ' + item.title} onClick={() => setModal({ type: 'detail', item })}><MoreHorizontal size={18} /></button></div>
    </article>)}</div>;
  }
  return <div className="studio studio-shell">
    <aside className="studio-sidebar"><Brand /><p className="studio-eyebrow" style={{ padding: '0 13px', marginBottom: 15 }}>WORKSPACE</p><nav className="studio-nav" aria-label="Studio navigation">{navLinks()}</nav><div className="studio-sidebar-bottom"><div className="studio-account"><div className="studio-avatar">{email[0].toUpperCase()}</div><div className="studio-account-text" title={email}><strong>Studio account</strong>{email}</div><button className="studio-icon-button" aria-label="Sign out" disabled={signingOut} onClick={signOut}><LogOut size={17} /></button></div></div></aside>
    <div className="studio-workspace"><header className="studio-topbar"><div className="studio-mobile-brand"><Brand /></div><p className="studio-topbar-title">Workspace / <span>{page.label}</span></p><Link to="/" target="_blank" className="studio-button studio-quiet"><ExternalLink size={15} />View website</Link><button className="studio-icon-button studio-mobile-account" aria-label="Your account" onClick={() => setModal({ type: 'account' })}><span className="studio-avatar">{email[0].toUpperCase()}</span></button></header>
      <main className="studio-content"><div className="studio-page-heading"><div><h1 ref={heading} tabIndex={-1}>{page.label === 'Library' ? 'Media library' : page.label}</h1><p>{descriptions[section]}</p></div><div className="studio-heading-actions">{muxEnabled && section === 'library' && <button className="studio-button studio-quiet" onClick={() => setModal({ type: 'processing' })}>Processing videos</button>}{section === 'categories' ? <button className="studio-button studio-primary" onClick={() => setModal({ type: 'category' })} disabled={loading}><Plus size={17} />New category</button> : section !== 'website' && <button className="studio-button studio-primary" onClick={() => setModal({ type: 'upload' })} disabled={loading}><Plus size={17} />Upload media</button>}</div></div>
        {error && <div className="studio-alert" role="alert" style={{ marginBottom: 22 }}><p>{error}</p><button className="studio-text-link" onClick={() => void refresh(true)}>Try again</button></div>}
        {loading ? <div className="studio-grid" role="status" aria-label="Loading your media">{Array.from({ length: 8 }, (_, index) => <div className="studio-skeleton" key={index} />)}</div> : <>
          {section === 'library' && <>
            <div className="studio-toolbar"><div className="studio-search"><Search size={18} /><input type="search" aria-label="Search media" placeholder="Search your library…" value={query} onChange={event => filter('q', event.target.value)} /></div><select aria-label="Filter by category" value={categoryId} onChange={event => filter('cat', event.target.value)}><option value="">All categories</option>{regularCategories.map(item => <option key={item.id} value={item.id}>{item.name_am}</option>)}</select><select aria-label="Filter by media type" value={type} onChange={event => filter('type', event.target.value)}><option value="">All media</option><option value="image">Photos</option><option value="video">Videos</option></select><select aria-label="Sort media" value={sort} onChange={event => filter('sort', event.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="title">Title A–Z</option></select></div>
            {selected.length > 0 && <div className="studio-selection-bar">{media.some(item => selected.includes(item.id) && isVideo(item.image_url) && !muxPlaybackId(item.image_url)) && <button className="studio-button studio-quiet" onClick={() => setModal({ type: 'covers', items: media.filter(item => selected.includes(item.id) && isVideo(item.image_url) && !muxPlaybackId(item.image_url)) })}>Generate covers</button>}<span>{selected.length} selected</span><button className="studio-button studio-quiet" onClick={() => setModal({ type: 'move', items: selectedItems })}><Folder size={16} />Move</button><button className="studio-button studio-danger" onClick={() => setModal({ type: 'delete', items: selectedItems })}><Trash2 size={16} />Delete</button><button className="studio-icon-button" aria-label="Clear selection" onClick={() => setSelected([])}><X size={18} /></button></div>}
            {filtered.length ? <><div className="studio-result-line"><label className="studio-select-all"><input ref={selectAll} type="checkbox" checked={visible.length > 0 && visible.every(item => selected.includes(item.id))} onChange={event => setSelected(event.target.checked ? visible.map(item => item.id) : [])} />Select visible</label><span>{filtered.length} {filtered.length === 1 ? 'item' : 'items'}</span></div>{cards(visible)}{filtered.length > limit && <button className="studio-button studio-full" style={{ marginTop: 25 }} onClick={() => setLimit(value => value + 48)}>Show more ({filtered.length - limit} remaining)</button>}</> : <div className="studio-empty"><Image size={34} /><h2>{library.length ? 'No matching media' : 'Your next story starts here'}</h2><p>{library.length ? 'Try a different search or clear your filters.' : 'Upload your first photographs or films to start building your portfolio.'}</p><button className="studio-button studio-primary" onClick={() => library.length ? (setParams({}), setSelected([])) : setModal({ type: 'upload' })}>{library.length ? 'Clear filters' : 'Upload your first media'}</button></div>}
          </>}
          {section === 'categories' && (regularCategories.length ? <div className="studio-category-list">{regularCategories.map(category => { const count = library.filter(item => (item.category_id || item.categories?.id) === category.id).length; return <div className="studio-category-row" key={category.id}><div className="studio-category-icon"><Folder size={20} /></div><div className="studio-category-info"><h3><Link to={'/admin/library?cat=' + category.id}>{category.name_am}</Link></h3><p>{count} {count === 1 ? 'item' : 'items'}</p></div><div className="studio-row-actions"><button className="studio-button studio-quiet" aria-label={'Edit category ' + category.name_am} onClick={() => setModal({ type: 'category', category })}>Edit</button><button className="studio-icon-button" aria-label={'Delete category ' + category.name_am} onClick={() => setModal({ type: 'delete', category })}><Trash2 size={17} /></button></div></div>; })}</div> : <div className="studio-empty"><FolderPlus size={35} /><h2>A place for every story</h2><p>Create categories such as Weddings, Portraits, or Events to organize your work.</p><button className="studio-button studio-primary" onClick={() => setModal({ type: 'category' })}>Create a category</button></div>)}
          {section === 'website' && <div className="studio-website-grid">{(['hero', 'about-me'] as const).map(kind => { const item = media.find(item => item.categories?.slug === kind); const label = kind === 'hero' ? 'Homepage cover' : 'About photo'; return <article className="studio-website-card" key={kind}><div className={'studio-website-preview' + (kind === 'about-me' ? ' is-portrait' : '')}>{item ? <img src={item.image_url} alt={'Current ' + label.toLowerCase()} /> : <Image size={42} />}{kind === 'hero' && <div className="studio-website-overlay"><span>HARY PICTURES</span><strong>Stories worth remembering.</strong></div>}</div><div className="studio-website-body"><h2>{label}</h2><p>{kind === 'hero' ? 'The first impression on your homepage. A wide photograph works best.' : 'Introduce the person behind the camera. Choose a clear portrait.'}</p><div className="studio-website-actions"><button className="studio-button studio-primary" onClick={() => setModal({ type: 'upload', kind, replace: item })}><Upload size={16} />{item ? 'Replace photo' : 'Add photo'}</button><Link to={kind === 'hero' ? '/' : '/about'} target="_blank" className="studio-button studio-quiet">View page<ExternalLink size={14} /></Link>{item && <button className="studio-icon-button" aria-label={"Remove " + label.toLowerCase()} onClick={() => setModal({ type: "delete", items: [item] })}><Trash2 size={17} /></button>}</div></div></article>; })}</div>}
          {section === 'overview' && <>
            <div className="studio-stats"><div className="studio-stat"><p>Media in your library</p><strong>{library.length}</strong><small>{library.filter(item => !isVideo(item.image_url)).length} photos · {library.filter(item => isVideo(item.image_url)).length} videos</small></div><div className="studio-stat"><p>Portfolio categories</p><strong>{regularCategories.length}</strong><small>Collections of your work</small></div><div className="studio-stat"><p>Stored media</p><strong>{storage.size !== undefined ? formatBytes(storage.size) : storage.error ? '—' : '…'}</strong>{storage.error ? <button className="studio-text-link" title={storage.error} onClick={() => setRevision(value => value + 1)}>Couldn’t load · Retry</button> : <small>Files in your media storage</small>}</div></div>
            <section className="studio-panel"><div className="studio-panel-heading"><h2>Recently added</h2><Link to="/admin/library" className="studio-text-link">View library<ArrowRight size={16} /></Link></div>{library.some(item => mediaTime(item) > 0) ? cards(sortMedia(library.filter(item => mediaTime(item) > 0), 'newest').slice(0, 6), false) : <p className="studio-muted">Your recent uploads will appear here.</p>}</section>
          </>}
        </>}
      </main>
    </div>
    <nav className="studio-mobile-nav" aria-label="Mobile studio navigation">{navLinks()}</nav>
    {toast && <div className="studio-toast" role="status"><Check size={18} /><p>{toast}</p><button className="studio-icon-button" aria-label="Dismiss notification" onClick={() => setToast('')}><X size={18} /></button></div>}
    {modal?.type === 'upload' && <UploadDialog categories={categories} initialCategory={modal.replace?.category_id || categoryId} kind={modal.kind} replace={modal.replace} onClose={() => setModal(null)} onSaved={saved} />}
    {modal?.type === 'category' && <CategoryDialog category={modal.category} onClose={() => setModal(null)} onSaved={saved} />}
    {modal?.type === 'detail' && <MediaDialog item={modal.item} categories={regularCategories} onClose={() => setModal(null)} onSaved={saved} onOptimize={async () => { await importMuxVideo(modal.item); setModal({ type: 'processing' }); }} onCover={() => setModal({ type: 'covers', items: [modal.item] })} onReplace={() => setModal({ type: 'upload', replace: modal.item })} onDelete={() => setModal({ type: 'delete', items: [modal.item] })} />}
    {modal?.type === 'delete' && <DeleteDialog items={modal.items} category={modal.category} onClose={() => setModal(null)} onSaved={saved} />}
    {modal?.type === 'move' && <MoveDialog items={modal.items} categories={regularCategories} onClose={() => setModal(null)} onSaved={saved} />}
    {modal?.type === 'processing' && <ProcessingVideosDialog onClose={() => setModal(null)} onSaved={saved} />}
    {modal?.type === 'covers' && <VideoCoverDialog items={modal.items} onClose={() => setModal(null)} onSaved={saved} />}
    {modal?.type === 'account' && <Dialog title="Your account" busy={signingOut} onClose={() => setModal(null)}><div className="studio-form">{error && <p className="studio-alert" role="alert">{error}</p>}<p className="studio-muted" style={{ overflowWrap: 'anywhere' }}>{email}</p><Link className="studio-button studio-quiet" to="/" target="_blank">View website<ExternalLink size={16} /></Link><button className="studio-button" disabled={signingOut} onClick={signOut}><LogOut size={17} />{signingOut ? 'Signing out…' : 'Sign out'}</button></div></Dialog>}
  </div>;
}
