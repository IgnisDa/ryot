# Ryot Client Plugin Architecture

**Status:** Accepted design; shared TypeScript compiler infrastructure implemented
**Scope:** Ryot client kernel, client-side plugin runtime, shared client SDK, client UI SDK, web/native packaging, routing, and native capability boundaries.

## 1. Summary

Ryot's client is a web-first plugin host.

The application kernel is a React DOM application. On the web it runs directly in the browser. On iOS and Android it runs inside a Capacitor host using the platform WebView. The kernel owns authentication, global routing, settings, saved views, application navigation, plugin lifecycle, authenticated transport, client persistence primitives, and access to native operating-system features.

Each plugin can contribute a client application written in React DOM. Plugin applications are compiled independently and run inside isolated iframes owned by the kernel. Built-in plugins such as Media and Fitness use exactly the same client plugin mechanism as third-party plugins.

Plugins own domain-specific UI and behavior. The kernel must remain domain-agnostic.

At a high level:

```text
Web
────────────────────────────────────────────────────────

Browser
  │
  └── Ryot kernel — React DOM
        │
        ├── kernel screens
        └── plugin iframe — React DOM


iOS / Android
────────────────────────────────────────────────────────

Native application
  │
  └── Capacitor
        │
        └── WKWebView / Android WebView
              │
              └── Ryot kernel — React DOM
                    │
                    ├── kernel screens
                    └── plugin iframe — React DOM
                          │
                           └── @ryot/client-sdk/plugin

Kernel JavaScript
  │
  └── Capacitor / first-party native plugins
        │
        └── OS capabilities
```

There is no React Native shell and no requirement for plugin UI to use native UI components.

---

## 2. Design principles

### 2.1 The kernel is domain-agnostic

The kernel must not contain concepts such as:

```text
Movie
Show
Workout
Exercise
Set
Book
Recipe
```

Those belong to plugins.

The kernel instead owns general concepts such as:

```text
plugin
installation
entity
saved view
route
storage
navigation
file
notification
haptic
live activity
theme
authenticated request
```

A native capability must remain generic. For example:

```ts
ryot.liveActivity.start(...)
ryot.notifications.schedule(...)
ryot.storage.set(...)
```

are appropriate kernel APIs.

These are not:

```ts
ryot.sessions.startWorkout(...)
ryot.media.markWatched(...)
ryot.fitness.completeSet(...)
```

Plugins compose generic kernel primitives to implement their own domain behavior.

### 2.2 Built-in plugins dogfood the third-party architecture

Media and Fitness must compile, load, route, render, and communicate with the kernel through the same mechanisms available to third-party plugins.

There must not be a privileged client rendering path for system plugins.

### 2.3 Plugin functionality owns whole application surfaces

Arbitrary plugin UI is expected to occupy complete content screens rather than being deeply interleaved with kernel-rendered components.

This makes an iframe boundary appropriate.

Kernel-owned examples:

- authentication
- global application navigation
- sidebar / workspace switcher
- settings
- saved-view renderer
- collections and other generic kernel surfaces
- plugin management

Plugin-owned examples:

- workspace home
- entity detail pages
- plugin-specific workflows
- arbitrary plugin routes

### 2.4 One global navigation history

The kernel is the only owner of the real browser history.

Plugin iframes do not maintain an independent browser navigation history. They receive their logical location from the kernel and use in-memory routing internally.

This gives one authoritative navigation stack across:

- browser Back and Forward
- Android Back
- iOS back gestures where enabled
- deep links
- universal links / app links
- plugin navigation
- sidebar navigation
- workspace switching

### 2.5 The browser platform is part of the plugin runtime

Plugin code is ordinary React DOM code.

Plugins can directly use normal browser UI facilities such as:

- HTML and CSS
- CSS transitions and animations
- View Transitions
- Pointer Events
- Canvas and SVG
- ResizeObserver
- IntersectionObserver
- Web Audio where appropriate
- other supported web-platform APIs

Ryot should not recreate browser capabilities inside the client SDK.

The SDK exists for Ryot/kernel/native functionality that is not simply normal browser functionality.

---

## 3. Client technology stack

### Kernel

The target kernel stack is:

```text
React DOM
TanStack Router
Effect
@effect/atom-react
Tailwind CSS
TanStack Form
TanStack Table
TanStack Hotkeys
TanStack Charts
Capacitor on iOS and Android
```

TanStack Query is not part of the architecture. Ryot already uses Effect and `@effect/atom-react` for asynchronous and reactive application state.

Application I/O and workflows are Effect services. Browser storage, transport, and third-party clients belong in live layers composed into one client `ManagedRuntime` at startup. TanStack Router receives that runtime through route context; routes resolve services and adapt their effects to React navigation and display state. Presentational components receive focused operations through props.

Tests replace service dependencies with deterministic layers and use plain recording functions for component operations. They do not replace application modules, globals, hooks, or injected operations with test-framework mocks or spies.

TanStack Router replaces React Router and Expo Router in the new client architecture.

TanStack Start is not required. Ryot already has an independent backend and does not need a React server framework for the main client.

### Greenfield replacement

The React DOM kernel is a greenfield replacement for the existing Expo / React Native client.

Before implementation begins, the existing `kernel/client` application moves unchanged under `crates/` as temporary reference code. A new TanStack Router React DOM application is then created at `kernel/client`.

Existing functionality is ported into the architecture in this document rather than preserved through adapters. There is no compatibility layer between the Expo client and the new kernel, no shared rendering path, and no migration requirement for client state or production user data.

The reference applications under `crates/` remain read-only and outside the client plugin tracer scope.

### Plugin applications

The supported V1 client authoring environment is intentionally narrow:

```text
React
React DOM
TypeScript / TSX
Tailwind CSS
clsx
@ryot/client-sdk
@ryot/client-sdk/react
@ryot/client-sdk/plugin
@ryot/client-sdk/effect
@ryot/client-ui-sdk
browser APIs
```

Other frameworks such as Vue or Svelte are not supported in V1.

---

## 4. Plugin client source model

A plugin may define a client entry in its manifest.

Conceptually:

```ts
client: {
  entry: "client/index.tsx",
  apiVersion: 1,
}
```

The client shape is exact. `entry` is a relative POSIX path under `client/`, ends in `.ts` or `.tsx`, and has no `./` prefix. There is no client capabilities field until a real capability is implemented and enforced.

At installation, the client compiler semantically checks every archived non-test client `.ts`/`.tsx` file, including files outside the bundle graph. `.test.` and `.spec.` sources are excluded from this check. The check uses exact compiler-owned declarations for React, React DOM, `clsx`, and the published Ryot client SDK and UI SDK entry points. Type errors are fatal and are returned as normalized TypeScript diagnostics with archive-relative file names. This semantic check validates authoring types; it is not a security boundary.

A plugin without client UI may omit the client entry.

A client plugin conceptually bootstraps with:

```ts
bootstrapClientPlugin({
	home: HomePage,

	routes: [
		// plugin-private routes
	],
});
```

The exact public API may evolve during implementation, but the contribution model is fixed:

1. workspace home
2. entity renderers
3. plugin-private routes

Additional kernel extension points must be added deliberately in response to concrete requirements. V1 must not introduce a general-purpose arbitrary slot-injection system for settings, headers, sidebars, dialogs, or other kernel internals.

---

## 5. No arbitrary third-party dependency installation

Ryot does **not** execute `bun install` for uploaded plugin source.

The server-side client compiler works against a fixed, trusted module universe controlled by Ryot.

Initially, valid external module imports are limited to approximately:

```text
react
react-dom
react-dom/client
react/jsx-runtime
clsx

@ryot/client-sdk
@ryot/client-sdk/react
@ryot/client-sdk/plugin
@ryot/client-sdk/effect
@ryot/client-sdk/ryotql

@ryot/client-ui-sdk
```

Plugin-local relative imports are also allowed.

An import such as:

```ts
import something from "arbitrary-npm-package";
```

must fail compilation unless that package has explicitly become part of the supported Ryot plugin environment.

A plugin's `package.json` may exist for the author's local development environment, but the Ryot compiler does not trust or install its dependency declarations.

This mirrors the backend sandbox philosophy: plugin execution is compiled against a deliberately bounded runtime rather than an arbitrary package ecosystem.

The uploaded plugin source archive contains the canonical manifest plus the backend and client sources declared by that manifest:

```text
manifest.json
backend/**
client/**
```

Client-local CSS and supported assets live under `client/**`. The source archive remains distinct from the compiled client artifact.

The Outfit and Lora files used by the Ryot design system are compiler-owned dependencies, not plugin source files. The compiler adds its own copy of those fonts to every client artifact.

