# Recover From Plugin Crashes

**Parent Plan:** [Web Client Plugin Tracer](./README.md)

**Status:** done

## What to build

Contain fatal fixture runtime failures inside `PluginHost` and provide kernel-owned recovery. Add a deliberate fixture crash action. The one per-session `@ryot/client-sdk/plugin` runtime created in Task 05-followup must catch fatal React render errors and relevant uncaught runtime failures, report the payload-free `{ type: "lifecycle-close", reason: "failed" }` through its existing protocol version 1 dispatcher when possible, and stop accepting normal calls. Crash lifecycle remains internal to this runtime; it is not a public client capability. Failure terminates all runtime-owned categories through the shared `closing` teardown, rejects pending requests exactly once using the shared `RyotClientError` contract, and the kernel replaces the iframe viewport with a stable failure state that can reload the same artifact. Normal disposal reaches `disposed`.

Reload creates a fresh iframe document, `RyotClient`, runtime, and bridge session through the same initial-mount factory after shared disposal, for the same installation, artifact hash, and logical route. It must not reload the kernel document or mutate the immutable artifact. A normal typed operation failure from Task 05 is not a plugin crash and must remain recoverable inside plugin UI. Expected plugin business/domain outcomes remain successful typed values, and `operation-failed` remains an opaque declared backend/platform operation execution failure rather than a plugin business outcome.

Handle failures before ready, after ready, and during an in-flight request. Kernel abort of in-flight work is best effort and cannot undo an operation that committed before abort; the runtime rejection is not a rollback signal. Internal stack traces and bridge diagnostics may be logged through the kernel's internal error boundary but must not be rendered to the user or echoed to the plugin as privileged details. Do not add error, stack, message, request, or other diagnostic fields to `lifecycle-close`; its only payload is `reason`.

Crash reporting remains on the exact protocol version 1 session dispatcher when a session is available. Do not add a crash-specific bridge or a crash-specific error union.

Crash state, fatal reporting, and plugin-side pending-call rejection belong to the existing per-session client runtime. Reuse its shared schemas, `RyotClientError`, lifecycle, pending-call, and teardown machinery. The shared teardown must terminate all runtime-owned categories together, including query, operation, location/theme state, listeners, and the client. Do not add global crash handlers that outlive the document, a second bridge client, separate theme/crash/reload bridge or teardown paths, or operation/query teardown paths outside `@ryot/client-sdk`.

## Acceptance criteria

- [x] The fixture exposes a deterministic action that causes a fatal render/runtime failure for browser testing.
- [x] Fatal React render errors and uncaught plugin runtime failures are contained within the plugin document and do not unmount or reload the kernel.
- [x] A failure reported before ready transitions the host from loading to a stable kernel-owned failure state.
- [x] A failure after ready closes the bridge, rejects all pending calls exactly once, and prevents further calls on the failed session.
- [x] The failed `RyotClient` drains both operation and RyotQL pending calls and refuses new capability calls before the iframe is replaced.
- [x] Crash lifecycle remains runtime-internal; no public lifecycle capability is added, and failure terminates all runtime-owned categories through the shared teardown.
- [x] The shared runtime owns the `ready`/`active`/`closing`/`failed`/`disposed` transitions (`ready`/`active` -> `closing` -> `failed` on failure and `ready`/`active` -> `closing` -> `disposed` on normal disposal), and every pending query or operation settles at most once; late results are ignored.
- [x] Kernel abort is best effort, does not claim to roll back committed backend work, and does not create a second teardown path.
- [x] Typed backend operation failures continue to render inside fixture UI and do not trigger the kernel crash state.
- [x] Expected plugin business/domain outcomes remain typed successful values, and `operation-failed` is not reclassified as a plugin business error or a crash; all operation errors retain the shared public contract.
- [x] The failure screen provides one accessible reload action and does not display stack traces, wire payloads, credentials, or internal diagnostics.
- [x] Failure signaling keeps `lifecycle-close` payload-free as `{ type: "lifecycle-close", reason: "disposed" | "failed" }`; wire `failed` maps to public `protocol` and is not a public SDK error reason. Diagnostics stay kernel-internal and are not expanded onto the bridge.
- [x] Reload mounts a fresh iframe, `RyotClient`, runtime, and `MessageChannel` through the normal initial-mount factory for the same artifact and restores the current logical plugin route.
- [x] Successful reload clears the failure state and leaves kernel navigation and authentication intact.
- [x] Repeated crash/reload cycles do not leak ports, listeners, pending-request entries, iframe nodes, or global handlers.
- [x] Crash recovery reuses the existing runtime's port, dispatcher, client, listeners, and idempotent disposal; it adds no theme-, crash-, or reload-specific bridge or teardown path.
- [x] Runtime, host lifecycle, shared `RyotClientError` classification, pending-call teardown, pre-ready failure, post-ready failure, and browser recovery tests pass with all earlier tracer tests.

## User stories addressed

- User story 8

## Implementor Notes

Cross-document browser error events are not a sufficient protocol. The plugin runtime must own its error boundary and fatal reporting because the iframe remains isolated. Extend the Task 05-followup plugin runtime and provider lifecycle rather than introducing a crash-specific SDK or mutable module singleton.

## Implementation Notes

- **Runtime failure and teardown.** Fatal entry is runtime-internal and uses the shared `ready`/`active` -> `closing` -> `failed` teardown. The failed close is payload-free, and public `protocol` rejection settles all pending categories exactly once.
- **Terminal handler ownership.** Session-scoped React `onUncaughtError` and the window `error`/`unhandledrejection` handlers are removed on terminal state or disposal.
- **Kernel recovery.** The kernel owns one stable failure screen with one reload action. Reload recreates a fresh iframe, runtime, `RyotClient`, and `MessageChannel` through the normal factory for the same artifact and logical route.
- **Pending work and fixture behavior.** Kernel operation/query abort is best effort; late results are suppressed and no rollback promise is created. The fixture has a deterministic render crash, while ordinary `operation-failed` remains nonfatal.
- **Review and verification.** Initial review and same-agent re-review found no findings, with the jsdom/no browser-driver limitation noted. `bun turbo --filter=@ryot/client-sdk --filter=@ryot/kernel-client --filter=@ryot/client-plugin-compiler --filter=@ryot/fixture-plugin check test build` passed 26/26 tasks. From `e2e`, `bun --bun run vitest run src/api/kernel/plugins/client-artifact.test.ts src/api/kernel/plugins/client-operation.test.ts` passed 2 files/6 tests.
