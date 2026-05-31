import { sql } from "drizzle-orm";
import { Effect } from "effect";

import { CurrentDb, dbEffect } from "#lib/db";
import { BadRequest, type DbError, type NotFound } from "#lib/errors";

import type {
	Expr,
	IncludeEntry,
	RelationshipSource,
	RootEventSource,
	RowItem,
	RowValue,
	RowsOutput,
} from "../language";
import {
	makeEntityContext,
	makeEventRootContext,
	makeIncludeContext,
	makeRelationshipRootContext,
	relationshipEntityRow,
} from "./context";
import { evalExprValue } from "./expr";
import {
	evalEventFieldSelector,
	evalExprForField,
	evalFieldSelector,
	evalRelationshipFieldSelector,
	valueToFieldValue,
} from "./field-values";
import { executeEventFirst } from "./first";
import { loadVisibleEntitySchemas, loadVisibleRelationshipSchema } from "./schema-loaders";
import { includeOrderSql } from "./sql";
import {
	MAX_SERIALIZED_ROW_OBJECTS,
	type BaseEntityQueryRow,
	type EntityQueryRow,
	type EventQueryRow,
	type IncludeQueryRow,
	type RelationshipRootQueryRow,
} from "./types";

const evalRootExprForField = (
	userId: string,
	expr: Expr,
	row: EntityQueryRow,
	entityAlias: string,
): Effect.Effect<RowValue, BadRequest | NotFound | DbError, CurrentDb> => {
	if (expr.type === "first") {
		if (expr.source.type === "events" && expr.source.entityRef === entityAlias) {
			return executeEventFirst(userId, row, expr);
		}
		return Effect.succeed({ kind: "null" as const, value: null });
	}
	return evalExprValue(userId, expr, makeEntityContext(entityAlias, row));
};

const evalEventRootExprForField = (
	userId: string,
	expr: Expr,
	row: EventQueryRow,
	source: RootEventSource,
): Effect.Effect<RowValue, BadRequest | NotFound | DbError, CurrentDb> => {
	if (expr.type === "first") {
		if (expr.source.type === "events" && expr.source.entityRef === source.entity.alias) {
			return executeEventFirst(userId, row, expr);
		}
		return Effect.succeed({ kind: "null" as const, value: null });
	}
	if (expr.type === "ref" && expr.sourceAlias === source.alias) {
		return Effect.succeed(evalEventFieldSelector(expr.field, row));
	}
	if (expr.type === "ref" && expr.sourceAlias === source.entity.alias) {
		return Effect.succeed(evalFieldSelector(expr.field, row));
	}
	if (expr.type === "literal") {
		return Effect.succeed(valueToFieldValue(expr.value));
	}
	return evalExprValue(userId, expr, makeEventRootContext(source, row));
};

const evalRelationshipRootExprForField = (
	userId: string,
	expr: Expr,
	row: RelationshipRootQueryRow,
	source: RelationshipSource,
): Effect.Effect<RowValue, BadRequest | NotFound | DbError, CurrentDb> => {
	if (expr.type === "first") {
		if (expr.source.type !== "events") {
			return Effect.succeed({ kind: "null" as const, value: null });
		}
		if (expr.source.entityRef === source.sourceEntity.alias) {
			return executeEventFirst(userId, relationshipEntityRow(row.sourceEntity), expr);
		}
		if (expr.source.entityRef === source.targetEntity.alias) {
			return executeEventFirst(userId, relationshipEntityRow(row.targetEntity), expr);
		}
		return Effect.succeed({ kind: "null" as const, value: null });
	}
	if (expr.type === "ref" && expr.sourceAlias === source.alias) {
		return Effect.succeed(evalRelationshipFieldSelector(expr.field, row));
	}
	if (expr.type === "ref" && expr.sourceAlias === source.sourceEntity.alias) {
		return Effect.succeed(evalFieldSelector(expr.field, relationshipEntityRow(row.sourceEntity)));
	}
	if (expr.type === "ref" && expr.sourceAlias === source.targetEntity.alias) {
		return Effect.succeed(evalFieldSelector(expr.field, relationshipEntityRow(row.targetEntity)));
	}
	if (expr.type === "literal") {
		return Effect.succeed(valueToFieldValue(expr.value));
	}
	return evalExprValue(userId, expr, makeRelationshipRootContext(source, row));
};

