## Tasks

**Overall Progress:** 8 of 15 tasks completed

**Current Task:** [Task 09](./09-focused-navigation-queries.md) (todo)

### Task List

| #   | Task                                                                       | Status    |
| --- | -------------------------------------------------------------------------- | --------- |
| 01  | [Collections Tracer](./01-collections-tracer.md)                           | completed |
| 02  | [Typed JSON Entity Queries](./02-typed-json-entity-queries.md)             | completed |
| 03  | [Localized Entity Reads](./03-localized-entity-reads.md)                   | completed |
| 04  | [Event History Migration](./04-event-history-migration.md)                 | completed |
| 05  | [Relationship Rows And Includes](./05-relationship-rows-and-includes.md)   | completed |
| 06  | [Correlated Query Expressions](./06-correlated-query-expressions.md)       | completed |
| 07  | [Aggregate Outputs](./07-aggregate-outputs.md)                             | completed |
| 08  | [Time-Series Outputs](./08-time-series-outputs.md)                         | completed |
| 09  | [Focused Navigation Queries](./09-focused-navigation-queries.md)           | todo      |
| 10  | [Sandbox Execution And Media Monitoring](./10-sandbox-media-monitoring.md) | todo      |
| 11  | [Media Recipe Migration](./11-media-recipe-migration.md)                   | todo      |
| 12  | [Fitness Recipe Migration](./12-fitness-recipe-migration.md)               | todo      |
| 13  | [Saved-View Migration](./13-saved-view-migration.md)                       | todo      |
| 14  | [Legacy Query Engine Deletion](./14-legacy-query-engine-deletion.md)       | todo      |
| 15  | [Codebase Cleanup](./15-codebase-cleanup.md)                               | todo      |

## Problem Statement

Ryot currently has a custom query engine that provides focused reads over entities, events, and relationships. It supports field selection, schema-qualified JSON properties, filtering, ordering, pagination, nested relationship and event traversal, correlated expressions, aggregates, time series, localization, and user or plugin execution scopes.

The current language and implementation are built around three specialized source types. Each source type has separate validation, field registries, schema loading, visibility behavior, SQL construction, and traversal rules. Extending this model to saved views, plugins, plugin state, and future application tables would require adding more source variants and more source-specific branches. Tables that are not backed by entity, event, or relationship definitions also do not have the schema metadata expected by the current language.

This prevents Ryot from using one focused, GraphQL-like read API throughout the application. Client code must call broad domain endpoints even when it needs only a few fields. Navigation, for example, combines collections, plugin definitions, per-user plugin state, and saved views through multiple requests and receives fields it does not use. Similar read endpoints throughout the contract can eventually be replaced by application-owned query recipes, while domain mutations and workflows remain explicit operations.

The application is greenfield and has no user migration requirement. However, replacing the current query engine in one large change would create unnecessary cognitive load and make failures difficult to isolate. The current query engine must therefore remain complete and operational while a separate replacement is developed and consumers are migrated in focused vertical slices.

## Solution

Build a new read-only relational query system named RyotQL. RyotQL will have its own contract group, authenticated HTTP endpoint, backend module, SDK, recipes package, sandbox capability, tests, and documentation. It will coexist with the current query engine without importing or adapting its language or implementation.

RyotQL will query a small backend-owned catalog of safe tables. All tables will use one relational model based on table references, explicit aliases, inner and left joins, predicates, projections, correlated query sets, and one of three output forms: rows, aggregate, or time series. Entities, events, and relationships will become ordinary catalog tables rather than specialized source variants. Their schema slugs will be ordinary discriminator columns filtered through normal predicates. Deep property access will use generic JSON paths, with explicit safe casts when scalar behavior is required.

RyotQL documents will contain one or more independent named queries. A document will be validated completely and executed sequentially inside one read-only transaction with a shared database snapshot. The request succeeds or fails as one unit. Each named query will compile to one SQL statement, preserving SQL-side filtering, ordering, pagination, aggregation, time bucketing, and nested correlated results without application-side row evaluation.

