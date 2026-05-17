<script setup>
import variables from "./variables";
</script>

# Deployment

The easiest way to deploy Ryot is using [docker compose](./index.md#installation). Here
is a non-exhaustive set of guides to deploy Ryot to alternative platforms.

## File storage

Local upload and download URLs use `SERVER_ADMIN_ACCESS_TOKEN` for signing. Keep that token stable
across restarts because changing it invalidates outstanding local URLs. Temporary uploads, imports,
backup working files, and sandbox files always use local ephemeral storage at the default
`/home/ryot/work`; do not mount that directory as a persistent volume.

For permanent files, use S3 first by configuring the S3 endpoint, bucket, access key, and secret
key. The region is optional. The server then stores permanent files in S3 and needs no persistent
local storage volume. If S3 is not fully configured, Ryot falls back to local permanent storage at
`/home/ryot/storage`; mount a persistent volume at that path and back it up. See the [file storage
guide](guides/file-storage.md) for the complete configuration.

## Railway

1. Click on "+ New Project" on your dashboard and select "Empty project".
2. Once the project is created click on "+ New" and select "Database" and then
   "Add PostgreSQL". Repeat this step and select "Add Redis".
3. Click on "+ New" again and select "Docker Image". Type `ignisda/ryot` and hit Enter.
4. Click on the newly created service and go to the "Variables" section. Click on
   "New Variable" and then "Add Reference" to add both `DATABASE_URL` and `REDIS_URL`.
   Click on "Add".
5. Add a `SERVER_ADMIN_ACCESS_TOKEN` variable set to a long random string. The server
   refuses to start without it.
6. Go to the "Settings" tab and then click on "Generate Domain".
7. Optionally, you can set the [health-check](https://docs.railway.app/deploy/healthchecks)
   path to `/api/system/health`.

## Dokku

This is a script that automatically sets up a Ryot server using the docker image uploaded
to Ghcr and creates a [Dokku](https://dokku.com) app. The script assumes you have a global
domain set-up (i.e. the file `/home/dokku/VHOST` exists). It needs to be run with `sudo`
privileges.

Re-running it updates the running server to the latest version.

```bash
#!/usr/bin/env bash

set -euo pipefail

if [ "$EUID" -ne 0 ]
  then echo "Please run as root"
  exit
fi

IMAGE_NAME="ignisda/ryot"
APPNAME=""

read -rp "Enter the name of the app: " APPNAME

# check if app name is empty
if [ -z "$APPNAME" ]; then
    echo "App name empty. Using default name: ryot"
    APPNAME="ryot"
fi

# pull the latest image
docker rmi -f "$IMAGE_NAME" || true
docker pull "$IMAGE_NAME:latest"
image_sha="$(docker inspect --format={{ '"{{index .RepoDigests 0}}"' }} $IMAGE_NAME)"
echo "Calculated image sha: $image_sha"

if dokku apps:exists $APPNAME; then
    dokku git:from-image $APPNAME $image_sha || echo "Already on latest"
    exit 0
fi

# check if required dokku plugins exist
if ! dokku plugin:list | grep redis; then
    dokku plugin:install https://github.com/dokku/dokku-redis.git
fi

if ! dokku plugin:list | grep letsencrypt; then
    dokku plugin:install https://github.com/dokku/dokku-letsencrypt.git
fi

dokku apps:create "$APPNAME"
dokku postgres:create "$APPNAME-service"
dokku postgres:link "$APPNAME-service" "$APPNAME"
dokku redis:create "$APPNAME-cache"
dokku redis:link "$APPNAME-cache" "$APPNAME"
dokku ports:set "$APPNAME" http:80:8000
dokku config:set --no-restart "$APPNAME" SERVER_ADMIN_ACCESS_TOKEN="$(openssl rand -hex 16)"

dokku domains:add $APPNAME $APPNAME."$(cat /home/dokku/VHOST)"
dokku letsencrypt:enable "$APPNAME"
dokku git:from-image "$APPNAME" "$image_sha"
```

## Fly

The demo Ryot instance is deployed to [Fly](https://fly.io). The following steps
are required to deploy to Fly.

1. Create a new postgres database for Ryot.

   ```bash
   flyctl postgres create ryot-db
   ```

2. Copy the <a :href="`${variables.filePath}/ci/fly.toml`" target="_blank">fly.toml</a>
   file from this repository to your own repository. You **WILL** have to change the `app` key
   to a unique name. Deploy it using the below command.
   ```bash
   flyctl launch
   ```
3. Connect the database.

   ```bash
   fly postgres attach --app ryot ryot-db
   ```

4. Create a Redis instance and point Ryot at it. Ryot does not start without one.

   ```bash
   flyctl redis create
   fly secrets set REDIS_URL='<the connection string printed above>'
   ```

5. Set the admin access token, which is also required.

   ```bash
   fly secrets set SERVER_ADMIN_ACCESS_TOKEN="$(openssl rand -hex 16)"
   ```

6. Optionally you can configure the instance using `fly secrets set`.
   ```bash
   fly secrets set \
     FILE_STORAGE_S3_URL='https://s3.example.com' \
     FILE_STORAGE_S3_REGION='us-east-1' \
     FILE_STORAGE_S3_BUCKET_NAME='ryot' \
     FILE_STORAGE_S3_ACCESS_KEY_ID='your-access-key-id' \
     FILE_STORAGE_S3_SECRET_ACCESS_KEY='your-secret-access-key'
   ```

## Kubernetes (Helm)

A Helm chart is published to GitHub Container Registry as an OCI artifact
(requires Helm 3.8+). It deploys the Ryot container with bundled PostgreSQL and
Redis by default, and supports bringing your own databases instead.

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

You can install `ryot` from the Cosmos marketplace using this link: [Install
Ryot](https://cosmos-cloud.io/proxy#cosmos-ui/market-listing/cosmos-cloud/Ryot)
or by searching for `Ryot` in the marketplace.

Review the installation summary and click install to proceed. The database and
credentials will be automatically created for you, but make sure you are happy
with the URL chosen.

The instance will be available under your newly created URL via HTTPS if it
is enabled. You can then proceed with creating your first user via the web
interface's registration page.
