# RyotQL

RyotQL is the only read surface for persisted rows. `POST /ryotql/execute` and `POST /ryotql/plugin/execute` are the authenticated user APIs for the kernel and plugin audiences; `POST /instance-admin/ryotql/execute` is the admin API. Only non-row data (streams, file bytes, workflow job results, process state, health, and public config) stays on dedicated HTTP endpoints.

## Document And Result Shape

A document has a non-empty `queries` record. Each named query has `from: { table, alias }`, optional `joins` and `where`, and one `rows` or `aggregate` output.

```json
{
  "queries": {
    "entities": {
      "from": { "table": "entity", "alias": "entity" },
      "output": {
        "type": "rows",
        "fields": [],
        "orderBy": [],
        "pagination": { "limit": 20, "maxLimit": 100 }
      }
    }
  }
}
```

Requests are `{ source, arguments?, filter?, sort?, pages? }`. Sources are inline authored documents
(with an optional named `query`), an owned saved-view reference and query name, or a declared plugin
query identified by scoped package ID and declaration name, or an owned page ID and named published
query. A plugin declaration executes its whole named document. Page sources load the published
definition through `PageAuthoringRepository`, never the authoring service, and include the published
revision and definition hash in cursor identity. Draft-only pages and undeclared query names fail
with `source-unavailable`. A `page-preview` source additionally carries `draftRevision`,
`definitionHash` and `artifactHash` from the compile result. It resolves the current compiled draft
only when every fence and `draftCompiledRevision` matches, and uses the existing read-only execution
path. The frame host binds the preview identity and prevents operations. Page code supplies per-call values; page sources have no stored selection.

Source loading, account reporting-zone lookup, controls, source entities, binding, semantic/access
validation, identity binding and execution share a repeatable-read, read-only transaction. Inline named
selection keeps the full document available for explicit control projections without executing other
queries. The pure binder receives the Effect clock; the planner receives only executable language.
The response is `{ data: { [queryName]: result } }`. Queries run sequentially in declaration order;
any failure fails the request, with no partial results.

`/ryotql/describe`, `/ryotql/plugin/describe` and `/instance-admin/ryotql/describe` take
`{ source, arguments? }` and return parameter schemas, resolved filter fields and sort choices.
Collection membership metadata requires source arguments so its schema can be loaded under authority.

Controls may target browse schemas, an explicit named rows projection (`outputs.query`), or a flat,
nonempty composite of those targets. Projection aliases must bind the same actual tables in each
consuming query. Duplicate keys and sort IDs are refused. Browse subjects gain the platform Collections
filter and name sort once. Membership output fields use `membership.<property>` and are checked
against the source collection's persisted schema and its independently bound membership target ID.

An `entity-source` string is encoded exclusively by `EntitySourceReference` in
`@ryot-app/contract/modules/ryotql/entity-source`: tagged JSON for a collection ID or saved-view
reference. Raw IDs are not source references. Source materialization reads the owner's collection
order or the saved view's stored arguments/filter/sort, with cycle detection, depth 16, at most 64
source resolutions and 10,000 total materialized subjects. Only `entityId` and `rank` are exposed.
Collection order revisions and recursive source identities participate in cursor identity.

Cursors are HMAC-signed with a domain-separated payload. Their fence includes source identity and
selected name, owner/scope, normalized arguments, filter and sort, and the unbound resolved
control expressions of the effective targets used by the selection. Retained user-subject execution
overlays its executing plugin’s pinned control schemas while foreign definitions remain current. Page positions and the executing
clock do not enter the fence, so rolling queries retain stable cursor selections. Responses include
`execution: { now, timeZone }`, the server epoch milliseconds and reporting zone used for binding,
including empty results and continuation pages. Concrete `dateAdd`
uses elapsed hours/days/weeks and UTC calendar months/years; it does not perform zone-aware calendar
addition across DST.

Stored validation projects every choice and optional branch under a 256-branch budget and checks
control targets independently, including filter and sort alternatives. Each alternative validates only
its compiled predicate, ordering, or value expression against the already-bound branch query. Standalone browse and row-source
declarations have no caller parameters or controls; undeclared placeholders are refused. Their clock
and reporting-zone expressions bind only after authoritative context is supplied. Calendar and signal
row-source ordering and bounded windows remain kernel-owned.

Rows select `{ key, expr }` fields or `{ type: "wildcard", tableAlias }`. A wildcard expands only the approved fields for that alias; hidden physical and authorization columns remain inaccessible. Duplicate output keys fail validation.

