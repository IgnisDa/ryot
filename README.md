<h1 align="center">Ryot</h1>

<h3 align="center">
  A self hosted platform for tracking various facets of your life - media,
  fitness etc.
</h3>

Ryot (**R**oll **Y**our **O**wn **T**racker), pronounced "riot", aims to be the
only self hosted tracker you will ever need!

## 🚀 Features

- ✅ Free and open-source
- ✅ [Importing data](./docs/guides/importing.md)
  - Goodreads
  - MediaTracker
- ✅ Supports tracking media (audio books, books, movies, shows, video games)
  and fitness (exercises) (https://github.com/IgnisDa/ryot/discussions/4)
- ✅ Built by developers for developers
- ✅ GraphQL API
- ✅ Lightning fast
- ✅ Self-hosted

## 🔧 Configuration options

You can specify configuration options via files (loaded from `config/ryot.json`,
`config/ryot.toml`, `config/ryot.yaml`). You can see a minimal example in
[`config/ryot.example.json`](config/ryot.example.json).

An overview of all options.
Only the `DATABASE_URL` variable is loaded from the environment.

**Note**: You can see the defaults in the [config](apps/backend/src/config.rs)
builder.

| Key                                   | Description                                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `audio_books.audible.url`             | The url to make requests for getting metadata from Audible.                                                              |
| `books.openlibrary.url`               | The url to make requests for getting metadata from Openlibrary.                                                          |
| `books.openlibrary.cover_image_url`   | The url for getting images from Openlibrary.                                                                             |
| `books.openlibrary.cover_image_size`  | The image sizes to fetch from Openlibrary.                                                                               |
| `books.openlibrary.cover_image_size`  | The image sizes to fetch from Openlibrary.                                                                               |
| `database.url`                        | The database connection string. Support SQLite, MySQL and Postgres.                                                      |
| `importer.goodreads_rss_url`          | The url prefix to get the RSS feed from Goodreads. [More information](/docs/guides/importing.md)                                                                      |
| `{movies,shows}.tmdb.url`             | The url to make requests for getting metadata about shows/movies.                                                        |
| `{movies,shows}.tmdb.access_token`    | The access token for the TMDB API.                                                                                       |
| `video_games.twitch.client_id`        | The client ID issues by Twitch. **Required** to enable video games tracking. [More information](/docs/guides/video-games.md) |
| `video_games.twitch.client_secret`    | The client secret issues by Twitch.                                                                                      |
| `video_games.twitch.access_token_url` | The endpoint that issues access keys for IGDB.                                                                           |
| `video_games.igdb.url`                | The url to make requests for getting metadata about video games.                                                         |
| `video_games.igdb.image_url`          | The url for getting images from IGDB.                                                                                    |
| `video_games.igdb.image_size`         | The image sizes to fetch from IGDB.                                                                                      |
| `web.cors_origins`                    | An array of URLs for CORS.                                                                                               |

## 🧪  Project Status

This project is still very much a WIP. Until it hits `1.0.0`, consider the project
to have breaking changes without any warning, for example backwards incompatible
schema changes. You can see the latest release
[here](https://github.com/IgnisDa/ryot/releases).

## ⌨️ How to use?

**NOTE**: There is no default user. The first user you register is automatically
set as admin of the instance.

### 🐳 Option 1: Use Docker

To get a demo server running, use the docker image:

```bash
$ docker run --detach \
  --publish 8000:8000 \
  --volume ./ryot-data:/data \
  --name ryot \
  ghcr.io/ignisda/ryot:latest
```

### 🧑‍💻 Option 2: Compile and run from source

- Install [moonrepo](https://moonrepo.dev/https://moonrepo.dev/)

```bash
# Build the frontend
$ moon run frontend:build

# Run it
$ cargo run --bin ryot --release
```

## 🤓 Developer notes

Ryot is an Axum server running in the backend. The frontend is a pre-rendered
Nextjs app served statically by the backend server.

To get the servers running, install [mprocs](https://github.com/pvolok/mprocs),
and run `mprocs` in the project root and access the frontend at
http://localhost:3000 and backend at http://localhost:8000. If you do not want
to install it, take a look at [`mproc.yaml`](./mprocs.yaml) to see what all
commands are needed to get it working.

## 🙏 Acknowledgements

It is highly inspired by [MediaTracker](https://github.com/bonukai/MediaTracker).
Moreover thanks to all those people whose stuff I have used.
