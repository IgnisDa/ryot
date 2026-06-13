# Better Auth Email Sessions

**Parent Plan:** [App Backend Effect Migration](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Bridge Better Auth into the new Effect backend for email sign-up, email sign-in, session retrieval, and session cookie behavior. Better Auth routes remain delegated to Better Auth's native handler under `/api/auth/*`, outside the app-owned `HttpApi` contract.

This slice should make it possible for E2E tests to create a real authenticated user and obtain cookies against the new backend, even if most app-owned domain routes still return `NotImplemented`.

## Acceptance criteria

- [ ] `/api/auth/*` delegates to Better Auth's native handler
- [ ] Email sign-up creates a user row using the real auth schema
- [ ] Email sign-in returns usable session cookies
- [ ] Session lookup can be called from Effect auth middleware code
- [ ] Better Auth uses the migrated database and Redis storage where required
- [ ] E2E auth helpers can create a test user against the new backend

## User stories addressed

Reference by number from the parent PRD:

- User story 11
- User story 45
- User story 56
