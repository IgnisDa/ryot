# Client UI SDK

- Ship no CSS of its own beyond `theme.css`'s design tokens; components style themselves with Tailwind classes only.
- Keep source scannable by Tailwind: the client plugin compiler treats this package's `.ts`/`.tsx` files as an extra scan source when generating a plugin's stylesheet.
- Style components with base Tailwind and theme tokens only. The kernel's `ui-*` utilities live in the kernel's own stylesheet, which a plugin document never loads.
- This package is inlined into every plugin artifact, so every runtime dependency is a per-plugin size cost. Add one only when the behaviour is genuinely shared, and prefer the root export: a new subpath must also be registered in the plugin compiler's trusted-module list.
- Take icons as `ReactNode` props. The SDK owns no icon set, so a component must never import one.
- Register keyboard shortcuts through `useShortcut`, never a hand-written document listener. It pins `stopPropagation` and `conflictBehavior` and exposes only `enabled`; single-key shortcuts do not fire while an input, textarea, or contenteditable holds focus.
- A shortcut is registered against the document that runs it, so a kernel shortcut never fires while focus sits inside a plugin iframe, and vice versa.
