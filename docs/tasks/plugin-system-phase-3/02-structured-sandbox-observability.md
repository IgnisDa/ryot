# Step 0b — Structured Sandbox Observability

**Parent Plan:** [Plugin System — Phase 3: Capability Migrations](./README.md)

**Type:** AFK

**Status:** done

## What to build

Before starting, read `docs/plans/plugin-system/00-overview.md` in full and then
`docs/plans/plugin-system/03-phase-3-capability-migrations.md` in full. Do not begin until Step 0a
(task 01) is done and the complete sandbox authoring/bridge stack is Effect-native.

This is Phase 3's second prerequisite (plan Step 0b). No domain code moves here. Add `log` and
`span` as batch-first Effect host functions following the existing host-function contract pattern
(`libs/sandbox-sdk` contract + `bridge-adapter.ts` validation + `host-functions.ts`
implementation + limits entry), threading structured output into the execution's OTLP trace and
`subscription_run`-style bookkeeping. Capability gating, bridge validation, bounded artifacts,
and focused tests must follow the same conventions as every other host function.

See the parent PRD "Step 0b — structured sandbox observability" user stories and the
Implementation Decisions "Step 0b" pointer.

## Acceptance criteria

- [x] Batch-first `log` and `span` Effect host functions exist and follow the full contract pattern
      (contract + `bridge-adapter.ts` validation + `host-functions.ts` + limits entry), and thread into the
      execution trace/bookkeeping
- [x] Focused tests cover argument validation, capability gating, OTLP trace/log emission,
      bookkeeping persistence, and observability limits
- [x] The branch stays shippable (cross-phase invariant 1):
      `bun turbo --filter=@ryot/app-backend check`, `cd apps/app-backend && bun run test`, the
      full e2e suite (`cd tests && bun run test`), and the `app-client` check all pass

Verification note: the focused sandbox e2e passed. The full e2e run was interrupted, and the
owner explicitly waived rerunning it for this task on 2026-07-24.

## User stories addressed

- User story 3
- User story 37
- User story 38
- User story 39
