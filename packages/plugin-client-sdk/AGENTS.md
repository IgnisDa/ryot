# Client SDK

- Read the README's bootstrap and routing sections before changing bridge trust or retained-screen behavior.
- Validate embedded composition metadata before listening. Accept one port from `window.parent`; verify init against embedded identity, never echoed input.
- Reconcile screens from kernel index/key, never paths. Preserve React keys and inactive layout; do not add independent scroll restoration. Keep reconciliation/gestures DOM-free; add no animation/gesture dependency.
- The screen shell owns transforms, not scrolling. Keep scroll roots inside it and pinned chrome in `PluginScreenFrame.floatingAction`.
- `index.ts`, `react.tsx`, and `plugin.tsx` are aggregation points; internal imports use defining modules. Keep `PluginScreenFrame` on `./screen` and frame-independent APIs on `./plugin`, including its canonical identity exports.
- Publish titles only for the active history entry. Navigation comes from `RyotNavigationService`, not `PluginRouter` props or `RyotClient` chrome methods.
- Schedule delays and clock reads through `RyotSchedule`, never global timers/time. Each page owns its bootstrap runtime; tests retain ownership of their harness clock.
- Layers construct shared values synchronously; context distributes them. Screen-specific contexts remain per-screen because retained screens coexist.
- Fiber interruption must preserve RyotQL/asset cancellation messages. Upload adapters share one `Blob`/`File` capability without exposing host intent or transport details.
- Retained submissions require retry-safe writes and one immutable input/write identity across attempts; transport request IDs are not write identities.
