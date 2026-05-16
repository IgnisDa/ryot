import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { Effect, Match } from "effect";

import { CurrentDb, dbEffect } from "#lib/db";
import * as dbSchema from "#lib/db/schema/tables";
import { BadRequest, type DbError, NotFound } from "#lib/errors";

import type {
	AggregateOutputV2,
	AggregateResponseV2,
	AggregationSpec,
	EntitySourceV2,
	Expr,
	FieldDef,
	FieldSelector,
	FieldValue,
	IncludeEntryV2,
	NestedEventSourceV2,
	QueryDocumentV2,
	RootEventSourceV2,
	RowItem,
	RowValue,
	RowsOutputV2,
	RowsResponseV2,
	SourceV2,
} from "./language";

const MAX_SERIALIZED_ROW_OBJECTS = 5000;
const MAX_AGGREGATE_EXPRESSION_SOURCE_ROWS = 10000;
const MAX_ROOT_FILTER_SCAN_ROWS = 5000;

export type VisibleSchema = { id: string; slug: string };
type VisibleRelationshipSchema = { id: string; slug: string };

type VisibleEventSchema = { id: string; slug: string };

type RowsQueryDocumentV2 = QueryDocumentV2 & { output: RowsOutputV2 };
type AggregateQueryDocumentV2 = QueryDocumentV2 & { output: AggregateOutputV2 };

const loadVisibleEntitySchemas = (
	userId: string,
	slugs: readonly [string, ...string[]],
): Effect.Effect<VisibleSchema[], NotFound | DbError, CurrentDb> =>
	Effect.gen(function* () {
		const db = yield* CurrentDb;
		const uniqueSlugs = [...new Set(slugs)];

		const rows = yield* dbEffect(() =>
			db
				.select({ id: dbSchema.entitySchema.id, slug: dbSchema.entitySchema.slug })
				.from(dbSchema.entitySchema)
				.where(
					and(
						inArray(dbSchema.entitySchema.slug, uniqueSlugs),
						or(eq(dbSchema.entitySchema.userId, userId), isNull(dbSchema.entitySchema.userId)),
					),
				),
		);

		// Ensure every requested slug resolved to a visible schema
		const visibleSlugs = new Set(rows.map((r) => r.slug));
		for (const slug of uniqueSlugs) {
			if (!visibleSlugs.has(slug)) {
				return yield* new NotFound({ message: `Entity schema '${slug}' not found` });
			}
		}

		return rows;
	});

const loadVisibleRelationshipSchema = (
	userId: string,
	slug: string,
): Effect.Effect<VisibleRelationshipSchema, NotFound | DbError, CurrentDb> =>
	Effect.gen(function* () {
		const db = yield* CurrentDb;
		const rows = yield* dbEffect(() =>
			db
				.select({ id: dbSchema.relationshipSchema.id, slug: dbSchema.relationshipSchema.slug })
				.from(dbSchema.relationshipSchema)
				.where(
					and(
						eq(dbSchema.relationshipSchema.slug, slug),
						or(
							eq(dbSchema.relationshipSchema.userId, userId),
							isNull(dbSchema.relationshipSchema.userId),
						),
					),
				),
		);

		const schema = rows[0];
		if (!schema) {
			return yield* new NotFound({ message: `Relationship schema '${slug}' not found` });
		}
		return schema;
	});

const loadVisibleEventSchemas = (
	userId: string,
	entitySchemaId: string,
	slugs: readonly [string, ...string[]],
): Effect.Effect<VisibleEventSchema[], NotFound | DbError, CurrentDb> =>
	Effect.gen(function* () {
		const db = yield* CurrentDb;
		const uniqueSlugs = [...new Set(slugs)];

		const rows = yield* dbEffect(() =>
			db
				.select({ id: dbSchema.eventSchema.id, slug: dbSchema.eventSchema.slug })
				.from(dbSchema.eventSchema)
				.where(
					and(
						eq(dbSchema.eventSchema.entitySchemaId, entitySchemaId),
						inArray(dbSchema.eventSchema.slug, uniqueSlugs),
						or(eq(dbSchema.eventSchema.userId, userId), isNull(dbSchema.eventSchema.userId)),
					),
				),
		);

		const visibleSlugs = new Set(rows.map((r) => r.slug));
		for (const slug of uniqueSlugs) {
			if (!visibleSlugs.has(slug)) {
				return yield* new NotFound({ message: `Event schema '${slug}' not found` });
			}
		}

		return rows;
	});

const loadVisibleEventSchemasForEntitySchemas = (
	userId: string,
	entitySchemaIds: readonly string[],
	slugs: readonly [string, ...string[]],
): Effect.Effect<VisibleEventSchema[], NotFound | DbError, CurrentDb> =>
	Effect.gen(function* () {
		const db = yield* CurrentDb;
		const uniqueSlugs = [...new Set(slugs)];

		const rows = yield* dbEffect(() =>
			db
				.select({ id: dbSchema.eventSchema.id, slug: dbSchema.eventSchema.slug })
				.from(dbSchema.eventSchema)
				.where(
					and(
						inArray(dbSchema.eventSchema.entitySchemaId, entitySchemaIds),
						inArray(dbSchema.eventSchema.slug, uniqueSlugs),
						or(eq(dbSchema.eventSchema.userId, userId), isNull(dbSchema.eventSchema.userId)),
					),
				),
		);

		const visibleSlugs = new Set(rows.map((r) => r.slug));
		for (const slug of uniqueSlugs) {
			if (!visibleSlugs.has(slug)) {
				return yield* new NotFound({ message: `Event schema '${slug}' not found` });
			}
		}

		return rows;
	});

