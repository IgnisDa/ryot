# Better Auth OAuth V1 Parity Plan

## Overview

Integrate OAuth into `apps/app-backend` using Better Auth, while preserving the V1 authentication behavior as closely as possible.

Implementation targets:

- Backend auth configuration and provisioning live in `apps/app-backend`.
- The new mobile/frontend rewrite lives in `apps/app-client`.
- `apps/frontend` and `apps/backend` are behavior references only.
- `apps/website` is not part of this work.

This plan intentionally keeps local auth as email/password. No two-factor authentication is included. The legacy V1 session lifetime flag `USERS_TOKEN_VALID_FOR_DAYS` is intentionally not ported.

## Goals

- Add OAuth with a single OIDC issuer, matching the V1 one-provider model.
- Preserve existing email/password auth.
- Keep the custom email sign-up route in `apps/app-backend`.
- Make first-time OAuth sign-in create the same default user data as email sign-up.
- Treat an OIDC identity and an existing email/password account with the same email as the same user.
- Drive the app-client auth screen from server config, not hardcoded assumptions.

## Non-Goals

- No changes to `apps/frontend`.
- No two-factor authentication.
- No `USERS_TOKEN_VALID_FOR_DAYS` equivalent.
- No multi-provider social login matrix.
- No legacy Rust auth table reuse.

## V1 Behavior To Preserve

| V1 behavior | Required V2 behavior |
|---|---|
| One OIDC issuer configured from env | One Better Auth OIDC provider only |
| Local auth can be enabled or disabled | Keep email/password local auth |
| Registration can be disabled | Block first-time OAuth user creation too |
| OIDC sign-in may create a new user | New OAuth users get the same bootstrap data as email sign-up |
| OIDC and local auth can coexist | Show both on the auth screen when available |
| OIDC only mode auto-launches | Auto-start OAuth in `app-client` when local auth is disabled |
| Existing user by OIDC subject is reused | Better Auth account linking must resolve to the same user |
| Session expiry is server-owned | Do not port the V1 token-days setting |
| 2FA can be part of auth flow | Not implemented now |

## Current State

### `apps/app-backend`

- `src/lib/auth/index.ts` already mounts Better Auth and disables `"/sign-up/email"`.
- `src/modules/authentication/routes.ts` owns the custom email sign-up route.
- `src/modules/authentication/bootstrap/sign-up.ts` contains the current onboarding/bootstrap work.
- `src/modules/system/routes.ts` exposes a public masked config response, but it does not yet include auth UI state.
- `src/lib/config/definition.ts` has `USERS_ALLOW_REGISTRATION`, but not `USERS_DISABLE_LOCAL_AUTH` or `FRONTEND_OIDC_BUTTON_LABEL`.

### `apps/app-client`

- `src/app/auth.tsx` is the only auth screen.
- It already supports email/password sign-up and login.
- `src/lib/atoms.ts` already uses Better Auth on the client and includes `expoClient()` on native.
- `app.config.ts` already declares the `ryot` scheme.
- No OAuth/OIDC UI exists yet.

### V1 References

- `apps/backend` shows the backend behavior: `getOidcRedirectUrl`, `getOidcToken`, `registerUser`, `loginUser`, and OIDC-user lookup.
- `apps/frontend` shows the exact V1 UX: auth page, auto-launch when local auth is disabled, OIDC button label, and the callback/login flow.

## Backend Plan

### 1. Add the missing auth config flags

Add the V1 auth env vars to `apps/app-backend/src/lib/config/definition.ts` and surface them through the parsed config:

| Env var | Purpose |
|---|---|
| `SERVER_OIDC_CLIENT_ID` | OIDC client id |
| `SERVER_OIDC_CLIENT_SECRET` | OIDC client secret |
| `SERVER_OIDC_ISSUER_URL` | OIDC issuer/discovery URL |
| `USERS_ALLOW_REGISTRATION` | Gate first-time account creation |
| `USERS_DISABLE_LOCAL_AUTH` | Hide/disable email-password auth |
| `FRONTEND_OIDC_BUTTON_LABEL` | OIDC button label shown in the client |

