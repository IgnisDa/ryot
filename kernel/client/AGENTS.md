# Kernel Client Guidelines

Architecture and rationale live in `README.md`.

- Define application I/O and workflows as Effect services. Keep storage, transport, and third-party clients in live layers, and keep every `ClientLive` layer synchronously constructible.
- Keep routes as React adapters. Authenticated user-screen data uses shared Ryot queries and mutations; loaders retain only access decisions, redirects, and not-found checks. The pre-authentication routes have no API scope, God Mode is token-scoped, and the catalog-dependent workspace redirect must resolve before render, so these remain loader/direct-service exceptions.
- Keep generated contract clients inside `#/api`. Only `AuthenticatedApi` and `AdminApi` run contract programs; other services depend on narrow group ports.
- Keep authentication, server selection, global history, artifact lifecycle, bridge dispatch, and native authority in the kernel. Expose only semantic, environment-neutral capabilities through `@ryot-app/client-sdk`.
- Keep native name, identifier, and icon in platform build configurations. `capacitor.config.ts` always uses production identity and has no environment branch.
- Generate icons through `bun run generate-assets`; edit source art or `scripts/generate-assets.ts`, never generated native asset files.
- Route native URLs and hardware Back through the router. Treat `/oauth/login`, its signed `oauth_query`, and its independence from `ServerService` as a server contract.
- Retain at most three client-page frames, keyed by prepared build, graph, artifact, saved-view, view-revision, and non-location context identity. Reuse a frame only while that identity is unchanged.
- Register document-declared page shortcuts in the kernel realm alongside the iframe's own registrations, and clear them when the bridge closes.
- Keep `leading` intent separate from `edgeBack`. The kernel grants edge ownership only after readiness matches the active document and history `index` and `key`; never send per-frame gesture data over the bridge.
- Derive client-page entry `index` and stable `key` only through `historyEntry`. Page-state replacements retain the key; screen navigation creates a new one.
- Resolve plugin routes, entity provenance, saved views, and workspace homes through client-page preparation. Do not reintroduce route-local artifact selection or block direct plugin or delegated entity URLs because an installation is disabled.
- Take `compact` and safe-area insets from the shell and bridge them to plugins. Plugin layout must not infer the outer viewport from iframe media queries or `env()`.
- Render kernel routes through `AppScreen`. It owns `<main>`, scrolling, `<h1>`, title, gutters, and frame rhythm; use `width="readable"` rather than layout classes.
- Use `ScreenFrame` as the only mobile header. Accept plugin title publication only from the active installation and current history entry.
- Keep the skip link and route announcer in `__root.tsx`. Every branch renders exactly one element carrying `mainContentProps` and one `usePageTitle` owner.
- Use UI SDK overlay, focus, Escape, shortcut, and scroll-lock primitives. Make background content inert. Back interception remains kernel-owned and is injected into the SDK.
- Model React-state overlays with `BackInterceptor`; model URL-state overlays as pushed history entries and close them by pop, with replace only for direct entry.
- Render icons through `@ryot-app/client-ui-sdk/icon`, never direct `lucide-react` imports or inline SVG.
- Keep selected uploads as `Blob` or `File` through transport and use the client SDK upload capability. The kernel performs plugin uploads too, so no upload URL or header crosses the bridge. The backup archive download is the only code that may obtain a bearer header directly.
- Source desktop sidebar and mobile drawer from the authenticated loader's shared navigation data. Do not patch loaded navigation data in place.
