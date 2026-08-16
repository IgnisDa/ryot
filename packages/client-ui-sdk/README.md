# Client UI SDK

Shared presentational and interaction primitives for the kernel client and for every plugin
document. This package is inlined into every plugin artifact, so its size and its base styles reach
every plugin whether or not that plugin uses them.

## Styling And Tokens

`theme.css` maps the design tokens into Tailwind and carries one `@layer base` block of
accessibility primitives — pointer and not-allowed cursors, the `:focus-visible` outline.
`palette.css` holds the token values for each mode. Both are loaded by the kernel document and
inlined into every plugin artifact by the client plugin compiler, so they are the one place a base
rule or a token value reaches both documents.

A token exposed in `theme.css` must also have a value in `palette.css`, whose `:root` block is the
complete set; the dark blocks redefine only what changes and inherit the rest. A token mapped with
no value resolves to an undefined var in every document. The contract does not enumerate token
names, so adding one never touches `@ryot-app/contract` — the kernel sends plugins only the resolved
light/dark mode.

A Tailwind utility always outranks the `theme.css` base layer, because cascade layer order precedes
specificity. So `outline-none` on a control removes its focus indicator no matter what the base
layer says, and a component that suppresses the outline has to supply its own.

A focusable text input stays at 16px or larger on the touch layout because iOS zooms the whole
document when a field below 16px takes focus, and the zoom persists — the page stays scrolled and
clipped after the field is dismissed.

## Bundle Cost

Every runtime dependency here is a per-plugin size cost. The root export is what every plugin
imports, which is why the `AppSchema` form stays on the `./schema-form` subpath: it pulls
`@ryot-app/contract`, `effect`, and `@tanstack/react-form`, and re-exporting it from the root barrel
would land that weight in every artifact instead of only in the plugins that render a schema form.

For the same reason the schema form takes its upload transport as a `SchemaFileUpload` prop: the SDK
knows nothing about servers, auth, or scopes.

`AppIcon` stays on the `./icon` subpath for the same weight reason. Its registry names every icon
the product uses, so importing it pulls the whole set rather than the handful a screen renders, and
re-exporting it from the root barrel would land that set in every artifact. Components here still
take icons as `ReactNode` props and never import `AppIcon` themselves, which keeps the registry out
of a plugin that renders no icon while leaving one shared icon vocabulary for the surfaces that do.
Registering a name is what makes it available everywhere; an unregistered name renders a stable
circle rather than nothing, so a call site never needs to reach for `lucide-react` or an inline
`<svg>` of its own.

## Shortcuts And Overlays

`useShortcut` pins `stopPropagation` and `conflictBehavior`, and single-key shortcuts do not fire
while an input, textarea, or contenteditable holds focus. Shortcuts are scope-aware: every
registration belongs to the innermost enclosing `OverlayScope`, and only the topmost scope's
shortcuts fire. A call site therefore never gates a shortcut on whether some overlay is open —
passing `enabled` for that is the bug the scope exists to prevent. A shortcut is registered against
the document that runs it. Ordinary shortcuts remain document-local. Reserved kernel shortcuts are
forwarded semantically from a focused plugin iframe: its bootstrap recognizes `Mod+K` for the
command center and `Mod+Shift+Space` for the desktop workspace switcher, then sends a
`{ type: "kernel-shortcut", shortcut: "command-center" | "workspace-switcher" }` bridge message
rather than a raw `KeyboardEvent` or key payload. The kernel owns the actions and desktop gating. An
active plugin `OverlayScope` suppresses root forwarding, so plugins must not bind either reserved
combination at their root; neither is a public `RyotClient` capability.

`OverlayScope` owns three things that must not drift apart: it pushes the keyboard scope that
suppresses everything behind it, it registers the overlay's own Escape, and it publishes the scope
to descendants. `useFocusTrap` deliberately does not handle Escape — it only contains Tab — because
an overlay's Escape must be arbitrated against every other open overlay, not against its own focus
trap.

Escape belongs to the innermost thing that can act on it. A search-shaped field takes it through
`useFieldEscape`: with a value it clears and consumes the press; empty it blurs and lets the event
through, so the enclosing overlay still closes on the next one. Form fields are excluded, because a
field that clears typed input on Escape matches no native control. The hook binds a native listener
to the element rather than a React `onKeyDown`, because it has to run at target phase ahead of the
document-level shortcut listener, and `preventDefault` there is also what stops a browser's built-in
`type="search"` clear from behaving differently across engines.

## Screen Frame

`ScreenFrame` draws one screen: a sticky 54px bar and a collapsing title block on the compact
layout, a wide header row above the content on the desktop one. It creates no scroll container,
because the scroller belongs to whoever runs the screen — the plugin stack's per-screen card, the
kernel's `<main>` — and takes that element as `scrollRootRef` to stick against and to observe from.

Everything inside that scroller is the frame's: the bar row, the title block, the desktop header,
the gap between the header and the content, and the horizontal gutters. It takes no class-name props
and emits no `md:` or `lg:` variant, and both halves of that are load-bearing. `compact` is a
JavaScript boolean resolved from the kernel's viewport, while a media query inside a plugin document
is resolved against the iframe: at a 1000px window the kernel sends `compact: false` and the iframe
measures 720px, so a gutter spelled `px-4 md:px-0` draws the mobile padding under the desktop header.
A caller that reaches in with its own header class can also clamp a height the frame decides, and the
overflow lands on the content underneath. A narrower column is `width="readable"`, not a class.

The bar turns opaque when a zero-height sentinel passes under it — one `IntersectionObserver` and a
CSS transition, not scroll-linked progress, because `animation-timeline: scroll()` is unavailable on
the iOS baseline. The observer is keyed to the sentinel node rather than to the frame's mount: a
search row takes the bar over and removes the sentinel with the title block, and the sentinel that
comes back afterwards is a different element. Keyed to the mount, nothing would observe it and the
bar would stay opaque until the route remounted. A bar carrying a search row is opaque outright,
since an input cannot float over scrolling content, and the `<h1>` stays in the document as a
visually hidden heading so a screen names itself exactly once in every state. The content takes over
the gap the title block was giving it, because a search row is a bar row and carries no spacing of
its own; leaving that to the caller joins the results to the input.

`ScreenBarButton` draws the 44px controls in that bar and deliberately carries no text colour. A
caller's class cannot beat one baked into a component: the cascade orders utilities by the
stylesheet, not by the order of `clsx` arguments, so `min-h-6` passed to a component whose variant
says `min-h-10` is silently a no-op. Anything a call site must be able to choose stays out of the
component's own class string.

## Controls

Radiogroup-shaped controls compose `RadioGroup`, which owns `role`, `aria-checked`, roving
`tabIndex`, and Arrow/Home/End with selection-follows-focus. Consumers supply visuals through
`renderOption`. Menus are deliberately not consumers: they move focus without selecting.

`Select` commits on activation and closes, but `RadioGroup` selects on Arrow/Home/End too, so it
tracks whether the pending change came from keyboard navigation and leaves the modal open for those.
Dropping that distinction makes the first arrow press close the picker on whichever option it lands
on.

`ReorderableList`'s drag handle is a real button, because a pointer-only handle offers no keyboard
path at all. It carries no drag-and-drop dependency: pointer capture and CSS transforms do the work,
and the row transitions collapse under `motion-safe`. The consumer-supplied item label is what names
the handle and what the live-region announcement reads.
