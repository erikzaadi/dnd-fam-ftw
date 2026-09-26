import { useCallback, useEffect, useState } from 'react';
import { SiteHeader } from '../components/SiteHeader';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { AutoConfirmSettings } from '../components/AutoConfirmSettings';
import { AssistantAccessRequest } from '../components/AssistantAccessRequest';
import { ConnectedAssistants } from '../components/ConnectedAssistants';
import { apiFetch, apiUrl } from '../lib/api';
import type { AccessTokenCreatedResponse, AccessTokenListResponse, AccessTokenScope, AccessTokenSummary } from '../types';

const SCOPE_LABELS: Record<AccessTokenScope, string> = {
  'adventures:read': 'Read adventures',
  'adventures:play': 'Play turns',
  'adventures:create': 'Start new adventures',
  'images:generate': 'Paint scene pictures when asked',
};

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });

const tokenState = (token: AccessTokenSummary): 'active' | 'expired' | 'revoked' => {
  if (token.revokedAt) {
    return 'revoked';
  }
  return new Date(token.expiresAt).getTime() <= Date.now() ? 'expired' : 'active';
};

// The server's configured public URL, else the API address this page talks to.
const resolveMcpUrl = (configured: string | null): string =>
  configured ?? new URL(apiUrl('/mcp'), window.location.origin).href;

const setupSnippets = (mcpUrl: string) => [
  {
    client: 'Claude Code',
    code: `claude mcp add --transport http dnd-fam-ftw ${mcpUrl} --header "Authorization: Bearer $DM_MCP_TOKEN"`,
  },
  {
    client: 'Codex (~/.codex/config.toml)',
    code: `[mcp_servers.dnd-fam-ftw]\nurl = "${mcpUrl}"\nbearer_token_env_var = "DM_MCP_TOKEN"\n# If Codex says DM_MCP_TOKEN is not set, use this line instead\n# (keep this file private, it then holds the token):\n# http_headers = { Authorization = "Bearer <your token>" }`,
  },
  {
    client: 'Cursor (.cursor/mcp.json)',
    code: `{\n  "mcpServers": {\n    "dnd-fam-ftw": {\n      "url": "${mcpUrl}",\n      "headers": { "Authorization": "Bearer \${env:DM_MCP_TOKEN}" }\n    }\n  }\n}`,
  },
];

const CopyButton = ({ text, label }: { text: string; label: string }) => {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-xs font-black uppercase tracking-wider text-slate-200 cursor-pointer"
    >
      {copied ? 'Copied' : label}
    </button>
  );
};

const NewSecret = ({ created, mcpUrl, onDone }: { created: AccessTokenCreatedResponse; mcpUrl: string; onDone: () => void }) => (
  <section className="space-y-4 p-5 bg-emerald-950/30 rounded-[20px] border-2 border-emerald-800" aria-labelledby="new-token-heading">
    <h2 id="new-token-heading" className="text-lg font-black uppercase tracking-tighter text-emerald-300">Your new token: {created.token.label}</h2>
    <p className="text-sm text-slate-300">Copy it now. It is shown only once. Treat it like a password: never paste it into a chat, a URL, or a shared file.</p>
    <div className="flex items-center gap-2">
      <code className="flex-1 min-w-0 break-all bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-emerald-200 text-sm font-mono">{created.secret}</code>
      <CopyButton text={created.secret} label="Copy" />
    </div>
    <p className="text-sm text-slate-400">
      Save it in an environment variable named <code className="font-mono text-slate-200">DM_MCP_TOKEN</code> on your computer, then add the server to your assistant:
    </p>
    {setupSnippets(mcpUrl).map(snippet => (
      <div key={snippet.client} className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-black uppercase tracking-wider text-slate-400">{snippet.client}</span>
          <CopyButton text={snippet.code} label="Copy" />
        </div>
        <pre className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-300 text-xs font-mono whitespace-pre-wrap break-all">{snippet.code}</pre>
      </div>
    ))}
    <button
      onClick={onDone}
      className="w-full py-3 bg-emerald-700 hover:bg-emerald-600 rounded-[16px] font-black uppercase italic tracking-tighter text-sm text-white cursor-pointer"
    >
      I saved it
    </button>
  </section>
);

