import type { Character } from '../../types';
import { imgSrc } from '../../lib/api';
import { beatTarget } from '../../lib/game';
import { StatImg } from './StatIcon';
import { TtsButton } from '../TtsButton';
import type { TtsSettings } from '../../tts/ttsTypes';
import { STAT_COLORS } from '../../lib/statColors';

interface LastSubmittedAction {
  label: string;
  stat: string;
  char: Character | null;
  difficulty: string;
  difficultyValue?: number;
}

interface DmDecisionRecapPanelProps {
  lastSubmittedAction: LastSubmittedAction | null;
  ttsSettings: TtsSettings;
}

export const DmDecisionRecapPanel = ({ lastSubmittedAction, ttsSettings }: DmDecisionRecapPanelProps) => {
  const char = lastSubmittedAction?.char ?? null;
  const stat = lastSubmittedAction?.stat ?? 'none';

  const statBase = char && stat !== 'none'
    ? char.stats[stat as keyof typeof char.stats] ?? 0
    : 0;
  const statBonus = char && stat !== 'none'
    ? char.inventory.reduce((s, item) => s + (item.statBonuses?.[stat as keyof typeof item.statBonuses] ?? 0), 0)
    : 0;
  const statTotal = statBase + statBonus;

  const minNeeded = lastSubmittedAction
    ? beatTarget(lastSubmittedAction.difficultyValue, lastSubmittedAction.difficulty)
    : 0;

  return (
    <div className="relative flex flex-col items-center justify-center min-h-[55vh] lg:h-full rounded-[32px] overflow-hidden animate-in fade-in zoom-in-95 duration-500">
      {/* Background */}
      <img
        src={imgSrc('/images/dm_thinking.png')}
        className="absolute inset-0 w-full h-full object-cover animate-ken-burns opacity-40"
        alt=""
      />
      <div className="absolute inset-0 bg-slate-950/70" />

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center gap-4 p-6 text-center">
        <img
          src={imgSrc('/images/icon_dice.png')}
          className="w-28 h-28 rounded-full object-cover animate-dice-spin"
          alt="Rolling dice"
        />

        <div className="text-amber-500 font-black uppercase tracking-widest text-lg animate-pulse">
          The DM is narrating...
        </div>

        {lastSubmittedAction && (
          <div className="flex flex-col items-center gap-3 w-full max-w-xs">
            {/* Actor */}
            {char && (
              <div className="flex items-center gap-2">
                <img
                  src={imgSrc(char.avatarUrl)}
                  className="w-10 h-10 rounded-full object-cover border border-slate-600"
                  alt={char.name}
                />
                <span className="text-sm font-black uppercase tracking-widest text-slate-400">
                  {char.name}
                </span>
              </div>
            )}

            {/* Chosen action */}
            <div className="px-4 py-3 bg-slate-900/60 border border-slate-700 rounded-2xl w-full">
              <p className="font-narrative italic text-slate-200 text-base leading-snug">
                "{lastSubmittedAction.label}"
              </p>
              <TtsButton text={lastSubmittedAction.label} ttsSettings={ttsSettings} className="justify-center mt-2" />
            </div>

            {/* Stat info: badge + base + bonus + min roll needed */}
            {stat !== 'none' && char && (
              <div className="flex flex-col items-center gap-2">
                <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-black uppercase tracking-widest ${STAT_COLORS[stat] ?? STAT_COLORS.none}`}>
                  <StatImg stat={stat} size="6" />
                  {stat}
                </span>
                <div className="flex items-center gap-3 text-base font-black">
                  <span className="text-slate-300">
                    {statBase}{statBonus !== 0 && (
                      <span className={statBonus > 0 ? 'text-amber-400' : 'text-rose-400'}>
                        {statBonus > 0 ? `+${statBonus}` : statBonus}
                      </span>
                    )}
                    {' '}= {statTotal}
                  </span>
                  <span className="text-slate-600">·</span>
                  <span className="text-slate-400">Need ≥ {minNeeded}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
