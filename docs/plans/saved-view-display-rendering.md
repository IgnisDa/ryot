# Saved View Display Rendering Plan

## Goal

Replace `apps/app-client/src/app/(app)/(shell)/(drawer)/v/[viewSlug].tsx` with a responsive saved-view screen that:

- Loads a saved view by slug.
- Executes its existing `queryDocument` unchanged.
- Renders the result as grid, list, or table from `displayConfiguration`.
- Persists the selected layout locally per saved-view slug.
- Handles loading, missing, error, empty, and populated states.
- Uses `Web Saved View` and `Mobile Saved View` in `apps/app-client/design.pen` for visual direction.

The content in `design.pen` is representative. Do not infer new fields, slots, or domain rules from its sample data.

## Scope

Included:

- Grid, list, and table rendering.
- One grid/list/table selector.
- Local per-view layout persistence, defaulting to grid.
- Value formatting and missing-image handling.
- Display states and responsive styling.

Excluded:

- Search, filters, sorting, and pagination controls.
- Add, edit, clone, delete, or other saved-view actions.
- Online search and entity creation.
- Card, row, or entity-detail navigation.
- Backend, contract, or persisted-query changes.
- Server-synchronized layout preferences.

If implementation appears to require excluded work or a backend/contract change, stop and ask the user before expanding scope.

## Contract Rules

Read `apps/app-client/src/app/(app)/(shell)/(drawer)/v/AGENTS.md` before implementation.

- Grid and list independently map `titleField`, `imageField`, `overlineField`, `primaryMetadataField`, `secondaryMetadataField`, and `calloutField`.
- Table independently maps `imageField` and ordered `columns`.
- A null field mapping removes that card slot or image region.
- A mapped null card value removes that card value.
- A mapped null table value keeps an empty cell so columns remain aligned.
- A configured image with no usable URL keeps its dimensions and shows the shared placeholder.
- Layout components own placement, typography, truncation, image size, and crop.
- General values are formatted from their RyotQL scalar kind. Definition-specific text composition remains in RyotQL.

## Effect APIs

Use `/tmp/effect` as the API reference and confirm against the installed workspace version.

- Use `Atom.family` for slug-keyed query and preference atoms: `/tmp/effect/packages/effect/src/unstable/reactivity/Atom.ts:1358-1399`.
- Use `Atom.kvs` with `storageRuntime` for local layout persistence: `/tmp/effect/packages/effect/src/unstable/reactivity/Atom.ts:2160-2215`.
- Use `useAtomValue` and `useAtomSet` normally with family-produced atoms: `/tmp/effect/packages/atom/react/src/Hooks.ts:105-229`.
- Keep the existing `appQueryClient` SWR and retry behavior. Do not add `fetch` or `useEffect` data loading.

Use two component stages so hooks stay unconditional:

1. The route reads the saved-view-record atom for `viewSlug`.
2. Its success branch renders a child with the decoded record.
3. The child reads the result atom and layout-preference atom.

Do not nest `WorkspaceScreenFrame`; parent layouts already provide it.

## Suggested Files

```text
apps/app-client/src/
  api/atoms.ts
  app/(app)/(shell)/(drawer)/v/[viewSlug].tsx
  modules/saved-views/
    display-data.ts
    display-data.test.ts
    display-value.ts
    display-value.test.ts
    saved-view-grid.tsx
    saved-view-list.tsx
    saved-view-table.tsx
    saved-view-layout-selector.tsx
```

Keep files combined when that remains clear. Do not add barrels or speculative abstractions.

## Phase 1: Confirm Design Direction

- [x] Inspect `Web Saved View` and `Mobile Saved View` directly through Pencil.
- [x] Record only the required spacing, typography, image treatment, row density, table treatment, responsive behavior, and display states.
- [x] Map visual regions to the existing display slots without adding domain-specific behavior.
- [x] Use the web selector direction on desktop.
- [x] On mobile, place a compact, single-line grid/list/table selector below the heading, based on the existing `Control / Layout Segmented` component direction.
- [x] Do not edit `design.pen` unless separately requested.