export const systemFieldSql = (name: string, alias = "e"): ReturnType<typeof sql> | null => {
	if (alias === "ev") {
		const eventColumnMap: Record<string, ReturnType<typeof sql>> = {
			id: sql`ev.id`,
			createdAt: sql`ev.created_at`,
			updatedAt: sql`ev.updated_at`,
			occurredAt: sql`ev.occurred_at`,
		};
		return eventColumnMap[name] ?? null;
	}

	if (alias === "r") {
		const relationshipColumnMap: Record<string, ReturnType<typeof sql>> = {
			id: sql`r.id`,
			createdAt: sql`r.created_at`,
			sourceEntityId: sql`r.source_entity_id`,
			targetEntityId: sql`r.target_entity_id`,
		};
		return relationshipColumnMap[name] ?? null;
	}

	const columnMap: Record<string, ReturnType<typeof sql>> = {
		id: sql`e.id`,
		name: sql`e.name`,
		image: sql`e.image`,
		createdAt: sql`e.created_at`,
		updatedAt: sql`e.updated_at`,
		externalId: sql`e.external_id`,
		sandboxScriptId: sql`e.sandbox_script_id`,
	};
	return columnMap[name] ?? null;
};

export const fieldSelectorToOrderSql = (
	field: FieldSelector,
	sourceSchemas: readonly [string, ...string[]],
	alias = "e",
): ReturnType<typeof sql> | null => {
	if (field.type === "system") {
		return systemFieldSql(field.name, alias);
	}

	if (field.type === "property") {
		const pathArgs = field.path.map((k) => sql`${k}`);
		const propertiesExpr =
			alias === "r" ? sql`r.properties` : alias === "ev" ? sql`ev.properties` : sql`e.properties`;
		const jsonbExpr = sql`jsonb_extract_path_text(${propertiesExpr}, ${sql.join(pathArgs, sql`, `)})`;

		if (alias === "r" || sourceSchemas.length === 1) {
			return jsonbExpr;
		}
		const schemaSlugExpr = alias === "ev" ? sql`evs.slug` : sql`es.slug`;
		// Multi-schema: only order by the property when the row's schema matches.
		return sql`CASE WHEN ${schemaSlugExpr} = ${field.schema} THEN ${jsonbExpr} END`;
	}

	// field.type is "schema" at this point
	if (alias === "r") {
		return field.name === "slug" ? sql`rs.slug` : sql`rs.name`;
	}
	if (alias === "ev") {
		return field.name === "slug" ? sql`evs.slug` : sql`evs.name`;
	}
	return field.name === "slug" ? sql`es.slug` : sql`es.name`;
};

export const exprToOrderSql = (
	expr: Expr,
	sourceSchemas: readonly [string, ...string[]],
): ReturnType<typeof sql> | null => {
	if (expr.type !== "ref") {
		return null;
	}
	return fieldSelectorToOrderSql(expr.field, sourceSchemas);
};

type BaseEntityQueryRow = {
	id: string;
	name: string;
	image: unknown;
	schemaId: string;
	schemaSlug: string;
	schemaName: string;
	createdAt: Date | string;
	updatedAt: Date | string;
	externalId: string | null;
	totalCount: string | bigint;
	sandboxScriptId: string | null;
	properties: Record<string, unknown>;
};

export type EntityQueryRow = BaseEntityQueryRow & { totalCount: string | bigint };

type RelationshipFields = {
	relationshipId: string | null;
	relationshipSchemaSlug: string | null;
	relationshipSchemaName: string | null;
	relationshipSourceEntityId: string | null;
	relationshipTargetEntityId: string | null;
	relationshipCreatedAt: Date | string | null;
	relationshipProperties: Record<string, unknown> | null;
};

type IncludeQueryRow = BaseEntityQueryRow & RelationshipFields;

type EventFields = {
	eventId: string;
	eventSchemaId: string;
	eventSchemaSlug: string;
	eventSchemaName: string;
	eventCreatedAt: Date | string;
	eventUpdatedAt: Date | string;
	eventOccurredAt: Date | string;
	eventProperties: Record<string, unknown>;
};

type EventQueryRow = BaseEntityQueryRow & EventFields & { totalCount: string | bigint };

export const valueToFieldValue = (value: unknown): FieldValue => {
	if (value === null || value === undefined) {
		return { kind: "null", value: null };
	}
	if (typeof value === "string") {
		return { kind: "text", value };
	}
	if (typeof value === "number") {
		return { kind: "number", value };
	}
	if (typeof value === "boolean") {
		return { kind: "boolean", value };
	}
	return { kind: "json", value };
};

