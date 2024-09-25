# Architecture

The frontend is a Remix app, the backend is an Axum server. All these run behind a Caddy
reverse proxy and are managed by `concurrently`.

## Releases

Each version of Ryot is released as a docker image. Then it is associated with the latest
Github release of the major version. For example, if the latest tag is `v5.2.1`, then
the Github release will be called `Version 5` and the docker image will be tagged as
`:v5.2.1`, `v5.2`, `v5` and `:latest`.

## Development

There is a [devcontainer](https://code.visualstudio.com/docs/devcontainers/containers)
configuration in the repository. You can use it to launch a development environment
with all tools installed.

### Environment

In development, both servers are started independently running on `:3000` and `:5000`
respectively and reverse proxied at `:8000`. To get them running, install
[mprocs](https://github.com/pvolok/mprocs), and run `mprocs` in the project root.

I also recommend the following environment file:

```bash title=".env"
DATABASE_URL=postgres://postgres:postgres@postgres:5432/postgres
RUST_LOG=ryot=trace,sea_orm=debug
```

Your website would be available at `http://localhost:8000`.

### Miscellaneous

You can use [Serveo](https://serveo.net/) to test webhooks.

```bash
ssh -R ryot:80:0.0.0.0:8000 serveo.net
```

This will expose your local server on `https://ryot.serveo.net`. You can use this URL
in Jellyfin etc. to test events sent to your local Ryot instance.

Another helpful tool is [Webhook.site](https://webhook.site/). It can be used to inspect
the requests sent to your server.
