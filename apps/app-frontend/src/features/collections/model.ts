import type { AppSchema } from "@ryot/ts-utils/app-schema";
import { getQueryEngineField } from "@ryot/ts-utils/query-engine";

import {
	type AppEntityImage,
	type QueryEngineEntitiesItem,
	toAppEntity,
} from "~/features/entities/model";
import {
	type AppEntitySavedView,
	type AppSavedView,
	isEntitySavedView,
} from "~/features/saved-views/model";

type ApiQueryEngineCollection = QueryEngineEntitiesItem;

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

function isCollectionMembershipPropertiesSchema(
	value: unknown,
): value is CollectionMembershipPropertiesSchema {
	return !!value && typeof value === "object" && "fields" in value;
}

export function extractMembershipPropertiesSchema(
	fields: ApiQueryEngineCollection,
): CollectionMembershipPropertiesSchema | null {
	const schemaField = getQueryEngineField(fields, "membershipPropertiesSchema");
	if (schemaField?.kind !== "json") {
		return null;
	}
	if (!isCollectionMembershipPropertiesSchema(schemaField.value)) {
		return null;
	}
	return schemaField.value;
}

export function toAppCollection(entity: ApiQueryEngineCollection): AppCollection {
	const appEntity = toAppEntity(entity);
	const entitySchemaSlugField = getQueryEngineField(entity, "entitySchemaSlug");
	const entitySchemaSlug =
		typeof entitySchemaSlugField?.value === "string" ? entitySchemaSlugField.value : "collection";
	return {
		id: appEntity.id,
		name: appEntity.name,
		image: appEntity.image,
		createdAt: appEntity.createdAt,
		updatedAt: appEntity.updatedAt,
		membershipPropertiesSchema: extractMembershipPropertiesSchema(entity),
		entitySchemaSlug,
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

export type CollectionsDestination = { type: "none" } | { type: "view"; viewSlug: string };

export function resolveCollectionsDestination(savedViews: AppSavedView[]): CollectionsDestination {
	const view = findBuiltinCollectionsView(savedViews);
	if (!view) {
		return { type: "none" };
	}
	return { type: "view", viewSlug: view.slug };
}
