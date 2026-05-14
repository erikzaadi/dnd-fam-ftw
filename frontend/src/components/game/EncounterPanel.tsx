import { useState } from 'react';
import type { EncounterArea, EncounterEnemy, EncounterState } from '../../types';
import { imgSrc } from '../../lib/api';

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

export const EncounterAreaCard = ({ area, compact = false }: { area: EncounterArea; compact?: boolean }) => {
  const [lightbox, setLightbox] = useState(false);
  const hasImage = Boolean(area.imageUrl);
  const showDescription = Boolean(area.description) && !area.effect;
  return (
    <>
      <div
        className={`relative rounded-lg overflow-hidden ${hasImage && !compact ? 'aspect-[16/7] cursor-zoom-in' : hasImage ? 'min-h-[48px] cursor-zoom-in' : 'min-h-[48px]'}`}
        onClick={() => hasImage && setLightbox(true)}
        role={hasImage ? 'button' : undefined}
        aria-label={hasImage ? `View ${area.label} image` : undefined}
      >
        {hasImage && (
          <>
            <img
              src={imgSrc(area.imageUrl!)}
              alt=""
              className="absolute inset-0 w-full h-full object-cover scale-110 animate-[kenburns_20s_ease-in-out_infinite_alternate]"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/60 to-slate-950/20" />
          </>
        )}
        <div className={hasImage && !compact ? 'absolute inset-x-0 bottom-0 z-10 p-2' : hasImage ? 'relative z-10 p-2' : 'relative z-10 p-2 bg-slate-900/60 rounded-lg'}>
          <div className="flex flex-wrap items-center gap-1 mb-1">
            <span className="text-xs font-black uppercase tracking-widest text-slate-200 drop-shadow">
              {area.label}
            </span>
            {area.tags.map(tag => (
              <span
                key={tag}
                className="text-[10px] font-black uppercase tracking-widest px-1 py-0.5 rounded bg-slate-900/90 text-slate-400 border border-slate-700/80"
              >
                {tag}
              </span>
            ))}
          </div>
          {showDescription && (
            <p className="text-[11px] text-slate-300 leading-snug mb-1 bg-slate-950/70 rounded px-1.5 py-0.5">{area.description}</p>
          )}
          {area.effect && (
            <span className="inline-flex items-center gap-1 text-[11px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-violet-950/90 text-violet-300 border border-violet-700/60">
              ✦ {area.effect}
            </span>
          )}
        </div>
      </div>

      {lightbox && area.imageUrl && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 backdrop-blur-sm animate-in fade-in"
          onClick={() => setLightbox(false)}
        >
          <img
            src={imgSrc(area.imageUrl)}
            alt={area.label}
            className="max-w-[90vw] max-h-[85vh] object-contain rounded-xl shadow-2xl"
          />
          <button
            type="button"
            aria-label="Close area lightbox"
            className="absolute top-4 right-4 text-slate-400 hover:text-white text-2xl leading-none"
            onClick={() => setLightbox(false)}
          >
            ✕
          </button>
        </div>
      )}
    </>
  );
};

interface EnemyRowProps {
  enemy: EncounterEnemy;
}

