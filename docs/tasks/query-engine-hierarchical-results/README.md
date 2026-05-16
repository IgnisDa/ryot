# Query Engine Hierarchical Results PRD

## Problem Statement

Ryot's query engine currently answers flat questions well, but it cannot express hierarchical data retrieval or filters that traverse multiple relationship hops.

Users can model rich custom data today with entity schemas, event schemas, and relationship schemas. For example, a user can model courses, modules, lessons, course-to-module relationships, module-to-lesson relationships, lesson completion events, and lesson duration properties. The existing query engine cannot return a course with nested modules and lessons in one query. It also cannot filter courses by facts about descendant lessons, such as completed lesson count or lesson duration, without bespoke service-layer code or client-side stitching.

This breaks the promise that the query engine is the single path for querying user data. It also pushes relationship traversal, aggregation, and tree assembly into callers, which creates repeated logic and inconsistent visibility enforcement.

The existing query engine module, query language, compiler, response shape, saved-view query definition, and tests were built for the old requirements. They are useful context, but they are not the source of truth for the new model. The new DSL and implementation should be derived from the requirements in this PRD.

## Solution

Build a new source-based query engine DSL and implementation that can represent entities, events, and relationships as query sources; project row fields; include nested child sources; filter by descendant existence or aggregates; return grouped aggregates; and return time series over any source with a date expression.

The new query engine will be built side-by-side with the existing query engine. It will have its own query language schema, execution module, API contract, and E2E tests. Once it satisfies the proof criteria and consumers have been cut over, the old query engine and obsolete supporting code/tests will be deleted. The new module and tests will then be renamed to the canonical query-engine names.

The new DSL must remain JSON-serializable, constructible by a frontend query builder without string templating, parse-time validatable with Effect Schema and semantic validation, and safe by default. User isolation is enforced by the engine for every source and traversal. Visibility includes user-owned rows and allowed global rows.

**IMPORTANT**: At any point, when implementing tasks from this PRD, if a blocker in encountered (conflicting requirements, unresolvable technical challenges, etc.), the issue must be raised immediately to the user.

## User Stories

1. As a tracker user, I want to fetch courses with nested modules, so that I can render a course outline without multiple API requests.
2. As a tracker user, I want to fetch courses with nested modules and lessons, so that I can render a full course tree from one query.
3. As a tracker user, I want nested modules ordered by module number, so that course content appears in the intended order.
4. As a tracker user, I want nested lessons ordered by lesson number, so that lesson lists are stable and meaningful.
5. As a tracker user, I want each nested lesson to include whether I completed it, so that progress state can be displayed next to each lesson.
6. As a tracker user, I want to filter courses by completed lesson count, so that I can find courses where I have made significant progress.
7. As a tracker user, I want to filter courses by child lesson properties, so that I can find courses containing long lessons or lessons with specific metadata.
8. As a tracker user, I want top-level pagination to apply only to courses, so that a page of 20 courses is not reduced by nested module or lesson rows.
9. As a tracker user, I want included child rows to have explicit limits and truncation metadata, so that large trees do not silently overload clients.
10. As a tracker user, I want nested child data to preserve field value kinds, so that UI rendering can treat root and included rows consistently.
11. As a tracker user, I want to query root events as rows, so that event history views can be represented by the same query language.
12. As a tracker user, I want to include event sources under entities, so that I can inspect event details when needed.
13. As a tracker user, I want a boolean existence operator over event sources, so that I can ask whether a lesson has a completion event.
14. As a tracker user, I want a first-row operator over ordered event sources, so that latest event joins can be represented without a special join primitive.
15. As a tracker user, I want relationship edges to have aliases and fields, so that relationship properties like position, role, or created date can be used in filters, sorting, and output.
16. As a tracker user, I want to query relationships directly, so that relationship-centric reports and time series are possible.
17. As a tracker user, I want source aliases to be explicit and globally unique, so that persisted query JSON is easy to validate and debug.
18. As a tracker user, I want property references to be schema-qualified, so that multi-schema queries are unambiguous.
19. As a tracker user, I want system fields, property fields, and schema metadata fields to be distinct reference types, so that field semantics are explicit.
20. As a tracker user, I want grouped aggregates to return rows, so that reports can group by one or more expressions and return multiple measures cleanly.
21. As a tracker user, I want ungrouped aggregates to use the same row-shaped response as grouped aggregates, so that aggregate responses are predictable.
22. As a tracker user, I want time series over events, so that I can chart event activity over time.
23. As a tracker user, I want time series over entities, so that I can chart entity creation or date-property activity over time.
24. As a tracker user, I want time series over relationships, so that I can chart relationship activity such as library additions over time.
25. As a tracker user, I want time series buckets to include start and end timestamps, so that chart clients can display bucket boundaries correctly.
26. As a saved-view user, I want saved views to persist the full query document, so that any supported return type can be saved without losing query semantics.
27. As a frontend query-builder author, I want the DSL to be structured JSON, so that queries can be assembled programmatically without string parsing or string templating.
28. As a backend maintainer, I want a new module built alongside the old query engine, so that the rewrite can be verified independently before cutover.
29. As a backend maintainer, I want the old query engine removed after cutover, so that Ryot does not permanently maintain two query engines.
30. As a backend maintainer, I want implementation tests to validate external behavior through the API, so that tests prove the query engine works without locking in SQL internals.
31. As a backend maintainer, I want validation errors for invalid aliases, schemas, fields, and source references, so that invalid queries fail before unsafe execution.
32. As a backend maintainer, I want every source to enforce authenticated visibility, so that crafted query JSON cannot access another user's data.
33. As a backend maintainer, I want exact fanout limits documented, so that implementation and tests have shared expectations for query safety.
34. As a backend maintainer, I want the old compiler's decisions treated as historical context only, so that v2 can use a cleaner long-term model.

## Implementation Decisions

### Core Terminology

The PRD uses the following terms consistently.

DSL means the JSON query language accepted by the query engine.

Query engine means the backend component that parses a query document, validates it, enforces visibility, executes it, and serializes the response.

Query document means one complete JSON query. Every v2 query document must include `version: 2`.

Source means a DSL node that produces a row set. This replaces the term collection in the query language because Ryot already has a user-facing collection concept.

Row set means the runtime rows produced by a source. This is a prose term, not a DSL field.

Root source means the top-level source in a query document.

Included source means a nested source returned inside each parent row.

Alias means a caller-chosen name for a source or relationship edge. All aliases are globally unique across the full query document. Alias shadowing is not allowed.

Entity means a data record such as a course, module, lesson, book, movie, person, or Ryot collection entity.

Entity schema means the type/shape definition for entities, such as course, module, lesson, book, movie, or collection.

Event means a timestamped record attached to an entity, such as a completion, review, watch, or measurement event.