The canonical client file policy is deliberately narrow:

- text sources use the exact extensions `.ts`, `.tsx`, and `.css`
- binary assets use the exact lowercase extensions `.svg`, `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.avif`, `.ico`, `.woff2`, and `.wasm`

The server/compiler derives an asset's MIME type from its extension; plugins do not supply one. Archive entries preserve their exact raw bytes. `backend/**` and client text sources require fatal UTF-8 validation, while client assets are never decoded as text. Archive limits are 1,024 entries, 256-byte paths, a 4 MiB manifest, 256 KiB per non-manifest entry, 16 MiB total uncompressed bytes, and 8 MiB compressed bytes.

There is no alternate compatibility representation for client files.

---

## 6. Bun client compiler

Bun is the client bundler/compiler.

Client compilation is owned by `@ryot/client-plugin-compiler`. Generic TypeScript infrastructure is owned by the private `@ryot/typescript-compiler` package, which shares TypeScript 7 native compiler resolution, virtual project lifecycle, diagnostic collection, and diagnostic normalization between the client and backend compilers.

`@ryot/client-plugin-compiler` and `@ryot/sandbox-compiler` remain separate compiler engines. They have independent import policies, limits, protocols, output models, and public APIs. The engines do not call or adapt to one another and have no shared execution mode, compiler bridge, or fallback. They share only the generic TypeScript infrastructure and the server-owned process-supervision boundary.

Both compiler engines use the same server-owned process supervision boundary for child-process lifecycle, bounded concurrency, timeouts, process-tree memory sampling, and termination. Their compiler packages own their production dependencies and compiler-specific contracts; the production image installs those dependencies through filters for both compiler packages rather than from uploaded plugin manifests.

The server runs the client compiler during plugin installation and update. The plugin source archive has a package source hash; the emitted client artifact has a separate artifact hash.

The compiler:

1. validates the client entry, client file policy, and raw-byte limits
2. rejects unsupported external imports
3. resolves approved SDK imports to Ryot-controlled implementations
4. bundles only `manifest.client.entry` and its reachable module graph
5. semantically checks every archived non-test client `.ts`/`.tsx` file against compiler-owned trusted types
6. compiles Tailwind by scanning all archived client `.ts`/`.tsx` files
7. adds the compiler-owned Ryot fonts
8. emits the plugin client artifact
9. content-addresses the resulting artifact

Bun import, asset, and CSS validation, together with runtime schemas, remains authoritative for plugin boundaries. Semantic typing is not a security boundary. Backend semantic checking continues to use manifest-declared sandbox entries and their reachable module graph.

Conceptually:

```text
plugin source
    │
    ├── local TS / TSX
    ├── local CSS / supported binary assets
    └── imports from approved Ryot SDKs
          │
          ▼
@ryot/client-plugin-compiler
          │
          ├── trusted module resolver
          ├── semantic checker
          │     └── @ryot/typescript-compiler
          ├── Tailwind compilation
          ├── Outfit and Lora font assets
          └── Bun browser build
          │
          ▼
content-addressed client artifact
```

The compiler operates on raw `Uint8Array` file contents. It enforces a 512 KiB limit over all `client/**` input bytes, a 256 KiB limit per asset, and an 8 MiB limit over the emitted artifact. Asset names are `asset-<sha256>.<ext>`, where the SHA-256 is computed from the exact asset bytes. A TS/TSX import emits a `./asset-<sha256>.<ext>` URL, and CSS references use the same name, so the same asset is emitted only once.

The compiler also owns pinned `@fontsource-variable/outfit` and `@fontsource-variable/lora` dependencies matching the kernel. It reads their default normal-variable stylesheets, preserves their Unicode subsets and weight ranges, rewrites their local font URLs to content-addressed artifact names, and includes the resulting CSS and `.woff2` files in every artifact. Compiler-owned fonts count toward the emitted artifact limit, but not toward plugin source or per-asset input limits.

The JSON worker protocol encodes file and artifact bytes as strict canonical padded Base64 only for transport. It decodes them back to raw bytes before compilation and encodes results the same way; Base64 is not a source, persistence, or compatibility representation.

The compiler owns the effective versions of:

- React
- React DOM
- Tailwind
- clsx
- client SDK
- client UI SDK
- UI implementation dependencies
- Outfit and Lora variable fonts

Plugins do not negotiate these dependencies with the running kernel.

Because each plugin runs in its own iframe, it is acceptable for each compiled artifact to contain its own React runtime.

The production image carries two compiler worker artifacts:

```text
dist/sandbox-compiler-worker.js*
dist/client-plugin-compiler-worker.js*
```

The image build invokes `dist/smoke-compiler-workers.js` with the absolute path to each worker. Image assembly continues only after both workers complete successful smoke compilation.

---

## 7. Client artifact

The client artifact is a complete web application loaded through a private artifact session.

The artifact is a flat set of files with unique single-segment names: `index.html`, `plugin.js`, `plugin.css`, and content-hashed assets named `asset-<sha256>.<ext>`. Identical assets with the same extension share one emitted file. Every artifact contains its own Outfit and Lora `.woff2` files; there is no shared kernel font fallback or public font-asset dependency. `index.html` references the other files with relative URLs (`./plugin.js`, `./plugin.css`, `./asset-<hash>.<ext>`).

The important invariants are:

- the artifact is immutable
- the artifact is content-addressed
- artifact storage is multi-file, binary-safe, and append-only
- the kernel can verify its identity
- a client-output change produces a new artifact
- a live plugin document is not mutated underneath a running React tree

The package source revision and client artifact are both fixed for the lifetime of a bridge session. When either identity changes, the kernel force-reloads any mounted iframe for that installation. An old client document must not continue calling a newer backend plugin revision, including when a backend-only update leaves the compiled client artifact unchanged. For every operation, the kernel attaches the session's expected package source hash to the authenticated backend request. The backend compares it with the active revision while holding the plugin-ingestion lock and refuses a mismatch before selecting a script for execution. The stale-revision conflict remains internal to the kernel: it closes the bridge, refreshes the catalog, and replaces the iframe without delivering an ordinary operation outcome to the plugin.

Artifact persistence is append-only. `plugin_client_artifact` stores metadata keyed by artifact hash, and `plugin_client_artifact_file` stores files keyed by `(artifact_hash, name)`. The plugin row stores only the nullable hash of its active client artifact. Installing or updating inserts an artifact before activating its hash and never updates an existing artifact record. Historical artifacts remain immutable storage records, but hashes alone cannot retrieve them; file access requires a valid current session for the exact installation, source revision, and artifact. Storage retention is separate from retrieval authorization.

`plugin_source_file.contents` and `plugin_client_artifact_file.contents` are PostgreSQL `bytea` values containing the original or emitted raw bytes. JSON worker, backup, and test-support boundaries use strict canonical padded Base64 only as transport encoding; neither database persistence nor the archive has a parallel string representation. Source identity is SHA-256-based over the manifest and per-file content hashes. Artifact identity is SHA-256-based over its metadata and each emitted file's name, content type, and content hash.

### Artifact identity is embedded, never authored

The artifact hash covers the compiled bundle, stylesheet, and assets, so it cannot exist inside them. The compiler emits `index.html` last, embedding the artifact hash and the exact client markers, including bridge protocol version 1, as JSON in a `<script type="application/json" id="ryot-client-artifact">` element.

`bootstrapClientPlugin` reads that element and refuses to accept a bridge port when it is absent or malformed. Plugin source therefore never declares, derives, or passes its own artifact identity, and the kernel, the compiler, and the running plugin compare the same embedded values.

### Private plugin artifact sessions

Artifact bytes are available only through an authenticated private session. The kernel creates one with `POST /plugins/:pluginSlug/installations/:installationId/client-artifact-sessions`, supplying the expected source and artifact hashes. The server checks the caller's ownership of that exact installation, the plugin slug and installation ID, and the active current source revision, artifact, installation state, and client versions before issuing the session.

The response contains an opaque session ID and a 32-byte random bearer token. Only the token's SHA-256 hash is stored in Redis, with a 15-minute TTL. Authenticated renewal refreshes that lease only while the exact current revision remains valid; authenticated revocation deletes it. A source or artifact revision change therefore invalidates the old session, and the old or historical artifact cannot be fetched with its hash or with a session for another revision.

