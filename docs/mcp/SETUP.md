# Playing through an AI assistant (MCP)

The backend has a Streamable HTTP MCP endpoint at `/mcp`. An AI assistant such as Claude Code, Codex, or Cursor can connect to it by signing in (OAuth, when the server has it on) or with a personal access token, and use the realm's adventures. The server stays the Dungeon Master: the assistant passes along what the player wants to do and shows the story that comes back.

Status: opt-in pilot. Founding Realms (or the tiers in `MCP_DEFAULT_TIERS`) have access; anyone else can request it from Settings. Tools: list, read, preview and confirm turns, wait for results, ask the DM, start adventures (text-only or pictures on request), wrap up, end, or continue them, and show or paint scene pictures on request. Reference: [TOOLS.md](TOOLS.md). How an assistant should play: [PLAY_GUIDE.md](PLAY_GUIDE.md).

## Server setup (operator)

1. Auth must be on (`AUTH_MODE=enabled`). Set `MCP_ENABLED=true`, and optionally `MCP_PUBLIC_URL=https://<api domain>/mcp`. See [MANAGE.md](../../MANAGE.md#sign-in-and-signup-settings).
2. Choose who gets access. Members of realms whose tier is in `MCP_DEFAULT_TIERS` (default `unlimited`, the Founding Realms) have it automatically. Anyone else can press **Request access** under **Settings > AI assistants**; approve with `npm run cli -- mcp-requests approve <id>` (you get an email per request), or grant directly with `npm run cli -- users mcp-access <email> on`.
3. `MCP_ENABLED=false` closes the endpoint again without affecting website login. `users mcp-access <email> off` or `users mcp-revoke <email>` cut off one player (tokens and connected assistants). A realm that drops to a tier outside `MCP_DEFAULT_TIERS` loses access for members without an `on` override.
4. Optional, sign-in for assistants: set `MCP_OAUTH_ENABLED=true`. It needs `MCP_PUBLIC_URL` at the origin root (`https://<api domain>/mcp`) and `FRONTEND_URL` (the consent page lives on the website); startup fails otherwise. `MCP_OAUTH_ENABLED=false` stops sign-in, token refresh, and every OAuth access token right away, while personal access tokens and disconnecting keep working. `npm run cli -- mcp-grants list` shows connected assistants; `mcp-grants revoke <id>` ends one.

## Connect with sign-in (player, when the server has OAuth on)

Add the server URL to your assistant without any token. When the assistant connects, your browser opens the realm's website: sign in if needed, choose the realm and what the assistant may do, and press **Allow**. The browser returns to the assistant and you can play.

- Claude Code: `claude mcp add --transport http dnd-fam-ftw https://<api domain>/mcp`, then run `/mcp` in Claude Code and choose to authenticate `dnd-fam-ftw`.
- Codex: add the server to `~/.codex/config.toml` with just `url = "https://<api domain>/mcp"`, then run `codex mcp login dnd-fam-ftw`.
- Cursor: add the server to `.cursor/mcp.json` with just `"url"`, then press **Connect** (or **Needs login**) next to it in Cursor's MCP settings.

The consent page says whether the app is **verified** (it published its identity at an https address) or **unverified** (it registered itself and chose its own name). Only allow an unverified app if you just started connecting from your own assistant.

A connection covers one realm, lasts 30 days, and the assistant renews its short-lived access by itself. See and disconnect connected assistants under **Settings > AI assistants > Assistant access tokens > Connected assistants**. To give the assistant more permissions later, disconnect and connect again.

If sign-in does not work in your assistant, use a personal access token below.

## Getting a personal access token (player)

1. Sign in on the website with the realm you want the assistant to use.
2. Open **Settings > AI assistants > Assistant access tokens** and create a token. Name it after the assistant or computer that will use it. No access yet? Press **Request access** there; you get an email when it is turned on.
3. Copy the token. It is shown once. Store it in an environment variable, for example `DM_MCP_TOKEN`, in your shell profile or a password manager integration.

A token covers one realm (the one you were signed in to), lasts 30 days, and can be replaced or revoked from the same page. At most 5 tokens can be active at a time. Never paste a token into a chat, a URL, a shared config file, or a commit.

## Connecting a client

Replace the URL with the one shown on the Access tokens page. HTTPS is required outside local development.

Claude Code:

```bash
claude mcp add --transport http dnd-fam-ftw https://<api domain>/mcp --header "Authorization: Bearer $DM_MCP_TOKEN"
```

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.dnd-fam-ftw]
url = "https://<api domain>/mcp"
bearer_token_env_var = "DM_MCP_TOKEN"
```

If Codex says `DM_MCP_TOKEN` is not set (it only sees variables from the environment that started it), putting the header in directly is often simpler. The token then lives in this file, so keep `~/.codex/config.toml` private and never commit or share it:

```toml
[mcp_servers.dnd-fam-ftw]
url = "https://<api domain>/mcp"
http_headers = { Authorization = "Bearer dndmcp_..." }
```

Cursor (`.cursor/mcp.json`, keep it out of shared repositories):

```json
{
  "mcpServers": {
    "dnd-fam-ftw": {
      "url": "https://<api domain>/mcp",
      "headers": { "Authorization": "Bearer ${env:DM_MCP_TOKEN}" }
    }
  }
}
```

With a token, do not run `codex mcp login` or a client's "Authenticate" flow: the token is the credential. The token must be in the environment of the process that starts the client (for example `export DM_MCP_TOKEN=...` in the shell profile, then restart the client or IDE). If the client does not send it, the server answers 401; with OAuth on, some clients then offer to sign in instead, which also works.

Then ask the assistant something like "List my adventures", "Where did we leave off in Troll Bridge?", or "Start a silly forest adventure for two heroes".

## Optional: play guide for your assistant

Play works without extra setup: the server sends its rules when the client connects. For more consistent play:

- Claude Code (and other hosts with skills): copy `integrations/skills/dnd-adventure/` into your skills folder, for example `~/.claude/skills/dnd-adventure/`.
- Cursor: copy `integrations/cursor/dnd-adventure.mdc` into `.cursor/rules/` of a local project.
- Hosts that support MCP prompts also get `start_adventure` and `resume_adventure`.

Nothing here disables your client's own tool approval prompts; keep them as you like.

## Undo window

Like typed actions on the website, a clean action (no warnings, gear, or questions from the DM) is shown in a line and sent after a few seconds: press Esc in your assistant to stop it. Anything else waits for your OK. On the Access tokens page, **Undo window** lets you untick an adventure to be asked before every action there. It only affects your own assistant play.

The Esc stop depends on the client dropping the tool call when you interrupt it. If your client asks you to approve each tool call, that approval prompt is your confirmation instead.

## Local development

With `AUTH_MODE=enabled`, `MCP_ENABLED=true`, and `npm run dev`, point the client at `http://localhost:3001/mcp` (backend directly) or `http://localhost:5173/api/mcp` (through the Vite proxy).

