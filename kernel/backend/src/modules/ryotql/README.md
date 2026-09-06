# RyotQL

RyotQL is the only read surface for persisted rows. `POST /ryotql/execute` and `POST /ryotql/plugin/execute` are the authenticated user APIs for the kernel and plugin audiences; `POST /god-mode/ryotql/execute` is the admin API. Only non-row data (streams, file bytes, workflow job results, process state, health, and public config) stays on dedicated HTTP endpoints.

## Document And Result Shape

A document has a non-empty `queries` record. Each named query has `from: { table, alias }`, optional `joins` and `where`, and one `rows`, `aggregate`, or `timeSeries` output.

```json
{
	"queries": {
		"entities": {
			"from": { "table": "entity", "alias": "entity" },
			"output": { "type": "rows", "fields": [], "orderBy": [], "pagination": { "limit": 20 } }
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

## Scopes And Visibility

A document cannot provide a user ID, plugin slug, execution scope, or grant. Authorization applies independently to every root, join, include, and correlated query before caller predicates. Visibility is default-deny: a table is readable only in scopes it declares, and restricted fields fail validation as unknown fields and are omitted from wildcards.

| Scope          | Callers                                                                                           | Reads                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| User, `kernel` | Kernel UI, API keys, and OAuth through `/ryotql/execute`                                          | Tables with a user policy, except `admin` fields                                                     |
| User, `plugin` | Client-plugin iframes through `/ryotql/plugin/execute`, user-subject sandbox scripts, saved views | Plugin-readable tables only, except `kernel` and `admin` fields                                      |
| Admin          | `/god-mode/ryotql/execute`                                                                        | Tables with an admin policy and all their fields; entity text is canonical                           |
| System plugin  | Pinned system-scope scripts with `executeRyotql`                                                  | Global entities whose schema the plugin owns, plus events and relationships whose definition it owns |

| Table                                                                                                                                    | User visibility                            | Plugin | Admin | Restricted fields                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | :----: | :---: | --------------------------------------------------------------------- |
| `entity`                                                                                                                                 | Owned and global                           |  yes   |  no   | —                                                                     |
| `relationship`                                                                                                                           | Owned and global                           |  yes   |  yes  | —                                                                     |
| `event`, `savedView`, `notificationChannel`, `importRun`                                                                                 | Owned                                      |  yes   |  no   | —                                                                     |
| `importRunFailure`                                                                                                                       | Through the owned import run               |  yes   |  no   | —                                                                     |
| `plugin`                                                                                                                                 | Owned and system packages                  |  yes   |  yes  | admin: `environmentConfigRevisionId`                                  |
| `pluginInstallation`                                                                                                                     | Owned, not uninstalled                     |  yes   |  yes  | kernel: `config`, `configuredSecrets`                                 |
| `integration`                                                                                                                            | Owned                                      |  yes   |  no   | kernel: `providerSpecifics`, `webhookToken`                           |
| `notificationSubscription`                                                                                                               | Owned                                      |  yes   |  yes  | admin: `userId`                                                       |
| `entitySchema`, `eventSchema`, `relationshipSchema`, `signalSchema`                                                                      | Effective definitions of the user          |  yes   |  no   | —                                                                     |
| `sandboxProvider`, `sandboxProviderOperation`                                                                                            | Providers of the user's executable plugins |  yes   |  no   | —                                                                     |
| `user`                                                                                                                                   | Self                                       |   no   |  yes  | admin: `disabledAt`, `twoFactorEnabled`, `authState`                  |
| `backupRun`                                                                                                                              | Owned                                      |   no   |  no   | —                                                                     |
| `importSource`, `integrationProvider`                                                                                                    | Of the user's executable plugins           |   no   |  no   | —                                                                     |
| `automationRun`                                                                                                                          | Executed for the user                      |   no   |  yes  | admin: script pin, retry policy, and config revision                  |
| `automationTrigger`, `automationRunAttempt`                                                                                              | Through a run executed for the user        |   no   |  yes  | admin: raw payload, causation, `logs`, `error`, `workflowExecutionId` |
| `automationTriggerRecipient`, `entityTranslation`, `sandboxScript`, `userLifecycleOperation`, `migrationReport`, `migrationReportDetail` | —                                          |   no   |  yes  | —                                                                     |

`catalog.ts` lists each table's fields. Sandbox script bodies are never fields, including for admin readers. Artifact keys, raw or decrypted configuration and integration settings, and the script and configuration pins of executable definitions are never fields; configuration and integration settings are read through their write-time redacted projections.

## Expressions And Predicates

Expression kinds are text, date, number, boolean, JSON, and null. Kind inference is shared by validation and compilation; unknown aliases or fields are validation errors.

Scalar expressions include columns, JSON literals, `jsonPath`, casts, `coalesce`, `concat`, conditionals, `kebabCase`/`titleCase` transforms, `floor`, `round`, integer conversion, null checks, arithmetic, `dateBucket`, `currentDate`, and correlated `exists`, `first`, or aggregate queries. Correlated aliases are lexical: ancestors are visible, siblings and forward joins are not. `first` requires ordering and receives primary-key tie breakers.

Predicates include `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `contains`, `in`, `isNull`, `isNotNull`, `and`, `or`, `not`, and `exists`. Null comparisons are false before `not`; empty `and` is true, while empty `or` and `in` are false. Text uses deterministic C collation. `contains` is escaped case-insensitive substring matching for text and structural containment for JSON; JSON equality is structural.