The token file route is `GET /plugin-artifact-sessions/:token/:fileName`. It hashes the bearer token, loads the Redis session, and performs the exact current installation/source/artifact check again before returning the selected raw bytes. Possession of the token authorizes only that exact artifact and file, not another artifact or any bridge capability. The response uses the file MIME type, `x-content-type-options: nosniff`, `cache-control: no-store`, `referrer-policy: no-referrer`, and wildcard non-credentialed CORS; the wildcard policy is required because the sandboxed iframe has the opaque `null` origin. HTML also carries `content-security-policy: sandbox allow-scripts`.

The token must not be logged, placed in a referrer, or sent across the bridge. Reverse proxies must redact the token-bearing path segment from access logs and tracing and must not cache these responses. This protects artifact delivery, not code confidentiality: an authorized user can inspect the compiled code, and compiled artifacts must not contain secrets.

`PluginHost` creates the session before assigning the token URL to the iframe, renews it before expiry, and revokes it on unmount, crash, reload, or replacement. Route changes reuse the session. A change to the installation, source revision, or artifact closes the bridge, revokes the old session, and creates a new exact session before mounting the replacement. End-to-end, authenticated session creation, exact current-record lookup, hash-only Redis authorization, and exact file lookup are all required before bytes are returned.

---

## 8. Styling and Tailwind

Each plugin is its own Tailwind compilation boundary.

The kernel does not need to know third-party Tailwind class names at kernel build time.

Example plugin source:

```tsx
export function WorkoutPage() {
	return <div className="grid gap-4 rounded-xl bg-surface p-6 lg:grid-cols-2">...</div>;
}
```

The plugin compiler scans all archived client `.ts`/`.tsx` sources and emits the CSS required by that plugin.

The resulting structure is:

```text
kernel document
  └── kernel CSS

Media iframe
  └── Media CSS

Fitness iframe
  └── Fitness CSS

Third-party iframe
  └── that plugin's CSS
```

CSS classes from unrelated plugins cannot collide because they live in different documents.

### Theme

Ryot design-system values are represented as semantic tokens and CSS variables.

Examples:

```text
bg-bg
bg-surface
text-text
text-text-muted
border-border
text-accent
font-ui
font-display
```

The kernel supplies the current theme to the plugin runtime. The plugin runtime applies corresponding CSS variables inside the iframe.

The font-family tokens name the compiler-owned `Outfit Variable` and `Lora Variable` faces. Their `@font-face` declarations and content-addressed files are emitted into every plugin artifact, because an iframe cannot inherit the kernel document's font declarations. Font availability therefore does not depend on device-installed fonts or kernel CSS.

Theme changes do not require recompiling a plugin.

### Custom CSS

Plugins may use custom CSS in addition to Tailwind.

Plugin CSS resolution is virtual and package-local. A stylesheet may import the compiler-owned
`tailwindcss` entry and relative `.css` files present in the same plugin's `client/**` source map.
Absolute paths, traversal outside `client/**`, missing source-map files, and other bare package
imports are rejected. Plugin-controlled CSS resolution never falls back to the compiler server's
filesystem.

They may also use normal web-platform animation, View Transitions, SVG, Canvas, and other browser technologies.

Relative `url(...)` references to local assets are resolved against the CSS file that contains them, including CSS files reached through nested relative imports, and are rewritten to the corresponding `./asset-<sha256>.<ext>` URL. References from JavaScript and CSS to the same asset are deduplicated. External-scheme URLs, protocol-relative URLs, data URLs, and fragment URLs remain unchanged. Root-relative URLs, traversal outside `client/**`, missing local assets, and unsupported local asset extensions fail compilation.

### Dynamic Tailwind classes

Normal Tailwind static-analysis rules apply. Plugins must not assume that arbitrary runtime-generated class strings will be emitted unless supported by the compiler.

---

## 9. `@ryot/client-ui-sdk`

`@ryot/client-ui-sdk` is the supported React UI platform for plugins. It remains separate from `@ryot/client-sdk`.

It is also suitable for use by the kernel so that kernel screens and plugin screens share the same DOM-based design-system implementation.

It should provide Ryot-owned APIs rather than blindly re-exporting third-party libraries.

Examples:

```ts
import { Button, Card, Dialog, Input, Select, Tabs } from "@ryot/client-ui-sdk";

import { DataTable } from "@ryot/client-ui-sdk/table";

import { LineChart, BarChart } from "@ryot/client-ui-sdk/charts";

import { SwipeActions, ReorderableList } from "@ryot/client-ui-sdk/gestures";
```

Internally the SDK may use:

- TanStack Form
- TanStack Table
- TanStack Hotkeys
- TanStack Charts
- gesture / animation libraries
- other trusted Ryot client dependencies

Those implementation dependencies are not themselves part of the plugin ABI.

For example, the chart API should remain a Ryot chart API even if its internal implementation is TanStack Charts.

---

## 10. `@ryot/client-sdk`

`@ryot/client-sdk` is the shared, environment-neutral client contract between the Ryot kernel and plugin JavaScript.

`RyotClient` is a framework-neutral Promise capability. It exposes semantic capability APIs, not kernel implementation details. Hosts construct it with an explicit adapter and pass the client to consumers through the provider/client boundary. It does not bind a global mutable bridge.

The package has four public surfaces:

- `@ryot/client-sdk` — the shared client contract and `RyotClient`
- `@ryot/client-sdk/react` — React integration, including `RyotProvider`, `useRyot`, `createRyotQuery`, `useRyotQuery`, `createRyotMutation`, and `useRyotMutation`
- `@ryot/client-sdk/plugin` — the plugin runtime adapter plus plugin React routing conveniences
- `@ryot/client-sdk/effect` — the supported schema surface

The kernel supplies a direct adapter to kernel services. The plugin runtime supplies a `MessageChannel` adapter. Both use the same environment-neutral client contract.

The React integration is backed internally by `@effect/atom-react`. Each `RyotProvider` owns one `RegistryProvider`, and therefore one atom registry and query/mutation cache for that provider/session. Query definitions use `Atom.family`; query atoms use SWR revalidation on mount when unhydrated and on browser focus, with a five-minute idle TTL. Initial data hydrates a query without a duplicate mount request. These implementation details remain local to the React surface and are not part of the client or bridge ABI. There is no compatibility or manual plugin-request-state path.

Each mounted plugin document has exactly one per-session client plugin runtime. That runtime owns the session `MessagePort`, its lifecycle state, one message dispatcher, logical location, pending query and operation calls, all session listeners, the bridge-backed `RyotClient`, and disposal. Theme synchronization and fatal reporting use this runtime; they do not create separate bridge clients or listener/teardown paths.

Initial categories should be approximately:

```text
data
operations
navigation
storage
assets
feedback
files
notifications
audio
screen
liveActivity
system
theme
```

Runtime lifecycle is internal session machinery, not a public client category. Additional public capability methods should be added incrementally without changing the shared client or React query/mutation surface.

The canonical client taxonomy is:

```ts
await ryot.data.query(recipe);
await ryot.operations.invoke({ slug, input, output });
ryot.navigation.push({ path: "/workouts/456" });
ryot.navigation.replace({ path: "/workouts/456" });
```

### Current data and operations API

The client starts with data, operations, and navigation categories. An explicit client value is shown as `ryot` here:

```ts
import { Schema } from "@ryot/client-sdk/effect";

import { useRyot } from "@ryot/client-sdk/react";

const ryot = useRyot();
const Greeting = Schema.Struct({ greeting: Schema.String });

const { greeting } = await ryot.operations.invoke({
	slug: "greet",
	input: { name },
	output: Greeting,
});
```

The shared query API is recipe-based:

```ts
const result = await ryot.data.query(recipe, { signal });
```

The recipe owns its query document and result decoder. The client executes the document and decodes the result locally; consumers do not parse generic `RowItem` values directly. A decoder failure result or thrown decoder exception becomes `malformed-result` and never escapes the SDK as an arbitrary error. Query requests accept an optional `AbortSignal` and use the existing user-scoped backend authorization behavior rather than a client-specific bypass. The direct kernel adapter and plugin bridge use one kernel-owned classifier so declared query failures have the same public reason in both environments.

The React query and mutation helpers are thin bindings over that Promise client:

```ts
const greetingQuery = createRyotQuery(({ client, signal }) =>
	client.data.query(greetingRecipe, { signal }),
);

const greeting = useRyotQuery(greetingQuery);
const saveGreeting = useRyotMutation(
	createRyotMutation(({ client, input }) =>
		client.operations.invoke({ slug: "save-greeting", input, output: Greeting }),
	),
);
```

`useRyotQuery` returns plain React Query-like result state: `data`, `error`, `status`, `isPending`, `isFetching`, `isError`, `isSuccess`, and `refetch`. `useRyotMutation` returns plain `idle`/`pending`/`error`/`success` state with `data`, `error`, `mutate`, `mutateAsync`, and `reset`. These are SDK result objects, not TanStack Query objects.