### Confirmed Visual Direction

- Desktop content uses a 32 px inset and 20 px section spacing. The heading pairs the view icon with a 30 px title and a secondary 14 px result count. Keep the 34 px, three-icon web segmented selector in the heading region.
- Mobile content uses a 16 px inset. The heading pairs the view icon with a 19 px semibold title and an 11 px result count. Place the 36 px, three-icon pill selector on its own single line below the heading rather than reproducing search, filter, add, or navigation controls.
- Grid uses dominant cropped imagery. Desktop uses compact poster cards with an approximately 170 by 228 image, 14 px title, 12 px supporting text, and 18-20 px gaps. Mobile uses two edge-to-edge columns with a narrow gap, image overlays, a 16 px semibold title, and compact supporting values.
- List uses separated compact rows. Desktop rows are approximately 72 px with a 44 by 64 cropped image, 15 px title, and 13 px supporting values. Mobile rows are approximately 120 px with a 70 by 104 cropped image, 17 px semibold title, and tightly stacked supporting values.
- Table uses a subdued 34 px header and compact rows separated by fine rules. Desktop rows are approximately 48 px with a 26 by 36 leading image; mobile rows are approximately 56 px with a 22 by 32 leading image and retain all configured columns through horizontal overflow.
- Map `overlineField`, `titleField`, `primaryMetadataField`, `secondaryMetadataField`, and `calloutField` to progressively supporting card text without inferring meaning from field names. Map each layout's independent `imageField` to its image region. Map ordered table columns to labeled cells and place the optional table image before the first cell value.
- Loading, missing, failure, malformed-response, and empty states use the same calm centered treatment within the content region. The empty state shows only the specified icon and copy; omit all representative search, create, and add actions.
- `design.pen` was inspected only and was not edited.

## Phase 2: Add Data And Preference Atoms

- [x] In `src/api/atoms.ts`, add a slug-keyed `savedViewRecordAtom` using `buildSavedViewRecordDocument({ slug })`.
- [x] Add a record-keyed result atom that executes `record.queryDocument` unchanged through `ryotql.execute`.
- [x] Add a slug-keyed persisted layout atom with this shape:

```ts
Atom.family((viewSlug: string) =>
  Atom.kvs({
    runtime: storageRuntime,
    key: `saved-view-layout:${viewSlug}`,
    schema: Schema.Literals(["grid", "list", "table"]),
    defaultValue: () => "grid" as const,
  }),
);
```

- [x] Keep all app-owned atoms in `src/api/atoms.ts`.
- [x] Do not add a nested/dependent atom abstraction; pass the decoded record to the result atom family from the success child.

## Phase 3: Build The Presentation Boundary

- [ ] Add one pure helper that converts the saved view's single rows result into renderer-owned items.
- [ ] Keep generic `RowItem` parsing inside this helper; UI components must not parse projection keys.
- [ ] Decode scalar values with the exported concrete RyotQL value schemas so `kind` and `value` agree.
- [ ] Reject nested results, missing configured fields, malformed scalar values, and non-text IDs/titles as decode errors.
- [ ] Accept text or null for configured image fields.
- [ ] Keep absent image mappings distinct from configured images whose row value is null.
- [ ] Preserve table labels and column order.
- [ ] Return the rows and `pageInfo` together.
- [ ] Validate dates before formatting, or make date formatting return a safe fallback instead of throwing.

Use a small presentation shape. It only needs:

- Entity ID.
- Per-layout title, image state, overline, metadata, and callout.
- Table image state and ordered labeled cells.
- Page information.

Do not create a second copy of the saved-view contract.

## Phase 4: Build Rendering Components

### Shared behavior

- [ ] Add one pure scalar formatter for text, number, date, boolean, JSON, and null.
- [ ] Use locale-aware number and date formatting.
- [ ] Never display `[object Object]`; use compact JSON as the conservative JSON fallback.
- [ ] Add one shared image treatment using `expo-image`.
- [ ] Render no image region for an unconfigured image slot.
- [ ] Render the same stable placeholder for a configured image with a missing or failed URL.

