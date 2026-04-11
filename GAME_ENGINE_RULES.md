# Game Engine Rules

This document describes the complete mechanical rules for the AI DM game engine. The AI is purely a narrator — all game state mutations are deterministic and happen in the backend before the AI ever sees the result.

---

## Stats

Every hero has three stats. Stats range from 1 (bad) to 5 (exceptional), set at character creation.

| Stat | Used for |
|------|----------|
| **Might** | Physical attacks, feats of strength, breaking things |
| **Magic** | Spells, arcane effects, healing abilities |
| **Mischief** | Stealth, deception, trickery, persuasion |

### Stat bonuses from inventory

Items can carry `statBonuses` (e.g. `{ might: +1 }`). These stack onto the stat value during roll resolution. The AI caps new item bonuses at +3 per stat. A character's effective stat for a roll is:

```
effective stat = base stat + sum of all inventory statBonuses for that stat
```

---

## Rolling

When a `perform` action is taken, the backend rolls:

```
roll (d20) + effective stat  ≥  difficulty threshold  →  success
```

| Difficulty | Threshold |
|------------|-----------|
| easy | 8 |
| normal | 12 |
| hard | 16 |

A natural 1 on the d20 is a **Critical Failure** (see damage below). There is no critical success mechanic — rolling high just means you succeed by more, which the AI may flavor but has no mechanical bonus.

---

## Damage

Damage only applies on a **failed** `perform` roll (not on `use_item` or `give_item`).

| Difficulty | Damage on failure |
|------------|-------------------|
| easy | 1 HP |
| normal | 2 HP |
| hard | 3 HP |

**Critical Failure bonus:** If the d20 roll is a natural 1, add +1 damage on top of the difficulty damage.

Damage is dealt to the **acting character** (the one whose turn it is). HP cannot drop below 0.

---

## HP & Downed State

- Each hero has a **current HP** and a **max HP** set at character creation.
- When a character reaches **0 HP** they become `downed` — they cannot act.
- A downed character's **turn is skipped** in the rotation.
- A downed character can still be targeted by healing items.
- A character is revived (status → `active`) when their HP is raised above 0 by a healing item.

### Backward compatibility

Sessions created before the downed system was introduced are safe: any character with `hp === 0` loaded from the database is automatically treated as `downed` at read time.

---

## Turn Rotation

Turns rotate **round-robin** through the party in order of party index.

- After each turn, the next `active` character becomes the acting character.
- Downed characters are **skipped** in the rotation.
- If every character is downed, the active character pointer is not advanced (the party wipe checks take over — see below).

---

## Action Types

### `perform`

A narrative action chosen from the AI's three suggestions, or typed in by the player. Always involves a stat roll.

Flow:
1. Player submits action text + chosen stat + difficulty label.
2. Backend rolls `d20 + effective stat` vs. difficulty threshold.
3. Outcome (success/fail, roll, damage) is sent to AI as structured input.
4. AI narrates what happened and provides three new choices.
5. If failed, acting character takes damage; if 0 HP, marked as downed.
6. AI may suggest a new inventory item to grant; backend assigns it a random ID and adds it to the acting character's inventory.

### `use_item`

Use a healing item from a character's inventory. This action **bypasses the stat roll** — it always succeeds mechanically.

Rules:
- The acting character must own the item.
- The target can be any party member (including the acting character).
- Heal is applied: `target.hp = min(max_hp, target.hp + item.healValue)`.
- If the target was downed and HP rises above 0, their status becomes `active`.
- If the item is `consumable: true`, it is removed from inventory after use.
- A non-consumable item can be used repeatedly.
- AI narrates the use as a normal turn action (the action text describes what happened).

### `give_item`

Transfer a transferable item to another party member. Also bypasses the stat roll.

Rules:
- The acting character must own the item.
- The item must have `transferable: true`.
- The item is moved from the giver's inventory to the receiver's inventory.
- The item retains all its properties (`statBonuses`, `healValue`, etc.).
- AI narrates the transfer.

