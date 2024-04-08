# OpenID Authentication

Ryot can be configured to use OpenID Connect (OIDC) for authentication. The following
environment variables need to be set:

```bash
FRONTEND_URL="https://ryot.fly.dev" # The URL of your Ryot instance
SERVER_OAUTH_CLIENT_ID="********"
SERVER_OAUTH_CLIENT_SECRET="********"
SERVER_OAUTH_ISSUER_URL="https://accounts.google.com" # The URL of your OIDC provider
```

In your OIDC provider, you will need to set the redirect URL to
`https://ryot.fly.dev/api/auth`. As of now, Ryot does not use any information from the OIDC
provider, so no scopes are required to be set.

Once these are set, restart your Ryot instance and you should be able to see the button to
"Continue with OpenID Connect" on the auth pages. New users will have a random username
which can be changed from the profile settings page.
