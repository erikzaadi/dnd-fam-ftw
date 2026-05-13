# DM Prep Guide

DM Prep is an optional free-text field that acts as a creative brief for the AI Dungeon Master. It is set at realm creation and can be edited later from the home screen. When provided, the AI reads it on every narration call and weaves it into the story gradually rather than dumping everything at once.

This document is for players who want to handcraft a campaign instead of accepting the auto-generated brief.

---

## How it works

When a realm is created with a world description, or when DM Prep is explicitly saved, the backend runs the text through a processing step that:

1. Condenses the prose into a structured campaign brief (stored back as `dmPrep`).
2. Extracts a machine-readable `ENCOUNTER_SEEDS` JSON block from the brief (stored as `dmPrepEncounters`).
3. Generates a short visual-only summary for realm preview image generation.

If you write DM Prep by hand (or edit it after the fact), the same processing runs when you save. You can also regenerate it from scratch via the realm edit screen.

---

## Campaign brief format

The AI generates and reads the brief in this section order. You can write directly in this format to get precise control:

```
PREMISE: The core quest, what is at stake, and why the party matters (1-2 sentences).

TONE: Family-friendly tone guidance - wonder level, danger feel, humor style, one thing to avoid.

VILLAIN: Name + motivation + a sympathetic detail + one recurring tell or behaviour.

RECURRING NPCS: 2 NPCs with names, roles, quirks, and whether they help or complicate things.

FACTIONS: 2 groups with simple goals - one potential ally and one source of trouble.

LOCATIONS: 3 key locations. Each gets a one-line description, an obstacle, and a notable NPC or clue.

SETUP/PAYOFF: 2 quest objects, clues, passwords, or tokens the party finds early and uses later.
              Name where each is found and what later challenge it unlocks.

SECRETS: 3 hidden truths or reveals to surface over time.

ENCOUNTERS: One combat, one exploration challenge, one social challenge, one magical/weird challenge.

TREASURE: 2-3 thematic items or rewards tied to the world.

STAGES: Early - | Mid - | Climax -

DM NOTE: One pacing rule and one fail-forward rule for this campaign.
```

Everything in the prose sections is narrative guidance - it shapes what the AI says and invents, but does not override dice, HP, or any backend mechanic.

### What the AI does with each section

- **PREMISE / VILLAIN / SECRETS** - Surface gradually via clues, dreams, NPC dialogue, and environmental hints. Secrets are not revealed all at once.
- **RECURRING NPCS** - Named NPCs must appear in narration itself (speaking, reacting, looming) - not just as choice options.
- **SETUP/PAYOFF** - When the party reaches the location described, the AI grants the quest object as a real inventory item. When the matching challenge appears later, one of the three choices explicitly uses that carried item and is easier or safer than brute force.
- **RIDDLES** - Mention riddles, puzzles, or answer-based obstacles and the AI will occasionally introduce riddle scenes with structured answer choices.
- **TONE / DM NOTE** - Inform pacing and narrative register throughout the session.

---

## Encounter seeds

The most mechanically significant part of DM Prep is the encounter seed block. Seeds let you define specific enemies, their stats, and the conditions that trigger them. The backend hydrates HP and IDs from the seed - the AI only needs to name the encounter.

### Format

Append this block at the end of your DM Prep (after all prose sections):

```
ENCOUNTER_SEEDS:
[
  {
    "name": "Thornwood Guardian",
    "triggerHint": "when the party enters the Thornwood or disturbs the root network",
    "enemies": [
      {
        "name": "Elder Thornwalker",
        "role": "boss",
        "weaknesses": [
          { "label": "thornwood sap", "school": "nature" }
        ],
        "traits": ["rooted in place", "regenerates in shadow"]
      },
      {
        "name": "Root Tendril",
        "role": "minion",
        "weaknesses": [
          { "label": "open flame", "school": "fire" }
        ],
        "traits": ["brittle when dry"]
      }
    ],
    "areas": [
      { "label": "Collapsed Root Bridge", "tags": ["unstable", "traversal"] },
      { "label": "Moonlit Clearing", "tags": ["open", "bright"] }
    ],
    "objective": "Drive back the guardian before the roots seal the only path forward",
    "lootHint": "Bark of Eternal Night - a gnarled shield fragment that hums in darkness"
  }
]
```

The JSON block must be a valid JSON array. Omit null values instead of writing `null`. Up to 4 seeds are parsed; extras are ignored.

### Enemy roles and HP

HP is determined by role. The AI cannot override this.

