import {
	createCreatedAt,
	createUpdatedAt,
	withOverrides,
} from "~/lib/test-fixtures/fixture-helpers";
import { createRequiredTitlePropertiesSchema } from "~/lib/test-fixtures/property-schemas";
import type {
	CreateEntityBody,
	ListedEntity,
} from "~/modules/entities/schemas";
import type { EntityServiceDeps } from "~/modules/entities/service";

const listedEntityDefaults: ListedEntity = {
	image: null,
	id: "entity_1",
	name: "My Book",
	externalId: null,
	entitySchemaId: "schema_1",
	detailsSandboxScriptId: null,
	createdAt: createCreatedAt(),
	updatedAt: createUpdatedAt(),
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
	createEntityForUser: async (input) =>
		createListedEntity({
			name: input.name,
			image: input.image,
			properties: input.properties,
			entitySchemaId: input.entitySchemaId,
		}),
	getEntityByIdForUser: async (input) =>
		createListedEntity({ id: input.entityId }),
	getEntitySchemaScopeForUser: async (input) => ({
		isBuiltin: false,
		userId: input.userId,
		id: input.entitySchemaId,
		propertiesSchema: createRequiredTitlePropertiesSchema(),
	}),
	getEntityScopeForUser: async (input) => ({
		isBuiltin: false,
		entityId: input.entityId,
		entitySchemaId: "schema_1",
	}),
	...overrides,
});