| Output      | Required shape                                                                 | Result                                                              |
| ----------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `rows`      | `fields`, `orderBy`, `pagination: { limit, maxLimit }`, optional `include`     | `{ type: "rows", items, pageInfo: { limit, hasMore, nextCursor } }` |
| `aggregate` | Non-empty `measures`; optional `groupBy` and `orderBy`, default/maximum limits | `{ type: "aggregate", items, pageInfo? }`                           |

## Scopes And Visibility

A document cannot provide a user ID, plugin identity, execution scope, or grant. Authorization applies independently to every root, join, include, and correlated query before caller predicates. Visibility is default-deny: a table is readable only in scopes it declares, and restricted fields fail validation as unknown fields and are omitted from wildcards.

| Scope          | Callers                                                                                           | Reads                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| User, `kernel` | Kernel UI, API keys, and OAuth through `/ryotql/execute`                                          | Tables with a user policy, except `admin` fields                                                     |
| User, `plugin` | Client-plugin iframes through `/ryotql/plugin/execute`, user-subject sandbox scripts, saved views | Plugin-readable tables only, except `kernel` and `admin` fields                                      |
| Admin          | `/instance-admin/ryotql/execute`                                                                  | Tables with an admin policy and all their fields; entity text is canonical                           |
| System plugin  | Pinned system-scope scripts with `executeRyotql`                                                  | Global entities whose schema the plugin owns, plus events and relationships whose definition it owns |
| Publication    | Anonymous [publication](../publications/README.md) visitors                                       | The publication's subject entities and the links between them; never owner identity                  |

The publication scope receives the subject set computed from the publication's source as a
`publication_subject` CTE. Entities are visible only when they are subjects, and expose
`publicationRank`, their 1-based position in the scope's order. Relationships are visible only between
two subjects, and only when global or the owner's kernel `member-of` memberships. Events are readable
but always empty. Definitions are the owner's effective kernel and system-plugin definitions, and
plugins are system plugins only. `entity.userId` and the relationship `userId`, `projection`, and
`projectionStatus` fields are hidden. Every other table is denied.

System-plugin ownership checks use the exact local plugin ID and pinned declarations, including the containing entity schema for events. Definition queries use the caller's pinned own revision. Trusted user-subject definition contexts also replace only the caller's own definitions with that pin; foreign definitions use their current effective revision.

| Table                                                                                                      | User visibility                            | Plugin | Admin | Restricted fields                                                      |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------ | :----: | :---: | ---------------------------------------------------------------------- |
| `entity`                                                                                                   | Owned and global                           |  yes   |  no   | —                                                                      |
| `relationship`                                                                                             | Owned and global                           |  yes   |  yes  | —                                                                      |
| `event`, `savedView`, `notificationChannel`, `importRun`                                                   | Owned                                      |  yes   |  no   | —                                                                      |
| `importIssue`                                                                                              | Through the owned import run               |  yes   |  no   | —                                                                      |
| `plugin`                                                                                                   | Owned and system packages                  |  yes   |  yes  | admin: `environmentConfigRevisionId`                                   |
| `pluginInstallation`                                                                                       | Owned, not uninstalled                     |  yes   |  yes  | kernel: `config`, `configuredSecrets`; admin: `activeConfigRevisionId` |
| `integration`                                                                                              | Owned                                      |  yes   |  no   | kernel: `providerSpecifics`, `webhookToken`                            |
| `notificationSubscription`                                                                                 | Owned                                      |  yes   |  yes  | admin: `userId`                                                        |
| `entitySchema`, `eventSchema`, `relationshipSchema`, `signalSchema`, `calendarSource`                      | Effective definitions of the user          |  yes   |  no   | —                                                                      |
| `sandboxProvider`, `sandboxProviderOperation`                                                              | Providers of the user's executable plugins |  yes   |  no   | —                                                                      |
| `user`                                                                                                     | Self                                       |   no   |  yes  | admin: `disabledAt`, `twoFactorEnabled`, `authState`                   |
| `oauthConnection`                                                                                          | Owned                                      |   no   |  no   | Only `id` and effective `status`; denied to demo credentials           |
| `backupRun`                                                                                                | Owned                                      |   no   |  no   | —                                                                      |
| `publication`, `publicationLink`                                                                           | Owned, directly or through publication     |   no   |  no   | Link secrets are stored only as hashes and are never fields            |
| `notification`, `notificationDelivery`                                                                     | Owned, directly or through notification    |   no   |  no   | No source identity, account token, credentials or raw diagnostics      |
| `importSource`, `integrationProvider`                                                                      | Of the user's executable plugins           |   no   |  no   | —                                                                      |
| `entityTranslation`, `sandboxScript`, `userLifecycleOperation`, `migrationReport`, `migrationReportDetail` | —                                          |   no   |  yes  | —                                                                      |

