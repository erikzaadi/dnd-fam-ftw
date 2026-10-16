import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { QrCode } from '../components/QrCode';
import type { DevicePairingPollResponse, DevicePairingStartResponse } from '../types';

const BASE = import.meta.env.BASE_URL;
// New codes fetched on their own while the screen is visible (about 40 minutes).
const MAX_AUTO_REFRESH = 3;
const SLOW_DOWN_STEP_MS = 5000;

type Pairing = { userCode: string; expiresAt: number; intervalMs: number };
type StopReason = 'expired' | 'denied' | 'rate_limited' | 'error';

const STOP_MESSAGES: Record<StopReason, string> = {
  expired: 'That code ran out.',
  denied: 'The sign-in was turned down on the phone.',
  rate_limited: 'Too many codes for now. Wait a few minutes and try again.',
  error: "Couldn't reach the realm. Check the connection and try again.",
};

function Countdown({ expiresAt }: { expiresAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  return <>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</>;
}

type StartOutcome = { pairing: Pairing; stopped: null } | { pairing: null; stopped: StopReason };

async function requestPairing(): Promise<StartOutcome> {
  try {
    const res = await apiFetch('/auth/device/start', { method: 'POST' });
    if (res.status !== 202) {
      return { pairing: null, stopped: res.status === 429 ? 'rate_limited' : 'error' };
    }
    const data = await res.json() as DevicePairingStartResponse;
    return { pairing: { userCode: data.userCode, expiresAt: Date.now() + data.expiresInSeconds * 1000, intervalMs: data.intervalSeconds * 1000 }, stopped: null };
  } catch {
    return { pairing: null, stopped: 'error' };
  }
}

// The TV side of TV sign-in: shows a code and QR code, and waits for a signed-in phone
// to approve it on /link. Nothing is typed on the TV.
export const TvSignIn = () => {
  const { config } = useAuth();
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [stopped, setStopped] = useState<StopReason | null>(null);
  const autoRefreshes = useRef(0);

  useEffect(() => {
    if (config?.deviceSignIn) {
      void requestPairing().then(outcome => {
        setPairing(outcome.pairing);
        setStopped(outcome.stopped);
      });
    }
  }, [config?.deviceSignIn]);

  useEffect(() => {
    if (!pairing) {
      return;
    }
    let cancelled = false;
    let intervalMs = pairing.intervalMs;
    let timer: ReturnType<typeof setTimeout>;
    const stop = (reason: StopReason) => {
      setPairing(null);
      setStopped(reason);
    };
    const poll = async () => {
      try {
        const res = await apiFetch('/auth/device/poll');
        const { status } = await res.json() as DevicePairingPollResponse;
        if (cancelled) {
          return;
        }
        if (status === 'approved') {
          // A full load picks up the new sign-in everywhere.
          window.location.assign(BASE);
          return;
        }
        if (status === 'denied') {
          stop('denied');
          return;
        }
        if (status === 'expired') {
          if (document.visibilityState === 'visible' && autoRefreshes.current < MAX_AUTO_REFRESH) {
            autoRefreshes.current += 1;
            const outcome = await requestPairing();
            setPairing(outcome.pairing);
            setStopped(outcome.stopped);
          } else {
            stop('expired');
          }
          return;
        }
        if (status === 'slow_down') {
          intervalMs += SLOW_DOWN_STEP_MS;
        }
      } catch {
        // A dropped poll is retried on the next tick.
      }
      if (!cancelled) {
        timer = setTimeout(() => void poll(), intervalMs);
      }
    };
    timer = setTimeout(() => void poll(), intervalMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pairing]);

  const restart = async () => {
    autoRefreshes.current = 0;
    const outcome = await requestPairing();
    setPairing(outcome.pairing);
    setStopped(outcome.stopped);
  };

  const linkUrl = `${window.location.origin}${BASE}link`;

  return (
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center px-6 py-10">
      <div className="max-w-4xl w-full text-center space-y-8">
        <h1 className="text-4xl md:text-6xl font-display font-black text-amber-400 italic tracking-tighter">Sign in this TV</h1>

        {!config && <p className="text-slate-400 text-2xl animate-pulse">Opening the realm gate...</p>}

        {config && !config.deviceSignIn && (
          <div className="space-y-6">
            <p className="text-slate-300 text-2xl">TV sign-in isn't available on this realm right now.</p>
            <Link to="/login" className="inline-block px-8 py-4 bg-amber-500 rounded-[20px] font-black uppercase italic text-slate-950 text-xl focus:outline-none focus:ring-4 focus:ring-amber-200">
              Sign in another way
            </Link>
          </div>
        )}

        {config?.deviceSignIn && !pairing && !stopped && <p className="text-slate-400 text-2xl animate-pulse">Getting a code...</p>}

        {pairing && (
          <div className="flex flex-col md:flex-row items-center justify-center gap-10">
            <QrCode value={`${linkUrl}?code=${pairing.userCode}`} label="QR code to approve this TV" className="w-64 h-64 md:w-80 md:h-80 rounded-2xl" />
            <div className="space-y-5 text-left">
              <p className="text-slate-300 text-2xl">Scan with a phone that is signed in, or open</p>
              <p className="text-amber-300 text-3xl font-bold break-all">{`${window.location.host}${BASE}link`}</p>
              <p className="text-slate-300 text-2xl">and enter</p>
              <p className="text-6xl md:text-7xl font-mono font-black tracking-widest text-white" aria-label={`Code ${pairing.userCode.split('').join(' ')}`}>{pairing.userCode}</p>
              <p className="text-slate-400 text-xl">Code expires in <Countdown expiresAt={pairing.expiresAt} /></p>
            </div>
          </div>
        )}

        {stopped && (
          <div className="space-y-6">
            <p role="alert" className="text-slate-300 text-2xl">{STOP_MESSAGES[stopped]}</p>
            <button
              autoFocus
              onClick={() => void restart()}
              className="px-10 py-5 bg-amber-500 hover:bg-amber-400 rounded-[20px] font-black uppercase italic tracking-tighter text-slate-950 text-2xl cursor-pointer focus:outline-none focus:ring-4 focus:ring-amber-200"
            >
              Get a new code
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
