# Clean Up the Web Tracer

**Parent Plan:** [Web Client Plugin Tracer](./README.md)

**Status:** todo

## What to build

Perform the mandatory final cleanup pass after Tasks 01-08 are complete. Load and follow the repository's `codebase-cleanup` skill. Review all files changed by this plan and their directly affected modules for temporary scaffolding, dead code, duplicate contracts, speculative abstractions, stale test helpers, obsolete comments, development bypasses, and documentation drift.

Preserve the complete demonstrated behavior. This is not a redesign task and must not add features. Keep the production fixture and tests that prove the tracer. Consolidate only verified duplication, remove only code proven unused, and keep package boundaries aligned with the architecture: backend sandbox compiler, client plugin compiler, `@ryot/client-sdk`, `@ryot/client-ui-sdk`, contract/archive, server lifecycle, kernel API/data boundary, route resolver, bridge, and `PluginHost`.

`crates/**` is outside the cleanup scope and must remain entirely untouched. The legacy applications are still required as read-only references for later porting work. Do not apply general repository cleanup outside tracer-touched files and directly affected modules.

## Acceptance criteria

- [ ] The `codebase-cleanup` skill is loaded and followed for this pass.
- [ ] Every file changed by Tasks 01-08 and each directly affected module is reviewed for verified cleanup opportunities.
- [ ] No file under `crates/**` is modified, moved, renamed, or deleted.
- [ ] Authentication has no hardcoded user, bypass route, fixture credential, or temporary session injection in application code.
- [ ] The kernel has no Expo, React Native, NativeWind, legacy-router, or migration adapter left from tracer implementation.
- [ ] The client compiler and sandbox compiler retain distinct policies and APIs; only proven shared utilities remain shared.
- [ ] No hardcoded fixture catalog row, static fixture UI import, alternate artifact loader, test-only bridge runtime, or mutable artifact path remains.
- [ ] Bridge listeners, ports, pending-call registries, iframe lifecycle state, and catalog subscriptions have clear ownership and teardown.
- [ ] Exact markers, including bridge protocol V2, remain simple equality checks without compatibility ranges, fallback protocols, or unused negotiation abstractions.
- [ ] Kernel and plugin consumers use the explicit Task 05-followup `RyotClient` adapters; no global mutable client, parallel capability facade, direct catalog transport, or bridge-specific component API remains.
- [ ] No `@ryot/client-plugin-sdk` package, import, compatibility alias, generated residue, or stale documentation remains.
- [ ] Package exports, workspace references, task-specific documentation, architecture decisions resolved during implementation, and public API names match the final code.
- [ ] Formatting, linting, type checks, focused package tests, backend tests, kernel tests, browser tracer tests, and production builds all pass.
- [ ] Manual verification proves onboarding, authentication, fixture home, private navigation, authenticated operation, theme synchronization, crash recovery, and forced update reload through one production path.

## User stories addressed

- User story 1
- User story 2
- User story 3
- User story 4
- User story 5
- User story 6
- User story 7
- User story 8
- User story 9

## Implementor Notes

The cleanup task is mandatory and must not be skipped or merged into an earlier task. Record any deferred work as explicit later-plan scope rather than leaving TODOs, dead flags, or speculative compatibility hooks in the tracer.