Authorization will come from the execution principal, never from the query document. Authenticated HTTP callers receive user-scoped visibility. Pinned plugin scripts receive plugin-scoped visibility through a separate capability-gated host function. Every table occurrence, including joins and correlated queries, will have its visibility predicate applied before query predicates. Query predicates can narrow this authorized relation but cannot broaden it.

The initial catalog will support entity, event, relationship, plugin, plugin state, and saved view tables. The first tracer migration will move the collections query through the complete RyotQL stack. Subsequent work will implement and migrate the useful rows, includes, aggregate, time-series, localization, and plugin execution behavior used by current application and plugin recipes. Saved views will migrate as one bounded slice without supporting two persisted document formats in the same runtime path. Once no production consumer references the legacy query engine, one final task will delete the old endpoint, contract, backend module, SDK helpers, recipes, tests, and documentation. RyotQL will keep its name permanently.

## User Stories

1. As an application developer, I want to select only the fields a screen needs, so that client payloads do not contain unused domain data.
2. As an application developer, I want one relational query model for all supported tables, so that adding a table does not require a new source implementation.
3. As an application developer, I want entities, events, and relationships represented as normal tables, so that they use the same compiler as saved views and plugins.
4. As an application developer, I want to filter schema discriminator columns with normal predicates, so that the language does not require a special schemas attribute.
5. As an application developer, I want to traverse JSON fields with generic JSON paths, so that JSON querying works for properties, manifests, query documents, and display configuration.
6. As an application developer, I want explicit safe casts for JSON values, so that numeric, boolean, text, and date behavior is clear in each recipe.
7. As an application developer, I want incompatible JSON casts to return null, so that one malformed value does not fail an entire query.
8. As an application developer, I want inner and left joins between registered tables, so that related application data can be projected in one query.
9. As an application developer, I want correlated nested row queries, so that one-to-many children can be returned without multiplying parent rows.
10. As an application developer, I want correlated existence checks, so that parents can be filtered by descendant data.
11. As an application developer, I want correlated first-value expressions, so that latest events and first ordered children can be selected efficiently.
12. As an application developer, I want correlated aggregates, so that descendant counts and measures execute in PostgreSQL.
13. As an application developer, I want grouped and ungrouped aggregate outputs, so that current analytical recipes remain possible.
14. As an application developer, I want UTC time-series bucketing with zero-filled gaps, so that current charts retain their behavior.
15. As an application developer, I want multiple independent named queries in one request, so that a screen can load unrelated datasets through one endpoint.
16. As an application developer, I want all named queries to share one snapshot, so that a response represents a consistent database state.
17. As an application developer, I want all-or-nothing named-query execution, so that callers never handle partial result and error envelopes.
18. As an application developer, I want root pagination to report the real total even beyond the final page, so that page metadata remains correct.
19. As an application developer, I want deterministic pagination ordering, so that tied values do not move between pages.
20. As an application developer, I want nulls ordered last in both directions, so that optional values do not unexpectedly lead descending lists.
21. As an application developer, I want normal SQL join multiplicity, so that query results and aggregates have predictable relational semantics.
22. As an application developer, I want empty dynamic filters to have useful logical identities, so that recipes do not need repetitive array guards.
23. As an application developer, I want output fields to retain runtime kinds, so that generic saved-view renderers can distinguish dates, text, numbers, booleans, JSON, and null.
24. As an application developer, I want a plain-object RyotQL SDK, so that documents are ergonomic to build and remain serializable.
25. As an application developer, I want reusable table handles in the SDK, so that aliases are not repeated throughout a recipe.
26. As an application developer, I want backend validation to remain authoritative for tables and columns, so that the SDK does not duplicate database catalog metadata.
27. As an application developer, I want raw structurally valid documents accepted by the contract, so that saved views and sandbox wire values do not depend on SDK execution.
28. As an application developer, I want reusable recipes in a dedicated package, so that application query behavior does not pollute the generic SDK.
29. As a plugin developer, I want plugin-only recipes to remain inside the plugin, so that plugin domain ownership stays local.
30. As a sandbox developer, I want the sandbox SDK to re-export the same RyotQL builders, so that there is only one SDK implementation.
31. As a sandbox developer, I want strict response helpers for the RyotQL response shape, so that sandbox scripts can safely read dynamic rows without legacy compatibility branches.
32. As an authenticated user, I want RyotQL to expose only my own and global data, so that another user's data cannot be selected through crafted joins or subqueries.
33. As a plugin workflow, I want to query global entities owned by my plugin, so that system workflows can process shared provider-backed records.
34. As a plugin workflow, I want to query cross-user rows of relationship and event definitions owned by my plugin, so that monitoring and automation workflows can find affected shared records.
35. As a security reviewer, I want execution authority supplied outside the query document, so that documents cannot request broader access.
36. As a security reviewer, I want visibility applied to every table occurrence before joins, so that left joins and correlated queries cannot bypass row policies.
37. As a security reviewer, I want sensitive physical columns omitted from the query catalog, so that they are inaccessible even when a caller knows their database names.
38. As a security reviewer, I want the direct RyotQL endpoint limited to authenticated users, so that anonymous callers and plugins cannot choose execution authority.
39. As a media user, I want monitoring status scoped to my relationship rows, so that another user's monitoring state is not visible to me.
40. As a media workflow, I want to find global media monitored by any user without reading user-owned endpoint entities, so that cross-user processing remains narrow and explicit.
41. As a localized user, I want entity names and properties resolved for my language in fields, filters, ordering, includes, and correlated queries, so that all query behavior uses the same localized view.
42. As a localized user, I want translation status available as a normal entity field, so that detail screens can request it without a special selector type.
43. As a plugin workflow, I want canonical entity values, so that system processing does not depend on one user's language preference.
44. As a navigation user, I want workspaces, saved views, and collections loaded through focused named queries, so that navigation does not require broad list endpoints.
45. As a saved-view user, I want expanded RyotQL documents persisted, so that saved views do not depend on recipe names or code deployment details.
46. As a maintainer, I want the current query engine to remain complete while RyotQL is developed, so that each implementation task has a limited cognitive scope.
47. As a maintainer, I want direct recipe and consumer migrations without a language translator, so that legacy concepts do not leak into RyotQL.
48. As a maintainer, I want both engine test suites green after every migration task, so that coexistence remains reliable.
49. As a maintainer, I want a separate RyotQL guide, so that each language has one authoritative document during coexistence.
50. As a maintainer, I want the legacy engine deleted only after repository-wide reference checks pass, so that no hidden consumer is broken.
51. As a maintainer, I want RyotQL to keep its original name after migration, so that no final rename creates unnecessary churn.

