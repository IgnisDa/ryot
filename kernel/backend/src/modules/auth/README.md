# Auth

Ryot is an OAuth 2.1 authorization server built with Better Auth's OAuth Provider plugin. Application APIs accept an OAuth token in `Authorization: Bearer <token>` or a user API key in `X-Api-Key`. Better Auth cookies authenticate only the hosted `/oauth/login` ceremony; API middleware never accepts them.

## First-Party Clients

Startup provisions three public clients:

| Client          | Redirects                                                                    |
| --------------- | ---------------------------------------------------------------------------- |
| `ryot-web`      | `<FRONTEND_URL>/auth/callback` and `<FRONTEND_URL>/auth/logout/callback`     |
| `ryot-native`   | Callback and logout URIs derived from `io.ryot.app` and `io.ryot.app.dev`    |
| `ryot-demo-web` | Same callback and logout URIs as `ryot-web`; disabled without a demo account |

Both require Authorization Code with S256 PKCE, skip consent, use `openid profile email offline_access ryot:api`, and target `<FRONTEND_URL>/api`. Dynamic registration and user-managed clients are disabled. The web client uses its current origin; only the installed native app selects a server.

## Tokens

Access tokens expire after 15 minutes and refresh tokens after 30 days. API middleware verifies the JWT signature, issuer `<FRONTEND_URL>/api/auth`, audience `<FRONTEND_URL>/api`, expiry, and `ryot:api` scope, then loads the authoritative user. Disabled or deleted users fail immediately. API keys retain Better Auth expiry, rate limiting, cache, database fallback, and ownership checks.

User preferences are application data on the user row, not Better Auth user fields or session claims. Authenticated application reads decode the full canonical JSONB value. Preference commands validate a partial body, normalize language at the write boundary, and merge supplied fields in one row update; omitted fields remain unchanged. The database supplies complete defaults and rejects malformed stored values.

Preference-only consumers capture `AuthRepository` at construction and call `getUserPreferences`, which returns decoded preferences or `null` for a missing user. Its Layer requires only `DatabaseSession`; it does not load the auth runtime. Consumers retain their own missing-user behavior. Reads that already need user columns decode preferences from that same row.

Disable, deletion, and password reset revoke browser sessions and OAuth token records; disable and deletion also clear API-key caches. Issued access tokens remain valid until expiry because verification does not read token records.

God-mode password reset capture reserves a random ID for each email, subscribes before initiating an internal Better Auth request, and carries that ID in the internal request header. The reset callback delivers only if that request's ID still owns the Redis reservation. The capture scope releases its subscriber and its own reservation on success, failure, timeout, or interruption. A late Better Auth Promise cannot deliver into a later reservation.

## External OIDC

Register only `<FRONTEND_URL>/api/auth/callback/oidc` at the external provider. Do not register native schemes there. External OIDC completes in the hosted login before Ryot resumes its signed first-party authorization request.

## Demo Access

Demo authority belongs to the hosted session and issued credential, not to the user record. A standard login for the configured shared user remains unrestricted, while demo sessions cannot authorize the normal web or native clients.

The Better Auth boundary blocks demo sessions from changing account security state and from reading credential control-plane data. Protected reads include linked-account details, external access and refresh tokens, active sessions, API-key inventory, and TOTP provisioning secrets. The hook resolves the hosted session for every protected path, including GET routes; lifecycle gating remains limited to lifecycle-sensitive mutations.

## Deployment

`FRONTEND_URL` must be the exact public HTTP or HTTPS origin, without path, query, or fragment. It defines the issuer, API audience, trusted browser origin, and web redirects; production should use HTTPS.

Proxies must forward `/api/auth/*`, preserve `Authorization`, and never cache authorization or token responses. Discovery is at `/api/auth/.well-known/openid-configuration`; no root `/.well-known/*` route is needed. APIs and token exchange use wildcard non-credentialed CORS; hosted-login cookies remain same-origin.
