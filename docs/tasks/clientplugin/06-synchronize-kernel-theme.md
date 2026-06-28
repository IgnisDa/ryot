# Synchronize Kernel Theme

**Parent Plan:** [Web Client Plugin Tracer](./README.md)

**Status:** todo

## What to build

Extend the one per-session `@ryot/client-sdk` runtime established by Task 05-followup with `ryot.theme`. The kernel adapter reads the authoritative theme state directly, while the plugin runtime receives a complete initial semantic theme snapshot and subsequent events over its existing `MessageChannel` and single dispatcher. The runtime applies those values as CSS variables on its own root document so plugin-local Tailwind classes and client UI SDK components resolve against the same semantic meanings as kernel UI.

Support light, dark, and system preferences. System mode follows the browser media query in the kernel; the plugin receives the resolved theme and tokens rather than independently choosing an authoritative mode. Apply the initial values before revealing plugin content to avoid a wrong-theme flash. A theme change must not recompile the artifact, reload the iframe, reset plugin state, create a second bridge, or create a theme-specific listener or teardown path. Theme disposal uses the shared runtime lifecycle.

Keep the contract generic. The bridge carries semantic token names and lifecycle/theme events, not Media/Fitness concepts, kernel CSS selectors, Tailwind configuration objects, or direct access to the parent document. Update the fixture so a representative background, surface, border, text, accent, and status style visibly changes.

Theme events use the exact protocol V3 runtime messages and the existing session `MessagePort`. Do not add V2 support, aliases, compatibility negotiation, a fallback bridge, or a theme-specific bridge.

Theme state must live behind the existing explicit `RyotClient` and `RyotProvider` boundary and the per-session runtime state. Do not add a plugin-only theme singleton, a second React provider, a bridge API outside the shared client adapter, or a separate theme/crash/reload bridge or teardown path.

## Acceptance criteria

- [ ] The kernel derives one resolved semantic theme snapshot from its light, dark, or system preference.
- [ ] `ryot.theme` exposes the same semantic theme capability through the direct kernel adapter and the plugin `MessageChannel` adapter.
- [ ] Theme messages use the existing per-session runtime dispatcher and lifecycle; they do not add a listener, bridge, client, or disposal path.
- [ ] The plugin receives and applies the initial snapshot before its UI becomes visible.
- [ ] Plugin Tailwind output and client UI SDK primitives consume semantic CSS variables rather than copied raw kernel selectors or hardcoded light-theme values.
- [ ] Changing between light, dark, and system preferences updates the mounted fixture through a bridge event.
- [ ] A system color-scheme change updates the fixture when preference is `system` and does not override an explicit preference.
- [ ] Theme updates preserve the iframe identity, bridge session, current private route, and fixture React state.
- [ ] Theme updates preserve the runtime state and use the same `ready`/`active`/`closing`/`failed`/`disposed` transitions as all other session work.
- [ ] The fixture demonstrates background, surface, border, primary text, muted text, accent, and at least one status token in both resolved themes.
- [ ] Unknown extra theme tokens are harmless and missing required theme tokens produce a stable runtime failure rather than silently using privileged parent styles.
- [ ] Kernel theme unit tests, bridge event tests, plugin runtime tests, and browser tests cover initial paint, live changes, system changes, and state preservation; all earlier tracer tests pass.

## User stories addressed

- User story 7

## Implementor Notes

The kernel design tokens are authoritative. Do not solve synchronization by reading parent computed styles from the iframe or by sharing a stylesheet across document boundaries.

Two conditions left by Task 03 define where this task attaches:

- The compiled artifact carries the `@theme inline` mapping from `--color-*` to `--bg`, `--accent`, and the rest, but the raw palette lives in `kernel/client/src/styles/palette.css` and is not part of the artifact. The fixture iframe therefore renders largely uncoloured today. Supplying those resolved values over the bridge is exactly the seam this task fills; do not solve it by shipping `palette.css` into the artifact, which would freeze a theme into a content-addressed build.
- `PluginHost` keeps the iframe hidden until the handshake completes, so the plugin's React tree already mounts at 0x0 before it is revealed. That reveal is the moment to gate on the initial snapshot having been applied, which is what "before its UI becomes visible" means in the second criterion.

Task 05-followup defines the runtime seam: extend the one per-session runtime, `createRyotClient`, its explicit React context, and the two environment adapters. The wire event remains an internal detail of the runtime dispatcher; fixture components consume `ryot.theme`, not `MessagePort` messages. Do not introduce a theme-specific bridge or teardown path; crash and artifact-reload work must continue to reuse this same runtime lifecycle.
