import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import type { InvitationErrorResponse, InvitationSummary, NamespaceInvitationsResponse } from '../types';

const formatDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

const errorMessage = async (res: Response, fallback: string): Promise<string> => {
  const body = await res.json().catch(() => null) as Partial<InvitationErrorResponse> | null;
  return body?.message ?? fallback;
};

// "Invite your party": send email invitations to the current realm, see pending ones,
// resend or revoke them, and (owners) choose whether members may invite too.
export const InvitePartyPanel = ({ autoFocus = false }: { autoFocus?: boolean }) => {
  const [data, setData] = useState<NamespaceInvitationsResponse | null>(null);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await apiFetch('/namespace/invitations').catch(() => null);
    if (res?.ok) {
      setData(await res.json() as NamespaceInvitationsResponse);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!data?.enabled) {
    return null;
  }

  const send = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!email.trim() || sending) {
      return;
    }
    setSending(true);
    setNotice(null);
    try {
      const res = await apiFetch('/namespace/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (res.ok) {
        setNotice({ kind: 'ok', text: `Invitation sent to ${email.trim()}.` });
        setEmail('');
      } else {
        setNotice({ kind: 'error', text: await errorMessage(res, 'The invitation could not be sent. Try again.') });
      }
    } catch {
      setNotice({ kind: 'error', text: 'The invitation could not be sent. Check your connection.' });
    } finally {
      setSending(false);
      void load();
    }
  };

  const act = async (invite: InvitationSummary, action: 'resend' | 'revoke') => {
    setBusyId(invite.id);
    setNotice(null);
    try {
      const res = action === 'resend'
        ? await apiFetch(`/namespace/invitations/${encodeURIComponent(invite.id)}/resend`, { method: 'POST' })
        : await apiFetch(`/namespace/invitations/${encodeURIComponent(invite.id)}`, { method: 'DELETE' });
      if (res.ok) {
        setNotice({ kind: 'ok', text: action === 'resend' ? `Sent a fresh link to ${invite.email}.` : `Invitation for ${invite.email} cancelled.` });
      } else {
        setNotice({ kind: 'error', text: await errorMessage(res, 'That did not work. Try again.') });
      }
    } finally {
      setBusyId(null);
      void load();
    }
  };

  const toggleMemberInvites = async (enabled: boolean) => {
    const res = await apiFetch('/namespace/invitation-settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberInvitesEnabled: enabled }),
    }).catch(() => null);
    if (!res?.ok) {
      setNotice({ kind: 'error', text: 'Could not change that setting. Try again.' });
    }
    void load();
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-black uppercase tracking-tighter text-amber-500">Invite your party</h2>
        <p className="text-sm text-slate-400 mt-1">
          Adventures are better together. Invite family or friends by email so they can join this realm.
          Everyone here shares its adventures and its adventure energy.
        </p>
      </div>

      {data.canInvite ? (
        <form onSubmit={e => void send(e)} className="flex flex-col sm:flex-row gap-2">
          <label htmlFor="invite-email" className="sr-only">Email to invite</label>
          <input
            id="invite-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoFocus={autoFocus}
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="friend@example.com"
            className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-600 focus:outline-none focus:border-amber-500"
          />
          <button
            type="submit"
            disabled={sending || !email.trim()}
            className="px-5 py-3 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 rounded-xl font-black uppercase italic tracking-tighter text-slate-950 transition-colors"
          >
            {sending ? 'Sending...' : 'Send invite'}
          </button>
        </form>
      ) : (
        <p className="text-sm text-slate-500">Only the realm owner can invite people to this realm.</p>
      )}

      {notice && (
        <p role={notice.kind === 'error' ? 'alert' : 'status'} className={`text-sm ${notice.kind === 'error' ? 'text-rose-300' : 'text-emerald-300'}`}>
          {notice.text}
        </p>
      )}

      {data.canInvite && (
        <p className="text-xs text-slate-500">
          Joining gives access to all of this realm&apos;s adventures, not just one. The link works once, for 7 days.
        </p>
      )}

      {data.invitations.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-black uppercase tracking-widest text-slate-500">Pending invitations</h3>
          <ul className="space-y-2">
            {data.invitations.map(invite => (
              <li key={invite.id} className="flex flex-wrap items-center gap-2 bg-slate-950/60 border border-slate-800 rounded-xl px-3 py-2">
                <div className="flex-1 min-w-[10rem]">
                  <div className="text-sm text-slate-200 break-all">{invite.email}</div>
                  <div className="text-[11px] text-slate-500">
                    {invite.delivery === 'failed'
                      ? 'Email failed to send'
                      : invite.expired ? 'Expired' : `Expires ${formatDate(invite.expiresAt)}`}
                    {!invite.mine && ' - sent by another member'}
                  </div>
                </div>
                <button
                  onClick={() => void act(invite, 'resend')}
                  disabled={busyId !== null}
                  className="px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider text-amber-400 hover:bg-slate-800 disabled:opacity-50"
                >
                  Resend
                </button>
                <button
                  onClick={() => void act(invite, 'revoke')}
                  disabled={busyId !== null}
                  className="px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider text-slate-400 hover:bg-slate-800 hover:text-rose-300 disabled:opacity-50"
                >
                  Cancel
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.isOwner && (
        <label className="flex items-start gap-3 text-sm text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={data.memberInvitesEnabled}
            onChange={e => void toggleMemberInvites(e.target.checked)}
            className="mt-1 accent-amber-500"
          />
          <span>
            Let members invite others
            <span className="block text-xs text-slate-500">Off: only you can invite. You can always cancel any pending invitation.</span>
          </span>
        </label>
      )}
    </div>
  );
};
