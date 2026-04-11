import type { AppSchema } from "@ryot/ts-utils/app-schema";
import { resolveRequiredString } from "@ryot/ts-utils/slug";
import { generateId } from "better-auth";

import { checkReadAccess } from "~/lib/access";
import { isUniqueConstraintError } from "~/lib/app/postgres";
import {
	formatValidationIssues,
	parseAppSchemaProperties,
	parseAppSchemaPropertiesSafe,
} from "~/lib/app/schema-validation";
import { getQueues } from "~/lib/queue";
import { resolveJobPollState } from "~/lib/queue/utils";
import { type ServiceResult, serviceData, serviceError, wrapServiceValidator } from "~/lib/result";
import { ImageSchema, type ImageSchemaType } from "~/lib/zod";
import { getRelationshipSchemaById } from "~/modules/relationship-schemas";

import { entityImportJobData, entityImportJobName } from "./jobs";
import {
	createEntityForUser,
	findEntityByExternalIdForUser,
	listEntityMatchCandidatesBySchemaForUser,
	getEntityByIdForUser,
	getEntitySchemaScopeForUser,
	getUserLibraryEntityId,
	getEntityScopeForUser,
	insertRelationship,
	upsertInLibraryRelationship,
	upsertEntityRelationship,
} from "./repository";
import type {
	CreateEntityBody,
	ImportEntityBody,
	ImportEntityResult,
	ListedEntity,
} from "./schemas";

type EntityMutationError = "not_found" | "validation";
type EntityLibraryMembershipError = "validation";

export type EntityServiceDeps = {
	createEntityForUser: typeof createEntityForUser;
	getEntityByIdForUser: typeof getEntityByIdForUser;
	getEntityScopeForUser: typeof getEntityScopeForUser;
	getEntitySchemaScopeForUser: typeof getEntitySchemaScopeForUser;
	findEntityByExternalIdForUser: typeof findEntityByExternalIdForUser;
};

export type EntityServiceResult<T> = ServiceResult<T, EntityMutationError>;

export type EntityMatchCandidate = Awaited<
	ReturnType<typeof listEntityMatchCandidatesBySchemaForUser>
>[number];

export type EnsureEntityInLibraryDeps = {
	getUserLibraryEntityId: typeof getUserLibraryEntityId;
	upsertInLibraryRelationship: typeof upsertInLibraryRelationship;
};

const entityProvenanceUniqueConstraint = "entity_user_schema_script_external_id_unique";
const entityNotFoundError = "Entity not found";
const partialProvenanceError =
	"externalId and sandboxScriptId must both be provided or both be omitted";
const entitySchemaNotFoundError = "Entity schema not found";
const libraryEntityNotFoundError = "User library entity not found";

const entityServiceDeps: EntityServiceDeps = {
	createEntityForUser,
	getEntityByIdForUser,
	getEntityScopeForUser,
	getEntitySchemaScopeForUser,
	findEntityByExternalIdForUser,
};

const ensureEntityInLibraryDeps: EnsureEntityInLibraryDeps = {
	getUserLibraryEntityId,
	upsertInLibraryRelationship,
};

const resolveEntityIdResult = (entityId: string) =>
	wrapServiceValidator(() => resolveEntityId(entityId), "Entity id is required");

const resolveEntitySchemaIdResult = (entitySchemaId: string) =>
	wrapServiceValidator(() => resolveEntitySchemaId(entitySchemaId), "Entity schema id is required");

export const resolveEntityId = (entityId: string) => resolveRequiredString(entityId, "Entity id");

export const resolveEntityName = (name: string) => resolveRequiredString(name, "Entity name");

export const resolveEntitySchemaId = (entitySchemaId: string) =>
	resolveRequiredString(entitySchemaId, "Entity schema id");

export const parseEntityProperties = (input: {
	properties: unknown;
	propertiesSchema: AppSchema;
}) =>
	parseAppSchemaProperties({
		kind: "Entity",
		properties: input.properties,
		propertiesSchema: input.propertiesSchema,
	});

export const parseEntityImage = (image: unknown): ImageSchemaType | null => {
	if (image == null) {
		return null;
	}

	const parsedImage = ImageSchema.safeParse(image);
	if (parsedImage.success) {
		return parsedImage.data;
	}

	const firstIssue = parsedImage.error.issues[0];
	if (!firstIssue) {
		throw new Error("Entity image is invalid");
	}
	if (firstIssue.code === "invalid_type" && firstIssue.path.length === 0) {
		throw new Error("Entity image must be an object");
	}
	if (firstIssue.code === "invalid_union" && firstIssue.path[0] === "type") {
		throw new Error("Entity image type must be either remote or s3");
	}

	throw new Error(firstIssue.message);
};