### Layouts

- [ ] Build the responsive grid from the grid display slots.
- [ ] Build compact mobile/web list rows from the list display slots.
- [ ] Build the table from its ordered columns.
- [ ] Place the optional table image in the leading region of the first configured column's cell; it is not a separate labeled column.
- [ ] Keep empty table cells and headers aligned.
- [ ] Use horizontal overflow on narrow screens rather than hiding configured columns.
- [ ] Use entity ID as the stable item key.
- [ ] Do not make cards or rows interactive in this phase.

### Selector

- [ ] Build an accessible grid/list/table selector.
- [ ] Bind it to the per-slug layout atom.
- [ ] Expose selected state and clear labels.
- [ ] Add supported selector icons to `modules/icons.tsx` or use concrete styled Lucide icons; do not rely on fallback circles.

## Phase 5: Integrate Route And States

- [ ] Read and validate `viewSlug` from the route.
- [ ] Load and decode the saved-view record with `decodeSavedViewRecordResponse`.
- [ ] Render explicit record loading, failure, malformed-response, and missing-view states.
- [ ] In the record-success child, execute the saved view and decode it through the presentation helper.
- [ ] Render query loading, failure, malformed-response, empty, and populated states.
- [ ] Keep stale successful content visible during SWR refresh when available.
- [ ] Render the view icon, name, result count, and layout selector.
- [ ] Use this non-interactive empty copy: `No items in {record.name}` and `This saved view has no results.`
- [ ] Do not reproduce action buttons from representative empty designs.
- [ ] Do not add a route-local back button; the existing shell owns navigation.
- [ ] Render only the existing query's page. Do not modify its pagination, predicates, ordering, or projection.

## Phase 6: Tests And Verification

### Focused tests

- [ ] Test all card slots and independent layout image mappings.
- [ ] Test absent images, null images, and failed image fallback behavior where practical.
- [ ] Test null card omission and null table cell preservation.
- [ ] Test ordered table labels and cells.
- [ ] Test text, number, date, boolean, JSON, and null formatting.
- [ ] Test invalid dates do not throw.
- [ ] Test malformed scalar values, nested results, missing fields, and invalid required text values produce decode failures.
- [ ] Test app-owned behavior only; do not test Effect, schema-library, or TypeScript behavior.

### Manual display checks

- [ ] Verify loading, missing, error, empty, grid, list, and table states.
- [ ] Verify mobile and desktop widths against `design.pen`.
- [ ] Verify long titles, missing optional values, missing images, mixed scalar kinds, and many table columns.
- [ ] Verify selector keyboard access, focus visibility, labels, and selected state on web.
- [ ] Verify layout choice persists independently for two saved-view slugs.

### Commands

- [ ] Run `bun turbo --filter=@ryot/app-client check`.
- [ ] Run `bun turbo --filter=@ryot/app-client test`.
- [ ] Run `bun turbo --filter=@ryot/app-client build`.
- [ ] Run `git diff --check`.
- [ ] Review only changed code for unnecessary abstraction or scope expansion.

## Acceptance Criteria

- [ ] A valid slug loads its saved-view definition and executes its stored query.
- [ ] Grid, list, and table render only from `displayConfiguration` and decoded result values.
- [ ] Each layout honors its independent nullable image mapping.
- [ ] Card nulls collapse; table nulls preserve column structure.
- [ ] General scalar values are formatted centrally and safely.
- [ ] The selected layout persists locally per slug.
- [ ] The screen matches current mobile/web design direction and has explicit display states.
- [ ] UI components do not parse generic `RowItem` values directly.
- [ ] No excluded interactions or backend changes are introduced.

## Handoff

- No product decisions are pending for this scope.
- The layout selector is the only included interaction.
- Ask the user before expanding scope.
- Use Pencil tools for `design.pen`; do not read the encrypted file through filesystem tools.
- Use `turbo` for app-client commands.
