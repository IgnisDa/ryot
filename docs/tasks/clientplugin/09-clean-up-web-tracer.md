# Clean Up the Web Tracer

**Parent Plan:** [Web Client Plugin Tracer](./README.md)

**Status:** todo

## What to build

Perform the mandatory final cleanup pass after Tasks 01-08 are complete. Load and follow the repository's `codebase-cleanup` skill. Review all files changed by this plan and their directly affected modules for temporary scaffolding, dead code, duplicate contracts, speculative abstractions, stale test helpers, obsolete comments, development bypasses, and documentation drift.

Audit the final SDK taxonomy and all public names: `ryot.data.query(recipe)`, `ryot.operations.invoke({ slug, input, output })`, and `ryot.navigation.push/replace`. Remove stale pre-taxonomy operation or navigation names and any parallel client, capability, routing, reload, or lifecycle facades. Keep `PluginLink` and the reactive location, params, and search hooks as plugin React conveniences backed by the same client/runtime.

Preserve the complete demonstrated behavior. This is not a redesign task and must not add features. Keep the production fixture and tests that prove the tracer. Consolidate only verified duplication, remove only code proven unused, and keep package boundaries aligned with the architecture: backend sandbox compiler, client plugin compiler, `@ryot/client-sdk`, `@ryot/client-ui-sdk`, contract/archive, server lifecycle, kernel API/data boundary, route resolver, bridge, and `PluginHost`.

Audit every value crossing the SDK and bridge boundaries against the canonical `JsonValue` type/schema and `isJsonValue` guard from `@ryot/contract/schema/json`. Remove `Schema.Unknown`, ad hoc validators, unchecked casts, and `JSON.stringify` normalization; unsupported values must be rejected, not converted.

The cleanup must preserve and enforce the one per-session client plugin runtime: one `MessagePort`, lifecycle state, dispatcher, location/theme state, query/operation pending calls, listeners, `RyotClient`, and idempotent disposal. Tasks 06-08 must reuse this runtime lifecycle for theme updates, crash recovery, artifact reload, and unmount. Review the shared schemas and exact public `RyotClientError` contract as part of this pass; expected business/domain outcomes remain typed values, and no theme-, crash-, reload-, or capability-specific error union may duplicate it. Remove any separate theme, crash, reload, capability, or teardown bridge that duplicates it.

`crates/**` is outside the cleanup scope and must remain entirely untouched. The legacy applications are still required as read-only references for later porting work. Do not apply general repository cleanup outside tracer-touched files and directly affected modules.

## Acceptance criteria

- [ ] The `codebase-cleanup` skill is loaded and followed for this pass.
- [ ] Every file changed by Tasks 01-08 and each directly affected module is reviewed for verified cleanup opportunities.
- [ ] No file under `crates/**` is modified, moved, renamed, or deleted.
- [ ] Authentication has no hardcoded user, bypass route, fixture credential, or temporary session injection in application code.
- [ ] The kernel has no Expo, React Native, NativeWind, legacy-router, or migration adapter left from tracer implementation.
- [ ] The client compiler and sandbox compiler retain distinct policies and APIs; only proven shared utilities remain shared.
- [ ] No hardcoded fixture catalog row, static fixture UI import, alternate artifact loader, test-only bridge runtime, mutable artifact path, or inline artifact payload on the active plugin row remains.
- [ ] Bootstrap validates metadata before accepting one port and owns the bootstrap listener and React root/unmount coordinator; the runtime owns one session listener/dispatcher, location/theme state, pending calls, client, and idempotent disposal, while `PluginHost` owns the iframe and kernel session handle.
- [ ] Bridge listeners, ports, pending-call registries, iframe lifecycle state, and catalog subscriptions have clear ownership and teardown; pending query and operation calls reject exactly once before port/iframe release.
- [ ] Exact markers, including protocol version 1, remain simple equality checks.
- [ ] Every bridge value uses a strict contract or a domain schema built on the canonical JSON boundary; operation input is required with explicit `null` for no input, invalid SDK input is `invalid-input`, and non-JSON operation output becomes `malformed-result` before bridge delivery.
- [ ] `RyotClientError.reason` has exactly the eight public reasons and fixed classifications from the parent plan; expected business/domain outcomes are typed successful values, `query-failed` and `operation-failed` are opaque declared backend/platform execution failures, and no theme-, crash-, reload-, or capability-specific error union exists.
- [ ] `lifecycle-close` remains the payload-free `{ type: "lifecycle-close", reason: "disposed" | "failed" }` message; wire `failed` maps to public `protocol` and is not a public SDK error reason, with no stack, error, request, or diagnostic expansion.
- [ ] Kernel and plugin consumers use the explicit Task 05-followup `RyotClient` adapters; no global mutable client, parallel capability facade, direct catalog transport, or bridge-specific component API remains.
- [ ] Kernel and plugin consumers use the canonical `data`, `operations`, and `navigation` client categories; no stale operation/navigation names or parallel routing, reload, lifecycle, or capability facades remain. `PluginLink` and the reactive location, params, and search hooks remain only as plugin React conveniences on the shared runtime.
- [ ] Kernel abort remains best effort and is not documented or implemented as rollback for work that committed before abort.
- [ ] No `@ryot/client-plugin-sdk` package, import, generated residue, or stale documentation remains.
- [ ] Package exports, workspace references, task-specific documentation, architecture decisions resolved during implementation, and public API names match the final code.
- [ ] Formatting, linting, type checks, focused package tests, backend tests, kernel tests, browser tracer tests, and production builds all pass, including exact operation-error classification and shared pending-call/teardown coverage.
- [ ] Manual verification proves onboarding, authentication, fixture home, private navigation, authenticated operation, theme synchronization, crash recovery, and forced update reload through one production path and one reused runtime lifecycle.

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

The cleanup task is mandatory and must not be skipped or merged into an earlier task. Record any deferred work as explicit later-plan scope rather than leaving TODOs, dead flags, or speculative hooks in the tracer.
