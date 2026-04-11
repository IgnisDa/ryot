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

const entityColumnExpression = (
	schemaSlug: string,
	column: string,
): NonNullable<ViewRuntimeRequest["fields"]>[number]["expression"] => ({
	type: "reference",
	reference: { type: "entity-column", slug: schemaSlug, column },
});

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
		eventJoins: [],
		computedFields: [],
		pagination: { page: 1, limit: 1000 },
		entitySchemaSlugs: [entitySchemaSlug],
		sort: {
			direction: "asc",
			expression: entityColumnExpression(entitySchemaSlug, "name"),
		},
	};
}

export function toAppEntityImage(image: unknown): AppEntityImage {
	if (!image || typeof image !== "object") {
		return null;
	}

	if (
		"kind" in image &&
		image.kind === "remote" &&
		"url" in image &&
		typeof image.url === "string"
	) {
		return { kind: "remote", url: image.url };
	}

	if (
		"kind" in image &&
		image.kind === "s3" &&
		"key" in image &&
		typeof image.key === "string"
	) {
		return { kind: "s3", key: image.key };
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
