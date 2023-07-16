# Configuration

You can specify configuration options via files (loaded from `config/ryot.json`,
`config/ryot.toml`, `config/ryot.yaml`) or via environment variables.

To set the equivalent environment variables, join keys by `_` (underscore) and
_UPPER_SNAKE_CASE_ the characters.

Ryot serves the final configuration loaded at the `/config` endpoint as JSON
([example](https://ryot.fly.dev/config)). This can also be treated as a [health
endpoint](https://learn.microsoft.com/en-us/azure/architecture/patterns/health-endpoint-monitoring).

!!! note

    The defaults can be inspected in the
    [config]({{ extra.file_path }}/apps/backend/src/config.rs) builder.

## Important parameters

| Key / Environment variable                                                | Description                                                                                                                                                                   |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| - / `PORT`                                                                | The port to listen on.                                                                                                                                                        |
| `database.url` / `DATABASE_URL`                                           | The database connection string. Supports SQLite, MySQL and Postgres.                                                                                                          |
| `video_games.twitch.client_id` / `VIDEO_GAMES_TWITCH_CLIENT_ID`           | The client ID issues by Twitch. **Required** to enable video games tracking. [More information](guides/video-games.md)                                                        |
| `video_games.twitch.client_secret` / `VIDEO_GAMES_TWITCH_CLIENT_SECRET`   | The client secret issued by Twitch. **Required** to enable video games tracking.                                                                                              |
| `file_storage.s3_access_key_id` / `FILE_STORAGE_S3_ACCESS_KEY_ID`         | The access key ID for the S3 compatible file storage. **Required** to enable file storage. [More information](guides/fitness.md)                                              |
| `file_storage.s3_bucket_name` / `FILE_STORAGE_S3_BUCKET_NAME`             | The name of the S3 compatible bucket. **Required** to enable file storage.                                                                                                    |
| `file_storage.s3_secret_access_key` / `FILE_STORAGE_S3_SECRET_ACCESS_KEY` | The secret access key for the S3 compatible file storage. **Required** to enable file storage.                                                                                |
| `file_storage.s3_url` / `FILE_STORAGE_S3_URL`                             | The URL for the S3 compatible file storage.                                                                                                                                   |
| `server.insecure_cookie` / `SERVER_INSECURE_COOKIE`                       | This will make auth cookies insecure and should be set to `true` if you are running the server on `localhost`. [More information](https://github.com/IgnisDa/ryot/issues/23#) |

## All parameters

The root is at the `AppConfig` interface.

```ts
{% include 'includes/backend-config-schema.ts' %}
```
