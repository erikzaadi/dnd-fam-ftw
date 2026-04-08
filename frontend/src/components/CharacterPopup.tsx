import { useEffect } from 'react';
import type { Character } from '../types';

interface CharacterPopupProps {
  character: Character;
  onClose: () => void;
  onAvatarClick: (url: string) => void;
}

export const CharacterPopup = ({ character, onClose, onAvatarClick }: CharacterPopupProps) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') {onClose();} };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-xl flex items-center justify-center p-4 animate-in fade-in duration-300">
      <div className="bg-slate-900 p-10 rounded-[40px] border-2 border-amber-500/30 shadow-2xl max-w-lg w-full relative">
        <button onClick={onClose} className="absolute top-6 right-6 text-slate-500 hover:text-white">✕</button>
        <div className="flex gap-6 mb-8">
          <img 
            src={character.avatarUrl || '/api/images/default_scene.png'} 
            onClick={() => onAvatarClick(character.avatarUrl || '/api/images/default_scene.png')} 
            className="w-32 h-32 rounded-2xl object-cover cursor-zoom-in" 
            alt={character.name}
          />
          <div>
            <h3 className="text-3xl font-black text-white">{character.name}</h3>
            <p className="text-amber-500">{character.species} {character.class}</p>
            <p className="text-sm text-slate-400 mt-2 italic">"{character.quirk}"</p>
          </div>
        </div>
        <h4 className="text-xs font-black uppercase tracking-widest text-slate-600 mb-4">Inventory</h4>
        <div className="flex flex-wrap gap-2">
          {(character.inventory || []).map((item, i) => (
            <div key={i} className="group relative px-4 py-2 bg-slate-800 rounded-xl text-xs font-bold border border-slate-700">
              {item.name}
              <div className="absolute bottom-full left-0 mb-2 w-48 p-4 bg-slate-700 rounded-lg text-[10px] hidden group-hover:block z-10">{item.description}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};