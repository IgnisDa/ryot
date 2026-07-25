# RyotQL Guide

RyotQL is the focused read API at `POST /ryotql/execute`. It is independent from the legacy query engine.

## Current Capabilities

- Authenticated user execution against the `entity`, `event`, and `relationship` tables.
- Multiple independent named rows queries in one repeatable-read, read-only transaction.
- Field selection, typed JSON expressions, predicates, inner and left joins, ordering, pagination, and correlated row includes.
- Localized entity names and properties with translation status as a normal catalog field.
- User visibility for every table occurrence: a caller can read their own rows and global rows.
- Runtime field kinds: `text`, `date`, `number`, `boolean`, `json`, and `null`.

The entity catalog currently exposes `id`, `name`, `userId`, `createdAt`, `updatedAt`, `properties`, `externalId`, `populatedAt`, `providerId`, `translationStatus`, and `entitySchemaSlug`. Other physical columns are not queryable.

The event catalog exposes `id`, `userId`, `entityId`, `createdAt`, `updatedAt`, `properties`, `occurredAt`, `eventSchemaSlug`, and `sessionEntityId`.

The relationship catalog exposes `id`, `userId`, `sourceEntityId`, `targetEntityId`, `createdAt`, `properties`, and `relationshipSchemaSlug`.

## Document Shape

Every document contains a non-empty `queries` object. Each entry is independent and has an explicit root table and alias, an optional predicate and joins, and one rows output.

```json
{
	"queries": {
		"collections": {
			"from": { "table": "entity", "alias": "collection" },
			"where": {
				"type": "comparison",
				"operator": "eq",
				"left": { "type": "column", "tableAlias": "collection", "field": "entitySchemaSlug" },
				"right": { "type": "literal", "value": "collection" }
			},
			"output": {
				"type": "rows",
				"fields": [
					{ "key": "id", "expr": { "type": "column", "tableAlias": "collection", "field": "id" } },
					{
						"key": "name",
						"expr": { "type": "column", "tableAlias": "collection", "field": "name" }
					}
				],
				"orderBy": [
					{
						"direction": "asc",
						"expr": { "type": "column", "tableAlias": "collection", "field": "name" }
					}
				],
				"pagination": { "page": 1, "limit": 20 }
			}
		}
	}
}
```

The response is keyed by the same query name:

```json
{
	"data": {
		"collections": {
			"type": "rows",
			"items": [{ "id": { "kind": "text", "value": "collection-id" } }],
			"pageInfo": { "page": 1, "limit": 20, "total": 1, "hasMore": false }
		}
	}
}
```

Rows default to page 1, limit 20, and root primary-key ascending order when built with the SDK. The compiler appends joined and root primary keys when needed to keep multiplied rows deterministic, uses `NULLS LAST` in both directions, and reports the true total for pages beyond the final row.

## Expressions And JSON

`jsonPath` reads deep object keys and array indices from a public JSON expression. Paths are generic and do not load property schemas, validate property names, infer property types, or resolve discriminator definitions. A missing path and JSON `null` both produce null. Raw JSON-path fields derive their response kind from the runtime JSON value.

Use `castText`, `castNumber`, `castBoolean`, `castDate`, or `castJson` when a query needs scalar behavior. JSON casts accept the matching JSON value type; incompatible values produce null. Number and date input is checked before PostgreSQL casts it, so malformed dates and out-of-range numbers also produce null instead of failing the query. Cast expressions can be selected, filtered, and ordered.

```ts
const entity = table("entity", "book");
const properties = column(entity, "properties");
const rating = castNumber(jsonPath(properties, "details", "rating"));

document({
	books: rows(entity, {
		fields: [
			field("name", column(entity, "name")),
			field("rating", rating),
			field("cover", jsonPath(properties, "images", 0)),
		],
		where: and(eq(column(entity, "entitySchemaSlug"), literal("book")), gte(rating, literal(4))),
		orderBy: [descending(rating)],
	}),
});
```

Comparisons support `eq`, `neq`, `gt`, `gte`, `lt`, and `lte`. Null comparisons are false before `not` is applied. Text comparisons and ordering use C collation. `contains` performs escaped, case-insensitive literal substring matching for text and structural containment for JSON arrays or objects. JSON equality is structural. `isNull`, `isNotNull`, `and`, `or`, and `not` compose predicates; empty `and` is true, empty `or` and empty `inArray` are false. `coalesce` selects the first non-null value and retains that branch's runtime field kind.

