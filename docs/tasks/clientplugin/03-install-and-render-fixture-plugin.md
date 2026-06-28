# Install and Render a Fixture Plugin

**Parent Plan:** [Web Client Plugin Tracer](./README.md)

**Status:** done

## What to build

Deliver the first complete plugin-client path on top of the authenticated kernel from Task 02. An actual plugin source archive must declare a client API version 1 entry, include local TSX, CSS, and an asset, compile during server installation, expose immutable artifact metadata through RyotQL, and render its home at `/fixture` inside an isolated iframe. The kernel must not import the fixture application or its domain code.

Extend the canonical manifest and deterministic plugin archive with optional `client` metadata and `client/**` source. Keep backend-only plugins valid. Add `@ryot/client-plugin-compiler` as a browser compiler engine separate from `@ryot/sandbox-compiler`; use a fixed trusted module resolver, compile plugin-local Tailwind and CSS, reject unsupported external imports, and emit an independently loadable content-addressed artifact with exact client, artifact, compiler, and bridge protocol V2 metadata. The package source hash and client artifact hash are distinct. The server owns shared compiler process supervision and runs compilation during the same installation path used by the fixture.

Compiler production dependencies remain package-owned. The production image installs the dependencies for both compiler packages through a filtered runtime stage and does not install dependency declarations from uploaded plugins. It carries `sandbox-compiler-worker.js*` and `client-plugin-compiler-worker.js*`; the image smoke command invokes both workers by absolute path and succeeds only when both smoke compilations succeed.

Persist enough immutable artifact data to serve an active installation by artifact hash with correct content types and immutable caching. Resolve the design's open iframe-origin, sandbox, CSP, and physical artifact-layout choices with the smallest implementation that preserves the stated isolation invariants, and record the chosen mechanism in the architecture document. Plugin code must have no kernel DOM access and no Ryot credentials.

Create only the minimum `@ryot/client-sdk/plugin` runtime and `@ryot/client-ui-sdk` primitive needed for the fixture home. The plugin surface must support `defineClientPlugin`, exact metadata validation, runtime bootstrap, and a ready handshake over a kernel-created `MessageChannel`. The kernel reads an application-owned named RyotQL catalog recipe with a colocated schema and local decoder, resolves `/fixture` to an installation-aware target, loads the exact artifact in `PluginHost`, transfers the port only to the intended top-level document, and renders the fixture home.

The fixture must use the same archive reader, compiler, persistence, artifact serving, RyotQL, route resolution, SDK, and iframe host intended for third-party plugins. A direct static import, development-only artifact URL, hardcoded catalog row, or alternate test runtime does not satisfy this task.

## Acceptance criteria

- [x] The manifest schema supports an optional client entry with exact API version and declared capabilities while backend-only manifests remain valid.
- [x] Deterministic plugin archives accept canonical `client/**` source and assets, reject unsafe paths and unsupported entries, enforce suitable source/archive limits, and preserve existing backend entries.
- [x] The CLI includes declared client source without trusting or installing the plugin's `package.json` dependencies.
- [x] `@ryot/client-plugin-compiler` compiles fixture TSX, plugin-local relative imports, Tailwind, custom CSS, and an asset into an independently loadable browser artifact.
- [x] The compiler resolves only approved React and Ryot SDK imports, rejects an arbitrary external package, does not broaden `@ryot/sandbox-compiler`, and runs through shared bounded server-owned compiler process supervision.
- [x] Identical source and compiler inputs produce the same artifact identity; changing client source changes the artifact hash independently of persisted installation identity.
- [x] Installation fails atomically with typed diagnostics when client compilation fails and does not activate a partial client artifact.
- [x] Active artifact files are served with correct content types, immutable cache semantics, and an identity the kernel can verify.
- [x] An application-owned named RyotQL recipe and colocated decoder return plugin ID, installation ID, slug, health, disabled state, package source hash, artifact hash, client API version, and capabilities for the authenticated user.
- [x] `/fixture` resolves through TanStack Router and the explicit kernel route resolver to the authenticated user's exact fixture installation.
- [x] `PluginHost` loads the catalog-selected artifact in an isolated iframe that cannot access the kernel DOM or Ryot credentials.
- [x] The kernel transfers a `MessagePort` to the intended top-level plugin document, validates exact markers including bridge protocol V2, and receives a ready signal before presenting the plugin as loaded.
- [x] The fixture exports through `defineClientPlugin`, uses at least one minimal client UI SDK primitive, and visibly renders its home without a kernel import of fixture UI code.
- [x] Loading, missing-artifact, compilation-failure, handshake-failure, and unexpected-version states have stable kernel-owned presentation without exposing internal diagnostics.
- [ ] The production image contains both compiler worker artifacts, and its image smoke compilation succeeds for both absolute worker paths.
- [x] Contract, archive, compiler, backend installation/serving, RyotQL decoding, route-resolution, bridge-bootstrap, isolation, and browser rendering tests cover the production path; all affected checks, tests, and builds pass.
- [x] The architecture document records the artifact layout, serving/origin mechanism, sandbox flags, and CSP decisions selected by this implementation without adding compatibility alternatives.

## User stories addressed

- User story 3
- User story 4

## Implementor Notes

