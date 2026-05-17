import { sql } from "drizzle-orm";
import { Effect } from "effect";

import { CurrentDb, dbEffect } from "#lib/db";

import type { EntitySource, Expr, FieldValue, NestedEventSource } from "../language";
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
	buildOrderBySql,
	entitySelectColumnsSql,
	eventSelectColumnsSql,
	relationshipEdgeColumnsSql,
} from "./sql";
import type { BaseEntityQueryRow, EventQueryRow, IncludeQueryRow } from "./types";

type FirstExpr = Extract<Expr, { type: "first" }>;

export const eventFirstOrderSql = (source: NestedEventSource, orderBy: FirstExpr["orderBy"]) =>
	buildOrderBySql(orderBy, (ref) =>
		ref.sourceAlias === source.alias ? { alias: "ev", schemas: source.schemas } : null,
	);

export const entityFirstOrderSql = (source: EntitySource, orderBy: FirstExpr["orderBy"]) =>
	buildOrderBySql(orderBy, (ref) =>
		ref.sourceAlias === source.alias
			? { alias: "e", schemas: source.schemas }
			: ref.sourceAlias === source.via?.alias
				? { alias: "r", schemas: source.schemas }
				: null,
	);

const evalEventFirstSelect = (
	expr: Expr,
	row: EventQueryRow,
	source: NestedEventSource,
	anchor: BaseEntityQueryRow,
): FieldValue => {
	if (expr.type === "ref" && expr.sourceAlias === source.alias) {
		return evalEventFieldSelector(expr.field, row);
	}
	if (expr.type === "ref" && expr.sourceAlias === source.entityRef) {
		return evalFieldSelector(expr.field, anchor);
	}
	if (expr.type === "literal") {
		return literalToFieldValue(expr);
	}
	return { kind: "null", value: null };
};

const evalEntityFirstSelect = (
	expr: Expr,
	row: IncludeQueryRow,
	source: EntitySource,
	anchor: BaseEntityQueryRow,
): FieldValue => {
	if (expr.type === "ref" && expr.sourceAlias === source.alias) {
		return evalFieldSelector(expr.field, row);
	}
	if (expr.type === "ref" && expr.sourceAlias === source.via?.alias) {
		return evalRelationshipFieldSelector(expr.field, row);
	}
	if (expr.type === "ref" && expr.sourceAlias === source.via?.entityRef) {
		return evalFieldSelector(expr.field, anchor);
	}
	if (expr.type === "literal") {
		return literalToFieldValue(expr);
	}
	return { kind: "null", value: null };
};

export const executeEventFirst = Effect.fn("executeEventFirst")(function* (
	userId: string,
	anchor: BaseEntityQueryRow,
	source: NestedEventSource,
	expr: FirstExpr,
) {
	const eventSchemas = yield* loadVisibleEventSchemas(userId, anchor.schemaId, source.schemas);
	const eventSchemaIdsSql = sql.join(
		eventSchemas.map((schema) => sql`${schema.id}`),
		sql`, `,
	);
	const orderSql = eventFirstOrderSql(source, expr.orderBy);
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
					ev.entity_id = ${anchor.id}
					AND ev.user_id = ${userId}
					AND ev.event_schema_id IN (${eventSchemaIdsSql})
					AND (e.user_id = ${userId} OR e.user_id IS NULL)
				ORDER BY ${orderSql}
				LIMIT 1
			`),
	);

	const firstRow = rawRows.rows[0];
	if (!firstRow) {
		return { kind: "null" as const, value: null };
	}
	return evalEventFirstSelect(expr.select, firstRow, source, anchor);
});

export const executeEntityFirst = Effect.fn("executeEntityFirst")(function* (
	userId: string,
	anchor: BaseEntityQueryRow,
	source: EntitySource,
	expr: FirstExpr,
) {
	if (source.via === undefined) {
		return { kind: "null" as const, value: null };
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
	const orderSql = entityFirstOrderSql(source, expr.orderBy);
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
					AND ${anchorColumn} = ${anchor.id}
					AND e.entity_schema_id IN (${schemaIdsSql})
					AND (r.user_id = ${userId} OR r.user_id IS NULL)
					AND (e.user_id = ${userId} OR e.user_id IS NULL)
				ORDER BY ${orderSql}
				LIMIT 1
			`),
	);

	const firstRow = rawRows.rows[0];
	if (!firstRow) {
		return { kind: "null" as const, value: null };
	}
	return evalEntityFirstSelect(expr.select, firstRow, source, anchor);
});
