# User Bootstrap Tracer

**Parent Plan:** [App Backend Effect Migration](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Implement the minimal complete user bootstrap path after Better Auth user creation. The final bootstrap must create default trackers, link builtin entity schemas to those trackers, create default saved views, and create the user's library entity. This task may implement the narrow repository/service operations required for bootstrap before the full modules are migrated.

This slice exists to make auth sign-up behavior useful early and to prevent every later E2E test from having to manufacture core built-in rows manually.

## Acceptance criteria

- [ ] New Better Auth users trigger bootstrap after creation
- [ ] Bootstrap creates default tracker rows for the new user
- [ ] Bootstrap links seeded builtin entity schemas to the user's builtin trackers
- [ ] Bootstrap creates default saved-view rows required by navigation and media screens
- [ ] Bootstrap creates the user's library entity using seeded builtin schemas
- [ ] Bootstrap is idempotent enough to avoid duplicate default rows on repeated execution

## User stories addressed

Reference by number from the parent PRD:

- User story 14
- User story 17
- User story 61
