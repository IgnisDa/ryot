# Kernel Client

The React DOM kernel. On the web it runs in the browser; on iOS and Android the same build runs
inside a Capacitor host. This document covers the client's own architecture, native packaging, and
branding. The kernel-plugin protocol lives in `docs/ryot-client-plugin-design.md`.

## Services And Ports

`AuthenticatedApi` and `AdminApi` are the only services that run a contract program, and `ClientLive`
does not export them. Every other module depends on a narrow group port such as `RyotQLApi` or
`SavedViewsApi`, because a program that receives every contract group cannot be stubbed without
asserting over groups the caller never touches. Adding an endpoint widens the port that owns it.

API port test layers come from the shared makers in `#/api/ports.test-layer`, which default every
operation to `Effect.die`, so a test declares only the endpoints it exercises and a stray call fails
loudly rather than returning a stub value nobody meant to provide.

Every layer in `ClientLive` must be synchronously constructible. `main.tsx` resolves the runtime with
`runSync`, which builds the whole graph, so an `Effect.promise` or `Effect.tryPromise` in a layer
effect fails at boot on every platform. Asynchronous setup belongs inside the service's own
operations.

## Entity Interest

`client.entities.watch({ foreground, visible }, onUpdate)` attaches a synchronous, mutable owner
to `EntityInterestService` by server/user scope. Constructing a kernel client does not open a socket.
The mounted authenticated layout acquires the session and releases it on logout, scope change, or
unmount; loader revalidation does not restart it. Declarations made before its effect runs are retained.

The service uses the narrow `EntityInterestApi` ticket port and an injected transport/lifecycle layer.
It never fetches preferences at startup. A successful preferences update containing `language`
reconnects the active session, including a reset to the provider default. Failed saves do not.
The plugin bridge owns one subscription per document, outside the pending request table, and releases
it through the same finish path used for crashes, replacements, and unmounts.

See [entity-interest transport and lifecycle](src/modules/entity-interest/README.md) for selection,
protocol, cleanup, and testing details.

## Navigation And The Edge Gesture

`resolveEdge` returns three separate facts: the visible leading `intent` (`back`, `drawer`, or
`none`), the interactive edge `owner`, and the viewport class. `leading` tells the plugin frame which
control to draw. `edgeBack` reports only whether the plugin document owns an interactive back edge;
it never chooses the visible leading control.

The SDK reconciles each accepted location into its retained screen stack, then reports the actual
`hasPreviousScreen` with the accepted history `index` and `key`. The kernel accepts that readiness
only for the active installation/source/artifact document and current entry, then makes the final
edge-policy decision. A plugin executes an edge it is granted but never decides ownership: it
commits by posting `navigate-back`, leaving the pop to the kernel. Per-frame gesture data never
crosses the bridge.

`compact` travels on the same message, because media queries inside the iframe see the content area
rather than the window. One definition of compact, in the resolver.

A plugin screen draws its own bar from `leading`: back posts `navigate-back`, drawer posts
`open-drawer`, and none draws no leading control. Those messages are SDK-internal and never reach
`ryot.navigation`, because opening kernel chrome is not a capability a plugin may call. The
consequence is that closing the drawer can only return focus to the iframe element rather than to
the exact button, since the button is in another document.

When focus is inside a plugin iframe, its bootstrap recognizes `Mod+K` for the command center and
`Mod+Shift+Space` for the desktop workspace switcher. It sends semantic
`{ type: "kernel-shortcut", shortcut: "command-center" | "workspace-switcher" }` bridge messages,
never raw `KeyboardEvent` or key payloads. The kernel owns the actions and desktop gating; these are
not public `RyotClient` capabilities. An active plugin `OverlayScope` suppresses root forwarding, and
plugin roots must not bind either reserved combination.

## Plugin Destinations

