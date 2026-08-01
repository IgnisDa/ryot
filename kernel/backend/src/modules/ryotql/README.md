# RyotQL

`POST /ryotql/execute` is the authenticated relational read API. Metadata, commands, administration, streaming, test support, and other operational endpoints remain explicit exceptions.

## Document And Result Shape

A document has a non-empty `queries` record. Each named query has `from: { table, alias }`, optional `joins` and `where`, and one `rows`, `aggregate`, or `timeSeries` output.

```json
{
	"queries": {
		"entities": {
			"from": { "table": "entity", "alias": "entity" },
			"output": {
				"type": "rows",
				"fields": [],
				"orderBy": [],
				"pagination": { "limit": 20 }
			}
		}
	}
}
```

The response is `{ data: { [queryName]: result } }`. The complete document validates before execution. Queries run sequentially in declaration order in one repeatable-read, read-only transaction and share one snapshot. Any validation or execution failure fails the request; there are no partial results.

Rows select `{ key, expr }` fields or `{ type: "wildcard", tableAlias }`. A wildcard expands only the approved fields for that alias; hidden physical and authorization columns remain inaccessible. Duplicate output keys fail validation.

| Output       | Required shape                                                                  | Result                                                              |
| ------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `rows`       | `fields`, `orderBy`, `pagination: { limit, after? }`, optional `include`        | `{ type: "rows", items, pageInfo: { limit, hasMore, nextCursor } }` |
| `aggregate`  | Non-empty `measures`; optional `groupBy`, `orderBy`, and `limit`                | `{ type: "aggregate", items, pageInfo? }`                           |
| `timeSeries` | `time: { expr, range: { startAt, endAt }, bucket }`, `measure: { aggregation }` | `{ type: "timeSeries", buckets: [{ startAt, endAt, value }] }`      |

## Catalog And Visibility

HTTP execution always uses the authenticated user. A document cannot provide a user ID, plugin slug, execution scope, or grant. Authorization applies independently to every root, join, include, and correlated query before caller predicates.

| Table                           | Queryable fields                                                                                                                                                                                            | User visibility                        |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `entity`                        | `id`, `name`, `userId`, `createdAt`, `updatedAt`, `properties`, `externalId`, `populatedAt`, `providerId`, `populationStatus`, `translationStatus`, `entitySchemaPluginId`, `entitySchemaSlug`              | User-owned and global                  |
| `event`                         | `id`, `userId`, `entityId`, `createdAt`, `updatedAt`, `properties`, `occurredAt`, `eventSchemaSlug`, `sessionEntityId`                                                                                      | User-owned                             |
| `relationship`                  | `id`, `userId`, `sourceEntityId`, `targetEntityId`, `createdAt`, `properties`, `relationshipSchemaSlug`                                                                                                     | User-owned and global                  |
| `plugin`                        | `id`, `slug`, `name`, `icon`, `scope`, `status`, `version`, `sourceHash`, `clientApiVersion`, `ingestedAt`                                                                                                  | User-owned and global packages         |
| `pluginInstallation`            | `id`, `pluginId`, `health`, `homeSavedViewId`, `sortOrder`, `isDisabled`, `createdAt`, `updatedAt`                                                                                                          | User-owned                             |
| `savedView`                     | `id`, `slug`, `name`, `icon`, `sortOrder`, `isBuiltin`, `isDisabled`, `pluginSlug`, `renderer`, `settings`, `dataSources`, `createdAt`, `updatedAt`                                                         | User-owned                             |
| `sandboxProvider`               | `id`, `slug`, `name`, `pluginId`, `rootEntitySchemaSlug`, `information`, `createdAt`, `updatedAt`                                                                                                           | Effective ready, enabled installations |
| `sandboxProviderOperation`      | `id`, `providerId`, `operation`, `optionsSchema`, `createdAt`, `updatedAt`                                                                                                                                  | Operations of visible providers        |
| `notificationChannel`           | `id`, `channel`, `description`, `isDisabled`, `createdAt`, `updatedAt`                                                                                                                                      | User-owned                             |
| `integration`                   | `id`, `lot`, `name`, `provider`, `pluginSlug`, `isDisabled`, `syncOwnership`, `minimumProgress`, `maximumProgress`, `extraSettings`, `lastFinishedAt`, `createdAt`, `updatedAt`                             | User-owned                             |
| `importRun`                     | `id`, `integrationId`, `source`, `status`, `progress`, `failedItems`, `inputSummary`, `importedItems`, `processedItems`, `totalItems`, `failureReason`, `startedAt`, `finishedAt`, `createdAt`, `updatedAt` | User-owned                             |
| `importRunFailure`              | `id`, `runId`, `stage`, `reason`, `itemIndex`, `sourceLabel`, `eventSchemaSlug`, `entitySchemaSlug`, `sourceIdentifier`, `createdAt`                                                                        | Through the owned import run           |
| `notificationSubscriptionState` | `id`, `signalSchemaSlug`, `isActive`, `createdAt`, `updatedAt`                                                                                                                                              | User-owned                             |

