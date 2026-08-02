# ryot

![Version: 0.1.0](https://img.shields.io/badge/Version-0.1.0-informational?style=flat-square) ![Type: application](https://img.shields.io/badge/Type-application-informational?style=flat-square) ![AppVersion: v10](https://img.shields.io/badge/AppVersion-v10-informational?style=flat-square)

The only self-hosted tracker you will ever need - track movies, shows, video games, books, and more.

**Homepage:** <https://ryot.io>

## Maintainers

| Name | Email | Url |
| ---- | ------ | --- |
| Nigel |  |  |

## Source Code

* <https://github.com/IgnisDa/ryot>

## Values

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| affinity | object | `{}` |  |
| config.disableTelemetry | bool | `false` | Disable anonymous Umami telemetry (DISABLE_TELEMETRY). |
| config.extraEnv | object | `{}` | Extra NON-sensitive environment variables, added to the ConfigMap. Use this only for options that are safe in plaintext, e.g. DISABLE_TELEMETRY or feature flags from https://docs.ryot.io/configuration.html Provider access tokens and client IDs/secrets are sensitive - put them in `secretEnv` / `secretEnvFrom` below, NOT here. Example:   SOME_NON_SENSITIVE_FLAG: "true" |
| config.frontendUrl | string | `""` | Public URL the frontend is served on (FRONTEND_URL). Used for share links etc. Example: https://ryot.your-domain.com |
| config.timezone | string | `"GMT"` |  |
| config.usersAllowRegistration | bool | `true` | Allow new users to register via the web UI (USERS_ALLOW_REGISTRATION). |
| externalDatabase.database.existingSecret | string | `""` |  |
| externalDatabase.database.existingSecretKey | string | `"database"` |  |
| externalDatabase.database.value | string | `""` |  |
| externalDatabase.existingSecret | string | `""` | Reference an existing secret holding the connection string instead. Takes precedence over components. |
| externalDatabase.existingSecretKey | string | `"database-url"` | Key inside the existing secret that holds the connection string. |
| externalDatabase.host | object | `{"existingSecret":"","existingSecretKey":"host","value":""}` | -- Option 2: individual components (used only when url and existingSecret      are both empty) ---- NOTE: all connection values (here and postgres.auth.*) are embedded into the composed DATABASE_URL, so they must be URL-safe. Percent-encode any reserved characters (e.g. @ : / ? # []) or provide a pre-encoded full `url` instead. |
| externalDatabase.password.existingSecret | string | `""` |  |
| externalDatabase.password.existingSecretKey | string | `"password"` |  |
| externalDatabase.password.value | string | `""` |  |
| externalDatabase.port.existingSecret | string | `""` |  |
| externalDatabase.port.existingSecretKey | string | `"port"` |  |
| externalDatabase.port.value | string | `"5432"` |  |
| externalDatabase.url | string | `""` | Full connection string, e.g. postgres://user:pass@host:5432/dbname Stored in a chart-managed Secret when set. Takes precedence over components. |
| externalDatabase.username.existingSecret | string | `""` |  |
| externalDatabase.username.existingSecretKey | string | `"username"` |  |
| externalDatabase.username.value | string | `""` |  |
| externalRedis.existingSecret | string | `""` | Reference an existing secret holding the full REDIS_URL instead. |
| externalRedis.existingSecretKey | string | `"redis-url"` | Key inside the existing secret that holds the connection string. |
| externalRedis.url | string | `""` | Full connection string, e.g. redis://:pass@redis.example.com:6379/0. Stored in a chart-managed Secret when set. |
| fullnameOverride | string | `""` | Override the full release name. |
| image.pullPolicy | string | `"IfNotPresent"` |  |
| image.repository | string | `"ghcr.io/ignisda/ryot"` |  |
| image.tag | string | `""` |  |
| imagePullSecrets | list | `[]` | Image pull secrets for private registries. |
| ingress.annotations | object | `{}` |  |
| ingress.className | string | `""` |  |
| ingress.enabled | bool | `false` |  |
| ingress.hosts[0].host | string | `"ryot.local"` |  |
| ingress.hosts[0].paths[0].path | string | `"/"` |  |
| ingress.hosts[0].paths[0].pathType | string | `"Prefix"` |  |
| ingress.tls | list | `[]` |  |
| livenessProbe | object | `{"failureThreshold":6,"httpGet":{"path":"/api/health","port":"http"},"initialDelaySeconds":30,"periodSeconds":30,"timeoutSeconds":10}` | Liveness probe. Ryot exposes /api/health on the service port. |
| nameOverride | string | `""` | Override the chart name. |
| nodeSelector | object | `{}` |  |
| podAnnotations | object | `{}` |  |
| podLabels | object | `{}` |  |
| podSecurityContext | object | `{}` | Pod-level security context for the Ryot pod. |
| postgres.affinity | object | `{}` |  |
| postgres.auth.database | string | `"postgres"` | Database name (POSTGRES_DB). |
| postgres.auth.existingSecret | string | `""` | Reference an existing secret holding the Postgres password instead of storing it here. |
| postgres.auth.existingSecretPasswordKey | string | `"postgres-password"` | Key inside the existing secret that holds the Postgres password. |
| postgres.auth.password | string | `""` | Database password (POSTGRES_PASSWORD). REQUIRED unless existingSecret is set. No default is provided on purpose. Keep it URL-safe (it is embedded in the DATABASE_URL connection string). |
| postgres.auth.username | string | `"postgres"` | Database user (POSTGRES_USER). |
| postgres.enabled | bool | `true` |  |
| postgres.image.pullPolicy | string | `"IfNotPresent"` |  |
| postgres.image.repository | string | `"postgres"` |  |
| postgres.image.tag | string | `"18-alpine"` |  |
| postgres.nodeSelector | object | `{}` |  |
| postgres.persistence.accessModes[0] | string | `"ReadWriteOnce"` |  |
| postgres.persistence.enabled | bool | `true` |  |
| postgres.persistence.mountPath | string | `"/var/lib/postgresql"` | Mount path for the data volume. Mirrors the official Ryot compose file which mounts the Postgres parent data directory for the v18 image. |
| postgres.persistence.size | string | `"8Gi"` | Size of the Postgres data volume. |
| postgres.persistence.storageClass | string | `""` | StorageClass for the data volume. Empty uses the cluster default. |
| postgres.podSecurityContext | object | `{}` | Pod-level security context for the Postgres pod. Left empty so the official image manages ownership via its entrypoint. |
| postgres.resources | object | `{}` |  |
| postgres.securityContext | object | `{}` |  |
| postgres.service.port | int | `5432` |  |
| postgres.tolerations | list | `[]` |  |
| readinessProbe | object | `{"failureThreshold":6,"httpGet":{"path":"/api/health","port":"http"},"initialDelaySeconds":15,"periodSeconds":15,"timeoutSeconds":10}` | Readiness probe. |
| redis.affinity | object | `{}` |  |
| redis.auth.existingSecret | string | `""` | Reference an existing secret holding the Redis password instead of storing the value here. |
| redis.auth.existingSecretPasswordKey | string | `"redis-password"` | Key inside the existing secret that holds the Redis password. |
| redis.auth.password | string | `""` | Optional Redis password (REDIS_PASSWORD). Keep it URL-safe when using the bundled instance because it is embedded in REDIS_URL. |
| redis.enabled | bool | `true` |  |
| redis.image.pullPolicy | string | `"IfNotPresent"` |  |
| redis.image.repository | string | `"redis"` |  |
| redis.image.tag | string | `"7-alpine"` |  |
| redis.nodeSelector | object | `{}` |  |
| redis.persistence.accessModes[0] | string | `"ReadWriteOnce"` |  |
| redis.persistence.enabled | bool | `false` |  |
| redis.persistence.mountPath | string | `"/data"` |  |
| redis.persistence.size | string | `"1Gi"` | Size of the Redis data volume. |
| redis.persistence.storageClass | string | `""` | StorageClass for the data volume. Empty uses the cluster default. |
| redis.podSecurityContext | object | `{}` |  |
| redis.resources | object | `{}` |  |
| redis.securityContext | object | `{}` |  |
| redis.service.port | int | `6379` |  |
| redis.tolerations | list | `[]` |  |
| replicaCount | int | `1` | Number of Ryot replicas. Persistent state lives in PostgreSQL and Redis, but leave at 1 unless you know your setup supports multiple replicas. |
| resources | object | `{}` |  |
| secret.adminAccessToken.existingSecret | string | `""` | Reference an existing secret instead of storing the value here. |
| secret.adminAccessToken.existingSecretKey | string | `"SERVER_ADMIN_ACCESS_TOKEN"` | Key inside the existing secret that holds the admin access token. |
| secret.adminAccessToken.value | string | `""` | Inline value. Used when existingSecret is empty. |
| secret.proKey.existingSecret | string | `""` | Reference an existing secret instead of storing the value here. |
| secret.proKey.existingSecretKey | string | `"SERVER_PRO_KEY"` | Key inside the existing secret that holds the pro key. |
| secret.proKey.value | string | `""` | Inline value. Used when existingSecret is empty. Leave empty for community version. |
| secretEnv | object | `{}` |  |
| secretEnvFrom | object | `{}` |  |
| securityContext | object | `{"runAsNonRoot":true,"runAsUser":1001}` | Container security context. The image already runs as the unprivileged user 1001 (ryot). |
| service.port | int | `8000` | Service port. The TypeScript backend listens on port 8000 by default. |
| service.type | string | `"ClusterIP"` |  |
| tolerations | list | `[]` |  |

----------------------------------------------
Autogenerated from chart metadata using [helm-docs v1.14.2](https://github.com/norwoodj/helm-docs/releases/v1.14.2)
