# Integrations And Webhooks

**Parent Plan:** [App Backend Effect Migration](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Migrate integrations, scheduled runs, sink/yank provider behavior, app-owned webhook routes, and the short integration webhook path after the import runtime is available. Resolve the old imports/integrations cycle by using shared Effect services and workflow orchestration rather than a shared BullMQ import queue.

This slice should preserve public webhook paths and typed route contracts while moving provider execution into the new architecture.

## Acceptance criteria

- [ ] Authenticated users can list, create, get, patch, and delete integrations
- [ ] Authenticated users can list integration runs
- [ ] Scheduled integration reconciliation uses Effect-native scheduling/workflow primitives
- [ ] App-owned integration webhook routes process sink payloads through migrated services
- [ ] The short integration webhook path remains served outside or alongside the app-owned contract as appropriate
- [ ] Integration E2E tests pass through the Effect client or raw fetch for webhook payloads as needed

## User stories addressed

Reference by number from the parent PRD:

- User story 25
- User story 27
- User story 28
- User story 43
