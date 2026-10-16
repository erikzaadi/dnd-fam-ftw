import { useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { clearPostLoginPath, rememberPostLoginPath } from '../lib/postLoginRedirect';
import { useAuth } from '../contexts/AuthContext';
import { SiteHeader } from '../components/SiteHeader';
import type {
  DevicePairingApproveResponse,
  DevicePairingErrorResponse,
  DevicePairingLookupResponse,
  SessionNamespace,
  SessionNamespacesResponse,
} from '../types';

const formatCode = (raw: string): string => {
  const code = raw.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 8);
  return code.length > 4 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
};

const errorMessage = (body: DevicePairingErrorResponse | null): string => {
  switch (body?.error) {
  case 'invalid_code':
    return "That code doesn't match a TV waiting to sign in. It may have run out: get a new one on the TV.";
  case 'rate_limited':
    return `Too many tries. Wait ${Math.ceil((body.retryAfterSeconds ?? 60) / 60)} minute(s) and try again.`;
  case 'not_member':
    return "You're not a member of that realm anymore. Pick another one.";
  default:
    return 'Something went wrong. Please try again.';
  }
};

const post = (path: string, body: unknown) => apiFetch(path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

type LookupOutcome = { device: DevicePairingLookupResponse; error: null } | { device: null; error: string };

async function lookupCode(code: string): Promise<LookupOutcome> {
  try {
    const res = await post('/auth/device/lookup', { code });
    if (!res.ok) {
      return { device: null, error: errorMessage(await res.json().catch(() => null) as DevicePairingErrorResponse | null) };
    }
    return { device: await res.json() as DevicePairingLookupResponse, error: null };
  } catch {
    return { device: null, error: "Couldn't reach the realm. Check your connection and try again." };
  }
}

type Step =
  | { kind: 'enter' }
  | { kind: 'confirm'; device: DevicePairingLookupResponse }
  | { kind: 'approved'; result: DevicePairingApproveResponse }
  | { kind: 'denied' };

const CARD = 'bg-slate-900/80 border-2 border-slate-800 rounded-[32px] p-6 sm:p-8 max-w-md w-full space-y-5';
const PRIMARY = 'w-full py-4 bg-amber-500 hover:bg-amber-400 disabled:opacity-60 rounded-[20px] font-black uppercase italic tracking-tighter transition-colors text-slate-950 cursor-pointer disabled:cursor-not-allowed';
const SECONDARY = 'w-full py-3 bg-slate-800 hover:bg-slate-700 border-2 border-slate-700 rounded-[20px] font-black uppercase italic tracking-tighter transition-colors text-slate-300 cursor-pointer';

// The phone side of TV sign-in: a signed-in player checks the code their TV shows and
// approves it for one of their realms. Signed-out players sign in first and return here.
export const LinkTv = () => {
  const { enabled, user, loading, config } = useAuth();
  const [searchParams] = useSearchParams();
  const [code, setCode] = useState(() => formatCode(searchParams.get('code') ?? ''));
  const [step, setStep] = useState<Step>({ kind: 'enter' });
  const [realms, setRealms] = useState<SessionNamespace[]>([]);
  const [realmId, setRealmId] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signedIn = !!user && !user.deviceSession;

  const showLookup = (outcome: LookupOutcome) => {
    setError(outcome.error);
    if (outcome.device) {
      setLabel(outcome.device.deviceLabel);
      setStep({ kind: 'confirm', device: outcome.device });
    } else {
      setStep({ kind: 'enter' });
    }
  };

  const lookup = async () => {
    setBusy(true);
    showLookup(await lookupCode(code));
    setBusy(false);
  };

  // Signed in: load the realms to pick from, and look up the code the QR code carried.
  const initialCode = formatCode(searchParams.get('code') ?? '');
  useEffect(() => {
    if (!signedIn) {
      return;
    }
    clearPostLoginPath();
    let cancelled = false;
    void apiFetch('/auth/session/namespaces')
      .then(res => (res.ok ? res.json() as Promise<SessionNamespacesResponse> : null))
      .then(data => {
        if (!cancelled && data) {
          setRealms(data.namespaces);
          setRealmId(data.currentNamespaceId ?? data.namespaces[0]?.id ?? '');
        }
      })
      .catch(() => { /* the picker stays empty and approval reports the error */ });
    if (initialCode.length === 9) {
      void lookupCode(initialCode).then(outcome => {
        if (!cancelled) {
          setError(outcome.error);
          if (outcome.device) {
            setLabel(outcome.device.deviceLabel);
            setStep({ kind: 'confirm', device: outcome.device });
          }
        }
      });
    }
    return () => {
      cancelled = true;
    };
  }, [signedIn, initialCode]);

  const decide = async (approve: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = approve
        ? await post('/auth/device/approve', { code, namespaceId: realmId, label: label.trim() || undefined })
        : await post('/auth/device/deny', { code });
      if (!res.ok) {
        setError(errorMessage(await res.json().catch(() => null) as DevicePairingErrorResponse | null));
        return;
      }
      setStep(approve ? { kind: 'approved', result: await res.json() as DevicePairingApproveResponse } : { kind: 'denied' });
    } catch {
      setError("Couldn't reach the realm. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="h-screen bg-slate-950" />;
  }
  if (enabled && !user) {
    rememberPostLoginPath(code ? `/link?code=${code}` : '/link');
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col">
      <SiteHeader />
      <div className="flex-1 flex items-center justify-center px-4 py-6">
        <div className={CARD}>
          <h1 className="text-2xl font-display font-black text-amber-400 italic tracking-tighter text-center">Sign in a TV</h1>

          {!config?.deviceSignIn || !enabled ? (
            <p className="text-slate-300 text-sm text-center">TV sign-in isn't available right now.</p>
          ) : user?.deviceSession ? (
            <p className="text-slate-300 text-sm text-center">This screen is signed in as a TV. Approve TVs from your phone or computer.</p>
          ) : step.kind === 'enter' ? (
            <form
              className="space-y-3"
              onSubmit={e => {
                e.preventDefault();
                void lookup();
              }}
            >
              <p className="text-slate-400 text-sm">Enter the code shown on the TV.</p>
              <label htmlFor="tv-code" className="sr-only">TV code</label>
              <input
                id="tv-code"
                value={code}
                onChange={e => setCode(formatCode(e.target.value))}
                autoCapitalize="characters"
                autoComplete="off"
                placeholder="XXXX-XXXX"
                className="w-full bg-slate-800/60 border border-slate-700 rounded-2xl px-4 py-3 text-slate-100 text-2xl font-mono tracking-widest text-center focus:outline-none focus:border-amber-600"
              />
              {error && <p role="alert" className="text-rose-300 text-sm">{error}</p>}
              <button type="submit" disabled={busy || code.length !== 9} className={PRIMARY}>{busy ? 'Checking...' : 'Continue'}</button>
            </form>
          ) : step.kind === 'confirm' ? (
            <div className="space-y-4">
              <div className="text-center space-y-1">
                <p className="text-slate-400 text-sm">Does your TV show this code?</p>
                <p className="text-4xl font-mono font-black tracking-widest text-white">{code}</p>
                <p className="text-slate-500 text-xs">{step.device.deviceLabel}, asked at {new Date(step.device.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
              </div>
              <p className="bg-amber-950/40 border border-amber-800/60 rounded-2xl px-4 py-3 text-amber-200 text-sm">
                Only approve if this code is on a screen in front of you right now. The TV will play as {user?.email}.
              </p>
              {realms.length > 1 && (
                <div className="space-y-1">
                  <label htmlFor="tv-realm" className="text-slate-400 text-xs uppercase tracking-wider">Realm</label>
                  <select
                    id="tv-realm"
                    value={realmId}
                    onChange={e => setRealmId(e.target.value)}
                    className="w-full bg-slate-800/60 border border-slate-700 rounded-2xl px-4 py-3 text-slate-100 focus:outline-none focus:border-amber-600"
                  >
                    {realms.map(realm => <option key={realm.id} value={realm.id}>{realm.name}</option>)}
                  </select>
                </div>
              )}
              <div className="space-y-1">
                <label htmlFor="tv-label" className="text-slate-400 text-xs uppercase tracking-wider">Name this TV (optional)</label>
                <input
                  id="tv-label"
                  value={label}
                  maxLength={60}
                  onChange={e => setLabel(e.target.value)}
                  placeholder="Living room"
                  className="w-full bg-slate-800/60 border border-slate-700 rounded-2xl px-4 py-3 text-slate-100 focus:outline-none focus:border-amber-600"
                />
              </div>
              {error && <p role="alert" className="text-rose-300 text-sm">{error}</p>}
              <button onClick={() => void decide(true)} disabled={busy || !realmId} className={PRIMARY}>Approve</button>
              <button onClick={() => void decide(false)} disabled={busy} className={SECONDARY}>Deny</button>
            </div>
          ) : step.kind === 'approved' ? (
            <div className="space-y-3 text-center">
              <p className="text-slate-200">The TV is signed in. You can put your phone away.</p>
              {step.result.signedOutLabel && (
                <p className="text-slate-400 text-sm">To stay within 5 TVs, &quot;{step.result.signedOutLabel}&quot; was signed out.</p>
              )}
              <Link to="/" className="block text-amber-400 text-sm font-bold">Back to your adventures</Link>
            </div>
          ) : (
            <div className="space-y-3 text-center">
              <p className="text-slate-200">Denied. The TV was not signed in.</p>
              <Link to="/" className="block text-amber-400 text-sm font-bold">Back to your adventures</Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