The authenticated shell resolves the active committed URL to either kernel content or one plugin
destination. Plugin-private routes and plugin-owned entity routes for the same
installation/source/artifact identity update one retained `PluginHost`; pathname, slug, entity ID,
history index, and history key do not identify the host. Kernel routes unmount it, while an
installation, source, or artifact change replaces it.

The entity route loader reads persisted provenance once. Rendering then resolves that provenance
against the live catalog, so catalog changes can replace the destination without reloading
provenance. Disabled installations remain absent from workspace discovery but are still reachable
through direct plugin and delegated entity URLs. A `/v` to `/e` navigation crosses from a kernel
document to a plugin document, so the kernel keeps the edge. Navigation between route and entity
locations in the same active plugin document may grant the plugin edge only after matching SDK
screen readiness arrives.

## The Mobile Screen Frame

`ScreenFrame` in `@ryot-app/client-ui-sdk` is the only mobile header implementation. The kernel
mounts it through `AppScreen`, and the plugin SDK mounts the same component through
`PluginScreenFrame`, so the two documents cannot drift: the plugin compiler already scans the UI
SDK for Tailwind classes and inlines `theme.css` and `palette.css` into every artifact.

The bar is `sticky`, transparent at rest, and turns opaque when a zero-height sentinel passes
underneath it. That is one `IntersectionObserver` and a CSS transition rather than scroll-linked
progress, because `animation-timeline: scroll()` is unavailable on the iOS baseline and a per-frame
scroll listener would be needed in both documents. The frame never creates a scroll container; it
sticks against the one its caller already owns, which is why the plugin's per-screen scroll div and
the kernel's `<main>` both work unchanged.

Everything inside that scroller belongs to the frame: the bar, the title block, the header, the
gutters, and the gap between the header and the content. `AppScreen`'s `<main>` keeps only
scrolling, the background, and the bottom inset, and a route hands the frame content and semantics
rather than layout classes — a class that reaches into the header can clamp a height the frame
decides, and the overflow lands on the content underneath. The UI SDK's README carries the rest of
why the frame takes no class names at all.

Search takes the compact bar over, and the title block goes with it. The `<h1>` does not: it stays
in the document as a visually hidden heading, so the screen still names itself exactly once while
the bar is a search field.

That field mounts focused, so one tap opens the row and raises the keyboard. React focuses an
`autoFocus` input during the commit, and a click is a discrete event React flushes inside the
gesture, which is what keeps iOS willing to raise the keyboard for a focus the user did not make
directly. Exiting hands focus back to the bar's search control, and since that control is unmounted
while the row is open, the close is flushed before the focus so the ref points at the button that
came back rather than at the one that left.

The safe-area insets reach the plugin as discrete `safeAreaTop` and `safeAreaBottom` values on init
and a `viewport` message on change, measured in the kernel from one probe element. `env(safe-area-inset-*)`
is zero inside an iframe, and `/e/:entityId` resolves to a plugin-owned renderer, so a hero that
bleeds behind the status bar, and a page that has to clear the home indicator, have to be drawn with
numbers the plugin was told. Kernel-owned surfaces keep spending the CSS `env()` directly, since only
the iframe cannot resolve it.

A screen names itself once, through the `title` it passes the frame. `AppScreen` turns that into the
`<h1>` and the document title; `PluginScreenFrame` turns it into the `<h1>` and the published
`header` message, which the active plugin destination feeds to `usePageTitle`. Publication
ownership is the installation ID plus the current history `index` and `key`, so a stale or replaced
screen cannot set the title. A plugin screen may render no frame at all; it then owns its own
affordances and must still call `usePluginTitle`.

The location message also carries the history `index` and `key`. They are the plugin screen stack's
only means of telling push from pop from replace, so a navigation path that cannot supply them must
not exist. `historyEntry` is the one place allowed to touch TanStack's `__TSR_*` state fields.

## Build Variants

Capacitor has no variant system, so identity is owned by each platform's build configuration
rather than by `capacitor.config.ts`. That file records the production identity only; it is
informational at runtime and must not be made environment-dependent.

