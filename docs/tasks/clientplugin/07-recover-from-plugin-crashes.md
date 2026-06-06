# Recover From Plugin Crashes

**Parent Plan:** [Web Client Plugin Tracer](./README.md)

**Status:** todo

## What to build

Contain fatal fixture runtime failures inside `PluginHost` and provide kernel-owned recovery. Add a deliberate fixture crash action. The `@ryot/client-sdk/plugin` runtime created in Task 05-followup must catch fatal React render errors and relevant uncaught runtime failures, report a structured fatal event through its existing adapter when possible, and stop accepting normal calls. The kernel closes the failed session, rejects pending requests, and replaces the iframe viewport with a stable failure state that can reload the same artifact.

Reload creates a fresh iframe document and bridge session for the same installation, artifact hash, and logical route. It must not reload the kernel document or mutate the immutable artifact. A normal typed operation failure from Task 05 is not a plugin crash and must remain recoverable inside plugin UI.

Handle failures before ready, after ready, and during an in-flight request. Internal stack traces and bridge diagnostics may be logged through the kernel's internal error boundary but must not be rendered to the user or echoed to the plugin as privileged details.

Crash reporting remains on the exact protocol V2 bridge when a session is available; no compatibility bridge is added.

Crash state, fatal reporting, and plugin-side pending-call rejection belong to the existing per-session client runtime. Do not add global crash handlers that outlive the document, a second bridge client, or operation/query teardown paths outside `@ryot/client-sdk`.

## Acceptance criteria

- [ ] The fixture exposes a deterministic action that causes a fatal render/runtime failure for browser testing.
- [ ] Fatal React render errors and uncaught plugin runtime failures are contained within the plugin document and do not unmount or reload the kernel.
- [ ] A failure reported before ready transitions the host from loading to a stable kernel-owned failure state.
- [ ] A failure after ready closes the bridge, rejects all pending calls exactly once, and prevents further calls on the failed session.
- [ ] The failed `RyotClient` drains both operation and RyotQL pending calls and refuses new capability calls before the iframe is replaced.
- [ ] Typed backend operation failures continue to render inside fixture UI and do not trigger the kernel crash state.
- [ ] The failure screen provides one accessible reload action and does not display stack traces, wire payloads, credentials, or internal diagnostics.
- [ ] Reload mounts a fresh iframe and `MessageChannel` for the same artifact and restores the current logical plugin route.
- [ ] Successful reload clears the failure state and leaves kernel navigation and authentication intact.
- [ ] Repeated crash/reload cycles do not leak ports, listeners, pending-request entries, iframe nodes, or global handlers.
- [ ] Runtime, host lifecycle, pending-call teardown, pre-ready failure, post-ready failure, and browser recovery tests pass with all earlier tracer tests.

## User stories addressed

- User story 8

## Implementor Notes

Cross-document browser error events are not a sufficient protocol. The plugin runtime must own its error boundary and fatal reporting because the iframe remains isolated. Extend the Task 05-followup plugin runtime and provider lifecycle rather than introducing a crash-specific SDK or mutable module singleton.
