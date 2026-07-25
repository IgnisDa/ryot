# Ryot V2 Demo Account Access — Implementation Plan

## Objective

Implement a dedicated interactive demo-account feature in Ryot V2 on the `ultra-rewrite` branch.

V1 lives under `crates/{backend,frontend}` on `main`. V2 lives under `kernel/{backend,client}` plus the shared `packages/*` workspaces. V1 demo behavior is only historical reference; do not preserve its architecture.

The finished behavior must allow an anonymous visitor to follow a public demo link, enter a real shared V2 user account through Ryot's normal first-party OAuth flow, and use the authenticated application shell.

The same underlying user must also remain fully administrable through an ordinary login performed by the account owner.

This is greenfield. There is no production user data. Make clean breaking changes where appropriate. Do not add compatibility layers, migration shims for client-side auth state, dual implementations, temporary bridges, or legacy abstractions.

Do not implement any periodic demo reset.

Do not implement demo-specific abuse quotas, upload limits, provider throttling, job throttling, or similar anti-abuse mechanisms. Existing generic protections remain unchanged.

---

# 1. Final product decisions

Treat every item in this section as fixed. Do not reopen these decisions during implementation.

## 1.1 Demo account identity

The demo is one ordinary, real Ryot user.

Add an optional configuration value:

```text
USERS_DEMO_ACCOUNT_ID
```

This contains the stable V2 user ID of the shared demo account.

Rules:

- Presence of `USERS_DEMO_ACCOUNT_ID` enables demo access.
- Absence disables demo access.
- Do not add a separate `SERVER_IS_DEMO_INSTANCE`.
- Do not configure the demo user's email.
- Do not configure its password.
- Do not add `isDemo` or equivalent to the `user` table.
- Do not expose the configured user ID through `/system/config`.
- The configured user must already exist. Demo access does not create it.
- If the configured user is missing or disabled, demo entry is unavailable.
- `USERS_ALLOW_REGISTRATION=false` is expected on the hosted demo instance and must not prevent demo login or normal login for an existing user.

The account itself is not restricted. The authentication provenance is restricted.

## 1.2 Authentication classes

Introduce exactly two authentication/session classes:

```ts
type AccessClass = "standard" | "demo";
```

Meaning:

- `standard`: ordinary account authority.
- `demo`: authenticated access carrying demo restrictions.

A user may have both kinds of credentials concurrently.

A normal login to the configured demo user is `standard` and must be able to change preferences, disable broken features, repair plugin configuration, and otherwise maintain the account.

## 1.3 OAuth clients

V2 currently has:

```text
ryot-web
ryot-native
```

Add:

```text
ryot-demo-web
```

`ryot-demo-web` is:

- web-only;
- a public OAuth client;
- Authorization Code + S256 PKCE;
- the same scopes as `ryot-web`;
- the same API resource as `ryot-web`;
- the same web callback URI;
- the same web logout callback URI;
- consent-skipping like the existing trusted first-party clients.

It exists specifically to give restricted OAuth credentials durable provenance through `client_id`.

The demo client must always be reconciled in OAuth provisioning:

- if `USERS_DEMO_ACCOUNT_ID` exists, provision `ryot-demo-web` with `disabled = false`;
- if it does not exist, provision/reconcile the record with `disabled = true`.

Do not leave an old enabled demo-client database record after demo configuration is removed.

## 1.4 Demo entry point

There must be no "Try the demo" control inside Ryot's regular `/auth` or `/oauth/login` UI.

The external public entry URL is:

```text
https://demo.ryot.io/demo
```

The marketing website and repository README link directly to that URL.

Add `/demo` to the V2 client as an entry route whose purpose is to bootstrap the restricted login and launch OAuth. It is not ordinary application navigation and does not need a navigation item.

## 1.5 API keys

For the configured demo user:

- every API key resolving to that user is `demo`;
- this applies even if the key was created earlier from a standard owner session;
- a demo hosted session cannot create/update/delete API keys;
- a demo hosted session cannot list or inspect API-key metadata;
- owner maintenance should use normal OAuth rather than privileged demo-user API keys.

For all other users, API-key behavior remains standard.

## 1.6 No reset

Do not build:

- scheduled reset;
- startup reset;
- snapshot restoration;
- seeded-data restoration;
- rollback;
- cleanup daemon;
- "reset demo" administrator control.

Shared domain changes are persistent.

---

# 2. Security invariants

The implementation must maintain all of these invariants.

### Invariant A — user identity does not determine OAuth authority

For the configured demo user:

```text
normal ryot-web OAuth   -> standard
normal ryot-native OAuth -> standard
ryot-demo-web OAuth     -> demo
API key                 -> demo
```

Do not implement:

```ts
if (user.id === demoAccountId) {
	blockEverything();
}
```

### Invariant B — a demo Better Auth session cannot mint a standard OAuth token

A hosted Better Auth session with:

```text
accessClass = demo
```

may authorize:

```text
ryot-demo-web
```

It must not authorize:

```text
ryot-web
ryot-native
```

Return a Better Auth `403` if this is attempted.

This prevents a visitor from entering via `/demo` and manually starting the ordinary OAuth client to escape restrictions.

### Invariant C — a standard hosted session is never downgraded

If `/demo` is opened while a normal Better Auth hosted session already exists, do not replace it with a demo session.

Use that standard hosted session and start `ryot-web`, not `ryot-demo-web`.

This preserves legitimate administrator access.

### Invariant D — an existing application OAuth session is never overwritten by visiting `/demo`

If the client already has a valid stored OAuth token set for the server, `/demo` immediately enters the authenticated application using that existing session.

Do not replace a standard application token with a demo token.

Do not replace an existing demo token unnecessarily either.

### Invariant E — switching from demo authority to owner authority is explicit

Do not build an administrator bypass, secret query parameter, special cookie, hidden button, or privileged demo-token upgrade.

To move from an active demo OAuth session to standard owner authority, sign out and use ordinary login.

### Invariant F — unknown provenance fails closed for the configured demo account

For credentials resolving to `USERS_DEMO_ACCOUNT_ID`:

