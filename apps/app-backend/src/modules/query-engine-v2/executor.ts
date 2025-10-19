import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { Effect, Match } from "effect";

import { CurrentDb, dbEffect } from "#lib/db";
import * as dbSchema from "#lib/db/schema/tables";
import { type BadRequest, type DbError, NotFound } from "#lib/errors";

import type { Expr, FieldSelector, FieldValue, QueryDocumentV2, RowsResponseV2 } from "./language";

export type VisibleSchema = { id: string; slug: string };

const loadVisibleEntitySchemas = (
	userId: string,
	slugs: readonly [string, ...string[]],
): Effect.Effect<VisibleSchema[], NotFound | DbError, CurrentDb> =>
	Effect.gen(function* () {
		const db = yield* CurrentDb;
		const uniqueSlugs = [...new Set(slugs)];

		const rows = yield* dbEffect(() =>
			db
				.select({ id: dbSchema.entitySchema.id, slug: dbSchema.entitySchema.slug })
				.from(dbSchema.entitySchema)
				.where(
					and(
						inArray(dbSchema.entitySchema.slug, uniqueSlugs),
						or(eq(dbSchema.entitySchema.userId, userId), isNull(dbSchema.entitySchema.userId)),
					),
				),
		);

		// Ensure every requested slug resolved to a visible schema
		const visibleSlugs = new Set(rows.map((r) => r.slug));
		for (const slug of uniqueSlugs) {
			if (!visibleSlugs.has(slug)) {
				return yield* new NotFound({ message: `Entity schema '${slug}' not found` });
			}
		}

		return rows;
	});

export const systemFieldSql = (name: string): ReturnType<typeof sql> | null => {
	const columnMap: Record<string, ReturnType<typeof sql>> = {
		id: sql`e.id`,
		name: sql`e.name`,
		image: sql`e.image`,
		createdAt: sql`e.created_at`,
		updatedAt: sql`e.updated_at`,
		externalId: sql`e.external_id`,
		sandboxScriptId: sql`e.sandbox_script_id`,
	};
	return columnMap[name] ?? null;
};

export const fieldSelectorToOrderSql = (
	field: FieldSelector,
	sourceSchemas: readonly [string, ...string[]],
): ReturnType<typeof sql> | null => {
	if (field.type === "system") {
		return systemFieldSql(field.name);
	}

	if (field.type === "property") {
		const pathArgs = field.path.map((k) => sql`${k}`);
		const jsonbExpr = sql`jsonb_extract_path_text(e.properties, ${sql.join(pathArgs, sql`, `)})`;

		if (sourceSchemas.length === 1) {
			return jsonbExpr;
		}
		// Multi-schema: only return the property when the entity's schema matches
		return sql`CASE WHEN es.slug = ${field.schema} THEN ${jsonbExpr} END`;
	}

	// field.type is "schema" at this point
	return field.name === "slug" ? sql`es.slug` : sql`es.name`;
};

export const exprToOrderSql = (
	expr: Expr,
	sourceSchemas: readonly [string, ...string[]],
): ReturnType<typeof sql> | null => {
	if (expr.type !== "ref") {
		return null;
	}
	return fieldSelectorToOrderSql(expr.field, sourceSchemas);
};

export type EntityQueryRow = {
	id: string;
	name: string;
	image: unknown;
	schemaId: string;
	schemaSlug: string;
	schemaName: string;
	createdAt: Date | string;
	updatedAt: Date | string;
	externalId: string | null;
	totalCount: string | bigint;
	sandboxScriptId: string | null;
	properties: Record<string, unknown>;
};

export const valueToFieldValue = (value: unknown): FieldValue => {
	if (value === null || value === undefined) {
		return { kind: "null", value: null };
	}
	if (typeof value === "string") {
		return { kind: "text", value };
	}
	if (typeof value === "number") {
		return { kind: "number", value };
	}
	if (typeof value === "boolean") {
		return { kind: "boolean", value };
	}
	return { kind: "json", value };
};

export const evalSystemRef = (name: string, row: EntityQueryRow): FieldValue =>
	Match.value(name).pipe(
		Match.when("id", () => ({ kind: "text" as const, value: row.id })),
		Match.when("name", () => ({ kind: "text" as const, value: row.name })),
		Match.when("image", () =>
			row.image !== null && row.image !== undefined
				? { kind: "image" as const, value: row.image }
				: { kind: "null" as const, value: null },
		),
		Match.when("createdAt", () => ({ kind: "date" as const, value: row.createdAt })),
		Match.when("updatedAt", () => ({ kind: "date" as const, value: row.updatedAt })),
		Match.when("externalId", () =>
			row.externalId !== null
				? { kind: "text" as const, value: row.externalId }
				: { kind: "null" as const, value: null },
		),
		Match.when("sandboxScriptId", () =>
			row.sandboxScriptId !== null
				? { kind: "text" as const, value: row.sandboxScriptId }
				: { kind: "null" as const, value: null },
		),
		Match.orElse(() => ({ kind: "null" as const, value: null })),
	);

