# Deployment

The easiest way to deploy Ryot is using the docker
[image](https://github.com/IgnisDa/ryot/pkgs/container/ryot). Here is a
non-exhaustive set of guides to deploy Ryot.

## Dokku

This is a script that automatically sets up vaultwarden using the docker image
uploaded to DockerHub and creates a [Dokku](https://dokku.com/) app. The script
assumes you have a global domain set-up (i.e. the file `/home/dokku/VHOST`
exists). It needs to be run with `sudo` privileges.


```bash
#!/usr/bin/env bash

set -euo pipefail

if [ "$EUID" -ne 0 ]
  then echo "Please run as root"
  exit
fi

APPNAME=""

read -rp "Enter the name of the app: " APPNAME

# check if app name is empty
if [ -z "$APPNAME" ]; then
    echo "App name empty. Using default name: ryot"
    APPNAME="ryot"
fi

# check if dokku plugin exists
if ! dokku plugin:list | grep letsencrypt; then
    dokku plugin:install https://github.com/dokku/dokku-letsencrypt.git
fi
# check if global email for letsencrypt is set
if ! dokku config:get --global DOKKU_LETSENCRYPT_EMAIL; then
    read -rp "Enter email address for letsencrypt: " EMAIL
    dokku config:set --global DOKKU_LETSENCRYPT_EMAIL="$EMAIL"
fi

# pull the latest image
IMAGE_NAME="ghcr.io/ignisda/ryot"
docker pull $IMAGE_NAME
image_sha="$(docker inspect --format='{{index .RepoDigests 0}}' $IMAGE_NAME)"
echo "Calculated image sha: $image_sha"
dokku apps:create "$APPNAME"
dokku storage:ensure-directory "$APPNAME"
dokku storage:mount "$APPNAME" /var/lib/dokku/data/storage/"$APPNAME":/data
dokku domains:add $APPNAME $APPNAME."$(cat /home/dokku/VHOST)"
dokku letsencrypt:enable "$APPNAME"
dokku git:from-image "$APPNAME" "$image_sha"
```

You can now create `/var/lib/dokku/storage/$APPNAME/config/ryot.{json,toml,yaml}`
files to configure the instance. Make sure to restart the server after you change
the configuration.