This is intentionally the largest slice because it establishes the first demoable source-to-iframe path. Keep APIs narrow: Task 04 adds navigation, Task 05 adds authenticated calls, and Task 06 adds live theme events.

## Implementation Notes

- **Artifact layout.** Multi-file with flat single-segment names: `index.html`, `plugin.js`, `plugin.css`, and content-hashed assets such as `asset-<hash8>.svg`. `index.html` references the others relatively, so the artifact loads from any prefix without rewriting. The hash covers `plugin.js`, `plugin.css`, and assets but never `index.html`, which carries the resulting hash.
- **Serving and origin.** Files are served from the public content-addressed route `GET /api/plugins/artifacts/:artifactHash/:fileName`, wired as `PluginArtifactsRoutesLive` next to `LocalUploadsRoutesLive` in `kernel/backend/src/boot/server.ts`. The route deliberately carries no auth middleware: the sha256 path is unguessable, and keeping it credential-free is what lets the sandboxed document load without ever holding a Ryot credential. Responses set `x-content-type-options: nosniff`, `cache-control: public, max-age=31536000, immutable`, and `etag: "<artifactHash>"`; `index.html` additionally carries `content-security-policy: sandbox allow-scripts` as defence in depth. An unknown hash or file name is a 404.
- **Sandbox flags.** `PluginHost` renders `<iframe sandbox="allow-scripts" referrerPolicy="no-referrer">`. Omitting `allow-same-origin` gives the plugin document an opaque origin, so plugin code has no kernel DOM access, no same-origin storage, and no readable credentials. These layout, serving, sandbox, and CSP decisions are recorded in `docs/ryot-client-plugin-design.md`.
- **Shared compiler-worker supervision.** `@ryot/client-plugin-compiler` stays a separate engine from `@ryot/sandbox-compiler` — different resolver, output model, and public API — but both run through one server-owned supervision boundary, `kernel/backend/src/lib/infrastructure/compiler-worker/runner.ts`. `ClientPluginCompiler` supplies only its own limits and typed failure decoding on top of that runner, so semaphore concurrency, timeout, and memory supervision have exactly one implementation. Compilation runs inside `compilePluginPackage` before any persistence, so a failure surfaces as the existing `compilation-failed` reason with `phase: "compile"` diagnostics and no partial artifact activates.
- **Embedded-metadata identity.** The compiler emits `index.html` last and embeds the artifact hash and exact client markers, including bridge protocol V2, as JSON in the `ryot-client-artifact` element. `bootstrapClientPlugin` reads exactly that element, refuses to register a `message` listener at all when it is absent or malformed, and rejects an init whose `artifactHash` does not match it. `PluginBridgeReady` reports those embedded values rather than echoing the kernel's init, so the kernel-side comparison reads a value that originated in the artifact. Plugin source never declares, derives, or passes its own artifact identity.
- **Private-install fixture path.** `plugins/fixture` is a real workspace package built by `ryot plugin build` and deliberately absent from `apps/server/shipped-plugins.json`. `tests/src/tests/kernel/plugins/client-artifact.test.ts` uploads the CLI-built archive through the real private-install path, polls for a ready installation, reads the catalog through `/ryotql/execute`, and fetches the served files. Nothing on the fixture path is reachable only from tests.
- **Closed in Task 04: the kernel side of the handshake.** This slice shipped with criterion 12 unticked because `plugin-host.test.tsx` never fired a `load`, and the planned fix — joining `PluginHost` to the real SDK runtime over a real `MessageChannel` — is impossible in jsdom, whose `window.postMessage` ignores the transfer list so the port never reaches the peer. Task 04 extracted the handshake into the transport-agnostic `kernel/client/src/modules/plugins/bridge.ts`, which takes a `postMessage`-capable target instead of reading `iframe.contentWindow`, and `bridge.test.ts` now drives port transfer, ready validation against the initiating session and artifact hash, the handshake timeout, teardown, and the loading-to-ready transition over a real `MessageChannel`. Criterion 12 is ticked as of that task; the exact protocol V2 messages were not changed.
- **Known gap: the production image is unverified.** The Dockerfile copies both `sandbox-compiler-worker.js*` and `client-plugin-compiler-worker.js*` and the smoke command invokes both by absolute path, but the image build is currently broken for an unrelated reason (the `FIXME` at `Dockerfile:1` — Effect needs upgrading to rc.113). Criterion 15 stays unticked until the image builds and both smoke compilations are observed to pass.
- **Seams left for Task 06.** The artifact carries the `@theme inline` mapping from `--color-*` to `--bg`, `--accent`, and the rest, but the raw palette lives in `kernel/client/src/styles/palette.css` and is not part of the artifact, so the fixture iframe renders largely uncoloured today; that is the intended seam for Task 06's resolved token snapshot. Separately, the iframe stays hidden until the handshake completes, so the plugin's React tree mounts at 0x0 — harmless now, but it is the same moment Task 06 must use to apply initial theme values before revealing plugin content.
- **Verified with** `bun turbo --filter=@ryot/contract --filter=@ryot/plugin-archive --filter=@ryot/cli --filter=@ryot/client-sdk check test`, `bun turbo --filter=@ryot/kernel-backend check test`, and `bun turbo --filter=@ryot/kernel-client check test build`.
