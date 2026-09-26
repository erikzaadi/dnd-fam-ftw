import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import type { AutoConfirmListResponse } from '../types';

// Per adventure: does an AI assistant send clean actions after a short Undo window
// (like typed actions on the website), or always ask first? Only affects this player's
// assistant play; the website, car, and terminal keep their own behavior.
export const AutoConfirmSettings = ({ namespaceName }: { namespaceName: string | null }) => {
  const [adventures, setAdventures] = useState<AutoConfirmListResponse['adventures'] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch('/access-tokens/auto-confirm')
      .then(async res => {
        if (res.ok) {
          setAdventures((await res.json() as AutoConfirmListResponse).adventures);
        }
      })
      .catch(() => undefined);
  }, []);

  const toggle = async (id: string, enabled: boolean) => {
    setError(null);
    setAdventures(current => current?.map(a => (a.id === id ? { ...a, enabled } : a)) ?? current);
    try {
      const res = await apiFetch(`/access-tokens/auto-confirm/${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) {
        throw new Error(String(res.status));
      }
    } catch {
      setAdventures(current => current?.map(a => (a.id === id ? { ...a, enabled: !enabled } : a)) ?? current);
      setError('Could not save that setting. Try again.');
    }
  };

  if (!adventures || adventures.length === 0) {
    return null;
  }
  return (
    <section className="space-y-3 p-5 bg-amber-950/20 rounded-[20px] border-2 border-slate-800" aria-labelledby="auto-confirm-heading">
      <h2 id="auto-confirm-heading" className="text-lg font-black uppercase tracking-tighter text-amber-500">Undo window</h2>
      <p className="text-sm text-slate-400">
        Like typed actions on the website, your assistant sends a clean action after a few seconds: press Esc in the assistant to stop it.
        Actions with warnings, gear, or a question from the DM always wait for your OK. Untick an adventure in
        {namespaceName ? ` ${namespaceName}` : ' this realm'} to be asked before every action there. Only your assistant play changes.
      </p>
      {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
      <ul className="space-y-2">
        {adventures.map(adventure => (
          <li key={adventure.id}>
            <label className="flex items-center justify-between gap-4 text-sm text-slate-200 cursor-pointer">
              <span>{adventure.title}</span>
              <input
                type="checkbox"
                checked={adventure.enabled}
                onChange={e => void toggle(adventure.id, e.target.checked)}
                aria-label={`Send clean actions after an Undo window in ${adventure.title}`}
              />
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
};
