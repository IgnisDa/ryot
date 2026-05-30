import { sql } from "drizzle-orm";
import { Effect } from "effect";

import { CurrentDb, dbEffect } from "#lib/db";
import { BadRequest, type DbError, type NotFound } from "#lib/errors";

import type { Expr, IncludeEntry, NestedEventSource, RowItem, RowValue } from "../language";
import { makeEventIncludeContext, makeIncludeContext } from "./context";
import { evalExprAsBoolean, evalExprValue } from "./expr";
import {
	evalEventFieldSelector,
	evalFieldSelector,
	evalRelationshipFieldSelector,
	literalToFieldValue,
} from "./field-values";
import {
	loadVisibleEntitySchemas,
	loadVisibleEventSchemas,
	loadVisibleRelationshipSchema,
} from "./schema-loaders";
import {
	entitySelectColumnsSql,
	eventIncludeOrderSql,
	eventSelectColumnsSql,
	includeOrderSql,
	relationshipEdgeColumnsSql,
	wherePushdown,
	wherePushdownSql,
} from "./sql";
import {
	MAX_INCLUDE_FILTER_SCAN_ROWS,
	MAX_SERIALIZED_ROW_OBJECTS,
	type BaseEntityQueryRow,
	type EventQueryRow,
	type IncludeQueryRow,
	type RowContext,
} from "./types";

type IncludeRows<TRow> = { rows: TRow[]; hasMore: boolean };

const limitFilteredRows = <TRow>(rows: TRow[], limit: number): IncludeRows<TRow> => ({
	rows: rows.slice(0, limit),
	hasMore: rows.length > limit,
});

const executeEntityIncludeForParentRow = Effect.fn("executeEntityIncludeForParentRow")(function* (
	userId: string,
	parentRow: BaseEntityQueryRow,
	include: IncludeEntry,
	parentContext: RowContext,
) {
	const source = include.source;
	if (source.type !== "entities" || source.via === undefined) {
		return { rows: [], hasMore: false };
	}
	const via = source.via;

	const [relationshipSchema, visibleSchemas] = yield* Effect.all([
		loadVisibleRelationshipSchema(userId, via.schema),
		loadVisibleEntitySchemas(userId, source.schemas),
	]);
	const schemaIdsSql = sql.join(
		visibleSchemas.map((schema) => sql`${schema.id}`),
		sql`, `,
	);
	const anchorColumn =
		via.direction === "outgoing" ? sql`r.source_entity_id` : sql`r.target_entity_id`;
	const childColumn =
		via.direction === "outgoing" ? sql`r.target_entity_id` : sql`r.source_entity_id`;
	const orderSql = includeOrderSql(source, include.orderBy);
	const pushdown = wherePushdown(
		source.where,
		(ref) =>
			ref.sourceAlias === source.alias
				? { alias: "e", schemas: source.schemas }
				: ref.sourceAlias === via.alias
					? { alias: "r", schemas: [via.schema] }
					: null,
		{ userId },
	);
	const limitSql =
		pushdown.residual === null
			? sql`LIMIT ${include.limit + 1}`
			: sql`LIMIT ${MAX_INCLUDE_FILTER_SCAN_ROWS + 1}`;
	const db = yield* CurrentDb;

	const rawRows = yield* dbEffect(() =>
		db.execute<IncludeQueryRow>(sql`
				SELECT
					${entitySelectColumnsSql},
					${relationshipEdgeColumnsSql},
					1 AS "totalCount"
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
					${wherePushdownSql(pushdown.conditions)}
				ORDER BY ${orderSql}
				${limitSql}
			`),
	);

	if (pushdown.residual === null) {
		return limitFilteredRows(rawRows.rows, include.limit);
	}
	if (rawRows.rows.length > MAX_INCLUDE_FILTER_SCAN_ROWS) {
		return yield* new BadRequest({
			message: `Include filter candidate rows exceeds maximum of ${MAX_INCLUDE_FILTER_SCAN_ROWS}`,
		});
	}

	const filtered: IncludeQueryRow[] = [];
	for (const row of rawRows.rows) {
		const context = makeIncludeContext(include, row, parentContext);
		if (yield* evalExprAsBoolean(userId, pushdown.residual, context)) {
			filtered.push(row);
		}
	}
	return limitFilteredRows(filtered, include.limit);
});

const executeEventIncludeForParentRow = Effect.fn("executeEventIncludeForParentRow")(function* (
	userId: string,
	parentRow: BaseEntityQueryRow,
	include: IncludeEntry,
	source: NestedEventSource,
	parentContext: RowContext,
) {
	const eventSchemas = yield* loadVisibleEventSchemas(userId, parentRow.schemaId, source.schemas);
	const eventSchemaIdsSql = sql.join(
		eventSchemas.map((schema) => sql`${schema.id}`),
		sql`, `,
	);
	const orderSql = eventIncludeOrderSql(source, include.orderBy);
	const pushdown = wherePushdown(
		source.where,
		(ref) => (ref.sourceAlias === source.alias ? { alias: "ev", schemas: source.schemas } : null),
		{ userId },
	);
	const limitSql =
		pushdown.residual === null
			? sql`LIMIT ${include.limit + 1}`
			: sql`LIMIT ${MAX_INCLUDE_FILTER_SCAN_ROWS + 1}`;
	const db = yield* CurrentDb;

	const rawRows = yield* dbEffect(() =>
		db.execute<EventQueryRow>(sql`
				SELECT
					${entitySelectColumnsSql},
					${eventSelectColumnsSql},
					1 AS "totalCount"
				FROM event ev
				JOIN event_schema evs ON evs.id = ev.event_schema_id
				JOIN entity e ON e.id = ev.entity_id
				JOIN entity_schema es ON es.id = e.entity_schema_id
				WHERE
					ev.entity_id = ${parentRow.id}
					AND ev.user_id = ${userId}
					AND ev.event_schema_id IN (${eventSchemaIdsSql})
					AND (e.user_id = ${userId} OR e.user_id IS NULL)
					${wherePushdownSql(pushdown.conditions)}
				ORDER BY ${orderSql}
				${limitSql}
			`),
	);

	if (pushdown.residual === null) {
		return limitFilteredRows(rawRows.rows, include.limit);
	}
	if (rawRows.rows.length > MAX_INCLUDE_FILTER_SCAN_ROWS) {
		return yield* new BadRequest({
			message: `Include filter candidate rows exceeds maximum of ${MAX_INCLUDE_FILTER_SCAN_ROWS}`,
		});
	}

	const filtered: EventQueryRow[] = [];
	for (const row of rawRows.rows) {
		const context = makeEventIncludeContext(source, row, parentContext);
		if (yield* evalExprAsBoolean(userId, pushdown.residual, context)) {
			filtered.push(row);
		}
	}
	return limitFilteredRows(filtered, include.limit);
});

