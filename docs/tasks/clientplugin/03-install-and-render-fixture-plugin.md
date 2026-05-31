# Install and Render a Fixture Plugin

**Parent Plan:** [Web Client Plugin Tracer](./README.md)

**Status:** todo

## What to build

Deliver the first complete plugin-client path on top of the authenticated kernel from Task 02. An actual plugin source archive must declare a V1 client entry, include local TSX, CSS, and an asset, compile during server installation, expose immutable artifact metadata through RyotQL, and render its home at `/fixture` inside an isolated iframe. The kernel must not import the fixture application or its domain code.

Extend the canonical manifest and deterministic plugin archive with optional `client` metadata and `client/**` source. Keep backend-only plugins valid. Add `@ryot/client-plugin-compiler` as a browser compiler separate from `@ryot/sandbox-compiler`; use a fixed trusted module resolver, compile plugin-local Tailwind and CSS, reject unsupported external imports, and emit an independently loadable content-addressed artifact with exact V1 metadata. The package source hash and client artifact hash are distinct. The server owns compiler process limits and runs compilation during the same installation path used by the fixture.

Persist enough immutable artifact data to serve an active installation by artifact hash with correct content types and immutable caching. Resolve the design's open iframe-origin, sandbox, CSP, and physical artifact-layout choices with the smallest implementation that preserves the stated isolation invariants, and record the chosen mechanism in the architecture document. Plugin code must have no kernel DOM access and no Ryot credentials.

Create only the minimum `@ryot/client-plugin-sdk` runtime and `@ryot/client-ui-sdk` primitive needed for the fixture home. The SDK must support `defineClientPlugin`, exact metadata validation, runtime bootstrap, and a ready handshake over a kernel-created `MessageChannel`. The kernel reads an application-owned named RyotQL catalog recipe with a colocated schema and decoder, resolves `/fixture` to an installation-aware target, loads the exact artifact in `PluginHost`, transfers the port only to the intended top-level document, and renders the fixture home.

The fixture must use the same archive reader, compiler, persistence, artifact serving, RyotQL, route resolution, SDK, and iframe host intended for third-party plugins. A direct static import, development-only artifact URL, hardcoded catalog row, or alternate test runtime does not satisfy this task.

## Acceptance criteria

- [ ] The manifest schema supports an optional client entry with exact API version and declared capabilities while backend-only manifests remain valid.
- [ ] Deterministic plugin archives accept canonical `client/**` source and assets, reject unsafe paths and unsupported entries, enforce suitable source/archive limits, and preserve existing backend entries.
- [ ] The CLI includes declared client source without trusting or installing the plugin's `package.json` dependencies.
- [ ] `@ryot/client-plugin-compiler` compiles fixture TSX, plugin-local relative imports, Tailwind, custom CSS, and an asset into an independently loadable browser artifact.
- [ ] The compiler resolves only approved React and Ryot SDK imports, rejects an arbitrary external package, does not broaden `@ryot/sandbox-compiler`, and runs through a bounded server-owned compiler process.
- [ ] Identical source and compiler inputs produce the same artifact identity; changing client source changes the artifact hash independently of persisted installation identity.
- [ ] Installation fails atomically with typed diagnostics when client compilation fails and does not activate a partial client artifact.
- [ ] Active artifact files are served with correct content types, immutable cache semantics, and an identity the kernel can verify.
- [ ] An application-owned named RyotQL recipe and colocated decoder return plugin ID, installation ID, slug, health, disabled state, package source hash, artifact hash, client API version, and capabilities for the authenticated user.
- [ ] `/fixture` resolves through TanStack Router and the explicit kernel route resolver to the authenticated user's exact fixture installation.
- [ ] `PluginHost` loads the catalog-selected artifact in an isolated iframe that cannot access the kernel DOM or Ryot credentials.
- [ ] The kernel transfers a `MessagePort` to the intended top-level plugin document, validates exact V1 markers, and receives a ready signal before presenting the plugin as loaded.
- [ ] The fixture exports through `defineClientPlugin`, uses at least one minimal client UI SDK primitive, and visibly renders its home without a kernel import of fixture UI code.
- [ ] Loading, missing-artifact, compilation-failure, handshake-failure, and unexpected-version states have stable kernel-owned presentation without exposing internal diagnostics.
- [ ] Contract, archive, compiler, backend installation/serving, RyotQL decoding, route-resolution, bridge-bootstrap, isolation, and browser rendering tests cover the production path; all affected checks, tests, and builds pass.
- [ ] The architecture document records the artifact layout, serving/origin mechanism, sandbox flags, and CSP decisions selected by this implementation without adding compatibility alternatives.

## User stories addressed

- User story 3
- User story 4

## Implementor Notes

This is intentionally the largest slice because it establishes the first demoable source-to-iframe path. Keep APIs narrow: Task 04 adds navigation, Task 05 adds authenticated calls, and Task 06 adds live theme events.
