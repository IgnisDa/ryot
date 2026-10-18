<script setup>
import variables from "./variables";
</script>

# Deployment

Use [Docker Compose](./index.md#installation) unless your platform needs another method.

## Plugin runtime requirements

The image supports Linux amd64 and arm64. The host must support Landlock and seccomp; plugin
execution fails if either protection cannot be applied. The backend runs as UID/GID 1001 and the
plugin sidecars as UID/GID 1002. Keep the image's user, allow its setuid launcher, and keep
`/run/ryot-sandboxd` and the application directories writable. Do not enable `no-new-privileges`
or mount the launcher with `nosuid`.

## Plugin configuration encryption

Ryot generates one dedicated 32-byte encryption key on first start and stores it in the
PostgreSQL singleton `plugin_config_encryption_key` table. There is no environment variable,
Secret, or mount to configure. All nodes sharing the database use the same key.

Full PostgreSQL backups include the key and encrypted plugin configuration; account exports
exclude both. If the key is missing while encrypted configuration exists, startup fails rather
than silently generating a replacement, so back up the database as a whole.

## Admin access token

Keep `SERVER_ADMIN_ACCESS_TOKEN` unchanged. Changing it can lock out users with two-factor
authentication and stop the server from issuing new login tokens. It also logs users out and
invalidates existing file links and job status links. Stored files and plugin settings are
unaffected. Token rotation needs additional recovery steps; changing the setting alone is
not enough.

## File storage

Mount `/home/ryot/storage` if you do not configure S3. Never persist `/home/ryot/work`. See
[File Storage](guides/file-storage.md).

## Memory

Ryot sizes plugin memory from the memory it can see: the container's memory limit if it has one,
otherwise the server's memory. Plugins get the smaller of 1,536 MiB and half of that memory, or
`SANDBOX_MEMORY_BUDGET_MIB`, which may not exceed half. A plugin that uses too much memory fails
only its own task. The supplied deployments do not set CPU, memory, or process/thread ceilings.
The sandbox budget is an admission bound, not a limit on total application memory; leave room
for the backend, PostgreSQL, Redis, and other services.

## Imports

Ryot runs two provider imports at a time and queues the rest, so one user importing a lot does
not hold up everyone else. Change this with `SANDBOX_IMPORT_CONCURRENCY`. If you run more than
one Ryot instance, set it to the combined `SANDBOX_WORKER_CONCURRENCY` of all instances.

## Logging

The server always writes structured logs to `./logs/ryot.log`, which resolves to
`/home/ryot/logs/ryot.log` in the container. Logs rotate daily or at 10 MB, are compressed,
and retain seven archives by default. Use the `SERVER_LOG_*` settings to change the path,
level, rotation, or retention. Mount `/home/ryot/logs` separately if logs must survive
container replacement; do not place logs in the application-data storage volume.

Console logs always use the `info` level. `SERVER_LOG_LEVEL` controls file logs and OTLP
logs sent to `OTEL_EXPORTER_OTLP_ENDPOINT`; it does not disable traces or metrics. Each server
instance must write to its own log file.

## Reverse proxies

Set `FRONTEND_URL` to the public origin used by the browser. Configure your
reverse proxy to preserve the public `Host` header and set `X-Forwarded-Proto`
to the client-facing protocol. The proxy must overwrite forwarding headers
supplied by clients.

## Railway

1. Create an empty Railway project.
2. Add PostgreSQL and Redis services.
3. Add a Docker image service for `ignisda/ryot`.
4. Reference `DATABASE_URL` and `REDIS_URL` from the database services.
5. Set `SERVER_ADMIN_ACCESS_TOKEN` to a long random value.
6. Generate a domain and set `FRONTEND_URL` to its public origin.
7. Optional: set the [health-check](https://docs.railway.app/deploy/healthchecks) path to
   `/api/system/health`.

## Dokku

This example requires a Dokku global domain, PostgreSQL, Redis, and Let's Encrypt plugins.
Replace `ryot` if you need a different app name.

```bash
dokku apps:create ryot
dokku postgres:create ryot-service
dokku postgres:link ryot-service ryot
dokku redis:create ryot-cache
dokku redis:link ryot-cache ryot
dokku ports:set ryot http:80:8000
dokku config:set --no-restart ryot SERVER_ADMIN_ACCESS_TOKEN="$(openssl rand -hex 16)"
dokku domains:add ryot "ryot.$(cat /home/dokku/VHOST)"
dokku config:set --no-restart ryot FRONTEND_URL="https://ryot.$(cat /home/dokku/VHOST)"
dokku letsencrypt:enable ryot
dokku git:from-image ryot ignisda/ryot:latest
```

## Fly

1. Create a PostgreSQL database.

   ```bash
   flyctl postgres create ryot-db
   ```

2. Copy the repository's <a :href="`${variables.filePath}/ci/fly.toml`" target="_blank">fly.toml</a>.
   Set its `app` key to a unique name and choose Machine resources in Fly's settings. The template
   leaves resource selection to you. Then launch it.
   ```bash
   flyctl launch
   ```
3. Connect the database.

   ```bash
   fly postgres attach --app ryot ryot-db
   ```

4. Create Redis and set its connection string.

   ```bash
   flyctl redis create
   fly secrets set REDIS_URL='<the connection string printed above>'
   ```

5. Set the required admin token and public frontend URL.

   ```bash
   fly secrets set SERVER_ADMIN_ACCESS_TOKEN="$(openssl rand -hex 16)" FRONTEND_URL='https://<app>.fly.dev'
   ```

6. Optional: configure S3-compatible permanent storage.
   ```bash
   fly secrets set \
     FILE_STORAGE_S3_URL='https://s3.example.com' \
     FILE_STORAGE_S3_REGION='us-east-1' \
     FILE_STORAGE_S3_BUCKET_NAME='ryot' \
     FILE_STORAGE_S3_ACCESS_KEY_ID='your-access-key-id' \
     FILE_STORAGE_S3_SECRET_ACCESS_KEY='your-secret-access-key'
   ```

## Kubernetes (Helm)

The OCI Helm chart requires Helm 3.8 or later. It includes PostgreSQL and Redis by default, but
can use external services.

The chart's CPU and memory requests reserve scheduling capacity only. The setuid launcher
requires `allowPrivilegeEscalation: true`, so Kubernetes Restricted pod-security policy is not
compatible. Use the chart's UID/GID 1001 and runtime-default seccomp settings.

```bash
helm install ryot oci://ghcr.io/ignisda/charts/ryot \
  --set secret.adminAccessToken.value="$(openssl rand -hex 16)" \
  --set postgres.auth.password="$(openssl rand -hex 16)" \
  --set config.frontendUrl="https://ryot.your-domain.com"
```

See the chart's
<a :href="`${variables.filePath}/ci/helm/ryot/README.md`" target="_blank">README</a>
for details on database and Redis modes, ingress and secrets, and
<a :href="`${variables.filePath}/ci/helm/ryot/VALUES.md`" target="_blank">VALUES.md</a>
for the full list of configurable values.

## Cosmos

[![Static Badge](https://img.shields.io/badge/Cosmos-Install%20Server-violet)](https://cosmos-cloud.io/proxy#cosmos-ui/market-listing/cosmos-cloud/Ryot)

Install Ryot from the [Cosmos marketplace](https://cosmos-cloud.io/proxy#cosmos-ui/market-listing/cosmos-cloud/Ryot).
Review the generated URL before installation. Cosmos creates the database and credentials.

## Cloudzy

[![Deploy Ryot on Cloudzy](https://design.cloudzy.com/logo/cloudzy-light-marketplace-badge-147x32.svg)](https://cloudzy.com/marketplace/ryot/)

Deploy Ryot on a Cloudzy VPS with the one-click installer, which runs Ryot with Docker Compose on
Ubuntu Server 24.04 LTS. See the [Cloudzy Marketplace page](https://cloudzy.com/marketplace/ryot/)
for Docker management commands, configuration files, and installation paths.

## Pethost

[Pethost](https://pethost.dev) has a one-click template for Ryot:
[Deploy Ryot on Pethost](https://pethost.dev/templates/ryot/).

The template starts Ryot and PostgreSQL, generates `SERVER_ADMIN_ACCESS_TOKEN` and the
database password, sets `FRONTEND_URL`, and serves Ryot over HTTPS at an address under your
account's domain.

Open the address and create your first user via the web interface's registration page. For
a private instance, then add `USERS_ALLOW_REGISTRATION=false` to the project's `.env`, which
the template's compose file passes to the `ryot` service, and deploy again to stop new
sign-ups.

The database's volume is kept across deploys and is part of the nightly backups. To deploy
the [docker compose](./index.md#installation) file from a terminal instead, see the
[step-by-step guide](https://pethost.dev/blog/self-host-ryot/).
