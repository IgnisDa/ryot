import { sql } from "drizzle-orm";
import { Effect } from "effect";

import { CurrentDb, dbEffect } from "#lib/db";
import { BadRequest, type DbError, type NotFound } from "#lib/errors";

import type { Expr, IncludeEntry, RowItem, RowsResponse } from "../language";
import { makeEntityContext, makeEventRootContext, makeRelationshipRootContext } from "./context";
import { evalExprAsBoolean } from "./expr";
import { serializeIncludesForRow } from "./includes";
import {
	loadVisibleEntitySchemas,
	loadVisibleEventSchemasForEntitySchemas,
} from "./schema-loaders";
import { serializeEventRootRow, serializeRelationshipRootRow, serializeRootRow } from "./serialize";
import { loadRelationshipRootVisibleSchemas } from "./source-matches";
import {
	buildOrderBySql,
	entitySelectColumnsSql,
	eventRootOrderSql,
	eventSelectColumnsSql,
	relationshipRootOrderSql,
	relationshipRootSelectSql,
	relationshipRootWherePushdown,
	wherePushdown,
	wherePushdownSql,
} from "./sql";
import {
	MAX_ROOT_FILTER_SCAN_ROWS,
	MAX_SERIALIZED_ROW_OBJECTS,
	type BaseEntityQueryRow,
	type EntityQueryRow,
	type EventQueryRow,
	type RelationshipRootQueryRow,
	type RowContext,
	type RowsQueryDocument,
} from "./types";

type RootPagination = RowsQueryDocument["output"]["pagination"];

const resolveRootPage = Effect.fn("resolveRootPage")(function* <
	T extends { totalCount: string | bigint },
>(
	userId: string,
	where: Expr | null,
	rawRows: readonly T[],
	offset: number,
	limit: number,
	makeContext: (row: T) => RowContext,
) {
	if (where === null) {
		const total = rawRows[0]?.totalCount !== undefined ? Number(rawRows[0].totalCount) : 0;
		return { total, rows: [...rawRows] };
	}
	if (rawRows.length > MAX_ROOT_FILTER_SCAN_ROWS) {
		return yield* new BadRequest({
			message: `Root filter candidate rows exceeds maximum of ${MAX_ROOT_FILTER_SCAN_ROWS}`,
		});
	}
	const filtered: T[] = [];
	for (const row of rawRows) {
		if (yield* evalExprAsBoolean(userId, where, makeContext(row))) {
			filtered.push(row);
		}
	}
	return { total: filtered.length, rows: filtered.slice(offset, offset + limit) };
});

const serializeRootRowsWithIncludes = Effect.fn("serializeRootRowsWithIncludes")(function* <
	T extends BaseEntityQueryRow,
>(
	userId: string,
	rows: readonly T[],
	include: readonly IncludeEntry[],
	serializeRow: (row: T) => Effect.Effect<RowItem, BadRequest | NotFound | DbError, CurrentDb>,
	makeContext: (row: T) => RowContext,
) {
	let serializedRowCount = rows.length;
	const items: RowItem[] = [];
	for (const row of rows) {
		const item = yield* serializeRow(row);
		const includeValues = yield* serializeIncludesForRow(userId, row, include, makeContext(row));
		serializedRowCount += includeValues.rowCount;
		if (serializedRowCount > MAX_SERIALIZED_ROW_OBJECTS) {
			return yield* new BadRequest({
				message: `Serialized row object count exceeds maximum of ${MAX_SERIALIZED_ROW_OBJECTS}`,
			});
		}
		Object.assign(item, includeValues.values);
		items.push(item);
	}
	return items;
});

const rowsResponse = (
	items: readonly RowItem[],
	pagination: RootPagination,
	total: number,
	offset: number,
	returned: number,
): RowsResponse => ({
	type: "rows",
	data: {
		items,
		pageInfo: {
			total,
			page: pagination.page,
			limit: pagination.limit,
			hasMore: offset + returned < total,
		},
	},
});

