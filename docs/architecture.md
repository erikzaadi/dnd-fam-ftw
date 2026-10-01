# Architecture

A short map of how the app fits together. Details live in [MULTI_AGENT_WORKFLOW.md](../MULTI_AGENT_WORKFLOW.md) (how a turn is generated) and [GAME_ENGINE_RULES.md](../GAME_ENGINE_RULES.md) (mechanics and persistence rules).

## Tech stack

| Layer | Tech |
|---|---|
| Frontend | React 19 + Vite + Tailwind CSS 4 + TypeScript |
| Backend | Node.js 24 + Express 5 + TypeScript |
| Shared | `packages/shared`: API types and constants used by both sides |
| Database | SQLite via `libsql`, migrated on startup |
| AI | Any OpenAI-compatible API through the OpenAI SDK (narration, helpers, images, TTS) |
| Real-time | Server-Sent Events |

## Principles

- **The backend owns the game.** The AI only returns structured JSON proposals; dice, HP, items, turn order and encounters are decided and validated by the backend (`gameEngine.ts` and the turn services).
- **One source of truth per adventure.** Every gameplay write is an operation with an idempotency key and revision check, committed atomically; views reconcile from a snapshot on every SSE (re)connect.
- **Realms isolate data.** Every adventure (a `session` in code) belongs to a realm (a `namespace` in code); all queries are scoped to the signed-in realm.

## Code map

| Path | Role |
|---|---|
| `backend/src/index.ts`, `backend/src/routes/` | Express app and routes |
| `backend/src/services/turnService.ts`, `turnResolution.ts`, `turnFinalizer.ts` | Player turns from request to commit |
| `backend/src/services/dmTurnOrchestrator.ts` | AI agents per turn, and ideas |
| `backend/src/services/gameEngine.ts` | Dice, damage, items, rotation, party wipes |
| `backend/src/persistence/`, `backend/src/repositories/` | SQLite: startup and migrations, then all SQL ([repository rules](../backend/src/repositories/README.md)) |
| `backend/src/services/imageService.ts`, `backend/src/providers/` | Image prompts and storage, AI provider clients |
| `backend/src/realtime/` | SSE broadcasting |
| `backend/src/mcp/`, `backend/src/oauth/` | AI assistant endpoint and its OAuth server ([docs/mcp](mcp/SETUP.md)) |
| `backend/src/scripts/cli.ts` | Management CLI ([MANAGE.md](../MANAGE.md)) |
| `frontend/src/` | React app ([frontend/README.md](../frontend/README.md)) |
| `terraform/`, `scripts/` | Infrastructure and deploy scripts ([operations.md](operations.md)) |

## How a turn works

```
Player types an action (or picks one of the ideas they asked for)
       |
Action preview: the game suggests the stat and target, flags gear and questions
       |
Typed actions send after a short Undo window; others wait for a confirm
       |
Backend rolls d20 + stat vs target (item actions and riddle answers skip the roll)
       |
Mechanics agents propose damage, items, healing, fights (only when relevant);
backend validates and applies them, then commits the turn
       |
Narration agent writes the already-resolved outcome, streamed to every view
       |
SSE turn_complete -> all views update; scene image generated in the background
```

This is the default `resolved_first` strategy. The opt-out `parallel` strategy, still used for opening, rescue and chapter-start turns, runs narration beside the mechanics agents. Both are described in [MULTI_AGENT_WORKFLOW.md](../MULTI_AGENT_WORKFLOW.md); in code, both sit behind `resolveTurn` (`backend/src/services/turnResolution.ts`).

Submitting the action is the turn command (`submitTurnCommand`, `backend/src/services/turnCommand.ts`), shared by the website (`POST /session/:id/action`) and assistants (`confirm_action`). A known request id replays its original operation first, before anything else runs. New work is then prepared by the caller (assistants: the stored preview and the revision), validated, held for the assistant Undo window if asked, admitted (paid-work admission), and accepted atomically (one operation at a time, expected revision checked). Only a newly accepted operation starts the background run (`runAcceptedTurnAction`); the request returns without waiting for narration.

## Ideas and Ask the DM

Turns never pre-generate suggested choices, in either turn pipeline (or the opening, rescue, and chapter-start turns): no choices agent, retry, rerun, or deterministic fallback runs per turn, and narration ends with an open question to the next hero. Players type what they try, or press **Give me ideas**, which calls `POST /session/:id/ideas` (same choices path, run on request, shared by every viewer, never advancing the story; 6 generations per session per minute).

