# Client SDK

The client SDK provides environment-neutral application APIs for kernel and plugin callers. The
[shared client runtime](../plugin-client-compiler/README.md#vite-module) supplies its implementation.

## Bridge Bootstrap

Bootstrap accepts one port from `window.parent` only after validating embedded metadata, and checks
init/ready identity against that metadata rather than echoed input. Wire details belong to the
[bridge contract](../plugin-client-contract/README.md).
Production bootstraps construct a live SDK runtime per page. Tests use `createTestRyotClock().bootstrap`
when mounting a page against that harness's clock; each page owns and disposes its SDK runtime,
including its schedule scope, while the harness owns the clock. Concurrent harnesses are independent.

The generated entry calls `bootstrapComposition` from `./bootstrap`, which is not importable by plugin
source. It reads the embedded descriptor, parses it as JSON, and decodes it with the contract
descriptor schema before dynamically importing the selected modules and calling the page or plugin
bootstrap; each failure stage has its own error.

The port carries no bearer token, server URL, or user identity. Authenticated page context carries
nonsecret contributor package, local plugin, revision, and installation identities.
`usePluginIdentity(packageId)` and the non-React `client.pluginIdentity(packageId)` accessor return
the exact `{ kind: "local", pluginId }` binding from that same contributor set. Missing or ambiguous
membership fails; neither accessor supplies an ambient page-wide `self` owner.
Reserved `Mod+K` and `Mod+Shift+Space` shortcuts are forwarded as semantic kernel messages,
not raw keyboard events or public `RyotClient` capabilities. An active plugin `OverlayScope`
suppresses forwarding.

`usePageShortcut` binds a modifier-free key in this document and registers it with the kernel, which
binds the same key in its own realm and sends a press message back. Key events never cross the
boundary, so exactly one document sees any press and each realm's overlays suppress only their own
registrations.

## Capabilities

Capability failures use the canonical `RyotClientError.reason` values in the
[bridge contract](../plugin-client-contract/README.md). Preserve typed reasons; never interpret error
message text.

Asynchronous client capabilities and `RyotClientAdapter` operations return `Effect` with
`RyotClientError` in the failure channel. Client-only plugin code imports `Effect` from
`@ryot-app/plugin-client-sdk/effect`; the neutral shared-code `@ryot-app/plugin-kit/effect` surface
does not export it. Interruption cancels an in-flight RyotQL or asset request over its existing
bridge cancel message. Other capability requests have no per-request cancel message; interruption
still removes their local pending completion.
React query/mutation definitions return Effects that Atom runs directly;
`mutateEffect` composes mutations as Effects. Storage hook methods return Promises at the React
integration boundary.

`operations.invoke` encodes `input` through the required `inputSchema` and decodes the result through
`output`; an input that does not encode fails with `invalid-input`. A successful operation notifies
mutation listeners by default. `refreshOnSuccess: false` suppresses that notification for read-only
context operations, so a page-refresh handler does not trigger itself again, and for writes whose
caller calls `mutationCompleted.hint()` itself once later steps such as navigation finish.

`readCursorPages(read, { maxPages? })` pages a cursor-paginated read to exhaustion and returns
`{ items, hasMore }`. It fails with `malformed-result` on a missing or repeated cursor. With
`maxPages`, it stops after that many pages and reports `hasMore: true` when rows remain.
`useAssetUrl(asset)` resolves a managed asset through the nearest `ManagedAssetProvider` and returns a
remote asset's URL directly.

`uploads` is one capability on every adapter that hides intent creation, byte transfer, completion,
and cleanup. `uploadTemporary({ source, fileName, contentType })` returns a `TemporaryUploadToken`;
`uploadPermanent` with the same request shape returns a `ManagedAssetLocator`; `cleanup(asset)` returns
`{ status: "deleted" | "referenced" }` and rejects missing or foreign assets. Only a record owned by
the caller or by no one that holds that exact locator keeps it
`referenced`. Bridge payloads are structured-clone values, so file uploads send a `Blob` or `File` with a
file name and content type, while cleanup sends only the managed locator. The host keeps the intent, upload URL, headers, and credential. A non-`Blob` source
fails with `invalid-input`. There is no cancellation; disposal aborts an in-flight request.

`storage.get(pluginId, key)`, `storage.set(pluginId, key, value)`, and
`storage.remove(pluginId, key)` keep JSON values on this device through the kernel, because the
plugin iframe has no `localStorage`. Values are scoped to the server, user, plugin, and key, survive
logout, and are not synchronized. Keys are 1 to 128 characters; a malformed key fails locally with
`invalid-input`. The kernel rejects a value over 64 KiB of UTF-8 JSON, or an ID that is not a plugin
contributing to the frame, with `invalid-request`, and a full browser store with `quota`. Plugins in
one frame share a realm and cannot be isolated from each other, so the ID check is only against the
frame's own contributors. Device keys encode `[server, user, localPluginId, key]` as a canonical tuple.
`usePluginStorage({ pluginId, key, schema })` reads once per local ID and key,
treats an undecodable or unreadable value as `null`, and updates its value before persisting a `set`
or `remove`. `createTestPluginStorage` from `./testing` supplies a Map-backed adapter capability.

Recoverable drafts use the storage capability directly, not `usePluginStorage`: missing values are
`null`, while inaccessible or malformed stored JSON fails without removing the original value.
Register an Effect with `persistence.registerFlush` to make navigation and document replacement wait
for durable input. A failed flush keeps the document open; remove the registration on disposal.

`device` accepts plugin-scoped `schedule`, `cancel`, `awake`, `haptic`, and `return-shortcut` actions.
Scheduling takes one key, UTC deadline, bounded title/body, semantic navigation target, and audible
flag. It reports `scheduled`, `inexact`, `denied`, or `unsupported`; cancellation removes pending and
delivered alerts. Native IDs and authenticated scope never cross the bridge. Awake demand and haptics
apply only to active foreground pages. Return shortcuts persist only a label and navigation target.
Haptics use `kind: "impact"` for pickup and `kind: "selection"` for reorder drops.
Scheduled alerts own their completion sound; callers must not duplicate it with application audio
when scheduling reports `scheduled` or `inexact`. Muting uses a silent alert instead.

`client.iosLiveActivities` provides `availability`, `start`, `update`, `end`, and `list` Effects. Every
request includes `pluginId`; `start` and `update` also require a key and complete content, while
`update` never creates an activity. `end` accepts optional final content and `dismissalSeconds` from
0 to 30. `list` is scoped to that plugin. Starting requires the calling plugin frame to be active in
the foreground. This capability is supported on iOS 16.2 and later; Android and web are unsupported.

Content requires a title, status, primary value, icon, tone, and metrics array (up to two label/value
pairs). Values can be text, duration, elapsed time from an ISO timestamp, or a countdown with ISO
start and deadline timestamps. Optional fields are detail, secondary value, progress from 0 to 1, and
staleness date/message. Content is limited to 3072 UTF-8 bytes; the native host also checks that the
combined attributes and content remain below 4096 bytes.

`assets.resolve` accepts 1 to 64 managed local or S3 locators and returns signed URLs with expiry.
Remote images do not use it. `ManagedAssetProvider` owns stable sorting, deduplication, batches of at
most 64, retained URLs during refresh, and renewal before the earliest expiry; kernel and plugin
renderers are callers of this SDK behavior. Disposing a bridge session aborts pending resolution, but
an issued URL remains valid until expiry.

Browser uploads to S3 require bucket CORS rules that allow `PUT` with `Content-Type` and enabled tracing
headers from the application's origin. Signed downloads used by browser code also need the appropriate `GET` and
`HEAD` rules. Configure these on the bucket; the SDK does not change storage policies.

`screens.pickEntity({ schema, initialQuery?, library? })` is the only kernel screen capability. It
carries an exact `EntitySchemaReference` and returns an Effect with `{ kind: "selected", entityIds }`,
`{ kind: "cancelled" }`, or `{ kind: "create-requested" }`. With a `library` membership the kernel
shows provider search with in-library badges and imports; without one it lists visible entities of the
schema, provider results that are not yet materialized, and a create action. Library picks navigate to
the schema's catalog-declared `createRoute` when it has one (returning `create-requested`); otherwise,
and always for plain picks, a schema with a manifest `editor` gets an inline name and properties form
that saves through the kernel editor save and returns the created entity as selected; otherwise
creation is not offered. The kernel keeps one picker
open at a time and the page inert while it is open. After a successful import or creation, the host
sends one narrow `page-refresh` signal. Client pages can register their
current source refetch with `usePageRefresh`; successful shared mutations use the same refresh registry.

## Queries And Mutations

Query inputs identify cache entries. Rolling queries use stable selections such as range and time
zone, then compute request timestamps from the query context's `schedule.now()` during execution.
Refreshing an existing query retains loaded data with `isFetching: true` and `isPending: false`;
failed refreshes also retain the last successful data. A different input selects a different cache
entry and does not inherit unrelated data. Presentation clocks must not change rolling query keys.

## Pagination

`useRyotInfiniteQuery` composes an existing query with a stable selection, an initial page parameter,
`getPageInput`, and `getNextPageParam`. Pagination parameters are separate from the selection identity.
The hook owns page accumulation and registers one refresh handler; callers do not register another
query refresh for the same collection. Query-declared entity interests cover all loaded pages.

`usePagination` provides the same state machine for Effect-returning loaders outside `RyotProvider`,
including token-scoped administration and numbered provider searches. Its optional `enabled` flag
supports explicit search admission. Loaders receive the page parameter and whether a fresh request
is required. `mode: "replace"` supports increasing-limit queries whose responses contain overlapping
prefixes; the default appends independent pages. `paginationItems` deduplicates selected items by
caller-supplied keys, retaining the latest values in first-seen order. Media pages can instead render
`pages` individually to preserve page-local asset ownership.

`isPending` describes initial loading; `isRefreshing` describes replacement of already loaded pages;
`isFetchingNextPage` describes an explicit append. `isFetching` covers all three and may disable
interaction, but must not drive a load-more label. `errorOperation` distinguishes initial, refresh,
and append failures; `retry` repeats the failed operation without discarding successful pages.

Only one operation runs at a time. Duplicate append requests are ignored, and refresh hints during
an active request coalesce into a follow-up refresh. Refresh traverses the loaded depth using newly
returned cursors, publishes the replacement atomically, and never fetches another page beyond that
depth. Increasing-limit refreshes retain their expanded limit. Failures preserve the previous pages
and continuation; identity changes and unmount interrupt old work and reject late results.
`nextPageCursor` and the shared core reject missing, empty, and repeated continuations instead of
looping. Backend batch traversal remains separate from user-driven pagination.

## Retryable Submissions

`useRyotSubmission(mutation, { isComplete, createId })` composes an existing mutation whose input is
`RyotSubmission<Input>` (`submissionId`, `submittedAt`, and `input`). It captures and freezes a structured-cloneable
plain-data input on `submit`, blocks another submission immediately, and retains the same snapshot
and ID on failure or an incomplete result. `retry` resends that snapshot. `abandon` releases retained
work, but cannot interrupt pending writes or undo committed writes. The default completion predicate
accepts successful results; domain callers provide a predicate for partial outcomes. IDs default to
UUIDs; tests can inject their generator. The submission timestamp uses the SDK clock and is retained
across retries.

The helper provides no server durability, automatic retries, persistence, or error interpretation.
Use it only where the owning backend write enforces retry safety. Fields, recovery messages, and
whether an incomplete submission can be abandoned remain caller-owned.

## Entity Interest

`ryot.entities.watch({ foreground, visible }, onUpdate)` returns
`{ update(interest), dispose() }`. The callback receives
`{ entityId, reason: "populated" | "translated" }`. Disposal is idempotent, suppresses later
callbacks, and makes later updates fail with `disposed`. Invalid declarations fail synchronously with
`invalid-input`, a missing adapter fails with `unsupported-capability`, and transport failures use
`RyotClientError("transport")`.

Declarations may exceed 500 IDs. The runtime normalizes and deduplicates them, gives foreground
priority, sorts within each priority, and sends at most 500 selected IDs. The strict version 1 state
messages contain no request IDs, acknowledgements, credentials, tickets, user IDs, or server fields.
The host owns connectivity and reconnection.

`createRyotQuery` can derive interest from its input and last successful data. Active consumers of
the same registry/query atom share one watch. Updates and document-foreground hints coalesce for 250
ms; an in-flight request finishes before one queued refresh. Hidden retained screens withdraw demand,
and reactivation requests catch-up without discarding cached data.

## Entity Editor

`ryot.entities.save({ submission, idempotencyKey, submittedAt })` sends one `EntityEditorSubmission`
to the kernel editor save and returns `EntityEditorSaveOutput`: `{ kind: "saved", entityId }`,
`{ kind: "stale" }`, or `{ kind: "invalid", message }`. The submission names its schema with an
`EntitySchemaReference`; the runtime refuses an owner that is not a plugin contributor of the
document with `invalid-request`, and server refusals of the request itself fail with
`entity-save-failed`. A saved result notifies mutation listeners.

`EntityEditorScreen` and `EntityEditor` (from `@ryot-app/plugin-client-sdk/entity-editor`) take the
plugin `packageId`, `entitySchemaSlug`, and edit/create `mode`. They read the editable relationship
slugs from the schema's manifest-declared `editor` and refuse schemas without one. "Add" on a
relationship opens `screens.pickEntity` for the relationship's target schema; selected entities become
targets with empty relationship properties. One form
submission keeps its idempotency key and SDK-clock `submittedAt` across retries of the same body; an
edited body starts a new submission.

## Entity Presentations

`defineEntityPresentation` accepts an Effect-returning loader. Its context has only `client` and
`references`; cancellation interrupts the loader fiber rather than passing an `AbortSignal`:

```ts
loader: ({ client, references }) =>
	Effect.gen(function* () {
		// Load and return a record indexed by reference.entityId.
		return yield* client.data.query(recipeFor(references));
	}),
```

The loader returns `Effect.Effect<Readonly<Record<string, Data>>, RyotClientError>`.
`prepare` decodes embedded query rows without I/O. Missing rows or a failed preparation use the
loader, so saved views can select only entity references. Thrown preparation errors and malformed
prepared records remain item failures.
Presentation batches contain up to 100 sorted references and at most four loaders run at once.
Interrupted queued work is removed, and completed or interrupted work releases its slot. The
registry's `load()` still returns a Promise because React's dynamic module import is a framework
boundary. Batch drain delays continue to use `RyotSchedule` and its TestClock-backed test runtime.

## Scheduling

`RyotSchedule` supplies clock reads, delayed callbacks, and scoped refresh Effects from the
provider's Effect runtime. `after` returns cancellation and `run` returns interruption; disposal
interrupts pending work. Callback defects reach the plugin fatal path.

Tests use `createTestRyotClock` and advance time rather than faking timers. Bootstrapped page tests
pass the harness's `bootstrap` to `mountPluginPage`; pages own their runtime/schedule scopes while
the harness retains its clock.

`makeRyotPluginLayer` from `./runtime` assembles client, navigation, and an explicit schedule layer for both live
and test runtimes. Construction stays synchronous. Each page builds its own schedule scope against
the harness clock; per-screen React contexts remain separate from these runtime services.

The test clock governs SDK scheduling only. It does **not** drive `AtomRegistry` idle-TTL sweeps
(raw `setTimeout`, 5 min default TTL) or `Atom.swr` staleness (`Date.now()` against a 30 s
`staleTime`), and interested queries never get `Atom.swr` at all. Advancing the test clock past
those thresholds will not expire an atom. Cancel-on-unmount queries, including presentation and
managed-asset batches, also skip `Atom.swr`; their refreshes are explicitly requested or scheduled.

`useEntityRefresh` supports controller-owned data and passes a deduplicated batch of updates to its
Effect-returning `onRefresh`. `useEntitySettle` provides the same staging for query-owned screens. Both reveal settle
marks only on `commit()`, after refreshed values are rendered, and expire marks automatically.
Identity changes and unmount discard queued work. Transient transport and disposal failures do not
crash a screen; invalid input and unsupported capabilities remain explicit.

## Client Pages And Routing

`PluginRouter` retains a stack of screens and reconciles it only from the kernel entry `index` and
stable `key`; paths never imply push, pop, or replace. In-place location updates preserve focused
controls, while a changed active key moves focus to the new screen. Route targets contain `path` and optional `search`.
Entity targets contain only `entityId`; the kernel builds the canonical URL and returns an entity
location with `entitySchemaSlug`. A `{ kind: "plugin-preferences", packageId }` target resolves to the
matching workspace installation in the kernel and is unresolved when no installation matches. A
`kernel-page` target with `page: "plugin-preferences"` opens the plugin-preferences index.

Plugin authors default-export public page components and presentation definitions from manifest-named
entries. They do not mount or bootstrap an application. The compiler generates the route or
selected-page registry and one bootstrap that owns the document's single React root. The same runtime
hosts plugin routes, entity pages, saved-view renderers, and workspace homes.

`usePageContext` exposes target, renderer, settings, optional named data sources, and route parameters.
Settings and data-source values are page inputs, not executable source or artifact identity.

Retained screens keep their React keys and use `visibility: hidden`, preserving state, layout, and
scroll position. `leading` selects visible back, drawer, or no control; `edgeBack` independently
enables a kernel-granted interactive edge. A gesture commit requests kernel navigation and owns its
settling animation. Pop animation runs only for compact layouts and when reduced motion is not
requested; screen retention is unconditional.

The kernel supplies `compact`, safe-area insets, and history identity. Plugins must not substitute
iframe media queries or browser history inference for those values.

Screen shells own transition transforms; scroll containers live inside them so fixed descendants do
not inherit an unintended transformed containing block. Pinned chrome uses
`PluginScreenFrame.floatingAction`. Visibility comes from rendered screen roles; imperative writes
are limited to transition transforms and scrim opacity. Shared focused-field visibility is installed
in every plugin document because the host cannot inspect sandboxed focus.

Shared Layers construct synchronously and React context distributes their services. Location,
screen, and active-screen contexts remain per-screen because several retained screens coexist.
`RyotNavigationService` exists only in plugin artifact runtimes; drawer requests and title publication
belong to router navigation rather than public `RyotClient` capabilities.
