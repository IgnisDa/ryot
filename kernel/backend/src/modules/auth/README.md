# Auth

Ryot is an OAuth 2.1 authorization server built with Better Auth's OAuth Provider plugin. Application APIs accept an OAuth token in `Authorization: Bearer <token>` or a user API key in `X-Api-Key`. Better Auth cookies authenticate only the hosted `/oauth/login` ceremony and the hosted `/oauth/two-factor` page, where a fresh password sign-in precedes TOTP management; API middleware never accepts them.

## First-Party Clients

Startup provisions five public clients:

| Client                      | Redirects                                                                    |
| --------------------------- | ---------------------------------------------------------------------------- |
| `ryot-web`                  | `<FRONTEND_URL>/auth/callback` and `<FRONTEND_URL>/auth/logout/callback`     |
| `ryot-native`               | Callback and logout URIs derived from `io.ryot.app` and `io.ryot.app.dev`    |
| `ryot-demo-web`             | Same callback and logout URIs as `ryot-web`; disabled without a demo account |
| `ryot-impersonation-web`    | Same callback and logout URIs as `ryot-web`                                  |
| `ryot-impersonation-native` | Same callback and logout URIs as `ryot-native`                               |

All require Authorization Code with S256 PKCE, skip consent, use `openid profile email offline_access ryot:api`, and target `<FRONTEND_URL>/api`. Dynamic registration and user-managed clients are disabled. The web client uses its current origin; only the installed native app selects a server.

## Tokens

Access tokens expire after 15 minutes and refresh tokens after 30 days. API middleware verifies the JWT signature, issuer `<FRONTEND_URL>/api/auth`, audience `<FRONTEND_URL>/api`, expiry, and `ryot:api` scope, then loads the authoritative user. Disabled or deleted users fail immediately. API keys retain Better Auth expiry, rate limiting, cache, database fallback, and ownership checks.

User preferences are application data on the user row, not Better Auth user fields or session claims. Authenticated application reads decode the full canonical JSONB value. Preference commands validate a partial body, normalize language at the write boundary, and merge supplied fields in one row update; omitted fields remain unchanged. The database supplies complete defaults and rejects malformed stored values.

Preference-only consumers capture `AuthRepository` at construction and call `getUserPreferences`, which returns decoded preferences or `null` for a missing user. Its Layer requires only `DatabaseSession`; it does not load the auth runtime. Consumers retain their own missing-user behavior. Reads that already need user columns decode preferences from that same row.

Disable, deletion, and password reset revoke browser sessions and OAuth token records; disable and deletion also clear API-key caches, and password reset deletes the user's API keys. Ordinary issued access tokens remain valid until expiry because verification does not read token records.

## Impersonation

God Mode authorizes a one-use, 60-second Redis handoff to a hosted browser. Redemption creates a standard-access Better Auth session with an immutable one-hour deadline and continues the initiating client's OAuth/PKCE request. The PKCE verifier stays in that client's storage. Marked sessions authorize only impersonation clients, and those clients require marked sessions.

Impersonation token issuance, refresh, UserInfo, and application API authentication validate the originating session. Session renewal cannot extend the deadline. Session deletion revokes its OAuth credentials and publishes an invalidation for its entity-interest sockets; sockets also enforce the deadline and periodically recheck the session. Normal user sessions are unaffected.

The client replaces its previous login and shows an impersonation banner. Logout uses the existing end-session ceremony and returns to locked God Mode. Normal password and fresh-login checks still apply. Account changes, issued API keys, and started jobs retain their normal lifetimes.

God-mode password reset capture reserves a random ID for each email, subscribes before initiating an internal Better Auth request, and carries that ID in the internal request header. The reset callback delivers only if that request's ID still owns the Redis reservation. The capture scope releases its subscriber and its own reservation on success, failure, timeout, or interruption. A late Better Auth Promise cannot deliver into a later reservation.

Reset links expire after 30 minutes. Redis tracks the latest delivered link per user. Before publishing a link, delivery atomically records it only while the request's ID still owns the reservation and then revokes the link it replaced; failures abort delivery. Password reset and account reset or deletion revoke the tracked link.

## External OIDC

Register only `<FRONTEND_URL>/api/auth/callback/oidc` at the external provider. Do not register native schemes there. External OIDC completes in the hosted login before Ryot resumes its signed first-party authorization request.

## Demo Access

Demo authority belongs to the hosted session and issued credential, not to the user record. A standard login for the configured shared user remains unrestricted, while demo sessions cannot authorize the normal web or native clients.

The Better Auth boundary blocks demo sessions from changing account security state and from reading credential control-plane data. Protected reads include linked-account details, external access and refresh tokens, active sessions, API-key inventory, and TOTP provisioning secrets. The hook resolves the hosted session for every protected path, including GET routes; lifecycle gating remains limited to lifecycle-sensitive mutations.

## Deployment

`FRONTEND_URL` must be the exact public HTTP or HTTPS origin, without path, query, or fragment. It defines the issuer, API audience, trusted browser origin, and web redirects; production should use HTTPS.

Proxies must forward `/api/auth/*`, preserve `Authorization`, and never cache authorization or token responses. Discovery is at `/api/auth/.well-known/openid-configuration`; no root `/.well-known/*` route is needed. APIs and token exchange use wildcard non-credentialed CORS; hosted-login cookies remain same-origin.