Event schema means the type/shape definition for events, such as complete or review.

Relationship means an edge between two entities, with a source entity, target entity, relationship schema, and optional relationship properties.

Relationship schema means the type/shape definition for relationship rows, such as course-module, module-lesson, member-of, or in-library.

Relationship edge means one concrete relationship row. Relationship edges can have aliases and can be referenced like sources for system fields and properties.

Direction defines how an entity alias participates in a relationship traversal. Outgoing means the named parent alias is the relationship source and the related entity is the target. Incoming means the named parent alias is the relationship target and the related entity is the source. Sort order does not use this term; orderBy entries use `order` with `asc` or `desc`.

Parent means the row from which an included source or traversal starts.

Child means the row reached by a nested source or traversal.

Traversal means moving from one source to another through a relationship edge.

Step or hop means one movement across one relationship schema.

Include means a nested child source returned inside each parent row.

Hierarchical result means a response shape where rows contain nested child source results, such as course to modules to lessons.

Projection means the set of fields returned for each row.

Field means one named output value.

Computed output field means any output field whose value is produced by an expression. Computed output fields are allowed throughout v2.

Computed field means the old-engine concept of a named reusable expression declared once and referenced elsewhere in a query. This reusable-expression feature is not part of v2 initially.

Expression means a value-producing AST node, such as a literal, reference, comparison, arithmetic expression, null check, coalesce expression, existence check, aggregate, measure reference, or first-row selection.

Reference means an expression that reads a value from a source alias through an explicit field selector.

Field selector means the structured reference target for a ref expression. Field selectors distinguish system fields, schema metadata fields, and schema-qualified property fields.

Boolean condition means a boolean expression. V2 should not keep a separate predicate/filter AST; `where` accepts boolean expressions.

Where means a source-level boolean expression that filters rows produced by that source.

Order by means deterministic ordering rules for row-producing consumers. Each orderBy entry uses `order` with `asc` or `desc`.

Pagination means page and limit over top-level rows only.

Limit means the maximum rows returned by an included source or grouped aggregate.

Limited result page info means the shared response metadata for limited non-root row sets. It contains `limit` and `hasMore`, and is used by included sources and grouped aggregate responses.

Return type means the response shape requested by the query. V2 return types are rows, aggregate, and time series.

Rows return means individual root rows, optionally with included sources.

Aggregate return means computed values over a source, optionally grouped by expressions.

Measure has three structurally distinct uses in v2. Aggregate-return `measures[]` entries are named outputs with `key` and `aggregation`. Time-series `measure` is a singular unnamed output with `aggregation`. A measure reference expression uses `type: "measureRef"` and `key` to sort grouped aggregate rows by one aggregate-return measure.

Aggregation spec means the shared DSL object for count, sum, average, minimum, and maximum. Aggregate expressions, aggregate-return measures, and time-series measures all reuse this same sub-schema and validation rules.

Group by means splitting aggregate output into groups by expression values.

Time series means one numeric measure grouped into time buckets over any source with a date expression.

Bucket means a time interval such as hour, day, week, or month.

Date range means the half-open time window used for time-series row inclusion: `startAt` is inclusive and `endAt` is exclusive.

Zero fill means returning buckets with value zero even when no rows exist in the bucket.

Exists means a boolean expression that returns true when a source has at least one row and false otherwise.

Aggregate expression means a scalar expression computed over a source. Count returns zero for no rows; sum, average, minimum, and maximum return null for no rows.

First means an expression that returns a selected scalar from the first row of an ordered source. It returns null when the source has no rows.

Latest means a convention implemented with first over an ordered source, not a special DSL primitive.

Cardinality means how many rows a source or operator can produce.

Distinct by means deduplicating based on a specific expression, usually an entity ID. In v2 it is represented by `distinctBy` on count aggregation specs.

Visibility means whether a row is accessible to the authenticated user. Visibility includes user-owned rows and allowed global rows.

User isolation means the engine must enforce visibility and must not trust callers to add visibility filters.

Saved view means a persisted full query document plus any UI display configuration outside the engine's core semantics.

JSONB means PostgreSQL JSON storage. The DSL must remain JSON-serializable so it can be persisted.

Parse-time validation means structural and semantic validation before query execution.

Current event join means the old engine concept that attaches one latest event row to each current row. V2 replaces this with first over an ordered event source.

Current relationship join means the old engine concept that attaches one latest relationship row to each current row. V2 replaces this with first or included sources, depending on desired cardinality.

### Query Document Model

Every v2 query document has `version: 2`, a root `source`, and an `output` definition.

The top-level key is `source`, not `from`.

The term collection must not be used in the DSL because Ryot already has collections as user-facing data.

Every source has a required `type`, required `alias`, non-empty unique `schemas`, and optional/null `where`.

The meaning of `schemas` depends on source type. For entity sources it means entity schema slugs. For event sources it means event schema slugs. For relationship sources it means relationship schema slugs.

The plural `schemas` is used only where a source can produce rows from multiple schemas. The singular `schema` is used where exactly one schema is required, such as a relationship traversal edge or a schema-qualified property selector.

Source aliases and relationship edge aliases must be globally unique across the entire query document, including sources inside includes, exists expressions, aggregate expressions, and first expressions.

References may only point at aliases in lexical scope. A nested source can reference its own alias, its relationship edge alias, ancestor aliases, explicitly declared relationship endpoint aliases, and explicitly declared event attached-entity aliases. A source cannot reference sibling include aliases.

Source-level `where` may reference ancestor aliases. This allows correlated child filters.

Ordering and limits are consumer-level concerns, not source-level concerns. Filtering belongs on sources. Root row returns, included sources, and grouped aggregate returns define their own ordering/limit requirements. First expressions define `orderBy` and `select`; they are implicitly top-1 and do not take a limit.

### Source Types

Entity sources represent entity rows. Root entity sources cannot use relationship traversal. Nested entity sources can traverse from an existing entity alias using a `via` relationship edge definition.

Nested entity sources use the same source type as root entity sources and add `via`. There is no separate relatedEntities source type.

The `via` object for a nested entity source uses singular `schema`, because one traversal edge uses one relationship schema. It also requires an edge `alias`, an `entityRef` naming the existing entity alias used as the traversal anchor, and a `direction` of outgoing or incoming.

Relationship root sources represent relationship rows directly. They must explicitly declare both endpoint entity aliases and their endpoint entity schemas. Relationship root sources may include multiple relationship schema slugs in `schemas`.

Event root sources represent event rows directly. They must explicitly declare their attached entity alias and entity schemas. Event root sources may include multiple event schema slugs in `schemas`.

Nested event sources attach to an existing entity alias through `entityRef`. This is the recommended model for event sources inside lesson rows or expressions.

### Field Selector Model

