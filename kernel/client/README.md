# Kernel Client

The kernel is one React DOM application: browsers run it directly, while iOS and Android run the
same build in Capacitor WebViews.

## Ownership And Isolation

The kernel owns authentication, server selection, the single global URL and history, artifact grants,
bridge dispatch, and all native and platform authority. Plugins own domain UI and behavior.
Routes publish plugin routes, entity pages, saved views, and workspace homes to the shell-owned client
page document host. Compatible prepared pages share a compiled React DOM artifact in a sandboxed,
opaque-origin iframe.
Plugin and entity pages share `modules/pages/documents/page.tsx` for host entity-picker and collection
screens. Saved views retain their URL-owned provider-add screen.

`modules/publications` owns publication management in settings, the share sheet that answers
`screens.sharePublication` from collection and saved-view pages, and the unauthenticated
`/share/$publicationId` visitor route. Settings creates publications from published user pages and
binds optional owner arguments through the schema form. Collection and entity-browser sharing binds
the kernel publication page's encoded `source` argument. Both use one publication definition with
page, arguments and mode. Live follows the latest published page and current data; snapshot freezes
page code and the first page of every declared query until the owner refreshes via republish. The
management surface exposes mode, refresh, status, links, visitor preview, revoke and delete.

The visitor route takes the link secret or owner preview session from the URL fragment, clears the
fragment, keeps credentials in tab-scoped session storage, and runs the publication page in the same
sandboxed iframe host. Its bridge accepts named page queries and descriptions only, using the visitor
session's authority; documents, arbitrary page IDs, writes, operations, uploads and kernel screens
are refused. Presentation reads use only projected query fields, with no fallback loaders. Snapshot
pages cannot use server-dependent interactions such as search, filters, sorting, pagination or detail
navigation. Live entity navigation becomes the `item` search parameter on the same route, so the
browser back button returns to the list. Owner previews open in the app with a banner to exit; they
never use the link secret. Visitor user preferences use the defaults (UTC, ratings out of 100).

`modules/plugins` owns installation management and the executable catalog. `modules/pages` owns how
a prepared page executes: `preparation` resolves targets and freshness, `documents` owns the
published document and its `srcdoc`, `runtime` holds the document host that retains composition
runtimes and the iframe host that runs one frame, and `bridge` owns the port session and its
capability producers.

The iframe receives no bearer credentials and has no direct Capacitor access. Its only privileged
connection is the `MessagePort` transferred by the kernel after both peers validate the bridge and
artifact identity. Plugin requests cross that port as narrow, schema-checked capabilities; the kernel
applies authentication, installation scope, and platform policy. A plugin upload sends only bytes with
a proposed file name and content type; the kernel keeps intent creation, transfer, and completion.