export const evalSystemRef = (name: string, row: BaseEntityQueryRow): FieldValue =>
	Match.value(name).pipe(
		Match.when("id", () => ({ kind: "text" as const, value: row.id })),
		Match.when("name", () => ({ kind: "text" as const, value: row.name })),
		Match.when("image", () =>
			row.image !== null && row.image !== undefined
				? { kind: "image" as const, value: row.image }
				: { kind: "null" as const, value: null },
		),
		Match.when("createdAt", () => ({ kind: "date" as const, value: row.createdAt })),
		Match.when("updatedAt", () => ({ kind: "date" as const, value: row.updatedAt })),
		Match.when("externalId", () =>
			row.externalId !== null
				? { kind: "text" as const, value: row.externalId }
				: { kind: "null" as const, value: null },
		),
		Match.when("sandboxScriptId", () =>
			row.sandboxScriptId !== null
				? { kind: "text" as const, value: row.sandboxScriptId }
				: { kind: "null" as const, value: null },
		),
		Match.orElse(() => ({ kind: "null" as const, value: null })),
	);

export const getNestedValue = (
	obj: Record<string, unknown>,
	path: readonly [string, ...string[]],
): unknown => {
	let current: unknown = obj;
	for (const key of path) {
		if (typeof current !== "object" || current === null) {
			return null;
		}
		current = Reflect.get(current, key);
	}
	return current ?? null;
};

export const evalFieldSelector = (field: FieldSelector, row: BaseEntityQueryRow): FieldValue => {
	if (field.type === "system") {
		return evalSystemRef(field.name, row);
	}

	if (field.type === "property") {
		// Return null when entity's schema doesn't match the property schema qualifier
		if (row.schemaSlug !== field.schema) {
			return { kind: "null", value: null };
		}
		return valueToFieldValue(getNestedValue(row.properties, field.path));
	}

	// schema metadata
	if (field.name === "slug") {
		return { kind: "text", value: row.schemaSlug };
	}
	return { kind: "text", value: row.schemaName };
};

const evalRelationshipSystemRef = (name: string, row: RelationshipFields): FieldValue =>
	Match.value(name).pipe(
		Match.when("id", () => ({ kind: "text" as const, value: row.relationshipId ?? "" })),
		Match.when("createdAt", () => ({ kind: "date" as const, value: row.relationshipCreatedAt })),
		Match.when("sourceEntityId", () => ({
			kind: "text" as const,
			value: row.relationshipSourceEntityId ?? "",
		})),
		Match.when("targetEntityId", () => ({
			kind: "text" as const,
			value: row.relationshipTargetEntityId ?? "",
		})),
		Match.orElse(() => ({ kind: "null" as const, value: null })),
	);

const evalRelationshipFieldSelector = (
	field: FieldSelector,
	row: RelationshipFields,
): FieldValue => {
	if (field.type === "system") {
		return evalRelationshipSystemRef(field.name, row);
	}
	if (field.type === "property") {
		if (row.relationshipSchemaSlug !== field.schema) {
			return { kind: "null", value: null };
		}
		return valueToFieldValue(getNestedValue(row.relationshipProperties ?? {}, field.path));
	}
	return {
		kind: "text",
		value: field.name === "slug" ? row.relationshipSchemaSlug : row.relationshipSchemaName,
	};
};

const evalEventSystemRef = (name: string, row: EventFields): FieldValue =>
	Match.value(name).pipe(
		Match.when("id", () => ({ kind: "text" as const, value: row.eventId })),
		Match.when("createdAt", () => ({ kind: "date" as const, value: row.eventCreatedAt })),
		Match.when("updatedAt", () => ({ kind: "date" as const, value: row.eventUpdatedAt })),
		Match.when("occurredAt", () => ({ kind: "date" as const, value: row.eventOccurredAt })),
		Match.orElse(() => ({ kind: "null" as const, value: null })),
	);

const evalEventFieldSelector = (field: FieldSelector, row: EventFields): FieldValue => {
	if (field.type === "system") {
		return evalEventSystemRef(field.name, row);
	}
	if (field.type === "property") {
		if (row.eventSchemaSlug !== field.schema) {
			return { kind: "null", value: null };
		}
		return valueToFieldValue(getNestedValue(row.eventProperties, field.path));
	}
	return { kind: "text", value: field.name === "slug" ? row.eventSchemaSlug : row.eventSchemaName };
};

export const evalExprForField = (expr: Expr, row: EntityQueryRow): FieldValue => {
	if (expr.type === "ref") {
		return evalFieldSelector(expr.field, row);
	}
	if (expr.type === "literal") {
		return valueToFieldValue(expr.value);
	}
	// Other expression types are not yet supported for output field evaluation
	return { kind: "null", value: null };
};

type RowContext = {
	events: Map<string, EventFields>;
	entities: Map<string, BaseEntityQueryRow>;
	relationships: Map<string, RelationshipFields>;
};

type SourceMatch = { context: RowContext; row: BaseEntityQueryRow };

const makeEntityContext = (alias: string, row: BaseEntityQueryRow): RowContext => ({
	events: new Map(),
	relationships: new Map(),
	entities: new Map([[alias, row]]),
});

const makeEmptyContext = (): RowContext => ({
	events: new Map(),
	entities: new Map(),
	relationships: new Map(),
});

const cloneContext = (context: RowContext): RowContext => ({
	events: new Map(context.events),
	entities: new Map(context.entities),
	relationships: new Map(context.relationships),
});

const fieldValueScalar = (value: FieldValue) => value.value;