Do not add `USERS_TOKEN_VALID_FOR_DAYS`.

### 2. Expose auth UI state in the public config response

Extend `GET /system/config` so the response includes a derived `auth` object in addition to the masked `system` and `providers` objects.

Required fields:

| Field | Source | Used by |
|---|---|---|
| `oidcEnabled` | OIDC config validity plus discovery success | app-client auth screen |
| `signupAllowed` | `USERS_ALLOW_REGISTRATION` | app-client auth screen and first-time OIDC creation gate |
| `localAuthDisabled` | `USERS_DISABLE_LOCAL_AUTH` | app-client auth screen auto-launch/hide logic |
| `oidcButtonLabel` | `FRONTEND_OIDC_BUTTON_LABEL` | app-client button label |

The masking behavior should stay intact. The auth object is derived state, not a secret.

### 3. Configure Better Auth for one OIDC provider

Use Better Auth's generic OIDC/social support with a single provider entry derived from the V1 issuer config.

Requirements:

- One provider only.
- Provider id must be stable and shared with the client.
- The provider must be configured from `SERVER_OIDC_*` env vars.
- Discovery should come from the issuer URL.

The implementation should keep the existing `/auth/*` handler mount and the existing `disabledPaths: ["/sign-up/email"]` setting.

### 4. Make account linking resolve to the same user

Configure Better Auth account linking so that:

- An OIDC identity and an existing email/password account with the same email resolve to the same user.
- OIDC users can also sign in again later without creating duplicates.
- Existing local accounts stay valid.

If the installed Better Auth version needs explicit account-linking settings beyond the plugin config, set them in the `account` options rather than handling this in route code.

### 5. Move onboarding/bootstrap into the user-create hook flow

The current email sign-up route should stop owning bootstrap logic directly.

Instead:

- Keep the custom email sign-up route as the sign-up entrypoint.
- Keep the route thin: validate input, call `auth.api.signUpEmail`, return success or validation failure.
- Move the bootstrap work into a Better Auth user-creation hook flow so it runs for every new user, including first-time OAuth users.

The bootstrap work is the same work currently performed in `signUpAndInitializeUser()`:

- create built-in trackers
- create tracker/entity-schema links
- create saved views
- create the library entity

Because `user.preferences` is required in the app-backend schema, the hook flow must also guarantee that new users receive the default preference payload.

The hook flow should be idempotent enough that a repeated auth callback does not duplicate bootstrap data.

### 6. Preserve registration gating

`USERS_ALLOW_REGISTRATION` must apply to both signup paths:

- email/password sign-up
- first-time OAuth user creation

If registration is disabled and the OIDC account does not already exist, the login should fail in the same way the V1 flow rejects a fresh registration.

### 7. Keep the existing auth route wiring

No new auth mount path is needed in the backend. The current `auth.handler` wiring should remain the integration point for Better Auth endpoints.

### 8. Do not port the V1 session-length knob

`USERS_TOKEN_VALID_FOR_DAYS` is intentionally out of scope.

If session expiry needs an explicit value, configure it in Better Auth session settings as an implementation detail, but do not expose the V1 knob or UI for it.

## App Client Plan

### 1. Keep local auth as email/password

`apps/app-client/src/app/auth.tsx` should keep the existing email/password login and sign-up behavior.

The current sign-up path should continue to call the custom `POST /authentication/email` endpoint so the backend bootstrap flow remains the single source of truth.

### 2. Read auth state from server config

The auth screen should fetch the public config from the selected server and use the `auth` object to decide what to render.

Required UI behavior:

| State | UI behavior |
|---|---|
| `localAuthDisabled = false`, `oidcEnabled = false` | Show email/password only |
| `localAuthDisabled = false`, `oidcEnabled = true` | Show email/password plus OIDC button |
| `localAuthDisabled = true`, `oidcEnabled = true` | Auto-launch OIDC and hide the local form |
| `localAuthDisabled = true`, `oidcEnabled = false` | Show a blocking error state |

