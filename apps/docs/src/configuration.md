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
| `SERVER_IMPORTER_TRAKT_CLIENT_ID`    | The client ID issued by Trakt. **Required only** for Trakt username/public-list API imports, not ZIP exports. [More information](guides/trakt.md) |
| `ANIME_AND_MANGA_MAL_CLIENT_ID`      | The client ID issued by MyAnimeList. **Required** to enable MyAnimeList import. [More information](guides/anime-and-manga.md)     |

## Notification destinations

Ryot sends web notifications to public HTTPS endpoints by default. The same rules apply to test
notifications, automatic notifications, and destinations saved before an upgrade.

If you run Gotify, ntfy, or Apprise on a private network, set
`NOTIFICATIONS_ALLOW_PRIVATE_NETWORKS=true` in the Ryot backend's environment and restart Ryot.
This enables HTTP and HTTPS delivery to private destinations, including services on a home
network or a shared Docker network. For example, Ryot and Gotify on the same Docker network
can use `http://gotify` as the Gotify server URL.

Enable this setting only if you trust every account on the instance with access to your
private network. Leave it disabled on instances with open registration. Loopback addresses
such as `localhost` and link-local addresses stay blocked in both modes. Web notifications
connect directly to the configured endpoint, so use its final URL and port.

## Health endpoint

The `/health` endpoint can be used for checking service healthiness. More information
[here](https://learn.microsoft.com/en-us/azure/architecture/patterns/health-endpoint-monitoring).

## All parameters

Please refer to the `@env` annotations to know which environment variable to use for a
given configuration option.

<<< @/includes/backend-config-schema.yaml
