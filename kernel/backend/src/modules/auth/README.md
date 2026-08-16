# Auth

Ryot is an OAuth 2.1 authorization server built with Better Auth's OAuth Provider plugin. Application APIs accept either an OAuth access token in `Authorization: Bearer <token>` or a user-owned API key in `X-Api-Key`. Better Auth browser sessions are used only by the hosted `/oauth/login` ceremony and its password, external OIDC, and two-factor steps. Application API middleware does not accept those cookies as credentials.

## First-party clients

Server startup provisions exactly two public clients:

- `ryot-web`, with `<FRONTEND_URL>/auth/callback` and `<FRONTEND_URL>/auth/logout/callback`
- `ryot-native`, with callback and logout callback URIs derived from the canonical
  `io.ryot.app` and `io.ryot.app.dev` application IDs

Both clients require Authorization Code with S256 PKCE, skip consent, and can use `openid profile email offline_access ryot:api`. They are linked to the `<FRONTEND_URL>/api` resource. Dynamic registration and user-managed client creation are disabled.

The web client always uses `window.location.origin`. Only the installed native app selects a server. The hosted `/oauth/login` route is served by the server's SPA build and is independent of native server selection.

## Tokens

OAuth access tokens expire after 15 minutes and refresh tokens after 30 days. API middleware verifies the JWT signature, issuer `<FRONTEND_URL>/api/auth`, audience `<FRONTEND_URL>/api`, expiry, and `ryot:api` scope, then loads the authoritative user row. Disabled or deleted users are rejected immediately. API keys retain Better Auth's expiry, rate limiting, cache, database fallback, and user ownership behavior.

The client stores OAuth access, refresh, and ID tokens in asynchronous storage: the iOS Keychain or Android Keystore on native, and `localStorage` on web. It coordinates refresh per server and clears authentication on `invalid_grant`. Logout revokes refresh and access tokens, clears local tokens and pending transactions even if remote logout fails, and opens the provider end-session endpoint with an exact registered callback. User disable and deletion revoke browser sessions, OAuth token records, and API-key caches. A password reset revokes browser sessions and OAuth token records too; access tokens already issued stay valid until they expire, because verification never reads the token record.

## External OIDC

Self-hosters create one application in Authentik, Google, Keycloak, or another OIDC provider. Its only Ryot callback is:

```text
<FRONTEND_URL>/api/auth/callback/oidc
```

Do not register mobile callback schemes at the external provider. The internal `ryot-web` and `ryot-native` clients are provisioned automatically. External OIDC completes inside the hosted browser login before Ryot continues the signed first-party authorization request.

## `FRONTEND_URL`

`FRONTEND_URL` must be the exact public HTTP or HTTPS origin users browse to. Production deployments should use HTTPS. It must not include a path, query, or fragment. Startup rejects malformed values because this origin defines the issuer, API audience, trusted browser origin, and web callback URIs.

## Reverse proxies

- Forward `/api/auth/*` to Ryot.
- Preserve the `Authorization` header.
- Do not cache authorization or token responses.
- No root `/.well-known/*` rule is needed. Discovery is under `/api/auth/.well-known/openid-configuration`.

Application APIs and OAuth token exchange retain wildcard, non-credentialed CORS. Hosted login cookies are same-origin and do not depend on CORS.