- recognized `ryot-web` / `ryot-native` OAuth credentials are standard;
- `ryot-demo-web` credentials are demo;
- API keys are demo;
- an unexpected/unknown OAuth client ID should be treated as demo rather than standard.

This matters if additional OAuth clients ever appear accidentally.

For other users, existing behavior remains standard.

---

# 3. Data model

## 3.1 Shared access-class contract

Define the access-class schema once in `packages/contract`.

Suggested location:

```text
packages/contract/src/oauth.ts
```

or a small dedicated auth-access module if that keeps `oauth.ts` cleaner.

Use the shared type everywhere:

```ts
export const AccessClass = Schema.Literals(["standard", "demo"]);
export type AccessClass = typeof AccessClass.Type;
```

Do not duplicate string unions in backend and client.

## 3.2 Better Auth session column

Modify:

```text
kernel/backend/src/lib/infrastructure/db/schema/tables/auth.ts
```

Add to `session`:

```text
accessClass
```

Requirements:

- non-null;
- defaults to `"standard"` at the database level;
- represented as a Better Auth additional session field;
- server-owned;
- clients cannot submit or update it;
- normal sessions default to `standard`.

Generate a proper Drizzle migration using the backend's existing migration workflow.

Do not write custom migration compatibility logic.

## 3.3 Better Auth schema configuration

In:

```text
kernel/backend/src/modules/auth/service.ts
```

configure the Better Auth `session.additionalFields` equivalent for `accessClass`.

Requirements:

```text
defaultValue = standard
input = false
```

Use Better Auth's supported additional-field mechanism. Do not maintain an unsigned side cookie containing the access class.

## 3.4 AuthorizationContext

Modify:

```text
packages/contract/src/oauth.ts
packages/contract/src/auth-middleware.ts
```

`AuthorizationContext` must expose:

```ts
{
  userId,
  credential,
  accessClass,
}
```

Keep `CurrentUser` unchanged. In particular, do not add demo state to `CurrentUser`.

`CurrentUser` answers "who is this?"

`AuthorizationContext` answers "with what authority did this request arrive?"

---

# 4. OAuth token/client refactor

The existing client assumes that the OAuth client is always determined from the current runtime platform. That is no longer valid because a web installation can hold either a `ryot-web` or `ryot-demo-web` token.

Refactor this cleanly before implementing `/demo`.

Primary files:

```text
packages/contract/src/oauth.ts
kernel/client/src/modules/auth/oauth-storage.ts
kernel/client/src/modules/auth/token-service.ts
kernel/client/src/modules/auth/runtime-client.ts
kernel/client/src/modules/auth/oauth-launcher.ts
kernel/client/src/modules/auth/service.ts
kernel/client/src/api/authenticated.ts
kernel/client/src/routes/auth_.callback.tsx
```

## 4.1 Add the client ID

Add:

```ts
export const OAUTH_DEMO_WEB_CLIENT_ID = "ryot-demo-web";
```

Include it in the appropriate OAuth client-ID schema.

Keep helpers that distinguish:

```text
normal web client
demo web client
native client
```

Do not pretend `ryot-demo-web` is a native-capable client.

## 4.2 StoredTokenSet owns its client ID

Change `StoredTokenSet` to contain:

```ts
clientId;
```

Once an authorization is completed, the resulting token set must remember which OAuth client issued it.

After this refactor:

- refresh uses `StoredTokenSet.clientId`;
- UserInfo uses the stored token's client;
- token revocation uses the stored client;
- end-session/logout uses the stored client;
- authenticated API calls no longer ask `RuntimeOAuthClientService` which client issued the existing token.

`RuntimeOAuthClientService` remains responsible for selecting the client for a **new normal authorization**, not for interpreting an existing token set.

Because the project is greenfield, do not migrate old browser/native token storage. Existing malformed/old `StoredTokenSet` values should fail schema decoding and be evicted by the existing storage behavior.

## 4.3 Callback validation

The web callback must accept pending authorizations created for either:

```text
ryot-web
ryot-demo-web
```

The native callback must accept only:

```text
ryot-native
```

Do not simply trust `pending.clientId` because pending authorization storage is client-controlled storage.

Validate:

- current platform;
- client ID;
- expected callback URI;
- server origin;
- OAuth state;
- existing nonce behavior;
- PKCE flow.

For web:

```text
ryot-web       -> ordinary web callback URI
ryot-demo-web  -> ordinary web callback URI
```

For native:

```text
ryot-native -> derived registered native callback URI
```

Any invalid platform/client/redirect combination fails authorization.

## 4.4 Client session access class

Extend the authenticated client session snapshot in:

```text
kernel/client/src/modules/auth/service.ts
```

Authenticated session state should expose:

```ts
{
  status: "authenticated",
  accessClass: "standard" | "demo",
  user: ...
}
```

Derive it from the stored OAuth client:

```text
ryot-demo-web -> demo
anything else valid -> standard
```

Do not add another API call or custom UserInfo claim merely to discover demo state.

---

# 5. OAuth server provisioning

Modify:

```text
kernel/backend/src/modules/auth/oauth-provisioning.ts
```

Provision three internal OAuth clients:

```text
ryot-web
ryot-native
ryot-demo-web
```

`ryot-demo-web` uses:

- `applicationType: "web"`;
- web redirect URI;
- web post-logout URI;
- PKCE required;
- no client secret;
- same scopes;
- same API resource;
- same grant types;
- skip consent.

Change the provisioning function signature so it receives whether demo access is configured.

Tests must assert the complete records for both:

```text
demo enabled
demo disabled
```

Do not duplicate the whole web-client construction logic. Factor the shared client constructor cleanly.

---

# 6. Hosted demo-session endpoint

Implement demo hosted-session creation as part of the Better Auth system, not as an application API endpoint.

Suggested dedicated module:

```text
kernel/backend/src/modules/auth/demo-access-plugin.ts
```

Integrate it into `makeAuthInstance` in:

```text
kernel/backend/src/modules/auth/service.ts
```

Expose:

```text
POST /api/auth/demo/sign-in
```

Do not accept a user ID, email, password, access class, or other identity input from the caller.

The endpoint reads `USERS_DEMO_ACCOUNT_ID` from server configuration.

