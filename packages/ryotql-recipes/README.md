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

## Static recipes and execution

Recipes declare parameters once with `parameters(schema)` and pass their schema to
`defineRecipe({ parameters, controls, queries, map? })`. Runtime IDs, search text, reporting selections,
and windows are arguments to `client.data.query(recipe, arguments, { pages, filter, sort })`.
Structural factories accept identity, schemas, or source declarations. Clients never bind documents.
See [the foundation API](../ryotql/README.md) for authored grammar and server binding.

## Saved views and controls

Saved-view renderers execute named queries by saved-view reference and request controls through
`client.data.describe(source)`. Settings identify control parameter names; search predicates and sort
expressions live in the static document. Backend derivation injects the reserved provenance fields
from `contract/modules/saved-views/entity-browser-fields`, plus `count.count` and `ids.id`.
Authored sources must not select those reserved fields or entity sync state. Recipe decoders return
entity references and typed display cells for renderers.

`librarySearchQuery({ source, entity, searchExpressions, search, image?, subtitle? })` authors a
ranked named `librarySearch` query. `searchExpressions` and `search` are structural expressions and a
parameter handle. The backend derives `librarySearchCount`; global search offers only views with
this explicit query. `decodeLibrarySearch` shares the hit/count wire decoding.

Controls declare browse targets, projected-output targets, or a flat composite of both. Outputs can
identify the canonical rows query with `query` so count and ID selections resolve the same expressions.
Optional output sort metadata supplies labels and the default direction. Renderers consume described
fields and sort choices; server binding compiles request values under caller authority.
`queryFilterFields` adapts described fields for the shared filter UI. `filters` owns URL/draft helpers,
`collectionsFilterField`, and the static linked-choice recipe. Compilation belongs to
`@ryot-app/ryotql/filters` and `/sort`.

`/controls` resolves browse and output control targets against effective entity-schema browse
declarations; the kernel uses it at execution and describe time. `/stored-validation` validates every
authored branch of a stored document and each control filter, sort, and branch sample against the
catalog. `/browse-validation` checks entity-schema browse declarations. Ingestion, saved-view writes,
pages, and `ryot plugin build` share these functions.

`loadEntityWatches` batches distinct population IDs into reads of at most 100 rows.
`loadEntitySchemaBrowse` batches schema selections into the same row bound and retains missing
definitions as neutral browse entries. Provider materialization and library-link lookups expose
100-row pages; `loadCompleteRows` follows their native cursors to retain every matching entity,
including multiple entities with the same external ID. Callers loading complete selections use
these loaders.

## Collections

`collectionArguments(collectionId)` returns the raw membership join ID and the tagged entity-source
reference. Collection recipes use one canonical members/count/memberIds document, with
`selectRecipe` selecting a result while retaining rows metadata for controls. Membership properties
use the `membership.<property>` output namespace; addedAt declares its filter and sort metadata.
The server resolves saved selections and collection order revisions and validates cursor identity.

## Recipe tests

`bindRecipe(recipe, arguments, context?, requestValues?)` uses the canonical binder for executable
shape assertions while preserving recipe metadata and decoding. Its default clock is fixed; the
optional context supplies another clock, reporting zone, or source/control resolver. The fourth
argument carries real request filter, sort, and pages. `bindTestRequest` binds recorded inline
requests for transport fixtures. These helpers are test-only.

`recipeResponse(recipe, overrides)` supplies empty rows/grouped results for every declared query,
using their declared limits. Supply every ungrouped aggregate explicitly; the helper does not guess
scalar values. Overrides are preserved verbatim, including deliberately malformed test results.

`pagesRecipe` lists owner-scoped page metadata; `pageRecipe` reads a page and its draft/published definitions by `pageId`. Both use the kernel-only `page` catalog. Compiled draft revision and artifact hash support revision-bound, read-only preview composition.

## Kernel publication page

`kernelPublicationPage({ schemas })` in `publication-browse` authors one server declaration with
exactly `items`, `count`, `item`, and `linked`. `schemas` is a nonempty authorized structural catalog:
each entry supplies `{ slug, pluginId, browse, presentationFields, sortTypes? }`. Presentation fields
are existing entity presentation projections rebased to the `subject` entity alias; they must read
only that entity's public columns. They cannot use events, relationships, correlated reads, owner
user IDs, query parameters, or reserved output keys. `sortTypes` supplies the scalar type (`text`,
`number`, `date`, or `boolean`) by key for each sort-only browse declaration. Value declarations
already carry their type. The backend must resolve this catalog under owner authority and provide
stable ordering of its schemas/fields. No visitor fragments participate in declaration construction.

The document requires `source`, a string with AppSchema reference kind `entity-source`, encoded by
`encodeEntitySourceReference` and bound by the publication owner. Optional `search` filters item
names. Optional `entityId` selects live detail/link reads; without it, explicit guards make `item`
and `linked` empty, allowing first-page snapshot capture without a selected entity. Source rank
and entity ID provide default ordering. `item` joins the bound source; `linked` returns source
entities only when the selected endpoint also belongs to the source. Relationship columns are used
only in predicates, never returned. There is no publication RyotQL scope or inline visitor fallback.

The factory returns the recipe (`document`, `parameters`, `queries`, `decode`), sanitized `browse`,
entity-browser `settings`, and response decoders `decodeItems`, `decodeCount`, `decodeItem`, and
`decodeLinked`. Each rows query projects `EntityBrowserRowFields`, `name`, schema-conditional JSON
presentation fields, and private detail/control output keys. Existing entity-browser decoding
produces `{ items, pageInfo }` with entity references, sync state, presentation rows, and cells.
`decodeItem` returns one such item with formatted `details`, or `undefined`; invalid detail values
fail decoding. Detail values accept null, text, finite numbers, booleans, and text arrays.
`count` projects one finite `count`; `decodeCount` returns that number. Per-query raw result
decoders remain available on `queries`; the recipe decoder handles a response containing all four.

Snapshots capture the first page with no selection and disable server-dependent interactions;
live selection supplies `entityId`. Live publications follow the latest published page code;
snapshots retain captured code until refresh. Those execution and UI policies belong to the backend
and renderer. These declarations require no alternative snapshot queries.

Owner publication recipes select `publication.definition` using `PublicationDefinition`
(`page`, `arguments`, `mode`). `publicationSourceArguments(EntitySourceReference)` encodes the
`source` argument. `sourcePublicationsRecipe` matches active kernel publication pages by their
encoded `definition.arguments.source`; user pages are excluded. The backend catalog must expose
the persisted `definition` JSON column.

`assistantConversationsRecipe` lists conversation metadata ordered by latest update, with stable ID
ordering. `assistantConversationRecipe` takes `{ conversationId }` by supplying that argument
to the static recipe; its named results are `conversation`, `messages`, `turns` and `calls`. Each rows
result has independent cursor pagination (maximum 100), and messages sort by their persisted sequence.
Consumers must paginate all history needed for display. Call rows carry the current approval revision,
immutable descriptor/input pin and bounded result. Exported decoded types are
`AssistantConversationList` and `AssistantConversationDetail`.
