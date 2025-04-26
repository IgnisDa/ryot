import type {
	ApiGetResponseData,
	ApiPostRequestBody,
	ApiPostResponseData,
} from "#/lib/api/types";

type ViewRuntimeRequest = ApiPostRequestBody<"/view-runtime/execute">;
type GridViewRuntimeRequest = Extract<ViewRuntimeRequest, { layout: "grid" }>;
type ApiEntity = ApiGetResponseData<"/entities/{entityId}">;
type ApiViewRuntimeEntity =
	ApiPostResponseData<"/view-runtime/execute">["items"][number];
type ApiResolvedRuntimeEntity = Extract<
	ApiViewRuntimeEntity,
	{ resolvedProperties: unknown }
>;
type ApiTableRuntimeEntity = Extract<ApiViewRuntimeEntity, { cells: unknown }>;
type ApiEntityInput = ApiEntity | ApiViewRuntimeEntity;

export type AppEntityImage =
	| { kind: "remote"; url: string }
	| { kind: "s3"; key: string }
	| null;

export type AppEntity = Omit<ApiEntity, "createdAt" | "updatedAt" | "image"> & {
	createdAt: Date;
	updatedAt: Date;
	image: AppEntityImage;
	cells?: ApiTableRuntimeEntity["cells"];
	entitySchemaSlug?: ApiViewRuntimeEntity["entitySchemaSlug"];
	resolvedProperties?:
		| ApiResolvedRuntimeEntity["resolvedProperties"]
		| ApiEntity["properties"];
};

const defaultDisplayConfiguration: GridViewRuntimeRequest["displayConfiguration"] =
	{
		badgeProperty: null,
		subtitleProperty: null,
		titleProperty: ["@name"],
		imageProperty: ["@image"],
	};

export function createEntityRuntimeRequest(
	entitySchemaSlug: string,
): GridViewRuntimeRequest {
	return {
		filters: [],
		layout: "grid",
		entitySchemaSlugs: [entitySchemaSlug],
		pagination: { page: 1, limit: 1000 },
		sort: { field: ["@name"], direction: "asc" },
		displayConfiguration: defaultDisplayConfiguration,
	};
}

function toAppEntityImage(image: unknown): AppEntityImage {
	if (!image || typeof image !== "object") {
		return null;
	}

	const parsed = image as { kind?: string; key?: string; url?: string };

	if (parsed.kind === "remote" && parsed.url) {
		return { kind: "remote", url: parsed.url };
	}

	if (parsed.kind === "s3" && parsed.key) {
		return { kind: "s3", key: parsed.key };
	}

	return null;
}

function isViewRuntimeEntity(
	entity: ApiEntityInput,
): entity is ApiViewRuntimeEntity {
	return "entitySchemaSlug" in entity;
}

export function toAppEntity(entity: ApiEntityInput): AppEntity {
	const properties = isViewRuntimeEntity(entity) ? {} : entity.properties;
	const externalId = isViewRuntimeEntity(entity) ? null : entity.externalId;
	const detailsSandboxScriptId = isViewRuntimeEntity(entity)
		? null
		: entity.detailsSandboxScriptId;
	const resolvedProperties = isViewRuntimeEntity(entity)
		? "resolvedProperties" in entity
			? (entity.resolvedProperties as AppEntity["resolvedProperties"])
			: undefined
		: properties;
	const cells =
		isViewRuntimeEntity(entity) && "cells" in entity
			? (entity.cells as AppEntity["cells"])
			: undefined;

	return {
		...entity,
		cells,
		properties,
		externalId,
		resolvedProperties,
		detailsSandboxScriptId,
		image: toAppEntityImage(entity.image),
		createdAt: new Date(entity.createdAt),
		updatedAt: new Date(entity.updatedAt),
		entitySchemaSlug: isViewRuntimeEntity(entity)
			? entity.entitySchemaSlug
			: undefined,
	};
}

export function sortEntities(entities: AppEntity[]) {
	return [...entities].sort((a, b) => {
		if (a.name !== b.name) {
			return a.name.localeCompare(b.name);
		}
		return a.createdAt.getTime() - b.createdAt.getTime();
	});
}

type EntityListViewState =
	| { type: "empty" }
	| { type: "list"; entities: AppEntity[] };

export function getEntityListViewState(
	entities: AppEntity[],
): EntityListViewState {
	if (entities.length === 0) {
		return { type: "empty" };
	}

	return { type: "list", entities: sortEntities(entities) };
}
