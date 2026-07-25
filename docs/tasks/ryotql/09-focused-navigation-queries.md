# Focused Navigation Queries

**Parent Plan:** [RyotQL](./README.md)

**Status:** completed

## What to build

Deliver the original application-table use case by adding plugin, plugin-state, and saved-view catalog entries and replacing workspace navigation's broad reads with one focused multi-query RyotQL document. Add a shared navigation recipe, result schema where useful, and mapper that returns only fields consumed by workspace navigation.

Plugin metadata is global and joins to the current user's policy-filtered plugin state with a left join. Saved-view rows are user-owned. Collections continue using the entity table. The named queries are independent, validate as one document, execute sequentially in one read-only transaction, and return one data envelope. Respect the exact public field allowlists and hidden sensitive plugin fields from the parent PRD.

## Acceptance criteria

- [x] Plugin, plugin-state, and saved-view catalog entries expose exactly the approved initial fields and visibility policies
- [x] Plugin source hashes, compiled hashes, plugin-state configuration, and omitted ownership columns cannot be selected or filtered
- [x] A policy-filtered plugin-state left join preserves plugins that have no state row and does not leak another user's state
- [x] The shared navigation recipe contains independent focused workspaces, saved views, and collections named queries
- [x] The RyotQL service executes all navigation queries sequentially in one read-only transaction and returns the agreed data envelope
- [x] Workspace navigation uses one RyotQL request and no longer consumes the broad plugin and saved-view list payloads
- [x] Navigation result mapping preserves visible workspaces, ordering, disabled state, saved views, collections, loading behavior, and error behavior
- [x] Contract, catalog, recipe, backend, client, and navigation tests cover missing state rows, empty sections, disabled values, ordering, and user isolation
- [x] Superseded read endpoint consumers are removed, while explicit plugin-state and saved-view commands remain unchanged
- [x] Existing RyotQL slices and the complete legacy query-engine suite remain green
- [x] The RyotQL guide documents application-table queries and named-query execution

## User stories addressed

- User story 1
- User story 15
- User story 16
- User story 17
- User story 28
- User story 44