Quick check without a client:

```bash
curl -s http://localhost:3001/mcp \
  -H "Authorization: Bearer $DM_MCP_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_adventures","arguments":{}}}'
```

## How it works

- Transport: stateless Streamable HTTP with JSON responses (`@modelcontextprotocol/sdk` 1.30.1). Only `POST /mcp`; no MCP session IDs.
- Every request checks the token digest, expiry, revocation, the user's MCP access for that realm (override or realm tier), and current membership of the token's realm. OAuth access tokens (`dndoat_`, 15 minutes) are also checked for audience (this server's `/mcp`) and the `MCP_OAUTH_ENABLED` switch. Website cookies are ignored on `/mcp`, and tokens do not work on website routes.
- OAuth (when on): discovery at `/.well-known/oauth-protected-resource/mcp` and `/.well-known/oauth-authorization-server`; endpoints `/oauth/authorize`, `/oauth/token`, `/oauth/register`, `/oauth/revoke`. Public clients only, PKCE S256 required, `iss` on every authorization response, rotating refresh tokens (reuse revokes the connection), Client ID Metadata Documents fetched without reaching internal addresses, and Dynamic Client Registration rate limited. Design: `next-up-instructions/mcp-oauth-plan.md`.
- Tools only see adventures in the token's realm. Results use an explicit player-facing allowlist: no DM Prep, adventure plans, riddle answers, prompts, or image URLs.
- 120 requests per minute per token or connected assistant. Paid tools also count against the realm's daily usage budget and `MCP_DAILY_PAID_CALLS_PER_TOKEN` (default 200 per token or connected assistant per UTC day). Each tool call logs the grant, user, tool, adventure, outcome, and duration, never action text.
- Adventures created through MCP never paint pictures by themselves (image policy `off`, or `on_demand` when asked). Adventures started on the website keep their own setting. Pictures are sent inline (max 1 MiB) only by `get_scene_image` / `generate_scene_image`; tool results never contain image URLs.
- Story text is sent to the assistant's model provider when a tool returns it.

## Client matrix

| Client | Version | Token setup | Sign-in (OAuth) | Read tools | Play (create, preview, confirm) |
| --- | --- | --- | --- | --- | --- |
| Claude Code | not yet tested | | not yet tested | | |
| Codex CLI | 0.157.0 | `http_headers` with a direct bearer works; `bearer_token_env_var` reported the variable unset once (likely an environment setup issue, not rechecked) | not yet tested | works (2026-09-26) | preview, confirm, and Esc to stop the Undo window work (2026-09-26) |
| Cursor | not yet tested | | not yet tested | | |
