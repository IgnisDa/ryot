# Auth Middleware And Security Schemes

**Parent Plan:** [App Backend Effect Migration](./README.md)

**Type:** AFK

**Status:** todo

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

## User stories addressed

Reference by number from the parent PRD:

- User story 12
- User story 13
- User story 20
- User story 59
