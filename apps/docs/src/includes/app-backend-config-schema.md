# App Backend Configuration Reference

> This file is auto-generated on dev server startup. Do not edit manually.

## Application configuration

| App Config Key | Variable | Description | Required | Sensitive | Default |
|---|---|---|---|---|---|
| `port` | `PORT` | HTTP port the server listens on | No | No | `8000` |
| `timezone` | `TZ` | IANA timezone used for interpreting timezone-less datetimes during imports | No | No | `Etc/GMT` |
| `redisUrl` | `REDIS_URL` | Redis connection string | No | Yes | `redis://localhost:6379` |
| `frontendUrl` | `FRONTEND_URL` | Public URL of the frontend application | No | No | `http://localhost:3000` |
| `builtinExercisePreloadLimit` | `BUILTIN_EXERCISE_PRELOAD_LIMIT` | Maximum number of built-in exercise entities to preload | No | No | `873` |

### User account settings

| App Config Key | Variable | Description | Required | Sensitive | Default |
|---|---|---|---|---|---|
| `users.disableLocalAuth` | `USERS_DISABLE_LOCAL_AUTH` | Disable local email/password authentication, requiring OIDC | No | No | `false` |
| `users.allowRegistration` | `USERS_ALLOW_REGISTRATION` | Allow new users to register via email and password | No | No | `true` |

### Server settings

| App Config Key | Variable | Description | Required | Sensitive | Default |
|---|---|---|---|---|---|
| `server.corsOrigins` | `SERVER_CORS_ORIGINS` | Comma-separated list of allowed CORS origins | No | No | — |
| `server.adminAccessToken` | `SERVER_ADMIN_ACCESS_TOKEN` | Bearer token required for god-mode admin endpoints | No | Yes | `changeme` |

#### OIDC provider

| App Config Key | Variable | Description | Required | Sensitive | Default |
|---|---|---|---|---|---|
| `server.oidc.clientId` | `SERVER_OIDC_CLIENT_ID` | OIDC client ID | No | No | — |
| `server.oidc.issuerUrl` | `SERVER_OIDC_ISSUER_URL` | OIDC issuer URL | No | No | — |
| `server.oidc.clientSecret` | `SERVER_OIDC_CLIENT_SECRET` | OIDC client secret | No | Yes | — |

### Sandbox execution settings

| App Config Key | Variable | Description | Required | Sensitive | Default |
|---|---|---|---|---|---|
| `sandbox.denoDir` | `SANDBOX_DENO_DIR` | Directory used by Deno for caching modules inside the sandbox | No | No | `/tmp/ryot-sandbox-deno` |
| `sandbox.timeoutMs` | `SANDBOX_TIMEOUT_MS` | Maximum execution time for a sandbox job in milliseconds | No | No | `10000` |
| `sandbox.jobIdSecret` | `SANDBOX_JOB_ID_SECRET` | Secret used to sign sandbox job identifiers | No | Yes | `changeme` |
| `sandbox.workerConcurrency` | `SANDBOX_WORKER_CONCURRENCY` | Maximum number of concurrent sandbox jobs | No | No | `5` |

### Frontend display settings

| App Config Key | Variable | Description | Required | Sensitive | Default |
|---|---|---|---|---|---|
| `frontend.oidcButtonLabel` | `FRONTEND_OIDC_BUTTON_LABEL` | Label for the OIDC sign-in button | No | No | — |

### PostgreSQL connection settings

| App Config Key | Variable | Description | Required | Sensitive | Default |
|---|---|---|---|---|---|
| `database.url` | `DATABASE_URL` | PostgreSQL connection string | No | Yes | `postgres://postgres:postgres@localhost:5432/postgres` |
| `database.statementTimeoutMs` | `DATABASE_STATEMENT_TIMEOUT_MS` | Maximum milliseconds a single SQL statement may run before PostgreSQL aborts it; 0 disables. Transactions run uninterruptibly, so this bounds a stuck statement. Leave at 0 if long-running migrations are expected. | No | No | `0` |
| `database.connectionTimeoutMs` | `DATABASE_CONNECTION_TIMEOUT_MS` | Maximum milliseconds to wait when acquiring a PostgreSQL connection from the pool | No | No | `10000` |
| `database.idleInTransactionTimeoutMs` | `DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS` | Maximum milliseconds a transaction may sit idle holding locks before PostgreSQL aborts it; 0 disables | No | No | `0` |

