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

Non-loopback HTTP deployments use an origin-scoped callback translation in
`http-oauth-redirects.ts` until Better Auth supports an origin-scoped HTTP override. Provisioning stores HTTPS equivalents of the web callback URIs. The auth handler
translates incoming callback parameters before validation and final callback destinations back to
HTTP, including JSON redirects. Signed login/consent queries remain untouched. Issuers, audiences,
trusted origins, and native callbacks retain their configured values. This does not encrypt HTTP
traffic or resolve upstream's separate HTTP issuer normalization in discovery and logout hints.

## Tokens

Access tokens expire after 15 minutes and refresh tokens after 30 days. API middleware verifies the JWT signature, issuer `<FRONTEND_URL>/api/auth`, audience `<FRONTEND_URL>/api`, expiry, and `ryot:api` scope, then loads the authoritative user. Disabled or deleted users fail immediately. API keys retain Better Auth expiry, rate limiting, cache, database fallback, and ownership checks. `requestClientAddress` resolves a request's client address with Better Auth's own `advanced` options, so other per-address limits key requests exactly as Better Auth's rate limits do.

User preferences are application data on the user row, not Better Auth user fields or session claims. Authenticated application reads decode the full canonical JSONB value. Preference commands validate a partial body, normalize language at the write boundary, and merge supplied fields in one row update; omitted fields remain unchanged. The database supplies complete defaults and rejects malformed stored values.

Account settings rename the current user through `PATCH /account/name`. The name is trimmed,
required, and limited to 100 characters. The protected application endpoint uses the existing auth
adapter and demo/lifecycle guards; web and native clients refresh UserInfo after saving. External
OIDC does not enable profile overrides on subsequent sign-ins, so local name edits persist.

`reportingTimeZone` is a required, validated IANA zone. The database default is UTC. Hosted email
sign-up sends the browser zone in the `x-ryot-reporting-time-zone` header, and hosted OIDC sign-in
carries it as OAuth `additionalData`; after Better Auth creates the user, a valid requested zone
replaces the default before bootstrap is scheduled. Server-side creation (Instance Admin provisioning,
reset recreation) keeps UTC. Later changes use ordinary preference patches; device travel does not
change the stored preference.

`ratingScale` is one of `hundred` (the database default), `ten`, `five`, or `three-point`. It only
selects how clients show and enter ratings; stored ratings stay 0–100 and are never rewritten when
it changes.

Preference-only consumers capture `AuthRepository` at construction and call `getUserPreferences`, which returns decoded preferences or `null` for a missing user. Its Layer requires only `DatabaseSession`; it does not load the auth runtime. Consumers retain their own missing-user behavior. Reads that already need user columns decode preferences from that same row.

Disable, deletion, and password reset revoke browser sessions and OAuth token records; disable and deletion also clear API-key caches, and password reset deletes the user's API keys. Ordinary issued access tokens remain valid until expiry because verification does not read token records.

## Account Bootstrap

Creation and the frequent cron's reconciliation of incomplete users queue one `user-bootstrap` job
keyed by the user, so they coalesce while it is queued; creation does not wait for it.
Reset runs the same bootstrap inside its own job, before enabling the recreated user.

Instance Admin re-enablement locks the user row and queues one rebuild per effective plugin that
declares entity folds in the same transaction as clearing `disabled_at`. Repeating enablement on an
already enabled account queues no additional rebuilds. The status write uses `AuthRepository` so it
participates in that transaction; session revocation on disable still uses the auth service.

Reset and deletion lock the user row, mark it retiring, and delete the account's jobs and workflow
executions in the transaction that holds the lock. Account writes take a shared lock on the same row,
so a write either commits before retirement starts or fails once it has begun; a job whose row is gone
cannot commit work for the account.

## Impersonation

Instance Admin authorizes a one-use, 60-second handoff to a hosted browser. Redemption creates a standard-access Better Auth session with an immutable one-hour deadline and continues the initiating client's OAuth/PKCE request. The PKCE verifier stays in that client's storage. Marked sessions authorize only impersonation clients, and those clients require marked sessions.

Impersonation token issuance, refresh, UserInfo, and application API authentication validate the originating session. Session renewal cannot extend the deadline. Session deletion revokes its OAuth credentials and broadcasts an invalidation that closes its live-update streams. Normal user sessions are unaffected.

The client replaces its previous login and shows an impersonation banner. Logout uses the existing end-session ceremony and returns to locked Instance Admin. Normal password and fresh-login checks still apply. Account changes, issued API keys, and started jobs retain their normal lifetimes.

God-mode password reset capture reserves a random ID for each email, listens before initiating an internal Better Auth request, and carries that ID in the internal request header. The link arrives through a callback of that in-process request, so capture stays local. The reset callback delivers only if that request's ID still owns the reservation. The capture scope releases its subscriber and its own reservation on success, failure, timeout, or interruption. A late Better Auth Promise cannot deliver into a later reservation.

Reset links expire after 30 minutes. The server tracks the latest delivered link per user. Before publishing a link, delivery atomically records it only while the request's ID still owns the reservation and then revokes the link it replaced; failures abort delivery. Password reset and account reset or deletion revoke the tracked link.

## External OIDC

Register only `<FRONTEND_URL>/api/auth/callback/oidc` at the external provider. Do not register native schemes there. External OIDC completes in the hosted login before Ryot resumes its signed first-party authorization request.

## Demo Access

Demo authority belongs to the hosted session and issued credential, not to the user record. A standard login for the configured shared user remains unrestricted, while demo sessions cannot authorize the normal web or native clients.

The Better Auth boundary blocks demo sessions from changing account security state and from reading credential control-plane data. Protected reads include linked-account details, external access and refresh tokens, active sessions, API-key inventory, and TOTP provisioning secrets. The hook resolves the hosted session for every protected path, including GET routes; lifecycle gating remains limited to lifecycle-sensitive mutations.

## Deployment

`FRONTEND_URL` must be the exact public HTTP or HTTPS origin, without path, query, or fragment. It defines the issuer, API audience, trusted browser origin, and web redirects; production should use HTTPS.

Proxies must forward `/api/auth/*`, preserve `Authorization`, and never cache authorization or token responses. Discovery is at `/api/auth/.well-known/openid-configuration`; no root `/.well-known/*` route is needed. APIs and token exchange use wildcard non-credentialed CORS; hosted-login cookies remain same-origin.
