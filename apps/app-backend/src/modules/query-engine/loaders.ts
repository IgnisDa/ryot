import { and, eq, inArray, isNull, or } from "drizzle-orm";

import { db } from "~/lib/db";
import { entitySchema, eventSchema, relationshipSchema } from "~/lib/db/schema";
import { QueryEngineNotFoundError, QueryEngineValidationError } from "~/lib/views/errors";
import type { QueryEngineEventJoinLike, QueryEngineEventSchemaLike } from "~/lib/views/reference";
import { propertySchemaObjectSchema } from "~/modules/property-schemas";

import type { EventJoinDefinition, LatestRelationshipJoinDefinition } from "../saved-views/schemas";
import type { LoadedRelationshipJoin } from "./context";
import type { QueryEngineSchemaRow } from "./query-cte-shared";

const parseAppSchema = (value: unknown) => {
	return propertySchemaObjectSchema.parse(value);
};

export const validateUniqueSchemaSlugs = (
	uniqueSlugs: string[],
	schemas: QueryEngineSchemaRow[],
) => {
	const schemasBySlug = new Map<string, QueryEngineSchemaRow[]>();
	for (const schema of schemas) {
		const existing = schemasBySlug.get(schema.slug) ?? [];
		existing.push(schema);
		schemasBySlug.set(schema.slug, existing);
	}

	for (const slug of uniqueSlugs) {
		const found = schemasBySlug.get(slug);
		if (!found?.length) {
			throw new QueryEngineNotFoundError(`Schema '${slug}' not found`);
		}

		if (found.length > 1) {
			throw new QueryEngineValidationError(`Schema '${slug}' resolves to multiple visible schemas`);
		}
	}
};

export const validateVisibleEventJoins = (
	eventJoins: EventJoinDefinition[],
	visibleEventSchemas: (QueryEngineEventSchemaLike & {
		entitySchemaSlug: string;
	})[],
) => {
	const eventSchemasByEntitySchemaKey = new Map<string, QueryEngineEventSchemaLike>();
	for (const schema of visibleEventSchemas) {
		const key = `${schema.entitySchemaSlug}:${schema.slug}`;
		if (eventSchemasByEntitySchemaKey.has(key)) {
			throw new QueryEngineValidationError(
				`Event schema '${schema.slug}' resolves to multiple visible schemas for entity schema '${schema.entitySchemaSlug}'`,
			);
		}

		eventSchemasByEntitySchemaKey.set(key, schema);
	}

	return eventJoins.map((join) => {
		const eventSchemas = visibleEventSchemas.filter(
			(schema) => schema.slug === join.eventSchemaSlug,
		);
		if (!eventSchemas.length) {
			throw new QueryEngineValidationError(
				`Event schema '${join.eventSchemaSlug}' is not available for the requested entity schemas`,
			);
		}

		return {
			...join,
			eventSchemas,
			eventSchemaMap: new Map(eventSchemas.map((schema) => [schema.entitySchemaSlug, schema])),
		};
	});
};

export const validateEventSchemaSlugs = (uniqueSlugs: string[], rows: { slug: string }[]) => {
	for (const slug of uniqueSlugs) {
		if (!rows.some((r) => r.slug === slug)) {
			throw new QueryEngineValidationError(
				`Event schema '${slug}' not found for the requested entity schemas`,
			);
		}
	}
};

export const validateVisibleRelationshipSchemaRows = (
	slugs: string[],
	rows: { id: string; slug: string }[],
) => {
	const rowsBySlug = new Map<string, { id: string; slug: string }[]>();
	for (const row of rows) {
		const existing = rowsBySlug.get(row.slug) ?? [];
		existing.push(row);
		rowsBySlug.set(row.slug, existing);
	}

	for (const slug of slugs) {
		const found = rowsBySlug.get(slug);
		if (!found?.length) {
			throw new QueryEngineValidationError(`Relationship schema '${slug}' not found`);
		}
		if (found.length > 1) {
			throw new QueryEngineValidationError(
				`Relationship schema '${slug}' resolves to multiple visible schemas`,
			);
		}
	}
};

