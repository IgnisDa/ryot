# Event History Migration

**Parent Plan:** [RyotQL](./README.md)

**Status:** completed

## What to build

Add events to the relational catalog and migrate application event-history reads. Event queries must use normal table references and an explicit event-to-entity join when attached entity data or entity discriminator filtering is needed. There is no event source variant, attached-entity declaration, event schema list, or event-specific executor.

Expose only the event fields approved in the parent PRD. Reuse generic rows, predicates, JSON paths, casts, ordering, pagination, field kinds, and user visibility. Event and joined entity visibility must be applied independently before the join. Replace the shared event-history recipe and its application consumer with RyotQL while leaving unrelated legacy consumers untouched.

## Acceptance criteria

- [x] The event catalog entry exposes the approved fields and user visibility policy through the generic catalog interface
- [x] Event-to-entity reads use an ordinary join and normal discriminator predicates
- [x] Event fields and JSON properties can be selected, filtered, ordered, and paginated through the existing generic compiler
- [x] Event and attached entity row policies are applied before the join and cannot be broadened by caller predicates
- [x] Nullable event fields reconstruct with the correct null kind and date fields reconstruct with the date kind
- [x] The shared event-history recipe and production consumer execute through RyotQL
- [x] End-to-end tests cover event roots, attached entity values, event property filtering, numeric ordering, multiple discriminator filters, and pagination
- [x] User isolation tests show that joins do not expose another user's events or entities
- [x] Legacy event-independent consumers and the legacy query-engine suite remain green
- [x] The RyotQL guide documents event querying as ordinary relational access

## User stories addressed

- User story 3
- User story 8
- User story 18
- User story 19
- User story 20
- User story 21
- User story 22
- User story 23
