<h1 align="center">Ryot</h1>

<h3 align="center">
  A self hosted platform for tracking various facets of your life - media, fitness and more.
</h3>

<br/>

<div align="center">
  <a href="https://github.com/ignisda/ryot/stargazers">
    <img alt="GitHub Repo stars" src="https://img.shields.io/github/stars/ignisda/ryot">
  </a>
  <a href="https://github.com/ignisda/ryot/releases">
    <img alt="GitHub release" src="https://img.shields.io/github/v/release/ignisda/ryot">
  </a>
  <a href="https://github.com/ignisda/ryot/blob/main/LICENSE">
    <img alt="License" src="https://img.shields.io/badge/license-GPLv3-purple">
  </a>
  <a href="https://hub.docker.com/r/ignisda/ryot">
    <img alt="Docker pulls" src="https://img.shields.io/docker/pulls/ignisda/ryot">
  </a>
  <a href="https://discord.gg/D9XTg2a7R8">
    <img alt="Discord" src="https://img.shields.io/discord/1239445721502056459?label=discord">
  </a>
</div>

<p align="center">
    <a href="https://demo.ryot.io/_s/acl_vUMPnPirkHlT" target="_blank">Live Demo</a> •
    <a href="https://docs.ryot.io" target="_blank">Documentation</a> •
    <a href="https://discord.gg/D9XTg2a7R8" target="_blank">Discord</a> •
    <a href="https://ryot.io/features" target="_blank">Pro Features</a>
</p>

<br/>

<p align="center">
  <img src="apps/website/public/cta-image.png" alt="Ryot Dashboard" width="700">
</p>

## Quick Start

Create a `docker-compose.yml` file:

```yaml
services:
  ryot-db:
    restart: unless-stopped
    image: postgres:18-alpine
    environment:
      - POSTGRES_PASSWORD=postgres
    volumes:
      - postgres_storage:/var/lib/postgresql

  ryot:
    image: ignisda/ryot:v10
    restart: unless-stopped
    ports:
      - "8000:8000"
    environment:
      - SERVER_ADMIN_ACCESS_TOKEN=CHANGE_ME_TO_A_LONG_RANDOM_STRING
      - DATABASE_URL=postgres://postgres:postgres@ryot-db:5432/postgres

volumes:
  postgres_storage:
```

Then run `docker compose up -d` and visit `http://localhost:8000`. For production setups, see the [installation guide](https://docs.ryot.io).

## Production compiler architecture

The production image contains separate sandbox and client plugin compiler engines with two worker artifacts:
`dist/sandbox-compiler-worker.js*` and `dist/client-plugin-compiler-worker.js*`. The private
`@ryot/typescript-compiler` package shares generic TypeScript 7 native compiler resolution, virtual
project lifecycle, diagnostic collection, and diagnostic normalization; the engines retain independent
import policies, limits, protocols, output models, and public APIs. There is no shared compiler mode,
bridge, or fallback.

During client installation, every archived non-test client `.ts`/`.tsx` file is semantically checked
against compiler-owned trusted React and Ryot SDK types. Type errors are fatal and include TypeScript
diagnostics. Bun bundles only `manifest.client.entry` and its reachable graph, while Tailwind scans all
archived client TypeScript sources. Bun import/asset/CSS validation and runtime schemas remain
authoritative; semantic typing is not a security boundary. Backend semantic checking uses
manifest-declared entries and their reachable module graph.

Compiler dependencies are installed from their owning packages, and both workers use the server-owned
process supervision boundary. The image smoke step invokes both workers with absolute paths and
requires successful smoke compilation before image assembly completes.

## What is Ryot?

Ryot (**R**oll **Y**our **O**wn **T**racker), pronounced "riot", is a self-hosted tracker for your media consumption and fitness activities. Track the books you read, shows you watch, games you play, and workouts you complete - all in one place with a clean interface and insightful statistics.

## Demo

Try the [live demo](https://demo.ryot.io/_s/acl_vUMPnPirkHlT) to explore the interface. Demo data resets every 24 hours.

### Media Tracking

- Track movies, TV shows, anime, manga, books, audiobooks, podcasts, music and video games
- Import from Goodreads, Trakt, MyAnimeList, Audiobookshelf [and more](https://docs.ryot.io/importing/overview.html)
- Automatic tracking via Jellyfin, Plex, Kodi, Emby [integrations](https://docs.ryot.io/integrations/overview.html)

### Fitness

- Log workouts with a comprehensive exercise database
- Track body measurements over time
- Monitor progress with detailed graphs

<p align="center">
  <img src="apps/website/public/features/measurements-graph.png" alt="Workout tracking" width="250">
  <img src="apps/website/public/features/exercise-dataset.png" alt="Measurements" width="250">
</p>

### Technical

- Self-hosted with full data ownership
- TypeScript on [Bun](https://bun.sh) — [Hono](https://hono.dev) backend, [React](https://react.dev) + [TanStack Router](https://tanstack.com/router) frontend
- PostgreSQL with [Drizzle ORM](https://orm.drizzle.team), Redis-backed job queues via [BullMQ](https://docs.bullmq.io)
- [REST/OpenAPI](https://docs.ryot.io) API with auto-generated type-safe clients
- OpenID Connect [authentication](https://docs.ryot.io/guides/authentication.html)
- Notifications via Discord, Ntfy, Apprise
- Sandboxed user scripting powered by Deno subprocesses
- PWA support for mobile use

## Pro Version

Ryot Pro adds profile sharing, personalized recommendations, supercharged collections and more. [Learn more](https://ryot.io) about the pro version.

## Development

Prerequisites: [Bun](https://bun.sh) 1.4.0+, [Docker](https://www.docker.com) (for PostgreSQL and Redis).

```bash
bun install
docker compose up -d ryot-postgres ryot-redis
bun run dev
```

Configure `apps/server/.env` with `DATABASE_URL`, `REDIS_URL`, and `SERVER_ADMIN_ACCESS_TOKEN`.
Filesystem paths and `FRONTEND_URL` have development-ready defaults. The server development task
builds and watches the shipped plugin bundles and assembles the runtime layout automatically.

Other commands: `bun run build`, `bun run test`, `bun run check`.

## Community

Questions or feedback? Join the [Discord server](https://discord.gg/D9XTg2a7R8) or open a [GitHub issue](https://github.com/ignisda/ryot/issues).

## Acknowledgements

- Inspired by [MediaTracker](https://github.com/bonukai/MediaTracker)
- Exercise data from [Free Exercise DB](https://github.com/yuhonas/free-exercise-db)
- Thanks to all [contributors](https://github.com/IgnisDa/ryot/graphs/contributors)

<details>
<summary><strong>Migrating from v9?</strong></summary>

If you were using v9.\* of Ryot, please read the [migration guide](https://docs.ryot.io/migration.html#from-v9-to-v10) for instructions to upgrade to v10.

</details>
