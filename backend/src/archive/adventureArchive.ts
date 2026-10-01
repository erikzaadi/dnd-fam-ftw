import { createId } from '../lib/ids.js';
import { getDb } from '../persistence/database.js';
import { withTransaction } from '../persistence/transaction.js';
import { LOCAL_REALM_ID } from '../realms/access.js';

// The adventure archive: adventures as database data, out of one database and into
// another (or back into the same one). Export reads one consistent snapshot; import
// validates the whole archive, then writes it in one transaction.
//
// What an archive is, and is not:
//   - every column of sessions, characters, inventory, turn_history, turn_choices and
//     session_riddles, copied by the current schema (PRAGMA table_info), so a new
//     column travels without changes here
//   - not image files: image URLs and storage keys are copied as references, so an
//     archive imported on another machine has no pictures, and the import report never
//     says they were restored
//   - not runtime state: operations, scene image requests, assistant auto-confirm
//     preferences, assistant create commands and provider usage stay behind
//
// References (REFERENCE_COLUMNS lists every id column; a test fails on a new one):
//   - adventure, hero and riddle ids are kept, and replaced on a collision
//   - inventory, turn and choice ids are always new
//   - every reference to a replaced or new id is remapped, including hero and riddle
//     ids inside JSON columns (hit point changes, buffs, encounter and lifecycle state)
//   - turn_history.operation_id is cleared: operations are not part of an archive

export const ARCHIVE_VERSION = 2;
const SUPPORTED_VERSIONS = new Set([1, 2]);

type Row = Record<string, unknown>;

export type ArchivedCharacter = Row & { inventory?: Row[] };
export type ArchivedTurn = Row & { choices?: Row[] };
export type ArchivedAdventure = Row & {
  characters?: ArchivedCharacter[];
  turnHistory?: ArchivedTurn[];
  // Version 2 and later.
  riddles?: Row[];
};

export type Archive = {
  version: number;
  exportedAt: string;
  sessions: ArchivedAdventure[];
};

export type ExportFilter = { adventureId?: string; realmId?: string };

export type ImportOptions = {
  // Import into this realm instead of the archived one.
  targetRealm?: string;
  // Import even when the archive has fields the current schema does not know; they are
  // dropped and listed in the report.
  allowDrop?: boolean;
};

export type ImportReport = {
  adventures: { oldId: string; newId: string; realmId: string; name: string }[];
  idMaps: { characters: Record<string, string>; turns: Record<string, number>; riddles: Record<string, string> };
  // Columns the archive did not carry: the database default was used.
  defaulted: { table: string; column: string }[];
  // Archive fields the current schema does not know, dropped with allowDrop.
  dropped: { table: string; column: string }[];
  imagesRestored: false;
};

export class ArchiveImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArchiveImportError';
  }
}

type Table = 'sessions' | 'characters' | 'inventory' | 'turn_history' | 'turn_choices' | 'session_riddles';

// Every id-like column in the archived tables and what import does with it.
export const REFERENCE_COLUMNS: Record<Table, Record<string, string>> = {
  sessions: {
    id: 'kept, replaced on collision',
    activeCharacterId: 'remapped hero id',
    sceneId: 'story scene label, copied',
    namespace_id: 'target realm',
  },
  characters: {
    id: 'kept, replaced on collision',
    sessionId: 'the imported adventure',
  },
  inventory: {
    id: 'always new',
    characterId: 'the imported hero',
    itemId: 'item catalog id, copied',
    boundToCharacterId: 'remapped hero id',
  },
  turn_history: {
    id: 'always new',
    sessionId: 'the imported adventure',
    characterId: 'remapped hero id',
    ideas_character_id: 'remapped hero id',
    encounterId: 'encounter id local to the adventure, copied',
    operation_id: 'cleared: operations are not archived',
  },
  turn_choices: {
    id: 'always new',
    turnId: 'remapped turn id',
  },
  session_riddles: {
    id: 'kept, replaced on collision',
    session_id: 'the imported adventure',
    source_turn_id: 'remapped turn id',
  },
};

// Nested arrays in the archive format, not columns.
const NESTED_KEYS: Record<Table, string[]> = {
  sessions: ['characters', 'turnHistory', 'riddles'],
  characters: ['inventory'],
  inventory: [],
  turn_history: ['choices'],
  turn_choices: [],
  session_riddles: [],
};