`savedView.pluginSlug` and `integration.pluginSlug` derive from the exact installation. Provider operations join through `providerId`; script IDs, package manifests, installation configuration, raw channel/integration specifics, and ownership columns are not queryable unless listed above.

Sandbox scripts require `executeRyotql`. User and subscription executions retain user visibility. System execution requires a persisted pinned system-scope plugin script and may read only global entities whose schema belongs to that plugin, plus events and relationships whose discriminator definition belongs to it. All application/catalog tables are denied in system scope.

## Expressions And Predicates

Expression kinds are text, date, number, boolean, JSON, and null. Kind inference is shared by validation and compilation; unknown aliases or fields are validation errors.

Scalar expressions include columns, JSON literals, `jsonPath`, casts, `coalesce`, `concat`, conditionals, `kebabCase`/`titleCase` transforms, `floor`, `round`, integer conversion, null checks, arithmetic, `dateBucket`, and correlated `exists`, `first`, or aggregate queries. Correlated aliases are lexical: ancestors are visible, siblings and forward joins are not. `first` requires ordering and receives primary-key tie breakers.

Predicates include `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `contains`, `in`, `isNull`, `isNotNull`, `and`, `or`, `not`, and `exists`. Null comparisons are false before `not`; empty `and` is true, while empty `or` and `in` are false. Text uses deterministic C collation. `contains` is escaped case-insensitive substring matching for text and structural containment for JSON; JSON equality is structural.

`jsonPath` traverses public JSON object keys or array indexes. Missing paths and JSON null produce null. It does not consult property definitions. Casts to text, number, boolean, date, or JSON return null for incompatible, malformed, or out-of-range values instead of failing SQL. Arithmetic uses safe numeric values; invalid operands and division by zero return null.

`dateBucket` accepts hour, day, week, or month plus an IANA zone and returns the local boundary as an ISO UTC instant; weeks start Monday and daylight-saving offsets are respected. Invalid zones and non-date inputs fail validation.

## Joins, Includes, And Pagination

Inner and left joins support any visible catalog tables and normal SQL multiplicity. A join may refer to its new alias and aliases already in scope. Authorization is inside each table occurrence, so an invisible right row in a left join becomes null without removing the left row.

Includes are correlated row queries with their own root, optional joins/predicate, fields, non-empty order, explicit limit, and optional nested includes. They return `{ items, pageInfo: { limit, hasMore } }`; no match returns an empty list. Sibling aliases are isolated.

Root rows use `{ limit, after? }` and return `{ items, pageInfo: { limit, hasMore, nextCursor } }`. Pagination is forward-only and cursors are opaque and validated. The backend fetches `limit + 1`, returns at most `limit`, and emits a cursor only when another row exists. Primary-key tie breakers and `NULLS LAST` make multiplied rows deterministic. SDK-built roots default to 20 and primary-key ascending order. Persisted saved-view documents must omit cursors.

## Derived Fields

For users with a non-canonical language, entity `name` falls back to canonical text and translated `properties` overlay canonical keys. Selection, filtering, ordering, and JSON paths see the same resolved values.

`populationStatus` is `ready` when `populatedAt` exists, `none` without provider or external ID, and `pending` otherwise. `translationStatus` is `pending` only when populated provider content needs a missing requested translation, `ready` when an overlay exists, and `none` for canonical readers, inapplicable providers, unpopulated entities, or negative-cache translations.

## Aggregate And Time Series

Root and correlated aggregates support count, count distinct, sum, average, minimum, and maximum. Counts return zero for an empty set; other measures return null. Numeric measures cast safely, count distinct ignores null, and joins retain normal multiplicity.

Ungrouped aggregates return one item without page info. Grouped aggregates require group fields, limit, and ordering by group or measure key. They do not support cursors or arbitrary-expression ordering; JSON groups cannot order. The limit counts unique combinations of all group fields. Results use `{ items, pageInfo: { limit, hasMore } }`.

Time series apply one count, sum, average, minimum, or maximum measure. The time expression is a physical date or explicit date cast; `[startAt, endAt)` is half-open. Hour/day/week/month buckets align in UTC, weeks start Monday, and empty buckets return zero. Multiple measures or series, custom units, and pagination are unsupported.

## Limits

| Boundary                               |      Limit |
| -------------------------------------- | ---------: |
| Named queries per document             |         10 |
| Joins per named query                  |          8 |
| Root rows / include rows               |  100 / 100 |
| Grouped aggregate rows                 |      1,000 |
| Aligned time-series buckets            |      1,000 |
| Include depth / correlated query depth |      3 / 3 |
| Transaction-local statement timeout    | 30 seconds |
