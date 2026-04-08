import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { Character, Session } from '../types';
import { CharacterPopup } from '../components/CharacterPopup';
import { CharacterForm } from '../components/CharacterForm';
import { CharacterImportModal } from '../components/CharacterImportModal';
import { FullscreenImage } from '../components/FullscreenImage';
import { ConfirmDialog } from '../components/ConfirmDialog';

export const CharacterAssembly = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [availableCharacters, setAvailableCharacters] = useState<Character[]>([]);
  const [loading, setLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [viewingChar, setViewingChar] = useState<Character | null>(null);
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{message: string, onConfirm: () => void} | null>(null);
  const [editingChar, setEditingChar] = useState<Character | null>(null);

  const loadSession = useCallback(async () => {
    const res = await fetch(`/api/session/${id}`);
    const data = await res.json();
    setSession(data);
  }, [id]);

  const loadAllCharacters = useCallback(async () => {
    const res = await fetch('/api/characters/all');
    const data = await res.json();
    setAvailableCharacters(data);
  }, []);

  useEffect(() => {
    loadSession();
    loadAllCharacters();
  }, [loadSession, loadAllCharacters]);

  const importCharacter = async (char: Character) => {
    if (!session) {return;}
    setLoading(true);
    const { id: _id, ...characterData } = char;
    await fetch('/api/character/create', {
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
            if (!session) {return;}
            setLoading(true);
            try {
                await fetch(`/api/session/${session.id}/character/${charId}`, { method: 'DELETE' });
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
    if (!session) {return;}
    setLoading(true);
    const formData = new FormData(e.currentTarget);
    const charData = {
      name: formData.get('name'),
      class: formData.get('class'),
      species: formData.get('species'),
      quirk: formData.get('quirk'),
      stats: { might: 2, magic: 2, mischief: 2 }
    };
    
    if (editingChar) {
      await fetch(`/api/character/${editingChar.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: session.id, characterData: charData })
      });
    } else {
      await fetch('/api/character/create', {
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
    setLoading(true);
    await fetch(`/api/session/${id}/start`, { method: 'POST' });
    setLoading(false);
    navigate(`/session/${id}`);
  };

  const importableCharacters = availableCharacters.filter(char => !session?.party.find(p => p.id === char.id));

  return (
    <div className="min-h-screen bg-slate-950 p-12 text-white">
      {fullscreenImage && (
        <FullscreenImage url={fullscreenImage} onClose={() => setFullscreenImage(null)} />
      )}

      {isCreating && (
        <CharacterForm 
          onSave={saveCharacter} 
          onCancel={() => { setIsCreating(false); setEditingChar(null); }} 
          isLoading={loading} 
          initialValues={editingChar}
        />
      )}

      {showImportModal && (
        <CharacterImportModal 
            characters={importableCharacters}
            onImport={importCharacter}
            onClose={() => setShowImportModal(false)}
            loading={loading}
        />
      )}

      {viewingChar && (
        <CharacterPopup 
            character={viewingChar} 
            onClose={() => setViewingChar(null)} 
            onAvatarClick={(url) => { setViewingChar(null); setFullscreenImage(url); }} 
        />
      )}

      {confirmDialog && (
        <ConfirmDialog 
            message={confirmDialog.message} 
            onConfirm={() => { confirmDialog.onConfirm(); setConfirmDialog(null); }} 
            onCancel={() => setConfirmDialog(null)} 
        />
      )}

      <h1 className="text-4xl font-black mb-12">Assemble Your Party</h1>

      {session && (
        <div className="mb-12">
            <h2 className="text-2xl font-bold mb-4">Current Party</h2>
            <div className="flex gap-4">
                {session.party.map(c => (
                    <div key={c.id} className="p-4 bg-slate-800 rounded-xl flex items-center gap-4">
                        <button onClick={() => setViewingChar(c)}>{c.name}</button>
                        <div className="flex gap-2">
                            <button onClick={() => { setEditingChar(c); setIsCreating(true); }} className="text-amber-500 hover:text-amber-400">✎</button>
                            <button onClick={() => removeCharacter(c.id)} className="text-rose-500 hover:text-rose-400">✕</button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
      )}

      <div className="flex gap-6">
        <button onClick={() => { setEditingChar(null); setIsCreating(true); }} className="p-8 bg-amber-600 rounded-3xl text-left hover:bg-amber-500 transition-all">
            <h2 className="text-xl font-bold">+ Create New Hero</h2>
        </button>
        {importableCharacters.length > 0 && (
          <button onClick={() => setShowImportModal(true)} className="p-8 bg-slate-800 rounded-3xl text-left hover:bg-slate-700 transition-all">
              <h2 className="text-xl font-bold">+ Import Hero</h2>
          </button>
        )}
      </div>

      <button onClick={startJourney} disabled={loading} className="mt-12 px-12 py-6 bg-slate-700 rounded-2xl text-2xl font-black">START JOURNEY</button>
    </div>
  );
};