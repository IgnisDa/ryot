# Configuration

Set configuration with environment variables. The [generated reference](#all-parameters) lists
each variable, default, and secret status.

Ryot serves the final configuration loaded at the `/api/system/config` endpoint as JSON
([example](https://demo.ryot.io/api/system/config)). Sensitive variables are redacted.

## Important parameters

| Variable                    | Purpose                                                                 |
| --------------------------- | ----------------------------------------------------------------------- |
| `DATABASE_URL`              | Required PostgreSQL connection string.                                  |
| `REDIS_URL`                 | Required Redis connection string.                                       |
| `SERVER_ADMIN_ACCESS_TOKEN` | Required bearer token for god-mode administration. Use a long secret.   |
| `FRONTEND_URL`              | Public frontend origin. It controls authentication and trusted origins. |
| `TZ`                        | IANA time zone for imports with no time zone. Default: `Etc/GMT`.       |
| `DISABLE_TELEMETRY`         | Set to `true` to disable Umami usage analytics. Default: `false`.       |

Provider setup is documented in [Guides](guides/movies-and-shows.md). The generated reference
below is authoritative for environment variable names.

## Health endpoint

Use `/api/system/health` for service health checks.

## All parameters

<!--@include: @/includes/app-backend-config-schema.md{5,}-->
