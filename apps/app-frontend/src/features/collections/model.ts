import { type AppSchema, getQueryEngineField } from "@ryot/ts-utils";
import { type AppEntityImage, toAppEntity } from "~/features/entities/model";
import {
	type AppEntitySavedView,
	type AppSavedView,
	isEntitySavedView,
} from "~/features/saved-views/model";
import type { ApiPostResponseData } from "~/lib/api/types";

type ApiQueryEngineCollection = Extract<
	ApiPostResponseData<"/query-engine/execute">,
	{ mode: "entities" }
>["data"]["items"][number];

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
	fields: ApiQueryEngineCollection,
): CollectionMembershipPropertiesSchema | null {
	const schemaField = getQueryEngineField(fields, "membershipPropertiesSchema");
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
	const appEntity = toAppEntity(entity);
	const entitySchemaSlugField = getQueryEngineField(entity, "entitySchemaSlug");
	return {
		id: appEntity.id,
		name: appEntity.name,
		image: appEntity.image,
		createdAt: appEntity.createdAt,
		updatedAt: appEntity.updatedAt,
		membershipPropertiesSchema: extractMembershipPropertiesSchema(entity),
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
): AppEntitySavedView | undefined {
	for (const view of savedViews) {
		if (
			isEntitySavedView(view) &&
			view.isBuiltin &&
			view.trackerId === null &&
			view.queryDefinition.scope.includes("collection")
		) {
			return view;
		}
	}

	return undefined;
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
