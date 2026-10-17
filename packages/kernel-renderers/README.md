# Kernel Renderers

The saved-view and collection renderers the kernel ships: `entity-browser`, `collection-browser`,
`results-table`, and `collection-detail`. They are ordinary
client-plugin sources — typechecked, formatted, linted, and unit-tested here — not string literals
embedded in backend code.

`bun run build` walks `src/*.{ts,tsx}` and writes `src/sources.generated.ts`, a record from the
archive path (`client/<file>`) to the exact source text. `src/index.ts` turns that record into the
`{ files, name, sourceHash, definition }` shape `kernel/backend` hands to the client plugin
compiler, so `sourceHash` covers precisely the bytes that get compiled. The generator runs from this
package's `test` and `check`, and from `apps/server`'s `build` and `run-migration`, alongside the
sandbox runner compiler.

Renderers obey the client plugin import allowlist, so they may only reach React, `clsx`, the client
SDKs, and the matching `@ryot-app/ryotql-recipes` entrypoints. Tests mount them through `mountPluginPage` from
`@ryot-app/plugin-client-sdk/testing`, which boots a real bridge handshake, so a test asserts on the
messages the renderer actually puts on the port.

The browser owns its own screen chrome inside the iframe: the saved view's name and icon, search,
layout, the Filters dialog (sort and the filter rules), active-filter chips, the
result and sync count line, and the compact search row, options sheet, and add FAB. Entity-browser
cards come from registered entity presentations, and the table renders entity art from a
`managed-asset` table column. Collection-browser reuses the shared controller and renders kernel
collection cards with batched member counts.

`entity-browser-controller.tsx` owns the shared browser controls, URL state, chrome,
states, and result layouts. Saved views adapt their configured recipe and optional provider Add flow;
collections adapt the collections recipe, never expose Add, and pass `{ collectionId }` as the entity
presentation context.

Browser and results-table pagination use the client SDK's shared infinite-query state. Background
refresh retains all loaded results and refreshes their loaded depth atomically; only an explicit
next-page request activates the load-more control's loading state.

The provider Add action carries a typed `EntitySchemaReference`, including its exact owner.
Plugin-authored settings use a self-relative authored reference that materializes to that local
owner. Generic browser results retain each selected entity's actual owner for presentation selection;
the current workspace does not supply schema ownership.

Renderer queries return Effects from `createRyotQuery` callbacks. Collection detail loads the
header, type aggregate, and unfiltered total as separate page-refreshed queries and mounts the
controller only when all three have data; the infinite members query then requests members alone. The
controller remounts, with a fresh members query and filter fields, when the membership schema or the
presence of member types changes. Query cancellation follows Effect interruption when the page
unmounts.

## Filters

Entity and collection browsers filter through the effective filter fields of their settings (the
view's `filterFields` plus the automatic Collections relationship). `browser-filters.tsx` owns the
rules panel, the chips row, and the relationship choices queries; `entity-browser-controller.tsx`
composes them and owns the state. Renderer sources import filter helpers only from
`@ryot-app/ryotql-recipes/saved-view-filters`, never from the contract.

Filter state lives only in the `filters` search parameter: `base64url(JSON of Filter)`, written with
the same pending-search path as sort and search so URL, query identity, and the visible results move
together. Decoding is lenient: leaves with unknown fields, operators outside the field type, or
invalid values are dropped. The panel edits one flat match-all or match-any group; a nested tree
renders as one clearable Custom filter chip. Rules that are not yet complete stay in panel state and
out of the query, and each completed change applies immediately. The Filters button, compact options
button, and chips share one applied-rule count.

Relationship values load through `relationshipFilterChoicesRecipe`: the editor pages by name search,
and chips resolve names by the rule's entity IDs. Until names resolve, or for entities that no
longer exist, a chip shows the count form (for example "Authors: 2 selected") instead of raw IDs.
Count all, the pages, and the filter-aware empty state all use the applied filter; the query Effect
reads `now` from the Effect clock for relative-date rules.

Collection detail builds its fields in `collectionMemberFilterFields`: Type (from the loaded member
groups), Also in collection, and one `membership.<key>` field per supported membership property.
With no search or filter applied the controller shows the known total instead of offering Count all.
