# Frontend

React 19 + Vite + Tailwind CSS 4 + TypeScript. The player-facing web app: home, adventure creation, hero assembly, the play screen, recap, settings, and the car and terminal modes.

Setup is in the [root README](../README.md#run-it-locally), settings in [docs/configuration.md](../docs/configuration.md); contribution workflow and checks are in [CONTRIBUTING.md](../CONTRIBUTING.md). Run commands from the repo root: `npm run dev` starts the backend on `:3001` and this app on `http://localhost:5173/`, with `/api/*` proxied to the backend.

## Layout

| Path | What lives there |
| --- | --- |
| `src/App.tsx` | Routes, `AuthProvider`, `AuthGuard` |
| `src/pages/` | One component per route (`Home`, `CreateSession`, `CharacterAssembly`, `Session`, `SessionRecap`, `HowToPlay`, `CarMode`, `TerminalMode`, ...) |
| `src/components/` | Shared UI; `components/game/` holds the play screen (action dock, narration, chronicle, inventory) |
| `src/session/` | Play-screen state and hooks (turn submission, ideas, car mode conductor) |
| `src/lib/api.ts` | `apiFetch()` and `imgSrc()`: use these for every API call and image URL |
| `src/stt/`, `src/tts/`, `src/audio/` | Speech-to-text, narration voice, music and sound effects |
| `src/contexts/` | Auth context |
| `public/images/` | Bundled static images (see `CREDITS.md` and `backend/src/scripts/generateStaticAssets.ts`) |

Conventions (tooltips, logging, no em dashes, braces on every `if`) are listed in [CLAUDE.md](../CLAUDE.md#coding-conventions).

## Tests

| Command (from repo root) | What it runs |
| --- | --- |
| `npm run test:frontend` | Vitest + Testing Library unit tests (`src/**/*.test.ts(x)`, setup in `src/test/setup.ts`) |
| `npm run lint:frontend` / `npm run tsc:frontend` | ESLint and TypeScript |
| `npm run test:e2e` | Playwright E2E (`tests/e2e/`), isolated dev servers with mocked narration |
| `npm run test:visual` / `npm run test:visual:update` | Visual snapshots (`tests/visual.spec.ts`); the dev server must be running |
| `npm run generate-readme-screenshots` | Regenerates `docs/*.png` with a seeded backend and mocked AI |

Playwright needs Chromium once: `npm run setup:playwright`.
