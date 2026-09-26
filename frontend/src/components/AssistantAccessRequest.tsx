import { useState } from 'react';
import { apiFetch } from '../lib/api';
import type { AccessTokenListResponse, McpAccessRequestErrorResponse } from '../types';

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });

const boxClass = 'p-5 bg-amber-950/20 rounded-[20px] border-2 border-slate-800 text-slate-300 space-y-3';

// Shown on the Access tokens page to players without assistant access: ask the realm
// keeper (any tier), see that a request is open, or learn it is not available.
export const AssistantAccessRequest = ({ data, onRequested }: { data: AccessTokenListResponse; onRequested: () => void }) => {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!data.mcpAvailable) {
    return <p className={boxClass}>Assistant access is turned off on this server right now.</p>;
  }

  if (data.accessRequest?.status === 'pending') {
    return (
      <p className={boxClass}>
        You asked for assistant access on {formatDate(data.accessRequest.createdAt)}. The realm keeper will email you when it is ready.
      </p>
    );
  }

  if (!data.canRequestAccess) {
    return <p className={boxClass}>Assistant access is not available for your account right now.</p>;
  }

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch('/access-tokens/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(note.trim() ? { note: note.trim() } : {}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as McpAccessRequestErrorResponse | null;
        setError(body?.message ?? 'Something went wrong. Try again.');
        return;
      }
      setNote('');
      onRequested();
    } catch {
      setError("Couldn't reach the realm. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={boxClass} aria-labelledby="request-access-heading">
      <h2 id="request-access-heading" className="text-lg font-black uppercase tracking-tighter text-amber-500">Request access</h2>
      {data.accessRequest?.status === 'denied' && (
        <p className="text-sm text-slate-400">Your last request was not approved. You can ask again.</p>
      )}
      <p className="text-sm">
        Assistant access is opt-in while we try it out. Ask the realm keeper and you will get an email when it is turned on.
      </p>
      <div className="space-y-1.5">
        <label htmlFor="request-note" className="text-slate-400 text-xs uppercase tracking-wider">Anything to add? (optional)</label>
        <textarea
          id="request-note"
          value={note}
          onChange={e => setNote(e.target.value)}
          maxLength={300}
          rows={2}
          placeholder="Which assistant you would like to use"
          className="w-full bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 text-sm focus:outline-none focus:border-amber-700"
        />
      </div>
      {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
      <button
        onClick={() => void submit()}
        disabled={busy}
        className="w-full py-3 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 rounded-[16px] font-black uppercase italic tracking-tighter text-sm text-white cursor-pointer disabled:cursor-not-allowed"
      >
        {busy ? 'Sending...' : 'Request access'}
      </button>
    </section>
  );
};
