# Synchronize Kernel Theme

**Parent Plan:** [Web Client Plugin Tracer](./README.md)

**Status:** todo

## What to build

Make the fixture document use the kernel design tokens established in Task 01 and follow theme changes while mounted. The kernel sends a complete initial semantic theme snapshot during runtime startup and emits subsequent theme events over the existing bridge. The plugin runtime applies those values as CSS variables on its own root document so plugin-local Tailwind classes and client UI SDK components resolve against the same semantic meanings as kernel UI.

Support light, dark, and system preferences. System mode follows the browser media query in the kernel; the plugin receives the resolved theme and tokens rather than independently choosing an authoritative mode. Apply the initial values before revealing plugin content to avoid a wrong-theme flash. A theme change must not recompile the artifact, reload the iframe, reset plugin state, or create a second bridge.

Keep the contract generic. The bridge carries semantic token names and lifecycle/theme events, not Media/Fitness concepts, kernel CSS selectors, Tailwind configuration objects, or direct access to the parent document. Update the fixture so a representative background, surface, border, text, accent, and status style visibly changes.

## Acceptance criteria

- [ ] The kernel derives one resolved semantic theme snapshot from its light, dark, or system preference.
- [ ] The plugin receives and applies the initial snapshot before its UI becomes visible.
- [ ] Plugin Tailwind output and client UI SDK primitives consume semantic CSS variables rather than copied raw kernel selectors or hardcoded light-theme values.
- [ ] Changing between light, dark, and system preferences updates the mounted fixture through a bridge event.
- [ ] A system color-scheme change updates the fixture when preference is `system` and does not override an explicit preference.
- [ ] Theme updates preserve the iframe identity, bridge session, current private route, and fixture React state.
- [ ] The fixture demonstrates background, surface, border, primary text, muted text, accent, and at least one status token in both resolved themes.
- [ ] Unknown extra theme tokens are harmless and missing required V1 tokens produce a stable runtime failure rather than silently using privileged parent styles.
- [ ] Kernel theme unit tests, bridge event tests, plugin runtime tests, and browser tests cover initial paint, live changes, system changes, and state preservation; all earlier tracer tests pass.

## User stories addressed

- User story 7

## Implementor Notes

The kernel design tokens are authoritative. Do not solve synchronization by reading parent computed styles from the iframe or by sharing a stylesheet across document boundaries.
