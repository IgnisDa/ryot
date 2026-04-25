import {
	createCreatedAt,
	createUpdatedAt,
	withOverrides,
} from "~/lib/test-fixtures/fixture-helpers";
import { createRequiredTitlePropertiesSchema } from "~/lib/test-fixtures/property-schemas";
import type {
	CreateEntityBody,
	EntityServiceDeps,
	ListedEntity,
} from "~/modules/entities";

const listedEntityDefaults: ListedEntity = {
	image: null,
	id: "entity_1",
	name: "My Book",
	externalId: null,
	sandboxScriptId: null,
	entitySchemaId: "schema_1",
	createdAt: createCreatedAt(),
	updatedAt: createUpdatedAt(),
	populatedAt: createCreatedAt(),
	properties: { title: "My Book" },
};

const entityBodyDefaults: CreateEntityBody = {
	image: null,
	name: "My Book",
	entitySchemaId: "schema_1",
	properties: { title: "My Book" },
};

export const createEntityBody = (
	overrides: Partial<CreateEntityBody> = {},
): CreateEntityBody => withOverrides(entityBodyDefaults, overrides);

export const createListedEntity = (
	overrides: Partial<ListedEntity> = {},
): ListedEntity => withOverrides(listedEntityDefaults, overrides);

export const createEntityDeps = (
	overrides: Partial<EntityServiceDeps> = {},
): EntityServiceDeps => ({
	findEntityByExternalIdForUser: async () => undefined,
	getEntityByIdForUser: async (input) =>
		createListedEntity({ id: input.entityId }),
	getEntityScopeForUser: async (input) => ({
		isBuiltin: false,
		entityId: input.entityId,
		entityUserId: input.userId,
		entitySchemaId: "schema_1",
		entitySchemaSlug: "custom",
	}),
	getEntitySchemaScopeForUser: async (input) => ({
		isBuiltin: false,
		userId: input.userId,
		id: input.entitySchemaId,
		propertiesSchema: createRequiredTitlePropertiesSchema(),
	}),
	createEntityForUser: async (input) =>
		createListedEntity({
			name: input.name,
			image: input.image,
			properties: input.properties,
			entitySchemaId: input.entitySchemaId,
			externalId: input.externalId ?? null,
			sandboxScriptId: input.sandboxScriptId ?? null,
		}),
	...overrides,
});
