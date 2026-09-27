# AI evaluation scripts

Scripts for measuring model and pipeline changes. They are for maintainers changing models, prompts or the turn pipeline; normal development never needs them, and unit, integration and E2E tests use mocked narration instead.

Most of these make **paid** provider requests. Every script supports `--dry-run` to print the plan and worst-case request count first, requires `OPENAI_MAX_RETRIES=0` for live runs (so every physical request counts against its ceiling), and stops before exceeding its request cap. Results go to gitignored folders under `backend/data/`. Check current provider pricing before a live run.

## Preview-choices evaluation (paid)

`backend/src/scripts/evaluatePreviewChoices.ts` replays the 20 frozen synthetic fixtures in `backend/src/tests/fixtures/model-refresh-choices.ts` through the production choices flow (`runChoicesWithRetry`): one preview request plus at most one narration-tier retry per attempt. It was used to choose the preview model (see [Preview-tier request settings](configuration.md#preview-tier-request-settings)); ideas use the same flow. It makes **paid** provider requests and never runs from unit tests.

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

Three more paid checks support preview-model changes. Each sets the preview model with `--model` (reasoning `none`), requires `OPENAI_MAX_RETRIES=0`, supports `--dry-run`, and exits with code 2 on any failure:

```bash
# Temperature compatibility probes for a candidate (4 requests)
OPENAI_MAX_RETRIES=0 npx tsx --env-file=../.env src/scripts/probePreviewCompatibility.ts --model gpt-5.6-luna

# Every preview helper through its production function, including the 10/20/24-token caps (22 requests, ceiling 30)
OPENAI_MAX_RETRIES=0 npx tsx --env-file=../.env src/scripts/checkPreviewHelpers.ts --model gpt-5.6-luna

# Six full turns through DmTurnOrchestrator (about 4 requests per turn, ceiling 45)
OPENAI_MAX_RETRIES=0 npx tsx --env-file=../.env src/scripts/smokePreviewTurns.ts --model gpt-5.6-luna
```

Outputs, in `backend/data/model-refresh/`: `probes.jsonl`, `helpers.jsonl`, and `smoke.jsonl`. The helper check uses a temporary SQLite database and deletes it afterwards. Both check scripts record every physical request, including its token cap, reasoning setting, and finish reason.

## Turn strategy comparison (paid)

`backend/src/scripts/compareTurnStrategies.ts` plays the same scripted actions through both turn strategies ([Turn strategy](configuration.md#turn-strategy)). Run from `backend/`:

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
