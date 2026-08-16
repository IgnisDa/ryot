# Authentication

Ryot supports password and external OpenID Connect (OIDC) sign-in. The web and installed apps use OAuth 2.1 Authorization Code with S256 PKCE to obtain short-lived API access tokens. API keys remain user-owned personal credentials for automation.

## OpenID Connect

Create one application in your OIDC provider and configure Ryot:

```bash
FRONTEND_URL=https://app.ryot.io
SERVER_OIDC_CLIENT_ID=********
SERVER_OIDC_CLIENT_SECRET=********
SERVER_OIDC_ISSUER_URL=https://accounts.google.com
# Optional
FRONTEND_OIDC_BUTTON_LABEL=Use Google
USERS_DISABLE_LOCAL_AUTH=true
```

Register this single callback at Authentik, Google, Keycloak, or your other provider:

```text
<FRONTEND_URL>/api/auth/callback/oidc
```

The required scopes are `openid email`. Do not register an iOS or Android callback at the external provider. Ryot provisions its internal `ryot-web` and `ryot-native` OAuth clients automatically.

::: warning
`FRONTEND_URL` must be the exact public HTTPS origin users browse to, without a path, query, or fragment. It defines the OAuth issuer, API audience, trusted browser origin, and web callbacks. Ryot rejects malformed values at startup.
:::

When local authentication is disabled, `/oauth/login` automatically starts external OIDC. Existing password, OIDC, and two-factor users complete sign-in on this server-hosted route.

## API keys

API keys are user-owned personal automation credentials sent through `X-Api-Key`. They are not OAuth client credentials. Expiry, rate limiting, ownership, and revocation apply.
