# CLAUDE.md

This is an AI-powered family D&D game. Players pick heroes, describe a world, and an AI Dungeon Master narrates the adventure turn by turn. Stack: React 19 + Vite frontend, Node/Express backend, SQLite, OpenAI/Gemini/LocalAI.

## Dev setup

```bash
npm run install:all   # install both workspaces
npm run dev           # starts backend :3001 + frontend :5173
```

## Linting

### Backend and frontend TypeScript
Each workspace has its own `eslint.config.js` and ESLint version:
```bash
cd backend && npm run lint && npx tsc --noEmit   # ESLint + type check
cd frontend && npm run lint && npx tsc -b        # ESLint + type check
```

### Workflow and shell linting
One-time setup (binaries + Python venv for yamllint):
```bash
brew install actionlint shellcheck
npm run setup:lint
```

Then before touching any workflow or shell script:
```bash
npm run lint:workflows
```

This runs:
- `actionlint` - validates workflow YAML, GHA expressions, and shellchecks every `run:` block
- `yamllint` - general YAML formatting (via `.venv-lint/`)
- `shellcheck` - lints all scripts in `scripts/`

The Vite dev server proxies `/dnd-fam-ftw/api/*` to the backend. All env vars live in the root `.env` (not `backend/.env` - the README is wrong about that).

## Project layout

```
backend/src/
  index.ts                         # Express routes + SSE
  config/env.ts                    # All env var parsing - add new vars here
  services/
    stateService.ts                # SQLite via better-sqlite3 - all DB access
    authService.ts                 # Google OAuth + JWT
    aiDmService.ts                 # GPT-4o narration
    imageService.ts                # DALL-E / LocalAI image generation
    gameEngine.ts                  # Dice, damage, turn mechanics
    storySummaryService.ts         # Rolling story compression
  middleware/auth.ts               # Attaches req.namespaceId + req.userEmail
  providers/
    ai/                            # Narration + image provider abstraction
    storage/                       # LocalImageStorageProvider + S3ImageStorageProvider
  scripts/
    users.ts                       # npm run users -- <list|add|remove>
    namespaces.ts                  # npm run namespaces -- <list|create|rename|delete|sessions|assign-session>
    listSessions.ts / nukeSessions.ts / seedSessions.ts

frontend/src/
  App.tsx                          # Routes + AuthProvider + AuthGuard
  contexts/AuthContext.tsx         # Auth state, enabled/user/logout
  pages/                           # Home, Session, CreateSession, CharacterAssembly, etc.
  components/SiteHeader.tsx        # Banner + back button + logout button
  lib/api.ts                       # api() and imgSrc() URL helpers - use these everywhere

terraform/                         # AWS infrastructure (see below)
```

## Coding conventions

- **No em dashes** in code, comments, UI strings, or docs. Use a hyphen or colon instead.
- **All `if` statements must have braces** on a new line. ESLint enforces this (`curly` rule).
- Run `npm run lint` from the relevant workspace (`backend/` or `frontend/`) after changes. Run `npm run lint:fix` from `backend/` for auto-fix.
- TypeScript strict mode is on in both workspaces. Run `npx tsc --noEmit` to verify.

## Auth

Auth is **optional** - if `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `JWT_SECRET` are absent from `.env`, auth is fully disabled and everything uses the `local` namespace. No login page is shown.

When auth is enabled:
- Google OAuth callback URL: set `GOOGLE_CALLBACK_URL` (for local dev: `http://localhost:5173/dnd-fam-ftw/api/auth/google/callback`)
- Only emails pre-registered via `npm run users add <email>` can log in
- `ADMIN_EMAIL` in `.env` auto-creates that user on startup

JWT is stored as an HttpOnly cookie. `req.namespaceId` and `req.userEmail` are attached by `authMiddleware` to every `/api/*` request (except `/api/auth/*`).

## Namespace isolation

Every session belongs to a namespace. Users have a 1:1 relationship with their namespace. All session queries are scoped to `req.namespaceId`. The `local` namespace is the default when auth is disabled.

Manage via scripts:
```bash
npm run users list
npm run users add someone@gmail.com "Their Name"
npm run namespaces list
npm run namespaces sessions <namespace-id>
```

## Backend scripts

All run from `backend/`:
| Script | What it does |
|---|---|
| `npm run users -- <cmd>` | list / add / remove users |
| `npm run namespaces -- <cmd>` | list / create / rename / delete / sessions / assign-session |
| `npm run list-sessions` | print all sessions |
| `npm run nuke-sessions` | delete all sessions (dev only) |
| `npm run seed-sessions` | seed test data |

## DB migrations

`stateService.ts` runs migrations on every startup via `migrate()`. Add new columns as `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` checks at the bottom of `migrate()`. Never drop columns. Never change existing column types.

## Image storage

Controlled by `IMAGE_STORAGE_PROVIDER` env var (`local` or `s3`). The `imageService.ts` talks to the provider interface - never call `fs` directly for images. Session `savingsMode = true` skips image generation entirely.

## Terraform

Infrastructure lives in `terraform/`. See `plan-infra-terraform.md` for the full spec.

Key rule: **`terraform/terraform.tfvars` is gitignored** - it contains all environment-specific values (domains, bucket names, CIDRs). Copy `terraform/terraform.tfvars.example` and fill it in locally.

Outputs from `terraform output` feed directly into app config:
- `frontend_url` - used as CloudFront origin / `VITE_BASE_PATH`
- `api_url` - backend domain for Nginx config
- `image_bucket_url` - value of `S3_IMAGE_PUBLIC_BASE_URL`
- `cloudfront_distribution_id` - used by CI for cache invalidation
