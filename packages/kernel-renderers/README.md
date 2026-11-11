# Kernel Renderers

The saved-view and collection renderers the kernel ships: `entity-browser`, `collection-browser`,
`results-table`, `calendar`, `analytics`, `collection-detail`, and `publication`. They are ordinary
client-plugin sources — typechecked, formatted, linted, and unit-tested here — not string literals
embedded in backend code.

`bun run build` walks `src/*.{ts,tsx}` and writes `src/sources.generated.ts`, a record from the
archive path (`client/<file>`) to the exact source text. `src/index.ts` turns that record into the
`{ files, name, sourceHash, definition }` shape `kernel/backend` hands to the client plugin
compiler, so `sourceHash` covers precisely the bytes that get compiled. Regenerate sources after renderer changes with `bun run build`.

Renderers obey the client plugin import allowlist, so they may only reach React, `clsx`, the client
SDKs, and the matching `@ryot-app/ryotql-recipes` entrypoints. Tests mount them through `mountPluginPage` from
`@ryot-app/plugin-client-sdk/testing`, which boots a real bridge handshake, so a test asserts on the
messages the renderer actually puts on the port.

The browser owns its own screen chrome inside the iframe: the saved view's name and icon, search,
layout, the Filters dialog (the **Sort by** field selector, separate direction button, and filter
rules), active-filter chips, the result and sync count line, and the compact search row, options sheet,
and add FAB. Entity-browser cards come from registered entity presentations, and the table renders
entity art from a `managed-asset` table column. A `rating` table column carries a nullable stored 0-100
rating that table cells show in the viewer's rating-scale preference, and nothing while preferences
are loading or unavailable. Collection-browser reuses the shared controller and
renders kernel collection cards with batched member counts.

The shared browser controller lives in `@ryot-app/plugin-client-sdk/browser` (see the client SDK
README). Renderers adapt it: saved views supply named reference requests for rows, count, and IDs, plus the optional
provider Add flow, and render results through `EntityBrowserResults`; collections adapt the
collections recipe, never expose Add, and pass `{ collectionId }` as the entity presentation context.

Saved views, the collections list, and collection detail offer **Select**. Selected results, or every
result matching the current search and filters, go to the kernel collection members screen through
`screens.changeCollectionMembers`: saved views and the collections list offer **Add to collection**,
and collection detail also offers **Remove**. Publications offer no selection.

The publication renderer reuses the entity browser over a publication's subjects in published
order, under a summary of the description, the owner's name when shown, and the item count that the
host passes as renderer settings. It offers only fields and filters that read entity columns, because
visitors cannot read events or the owner's collections. Browsing waits for control metadata, with a
retry state that preserves URL filters and sort. Inline executions retain the full authored document
and select the requested query by name, including filtered counts that reference source controls.
Opening a card sets the `item` page search
parameter, which shows that item's card, its entity-column browse values, and the other published
items it is linked to.

Collection detail and entity-browser saved views offer **Share**, which opens the kernel share sheet
through `screens.sharePublication`. Collection-browser views do not, because only entity-browser
views can be published.

Browser and results-table pagination use the client SDK's shared infinite-query state. Background
refresh retains all loaded results and refreshes their loaded depth atomically; only an explicit
next-page request activates the load-more control's loading state.

The provider Add action carries a typed `EntitySchemaReference`, including its exact owner.
Plugin-authored settings use a self-relative authored reference that materializes to that local
owner. Generic browser results retain each selected entity's actual owner for presentation selection;
the current workspace does not supply schema ownership.

Renderer queries return Effects from `createRyotQuery` callbacks. Collection detail loads the
header, type aggregate, and unfiltered total as separate page-refreshed queries and mounts the
controller only when all three have data; the infinite members query reads members and their order revision together. The
controller remounts, with a fresh members query and filter fields, when the membership schema or the
presence of member types changes. Query cancellation follows Effect interruption when the page
unmounts.

Collection detail offers an unfiltered reorder mode using the shared pointer/keyboard list and bridged
platform haptics. Moves save immediately through the canonical collection command. Start/end actions
span unloaded pages; dragging to a loaded page's boundary uses an anchor, not a guessed global position.
Failed transport submissions retain their identity for retry. Changed order revisions reject continuation
pages and require a refresh, so pages from different collection orders are never appended together.

## Filters

