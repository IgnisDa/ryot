# Establish Shared Client SDK Runtime

**Parent Plan:** [Web Client Plugin Tracer](./README.md)

**Status:** done

## Relationship to Task 05

This completed follow-up records the shared runtime boundary established after Task 05 and before Task 06. It does not renumber or move Tasks 06-09.

## What to build

Use one framework-neutral `RyotClient` Promise capability for kernel and plugin capabilities. The client receives its provider/client explicitly; it must not depend on a global mutable bridge. In the plugin, one per-session runtime owns the `MessagePort`, `ready`/`active`/`closing`/`failed`/`disposed` state, single dispatcher, location state, query and operation pending calls, listeners, client, and disposal. Theme state, crash reporting, and artifact replacement reuse this runtime.

Rename the package to `@ryot/client-sdk` and keep its public surfaces deliberate:

- `@ryot/client-sdk` for the shared client contract and `RyotClient`
- `@ryot/client-sdk/react` for React integration
- `@ryot/client-sdk/plugin` for the plugin runtime adapter plus plugin React routing conveniences
- `@ryot/client-sdk/effect` for the supported schema surface

The kernel uses a direct adapter into kernel services. The one plugin session runtime uses a `MessageChannel` adapter for the same client contract. The adapter boundary keeps the shared API environment-neutral without making the kernel pay for a plugin bridge. `ryot.navigation.push/replace`, `ryot.data.query`, `ryot.operations.invoke`, and terminal lifecycle handling use that runtime's one dispatcher. These are the only host adapters; no compatibility path or separate capability bridge is allowed.

The React surface supplies `RyotProvider`, `useRyot`, `createRyotQuery`, `useRyotQuery`, `createRyotMutation`, and `useRyotMutation` for the explicit client value used by kernel and plugin components.

The data API includes `ryot.data.query(recipe, { signal })`. A recipe owns the query document and its result decoding; the client executes the document and performs decoding locally. The optional `AbortSignal` is passed to the direct or `MessageChannel` adapter. The request uses the existing user-scoped backend authorization path and does not add a client-specific authorization bypass. Opaque declared execution failures use `query-failed`, while invalid decoded results use `malformed-result`.

`createRyotQuery`/`useRyotQuery` and `createRyotMutation`/`useRyotMutation` are thin React bindings over the Promise client. They return plain query-like result objects rather than TanStack Query objects. Internally, each `RyotProvider` creates one `@effect/atom-react` `RegistryProvider` and registry/cache for its provider/session. Query definitions use `Atom.family`, query atoms use SWR refresh on mount and browser focus, and unobserved atoms use a five-minute idle TTL.

Preserve the current operation behavior. `ryot.operations.invoke({ slug, input, output })` is the Promise API for plugin operations. `input` is required and uses the canonical `JsonValue` boundary from `@ryot/contract/schema/json`; a no-input operation sends explicit `null`, while omitted input is invalid. The SDK uses `isJsonValue` to reject invalid input with `RyotClientError` reason `"invalid-input"` before adapter dispatch. Expected plugin business/domain outcomes are successful typed values decoded by `output`, never SDK errors. Queries, operations, navigation, and later capabilities use the same public `RyotClientError`; its reasons are exactly `disposed`, `protocol`, `transport`, `invalid-input`, `query-failed`, `operation-failed`, `malformed-result`, and `unsupported-capability`. The wire value `failed` is not a public SDK error reason.

Keep plugin routing conveniences on the plugin surface. `PluginLink`, `usePluginLocation`, `usePluginParams`, and `usePluginSearch` are imported from `@ryot/client-sdk/plugin` and are backed by the same runtime as `ryot.navigation.push/replace`. `@ryot/client-ui-sdk` remains separate from the client SDK and is shared by kernel and plugin UI.

The bridge contract is exact protocol version 1. It routes all current session messages through the one runtime dispatcher, adds strict `{ type: "lifecycle-close", reason: "disposed" | "failed" }` signaling, and makes disposal reject pending calls exactly once. Dynamic bridge values use the canonical `JsonValue` schema; strict decoding rejects unsupported values and no value is normalized with `JSON.stringify`. A query `AbortSignal` removes the plugin-side pending query and sends the strict `{ type: "ryotql-cancel", requestId }` message; the kernel aborts matching service work on a best-effort basis and suppresses late results. A non-JSON operation output becomes `"malformed-result"` before bridge delivery. Internal causes, messages, diagnostics, HTTP details, and stack traces never cross the bridge.

## Acceptance criteria