References use a structured field selector rather than raw property paths. The `sourceAlias` field on a reference names any visible row alias, including source aliases, relationship edge aliases, relationship endpoint entity aliases, and event attached-entity aliases.

System field selectors read built-in fields from the referenced source alias. System fields are source-type specific. Entity system fields include ID, name, image, created/updated timestamps, external ID, and sandbox script ID. Event system fields include ID, occurred timestamp, created timestamp, and updated timestamp. Relationship system fields include ID, source entity ID, target entity ID, and created timestamp.

Property field selectors read schema-defined properties and always require a `schema` qualifier plus a property `path`. For entity sources, the schema is an entity schema slug. For event sources, the schema is an event schema slug. For relationship sources or relationship edge aliases, the schema is a relationship schema slug. If a schema-qualified property is evaluated against a row of another schema, it resolves to null. If the schema is not part of the source, validation fails.

Schema metadata field selectors read metadata about the row's schema, such as schema slug or schema name.

Invalid system fields for a source type fail semantic validation.

### Return Types

Rows return produces root rows with fields and optional included sources. Root rows require pagination, non-empty orderBy, and `fields`. The fields array may be empty. Pagination applies only to root rows. Includes are valid only on rows returns and are invalid on aggregate and time-series returns.

Aggregate return produces row-shaped aggregate output. Ungrouped aggregate returns exactly one item and no pageInfo. Grouped aggregate returns one item per group and includes limited result page info with `limit` and `hasMore`. Grouped aggregate returns require non-empty orderBy and a limit. `hasMore` is true when more groups exist beyond the requested limit. Aggregate responses use `items`, not the legacy `values` shape. GroupBy keys and measure keys share one aggregate output namespace and must be unique among siblings.

Time-series return produces buckets with `startAt`, `endAt`, and numeric `value`. Time series supports one measure in v2. Time series is source-based and can operate over any source with a date expression, including events, entities, and relationships. Zero fill is always on; there is no DSL knob to disable it. Time series is a peer return type in the public DSL, but implementors should lower it through the same grouping and aggregation planning primitives as grouped aggregate returns, then apply bucket alignment and zero fill.

Responses echo the return type rather than the legacy mode name.

Responses should stay lean. They do not include field-order metadata or source/schema metadata. Root row pagination still returns total count metadata because it is part of the root paging contract. Clients already have the query document.

### Included Source Semantics

Included sources are projections, not parent filters. A parent row remains in the response even if an include returns zero child rows.

Filtering parents by children requires an explicit exists expression or aggregate expression in the parent source where clause.

Every included source requires an explicit limit, non-empty orderBy, and `fields`. The fields array may be empty.

Included sources return an object with `items` and limited result page info. `pageInfo` includes `limit` and `hasMore`. Included source responses do not include total counts by default. This is intentionally asymmetric with root row pagination, which includes total count metadata.

Field keys and include keys must be unique among siblings in the same output row. They do not need to be globally unique across nested rows. Aggregate groupBy keys and measure keys must also be unique among siblings in the same aggregate output row.

Included source rows use the same field-value wrapper shape as root rows.

### Expression Semantics

V2 should use one expression AST. Boolean expressions are valid anywhere a boolean is expected, including source where clauses and output fields. The initial expression catalog includes `literal`, `ref`, `measureRef`, `comparison`, `and`, `or`, `not`, `isNull`, `isNotNull`, `contains`, `coalesce`, `arithmetic`, `exists`, `aggregate`, and `first`.

Boolean `and` and `or` operators use `values`, not `predicates`, and require at least one value. `and` returns true only when every value is true. `or` returns true when at least one value is true. Unary operators use `expr`; `not` negates its `expr`, and `isNull`/`isNotNull` test their `expr`. This `values` operand array is unrelated to the legacy aggregate response `values` field, which v2 does not use.

Comparison supports `eq`, `neq`, `gt`, `gte`, `lt`, and `lte`. Comparisons must be type-compatible at validation time. Ordering comparisons are valid only for comparable scalar values.

Comparisons involving null evaluate to false except explicit null checks.

Null checks are `isNull` and `isNotNull` expressions. They return booleans and are the only boolean conditions that treat null as the condition being tested rather than as an unknown comparison operand.

Coalesce takes a non-empty `values` array and returns the first non-null expression value in order. If every value is null, it returns null. Coalesce is used when aggregate functions such as sum may return null for an empty source but the caller wants an explicit fallback.

Measure references use `type: "measureRef"` with a `key`. They are valid only inside aggregate-return `orderBy` expressions and resolve to the named measure in the same aggregate return. They are invalid in row fields, source where clauses, include orderBy clauses, time-series definitions, and aggregate measure definitions.

Exists over a source returns false when the source has zero rows.

First over a source requires non-empty orderBy and returns the selected scalar expression from the first row. First returns null when the source has zero rows. First is how latest-event and latest-relationship patterns should be represented.

Exists, first, and aggregate expressions all consume sources. They must share the same source parsing, alias validation, schema validation, correlation validation, visibility enforcement, and safety-limit handling.

Arithmetic supports `add`, `subtract`, `multiply`, and `divide`. Arithmetic operands must be numeric. Division by zero returns null rather than throwing.

Aggregation specs support count, sum, average, minimum, and maximum initially. Count counts source rows by default and must not specify `expr`. Count may specify `distinctBy`, which is an expression whose non-null values are deduplicated before counting. Sum, average, minimum, and maximum require `expr` and must not specify `distinctBy` in v2. Count over an empty source returns zero. Sum, average, minimum, and maximum over an empty source return null. Aggregate-return measures, time-series measures, and aggregate expressions must all use this shared aggregation spec shape under an `aggregation` key.

Aggregate expressions use `type: "aggregate"`, a `source`, and an `aggregation` spec. They must not duplicate aggregation fields such as `function` or `expr` at the top level of the aggregate expression.

Multi-hop descendant questions should be expressed by nesting source-consuming expressions. Each source traversal still uses one relationship edge; additional hops are introduced by an inner exists, aggregate, or first expression correlated to the current source alias.

CountWhere should not exist in v2 because source-level where covers it.

Contains remains a supported expression/operator. For strings, contains means case-insensitive substring containment. For arrays, contains means the left array contains the right item or every item in the right array. For objects, contains means the left object contains the right object's key/value shape. Other operand combinations fail validation.

Literal expressions support generic JSON literals and typed date literals. Date literals require explicit value type so date values are not confused with ordinary strings.

Computed output fields are normal v2 fields: any field can use any valid expression, including exists, arithmetic, aggregate, first, and coalesce. Reusable computed fields do not exist in v2 initially. Expression aliases can be added later only if repeated expressions become a concrete problem.

### Safety Limits

The engine must enforce these exact limits as invariants.

