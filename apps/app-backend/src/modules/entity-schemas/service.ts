import { resolveRequiredSlug, resolveRequiredString } from "@ryot/ts-utils";
import { generateId } from "better-auth";
import { checkCustomAccess, checkReadAccess } from "~/lib/access";
import { isUniqueConstraintError } from "~/lib/app/postgres";
import type { AppConfigPath } from "~/lib/config";
import { appConfigEnvIndex, appConfigPathIndex } from "~/lib/config";
import { getQueues } from "~/lib/queue";
import { resolveJobPollState } from "~/lib/queue/utils";
import {
	type ServiceResult,
	serviceData,
	serviceError,
	wrapServiceValidator,
} from "~/lib/result";
import { sandboxScriptMetadataSchema } from "~/lib/sandbox/types";
import type { ListedEntity } from "~/modules/entities";
import {
	type MediaImportJobData,
	mediaImportJobData,
	mediaImportJobName,
} from "~/modules/media";
import {
	type EnqueueSandboxBody,
	enqueueSandbox,
	getSandboxResult,
	type PollSandboxResult,
	type SandboxEnqueueResult,
	type SandboxServiceResult,
} from "~/modules/sandbox";
import { authenticationBuiltinEntitySchemas } from "../authentication/bootstrap/manifests";
import { parseLabeledPropertySchemaInput } from "../property-schemas/service";
import { getTrackerScopeForUser } from "../trackers/repository";
import {
	createEntitySchemaForUser,
	getEntitySchemaByIdForUser,
	getEntitySchemaBySlugForUser,
	type ListedEntitySchemaWithMetadata,
	listEntitySchemasForUser,
} from "./repository";
import type {
	CreateEntitySchemaBody,
	EntitySearchBody,
	ImportEntityBody,
	ImportEntityResult,
	ListedEntitySchema,
} from "./schemas";

export type EntitySchemaPropertiesShape =
	CreateEntitySchemaBody["propertiesSchema"];

type EntitySchemaMutationError = "not_found" | "validation";

export type EntitySchemaServiceDeps = {
	getTrackerScopeForUser: typeof getTrackerScopeForUser;
	listEntitySchemasForUser: typeof listEntitySchemasForUser;
	createEntitySchemaForUser: typeof createEntitySchemaForUser;
	getEntitySchemaByIdForUser: typeof getEntitySchemaByIdForUser;
	getEntitySchemaBySlugForUser: typeof getEntitySchemaBySlugForUser;
};

const isProviderUsable = (provider: { scriptMetadata?: unknown }): boolean => {
	const parsed = sandboxScriptMetadataSchema.safeParse(provider.scriptMetadata);
	const requiredKeys = parsed.success
		? (parsed.data.requiredAppConfigKeys ?? [])
		: [];
	return requiredKeys.every((key) => {
		const envKey = appConfigPathIndex[key as AppConfigPath];
		return envKey && appConfigEnvIndex[envKey] != null;
	});
};

const stripProviderMetadata = (
	schema: ListedEntitySchemaWithMetadata,
): ListedEntitySchema => ({
	...schema,
	providers: schema.providers
		.filter(isProviderUsable)
		.map(({ scriptMetadata: _m, ...provider }) => provider),
});

export type EntitySchemaServiceResult<T> = ServiceResult<
	T,
	EntitySchemaMutationError
>;

const duplicateSlugError = "Entity schema slug already exists";
const entitySchemaNotFoundError = "Entity schema not found";
const entitySchemaUniqueConstraint = "entity_schema_user_slug_unique";
const trackerNotFoundError = "Tracker not found";
const customTrackerError =
	"Built-in trackers do not support entity schema creation";

const entitySchemaServiceDeps: EntitySchemaServiceDeps = {
	getTrackerScopeForUser,
	listEntitySchemasForUser,
	createEntitySchemaForUser,
	getEntitySchemaByIdForUser,
	getEntitySchemaBySlugForUser,
};

const resolveEntitySchemaTrackerIdResult = (trackerId: string) =>
	wrapServiceValidator(
		() => resolveEntitySchemaTrackerId(trackerId),
		"Tracker id is required",
	);

export const resolveEntitySchemaName = (name: string) =>
	resolveRequiredString(name, "Entity schema name");

export const resolveEntitySchemaTrackerId = (trackerId: string) =>
	resolveRequiredString(trackerId, "Tracker id");

export const resolveEntitySchemaIcon = (icon: string) =>
	resolveRequiredString(icon, "Entity schema icon");

export const resolveEntitySchemaAccentColor = (accentColor: string) =>
	resolveRequiredString(accentColor, "Entity schema accent color");

export const resolveEntitySchemaSlug = (
	input: Pick<CreateEntitySchemaBody, "name" | "slug">,
) => {
	return resolveRequiredSlug({
		name: input.name,
		slug: input.slug,
		label: "Entity schema",
	});
};