const evalRefInContext = (expr: Extract<Expr, { type: "ref" }>, context: RowContext) => {
	const eventRow = context.events.get(expr.sourceAlias);
	if (eventRow !== undefined) {
		return evalEventFieldSelector(expr.field, eventRow);
	}

	const relationshipRow = context.relationships.get(expr.sourceAlias);
	if (relationshipRow !== undefined) {
		return evalRelationshipFieldSelector(expr.field, relationshipRow);
	}

	const entityRow = context.entities.get(expr.sourceAlias);
	if (entityRow !== undefined) {
		return evalFieldSelector(expr.field, entityRow);
	}

	return { kind: "null" as const, value: null };
};

const compareValues = (
	left: unknown,
	right: unknown,
	operator: Extract<Expr, { type: "comparison" }>["operator"],
) => {
	if (left === null || left === undefined || right === null || right === undefined) {
		return false;
	}
	const normalizedLeft = left instanceof Date ? left.toISOString() : left;
	const normalizedRight = right instanceof Date ? right.toISOString() : right;
	const compareOrdered = (compare: (result: number) => boolean) => {
		if (typeof normalizedLeft === "number" && typeof normalizedRight === "number") {
			return compare(normalizedLeft - normalizedRight);
		}
		if (typeof normalizedLeft === "string" && typeof normalizedRight === "string") {
			return compare(normalizedLeft.localeCompare(normalizedRight));
		}
		return false;
	};

	return Match.value(operator).pipe(
		Match.when("eq", () => left === right),
		Match.when("neq", () => left !== right),
		Match.when("gt", () => compareOrdered((result) => result > 0)),
		Match.when("gte", () => compareOrdered((result) => result >= 0)),
		Match.when("lt", () => compareOrdered((result) => result < 0)),
		Match.when("lte", () => compareOrdered((result) => result <= 0)),
		Match.exhaustive,
	);
};

const containsValue = (left: unknown, right: unknown) => {
	if (typeof left === "string" && typeof right === "string") {
		return left.toLowerCase().includes(right.toLowerCase());
	}
	if (Array.isArray(left)) {
		return Array.isArray(right) ? right.every((item) => left.includes(item)) : left.includes(right);
	}
	if (
		typeof left === "object" &&
		left !== null &&
		typeof right === "object" &&
		right !== null &&
		!Array.isArray(left) &&
		!Array.isArray(right)
	) {
		return Object.entries(right).every(([key, value]) => Reflect.get(left, key) === value);
	}
	return false;
};

const eventSourceEntityRow = (row: EventQueryRow): BaseEntityQueryRow => ({
	id: row.id,
	name: row.name,
	image: row.image,
	schemaId: row.schemaId,
	createdAt: row.createdAt,
	updatedAt: row.updatedAt,
	properties: row.properties,
	totalCount: row.totalCount,
	schemaSlug: row.schemaSlug,
	schemaName: row.schemaName,
	externalId: row.externalId,
	sandboxScriptId: row.sandboxScriptId,
});

const makeEventRootContext = (source: RootEventSourceV2, row: EventQueryRow): RowContext => ({
	relationships: new Map(),
	entities: new Map([[source.entity.alias, eventSourceEntityRow(row)]]),
	events: new Map([[source.alias, row]]),
});

const makeIncludeContext = (include: IncludeEntryV2, row: IncludeQueryRow): RowContext => {
	const context = makeEntityContext(include.source.alias, row);
	if (include.source.via !== undefined) {
		context.relationships.set(include.source.via.alias, row);
	}
	return context;
};

const executeEntitySourceMatches = (
	userId: string,
	context: RowContext,
	source: EntitySourceV2,
	limit: number | null,
): Effect.Effect<SourceMatch[], BadRequest | NotFound | DbError, CurrentDb> =>
	Effect.gen(function* () {
		const visibleSchemas = yield* loadVisibleEntitySchemas(userId, source.schemas);
		const schemaIdsSql = sql.join(
			visibleSchemas.map((s) => sql`${s.id}`),
			sql`, `,
		);
		const limitSql = limit === null ? sql`` : sql`LIMIT ${limit}`;
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
						r.id AS "relationshipId",
						r.created_at AS "relationshipCreatedAt",
						r.source_entity_id AS "relationshipSourceEntityId",
						r.target_entity_id AS "relationshipTargetEntityId",
						r.properties AS "relationshipProperties",
						rs.slug AS "relationshipSchemaSlug",
						rs.name AS "relationshipSchemaName",
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

		const matches: SourceMatch[] = [];
		for (const row of rows) {
			const nextContext = cloneContext(context);
			nextContext.entities.set(source.alias, row);
			if (source.via !== undefined && "relationshipId" in row) {
				nextContext.relationships.set(source.via.alias, row);
			}
			if (source.where === null || (yield* evalExprAsBoolean(userId, source.where, nextContext))) {
				matches.push({ context: nextContext, row });
			}
		}

		return matches;
	});

