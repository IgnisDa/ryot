# Auth Overhaul Plan

## Constraints

- Use Better Auth `oauthProvider()` as Ryot’s OAuth 2.1 authorization server.
- Use Authorization Code with S256 PKCE for web and native.
- Move the current `/auth` credential, signup, OIDC, and 2FA UI to `/oauth/login`.
- Keep `/oauth/login` inside the existing `kernel/client` SPA.
- Make `/auth` an OAuth launcher/status route.
- Keep API-key authentication as a user-owned personal-access-token mechanism.
- Add a normalized credential context distinguishing OAuth from API-key credentials.
- Provision internal OAuth clients automatically.
- Self-hosters still create only one application in Authentik, Google, Keycloak, etc.
- Remove the generic `ryot` URL scheme.
- Keep tokens in `localStorage` temporarily behind an asynchronous abstraction with a secure-storage TODO.
- Do not retain compatibility bridges or migrate old bearer tokens.
- The web client is not portable. A browser session always talks to the server
  that served it: the web server origin is `window.location.origin`, there is no
  onboarding step on web, and there is no “change server” action. Only the
  installed native app picks a server. `CLOUD_ORIGIN` and the cloud/self-hosted
  `ServerMode` choice leave the web path entirely.
- There are exactly two first-party OAuth clients, `ryot-web` and `ryot-native`,
  each with a redirect URI list rather than an environment-specific client ID.
- There is no consent UI. Every first-party client sets `skipConsent`, dynamic
  client registration is disabled, and user-managed client creation is disabled,
  so the consent page is unreachable and is not built.
- The client adds no OAuth library. Its PKCE client is written against WebCrypto
  and `fetch` (§14).

---

## 1. Add Dependencies

Backend, matching the installed Better Auth version:

```text
@better-auth/oauth-provider
```

Continue using:

```text
better-auth
@better-auth/api-key
@better-auth/redis-storage
genericOAuth()
twoFactor()
apiKey()
```

Add Better Auth’s built-in:

```text
jwt()
```

Client:

```text
@capacitor/browser
```

Use `oauthProviderClient()` only for `/oauth/login`. It is not the installed app’s PKCE client.

Do not add an OAuth client library. The installed app’s PKCE client is written
against WebCrypto and `fetch` (§14), and responses are decoded by the §2 Effect
schemas.

---

## 2. Define Shared OAuth Protocol

Add a shared module under `@ryot/contract` containing client IDs, scopes, callback paths, resource helpers, and schemas.

First-party clients — two, each with a redirect URI list:

| Client ID     | Type   | Redirect URIs                                                                             |
| ------------- | ------ | ----------------------------------------------------------------------------------------- |
| `ryot-web`    | web    | `<FRONTEND_URL>/auth/callback`                                                            |
| `ryot-native` | native | `io.ryot.app:/auth/callback` and `io.ryot.app.dev:/auth/callback`, both always registered |

The web callback always derives from `FRONTEND_URL`, whether the SPA is served by
Vite, reached through a tunnel, or served by the backend. Both native schemes are
registered in every environment; a debug build must be able to authenticate
against any server.

Define matching logout callbacks against the same lists.

Protocol constants:

```text
Resource: <FRONTEND_URL>/api
API scope: ryot:api
Access-token TTL: 15 minutes
Refresh-token TTL: 30 days
Scopes: openid profile email offline_access ryot:api
PKCE method: S256
```

Endpoint paths are fixed by Better Auth and shipped from this repo, so the
client constructs them from the server origin and these constants. It must not
depend on runtime metadata discovery.

Add Effect schemas for:

- OAuth token response
- UserInfo response
- Pending authorization
- Stored token set
- OAuth callback query
- Normalized authorization context

---

## 3. Add OAuth Database Schema

Extend:

```text
kernel/backend/src/lib/infrastructure/db/schema/tables/auth.ts
```

Add the exact schemas required by the OAuth Provider plugin:

```text
jwks
oauthClient
oauthResource
oauthClientResource
oauthRefreshToken
oauthAccessToken
oauthConsent
oauthClientAssertion
```

Add them to:

```text
kernel/backend/src/modules/auth/effect-postgres-adapter.ts
```

Generate a Drizzle migration with the backend’s existing migration command.

Do not add legacy session-token or user-data migration logic. Better Auth’s existing `session` table remains because the hosted browser login ceremony still uses sessions.

---

## 4. Provision Internal OAuth Clients

Create an auth-owned repository/service for app-managed OAuth records.

On server startup after schema migration, idempotently upsert exactly two
clients, `ryot-web` and `ryot-native`, with the redirect URI lists from §2.

`ryot-native` always carries both native schemes. `ryot-web` always carries only
the callback derived from `FRONTEND_URL`. The upsert updates that callback when
`FRONTEND_URL` changes and does not vary client records by environment.

### Three namespaces, do not mix them

The plugin uses OAuth-spec snake_case on the wire and camelCase everywhere
else. Provisioning writes rows through the repository, so it uses column names.

1. **`oauthClient` columns — camelCase.** What provisioning writes.
2. **Plugin options — camelCase.** Passed to `oauthProvider({ … })` in §5.
3. **Registration payloads — snake_case** (`redirect_uris`,
   `token_endpoint_auth_method`, `grant_types`, `response_types`,
   `application_type`, `client_name`, `require_pkce`, `skip_consent`,
   `enable_end_session`). These belong to the dynamic-registration and
   create-client endpoints, which this task disables. Provisioning must not
   use them.

### Client rows

Write these `oauthClient` columns for both clients:

```text
clientId                 ryot-web | ryot-native
clientSecret             null
applicationType          web | native
redirectUris             per §2
postLogoutRedirectUris   per §2
tokenEndpointAuthMethod  none
grantTypes               ["authorization_code", "refresh_token"]
responseTypes            ["code"]
scopes                   ["openid", "profile", "email", "offline_access", "ryot:api"]
requirePKCE              true
skipConsent              true
enableEndSession         true
disabled                 false
```

Use deterministic public client IDs. No client secret is created, and
`clientCredentialsScopes` stays empty so neither client can use the
client-credentials grant.

### Resource row

Write these `oauthResource` columns:

```text
identifier        <FRONTEND_URL>/api
allowedScopes     ["ryot:api"]
accessTokenTtl    900
refreshTokenTtl   2592000
disabled          false
```

Link each client to it with an `oauthClientResource` row (`clientId`,
`resourceId`).

Note that plugin-level `accessTokenExpiresIn` and `refreshTokenExpiresIn` also
exist. This task sets the TTLs on the resource row; confirm which wins for
resource-bound tokens before relying on either, and set only one.

### Plugin options that lock provisioning down

Set these in §5:

```text
enforcePerClientResources            true
allowDynamicClientRegistration       false
allowUnauthenticatedClientRegistration  false
clientPrivileges                     () => false
```

`clientPrivileges` is an RBAC callback gating the client CRUD endpoints;
returning `false` denies every user-initiated client action.

Update app-owned web redirects on startup if `FRONTEND_URL` changes.

Self-hosters do not manage these records.

### Validate `FRONTEND_URL` at startup

`FRONTEND_URL` is the single source of truth for the OAuth issuer, the API
resource identifier, the `ryot-web` redirect URI, and Better Auth’s
`trustedOrigins`. An operator who sets `FRONTEND_URL=https://ryot.example` but
reaches the server at `https://ryot.local` gets four unrelated-looking failures:
a `403` on login, `invalid_redirect_uri` on authorize, an issuer mismatch, and
an audience mismatch on the access token.

Fail fast instead:

- Reject a `FRONTEND_URL` that is not an absolute `http`/`https` origin, or that
  carries a path, query, or fragment.