Schema discriminators are ordinary `entitySchemaSlug` comparisons. Use `eq` for one slug and `inArray` for several. Unknown slugs return no rows and do not trigger definition lookup.

## Event Queries

Events are ordinary `event` table rows. Use an explicit join to `entity` when a query needs attached entity fields or `entitySchemaSlug` filtering. Event and entity visibility is applied to each table before the join, so predicates cannot expose another user's rows.

```ts
const event = table("event", "event");
const entity = table("entity", "entity");

document({
	events: rows(event, {
		orderBy: [descending(column(event, "occurredAt"))],
		joins: [join("inner", entity, eq(column(event, "entityId"), column(entity, "id")))],
		fields: [
			field("occurredAt", column(event, "occurredAt")),
			field("entityName", column(entity, "name")),
		],
		where: and(
			eq(column(event, "eventSchemaSlug"), literal("review")),
			eq(column(entity, "entitySchemaSlug"), literal("book")),
		),
	}),
});
```

Event JSON properties use the same generic JSON paths and safe casts as entity properties. `sessionEntityId` is nullable and reconstructs with the `null` kind when absent; event timestamps reconstruct with the `date` kind.

## Relationships And Joins

Relationships are ordinary rows. Join `sourceEntityId` and `targetEntityId` to separate entity aliases when endpoint fields are needed. There are no endpoint declarations, directions, or automatic discriminator filters.

Inner and left joins can connect any catalog tables. A join predicate can reference its new alias and aliases already in scope. Normal SQL multiplicity applies: several matching joined rows produce several root rows, and RyotQL does not deduplicate them.

Authorization is applied inside every table occurrence before joins and caller predicates. A left join with no visible matching row therefore keeps the left row and returns null fields from the joined alias.

```ts
const member = table("entity", "member");
const collection = table("entity", "collection");
const membership = table("relationship", "membership");

rows(membership, {
	where: eq(column(membership, "relationshipSchemaSlug"), literal("membership")),
	fields: [
		field("memberName", column(member, "name")),
		field("collectionName", column(collection, "name")),
	],
	joins: [
		join("inner", member, eq(column(membership, "sourceEntityId"), column(member, "id"))),
		join("inner", collection, eq(column(membership, "targetEntityId"), column(collection, "id"))),
	],
});
```

## Correlated Includes

An include is a row query with its own `from`, optional joins and predicate, selected fields, non-empty ordering, and explicit limit. Its expressions can reference aliases from the parent scope. Sibling aliases are not shared. Any catalog table can be an include root or join.

Includes return `{ items, pageInfo: { limit, hasMore } }` under their key. They run as correlated SQL inside the named query statement, fetch at most limit plus one rows to derive `hasMore`, and return an empty `items` list without removing the parent. Includes can be nested to depth three.

```ts
const course = table("entity", "course");
const module = table("entity", "module");
const courseModule = table("relationship", "courseModule");

rows(course, {
	fields: [field("name", column(course, "name"))],
	include: [
		include(courseModule, {
			limit: 10,
			key: "modules",
			orderBy: [ascending(column(module, "name"))],
			fields: [field("name", column(module, "name"))],
			where: eq(column(courseModule, "sourceEntityId"), column(course, "id")),
			joins: [
				join("inner", module, eq(column(courseModule, "targetEntityId"), column(module, "id"))),
			],
		}),
	],
});
```

## Localization And Derived Fields

Catalog fields resolve through one backend-owned interface. Most fields map directly to physical columns. `name`, `properties`, and `translationStatus` are resolved fields whose SQL depends on the authenticated user's language. RyotQL documents use them as ordinary columns and cannot provide custom field resolvers.

For a user with a non-canonical language preference, `name` uses the translated name when present and otherwise falls back to the canonical name. Translated properties merge over canonical properties, so untranslated canonical keys remain available. The same resolved values are used in selection, predicates, ordering, and JSON paths. Users without a language preference read canonical values without translation SQL.

`translationStatus` is `none` for canonical-language readers, entities without a provider, providers without a canonical language, and unpopulated entities. It is `pending` when a translation is required but absent, `none` for a negative-cache translation, and `ready` when translated content exists. Its provider and translation SQL is emitted only when an expression references `translationStatus`.

## Limits

- 10 named queries per document.
- 8 joins per named query.
- 100 rows per page.
- 100 rows per include.
- 3 include levels.
- 30-second transaction-local statement timeout.

Correlated scalar expressions, aggregates, time series, plugin execution, and application tables other than `entity`, `event`, and `relationship` are not available yet.
