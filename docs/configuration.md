# Configuration

All settings are environment variables in the root `.env` (production reads the same names from SSM, see [operations.md](operations.md)). [`.env.example`](../.env.example) lists every variable with a comment; parsing and defaults live in [`backend/src/config/env.ts`](../backend/src/config/env.ts). Invalid values stop the backend at startup instead of being ignored.

## Minimum for local play

```
OPENAI_API_KEY=sk-...
```

That is enough: auth is off (everything runs in a single `local` realm), SQLite and generated images live under `backend/data/`, and every model has a built-in default. Normal gameplay calls your AI provider and costs money; switch images off per adventure (⚙ menu: **Images off**) to keep costs down.

## AI provider and models

The backend uses the OpenAI SDK for narration, helper calls, images and TTS. `OPENAI_BASE_URL` points it at any OpenAI-compatible gateway (OpenRouter, a LocalAI-compatible server, ...). Chat support does not imply image support: if your endpoint cannot generate images, switch images off (⚙ menu) or point `OPENAI_BASE_URL` at an image-capable endpoint.

| Variable | Default | Used for |
| --- | --- | --- |
| `OPENAI_API_KEY` | required | All AI calls |
| `OPENAI_BASE_URL` | OpenAI | Alternate OpenAI-compatible endpoint |
| `OPENAI_MODEL_NARRATION` | `gpt-4.1-mini` | Turn narration and mechanics agents, TLDR, character history, ideas retries |
| `OPENAI_MODEL_PREVIEW` | `gpt-5.6-luna` | Latency-critical helpers: action previews, stat suggestions, ideas, session naming, image briefs, DM Prep compilation |
| `OPENAI_REASONING_EFFORT_PREVIEW` | `none` | See [Preview-tier request settings](#preview-tier-request-settings) |
| `OPENAI_MODEL_ASYNC` | `gpt-4.1` | Background work: campaign brief, story summaries |
| `OPENAI_MODEL_TTS` | `gpt-4o-mini-tts` | Narration voice |
| `OPENAI_IMAGE_MODEL` | `gpt-image-2` | Scene images, adventure previews, hero portraits |
| `OPENAI_MAX_RETRIES` | SDK default (2) | Client-wide retry count; evaluation scripts require `0` |
| `AI_TURN_STRATEGY` | `resolved_first` | See [Turn strategy](#turn-strategy) |

Which call uses which model, and when, is listed in [architecture.md](architecture.md#ai-calls).

Provider-specific `AI_NARRATION_PROVIDER`, `AI_IMAGE_PROVIDER`, `LOCALAI_*` and `GEMINI_*` variables are no longer supported.

### Example: OpenRouter

```
OPENAI_API_KEY=sk-or-...
OPENAI_BASE_URL=https://openrouter.ai/api/v1
OPENAI_MODEL_NARRATION=<model id>
OPENAI_MODEL_PREVIEW=<model id>
OPENAI_MODEL_ASYNC=<model id>
OPENAI_REASONING_EFFORT_PREVIEW=omit
```

Pick model ids from the [OpenRouter catalog](https://openrouter.ai/models); free models come and go, so check the catalog rather than relying on a named one. Structured output quality varies a lot between models: small models often fail the JSON schemas and fall back to generic text. Most OpenRouter models do not generate images.

### Example: LocalAI-compatible server

```
OPENAI_API_KEY=localai
OPENAI_BASE_URL=http://127.0.0.1:8080/v1
OPENAI_MODEL_NARRATION=qwen3-1.7b
OPENAI_MODEL_PREVIEW=qwen3-1.7b
OPENAI_MODEL_ASYNC=qwen3-1.7b
OPENAI_REASONING_EFFORT_PREVIEW=omit
# OPENAI_IMAGE_MODEL=<image model exposed by your server>
```

Use whatever models your server exposes; the names above are an example, not a tested recommendation.

### Preview-tier request settings

Every preview-tier caller (ideas, action previews, stat suggestions, session naming, encounter-name repair, image briefs, DM-prep compilation) sends `max_completion_tokens` and no `temperature`. `OPENAI_REASONING_EFFORT_PREVIEW` controls the optional `reasoning_effort` field for those requests only:

| Value | Request |
|---|---|
| unset | `none`, the built-in default paired with the built-in `gpt-5.6-luna` preview model |
| `none`, `minimal`, `low`, `medium`, `high`, `xhigh` | Sent as `reasoning_effort` |
| `omit` | Never sent. Set this for OpenAI-compatible endpoints or custom models that reject the field |
| anything else | Backend refuses to start |

Narration-tier ideas retries and all narration/async requests never receive preview settings. Reasoning-capable preview models default to medium reasoning on the provider side, which can spend a small helper's whole token budget, so the app sends `none` unless told otherwise.

The built-in preview model (`gpt-5.6-luna`) and its reasoning default (`none`) are defined together in `PREVIEW_DEFAULTS` (`backend/src/providers/ai/openAiClient.ts`) and roll back together. `gpt-4.1-nano` retires on 2026-10-23 and must not be restored as a default. Production does not pin either value: `deploy-backend.sh` leaves both unset, so the code defaults apply. It was selected on 2026-09-24 with this evaluation: in an interleaved same-session comparison against `gpt-4.1-nano` (60 samples each), it had fewer deadline misses (5 vs 8), escalations (6 vs 12) and final fallbacks (3 vs 6), with no schema failures or empty replies. A preview reply that is empty with `finish_reason=length` logs a `console.warn` (`[AI] <caller> truncated: ...`) even though the caller falls back.

`[Metrics] turn_complete` log lines still include `choicesFailed=` and `choicesEscalated=`; both are always false now that turns carry no suggestions.

### Turn strategy

`AI_TURN_STRATEGY` selects the turn pipeline. Unset or `resolved_first` is the default (since 2026-09-25): the combat, inventory and recovery agents run first, the engine applies their proposals once, and narration is generated from those settled facts (see [MULTI_AGENT_WORKFLOW.md](../MULTI_AGENT_WORKFLOW.md)), so the story always matches what happened. Item turns apply the item first and then follow the same flow. `parallel` is the earlier pipeline, where narration runs beside the mechanics agents and repairs fix disagreements afterwards; keep it as an opt-out. Any other value stops the backend at startup. The [comparison runner](ai-evaluation.md#turn-strategy-comparison-paid) still measures the two against each other.

Every committed turn logs one `[TurnDiag] {json}` line (strategy, stage timings, first narration chunk, agent outcomes, repairs that fired, revisions). It contains no narration or player text.

## Storage

| Variable | Default | Meaning |
| --- | --- | --- |
| `PERSISTENCE_PROVIDER` | `sqlite` | Only SQLite is supported |
| `SQLITE_DB_PATH` | `./data/dnd-fam-ftw.sqlite` | Database file (relative to `backend/`); migrated automatically on startup |
| `IMAGE_STORAGE_PROVIDER` | `local` | `local` or `s3` |
| `LOCAL_IMAGE_STORAGE_PATH`, `LOCAL_IMAGE_PUBLIC_BASE_URL` | `./data/generated-images`, `/api/generated` | Local image files and the URL they are served under |
| `AWS_REGION`, `S3_IMAGE_BUCKET`, `S3_IMAGE_PREFIX`, `S3_IMAGE_PUBLIC_BASE_URL` | unset | Only with `IMAGE_STORAGE_PROVIDER=s3` |

## Auth

Auth is optional. With `AUTH_MODE=disabled` (the default when no Google OAuth credentials or `JWT_SECRET` are set) everything runs in a single `local` realm with no login page. With `AUTH_MODE=enabled`, missing or partial auth settings stop the backend at startup instead of silently disabling login.

When auth is on, each user gets their own realm and owns it: the owner is the account its AI usage is attributed to. Users can be added to more realms by an admin (`namespaces add-user`) or invited by email ("Invite your party"). Users in several realms pick one after login and can switch from the account menu.

| Variable | Meaning |
| --- | --- |
| `JWT_SECRET` | Cookie signing |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL` | Google sign-in (local: `http://localhost:5173/api/auth/google/callback`) |
| `FRONTEND_URL` | Browser origin allowed for credentialed requests; also used to build invitation links |
| `ADMIN_EMAIL` | Created as a user on startup |
| `APP_BASE_PATH` | `/` by default; `/dnd-fam-ftw/` only for the legacy subpath deploy |

### Sign-in and signup settings

| Env var | Meaning |
| --- | --- |
| `AUTH_MODE` | `disabled` or `enabled` (see [Auth](#auth)). |
| `SIGNUP_MODE` | `invite_only` (default) or `open`. Open creates a private `free` namespace for any verified email. Requires email to be configured and a notification mailbox. |
| `SIGNUP_DAILY_CAP` | Max new self-service accounts per UTC day (default 25). Past the cap, new people get the invite-request flow. |
| `EMAIL_PROVIDER` | `none` (default, no email sign-in), `ses`, or `capture` (prints mail to the backend log, local development only). |
| `EMAIL_FROM` | Sender address for SES, e.g. `DnD Fam FTW <no-reply@mail.example.com>`. |
| `SES_REGION` | SES region (defaults to `AWS_REGION`). |
| `EMAIL_CODE_HMAC_SECRET` | Key for hashing sign-in codes. Unset: derived from `JWT_SECRET`. |
| `SIGNUP_NOTIFY_EMAIL` | Where new-signup and "ask for more" notices go (defaults to `ADMIN_EMAIL`). |
| `SUPPORT_URL` | Donation page (https, e.g. `https://ko-fi.com/<you>`) behind the "Support the realm" button in Your Realm. Unset hides the button. |
| `KOFI_VERIFICATION_TOKEN` | Ko-fi webhook verification token. Enables `POST /webhooks/kofi` (90-day supporter upgrade for a matching sign-in email). Unset: the endpoint returns 404. |
| `MEMBER_INVITES_DISABLED` | `true` is the kill switch for "Invite your party": sending, resending, and accepting stop, including links already sent; existing members keep signing in. Default `false`: invitations are on whenever auth is enabled, email is configured (the same `EMAIL_PROVIDER` as sign-in codes), and `FRONTEND_URL` is set (links are built from it, never from the request). The startup log says whether they are on and why not. |
| `INVITE_DAILY_SEND_CAP` | Invitation emails per UTC day across the deployment (default 200). |
| `INVITE_DAILY_ACCOUNT_CAP` | New accounts created by accepting invitations per UTC day (default 25). Joining with an existing account does not count. New invited accounts also pause while `DAILY_SPEND_LIMIT_USD` is exceeded. |
| `MCP_ENABLED` | `true` opens the `/mcp` endpoint for AI assistants; `false` returns 404 there. Unset: on for local development (auth enabled and `NODE_ENV` neither `production` nor `test`), off otherwise. `true` requires `AUTH_MODE=enabled`: startup fails otherwise. Who can create tokens: see `MCP_DEFAULT_TIERS` and `users mcp-access`. Setting it back to `false` is the kill switch; website login is unaffected. |
| `MCP_PUBLIC_URL` | Endpoint address shown on the Access tokens page, e.g. `https://<api domain>/mcp` (https, or http on localhost). Unset: the page derives it from the API address. |
| `MCP_DAILY_PAID_CALLS_PER_TOKEN` | Paid MCP tool calls (previews, turns, questions, new adventures) per token or connected assistant per UTC day, on top of the realm's usage budget. Default 200. `0` pauses paid tools while reading keeps working. |
| `MCP_OAUTH_ENABLED` | `true` lets assistants connect by signing in (OAuth 2.1 with PKCE, consent page on the website) instead of pasting a token. Requires `MCP_ENABLED=true`, `MCP_PUBLIC_URL` at the origin root (`https://<api domain>/mcp`), and `FRONTEND_URL`; startup fails otherwise. `false` (default) is the OAuth kill switch: discovery, sign-in, token refresh, and existing OAuth access tokens stop at once, while personal tokens and disconnecting keep working. Not supported under a path prefix (legacy laptop deploy). |
| `MCP_DEFAULT_TIERS` | Comma-separated realm tiers whose members get MCP access without a per-user grant (default `unlimited`; `none` for nobody). Example: `unlimited,supporter`. A `users mcp-access` override of `on` or `off` wins. Invalid values stop startup. |

Member invitations: the realm owner (or any member, when the owner ticks "Let members invite others" in Settings) enters an email address. The recipient gets a link that works once for 7 days; opening it only shows the invitation, and pressing **Join realm** adds them as an ordinary member (never owner or admin) and signs them in to that realm without a code. It works in `invite_only` mode. Resending sends a new link and invalidates the old one. Limits: 10 sends per inviter and 3 per recipient per day, 60 seconds between sends to one address, and 30 link checks per IP per 10 minutes. Removing the inviter, a transfer of ownership, or the owner turning member invitations off cancels pending links. The invitation email is sent directly and never stored.

Email sign-in sends an 8-digit code valid for 10 minutes, usable only in the browser that asked for it, 5 attempts per code, 60 seconds between resends, 5 sends per address and 20 per IP per hour. Google sign-in never creates accounts: new players create their account with an email code first, after which "Continue with Google" works for the same address. Login cookies last 30 days and are renewed automatically when a signed-in player uses the app with less than a week left. New signups are also paused while `DAILY_SPEND_LIMIT_USD` is exceeded.

## Usage limits and costs

| Variable | Meaning |
| --- | --- |
| `DAILY_SPEND_LIMIT_USD` | Global estimated AI spend per UTC day; past it, paid work pauses (unset = no limit) |
| `USAGE_TIER_LIMITS` | JSON overrides for the `free` / `supporter` / `unlimited` daily budgets |
| `USAGE_MODEL_PRICES` | JSON cost estimates (USD per 1M tokens) for models missing from the built-in price table |

Per-realm session and turn limits are set with the CLI: `namespaces set-limits` in [MANAGE.md](../MANAGE.md#namespaces).

## Frontend build

| Variable | Meaning |
| --- | --- |
| `VITE_BASE_PATH` | `/` (default) or `/dnd-fam-ftw/` for the legacy subpath deploy |
| `VITE_API_BASE_URL` | Backend origin when the API is on another domain; leave unset locally |