## Implementation Decisions

**Product and package boundaries**

- The permanent product name is RyotQL.
- The generic builder SDK is published as `@ryot/ryotql`.
- Reusable application recipes are published as `@ryot/ryotql-recipes`.
- The authenticated contract group is named `ryotql` and exposes an `execute` operation at `POST /ryotql/execute`.
- The backend implementation is a new RyotQL module independent from the legacy query-engine module.
- Sandbox execution uses a new `executeRyotql` host capability and a new `@ryot/sandbox-sdk/ryotql` entry point.
- The legacy query engine keeps its existing names and surfaces until final deletion.
- The RyotQL implementation must not import language, validator, compiler, executor, response, or localization code from the legacy query-engine module.
- Both engines may depend on existing generic database, authentication, transaction, definition, and sandbox infrastructure.

**Document and response contracts**

- A RyotQL document contains a non-empty map of named queries.
- Every document uses the named-query shape, including documents with one query.
- Each named query contains a table reference, optional joins, an optional predicate, and exactly one output definition.
- Table references contain a registered table name and an explicit lexical alias.
- Optional predicates, joins, and includes are omitted when absent rather than encoded as null or empty collections.
- Named queries cannot reference other named queries.
- The response contains a `data` object keyed by the request's query names.
- The complete document is decoded and validated before execution begins.
- Validation or execution failure in any named query fails the complete request.
- Named queries execute sequentially in declaration order.
- Every document executes in one read-only transaction with one shared database snapshot.
- Each named query emits exactly one SQL statement.
- The existing transaction-local 30-second statement timeout remains the execution backstop.

**SDK design**

