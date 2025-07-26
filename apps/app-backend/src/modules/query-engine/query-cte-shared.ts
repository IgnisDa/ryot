import { sql, type SQLChunk } from "drizzle-orm";

import { entity, entitySchema, eventSchema } from "~/lib/db/schema";
import type { EntityColumnOverrides, QueryEngineSchemaLike } from "~/lib/views/reference";

import type { SqlExpression } from "./sql-expression-helpers";

export type QueryEngineSchemaRow = QueryEngineSchemaLike & {
	id: string;
};

type JsonField = {
	key: string;
	value: SQLChunk;
};

type EntityDataField = {
	key: string;
	alias: string;
	value: SQLChunk;
};

type PaginationConfig = {
	limit: number;
	offset: number;
	countAlias: string;
	rowIdColumn: string;
	sortedAlias: string;
	filteredAlias: string;
	paginatedAlias: string;
	joinedTableName: string;
};

const createPaginatedCteAliases = (plural: string, singular: string) => {
	return {
		base: `base_${plural}`,
		count: `${singular}_count`,
		joined: `joined_${plural}`,
		sorted: `sorted_${plural}`,
		filtered: `filtered_${plural}`,
		paginated: `paginated_${plural}`,
	} as const;
};

export const ENTITY_CTE_ALIASES = createPaginatedCteAliases("entities", "entity");

export const EVENT_CTE_ALIASES = createPaginatedCteAliases("events", "event");

export const TIMESERIES_CTE_ALIASES = {
	bucketed: "bucketed",
	bucketSeries: "bucket_series",
	matchingEvents: "matching_events",
	filteredEvents: "filtered_events",
} as const;

export const EVENT_FIRST_ENTITY_COLUMN_OVERRIDES: EntityColumnOverrides = {
	id: "entity_id",
	properties: "entity_properties",
	created_at: "entity_created_at",
	updated_at: "entity_updated_at",
};

const buildJsonObjectExpression = (fields: JsonField[]) => {
	const keyChunks = fields.flatMap((field) => [
		sql.raw(`'${field.key.replaceAll("'", "''")}'`),
		field.value,
	]);

	return sql`jsonb_build_object(${sql.join(keyChunks, sql`, `)})`;
};

const ENTITY_DATA_FIELDS: EntityDataField[] = [
	{ key: "id", alias: "id", value: entity.id },
	{ key: "name", alias: "name", value: entity.name },
	{ key: "image", alias: "image", value: entity.image },
	{ key: "createdAt", alias: "created_at", value: entity.createdAt },
	{ key: "updatedAt", alias: "updated_at", value: entity.updatedAt },
	{ key: "properties", alias: "properties", value: entity.properties },
	{ key: "externalId", alias: "external_id", value: entity.externalId },
	{ key: "sandboxScriptId", alias: "sandbox_script_id", value: entity.sandboxScriptId },
];

export const buildEntitySelectColumns = () => {
	const entitySchemaData = buildEntitySchemaDataExpression();
	return sql.join(
		[
			...ENTITY_DATA_FIELDS.map((field) => sql`${field.value} as ${sql.raw(field.alias)}`),
			sql`${entitySchemaData} as entity_schema_data`,
		],
		sql`, `,
	);
};

export const buildEntityDataObjectExpression = (alias: string) => {
	return buildJsonObjectExpression(
		ENTITY_DATA_FIELDS.map((field) => ({
			key: field.key,
			value: sql.raw(`${alias}.${field.alias}`),
		})),
	);
};

export const buildEntitySchemaDataExpression = () =>
	buildJsonObjectExpression([
		{ key: "id", value: entitySchema.id },
		{ key: "slug", value: entitySchema.slug },
		{ key: "name", value: entitySchema.name },
		{ key: "icon", value: entitySchema.icon },
		{ key: "userId", value: entitySchema.userId },
		{ key: "isBuiltin", value: entitySchema.isBuiltin },
		{ key: "createdAt", value: entitySchema.createdAt },
		{ key: "updatedAt", value: entitySchema.updatedAt },
		{ key: "accentColor", value: entitySchema.accentColor },
	]);

export const buildEventSchemaDataExpression = () =>
	buildJsonObjectExpression([
		{ key: "id", value: eventSchema.id },
		{ key: "slug", value: eventSchema.slug },
		{ key: "name", value: eventSchema.name },
		{ key: "isBuiltin", value: eventSchema.isBuiltin },
		{ key: "createdAt", value: eventSchema.createdAt },
		{ key: "updatedAt", value: eventSchema.updatedAt },
	]);

export const getEventJoinCteName = (joinKey: string) => `latest_event_join_${joinKey}`;

export type PaginatedQueryInput = PaginationConfig & {
	direction: SqlExpression;
	withCtes: SqlExpression[];
	filterClause: SqlExpression;
	sortExpression: SqlExpression;
	resolvedFields: SqlExpression;
};
