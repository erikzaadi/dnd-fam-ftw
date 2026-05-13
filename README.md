# 🐉 AI DM - Family D&D Night, Powered by AI

> *"Roll for initiative. The DM never sleeps, never gets tired, and always has a pun ready."*

A family-friendly, AI-powered D&D adventure game built for short, hilarious story nights. An AI Dungeon Master narrates your adventure, generates scene artwork, and never lets the story get boring.

![Home screen](docs/home-screen.png)

---

## What Is This?

You and your family pick heroes, describe a realm, and the AI takes over as DM. Each turn the AI narrates what happens, suggests three actions, and you pick one (or improvise your own). Roll dice. Take damage. Find cursed amulets. Argue about whether kicking a magic tome counts as Might or Mischief.

No prep required. No DM experience required. Just vibes and a d20.

---

## Features

### The Adventure

![Scene image with savings toggle](docs/scene-image-gameplay.png)

- **AI Dungeon Master** : GPT-4o narrates your story in real-time
- **DALL-E 3 scene and realm images** : every major moment gets illustrated, and each realm gets a generated preview image for home and recap screens
- **Three stats** : Might, Magic, and Mischief (it's a family game)
- **d20 rolls** : classic dice mechanics, displayed with a satisfying SVG die; the exact target needed is shown per action
- **Dynamic difficulty (DRAMA LLAMA)** : the AI tunes the specific roll target per action based on the current situation, within the spirit of the chosen difficulty
- **Inventory with stat bonuses** : find a magic sword, actually get +1 Might
- **Trading** : merchants and vendors can appear in the story and offer trade actions; the party swaps an item they own for something new
- **Per-session image toggle** : the 🖼/🪙 toggle in-session overrides the global images setting; session preference wins
- **Real-time multi-device sync** : everyone at the table can follow along via SSE

![Session header with party avatars](docs/session-header-party.png)

![AI narration panel](docs/narration-panel.png)

![Action choices and d20 result](docs/turn-history-card.png)

![Inventory panel with stat bonus item](docs/inventory-panel.png)

### Your Party

![Assemble your party screen](docs/assemble-party.png)

- **Custom hero creation** : name, species, class, quirk, and auto-generated AI portrait
- **Hero library** : import characters from previous adventures
- **HP tracking** : fail a roll, take damage; the stakes are real (ish)
- **Downed state** : reach 0 HP and your hero collapses; teammates must revive you
- **Party wipe rescue** : if everyone goes down, a magical intervention saves the party at 1 HP each; further wipes trigger a sanctuary recovery; rescue attempts are limited by difficulty - run out and the campaign ends
- **Rolling story summary** : the AI compresses the adventure every 5 turns so context stays sharp across long sessions

![Create new hero form](docs/create-hero-form.png)

Every hero gets a generated portrait and carries their quirk into the story:

![Character popup - Pundemic](docs/character-popup-pundemic.png) ![Character popup - Mambadelic](docs/character-popup-mambadelic.png)

### Between Sessions

![Recap mode selection](docs/recap-mode-select.png)

- **TLDR mode** : AI summarises the whole adventure in 3 sentences for latecomers
- **Movie mode** : animated slideshow of every scene, with Ken Burns effect and pause/play controls. Click any image for fullscreen. If a turn has no scene image, the realm preview is used as the fallback.

### Audio

- **Background music** : ambient tracks play during the adventure; the music automatically switches to danger/battle tracks when the AI raises the tension level to `high`, and back when it drops
- **Sound effects** : dice roll sounds, success fanfares, failure stings, and a narrating shimmer while the DM is writing
- **Silly mode** : toggle in Settings to give some SFX a 50% chance of swapping to a sillier alternative (bruh sounds, cartoon fails, etc.)
- **Narration voice (TTS)** : optional browser speech synthesis reads each turn narration aloud; configurable voice, style (neutral / heroic / mysterious / playful), speed, pitch, and volume; auto-reads new turns or manual replay
- All audio is opt-in and individually toggleable in Settings; mute button also stops TTS

### Quality of Life
- **DM Prep** : add campaign notes (lore, villains, locations, plot hooks) when creating or editing a realm; the AI weaves them naturally into the story
- **Chronicle** : tap "Open Chronicle" in-game to review every past turn with expanded details, rolls, and HP changes; click any turn to jump back and view that scene
- **Edit realm** : change difficulty, game pacing, realm description, or DM Prep at any time from the home screen
- **Savings mode** : toggle off image generation per-session (or globally in Settings); session toggle always wins
- **Session persistence** : SQLite, so your adventure survives a server restart
- **Realm details on home screen** : expand any active realm to see its generated preview image, party roster, realm description, and the last story summary before jumping in
- **Mobile & tablet friendly** : playable on the couch

---

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | React 19 + Vite + TailwindCSS 4 + TypeScript |
| Backend | Node.js + Express 5 + TypeScript |
| Database | SQLite via `libsql` (auto-migrated) |
| AI Narration | OpenAI-compatible chat API via the OpenAI SDK |
| AI Images | OpenAI-compatible image API via the OpenAI SDK |
| Real-time | Server-Sent Events |
| Fonts | Cinzel (display) + Lora (narrative) |

---

## Getting Started

### Prerequisites
- Node.js 20+
- An OpenAI-compatible API key

### AI options

The backend uses the OpenAI SDK for narration, helper chat calls, images, and TTS. Set `OPENAI_BASE_URL` to use OpenRouter, LocalAI-compatible servers, or another OpenAI-compatible gateway.

OpenAI-compatible chat support does not guarantee image support. If your alternate base URL does not support image generation, disable image generation in Settings or point `OPENAI_BASE_URL` at an image-capable endpoint.

### 1. Set up environment

Create a `.env` file.

**OpenAI-compatible API:**
```
OPENAI_API_KEY=sk-proj-...
OPENAI_MODEL=gpt-4o-mini
OPENAI_IMAGE_MODEL=gpt-image-2
```

**OpenRouter (free models available : no credit card required):**
Get a key at [openrouter.ai/keys](https://openrouter.ai/keys), then:
```
OPENAI_API_KEY=sk-or-...
OPENAI_BASE_URL=https://openrouter.ai/api/v1
OPENAI_MODEL=meta-llama/llama-3.3-8b-instruct:free
# Images may not be supported by the selected endpoint : disable image generation if needed
```
Browse free models at [openrouter.ai/models?order=top-weekly&supported_parameters=free](https://openrouter.ai/models?order=top-weekly&supported_parameters=free).

**LocalAI-compatible self-hosted API:**
```
OPENAI_API_KEY=localai
OPENAI_BASE_URL=http://127.0.0.1:8080/v1
OPENAI_MODEL=qwen3-1.7b
# OPENAI_IMAGE_MODEL=<image model exposed by your compatible server>
```

Provider-specific `AI_NARRATION_PROVIDER`, `AI_IMAGE_PROVIDER`, `LOCALAI_*`, and `GEMINI_*` env vars are no longer supported.

### 2. Install dependencies

```bash
npm run install:all
```

This installs `packages/shared`, `backend`, and `frontend`. The repo intentionally does not require npm workspaces; backend and frontend consume the shared package through `file:../packages/shared`.

### 3. Run locally

```bash
npm run dev
```

This starts:
- Backend on `http://localhost:3001`
- Frontend on `http://localhost:5173/` (base path `/` for dev)

The Vite dev server proxies `/api/*` → backend automatically.

---

## Project Structure

```
dnd-fam-ftw/
├── packages/
│   └── shared/
│       └── src/
│           └── types.ts          # Canonical API-boundary types and shared constants
│
├── backend/
│   └── src/
│       ├── index.ts              # Express API + SSE
│       ├── types.ts              # Backend extensions plus shared type re-exports
│       ├── services/
│       │   ├── gameEngine.ts     # Dice, damage, state
│       │   ├── aiDmService.ts    # GPT-4o narration
│       │   ├── imageService.ts   # DALL-E 3 + caching
│       │   ├── authService.ts    # Google OAuth + JWT
│       │   └── stateService.ts   # SQLite persistence
│       └── scripts/
│           └── cli.ts            # Unified management CLI (users, namespaces, sessions, metrics, invite-requests)
│
├── frontend/
│   └── src/
│       ├── pages/
│       │   ├── Home.tsx              # Realm list
│       │   ├── CreateSession.tsx     # New realm form
│       │   ├── CharacterAssembly.tsx # Party management + character import
│       │   ├── Session.tsx           # Active gameplay
│       │   ├── SessionRecap.tsx      # TLDR + Movie modes
│       │   ├── NamespacePicker.tsx   # Multi-namespace picker after login
│       │   └── RequestInvite.tsx     # Invite request form for unregistered users
│       └── components/
│           └── game/                 # Narration, ActionControls, Inventory...
│
├── terraform/                    # AWS infrastructure (Lightsail, S3, CloudFront, Route53)
├── scripts/                      # Deploy + install scripts
│   └── deploy/                   # SSH-wrapped management scripts (dnd-fam-ftw-prod-cli)
├── .github/workflows/            # CI/CD (deploy.yml, lint.yml, test.yml, renew-cert.yml)
├── docs/                         # Screenshots
└── .env                          # OPENAI_API_KEY goes here
```

---

## Deployment

### AWS (production)

The app deploys to AWS via GitHub Actions (`.github/workflows/deploy.yml`). Infrastructure is provisioned with Terraform (`terraform/`):

| Resource | Purpose |
|---|---|
| AWS Lightsail | Ubuntu VPS running the Node backend |
| S3 | Frontend static files + generated images |
| CloudFront | CDN for frontend and images |
| Route53 | DNS for API and frontend domains |
| SSM Parameter Store | Secrets (Google OAuth, JWT, etc.) |

**First-time setup:**
1. Copy `terraform/terraform.tfvars.example` to `terraform/terraform.tfvars` and fill in your values
2. Run `terraform apply` in `terraform/`
3. Fill in SSM parameters: `./scripts/fill-ssm-params.sh`
4. Provision TLS cert: `./scripts/provision-cert.sh`
5. Push a `v*` tag to trigger a full deploy

**CI/CD secrets** required in the GitHub `production` environment: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `LIGHTSAIL_INSTANCE_NAME`, `LIGHTSAIL_HOST`, `SSH_PRIVATE_KEY`, `API_DOMAIN`, `FRONTEND_DOMAIN`, `FRONTEND_BUCKET_NAME`, `IMAGE_BUCKET_NAME`, `CF_DIST_ID`.

**Change detection:** The deploy workflow only rebuilds what changed (backend or frontend) since the last deploy. Tag pushes always deploy everything.

### Local laptop (legacy)

The app can also run at a subpath (`/dnd-fam-ftw/`) behind Nginx on a local Linux server:

```bash
# First time setup on the server
./scripts/install-ubuntu.sh

# Push local changes to server and restart
./scripts/re-deploy.sh
```

The backend runs as a systemd service. `re-deploy.sh` sets `VITE_BASE_PATH=/dnd-fam-ftw/` automatically for the frontend build.

### Production management scripts

Run via SSH wrapper using the same `<resource> <sub-command>` interface as the local CLI:

```bash
./dnd-fam-ftw-prod-cli users list
./dnd-fam-ftw-prod-cli namespaces list
./dnd-fam-ftw-prod-cli metrics
./dnd-fam-ftw-prod-cli invite-requests list
```

See **[MANAGE.md](MANAGE.md)** for the full command reference.

---

## AI Usage

There are seven distinct AI calls in the app, each with a different purpose and cost profile:

| Call | Where | Model env var | When |
|---|---|---|---|
| **Turn narration** | `aiDmService.ts` | `OPENAI_MODEL` | Every action : the core DM loop |
| **Scene image** | `imageService.ts` | `OPENAI_IMAGE_MODEL` | Every turn, async via SSE, cached by prompt hash |
| **Realm preview image** | `imageService.ts` | `OPENAI_IMAGE_MODEL` | On realm creation and when realm details or party composition change, cached by prompt hash |
| **Avatar generation** | `imageService.ts` | `OPENAI_IMAGE_MODEL` | Once per character creation, cached permanently |
| **TLDR summary** | `index.ts` (route) | `OPENAI_MODEL` | On demand in recap screen |
| **Session naming** | `stateService.ts` | `OPENAI_MODEL` | Once at realm creation |
| **Character history** | `index.ts` (route) | `OPENAI_MODEL` | When importing a character from a previous session |

Use `npm run cli -- metrics` (or `./dnd-fam-ftw-prod-cli metrics` on production) to see per-namespace counts for sessions, turns, images, and avatars generated.

Turn narration is the only call that blocks the player response. Scene images are generated asynchronously after the turn : the story text appears immediately, and the image arrives via SSE a few seconds later. Realm preview images are also generated asynchronously and are skipped when the session is in savings mode.

---

## Real-time Events (SSE)

All connected clients receive the same events via Server-Sent Events:

| Event | When | What happens on the client |
|-------|------|----------------------------|
| `turn_complete` | After every turn | Narration + new choices appear; session state refreshes |
| `image_ready` | After async image generation | Scene image fades in |
| `party_update` | After a `use_item` / `give_item` action | Party HP and inventory update without a full turn refresh |
| `intervention` | All party members downed, first rescue | Amber 🐉 rescue banner shown for 8 s |
| `sanctuary_recovery` | All party members downed, rescue within limit | Grey 🏕️ sanctuary banner shown for 10 s |
| `game_over` | All party members downed, no rescues remaining | Campaign-over screen shown |

---

## How a Turn Works

```
Player picks action (each choice carries a suggested difficulty target from the AI)
       ↓
Backend resolves target: per-action difficultyValue if set, else base threshold (8/12/16)
       ↓
Backend rolls d20 + effective stat vs. resolved target
       ↓
Result sent to AI with full session context (outcome already resolved)
       ↓
AI narrates outcome (paced by gameMode: fast/balanced/cinematic)
     + returns a short rollNarration flavor comment shown in the D20 popup
     + returns currentTensionLevel (low/medium/high) - drives ambient vs danger music
     + suggests 3 new choices (each with a tuned difficultyValue)
     + optionally grants an item (suggestedInventoryAdd)
     + optionally removes an item for a trade (suggestedInventoryRemove)
       ↓
SSE broadcasts turn_complete → all connected clients update immediately
       ↓
Image generation runs in background if session savingsMode is off
       ↓
SSE broadcasts image_ready → scene image appears on all clients
```

The AI **cannot mutate game state directly** : it only returns structured JSON. The backend owns all mechanics.

---

## Auth and Multi-User Setup

Auth is optional. Without Google OAuth credentials everything runs under a single `local` namespace.

When auth is enabled, each user gets their own namespace (isolated sessions). Users can be granted access to additional namespaces by an admin.

```bash
./dnd-fam-ftw-prod-cli users list
./dnd-fam-ftw-prod-cli users add someone@gmail.com "Their Name"
./dnd-fam-ftw-prod-cli namespaces list
./dnd-fam-ftw-prod-cli namespaces add-user <namespaceId> someone@gmail.com
./dnd-fam-ftw-prod-cli namespaces set-limits <namespaceId> --max-sessions 5 --max-turns 100
./dnd-fam-ftw-prod-cli invite-requests list
```

Users with multiple namespace access will see a picker screen after login. For the full command reference see **[MANAGE.md](MANAGE.md)**.

For the complete ruleset : dice math, downed state, party wipes, item mechanics, story compression, SSE events : see **[GAME_ENGINE_RULES.md](GAME_ENGINE_RULES.md)**.

---

## Starting a New Realm

![New realm creation form](docs/create-world.png)

Pick a difficulty, choose a **game pacing** mode (Cinematic for rich descriptions, Balanced for a mix, Fast for immediate action and frequent conflict, ZUG-MA-GEDDON for pure chaos), describe your realm (or leave it blank for a surprise), add optional **DM Prep notes** (lore, villains, plot hooks the AI should weave in), and hit **Next: Assemble Heroes**.

---

## The Three Stats

| Stat | Good For |
|---|---|
| **Might** | Hitting things, breaking things, lifting things, being a goblin wrecking ball |
| **Magic** | Spells, healing, arcane shenanigans, summoning things that immediately cause problems |
| **Mischief** | Stealing, lying, sneaking, persuading the dragon that you're actually the tax collector |

---

## Tips

- The AI takes the `quirk` field seriously. A character who *"has strong opinions about cheese"* will absolutely have those opinions come up at the worst possible moment.
- Savings mode is your friend during testing. DALL-E isn't cheap.
- The TLDR recap is great for the family member who missed last week's session and claims they "totally remember what happened."

---

*Built with love, bad puns, and an irresponsible number of API calls.*

---

## License

This project is licensed under the AGPL-3.0 [License](./LICENSE).

If you run a modified version of this software as a service, you must make the source code of your modifications available to users.