- Log the resolved issuer, API resource identifier, and registered redirect URIs
  once at startup so a mismatch is visible without reproducing a login.

Additionally, expose the resolved frontend origin from `/api/system/config`
(`kernel/backend/src/modules/system/routes.ts`) and have `/oauth/login` compare
it against `window.location.origin`. On mismatch it must render one explicit
“this server is configured for `<origin>`” error rather than letting the
sign-in POST fail with an opaque `403`.

---

## 5. Configure Better Auth

Update:

```text
kernel/backend/src/modules/auth/service.ts
```

The plugin set should become conceptually:

```text
jwt()
oauthProvider()
twoFactor()
apiKey()
genericOAuth()
```

Remove:

```text
bearer()
oneTimeToken()
oidcTokenRedirect()
twoFactorBearerBridge()
```

Configure OAuth Provider with:

```text
loginPage: /oauth/login
supported first-party scopes
Ryot API resource
JWT access tokens
authorization-code and refresh grants
```

Leave `issuer` at Better Auth’s `baseURL`, which is `<FRONTEND_URL>/api/auth`.
Do not set it to the bare `FRONTEND_URL`; §6 depends on the path-ful form.

`consentPage` is a required option but is unreachable, because every first-party
client sets `skipConsent` and no other client can be registered. Point it at a
path the SPA renders as not-found, and cover the unreachability with a test
rather than with a route.

Keep `genericOAuth()` as the connection from Ryot to the self-hoster’s external identity provider.

External OIDC callback:

```text
<FRONTEND_URL>/api/auth/callback/oidc
```

Turn `advanced.disableCSRFCheck` off. Login requests now originate from the same server-hosted browser page.

Remove native deep-link schemes from Better Auth `trustedOrigins`. Registered OAuth client redirect URIs now control app callbacks.

Keep wildcard non-credentialed CORS for application APIs and OAuth token exchange. Browser login cookies are same-origin and do not depend on CORS.

---

## 6. Expose OAuth Discovery

No new routing is required, provided `issuer` stays at `<FRONTEND_URL>/api/auth`
as §5 specifies.

Where a metadata document lives is derived from the issuer string. The plugin
serves OIDC configuration at `[issuer-path]/.well-known/openid-configuration`,
so with a path-ful issuer it lands at
`<FRONTEND_URL>/api/auth/.well-known/openid-configuration` — already inside the
`/api/auth/*` route registered in `kernel/backend/src/boot/server.ts`. Nothing
collides with the SPA static fallback and self-hosters need no extra
reverse-proxy rule.

Do not advertise or route the root-anchored RFC 8414 variant at
`/.well-known/oauth-authorization-server/[issuer-path]`. The Ryot client
constructs endpoints from the §2 constants and never performs discovery, so
these documents exist only for third-party tooling.

Add tests proving, against `/api/auth/.well-known/openid-configuration`:

- Status is successful.
- Content type is JSON.
- Authorization endpoint is correct.
- Token endpoint is correct.
- Issuer is `<FRONTEND_URL>/api/auth`.
- PKCE S256 is advertised.
- HTML is never returned.

---

## 7. Add Credential Context

Keep `CurrentUser` focused on user profile data.

Add a second service in:

```text
packages/contract/src/auth-middleware.ts
```

Suggested shape:

```ts
type AuthorizationContext = {
	readonly userId: string;
	readonly credential:
		| { readonly kind: "oauth"; readonly clientId: string }
		| { readonly kind: "api-key"; readonly keyId: string };
};
```

Provide both `CurrentUser` and `AuthorizationContext` from authentication middleware.

Carry only what this task consumes. There is exactly one API scope, `ryot:api`,
and it is a precondition of admitting the request at all (§8), so it is not
carried as data. Do not add scope sets, role tables, or permission tables.

---

## 8. Rewrite Backend Credential Resolution

Application APIs should accept two explicit credential types.

OAuth:

```http
Authorization: Bearer <oauth-access-token>
```

API key:

