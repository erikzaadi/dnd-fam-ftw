import type { Character } from '../types';
import { imgSrc } from '../lib/api';

interface CharacterImportModalProps {
  characters: Character[];
  onImport: (char: Character) => Promise<void>;
  onClose: () => void;
  loading: boolean;
}

export const CharacterImportModal = ({ characters, onImport, onClose, loading }: CharacterImportModalProps) => (
  <div className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-xl flex items-center justify-center p-4">
    <div className="bg-slate-900 p-10 rounded-[40px] border-2 border-slate-700 shadow-2xl max-w-4xl w-full max-h-[80vh] overflow-y-auto relative">
      <h2 className="text-3xl font-black text-white mb-8">Import Hero</h2>
      {!loading && <button onClick={onClose} className="absolute top-6 right-6 text-slate-500 hover:text-white text-2xl">✕</button>}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          <div className="text-5xl animate-bounce">⚙</div>
          <p className="text-amber-500 font-black uppercase tracking-widest animate-pulse">Summoning hero...</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
          {characters.map(char => (
            <button
              key={char.id}
              onClick={() => onImport(char)}
              className="flex flex-col items-center p-6 bg-slate-800 rounded-3xl hover:border-amber-500 border-2 border-transparent transition-all"
            >
              <img src={imgSrc(char.avatarUrl)} className="w-24 h-24 rounded-2xl object-cover mb-4" alt={char.name} />
              <h3 className="font-bold text-lg">{char.name}</h3>
              <p className="text-xs text-slate-400 uppercase tracking-widest">{char.species} {char.class}</p>
              <p className="text-[10px] text-amber-600 mt-2 italic">from {char.sessionName}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  </div>
);
