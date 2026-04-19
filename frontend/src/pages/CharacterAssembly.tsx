import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { Character, Session } from '../types';
import { apiFetch, imgSrc } from '../lib/api';
import { CharacterPopup } from '../components/CharacterPopup';
import { CharacterForm } from '../components/CharacterForm';
import { CharacterImportModal } from '../components/CharacterImportModal';
import { FullscreenImage } from '../components/FullscreenImage';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DmFooter } from '../components/DmFooter';
import { SiteHeader } from '../components/SiteHeader';

export const CharacterAssembly = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [availableCharacters, setAvailableCharacters] = useState<Character[]>([]);
  const [loading, setLoading] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [viewingChar, setViewingChar] = useState<Character | null>(null);
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{message: string, onConfirm: () => void} | null>(null);
  const [editingChar, setEditingChar] = useState<Character | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggleSavingsMode = async () => {
    if (!session) {
      return;
    }
    const enabled = !session.savingsMode;
    await apiFetch(`/session/${session.id}/savings-mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    setSession({ ...session, savingsMode: enabled });
  };

  const loadSession = useCallback(async () => {
    const res = await apiFetch(`/session/${id}`);
    const data = await res.json();
    setSession(data);
  }, [id]);

  const loadAllCharacters = useCallback(async () => {
    const res = await apiFetch('/characters/all');
    const data = await res.json();
    setAvailableCharacters(data);
  }, []);

  useEffect(() => {
    loadSession();
    loadAllCharacters();
  }, [loadSession, loadAllCharacters]);

  const importCharacter = async (char: Character) => {
    if (!session) {
      return;
    }
    setLoading(true);
    const { id: originalCharId, avatarUrl: _avatarUrl, sessionName: _sessionName, status: _status, hp: _hp, ...rest } = char as Character & { sessionName?: string };

    let stats = rest.stats;
    try {
      const statsRes = await apiFetch('/character/suggest-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: rest.name, class: rest.class, species: rest.species, quirk: rest.quirk, useLocalAI: session.useLocalAI })
      });
      if (statsRes.ok) {
        stats = await statsRes.json();
      }
    } catch { /* keep original stats */ }

    // Fetch history summary for the original character before importing
    let history: string | undefined;
    try {
      const histRes = await apiFetch(`/character/${originalCharId}/history-summary`);
      if (histRes.ok) {
        const histData = await histRes.json() as { summary: string | null };
        history = histData.summary ?? undefined;
      }
    } catch { /* no history */ }

    const characterData = { ...rest, stats, hp: rest.max_hp, status: 'active', history };
    await apiFetch('/character/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, characterData })
    });
    setLoading(false);
    setShowImportModal(false);
    loadSession();
  };

  const removeCharacter = async (charId: string) => {
    setConfirmDialog({
      message: 'Are you sure you want to remove this hero?',
      onConfirm: async () => {
        if (!session) {
          return;
        }
        setLoading(true);
        try {
          await apiFetch(`/session/${session.id}/character/${charId}`, { method: 'DELETE' });
          await Promise.all([loadSession(), loadAllCharacters()]);
        } catch (err) {
          console.error("Failed to delete character:", err);
        } finally {
          setLoading(false);
          setConfirmDialog(null);
        }
      }
    });
  };

  const saveCharacter = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!session) {
      return;
    }
    setLoading(true);
    const formData = new FormData(e.currentTarget);
    const name = formData.get('name') as string;
    const charClass = formData.get('class') as string;
    const species = formData.get('species') as string;
    const quirk = formData.get('quirk') as string;

    let stats = { might: 2, magic: 2, mischief: 3 };
    try {
      const statsRes = await apiFetch('/character/suggest-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, class: charClass, species, quirk, useLocalAI: session.useLocalAI })
      });
      if (statsRes.ok) {
        stats = await statsRes.json();
      }
    } catch {
      // fallback to defaults
    }

    const charData = {
      name,
      class: charClass,
      species,
      quirk,
      stats,
    };

    if (editingChar) {
      await apiFetch(`/character/${editingChar.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.id, characterData: charData })
      });
    } else {
      await apiFetch('/character/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.id, characterData: charData })
      });
    }
    setLoading(false);
    setIsCreating(false);
    setEditingChar(null);
    loadSession();
  };

  const startJourney = async () => {
    setIsStarting(true);
    setError(null);
    const res = await apiFetch(`/session/${id}/start`, { method: 'POST' });
    setIsStarting(false);
    if (res.status === 429) {
      const data = await res.json();
      setError(data.message ?? 'The AI is busy, please try again.');
      return;
    }
    navigate(`/session/${id}`);
  };

  const importableCharacters = Object.values(
    availableCharacters
      .filter(char => !session?.party.find(p => p.name === char.name))
      .reduce<Record<string, Character>>((acc, char) => ({ ...acc, [char.name]: char }), {})
  );

  return (
    <div className="h-screen bg-slate-950 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-slate-950 text-white flex flex-col overflow-hidden">
      <SiteHeader />
      {fullscreenImage && <FullscreenImage url={fullscreenImage} onClose={() => setFullscreenImage(null)} />}
      {isCreating && <CharacterForm onSave={saveCharacter} onCancel={() => {
        setIsCreating(false); setEditingChar(null);
      }} isLoading={loading} initialValues={editingChar} />}
      {showImportModal && <CharacterImportModal characters={importableCharacters} onImport={importCharacter} onClose={() => setShowImportModal(false)} loading={loading} />}
      {viewingChar && <CharacterPopup character={viewingChar} onClose={() => setViewingChar(null)} onAvatarClick={(url) => {
        setViewingChar(null); setFullscreenImage(url);
      }} />}
      {confirmDialog && <ConfirmDialog message={confirmDialog.message} onConfirm={() => {
        confirmDialog.onConfirm(); setConfirmDialog(null);
      }} onCancel={() => setConfirmDialog(null)} />}

      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-6 min-h-0">
        <div className="max-w-4xl mx-auto space-y-8 md:space-y-12 relative z-[10]">
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-3xl md:text-6xl font-display font-black text-amber-500 italic tracking-tighter drop-shadow-[0_6px_6px_rgba(0,0,0,0.5)]">Assemble Your Party</h1>
            {session && (
              <button
                onClick={toggleSavingsMode}
                title={session.savingsMode ? 'Images off - click to enable' : 'Images on - click to disable'}
                className={`px-3 py-2 rounded-xl border font-black text-xs tracking-widest uppercase transition-all cursor-pointer flex-shrink-0 ${session.savingsMode ? 'border-amber-500 text-amber-400 bg-amber-500/10' : 'border-slate-700 text-slate-500 hover:border-slate-500 hover:text-slate-400'}`}
              >
                {session.savingsMode ? '🪙 Saving' : '🖼 Images'}
              </button>
            )}
          </div>

          {session && session.party.length > 0 && (
            <div className="bg-slate-900 rounded-[48px] border border-slate-800 p-8 space-y-4">
              <h2 className="text-xs font-black uppercase tracking-widest text-amber-500/70 mb-6">Current Heroes</h2>
              <div className="flex flex-wrap gap-4">
                {session.party.map(c => (
                  <div key={c.id} className="flex items-center gap-4 p-4 bg-slate-800/60 rounded-2xl border border-slate-700/50">
                    <img
                      src={imgSrc(c.avatarUrl)}
                      className="w-12 h-12 rounded-xl object-cover border border-slate-600 cursor-pointer"
                      onClick={() => setViewingChar(c)}
                      alt={c.name}
                    />
                    <div className="min-w-0">
                      <div className="font-black text-sm text-slate-100 cursor-pointer hover:text-amber-400 transition-colors" onClick={() => setViewingChar(c)}>{c.name}</div>
                      <div className="text-[10px] text-slate-500 uppercase tracking-wide">{c.class} · {c.species}</div>
                    </div>
                    <div className="flex gap-1 ml-2">
                      <button onClick={() => {
                        setEditingChar(c); setIsCreating(true); 
                      }} className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-700 text-amber-500 hover:bg-amber-500/20 text-xs transition-colors">✎</button>
                      <button onClick={() => removeCharacter(c.id)} className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-700 text-rose-500 hover:bg-rose-500/20 text-xs transition-colors">✕</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-4">
            <button onClick={() => {
              setEditingChar(null); setIsCreating(true); 
            }} className="flex-1 py-6 bg-slate-800 hover:bg-slate-700 rounded-[28px] border border-slate-700 font-black uppercase tracking-widest text-sm transition-all">+ Create New Hero</button>
            {importableCharacters.length > 0 && (
              <button onClick={() => setShowImportModal(true)} className="flex-1 py-6 bg-slate-800 hover:bg-slate-700 rounded-[28px] border border-slate-700 font-black uppercase tracking-widest text-sm transition-all">+ Import Hero</button>
            )}
          </div>

          {error && (
            <div className="flex items-center justify-between gap-4 px-6 py-3 bg-rose-950/60 border border-rose-700 rounded-2xl text-rose-300 text-sm">
              <span>{error}</span>
              <button onClick={() => setError(null)} className="text-rose-500 hover:text-rose-200 font-black">✕</button>
            </div>
          )}

          {session && session.party.length > 0 && (
            <button onClick={startJourney} disabled={isStarting || loading} className="w-full py-6 md:py-8 bg-amber-600 hover:bg-amber-500 rounded-[32px] text-2xl md:text-4xl font-black shadow-[0_12px_0_rgb(146,64,14)] transition-all uppercase italic tracking-tighter disabled:opacity-50 disabled:shadow-none">
              {isStarting ? 'SUMMONING THE DM...' : 'BEGIN ADVENTURE'}
            </button>
          )}
        </div>
      </div>
      <DmFooter />
    </div>
  );
};