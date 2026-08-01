# Durable Sandbox - Phase 1: Universal Workflow Runtime

## Tasks

**Overall Progress:** 3 of 16 tasks completed

**Current Task:** [Task 04](./04-make-artifacts-replay-safe.md) (todo)

### Task List

| #   | Task                                                                                         | Status |
| --- | -------------------------------------------------------------------------------------------- | ------ |
| 01  | [Establish Sandbox Performance Baselines](./01-establish-performance-baselines.md)           | done   |
| 02  | [Build the Universal Durable Tracer](./02-build-universal-durable-tracer.md)                 | done   |
| 03  | [Make Youtubei and Approved Dependencies Replay-Safe](./03-make-youtubei-replay-safe.md)     | done   |
| 04  | [Make Sandbox Artifacts Replay-Safe](./04-make-artifacts-replay-safe.md)                     | todo   |
| 05  | [Complete Durable Host Dispatch and Write Safety](./05-complete-durable-host-dispatch.md)    | todo   |
| 06  | [Migrate Media Imports and Named Workflows](./06-migrate-media-imports-and-workflows.md)     | todo   |
| 07  | [Migrate Media Integration Scripts](./07-migrate-media-integrations.md)                      | todo   |
| 08  | [Migrate Media Automations and Operations](./08-migrate-media-automations-and-operations.md) | todo   |
| 09  | [Migrate the Fitness Plugin](./09-migrate-fitness-plugin.md)                                 | todo   |
| 10  | [Migrate Books and Serial Media Providers](./10-migrate-books-and-serial-media-providers.md) | todo   |
| 11  | [Migrate Screen, Music, and Game Providers](./11-migrate-screen-music-game-providers.md)     | todo   |
| 12  | [Migrate Person and Company Providers](./12-migrate-person-company-providers.md)             | todo   |
| 13  | [Migrate Media-Group Providers](./13-migrate-media-group-providers.md)                       | todo   |
| 14  | [Cut Over the Universal Sandbox Runtime](./14-cut-over-universal-runtime.md)                 | todo   |
| 15  | [Close the Phase 1 Verification Gate](./15-close-phase-1-verification.md)                    | todo   |
| 16  | [Codebase Cleanup](./16-codebase-cleanup.md)                                                 | todo   |

## Authoritative Plans

Read both plan files completely before starting any task:

1. `docs/plans/durable-sandbox/00-overview.md` - the complete decision record, current/target data
   flow, storage ownership, cross-phase invariants, and verification baseline.
2. `docs/plans/durable-sandbox/01-phase-1-universal-workflow-runtime.md` - the complete Phase 1
   specification, performance guardrails, tracers, runtime protocol, dispatcher, dependency and
   artifact rules, migration order, E2E requirements, deletion list, and done criteria.

The plan files are authoritative. This README frames the work and tracks progress without restating
every technical decision. `[DECIDED]` items must not be relitigated. Follow `[RECOMMENDED]` items
unless concrete evidence requires deviation, and record that evidence in the relevant plan.
`[IMPLEMENTER-DECIDES]` choices must be resolved and recorded in the plan before their task closes.

## Problem Statement

Ryot currently has two sandbox execution models. Standard provider, automation, operation, import,
and integration scripts execute within fixed process timeouts and make immediate bridge host calls.
Explicit workflow scripts replay from the top and can durably compose only activity, sleep, and child
requests; they cannot call ordinary business host functions such as `httpCall`. Standard scripts may
be wrapped by durable workflow/queue infrastructure, but their internal host calls are not durable.

This split makes rate-limit waits, restart recovery, write safety, dependency behavior, artifacts,
and script authoring depend on which definition kind happens to execute. Phase 1 replaces it with one
model: every sandbox invocation is a replayable workflow, every mutable business host call is a
durable boundary, and no sandbox process remains alive while durable work waits.

## Solution

Build a universal role-preserving workflow runtime. Provider, automation, operation, generic script,
and named workflow definitions keep their business contracts while sharing one replayable body and
transparent typed host API. The runner records deterministic durable requests, the backend dispatches
each request through its existing service or owning workflow, and replay returns recorded successes or
typed failures without repeating completed work.

The phase also makes approved dependencies and filesystem state replay-safe, migrates every media,
fitness, and kernel script, removes the activity execution kind and standard runtime, updates E2E in
lockstep, and records performance evidence before and after migration. Durable HTTP executes
immediately in this phase; global provider rate limiting belongs exclusively to Phase 2.

## User Stories

1. As the owner, I want one universal sandbox workflow model so the runtime has one set of recovery,
   timeout, and durability semantics.
2. As a plugin author, I want role-specific definitions and normal `host.*` calls so durability does
   not require manual activity plumbing.
