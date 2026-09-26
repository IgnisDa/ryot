# Client UI SDK

Rationale lives in `README.md`.

- Ship no component stylesheets. Keep shared base rules, keyframes, and animation tokens in `theme.css`, and values in `palette.css`.
- Give every token mapped by `theme.css` a `palette.css` root value. Dark modes override only changed values.
- Guard each animated element with `motion-reduce:` because plugin documents do not receive kernel-only reduced-motion CSS.
- Use base Tailwind and theme tokens only. Plugin documents do not have kernel `ui-*` utilities; touch-layout text inputs remain at least 16px.
- Keep source scannable by Tailwind. New runtime dependencies and export subpaths also require client compiler allowlist review.
- Keep `AppSchema`, icons, sync marks, and tint on their existing subpaths, not the root barrel. `EntityArtWell` remains the only missing-image placeholder.
- Components accept icons as `ReactNode`; they never import the icon registry. Schema forms receive upload transport as a prop and remain independent of client capabilities.
- Resolve image tint failures, including CORS and canvas failures, to no tint without throwing or blocking render.
- Keep `ScreenFrame` free of a scroll container. It owns its bar, heading, gutters, rhythm, and safe-area arithmetic and receives `compact`, `safeAreaTop`, and `scrollRootRef`.
- Do not add responsive variants or layout class props to `ScreenFrame`; plugin media queries measure the iframe. Use `width="readable"` for a narrow column.
- Key title-collapse observation to the sentinel node. Search keeps one visually hidden `<h1>` and an opaque bar.
- Keep hero input as `{ height, node }`; the frame positions the box and uses height as the collapse threshold. Hero content adds no chrome offset.
- Draw bar controls with `ScreenBarButton`; keep caller-selectable color out of its baked classes.
- Compose radiogroup controls from `RadioGroup`; consumers provide visuals and do not duplicate ARIA or roving-focus behavior. Keyboard selection keeps a radio picker open.
- Register shortcuts through `useShortcut` and wrap each overlay in `OverlayScope`. Its scope stack is a module singleton, so each realm suppresses only its own registrations. `useFocusTrap` handles Tab only; `useFieldEscape` is only for search-shaped fields.
- Keep `ReorderableList` pointer and keyboard operable. Its handle is a button supporting Arrow/Home/End with live-region announcements and no drag-and-drop dependency.