- [x] The shared client package is named `@ryot/client-sdk` and exposes root, `/react`, `/plugin`, and `/effect` surfaces.
- [x] `RyotClient` is environment-neutral, its asynchronous request APIs return Promises, and it is supplied through an explicit provider/client boundary rather than a global mutable bridge.
- [x] The kernel and plugin runtime use separate direct and `MessageChannel` adapters behind the same client contract.
- [x] `ryot.data.query(recipe, { signal })` executes the recipe document, forwards the optional abort signal through the selected adapter, and decodes the result locally through the recipe's decoder.
- [x] `@ryot/client-sdk/react` exports the query and mutation definition/hooks and returns plain query-like result state over the shared Promise client.
- [x] Each `RyotProvider` owns one `@effect/atom-react` registry/cache for its provider/session; query inputs use `Atom.family`, query refresh uses SWR mount/focus behavior, and idle entries expire after five minutes.
- [x] Query `AbortSignal` values reach both adapters, and plugin cancellation uses the strict protocol version 1 `{ type: "ryotql-cancel", requestId }` message.
- [x] Query access uses the existing user-scoped backend authorization behavior without a client-specific bypass.
- [x] `ryot.operations.invoke({ slug, input, output })` requires JSON-compatible input, uses explicit `null` for no input, rejects invalid SDK input as `invalid-input`, and preserves its current success and failure behavior.
- [x] Operation success values use the canonical `JsonValue` schema; expected plugin business/domain outcomes decode as typed values, and a non-JSON value becomes `malformed-result` before bridge delivery, without stringification or normalization.
- [x] `RyotClientError` exposes exactly the eight public reasons and their fixed classifications across capabilities; the wire lifecycle value `failed` maps to `protocol` and is not itself a public SDK error reason.
- [x] `ryot.navigation.push/replace` is the shared navigation API; `PluginLink` and the reactive location, params, and search conveniences remain on `@ryot/client-sdk/plugin`, and `@ryot/client-ui-sdk` remains a separate shared UI package.
- [x] One per-session runtime owns the port, lifecycle state, dispatcher, location state, query/operation pending calls, listeners, client, and idempotent disposal; each pending call settles at most once. Theme, crash, and artifact-reload work reuse this runtime.
- [x] Bootstrap validates metadata before accepting one port and owns the bootstrap listener and React root/unmount coordinator; the runtime owns the session listener and no capability-specific bridge or teardown path exists.
- [x] The bridge validates exact protocol version 1 markers by equality.

## Implementation Notes

- **One explicit client per runtime.** Plugin bootstrap validates embedded metadata before installing its one parent-window listener, accepts exactly one valid init and transferred port, requires the artifact root, creates one per-session runtime, and owns the React root/unmount coordinator. The runtime owns the port listener, single dispatcher, session listeners, bridge-backed `RyotClient`, and disposal; bootstrap supplies that client to `RyotProvider`, which also owns the session's atom registry/cache. Kernel routes create a direct client for their authenticated `ApiScope` and use the same provider/query surface.
- **Recipes decode where they are called.** Both adapters execute only the prepared recipe document. `ryot.data.query` applies the recipe decoder locally and reports stable query, transport, and malformed-result failures. The route loader seeds the plugin catalog query with its initial decoded catalog; the provider-scoped query uses that hydration on mount and revalidates on focus, while catalog events call `refetch`.
- **Protocol version 1 session.** Strict correlated request/result messages carry the RyotQL document or JSON-compatible public outcome through the single dispatcher, alongside location, theme, and the payload-free `{ type: "lifecycle-close", reason: "disposed" | "failed" }` message. Query aborts carry only strict `{ type: "ryotql-cancel", requestId }` and abort matching kernel work on a best-effort basis. Runtime disposal rejects all remaining plugin query and operation calls exactly once using the shared error contract, while kernel teardown aborts pending service work on a best-effort basis and suppresses late results. An abort cannot undo backend work that committed before it took effect; user, server, plugin, and installation identity remain kernel-owned.
- **Cleanup covered the completed tracer.** Stale dependencies, package references, bridge-version literals, comments, generated old-package residue, and permissive SDK subpath imports were removed across Tasks 01 through 05-followup.
- **Verified with** `bun turbo --output-logs=full check` reporting 26/26 packages with zero warnings and zero errors, focused SDK/compiler/fixture/contract and kernel client checks and tests, the plugin archive suite (21/21), and forced end-to-end `client-operation.test.ts` and `client-artifact.test.ts` suites (6/6). The full backend suite retains three unrelated known sandbox-runner failures under Effect rc.111; backend checks and the affected plugin tests pass.
