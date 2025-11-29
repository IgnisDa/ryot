# Event Roots And First Expressions

**Parent Plan:** [Query Engine Hierarchical Results PRD](./README.md)

**Type:** AFK

**Status:** done

## What to build

Add event sources as root row sources and implement `first` expressions over ordered sources. Root event sources must declare their attached entity alias and schemas through the `entity` object. Nested event sources continue to attach to an existing entity alias through `entityRef`. `first` should require non-empty orderBy and `select`, be implicitly top-1, return null when no row matches, and replace old latest-event/latest-relationship semantics.

This slice should prove event history rows and latest-event-style scalar projection without relying on old eventJoins.

## Acceptance criteria

- [x] A root event source can return rows ordered by an event system field such as `occurredAt`.
- [x] Root event rows can project event system fields, event property fields, attached entity fields, and event schema metadata fields.
- [x] Root event source attached entity aliases are referenceable and visibility-enforced.
- [x] `first` over an ordered event source returns the selected scalar from the first matching row.
- [x] `first` returns null when its source has no visible rows.
- [x] `first` rejects empty orderBy and invalid alias references.
- [x] E2E tests cover root event rows and a latest completion timestamp field derived from `first`.

## User stories addressed

Reference by number from the parent PRD:

- User story 11
- User story 12
- User story 14
- User story 19
- User story 30
- User story 32

## Follow-up (post-review)

A review found the initial `first` implementation was far narrower than the PRD model
(event sources only, output fields only). `first` is now a fully general catalog
expression:

- It operates over the same `Source` types `exists`/`aggregate` accept: entity sources
  (traversed through `via`) and nested event sources (attached through `entityRef`),
  sharing source parsing, alias/scope validation, schema validation, visibility
  enforcement, and expression-source depth limits.
- It is usable in any expression position — output fields, `where` clauses, and inside
  `aggregate`/`comparison`/`coalesce`/`arithmetic` — because it is evaluated centrally in
  `executor/expr.ts` (`evalExprValue`) rather than intercepted in the serializers.
- Both source kinds keep top-1 SQL semantics (`ORDER BY ... LIMIT 1` with full
  visibility); `orderBy`/`select` stay `ref`-only (`select` also allows `literal`) so they
  remain SQL-expressible, and refs may target the first source's own alias, its edge alias
  (`via.alias`) for entity sources, and its anchor (`via.entityRef` / `entityRef`).

Out of scope: "latest-relationship" via a relationship source. There is no
nested-relationship source type to point `first` at, so `first` stays limited to entity
and nested-event sources. The first source still cannot carry a `where`: the top-1 query
applies its filter directly in SQL and the engine has no SQL translation for arbitrary
`where` expressions, so allowing one would split validation from execution. CountWhere-style
filtering remains available through `exists`/`aggregate`, whose `where` runs in TypeScript
over scanned rows.
