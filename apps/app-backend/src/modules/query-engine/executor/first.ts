import { sql } from "drizzle-orm";
import { Effect } from "effect";

import { CurrentDb, dbEffect } from "#lib/db";
import type { DbError, NotFound } from "#lib/errors";

import type { EntitySource, Expr, FieldValue, NestedEventSource } from "../language";
import {
	evalEventFieldSelector,
	evalFieldSelector,
	evalRelationshipFieldSelector,
	valueToFieldValue,
} from "./field-values";
import {
	loadVisibleEntitySchemas,
	loadVisibleEventSchemas,
	loadVisibleRelationshipSchema,
} from "./schema-loaders";
import { fieldSelectorToOrderSql } from "./sql";
import type { BaseEntityQueryRow, EventQueryRow, IncludeQueryRow } from "./types";

type FirstExpr = Extract<Expr, { type: "first" }>;

const orderEntrySql = (
	exprSql: ReturnType<typeof sql> | null,
	order: "asc" | "desc",
): ReturnType<typeof sql> => {
	if (!exprSql) {
		return sql`1`;
	}
	return order === "asc" ? sql`${exprSql} ASC` : sql`${exprSql} DESC`;
};

export const eventFirstOrderSql = (
	source: NestedEventSource,
	orderBy: FirstExpr["orderBy"],
): ReturnType<typeof sql> => {
	const orderParts = orderBy.map((entry) => {
		if (entry.expr.type !== "ref" || entry.expr.sourceAlias !== source.alias) {
			return sql`1`;
		}
		return orderEntrySql(
			fieldSelectorToOrderSql(entry.expr.field, source.schemas, "ev"),
			entry.order,
		);
	});
	return sql.join(orderParts, sql`, `);
};

export const entityFirstOrderSql = (
	source: EntitySource,
	orderBy: FirstExpr["orderBy"],
): ReturnType<typeof sql> => {
	const viaAlias = source.via?.alias;
	const orderParts = orderBy.map((entry) => {
		if (entry.expr.type !== "ref") {
			return sql`1`;
		}
		const alias =
			entry.expr.sourceAlias === source.alias
				? "e"
				: entry.expr.sourceAlias === viaAlias
					? "r"
					: null;
		if (alias === null) {
			return sql`1`;
		}
		return orderEntrySql(
			fieldSelectorToOrderSql(entry.expr.field, source.schemas, alias),
			entry.order,
		);
	});
	return sql.join(orderParts, sql`, `);
};

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
		return valueToFieldValue(expr.value);
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
		return valueToFieldValue(expr.value);
	}
	return { kind: "null", value: null };
};

export const executeEventFirst = (
	userId: string,
	anchor: BaseEntityQueryRow,
	source: NestedEventSource,
	expr: FirstExpr,
): Effect.Effect<FieldValue, NotFound | DbError, CurrentDb> =>
	Effect.gen(function* () {
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

export const executeEntityFirst = (
	userId: string,
	anchor: BaseEntityQueryRow,
	source: EntitySource,
	expr: FirstExpr,
): Effect.Effect<FieldValue, NotFound | DbError, CurrentDb> =>
	Effect.gen(function* () {
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
