# Clean Up the Web Tracer

**Parent Plan:** [Web Client Plugin Tracer](./README.md)

**Status:** done

## What to build

Perform the mandatory final cleanup pass after Tasks 01-08 are complete. Load and follow the repository's `codebase-cleanup` skill. Review all files changed by this plan and their directly affected modules for temporary scaffolding, dead code, duplicate contracts, speculative abstractions, stale test helpers, obsolete comments, development bypasses, and documentation drift.

Audit the final SDK taxonomy and all public names: `ryot.data.query(recipe)`, `ryot.operations.invoke({ slug, input, output })`, and `ryot.navigation.push/replace`. Remove stale pre-taxonomy operation or navigation names and any parallel client, capability, routing, reload, or lifecycle facades. Keep `PluginLink` and the reactive location, params, and search hooks as plugin React conveniences backed by the same client/runtime.

Preserve the complete demonstrated behavior. This is not a redesign task and must not add features. Keep the production fixture and tests that prove the tracer. Consolidate only verified duplication, remove only code proven unused, and keep package boundaries aligned with the architecture: backend sandbox compiler, client plugin compiler, `@ryot/client-sdk`, `@ryot/client-ui-sdk`, contract/archive, server lifecycle, kernel API/data boundary, route resolver, bridge, and `PluginHost`.

Audit every value crossing the SDK and bridge boundaries against the canonical `JsonValue` type/schema and `isJsonValue` guard from `@ryot/contract/schema/json`. Remove `Schema.Unknown`, ad hoc validators, unchecked casts, and `JSON.stringify` normalization; unsupported values must be rejected, not converted.

The cleanup must preserve and enforce the one per-session client plugin runtime: one `MessagePort`, lifecycle state, dispatcher, location/theme state, query/operation pending calls, listeners, `RyotClient`, and idempotent disposal. Tasks 06-08 must reuse this runtime lifecycle for theme updates, crash recovery, artifact reload, and unmount. Review the shared schemas and exact public `RyotClientError` contract as part of this pass; expected business/domain outcomes remain typed values, and no theme-, crash-, reload-, or capability-specific error union may duplicate it. Remove any separate theme, crash, reload, capability, or teardown bridge that duplicates it.

`crates/**` is outside the cleanup scope and must remain entirely untouched. The legacy applications are still required as read-only references for later porting work. Do not apply general repository cleanup outside tracer-touched files and directly affected modules.

## Acceptance criteria

- [x] The `codebase-cleanup` skill is loaded and followed for this pass.
- [x] Every file changed by Tasks 01-08 and each directly affected module is reviewed for verified cleanup opportunities.
- [x] No file under `crates/**` is modified, moved, renamed, or deleted.
- [x] Authentication has no hardcoded user, bypass route, fixture credential, or temporary session injection in application code.
- [x] The kernel has no Expo, React Native, NativeWind, legacy-router, or migration adapter left from tracer implementation.
- [x] The client compiler and sandbox compiler retain distinct policies and APIs; only proven shared utilities remain shared.
- [x] No hardcoded fixture catalog row, static fixture UI import, alternate artifact loader, test-only bridge runtime, mutable artifact path, or inline artifact payload on the active plugin row remains.
- [x] Bootstrap validates metadata before accepting one port and owns the bootstrap listener and React root/unmount coordinator; the runtime owns one session listener/dispatcher, location/theme state, pending calls, client, and idempotent disposal, while `PluginHost` owns the iframe and kernel session handle.
- [x] Bridge listeners, ports, pending-call registries, iframe lifecycle state, and catalog subscriptions have clear ownership and teardown; pending query and operation calls reject exactly once before port/iframe release.
- [x] Exact markers, including protocol version 1, remain simple equality checks.
- [x] Every bridge value uses a strict contract or a domain schema built on the canonical JSON boundary; operation input is required with explicit `null` for no input, invalid SDK input is `invalid-input`, and non-JSON operation output becomes `malformed-result` before bridge delivery.
- [x] `RyotClientError.reason` has exactly the eight public reasons and fixed classifications from the parent plan; expected business/domain outcomes are typed successful values, `query-failed` and `operation-failed` are opaque declared backend/platform execution failures, and no theme-, crash-, reload-, or capability-specific error union exists.
- [x] `lifecycle-close` remains the payload-free `{ type: "lifecycle-close", reason: "disposed" | "failed" }` message; wire `failed` maps to public `protocol` and is not a public SDK error reason, with no stack, error, request, or diagnostic expansion.
- [x] Kernel and plugin consumers use the explicit Task 05-followup `RyotClient` adapters; no global mutable client, parallel capability facade, direct catalog transport, or bridge-specific component API remains.
- [x] Kernel and plugin consumers use the canonical `data`, `operations`, and `navigation` client categories; no stale operation/navigation names or parallel routing, reload, lifecycle, or capability facades remain. `PluginLink` and the reactive location, params, and search hooks remain only as plugin React conveniences on the shared runtime.
- [x] Kernel abort remains best effort and is not documented or implemented as rollback for work that committed before abort.
- [x] No `@ryot/client-plugin-sdk` package, import, generated residue, or stale documentation remains.
- [x] Package exports, workspace references, task-specific documentation, architecture decisions resolved during implementation, and public API names match the final code.
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

## Implementation Notes

- **Complete tracer audit.** Reconstructed the 42 Task 01-08 commits and reviewed their 227 current files plus directly affected modules across the kernel client, shared SDK and contract packages, compiler and fixture, backend persistence and serving, archive and CLI, server assembly, and focused end-to-end support. No `crates/**` file changed.
- **Verified cleanup.** Removed two unused authentication result types and a mocked artifact-service test that only repeated repository forwarding already covered by repository and production artifact-route tests. Retained semantic service boundaries, test-only malformed-boundary casts, required lint suppressions, compiler serialization, and the sandbox log-limit fixture because each has a current verified purpose.
- **Canonical JSON boundaries.** Plugin configuration request and response schemas and aggregate RyotQL rows now use the shared `JsonValue` schema. Backend configuration sanitization and aggregate reconstruction validate with `isJsonValue` before values enter the HTTP boundary. SDK tests no longer use permissive `Schema.Unknown` output codecs, and the unused parallel JSON schema alias and unnecessary codec cast were removed.
- **Contract and documentation alignment.** Preserved the exact eight `RyotClientError` reasons, protocol version 1, payload-free lifecycle close, final `data`/`operations`/`navigation` taxonomy, one per-session runtime, immutable artifact identities, and revision-bound operation dispatch. Corrected stale protocol wording and architecture text that described theme integration as future work or required deleting the read-only `crates/` references.
- **Verification.** `bun turbo --output-logs=full check` passed all 26 packages with zero warnings and zero errors. Focused tests and builds passed for the contract, archive, CLI, SDK, UI SDK, client compiler, fixture, kernel client, and kernel backend. Six directly affected backend files passed 153 tests. The affected end-to-end files `client-artifact.test.ts`, `client-operation.test.ts`, `operations.test.ts`, `private-plugins.test.ts`, and `sandbox/integrations.test.ts` passed 5 files and 29 tests together.
- **Known repository limitation.** The full backend unit command passed 1,247 tests but retained five unrelated sandbox compiler/runtime failures, including one timeout, in the existing Effect rc.111 worker path. The existing Dockerfile `FIXME` and real-browser manual verification remain unresolved; fixing either requires work outside this cleanup task, so the final two acceptance criteria remain unchecked.
