# Event Create List Without Triggers

**Parent Plan:** [App Backend Effect Migration](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Migrate event creation and listing without sandbox-backed trigger execution. Events should validate entity access, event schema access, session entity access, property schema rules, timestamps, and write context. Trigger-related routes or flows may return typed unsupported/temporary behavior until workflows are migrated.

This slice should support basic event E2E coverage and unblock collections and imports that write events later.

## Acceptance criteria

- [ ] Authenticated users can create events for accessible entities and event schemas
- [ ] Authenticated users can list events for accessible entities
- [ ] Event properties validate against the selected event schema
- [ ] Session entity references are validated when supplied
- [ ] Basic event creation avoids running before/after sandbox triggers in this slice
- [ ] Basic events E2E tests pass through the Effect client

## User stories addressed

Reference by number from the parent PRD:

- User story 33
- User story 38
- User story 59
- User story 60
