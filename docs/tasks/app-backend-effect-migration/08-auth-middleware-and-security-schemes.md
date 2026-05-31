# Auth Middleware And Security Schemes

**Parent Plan:** [App Backend Effect Migration](./README.md)

**Type:** AFK

**Status:** done

## What to build

Implement Effect HTTP middleware for authenticated user routes and admin routes. Cookie sessions and API keys should resolve to the current user. Admin-only routes should preserve the existing admin token header behavior. Stubbed authenticated/admin routes should return `401` before `501` when credentials are missing or wrong.

This slice proves the security boundary of the contract before most domain handlers are implemented.

## Acceptance criteria

- [ ] Auth middleware provides the current user to authenticated route handlers
- [ ] Cookie sessions authenticate app-owned routes
- [ ] API key authentication is supported for app-owned routes
- [ ] Admin middleware preserves the existing admin token header name and validation behavior
- [ ] Missing or wrong user/admin credentials return `401` before `NotImplemented`
- [ ] Contract security annotations match the supported credential paths

## Implementation notes

### `RateLimited` is preserved in the contract

The `apiKey` plugin configures rate limiting (`RATE_LIMITED`), so the `AuthMiddleware` failure type remains `Schema.Union(Unauthorized, RateLimited)`. The `RateLimited` error is mapped to `429` at the contract boundary.

### Group-level `addError` replaces per-endpoint `Unauthorized`/`RateLimited`

Instead of repeating `.addError(Unauthorized, { status: 401 })` and `.addError(RateLimited, { status: 429 })` on every authenticated endpoint, these errors are declared once at the `HttpApiGroup` level for every group that uses `AuthMiddleware`. This is the Effect-native mechanism for shared error annotations. The `GodModeGroup` (which uses `AdminMiddleware`) gets `Unauthorized` at the group level but not `RateLimited`, because `AdminMiddleware` does not call Better Auth and therefore never produces `RateLimited`. The `SystemGroup` (unauthenticated) gets neither.

The `IntegrationsGroup` webhook endpoint inherits the group-level `Unauthorized`/`RateLimited` declarations even though it has no middleware; this is harmless over-declaration that avoids splitting the webhook into a separate contract group.

## User stories addressed

Reference by number from the parent PRD:

- User story 12
- User story 13
- User story 20
- User story 59