`ryot.operations.invoke({ slug, input, output })` is the plugin operation API. It takes an operation slug, a required JSON-compatible `input`, and an output codec, but no input codec. A no-input operation sends `input: null`; omission is invalid and is not converted to `null`. The SDK checks the input with the canonical `isJsonValue` guard from `@ryot/contract/schema/json` and rejects invalid input locally, before invoking the adapter. The client decodes a successful JSON result against `output`.

Expected plugin business/domain outcomes are successful typed values encoded by each operation output schema. They are never SDK errors. Queries, operations, navigation, and later capabilities use one public `RyotClientError`; its `reason` is exactly one of:

| Reason                   | Meaning                                                                                      |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| `disposed`               | Normal local or peer teardown.                                                               |
| `protocol`               | Malformed bridge/session data or a wire `lifecycle-close` reason of `failed`.                |
| `transport`              | Communication, posting, or network failure.                                                  |
| `invalid-input`          | Invalid input found locally before dispatch.                                                 |
| `query-failed`           | Opaque declared backend/platform query execution failure.                                    |
| `operation-failed`       | Opaque declared backend/platform operation execution failure; not a plugin business outcome. |
| `malformed-result`       | A capability result that fails its JSON or caller-owned result schema.                       |
| `unsupported-capability` | An exposed SDK category missing from the supplied adapter.                                   |

The wire value `failed` is not a public SDK error reason. Internal causes, messages, diagnostics, HTTP details, and stack traces never cross the bridge. Synchronous capabilities either dispatch or throw a `RyotClientError`: navigation after teardown uses the stored terminal reason, and a failed adapter call or `postMessage` uses `transport`.

The canonical `JsonValue` type and schema value, also from `@ryot/contract/schema/json`, define the dynamic value boundary for the SDK and bridge. Strict schemas reject values outside that boundary; values are never normalized with `JSON.stringify` or another lossy conversion. The kernel validates a successful operation value before sending it over the bridge, so a non-JSON value becomes `malformed-result` and never crosses the port. A JSON value that fails the caller's output schema is also `malformed-result`. `Schema.Unknown`, duplicated validators, and unchecked casts are not part of this contract.

`@ryot/client-sdk/effect` re-exports `Schema` and nothing else, mirroring `@ryot/sandbox-sdk/effect` for backend scripts, so both halves of a plugin describe their operation payloads the same way. Plugin source must import `Schema` through that subpath; a bare `effect` import stays untrusted.

Plugin bootstrap and routing imports come from the plugin surface:

```ts
import {
	PluginLink,
	bootstrapClientPlugin,
	usePluginLocation,
	usePluginParams,
	usePluginSearch,
} from "@ryot/client-sdk/plugin";
```

`PluginLink` and the reactive location, params, and search hooks remain React conveniences on `@ryot/client-sdk/plugin`. They use the same explicit client and plugin runtime as `ryot.navigation.push` and `ryot.navigation.replace`; they do not create a parallel client or bridge facade. Until the kernel supplies an authoritative public URL, `PluginLink` does not support `target` or `download`, prevents modifier and auxiliary clicks from navigating the artifact document, and composes a consumer `onClick` before dispatch. Plugin routing renders home only for `/`; unmatched logical paths render the plugin's optional `notFound` component or the SDK's semantic default.

Possible examples:

```ts
await ryot.storage.get("active-workout");
await ryot.storage.set("active-workout", value);

await ryot.feedback.haptic("success");

await ryot.files.pick(...);

await ryot.notifications.schedule(...);

await ryot.screen.keepAwake(true);

await ryot.liveActivity.start(...);
```

The SDK must not expose Capacitor directly.

Third-party plugins must not import or invoke native plugins themselves.

---

## 11. Client bridge

A plugin iframe and the kernel execute in separate JavaScript/document contexts.

Communication between a plugin iframe and the kernel occurs through the exact bridge protocol version 1. The protocol marker is validated by exact equality.

The preferred plugin transport is `MessageChannel`, with the kernel explicitly handing a communication port to the top-level plugin document. The shared `RyotClient` does not depend on this transport: the kernel direct adapter calls kernel services directly, while the plugin runtime serializes the same semantic calls over its session `MessagePort`.

Conceptually:

```text
plugin iframe
    │
    │ typed RPC
    ▼
kernel JavaScript
    │
    ├── authenticated Ryot transport
    ├── persistent client storage
    └── Capacitor on native
```

The bridge needs:

- request / response calls
- typed errors
- events
- subscriptions
- cancellation where useful
- per-session lifecycle and disposal
- settle-once pending-call rejection
- exact protocol-version validation
- installation-bound session identity
- per-session aggregate pending-request limit for operation and RyotQL calls

Plugin authors interact with the TypeScript SDK, not the wire protocol.

### Per-session runtime lifecycle

The plugin side has one runtime for one bridge session. Its state is one of:

```text
ready     the exact init was accepted and the runtime is awaiting initial session state
active    initial session state arrived and the plugin may use the client
closing   disposal has started; new calls are refused
failed    a fatal plugin or bridge failure occurred; normal calls are refused
disposed  all runtime resources are released; this state is terminal
```

The normal path is `ready -> active -> closing -> disposed`. A fatal failure enters `failed` from `ready` or `active` through the same `closing` cleanup; `failed` and `disposed` are terminal states. A close can enter `closing` directly. Every transition is idempotent, and messages received after `failed`, `closing`, or `disposed` are ignored.

`bootstrapClientPlugin` owns embedded metadata validation, the one-time parent-window bootstrap listener, the artifact root, and the top-level React root/unmount coordinator. It accepts exactly one valid init with exactly one transferred port, validates the artifact hash and all exact markers, including bridge protocol version 1, before accepting the session, requires the artifact root, creates the runtime, and supplies its client to `RyotProvider`. It removes the bootstrap listener after acceptance. The runtime owns `port.start()`, the session port listeners, the single dispatcher, lifecycle state, location state, pending calls, the `RyotClient`, and idempotent disposal. Runtime termination tells bootstrap to unmount the root. `PluginHost` owns the iframe element and the kernel-side session handle; it does not create capability-specific bridge objects.

The single dispatcher routes location, theme, query, operation, and terminal `lifecycle-close` messages and stores location and theme state in the same runtime. Query and operation calls use runtime-owned pending registries, even though they may remain separate maps for correlation. Together, operation and RyotQL pending requests share an aggregate maximum of 64 per session, enforced by both the SDK and kernel. Exceeding that limit is a protocol failure using the existing wire `failed` and public `protocol` teardown; requests are not queued or retried, and no new error reason is introduced. No other module may attach a session port listener or own a pending-call registry. The temporary parent-window bootstrap listener is the only listener outside the session runtime and is removed once the runtime is accepted.

Every pending query or operation entry is removed before its promise is settled. A result, runtime failure, or disposal can settle an entry only once. Normal disposal rejects every pending call with `disposed`; malformed session data or a wire `failed` close uses `protocol`; communication, posting, or network failure uses `transport`. The runtime clears the registries and ignores duplicate or late results. Closing the iframe is cleanup after this protocol-level rejection; plugin promises do not merely die with the iframe.

When either peer closes or fails a session, it sends `{ type: "lifecycle-close", reason: "disposed" | "failed" }` when the port is usable, marks the session closing, rejects the plugin-side pending calls, and closes the port. A wire `disposed` close maps to public `disposed`; a wire `failed` close maps to public `protocol`. The wire value `failed` is not a public `RyotClientError` reason. Kernel-side abort signals cancel in-flight service work on a best-effort basis and suppress late responses. Abort is not a transaction or rollback mechanism: an authenticated operation may already have committed before abort, and the committed work cannot be undone by closing the session or rejecting the caller's promise.

### Protocol version 1 request/response calls

Protocol version 1 implements strict request/response calls for plugin data access. It carries navigation messages, recipe-backed RyotQL query messages, backend operation messages, semantic theme messages, and terminal runtime messages over the one plugin session port.

Plugin to kernel carries `{ type: "operation-request", requestId, operationSlug, input: JsonValue }`; `input` is required. Kernel to plugin answers `{ type: "operation-result", requestId, outcome }`, where a successful outcome carries a `JsonValue` and a declared backend/platform operation execution failure carries the opaque `"operation-failed"` outcome. The SDK maps local validation, capability, result, lifecycle, protocol, and transport conditions to the exact public `RyotClientError` reasons above. A non-JSON operation output becomes `"malformed-result"` before bridge delivery; it is not stringified or otherwise normalized. Expected plugin business/domain outcomes remain successful values decoded by the caller's output schema.

