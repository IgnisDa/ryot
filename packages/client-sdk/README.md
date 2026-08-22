# Client SDK

The environment-neutral surface that kernel and plugin call sites share. It is bundled into every
plugin artifact, which is why it takes no animation or gesture dependency and writes transforms
directly.

## Bridge Handshake

The embedded artifact metadata element is read and validated before the `message` listener is
registered, so a document that cannot establish its own identity never accepts a port. Exactly one
`MessagePort` from `window.parent` is accepted; any other source or port count is ignored.

The `PluginBridgeInit` decode enforces the protocol markers, and only the artifact hash is compared
against the embedded metadata before the port starts. `PluginBridgeReady` reports the embedded
metadata rather than echoing the kernel's init values, which would make the kernel-side identity
check tautological.

The bridge protocol remains exactly version 1 and `CLIENT_COMPILER_VERSION` remains exactly 1. Each
accepted location is reconciled before the SDK automatically reports the retained stack's actual
`hasPreviousScreen` together with the matching `index` and `key`. This readiness signal is runtime
coordination with the kernel, not a public plugin API.

`uploads` is a capability, not a protocol: one call hides intent creation, byte transfer, and
completion, so no intent id, upload URL, or completion step reaches a caller. The `MessageChannel`
adapter cannot provide it, because every bridge payload is a `JsonValue` and a `Blob` cannot cross
the port; a plugin calling it gets `unsupported-capability`.

When focus is inside a plugin iframe, its bootstrap recognizes the reserved `Mod+K` command-center
shortcut and `Mod+Shift+Space` desktop-workspace-switcher shortcut. It sends semantic
`{ type: "kernel-shortcut", shortcut: "command-center" | "workspace-switcher" }` bridge messages,
never raw `KeyboardEvent` or key payloads. The kernel owns both actions and desktop gating. An active
plugin `OverlayScope` suppresses root forwarding, and plugins must not bind either reserved combination
at their root. These shortcuts are not a public `RyotClient` capability.

`assets.resolve` accepts a non-empty batch of local or S3 managed locators and returns matching
absolute signed URLs with their expiry. The direct and `MessageChannel` adapters use the same
authenticated upload boundary and opaque `asset-failed` classification. Bridge messages contain no
authentication, server, user, plugin, or installation identity. Canceling or disposing a session
aborts pending resolution work; an issued asset-scoped URL remains usable until its natural expiry.

## Entity Interest

`ryot.entities.watch(interest, onUpdate)` returns an `EntityInterestSubscription` with
`update(interest): void` and `dispose(): void`. `EntityInterest` has readonly `foreground` and
`visible` string arrays. Both types are exported from the SDK root. The callback receives only
`{ entityId: string, reason: "populated" | "translated" }`, derived from the HTTP contract's
`EntityUpdatedMessage`. The optional adapter capability is `watchEntities(interest, onUpdate)`.
Invalid declarations fail synchronously with `invalid-input`; a missing adapter fails with
`unsupported-capability`. Transport failures use `RyotClientError("transport")`. Disposal is
idempotent, suppresses subsequent callbacks, and rejects subsequent updates with `disposed`.

Declarations can contain more than 500 loaded rows. The SDK normalizes and deduplicates IDs, with
foreground winning overlaps. The plugin runtime aggregates all watch owners and selects at most
500 IDs, sorted lexically within each priority and taking foreground first. Unchanged aggregate
sets do not post again. Protocol version 1 sends exactly
`{ type: "entity-interest", foreground: string[], visible: string[] }` and receives exactly
`{ type: "entity-updated", entityId, reason }`. These strict messages have no request IDs,
acknowledgements, credentials, tickets, user IDs, or server fields. Terminal runtime teardown
clears all owners. The host owns socket connectivity and reconnection.

`createRyotQuery(query, { entityInterest: ({ input, data }) => interest })` declares roots with
`data` undefined before the first response, then retains dependencies from the last successful
data, including during refresh or failure. One controller per registry and query atom shares a
watch across active consumers. Hints coalesce for 250 ms; hints during a request become one
follow-up after settlement rather than canceling that request. The queued refresh checks the
registry's current waiting state before invalidating the atom. Interested queries use the existing
atom cache and explicitly catch up when cached data is remounted after the final consumer leaves,
including within the host's removal grace. First-mount hydration does not trigger an extra request.
Active controllers also coalesce document foreground visibility events through the same scheduler;
hidden retained screens do not independently refresh. Queries without this option keep their
existing hydration, cancellation, cache, and SWR focus behavior.