Bridge requests run in fibers interrupted on document replacement/session close. RyotQL and asset
cancel messages interrupt their matching work. Capability producers classify expected failures; the
bridge validates/encodes replies, substitutes safe failures for malformed results, reports defects
internally, and suppresses interrupted or stale replies. SDK operations and cancellation contracts
are documented in the [client SDK](../../packages/plugin-client-sdk/README.md#capabilities).

The kernel backs plugin device storage through `ClientStorage` because opaque-origin frames have no
`localStorage`. Values survive logout and are isolated by server/user/plugin/key. Contributor checks
bound the frame, not mutually trusting modules within its realm; see the
[SDK storage contract](../../packages/plugin-client-sdk/README.md#capabilities).

Client artifacts are immutable, content-addressed outputs of a compile-only contributor graph.
Shipped client-page builds are materialized during server boot, including when the database has no
users. Plugin and renderer mutations materialize affected builds; user bootstrap checks that its
required builds already exist without invoking the compiler. Navigation preparation only resolves
the current page and finds its global build. A new frame fetches its document once from the
authenticated document endpoint and renders it into `srcdoc` with `sandbox="allow-scripts"`, so the
frame keeps an opaque origin and never has a capability URL as its document URL. The document's
`<base>` is the selected server origin, followed by a `no-referrer` policy, because a `srcdoc`
document otherwise inherits the host's base URL and referrer policy. Its private artifact URLs carry
expiring grants; immutable cached files keep working after expiry, and a failed bootstrap offers a
retry that reprepares into a new frame. A separate freshness check on catalog invalidation detects
changed page or plugin state and offers an explicit reload. There is no plugin-owned artifact
selection or grant route.

The kernel resolves every committed URL explicitly. Kernel routes render kernel surfaces;
`/p/<publisher>/<name>/*`, `/v/p/<publisher>/<name>/<slug>`, `/v/c/<savedViewId>`, `/v/k/<slug>`, and
`/e/:entityId` resolve to client-page targets for plugin routes,
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

Saved-view search, filters, sort, and layout changes update the active document's location without
preparing a new page. Leaving the route discards its loader cache, so returning reads the current
view and device layout. Explicit invalidation still reloads the prepared page.

Analytics uses this same saved-view location path. The route validates only its own search keys;
renderer-owned parameters such as the analytics selection pass through in-place updates and history
restoration unchanged.

Document-declared page shortcuts register in the kernel realm alongside iframe registrations and
are removed when the bridge closes. The desktop sidebar and mobile drawer share the authenticated
loader's navigation data; consumers do not mutate that snapshot.

Protocol schemas and bridge identity live in
[`@ryot-app/plugin-client-contract`](../../packages/plugin-client-contract/README.md). SDK runtime
behavior lives in [`@ryot-app/plugin-client-sdk`](../../packages/plugin-client-sdk/README.md), and shared screen and
interaction rules live in
[`@ryot-app/plugin-ui-sdk`](../../packages/plugin-ui-sdk/README.md).

## Page Authoring

Settings → Pages uses the owner-scoped `pagesRecipe` and `pageRecipe` through shared Ryot queries.
`modules/page-authoring` owns source upload/paste and definition inputs, revision-fenced draft
replacement, compile diagnostics, publishing, owner write grants, deletion and page saved-view
creation. Files remain canonical base64 bytes, including uploaded assets. There is no full editor,
settings schema, or saved-view query binding; page code supplies query values.

Local definition changes clear the preview selection. Compile uses the saved draft revision; its
metadata supplies the exact `PageDraftBuildIdentity` to `/page-preview/$pageId`. That route prepares
and publishes through the existing client-page document host. Preview authority is always read-only.
A stale revision blocks further save/compile/publish until the user explicitly reloads and discards
local changes. Published page views use the regular saved-view route and navigation.

## Application Services

`AuthenticatedApi` and `AdminApi` are the only services that run contract programs, and `ClientLive`
does not export them. Other modules depend on narrow group ports such as `RyotQLApi` or
`SavedViewsApi`; adding an endpoint widens its owning port rather than exposing the full client.

Authenticated kernel settings and account screens load and change data through the same shared query
and mutation layer as client pages. Route loaders retain access decisions, redirects, and not-found
checks. Permanent direct-service exceptions are pre-authentication routes, which have no authenticated
API scope; Instance Admin, whose administration calls are scoped by its token; and the catalog-dependent
workspace redirect, which must resolve before rendering.

`boot/layers.ts` merges feature-owned layers for authentication, server selection, navigation,
plugin requests, entity interest, client pages, assets, and other features. `api/layer.ts` builds the
shared contract transport and group ports. Feature layers capture their own implementation ports;
the boot graph does not construct each dependency for them. Every `ClientLive` layer must be
synchronously constructible because `main.tsx` creates the runtime with `runSync`. Asynchronous
setup belongs inside service operations.

File downloads share `modules/downloads/file.ts`: web clients fetch a Blob and save it through a
synthetic download link; native clients download directly to a temporary cache file and open the
system share sheet. The temporary directory is removed after completion or failure. Backup downloads
obtain their bearer header inside `BackupsApi`; server-log downloads keep their admin-token header
inside `AdminApi`. Links and text that users pass on go through `modules/device/share.ts`, which
opens the system share sheet on native clients and copies to the clipboard on the web.
`useShareAction` binds it to the UI SDK `CopyField`; token-scoped Instance Admin screens, which run
outside the Ryot provider, build it with `shareActionWith` and their route runtime.

`EntityWatchService` opens no event stream when a client is constructed. The authenticated layout owns
the active server/user session and releases it on logout, scope change, or unmount. Plugin documents
have one subscription outside the request table, released by the common iframe finish path. See the
[entity interest protocol](src/modules/entity-watches/README.md).

## Background Submissions

`modules/background-submissions` owns shell-run plugin writes. `BackgroundSubmissionService.open`
creates the authenticated layout's tray for one server/user scope; the layout disposes it on unmount,
and the tray empties itself, interrupting in-flight attempts, whenever the server's login handle is
cleared or replaced, including a same-user login. Inputs and labels live only in memory. The
server-side outcome of an interrupted attempt stands, but the tray does not claim it.

A `background-operation-request` is accepted only from the active, non-inert frame with no pending
update, and only for a package that is both a `plugin` contributor of that frame's identity and one
of its operation targets with the same installation. The tray also requires the installation in
the catalog, whose name attributes the entry. Acceptance goes through the bridge request table, so
interrupted or stale replies are suppressed; the reply is posted before the attempt starts, and a
suppressed reply cancels the reservation. `BACKGROUND_SUBMISSION_LIMITS` caps in-flight attempts
per tray and per bridge session and the tray's entries; when full nothing starts. Pending entries are
never evicted: the oldest success goes first, and with only failures left the request is refused.

Each attempt runs `PluginOperationsService.invoke` outside the bridge session with the target's
content hash captured at acceptance. A successful result whose top-level object has
`status: "incomplete"` (optionally with a numeric `count`) is shown as incomplete. A stale revision
becomes `app-updated`, which is final and offers Reload; its copy says the write may have been saved
if an earlier attempt ended in `transport`. Retry is offered for `transport`, `malformed-result`, and
incomplete entries while the captured installation is still in the catalog, and resends the identical
input, idempotency key, and content hash. `operation-failed` and `operation-rejected` (with its
message) are final. Successful results hint `mutationCompleted`, refreshing pages, and auto-dismiss
after six seconds; failures stay until dismissed. `background-operation-settled` reaches the
accepting document only while its bridge session is active and the document has not been replaced.

The shell renders the tray through the UI SDK `ActivityTray`: a bottom-right stack on desktop and a
bottom sheet above the safe area on compact screens. Labels are text nodes; status words, Retry,
Reload, Dismiss, and plugin attribution are kernel-owned. One polite live region announces changes,
throttled to one announcement per two seconds with bursts coalesced.

## Navigation And Screens

`resolveEdge` separates visible leading intent (`back`, `drawer`, or `none`) from interactive edge
ownership. The kernel grants a plugin the back edge only after the active document reports a previous
screen for the current history `index` and `key`. The plugin executes a granted gesture and posts
`navigate-back`; the kernel performs the pop. Per-frame gesture data never crosses the bridge.

The kernel also sends `compact` and safe-area insets. An iframe measures its content area, not the
outer viewport, and `env(safe-area-inset-*)` is zero there. Plugins must use these kernel values for
layout and custom chrome. Kernel surfaces can use CSS `env()` directly.

Kernel `AppScreen` and plugin `PluginScreenFrame` share the
[UI SDK frame](../../packages/plugin-ui-sdk/README.md#screen-frame). The kernel accepts title/readiness
messages only from the active installation and current history entry.

`historyEntry` is the only code that may read TanStack Router's `__TSR_*` state. Every navigation path
must supply an `index` and `key`.

The bridge reports a 422 `PluginOperationRejected` as `operation-rejected` with the operation's
message; other declared platform failures are `operation-failed` and unrelated causes are `transport`.
Provider search names its failure: a `search-failed` refusal with cause `missing-config` shows which
configuration field is missing, `provider-error` says the provider could not complete the search, and
only real transport failures show the connection message.

Saved-view renderers own their title and icon inside the iframe. Entity-browser layout selection is
stored locally, with explicit URL state taking precedence. Plugin routes host the entity picker
screen (`modules/provider-add`); plugin, entity, and saved-view documents host the collection editor,
add-to-collection, and bulk collection-member screens, collection review management
(`modules/collections`), and reminder management (`modules/reminders`).
The bridge allows one pending host screen per frame across types, and the document is inert while any
screen is open.
The collection membership screen stays open after adds, detail edits, and removals, returning to its
searchable collection list. Closing it reports the last membership change, or cancellation if none
was made. Collection-specific requests open that membership first; Back returns to the list.
The bulk collection-member screen shares that collection list and membership-field form. Adds pick
a collection, collect its membership fields once for every item, and add only absent members;
removals confirm first. Both write each membership through the ordinary collection commands with
bounded concurrency, show progress, keep failures for retry, and report `changed` when any write
succeeded, including after closing mid-run, which interrupts the remaining writes.
Saved views accept only library picks matching their explicit `addAction` owner and schema; that
modal remains open after import and refreshes the page when it closes. Library picks create through
the catalog `createRoute` when one exists; otherwise, and always for plain picks, creation uses the
inline form for a server-declared `editor` saved through the kernel editor endpoint, else none.

### Command Center And Sidebar

The command center (`modules/command-center`, opened by Mod+K, the sidebar Search row, or the
forwarded iframe shortcut) is a combobox dialog over the shell's overlay arbitration; Escape and
hardware Back close it through the shell back interceptor. Groups:

- **Go to**: non-hidden saved views, collections, visible plugin homes, and fixed kernel pages
  (settings sections, Customize sidebar), matched by case-insensitive substring.
- **Library**: one group per visible `entity-browser` saved view whose settings declare search
  fields. The view list comes from `savedViewRecordsRecipe`; each view is queried with its own
  `dataSources` and settings through `entityBrowserRecipe` (`searchText`, `pageSize` capped at 5), and
  up to three rows are shown. Searches run on the SDK schedule: a 250ms debounce, interruption of
  every superseded search, and a pending or error-with-retry row per group.
- **Actions**: for views whose `addAction` is `provider-search`, "Search providers for ..." navigates
  to the view with `?add=true&q=<query>`. The saved-view route already opens the provider-add modal
  from `add` and seeds it from `q`, so no new prefill mechanism exists. `plugin-route` add actions are
  not offered.
- **Recent**: with an empty input, the last eight destinations opened from the command center,
  stored per server/user scope. Storage access is best-effort and the dialog renders without it.
- **Ask**: while searching, a final row asks the assistant the typed text. It never takes the default
  selection, so Enter still opens the top result.

The sidebar and mobile drawer share one overflow rule: a section with more than seven items shows the
first seven plus a "Show N more" / "Show less" disclosure. The active item is always visible: it
auto-expands the section unless the user collapsed it explicitly, in which case it stays pinned.
Disclosure state is stored per scope, workspace installation, and section.

The workspace switcher derives the current workspace from the route package, the active saved view's
installation, or the prepared page identity of an entity route (`plugin-page` installation), and
only then falls back to the remembered workspace.

## Overlays And Back

Overlay dismissal follows ownership:

- React-state overlays register a `BackInterceptor`; Android hardware Back and the kernel's
  overlay edge-swipe close them before history is popped, including at a workspace root.
- URL-state overlays push a history entry and close by popping it, with replace only for direct
  entry. They do not register an interceptor.

Browser Back cannot be intercepted. All overlays make background content inert and use the UI SDK's
focus, Escape, outside-dismiss, shortcut-scope, and scroll-lock primitives. Back interception remains
kernel-owned; the UI SDK does not import the router or Capacitor.

Every route has one `<main>`, one `<h1>`, and one `usePageTitle` owner, including pending, error,
not-found, and plugin-ready branches. The root owns the skip link and route announcer.

## Native Builds

`modules/device` owns scheduled alerts, screen-awake demand, foreground haptics, and scoped return
shortcuts. The root registers native listeners once; the authenticated shell supplies the current
server/user scope. Scope changes cancel departing alerts. Notification taps wait for matching
authentication and navigate through semantic page targets. Frame disposal releases awake demand but
does not cancel intentional alerts. Local metadata contains only scope, installation, key/native-ID
mapping, and shortcut targets; plugins own their draft data and deadline reconciliation.

iOS suppresses notification presentation while foregrounded; plugins own foreground feedback.
Returning to the app clears delivered local alerts without cancelling pending alerts or their tap
targets.

### iOS Live Activities

The kernel registers the native capability with its custom bridge view controller and renders
ActivityKit cards in the Live Activities widget extension. The iOS 16.2 feature does not change the
app's iOS 15 minimum; Android and web are unsupported. Debug and release widget-extension identifiers
are `io.ryot.app.dev.liveactivities` and `io.ryot.app.liveactivities`.

The kernel derives an opaque native owner from server, user, and installation scope; native IDs never
reach plugins. There is at most one active card per installation and four across the app, subject to
OS limits. Cards survive iframe eviction. Scope changes, logout, and plugin catalog removal end
cards; hiding a plugin does not. The native registry recovers ActivityKit activities and retains
ended or dismissed keys in a bounded 128-record registry; terminal records older than eight hours
are pruned when a new activity starts.

The system renders timer values from dates without per-second JavaScript or native updates. A stale
date does not act as an exact alarm or continue timer progression; notifications use the separate
scheduled-alert capability. The compact Dynamic Island shows the secondary value when supplied,
otherwise the primary value. This keeps the overall elapsed timer visible during a countdown without
depending on a stale-state refresh to switch back. Expanded and Lock Screen presentations retain the
primary countdown and secondary value. The feature uses no third-party package, app group, or push service. The
native recovery policy is pure Swift, and the App compiles the same policy source. Run its tests with
`swift test --package-path kernel/client/ios/LiveActivityPolicy` from the repository root. Acceptance
also requires a physical iOS device with the debugger detached.

Android scheduling first creates an inexact alert, then upgrades through the non-prompting update
API when exact-alarm access is available. This avoids an automatic Settings redirect if permission
changes during scheduling. Revocation and Doze can still delay or remove alerts. Audible alerts use
the system sound. `res/raw/silent.wav` supplies silence on Android 7, where notification channels do
not exist. Web alerts require notification permission and a running host; closed-browser delivery is
unsupported. No alert availability result replaces a plugin's persisted deadline.

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

OAuth connection returns are the routing exception: the live attempt's `DeepLinkClaims` claim
receives them instead of the router. `/oauth/login`, its signed `oauth_query`, and its independence
from `ServerService` form the server contract.

`/oauth/consent` reads server-verified consent details before showing a registered app's name,
redirect origin and identity permissions, and offers the write access levels up to the requested one.
`HostedAuthService` submits the original signed query and the chosen scopes to Better Auth's
`oauth2.consent` API for both approval and denial; its client handles the provider's continuation
redirect. Settings → Access lists connected apps and API keys through one credential list and
revokes either. Missing hosted sessions return to `/oauth/login` with that query intact, so
password, OIDC, two-factor and account initialization continue through the existing hosted flow.
The page never uses an app name, redirect origin or scope read directly from the browser query.
First-party authorization still follows the provider's existing consent-skipping policy.

`RuntimeOAuthClientService` is the only runtime selector for first-party OAuth. Native builds accept
only `io.ryot.app` and `io.ryot.app.dev` and fail closed on an unknown application ID. The identifiers
and callback builders are shared with backend provisioning and deep-link filtering.

Web `/auth` redirects to the hosted login immediately. Native `/auth` waits for the user to continue
or change server, so dismissing the browser or completing logout returns to that choice instead of
reopening the hosted login.

Instance Admin impersonation uses dedicated web/native OAuth clients and replaces the current login. The
initiating client retains its PKCE verifier while `/oauth/impersonate` redeems a one-use handoff in the
hosted browser. The callback restarts the application document to discard the previous runtime. A
kernel banner shows the target and fixed expiry; stop and expiry return to locked Instance Admin without
restoring the previous login. Web tabs reload on session identity changes, but not token rotation;
authenticated requests reject stale user scopes.

`OAuthTokenService` owns one authorization record per server, including the session snapshot and
refresh/UserInfo flights. New authorizations replace the handle; token rotation retains it. Clears
invalidate it, and only the originating current handle can persist rotated tokens or publish a
profile. Storage mutations are serialized per server without holding the lock across HTTP requests.
`AuthService` projects that same record. Detached work survives navigation cancellation but cannot
restore a cleared login or overwrite a replacement login's tokens, profile, or access class.
Temporary storage read failures can be retried. An explicit clear disables in-memory restoration
until a new authorization commits, even if storage deletion fails.

## Assets

`assets/icon-only.png` drives app and web icons, `assets/logo.png` drives adaptive foregrounds and
splash screens, and `assets/dev/logo.png` drives the iOS debug icon. Keep `logo.png` in RGBA format;
`capacitor-assets` otherwise composites its background incorrectly.

Run `bun run generate-assets` after changing source art. `tooling/generate-assets.ts` owns generation
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

### Authored Page Authority

The bridge session applies the prepared page renderer's authority to every contributor in the iframe.
It rejects query and describe sources except the current page's named queries. Draft previews must
match the exact compiled revision, definition hash and artifact hash; the bridge binds execution to
that prepared source. Page query values remain authored client inputs.

Draft operation calls always fail with `page-write-access-required`. Published calls require the
prepared grant and send only the host-derived `PageOperationAuthority` to the operation endpoint.
Background reservations retain this authority on their target and resend it for every attempt,
including tray retries. A server refusal settles the submission without offering a retry.

The session refuses direct entity/collection writes, enrichment, uploads and calendar visibility
changes from page frames, and closes mutation screens without opening them. These rules apply to
imported plugins too. Ordinary plugin frames retain their capabilities. The preview route
`/_authenticated/page-preview/$pageId` uses the same document host and bridge lifecycle.

## Ryo

`modules/assistant` owns the assistant panel, the `/assistant` routes and `/settings/assistant`
provider settings. Product copy names the assistant through `ASSISTANT_NAME`; routes and code say
`assistant`.

The shell owns `useAssistantPanel`, which opens the panel beside the content column on regular
layouts and as a `Modal` sheet on compact ones. It renders inside the shell's context providers so
drafts and previews resolve the edge and chrome. The sidebar and drawer "Ask" row, `Mod+J` (also
forwarded from plugin frames), the command center's Ask row and the activity-tray Review action all
open it. The panel keeps its last conversation while closed; the command center's ask starts a new
one with the typed question. "All conversations" closes the panel and opens the matching route.

`/assistant/new` starts a chat full screen; the first submission creates the conversation and
navigates to `/assistant/$conversationId`. Regular layouts keep the conversation list beside every
Ryo screen; compact layouts show the list at `/assistant` and push the start and thread screens.
`AssistantConversation` and `AssistantStart` own the transcript, composer and dialogs; the route
supplies an `AppScreen` frame and the panel supplies its own header and scroller. Both frames hold
the composer below the transcript and pass `followEnd`, keyed by the latest turn, to
`useFollowEnd`, which keeps the end in view until the reader scrolls back.

`AssistantSprite` draws Ryo with a mood. Conversation status maps to idle, working, waiting
(`awaiting-approval` or `awaiting-input`) or oops (`failed`); an active turn whose latest step is reasoning shows
thinking. A sprite that leaves working or thinking for idle hops for a moment. Reduced motion keeps
the poses without animation. `assistantActivityRecipe` feeds the sidebar row's mood and the
activity-tray entries for conversations awaiting approval or an answer.

The transcript pages turns newest first and renders `projectAssistantTurn` output: the prompt, step
groups, Markdown replies, approvals, page drafts, messages sent mid-turn, a marker where earlier
context was summarized, the latest plan as a checklist and question cards, then the turn's queued
messages. Kernel tools are labeled here; capability
approvals use the owner's `title` and render input through `JsonSchemaValues`. Approval decisions
use the canonical call revision. Turn submission and page save retain identical request IDs and
inputs for retries. While a turn works the composer offers Stop and still sends messages, which the
turn receives at its next step; while it awaits approval or an answer the dock points to the
pending card. A question card takes chosen options and free text and sends one answer per question.
Conversations awaiting approval or an answer set the sidebar row's waiting mood and add an
activity-tray entry unless that conversation is open in a route or the panel. Provider settings
include the context window and output limit, prefilled with the defaults.

`assistant-updated` live frames enter the existing scope-fenced entity-watch transport and refresh
canonical queries through `mutationCompleted`. Reconnect uses that same invalidation path. There is
no separate assistant connection or polling loop.

Draft previews use `pages/runtime/embedded-preview`, which mounts `page-document-host` for each
compiled identity with the existing authenticated `srcdoc`, opaque origin, read-only draft authority
and cancellable bridge. Embedded frames do not publish shell titles, navigate the conversation or
register page shortcuts. Saving calls `assistant.savePage` with `page-authoring/identity-fields`,
which the Pages manager also uses; sharing reuses the user-page publication editor with the saved
page selected, including snapshot mode.
