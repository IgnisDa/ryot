import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "~/lib/db";
import { entitySchema, eventSchema, relationshipSchema } from "~/lib/db/schema";
import {
	QueryEngineNotFoundError,
	QueryEngineValidationError,
} from "~/lib/views/errors";
import type {
	QueryEngineEventJoinLike,
	QueryEngineEventSchemaLike,
} from "~/lib/views/reference";
import { propertySchemaObjectSchema } from "~/modules/property-schemas";
import type {
	EventJoinDefinition,
	RelationshipFilter,
} from "../saved-views/schemas";
import type { QueryEngineSchemaRow } from "./query-ctes";

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
			throw new QueryEngineValidationError(
				`Schema '${slug}' resolves to multiple visible schemas`,
			);
		}
	}
};

export const validateVisibleEventJoins = (
	eventJoins: EventJoinDefinition[],
	visibleEventSchemas: (QueryEngineEventSchemaLike & {
		entitySchemaSlug: string;
	})[],
) => {
	const eventSchemasByEntitySchemaKey = new Map<
		string,
		QueryEngineEventSchemaLike
	>();
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
			eventSchemaMap: new Map(
				eventSchemas.map((schema) => [schema.entitySchemaSlug, schema]),
			),
		};
	});
};

export const validateEventSchemaSlugs = (
	uniqueSlugs: string[],
	rows: { slug: string }[],
) => {
	for (const slug of uniqueSlugs) {
		if (!rows.some((r) => r.slug === slug)) {
			throw new QueryEngineNotFoundError(
				`Event schema '${slug}' not found for the requested entity schemas`,
			);
		}
	}
};

export const validateRelationshipSlugs = (
	uniqueSlugs: string[],
	foundSlugs: Set<string>,
) => {
	for (const slug of uniqueSlugs) {
		if (!foundSlugs.has(slug)) {
			throw new QueryEngineNotFoundError(
				`Relationship schema '${slug}' not found`,
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

	const schemas = rows.map((row) => ({
		...row,
		propertiesSchema: parseAppSchema(row.propertiesSchema),
	}));
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

	const uniqueEventSchemaSlugs = [
		...new Set(input.eventJoins.map((join) => join.eventSchemaSlug)),
	];
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

	const visibleEventSchemas = rows.map((row) => ({
		...row,
		propertiesSchema: parseAppSchema(row.propertiesSchema),
	}));

	return validateVisibleEventJoins(input.eventJoins, visibleEventSchemas);
};

export const loadRelationshipSchemaIds = async (
	relationships: RelationshipFilter[],
): Promise<string[]> => {
	if (!relationships.length) {
		return [];
	}

	const uniqueSlugs = [
		...new Set(relationships.map((r) => r.relationshipSchemaSlug)),
	];
	const rows = await db
		.select({ id: relationshipSchema.id, slug: relationshipSchema.slug })
		.from(relationshipSchema)
		.where(
			and(
				inArray(relationshipSchema.slug, uniqueSlugs),
				isNull(relationshipSchema.userId),
			),
		);

	const foundSlugs = new Set(rows.map((r) => r.slug));
	validateRelationshipSlugs(uniqueSlugs, foundSlugs);

	return rows.map((r) => r.id);
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
