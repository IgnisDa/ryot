# Client SDK

`@ryot-app/plugin-client-sdk` is the environment-neutral application API shared by kernel and plugin call
sites. It is bundled into each plugin artifact, so it avoids animation and gesture dependencies.

## Bridge Bootstrap

The plugin bootstrap validates embedded artifact metadata before registering a `message` listener. It
accepts exactly one `MessagePort` from `window.parent`; all other sources and port counts are ignored.
`PluginBridgeInit` validates protocol markers and its artifact hash must match the embedded metadata.
`PluginBridgeReady` reports the embedded metadata, not values echoed from init.
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

`RyotClientError.reason` is the complete public capability failure set:
`disposed`, `protocol`, `transport`, `asset-failed`, `collection-failed`, `query-failed`,
`invalid-input`, `operation-failed`, `malformed-result`, `unsupported-capability`,
`invalid-request`, and `quota`. Adapters must
preserve these reasons; callers must not infer failures from message text or expect capability-specific
reasons outside this set.

Asynchronous client capabilities and `RyotClientAdapter` operations return `Effect` with
`RyotClientError` in the failure channel. Client-only plugin code imports `Effect` from
`@ryot-app/plugin-client-sdk/effect`; the neutral shared-code `@ryot-app/plugin-kit/effect` surface
does not export it. Interruption cancels an in-flight RyotQL or asset request over its existing
bridge cancel message. Other capability requests have no per-request cancel message; interruption
still removes their local pending completion. React query and mutation definitions return Effects,
which Atom runs directly; `mutateAsync` and storage hook methods return Promises at the React
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
`{ status: "deleted" | "referenced" }` and fails with `asset-forbidden` for a missing or foreign
asset. Only a record owned by the caller or by no one that holds that exact locator keeps it
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

```ts
import { Effect } from "@ryot-app/plugin-client-sdk/effect";

const startActivity = Effect.gen(function* () {
	const startedAt = draft.startedAt;
	if (startedAt === undefined) {
		return;
	}
	return yield* client.iosLiveActivities.start({
		pluginId,
		key: `workout:${draft.draftId}`,
		content: {
			title: "Workout",
			status: "In progress",
			primary: { kind: "elapsed", label: "Active", startedAt },
			icon: "activity",
			tone: "accent",
			metrics: [{ label: "Sets", value: "3/8" }],
		},
	});
});
```

`assets.resolve` accepts 1 to 64 managed local or S3 locators and returns signed URLs with expiry.
Remote images do not use it. `ManagedAssetProvider` owns stable sorting, deduplication, batches of at
most 64, retained URLs during refresh, and renewal before the earliest expiry; kernel and plugin
renderers are callers of this SDK behavior. Disposing a bridge session aborts pending resolution, but
an issued URL remains valid until expiry.

Browser uploads to S3 require bucket CORS rules that allow `PUT` with `Content-Type` and enabled tracing
headers from the application's origin. Signed downloads used by browser code also need the appropriate `GET` and
`HEAD` rules. Configure these on the bucket; the SDK does not change storage policies.

`screens.openProviderSearch` is the only provider-add screen capability. It returns an Effect with
imported entity IDs, a cancellation outcome, or `create-requested` when the user chose the schema's
declared `createRoute` (the kernel then navigates there). It carries the configured entity-schema owner
and slug, plus an optional initial query; it does not expose a generic native screen method. After a
successful import, the host sends one narrow `page-refresh` signal. Client pages can register their
current source refetch with `usePageRefresh`; successful shared mutations use the same refresh registry.

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

Query inputs identify cache entries. Rolling queries use stable selections such as range and time
zone, then compute request timestamps from the query context's `schedule.now()` during execution.
Refreshing an existing query retains loaded data with `isFetching: true` and `isPending: false`;
failed refreshes also retain the last successful data. A different input selects a different cache
entry and does not inherit unrelated data. Presentation clocks must not change rolling query keys.

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

Every SDK delay goes through `RyotSchedule` (`now`, `after`), built by `RyotScheduleService` from
the Effect `Clock` in its layer, and distributed to components by `RyotProvider` alongside the
client. `makeRyotRuntime(client)` from `./runtime` assembles the live runtime; `createTestRyotClock` from
`./testing` assembles a `TestClock`-backed one, so tests advance time with `advance(ms)` instead of
faking timers. Bootstrapped page tests pass the harness's `bootstrap` to `mountPluginPage` or call its
`bootstrapClientPage` / `bootstrapClientPlugin` method. `RyotSchedule` keeps synchronous callback registration for React and router code;
client-only plugin code can also use the SDK Effect barrel. `after` forks its sleep on the layer's
captured clock and returns a synchronous cancel; a throw inside the callback is rethrown on a
microtask so the plugin fatal path still sees it. `run` executes refresh Effects on that same scoped
runtime and returns an interrupt function. Disposing a refresh interrupts in-flight work.

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