Use Better Auth's own session creation and session-cookie helpers. Do not construct Better Auth cookies manually.

## 6.1 Exact endpoint state machine

### Demo not configured

If `USERS_DEMO_ACCOUNT_ID` is absent:

```text
403/404-style demo unavailable response
code: DEMO_DISABLED
```

Do not reveal configuration details.

### Configured user missing

Return:

```text
DEMO_ACCOUNT_UNAVAILABLE
```

### Configured user disabled

Return:

```text
DEMO_ACCOUNT_UNAVAILABLE
```

Use the same public message as missing so account existence is not exposed.

### No existing hosted session

Create a Better Auth session for the configured user with:

```text
accessClass = demo
```

Set the normal Better Auth session cookie.

Return:

```json
{ "mode": "demo" }
```

### Existing matching demo session

If:

```text
session.userId == USERS_DEMO_ACCOUNT_ID
session.accessClass == demo
```

reuse it.

Return:

```json
{ "mode": "demo" }
```

### Existing stale demo session

If:

```text
session.accessClass == demo
session.userId != current USERS_DEMO_ACCOUNT_ID
```

which can happen after deployment configuration changes:

- revoke/delete the stale hosted session;
- create a new demo session for the currently configured account;
- set the replacement cookie;
- return `{ "mode": "demo" }`.

### Existing standard hosted session

For any:

```text
accessClass == standard
```

do not alter it, regardless of which user owns it.

Return:

```json
{ "mode": "standard" }
```

The client will start ordinary `ryot-web` OAuth from that session.

## 6.2 Endpoint security

The endpoint is:

- POST-only;
- same-origin;
- covered by Better Auth's normal origin/CSRF protection;
- not CORS-enabled as an anonymous cross-origin login API;
- free of user-controlled identity selection.

Do not add demo-specific rate limiting.

---

# 7. Hosted Better Auth operation protection

The application middleware cannot protect Better Auth account endpoints because they bypass the application API.

Extend the existing Better Auth `hooks.before` enforcement in:

```text
kernel/backend/src/modules/auth/service.ts
```

The existing lifecycle-path mechanism is the precedent.

When the current hosted session has:

```text
accessClass = demo
```

return Better Auth `403` with code:

```text
DEMO_OPERATION_PROTECTED
```

for account and credential control-plane operations.

At minimum protect:

```text
/api-key/create
/api-key/update
/api-key/delete

/change-email
/change-password
/set-password
/update-user
/delete-user
/update-session

/link-social
/unlink-account

/two-factor/enable
/two-factor/disable
/two-factor/generate-backup-codes

/revoke-session
/revoke-sessions
/revoke-other-sessions

/list-accounts
/get-access-token
/refresh-token
/account-info

/list-sessions

/api-key/list
/api-key/get

/two-factor/get-totp-uri
```

The hook must resolve the hosted session for every protected path, including GET routes. Lifecycle
protection remains limited to lifecycle-sensitive mutations; these credential reads are demo-protected
without becoming lifecycle-protected.

Keep ordinary session retrieval and logout available.

Keep login and 2FA verification flows available so someone who actually knows the account credentials can authenticate normally.

Also enforce the OAuth-client invariant in the same Better Auth boundary:

```text
demo hosted session + ryot-demo-web authorization -> allowed
demo hosted session + ryot-web authorization      -> 403
demo hosted session + ryot-native authorization   -> 403
```

A standard hosted session may authorize any normal client and may also authorize `ryot-demo-web`. A standard session using the demo OAuth client still receives a restricted demo OAuth credential.

Do not base this check on user ID.

---

# 8. Resolve credential authority on the backend

Refactor:

```text
kernel/backend/src/modules/auth/service.ts
```

so the resolved credential always includes the full authorization context.

The current `AuthService.currentUser(headers)` loses credential provenance. Replace/refactor it with a primitive such as:

```ts
resolveRequestCredential(headers): Effect<{
  user: CurrentUserValue;
  authorization: AuthorizationContextValue;
}>
```

The normal HTTP middleware and the plugin operation service should both use this same primitive.

Do not maintain one authentication implementation for normal endpoints and a second implementation for plugins.

## 8.1 OAuth classification

After token verification and authoritative user loading:

```text
client_id == ryot-demo-web
    -> demo

client_id == ryot-web || ryot-native
    -> standard

unknown client_id && user == USERS_DEMO_ACCOUNT_ID
    -> demo

unknown client_id && any other user
    -> standard
```

## 8.2 API-key classification

After API-key verification and user loading:

```text
user == USERS_DEMO_ACCOUNT_ID
    -> demo

otherwise
    -> standard
```

If demo configuration is absent, API keys retain normal authority.

---

# 9. Typed application 403

Do not reuse `AuthUnauthorized`.

Modify:

```text
packages/contract/src/auth-middleware.ts
```

Add a dedicated typed error:

```ts
DemoOperationProtected;
```

with:

```ts
reason: {
	code: "demo-operation-protected";
}
```

HTTP status:

```text
403
```

Add it to the `AuthMiddleware` error surface alongside the existing auth errors.

Reasons:

- the caller is authenticated;
- token refresh must not be attempted;
- login must not be triggered;
- client UX needs to distinguish deliberate demo restriction from authentication failure.

Client copy should consistently use:

```text
This operation is unavailable while using the shared demo account.
```

Do not tell users to create an account on the demo instance.

---

# 10. Contract-level demo access policy

Add an endpoint annotation, preferably alongside the existing HTTP annotations:

```text
packages/contract/src/http-annotations.ts
```

Define:

```ts
DemoAccessPolicy = "allowed" | "protected";
```

The runtime default may be `"allowed"`.

Example contract usage:

```ts
HttpApiEndpoint.post(...)
  .annotate(DemoAccessPolicy, "allowed")
```

or:

```ts
HttpApiEndpoint.patch(...)
  .annotate(DemoAccessPolicy, "protected")
```

## Policy rule

For endpoints protected by `AuthMiddleware`:

- `GET`, `HEAD`, `OPTIONS` default to demo-allowed;
- sensitive reads may explicitly annotate `protected`;
- every `POST`, `PUT`, `PATCH`, or `DELETE` must explicitly annotate either `allowed` or `protected`.

