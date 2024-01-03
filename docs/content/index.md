# Installation

!!! info

    The first user you register is automatically set as admin of the instance.

The docker image is `ghcr.io/ignisda/ryot:latest`.

```yaml
version: "3.9"

services:
  ryot-db:
    image: postgres:16-alpine
    restart: unless-stopped
    volumes:
      - postgres_storage:/var/lib/postgresql/data
    environment:
      - POSTGRES_PASSWORD=postgres
      - POSTGRES_USER=postgres
      - POSTGRES_DB=postgres
    container_name: ryot-db

  ryot:
    image: "ghcr.io/ignisda/ryot:latest"
    environment:
      - DATABASE_URL=postgres://postgres:postgres@ryot-db:5432/postgres
    ports:
      - "8000:8000"
    pull_policy: always
    container_name: ryot

volumes:
  postgres_storage:
```

In addition to the `latest` tag, we also publish an `unstable` tag from the latest
pre-release or release, whichever is newer.
