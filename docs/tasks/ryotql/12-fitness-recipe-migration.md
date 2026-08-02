# Fitness Recipe Migration

**Parent Plan:** [RyotQL](./README.md)

**Status:** completed

## What to build

Rewrite all fitness-owned query recipes and production consumers directly in RyotQL. Cover exercise lists, workout lists and details, measurements, workout templates, template details, nested workout data, JSON properties, ordering, filters, and calculations currently provided through legacy documents.

Fitness-only recipes remain in the fitness plugin. Use generic table references, discriminator predicates, JSON paths, safe casts, explicit joins, includes, and correlated expressions. Do not introduce compatibility helpers or shared abstractions that exist only to mimic legacy query-engine terminology. Migrate each consumer and its focused tests as a complete unit.

Saved-view producers, persistence, validation, execution, rendering, and their legacy document removal remain the bounded scope of [Task 13](./13-saved-view-migration.md).

## Acceptance criteria

- [x] Every non-saved-view production fitness recipe builds a RyotQL document directly and uses no legacy query-engine primitive or document builder
- [x] Exercise, workout, measurement, workout-template, workout-detail, and template-detail results preserve consumed fields, filters, ordering, pagination, nesting, and null behavior
- [x] Numeric, date, boolean, text, array, object, and nested JSON properties use generic JSON paths and explicit casts where scalar behavior matters
- [x] Relationship and nested data use explicit joins or includes with the agreed multiplicity semantics
- [x] Fitness-only recipes remain in the fitness plugin rather than moving into the shared recipe package
- [x] Focused fitness recipe, import, and end-to-end tests pass against RyotQL; saved-view-definition tests remain in Task 13
- [x] Migrated production fitness paths have no imports or calls to legacy query-engine APIs; saved-view references remain in Task 13
- [ ] Non-fitness legacy consumers and the complete legacy engine remain green; full legacy verification was not part of the affected-suite run
- [x] Fitness has no separate query-behavior documentation; the migrated recipes use RyotQL directly

## User stories addressed

- User story 5
- User story 6
- User story 7
- User story 8
- User story 9
- User story 10
- User story 11
- User story 12
- User story 13
- User story 23
- User story 28
- User story 29