export const resolveEntityCreateInput = (
	input: Pick<CreateEntityBody, "image" | "name" | "properties"> & {
		propertiesSchema: AppSchema;
	},
) => {
	const name = resolveEntityName(input.name);
	const image = parseEntityImage(input.image);
	const properties = parseEntityProperties({
		properties: input.properties,
		propertiesSchema: input.propertiesSchema,
	});

	return { name, image, properties };
};

const resolveEntityCreateInputResult = (
	input: Pick<CreateEntityBody, "image" | "name" | "properties"> & {
		propertiesSchema: AppSchema;
	},
) => wrapServiceValidator(() => resolveEntityCreateInput(input), "Entity payload is invalid");

export const ensureEntityInLibrary = async (
	input: { userId: string; entityId: string },
	deps: EnsureEntityInLibraryDeps = ensureEntityInLibraryDeps,
): Promise<ServiceResult<void, EntityLibraryMembershipError>> => {
	const libraryEntityId = await deps.getUserLibraryEntityId({
		userId: input.userId,
	});
	if (!libraryEntityId) {
		return serviceError("validation", libraryEntityNotFoundError);
	}
	await deps.upsertInLibraryRelationship({
		libraryEntityId,
		userId: input.userId,
		entityId: input.entityId,
	});

	return serviceData(undefined);
};

export const getEntityDetail = async (
	input: { entityId: string; userId: string },
	deps: EntityServiceDeps = entityServiceDeps,
): Promise<EntityServiceResult<ListedEntity>> => {
	const entityIdResult = resolveEntityIdResult(input.entityId);
	if ("error" in entityIdResult) {
		return entityIdResult;
	}

	const entityResult = checkReadAccess(
		await deps.getEntityScopeForUser({
			entityId: entityIdResult.data,
			userId: input.userId,
		}),
		{ not_found: entityNotFoundError },
	);
	if ("error" in entityResult) {
		return serviceError("not_found", entityResult.message);
	}
	const entity = await deps.getEntityByIdForUser({
		userId: input.userId,
		entityId: entityIdResult.data,
	});
	if (!entity) {
		return serviceError("not_found", entityNotFoundError);
	}

	return serviceData(entity);
};

export const createEntity = async (
	input: { body: CreateEntityBody; userId: string },
	deps: EntityServiceDeps = entityServiceDeps,
): Promise<EntityServiceResult<ListedEntity>> => {
	const hasExternalId = input.body.externalId !== undefined;
	const hasScriptId = input.body.sandboxScriptId !== undefined;
	if (hasExternalId !== hasScriptId) {
		return serviceError("validation", partialProvenanceError);
	}

	const entitySchemaIdResult = resolveEntitySchemaIdResult(input.body.entitySchemaId);
	if ("error" in entitySchemaIdResult) {
		return entitySchemaIdResult;
	}

	const scope = await deps.getEntitySchemaScopeForUser({
		userId: input.userId,
		entitySchemaId: entitySchemaIdResult.data,
	});
	if (!scope) {
		return serviceError("not_found", entitySchemaNotFoundError);
	}

	const provenance =
		input.body.externalId !== undefined && input.body.sandboxScriptId !== undefined
			? {
					externalId: input.body.externalId,
					sandboxScriptId: input.body.sandboxScriptId,
				}
			: null;

	if (provenance) {
		const existingEntity = await deps.findEntityByExternalIdForUser({
			userId: input.userId,
			externalId: provenance.externalId,
			entitySchemaId: entitySchemaIdResult.data,
			sandboxScriptId: provenance.sandboxScriptId,
		});
		if (existingEntity) {
			return serviceData(existingEntity);
		}
	}

	const entityInput = resolveEntityCreateInputResult({
		name: input.body.name,
		image: input.body.image,
		properties: input.body.properties,
		propertiesSchema: scope.propertiesSchema,
	});
	if ("error" in entityInput) {
		return entityInput;
	}

	try {
		const createdEntity = await deps.createEntityForUser({
			userId: input.userId,
			name: entityInput.data.name,
			image: entityInput.data.image,
			externalId: provenance?.externalId,
			properties: entityInput.data.properties,
			entitySchemaId: entitySchemaIdResult.data,
			sandboxScriptId: provenance?.sandboxScriptId,
		});

		return serviceData(createdEntity);
	} catch (error) {
		if (isUniqueConstraintError(error, entityProvenanceUniqueConstraint) && provenance) {
			const existingEntity = await deps.findEntityByExternalIdForUser({
				userId: input.userId,
				externalId: provenance.externalId,
				entitySchemaId: entitySchemaIdResult.data,
				sandboxScriptId: provenance.sandboxScriptId,
			});
			if (existingEntity) {
				return serviceData(existingEntity);
			}
		}

		throw error;
	}
};

