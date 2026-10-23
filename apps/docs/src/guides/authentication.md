# Authentication

Ryot supports passwords and OpenID Connect (OIDC). The web and Capacitor clients use OAuth 2.1
Authorization Code with S256 PKCE and short-lived API access tokens.

## OpenID Connect

Create one application in your OIDC provider, then set:

```bash
FRONTEND_URL=https://app.ryot.io
SERVER_OIDC_CLIENT_ID=********
SERVER_OIDC_CLIENT_SECRET=********
SERVER_OIDC_ISSUER_URL=https://accounts.google.com
# Optional
FRONTEND_OIDC_BUTTON_LABEL=Use Google
USERS_DISABLE_LOCAL_AUTH=true
```

Register one callback:

```text
<FRONTEND_URL>/api/auth/callback/oidc
```

Use the `openid email profile` scopes. Do not register iOS or Android callbacks at the external
provider. Ryot creates its internal web and native OAuth clients.

::: warning
`FRONTEND_URL` must be the exact public origin with no path, query, or fragment. It defines the OAuth
issuer, API audience, trusted browser origin, and web callbacks. Invalid values stop startup.
:::

### Running without HTTPS

Plain HTTP works in a browser, including at a LAN address such as `http://192.168.1.50:8000`.

::: danger
HTTP sends passwords and API keys without encryption. Other users on the network can steal them.
Use HTTP only on a trusted network. Use HTTPS for all internet-accessible instances.
:::

- Sign-out shows an extra confirmation page.
- iOS and Android block plain HTTP, so installed apps cannot connect.

Ryot logs a warning at startup when `FRONTEND_URL` uses HTTP on anything other than `localhost`.

With local authentication disabled, `/oauth/login` starts OIDC automatically. Existing password,
OIDC, and two-factor users complete sign-in on this server route.

## API keys

API keys are personal automation credentials sent in `X-Api-Key`. They are not OAuth client
credentials. Expiry, rate limits, ownership, and revocation apply.