- The SDK has no runtime dependencies and returns plain serializable AST objects.
- The SDK strongly types AST shapes, supported operators, builder arguments, table handles, and expression composition.
- Table names and public field names remain strings. The SDK does not duplicate or generate the backend table catalog.
- The backend contract and catalog validator remain authoritative for table existence, field existence, visibility, and authorization.
- Table handles carry the serialized alias and are accepted by column, JSON-path, join, ordering, and correlated-query builders.
- The initial SDK exposes builders for documents, tables, fields, rows, includes, joins, literals, columns, JSON paths, casts, comparisons, boolean logic, null checks, containment, coalesce, arithmetic, correlated existence, correlated first values, ordering, aggregates, and time series.
- Named helpers such as equality, greater-than, ascending, sum, and count are the primary API instead of generic operator-string helpers.
- Empty conjunction is true. Empty disjunction and an empty membership test are false.
- The SDK is optional. Raw documents accepted by the contract receive the same backend validation.
- The contract package owns Effect Schema wire codecs and wire-safe types.
- The contract must no longer depend back on SDK primitive definitions, avoiding a package dependency cycle.

**Recipes**

- `@ryot/ryotql-recipes` depends on the RyotQL SDK and may depend on contract schemas or Effect only when a shared result decoder requires them.
- The recipes package cannot import frontend, backend, database, or plugin runtime code.
- Recipes are TypeScript document builders and are not registered or named on the server.
- The server receives the expanded document and does not know which recipe produced it.
- Cross-application recipes shared by client, backend, tests, or sandbox helpers belong in the recipes package.
- Generic entity-read and event-read sandbox recipes are exported from a sandbox recipe entry point and re-exported by the sandbox SDK.
- Recipes used only by one plugin remain in that plugin.
- A recipe may colocate a shared result schema and mapping function when multiple consumers need the same conversion.
- There is no mandatory recipe interface or recipe-definition framework.
- Saved views persist expanded RyotQL documents rather than recipe names and arguments.

**Relational query model**

- RyotQL has no entity, event, relationship, or application-specific source variants.
- A query set consists of one table reference, zero or more joins, and an optional predicate.
- Only inner and left joins are initially supported.
- Joins may connect any registered tables and are not restricted to declared database foreign keys.
- A join predicate may reference the newly joined alias and aliases already available in lexical scope.
- Query aliases are resolved lexically. Unknown aliases, duplicate aliases, sibling leakage, and forward references are validation errors.
- Normal SQL multiplicity applies when joins match multiple rows.
- RyotQL does not initially provide a distinct rows option.
- One-to-many nested data is represented through correlated row includes rather than implicit parent deduplication.
- Correlated query sets may reference valid ancestor aliases.
- Named queries remain independent and cannot consume each other's results.

**Catalog and fields**

- The backend owns a static catalog of queryable tables and public fields.
- Adding a safe table requires a catalog declaration, not a new validator, compiler, or executor branch.
- Every public field resolves through one uniform backend interface that returns its SQL value expression and scalar category.
- Ordinary fields use a physical-column resolver helper.
- Backend-derived fields use backend-owned resolvers through the same interface.
- Query documents and plugins cannot register SQL field resolvers.
- The initial catalog contains entity, event, relationship, plugin, plugin state, and saved view.
- Entity fields are id, name, userId, createdAt, updatedAt, properties, externalId, populatedAt, entitySchemaSlug, providerId, and translationStatus.
- Event fields are id, userId, entityId, createdAt, updatedAt, properties, occurredAt, eventSchemaSlug, and sessionEntityId.
- Relationship fields are id, userId, sourceEntityId, targetEntityId, createdAt, properties, and relationshipSchemaSlug.
- Plugin fields are slug, status, version, manifest, and ingestedAt.
- Plugin-state fields are id, pluginSlug, sortOrder, isDisabled, createdAt, and updatedAt.
- Saved-view fields are id, slug, name, icon, accentColor, sortOrder, isBuiltin, isDisabled, pluginSlug, queryDocument, displayConfiguration, createdAt, and updatedAt.
- Plugin source hashes, compiled hashes, plugin-state configuration, and omitted ownership columns are not public RyotQL fields.
- Policy code may use internal columns that are not public fields.
- New tables and fields are added only for concrete consumers in later work.