Entity browsers request authorized control descriptions before their first page. Backend browse
resolution supplies schema fields, the kernel Collections relationship, and a Name sort; the view
query's full order is the default. **Sort by**
selects a field; a separate button shows its current direction label and arrow. Choosing a new field
uses that field's declared default direction, while reselecting the current field preserves its
direction. The shipped Name sort defaults to A–Z; shipped count, rating, and date sorts default to
descending. The **Default order** choice retains the full source query order and disables direction.
The rules panel, the chips row, the filters sheet, and the relationship choices queries come from
`@ryot-app/plugin-client-sdk/filters`;
the shared browser controller composes them and owns the state. Renderer sources import filter
helpers only from `@ryot-app/ryotql-recipes/filters`, never from the contract.

The results table reuses the panel and chips for its described value controls (no Collections
relationship, sort, or layout) and reads the `filters` parameter straight from the page location.

Filter state lives only in the `filters` search parameter: `base64url(JSON of Filter)`, written with
the same pending-search path as sort and search so URL, query identity, and the visible results move
together. Decoding is lenient: leaves with unknown fields, operators outside the field type, or
invalid values are dropped. The panel edits one flat match-all or match-any group; a nested tree
renders as one clearable Custom filter chip. Rules that are not yet complete stay in panel state and
out of the query, and each completed change applies immediately. The Filters button, compact options
button, and chips share one applied-rule count.

Relationship values load through `linkedFilterChoicesRecipe`: the editor pages by name search,
and chips resolve names by the rule's entity IDs. Until names resolve, or for entities that no
longer exist, a chip shows the count form (for example "<Field>: 2 selected") instead of raw IDs.
Count all, the pages, and the filter-aware empty state all use the applied filter; the query Effect
reads `now` from the Effect clock for relative-date rules.

Collection detail loads the browse fields of its member types (from the grouped aggregate) and
builds its controls with `collectionMemberControls`: Type, Also in collection, Date added,
the merged browse fields, and one `membership.<key>` field per supported membership
property; sorts are Name, Date added to collection, and browse sorts. Date added to library remains a
separate browse field. **Collection order** retains manual ranks and disables direction.
With no search or filter applied the controller shows the known total instead of offering Count all.

## Calendar

The calendar renders the kernel `calendar` saved view over every effective calendar source that
installed plugins contribute. `calendarSourcesRecipe` lists the sources with their plugin name and
hidden state; each visible source then loads through its own `calendarOccurrencesPageRecipe`
document under one kernel-generated query name, paging 100 rows at a time up to 1,000 per source per
month. A failing source shows its own error and a capped source a truncation notice; the others keep
rendering. Date sources are bounded by UTC calendar dates and grouped by their UTC date; instant
sources are bounded by the viewer's local month and grouped by local day.

Rows are kernel-owned rather than entity presentations, because one subject can occur many times in
a month. A row shows the decoded `art` locator, or an icon tile in the source's group colour, with
the subject name, caption, time (blank for date-only), and done mark, and links to the subject.
`month=YYYY-MM` and `layout=month` live in the URL. Source chips (or the compact Sources sheet) call
`calendarSources.setVisibility`; the server persists the hidden state and the host refreshes.
The renderer display name is `CALENDAR_KERNEL_RENDERER_DISPLAY_NAME` from the contract, which the
kernel host compares to gate that capability, so kernel renderer display names must stay unique.

## Analytics

The kernel `analytics` saved view uses declarative client analytics sections from the composition.
Its `/v/k/analytics` location stores the shared selection as flat `range`, `start`, `end`, `compare`,
and `group` parameters and the selected section as `section=<pluginId>/<slug>`; the renderer owns
these parameters and the saved-view route passes them through untouched. The renderer reads the authenticated reporting timezone, owns the page title and
section navigation, and mounts only the selected section. An absent or unknown `section` selects the
first contributor; section navigation appears only with several contributors, and an empty state
replaces content when there are none. Shared controls and section choices push page-search history.
Unavailable modules, reporting-preference failures, and per-section load/render failures have
separate states. Plugin sections receive `AnalyticsSectionProps` from the client SDK and own their
data queries and retries.

Saved-view browsers and tables execute named queries by reference and load control metadata with
`describe`. They wait for metadata before mounting filter-driven data queries so URL filters apply
to the first request. Typed recipe decoders consume fixed server-derived provenance keys.
Collection controls combine browse fields and explicitly projected membership outputs; runtime
arguments and pages travel independently of the full static document. Collection continuation
identity, including order revision, is validated by the server.
