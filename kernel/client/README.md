# Kernel Client

The kernel is one React DOM application: browsers run it directly, while iOS and Android run the
same build in Capacitor WebViews.

## Ownership And Isolation

The kernel owns authentication, server selection, the single global URL and history, artifact grants,
bridge dispatch, and all native and platform authority. Plugins own domain UI and behavior.
Routes publish plugin routes, entity pages, saved views, and workspace homes to the shell-owned client
page document host. Compatible prepared pages share a compiled React DOM artifact in a sandboxed,
opaque-origin iframe.

The iframe receives no bearer credentials and has no direct Capacitor access. Its only privileged
connection is the `MessagePort` transferred by the kernel after both peers validate the bridge and
artifact identity. Plugin requests cross that port as narrow, schema-checked capabilities; the kernel
applies authentication, installation scope, and platform policy. A plugin upload sends only bytes with
a proposed file name and content type; the kernel keeps intent creation, transfer, and completion.

Client artifacts are immutable, content-addressed outputs of a compile-only contributor graph.
Mutation and user bootstrap materialize missing builds before publishing catalog changes; navigation
preparation only resolves the current page, finds its global build, and issues or reuses an authenticated
grant for its artifact. The grant authorizes static artifact files until expiry. A separate freshness
check on catalog invalidation detects changed page or plugin state and offers an explicit reload.
There is no plugin-owned artifact selection or grant route.

The kernel resolves every committed URL explicitly. Kernel routes render kernel surfaces;
`/:pluginSlug/*`, `/v/:viewSlug`, and `/e/:entityId` resolve to client-page targets for plugin routes,
saved views, and persisted entity provenance. A workspace home resolves to its selected saved-view
target while retaining the workspace URL. The shell retains up to three iframe runtimes keyed by
artifact hash. A different page using the same artifact replaces the document context and remounts
the page React tree while retaining the iframe, bridge, and SDK runtime. Retained frames keep entity
interests warm, but only the active frame owns shell integrations. Disabled installations stay out of
workspace discovery but remain reachable through direct plugin and delegated entity URLs.

There is one global history. Plugins request tagged route or entity navigation, and the kernel writes
the canonical URL. The kernel sends each accepted location with its history `index` and stable entry
`key`; page-state replacements retain that key, while screen navigation creates a new one. Plugin
screen stacks use those values, never pathname inference, to distinguish push, pop, and replace.

Protocol schemas and bridge identity live in
[`@ryot-app/client-plugin-contract`](../../packages/client-plugin-contract/README.md). SDK runtime
behavior lives in [`@ryot-app/client-sdk`](../../packages/client-sdk/README.md), and shared screen and
interaction rules live in
[`@ryot-app/client-ui-sdk`](../../packages/client-ui-sdk/README.md).

## Application Services

`AuthenticatedApi` and `AdminApi` are the only services that run contract programs, and `ClientLive`
does not export them. Other modules depend on narrow group ports such as `RyotQLApi` or
`SavedViewsApi`; adding an endpoint widens its owning port rather than exposing the full client.

Authenticated kernel settings and account screens load and change data through the same shared query
and mutation layer as client pages. Route loaders retain access decisions, redirects, and not-found
checks. Permanent direct-service exceptions are pre-authentication routes, which have no authenticated
API scope; God Mode, whose administration calls are scoped by its token; and the catalog-dependent
workspace redirect, which must resolve before rendering.

Every `ClientLive` layer must be synchronously constructible because `main.tsx` creates the runtime
with `runSync`. Asynchronous setup belongs inside service operations.

Server access normally goes through a contract group port. Backup archive download is the one
exception: an authenticated byte stream cannot carry its bearer header through an `<a href>`, so
`BackupsApi.downloadArchive` obtains the header and hands fetched bytes to a synthetic download link.

`EntityInterestService` opens no socket when a client is constructed. The authenticated layout owns
the active server/user session and releases it on logout, scope change, or unmount. Plugin documents
have one subscription outside the request table, released by the common iframe finish path. See the
[entity-interest protocol](src/modules/entity-interest/README.md).

## Navigation And Screens

`resolveEdge` separates visible leading intent (`back`, `drawer`, or `none`) from interactive edge
ownership. The kernel grants a plugin the back edge only after the active document reports a previous
screen for the current history `index` and `key`. The plugin executes a granted gesture and posts
`navigate-back`; the kernel performs the pop. Per-frame gesture data never crosses the bridge.

