# Client UI SDK

`@ryot-app/plugin-ui-sdk` provides presentation and interaction primitives shared by the kernel and
plugin documents. Runtime code, base styles, and tokens enter every plugin document, so additions
must justify their bundle cost.

## Styles And Exports

`theme.css` maps Tailwind tokens and contains shared accessibility base rules. `palette.css` supplies
all token values; its `:root` is complete and dark modes override only changed values. Both files are
loaded by the kernel and shipped once in the shared client runtime's `runtime.css`; plugin artifacts
reference their tokens without emitting them. A Tailwind utility outranks the base layer, so
a component using `outline-none` must provide an equivalent focus indicator.

Touch-layout text inputs stay at least 16px to prevent persistent iOS page zoom.

`ActionForm` provides named form semantics and Enter-to-submit behavior without native form submission.
Use it in plugin documents, whose iframe sandbox does not grant the `allow-forms` capability.

Heavy or optional surfaces remain on subpaths:

| Subpath         | Contents                                              |
| --------------- | ----------------------------------------------------- |
| `./schema-form` | `AppSchema` form and its contract/form dependencies   |
| `./table`       | Generic data table and column contract                |
| `./charts`      | Heatmap, ranked bars, sparkline and time-series chart |
| `./icon`        | The complete registered product icon set              |
| `./sync`        | Entity population and translation marks               |
| `./tint`        | Best-effort image tint extraction                     |
| `./markdown`    | Safe Markdown content and spoiler-free plain preview  |

Do not re-export these from the root barrel. Components accept icons as `ReactNode` and schema forms
accept upload transport as a prop, keeping this package independent of auth, servers, and client
capabilities. Tint extraction requires CORS-readable images and silently returns no tint when image,
canvas, or CORS access fails.

## Visual Foundations

Structure comes from spacing first, then hairline dividers, then a surface. A filled surface marks a
real object (a record, a settings group, a dialog), and surfaces nest at most one level. Shadows are
reserved for things that float: menus, tooltips, and dialogs.

| Role       | Tokens                                                                       |
| ---------- | ---------------------------------------------------------------------------- |
| Canvas     | `bg` page, `surface` cards and inputs, `raised` overlays                     |
| Fills      | `surface-2` neutral buttons, cells, tracks; `surface-3` their hover; `hover` |
| Lines      | `border` dividers, `border-card` card edges, `border-emphasis` outlines      |
| Boundaries | `border-strong` input and control edges (3:1)                                |
| Text       | `text`, `text-muted`, `text-subtle`                                          |
| Accent     | `accent` fill with `accent-ink`, `accent-text` text, `accent-deep` controls  |
| Status     | `success`, `danger`, `warning`, `info`, each with a `-soft` background       |

Both themes use warm neutrals; dark cards rely on tone instead of edges. Contrast tests require
4.5:1 text and 3:1 boundaries. Geist is the UI font; Lora is reserved for page/media titles. Use the
`text-display`, `text-title`, `text-heading`, `text-metric`, and `text-timer` roles and tabular digits
for changing values. Theme tokens own exact type, radius, and motion values.

Controls grow under `pointer-coarse:`; plugin iframe width is not device size. Each animation respects
reduced motion inside its document, not through kernel-only CSS.

## Component Usage

