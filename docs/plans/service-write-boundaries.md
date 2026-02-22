# Service Write Boundaries

## Decision

Each owning service will expose at most one write entry point for each supported CRUD verb:

- `create`
- `update`
- `delete`

Read methods and orchestration methods may have other names, but they must not become alternate
write points for the owned table. Repository helpers may remain implementation details behind the
service boundary.

This plan will be extended one service at a time. No decisions are recorded here for other
services yet.

## Entities Service

### Current state

`EntitiesService` exposes both `save` and `create`. `create` handles request-specific normalization,
validation, and provenance deduplication before delegating to `save`. `save` is also used by internal
workflows and currently contains conflict behavior that can replace an existing global entity.

### Decision

- `create` will be the single entity creation entry point for API and internal callers.
- `create` may be idempotent when a matching entity already exists, but it must not modify that
  existing entity.
- `update` will be the single entry point for changes to an existing entity, including the current
  global-entity `replaceExisting` behavior.
- `save` will not remain a public service write method.
- Entity deletion is not being added by this plan. If supported later, it will use the service's
  single `delete` entry point.
- The unified `create` and `update` inputs must remain typed and must cover both API and internal
  entity creation/update use cases without exposing a second service-level writer.

## Follow-up

Implement and verify this decision for `EntitiesService`, then add the next service's decision to
this document before changing it.
