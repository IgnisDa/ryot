import {
	createCreatedAt,
	createUpdatedAt,
	withOverrides,
} from "~/lib/test-fixtures/fixture-helpers";
import type {
	AddToCollectionData,
	AddToCollectionServiceDeps,
	CollectionResponse,
	CollectionServiceDeps,
	RemoveFromCollectionServiceDeps,
} from "~/modules/collections";

const collectionResponseDefaults: CollectionResponse = {
	image: null,
	properties: {},
	externalId: null,
	id: "collection_1",
	name: "My Collection",
	sandboxScriptId: null,
	createdAt: createCreatedAt(),
	updatedAt: createUpdatedAt(),
	entitySchemaId: "schema_collection",
};

const addToCollectionDataDefaults: AddToCollectionData = {
	memberOf: {
		id: "rel_1",
		properties: {},
		sourceEntityId: "entity_1",
		targetEntityId: "collection_1",
		createdAt: "2024-01-01T00:00:00.000Z",
		relationshipSchemaId: "rel_schema_member_of",
	},
};

export const createCollectionResponse = (
	overrides: Partial<CollectionResponse> = {},
): CollectionResponse => withOverrides(collectionResponseDefaults, overrides);

export const createAddToCollectionData = (
	overrides: Partial<AddToCollectionData> = {},
): AddToCollectionData => withOverrides(addToCollectionDataDefaults, overrides);

export const createCollectionDeps = (
	overrides: Partial<CollectionServiceDeps> = {},
): CollectionServiceDeps => ({
	getBuiltinCollectionSchema: async () => ({
		id: "schema_collection",
		propertiesSchema: { fields: {} },
	}),
	createCollectionForUser: async (input) =>
		createCollectionResponse({
			name: input.name,
			properties: input.properties,
			entitySchemaId: input.entitySchemaId,
		}),
	...overrides,
});

export const createAddToCollectionDeps = (
	overrides: Partial<AddToCollectionServiceDeps> = {},
): AddToCollectionServiceDeps => ({
	getCollectionById: async () => createCollectionResponse(),
	getEntityById: async (entityId) => ({ id: entityId, userId: "user_1" }),
	getUserLibraryEntityId: async () => "library_1",
	upsertInLibraryRelationship: async () => {},
	addEntityToCollection: async (input) =>
		createAddToCollectionData({
			memberOf: {
				id: "rel_1",
				properties: {},
				sourceEntityId: input.entityId,
				targetEntityId: input.collectionId,
				createdAt: "2024-01-01T00:00:00.000Z",
				relationshipSchemaId: "rel_schema_member_of",
			},
		}),
	...overrides,
});

export const createRemoveFromCollectionDeps = (
	overrides: Partial<RemoveFromCollectionServiceDeps> = {},
): RemoveFromCollectionServiceDeps => ({
	getCollectionById: async () => createCollectionResponse(),
	removeEntityFromCollection: async () => createAddToCollectionData(),
	getEntityById: async (entityId) => ({ id: entityId, userId: "user_1" }),
	...overrides,
});