| Component                       | Use and caller obligations                                                                                                                                                                                                                                                                                                                           |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button`                        | One primary next step per region; secondary for frequent actions, outline on artwork, ghost for tertiary controls. Destructive entry uses `dangerGhost`, confirmation `danger`; `link`/`linkPlain` are inline text actions that ignore `size` and default to `type="button"`. Loading preserves its accessible label; icon-only buttons require one. |
| `MultiSelect` / `MenuButton`    | Searchable choices or action menus. Chip variant fits filter rows. Custom menu triggers spread the supplied props/ref; closing restores focus.                                                                                                                                                                                                       |
| `Field` / inputs                | Field connects label, hint, and error. `CellInput` serves repeated numeric entry.                                                                                                                                                                                                                                                                    |
| `Switch` / `Checkbox` / `Radio` | Switch applies immediately; checkbox/radio belong to saved forms.                                                                                                                                                                                                                                                                                    |
| `SegmentedControl` / `Tabs`     | A few modes versus one object's content areas; `fill` spreads segments across the row. Tabs callers render the matching `tabpanel` and supplied label IDs.                                                                                                                                                                                           |
| `Card` / `RowGroup`             | Real objects versus divided settings/fact rows.                                                                                                                                                                                                                                                                                                      |
| `Badge` / `Notice`              | Status uses text, not color alone; danger notices are alerts. `StatusMessage` `action` adds one inline follow-up such as a retry. `EmptyState`/`Skeleton` cover empty/loading content.                                                                                                                                                               |
| `Dialog`                        | Choose compact sheets and pass safe-area padding. `closeIcon={null}` requires footer decisions; touch users cannot rely on tooltips.                                                                                                                                                                                                                 |
| `ActionDock`                    | Mount through the floating root, pass bottom inset, and pad scrolled content.                                                                                                                                                                                                                                                                        |
| `Stepper`                       | Integer stepping; `clockFormat` adapts seconds to `m:ss`.                                                                                                                                                                                                                                                                                            |
| `ProgressBar`                   | Determinate progress in a semantic tone.                                                                                                                                                                                                                                                                                                             |
| `DataTable`                     | Unstyled data with divided rows and right-aligned tabular numbers.                                                                                                                                                                                                                                                                                   |

`groupColors`, `groupColorVariable`, and `Card.groupColor` provide labeled group identity; never
communicate identity through color alone.

`SchemaForm` renders `AppSchema` with caller-supplied upload, preview, OAuth, and haptic transports.
Missing capabilities/dynamic choices produce field errors. OAuth and temporary uploads must be
top-level fields. Decoding and normalization match backend writes: required means present/non-null,
clear writes null, and empty lists remain `[]`. Date-only values are unchanged; datetimes submit UTC
using the supplied/device zone. Edit disables immutable fields. Omitted object secrets and unchanged
secret-bearing arrays are retained; editing an array replaces it and requires its secrets again.

## Markdown

`MarkdownContent` takes `text` and an `onOpenLink(url)` callback. It renders paragraphs, emphasis,
lists, blockquotes, breaks, and absolute HTTP/S links checked with the contract's `HttpUrl` schema.
Producers resolve relative URLs. Link activation prevents document navigation and delegates to the
caller, which owns capability execution and error reporting. Anchors retain real hrefs for copying.
Raw HTML is skipped. Unknown directives retain their content without applying attributes.
`:spoiler[text]` uses an independent reveal button; `:::spoiler` uses initially closed native details.
Directive attributes are ignored. `markdownPlainText` parses the same directive syntax, removes
spoiler bodies and raw HTML, and produces readable text for clamped previews. Typography is inherited
from the caller; all component styles use scannable Tailwind utilities and theme tokens.

## Charts

`./charts` wraps chart dependencies; plugins import Ryot components, not TanStack directly.
`CalendarHeatmap` uses a zero level plus five positive bands of the maximum, fixed row ordering, and
portaled tooltips outside its scroller. `RankedBarList` keeps labels/values as wrapping-aware HTML.
`Sparkline` is chrome-free with area fill and a highlighted last point.

`TimeSeriesChart` uses epoch milliseconds and calendar ticks. Reading marks own focus/tooltips;
bands, trends, and comparisons are decorative. Callers compute trends; comparisons use a separate
right axis. Root theme variables also apply to portaled tooltips.

## Sync Marks

`fieldSyncState` returns `ready`, `pending`, or `absent` from a selected value and entity sync state.
Present values are always ready; status matters only when a selected value is missing.

`EntityArtWell` is the product's artwork surface and missing-image placeholder. `SyncPip`,
`SettleHighlight`, `TranslationChip`, and `SyncCountLine` provide the matching status vocabulary.

## Shortcuts And Overlays

`MotionList` animates keyed insertions, removals, and position changes. `Collapse` animates intrinsic
height without scaling its contents; `MotionSwap` handles keyed state changes such as mode changes.
These primitives use Motion and respect reduced motion inside each document. Use CSS transitions for
control colors and press feedback. Keep ticking numbers and input values outside animation keys.

Use `MotionScrollRoot` for a scroll container containing layout-animated elements. The client SDK
uses it for each plugin screen. `ScreenFrame` and `ActionDock` mark top and bottom scroll obstructions.

Wrap conditional dialogs in `MotionPresence`, giving each direct child a stable key, to retain panels
and scrims through their exit. Exiting controls are inert and hidden from assistive technology;
background locks last until the exit completes. Nested dialogs share lock ownership and restore focus
only when another overlay has not already taken it.

Bottom sheets drag downward from their handle or header. Short pulls snap back; a deliberate pull or
flick uses the same dismissal gate as Escape and the scrim. The content area keeps normal scrolling.

`useFocusedFieldVisibility` runs once per document, shared by mounted callers. Kernel startup and
`RyotProvider` install it for their own realms. Focus and viewport changes reveal editable fields
inside their scroll containers, clear of pinned chrome. Native iOS keyboard resizing requires a
second reveal after WebKit resets its scroll insets; sandboxed plugin focus is not visible to the kernel.

`useShortcut` ignores single-key shortcuts while editable content has focus and registers each
shortcut in the nearest `OverlayScope`. Only the top scope runs, so callers do not gate shortcuts on
whether another overlay is open.

`OverlayScope` owns shortcut scope and Escape arbitration. `useFocusTrap` contains Tab only.
`useFieldEscape` gives search fields clear-then-blur behavior, but is not for ordinary form fields.
Ordinary shortcuts stay document-local; reserved kernel shortcuts are forwarded semantically by the
client SDK.

## Screen Frame

`ScreenFrame` renders one screen with compact and wide layouts. It owns the sticky bar, one `<h1>`,
title/header area, gutters, and content rhythm, but creates no scroll container. The caller supplies
the scroller through `scrollRootRef`.

Layout branches use the kernel-provided `compact` boolean, not responsive utilities, because a plugin
iframe's media queries measure the iframe rather than the outer viewport. The frame accepts no class
name for its owned layout; use `width="readable"` for a narrow column. Safe-area top is a numeric prop.

Title-collapse observation follows the sentinel node, including search-row replacement. Search keeps
a visually hidden semantic `<h1>` and opaque bar.

A hero is `{ height, node }`. The frame positions its box out of flow from the scroll origin through
the safe area, bar, and declared art height; the node fills it. The declared height is also the title
collapse threshold. Hero content must not add safe-area or bar arithmetic.

`ScreenBarButton` supplies bar control geometry, not text color; callers choose color without fighting
baked Tailwind utilities.

## Controls

`LoadMoreButton` uses `isFetchingNextPage` for its loading label and spinner. Its independent
`disabled` prop can block interaction during background refresh without claiming that another page
is loading. Callers supply labels and optional icon content; the component does not depend on query
or transport services.

`RadioGroup` owns radiogroup semantics, roving focus, and Arrow/Home/End selection. Consumers provide
visuals through `renderOption`; menus are not radiogroups. `Select` closes on activation, while a
radio picker stays open for keyboard selection. `ChipRadioGroup` is that composition for chip rows
that scroll or wrap.

`ReorderableList` ships pointer and keyboard reordering without a drag-and-drop dependency. Its drag
handle is a real button, supports Arrow/Home/End, and announces the new position through a live
region. Consumers supply item key, label, handle icon, and pickup/drop platform feedback. Successful
keyboard moves also give drop feedback.
