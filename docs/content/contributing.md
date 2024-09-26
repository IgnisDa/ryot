# Contributing

Each version of Ryot is released as docker images. For example, if the latest tag is
`v5.2.1`, then the docker image will be tagged as `v5.2.1`, `v5.2`, `v5` and `latest`. The
images will be made available on [Docker Hub](https://hub.docker.com/r/ignisda/ryot) and
[GitHub Container Registry](https://ghcr.io/ignisda/ryot).

## Development

There is a [devcontainer](https://code.visualstudio.com/docs/devcontainers/containers)
configuration in the repository. You can use it to launch a development environment
with all tools installed.

### Environment

Create the following environment file in the root of the repository:

```bash title=".env"
DATABASE_URL=postgres://postgres:postgres@postgres:5432/postgres
UNKEY_API_ID=api_4GvvJVbWobkNjcnnvFHmBP5pXb4K
APP_VERSION=v5.2.1
DEFAULT_TMDB_ACCESS_TOKEN=your-tmdb-access-token
DEFAULT_MAL_CLIENT_ID=your-mal-client-id
```

In development, both servers are started independently running on `:3000` and `:5000`
respectively and reverse proxied at `:8000`. To get everything started, run `mprocs` in the
project root.

Your website would be available at `http://localhost:8000`.