Maximum root page size is 100.

Maximum include depth is 3. The root is depth 0; includes may nest through depth 3.

Maximum expression source depth is 3. The root is depth 0; source-consuming expressions such as exists, aggregate, and first may nest through depth 3. This depth is counted independently from include depth but uses the same root-depth convention.

Maximum total source aliases per query document is 50, counting root sources, included sources, expression sources, relationship edge aliases, relationship endpoint aliases, and event attached-entity aliases.

Maximum include limit is 100. Every include must specify a limit, and the limit cannot exceed 100.

Maximum total serialized row objects per response is 5000, counting root rows and all included rows.

Maximum grouped aggregate limit is 1000. Grouped aggregate returns must specify a limit, and the limit cannot exceed 1000. A caller-supplied grouped aggregate limit greater than 1000 must fail validation; it must not be silently clamped.

Maximum time-series buckets per response is 1000. If the requested date range and bucket size would produce more than 1000 buckets after alignment, the query must fail validation; it must not silently truncate or clamp the date range.

Maximum expression-source matched rows per parent row is 10000 for aggregate expression sources. If an aggregate expression source would need to consider more than 10000 rows for one parent row, the engine must fail the query rather than return an approximate value. Exists and first should be implemented with short-circuit/top-1 semantics and are not allowed to scan unbounded rows when a bounded execution strategy is available.

If an include reaches its caller-specified limit normally, the response sets `hasMore` to true when more rows exist.

If the total serialized row-object cap is exceeded, the engine must fail the query rather than silently truncating nested data.

### Visibility and Isolation

The engine must enforce visibility for every source and traversal. Visibility includes user-owned rows and allowed global rows.

Visibility enforcement applies to root entities, root events, root relationships, nested entities, nested events, relationship edges, relationship endpoint entities, event attached entities, exists expressions, aggregate expressions, first expressions, and time-series sources.

The caller must not be able to expand visibility by crafting valid query JSON.

### Saved Views

Saved views store the full v2 query document. They are not limited to a normalized subset of query fields.

Saved views may store any v2 return type. UI rendering support for every return type is not part of this PRD.

Display configuration remains a UI concern outside the core query engine semantics.

### Implementation Strategy

Build the new engine side-by-side with the old engine in a temporary v2 module.

Create a separate v2 query-language schema and validation layer.

Expose a temporary v2 execute API alongside the existing query-engine API.

Add new E2E tests for the v2 API and new v2 fixtures/helpers.

Do not update old saved views, frontend runtime, or sandbox integrations during the first implementation phase unless needed for proof criteria.

Once v2 satisfies proof criteria, cut over consumers to the v2 query document shape and v2 execute path.

After cutover, delete the old query engine module, old query-language variants, obsolete view validation paths, obsolete fixtures, and obsolete tests.

Rename the v2 module, schema, API group, fixtures, and tests to canonical query-engine names.

Do not keep both query engines permanently.

Do not make v2 depend on old compiler behavior. Reuse old low-level utilities only when their semantics are obviously identical and do not import old DSL assumptions.

### Modules to Build or Modify

Build a v2 query language module that owns Effect Schema definitions for query documents, sources, field selectors, expressions, returns, response shapes, and validation errors.

Build a v2 semantic validator that resolves aliases, schemas, field selectors, source scopes, relationship directions, source correlation, aggregate rules, time-series rules, and safety limits.

Build a v2 execution planner that turns validated query documents into an internal plan independent of request JSON shape.

Build shared aggregation planning around the aggregation spec. Aggregate-return measures, aggregate expressions, and time-series measures must reuse the same aggregation validation and planning rules.

Build v2 SQL builders for root entity sources, event sources, relationship sources, nested entity includes, nested event sources, exists expressions, first expressions, aggregate expressions, aggregate returns, and time-series returns.

Build a v2 response serializer that emits lean row, aggregate, and time-series responses with typed field values.

Build a v2 service and route layer that mirrors existing route thinness: validate request, call service, return result or typed error.

Modify saved-view validation/persistence during cutover so saved views store full v2 query documents.

Modify consumers during cutover so they call the canonical v2 execute path after the old engine is removed.

Delete obsolete old-engine code only after v2 proof tests pass and consumers are cut over.

### DSL Examples

These examples document the intended shape of the v2 DSL. They are illustrative contracts for the model; implementation may add required metadata only when it preserves these semantics.

Basic entity rows query:

```json
{
  "version": 2,
  "source": {
    "type": "entities",
    "alias": "course",
    "schemas": ["course"],
    "where": null
  },
  "output": {
    "type": "rows",
    "pagination": { "page": 1, "limit": 20 },
    "orderBy": [
      {
        "order": "asc",
        "expr": {
          "type": "ref",
          "sourceAlias": "course",
          "field": { "type": "system", "name": "name" }
        }
      }
    ],
    "fields": [
      {
        "key": "name",
        "expr": {
          "type": "ref",
          "sourceAlias": "course",
          "field": { "type": "system", "name": "name" }
        }
      }
    ]
  }
}
```

Course rows with nested modules and lessons. The example limits are intentionally below the maximum allowed include limit. Worst-case serialized row count is 10 root courses + 10 * 20 modules + 10 * 20 * 20 lessons = 4210 rows, which stays below the global 5000-row response cap. Callers that need larger trees must lower root page size, split the query, or accept `hasMore` on included sources.

```json
{
  "version": 2,
  "source": {
    "type": "entities",
    "alias": "course",
    "schemas": ["course"],
    "where": null
  },
  "output": {
    "type": "rows",
    "pagination": { "page": 1, "limit": 10 },
    "orderBy": [
      {
        "order": "asc",
        "expr": {
          "type": "ref",
          "sourceAlias": "course",
          "field": { "type": "system", "name": "name" }
        }
      }
    ],
    "fields": [
      {
        "key": "name",
        "expr": {
          "type": "ref",
          "sourceAlias": "course",
          "field": { "type": "system", "name": "name" }
        }
      }
    ],
    "include": [
      {
        "key": "modules",
        "limit": 20,
        "source": {
          "type": "entities",
          "alias": "module",
          "schemas": ["module"],
          "where": null,
          "via": {
            "entityRef": "course",
            "alias": "courseModule",
            "direction": "outgoing",
            "schema": "course-module"
          }
        },
        "orderBy": [
          {
            "order": "asc",
            "expr": {
              "type": "ref",
              "sourceAlias": "module",
              "field": {
                "type": "property",
                "schema": "module",
                "path": ["moduleNumber"]
              }
            }
          }
        ],
        "fields": [
          {
            "key": "name",
            "expr": {
              "type": "ref",
              "sourceAlias": "module",
              "field": { "type": "system", "name": "name" }
            }
          }
        ],
        "include": [
          {
            "key": "lessons",
            "limit": 20,
            "source": {
              "type": "entities",
              "alias": "lesson",
              "schemas": ["lesson"],
              "where": null,
              "via": {
                "entityRef": "module",
                "alias": "moduleLesson",
                "direction": "outgoing",
                "schema": "module-lesson"
              }
            },
            "orderBy": [
              {
                "order": "asc",
                "expr": {
                  "type": "ref",
                  "sourceAlias": "lesson",
                  "field": {
                    "type": "property",
                    "schema": "lesson",
                    "path": ["lessonNumber"]
                  }
                }
              }
            ],
            "fields": [
              {
                "key": "name",
                "expr": {
                  "type": "ref",
                  "sourceAlias": "lesson",
                  "field": { "type": "system", "name": "name" }
                }
              },
              {
                "key": "isComplete",
                "expr": {
                  "type": "exists",
                  "source": {
                    "type": "events",
                    "alias": "lessonCompletion",
                    "schemas": ["complete"],
                    "entityRef": "lesson",
                    "where": null
                  }
                }
              }
            ]
          }
        ]
      }
    ]
  }
}
```

