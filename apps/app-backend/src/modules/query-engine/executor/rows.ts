import { sql } from "drizzle-orm";
import { Effect } from "effect";

import { CurrentDb, dbEffect } from "#lib/db/service";
import { BadRequest, type DbError, type NotFound } from "#lib/errors";

import type { Expr, FieldDef, IncludeEntry, RowItem, RowsResponse } from "../language";
import { compileBool, compileOrderBySql } from "./compile/expr";
import { userVisibleSql, type SqlFragment } from "./compile/fragments";
import { compileIncludes, type CompiledIncludes } from "./compile/includes";
import type { CompileScope } from "./compile/scope";
import { rootScope } from "./compile/scope";
import { outputColumnsSql, reconstructRowItem } from "./compile/select-list";
import { reconstructIncludes } from "./reshape";
import { loadRelationshipRootVisibleSchemas } from "./root-source";
import {
	loadVisibleEntitySchemas,
	loadVisibleEventSchemasForEntitySchemas,
} from "./schema-loaders";
import type { RowsQueryDocument } from "./types";

type RootPagination = RowsQueryDocument["output"]["pagination"];

const idListSql = (schemas: readonly { id: string }[]): SqlFragment =>
	sql.join(
		schemas.map((schema) => sql`${schema.id}`),
		sql`, `,
	);

const whereTail = (where: SqlFragment | null): SqlFragment => (where ? sql`AND ${where}` : sql``);

const rowsResponse = (
	items: readonly RowItem[],
	pagination: RootPagination,
	total: number,
	offset: number,
): RowsResponse => ({
	type: "rows",
	data: {
		items,
		pageInfo: {
			total,
			page: pagination.page,
			limit: pagination.limit,
			hasMore: offset + items.length < total,
		},
	},
});

const selectListSql = (
	fields: readonly FieldDef[],
	scope: CompileScope,
	includes: CompiledIncludes,
): SqlFragment => {
	const columns: SqlFragment[] = [];
	if (fields.length > 0) {
		columns.push(outputColumnsSql(fields, scope));
	}
	if (includes.count > 0) {
		columns.push(includes.columns);
	}
	columns.push(sql`COUNT(*) OVER() AS "totalCount"`);
	return sql.join(columns, sql`, `);
};

const reconstructRows = (
	rows: readonly Record<string, unknown>[],
	fields: readonly FieldDef[],
	includes: readonly IncludeEntry[],
): RowItem[] =>
	rows.map((row) => {
		const item = reconstructRowItem(row, fields);
		Object.assign(item, reconstructIncludes(row, includes));
		return item;
	});

const compiledWhere = (where: Expr | null, scope: CompileScope): SqlFragment | null =>
	where ? compileBool(where, scope) : null;

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
		return rowsResponse([], output.pagination, 0, offset);
	}

	const scope = rootScope(source, userId);
	const where = compiledWhere(source.where, scope);
	const includes = compileIncludes(output.include ?? [], scope, "e");
	const db = yield* CurrentDb;
	const rawRows = yield* dbEffect(() =>
		db.execute(sql`
			SELECT ${selectListSql(output.fields, scope, includes)}
			FROM entity e
			JOIN entity_schema es ON es.id = e.entity_schema_id
			${includes.laterals}
			WHERE e.entity_schema_id IN (${idListSql(visibleSchemas)})
				AND ${userVisibleSql("e", userId)}
				${whereTail(where)}
			ORDER BY ${compileOrderBySql(output.orderBy, scope)}
			LIMIT ${output.pagination.limit} OFFSET ${offset}
		`),
	);

	const items = reconstructRows(rawRows.rows, output.fields, output.include ?? []);
	const total = rawRows.rows[0] ? Number(rawRows.rows[0].totalCount) : 0;
	return rowsResponse(items, output.pagination, total, offset);
});

