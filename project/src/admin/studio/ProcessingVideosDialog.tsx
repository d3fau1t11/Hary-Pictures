import { useEffect, useState } from 'react';
import Dialog from './Dialog';
import { forgetJob, publishVideoJob, videoJobs, VideoJob } from '../../media/muxUploads';
import { supabase } from '../supabaseClient';
import { messageOf } from './data';

export default function ProcessingVideosDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (message: string) => void }) {
  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const [states, setStates] = useState<Record<string, string>>({});
  const [checking, setChecking] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { let active = true; supabase.auth.getSession().then(({ data }) => { if (active) { setJobs(videoJobs().filter(job => job.owner === data.session?.user.id)); setLoaded(true); } }); return () => { active = false; }; }, []);
  async function check() {
    setChecking(true); setError('');
    const remaining: VideoJob[] = [];
    let saved = 0;
    let cleanup = false;
    try {
      for (const job of jobs) {
        try {
          const state = await publishVideoJob(job);
          setStates(previous => ({ ...previous, [job.id]: state }));
          if (state.startsWith('published')) { saved++; cleanup ||= state === 'published-cleanup-pending'; }
          else remaining.push(job);
        } catch (failure) { remaining.push(job); setStates(previous => ({ ...previous, [job.id]: messageOf(failure) })); }
      }
      setJobs(remaining);
      if (saved) onSaved(`${saved} video${saved === 1 ? '' : 's'} published.` + (cleanup ? ' The old file could not be cleaned up.' : ''));
    } catch (failure) { setError(messageOf(failure)); }
    finally { setChecking(false); }
  }
  return <Dialog title="Processing videos" busy={checking} onClose={onClose}>
    <div className="studio-form"><p className="studio-muted">Videos are optimized online after uploading. Check here to publish ready videos. Existing videos stay live until their replacements are ready.</p>
      <p className="studio-help">You can return on this browser after processing finishes. Keep this page open while a file is still transferring.</p>
      {loaded && !jobs.length && <p className="studio-notice" role="status">No videos waiting to be published on this browser.</p>}
      {jobs.map(job => <div key={job.id} className="studio-field"><strong>{job.name}</strong><p className="studio-help" role="status">{states[job.id] === 'uploading' ? 'Upload not complete. Check the video in Mux before retrying.' : states[job.id] === 'processing' ? 'Still processing. Check again shortly.' : states[job.id] || (job.uploaded ? 'Uploaded — check when ready.' : 'Transfer started — check its status.')}</p><button type="button" className="studio-text-link" disabled={checking} onClick={() => { if (window.confirm('Dismiss this pending item? This does not delete the video from Mux. Remove any unused asset in Mux to free a video slot.')) { forgetJob(job.id); setJobs(previous => previous.filter(item => item.id !== job.id)); } }}>Dismiss pending item</button></div>)}
      {error && <p className="studio-alert" role="alert">{error}</p>}
      <div className="studio-dialog-actions"><button type="button" className="studio-button studio-quiet" disabled={checking} onClick={onClose}>Close</button>{jobs.length > 0 && <button type="button" className="studio-button studio-primary" disabled={checking} onClick={check}>{checking ? 'Checking…' : 'Publish ready videos'}</button>}</div>
    </div>
  </Dialog>;
}
