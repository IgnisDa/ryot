import { sql } from "drizzle-orm";
import { Effect } from "effect";

import { CurrentDb, dbEffect } from "#lib/db";
import { BadRequest, type DbError, type NotFound } from "#lib/errors";

import type { RowItem, RowsResponse } from "../language";
import { makeEntityContext, makeEventRootContext } from "./context";
import { evalExprAsBoolean } from "./expr";
import {
	loadVisibleEntitySchemas,
	loadVisibleEventSchemasForEntitySchemas,
} from "./schema-loaders";
import {
	serializeEventRootRow,
	serializeIncludesForRow,
	serializeRelationshipRootRow,
	serializeRootRow,
} from "./serialize";
import { loadRelationshipRootVisibleSchemas } from "./source-matches";
import {
	eventRootOrderSql,
	exprToOrderSql,
	relationshipRootOrderSql,
	relationshipRootSelectSql,
} from "./sql";
import {
	MAX_ROOT_FILTER_SCAN_ROWS,
	MAX_SERIALIZED_ROW_OBJECTS,
	type EntityQueryRow,
	type EventQueryRow,
	type RelationshipRootQueryRow,
	type RowsQueryDocument,
} from "./types";

const executeEntityRowsQuery = (
	userId: string,
	doc: RowsQueryDocument,
): Effect.Effect<RowsResponse, BadRequest | NotFound | DbError, CurrentDb> =>
	Effect.gen(function* () {
		const { source } = doc;
		const output = doc.output;
		if (source.type !== "entities") {
			return yield* new BadRequest({ message: "Entity rows query requires an entity source" });
		}

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

		const schemaIds = visibleSchemas.map((schema) => schema.id);
		const orderParts = output.orderBy.map((entry) => {
			const exprSql = exprToOrderSql(entry.expr, source.schemas);
			if (!exprSql) {
				return sql`1`;
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
		const paginationSql =
			source.where === null
				? sql`
					LIMIT ${output.pagination.limit}
					OFFSET ${offset}
				`
				: sql``;

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
					es.is_builtin AS "schemaIsBuiltin",
					COUNT(*) OVER() AS "totalCount"
				FROM entity e
				JOIN entity_schema es ON es.id = e.entity_schema_id
				WHERE
					e.entity_schema_id IN (${schemaIdsSql})
					AND (e.user_id = ${userId} OR e.user_id IS NULL)
				ORDER BY ${orderSql}
				${paginationSql}
			`),
		);

		const filteredRows: EntityQueryRow[] = [];
		if (source.where === null) {
			filteredRows.push(...rawRows.rows);
		} else {
			if (rawRows.rows.length > MAX_ROOT_FILTER_SCAN_ROWS) {
				return yield* new BadRequest({
					message: `Root filter candidate rows exceeds maximum of ${MAX_ROOT_FILTER_SCAN_ROWS}`,
				});
			}
			for (const row of rawRows.rows) {
				if (yield* evalExprAsBoolean(userId, source.where, makeEntityContext(source.alias, row))) {
					filteredRows.push(row);
				}
			}
		}

		const total =
			source.where === null
				? rawRows.rows[0]?.totalCount !== undefined
					? Number(rawRows.rows[0].totalCount)
					: 0
				: filteredRows.length;
		const rows =
			source.where === null
				? filteredRows
				: filteredRows.slice(offset, offset + output.pagination.limit);
		let serializedRowCount = rows.length;
		const items: RowItem[] = [];
		for (const row of rows) {
			const item = yield* serializeRootRow(userId, row, source.alias, output.fields);
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

const executeEventRowsQuery = (
	userId: string,
	doc: RowsQueryDocument,
): Effect.Effect<RowsResponse, BadRequest | NotFound | DbError, CurrentDb> =>
	Effect.gen(function* () {
		const { source } = doc;
		const output = doc.output;
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
		const orderSql = eventRootOrderSql(source, output);
		const db = yield* CurrentDb;
		const offset = (output.pagination.page - 1) * output.pagination.limit;
		const paginationSql =
			source.where === null
				? sql`
					LIMIT ${output.pagination.limit}
					OFFSET ${offset}
				`
				: sql``;

		const rawRows = yield* dbEffect(() =>
			db.execute<EventQueryRow>(sql`
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
					ev.id AS "eventId",
					ev.properties AS "eventProperties",
					ev.created_at AS "eventCreatedAt",
					ev.updated_at AS "eventUpdatedAt",
					ev.occurred_at AS "eventOccurredAt",
					evs.id AS "eventSchemaId",
					evs.slug AS "eventSchemaSlug",
					evs.name AS "eventSchemaName",
					evs.is_builtin AS "eventSchemaIsBuiltin",
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
				ORDER BY ${orderSql}
				${paginationSql}
			`),
		);

		const filteredRows: EventQueryRow[] = [];
		if (source.where === null) {
			filteredRows.push(...rawRows.rows);
		} else {
			if (rawRows.rows.length > MAX_ROOT_FILTER_SCAN_ROWS) {
				return yield* new BadRequest({
					message: `Root filter candidate rows exceeds maximum of ${MAX_ROOT_FILTER_SCAN_ROWS}`,
				});
			}
			for (const row of rawRows.rows) {
				if (yield* evalExprAsBoolean(userId, source.where, makeEventRootContext(source, row))) {
					filteredRows.push(row);
				}
			}
		}

		const total =
			source.where === null
				? rawRows.rows[0]?.totalCount !== undefined
					? Number(rawRows.rows[0].totalCount)
					: 0
				: filteredRows.length;
		const rows =
			source.where === null
				? filteredRows
				: filteredRows.slice(offset, offset + output.pagination.limit);
		let serializedRowCount = rows.length;
		const items: RowItem[] = [];
		for (const row of rows) {
			const item = yield* serializeEventRootRow(userId, row, source, output.fields);
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

const executeRelationshipRowsQuery = (
	userId: string,
	doc: RowsQueryDocument,
): Effect.Effect<RowsResponse, BadRequest | NotFound | DbError, CurrentDb> =>
	Effect.gen(function* () {
		const { source } = doc;
		const output = doc.output;
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
		const orderSql = relationshipRootOrderSql(source, output);
		const db = yield* CurrentDb;
		const offset = (output.pagination.page - 1) * output.pagination.limit;

		const rawRows = yield* dbEffect(() =>
			db.execute<RelationshipRootQueryRow>(sql`
				${relationshipRootSelectSql(
					relationshipSchemaIdsSql,
					sourceEntitySchemaIdsSql,
					targetEntitySchemaIdsSql,
					userId,
				)}
				ORDER BY ${orderSql}
				LIMIT ${output.pagination.limit}
				OFFSET ${offset}
			`),
		);

		const rows = rawRows.rows;
		const total = rows[0]?.totalCount !== undefined ? Number(rows[0].totalCount) : 0;
		const items: RowItem[] = [];
		for (const row of rows) {
			items.push(yield* serializeRelationshipRootRow(userId, row, source, output.fields));
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

export const executeRowsQuery = (
	userId: string,
	doc: RowsQueryDocument,
): Effect.Effect<RowsResponse, BadRequest | NotFound | DbError, CurrentDb> =>
	doc.source.type === "events"
		? executeEventRowsQuery(userId, doc)
		: doc.source.type === "relationships"
			? executeRelationshipRowsQuery(userId, doc)
			: executeEntityRowsQuery(userId, doc);
