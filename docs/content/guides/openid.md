# OpenID Authentication

Ryot can be configured to use OpenID Connect (OIDC) for authentication. This guide will
walk you through the steps to configure Ryot to use OIDC.

The following environment variables need to be set:

```bash
FRONTEND_URL="https://ryot.fly.dev"
SERVER_OAUTH_CLIENT_ID="384***3-***.apps.googleusercontent.com"
SERVER_OAUTH_CLIENT_SECRET="GOCSPX-********yDY"
SERVER_OAUTH_ISSUER_URL="https://accounts.google.com"
```

Once these are set, restart your Ryot instance and you should be able to login using
your configured OIDC provider.