Recipe queries carry the recipe document through the same exact version 1 session protocol. `RyotClient.data.query(recipe, { signal })` forwards its `AbortSignal` to the adapter. If a plugin query is aborted, the plugin runtime removes its pending entry and sends the strict `{ type: "ryotql-cancel", requestId }` message; the kernel validates it under protocol version 1, aborts the corresponding service work on a best-effort basis, and suppresses late results. The response is decoded locally by the recipe's decoder after the client receives it. Declared backend/platform query execution failures use `query-failed`; malformed decoded results use `malformed-result`.

`input` is required on the wire. A no-input operation explicitly sends JSON `null`; an omitted input fails strict request decoding and is not treated as a no-input call.

The request carries no plugin, installation, package, artifact, user, or server identity, and every bridge message is a strict schema, so a request that smuggles such a field fails to decode and is dropped. The kernel binds identity from the session it established and invokes only through the ordinary authenticated backend operation route.

Correlation is per-session: `requestId` need only be unique on one port, and the kernel ignores a request reusing an in-flight id, so a call settles exactly once.

Teardown is a shared runtime lifecycle. Closing or replacing a bridge enters `closing`, rejects every plugin-side pending call exactly once, aborts kernel work on a best-effort basis, releases request bookkeeping, sends no ordinary responses after closure, and then reaches `disposed` for normal disposal or `failed` for failure. Replacing the iframe is a later host cleanup step, not the mechanism that settles promises.

Only strict-schema values within the canonical JSON boundary, declared outcomes, failure reasons, semantic theme state, and lifecycle signals cross the port. Unsupported values are rejected, never normalized. Internal causes, messages, diagnostics, HTTP details, and stack traces stay in the kernel.

### Bridge identity

Browser origin alone is not the plugin's authority.

A bridge session is associated with the exact plugin installation and client artifact that the kernel intentionally loaded.

Only the intended top-level plugin application receives the privileged bridge channel.

Nested third-party frames inside a plugin must not automatically inherit Ryot bridge access.

---

## 12. Isolation and document model

A plugin must not share the kernel's privileged browser context.

The target model is an isolated iframe/document with:

- no direct access to the kernel DOM
- no Ryot session credentials
- explicit bridge access only
- sandbox and CSP restrictions appropriate to the required browser capabilities

The kernel renders the plugin document in `<iframe sandbox="allow-scripts" referrerPolicy="no-referrer">`. This gives the plugin document an opaque origin: no kernel DOM access, no same-origin storage, and no readable Ryot credentials.

The kernel does not expose artifact files by hash alone. After authenticated private session creation, the iframe loads `GET /plugin-artifact-sessions/:token/:fileName`; the token identifies the Redis-backed session, and the server checks the exact current installation, source revision, and artifact before serving the file. The token is in the iframe URL only: it is not part of bootstrap metadata or the bridge protocol.

Artifact files are returned as raw byte HTTP responses. The server derives the MIME type for client assets from their canonical lowercase extensions; generated HTML, JavaScript, and CSS use their generated content types. Responses use wildcard non-credentialed CORS for the opaque `null` iframe origin, `cache-control: no-store`, `referrer-policy: no-referrer`, and `x-content-type-options: nosniff`; `index.html` additionally carries `content-security-policy: sandbox allow-scripts`. Reverse proxies must redact the token path segment in logs and traces and must not cache the response.

The invariant is more important than the mechanism:

> plugin code must not become same-origin privileged kernel code merely because it is installed.

Plugin browser storage such as LocalStorage or IndexedDB must be treated as non-authoritative cache state and may be restricted by the final sandbox model.

---

## 13. Authentication and data access

Plugin UI does not receive the user's Ryot authentication cookie, bearer token, or other primary Ryot credentials.

Authenticated application data is accessed through the same `RyotClient` Promise capability and its explicit adapter in both kernel and plugin React applications.

Conceptually:

```text
plugin
  │
  │ ryot.data.query / ryot.operations.invoke
  ▼
kernel
  │
  │ authenticated transport
  ▼
Ryot backend
```

The concrete operation path is:

```text
ryot.operations.invoke({ slug, input, output })
  -> plugin SDK operation adapter on the session MessagePort
  -> kernel bridge session, which supplies the installation's plugin slug
  -> kernel authenticated transport (browser credentials, ApiScope, expected package source hash)
  -> POST /plugins/:pluginSlug/operations/:operationSlug with the kernel-owned expected hash
  -> backend operation authorization for the authenticated user
  -> plugin backend sandbox
```

The concrete query path is:

```text
ryot.data.query(recipe)
  -> direct kernel adapter or plugin MessageChannel adapter
  -> authenticated transport
  -> existing RyotQL endpoint and user-scoped authorization
  -> local recipe result decoding
```

The plugin names only an operation slug and its input. The installed plugin slug, the authenticated user, and the selected server all come from the kernel-owned session, so a plugin cannot reach another installation's operation or substitute another installation's identity.

The shared React SDK uses `@effect/atom-react` internally for query and mutation state, reactivity, caching, and invalidation in both the kernel and plugin documents. Each `RyotProvider` keeps its registry/cache local to that provider and session; the atom implementation does not cross the bridge as an ABI.

Plugins do not need to know that internal implementation.

The React adapter exposes `RyotProvider` and `useRyot`; it supplies the explicit `RyotClient` to plugin components without creating a module-global client.

### External networking

Authenticated third-party integrations should normally be implemented in the plugin's backend code, where credentials, rate limiting, durable work, and external service access can be handled safely and consistently.

Plugin applications may use ordinary public browser networking directly. Installing a plugin means trusting it with every piece of user data exposed through its client SDK APIs, including the ability to transmit that data to external services.

Ryot does not add an outbound-origin allowlist, network permission system, or data-exfiltration prevention layer. Plugin documents still receive no Ryot authentication credentials and no privileged access to the kernel document.

---

## 14. Durable plugin client storage

Persistent client state is exposed through installation-scoped kernel storage.

Conceptually:

```text
user
 + server
 + plugin installation
 + key
```

Examples:

```ts
await ryot.storage.set("active-workout", state);
const state = await ryot.storage.get("active-workout");
```

LocalStorage and IndexedDB must not be treated as the authoritative durable storage contract.

This allows the kernel to control persistence semantics across:

- iframe recreation
- application restart
- plugin update
- server/account switching
- future backup/restore behavior

Server-domain data should still live in the backend rather than being modeled as client storage.

---

## 15. Global routing

TanStack Router owns the kernel's real browser routing and history.

The global route space is:

```text
/                          bootstrap redirect

/:pluginSlug               plugin home
/:pluginSlug/*             plugin-private routes

/e/:entityId               kernel entity delegation route
/v/:viewSlug               kernel saved-view route

/settings/*                kernel
/auth/*                    kernel
...                        other explicit kernel routes
```

Static kernel routes take precedence over the dynamic plugin namespace.

### Reserved plugin slugs

Because plugins occupy the first URL segment, the kernel reserves the names used by global application routes.

The canonical set is `reservedPluginSlugs` in `packages/contract/src/modules/plugins/schemas.ts`:

```text
e
v
auth
settings
god-mode
onboarding
reset-password
customize-sidebar
```

It is exactly the set of global route segments the kernel client owns, so adding or removing a top-level client route means updating it. The kernel client must test that the static top-level segments in its TanStack Router route tree exactly match this set.

`validatePluginManifestPolicy` enforces the set for system and user plugins alike, before a manifest is persisted or activated. A reserved slug fails with `PluginSlugReservedError`, which reaches API clients as the `slug-reserved` request reason — the same reason a private plugin gets when it collides with a shipped system plugin.

### No `/p` prefix

Plugin routes are intentionally user-facing application routes:

```text
/media
/media/search
/fitness
/fitness/workouts/123
```

rather than implementation-oriented routes such as:

```text
/p/media
/p/fitness/workouts/123
```

---

## 16. Selected workspace and URL authority

The current workspace is navigation state and should normally be derived from the route.

Persistent storage records the **last workspace**, not an authoritative hidden selected workspace.

A pathless TanStack Router layout route owns everything authenticated. Its `beforeLoad` runs the authenticated route guard, and its `loader` loads the plugin catalog and the remembered workspace before any authenticated screen renders. It creates one direct kernel `RyotClient` and mounts one `RyotProvider`, one plugin-catalog provider, and the authenticated shell around the routed screen. Every authenticated route, including the settings tree, is reparented under it; public URLs are unaffected.

### Workspace visibility and ordering