const executeEventSourceMatches = (
	userId: string,
	context: RowContext,
	source: NestedEventSourceV2,
	limit: number | null,
): Effect.Effect<SourceMatch[], BadRequest | NotFound | DbError, CurrentDb> =>
	Effect.gen(function* () {
		const entityRow = context.entities.get(source.entityRef);
		if (entityRow === undefined) {
			return [];
		}

		const eventSchemas = yield* loadVisibleEventSchemas(userId, entityRow.schemaId, source.schemas);
		const eventSchemaIdsSql = sql.join(
			eventSchemas.map((s) => sql`${s.id}`),
			sql`, `,
		);
		const limitSql = limit === null ? sql`` : sql`LIMIT ${limit}`;
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
					ev.entity_id = ${entityRow.id}
					AND ev.user_id = ${userId}
					AND ev.event_schema_id IN (${eventSchemaIdsSql})
					AND (e.user_id = ${userId} OR e.user_id IS NULL)
				${limitSql}
			`),
		);

		const matches: SourceMatch[] = [];
		for (const row of rawRows.rows) {
			const nextContext = cloneContext(context);
			nextContext.events.set(source.alias, row);
			nextContext.entities.set(source.entityRef, eventSourceEntityRow(row));
			if (source.where === null || (yield* evalExprAsBoolean(userId, source.where, nextContext))) {
				matches.push({ context: nextContext, row });
			}
		}

		return matches;
	});

const executeRootEventSourceMatches = (
	userId: string,
	source: RootEventSourceV2,
): Effect.Effect<SourceMatch[], BadRequest | NotFound | DbError, CurrentDb> =>
	Effect.gen(function* () {
		const visibleEntitySchemas = yield* loadVisibleEntitySchemas(userId, source.entity.schemas);
		const entitySchemaIds = visibleEntitySchemas.map((s) => s.id);
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
			visibleEventSchemas.map((s) => sql`${s.id}`),
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
					ev.user_id = ${userId}
					AND ev.event_schema_id IN (${eventSchemaIdsSql})
					AND e.entity_schema_id IN (${entitySchemaIdsSql})
					AND (e.user_id = ${userId} OR e.user_id IS NULL)
			`),
		);

		const matches: SourceMatch[] = [];
		for (const row of rawRows.rows) {
			const context = makeEventRootContext(source, row);
			if (source.where === null || (yield* evalExprAsBoolean(userId, source.where, context))) {
				matches.push({ context, row });
			}
		}
		return matches;
	});

const executeRootSourceMatches = (
	userId: string,
	source: QueryDocumentV2["source"],
): Effect.Effect<SourceMatch[], BadRequest | NotFound | DbError, CurrentDb> => {
	if (source.type === "entities") {
		return executeEntitySourceMatches(userId, makeEmptyContext(), source, null);
	}
	return executeRootEventSourceMatches(userId, source);
};

const executeSourceMatches = (
	userId: string,
	context: RowContext,
	source: SourceV2,
	limit: number | null = source.where === null ? MAX_AGGREGATE_EXPRESSION_SOURCE_ROWS + 1 : null,
) =>
	source.type === "entities"
		? executeEntitySourceMatches(userId, context, source, limit)
		: executeEventSourceMatches(userId, context, source, limit);

const aggregateDistinctKey = (value: unknown) =>
	typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);

const aggregateValues = (
	values: readonly FieldValue[],
	aggregation: AggregationSpec,
): FieldValue => {
	if (aggregation.function === "count") {
		return { kind: "number", value: values.length };
	}

	const numbers = values.flatMap((value) => (typeof value.value === "number" ? [value.value] : []));
	if (numbers.length === 0) {
		return { kind: "null", value: null };
	}

	const result = Match.value(aggregation.function).pipe(
		Match.when("sum", () => numbers.reduce((total, value) => total + value, 0)),
		Match.when(
			"average",
			() => numbers.reduce((total, value) => total + value, 0) / numbers.length,
		),
		Match.when("minimum", () => Math.min(...numbers)),
		Match.when("maximum", () => Math.max(...numbers)),
		Match.exhaustive,
	);
	return { kind: "number", value: result };
};

const evalAggregate = (
	userId: string,
	context: RowContext,
	aggregation: AggregationSpec,
	source: SourceV2,
): Effect.Effect<FieldValue, BadRequest | NotFound | DbError, CurrentDb> =>
	Effect.gen(function* () {
		const matches = yield* executeSourceMatches(userId, context, source);
		if (matches.length > MAX_AGGREGATE_EXPRESSION_SOURCE_ROWS) {
			return yield* new BadRequest({
				message: `Aggregate expression source matched rows exceeds maximum of ${MAX_AGGREGATE_EXPRESSION_SOURCE_ROWS}`,
			});
		}

		if (aggregation.function === "count") {
			if (aggregation.distinctBy === undefined) {
				return { kind: "number" as const, value: matches.length };
			}

			const distinct = new Set<string>();
			for (const match of matches) {
				const value = fieldValueScalar(
					yield* evalExprValue(userId, aggregation.distinctBy, match.context),
				);
				if (value !== null && value !== undefined) {
					distinct.add(aggregateDistinctKey(value));
				}
			}
			return { kind: "number" as const, value: distinct.size };
		}

		const values: number[] = [];
		for (const match of matches) {
			const value = fieldValueScalar(yield* evalExprValue(userId, aggregation.expr, match.context));
			if (typeof value === "number") {
				values.push(value);
			}
		}

		if (values.length === 0) {
			return { kind: "null" as const, value: null };
		}

		const result = Match.value(aggregation.function).pipe(
			Match.when("sum", () => values.reduce((total, value) => total + value, 0)),
			Match.when(
				"average",
				() => values.reduce((total, value) => total + value, 0) / values.length,
			),
			Match.when("minimum", () => Math.min(...values)),
			Match.when("maximum", () => Math.max(...values)),
			Match.exhaustive,
		);
		return { kind: "number" as const, value: result };
	});

