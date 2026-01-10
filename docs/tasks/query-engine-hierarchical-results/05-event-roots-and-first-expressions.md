# Event Roots And First Expressions

**Parent Plan:** [Query Engine Hierarchical Results PRD](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Add event sources as root row sources and implement `first` expressions over ordered sources. Root event sources must declare their attached entity alias and schemas through the `entity` object. Nested event sources continue to attach to an existing entity alias through `entityRef`. `first` should require non-empty orderBy and `select`, be implicitly top-1, return null when no row matches, and replace old latest-event/latest-relationship semantics.

This slice should prove event history rows and latest-event-style scalar projection without relying on old eventJoins.

## Acceptance criteria

- [ ] A root event source can return rows ordered by an event system field such as `occurredAt`.
- [ ] Root event rows can project event system fields, event property fields, attached entity fields, and event schema metadata fields.
- [ ] Root event source attached entity aliases are referenceable and visibility-enforced.
- [ ] `first` over an ordered event source returns the selected scalar from the first matching row.
- [ ] `first` returns null when its source has no visible rows.
- [ ] `first` rejects empty orderBy and invalid alias references.
- [ ] E2E tests cover root event rows and a latest completion timestamp field derived from `first`.

## User stories addressed

Reference by number from the parent PRD:

- User story 11
- User story 12
- User story 14
- User story 19
- User story 30
- User story 32
