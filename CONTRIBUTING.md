# Contributing

Thanks for wanting to help. This is a small family project: an AI-narrated story game with simplified, D&D-inspired rules (three stats, a d20, HP and rescues). It is not a full tabletop rules implementation, and it is not trying to become one.

Bug reports, small fixes, documentation corrections and ideas are all welcome. For anything bigger (a new mode, a new mechanic, a new provider), open an issue first so we can talk about whether it fits before you spend an evening on it.

## Reporting a bug

Open a [GitHub issue](https://github.com/erikzaadi/dnd-fam-ftw/issues) with:

- What you did, what you expected, and what happened instead.
- Where: the hosted site ([dnd-fam-ftw.erikzaadi.com](https://dnd-fam-ftw.erikzaadi.com)) or your own setup, browser and device, and the commit you are running if self-hosted.
- Steps to reproduce, if you have them. A session history JSON (`/api/session/<id>/history`) helps a lot for story or turn bugs.

Please redact before posting: API keys, access tokens, email addresses, and any story text you would not want public (family names, private jokes).

## Security issues

General hardening ideas are fine as a normal issue labeled `security`. Anything exploitable (reaching another realm's data, bypassing sign-in, leaking tokens) please report privately with **Report a vulnerability** on the repository's [Security tab](https://github.com/erikzaadi/dnd-fam-ftw/security) instead of a public issue. Only the latest `main` is supported; there are no release branches.

## First local run

Follow [Run it locally in the README](README.md#run-it-locally). In short: Node 24, a root `.env` with at least `OPENAI_API_KEY`, `npm run install:all`, `npm run dev`, then open `http://localhost:5173/`.

Normal gameplay calls your configured AI provider and can cost money. Tests and Playwright runs use mocked narration and make no paid calls.

## Where things live

| Path | What |
| --- | --- |
| `packages/shared/` | Types and constants shared by backend and frontend |
| `backend/` | Express API, game engine, AI orchestration, SQLite persistence, CLI |
| `frontend/` | React app ([frontend/README.md](frontend/README.md)) |
| `terraform/`, `scripts/` | AWS infrastructure and deploy scripts |
| `docs/` | Screenshots and the MCP (AI assistant) guides |

Reference docs: [GAME_ENGINE_RULES.md](GAME_ENGINE_RULES.md) (mechanics), [MULTI_AGENT_WORKFLOW.md](MULTI_AGENT_WORKFLOW.md) (how a turn is generated), [DM_PREP.md](DM_PREP.md), [docs/architecture.md](docs/architecture.md), [docs/configuration.md](docs/configuration.md), [docs/operations.md](docs/operations.md), [MANAGE.md](MANAGE.md) (CLI), [PRODUCT.md](PRODUCT.md) (design intent). [CLAUDE.md](CLAUDE.md) holds the coding conventions and instructions for AI coding assistants; its conventions apply to everyone.

## Making a change

1. Branch from `main` and keep each pull request to one topic.
2. Follow the conventions: no em dashes (use a hyphen or colon), braces on every `if`, `Tooltip.tsx` instead of `title`, `devLog` for debug logging, shared API types in `packages/shared/src/types.ts`.
3. Add or update tests for behavior changes. Copy-only changes do not need snapshot tests that freeze the wording.
4. Update the docs the change affects: player-visible rules in `frontend/src/pages/HowToPlay.tsx`, mechanics in `GAME_ENGINE_RULES.md`, CLI in `MANAGE.md`, env vars in `docs/configuration.md` and `.env.example`. If controls moved, regenerate screenshots (below).
5. In the pull request, say what you checked and how. "Ran lint and unit tests" and "clicked through one turn locally" are both useful; please do not claim checks you did not run.

## Checks

Run from the repo root:

| Command | What it checks |
| --- | --- |
| `npm run lint` | ESLint (shared, backend, frontend), actionlint, yamllint and shellcheck on workflows and scripts, and the docs check below |
| `npm run lint:docs` | Markdown links, images and anchors resolve; no links into local planning folders; no em or en dashes in Markdown or frontend source |
| `npm run tsc` | TypeScript for shared, backend, frontend |
| `npm test` | Backend and frontend unit tests |
| `npm run test:integration` | Backend integration tests (temp SQLite, mocked narration) |
| `npm run test:e2e` | Playwright end-to-end tests (mocked narration) |
| `npm run lint:fix` | ESLint autofix |

Targeted variants (`lint:frontend`, `tsc:backend`, `test:backend`, ...) are listed in [CLAUDE.md](CLAUDE.md#before-committing). Pick the checks that fit your change; a docs-only change does not need the full suite.

Tools outside npm: `npm run lint` needs `actionlint` and `shellcheck` on your PATH, and yamllint in a local venv (`npm run setup:lint` creates it). Playwright needs Chromium once: `npm run setup:playwright`.

## Screenshots

README screenshots come from `npm run generate-readme-screenshots` (self-contained, mocked AI, no paid calls). Visual snapshot baselines are refreshed with `npm run test:visual:update` while the dev server runs. Look at the generated images before committing them. `docs/CodexMCP.png` is a manual capture; check manual captures for personal content before committing.

## License

By contributing you agree that your contribution is licensed under the project's [AGPL-3.0-or-later](LICENSE) license.
