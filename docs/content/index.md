# Installation

The first user you register is automatically set as admin of the instance.

## Using Docker

!!! danger "Production Usage"

    You will have to mount a directory to `/data`, giving it `1001:1001` permissions.
    It is also recommended to use PostgreSQL in production.

To get a demo server running, use the docker image:

```bash
$ docker run \
  --detach \
  --name ryot \
  --pull always \
  --publish "8000:8000" \
  --env "SERVER_INSECURE_COOKIE=true" \
  ghcr.io/ignisda/ryot:latest
```

`docker-compose` with PostgreSQL

```yaml
version: "3.9"

services:
  postgres:
    image: postgres:15-alpine
    restart: unless-stopped
    volumes:
      - postgres_storage:/var/lib/postgresql/data
    environment:
      POSTGRES_PASSWORD: postgres
      POSTGRES_USER: postgres
      POSTGRES_DB: postgres

  ryot:
    image: "ghcr.io/ignisda/ryot:latest"
    environment:
      - SERVER_INSECURE_COOKIE=true
      - DATABASE_URL=postgres://postgres:postgres@postgres:5432/postgres
    ports:
      - "8000:8000"
    volumes:
      - ./ryot-data:/data
    pull_policy: always
    container_name: ryot

volumes:
  postgres_storage:
```

!!! warning

    The `SERVER_INSECURE_COOKIE` configuration is only required if you are not
    running HTTPs.

In addition to the `latest` tag, we also publish an `unstable` tag from the latest
pre-release or release, whichever is newer.

## Using Cosmos

[![Static Badge](https://img.shields.io/badge/Cosmos-Install%20Server-violet)](https://cosmos-cloud.io/proxy#cosmos-ui/market-listing/cosmos-cloud/Ryot)

You can install `ryot` from the Cosmos marketplace using this link: [Install Ryot](https://cosmos-cloud.io/proxy#cosmos-ui/market-listing/cosmos-cloud/Ryot) or by searching for `Ryot` in the marketplace.

Review the installation summary and click install to proceed. The database and credentials will be automatically created for you, but make sure you are happy with the URL chosen.

The instance will be available under your newly created URL via HTTPS if it is enabled. You can then proceed with creating your first user via the web interface's registration page.

## Quick-run a release

Each release has an installation script that can be used to install the `ryot`
binary. Follow the instructions in the release to use this script.

**Alternatively** using [eget](https://github.com/zyedidia/eget):

```bash
$ eget ignisda/ryot
```

## Compile and run from source

First install [moonrepo](https://moonrepo.dev/)

```bash
# Build the frontend
$ moon run frontend:build

# Run it
$ cargo run --bin ryot --release
```
