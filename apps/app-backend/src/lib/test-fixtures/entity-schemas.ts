import { withOverrides } from "~/lib/test-fixtures/fixture-helpers";
import { createOptionalTitlePropertiesSchema } from "~/lib/test-fixtures/property-schemas";
import type {
	CreateEntitySchemaBody,
	EntitySchemaServiceDeps,
	ListedEntitySchema,
} from "~/modules/entity-schemas";

const listedEntitySchemaDefaults: ListedEntitySchema = {
	slug: "books",
	name: "Books",
	id: "schema_1",
	icon: "book-open",
	isBuiltin: false,
	providers: [],
	trackerId: "tracker_1",
	accentColor: "#5B7FFF",
	propertiesSchema: createOptionalTitlePropertiesSchema(),
};

const entitySchemaBodyDefaults: CreateEntitySchemaBody = {
	name: "Books",
	icon: "book-open",
	trackerId: "tracker_1",
	accentColor: "#5B7FFF",
	propertiesSchema: createOptionalTitlePropertiesSchema(),
};

export const createEntitySchemaBody = (
	overrides: Partial<CreateEntitySchemaBody> = {},
): CreateEntitySchemaBody => withOverrides(entitySchemaBodyDefaults, overrides);

export const createListedEntitySchema = (
	overrides: Partial<ListedEntitySchema> = {},
): ListedEntitySchema => withOverrides(listedEntitySchemaDefaults, overrides);

export const createEntitySchemaDeps = (
	overrides: Partial<EntitySchemaServiceDeps> = {},
): EntitySchemaServiceDeps => ({
	getEntitySchemaByIdForUser: async () => undefined,
	getEntitySchemaBySlugForUser: async () => undefined,
	listEntitySchemasForUser: async () => [createListedEntitySchema()],
	getTrackerScopeForUser: async (input) => ({
		isBuiltin: false,
		id: input.trackerId,
		userId: input.userId,
	}),
	createEntitySchemaForUser: async (input) =>
		createListedEntitySchema({
			name: input.name,
			slug: input.slug,
			icon: input.icon,
			trackerId: input.trackerId,
			accentColor: input.accentColor,
			propertiesSchema: input.propertiesSchema,
		}),
	...overrides,
});
