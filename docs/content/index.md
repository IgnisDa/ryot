# Installation

If you would like to run the pro version, please check [below](#upgrading-to-pro). To see
the features of the pro version, check the [features page]({{extra.main_website_url
}}/features).

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
    container_name: ryot-db

  ryot:
    image: ignisda/ryot:latest # or ghcr.io/ignisda/ryot:latest
    environment:
      - DATABASE_URL=postgres://postgres:postgres@ryot-db:5432/postgres
    ports:
      - "8000:8000"
    pull_policy: always
    container_name: ryot

volumes:
  postgres_storage:
```

## Upgrading to Pro

!!! info

    The pro version is not backwards compatible with the community version, so be sure to
    backup your data before upgrading.

To upgrade to the pro version, you need to provide a `SERVER_PRO_KEY` environment variable.
You can get a key by contacting us via the [website]({{ extra.main_website_url }}).

Once you have the key, you can set it in the `docker-compose.yml` file:

```diff
  ryot:
-   image: ignisda/ryot:latest # or ghcr.io/ignisda/ryot:latest
+   image: ignisda/ryot-pro:latest # or ghcr.io/ignisda/ryot-pro:latest
    environment:
+      - SERVER_PRO_KEY=<pro_key_issued_to_you>
```