A demo request to a protected endpoint fails in `AuthMiddleware` with `DemoOperationProtected`.

A standard request ignores the demo annotation.

AdminMiddleware-only endpoints are unrelated to this feature.

Unauthenticated/signed-token endpoints are unrelated unless specifically called out below.

---

# 11. Architecture check

Extend:

```text
kernel/backend/scripts/check-architecture.ts
```

The architecture checker must prevent future authenticated mutations from being added without demo classification.

Use the TypeScript parser/compiler API rather than a formatting-sensitive regex.

Inspect:

```text
packages/contract/src/modules/**/contract.ts
```

For contract groups/endpoints using `AuthMiddleware`:

- locate `HttpApiEndpoint.post`;
- `put`;
- `patch`;
- `delete`;
- require an explicit `DemoAccessPolicy` annotation resolving to exactly `allowed` or `protected`.

Do not require this annotation for:

- `AdminMiddleware`-only God Mode routes;
- test-support admin routes;
- unauthenticated integration webhooks;
- signed local upload target routes;
- other genuinely unauthenticated groups.

Add architecture-check tests/fixtures proving:

- unclassified authenticated POST fails;
- unclassified authenticated PATCH fails;
- explicit allowed passes;
- explicit protected passes;
- ordinary GET without annotation passes;
- explicitly protected GET passes;
- AdminMiddleware mutation is not incorrectly flagged.

The contract annotation is the single source of truth for both runtime enforcement and architecture auditing.

---

# 12. Exact current application endpoint classification

Apply the following classifications. Do not improvise a different boundary.

## Automations

File:

```text
packages/contract/src/modules/automations/contract.ts
```

Protected:

```text
POST   /automations/rules
POST   /automations/rules/:ruleId/activate
POST   /automations/rules/:ruleId/deactivate
DELETE /automations/rules/:ruleId
POST   /automations/runs/:runId/retry
```

Reason: notification/background-control configuration and retriggering retained automation executions.

God Mode automation endpoints use `AdminMiddleware`; do not apply demo policy there.

## Backups

File:

```text
packages/contract/src/modules/backups/contract.ts
```

Protect every authenticated endpoint:

```text
POST   /backups/exports
GET    /backups/runs
GET    /backups/runs/:id
GET    /backups/runs/:id/download
DELETE /backups/runs/:id
POST   /backups/restores
```

Backups are control-plane data and may expose portable account/configuration contents.

## Client renderers/pages

File:

```text
packages/contract/src/modules/client-pages/contract.ts
```

Protected:

```text
POST   /client-renderers
PUT    /client-renderers/:rendererId/draft
POST   /client-renderers/:rendererId/publish
DELETE /client-renderers/:rendererId
```

Allowed:

```text
POST   /client-pages/prepare
POST   /client-pages/sessions
POST   /client-pages/sessions/:sessionId/renew
DELETE /client-pages/sessions/:sessionId
```

Renderer authoring changes executable/presentation configuration. Page preparation/session lifecycle is ordinary application execution.

Artifact-token file serving remains unchanged.

## Collections

File:

```text
packages/contract/src/modules/collections/contract.ts
```

Allowed:

```text
POST   /collections
POST   /collections/memberships
DELETE /collections/memberships
```

These are shared domain data.

## Definitions/plugin installation state

File:

```text
packages/contract/src/modules/definitions/contract.ts
```

Protected:

```text
PATCH /definitions/plugins/:pluginSlug
```

This endpoint can disable/reconfigure/reorder installed functionality.

Ordinary definition reads remain allowed.

## Entities

File:

```text
packages/contract/src/modules/entities/contract.ts
```

Allowed:

```text
POST /entities
```

## Entity-interest socket

File:

```text
packages/contract/src/modules/entity-interest/contract.ts
```

Allowed:

```text
POST /entity-interest/socket-ticket
```

This is transient authenticated application infrastructure.

## Events

File:

```text
packages/contract/src/modules/events/contract.ts
```

Allowed:

```text
POST /events
```

## Imports

File:

```text
packages/contract/src/modules/imports/contract.ts
```

Allowed:

```text
POST   /imports/runs
DELETE /imports/runs/:runId
```

Imports are explicitly part of the interactive demo product surface. Keep them usable even when an import temporarily accepts credentials/tokens as input.

## Integrations

File:

```text
packages/contract/src/modules/integrations/contract.ts
```

Protected:

```text
GET    /integrations/:integrationId
POST   /integrations
PATCH  /integrations/:integrationId
DELETE /integrations/:integrationId
POST   /integrations/sync
```

`GET /integrations/:integrationId` is intentionally protected even though provider secrets are already redacted. `ListedIntegration` can expose `webhookUrl`, which is reusable external-control authority because the corresponding webhook is not authenticated through ordinary user middleware.

Allowed:

```text
GET /integrations/providers
```

The integration summaries currently used by the list screen come through RyotQL and do not include provider credentials or webhook URLs; those summaries remain visible.

The external:

```text
POST /webhooks/integrations/:integrationId
```

is not an AuthMiddleware endpoint. Leave it unchanged.

## Notifications

File:

```text
packages/contract/src/modules/notifications/contract.ts
```

Protected:

```text
POST   /notifications/channels
PATCH  /notifications/channels/:channelId
DELETE /notifications/channels/:channelId
POST   /notifications/channels/test
```

## Plugins

File:

```text
packages/contract/src/modules/plugins/contract.ts
```

Protected:

```text
POST   /plugins
PUT    /plugins/:pluginSlug
DELETE /plugins/:pluginSlug
PUT    /plugins/:pluginSlug/home-view
```

Plugin `invoke` is handled separately because it performs its own authentication.

## Provider entities

File:

```text
packages/contract/src/modules/provider-entities/contract.ts
```

Allowed:

```text
POST /provider-entities/search
POST /provider-entities/search-options
POST /provider-entities/imports
```

Import-result reads remain allowed.

These are core interactive demo operations.

## Relationships

File:

```text
packages/contract/src/modules/relationships/contract.ts
```

Allowed:

```text
POST /relationships
```

