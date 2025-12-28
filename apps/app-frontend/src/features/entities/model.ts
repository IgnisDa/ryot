import type {
	ApiGetResponseData,
	ApiPostRequestBody,
	ApiPostResponseData,
} from "#/lib/api/types";

type ViewRuntimeRequest = ApiPostRequestBody<"/view-runtime/execute">;
type ApiEntity = ApiGetResponseData<"/entities/{entityId}">;
type ApiViewRuntimeEntity =
	ApiPostResponseData<"/view-runtime/execute">["items"][number];
type ApiEntityInput = ApiEntity | ApiViewRuntimeEntity;

const entityField = (schemaSlug: string, field: string) => {
	return `entity.${schemaSlug}.${field}`;
};

export type AppEntityImage =
	| null
	| { kind: "s3"; key: string }
	| { kind: "remote"; url: string };

export type AppEntity = Omit<ApiEntity, "createdAt" | "updatedAt" | "image"> & {
	createdAt: Date;
	updatedAt: Date;
	image: AppEntityImage;
	fields?: ApiViewRuntimeEntity["fields"];
	entitySchemaSlug?: ApiViewRuntimeEntity["entitySchemaSlug"];
};

export function createEntityRuntimeRequest(
	entitySchemaSlug: string,
): ViewRuntimeRequest {
	return {
		fields: [],
		filters: [],
		eventJoins: [],
		pagination: { page: 1, limit: 1000 },
		entitySchemaSlugs: [entitySchemaSlug],
		sort: {
			direction: "asc",
			fields: [entityField(entitySchemaSlug, "@name")],
		},
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
	const fields = isViewRuntimeEntity(entity) ? entity.fields : undefined;

	return {
		...entity,
		fields,
		properties,
		externalId,
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
