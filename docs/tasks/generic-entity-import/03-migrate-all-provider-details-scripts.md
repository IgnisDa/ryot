# Migrate All Provider Details Scripts

**Parent Plan:** [Generic Entity Import](./README.md)

**Type:** AFK

**Status:** done

## What to build

Migrate every provider details script that currently emits linked related data through `people`, `companies`, or `groups` so it emits the generic top-level `relatedEntities` contract instead. Scripts that do not currently emit linked related entities should continue returning primary `name` and `properties` only.

The migration must preserve current semantics while removing backend-specific related entity buckets from primary entity properties. Linked people and companies become related entity references with relationship properties containing roles and any existing edge-specific fields such as character or order. Group references become related entity references with member-style relationship properties. `unlinkedCreators` remains a normal primary entity property where the entity schema supports it and must not be treated as an entity reference.

Related entity references must not include partial related entity properties. Every related entity reference must include a name, even if the best available value is a placeholder such as `Loading...`. Because the backend overwrites relationship properties rather than merging them, scripts must aggregate duplicate references before returning them when multiple roles or edge metadata need to be preserved.

## Acceptance criteria

- [x] All details scripts that previously emitted `people` now emit those linked references through `relatedEntities`.
- [x] All details scripts that previously emitted `companies` now emit those linked references through `relatedEntities`.
- [x] All details scripts that previously emitted `groups` now emit those linked references through `relatedEntities`.
- [x] Primary entity `properties` no longer contains linked `people`, `companies`, or `groups` collections after script migration.
- [x] `unlinkedCreators` remains a normal primary entity property and is not moved into `relatedEntities`.
- [x] Person and company role values are represented inside `relationshipProperties`, not as related entity identity.
- [x] Existing character and order fields are represented inside `relationshipProperties` when available.
- [x] Group references use relationship properties compatible with the derived group-to-media relationship schema.
- [x] No related entity reference includes partial related entity properties.
- [x] Every related entity reference includes a non-empty name, using a placeholder only when necessary.
- [x] Scripts aggregate duplicate references where needed so overwrite-only backend writes do not lose intended roles or edge metadata.

## User stories addressed

Reference by number from the parent PRD:

- User story 2
- User story 4
- User story 5
- User story 6
- User story 7
- User story 8
- User story 9
- User story 10
- User story 18
- User story 19
- User story 23
- User story 24
- User story 25
- User story 26
- User story 27
