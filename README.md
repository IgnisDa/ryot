<p align="center">
  <img src="/apps/frontend/public/ryot-logo.png">
</p>

<h2 align="center">
  A self hosted platform for tracking various facets of your life - media,
  fitness etc.
</h2>

![Dashboard Screenshot](/docs/assets/dashboard-screenshot.png)
![Mine Screenshot](/docs/assets/mine-screenshot.png)

Ryot (**R**oll **Y**our **O**wn **T**racker), pronounced "riot", aims to be the
only self hosted tracker you will ever need!

## 📝 ELI5

Imagine you have a special notebook where you can write down all the books
you've read, movies and shows you've watched, audiobooks you've listened to, and
video games you've played. Now, imagine that instead of a physical notebook, you
have a special tool on your computer or phone that lets you keep track of all
these things digitally.

## 🚀 Features

- ✅ [Supports](https://github.com/IgnisDa/ryot/discussions/4) tracking media and fitness.
- ✅ Import data
  - Goodreads
  - MediaTracker
- ✅ Self-hosted
- ✅ Documented GraphQL API
- ✅ Easy to understand UI
- ✅ Lightning fast (written in Rust BTW)
- ✅ Free and open-source

## 🧪 Project Status

This project is still very much a WIP. Until it hits `1.0.0`, consider the project
to have breaking changes without any warning, for example backwards incompatible
schema changes. You can see the latest release
[here](https://github.com/IgnisDa/ryot/releases).

## 📖 Guides

Some things might not be obvious on how to setup or get working. I have written
a number of guides to make thing easier.

- [Deployment](/docs/guides/deployment.md): Deploy Ryot to various platforms
- [Importing](/docs/guides/importing.md): Import data from various sources
- [Video Games](/docs/guides/video-games.md): Get video games tracking working

## ⌨️ How to use?

**NOTE**: There is no default user. The first user you register is automatically
set as admin of the instance.

### 🐳 Option 1: Use Docker

To get a demo server running, use the docker image:

```bash
$ docker run --detach \
  --publish 8000:8000 \
  --volume ./ryot-data:/data \
  --volume ./config/ryot.example.json:/data/config/ryot.json \
  --name ryot \
  ghcr.io/ignisda/ryot:latest
```

### 🧑‍💻Option 2: Compile and run from source

- Install [moonrepo](https://moonrepo.dev/https://moonrepo.dev/)

```bash
# Build the frontend
$ moon run frontend:build

# Run it
$ cargo run --bin ryot --release
```

## 🔧 Configuration options

You can specify configuration options via files (loaded from `config/ryot.json`,
`config/ryot.toml`, `config/ryot.yaml`). You can see a minimal example in
[`config/ryot.example.json`](config/ryot.example.json). Ryot writes the
configuration loaded at runtime to `computed-config.ron` for debugging purposes.

Only the `DATABASE_URL` variable is loaded from the environment.

**Note**: You can see the defaults in the [config](apps/backend/src/config.rs)
builder.

| Key                                   | Description                                                                                                                                                                       |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `audio_books.audible.url`             | The url to make requests for getting metadata from Audible.                                                                                                                       |
| `books.openlibrary.url`               | The url to make requests for getting metadata from Openlibrary.                                                                                                                   |
| `books.openlibrary.cover_image_url`   | The url for getting images from Openlibrary.                                                                                                                                      |
| `books.openlibrary.cover_image_size`  | The image sizes to fetch from Openlibrary.                                                                                                                                        |
| `database.url`                        | The database connection string. Support SQLite, MySQL and Postgres.                                                                                                               |
| `importer.goodreads_rss_url`          | The url prefix to get the RSS feed from Goodreads. [More information](/docs/guides/importing.md)                                                                                  |
| `{movies,shows}.tmdb.url`             | The url to make requests for getting metadata about shows/movies.                                                                                                                 |
| `{movies,shows}.tmdb.access_token`    | The access token for the TMDB API.                                                                                                                                                |
| `podcasts.listennotes.url`            | The url to make requests for getting metadata about podcasts.                                                                                                                     |
| `podcasts.listennotes.api_token`      | The access token for the Listennotes API.                                                                                                                                         |
| `podcasts.listennotes.user_agent`     | The user agent used for the Listennotes API.                                                                                                                                      |
| `scheduler.database_url`              | The url to the SQLite database where job related data needs to be stored.                                                                                                         |
| `video_games.twitch.client_id`        | The client ID issues by Twitch. **Required** to enable video games tracking. [More information](/docs/guides/video-games.md)                                                      |
| `video_games.twitch.client_secret`    | The client secret issues by Twitch.                                                                                                                                               |
| `video_games.twitch.access_token_url` | The endpoint that issues access keys for IGDB.                                                                                                                                    |
| `video_games.igdb.url`                | The url to make requests for getting metadata about video games.                                                                                                                  |
| `video_games.igdb.image_url`          | The url for getting images from IGDB.                                                                                                                                             |
| `video_games.igdb.image_size`         | The image sizes to fetch from IGDB.                                                                                                                                               |
| `web.cors_origins`                    | An array of URLs for CORS.                                                                                                                                                        |
| `web.insecure_cookie`                 | Setting this to `true` will make auth cookies insecure. This should be set to `true` if you run it on `localhost`. [More information](https://github.com/IgnisDa/ryot/issues/23#) |

## 🤓 Developer notes

In production, the frontend is a pre-rendered Nextjs app served statically by the
Axum backend server.

In development, both servers are started independently running on `:3000` and
`:8000` respectively. To get them running, install [mprocs](https://github.com/pvolok/mprocs),
and run `mprocs` in the project root. If you do not want to install `mprocs`,
take a look at [`mproc.yaml`](./mprocs.yaml) to see what all commands are
needed to get it working.

## 🙏 Acknowledgements

It is highly inspired by [MediaTracker](https://github.com/bonukai/MediaTracker).
Moreover thanks to all those people whose stuff I have used.

The logo is taken from [Flaticon](https://www.flaticon.com/free-icon/mess_4789882?term=chaos&page=1&position=2&origin=tag&related_id=4789882).
