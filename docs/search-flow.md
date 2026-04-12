**Core Distinction**

The refactor deliberately separates four concepts:

| Concept            | Example              | Responsibility                                       |
| ------------------ | -------------------- | ---------------------------------------------------- |
| Saved view         | “All Movies”         | Query and present entities already stored in Ryot    |
| Root entity schema | `movie`              | Identify the top-level domain type                   |
| Provider           | `movie.tmdb`         | Identify one external source for that domain type    |
| Provider operation | TMDB `search` script | Current active implementation of search/details/etc. |

A saved view does not own providers, external search, or import configuration.

## “All Movies” Today

`[viewSlug].tsx` is a generic saved-view renderer. It does not know that `all-movies` represents movies.

The flow is:

1. The route reads `viewSlug` at `apps/app-client/src/app/(app)/(shell)/(drawer)/v/[viewSlug].tsx:78`.
2. `SavedViewRecordLoader` loads the saved-view record at `[viewSlug].tsx:52`.
3. `SavedViewContent` executes the selected layout’s persisted RyotQL document at `[viewSlug].tsx:25`.
4. `SavedViewReadyContent` renders the resulting local entities at `[viewSlug].tsx:41`.

The media plugin defines “All Movies,” “All Shows,” and similar views in `plugins/media/saved-views.ts`. Their query documents effectively say:

```text
Read locally stored entities
where entitySchemaSlug = "movie"
and render them with this grid/list/table mapping
```

They do not say:

```text
Search TMDB
Search multiple providers
Import missing movies
```

That separation is intentional.

## Search Flow

Suppose some application UI already knows that the user wants to add a `movie`.

### 1. Discover searchable providers

The client executes the typed recipe in:

`packages/ryotql-recipes/src/provider-search.ts`

Conceptually:

```ts
buildProviderSearchDocument({
	rootEntitySchemaSlug: EntitySchemaSlug.make("movie"),
});
```

The recipe reads:

- `sandboxProvider`
- `sandboxProviderOperation`
- `plugin`

It returns only active providers that:

- Have `rootEntitySchemaSlug = "movie"`.
- Have a current `search` operation.
- Belong to an active plugin.

A possible result is:

```ts
[
	{
		providerId: "...",
		providerSlug: "movie.tmdb",
		providerName: "TMDB",
		rootEntitySchemaSlug: "movie",
		searchOptionsSchema: null,
	},
];
```

For books, Google Books may return a non-null options schema. IGDB may do the same for video-game filters.

### 2. Select one provider

The user chooses exactly one provider.

There is no backend request that searches every movie provider. Provider aggregation is now an application UX concern, not backend search orchestration.

### 3. Search that provider

The client calls:

```http
POST /provider-entities/search
```

```ts
{
  providerId,
  query: "The Matrix",
  page: 1,
  pageSize: 20,
  options: {},
}
```

The backend flow in `apps/app-backend/src/modules/provider-entities/search-service.ts` is:

1. Load the active provider.
2. Resolve its current `search` row from `sandbox_provider_operation`.
3. Validate `options` against the operation’s `options_schema`.
4. Execute the operation’s sandbox script.
5. Decode its `ProviderSearchResult`.
6. Return one singular provider result.

The response resembles:

```ts
{
  providerId,
  providerName: "TMDB",
  rootEntitySchemaSlug: "movie",
  items: [
    {
      externalId: "603",
      titleProperty: { kind: "text", value: "The Matrix" },
      imageProperty: { /* ... */ },
    },
  ],
  details: {
    totalItems: 12,
    nextPage: null,
  },
}
```

These are remote search results. They are not yet Ryot entities and therefore do not appear in “All Movies.”

## Import Flow

When the user selects a search result, the client calls:

```http
POST /provider-entities/imports
```

```ts
{
  providerId,
  externalId: "603",
}
```

The client cannot submit `entitySchemaSlug`.

The backend:

1. Loads the active provider.
2. Reads `rootEntitySchemaSlug` from `sandbox_provider`.
3. Materializes that schema into the durable workflow payload.
4. Resolves the provider’s current `details` operation.
5. Retrieves and validates provider details.
6. Creates or updates the local root entity.
7. Creates provider-declared child entities and relationships.
8. Returns the imported `ListedEntity` when the workflow completes.

The asynchronous endpoint initially returns:

```ts
{
  jobId: "...",
}
```

The client polls:

```http
GET /provider-entities/imports/:jobId
```

until it receives `completed` or `failed`.

## How It Reaches “All Movies”

The import is not attached to “All Movies.”

Instead:

```text
TMDB provider
    |
    | rootEntitySchemaSlug = "movie"
    v
Imported local entity with entitySchemaSlug = "movie"
    |
    | matches the saved view's stored-data query
    v
“All Movies” includes it after refresh
```

This is the only relationship between the saved view and the provider.

For “All Shows”:

```text
Provider root: show
Imported root entity: show
Saved-view filter: entitySchemaSlug = show
```

A show provider can also emit children such as:

- `show-season`
- `show-episode`

Those children retain their explicit schemas. They are not forced into the provider’s `show` root schema and do not automatically appear in “All Shows.”

## Important Client Gap

The backend flow is ready, but the app client does not currently connect it.

`SavedViewReadyContent` has placeholder Search/Add buttons in `apps/app-client/src/modules/saved-views/saved-view-content.tsx`, but their handlers do nothing.

The client currently has no implementation for:

- Executing `buildProviderSearchDocument`.
- Selecting a provider.
- Rendering an AppSchema-driven options form.
- Calling provider search.
- Displaying remote results.
- Starting an import.
- Polling the import job.
- Refreshing the saved view after completion.

There is also an important architectural issue: `[viewSlug].tsx` cannot safely derive `movie` from an arbitrary saved view.

It should not:

- Infer `movie` from the slug `all-movies`.
- Parse the saved view’s RyotQL document looking for schema predicates.
- Hardcode `all-movies -> movie`.
- Reintroduce a provider or root-schema field into saved views.

Saved views can theoretically query multiple schemas or use more complex predicates, so a saved view is not a reliable entity-type declaration.

## Recommended UX

I recommend a separate entity-type-aware add flow:

```text
“All Movies”
    |
    | user presses Add
    v
/add/movie
    |
    | query active searchable providers for "movie"
    v
Select TMDB
    |
    | search one provider
    v
Select result
    |
    | import and poll
    v
Return to All Movies and refresh
```

The unresolved part is how the Add button obtains `movie` without coupling it to the saved-view definition.

The cleanest options are:

1. **Global Add flow, recommended:** The user first chooses Movie, Show, Book, etc. Saved views remain completely generic.
2. **Entity-definition navigation:** An entity-schema-aware screen owns the Add action; “All Movies” links to or is presented inside that context.
3. **App-owned route context:** Navigation to the view carries an optional `entitySchemaSlug` for actions, but that context is not persisted in the saved view.
4. **Hardcoded built-in mapping:** Map `all-movies` to `movie` in the client. This is simple but creates brittle coupling and is not recommended.

The main product decision is: should Add/Search be a global entity-type workflow, or should “All Movies” directly open a movie-specific workflow despite saved views being generic?
