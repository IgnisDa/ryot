# Ryot Helm Chart

Deploys [Ryot](https://github.com/IgnisDa/ryot) on Kubernetes with bundled PostgreSQL and Redis by default.

## Install

### OCI chart

Published releases are available from GHCR with Helm 3.8 or later:

```bash
helm install ryot oci://ghcr.io/ignisda/charts/ryot \
  --version x.y.z \
  --set secret.adminAccessToken.value="$(openssl rand -hex 16)" \
  --set postgres.auth.password="$(openssl rand -hex 16)" \
  --set config.frontendUrl="https://ryot.your-domain.com"
```

Omit `--version` to install the latest chart. Each GitHub release publishes a chart whose version is the release tag without a leading `v`.

### Local checkout

```bash
helm install ryot ./ci/helm/ryot \
  --set secret.adminAccessToken.value="$(openssl rand -hex 16)" \
  --set postgres.auth.password="$(openssl rand -hex 16)" \
  --set config.frontendUrl="https://ryot.your-domain.com"
```

The chart creates one Ryot `Deployment`, a `Service`, optional `Ingress`, `ConfigMap`, and `Secret`. Bundled PostgreSQL and Redis each use a single-node `StatefulSet` and headless `Service`. No `ServiceAccount` is created.

## PostgreSQL

### Bundled

`postgres.enabled=true` deploys PostgreSQL and constructs `DATABASE_URL` at runtime. Set `postgres.auth.password` or `postgres.auth.existingSecret`; the chart has no default password and refuses to render without one. Keep component values URL-safe because they are embedded in the URL.

The password is read from the PostgreSQL secret without copying the complete URL into another manifest. After initialization, do not change a chart-managed password only through values: PostgreSQL retains the old password while the application receives the new one. The chart blocks this mismatch during upgrades. Rotate the database user password first, then update the secret as directed by the error.

PostgreSQL persistence is enabled by default with an `8Gi` claim. Keep it enabled for production. Disabling it uses ephemeral storage and loses data when the pod is replaced. When persistence is enabled, `size` and `mountPath` are required. Changing the requested size does not guarantee that an existing PVC can expand; this depends on its StorageClass.

### External

Set `postgres.enabled=false`, then choose one mode in precedence order. Full PostgreSQL URLs may use `postgres://` or `postgresql://`.

1. Store a full URL in the chart-managed secret:

   ```yaml
   postgres:
     enabled: false
   externalDatabase:
     url: postgresql://user:pass@db.example.com:5432/ryot
   ```

2. Reference a secret containing the full URL:

   ```yaml
   postgres:
     enabled: false
   externalDatabase:
     existingSecret: my-ryot-db
     existingSecretKey: database-url
   ```

3. Leave `url` and `existingSecret` empty and supply components:

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
       existingSecret: ryot-db-creds
       existingSecretKey: password
   ```

Each component accepts either `value` or `existingSecret` plus `existingSecretKey`. Secret-backed components use `secretKeyRef`; inline passwords go into the chart-managed secret. Percent-encode reserved URL characters in all composed components.

## Redis

`redis.enabled=true` deploys Redis and constructs `REDIS_URL`. Authentication is optional for the cluster-internal default; set `redis.auth.password` or `redis.auth.existingSecret` to enable it.

Redis persistence is disabled by default because Redis holds sessions, workflow state, and caches. Enable `redis.persistence.enabled` when that state must survive pod replacement; `size` and `mountPath` are then required.

For external Redis, disable the bundled instance and provide an inline URL or existing secret:

```yaml
redis:
  enabled: false
externalRedis:
  existingSecret: my-ryot-redis
  existingSecretKey: redis-url
```

An inline `externalRedis.url` is stored in the chart-managed secret.

## Secrets

Sensitive values are sourced from chart-managed or existing Kubernetes secrets, never the `ConfigMap`:

| Environment variable | Inline value | Existing secret |
| --- | --- | --- |
| `SERVER_ADMIN_ACCESS_TOKEN` | `secret.adminAccessToken.value` | `secret.adminAccessToken.existingSecret` |
| `SERVER_PRO_KEY` | `secret.proKey.value` | `secret.proKey.existingSecret` |
| `DATABASE_URL` | bundled or `externalDatabase.url` | `externalDatabase.existingSecret` |
| `REDIS_URL` | bundled or `externalRedis.url` | `externalRedis.existingSecret` |
| Provider credentials | `secretEnv` | `secretEnvFrom` |

Provider tokens and client secrets must use `secretEnv` or `secretEnvFrom`, not `config.extraEnv`. The latter is rendered into a `ConfigMap` and is only for non-sensitive settings. See the [Ryot configuration docs](https://docs.ryot.io/configuration.html).

```yaml
secretEnv:
  RYOT_PLUGIN_MEDIA_TMDB_ACCESS_TOKEN: "xxxx"
secretEnvFrom:
  RYOT_PLUGIN_MEDIA_TWITCH_CLIENT_SECRET:
    existingSecret: ryot-providers
    key: twitch-client-secret
```

## Ingress

```yaml
ingress:
  enabled: true
  className: nginx
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

## Upgrades

Back up PostgreSQL, review release notes and value changes, then upgrade with the same values and secret references used for installation:

```bash
helm upgrade ryot oci://ghcr.io/ignisda/charts/ryot --version x.y.z -f values.yaml
```

Keep the original bundled PostgreSQL password unless it has first been rotated inside PostgreSQL. Review StatefulSet and PVC changes before applying them.

## Validation

The chart rejects missing image or service settings, inconsistent secret references, incomplete external database or Redis settings, invalid persistence settings, and incomplete ingress hosts.

```bash
helm lint ci/helm/ryot \
  --set secret.adminAccessToken.value=tok \
  --set postgres.auth.password=pw
helm template ryot ci/helm/ryot \
  --set secret.adminAccessToken.value=tok \
  --set postgres.auth.password=pw
```

Render-time tests use the [helm-unittest](https://github.com/helm-unittest/helm-unittest) plugin:

```bash
helm plugin install https://github.com/helm-unittest/helm-unittest
helm unittest ci/helm/ryot
```

Post-install test pods verify `/api/system/health` through the service and validate the effective `DATABASE_URL` with `pg_isready` and `SELECT 1`. The database test accepts both `postgres://` and `postgresql://` URLs.

```bash
helm test <release-name>
```

The health endpoint checks PostgreSQL and Redis, and is also the default liveness and readiness target.

## Troubleshooting

Use `helm template --debug` for render failures. For a deployment, inspect `kubectl get pods`, `kubectl describe pod <pod>`, application logs, and `helm test <release-name> --logs`. Health failures usually mean that Ryot cannot reach PostgreSQL or Redis; verify service names, secret keys, URL encoding, and credentials. If a bundled PostgreSQL password mismatch blocks an upgrade, follow the rotation instructions in the error instead of deleting persistent data.

## Values

See annotated [values.yaml](./values.yaml) or generated [VALUES.md](./VALUES.md). The main-branch workflow regenerates `VALUES.md` with [helm-docs](https://github.com/norwoodj/helm-docs); document values in `values.yaml` and do not edit `VALUES.md` directly.