```http
X-Api-Key: <user-api-key>
```

For OAuth:

- Verify signature using Ryot JWKS.
- Verify issuer.
- Verify audience `<FRONTEND_URL>/api`.
- Verify expiration.
- Require `ryot:api`.
- Read `sub` as the local user ID.
- Read `client_id` into `AuthorizationContext`.

For API keys:

- Use Better Auth API-key verification.
- Preserve rate limiting, expiry, Redis caching, and database fallback.
- Resolve `referenceId` to the local user.
- Include the key ID in `AuthorizationContext`.

For both:

- Load the authoritative user row.
- Reject disabled/deleted users.
- Enforce lifecycle write blocking.
- Preserve user ownership checks in services and repositories.

Do not accept Better Auth session cookies or old session bearer tokens on application API routes.

Update OpenAPI to show OAuth bearer and API key as alternatives.

---

## 9. Keep API Keys

Retain:

```text
@better-auth/api-key
apikey table
x-api-key authentication
rate limiting
expiry
user ownership
disable/delete revocation
```

Treat them conceptually as personal access tokens.

Do not replace them with `client_credentials`. Client credentials represent services, while Ryot API keys represent users.

Do not add API-key management UI in this task. The active client currently has none.

When management UI is added later, expose Ryot-owned PAT endpoints protected by OAuth rather than depending on Better Auth session-protected client endpoints.

---

## 10. Move Current Auth UI

Move the current credential UI from:

```text
kernel/client/src/routes/auth.tsx
```

to a new public route:

```text
kernel/client/src/routes/oauth.login.tsx
```

Reuse:

```text
CredentialsForm
TwoFactorForm
AuthStatus
```

Move `AuthStatus` into the auth module so it is not owned by a route.

The new `/oauth/login` route must:

- Be part of the same TanStack SPA.
- Be served by the backend’s existing static fallback.
- Bypass onboarding.
- Ignore `ServerService.selected`.
- Use `window.location.origin`.
- Remove “Change server”.
- Show the fixed server hostname.
- Preserve Better Auth’s signed `oauth_query`.
- Use same-origin cookies.
- Support password sign-in.
- Support password signup.
- Support external OIDC.
- Support TOTP.
- Support backup codes.
- Auto-launch OIDC when local auth is disabled.

- Render an explicit configuration error when `window.location.origin` does not
  match the frontend origin reported by `/api/system/config` (§4).

The dedicated hosted Better Auth client uses:

```text
baseURL: window.location.origin
credentials: same-origin
plugins: twoFactorClient(), oauthProviderClient()
```

Do not inject OAuth access tokens into this client.

### Web development requires a dev-server proxy [ALREADY DONE]

The web client’s server origin is always `window.location.origin`, so the Vite
dev server on `:3005` has to be a backend origin as far as the browser is
concerned. Add a proxy to `kernel/client/vite.config.ts` forwarding `/api` to
the local backend (`http://localhost:3000` by default), configurable with
`RYOT_DEV_BACKEND_ORIGIN`.

---

## 11. Implement Password Signup Continuation

For a new password user:

1. `/oauth/login` displays Sign in and Sign up.
2. User selects Sign up.
3. User submits email and password.
4. Better Auth creates the user and account.
5. Ryot’s bootstrap hook completes.
6. Better Auth establishes the temporary browser session.
7. OAuth Provider continues the signed authorization request.
8. Consent is skipped for the first-party client.
9. The app receives an authorization code.
10. The app exchanges it with PKCE.

Set `emailAndPassword.autoSignIn: true`, and do not add a manual sign-in step
after signup. `databaseHooks.session.create.before` in
`kernel/backend/src/modules/auth/service.ts` calls `gateSessionCreation`, which
runs `bootstrapNewUser` synchronously and fails session creation with
`USER_INITIALIZING` if bootstrap fails
(`kernel/backend/src/modules/auth/session-gate.ts`). The invariant “a session is
never issued before bootstrap succeeds” is enforced at the session-creation
boundary itself, so it holds however the session is created.

