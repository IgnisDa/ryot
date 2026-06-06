# Ryot Client Plugin Architecture

**Status:** Accepted design
**Scope:** Ryot client kernel, client-side plugin runtime, client plugin SDK, client UI SDK, web/native packaging, routing, and native capability boundaries.

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
                          └── @ryot/client-plugin-sdk

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

Ryot should not recreate browser capabilities inside the client plugin SDK.

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

The temporary reference application and the rest of `crates/` are deleted before this branch merges to `main`.

### Plugin applications

The supported V1 client authoring environment is intentionally narrow:

```text
React
React DOM
TypeScript / TSX
Tailwind CSS
@ryot/client-plugin-sdk
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
  entry: "./client/index.tsx",
  apiVersion: 1,
  capabilities: [
    // generic capabilities requested by the plugin
  ],
}
```

A plugin without client UI may omit the client entry.

A client plugin conceptually exports:

```ts
defineClientPlugin({
	home: HomePage,

	entities: {
		// entity schema slug -> renderer
	},

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
react/jsx-runtime

@ryot/client-plugin-sdk
@ryot/client-plugin-sdk/*

@ryot/client-ui-sdk
@ryot/client-ui-sdk/*
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

Client-local CSS and assets live under `client/**`. The source archive remains distinct from the compiled client artifact.

---

## 6. Bun client compiler

Bun is the client bundler/compiler.

Client compilation is owned by a new `@ryot/client-plugin-compiler` package. `@ryot/sandbox-compiler` remains dedicated to backend sandbox definitions and output. These are separate compiler engines with separate import policies, output models, limits, and public compiler APIs.

Both compiler engines use the same server-owned process supervision boundary for child-process lifecycle, bounded concurrency, timeouts, process-tree memory sampling, and termination. Their compiler packages own their production dependencies and compiler-specific contracts; the production image installs those dependencies through filters for both compiler packages rather than from uploaded plugin manifests.

The server runs the client compiler during plugin installation and update. The plugin source archive has a package source hash; the emitted client artifact has a separate artifact hash.

The compiler:

1. validates the client entry and source package
2. rejects unsupported external imports
3. resolves approved SDK imports to Ryot-controlled implementations
4. compiles Tailwind for that plugin
5. bundles React DOM code for the browser
6. emits the plugin client artifact
7. content-addresses the resulting artifact

Conceptually:

```text
plugin source
    │
    ├── local TS / TSX
    ├── local CSS / assets
    └── imports from approved Ryot SDKs
          │
          ▼
@ryot/client-plugin-compiler
          │
          ├── trusted module resolver
          ├── Tailwind compilation
          └── Bun browser build
          │
          ▼
content-addressed client artifact
```

The compiler owns the effective versions of:

- React
- React DOM
- Tailwind
- client plugin SDK
- client UI SDK
- UI implementation dependencies

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

The client artifact is an independently loadable web application.

The artifact is a flat set of files with single-segment names: `index.html`, `plugin.js`, `plugin.css`, and content-hashed assets named `asset-<first 8 hex of sha256>.<ext>`. `index.html` references the other files with relative URLs (`./plugin.js`, `./plugin.css`, `./asset-<hash>.<ext>`).

The important invariants are:

- the artifact is immutable
- the artifact is content-addressed
- the kernel can verify its identity
- a plugin update produces a new artifact
- a live plugin document is not mutated underneath a running React tree

When an update replaces artifact A with artifact B, the kernel force-reloads any mounted iframe for that installation. An old client artifact must not continue calling a newer backend plugin revision.

### Artifact identity is embedded, never authored

The artifact hash covers the compiled bundle, stylesheet, and assets, so it cannot exist inside them. The compiler emits `index.html` last, embedding the artifact hash and the V1 markers as JSON in a `<script type="application/json" id="ryot-client-artifact">` element.

`bootstrapClientPlugin` reads that element and refuses to accept a bridge port when it is absent or malformed. Plugin source therefore never declares, derives, or passes its own artifact identity, and the kernel, the compiler, and the running plugin compare the same embedded values.

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

The plugin compiler scans that plugin's source and emits the CSS required by that plugin.

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

Theme changes do not require recompiling a plugin.

### Custom CSS

Plugins may use custom CSS in addition to Tailwind.

They may also use normal web-platform animation, View Transitions, SVG, Canvas, and other browser technologies.

### Dynamic Tailwind classes

Normal Tailwind static-analysis rules apply. Plugins must not assume that arbitrary runtime-generated class strings will be emitted unless supported by the compiler.

---

## 9. `@ryot/client-ui-sdk`

`@ryot/client-ui-sdk` is the supported React UI platform for plugins.

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

## 10. `@ryot/client-plugin-sdk`

`@ryot/client-plugin-sdk` is the typed contract between plugin JavaScript and the Ryot kernel.

It exposes semantic kernel capabilities, not kernel implementation details.

Initial categories should be approximately:

```text
runtime
navigation
data
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
lifecycle
```

The exact methods should be added incrementally.

### What V1 ships

The namespace object is real and starts with one category:

```ts
import { ryot } from "@ryot/client-plugin-sdk";
import { Schema } from "@ryot/client-plugin-sdk/effect";

const Greeting = Schema.Struct({ greeting: Schema.String });

const { greeting } = await ryot.data.invokeOperation({
  slug: "greet",
  input: { name },
  output: Greeting,
});
```

A rejected call throws `PluginOperationError` carrying one `reason`: `"operation-failed"` for a failure the backend declared, `"transport"` for an unexpected one, or `"malformed-result"` when the value does not decode against `output`.

`@ryot/client-plugin-sdk/effect` re-exports `Schema` and nothing else, mirroring `@ryot/sandbox-sdk/effect` for backend scripts, so both halves of a plugin describe their operation payloads the same way. It costs nothing: the SDK already bundles `effect` to decode bridge messages. Plugin source must import `Schema` through that subpath; a bare `effect` import stays untrusted, keeping one ABI surface rather than two.

`invokeOperation` takes an output codec but no input codec. The client cannot know what the operation accepts, and the backend already validates input and answers with a typed failure, so a second client-side declaration would only be a mirror that can drift.

Navigation remains the hook surface introduced with plugin-private routes and has not moved under `ryot.navigation`.

Possible examples:

```ts
await ryot.storage.get("active-workout");
await ryot.storage.set("active-workout", value);

await ryot.feedback.haptic("success");

await ryot.files.pick(...);

await ryot.notifications.schedule(...);

await ryot.screen.keepAwake(true);

await ryot.liveActivity.start(...);

ryot.navigation.openEntity(entityId);
ryot.navigation.openView(viewSlug);
ryot.navigation.push({ path: "/workouts/123" });
```

The SDK must not expose Capacitor directly.

Third-party plugins must not import or invoke native plugins themselves.

---

## 11. Client bridge

A plugin iframe and the kernel execute in separate JavaScript/document contexts.

Communication occurs through a version-tagged message/RPC bridge.

The preferred web primitive is `MessageChannel`, with the kernel explicitly handing a communication port to the top-level plugin document.

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
- exact protocol-version validation
- installation-bound session identity
- capability negotiation

Plugin authors interact with the TypeScript SDK, not the wire protocol.

### V1 request/response calls

V1 implements request/response calls for one purpose: invoking a backend operation belonging to the bridge session's own installation.

Plugin to kernel carries `{ type: "operation-request", requestId, operationSlug, input }`. Kernel to plugin answers `{ type: "operation-result", requestId, outcome }`, where `outcome` is `{ outcome: "success", value }` or `{ outcome: "failure", reason }` and `reason` is `"operation-failed"` for a failure the backend declared or `"transport"` for an unexpected one. The SDK adds a third plugin-side reason, `"malformed-result"`, when a success value does not decode against the caller's output schema.

`input` is optional on the wire and the kernel forwards an absent one as JSON `null`, so a plugin that omits it gets the backend's typed input rejection rather than a call that never settles.

The request carries no plugin, installation, package, artifact, user, or server identity, and every bridge message is a strict schema, so a request that smuggles such a field fails to decode and is dropped. The kernel binds identity from the session it established and invokes only through the ordinary authenticated backend operation route.

Correlation is per-session: `requestId` need only be unique on one port, and the kernel ignores a request reusing an in-flight id, so a call settles exactly once.

Teardown is kernel-side. Closing or replacing a bridge aborts every in-flight call, releases the kernel's request bookkeeping, and posts nothing further. The plugin half is released by destroying the plugin document: closing the kernel port raises no event on the plugin's port, so a plugin-side promise is not rejected but dies with the document. Every V1 path that closes a bridge also replaces the iframe, so the two are equivalent today. A future path that closes a bridge while keeping the document alive must first drain the plugin's pending calls.

Only `outcome` and `reason` cross the port. Internal causes and backend diagnostics stay in the kernel.

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

The kernel serves artifact files from a public, unauthenticated, content-addressed route: `GET /api/plugins/artifacts/:artifactHash/:fileName`. The unguessable sha256 path means the sandboxed document never needs credentials to load. An unknown hash or file name returns 404. Every response carries `x-content-type-options: nosniff`, `cache-control: public, max-age=31536000, immutable`, and `etag: "<artifactHash>"`; `index.html` additionally carries `content-security-policy: sandbox allow-scripts` as defence in depth.

The invariant is more important than the mechanism:

> plugin code must not become same-origin privileged kernel code merely because it is installed.

Plugin browser storage such as LocalStorage or IndexedDB must be treated as non-authoritative cache state and may be restricted by the final sandbox model.

---

## 13. Authentication and data access

Plugin UI does not receive the user's Ryot authentication cookie, bearer token, or other primary Ryot credentials.

Authenticated application data is accessed through the client plugin SDK and kernel-owned transport.

Conceptually:

```text
plugin
  │
  │ ryot.data / plugin operation
  ▼
kernel
  │
  │ authenticated transport
  ▼
Ryot backend
```

The concrete V1 path is:

```text
ryot.data.invokeOperation({ slug, input, output })
  -> plugin SDK operation bridge on the session MessagePort
  -> kernel bridge session, which supplies the installation's plugin slug
  -> kernel authenticated transport (browser credentials, ApiScope)
  -> POST /plugins/:pluginSlug/operations/:operationSlug
  -> backend operation authorization for the authenticated user
  -> plugin backend sandbox
```

The plugin names only an operation slug and its input. The installed plugin slug, the authenticated user, and the selected server all come from the kernel-owned session, so a plugin cannot reach another installation's operation or substitute another installation's identity.

The kernel uses Effect services and `@effect/atom-react` internally for application I/O, workflows, request state, reactivity, caching, and invalidation. These dependencies are resolved by the kernel runtime and do not cross the plugin boundary.

Plugins do not need to know that internal implementation.

Plugin-facing React hooks may be provided by the SDK where useful.

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

### Bootstrap

`/` is a bootstrap route only.

When authenticated:

```text
/
  │
  ├── valid visible remembered workspace exists
  │      └── replace("/<lastWorkspace>")
  │
  └── otherwise
         └── replace("/<first visible workspace>")
```

A fresh installation chooses the first workspace visible in the switcher according to the kernel's normal ordering.

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

The kernel resolves provenance through an application-owned named RyotQL recipe with a colocated result schema and decoder. The recipe follows the normal kernel data path through Effect atoms and authenticated transport and returns the persisted entity-schema plugin identity required to derive the current user's installation.

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

The kernel obtains its installation and client-artifact catalog through an application-owned named RyotQL recipe. Its decoded result includes the stable plugin and installation identities, slug, health, disabled state, package source hash, client artifact hash, client API version, and declared capabilities needed by routing and `PluginHost`.

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

The kernel may discard inactive plugin iframes under memory pressure.

The initial implementation can keep only the active plugin alive and add an LRU/warm-cache policy later if measurements justify it.

A package update is the exception to route-stable iframe reuse. When an installation's client artifact hash changes, the kernel destroys its existing iframe and mounts the new artifact.

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

## 30. Capability declarations

Client-native/kernel capabilities requested by a plugin should be declared in plugin metadata from V1.

Examples may include:

```text
storage
haptics
files
notifications
audio
keep-awake
live-activities
```

Capability declarations support:

- runtime capability availability checks
- permission UX
- auditing
- platform-specific availability
- future policy requirements

The capability system does not need to become an elaborate security sandbox in V1, but the declaration boundary should exist.

---

## 31. V1 version markers and reload behavior

V1 records exact markers for:

1. client SDK/API level
2. bridge protocol level
3. client artifact format/compiler version

Plugin source declares the exact client API level it targets. The compiler emits the exact bridge protocol, artifact format, and compiler versions into artifact metadata. The kernel validates exact expected values before execution.

The greenfield V1 implementation does not support version ranges, compatibility negotiation, protocol adapters, legacy bridges, or client-state migrations. The kernel, SDKs, compiler, and built-in plugin artifacts advance together. An unexpected marker is a build or installation error, not a request for fallback behavior.

Plugin updates force-reload the mounted iframe so one bridge session never spans package revisions.

---

## 32. Kernel async/reactive state

The kernel continues using Effect and `@effect/atom-react` for reactive and asynchronous application state.

TanStack Query is not introduced.

A conceptual kernel data flow remains:

```text
screen / feature
  │
  ▼
Effect Atom
  │
  ▼
kernel app client
  │
  ▼
authenticated transport
  │
  ▼
backend
```

Plugin authors do not need direct knowledge of this implementation.

The client plugin SDK may expose React-friendly query hooks or data abstractions backed internally by the kernel.

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
@ryot/client-plugin-sdk
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
- bridge protocol compatibility ranges or legacy adapters

---

## 38. Implementation details intentionally left open

The high-level architecture does not depend on deciding these upfront:

- client artifact storage, retention, and garbage collection
- exact bridge wire encoding
- exact set of initial SDK methods
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

The temporary `crates/` tree is deleted after required behavior has been ported and before the branch merges to `main`.

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
