import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { clearPendingEmailSignIn, formatWait, loadPendingEmailSignIn, savePendingEmailSignIn } from '../lib/emailSignIn';
import type { PendingEmailSignIn } from '../lib/emailSignIn';
import { useAuth } from '../contexts/AuthContext';
import { SiteHeader } from '../components/SiteHeader';
import { DmFooter } from '../components/DmFooter';
import type { EmailSignInErrorResponse, EmailSignInResendResponse, EmailSignInVerifyResponse } from '../types';

const useNow = (intervalMs: number) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
};

export const VerifyEmail = () => {
  const navigate = useNavigate();
  const { refetch } = useAuth();
  const [pending, setPending] = useState<PendingEmailSignIn | null>(() => loadPendingEmailSignIn());
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The code expired, was replaced, or used up its attempts: only a new code helps.
  const [expired, setExpired] = useState(false);
  const now = useNow(1000);

  useEffect(() => {
    if (!pending) {
      navigate('/login', { replace: true });
    }
  }, [pending, navigate]);

  if (!pending) {
    return null;
  }

  const resendIn = Math.max(0, Math.ceil((pending.resendAt - now) / 1000));
  const digits = code.replace(/[\s-]/g, '');
  const codeComplete = /^\d{8}$/.test(digits);

  const startOver = () => {
    clearPendingEmailSignIn();
    navigate('/login', { replace: true, state: { email: pending.email } });
  };

  const verify = async (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!codeComplete || verifying) {
      return;
    }
    setVerifying(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch('/auth/email/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeId: pending.challengeId, code: digits }),
      });
      if (res.ok) {
        const data = await res.json() as EmailSignInVerifyResponse;
        clearPendingEmailSignIn();
        if (data.next === '/') {
          await refetch();
        }
        navigate(data.next, { replace: true });
        return;
      }
      const body = await res.json().catch(() => null) as EmailSignInErrorResponse | null;
      if (body?.error === 'invalid_code') {
        const left = body.attemptsLeft ?? 0;
        if (left === 0) {
          setExpired(true);
          setError("That code isn't right, and there are no tries left. Request a new code.");
        } else {
          setError(`That code isn't right. ${left} ${left === 1 ? 'try' : 'tries'} left.`);
        }
      } else if (body?.error === 'rate_limited') {
        setError(`Too many tries. Wait ${formatWait(body.retryAfterSeconds ?? 60)} and try again.`);
      } else if (body?.error === 'expired') {
        setExpired(true);
        setError('This code has expired or was replaced by a newer one. Request a new code.');
      } else {
        setError('Something went wrong. Please try again.');
      }
    } catch {
      setError("Couldn't reach the realm. Check your connection and try again.");
    } finally {
      setVerifying(false);
    }
  };

  const resend = async () => {
    if (resendIn > 0 || resending) {
      return;
    }
    setResending(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch('/auth/email/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeId: pending.challengeId }),
      });
      if (res.ok) {
        const data = await res.json() as EmailSignInResendResponse;
        const next = {
          ...pending,
          resendAt: Date.now() + data.resendAfterSeconds * 1000,
          expiresAt: Date.now() + data.expiresInSeconds * 1000,
        };
        savePendingEmailSignIn(next);
        setPending(next);
        setCode('');
        setExpired(false);
        setNotice('A new code is on its way. Only the newest code works.');
        return;
      }
      const body = await res.json().catch(() => null) as EmailSignInErrorResponse | null;
      if (body?.error === 'rate_limited') {
        const next = { ...pending, resendAt: Date.now() + (body.retryAfterSeconds ?? 60) * 1000 };
        setPending(next);
        setError(`Please wait ${formatWait(body.retryAfterSeconds ?? 60)} before asking for another code.`);
      } else if (body?.error === 'email_unavailable') {
        setExpired(true);
        setError("We couldn't send email right now. Start over in a bit.");
      } else {
        setExpired(true);
        setError('This sign-in has expired. Start over to get a new code.');
      }
    } catch {
      setError("Couldn't reach the realm. Check your connection and try again.");
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-slate-950 text-white flex flex-col">
      <SiteHeader />
      <div className="flex-1 flex items-center justify-center px-4 py-6 relative z-[10]">
        <div className="bg-slate-900/80 border-2 border-slate-800 rounded-[32px] p-6 sm:p-8 max-w-sm w-full space-y-5 text-center">
          <div>
            <h2 className="text-2xl font-display font-black text-amber-400 italic tracking-tighter">Check your email</h2>
            <p className="text-slate-400 text-sm mt-2">
              We sent an 8-digit code to <span className="text-slate-200 font-mono">{pending.maskedEmail}</span>. Enter it here, even if you read the email on another device.
            </p>
          </div>

          <form onSubmit={verify} className="space-y-3 text-left">
            <label htmlFor="verify-code" className="text-slate-400 text-xs uppercase tracking-wider">Code</label>
            <input
              id="verify-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={12}
              value={code}
              onChange={e => setCode(e.target.value.replace(/[^\d\s-]/g, ''))}
              placeholder="12345678"
              disabled={expired}
              className="w-full bg-slate-800/60 border border-slate-700 rounded-2xl px-4 py-3 text-slate-100 text-2xl text-center font-mono tracking-[0.3em] focus:outline-none focus:border-amber-600 disabled:opacity-50"
            />
            {error && <p role="alert" className="text-rose-300 text-sm">{error}</p>}
            {notice && <p role="status" className="text-emerald-300 text-sm">{notice}</p>}
            <button
              type="submit"
              disabled={!codeComplete || verifying || expired}
              className="w-full py-4 bg-amber-500 hover:bg-amber-400 disabled:opacity-60 rounded-[20px] font-black uppercase italic tracking-tighter transition-colors shadow-[0_4px_0_rgb(180,83,9)] text-slate-950 cursor-pointer disabled:cursor-not-allowed"
            >
              {verifying ? 'Checking...' : 'Enter the realm'}
            </button>
          </form>

          <div className="flex flex-col gap-2 text-sm">
            <button
              onClick={resend}
              disabled={resendIn > 0 || resending}
              className="text-amber-500 hover:text-amber-400 disabled:text-slate-600 underline disabled:no-underline cursor-pointer disabled:cursor-default"
            >
              {resending ? 'Sending...' : resendIn > 0 ? `Send a new code in ${resendIn}s` : 'Send a new code'}
            </button>
            <button onClick={startOver} className="text-slate-400 hover:text-slate-300 underline cursor-pointer">
              Use a different email
            </button>
          </div>
          <p className="text-slate-600 text-xs">No email? Check your spam folder. The code expires after 10 minutes.</p>
        </div>
      </div>
      <DmFooter />
    </div>
  );
};