// Columns import sets itself, whatever the archive says.
const ALWAYS_NEW: Record<Table, string[]> = {
  sessions: [],
  characters: [],
  inventory: ['id'],
  turn_history: ['id'],
  turn_choices: ['id'],
  session_riddles: [],
};

const columnsOf = (table: Table): string[] =>
  (getDb().prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(column => column.name);

export const adventureArchive = {
  export(filter: ExportFilter = {}): Archive {
    const db = getDb();
    const read = (): ArchivedAdventure[] => {
      const sessions = filter.adventureId
        ? db.prepare('SELECT * FROM sessions WHERE id = ?').all(filter.adventureId) as Row[]
        : filter.realmId
          ? db.prepare('SELECT * FROM sessions WHERE namespace_id = ?').all(filter.realmId) as Row[]
          : db.prepare('SELECT * FROM sessions').all() as Row[];
      return sessions.map(session => {
        const adventureId = session.id as string;
        const characters = (db.prepare('SELECT * FROM characters WHERE sessionId = ?').all(adventureId) as Row[]).map(character => ({
          ...character,
          inventory: db.prepare('SELECT * FROM inventory WHERE characterId = ? ORDER BY id').all(character.id as string) as Row[],
        }));
        const turnHistory = (db.prepare('SELECT * FROM turn_history WHERE sessionId = ? ORDER BY id').all(adventureId) as Row[]).map(turn => ({
          ...turn,
          choices: db.prepare('SELECT * FROM turn_choices WHERE turnId = ? ORDER BY id').all(turn.id as number) as Row[],
        }));
        const riddles = db.prepare('SELECT * FROM session_riddles WHERE session_id = ?').all(adventureId) as Row[];
        return { ...session, characters, turnHistory, riddles };
      });
    };
    // One snapshot: a turn committed mid-export cannot mix into it.
    const sessions = db.inTransaction ? read() : db.transaction(read)();
    return { version: ARCHIVE_VERSION, exportedAt: new Date().toISOString(), sessions };
  },

  import(archive: unknown, options: ImportOptions = {}): ImportReport {
    const data = validateShape(archive);
    const columns = Object.fromEntries((Object.keys(REFERENCE_COLUMNS) as Table[]).map(table => [table, columnsOf(table)])) as Record<Table, string[]>;
    const report: ImportReport = {
      adventures: [],
      idMaps: { characters: {}, turns: {}, riddles: {} },
      defaulted: [],
      dropped: [],
      imagesRestored: false,
    };
    checkFields(data, columns, options, report);
    for (const adventure of data.sessions) {
      checkReferences(adventure);
    }
    if (options.targetRealm !== undefined && !realmExists(options.targetRealm)) {
      throw new ArchiveImportError(`Namespace not found: ${options.targetRealm}`);
    }

    withTransaction(() => {
      for (const adventure of data.sessions) {
        importAdventure(adventure, columns, options, report);
      }
    });
    return report;
  },
};

const realmExists = (realmId: string): boolean =>
  realmId === LOCAL_REALM_ID || !!getDb().prepare('SELECT 1 FROM namespaces WHERE id = ?').get(realmId);

const isRow = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value);

const rowsOf = (value: unknown, what: string): Row[] => {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || !value.every(isRow)) {
    throw new ArchiveImportError(`Invalid export file: ${what} must be an array of objects`);
  }
  return value;
};

const validateShape = (archive: unknown): Archive => {
  if (!isRow(archive) || !Array.isArray(archive.sessions)) {
    throw new ArchiveImportError('Invalid export file: missing sessions array');
  }
  const version = archive.version ?? 1;
  if (typeof version !== 'number' || !SUPPORTED_VERSIONS.has(version)) {
    throw new ArchiveImportError(`Unsupported export version: ${String(version)}. This server reads versions ${[...SUPPORTED_VERSIONS].join(' and ')}.`);
  }
  const sessions = rowsOf(archive.sessions, 'sessions').map((session, index) => {
    if (typeof session.id !== 'string' || session.id === '') {
      throw new ArchiveImportError(`Invalid export file: adventure ${index + 1} has no id`);
    }
    const characters = rowsOf(session.characters, `characters of ${session.id}`).map(character => {
      if (typeof character.id !== 'string' || character.id === '') {
        throw new ArchiveImportError(`Invalid export file: a hero of ${session.id} has no id`);
      }
      return { ...character, inventory: rowsOf(character.inventory, `inventory of hero ${character.id}`) };
    });
    const turnHistory = rowsOf(session.turnHistory, `turns of ${session.id}`).map(turn => ({ ...turn, choices: rowsOf(turn.choices, `choices of ${session.id}`) }));
    const riddles = rowsOf(session.riddles, `riddles of ${session.id}`);
    return { ...session, characters, turnHistory, riddles };
  });
  return { version, exportedAt: String(archive.exportedAt ?? ''), sessions };
};

