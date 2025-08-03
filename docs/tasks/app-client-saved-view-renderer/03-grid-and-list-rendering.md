# Grid And List Rendering

**Parent Plan:** [App Client Saved View Renderer](./README.md)

**Type:** AFK

**Status:** done

## What to build

Replace the app-client saved-view placeholder route with the first working saved-view renderer for grid and list layouts. This slice should fetch saved-view metadata by slug, enable query-engine execution through React Query only for supported entity saved views, persist layout choice per view, render the header and layout switcher, and display real grid/list results using the saved-view display configuration.

Grid and list rendering should follow app-client's warm native visual language. Visible values come from display configuration slots only. The configured `entityIdProperty` is used for row/card navigation and is not rendered. Required titles that resolve null render as `Untitled`. Optional null slots are hidden. Image fields use the existing app-client image normalization and URL resolution flow. Disabled views still render when opened directly. Unsupported future saved-view modes show a clear unsupported state.

Use React Query for saved-view metadata and query-engine execution. Use infinite-query load-more behavior and virtualized rendering where practical. Do not add new dependencies.

## Acceptance criteria

- [x] The saved-view route no longer renders placeholder skeleton cards for supported entity saved views
- [x] The route fetches saved-view detail by slug through the shared API client and React Query
- [x] Query-engine execution uses React Query and the runtime request builder from the previous slice
- [x] Layout switching supports grid and list and persists per saved view
- [x] Switching layouts resets accumulated query-engine pages to page 1
- [x] Grid cards render configured eyebrow, image, title, subtitle, and callout slots where present
- [x] List rows render configured eyebrow, image, title, subtitle, and callout slots where present
- [x] Grid cards and list rows navigate to entity detail using the configured entity ID field
- [x] Null configured titles render as `Untitled`
- [x] Optional null grid/list slots are hidden
- [x] Image URL resolution works for grid/list image slots
- [x] Load-more behavior fetches additional query-engine pages
- [x] Loading, empty, error with retry, disabled-direct-render, and unsupported-mode states are handled
- [x] Result rendering uses virtualized primitives where practical and does not add new dependencies

## User stories addressed

Reference by number from the parent PRD:

- User story 1
- User story 2
- User story 3
- User story 8
- User story 9
- User story 12
- User story 13
- User story 14
- User story 15
- User story 16
- User story 17
- User story 18
- User story 20
- User story 22
- User story 23
- User story 24
- User story 25
- User story 32
- User story 35