export const listEntityMatchCandidates = async (input: {
	userId: string;
	entitySchemaId: string;
}): Promise<ServiceResult<EntityMatchCandidate[], "validation">> => {
	const entitySchemaIdResult = resolveEntitySchemaIdResult(input.entitySchemaId);
	if ("error" in entitySchemaIdResult) {
		return entitySchemaIdResult;
	}

	return serviceData(
		await listEntityMatchCandidatesBySchemaForUser({
			userId: input.userId,
			entitySchemaId: entitySchemaIdResult.data,
		}),
	);
};

const relationshipSchemaNotFoundError = "Relationship schema not found";

export type WriteRelationshipDeps = {
	insertRelationship: typeof insertRelationship;
	getRelationshipSchemaById: typeof getRelationshipSchemaById;
};

const writeRelationshipDeps: WriteRelationshipDeps = {
	insertRelationship,
	getRelationshipSchemaById,
};

export const writeRelationship = async (
	input: {
		userId: string;
		sourceEntityId: string;
		targetEntityId: string;
		relationshipSchemaId: string;
		properties: Record<string, unknown>;
	},
	deps: WriteRelationshipDeps = writeRelationshipDeps,
): Promise<ServiceResult<void, "not_found" | "validation">> => {
	const relSchema = await deps.getRelationshipSchemaById(input.relationshipSchemaId, input.userId);
	if (!relSchema) {
		return serviceError("not_found", relationshipSchemaNotFoundError);
	}

	const result = parseAppSchemaPropertiesSafe({
		properties: input.properties,
		propertiesSchema: relSchema.propertiesSchema,
	});
	if (!result.success) {
		return serviceError(
			"validation",
			`Relationship properties validation failed: ${formatValidationIssues(result.issues)}`,
		);
	}

	await deps.insertRelationship({
		userId: input.userId,
		properties: result.data,
		sourceEntityId: input.sourceEntityId,
		targetEntityId: input.targetEntityId,
		relationshipSchemaId: input.relationshipSchemaId,
	});

	return serviceData(undefined);
};

export type WriteEntityRelationshipDeps = {
	upsertEntityRelationship: typeof upsertEntityRelationship;
	getRelationshipSchemaById: typeof getRelationshipSchemaById;
};

const writeEntityRelationshipDeps: WriteEntityRelationshipDeps = {
	getRelationshipSchemaById,
	upsertEntityRelationship,
};

export const writeEntityRelationship = async (
	input: {
		sourceEntityId: string;
		targetEntityId: string;
		relationshipSchemaId: string;
		properties: Record<string, unknown>;
	},
	deps: WriteEntityRelationshipDeps = writeEntityRelationshipDeps,
): Promise<ServiceResult<void, "not_found" | "validation">> => {
	const relSchema = await deps.getRelationshipSchemaById(input.relationshipSchemaId, null);
	if (!relSchema) {
		return serviceError("not_found", relationshipSchemaNotFoundError);
	}

	const result = parseAppSchemaPropertiesSafe({
		properties: input.properties,
		propertiesSchema: relSchema.propertiesSchema,
	});
	if (!result.success) {
		return serviceError(
			"validation",
			`Relationship properties validation failed: ${formatValidationIssues(result.issues)}`,
		);
	}

	await deps.upsertEntityRelationship({
		properties: result.data,
		sourceEntityId: input.sourceEntityId,
		targetEntityId: input.targetEntityId,
		relationshipSchemaId: input.relationshipSchemaId,
	});

	return serviceData(undefined);
};

type EntityImportMutationError = "not_found" | "validation";

const entityImportJobFailedMessage = "Entity import job failed";
const entityImportJobNotFoundError = "Entity import job not found";

type EntityQueueJob = {
	data: unknown;
	returnvalue: ListedEntity;
	getState: () => Promise<string>;
	failedReason: string | undefined;
};

export type EntityImportDeps = {
	getJobFromQueue: (jobId: string) => Promise<EntityQueueJob | null | undefined>;
	addJobToQueue: (input: {
		jobId: string;
		payload: ReturnType<typeof entityImportJobData.parse>;
	}) => Promise<void>;
};

const defaultEntityImportDeps: EntityImportDeps = {
	getJobFromQueue: async (jobId) => {
		return getQueues().entityQueue.getJob(jobId);
	},
	addJobToQueue: async ({ jobId, payload }) => {
		await getQueues().entityQueue.add(entityImportJobName, payload, { jobId });
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
			entityImportJobData.parse({
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

	const parsed = entityImportJobData.safeParse(job.data);
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