export const parseEntitySchemaPropertiesSchema = (
	input: unknown,
): EntitySchemaPropertiesShape => {
	return parseLabeledPropertySchemaInput(
		input,
		"Entity schema properties",
	) as EntitySchemaPropertiesShape;
};

export const validateSlugNotReserved = (slug: string): void => {
	const builtinEntitySchemas = authenticationBuiltinEntitySchemas();
	const reservedSlugs = builtinEntitySchemas.map((s) => s.slug);

	if (reservedSlugs.includes(slug)) {
		throw new Error(
			`Entity schema slug "${slug}" is reserved for built-in schemas`,
		);
	}
};

export const resolveEntitySchemaCreateInput = (
	input: Omit<CreateEntitySchemaBody, "trackerId">,
) => {
	const icon = resolveEntitySchemaIcon(input.icon);
	const name = resolveEntitySchemaName(input.name);
	const slug = resolveEntitySchemaSlug({ name, slug: input.slug });
	const accentColor = resolveEntitySchemaAccentColor(input.accentColor);
	const propertiesSchema = parseEntitySchemaPropertiesSchema(
		input.propertiesSchema,
	);

	validateSlugNotReserved(slug);

	return { icon, name, slug, accentColor, propertiesSchema };
};

const resolveEntitySchemaCreateInputResult = (
	input: Omit<CreateEntitySchemaBody, "trackerId">,
) =>
	wrapServiceValidator(
		() => resolveEntitySchemaCreateInput(input),
		"Entity schema payload is invalid",
	);

export const listEntitySchemas = async (
	input: { slugs?: string[]; trackerId?: string; userId: string },
	deps: EntitySchemaServiceDeps = entitySchemaServiceDeps,
): Promise<EntitySchemaServiceResult<ListedEntitySchema[]>> => {
	if (input.trackerId) {
		const trackerIdResult = resolveEntitySchemaTrackerIdResult(input.trackerId);
		if ("error" in trackerIdResult) {
			return trackerIdResult;
		}

		const trackerResult = checkReadAccess(
			await deps.getTrackerScopeForUser({
				userId: input.userId,
				trackerId: trackerIdResult.data,
			}),
			{ not_found: trackerNotFoundError },
		);
		if ("error" in trackerResult) {
			return serviceError("not_found", trackerResult.message);
		}

		const entitySchemas = await deps.listEntitySchemasForUser({
			slugs: input.slugs,
			userId: input.userId,
			trackerId: trackerIdResult.data,
		});
		return serviceData(entitySchemas.map(stripProviderMetadata));
	}

	const entitySchemas = await deps.listEntitySchemasForUser({
		slugs: input.slugs,
		userId: input.userId,
	});
	return serviceData(entitySchemas.map(stripProviderMetadata));
};

export const createEntitySchema = async (
	input: { body: CreateEntitySchemaBody; userId: string },
	deps: EntitySchemaServiceDeps = entitySchemaServiceDeps,
): Promise<EntitySchemaServiceResult<ListedEntitySchema>> => {
	const trackerIdResult = resolveEntitySchemaTrackerIdResult(
		input.body.trackerId,
	);
	if ("error" in trackerIdResult) {
		return trackerIdResult;
	}

	const trackerResult = checkCustomAccess(
		await deps.getTrackerScopeForUser({
			userId: input.userId,
			trackerId: trackerIdResult.data,
		}),
		{
			not_found: trackerNotFoundError,
			builtin_resource: customTrackerError,
		},
	);
	if ("error" in trackerResult) {
		return serviceError(
			trackerResult.error === "not_found" ? "not_found" : "validation",
			trackerResult.message,
		);
	}

	const entitySchemaInput = resolveEntitySchemaCreateInputResult({
		icon: input.body.icon,
		name: input.body.name,
		slug: input.body.slug,
		accentColor: input.body.accentColor,
		propertiesSchema: input.body.propertiesSchema,
	});
	if ("error" in entitySchemaInput) {
		return entitySchemaInput;
	}

	const existingEntitySchema = await deps.getEntitySchemaBySlugForUser({
		userId: input.userId,
		slug: entitySchemaInput.data.slug,
	});
	if (existingEntitySchema) {
		return serviceError("validation", duplicateSlugError);
	}

	try {
		const createdEntitySchema = await deps.createEntitySchemaForUser({
			userId: input.userId,
			trackerId: trackerIdResult.data,
			icon: entitySchemaInput.data.icon,
			name: entitySchemaInput.data.name,
			slug: entitySchemaInput.data.slug,
			accentColor: entitySchemaInput.data.accentColor,
			propertiesSchema: entitySchemaInput.data.propertiesSchema,
		});

		return serviceData(createdEntitySchema);
	} catch (error) {
		if (isUniqueConstraintError(error, entitySchemaUniqueConstraint)) {
			return serviceError("validation", duplicateSlugError);
		}

		throw error;
	}
};

