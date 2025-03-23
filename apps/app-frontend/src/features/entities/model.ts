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
type ApiEntityInput = ApiEntity | ApiViewRuntimeEntity;

export type AppEntityImage =
	| { kind: "remote"; url: string }
	| { kind: "s3"; key: string }
	| null;

export type AppEntity = Omit<ApiEntity, "createdAt" | "updatedAt" | "image"> & {
	image: AppEntityImage;
	createdAt: Date;
	updatedAt: Date;
	entitySchemaSlug?: ApiViewRuntimeEntity["entitySchemaSlug"];
	resolvedProperties?: ApiViewRuntimeEntity["resolvedProperties"];
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
		layout: "grid",
		filters: [],
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
	return "resolvedProperties" in entity;
}

export function toAppEntity(entity: ApiEntityInput): AppEntity {
	const properties = isViewRuntimeEntity(entity) ? {} : entity.properties;
	const externalId = isViewRuntimeEntity(entity) ? null : entity.externalId;
	const detailsSandboxScriptId = isViewRuntimeEntity(entity)
		? null
		: entity.detailsSandboxScriptId;
	const resolvedProperties = isViewRuntimeEntity(entity)
		? entity.resolvedProperties
		: properties;

	return {
		...entity,
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
