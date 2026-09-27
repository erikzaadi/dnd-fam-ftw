# Operations

How to run the app somewhere other than your laptop, and how the author's AWS deployment works. For settings see [configuration.md](configuration.md); for the management CLI see [MANAGE.md](../MANAGE.md).

## What a deployment needs

Self-hosting does not require AWS. The app is:

- **Backend:** one Node 24 process. Build with `npm run build:backend` (it builds the shared package first), then run `npm start --prefix backend` (`node --env-file=../.env dist/index.js`), or `node dist/index.js` from `backend/` with the variables in the environment. It serves the API and, with local image storage, generated images.
- **Database:** a SQLite file on local disk (`SQLITE_DB_PATH`), migrated automatically on startup. Back it up; there is nothing else stateful except images.
- **Frontend:** static files from `npm run build` (`frontend/dist`), served by any web server, with `/api/*` proxied to the backend (or `VITE_API_BASE_URL` pointing at the backend's origin).
- **Images:** a local directory (`IMAGE_STORAGE_PROVIDER=local`) or an S3 bucket behind a public URL.
- **TLS and a domain** if anyone other than you will sign in (Google OAuth and secure cookies need https).

The AWS setup below is one way to provide those pieces.

## AWS (the author's production setup)

The app deploys to AWS via GitHub Actions (`.github/workflows/deploy.yml`). Infrastructure is provisioned with Terraform (`terraform/`):

| Resource | Purpose |
|---|---|
| AWS Lightsail | Ubuntu VPS running the Node backend behind Nginx |
| S3 | Frontend static files, generated images, database backups |
| CloudFront | CDN for frontend and images |
| Route53 | DNS for API and frontend domains |
| SSM Parameter Store | Secrets and app settings |

**First-time setup:**
1. Copy `terraform/terraform.tfvars.example` to `terraform/terraform.tfvars` and fill in your values.
2. Create the Terraform IAM user (`./scripts/create-terraform-user.sh`), then `terraform apply` in `terraform/`.
3. Fill in SSM parameters: `./scripts/fill-ssm-params.sh`.
4. Provision the TLS cert: `./scripts/provision-cert.sh`.
5. Bootstrap the instance: `./scripts/deploy/setup-service.sh`.
6. Push a `v*` tag (`./scripts/bump-version.sh`) to trigger a full deploy.

## Legacy: laptop / home server at a subpath

The app can also run at a subpath (`/dnd-fam-ftw/`) behind Nginx on a Linux machine:

```bash
# First time setup on the server
./scripts/install-ubuntu.sh

# Push local changes to the server and restart
./scripts/re-deploy.sh
```

The backend runs as a systemd service. `re-deploy.sh` sets `VITE_BASE_PATH=/dnd-fam-ftw/` for the frontend build. MCP OAuth is not supported under a path prefix.

## Production management scripts (AWS)

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

### restart-instance.sh

Restarts the Lightsail instance via the AWS CLI. Use when the app is wedged and a service restart isn't enough.

```bash
./scripts/deploy/restart-instance.sh
```

### smoke-test.sh

Checks that the API health endpoint and frontend are reachable after a deploy.

```bash
./scripts/deploy/smoke-test.sh
```

### deploy-backend.sh

Manual backend deploy: builds the backend locally, rsyncs the `dist/` output to the instance, pulls parameters from SSM, writes the app env file, and restarts the systemd service. CI does not call it; `.github/workflows/deploy.yml` builds and writes `app.env` itself, from the same SSM parameters.

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
| `./scripts/bump-version.sh` | Create and push a new version tag (reads latest tag, increments patch, pushes) |
| `./scripts/install-ubuntu.sh` | Legacy local laptop deploy - installs deps and systemd service on an Ubuntu server |
| `./scripts/re-deploy.sh` | Legacy local laptop deploy - pushes local changes and restarts the service |
| `./scripts/sync-to-server.sh` | Legacy local laptop deploy - rsync only, no restart |

### Email sign-in (SES) setup

Email, signup, and usage settings are **SSM parameters** under the SSM prefix (default `/dnd-fam-ftw/prod`). Both the CI deploy (`.github/workflows/deploy.yml`) and `deploy-backend.sh` append every parameter under that prefix to `app.env`, so SSM is the single source for them. Never create one with a placeholder value: an invalid value (e.g. `EMAIL_PROVIDER=PLACEHOLDER`) stops the new release from starting and the deploy rolls back.

| SSM parameter | Value |
| --- | --- |
| `EMAIL_PROVIDER` | `ses` (absent = no email sign-in) |
| `EMAIL_FROM` | `terraform output -raw email_from` |
| `SIGNUP_MODE` | `invite_only` (default when absent) or `open` |
| `SUPPORT_URL` | optional, e.g. `https://ko-fi.com/<you>` |
| `KOFI_VERIFICATION_TOKEN` | optional, SecureString, from Ko-fi > Settings > API |
| `MCP_ENABLED` | optional, `true` for the AI assistant pilot |
| `MCP_PUBLIC_URL` | optional, `https://<api domain>/mcp` |
| `MCP_DAILY_PAID_CALLS_PER_TOKEN` | optional, default 200 |
| `MCP_DEFAULT_TIERS` | optional, default `unlimited`, e.g. `unlimited,supporter` |
| `MCP_OAUTH_ENABLED` | optional, `true` for assistant sign-in (needs `MCP_PUBLIC_URL`) |
| `DAILY_SPEND_LIMIT_USD` | optional, e.g. `3` |
| `SIGNUP_DAILY_CAP` | optional, default 25 |
| `SIGNUP_NOTIFY_EMAIL` | optional, default `ADMIN_EMAIL` |

`AUTH_MODE=enabled` is written by the deploy itself; `SES_REGION` falls back to the deploy's `AWS_REGION`.

1. **Terraform user permissions.** Re-run `./scripts/create-terraform-user.sh <admin-profile>` so the Terraform user gets the `SESManagement` statement from `terraform/terraform-iam-policy.json`. Existing keys stay valid.
2. **Infrastructure.** Set `mail_domain` (e.g. `mail.yourdomain.com`, under `hosted_zone_name`) in `terraform/terraform.tfvars`, then:
   ```bash
   cd terraform
   export AWS_PROFILE=dnd-fam-ftw-terraform
   terraform init
   terraform plan -out ses.plan    # expect module.email[0] creates + in-place app user policy update, no destroys
   terraform apply ses.plan
   terraform output -raw email_from
   ```
   This creates the SES domain identity with Easy DKIM, a custom MAIL FROM (`bounce.<mail_domain>`) with MX/SPF, a DMARC record, account-level suppression for bounces and complaints, and `ses:SendEmail` for the app IAM user scoped to that identity.
3. **Wait for verification** (`<region>` = `aws_region` from `terraform.tfvars`):
   ```bash
   aws sesv2 get-email-identity --region <region> --email-identity mail.yourdomain.com \
     --query '{Sending:VerifiedForSendingStatus,Dkim:DkimAttributes.Status}'
   ```
4. **Production access** (once per region, needs an admin profile; the Terraform user cannot request it):
   ```bash
   AWS_PROFILE=<admin-profile> aws sesv2 put-account-details --region <region> \
     --production-access-enabled --mail-type TRANSACTIONAL \
     --website-url https://app.yourdomain.com --contact-language EN \
     --use-case-description "One-time sign-in codes for a small family game, sent only on request, plus occasional owner notices. No marketing."
   aws sesv2 get-account --region <region> --query '{Production:ProductionAccessEnabled,Review:Details.ReviewDetails.Status,Quota:SendQuota}'
   ```
   Wait for `Production: true` (the sandbox only sends to verified addresses).
5. **Enable email sign-in** (signup stays invite-only):
   ```bash
   P=/dnd-fam-ftw/prod
   aws ssm put-parameter --region <region> --type String --name $P/EMAIL_PROVIDER --value ses
   aws ssm put-parameter --region <region> --type String --name $P/EMAIL_FROM --value "$(cd terraform && terraform output -raw email_from)"
   aws ssm put-parameter --region <region> --type String --name $P/SUPPORT_URL --value https://ko-fi.com/<you>        # optional
   aws ssm put-parameter --region <region> --type String --name $P/DAILY_SPEND_LIMIT_USD --value 3                    # optional
   ```
   Then deploy the backend: the Deploy workflow via workflow_dispatch with `force_backend` (SSM changes are not detected as code changes), or a version tag.
6. **Smoke test:** `./scripts/deploy/dnd-fam-ftw-prod-cli email-outbox send-test <address>` to a Gmail, an Outlook, and a non-Google custom-domain mailbox. Check spam placement and DKIM/SPF/DMARC pass in the headers. Then sign in with an email code from a fresh browser.
7. **Open signup:** `aws ssm put-parameter --region <region> --type String --overwrite --name $P/SIGNUP_MODE --value open` (create without `--overwrite` the first time) and force a backend deploy. Roll back with `--value invite_only` and another deploy; email and Google sign-in keep working for existing accounts.

---

## CI/CD

GitHub Actions handles automated deploys. Workflows live in `.github/workflows/`:

| Workflow | Trigger | What it does |
|---|---|---|
| `deploy.yml` | `v*` tag, manual | First runs `lint.yml` and `test.yml` (all jobs) on the exact SHA. Tags deploy backend and frontend; manual runs deploy what changed since the last deployed SHA (shared package, root package files, `.nvmrc` and the deploy workflow count for both; an unknown comparison SHA rebuilds). Backend ships as a versioned release with automatic rollback. Shares the `production-mutation` concurrency group with restores and is never cancelled mid-run. |
| `lint.yml` | Push, PR, manual, called by deploy | Lint + typecheck for shared, backend, frontend, workflows and shell scripts. Always reports the stable **Lint result** check (use it for branch protection). |
| `test.yml` | Push, PR, manual, called by deploy | Backend unit + integration, frontend unit, E2E (failure traces uploaded as artifacts). Always reports the stable **Test result** check. |
| `metrics.yml` | Sunday 10:00 UTC, manual | Gathers usage metrics, Ko-fi donations since the last report, and pending invite requests; AI summary via Pushover |
| `visual-snapshots.yml` | `v*` tag, manual | Runs Playwright visual snapshot tests against a seeded prod instance; compare against S3 baselines. First run: dispatch with `update_snapshots=true` to generate baselines. |
| `renew-cert.yml` | Scheduled (monthly) | Renews the Let's Encrypt cert via `certbot renew` |
| `backup-db.yml` | Daily 02:00 UTC, manual | Consistent copy via `VACUUM INTO` (`dist/scripts/backupDatabase.js`), integrity-checked, uploaded with a metadata JSON (app version, schema summary, counts) to `s3://<SNAPSHOTS_BUCKET_NAME>/db-backups/`. Retention follows the bucket lifecycle rule (90 days). Recovery point: up to ~24h. Requires a backend release that contains the backup script. |
| `restore-db.yml` | Manual only | Inputs: `backup_date` (YYYY-MM-DD), `target` = `drill` (default: restores into a disposable copy, starts the app on a spare port against it, verifies, deletes; production untouched) or `production` (verifies the backup, keeps a `.pre-restore-*` copy, restores, checks startup, ownership and readable sessions/history). Run a drill first. |

Required GitHub secrets (in the `production` environment): `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `LIGHTSAIL_INSTANCE_NAME`, `LIGHTSAIL_HOST`, `SSH_PRIVATE_KEY`, `API_DOMAIN`, `FRONTEND_DOMAIN`, `FRONTEND_BUCKET_NAME`, `IMAGE_BUCKET_NAME`, `CF_DIST_ID`.
Required GitHub variable (in the `production` environment): `SNAPSHOTS_BUCKET_NAME`.

### Backend releases and rollback

The backend runs from `/opt/dnd-fam-ftw/current`, a symlink to `/opt/dnd-fam-ftw/releases/<release-id>`. Each deploy uploads a new release directory, keeps the previous `app.env` as `app.env.previous`, switches the symlink atomically, restarts, and verifies `/health` reports the new version; if not, the previous release and env file are restored and the deploy fails. The newest 5 releases are kept. The first deploy after this change migrates the old plain `current/` directory into `releases/legacy-*` automatically.

Manual rollback (code/config only, never the database; schema migrations are additive so older releases run on the newer schema):

```bash
./scripts/deploy/rollback-backend.sh --list          # releases, * = active
./scripts/deploy/rollback-backend.sh                 # back to the release before the current one
./scripts/deploy/rollback-backend.sh <release-id>    # a specific release
./scripts/deploy/rollback-backend.sh --restore-env   # also restore app.env.previous
```

Frontend rollback: re-run the Deploy workflow on the earlier tag with `force_frontend`. Old hashed assets stay in S3 for 30 days, so open tabs keep working across releases.

### Inspecting a backup locally

Download a backup and run CLI commands against it:

```bash
# List available backups
aws s3 ls s3://<SNAPSHOTS_BUCKET_NAME>/db-backups/

# Download a backup
aws s3 cp s3://<SNAPSHOTS_BUCKET_NAME>/db-backups/app-YYYY-MM-DD.db ./app-backup.db

# Run CLI against the backup (full path required)
SQLITE_DB_PATH=${PWD}/app-backup.db ./dnd-fam-ftw-cli namespaces list
SQLITE_DB_PATH=${PWD}/app-backup.db ./dnd-fam-ftw-cli sessions list --json
```