Enabled state is the only workspace visibility rule: a disabled installation never appears in bootstrap selection or the workspace switcher, regardless of health, artifact presence, or client API version. Ordering is deterministic across the switcher and bootstrap: installation `sortOrder`, then plugin `slug`, then `installationId`. The catalog recipe orders by exactly those three columns and filters only on the owning plugin being active, so disabled and incompatible installations remain in the catalog for direct navigation and entity delegation even though they are not offered as workspaces.

The remembered workspace is scoped to the normalized server URL and user ID, so signing out or switching servers never clears another server or account's remembered workspace.

### Bootstrap

`/` is a bootstrap route only.

When authenticated:

```text
/
  │
  ├── remembered workspace exists and is still enabled
  │      └── replace("/<lastWorkspace>")
  │
  └── otherwise
         └── persist and replace("/<first enabled workspace in catalog order>")
```

The redirect always uses `replace`; a bootstrap destination is never pushed into history. When no workspace is enabled, `/` stays put and renders a kernel empty state that keeps account and settings navigation available.

### Plugin routes

For:

```text
/fitness/workouts/123
```

the active workspace is unambiguously `fitness`.

### Entity routes

For:

```text
/e/entity123
```

the kernel resolves the entity's persisted definition/plugin provenance and derives the workspace/plugin that owns the renderer.

### Saved-view routes

For:

```text
/v/all-shows
```

the kernel owns the screen.

If the saved view is associated with a plugin, that plugin may determine the surrounding workspace context.

A global saved view with no plugin owner may use the remembered last workspace only for surrounding navigation context.

### Settings and other global routes

Global kernel screens do not intrinsically belong to a plugin. The kernel may preserve the remembered workspace for surrounding navigation context where appropriate.

Settings lives at `/settings`, `/settings/preferences`, and `/settings/account`, with a settings-specific sidebar rendered inside the shell's content region rather than replacing the workspace sidebar. On desktop this gives two levels of navigation at once: the workspace sidebar and a 240px settings sidebar whose active section is derived from the pathname, with nested paths active under their parent and `replace` navigation between sections; `/settings` itself replaces to `/settings/preferences`, including when the viewport crosses into desktop while already on the index. Below the desktop breakpoint, `/settings` is a section index of disclosure rows reached with push navigation; detail routes carry a back control that prefers browser history and otherwise falls back to `/settings`, and the index's own back fallback is the remembered workspace route. The global mobile header and drawer described in §17 are not rendered on settings routes, so a settings detail header never stacks on top of them.

`/settings/preferences` currently contains only an Appearance section: Light/Dark/System radios that are device-local. `/settings/account` shows profile identity — avatar, name, email, user ID, and server origin — plus sign out and change server, each with pending, disabled, and stable failure states. A `ThemeController` stays mounted globally, renders nothing, and reads and persists the preference from a `ThemeStore`; that store remains the single source of truth for applying the theme to the document and for the theme snapshot published to plugins. There is no separate global theme selector outside Appearance.

Saved views, collections, search, the command center, sidebar customization, avatar refresh, God mode, integrations, imports, backups, plugin management, and the remaining settings sections are deferred.

---

## 17. Workspace switching

Changing workspace is a navigation-context switch rather than child-screen navigation.

Switching from Media to Fitness should conceptually:

1. navigate with `replace` to `/fitness`
2. persist `lastWorkspace = "fitness"`
3. reset workspace-specific ephemeral kernel navigation state as required

It should not normally create:

```text
/media
  ↓ push
/fitness
  ↓ Back
/media
```

Workspace switching should preserve the current semantic behavior of replacing the active workspace context.

The switcher lists every enabled installation in catalog order. Selecting the current workspace does nothing; selecting a different one persists the slug, closes the switcher, and navigates with `replace` — closing happens before the navigation so the transition never briefly shows the destination workspace behind an open switcher.

### Shell chrome

At `md` and above, a desktop workspace sidebar (~264px, hidden below `md`) is always present: a workspace trigger, a Home row for the current workspace, and an account/settings footer. It carries no search, saved views, collections, customization, or Pro affordance. Below `md`, a mobile header with a menu button replaces it, opening a modal `<dialog>` drawer that carries the same trigger, Home row, and footer. The drawer supports Escape, backdrop, and close-button dismissal, traps focus while open, restores focus to the menu trigger on close, locks body scroll, and respects reduced motion. Neither the mobile header nor the drawer renders on settings routes.

---

## 18. Plugin-private routes

Everything below a plugin's top-level namespace belongs to that plugin.

Examples:

```text
/media/discover
/media/search

/fitness/workouts/new
/fitness/workouts/123
/fitness/programs/abc/edit
```

The plugin declares only relative routes:

```text
/discover
/search
/workouts/$workoutId
```

The plugin source does not hardcode its installed slug.

The kernel owns the namespace prefix.

### Plugin iframe routing

Plugin applications use an in-memory router.

The iframe does not call `window.history.pushState()` for Ryot application navigation.

For:

```text
/fitness/workouts/123
```

the kernel may deliver a logical plugin location such as:

```ts
{
  kind: "route",
  path: "/workouts/123",
  search: "",
}
```

The plugin's in-memory router renders the corresponding React route.

When plugin code requests navigation:

```ts
const ryot = useRyot();

ryot.navigation.push({
	path: "/workouts/456",
});
```

the kernel turns that into the global URL:

```text
/fitness/workouts/456
```

and updates real browser history.

---

## 19. Entity routing

`/e/:entityId` is a kernel delegation route.

The URL remains globally canonical and does not include a plugin slug.

The kernel resolves the entity's owning definition/plugin provenance and determines which plugin installation must render it.

Conceptually:

```text
/e/entity123
     │
     ▼
kernel resolves entity provenance
     │
     ├── kernel-owned renderer
     │
     └── plugin-owned renderer
             │
             ▼
        PluginHost
```

The plugin receives a first-class entity surface rather than an artificial plugin-private URL.

Conceptually:

```ts
{
  kind: "entity",
  entityId: "entity123",
  entitySchemaSlug: "show",
}
```

The plugin maps the entity schema to its renderer.

Entity ownership must never be guessed only from an unqualified schema slug.

The kernel resolves provenance through an application-owned named RyotQL recipe with a colocated result schema and decoder. `RyotClient` executes the recipe document through the normal authenticated data path and decodes the result locally before the route resolver uses the persisted entity-schema plugin identity to derive the current user's installation.

Media-specific entity recipes remain in the Media plugin. The kernel recipe resolves the renderer owner; the selected plugin then loads its domain data.

### Disabled plugin navigation

A disabled installation is omitted from `/` bootstrap selection and the workspace switcher.

Direct navigation to its plugin-private routes remains valid, and entity routes may still delegate to its client artifact. The client does not add a separate execution block. If the backend rejects an operation for a disabled installation, the normal operation error is returned to the plugin UI.

---

## 20. Saved-view routing

`/v/:viewSlug` is always a kernel route.

Saved views are declarative kernel-rendered surfaces.

A plugin may own or contribute the saved-view definition, but this does not imply that the plugin owns the screen renderer.

Conceptually:

```text
/v/all-shows
     │
     ▼
kernel loads SavedViewRecord
     │
     ▼
kernel executes query
     │
     ▼
kernel saved-view renderer
```

This deliberately keeps the generic saved-view system separate from arbitrary plugin application UI.

---

## 21. Route resolution model

The kernel should resolve every global URL into an explicit intermediate target.

Conceptually:

```ts
type RouteTarget =
	| {
			owner: "kernel";
			surface:
				| { kind: "saved-view"; viewSlug: string }
				| { kind: "settings"; path: string }
				| { kind: "auth" }
				| { kind: "not-found" };
	  }
	| {
			owner: "plugin";
			pluginId: string;
			installationId: string;
			pluginSlug: string;
			surface:
				| { kind: "home" }
				| {
						kind: "entity";
						entityId: string;
						entitySchemaSlug: string;
				  }
				| {
						kind: "route";
						path: string;
						search: string;
				  };
	  };
```

Rendering then becomes:

```text
URL
 │
 ▼
TanStack Router
 │
 ▼
kernel route resolver
 │
 ▼
RouteTarget
 │
 ├── kernel component
 └── PluginHost
```

This route resolver should be a small, explicit, heavily tested kernel subsystem.

The kernel obtains its installation and client-artifact catalog through an application-owned named RyotQL recipe. The catalog returns active plugins only, decodes client API version as exact `1`, and follows bounded cursor pages of at most 100 rows until completion. `RyotClient` decodes the result locally. Its decoded result includes the stable plugin and installation identities, slug, health, disabled state, package source hash, client artifact hash, and client API version needed by routing and `PluginHost`; the catalog exposes no capabilities.

