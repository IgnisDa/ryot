import { createEntityColumnExpression, dayjs, getQueryEngineField } from "@ryot/ts-utils";

import type {
	ApiGetResponseData,
	ApiPostRequestBody,
	ApiPostResponseEnvelope,
} from "~/lib/api/types";

type QueryEngineRequest = Extract<
	ApiPostRequestBody<"/query-engine/execute">,
	{ mode: "entities" }
>;
type ApiEntity = ApiGetResponseData<"/entities/{entityId}">;
export type QueryEngineEntitiesResponse = Extract<
	ApiPostResponseEnvelope<"/query-engine/execute">,
	{ mode: "entities" }
>;
export type QueryEngineEntitiesItem = QueryEngineEntitiesResponse["data"]["items"][number];
type QueryEngineItem = QueryEngineEntitiesItem;
type ApiEntityInput = ApiEntity | QueryEngineEntitiesItem;

function hasQueryEngineMode(value: unknown): value is { mode: unknown } {
	return !!value && typeof value === "object" && "mode" in value;
}

export function isQueryEngineEntitiesResponse(
	value: unknown,
): value is QueryEngineEntitiesResponse {
	return hasQueryEngineMode(value) && value.mode === "entities" && "data" in value;
}

export type SearchResultItem = {
	externalId: string;
	calloutProperty: { kind: "null"; value: null };
	titleProperty: { kind: "text"; value: string };
	primarySubtitleProperty: { kind: "number" | "null"; value: number | null };
	secondarySubtitleProperty: { kind: "null"; value: null };
	imageProperty: {
		kind: "image" | "null";
		value: { type: "remote"; url: string } | null;
	};
};

export type AppEntityImage = null | { type: "s3"; key: string } | { type: "remote"; url: string };

export type AppEntity = Omit<
	ApiEntity,
	"createdAt" | "updatedAt" | "populatedAt" | "image" | "entitySchemaId"
> & {
	createdAt: Date;
	updatedAt: Date;
	populatedAt?: Date;
	image: AppEntityImage;
	entitySchemaId?: string;
	sandboxScriptId: string | null;
	fields?: QueryEngineItem;
};

export const queryEngineEntityFieldKeys = {
	id: "entityId",
	name: "entityName",
	image: "entityImage",
	createdAt: "entityCreatedAt",
	updatedAt: "entityUpdatedAt",
	externalId: "entityExternalId",
	sandboxScriptId: "entitySandboxScriptId",
} as const;

type CreateEntityIdentityFieldsOptions = {
	includeImage?: boolean;
};

const buildFieldExpression = (
	schemaSlugs: string[],
	column: Parameters<typeof createEntityColumnExpression>[1],
) => {
	const expressions = schemaSlugs.map((schemaSlug) =>
		createEntityColumnExpression(schemaSlug, column),
	);
	const [expression] = expressions;
	if (!expression) {
		throw new Error("At least one entity schema slug is required");
	}
	if (expressions.length === 1) {
		return expression;
	}

	return { type: "coalesce" as const, values: expressions };
};

export const createEntityIdentityFields = (
	schemaSlugs: string[],
	options: CreateEntityIdentityFieldsOptions = {},
) =>
	[
		{
			key: queryEngineEntityFieldKeys.id,
			expression: buildFieldExpression(schemaSlugs, "id"),
		},
		{
			key: queryEngineEntityFieldKeys.name,
			expression: buildFieldExpression(schemaSlugs, "name"),
		},
		...(options.includeImage === false
			? []
			: [
					{
						key: queryEngineEntityFieldKeys.image,
						expression: buildFieldExpression(schemaSlugs, "image"),
					},
				]),
		{
			key: queryEngineEntityFieldKeys.createdAt,
			expression: buildFieldExpression(schemaSlugs, "createdAt"),
		},
		{
			key: queryEngineEntityFieldKeys.updatedAt,
			expression: buildFieldExpression(schemaSlugs, "updatedAt"),
		},
		{
			key: queryEngineEntityFieldKeys.externalId,
			expression: buildFieldExpression(schemaSlugs, "externalId"),
		},
		{
			key: queryEngineEntityFieldKeys.sandboxScriptId,
			expression: buildFieldExpression(schemaSlugs, "sandboxScriptId"),
		},
	] satisfies NonNullable<QueryEngineRequest["fields"]>;

export function createEntityRuntimeRequest(entitySchemaSlug: string): QueryEngineRequest {
	return {
		mode: "entities",
		fields: createEntityIdentityFields([entitySchemaSlug]),
		eventJoins: [],
		computedFields: [],
		pagination: { page: 1, limit: 1000 },
		scope: [entitySchemaSlug],
		sort: {
			direction: "asc",
			expression: createEntityColumnExpression(entitySchemaSlug, "name"),
		},
	};
}

