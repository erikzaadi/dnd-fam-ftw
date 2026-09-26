import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { SiteHeader } from '../components/SiteHeader';
import { DmFooter } from '../components/DmFooter';
import type { AcceptInvitationErrorResponse, InspectInvitationResponse, InvitationState } from '../types';

// Read the token from the URL fragment once, then drop it from the address bar and
// history so it is not kept, shared, or bookmarked. It lives only in memory: a reload
// means opening the email link again. The fragment is never sent to any server.
const takeTokenFromUrl = (): string | null => {
  const match = /(?:^|[#&])token=([A-Za-z0-9_-]+)/.exec(window.location.hash);
  if (window.location.hash) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  return match ? match[1] : null;
};

const STATE_MESSAGES: Record<Exclude<InvitationState, 'valid'>, { title: string; body: string }> = {
  invalid: { title: 'This link does not work', body: 'The invitation link is incomplete or not valid. Ask for a new invitation.' },
  expired: { title: 'This invitation expired', body: 'Invitation links last 7 days. Ask whoever invited you to send a new one.' },
  revoked: { title: 'This invitation was cancelled', body: 'It can no longer be used. Ask the realm owner for a new invitation if you still want to join.' },
  superseded: { title: 'A newer invitation was sent', body: 'This link was replaced by a newer email. Use the most recent invitation email.' },
  accepted: { title: 'This invitation was already used', body: 'Each link works once. Sign in to reach your realms.' },
  disabled: { title: 'Invitations are paused', body: 'Joining by invitation is turned off right now. Try the link again later.' },
};

const BASE = import.meta.env.BASE_URL;

export const AcceptInvite = () => {
  const navigate = useNavigate();
  const tokenRef = useRef<string | null | undefined>(undefined);
  const [info, setInfo] = useState<InspectInvitationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [needsSwitchConfirm, setNeedsSwitchConfirm] = useState(false);

  useEffect(() => {
    if (tokenRef.current === undefined) {
      tokenRef.current = takeTokenFromUrl();
    }
    const token = tokenRef.current;
    if (!token) {
      setInfo({ state: 'invalid' });
      return;
    }
    // Inspecting never uses the invitation; only "Join realm" does.
    apiFetch('/auth/invitations/inspect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(async res => {
        if (res.status === 429) {
          setError('Too many attempts. Wait a few minutes and open the link again.');
          return;
        }
        setInfo(res.ok ? await res.json() as InspectInvitationResponse : { state: 'invalid' });
      })
      .catch(() => setError('Could not reach the realm. Check your connection and open the link again.'));
  }, []);

  const join = async (switchAccount: boolean) => {
    const token = tokenRef.current;
    if (!token || joining) {
      return;
    }
    setJoining(true);
    setError(null);
    try {
      const res = await apiFetch('/auth/invitations/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, switchAccount }),
      });
      if (res.ok) {
        // Full load: the new session and realm replace any previous app state.
        window.location.assign(BASE);
        return;
      }
      const body = await res.json().catch(() => null) as AcceptInvitationErrorResponse | null;
      if (body?.error === 'signed_in_as_other') {
        setNeedsSwitchConfirm(true);
      } else if (body?.error === 'signup_closed') {
        setError('New accounts are paused for today. Please try this link again tomorrow.');
      } else if (body?.error === 'rate_limited') {
        setError('Too many attempts. Wait a few minutes and try again.');
      } else {
        setInfo((current: InspectInvitationResponse | null) => ({ ...current, state: (body?.error as InvitationState | undefined) ?? 'invalid' }));
      }
    } catch {
      // The join may have gone through with the response lost; signing in recovers.
      setError('Something went wrong. If it keeps happening, sign in normally: if you joined, the realm will be there.');
    } finally {
      setJoining(false);
    }
  };

  const state = info?.state;
  const message = state && state !== 'valid' ? STATE_MESSAGES[state] : null;
  const showSwitchWarning = needsSwitchConfirm || (state === 'valid' && info?.currentAccount === 'other');

  return (
    <div className="h-screen bg-slate-950 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-slate-950 text-white flex flex-col overflow-hidden">
      <SiteHeader />
      <div className="flex-1 flex items-center justify-center px-4 relative z-[10] overflow-y-auto">
        <div className="bg-slate-900/80 border-2 border-slate-800 rounded-[32px] p-8 max-w-sm w-full space-y-5 text-center">
          <div className="text-4xl">✉️</div>

          {!info && !error && <div className="text-slate-500 text-sm">Checking your invitation...</div>}

          {state === 'valid' && info && (
            <>
              <div>
                <h2 className="text-2xl font-display font-black text-amber-400 italic tracking-tighter">Join {info.realmName}</h2>
                <p className="text-slate-400 text-sm mt-2">
                  {info.inviter} invited {info.recipient} to play in this realm.
                  You will share its adventures and its adventure energy.
                </p>
              </div>
              {showSwitchWarning && (
                <div className="bg-amber-950/40 border border-amber-800/60 rounded-2xl px-4 py-3 text-amber-200 text-sm text-left">
                  You are signed in with a different account. Joining signs you out of it and continues as {info.recipient}.
                </div>
              )}
              <button
                onClick={() => void join(showSwitchWarning)}
                disabled={joining}
                className="w-full py-4 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 rounded-[20px] font-black uppercase italic tracking-tighter text-slate-950 transition-colors"
              >
                {joining ? 'Joining...' : showSwitchWarning ? 'Continue as the invited account' : 'Join realm'}
              </button>
              {showSwitchWarning && (
                <button onClick={() => navigate('/')} className="w-full text-xs font-black uppercase tracking-widest text-slate-500 hover:text-slate-300">
                  Cancel and stay signed in
                </button>
              )}
              <p className="text-[11px] text-slate-500">Please do not share this link: anyone with it can join as you.</p>
            </>
          )}

          {message && (
            <div>
              <h2 className="text-xl font-display font-black text-amber-400 italic tracking-tighter">{message.title}</h2>
              <p className="text-slate-400 text-sm mt-2">{message.body}</p>
            </div>
          )}

          {state === 'accepted' && info?.canOpenRealm ? (
            <button
              onClick={() => navigate('/')}
              className="w-full py-3 bg-amber-500 hover:bg-amber-400 rounded-[20px] font-black uppercase italic tracking-tighter text-slate-950"
            >
              Open realm
            </button>
          ) : message && (
            <button
              onClick={() => navigate('/login')}
              className="w-full py-3 bg-slate-800 hover:bg-slate-700 rounded-[20px] font-black uppercase italic tracking-tighter text-slate-300 border border-slate-700"
            >
              Sign in
            </button>
          )}

          {error && (
            <div role="alert" className="bg-rose-950/60 border border-rose-800/60 rounded-2xl px-4 py-3 text-rose-300 text-sm">
              {error}
            </div>
          )}
        </div>
      </div>
      <DmFooter />
    </div>
  );
};