The route resolver itself performs no health filtering: it rejects reserved slugs, otherwise finds the installation by slug in the catalog, and resolves to plugin ownership regardless of health, disabled state, or client API version. `PluginHost` owns compatibility and unavailability entirely — an explicit incompatible-health branch resolves before artifact-presence and client-API-version checks, and renders an alert with no iframe or bridge.

---

## 22. Plugin iframe lifecycle

A plugin iframe is keyed by plugin installation/client artifact, not by route.

Do not reload the iframe for every plugin page.

Good:

```text
persistent Media iframe
  ├── home
  ├── search
  ├── show entity
  └── episode entity
```

Bad:

```text
home -> create iframe
show -> destroy iframe, create iframe
episode -> destroy iframe, create iframe
```

A long-lived plugin document preserves:

- React state
- query caches
- loaded resources
- scroll state where appropriate
- bridge session
- same-document View Transitions

The bridge session and the per-session client plugin runtime have the same lifetime. Route changes only update runtime location state. Theme changes only update runtime theme state. Crash recovery, artifact replacement, unmount, and host disposal all call the same idempotent runtime disposal path; none may add a theme-specific, crash-specific, reload-specific, or component-specific bridge teardown path. Query caches belong to the provider/session atom registry and are released after five minutes of idleness when unobserved.

Artifact replacement then creates a fresh client and runtime through the same bootstrap/runtime factory used for an initial mount. Reload is a host lifecycle operation, not a public client capability.

The kernel may discard inactive plugin iframes under memory pressure.

The initial implementation can keep only the active plugin alive and add an LRU/warm-cache policy later if measurements justify it.

A package update is the exception to route-stable iframe reuse. The iframe session is keyed by installation ID, package source hash, and client artifact hash. When either revision hash changes, the kernel destroys the existing iframe and mounts a fresh document and bridge session. The iframe uses content-relative `h-full` sizing rather than `h-screen`, and the plugin route sets `shouldReload: false`.

Only the active plugin is ever mounted. Shell-only interactions must not disturb iframe or bridge identity: opening or closing the workspace switcher, opening or closing the mobile drawer, crossing the desktop/mobile breakpoint, plugin-private navigation, and browser Back/Forward within the plugin route all leave the same iframe and bridge session running. Navigating to settings intentionally unmounts the plugin — settings and a plugin are never mounted together — and returning to the workspace mounts a fresh iframe. Switching workspaces unmounts the outgoing plugin and mounts the selected one. Signing out or changing server disposes the entire authenticated shell and plugin session.

The authenticated layout route's loader loads the catalog once, through the direct kernel `RyotClient` adapter, and returns it as initial data; the layout seeds `pluginCatalogQuery` through `RyotProvider` and a plugin-catalog provider using `useRyotQuery`, so the shared query surface uses that hydrated catalog on mount and revalidates it on browser focus. The plugin-catalog provider — not the plugin route — keeps the one credentialed EventSource for catalog changes; the plugin route only reads the catalog from that provider and never subscribes itself. The backend publishes user-scoped invalidations through Redis and routes them into the same process-local catalog hub used by authenticated SSE responses. Both the initial `connected` event and later `catalog-invalidated` events are named, standards-valid SSE messages with a `data:` field. Those events call the query's `refetch`; they do not carry catalog rows or add a second plugin transport. Browser reconnection remains native EventSource behavior, and ordinary route or catalog renders must not recreate the subscription.

---

## 23. View Transitions and document boundaries

Plugin pages are normal React DOM pages inside one persistent document.

Same-document View Transitions can therefore be used for plugin-internal navigation.

For example:

```text
Media home
  ↓
Show detail
  ↓
Episode detail
```

can use the browser View Transition API.

However, the browser cannot perform a true same-document shared-element transition across the kernel document and a plugin iframe.

For example:

```text
kernel-rendered /v/all-shows
    ↓
plugin-rendered /e/show123
```

crosses a document boundary.

The kernel can animate the viewport transition, but a native browser shared-element View Transition cannot span the parent document and plugin iframe.

This is an accepted limitation of the isolation model.

---

## 24. Gestures

Web UI is responsible for ordinary application gestures.

Examples include:

- swipe a workout set to reveal Delete
- drag to reorder
- horizontal carousels
- swipeable cards
- custom timeline scrubbing
- kernel drawer swipe

These use standard browser input primitives such as Pointer Events, `touch-action`, CSS transforms, and trusted UI/gesture utilities exposed by the client UI SDK.

High-frequency pointer movement remains entirely inside the web runtime.

Only semantic native events cross the kernel/native bridge.

For example:

```text
finger movement
  -> DOM gesture logic

delete threshold crossed
  -> ryot.feedback.haptic(...)
```

---

## 25. Sidebar and back gestures

The kernel owns the application-level edge gesture policy.

At a workspace root:

```text
/media
/fitness
```

the left edge may open the kernel sidebar.

At a child route:

```text
/fitness/workouts/123
/e/entity123
/settings/preferences
```

the application may prioritize Back instead.

The exact use of WKWebView's native back/forward gesture and Android predictive back requires a focused implementation spike, but the routing authority remains the kernel regardless of gesture implementation.

The web kernel must be able to implement the drawer interaction itself; retaining a React Native shell solely for drawer gestures is not required.

---

## 26. Native host and Capacitor

Capacitor is the native application host.

The native project exists to provide:

- application packaging
- WebView hosting
- lifecycle integration
- deep links
- OS permissions
- haptics
- file selection / sharing
- notifications
- background integrations
- Live Activities
- other future native platform features

It is not required to render the primary Ryot UI.

First-party native functionality should be exposed through Capacitor plugins owned by Ryot.

Third-party client plugins never receive direct Capacitor access.

---

## 27. Foreground versus background ownership

A plugin's React DOM runtime is a foreground UI runtime.

It may be suspended or destroyed when the application backgrounds or when the operating system reclaims resources.

Therefore:

> foreground plugin JavaScript must not be the authority for work that must continue in the background.

Examples:

### Plugin-owned domain state

Fitness may own:

```text
workout startedAt
rest duration
current exercise
current set
workout status
```

and persist the required state through generic storage/backend APIs.

### Kernel/native capabilities

The kernel may expose generic primitives for:

```text
notification scheduling
keep-awake
background audio
Live Activities
file transfers
device sensors
future generic long-running native operations
```

### Backend

Durable jobs, external integrations, workflows, and server-side automation remain backend concerns.

The kernel must not introduce domain APIs such as `startWorkout()` merely because Fitness needs background behavior.

---

## 28. Timers and lifecycle

Foreground JavaScript timers must not be considered durable.

For example, a rest timer should persist:

```text
startedAt
duration
```

rather than decrementing an authoritative counter forever in `setInterval`.

When the app resumes, the plugin derives the current remaining duration from timestamps.

If an OS-visible event is required while backgrounded, the plugin composes generic capabilities such as notifications or Live Activities.

---

## 29. Live Activities

Live Activities are a native kernel capability.

Downloaded plugin JavaScript cannot provide arbitrary SwiftUI/WidgetKit implementations.

Ryot therefore exposes generic declarative Live Activity primitives.

A plugin may request something conceptually like:

```ts
await ryot.liveActivity.start({
	template: "timer",
	title: "Rest",
	subtitle: "Bench Press",
	endsAt,
	deepLink: "/fitness/workouts/123",
});
```

Fitness owns the fact that the activity represents workout rest time.

The kernel owns only the generic native rendering and lifecycle capability.

New native templates/capabilities should be added only when a real cross-plugin need justifies them.

---

## 30. Capability availability

Client-native/kernel capabilities are not declared in plugin metadata in the current V1. No client capabilities field exists until a real capability is implemented and enforced.

Future capability APIs may include:

```text
storage
haptics
files
notifications
audio
keep-awake
live-activities
```

When the SDK exposes a category, the supplied adapter must provide it. If that category is missing, the SDK reports `unsupported-capability`; this reason does not represent an undeclared manifest capability.

---

## 31. Exact version markers and reload behavior

The current client contract records exact markers for:

1. client SDK/API level
2. bridge protocol level
3. client artifact format/compiler version

The client API level is 1, and the bridge protocol level is exactly 1. Plugin source declares the exact client API level it targets. The compiler emits the exact bridge protocol, artifact format, and compiler versions into artifact metadata. The kernel validates exact expected values before execution.

Plugin updates force-reload the mounted iframe so one bridge session never spans package revisions.

---

