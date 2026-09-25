# Operations and Management

This document covers all management scripts for local development and production operations.

---

## Local development CLI

All management commands go through a single entry point. Run from the repo root using either the wrapper script or via npm:

```bash
./dnd-fam-ftw-cli <resource> [sub-command] [args...]
# or
npm run cli -- <resource> [sub-command] [args...]
```

For JSON output piped to `jq`:

```bash
./dnd-fam-ftw-cli namespaces list -j | jq '.[].name'
./dnd-fam-ftw-cli sessions list -j | jq '.sessions | length'
./dnd-fam-ftw-cli metrics -j | jq '.[].total_turns'
```

`--json` and `-j` are equivalent throughout.

Tab completion is available for `./dnd-fam-ftw-cli` and `./dnd-fam-ftw-prod-cli`. Source it from your shell profile:

```bash
# zsh:
autoload -Uz bashcompinit && bashcompinit
source /path/to/dnd-fam-ftw/scripts/cli-completion.bash

# bash:
source /path/to/dnd-fam-ftw/scripts/cli-completion.bash
```

### users

Manage registered users. Each user gets their own primary namespace on creation.

```bash
./dnd-fam-ftw-cli users list                                # list all users and their accessible namespaces
./dnd-fam-ftw-cli users list --json
./dnd-fam-ftw-cli users add <email> [name]                  # create user + namespace
./dnd-fam-ftw-cli users remove <email>                      # delete user (and their namespace if empty)
./dnd-fam-ftw-cli users set-primary <email> <namespaceId>   # change a user's primary namespace
```

### namespaces

Manage namespaces (isolated session spaces). Users can be granted access to additional namespaces beyond their primary one.

```bash
./dnd-fam-ftw-cli namespaces list                                         # list all with user/session counts and limits
./dnd-fam-ftw-cli namespaces list --json
./dnd-fam-ftw-cli namespaces create <name>                                # create a standalone namespace
./dnd-fam-ftw-cli namespaces rename <id> <new-name>
./dnd-fam-ftw-cli namespaces delete <id>                                  # only works if namespace has no sessions
./dnd-fam-ftw-cli namespaces sessions <id>                                # list sessions in a namespace
./dnd-fam-ftw-cli namespaces sessions <id> --json
./dnd-fam-ftw-cli namespaces assign-session <sessionId> <namespaceId>    # move a session to another namespace
./dnd-fam-ftw-cli namespaces add-user <namespaceId> <email>              # grant user access to a namespace
./dnd-fam-ftw-cli namespaces remove-user <namespaceId> <email>           # revoke user access to a namespace
./dnd-fam-ftw-cli namespaces set-limits <id>                              # show current limits
./dnd-fam-ftw-cli namespaces set-limits <id> --max-sessions 5            # cap number of sessions
./dnd-fam-ftw-cli namespaces set-limits <id> --max-turns 100             # cap turns per session
./dnd-fam-ftw-cli namespaces set-limits <id> --max-sessions null         # remove session limit
```

`NULL` limits mean unlimited (the default for new namespaces).

### sessions

Dev tools for inspecting and resetting session data.

```bash
./dnd-fam-ftw-cli sessions list                                              # print all sessions, characters, inventory, turn history
./dnd-fam-ftw-cli sessions list --json
./dnd-fam-ftw-cli sessions nuke                                              # delete all sessions and their data
./dnd-fam-ftw-cli sessions seed                                              # seed 10 example sessions (idempotent; session 10 is paused mid-riddle)
./dnd-fam-ftw-cli sessions export [--session <id>] [--namespace <id>] [--output <file.json>]   # export sessions to JSON
./dnd-fam-ftw-cli sessions import <file.json> [--namespace-id <id>]         # import sessions from JSON
```

### metrics

Per-namespace usage stats: sessions, turns, images, avatars, TTS, and savings mode counts.

```bash
./dnd-fam-ftw-cli metrics
./dnd-fam-ftw-cli metrics --json
```

Pass `--since <ISO date>` to add windowed counts per namespace: `new_sessions_since`, `turns_since` (turns played since that date), and `active_users_since` (users who logged in since that date). Requires `turn_history.createdAt` and `users.lastLogin`, both populated going forward (existing rows before the migration are backfilled to the migration timestamp).

```bash
./dnd-fam-ftw-cli metrics --since 2026-08-01T00:00:00Z --json
```

Narration retry and fallback diagnostics are available as analysis-friendly JSON or CSV. The default includes any turn that retried narration, kept a structured retry after a gameplay guard warning, or fell back after schema/provider failure. Add `--since <ISO date>` to scope to turns created after that date.