Filter parent courses by completed descendant lesson count. This intentionally uses one relationship edge per source traversal: the outer aggregate iterates modules for a course, and the inner aggregate counts completed lessons for each module. No coalesce is needed for filtering because comparisons involving null evaluate to false. This sums per-module counts; if the data model allows the same lesson to appear under multiple modules and the intended question is unique completed lessons, use a count aggregation with `distinctBy` on lesson ID instead.

```json
{
  "version": 2,
  "source": {
    "type": "entities",
    "alias": "course",
    "schemas": ["course"],
    "where": {
      "type": "comparison",
      "operator": "gt",
      "left": {
        "type": "aggregate",
        "source": {
          "type": "entities",
          "alias": "moduleForCompletionCount",
          "schemas": ["module"],
          "where": null,
          "via": {
            "entityRef": "course",
            "alias": "courseModuleForCompletionCount",
            "direction": "outgoing",
            "schema": "course-module"
          }
        },
        "aggregation": {
          "function": "sum",
          "expr": {
            "type": "aggregate",
            "source": {
              "type": "entities",
              "alias": "completedLessonForCount",
              "schemas": ["lesson"],
              "via": {
                "entityRef": "moduleForCompletionCount",
                "alias": "moduleLessonForCompletionCount",
                "direction": "outgoing",
                "schema": "module-lesson"
              },
              "where": {
                "type": "exists",
                "source": {
                  "type": "events",
                  "alias": "completedLessonEventForCount",
                  "schemas": ["complete"],
                  "entityRef": "completedLessonForCount",
                  "where": null
                }
              }
            },
            "aggregation": { "function": "count" }
          }
        }
      },
      "right": { "type": "literal", "value": 10 }
    }
  },
  "output": {
    "type": "rows",
    "pagination": { "page": 1, "limit": 20 },
    "orderBy": [
      {
        "order": "asc",
        "expr": {
          "type": "ref",
          "sourceAlias": "course",
          "field": { "type": "system", "name": "name" }
        }
      }
    ],
    "fields": []
  }
}
```

Computed output field using coalesce to display zero instead of null. This is the intended use of coalesce when an aggregate such as sum can return null for an empty source:

```json
{
  "key": "completedLessonCount",
  "expr": {
    "type": "coalesce",
    "values": [
      {
        "type": "aggregate",
        "source": {
          "type": "entities",
          "alias": "moduleForDisplayedCompletionCount",
          "schemas": ["module"],
          "where": null,
          "via": {
            "entityRef": "course",
            "alias": "courseModuleForDisplayedCompletionCount",
            "direction": "outgoing",
            "schema": "course-module"
          }
        },
        "aggregation": {
          "function": "sum",
          "expr": {
            "type": "aggregate",
            "source": {
              "type": "entities",
              "alias": "displayedCompletedLesson",
              "schemas": ["lesson"],
              "via": {
                "entityRef": "moduleForDisplayedCompletionCount",
                "alias": "moduleLessonForDisplayedCompletionCount",
                "direction": "outgoing",
                "schema": "module-lesson"
              },
              "where": {
                "type": "exists",
                "source": {
                  "type": "events",
                  "alias": "displayedCompletionEvent",
                  "schemas": ["complete"],
                  "entityRef": "displayedCompletedLesson",
                  "where": null
                }
              }
            },
            "aggregation": { "function": "count" }
          }
        }
      },
      { "type": "literal", "value": 0 }
    ]
  }
}
```

Grouped aggregate return:

```json
{
  "version": 2,
  "source": {
    "type": "entities",
    "alias": "lesson",
    "schemas": ["lesson"],
    "where": null
  },
  "output": {
    "type": "aggregate",
    "limit": 100,
    "groupBy": [
      {
        "key": "difficulty",
        "expr": {
          "type": "ref",
          "sourceAlias": "lesson",
          "field": {
            "type": "property",
            "schema": "lesson",
            "path": ["difficulty"]
          }
        }
      }
    ],
    "measures": [
      {
        "key": "count",
        "aggregation": { "function": "count" }
      }
    ],
    "orderBy": [
      {
        "order": "desc",
        "expr": { "type": "measureRef", "key": "count" }
      }
    ]
  }
}
```

Time series over a relationship source:

```json
{
  "version": 2,
  "source": {
    "type": "relationships",
    "alias": "libraryAddition",
    "schemas": ["in-library"],
    "where": null,
    "sourceEntity": {
      "alias": "media",
      "schemas": ["book", "movie"]
    },
    "targetEntity": {
      "alias": "library",
      "schemas": ["library"]
    }
  },
  "output": {
    "type": "timeSeries",
    "time": {
      "bucket": "week",
      "range": {
        "startAt": "2026-01-01T00:00:00.000Z",
        "endAt": "2026-02-01T00:00:00.000Z"
      },
      "expr": {
        "type": "ref",
        "sourceAlias": "libraryAddition",
        "field": { "type": "system", "name": "createdAt" }
      }
    },
    "measure": { "aggregation": { "function": "count" } }
  }
}
```

Rows response with an included source:

```json
{
  "type": "rows",
  "data": {
    "items": [
      {
        "name": { "kind": "text", "value": "Course A" },
        "modules": {
          "items": [
            {
              "name": { "kind": "text", "value": "Module 1" }
            }
          ],
          "pageInfo": { "limit": 20, "hasMore": false }
        }
      }
    ],
    "pageInfo": {
      "page": 1,
      "limit": 20,
      "total": 1,
      "hasMore": false
    }
  }
}
```

Canonical source shapes:

Root entity source:

```json
{
  "type": "entities",
  "alias": "course",
  "schemas": ["course"],
  "where": null
}
```

