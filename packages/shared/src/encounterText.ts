import type { EncounterEnemy, EncounterState } from './types.js';

// Plain-text encounter descriptions for places without the encounter panel: MCP tool
// results, car mode speech, and terminal mode. Only what the panel shows players:
// traits, resistances, armor, and revealed weaknesses (never hidden ones or intents).

const ROLE_LABEL: Record<EncounterEnemy['role'], string> = {
  minion: 'minion',
  standard: 'foe',
  elite: 'elite foe',
  boss: 'boss',
  hazard: 'hazard',
};

const joinNames = (names: string[]): string => {
  if (names.length <= 1) {
    return names[0] ?? '';
  }
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
};

// "Guardian has 1/33 HP left", or how the enemy left the fight.
export const describeEnemyHealth = (enemy: EncounterEnemy): string => {
  if (enemy.status === 'defeated') {
    return `${enemy.name} is defeated`;
  }
  if (enemy.status === 'fled') {
    return `${enemy.name} fled`;
  }
  if (enemy.status === 'surrendered') {
    return `${enemy.name} surrendered`;
  }
  return `${enemy.name} has ${enemy.hp}/${enemy.maxHp} HP left`;
};

// One line per enemy for the start of a fight.
export const describeEnemy = (enemy: EncounterEnemy): string => {
  const details: string[] = [];
  const traits = enemy.traits ?? [];
  if (traits.length > 0) {
    details.push(traits.join(', '));
  }
  const weaknesses = (enemy.weaknesses ?? []).filter(weakness => weakness.revealed && !weakness.broken).map(weakness => weakness.label);
  if (weaknesses.length > 0) {
    details.push(`weak to ${weaknesses.join(', ')}`);
  }
  const resistances = (enemy.resistances ?? []).map(resistance => resistance.label);
  if (resistances.length > 0) {
    details.push(`resists ${resistances.join(', ')}`);
  }
  if (enemy.armor) {
    details.push(`armor ${enemy.armor}`);
  }
  const head = `${enemy.name}, a ${ROLE_LABEL[enemy.role]} with ${enemy.hp}/${enemy.maxHp} HP`;
  return details.length > 0 ? `${head}: ${details.join('; ')}.` : `${head}.`;
};

export const describeEncounterStart = (encounter: EncounterState): string[] => {
  const lines = [`A fight begins: ${encounter.name}.`];
  if (encounter.objective) {
    lines.push(`Goal: ${encounter.objective}`);
  }
  for (const enemy of encounter.enemies.filter(candidate => candidate.status === 'active')) {
    lines.push(describeEnemy(enemy));
  }
  return lines;
};

// Current health of everyone still in the fight, for after each turn.
export const describeEncounterStatus = (encounter: EncounterState): string =>
  `${encounter.name}, round ${encounter.round}: ${encounter.enemies.map(describeEnemyHealth).join('; ')}.`;

export const describeEncounterEnd = (encounter: EncounterState): string => {
  const names = (status: EncounterEnemy['status']) => joinNames(encounter.enemies.filter(enemy => enemy.status === status).map(enemy => enemy.name));
  const defeated = names('defeated');
  const fled = names('fled');
  const surrendered = names('surrendered');
  const outcome: string[] = [];
  if (defeated) {
    outcome.push(`${defeated} ${defeated.includes(' and ') ? 'are' : 'is'} defeated`);
  }
  if (surrendered) {
    outcome.push(`${surrendered} surrendered`);
  }
  if (fled) {
    outcome.push(`${fled} fled`);
  }
  const summary = outcome.length > 0 ? `: ${outcome.join(', ')}` : '';
  return `The fight is over (${encounter.name})${summary}.`;
};
