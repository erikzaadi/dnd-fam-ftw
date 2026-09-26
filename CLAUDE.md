# CLAUDE.md

AI-powered family D&D game. Stack: React 19 + Vite frontend, Node/Express backend, SQLite, OpenAI-compatible AI via the OpenAI SDK.

## Dev setup

```bash
npm run install:all   # install shared, backend, and frontend
npm run dev           # backend :3001 + frontend :5173
```

The repo does not use npm workspaces. The shared package is linked from backend/frontend with `file:../packages/shared`, and `install:all` installs each package explicitly.

All env vars live in the root `.env`.

When debugging a pasted local session URL, fetch the JSON history first. Convert `http://localhost:5173/session/<id>` to `/api/session/<id>/history` on the frontend dev server, or use `http://localhost:3001/session/<id>/history` against the backend directly when it is running.

## Before committing

Do not run token-heavy verification commands yourself unless explicitly asked. This includes `npm test`, `npm run test:*`, `npm run build`, `npm run lint`, `npm run lint:*`, `npx tsc`, and package-specific variants. Ask the user to run the relevant command manually instead.

Manual verification checklist from repo root:

```bash
npm run lint          # all linters: shared → backend → frontend → workflows → bash
npm test              # all tests
npm run tsc           # type-check all packages: shared → backend → frontend
```

Targeted variants:

| Script | What it checks |
|---|---|
| `npm run lint:shared` | ESLint on `packages/shared/src` |
| `npm run lint:backend` | ESLint on `backend/src` |
| `npm run lint:frontend` | ESLint on `frontend/src` |
| `npm run lint:workflows` | actionlint + yamllint + shellcheck on CI workflows |
| `npm run lint:bash` | shellcheck on deploy scripts |
| `npm run tsc:shared` | TypeScript check on `packages/shared` |
| `npm run tsc:backend` | TypeScript check on `backend` |
| `npm run tsc:frontend` | TypeScript check on `frontend` |
| `npm run test:backend` | Backend unit tests |
| `npm run test:frontend` | Frontend unit tests |

Both `lint` and `tsc` follow the same package order: shared → backend → frontend (shared is a dependency of both others). After installing new deps in `packages/shared`, run `npm run install:all` from the root.

## Project layout

```
packages/shared/src/
  types.ts                         # Canonical types shared by backend and frontend - add shared types here

backend/src/
  index.ts                         # Express routes + SSE
  config/env.ts                    # All env var parsing - add new vars here
  services/
    stateService.ts                # SQLite via libsql - all DB access
    authService.ts                 # Google OAuth + JWT
    aiDmService.ts                 # GPT-4o narration
    imageService.ts                # OpenAI-compatible image generation
    gameEngine.ts                  # Dice, damage, turn mechanics
    storySummaryService.ts         # Rolling story compression
  middleware/
    auth.ts                        # Attaches req.namespaceId + req.userEmail
    sessionParam.ts                # Loads namespace-scoped req.session for session id routes
  mcp/                             # /mcp endpoint for AI assistants (bearer personal access tokens, docs/mcp/SETUP.md)
  providers/
    ai/                            # OpenAI-compatible narration + image helpers
    storage/                       # LocalImageStorageProvider + S3ImageStorageProvider
  scripts/
    cli.ts                         # Unified management CLI
    seedSessions.ts                # Seed data (invoked by cli sessions seed)
    seedOnboarding.ts              # Quick-start template, also re-seeded on every backend start

frontend/src/
  App.tsx                          # Routes + AuthProvider + AuthGuard
  contexts/AuthContext.tsx         # Auth state, enabled/user/logout
  pages/                           # Home, Session, CreateSession, CharacterAssembly, NamespacePicker, RequestInvite, etc.
  components/SiteHeader.tsx        # Banner + back button + logout button
  lib/api.ts                       # apiFetch() and imgSrc() URL helpers - use these everywhere
  stt/                             # Speech-to-text: Web Speech API wrapper, intent parsing, settings hook

terraform/                         # AWS infrastructure
```

## Keeping docs up to date

- **`README.md`** - update if adding a major feature or changing dev/deploy steps
- **`MANAGE.md`** - update if adding/changing CLI commands, deploy scripts, or env vars
- **`GAME_ENGINE_RULES.md`** - update if changing `gameEngine.ts` logic, difficulty, or turn types
- **`DM_PREP.md`** - update if changing DM Prep processing, encounter seed schema, or how seeds trigger
- **`frontend/src/pages/HowToPlay.tsx`** - update when gameplay rules or player-visible flow changes

## Coding conventions