**Discriminators and JSON**

- The public language has no schemas attribute and performs no definition existence lookup for query predicates.
- Entity, event, and relationship schema slugs are ordinary discriminator fields.
- Single discriminator filtering uses equality. Multiple discriminator filtering uses membership predicates.
- Unknown or plugin-foreign discriminator values produce no matching rows after authorized visibility is applied.
- Schema metadata fields and schema names are removed entirely.
- JSON traversal uses a generic JSON-path expression over a public JSON field.
- JSON paths support deep objects and array indices represented by path segments.
- Query-time property-schema loading, path validation, type inference, and schema guards are removed.
- Entity, event, and relationship write paths continue validating persisted properties against their property schemas.
- Raw JSON-path output derives its field kind from the runtime JSON value.
- Explicit casts provide text, number, boolean, date, or JSON scalar behavior where required.
- Missing paths, JSON null, incompatible types, malformed dates, and out-of-range numeric casts resolve to null instead of aborting execution.

**Expression semantics**

- Preserve comparison operators for equality, inequality, greater-than, greater-than-or-equal, less-than, and less-than-or-equal.
- Preserve boolean conjunction, disjunction, negation, explicit null checks, containment, coalesce, arithmetic, correlated existence, correlated first value, and correlated aggregate expressions.
- Comparisons involving null evaluate to false except explicit null checks.
- Negation applies to the null-collapsed boolean result, preserving current null-as-false semantics.
- Text comparisons and ordering use deterministic C collation.
- String containment remains case-insensitive and escapes wildcard characters literally.
- Array and object containment uses structural JSON containment.
- JSON equality remains structural.
- Arithmetic operands use safe numeric casts.
- Division by zero returns null.
- A first-value expression supports a normal query set, including a predicate, ordering, and a selected scalar expression.
- First value over an empty query set returns null.
- Coalesce returns the first non-null value and preserves that value's runtime kind.
- Derived catalog fields can be selected, filtered, ordered, and referenced in nested or correlated queries like physical fields.

**Rows and includes**

- Rows output contains selected fields, pagination, ordering, and optional correlated includes.
- Root rows default to page 1, limit 20, and root primary-key ascending order when the SDK caller omits these values.
- Domain recipes provide explicit ordering whenever domain order matters.
- The compiler appends the root primary key as an internal final ordering term when it is not already present.
- Both ascending and descending ordering use nulls last.
- Root page size remains capped at 100.
- Root pagination returns items, page, limit, total, and hasMore.
- Total remains the true count when the requested offset is beyond the final item.
- Empty selected field lists remain valid when a caller needs only pagination or nested data.
- Includes are correlated row queries with selected fields, ordering, an explicit limit, and optional nested includes.
- Includes fetch limit plus one row to derive hasMore without a total count.
- Include limit remains capped at 100.
- Includes return an empty list without removing the parent row.
- Include depth remains capped at three.
- Any registered table may participate in an include, and there are no event- or relationship-specific nesting restrictions.
- Output field and include keys must be unique among siblings.
- SQL output aliases are generated by position rather than derived from caller keys, removing the legacy output-key byte limit.

**Aggregate output**

- Preserve ungrouped and grouped aggregate outputs over a generic query set.
- Preserve count, count distinct, sum, average, minimum, and maximum.
- Count over an empty set returns zero.
- Sum, average, minimum, and maximum over an empty set return null.
- Group fields retain dynamic field kinds.
- Measures return number or null field kinds as appropriate.
- Grouped aggregates preserve their current limit and hasMore behavior.
- Grouped aggregate limit remains capped at 1000.
- RyotQL does not add multiple analytical dimensions, aggregate pagination, or broader order-expression support beyond the current useful capability.

**Time-series output**

