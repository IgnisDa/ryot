# Imports One Time Runs

**Parent Plan:** [App Backend Effect Migration](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Migrate one-time import runs after entities, events, collections, uploads, sandbox, and query-relevant domain paths exist. Replace old queue state machines with Effect Workflow orchestration. Import runs should support creation, listing, retrieval, deletion, progress/failure persistence, uploaded file consumption, provider resolution, entity population, event writes, and collection membership writes according to existing product behavior.

This slice should not migrate scheduled integrations yet except where shared import pipeline primitives are needed by the next slice.

## Acceptance criteria

- [ ] Authenticated users can create one-time import runs
- [ ] Authenticated users can list, get, and delete their import runs
- [ ] Import processing uses Effect Workflow or equivalent durable Effect primitives instead of BullMQ
- [ ] Import failures and progress are persisted in typed domain records
- [ ] Import writes use canonical entity, event, relationship, and collection paths
- [ ] Import E2E tests pass through the Effect client

## User stories addressed

Reference by number from the parent PRD:

- User story 27
- User story 28
- User story 42
- User story 60
