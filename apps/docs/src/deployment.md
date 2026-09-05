<script setup>
import variables from "./variables";
</script>

# Deployment

Use [Docker Compose](./index.md#installation) unless your platform needs another method.

## Plugin configuration encryption

Ryot generates one dedicated 32-byte encryption key on first start and stores it in the
PostgreSQL singleton `plugin_config_encryption_key` table. There is no environment variable,
Secret, or mount to configure. All nodes sharing the database use the same key.

Full PostgreSQL backups include the key and encrypted plugin configuration; account exports
exclude both. If the key is missing while encrypted configuration exists, startup fails rather
than silently generating a replacement, so back up the database as a whole.

## File storage

Keep `SERVER_ADMIN_ACCESS_TOKEN` stable because it signs local file URLs. Mount
`/home/ryot/storage` if you do not configure S3. Never persist `/home/ryot/work`. See
[File Storage](guides/file-storage.md).

## Memory

Give the Ryot container a memory limit, as the [installation](./index.md#installation) compose
file does. On a 4 GB server, 2 GB for Ryot leaves enough room for the database and Redis. If a
plugin uses too much memory, only that plugin's task fails; Ryot keeps running.

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
   Set its `app` key to a unique name, then launch it.
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