```bash
./dnd-fam-ftw-cli metrics narration --json
./dnd-fam-ftw-cli metrics narration --format csv
./dnd-fam-ftw-cli metrics narration --failed-only --namespace <id>
./dnd-fam-ftw-cli metrics narration --session <id> --csv
./dnd-fam-ftw-cli metrics narration --since 2026-08-01T00:00:00Z --json
```

Provider usage and estimated AI cost per day and namespace (every request that reached the AI provider, retries included, attributed to the signed-in namespace; `(system)` is work outside a request). Defaults to the last 7 days. Costs are estimates from a built-in price table (override with `USAGE_MODEL_PRICES`); the provider dashboard is authoritative.

```bash
./dnd-fam-ftw-cli metrics usage
./dnd-fam-ftw-cli metrics usage --since 2026-09-01 --namespace <id> --json
```

The weekly metrics workflow tracks the timestamp of its last run in SSM and passes it as `--since` to `metrics` and `metrics narration`, so all weekly figures (new sessions, new narration failures, most active namespace, active users) are computed directly from real row timestamps rather than diffing snapshots.

### invite-requests

View and manage invite requests from unregistered Google users.

```bash
./dnd-fam-ftw-cli invite-requests list
./dnd-fam-ftw-cli invite-requests list --json
./dnd-fam-ftw-cli invite-requests approve <email> [--namespace <name>]   # approve request, creates user + namespace
./dnd-fam-ftw-cli invite-requests clear                                   # delete all requests
```

---

## Live preview-choices evaluation (paid)

`backend/src/scripts/evaluatePreviewChoices.ts` replays the 20 frozen synthetic fixtures in `backend/src/tests/fixtures/model-refresh-choices.ts` through the production choices flow (`runChoicesWithRetry`): one preview request plus at most one narration-tier retry per attempt. It supports the model refresh plan in `next-up-instructions/model-refresh-02-live-validation.md`. It makes **paid** provider requests and never runs from unit tests.

Run from `backend/`. `OPENAI_MAX_RETRIES=0` must be in the environment before the process starts. The script refuses to run otherwise, so every physical request counts against `--max-requests`:

```bash
# Preview the plan and worst-case request count without calling the provider
npx tsx src/scripts/evaluatePreviewChoices.ts --label baseline --dry-run

# Baseline: current configuration, 20 fixtures x 3 repeats, at most 120 requests
OPENAI_MAX_RETRIES=0 npx tsx --env-file=../.env src/scripts/evaluatePreviewChoices.ts --label baseline

# Interleaved comparison: per-configuration model/reasoning overrides
OPENAI_MAX_RETRIES=0 npx tsx --env-file=../.env src/scripts/evaluatePreviewChoices.ts --label compare \
  --config current \
  --config candidate:OPENAI_MODEL_PREVIEW=gpt-6-luna,OPENAI_REASONING_EFFORT_PREVIEW=none
```

| Option | Default | Meaning |
|---|---|---|
| `--label <name>` | required | Run label recorded in results |
| `--config <name>[:K=V,...]` | one config named after the label | Repeatable. A config without overrides uses the built-in defaults. Only `OPENAI_MODEL_*`, `OPENAI_REASONING_EFFORT_*`, `OPENAI_TEXT_VERBOSITY_*`, and `OPENAI_SERVICE_TIER_*` overrides are allowed |
| `--repeat <n>` | 3 | Passes over the fixture set |
| `--fixtures <id,id>` | all 20 | Restrict to specific fixtures |
| `--max-requests <n>` | 120 per config | Stops before an attempt could exceed the ceiling and marks the run incomplete |
| `--out-dir <path>` | `backend/data/model-refresh` | Results directory (gitignored) |
| `--dry-run` | off | Print the plan only |

Outputs: `runs.jsonl` (run header with git revision, fixture hashes, and choices prompt hashes; one record per attempt with raw initial output, player-visible choices after production guards, and per-request timing/usage; and a summary) and `score-<runId>.md`, a manual checklist sheet scoring raw and player-visible output separately. Do not compare runs whose prompt hashes differ as one sample. Escalation, fallback, deadline misses, and p50/p95 completion latency are printed per configuration. First-content latency is report-only.

`OPENAI_MAX_RETRIES` is a client-wide setting (non-negative integer). Unset keeps the OpenAI SDK default; invalid values stop backend startup.

Three more paid checks support the same plan. Each sets the preview model with `--model` (reasoning `none`), requires `OPENAI_MAX_RETRIES=0`, supports `--dry-run`, and exits with code 2 on any failure:

```bash
# Temperature compatibility probes for a candidate (4 requests)
OPENAI_MAX_RETRIES=0 npx tsx --env-file=../.env src/scripts/probePreviewCompatibility.ts --model gpt-5.6-luna

# Every preview helper through its production function, including the 10/20/24-token caps (22 requests, ceiling 30)
OPENAI_MAX_RETRIES=0 npx tsx --env-file=../.env src/scripts/checkPreviewHelpers.ts --model gpt-5.6-luna

# Six full turns through DmTurnOrchestrator (about 4 requests per turn, ceiling 45)
OPENAI_MAX_RETRIES=0 npx tsx --env-file=../.env src/scripts/smokePreviewTurns.ts --model gpt-5.6-luna
```

Outputs, in `backend/data/model-refresh/`: `probes.jsonl`, `helpers.jsonl`, and `smoke.jsonl`. The helper check uses a temporary SQLite database and deletes it afterwards. Both check scripts record every physical request, including its token cap, reasoning setting, and finish reason.

### Preview-tier request settings

Every preview-tier caller (initial choices, action previews, stat suggestions, session naming, encounter-name repair, image briefs, DM-prep compilation) sends `max_completion_tokens` and no `temperature`. `OPENAI_REASONING_EFFORT_PREVIEW` controls the optional `reasoning_effort` field for those requests only:

| Value | Request |
|---|---|
| unset | `none`, the built-in default paired with the built-in `gpt-5.6-luna` preview model |
| `none`, `minimal`, `low`, `medium`, `high`, `xhigh` | Sent as `reasoning_effort` |
| `omit` | Never sent. Set this for OpenAI-compatible endpoints or custom models that reject the field |
| anything else | Backend refuses to start |

Narration-tier choices retries and all narration/async requests never receive preview settings. Reasoning-capable preview models default to medium reasoning on the provider side, which can spend a small helper's whole token budget, so the app sends `none` unless told otherwise.

The built-in preview model (`gpt-5.6-luna`) and its reasoning default (`none`) are defined together in `PREVIEW_DEFAULTS` (`backend/src/providers/ai/openAiClient.ts`) and roll back together. `gpt-4.1-nano` retires on 2026-10-23 and must not be restored as a default. Production does not pin either value: `deploy-backend.sh` leaves both unset, so the code defaults apply. Selection evidence is in `next-up-instructions/model-refresh-02-live-validation.md`. A preview reply that is empty with `finish_reason=length` logs a `console.warn` (`[AI] <caller> truncated: ...`) even though the caller falls back.

`[Metrics] turn_complete` log lines still include `choicesFailed=` and `choicesEscalated=`; both are always false now that turns carry no suggestions.

### Ideas on demand

Turns never pre-generate suggested choices, in either turn pipeline (or the opening, rescue, and chapter-start turns): no choices agent, retry, rerun, or deterministic fallback runs per turn, and narration ends with an open question to the next hero. Players type what they try, or press **Give me ideas**, which calls `POST /session/:id/ideas` (same choices path, run on request, shared by every viewer, never advancing the story; 6 generations per session per minute).

Per realm, the ⚙ menu setting **Ideas every turn** (`sessions.auto_ideas`) makes open views ask for ideas once after each turn; turns themselves stay fast. Turns saved before ideas moved on demand still show their stored choices.

