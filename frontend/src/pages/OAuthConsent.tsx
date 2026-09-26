import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { SiteHeader } from '../components/SiteHeader';
import { apiFetch } from '../lib/api';
import { clearPostLoginPath } from '../lib/postLoginRedirect';
import type { AccessTokenScope, OAuthConsentDecisionResponse, OAuthConsentDetailsResponse } from '../types';

const SCOPE_LABELS: Record<AccessTokenScope, string> = {
  'adventures:read': 'Read adventures',
  'adventures:play': 'Play turns',
  'adventures:create': 'Start new adventures',
  'images:generate': 'Paint scene pictures when asked',
};

const OPTIONAL_SCOPES = ['adventures:play', 'adventures:create', 'images:generate'] as const;

// Where an AI assistant's "sign in" lands (MCP OAuth). The player sees which app is
// asking, picks the realm and what the app may do, and approves or denies. The server
// then sends the browser back to the app.
export const OAuthConsent = () => {
  const [params] = useSearchParams();
  const requestId = params.get('request') ?? '';
  const [details, setDetails] = useState<OAuthConsentDetailsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [namespaceId, setNamespaceId] = useState('');
  const [scopes, setScopes] = useState<AccessTokenScope[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    clearPostLoginPath();
    if (!requestId) {
      return;
    }
    apiFetch(`/oauth-consent/${encodeURIComponent(requestId)}`)
      .then(async res => {
        const body = await res.json().catch(() => null) as (OAuthConsentDetailsResponse & { message?: string }) | null;
        if (!res.ok || !body) {
          setLoadError(body?.message ?? 'This sign-in request has expired or was already answered. Start connecting again from your assistant.');
          return;
        }
        setDetails(body);
        const eligible = body.realms.filter(realm => realm.eligible);
        setNamespaceId(eligible.find(realm => realm.id === body.currentNamespaceId)?.id ?? eligible[0]?.id ?? '');
        const requested = body.requestedScopes.filter(scope => scope !== 'adventures:read');
        setScopes(requested.length > 0 ? requested : ['adventures:play', 'adventures:create']);
      })
      .catch(() => setLoadError("Couldn't reach the realm. Check your connection and try again."));
  }, [requestId]);

  const decide = async (approve: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/oauth-consent/${encodeURIComponent(requestId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(approve ? { decision: 'approve', namespaceId, scopes } : { decision: 'deny' }),
      });
      const body = await res.json().catch(() => null) as (OAuthConsentDecisionResponse & { message?: string }) | null;
      if (!res.ok || !body?.redirectUrl) {
        setError(body?.message ?? 'Something went wrong. Try again.');
        setBusy(false);
        return;
      }
      window.location.assign(body.redirectUrl);
    } catch {
      setError("Couldn't reach the realm. Check your connection and try again.");
      setBusy(false);
    }
  };

  const toggleScope = (scope: AccessTokenScope) => {
    setScopes(current => current.includes(scope) ? current.filter(s => s !== scope) : [...current, scope]);
  };

  const problem = requestId ? loadError : 'This page needs a sign-in request from your assistant.';
  const eligibleRealms = details?.realms.filter(realm => realm.eligible) ?? [];
  const appName = details?.client.name ?? 'An app';

  return (
    <div className="h-screen bg-slate-950 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-slate-950 text-white flex flex-col overflow-hidden">
      <SiteHeader />
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-6 min-h-0">
        <div className="max-w-xl mx-auto space-y-6">
          <h1 className="text-4xl md:text-5xl font-display font-black text-amber-500 italic tracking-tighter">Connect an assistant</h1>

          {!details && !problem && <p className="text-slate-500 text-sm">Checking the request...</p>}
          {problem && <p role="alert" className="p-5 bg-amber-950/20 rounded-[20px] border-2 border-slate-800 text-slate-300">{problem}</p>}

          {details && (
            <section className="space-y-5 p-5 bg-amber-950/20 rounded-[20px] border-2 border-slate-800" aria-labelledby="consent-heading">
              <div className="space-y-2">
                <h2 id="consent-heading" className="text-xl font-black text-white">
                  <span className="text-amber-400">{appName}</span> wants to play in your realm
                </h2>
                {details.client.verifiedHost ? (
                  <p className="text-sm text-emerald-300">Verified app from {details.client.verifiedHost}</p>
                ) : (
                  <p className="text-sm text-amber-300">Unverified app: its name is what it told us. Only continue if you just started connecting from your own assistant.</p>
                )}
                <p className="text-xs text-slate-400">After you answer, your browser goes back to {details.client.redirectHost}.</p>
              </div>

              {eligibleRealms.length === 0 ? (
                <p className="text-sm text-slate-300">
                  Assistant access is not on for you in any of your realms yet. You can ask for it on the{' '}
                  <Link to="/access-tokens" className="text-amber-400 underline">AI assistant access</Link> page.
                </p>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <label htmlFor="consent-realm" className="text-slate-400 text-xs uppercase tracking-wider">Realm</label>
                    <select
                      id="consent-realm"
                      value={namespaceId}
                      onChange={e => setNamespaceId(e.target.value)}
                      className="w-full bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 text-sm focus:outline-none focus:border-amber-700"
                    >
                      {details.realms.map(realm => (
                        <option key={realm.id} value={realm.id} disabled={!realm.eligible}>
                          {realm.name}{realm.eligible ? '' : ' (no assistant access)'}
                        </option>
                      ))}
                    </select>
                  </div>
                  <fieldset className="space-y-2">
                    <legend className="text-slate-400 text-xs uppercase tracking-wider mb-1">The assistant may</legend>
                    <label className="flex items-center gap-2 text-sm text-slate-300">
                      <input type="checkbox" checked disabled /> {SCOPE_LABELS['adventures:read']}
                    </label>
                    {OPTIONAL_SCOPES.map(scope => (
                      <label key={scope} className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                        <input type="checkbox" checked={scopes.includes(scope)} onChange={() => toggleScope(scope)} /> {SCOPE_LABELS[scope]}
                      </label>
                    ))}
                  </fieldset>
                  <p className="text-xs text-slate-400">
                    Story text from this realm is sent to the assistant. The connection lasts 30 days and you can cut it off any time on the AI assistant access page.
                  </p>
                </>
              )}

              {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}

              <div className="flex gap-3">
                <button
                  onClick={() => void decide(false)}
                  disabled={busy}
                  className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 border-2 border-slate-700 disabled:opacity-50 rounded-[16px] font-black uppercase italic tracking-tighter text-sm text-slate-200 cursor-pointer disabled:cursor-not-allowed"
                >
                  Deny
                </button>
                {eligibleRealms.length > 0 && (
                  <button
                    onClick={() => void decide(true)}
                    disabled={busy || !namespaceId}
                    className="flex-1 py-3 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 rounded-[16px] font-black uppercase italic tracking-tighter text-sm text-white cursor-pointer disabled:cursor-not-allowed"
                  >
                    {busy ? 'Connecting...' : 'Allow'}
                  </button>
                )}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
};
