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

Entity-browser and results-table settings may declare `filterFields`: typed value fields that name a
projected output field, and relationship or session-event fields (entity and collection browsers only). The kernel
owns the operators, fixed per field type in `filterOperators`. `effectiveFilterFields` adds the
reserved kernel `collections` relationship field (kernel `member-of`, outgoing) to entity and
collection browsers; results tables get authored fields only.

`compileFilter` turns a nested `Filter` (`and`, `or`, `not`, field rules) into one `Predicate`.
Operands are cast to the kind of their literals so the RyotQL validator accepts them. Relationship
rules compile to correlated `exists` queries on aliases that avoid every source alias, `noneOf`
and list `empty` include missing values, and `withinLastDays` derives its bound from the supplied
`now`. Callers read `now` from the Effect `Clock` when the query runs and key rolling queries by the
filter JSON. Unknown fields, operators outside the field type, and inverted ranges fail. The page,
count, and results-table recipes accept `filter` with `now` and AND the predicate into `where`.

`propertyFilterFields` builds value fields from an `AppSchema` for plugin authors.

Runtime compile, decode, and choices paths take `QueryFilterField`, whose relationship and event
owners are `QueryOwnerReference`s; `effectiveFilterFields` maps a view's stored fields to it, and
`collectionsFilterField` is the kernel Collections field for plugin screens.

`filters` also owns the URL codec used by the kernel browsers (`decodeFilterParam`,
`encodeFilterParam`, `editableGroup`, `activeRuleCount`, the draft helpers) and
`linkedFilterChoicesRecipe`, which lists linked entities by id and name for a relationship field
(far side) or a `session-event` field (entities the events are logged on), optionally narrowed by
search text or explicit ids. A `session-event` field matches subjects that are the `sessionEntityId`
of events of one event schema; event slugs are unique only per entity schema, so compilation joins the
event's entity and matches the full event identity.
