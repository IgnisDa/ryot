# Step 3a — Durable Workflow Spike

**Parent Plan:** [Plugin System — Phase 3: Capability Migrations](./README.md)

**Type:** HITL

**Status:** todo

## What to build

Before starting, read `docs/plans/plugin-system/00-overview.md` in full and then
`docs/plans/plugin-system/03-phase-3-capability-migrations.md` in full. Do not begin until Step 2
(task 03) is done. This is the **mandatory spike** the plan requires before committing to the
durable-workflow design (plan §3; overview sequencing rationale — the workflow engine is the
highest-uncertainty item in the plan).

Build a small, **throwaway** replay-deterministic script driven by a prototype `activity()` host
function, and exercise it through suspend/resume and a process restart. Its only purpose is to
surface serialization, timeout, and replay-ordering issues before the real machinery
(task 05) is built. Budget it small; the code is discarded. The deliverable is not shipping
code — it is the recorded findings plus an owner decision to commit to (or adjust) the task-05
design.

Because this slice is throwaway it is not held to the "compiles + passes gates as shippable
code" bar; it is HITL precisely because it ends in an architectural decision and owner sign-off.

Record findings directly in `docs/plans/plugin-system/03-phase-3-capability-migrations.md`
(the plans are living documents) covering at least: how activity results are serialized and
journaled, how replay ordering is keyed and validated, how timeouts and process restarts behave
mid-execution, and any consequences for the task-05 primitives (`activity`/`sleep`/`child`),
version pinning, or the determinism guard rails.

See the parent PRD "Step 3 — durable workflows" user stories (story 17 in particular) and the
Implementation Decisions "Step 3" pointer.

## Acceptance criteria

Derived from the plan §3 spike requirement:

- [ ] A throwaway replay-deterministic script driven by a prototype `activity()` exists and is
      exercised through suspend/resume and a process restart
- [ ] Serialization, timeout, and replay-ordering findings are recorded in the Phase 3 plan file
- [ ] The findings feed a concrete recommendation for the task-05 design (primitives, pinning,
      determinism guard rails)
- [ ] The owner has reviewed the findings and signed off on the design before task 05 begins
      (HITL gate)

## User stories addressed

- User story 17
