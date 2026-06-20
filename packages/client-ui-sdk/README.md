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

For the same reason the schema form takes its upload transport as a `SchemaFileUpload` prop and
components take icons as `ReactNode` props: the SDK knows nothing about servers, auth, or scopes,
and owns no icon set.

## Shortcuts And Overlays

`useShortcut` pins `stopPropagation` and `conflictBehavior`, and single-key shortcuts do not fire
while an input, textarea, or contenteditable holds focus. Shortcuts are scope-aware: every
registration belongs to the innermost enclosing `OverlayScope`, and only the topmost scope's
shortcuts fire. A call site therefore never gates a shortcut on whether some overlay is open —
passing `enabled` for that is the bug the scope exists to prevent. A shortcut is registered against
the document that runs it, so a kernel shortcut never fires while focus sits inside a plugin iframe,
and vice versa.

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