|            | Debug             | Release       |
| ---------- | ----------------- | ------------- |
| Name       | Ryot Debug        | Ryot          |
| Identifier | `io.ryot.app.dev` | `io.ryot.app` |
| Icon       | Blue `#4dabf7`    | Orange        |

- **iOS** — `Info.plist` reads `$(APP_DISPLAY_NAME)` and `$(PRODUCT_BUNDLE_IDENTIFIER)`; both are
  set per configuration in the Xcode target's build settings.
- **Android** — the `debug` build type applies `applicationIdSuffix ".dev"`, and
  `app/src/debug/res/values/` overrides the display strings and the launcher background from
  `app/src/main`.

Both variants install side by side. `bun run ios` and `bun run android` build Debug, so they
produce the dev variant.

The debug icon puts the mark on the complement of the brand orange so the two are distinguishable
in a launcher. On Android it only reaches the adaptive icon, so API 24 and 25 fall back to the
production launcher bitmaps; that is accepted rather than carrying a second set of debug mipmaps.

## Branding Assets

The sources in `assets/` drive every platform icon and splash screen:

| Source          | Drives                                                           |
| --------------- | ---------------------------------------------------------------- |
| `icon-only.png` | iOS app icon, Android legacy and round launcher icons, web icons |
| `logo.png`      | Android adaptive-icon foreground, iOS and Android splash screens |
| `dev/logo.png`  | iOS debug app icon                                               |

`dev/` links back to `logo.png`; it exists only so a generation pass can see the mark without
`icon-only.png`. `logo.png` must stay RGBA: `capacitor-assets` composites the icon background in
the source image's colour space, so a greyscale source silently renders the background from its
red channel alone.

`bun run generate-assets` regenerates everything from those sources. It runs
`scripts/generate-assets.ts`, which owns every `capacitor-assets` invocation and the fixups each
one needs; the package script is only an entry point. Never hand-edit the emitted `mipmap-*`,
`drawable-*`, or `Assets.xcassets` output.

The splash logo is sized per platform because `capacitor-assets` scales the iOS splash logo
relative to the source image but the Android one relative to the target canvas.

The iOS debug icon is generated first, because `icon-only.png` bakes the orange into its pixels
and no background colour can move that icon off brand. That pass reads `assets/dev`, where the
transparent mark is the only source and the colour does apply, and it writes the production icon
set, so the script claims the result into `AppIconDev.appiconset` before the production pass
restores `AppIcon.appiconset`. The Xcode target picks between the two with a per-configuration
`ASSETCATALOG_COMPILER_APPICON_NAME`.

After the Android pass the script rewrites the two `mipmap-anydpi-v26` layer lists to reference
`@color/ic_launcher_background` and deletes the emitted background bitmaps. `capacitor-assets`
insets both adaptive-icon layers into the 72dp safe zone and emits a solid-colour background
bitmap per density; an adaptive background must be full-bleed or launcher parallax reveals
transparent edges. Referencing the colour is also what lets the debug resource overlay give the
debug variant its own launcher icon, so Android needs no generated debug artwork at all.

The run ends with the web icons. `capacitor-assets` writes only into the native projects, and its
`--pwa` mode emits a whole Apple splash set under names of its own, so `public/favicon.png` and
`public/apple-touch-icon.png` are resized from `icon-only.png` with `sharp` instead. `index.html`
links both by name, and generating them here is what keeps them from drifting off the native icons.

## Deep Links

Both platforms register only the variant's bundle identifier. Debug uses `io.ryot.app.dev` and
release uses `io.ryot.app`. On Android the identifier scheme comes from the `${applicationId}`
manifest placeholder, and on iOS from `$(PRODUCT_BUNDLE_IDENTIFIER)`, so neither needs a
per-variant literal.

`resolveDeepLinkHref` maps an incoming URL onto a kernel route. A custom-scheme URL puts its first
path segment in the authority, so `io.ryot.app://settings/account` has to be folded back into
`/settings/account`; `http` and `https` links use their path unchanged. Anything else is ignored.

