# 🐉 AI DM — Family D&D Night, Powered by AI

> *"Roll for initiative. The DM never sleeps, never gets tired, and always has a pun ready."*

A family-friendly, AI-powered D&D adventure game built for short, hilarious story nights. An AI Dungeon Master narrates your adventure, generates scene artwork, and never lets the story get boring.

![Home screen](docs/home-screen.png)

---

## What Is This?

You and your family pick heroes, describe a world, and the AI takes over as DM. Each turn the AI narrates what happens, suggests three actions, and you pick one (or improvise your own). Roll dice. Take damage. Find cursed amulets. Argue about whether kicking a magic tome counts as Might or Mischief.

No prep required. No DM experience required. Just vibes and a d20.

---

## Features

### The Adventure

![Scene image with savings toggle](docs/scene-image-gameplay.png)

- **AI Dungeon Master** — GPT-4o narrates your story in real-time
- **DALL-E 3 scene images** — every major moment gets illustrated, with a slow Ken Burns pan across the scene
- **Three stats** — Might, Magic, and Mischief (it's a family game)
- **d20 rolls** — classic dice mechanics, displayed with a satisfying SVG die
- **Inventory with stat bonuses** — find a magic sword, actually get +1 Might
- **Real-time multi-device sync** — everyone at the table can follow along via SSE

![Session header with party avatars](docs/session-header-party.png)

![AI narration panel](docs/narration-panel.png)

![Action choices and d20 result](docs/turn-history-card.png)

![Inventory panel with stat bonus item](docs/inventory-panel.png)

### Your Party

![Assemble your party screen](docs/assemble-party.png)

- **Custom hero creation** — name, species, class, quirk, and auto-generated AI portrait
- **Hero library** — import characters from previous adventures
- **HP tracking** — fail a roll, take damage; the stakes are real (ish)

![Create new hero form](docs/create-hero-form.png)

Every hero gets a generated portrait and carries their quirk into the story:

![Character popup - Pundemic](docs/character-popup-pundemic.png) ![Character popup - Mambadelic](docs/character-popup-mambadelic.png)

### Between Sessions

![Recap mode selection](docs/recap-mode-select.png)

- **TLDR mode** — AI summarises the whole adventure in 3 sentences for latecomers
- **Movie mode** — animated slideshow of every scene, with Ken Burns effect and pause/play controls. Click any image for fullscreen.

### Quality of Life
- **Savings mode** — toggle off image generation to save on API costs during dev/testing
- **Session persistence** — SQLite, so your adventure survives a server restart
- **Mobile & tablet friendly** — playable on the couch

---

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | React 19 + Vite + TailwindCSS 4 + TypeScript |
| Backend | Node.js + Express 5 + TypeScript |
| Database | SQLite via `better-sqlite3` (auto-migrated) |
| AI Narration | OpenAI GPT-4o (structured JSON responses only) |
| AI Images | DALL-E 3 (cached by prompt hash) |
| Real-time | Server-Sent Events |
| Fonts | Cinzel (display) + Lora (narrative) |

---

## Getting Started

### Prerequisites
- Node.js 20+
- An OpenAI API key

### 1. Set up environment

Create a `.env` file at the project root:

```
OPENAI_API_KEY=sk-proj-...
```

### 2. Install dependencies

```bash
npm run install:all
```

### 3. Run locally

```bash
npm run dev
```

This starts:
- Backend on `http://localhost:3001`
- Frontend on `http://localhost:5173/dnd-fam-ftw/`

The Vite dev server proxies `/dnd-fam-ftw/api/*` → backend automatically.

---

## Project Structure

```
dnd-fam-ftw/
├── backend/
│   └── src/
│       ├── index.ts              # Express API + SSE
│       ├── types.ts              # Shared types
│       └── services/
│           ├── gameEngine.ts     # Dice, damage, state
│           ├── aiDmService.ts    # GPT-4o narration
│           ├── imageService.ts   # DALL-E 3 + caching
│           └── stateService.ts   # SQLite persistence
│
├── frontend/
│   └── src/
│       ├── pages/
│       │   ├── Home.tsx          # World list
│       │   ├── CreateSession.tsx # New world form
│       │   ├── CharacterAssembly.tsx
│       │   ├── Session.tsx       # Active gameplay
│       │   └── SessionRecap.tsx  # TLDR + Movie modes
│       └── components/
│           └── game/             # Narration, ActionControls, Inventory…
│
├── deploy/                       # Nginx config + systemd service
├── docs/                         # Screenshots
├── scripts/                      # Deploy + install scripts
└── .env                          # OPENAI_API_KEY goes here
```

---

## Deployment

The app is designed to run at a subpath (`/dnd-fam-ftw/`) behind Nginx on a Linux server.

```bash
# First time setup on the server
./scripts/install-ubuntu.sh

# Push local changes to server
./scripts/sync-to-server.sh

# On the server: rebuild and restart
./scripts/re-deploy.sh
```

The backend runs as a systemd service (`node --env-file=.env dist/index.js`). See `deploy/` for the Nginx config and service file.

---

## How a Turn Works

```
Player picks action
       ↓
Backend rolls d20 + stat vs. difficulty (easy=8 / normal=12 / hard=16)
       ↓
Result sent to GPT-4o with full session context
       ↓
AI narrates outcome + suggests 3 new choices + optionally grants an item
       ↓
If a significant scene: DALL-E 3 generates image (cached by prompt hash)
       ↓
SSE broadcasts turn_complete → all connected clients update
```

The AI **cannot mutate game state directly** — it only returns structured JSON. The backend owns all mechanics.

---

## Starting a New World

![New world creation form](docs/create-world.png)

Pick a difficulty, describe your world (or leave it blank for a surprise), and hit **Next: Assemble Heroes**.

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

[Beerware License](LICENSE) — if you like it, buy me a beer someday.
