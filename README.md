<p align="center">
  <img src="/apps/frontend/public/ryot-logo.png" alt="Ryot Logo">
</p>

<h2 align="center">
  A self hosted platform for tracking various facets of your life - media, fitness etc.
</h2>

Ryot (**R**oll **Y**our **O**wn **T**racker), pronounced "riot", aims to be the only self
hosted tracker you will ever need!

## NOTE FOR EXISTING USERS

The first public release includes huge code changes. If you were running the `v1.0.0-beta.*`
versions, then please follow the migration notes for the latest release
[here](https://github.com/IgnisDa/ryot/releases/tag/v1.0.0). Please be warned that
failing to do so **WILL** result in data loss.

## 💻 Demo

You can use the demo instance hosted on [Fly.io](https://ryot.fly.dev). Login and register
with the username `demo` and password `demo-password`. This instance is automatically
deployed from the latest release.

**NOTE**: The data in this instance can be deleted randomly.

## 📝 ELI5

Imagine you have a special notebook where you can write down all the media you have
consumed, like books you've read, shows you have watched, video games you have played or
workouts you have done. Now, imagine that instead of a physical notebook, you have a
special tool on your computer or phone that lets you keep track of all these digitally.

## 💡 Why?

- Existing solutions do not have very good UI.
- Pretty graphs and summaries make everyone happy. Ryot aims to have a lot of them.
- There is a lack of a good selfhosted fitness and health tracking solution.
- Ryot consumes very little memory (around 10MB idle eyeballing `docker stats`), something
  that is significantly useful in RAM constrained environments.

## 🚀 Features

- ✅ [Supports](https://github.com/IgnisDa/ryot/discussions/4) tracking media
  and fitness.
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
- [Exporting](/docs/guides/exporting.md): Export your data from Ryot
- [Importing](/docs/guides/importing.md): Import data from various sources
- [Video Games](/docs/guides/video-games.md): Get video games tracking working

## ⌨️ How to use?

**NOTE**: The first user you register is automatically set as admin of the instance.

### 🐳 Option 1: Use Docker

To get a demo server running, use the docker image:

```bash
$ docker run \
  --detach \
  --name ryot \
  --pull always \
  --publish 8000:8000 \
  --env "WEB_INSECURE_COOKIE=true" \
  ghcr.io/ignisda/ryot:latest
```

**NOTE**: The `WEB_INSECURE_COOKIE` is only required if you are not running HTTPs.

In addition to the `latest` tag, we also publish an `unstable` tag from the latest
pre-release (or release, whichever is newer).

### 📦 Option 2: Quick-run a release

Each release has an installation script that can be used to install the `ryot`
binary. Follow the instructions in the release to use this script.

**Alternatively** using [eget](https://github.com/zyedidia/eget):

```bash
$ eget ignisda/ryot
```

### 🧑‍💻Option 3: Compile and run from source

- Install [moonrepo](https://moonrepo.dev/)

```bash
# Build the frontend
$ moon run frontend:build

# Run it
$ cargo run --bin ryot --release
```

## 👀 Production

You will have to mount a directory to the `/data`, giving it the `1001:1001`
permissions. It is also recommended to use PostgreSQL or MySQL in production.

## 🔧 Configuration options

You can specify configuration options via files (loaded from `config/ryot.json`,
`config/ryot.toml`, `config/ryot.yaml`) or via environment variables.

To set the equivalent environment variables, join keys by `_` (underscore) and
*UPPER_SNAKE_CASE* the characters. For example, the key `audio_books.audible.url`
corresponds to the environment variable `AUDIO_BOOKS_AUDIBLE_URL`.

Ryot serves the final configuration loaded at the `/config` endpoint as JSON
([example](https://ryot.fly.dev/config)).

**Note**: You can see the defaults in the [config](/apps/backend/src/config.rs) builder. A
minimal example configuration is in [`ryot.example.json`](/config/ryot.example.json).

| Key                                   | Description                                                                                                                                                                   |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `{anime,manga}.anilist.url`           | The url to make requests for getting metadata about anime/manga.                                                                                                              |
| `audio_books.audible.url`             | The url to make requests for getting metadata from Audible.                                                                                                                   |
| `books.openlibrary.url`               | The url to make requests for getting metadata from Openlibrary.                                                                                                               |
| `books.openlibrary.cover_image_url`   | The url for getting images from Openlibrary.                                                                                                                                  |
| `books.openlibrary.cover_image_size`  | The image sizes to fetch from Openlibrary.                                                                                                                                    |
| `database.url`                        | The database connection string. Supports SQLite, MySQL and Postgres.                                                                                                          |
| `database.scdb_url`                   | The path where [SCDB](https://docs.rs/scdb) will persist its storage.                                                                                                         |
| `file_storage.s3_access_key_id`       | The access key ID for the S3 compatible file storage. **Required** to enable file storage.                                                                                    |
| `file_storage.s3_bucket_name`         | The name of the S3 compatible bucket. **Required** to enable file storage.                                                                                                    |
| `file_storage.s3_secret_access_key`   | The secret access key for the S3 compatible file storage. **Required** to enable file storage.                                                                                |
| `file_storage.s3_region`              | The region for the S3 compatible file storage.                                                                                                                                |
| `file_storage.s3_url`                 | The URL for the S3 compatible file storage.                                                                                                                                   |
| `{movies,shows}.tmdb.url`             | The url to make requests for getting metadata about shows/movies.                                                                                                             |
| `{movies,shows}.tmdb.access_token`    | The access token for the TMDB API.                                                                                                                                            |
| `podcasts.listennotes.url`            | The url to make requests for getting metadata about podcasts.                                                                                                                 |
| `podcasts.listennotes.api_token`      | The access token for the Listennotes API. **Required** to enable podcasts tracking.                                                                                           |
| `scheduler.database_url`              | The url to the SQLite database where job related data needs to be stored.                                                                                                     |
| `scheduler.user_cleanup_every`        | Deploy a job every x hours that performs user cleanup and summary calculation.                                                                                                |
| `scheduler.rate_limit_num`            | The number of jobs to process every 5 seconds when updating metadata in the background.                                                                                       |
| `video_games.twitch.client_id`        | The client ID issues by Twitch. **Required** to enable video games tracking. [More information](/docs/guides/video-games.md)                                                  |
| `video_games.twitch.client_secret`    | The client secret issued by Twitch. **Required** to enable video games tracking.                                                                                              |
| `video_games.twitch.access_token_url` | The endpoint that issues access keys for IGDB.                                                                                                                                |
| `video_games.igdb.url`                | The url to make requests for getting metadata about video games.                                                                                                              |
| `video_games.igdb.image_url`          | The url for getting images from IGDB.                                                                                                                                         |
| `video_games.igdb.image_size`         | The image sizes to fetch from IGDB.                                                                                                                                           |
| `users.allow_changing_username`       | Whether users will be allowed to change their username in their profile settings.                                                                                             |
| `users.token_valid_for_days`          | The number of days till login auth token is valid.                                                                                                                            |
| `web.cors_origins`                    | An array of URLs for CORS.                                                                                                                                                    |
| `web.insecure_cookie`                 | This will make auth cookies insecure and should be set to `true` if you are running the server on `localhost`. [More information](https://github.com/IgnisDa/ryot/issues/23#) |

## 🤓 Developer notes

In production, the frontend is a pre-rendered Nextjs app served statically by the Axum
backend server.

In development, both servers are started independently running on `:3000` and `:8000`
respectively. To get them running, install [mprocs](https://github.com/pvolok/mprocs), and
run `mprocs` in the project root. If you do not want to install `mprocs`, take a look at
[`mproc.yaml`](/mprocs.yaml) to see what all commands are needed to get it working.

Unless it is a very small change, I prefer creating a separate branch and merging it via an
MR when it is done. The changelog is generated using
[git-chglog](https://github.com/git-chglog/git-chglog). Once all changes are done, run the
following command to update the changelog.

```bash
$ git-chglog --next-tag <tag-name> -o CHANGELOG.md
```

## 🙏 Acknowledgements

It is highly inspired by [MediaTracker](https://github.com/bonukai/MediaTracker). Moreover
thanks to all those people whose stuff I have used.

The logo is taken from
[Flaticon](https://www.flaticon.com/free-icon/mess_4789882?term=chaos&page=1&position=2&origin=tag&related_id=4789882).
