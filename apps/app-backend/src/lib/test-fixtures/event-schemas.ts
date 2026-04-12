import { withOverrides } from "~/lib/test-fixtures/fixture-helpers";
import { createOptionalRatingPropertiesSchema } from "~/lib/test-fixtures/property-schemas";
import type {
	CreateEventSchemaBody,
	EventSchemaServiceDeps,
	ListedEventSchema,
} from "~/modules/event-schemas";

const listedEventSchemaDefaults: ListedEventSchema = {
	name: "Finished",
	slug: "finished",
	id: "event_schema_1",
	entitySchemaId: "schema_1",
	propertiesSchema: createOptionalRatingPropertiesSchema(),
};

const eventSchemaBodyDefaults: CreateEventSchemaBody = {
	name: "Finished",
	entitySchemaId: "schema_1",
	propertiesSchema: createOptionalRatingPropertiesSchema(),
};

export const createEventSchemaBody = (
	overrides: Partial<CreateEventSchemaBody> = {},
): CreateEventSchemaBody => withOverrides(eventSchemaBodyDefaults, overrides);

export const createListedEventSchema = (
	overrides: Partial<ListedEventSchema> = {},
): ListedEventSchema => withOverrides(listedEventSchemaDefaults, overrides);

export const createEventSchemaDeps = (
	overrides: Partial<EventSchemaServiceDeps> = {},
): EventSchemaServiceDeps => ({
	getEventSchemaBySlugForUser: async () => undefined,
	listEventSchemasByEntitySchemaForUser: async () => [
		createListedEventSchema(),
	],
	getEntitySchemaScopeForUser: async (input) => ({
		isBuiltin: false,
		userId: input.userId,
		id: input.entitySchemaId,
	}),
	createEventSchemaForUser: async (input) =>
		createListedEventSchema({
			name: input.name,
			slug: input.slug,
			entitySchemaId: input.entitySchemaId,
			propertiesSchema: input.propertiesSchema,
		}),
	...overrides,
});
