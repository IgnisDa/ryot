# Installation

The first user you register is automatically set as admin of the instance.

## Option 1: Use Docker

!!! note "Production Usage"

    You will have to mount a directory to `/data`, giving it `1001:1001` permissions.
    It is also recommended to use PostgreSQL or MySQL in production.

To get a demo server running, use the docker image:

```bash
$ docker run \
  --detach \
  --name ryot \
  --pull always \
  --publish 8000:8000 \
  --env "SERVER_INSECURE_COOKIE=true" \
  ghcr.io/ignisda/ryot:latest
```

`docker-compose` with PostgreSQL

```yaml
version: '3.9'

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
    image: 'ghcr.io/ignisda/ryot:latest'
    environment:
        - SERVER_INSECURE_COOKIE=true
        - DATABASE_URL=postgres://postgres:postgres@postgres:5432/postgres
    ports:
        - '8000:8000'
    pull_policy: always
    container_name: ryot

volumes:
  postgres_storage:
```

!!! note

    The `SERVER_INSECURE_COOKIE` is only required if you are not running HTTPs.

In addition to the `latest` tag, we also publish an `unstable` tag from the latest
pre-release (or release, whichever is newer).

## Option 2: Quick-run a release

Each release has an installation script that can be used to install the `ryot`
binary. Follow the instructions in the release to use this script.

**Alternatively** using [eget](https://github.com/zyedidia/eget):

```bash
$ eget ignisda/ryot
```

## Option 3: Compile and run from source

- Install [moonrepo](https://moonrepo.dev/)

```bash
# Build the frontend
$ moon run frontend:build

# Run it
$ cargo run --bin ryot --release
```