Per adventure, the ⚙ menu setting **Ideas every turn** (`sessions.auto_ideas`) makes open views ask for ideas once after each turn; turns themselves stay fast. Turns saved before ideas moved on demand still show their stored choices.

**Ask the DM** (`POST /session/:id/ask`, Session button, terminal `ask dm ...`, car "ask the DM ...") answers a question about the current scene in a sentence or two, from public facts only (never DM Prep, the chapter plan, or a riddle's answer). It is transient: nothing is stored, the story and revision do not move. 6 questions per session per minute; rejected while an action resolves or when the question targets an older turn or revision. (The `CHOICES_ON_DEMAND` opt-out was removed on 2026-09-25.)

## AI calls

| Call | Where | Model variable | Default | When |
|---|---|---|---|---|
| **Turn narration** (1-4 agents) | `dmTurnOrchestrator.ts` | `OPENAI_MODEL_NARRATION` | `gpt-4.1-mini` | Every action: narration always; combat/inventory/recovery agents only when relevant |
| **Ideas** | `ideasService.ts` | `OPENAI_MODEL_PREVIEW` (retry on narration model) | `gpt-5.6-luna` | Only when a player asks |
| **Ask the DM** | `askDmService.ts` | `OPENAI_MODEL_PREVIEW` | `gpt-5.6-luna` | Only when a player asks |
| **Action preview** | `actionPreviewService.ts`, `statSuggestionService.ts` | `OPENAI_MODEL_PREVIEW` | `gpt-5.6-luna` | Before an action is sent |
| **Stat suggestion** | `statSuggestionService.ts` | `OPENAI_MODEL_PREVIEW` | `gpt-5.6-luna` | Character creation and action routing |
| **Adventure naming** | `sessionNameService.ts` | `OPENAI_MODEL_PREVIEW` | `gpt-5.6-luna` | Once at creation |
| **TLDR summary** | `turnRoutes.ts` | `OPENAI_MODEL_NARRATION` | `gpt-4.1-mini` | On demand in the recap screen |
| **Character history** | `characterRoutes.ts` | `OPENAI_MODEL_NARRATION` | `gpt-4.1-mini` | When importing a hero from another adventure |
| **Campaign brief / DM Prep** | `storySummaryService.ts` | `OPENAI_MODEL_ASYNC` | `gpt-4.1` | At creation |
| **DM Prep compilation** | `dmPrepCompilationService.ts` | `OPENAI_MODEL_PREVIEW` | `gpt-5.6-luna` | After the campaign brief |
| **Story summary** | `storySummaryService.ts` | `OPENAI_MODEL_ASYNC` | `gpt-4.1` | Every 5 turns, background |
| **TTS narration** | `ttsService.ts` | `OPENAI_MODEL_TTS` | `gpt-4o-mini-tts` | When AI narration voice is on |
| **Scene image brief** | `imageBriefProvider.ts` | `OPENAI_MODEL_PREVIEW` | `gpt-5.6-luna` | Before each scene image |
| **Scene image** | `imageService.ts` | `OPENAI_IMAGE_MODEL` | `gpt-image-2` | Per turn when images are on, async, cached by prompt hash |
| **Adventure preview image** | `imageService.ts` | `OPENAI_IMAGE_MODEL` | `gpt-image-2` | At creation when images are on |
| **Hero portrait** | `imageService.ts` | `OPENAI_IMAGE_MODEL` | `gpt-image-2` | Once per hero, cached |
| **Metrics summary** | `.github/workflows/metrics.yml` | hardcoded | `gpt-4.1` | Weekly CI job |

Only the turn agents block the player's response. Images arrive later over SSE. Every provider request is recorded in `provider_usage` for usage limits and metrics (`npm run cli -- metrics`).

## Real-time events (SSE)

Every open view of an adventure receives the same events:

| Event | When |
|---|---|
| `dm_narrating`, `narration_chunk`, `narration_roll_ready`, `narration_streaming_done`, `narration_chunk_abort` | While a turn's narration streams |
| `turn_complete` / `turn_error` | A turn committed or failed |
| `session_updated` | Settings or state changed outside a turn (revision bump) |
| `image_ready` | A scene, preview or portrait image finished |
| `party_update` | Party HP or inventory changed outside a full turn |
| `ideas_updated` | Ideas were generated for the current turn |
| `intervention` / `sanctuary_recovery` | The party was rescued after a wipe |
| `game_over` | A wipe with no rescues left |
| `adventure_concluding` / `adventure_concluded` | The finale resolved and the epilogue is being written / is done |