| Role | HP range | Notes |
|------|----------|-------|
| `minion` | 1-3 | Disposable. Falls to a single strong hit. |
| `standard` | 4-8 | An ordinary named foe. |
| `elite` | 9-14 | Tougher than standard. Boss fight sub-threat. |
| `boss` | 15-24 | Climax-level threat. Multiple rounds expected. |
| `hazard` | 0-6 | Environmental threat. Not directly fought - affects areas, imposes conditions. |

The backend uses the midpoint of each range and clamps to the band. You cannot set exact HP; use role to control encounter weight.

### Weaknesses

Each weakness has a `label` (player-facing flavor text) and an optional `school` (the constrained mechanic category).

**label** - freeform, shown to players when revealed. Should feel thematic, not mechanical. Examples: `mirror flash`, `old oath`, `cracked moonstone`, `rusted hinge`, `thornwood sap`, `the name of its true master`.

**school** - controls which magic type exploits the weakness. Valid values:

| School | Meaning |
|--------|---------|
| `fire` | Heat, burning, combustion |
| `frost` | Cold, ice, freezing |
| `light` | Radiance, holy light, illumination |
| `shadow` | Darkness, void, necrotic |
| `nature` | Plants, animals, growth, decay |
| `storm` | Lightning, thunder, wind |
| `mind` | Psychic, charm, illusion, fear |
| `force` | Pure kinetic impact, telekinesis |
| `holy` | Divine blessing, sacred power |
| `mechanical` | Clockwork, constructs, traps |

Omit `school` for a purely narrative weakness with no backend modifier (e.g. a riddle-answer or a specific item).

Weaknesses start unrevealed. They appear in the encounter panel with a `?` until the AI or a player action reveals them through narration.

### Traits

A list of short flavor strings. No mechanical effect - they guide what the AI narrates and what choices it offers. Examples: `immune to fear`, `splits when cut`, `only moves in darkness`, `mimics party voices`.

### Areas

Areas are terrain features visible in the encounter panel. Each has a `label` and optional `tags`.

Tags are freeform strings that inform the AI what environment choices to suggest. Useful tag patterns: `unstable`, `traversal`, `bright`, `dark`, `water`, `elevated`, `cramped`, `open`, `magical`, `hazardous`.

### Objective

Optional. A short string shown in the encounter panel and passed to the AI. Use it to define a non-kill win condition: `escape before the tower collapses`, `protect the merchant until dawn`, `destroy the three seals`. When absent, defeating all enemies ends the encounter.

### lootHint

Optional. A thematic item description tied to this encounter. The AI uses it to flavor loot grants after the encounter resolves. It does not guarantee a drop - the actual drop frequency still follows difficulty rules.

---

## How seeds trigger

The AI is instructed to start a seed encounter when the current scene, action result, or story momentum matches the seed's `triggerHint`. The backend also runs a separate inferred check against narration text - if the narration contains words from the trigger hint, it will auto-start the encounter even if the AI did not explicitly propose it.

When an encounter starts from a seed:
1. The backend matches the encounter name against stored seeds.
2. HP and IDs are hydrated from the seed - the AI proposal is used only for extra detail merging.
3. Past encounters are tracked. A seed name that already appears in `pastEncounters` will not trigger again.

This means each named encounter fires exactly once per session. If you want a recurring enemy type, give each occurrence a distinct name (`Goblin Patrol - Forest Gate`, `Goblin Patrol - Ruined Bridge`).

---

## What DM Prep does not control

- **Dice math** - base thresholds (8/12/16) and roll resolution are fixed.
- **HP values** - set by enemy role, not by prep text.
- **Turn order** - always round-robin through the party.
- **Difficulty** - set at realm creation, not in prep.
- **Rescue limits** - set by difficulty.
- **Image composition** - the image brief is auto-extracted; the inline text is not passed to image generation directly.

---

## Tips for a tighter campaign

- **Name your villain early and repeat them.** The AI will use that name in narration and choices if it appears in the VILLAIN section.
- **Setup/Payoff items must be specific.** Vague quest objects like "a clue" are ignored. Write "the Warden's Iron Key, found in the guard tower, unlocks the vault in the final stage."
- **Keep encounter seeds to 3-4 max.** More seeds increase the chance of trigger collisions and thin the AI's attention on each one.
- **Use `triggerHint` as a scene keyword, not a player instruction.** Write `when the party reaches the obsidian bridge` not `after two combat encounters`.
- **Hazard enemies pair well with area tags.** A `hazard` enemy named "Lava Crack" with areas tagged `unstable` and `hot` gives the AI rich environment choices without requiring a killable target.
- **Traits beat long descriptions.** `blindsight, ignores invisibility` is more useful than a paragraph of lore the AI may not faithfully reproduce.