- Preserve one measure over a generic query set with hour, day, week, or month buckets.
- Preserve half-open input ranges with inclusive start and exclusive end.
- Preserve UTC bucketing and Monday-start ISO weeks.
- Preserve calendar-aware month stepping.
- Preserve aligned bucket boundaries and SQL-side zero filling with contiguous buckets.
- Preserve count, sum, average, minimum, and maximum measure behavior currently supported by the engine.
- The time expression must resolve to a physical date field or an explicit safe date cast.
- Aligned bucket count remains capped at 1000.
- RyotQL does not initially add multiple measures, multiple series, custom bucket units, or time-series pagination.

**Localization and derived entity fields**

- User execution carries the authenticated user's language into query compilation.
- Plugin execution has no user language and reads canonical entity values.
- Entity name resolves to the translated name when a relevant translation exists, otherwise to the canonical name.
- Entity properties merge translated values over canonical properties while retaining untranslated canonical fields.
- Selection, filtering, ordering, includes, and correlated queries all use the same localized field resolver.
- JSON paths over entity properties operate on the resolved localized properties value.
- Translation status is exposed as a normal entity field through the catalog resolver interface.
- Translation status preserves ready, pending, and none semantics, including canonical-language readers, missing providers, unpopulated entities, absent translations, and negative-cache translations.
- Translation SQL is emitted only when the resolved field is referenced.
- There is no special system-computed selector or root-only translation-status rule.

**Execution scopes and authorization**

- RyotQL has authenticated-user and pinned-plugin execution scopes.
- There is no generic kernel principal or caller-defined grant language in this PRD.
- The HTTP endpoint always executes as the authenticated user.
- Sandbox scripts execute through the capability-gated host function, which derives plugin authority from trusted pinned script metadata.
- Query documents cannot specify or alter their execution scope.
- User visibility exposes the user's own rows and allowed global rows for entity, event, and relationship tables.
- User visibility exposes only the user's plugin state and saved views.
- User visibility exposes public plugin metadata.
- Plugin visibility exposes global entities whose discriminator definitions are owned by that plugin.
- Plugin visibility exposes cross-user event and relationship rows only for definitions owned by that plugin.
- Plugin access to plugin, plugin state, saved view, and other application tables is denied unless future concrete requirements add a narrow policy.
- Every table occurrence is compiled as an authorized relation before caller joins and predicates are applied.
- Applying visibility before a left join must preserve left-join behavior and must not move the joined table's policy into the final where clause.
- Direct table access denial, hidden field access, and unknown table access produce validation errors.
- Authorized queries against unknown or foreign discriminator values return empty results rather than definition lookup errors.

**Media monitoring behavior**

- User monitoring status queries global provider-backed media and correlates the current user's visible media-monitoring relationship rows.
- The monitoring library identifier is read from the relationship targetEntityId rather than by loading the user-owned library endpoint entity.
- Plugin monitoring sweeps query global plugin-owned media and use existence of any plugin-owned media-monitoring relationship across users.
- Plugin monitoring sweeps do not receive implicit access to arbitrary user-owned endpoint entity fields.
- If a future workflow needs cross-user endpoint fields, that requirement must add a narrow backend table policy as separate work rather than reintroducing traversal-based authorization.

**Limits and SQL safety**

- A document may contain at most 10 named queries.
- Each query set may contain at most eight joins.
- Preserve existing root page, include, include-depth, correlated-depth, grouped-aggregate, time-series bucket, and statement timeout limits.
- Do not add speculative expression-node, field-count, query-complexity, or JSON-path-depth scoring in this PRD.
- Caller literals and JSON paths are parameterized.
- Physical SQL identifiers come only from the backend catalog.
- Caller aliases are mapped to generated SQL aliases and are never interpolated as SQL identifiers.
- Query execution remains entirely in PostgreSQL, with no application-side filtering, sorting, grouping, or fallback evaluation.

**Errors and observability**

- Reuse existing typed HTTP BadRequest and NotFound boundaries with precise messages.
- Do not create a new per-error code taxonomy.
- Do not return partial result error envelopes.
- Statement timeout remains a client-visible bad request rather than an internal server error.
- RyotQL does not persist or log full query documents.
- Observability records normal request traces, duration, named-query count, output types, timeout classification, validation classification, and database telemetry.
- Sandbox response helpers accept only the RyotQL response envelope and do not support legacy array or envelope variants.