`startNativeNavigation` is a no-op off native. On native it navigates on `appUrlOpen`, replaces the
current entry for a launch URL, and maps the Android hardware back button onto the router's
history, exiting the app only when there is nothing left to pop. The kernel remains the sole owner
of history, per the single-navigation-stack rule in the design document.

## Overlays And Back

Exactly one mechanism dismisses an overlay, and which one follows from where the overlay's open
state lives. A state-owned overlay — the drawer, the command center, a picker inside a form — only
exists in React state, so it registers a `BackInterceptor` while open and Android hardware Back
closes it before the router sees a pop. Browser Back cannot be intercepted, so on the web a
state-owned overlay leaves with the page it belongs to.

A URL-owned overlay is a history entry instead. The provider add sheet keeps `add` and `q` in the
saved view's search params so it is deep-linkable and survives a reload, so it opens with a push
and registers no interceptor: hardware Back, browser Back, and the left-edge gesture all pop that
entry, and the sheet closes because `add` is gone. Its own close affordances pop the same entry,
falling back to a replace when the sheet was entered directly and there is no pushed entry to
drop. Closing with a push would leave the opened state one Back away, so every Back affordance
would re-enter the sheet instead of leaving the saved view.

An overlay also makes the rest of the page inert, not merely focus-trapped: trapping Tab still
leaves the background reachable by a screen reader's virtual cursor. Portalled overlays get that
from the SDK's `useInertBackground`; the mobile drawer is a controlled overlay rather than a portal,
so the shell sets `inert` on its own content wrapper while the drawer is open.

Modal, menu, focus-trap, scroll-lock, outside-dismiss, and Escape behaviour all come from
`@ryot-app/client-ui-sdk`. An overlay the kernel owns rather than renders through `Modal` or `Menu` —
the mobile drawer, the workspace switcher — still wraps its content in the SDK's `OverlayScope`, so
one mechanism dismisses every overlay and an open one silences the shortcuts behind it. That is why
a route never disables its own shortcuts because an overlay is open. Back interception stays
kernel-owned and travels into the SDK as an injected `onInterceptBack`, which returns `true` to mean
the kernel consumed the close request; the SDK never imports `BackInterceptors`, the router, or
Capacitor.

The drawer is a controlled overlay rather than a `<dialog>` because `showModal()` cannot be dragged
progressively open: the panel and scrim stay driven by the shared progress motion value the edge
gesture writes, and the drawer leaves the tree once that value reaches zero. Its scroll lock is
released through the `unlock` that `useScrollLock` returns rather than effect cleanup, since a lock
that only lifts on unmount lands the next route on a frozen page; `closeThen` restores overflow and
navigates inside one `flushSync`.

Because the shell's content wrapper carries the drawer's motion transform, a route-owned overlay
positions against a `relative` wrapper the route itself renders around its scroll container.
`fixed` resolves against the transformed ancestor, and `absolute` inside the scroller scrolls away
with the content.

## Titles And Landmarks

Every route declares its document title through `usePageTitle`, and the kernel owns the resulting
announcement. Exactly one caller may be mounted per tree, and the rule is most-recent-registration-
wins rather than deepest-wins: React runs effects child-first, so depth is not achievable from
registration order, and recency is what stops an outgoing route's cleanup from clobbering an
incoming route's title. Shared frames that already take a `title` prop — `SettingsFrame`,
`AuthStatus`, `SavedViewNotice` — call it on behalf of every route they render, so their consumers
must not. `PluginHost` is the exception and owns no title: its notice and its iframe are mounted at
the same time, because the iframe must survive the loading-to-ready transition for the bridge
handshake. The active plugin destination owns the title and accepts publication only from its
installation ID and current history `index` and `key`.

The skip link and the route announcer live in `__root.tsx`. Every route renders exactly one `<main>`
carrying `mainContentProps`, including each pending, error, and not-found branch; the plugin-ready
branch wraps its iframe in one, because focus cannot cross into the plugin document's own landmark.