**Ask the DM** (`POST /session/:id/ask`, Session button, terminal `ask dm ...`, car "ask the DM ...") answers a question about the current scene in a sentence or two, from public facts only (never DM Prep, the chapter plan, or a riddle's answer). It is transient: nothing is stored, the story and revision do not move. 6 questions per session per minute; rejected while an action resolves or when the question targets an older turn or revision. (The `CHOICES_ON_DEMAND` opt-out was removed on 2026-09-25.)

### Turn strategy

`AI_TURN_STRATEGY` selects the turn pipeline. Unset or `resolved_first` is the default (since 2026-09-25): the combat, inventory and recovery agents run first, the engine applies their proposals once, and narration is generated from those settled facts (see `MULTI_AGENT_WORKFLOW.md`), so the story always matches what happened. Item turns apply the item first and then follow the same flow. `parallel` is the earlier pipeline, where narration runs beside the mechanics agents and repairs fix disagreements afterwards; keep it as an opt-out. Any other value stops the backend at startup. The comparison runner below still measures the two against each other.

Every committed turn logs one `[TurnDiag] {json}` line (strategy, stage timings, first narration chunk, agent outcomes, repairs that fired, revisions). It contains no narration or player text.

Comparison runner (`backend/src/scripts/compareTurnStrategies.ts`), run from `backend/`:

```bash
# Free: check the harness and output with the mock provider
npx tsx src/scripts/compareTurnStrategies.ts --label smoke --provider mock
# Plan and worst-case request count, no calls
npx tsx --env-file=../.env src/scripts/compareTurnStrategies.ts --label first --dry-run
# PAID: 8 scenarios x 6 actions x 2 strategies, capped at 600 requests / $10 by default.
# Verify current pricing first; --cost-per-request is required for live runs.
OPENAI_MAX_RETRIES=0 npx tsx --env-file=../.env src/scripts/compareTurnStrategies.ts --label first --cost-per-request 0.004
```

Results go to `backend/data/strategy-comparison/<run>/`: `turns.jsonl`, a blinded `scorecard.csv` for human scoring, `blind-key.json` (open only after scoring), and `summary.json` (p50/p95 end-to-end and first-narration latency, fallbacks, repairs, requests, estimated cost). A run stopped by a cap is marked incomplete and cannot pass the release gate.

---

## Production management (AWS)

Production commands run via SSH wrapper scripts under `scripts/deploy/`. These scripts:

1. Load config from `scripts/deploy/.env.deploy` (or exported env vars)
2. Open a temporary SSH tunnel to the Lightsail instance
3. Run the command remotely
4. Close the tunnel on exit

### Prerequisites

Copy `scripts/deploy/.env.deploy.example` to `scripts/deploy/.env.deploy` and fill in your values (host, SSH key path, etc.). Alternatively, export the required vars before running.

### dnd-fam-ftw-prod-cli - remote CLI

Runs management commands on the production instance. Same `<resource> <sub-command>` interface as the local CLI:

```bash
./dnd-fam-ftw-prod-cli users list
./dnd-fam-ftw-prod-cli users add someone@gmail.com "Their Name"
./dnd-fam-ftw-prod-cli namespaces list
./dnd-fam-ftw-prod-cli namespaces add-user <nsId> someone@gmail.com
./dnd-fam-ftw-prod-cli namespaces set-limits <nsId> --max-sessions 5 --max-turns 100
./dnd-fam-ftw-prod-cli sessions list --json
./dnd-fam-ftw-prod-cli metrics
./dnd-fam-ftw-prod-cli invite-requests list
```

### run-ssh.sh - interactive SSH session

Opens an interactive shell on the production instance.

```bash
./scripts/deploy/run-ssh.sh
```

### node-version.sh

Prints the Node.js version running on the instance. Useful for confirming upgrades.

```bash
./scripts/deploy/node-version.sh
```

### restart-instance.sh

Restarts the Lightsail instance via the AWS CLI. Use when the app is wedged and a service restart isn't enough.

```bash
./scripts/deploy/restart-instance.sh
```

### smoke-test.sh

Checks that the API health endpoint and frontend are reachable after a deploy.

```bash
./scripts/deploy/smoke-test.sh
```

### deploy-backend.sh

Builds the backend locally, rsyncs the `dist/` output to the instance, pulls secrets from SSM, writes the app env file, and restarts the systemd service. Called by CI but can be run manually.

```bash
./scripts/deploy/deploy-backend.sh
```

### deploy-frontend.sh

Builds the frontend with production env vars, syncs the output to S3, and invalidates the CloudFront distribution. Called by CI but can be run manually.

```bash
./scripts/deploy/deploy-frontend.sh
```

### setup-service.sh

One-time bootstrap after a fresh instance. Creates app directories, installs the systemd service, and writes the Nginx config. Run once after `terraform apply` + cert provisioning.

```bash
./scripts/deploy/setup-service.sh
```

---

## One-time setup scripts

These run once during initial infrastructure setup. Not needed for day-to-day operations.

| Script | When to run |
|---|---|
| `./scripts/create-terraform-user.sh [aws-profile]` | Before first `terraform apply` - creates the IAM user and policy Terraform needs |
| `./scripts/fill-ssm-params.sh [aws-profile] [ssm-prefix]` | After `terraform apply` - fills SSM parameters with actual secret values |
| `./scripts/provision-cert.sh` | After `terraform apply` - obtains a Let's Encrypt TLS cert via DNS-01 / Route 53 |
| `./scripts/bump-version.sh` | Create and push a new version tag (reads latest tag, increments patch, pushes) |
| `./scripts/install-ubuntu.sh` | Legacy local laptop deploy - installs deps and systemd service on an Ubuntu server |
| `./scripts/re-deploy.sh` | Legacy local laptop deploy - pushes local changes and restarts the service |
| `./scripts/sync-to-server.sh` | Legacy local laptop deploy - rsync only, no restart |

---

## CI/CD

GitHub Actions handles automated deploys. Workflows live in `.github/workflows/`:

| Workflow | Trigger | What it does |
|---|---|---|
| `deploy.yml` | `v*` tag, manual | First runs `lint.yml` and `test.yml` (all jobs) on the exact SHA. Tags deploy backend and frontend; manual runs deploy what changed since the last deployed SHA (shared package, root package files, `.nvmrc` and the deploy workflow count for both; an unknown comparison SHA rebuilds). Backend ships as a versioned release with automatic rollback. Shares the `production-mutation` concurrency group with restores and is never cancelled mid-run. |
| `lint.yml` | Push, PR, manual, called by deploy | Lint + typecheck for shared, backend, frontend, workflows and shell scripts. Always reports the stable **Lint result** check (use it for branch protection). |
| `test.yml` | Push, PR, manual, called by deploy | Backend unit + integration, frontend unit, E2E (failure traces uploaded as artifacts). Always reports the stable **Test result** check. |
| `metrics.yml` | Sunday 10:00 UTC, manual | Gathers usage metrics + pending invite requests, AI summary via Pushover |
| `visual-snapshots.yml` | `v*` tag, manual | Runs Playwright visual snapshot tests against a seeded prod instance; compare against S3 baselines. First run: dispatch with `update_snapshots=true` to generate baselines. |
| `renew-cert.yml` | Scheduled (monthly) | Renews the Let's Encrypt cert via `certbot renew` |
| `backup-db.yml` | Daily 02:00 UTC, manual | Consistent copy via `VACUUM INTO` (`dist/scripts/backupDatabase.js`), integrity-checked, uploaded with a metadata JSON (app version, schema summary, counts) to `s3://<SNAPSHOTS_BUCKET_NAME>/db-backups/`. Retention follows the bucket lifecycle rule (90 days). Recovery point: up to ~24h. Requires a backend release that contains the backup script. |
| `restore-db.yml` | Manual only | Inputs: `backup_date` (YYYY-MM-DD), `target` = `drill` (default: restores into a disposable copy, starts the app on a spare port against it, verifies, deletes; production untouched) or `production` (verifies the backup, keeps a `.pre-restore-*` copy, restores, checks startup, ownership and readable sessions/history). Run a drill first. |

Required GitHub secrets (in the `production` environment): `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `LIGHTSAIL_INSTANCE_NAME`, `LIGHTSAIL_HOST`, `SSH_PRIVATE_KEY`, `API_DOMAIN`, `FRONTEND_DOMAIN`, `FRONTEND_BUCKET_NAME`, `IMAGE_BUCKET_NAME`, `CF_DIST_ID`.
Required GitHub variable (in the `production` environment): `SNAPSHOTS_BUCKET_NAME`.

### Backend releases and rollback

The backend runs from `/opt/dnd-fam-ftw/current`, a symlink to `/opt/dnd-fam-ftw/releases/<release-id>`. Each deploy uploads a new release directory, keeps the previous `app.env` as `app.env.previous`, switches the symlink atomically, restarts, and verifies `/health` reports the new version; if not, the previous release and env file are restored and the deploy fails. The newest 5 releases are kept. The first deploy after this change migrates the old plain `current/` directory into `releases/legacy-*` automatically.

Manual rollback (code/config only, never the database; schema migrations are additive so older releases run on the newer schema):

```bash
./scripts/deploy/rollback-backend.sh --list          # releases, * = active
./scripts/deploy/rollback-backend.sh                 # back to the release before the current one
./scripts/deploy/rollback-backend.sh <release-id>    # a specific release
./scripts/deploy/rollback-backend.sh --restore-env   # also restore app.env.previous
```

Frontend rollback: re-run the Deploy workflow on the earlier tag with `force_frontend`. Old hashed assets stay in S3 for 30 days, so open tabs keep working across releases.

### Inspecting a backup locally

Download a backup and run CLI commands against it:

```bash
# List available backups
aws s3 ls s3://<SNAPSHOTS_BUCKET_NAME>/db-backups/

# Download a backup
aws s3 cp s3://<SNAPSHOTS_BUCKET_NAME>/db-backups/app-YYYY-MM-DD.db ./app-backup.db

# Run CLI against the backup (full path required)
SQLITE_DB_PATH=${PWD}/app-backup.db ./dnd-fam-ftw-cli namespaces list
SQLITE_DB_PATH=${PWD}/app-backup.db ./dnd-fam-ftw-cli sessions list --json
```
