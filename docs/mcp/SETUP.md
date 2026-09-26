# Playing through an AI assistant (MCP pilot)

The backend has a Streamable HTTP MCP endpoint at `/mcp`. An AI assistant such as Claude Code, Codex, or Cursor can connect to it with a personal access token and use the realm's adventures. The server stays the Dungeon Master: the assistant passes along what the player wants to do and shows the story that comes back.

Status: invite-only pilot. Tools: list, read, preview and confirm turns, wait for results, ask the DM, start adventures (text-only or pictures on request), wrap up, end, or continue them, and show or paint scene pictures on request. Reference: [TOOLS.md](TOOLS.md). How an assistant should play: [PLAY_GUIDE.md](PLAY_GUIDE.md).

## Server setup (operator)

1. Auth must be on (`AUTH_MODE=enabled`). Set `MCP_ENABLED=true`, and optionally `MCP_PUBLIC_URL=https://<api domain>/mcp`. See [MANAGE.md](../../MANAGE.md#sign-in-and-signup-settings).
2. Allow a player into the pilot: `npm run cli -- users mcp-access <email> on`.
3. `MCP_ENABLED=false` closes the endpoint again without affecting website login. `users mcp-access <email> off` or `users mcp-revoke <email>` cut off one player.

## Getting a token (player)

1. Sign in on the website with the realm you want the assistant to use.
2. Open **Settings > AI assistants > Assistant access tokens** and create a token. Name it after the assistant or computer that will use it.
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

The pilot has no OAuth: do not run `codex mcp login` or a client's "Authenticate" flow. The token must be in the environment of the process that starts the client (for example `export DM_MCP_TOKEN=...` in the shell profile, then restart the client or IDE). If the client does not send it, the server answers 401 and some clients then look for OAuth discovery, which returns 404.

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
- Every request checks the token digest, expiry, revocation, the user's pilot access, and current membership of the token's realm. Website cookies are ignored on `/mcp`, and tokens do not work on website routes.
- Tools only see adventures in the token's realm. Results use an explicit player-facing allowlist: no DM Prep, adventure plans, riddle answers, prompts, or image URLs.
- 120 requests per minute per token. Paid tools also count against the realm's daily usage budget and `MCP_DAILY_PAID_CALLS_PER_TOKEN` (default 200 per token per UTC day). Each tool call logs token, user, tool, adventure, outcome, and duration, never action text.
- Adventures created through MCP never paint pictures by themselves (image policy `off`, or `on_demand` when asked). Adventures started on the website keep their own setting. Pictures are sent inline (max 1 MiB) only by `get_scene_image` / `generate_scene_image`; tool results never contain image URLs.
- Story text is sent to the assistant's model provider when a tool returns it.

## Client matrix

| Client | Version | Token setup | Read tools | Play (create, preview, confirm) |
| --- | --- | --- | --- | --- |
| Claude Code | not yet tested | | | |
| Codex CLI | 0.157.0 | `http_headers` in `~/.codex/config.toml` works; `bearer_token_env_var` reported the variable unset even when exported in the same tmux pane (unresolved) | works (2026-09-26) | preview, confirm, and Esc to stop the Undo window work (2026-09-26) |
| Cursor | not yet tested | | | |
