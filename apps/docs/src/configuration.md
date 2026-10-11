# Configuration

Set configuration with environment variables. The [generated reference](#all-parameters) lists
each variable, default, and secret status.

Ryot serves the final configuration loaded at the `/api/system/config` endpoint as JSON
([example](https://demo.ryot.io/api/system/config)). Sensitive variables are redacted.

## Important parameters

| Variable                    | Purpose                                                                     |
| --------------------------- | --------------------------------------------------------------------------- |
| `DATABASE_URL`              | Required PostgreSQL connection string.                                      |
| `REDIS_URL`                 | Required Redis connection string.                                           |
| `SERVER_ADMIN_ACCESS_TOKEN` | Required bearer token for instance-admin administration. Use a long secret. |
| `FRONTEND_URL`              | Public frontend origin. It controls authentication and trusted origins.     |
| `TZ`                        | IANA time zone for plugin cron schedules. Default: `Etc/GMT`.               |
| `DISABLE_TELEMETRY`         | Set to `true` to disable Umami usage analytics. Default: `false`.           |

Provider setup is documented in [Guides](guides/movies-and-shows.md). The generated reference
below is authoritative for environment variable names.

System plugin variables use the package ID's publisher and name, uppercased with `-` replaced by
`_`: `RYOT_PLUGIN__<PUBLISHER>__<NAME>__<SETTING>`. For Media (`ryot/media`), the prefix is
`RYOT_PLUGIN__RYOT__MEDIA__`. Display names can change without changing these keys. Private
plugins use their installation settings, never these environment variables.

If you run multiple server replicas, use the same server/runtime release and deployment settings
on every replica. Mixed-release rolling upgrades are not supported.

## Health endpoint

Use `/api/system/health` for service health checks.

## All parameters

<!--@include: @/includes/app-backend-config-schema.md{5,}-->
