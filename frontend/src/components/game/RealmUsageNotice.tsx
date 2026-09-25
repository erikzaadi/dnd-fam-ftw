import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../lib/api';
import type { NamespaceUsageResponse } from '../../types';

type NoticeKind = 'text' | 'pictures';

const MESSAGES: Record<NoticeKind, string> = {
  pictures: "The realm's painters are resting until tomorrow. Your story keeps going without pictures.",
  text: "Your party's adventure energy is spent for today. It refills tomorrow.",
};

const dismissKey = (kind: NoticeKind, resetsAt: string) => `realmNotice:${kind}:${resetsAt.slice(0, 10)}`;

const isDismissed = (key: string): boolean => {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
};

const noticeFor = (usage: NamespaceUsageResponse): NoticeKind | null => {
  if (usage.tier === 'unlimited') {
    return null;
  }
  const { limits, today } = usage;
  if (limits.textCreditsPerDay !== null && today.textCredits >= limits.textCreditsPerDay) {
    return 'text';
  }
  if (usage.picturesPaused) {
    return 'pictures';
  }
  return null;
};

// Shown once per day in a session when a limited group runs out of pictures or energy.
// refreshKey changes after each turn so the check follows play.
export const RealmUsageNotice = ({ refreshKey }: { refreshKey: number }) => {
  const navigate = useNavigate();
  const [notice, setNotice] = useState<{ kind: NoticeKind; key: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch('/namespace/usage')
      .then(res => (res.ok ? res.json() as Promise<NamespaceUsageResponse> : null))
      .then(usage => {
        if (cancelled || !usage) {
          return;
        }
        const kind = noticeFor(usage);
        const key = kind ? dismissKey(kind, usage.resetsAt) : null;
        setNotice(kind && key && !isDismissed(key) ? { kind, key } : null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  if (!notice) {
    return null;
  }

  const dismiss = () => {
    try {
      localStorage.setItem(notice.key, '1');
    } catch {
      // ignore
    }
    setNotice(null);
  };

  return (
    <div role="status" className="fixed top-16 left-1/2 -translate-x-1/2 z-[75] w-[calc(100%-2rem)] max-w-sm px-4 py-3 bg-slate-900/95 border border-amber-800/60 rounded-2xl shadow-xl backdrop-blur-sm">
      <p className="text-sm text-slate-200">{MESSAGES[notice.kind]}</p>
      <div className="mt-2 flex items-center justify-end gap-4 text-xs font-black uppercase tracking-wider">
        <button onClick={() => navigate('/settings')} className="text-amber-500 hover:text-amber-400 cursor-pointer">Your Realm</button>
        <button onClick={dismiss} className="text-slate-400 hover:text-slate-300 cursor-pointer">Got it</button>
      </div>
    </div>
  );
};
