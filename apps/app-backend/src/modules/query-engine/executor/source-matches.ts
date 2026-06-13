import { sql } from "drizzle-orm";
import { Effect } from "effect";

import { CurrentDb, dbEffect } from "#lib/db";
import { BadRequest, type DbError, type NotFound } from "#lib/errors";

import type {
	EntitySource,
	Expr,
	NestedEventSource,
	QueryDocument,
	RelationshipSource,
	RootEventSource,
	Source,
} from "../language";
import {
	cloneContext,
	eventSourceEntityRow,
	makeEmptyContext,
	makeEventRootContext,
	makeRelationshipRootContext,
	relationshipEntityRow,
} from "./context";
import {
	loadVisibleEntitySchemas,
	loadVisibleEventSchemas,
	loadVisibleEventSchemasForEntitySchemas,
	loadVisibleRelationshipSchema,
	loadVisibleRelationshipSchemas,
} from "./schema-loaders";
import { relationshipRootSelectSql } from "./sql";
import {
	MAX_AGGREGATE_EXPRESSION_SOURCE_ROWS,
	type EntityQueryRow,
	type EventQueryRow,
	type IncludeQueryRow,
	type RelationshipRootQueryRow,
	type RowContext,
	type SourceMatch,
} from "./types";

export type EvalExprAsBoolean = (
	userId: string,
	expr: Expr,
	context: RowContext,
) => Effect.Effect<boolean, BadRequest | NotFound | DbError, CurrentDb>;

// How many candidate rows an expression source may pull from the database.
// `unbounded` is for root aggregate/time-series sources that span the user's full
// dataset; `probe` is an `exists` short-circuit (top-N); `cap` bounds correlated
// expression sources and fails rather than silently considering a truncated set.
type FetchBound =
	| { mode: "unbounded" }
	| { mode: "probe"; limit: number }
	| { mode: "cap"; cap: number };

const fetchBoundLimitSql = (bound: FetchBound) =>
	bound.mode === "unbounded"
		? sql``
		: bound.mode === "probe"
			? sql`LIMIT ${bound.limit}`
			: sql`LIMIT ${bound.cap + 1}`;

const fetchBoundOverflow = (bound: FetchBound, fetched: number) =>
	bound.mode === "cap" && fetched > bound.cap
		? new BadRequest({
				message: `Expression source candidate rows exceeds maximum of ${bound.cap}`,
			})
		: null;

const executeEntitySourceMatches = (
	userId: string,
	context: RowContext,
	source: EntitySource,
	evalBoolean: EvalExprAsBoolean,
	bound: FetchBound,
): Effect.Effect<SourceMatch[], BadRequest | NotFound | DbError, CurrentDb> =>
	Effect.gen(function* () {
		const visibleSchemas = yield* loadVisibleEntitySchemas(userId, source.schemas);
		const schemaIdsSql = sql.join(
			visibleSchemas.map((schema) => sql`${schema.id}`),
			sql`, `,
		);
		const limitSql = fetchBoundLimitSql(bound);
		const db = yield* CurrentDb;
		let rows: IncludeQueryRow[] | EntityQueryRow[];

		if (source.via === undefined) {
			const rawRows = yield* dbEffect(() =>
				db.execute<EntityQueryRow>(sql`
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
						1 AS "totalCount"
					FROM entity e
					JOIN entity_schema es ON es.id = e.entity_schema_id
					WHERE
						e.entity_schema_id IN (${schemaIdsSql})
						AND (e.user_id = ${userId} OR e.user_id IS NULL)
					${limitSql}
				`),
			);
			rows = rawRows.rows;
		} else {
			const parentRow = context.entities.get(source.via.entityRef);
			if (parentRow === undefined) {
				return [];
			}

			const relationshipSchema = yield* loadVisibleRelationshipSchema(userId, source.via.schema);
			const anchorColumn =
				source.via.direction === "outgoing" ? sql`r.source_entity_id` : sql`r.target_entity_id`;
			const childColumn =
				source.via.direction === "outgoing" ? sql`r.target_entity_id` : sql`r.source_entity_id`;
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
						rs.is_builtin AS "relationshipSchemaIsBuiltin",
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
					${limitSql}
				`),
			);
			rows = rawRows.rows;
		}

		const overflow = fetchBoundOverflow(bound, rows.length);
		if (overflow) {
			return yield* overflow;
		}

		const matches: SourceMatch[] = [];
		for (const row of rows) {
			const nextContext = cloneContext(context);
			nextContext.entities.set(source.alias, row);
			if (source.via !== undefined && "relationshipId" in row) {
				nextContext.relationships.set(source.via.alias, row);
			}
			if (source.where === null || (yield* evalBoolean(userId, source.where, nextContext))) {
				matches.push({ context: nextContext, row });
			}
		}

		return matches;
	});

const executeEventSourceMatches = (
	userId: string,
	context: RowContext,
	source: NestedEventSource,
	evalBoolean: EvalExprAsBoolean,
	bound: FetchBound,
): Effect.Effect<SourceMatch[], BadRequest | NotFound | DbError, CurrentDb> =>
	Effect.gen(function* () {
		const entityRow = context.entities.get(source.entityRef);
		if (entityRow === undefined) {
			return [];
		}

		const eventSchemas = yield* loadVisibleEventSchemas(userId, entityRow.schemaId, source.schemas);
		const eventSchemaIdsSql = sql.join(
			eventSchemas.map((schema) => sql`${schema.id}`),
			sql`, `,
		);
		const limitSql = fetchBoundLimitSql(bound);
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
					ev.entity_id = ${entityRow.id}
					AND ev.user_id = ${userId}
					AND ev.event_schema_id IN (${eventSchemaIdsSql})
					AND (e.user_id = ${userId} OR e.user_id IS NULL)
				${limitSql}
			`),
		);

		const overflow = fetchBoundOverflow(bound, rawRows.rows.length);
		if (overflow) {
			return yield* overflow;
		}

		const matches: SourceMatch[] = [];
		for (const row of rawRows.rows) {
			const nextContext = cloneContext(context);
			nextContext.events.set(source.alias, row);
			nextContext.entities.set(source.entityRef, eventSourceEntityRow(row));
			if (source.where === null || (yield* evalBoolean(userId, source.where, nextContext))) {
				matches.push({ context: nextContext, row });
			}
		}

		return matches;
	});

