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

`uploads` is a capability, not a protocol: one call hides intent creation, byte transfer, and
completion, so no intent id, upload URL, or completion step reaches a caller. The `MessageChannel`
adapter cannot provide it, because every bridge payload is a `JsonValue` and a `Blob` cannot cross
the port; a plugin calling it gets `unsupported-capability`.

## Screen Stack

`PluginRouter` keeps a stack of screens, not one route, and reconciles it through the pure
`reconcileStack` keyed on the kernel's history `index` and `key`. Those are the only means of
telling push from pop from replace, so the router never infers a transition from the path.

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
