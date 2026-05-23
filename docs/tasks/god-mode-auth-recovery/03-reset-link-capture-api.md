# Reset Link Capture API

**Parent Plan:** [God Mode Auth Recovery](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Add the backend reset link generation path. God-mode should ask Better Auth to create the reset token through the Better Auth password reset API, then capture the generated URL from Better Auth's `sendResetPassword` callback through Redis and return the app reset link to the caller.

This task must preserve Better Auth ownership of reset token creation and credential account creation/update. Outside legacy bootstrap, do not manually write Better Auth-managed tables. The reset operation must enforce Ryot's auth-state rules: credential and none users can get reset links, OIDC and mixed users cannot.

## Acceptance criteria

- [ ] Better Auth email/password config includes a reset callback and revokes sessions on successful password reset
- [ ] The reset callback publishes generated god-mode reset links through Redis only when a valid correlation ID is present
- [ ] God-mode reset generation subscribes before requesting a Better Auth reset and times out cleanly if no callback arrives
- [ ] The reset endpoint returns a direct app-client reset-password URL and the login email
- [ ] Reset generation is allowed for `credential` and `none` users
- [ ] Reset generation is blocked for `oidc` and `mixed` users with clear validation errors
- [ ] Reset generation is blocked when local auth is disabled
- [ ] Admin token, reset tokens, and generated links are not logged
- [ ] Backend unit tests cover reset eligibility, Redis capture success, Redis capture timeout, and missing correlation ID behavior

## User stories addressed

- User story 7
- User story 8
- User story 9
- User story 10
- User story 11
- User story 13
- User story 15
- User story 18
- User story 27
- User story 28
- User story 30