type PendingAction = { kind: 'revoke' | 'rotate'; token: AccessTokenSummary };

// Personal access tokens that let an AI assistant (Claude Code, Codex, Cursor) play
// adventures in this realm through the server's MCP endpoint. Players without access
// can ask for it here.
export const AccessTokens = () => {
  const [data, setData] = useState<AccessTokenListResponse | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [label, setLabel] = useState('');
  const [scopes, setScopes] = useState<AccessTokenScope[]>(['adventures:play', 'adventures:create']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<AccessTokenCreatedResponse | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);

  const load = useCallback(() => {
    apiFetch('/access-tokens')
      .then(async res => {
        if (!res.ok) {
          throw new Error(String(res.status));
        }
        setData(await res.json() as AccessTokenListResponse);
      })
      .catch(() => setUnavailable(true));
  }, []);

  useEffect(load, [load]);

  const readError = async (res: Response): Promise<string> => {
    const body = await res.json().catch(() => null) as { message?: string } | null;
    return body?.message ?? 'Something went wrong. Try again.';
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch('/access-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label.trim(), scopes }),
      });
      if (!res.ok) {
        setError(await readError(res));
        return;
      }
      setCreated(await res.json() as AccessTokenCreatedResponse);
      setLabel('');
      load();
    } catch {
      setError("Couldn't reach the realm. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const runPending = async () => {
    if (!pending) {
      return;
    }
    const { kind, token } = pending;
    setPending(null);
    setError(null);
    try {
      const res = await apiFetch(`/access-tokens/${encodeURIComponent(token.id)}/${kind}`, { method: 'POST' });
      if (!res.ok) {
        setError(await readError(res));
      } else if (kind === 'rotate') {
        setCreated(await res.json() as AccessTokenCreatedResponse);
      }
    } catch {
      setError("Couldn't reach the realm. Check your connection and try again.");
    }
    load();
  };

  const toggleScope = (scope: AccessTokenScope) => {
    setScopes(current => current.includes(scope) ? current.filter(s => s !== scope) : [...current, scope]);
  };

  const activeCount = data?.tokens.filter(token => tokenState(token) === 'active').length ?? 0;
  const mcpUrl = resolveMcpUrl(data?.mcpUrl ?? null);

  return (
    <div className="h-screen bg-slate-950 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-slate-950 text-white flex flex-col overflow-hidden">
      <SiteHeader />
      {pending && (
        <ConfirmDialog
          message={pending.kind === 'revoke'
            ? `Revoke "${pending.token.label}"? Assistants using it stop working right away.`
            : `Replace "${pending.token.label}" with a new token? The old one stops working right away.`}
          confirmLabel={pending.kind === 'revoke' ? 'Revoke' : 'Replace'}
          onConfirm={() => void runPending()}
          onCancel={() => setPending(null)}
        />
      )}
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-6 min-h-0">
        <div className="max-w-2xl mx-auto space-y-6">
          <h1 className="text-4xl md:text-5xl font-display font-black text-amber-500 italic tracking-tighter">AI assistant access</h1>
          <p className="text-slate-400">
            Play your adventures from an AI assistant such as Claude Code, Codex, or Cursor. The realm stays the Dungeon Master:
            the assistant only passes your actions along and shows you the story. Story text from your adventures is sent to the assistant you connect.
          </p>

          {unavailable && <p className="text-slate-400">Assistant access needs sign-in, which is off on this server.</p>}
          {!data && !unavailable && <p className="text-slate-500 text-sm">Checking your access...</p>}

          {data && !data.eligible && <AssistantAccessRequest data={data} onRequested={load} />}

          {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}

          {created && <NewSecret created={created} mcpUrl={mcpUrl} onDone={() => setCreated(null)} />}

          {data?.eligible && !created && (
            <section className="space-y-4 p-5 bg-amber-950/20 rounded-[20px] border-2 border-slate-800" aria-labelledby="create-token-heading">
              <h2 id="create-token-heading" className="text-lg font-black uppercase tracking-tighter text-amber-500">New token</h2>
              <p className="text-sm text-slate-400">
                For the realm <span className="text-slate-200 font-bold">{data.namespaceName ?? 'you are signed in to'}</span>. Tokens last 30 days.
                You can have {data.maxActiveTokens} active tokens.
              </p>
              <div className="space-y-1.5">
                <label htmlFor="token-label" className="text-slate-400 text-xs uppercase tracking-wider">Name (which assistant or computer?)</label>
                <input
                  id="token-label"
                  value={label}
                  onChange={e => setLabel(e.target.value)}
                  maxLength={60}
                  placeholder="Claude Code on the laptop"
                  className="w-full bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 text-sm focus:outline-none focus:border-amber-700"
                />
              </div>
              <fieldset className="space-y-2">
                <legend className="text-slate-400 text-xs uppercase tracking-wider mb-1">The assistant may</legend>
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input type="checkbox" checked disabled /> {SCOPE_LABELS['adventures:read']}
                </label>
                {(['adventures:play', 'adventures:create', 'images:generate'] as const).map(scope => (
                  <label key={scope} className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                    <input type="checkbox" checked={scopes.includes(scope)} onChange={() => toggleScope(scope)} /> {SCOPE_LABELS[scope]}
                  </label>
                ))}
              </fieldset>
              <button
                onClick={() => void create()}
                disabled={busy || !label.trim() || activeCount >= data.maxActiveTokens}
                className="w-full py-3 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 rounded-[16px] font-black uppercase italic tracking-tighter text-sm text-white cursor-pointer disabled:cursor-not-allowed"
              >
                {busy ? 'Creating...' : 'Create token'}
              </button>
            </section>
          )}

          {data?.eligible && <AutoConfirmSettings namespaceName={data.namespaceName} />}

          <ConnectedAssistants />

          {data && data.tokens.length > 0 && (
            <section className="space-y-3" aria-labelledby="tokens-heading">
              <h2 id="tokens-heading" className="text-lg font-black uppercase tracking-tighter text-amber-500">Your tokens</h2>
              <ul className="space-y-3">
                {data.tokens.map(token => {
                  const state = tokenState(token);
                  return (
                    <li key={token.id} className={`p-4 rounded-[20px] border-2 space-y-2 ${state === 'active' ? 'bg-slate-900 border-slate-800' : 'bg-slate-900/40 border-slate-900 opacity-70'}`}>
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <span className="font-black text-white">{token.label}</span>
                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-black uppercase tracking-wider ${state === 'active' ? 'bg-emerald-900/60 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>{state}</span>
                      </div>
                      <p className="text-xs text-slate-400 font-mono">{token.prefix}...</p>
                      <p className="text-xs text-slate-400">
                        Realm: {token.namespaceName ?? token.namespaceId}. {token.scopes.map(scope => SCOPE_LABELS[scope]).join(', ')}.
                      </p>
                      <p className="text-xs text-slate-500">
                        Created {formatDate(token.createdAt)}
                        {state === 'active' && `, expires ${formatDate(token.expiresAt)}`}
                        {token.revokedAt && `, revoked ${formatDate(token.revokedAt)}`}
                        {`, last used ${token.lastUsedAt ? formatDate(token.lastUsedAt) : 'never'}`}.
                      </p>
                      {state === 'active' && (
                        <div className="flex gap-2 pt-1">
                          {data.eligible && (
                            <button
                              onClick={() => setPending({ kind: 'rotate', token })}
                              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-xs font-black uppercase tracking-wider text-slate-200 cursor-pointer"
                            >
                              Replace
                            </button>
                          )}
                          <button
                            onClick={() => setPending({ kind: 'revoke', token })}
                            className="px-3 py-1.5 bg-rose-950/60 hover:bg-rose-900/60 border border-rose-900 rounded-lg text-xs font-black uppercase tracking-wider text-rose-200 cursor-pointer"
                          >
                            Revoke
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
};