## Sidebar

The desktop sidebar and mobile drawer render the same `SidebarNav`, and its data comes from the
`_authenticated` loader rather than a component fetch.

Sidebar customization renders in two places — the desktop aside, which is shell chrome, and the
`/customize-sidebar` route's `<main>` — so the shell owns the single draft and publishes it through
context. The frame is picked with `useIsDesktop` rather than a CSS `md:` toggle, or both frames put
their switches and drag handles in the accessibility tree at once.

Saving is a plan of saved-view updates and reorders, then leaving, and only then `router.invalidate()`
subscribed to the router's next `onResolved` — never called around the leave. Starting a load aborts
whatever the router has in flight and a pop settles asynchronously through the history listener, so
invalidating on either side of the leave races the navigation and the sidebar goes on rendering the
order the user just changed until a full page load. Loaded navigation data is never patched in place.

## OAuth Runtime Client

`RuntimeOAuthClientService` is the only runtime selector for the first-party OAuth client. For a
server origin it returns the client ID, authorization callback URI, logout callback URI, and the
validated native application ID when running under Capacitor. Web descriptors use the current
server origin and have no native application ID. Native descriptors accept only `io.ryot.app` and
`io.ryot.app.dev`; an unreadable or unknown application ID fails closed before tokens are used.

The native identifiers and callback URI builders live in `@ryot-app/contract/oauth`. Backend client
provisioning and native deep-link filtering consume the same identifiers, so build variants,
registered OAuth callbacks, and runtime validation cannot drift independently.

## Settings

Appearance is device-local: it reads and writes `ThemeStore`, needs no server, and therefore stays
rendered on the preferences route's pending and error branches while the server-backed section
reports its own waiting or failure state. Everything else on the route comes from the
`/user-settings` loader and is saved back through `UserSettingsApi`, one PATCH carrying only the
fields that actually changed.

Account identity is read from the OIDC session store, not from a screen-local copy, so generating a
new avatar calls `refreshAvatar` and then `settledSession(origin, true)`. The forced refresh
re-reads `userinfo` and republishes the session, which is what updates the avatar everywhere it is
rendered; writing the returned image into component state instead would leave the sidebar stale.

The connected server is shown only on native. On the web `ServerService.selected` is always
`window.location.origin`, so there is no origin to choose and nothing to change; on native the
origin is a stored selection, and clearing it is part of signing out rather than a separate action.

Import data and Integrations are two views of the same machinery, so everything neither of them
owns alone lives in `modules/ui/`: the plugin-service catalog (`ui/catalog`), the three-step
pick-configure-review wizard (`ui/wizard`), the run status vocabulary and progress bar (`ui/run`),
the schema-form review rows and icon set, and the shared empty/error `StatusState`. `modules/ui`
holds no feature knowledge — a catalog is grouped and searched over `CatalogEntry`, and each feature
supplies its own `toEntry`, choose label, and step headings. Import-run vocabulary itself is
`modules/imports`, because a run's counts, failure reasons, and outcome label mean the same thing
whether a person started it or an integration did; the integration detail screen reads them from
there rather than keeping a second copy.

Backups is the third view of that machinery and shares all of it, but its archive cannot travel
the same road. The download endpoint is authenticated and returns a byte stream, and a bearer token
cannot ride on an `<a href>`, so `BackupsApi.downloadArchive` is the one request that takes the
header from `AuthenticatedApi.authorization` and fetches the endpoint itself; the bytes then reach
the user through a synthetic anchor. Every other backup operation is an ordinary contract call.

A backup or restore holds the whole account, so only one may be in flight: while a run is live the
list renders it as a card and refuses to start another, and the restore wizard states its
preconditions before it will run at all. Deleting a run removes the record and, for an export, the
stored archive — never anything in the account, which is why the confirmation says so in both
wordings rather than one generic sentence.

