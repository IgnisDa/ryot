import { createEntityColumnExpression, dayjs } from "@ryot/ts-utils";
import type {
	ApiGetResponseData,
	ApiPostRequestBody,
	ApiPostResponseData,
} from "~/lib/api/types";

type QueryEngineRequest = ApiPostRequestBody<"/query-engine/execute">;
type ApiEntity = ApiGetResponseData<"/entities/{entityId}">;
type QueryEngineResponse = ApiPostResponseData<"/query-engine/execute">;
type QueryEngineItem = QueryEngineResponse["items"][number];
type ApiEntityInput = ApiEntity | QueryEngineItem;

export type SearchResultItem = {
	externalId: string;
	calloutProperty: { kind: "null"; value: null };
	titleProperty: { kind: "text"; value: string };
	primarySubtitleProperty: { kind: "number" | "null"; value: number | null };
	secondarySubtitleProperty: { kind: "null"; value: null };
	imageProperty: {
		kind: "image" | "null";
		value: { kind: "remote"; url: string } | null;
	};
};

export type AppEntityImage =
	| null
	| { kind: "s3"; key: string }
	| { kind: "remote"; url: string };

export type AppEntity = Omit<
	ApiEntity,
	"createdAt" | "updatedAt" | "populatedAt" | "image" | "detailsSandboxScriptId"
> & {
	createdAt: Date;
	updatedAt: Date;
	populatedAt?: Date;
	image: AppEntityImage;
	sandboxScriptId: string | null;
	fields?: QueryEngineItem["fields"];
	entitySchemaSlug?: QueryEngineItem["entitySchemaSlug"];
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
): entity is QueryEngineItem {
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
	const populatedAt = isQueryEngineEntity(entity)
		? undefined
		: dayjs(entity.populatedAt).toDate();

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
		populatedAt: dayjs(populatedAt).toDate(),
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
