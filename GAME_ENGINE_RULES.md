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

The backend also assigns an `impact` to rolled actions:

| Impact | Meaning |
| --- | --- |
| `normal` | Ordinary success or failure. |
| `strong` | The result beat or missed the target by a wide margin. The story should add a meaningful extra advantage or consequence. |
| `extreme` | Natural 1, natural 20, or a massive margin. The story should make the result memorable and drastic without breaking game state. |

Natural 1 and natural 20 are derived from the raw d20 `roll`; no separate critical flag is required for new results.

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

A natural 1 on the d20 is a **Critical Failure** and always fails, even if stat and item bonuses would otherwise meet the target (see damage below).

A natural 20 on the d20 is a **Critical Success** and always succeeds, even if the total would otherwise miss the difficulty target. The backend marks this result as `impact: "extreme"`.

### DRAMA LLAMA roll flavor

The AI receives the resolved roll and must flavor unusually low and high rolls accordingly:

| Natural roll | Narrative treatment |
|--------------|---------------------|
| 1 | Catastrophic critical failure : memorable disaster beyond ordinary failure |
| 2 | Extra dramatic disaster : vivid complication or close call |
| 18-19 | Extra dramatic triumph : succeeds with flair and glory |
| 20 | EXTREME legendary triumph : spectacular, decisive, unforgettable critical success |

These narrative tiers affect the story, `rollNarration`, and the resolved `impact`; only natural 1 and natural 20 have deterministic backend mechanics.

### Fail forward

Failed rolls should still move the story. The AI should avoid "nothing happens" outcomes and instead narrate a consequence such as lost time, a worse position, attention drawn, a new obstacle, a clue with a complication, minor damage, or a stolen/lost item.

Essential campaign progress should not be locked behind one failed roll. If the party misses a clue, the AI should reveal a different clue or reveal the original clue at a cost.

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

**Impact damage bonus:** If a failed roll has `impact: "strong"`, add +1 damage on top of the difficulty damage. If it has `impact: "extreme"` (including natural 1), add +2 damage.

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

### Rest and recovery

Rest is represented as normal `perform` actions or special party-wipe recovery events, not as a separate action type.

When a rest, meal, sleep, healer visit, sanctuary, or camp scene narratively restores the party:
- The AI returns `suggestedHeal` for active characters who recover HP.
- The AI returns `suggestedRevive` if a downed character wakes or returns to action.
- The AI may add a gentle complication, such as a clue, a dream, an NPC visit, tracks outside camp, or a missing non-essential item.
- If the narration says an item was stolen, lost, sacrificed, broken beyond use, or taken by an NPC, the AI must return `suggestedInventoryRemove`.

Quest-critical or non-transferable items should not be removed as random rest complications.

---

## Item Properties

| Field | Type | Meaning |
|-------|------|---------|
| `id` | string | Unique ID assigned by backend (random) |
| `name` | string | Display name |
| `description` | string | Flavor text |
| `statBonuses` | `{ might?, magic?, mischief? }` | Passive stat bonuses while in inventory |
| `healValue` | number | HP restored when used (0 = no healing) |
| `consumable` | boolean | Removed from inventory after use. Default: `false`. Set `true` only for single-use items (potions, scrolls, food). |
| `transferable` | boolean | Can be given to another character. Default: `true`. Set `false` only for quest items or soul-bound gear. |

Items with `statBonuses` provide a **passive** benefit : they are always active while in the character's inventory, no action required. There is no equip/unequip mechanic.

---

## Party Wipe & Recovery

### Rescue limits by difficulty

When **all party members are downed at the end of a turn**, the backend checks `interventionState.rescuesUsed` against the difficulty's rescue limit:

| Difficulty | Rescue limit |
|------------|-------------|
| easy | unlimited |
| normal | 2 |
| hard | 1 |
| zug-ma-geddon | 0 (game over immediately) |

### Intervention (first wipe, `rescuesUsed === 0`)

1. All downed characters are restored to `1 HP` and set `active`.
2. `interventionState.rescuesUsed` is incremented to 1.
3. The AI is called with a special `[INTERVENTION]` prefix, instructed to narrate a dramatic magical rescue (dragon, time rewind, divine blessing, absurd coincidence).
4. The rescue narration is added to the story summary async.
5. An `intervention` SSE event is broadcast to all clients : the frontend shows an amber banner.

### Sanctuary Recovery (subsequent wipes within limit)

If the party wipes again and `rescuesUsed` is still below the difficulty limit:
1. All downed characters are restored to `1 HP` and set `active`.
2. `interventionState.rescuesUsed` is incremented.
3. The AI is called with a special `[SANCTUARY]` prefix, instructed to narrate the party waking up somewhere safe and quiet.
4. A `sanctuary_recovery` SSE event is broadcast : the frontend shows a grey banner.

### Game Over (wipe with no rescues remaining)

If `rescuesUsed >= rescueLimit` when the party wipes:
1. `gameOver: true` is written to the session state.
2. A `game_over` SSE event is broadcast : the frontend shows the campaign-over screen.
3. No further actions can be taken in the session.

On **zug-ma-geddon** the rescue limit is 0, so the very first wipe triggers game over with no intervention.

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

AI-suggested inventory items are granted by the backend when the narrative earns it. The backend assigns the `id`; the AI should never invent IDs.