const executeRootEventSourceMatches = (
	userId: string,
	source: RootEventSource,
	evalBoolean: EvalExprAsBoolean,
): Effect.Effect<SourceMatch[], BadRequest | NotFound | DbError, CurrentDb> =>
	Effect.gen(function* () {
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
					ev.user_id = ${userId}
					AND ev.event_schema_id IN (${eventSchemaIdsSql})
					AND e.entity_schema_id IN (${entitySchemaIdsSql})
					AND (e.user_id = ${userId} OR e.user_id IS NULL)
			`),
		);

		const matches: SourceMatch[] = [];
		for (const row of rawRows.rows) {
			const context = makeEventRootContext(source, row);
			if (source.where === null || (yield* evalBoolean(userId, source.where, context))) {
				matches.push({ context, row });
			}
		}
		return matches;
	});

export const loadRelationshipRootVisibleSchemas = (userId: string, source: RelationshipSource) =>
	Effect.all(
		[
			loadVisibleRelationshipSchemas(userId, source.schemas),
			loadVisibleEntitySchemas(userId, source.sourceEntity.schemas),
			loadVisibleEntitySchemas(userId, source.targetEntity.schemas),
		],
		{ concurrency: "unbounded" },
	);

const executeRootRelationshipSourceMatches = (
	userId: string,
	source: RelationshipSource,
	evalBoolean: EvalExprAsBoolean,
): Effect.Effect<SourceMatch[], BadRequest | NotFound | DbError, CurrentDb> =>
	Effect.gen(function* () {
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
		const db = yield* CurrentDb;
		const rawRows = yield* dbEffect(() =>
			db.execute<RelationshipRootQueryRow>(
				relationshipRootSelectSql(
					relationshipSchemaIdsSql,
					sourceEntitySchemaIdsSql,
					targetEntitySchemaIdsSql,
					userId,
				),
			),
		);

		const matches: SourceMatch[] = [];
		for (const row of rawRows.rows) {
			const context = makeRelationshipRootContext(source, row);
			if (source.where === null || (yield* evalBoolean(userId, source.where, context))) {
				matches.push({ context, row: relationshipEntityRow(row.sourceEntity) });
			}
		}
		return matches;
	});

export const executeRootSourceMatches = (
	userId: string,
	source: QueryDocument["source"],
	evalBoolean: EvalExprAsBoolean,
): Effect.Effect<SourceMatch[], BadRequest | NotFound | DbError, CurrentDb> => {
	if (source.type === "entities") {
		return executeEntitySourceMatches(userId, makeEmptyContext(), source, evalBoolean, {
			mode: "unbounded",
		});
	}
	if (source.type === "events") {
		return executeRootEventSourceMatches(userId, source, evalBoolean);
	}
	return executeRootRelationshipSourceMatches(userId, source, evalBoolean);
};

export const executeSourceMatches = (
	userId: string,
	context: RowContext,
	source: Source,
	evalBoolean: EvalExprAsBoolean,
	bound: FetchBound = { mode: "cap", cap: MAX_AGGREGATE_EXPRESSION_SOURCE_ROWS },
) =>
	source.type === "entities"
		? executeEntitySourceMatches(userId, context, source, evalBoolean, bound)
		: executeEventSourceMatches(userId, context, source, evalBoolean, bound);
