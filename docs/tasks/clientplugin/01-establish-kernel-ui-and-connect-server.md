# Establish Kernel UI and Connect to a Server

**Parent Plan:** [Web Client Plugin Tracer](./README.md)

**Status:** todo

## What to build

Turn the repository owner's plain TanStack Router starter into the first usable Ryot DOM kernel. Do not move the old client or recreate the starter; both are external prerequisites in the parent plan.

Establish the root application providers, Effect Atom registry, public API transport, persistence boundary, and route gates needed to connect to a Ryot server. Port the existing cloud/self-hosted onboarding behavior: normalize and validate the selected origin, call the public health endpoint, persist only a successful server selection, preserve a safe in-app redirect destination, and route a connected user to `/auth`. `/` must route to onboarding when no server is selected.

The onboarding screen is also the first vertical use of the kernel design system. Adapt the semantic colors, radii, shadows, spacing, Outfit/Lora typography, light/dark/system preference, and accessibility guidance from the legacy client's `global.css` and `design.md` into normal DOM CSS and Tailwind. Remove NativeWind-specific imports and Expo font aliases rather than copying them. Add only the DOM controls and status presentation needed by onboarding. Theme preference is global persisted state; system mode follows `prefers-color-scheme`; explicit modes use a root `data-theme` value.

Use TanStack Router as the only routing authority. Keep public contract/client creation under the new kernel API boundary so Task 02 and later authenticated features extend one transport rather than creating parallel clients.

## Acceptance criteria

- [ ] The pre-created `kernel/client` starter is integrated into the workspace as the canonical kernel client and has working check, test, and production-build commands.
- [ ] No file under `crates/**` is modified, moved, or deleted.
- [ ] `/` and `/onboarding` use TanStack Router and redirect according to persisted server-selection state without Expo Router compatibility code.
- [ ] Cloud and self-hosted selections resolve through the canonical origin-normalization logic.
- [ ] A malformed self-hosted URL is rejected before transport, and an unreachable or unhealthy server produces a stable retryable UI state.
- [ ] The server URL is persisted only after a successful health check and can be cleared or changed without clearing unrelated Ryot-owned storage.
- [ ] Safe local redirect intent survives onboarding; external, protocol-relative, auth-loop, and malformed destinations are rejected.
- [ ] DOM CSS exposes the established semantic Tailwind tokens for background, surfaces, text, borders, accents, status colors, radii, and shadows in light and dark modes.
- [ ] Outfit and Lora load as browser fonts, the page has an accessible visible focus treatment, and the onboarding layout works at mobile and desktop widths.
- [ ] Light, dark, and system theme preference is global, persisted, and reflected on the root document without a React Native or NativeWind runtime.
- [ ] Focused tests cover origin normalization, persistence scope, route-gate decisions, health failure/retry, and theme resolution; the kernel check, test, and build commands pass.

## User stories addressed

- User story 1

## Implementor Notes

Treat the legacy client under `crates/` as read-only behavioral and visual reference. Port the smallest reusable DOM primitives needed for this slice; do not port the old component library wholesale.
