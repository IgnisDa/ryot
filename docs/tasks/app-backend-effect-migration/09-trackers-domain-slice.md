# Trackers Domain Slice

**Parent Plan:** [App Backend Effect Migration](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Migrate the trackers module end to end through Effect contracts, routes, service, repository, access checks, and E2E coverage. This is the first normal domain slice and should replace `NotImplemented` for tracker listing, creation, update, and reorder behavior.

The migrated route responses use direct success values and typed tagged errors. Tracker behavior should support both normal authenticated API calls and the later user bootstrap path.

## Acceptance criteria

- [ ] Authenticated users can list their trackers
- [ ] Authenticated users can create custom trackers
- [ ] Authenticated users can update tracker fields including disabled state
- [ ] Authenticated users can reorder visible trackers
- [ ] Cross-user tracker access is rejected without leaking resource existence
- [ ] Tracker E2E tests use the Effect client and pass against the real server

## User stories addressed

Reference by number from the parent PRD:

- User story 29
- User story 58
- User story 59
- User story 60