const evalExprValue = (
	userId: string,
	expr: Expr,
	context: RowContext,
): Effect.Effect<FieldValue, BadRequest | NotFound | DbError, CurrentDb> =>
	Effect.gen(function* () {
		if (expr.type === "ref") {
			return evalRefInContext(expr, context);
		}
		if (expr.type === "literal") {
			return valueToFieldValue(expr.value);
		}
		if (expr.type === "exists") {
			const matches = yield* executeSourceMatches(
				userId,
				context,
				expr.source,
				expr.source.where === null ? 1 : null,
			);
			return { kind: "boolean" as const, value: matches.length > 0 };
		}
		if (expr.type === "aggregate") {
			return yield* evalAggregate(userId, context, expr.aggregation, expr.source);
		}
		if (expr.type === "comparison") {
			const left = fieldValueScalar(yield* evalExprValue(userId, expr.left, context));
			const right = fieldValueScalar(yield* evalExprValue(userId, expr.right, context));
			return { kind: "boolean" as const, value: compareValues(left, right, expr.operator) };
		}
		if (expr.type === "and") {
			for (const value of expr.values) {
				if (!(yield* evalExprAsBoolean(userId, value, context))) {
					return { kind: "boolean" as const, value: false };
				}
			}
			return { kind: "boolean" as const, value: true };
		}
		if (expr.type === "or") {
			for (const value of expr.values) {
				if (yield* evalExprAsBoolean(userId, value, context)) {
					return { kind: "boolean" as const, value: true };
				}
			}
			return { kind: "boolean" as const, value: false };
		}
		if (expr.type === "not") {
			return {
				kind: "boolean" as const,
				value: !(yield* evalExprAsBoolean(userId, expr.expr, context)),
			};
		}
		if (expr.type === "isNull") {
			const value = fieldValueScalar(yield* evalExprValue(userId, expr.expr, context));
			return { kind: "boolean" as const, value: value === null || value === undefined };
		}
		if (expr.type === "isNotNull") {
			const value = fieldValueScalar(yield* evalExprValue(userId, expr.expr, context));
			return { kind: "boolean" as const, value: value !== null && value !== undefined };
		}
		if (expr.type === "contains") {
			const left = fieldValueScalar(yield* evalExprValue(userId, expr.left, context));
			const right = fieldValueScalar(yield* evalExprValue(userId, expr.right, context));
			return { kind: "boolean" as const, value: containsValue(left, right) };
		}
		if (expr.type === "coalesce") {
			for (const valueExpr of expr.values) {
				const value = yield* evalExprValue(userId, valueExpr, context);
				if (value.value !== null && value.value !== undefined) {
					return value;
				}
			}
			return { kind: "null" as const, value: null };
		}
		return { kind: "null" as const, value: null };
	});

const evalExprAsBoolean = (
	userId: string,
	expr: Expr,
	context: RowContext,
): Effect.Effect<boolean, BadRequest | NotFound | DbError, CurrentDb> =>
	Effect.map(evalExprValue(userId, expr, context), (value) => value.value === true);

const groupKeyFromValues = (values: readonly FieldValue[]) =>
	JSON.stringify(values.map((value) => [value.kind, value.value]));

const compareAggregateOrderValues = (left: unknown, right: unknown) => {
	if (left === null || left === undefined) {
		return right === null || right === undefined ? 0 : 1;
	}
	if (right === null || right === undefined) {
		return -1;
	}

	const normalizedLeft = left instanceof Date ? left.toISOString() : left;
	const normalizedRight = right instanceof Date ? right.toISOString() : right;
	if (typeof normalizedLeft === "number" && typeof normalizedRight === "number") {
		return normalizedLeft - normalizedRight;
	}
	if (typeof normalizedLeft === "string" && typeof normalizedRight === "string") {
		return normalizedLeft.localeCompare(normalizedRight);
	}
	return 0;
};

const evalAggregateMeasure = (
	userId: string,
	matches: readonly SourceMatch[],
	aggregation: AggregationSpec,
): Effect.Effect<FieldValue, BadRequest | NotFound | DbError, CurrentDb> =>
	Effect.gen(function* () {
		if (aggregation.function === "count") {
			if (aggregation.distinctBy === undefined) {
				return { kind: "number" as const, value: matches.length };
			}

			const distinct = new Set<string>();
			for (const match of matches) {
				const value = fieldValueScalar(
					yield* evalExprValue(userId, aggregation.distinctBy, match.context),
				);
				if (value !== null && value !== undefined) {
					distinct.add(aggregateDistinctKey(value));
				}
			}
			return { kind: "number" as const, value: distinct.size };
		}

		const values: FieldValue[] = [];
		for (const match of matches) {
			values.push(yield* evalExprValue(userId, aggregation.expr, match.context));
		}
		return aggregateValues(values, aggregation);
	});

const evalAggregateGroupFields = (
	userId: string,
	groupBy: readonly FieldDef[],
	match: SourceMatch,
): Effect.Effect<FieldValue[], BadRequest | NotFound | DbError, CurrentDb> =>
	Effect.gen(function* () {
		const values: FieldValue[] = [];
		for (const field of groupBy) {
			values.push(yield* evalExprValue(userId, field.expr, match.context));
		}
		return values;
	});

