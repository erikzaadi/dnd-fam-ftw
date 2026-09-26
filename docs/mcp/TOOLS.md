# MCP tools

Endpoint: `POST /mcp` (stateless Streamable HTTP, JSON responses), bearer personal access token. Every tool returns a readable text result plus a schema-validated `structuredContent`. Errors come back as `isError: true` with a message ending in `(code)`. Source: `backend/src/mcp/` (schemas in `schemas.ts`, projections in `projection.ts`).

Scopes: `adventures:read` (always granted), `adventures:play`, `adventures:create`, `images:generate`. All tools act only inside the token's realm; adventures elsewhere look missing.

"Paid" tools spend AI budget: they count against the realm's daily usage budget and the per-token (or per connected assistant) `MCP_DAILY_PAID_CALLS_PER_TOKEN` ceiling (default 200 per UTC day; `0` pauses paid tools while reads keep working).

| Tool | Scope | Paid | Purpose |
| --- | --- | --- | --- |
| `list_adventures` | read | no | Adventures in the realm, most recently played first |
| `get_adventure` | read | no | Current state and latest turns; never advances play |
| `preview_action` | play | yes | Server interpretation and mechanics of the player's action, or a clarification question |
| `confirm_action` | play | yes | Commit a previewed action as a turn; returns an operation |
| `get_operation` | read | no | Wait for an operation and get the turns it committed |
| `ask_dm` | play | yes | Out-of-character question about the scene |
| `create_adventure` | create | yes | New text-only adventure plus its opening; returns an operation |
| `manage_adventure` | play | varies | `wrap_up` (free), `end_here` (never budget-refused), `continue_world` (paid), `retry_opening` (paid), `set_images` (free) |
| `get_scene_image` | read | no | Existing picture of one scene as an MCP image block (max 1 MiB), or a text fallback |
| `generate_scene_image` | images:generate | yes | Paint a picture for one scene on request (image policy `on_demand` or `automatic`) |

Prompts (optional): `start_adventure(idea?, heroes?)`, `resume_adventure(title?)`.

## list_adventures

Input: `cursor?`, `limit?` (1-25, default 10).
Output: `adventures[]` (`id`, `title`, `status` `active|concluding|completed|party_defeated`, `format`, `turn`, `lastPlayedAt`, `party[]` name/class/species), `nextCursor`.

## get_adventure

Input: `adventureId`, `historyLimit?` (1-10, default 3), `beforeTurnId?`.
Output: `id`, `title`, `revision`, `turn`, `status`, `format`, `chapter`, `phase`, `objective`, `resolution`, `wrapUpRequested`, `autoConfirmSafe`, `imagePolicy`, `activeHeroId`, `activeHeroName`, `party[]` (stats, HP, inventory with item `id`s, effects), `encounter` (enemies with discovered weaknesses only), `activeOperation`, `latestOperation`, `history[]`, `historyCursor`.

A turn: `turnId`, `turnType`, `heroName`, `action` (`text`, `success`, `roll`, `target`, `stat`), `rollNarration`, `narration`, `changes[]`, `hasImage`.

## preview_action

Input: `adventureId`, `expectedRevision`, `action` (player's words, max 600), `clarifications?` (max 2 `{ question, answer }`), `item?` (`use` `use_item|give_item`, `itemId`, `ownerHeroId`, `targetHeroId?`), `requestId?` (dedups retries for 10 minutes).
Output: `outcome` `preview|clarification`, `previewId`, `revision`, `heroName`, `question`, `originalAction`, `interpretedAction`, `stat`, `difficulty`, `target`, `bonuses[]`, `warnings[]`, `itemAction`, `autoConfirmEligible`.

Errors: `stale_revision`, `item_unavailable`, `riddle_unclear`, `riddle_answer_unknown`, `clarification_limit`, `request_id_conflict`, budget codes.

## confirm_action

Input: `adventureId`, `previewId`, `expectedRevision`, `requestId` (8-100 chars), `undoWindow?`.
Output: `operation` (`id`, `requestId`, `kind`, `status`, `resultRevision`, `turnId`, `errorCode`), `replayed`, `retryAfterSeconds`.

With `undoWindow: true` (only for `autoConfirmEligible` previews, else `needs_player_ok`) the server waits 5 seconds before accepting; if the client drops or cancels the call in that time (the player pressed Esc), nothing is sent. The preview must come from the same token and the current revision. The same `requestId` always returns the original operation, even after the preview expired. Errors: `stale_preview`, `stale_revision`, `operation_in_progress`, `request_id_conflict`, `adventure_completed`, `game_over`, budget codes.

## get_operation

Input: `adventureId`, `operationId?` or `requestId?`, `waitSeconds?` (0-25, default 20).
Output: `operation`, `done`, `revision`, `turns[]` (every turn the operation committed, oldest first), `retryAfterSeconds`, `message`.

`unknown_operation` for a `requestId` means the write never reached the server and can be sent again with the same `requestId`.

## ask_dm

Input: `adventureId`, `question` (max 300).
Output: `answer`, `turnId`, `revision`. Errors: `operation_in_progress`, `stale_question`, `ask_rate_limited`, `no_scene`.

## create_adventure

Input: `premise` (3-600), `heroes?` (`"auto"` or 1-5 `{ name, class, species, quirk? }`), `partySize?` (auto only, default 3), `format?` (`one_evening` default), `images?` (`off` default, or `on_demand`), `requestId`.
Output: `adventureId`, `operation` (the opening), `replayed`, `retryAfterSeconds`.

Never paints pictures by itself (`off` or `on_demand`). Stats and HP come from the class. The same `requestId` resumes the same adventure after a timeout, a concurrent duplicate, or a restart; an opening interrupted by a restart is reported as failed, never re-run automatically. Errors: `session_limit`, `request_id_conflict`, `adventure_deleted`, budget codes.

## manage_adventure

Input: `adventureId`, `action` (`wrap_up|end_here|continue_world|retry_opening|set_images`), `expectedRevision`, `requestId`, `format?` (continue only), `images?` (`off|on_demand|automatic`, set_images only).
Output: `action`, `operation` (null for `wrap_up` and `set_images`), `replayed`, `revision`, `retryAfterSeconds`.

`set_images` changes the adventure's single image policy for everyone playing it (the website's savings switch is the same setting: savings on = `off`, off = `automatic`).

## get_scene_image

Input: `adventureId`, `turnId`. Returns an MCP `image` content block plus a caption, or text explaining why not (no picture, too large, or a picture reused from the realm preview) with a link to the adventure on the website. Never paints.

## generate_scene_image

Input: `adventureId`, `turnId`, `requestId`. Needs `images:generate`, an image policy other than `off`, and picture budget. One picture per turn: an existing one is returned for free. Waits up to 25 seconds, then asks the host to call `get_scene_image` later. A failed request id is reported, never re-run; a new request id tries again. Errors: `images_off`, `picture_limit`, `image_failed`, `turn_not_found`, budget codes.