**Combat loot**: Combat victories may produce loot thematically tied to the defeated enemy. Loot always goes to `actingCharacterName` (the character who struck the finishing blow) - `targetCharacterName` is omitted on combat loot grants. Drop frequency depends on difficulty:

| Difficulty | Combat loot expectation |
|------------|-------------------------|
| easy | Always drop useful loot. |
| normal | Usually drop loot; trivial mobs can drop nothing. |
| hard | Only notable enemies, named foes, bosses, or story-weight threats drop loot. |
| zug-ma-geddon | Rare drops only; common kills yield nothing. |

**Morale and surrender**: Enemies can flee, bargain, surrender, reveal clues, or hand over loot instead of fighting to the last breath. Surrender and retreat can still yield rewards. If the party receives an item, key, badge, map, coin purse, clue-object, weapon, or reward through surrender, the AI must return `suggestedInventoryAdd`.

**Cute conditions**: The AI may use short-lived narrative conditions such as Brave, Scared, Slowed, Hidden, Sparkling with Magic, Covered in Goo, Dizzy, Inspired, or Jinxed. These are flavor only unless expressed through existing mechanical fields like HP, inventory, choices, `difficultyValue`, `suggestedDamage`, `suggestedHeal`, or `suggestedRevive`.

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

Game mode is set at realm creation alongside difficulty. It controls the **pacing and narrative style** the AI DM uses throughout the session.

| Mode | Pacing |
|------|--------|
| **Fast** | Narration under 3 sentences. Immediate action, frequent conflict, skip slow descriptions. Tension escalates quickly. Prioritises combat, traps, and danger. After a combat victory (when no DM Prep is set), a brief NPC may appear in the narration and offer or activate a portal/shortcut toward the next challenge. Portal choices are valid only on turns where that NPC explicitly appears in the narration. |
| **Balanced** | Mix of exploration and action. Moderate pacing. Tension escalates at a natural rate. |
| **Cinematic** | Rich descriptions, character moments, slower pacing. Tension builds deliberately. |
| **ZUG-MA-GEDDON** | Straight to battle. Every turn is chaos. Maximum tension always. The AI is instructed to generate non-stop combat encounters and escalate without mercy. Not for the faint of heart. |

Game mode is passed to the AI on every narration call. It does not change the dice math : it shapes tone and what kind of choices the AI tends to suggest.

### Tension level

Each turn the AI returns a `currentTensionLevel` of `low`, `medium`, or `high`. The frontend uses this to switch the background music:

- `low` or `medium` : ambient music
- `high` : danger/battle music

The AI is expected to escalate tension more aggressively in **fast** mode and more gradually in **cinematic** mode. The `currentTensionLevel` is the AI's opinion about the current narrative stakes, not a mechanical modifier.

---

## Difficulty Settings

Difficulty is set at realm creation and affects AI tone and the default `difficultyValue` suggestions the AI proposes per choice. The base thresholds (8 / 12 / 16) are fixed, but the AI can tune each action's specific target within the spirit of the chosen difficulty.

---

## DM Prep

An optional free-text field set at realm creation (or edited later via the home screen).

When provided, the DM Prep is included in every narration call as campaign context. The AI is instructed to:

- Honour the lore, factions, villains, and locations described in the prep.
- Weave them naturally into the story rather than forcing them in all at once.
- Reference the DM Prep alongside the rolling story summary and recent history.

DM Prep is the DM's creative brief. It does not change dice mechanics, turn structure, or any other rules. It is purely a narrative guide.

---

## Image Generation

Scene images, realm preview images, and character avatars are generated asynchronously and are optional.

### Global vs. per-session toggle

- **Global setting** (`imagesEnabled` in app settings): the default. New sessions inherit this as their initial `savingsMode` state (`savingsMode = !imagesEnabled`).
- **Per-session toggle** (`savingsMode` on the session): set via the 🖼/🪙 toggle in the recap screen or the assemble heroes screen. When explicitly set, it overrides the global setting for that session.

This means: turning images on in a session works even if the global setting has images disabled, and vice versa.

When `savingsMode` is `true`, no scene images, realm preview images, or new character avatars are generated; existing cached images remain visible.

Realm preview images are generated on realm creation and regenerated when editable realm details or party composition change. When DM Prep is created or explicitly saved, the backend first stores a short visual-only brief for image prompting (bosses, NPCs, artifacts, locations, factions, motifs) and preview generation reuses that brief instead of raw long-form prep. The home screen and recap screen use the saved preview image as a visual anchor, and movie recap uses it as the fallback when a turn has no scene image.

---

## Character History

Characters have an optional `history` field: a one-sentence AI-generated summary of their past adventures.

It is populated automatically when a character is **imported** from a previous session in the Character Assembly screen. The summary is generated from the character's turn history in that session (what they did, what happened to them).

The `history` field is passed to the AI DM as context alongside the character's `quirk`. This lets the DM acknowledge a returning hero's past deeds: *"Thorin, who once accidentally set a tavern on fire trying to impress a bard..."*

Characters created fresh (not imported) have no `history`.

---

*For feature requests or bug reports: [github.com/erikzaadi/dnd-fam-ftw](https://github.com/erikzaadi/dnd-fam-ftw/issues)*
