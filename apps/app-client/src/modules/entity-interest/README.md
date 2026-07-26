# Entity Interest

The client owns one entity-interest coordinator and one ticket-authenticated WebSocket session per authenticated API scope. The socket carries revisioned interest commands, acknowledgements, heartbeats, and completion hints.

## Coordinator

Consumers register an owner string, an entity-ID set, a `foreground`, `visible`, or `prefetch` priority, and an update callback. IDs use their highest owner priority, then ascending lexical order within each priority. The coordinator selects at most 500 IDs and retains omitted IDs locally so they can enter the selected set later.

Every connection starts with a complete revision-1 `replace` snapshot. Later commands contain only additions and removals. Additions are batched for 100 ms, removals have a two-second grace period, and only one command can await `applied` at a time. Changes made while waiting are coalesced into the next revision. Reconnects discard socket revision state and send a new snapshot.

The provider loads the current metadata language before connecting, acquires a new short-lived ticket for every attempt, authenticates as the first frame, and retries with exponential delays from one to 30 seconds. A metadata-language change invalidates user settings and replaces the connection so the new ticket and session use the current preference. App foreground and network recovery use the shared app revalidation signal. The WebSocket URL contains no ticket or long-lived credentials.

Incoming `entity-updated` messages are routed only to owners currently registered for that entity. The coordinator is not an entity cache.

Translation is demand-driven for each exact entity ID. Consumers must register every loaded entity whose localized fields they display, not only the root entity that led to it.

## Consumer Batching

`useEntityUpdates` uses a single-flight batcher with a 250 ms window and a maximum of 25 entities. It keeps the latest message per entity, starts a full batch as soon as the limit is reached, and keeps later updates pending while one batch is in flight. A failed batch is reported once and is not retried by the batcher. Disposal aborts the active request and clears pending work.

Consumers can block the batcher while their data is not ready for update processing. Updates accumulate without starting timers or requests and flush when unblocked. The callback is an update signal, not authoritative entity data.

## Saved Views

Saved views register loaded page IDs with `visible` priority under an owner scoped by server, user, and view. They block interest updates during initial, load-more, and structural refresh queries.

Each batched entity update triggers one structural refetch of the loaded page range. Updates received during the refetch coalesce into one trailing refetch. A background refetch failure keeps displayed data and retries after 30 seconds.

## Show Overview

The show overview registers its root entity and loaded people, companies, and recommendations at `visible` priority. Updates for any registered entity refresh the overview.

## Show Episodes

The episodes tab registers the show, the selected season, and every loaded episode at `visible` priority. This requests missing translations for episode names and descriptions, and any completion refreshes the selected-season query.