## RyotQL

File:

```text
packages/contract/src/modules/ryotql/contract.ts
```

Allowed:

```text
POST /ryotql/execute
```

This is logically a read API despite using POST.

## Saved views

File:

```text
packages/contract/src/modules/saved-views/contract.ts
```

Protect all existing mutations:

```text
POST   /saved-views
PUT    /saved-views/:viewSlug
DELETE /saved-views/:viewSlug
POST   /saved-views/:viewSlug/clone
POST   /saved-views/reorder
```

Reason: this is persistent shared application/navigation configuration; updates can hide built-in views and deletions/reorders can disturb the curated demo experience. With no reset mechanism, unrestricted creation/cloning can also create persistent shared clutter requiring administrator cleanup.

## Uploads

File:

```text
packages/contract/src/modules/uploads/contract.ts
```

Allowed:

```text
POST /uploads/intents
POST /uploads/intents/:intentId/complete
POST /uploads/downloads
```

Signed local PUT/download routes are outside ordinary `AuthMiddleware`; leave them unchanged.

## User settings

File:

```text
packages/contract/src/modules/user-settings/contract.ts
```

Protected:

```text
PATCH /user-settings/preferences
```

Allowed:

```text
POST /user-settings/avatar
```

Preferences include behavior such as integration disabling and metadata/content settings and are control-plane state.

Generating a new avatar does not affect authority or feature availability and may remain usable.

## User state

File:

```text
packages/contract/src/modules/user-state/contract.ts
```

Allowed:

```text
DELETE /user-state/clear/:entityId
POST   /user-state/merge
```

This is domain/tracking state.

## System, God Mode and test support

No demo annotations are required for public system reads.

God Mode and test-support endpoints are protected by `AdminMiddleware`, not user OAuth authority. Do not mix demo policy into admin-token authorization.

---

# 13. Plugin-operation policy

The current plugin operation path is a special case because:

```text
kernel/backend/src/modules/plugins/operations-service.ts
```

manually authenticates the request and currently calls an auth helper that discards authorization provenance.

Fix that architecture.

## 13.1 Manifest model

Modify:

```text
packages/contract/src/modules/plugins/manifest.ts
```

For operations with:

```text
auth: "user"
```

require:

```ts
demoAccess: "allowed" | "protected";
```

Prefer a discriminated union so `demoAccess` is required for user-authenticated operations and not meaningless for `auth: "integration"` operations.

This makes every first-party user operation explicit.

## 13.2 Existing system plugin classifications

Update:

```text
plugins/media/host/plugin.ts
```

Classify:

```text
media-monitoring-status   -> allowed
media-monitoring-enable   -> protected
media-monitoring-disable  -> protected
resolve-episodes          -> allowed
```

`metadata-lookup` uses `auth: "integration"` and is unaffected.

Update:

```text
plugins/fixture/host/plugin.ts
```

Classify:

```text
greet -> allowed
```

`plugins/fitness` currently declares no operations.

## 13.3 Runtime enforcement

In:

```text
kernel/backend/src/modules/plugins/operations-service.ts
```

authenticate through the new full credential resolver so both user and authorization context are available.

For `auth: "user"`:

```text
standard credential:
    existing behavior

demo credential + system-scope plugin + demoAccess=allowed:
    execute

demo credential + system-scope plugin + demoAccess=protected:
    DemoOperationProtected

demo credential + private/user-scope plugin:
    DemoOperationProtected regardless of its manifest
```

A user-installed/private plugin is not trusted to grant itself demo authority.

For `auth: "integration"`:

- preserve existing integration authentication;
- do not inject user-demo policy.

Add `DemoOperationProtected` to the declared error list for the plugin invocation contract.

Update the client plugin-operation failure classifier so the typed 403 is recognized as a declared operation failure rather than a transport error.

---

# 14. `/demo` client route

Add:

```text
kernel/client/src/routes/demo.tsx
```

No demo button is added to:

```text
kernel/client/src/routes/auth.tsx
kernel/client/src/routes/oauth.login.tsx
```

The `/demo` route should render a simple existing `AuthStatus`-style state while processing.

## 14.1 Exact `/demo` behavior

### Step 1 — browser-only

Demo entry is web-only.

If the native application somehow navigates to `/demo`, send it through ordinary `/auth`; do not attempt `ryot-demo-web`.

### Step 2 — inspect existing application session

Call the ordinary client auth session resolver.

If a valid OAuth token set already exists:

```text
authenticated standard -> redirect to /
authenticated demo     -> redirect to /
```

Do not contact the demo sign-in endpoint.

### Step 3 — prepare hosted session

If no application OAuth session exists, call:

```text
POST /api/auth/demo/sign-in
```

through `HostedAuthService`.

Strictly decode the response.

### Step 4 — choose OAuth client

Response:

```json
{ "mode": "demo" }
```

means start OAuth using:

```text
ryot-demo-web
```

Response:

```json
{ "mode": "standard" }
```

means start ordinary web OAuth using:

```text
ryot-web
```

### Step 5 — use shared PKCE implementation

Refactor `OAuthLauncher` so normal and demo login share the same authorization construction/storage code.

Do not copy the existing PKCE implementation into the `/demo` route.

A good shape is:

```text
prepare normal authorization
prepare authorization for explicit first-party client descriptor
launch plan
```

Both paths should create the same `PendingAuthorization` structure and use the same secure state/nonce/PKCE generation.

### Step 6 — failure state

If demo is disabled, missing, disabled, or the hosted demo endpoint otherwise rejects the request, show a dedicated non-sensitive state such as:

```text
Demo unavailable

The shared demo account is not available on this server.
```

Do not expose configured IDs or account emails.

---

# 15. Client handling of protected operations

Add a shared predicate/helper for:

```text
AuthenticatedApiError
  -> DemoOperationProtected
```

Do not treat this error like `authentication-required`.

Specifically:

- do not refresh the OAuth token;
- do not clear the session;
- do not redirect to login;
- do not show a generic connectivity error when a targeted demo explanation is possible.

Add a shared UI primitive or reusable status copy for protected controls.

Canonical explanation:

```text
This operation is unavailable while using the shared demo account.
```