Nested entity source reached through one relationship edge:

```json
{
  "type": "entities",
  "alias": "module",
  "schemas": ["module"],
  "where": null,
  "via": {
    "entityRef": "course",
    "alias": "courseModule",
    "direction": "outgoing",
    "schema": "course-module"
  }
}
```

Root event source with an explicit attached entity declaration:

```json
{
  "type": "events",
  "alias": "completion",
  "schemas": ["complete"],
  "where": null,
  "entity": {
    "alias": "lesson",
    "schemas": ["lesson"]
  }
}
```

Nested event source attached to an existing entity alias:

```json
{
  "type": "events",
  "alias": "completion",
  "schemas": ["complete"],
  "where": null,
  "entityRef": "lesson"
}
```

Root relationship source with explicit endpoint entity declarations:

```json
{
  "type": "relationships",
  "alias": "membership",
  "schemas": ["member-of"],
  "where": null,
  "sourceEntity": {
    "alias": "member",
    "schemas": ["book", "movie"]
  },
  "targetEntity": {
    "alias": "collectionEntity",
    "schemas": ["collection"]
  }
}
```

Full root event rows query:

```json
{
  "version": 2,
  "source": {
    "type": "events",
    "alias": "completion",
    "schemas": ["complete"],
    "where": null,
    "entity": {
      "alias": "lesson",
      "schemas": ["lesson"]
    }
  },
  "output": {
    "type": "rows",
    "pagination": { "page": 1, "limit": 20 },
    "orderBy": [
      {
        "order": "desc",
        "expr": {
          "type": "ref",
          "sourceAlias": "completion",
          "field": { "type": "system", "name": "occurredAt" }
        }
      }
    ],
    "fields": [
      {
        "key": "occurredAt",
        "expr": {
          "type": "ref",
          "sourceAlias": "completion",
          "field": { "type": "system", "name": "occurredAt" }
        }
      },
      {
        "key": "lessonName",
        "expr": {
          "type": "ref",
          "sourceAlias": "lesson",
          "field": { "type": "system", "name": "name" }
        }
      },
      {
        "key": "completionNotes",
        "expr": {
          "type": "ref",
          "sourceAlias": "completion",
          "field": {
            "type": "property",
            "schema": "complete",
            "path": ["notes"]
          }
        }
      }
    ]
  }
}
```

Field selector examples:

```json
{
  "type": "ref",
  "sourceAlias": "course",
  "field": { "type": "system", "name": "name" }
}
```

```json
{
  "type": "ref",
  "sourceAlias": "course",
  "field": {
    "type": "property",
    "schema": "course",
    "path": ["difficulty"]
  }
}
```

```json
{
  "type": "ref",
  "sourceAlias": "media",
  "field": {
    "type": "property",
    "schema": "book",
    "path": ["author"]
  }
}
```

```json
{
  "type": "ref",
  "sourceAlias": "course",
  "field": { "type": "schema", "name": "slug" }
}
```

```json
{
  "type": "ref",
  "sourceAlias": "completion",
  "field": {
    "type": "property",
    "schema": "complete",
    "path": ["notes"]
  }
}
```

```json
{
  "type": "ref",
  "sourceAlias": "courseModule",
  "field": {
    "type": "property",
    "schema": "course-module",
    "path": ["position"]
  }
}
```

Multi-schema root with explicit property refs:

```json
{
  "version": 2,
  "source": {
    "type": "entities",
    "alias": "media",
    "schemas": ["book", "movie"],
    "where": null
  },
  "output": {
    "type": "rows",
    "pagination": { "page": 1, "limit": 20 },
    "orderBy": [
      {
        "order": "asc",
        "expr": {
          "type": "ref",
          "sourceAlias": "media",
          "field": { "type": "system", "name": "name" }
        }
      }
    ],
    "fields": [
      {
        "key": "title",
        "expr": {
          "type": "ref",
          "sourceAlias": "media",
          "field": { "type": "system", "name": "name" }
        }
      },
      {
        "key": "bookAuthor",
        "expr": {
          "type": "ref",
          "sourceAlias": "media",
          "field": {
            "type": "property",
            "schema": "book",
            "path": ["author"]
          }
        }
      },
      {
        "key": "movieDirector",
        "expr": {
          "type": "ref",
          "sourceAlias": "media",
          "field": {
            "type": "property",
            "schema": "movie",
            "path": ["director"]
          }
        }
      }
    ]
  }
}
```

Filter child lessons by a child property without filtering parent modules:

```json
{
  "key": "longLessons",
  "limit": 100,
  "source": {
    "type": "entities",
    "alias": "longLesson",
    "schemas": ["lesson"],
    "via": {
      "entityRef": "module",
      "alias": "moduleLongLesson",
      "direction": "outgoing",
      "schema": "module-lesson"
    },
    "where": {
      "type": "comparison",
      "operator": "gt",
      "left": {
        "type": "ref",
        "sourceAlias": "longLesson",
        "field": {
          "type": "property",
          "schema": "lesson",
          "path": ["durationMinutes"]
        }
      },
      "right": { "type": "literal", "value": 60 }
    }
  },
  "orderBy": [
    {
      "order": "asc",
      "expr": {
        "type": "ref",
        "sourceAlias": "longLesson",
        "field": {
          "type": "property",
          "schema": "lesson",
          "path": ["lessonNumber"]
        }
      }
    }
  ],
  "fields": []
}
```

Filter parent courses by existence of at least one long descendant lesson:

```json
{
  "type": "exists",
  "source": {
    "type": "entities",
    "alias": "moduleWithLongLesson",
    "schemas": ["module"],
    "via": {
      "entityRef": "course",
      "alias": "courseModuleWithLongLesson",
      "direction": "outgoing",
      "schema": "course-module"
    },
    "where": {
      "type": "exists",
      "source": {
        "type": "entities",
        "alias": "longDescendantLesson",
        "schemas": ["lesson"],
        "via": {
          "entityRef": "moduleWithLongLesson",
          "alias": "moduleLongDescendantLesson",
          "direction": "outgoing",
          "schema": "module-lesson"
        },
        "where": {
          "type": "comparison",
          "operator": "gt",
          "left": {
            "type": "ref",
            "sourceAlias": "longDescendantLesson",
            "field": {
              "type": "property",
              "schema": "lesson",
              "path": ["durationMinutes"]
            }
          },
          "right": { "type": "literal", "value": 90 }
        }
      }
    }
  }
}
```

Include completion events under a lesson:

```json
{
  "key": "completionEvents",
  "limit": 10,
  "source": {
    "type": "events",
    "alias": "lessonCompletionEventRows",
    "schemas": ["complete"],
    "entityRef": "lesson",
    "where": null
  },
  "orderBy": [
    {
      "order": "desc",
      "expr": {
        "type": "ref",
        "sourceAlias": "lessonCompletionEventRows",
        "field": { "type": "system", "name": "occurredAt" }
      }
    }
  ],
  "fields": [
    {
      "key": "occurredAt",
      "expr": {
        "type": "ref",
        "sourceAlias": "lessonCompletionEventRows",
        "field": { "type": "system", "name": "occurredAt" }
      }
    }
  ]
}
```

Latest completion timestamp using first:

```json
{
  "type": "first",
  "source": {
    "type": "events",
    "alias": "latestCompletionEvent",
    "schemas": ["complete"],
    "entityRef": "lesson",
    "where": null
  },
  "orderBy": [
    {
      "order": "desc",
      "expr": {
        "type": "ref",
        "sourceAlias": "latestCompletionEvent",
        "field": { "type": "system", "name": "occurredAt" }
      }
    }
  ],
  "select": {
    "type": "ref",
    "sourceAlias": "latestCompletionEvent",
    "field": { "type": "system", "name": "occurredAt" }
  }
}
```

Relationship root rows query:

```json
{
  "version": 2,
  "source": {
    "type": "relationships",
    "alias": "membership",
    "schemas": ["member-of"],
    "where": null,
    "sourceEntity": {
      "alias": "memberEntity",
      "schemas": ["book", "movie"]
    },
    "targetEntity": {
      "alias": "collectionEntity",
      "schemas": ["collection"]
    }
  },
  "output": {
    "type": "rows",
    "pagination": { "page": 1, "limit": 20 },
    "orderBy": [
      {
        "order": "desc",
        "expr": {
          "type": "ref",
          "sourceAlias": "membership",
          "field": { "type": "system", "name": "createdAt" }
        }
      }
    ],
    "fields": [
      {
        "key": "memberName",
        "expr": {
          "type": "ref",
          "sourceAlias": "memberEntity",
          "field": { "type": "system", "name": "name" }
        }
      },
      {
        "key": "collectionName",
        "expr": {
          "type": "ref",
          "sourceAlias": "collectionEntity",
          "field": { "type": "system", "name": "name" }
        }
      }
    ]
  }
}
```

Ungrouped aggregate return:

```json
{
  "version": 2,
  "source": {
    "type": "entities",
    "alias": "course",
    "schemas": ["course"],
    "where": null
  },
  "output": {
    "type": "aggregate",
    "groupBy": [],
    "measures": [
      {
        "key": "courseCount",
        "aggregation": { "function": "count" }
      }
    ]
  }
}
```

Count distinct by entity ID. Without `distinctBy`, count counts source rows or paths. With `distinctBy`, null distinct values are ignored and unique non-null values are counted:

```json
{
  "type": "aggregate",
  "source": {
    "type": "entities",
    "alias": "reachableLesson",
    "schemas": ["lesson"],
    "where": null,
    "via": {
      "entityRef": "module",
      "alias": "moduleReachableLesson",
      "direction": "outgoing",
      "schema": "module-lesson"
    }
  },
  "aggregation": {
    "function": "count",
    "distinctBy": {
      "type": "ref",
      "sourceAlias": "reachableLesson",
      "field": { "type": "system", "name": "id" }
    }
  }
}
```

Time series over an entity date property:

```json
{
  "version": 2,
  "source": {
    "type": "entities",
    "alias": "course",
    "schemas": ["course"],
    "where": null
  },
  "output": {
    "type": "timeSeries",
    "time": {
      "bucket": "month",
      "range": {
        "startAt": "2026-01-01T00:00:00.000Z",
        "endAt": "2026-07-01T00:00:00.000Z"
      },
      "expr": {
        "type": "ref",
        "sourceAlias": "course",
        "field": {
          "type": "property",
          "schema": "course",
          "path": ["publishedAt"]
        }
      }
    },
    "measure": { "aggregation": { "function": "count" } }
  }
}
```

Expression snippets:

```json
{ "type": "literal", "value": "beginner" }
```

```json
{
  "type": "literal",
  "valueType": "date",
  "value": "2026-01-01T00:00:00.000Z"
}
```

```json
{
  "type": "and",
  "values": [
    {
      "type": "contains",
      "left": {
        "type": "ref",
        "sourceAlias": "course",
        "field": {
          "type": "property",
          "schema": "course",
          "path": ["tags"]
        }
      },
      "right": { "type": "literal", "value": "backend" }
    },
    {
      "type": "isNotNull",
      "expr": {
        "type": "ref",
        "sourceAlias": "course",
        "field": {
          "type": "property",
          "schema": "course",
          "path": ["publishedAt"]
        }
      }
    }
  ]
}
```

```json
{
  "type": "arithmetic",
  "operator": "divide",
  "left": {
    "type": "aggregate",
    "source": {
      "type": "events",
      "alias": "completedLessonsForRatio",
      "schemas": ["complete"],
      "entityRef": "lesson",
      "where": null
    },
    "aggregation": { "function": "count" }
  },
  "right": { "type": "literal", "value": 10 }
}
```

Aggregate response examples:

```json
{
  "type": "aggregate",
  "data": {
    "items": [
      {
        "courseCount": { "kind": "number", "value": 42 }
      }
    ]
  }
}
```

```json
{
  "type": "aggregate",
  "data": {
    "items": [
      {
        "difficulty": { "kind": "text", "value": "beginner" },
        "count": { "kind": "number", "value": 12 }
      }
    ],
    "pageInfo": { "limit": 100, "hasMore": false }
  }
}
```

Time-series response example:

```json
{
  "type": "timeSeries",
  "data": {
    "buckets": [
      {
        "startAt": "2026-01-01T00:00:00.000Z",
        "endAt": "2026-01-08T00:00:00.000Z",
        "value": 3
      },
      {
        "startAt": "2026-01-08T00:00:00.000Z",
        "endAt": "2026-01-15T00:00:00.000Z",
        "value": 0
      }
    ]
  }
}
```

Invalid query examples that must fail validation. Snippets in this section are focused on the named failure; omitted surrounding query fields should be assumed valid.

Duplicate alias:

```json
{
  "version": 2,
  "source": {
    "type": "entities",
    "alias": "course",
    "schemas": ["course"],
    "where": null
  },
  "output": {
    "type": "rows",
    "pagination": { "page": 1, "limit": 20 },
    "orderBy": [
      {
        "order": "asc",
        "expr": {
          "type": "ref",
          "sourceAlias": "course",
          "field": { "type": "system", "name": "name" }
        }
      }
    ],
    "fields": [],
    "include": [
      {
        "key": "modules",
        "limit": 100,
        "source": {
          "type": "entities",
          "alias": "course",
          "schemas": ["module"],
          "where": null,
          "via": {
            "entityRef": "course",
            "alias": "courseModule",
            "direction": "outgoing",
            "schema": "course-module"
          }
        },
        "orderBy": [
          {
            "order": "asc",
            "expr": {
              "type": "ref",
              "sourceAlias": "course",
              "field": { "type": "system", "name": "name" }
            }
          }
        ],
        "fields": []
      }
    ]
  }
}
```