Keep a test asserting that a session cannot be created for a user whose
bootstrap fails, so the invariant stays enforced if the hook is ever refactored.

No email verification is added by this task.

---

## 12. Convert `/auth` into OAuth Launcher

The existing `/auth` route should stop collecting credentials.

Its responsibilities become:

- Resolve the server origin: `window.location.origin` on web, the stored
  selection on native.
- Restore existing OAuth tokens.
- Redirect authenticated users into the app.
- Load the server’s public configuration.
- Choose the first-party OAuth client for the platform.
- Generate state and PKCE.
- Persist pending authorization.
- Build the authorization URL.
- Navigate web or open the native browser.
- Show loading and retry states, plus change-server on native only.

Client selection:

```text
web → ryot-web
io.ryot.app, io.ryot.app.dev → ryot-native
```

Reject unknown native application IDs.

### Web routing consequences

- `decideRootGate` and `decideOnboardingGate` in
  `kernel/client/src/modules/server/route-gates.ts` gain a platform branch. On
  web a server is always resolved, so the `/onboarding` outcome is unreachable
  and `/onboarding` becomes a native-only route.
- `CLOUD_ORIGIN`, `ServerMode`, and `resolveServerOrigin` in
  `kernel/client/src/api/origin.ts` become native-only. Delete whatever the web
  path no longer reaches rather than leaving it wired to a branch that cannot
  be taken.
- `ServerService.changeServer` is native-only. Web sign-out clears tokens and
  returns to `/auth`; it never returns to a server picker.

---

## 13. Add OAuth Transaction Storage

Replace session-token storage with asynchronous OAuth storage.

Stored token set per server:

```text
accessToken
refreshToken
idToken
accessTokenExpiresAt
scope
tokenType
```

Pending authorization:

```text
state
serverOrigin
clientId
redirectUri
codeVerifier
createdAt
destination
```

Requirements:

- Validate persisted data with Effect Schema.
- Key records by normalized server origin/state.
- Remove malformed and expired records.
- Remove pending authorization after callback completion.
- Never migrate or read `ryot:session-token:*`.
- Keep the interface asynchronous.

Use `localStorage` as the initial implementation.

Add the requested TODO at the live storage layer to replace native storage with Keychain/Keystore later.

Do not let application code access `localStorage` directly.

---

## 14. Implement Web and Native Authorization

### PKCE and transaction parameters

Own these directly. They are the only cryptographic primitives the client needs,
and all three are WebCrypto one-liners.

```text
codeVerifier   32 random bytes from crypto.getRandomValues, base64url
codeChallenge  base64url(crypto.subtle.digest("SHA-256", utf8(codeVerifier)))
state          32 random bytes, base64url
nonce          32 random bytes, base64url
```

Requirements:

- Base64url encoding is unpadded and uses `-`/`_`. Write it once and test it
  against a known vector; a padded or `+`/`/` encoding produces a challenge the
  server rejects with an error that does not name the cause.
- `crypto.subtle` requires a secure context. Web is served over HTTPS, Android’s
  webview origin is `https://localhost`, and iOS treats `capacitor://localhost`
  as secure — but verify this on an iOS device early, because the failure mode
  is `crypto.subtle` being `undefined` rather than a thrown error.
- Keep these in a module with no service dependencies so they are directly
  testable, and keep the generated values inside the pending-authorization
  record (§13). Nothing else may read the verifier.
- `S256` only. Never emit a `plain` challenge or a `code_challenge_method`
  fallback.

The authorization URL is then a `URLSearchParams` build over the §2 constants:
`response_type=code`, `client_id`, `redirect_uri`, `scope`, `resource`,
`state`, `nonce`, `code_challenge`, `code_challenge_method=S256`.

### Launch

Web:

```text
window.location.assign(authorizationUrl)
```

Native:

```text
@capacitor/browser
```