const executeEventRowsQuery = Effect.fn("executeEventRowsQuery")(function* (
	userId: string,
	doc: RowsQueryDocument,
) {
	const { source, output } = doc;
	if (source.type !== "events") {
		return yield* new BadRequest({ message: "Event rows query requires an event source" });
	}
	const offset = (output.pagination.page - 1) * output.pagination.limit;
	const visibleEntitySchemas = yield* loadVisibleEntitySchemas(userId, source.entity.schemas);
	const entitySchemaIds = visibleEntitySchemas.map((schema) => schema.id);
	const visibleEventSchemas = yield* loadVisibleEventSchemasForEntitySchemas(
		userId,
		entitySchemaIds,
		source.schemas,
	);
	if (visibleEventSchemas.length === 0) {
		return rowsResponse([], output.pagination, 0, offset);
	}

	const scope = rootScope(source, userId);
	const where = compiledWhere(source.where, scope);
	const includes = compileIncludes(output.include ?? [], scope, "e");
	const db = yield* CurrentDb;
	const rawRows = yield* dbEffect(() =>
		db.execute(sql`
			SELECT ${selectListSql(output.fields, scope, includes)}
			FROM event ev
			JOIN event_schema evs ON evs.id = ev.event_schema_id
			JOIN entity e ON e.id = ev.entity_id
			JOIN entity_schema es ON es.id = e.entity_schema_id
			${includes.laterals}
			WHERE ev.user_id = ${userId}
				AND ev.event_schema_id IN (${idListSql(visibleEventSchemas)})
				AND e.entity_schema_id IN (${sql.join(
					entitySchemaIds.map((id) => sql`${id}`),
					sql`, `,
				)})
				AND ${userVisibleSql("e", userId)}
				${whereTail(where)}
			ORDER BY ${compileOrderBySql(output.orderBy, scope)}
			LIMIT ${output.pagination.limit} OFFSET ${offset}
		`),
	);

	const items = reconstructRows(rawRows.rows, output.fields, output.include ?? []);
	const total = rawRows.rows[0] ? Number(rawRows.rows[0].totalCount) : 0;
	return rowsResponse(items, output.pagination, total, offset);
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
	const offset = (output.pagination.page - 1) * output.pagination.limit;
	const [relationshipSchemas, sourceEntitySchemas, targetEntitySchemas] =
		yield* loadRelationshipRootVisibleSchemas(userId, source);
	if (relationshipSchemas.length === 0) {
		return rowsResponse([], output.pagination, 0, offset);
	}

	const scope = rootScope(source, userId);
	const where = compiledWhere(source.where, scope);
	const db = yield* CurrentDb;
	const rawRows = yield* dbEffect(() =>
		db.execute(sql`
			SELECT ${outputColumnsSql(output.fields, scope)}, COUNT(*) OVER() AS "totalCount"
			FROM relationship r
			JOIN relationship_schema rs ON rs.id = r.relationship_schema_id
			JOIN entity se ON se.id = r.source_entity_id
			JOIN entity_schema ses ON ses.id = se.entity_schema_id
			JOIN entity te ON te.id = r.target_entity_id
			JOIN entity_schema tes ON tes.id = te.entity_schema_id
			WHERE r.relationship_schema_id IN (${idListSql(relationshipSchemas)})
				AND se.entity_schema_id IN (${idListSql(sourceEntitySchemas)})
				AND te.entity_schema_id IN (${idListSql(targetEntitySchemas)})
				AND ${userVisibleSql("r", userId)}
				AND ${userVisibleSql("se", userId)}
				AND ${userVisibleSql("te", userId)}
				${whereTail(where)}
			ORDER BY ${compileOrderBySql(output.orderBy, scope)}
			LIMIT ${output.pagination.limit} OFFSET ${offset}
		`),
	);

	const items = reconstructRows(rawRows.rows, output.fields, []);
	const total = rawRows.rows[0] ? Number(rawRows.rows[0].totalCount) : 0;
	return rowsResponse(items, output.pagination, total, offset);
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
