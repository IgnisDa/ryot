# Auto-Complete Coverage Cycles

**Parent Plan:** [V2 Importing Infrastructure](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Rewrite the built-in sandbox trigger `auto-complete-on-full-progress` to use the V1/V2 legacy episodic coverage-cycle semantics defined in the parent PRD section "Events And Triggers". The trigger remains sandbox-backed and must continue using the generic trigger infrastructure users use.

For episodic media, the trigger should walk qualifying `progress(100)` events in chronological order, collect one occurrence per required coverage key, create a whole-entity `complete` event at the event that completes a full coverage cycle, reset coverage, and continue. This must support repeated show/anime/manga/podcast completions. For missing or empty required coverage data, the trigger must not create a completion. For non-episodic media, `progress(100)` may still create a complete event every time.

If a package is used for multiset/data-structure clarity, update all package/cache locations required by the parent PRD: `apps/app-backend/package.json` if TypeScript code uses it, `apps/app-backend/src/lib/sandbox/constants.ts`, and the root `Dockerfile` Deno cache list. `mnemonist` is acceptable, but only use a dependency if it materially improves the script implementation.

## Acceptance criteria

- [ ] The auto-complete trigger uses `trigger.occurredAt` and event `occurredAt` values for chronological cycle detection and completion timestamps.
- [ ] Episodic media completion is derived by chronological coverage cycles and supports repeated cycles.
- [ ] The trigger creates complete events with `completionMode: "custom_timestamps"`, `completedOn` equal to the cycle-completing progress event `occurredAt`, `occurredAt` equal to the same value, and inherited properties such as `consumedOn`.
- [ ] Missing required coverage data for show/anime/manga/podcast exits without creating completion.
- [ ] Empty required coverage data exits without creating completion.
- [ ] Show seasons named `Specials` or `Extras` remain excluded from required coverage.
- [ ] Manga decimal chapter keys are normalized consistently so equivalent numeric values do not diverge.
- [ ] Non-episodic `progress(100)` still creates a complete event every time.
- [ ] The trigger does not query existing complete events to calculate coverage cycles.
- [ ] Sandbox script tests cover repeated episodic cycles, missing/empty coverage, non-episodic repeated completion, and inherited `occurredAt`/`consumedOn` behavior.
- [ ] If a sandbox package is added, the vendored package list and Docker cache list stay in sync.

## User stories addressed

Reference by number from the parent PRD:

- User story 8
- User story 9
- User story 25
- User story 26