export const loadVisibleSchemas = async (input: {
	userId: string;
	scope: string[];
}): Promise<QueryEngineSchemaRow[]> => {
	const uniqueSlugs = [...new Set(input.scope)];
	const rows = await db
		.select({
			id: entitySchema.id,
			slug: entitySchema.slug,
			propertiesSchema: entitySchema.propertiesSchema,
		})
		.from(entitySchema)
		.where(
			and(
				inArray(entitySchema.slug, uniqueSlugs),
				or(isNull(entitySchema.userId), eq(entitySchema.userId, input.userId)),
			),
		);

	const schemas = rows.map((row) =>
		Object.assign(row, {
			propertiesSchema: parseAppSchema(row.propertiesSchema),
		}),
	);
	validateUniqueSchemaSlugs(uniqueSlugs, schemas);

	return schemas;
};

export const loadVisibleEventJoins = async (input: {
	userId: string;
	eventJoins: EventJoinDefinition[];
	runtimeSchemas: QueryEngineSchemaRow[];
}): Promise<QueryEngineEventJoinLike[]> => {
	if (!input.eventJoins.length) {
		return [];
	}

	const uniqueEventSchemaSlugs = [...new Set(input.eventJoins.map((join) => join.eventSchemaSlug))];
	const rows = await db
		.select({
			id: eventSchema.id,
			slug: eventSchema.slug,
			entitySchemaSlug: entitySchema.slug,
			entitySchemaId: eventSchema.entitySchemaId,
			propertiesSchema: eventSchema.propertiesSchema,
		})
		.from(eventSchema)
		.innerJoin(entitySchema, eq(eventSchema.entitySchemaId, entitySchema.id))
		.where(
			and(
				inArray(
					eventSchema.entitySchemaId,
					input.runtimeSchemas.map((schema) => schema.id),
				),
				inArray(eventSchema.slug, uniqueEventSchemaSlugs),
				or(isNull(eventSchema.userId), eq(eventSchema.userId, input.userId)),
			),
		);

	const visibleEventSchemas = rows.map((row) =>
		Object.assign(row, {
			propertiesSchema: parseAppSchema(row.propertiesSchema),
		}),
	);

	return validateVisibleEventJoins(input.eventJoins, visibleEventSchemas);
};

export const loadVisibleRelationshipJoins = async (input: {
	userId: string;
	runtimeSchemas?: QueryEngineSchemaRow[];
	relationshipJoins: LatestRelationshipJoinDefinition[];
}): Promise<LoadedRelationshipJoin[]> => {
	if (!input.relationshipJoins.length) {
		return [];
	}

	const uniqueSlugs = [...new Set(input.relationshipJoins.map((r) => r.relationshipSchemaSlug))];
	const rows = await db
		.select({
			id: relationshipSchema.id,
			slug: relationshipSchema.slug,
			propertiesSchema: relationshipSchema.propertiesSchema,
			sourceEntitySchemaId: relationshipSchema.sourceEntitySchemaId,
			targetEntitySchemaId: relationshipSchema.targetEntitySchemaId,
		})
		.from(relationshipSchema)
		.where(
			and(
				inArray(relationshipSchema.slug, uniqueSlugs),
				or(isNull(relationshipSchema.userId), eq(relationshipSchema.userId, input.userId)),
			),
		);

	validateVisibleRelationshipSchemaRows(uniqueSlugs, rows);

	const entitySchemaIds = [
		...new Set(
			rows.flatMap((r) =>
				[r.sourceEntitySchemaId, r.targetEntitySchemaId].filter((id): id is string => id !== null),
			),
		),
	];

	const entitySchemaRows = entitySchemaIds.length
		? await db
				.select({
					id: entitySchema.id,
					slug: entitySchema.slug,
					propertiesSchema: entitySchema.propertiesSchema,
				})
				.from(entitySchema)
				.where(inArray(entitySchema.id, entitySchemaIds))
		: [];

	const entitySchemaById = new Map(entitySchemaRows.map((r) => [r.id, r]));
	const schemaBySlug = new Map(rows.map((r) => [r.slug, r]));
	const scopeSlugs = input.runtimeSchemas ? new Set(input.runtimeSchemas.map((s) => s.slug)) : null;

	return input.relationshipJoins.map((join) => {
		const schema = schemaBySlug.get(join.relationshipSchemaSlug);
		if (!schema) {
			throw new QueryEngineValidationError(
				`Relationship schema '${join.relationshipSchemaSlug}' not found`,
			);
		}

		const sourceRow = schema.sourceEntitySchemaId
			? entitySchemaById.get(schema.sourceEntitySchemaId)
			: null;
		const targetRow = schema.targetEntitySchemaId
			? entitySchemaById.get(schema.targetEntitySchemaId)
			: null;

		if (scopeSlugs) {
			if (join.direction === "outgoing" && sourceRow && !scopeSlugs.has(sourceRow.slug)) {
				throw new QueryEngineValidationError(
					`Relationship join '${join.key}': outgoing direction requires source entity schema '${sourceRow.slug}' to be in the query scope`,
				);
			}
			if (join.direction === "incoming" && targetRow && !scopeSlugs.has(targetRow.slug)) {
				throw new QueryEngineValidationError(
					`Relationship join '${join.key}': incoming direction requires target entity schema '${targetRow.slug}' to be in the query scope`,
				);
			}
		}

		return {
			...join,
			schemaId: schema.id,
			filter: join.filter ?? null,
			propertiesSchema: parseAppSchema(schema.propertiesSchema),
			sourceEntitySchema: sourceRow
				? { slug: sourceRow.slug, propertiesSchema: parseAppSchema(sourceRow.propertiesSchema) }
				: undefined,
			targetEntitySchema: targetRow
				? { slug: targetRow.slug, propertiesSchema: parseAppSchema(targetRow.propertiesSchema) }
				: undefined,
		};
	});
};

