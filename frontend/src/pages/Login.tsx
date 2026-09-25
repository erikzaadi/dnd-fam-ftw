import { useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { apiFetch, apiUrl } from '../lib/api';
import { formatWait, savePendingEmailSignIn } from '../lib/emailSignIn';
import { useAuth } from '../contexts/AuthContext';
import { SiteHeader } from '../components/SiteHeader';
import { DmFooter } from '../components/DmFooter';
import type { EmailSignInErrorResponse, EmailSignInStartResponse } from '../types';

const ERROR_MESSAGES: Record<string, string> = {
  unauthorized: "That account isn't on the guest list. Ask the DM to add you.",
  oauth: "Google sign-in didn't finish. Please try again.",
  use_email_code: 'New here? Create your account with an email code first. After that, Google sign-in works too.',
};

const startErrorMessage = (body: EmailSignInErrorResponse | null): string => {
  switch (body?.error) {
  case 'invalid_email':
    return "That doesn't look like an email address.";
  case 'rate_limited':
    return `Too many codes requested. Try again in ${formatWait(body.retryAfterSeconds ?? 60)}.`;
  case 'email_unavailable':
    return "We couldn't send email right now. Please try again in a bit.";
  default:
    return 'Something went wrong. Please try again.';
  }
};

export const Login = () => {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { config } = useAuth();
  const errorKey = searchParams.get('error');
  const redirectError = errorKey ? ERROR_MESSAGES[errorKey] : undefined;
  const [email, setEmail] = useState(() => (location.state as { email?: string } | null)?.email ?? '');
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const googleEnabled = config?.providers.google ?? false;
  const emailEnabled = config?.providers.email ?? false;
  const signupOpen = config?.signupMode === 'open';

  const handleGoogle = () => {
    window.location.href = apiUrl('/auth/google');
  };

  const handleEmail = async (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email.trim() || sending) {
      return;
    }
    setSending(true);
    setFormError(null);
    try {
      const res = await apiFetch('/auth/email/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (res.status !== 202) {
        setFormError(startErrorMessage(await res.json().catch(() => null) as EmailSignInErrorResponse | null));
        return;
      }
      const data = await res.json() as EmailSignInStartResponse;
      const now = Date.now();
      savePendingEmailSignIn({
        challengeId: data.challengeId,
        email: email.trim(),
        maskedEmail: data.maskedEmail,
        resendAt: now + data.resendAfterSeconds * 1000,
        expiresAt: now + data.expiresInSeconds * 1000,
      });
      navigate('/verify-email');
    } catch {
      setFormError("Couldn't reach the realm. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-slate-950 text-white flex flex-col">
      <SiteHeader />

      {/* Login card */}
      <div className="flex-1 flex items-center justify-center px-4 py-6 relative z-[10]">
        <div className="bg-slate-900/80 border-2 border-slate-800 rounded-[32px] p-6 sm:p-8 max-w-sm w-full space-y-6 text-center">
          <div>
            <h2 className="text-2xl font-display font-black text-amber-400 italic tracking-tighter">Welcome, Adventurer</h2>
            <p className="text-slate-400 text-sm mt-2">
              {signupOpen ? 'New here? Verify your email and start playing.' : 'Sign in to access your party and realms.'}
            </p>
          </div>

          {redirectError && (
            <div className="bg-rose-950/60 border border-rose-800/60 rounded-2xl px-4 py-3 text-rose-300 text-sm">
              {redirectError}
            </div>
          )}

          {!config && (
            <p className="text-slate-500 text-sm animate-pulse">Opening the realm gate...</p>
          )}

          {emailEnabled && (
            <form onSubmit={handleEmail} className="space-y-3 text-left">
              <label htmlFor="login-email" className="text-slate-400 text-xs uppercase tracking-wider">Email</label>
              <input
                id="login-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full bg-slate-800/60 border border-slate-700 rounded-2xl px-4 py-3 text-slate-100 text-base focus:outline-none focus:border-amber-600"
              />
              {formError && <p role="alert" className="text-rose-300 text-sm">{formError}</p>}
              <button
                type="submit"
                disabled={sending || !email.trim()}
                className="w-full py-4 bg-amber-500 hover:bg-amber-400 disabled:opacity-60 rounded-[20px] font-black uppercase italic tracking-tighter transition-colors shadow-[0_4px_0_rgb(180,83,9)] text-slate-950 cursor-pointer disabled:cursor-not-allowed"
              >
                {sending ? 'Sending...' : 'Email me a code'}
              </button>
            </form>
          )}

          {emailEnabled && googleEnabled && (
            <div className="flex items-center gap-3 text-slate-600 text-xs uppercase tracking-wider">
              <span className="flex-1 h-px bg-slate-800" />
              or
              <span className="flex-1 h-px bg-slate-800" />
            </div>
          )}

          {googleEnabled && (
            <button
              onClick={handleGoogle}
              className="w-full py-4 bg-white hover:bg-slate-100 rounded-[20px] font-black uppercase italic tracking-tighter transition-colors shadow-[0_4px_0_rgb(203,213,225)] text-slate-900 flex items-center justify-center gap-3 cursor-pointer"
            >
              <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              {emailEnabled ? 'Continue with Google' : 'Sign in with Google'}
            </button>
          )}

          {!signupOpen && (
            <p className="text-slate-600 text-xs">This is a private server. New visitors can request an invite after signing in.</p>
          )}
        </div>
      </div>
      <DmFooter />
    </div>
  );
};
