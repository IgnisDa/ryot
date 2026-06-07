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
`FRONTEND_URL` must be the exact origin users browse to, without a path, query, or fragment. It defines the OAuth issuer, API audience, trusted browser origin, and web callbacks. Ryot rejects malformed values at startup.
:::

### Running without HTTPS

HTTPS is strongly recommended, but Ryot does not require it. Plain HTTP works, including on a LAN address such as `http://192.168.1.50:8000`.

Be aware of the tradeoff. Over plain HTTP your logins and API keys cross the network unencrypted, and anyone else on that network can read them and use them to access your account. Only run Ryot over HTTP on a network you trust, and use HTTPS for anything reachable from the internet.

Two smaller things to expect on an HTTP setup:

- Signing out shows an extra confirmation page instead of returning you straight to the login screen.
- The mobile apps cannot connect over plain HTTP. iOS and Android both block it, so an HTTP instance works in a browser only.

Ryot logs a warning at startup when `FRONTEND_URL` uses HTTP on anything other than `localhost`.

When local authentication is disabled, `/oauth/login` automatically starts external OIDC. Existing password, OIDC, and two-factor users complete sign-in on this server-hosted route.

## API keys

API keys are user-owned personal automation credentials sent through `X-Api-Key`. They are not OAuth client credentials. Expiry, rate limiting, ownership, and revocation apply.
