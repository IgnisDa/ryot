# Authenticate Into the Kernel Shell

**Parent Plan:** [Web Client Plugin Tracer](./README.md)

**Status:** done

## What to build

Complete the real browser authentication path on top of Task 01. Read the selected server's public system configuration and expose the authentication methods it enables. Port the existing Better Auth behavior into DOM forms: email registration and sign-in, configured OIDC sign-in, TOTP and backup-code verification, sign-out, session restoration, and changing servers.

Add an authenticated TanStack Router gate and a minimal kernel shell destination. Unauthenticated access to protected routes must preserve a safe local destination and redirect through onboarding or auth as required. An authenticated visit to `/auth` must return to that destination or the kernel root. Changing servers signs out where possible, clears Better Auth storage and the selected origin, and returns to onboarding.

Create the single authenticated API boundary used by all later tracer tasks. It must attach browser credentials and key reactive/cache identity by normalized server URL and authenticated user ID through `ApiScope`. Credentials, cookies, access tokens, and two-factor values must never enter atom keys, persistence keys, URLs, logs, or bridge-visible state.

Use the semantic DOM tokens and controls established in Task 01. Extend those controls only where the authentication forms require it. Use TanStack Form for submitted forms and preserve Enter submission, focus movement, stable validation, loading, and server-error behavior.

## Acceptance criteria

- [x] Authentication methods are derived from the selected server's public configuration rather than hardcoded UI assumptions.
- [x] Email registration and sign-in work when enabled, including stable validation and server failure presentation.
- [x] OIDC sign-in works when configured and returns only to a validated in-app destination.
- [x] Two-factor redirects support configured TOTP and backup-code verification without persisting secret values.
- [x] Reloading the browser restores a valid Better Auth session and enters the protected kernel shell without a hardcoded user or test-only application path.
- [x] Missing or expired sessions redirect protected routes to `/auth` while retaining a safe local destination.
- [x] A connected authenticated visit to `/auth` redirects to the retained destination or kernel root.
- [x] Changing servers signs out where possible, clears auth storage and server selection, and returns to onboarding without clearing unrelated Ryot state.
- [x] Authenticated transport uses browser credentials and one `ApiScope` keyed by normalized server URL and user ID; no feature-owned authenticated client is introduced.
- [x] Sign-out clears the session and returns to the auth gate.
- [x] Auth and onboarding forms are keyboard-operable, screen-reader-labelled, responsive, and visually consistent with the kernel design system.
- [x] Focused state/component tests and backend-facing integration tests cover sign-up/sign-in, session gates, redirect safety, two-factor branching, OIDC branching, server changes, and scope partitioning; kernel checks, tests, and build pass.

## User stories addressed

- User story 2

## Implementor Notes

Application code must exercise the production Better Auth and authenticated transport path. Test setup may create users or sessions through established backend test helpers, but it must not introduce an authentication bypass in the client.

## Implementation Notes

- Added Effect services for the normalized Better Auth browser client, public authentication configuration, authentication workflows, and credentialed contract transport. Live implementations are composed once in the shared client runtime, and the credential-free `ApiScope` remains keyed by normalized server URL and user ID.
- Built the DOM authentication UI with TanStack Form: email registration and sign-in, configured OIDC, TOTP and backup-code verification, session restoration into the protected kernel shell, safe redirect intent, sign-out, and server change.
- Derived every offered method from the selected server's `/system/config` response rather than hardcoded UI assumptions, and kept credentials, cookies, tokens, and two-factor values out of atom keys, persistence keys, URLs, and logs.
- Added a jsdom Vitest environment, deterministic Effect service layers, and focused component tests that use plain recording callbacks. Coverage includes workflow cleanup, mode switching, Enter-key focus movement, credential normalization, validation gating, server-error presentation, disabled state, two-factor method branching, code trimming, and reset-on-failure without test-framework mocks.
- API-facing coverage for sign-up, sign-in, two-factor branching, and OIDC already exists in `e2e/src/api/kernel/auth/auth.test.ts`, `2fa.test.ts`, and `oidc.test.ts`; no new end-to-end suite was added because this slice changed no API or contract behavior.
- Verified with `bun turbo --filter=@ryot/kernel-client check`, `bun turbo --filter=@ryot/kernel-client test`, and `bun turbo --filter=@ryot/kernel-client build`.