- **No em dashes** - use a hyphen or colon instead
- **All `if` statements must have braces** on a new line (ESLint `curly` rule)
- **Tooltips**: always use `frontend/src/components/Tooltip.tsx`. Reference pattern: `frontend/src/components/game/ActionDock.tsx`. Use `portal` tooltips inside overflow/scroll containers. Never use the native `title` attribute.
- TypeScript strict mode on in all three packages (backend, frontend, packages/shared).
- **Shared types**: types that cross the API boundary belong in `packages/shared/src/types.ts`. Both `backend/src/types.ts` and `frontend/src/types/index.ts` re-export from there - existing imports in components and services need no changes.
- **Logging**: use `devLog` (`backend/src/lib/devLog.ts`, `frontend/src/lib/devLog.ts`) for debug/trace logs that should be silent in production. Use `console.log` only for operational events that are useful in production (e.g. campaign brief ready, session seeded, summary updated). Use `console.warn`/`console.error` for unexpected failures at any level.

## Auth

Optional - `AUTH_MODE=disabled|enabled` in `.env`. Unset, it is `enabled` when any of `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, or `JWT_SECRET` is set, else `disabled` (uses `local` namespace, no login page). Enabled with incomplete settings fails startup (`assertAuthConfig()` in `config/env.ts`); never fall back to anonymous access. `SIGNUP_MODE=invite_only|open` (default `invite_only`).

When enabled:
- Set `GOOGLE_CALLBACK_URL` (local dev: `http://localhost:5173/api/auth/google/callback`)
- Sign-in providers: Google OAuth and/or passwordless email codes (`EMAIL_PROVIDER=ses|capture`, see `services/emailAuthService.ts`). Emails are matched by `users.email_canonical` (trimmed, lowercased; `lib/email.ts`)
- `SIGNUP_MODE=invite_only`: only pre-registered emails (`npm run cli -- users add <email>`) can log in; others get the invite-request flow. `open`: a verified email gets a private `free` namespace (`services/signupService.ts`, one transaction with the challenge and the signup notice in `email_outbox`)
- `ADMIN_EMAIL` auto-creates that user on startup
- JWT stored as HttpOnly cookie; `req.namespaceId` + `req.userEmail` attached by `authMiddleware`
- JWT `type` field: `full` | `pending-namespace` | `pending-invite` | `invite-requested`. New full tokens carry `userId`; email-only full tokens are accepted only for accounts created before the token was issued. `authMiddleware` re-issues the 30-day full cookie when less than 7 days are left (sliding session)
- Google sign-in never creates accounts (`resolveGoogleSignIn`): new accounts come from an email code first
- Google OAuth uses a browser-bound `state` + PKCE cookie (`oauth_google`) and requires `email_verified`
- CORS allows only the `FRONTEND_URL` / `GOOGLE_CALLBACK_URL` origins (plus localhost outside production); state-changing `/auth/*` POSTs also check `Origin`. Endpoints that change which realm a cookie grants (`POST /auth/session/namespace`, `/auth/invitations/*`) use `requireBrowserJsonPost` (`routes/browserPost.ts`): Origin must be present and allowed, body must be JSON. `trust proxy` is `loopback` (nginx)
- Realm switching: `GET /auth/session/namespaces` and `POST /auth/session/namespace` use `requireFullIdentity` (valid full sign-in, membership not required) so a user removed from their active realm can pick another. `apiFetch` sends `X-Namespace-Id`; a mismatch with the cookie gets 409 `namespace_changed` and the page reloads
- Member invitations (`MEMBER_INVITES_ENABLED`, `services/namespaceInviteService.ts`): single-use emailed link (`/accept-invite#token=`), only the SHA-256 is stored, sent directly (never via `email_outbox`). Accepting adds an ordinary membership; invite-created users get the invited realm as primary and own nothing

## Namespace isolation

Every session belongs to a namespace. Users have a primary namespace (1:1) but can be granted access to additional namespaces via `namespaces add-user` or an invitation. Membership (`user_namespaces`) is the only source of access; the primary pointer is just the default at sign-in. All session queries scoped to `req.namespaceId`. Default: `local` when auth disabled.

Each real namespace has one owner (`namespaces.owner_user_id`, FK with `ON DELETE RESTRICT`), who must be a member; enforced by `services/namespaceOwnershipService.ts` / `namespaceMembershipService.ts` and reported by `cli namespaces owners`. Foreign keys are on (`PRAGMA foreign_keys = ON` in `database.ts`). User deletion (`userRepository.deleteUser`) refuses owners of shared realms and deletes realms the user owns alone. One-time migrations go through `runOnce` (`applied_migrations` table) in `migrations.ts`.

Routes with a session id should use `registerSessionIdParam()` so missing sessions and sessions outside `req.namespaceId` return 404 before route handlers run, with the loaded session available as `req.session`.

`StateService.deleteSession()` deletes all S3/local turn images and character avatars before deleting DB rows.

