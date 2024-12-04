# Contributing

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
TRAKT_CLIENT_ID=your-trakt-client-id
```

In development, both servers are started independently running on `:3000` and `:5000`
respectively and reverse proxied at `:8000`. To get everything started, run `mprocs` in the
project root.

Your website would be available at `http://localhost:8000`.
