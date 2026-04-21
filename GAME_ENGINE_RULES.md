# Game Engine Rules

This document describes the complete mechanical rules for the AI DM game engine. The AI is purely a narrator : all game state mutations are deterministic and happen in the backend before the AI ever sees the result.

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
roll (d20) + effective stat  ≥  difficulty target  →  success
```

### Base thresholds

| Difficulty | Base target |
|------------|-------------|
| easy | 8 |
| normal | 12 |
| hard | 16 |

### Dynamic difficulty targets (per-action)

Each choice can carry a `difficultyValue` : a specific numerical target the AI considers appropriate for that exact action in the current situation. This is sometimes called **DRAMA LLAMA** internally. If present, `difficultyValue` overrides the base threshold for that roll.

This allows the AI to say "picking this lock in the dark is a 14, not a standard 12" without changing the difficulty label. The acting character's exact target is shown in the die result popup as `>= N`.

The resolved `actionDifficultyTarget` is stored in turn history so it can be displayed in the history panel.

A natural 1 on the d20 is a **Critical Failure** (see damage below). There is no critical success mechanic : rolling high just means you succeed by more, which the AI may flavor but has no mechanical bonus.

### Roll narration

After resolving the roll, the AI returns a short `rollNarration` : a one-line flavour comment tied to the die result (e.g. *"🎲 A focused eye! You spot the mechanism."*). This is displayed inside the D20 result popup and stored in turn history. It is separate from the main narration paragraph.

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
- When a character reaches **0 HP** they become `downed` : they cannot act.
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
- If every character is downed, the active character pointer is not advanced (the party wipe checks take over : see below).

---

## Action Types

### `perform`

A narrative action chosen from the AI's three suggestions, or typed in by the player. Always involves a stat roll.

Flow:
1. Player submits action text + chosen stat + difficulty label.
2. Backend resolves the effective target: `difficultyValue` (per-choice AI override) if present, otherwise the base difficulty threshold.
3. Backend rolls `d20 + effective stat` vs. the resolved target.
4. Outcome (success/fail, roll, damage, resolved target) is sent to AI as structured input.
5. AI narrates what happened and provides three new choices, each with a suggested `difficultyValue`.
6. If failed, acting character takes damage; if 0 HP, marked as downed.
7. AI may suggest a new inventory item to grant via `suggestedInventoryAdd`; backend assigns it a random ID and adds it to the acting character's inventory.
8. AI may suggest removing an item via `suggestedInventoryRemove` (used for trades - see Trading below).

### `use_item`

Use a healing item from a character's inventory. This action **bypasses the stat roll** : it always succeeds mechanically.

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

### Trading

When a merchant, vendor, or trader appears in the story, the AI may include a trade action among the choices.

On a successful trade action:
- The AI returns both `suggestedInventoryAdd` (the new item received) and `suggestedInventoryRemove` (the item name traded away).
- Backend removes the named item from the acting character's inventory, then grants the new item.
- The AI must not suggest acquiring items the party already carries, including the item being granted in the same turn.

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

Items with `statBonuses` provide a **passive** benefit : they are always active while in the character's inventory, no action required. There is no equip/unequip mechanic.

---

## Party Wipe & Recovery

### Intervention (once per session)

When **all party members are downed at the end of a turn**, the backend checks `interventionState.used`.

If the intervention has **not** been used:
1. All downed characters are restored to `1 HP` and set `active`.
2. `interventionState.used` is set to `true` (permanent for this session).
3. The AI is called with a special `[INTERVENTION]` prefix, instructed to narrate a dramatic magical rescue (dragon, time rewind, divine blessing, absurd coincidence).
4. The rescue narration is added to the story summary async.
5. An `intervention` SSE event is broadcast to all clients : the frontend shows an amber 🐉 banner.

### Sanctuary Recovery (second wipe)

If the party wipes again and the intervention has **already** been used:
1. All downed characters are restored to `1 HP` and set `active`.
2. `interventionState.used` stays `true` (not reset : there is no third rescue).
3. The AI is called with a special `[SANCTUARY]` prefix, instructed to narrate the party waking up somewhere safe and quiet.
4. An `sanctuary_recovery` SSE event is broadcast : the frontend shows a grey 🏕️ banner.

The game never permanently halts. There is always a path forward.

---

## Rolling Story Summary

To keep AI context lean across long sessions, the backend maintains a compressed `storySummary`.

- `StorySummaryService.shouldUpdate(turn)` returns `true` when `turn > 1 && turn % 5 === 0` : i.e. every 5 turns starting at turn 5.
- When triggered, the AI is called asynchronously (fire-and-forget) to produce a 2–4 sentence TLDR of everything that has happened.
- The summary is saved to the database and included in subsequent AI narration calls.
- After an intervention or sanctuary recovery, the rescue narration is appended to the summary immediately, so the AI always knows about miraculous saves.
- `recentHistory` (the last 3 turn narrations) is passed alongside the summary : the summary provides long-range continuity, recent history provides short-range context.

---

## AI Role & Constraints

The AI is a narrator, not an authority. It:

- **Can**: narrate outcomes, suggest choices, propose new items to grant, describe scenes, generate image prompts, return a roll flavour comment (`rollNarration`), and declare the current tension level (`currentTensionLevel`).
- **Cannot**: change HP, move items, change who is downed, set difficulty, alter turn order.

All of the above are backend-owned. The AI receives a snapshot of the current state (including outcomes already resolved by the backend) and returns structured JSON. The backend validates and applies only the fields it trusts.

AI-suggested inventory items are granted only if the narrative earns it (found in a chest, rewarded, looted). The backend assigns the `id`; the AI should never invent IDs.

### Character context

The AI receives two distinct character references per turn:

- `actingCharacterName` : the character who performed the action that produced this turn (the one whose roll just resolved).
- `nextCharacterName` : the character who will act next (the current `activeCharacterId` after turn rotation).

This separation ensures the AI can accurately narrate what *just happened* to the acting character while addressing the next player's upcoming choices correctly.

---

## Downed Character UI Rules

- Downed characters are shown **greyscale + skull overlay** in the party bar.
- If the **active character** is downed (e.g. they were downed on their own turn by a critical fail), the action controls are replaced with a downed panel : no actions can be submitted until the turn advances.
- The backend also enforces this: a `perform` action from a `downed` character returns HTTP 400.
- Downed characters can still be selected as **targets** for `use_item` (healing/revive).

---

## Game Mode

Game mode is set at world creation alongside difficulty. It controls the **pacing and narrative style** the AI DM uses throughout the session.

| Mode | Pacing |
|------|--------|
| **Fast** | Narration under 3 sentences. Immediate action, frequent conflict, skip slow descriptions. Tension escalates quickly. Prioritises combat, traps, and danger. |
| **Balanced** | Mix of exploration and action. Moderate pacing. Tension escalates at a natural rate. |
| **Cinematic** | Rich descriptions, character moments, slower pacing. Tension builds deliberately. |

Game mode is passed to the AI on every narration call. It does not change the dice math : it shapes tone and what kind of choices the AI tends to suggest.

### Tension level

Each turn the AI returns a `currentTensionLevel` of `low`, `medium`, or `high`. The frontend uses this to switch the background music:

- `low` or `medium` : ambient music
- `high` : danger/battle music

The AI is expected to escalate tension more aggressively in **fast** mode and more gradually in **cinematic** mode. The `currentTensionLevel` is the AI's opinion about the current narrative stakes, not a mechanical modifier.

---

## Difficulty Settings

Difficulty is set at world creation and affects AI tone and the default `difficultyValue` suggestions the AI proposes per choice. The base thresholds (8 / 12 / 16) are fixed, but the AI can tune each action's specific target within the spirit of the chosen difficulty.

---

## Image Generation

Scene images and character avatars are generated asynchronously and are optional.

### Global vs. per-session toggle

- **Global setting** (`imagesEnabled` in app settings): the default. New sessions inherit this as their initial `savingsMode` state (`savingsMode = !imagesEnabled`).
- **Per-session toggle** (`savingsMode` on the session): set via the 🖼/🪙 toggle in the recap screen or the assemble heroes screen. When explicitly set, it overrides the global setting for that session.

This means: turning images on in a session works even if the global setting has images disabled, and vice versa.

When `savingsMode` is `true`, no scene images or new character avatars are generated; existing cached images remain visible.

---

## Character History

Characters have an optional `history` field: a one-sentence AI-generated summary of their past adventures.

It is populated automatically when a character is **imported** from a previous session in the Character Assembly screen. The summary is generated from the character's turn history in that session (what they did, what happened to them).

The `history` field is passed to the AI DM as context alongside the character's `quirk`. This lets the DM acknowledge a returning hero's past deeds: *"Thorin, who once accidentally set a tavern on fire trying to impress a bard..."*

Characters created fresh (not imported) have no `history`.

---

*For feature requests or bug reports: [github.com/erikzaadi/dnd-fam-ftw](https://github.com/erikzaadi/dnd-fam-ftw/issues)*
