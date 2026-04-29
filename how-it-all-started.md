# 🧠 AI Dungeon Master Web App - Engineering Memory

## 📌 Project Overview

We are building a **self-hosted, family-friendly D&D-style web app**.

This is **NOT a full VTT (Roll20 clone)**.  
This is a **lightweight, story-driven, AI-powered adventure engine**.

### Core Philosophy

- Backend owns **game truth**
- AI owns **storytelling and flavor**
- UI is **simple, fun, and fast**
- Keep everything **family-friendly, humorous, and accessible**
- Optimize for **short sessions (60–90 minutes)**

---

## 🏗️ Tech Stack

### Frontend
- React
- TailwindCSS
- Served as static files via nginx

### Backend
- Node.js (TypeScript preferred)
- REST API
- Runs as a system service (e.g. systemd/upstart)

### Database
- SQLite (single file, local disk)

### AI Integration
- OpenAI API (Responses API)
- Called ONLY from backend
- API key stored in environment variable

---

## 🔐 Security Rules

- NEVER expose OpenAI API key to frontend
- ALL AI calls must go through backend
- Validate all incoming requests

---

## 🧱 Architecture Principles

### 1. Backend is the Source of Truth

Backend must control:
- HP
- inventory
- quests
- scene transitions
- dice rolls
- valid actions

AI MUST NOT:
- mutate state
- invent stats
- override mechanics

---

### 2. AI is a Performer, Not a Game Engine

AI responsibilities:
- narration
- NPC dialogue
- humor
- presenting choices
- suggesting image prompts

---

### 3. Structured Communication with AI

ALL AI responses MUST be JSON.

NEVER rely on freeform text.

---

## 🔄 Game Loop

1. Player submits action
2. Backend validates + resolves mechanics
3. Backend sends structured state to AI
4. AI returns narration + choices
5. Backend updates state
6. Backend decides on image generation
7. Frontend renders result

---

## 📦 Core Data Models

### Character

```json
{
  "id": "uuid",
  "name": "string",
  "class": "string",
  "species": "string",
  "quirk": "string",
  "hp": 10,
  "max_hp": 10,
  "stats": {
    "might": 1,
    "magic": 2,
    "mischief": 3
  },
  "inventory": ["string"]
}
```

---

### Session State (simplified)

```json
{
  "scene": "string",
  "sceneId": "string",
  "turn": 1,
  "party": [],
  "npcs": [],
  "quests": [],
  "lastChoices": [],
  "tone": "funny family fantasy"
}
```

---

### Turn Result

```json
{
  "narration": "string",
  "choices": [
    { "id": "string", "label": "string" }
  ],
  "imagePrompt": "string | null",
  "imageSuggested": true
}
```

---

## 🎮 Gameplay Rules (Simplified)

### Stats
Use ONLY 3 stats:
- might (physical)
- magic (intellect/spells)
- mischief (stealth/social/chaos)

### Dice
- Use simple d20 system
- success = roll + stat >= difficulty

### Difficulty Levels
- easy: 8
- normal: 12
- hard: 16

---

## 🤖 AI Prompt Contract

### System Prompt

The AI must be instructed:

- You are a **funny, family-friendly fantasy DM**
- Keep narration **short (2–4 sentences)**
- Always return **exactly 3 suggested actions**
- Keep tone **whimsical, safe, playful**
- Do NOT invent or modify game state
- Respect backend-provided outcomes
- Only suggest image prompts for:
  - new scenes
  - major events
  - very funny moments

---

### Input to AI

Backend sends:

```json
{
  "scene": "...",
  "party": [...],
  "npcs": [...],
  "actionAttempt": "...",
  "actionResult": {
    "success": true,
    "roll": 14,
    "statUsed": "mischief"
  },
  "recentHistory": ["..."],
  "tone": "funny family fantasy"
}
```

---

### Expected AI Output (STRICT)

```json
{
  "narration": "string",
  "choices": [
    "string",
    "string",
    "string"
  ],
  "imagePrompt": "string | null",
  "imageSuggested": true
}
```

---

## 🖼️ Image Strategy

DO NOT generate images every turn.

### Generate ONLY when:
- new scene
- boss encounter
- critical fail / success
- explicitly requested

### Otherwise:
- reuse previous scene image

### Cache images by:
- sceneId
- prompt hash

---

## 🧠 Backend Modules

### gameEngine.ts
Handles:
- rules
- dice
- validation
- state mutation

---

### aiDmService.ts
Handles:
- OpenAI calls
- prompt construction
- response parsing
- JSON validation

---

### imageService.ts
Handles:
- prompt hashing
- caching
- generation triggers

---

### stateService.ts
Handles:
- SQLite persistence
- loading/saving session state

---

## 🌐 API Endpoints

### POST /api/session/create
Create new game session

### POST /api/character/create
Create character

### GET /api/session/:id
Get current state

### POST /api/session/:id/action
Submit action

### GET /api/session/:id/history
Get recent turns

---

## 🧑‍🤝‍🧑 UX Rules

- Show ONLY 3 choices at a time
- Always allow free-text action
- Keep UI minimal and readable
- Avoid complex sheets or tables
- Prioritize fun over accuracy

---

## 🚫 Explicit Non-Goals (v1)

DO NOT implement:
- full D&D ruleset
- grid maps
- initiative systems
- complex combat engine
- multiplayer sync (start single-screen)
- large inventory systems

---

## 🧪 MVP Definition

A valid MVP MUST include:

- create session
- create characters
- play through at least 1 full adventure
- AI narration working
- choices working
- state persists
- at least 1 generated image per session

---

## ⚠️ Common Pitfalls

- ❌ letting AI control game state
- ❌ overcomplicating rules
- ❌ generating images every turn
- ❌ sending full history to AI every time
- ❌ building a full RPG engine too early

---

## 🎯 Design Goal

The app should feel like:

> “A hilarious, interactive fantasy story night for the family”

NOT:

> “A complex tabletop simulator”

---

## 🧭 Future Extensions (NOT v1)

- multiplayer
- sound effects
- animations
- map view
- campaign editor
- saved NPC personalities
- voice narration

---

## ✅ Final Rule

When in doubt:

**Make it simpler, funnier, and faster.**
