# Web Client Plugin Tracer

## Tasks

**Overall Progress:** 9 of 10 tasks completed

**Current Task:** [Task 09](./09-clean-up-web-tracer.md) (todo)

### Task List

| #           | Task                                                                                          | Status |
| ----------- | --------------------------------------------------------------------------------------------- | ------ |
| 01          | [Establish Kernel UI and Connect to a Server](./01-establish-kernel-ui-and-connect-server.md) | done   |
| 02          | [Authenticate Into the Kernel Shell](./02-authenticate-into-kernel-shell.md)                  | done   |
| 03          | [Install and Render a Fixture Plugin](./03-install-and-render-fixture-plugin.md)              | done   |
| 04          | [Navigate Fixture Private Routes](./04-navigate-fixture-private-routes.md)                    | done   |
| 05          | [Invoke an Authenticated Operation](./05-invoke-authenticated-operation.md)                   | done   |
| 05-followup | [Establish Shared Client SDK Runtime](./05-followup-establish-shared-client-sdk-runtime.md)   | done   |
| 06          | [Synchronize Kernel Theme](./06-synchronize-kernel-theme.md)                                  | done   |
| 07          | [Recover From Plugin Crashes](./07-recover-from-plugin-crashes.md)                            | done   |
| 08          | [Reload Updated Plugin Artifacts](./08-reload-updated-plugin-artifacts.md)                    | done   |
| 09          | [Clean Up the Web Tracer](./09-clean-up-web-tracer.md)                                        | todo   |

Task 05-followup is complete after Task 05 and before Task 06. It is a follow-up entry, not a renumbering of Tasks 06-09; Task 06 remains the next normal task.

## Source Plan

This plan implements only the fresh kernel and web fixture tracer from [Ryot Client Plugin Architecture](../../ryot-client-plugin-design.md), especially sections 3-22, 31-34, and 39.1-39.2. The architecture document remains authoritative when this plan does not narrow a decision.

## Goal

Prove one client plugin through the production web path:

```text
plugin client source in archive
  -> server-side client compilation
  -> immutable content-addressed artifact
  -> RyotQL installation/artifact catalog
  -> authenticated kernel route resolution
  -> isolated iframe and one per-session MessageChannel runtime
  -> plugin home and one private route
  -> shared recipe-backed client query with local decoding
  -> one authenticated backend operation
  -> live theme synchronization
  -> crash recovery
  -> update and forced artifact reload
```

## External Prerequisites

The repository owner completes these actions before Task 01 starts:

1. move the existing Expo / React Native client from `kernel/client` to a reference location under `crates/`
2. create a plain TanStack Router React DOM starter at `kernel/client`

These actions are not tasks in this plan. Implementors may read the legacy client under `crates/`, but every task in this plan must treat `crates/**` as read-only. This plan does not delete, clean up, rename, or otherwise modify anything under `crates/`.

## User Stories

1. As a user, I can open the new Ryot web kernel, connect it to Ryot Cloud or a self-hosted server, and see a consistent accessible Ryot interface.
2. As a user, I can authenticate with the methods enabled by my server, restore my session, and enter an authenticated kernel shell.
3. As a plugin author, I can put supported React DOM client source and assets in my plugin archive and have Ryot compile an immutable client artifact without installing my dependencies.
4. As an authenticated user, I can open an installed fixture plugin home through the same isolated artifact path intended for third-party plugins.
5. As a user, I can navigate between the fixture home and a private route using one kernel-owned browser history without recreating the plugin iframe.
6. As a plugin author, I can invoke one authenticated operation through the client SDK without receiving the user's Ryot credentials.
7. As a user, I can change the kernel theme and see the mounted plugin update without recompilation or iframe recreation.
8. As a user, I see a stable kernel-owned failure state when a plugin crashes and can reload that plugin without reloading the kernel.
9. As a user, I receive an updated plugin artifact through a forced iframe reload without mixing old client code with a newer backend package revision.

## Fixed Decisions

