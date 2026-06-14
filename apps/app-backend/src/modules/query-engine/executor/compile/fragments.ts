import { sql } from "drizzle-orm";

import { SYSTEM_DATE_FIELDS_BY_KIND, type RootAliasKind } from "../types";

export type SqlFragment = ReturnType<typeof sql>;

const ENTITY_COLUMNS: Record<string, string> = {
	id: "id",
	name: "name",
	userId: "user_id",
	createdAt: "created_at",
	updatedAt: "updated_at",
	properties: "properties",
	externalId: "external_id",
	populatedAt: "populated_at",
	entitySchemaId: "entity_schema_id",
	sandboxScriptId: "sandbox_script_id",
};

const EVENT_COLUMNS: Record<string, string> = {
	id: "id",
	userId: "user_id",
	entityId: "entity_id",
	createdAt: "created_at",
	updatedAt: "updated_at",
	properties: "properties",
	occurredAt: "occurred_at",
	eventSchemaId: "event_schema_id",
	sessionEntityId: "session_entity_id",
};

const RELATIONSHIP_COLUMNS: Record<string, string> = {
	id: "id",
	createdAt: "created_at",
	sourceEntityId: "source_entity_id",
	targetEntityId: "target_entity_id",
};

const COLUMNS_BY_KIND: Record<RootAliasKind, Record<string, string>> = {
	entity: ENTITY_COLUMNS,
	event: EVENT_COLUMNS,
	relationship: RELATIONSHIP_COLUMNS,
};

// The physical column for a system field on a given root-alias table, e.g. `e.created_at`.
// Null when the field is not a column of this kind (validation prevents that for valid documents).
export const systemColumnSql = (
	kind: RootAliasKind,
	name: string,
	sqlAlias: string,
): SqlFragment | null => {
	const column = COLUMNS_BY_KIND[kind][name];
	return column ? sql.raw(`${sqlAlias}.${column}`) : null;
};

// Schema-metadata columns live on the `<alias>s` schema-join table.
export const schemaColumnSql = (name: string, sqlAlias: string): SqlFragment =>
	sql.raw(`${sqlAlias}s.${name === "isBuiltin" ? "is_builtin" : name}`);

export const isSystemDateField = (kind: RootAliasKind, name: string): boolean =>
	SYSTEM_DATE_FIELDS_BY_KIND[kind].has(name);

export const propertyExtractSql = (sqlAlias: string, path: readonly string[]): SqlFragment => {
	const pathArgs = path.map((key) => sql`${key}`);
	return sql`jsonb_extract_path(${sql.raw(sqlAlias)}.properties, ${sql.join(pathArgs, sql`, `)})`;
};

export const propertyExtractTextSql = (sqlAlias: string, path: readonly string[]): SqlFragment => {
	const pathArgs = path.map((key) => sql`${key}`);
	return sql`jsonb_extract_path_text(${sql.raw(sqlAlias)}.properties, ${sql.join(pathArgs, sql`, `)})`;
};

// Escape %, _ and backslash so a user needle matches literally inside an ILIKE pattern.
export const escapeContainsPattern = (value: string): string =>
	`%${value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;

// Maps jsonb_typeof(...) to the FieldValue `kind` from the value's runtime JSON type.
export const jsonbTypeofKindSql = (value: SqlFragment): SqlFragment =>
	sql`CASE jsonb_typeof(${value}) WHEN 'string' THEN 'text' WHEN 'number' THEN 'number' WHEN 'boolean' THEN 'boolean' WHEN 'object' THEN 'json' WHEN 'array' THEN 'json' ELSE 'null' END`;

// Visibility predicate: the row is the user's own or a global (null-owner) row.
export const userVisibleSql = (sqlAlias: string, userId: string): SqlFragment =>
	sql`(${sql.raw(sqlAlias)}.user_id = ${userId} OR ${sql.raw(sqlAlias)}.user_id IS NULL)`;

// UTC, ISO/Monday-start weeks: date_trunc('week') is Monday-based and the AT TIME ZONE 'UTC'
// sandwich truncates on UTC boundaries regardless of session time zone while returning a timestamptz.
export const timeBucketSql = (
	bucket: "hour" | "day" | "week" | "month",
	timeColSql: SqlFragment,
): SqlFragment => sql`date_trunc(${bucket}, ${timeColSql} AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`;

export const timeRangeConditionSql = (
	timeColSql: SqlFragment,
	startAt: string,
	endAt: string,
): SqlFragment =>
	sql`(${timeColSql} >= ${startAt}::timestamptz AND ${timeColSql} < ${endAt}::timestamptz)`;
