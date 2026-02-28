# Migrate the Fitness Plugin

**Parent Plan:** [Durable Sandbox - Phase 1](./README.md)

**Status:** done

## What to build

Migrate the complete bounded fitness plugin catalog: Free Exercise DB provider/preload behavior,
fitness imports, workout automations, notifications, and any manifest boot/import references. Use
the universal role definitions, durable host dispatcher, deterministic dependency/runtime rules, and
workflow-lifetime artifact model established by Tasks 02-05.

Preserve provider-scoped cache sharing between preload/details/search scripts, import parsing and
event creation, workout lifecycle behavior, and existing role input/output contracts. Delete fitness
activity definitions and obsolete manifest execution selectors after their consumers migrate. Update
fitness package tests and `tests/src/tests/plugins/fitness/` in the same task.

## Acceptance criteria

- [x] Every fitness sandbox script executes through the universal workflow runtime.
- [x] Free Exercise DB preload, details, and search preserve provider-scoped cache behavior.
- [x] Fitness import inputs/outputs use replay-safe artifacts and durable application writes.
- [x] Workout-created and notification automations preserve existing event/signal behavior.
- [x] All fitness activity definitions and obsolete execution-mode manifest fields are removed.
- [x] Role capabilities and required config keys remain no broader than current behavior requires.
- [x] Fitness plugin tests, backend focused tests, fitness import/lifecycle E2E, and package checks pass.
- [x] No fitness script relies on ambient time/randomness or detached async work.

## Completion Notes

- Converted the Hevy, Strong App, and OpenScale import adapters from activity definitions to ordinary
  script definitions with renamed catalog slugs while preserving the existing parser and artifact
  contracts.
- Preserved the temporary internal activity request shape for migrated import targets; the backend
  resolves these script targets as universal workflow children until the Task 14 hard cutover.
- Replaced Free Exercise DB cache versions and preload timestamps with persisted `execution.startedAt`
  metadata, preserving provider-scoped cache sharing without ambient time.
- Preserved the existing exercise provider capabilities, preload limits, workout-created signal, and
  notification behavior.

## Verification

- `bun turbo --filter=@ryot/fitness-plugin check`
- `bun turbo --filter=@ryot/fitness-plugin test`
- `bun turbo --filter=@ryot/app-backend check`
- `bun turbo --filter=@ryot/app-backend test`
- `bun turbo --filter=@ryot/tests test --only -- 'src/tests/plugins/fitness/exercises.test.ts'`
- `bun turbo --filter=@ryot/tests test --only -- 'src/tests/plugins/fitness/imports/imports.test.ts'`
- `bun turbo --filter=@ryot/tests test --only -- 'src/tests/plugins/fitness/workouts.test.ts'`

## User stories addressed

- User story 1
- User story 2
- User story 4
- User story 7
- User story 8
- User story 9
- User story 13
