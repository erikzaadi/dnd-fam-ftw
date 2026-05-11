import { useEffect, useState } from 'react';
import type { Character } from '../types';
import { CHARACTER_PRESETS, type CharacterPresetId } from '../data/characterPresets';
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

const buildValues = (initialValues?: Character | null, suggestions?: CharacterSuggestions) => ({
  name: initialValues?.name ?? suggestions?.name ?? '',
  class: initialValues?.class ?? suggestions?.class ?? '',
  species: initialValues?.species ?? suggestions?.species ?? '',
  gender: initialValues?.gender ?? '',
  quirk: initialValues?.quirk ?? suggestions?.quirk ?? '',
  stats: initialValues?.stats ?? { might: 2, magic: 2, mischief: 3 },
});

export const CharacterForm = ({ onSave, onCancel, isLoading, initialValues, suggestions, onRandomize }: CharacterFormProps) => {
  const isEditing = Boolean(initialValues);
  const valueSeed = initialValues
    ? `edit:${initialValues.id}:${initialValues.name}:${initialValues.class}:${initialValues.species}:${initialValues.quirk}`
    : `new:${suggestions?.name ?? ''}:${suggestions?.class ?? ''}:${suggestions?.species ?? ''}:${suggestions?.quirk ?? ''}`;
  const [lastValueSeed, setLastValueSeed] = useState(valueSeed);
  const [selectedPreset, setSelectedPreset] = useState<CharacterPresetId>('manual');
  const [presetStats, setPresetStats] = useState<Character['stats'] | null>(null);
  const [values, setValues] = useState(() => buildValues(initialValues, suggestions));

  if (lastValueSeed !== valueSeed) {
    setLastValueSeed(valueSeed);
    setValues(buildValues(initialValues, suggestions));
    setSelectedPreset('manual');
    setPresetStats(null);
  }

  const applyPreset = (presetId: CharacterPresetId) => {
    setSelectedPreset(presetId);
    const preset = CHARACTER_PRESETS.find(p => p.id === presetId);
    const presetValues = preset?.values;
    if (!presetValues) {
      setPresetStats(null);
      return;
    }
    setPresetStats(presetValues.stats);
    setValues(current => ({
      ...current,
      class: presetValues.class,
      species: presetValues.species,
      quirk: presetValues.quirk,
      stats: presetValues.stats,
    }));
  };

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
      <div className="my-4 max-h-[calc(100dvh-2rem)] overflow-y-auto bg-slate-900 p-5 sm:p-10 rounded-[28px] sm:rounded-[40px] border-2 border-amber-500/30 shadow-2xl max-w-lg w-full relative">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-3xl font-black text-white">{isLoading ? (isEditing ? 'Editing your hero...' : 'Creating your hero...') : isEditing ? 'Edit Hero' : 'Create New Hero'}</h3>
          {!isEditing && !isLoading && onRandomize && (
            <button type="button" onClick={onRandomize} className="px-3 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-amber-400 font-black text-sm uppercase tracking-widest transition-colors">
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
          <form onSubmit={onSave}>
            {!isEditing && (
              <div data-tutorial="preset-chooser" className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {CHARACTER_PRESETS.map(preset => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyPreset(preset.id)}
                    className={`min-h-[82px] rounded-xl border-2 px-3 py-2 text-left transition-colors ${selectedPreset === preset.id ? 'border-amber-500 bg-amber-600/15 text-white' : 'border-slate-700 bg-slate-800/60 text-slate-400 hover:border-slate-500'}`}
                  >
                    <span className="block text-xs font-black uppercase tracking-widest text-amber-300">{preset.label}</span>
                    <span className="mt-1 block text-xs leading-snug">{preset.description}</span>
                  </button>
                ))}
              </div>
            )}

            <div data-tutorial="character-form" className="space-y-4">
              <input
                name="name"
                value={values.name}
                onChange={e => setValues(current => ({ ...current, name: e.target.value }))}
                placeholder="Sir Fluffington the Brave"
                required
                className="w-full p-4 bg-slate-800 rounded-xl"
              />
              <input
                name="class"
                value={values.class}
                onChange={e => setValues(current => ({ ...current, class: e.target.value }))}
                placeholder="Brave Knight / Chaotic Wizard"
                required
                className="w-full p-4 bg-slate-800 rounded-xl"
              />
              <input
                name="species"
                value={values.species}
                onChange={e => setValues(current => ({ ...current, species: e.target.value }))}
                placeholder="Intergalactic Hamster"
                required
                className="w-full p-4 bg-slate-800 rounded-xl"
              />
              <input
                name="gender"
                value={values.gender}
                onChange={e => setValues(current => ({ ...current, gender: e.target.value }))}
                placeholder="Gender (optional - e.g. female, non-binary, he/him)"
                className="w-full p-4 bg-slate-800 rounded-xl"
              />
              <textarea
                name="quirk"
                value={values.quirk}
                onChange={e => setValues(current => ({ ...current, quirk: e.target.value }))}
                placeholder="Must solve every problem with a dance-off"
                required
                className="w-full p-4 bg-slate-800 rounded-xl"
              />
              {presetStats && (
                <div className="rounded-xl border border-slate-700 bg-slate-800/70 px-4 py-3 text-sm text-slate-300">
                  <span className="font-black uppercase tracking-widest text-amber-300">Preset stats:</span>{' '}
                  Might {presetStats.might} / Magic {presetStats.magic} / Mischief {presetStats.mischief}
                </div>
              )}
              {presetStats && (
                <>
                  <input type="hidden" name="might" value={presetStats.might} />
                  <input type="hidden" name="magic" value={presetStats.magic} />
                  <input type="hidden" name="mischief" value={presetStats.mischief} />
                </>
              )}
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
