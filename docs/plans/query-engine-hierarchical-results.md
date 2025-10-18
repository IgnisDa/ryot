# Query Engine Hierarchical Results

## Problem

The query engine supports single-hop relationship traversal only. All
relationship joins are anchored to the same base entity set and cannot chain.
The response shape is always a flat array of items regardless of how deeply
entities are related to one another.

This causes two concrete gaps.

**Hierarchical results are not expressible.** "Return a show with its seasons,
and each season with its episodes" cannot be expressed in a single query. It
requires multiple round-trips and client-side stitching, which breaks the
promise that the query engine is the single path through which users can query
any of their data.

**Cross-schema subquery filters are not expressible.** Filters cannot traverse
a relationship hop to test or aggregate child entities. Questions like "shows
where I have watched more than five episodes" or "shows that have at least one
episode with a runtime over 60 minutes" cannot be answered without bespoke
service-layer code outside the query language.

These gaps became visible after the episodic sub-entity model rewrite
(`episodic-sub-entity-model.md`) promoted show seasons, show episodes, and
podcast episodes to first-class entities. Show detail pages and season/episode
library views now depend on hierarchical query support to function at all
through the query engine.

---

## Required Capabilities

The rewritten query engine must support the following.

### 1. Hierarchical includes

The caller must be able to declare that related entities should be fetched and
nested inside each parent result. Nesting must be recursive — includes can
themselves have nested includes.

Example of what must be expressible:

> Return all shows in my library. For each show, include its seasons ordered by
> season number. For each season, include its episodes ordered by episode
> number. For each episode, include whether I have a progress event for it.

The response shape must mirror the query shape: seasons are nested under their
show, episodes nested under their season.

### 2. Cross-schema subquery filters

A filter predicate must be able to test a condition that traverses a
relationship and evaluates against child entities. The condition may be
existential ("at least one child matches") or aggregate ("count of matching
children exceeds N").

Example of what must be expressible:

> Return shows where I have watched more than ten episodes.
> Return shows where at least one episode has a runtime over 90 minutes.

### 3. Pagination applies to top-level results only

When includes are present, pagination counts and limits apply to the top-level
entity set, not to the union of all nested rows. Returning 20 shows should
return exactly 20 shows, each with an unbounded (or separately limited) set of
nested seasons and episodes.

---

## DSL

The exact DSL — including whether to extend the current JSON-based query
language, replace it entirely, or redesign it from scratch — is left to the
implementing agent.

The implementing agent should treat the DSL as a design decision and produce a
proposal before writing code. Any proposal must satisfy these constraints:

- Query definitions must remain serializable to JSON so they can be stored in
  the database as JSONB (saved views, tracker configurations).
- The DSL must be constructible programmatically by a frontend query builder
  without string templating.
- User data isolation must be enforced by the engine, not by the caller. A
  caller must not be able to access another user's data by crafting a valid
  query.
- The DSL must remain validatable at parse time using Effect Schema or an
  equivalent typed validator.

A complete rewrite of the engine internals, the CTE chain, the SQL builder, and
the response serialization is acceptable if the DSL design requires it.

---

## Proof Criteria

The implementation is complete when E2E tests in `tests/` demonstrate all of
the following through the query engine API, with no dedicated service endpoints
filling in the gaps.

| Scenario                               | Assertion                                                                                 |
| -------------------------------------- | ----------------------------------------------------------------------------------------- |
| Fetch a show with nested seasons       | Response contains seasons nested under the show, ordered by `seasonNumber` ascending      |
| Fetch a show with seasons and episodes | Response contains episodes nested under each season, ordered by `episodeNumber` ascending |
| Episode progress join inside includes  | Each nested episode includes whether a `progress` event exists for it                     |
| Filter shows by watched episode count  | Only shows with the specified number of watched episodes are returned                     |
| Filter shows by child property         | Only shows with at least one episode matching a property predicate are returned           |
| Top-level pagination with includes     | Page size applies to shows, not to the total row count across all nested entities         |
| Aggregate query across child entities  | Count of watched episodes per show is computable without a dedicated endpoint             |

---

## Scope

- `apps/app-backend/src/modules/query-engine/` (full rewrite acceptable)
- `apps/app-backend/src/lib/query-language.ts` (DSL schema — may change significantly)
- `apps/app-backend/src/lib/views/` (view validator, expression analysis, reference resolution)
- Any frontend query builder code that constructs query engine requests
- `tests/` (new E2E tests covering the proof criteria above)

## Out of Scope

- Anime episode and manga chapter sub-entities. These remain flat numbers in
  event properties and do not require hierarchical queries.
- The episodic sub-entity model rewrite itself (separate plan).