Usage tiers (`free` | `supporter` | `unlimited`) and daily text/picture budgets live in `services/usageLimitService.ts`; per-namespace session/turn overrides (NULL = tier default): see `MANAGE.md`. Every AI provider request is recorded in `provider_usage` by the SDK fetch in `providers/ai/usageRecordingFetch.ts`, attributed via `lib/usageContext.ts`: `user_id` is the actor, `owner_user_id` the realm owner when the request began. Build usage contexts only with `createUsageContext` (`services/usageAttribution.ts`); a real realm without a valid owner is refused paid work.

## Management CLI

```bash
npm run cli -- <resource> [sub-command] [args...] [--json]
```

Resources: `users`, `namespaces`, `sessions`, `metrics`, `invite-requests`. Full reference: **MANAGE.md**.

When adding CLI subcommands or flags, also update `scripts/cli-completion.bash`.

## Other npm scripts

| Script | What it does |
|---|---|
| `npm run dev` | Backend :3001 + frontend :5173 concurrently |
| `npm run build` | Frontend production build |
| `npm run build:backend` | Backend TypeScript compile |
| `npm run test:integration` | Backend service integration tests with temp SQLite and mocked narration |
| `npm run test:e2e` | Playwright E2E tests using isolated dev servers and mocked narration |
| `npm run test:visual` | Playwright visual snapshot tests (dev server must be running) |
| `npm run test:visual:update` | Regenerate local snapshot baselines |
| `npm run generate-readme-screenshots` | Regenerate `docs/*.png` README screenshots (self-contained: boots seeded backend + frontend with mocked AI) |
| `npm run setup:playwright` | One-time: install Playwright Chromium |

## Testing patterns

**Frontend** (`frontend/src/**/*.test.ts(x)`): vitest + @testing-library/react + jsdom. Setup: `frontend/src/test/setup.ts`. Pure lib utilities tested directly without rendering. E2E tests live in `frontend/tests/e2e` and use `frontend/playwright.e2e.config.ts`; visual snapshots are isolated to `frontend/tests/visual.spec.ts`.

**Backend** (`backend/src/**/*.test.ts`): vitest with `pool: 'forks'`. Set env vars in `beforeAll` before calling any service (config is lazily cached). Integration tests use a temp SQLite file per run, cleaned up in `afterAll`, and mock only the narration provider.

## DB migrations

`stateService.ts` runs `migrate()` on every startup. Add columns as `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` at the bottom of `migrate()`. Never drop columns or change column types. Update `seedSessions.ts` when adding migrations or changing game engine state shape.

## Image storage

Controlled by `IMAGE_STORAGE_PROVIDER` env var (`local` or `s3`). Never call `fs` directly for images - always use `imageService.ts`. Per-session `image_policy` (`off` | `on_demand` | `automatic`) is the one image setting; `savingsMode` is derived from it (true unless `automatic`) and skips automatic image generation. Change it only through `sessionRepository.setImagePolicy` (or `setSavingsMode`, which maps to it).

## Image prompt architecture

All image prompts are built via `buildImagePrompt()` in `imageService.ts`, which prepends `IMAGE_COMPOSITION_GUARDRAIL` (a long inline negative-instruction string) to every prompt. This is the source of truth for suppressing unwanted image content because GPT Image and many OpenAI-compatible image endpoints do not honor a separate negative prompt parameter. `DEFAULT_NEGATIVE_PROMPT` remains a compatibility hint on the provider input type, but new suppression rules belong in `IMAGE_COMPOSITION_GUARDRAIL`.

## Static image assets

`backend/src/scripts/generateStaticAssets.ts` is a one-time GPT Image generation script for bundled frontend images (intervention dragon, sanctuary light, home banner, UI icons, etc.). Output goes to `frontend/public/images/`. The script is idempotent - it skips files that already exist. Run from `backend/`:

```bash
npx tsx --env-file=../.env src/scripts/generateStaticAssets.ts
```

Add new entries to the `ASSETS` array in that file when new static images are needed (e.g. onboarding scene images). Commit the generated PNG files - they are intentional static assets, not build artifacts.

## Character history

Characters have a `history` field. When importing from a previous session (CharacterAssembly), an AI-generated one-sentence summary is stored and passed to the AI DM as context each turn.

## Base path

Dev and AWS production both use `/`. Local laptop builds (`scripts/re-deploy.sh`) use `/dnd-fam-ftw/` - set `APP_BASE_PATH=/dnd-fam-ftw/`.

## Terraform

Infrastructure in `terraform/`. `terraform/terraform.tfvars` is gitignored - copy from `terraform.tfvars.example`. Outputs feed app config: `frontend_url`, `api_url`, `image_bucket_url`, `cloudfront_distribution_id`.