const aggregateOrderValue = (value: RowValue | undefined) =>
	value !== undefined && "kind" in value ? value.value : null;

const sortAggregateItems = (items: readonly RowItem[], orderBy: AggregateOutputV2["orderBy"]) => {
	const sorted = [...items];
	sorted.sort((left, right) => {
		for (const entry of orderBy ?? []) {
			if (entry.expr.type !== "measureRef") {
				continue;
			}
			const leftValue = left[entry.expr.key];
			const rightValue = right[entry.expr.key];
			const result = compareAggregateOrderValues(
				aggregateOrderValue(leftValue),
				aggregateOrderValue(rightValue),
			);
			if (result !== 0) {
				return entry.order === "asc" ? result : -result;
			}
		}
		return 0;
	});
	return sorted;
};

export const executeAggregateQuery = (
	userId: string,
	doc: AggregateQueryDocumentV2,
): Effect.Effect<AggregateResponseV2, BadRequest | NotFound | DbError, CurrentDb> =>
	Effect.gen(function* () {
		const { output } = doc;
		const matches = yield* executeRootSourceMatches(userId, doc.source);
		const groupBy = output.groupBy ?? [];

		if (groupBy.length === 0) {
			const item: Record<string, RowValue> = {};
			for (const measure of output.measures) {
				item[measure.key] = yield* evalAggregateMeasure(userId, matches, measure.aggregation);
			}
			return { type: "aggregate" as const, data: { items: [item] } };
		}

		const groups = new Map<string, { item: Record<string, RowValue>; matches: SourceMatch[] }>();
		for (const match of matches) {
			const groupValues = yield* evalAggregateGroupFields(userId, groupBy, match);
			const groupKey = groupKeyFromValues(groupValues);
			const existing = groups.get(groupKey);
			if (existing !== undefined) {
				existing.matches.push(match);
				continue;
			}

			const item: Record<string, RowValue> = {};
			for (const [index, field] of groupBy.entries()) {
				const value = groupValues[index];
				if (value !== undefined) {
					item[field.key] = value;
				}
			}
			groups.set(groupKey, { item, matches: [match] });
		}

		const items: RowItem[] = [];
		for (const group of groups.values()) {
			for (const measure of output.measures) {
				group.item[measure.key] = yield* evalAggregateMeasure(
					userId,
					group.matches,
					measure.aggregation,
				);
			}
			items.push(group.item);
		}

		const sortedItems = sortAggregateItems(items, output.orderBy);
		const limit = output.limit ?? sortedItems.length;
		return {
			type: "aggregate" as const,
			data: {
				items: sortedItems.slice(0, limit),
				pageInfo: { limit, hasMore: sortedItems.length > limit },
			},
		};
	});

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

