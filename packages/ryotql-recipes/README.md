# RyotQL Recipes

Application recipes keep their result schemas, decoders, and decoded types next to each query.
They build documents through `@ryot-app/ryotql`; consumers use decoded results rather than parsing
generic rows.

Exact domain recipes take an explicit `PluginIdentityReference`. Authored saved views and trusted
sandbox calls may use `self`. Browser contributors supply their prepared local identity binding;
portable ad-hoc requests select a permanent `publisher/name` package ID and explicit `system` or `user` scope.
Definition joins compare both the local name and exact owner, with explicit null equality for kernel
definitions. A missing owner is not a kernel selector.

Generic cross-plugin entity reads and browser results remain broad. They carry each selected entity's
stored owner so presentation dispatch does not use the current workspace's identity. Kernel
collections and memberships are selected with explicit kernel predicates.

`collectionReviewAnalyticsRecipe` in `collection-analytics` owns collection review reporting.
It takes a resolved reporting selection and an optional `bucketLimit`, counts all kernel collection
review events (including rating-only records), and returns `current`, nullable `previous`, and
`buckets` with `{ at, count }` items and aggregate `pageInfo`. Periods use the caller's half-open
instant boundaries; a null current period means all time. Buckets use the selected grouping and
reporting timezone. Totals remain complete when bucket results have `hasMore`; callers must surface
that truncation or choose a coarser grouping. Domain plugins report their own reviews separately.
`collectionReviewRecordsRecipe` reads the contributing kernel review records for a nullable period,
including rating-only records. Its row cursor follows descending occurrence time, creation time, and
event ID. Consumers page these records with SDK pagination; aggregate buckets do not have cursors.

Runtime provider search takes an `EntitySchemaReference`.
Saved-view detail lookups take a tagged `SavedViewReference`; list filters use local plugin IDs, not
display slugs. Plugin catalogs expose permanent package IDs, local IDs, scope, and typed home views.

## Saved-View Recipes

Saved-view documents are authored RyotQL with descriptive field keys; settings name the source,
search, sort, and table-column fields, plus the `subject`: the entity table alias and the entity
schemas the view lists. The entity-browser recipes derive provenance from the subject. The page recipe
appends the entity ID, owner, schema slug, name, `populationStatus`, and `translationStatus` under
unused keys from the subject alias and decodes them into each item; both the page and count recipes
AND an owner-qualified subject-schema predicate into `where`, and the count uses `countDistinct` of the
subject alias ID. Authored sources therefore neither select nor map provenance or sync state, and the
schema constraint holds by construction. Registered entity presentations supply cards.

### Filters

Filters compile against `FilterTarget`s: a `FilterFieldSpec` (key, label, type, choices or link)
plus one or more branches, each an optional schema condition (`when`) with the value expression or
link that applies under it. The kernel owns the operators, fixed per field type in
`filterOperators`. `outputFilterTargets` turns a results table's authored `filterFields` into
targets over projected outputs; `collectionsFilterTarget` is the kernel `collections` relationship
field (kernel `member-of`, outgoing) offered by entity and collection browsers.

### Browse

`browse` turns the subject schemas' browse fields into filter and sort targets.
`entitySchemaBrowseRecipe` loads them for owner-qualified schemas in request order, and
`browseTargets` rebases each `subject` expression onto the host alias, prefixing inner aliases
(`browse{N}_`) clear of the host query. Fields from one plugin with the same key merge: identical
expressions fold into one branch, differing ones are conditioned on the declaring schemas (no
condition when every schema declares it), and link fields keep each schema's own link. The same key
from different plugins becomes `key:pluginId`. Enum choices merge in order.

Each sortable field contributes one structured sort choice with its neutral label, default direction,
and human-readable ascending/descending labels; sort-only fields use the same shape. `compileSort` orders
by the selected field and its `${key}-asc` or `${key}-desc` direction, reading null for entities whose
schema lacks the field (nulls last), then the entity ID as an ascending tiebreaker. `nameSortTarget`
is the generic Name sort.
`entityBrowserControls` and `collectionMemberControls` list the filter fields and sort choices
renderers offer; directions are not separate field choices. The URL sort value remains
`${key}-asc` or `${key}-desc`. The page and count recipes take the same `browse` or member fields, so
search, count, and every page apply the same filter and sort. Without a sort choice, entity browsers
keep the full source query order and collections their manual order.

`compileFilter` turns a nested `Filter` (`and`, `or`, `not`, field rules) into one `Predicate`.
Operands are cast to the kind of their literals so the RyotQL validator accepts them. Relationship
rules compile to correlated `exists` queries on aliases that avoid every source alias, `noneOf`
and list `empty` include missing values, and `withinLastDays` derives its bound from the supplied
`now`. Callers read `now` from the Effect `Clock` when the query runs and key rolling queries by the
filter JSON. Unknown fields, operators outside the field type, and inverted ranges fail. The page,
count, and results-table recipes accept `filter` with `now` and AND the predicate into `where`.

`propertyFilterFields` builds value fields from an `AppSchema` for plugin authors.

Runtime compile, decode, and choices paths take `QueryFilterField`, whose relationship and event
owners are `QueryOwnerReference`s; `queryFilterFields` maps stored fields to it, and
`collectionsFilterField` is the kernel Collections field for plugin screens.

`filters` also owns the URL codec used by the kernel browsers (`decodeFilterParam`,
`encodeFilterParam`, `editableGroup`, `activeRuleCount`, the draft helpers) and
`linkedFilterChoicesRecipe`, which lists linked entities by id and name for a relationship field
(far side) or a `session-event` field (entities the events are logged on), optionally narrowed by
search text or explicit ids. A `session-event` field matches subjects that are the `sessionEntityId`
of events of one event schema; event slugs are unique only per entity schema, so compilation joins the
event's entity and matches the full event identity.