`SettingsFrame` is the only owner of a settings route's `<h1>`. A detail screen passes its title and
`meta` to the frame and renders no heading of its own, on either breakpoint — two headings resolving
to one name are both in the accessibility tree, whatever CSS hides.

A run that has not reached a terminal status is polled rather than subscribed: `useRunPolling` ticks
only while the document is visible, at `RUN_LIST_POLL_MS` on a list and the faster `RUN_POLL_MS` on
a single run. Polling stops the moment the run completes or fails, so a settled screen is quiet.

`SettingsFrame` is a thin `AppScreen`, so settings gets the same bar every other mobile screen
gets, with its title collapsing into it. On desktop the settings sidebar is the navigation and the
frame draws no bar at all, leaving the title to scroll inside the frame's `width="readable"` column. The branch is
taken in JavaScript rather than with an `md:` class pair: two headings differing only by a
visibility utility are both in the accessibility tree, and a name that resolves to two `<h1>`
elements is ambiguous to a screen reader and to every query that looks one up by name.

## Secure Storage

`OAuthStorage` owns every OAuth record: the access, refresh, and ID tokens, and the short-lived
PKCE transaction that produces them. Native builds back it with
`@aparajita/capacitor-secure-storage`, which stores values in the iOS Keychain and, on Android,
encrypts them with AES-GCM under an Android Keystore key. The web build keeps `localStorage`,
because a browser has no equivalent; that threat model is unchanged.

The motivation is native-specific. A WebView's `localStorage` is plaintext in the app container,
so a refresh token that lives 30 days was readable from a rooted or jailbroken device and, while
`android:allowBackup` was `true`, eligible for off-device auto-backup. The manifest now sets
`allowBackup="false"`: a Keystore key is never backed up, so a restored copy would be
undecryptable anyway, and refusing the backup states that intent honestly.

The native adapter reaches the plugin through a dynamic import, so it never enters the web bundle
and the plugin's own web implementation — unencrypted `localStorage`, documented as debugging-only
— can never be reached. It applies three settings before the first operation:

- `setKeyPrefix("ryot_")`. The plugin prepends its prefix on write and strips it from `keys()`,
  and its default is `capacitor-storage_`. Setting it explicitly is what keeps both adapters
  enumerating the same logical `ryot:oauth:*` keys, which is what `clearPending` scans for.
- `setSynchronize(false)`, so refresh tokens never reach the iCloud Keychain.
- `setDefaultKeychainAccess(afterFirstUnlockThisDeviceOnly)`, which keeps records readable at a
  cold launch while blocking migration to another device.

A native build whose plugin is missing fails loudly rather than degrading to plaintext, which
would defeat the point.

Reads distinguish a malformed record from an unreadable store. Malformed data is evidence the
record is bad, so it is evicted; a Keychain or Keystore failure is not, so it reports "no session"
and leaves the record in place — a locked device must not cost the user their refresh token.
Writes carry a typed error instead, because a silently dropped record surfaces much later as an
unexplained `missing-authorization`.

Two behaviours are worth knowing rather than rediscovering. iOS does not delete keychain data when
an app is deleted, so a reinstall inherits the previous install's tokens. And a failed write during
`completeAuthorization` cannot be recovered in-flow: the pending record and the authorization code
are both already spent, so sign-in has to start over.

Adding or removing a Capacitor plugin regenerates `android/capacitor.settings.gradle`,
`android/app/capacitor.build.gradle`, and `ios/App/CapApp-SPM/Package.swift` through `bun run
sync`; all three are tracked and must be committed.
`android/app/src/main/assets/capacitor.plugins.json` is generated as well but is gitignored.

## Commands

```sh
bun run dev              # web dev server on :3005
bun run generate-assets  # regenerate native icons and splash screens from assets/
bun run sync             # build the web bundle and copy it into both native projects
bun run ios              # sync, then build and run the Debug variant
bun run android          # sync, then build and run the Debug variant
```
