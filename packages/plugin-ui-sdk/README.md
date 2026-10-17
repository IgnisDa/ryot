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
real object (an exercise, a settings group, a dialog), and surfaces nest at most one level. Shadows are
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

Both themes use the same warm neutral family. Dark cards drop their edge (`border-card` matches the
surface) and rely on tone. `palette-contrast.test.ts` keeps text pairs at 4.5:1 and boundaries at 3:1.

Type uses Geist for UI and Lora only for page and media titles. Roles: `text-display` (36/42),
`text-title` (28/34), `text-heading` (18/24), `text-metric` (22/26), and `text-timer` (32/36); body
copy is `text-sm`, labels 13px medium, captions `text-xs`. Digits that change use `tabular-nums`.

Controls are 36px (`md`) and 32px (`sm`) on fine pointers and grow to 44px and 40px under
`pointer-coarse:`, which also raises text inputs to 16px. Size by pointer, never by viewport, because a
plugin iframe's width does not describe the device. Radii are `sm` 6 (small buttons, cells, menu
items), `md` 8 (buttons, inputs, artwork), `lg` 12 (cards, groups, menus), and `xl` 16 (dialogs).
Motion is 100ms for state, 150ms for toggles, and 200–240ms for entering overlays, with one ease-out
curve.

## Component Usage

- `Button`: `primary` is the single next step in a region; `secondary` (neutral fill) is for frequent
  actions; `outline` sits on artwork or tinted rows; `ghost` is for toolbars and tertiary actions;
  `danger` is the final destructive confirmation and `dangerGhost` the destructive entry in a list.
  `loading` keeps the label for assistive technology and blocks activation. `IconButton` requires a
  label.
- `MultiSelect` opens a searchable checklist from a field, or from a pill with `variant="chip"` for
  rows of filters.
- `Field` labels one control and wires its hint and error through `aria-describedby`. `TextField` and
  `TextArea` are form inputs; `CellInput` is the borderless filled cell for repeated numeric entry.
- `Switch` applies immediately; `Checkbox` and `Radio` belong to saved forms; `SegmentedControl`
  switches 2–4 modes; `Tabs` switches content areas of one object, and the caller renders one
  `tabpanel` with the given `panelId`, labelled by `tabId(panelId, value)`.
- `Card` frames an object; `RowGroup` with `Row` holds settings and fact lists as divided rows.
- `Badge` tones encode status with a dot and text, never color alone. `Notice` is persistent inline
  feedback; danger notices are alerts. `EmptyState` and `Skeleton` cover empty and loading content.
- `Dialog` is the standard modal panel, centred, as a side sheet, or as a bottom sheet, built on
  `Modal`. Callers choose `sheet` when `compact` and pass `safeAreaBottom`, which pads the footer;
  a sheet's footer buttons share its width. `Tooltip` names icon-only controls for fine pointers and is
  hidden on touch.
- `ActionDock` is the floating bottom bar for a screen's next action. Mount it through the screen's
  floating root, pass `safeAreaBottom`, and pad the scrolled content so the dock never covers the end.
- `Stepper` edits a whole number with − and + buttons; Arrow keys step and Page keys step four times.
  Pass `clockFormat.format` and `clockFormat.parse` to show and type seconds as m:ss.
- `ProgressBar` is a thin determinate bar for timers, in `accent` or `info`.
- `CompletionToggle` is the repeated row check: `complete` is a pressed toggle with a success fill,
  `start` an accent outline that starts work, and `include` a checkbox. Keep its label stable and let
  pressed state carry the change.
- `group-*` colors (`blue`, `purple`, `teal`, `orange`, `crimson`) and their `-soft` fills mark
  superset and grouping identity in both themes. Pair a color with its name or a label, never color
  alone.
- `DataTable` stays unstyled; tables use 12px subtle headers, divided rows, `hover` row fill, and
  right-aligned tabular numbers.

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

`./charts` exposes Ryot chart components, not TanStack Charts: the pinned alpha stays behind this
wrapper and plugins cannot import it directly. `CalendarHeatmap` draws TanStack `cell` marks on fixed
band scales (factory scales would infer row order from data), colors level 0 with `--chart-seq-0`
and splits positive values into five equal bands of the maximum (`--chart-seq-1..5`). Its tooltip
uses the portal extension because the heatmap sits in its own horizontal scroller, which would clip
an in-chart tooltip. `RankedBarList` is plain HTML so labels and values stay wrapping-aware text in
text tokens. `theme.css` maps the TanStack `--ts-chart-*` variables at `:root` so portaled tooltips
still resolve them.

`Sparkline` is a fixed 96x28 chrome-free line with an area fill and emphasised last
point. `TimeSeriesChart` draws on linear scales over epoch milliseconds, because the pinned alpha ships no
time scale, with calendar ticks computed in the component. Readings own focus and the tooltip; the band,
trend, and compare marks are decorative. The caller computes trends, and the compare series gets its own
right axis in `--info`.

Level 0 and level 1 in the light heatmap ramp differ mostly by hue, not luminance.

## Sync Marks

`fieldSyncState` returns `ready`, `pending`, or `absent` from a selected value and entity sync state.
Present values are always ready; status matters only when a selected value is missing.

`EntityArtWell` is the product's artwork surface and missing-image placeholder. `SyncPip`,
`SettleHighlight`, `TranslationChip`, and `SyncCountLine` provide the matching status vocabulary.
Each animated element contains its own `motion-reduce:` guard because plugin documents do not receive
kernel-only reduced-motion CSS.

## Shortcuts And Overlays

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

Compact title collapse uses one sentinel `IntersectionObserver`, keyed to the sentinel node so it is
reattached after a search row removes and restores that node. Search keeps the semantic `<h1>`
visually hidden and makes the bar opaque.

A hero is `{ height, node }`. The frame positions its box out of flow from the scroll origin through
the safe area, bar, and declared art height; the node fills it. The declared height is also the title
collapse threshold. Hero content must not add safe-area or bar arithmetic.

`ScreenBarButton` supplies the bar's 44px control shape but no text color. Callers cannot reliably
override baked Tailwind utilities because stylesheet order, not `clsx` argument order, controls the
cascade.

## Controls

`RadioGroup` owns radiogroup semantics, roving focus, and Arrow/Home/End selection. Consumers provide
visuals through `renderOption`; menus are not radiogroups. `Select` closes on activation, while a
radio picker stays open for keyboard selection.

`ReorderableList` ships pointer and keyboard reordering without a drag-and-drop dependency. Its drag
handle is a real button, supports Arrow/Home/End, and announces the new position through a live
region. Consumers supply the item key, label, and handle icon.
