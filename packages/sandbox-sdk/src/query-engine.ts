import { Schema } from "@ryot/sandbox-sdk/effect";

import { entityRecordSchema, eventRecordSchema, type EntityRecord, type EventRecord } from "./core";
import type { JsonValue } from "./wire";

type QueryEngineRow = Readonly<Record<string, unknown>>;

const systemRef = (sourceAlias: string, name: string): JsonValue => ({
	type: "ref",
	sourceAlias,
	field: { type: "system", name },
});

const schemaRef = (sourceAlias: string, name: "name" | "slug"): JsonValue => ({
	type: "ref",
	sourceAlias,
	field: { type: "schema", name },
});

const queryField = (key: string, expr: JsonValue): JsonValue => ({ key, expr });

const equals = (left: JsonValue, value: string): JsonValue => ({
	left,
	operator: "eq",
	type: "comparison",
	right: { type: "literal", value },
});

const combine = (filters: readonly JsonValue[]): JsonValue | null => {
	const [first, ...rest] = filters;
	if (first === undefined) {
		return null;
	}
	return rest.length === 0 ? first : { type: "and", values: filters };
};

const any = (filters: readonly JsonValue[]): JsonValue | null => {
	const [first, ...rest] = filters;
	if (first === undefined) {
		return null;
	}
	return rest.length === 0 ? first : { type: "or", values: filters };
};

const entityFields = [
	queryField("id", systemRef("entity", "id")),
	queryField("name", systemRef("entity", "name")),
	queryField("createdAt", systemRef("entity", "createdAt")),
	queryField("updatedAt", systemRef("entity", "updatedAt")),
	queryField("properties", systemRef("entity", "properties")),
	queryField("entitySchemaSlug", systemRef("entity", "entitySchemaSlug")),
	queryField("providerId", systemRef("entity", "providerId")),
	queryField("externalId", systemRef("entity", "externalId")),
	queryField("populatedAt", systemRef("entity", "populatedAt")),
];

const eventFields = [
	queryField("id", systemRef("event", "id")),
	queryField("entityId", systemRef("event", "entityId")),
	queryField("createdAt", systemRef("event", "createdAt")),
	queryField("updatedAt", systemRef("event", "updatedAt")),
	queryField("occurredAt", systemRef("event", "occurredAt")),
	queryField("properties", systemRef("event", "properties")),
	queryField("eventSchemaName", schemaRef("event", "name")),
	queryField("eventSchemaSlug", schemaRef("event", "slug")),
	queryField("sessionEntityId", systemRef("event", "sessionEntityId")),
];

export const buildEntityReadQuery = (input: {
	readonly entityIds: readonly [string, ...string[]];
	readonly entitySchemaSlugs: readonly [string, ...string[]];
}): JsonValue => ({
	source: {
		alias: "entity",
		type: "entities",
		schemas: input.entitySchemaSlugs,
		where: any(input.entityIds.map((entityId) => equals(systemRef("entity", "id"), entityId))),
	},
	output: {
		type: "rows",
		fields: entityFields,
		pagination: { page: 1, limit: 100 },
		orderBy: [{ order: "asc", expr: systemRef("entity", "id") }],
	},
});

export const buildEventReadQuery = (input: {
	readonly page?: number;
	readonly entityId?: string;
	readonly eventSchemaSlug: string;
	readonly entitySchemaSlug: string;
	readonly sessionEntityId?: string;
}): JsonValue => ({
	source: {
		type: "events",
		alias: "event",
		schemas: [input.eventSchemaSlug],
		entity: { alias: "entity", schemas: [input.entitySchemaSlug] },
		where: combine([
			...(input.entityId === undefined
				? []
				: [equals(systemRef("event", "entityId"), input.entityId)]),
			...(input.sessionEntityId === undefined
				? []
				: [equals(systemRef("event", "sessionEntityId"), input.sessionEntityId)]),
		]),
	},
	output: {
		type: "rows",
		fields: eventFields,
		pagination: { page: input.page ?? 1, limit: 100 },
		orderBy: [
			{ order: "desc", expr: systemRef("event", "occurredAt") },
			{ order: "desc", expr: systemRef("event", "createdAt") },
			{ order: "desc", expr: systemRef("event", "id") },
		],
	},
});

const isRecord = (value: unknown): value is QueryEngineRow =>
	typeof value === "object" && value !== null && !Array.isArray(value);

export const queryEngineRows = (response: unknown): readonly QueryEngineRow[] => {
	if (Array.isArray(response)) {
		return response.filter(isRecord);
	}
	if (!isRecord(response)) {
		return [];
	}
	const result = response["data"];
	if (Array.isArray(result)) {
		return result.filter(isRecord);
	}
	const data = isRecord(result) && result["type"] === "rows" ? result["data"] : result;
	if (!isRecord(data) || !Array.isArray(data["items"])) {
		return [];
	}
	return data["items"].filter(isRecord);
};

const rowValues = (row: QueryEngineRow) =>
	Object.fromEntries(
		Object.entries(row).flatMap(([key, value]) =>
			isRecord(value) && "value" in value ? [[key, value["value"]]] : [],
		),
	);

export const queryEngineEntityRows = (response: unknown): readonly EntityRecord[] =>
	queryEngineRows(response).map((row) =>
		Schema.decodeUnknownSync(entityRecordSchema)(rowValues(row)),
	);

export const queryEngineEventRows = (response: unknown): readonly EventRecord[] =>
	queryEngineRows(response).map((row) => {
		const values = rowValues(row);
		const { sessionEntityId, ...rest } = values;
		return Schema.decodeUnknownSync(eventRecordSchema)({
			...rest,
			...(sessionEntityId === null ? {} : { sessionEntityId }),
		});
	});
