# Configuration

You can specify configuration options via environment variables. Each option is documented
[below](#all-parameters) with what it does and a default (if any).

Ryot serves the final configuration loaded at the `/backend/config` endpoint as JSON
([example](https://demo.ryot.io/backend/config)). Sensitive variables are redacted.

## Important parameters

| Environment variable                 | Description                                                                                                                       |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `TZ`                                 | Timezone to be used for cron jobs. Accepts values according to the IANA database. Defaults to `GMT`.                              |
| `DISABLE_TELEMETRY`                  | Disables telemetry collection using [Umami](https://umami.is). Defaults to `false`.                                               |
| `DATABASE_URL`                       | The Postgres database connection string.                                                                                          |
| `MOVIES_AND_SHOWS_TMDB_ACCESS_TOKEN` | The access token issued by TMDB. **Required** to enable movies and shows tracking. [More information](guides/movies-and-shows.md) |
| `VIDEO_GAMES_TWITCH_CLIENT_ID`       | The client ID issued by Twitch. **Required** to enable video games tracking. [More information](guides/video-games.md)            |
| `VIDEO_GAMES_TWITCH_CLIENT_SECRET`   | The client secret issued by Twitch. **Required** to enable video games tracking.                                                  |
| `SERVER_IMPORTER_TRAKT_CLIENT_ID`    | The client ID issued by Trakt. **Required** to enable Trakt import. [More information](guides/trakt.md)                           |
| `ANIME_AND_MANGA_MAL_CLIENT_ID`      | The client ID issued by MyAnimeList. **Required** to enable MyAnimeList import. [More information](guides/anime-and-manga.md)     |

## Health endpoint

The `/health` endpoint can be used for checking service healthiness. More information
[here](https://learn.microsoft.com/en-us/azure/architecture/patterns/health-endpoint-monitoring).

## All parameters

Please refer to the `@env` annotations to know which environment variable to use for a
given parameter.

<<< @/includes/backend-config-schema.yaml
