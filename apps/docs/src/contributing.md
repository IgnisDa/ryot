# Contributing

:::info
CLAUDE.md is an excellent place to start reading on coding conventions followed in this project.
:::

- Install [Rust](https://www.rust-lang.org), [Moon](https://moonrepo.dev) and
  [Caddy](https://caddyserver.com/) (>= 2.7).
- Make sure you have PostgreSQL installed and running. I prefer using Docker e.g.
`docker run -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres -e POSTGRES_DB=postgres -p 5432:5432 postgres:16-alpine`
- Create the following environment file in the root of the repository:

  ```bash title=".env"
  DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres
  DEFAULT_TMDB_ACCESS_TOKEN=your-tmdb-access-token
  DEFAULT_MAL_CLIENT_ID=your-mal-client-id
  TRAKT_CLIENT_ID=your-trakt-client-id
  UNKEY_API_ID=dummy-api-id
  APP_VERSION=v5.2.1
  ```

- Run the following commands in separate terminals:

  ```bash
  cargo run
  moon run frontend:dev
  caddy run --config 'ci/Caddyfile'
  ```

- The frontend will be available at `http://localhost:8000`.

In development, both servers are started independently running on `:3000` and `:5000`
respectively and reverse proxied at `:8000`.

If you want to work on exporting, then you need to also have [Minio](https://min.io/)
installed and running on `localhost:9000`.