Property field missing schema:

```json
{
  "type": "ref",
  "sourceAlias": "course",
  "field": { "type": "property", "path": ["difficulty"] }
}
```

Included source missing required limit:

```json
{
  "key": "modules",
  "source": {
    "type": "entities",
    "alias": "module",
    "schemas": ["module"],
    "where": null,
    "via": {
      "entityRef": "course",
      "alias": "courseModule",
      "direction": "outgoing",
      "schema": "course-module"
    }
  },
  "orderBy": [
    {
      "order": "asc",
      "expr": {
        "type": "ref",
        "sourceAlias": "module",
        "field": { "type": "system", "name": "name" }
      }
    }
  ],
  "fields": []
}
```

Included source missing non-empty orderBy:

```json
{
  "key": "modules",
  "limit": 100,
  "source": {
    "type": "entities",
    "alias": "module",
    "schemas": ["module"],
    "where": null,
    "via": {
      "entityRef": "course",
      "alias": "courseModule",
      "direction": "outgoing",
      "schema": "course-module"
    }
  },
  "orderBy": [],
  "fields": []
}
```

Sibling output key collision:

```json
{
  "fields": [
    {
      "key": "modules",
      "expr": { "type": "literal", "value": "not allowed" }
    }
  ],
  "include": [
    {
      "key": "modules",
      "limit": 100,
      "source": {
        "type": "entities",
        "alias": "module",
        "schemas": ["module"],
        "where": null,
        "via": {
          "entityRef": "course",
          "alias": "courseModule",
          "direction": "outgoing",
          "schema": "course-module"
        }
      },
      "orderBy": [
        {
          "order": "asc",
          "expr": {
            "type": "ref",
            "sourceAlias": "module",
            "field": { "type": "system", "name": "name" }
          }
        }
      ],
      "fields": []
    }
  ]
}
```

Invalid system field for source type:

```json
{
  "type": "ref",
  "sourceAlias": "course",
  "field": { "type": "system", "name": "occurredAt" }
}
```

## Testing Decisions

E2E tests must exercise external behavior through the query engine API. They should not assert SQL strings, CTE names, internal planner node shapes, or implementation details.

E2E tests are required for the proof criteria from the plan: fetch a course with nested modules, fetch a course with modules and lessons, include lesson completion state, filter courses by completed lesson count, filter courses by child property, verify top-level pagination with includes, and compute aggregate counts across child entities.

Additional E2E tests should cover event root sources, relationship root sources, time series over events, time series over entities or relationships, grouped aggregate row responses, include limit with hasMore, validation failure for missing child limit, validation failure for missing child orderBy, validation failure for duplicate aliases, validation failure for invalid field selector schemas, and user isolation across nested sources.

Backend unit tests should cover deep modules where behavior is best isolated without API setup: the v2 query-language parser, semantic validator, alias scope rules, field selector validation, safety-limit validation, expression validation, aggregate validation, and time-series validation.

SQL builder tests may exist where they protect important behavior, but they should prefer validating output behavior through repository/service boundaries or integration-style execution rather than snapshotting fragile generated SQL.

Prior art exists in the current query-engine E2E tests, event-mode tests, time-series tests, saved-view tests, sandbox query tests, and query-engine fixture helpers. New tests should copy the style of API-level setup and assertions, not the old DSL semantics.

Good tests should verify app-owned behavior and branching. They should not test that Effect Schema, TypeScript, SQL libraries, or JSON parsing work in isolation.

Test setup should use shared fixtures for authenticated clients, trackers, entity schemas, event schemas, relationship schemas, entities, events, and relationship rows.

When the old engine is deleted, obsolete old-engine tests and fixtures should be removed or rewritten to target the canonical v2 engine.

## Out of Scope

Frontend UI rendering for every new return type is out of scope.

A visual query builder for the new DSL is out of scope.

Backward compatibility with the old query-language request shape is out of scope.

Migration of old persisted saved-view JSON is out of scope unless the implementation discovers shipped persisted data that must be preserved.

Reusable computed fields or expression aliases are out of scope for v2. Computed output fields are in scope because every output field is defined by an expression.

Multiple time-series measures are out of scope for v2.

Include pagination beyond limit plus hasMore is out of scope for v2.

Returning total counts for included sources is out of scope for v2.

Keeping the old and new query engines long-term is out of scope.

## Further Notes

The old query engine's concepts of eventJoins and relationshipJoins should be treated as historical terms only. They are not the right primitives for hierarchical results because they imply flat one-row joins.

The new engine should prefer deep modules with stable interfaces: query document parsing, semantic validation, planning, source execution, expression compilation, and response serialization should be separable enough to test in isolation.

The exact SQL strategy is intentionally not specified. A complete rewrite of the CTE chain, SQL builder, and response serialization is acceptable.

The implementation should keep file sizes maintainable and split modules when they become too large.

---

## Tasks

**Overall Progress:** 12 of 12 tasks completed

**Current Task:** Complete

### Task List

| #   | Task                                                                                          | Type | Status |
| --- | --------------------------------------------------------------------------------------------- | ---- | ------ |
| 01  | [V2 Entity Rows API](./01-v2-entity-rows-api.md)                                               | AFK  | done   |
| 02  | [Core Validation Guardrails](./02-core-validation-guardrails.md)                               | AFK  | done   |
| 03  | [Relationship Includes](./03-relationship-includes.md)                                         | AFK  | done   |
| 04  | [Deep Includes And Event Existence](./04-deep-includes-and-event-existence.md)                 | AFK  | done   |
| 05  | [Event Roots And First Expressions](./05-event-roots-and-first-expressions.md)                 | AFK  | done   |
| 06  | [Descendant Source Filters](./06-descendant-source-filters.md)                                 | AFK  | done   |
| 07  | [Aggregate Returns](./07-aggregate-returns.md)                                                 | AFK  | done   |
| 08  | [Relationship Root Sources](./08-relationship-root-sources.md)                                 | AFK  | done   |
| 09  | [Time Series Returns](./09-time-series-returns.md)                                             | AFK  | done   |
| 10  | [Saved Views Full Query Documents](./10-saved-views-full-query-documents.md)                   | AFK  | done   |
| 11  | [Canonical Cutover And Old Engine Removal](./11-canonical-cutover-and-old-engine-removal.md)   | AFK  | done   |
| 12  | [Codebase Cleanup](./12-codebase-cleanup.md)                                                   | AFK  | done   |