Restricted controls remain visible.

Do not hide features merely because the session is a demo.

---

# 16. Current client UI changes

Use `AuthSessionSnapshot.accessClass` as the proactive UI source.

The backend remains authoritative.

## 16.1 Preferences

Files:

```text
kernel/client/src/routes/_authenticated/settings/preferences.tsx
kernel/client/src/modules/settings/preferences-form.tsx
```

For demo sessions:

- keep the Preferences page visible;
- keep all server-backed preference fields visible;
- disable editing/saving;
- show the canonical demo-protection explanation;
- leave local Appearance/theme controls usable because those are device-local UI state, not server preferences.

Direct PATCH attempts still receive 403.

## 16.2 Account

Files include:

```text
kernel/client/src/routes/_authenticated/settings/account.tsx
kernel/client/src/modules/settings/account-profile.tsx
kernel/client/src/modules/settings/account-session.tsx
```

For demo sessions:

- avatar regeneration remains enabled;
- sign out remains enabled;
- server information remains visible;
- God Mode entry remains visible and unchanged because it requires a separate admin access token.

Any future account credential/security controls must consume the same access class and remain visible but disabled for demo sessions.

Do not hide God Mode specifically for demos.

## 16.3 Sidebar customization

Relevant files:

```text
kernel/client/src/routes/_authenticated/customize-sidebar.tsx
kernel/client/src/modules/navigation/customize/*
```

The current save path mutates both saved views and plugin installation state through:

```text
CustomizeSidebarService
```

For demo sessions:

- open the customization screen normally;
- show the current order/visibility;
- disable reorder/toggle mutation controls or otherwise make the draft immutable;
- keep the controls visually present;
- show the canonical explanation;
- disable Save.

Do not depend only on the client restriction. Backend saved-view/plugin-state mutations must still be protected.

## 16.4 Integrations list

Current route:

```text
kernel/client/src/routes/_authenticated/settings/integrations/index.tsx
```

The RyotQL summary list remains visible.

For demo sessions:

- keep existing integrations visible;
- disable "Connect a service";
- disable "Sync all integrations";
- show demo-protection explanation.

## 16.5 Integration detail

Current route:

```text
kernel/client/src/routes/_authenticated/settings/integrations/$integrationId.tsx
```

`GET /integrations/:integrationId` is protected because it can contain a reusable webhook URL.

For demo sessions:

- do not call the protected detail endpoint merely to produce a generic failure;
- render a deliberate restricted-detail state;
- do not expose `webhookUrl`;
- do not render editable provider settings;
- keep enough context to explain that integration configuration is protected.

The ordinary list summary remains available.

## 16.6 Notification channels

Current route:

```text
kernel/client/src/routes/_authenticated/settings/notification-channels.tsx
```

Existing list data may remain visible where it comes from redacted/read-only queries.

For demo sessions:

- disable Add;
- disable enable/disable toggles;
- disable Delete;
- disable Test;
- show explanation.

## 16.7 Backups

Current route:

```text
kernel/client/src/routes/_authenticated/settings/backups.tsx
```

Every backup API endpoint is protected.

For demo sessions:

- keep the settings/navigation entry visible;
- render a demo-protected page state directly;
- do not start the backup-list query;
- do not expose export/restore/download/delete controls as usable actions.

## 16.8 Plugin installation/configuration

Where the current UI exposes:

- plugin enable/disable;
- plugin configuration;
- plugin installation/update/removal;
- home-view selection;

keep the controls visible but disabled for demo sessions and show the shared explanation.

The backend contract remains the authoritative enforcement.

## 16.9 Media monitoring operations

For the media plugin:

```text
media-monitoring-status
```

continues to execute in demo mode.

The enable/disable controls remain visible but disabled/explained because their plugin operations are protected.

## 16.10 Client-renderer authoring

Where current UI exposes renderer authoring/publishing/deletion:

- reading existing renderer metadata may remain visible;
- create/edit/publish/delete controls are disabled for demo sessions.

## 16.11 Automations

Existing notification-rule and retry views remain visible.

Disable/explain:

- install;
- activate;
- deactivate;
- delete;
- retry.

---

# 17. Website and README

Modify the `ultra-rewrite` versions of:

```text
README.md
apps/website/app/lib/components/HeroSection.tsx
```

Both currently point to old V1 access-link URLs, and those URLs are not even identical.

Replace all public demo links with exactly:

```text
https://demo.ryot.io/demo
```

Keep the website's demo CTA as an ordinary external link.

Do not add authentication logic to `apps/website`.

Remove the README statement that demo data resets every 24 hours.

Replace it with accurate copy equivalent to:

```text
The live demo uses a shared interactive account. Changes to tracked data are visible to other demo visitors.
```

Do not promise resets or clean seed data.

---

# 18. Configuration documentation

Add `USERS_DEMO_ACCOUNT_ID` to the V2 configuration definition:

```text
kernel/backend/src/lib/infrastructure/config/definition.ts
```

Metadata should describe it as the existing user ID used by the shared interactive demo.

It is optional and not secret.

Do not expose it through the public system-config response.

Run the repository's existing generated configuration/documentation workflow as appropriate so generated config documentation remains synchronized. Do not manually duplicate configuration definitions in multiple places if they are generated from the central definition.

---

# 19. Required backend tests

Add focused unit/integration coverage for all of the following.

## Configuration and provisioning

- no `USERS_DEMO_ACCOUNT_ID` means demo disabled;
- `ryot-demo-web` is reconciled disabled;
- configured demo ID enables `ryot-demo-web`;
- existing stale demo-client DB state is reconciled correctly.

## Demo hosted session creation

- missing configured user returns unavailable;
- disabled configured user returns unavailable;
- no session creates a demo session for exactly the configured user;
- resulting session has `accessClass = demo`;
- caller cannot choose the target user;
- existing matching demo session is reused;
- stale demo session after config target change is replaced;
- existing standard session is not replaced or downgraded;
- standard response is returned for an existing standard session.

## Better Auth protection

For a demo hosted session, assert 403 for:

