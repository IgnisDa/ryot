# RyotQL

`@ryot-app/ryotql` authors static query documents and decodes results. Runtime values travel in
execution requests. Structural inputs such as plugin identity and schema references may still be
arguments of an outer recipe factory.

## Authoring

Builders in the package root produce `modules/ryotql/authored` contract types. `defineRecipe`
takes `{ parameters?, controls?, queries, map? }` and returns `{ document, parameters, queries, decode }`.
`Recipe.Success<typeof recipe>` infers decoded results; `Recipe.Arguments<typeof recipe>` infers
caller arguments. Queries are always present; select behavior with predicates and `choice`, rather
than conditionally adding queries.

```ts
import { column, defineRecipe, eq, selectedField, selectedRows, table } from "@ryot-app/ryotql";
import { parameters } from "@ryot-app/ryotql/authoring";
import { Schema } from "effect";

const input = parameters({
  fields: { name: { type: "string", label: "Name", description: "Exact entity name" } },
});
const entity = table("entity", "entity");
export const entities = defineRecipe({
  parameters: input.schema,
  queries: {
    items: selectedRows(entity, {
      limit: 20,
      maxLimit: 100,
      selection: { id: selectedField(column(entity, "id"), Schema.String) },
      where: input.whenSet("name", eq(column(entity, "name"), input.value("name"))),
    }),
  },
});
```

`parameters(schema)` supplies typed `value`, `list`, `whenSet`, `choice`, and `sourceEntity` handles.
`choice` requires every static enum value; runtime validation also rejects extra cases. `value`
accepts scalar fields and `list` accepts list fields. Source handles require a string field with
`reference: { kind: "entity-source" }`. The reference value identifies a saved selection.
`now`, `dateAdd`, `reportingTimeZone`, `filter`, `sort`, and `aggregateSort` live in `/authoring`.
Optional parameters without defaults may be referenced only inside their own `whenSet` predicate.
Only null and omission count as unset; empty strings, zero, false, and empty lists remain set.
Defaults apply to omitted keys through AppSchema. Explicit null is preserved: an unguarded list or
choice needs a concrete list or enum value and fails binding when given null.

Rows and aggregates declare `limit` and `maxLimit`; builder defaults are 20 for both. Includes have
fixed limits. Authored documents cannot carry cursors. Requests carry `pages[query] = { after?,
limit? }`; the binder rejects unknown query names, invalid limits, and paging ungrouped aggregates.

`selectRecipe(recipe, name)` constrains `name` to the recipe's query keys and returns a recipe sharing
its full document and parameter schema. Its `query` identifies the selected inline source query;
its decoder validates only that named result with the original query decoder. Document-level `map`
runs only for full recipes. `Recipe.Queries<typeof recipe>` preserves per-query decoded result types.

## Binding and stored validation

`/binding` exports pure Result-returning functions:

- `validateAuthoredDocument(document)` checks grammar, parameter declarations, guarded uses, exhaustive
  choices, control declarations, and default/maximum limits. It is not catalog or authority validation.
- `bindDocument(document, values, context)` validates arguments, applies defaults and request controls,
  binds placeholders and pages, then strictly decodes an executable `language.RyotQLDocument`. It
  returns `{ document, arguments }`; the latter contains the normalized, defaulted arguments.
- `authoredValidationBranches(document, context)` produces executable projections of every reachable
  `choice` case and both `whenSet` outcomes. Repeated uses of a parameter select consistent cases.
  `maximumBranches` is a required caller-owned resource budget; exceeding it rejects the write.
  Parameter samples represent declared kinds, not business-valid example arguments. Lists contain
  a sample element so their element kind is visible. Literal JSON remains opaque.
- `cursorBindingKey({ sourceIdentity, ownerIdentity, arguments, filter?, sort? })` canonicalizes cursor
  identity. Supply a source identity containing its immutable document hash/revision and selected
  query. Use the bound arguments, preserve array order, and sign/check this key in the backend cursor
  codec. This helper neither signs cursors nor authorizes requests. Clock/context values and paging
  positions do not enter the identity, preserving stable rolling-query selections.

