# Installation

The first user you register is automatically set as admin of the instance.

## Using Docker

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
      - DATABASE_URL=postgres://postgres:postgres@postgres:5432/postgres # recommended
      # - DATABASE_URL=sqlite:./ryot-db.sqlite # SQLite database
      # - DATABASE_URL=mysql://mysql:mysql@mysql:6749/mysql # MySQL database
      # - SERVER_INSECURE_COOKIE=true # only needed in localhost or non-https
    ports:
      - "8000:8000"
    # volumes:
    # - ./ryot-data:/data # only needed if using sqlite database
    pull_policy: always
    container_name: ryot

volumes:
  postgres_storage:
```

In addition to the `latest` tag, we also publish an `unstable` tag from the latest
pre-release or release, whichever is newer.

!!! danger "Production Usage"

    If you mount a directory to `/data`, give it `1001:1001`
    permissions: `sudo chown -R 1001:1001 ./ryot-data`.

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
