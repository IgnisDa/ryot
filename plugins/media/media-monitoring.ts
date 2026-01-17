import type { JsonValue } from "@ryot/sandbox-sdk/wire";

import { builtinMediaEntitySchemaSlugs } from "./schemas/media-schema-slugs";

export const mediaMonitorableEntitySchemaSlugs = [
	"company",
	"person",
	...builtinMediaEntitySchemaSlugs,
] as const;

const entityIdFilter = (entityIds: readonly [string, ...string[]]) => {
	const [first, ...rest] = entityIds;
	const comparison = (entityId: string): JsonValue => ({
		operator: "eq",
		type: "comparison",
		right: { type: "literal", value: entityId },
		left: systemRef("entity", "id"),
	});
	const firstComparison = comparison(first);
	return rest.length === 0
		? firstComparison
		: { type: "or", values: [firstComparison, ...rest.map(comparison)] };
};

const systemRef = (sourceAlias: string, name: string): JsonValue => ({
	type: "ref",
	sourceAlias,
	field: { type: "system", name },
});

const queryField = (key: string, sourceAlias: string, name: string): JsonValue => ({
	key,
	expr: systemRef(sourceAlias, name),
});

const ascending = (sourceAlias: string): JsonValue => ({
	order: "asc",
	expr: systemRef(sourceAlias, "id"),
});

const providerBackedFilter: JsonValue = {
	type: "and",
	values: [
		{ type: "isNull", expr: systemRef("entity", "userId") },
		{ type: "isNotNull", expr: systemRef("entity", "externalId") },
		{ type: "isNotNull", expr: systemRef("entity", "providerId") },
	],
};

const monitoringLibrarySource: JsonValue = {
	type: "entities",
	alias: "library",
	schemas: ["library"],
	where: null,
	via: {
		entityRef: "entity",
		alias: "mediaMonitoringRelationship",
		direction: "outgoing" as const,
		schema: "media-monitoring",
	},
};

const targetFields = [
	queryField("entityId", "entity", "id"),
	queryField("externalId", "entity", "externalId"),
	queryField("providerId", "entity", "providerId"),
	queryField("entitySchemaSlug", "entity", "entitySchemaSlug"),
];

export const buildMediaMonitoringTargetsQuery = (entityIds: readonly string[]) => {
	const [firstEntityId, ...remainingEntityIds] = entityIds;
	if (!firstEntityId) {
		throw new Error("At least one entity id is required");
	}
	return {
		source: {
			type: "entities",
			alias: "entity",
			schemas: [...mediaMonitorableEntitySchemaSlugs],
			where: {
				type: "and",
				values: [providerBackedFilter, entityIdFilter([firstEntityId, ...remainingEntityIds])],
			},
		},
		output: {
			type: "rows",
			fields: targetFields,
			orderBy: [ascending("entity")],
			include: [
				{
					key: "monitoringLibraries",
					limit: 1,
					fields: [queryField("entityId", "library", "id")],
					source: monitoringLibrarySource,
					orderBy: [ascending("library")],
				},
			],
			pagination: { page: 1, limit: entityIds.length },
		},
	} satisfies JsonValue;
};

export const buildUserLibraryQuery = () =>
	({
		source: {
			type: "entities",
			alias: "library",
			schemas: ["library"],
			where: { type: "isNotNull", expr: systemRef("library", "userId") },
		},
		output: {
			type: "rows",
			fields: [queryField("entityId", "library", "id")],
			orderBy: [ascending("library")],
			pagination: { page: 1, limit: 1 },
		},
	}) satisfies JsonValue;

export const buildMediaMonitoringSweepQuery = (page: number, limit: number) =>
	({
		source: {
			type: "entities",
			alias: "entity",
			schemas: [...mediaMonitorableEntitySchemaSlugs],
			where: {
				type: "and",
				values: [providerBackedFilter, { type: "exists", source: monitoringLibrarySource }],
			},
		},
		output: {
			type: "rows",
			fields: targetFields,
			orderBy: [ascending("entity")],
			pagination: { page, limit },
		},
	}) satisfies JsonValue;

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const fieldString = (row: UnknownRecord, key: string) => {
	const field = row[key];
	return isRecord(field) && typeof field["value"] === "string" ? field["value"] : null;
};

export type MediaMonitoringTarget = {
	entityId: string;
	externalId: string;
	providerId: string;
	entitySchemaSlug: string;
	monitoringLibraryId: string | null;
};

export const mediaMonitoringRows = (response: unknown) => {
	if (!isRecord(response) || !isRecord(response["data"])) {
		return [];
	}
	const items = response["data"]["items"];
	if (!Array.isArray(items)) {
		return [];
	}
	return items.flatMap((item): MediaMonitoringTarget[] => {
		if (!isRecord(item)) {
			return [];
		}
		const entityId = fieldString(item, "entityId");
		const externalId = fieldString(item, "externalId");
		const providerId = fieldString(item, "providerId");
		const entitySchemaSlug = fieldString(item, "entitySchemaSlug");
		if (!entityId || !externalId || !providerId || !entitySchemaSlug) {
			return [];
		}
		const libraries = item["monitoringLibraries"];
		const firstLibrary =
			isRecord(libraries) && Array.isArray(libraries["items"]) ? libraries["items"][0] : undefined;
		return [
			{
				entityId,
				externalId,
				providerId,
				entitySchemaSlug,
				monitoringLibraryId: isRecord(firstLibrary) ? fieldString(firstLibrary, "entityId") : null,
			},
		];
	});
};

export const queryPageHasMore = (response: unknown) =>
	isRecord(response) &&
	isRecord(response["data"]) &&
	isRecord(response["data"]["pageInfo"]) &&
	response["data"]["pageInfo"]["hasMore"] === true;

export const queryFirstEntityId = (response: unknown) => {
	if (!isRecord(response) || !isRecord(response["data"])) {
		return null;
	}
	const items = response["data"]["items"];
	const first = Array.isArray(items) ? items[0] : undefined;
	return isRecord(first) ? fieldString(first, "entityId") : null;
};
