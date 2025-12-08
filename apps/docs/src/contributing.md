# Contributing

:::info
`AGENTS.md` is an excellent place to start reading on coding conventions followed in this project.
:::

- Install [Rust](https://www.rust-lang.org), [Moon](https://moonrepo.dev) and
  [Caddy](https://caddyserver.com/) (>= 2.7).
- Make sure you have PostgreSQL installed and running. I prefer using Docker e.g.
`docker run -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres -e POSTGRES_DB=postgres -p 5432:5432 postgres:18-alpine`
- Create the following environment file in the root of the repository:

  ```bash title=".env"
  APP_VERSION=v9.2.2
  UNKEY_ROOT_KEY=dummy-root-key
  DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres
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