**Coexistence and migration**

- The legacy query engine remains fully functional and effectively frozen during RyotQL development.
- Legacy changes are limited to work necessary to keep unmigrated consumers compiling and passing.
- RyotQL does not import from the legacy query-engine module.
- There is no old-to-new document translator, compatibility adapter, feature flag, dual execution, or structural document dispatch.
- RyotQL uses separate endpoint, contract, service, SDK, sandbox capability, tests, and documentation throughout coexistence.
- Collections are the first full tracer and must exercise SDK construction, contract decoding, authenticated routing, catalog validation, SQL execution, response reconstruction, and client consumption.
- Each later migration moves a complete recipe, its production consumers, and its focused tests.
- Equivalent behavior may temporarily be tested against both engines while both implementations exist.
- Saved views remain entirely on the legacy document format until one bounded migration moves all saved-view producers and consumers to expanded RyotQL documents.
- One saved-view runtime path never supports both document formats.
- No persisted-user data migration or compatibility period is required because the application is greenfield.
- The migration target includes useful behavior used by production recipes and the generic rows, include, aggregate, time-series, localization, and security capabilities.
- The migration does not reproduce legacy syntax, schema metadata, automatic schema property guards, source-specific validation, or source-specific nesting restrictions.
- After migration, repository-wide checks must find no production import, contract call, sandbox capability, saved-view document, recipe, or application consumer using query-engine.
- One final atomic task deletes the complete legacy contract group, endpoint, backend module, SDK helpers, recipes, tests, and guide.
- RyotQL is not renamed after the legacy engine is deleted.

**Database changes**

- No new application database tables are required for the initial RyotQL implementation.
- Existing indexes on ownership, discriminator, relationship endpoint, event entity, and JSON fields continue to support the initial query surface.
- The implementation may add narrowly justified indexes when a migrated real query demonstrates a missing access path.
- Saved-view JSON storage changes from legacy documents to expanded RyotQL documents during the bounded saved-view migration, without dual-format runtime support.

## Testing Decisions

- Tests must assert externally visible language, security, SQL-result, and response behavior rather than private helper structure or exact generated SQL formatting.
- Contract tests must verify strict decoding of named documents, table references, joins, expressions, outputs, limits, unknown keys, and invalid shapes.
- SDK tests must verify that builders produce the intended serializable AST, preserve table aliases, omit absent values, and implement empty-combinator identities.
- Recipe tests must verify important generated predicates, fields, ordering, and output structure without snapshotting irrelevant object details.
- Catalog tests must verify allowed tables, public fields, hidden-field rejection, execution-scope access, and uniform physical or derived field resolution.
- Validator tests must cover alias uniqueness, lexical scope, join scope, correlated ancestor references, unknown tables, unknown fields, JSON-path eligibility, cast targets, output-key uniqueness, and all retained limits.
- Expression tests must cover null-as-false comparisons, explicit null checks, C collation, wildcard escaping, string and structural containment, JSON equality, safe casts, malformed values, arithmetic, division by zero, coalesce, empty boolean combinators, membership, existence, first value, and correlated aggregates.
- Rows tests must cover default and explicit ordering, primary-key tie breaking, nulls last, normal join multiplicity, empty fields, correct totals beyond the final page, hasMore, and page limits.
- Join security tests must verify that visibility is applied before inner and left joins and that a left join does not become an inner join because of its row policy.
- Include tests must cover per-parent ordering and limits, limit-plus-one hasMore detection, empty child lists, ancestor correlation, nested includes, and maximum depth.
- Aggregate tests must cover count, count distinct, nullable operands, empty inputs, grouped null keys, measures after multiplying joins, group limits, and hasMore.
- Time-series tests must cover half-open ranges, hour/day/week/month alignment, Monday weeks, calendar months, UTC behavior, interior zero fill, empty ranges, safe date casts, measure behavior, and bucket limits.
- Output reconstruction tests must cover text, number, boolean, date, JSON, and null kinds for rows, includes, group fields, and measures.
- Localization tests must verify canonical fallback, translated names, partial translated properties, filtering and ordering on localized values, JSON paths over localized properties, nested-query propagation, canonical plugin execution, and all translation-status states.
- User authorization tests must verify own rows, allowed global rows, isolation from another user, hidden application rows, and crafted joins or correlated queries that attempt to cross the boundary.
- Plugin authorization tests must verify global entity ownership restrictions, cross-user access only to owned event and relationship definitions, denial of application tables, empty results for foreign discriminator predicates, and inability to choose plugin scope through HTTP.
- Media monitoring tests must verify per-user status isolation, relationship target identifiers, cross-user sweep existence, no cross-user endpoint entity access, one refresh for shared global media, and unchanged notification behavior.
- Sandbox host tests must verify capability gating, trusted plugin scope derivation, rejection of direct scope input, RyotQL response handling, and coexistence with the legacy executeQueryEngine capability.
- Endpoint tests must verify authentication, complete-document validation, all-or-nothing failures, sequential named results, the shared transaction snapshot, statement timeout mapping, and the response data envelope.
- Navigation tests must verify that focused plugin, plugin-state, saved-view, and collection results produce the same visible workspaces and navigation items without broad endpoint payloads.
- Saved-view tests must verify expanded document persistence, validation, execution, cloning, updating, and rendering after the bounded migration.
- Migration tasks must leave all existing legacy tests passing until the final deletion task.
- New RyotQL behavior may reuse scenario vocabulary and fixtures from the current kernel query-engine suites, including courses, modules, lessons, books, movies, event reviews, relationship memberships, aggregates, localization, and time series.
- Security prior art includes the existing query-engine visibility tests, media-monitoring multi-user tests, and sandbox host authority tests.
- Client prior art includes current navigation data tests and saved-view runtime formatting tests.
- End-to-end tests should seed through existing typed test-support and production service paths rather than writing database rows directly.
- The final implementation verification must include package checks, backend checks and tests, relevant client checks and tests, plugin tests, sandbox SDK tests, contract tests, and focused end-to-end suites through monorepo Turbo commands.