Native flow:

1. Use `App.getInfo().id` to read the running bundle identifier.
2. Derive the authority-free callback from it; reject an unknown identifier.
   The client ID is always `ryot-native`.
3. Open the server authorization URL.
4. Receive `appUrlOpen`.
5. Close Capacitor Browser.
6. Route the callback through TanStack Router.

Callbacks:

```text
io.ryot.app:/auth/callback
io.ryot.app.dev:/auth/callback
```

`resolveDeepLinkHref` in `kernel/client/src/modules/navigation/deep-link.ts`
already handles the authority-free form: `new URL()` parses these with an empty
host and `/auth/callback` as the pathname, so the existing host-folding branch
is skipped and the query is preserved. Add a test pinning that, since the
current tests only cover the `scheme://host/path` shape.

---

## 15. Rewrite `/auth/callback`

Replace one-time-token handling with authorization-code exchange.

Accept:

```text
code
state
error
error_description
```

Processing:

1. Find pending authorization by state.
2. Reject missing, unknown, expired, or replayed state.
3. Verify server, client ID, and redirect URI.
4. Exchange the code using the saved PKCE verifier.
5. Decode the token response with the §2 Effect schema; check that `nonce` in
   the ID token matches the pending record.
6. Store access, refresh, and ID tokens.
7. Delete pending authorization.
8. Replace history.
9. Navigate to the saved safe destination.

Never put access or refresh tokens in callback URLs.

### Token endpoint calls

Code exchange (§15), refresh (§16), and revocation (§18) are all
`application/x-www-form-urlencoded` POSTs to the endpoints derived from the §2
constants, decoded by the §2 Effect schemas. Write one small helper they share
rather than three ad-hoc `fetch` calls, and map a non-2xx body to the tagged
error the caller branches on — `invalid_grant` in particular must be
distinguishable, since §16 clears authentication on it.

The client does not verify the ID token’s signature. It arrives directly from
the token endpoint over TLS, which OIDC Core §3.1.3.7 permits, and no
client-side authorization decision reads it: the server validates the access
token independently (§8), and the ID token is used only for `nonce` matching
here and as `id_token_hint` at logout. Treat its claims as display data, never
as a trust boundary.

---

## 16. Add Refresh Coordination

Create a token service with one refresh operation in flight per server.

Before API calls:

- Return an access token that is not near expiry.
- Refresh when needed.
- Persist rotated refresh tokens.
- Retry one failed request after successful refresh.
- Clear authentication on `invalid_grant`.
- Never enter a refresh retry loop.

Update:

```text
kernel/client/src/api/authenticated.ts
kernel/client/src/modules/plugins/events.ts
```

SSE reconnects must obtain a current access token before opening.

---

## 17. Replace Installed-App Session Restoration

Remove installed-app use of Better Auth `useSession`.

Restore authentication by:

1. Loading the token set.
2. Refreshing if necessary.
3. Calling OAuth UserInfo or an OAuth-protected current-user endpoint.
4. Building the existing snapshot states:

```text
pending
authenticated
missing
```

Keep route-gate behavior stable.

The hosted `/oauth/login` page may still use Better Auth browser sessions.

---

## 18. Implement Logout

Logout must:

1. Revoke refresh token.
2. Revoke access token where supported.
3. Clear local tokens and pending transactions.
4. Open OAuth Provider end-session.
5. Clear the hosted browser session.
6. Return through an exact registered logout callback.
7. Clear local state even when remote logout fails.

Store the ID token for `id_token_hint`.

Add web and native logout callback routes.

Step 5 is best-effort on native. `@capacitor/browser` is SFSafariViewController
on iOS and Chrome Custom Tabs on Android, not `ASWebAuthenticationSession`, so
the hosted login cookie is not reliably reachable from a later end-session
navigation. Steps 1–3 and 7 are the ones that must hold: local tokens are always
cleared and the refresh token is always revoked server-side, so a stale browser
session can at most skip a password prompt on the next login, never retain API
access. Do not block logout on step 5 succeeding.

