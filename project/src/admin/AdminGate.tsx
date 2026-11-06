import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { supabase } from './supabaseClient';
import Login from './Login';
import AdminPanel from './AdminPanel';
import './studio/studio.css';

export default function AdminGate() {
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [recovery, setRecovery] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    let mounted = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      setEmail(session?.user.email || null);
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      setLoading(false);
    });
    supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return;
      setEmail(error ? null : data.session?.user.email || null);
      setLoading(false);
    }).catch(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);
  if (loading) return <div className="studio studio-loading" role="status"><Loader2 className="studio-spin" size={26} /><p>Opening your studio…</p></div>;
  if (!email) return <Login />;
  if (recovery || location.pathname === '/admin/reset-password') return <Login recovery onPasswordChanged={() => { setRecovery(false); navigate('/admin/library', { replace: true }); }} />;
  return <AdminPanel email={email} />;
}
