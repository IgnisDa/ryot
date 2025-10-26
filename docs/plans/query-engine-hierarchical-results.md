# Query Engine Hierarchical Results

## Problem

The query engine supports single-hop relationship traversal only. All
relationship joins are anchored to the same base entity set and cannot chain.
The response shape is always a flat array of items regardless of how deeply
entities are related to one another.

This causes two concrete gaps.

**Hierarchical results are not expressible.** "Return a course with its modules,
and each module with its lessons" cannot be expressed in a single query. It
requires multiple round-trips and client-side stitching, which breaks the
promise that the query engine is the single path through which users can query
any of their data.

**Cross-schema subquery filters are not expressible.** Filters cannot traverse
a relationship hop to test or aggregate child entities. Questions like "courses
where I have completed more than five lessons" or "courses that have at least
one lesson with `durationMinutes` greater than 60" cannot be answered without
bespoke service-layer code outside the query language.

These gaps are visible with custom entity schemas supported by `apps/app-backend/`
today. The examples below use `course`, `module`, and `lesson` entity schemas;
`course-module` and `module-lesson` relationship schemas; `moduleNumber`,
`lessonNumber`, and `durationMinutes` properties; and a `complete` event schema
on lessons. The query engine cannot return that tree or filter courses by lesson
state in one query.

---

## Required Capabilities

The rewritten query engine must support the following.

### 1. Hierarchical includes

The caller must be able to declare that related entities should be fetched and
nested inside each parent result. Nesting must be recursive — includes can
themselves have nested includes.

Example of what must be expressible:

> Return all courses. For each course, include its modules ordered by module
> number. For each module, include its lessons ordered by lesson number. For
> each lesson, include whether I have a `complete` event for it.

The response shape must mirror the query shape: modules are nested under their
course, lessons nested under their module.

### 2. Cross-schema subquery filters

A filter predicate must be able to test a condition that traverses a
relationship and evaluates against child entities. The condition may be
existential ("at least one child matches") or aggregate ("count of matching
children exceeds N").

Example of what must be expressible:

> Return courses where I have completed more than ten lessons.
> Return courses where at least one lesson has `durationMinutes` greater than 90.

### 3. Pagination applies to top-level results only

When includes are present, pagination counts and limits apply to the top-level
entity set, not to the union of all nested rows. Returning 20 courses should
return exactly 20 courses, each with an unbounded (or separately limited) set of
nested modules and lessons.

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

`apps/app-backend/` is a greenfield project for this plan. Breaking changes to
the query language, API contracts, persistence shape, or response format are
acceptable when they produce a better long-term design.

---

## Proof Criteria

The implementation is complete when E2E tests in `tests/` demonstrate all of
the following through the query engine API, with no dedicated service endpoints
filling in the gaps.

| Scenario                                 | Assertion                                                                               |
| ---------------------------------------- | --------------------------------------------------------------------------------------- |
| Fetch a course with nested modules       | Response contains modules nested under the course, ordered by `moduleNumber` ascending  |
| Fetch a course with modules and lessons  | Response contains lessons nested under each module, ordered by `lessonNumber` ascending |
| Lesson completion join inside includes   | Each nested lesson includes whether a `complete` event exists for it                    |
| Filter courses by completed lesson count | Only courses with the specified number of completed lessons are returned                |
| Filter courses by child property         | Only courses with at least one lesson matching a property predicate are returned        |
| Top-level pagination with includes       | Page size applies to courses, not to the total row count across all nested entities     |
| Aggregate query across child entities    | Count of completed lessons per course is computable without a dedicated endpoint        |

---

## Scope

- `apps/app-backend/src/modules/query-engine/` (full rewrite acceptable)
- `apps/app-backend/src/lib/query-language.ts` (DSL schema — may change significantly)
- `apps/app-backend/src/lib/views/` (view validator, expression analysis, reference resolution)
- Any frontend query builder code that constructs query engine requests
- `tests/` (new E2E tests covering the proof criteria above)