- API-key creation/update/deletion;
- email change;
- password change/set;
- user update/delete;
- auth-account linking/unlinking;
- 2FA configuration;
- session-management mutation;
- linked-account listing and account information;
- external access-token and refresh-token retrieval;
- active-session listing;
- API-key listing and inspection;
- TOTP provisioning-secret retrieval;
- attempts to authorize `ryot-web`;
- attempts to authorize `ryot-native`.

Assert:

- `ryot-demo-web` authorization succeeds;
- logout succeeds;
- normal login/2FA verification remains possible;
- an ordinary standard session for the same user can authorize `ryot-web`.

## Credential resolution

Assert:

```text
demo OAuth client -> demo
normal web -> standard
native -> standard
demo-user API key -> demo
other-user API key -> standard
unknown OAuth client + demo user -> demo
```

Also test normal disabled/deleted-user behavior remains unchanged.

## Application middleware

For representative endpoint policies:

```text
demo + allowed     -> handler executes
demo + protected   -> typed 403
standard + allowed -> handler executes
standard + protected -> handler executes
```

Verify the exact error:

```text
DemoOperationProtected
reason.code = demo-operation-protected
HTTP 403
```

Verify it is not surfaced as `AuthUnauthorized`.

## Sensitive integration read

Test that:

```text
GET /integrations/:id
```

is rejected for a demo credential before a webhook URL can be returned.

Standard credentials must still receive the existing redacted integration response.

## Architecture check

Add direct tests proving unclassified AuthMiddleware mutations fail the check as described earlier.

## Plugin operations

Test:

```text
demo + system operation allowed      -> executes
demo + system operation protected    -> 403
demo + private plugin user operation -> 403
standard + private operation         -> existing behavior
integration-auth operation           -> unchanged
```

---

# 20. Required client tests

## OAuth storage/token service

Test:

- `StoredTokenSet` round-trips `clientId`;
- old token sets without `clientId` are rejected/evicted rather than migrated;
- standard refresh sends `ryot-web`;
- demo refresh sends `ryot-demo-web`;
- logout/revoke uses the token's stored client ID;
- authenticated API requests no longer infer an existing token's client ID from runtime platform.

## Callback

Web callback accepts:

```text
ryot-web
ryot-demo-web
```

Web callback rejects:

```text
ryot-native
```

Native callback accepts only the correct native client and native redirect.

Tampered pending client/redirect combinations fail.

## `/demo`

Test all states:

```text
existing standard OAuth session -> redirect to app, no hosted demo call
existing demo OAuth session     -> redirect to app, no hosted demo call
no OAuth + hosted endpoint demo -> ryot-demo-web authorization
no OAuth + hosted endpoint standard -> ryot-web authorization
demo unavailable -> dedicated unavailable state
native invocation -> normal auth path, never ryot-demo-web
```

## Client session state

Test:

```text
ryot-demo-web token -> accessClass demo
normal web/native token -> accessClass standard
```

## Authenticated API error behavior

A `DemoOperationProtected` response:

- does not force-refresh the OAuth token;
- does not clear authentication;
- does not redirect to sign-in;
- remains available to the relevant UI for targeted explanation.

## UI

Add/update tests for at least:

```text
Preferences
Sidebar customization
Integrations list
Integration detail
Notification channels
Backups
Account
Plugin operation controls that currently exist
Automation protected controls that currently exist
```

Assert controls remain visible and are disabled/explained in demo mode while ordinary standard sessions retain existing behavior.

---

# 21. End-to-end acceptance scenarios

Cover these with the repository's existing integration/E2E infrastructure where possible.

## Scenario 1 — public demo entry

Instance:

```text
USERS_ALLOW_REGISTRATION=false
USERS_DEMO_ACCOUNT_ID=<seeded user>
```

Start at:

```text
/demo
```

Expected:

- no password prompt;
- configured account selected server-side;
- first-party OAuth uses `ryot-demo-web`;
- normal callback completes;
- authenticated shell opens;
- session reports demo authority.

## Scenario 2 — ordinary domain mutation works

From the demo session, exercise representative allowed operations:

- provider search;
- provider entity import;
- event/tracking mutation;
- collection mutation;
- user-state mutation.

They succeed.

## Scenario 3 — control-plane mutation is blocked

Attempt preference update.

Expected:

```text
403
demo-operation-protected
```

Client remains authenticated.

## Scenario 4 — owner maintenance

Sign out of demo.

Perform ordinary email/OIDC login for the same configured user.

Expected:

- OAuth uses `ryot-web`;
- access class is standard;
- preference update succeeds;
- feature/plugin administration behaves normally.

This scenario is essential. It proves the original problem has actually been solved.

## Scenario 5 — demo API key cannot bypass restrictions

Use an API key belonging to the configured demo user against a protected endpoint.

Expected:

```text
403 demo-operation-protected
```

## Scenario 6 — demo hosted session cannot mint normal OAuth

Create/reuse a demo Better Auth hosted session and manually initiate `ryot-web` authorization.

Expected:

```text
403
```

It cannot produce an unrestricted access token.

## Scenario 7 — sensitive external authority stays hidden

From a demo hosted session, call every protected Better Auth credential/control-plane read:

```text
/list-accounts
/get-access-token
/refresh-token
/account-info
/list-sessions
/api-key/list
/api-key/get
/two-factor/get-totp-uri
```

Expected for every route:

```text
403 DEMO_OPERATION_PROTECTED
```

The same requests under a standard hosted session reach ordinary Better Auth behavior.

## Scenario 8 — sensitive integration detail stays hidden

From a demo credential, attempt to load integration detail containing a sink webhook URL.

Expected:

```text
403
```

No webhook URL is returned.

## Scenario 9 — no reset behavior

Domain changes persist across logout/new demo sessions.

There is no reset process.

---

# 22. Implementation order

Implement in this order so intermediate refactors remain understandable.