The sign-up tab/toggle should disappear when signup is disabled.

### 3. Add the OIDC sign-in action

Use the existing Better Auth Expo client in `src/lib/atoms.ts`.

The auth screen should invoke the social/OIDC sign-in action with the configured provider id and route to the app when the session is established.

Implementation notes:

- No dedicated callback screen is needed.
- The existing `scheme: "ryot"` in `app.config.ts` should be used for the deep-link return path.
- The Expo Better Auth plugin should continue handling the browser round-trip.

### 4. Auto-launch OIDC in OIDC-only mode

When `localAuthDisabled` is true and `oidcEnabled` is true, the auth screen should start the OIDC flow automatically on mount, matching V1.

Guard the auto-launch so it runs once.

### 5. Keep the success path simple

After OIDC or email/password success, route to `/(app)`.

The app already has a session-based route guard, so no custom callback route is needed.

## File-Level Change List

### `apps/app-backend`

| File | Change |
|---|---|
| `src/lib/config/definition.ts` | Add `USERS_DISABLE_LOCAL_AUTH` and `FRONTEND_OIDC_BUTTON_LABEL`; keep `USERS_ALLOW_REGISTRATION`; do not add `USERS_TOKEN_VALID_FOR_DAYS` |
| `src/lib/config/index.ts` | Parse the new auth config values |
| `src/modules/system/routes.ts` | Extend the public config response with derived auth UI state |
| `src/lib/auth/index.ts` | Add the single OIDC provider and account-linking config; keep `disabledPaths` |
| `src/modules/authentication/bootstrap/sign-up.ts` | Extract reusable bootstrap logic so it can be called from the new user-create hook flow |
| `src/modules/authentication/routes.ts` | Keep as the thin custom email sign-up route |
| `src/modules/legacyBootstrap/AGENTS.md` | Document that `USERS_TOKEN_VALID_FOR_DAYS` is intentionally not ported |

### `apps/app-client`

| File | Change |
|---|---|
| `src/app/auth.tsx` | Add OIDC button, auto-launch logic, and config-driven UI states |
| `src/lib/atoms.ts` | Likely no structural change; reuse the existing Better Auth Expo client |
| `app.config.ts` | No change expected; `scheme: "ryot"` already exists |

## Suggested Implementation Order

1. ~~Add the config/env fields in `apps/app-backend`.~~ **Done.**
2. ~~Extend `GET /system/config` with the derived auth object.~~ **Done.**
3. ~~Add the Better Auth OIDC provider and account-linking settings.~~ **Done.**
4. ~~Extract bootstrap logic out of the sign-up route and into the user-create hook flow.~~ **Done.**
5. ~~Update `apps/app-client/src/app/auth.tsx` to render/configure the new states.~~ **Done.**
6. ~~Update `apps/app-backend/src/modules/legacyBootstrap/AGENTS.md` with the session-length omission.~~ **Done.**
7. Verify the end-to-end flow manually and with tests.

## Acceptance Criteria

| Scenario | Expected result |
|---|---|
| Email/password sign-up | User is created, bootstrap runs, login succeeds |
| First OIDC login with registration allowed | User is created, bootstrap runs, login succeeds |
| First OIDC login with registration disabled | Login is rejected |
| Existing email/password user later uses OIDC with same email | Same user is reused |
| Local auth disabled and OIDC enabled | App-client auto-launches OIDC |
| Both auth methods disabled | App-client shows a blocking error state |
| OIDC enabled | App-client shows the server-configured label |
| No 2FA | Login completes without a second step |

## Notes

- `apps/frontend` remains the canonical V1 behavior reference, but it is not modified.
- The auth UI state should be derived from server config so self-hosted instances can change behavior without rebuilding the client.
- The bootstrap flow must be server-owned; the client should never duplicate onboarding logic.
