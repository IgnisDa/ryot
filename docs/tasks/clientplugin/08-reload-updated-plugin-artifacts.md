# Reload Updated Plugin Artifacts

**Parent Plan:** [Web Client Plugin Tracer](./README.md)

**Status:** todo

## What to build

Prove package update consistency with two fixture revisions. Revision B changes visible client output and keeps the same immutable plugin slug, plugin ID, and installation ID. The normal backend update path compiles B before activation, persists its new package source hash and client artifact hash atomically, and makes the new catalog row observable to the authenticated kernel through the Task 05-followup `ryot.data.query` path.

When `PluginHost` observes that the active installation's artifact hash changed, it must dispose revision A's shared per-session runtime, reject pending calls exactly once through the shared `PluginOperationError` contract, destroy A's iframe, and mount B at the current logical global URL. The kernel validates B's exact markers, including protocol V3, and starts a fresh bridge session/runtime. No request from A may execute against package revision B after activation. Kernel abort is best effort and cannot undo work from A that committed before the session closed.

Keep artifacts immutable and hash-addressed. This slice does not add V2 support, aliases, version ranges, protocol adapters, fallback bridges, old-artifact execution, rollback UI, retention policy, garbage collection, an arbitrary reload protocol, or a reload-specific error union. Reload is a host lifecycle response to the normal catalog/artifact change; it must not add reload messages, request/ack fields, or a second bridge. A failed update must leave the previously active package and artifact usable because activation did not complete. Update teardown must reuse the shared schemas, `PluginOperationError`, runtime lifecycle, pending-call, and teardown machinery rather than adding an artifact-reload bridge or teardown path.

## Acceptance criteria

- [ ] Two deterministic fixture source revisions produce different package source hashes and client artifact hashes while retaining plugin and installation identity.
- [ ] The production plugin update path compiles and validates revision B before activating any B metadata.
- [ ] A failed B compilation leaves revision A active and renderable without a partial catalog or artifact state.
- [ ] Successful activation updates the RyotQL catalog and invalidates/reloads the kernel's catalog state through the normal reactive data path.
- [ ] Catalog refresh continues to execute `pluginClientCatalogRecipe` through the shared kernel `RyotClient`; no direct contract call or plugin-specific query client bypasses `ryot.data.query`.
- [ ] An unchanged artifact hash does not recreate the iframe.
- [ ] A changed artifact hash disposes A's runtime, rejects A's pending requests exactly once before closing A's port, destroys A's iframe, and mounts B exactly once.
- [ ] A normal artifact replacement uses the shared operation error contract, including `disposed` for normal teardown, and introduces no reload-specific error union or compatibility path.
- [ ] A changed artifact hash disposes A's existing `ready`/`active`/`closing`/`failed`/`disposed` runtime, settles query and operation calls at most once, and leaves no A listener or pending entry behind.
- [ ] Revision B opens at the same logical plugin URL and shows its changed output after a fresh exact-version handshake.
- [ ] Revision A cannot issue an authenticated operation after revision B becomes active.
- [ ] Immutable artifact responses cannot mutate revision A bytes at revision A's hash.
- [ ] Reload uses the existing `PluginHost` lifecycle and exact V3 handshake only; no arbitrary reload protocol or reload-specific wire contract is introduced.
- [ ] No compatibility negotiation, fallback bridge, dual-revision session, client-state migration, or separate theme/crash/reload bridge or teardown path is introduced; V3 is the only supported protocol.
- [ ] Backend update atomicity, catalog reactivity, host remount, stale-port rejection, shared pending-call/error handling, unchanged-hash stability, failed-update preservation, and browser update tests pass with all earlier tracer tests.

## User stories addressed

- User story 9

## Implementor Notes

Use the existing private/system package update invariants rather than inventing a client-only update endpoint. The browser test must observe the update through the same shared `ryot.data.query` catalog path used at initial load. If this task introduces reactive invalidation or caching, layer it around the existing `RyotClient` query capability rather than restoring the pre-follow-up manual transport and decoding path. Artifact replacement must call the same per-session runtime disposal used by crash recovery and unmount; it must not own a second port, dispatcher, listener, or pending-call teardown.
