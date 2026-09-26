import { useCallback, useEffect, useState } from 'react';
import { ConfirmDialog } from './ConfirmDialog';
import { apiFetch } from '../lib/api';
import type { AccessTokenScope, OAuthGrantSummary } from '../types';

const SCOPE_LABELS: Record<AccessTokenScope, string> = {
  'adventures:read': 'Read adventures',
  'adventures:play': 'Play turns',
  'adventures:create': 'Start new adventures',
  'images:generate': 'Paint scene pictures when asked',
};

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });

const grantState = (grant: OAuthGrantSummary): 'active' | 'expired' | 'revoked' => {
  if (grant.revokedAt) {
    return 'revoked';
  }
  return new Date(grant.expiresAt).getTime() <= Date.now() ? 'expired' : 'active';
};

// Assistants the player connected by signing in from the assistant (MCP OAuth).
// Revoking ends the connection right away. Hidden until there is something to show.
export const ConnectedAssistants = () => {
  const [grants, setGrants] = useState<OAuthGrantSummary[]>([]);
  const [pending, setPending] = useState<OAuthGrantSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetch('/access-tokens/grants')
      .then(async res => {
        if (res.ok) {
          setGrants(await res.json() as OAuthGrantSummary[]);
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(load, [load]);

  const revoke = async () => {
    if (!pending) {
      return;
    }
    const grant = pending;
    setPending(null);
    setError(null);
    try {
      const res = await apiFetch(`/access-tokens/grants/${encodeURIComponent(grant.id)}/revoke`, { method: 'POST' });
      if (!res.ok) {
        setError('Could not end that connection. Try again.');
      }
    } catch {
      setError("Couldn't reach the realm. Check your connection and try again.");
    }
    load();
  };

  if (grants.length === 0) {
    return null;
  }

  return (
    <section className="space-y-3" aria-labelledby="connected-heading">
      {pending && (
        <ConfirmDialog
          message={`Disconnect "${pending.clientName ?? 'this assistant'}"? It stops working right away.`}
          confirmLabel="Disconnect"
          onConfirm={() => void revoke()}
          onCancel={() => setPending(null)}
        />
      )}
      <h2 id="connected-heading" className="text-lg font-black uppercase tracking-tighter text-amber-500">Connected assistants</h2>
      {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
      <ul className="space-y-3">
        {grants.map(grant => {
          const state = grantState(grant);
          return (
            <li key={grant.id} className={`p-4 rounded-[20px] border-2 space-y-2 ${state === 'active' ? 'bg-slate-900 border-slate-800' : 'bg-slate-900/40 border-slate-900 opacity-70'}`}>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <span className="font-black text-white">{grant.clientName ?? 'Unnamed assistant'}</span>
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-black uppercase tracking-wider ${state === 'active' ? 'bg-emerald-900/60 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>{state}</span>
              </div>
              <p className="text-xs text-slate-400">
                {grant.verifiedHost ? `Verified app from ${grant.verifiedHost}` : 'Unverified app'}. Realm: {grant.namespaceName ?? grant.namespaceId}.
                {' '}{grant.scopes.map(scope => SCOPE_LABELS[scope]).join(', ')}.
              </p>
              <p className="text-xs text-slate-500">
                Connected {formatDate(grant.createdAt)}
                {state === 'active' && `, ends ${formatDate(grant.expiresAt)}`}
                {grant.revokedAt && `, disconnected ${formatDate(grant.revokedAt)}`}
                {`, last used ${grant.lastUsedAt ? formatDate(grant.lastUsedAt) : 'never'}`}.
              </p>
              {state === 'active' && (
                <button
                  onClick={() => setPending(grant)}
                  className="px-3 py-1.5 bg-rose-950/60 hover:bg-rose-900/60 border border-rose-900 rounded-lg text-xs font-black uppercase tracking-wider text-rose-200 cursor-pointer"
                >
                  Disconnect
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
};