Binding requires an injected execution `Date` and reporting time zone. `now` and date/datetime
arguments (including date-list elements and write-time samples) become explicit date casts so
backend kind validation sees their declared date kind. Static enum time-zone choices are checked
as named zones; unconstrained string zones still require runtime semantic validation. Catalog-dependent filter/sort
callbacks run per named query; the backend resolves their targets and calls `/filters.compileFilter`
and `/sort.compileSort`. Returned expressions are bound too. Resolve controls inside the execution
transaction using the caller's effective definitions. Resolve only applicable query targets and reject
ambiguous output-field mappings. Saved-view derived count/ID queries reuse targets resolved from the
original source selection, before changing its output.

`resolveSourceEntity(reference, alias)` returns an executable table reference with the same alias.
The backend owns loading, authority, cycle detection and materialization of that saved selection.
Collections preserve member order; saved-view sources use the saved arguments/filter/sort rather
than the outer request's transient controls. The virtual source exposes only `entityId` and `rank`.
Write-time `sourceEntity(parameter, alias)` returns a catalog validation table with those columns,
without inventing a user source or attempting to load a sample reference.

All placeholders disappear during binding. `dateAdd` remains a concrete executable scalar operation
with a numeric amount and static unit; it supports row-dependent dates. Backend semantic validation
requires a date operand. SQL lowering uses UTC calendar arithmetic for month/year and elapsed
duration arithmetic for hour/day/week. The planner and executor never receive parameter, control,
choice, clock, context or source placeholders.

Backend stored writes run semantic/access validation on **every** validation projection, including
non-default choices and optional branches. Validation covers table/column access, alias scope,
correlation, aggregate/group/order rules, include bounds, result budgets, and renderer constraints.
Entity browsers enforce subject alias/schema checks, unique layouts and subjects, provider-action
membership, projected scalar setting references, renderer availability/settings validation, and
kernel-only view restrictions. Authored grammar cannot express a cursor.

Browse/output control targets and sort/filter alternatives are validated independently; validation
projections substitute an empty filter and the sort fallback. Saved-view arguments are bound and
validated before persistence. Runtime binding, identity binding and source resolution are followed
by semantic/access validation again.

## Execution boundary

HTTP execution, sandbox host calls, and iframe bridge execution use `ExecutionRequest` from
`modules/ryotql/request`; describe takes its source and optional arguments. SDK recipe helpers send
static authored documents with request arguments and controls. Saved views and declared plugin queries
execute by reference. Page execution sources return `source-unavailable`.

The backend loads and authorizes sources, resolves controls and saved entity selections, binds
arguments and execution context, validates executable queries, and signs cursor identities inside the
execution transaction. Import authored types when building or storing queries and executable
`language` types after binding. Generic AppSchema definition validation lives in
`contract/schema/app-schema-definition`; parameters use its explicit parameter-reference policy.

`ExecutionSource.inline` may select `query` while retaining the full authored document for control
resolution. Output control targets may name a rows `query`; a flat nonempty `composite.targets`
combines browse and output targets. The backend validates actual table bindings, duplicate field keys
and sort IDs before using a projection in another query. Describe accepts optional arguments for
source-dependent membership metadata. Source references use the shared `EntitySourceReference`
tagged JSON codec; collection queries keep the encoded source argument distinct from raw entity IDs.

Authored `mapScalarExpression`, `mapPluginIdentityReferences`, `scalarExpressionTables` and
`documentTables` share one traversal. Table discovery visits every authored branch and uses
`sourceEntity` as a distinct unresolved-source marker. Executable language helpers remain separate.
Standalone browse and calendar/signal row-source declarations cannot borrow the caller's parameter
or control declarations. The backend binds their supported clock/context expressions before semantic
validation and preserves mandatory kernel-composed windows.