3. As the kernel, I want mutable reads, HTTP, queries, and child execution recorded durably so a
   restart resumes rather than repeats completed work.
4. As the kernel, I want every business write to be idempotent or deterministically owned so replay
   cannot duplicate application state.
5. As an integration author, I want external mutation delivery documented as at-least-once without
   speculative exactly-once machinery.
6. As a plugin author, I want Youtubei and every approved dependency to behave deterministically
   under replay.
7. As an importer, I want immutable inputs and generated chunks to remain valid across suspension
   and restart.
8. As a user of provider operations, I want asynchronous searches/details/imports to resume with the
   same business result after interruption.
9. As a user of automations, I want lifecycle queries and writes to preserve current behavior under
   the universal runtime.
10. As a maintainer, I want the standard runtime, activity execution kind, duplicate service paths,
    and execution-mode manifest selectors deleted.
11. As an operator, I want replay-tagged diagnostics without logs/spans becoming durable business
    state or exposing secrets.
12. As an operator, I want measured replay latency and import throughput so universal execution does
    not hide a material performance regression.
13. As a maintainer, I want backend tests and `tests/` E2E to remain the behavioral specification
    throughout migration.
14. As a maintainer, I want current documentation and a final cleanup pass so only the new mental
    model remains.

## Implementation Decisions

- Every invocation is intended to use `SandboxScriptWorkflow`; no standard fast path survives Phase
  1 unless measured evidence causes an explicit owner decision.
- Existing role definitions remain contracts. The current activity kind is retired as its consumers
  migrate; reusable boundaries become named child workflows.
- Host durability is transparent. The backend, not plugin source, selects activity, owning child
  workflow, nested sandbox child, artifact operation, or diagnostic handling.
- Success and typed failure are durable results. Pending control flow remains pending even if script
  or dependency code catches its temporary signal.
- All async work is structured and awaited. Ordinary scripts receive a replay-safe Effect surface;
  privileged Promise runtime interop is SDK-internal.
- Business writes must pass the Phase 1 ownership/idempotency audit. External HTTP mutations remain
  explicitly at-least-once.
- Authored ambient time/randomness remains rejected. Execution metadata supplies `startedAt`;
  approved dependencies receive deterministic runtime shims.
- `httpCall` retains its inline API and 10-MiB response-body limit. A workflow has a 100-MiB encoded
  durable-journal ceiling and 4-MiB terminal-output ceiling. Oversize state fails deterministically.
- Input artifacts are immutable and workflow-pinned. Output chunks are durable operations returning
  workflow-lifetime opaque handles.
- Root scripts are pinned. Nested script targets retain live-on-first-observation resolution and are
  pinned for that durable call.
- PostgreSQL workflow persistence is authoritative; Redis replay state is reconstructible.
- Credentials may exist in trusted workflow persistence but never in diagnostics or public results.

## Testing Decisions

- Task 01 records warm hermetic current-runtime baselines before semantic changes.
- Tasks update package/backend tests and affected E2E in the same slice; testing is not deferred to
  Task 15.
- Timing lives in the dedicated benchmark harness, not ordinary E2E assertions.
- Generic runtime E2E belongs under `tests/src/tests/kernel/`; plugin behavior remains in the owning
  plugin tree. Providers remain hermetic except the existing opt-in live smoke suite.
- Use `assertCompleted` and `requireCompletedSandboxValue` for asynchronous E2E jobs.
- Run affected E2E files individually. Task 15 runs the standard suite and media population
  operational gate according to `tests/README.md`.
- Every task runs the checks/tests for each package it changes. Backend code uses
  `bun turbo --filter=@ryot/app-backend check` and `bun turbo --filter=@ryot/app-backend test`.

## Out of Scope

- Provider rate-limit declarations, global Redis admission, durable rate waits, `Retry-After`,
  fairness, bursts, and adaptive quota headers; these belong to Phase 2.
- Exactly-once external HTTP mutation delivery.
- Whole-plugin version snapshotting.
- A second workflow/job framework or third-party queue/rate-limit library.
- Live-network availability as a standard test prerequisite.
- Compatibility for active users, deployed data, or historical sandbox jobs; the project is
  greenfield and has no real users.

## Task Rules

- Tasks are ordered. Do not start a migration task before its runtime prerequisites are complete.
- Each task must leave relevant checks and tests passing. Temporary Phase 1 compatibility is allowed
  only while referenced and is removed by Task 14.
- Update both the task file and this table whenever task status changes.
- Stop and ask the owner when a plan stop condition is met or a new architectural decision appears.
- The final cleanup task is mandatory and may not be skipped or merged into Task 15.
