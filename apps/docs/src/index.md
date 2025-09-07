<script setup>
import variables from "./variables";
</script>

# Installation

Use the following docker-compose file:

```yaml
services:
  ryot-db:
    image: postgres:16-alpine # at-least version 15 is required
    restart: unless-stopped
    container_name: ryot-db
    volumes:
      - postgres_storage:/var/lib/postgresql/data
    environment:
      - TZ=Europe/Amsterdam
      - POSTGRES_DB=postgres
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=postgres

  ryot:
    image: ignisda/ryot:v9 # or ghcr.io/ignisda/ryot:v9
    pull_policy: always
    container_name: ryot
    restart: unless-stopped
    ports:
      - "8000:8000"
    environment:
      - TZ=Europe/Amsterdam
      - SERVER_ADMIN_ACCESS_TOKEN=28ebb3ae554fa9867ba0 # CHANGE THIS to any random string
      - DATABASE_URL=postgres://postgres:postgres@ryot-db:5432/postgres

volumes:
  postgres_storage:
```

Some providers (eg: TMDB for movies, IGDB for video games) need access tokens. Please visit
the [configuration](./configuration.md) page for more information.

## Upgrading to Pro

To see the features of the pro version, check the <a
:href="`${variables.mainWebsiteUrl}/features`" target="_blank">features page</a>. To
upgrade to the pro version, you need to provide a `SERVER_PRO_KEY` environment variable.
You can get a key by purchasing it from the <a :href="variables.mainWebsiteUrl"
target="_blank">website</a>.

Once you have the key, you can set it in the `docker-compose.yml` file:

```diff
  ryot:
    environment:
+      - SERVER_PRO_KEY=<pro_key_issued_to_you>
```

If the key is invalid or your subscription has expired, the server will automatically start
with the community version. Since the two versions are compatible, you can switch between
them by simply fixing the key and restarting the server.

## Releases

Each version of Ryot is released as docker images. For example, if the latest tag is
`v5.2.1`, then the docker image will be tagged as `v5.2.1`, `v5.2`, `v5`, `latest` and
`sha-e145f71`. The images will be made available on [Docker
Hub](https://hub.docker.com/r/ignisda/ryot) and [GitHub Container
Registry](https://ghcr.io/ignisda/ryot). Ryot is released on a (loosely) weekly basis.

If you prefer to live on the edge, you can use the `develop` docker tag which is released
when changes are merged into the `main` branch. Please note that this tag often has major
bugs and results in data loss. Only use this tag if you know what you are doing.

## Telemetry

Ryot collects anonymous usage data to help me prioritize features. It uses a self-hosted
[Umami](https://umami.is/) instance to collect this data. In addition to page views, a
few events are also tracked and you can find them in the [source code](https://github.com/IgnisDa/ryot/blob/aa89adabc377e6da7fb8c8d768325efc3667329f/apps/frontend/app/lib/hooks.ts#L199-L222).

You can opt out of this by setting a configuration parameter as described
[here](./configuration.md#important-parameters).