export const loadEventSchemaSlugs = async (input: {
	userId: string;
	runtimeSchemas: QueryEngineSchemaRow[];
}): Promise<ReadonlySet<string>> => {
	if (!input.runtimeSchemas.length) {
		return new Set();
	}

	const rows = await db
		.selectDistinct({ slug: eventSchema.slug })
		.from(eventSchema)
		.where(
			and(
				inArray(
					eventSchema.entitySchemaId,
					input.runtimeSchemas.map((s) => s.id),
				),
				or(isNull(eventSchema.userId), eq(eventSchema.userId, input.userId)),
			),
		);

	return new Set(rows.map((r) => r.slug));
};

export const loadEventSchemasBySlug = async (input: {
	userId: string;
	eventSchemaSlugs: string[];
	runtimeSchemas: QueryEngineSchemaRow[];
}): Promise<Map<string, QueryEngineEventSchemaLike[]>> => {
	if (!input.eventSchemaSlugs.length || !input.runtimeSchemas.length) {
		return new Map();
	}

	const uniqueSlugs = [...new Set(input.eventSchemaSlugs)];
	const rows = await db
		.select({
			id: eventSchema.id,
			slug: eventSchema.slug,
			entitySchemaSlug: entitySchema.slug,
			entitySchemaId: eventSchema.entitySchemaId,
			propertiesSchema: eventSchema.propertiesSchema,
		})
		.from(eventSchema)
		.innerJoin(entitySchema, eq(eventSchema.entitySchemaId, entitySchema.id))
		.where(
			and(
				inArray(
					eventSchema.entitySchemaId,
					input.runtimeSchemas.map((s) => s.id),
				),
				inArray(eventSchema.slug, uniqueSlugs),
				or(isNull(eventSchema.userId), eq(eventSchema.userId, input.userId)),
			),
		);

	validateEventSchemaSlugs(uniqueSlugs, rows);

	const eventSchemaMap = new Map<string, QueryEngineEventSchemaLike[]>();
	for (const row of rows) {
		const parsedRow = {
			...row,
			propertiesSchema: parseAppSchema(row.propertiesSchema),
		};
		const existing = eventSchemaMap.get(row.slug) ?? [];
		existing.push(parsedRow);
		eventSchemaMap.set(row.slug, existing);
	}

	return eventSchemaMap;
};
