# Architecture

The frontend is a Remix app, the backend is an Axum server. All these run behind a Caddy
reverse proxy and are managed by `concurrently`.

## Releases

Each version of Ryot is released as a docker image. Then it is associated with the latest
Github release of the major version. For example, if the latest release is `v5.2.1`, then
the Github release will be called `Version 5` and the docker image will be tagged as
`:v5.2.1` and `:latest`.

## Development

There is a [devcontainer](https://code.visualstudio.com/docs/devcontainers/containers)
configuration in the repository. You can use it to launch a development environment
with all tools installed.

### Environment

In development, both servers are started independently running on `:3000` and `:5000`
respectively and reverse proxied at `:8000`. To get them running, install
[mprocs](https://github.com/pvolok/mprocs), and run `mprocs` in the project root.

Here is the minimal configuration required in development mode:

```json title="config/ryot.json"
{
  "database": {
    "url": "postgres://postgres:postgres@postgres:5432/postgres"
  },
  "server": {
    "cors_origins": ["http://localhost:3000"],
    "config_dump_path": "/tmp/ryot.json"
  }
}
```

I also recommend the following environment files:

```bash title=".env"
RUST_LOG="ryot=trace,sea_orm=debug"
```

```bash title="apps/frontend/.env"
API_URL=http://localhost:5000
```

Your website would be available at `http://localhost:8000`.

### Testing webhooks

You can use [Serveo](https://serveo.net/) to test webhooks.

```bash
ssh -R ryot:80:0.0.0.0:8000 serveo.net
```

This will expose your local server on `https://ryot.serveo.net`. You can use this URL
in Jellyfin etc. to test events sent to your local Ryot instance.

Another helpful tool is [Webhook.site](https://webhook.site/). It can be used to inspect
the requests sent to your server.