const evalEntityIncludeExprForField = (
	userId: string,
	expr: Expr,
	row: IncludeQueryRow,
	include: IncludeEntry,
	parentContext: RowContext,
): Effect.Effect<RowValue, BadRequest | NotFound | DbError, CurrentDb> => {
	if (
		expr.type === "ref" &&
		include.source.type === "entities" &&
		expr.sourceAlias === include.source.via?.alias
	) {
		return Effect.succeed(evalRelationshipFieldSelector(expr.field, row));
	}
	if (expr.type === "ref" && expr.sourceAlias === include.source.alias) {
		return Effect.succeed(evalFieldSelector(expr.field, row));
	}
	if (expr.type === "literal") {
		return Effect.succeed(literalToFieldValue(expr));
	}
	return evalExprValue(userId, expr, makeIncludeContext(include, row, parentContext));
};

const evalEventIncludeExprForField = (
	userId: string,
	expr: Expr,
	row: EventQueryRow,
	source: NestedEventSource,
	parentContext: RowContext,
): Effect.Effect<RowValue, BadRequest | NotFound | DbError, CurrentDb> => {
	if (expr.type === "ref" && expr.sourceAlias === source.alias) {
		return Effect.succeed(evalEventFieldSelector(expr.field, row));
	}
	if (expr.type === "ref" && expr.sourceAlias === source.entityRef) {
		return Effect.succeed(evalFieldSelector(expr.field, row));
	}
	if (expr.type === "literal") {
		return Effect.succeed(literalToFieldValue(expr));
	}
	return evalExprValue(userId, expr, makeEventIncludeContext(source, row, parentContext));
};

const serializeEntityIncludeRow = Effect.fn("serializeEntityIncludeRow")(function* (
	userId: string,
	row: IncludeQueryRow,
	include: IncludeEntry,
	parentContext: RowContext,
) {
	const result: Record<string, RowValue> = {};
	for (const field of include.fields) {
		result[field.key] = yield* evalEntityIncludeExprForField(
			userId,
			field.expr,
			row,
			include,
			parentContext,
		);
	}
	return result;
});

const serializeEventIncludeRow = Effect.fn("serializeEventIncludeRow")(function* (
	userId: string,
	row: EventQueryRow,
	include: IncludeEntry,
	source: NestedEventSource,
	parentContext: RowContext,
) {
	const result: Record<string, RowValue> = {};
	for (const field of include.fields) {
		result[field.key] = yield* evalEventIncludeExprForField(
			userId,
			field.expr,
			row,
			source,
			parentContext,
		);
	}
	return result;
});

const serializeEventInclude = Effect.fn("serializeEventInclude")(function* (
	userId: string,
	parentRow: BaseEntityQueryRow,
	include: IncludeEntry,
	source: NestedEventSource,
	parentContext: RowContext,
) {
	const includeResult = yield* executeEventIncludeForParentRow(
		userId,
		parentRow,
		include,
		source,
		parentContext,
	);
	const items: RowItem[] = [];
	for (const eventRow of includeResult.rows) {
		items.push(yield* serializeEventIncludeRow(userId, eventRow, include, source, parentContext));
	}
	return {
		rowCount: includeResult.rows.length,
		value: { items, pageInfo: { limit: include.limit, hasMore: includeResult.hasMore } },
	};
});

export const serializeIncludesForRow = (
	userId: string,
	row: BaseEntityQueryRow,
	includes: readonly IncludeEntry[],
	parentContext: RowContext,
): Effect.Effect<
	{ rowCount: number; values: Record<string, RowValue> },
	BadRequest | NotFound | DbError,
	CurrentDb
> =>
	Effect.gen(function* () {
		let rowCount = 0;
		const values: Record<string, RowValue> = {};

		for (const include of includes) {
			if (include.source.type === "events") {
				const eventInclude = yield* serializeEventInclude(
					userId,
					row,
					include,
					include.source,
					parentContext,
				);
				rowCount += eventInclude.rowCount;
				values[include.key] = eventInclude.value;
				continue;
			}

			const includeResult = yield* executeEntityIncludeForParentRow(
				userId,
				row,
				include,
				parentContext,
			);
			rowCount += includeResult.rows.length;
			const items: RowItem[] = [];

			for (const includeRow of includeResult.rows) {
				const item = yield* serializeEntityIncludeRow(userId, includeRow, include, parentContext);
				const childContext = makeIncludeContext(include, includeRow, parentContext);
				const childIncludes = yield* serializeIncludesForRow(
					userId,
					includeRow,
					include.include ?? [],
					childContext,
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