The kernel also sends `compact` and safe-area insets. An iframe measures its content area, not the
outer viewport, and `env(safe-area-inset-*)` is zero there. Plugins must use these kernel values for
layout and custom chrome. Kernel surfaces can use CSS `env()` directly.

`ScreenFrame` from `@ryot-app/client-ui-sdk` is the shared header implementation. `AppScreen` uses it
for kernel routes and `PluginScreenFrame` uses it in plugin documents. The frame owns its bar,
heading, gutters, and content rhythm but not the scroll container. A screen publishes one title;
plugin title and readiness messages are accepted only from the active installation and current
history entry.

`historyEntry` is the only code that may read TanStack Router's `__TSR_*` state. Every navigation path
must supply an `index` and `key`.

## Overlays And Back

Overlay dismissal follows ownership:

- React-state overlays register a `BackInterceptor`; Android hardware Back closes them before
  history is popped.
- URL-state overlays push a history entry and close by popping it, with replace only for direct
  entry. They do not register an interceptor.

Browser Back cannot be intercepted. All overlays make background content inert and use the UI SDK's
focus, Escape, outside-dismiss, shortcut-scope, and scroll-lock primitives. Back interception remains
kernel-owned; the UI SDK does not import the router or Capacitor.

Every route has one `<main>`, one `<h1>`, and one `usePageTitle` owner, including pending, error,
not-found, and plugin-ready branches. The root owns the skip link and route announcer.

## Native Builds

Capacitor has no variant system, so platform build configuration owns app identity.
`capacitor.config.ts` always records production identity and must not branch on environment.

|            | Debug             | Release       |
| ---------- | ----------------- | ------------- |
| Name       | Ryot Debug        | Ryot          |
| Identifier | `io.ryot.app.dev` | `io.ryot.app` |
| Icon       | Blue `#4dabf7`    | Orange        |

iOS reads the name, bundle identifier, and icon set from per-configuration Xcode settings. Android
uses `applicationIdSuffix ".dev"` and debug resource overlays. Both variants install side by side;
`bun run ios` and `bun run android` build Debug.

Both platforms register only their variant's identifier as the deep-link scheme.
`resolveDeepLinkHref` folds a custom scheme's authority into its path and accepts HTTP(S) paths;
other schemes are ignored. Native launch URLs replace the current entry. Android hardware Back pops
the global router history and exits only when no entry remains.

`RuntimeOAuthClientService` is the only runtime selector for first-party OAuth. Native builds accept
only `io.ryot.app` and `io.ryot.app.dev` and fail closed on an unknown application ID. The identifiers
and callback builders are shared with backend provisioning and deep-link filtering.

## Assets

`assets/icon-only.png` drives app and web icons, `assets/logo.png` drives adaptive foregrounds and
splash screens, and `assets/dev/logo.png` drives the iOS debug icon. Keep `logo.png` in RGBA format;
`capacitor-assets` otherwise composites its background incorrectly.

Run `bun run generate-assets` after changing source art. `scripts/generate-assets.ts` owns generation
and platform fixups; never hand-edit emitted `mipmap-*`, `drawable-*`, or `Assets.xcassets` output.

## Secure Storage

`OAuthStorage` owns OAuth tokens and PKCE transactions. Web uses `localStorage`. Native uses the iOS
Keychain or Android Keystore-backed AES-GCM storage, disables Android backup, disables iCloud Keychain
synchronization, and uses this-device-only access after first unlock. A missing native storage plugin
fails rather than falling back to plaintext.

Native storage sets `setKeyPrefix("ryot_")` before use. The plugin strips that prefix when listing
keys, so both web and native adapters expose the same logical `ryot:oauth:*` names used by pending
transaction cleanup. The native adapter is dynamically imported and does not enter the web bundle.

Malformed records are removed. A Keychain or Keystore read failure reports no session but retains the
record, because a temporarily locked store must not delete a refresh token. Writes fail explicitly.
iOS keychain data survives app deletion, so reinstalling can restore the previous session.

Adding or removing a Capacitor plugin requires `bun run sync`; commit the regenerated Android Gradle
files and `ios/App/CapApp-SPM/Package.swift`.

## Commands

```sh
bun run dev              # web dev server on :3005
bun run generate-assets  # regenerate native and web assets
bun run sync             # build and copy the web bundle into native projects
bun run ios              # sync and run the iOS Debug variant
bun run android          # sync and run the Android Debug variant
```
