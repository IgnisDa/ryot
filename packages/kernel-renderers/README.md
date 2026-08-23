# Kernel Renderers

The saved-view and collection renderers the kernel ships: `entity-browser`, `results-table`, and
`collection-detail`. They are ordinary
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
`@ryot-app/client-sdk/testing`, which boots a real bridge handshake, so a test asserts on the
messages the renderer actually puts on the port.

The browser owns its own screen chrome inside the iframe: the saved view's name and icon, search,
layout, the Filters dialog (sort lives inside it when configured, otherwise it is empty), the
result and sync count line, and the compact search row, options sheet, and add FAB. Cards come from registered entity presentations; the browser
renders entity art itself only in the table layout, from a `managed-asset` table column.

`entity-browser-controller.tsx` owns the shared browser controls, URL state, refresh replay, chrome,
states, and result layouts. Saved views adapt their configured recipe and optional provider Add flow;
collections adapt the collections recipe, never expose Add, and pass `{ collectionId }` as the entity
presentation context.
