# Migrate the Fitness Plugin

**Parent Plan:** [Durable Sandbox - Phase 1](./README.md)

**Status:** todo

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

- [ ] Every fitness sandbox script executes through the universal workflow runtime.
- [ ] Free Exercise DB preload, details, and search preserve provider-scoped cache behavior.
- [ ] Fitness import inputs/outputs use replay-safe artifacts and durable application writes.
- [ ] Workout-created and notification automations preserve existing event/signal behavior.
- [ ] All fitness activity definitions and obsolete execution-mode manifest fields are removed.
- [ ] Role capabilities and required config keys remain no broader than current behavior requires.
- [ ] Fitness plugin tests, backend focused tests, fitness import/lifecycle E2E, and package checks pass.
- [ ] No fitness script relies on ambient time/randomness or detached async work.

## User stories addressed

- User story 1
- User story 2
- User story 4
- User story 7
- User story 8
- User story 9
- User story 13