## Out of Scope

- Mutations, inserts, updates, deletes, commands, workflows, webhooks, and subscriptions through RyotQL.
- Anonymous RyotQL execution.
- Caller-selected user, plugin, admin, or kernel execution scopes.
- A generic grant-description language.
- A public computed-field registration API.
- Querying arbitrary database tables.
- Querying auth, session, account, API key, sandbox source, compiled code, workflow reference, or internal claim tables.
- Integrations, imports, notification channels, automations, and other application tables until concrete consumers justify catalog entries.
- Property-schema query validation or schema-aware property type inference.
- Schema metadata or schema-name querying.
- Server-registered named recipes.
- Persisting recipe names and arguments in saved views.
- A compatibility translator from the legacy query language.
- Dual-format saved-view execution.
- Production user-data migration support.
- Query document version negotiation during the greenfield phase.
- Full compile-time table and column generation for the SDK.
- Complete static inference of result object types from query documents.
- Partial named-query success responses.
- Cross-query references or dependencies.
- Right joins, full joins, cross joins, common table expression syntax, unions, recursive queries, or arbitrary SQL functions.
- A distinct rows output until a real query requires it.
- Conditional expressions until a real query requires them.
- Cursor pagination.
- Configurable null ordering.
- Multiple time-series measures, multiple series, custom buckets, or time-series pagination.
- Broader aggregate capabilities beyond current useful behavior.
- Query introspection or a GraphQL-compatible schema endpoint.
- Persisted query history or full-document logging.
- A final rename from RyotQL to query-engine.

## Further Notes

- RyotQL is GraphQL-like in its focused field selection and named result sets, but it is not GraphQL and does not aim for GraphQL protocol compatibility.
- The incremental migration exists to reduce implementation cognitive load. It is not a backwards-compatibility or user-migration strategy.
- The smallest correct implementation is preferred. New abstractions, table entries, expression types, output modes, and compatibility behavior require a concrete consumer.
- The legacy query engine is a behavior reference during migration, not a dependency or architectural foundation for RyotQL.
- The mandatory final cleanup task produced during task breakdown must use the codebase-cleanup skill over touched files and directly affected modules after the legacy deletion work is complete.
