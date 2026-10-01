# Glossary

Domain and architecture terms used in code, plans and reviews. Player-facing vocabulary (realm, adventure, chapter, hero) is defined in [CLAUDE.md](CLAUDE.md#coding-conventions).

## Turn resolution

Everything between "the action attempt is known" and "here is the new state and the turn result": choosing the strategy (resolved-first or parallel) and falling back, the free-action policies, applying the proposal through the game engine once, encounter name repair, aligning narration with a resolved encounter, stripping choices that target defeated enemies, and the consistency diagnostic. Lives in `resolveTurn` (`backend/src/services/turnResolution.ts`). The caller (`turnService`) prepares the context before it and handles riddles, persistence and broadcasting after it.

## Turn decision

What the turn pipeline decides about an action once, before generation: its intent, its target hero, and whether a failure may hurt the actor (`TurnDecision`, `decideTurn` in `freeActionPolicyService.ts`). The early HP preview and the policies after generation read the same decision.
