# Configuration

Set configuration with environment variables. The [generated reference](#all-parameters) lists
each variable, default, and secret status.

Ryot serves the final configuration loaded at the `/api/system/config` endpoint as JSON
([example](https://demo.ryot.io/api/system/config)). Sensitive variables are redacted.

## Important parameters

| Variable                    | Purpose                                                                     |
| --------------------------- | --------------------------------------------------------------------------- |
| `DATABASE_URL`              | Required PostgreSQL connection string.                                      |
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

Run one backend process per database. A second process fails to start while the first owns the
database. Stop the current process before starting its replacement, including during upgrades.

## Ryo providers

An instance default needs `SERVER_ASSISTANT_BASE_URL` and `SERVER_ASSISTANT_MODEL`.
Set `SERVER_ASSISTANT_API_KEY` if the provider requires authentication. The base URL must include
the API prefix, for example `https://api.openai.com/v1`, without credentials, query or fragment.
The provider must support OpenAI-compatible Chat Completions, streaming and tool calling.
Set `SERVER_ASSISTANT_CONTEXT_WINDOW` and `SERVER_ASSISTANT_MAX_OUTPUT_TOKENS` to the model's
context window and output limit in tokens. They default to 496,000 and 32,000, and the output limit
must be below the context window. Ryo summarizes older history before the window fills, and also when
the provider reports that a request is too long.

Users can configure a provider in Settings → Ryo. Their configuration overrides the instance
default completely, including its context window and output limit, so a keyless user provider
does not inherit the instance key. Saving without
a new API key retains their previous encrypted key. Removing the user provider also removes its
key and restores the instance default. To switch to a keyless user provider, remove it and add
it again without a key. Demo sessions cannot change provider settings.

Unauthenticated local model servers are supported. Allow their network explicitly with
`SERVER_EGRESS_ALLOWED_NETWORKS`, for example `127.0.0.0/8` for a loopback endpoint, and use its
API base URL such as `http://127.0.0.1:11434/v1`. All provider traffic follows the shared egress
address policy. Keep the database's configuration encryption key when retaining encrypted user
provider keys; losing it prevents decryption and Ryot refuses to silently replace it.

## Health endpoint

Use `/api/system/health` for service health checks.

## All parameters

<!--@include: @/includes/app-backend-config-schema.md{5,}-->
