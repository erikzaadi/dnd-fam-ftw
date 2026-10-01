import os from 'os';
import path from 'path';
import fs from 'fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb, initializeDatabase } from '../persistence/database.js';
import { adventureArchive, ArchiveImportError, REFERENCE_COLUMNS, type Archive } from './adventureArchive.js';

const DB_PATH = path.join(os.tmpdir(), `dnd-archive-test-${Date.now()}.sqlite`);
const ADVENTURE = 'archive-adv';
const PIP = 'archive-pip';
const ZARA = 'archive-zara';

type Row = Record<string, unknown>;

const db = () => getDb();

// An adventure using every kind of reference: active hero, a bound item, buffs and hit
// point changes naming heroes, encounter state, ideas for a hero, a riddle posed by a
// turn, image references, and an operation id that must not travel.
const seed = (adventureId = ADVENTURE, pip = PIP, zara = ZARA) => {
  db().prepare(`INSERT INTO sessions (id, scene, sceneId, worldDescription, turn, activeCharacterId, displayName, namespace_id, image_policy, encounter_state, origin_story, adventure_format)
    VALUES (?, 'A cave', 'cave-1', 'Damp', 3, ?, 'Archive Realm', 'local', 'on_demand', ?, 'Once upon a cave', 'one_evening')`)
    .run(adventureId, zara, JSON.stringify({ status: 'active', enemies: [{ id: 'goblin', avatarUrl: '/img/goblin.png', targetId: pip }] }));
  for (const [id, name] of [[pip, 'Pip'], [zara, 'Zara']]) {
    db().prepare(`INSERT INTO characters (id, sessionId, name, class, species, quirk, buffs, avatarUrl, avatar_storage_key)
      VALUES (?, ?, ?, 'Rogue', 'Halfling', 'Hums', ?, ?, ?)`)
      .run(id, adventureId, name, JSON.stringify([{ id: 'blessed', sourceCharacterId: id === pip ? zara : pip }]), `/img/${id}.png`, `avatars/${id}.png`);
  }
  db().prepare("INSERT INTO inventory (characterId, itemId, name, boundToCharacterId, charges) VALUES (?, 'rope', 'Rope', ?, 2)").run(pip, zara);
  const turn = (characterId: string, narration: string) => Number(db().prepare(`INSERT INTO turn_history (sessionId, characterId, narration, hpChanges, buffChanges, actionBuffBonus, choicesFailed, ideas_character_id, operation_id, image_storage_key)
    VALUES (?, ?, ?, ?, ?, 1, 0, ?, 'op-1', ?)`)
    .run(adventureId, characterId, narration, JSON.stringify([{ characterId, delta: -2 }]), JSON.stringify([{ characterId: zara, added: 'blessed' }]), characterId, `turns/${narration}.png`).lastInsertRowid);
  const first = turn(pip, 'riddle');
  turn(zara, 'answer');
  db().prepare("INSERT INTO turn_choices (turnId, label, difficulty, stat, riddleAnswer, riddleCorrect) VALUES (?, 'Say echo', 'normal', 'magic', 'echo', 1)").run(first);
  db().prepare("INSERT INTO session_riddles (id, session_id, source_turn_id, source_turn_number, prompt, canonical_answer, source) VALUES (?, ?, ?, 2, 'What answers back?', 'echo', 'narration')")
    .run(`${adventureId}-riddle`, adventureId, first);
};

const rowsFor = (adventureId: string) => ({
  session: db().prepare('SELECT * FROM sessions WHERE id = ?').get(adventureId) as Row,
  characters: db().prepare('SELECT * FROM characters WHERE sessionId = ? ORDER BY name').all(adventureId) as Row[],
  inventory: db().prepare('SELECT i.* FROM inventory i JOIN characters c ON c.id = i.characterId WHERE c.sessionId = ?').all(adventureId) as Row[],
  turns: db().prepare('SELECT * FROM turn_history WHERE sessionId = ? ORDER BY id').all(adventureId) as Row[],
  choices: db().prepare('SELECT tc.* FROM turn_choices tc JOIN turn_history t ON t.id = tc.turnId WHERE t.sessionId = ?').all(adventureId) as Row[],
  riddles: db().prepare('SELECT * FROM session_riddles WHERE session_id = ?').all(adventureId) as Row[],
});