// Unknown fields refuse the import (or are dropped with allowDrop); missing ones are
// reported as defaulted.
const checkFields = (data: Archive, columns: Record<Table, string[]>, options: ImportOptions, report: ImportReport): void => {
  const seen = new Map<Table, Set<string>>();
  const note = (table: Table, row: Row) => {
    const keys = seen.get(table) ?? new Set<string>();
    Object.keys(row).filter(key => !NESTED_KEYS[table].includes(key)).forEach(key => keys.add(key));
    seen.set(table, keys);
  };
  for (const adventure of data.sessions) {
    note('sessions', adventure);
    for (const character of adventure.characters ?? []) {
      note('characters', character);
      (character.inventory ?? []).forEach(item => note('inventory', item));
    }
    for (const turn of adventure.turnHistory ?? []) {
      note('turn_history', turn);
      (turn.choices ?? []).forEach(choice => note('turn_choices', choice));
    }
    (adventure.riddles ?? []).forEach(riddle => note('session_riddles', riddle));
  }
  const unknown: { table: string; column: string }[] = [];
  for (const [table, keys] of seen) {
    for (const key of keys) {
      if (!columns[table].includes(key)) {
        unknown.push({ table, column: key });
      }
    }
    for (const column of columns[table]) {
      if (!keys.has(column) && !ALWAYS_NEW[table].includes(column)) {
        report.defaulted.push({ table, column });
      }
    }
  }
  if (unknown.length > 0 && !options.allowDrop) {
    throw new ArchiveImportError(`The export has fields this server does not know: ${unknown.map(field => `${field.table}.${field.column}`).join(', ')}. Import with --allow-drop to leave them out.`);
  }
  report.dropped.push(...unknown);
};

// Every reference must point inside the same adventure.
const checkReferences = (adventure: ArchivedAdventure): void => {
  const heroIds = new Set((adventure.characters ?? []).map(character => character.id as string));
  const turnIds = new Set((adventure.turnHistory ?? []).map(turn => turn.id));
  const name = String(adventure.displayName ?? adventure.id);
  const hero = (value: unknown, where: string) => {
    if (value !== null && value !== undefined && value !== '' && !heroIds.has(value as string)) {
      throw new ArchiveImportError(`Invalid export file: ${where} in "${name}" names a hero that is not in the adventure (${String(value)})`);
    }
  };
  hero(adventure.activeCharacterId, 'the active hero');
  for (const character of adventure.characters ?? []) {
    (character.inventory ?? []).forEach(item => hero(item.boundToCharacterId, 'a bound item'));
  }
  for (const turn of adventure.turnHistory ?? []) {
    hero(turn.characterId, 'a turn');
    hero(turn.ideas_character_id, 'a turn\'s ideas');
  }
  for (const riddle of adventure.riddles ?? []) {
    if (!turnIds.has(riddle.source_turn_id)) {
      throw new ArchiveImportError(`Invalid export file: a riddle in "${name}" points to a turn that is not in the adventure (${String(riddle.source_turn_id)})`);
    }
  }
};

const exists = (table: 'sessions' | 'characters' | 'session_riddles', id: string): boolean =>
  !!getDb().prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id);

const keepOrReplace = (table: 'sessions' | 'characters' | 'session_riddles', id: string): string =>
  exists(table, id) ? createId() : id;

// Replaces old ids with new ones in a JSON column (exact string values only).
const remapJson = (value: unknown, ids: Map<string, string>): unknown => {
  if (typeof value !== 'string' || ids.size === 0 || ![...ids.keys()].some(id => value.includes(id))) {
    return value;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return value;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return value;
  }
  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') {
      return ids.get(node) ?? node;
    }
    if (Array.isArray(node)) {
      return node.map(walk);
    }
    if (typeof node === 'object' && node !== null) {
      return Object.fromEntries(Object.entries(node).map(([key, child]) => [key, walk(child)]));
    }
    return node;
  };
  return JSON.stringify(walk(parsed));
};

