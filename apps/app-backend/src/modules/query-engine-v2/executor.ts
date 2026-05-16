import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { Effect, Match } from "effect";

import { CurrentDb, dbEffect } from "#lib/db";
import * as dbSchema from "#lib/db/schema/tables";
import { BadRequest, type DbError, NotFound } from "#lib/errors";

import type {
	Expr,
	EventSourceV2,
	FieldSelector,
	FieldValue,
	IncludeEntryV2,
	QueryDocumentV2,
	RowItem,
	RowValue,
	RowsResponseV2,
} from "./language";

const MAX_SERIALIZED_ROW_OBJECTS = 5000;

export type VisibleSchema = { id: string; slug: string };
type VisibleRelationshipSchema = { id: string; slug: string };

type VisibleEventSchema = { id: string; slug: string };

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

const loadVisibleRelationshipSchema = (
	userId: string,
	slug: string,
): Effect.Effect<VisibleRelationshipSchema, NotFound | DbError, CurrentDb> =>
	Effect.gen(function* () {
		const db = yield* CurrentDb;
		const rows = yield* dbEffect(() =>
			db
				.select({ id: dbSchema.relationshipSchema.id, slug: dbSchema.relationshipSchema.slug })
				.from(dbSchema.relationshipSchema)
				.where(
					and(
						eq(dbSchema.relationshipSchema.slug, slug),
						or(
							eq(dbSchema.relationshipSchema.userId, userId),
							isNull(dbSchema.relationshipSchema.userId),
						),
					),
				),
		);

		const schema = rows[0];
		if (!schema) {
			return yield* new NotFound({ message: `Relationship schema '${slug}' not found` });
		}
		return schema;
	});

const loadVisibleEventSchemas = (
	userId: string,
	entitySchemaId: string,
	slugs: readonly [string, ...string[]],
): Effect.Effect<VisibleEventSchema[], NotFound | DbError, CurrentDb> =>
	Effect.gen(function* () {
		const db = yield* CurrentDb;
		const uniqueSlugs = [...new Set(slugs)];

		const rows = yield* dbEffect(() =>
			db
				.select({ id: dbSchema.eventSchema.id, slug: dbSchema.eventSchema.slug })
				.from(dbSchema.eventSchema)
				.where(
					and(
						eq(dbSchema.eventSchema.entitySchemaId, entitySchemaId),
						inArray(dbSchema.eventSchema.slug, uniqueSlugs),
						or(eq(dbSchema.eventSchema.userId, userId), isNull(dbSchema.eventSchema.userId)),
					),
				),
		);

		const visibleSlugs = new Set(rows.map((r) => r.slug));
		for (const slug of uniqueSlugs) {
			if (!visibleSlugs.has(slug)) {
				return yield* new NotFound({ message: `Event schema '${slug}' not found` });
			}
		}

		return rows;
	});

