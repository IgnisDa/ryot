# Configuration

You can specify configuration options via environment variables or via files (loaded from
`config/ryot.json`, `config/ryot.toml`, `config/ryot.yaml`). They should be present in `/home/ryot/config/ryot.<ext>`.

Ryot serves the final configuration loaded at the `/backend/config` endpoint as JSON
([example](https://pro.ryot.io/backend/config)).

## Important parameters

| Key / Environment variable                                              | Description                                                                                                            |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| - / `PORT`                                                              | The port to listen on. Defaults to `8000`.                                                                             |
| - / `TZ`                                                                | Timezone to be used for cron jobs. Accepts values according to the IANA database. Defaults to `GMT`.                   |
| `disable_telemetry` / `DISABLE_TELEMETRY`                               | Disables telemetry collection using [Umami](https://umami.is). Defaults to `false`.                                    |
| `database.url` / `DATABASE_URL`                                         | The Postgres database connection string.                                                                               |
| `video_games.twitch.client_id` / `VIDEO_GAMES_TWITCH_CLIENT_ID`         | The client ID issued by Twitch. **Required** to enable video games tracking. [More information](guides/video-games.md) |
| `video_games.twitch.client_secret` / `VIDEO_GAMES_TWITCH_CLIENT_SECRET` | The client secret issued by Twitch. **Required** to enable video games tracking.                                       |

## Health endpoint

The `/health` endpoint can be used for checking service healthiness. More information
[here](https://learn.microsoft.com/en-us/azure/architecture/patterns/health-endpoint-monitoring).

## All parameters

```yaml
{% include 'backend-config-schema.yaml' %}
```