- The new client is a greenfield React DOM kernel. Do not add Expo adapters, compatibility layers, migrated client state, or legacy bridge behavior.
- The first tracer targets the browser only. Capacitor validation and Media entity rendering belong to later tracers.
- Onboarding and authentication are real production paths. Tests may seed users and sessions through test support, but application code must not hardcode a user or bypass authentication.
- Kernel UI starts from the existing semantic design language, adapted to DOM CSS. Port tokens and behavior, not React Native or NativeWind implementation details.
- The plugin source archive contains `manifest.json`, `backend/**`, and optional `client/**`. The compiled client artifact is separate from the source archive.
- `@ryot/sandbox-compiler` remains backend-specific. Browser compilation belongs to a new `@ryot/client-plugin-compiler` package.
- `@ryot/client-sdk` is the shared environment-neutral client package. Its public surfaces are the root package plus `/react`, `/plugin`, and `/effect`; `@ryot/client-ui-sdk` remains a separate UI package shared by the kernel and plugins.
- `RyotClient` exposes semantic capability APIs through an explicitly supplied provider/client, and its asynchronous request APIs return Promises. The canonical taxonomy is `ryot.data.query(recipe)`, `ryot.operations.invoke({ slug, input, output })`, and `ryot.navigation.push/replace`. The kernel uses a direct adapter; one per-session plugin runtime uses a `MessageChannel` adapter. No global mutable bridge is part of the shared client runtime.
- The SDK and bridge use the canonical JSON boundary from `@ryot/contract/schema/json`: `JsonValue` is the shared type/schema value and `isJsonValue` is the shared runtime guard. Unsupported values are rejected, never normalized with `JSON.stringify`; `Schema.Unknown`, ad hoc validators, and unchecked casts are not valid boundary implementations.
- `ryot.operations.invoke({ slug, input, output })` requires `input`; a no-input operation sends explicit `null`, and omitted input is invalid. Invalid SDK input fails locally with `RyotClientError` reason `invalid-input`. A non-JSON operation output is reported as `malformed-result` before it is sent over the bridge.
- Queries, operations, navigation, and later capabilities use one public `RyotClientError`. Its reasons are exactly `disposed`, `protocol`, `transport`, `invalid-input`, `query-failed`, `operation-failed`, `malformed-result`, and `unsupported-capability`: teardown, malformed bridge/session data or wire `failed` close, communication/posting/network failure, local pre-dispatch input failure, opaque declared backend/platform query or operation execution failure, invalid capability results, and unavailable or undeclared capabilities respectively. Expected plugin business/domain outcomes remain successful typed values, the wire value `failed` is not a public SDK error reason, and internal causes, messages, diagnostics, HTTP details, and stack traces never cross the bridge.
- Shared schemas, `RyotClientError`, the runtime lifecycle, pending-call handling, and teardown machinery are fixed shared infrastructure. Later theme, crash, and reload tasks must reuse them and must not add capability-, theme-, crash-, or reload-specific error unions or compatibility paths.
- Each plugin session has one runtime owning its `MessagePort`, `ready`/`active`/`closing`/`failed`/`disposed` state, single dispatcher, location state, query and operation pending calls, listeners, client, and disposal. Task 06 adds theme state to this runtime. All pending calls reject at most once during failure or disposal; kernel abort is best effort and cannot undo committed backend work.
- Bootstrap validates artifact metadata before accepting one port and owns the bootstrap listener and React root/unmount coordinator; the runtime owns the session listener/dispatcher and client lifecycle, while `PluginHost` owns the iframe.
- The server compiles client source during plugin installation and update. Package source hash and client artifact hash are separate identities.
- Client artifact metadata is immutable and keyed by artifact hash; artifact files are immutable and keyed by artifact hash plus file name. A plugin row stores only its active artifact hash. Old artifacts are retained indefinitely, and this tracer adds no garbage collection.
- The kernel reads installation and artifact metadata through an application-owned named RyotQL recipe with a colocated schema and decoder.
- `ryot.data.query(recipe)` executes a recipe and decodes its result locally. It uses the existing user-scoped backend authorization and does not introduce a client-specific authorization bypass.
- Plugin applications run in isolated iframes, receive no Ryot credentials, and communicate through a kernel-created `MessageChannel`.
- The client API and artifact-format markers are exact, and the bridge uses exact protocol version 1. The one per-session runtime routes session messages through its single dispatcher, carries strict `{ type: "lifecycle-close", reason: "disposed" | "failed" }` signaling, and rejects pending calls during disposal. Task 06 extends that exact contract with runtime-owned theme messages.
- Installed plugins are trusted with data exposed through their SDK and may use public browser networking. This tracer does not add network permissions or origin allowlists.
- A package update changes the artifact hash and force-reloads the mounted iframe. An old artifact must not continue against the new package revision.
- A disabled installation is absent from bootstrap and the workspace switcher, but direct routes remain valid. Backend operation availability remains backend-owned.

## Scope Boundaries

This plan does not implement:

- Capacitor, iOS, or Android projects
- Media or Fitness client applications
- entity renderer delegation
- saved-view UI porting
- plugin installation or permission UI
- the complete client SDK or client UI SDK
- durable plugin client storage
- files, notifications, audio, haptics, screen, or Live Activity capabilities
- artifact garbage collection or retention expiry
- broad legacy-client feature parity
- deletion or cleanup of `crates/**`

Only SDK and UI APIs required by the web fixture or the shared recipe execution path may be introduced.

## Verification Strategy

Each task owns focused tests for its behavior and must keep all previously completed slices passing. Prefer contract, compiler, backend integration, and browser-level assertions at their owning boundaries. The completed tracer must prove the same installed fixture from source archive through browser rendering; a test-only alternate runtime path is not acceptable.

Boundary verification must cover valid recursive `JsonValue` values, explicit `null` input, strict rejection of omitted or non-JSON input, local `invalid-input` errors before adapter dispatch, and `malformed-result` for invalid capability results. It must verify the exact public `RyotClientError` reasons and classifications, `query-failed` and `operation-failed` for opaque declared execution failures, consistent disposal and protocol rejection across pending capabilities, successful typed business/domain outcomes, transport only for communication/posting/network failure, and no bridge leakage of internal causes, messages, diagnostics, HTTP details, or stack traces. Tests must prove that no value is normalized with `JSON.stringify` and that lifecycle-close remains the payload-free `{ type, reason }` message; wire `failed` is not a public SDK error reason.
