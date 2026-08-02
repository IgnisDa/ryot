# RyotQL Guide

RyotQL is the focused read API at `POST /ryotql/execute`. It is independent from the legacy query engine.

## Current Capabilities

- Authenticated user execution against the `entity` table.
- Multiple independent named rows queries in one repeatable-read, read-only transaction.
- Entity field selection, typed JSON expressions, predicates, inner and left joins, ordering, and pagination.
- User visibility for every entity table occurrence: a caller can read their own rows and global rows.
- Runtime field kinds: `text`, `date`, `number`, `boolean`, `json`, and `null`.

The entity catalog currently exposes `id`, `name`, `userId`, `createdAt`, `updatedAt`, `properties`, `externalId`, `populatedAt`, `providerId`, and `entitySchemaSlug`. Other physical columns are not queryable.

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

Rows default to page 1, limit 20, and root primary-key ascending order when built with the SDK. The compiler always appends the root primary key when needed, uses `NULLS LAST` in both directions, and reports the true total for pages beyond the final row.

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

## Limits

- 10 named queries per document.
- 8 joins per named query.
- 100 rows per page.
- 30-second transaction-local statement timeout.

Localization, correlated queries, includes, aggregates, time series, plugin execution, and application tables other than `entity` are not available yet.
