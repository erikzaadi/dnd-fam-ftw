import type { EncounterEnemy, EncounterState } from '../../types';

interface Props {
  encounter: EncounterState;
  highlighted?: boolean;
  latestTurnSummary?: string;
  turnCount?: number;
}

type HpLabel = 'fresh' | 'wounded' | 'staggering' | 'nearly broken' | 'defeated';

const HP_LABEL_STYLES: Record<HpLabel, { text: string; bar: string }> = {
  fresh: { text: 'text-green-400', bar: 'bg-green-500' },
  wounded: { text: 'text-yellow-400', bar: 'bg-yellow-500' },
  staggering: { text: 'text-amber-400', bar: 'bg-amber-500' },
  'nearly broken': { text: 'text-red-400', bar: 'bg-red-500' },
  defeated: { text: 'text-slate-500', bar: 'bg-slate-700' },
};

const HP_LABEL_DISPLAY: Record<HpLabel, string> = {
  fresh: 'Fresh',
  wounded: 'Wounded',
  staggering: 'Staggering',
  'nearly broken': 'Nearly Broken',
  defeated: 'Defeated',
};

const ROLE_LABEL: Record<EncounterEnemy['role'], string> = {
  minion: 'Minion',
  standard: 'Foe',
  elite: 'Elite',
  boss: 'Boss',
  hazard: 'Hazard',
};

const STATUS_SUFFIX: Partial<Record<EncounterEnemy['status'], string>> = {
  fled: 'Fled',
  surrendered: 'Surrendered',
};

function getHpLabel(enemy: EncounterEnemy): HpLabel {
  if (enemy.status !== 'active' || enemy.hp === 0) {
    return 'defeated';
  }
  const ratio = enemy.maxHp > 0 ? enemy.hp / enemy.maxHp : 0;
  if (ratio > 0.75) {
    return 'fresh';
  }
  if (ratio > 0.5) {
    return 'wounded';
  }
  if (ratio > 0.25) {
    return 'staggering';
  }
  return 'nearly broken';
}

function getHpBarPct(enemy: EncounterEnemy): number {
  if (enemy.status !== 'active' || enemy.hp === 0 || enemy.maxHp === 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round((enemy.hp / enemy.maxHp) * 100)));
}

interface EnemyRowProps {
  enemy: EncounterEnemy;
}

const EnemyRow = ({ enemy }: EnemyRowProps) => {
  const label = getHpLabel(enemy);
  const styles = HP_LABEL_STYLES[label];
  const barPct = getHpBarPct(enemy);
  const statusSuffix = enemy.status !== 'active' ? STATUS_SUFFIX[enemy.status] : null;
  const revealedWeaknesses = (enemy.weaknesses ?? []).filter(w => w.revealed && !w.broken);
  const isActive = enemy.status === 'active';

  return (
    <div className={`py-1.5 ${isActive ? '' : 'opacity-50'}`} data-testid={`enemy-row-${enemy.id}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xs font-black text-slate-200 truncate">{enemy.name}</span>
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 shrink-0">[{ROLE_LABEL[enemy.role]}]</span>
        </div>
        <span className={`text-[10px] font-black uppercase tracking-widest shrink-0 ${styles.text}`}>
          {statusSuffix ?? HP_LABEL_DISPLAY[label]}
        </span>
      </div>

      {isActive && (
        <div className="mt-1 h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${styles.bar}`}
            style={{ width: `${barPct}%` }}
            role="progressbar"
            aria-valuenow={barPct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${enemy.name} HP: ${HP_LABEL_DISPLAY[label]}`}
          />
        </div>
      )}

      {revealedWeaknesses.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {revealedWeaknesses.map(w => (
            <span
              key={w.id}
              className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-300 border border-amber-700/40"
            >
              ⚡ {w.label}
            </span>
          ))}
        </div>
      )}

      {isActive && (enemy.effects ?? []).length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {(enemy.effects ?? []).map(ef => (
            <span
              key={ef.id}
              className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-rose-900/30 text-rose-300 border border-rose-700/30"
            >
              {ef.name}
              {ef.remainingTurns != null ? ` (${ef.remainingTurns})` : ''}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

export const EncounterPanel = ({ encounter, highlighted = false, latestTurnSummary, turnCount }: Props) => {
  const activeEnemies = encounter.enemies.filter(e => e.status === 'active');
  const resolvedEnemies = encounter.enemies.filter(e => e.status !== 'active');

  return (
    <div
      className={`rounded-xl border bg-slate-950/80 px-3 py-2 text-xs transition-all ${highlighted ? 'border-amber-500/70 shadow-[0_0_24px_rgba(245,158,11,0.16)]' : 'border-rose-900/50'}`}
      data-testid="encounter-panel"
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-rose-500 text-sm leading-none">⚔</span>
          <span className="text-[10px] font-black uppercase tracking-widest text-rose-400">{encounter.name}</span>
        </div>
        <span className="text-[9px] font-black uppercase tracking-widest text-slate-600">Round {encounter.round}</span>
      </div>

      {(latestTurnSummary || turnCount != null) && (
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
          {latestTurnSummary && (
            <span className="rounded-full border border-amber-700/40 bg-amber-950/30 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-amber-300">
              {latestTurnSummary}
            </span>
          )}
          {turnCount != null && turnCount > 0 && (
            <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-slate-500">
              {turnCount} turn{turnCount === 1 ? '' : 's'}
            </span>
          )}
        </div>
      )}

      {encounter.objective && (
        <p className="mb-1.5 text-[10px] text-slate-400 italic leading-snug">{encounter.objective}</p>
      )}

      <div className="divide-y divide-slate-800">
        {activeEnemies.map(enemy => (
          <EnemyRow key={enemy.id} enemy={enemy} />
        ))}
        {resolvedEnemies.map(enemy => (
          <EnemyRow key={enemy.id} enemy={enemy} />
        ))}
      </div>

      {encounter.areas.length > 0 && (
        <div className="mt-2 pt-1.5 border-t border-slate-800 flex flex-wrap gap-1">
          {encounter.areas.map(area => (
            <span
              key={area.id}
              className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700"
            >
              {area.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};
