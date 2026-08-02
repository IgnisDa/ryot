# Client SDK

Rationale lives in `README.md`.

- Validate embedded artifact metadata before registering the message listener. Accept exactly one `MessagePort` from `window.parent`.
- Decode all init markers, compare the artifact hash with embedded metadata, and report embedded metadata in ready. Never echo init identity as proof.
- Keep uploads as one capability on every adapter. The plugin sends only bytes, file name, and content type; the host owns the intent, upload URL, headers, and completion. Reject a non-`Blob` source with `invalid-input`.
- Reconcile plugin screens only from kernel entry `index` and stable `key`, never from paths. Move focus only when the active key changes.
- Retain screen React keys and hide inactive screens with `visibility: hidden`. Do not add separate scroll restoration.
- Scroll inside the screen shell, never on the shell itself; the shell is the transform target and therefore a containing block for fixed descendants. Pinned chrome goes through `PluginScreenFrame`'s `floatingAction`.
- Derive visibility from rendered screen roles. Limit imperative writes to transition transforms and scrim opacity.
- Keep transition ownership with its initiator. Animate pops only for compact layouts without reduced motion; retention is unconditional.
- Keep reconciliation and gesture recognition DOM-free. Add no animation or gesture dependency.
- Keep `PluginScreenFrame` on `./screen`; keep frame-independent plugin APIs on `./plugin`.
- Use only bridged `compact` and safe-area values for plugin layout. Publish titles only from the active screen and current entry.
- Keep drawer opening and title publication on router navigation, not `RyotClient`; kernel chrome is not a plugin capability.
- Schedule every delay and clock read through `RyotSchedule`. Never call `setTimeout` or `Date.now()` in SDK source.
- Take router navigation from `RyotNavigationService`, never a `PluginRouter` prop. Only a plugin artifact's runtime provides it.
- Layers construct shared values; React context distributes them. Per-screen values (`RouterContext`, `PluginScreenContext`, `ActiveScreenContext`) cannot be Layers, because `PluginRouter` mounts several `Screen`s at once with different locations.
- Keep every SDK layer synchronously constructible; `RyotProvider` resolves its services with `runtime.runSync` during render.