### Scheduler settings

| App Config Key | Variable | Description | Required | Sensitive | Default |
|---|---|---|---|---|---|
| `scheduler.frequentCronJobsSchedule` | `SCHEDULER_FREQUENT_CRON_JOBS_SCHEDULE` | Interval phrase used to poll enabled yank integrations | No | No | `every 5 minutes` |
| `scheduler.progressUpdateThresholdHours` | `SERVER_PROGRESS_UPDATE_THRESHOLD` | Minimum hours between automatic progress updates for an entity | No | No | `2` |

### S3-compatible file storage

| App Config Key | Variable | Description | Required | Sensitive | Default |
|---|---|---|---|---|---|
| `fileStorage.url` | `FILE_STORAGE_S3_URL` | S3-compatible endpoint URL | No | No | — |
| `fileStorage.region` | `FILE_STORAGE_S3_REGION` | S3 bucket region | No | No | — |
| `fileStorage.bucketName` | `FILE_STORAGE_S3_BUCKET_NAME` | S3 bucket name | No | No | — |
| `fileStorage.accessKeyId` | `FILE_STORAGE_S3_ACCESS_KEY_ID` | S3 access key ID | No | Yes | — |
| `fileStorage.secretAccessKey` | `FILE_STORAGE_S3_SECRET_ACCESS_KEY` | S3 secret access key | No | Yes | — |

### Provider integration configuration

| App Config Key | Variable | Description | Required | Sensitive | Default |
|---|---|---|---|---|---|
| `providers.tvdbApiKey` | `MOVIES_AND_SHOWS_TVDB_API_KEY` | TVDB API key | No | Yes | — |
| `providers.malClientId` | `ANIME_AND_MANGA_MAL_CLIENT_ID` | MyAnimeList client ID for anime and manga lookups | No | No | — |
| `providers.traktClientId` | `SERVER_IMPORTER_TRAKT_CLIENT_ID` | Trakt client ID for the Trakt importer | No | No | — |
| `providers.metronUsername` | `COMIC_BOOK_METRON_USERNAME` | Metron username | No | No | — |
| `providers.twitchClientId` | `VIDEO_GAMES_TWITCH_CLIENT_ID` | Twitch client ID for IGDB video game lookups | No | No | — |
| `providers.metronPassword` | `COMIC_BOOK_METRON_PASSWORD` | Metron password | No | Yes | — |
| `providers.tmdbAccessToken` | `MOVIES_AND_SHOWS_TMDB_ACCESS_TOKEN` | TMDB access token for movie and show lookups | No | Yes | — |
| `providers.hardcoverApiKey` | `BOOKS_HARDCOVER_API_KEY` | Hardcover API key for the Hardcover book importer | No | Yes | — |
| `providers.spotifyClientId` | `MUSIC_SPOTIFY_CLIENT_ID` | Spotify client ID | No | No | — |
| `providers.giantBombApiKey` | `VIDEO_GAMES_GIANT_BOMB_API_KEY` | Giant Bomb API key for the Grouvee importer | No | Yes | — |
| `providers.googleBooksApiKey` | `BOOKS_GOOGLE_BOOKS_API_KEY` | Google Books API key for ISBN book lookups | No | Yes | — |
| `providers.listennotesApiKey` | `PODCASTS_LISTENNOTES_API_KEY` | ListenNotes API key | No | Yes | — |
| `providers.twitchClientSecret` | `VIDEO_GAMES_TWITCH_CLIENT_SECRET` | Twitch client secret for IGDB video game lookups | No | Yes | — |
| `providers.spotifyClientSecret` | `MUSIC_SPOTIFY_CLIENT_SECRET` | Spotify client secret | No | Yes | — |