`catalog.ts` lists each table's fields. Sandbox script bodies are never fields, including for admin readers. Artifact keys, raw or decrypted configuration and integration settings, and the script and configuration pins of executable definitions are never fields; configuration and integration settings are read through their write-time redacted projections.

`sandboxProviderOperation` reads a user-scoped view of the active manifest and its matching provider scripts. Operations have no separate persisted identity or timestamps.

## Expressions And Predicates

Expression kinds are text, date, number, boolean, JSON, and null. Kind inference is shared by validation and compilation; unknown aliases or fields are validation errors.

Scalar expressions include columns, JSON literals, `jsonPath`, casts, `coalesce`, `concat`, conditionals, `kebabCase`/`titleCase` transforms, `floor`, `round`, integer conversion, null checks, arithmetic, `dateBucket`, `localHour`, `localDate`, `currentDate`, and correlated `exists`, `first`, or aggregate queries. Correlated aliases are lexical: ancestors are visible, siblings and forward joins are not. `first` requires ordering and receives primary-key tie breakers. A cast evaluates its operand once, so casting a correlated value does not repeat its query.

`pluginId` selects an exact local owner as text through a typed `self`, `local`, or scoped `package` reference. Binding uses one persisted identity catalog inside the execution transaction. User identities include ready hidden installations, but not quarantined, uninstalled, or another user's private installations. This does not change definition visibility or execution authority. `self` requires a trusted plugin context; admin queries cannot select a user-scoped package. Unresolved references return `unresolved-query-owner`, never SQL null or kernel ownership. Ordinary JSON literals are unchanged. Cursors include the resolved owner identity.

