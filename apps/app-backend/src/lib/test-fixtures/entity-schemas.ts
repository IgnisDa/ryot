import { withOverrides } from "~/lib/test-fixtures/fixture-helpers";
import { createOptionalTitlePropertiesSchema } from "~/lib/test-fixtures/property-schemas";
import type { ListedEntity } from "~/modules/entities";
import type {
	CreateEntitySchemaBody,
	EntityImportDeps,
	EntitySchemaServiceDeps,
	EntitySearchDeps,
	ListedEntitySchema,
} from "~/modules/entity-schemas";
import type {
	PollSandboxResult,
	SandboxEnqueueResult,
} from "~/modules/sandbox";

const listedEntitySchemaDefaults: ListedEntitySchema = {
	slug: "books",
	name: "Books",
	providers: [],
	id: "schema_1",
	isBuiltin: false,
	icon: "book-open",
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

const entitySearchEnqueueResult: SandboxEnqueueResult = { jobId: "job_1" };

const entitySearchPendingResult: PollSandboxResult = { status: "pending" };

export const createEntitySearchDeps = (
	overrides: Partial<EntitySearchDeps> = {},
): EntitySearchDeps => ({
	enqueueSandboxJob: async () => ({ data: entitySearchEnqueueResult }),
	getSandboxJobResult: async () => ({ data: entitySearchPendingResult }),
	...overrides,
});

const entityImportPendingJob = {
	failedReason: undefined,
	returnvalue: {} as ListedEntity,
	getState: async () => "waiting" as const,
	data: {
		userId: "user_1",
		scriptId: "script_1",
		externalId: "id_1",
		entitySchemaId: "schema_1",
	},
};

export const createEntityImportDeps = (
	overrides: Partial<EntityImportDeps> = {},
): EntityImportDeps => ({
	addJobToQueue: async () => {},
	getJobFromQueue: async () => entityImportPendingJob,
	...overrides,
});