const without = (row: Row, ...keys: string[]): Row => Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key)));

const deleteAdventure = (adventureId: string) => {
  db().prepare('DELETE FROM turn_choices WHERE turnId IN (SELECT id FROM turn_history WHERE sessionId = ?)').run(adventureId);
  db().prepare('DELETE FROM session_riddles WHERE session_id = ?').run(adventureId);
  db().prepare('DELETE FROM turn_history WHERE sessionId = ?').run(adventureId);
  db().prepare('DELETE FROM inventory WHERE characterId IN (SELECT id FROM characters WHERE sessionId = ?)').run(adventureId);
  db().prepare('DELETE FROM characters WHERE sessionId = ?').run(adventureId);
  db().prepare('DELETE FROM sessions WHERE id = ?').run(adventureId);
};

beforeAll(() => {
  process.env.SQLITE_DB_PATH = DB_PATH;
  initializeDatabase();
});

beforeEach(() => {
  for (const id of (db().prepare("SELECT id FROM sessions WHERE id LIKE 'archive-%' OR displayName = 'Archive Realm'").all() as { id: string }[]).map(row => row.id)) {
    deleteAdventure(id);
  }
});

afterAll(() => {
  fs.rmSync(DB_PATH, { force: true });
});

describe('adventureArchive', () => {
  it('exports version 2 with riddles', () => {
    seed();
    const archive = adventureArchive.export({ adventureId: ADVENTURE });
    expect(archive.version).toBe(2);
    expect(archive.sessions[0].riddles).toHaveLength(1);
    expect(archive.sessions[0].turnHistory?.[0].choices).toHaveLength(1);
  });

  it('round-trips every column, changing only new row ids and the operation id', () => {
    seed();
    const before = rowsFor(ADVENTURE);
    const archive = adventureArchive.export({ adventureId: ADVENTURE });
    deleteAdventure(ADVENTURE);

    const report = adventureArchive.import(archive);

    expect(report.adventures).toEqual([{ oldId: ADVENTURE, newId: ADVENTURE, realmId: 'local', name: 'Archive Realm' }]);
    expect(report.imagesRestored).toBe(false);
    expect(report.defaulted).toEqual([]);
    const after = rowsFor(ADVENTURE);
    expect(after.session).toEqual(before.session);
    expect(after.characters).toEqual(before.characters);
    expect(after.inventory.map(row => without(row, 'id'))).toEqual(before.inventory.map(row => without(row, 'id')));
    expect(after.turns.map(row => without(row, 'id', 'operation_id'))).toEqual(before.turns.map(row => without(row, 'id', 'operation_id')));
    expect(after.turns.every(row => row.operation_id === null)).toBe(true);
    expect(after.choices.map(row => without(row, 'id', 'turnId'))).toEqual(before.choices.map(row => without(row, 'id', 'turnId')));
    expect(after.choices[0].turnId).toBe(after.turns[0].id);
    expect(after.riddles.map(row => without(row, 'source_turn_id'))).toEqual(before.riddles.map(row => without(row, 'source_turn_id')));
    expect(after.riddles[0].source_turn_id).toBe(after.turns[0].id);
  });

  it('imports into the source database with new ids and every reference remapped', () => {
    seed();
    const archive = adventureArchive.export({ adventureId: ADVENTURE });

    const report = adventureArchive.import(archive);

    const copyId = report.adventures[0].newId;
    expect(copyId).not.toBe(ADVENTURE);
    const pip = report.idMaps.characters[PIP];
    const zara = report.idMaps.characters[ZARA];
    expect([pip, zara]).not.toContain(PIP);
    const copy = rowsFor(copyId);
    expect(copy.session.activeCharacterId).toBe(zara);
    expect(JSON.parse(copy.session.encounter_state as string).enemies[0].targetId).toBe(pip);
    expect(copy.inventory[0]).toMatchObject({ characterId: pip, boundToCharacterId: zara });
    expect(JSON.parse(copy.characters[0].buffs as string)[0].sourceCharacterId).toBe(zara);
    expect(copy.turns.map(turn => turn.characterId)).toEqual([pip, zara]);
    expect(copy.turns.map(turn => turn.ideas_character_id)).toEqual([pip, zara]);
    expect(JSON.parse(copy.turns[0].hpChanges as string)[0].characterId).toBe(pip);
    expect(JSON.parse(copy.turns[1].buffChanges as string)[0].characterId).toBe(zara);
    expect(copy.riddles[0].id).not.toBe(`${ADVENTURE}-riddle`);
    expect(copy.riddles[0].source_turn_id).toBe(copy.turns[0].id);
    // Image references are copied, not files.
    expect(copy.characters[0].avatar_storage_key).toBe(`avatars/${PIP}.png`);
    // The original is untouched.
    expect(rowsFor(ADVENTURE).session.activeCharacterId).toBe(ZARA);
  });

  it('imports a version 1 export, using defaults for what it lacks', () => {
    seed();
    const archive = adventureArchive.export({ adventureId: ADVENTURE });
    deleteAdventure(ADVENTURE);
    const { riddles: _riddles, image_policy: _policy, ...session } = archive.sessions[0];
    const old = { version: 1, exportedAt: archive.exportedAt, sessions: [session] };

    const report = adventureArchive.import(old);

    expect(report.defaulted).toContainEqual({ table: 'sessions', column: 'image_policy' });
    expect(rowsFor(ADVENTURE).riddles).toEqual([]);
  });

  it('rejects other versions, unknown fields (unless allowed), bad references and missing realms, writing nothing', () => {
    seed();
    const archive = adventureArchive.export({ adventureId: ADVENTURE });
    deleteAdventure(ADVENTURE);
    const withSession = (patch: Row): Archive => ({ ...archive, sessions: [{ ...archive.sessions[0], ...patch }] });

    expect(() => adventureArchive.import({ ...archive, version: 9 })).toThrow(ArchiveImportError);
    expect(() => adventureArchive.import(withSession({ mystery_column: 1 }))).toThrow(/sessions\.mystery_column/);
    expect(() => adventureArchive.import(withSession({ activeCharacterId: 'nobody' }))).toThrow(/names a hero that is not in the adventure/);
    expect(() => adventureArchive.import(withSession({ namespace_id: 'no-such-realm' }))).toThrow(/Namespace not found: no-such-realm/);
    expect(() => adventureArchive.import(archive, { targetRealm: 'no-such-realm' })).toThrow(/Namespace not found/);
    expect(rowsFor(ADVENTURE).session).toBeUndefined();

    const report = adventureArchive.import(withSession({ mystery_column: 1 }), { allowDrop: true });
    expect(report.dropped).toEqual([{ table: 'sessions', column: 'mystery_column' }]);
    expect(rowsFor(ADVENTURE).session).toBeDefined();
  });

  it('rolls back every adventure when one fails', () => {
    seed();
    seed('archive-other', 'archive-pip-2', 'archive-zara-2');
    const archive = adventureArchive.export();
    const ours = archive.sessions.filter(session => String(session.id).startsWith('archive-'));
    deleteAdventure(ADVENTURE);
    deleteAdventure('archive-other');
    // The second adventure's realm is gone: only found while writing.
    const broken: Archive = { ...archive, sessions: [ours[0], { ...ours[1], namespace_id: 'gone-realm' }] };

    expect(() => adventureArchive.import(broken)).toThrow(/gone-realm/);
    expect(rowsFor(String(ours[0].id)).session).toBeUndefined();
  });

  it('lists every id-like column of the archived tables in the reference inventory', () => {
    for (const [table, known] of Object.entries(REFERENCE_COLUMNS)) {
      const columns = (db().prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(column => column.name);
      const idLike = columns.filter(column => /(^id$|Id$|_id$)/.test(column));
      expect(idLike.filter(column => !(column in known)), table).toEqual([]);
    }
  });
});