---

## Item Properties

| Field | Type | Meaning |
|-------|------|---------|
| `id` | string | Unique ID assigned by backend (random) |
| `name` | string | Display name |
| `description` | string | Flavor text |
| `statBonuses` | `{ might?, magic?, mischief? }` | Passive stat bonuses while in inventory |
| `healValue` | number | HP restored when used (0 = no healing) |
| `consumable` | boolean | Removed from inventory after use |
| `transferable` | boolean | Can be given to another character |

Items with `statBonuses` provide a **passive** benefit — they are always active while in the character's inventory, no action required. There is no equip/unequip mechanic.

---

## Party Wipe & Recovery

### Intervention (once per session)

When **all party members are downed at the end of a turn**, the backend checks `interventionState.used`.

If the intervention has **not** been used:
1. All downed characters are restored to `1 HP` and set `active`.
2. `interventionState.used` is set to `true` (permanent for this session).
3. The AI is called with a special `[INTERVENTION]` prefix, instructed to narrate a dramatic magical rescue (dragon, time rewind, divine blessing, absurd coincidence).
4. The rescue narration is added to the story summary async.
5. An `intervention` SSE event is broadcast to all clients — the frontend shows an amber 🐉 banner.

### Sanctuary Recovery (second wipe)

If the party wipes again and the intervention has **already** been used:
1. All downed characters are restored to `1 HP` and set `active`.
2. `interventionState.used` stays `true` (not reset — there is no third rescue).
3. The AI is called with a special `[SANCTUARY]` prefix, instructed to narrate the party waking up somewhere safe and quiet.
4. An `sanctuary_recovery` SSE event is broadcast — the frontend shows a grey 🏕️ banner.

The game never permanently halts. There is always a path forward.

---

## Rolling Story Summary

To keep AI context lean across long sessions, the backend maintains a compressed `storySummary`.

- `StorySummaryService.shouldUpdate(turn)` returns `true` when `turn > 1 && turn % 5 === 0` — i.e. every 5 turns starting at turn 5.
- When triggered, the AI is called asynchronously (fire-and-forget) to produce a 2–4 sentence TLDR of everything that has happened.
- The summary is saved to the database and included in subsequent AI narration calls.
- After an intervention or sanctuary recovery, the rescue narration is appended to the summary immediately, so the AI always knows about miraculous saves.
- `recentHistory` (the last 3 turn narrations) is passed alongside the summary — the summary provides long-range continuity, recent history provides short-range context.

---

## AI Role & Constraints

The AI is a narrator, not an authority. It:

- **Can**: narrate outcomes, suggest choices, propose new items to grant, describe scenes, generate image prompts.
- **Cannot**: change HP, move items, change who is downed, set difficulty, alter turn order.

All of the above are backend-owned. The AI receives a snapshot of the current state (including outcomes already resolved by the backend) and returns structured JSON. The backend validates and applies only the fields it trusts.

AI-suggested inventory items are granted only if the narrative earns it (found in a chest, rewarded, looted). The backend assigns the `id`; the AI should never invent IDs.

---

## Downed Character UI Rules

- Downed characters are shown **greyscale + skull overlay** in the party bar.
- If the **active character** is downed (e.g. they were downed on their own turn by a critical fail), the action controls are replaced with a downed panel — no actions can be submitted until the turn advances.
- The backend also enforces this: a `perform` action from a `downed` character returns HTTP 400.
- Downed characters can still be selected as **targets** for `use_item` (healing/revive).

---

## Difficulty Settings

Difficulty is set at world creation and affects enemy behavior via AI tone — it does not change the roll thresholds. The thresholds (8 / 12 / 16) are fixed. Difficulty label is passed to the AI as context so it can set appropriately hard or forgiving choices.

---

*For feature requests or bug reports: [github.com/erikzaadi/dnd-fam-ftw](https://github.com/erikzaadi/dnd-fam-ftw/issues)*
