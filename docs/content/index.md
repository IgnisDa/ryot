# Installation

```yaml
services:
  ryot-db:
    image: postgres:16-alpine # at-least version 15 is required
    restart: unless-stopped
    volumes:
      - postgres_storage:/var/lib/postgresql/data
    environment:
      - POSTGRES_PASSWORD=postgres
      - POSTGRES_USER=postgres
      - POSTGRES_DB=postgres
      - TZ=Europe/Amsterdam
    container_name: ryot-db

  ryot:
    image: ignisda/ryot:v7 # or ghcr.io/ignisda/ryot:v7
    environment:
      - DATABASE_URL=postgres://postgres:postgres@ryot-db:5432/postgres
      - TZ=Europe/Amsterdam
    ports:
      - "8000:8000"
    pull_policy: always
    container_name: ryot

volumes:
  postgres_storage:
```

If you would like to run the pro version, please check [below](#upgrading-to-pro). To see
the features of the pro version, check the [features page]({{extra.main_website_url
}}).

## Upgrading to Pro

To upgrade to the pro version, you need to provide a `SERVER_PRO_KEY` environment variable.
You can get a key by purchasing it from the [website]({{ extra.main_website_url }}).

Once you have the key, you can set it in the `docker-compose.yml` file:

```diff
  ryot:
    environment:
+      - SERVER_PRO_KEY=<pro_key_issued_to_you>
```

If the key is invalid or your subscription has expired, the server will automatically start
with the community version. Since the two versions are compatible, you can switch between
them by simply fixing the key and restarting the server.
