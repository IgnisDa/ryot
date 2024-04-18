# OpenID Authentication

Ryot can be configured to use OpenID Connect (OIDC) for authentication. The following
environment variables need to be set:

```bash
FRONTEND_URL="https://ryot.fly.dev" # The URL of your Ryot instance
SERVER_OIDC_CLIENT_ID="********"
SERVER_OIDC_CLIENT_SECRET="********"
SERVER_OIDC_ISSUER_URL="https://accounts.google.com" # The URL of your OIDC provider
```

In your OIDC provider, you will need to set the redirect URL to
`<FRONTEND_URL>/api/auth`. The scopes required are `openid email`.

Once these are set, restart your Ryot instance and you should be able to see the button to
"Continue with OpenID Connect" on the authentication pages. New users will have their
username set to their email address. This can be changed later in the profile settings.

!!! warning

      A user can authenticate using only one provider at a time.
