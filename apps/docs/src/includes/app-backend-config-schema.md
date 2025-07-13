# App Backend Configuration Reference

> Auto-generated from the configuration definition. Do not edit manually.

## Core system configuration

| Variable | Description | Required | Default | Sensitive |
|---|---|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string for the primary database. See https://www.sea-ql.org/SeaORM/docs/install-and-config/connection/#postgres | Yes | `—` | Yes |
| `REDIS_URL` | Redis connection URL used for caching and the job queue | Yes | `—` | Yes |
| `FRONTEND_URL` | Public base URL of the frontend application | Yes | `—` | No |
| `PORT` | HTTP port the backend server listens on | No | `8000` | No |
| `NODE_ENV` | Runtime environment (development | production) | No | `production` | No |

### Server settings

| Variable | Description | Required | Default | Sensitive |
|---|---|---|---|---|
| `SERVER_ADMIN_ACCESS_TOKEN` | Secret token required for admin API operations | Yes | `—` | Yes |

### User account settings

| Variable | Description | Required | Default | Sensitive |
|---|---|---|---|---|
| `USERS_ALLOW_REGISTRATION` | Allow new users to self-register on this instance | No | `true` | No |

### S3-compatible file storage

| Variable | Description | Required | Default | Sensitive |
|---|---|---|---|---|
| `FILE_STORAGE_S3_URL` | Endpoint URL for the S3-compatible storage service | No | `—` | No |
| `FILE_STORAGE_S3_REGION` | AWS region or equivalent for the storage service | No | `—` | No |
| `FILE_STORAGE_S3_BUCKET_NAME` | Name of the storage bucket. Required to enable file storage | No | `—` | No |
| `FILE_STORAGE_S3_ACCESS_KEY_ID` | Access key ID credential for storage authentication | No | `—` | Yes |
| `FILE_STORAGE_S3_SECRET_ACCESS_KEY` | Secret access key credential for storage authentication | No | `—` | Yes |

## Provider integration configuration

### Book providers

#### Hardcover

| Variable | Description | Required | Default | Sensitive |
|---|---|---|---|---|
| `BOOKS_HARDCOVER_API_KEY` | API key for the Hardcover book database | No | `—` | Yes |

#### Google Books

| Variable | Description | Required | Default | Sensitive |
|---|---|---|---|---|
| `BOOKS_GOOGLE_BOOKS_API_KEY` | API key for the Google Books API | No | `—` | Yes |

### Anime and manga providers

#### MyAnimeList

| Variable | Description | Required | Default | Sensitive |
|---|---|---|---|---|
| `ANIME_AND_MANGA_MAL_CLIENT_ID` | Client ID for the MyAnimeList API | No | `—` | Yes |

### Music providers

#### Spotify

| Variable | Description | Required | Default | Sensitive |
|---|---|---|---|---|
| `MUSIC_SPOTIFY_CLIENT_ID` | OAuth client ID from the Spotify developer dashboard | No | `—` | Yes |
| `MUSIC_SPOTIFY_CLIENT_SECRET` | OAuth client secret from the Spotify developer dashboard | No | `—` | Yes |

### Podcast providers

#### ListenNotes

| Variable | Description | Required | Default | Sensitive |
|---|---|---|---|---|
| `PODCASTS_LISTENNOTES_API_KEY` | API key for the ListenNotes podcast search API | No | `—` | Yes |

### Movie and TV show providers

#### The Movie Database (TMDB)

| Variable | Description | Required | Default | Sensitive |
|---|---|---|---|---|
| `MOVIES_AND_SHOWS_TMDB_ACCESS_TOKEN` | Bearer token for the TMDB v4 API | No | `—` | Yes |

#### TheTVDB

| Variable | Description | Required | Default | Sensitive |
|---|---|---|---|---|
| `MOVIES_AND_SHOWS_TVDB_API_KEY` | API key for the TheTVDB API | No | `—` | Yes |

### Video game providers

#### Twitch (IGDB access)

| Variable | Description | Required | Default | Sensitive |
|---|---|---|---|---|
| `VIDEO_GAMES_TWITCH_CLIENT_ID` | Twitch client ID — required for IGDB API access. See https://api-docs.igdb.com/#account-creation | No | `—` | Yes |
| `VIDEO_GAMES_TWITCH_CLIENT_SECRET` | Twitch client secret — required for IGDB API access | No | `—` | Yes |

#### GiantBomb

| Variable | Description | Required | Default | Sensitive |
|---|---|---|---|---|
| `VIDEO_GAMES_GIANT_BOMB_API_KEY` | API key for the GiantBomb video game database | No | `—` | Yes |

### Comic book providers

#### Metron

| Variable | Description | Required | Default | Sensitive |
|---|---|---|---|---|
| `COMIC_BOOK_METRON_USERNAME` | Account username for the Metron comic database | No | `—` | Yes |
| `COMIC_BOOK_METRON_PASSWORD` | Account password for the Metron comic database | No | `—` | Yes |