export const EnemyRow = ({ enemy }: EnemyRowProps) => {
  const [expanded, setExpanded] = useState(false);
  const [avatarLightbox, setAvatarLightbox] = useState(false);
  const label = getHpLabel(enemy);
  const styles = HP_LABEL_STYLES[label];
  const barPct = getHpBarPct(enemy);
  const statusSuffix = enemy.status !== 'active' ? STATUS_SUFFIX[enemy.status] : null;
  const revealedWeaknesses = (enemy.weaknesses ?? []).filter(w => w.revealed && !w.broken);
  const isActive = enemy.status === 'active';
  const traits = enemy.traits ?? [];
  const resistances = enemy.resistances ?? [];
  const hasDetails = traits.length > 0 || resistances.length > 0 || (enemy.armor != null && enemy.armor > 0);

  return (
    <>
      {avatarLightbox && enemy.avatarUrl && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 backdrop-blur-sm animate-in fade-in"
          onClick={() => setAvatarLightbox(false)}
        >
          <img
            src={imgSrc(enemy.avatarUrl!)}
            alt={enemy.name}
            className="max-w-[90vw] max-h-[85vh] object-contain rounded-xl shadow-2xl"
          />
          <button
            type="button"
            className="absolute top-4 right-4 text-slate-400 hover:text-white text-2xl leading-none"
            onClick={() => setAvatarLightbox(false)}
          >
          ✕
          </button>
        </div>
      )}
      <div className={`py-1.5 ${isActive ? '' : 'opacity-50'}`} data-testid={`enemy-row-${enemy.id}`}>
        <div className="flex w-full items-center gap-2">
          {enemy.avatarUrl && (
            <button
              type="button"
              onClick={() => setAvatarLightbox(true)}
              aria-label={`View ${enemy.name} avatar`}
              className="shrink-0 cursor-zoom-in rounded-full focus:outline-none focus:ring-1 focus:ring-slate-500"
            >
              <img
                src={imgSrc(enemy.avatarUrl)}
                alt={enemy.name}
                className="w-7 h-7 rounded-full object-cover border border-slate-700 hover:border-slate-400 transition-colors"
              />
            </button>
          )}
          <button
            type="button"
            className={`flex flex-1 items-center justify-between gap-2 text-left min-w-0 ${hasDetails ? 'cursor-pointer' : 'cursor-default'}`}
            onClick={() => {
              if (hasDetails) {
                setExpanded(e => !e);
              }
            }}
            aria-expanded={hasDetails ? expanded : undefined}
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-sm font-black text-slate-200 truncate">{enemy.name}</span>
              <span className="text-xs font-black uppercase tracking-widest text-slate-500 shrink-0">[{ROLE_LABEL[enemy.role]}]</span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <span className={`text-xs font-black uppercase tracking-widest ${styles.text}`}>
                {statusSuffix ?? HP_LABEL_DISPLAY[label]}
              </span>
              {hasDetails && (
                <span className={`text-slate-600 text-xs leading-none transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`}>▾</span>
              )}
            </div>
          </button>
        </div>

        {isActive && (
          <div className="mt-1 h-2 w-full rounded-full bg-slate-800 overflow-hidden">
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
                className="text-[11px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-300 border border-amber-700/40"
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
                className="text-[11px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-rose-900/30 text-rose-300 border border-rose-700/30"
              >
                {ef.name}
                {ef.remainingTurns != null ? ` (${ef.remainingTurns})` : ''}
              </span>
            ))}
          </div>
        )}

        {expanded && hasDetails && (
          <div className="mt-1.5 space-y-1">
            {traits.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {traits.map(trait => (
                  <span
                    key={trait}
                    className="text-[11px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700"
                  >
                    {trait}
                  </span>
                ))}
              </div>
            )}
            {enemy.armor != null && enemy.armor > 0 && (
              <div className="flex flex-wrap gap-1">
                <span className="text-[11px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                🛡 Armor {enemy.armor}
                </span>
              </div>
            )}
            {resistances.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {resistances.map(r => (
                  <span
                    key={r.id}
                    className="text-[11px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-slate-800/60 text-slate-500 border border-slate-700/50"
                  >
                  ⬡ {r.label}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
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
          <span className="text-rose-500 text-base leading-none">⚔</span>
          <span className="text-xs font-black uppercase tracking-widest text-rose-400">{encounter.name}</span>
        </div>
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-600">Round {encounter.round}</span>
      </div>

      {(latestTurnSummary || turnCount != null) && (
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
          {latestTurnSummary && (
            <span className="rounded-full border border-amber-700/40 bg-amber-950/30 px-2 py-0.5 text-[11px] font-black uppercase tracking-widest text-amber-300">
              {latestTurnSummary}
            </span>
          )}
          {turnCount != null && turnCount > 0 && (
            <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] font-black uppercase tracking-widest text-slate-500">
              {turnCount} turn{turnCount === 1 ? '' : 's'}
            </span>
          )}
        </div>
      )}

      {encounter.objective && (
        <p className="mb-1.5 text-xs text-slate-400 italic leading-snug">{encounter.objective}</p>
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
        <div className="mt-2 pt-1.5 border-t border-slate-800 space-y-2">
          {encounter.areas.map(area => (
            <EncounterAreaCard key={area.id} area={area} />
          ))}
        </div>
      )}
    </div>
  );
};
