# Reload Updated Plugin Artifacts

**Parent Plan:** [Web Client Plugin Tracer](./README.md)

**Status:** todo

## What to build

Prove package update consistency with two fixture revisions. Revision B changes visible client output and keeps the same immutable plugin slug, plugin ID, and installation ID. The normal backend update path compiles B before activation, persists its new package source hash and client artifact hash atomically, and makes the new catalog row observable to the authenticated kernel through the Task 05-followup `ryot.data.query` path.

When `PluginHost` observes that the active installation's artifact hash changed, it must close revision A's bridge, reject pending calls, destroy A's iframe, and mount B at the current logical global URL. The kernel validates B's exact markers, including bridge protocol V2, and starts a fresh bridge session. No request from A may execute against package revision B after activation.

Keep artifacts immutable and hash-addressed. This slice does not add version ranges, protocol adapters, old-artifact execution, rollback UI, retention policy, or garbage collection. A failed update must leave the previously active package and artifact usable because activation did not complete.

## Acceptance criteria

- [ ] Two deterministic fixture source revisions produce different package source hashes and client artifact hashes while retaining plugin and installation identity.
- [ ] The production plugin update path compiles and validates revision B before activating any B metadata.
- [ ] A failed B compilation leaves revision A active and renderable without a partial catalog or artifact state.
- [ ] Successful activation updates the RyotQL catalog and invalidates/reloads the kernel's catalog state through the normal reactive data path.
- [ ] Catalog refresh continues to execute `pluginClientCatalogRecipe` through the shared kernel `RyotClient`; no direct contract call or plugin-specific query client bypasses `ryot.data.query`.
- [ ] An unchanged artifact hash does not recreate the iframe.
- [ ] A changed artifact hash closes A's port, rejects A's pending requests, destroys A's iframe, and mounts B exactly once.
- [ ] Revision B opens at the same logical plugin URL and shows its changed output after a fresh exact-version handshake.
- [ ] Revision A cannot issue an authenticated operation after revision B becomes active.
- [ ] Immutable artifact responses cannot mutate revision A bytes at revision A's hash.
- [ ] No compatibility negotiation, fallback bridge, dual-revision session, or client-state migration code is introduced.
- [ ] Backend update atomicity, catalog reactivity, host remount, stale-port rejection, unchanged-hash stability, failed-update preservation, and browser update tests pass with all earlier tracer tests.

## User stories addressed

- User story 9

## Implementor Notes

Use the existing private/system package update invariants rather than inventing a client-only update endpoint. The browser test must observe the update through the same shared `ryot.data.query` catalog path used at initial load. If this task introduces reactive invalidation or caching, layer it around the existing `RyotClient` query capability rather than restoring the pre-follow-up manual transport and decoding path.