Predicates include `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `contains`, `startsWith`, `in`, `isNull`, `isNotNull`, `and`, `or`, `not`, and `exists`. Null comparisons are false before `not`; empty `and` is true, while empty `or` and `in` are false. Text uses deterministic C collation. `contains` is escaped case-insensitive substring matching for text and structural containment for JSON. `startsWith` is the matching escaped case-insensitive prefix test and accepts only text operands. JSON equality is structural.

`jsonPath` traverses public JSON object keys or array indexes. Missing paths and JSON null produce null. It does not consult property definitions. Casts to text, number, boolean, date, or JSON return null for incompatible, malformed, or out-of-range values instead of failing SQL. Arithmetic uses safe numeric values; invalid operands and division by zero return null.

JSON arrays use `jsonElement` plus the `jsonExists`, `jsonFirst`, and `jsonCount` operators. `jsonElement` denotes the current array item and is valid only inside one of those operators. `jsonExists` tests whether any item matches an optional predicate, `jsonFirst` projects the first matching item under an explicit ordering, and `jsonCount` counts matching items. Element expressions reuse the scalar language (`jsonPath`, casts, comparisons, outer table columns) and stay visible inside nested correlated queries. A missing, null, or non-array value behaves as an empty set: `jsonExists` is false, `jsonFirst` is null, and `jsonCount` is zero. `jsonFirst` results carry the selected kind, so a date projection such as the next scheduled `startsAt` is a first-class filter, order key, and cursor value. Element nesting must not exceed 3.

A `jsonElements` join (`{ type: "jsonElements", mode, alias, expr }`) instead emits one row per item of a JSON array. `expr` must be a JSON expression over aliases already in scope and is field-checked with the same audience and credential rules as any other expression. The alias exposes only `value` (the item, null for a JSON null) and `ordinal` (its 1-based position), wildcards included. With `mode: "inner"`, an empty, missing, null, object, or scalar value yields no rows, so the parent row drops out, including when `expr` reads a left-joined table that matched nothing. With `mode: "left"`, such a parent appears once with `value` and `ordinal` null; non-empty arrays behave as in `inner`. These joins count toward the join limit and are allowed in roots, includes, and correlated queries.

`dateBucket` accepts hour, day, week, month, or year plus an IANA zone and returns the local boundary as an ISO UTC instant; weeks start Monday and daylight-saving offsets are respected. `localHour` accepts a date expression and IANA zone and returns the local hour from 0 through 23, so repeated DST hours share one hourly category. `localDate` returns the local calendar date as `YYYY-MM-DD` text, null for a null date. RyotQL does not infer source precision, so callers pass date-only values explicitly. Invalid zones and non-date inputs fail validation.

`currentDate` takes no operands and returns the server's current UTC day as a date at UTC midnight, the same shape as `castDate` of a date-only string, so `castDate(publishDate) <= currentDate()` is a plain date comparison. It is evaluated once per statement.

## Joins, Includes, And Pagination

Inner and left joins support any visible catalog tables and normal SQL multiplicity. A join may refer to its new alias and aliases already in scope. Caller aliases never reach SQL; every table and element alias compiles to a generated name. Authorization is inside each table occurrence, so an invisible right row in a left join becomes null without removing the left row.

Includes are correlated row queries with their own root, optional joins/predicate, fields, non-empty order, explicit limit, and optional nested includes. They return `{ items, pageInfo: { limit, hasMore } }`; no match returns an empty list. Sibling aliases are isolated.

Root rows use `{ limit, after? }` and return `{ items, pageInfo: { limit, hasMore, nextCursor } }`. Pagination is forward-only and cursors are opaque and validated. The backend fetches `limit + 1`, returns at most `limit`, and emits a cursor only when another row exists. Primary-key tie breakers, followed by the `ordinal` of each of the query's own `jsonElements` joins, and `NULLS LAST` make multiplied rows deterministic in roots, includes, and `first`. SDK-built roots default to 20 and primary-key ascending order. Persisted saved-view documents must omit cursors.

Collection-backed selections carry their current `sourceRevisions` in page info and signed cursors.
Cursor identity fences the source definition, bound arguments, controls, and authority independently
of these revisions. After signature and identity validation, an older source revision returns an
empty page with `stale: true` and the current revisions. Malformed or incompatible cursors still fail
with `invalid-cursor`.

## Derived Fields

For users with a non-canonical language, entity `name` falls back to canonical text and translated `properties` overlay canonical keys. Selection, filtering, ordering, and JSON paths see the same resolved values.

`populationStatus`, `relatedPopulationStatus`, and `translationStatus` are objects with `{ availability, state }`. `availability` is `missing`, `partial`, `complete`, or `none` and describes entity data. `state` is `idle`, `queued`, `running`, `retrying`, `succeeded`, `failed`, or `cancelled` and describes the latest applicable request. Availability is shared entity state; request activity is scoped to the requester. Translation activity also matches the requested language and canonical content generation. Missing data alone does not imply a running request.

Population availability is `complete` when the root population stamp exists, `partial` when provider properties exist without that stamp, `missing` when provider content is absent, and `none` without provider or external ID. Related availability is `complete` after the full related population finishes, `partial` while related data exists before that completion, `missing` when related provider data is absent, and `none` without provider or external ID. Translation availability is `missing` when applicable populated content has no current overlay, `complete` when translated content exists, and `none` for canonical readers, inapplicable providers, unpopulated entities, or a successful empty negative-cache result. A successful empty result has request state `succeeded`, distinct from `failed`. Failure codes and timestamps are not catalog fields.

Canonical `contentGeneration` advances only when entity `name` or canonical `properties` change. Translation work pins that generation; an overlay records `sourceContentGeneration`, and commit rejects an overlay if the entity has since changed. Thus a stale translation cannot replace one for newer canonical content.

`plugin` revision fields (`name`, `icon`, `description`, `version`, `contentHash`, `ingestedAt`, `clientApiVersion`, `configSchema`) come from the active revision and are null without one. `savedView.packageId` and `integration.packageId` derive from the exact installation.

`event.projectionStatus` and `eventStream.projectionStatus` use the same freshness gate; the stream field reports one status per stream, so a reader can detect pending or failed processing without visiting every event.

Catalog tables read relations that `DefinitionCatalog` resolves for the statement's user and prefixes as common table expressions. `savedView` reads from `user_saved_view_effective`, combining custom user rows with listed built-in definitions and optional per-user order and visibility overrides. A definition change is visible without copying it into each account.

`calendarSource` reads from `user_calendar_source_effective`: the active revision's calendar sources of the user's effective installations, keyed by `pluginId` and `slug`, with `isHidden` from the user's per-source override. It has no `id`, so queries order by explicit fields.

`pluginInstallation.homeSavedView` is the effective tagged custom, kernel, or plugin view reference: the selected view when usable, otherwise the exact installation owner's built-in view named by the active manifest's `client.homeView` when usable, otherwise null. A usable view is enabled and uses a kernel renderer or a `page` export of a ready and enabled plugin of the same user.

`importSource.missingPluginConfigKeys` lists required keys absent from the exact configuration revision, using `RYOT_PLUGIN_*` names for system plugins and config field names for private plugins. `isStartable` requires a workflow script and no missing unconditional keys. Both catalogs expose secret-free `readinessMetadata`; their recipes evaluate unconditional picker requirements or the supplied selected settings with the shared ingestion readiness evaluator. Integration readiness also uses owned, connected, unexpired account projections. `integrationProvider.hasScript` is true for push providers or when the provider script exists.

`user.authState` is `credential`, `oidc`, `mixed`, or `none` from linked accounts, and `migrationReport.totalDetails` is null for uncoded rows and otherwise the stored count or zero.

`user.twoFactorStatus` is a kernel-only, non-demo `{ enabled, available }` projection. `enabled` normalizes the stored flag to a boolean; `available` requires a linked credential account. `oauthConnection.status` reports `expired` when its expiry has elapsed at statement time unless the stored status is `failed`. Null expiry preserves the stored status. OAuth credentials, codes, verifiers, hashes, and refresh leases are not catalog fields.

## Aggregates

Root and correlated aggregates support count, count distinct, sum, average, minimum, and maximum. Counts return zero for an empty set; other measures return null. Sum and average cast safely to numbers, minimum and maximum preserve the operand kind (so `maximum(date)` is a date), count distinct ignores null, and joins retain normal multiplicity.

Ungrouped aggregates return one item without page info and accept no cursor. Grouped aggregates require group fields, limit, and ordering by group or measure key; they do not support arbitrary-expression ordering, and JSON groups cannot order. The limit counts unique combinations of all group fields. Group keys not already ordered break ties in ascending order, so pages page forward with an optional opaque `after` cursor when every group is scalar. Results use `{ items, pageInfo: { limit, hasMore, nextCursor } }`; `nextCursor` is null unless another page exists and every group can order.

## Compilation

`planner.ts` turns each validated named query into an immutable plan before any SQL is emitted; `executor.ts` only reads that plan. A plan scope exists for the root, every include, and every correlated query. It records each alias's generated SQL name and the catalog fields referenced anywhere in its subtree, so catalog sources add derived columns (such as event projections) only when needed.

Correlated aggregates with an identical query set in the same scope are fused into one `CROSS JOIN LATERAL` that computes all their measures once per outer row; selections, ordering, and cursor predicates reference its columns. Aggregates inside join conditions or JSON element operators stay scalar subqueries.

A lateral aggregate runs once per row before PostgreSQL can filter, sort, or limit. When neither the filter nor the order reads one, a rows query first picks the page's root rows in a `ryotqlPage` CTE without it, and the full query runs over only those rows.

Inside a fused aggregate with only inner table joins, a reference is hoisted into a materialized CTE evaluated once per statement when its own predicates form a closed date range, or when it does not depend on the outer row and joins another reference on typed JSON casts of its columns. The CTE applies those local predicates and precomputes the cast keys.

A rows query whose root `entity` filters `occursAt` on both sides runs with the written join order, set for that statement. Postgres badly underestimates joins through library memberships and would otherwise start there and visit every row the date range rules out, so such a query should list its joins outward from the dated entity.

Catalog sources return their `from` fragment plus named CTEs; the executor owns CTE names, merges them for the whole statement, and emits one `WITH` clause. A cast of a JSON object path to text, number, or boolean is one silent `jsonb_path_query_first` call, and a cast of a subquery operand evaluates the subquery once.

## Limits

| Boundary                               |      Limit |
| -------------------------------------- | ---------: |
| Named queries per document             |         10 |
| Joins per named query                  |          8 |
| Root rows / include rows               |  100 / 100 |
| Grouped aggregate rows                 |      1,000 |
| Include depth / correlated query depth |      3 / 3 |
| Transaction-local statement timeout    | 30 seconds |

Each read transaction also turns JIT off locally. Generated statements are large enough that compiling them costs far more than it saves, and the compiled code can exhaust a memory-limited PostgreSQL.
