import { withOverrides } from "~/lib/test-fixtures/fixture-helpers";
import { createOptionalTitlePropertiesSchema } from "~/lib/test-fixtures/property-schemas";
import type { ListedEntity } from "~/modules/entities";
import type { EntityImportDeps } from "~/modules/entities/service";
import type { CreateEntitySchemaBody, ListedEntitySchema } from "~/modules/entity-schemas";
import type { EntitySchemaServiceDeps, EntitySearchDeps } from "~/modules/entity-schemas/service";
import type { PollSandboxResult, SandboxEnqueueResult } from "~/modules/sandbox";

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
	getEntitySchemaByIdForUser: () => Promise.resolve(undefined),
	getEntitySchemaBySlugForUser: () => Promise.resolve(undefined),
	listEntitySchemasForUser: () => Promise.resolve([createListedEntitySchema()]),
	getTrackerScopeForUser: (input) =>
		Promise.resolve({
			isBuiltin: false,
			id: input.trackerId,
			userId: input.userId,
		}),
	createEntitySchemaForUser: (input) =>
		Promise.resolve(
			createListedEntitySchema({
				name: input.name,
				slug: input.slug,
				icon: input.icon,
				trackerId: input.trackerId,
				accentColor: input.accentColor,
				propertiesSchema: input.propertiesSchema,
			}),
		),
	...overrides,
});

const entitySearchEnqueueResult: SandboxEnqueueResult = { jobId: "job_1" };

const entitySearchPendingResult: PollSandboxResult = { status: "pending" };

export const createEntitySearchDeps = (
	overrides: Partial<EntitySearchDeps> = {},
): EntitySearchDeps => ({
	enqueueSandboxJob: () => Promise.resolve({ data: entitySearchEnqueueResult }),
	getSandboxJobResult: () => Promise.resolve({ data: entitySearchPendingResult }),
	...overrides,
});

const entityImportPendingJob = {
	failedReason: undefined,
	// oxlint-disable-next-line no-unsafe-type-assertion
	returnvalue: {} as ListedEntity,
	getState: () => Promise.resolve("waiting" as const),
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
	addJobToQueue: () => Promise.resolve(),
	getJobFromQueue: () => Promise.resolve(entityImportPendingJob),
	...overrides,
});
