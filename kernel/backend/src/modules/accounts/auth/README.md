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

All require Authorization Code with S256 PKCE, skip consent, use `openid profile email offline_access ryot:read ryot:write ryot:write:unattended`, and target `<FRONTEND_URL>/api`. Public clients may dynamically register for the advertised identity scopes, `offline_access`, the access scopes and the MCP resource; confidential registration is rejected. Client and resource management remain unavailable. The web client uses its current origin; only the installed native app selects a server.

Better Auth accepts plain-HTTP redirect URIs only on the configured `FRONTEND_URL` origin, so non-loopback HTTP deployments register their real web callbacks. Dynamically registered clients cannot use HTTP redirects on any other non-loopback origin. This does not encrypt HTTP traffic.

## Tokens

Access tokens expire after 15 minutes and refresh tokens after 30 days. API middleware verifies the JWT signature, issuer `<FRONTEND_URL>/api/auth`, audience `<FRONTEND_URL>/api`, expiry, and `ryot:read` scope, then loads the authoritative user. MCP instead verifies the audience `<FRONTEND_URL>/api/mcp`; tokens for either resource are rejected at the other boundary. Disabled or deleted users fail immediately. API keys retain Better Auth expiry, rate limiting, cache, database fallback, and ownership checks. `requestClientAddress` resolves a request's client address with Better Auth's own `advanced` options, so other per-address limits key requests exactly as Better Auth's rate limits do.

User preferences are application data on the user row, not Better Auth user fields or session claims. Authenticated application reads decode the full canonical JSONB value. Preference commands validate a partial body, normalize language at the write boundary, and merge supplied fields in one row update; omitted fields remain unchanged. The database supplies complete defaults and rejects malformed stored values.

Users manage their API keys through protected account endpoints: `POST /account/api-keys` mints a key through Better Auth's server-side API and returns the secret only in that response, and `DELETE /account/api-keys/:apiKeyId` deletes one owned key and purges its cache entries. Listing reads the RyotQL `apiKey` table. Expiry is optional and limited to 1–365 days.

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

Proxies must forward `/api/auth/*`, preserve `Authorization`, and never cache authorization or token responses. Discovery is at `/api/auth/.well-known/openid-configuration`, with RFC 8414 and OIDC aliases at `/.well-known/oauth-authorization-server/api/auth` and `/.well-known/openid-configuration/api/auth`. MCP protected-resource metadata is at `/.well-known/oauth-protected-resource/api/mcp`. APIs and token exchange use wildcard non-credentialed CORS; hosted-login cookies remain same-origin.

## MCP authorization and consent

`oauth-policy.ts` owns client eligibility, resource scope allowances, registration defaults, the
required data scope and the MCP challenge scopes. Provider configuration, startup provisioning,
consent, token verification, and MCP metadata derive from this policy. Identity scopes never satisfy
the required `ryot:read` data permission. Both resources allow the advertised identity and refresh
scopes, preserving them through code exchange and refresh. Better Auth owns ID tokens and
scope-limited UserInfo claims, including the stored email verification state. First-party clients
target only the API resource; registered clients target only MCP. Registration eligibility does not
grant permissions: consent and token issuance retain only the approved scopes.

## Write access

Every credential carries a `writeAccess` level in `AuthorizationContext`, resolved by
`writeAccessFromScopes` in `@ryot-app/contract/oauth`:

| Level        | Scopes                                       | Writes                                  |
| ------------ | -------------------------------------------- | --------------------------------------- |
| `none`       | `ryot:read`                                  | Refused                                 |
| `confirm`    | `ryot:read ryot:write`                       | Only after the user confirms each write |
| `unattended` | `ryot:read ryot:write ryot:write:unattended` | Allowed without confirmation            |

OAuth tokens carry the scopes; API keys store them in Better Auth's `permissions.scopes`, chosen at
creation. Keys created outside Ryot's account endpoint have no scopes and are read-only. Trusted
durable work resolves `confirm`, because Ryo confirms each write itself. The auth middleware refuses
any `AuthenticatedMutationEndpoint` whose `MutationPolicy` is not `read` with `WriteAccessDenied`
unless the level is `unattended`; plugin operations apply the same rule to non-read-only operations
unless the agent write gate already confirmed the call.

Dynamic registration uses Better Auth's `/api/auth/oauth2/register`, with explicit
`token_endpoint_auth_method: "none"`, Authorization Code with S256 PKCE, the access scopes (all
three by default), optional `offline_access` for refresh tokens, optional `openid profile email` for identity, and the MCP resource. Registration assigns only that resource. Registered clients always
receive the consent ceremony on a new authorization, including when a previous grant exists;
first-party clients retain their provisioned skip-consent behavior. The built-in consent endpoint
owns approval, refusal and authorization-code issuance. The hosted page offers every access level up
to the requested one, defaulting to `confirm`, and submits the narrowed `scope`; raising the level
later requires a new authorization.

The hosted page posts `{ oauth_query }` to `/api/auth/oauth2/consent-details`. The companion plugin
verifies the provider signature and expiry before checking the session, resolves the signed client
through the provider, validates its registered redirect (including native loopback port matching),
and returns `{ clientName, redirectOrigin, scopes }` with the verified requested permissions. Invalid or altered queries
return 400; valid queries without a hosted session return 401. The page carries the original signed
query into login when the session has expired. Display parameters never become authorization input.

Internal durable work uses `AuthService.resolveTrustedAccount(userId)` with its persisted account
identity. This reloads disabled/bootstrap state, preferences, demo classification and the lifecycle
write guard; it neither synthesizes a transport credential nor keeps an original bearer token alive.
Public transports continue using `resolveRequestCredential` and never accept a trusted identity.
