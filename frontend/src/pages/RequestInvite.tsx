import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { SiteHeader } from '../components/SiteHeader';
import { DmFooter } from '../components/DmFooter';

export const RequestInvite = () => {
  const [email, setEmail] = useState<string | null>(null);
  const [alreadyRequested, setAlreadyRequested] = useState(false);
  const [message, setMessage] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiFetch('/auth/invite-info')
      .then(async res => {
        if (!res.ok) {
          setError('Your session has expired. Please try signing in again.');
          return;
        }
        const data = await res.json() as { email: string; alreadyRequested: boolean };
        setEmail(data.email);
        setAlreadyRequested(data.alreadyRequested);
      })
      .catch(() => setError('Could not load invite info. Please try again.'));
  }, []);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch('/auth/request-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message.trim() || undefined }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setError(data.error === 'Invalid token or invite already submitted'
          ? 'Your invite was already submitted.'
          : 'Failed to send request. Please try again.');
        setSubmitting(false);
        return;
      }
      setSubmitted(true);
    } catch {
      setError('Failed to send request. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <div className="h-screen bg-slate-950 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-slate-950 text-white flex flex-col overflow-hidden">
      <SiteHeader />
      <div className="flex-1 flex items-center justify-center px-4 relative z-[10]">
        <div className="bg-slate-900/80 border-2 border-slate-800 rounded-[32px] p-8 max-w-sm w-full space-y-6 text-center">
          <div>
            <div className="text-4xl mb-2">📜</div>
            <h2 className="text-2xl font-display font-black text-amber-400 italic tracking-tighter">Request an Invite</h2>
          </div>

          {error && (
            <div className="bg-rose-950/60 border border-rose-800/60 rounded-2xl px-4 py-3 text-rose-300 text-sm">
              {error}
            </div>
          )}

          {submitted && (
            <div className="space-y-4">
              <div className="bg-emerald-950/60 border border-emerald-800/60 rounded-2xl px-4 py-4 text-emerald-300 text-sm">
              Your request has been sent! The DM will review it shortly.
              </div>
              <p className="text-slate-500 text-xs">Found a bug or have feedback? <a href="https://github.com/erikzaadi/dnd-fam-ftw/issues/new" target="_blank" rel="noopener noreferrer" className="text-amber-600 hover:text-amber-500 underline">Open an issue on GitHub</a>.</p>
            </div>
          )}

          {!submitted && alreadyRequested && (
            <div className="space-y-4">
              <div className="bg-amber-950/60 border border-amber-800/60 rounded-2xl px-4 py-4 text-amber-300 text-sm">
              Your invite request is pending. The DM will review it soon.
              </div>
              {email && <p className="text-slate-500 text-xs">Requested as: {email}</p>}
              <p className="text-slate-500 text-xs">Found a bug or have feedback? <a href="https://github.com/erikzaadi/dnd-fam-ftw/issues/new" target="_blank" rel="noopener noreferrer" className="text-amber-600 hover:text-amber-500 underline">Open an issue on GitHub</a>.</p>
            </div>
          )}

          {!submitted && !alreadyRequested && email && (
            <div className="space-y-4 text-left">
              <div>
                <label className="text-slate-400 text-xs uppercase tracking-wider">Your Google account</label>
                <p className="mt-1 text-slate-200 text-sm font-mono bg-slate-800/60 rounded-lg px-3 py-2">{email}</p>
              </div>
              <div>
                <label className="text-slate-400 text-xs uppercase tracking-wider">Message (optional)</label>
                <textarea
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  placeholder="Introduce yourself or explain why you'd like access..."
                  rows={3}
                  className="mt-1 w-full bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 text-sm resize-none focus:outline-none focus:border-amber-700"
                />
              </div>
              <button
                onClick={() => void submit()}
                disabled={submitting}
                className="w-full py-3 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 rounded-[16px] font-black uppercase italic tracking-tighter transition-colors text-white"
              >
                {submitting ? 'Sending...' : 'Send Request'}
              </button>
              <p className="text-slate-600 text-xs text-center">Found a bug or have feedback? <a href="https://github.com/erikzaadi/dnd-fam-ftw/issues/new" target="_blank" rel="noopener noreferrer" className="text-amber-700 hover:text-amber-600 underline">Open an issue on GitHub</a>.</p>
            </div>
          )}

          {!submitted && !alreadyRequested && !email && !error && (
            <div className="text-slate-500 text-sm">Loading...</div>
          )}
        </div>
      </div>
      <DmFooter />
    </div>
  );
};
