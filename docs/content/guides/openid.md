# OpenID Authentication

Ryot can be configured to use OpenID Connect (OIDC) for authentication. The following
environment variables need to be set:

```bash
FRONTEND_URL="https://ryot.fly.dev" # The URL of your Ryot instance
SERVER_OAUTH_CLIENT_ID="********"
SERVER_OAUTH_CLIENT_SECRET="********"
SERVER_OAUTH_ISSUER_URL="https://accounts.google.com" # The URL of your OIDC provider
```

As of now, Ryot does not use any infomation from OIDC, so no scopes are required to be set.

Once these are set, restart your Ryot instance and you should be able to login using
your configured OIDC provider.