export const systemFieldSql = (name: string, alias = "e"): ReturnType<typeof sql> | null => {
	if (alias === "r") {
		const relationshipColumnMap: Record<string, ReturnType<typeof sql>> = {
			id: sql`r.id`,
			createdAt: sql`r.created_at`,
			sourceEntityId: sql`r.source_entity_id`,
			targetEntityId: sql`r.target_entity_id`,
		};
		return relationshipColumnMap[name] ?? null;
	}

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
	alias = "e",
): ReturnType<typeof sql> | null => {
	if (field.type === "system") {
		return systemFieldSql(field.name, alias);
	}

	if (field.type === "property") {
		const pathArgs = field.path.map((k) => sql`${k}`);
		const jsonbExpr = sql`jsonb_extract_path_text(${alias === "r" ? sql`r.properties` : sql`e.properties`}, ${sql.join(pathArgs, sql`, `)})`;

		if (alias === "r" || sourceSchemas.length === 1) {
			return jsonbExpr;
		}
		// Multi-schema: only return the property when the entity's schema matches
		return sql`CASE WHEN es.slug = ${field.schema} THEN ${jsonbExpr} END`;
	}

	// field.type is "schema" at this point
	if (alias === "r") {
		return field.name === "slug" ? sql`rs.slug` : sql`rs.name`;
	}
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

type BaseEntityQueryRow = {
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

export type EntityQueryRow = BaseEntityQueryRow & { totalCount: string | bigint };

type RelationshipFields = {
	relationshipId: string | null;
	relationshipSchemaSlug: string | null;
	relationshipSchemaName: string | null;
	relationshipSourceEntityId: string | null;
	relationshipTargetEntityId: string | null;
	relationshipCreatedAt: Date | string | null;
	relationshipProperties: Record<string, unknown> | null;
};

type IncludeQueryRow = BaseEntityQueryRow & RelationshipFields;

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

export const evalSystemRef = (name: string, row: BaseEntityQueryRow): FieldValue =>
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

export const evalFieldSelector = (field: FieldSelector, row: BaseEntityQueryRow): FieldValue => {
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

const evalRelationshipSystemRef = (name: string, row: RelationshipFields): FieldValue =>
	Match.value(name).pipe(
		Match.when("id", () => ({ kind: "text" as const, value: row.relationshipId ?? "" })),
		Match.when("createdAt", () => ({ kind: "date" as const, value: row.relationshipCreatedAt })),
		Match.when("sourceEntityId", () => ({
			kind: "text" as const,
			value: row.relationshipSourceEntityId ?? "",
		})),
		Match.when("targetEntityId", () => ({
			kind: "text" as const,
			value: row.relationshipTargetEntityId ?? "",
		})),
		Match.orElse(() => ({ kind: "null" as const, value: null })),
	);

const evalRelationshipFieldSelector = (
	field: FieldSelector,
	row: RelationshipFields,
): FieldValue => {
	if (field.type === "system") {
		return evalRelationshipSystemRef(field.name, row);
	}
	if (field.type === "property") {
		if (row.relationshipSchemaSlug !== field.schema) {
			return { kind: "null", value: null };
		}
		return valueToFieldValue(getNestedValue(row.relationshipProperties ?? {}, field.path));
	}
	return {
		kind: "text",
		value: field.name === "slug" ? row.relationshipSchemaSlug : row.relationshipSchemaName,
	};
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

const executeEventExists = (
	userId: string,
	row: BaseEntityQueryRow,
	source: EventSourceV2,
): Effect.Effect<boolean, NotFound | DbError, CurrentDb> =>
	Effect.gen(function* () {
		const eventSchemas = yield* loadVisibleEventSchemas(userId, row.schemaId, source.schemas);
		const eventSchemaIdsSql = sql.join(
			eventSchemas.map((s) => sql`${s.id}`),
			sql`, `,
		);
		const db = yield* CurrentDb;
		const rawRows = yield* dbEffect(() =>
			db.execute<{ id: string }>(sql`
				SELECT ev.id
				FROM event ev
				WHERE
					ev.entity_id = ${row.id}
					AND ev.user_id = ${userId}
					AND ev.event_schema_id IN (${eventSchemaIdsSql})
				LIMIT 1
			`),
		);

		return rawRows.rows.length > 0;
	});

const evalExistsExprForField = (
	userId: string,
	row: BaseEntityQueryRow,
	expr: Extract<Expr, { type: "exists" }>,
): Effect.Effect<FieldValue, NotFound | DbError, CurrentDb> => {
	if (expr.source.type === "events") {
		return Effect.map(executeEventExists(userId, row, expr.source), (exists) => ({
			value: exists,
			kind: "boolean" as const,
		}));
	}

	return Effect.succeed({ kind: "null" as const, value: null });
};

const evalRootExprForField = (
	userId: string,
	expr: Expr,
	row: EntityQueryRow,
): Effect.Effect<FieldValue, NotFound | DbError, CurrentDb> => {
	if (expr.type === "exists") {
		return evalExistsExprForField(userId, row, expr);
	}
	return Effect.succeed(evalExprForField(expr, row));
};

const evalIncludeExprForField = (
	userId: string,
	expr: Expr,
	row: IncludeQueryRow,
	include: IncludeEntryV2,
): Effect.Effect<FieldValue, NotFound | DbError, CurrentDb> => {
	if (expr.type === "exists") {
		return evalExistsExprForField(userId, row, expr);
	}
	if (expr.type === "ref" && expr.sourceAlias === include.source.via?.alias) {
		return Effect.succeed(evalRelationshipFieldSelector(expr.field, row));
	}
	if (expr.type === "ref") {
		return Effect.succeed(evalFieldSelector(expr.field, row));
	}
	if (expr.type === "literal") {
		return Effect.succeed(valueToFieldValue(expr.value));
	}
	return Effect.succeed({ kind: "null", value: null });
};

export const serializeRow = (
	row: EntityQueryRow,
	fields: QueryDocumentV2["output"]["fields"],
): RowItem => {
	const result: Record<string, RowValue> = {};
	for (const field of fields) {
		result[field.key] = evalExprForField(field.expr, row);
	}
	return result;
};

const serializeRootRow = (
	userId: string,
	row: EntityQueryRow,
	fields: QueryDocumentV2["output"]["fields"],
): Effect.Effect<RowItem, NotFound | DbError, CurrentDb> =>
	Effect.gen(function* () {
		const result: Record<string, RowValue> = {};
		for (const field of fields) {
			result[field.key] = yield* evalRootExprForField(userId, field.expr, row);
		}
		return result;
	});

const serializeIncludeRow = (
	userId: string,
	row: IncludeQueryRow,
	include: IncludeEntryV2,
): Effect.Effect<RowItem, NotFound | DbError, CurrentDb> =>
	Effect.gen(function* () {
		const result: Record<string, RowValue> = {};
		for (const field of include.fields) {
			result[field.key] = yield* evalIncludeExprForField(userId, field.expr, row, include);
		}
		return result;
	});

const includeOrderSql = (include: IncludeEntryV2): ReturnType<typeof sql> => {
	const viaAlias = include.source.via?.alias;
	const orderParts = include.orderBy.map((entry) => {
		if (entry.expr.type !== "ref") {
			return sql`1`;
		}
		const sourceAlias = entry.expr.sourceAlias === viaAlias ? "r" : "e";
		const exprSql = fieldSelectorToOrderSql(entry.expr.field, include.source.schemas, sourceAlias);
		if (!exprSql) {
			return sql`1`;
		}
		return entry.order === "asc" ? sql`${exprSql} ASC` : sql`${exprSql} DESC`;
	});
	return sql.join(orderParts, sql`, `);
};

const executeIncludeForParentRow = (
	userId: string,
	parentRow: BaseEntityQueryRow,
	include: IncludeEntryV2,
): Effect.Effect<{ rows: IncludeQueryRow[]; hasMore: boolean }, NotFound | DbError, CurrentDb> =>
	Effect.gen(function* () {
		const via = include.source.via;
		if (via === undefined) {
			return { rows: [], hasMore: false };
		}

		const [relationshipSchema, visibleSchemas] = yield* Effect.all([
			loadVisibleRelationshipSchema(userId, via.schema),
			loadVisibleEntitySchemas(userId, include.source.schemas),
		]);
		const schemaIdsSql = sql.join(
			visibleSchemas.map((s) => sql`${s.id}`),
			sql`, `,
		);
		const anchorColumn =
			via.direction === "outgoing" ? sql`r.source_entity_id` : sql`r.target_entity_id`;
		const childColumn =
			via.direction === "outgoing" ? sql`r.target_entity_id` : sql`r.source_entity_id`;
		const orderSql = includeOrderSql(include);
		const db = yield* CurrentDb;

		const rawRows = yield* dbEffect(() =>
			db.execute<IncludeQueryRow>(sql`
				SELECT
					e.id,
					e.name,
					e.image,
					e.properties,
					e.created_at AS "createdAt",
					e.updated_at AS "updatedAt",
					e.external_id AS "externalId",
					e.sandbox_script_id AS "sandboxScriptId",
					es.id AS "schemaId",
					es.slug AS "schemaSlug",
					es.name AS "schemaName",
					r.id AS "relationshipId",
					r.created_at AS "relationshipCreatedAt",
					r.source_entity_id AS "relationshipSourceEntityId",
					r.target_entity_id AS "relationshipTargetEntityId",
					r.properties AS "relationshipProperties",
					rs.slug AS "relationshipSchemaSlug",
					rs.name AS "relationshipSchemaName"
				FROM relationship r
				JOIN relationship_schema rs ON rs.id = r.relationship_schema_id
				JOIN entity e ON e.id = ${childColumn}
				JOIN entity_schema es ON es.id = e.entity_schema_id
				WHERE
					r.relationship_schema_id = ${relationshipSchema.id}
					AND ${anchorColumn} = ${parentRow.id}
					AND e.entity_schema_id IN (${schemaIdsSql})
					AND (r.user_id = ${userId} OR r.user_id IS NULL)
					AND (e.user_id = ${userId} OR e.user_id IS NULL)
				ORDER BY ${orderSql}
				LIMIT ${include.limit + 1}
			`),
		);

		return {
			hasMore: rawRows.rows.length > include.limit,
			rows: rawRows.rows.slice(0, include.limit),
		};
	});

const serializeIncludesForRow = (
	userId: string,
	row: BaseEntityQueryRow,
	includes: readonly IncludeEntryV2[],
): Effect.Effect<
	{ rowCount: number; values: Record<string, RowValue> },
	BadRequest | NotFound | DbError,
	CurrentDb
> =>
	Effect.gen(function* () {
		let rowCount = 0;
		const values: Record<string, RowValue> = {};

		for (const include of includes) {
			const includeResult = yield* executeIncludeForParentRow(userId, row, include);
			rowCount += includeResult.rows.length;
			const items: RowItem[] = [];

			for (const includeRow of includeResult.rows) {
				const item = yield* serializeIncludeRow(userId, includeRow, include);
				const childIncludes = yield* serializeIncludesForRow(
					userId,
					includeRow,
					include.include ?? [],
				);
				rowCount += childIncludes.rowCount;
				Object.assign(item, childIncludes.values);
				items.push(item);
			}

			values[include.key] = {
				items,
				pageInfo: { limit: include.limit, hasMore: includeResult.hasMore },
			};
		}

		if (rowCount > MAX_SERIALIZED_ROW_OBJECTS) {
			return yield* new BadRequest({
				message: `Serialized row object count exceeds maximum of ${MAX_SERIALIZED_ROW_OBJECTS}`,
			});
		}

		return { values, rowCount };
	});

export const executeEntityRowsQuery = (
	userId: string,
	doc: QueryDocumentV2,
): Effect.Effect<RowsResponseV2, BadRequest | NotFound | DbError, CurrentDb> =>
	Effect.gen(function* () {
		const { source } = doc;
		const output = doc.output;

		const visibleSchemas = yield* loadVisibleEntitySchemas(userId, source.schemas);
		if (visibleSchemas.length === 0) {
			return {
				type: "rows" as const,
				data: {
					items: [],
					pageInfo: {
						total: 0,
						hasMore: false,
						page: output.pagination.page,
						limit: output.pagination.limit,
					},
				},
			};
		}

		const schemaIds = visibleSchemas.map((s) => s.id);

		const orderParts = output.orderBy.map((entry) => {
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
		const offset = (output.pagination.page - 1) * output.pagination.limit;

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
				LIMIT ${output.pagination.limit}
				OFFSET ${offset}
			`),
		);

		const rows = rawRows.rows;
		const total = rows[0]?.totalCount !== undefined ? Number(rows[0].totalCount) : 0;
		let serializedRowCount = rows.length;
		const items: RowItem[] = [];
		for (const row of rows) {
			const item: Record<string, RowValue> = yield* serializeRootRow(userId, row, output.fields);
			const includeValues = yield* serializeIncludesForRow(userId, row, output.include ?? []);
			serializedRowCount += includeValues.rowCount;
			if (serializedRowCount > MAX_SERIALIZED_ROW_OBJECTS) {
				return yield* new BadRequest({
					message: `Serialized row object count exceeds maximum of ${MAX_SERIALIZED_ROW_OBJECTS}`,
				});
			}
			Object.assign(item, includeValues.values);
			items.push(item);
		}

		return {
			type: "rows" as const,
			data: {
				items,
				pageInfo: {
					total,
					page: output.pagination.page,
					limit: output.pagination.limit,
					hasMore: offset + rows.length < total,
				},
			},
		};
	});
