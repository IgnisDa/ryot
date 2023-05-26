<p align="center">
  <img src="/apps/frontend/public/ryot-logo.png" alt="Ryot Logo">
</p>

<h2 align="center">
  A self hosted platform for tracking various facets of your life - media,
  fitness etc.
</h2>

Ryot (**R**oll **Y**our **O**wn **T**racker), pronounced "riot", aims to be the
only self hosted tracker you will ever need!

## 💻 Demo

You can use the demo instance hosted on [Fly](https://ryot.fly.dev). Login and
register with the username `demo` and password `demo-password`. Please note
that the data in this instance can be deleted randomly.

## 📝 ELI5

Imagine you have a special notebook where you can write down all the media you
have consumed, like books you've read, shows you have watched, video games you
have played or workouts you have done. Now, imagine that instead of a physical
notebook, you have a special tool on your computer or phone that lets you keep
track of all these digitally.

## 🧪 Why?

- Existing solutions do not have very good UI.
- Pretty graphs and summaries make everyone happy. Ryot aims to have a lot of them.
- There is a lack of a good selfhosted fitness and health tracking solution.
- Ryot consumes very little memory (around 8MB idle eyeballing `docker stats`),
  something that is significantly useful when working in limited RAM environments.

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

## 📖 Guides

Some things might not be obvious on how to setup or get working. I have written
a number of guides to make thing easier.

- [Deployment](/docs/guides/deployment.md): Deploy Ryot to various platforms
- [Importing](/docs/guides/importing.md): Import data from various sources
- [Video Games](/docs/guides/video-games.md): Get video games tracking working

## ⌨️ How to use?

**NOTE**: The first user you register is automatically set as admin of the instance.

### 🐳 Option 1: Use Docker

To get a demo server running, use the docker image:

```bash
$ docker run --pull always \
  --detach \
  --publish 8000:8000 \
  --volume ./ryot-data:/data \
  --volume ./config/ryot.example.json:/data/config/ryot.json \
  --name ryot \
  ghcr.io/ignisda/ryot:latest
```

### 🧑‍💻Option 2: Compile and run from source

- Install [moonrepo](https://moonrepo.dev/)

```bash
# Build the frontend
$ moon run frontend:build

# Run it
$ cargo run --bin ryot --release
```

## 🔧 Configuration options

You can specify configuration options via files (loaded from `config/ryot.json`,
`config/ryot.toml`, `config/ryot.yaml`). or via environment variables.

Environment config variables are split by the `__` delimiter. For example,
the key `audio_books.audible.url` corresponds to the environment variable
`AUDIO_BOOKS__AUDIBLE__URL`. The only exception to the `__` delimiter rule is
the `DATABASE_URL` environment variable which will be loaded directly.

Ryot writes the final configuration loaded at runtime to `computed-config.ron`
for debugging purposes.

**Note**: You can see the defaults in the [config](/apps/backend/src/config.rs)
builder. You can see a minimal example configuration in 
[`ryot.example.json`](/config/ryot.example.json).

| Key                                   | Description                                                                                                                                                                   |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `audio_books.audible.url`             | The url to make requests for getting metadata from Audible.                                                                                                                   |
| `books.openlibrary.url`               | The url to make requests for getting metadata from Openlibrary.                                                                                                               |
| `books.openlibrary.cover_image_url`   | The url for getting images from Openlibrary.                                                                                                                                  |
| `books.openlibrary.cover_image_size`  | The image sizes to fetch from Openlibrary.                                                                                                                                    |
| `database.url`                        | The database connection string. Supports SQLite, MySQL and Postgres.                                                                                                          |
| `{movies,shows}.tmdb.url`             | The url to make requests for getting metadata about shows/movies.                                                                                                             |
| `{movies,shows}.tmdb.access_token`    | The access token for the TMDB API.                                                                                                                                            |
| `podcasts.listennotes.url`            | The url to make requests for getting metadata about podcasts.                                                                                                                 |
| `podcasts.listennotes.api_token`      | The access token for the Listennotes API.                                                                                                                                     |
| `podcasts.listennotes.user_agent`     | The user agent used for the Listennotes API.                                                                                                                                  |
| `scheduler.database_url`              | The url to the SQLite database where job related data needs to be stored.                                                                                                     |
| `scheduler.user_cleanup_every`        | Deploy a job every x minutes that performs user cleanup and summary calculation.                                                                                              |
| `video_games.twitch.client_id`        | The client ID issues by Twitch. **Required** to enable video games tracking. [More information](/docs/guides/video-games.md)                                                  |
| `video_games.twitch.client_secret`    | The client secret issued by Twitch.                                                                                                                                           |
| `video_games.twitch.access_token_url` | The endpoint that issues access keys for IGDB.                                                                                                                                |
| `video_games.igdb.url`                | The url to make requests for getting metadata about video games.                                                                                                              |
| `video_games.igdb.image_url`          | The url for getting images from IGDB.                                                                                                                                         |
| `video_games.igdb.image_size`         | The image sizes to fetch from IGDB.                                                                                                                                           |
| `web.cors_origins`                    | An array of URLs for CORS.                                                                                                                                                    |
| `web.insecure_cookie`                 | This will make auth cookies insecure and should be set to `true` if you are running the server on `localhost`. [More information](https://github.com/IgnisDa/ryot/issues/23#) |

## 🤓 Developer notes

In production, the frontend is a pre-rendered Nextjs app served statically by the
Axum backend server.

In development, both servers are started independently running on `:3000` and
`:8000` respectively. To get them running, install [mprocs](https://github.com/pvolok/mprocs),
and run `mprocs` in the project root. If you do not want to install `mprocs`,
take a look at [`mproc.yaml`](/mprocs.yaml) to see what all commands are
needed to get it working.

## 🙏 Acknowledgements

It is highly inspired by [MediaTracker](https://github.com/bonukai/MediaTracker).
Moreover thanks to all those people whose stuff I have used.

The logo is taken from [Flaticon](https://www.flaticon.com/free-icon/mess_4789882?term=chaos&page=1&position=2&origin=tag&related_id=4789882).
