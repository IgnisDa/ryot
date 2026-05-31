# Reload Updated Plugin Artifacts

**Parent Plan:** [Web Client Plugin Tracer](./README.md)

**Status:** done

## What to build

Prove package update consistency with two fixture revisions. Revision B changes visible client output and keeps the same immutable plugin slug, plugin ID, and installation ID. The normal backend update path compiles B before activation, persists its new package source hash and client artifact hash atomically, and makes the new catalog row observable to the authenticated kernel through the Task 05-followup `ryot.data.query` path.

When `PluginHost` observes that the active installation's package source hash or client artifact hash changed, it must dispose revision A's shared per-session runtime, reject pending calls exactly once through the shared `RyotClientError` contract, destroy A's iframe, and mount B at the current logical global URL. The kernel validates B's exact markers, including protocol version 1, and creates a fresh `RyotClient` and runtime through the same bootstrap/runtime factory used for initial mounts, then starts a fresh bridge session bound to B's package source hash. No request from A may execute against package revision B after activation, including when A and B compile to the same client artifact. Kernel abort is best effort and cannot undo work from A that committed before the session closed.

Keep artifacts immutable and hash-addressed. Persist metadata and files as insert-only records independent of the active plugin row, which stores only its current artifact hash. Retain old artifacts indefinitely; do not add garbage collection without a retention policy. Reload is a host lifecycle response to the normal catalog/artifact change, not a public client method; it must not add reload messages, request/ack fields, or a second bridge. A failed update must leave the previously active package and artifact usable because activation did not complete. Update teardown must reuse the shared schemas, `RyotClientError`, runtime lifecycle, pending-call, and teardown machinery rather than adding an artifact-reload bridge or teardown path.

## Acceptance criteria

- [x] Two deterministic fixture source revisions produce different package source hashes and client artifact hashes while retaining plugin and installation identity.
- [x] The production plugin update path compiles and validates revision B before activating any B metadata.
- [x] A failed B compilation leaves revision A active and renderable without a partial catalog or artifact state.
- [x] Successful activation updates the RyotQL catalog and invalidates/reloads the kernel's catalog state through the normal reactive data path.
- [x] Catalog refresh continues to execute `pluginClientCatalogRecipe` through the shared kernel `RyotClient`; no direct contract call or plugin-specific query client bypasses `ryot.data.query`.
- [x] Unchanged package source and client artifact hashes do not recreate the iframe.
- [x] A changed package source or client artifact hash disposes A's runtime, rejects A's pending requests exactly once before closing A's port, destroys A's iframe, and mounts B exactly once.
- [x] A changed package source or client artifact hash uses the shared disposal path, then creates B's fresh `RyotClient` and runtime through the normal initial-mount factory; no public reload capability or parallel runtime is introduced.
- [x] A normal artifact replacement uses the shared client error contract, including `disposed` for normal teardown, and introduces no reload-specific error union.
- [x] A changed package source or client artifact hash disposes A's existing `ready`/`active`/`closing`/`failed`/`disposed` runtime, settles query and operation calls at most once, and leaves no A listener or pending entry behind.
- [x] Revision B opens at the same logical plugin URL and shows its changed output after a fresh exact-version handshake.
- [x] Revision A cannot issue an authenticated operation after revision B becomes active.
- [x] Immutable artifact responses cannot mutate revision A bytes at revision A's hash.
- [x] Reload uses the existing `PluginHost` lifecycle and exact protocol version 1 handshake only; no arbitrary reload protocol or reload-specific wire contract is introduced.
- [x] Artifact replacement fully disposes the previous session before the new protocol version 1 session is established, using the shared theme, crash, reload, and teardown lifecycle.
- [x] Backend update atomicity, catalog reactivity, host remount, stale-port rejection, shared pending-call/error handling, unchanged-hash stability, failed-update preservation, and browser update tests pass with all earlier tracer tests.

## User stories addressed

- User story 9

## Implementor Notes

Use the existing private/system package update invariants rather than inventing a client-only update endpoint. The browser test must observe the update through the same shared `RyotClient` and `@ryot/client-sdk/react` query path used at initial load. The route loader seeds the catalog query with its initial result; the provider/session query auto-loads and refreshes on mount, focus, and catalog invalidation. Artifact replacement must call the same per-session runtime disposal used by crash recovery and unmount; it must not own a second port, dispatcher, listener, or pending-call teardown.

## Implementation Notes

- **Production update invariants were already sufficient.** Deterministic fixture revisions now drive the normal private upload and update route. Revision B compiles before the existing ingestion transaction inserts immutable B metadata and files and activates its hash; a failed client compilation leaves A's catalog row and artifact bytes unchanged. Successful updates retain the plugin and installation IDs. The plugin row stores only B's active hash, while A remains independently addressable and is retained indefinitely.
- **Catalog refresh stays on the shared client path.** The route loader uses its direct kernel `RyotClient` to load `PluginCatalogService` and returns the decoded catalog as initial data. The route passes that seed to `pluginCatalogQuery` created with `createRyotQuery` and reads it with `useRyotQuery` inside the one `RyotProvider` registry/cache. The shared query auto-loads and revalidates on mount and browser focus. While mounted, one credentialed EventSource calls `refetch` after its `connected` and user-scoped `catalog-invalidated` events; the browser owns reconnection, and route renders do not recreate the subscription. The backend emits standards-valid named SSE events with a `data:` field and shares one process-local catalog hub between HTTP streams and the Redis invalidation subscriber. A successful removal unmounts the host instead of retaining stale installation state.
- **Session identity is the remount trigger.** `PluginHost` keys `PluginFrame` by installation ID, package source hash, and client artifact hash. A change to either revision hash uses React unmount to send the normal `disposed` close, abort and clear pending query/operation work once, release A's listeners and port, and create exactly one fresh B iframe and protocol version 1 handshake at the current logical location.
- **Operation dispatch is revision-bound.** Each iframe bridge session captures its catalog source hash when the session opens; the value is not accepted from the iframe bridge message and cannot change during that session. The kernel adds the captured hash to its authenticated HTTP operation request. The backend resolves and validates that active revision while holding the existing ingestion advisory transaction lock, so A cannot resolve B's operation after activation. Stateless direct and integration calls may omit the revision and resolve the current active package. Already-authorized A work may finish on A's immutable script, and abort still cannot undo committed work.
- **Review corrections.** Review found the activation-to-poll race, stale installation fallback, and accidental breakage of stateless direct and integration callers. The revision guard and successful-removal behavior fixed those cases. A later review found that reading the latest source hash from an existing bridge session could silently pair A's client document with B's backend after a backend-only update; immutable session binding and source-revision remounting removed that behavior.
- **Security follow-up closed the CSS filesystem boundary.** Plugin stylesheet imports now resolve only to the compiler-owned `tailwindcss` entry or relative `.css` files present in that plugin's in-memory `client/**` source map. Absolute paths, traversal outside `client/**`, missing files, and unsupported bare imports fail with `RYOT_CLIENT_STYLES`; plugin-controlled CSS no longer uses Bun filesystem resolution and cannot copy readable server files into `plugin.css`.
- **Verification.** Contract, kernel backend, and kernel client checks, tests, and builds pass. The affected API end-to-end suites cover artifact, operation, private-plugin, and integration behavior. The Vitest-owned Chromium tracer installs revision A through the production archive and compiler path, drives authentication, query and operation bridges, theme changes, navigation, crash recovery, and then updates to revision B through the normal API. It verifies SSE-driven catalog refresh, iframe replacement, outer URL preservation, and plugin-local state reset without a test-only application path.
