# Management CLI

The reference for the management CLI (`npm run cli`, `./dnd-fam-ftw-cli`, and `./dnd-fam-ftw-prod-cli` on production).

Other operator docs:

- [docs/configuration.md](docs/configuration.md): every environment variable, AI providers and models, auth, sign-in, usage limits.
- [docs/operations.md](docs/operations.md): self-hosting requirements, the AWS deployment, production scripts, CI/CD, releases, rollback and backups.
- [docs/ai-evaluation.md](docs/ai-evaluation.md): paid model and turn-strategy evaluation scripts.
- [docs/architecture.md](docs/architecture.md): how a turn works, AI calls, ideas and Ask the DM, SSE events.

Contents: [Local development CLI](#local-development-cli) · [users](#users) · [namespaces](#namespaces) · [sessions](#sessions) · [metrics](#metrics) · [invite-requests](#invite-requests) · [limit-requests](#limit-requests) · [mcp-requests](#mcp-requests) · [mcp-grants](#mcp-grants) · [donations](#donations) · [email-outbox](#email-outbox)

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

Manage registered users. Each user gets their own primary namespace on creation and owns it. Users who joined through an invitation have the invited realm as primary and own no realm.

```bash
./dnd-fam-ftw-cli users list                                # list all users and their accessible namespaces
./dnd-fam-ftw-cli users list --json
./dnd-fam-ftw-cli users add <email> [name]                  # create user + namespace
./dnd-fam-ftw-cli users remove <email>                      # delete user and the realms they own alone
./dnd-fam-ftw-cli users remove <email> --with-adventures   # ...also deleting those realms' adventures and images
./dnd-fam-ftw-cli users set-primary <email> <namespaceId>   # change a user's primary namespace
./dnd-fam-ftw-cli users mcp-access <email> [on|off|default] # show or change a user's MCP access override
./dnd-fam-ftw-cli users mcp-list [--json]                   # users with an on/off override and their active token counts
./dnd-fam-ftw-cli users mcp-revoke <email>                  # revoke all of a user's MCP access tokens and connected assistants
```

`users remove` refuses while the user owns a realm that has other members (transfer it first with `namespaces set-owner`). Realms the user owns alone are deleted with the account; if they still have adventures, the command asks for `--with-adventures`. Shared realms, and other members' access, are never deleted because one user goes away. Pending invitations the user sent are cancelled.

MCP access lets a user create personal access tokens under **Settings > AI assistants** for playing through an AI assistant (see [docs/mcp/SETUP.md](docs/mcp/SETUP.md)). It only matters when `MCP_ENABLED=true`. Access is decided per realm: members of a realm whose tier is in `MCP_DEFAULT_TIERS` (default: `unlimited`, the Founding Realms) have it unless their override is `off`; anyone else needs `on`. `default` removes the override. When access ends (override `off`, or the realm drops to another tier), the user's tokens for that realm stop working on the next request; they stay listed so the user can still revoke them. Removing a user deletes their tokens.

### namespaces

Manage namespaces (isolated session spaces, "realms" in the UI). Users can be granted access to additional namespaces beyond their primary one. Membership is the only source of access: the primary namespace is just the default realm at sign-in.

Every real namespace has exactly one **owner**: the account responsible for its usage (provider usage is attributed to the owner, and Ko-fi donations upgrade only a realm the donor owns). The owner is always a member and cannot be removed or deleted while owning the realm. New accounts own their private realm; `local` (auth disabled) has no owner. A realm without a valid owner gets no paid AI work (players see "This realm is being set up").

```bash
./dnd-fam-ftw-cli namespaces list                                         # list all with user/session counts and limits
./dnd-fam-ftw-cli namespaces list --json
./dnd-fam-ftw-cli namespaces create <name>                                # create a standalone namespace
./dnd-fam-ftw-cli namespaces rename <id> <new-name>
./dnd-fam-ftw-cli namespaces delete <id>                                  # only works with no members and no sessions
./dnd-fam-ftw-cli namespaces sessions <id>                                # list sessions in a namespace
./dnd-fam-ftw-cli namespaces sessions <id> --json
./dnd-fam-ftw-cli namespaces assign-session <sessionId> <namespaceId>    # move a session to another namespace
./dnd-fam-ftw-cli namespaces add-user <namespaceId> <email>              # grant user access to a namespace
./dnd-fam-ftw-cli namespaces remove-user <namespaceId> <email>           # revoke access (not the owner); moves their primary realm
./dnd-fam-ftw-cli namespaces owners                                       # ownership report: status, members, proposed owner
./dnd-fam-ftw-cli namespaces owners --apply                               # set the proposed owners (sole member with it as primary)
./dnd-fam-ftw-cli namespaces owners --json
./dnd-fam-ftw-cli namespaces set-owner <namespaceId> <email>             # set or transfer the owner (must be a member)
./dnd-fam-ftw-cli namespaces set-limits <id>                              # show current limits
./dnd-fam-ftw-cli namespaces set-limits <id> --max-sessions 5            # cap number of sessions
./dnd-fam-ftw-cli namespaces set-limits <id> --max-turns 100             # cap turns per session
./dnd-fam-ftw-cli namespaces set-limits <id> --max-sessions null         # back to the tier default
./dnd-fam-ftw-cli namespaces tier <id>                                   # show tier and effective limits
./dnd-fam-ftw-cli namespaces tier <id> supporter                         # change tier: free | supporter | unlimited
```

`remove-user` takes effect on the member's next request, revokes their assistant tokens and pending invitations for that realm, and moves their primary realm to another membership (one they own first). With no memberships left they see a "no realms" screen after sign-in.

**Owners of existing realms.** A one-time migration on the first start after upgrading gives every realm with members an owner: the oldest member who has it as primary realm (normally the account it was created for), otherwise its oldest member. A realm with no members stays ownerless until someone is added: the first member becomes the owner (so `namespaces create` then `namespaces add-user` just works). Check the result with `namespaces owners` and change any choice with `namespaces set-owner <id> <email>`. The backend warns at startup if a realm with members still has no valid owner. `set-owner` on a realm that already has an owner is a transfer: it cancels the realm's pending invitations so the new owner decides on further members.

Every namespace has a usage tier: `free` ("Adventurer", self-service signups), `supporter` ("Patron of the Realm"), or `unlimited` ("Founding Realm", all existing and CLI-created namespaces, and `local`). The tier sets daily text credits (AI text calls, plus one per started 1000 TTS characters), daily pictures, max sessions, and max turns per session. `set-limits` values override the tier's session/turn limits; `NULL` means "use the tier default".

| Tier | Text credits/day | Pictures/day | Sessions | Turns/session |
| --- | --- | --- | --- | --- |
| `free` | 150 | 20 | 3 | 100 |
| `supporter` | 600 | 150 | 15 | unlimited |
| `unlimited` | unlimited | unlimited | unlimited | unlimited |

Override the defaults with `USAGE_TIER_LIMITS` (JSON, e.g. `{"free":{"picturesPerDay":30}}`). Days reset at 00:00 UTC. When the pictures run out, turns continue without images; when text credits run out, new paid requests get HTTP 429 `limit_reached`. `DAILY_SPEND_LIMIT_USD` (unset = off) is a global estimated-spend limit: at the limit, pictures stop for `free`/`supporter` and new signups pause; at twice the limit, text stops for `free`. `unlimited` namespaces are never limited.

### sessions

Dev tools for inspecting and resetting session data.

```bash
./dnd-fam-ftw-cli sessions list                                              # print all sessions, characters, inventory, turn history
./dnd-fam-ftw-cli sessions list --json
./dnd-fam-ftw-cli sessions nuke                                              # delete all sessions and their data
./dnd-fam-ftw-cli sessions seed                                              # seed 10 example sessions (idempotent; session 10 is paused mid-riddle)
./dnd-fam-ftw-cli sessions export [--session <id>] [--namespace <id>] [--output <file.json>]   # export sessions to JSON
./dnd-fam-ftw-cli sessions import <file.json> [--namespace-id <id>] [--allow-drop]   # import sessions from JSON
```

Export and import (`backend/src/archive/adventureArchive.ts`):

- **What travels:** every column of the adventure, its heroes, their items, its turns, their suggestions and its riddles. Export reads one consistent snapshot and writes `version: 2`; import also reads `version: 1` files (no riddles) and reports the columns it filled with database defaults.
- **Images are references only.** Picture URLs and storage keys are copied, not the files. On another machine an imported adventure has no pictures. Deleting an adventure keeps any picture another adventure still uses, so an imported copy and its original never delete each other's pictures.
- **Ids:** adventure, hero and riddle ids are kept, and replaced when they already exist (importing into the same database). Every reference follows: the active hero, bound items, turns, ideas, riddles, and hero ids inside hit point, buff, encounter and lifecycle data. Turn, item and suggestion ids are always new. Operation ids on turns are cleared.
- **Realm:** `--namespace-id` imports into that realm; otherwise the archived realm must exist on this server.
- **Refused:** other export versions, references to heroes or turns missing from the adventure, and fields this server does not know. `--allow-drop` imports anyway and lists the dropped fields. A failed import writes nothing.

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
./dnd-fam-ftw-cli metrics usage --by-owner                      # group by realm owner instead of namespace
./dnd-fam-ftw-cli metrics usage --owner-user-id <userId> --namespace <id>
```

Each provider call records the acting user and, separately, the realm owner at the moment the request began (background work keeps that owner; an ownership transfer affects later requests only). Calls from before owner tracking existed are shown as `(before owner tracking)`; the report prints how many fall in the range and the cutover time. Namespace and total figures still include them.

Member invitation counts per day (sent, failed, accepted, new accounts), without email addresses:

```bash
./dnd-fam-ftw-cli metrics invites
./dnd-fam-ftw-cli metrics invites --since 2026-09-01 --json
```

The weekly metrics workflow tracks the timestamp of its last run in SSM and passes it as `--since` to `metrics` and `metrics narration`, so all weekly figures (new sessions, new narration failures, most active namespace, active users) are computed directly from real row timestamps rather than diffing snapshots.

### invite-requests

View and manage invite requests from people without an account (Google or email sign-in) while `SIGNUP_MODE=invite_only`, or when open signup is paused or at its daily cap. Each new request emails `SIGNUP_NOTIFY_EMAIL` (default `ADMIN_EMAIL`) when email is configured.

```bash
./dnd-fam-ftw-cli invite-requests list
./dnd-fam-ftw-cli invite-requests list --json
./dnd-fam-ftw-cli invite-requests approve <email> [--namespace <name>]   # approve request, creates user + namespace
./dnd-fam-ftw-cli invite-requests clear                                   # delete all requests
```

### limit-requests

"Ask for more" requests from limited (`free`/`supporter`) groups, sent from **Your Realm** in Settings with an optional note. One open request per group, at most 3 per day; each new request emails `SIGNUP_NOTIFY_EMAIL` (default `ADMIN_EMAIL`). Approving sets the group's tier (with no expiry). With `KOFI_VERIFICATION_TOKEN` set, a Ko-fi payment from a player's sign-in email closes their open request automatically (see [donations](#donations)); otherwise match a donation to a request by hand and approve it.

```bash
./dnd-fam-ftw-cli limit-requests list                      # pending requests
./dnd-fam-ftw-cli limit-requests list --status approved --json
./dnd-fam-ftw-cli limit-requests approve <id>              # tier -> supporter
./dnd-fam-ftw-cli limit-requests approve <id> --tier unlimited
./dnd-fam-ftw-cli limit-requests deny <id>
```

### mcp-requests

"Request assistant access" requests from players without MCP access (any tier, `free` included), sent from **Settings > AI assistants** with an optional note. Only shown while `MCP_ENABLED=true`. One open request per player, at most 3 per 30 days; each new request emails `SIGNUP_NOTIFY_EMAIL` (default `ADMIN_EMAIL`). Approving sets the player's `users mcp-access` override to `on` and emails them (when email is configured). Denying closes the request quietly; the player can ask again within the cap. Players whose override is `off` cannot ask. `users mcp-access <email> on|off` also closes an open request.

```bash
./dnd-fam-ftw-cli mcp-requests list                        # pending requests
./dnd-fam-ftw-cli mcp-requests list --status approved --json
./dnd-fam-ftw-cli mcp-requests approve <id>                # override -> on, player is emailed
./dnd-fam-ftw-cli mcp-requests deny <id>
```

### mcp-grants

Assistants connected through OAuth sign-in (`MCP_OAUTH_ENABLED`). Each grant is one approved sign-in: a user, one realm, one app, and the permissions ticked on the consent page, for 30 days. Revoking ends it on the next request; players can also disconnect from **Settings > AI assistants**. Access still follows `users mcp-access` and the realm tier, like personal tokens.

```bash
./dnd-fam-ftw-cli mcp-grants list                          # newest first, with app, realm, state, last use
./dnd-fam-ftw-cli mcp-grants list --email someone@example.com --json
./dnd-fam-ftw-cli mcp-grants revoke <id>
```

### donations

Ko-fi payments received by `POST /webhooks/kofi` (enabled by `KOFI_VERIFICATION_TOKEN`). Every payment type (donation, subscription, shop order, commission) counts. When the Ko-fi email matches a user's sign-in email (canonical match) and that user owns exactly one realm, that realm becomes `supporter` for 90 days, extended from the current expiry when it is still a supporter, and any open "ask for more" request is approved. After the expiry the group falls back to `free` on its own. `unlimited` groups and supporters set by hand (no expiry) are left alone. Payments with no matching account are recorded as `no_account`, and payments from a user who owns no realm (for example an invited player) or several as `needs_review`; both need a manual `namespaces tier <id> supporter`. Each payment emails `SIGNUP_NOTIFY_EMAIL`; webhook retries are ignored by Ko-fi transaction id. `namespaces tier` always clears a donation expiry.

```bash
./dnd-fam-ftw-cli donations list                          # newest 200 payments
./dnd-fam-ftw-cli donations list --outcome no_account     # need a manual tier change
./dnd-fam-ftw-cli donations list --outcome needs_review   # donor owns no realm (or several): pick one by hand
./dnd-fam-ftw-cli donations list --since 2026-09-01 --json
```

Ko-fi setup: Ko-fi > Settings > API > Webhooks, set the URL to `https://<api domain>/webhooks/kofi`, copy the verification token into the `KOFI_VERIFICATION_TOKEN` SSM parameter (SecureString), redeploy the backend, then use "Send Single Donation Test" (an unknown test email shows up as `no_account`).

### email-outbox

Operator notification emails (new signups, invite requests, and "ask for more" requests, sent to `SIGNUP_NOTIFY_EMAIL`, default `ADMIN_EMAIL`; only queued when email is configured). The backend sends them right after signup and retries failures every 3 minutes with backoff, up to 10 attempts. Sign-in codes are sent directly and never stored.

```bash
./dnd-fam-ftw-cli email-outbox list
./dnd-fam-ftw-cli email-outbox list --status failed --json
./dnd-fam-ftw-cli email-outbox retry <id>                                # requeue a failed notification
./dnd-fam-ftw-cli email-outbox send-test you@example.com                  # send a test email now
```

---

## Moved sections

These sections used to live here; the headings stay so old links keep working.

### Sign-in and signup settings

Moved to [docs/configuration.md](docs/configuration.md#sign-in-and-signup-settings).

### Live preview-choices evaluation (paid)

Moved to [docs/ai-evaluation.md](docs/ai-evaluation.md#preview-choices-evaluation-paid).

### Preview-tier request settings

Moved to [docs/configuration.md](docs/configuration.md#preview-tier-request-settings).

### Ideas on demand

Moved to [docs/architecture.md](docs/architecture.md#ideas-and-ask-the-dm).

### Turn strategy

Moved to [docs/configuration.md](docs/configuration.md#turn-strategy); the comparison runner is in [docs/ai-evaluation.md](docs/ai-evaluation.md#turn-strategy-comparison-paid).

### Production management (AWS)

Moved to [docs/operations.md](docs/operations.md#production-management-scripts-aws), including the one-time setup scripts, email sign-in (SES) setup, CI/CD, backend releases and rollback, and inspecting a backup locally.
