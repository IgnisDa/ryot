# Establish Shared Client SDK Runtime

**Parent Plan:** [Web Client Plugin Tracer](./README.md)

**Status:** done

## Relationship to Task 05

This completed follow-up records the shared runtime boundary established after Task 05 and before Task 06. It does not renumber or move Tasks 06-09.

## What to build

Use one environment-neutral `RyotClient` for kernel and plugin data access. The client exposes Promise-based APIs and receives its provider/client explicitly; it must not depend on a global mutable bridge. In the plugin, one per-session runtime owns the `MessagePort`, `ready`/`active`/`closing`/`failed`/`disposed` state, single dispatcher, location state, query and operation pending calls, listeners, client, and disposal. Task 06 adds theme state to this runtime.

Rename the package to `@ryot/client-sdk` and keep its public surfaces deliberate:

- `@ryot/client-sdk` for the shared client contract and `RyotClient`
- `@ryot/client-sdk/react` for React integration
- `@ryot/client-sdk/plugin` for the plugin runtime adapter and plugin routing surface
- `@ryot/client-sdk/effect` for the supported schema surface

The kernel uses a direct adapter into kernel services. The one plugin session runtime uses a `MessageChannel` adapter for the same client contract. The adapter boundary keeps the shared API environment-neutral without making the kernel pay for a plugin bridge. Navigation, query, operation, and terminal lifecycle handling use that runtime's one dispatcher. Tasks 06 and 07 extend it with theme and fatal handling; separate capability bridges are not allowed.

The React surface supplies `RyotProvider` and `useRyot` for the explicit client value used by plugin components.

The data API includes `ryot.data.query(recipe)`. A recipe owns the query document and its result decoding; the client executes the document and performs decoding locally. The request uses the existing user-scoped backend authorization path and does not add a client-specific authorization bypass.

Preserve the current operation behavior. `ryot.data.invokeOperation({ slug, input, output })` remains a Promise API for plugin operations: the plugin supplies only the operation slug and input, the output schema decodes the returned value locally, and expected operation failures, transport failures, and malformed results remain distinguishable through the existing SDK error behavior.

Keep plugin routing imports on the plugin surface. `PluginLink`, `usePluginLocation`, `usePluginNavigation`, `usePluginParams`, and `usePluginSearch` are imported from `@ryot/client-sdk/plugin`; they do not become `ryot.navigation` methods. `@ryot/client-ui-sdk` remains separate from the client SDK and is shared by kernel and plugin UI.

The bridge contract is exact protocol V3. V3 changes the bridge marker from V2 to `3`, routes all current session messages through the one runtime dispatcher, adds strict `{ type: "lifecycle-close", reason: "disposed" | "failed" }` signaling, and makes disposal reject pending calls exactly once. Task 06 adds theme messages to this runtime and exact contract. V2 is not supported. Do not add aliases, version ranges, compatibility negotiation, fallback adapters, legacy bridge code, or client-state migration.

## Acceptance criteria

- [x] The shared client package is named `@ryot/client-sdk` and exposes root, `/react`, `/plugin`, and `/effect` surfaces.
- [x] `RyotClient` is environment-neutral, returns Promises, and is supplied through an explicit provider/client boundary rather than a global mutable bridge.
- [x] The kernel and plugin runtime use separate direct and `MessageChannel` adapters behind the same client contract.
- [x] `ryot.data.query(recipe)` executes the recipe document and decodes the result locally through the recipe's decoder.
- [x] Query access uses the existing user-scoped backend authorization behavior without a client-specific bypass.
- [x] `ryot.data.invokeOperation({ slug, input, output })` and its current success and failure behavior remain accurate.
- [x] Plugin routing remains on `@ryot/client-sdk/plugin`, and `@ryot/client-ui-sdk` remains a separate shared UI package.
- [x] One per-session runtime owns the port, lifecycle state, dispatcher, location state, query/operation pending calls, listeners, client, and idempotent disposal; each pending call settles at most once. Task 06 adds theme state to this runtime.
- [x] Bootstrap validates metadata before accepting one port and owns the bootstrap listener and React root/unmount coordinator; the runtime owns the session listener and no capability-specific bridge or teardown path exists.
- [x] The bridge validates exact protocol V3 markers without V2 support or compatibility code.

## Implementation Notes

- **One explicit client per runtime.** Plugin bootstrap validates embedded metadata before installing its one parent-window listener, accepts exactly one valid init and transferred port, requires the artifact root, creates one per-session runtime, and owns the React root/unmount coordinator. The runtime owns the port listener, single dispatcher, session listeners, bridge-backed `RyotClient`, and disposal; bootstrap supplies that client to `RyotProvider`. Kernel routes create a direct client for their authenticated `ApiScope`. The old mutable bridge binding and `@ryot/client-plugin-sdk` package were removed without aliases.
- **Recipes decode where they are called.** Both adapters execute only the prepared recipe document. `ryot.data.query` applies the recipe decoder locally and reports stable query, transport, and malformed-result failures.
- **Protocol V3 unifies the session.** Strict correlated request/result messages carry the RyotQL document or public outcome through the single dispatcher, alongside location and `{ type: "lifecycle-close", reason: "disposed" | "failed" }` messages. Task 06 adds theme messages to that dispatcher. Runtime disposal rejects all remaining plugin query and operation calls exactly once, while kernel teardown aborts pending service work on a best-effort basis and suppresses late results. An abort cannot undo backend work that committed before it took effect; user, server, plugin, and installation identity remain kernel-owned.
- **Cleanup covered the completed tracer.** Stale dependencies, package references, bridge-version literals, comments, generated old-package residue, and permissive SDK subpath imports were removed across Tasks 01 through 05-followup.
- **Verified with** `bun turbo --output-logs=full check` reporting 26/26 packages with zero warnings and zero errors, focused SDK/compiler/fixture/contract and kernel client checks and tests, the plugin archive suite (21/21), and forced end-to-end `client-operation.test.ts` and `client-artifact.test.ts` suites (6/6). The full backend suite retains three unrelated known sandbox-runner failures under Effect rc.111; backend checks and the affected plugin tests pass.
