# App Backend Configuration Reference

> This file is auto-generated on dev server startup. Do not edit manually.

## Core system configuration

| Variable | Description | Required | Default |
|---|---|---|---|
| `PORT` | HTTP port the server listens on | No | `8000` |
| `TZ` | IANA timezone used for interpreting timezone-less datetimes during imports | No | `Etc/GMT` |
| `REDIS_URL` | Redis connection string | No | `redis://localhost:6379` |
| `FRONTEND_URL` | Public URL of the frontend application | No | `http://localhost:3000` |
| `DATABASE_URL` | PostgreSQL connection string | No | `postgres://postgres:postgres@localhost:5432/postgres` |

### User account settings

| Variable | Description | Required | Default |
|---|---|---|---|
| `USERS_DISABLE_LOCAL_AUTH` | Disable local email/password authentication, requiring OIDC | No | `false` |
| `USERS_ALLOW_REGISTRATION` | Allow new users to register via email and password | No | `true` |

### Server settings

| Variable | Description | Required | Default |
|---|---|---|---|
| `SERVER_CORS_ORIGINS` | Comma-separated list of allowed CORS origins | No | — |
| `SERVER_ADMIN_ACCESS_TOKEN` | Bearer token required for god-mode admin endpoints | No | `changeme` |

#### OIDC provider

| Variable | Description | Required | Default |
|---|---|---|---|
| `SERVER_OIDC_CLIENT_ID` | OIDC client ID | No | — |
| `SERVER_OIDC_ISSUER_URL` | OIDC issuer URL | No | — |
| `SERVER_OIDC_CLIENT_SECRET` | OIDC client secret | No | — |

### Sandbox execution settings

| Variable | Description | Required | Default |
|---|---|---|---|
| `SANDBOX_DENO_DIR` | Directory used by Deno for caching modules inside the sandbox | No | `/tmp/ryot-sandbox-deno` |
| `SANDBOX_TIMEOUT_MS` | Maximum execution time for a sandbox job in milliseconds | No | `10000` |
| `SANDBOX_JOB_ID_SECRET` | Secret used to sign sandbox job identifiers | No | `changeme` |

### Frontend display settings

| Variable | Description | Required | Default |
|---|---|---|---|
| `FRONTEND_OIDC_BUTTON_LABEL` | Label for the OIDC sign-in button | No | — |

### Scheduler settings

| Variable | Description | Required | Default |
|---|---|---|---|
| `SCHEDULER_FREQUENT_CRON_JOBS_SCHEDULE` | Interval phrase used to poll enabled yank integrations | No | `every 5 minutes` |
| `SERVER_PROGRESS_UPDATE_THRESHOLD` | Minimum hours between automatic progress updates for an entity | No | `2` |

### S3-compatible file storage

| Variable | Description | Required | Default |
|---|---|---|---|
| `FILE_STORAGE_S3_URL` | S3-compatible endpoint URL | No | — |
| `FILE_STORAGE_S3_REGION` | S3 bucket region | No | — |
| `FILE_STORAGE_S3_BUCKET_NAME` | S3 bucket name | No | — |
| `FILE_STORAGE_S3_ACCESS_KEY_ID` | S3 access key ID | No | — |
| `FILE_STORAGE_S3_SECRET_ACCESS_KEY` | S3 secret access key | No | — |

## Provider integration configuration
