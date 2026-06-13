# Client SDK

- Read the embedded artifact metadata element and validate it before registering the `message` listener; never listen first.
- Accept exactly one `MessagePort` from `window.parent` and ignore any other message source or port count.
- Let the `PluginBridgeInit` decode enforce the protocol markers, and compare only the artifact hash against the embedded metadata before starting the port.
- Report the embedded artifact metadata in `PluginBridgeReady`; echoing the kernel's own init values would make the kernel-side identity check tautological.
- `PluginRouter` keeps a stack of screens, not one route. Reconcile it only through the pure `reconcileStack`, keyed on the kernel's history `index` and `key`; the router must never infer a transition from the path.
- A retained screen keeps its React key so its state survives, and is hidden with `visibility: hidden` — never `display: none`, which would discard layout and with it `scrollTop`. Scroll restoration is a consequence of retention; do not add a save/restore pass.
- Keep the gesture recognizer and stack reconciler pure and DOM-free, and confine animation to the animator, which feature-detects `Element.prototype.animate`. That detection is also what makes the transition testable in jsdom without mocks.
- This package is bundled into every plugin artifact, so it takes no animation or gesture dependency. Write transforms directly.