const evalIncludeExprForField = (
	userId: string,
	expr: Expr,
	row: IncludeQueryRow,
	include: IncludeEntry,
): Effect.Effect<RowValue, BadRequest | NotFound | DbError, CurrentDb> => {
	if (expr.type === "first") {
		if (expr.source.type === "events" && expr.source.entityRef === include.source.alias) {
			return executeEventFirst(userId, row, expr);
		}
		return Effect.succeed({ kind: "null" as const, value: null });
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
	return evalExprValue(userId, expr, makeIncludeContext(include, row));
};

export const serializeRow = (row: EntityQueryRow, fields: RowsOutput["fields"]): RowItem => {
	const result: Record<string, RowValue> = {};
	for (const field of fields) {
		result[field.key] = evalExprForField(field.expr, row);
	}
	return result;
};

export const serializeRootRow = (
	userId: string,
	row: EntityQueryRow,
	entityAlias: string,
	fields: RowsOutput["fields"],
): Effect.Effect<RowItem, BadRequest | NotFound | DbError, CurrentDb> =>
	Effect.gen(function* () {
		const result: Record<string, RowValue> = {};
		for (const field of fields) {
			result[field.key] = yield* evalRootExprForField(userId, field.expr, row, entityAlias);
		}
		return result;
	});

export const serializeEventRootRow = (
	userId: string,
	row: EventQueryRow,
	source: RootEventSource,
	fields: RowsOutput["fields"],
): Effect.Effect<RowItem, BadRequest | NotFound | DbError, CurrentDb> =>
	Effect.gen(function* () {
		const result: Record<string, RowValue> = {};
		for (const field of fields) {
			result[field.key] = yield* evalEventRootExprForField(userId, field.expr, row, source);
		}
		return result;
	});

export const serializeRelationshipRootRow = (
	userId: string,
	row: RelationshipRootQueryRow,
	source: RelationshipSource,
	fields: RowsOutput["fields"],
): Effect.Effect<RowItem, BadRequest | NotFound | DbError, CurrentDb> =>
	Effect.gen(function* () {
		const result: Record<string, RowValue> = {};
		for (const field of fields) {
			result[field.key] = yield* evalRelationshipRootExprForField(userId, field.expr, row, source);
		}
		return result;
	});

const serializeIncludeRow = (
	userId: string,
	row: IncludeQueryRow,
	include: IncludeEntry,
): Effect.Effect<RowItem, BadRequest | NotFound | DbError, CurrentDb> =>
	Effect.gen(function* () {
		const result: Record<string, RowValue> = {};
		for (const field of include.fields) {
			result[field.key] = yield* evalIncludeExprForField(userId, field.expr, row, include);
		}
		return result;
	});

const executeIncludeForParentRow = (
	userId: string,
	parentRow: BaseEntityQueryRow,
	include: IncludeEntry,
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
			visibleSchemas.map((schema) => sql`${schema.id}`),
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
					es.is_builtin AS "schemaIsBuiltin",
					r.id AS "relationshipId",
					r.created_at AS "relationshipCreatedAt",
					r.source_entity_id AS "relationshipSourceEntityId",
					r.target_entity_id AS "relationshipTargetEntityId",
					r.properties AS "relationshipProperties",
					rs.slug AS "relationshipSchemaSlug",
					rs.name AS "relationshipSchemaName",
					rs.is_builtin AS "relationshipSchemaIsBuiltin"
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

export const serializeIncludesForRow = (
	userId: string,
	row: BaseEntityQueryRow,
	includes: readonly IncludeEntry[],
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