1. Add `AccessClass`, `ryot-demo-web`, `StoredTokenSet.clientId`, and the shared contract primitives.
2. Refactor client token refresh/UserInfo/logout/API usage to derive OAuth client from the stored token set.
3. Update callback validation for the two web clients.
4. Add `USERS_DEMO_ACCOUNT_ID`.
5. Add `session.accessClass` and generate the Drizzle migration.
6. Extend OAuth provisioning with the enabled/disabled demo web client.
7. Implement the Better Auth demo-session endpoint.
8. Add Better Auth demo-session account-operation and OAuth-client guards.
9. Refactor backend credential resolution to preserve full `AuthorizationContext`.
10. Add `DemoOperationProtected` and `DemoAccessPolicy`.
11. Enforce endpoint policy in `AuthMiddleware`.
12. Annotate every current authenticated mutation according to the table in this document, plus the sensitive protected GETs.
13. Extend `architecture:check`.
14. Add plugin-operation manifest policy and refactor `OperationsService` to use full credential provenance.
15. Add `/demo` and the explicit demo OAuth launch path.
16. Expose client `accessClass` and demo-protection helpers.
17. Update all currently exposed protected UI controls.
18. Update website and README links/copy.
19. Finish unit/integration/E2E coverage.
20. Run full repository validation.

Do not leave endpoint annotations or UI protection for a later cleanup commit. Backend, client, architecture checks, and public entry link are one feature.

---

# 23. Important implementation constraints

Do not:

- port V1 `is_demo_instance`;
- add `isDemo` to the user table;
- make every credential for the demo user restricted;
- add a privileged exception based on administrator identity;
- add an admin password/query parameter to `/demo`;
- expose the demo account ID publicly;
- expose or store a demo password in configuration;
- create a second fake/demo data model;
- bypass OAuth after creating the hosted session;
- write the OAuth tokens directly from `/demo`;
- let a demo Better Auth session authorize `ryot-web`;
- infer an existing token's OAuth client from the runtime platform;
- rely on disabled UI as the security boundary;
- convert demo 403s into 401s;
- add demo reset machinery;
- add abuse-control machinery;
- add backwards-compatible handling for old client token-storage shapes.

---

# 24. Validation commands

From the repository root, finish with the normal project-wide validation:

```bash
bun run check
bun run test
bun run build
```

Generate the backend migration through the backend's existing Drizzle script rather than hand-authoring schema SQL unless the repository's generated migration workflow explicitly requires post-generation adjustment:

```bash
cd kernel/backend
bun run db:generate
```

Run focused backend/client tests during development, but the final state must pass the root checks.

Do not disable lint/type/architecture rules to make the change pass.

---

# 25. Definition of done

The feature is complete only when all of the following are simultaneously true:

- `https://demo.ryot.io/demo` is the single public demo destination used by the website and README.
- The regular Ryot login page contains no demo button.
- `/demo` can authenticate a visitor into the configured shared user without exposing a password.
- Demo login completes through the normal first-party OAuth authorization-code/PKCE flow.
- Demo OAuth tokens are durably identifiable by `ryot-demo-web`.
- Demo access uses the same full authenticated shell as an ordinary user.
- Domain/tracking/import/provider/collection operations classified as allowed work normally.
- Protected operations return typed HTTP 403 responses.
- Restricted controls remain visible and explain the restriction.
- Better Auth account/security endpoints cannot be used to escape demo restrictions.
- A demo hosted session cannot mint `ryot-web` or `ryot-native` authority.
- API keys belonging to the configured demo user cannot bypass demo restrictions.
- Plugin operations preserve credential provenance and obey explicit demo policy.
- Sensitive integration webhook authority is not exposed to demo credentials.
- An ordinary login to the exact same demo user is fully unrestricted.
- Removing `USERS_DEMO_ACCOUNT_ID` disables demo entry and disables the internal demo OAuth client.
- No reset mechanism exists.
- No demo-specific abuse-limiting subsystem has been added.
- The architecture check rejects future unclassified authenticated mutations.
- All project checks, tests, and build complete successfully.

---

# 26. Implementation outcome

Implemented on 2026-09-20.

## 26.1 Delivered behavior

- Added the shared `AccessClass` contract and durable OAuth provenance through `StoredTokenSet.clientId`.
- Added `ryot-demo-web`, including enabled/disabled provisioning reconciliation and strict web/native callback validation.
- Added `USERS_DEMO_ACCOUNT_ID`, the Better Auth `session.accessClass` field, and `POST /api/auth/demo/sign-in` with the specified hosted-session state machine.
- Enforced demo hosted-session account and credential control-plane protection, including linked accounts, external tokens, active sessions, API-key inventory, and TOTP provisioning secrets, and prevented demo sessions from authorizing normal web or native OAuth clients.
- Preserved full credential provenance through application middleware and plugin operations, including fail-closed demo-user OAuth classification and demo-user API-key classification.
- Added typed `DemoOperationProtected` responses, endpoint `DemoAccessPolicy` annotations, runtime enforcement, and a TypeScript-parser architecture check for unclassified authenticated mutations.
- Added explicit plugin-operation demo policy and enforcement for system and private plugins.
- Added the `/demo` client route, demo-aware OAuth token lifecycle, authenticated session access class, typed protected-operation handling, and deliberate restricted states for currently exposed protected controls.
- Updated the public website, README, and generated configuration documentation.
- Added focused backend, client, contract, architecture, plugin, and E2E coverage.

## 26.2 Practical deviations

- The database is greenfield, so the schema baseline was regenerated instead of retaining a second incremental migration. This was done at the maintainer's direction and does not add migration compatibility behavior.
- No new UI was invented for plugin installation/configuration, client-renderer authoring, media-monitoring mutation, or automation management controls that are not currently exposed by the V2 client. Their backend contracts and operation policies are protected, and existing exposed controls were updated.

## 26.3 Validation

The following completed successfully:

```bash
bun turbo --filter=@ryot-app/e2e test --only -- 'src/api/kernel/auth/demo-access.test.ts' 'src/api/kernel/auth/auth.test.ts' 'src/api/kernel/auth/oauth-protocol.test.ts' 'src/api/kernel/plugins/operations.test.ts' 'src/api/kernel/plugins/client-operation.test.ts' 'src/api/kernel/automations/lifecycle-triggers.test.ts' 'src/api/kernel/sandbox/durable-tracer.test.ts'
bun turbo --output-logs=full check
bun turbo --filter='!@ryot-app/e2e' --output-logs=full test
bun run build
```
