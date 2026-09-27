# 🐉 AI DM - Family D&D Night, Powered by AI

> *"Roll for initiative. The DM never sleeps, never gets tired, and always has a pun ready."*

A family-friendly story game for short, hilarious evenings. You pick heroes, the AI Dungeon Master narrates, and you say what your hero tries in your own words. The rules are a simplified, D&D-inspired set (three stats, a d20, HP and rescues): no prep, no rulebook, no DM experience, no physical dice.

![A scene with narration and the action box](docs/story-scene.png)

**Jump to:** [Run it locally](#run-it-locally) · [How to play](#how-to-play) · [Play from your AI assistant](#play-from-your-ai-assistant) · [Contribute](CONTRIBUTING.md) · [Operate](docs/operations.md) · [All docs](#documentation)

---

## What you get

- **One-evening adventures by default** : a clear goal, a finale, and an epilogue about what every hero did. Long-lived worlds with chapters are there when you want them.
- **Type anything** : "offer the troll a sandwich" is a valid strategy. Stuck? **Give me ideas** suggests a few. Curious? **Ask the DM** answers without using your turn.
- **Real stakes, kind rules** : the game rolls a d20 for you, heroes can fall, and the party gets rescued a number of times that depends on difficulty.
- **Heroes that stick** : custom heroes with generated portraits, quirks the DM takes seriously, and a hero library to bring them into the next adventure.
- **Pictures and sound, optional** : generated scene art, music that turns tense in a fight, sound effects and a narration voice, all switchable per adventure or in Settings.
- **Play together** : every phone and tablet at the table follows along live, and you can invite family into your realm by email.
- **Other ways to play** : hands-free car mode with voice, recap and movie mode for latecomers, and a hidden retro terminal for the most hoodie-driven hackers (it remembers the old code).

More screenshots: [docs/screenshots.md](docs/screenshots.md).

---

## How to play

Read the scene and check whose turn it is. Type what that hero tries and tap **Unleash**. The game previews the action, rolls when needed, and the DM tells you what happens. Then the next hero goes.

| Stat | Good for |
|---|---|
| **Might** | Hitting things, breaking things, lifting things, being a goblin wrecking ball |
| **Magic** | Spells, healing, arcane shenanigans, summoning things that immediately cause problems |
| **Mischief** | Stealing, lying, sneaking, persuading the dragon that you're actually the tax collector |

The full player guide is in the app (**How to Play**); the exact mechanics are in [GAME_ENGINE_RULES.md](GAME_ENGINE_RULES.md).

---

## Play from your AI assistant

You can also play from an AI assistant such as Claude, Codex or Cursor over MCP. The server stays the Dungeon Master: the assistant previews and confirms your actions with you. This is an opt-in pilot; whether it is available, and whether you sign in from the assistant (OAuth) or paste a personal access token, depends on the instance. Setup: [docs/mcp/SETUP.md](docs/mcp/SETUP.md).

![Starting an adventure from the Codex desktop app over MCP](docs/CodexMCP.png)

---

## Run it locally

You need Node 24, git, and an API key for OpenAI or another OpenAI-compatible provider.

```bash
git clone https://github.com/erikzaadi/dnd-fam-ftw.git
cd dnd-fam-ftw
nvm use                 # optional: picks Node 24 from .nvmrc
cp .env.example .env    # then set OPENAI_API_KEY in .env
npm run install:all
npm run dev
```

Open **http://localhost:5173/**. You should see the home screen with **GET ME ROLLIN'**, a guided first adventure. The backend runs on `http://localhost:3001`; the frontend proxies `/api/*` to it.

Playing calls your AI provider and costs money (images most of all). Switch images off in the ⚙ menu of an adventure to keep it cheap. Auth is off by default, so everything runs in one local realm with no login.

Other providers (OpenRouter, a LocalAI-compatible server), model choices, auth and every other setting: [docs/configuration.md](docs/configuration.md).

---

## Documentation

| For | Read |
|---|---|
| Contributors | [CONTRIBUTING.md](CONTRIBUTING.md), [frontend/README.md](frontend/README.md), [CLAUDE.md](CLAUDE.md) (conventions, AI assistant instructions) |
| How it works | [docs/architecture.md](docs/architecture.md), [MULTI_AGENT_WORKFLOW.md](MULTI_AGENT_WORKFLOW.md), [GAME_ENGINE_RULES.md](GAME_ENGINE_RULES.md) |
| Running an instance | [docs/configuration.md](docs/configuration.md), [docs/operations.md](docs/operations.md), [MANAGE.md](MANAGE.md) (CLI), [docs/ai-evaluation.md](docs/ai-evaluation.md) |
| Game masters | [DM_PREP.md](DM_PREP.md): notes that steer the story |
| AI assistants | [docs/mcp/SETUP.md](docs/mcp/SETUP.md), [docs/mcp/PLAY_GUIDE.md](docs/mcp/PLAY_GUIDE.md) |
| Design and history | [PRODUCT.md](PRODUCT.md), [how-it-all-started.md](how-it-all-started.md) (historical), [CREDITS.md](CREDITS.md) |

---

## Tips

- The AI takes the `quirk` field seriously. A character who *"has strong opinions about cheese"* will absolutely have those opinions come up at the worst possible moment.
- Images off is your friend during testing. Generated images are not cheap.
- The TLDR recap is great for the family member who missed last week's session and claims they "totally remember what happened."

*Built with love, bad puns, and an irresponsible number of API calls.*

---

## License

Copyright (C) 2026 Erik Zaadi

This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version (`AGPL-3.0-or-later`). It is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See [LICENSE](./LICENSE) for the full text.

If you run a modified version of this software as a network service, you must make the source code of your modifications available to its users.

Bundled music, sound effects and images have their own terms: see [CREDITS.md](CREDITS.md).
