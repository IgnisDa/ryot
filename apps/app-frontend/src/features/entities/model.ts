import { dayjs } from "@ryot/ts-utils";
import type {
	ApiGetResponseData,
	ApiPostRequestBody,
	ApiPostResponseData,
} from "~/lib/api/types";

type QueryEngineRequest = ApiPostRequestBody<"/query-engine/execute">;
type ApiEntity = ApiGetResponseData<"/entities/{entityId}">;
type ApiQueryEngineEntity =
	ApiPostResponseData<"/query-engine/execute">["items"][number];
type ApiEntityInput = ApiEntity | ApiQueryEngineEntity;
type ViewExpression = NonNullable<
	QueryEngineRequest["fields"]
>[number]["expression"];

export const createEntityColumnExpression = (
	schemaSlug: string,
	column: string,
): ViewExpression => ({
	type: "reference",
	reference: { type: "entity", slug: schemaSlug, path: [column] },
});

export const createEntityPropertyExpression = (
	schemaSlug: string,
	property: string,
): ViewExpression => ({
	type: "reference",
	reference: {
		type: "entity",
		slug: schemaSlug,
		path: ["properties", property],
	},
});

export type AppEntityImage =
	| null
	| { kind: "s3"; key: string }
	| { kind: "remote"; url: string };

export type AppEntity = Omit<
	ApiEntity,
	"createdAt" | "updatedAt" | "image" | "detailsSandboxScriptId"
> & {
	createdAt: Date;
	updatedAt: Date;
	image: AppEntityImage;
	sandboxScriptId: string | null;
	fields?: ApiQueryEngineEntity["fields"];
	entitySchemaSlug?: ApiQueryEngineEntity["entitySchemaSlug"];
};

export function createEntityRuntimeRequest(
	entitySchemaSlug: string,
): QueryEngineRequest {
	return {
		fields: [],
		eventJoins: [],
		computedFields: [],
		pagination: { page: 1, limit: 1000 },
		entitySchemaSlugs: [entitySchemaSlug],
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

function isQueryEngineEntity(
	entity: ApiEntityInput,
): entity is ApiQueryEngineEntity {
	return "entitySchemaSlug" in entity;
}

export function toAppEntity(entity: ApiEntityInput): AppEntity {
	const properties = isQueryEngineEntity(entity) ? {} : entity.properties;
	const externalId = isQueryEngineEntity(entity) ? null : entity.externalId;
	const sandboxScriptId = isQueryEngineEntity(entity)
		? null
		: entity.sandboxScriptId;
	const fields = isQueryEngineEntity(entity) ? entity.fields : undefined;
	const {
		id,
		name,
		createdAt,
		updatedAt,
		entitySchemaId,
		image: entityImage,
	} = entity;

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
		image: toAppEntityImage(entityImage),
		entitySchemaSlug: isQueryEngineEntity(entity)
			? entity.entitySchemaSlug
			: undefined,
	};
}

export function sortEntities(entities: AppEntity[]) {
	return [...entities].sort((a, b) => {
		if (a.name !== b.name) {
			return a.name.localeCompare(b.name);
		}
		return dayjs(a.createdAt).valueOf() - dayjs(b.createdAt).valueOf();
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
