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
	GetOrCreateCollectionServiceDeps,
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

export const createWriteCollectionMembershipResult = (
	overrides: Partial<AddToCollectionData> = {},
	wasInserted = true,
): { data: { wasInserted: boolean; memberOf: AddToCollectionData["memberOf"] } } => ({
	data: { wasInserted, memberOf: createAddToCollectionData(overrides).memberOf },
});

const collectionEntityPropertiesSchema = {
	fields: {
		description: {
			label: "Description",
			type: "string" as const,
			description: "A short summary or description of this collection",
		},
		membershipPropertiesSchema: {
			properties: {},
			type: "object" as const,
			unknownKeys: "passthrough" as const,
			label: "Membership Properties Schema",
			description:
				"JSON object schema defining extra properties attached to each collection member",
		},
	},
};

export const createCollectionDeps = (
	overrides: Partial<CollectionServiceDeps> = {},
): CollectionServiceDeps => ({
	getBuiltinCollectionSchema: () =>
		Promise.resolve({
			id: "schema_collection",
			propertiesSchema: collectionEntityPropertiesSchema,
		}),
	createCollectionForUser: (input) =>
		Promise.resolve(
			createCollectionResponse({
				name: input.name,
				properties: input.properties,
				entitySchemaId: input.entitySchemaId,
			}),
		),
	...overrides,
});

export const createGetOrCreateCollectionDeps = (
	overrides: Partial<GetOrCreateCollectionServiceDeps> = {},
): GetOrCreateCollectionServiceDeps => ({
	...createCollectionDeps(),
	findCollectionByNameForUser: () => Promise.resolve(undefined),
	...overrides,
});

export const createAddToCollectionDeps = (
	overrides: Partial<AddToCollectionServiceDeps> = {},
): AddToCollectionServiceDeps => ({
	// oxlint-disable-next-line no-unsafe-type-assertion
	executeTransaction: (fn) => fn(null as never),
	ensureEntityInLibrary: () => Promise.resolve({ data: undefined }),
	getCollectionById: () => Promise.resolve(createCollectionResponse()),
	getEntityById: (entityId) =>
		Promise.resolve({ id: entityId, userId: "user_1", entitySchemaSlug: "movie" }),
	writeCollectionMembership: (input) =>
		Promise.resolve({
			data: {
				wasInserted: true,
				memberOf: {
					id: "rel_1",
					properties: {},
					sourceEntityId: input.entityId,
					targetEntityId: input.collectionId,
					createdAt: "2024-01-01T00:00:00.000Z",
					relationshipSchemaId: "rel_schema_member_of",
				},
			},
		}),
	createEventBySchemaSlugWithTriggers: () =>
		Promise.resolve({
			data: {
				id: "event_1",
				properties: {},
				sessionEntityId: null,
				entityId: "collection_1",
				entitySchemaSlug: "collection",
				eventSchemaId: "schema_add_event",
				entitySchemaId: "schema_collection",
				createdAt: new Date("2024-01-01"),
				updatedAt: new Date("2024-01-01"),
				occurredAt: new Date("2024-01-01"),
				eventSchemaName: "Add Entity to Collection",
				eventSchemaSlug: "add-entity-to-collection",
			},
		}),
	...overrides,
});

export const createRemoveFromCollectionDeps = (
	overrides: Partial<RemoveFromCollectionServiceDeps> = {},
): RemoveFromCollectionServiceDeps => ({
	getCollectionById: () => Promise.resolve(createCollectionResponse()),
	getEntityById: (entityId) =>
		Promise.resolve({ id: entityId, userId: "user_1", entitySchemaSlug: "movie" }),
	deleteCollectionMembership: () =>
		Promise.resolve({
			data: {
				wasInserted: false,
				memberOf: {
					id: "rel_1",
					properties: {},
					sourceEntityId: "entity_1",
					targetEntityId: "collection_1",
					createdAt: "2024-01-01T00:00:00.000Z",
					relationshipSchemaId: "rel_schema_member_of",
				},
			},
		}),
	createEventBySchemaSlugWithTriggers: () =>
		Promise.resolve({
			data: {
				id: "event_1",
				properties: {},
				sessionEntityId: null,
				entityId: "collection_1",
				entitySchemaSlug: "collection",
				entitySchemaId: "schema_collection",
				eventSchemaId: "schema_remove_event",
				createdAt: new Date("2024-01-01"),
				updatedAt: new Date("2024-01-01"),
				occurredAt: new Date("2024-01-01"),
				eventSchemaName: "Remove Entity from Collection",
				eventSchemaSlug: "remove-entity-from-collection",
			},
		}),
	...overrides,
});
