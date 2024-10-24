# Configuration

You can specify configuration options via environment variables. Each option is documented
[below](#all-parameters) with what it does and a default (if any).

Ryot serves the final configuration loaded at the `/backend/config` endpoint as JSON
([example](https://pro.ryot.io/backend/config)). Sensitive variables are redacted.

## Important parameters

| Environment variable               | Description                                                                                                            |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `PORT`                             | The port to listen on. Defaults to `8000`.                                                                             |
| `TZ`                               | Timezone to be used for cron jobs. Accepts values according to the IANA database. Defaults to `GMT`.                   |
| `DISABLE_TELEMETRY`                | Disables telemetry collection using [Umami](https://umami.is). Defaults to `false`.                                    |
| `DATABASE_URL`                     | The Postgres database connection string.                                                                               |
| `VIDEO_GAMES_TWITCH_CLIENT_ID`     | The client ID issued by Twitch. **Required** to enable video games tracking. [More information](guides/video-games.md) |
| `VIDEO_GAMES_TWITCH_CLIENT_SECRET` | The client secret issued by Twitch. **Required** to enable video games tracking.                                       |

## Health endpoint

The `/health` endpoint can be used for checking service healthiness. More information
[here](https://learn.microsoft.com/en-us/azure/architecture/patterns/health-endpoint-monitoring).

## All parameters

```yaml
{% include 'backend-config-schema.yaml' %}
```
