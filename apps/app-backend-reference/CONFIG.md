# App Backend Reference Configuration Reference

> Auto-generated from the configuration definition. Do not edit manually.

## Core system configuration

| Variable       | Description                                               | Required | Default                                                |
| -------------- | --------------------------------------------------------- | -------- | ------------------------------------------------------ |
| `PORT`         | HTTP port the server listens on                           | No       | `3000`                                                 |
| `FRONTEND_URL` | Public base URL of the frontend application               | No       | `http://localhost:3000`                                |
| `REDIS_URL`    | Redis connection URL used for caching and session storage | No       | `redis://localhost:6379`                               |
| `DATABASE_URL` | PostgreSQL connection string for the primary database     | No       | `postgres://postgres:postgres@localhost:5432/postgres` |

### User account settings

| Variable                   | Description                                                     | Required | Default |
| -------------------------- | --------------------------------------------------------------- | -------- | ------- |
| `USERS_ALLOW_REGISTRATION` | Allow new users to self-register on this instance               | No       | `true`  |
| `USERS_DISABLE_LOCAL_AUTH` | Disable email/password authentication, forcing OAuth-only login | No       | `false` |

### Server settings

| Variable                    | Description                                    | Required | Default            |
| --------------------------- | ---------------------------------------------- | -------- | ------------------ |
| `SERVER_CORS_ORIGINS`       | Comma-separated list of allowed CORS origins   | No       | `—`                |
| `SERVER_ADMIN_ACCESS_TOKEN` | Secret token required for admin API operations | No       | `reference-secret` |

#### OIDC provider

| Variable                    | Description                                | Required | Default |
| --------------------------- | ------------------------------------------ | -------- | ------- |
| `SERVER_OIDC_CLIENT_ID`     | Client ID for the OIDC provider            | No       | `—`     |
| `SERVER_OIDC_ISSUER_URL`    | Issuer/discovery URL for the OIDC provider | No       | `—`     |
| `SERVER_OIDC_CLIENT_SECRET` | Client secret for the OIDC provider        | No       | `—`     |

### Sandbox settings

| Variable                  | Description                                                   | Required | Default   |
| ------------------------- | ------------------------------------------------------------- | -------- | --------- |
| `RYOT_SANDBOX_DENO_DIR`   | Directory for the Deno runtime cache used by the sandbox      | No       | `./.deno` |
| `RYOT_SANDBOX_TIMEOUT_MS` | Maximum execution time in milliseconds for sandbox operations | No       | `10000`   |
