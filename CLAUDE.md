# CLAUDE.md

This is an AI-powered family D&D game. Players pick heroes, describe a world, and an AI Dungeon Master narrates the adventure turn by turn. Stack: React 19 + Vite frontend, Node/Express backend, SQLite, OpenAI/Gemini/LocalAI.

## Dev setup

```bash
npm run install:all   # install both workspaces
npm run dev           # starts backend :3001 + frontend :5173 (concurrently, Ctrl+C kills both)
```

The dev server runs with base path `/` (no prefix). All env vars live in the root `.env`.

## Linting

Run everything from root:
```bash
npm run lint           # runs all: backend + frontend + workflows + bash scripts
npm run lint:backend   # ESLint on backend/src/**/*.ts
npm run lint:frontend  # ESLint on frontend/src/**/*.tsx
npm run lint:workflows # actionlint + yamllint + shellcheck on workflows
npm run lint:bash      # shellcheck on all scripts/
```

Per-workspace type checks:
```bash
cd backend && npx tsc --noEmit
cd frontend && npx tsc -b
```

One-time setup for workflow/yaml linting:
```bash
brew install actionlint shellcheck
npm run setup:lint
```

## Project layout

```
backend/src/
  index.ts                         # Express routes + SSE
  config/env.ts                    # All env var parsing - add new vars here
  services/
    stateService.ts                # SQLite via libsql - all DB access
    authService.ts                 # Google OAuth + JWT (full, pending-namespace, pending-invite, invite-requested types)
    aiDmService.ts                 # GPT-4o narration
    imageService.ts                # DALL-E / LocalAI image generation
    gameEngine.ts                  # Dice, damage, turn mechanics
    storySummaryService.ts         # Rolling story compression
  middleware/auth.ts               # Attaches req.namespaceId + req.userEmail
  providers/
    ai/                            # Narration + image provider abstraction
    storage/                       # LocalImageStorageProvider + S3ImageStorageProvider
  scripts/
    cli.ts                         # Unified management CLI: npm run cli -- <resource> <sub-command>
    seedSessions.ts                # Seed data (invoked by cli sessions seed)

frontend/src/
  App.tsx                          # Routes + AuthProvider + AuthGuard
  contexts/AuthContext.tsx         # Auth state, enabled/user/logout
  pages/                           # Home, Session, CreateSession, CharacterAssembly, NamespacePicker, RequestInvite, etc.
  components/SiteHeader.tsx        # Banner + back button + logout button
  lib/api.ts                       # apiFetch() and imgSrc() URL helpers - use these everywhere

terraform/                         # AWS infrastructure (see Terraform section below)
```

## Coding conventions

- **No em dashes** in code, comments, UI strings, or docs. Use a hyphen or colon instead.
- **All `if` statements must have braces** on a new line. ESLint enforces this (`curly` rule).
- Run `npm run lint` from root after changes.
- TypeScript strict mode is on in both workspaces.

## Auth

Auth is **optional** - if `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `JWT_SECRET` are absent from `.env`, auth is fully disabled and everything uses the `local` namespace. No login page is shown.

When auth is enabled:
- Google OAuth callback URL: set `GOOGLE_CALLBACK_URL` (for local dev: `http://localhost:5173/api/auth/google/callback`)
- Only emails pre-registered via `npm run users add <email>` can log in
- `ADMIN_EMAIL` in `.env` auto-creates that user on startup

JWT types in the `type` field:
- `full` - normal authenticated session (default)
- `pending-namespace` - user has multiple namespaces, must pick one (stored in `jwt_pending` cookie)
- `pending-invite` - unregistered Google user, can submit an invite request
- `invite-requested` - unregistered user who already submitted an invite request

JWT is stored as an HttpOnly cookie. `req.namespaceId` and `req.userEmail` are attached by `authMiddleware`.

## Namespace isolation

Every session belongs to a namespace. Users have a primary namespace (1:1) but can be granted access to additional namespaces via `namespaces add-user`. All session queries are scoped to `req.namespaceId`. The `local` namespace is the default when auth is disabled.

S3 asset deletion: `StateService.deleteSession()` deletes all turn images and character avatars from S3 (or local disk) before deleting the DB rows.

### Namespace limits

Per-namespace session and turn limits. NULL means unlimited (default).

```bash
npm run cli -- namespaces set-limits <id> --max-sessions 5 --max-turns 100
npm run cli -- namespaces set-limits <id>                   # show current limits
npm run cli -- namespaces set-limits <id> --max-sessions null   # remove limit
```

## Management CLI

All management commands go through one entry point. Run from the repo root:

```bash
npm run cli -- <resource> [sub-command] [args...] [--json]
```

Resources: `users`, `namespaces`, `sessions`, `metrics`, `invite-requests`. See **[MANAGE.md](MANAGE.md)** for the full reference including production deploy scripts.

## Character history

Characters have a `history` field. When importing a character from a previous session (CharacterAssembly), an AI-generated one-sentence summary of their past adventures is stored in `history`. This is passed to the AI DM as context for each turn.

## DB migrations

`stateService.ts` runs migrations on every startup via `migrate()`. Add new columns as `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` checks at the bottom of `migrate()`. Never drop columns. Never change existing column types. When adding new migrations, be sure to update the seed script (./backend/src/scripts/seedSessions.ts)

## Image storage

Controlled by `IMAGE_STORAGE_PROVIDER` env var (`local` or `s3`). The `imageService.ts` talks to the provider interface - never call `fs` directly for images. Session `savingsMode = true` skips image generation entirely.

## Base path

- **Dev**: base path is `/` (default). Vite proxy rewrites `/api/*` and `/images/*` to the backend.
- **AWS production**: base path is `/` (set via `VITE_BASE_PATH=/` in deploy.yml).
- **Local laptop build** (scripts/re-deploy.sh): uses `/dnd-fam-ftw/` prefix. Set `APP_BASE_PATH=/dnd-fam-ftw/` in the environment config.

## Terraform

Infrastructure lives in `terraform/`. See `plan-infra-terraform.md` for the full spec.

Key rule: **`terraform/terraform.tfvars` is gitignored** - it contains all environment-specific values (domains, bucket names, CIDRs). Copy `terraform/terraform.tfvars.example` and fill it in locally.

Outputs from `terraform output` feed directly into app config:
- `frontend_url` - used as CloudFront origin / `VITE_BASE_PATH`
- `api_url` - backend domain for Nginx config
- `image_bucket_url` - value of `S3_IMAGE_PUBLIC_BASE_URL`
- `cloudfront_distribution_id` - used by CI for cache invalidation
