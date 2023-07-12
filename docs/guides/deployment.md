# Deployment

The easiest way to deploy Ryot is using the docker
[image](https://github.com/IgnisDa/ryot/pkgs/container/ryot). Here is a
non-exhaustive set of guides to deploy Ryot.

## Dokku

This is a script that automatically sets up a Ryot server using the docker image
uploaded to DockerHub and creates a [Dokku](https://dokku.com/) app. The script
assumes you have a global domain set-up (i.e. the file `/home/dokku/VHOST`
exists). It needs to be run with `sudo` privileges.

Re-running it updates the running server to the latest version.


```bash
#!/usr/bin/env bash

set -euo pipefail

if [ "$EUID" -ne 0 ]
  then echo "Please run as root"
  exit
fi

IMAGE_NAME="ghcr.io/ignisda/ryot"
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
image_sha="$(docker inspect --format='{{index .RepoDigests 0}}' $IMAGE_NAME)"
echo "Calculated image sha: $image_sha"

if dokku apps:exists $APPNAME; then
    dokku git:from-image $APPNAME $image_sha || echo "Already on latest"
    exit 0
fi

dokku apps:create "$APPNAME"
dokku storage:ensure-directory "$APPNAME"

# check if required dokku plugin exists
if ! dokku plugin:list | grep letsencrypt; then
    dokku plugin:install https://github.com/dokku/dokku-letsencrypt.git
fi
# check if global email for letsencrypt is set
if ! dokku config:get --global DOKKU_LETSENCRYPT_EMAIL; then
    read -rp "Enter email address for letsencrypt: " EMAIL
    dokku config:set "$APPNAME" DOKKU_LETSENCRYPT_EMAIL="$EMAIL"
fi

dokku storage:mount "$APPNAME" /var/lib/dokku/data/storage/"$APPNAME":/data
dokku domains:add $APPNAME $APPNAME."$(cat /home/dokku/VHOST)"
dokku letsencrypt:enable "$APPNAME"
dokku git:from-image "$APPNAME" "$image_sha"
```

This will start a Ryot using the default SQLite database backend. To use a
separate backend, link a service to your app. For example with Postgres:

```bash
dokku postgres:create $APPNAME-service
dokku postgres:link $APPNAME-service $APPNAME
```

You can create `/var/lib/dokku/storage/$APPNAME/config/ryot.{json,toml,yaml}`
files to configure the instance. Make sure to restart the server after you change
the configuration.

## Fly

The demo Ryot instance is deployed to [Fly](https://fly.io). The following steps
are required to deploy to Fly.

1. Create a new postgres database for Ryot.

```bash
flyctl postgres create ryot-db
```

2. Copy the [`fly.toml`](/fly.toml) in the root of this repository to your own
repository. You **WILL** have to change the `app` key to a name of your choosing.
Deploy it using the below command.

```bash
flyctl launch
```

3. Connect the database.

```bash
fly postgres attach --app ryot ryot-db
```

4. Optionally you can configure the instance using `fly secrets set`.

```bash
fly secrets set FILE_STORAGE_S3_URL='https://play.min.io:9000'
```