const paginationSql = (pagination: RootPagination, where: Expr | null, offset: number) =>
	where === null ? sql`LIMIT ${pagination.limit} OFFSET ${offset}` : sql``;

const executeEntityRowsQuery = Effect.fn("executeEntityRowsQuery")(function* (
	userId: string,
	doc: RowsQueryDocument,
) {
	const { source, output } = doc;
	if (source.type !== "entities") {
		return yield* new BadRequest({ message: "Entity rows query requires an entity source" });
	}

	const offset = (output.pagination.page - 1) * output.pagination.limit;
	const visibleSchemas = yield* loadVisibleEntitySchemas(userId, source.schemas);
	if (visibleSchemas.length === 0) {
		return rowsResponse([], output.pagination, 0, offset, 0);
	}

	const schemaIdsSql = sql.join(
		visibleSchemas.map((schema) => sql`${schema.id}`),
		sql`, `,
	);
	const orderSql = buildOrderBySql(output.orderBy, () => ({
		alias: "e",
		schemas: source.schemas,
	}));
	const pushdown = wherePushdown(
		source.where,
		(ref) => (ref.sourceAlias === source.alias ? { alias: "e", schemas: source.schemas } : null),
		{ userId },
	);
	const db = yield* CurrentDb;
	const rawRows = yield* dbEffect(() =>
		db.execute<EntityQueryRow>(sql`
				SELECT
					${entitySelectColumnsSql},
					COUNT(*) OVER() AS "totalCount"
				FROM entity e
				JOIN entity_schema es ON es.id = e.entity_schema_id
				WHERE
					e.entity_schema_id IN (${schemaIdsSql})
					AND (e.user_id = ${userId} OR e.user_id IS NULL)
					${wherePushdownSql(pushdown.conditions)}
				ORDER BY ${orderSql}
				${paginationSql(output.pagination, pushdown.residual, offset)}
			`),
	);

	const { rows, total } = yield* resolveRootPage(
		userId,
		pushdown.residual,
		rawRows.rows,
		offset,
		output.pagination.limit,
		(row) => makeEntityContext(source.alias, row),
	);
	const items = yield* serializeRootRowsWithIncludes(
		userId,
		rows,
		output.include ?? [],
		(row) => serializeRootRow(userId, row, source.alias, output.fields),
		(row) => makeEntityContext(source.alias, row),
	);
	return rowsResponse(items, output.pagination, total, offset, rows.length);
});

const executeEventRowsQuery = Effect.fn("executeEventRowsQuery")(function* (
	userId: string,
	doc: RowsQueryDocument,
) {
	const { source, output } = doc;
	if (source.type !== "events") {
		return yield* new BadRequest({ message: "Event rows query requires an event source" });
	}

	const visibleEntitySchemas = yield* loadVisibleEntitySchemas(userId, source.entity.schemas);
	const entitySchemaIds = visibleEntitySchemas.map((schema) => schema.id);
	const visibleEventSchemas = yield* loadVisibleEventSchemasForEntitySchemas(
		userId,
		entitySchemaIds,
		source.schemas,
	);

	const entitySchemaIdsSql = sql.join(
		entitySchemaIds.map((id) => sql`${id}`),
		sql`, `,
	);
	const eventSchemaIdsSql = sql.join(
		visibleEventSchemas.map((schema) => sql`${schema.id}`),
		sql`, `,
	);
	const offset = (output.pagination.page - 1) * output.pagination.limit;
	const orderSql = eventRootOrderSql(source, output);
	const pushdown = wherePushdown(
		source.where,
		(ref) =>
			ref.sourceAlias === source.alias
				? { alias: "ev", schemas: source.schemas }
				: ref.sourceAlias === source.entity.alias
					? { alias: "e", schemas: source.entity.schemas }
					: null,
		{ userId },
	);
	const db = yield* CurrentDb;
	const rawRows = yield* dbEffect(() =>
		db.execute<EventQueryRow>(sql`
				SELECT
					${entitySelectColumnsSql},
					${eventSelectColumnsSql},
					COUNT(*) OVER() AS "totalCount"
				FROM event ev
				JOIN event_schema evs ON evs.id = ev.event_schema_id
				JOIN entity e ON e.id = ev.entity_id
				JOIN entity_schema es ON es.id = e.entity_schema_id
				WHERE
					ev.user_id = ${userId}
					AND ev.event_schema_id IN (${eventSchemaIdsSql})
					AND e.entity_schema_id IN (${entitySchemaIdsSql})
					AND (e.user_id = ${userId} OR e.user_id IS NULL)
					${wherePushdownSql(pushdown.conditions)}
				ORDER BY ${orderSql}
				${paginationSql(output.pagination, pushdown.residual, offset)}
			`),
	);

	const { rows, total } = yield* resolveRootPage(
		userId,
		pushdown.residual,
		rawRows.rows,
		offset,
		output.pagination.limit,
		(row) => makeEventRootContext(source, row),
	);
	const items = yield* serializeRootRowsWithIncludes(
		userId,
		rows,
		output.include ?? [],
		(row) => serializeEventRootRow(userId, row, source, output.fields),
		(row) => makeEventRootContext(source, row),
	);
	return rowsResponse(items, output.pagination, total, offset, rows.length);
});

