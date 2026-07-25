# Client UI SDK

Rationale for these rules lives in `README.md`.

- Ship no CSS beyond `theme.css` and `palette.css`; components style themselves with Tailwind classes only. Keep `theme.css`'s `@layer base` block to accessibility primitives that must hold everywhere.
- Give every token mapped in `theme.css` a value in `palette.css`, whose `:root` block is the complete set; the dark blocks redefine only what changes. Adding a token never touches `@ryot-app/contract`.
- Keep source scannable by Tailwind: the client plugin compiler treats this package's `.ts`/`.tsx` files as an extra scan source.
- Style components with base Tailwind and theme tokens only. The kernel's `ui-*` utilities are not available in a plugin document.
- Keep a focusable text input at 16px or larger on the touch layout (`text-base`, with a smaller `md:` size when the design wants one).
- Keep `ScreenFrame` free of a scroll container: it sticks against the scroller its caller owns and takes that element as `scrollRootRef`. Drive its collapse from the sentinel's one `IntersectionObserver`, never a scroll listener, and take the safe-area inset as the `safeAreaTop` number rather than reading `env()`.
- Keep every gutter and gap inside that scroller in `ScreenFrame`, branched from the `compact` boolean. It accepts no class-name prop and writes no `md:` or `lg:` variant, because a media query in a plugin document measures the iframe rather than the viewport the kernel resolved `compact` from. A narrower column is `width="readable"`.
- Key the collapse observer to the sentinel node itself, so the sentinel a search row removes is observed again when it returns. A bar carrying a search row is opaque outright, and the `<h1>` stays in the document, visually hidden, whenever the title block is not drawn.
- Draw a bar control with `ScreenBarButton`, and keep colour out of its own class string. A caller's utility cannot override one baked into a component: the cascade orders utilities by the stylesheet, not by `clsx` argument order.
- Guard `ScreenFrame`'s transitions with `motion-reduce:` in the component itself. A plugin document receives only `theme.css` and `palette.css`, never the kernel's reduced-motion base layer.
- Add a runtime dependency only when the behaviour is genuinely shared, and prefer the root export; a new subpath must also be registered in the plugin compiler's trusted-module list.
- Keep the `AppSchema` form on the `./schema-form` subpath and never re-export it from the root barrel.
- Keep `AppIcon` on the `./icon` subpath and never re-export it from the root barrel. It is the single icon set for every client surface: reach for it by registered name instead of importing `lucide-react` or hand-rolling an `<svg>`, and register a new name here rather than at the call site.
- Take the schema form's upload transport as a `SchemaFileUpload` prop; this package must never import a client SDK or know about servers, auth, or scopes.
- Take icons as `ReactNode` props in every component. A component here must never import `AppIcon`, so a consumer that renders no icon never pays for the registry.
- Compose radiogroup-shaped controls from `RadioGroup`, which owns `role`, `aria-checked`, roving `tabIndex`, and Arrow/Home/End. Consumers supply visuals through `renderOption` and must never set a role, `aria-checked`, or `tabIndex` themselves. Menus are deliberately not consumers.
- Keep `RadioGroup`'s tracking of whether a pending change came from keyboard navigation; unlike `Select`, it must leave the modal open for Arrow/Home/End.
- Supply a visible focus indicator at 3:1 or better in any component that sets `outline-none`.
- Register keyboard shortcuts through `useShortcut`, never a hand-written document listener. Every registration belongs to the innermost enclosing `OverlayScope`; never gate a shortcut on whether some overlay is open.
- Wrap every overlay's content in one `OverlayScope`, which pushes the keyboard scope, registers the overlay's own Escape, and publishes the scope to descendants. Pass `enabled` for an overlay whose open state is a prop rather than its mounting. `useFocusTrap` handles Tab only and must not take Escape.
- Give a search-shaped field its Escape through `useFieldEscape`. Form fields are deliberately excluded — Escape must never discard a password or a half-typed value.
- Keep `ReorderableList`'s drag handle a real button that reorders with Arrow/Home/End and announces the new position through a live region, with no drag-and-drop dependency. Consumers supply the handle icon, an item key, and an item label.
