# Property Schema Effect DSL

**Parent Plan:** [App Backend Effect Migration](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Migrate the app-owned property schema DSL and validation utilities away from legacy Zod utilities into the new backend. Preserve the persisted JSON shape where practical, but compile and validate properties through Effect Schema. This module should be pure and testable in isolation.

This slice unblocks entity schemas, event schemas, relationship schemas, entity writes, event writes, collections, saved views, query-engine validation, and imports.

## Acceptance criteria

- [ ] App-owned property schema definitions are represented without importing `@ryot/ts-utils`
- [ ] Property payloads can be validated with Effect Schema semantics
- [ ] Required fields, defaults, unknown-key policies, arrays, enums, numbers, strings, dates, datetimes, objects, and validation rules are covered
- [ ] Invalid properties fail with typed validation errors suitable for route contracts
- [ ] Focused unit tests cover core property schema parsing and validation branches
- [ ] Existing builtin schema data can use the migrated property schema representation

## User stories addressed

Reference by number from the parent PRD:

- User story 18
- User story 30
- User story 31
- User story 32
- User story 33
- User story 63