const executeRelationshipRowsQuery = Effect.fn("executeRelationshipRowsQuery")(function* (
	userId: string,
	doc: RowsQueryDocument,
) {
	const { source, output } = doc;
	if (source.type !== "relationships") {
		return yield* new BadRequest({
			message: "Relationship rows query requires a relationship source",
		});
	}

	const [visibleRelationshipSchemas, visibleSourceEntitySchemas, visibleTargetEntitySchemas] =
		yield* loadRelationshipRootVisibleSchemas(userId, source);

	const relationshipSchemaIdsSql = sql.join(
		visibleRelationshipSchemas.map((schema) => sql`${schema.id}`),
		sql`, `,
	);
	const sourceEntitySchemaIdsSql = sql.join(
		visibleSourceEntitySchemas.map((schema) => sql`${schema.id}`),
		sql`, `,
	);
	const targetEntitySchemaIdsSql = sql.join(
		visibleTargetEntitySchemas.map((schema) => sql`${schema.id}`),
		sql`, `,
	);
	const offset = (output.pagination.page - 1) * output.pagination.limit;
	const orderSql = relationshipRootOrderSql(source, output);
	const pushdown = relationshipRootWherePushdown(source, userId);
	const db = yield* CurrentDb;
	const rawRows = yield* dbEffect(() =>
		db.execute<RelationshipRootQueryRow>(sql`
				${relationshipRootSelectSql(
					relationshipSchemaIdsSql,
					sourceEntitySchemaIdsSql,
					targetEntitySchemaIdsSql,
					userId,
					pushdown.conditions,
				)}
				ORDER BY ${orderSql}
				${paginationSql(output.pagination, pushdown.residual, offset)}
			`),
	);

	const { rows, total } = yield* resolveRootPage(
		userId,
		pushdown.residual,
		rawRows.rows,
		offset,
		output.pagination.limit,
		(row) => makeRelationshipRootContext(source, row),
	);
	const items: RowItem[] = [];
	for (const row of rows) {
		items.push(yield* serializeRelationshipRootRow(userId, row, source, output.fields));
	}
	return rowsResponse(items, output.pagination, total, offset, rows.length);
});

export const executeRowsQuery = (
	userId: string,
	doc: RowsQueryDocument,
): Effect.Effect<RowsResponse, BadRequest | NotFound | DbError, CurrentDb> =>
	doc.source.type === "events"
		? executeEventRowsQuery(userId, doc)
		: doc.source.type === "relationships"
			? executeRelationshipRowsQuery(userId, doc)
			: executeEntityRowsQuery(userId, doc);
