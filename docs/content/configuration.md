# Configuration

You can specify configuration options via files (loaded from `config/ryot.json`,
`config/ryot.toml`, `config/ryot.yaml`) or via environment variables.

To set the equivalent environment variables, join keys by `_` (underscore) and
_UPPER_SNAKE_CASE_ the characters. For example, `video_games.twitch.client_id`
becomes `VIDEO_GAMES_TWITCH_CLIENT_ID`.

Ryot serves the final configuration loaded at the `/config` endpoint as JSON
([example](https://ryot.fly.dev/config)). This can also be treated as a [health
endpoint](https://learn.microsoft.com/en-us/azure/architecture/patterns/health-endpoint-monitoring).

!!! info

    The defaults can be inspected in the
    [config]({{ extra.file_path }}/apps/backend/src/config.rs) builder.

## Important parameters

| Key / Environment variable                                              | Description                                                                                                                                                                   |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| - / `PORT`                                                              | The port to listen on.                                                                                                                                                        |
| `database.url` / `DATABASE_URL`                                         | The database connection string. Supports SQLite, MySQL and Postgres.                                                                                                          |
| `video_games.twitch.client_id` / `VIDEO_GAMES_TWITCH_CLIENT_ID`         | The client ID issues by Twitch. **Required** to enable video games tracking. [More information](guides/video-games.md)                                                        |
| `video_games.twitch.client_secret` / `VIDEO_GAMES_TWITCH_CLIENT_SECRET` | The client secret issued by Twitch. **Required** to enable video games tracking.                                                                                              |
| `server.insecure_cookie` / `SERVER_INSECURE_COOKIE`                     | This will make auth cookies insecure and should be set to `true` if you are running the server on `localhost`. [More information](https://github.com/IgnisDa/ryot/issues/23#) |

## All parameters

The root is at the `AppConfig` interface.

```ts
{% include 'backend-config-schema.ts' %}
```
