<script setup>
import variables from "./variables";
</script>

# Installation

Use this Docker Compose file:

```yaml
services:
  ryot-db:
    image: postgres:18-alpine # PostgreSQL 15 or later is required
    restart: unless-stopped
    container_name: ryot-db
    volumes:
      - postgres_storage:/var/lib/postgresql
    environment:
      - TZ=Europe/Amsterdam
      - POSTGRES_DB=postgres
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=postgres

  ryot-redis:
    image: redis:8-alpine
    restart: unless-stopped
    container_name: ryot-redis
    volumes:
      - redis_storage:/data

  ryot:
    image: ignisda/ryot:v10 # or ghcr.io/ignisda/ryot:v10
    pull_policy: always
    container_name: ryot
    restart: unless-stopped
    ports:
      - "8000:8000"
    environment:
      - TZ=Europe/Amsterdam
      - REDIS_URL=redis://ryot-redis:6379 # REQUIRED
      - FRONTEND_URL=https://ryot.your-domain.com # REQUIRED: public URL of this instance (IP address is fine too)
      - DATABASE_URL=postgres://postgres:postgres@ryot-db:5432/postgres # REQUIRED
      - SERVER_ADMIN_ACCESS_TOKEN=28ebb3ae554fa9867ba0 # REQUIRED: set to a long random string
    volumes:
      - ryot_storage:/home/ryot/storage

volumes:
  ryot_storage:
  redis_storage:
  postgres_storage:
```

This configuration stores permanent files in `ryot_storage`. Do not mount `/home/ryot/work`;
it is temporary storage. For production, consider S3-compatible permanent storage. See
[File Storage](./guides/file-storage.md).

Some metadata providers require credentials. See [Configuration](./configuration.md).

## Upgrading to Pro

Buy a key from the <a :href="variables.mainWebsiteUrl" target="_blank">Ryot website</a>, then
set `SERVER_PRO_KEY`:

```diff
  ryot:
    environment:
+      - SERVER_PRO_KEY=<pro_key_issued_to_you>
```

An invalid or expired key switches the server to the compatible community version. Fix the key
and restart the server to enable Pro again. See [Pro Key Verification](./concepts/pro-key.md).

## Releases

Images are published to [Docker Hub](https://hub.docker.com/r/ignisda/ryot) and [GitHub Container
Registry](https://ghcr.io/ignisda/ryot). A release such as `v10.5.0` has `v10.5.0`, `v10.5`,
`v10`, `latest`, and commit-SHA tags.

::: danger
The `develop` tag follows `main`. It can contain severe defects and cause data loss. Do not use it
for important data.
:::

## Telemetry

Ryot uses self-hosted [Umami](https://umami.is) analytics to collect page views and selected
events. The event definitions are in the
[source code](https://github.com/IgnisDa/ryot/blob/main/kernel/client/src/modules/analytics).

Signed-in events use an opaque account ID to correlate sessions and devices. Ryot does not send
your name, email address, or tracked content.

Set `DISABLE_TELEMETRY=true` to opt out.
