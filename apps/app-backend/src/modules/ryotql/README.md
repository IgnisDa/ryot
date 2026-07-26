# RyotQL Guide

RyotQL is the focused read API at `POST /ryotql/execute`. It is independent from the legacy query engine.

## Current Capabilities

- Authenticated user execution against the `entity` table.
- Multiple independent named rows queries in one repeatable-read, read-only transaction.
- Entity field selection, equality and membership predicates, inner and left joins, ordering, and pagination.
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

## Limits

- 10 named queries per document.
- 8 joins per named query.
- 100 rows per page.
- 30-second transaction-local statement timeout.

JSON paths, safe casts, localization, correlated queries, includes, aggregates, time series, plugin execution, and application tables other than `entity` are not available yet.
