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
    <img alt="Discord" src="https://img.shields.io/discord/1115553491942154322?label=discord">
  </a>
</div>

<p align="center">
    <a href="https://docs.ryot.io" target="_blank">Documentation</a> •
    <a href="https://demo.ryot.io/_s/acl_vUMPnPirkHlT" target="_blank">Live Demo</a> •
    <a href="https://discord.gg/D9XTg2a7R8" target="_blank">Discord</a> •
    <a href="https://ryot.io" target="_blank">Pro Features</a>
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
    image: postgres:18-alpine
    restart: unless-stopped
    volumes:
      - postgres_storage:/var/lib/postgresql
    environment:
      - POSTGRES_PASSWORD=postgres

  ryot:
    image: ignisda/ryot:v10
    restart: unless-stopped
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=postgres://postgres:postgres@ryot-db:5432/postgres
      - SERVER_ADMIN_ACCESS_TOKEN=CHANGE_ME_TO_A_LONG_RANDOM_STRING

volumes:
  postgres_storage:
```

Then run `docker compose up -d` and visit `http://localhost:8000`. For production setups, see the [installation guide](https://docs.ryot.io).

## What is Ryot?

Ryot (**R**oll **Y**our **O**wn **T**racker), pronounced "riot", is a self-hosted tracker for your media consumption and fitness activities. Track the books you read, shows you watch, games you play, and workouts you complete - all in one place with a clean interface and insightful statistics.

## Features

### Media Tracking

- Track movies, TV shows, anime, manga, books, audiobooks, podcasts, music and video games
- Import from Goodreads, Trakt, MyAnimeList, Audiobookshelf [and more](https://docs.ryot.io/importing/overview.html)
- Automatic tracking via Jellyfin, Plex, Kodi, Emby [integrations](https://docs.ryot.io/integrations/overview.html)

### Fitness

- Log workouts with a comprehensive exercise database
- Track body measurements over time
- Monitor progress with detailed graphs

<p align="center">
  <img src="apps/website/public/features/current-workout.png" alt="Workout tracking" width="250">
  <img src="apps/website/public/features/measurements-graph.png" alt="Measurements" width="250">
</p>

### Technical

- Self-hosted with full data ownership
- OpenID Connect [authentication](https://docs.ryot.io/guides/authentication.html)
- Notifications via Discord, Ntfy, Apprise
- [GraphQL API](https://app.ryot.io/backend/graphql) for custom integrations
- PWA support for mobile use
- Written in Rust for performance

## Pro Version

Ryot Pro adds profile sharing, personalized recommendations, supercharged collections and more. [Learn more](https://ryot.io) about the pro version.

## Demo

Try the [live demo](https://demo.ryot.io/_s/acl_vUMPnPirkHlT) to explore the interface. Demo data resets every 24 hours.

## Community

Questions or feedback? Join the [Discord server](https://discord.gg/D9XTg2a7R8) or open a [GitHub issue](https://github.com/ignisda/ryot/issues).

## Acknowledgements

- Inspired by [MediaTracker](https://github.com/bonukai/MediaTracker)
- Exercise data from [Free Exercise DB](https://github.com/yuhonas/free-exercise-db)
- Thanks to all [contributors](https://github.com/IgnisDa/ryot/graphs/contributors)

<details>
<summary><strong>Migrating from v9?</strong></summary>

If you were using v9.* of Ryot, please read the [migration guide](https://docs.ryot.io/migration.html#from-v9-to-v10) for instructions to upgrade to v10.

</details>
