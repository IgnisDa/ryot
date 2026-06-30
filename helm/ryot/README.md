# Ryot Helm Chart

Deploys [Ryot](https://github.com/IgnisDa/ryot) - "The only self hosted tracker
you will ever need" - on Kubernetes, with an optional bundled PostgreSQL
database.

## TL;DR

```bash
helm install ryot ./helm/ryot \
  --set secret.adminAccessToken.value="$(openssl rand -hex 16)" \
  --set config.frontendUrl="https://ryot.your-domain.com" \
  --set postgres.auth.password="$(openssl rand -hex 16)"
```

## What gets deployed

- A single `Deployment` running the Ryot container (frontend + backend + Caddy
  proxy in one image, listening on port `8000`).
- A `Service` (ClusterIP by default) exposing port `8000`.
- An optional `Ingress`.
- An optional bundled PostgreSQL `StatefulSet` + headless `Service` +
  `Secret`, using the official `postgres` image.
- A `ConfigMap` for non-sensitive env and a `Secret` for sensitive env.

No `ServiceAccount` is created.

## Database options

### Bundled PostgreSQL (default)

`postgres.enabled=true` (default) deploys a single-node Postgres StatefulSet and
wires `DATABASE_URL` automatically. The password comes from
`postgres.auth.password` (stored in a chart-managed secret) or from an existing
secret via `postgres.auth.existingSecret`.

`DATABASE_URL` is composed at runtime inside the pod, so the password is only
ever read from the Postgres secret and never written into a second manifest.

> The chart ships **no default password**. With `postgres.enabled=true` you must
> set a strong `postgres.auth.password` or reference one via
> `postgres.auth.existingSecret`, otherwise the chart refuses to render. Keep it
> URL-safe (it is embedded in the connection string).

### Bring your own database

Set `postgres.enabled=false`. Three ways to point Ryot at your database, in
order of precedence:

1. **Full URL inline** - stored in a chart-managed `Secret` (key `database-url`):

   ```yaml
   postgres:
     enabled: false
   externalDatabase:
     url: "postgres://user:pass@db.example.com:5432/ryot"
   ```

2. **Full URL from an existing secret** - reference a secret you manage:

   ```yaml
   postgres:
     enabled: false
   externalDatabase:
     existingSecret: my-ryot-db
     existingSecretKey: database-url   # default
   ```

3. **Individual components** - used when `url` and `existingSecret` are both
   empty. The chart composes `DATABASE_URL` at runtime. Each component may be
   inline (`value`) or pulled from a secret (`existingSecret` + `existingSecretKey`).
   Inline `password` is written to the chart-managed Secret; the others are
   passed as plain env values.

   ```yaml
   postgres:
     enabled: false
   externalDatabase:
     host:
       value: db.example.com
     port:
       value: "5432"
     database:
       value: ryot
     username:
       value: ryotuser
     password:
       # inline -> chart Secret, or:
       existingSecret: ryot-db-creds
       existingSecretKey: password
   ```

   Because the password is read via `secretKeyRef`, it never appears in the
   composed `DATABASE_URL` literal in the manifest.

## Sensitive values

These are always sourced from a `Secret` (chart-managed or existing), never
from the ConfigMap:

| Env var                     | Value                                  | Existing-secret keys                                          |
| --------------------------- | -------------------------------------- | ------------------------------------------------------------- |
| `SERVER_ADMIN_ACCESS_TOKEN` | `secret.adminAccessToken.value` (required) | `secret.adminAccessToken.existingSecret` / `.existingSecretKey` |
| `SERVER_PRO_KEY`            | `secret.proKey.value` (optional)         | `secret.proKey.existingSecret` / `.existingSecretKey`           |
| `DATABASE_URL`              | bundled / `externalDatabase.url`       | `externalDatabase.existingSecret` / `.existingSecretKey`      |
| provider tokens (any)       | `secretEnv` map                        | `secretEnvFrom` map                                           |

## Ingress

```yaml
ingress:
  enabled: true
  className: nginx
  annotations: {}
  hosts:
    - host: ryot.your-domain.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: ryot-tls
      hosts:
        - ryot.your-domain.com
```

## Provider tokens & extra config

Provider access tokens and client IDs/secrets (TMDB, Twitch, Trakt,
MyAnimeList, ...) are **sensitive** and must go in a Secret, never the
ConfigMap. The chart provides a dynamic secret-env mapping for this. See the
[Ryot configuration docs](https://docs.ryot.io/configuration.html).

Inline values - written to the chart-managed Secret:

```yaml
secretEnv:
  MOVIES_AND_SHOWS_TMDB_ACCESS_TOKEN: "xxxx"
  VIDEO_GAMES_TWITCH_CLIENT_ID: "xxxx"
  VIDEO_GAMES_TWITCH_CLIENT_SECRET: "xxxx"
```

Or map env vars to keys in your own existing secret(s):

```yaml
secretEnvFrom:
  VIDEO_GAMES_TWITCH_CLIENT_SECRET:
    existingSecret: ryot-providers
    key: twitch-client-secret
  ANIME_AND_MANGA_MAL_CLIENT_ID:
    existingSecret: ryot-providers
    key: mal-client-id
```

`config.extraEnv` remains available for genuinely non-sensitive options only
(it lands in a ConfigMap).

## Validation

The chart fails to render (`helm install` / `template` / `lint`) with a clear
message when required configuration is missing or inconsistent, including:

- `image.repository` and `service.port` unset.
- `secret.adminAccessToken` not provided (value or existing secret).
- Any `existingSecret` set without its corresponding key.
- `postgres.enabled=true` with no password, blank username/database, or
  (when persistence is on) missing size/mountPath.
- `postgres.enabled=false` with no usable external database: no `url`, no
  `existingSecret`, and missing component(s) (`host`/`port`/`database`/
  `username`/`password`).
- `ingress.enabled=true` with no hosts, a host missing `host`, or a host with
  no paths.

### Render-time tests (helm-unittest)

Render-time tests live in [`tests/`](./tests) and use the
[helm-unittest](https://github.com/helm-unittest/helm-unittest) plugin. They
assert every guardrail above fails as expected and that the happy paths render
correctly. `database_url_test.yaml` covers `DATABASE_URL` creation across all
modes (bundled, external URL inline/existing-secret, and components inline /
from-secret / mixed).

```bash
helm plugin install https://github.com/helm-unittest/helm-unittest
helm unittest helm/ryot
```

### Runtime tests (helm test)

Post-install smoke tests live in [`templates/tests/`](./templates/tests) as
`helm.sh/hook: test` Pods. Run them against a deployed release:

```bash
helm test <release-name>
```

- **test-http-connection** - GETs `/health` through the Service (with retries)
  to confirm Ryot is serving.
- **test-database-url** - injects the *exact* same database env the app
  receives, then resolves the composed `DATABASE_URL`, checks it is a valid
  `postgres://` string, and runs `pg_isready` + `psql 'SELECT 1'` against it.
  This validates DATABASE_URL creation end-to-end (the `$(VAR)` interpolation a
  render-time test cannot resolve).

## Health

Ryot exposes `/health` on the service port; liveness and readiness probes use it.

## Notable values

| Key                          | Default                  | Description                          |
| ---------------------------- | ------------------------ | ------------------------------------ |
| `image.repository`           | `ghcr.io/ignisda/ryot`   | Image repo                           |
| `image.tag`                  | `""` (chart appVersion)  | Image tag                            |
| `config.timezone`            | `GMT`                    | `TZ`                                 |
| `config.frontendUrl`         | `""`                     | `FRONTEND_URL`                       |
| `config.usersAllowRegistration` | `true`               | `USERS_ALLOW_REGISTRATION`           |
| `postgres.enabled`           | `true`                   | Deploy bundled PostgreSQL            |
| `postgres.auth.password`     | `postgres`               | Bundled DB password (change this)    |
| `postgres.persistence.size`  | `8Gi`                    | Data volume size                     |
| `service.port`               | `8000`                   | Service port                         |
| `ingress.enabled`            | `false`                  | Enable ingress                       |

See [values.yaml](./values.yaml) for the full list.
