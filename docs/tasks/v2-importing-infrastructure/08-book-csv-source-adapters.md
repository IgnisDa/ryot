# Book CSV Source Adapters

**Parent Plan:** [V2 Importing Infrastructure](./README.md)

**Type:** AFK

**Status:** done

## What to build

Port the book-oriented CSV source adapters `goodreads`, `storygraph`, and `hardcover` onto the V2 import pipeline. These adapters should reuse the provider-backed media import processor from the tracer slice and should not introduce new persistence paths.

The adapters should emit explicit media entity references with the best provider/script available for each source record, lifecycle/review events, and custom collection memberships. Source-specific lookup services may be used as needed, but source parsing and item failures must remain adapter-owned while persistence is orchestrated by the import processor through the owning module services.

## Acceptance criteria

- [x] `goodreads`, `storygraph`, and `hardcover` source input schemas are available through `POST /imports/runs`.
- [x] Each adapter reads files through import file helpers and never directly trusts raw request paths.
- [x] Each adapter returns normalized provider-backed book/media groups and item failures without DB writes.
- [x] Read/completed/current/want-to-read statuses map to V2 lifecycle events according to the parent PRD, not lifecycle-named collections.
- [x] Reviews map to `review` events with historical `occurredAt` where source dates exist.
- [x] Non-lifecycle shelves/lists map to collection memberships.
- [x] Provider lookup failures become item-level failures where possible, not catastrophic run failures unless the source cannot continue.
- [x] Run counters, failures, provider population, event writes, trigger enqueueing, and cleanup all reuse existing import infrastructure.
- [x] Source adapter tests cover representative successful rows, row-level failures, date parsing, lifecycle mapping, review mapping, and collection mapping.

## User stories addressed

Reference by number from the parent PRD:

- User story 1
- User story 4
- User story 5
- User story 7
- User story 11
- User story 12
- User story 13
- User story 14
- User story 22
- User story 23
