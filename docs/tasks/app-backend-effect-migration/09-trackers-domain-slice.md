# Trackers Domain Slice

**Parent Plan:** [App Backend Effect Migration](./README.md)

**Type:** AFK

**Status:** done

## What to build

Migrate the trackers module end to end through Effect contracts, routes, service, repository, access checks, and E2E coverage. This is the first normal domain slice and should replace `NotImplemented` for tracker listing, creation, update, and reorder behavior.

The migrated route responses use direct success values and typed tagged errors. Tracker behavior should support both normal authenticated API calls and the later user bootstrap path.

## Acceptance criteria

- [x] Authenticated users can list their trackers
- [x] Authenticated users can create custom trackers
- [x] Authenticated users can update tracker fields including disabled state
- [x] Authenticated users can reorder visible trackers
- [x] Cross-user tracker access is rejected without leaking resource existence
- [x] Tracker E2E tests use the Effect client and pass against the real server

## User stories addressed

Reference by number from the parent PRD:

- User story 29
- User story 58
- User story 59
- User story 60
