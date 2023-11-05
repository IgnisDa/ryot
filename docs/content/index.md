# Installation

The first user you register is automatically set as admin of the instance.

## Using Docker

The docker image is `ghcr.io/ignisda/ryot:latest`.

```yaml
version: "3.9"

services:
  postgres:
    image: postgres:16-alpine
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
      - DATABASE_URL=postgres://postgres:postgres@postgres:5432/postgres
      # - SERVER_INSECURE_COOKIE=true # only needed in localhost or non-https
    ports:
      - "8000:8000"
    pull_policy: always
    container_name: ryot

volumes:
  postgres_storage:
```

In addition to the `latest` tag, we also publish an `unstable` tag from the latest
pre-release or release, whichever is newer.

## Quick-run a release

Each release has an installation script that can be used to install the `ryot`
binary. Follow the instructions in the release to use this script.

**Alternatively** using [eget](https://github.com/zyedidia/eget):

```bash
eget ignisda/ryot
```

## Compile and run from source

First install [moonrepo](https://moonrepo.dev/) and then build and run projects:

```bash
# 1) Build the frontend
moon run frontend:build

# 2) Run the backend (with frontend bundled)
cargo run --bin ryot
```
