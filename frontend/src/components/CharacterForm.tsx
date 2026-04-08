import { useEffect } from 'react';
import type { Character } from '../types';

interface CharacterFormProps {
  onSave: (e: React.FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
  isLoading: boolean;
  initialValues?: Character | null;
}

export const CharacterForm = ({ onSave, onCancel, isLoading, initialValues }: CharacterFormProps) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') {onCancel();} };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-xl flex items-center justify-center p-4">
      <form onSubmit={onSave} className="bg-slate-900 p-10 rounded-[40px] border-2 border-amber-500/30 shadow-2xl max-w-lg w-full relative">
        <h3 className="text-3xl font-black text-white mb-6">{initialValues ? 'Edit Hero' : 'Create New Hero'}</h3>
        <div className="space-y-4">
          <input name="name" defaultValue={initialValues?.name} placeholder="Sir Fluffington the Brave" required className="w-full p-4 bg-slate-800 rounded-xl" />
          <input name="class" defaultValue={initialValues?.class} placeholder="Professional Napper / Chaotic Wizard" required className="w-full p-4 bg-slate-800 rounded-xl" />
          <input name="species" defaultValue={initialValues?.species} placeholder="Intergalactic Hamster" required className="w-full p-4 bg-slate-800 rounded-xl" />
          <textarea name="quirk" defaultValue={initialValues?.quirk} placeholder="Must solve every problem with a dance-off" required className="w-full p-4 bg-slate-800 rounded-xl" />
        </div>
        <div className="flex gap-4 mt-8">
          <button type="submit" disabled={isLoading} className="flex-1 py-4 bg-amber-600 rounded-xl font-black uppercase">{isLoading ? 'Forging...' : 'Save'}</button>
          <button type="button" onClick={onCancel} className="flex-1 py-4 bg-slate-800 rounded-xl font-black uppercase">Cancel</button>
        </div>
      </form>
    </div>
  );
};
