# Client SDK

Rationale for these rules lives in `README.md`.

- Read the embedded artifact metadata element and validate it before registering the `message` listener; never listen first.
- Accept exactly one `MessagePort` from `window.parent` and ignore any other message source or port count.
- Let the `PluginBridgeInit` decode enforce the protocol markers, and compare only the artifact hash against the embedded metadata before starting the port.
- Report the embedded artifact metadata in `PluginBridgeReady`, never the kernel's own init values.
- Treat `uploads` as a capability, not a protocol: one call hides intent creation, byte transfer, and completion. The `MessageChannel` adapter does not provide it and returns `unsupported-capability`.
- Reconcile `PluginRouter`'s screen stack only through the pure `reconcileStack`, keyed on the kernel's history `index` and `key`. The router must never infer a transition from the path.
- Keep a retained screen's React key and hide it with `visibility: hidden`, never `display: none`. Do not add a scroll save/restore pass.
- Derive every screen's paint state from its `presentScreens` role in render. Never assign `visibility` from a navigation or gesture path; only `transform` and the scrim's `opacity` are written imperatively.
- Whoever starts a transition owns its end: a gesture commit hands its settling promise to the pop that follows.
- Animate a pop only when the location message says `compact`, and keep retention unconditional. A non-compact viewport and `prefers-reduced-motion` both swap instantly between two mounted screens; neither may remount.
- Keep the gesture recognizer and stack reconciler pure and DOM-free, and confine animation to the animator, which feature-detects `Element.prototype.animate`.
- Take no animation or gesture dependency; write transforms directly.
- Keep `PluginScreenFrame` on the `./screen` subpath so a plugin that renders no frame does not pull the UI SDK barrel into its artifact. `usePluginTitle` and `useRyotViewport` stay on `./plugin` for exactly that case.
- Pass the frame no layout classes from a plugin screen: gutters and rhythm follow the `compact` boolean the kernel sends, and a media query inside the iframe measures the iframe instead. Report that boolean and both safe-area insets through the one `useRyotViewport`; a screen needs the insets only where it draws its own chrome, since the frame owns the offsets its own bar introduces. The per-screen scroll div carries the told bottom inset for every screen, framed or not.
- Publish a screen's title from the screen that renders it, and only while it is the active one. `PluginRouter` supplies `isActive` and the current entry, so a pop republishes the retained screen's own title instead of leaving the popped screen's title standing.
- Keep `openDrawer` and `publishTitle` on the router's navigation object, never on `RyotClient`. Kernel chrome is not a plugin capability.
