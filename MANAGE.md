# Operations and Management

This document covers all management scripts for local development and production operations.

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

Manage registered users. Each user gets their own primary namespace on creation.

```bash
./dnd-fam-ftw-cli users list                        # list all users and their accessible namespaces
./dnd-fam-ftw-cli users list --json
./dnd-fam-ftw-cli users add <email> [name]          # create user + namespace
./dnd-fam-ftw-cli users remove <email>              # delete user (and their namespace if empty)
```

### namespaces

Manage namespaces (isolated session spaces). Users can be granted access to additional namespaces beyond their primary one.

```bash
./dnd-fam-ftw-cli namespaces list                                         # list all with user/session counts and limits
./dnd-fam-ftw-cli namespaces list --json
./dnd-fam-ftw-cli namespaces create <name>                                # create a standalone namespace
./dnd-fam-ftw-cli namespaces rename <id> <new-name>
./dnd-fam-ftw-cli namespaces delete <id>                                  # only works if namespace has no sessions
./dnd-fam-ftw-cli namespaces sessions <id>                                # list sessions in a namespace
./dnd-fam-ftw-cli namespaces sessions <id> --json
./dnd-fam-ftw-cli namespaces assign-session <sessionId> <namespaceId>    # move a session to another namespace
./dnd-fam-ftw-cli namespaces add-user <namespaceId> <email>              # grant user access to a namespace
./dnd-fam-ftw-cli namespaces set-limits <id>                              # show current limits
./dnd-fam-ftw-cli namespaces set-limits <id> --max-sessions 5            # cap number of sessions
./dnd-fam-ftw-cli namespaces set-limits <id> --max-turns 100             # cap turns per session
./dnd-fam-ftw-cli namespaces set-limits <id> --max-sessions null         # remove session limit
```

`NULL` limits mean unlimited (the default for new namespaces).

### sessions

Dev tools for inspecting and resetting session data.

```bash
./dnd-fam-ftw-cli sessions list             # print all sessions, characters, inventory, turn history
./dnd-fam-ftw-cli sessions list --json
./dnd-fam-ftw-cli sessions nuke             # delete all sessions and their data
./dnd-fam-ftw-cli sessions seed             # seed 5 example sessions (idempotent)
```

### metrics

Per-namespace usage stats: sessions, turns, images, avatars, LocalAI and savings mode counts.

```bash
./dnd-fam-ftw-cli metrics
./dnd-fam-ftw-cli metrics --json
```

### invite-requests

View and manage invite requests from unregistered Google users.

```bash
./dnd-fam-ftw-cli invite-requests list
./dnd-fam-ftw-cli invite-requests list --json
./dnd-fam-ftw-cli invite-requests clear    # delete all requests
```

---

## Production management (AWS)

Production commands run via SSH wrapper scripts under `scripts/deploy/`. These scripts:

1. Load config from `scripts/deploy/.env.deploy` (or exported env vars)
2. Open a temporary SSH tunnel to the Lightsail instance
3. Run the command remotely
4. Close the tunnel on exit

### Prerequisites

Copy `scripts/deploy/.env.deploy.example` to `scripts/deploy/.env.deploy` and fill in your values (host, SSH key path, etc.). Alternatively, export the required vars before running.

### dnd-fam-ftw-prod-cli - remote CLI

Runs management commands on the production instance. Same `<resource> <sub-command>` interface as the local CLI:

```bash
./dnd-fam-ftw-prod-cli users list
./dnd-fam-ftw-prod-cli users add someone@gmail.com "Their Name"
./dnd-fam-ftw-prod-cli namespaces list
./dnd-fam-ftw-prod-cli namespaces add-user <nsId> someone@gmail.com
./dnd-fam-ftw-prod-cli namespaces set-limits <nsId> --max-sessions 5 --max-turns 100
./dnd-fam-ftw-prod-cli sessions list --json
./dnd-fam-ftw-prod-cli metrics
./dnd-fam-ftw-prod-cli invite-requests list
```

### run-ssh.sh - interactive SSH session

Opens an interactive shell on the production instance.

```bash
./scripts/deploy/run-ssh.sh
```

### node-version.sh

Prints the Node.js version running on the instance. Useful for confirming upgrades.

```bash
./scripts/deploy/node-version.sh
```

### smoke-test.sh

Checks that the API health endpoint and frontend are reachable after a deploy.

```bash
./scripts/deploy/smoke-test.sh
```

### deploy-backend.sh

Builds the backend locally, rsyncs the `dist/` output to the instance, pulls secrets from SSM, writes the app env file, and restarts the systemd service. Called by CI but can be run manually.

```bash
./scripts/deploy/deploy-backend.sh
```

### deploy-frontend.sh

Builds the frontend with production env vars, syncs the output to S3, and invalidates the CloudFront distribution. Called by CI but can be run manually.

```bash
./scripts/deploy/deploy-frontend.sh
```

### setup-service.sh

One-time bootstrap after a fresh instance. Creates app directories, installs the systemd service, and writes the Nginx config. Run once after `terraform apply` + cert provisioning.

```bash
./scripts/deploy/setup-service.sh
```

---

## One-time setup scripts

These run once during initial infrastructure setup. Not needed for day-to-day operations.

| Script | When to run |
|---|---|
| `./scripts/create-terraform-user.sh [aws-profile]` | Before first `terraform apply` - creates the IAM user and policy Terraform needs |
| `./scripts/fill-ssm-params.sh [aws-profile] [ssm-prefix]` | After `terraform apply` - fills SSM parameters with actual secret values |
| `./scripts/provision-cert.sh` | After `terraform apply` - obtains a Let's Encrypt TLS cert via DNS-01 / Route 53 |
| `./scripts/install-ubuntu.sh` | Legacy local laptop deploy - installs deps and systemd service on an Ubuntu server |
| `./scripts/re-deploy.sh` | Legacy local laptop deploy - pushes local changes and restarts the service |
| `./scripts/sync-to-server.sh` | Legacy local laptop deploy - rsync only, no restart |

---

## CI/CD

GitHub Actions handles automated deploys. Workflows live in `.github/workflows/`:

| Workflow | Trigger | What it does |
|---|---|---|
| `deploy.yml` | Push to `main`, or `v*` tag | Deploys backend and/or frontend if relevant files changed (tag always deploys both) |
| `lint.yml` | Pull request | Runs `npm run lint` across all workspaces |
| `test.yml` | Pull request | Runs backend unit tests |
| `renew-cert.yml` | Scheduled (monthly) | Renews the Let's Encrypt cert via `certbot renew` |

Required GitHub secrets (in the `production` environment): `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `LIGHTSAIL_INSTANCE_NAME`, `LIGHTSAIL_HOST`, `SSH_PRIVATE_KEY`, `API_DOMAIN`, `FRONTEND_DOMAIN`, `FRONTEND_BUCKET_NAME`, `IMAGE_BUCKET_NAME`, `CF_DIST_ID`.
