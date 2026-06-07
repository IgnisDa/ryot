import { sql } from "drizzle-orm";
import { Effect } from "effect";

import { CurrentDb, dbEffect } from "#lib/db";
import type { DbError, NotFound } from "#lib/errors";

import type { Expr, FieldValue, NestedEventSourceV2 } from "../language";
import { evalEventFieldSelector, evalFieldSelector, valueToFieldValue } from "./field-values";
import { loadVisibleEventSchemas } from "./schema-loaders";
import { fieldSelectorToOrderSql } from "./sql";
import type { BaseEntityQueryRow, EventQueryRow } from "./types";

const firstOrderSql = (
	source: NestedEventSourceV2,
	orderBy: Extract<Expr, { type: "first" }>["orderBy"],
): ReturnType<typeof sql> => {
	const orderParts = orderBy.map((entry) => {
		if (entry.expr.type !== "ref") {
			return sql`1`;
		}

		const alias = entry.expr.sourceAlias === source.alias ? "ev" : "e";
		const schemas = alias === "ev" ? source.schemas : (["__entity__"] as [string, ...string[]]);
		const exprSql = fieldSelectorToOrderSql(entry.expr.field, schemas, alias);
		if (!exprSql) {
			return sql`1`;
		}
		return entry.order === "asc" ? sql`${exprSql} ASC` : sql`${exprSql} DESC`;
	});
	return sql.join(orderParts, sql`, `);
};

const evalFirstSelect = (
	expr: Expr,
	row: EventQueryRow,
	source: NestedEventSourceV2,
): FieldValue => {
	if (expr.type === "ref" && expr.sourceAlias === source.alias) {
		return evalEventFieldSelector(expr.field, row);
	}
	if (expr.type === "ref" && expr.sourceAlias === source.entityRef) {
		return evalFieldSelector(expr.field, row);
	}
	if (expr.type === "literal") {
		return valueToFieldValue(expr.value);
	}
	return { kind: "null", value: null };
};

export const executeEventFirst = (
	userId: string,
	row: BaseEntityQueryRow,
	expr: Extract<Expr, { type: "first" }>,
): Effect.Effect<FieldValue, NotFound | DbError, CurrentDb> =>
	Effect.gen(function* () {
		if (expr.source.type !== "events") {
			return { kind: "null" as const, value: null };
		}

		const eventSchemas = yield* loadVisibleEventSchemas(userId, row.schemaId, expr.source.schemas);
		const eventSchemaIdsSql = sql.join(
			eventSchemas.map((schema) => sql`${schema.id}`),
			sql`, `,
		);
		const orderSql = firstOrderSql(expr.source, expr.orderBy);
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
					ev.id AS "eventId",
					ev.properties AS "eventProperties",
					ev.created_at AS "eventCreatedAt",
					ev.updated_at AS "eventUpdatedAt",
					ev.occurred_at AS "eventOccurredAt",
					evs.id AS "eventSchemaId",
					evs.slug AS "eventSchemaSlug",
					evs.name AS "eventSchemaName",
					1 AS "totalCount"
				FROM event ev
				JOIN event_schema evs ON evs.id = ev.event_schema_id
				JOIN entity e ON e.id = ev.entity_id
				JOIN entity_schema es ON es.id = e.entity_schema_id
				WHERE
					ev.entity_id = ${row.id}
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
		return evalFirstSelect(expr.select, firstRow, expr.source);
	});
