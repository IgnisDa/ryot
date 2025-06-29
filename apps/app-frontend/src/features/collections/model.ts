import type { AppSchema } from "@ryot/ts-utils";
import type { AppEntityImage } from "~/features/entities/model";
import { toAppEntityImage } from "~/features/entities/model";
import type { AppSavedView } from "~/features/saved-views/model";
import type { ApiPostResponseData } from "~/lib/api/types";

type ApiQueryEngineCollection =
	ApiPostResponseData<"/query-engine/execute">["items"][number];

export type CollectionMembershipPropertiesSchema = AppSchema;

export type AppCollection = {
	id: string;
	name: string;
	image: AppEntityImage;
	createdAt: Date;
	updatedAt: Date;
	membershipPropertiesSchema: CollectionMembershipPropertiesSchema | null;
	entitySchemaSlug: string;
};

export type CollectionDiscoveryState =
	| { type: "error" }
	| { type: "empty" }
	| { type: "loading" }
	| { type: "collections"; collections: AppCollection[] };

export function extractMembershipPropertiesSchema(
	fields: ApiQueryEngineCollection["fields"],
): CollectionMembershipPropertiesSchema | null {
	const schemaField = fields.find(
		(field) => field.key === "membershipPropertiesSchema",
	);
	if (!schemaField || schemaField.kind !== "json" || !schemaField.value) {
		return null;
	}
	const schema = schemaField.value;
	if (!schema || typeof schema !== "object" || !("fields" in schema)) {
		return null;
	}
	return schema as CollectionMembershipPropertiesSchema;
}

export function toAppCollection(
	entity: ApiQueryEngineCollection,
): AppCollection {
	const entitySchemaSlugField = entity.fields.find(
		(field) => field.key === "entitySchemaSlug",
	);
	return {
		id: entity.id,
		name: entity.name,
		image: toAppEntityImage(entity.image),
		createdAt: new Date(entity.createdAt),
		updatedAt: new Date(entity.updatedAt),
		membershipPropertiesSchema: extractMembershipPropertiesSchema(
			entity.fields,
		),
		entitySchemaSlug:
			entitySchemaSlugField?.value != null
				? String(entitySchemaSlugField.value)
				: "collection",
	};
}

export function getCollectionDiscoveryState(
	isLoading: boolean,
	isError: boolean,
	collections: AppCollection[],
): CollectionDiscoveryState {
	if (isLoading) {
		return { type: "loading" };
	}
	if (isError) {
		return { type: "error" };
	}
	if (collections.length === 0) {
		return { type: "empty" };
	}
	return { type: "collections", collections };
}

export function findBuiltinCollectionsView(
	savedViews: AppSavedView[],
): AppSavedView | undefined {
	return savedViews.find(
		(view) =>
			view.isBuiltin &&
			view.trackerId === null &&
			view.queryDefinition.entitySchemaSlugs.includes("collection"),
	);
}

export type CollectionsDestination =
	| { type: "none" }
	| { type: "view"; viewSlug: string };

export function resolveCollectionsDestination(
	savedViews: AppSavedView[],
): CollectionsDestination {
	const view = findBuiltinCollectionsView(savedViews);
	if (!view) {
		return { type: "none" };
	}
	return { type: "view", viewSlug: view.slug };
}
