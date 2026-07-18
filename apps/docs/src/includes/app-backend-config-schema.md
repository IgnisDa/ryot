# App Backend Configuration Reference

> This file is auto-generated on dev server startup. Do not edit manually.

## Application configuration

| App Config Key | Variable | Description | Required | Sensitive | Default |
|---|---|---|---|---|---|
| `port` | `PORT` | HTTP port the server listens on | No | No | `8000` |
| `timezone` | `TZ` | IANA timezone used for interpreting timezone-less datetimes during imports | No | No | `Etc/GMT` |
| `redisUrl` | `REDIS_URL` | Redis connection string | Yes | Yes | — |
| `frontendUrl` | `FRONTEND_URL` | Public URL of the frontend application | No | No | `http://localhost:3000` |

### User account settings

| App Config Key | Variable | Description | Required | Sensitive | Default |
|---|---|---|---|---|---|
| `users.disableLocalAuth` | `USERS_DISABLE_LOCAL_AUTH` | Disable local email/password authentication, requiring OIDC | No | No | `false` |
| `users.allowRegistration` | `USERS_ALLOW_REGISTRATION` | Allow new users to register via email and password | No | No | `true` |

### Server settings

| App Config Key | Variable | Description | Required | Sensitive | Default |
|---|---|---|---|---|---|
| `server.logLevel` | `SERVER_LOG_LEVEL` | Minimum application log level | No | No | `info` |
| `server.logFile` | `SERVER_LOG_FILE` | File path for appended structured logs | No | No | — |
| `server.corsOrigins` | `SERVER_CORS_ORIGINS` | Comma-separated list of allowed CORS origins | No | No | — |
| `server.otlpEndpoint` | `SERVER_OTLP_ENDPOINT` | Base URL for OTLP trace export | No | No | — |
| `server.adminAccessToken` | `SERVER_ADMIN_ACCESS_TOKEN` | Bearer token required for god-mode admin endpoints | Yes | Yes | — |
| `server.disableNotifications` | `SERVER_DISABLE_NOTIFICATIONS` | Disable delivery of all notifications | No | No | `false` |

#### OIDC provider

| App Config Key | Variable | Description | Required | Sensitive | Default |
|---|---|---|---|---|---|
| `server.oidc.clientId` | `SERVER_OIDC_CLIENT_ID` | OIDC client ID | No | No | — |
| `server.oidc.issuerUrl` | `SERVER_OIDC_ISSUER_URL` | OIDC issuer URL | No | No | — |
| `server.oidc.clientSecret` | `SERVER_OIDC_CLIENT_SECRET` | OIDC client secret | No | Yes | — |

#### SMTP delivery settings

| App Config Key | Variable | Description | Required | Sensitive | Default |
|---|---|---|---|---|---|
| `server.smtp.user` | `SERVER_SMTP_USER` | SMTP username | No | Yes | — |
| `server.smtp.server` | `SERVER_SMTP_SERVER` | SMTP server hostname | No | No | — |
| `server.smtp.mailbox` | `SERVER_SMTP_MAILBOX` | SMTP sender mailbox | No | No | `Ryot <no-reply@ryot.io>` |
| `server.smtp.password` | `SERVER_SMTP_PASSWORD` | SMTP password | No | Yes | — |

### Sandbox execution settings

| App Config Key | Variable | Description | Required | Sensitive | Default |
|---|---|---|---|---|---|
| `sandbox.denoDir` | `SANDBOX_DENO_DIR` | Directory used for the local sandbox dependency runtime and Deno cache | No | No | `/tmp/ryot-sandbox-deno` |
| `sandbox.jobIdSecret` | `SANDBOX_JOB_ID_SECRET` | Secret used to sign sandbox job identifiers | No | Yes | `changeme` |

### PostgreSQL connection settings

| App Config Key | Variable | Description | Required | Sensitive | Default |
|---|---|---|---|---|---|
| `database.url` | `DATABASE_URL` | PostgreSQL connection string | Yes | Yes | — |
| `database.poolMax` | `DATABASE_POOL_MAX` | Maximum number of PostgreSQL connections held in the pool | No | No | `10` |
| `database.workflowPoolMax` | `DATABASE_WORKFLOW_POOL_MAX` | Maximum number of PostgreSQL connections held in the dedicated workflow engine pool | No | No | `10` |
| `database.connectionTimeoutMs` | `DATABASE_CONNECTION_TIMEOUT_MS` | Maximum milliseconds to wait when acquiring a PostgreSQL connection from the pool | No | No | `10000` |

### Frontend display settings

| App Config Key | Variable | Description | Required | Sensitive | Default |
|---|---|---|---|---|---|
| `frontend.oidcButtonLabel` | `FRONTEND_OIDC_BUTTON_LABEL` | Label for the OIDC sign-in button | No | No | — |

### Scheduler settings

