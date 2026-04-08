import type { Character } from '../types';

interface PartyBoxProps {
  party: Character[];
  activeCharacterId: string;
  onCharacterClick: (c: Character) => void;
}

export const PartyBox = ({ party, activeCharacterId, onCharacterClick }: PartyBoxProps) => (
  <div className="flex items-center gap-2 bg-slate-900/50 p-3 rounded-full border border-slate-800 shadow-xl">
    <div className="flex gap-2">
      {party.map(c => (
        <img 
          key={c.id} 
          src={c.avatarUrl || '/api/images/default_scene.png'} 
          onClick={() => onCharacterClick(c)}
          title={c.name}
          className={`w-12 h-12 rounded-full object-cover cursor-pointer border-2 transition-all hover:scale-110 ${c.id === activeCharacterId ? 'border-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.6)]' : 'border-slate-800'}`} 
          alt={c.name}
        />
      ))}
    </div>
  </div>
);
