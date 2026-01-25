import { BadRequest } from "@ryot/contract/errors";
import type {
	Expr,
	FieldDef,
	IncludeEntry,
	RowItem,
	RowsResponse,
} from "@ryot/contract/modules/query-engine/language";
import { sql } from "drizzle-orm";
import { Effect } from "effect";

import { CurrentDb, dbEffect } from "#lib/infrastructure/db/service";

import type { QueryExecutionScope } from "../execution-scope";
import { compileBool, compileOrderBySql } from "./compile/expr";
import { entitySourceSql, rowVisibleSql, type SqlFragment } from "./compile/fragments";
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

// Unreachable default for a union-exhaustive switch over `doc.source.type`.
const absurdSourceType = (_source: never): never => {
	throw new Error("query-engine executor: unhandled rows source type");
};

const idListSql = (schemas: readonly { id: string }[]): SqlFragment =>
	sql.join(
		schemas.map((schema) => sql`${schema.id}`),
		sql`, `,
	);

const entitySchemaRowsSql = (schemas: readonly { slug: string; name: string }[]) =>
	sql.join(
		schemas.map((schema) => sql`(${schema.slug}, ${schema.name})`),
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
	executionScope: QueryExecutionScope,
	language: string | null,
	doc: RowsQueryDocument,
) {
	const { source, output } = doc;
	if (source.type !== "entities") {
		return yield* new BadRequest({ message: "Entity rows query requires an entity source" });
	}
	const offset = (output.pagination.page - 1) * output.pagination.limit;
	const visibleSchemas = yield* loadVisibleEntitySchemas(executionScope, source.schemas);
	if (visibleSchemas.length === 0) {
		return rowsResponse([], output.pagination, 0, offset);
	}

	const scope = rootScope(source, executionScope, language);
	const where = compiledWhere(source.where, scope);
	const includes = compileIncludes(output.include ?? [], scope, "e");
	const db = yield* CurrentDb;
	const rawRows = yield* dbEffect(() =>
		db.execute(sql`
			SELECT ${selectListSql(output.fields, scope, includes)}
			FROM ${entitySourceSql(language)} e
			JOIN (VALUES ${entitySchemaRowsSql(visibleSchemas)}) AS es(slug, name)
				ON es.slug = e.entity_schema_slug
			${includes.laterals}
			WHERE e.entity_schema_slug IN (${idListSql(visibleSchemas)})
				AND ${rowVisibleSql("entity", "e", executionScope)}
				${whereTail(where)}
			ORDER BY ${compileOrderBySql(output.orderBy, scope)}
			LIMIT ${output.pagination.limit} OFFSET ${offset}
		`),
	);

	const items = reconstructRows(rawRows.rows, output.fields, output.include ?? []);
	const total = rawRows.rows[0] ? Number(rawRows.rows[0]["totalCount"]) : 0;
	return rowsResponse(items, output.pagination, total, offset);
});

const executeEventRowsQuery = Effect.fn("executeEventRowsQuery")(function* (
	executionScope: QueryExecutionScope,
	language: string | null,
	doc: RowsQueryDocument,
) {
	const { source, output } = doc;
	if (source.type !== "events") {
		return yield* new BadRequest({ message: "Event rows query requires an event source" });
	}
	const offset = (output.pagination.page - 1) * output.pagination.limit;
	const visibleEntitySchemas = yield* loadVisibleEntitySchemas(
		executionScope,
		source.entity.schemas,
	);
	const entitySchemaSlugs = visibleEntitySchemas.map((schema) => schema.id);
	const visibleEventSchemas = yield* loadVisibleEventSchemasForEntitySchemas(
		executionScope,
		entitySchemaSlugs,
		source.schemas,
	);
	if (visibleEventSchemas.length === 0) {
		return rowsResponse([], output.pagination, 0, offset);
	}

	const scope = rootScope(source, executionScope, language);
	const where = compiledWhere(source.where, scope);
	const includes = compileIncludes(output.include ?? [], scope, "e");
	const db = yield* CurrentDb;
	const rawRows = yield* dbEffect(() =>
		db.execute(sql`
			SELECT ${selectListSql(output.fields, scope, includes)}
			FROM event ev
			JOIN ${entitySourceSql(language)} e ON e.id = ev.entity_id
			${includes.laterals}
			WHERE ${rowVisibleSql("event", "ev", executionScope)}
				AND ev.event_schema_slug IN (${idListSql(visibleEventSchemas)})
				AND e.entity_schema_slug IN (${sql.join(
					entitySchemaSlugs.map((id) => sql`${id}`),
					sql`, `,
				)})
				AND ${rowVisibleSql("entity", "e", executionScope)}
				${whereTail(where)}
			ORDER BY ${compileOrderBySql(output.orderBy, scope)}
			LIMIT ${output.pagination.limit} OFFSET ${offset}
		`),
	);

	const items = reconstructRows(rawRows.rows, output.fields, output.include ?? []);
	const total = rawRows.rows[0] ? Number(rawRows.rows[0]["totalCount"]) : 0;
	return rowsResponse(items, output.pagination, total, offset);
});

const executeRelationshipRowsQuery = Effect.fn("executeRelationshipRowsQuery")(function* (
	executionScope: QueryExecutionScope,
	language: string | null,
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
		yield* loadRelationshipRootVisibleSchemas(executionScope, source);
	if (relationshipSchemas.length === 0) {
		return rowsResponse([], output.pagination, 0, offset);
	}

	const scope = rootScope(source, executionScope, language);
	const where = compiledWhere(source.where, scope);
	const db = yield* CurrentDb;
	const rawRows = yield* dbEffect(() =>
		db.execute(sql`
			SELECT ${outputColumnsSql(output.fields, scope)}, COUNT(*) OVER() AS "totalCount"
			FROM relationship r
			JOIN ${entitySourceSql(language)} se ON se.id = r.source_entity_id
			JOIN ${entitySourceSql(language)} te ON te.id = r.target_entity_id
			WHERE r.relationship_schema_slug IN (${idListSql(relationshipSchemas)})
				AND se.entity_schema_slug IN (${idListSql(sourceEntitySchemas)})
				AND te.entity_schema_slug IN (${idListSql(targetEntitySchemas)})
				AND ${rowVisibleSql("relationship", "r", executionScope)}
				AND ${rowVisibleSql("entity", "se", executionScope, {
					type: "relationshipEndpoint",
					endpoint: "source",
					relationshipSchemaSlugs: source.schemas,
				})}
				AND ${rowVisibleSql("entity", "te", executionScope, {
					type: "relationshipEndpoint",
					endpoint: "target",
					relationshipSchemaSlugs: source.schemas,
				})}
				${whereTail(where)}
			ORDER BY ${compileOrderBySql(output.orderBy, scope)}
			LIMIT ${output.pagination.limit} OFFSET ${offset}
		`),
	);

	const items = reconstructRows(rawRows.rows, output.fields, []);
	const total = rawRows.rows[0] ? Number(rawRows.rows[0]["totalCount"]) : 0;
	return rowsResponse(items, output.pagination, total, offset);
});

export const executeRowsQuery = (
	executionScope: QueryExecutionScope,
	language: string | null,
	doc: RowsQueryDocument,
) => {
	switch (doc.source.type) {
		case "events":
			return executeEventRowsQuery(executionScope, language, doc);
		case "relationships":
			return executeRelationshipRowsQuery(executionScope, language, doc);
		case "entities":
			return executeEntityRowsQuery(executionScope, language, doc);
		default:
			return absurdSourceType(doc.source);
	}
};