const insert = (table: Table, columns: string[], row: Row): number | bigint => {
  const present = columns.filter(column => column in row);
  const sql = `INSERT INTO ${table} (${present.map(column => `"${column}"`).join(', ')}) VALUES (${present.map(() => '?').join(', ')})`;
  const values = present.map(column => {
    const value = row[column];
    return typeof value === 'object' && value !== null ? JSON.stringify(value) : value;
  });
  return getDb().prepare(sql).run(...values as never[]).lastInsertRowid;
};

const importAdventure = (adventure: ArchivedAdventure, columns: Record<Table, string[]>, options: ImportOptions, report: ImportReport): void => {
  const oldAdventureId = adventure.id as string;
  const realmId = options.targetRealm ?? (typeof adventure.namespace_id === 'string' ? adventure.namespace_id : LOCAL_REALM_ID);
  if (!realmExists(realmId)) {
    throw new ArchiveImportError(`Namespace not found: ${realmId} (archived realm of "${String(adventure.displayName ?? oldAdventureId)}"). Pass --namespace-id to import into another realm.`);
  }
  const adventureId = keepOrReplace('sessions', oldAdventureId);

  // Ids that change, for references and JSON columns.
  const heroIds = new Map<string, string>();
  for (const character of adventure.characters ?? []) {
    const oldId = character.id as string;
    const newId = keepOrReplace('characters', oldId);
    heroIds.set(oldId, newId);
    report.idMaps.characters[oldId] = newId;
  }
  const riddleIds = new Map<string, string>();
  for (const riddle of adventure.riddles ?? []) {
    const oldId = String(riddle.id);
    const newId = keepOrReplace('session_riddles', oldId);
    riddleIds.set(oldId, newId);
    report.idMaps.riddles[oldId] = newId;
  }
  const changed = new Map([...heroIds, ...riddleIds].filter(([oldId, newId]) => oldId !== newId));
  const hero = (value: unknown) => typeof value === 'string' && value !== '' ? heroIds.get(value) ?? value : value;
  const remapRow = (row: Row): Row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, remapJson(value, changed)]));

  insert('sessions', columns.sessions, {
    ...remapRow(adventure),
    id: adventureId,
    namespace_id: realmId,
    activeCharacterId: hero(adventure.activeCharacterId) ?? '',
  });

  for (const character of adventure.characters ?? []) {
    const characterId = heroIds.get(character.id as string)!;
    insert('characters', columns.characters, { ...remapRow(character), id: characterId, sessionId: adventureId });
    for (const item of character.inventory ?? []) {
      const { id: _id, ...rest } = item;
      insert('inventory', columns.inventory, { ...remapRow(rest), characterId, boundToCharacterId: hero(item.boundToCharacterId) ?? null });
    }
  }

  const turnIds = new Map<unknown, number>();
  for (const turn of adventure.turnHistory ?? []) {
    const { id: oldTurnId, ...rest } = turn;
    const newTurnId = Number(insert('turn_history', columns.turn_history, {
      ...remapRow(rest),
      sessionId: adventureId,
      characterId: hero(turn.characterId) ?? null,
      ...('ideas_character_id' in turn && { ideas_character_id: hero(turn.ideas_character_id) ?? null }),
      operation_id: null,
    }));
    turnIds.set(oldTurnId, newTurnId);
    report.idMaps.turns[String(oldTurnId)] = newTurnId;
    for (const choice of turn.choices ?? []) {
      const { id: _choiceId, ...choiceRest } = choice;
      insert('turn_choices', columns.turn_choices, { ...remapRow(choiceRest), turnId: newTurnId });
    }
  }

  for (const riddle of adventure.riddles ?? []) {
    insert('session_riddles', columns.session_riddles, {
      ...remapRow(riddle),
      id: riddleIds.get(String(riddle.id)),
      session_id: adventureId,
      source_turn_id: turnIds.get(riddle.source_turn_id),
    });
  }

  report.adventures.push({ oldId: oldAdventureId, newId: adventureId, realmId, name: String(adventure.displayName ?? '') });
};
