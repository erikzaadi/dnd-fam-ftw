import { useEffect } from 'react';
import type { Character } from '../types';
import { Modal } from './Modal';

interface CharacterSuggestions {
  name: string;
  class: string;
  species: string;
  quirk: string;
}

interface CharacterFormProps {
  onSave: (e: React.FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
  isLoading: boolean;
  initialValues?: Character | null;
  suggestions?: CharacterSuggestions;
  onRandomize?: () => void;
}

export const CharacterForm = ({ onSave, onCancel, isLoading, initialValues, suggestions, onRandomize }: CharacterFormProps) => {
  const isEditing = Boolean(initialValues);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      } 
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  return (
    <Modal>
      <div className="bg-slate-900 p-10 rounded-[40px] border-2 border-amber-500/30 shadow-2xl max-w-lg w-full relative">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-3xl font-black text-white">{isLoading ? (isEditing ? 'Editing your hero...' : 'Creating your hero...') : isEditing ? 'Edit Hero' : 'Create New Hero'}</h3>
          {!isEditing && !isLoading && onRandomize && (
            <button type="button" onClick={onRandomize} title="Re-roll suggestions" className="px-3 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-amber-400 font-black text-sm uppercase tracking-widest transition-colors">
              Roll
            </button>
          )}
        </div>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <div className="text-5xl animate-bounce">⚒</div>
            <p className="text-amber-500 font-black uppercase tracking-widest animate-pulse">{isEditing ? 'Updating hero...' : 'Generating portrait...'}</p>
          </div>
        ) : (
          <form key={suggestions ? `${suggestions.name}|${suggestions.class}|${suggestions.species}` : 'empty'} onSubmit={onSave}>
            <div className="space-y-4">
              <input name="name" defaultValue={initialValues?.name ?? suggestions?.name} placeholder="Sir Fluffington the Brave" required className="w-full p-4 bg-slate-800 rounded-xl" />
              <input name="class" defaultValue={initialValues?.class ?? suggestions?.class} placeholder="Professional Napper / Chaotic Wizard" required className="w-full p-4 bg-slate-800 rounded-xl" />
              <input name="species" defaultValue={initialValues?.species ?? suggestions?.species} placeholder="Intergalactic Hamster" required className="w-full p-4 bg-slate-800 rounded-xl" />
              <input name="gender" defaultValue={initialValues?.gender} placeholder="Gender (optional - e.g. female, non-binary, he/him)" className="w-full p-4 bg-slate-800 rounded-xl" />
              <textarea name="quirk" defaultValue={initialValues?.quirk ?? suggestions?.quirk} placeholder="Must solve every problem with a dance-off" required className="w-full p-4 bg-slate-800 rounded-xl" />
            </div>
            <div className="flex gap-4 mt-8">
              <button type="submit" className="flex-1 py-4 bg-amber-600 rounded-xl font-black uppercase">Save</button>
              <button type="button" onClick={onCancel} className="flex-1 py-4 bg-slate-800 rounded-xl font-black uppercase">Cancel</button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
};