On user disable/delete:

- Delete browser sessions.
- Revoke OAuth refresh/access records.
- Preserve API-key revocation and cache purging.
- Continue rejecting JWT access through authoritative user lookup immediately.

---

## 19. Remove Legacy Bridges

Delete:

```text
kernel/backend/src/modules/auth/oidc-redirect.ts
kernel/backend/src/modules/auth/oidc-redirect.test.ts
kernel/backend/src/modules/auth/two-factor-bridge.ts
kernel/backend/src/modules/auth/two-factor-bridge.test.ts
```

Remove all use of:

```text
set-auth-token
set-ott
one-time-token
set-two-factor-token
x-two-factor-token
old session bearer storage
OIDC token query parameters
bridge ordering comments
```

Keep Better Auth browser sessions, 2FA, external OIDC, and API keys.

---

## 20. Remove Generic Native Scheme

Android:

- Remove the `ryot` intent-filter scheme.
- Keep `${applicationId}`.
- Debug resolves to `io.ryot.app.dev`.
- Release resolves to `io.ryot.app`.

iOS:

- Remove `ryot` from `CFBundleURLSchemes`.
- Keep `$(PRODUCT_BUNDLE_IDENTIFIER)`.
- Debug resolves to `io.ryot.app.dev`.
- Release resolves to `io.ryot.app`.

Client:

- Remove `ryot` from `DEEP_LINK_SCHEMES`.
- Add authority-free callback tests.
- Keep ordinary deep links working through the bundle-ID scheme.

---

## 21. Update Tests

Backend:

- OAuth schema and adapter mapping.
- First-party client provisioning, and that re-running it is idempotent.
- `ryot-web` carries exactly the callback derived from `FRONTEND_URL` in every environment.
- `ryot-native` carries both native schemes in every environment.
- `/api/auth/.well-known/openid-configuration` returns JSON with issuer `<FRONTEND_URL>/api/auth`.
- `FRONTEND_URL` validation rejects a value with a path, query, or fragment.
- PKCE required.
- Exact redirect matching.
- JWT issuer, audience, and expiry checks; `ryot:api` required.
- API keys still authenticate.
- OAuth/API-key authorization context.
- Disabled/deleted users.
- Dynamic registration unavailable.
- Consent is unreachable: no configured client can reach `consentPage`.

Hosted UI:

- Password signup continues authorization.
- Password login continues authorization.
- TOTP and backup codes continue authorization.
- OIDC preserves state cookie.
- Local-auth-disabled auto-launch.
- No change-server action.
- Hosted route ignores selected-server storage.
- Origin mismatch against `/api/system/config` renders a configuration error.

Client:

- Web route gates never reach `/onboarding`; native still can.
- Runtime client selection.
- PKCE generation: base64url encoding against a known vector, `S256` challenge
  derivation, and that no code path emits `plain`.
- Pending transaction validation.
- Code exchange.
- Refresh rotation and single-flight.
- Callback replay rejection.
- Logout.
- Authority-free native callbacks.
- No old headers/storage keys.

E2E:

- Password signup → OAuth code → token → API.
- Password login → OAuth code → token → API.
- External OIDC → OAuth code → token → API.
- 2FA → OAuth code → token.
- Refresh.
- Revocation.
- Wrong state.
- Wrong PKCE verifier.
- Redirect mismatch.
- Code replay.
- Both native callback schemes accepted regardless of server environment.
- API-key authentication and user lifecycle revocation.
- Browser-level state-cookie test.

Rewrite E2E auth fixtures to obtain OAuth tokens instead of reading
`set-auth-token`. The cost is concentrated in
`e2e/src/fixtures/kernel/auth.ts`, which gains one helper that drives
authorize → sign-in → continue → token exchange;
`e2e/src/fixtures/kernel/contract-client.ts` already threads arbitrary headers,
so the roughly ten consumer files only need the threaded value renamed.