`useEntityRefresh` from `@ryot-app/client-sdk/react` supports controller-owned saved views:
`{ identity, interest, blocked, onRefresh: (updates: readonly EntityUpdate[]) => Promise<void> }`.
It keeps one mutable watch, coalesces hints for 250 ms, and holds dirty state while blocked or
running. The dirty state is the batch itself: hints accumulate inside the window keyed by entity
ID, so the last reason for an entity wins and `onRefresh` receives every entity that changed rather
than a bare "something moved" signal. A hint that carries no update — focus, catch-up, a
blocked retry — still fires a refresh, with an empty batch. Identity changes and unmount discard
queued work. A failed refresh does not retry without a new hint. Both React paths tolerate
transient transport/disposal failures without crashing the screen; invalid input and unsupported
capabilities remain explicit errors.

`useEntityRefresh` also returns `{ settled }`, a `ReadonlyMap<entityId, "populating" | "translating">`
of the entities whose work has just landed, for a screen that wants to mark the change. Screens
driven by `createRyotQuery` instead of a controller take the same map from `useEntitySettle(interest)`,
which returns `{ settled, commit }` and watches the same interest for its own staging.

**Commit, not arrival, is the trigger.** Both hooks stage an update when the frame lands and reveal
it only on `commit()` — `useEntityRefresh` commits once `onRefresh` resolves; a `useEntitySettle`
caller commits from an effect keyed on its query data. Revealing on arrival would mark a row while
it still showed the old values. Entries expire on their own after the mark's duration, so nothing
has to clear them.

The generic React surface defaults to active and does not import plugin routing. `PluginRouter`
supplies activity from screen roles: hidden retained screens withdraw demand and do not
automatically refresh, but keep cached data and in-flight completion. Reactivation explicitly
requests catch-up, even within the host's two-second removal grace. A running saved-view refresh
must settle before this catch-up starts.

## Screen Stack

`PluginRouter` keeps a stack of screens, not one route, and reconciles it through the pure
`reconcileStack` keyed on the kernel's history `index` and `key`. Those are the only means of
telling push from pop from replace, so the router never infers a transition from the path.

The location's `leading` intent and `edgeBack` flag are independent. `leading` selects the visible
back, drawer, or absent control. `edgeBack` only enables the plugin's interactive edge recognizer
after the kernel grants ownership; it never selects a control. The kernel may send either tagged
route or tagged entity locations. Plugin navigation requests use tagged targets: route targets carry
`path` and optional `search`, while entity targets carry only `entityId`. For an entity target, the
kernel builds the canonical `/e/$entityId` URL and resolves its provenance. Kernel-to-plugin entity
locations also include `entitySchemaSlug`; plugin-to-kernel entity targets do not.

`PluginRouterDefinition.home` remains required. Entity renderers are registered by schema slug in
`entities`; each receives the tagged location's `entityId` and `entitySchemaSlug`. An unregistered
schema uses the SDK's unavailable-renderer state. Registered renderer components keep their identity,
so retained screen state survives a pop. Entity screens still expose the full tagged location through
`usePluginLocation`, empty params through `usePluginParams`, and an empty `URLSearchParams` through
`usePluginSearch`.

```tsx
import { bootstrapClientPlugin, type EntityRendererProps } from "@ryot-app/client-sdk/plugin";

const ShowEntity = (props: EntityRendererProps) => <h2>{props.entityId}</h2>;

bootstrapClientPlugin({
	home: { component: Home },
	entities: {
		show: { component: ShowEntity },
	},
});
```

A retained screen keeps its React key so its state survives, and is hidden with `visibility: hidden`
rather than `display: none`, which would discard layout and with it `scrollTop`. Scroll restoration
is a consequence of retention, not a separate save/restore pass.

Every screen's paint state is derived from its `presentScreens` role in render. Assigning
`visibility` from a navigation or gesture path is what this avoids: a path that has to remember to
reveal an incoming screen is a path that can forget, and a screen left hidden mid-transition paints
the document's own canvas instead. Only `transform` and the scrim's `opacity` are written
imperatively, because they change per frame.

Whoever starts a transition owns its end. A gesture commit hands its settling promise to the pop
that follows, so the leaving screen unmounts when the animation finishes rather than when the
kernel's `location` message lands.

A pop animates only when the location message says `compact`, while retention stays unconditional. A
non-compact viewport and `prefers-reduced-motion` both swap instantly between two mounted screens,
and neither may remount.

The gesture recognizer and stack reconciler stay pure and DOM-free, with animation confined to the
animator, which feature-detects `Element.prototype.animate`. That detection is also what makes the
transition testable in jsdom without mocks.