`jsonPath` traverses public JSON object keys or array indexes. Missing paths and JSON null produce null. It does not consult property definitions. Casts to text, number, boolean, date, or JSON return null for incompatible, malformed, or out-of-range values instead of failing SQL. Arithmetic uses safe numeric values; invalid operands and division by zero return null.

JSON arrays use `jsonElement` plus the `jsonExists`, `jsonFirst`, and `jsonCount` operators. `jsonElement` denotes the current array item and is valid only inside one of those operators. `jsonExists` tests whether any item matches an optional predicate, `jsonFirst` projects the first matching item under an explicit ordering, and `jsonCount` counts matching items. Element expressions reuse the scalar language (`jsonPath`, casts, comparisons, outer table columns) and stay visible inside nested correlated queries. A missing, null, or non-array value behaves as an empty set: `jsonExists` is false, `jsonFirst` is null, and `jsonCount` is zero. `jsonFirst` results carry the selected kind, so a date projection such as the next anime `airingAt` is a first-class filter, order key, and cursor value. Element nesting must not exceed 3.

`dateBucket` accepts hour, day, week, or month plus an IANA zone and returns the local boundary as an ISO UTC instant; weeks start Monday and daylight-saving offsets are respected. Invalid zones and non-date inputs fail validation.

`currentDate` takes no operands and returns the server's current UTC day as a date at UTC midnight, the same shape as `castDate` of a date-only string, so `castDate(publishDate) <= currentDate()` is a plain date comparison. It is evaluated once per statement.

## Joins, Includes, And Pagination

Inner and left joins support any visible catalog tables and normal SQL multiplicity. A join may refer to its new alias and aliases already in scope. Authorization is inside each table occurrence, so an invisible right row in a left join becomes null without removing the left row.

Includes are correlated row queries with their own root, optional joins/predicate, fields, non-empty order, explicit limit, and optional nested includes. They return `{ items, pageInfo: { limit, hasMore } }`; no match returns an empty list. Sibling aliases are isolated.

Root rows use `{ limit, after? }` and return `{ items, pageInfo: { limit, hasMore, nextCursor } }`. Pagination is forward-only and cursors are opaque and validated. The backend fetches `limit + 1`, returns at most `limit`, and emits a cursor only when another row exists. Primary-key tie breakers and `NULLS LAST` make multiplied rows deterministic. SDK-built roots default to 20 and primary-key ascending order. Persisted saved-view documents must omit cursors.

## Derived Fields

For users with a non-canonical language, entity `name` falls back to canonical text and translated `properties` overlay canonical keys. Selection, filtering, ordering, and JSON paths see the same resolved values.

`populationStatus` is `ready` when `populatedAt` exists, `none` without provider or external ID, and `pending` otherwise. `translationStatus` is `pending` only when populated provider content needs a missing requested translation, `ready` when an overlay exists, and `none` for canonical readers, inapplicable providers, unpopulated entities, or negative-cache translations.

`plugin` revision fields (`name`, `icon`, `description`, `version`, `sourceHash`, `ingestedAt`, `clientApiVersion`, `configSchema`) come from the active revision and are null without one. `savedView.pluginSlug` and `integration.pluginSlug` derive from the exact installation.

`pluginInstallation.homeSavedViewId` is the effective home view: the selected view when usable, otherwise the installation's built-in view named by the active manifest's `client.homeView` when usable, otherwise null. A usable view is enabled and uses a kernel renderer or a `page` export of a ready and enabled plugin of the same user.

`importSource.missingPluginConfigKeys` lists, for system plugins, the `RYOT_PLUGIN_*` variables of required keys absent from the resolved environment configuration, and for private plugins every required key only while the installation has no configuration. `isStartable` requires a workflow script and no missing keys. `integrationProvider.hasScript` is true for push providers or when the provider script exists.

`automationRun.retryEligibility` is `{ reason }` with the retry command's rule evaluated at statement time: `before-policy`, `not-failed`, `expired`, `missing-artifact`, or null when retryable. `user.authState` is `credential`, `oidc`, `mixed`, or `none` from linked accounts, and `migrationReport.totalDetails` is null for uncoded rows and otherwise the stored count or zero.

## Aggregate And Time Series

Root and correlated aggregates support count, count distinct, sum, average, minimum, and maximum. Counts return zero for an empty set; other measures return null. Sum and average cast safely to numbers, minimum and maximum preserve the operand kind (so `maximum(date)` is a date), count distinct ignores null, and joins retain normal multiplicity. Time-series measures stay numeric.

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