export const getNestedValue = (
	obj: Record<string, unknown>,
	path: readonly [string, ...string[]],
): unknown => {
	let current: unknown = obj;
	for (const key of path) {
		if (typeof current !== "object" || current === null) {
			return null;
		}
		current = Reflect.get(current, key);
	}
	return current ?? null;
};

export const evalFieldSelector = (field: FieldSelector, row: EntityQueryRow): FieldValue => {
	if (field.type === "system") {
		return evalSystemRef(field.name, row);
	}

	if (field.type === "property") {
		// Return null when entity's schema doesn't match the property schema qualifier
		if (row.schemaSlug !== field.schema) {
			return { kind: "null", value: null };
		}
		return valueToFieldValue(getNestedValue(row.properties, field.path));
	}

	// schema metadata
	if (field.name === "slug") {
		return { kind: "text", value: row.schemaSlug };
	}
	return { kind: "text", value: row.schemaName };
};

export const evalExprForField = (expr: Expr, row: EntityQueryRow): FieldValue => {
	if (expr.type === "ref") {
		return evalFieldSelector(expr.field, row);
	}
	if (expr.type === "literal") {
		return valueToFieldValue(expr.value);
	}
	// Other expression types are not yet supported for output field evaluation
	return { kind: "null", value: null };
};

export const serializeRow = (
	row: EntityQueryRow,
	fields: QueryDocumentV2["return"]["fields"],
): Record<string, FieldValue> => {
	const result: Record<string, FieldValue> = {};
	for (const field of fields) {
		result[field.key] = evalExprForField(field.expr, row);
	}
	return result;
};

export const executeEntityRowsQuery = (
	userId: string,
	doc: QueryDocumentV2,
): Effect.Effect<RowsResponseV2, BadRequest | NotFound | DbError, CurrentDb> =>
	Effect.gen(function* () {
		const { source } = doc;
		const ret = doc.return;

		const visibleSchemas = yield* loadVisibleEntitySchemas(userId, source.schemas);
		if (visibleSchemas.length === 0) {
			return {
				type: "rows" as const,
				data: {
					items: [],
					pageInfo: {
						total: 0,
						hasMore: false,
						page: ret.pagination.page,
						limit: ret.pagination.limit,
					},
				},
			};
		}

		const schemaIds = visibleSchemas.map((s) => s.id);

		const orderParts = ret.orderBy.map((entry) => {
			const exprSql = exprToOrderSql(entry.expr, source.schemas);
			if (!exprSql) {
				return sql`1`; // Fallback for unsupported expressions; validator should catch these
			}
			return entry.order === "asc" ? sql`${exprSql} ASC` : sql`${exprSql} DESC`;
		});
		const orderSql = sql.join(orderParts, sql`, `);

		const schemaIdsSql = sql.join(
			schemaIds.map((id) => sql`${id}`),
			sql`, `,
		);

		const db = yield* CurrentDb;
		const offset = (ret.pagination.page - 1) * ret.pagination.limit;

		const rawRows = yield* dbEffect(() =>
			db.execute<EntityQueryRow>(sql`
				SELECT
					e.id,
					e.name,
					e.image,
					e.created_at AS "createdAt",
					e.updated_at AS "updatedAt",
					e.external_id AS "externalId",
					e.sandbox_script_id AS "sandboxScriptId",
					e.properties,
					es.id AS "schemaId",
					es.slug AS "schemaSlug",
					es.name AS "schemaName",
					COUNT(*) OVER() AS "totalCount"
				FROM entity e
				JOIN entity_schema es ON es.id = e.entity_schema_id
				WHERE
					e.entity_schema_id IN (${schemaIdsSql})
					AND (e.user_id = ${userId} OR e.user_id IS NULL)
				ORDER BY ${orderSql}
				LIMIT ${ret.pagination.limit}
				OFFSET ${offset}
			`),
		);

		const rows = rawRows.rows;
		const total = rows[0]?.totalCount !== undefined ? Number(rows[0].totalCount) : 0;
		const items = rows.map((row) => serializeRow(row, ret.fields));

		return {
			type: "rows" as const,
			data: {
				items,
				pageInfo: {
					total,
					page: ret.pagination.page,
					limit: ret.pagination.limit,
					hasMore: offset + rows.length < total,
				},
			},
		};
	});
