# Configuration

You can specify configuration options via environment variables. Each option is documented
[below](#all-parameters) with what it does and a default (if any).

Ryot serves the final configuration loaded at the `/api/system/config` endpoint as JSON
([example](https://demo.ryot.io/backend/config)). Sensitive variables are redacted.

## Important parameters

| Environment variable                     | Description                                                                                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REDIS_URL`                              | Redis connection string. **Required**.                                                                                                            |
| `DATABASE_URL`                           | The Postgres database connection string. **Required**.                                                                                            |
| `SERVER_ADMIN_ACCESS_TOKEN`              | Bearer token guarding the god-mode admin endpoints. **Required**.                                                                                 |
| `TZ`                                     | Timezone used to interpret timezone-less datetimes during imports. Accepts values according to the IANA database. Defaults to `Etc/GMT`.          |
| `FRONTEND_URL`                           | Public URL of the frontend application. Defaults to `https://app.ryot.io`.                                                                        |
| `DISABLE_TELEMETRY`                      | Disables usage analytics collected using [Umami](https://umami.is). Defaults to `false`.                                                          |
| `RYOT_PLUGIN_MEDIA_MAL_CLIENT_ID`        | The client ID issued by MyAnimeList. **Required** to enable MyAnimeList tracking and import. [More information](guides/anime-and-manga.md)        |
| `RYOT_PLUGIN_MEDIA_TRAKT_CLIENT_ID`      | The client ID issued by Trakt. **Required only** for Trakt username/public-list API imports, not ZIP exports. [More information](guides/trakt.md) |
| `RYOT_PLUGIN_MEDIA_TWITCH_CLIENT_ID`     | The client ID issued by Twitch. **Required** to enable video games tracking. [More information](guides/video-games.md)                            |
| `RYOT_PLUGIN_MEDIA_TWITCH_CLIENT_SECRET` | The client secret issued by Twitch. **Required** to enable video games tracking.                                                                  |
| `RYOT_PLUGIN_MEDIA_TVDB_API_KEY`         | The API key issued by TVDB. **Required** to enable movies and shows tracking via TVDB. [More information](guides/movies-and-shows.md)             |
| `RYOT_PLUGIN_MEDIA_TMDB_ACCESS_TOKEN`    | The access token issued by TMDB. **Required** to enable movies and shows tracking via TMDB. [More information](guides/movies-and-shows.md)        |

## Health endpoint

The `/api/system/health` endpoint can be used for checking service healthiness. More
information [here](https://learn.microsoft.com/en-us/azure/architecture/patterns/health-endpoint-monitoring).

## All parameters

Please refer to the `@env` annotations to know which environment variable to use for a
given configuration option.

<!--@include: @/includes/app-backend-config-schema.md{5,}-->