| App Config Key | Variable | Description | Required | Sensitive | Default |
|---|---|---|---|---|---|
| `scheduler.disableDispatchers` | `SCHEDULER_DISABLE_DISPATCHERS` | Disable automatic scheduler dispatchers (the frequent/infrequent cron tiers, plugin manifest crons, and the one-time plugin boot dispatcher) | No | No | `false` |
| `scheduler.frequentCronJobsSchedule` | `SCHEDULER_FREQUENT_CRON_JOBS_SCHEDULE` | Interval phrase for the frequent cron tier | No | No | `every 5 minutes` |
| `scheduler.infrequentCronJobsSchedule` | `SCHEDULER_INFREQUENT_CRON_JOBS_SCHEDULE` | Cron expression used by plugin crons assigned to the infrequent tier | No | No | `0 0 * * *` |

### S3-compatible file storage

| App Config Key | Variable | Description | Required | Sensitive | Default |
|---|---|---|---|---|---|
| `fileStorage.url` | `FILE_STORAGE_S3_URL` | S3-compatible endpoint URL | No | No | — |
| `fileStorage.region` | `FILE_STORAGE_S3_REGION` | S3 bucket region | No | No | — |
| `fileStorage.bucketName` | `FILE_STORAGE_S3_BUCKET_NAME` | S3 bucket name | No | No | — |
| `fileStorage.accessKeyId` | `FILE_STORAGE_S3_ACCESS_KEY_ID` | S3 access key ID | No | Yes | — |
| `fileStorage.secretAccessKey` | `FILE_STORAGE_S3_SECRET_ACCESS_KEY` | S3 secret access key | No | Yes | — |

## Media plugin configuration

| Plugin Config Key | Variable | Label | Description | Required | Sensitive | Default |
|---|---|---|---|---|---|---|
| `media.tvdbApiKey` | `RYOT_PLUGIN_MEDIA_TVDB_API_KEY` | TVDB API key | API key used to access TVDB metadata | No | Yes | — |
| `media.tmdbAccessToken` | `RYOT_PLUGIN_MEDIA_TMDB_ACCESS_TOKEN` | TMDB access token | Access token used to access TMDB metadata | No | Yes | — |
| `media.malClientId` | `RYOT_PLUGIN_MEDIA_MAL_CLIENT_ID` | MyAnimeList client ID | Client ID used to access MyAnimeList metadata | No | No | — |
| `media.metronUsername` | `RYOT_PLUGIN_MEDIA_METRON_USERNAME` | Metron username | Username used to access Metron metadata | No | No | — |
| `media.metronPassword` | `RYOT_PLUGIN_MEDIA_METRON_PASSWORD` | Metron password | Password used to access Metron metadata | No | Yes | — |
| `media.hardcoverApiKey` | `RYOT_PLUGIN_MEDIA_HARDCOVER_API_KEY` | Hardcover API key | API key used to access Hardcover metadata | No | Yes | — |
| `media.googleBooksApiKey` | `RYOT_PLUGIN_MEDIA_GOOGLE_BOOKS_API_KEY` | Google Books API key | API key used to access Google Books metadata | No | Yes | — |
| `media.spotifyClientId` | `RYOT_PLUGIN_MEDIA_SPOTIFY_CLIENT_ID` | Spotify client ID | Client ID used to access Spotify metadata | No | No | — |
| `media.spotifyClientSecret` | `RYOT_PLUGIN_MEDIA_SPOTIFY_CLIENT_SECRET` | Spotify client secret | Client secret used to access Spotify metadata | No | Yes | — |
| `media.listennotesApiKey` | `RYOT_PLUGIN_MEDIA_LISTENNOTES_API_KEY` | Listen Notes API key | API key used to access Listen Notes metadata | No | Yes | — |
| `media.twitchClientId` | `RYOT_PLUGIN_MEDIA_TWITCH_CLIENT_ID` | Twitch client ID | Client ID used to access IGDB metadata | No | No | — |
| `media.twitchClientSecret` | `RYOT_PLUGIN_MEDIA_TWITCH_CLIENT_SECRET` | Twitch client secret | Client secret used to access IGDB metadata | No | Yes | — |
| `media.giantBombApiKey` | `RYOT_PLUGIN_MEDIA_GIANT_BOMB_API_KEY` | Giant Bomb API key | API key used to access Giant Bomb metadata | No | Yes | — |
| `media.traktClientId` | `RYOT_PLUGIN_MEDIA_TRAKT_CLIENT_ID` | Trakt client ID | Client ID used to import data from Trakt | No | No | — |
| `media.progressUpdateThresholdHours` | `RYOT_PLUGIN_MEDIA_PROGRESS_UPDATE_THRESHOLD_HOURS` | Progress update threshold | Hours used to debounce repeated completion updates | No | No | `2` |

## Fitness plugin configuration

| Plugin Config Key | Variable | Label | Description | Required | Sensitive | Default |
|---|---|---|---|---|---|---|
| `fitness.exercisePreloadLimit` | `RYOT_PLUGIN_FITNESS_EXERCISE_PRELOAD_LIMIT` | Exercise preload limit | Maximum number of built-in exercises preloaded during startup | No | No | `873` |
