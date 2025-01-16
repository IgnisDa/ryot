# Installation

Use the following docker-compose file:

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
    image: ignisda/ryot:v8 # or ghcr.io/ignisda/ryot:v8
    environment:
      - DATABASE_URL=postgres://postgres:postgres@ryot-db:5432/postgres
      - TZ=Europe/Amsterdam
      - SERVER_ADMIN_ACCESS_TOKEN=28ebb3ae554fa9867ba0 # CHANGE THIS
    ports:
      - "8000:8000"
    pull_policy: always
    container_name: ryot

volumes:
  postgres_storage:
```

If you would like to run the pro version, please check [below](#upgrading-to-pro). To see
the features of the pro version, check the [features page]({{extra.main_website_url}}).

## Upgrading to Pro

To upgrade to the pro version, you need to provide a `SERVER_PRO_KEY` environment variable.
You can get a key by purchasing it from the [website]({{extra.main_website_url}}).

- Once you have the key, you can set it in the `docker-compose.yml` file:
  ```diff
    ryot:
      environment:
  +      - SERVER_PRO_KEY=<pro_key_issued_to_you>
  ```
- Remove cached configuration using this [guide](./configuration.md#delete-all-cache).

If the key is invalid or your subscription has expired, the server will automatically start
with the community version. Since the two versions are compatible, you can switch between
them by simply fixing the key and restarting the server.

## Releases

Each version of Ryot is released as docker images. For example, if the latest tag is
`v5.2.1`, then the docker image will be tagged as `v5.2.1`, `v5.2`, `v5` and `latest`. The
images will be made available on [Docker Hub](https://hub.docker.com/r/ignisda/ryot) and
[GitHub Container Registry](https://ghcr.io/ignisda/ryot).

Ryot is released on a (loosely) weekly basis. If you prefer to live on the edge, you can
use the `develop` docker tag which is released when changes are merged into the `main`
branch.

## Telemetry

Ryot collects anonymous usage data to help me prioritize features. It uses a self-hosted
[Umami](https://umami.is/) instance to collect this data. In addition to page views, a
few events are also tracked and you can find them in the [source code](https://github.com/IgnisDa/ryot/blob/6722ceb913a9c2fd67392d5812b76a30036142d1/apps/frontend/app/lib/hooks.ts#L140-L174).

You can opt out of this by setting a configuration parameter as described
[here](./configuration.md#important-parameters).
