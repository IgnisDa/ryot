<h1 align="center">Ryot</h1>

<h3 align="center">
  A self-hosted platform for tracking media, fitness, and more.
</h3>

<div align="center">
  <a href="https://github.com/ignisda/ryot/stargazers">
    <img alt="GitHub Repo stars" src="https://img.shields.io/github/stars/ignisda/ryot">
  </a>
  <a href="https://github.com/ignisda/ryot/releases">
    <img alt="GitHub release" src="https://img.shields.io/github/v/release/ignisda/ryot">
  </a>
  <a href="https://github.com/ignisda/ryot/blob/main/LICENSE">
    <img alt="License" src="https://img.shields.io/badge/license-Elastic%202.0-purple">
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

## What is Ryot?

Ryot (**R**oll **Y**our **O**wn **T**racker), pronounced "riot", tracks media consumption and fitness activity in one place.

## Demo

Try the [live demo](https://demo.ryot.io/_s/acl_vUMPnPirkHlT). Its data resets every 24 hours.

### Media Tracking

- Track movies, TV shows, anime, manga, books, audiobooks, podcasts, music, and video games
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
- React DOM client with PWA and Capacitor mobile support

## Pro Version

Ryot Pro adds profile sharing, personalized recommendations, enhanced collections, and more. [Learn more](https://ryot.io).

## Community

Questions or feedback? Join the [Discord server](https://discord.gg/D9XTg2a7R8) or open a [GitHub issue](https://github.com/ignisda/ryot/issues).

## License

Ryot is source available under the [Elastic License 2.0](LICENSE). You may use,
modify, and redistribute it subject to the license's restrictions, including
the restrictions against offering Ryot as a hosted or managed service and
circumventing Pro license-key functionality.

Copyright 2023-2026 Diptesh Choudhuri and contributors. Diptesh Choudhuri is
the licensor.

## Acknowledgements

- Inspired by [MediaTracker](https://github.com/bonukai/MediaTracker)
- Exercise data from [Free Exercise DB](https://github.com/yuhonas/free-exercise-db)
- Thanks to all [contributors](https://github.com/IgnisDa/ryot/graphs/contributors)

<details>
<summary><strong>Migrating from v9?</strong></summary>

If you were using v9.\* of Ryot, please read the [migration guide](https://docs.ryot.io/migration.html#from-v9-to-v10) for instructions to upgrade to v10.

</details>