## 32. Kernel async/reactive state

The kernel and plugins use the same framework-neutral `RyotClient` Promise capability and the same React SDK surface. The kernel uses a direct adapter into its Effect services; a plugin session uses the `MessageChannel` adapter. There is no compatibility path between these environments.

`@ryot/client-sdk/react` provides `createRyotQuery`/`useRyotQuery` and `createRyotMutation`/`useRyotMutation`. They expose plain result objects and use `@effect/atom-react` internally: one `RegistryProvider` and atom registry/cache per `RyotProvider`/session, `Atom.family` for query inputs, SWR refresh on mount and focus, and a five-minute idle TTL. The shared Promise client remains the capability boundary; these React helpers do not introduce TanStack Query.

A conceptual kernel data flow remains:

```text
React screen / feature
  │
  ▼
@ryot/client-sdk/react result state
  │
  ▼
RyotClient Promise capability
  │
  ▼
direct kernel adapter or MessageChannel adapter
  │
  ▼
Effect service / authenticated transport
  │
  ▼
backend
```

Plugin authors do not need direct knowledge of this implementation.

---

## 33. Developer experience

Third-party authors should install the SDK packages locally for:

- TypeScript types
- autocomplete
- UI component development
- local preview tooling
- documentation

For example:

```text
@ryot/client-sdk
@ryot/client-sdk/react
@ryot/client-sdk/plugin
@ryot/client-sdk/effect
@ryot/client-ui-sdk
```

Their local project may use Bun normally.

This does not imply that the production Ryot server will install arbitrary dependencies from the uploaded package.

The local development toolchain should eventually provide a command such as:

```text
ryot plugin dev
```

or equivalent, using the same compiler/runtime rules as production.

It should support:

- watch/rebuild
- local plugin iframe preview
- bridge mocks or connection to a development Ryot instance
- hot reload where practical
- browser developer tools

Media and Fitness should use the same development path.

---

## 34. Testing strategy

Ryot should maintain at least one deliberately comprehensive client plugin fixture that exercises:

- plugin home
- custom routes
- entity rendering
- navigation
- View Transitions
- large lists
- forms and mobile keyboard behavior
- swipe actions
- file picking
- haptics
- notifications
- theme changes
- plugin crash/reload
- artifact update
- iframe isolation
- accessibility
- web and native runtime differences

The same client artifact should be exercised on:

- web
- iOS
- Android

Media and Fitness provide additional production dogfooding.

Client boundary tests must verify the exact public `RyotClientError` reasons and their classifications: explicit `null` operation input, omitted input rejected locally as `invalid-input`, an exposed SDK category missing from the supplied adapter as `unsupported-capability`, declared query and operation execution failures as opaque `query-failed` and `operation-failed`, invalid or throwing result decoders as `malformed-result`, teardown as `disposed`, malformed bridge/session data and wire `failed` closes as `protocol`, and communication/posting/network failures as `transport`. Tests must prove the shared 64-request operation/RyotQL pending limit and its protocol teardown, that lifecycle termination classifies every pending and synchronous capability consistently, direct and bridge query adapters classify declared failures identically, expected plugin business/domain outcomes resolve as typed values, and internal causes, messages, diagnostics, HTTP details, and stack traces do not cross the bridge. Routing tests must cover consumer-cancelled links, prevented modifier and auxiliary navigation, explicit home matching, and plugin-supplied and default not-found states.

Client compiler tests must also cover semantic checking of every archived non-test client `.ts`/`.tsx` file, fatal normalized TypeScript diagnostics, bundling from only the manifest entry's reachable graph, and Tailwind scanning of all archived client `.ts`/`.tsx` files.

The browser lifecycle suite drives theme changes through `/settings/preferences` rather than a global theme selector, accepts that entering settings unmounts the plugin, and verifies that the fresh iframe mounted on return receives the persisted theme. Live theme synchronization on an already-mounted plugin host is covered by unit tests instead of the browser suite.

---

## 35. Accessibility

Plugin applications must be treated as first-class accessible web applications.

The client UI SDK should provide accessible defaults for common controls.

Testing must cover at least:

- VoiceOver
- TalkBack
- keyboard navigation on web
- focus after route changes
- dialog focus trapping
- screen-reader announcements
- destructive-action alternatives to gesture-only UI

Any action available only by swipe must also have a non-gesture accessible affordance.

---

## 36. Performance expectations

The architecture favors a small number of long-lived full-screen plugin documents rather than many embedded WebViews.

Native has one main Capacitor WebView.

Plugin isolation uses browser iframes inside that document.

Important performance rules:

- do not recreate the plugin iframe for every route
- keep RPC calls coarse-grained
- do not send high-frequency gesture data over the bridge
- batch data operations
- treat the plugin document as restartable
- discard inactive plugin iframes under memory pressure where needed
- measure before adding iframe pooling or prewarming complexity

---

## 37. Explicit non-goals for V1

V1 does not support:

- arbitrary npm dependency installation for uploaded plugins
- arbitrary native dependencies supplied by plugins
- Vue/Svelte/other client frameworks
- plugin access to Capacitor
- plugins registering arbitrary top-level global URL patterns
- plugin-owned global browser history
- arbitrary injection into kernel UI internals
- domain-specific kernel APIs for Media/Fitness
- TanStack Query
- deep sharing of kernel JavaScript globals with plugin documents
- direct plugin access to Ryot authentication credentials
- outbound network permission or origin-allowlist policy
- Expo-to-DOM client adapters or migrated client state

---

## 38. Implementation details intentionally left open

The high-level architecture does not depend on deciding these upfront:

- exact set of additional SDK methods beyond the implemented data, operations, navigation, theme, query, and mutation surfaces
- exact `client-ui-sdk` component catalog
- exact gesture implementation library
- exact native implementation of iOS back gestures
- exact Android predictive-back integration
- whether inactive plugin iframes are cached
- exact native Live Activity templates

These should be resolved through implementation spikes and real Media/Fitness requirements without reopening the overall architecture.

---

## 39. Implementation sequence

Implementation proceeds through tracer bullets rather than building every SDK and UI surface upfront.

### 39.1 Fresh kernel

1. move the Expo / React Native client from `kernel/client` into `crates/` as temporary reference code
2. create the new React DOM and TanStack Router kernel at `kernel/client`
3. retain Effect and `@effect/atom-react` as the kernel async/reactive state model
4. do not create adapters between the old and new clients

### 39.2 Web fixture tracer

The first tracer proves one fixture plugin end to end on the web:

```text
plugin client source in archive
  -> server-side client compilation
  -> immutable content-addressed artifact
  -> RyotQL installation/artifact catalog
  -> kernel route resolution
  -> isolated iframe bootstrap
  -> MessageChannel bridge
  -> plugin home and one private route
  -> one authenticated backend operation
  -> theme update
  -> crash/reload handling
  -> plugin update and forced artifact reload
```

Only the SDK and UI primitives required by this tracer are introduced.

### 39.3 Capacitor tracer

The second tracer runs the same compiled fixture artifact inside Capacitor on iOS and Android. It validates WebView loading, bridge startup, deep links, application lifecycle, keyboard behavior, and platform Back behavior without adding domain-specific native APIs.

### 39.4 Media entity tracer

The third tracer ports one real Media entity surface:

```text
/e/:entityId
  -> kernel RyotQL provenance recipe
  -> installation-aware RouteTarget
  -> Media client artifact
  -> Media-owned entity renderer and data recipes
```

This proves that built-in plugins use the third-party path and that the kernel remains domain-agnostic. Further Media, Fitness, UI SDK, storage, and native capability work follows concrete requirements discovered while porting the remaining application.

The `crates/` reference tree remains outside this work; any future removal requires a separate plan after its required behavior has been ported.

---

## 40. Final architecture

The resulting ownership model is:

```text
PLUGIN OWNS
────────────────────────────────────
domain concepts
domain-specific state
workspace home UI
entity UI
plugin-private routes
foreground interaction logic
plugin backend logic
composition of generic host primitives


KERNEL OWNS
────────────────────────────────────
authentication
global URL namespace and browser history
workspace resolution
saved-view rendering
settings
plugin lifecycle
plugin client compilation/loading
client bridge and exact version validation
design system / client UI SDK
authenticated transport
persistent client storage primitive
native capability primitives
foreground/background lifecycle integration
Capacitor/native host
```

The central rule is:

> Ryot plugins are independently compiled React DOM applications hosted by a domain-agnostic React DOM kernel. The kernel owns global application semantics and native/platform authority; plugins own arbitrary domain application UI and behavior.

This is the baseline for implementation of the Ryot client plugin system.