---

## 22. Update Documentation

Rewrite:

```text
kernel/backend/src/modules/auth/README.md
apps/docs/src/guides/authentication.md
docs/ryot-client-plugin-design.md
e2e/README.md
```

Update `kernel/backend/CLAUDE.md`: the `exposedHeaders` rule under Shared
Infrastructure exists to protect the `bearer` plugin’s `set-auth-token`, which
this task deletes. Rewrite or remove it rather than leaving a rule about a
plugin that is gone.

Add to `kernel/client/AGENTS.md`: `/oauth/login` is a server-side contract, not
an ordinary app route. The server serves it from its own SPA build while the
native app runs a separately bundled build, so the two can be different
versions. Its URL, its handling of Better Auth’s signed `oauth_query`, and its
independence from `ServerService` must stay stable across releases.

Self-host documentation must state:

```text
One external OIDC application
One callback: <FRONTEND_URL>/api/auth/callback/oidc
No mobile callback registered at Authentik/Google/Keycloak
Internal Ryot clients are automatic
FRONTEND_URL must be the URL users actually browse to; HTTPS strongly recommended but HTTP is supported for self-hosters
```

Document reverse-proxy requirements:

- Forward `/api/auth/*`.
- Preserve `Authorization`.
- Do not cache authorization/token responses.
- Cloudflare Tunnel is supported.
- Cloudflare Access may need separate API/mobile configuration.

No root `/.well-known/*` forwarding rule is needed; discovery lives under
`/api/auth` (§6).

Remove:

- Manual local-to-OIDC conversion.
- `<FRONTEND_URL>/api/auth` as callback.
- One-time-token handoff.
- 2FA header bridge.
- Generic `ryot` scheme.

Retain API-key documentation as user-owned personal automation credentials.

Regenerate generated configuration documentation.

---

## 23. Implementation Order

Implement in this order:

1. OAuth/JWKS schema and migration.
2. OAuth Provider configuration and `FRONTEND_URL` validation.
3. First-party client/resource provisioning.
4. OAuth token verification at the API boundary.
5. API-key branch and authorization context.
6. `/oauth/login` using the moved current UI.
7. Password signup/login continuation.
8. External OIDC and 2FA continuation.
9. Web route-gate collapse: drop onboarding, `CLOUD_ORIGIN`, and server selection on web.
10. Vite dev-server proxy.
11. Web PKCE launcher and callback.
12. Refresh and session restoration.
13. Native browser and callback schemes.
14. Logout.
15. Legacy bridge deletion.
16. E2E fixture migration.
17. Documentation.
18. Cleanup pass.

Keep the old and new implementation from coexisting in the final tree. Temporary overlap during development should be removed before completion.

---

## 24. Acceptance Criteria

The work is complete when:

- Fresh web users can create a password account through `/oauth/login`.
- Existing web users can sign in using password, OIDC, and 2FA.
- Debug iOS and Android use `io.ryot.app.dev:/auth/callback`.
- Release builds use `io.ryot.app:/auth/callback`.
- Web/native APIs use OAuth access tokens.
- Refresh works after access-token expiry.
- API keys continue authenticating user API calls.
- Disabled/deleted users lose OAuth and API-key access.
- `/oauth/login` is served from the existing SPA.
- First-party clients skip consent, and no consent route exists.
- `/api/auth/.well-known/openid-configuration` returns JSON, with no root routing added.
- The web client has no onboarding step, no server picker, and no `CLOUD_ORIGIN` reference.
- `bun run dev` on `:3005` completes a full sign-in against a local backend through the proxy.
- A malformed `FRONTEND_URL` fails startup instead of failing at login.
- No bridge headers, one-time-token handoff, old bearer session tokens, or `ryot` scheme remain.
- Self-hosters configure only one external OIDC application.
- Password auth, OIDC, native callback, logout, refresh, and API-key E2E suites pass.
