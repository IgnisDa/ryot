# App Client Reset Flow

**Parent Plan:** [God Mode Auth Recovery](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Complete the self-hosted admin and end-user recovery path in app-client. The god-mode UI should call the reset link endpoint, show/copy the returned link and login email, and block invalid actions in the UI based on auth state. The public reset-password route should accept a token and call Better Auth's reset-password client operation so the user can create a V2-format password.

Keep the UI within existing app-client patterns. Do not persist the admin token. Do not expose OIDC account IDs or subjects. The reset page is public because Better Auth validates the token server-side.

## Acceptance criteria

- [ ] God-mode UI can generate a reset link for users with `credential` or `none` auth state
- [ ] God-mode UI disables or blocks reset generation for `oidc` and `mixed` auth states
- [ ] God-mode UI displays the returned reset link and login email
- [ ] God-mode UI provides a copy/share affordance for the reset link
- [ ] God-mode UI surfaces backend validation errors clearly
- [ ] Reset-password route shows an invalid-link state when the token is missing
- [ ] Reset-password route accepts and confirms a new password
- [ ] Reset-password route calls Better Auth's reset-password operation with the token
- [ ] Successful reset redirects to the auth route with a clear success state or message
- [ ] Admin token remains in memory only and is not persisted to platform storage

## User stories addressed

- User story 1
- User story 2
- User story 3
- User story 7
- User story 8
- User story 9
- User story 12
- User story 14
- User story 15
- User story 16
