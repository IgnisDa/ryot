# Step 1 — Crons & Boot: media-trending + exercises

**Parent Plan:** [Plugin System — Phase 3: Capability Migrations](./README.md)

**Type:** AFK

**Status:** done

## What to build

Before starting, read `docs/plans/plugin-system/00-overview.md` in full and then
`docs/plans/plugin-system/03-phase-3-capability-migrations.md` in full. Do not begin until Steps 0a
and 0b (tasks 01 and 02) are done. This slice implements plan §1 end-to-end: kernel capability first, then the
plugin scripts that consume it, then delete the native modules and re-point the suites.

Kernel capability (lands before consumers):

- Add the `crons: [{ slug, schedule, driverRef, description }]` manifest section; the schedule
  format is whatever the existing scheduler consumes and the kernel owns the tick.
- Add the `boot: [{ slug, driverRef, description }]` manifest section (no `schedule`) for
  one-time-per-server-start work: the kernel dispatches every boot entry once, non-blocking,
  immediately after plugin ingestion, and skips dispatch entirely when
  `server.disableBackgroundJobs` is set — the same flag the other schedulers honor.
- The scheduler dispatches each due cron, and the boot dispatcher dispatches each boot entry, as
  a sandbox execution of its referenced driver, fire-and-forget through the durable queue
  machinery per `apps/app-backend/AGENTS.md` durable-ownership rules; idempotency stays with the
  script.
- Add batch, coarse-atomic global-write host functions `upsertGlobalEntities(items[])` and
  `upsertGlobalRelationships(items[])` (shapes `[IMPLEMENTER-DECIDES]` — record in the plan;
  semantics fixed: coarse-atomic per item, preserve-existing matching today's trending refresh
  writes). Both are global-scope and gated to system `cron` or `boot` executions in the driver
  manifest so a future untrusted provider script cannot write global data by default. Follow the
  standing host-function rules and the existing contract pattern (Decision 8; plan standing
  rules).

Migration: rewrite `modules/media-trending` (poll providers → write trending global entities +
refresh workflow + infrequent task) as a cron-driven plugin script in `plugins/media`, and
`modules/exercises` (free-exercise-db preload) as a boot-driven plugin script in
`plugins/fitness` — it is one-time catalog seeding, not periodic work, so it must run on every
server start rather than wait for a daily schedule. Keep the trending _read_ path
query-engine-based; move any residual native read code to a saved view / recipe (or defer to
step 2's operations). Then delete both native modules and any contract surface they carry (check
`libs/contract`).

See the parent PRD "Step 1 — crons" user stories and the Implementation Decisions "Step 1"
pointer for the full spec.

## Acceptance criteria

Derived from the plan §1 done criteria and cross-phase invariants:

- [x] `crons` manifest section exists and is documented in `libs/plugin-kit`; the scheduler
      dispatches due crons as sandbox executions of the referenced driver
- [x] `boot` manifest section exists and is documented in `libs/plugin-kit`; the kernel
      dispatches every boot entry once per server start, non-blocking, and skips dispatch when
      background jobs are disabled
- [x] `upsertGlobalEntities` / `upsertGlobalRelationships` host functions exist, are batch +
      coarse-atomic with preserve-existing semantics, are gated to system `cron`/`boot`
      executions, and follow the standing rules and contract pattern
- [x] `modules/media-trending` and `modules/exercises` are deleted (with any contract surface)
- [x] Trending e2e coverage is re-pointed with assertions preserved (using the existing
      `triggerInfrequentCron` cron-trigger fixture); exercises e2e coverage relies on boot
      dispatch at backend startup rather than a manual trigger
- [x] The branch stays shippable: backend `check` + unit tests, the full e2e suite, and the
      `app-client` check all pass (cross-phase invariant 1)

## User stories addressed

- User story 5
- User story 6
- User story 7
- User story 8
- User story 9
- User story 10
- User story 37
- User story 38
- User story 39
