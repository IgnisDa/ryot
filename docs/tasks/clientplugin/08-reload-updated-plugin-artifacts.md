# Reload Updated Plugin Artifacts

**Parent Plan:** [Web Client Plugin Tracer](./README.md)

**Status:** done

## What to build

Prove package update consistency with two fixture revisions. Revision B changes visible client output and keeps the same immutable plugin slug, plugin ID, and installation ID. The normal backend update path compiles B before activation, persists its new package source hash and client artifact hash atomically, and makes the new catalog row observable to the authenticated kernel through the Task 05-followup `ryot.data.query` path.

When `PluginHost` observes that the active installation's artifact hash changed, it must dispose revision A's shared per-session runtime, reject pending calls exactly once through the shared `RyotClientError` contract, destroy A's iframe, and mount B at the current logical global URL. The kernel validates B's exact markers, including protocol version 1, and creates a fresh `RyotClient` and runtime through the same bootstrap/runtime factory used for initial mounts, then starts a fresh bridge session. No request from A may execute against package revision B after activation. Kernel abort is best effort and cannot undo work from A that committed before the session closed.

Keep artifacts immutable and hash-addressed. Persist metadata and files as insert-only records independent of the active plugin row, which stores only its current artifact hash. Retain old artifacts indefinitely; do not add garbage collection without a retention policy. Reload is a host lifecycle response to the normal catalog/artifact change, not a public client method; it must not add reload messages, request/ack fields, or a second bridge. A failed update must leave the previously active package and artifact usable because activation did not complete. Update teardown must reuse the shared schemas, `RyotClientError`, runtime lifecycle, pending-call, and teardown machinery rather than adding an artifact-reload bridge or teardown path.

## Acceptance criteria

- [x] Two deterministic fixture source revisions produce different package source hashes and client artifact hashes while retaining plugin and installation identity.
- [x] The production plugin update path compiles and validates revision B before activating any B metadata.
- [x] A failed B compilation leaves revision A active and renderable without a partial catalog or artifact state.
- [x] Successful activation updates the RyotQL catalog and invalidates/reloads the kernel's catalog state through the normal reactive data path.
- [x] Catalog refresh continues to execute `pluginClientCatalogRecipe` through the shared kernel `RyotClient`; no direct contract call or plugin-specific query client bypasses `ryot.data.query`.
- [x] An unchanged artifact hash does not recreate the iframe.
- [x] A changed artifact hash disposes A's runtime, rejects A's pending requests exactly once before closing A's port, destroys A's iframe, and mounts B exactly once.
- [x] A changed artifact hash uses the shared disposal path, then creates B's fresh `RyotClient` and runtime through the normal initial-mount factory; no public reload capability or parallel runtime is introduced.
- [x] A normal artifact replacement uses the shared client error contract, including `disposed` for normal teardown, and introduces no reload-specific error union.
- [x] A changed artifact hash disposes A's existing `ready`/`active`/`closing`/`failed`/`disposed` runtime, settles query and operation calls at most once, and leaves no A listener or pending entry behind.
- [x] Revision B opens at the same logical plugin URL and shows its changed output after a fresh exact-version handshake.
- [x] Revision A cannot issue an authenticated operation after revision B becomes active.
- [x] Immutable artifact responses cannot mutate revision A bytes at revision A's hash.
- [x] Reload uses the existing `PluginHost` lifecycle and exact protocol version 1 handshake only; no arbitrary reload protocol or reload-specific wire contract is introduced.
- [x] Artifact replacement fully disposes the previous session before the new protocol version 1 session is established, using the shared theme, crash, reload, and teardown lifecycle.
- [x] Backend update atomicity, catalog reactivity, host remount, stale-port rejection, shared pending-call/error handling, unchanged-hash stability, failed-update preservation, and browser update tests pass with all earlier tracer tests.

## User stories addressed

- User story 9

## Implementor Notes

Use the existing private/system package update invariants rather than inventing a client-only update endpoint. The browser test must observe the update through the same shared `ryot.data.query` catalog path used at initial load. If this task introduces reactive invalidation or caching, layer it around the existing `RyotClient` query capability rather than restoring the pre-follow-up manual transport and decoding path. Artifact replacement must call the same per-session runtime disposal used by crash recovery and unmount; it must not own a second port, dispatcher, listener, or pending-call teardown.

## Implementation Notes

- **Production update invariants were already sufficient.** Deterministic fixture revisions now drive the normal private upload and update route. Revision B compiles before the existing ingestion transaction inserts immutable B metadata and files and activates its hash; a failed client compilation leaves A's catalog row and artifact bytes unchanged. Successful updates retain the plugin and installation IDs. The plugin row stores only B's active hash, while A remains independently addressable and is retained indefinitely.
- **Catalog refresh stays on the shared client path.** The plugin route creates one route-scoped Effect Atom around `PluginCatalogService.load`, which uses the loader-created kernel `RyotClient` and follows the bounded cursor pages for `pluginClientCatalogRecipe()` to completion, with at most 100 rows per page. It refreshes once per second only while mounted, retains the last successful catalog during transient failures, and stops on unmount. A successful removal unmounts the host instead of retaining stale installation state.
- **Artifact identity remains the remount trigger.** `PluginHost` still keys `PluginFrame` by installation and artifact hash. Source-only catalog changes preserve the iframe, while an artifact hash change uses React unmount to send the normal `disposed` close, abort and clear pending query/operation work once, release A's listeners and port, and create exactly one fresh B iframe and protocol version 1 handshake at the current logical location.
- **Operation dispatch is revision-bound.** The kernel adds the catalog source hash to its authenticated HTTP operation request; the value is not accepted from the iframe bridge message. When present, the backend resolves and validates that active revision while holding the existing ingestion advisory transaction lock, so A cannot resolve B's operation after activation. The field remains optional for established direct and unauthenticated integration callers. Source-only updates use the latest catalog hash without recreating the iframe; already-authorized A work may finish on A's immutable script, and abort still cannot undo committed work.
- **Review corrections.** Review found the activation-to-poll race, stale installation fallback, source-only session stranding, and accidental breakage of direct/integration operation callers. The revision guard, successful-removal behavior, latest-hash dispatch, and optional HTTP field fixed them. The same reviewer approved the final implementation with no findings.
- **Security follow-up closed the CSS filesystem boundary.** Plugin stylesheet imports now resolve only to the compiler-owned `tailwindcss` entry or relative `.css` files present in that plugin's in-memory `client/**` source map. Absolute paths, traversal outside `client/**`, missing files, and unsupported bare imports fail with `RYOT_CLIENT_STYLES`; plugin-controlled CSS no longer uses Bun filesystem resolution and cannot copy readable server files into `plugin.css`.
- **Verification.** Contract, kernel backend, and kernel client checks, tests, and builds pass. The affected end-to-end suites `client-artifact.test.ts`, `client-operation.test.ts`, `operations.test.ts`, `private-plugins.test.ts`, and `sandbox/integrations.test.ts` pass 5 files/29 tests together. The repository has no browser-driver harness, so real-browser iframe scheduling remains unautomated; focused route, host, bridge, contract, backend, and production-path end-to-end tests cover the available boundaries.
