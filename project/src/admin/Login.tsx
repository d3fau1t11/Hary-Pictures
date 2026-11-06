import { FormEvent, useState } from 'react';
import { ArrowLeft, ArrowRight, Eye, EyeOff, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from './supabaseClient';
import { messageOf } from './studio/data';
import Brand, { BrandMark } from './studio/Brand';

export default function Login({ recovery = false, onPasswordChanged }: { recovery?: boolean; onPasswordChanged?: () => void }) {
  const [mode, setMode] = useState<'login' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const emailError = submitted && !recovery && !validEmail;
  const passwordError = submitted && (recovery ? password.length < 8 : mode === 'login' && !password);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true); setError(''); setNotice('');
    if ((!recovery && !validEmail) || (recovery ? password.length < 8 : mode === 'login' && !password)) return;
    setBusy(true);
    try {
      if (recovery) {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        onPasswordChanged?.();
      } else if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin + '/admin/reset-password' });
        if (error) throw error;
        setNotice('If an account exists for this email, you’ll receive a password reset link.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw new Error(error.message === 'Invalid login credentials' ? 'The email or password is incorrect. Please try again.' : error.message);
      }
    } catch (error) { setError(messageOf(error)); }
    finally { setBusy(false); }
  }
  function changeMode() { setMode(mode === 'login' ? 'forgot' : 'login'); setError(''); setNotice(''); setSubmitted(false); }
  return <div className="studio studio-login">
    <header className="studio-login-header"><Brand to="/" /><Link className="studio-text-link" to="/" aria-label="Back to website"><ArrowLeft size={16} /><span>Back to website</span></Link></header>
    <main className="studio-login-main">
      <section className="studio-login-card" aria-labelledby="login-title"><BrandMark className="studio-mark" /><h2 id="login-title">{recovery ? 'Set a new password' : mode === 'forgot' ? 'Let’s get you back in' : 'Welcome back'}</h2><p className="studio-muted">{recovery ? 'Choose a password with at least 8 characters.' : mode === 'forgot' ? 'We’ll email you a link to reset your password.' : 'Sign in to manage your portfolio.'}</p>
        <form onSubmit={submit} noValidate className="studio-form">
          {!recovery && <div className="studio-field"><label htmlFor="studio-email">Email address</label><input id="studio-email" name="email" type="email" autoComplete="username" inputMode="email" autoCapitalize="none" spellCheck={false} value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" aria-invalid={Boolean(emailError)} aria-describedby={emailError ? 'email-error' : undefined} disabled={busy} required />{emailError && <p id="email-error" className="studio-field-error">Enter a valid email address.</p>}</div>}
          {(recovery || mode === 'login') && <div className="studio-field"><div className="studio-label-row"><label htmlFor="studio-password">{recovery ? 'New password' : 'Password'}</label>{!recovery && <button type="button" className="studio-text-link" disabled={busy} onClick={changeMode}>Forgot password?</button>}</div><div className="studio-password"><input id="studio-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete={recovery ? 'new-password' : 'current-password'} value={password} onChange={event => setPassword(event.target.value)} placeholder={recovery ? 'At least 8 characters' : 'Enter your password'} aria-invalid={Boolean(passwordError)} aria-describedby={passwordError ? 'password-error' : undefined} disabled={busy} required /><button type="button" className="studio-icon-button" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={19} /> : <Eye size={19} />}</button></div>{passwordError && <p id="password-error" className="studio-field-error">{recovery ? 'Use at least 8 characters.' : 'Enter your password.'}</p>}</div>}
          {error && <p className="studio-alert" role="alert">{error}</p>}{notice && <p className="studio-notice" role="status">{notice}</p>}
          <button className="studio-button studio-primary studio-full" disabled={busy}>{busy ? <><Loader2 size={18} className="studio-spin" /> Please wait…</> : <>{recovery ? 'Save password' : mode === 'forgot' ? 'Send reset link' : 'Sign in'}<ArrowRight size={18} /></>}</button>
          {!recovery && mode === 'forgot' && <button type="button" className="studio-button studio-quiet studio-full" onClick={changeMode}>Back to sign in</button>}
        </form><p className="studio-login-footnote">A private workspace for the Hary Pictures team.</p>
      </section>
    </main><footer className="studio-login-footer">Hary Pictures <span>Made for the moments that matter.</span></footer>
  </div>;
}