export function toAppEntityImage(image: unknown): AppEntityImage {
	if (!image || typeof image !== "object") {
		return null;
	}

	if (
		"type" in image &&
		image.type === "remote" &&
		"url" in image &&
		typeof image.url === "string"
	) {
		return { type: "remote", url: image.url };
	}

	if ("type" in image && image.type === "s3" && "key" in image && typeof image.key === "string") {
		return { type: "s3", key: image.key };
	}

	return null;
}

function isQueryEngineEntity(entity: ApiEntityInput): entity is QueryEngineItem {
	return (
		!!entity &&
		typeof entity === "object" &&
		!Array.isArray(entity) &&
		queryEngineEntityFieldKeys.id in entity &&
		queryEngineEntityFieldKeys.name in entity
	);
}

function getRequiredQueryEngineStringField(item: QueryEngineItem, key: string): string {
	const value = getQueryEngineField(item, key)?.value;
	if (typeof value !== "string") {
		throw new Error(`Missing required query engine field '${key}'`);
	}

	return value;
}

function getOptionalQueryEngineStringField(item: QueryEngineItem, key: string): string | null {
	const value = getQueryEngineField(item, key)?.value;
	return typeof value === "string" ? value : null;
}

function getRequiredQueryEngineDateLikeField(
	item: QueryEngineItem,
	key: string,
): string | number | Date {
	const value = getQueryEngineField(item, key)?.value;
	if (typeof value === "string" || typeof value === "number" || value instanceof Date) {
		return value;
	}

	throw new Error(`Missing required query engine field '${key}'`);
}

export function toAppEntity(entity: ApiEntityInput): AppEntity {
	const hasPartialQueryEngineShape =
		!!entity &&
		typeof entity === "object" &&
		!Array.isArray(entity) &&
		(queryEngineEntityFieldKeys.id in entity || queryEngineEntityFieldKeys.name in entity);
	if (hasPartialQueryEngineShape && !isQueryEngineEntity(entity)) {
		throw new Error("Query engine entity rows must include both entityId and entityName");
	}

	const properties = isQueryEngineEntity(entity) ? {} : entity.properties;
	const externalId = isQueryEngineEntity(entity)
		? getOptionalQueryEngineStringField(entity, queryEngineEntityFieldKeys.externalId)
		: entity.externalId;
	const sandboxScriptId = isQueryEngineEntity(entity)
		? getOptionalQueryEngineStringField(entity, queryEngineEntityFieldKeys.sandboxScriptId)
		: entity.sandboxScriptId;
	const fields = isQueryEngineEntity(entity) ? entity : undefined;
	const entitySchemaId = isQueryEngineEntity(entity) ? undefined : entity.entitySchemaId;
	const id = isQueryEngineEntity(entity)
		? getRequiredQueryEngineStringField(entity, queryEngineEntityFieldKeys.id)
		: entity.id;
	const name = isQueryEngineEntity(entity)
		? getRequiredQueryEngineStringField(entity, queryEngineEntityFieldKeys.name)
		: entity.name;
	const createdAt = isQueryEngineEntity(entity)
		? getRequiredQueryEngineDateLikeField(entity, queryEngineEntityFieldKeys.createdAt)
		: entity.createdAt;
	const updatedAt = isQueryEngineEntity(entity)
		? getRequiredQueryEngineDateLikeField(entity, queryEngineEntityFieldKeys.updatedAt)
		: entity.updatedAt;
	const entityImage = isQueryEngineEntity(entity)
		? getQueryEngineField(entity, queryEngineEntityFieldKeys.image)?.value
		: entity.image;
	const populatedAt = isQueryEngineEntity(entity) ? undefined : dayjs(entity.populatedAt).toDate();

	return {
		id,
		name,
		fields,
		properties,
		externalId,
		entitySchemaId,
		sandboxScriptId,
		createdAt: dayjs(createdAt).toDate(),
		updatedAt: dayjs(updatedAt).toDate(),
		populatedAt,
		image: toAppEntityImage(entityImage),
	};
}

export function sortEntities(entities: AppEntity[]) {
	return [...entities].toSorted((a, b) => {
		if (a.name !== b.name) {
			return a.name.localeCompare(b.name);
		}
		return dayjs(a.createdAt).valueOf() - dayjs(b.createdAt).valueOf();
	});
}

type EntityListViewState = { type: "empty" } | { type: "list"; entities: AppEntity[] };

export function getEntityListViewState(entities: AppEntity[]): EntityListViewState {
	if (entities.length === 0) {
		return { type: "empty" };
	}

	return { type: "list", entities: sortEntities(entities) };
}
