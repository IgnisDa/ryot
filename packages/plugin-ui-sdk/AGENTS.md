# Client UI SDK

- Keep shared rules/keyframes in `theme.css` and token values in `palette.css`; ship no component stylesheets. Every mapped token needs a root value.
- Use theme tokens and shared components, not per-screen restyling. Plugin documents lack kernel `ui-*` utilities; size touch controls with pointer variants and keep touch text inputs at least 16px.
- Guard each animation with reduced-motion variants; kernel CSS does not reach plugin documents. Keep Tailwind source scannable and review compiler allowlists for new runtime dependencies/export subpaths.
- Keep `AppSchema`, icons, sync marks, and tint on their existing subpaths. `EntityArtWell` is the missing-image primitive. Components accept icon nodes; forms receive upload transport rather than client capabilities.
- Read `README.md` before changing `ScreenFrame`: it owns chrome and safe-area arithmetic, never a scroll container or caller-supplied responsive layout.
- Compose radio behavior, keyboard/pointer reordering, focus visibility, and modal dismissal through shared primitives, not consumer copies.
- Overlays use `OverlayScope`; shortcut stacks are realm-local. `useFocusTrap` owns Tab, not Escape arbitration. Tint failures must never block rendering or throw.
