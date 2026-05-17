# Migrate Media Automations and Operations

**Parent Plan:** [Durable Sandbox - Phase 1](./README.md)

**Status:** todo

## What to build

Migrate media lifecycle automations, policies, generic operations, cron/boot/bootstrap scripts, and
trending behavior to universal workflow bodies. This includes the no-op/early-return and full-write
paths of `auto-complete-on-full-progress`, relationship and entity update automation, notifications,
integration policies, Radarr/Sonarr/Jellyfin pushes, media monitoring operations, metadata lookup,
and media trending.

Use transparent durable host calls for queries and writes, deterministic execution time where needed,
and owning backend workflows where the dispatcher specifies them. Preserve `Effect.all` logical
parallelism and deterministic result ordering. Update bindings, cron/operation/bootstrap manifest
references, focused tests, and media lifecycle E2E in lockstep. Do not create wrapper child workflows
solely to imitate the removed activity execution model.

## Acceptance criteria

- [ ] Every media automation, policy, operation, cron, and bootstrap body uses universal workflow
      execution.
- [ ] Auto-complete early return makes no unnecessary durable calls and remains inside the same
      universal runtime.
- [ ] Full automation branches replay query/schema reads and create business writes exactly once at
      their owning boundaries.
- [ ] Parallel durable reads preserve deterministic ordering and current business outcomes.
- [ ] Notification/signal/external-push semantics follow the completed write-host safety audit.
- [ ] Manifest cron execution-mode selectors are migrated where no remaining consumer needs them.
- [ ] Existing media lifecycle, monitoring, association, notification, and operation assertions are
      preserved in plugin/backend tests and `tests/` E2E.
- [ ] The no-host automation benchmark is rerun and material regressions are recorded for Task 15.

## User stories addressed

- User story 1
- User story 2
- User story 4
- User story 5
- User story 9
- User story 12
- User story 13
