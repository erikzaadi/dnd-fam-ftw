# Glossary

Domain and architecture terms used in code, plans and reviews. Player-facing vocabulary (realm, adventure, chapter, hero) is defined in [CLAUDE.md](CLAUDE.md#coding-conventions).

## Realm access

Who belongs to a realm, who owns it, and which realm is a person's primary (sign-in default). Membership is the only source of access; the primary pointer only picks the default. Lives in `realmAccess` (`backend/src/realms/access.ts`), keyed by user id. The first member of an ownerless realm becomes its owner, the local realm never has one, and a valid owner is one who is still a member (`ownerOf`).

## Account workflows

Creating and deleting a person's account together with the realms that come and go with it (`services/accountService.ts`). The only code allowed to use the internal realm building blocks in `realms/composition.ts`.

## Turn resolution

Everything between "the action attempt is known" and "here is the new state and the turn result": choosing the strategy (resolved-first or parallel) and falling back, the free-action policies, applying the proposal through the game engine once, encounter name repair, aligning narration with a resolved encounter, stripping choices that target defeated enemies, and the consistency diagnostic. Lives in `resolveTurn` (`backend/src/services/turnResolution.ts`). The caller (`turnService`) prepares the context before it and handles riddles, persistence and broadcasting after it.

## Turn decision

What the turn pipeline decides about an action once, before generation: its intent, its target hero, and whether a failure may hurt the actor (`TurnDecision`, `decideTurn` in `freeActionPolicyService.ts`). The early HP preview and the policies after generation read the same decision.

## Paid-work admission

Whether a realm may start work that spends AI budget, decided once where the work enters: a website route, read-aloud, or an assistant tool. Lives in `admitPaidWork` (`backend/src/services/paidWorkAdmission.ts`), which runs each kind's entry checks (an ownerless realm, the daily text budget) and returns a structured refusal for the adapter to render. The adventure cap (`checkAdventureCap`) sits beside it. Not part of it: the provider backstop (looser thresholds, so work under way can finish), picture checks right before generation, the MCP per-grant counter, and the per-adventure turn cap.
