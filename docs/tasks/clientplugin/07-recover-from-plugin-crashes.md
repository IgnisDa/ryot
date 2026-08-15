# Recover From Plugin Crashes

**Parent Plan:** [Web Client Plugin Tracer](./README.md)

**Status:** todo

## What to build

Contain fatal fixture runtime failures inside `PluginHost` and provide kernel-owned recovery. Add a deliberate fixture crash action. The one per-session `@ryot/client-sdk/plugin` runtime created in Task 05-followup must catch fatal React render errors and relevant uncaught runtime failures, report the payload-free `{ type: "lifecycle-close", reason: "failed" }` through its existing V3 dispatcher when possible, and stop accepting normal calls. The runtime enters `failed` through the shared `closing` cleanup, rejects pending requests exactly once, and the kernel replaces the iframe viewport with a stable failure state that can reload the same artifact. Normal disposal reaches `disposed`.

Reload creates a fresh iframe document and bridge session for the same installation, artifact hash, and logical route. It must not reload the kernel document or mutate the immutable artifact. A normal typed operation failure from Task 05 is not a plugin crash and must remain recoverable inside plugin UI.

Handle failures before ready, after ready, and during an in-flight request. Kernel abort of in-flight work is best effort and cannot undo an operation that committed before abort; the runtime rejection is not a rollback signal. Internal stack traces and bridge diagnostics may be logged through the kernel's internal error boundary but must not be rendered to the user or echoed to the plugin as privileged details. Do not add error, stack, message, request, or other diagnostic fields to `lifecycle-close`; its only payload is `reason`.

Crash reporting remains on the exact protocol V3 session dispatcher when a session is available. Do not add V2 support, aliases, negotiation, a compatibility bridge, or a crash-specific bridge.

Crash state, fatal reporting, and plugin-side pending-call rejection belong to the existing per-session client runtime. Do not add global crash handlers that outlive the document, a second bridge client, separate theme/crash/reload bridge or teardown paths, or operation/query teardown paths outside `@ryot/client-sdk`.

## Acceptance criteria

- [ ] The fixture exposes a deterministic action that causes a fatal render/runtime failure for browser testing.
- [ ] Fatal React render errors and uncaught plugin runtime failures are contained within the plugin document and do not unmount or reload the kernel.
- [ ] A failure reported before ready transitions the host from loading to a stable kernel-owned failure state.
- [ ] A failure after ready closes the bridge, rejects all pending calls exactly once, and prevents further calls on the failed session.
- [ ] The failed `RyotClient` drains both operation and RyotQL pending calls and refuses new capability calls before the iframe is replaced.
- [ ] The shared runtime owns the `ready`/`active`/`closing`/`failed`/`disposed` transitions (`ready`/`active` -> `closing` -> `failed` on failure and `ready`/`active` -> `closing` -> `disposed` on normal disposal), and every pending query or operation settles at most once; late results are ignored.
- [ ] Kernel abort is best effort, does not claim to roll back committed backend work, and does not create a second teardown path.
- [ ] Typed backend operation failures continue to render inside fixture UI and do not trigger the kernel crash state.
- [ ] The failure screen provides one accessible reload action and does not display stack traces, wire payloads, credentials, or internal diagnostics.
- [ ] Failure signaling keeps `lifecycle-close` payload-free as `{ type: "lifecycle-close", reason: "disposed" | "failed" }`; diagnostics stay kernel-internal and are not expanded onto the bridge.
- [ ] Reload mounts a fresh iframe and `MessageChannel` for the same artifact and restores the current logical plugin route.
- [ ] Successful reload clears the failure state and leaves kernel navigation and authentication intact.
- [ ] Repeated crash/reload cycles do not leak ports, listeners, pending-request entries, iframe nodes, or global handlers.
- [ ] Crash recovery reuses the existing runtime's port, dispatcher, client, listeners, and idempotent disposal; it adds no theme-, crash-, or reload-specific bridge or teardown path.
- [ ] Runtime, host lifecycle, pending-call teardown, pre-ready failure, post-ready failure, and browser recovery tests pass with all earlier tracer tests.

## User stories addressed

- User story 8

## Implementor Notes

Cross-document browser error events are not a sufficient protocol. The plugin runtime must own its error boundary and fatal reporting because the iframe remains isolated. Extend the Task 05-followup plugin runtime and provider lifecycle rather than introducing a crash-specific SDK or mutable module singleton.