export const getEntitySchemaById = async (
	input: { entitySchemaId: string; userId: string },
	deps: EntitySchemaServiceDeps = entitySchemaServiceDeps,
): Promise<EntitySchemaServiceResult<ListedEntitySchema>> => {
	const foundEntitySchema = await deps.getEntitySchemaByIdForUser({
		userId: input.userId,
		entitySchemaId: input.entitySchemaId,
	});
	if (!foundEntitySchema) {
		return serviceError("not_found", entitySchemaNotFoundError);
	}

	return serviceData(stripProviderMetadata(foundEntitySchema));
};

export type EntitySearchDeps = {
	enqueueSandboxJob: (input: {
		body: EnqueueSandboxBody;
		userId: string;
	}) => Promise<SandboxServiceResult<SandboxEnqueueResult>>;
	getSandboxJobResult: (input: {
		jobId: string;
		userId: string;
	}) => Promise<SandboxServiceResult<PollSandboxResult>>;
};

const defaultEntitySearchDeps: EntitySearchDeps = {
	enqueueSandboxJob: enqueueSandbox,
	getSandboxJobResult: getSandboxResult,
};

export const enqueueEntitySearch = async (
	input: { body: EntitySearchBody; userId: string },
	deps: EntitySearchDeps = defaultEntitySearchDeps,
): Promise<SandboxServiceResult<SandboxEnqueueResult>> => {
	return deps.enqueueSandboxJob({
		userId: input.userId,
		body: {
			driverName: "search",
			context: input.body.context,
			scriptId: input.body.scriptId,
		},
	});
};

export const getEntitySearchResult = async (
	input: { jobId: string; userId: string },
	deps: EntitySearchDeps = defaultEntitySearchDeps,
): Promise<SandboxServiceResult<PollSandboxResult>> => {
	return deps.getSandboxJobResult({ jobId: input.jobId, userId: input.userId });
};

type EntityImportMutationError = "not_found" | "validation";

const entityImportJobFailedMessage = "Entity import job failed";
const entityImportJobNotFoundError = "Entity import job not found";

type ImportQueueJob = {
	data: unknown;
	returnvalue: ListedEntity;
	getState: () => Promise<string>;
	failedReason: string | undefined;
};

export type EntityImportDeps = {
	getJobFromQueue: (
		jobId: string,
	) => Promise<ImportQueueJob | null | undefined>;
	addJobToQueue: (input: {
		jobId: string;
		payload: MediaImportJobData;
	}) => Promise<void>;
};

const defaultEntityImportDeps: EntityImportDeps = {
	getJobFromQueue: async (jobId) => {
		return getQueues().mediaQueue.getJob(jobId);
	},
	addJobToQueue: async ({ jobId, payload }) => {
		await getQueues().mediaQueue.add(mediaImportJobName, payload, { jobId });
	},
};

const resolveEntityImportJobIdResult = (jobId: string) =>
	wrapServiceValidator(
		() => resolveRequiredString(jobId, "Entity import job id"),
		"Entity import job id is required",
	);

export const importEntity = async (
	input: { body: ImportEntityBody; userId: string },
	deps: EntityImportDeps = defaultEntityImportDeps,
): Promise<ServiceResult<{ jobId: string }, EntityImportMutationError>> => {
	const jobId = generateId();
	const payloadResult = wrapServiceValidator(
		() =>
			mediaImportJobData.parse({
				userId: input.userId,
				scriptId: input.body.scriptId,
				externalId: input.body.externalId,
				entitySchemaId: input.body.entitySchemaId,
			}),
		"Entity import payload is invalid",
	);
	if ("error" in payloadResult) {
		return payloadResult;
	}

	await deps.addJobToQueue({ jobId, payload: payloadResult.data });

	return serviceData({ jobId });
};

export const getEntityImportResult = async (
	input: { jobId: string; userId: string },
	deps: EntityImportDeps = defaultEntityImportDeps,
): Promise<ServiceResult<ImportEntityResult, EntityImportMutationError>> => {
	const jobIdResult = resolveEntityImportJobIdResult(input.jobId);
	if ("error" in jobIdResult) {
		return jobIdResult;
	}

	const job = await deps.getJobFromQueue(jobIdResult.data);
	if (!job) {
		return serviceError("not_found", entityImportJobNotFoundError);
	}

	const parsed = mediaImportJobData.safeParse(job.data);
	if (!parsed.success || parsed.data.userId !== input.userId) {
		return serviceError("not_found", entityImportJobNotFoundError);
	}

	return serviceData(
		await resolveJobPollState(job, entityImportJobFailedMessage, () => ({
			data: job.returnvalue,
			status: "completed" as const,
		})),
	);
};
