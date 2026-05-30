# Query Engine Execute

**Parent Plan:** [App Backend Effect Migration](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Migrate query-engine execution for entity, event, aggregate, and time-series modes using the migrated query-language schemas and real database schema. The query engine should validate references, prepare query context, execute SQL safely, and return direct typed results compatible with tests and app-client migration.

This slice completes the saved-views/query-engine cycle by making dynamic query execution work in the new backend.

## Acceptance criteria

- [ ] Authenticated users can execute valid query-engine requests
- [ ] Entity mode queries return typed field values and pagination data
- [ ] Events mode, aggregate mode, and time-series mode behavior is migrated
- [ ] Invalid query references fail with typed validation/not-found errors
- [ ] Query-engine E2E suites pass through the Effect client
- [ ] App-client query consumers have direct typed responses available for later migration

## User stories addressed

Reference by number from the parent PRD:

- User story 40
- User story 47
- User story 59
- User story 60