const executeEventFirst = (
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
			eventSchemas.map((s) => sql`${s.id}`),
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

const evalRootExprForField = (
	userId: string,
	expr: Expr,
	row: EntityQueryRow,
	entityAlias: string,
): Effect.Effect<FieldValue, BadRequest | NotFound | DbError, CurrentDb> => {
	if (expr.type === "first") {
		if (expr.source.type === "events" && expr.source.entityRef === entityAlias) {
			return executeEventFirst(userId, row, expr);
		}
		return Effect.succeed({ kind: "null", value: null });
	}
	return evalExprValue(userId, expr, makeEntityContext(entityAlias, row));
};

const evalEventRootExprForField = (
	userId: string,
	expr: Expr,
	row: EventQueryRow,
	source: RootEventSourceV2,
): Effect.Effect<FieldValue, BadRequest | NotFound | DbError, CurrentDb> => {
	if (expr.type === "first") {
		if (expr.source.type === "events" && expr.source.entityRef === source.entity.alias) {
			return executeEventFirst(userId, row, expr);
		}
		return Effect.succeed({ kind: "null", value: null });
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

const evalIncludeExprForField = (
	userId: string,
	expr: Expr,
	row: IncludeQueryRow,
	include: IncludeEntryV2,
): Effect.Effect<FieldValue, BadRequest | NotFound | DbError, CurrentDb> => {
	if (expr.type === "first") {
		if (expr.source.type === "events" && expr.source.entityRef === include.source.alias) {
			return executeEventFirst(userId, row, expr);
		}
		return Effect.succeed({ kind: "null", value: null });
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

export const serializeRow = (row: EntityQueryRow, fields: RowsOutputV2["fields"]): RowItem => {
	const result: Record<string, RowValue> = {};
	for (const field of fields) {
		result[field.key] = evalExprForField(field.expr, row);
	}
	return result;
};

const serializeRootRow = (
	userId: string,
	row: EntityQueryRow,
	entityAlias: string,
	fields: RowsOutputV2["fields"],
): Effect.Effect<RowItem, BadRequest | NotFound | DbError, CurrentDb> =>
	Effect.gen(function* () {
		const result: Record<string, RowValue> = {};
		for (const field of fields) {
			result[field.key] = yield* evalRootExprForField(userId, field.expr, row, entityAlias);
		}
		return result;
	});

const serializeEventRootRow = (
	userId: string,
	row: EventQueryRow,
	source: RootEventSourceV2,
	fields: RowsOutputV2["fields"],
): Effect.Effect<RowItem, BadRequest | NotFound | DbError, CurrentDb> =>
	Effect.gen(function* () {
		const result: Record<string, RowValue> = {};
		for (const field of fields) {
			result[field.key] = yield* evalEventRootExprForField(userId, field.expr, row, source);
		}
		return result;
	});

const serializeIncludeRow = (
	userId: string,
	row: IncludeQueryRow,
	include: IncludeEntryV2,
): Effect.Effect<RowItem, BadRequest | NotFound | DbError, CurrentDb> =>
	Effect.gen(function* () {
		const result: Record<string, RowValue> = {};
		for (const field of include.fields) {
			result[field.key] = yield* evalIncludeExprForField(userId, field.expr, row, include);
		}
		return result;
	});

const includeOrderSql = (include: IncludeEntryV2): ReturnType<typeof sql> => {
	const viaAlias = include.source.via?.alias;
	const orderParts = include.orderBy.map((entry) => {
		if (entry.expr.type !== "ref") {
			return sql`1`;
		}
		const sourceAlias = entry.expr.sourceAlias === viaAlias ? "r" : "e";
		const exprSql = fieldSelectorToOrderSql(entry.expr.field, include.source.schemas, sourceAlias);
		if (!exprSql) {
			return sql`1`;
		}
		return entry.order === "asc" ? sql`${exprSql} ASC` : sql`${exprSql} DESC`;
	});
	return sql.join(orderParts, sql`, `);
};

const executeIncludeForParentRow = (
	userId: string,
	parentRow: BaseEntityQueryRow,
	include: IncludeEntryV2,
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
			visibleSchemas.map((s) => sql`${s.id}`),
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
					r.id AS "relationshipId",
					r.created_at AS "relationshipCreatedAt",
					r.source_entity_id AS "relationshipSourceEntityId",
					r.target_entity_id AS "relationshipTargetEntityId",
					r.properties AS "relationshipProperties",
					rs.slug AS "relationshipSchemaSlug",
					rs.name AS "relationshipSchemaName"
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

const serializeIncludesForRow = (
	userId: string,
	row: BaseEntityQueryRow,
	includes: readonly IncludeEntryV2[],
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

const eventRootOrderSql = (source: RootEventSourceV2, output: RowsOutputV2) => {
	const orderParts = output.orderBy.map((entry) => {
		if (entry.expr.type !== "ref") {
			return sql`1`;
		}
		const alias = entry.expr.sourceAlias === source.alias ? "ev" : "e";
		const schemas = alias === "ev" ? source.schemas : source.entity.schemas;
		const exprSql = fieldSelectorToOrderSql(entry.expr.field, schemas, alias);
		if (!exprSql) {
			return sql`1`;
		}
		return entry.order === "asc" ? sql`${exprSql} ASC` : sql`${exprSql} DESC`;
	});
	return sql.join(orderParts, sql`, `);
};

export const executeEntityRowsQuery = (
	userId: string,
	doc: RowsQueryDocumentV2,
): Effect.Effect<RowsResponseV2, BadRequest | NotFound | DbError, CurrentDb> =>
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

		const schemaIds = visibleSchemas.map((s) => s.id);

		const orderParts = output.orderBy.map((entry) => {
			const exprSql = exprToOrderSql(entry.expr, source.schemas);
			if (!exprSql) {
				return sql`1`; // Fallback for unsupported expressions; validator should catch these
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
			const item: Record<string, RowValue> = yield* serializeRootRow(
				userId,
				row,
				source.alias,
				output.fields,
			);
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

export const executeEventRowsQuery = (
	userId: string,
	doc: RowsQueryDocumentV2,
): Effect.Effect<RowsResponseV2, BadRequest | NotFound | DbError, CurrentDb> =>
	Effect.gen(function* () {
		const { source } = doc;
		const output = doc.output;
		if (source.type !== "events") {
			return yield* new BadRequest({ message: "Event rows query requires an event source" });
		}

		const visibleEntitySchemas = yield* loadVisibleEntitySchemas(userId, source.entity.schemas);
		const entitySchemaIds = visibleEntitySchemas.map((s) => s.id);
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
			visibleEventSchemas.map((s) => sql`${s.id}`),
			sql`, `,
		);
		const orderSql = eventRootOrderSql(source, output);
		const db = yield* CurrentDb;
		const offset = (output.pagination.page - 1) * output.pagination.limit;

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
				LIMIT ${output.pagination.limit}
				OFFSET ${offset}
			`),
		);

		const rows = rawRows.rows;
		const total = rows[0]?.totalCount !== undefined ? Number(rows[0].totalCount) : 0;
		let serializedRowCount = rows.length;
		const items: RowItem[] = [];
		for (const row of rows) {
			const item: Record<string, RowValue> = yield* serializeEventRootRow(
				userId,
				row,
				source,
				output.fields,
			);
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

export const executeRowsQuery = (
	userId: string,
	doc: RowsQueryDocumentV2,
): Effect.Effect<RowsResponseV2, BadRequest | NotFound | DbError, CurrentDb> =>
	doc.source.type === "events"
		? executeEventRowsQuery(userId, doc)
		: executeEntityRowsQuery(userId, doc);
